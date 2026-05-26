const { ipcRenderer } = require('electron');
const Store = require('electron-store');
const store = new Store();

let mediaRecorder;
let audioChunks = [];
let audioContext;
let analyser;
let micStream;
let animationFrameId;
let healthCheckTimer;
let setupMicPromise;
let discardNextRecording = false;

async function resolveAudioConstraints() {
    const savedDeviceId = store.get('microphoneId');
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputDevices = devices.filter(device => device.kind === 'audioinput');

    if (!audioInputDevices.length) {
        store.delete('microphoneId');
        return true;
    }

    const savedDevice = audioInputDevices.find(device => device.deviceId === savedDeviceId);
    if (savedDevice) {
        return { deviceId: { exact: savedDeviceId } };
    }

    const fallbackDevice =
        audioInputDevices.find(device => device.deviceId === 'default') ||
        audioInputDevices[0];

    if (fallbackDevice?.deviceId) {
        store.set('microphoneId', fallbackDevice.deviceId);
    } else {
        store.delete('microphoneId');
    }

    return fallbackDevice?.deviceId
        ? { deviceId: { exact: fallbackDevice.deviceId } }
        : true;
}

async function cleanupMic(discardRecording = false) {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    if (healthCheckTimer) {
        clearInterval(healthCheckTimer);
        healthCheckTimer = null;
    }

    analyser = null;

    if (mediaRecorder && mediaRecorder.state === 'recording') {
        if (discardRecording) {
            discardNextRecording = true;
        }

        try {
            mediaRecorder.stop();
        } catch (err) {
            console.error('Error stopping recorder during cleanup:', err);
        }
    }

    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
    }

    if (audioContext && audioContext.state !== 'closed') {
        try {
            await audioContext.close();
        } catch (err) {
            console.error('Error closing audio context:', err);
        }
    }
    audioContext = null;
    mediaRecorder = null;
}

function hasLiveMic() {
    return micStream?.getAudioTracks().some(track => track.readyState === 'live');
}

function startMicHealthCheck() {
    if (healthCheckTimer) {
        clearInterval(healthCheckTimer);
    }

    healthCheckTimer = setInterval(async () => {
        const audioTrack = micStream?.getAudioTracks()[0];

        if (!audioTrack || audioTrack.readyState !== 'live') {
            await setupMic();
            return;
        }

        if (audioContext?.state === 'suspended') {
            try {
                await audioContext.resume();
            } catch (err) {
                console.error('Error resuming audio context:', err);
                await setupMic();
            }
        }
    }, 10000);
}

async function setupMic(discardRecording = false) {
    if (setupMicPromise) {
        return setupMicPromise;
    }

    setupMicPromise = setupMicInternal(discardRecording).finally(() => {
        setupMicPromise = null;
    });

    return setupMicPromise;
}

async function setupMicInternal(discardRecording) {
    await cleanupMic(discardRecording);

    try {
        const constraints = {
            audio: await resolveAudioConstraints()
        };
        micStream = await navigator.mediaDevices.getUserMedia(constraints);
        micStream.getAudioTracks().forEach(track => {
            track.addEventListener('ended', () => setupMic(true));
            track.addEventListener('mute', () => {
                setTimeout(() => {
                    if (!hasLiveMic()) setupMic(true);
                }, 1000);
            });
        });

        // Audio analysis for level bar
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(micStream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        function updateLevel() {
            if (!analyser) return;
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(dataArray);

            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            ipcRenderer.send('audio-level', average);
            animationFrameId = requestAnimationFrame(updateLevel);
        }
        updateLevel();

        mediaRecorder = new MediaRecorder(micStream);

        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            audioChunks = [];

            if (discardNextRecording) {
                discardNextRecording = false;
                ipcRenderer.send('audio-transcribed', '');
                return;
            }

            const apiKey = store.get('openaiApiKey');
            if (!apiKey) {
                console.error('No OpenAI API Key found in store');
                ipcRenderer.send('audio-transcribed', '');
                return;
            }

            const text = await transcribeAudio(audioBlob, apiKey);
            ipcRenderer.send('audio-transcribed', text);
        };

        startMicHealthCheck();

    } catch (err) {
        console.error('Error accessing microphone:', err);
    }
}

async function transcribeAudio(blob, apiKey) {
    const formData = new FormData();
    formData.append('file', blob, 'audio.webm');
    formData.append('model', 'whisper-1');

    try {
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });

        const data = await response.json();
        return data.text || '';
    } catch (err) {
        console.error('Transcription error:', err);
        return '';
    }
}

ipcRenderer.on('start-recording', () => {
    if (mediaRecorder && mediaRecorder.state === 'inactive' && hasLiveMic()) {
        mediaRecorder.start();
    } else {
        setupMic().then(() => {
            if (mediaRecorder) mediaRecorder.start();
        });
    }
});

ipcRenderer.on('stop-recording', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
});

ipcRenderer.on('settings-updated', () => {
    setupMic();
});

ipcRenderer.on('refresh-microphone', (event, reason) => {
    if (reason === 'suspend') {
        cleanupMic(true);
        return;
    }

    setupMic(true);
});

navigator.mediaDevices.addEventListener('devicechange', () => {
    setupMic(true);
});

// Initial setup to allow device selection later
setupMic();
