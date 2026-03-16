const { ipcRenderer } = require('electron');
const Store = require('electron-store');
const store = new Store();

const apiKeyInput = document.getElementById('api-key');
const hotkeyDisplay = document.getElementById('hotkey-display');
const micSelect = document.getElementById('mic-select');
const startupToggle = document.getElementById('startup-toggle');
const closeBtn = document.getElementById('close-btn');
const levelBar = document.getElementById('level-bar');
const appVersion = document.getElementById('app-version');
const packageInfo = require('../../package.json');

let recordingHotkey = false;

// Load initial values
apiKeyInput.value = store.get('openaiApiKey') || '';
hotkeyDisplay.innerText = store.get('hotkey') || 'CmdOrCtrl+Shift+S';
startupToggle.checked = store.get('launchAtStartup') || false;
appVersion.innerText = `v${packageInfo.version}`;

// List microphones
function getPreferredMicId(audioInputDevices, savedMicId) {
    const savedDevice = audioInputDevices.find(device => device.deviceId === savedMicId);
    if (savedDevice) {
        return savedDevice.deviceId;
    }

    return (
        audioInputDevices.find(device => device.deviceId === 'default')?.deviceId ||
        audioInputDevices[0]?.deviceId ||
        ''
    );
}

async function listMics() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputDevices = devices.filter(device => device.kind === 'audioinput');
    const savedMicId = store.get('microphoneId');

    micSelect.innerHTML = '';
    audioInputDevices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.text = device.label || `Microphone ${micSelect.length + 1}`;
        micSelect.appendChild(option);
    });

    const preferredMicId = getPreferredMicId(audioInputDevices, savedMicId);
    micSelect.value = preferredMicId;

    if (preferredMicId && preferredMicId !== savedMicId) {
        store.set('microphoneId', preferredMicId);
        ipcRenderer.send('settings-changed');
    }

    if (!preferredMicId && savedMicId) {
        store.delete('microphoneId');
        ipcRenderer.send('settings-changed');
    }
}

listMics();
navigator.mediaDevices.addEventListener('devicechange', listMics);

// Save values on change
apiKeyInput.addEventListener('change', () => {
    store.set('openaiApiKey', apiKeyInput.value);
});

micSelect.addEventListener('change', () => {
    store.set('microphoneId', micSelect.value);
    ipcRenderer.send('settings-changed');
});

startupToggle.addEventListener('change', () => {
    const value = startupToggle.checked;
    store.set('launchAtStartup', value);
    ipcRenderer.send('update-startup', value);
});

closeBtn.addEventListener('click', () => {
    window.close();
});

// Hotkey Recording Logic
hotkeyDisplay.addEventListener('click', () => {
    recordingHotkey = true;
    hotkeyDisplay.innerText = 'Press your keys...';
    hotkeyDisplay.classList.add('recording');
});

window.addEventListener('keydown', (e) => {
    if (!recordingHotkey) return;

    e.preventDefault();

    const keys = [];
    if (e.ctrlKey) keys.push('Ctrl');
    if (e.shiftKey) keys.push('Shift');
    if (e.altKey) keys.push('Alt');
    if (e.metaKey) keys.push('Command');

    // Basic key detection (A-Z, 0-9, etc)
    if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        keys.push(e.key.toUpperCase());

        // Format for Electron (CmdOrCtrl+...)
        let hotkeyString = keys.join('+');
        hotkeyString = hotkeyString.replace('Ctrl', 'CmdOrCtrl');

        store.set('hotkey', hotkeyString);
        hotkeyDisplay.innerText = hotkeyString;
        hotkeyDisplay.classList.remove('recording');
        recordingHotkey = false;

        ipcRenderer.send('settings-changed');
    }
});

// Update Mic Level
ipcRenderer.on('mic-level', (event, level) => {
    // Level is typically 0-255, scale it to 0-100%
    const percentage = Math.min(100, (level / 128) * 100);
    levelBar.style.width = `${percentage}%`;
});
