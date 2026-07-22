export const storage = {
  getItem: (k) => {
    if (window.electronAPI && window.electronAPI.settings) {
      const val = window.electronAPI.settings.get(k);
      return val !== null ? val : localStorage.getItem(k); // fallback to localstorage if missing in IPC store but present in localstorage during migration
    }
    return localStorage.getItem(k);
  },
  setItem: (k, v) => {
    if (window.electronAPI && window.electronAPI.settings) {
      window.electronAPI.settings.set(k, v);
    }
    localStorage.setItem(k, v); // write to both to be safe
  },
  removeItem: (k) => {
    if (window.electronAPI && window.electronAPI.settings) {
      window.electronAPI.settings.delete(k);
    }
    localStorage.removeItem(k);
  }
};
