/**
 * Blackstar Launcher
 *
 * Minimal Electron app that locates the installed Blackstar Support Tool
 * and launches it.  Shows a brief splash, then exits.
 * If the app is not installed, shows a message directing the user to
 * run the installer first.
 */

const { app, BrowserWindow, dialog } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs   = require('fs');

if (require('electron-squirrel-startup')) app.quit();

const INSTALL_DIR = path.join(
  process.env.LOCALAPPDATA || app.getPath('userData'),
  'BlackstarSupportTool'
);

function findExe(dir) {
  const names = ['blackstar-support.exe', 'Blackstar Support Tool.exe'];
  for (const name of names) {
    const found = search(dir, name);
    if (found) return found;
  }
  return null;
}

function search(dir, target) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { const r = search(full, target); if (r) return r; }
      else if (entry.name.toLowerCase() === target.toLowerCase()) return full;
    }
  } catch { /* skip */ }
  return null;
}

app.whenReady().then(() => {
  const exe = findExe(INSTALL_DIR);

  if (!exe || !fs.existsSync(exe)) {
    dialog.showErrorBox(
      'Blackstar Not Found',
      'Blackstar Support Tool is not installed.\n\nPlease run the Blackstar Installer first.'
    );
    app.quit();
    return;
  }

  // Show a brief splash window
  const splash = new BrowserWindow({
    width: 320, height: 180, frame: false,
    resizable: false, transparent: true, alwaysOnTop: true,
    webPreferences: { contextIsolation: true },
  });

  splash.loadURL(`data:text/html,
    <body style="margin:0;display:flex;align-items:center;justify-content:center;
      height:100vh;background:rgba(10,10,15,.92);border-radius:12px;
      font-family:Segoe UI,sans-serif;color:#e0e0e0;">
      <div style="text-align:center">
        <svg viewBox="0 0 100 100" width="48" height="48">
          <defs><linearGradient id="g" x1="0%25" y1="0%25" x2="100%25" y2="100%25">
            <stop offset="0%25" stop-color="%237b2ff7"/><stop offset="100%25" stop-color="%2300b4d8"/>
          </linearGradient></defs>
          <path d="M50 5 L61 38 L95 38 L68 59 L79 92 L50 72 L21 92 L32 59 L5 38 L39 38 Z" fill="url(%23g)"/>
        </svg>
        <p style="font-size:14px;margin-top:10px">Launching Blackstar&hellip;</p>
      </div>
    </body>
  `);

  // Launch the main app and quit
  execFile(exe, { cwd: path.dirname(exe) }, () => {});
  setTimeout(() => app.quit(), 2000);
});

app.on('window-all-closed', () => app.quit());
