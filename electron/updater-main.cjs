const { BrowserWindow, ipcMain, shell, app } = require('electron');
const path = require('path');
const https = require('https');
const semver = require('semver');
const { autoUpdater } = require('electron-updater');

const OWNER = 'iannC69';
const REPO = 'yt-dlp-inc';
let updaterWin = null;
let currentUpdateData = null;

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

function httpsGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      headers: {
        'User-Agent': 'MediaDL-Updater',
        'Accept': 'application/vnd.github.v3+json',
        ...options.headers
      }
    };
    https.get(url, reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON'));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

async function fetchReleases() {
  try {
    const releases = await httpsGet(`https://api.github.com/repos/${OWNER}/${REPO}/releases`);
    return releases;
  } catch (err) {
    console.error('[Updater] Failed to fetch releases:', err.message);
    return [];
  }
}

async function fetchCommits() {
  try {
    const commits = await httpsGet(`https://api.github.com/repos/${OWNER}/${REPO}/commits?per_page=100`);
    return commits;
  } catch (err) {
    console.error('[Updater] Failed to fetch commits:', err.message);
    return [];
  }
}

async function checkForUpdates() {
  console.log('[Updater] Checking for updates...');
  
  const currentVersion = app.getVersion();
  
  const releases = await fetchReleases();
  const commits = await fetchCommits();
  
  // Filter releases newer than currentVersion
  const newerReleases = releases.filter(r => {
    try {
      const tag = r.tag_name.replace(/^v/, '');
      return semver.gt(tag, currentVersion);
    } catch {
      return false;
    }
  });

  if (newerReleases.length === 0) {
    console.log('[Updater] No updates available.');
    // Check if we want to fake it in dev
    if (!app.isPackaged && process.env.TEST_UPDATER) {
      console.log('[Updater] Forcing update UI for dev testing');
    } else {
      return false;
    }
  }

  // Build the structured data
  const resultReleases = [];
  let latestDownloadUrl = null;
  let latestVersion = null;

  const currentVersionDate = releases.find(r => r.tag_name.replace(/^v/, '') === currentVersion)?.published_at 
    || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  
  for (const release of newerReleases) {
    const version = release.tag_name.replace(/^v/, '');
    if (!latestVersion || semver.gt(version, latestVersion)) {
      latestVersion = version;
      const asset = release.assets.find(a => a.name.endsWith('.exe'));
      if (asset) latestDownloadUrl = asset.browser_download_url;
      else latestDownloadUrl = release.html_url;
    }

    const releaseDate = new Date(release.published_at);
    
    const releaseCommits = [];
    commits.forEach(c => {
      const cDate = new Date(c.commit.author.date);
      if (cDate <= releaseDate && cDate > new Date(currentVersionDate)) {
        releaseCommits.push({
          message: c.commit.message.split('\n')[0],
          shortSha: c.sha.substring(0, 7),
          authorName: c.commit.author.name,
          avatarUrl: c.author ? c.author.avatar_url : null
        });
      }
    });

    resultReleases.push({
      version,
      description: release.body || '',
      isLatest: false,
      commits: releaseCommits.slice(0, 15)
    });
  }

  if (resultReleases.length > 0) {
    resultReleases.sort((a, b) => semver.rcompare(a.version, b.version));
    resultReleases[0].isLatest = true;
  } else if (!app.isPackaged && process.env.TEST_UPDATER) {
    latestVersion = "9.9.9";
    latestDownloadUrl = "https://github.com/iannC69/yt-dlp-inc/releases";
    resultReleases.push({
      version: "9.9.9",
      description: "Major UI Overhaul and Nebula Theme",
      isLatest: true,
      commits: [
        {
          message: "feat: implemented standalone window config with deep space gradient",
          shortSha: "a1b2c3d",
          authorName: "Developer",
          avatarUrl: "https://avatars.githubusercontent.com/u/9919?s=40&v=4"
        },
        {
          message: "style: custom scrollbars and dot timeline connector",
          shortSha: "4e5f6g7",
          authorName: "Designer",
          avatarUrl: "https://avatars.githubusercontent.com/u/1024025?v=4"
        },
        {
          message: "fix: resolved timeline gap rendering issues",
          shortSha: "h8i9j0k",
          authorName: "Developer",
          avatarUrl: null
        }
      ]
    });
    resultReleases.push({
      version: "9.9.8",
      description: "Security update, cutting down on dependencies",
      isLatest: false,
      commits: [
        {
          message: "chore: remove 'events' dependency and update imports",
          shortSha: "10030cc",
          authorName: "Maintainer",
          avatarUrl: "https://avatars.githubusercontent.com/u/23213004?v=4"
        },
        {
          message: "chore: update electron version to 39.8.10",
          shortSha: "ac50451",
          authorName: "Maintainer",
          avatarUrl: "https://avatars.githubusercontent.com/u/23213004?v=4"
        }
      ]
    });
    resultReleases.push({
      version: "9.9.7",
      description: "Updated media control bridge, purged old packages",
      isLatest: false,
      commits: [
        {
          message: "feat: enhance window management and UI components",
          shortSha: "aba31e7",
          authorName: "Developer",
          avatarUrl: "https://avatars.githubusercontent.com/u/9919?s=40&v=4"
        }
      ]
    });
  }

  currentUpdateData = {
    currentVersion,
    latestVersion,
    downloadUrl: latestDownloadUrl,
    releases: resultReleases
  };

  return true;
}

async function getReleaseHistory() {
  const releases = await fetchReleases();
  const commits = await fetchCommits();
  
  const resultReleases = [];
  let latestVersion = null;

  for (const release of releases) {
    const version = release.tag_name.replace(/^v/, '');
    if (!latestVersion || semver.gt(version, latestVersion)) {
      latestVersion = version;
    }

    const releaseDate = new Date(release.published_at);
    
    const releaseCommits = [];
    commits.forEach(c => {
      const cDate = new Date(c.commit.author.date);
      // For history, we just attach commits that happened up to this release.
      // A simplistic approach is to just attach the last 5-10 commits before this release's date.
      // But we need to bound it by the PREVIOUS release's date.
      // So let's find the next oldest release.
      const olderRelease = releases.find(r => semver.lt(r.tag_name.replace(/^v/, ''), version));
      const olderDate = olderRelease ? new Date(olderRelease.published_at) : new Date(0);
      
      if (cDate <= releaseDate && cDate > olderDate) {
        releaseCommits.push({
          message: c.commit.message.split('\n')[0],
          shortSha: c.sha.substring(0, 7),
          authorName: c.commit.author.name,
          avatarUrl: c.author ? c.author.avatar_url : null
        });
      }
    });

    resultReleases.push({
      version,
      description: release.body || 'No description provided.',
      isLatest: false,
      commits: releaseCommits.slice(0, 15)
    });
  }

  if (resultReleases.length > 0) {
    resultReleases.sort((a, b) => semver.rcompare(a.version, b.version));
    resultReleases[0].isLatest = true;
  } else if (!app.isPackaged && process.env.TEST_UPDATER) {
    resultReleases.push({
      version: "9.9.9",
      description: "Major UI Overhaul and Nebula Theme",
      isLatest: true,
      commits: [
        {
          message: "feat: implemented standalone window config with deep space gradient",
          shortSha: "a1b2c3d",
          authorName: "Developer",
          avatarUrl: "https://avatars.githubusercontent.com/u/9919?s=40&v=4"
        }
      ]
    });
    resultReleases.push({
      version: "1.0.75",
      description: "Previous release",
      isLatest: false,
      commits: [
        {
          message: "chore: update dependencies",
          shortSha: "b2c3d4e",
          authorName: "Maintainer",
          avatarUrl: "https://avatars.githubusercontent.com/u/23213004?v=4"
        }
      ]
    });
  }

  return resultReleases;
}

function createUpdaterWindow(onDismiss) {
  if (updaterWin) return updaterWin;

  updaterWin = new BrowserWindow({
    width: 1000,
    height: 540,
    minWidth: 1000,
    minHeight: 540,
    resizable: false,
    frame: false,
    transparent: false,
    backgroundColor: '#0b0a17',
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'updater-preload.cjs'),
      contextIsolation: true,
    }
  });

  updaterWin.loadFile(path.join(__dirname, '../src/updater/updater.html'));

  // Setup IPC for this specific window instance
  const handleGetReleaseData = () => currentUpdateData;
  const handleDismiss = () => {
    if (updaterWin) {
      updaterWin.close();
    }
  };
  const handleDownload = () => {
    if (app.isPackaged) {
      try {
        autoUpdater.downloadUpdate();
        autoUpdater.on('download-progress', (progressObj) => {
          if (updaterWin) updaterWin.webContents.send('updater-progress', progressObj);
        });
        autoUpdater.on('update-downloaded', () => {
          if (updaterWin) updaterWin.webContents.send('updater-downloaded');
        });
        autoUpdater.on('error', (err) => {
          console.error('[Updater] AutoUpdater error:', err);
          if (updaterWin) updaterWin.webContents.send('updater-error', err.message);
          shell.openExternal(currentUpdateData.downloadUrl);
        });
      } catch (err) {
        shell.openExternal(currentUpdateData.downloadUrl);
      }
    } else {
      let p = 0;
      const int = setInterval(() => {
        p += 5;
        if (updaterWin) updaterWin.webContents.send('updater-progress', { percent: p });
        if (p >= 100) {
          clearInterval(int);
          if (updaterWin) updaterWin.webContents.send('updater-downloaded');
        }
      }, 200);
    }
  };
  const handleInstall = () => {
    if (app.isPackaged) {
      autoUpdater.quitAndInstall();
    } else {
      console.log('[Updater] Install clicked in DEV MODE');
      handleDismiss();
    }
  };

  ipcMain.handle('updater-get-release-data', handleGetReleaseData);
  ipcMain.on('updater-dismiss', handleDismiss);
  ipcMain.on('updater-download', handleDownload);
  ipcMain.on('updater-install', handleInstall);

  updaterWin.on('closed', () => {
    updaterWin = null;
    ipcMain.removeHandler('updater-get-release-data');
    ipcMain.removeAllListeners('updater-dismiss');
    ipcMain.removeAllListeners('updater-download');
    ipcMain.removeAllListeners('updater-install');
    autoUpdater.removeAllListeners('download-progress');
    autoUpdater.removeAllListeners('update-downloaded');
    autoUpdater.removeAllListeners('error');
    if (onDismiss) onDismiss();
  });

  return updaterWin;
}

module.exports = {
  checkForUpdates,
  createUpdaterWindow,
  getReleaseHistory
};
