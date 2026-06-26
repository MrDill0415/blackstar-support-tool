# Blackstar Support Tool – Build Instructions

## Prerequisites

| Requirement       | Version  | Notes                                    |
|--------------------|----------|------------------------------------------|
| **Node.js**        | ≥ 18 LTS | https://nodejs.org                       |
| **npm**            | ≥ 9      | Bundled with Node.js                     |
| **Windows 10/11**  | x64      | Required for the input-simulation module |
| **Build tools**    | —        | See the native-modules note below        |

### Native modules (koffi)

`koffi` ships pre-built binaries for most platforms, but Electron Forge
runs `electron-rebuild` to recompile against the Electron ABI. If the
rebuild step fails, install the Visual C++ Build Tools:

```
npm install -g windows-build-tools
```

Or install **"Desktop development with C++"** from the Visual Studio
Installer.

---

## Quick start (development)

```bash
# 1. Install dependencies
cd "REMOTE CONNECT TOOL"
npm install

# 2. Start the signaling server (keep this terminal open)
npm run server

# 3. In a second terminal, launch the Electron app
npm start
```

The signaling server listens on **ws://localhost:3456** by default.
Change the port with:

```bash
npm run server -- 4000
```

---

## Two-machine setup (LAN)

1. On **Machine A** (the one hosting the relay):
   ```bash
   npm run server
   npm start
   ```

2. On **Machine B** (the other participant):
   ```bash
   npm start
   ```
   Open **Settings** (gear icon) and set the server URL to
   `ws://<Machine-A-IP>:3456`.

Both machines must be able to reach the signaling server over the
network. The actual screen stream flows peer-to-peer via WebRTC once
the connection is negotiated.

---

## Building a Windows executable

```bash
# Package into an unpacked folder (out/)
npm run package

# Build a distributable installer (.exe via Squirrel) and .zip
npm run make
```

Outputs land in the `out/` directory:

| Path                                     | Description          |
|------------------------------------------|----------------------|
| `out/Blackstar Support Tool-win32-x64/`  | Unpacked app folder  |
| `out/make/squirrel.windows/x64/`         | Squirrel installer   |
| `out/make/zip/win32/x64/`               | Portable zip archive |

---

## Custom logo / branding

Place your logo image in **`src/renderer/assets/`**:

- `logo.png` — used in the header and home screen (recommended 256×256+)
- `icon.ico` — used for the Windows executable icon (multi-resolution)

The app auto-detects `logo.png`; if missing, a built-in SVG star is used.
To enable the `.ico`, uncomment the `icon` line in `forge.config.cjs`.

---

## Installer & Launcher

The project includes a separate **Installer** and **Launcher** app:

### Building the installer

```bash
cd installer
npm install
npx electron-forge make      # → installer/out/make/
```

Edit `installer/src/main.js` and set `DOWNLOAD_URL` to the URL where
you host the Blackstar zip bundle (built with `npm run make` in the
main project).

### How the installer works

1. User runs **BlackstarInstaller.exe**.
2. Clicks **Download & Install** — the app downloads the zip from your
   URL, shows a progress bar, and extracts it to
   `%LOCALAPPDATA%\BlackstarSupportTool\`.
3. Re-running the installer downloads fresh files (acts as an updater).

### Building the launcher

```bash
cd launcher
npm install
npx electron-forge make      # → launcher/out/make/
```

The launcher finds the installed `blackstar-support.exe` and runs it.
Distribute it alongside (or instead of) the installer for a one-click
launch experience.

---

## Project structure

```
REMOTE CONNECT TOOL/
├── package.json
├── forge.config.cjs          # Electron Forge build config
├── BUILD.md                  # ← you are here
├── src/
│   ├── main/
│   │   ├── index.js          # Electron main process
│   │   ├── preload.js        # Context-bridge preload
│   │   ├── input-simulator.js  # Win32 mouse/keyboard via koffi
│   │   └── logger.js         # Session event file logger
│   ├── renderer/
│   │   ├── index.html        # UI shell
│   │   ├── styles.css        # Dark-themed styles
│   │   ├── snowflakes.js     # Falling snowflakes background
│   │   ├── app.js            # Renderer logic (WebRTC, signaling, UI)
│   │   └── assets/           # Place logo.png and icon.ico here
│   └── server/
│       └── signaling-server.js  # WebSocket session relay
├── installer/                # Standalone installer/updater app
│   ├── package.json
│   └── src/
│       ├── main.js
│       ├── preload.js
│       └── index.html
├── launcher/                 # Standalone launcher app
│   ├── package.json
│   └── src/
│       └── main.js
└── .gitignore
```

---

## How it works

1. The **requester** launches the app and clicks *Request Support*.
2. The app connects to the signaling server and receives a unique
   **session code** (e.g. `A7K3-M9P2`).
3. The requester shares the code with a **technician** (phone, chat, etc.).
4. The technician enters the code in their copy of the app.
5. The requester sees a confirmation dialog and must **explicitly approve**
   the connection.
6. Once approved, WebRTC negotiates a peer-to-peer connection:
   - The requester's screen is captured and streamed as video.
   - A data channel carries mouse/keyboard events from technician → requester.
7. The requester's local mouse/keyboard always takes priority. Moving the
   mouse or pressing a key temporarily pauses remote control (~500 ms).
8. Either party can **end the session** at any time. Sessions also expire
   after 30 minutes of inactivity on the signaling server.

All connection events are logged to `%APPDATA%/blackstar-support-tool/logs/`.

---

## Security notes

- **No unattended access** – every session requires the requester to
  click *Allow*.
- Session codes are random, single-use, and expire after 30 minutes.
- Screen sharing and input use WebRTC (DTLS-encrypted, peer-to-peer).
- The signaling server only relays setup messages; it never sees the
  screen stream.
- Extend with TURN servers and TLS (`wss://`) for production use over
  the internet.
