const { app, BrowserWindow, globalShortcut, Tray, Menu, ipcMain, shell, clipboard } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { exec } = require('child_process');

const store = new Store();
let mainWindow = null;
let recorderWindow = null;
let tray = null;
let isRecording = false;

// Default settings
if (!store.get('hotkey')) store.set('hotkey', 'CmdOrCtrl+Shift+S');
if (!store.get('launchAtStartup')) store.set('launchAtStartup', false);

function createSettingsWindow() {
    if (mainWindow) {
        mainWindow.focus();
        return;
    }

    mainWindow = new BrowserWindow({
        width: 450,
        height: 600,
        frame: false,
        transparent: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        icon: path.join(__dirname, '../../assets/icon.png')
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));
    mainWindow.on('closed', () => mainWindow = null);
}

function createRecorderWindow() {
    recorderWindow = new BrowserWindow({
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });
    recorderWindow.loadFile(path.join(__dirname, '../renderer/recorder.html'));
}

function toggleRecording() {
    if (!isRecording) {
        startRecording();
    } else {
        stopRecording();
    }
}

function startRecording() {
    isRecording = true;
    updateTrayIcon('recording');
    recorderWindow.webContents.send('start-recording');
}

function stopRecording() {
    isRecording = false;
    updateTrayIcon('processing');
    recorderWindow.webContents.send('stop-recording');
}

function updateTrayIcon(state) {
    // states: idle, recording, processing
    // Placeholder logic for now, using tooltips as visual feedback
    let tooltip = 'STT Windows - Ready';
    if (state === 'recording') tooltip = 'STT Windows - Recording...';
    if (state === 'processing') tooltip = 'STT Windows - Processing Audio...';

    if (tray) {
        tray.setToolTip(tooltip);
        // In a real app we would change icons: tray.setImage(path.join(__dirname, `../../assets/icon-${state}.png`));
    }
}

function pasteText(text) {
    const oldClipboard = clipboard.readText();
    clipboard.writeText(text);

    // Use a more robust PowerShell command for SendKeys
    const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')`;

    exec(`powershell -ExecutionPolicy Bypass -Command "${script}"`, (error, stdout, stderr) => {
        if (error) {
            console.error('Text injection error:', error);
        }

        // Wait longer before restoring to ensure the OS has processed the paste
        setTimeout(() => {
            clipboard.writeText(oldClipboard);
        }, 1000);
    });
}

app.whenReady().then(() => {
    createRecorderWindow();

    // Setup Tray
    tray = new Tray(path.join(__dirname, '../../assets/icon.png'));
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Settings', click: createSettingsWindow },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() }
    ]);
    tray.setContextMenu(contextMenu);
    tray.setToolTip('STT Windows - Ready');

    // Register Global Hotkey
    const hotkey = store.get('hotkey');
    globalShortcut.register(hotkey, toggleRecording);

    // Setup startup setting
    app.setLoginItemSettings({
        openAtLogin: store.get('launchAtStartup'),
        path: app.getPath('exe')
    });

    // Handle IPC from recorder
    ipcMain.on('audio-transcribed', (event, text) => {
        updateTrayIcon('idle');
        if (text && text.trim()) {
            pasteText(text);
        }
    });

    ipcMain.on('audio-level', (event, level) => {
        if (mainWindow) {
            mainWindow.webContents.send('mic-level', level);
        }
    });

    ipcMain.on('update-startup', (event, value) => {
        app.setLoginItemSettings({
            openAtLogin: value,
            path: app.getPath('exe')
        });
    });

    // Re-register hotkey if changed
    ipcMain.on('settings-changed', () => {
        globalShortcut.unregisterAll();
        const newHotkey = store.get('hotkey');
        globalShortcut.register(newHotkey, toggleRecording);
    });
});

app.on('window-all-closed', (e) => {
    if (process.platform !== 'darwin') {
        // Keep app running in tray
        e.preventDefault();
    }
});
