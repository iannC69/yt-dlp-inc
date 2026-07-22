const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal, safe API to the renderer process.
// contextBridge ensures no Node/Electron APIs leak into the page.
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Open a URL in the user's default system browser.
   * @param {string} url
   */
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // Settings Store APIs
  settings: {
    get: (key) => ipcRenderer.sendSync('store-get', key),
    set: (key, val) => ipcRenderer.sendSync('store-set', key, val),
    delete: (key) => ipcRenderer.sendSync('store-delete', key)
  },

  // Auto Updater APIs
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    onUpdaterEvent: (callback) => {
      const handler = (_event, { name, data }) => callback(name, data);
      ipcRenderer.on('updater-event', handler);
      return () => ipcRenderer.removeListener('updater-event', handler);
    }
  }
});
