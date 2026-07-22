const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');

const PORT = 5174;
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 720,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // must be false so the preload script can use require()
      preload: path.join(__dirname, 'preload.cjs'),
    }
  });
  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Guard the main window: block any navigation away from the local server.
  // This still allows http://127.0.0.1:5174/* (e.g. route changes, hot reload).
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!navigationUrl.startsWith(`http://127.0.0.1:${PORT}`)) {
      event.preventDefault();
    }
  });
}

app.whenReady().then(async () => {
  const fs   = require('fs');
  const os   = require('os');

  // Removed destructive migration that wiped userData

  const logPath = path.join(app.getPath('userData'), 'startup.log');
  const log  = (...args) => {
    const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
    process.stdout.write(line);
    try { fs.appendFileSync(logPath, line); } catch {}
  };

  log('App starting, packaged:', app.isPackaged);

  const isPackaged = app.isPackaged;
  const appDir = app.getPath('userData');
  const binDir = isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(app.getAppPath(), 'bin');
  const frontendDir = isPackaged
    ? path.join(app.getAppPath(), 'dist-fe')
    : path.join(app.getAppPath(), 'dist-fe');

  log('appDir:', appDir);
  log('binDir:', binDir);
  log('frontendDir:', frontendDir);

  // Set env vars BEFORE the dynamic import so all modules see them.
  process.env.MEDIADL_APP_DIR  = appDir;
  process.env.MEDIADL_BIN_DIR  = binDir;
  process.env.MEDIADL_DESKTOP  = '1';

  let serverOk = false;
  let serverError = null;
  try {
    log('Importing production server…');
    const { startProductionServer } = await import('../src/server/production.js');
    log('Starting HTTP server on port', PORT);
    await startProductionServer({ port: PORT, appDir, binDir, frontendDir });
    serverOk = true;
    log('Server started OK');
  } catch (err) {
    serverError = err;
    log('ERROR starting server:', err.message);
    log(err.stack || '');
  }

  createWindow();
  if (!serverOk) {
    const { dialog } = require('electron');
    const isPortBusy = (serverError && (serverError.code === 'EADDRINUSE' || String(serverError.message).includes('EADDRINUSE')));
    dialog.showErrorBox(
      'MediaDL — Server failed to start',
      isPortBusy
        ? `Port ${PORT} is already in use.\n\nClose any other MediaDL window and try again.`
        : `The backend server could not start.\n\nError log: ${logPath}\n\nPlease send this file for support.`
    );
  }
});

app.on('window-all-closed', () => app.quit());

// ── Spotify OAuth is now handled natively via the browser and Vite/Express proxy ──
ipcMain.handle('open-external', (_event, url) => shell.openExternal(url));

app.on('web-contents-created', (_event, contents) => {
  contents.on('context-menu', event => event.preventDefault());
});

// ── IPC: Persistent Settings Store ─────────────────────────────────────────────
const settingsPath = path.join(app.getPath('userData'), 'user_settings.json');
let userSettings = {};
try {
  if (require('fs').existsSync(settingsPath)) {
    userSettings = JSON.parse(require('fs').readFileSync(settingsPath, 'utf8'));
  }
} catch (e) { console.error('Error loading settings', e); }

ipcMain.on('store-get', (event, key) => {
  event.returnValue = userSettings[key] !== undefined ? userSettings[key] : null;
});
ipcMain.on('store-set', (event, key, val) => {
  userSettings[key] = val;
  require('fs').writeFileSync(settingsPath, JSON.stringify(userSettings, null, 2));
  event.returnValue = true;
});
ipcMain.on('store-delete', (event, key) => {
  delete userSettings[key];
  require('fs').writeFileSync(settingsPath, JSON.stringify(userSettings, null, 2));
  event.returnValue = true;
});

// ── IPC: Auto Updater ────────────────────────────────────────────────────────
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = false;

function sendUpdateEvent(name, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater-event', { name, data });
  }
}

autoUpdater.on('checking-for-update', () => sendUpdateEvent('checking-for-update'));
autoUpdater.on('update-available', (info) => sendUpdateEvent('update-available', info));
autoUpdater.on('update-not-available', (info) => sendUpdateEvent('update-not-available', info));
autoUpdater.on('error', (err) => sendUpdateEvent('error', err.message));
autoUpdater.on('download-progress', (progressObj) => sendUpdateEvent('download-progress', progressObj));
autoUpdater.on('update-downloaded', (info) => sendUpdateEvent('update-downloaded', info));

ipcMain.handle('check-for-updates', () => {
  if (!app.isPackaged) {
    sendUpdateEvent('error', 'Auto-update is disabled in development mode.');
    return null;
  }
  return autoUpdater.checkForUpdates();
});
ipcMain.handle('download-update', () => autoUpdater.downloadUpdate());
ipcMain.handle('install-update', () => autoUpdater.quitAndInstall(false, true));
ipcMain.handle('get-app-version', () => app.getVersion());
