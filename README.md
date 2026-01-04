# STT Windows

A premium, background speech-to-text utility for Windows. Record your voice with a global hotkey and have it transcribed and injected directly into your active text cursor using OpenAI Whisper.

## Features

- **Global Hotkey** (`Ctrl+Shift+S`) to start/stop recording.
- **OpenAI Whisper** for high-accuracy transcription.
- **Direct Injection**: Text is pasted at your cursor automatically.
- **Modern UI**: Glassmorphism settings window with mic level feedback.
- **Auto-start**: Option to launch when Windows boots.

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the application:
   ```bash
   npm start
   ```
3. Set your **OpenAI API Key** in the settings (right-click tray icon).

## Setup Installer

To build a standalone `.exe` installer:
```bash
npm run dist
```
Build artifacts will appear in the `/dist` folder.
