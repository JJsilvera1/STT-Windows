const { ipcRenderer } = require('electron');
const Store = require('electron-store');
const store = new Store();

let mediaRecorder;
let audioChunks = [];
let audioContext;
let analyser;
let micStream;

async function setupMic() {
    const deviceId = store.get('microphoneId');
    const constraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true
    };

    try {
        micStream = await navigator.mediaDevices.getUserMedia(constraints);

        // Audio analysis for level bar
        audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(micStream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        function updateLevel() {
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(dataArray);

            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            ipcRenderer.send('audio-level', average);
            requestAnimationFrame(updateLevel);
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

            const reader = new FileReader();
            reader.onload = async () => {
                const base64Audio = reader.result.split(',')[1];
                // Send to transcription service (to be implemented)
                const text = await transcribeAudio(audioBlob, apiKey);
                ipcRenderer.send('audio-transcribed', text);
            };
            reader.readAsDataURL(audioBlob);
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
            mediaRecorder.start();
        });
    }
});

ipcRenderer.on('stop-recording', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
});

// Initial setup to allow device selection later
setupMic();
