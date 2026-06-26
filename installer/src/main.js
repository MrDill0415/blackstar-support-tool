/**
 * Blackstar Installer - Main Process
 *
 * A small Electron app that downloads (or updates) the Blackstar Support Tool.
 * Re-running the installer pulls fresh files from the configured download URL.
 *
 * Supports Google Drive share links — automatically converts them to direct
 * download URLs and handles the large-file confirmation page.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');
const { URL } = require('url');

if (require('electron-squirrel-startup')) app.quit();

// ── Configuration ─────────────────────────────────────────────────────────────
// Paste your Google Drive share link here (the regular "Anyone with the link"
// share URL).  The installer converts it to a direct-download URL.
//
// Example share link:
//   https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/view?usp=sharing
//
// You can also use any direct-download URL if you prefer a different host.

const DOWNLOAD_URL  = 'https://drive.google.com/file/d/YOUR_FILE_ID_HERE/view?usp=sharing';
const INSTALL_DIR   = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'BlackstarSupportTool');
const LAUNCHER_PATH = path.join(INSTALL_DIR, 'Launch Blackstar.bat');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 440,
    resizable: false,
    backgroundColor: '#0a0a0f',
    autoHideMenuBar: true,
    title: 'Blackstar Installer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

// ── Google Drive URL handling ─────────────────────────────────────────────────

/**
 * Convert any Google Drive share/view link into a direct download URL.
 * Handles these formats:
 *   https://drive.google.com/file/d/FILE_ID/view?usp=sharing
 *   https://drive.google.com/open?id=FILE_ID
 *   https://drive.google.com/uc?id=FILE_ID&export=download
 */
function toDirectDriveUrl(url) {
  // Already a direct download link
  if (url.includes('/uc?') && url.includes('export=download')) return url;

  // Extract file ID from /file/d/ID/ pattern
  let match = url.match(/\/file\/d\/([^/]+)/);
  if (match) return `https://drive.google.com/uc?export=download&id=${match[1]}`;

  // Extract file ID from ?id=ID pattern
  match = url.match(/[?&]id=([^&]+)/);
  if (match) return `https://drive.google.com/uc?export=download&id=${match[1]}`;

  // Not a Drive link — return as-is
  return url;
}

function isGoogleDrive(url) {
  return url.includes('drive.google.com') || url.includes('docs.google.com');
}

// ── IPC: download and install ─────────────────────────────────────────────────

ipcMain.handle('get-config', () => ({
  downloadUrl: DOWNLOAD_URL,
  installDir: INSTALL_DIR,
  installed: fs.existsSync(LAUNCHER_PATH),
}));

ipcMain.handle('start-install', async (_event, customUrl) => {
  let url = customUrl || DOWNLOAD_URL;

  // Convert Google Drive share links to direct download
  if (isGoogleDrive(url)) {
    url = toDirectDriveUrl(url);
  }

  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  const zipPath = path.join(INSTALL_DIR, 'blackstar-latest.zip');

  try {
    await downloadFile(url, zipPath, (progress) => {
      mainWindow.webContents.send('download-progress', progress);
    });

    mainWindow.webContents.send('install-status', 'Extracting files…');
    await extractZip(zipPath, INSTALL_DIR);

    const exePath = findExecutable(INSTALL_DIR);
    writeLauncher(exePath);

    fs.unlinkSync(zipPath);

    mainWindow.webContents.send('install-status', 'done');
    return { success: true, installDir: INSTALL_DIR };
  } catch (err) {
    mainWindow.webContents.send('install-status', `Error: ${err.message}`);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('launch-app', () => {
  const { exec } = require('child_process');
  if (fs.existsSync(LAUNCHER_PATH)) {
    exec(`start "" "${LAUNCHER_PATH}"`, { cwd: INSTALL_DIR });
    setTimeout(() => app.quit(), 500);
    return true;
  }
  return false;
});

// ── Download helper (with Google Drive large-file bypass) ─────────────────────

function downloadFile(url, dest, onProgress, cookies = '') {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {},
    };
    if (cookies) options.headers['Cookie'] = cookies;

    const protocol = parsed.protocol === 'https:' ? https : http;

    const req = protocol.get(options, (res) => {
      // Follow redirects (Google Drive uses several)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Collect any Set-Cookie headers for the redirect chain
        const newCookies = mergeCookies(cookies, res.headers['set-cookie']);
        return downloadFile(res.headers.location, dest, onProgress, newCookies)
          .then(resolve, reject);
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const contentType = res.headers['content-type'] || '';

      // Google Drive virus-scan confirmation page for large files.
      // It returns an HTML page instead of the file.  We need to find
      // the confirmation link and follow it.
      if (isGoogleDrive(url) && contentType.includes('text/html')) {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          const confirmUrl = extractConfirmUrl(body, url);
          if (confirmUrl) {
            const allCookies = mergeCookies(cookies, res.headers['set-cookie']);
            downloadFile(confirmUrl, dest, onProgress, allCookies)
              .then(resolve, reject);
          } else {
            reject(new Error('Could not bypass Google Drive download confirmation'));
          }
        });
        return;
      }

      // Actual file download
      const total = parseInt(res.headers['content-length'], 10) || 0;
      let downloaded = 0;
      const file = fs.createWriteStream(dest);

      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total > 0) {
          onProgress({ downloaded, total, percent: Math.round((downloaded / total) * 100) });
        } else {
          onProgress({ downloaded, total: 0, percent: -1 });
        }
      });

      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
    });

    req.on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

/**
 * Parse the Google Drive "download anyway" confirmation page and extract
 * the real download URL.
 */
function extractConfirmUrl(html, originalUrl) {
  // Look for the confirm token in the form or link
  // Pattern 1: form action with confirm parameter
  let match = html.match(/action="([^"]*?)"/);
  if (match) {
    let formUrl = match[1].replace(/&amp;/g, '&');
    if (formUrl.startsWith('/')) formUrl = 'https://drive.google.com' + formUrl;
    return formUrl;
  }

  // Pattern 2: direct confirm link
  match = html.match(/href="(\/uc\?export=download[^"]*?)"/);
  if (match) {
    return 'https://drive.google.com' + match[1].replace(/&amp;/g, '&');
  }

  // Pattern 3: extract confirm token and rebuild URL
  match = html.match(/confirm=([0-9A-Za-z_-]+)/);
  if (match) {
    const idMatch = originalUrl.match(/id=([^&]+)/);
    if (idMatch) {
      return `https://drive.google.com/uc?export=download&confirm=${match[1]}&id=${idMatch[1]}`;
    }
  }

  return null;
}

/**
 * Merge Set-Cookie headers into a single cookie string for follow-up requests.
 */
function mergeCookies(existing, setCookieHeaders) {
  if (!setCookieHeaders) return existing;
  const arr = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  const newParts = arr.map(c => c.split(';')[0]);
  const allParts = existing ? [existing, ...newParts] : newParts;
  return allParts.join('; ');
}

// ── Extraction helper (uses PowerShell Expand-Archive) ────────────────────────

function extractZip(zipPath, destDir) {
  const { execSync } = require('child_process');
  return new Promise((resolve, reject) => {
    try {
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`,
        { windowsHide: true, timeout: 120000 }
      );
      resolve();
    } catch (err) {
      reject(new Error('Extraction failed: ' + err.message));
    }
  });
}

// ── Find the main .exe inside the install directory ───────────────────────────

function findExecutable(dir) {
  const candidates = ['blackstar-support.exe', 'Blackstar Support Tool.exe'];
  for (const name of candidates) {
    const check = findFileRecursive(dir, name);
    if (check) return check;
  }
  return path.join(dir, 'blackstar-support.exe');
}

function findFileRecursive(dir, target) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findFileRecursive(full, target);
        if (found) return found;
      } else if (entry.name.toLowerCase() === target.toLowerCase()) {
        return full;
      }
    }
  } catch { /* ignore permission errors */ }
  return null;
}

// ── Launcher batch file ───────────────────────────────────────────────────────

function writeLauncher(exePath) {
  const content = `@echo off\r\nstart "" "${exePath}"\r\n`;
  fs.writeFileSync(LAUNCHER_PATH, content, 'utf-8');
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
