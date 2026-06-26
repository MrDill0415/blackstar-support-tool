/**
 * Blackstar Support Tool - Preload Script
 *
 * Bridges the isolated renderer to the main process via contextBridge.
 * Only specific, safe IPC channels are exposed.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blackstar', {
  // Remote input simulation (requester side)
  simulateInput:   (evt)  => ipcRenderer.invoke('simulate-input', evt),
  startLocalDetection: () => ipcRenderer.invoke('start-local-detection'),
  stopLocalDetection:  () => ipcRenderer.invoke('stop-local-detection'),

  // Screen info
  getScreenSize:   ()     => ipcRenderer.invoke('get-screen-size'),
  getScreenSources:()     => ipcRenderer.invoke('get-screen-sources'),

  // Logging
  logEvent:        (data) => ipcRenderer.invoke('log-event', data),

  // Embedded signaling server control
  startEmbeddedServer: (port) => ipcRenderer.invoke('start-embedded-server', port),
  stopEmbeddedServer:  ()     => ipcRenderer.invoke('stop-embedded-server'),

  // App metadata
  getVersion:      ()     => ipcRenderer.invoke('get-version'),
  getPlatform:     ()     => process.platform,
});
