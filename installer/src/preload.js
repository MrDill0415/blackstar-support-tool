const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('installer', {
  getConfig:    ()    => ipcRenderer.invoke('get-config'),
  startInstall: (url) => ipcRenderer.invoke('start-install', url),
  launchApp:    ()    => ipcRenderer.invoke('launch-app'),

  onProgress: (cb) => ipcRenderer.on('download-progress', (_e, data) => cb(data)),
  onStatus:   (cb) => ipcRenderer.on('install-status',    (_e, msg)  => cb(msg)),
});
