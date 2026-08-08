const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updaterAPI', {
  getReleaseData: () => ipcRenderer.invoke('updater-get-release-data'),
  downloadUpdate: () => ipcRenderer.send('updater-download'),
  installUpdate: () => ipcRenderer.send('updater-install'),
  dismissUpdate: () => ipcRenderer.send('updater-dismiss'),
  onProgress: (callback) => {
    const handler = (_e, progress) => callback(progress);
    ipcRenderer.on('updater-progress', handler);
    return () => ipcRenderer.removeListener('updater-progress', handler);
  },
  onDownloaded: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('updater-downloaded', handler);
    return () => ipcRenderer.removeListener('updater-downloaded', handler);
  },
  onError: (callback) => {
    const handler = (_e, err) => callback(err);
    ipcRenderer.on('updater-error', handler);
    return () => ipcRenderer.removeListener('updater-error', handler);
  },
  getGeminiKey: () => ipcRenderer.invoke('get-gemini-key')
});
