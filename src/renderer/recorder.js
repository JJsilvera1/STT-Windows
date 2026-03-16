const { ipcRenderer } = require('electron');
const Store = require('electron-store');
const store = new Store();

let mediaRecorder;
let audioChunks = [];
let audioContext;
let analyser;
let micStream;
let animationFrameId;

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

async function setupMic() {
    // Cleanup existing stream and context if they exist
    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
    }
    if (audioContext) {
        await audioContext.close();
    }
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }

    try {
        const constraints = {
            audio: await resolveAudioConstraints()
        };
        micStream = await navigator.mediaDevices.getUserMedia(constraints);

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

            const apiKey = store.get('openaiApiKey');
            if (!apiKey) {
                console.error('No OpenAI API Key found in store');
                ipcRenderer.send('audio-transcribed', '');
                return;
            }

            const text = await transcribeAudio(audioBlob, apiKey);
            ipcRenderer.send('audio-transcribed', text);
        };

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
    if (mediaRecorder && mediaRecorder.state === 'inactive') {
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

navigator.mediaDevices.addEventListener('devicechange', () => {
    setupMic();
});

// Initial setup to allow device selection later
setupMic();
