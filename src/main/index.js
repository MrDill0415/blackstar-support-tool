/**
 * Blackstar Support Tool - Main Process
 *
 * Creates the application window, wires up IPC handlers for input
 * simulation / screen capture / logging, and optionally starts an
 * embedded signaling server for LAN use.
 */

const { app, BrowserWindow, ipcMain, desktopCapturer, session, screen } = require('electron');
const path = require('path');
const InputSimulator = require('./input-simulator');
const Logger = require('./logger');

// Handle Squirrel install/update events on Windows
if (require('electron-squirrel-startup')) app.quit();

let mainWindow;
let inputSimulator;
let logger;
let embeddedServer = null;

// ── Window creation ───────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 640,
    minHeight: 520,
    backgroundColor: '#0a0a0f',
    title: 'Blackstar Support Tool',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Allow the renderer to capture the screen via getDisplayMedia()
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (sources.length > 0) {
        callback({ video: sources[0] });
        logger.log({ event: 'screen-capture', detail: 'Screen capture granted' });
      } else {
        callback(null);
      }
    });
  });
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

function setupIPC() {
  ipcMain.handle('simulate-input', (_event, evt) => {
    return inputSimulator.processEvent(evt);
  });

  ipcMain.handle('start-local-detection', () => {
    inputSimulator.startLocalDetection();
    return true;
  });

  ipcMain.handle('stop-local-detection', () => {
    inputSimulator.stopLocalDetection();
    return true;
  });

  ipcMain.handle('get-screen-size', () => {
    return screen.getPrimaryDisplay().size;
  });

  ipcMain.handle('get-screen-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources.map((s) => ({ id: s.id, name: s.name }));
  });

  ipcMain.handle('log-event', (_event, data) => {
    logger.log(data);
    return true;
  });

  ipcMain.handle('get-version', () => app.getVersion());

  // Optional: start / stop the embedded signaling server
  ipcMain.handle('start-embedded-server', (_event, port) => {
    if (embeddedServer) return { running: true };
    try {
      const { start } = require('../server/signaling-server');
      embeddedServer = start(port || 3456);
      logger.log({ event: 'server-start', detail: `Embedded server on port ${port || 3456}` });
      return { running: true };
    } catch (err) {
      return { running: false, error: err.message };
    }
  });

  ipcMain.handle('stop-embedded-server', () => {
    if (embeddedServer) {
      embeddedServer.close();
      embeddedServer = null;
      logger.log({ event: 'server-stop', detail: 'Embedded server stopped' });
    }
    return true;
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  inputSimulator = new InputSimulator();
  logger = new Logger();
  logger.log({ event: 'app-start', detail: `v${app.getVersion()}` });

  setupIPC();
  createWindow();
});

app.on('window-all-closed', () => {
  if (embeddedServer) embeddedServer.close();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
