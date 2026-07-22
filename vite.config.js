import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import crypto from 'crypto'
import os from 'os'
import ffmpegStatic from 'ffmpeg-static'
import NodeID3 from 'node-id3'
import https from 'https'
import { resolveSpotifyMetadata, resolveSpotifyFallback, parseSpotifyEmbed, getAnonymousSpotifyToken } from './src/server/spotify-api.js'
import { configureNewBackend } from './src/server/index.js'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const bundledBinDir = process.env.MEDIADL_BIN_DIR || path.resolve(__dirname, 'bin')
const binPath = path.join(bundledBinDir, 'yt-dlp.exe')
const ffmpegBin = process.env.MEDIADL_BIN_DIR ? path.join(bundledBinDir, 'ffmpeg.exe') : (ffmpegStatic || path.join(bundledBinDir, 'ffmpeg.exe'))
const ffmpegDir = path.dirname(ffmpegBin)

import { getOptimalDownloadConfig } from './src/server/smart-optimizer.js'
import { createBatchEngine, getBatchPerformanceProfile } from './src/server/batch-engine.js'
const aiConfig = getOptimalDownloadConfig()


function isYouTubeUrl(url) {
  return /^(https?:\/\/)?(www\.|music\.)?(youtube\.com|youtu\.be)\/.+/.test(url)
}

function parseYtDlpError(stderr) {
  if (!stderr) return null;
  if (stderr.includes('HTTP Error 429') || stderr.includes('Too Many Requests')) {
    return 'YouTube Rate Limit (Too Many Requests). Încearcă din nou mai târziu sau folosește un VPN.';
  }
  if (stderr.includes('Sign in to confirm you\'re not a bot') || stderr.includes('bot protection')) {
    return 'YouTube a blocat cererea (Protecție Anti-Bot). Este necesar un VPN sau actualizarea cookie-urilor.';
  }
  if (stderr.includes('No space left on device')) {
    return 'Nu mai este spațiu pe disc! Șterge din fișierele descărcate.';
  }
  if (stderr.includes('Video unavailable') || stderr.includes('Private video')) {
    return 'Videoclipul nu este disponibil sau este privat.';
  }
  if (stderr.includes('members on level')) {
    return 'Acest videoclip este disponibil doar pentru membrii canalului.';
  }
  return null;
}

function sanitizeFilename(name) {
  return name
    .replace(/[/\\:*?"<>|]/g, '_')   // illegal on Windows/Linux
    .replace(/\.+$/, '')              // no trailing dots
    .trim()
    .substring(0, 200)               // max 200 chars
}

const configPath = path.resolve(__dirname, 'config.json')

function getConfig() {
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) { }
  }
  return { customPath: '' };
}

function saveConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
}

function ensureDownloadsDir(reqCustomPath) {
  const cfg = getConfig();
  let dir = reqCustomPath || cfg.customPath;
  if (!dir) {
    dir = path.join(__dirname, 'downloads');
  }
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const metrics = {
  uptimeStart: Date.now(),
  totalHits: 0,
  successfulDownloads: 0,
  failedDownloads: 0,
}


const scheduledPath = path.resolve(__dirname, 'scheduled.json')
function getScheduled() {
  if (fs.existsSync(scheduledPath)) {
    try { return JSON.parse(fs.readFileSync(scheduledPath, 'utf8')); } catch (e) { }
  }
  return [];
}
function saveScheduled(jobs) {
  fs.writeFileSync(scheduledPath, JSON.stringify(jobs, null, 2), 'utf8');
}
function addScheduledJob(jobData) {
  const jobs = getScheduled();
  jobs.push({ ...jobData, id: Date.now().toString() });
  saveScheduled(jobs);
}

// Background Cron for Scheduled Jobs
const scheduledJobTimer = setInterval(() => {
  const jobs = getScheduled();
  const now = new Date();
  let changed = false;
  jobs.forEach(job => {
    if (!job.started && job.runAt && new Date(job.runAt) <= now) {
      job.started = true;
      changed = true;
      console.log(`Starting scheduled job: ${job.id}`);

      // Simulate internal API call to start job
      try {
        const jobId = job.id;
        const customPath = urlObj.searchParams.get('customPath')
        const targetDir = ensureDownloadsDir(customPath);
        if (job.type === 'single') {
          // single download logic
          const batchFile = path.join(targetDir, `batch-${jobId}.txt`);
          fs.writeFileSync(batchFile, job.items.join('\n'), 'utf8');
          const args = [
            '--batch-file', batchFile,
            '--paths', targetDir,
            '--embed-metadata',
            '--embed-thumbnail',
          ];
          if (job.format === 'audio') {
            args.push('-x', '--audio-format', job.formatStr.split(':')[0] || 'mp3', '--audio-quality', '0');
          } else {
            args.push('-f', job.formatStr || 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b');
          }
          args.push('-o', '%(title)s.%(ext)s');

          activeJobs.set(jobId, {
            id: jobId, type: 'single', args, clients: new Set(),
            downloadsDir: targetDir,
            state: { progress: 0, status: 'Se pregătește...', currentItem: 0, totalItems: 1 }
          });
          enqueueJob(jobId);
        }
      } catch (err) {
        console.error('Failed to start scheduled job:', err);
      }
    }
  });
  if (changed) saveScheduled(jobs);
}, 60000);
scheduledJobTimer.unref?.();

function createZipFromDirectory(dirPath, zipPath) {
  return new Promise((resolve, reject) => {
    const workerPath = path.resolve(__dirname, 'src/server/zip-worker.cjs');
    const child = spawn('node', [workerPath, dirPath, zipPath]);
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ZIP creation failed (code ${code}): ${stderr.trim()}`));
    });
    child.on('error', reject);
  });
}

function scheduleDownloadCleanup(filePath, delayMs = 15 * 60 * 1000) {
  setTimeout(() => {
    fs.rm(filePath, { recursive: true, force: true }, (err) => {
      if (err) console.error('Cleanup error:', filePath, err)
      else console.log('Auto-cleaned:', filePath)
    })
  }, delayMs)
}

function sendSse(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

const COLLECTION_LIMIT = 5000
const activeJobs = new Map()

// --- Queue Manager Logic ---
const MAX_CONCURRENT_JOBS = 2;
let runningJobsCount = 0;

function processQueue() {
  const queuedJobs = Array.from(activeJobs.entries()).filter(([id, j]) => j.queueStatus === 'queued' && !j.isPaused && !j.isCancelled);

  while (runningJobsCount < MAX_CONCURRENT_JOBS && queuedJobs.length > 0) {
    const [jobId, jobToRun] = queuedJobs.shift();
    jobToRun.queueStatus = 'running';
    runningJobsCount++;
    broadcast(jobId, { queueStatus: 'running' });
    spawnYtDlp(jobId);
  }
}

function enqueueJob(jobId) {
  const job = activeJobs.get(jobId);
  if (!job) return;
  job.queueStatus = 'queued';
  broadcast(jobId, { queueStatus: 'queued' });
  processQueue();
}
// ---------------------------

function broadcast(jobId, data) {
  const job = activeJobs.get(jobId)
  if (!job) return
  Object.assign(job.state, data)
  for (const client of job.clients) {
    try { sendSse(client, data) } catch { /* ignore */ }
  }
}

function finishJob(jobId, data) {
  if (data.error) {
    metrics.failedDownloads++;
  } else {
    metrics.successfulDownloads++;
  }
  const job = activeJobs.get(jobId)
  if (!data.error && job && data.finalFilename) {
    data.jobInfo = {
      title: job.state.title || data.finalFilename,
      thumbnail: job.state.thumbnail,
      format: job.type === 'single' ? (job.state.format || 'unknown') : 'playlist',
      filename: data.finalFilename,
      isArchive: data.isArchive,
      source: 'youtube',
      date: new Date().toISOString(),
      id: Date.now().toString()
    };
  }

  broadcast(jobId, { ...data, done: true })
  if (job) {
    job.clients.forEach(client => client.end())
    job.clients.clear()
    setTimeout(() => activeJobs.delete(jobId), 10 * 60 * 1000)
  }
}

function spawnYtDlp(jobId) {
  const job = activeJobs.get(jobId);
  if (!job) return;

  job.process = spawn(binPath, job.args);
  let settled = false;

  let currentItem = job.state.currentItem || 0;
  let totalItems = job.state.totalItems || (job.type === 'playlist' ? job.expectedCount : 1);
  let finalFilename = job.state.finalFilename || '';

  const onOutput = text => {
    if (job.isPaused || job.isCancelled) return;

    if (job.type === 'playlist') {
      const item = text.match(/Downloading item\s+(\d+)\s+of\s+(\d+)/i)
      const itemProgress = text.match(/\[download\]\s+([\d.]+)%/)
      if (item) {
        currentItem = Number(item[1])
        totalItems = Number(item[2])
      }
      const progress = totalItems
        ? ((currentItem - 1) / totalItems) * 100 + ((itemProgress ? Number(itemProgress[1]) : 0) / totalItems)
        : 0

      broadcast(jobId, {
        progress: Math.min(progress, 95),
        currentItem,
        totalItems,
        status: totalItems ? `Se descarcă piesa ${currentItem} din ${totalItems}` : 'Se pregătește playlistul...'
      })
    } else {
      const destMatch = text.match(/Destination:\s*(.*)/)
      if (destMatch && destMatch[1]) finalFilename = path.basename(destMatch[1].trim())
      const alreadyMatch = text.match(/\]\s+(.*?)\s*has already been downloaded/)
      if (alreadyMatch && alreadyMatch[1]) finalFilename = path.basename(alreadyMatch[1].trim())
      const mergeMatch = text.match(/Merging formats into "(.*)"/)
      if (mergeMatch && mergeMatch[1]) finalFilename = path.basename(mergeMatch[1].trim())
      const progressMatch = text.match(/\[download\]\s+([\d.]+)%/)
      let progress = job.state.progress;
      if (progressMatch) progress = parseFloat(progressMatch[1])

      broadcast(jobId, { raw: text, progress, filename: finalFilename })
    }
  };

  job.process.stdout.on('data', chunk => {
    chunk.toString().split('\n').forEach(line => {
      if (line.trim()) onOutput(line.trim())
    })
  })
  let fullStderr = '';
  job.process.stderr.on('data', chunk => {
    const text = chunk.toString()
    fullStderr += text;
    if (text.includes('[download]')) onOutput(text.trim())
  })

  job.process.on('close', async code => {
    runningJobsCount = Math.max(0, runningJobsCount - 1);
    processQueue();

    if (settled) return;
    settled = true;
    job.process = null;

    if (job.isCancelled) return; // Cleanup already handled
    if (job.isPaused) return; // Just paused, wait for resume

    if (code !== 0) {
      const knownError = parseYtDlpError(fullStderr);
      if (knownError) {
        if (job.collectionDir) {
          try { fs.rmSync(job.collectionDir, { recursive: true, force: true }) } catch { /* ignore */ }
        }
        return finishJob(jobId, { error: knownError });
      }
    }

    if (job.type === 'single') {
      if (code !== 0) {
        finishJob(jobId, { error: 'Eroare la descărcare. Cod: ' + code });
      } else {
        const filePath = path.join(job.downloadsDir, finalFilename)
        scheduleDownloadCleanup(filePath)
        finishJob(jobId, {
          code,
          finalFilename,
          downloadUrl: `/api/download-file?file=${encodeURIComponent(finalFilename)}`
        });
      }
    } else {
      // Playlist completion
      const downloadedFiles = fs.existsSync(job.collectionDir) ? fs.readdirSync(job.collectionDir) : []
      if (downloadedFiles.length === 0) {
        try { fs.rmSync(job.collectionDir, { recursive: true, force: true }) } catch { /* ignore */ }
        finishJob(jobId, { error: 'Nu s-a descărcat niciun fișier. Verifică link-ul.' })
        return
      }

      broadcast(jobId, { progress: 96, status: 'Se configurează folderul...' })
      if (job.state.thumbnail) {
        try {
          const coverRes = await fetch(job.state.thumbnail)
          const coverBuffer = Buffer.from(await coverRes.arrayBuffer())
          const jpgPath = path.join(job.collectionDir, 'folder.jpg')
          fs.writeFileSync(jpgPath, coverBuffer)

          if (process.platform === 'win32') {
            const icoPath = path.join(job.collectionDir, 'album.ico')
            await new Promise((resolve) => {
              const child = spawn(ffmpegBin, ['-y', '-i', jpgPath, '-vf', 'scale=256:256', icoPath])
              child.on('close', () => resolve())
            })

            try { /* keep folder.jpg for library */ } catch { }

            if (fs.existsSync(icoPath)) {
              const iniContent = "[.ShellClassInfo]\r\nIconResource=album.ico,0\r\n[ViewState]\r\nMode=\r\nVid=\r\nFolderType=Music\r\n"
              const iniPath = path.join(job.collectionDir, 'desktop.ini')
              fs.writeFileSync(iniPath, iniContent)

              await new Promise((resolve) => {
                const child = spawn('attrib', ['+s', job.collectionDir])
                child.on('close', () => resolve())
              })
              await new Promise((resolve) => {
                const child = spawn('attrib', ['+s', '+h', iniPath])
                child.on('close', () => resolve())
              })
              spawn('ie4uinit.exe', ['-show'])
              spawn('powershell', ['-Command', '$shell = New-Object -ComObject Shell.Application; $shell.Windows() | ForEach-Object { $_.Refresh() }'])

              const batContent = `@echo off\r\nattrib +s "%~dp0."\r\nattrib +s +h "%~dp0desktop.ini"\r\nie4uinit.exe -show\r\necho Done! Press F5 in File Explorer to see the folder icon.\r\npause\r\n`;
              const batPath = path.join(job.collectionDir, 'ApplyFolderIcon.bat');
              fs.writeFileSync(batPath, batContent);
            }
          }
        } catch (e) {
          console.error('Failed to set youtube playlist thumbnail:', e)
        }
      }
      finishJob(jobId, { progress: 100, finalFilename: path.basename(job.collectionDir), isArchive: false, collectionTitle: job.state.title || path.basename(job.collectionDir) })
    }
  });

  job.process.on('error', error => {
    runningJobsCount = Math.max(0, runningJobsCount - 1);
    processQueue();

    if (settled) return;
    settled = true;
    job.process = null;
    if (job.isCancelled || job.isPaused) return;

    if (job.collectionDir) {
      try { fs.rmSync(job.collectionDir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
    finishJob(jobId, { error: error.message || 'Eroare la descărcare.' })
  });
}

function youtubeDownloaderPlugin() {
  return {
    name: 'youtube-downloader-plugin',
    configureServer(server) {
      configureNewBackend(server);

      // ── API Middleware for Hits ──
      server.middlewares.use('/api/ytdl', (req, res, next) => {
        metrics.totalHits++;
        next();
      })

      // ── Config Endpoints ──
      server.middlewares.use('/api/ytdl/get-config', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(getConfig()))
      })

      server.middlewares.use('/api/ytdl/select-folder', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()

        const psScript = `
          Add-Type -AssemblyName System.windows.forms
          $folderBrowser = New-Object System.Windows.Forms.FolderBrowserDialog
          $folderBrowser.Description = 'Select a folder to save downloads'
          $folderBrowser.ShowNewFolderButton = $true
          if ($folderBrowser.ShowDialog() -eq 'OK') {
              Write-Output $folderBrowser.SelectedPath
          }
        `;

        const child = spawn('powershell', ['-NoProfile', '-Command', psScript])
        let stdout = ''
        child.stdout.on('data', chunk => { stdout += chunk.toString() })

        child.on('close', code => {
          const selected = stdout.trim()
          if (selected) {
            saveConfig({ customPath: selected })
            res.end(JSON.stringify({ success: true, path: selected }))
          } else {
            res.end(JSON.stringify({ success: false }))
          }
        })
      })

      server.middlewares.use('/api/ytdl/open-folder', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()

        const target = urlObj.searchParams.get('target')
        if (target) {
          const dlDir = ensureDownloadsDir(typeof urlObj !== 'undefined' ? (urlObj.searchParams ? urlObj.searchParams.get('customPath') : null) : null);
          let targetPath = path.join(dlDir, target)
          if (!fs.existsSync(targetPath)) {
            const cleanTarget = target.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
            const files = fs.readdirSync(dlDir)
            const fuzzyMatch = files.find(f => f.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === cleanTarget)

            if (fuzzyMatch) {
              targetPath = path.join(dlDir, fuzzyMatch)
            } else {
              res.statusCode = 404;
              return res.end(JSON.stringify({ success: false, error: 'File not found' }));
            }
          }
          spawn('explorer.exe', ['/select,', targetPath])
        } else {
          const customPath = urlObj.searchParams.get('customPath')
          spawn('explorer.exe', [ensureDownloadsDir(customPath)])
        }
        res.end(JSON.stringify({ success: true }))
      })


      // ── Schedule API ──
      server.middlewares.use('/api/ytdl/scheduled', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()

        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(getScheduled().filter(j => !j.started)))
      })

      // ── Active Jobs (queue manager and reconnect) ──
      server.middlewares.use('/api/active-jobs', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()
        const youtube = Array.from(activeJobs.values()).map(job => ({
          id: job.id,
          title: job.state?.title || job.state?.status || 'YouTube download',
          thumbnail: job.state?.thumbnail || null,
          filename: job.state?.finalFilename || null,
          format: job.state?.format || (job.type === 'playlist' ? 'Playlist' : 'Video'),
          percent: Number(job.state?.progress || 0),
          status: job.state?.done ? (job.state?.error ? 'failed' : 'done') : (job.queueStatus === 'queued' ? 'queued' : 'active'),
          error: job.state?.error || null,
        }))
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ youtube, spotify: [] }))
      })

      // ── Job Status Endpoint (for reconnection) ──
      server.middlewares.use('/api/ytdl/job-status', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()

        const jobId = urlObj.searchParams.get('jobId')
        const job = activeJobs.get(jobId)

        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')

        if (!job) {
          sendSse(res, { error: 'Job not found or expired' })
          return res.end()
        }

        job.clients.add(res)
        sendSse(res, job.state) // Send current state immediately

        req.on('close', () => {
          job.clients.delete(res)
        })
      })

      // ── Job Action Endpoint (Pause / Resume / Cancel) ──
      server.middlewares.use('/api/ytdl/job-action', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()

        const jobId = urlObj.searchParams.get('jobId')
        const action = urlObj.searchParams.get('action')
        const job = activeJobs.get(jobId)

        if (!job) {
          res.statusCode = 404
          return res.end(JSON.stringify({ error: 'Job not found' }))
        }

        if (action === 'pause') {
          if (!job.isPaused && !job.state.done && job.process) {
            job.isPaused = true
            job.process.kill()
            broadcast(jobId, { isPaused: true, status: 'Descărcarea a fost pusă pe pauză.' })
          }
        } else if (action === 'resume') {
          if (job.isPaused && !job.state.done) {
            job.isPaused = false
            broadcast(jobId, { isPaused: false, status: 'Se reia descărcarea...' })
            spawnYtDlp(jobId) // Restart process
          }
        } else if (action === 'cancel') {
          job.isCancelled = true
          if (job.process) {
            job.process.kill()
          }
          if (job.collectionDir) {
            try { fs.rmSync(job.collectionDir, { recursive: true, force: true }) } catch { /* ignore */ }
          }
          finishJob(jobId, { error: 'Descărcarea a fost anulată de utilizator.' })
          activeJobs.delete(jobId)
        } else {
          res.statusCode = 400
          return res.end(JSON.stringify({ error: 'Invalid action' }))
        }

        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ success: true }))
      })

      // ── Single video info ──
      server.middlewares.use('/api/ytdl/info', async (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()

        const videoUrl = urlObj.searchParams.get('url')
        if (!videoUrl) {
          res.statusCode = 400
          return res.end(JSON.stringify({ error: 'No URL provided' }))
        }

        if (!fs.existsSync(binPath)) {
          res.statusCode = 500
          return res.end(JSON.stringify({ error: 'yt-dlp binary not found.' }))
        }

        let args = [
          '--dump-json',
          '--no-playlist',
          '--playlist-items', '1',
          videoUrl
        ]

        const cookiesPath = path.resolve(__dirname, 'cookies.txt')
        if (fs.existsSync(cookiesPath)) {
          args.splice(args.length - 1, 0, '--cookies', cookiesPath)
        }

        const child = spawn(binPath, args)
        let dataStr = ''
        let errStr = ''
        child.stdout.on('data', chunk => { dataStr += chunk })
        child.stderr.on('data', chunk => { errStr += chunk })

        const killTimer = setTimeout(() => {
          try { child.kill() } catch { /* ignore */ }
          if (!res.headersSent) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: 'Request timed out. Try again or check the URL.' }))
          }
        }, 30000)

        child.on('close', async code => {
          clearTimeout(killTimer)
          if (res.headersSent) return
          if (code !== 0) {
            console.error('yt-dlp failed:', errStr)
            const knownError = parseYtDlpError(errStr);
            res.statusCode = 500
            return res.end(JSON.stringify({ error: knownError || 'yt-dlp failed to fetch info. Check the URL.', details: errStr }))
          }
          try {
            const info = JSON.parse(dataStr)
            const availableHeights = new Set()
              ; (info.formats || []).forEach(f => {
                if (f.height && f.vcodec && f.vcodec !== 'none') {
                  availableHeights.add(f.height)
                }
              })
            let artistThumbnail = info.channel_thumbnail || info.uploader_thumbnail || info.channel_avatar || info.uploader_avatar || null
            if (!artistThumbnail && (info.channel_url || info.uploader_url)) {
              try {
                const channelResponse = await fetch(info.channel_url || info.uploader_url, {
                  headers: { 'User-Agent': 'Mozilla/5.0' }
                })
                const channelHtml = await channelResponse.text()
                const avatarMatch = channelHtml.match(/"avatar"\s*:\s*\{\s*"thumbnails"\s*:\s*\[\s*\{\s*"url"\s*:\s*"([^"]+)"/i)
                  || channelHtml.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                  || channelHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
                artistThumbnail = avatarMatch?.[1]?.replace(/\\u0026/g, '&').replace(/&amp;/g, '&') || null
              } catch { }
            }
            const isMusic = /music\.youtube\.com/i.test(videoUrl) || /youtube:music|music/i.test(info.extractor_key || '')
            const hasCollection = Boolean(info.playlist_count || info.n_entries || info._type === 'playlist' || info.playlist_id)
            const isBrowseUrl = /\/browse\//i.test(videoUrl);
            const isPlaylistUrl = /[?&]list=/i.test(videoUrl);
            const musicCollection = isMusic && (isBrowseUrl || hasCollection || isPlaylistUrl);
            const contentType = hasCollection || musicCollection
              ? (isMusic ? 'album' : 'playlist')
              : (isMusic ? 'track' : 'video')
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              title: info.title,
              thumbnail: info.thumbnail,
              duration: info.duration,
              uploader: info.uploader || info.channel || null,
              artistThumbnail,
              contentType,
              platform: isMusic ? 'youtube_music' : 'youtube',
              album: info.album || info.playlist_title || null,
              albumArtist: info.album_artist || info.artist || info.uploader || info.channel || null,
              trackNumber: Number(info.track_number || info.playlist_index) || null,
              trackCount: Number(info.playlist_count || info.n_entries) || null,
              releaseYear: info.release_year || (info.release_date ? String(info.release_date).slice(0, 4) : null),
              viewCount: info.view_count || null,
              uploadDate: info.upload_date || null,
              availableHeights: Array.from(availableHeights).sort((a, b) => b - a),
            }))
          } catch (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: 'Failed to parse yt-dlp output' }))
          }
        })
      })

      // ── Single video download ──
      server.middlewares.use('/api/ytdl/smart-download', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end('Method Not Allowed')
        }

        let body = ''
        req.on('data', chunk => { body += chunk.toString() })
        req.on('end', () => {
          try {
            const data = JSON.parse(body)
            const { items, format, scope, title, scheduleTime, formatStr } = data

            if (!items || !items.length) {
              res.statusCode = 400
              return res.end(JSON.stringify({ error: 'No items provided' }))
            }

            if (scheduleTime) {
              const [sh, sm] = scheduleTime.split(':').map(Number);
              let runAt = new Date();
              runAt.setHours(sh, sm, 0, 0);
              if (runAt <= new Date()) runAt.setDate(runAt.getDate() + 1);

              addScheduledJob({ type: 'single', items, format, scope, title, formatStr, runAt: runAt.toISOString() });
              res.setHeader('Content-Type', 'application/json')
              return res.end(JSON.stringify({ scheduled: true, runAt: runAt.toISOString() }))
            }

            const jobId = Date.now().toString()
            const downloadsDir = ensureDownloadsDir(typeof urlObj !== 'undefined' ? (urlObj.searchParams ? urlObj.searchParams.get('customPath') : null) : null)
            const collectionDir = path.join(downloadsDir, `youtube-playlist-${jobId}`)
            const targetDir = scope === 'playlist' ? collectionDir : downloadsDir

            if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true })

            const batchFile = path.join(targetDir, `batch-${jobId}.txt`)
            fs.writeFileSync(batchFile, items.join('\n'), 'utf8')

            let args = []
            if (format === 'audio') {
              args = ['-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', path.join(targetDir, '%(title)s.%(ext)s'), '--ffmpeg-location', ffmpegDir]
            } else {
              args = ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--merge-output-format', 'mp4', '-o', path.join(targetDir, '%(title)s.%(ext)s'), '--ffmpeg-location', ffmpegDir]
            }

            if (format === 'audio') {
              args.push('--ppa', 'ThumbnailsConvertor+ffmpeg_o:-vf crop=min(iw\\\\,ih):min(iw\\\\,ih)')
            }

            args.push(
              '-a', batchFile,
              '--newline',
              '--embed-metadata',
              '--embed-thumbnail',
              '--extractor-args', 'youtube:player_client=web_music,default'
            )

            const cookiesPath = path.resolve(__dirname, 'cookies.txt')
            if (fs.existsSync(cookiesPath)) {
              args.push('--cookies', cookiesPath)
            }

            activeJobs.set(jobId, {
              id: jobId,
              type: scope === 'playlist' ? 'playlist' : 'single',
              args,
              downloadsDir,
              collectionDir: scope === 'playlist' ? collectionDir : undefined,
              batchFile,
              clients: new Set(),
              isPaused: false,
              isCancelled: false,
              state: { progress: 0, status: 'Se pregătește descărcarea inteligentă...', done: false, isPaused: false, totalItems: items.length, title, thumbnail: data.thumbnail }
            })

            spawnYtDlp(jobId)

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ jobId }))
          } catch (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: err.message }))
          }
        })
      })

      server.middlewares.use('/api/ytdl/download', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()

        const jobId = urlObj.searchParams.get('jobId')
        if (!jobId) {
          res.statusCode = 400
          return res.end('Missing jobId')
        }
        if (activeJobs.has(jobId)) {
          res.statusCode = 400
          return res.end('Job already exists. Use /job-status to reconnect.')
        }

        const videoUrl = urlObj.searchParams.get('url')
        const format = urlObj.searchParams.get('format') || 'video:bestvideo[ext=mp4]+bestaudio[ext=m4a]/best'
        const scheduleTime = urlObj.searchParams.get('scheduleTime')
        const title = urlObj.searchParams.get('title') || ''
        const thumbnail = urlObj.searchParams.get('thumbnail') || ''
        const presetStr = urlObj.searchParams.get('preset')
        const preset = presetStr === 'AUTO' ? null : presetStr
        const hwaccel = urlObj.searchParams.get('hwaccel') || 'NONE'
        const aiConfig = getOptimalDownloadConfig(preset)

        if (!videoUrl) {
          res.statusCode = 400
          return res.end('No URL')
        }

        if (scheduleTime) {
          const [sh, sm] = scheduleTime.split(':').map(Number);
          let runAt = new Date();
          runAt.setHours(sh, sm, 0, 0);
          if (runAt <= new Date()) runAt.setDate(runAt.getDate() + 1);

          addScheduledJob({ type: 'single', url: videoUrl, format, scheduleTime, runAt: runAt.toISOString(), title, thumbnail });
          res.setHeader('Content-Type', 'application/json')
          return res.end(JSON.stringify({ scheduled: true }))
        }

        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')

        const customPath = urlObj.searchParams.get('customPath')
        const downloadsDir = ensureDownloadsDir(customPath)
        let args

        if (format.startsWith('audio:')) {
          const parts = format.split(':')
          const audioFmt = parts[1] || 'mp3'
          const audioQuality = parts[2] || '0'
          if (audioFmt === 'wav') {
            args = ['-x', '--audio-format', 'wav', '-o', path.join(downloadsDir, '%(title)s.%(ext)s'), '--ffmpeg-location', ffmpegDir, videoUrl]
          } else if (audioFmt === 'vorbis') {
            args = ['-x', '--audio-format', 'vorbis', '--audio-quality', audioQuality, '-o', path.join(downloadsDir, '%(title)s.%(ext)s'), '--ffmpeg-location', ffmpegDir, videoUrl]
          } else {
            args = ['-x', '--audio-format', 'mp3', '--audio-quality', audioQuality, '-o', path.join(downloadsDir, '%(title)s.%(ext)s'), '--ffmpeg-location', ffmpegDir, videoUrl]
          }
        } else if (format.startsWith('video:')) {
          const formatStr = format.substring(6)
          args = ['-f', formatStr, '--merge-output-format', 'mp4', '-o', path.join(downloadsDir, '%(title)s.%(ext)s'), '--ffmpeg-location', ffmpegDir, videoUrl]
        } else {
          args = ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--merge-output-format', 'mp4', '-o', path.join(downloadsDir, '%(title)s.%(ext)s'), '--ffmpeg-location', ffmpegDir, videoUrl]
        }

        if (format.startsWith('audio:')) {
          args.push('--ppa', 'ThumbnailsConvertor+ffmpeg_o:-vf crop=min(iw\\\\,ih):min(iw\\\\,ih)')
        }

        args.push(
          '--no-playlist',
          '--newline',
          '--embed-metadata',
          '--embed-thumbnail',
          '--extractor-args', 'youtube:player_client=web_music,default',
          '-N', String(aiConfig.ytdlpConcurrentFragments)
        )
        let ffmpegArgs = `-threads ${aiConfig.ffmpegThreads}`
        if (hwaccel !== 'NONE') {
          if (hwaccel === 'AUTO') ffmpegArgs = `-hwaccel auto ` + ffmpegArgs
          else if (hwaccel === 'CUDA') ffmpegArgs = `-hwaccel cuda ` + ffmpegArgs
          else if (hwaccel === 'AMF') ffmpegArgs = `-hwaccel d3d11va ` + ffmpegArgs
          else if (hwaccel === 'QSV') ffmpegArgs = `-hwaccel qsv ` + ffmpegArgs
        }
        args.push('--postprocessor-args', `ffmpeg:${ffmpegArgs}`)

        const cookiesPath = path.resolve(__dirname, 'cookies.txt')
        if (fs.existsSync(cookiesPath)) {
          args.push('--cookies', cookiesPath)
        }

        activeJobs.set(jobId, {
          id: jobId,
          type: 'single',
          args,
          downloadsDir,
          clients: new Set([res]),
          isPaused: false,
          isCancelled: false,
          state: { progress: 0, status: 'Se pregătește descărcarea...', done: false, isPaused: false, title, thumbnail }
        })

        spawnYtDlp(jobId)

        req.on('close', () => {
          const job = activeJobs.get(jobId)
          if (job) job.clients.delete(res)
        })
      })

      // ── Playlist info ──
      server.middlewares.use('/api/ytdl/collection-info', async (req, res, next) => {
        const urlObj = new URL(req.url, 'http://' + req.headers.host)
        if (urlObj.pathname !== '/') return next()
        const videoUrl = urlObj.searchParams.get('url')
        if (!videoUrl || !isYouTubeUrl(videoUrl)) {
          res.statusCode = 400
          return res.end(JSON.stringify({ error: 'Introdu un link valid de YouTube.' }))
        }

        try {
          const playlist = await new Promise((resolve, reject) => {
            let args = [
              '--dump-single-json',
              '--flat-playlist',
              '-i',
              '--playlist-end', String(COLLECTION_LIMIT + 1),
              videoUrl
            ]

            const cookiesPath = path.resolve(__dirname, 'cookies.txt')
            if (fs.existsSync(cookiesPath)) {
              args.splice(args.length - 1, 0, '--cookies', cookiesPath)
            }

            const child = spawn(binPath, args)
            let stdout = ''
            let stderr = ''
            let settled = false
            const timeout = setTimeout(() => {
              if (settled) return
              settled = true
              child.kill()
              reject(new Error('Cererea către YouTube a expirat.'))
            }, 30000)

            child.stdout.on('data', chunk => { stdout += chunk.toString() })
            child.stderr.on('data', chunk => { stderr += chunk.toString() })
            child.on('error', error => {
              if (!settled) {
                settled = true
                clearTimeout(timeout)
                reject(error)
              }
            })
            child.on('close', code => {
              if (settled) return
              settled = true
              clearTimeout(timeout)
              if (code !== 0 && !stdout.trim()) {
                const knownError = parseYtDlpError(stderr.trim());
                return reject(new Error(knownError || stderr.trim() || 'yt-dlp nu a putut citi acest link.'))
              }
              try {
                resolve(JSON.parse(stdout))
              } catch {
                reject(new Error('Nu am putut interpreta răspunsul YouTube.'))
              }
            })
          })

          const entries = (playlist.entries || []).filter(Boolean)
          if (!entries.length && playlist._type !== 'playlist') throw new Error('Acest link nu conține un playlist disponibil.')
          const count = Number(playlist.playlist_count || playlist.n_entries || entries.length)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            title: playlist.title || playlist.playlist_title || 'YouTube Playlist',
            count,
            downloadableCount: Math.min(count || entries.length, COLLECTION_LIMIT),
            isTruncated: count > COLLECTION_LIMIT,
            entries: entries.slice(0, COLLECTION_LIMIT).map((entry, index) => ({
              id: entry.id,
              index: index + 1,
              title: entry.title || 'Video fără titlu',
              uploader: entry.uploader || entry.channel || null,
              duration: entry.duration || null
            }))
          }))
        } catch (error) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: error.message || 'Nu am putut încărca playlistul.' }))
        }
      })

      // ── Playlist download ──
      server.middlewares.use('/api/ytdl/collection-download', (req, res, next) => {
        const urlObj = new URL(req.url, 'http://' + req.headers.host)
        if (urlObj.pathname !== '/') return next()

        const jobId = urlObj.searchParams.get('jobId')
        if (!jobId) {
          res.statusCode = 400
          return res.end('Missing jobId')
        }
        if (activeJobs.has(jobId)) {
          res.statusCode = 400
          return res.end('Job already exists. Use /job-status to reconnect.')
        }

        const videoUrl = urlObj.searchParams.get('url')
        const format = urlObj.searchParams.get('format') || 'video:bestvideo[ext=mp4]+bestaudio[ext=m4a]/best'
        const selectedItems = urlObj.searchParams.get('selectedItems')
        const scheduleTime = urlObj.searchParams.get('scheduleTime')
        const title = urlObj.searchParams.get('title') || ''
        const thumbnail = urlObj.searchParams.get('thumbnail') || ''
        const hwaccel = urlObj.searchParams.get('hwaccel') || 'NONE'

        if (!videoUrl || !isYouTubeUrl(videoUrl) || !selectedItems) {
          res.statusCode = 400
          return res.end('URL invalid sau elemente lipsă.')
        }

        if (scheduleTime) {
          const [sh, sm] = scheduleTime.split(':').map(Number);
          let runAt = new Date();
          runAt.setHours(sh, sm, 0, 0);
          if (runAt <= new Date()) runAt.setDate(runAt.getDate() + 1);

          addScheduledJob({ type: 'playlist', url: videoUrl, format, selectedItems, scheduleTime, runAt: runAt.toISOString(), title, thumbnail });
          res.setHeader('Content-Type', 'application/json')
          return res.end(JSON.stringify({ scheduled: true }))
        }

        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')

        const downloadsDir = ensureDownloadsDir(typeof urlObj !== 'undefined' ? (urlObj.searchParams ? urlObj.searchParams.get('customPath') : null) : null)
        const collectionDir = path.join(downloadsDir, 'youtube-playlist-' + jobId)
        fs.mkdirSync(collectionDir, { recursive: true })
        const outputTemplate = path.join(collectionDir, '%(playlist_index)03d - %(title)s.%(ext)s')
        let args

        if (format.startsWith('audio:')) {
          const parts = format.split(':')
          const audioFormat = ['mp3', 'wav', 'vorbis'].includes(parts[1]) ? parts[1] : 'mp3'
          const audioQuality = /^\d+$/.test(parts[2] || '') ? parts[2] : '0'
          args = ['-x', '--audio-format', audioFormat, '-o', outputTemplate, '--ffmpeg-location', ffmpegDir]
          if (audioFormat !== 'wav') args.splice(3, 0, '--audio-quality', audioQuality)
        } else {
          const videoFormat = format.startsWith('video:') ? format.substring(6) : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
          args = ['-f', videoFormat, '--merge-output-format', 'mp4', '-o', outputTemplate, '--ffmpeg-location', ffmpegDir]
        }

        if (format.startsWith('audio:')) {
          args.push('--ppa', 'ThumbnailsConvertor+ffmpeg_o:-vf crop=min(iw\\\\,ih):min(iw\\\\,ih)')
        }

        args.push(
          '-i',
          '--yes-playlist',
          '--playlist-items', selectedItems,
          '--restrict-filenames',
          '--newline',
          '--embed-metadata',
          '--embed-thumbnail',
          '--extractor-args', 'youtube:player_client=web_music,default',
          '-N', String(aiConfig.ytdlpConcurrentFragments)
        )
        let ffmpegArgsCol = `-threads ${aiConfig.ffmpegThreads}`
        if (hwaccel !== 'NONE') {
          if (hwaccel === 'AUTO') ffmpegArgsCol = `-hwaccel auto ` + ffmpegArgsCol
          else if (hwaccel === 'CUDA') ffmpegArgsCol = `-hwaccel cuda ` + ffmpegArgsCol
          else if (hwaccel === 'AMF') ffmpegArgsCol = `-hwaccel d3d11va ` + ffmpegArgsCol
          else if (hwaccel === 'QSV') ffmpegArgsCol = `-hwaccel qsv ` + ffmpegArgsCol
        }
        args.push('--postprocessor-args', `ffmpeg:${ffmpegArgsCol}`, videoUrl)

        const cookiesPath = path.resolve(__dirname, 'cookies.txt')
        if (fs.existsSync(cookiesPath)) {
          args.splice(args.length - 1, 0, '--cookies', cookiesPath)
        }

        const expectedCount = selectedItems.split(',').length

        activeJobs.set(jobId, {
          id: jobId,
          type: 'playlist',
          args,
          downloadsDir,
          collectionDir,
          expectedCount,
          clients: new Set([res]),
          isPaused: false,
          isCancelled: false,
          state: { progress: 0, status: 'Se pregătește playlistul...', done: false, isPaused: false, title, thumbnail }
        })

        spawnYtDlp(jobId)

        req.on('close', () => {
          const job = activeJobs.get(jobId)
          if (job) job.clients.delete(res)
        })
      })

      // ── Extract Embedded Thumbnail ──
      server.middlewares.use('/api/ytdl/local-thumbnail', (req, res, next) => {
        const urlObj = new URL(req.url, 'http://' + req.headers.host)
        if (urlObj.pathname !== '/') return next()

        const file = urlObj.searchParams.get('file')
        if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) {
          res.statusCode = 400
          return res.end('Invalid filename')
        }

        const filePath = path.join(ensureDownloadsDir(typeof urlObj !== 'undefined' ? (urlObj.searchParams ? urlObj.searchParams.get('customPath') : null) : null), file)
        if (!fs.existsSync(filePath)) {
          res.setHeader('Content-Type', 'image/gif');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
        }

        if (fs.statSync(filePath).isDirectory()) {
          const jpgPath = path.join(filePath, 'folder.jpg');
          if (fs.existsSync(jpgPath)) {
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return fs.createReadStream(jpgPath).pipe(res);
          }
          res.setHeader('Content-Type', 'image/gif');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
        }

        const args = ['-i', filePath, '-map', '0:v', '-c:v', 'copy', '-f', 'image2pipe', '-']
        const proc = spawn(ffmpegBin, args)
        let hasOutput = false;

        proc.stdout.on('data', (chunk) => {
          if (!hasOutput) {
            res.setHeader('Content-Type', 'image/png')
            res.setHeader('Cache-Control', 'public, max-age=86400')
            hasOutput = true;
          }
          res.write(chunk)
        })

        proc.on('close', (code) => {
          if (!hasOutput) {
            res.setHeader('Content-Type', 'image/gif');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
          } else {
            res.end()
          }
        })

        proc.on('error', () => {
          if (!hasOutput) {
            res.statusCode = 500
            res.end('Internal Server Error')
          }
        })
      })

      // ── File download (serves files from downloads dir) ──
      server.middlewares.use('/api/download-file', (req, res, next) => {
        const urlObj = new URL(req.url, 'http://' + req.headers.host)
        if (urlObj.pathname !== '/') return next()

        const file = urlObj.searchParams.get('file')
        if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) {
          res.statusCode = 400
          return res.end('Invalid filename')
        }

        const dlDir = ensureDownloadsDir(typeof urlObj !== 'undefined' ? (urlObj.searchParams ? urlObj.searchParams.get('customPath') : null) : null);
        let targetPath = path.join(dlDir, file);
        if (!fs.existsSync(targetPath)) {
          const cleanTarget = file.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          const files = fs.readdirSync(dlDir);
          const fuzzyMatch = files.find(f => f.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === cleanTarget);

          if (fuzzyMatch) {
            targetPath = path.join(dlDir, fuzzyMatch);
          } else {
            res.statusCode = 404;
            return res.end('File not found or expired');
          }
        }

        const outNameRaw = urlObj.searchParams.get('outName')
        let downloadFilename = path.basename(targetPath)
        if (outNameRaw && outNameRaw.trim()) {
          const cleanName = outNameRaw.trim().replace(/[^a-zA-Z0-9_ .-]/g, '')
          const ext = path.extname(file) || '.mp3'
          downloadFilename = cleanName.endsWith(ext) ? cleanName : `${cleanName}${ext}`
        }

        const stat = fs.statSync(targetPath)
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': stat.size,
          'Content-Disposition': `attachment; filename="${downloadFilename}"`
        })

        const readStream = fs.createReadStream(targetPath)
        readStream.pipe(res)
        readStream.on('end', () => {
          scheduleDownloadCleanup(targetPath, 60 * 60 * 1000)
        })
        readStream.on('error', (err) => {
          if (!res.headersSent) {
            res.statusCode = 500
            res.end('Error reading file')
          }
        })
      })

      // ── System Status Endpoint ──
      server.middlewares.use('/api/ytdl/system-status', (req, res, next) => {
        const urlObj = new URL(req.url, 'http://' + req.headers.host)
        if (urlObj.pathname !== '/') return next()

        try {
          const downloadsDir = ensureDownloadsDir(typeof urlObj !== 'undefined' ? (urlObj.searchParams ? urlObj.searchParams.get('customPath') : null) : null)
          const stat = fs.statfsSync(downloadsDir)
          const freeSpaceBytes = stat.bfree * stat.bsize

          const totalMem = os.totalmem()
          const freeMem = os.freemem()

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            freeSpace: freeSpaceBytes,
            totalMem,
            freeMem,
            activeJobs: activeJobs.size,
            uptime: Date.now() - metrics.uptimeStart,
            totalHits: metrics.totalHits,
            successfulDownloads: metrics.successfulDownloads,
            failedDownloads: metrics.failedDownloads
          }))
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'Failed to retrieve system status' }))
        }
      })

      function parseJsonBody(req) {
        return new Promise((resolve) => {
          let body = ''
          req.on('data', chunk => body += chunk.toString())
          req.on('end', () => {
            try { resolve(JSON.parse(body || '{}')) }
            catch { resolve({}) }
          })
        })
      }

      server.middlewares.use('/api/audio-cutter/select-source', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()
        const psScript = `
          Add-Type -AssemblyName System.Windows.Forms
          $dialog = New-Object System.Windows.Forms.OpenFileDialog
          $dialog.Title = 'Select audio file to cut'
          $dialog.Filter = 'Audio files|*.mp3;*.m4a;*.aac;*.wav;*.flac;*.ogg;*.opus;*.webm|All files|*.*'
          if ($dialog.ShowDialog() -eq 'OK') { Write-Output $dialog.FileName }
        `
        const child = spawn('powershell', ['-NoProfile', '-Command', psScript], { windowsHide: true })
        let stdout = ''
        child.stdout.on('data', chunk => { stdout += chunk.toString() })
        child.on('close', () => {
          const sourcePath = stdout.trim()
          if (!sourcePath) return res.end(JSON.stringify({ success: false }))
          if (!fs.existsSync(sourcePath)) {
            res.statusCode = 404
            return res.end(JSON.stringify({ error: 'Selected file no longer exists.' }))
          }
          const probe = spawn(ffmpegBin, ['-i', sourcePath], { windowsHide: true })
          let stderr = ''
          probe.stderr.on('data', chunk => { stderr += chunk.toString() })
          probe.on('close', () => {
            const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
            const duration = durationMatch ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]) : 0
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              success: true,
              path: sourcePath,
              name: path.basename(sourcePath),
              extension: path.extname(sourcePath).slice(1),
              duration
            }))
          })
        })
      })

      server.middlewares.use('/api/audio-cutter/cut', async (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end(JSON.stringify({ error: 'Method not allowed.' }))
        }
        const body = await parseJsonBody(req)
        const sourcePath = typeof body.sourcePath === 'string' ? body.sourcePath : ''
        const start = Number(body.start)
        const end = Number(body.end)
        const format = ['mp3', 'm4a', 'wav', 'flac'].includes(body.format) ? body.format : 'mp3'
        const outputName = sanitizeFilename(String(body.outputName || 'audio-clip')).replace(/\.[^.]+$/, '') || 'audio-clip'
        const allowedExtensions = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus', '.webm'])
        if (!sourcePath || !allowedExtensions.has(path.extname(sourcePath).toLowerCase()) || !fs.existsSync(sourcePath)) {
          res.statusCode = 400
          return res.end(JSON.stringify({ error: 'Choose a valid local audio file.' }))
        }
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
          res.statusCode = 400
          return res.end(JSON.stringify({ error: 'The selected time range is invalid.' }))
        }
        const filename = `${outputName}-${Date.now()}.${format}`
        const outputPath = path.join(ensureDownloadsDir(typeof urlObj !== 'undefined' ? (urlObj.searchParams ? urlObj.searchParams.get('customPath') : null) : null), filename)
        const codecArgs = format === 'mp3' ? ['-codec:a', 'libmp3lame', '-q:a', '0'] : format === 'm4a' ? ['-codec:a', 'aac', '-b:a', '256k'] : format === 'flac' ? ['-codec:a', 'flac'] : ['-codec:a', 'pcm_s16le']
        const args = ['-y', '-ss', String(start), '-to', String(end), '-i', sourcePath, '-map_metadata', '0', '-vn', ...codecArgs, outputPath]
        const proc = spawn(ffmpegBin, args, { windowsHide: true })
        let stderr = ''
        proc.stderr.on('data', chunk => { stderr += chunk.toString() })
        proc.on('error', error => {
          res.statusCode = 500
          res.end(JSON.stringify({ error: `Could not start FFmpeg: ${error.message}` }))
        })
        proc.on('close', code => {
          if (code !== 0 || !fs.existsSync(outputPath)) {
            res.statusCode = 500
            return res.end(JSON.stringify({ error: `FFmpeg could not create the clip: ${stderr.slice(-400)}` }))
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ success: true, filename, title: outputName }))
        })
      })

      // ── Audio Cutter: Stream local file to browser (for Web Audio API waveform) ──
      server.middlewares.use('/api/audio-cutter/stream', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()

        const filePath = urlObj.searchParams.get('path')
        if (!filePath) { res.statusCode = 400; return res.end('Missing path') }

        const allowedExts = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus', '.webm', '.wma'])
        const ext = path.extname(filePath).toLowerCase()
        if (!allowedExts.has(ext) || !fs.existsSync(filePath)) {
          res.statusCode = 403; return res.end('Forbidden or not found')
        }

        const mimeMap = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.webm': 'audio/webm', '.wma': 'audio/x-ms-wma' }
        const stat = fs.statSync(filePath)
        res.setHeader('Content-Type', mimeMap[ext] || 'audio/mpeg')
        res.setHeader('Content-Length', stat.size)
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Cache-Control', 'no-cache')
        fs.createReadStream(filePath).pipe(res)
      })

      // ── Audio Cutter: Export with full FFmpeg filtergraph ──
      server.middlewares.use('/api/audio-cutter/export', async (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'Method not allowed.' })) }

        const body = await parseJsonBody(req)
        const sourcePath = typeof body.sourcePath === 'string' ? body.sourcePath : ''
        const start = Number(body.start) || 0
        const end = Number(body.end)
        const format = ['mp3', 'm4a', 'wav', 'flac'].includes(body.format) ? body.format : 'mp3'
        const outputName = sanitizeFilename(String(body.outputName || 'audio-clip')).replace(/\.[^.]+$/, '') || 'audio-clip'
        const fadeIn = Math.max(0, Number(body.fadeIn) || 0)
        const fadeOut = Math.max(0, Number(body.fadeOut) || 0)
        const volume = Number(body.volume) || 0   // dB
        const speed = Math.min(2.0, Math.max(0.5, Number(body.speed) || 1.0))
        const normalize = Boolean(body.normalize)
        const meta = body.metadata || {}

        const allowedExts = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus', '.webm'])
        if (!sourcePath || !allowedExts.has(path.extname(sourcePath).toLowerCase()) || !fs.existsSync(sourcePath)) {
          res.statusCode = 400; return res.end(JSON.stringify({ error: 'Choose a valid local audio file.' }))
        }
        if (!Number.isFinite(end) || end <= start) {
          res.statusCode = 400; return res.end(JSON.stringify({ error: 'Invalid trim range.' }))
        }

        const duration = end - start

        // Build audio filter chain
        const filters = []
        if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`)
        if (fadeOut > 0) {
          const foStart = Math.max(0, duration - fadeOut)
          filters.push(`afade=t=out:st=${foStart.toFixed(3)}:d=${fadeOut.toFixed(3)}`)
        }
        if (volume !== 0) filters.push(`volume=${volume}dB`)
        if (speed !== 1.0) filters.push(`atempo=${speed.toFixed(4)}`)
        if (normalize) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11')

        // Codec args
        const codecArgs = format === 'mp3'
          ? ['-codec:a', 'libmp3lame', '-q:a', '0']
          : format === 'm4a' ? ['-codec:a', 'aac', '-b:a', '256k']
          : format === 'flac' ? ['-codec:a', 'flac']
          : ['-codec:a', 'pcm_s16le']

        const filename = `${outputName}-${Date.now()}.${format}`
        const outputPath = path.join(ensureDownloadsDir(typeof urlObj !== 'undefined' ? (urlObj.searchParams ? urlObj.searchParams.get('customPath') : null) : null), filename)

        const args = ['-y', '-ss', String(start), '-i', sourcePath, '-t', String(duration), '-map_metadata', '0', '-vn']
        if (filters.length > 0) args.push('-af', filters.join(','))
        args.push(...codecArgs)
        // Metadata tags
        if (meta.title) args.push('-metadata', `title=${meta.title}`)
        if (meta.artist) args.push('-metadata', `artist=${meta.artist}`)
        if (meta.album) args.push('-metadata', `album=${meta.album}`)
        if (meta.track) args.push('-metadata', `track=${meta.track}`)
        args.push('-id3v2_version', '3', outputPath)

        const proc = spawn(ffmpegBin, args, { windowsHide: true })
        let stderr = ''
        proc.stderr.on('data', chunk => { stderr += chunk.toString() })
        proc.on('error', err => { if (!res.headersSent) { res.statusCode = 500; res.end(JSON.stringify({ error: `FFmpeg failed: ${err.message}` })) } })
res.end(JSON.stringify({ success: true, filename, title: outputName }))
        })
      })

      let pendingSpotifyToken = null;

      // ── Spotify Browser Auth Callback ──
      server.middlewares.use('/api/spotify-callback', async (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()

        const code = urlObj.searchParams.get('code')
        if (!code) {
          res.statusCode = 400
          return res.end('Missing code parameter')
        }

        const clientId = process.env.VITE_SPOTIFY_CLIENT_ID;
        const clientSecret = process.env.VITE_SPOTIFY_CLIENT_SECRET;
        const redirectUri = `http://127.0.0.1:5174/api/spotify-callback`;

        if (!clientId || !clientSecret) {
           res.statusCode = 500;
           return res.end('Missing Spotify credentials in .env');
        }

        try {
          const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
            },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              redirect_uri: redirectUri
            })
          })

          const data = await tokenRes.json()
          if (!tokenRes.ok) throw new Error(data.error_description || data.error || 'Token fetch failed')

          pendingSpotifyToken = data;

          res.setHeader('Content-Type', 'text/html')
          res.end(`<html>
            <body style="background:#080a0f;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
              <div style="text-align:center;">
                <svg viewBox="0 0 24 24" fill="#1DB954" width="64" height="64" style="margin-bottom:1rem;"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
                <h1 style="color:#1DB954;margin:0;">Spotify Connected!</h1>
                <p style="color:#94a3b8;margin-top:0.5rem;">Authentication successful. You can safely close this tab and return to MediaDL.</p>
                <script>setTimeout(() => window.close(), 3000)</script>
              </div>
            </body>
          </html>`)
        } catch (err) {
          res.statusCode = 500
          res.end(`<html><body style="background:#080a0f;color:#fff;font-family:sans-serif;padding:2rem;"><h1>Error</h1><p>${err.message}</p></body></html>`)
        }
      })

      // ── Spotify Polling Status ──
      server.middlewares.use('/api/spotify-status', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()

        res.setHeader('Content-Type', 'application/json')
        if (pendingSpotifyToken) {
          const data = { ...pendingSpotifyToken }
          pendingSpotifyToken = null; // consume
          res.end(JSON.stringify({ success: true, data }))
        } else {
          res.end(JSON.stringify({ success: false }))
        }
      })

      // ── Spotify OAuth Token Refresh ──
      server.middlewares.use('/api/spotify-refresh', async (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()

        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end(JSON.stringify({ error: 'Method not allowed' }))
        }

        const clientId = req.headers['x-spotify-client-id']
        const clientSecret = req.headers['x-spotify-client-secret']

        const body = await parseJsonBody(req)
        const { refresh_token } = body

        if (!refresh_token || !clientId || !clientSecret) {
          res.statusCode = 400
          return res.end(JSON.stringify({ error: 'Missing parameters' }))
        }

        try {
          const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
            },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token
            })
          })

          const data = await tokenRes.json()
          if (!tokenRes.ok) throw new Error(data.error_description || data.error || 'Token refresh failed')

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(data))
        } catch (err) {
          console.error('Spotify OAuth refresh error:', err)
          res.statusCode = 500
          res.end(JSON.stringify({ error: err.message }))
        }
      })
      function isGoodMatch(spotifyArtist, returnedArtist) {
        if (!spotifyArtist || !returnedArtist) return false
        const a = spotifyArtist.toLowerCase().trim()
        const b = returnedArtist.toLowerCase().trim()
        if (a.includes(b) || b.includes(a)) return true
        const wordsA = a.split(/\s+/)
        const wordsB = b.split(/\s+/)
        const shared = wordsA.filter(w => w.length > 3 && wordsB.includes(w))
        return shared.length > 0
      }

      function httpsGet(url) {
        return new Promise((resolve, reject) => {
          https.get(url, (res) => {
            let body = ''
            res.on('data', chunk => body += chunk)
            res.on('end', () => {
              try { resolve(JSON.parse(body)) } catch (e) { resolve({}) }
            })
          }).on('error', reject)
        })
      }

      async function fetchItunesMetadata(title, artist) {
        try {
          const query = encodeURIComponent(`${title} ${artist}`)
          const url = `https://itunes.apple.com/search?term=${query}&entity=song&limit=5&country=US`
          const data = await httpsGet(url)
          const results = data.results || []

          for (const result of results) {
            if (isGoodMatch(artist, result.artistName)) {
              return {
                title: result.trackName,
                artist: result.artistName,
                album: result.collectionName,
                year: result.releaseDate?.substring(0, 4) || '',
                coverUrl: result.artworkUrl100?.replace('100x100bb', '640x640bb') || null,
                source: 'itunes'
              }
            }
          }
        } catch { }
        return null
      }

      async function fetchYouTubeMusicMetadata(title, artist) {
        const query = `${title} ${artist} Topic`
        return new Promise((resolve) => {
          const proc = spawn(binPath, [
            '--dump-json',
            '--no-playlist',
            '--no-warnings',
            `ytsearch1:${query}`
          ], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })

          let stdout = ''
          proc.stdout.on('data', c => stdout += c.toString())
          proc.on('close', () => {
            try {
              const info = JSON.parse(stdout)
              const uploader = info.uploader || info.channel || ''
              if (!isGoodMatch(artist, uploader.replace(' - Topic', ''))) {
                return resolve(null)
              }
              resolve({
                title: info.title,
                artist: artist,
                album: info.album || '',
                year: info.release_year?.toString() || info.upload_date?.substring(0, 4) || '',
                coverUrl: info.thumbnail || null,
                source: 'youtube_music'
              })
            } catch {
              resolve(null)
            }
          })
          proc.on('error', () => resolve(null))
          setTimeout(() => { try { proc.kill() } catch { } resolve(null) }, 10000)
        })
      }

      // The resolvePublicPlaylist function and fallback were removed because 
      // the Spotify anonymous token endpoint now returns 403 Forbidden for all requests, 
      // and the embed scraper is broken. All metadata fetching now goes through 
      // resolveSpotifyMetadata (OAuth or Client Credentials).

      server.middlewares.use('/api/spotify-mass-fetch', async (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()

        const spotUrl = urlObj.searchParams.get('url')
        if (!spotUrl) {
          res.statusCode = 400
          return res.end(JSON.stringify({ error: 'Missing url param' }))
        }

        const clientId = req.headers['x-spotify-client-id']
        const clientSecret = req.headers['x-spotify-client-secret']
        const accessToken = req.headers['x-spotify-access-token']

        try {
          res.setHeader('Content-Type', 'application/json')
          let metadata = await resolveSpotifyMetadata(spotUrl, clientId, clientSecret, accessToken)

          const concurrency = 20;
          for (let i = 0; i < metadata.tracks.length; i += concurrency) {
            const chunk = metadata.tracks.slice(i, i + concurrency);
            await Promise.all(chunk.map(async (track, idx) => {
              const actualIdx = i + idx;
              let source = 'spotify';
              const hasIncomplete = !track.coverUrl || !track.album || !track.year || !track.durationMs;

              if (hasIncomplete) {
                // Per-track strategy: iTunes first, YTM as fallback
                const itunesData = await fetchItunesMetadata(track.title, track.artist);
                if (itunesData) {
                  track.album = track.album || itunesData.album;
                  track.year = track.year || itunesData.year;
                  track.coverUrl = track.coverUrl || itunesData.coverUrl;
                  source = 'itunes';
                } else {
                  const ytmData = await fetchYouTubeMusicMetadata(track.title, track.artist);
                  if (ytmData) {
                    track.album = track.album || ytmData.album;
                    track.year = track.year || ytmData.year;
                    track.coverUrl = track.coverUrl || ytmData.coverUrl;
                    source = 'youtube_music';
                  }
                }
              }
              track.metadataSource = source;
              track.index = actualIdx + 1;
              track.searchRoute = actualIdx < 100 ? 'spotify' : 'youtube_music';
            }));
          }

          res.end(JSON.stringify({
            playlistId: metadata.spotifyId,
            playlistName: metadata.title,
            playlistCover: metadata.coverUrl,
            owner: metadata.owner || 'Unknown',
            totalTracks: metadata.tracks.length,
            tracks: metadata.tracks
          }))
        } catch (err) {
          // If Spotify API returns 403 (private playlist or expired token),
          // fall back to public page scraping — same as /api/spotify-info does.
          if (/^SPOTIFY_403/.test(err?.message || '') && /spotify\.com\/playlist\//.test(spotUrl)) {
            try {
              console.log('[mass-fetch] 403 on API → trying public playlist fallback')
              const pubMetadata = await resolvePublicPlaylist(spotUrl)
              pubMetadata.tracks.forEach((t, i) => { t.index = i + 1; t.metadataSource = 'spotify-public'; })
              return res.end(JSON.stringify({
                playlistId: null,
                playlistName: pubMetadata.title,
                playlistCover: pubMetadata.coverUrl,
                owner: 'Unknown',
                totalTracks: pubMetadata.tracks.length,
                tracks: pubMetadata.tracks,
                _usedPublicFallback: true
              }))
            } catch (pubErr) {
              console.error('[mass-fetch] Public fallback also failed:', pubErr.message)
              // Public fallback failed — playlist is truly private
              res.statusCode = 403
              return res.end(JSON.stringify({ error: 'SPOTIFY_403: Playlist privat. Te autentifică prin "My Profile" cu un cont Spotify care are acces la acest playlist.' }))
            }
          }
          console.error('Mass fetch error:', err)
          res.statusCode = 500
          res.end(JSON.stringify({ error: err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err)) }))
        }
      })

      // Legacy endpoints /api/spotify-mass-download and /api/spotify-mass-cancel were moved to src/server/index.js

      // resolvePublicPlaylist is now defined above (before spotify-mass-fetch middleware)

      // ════════════════════════════════════════════════════════════════════════
      // ── MASS DOWNLOADER: New standalone panel endpoints ──────────────────
      // ════════════════════════════════════════════════════════════════════════

      // In-memory URL metadata cache (LRU-style, max 500 entries, 24h TTL)
      const urlMetaCache = new Map() // key: url → { data, timestamp }
      const URL_CACHE_TTL = 24 * 60 * 60 * 1000
      const URL_CACHE_MAX = 500
      function cacheGet(url) {
        const entry = urlMetaCache.get(url)
        if (!entry) return null
        if (Date.now() - entry.timestamp > URL_CACHE_TTL) { urlMetaCache.delete(url); return null }
        return entry.data
      }
      function cacheSet(url, data) {
        if (urlMetaCache.size >= URL_CACHE_MAX) {
          const firstKey = urlMetaCache.keys().next().value
          urlMetaCache.delete(firstKey)
        }
        urlMetaCache.set(url, { data, timestamp: Date.now() })
      }

      // ── /api/mass/ytdl-playlist-info — YouTube playlist → flat track list ──
      server.middlewares.use('/api/mass/ytdl-playlist-info', async (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()

        const playlistUrl = urlObj.searchParams.get('url')
        if (!playlistUrl) {
          res.statusCode = 400; return res.end(JSON.stringify({ error: 'Missing url param' }))
        }

        const cached = cacheGet(playlistUrl)
        if (cached) {
          res.setHeader('Content-Type', 'application/json')
          return res.end(JSON.stringify({ ...cached, _cached: true }))
        }

        try {
          const ytDlpPath = path.resolve(__dirname, 'bin', 'yt-dlp.exe')
          const args = [
            '--flat-playlist',
            '--dump-json',
            '--no-warnings',
            '--playlist-end', '2000',
            playlistUrl
          ]
          const proc = spawn(ytDlpPath, args, {
            env: { ...process.env, PYTHONIOENCODING: 'utf-8', PATH: `${path.resolve(__dirname, 'bin')}${path.delimiter}${process.env.PATH}` },
            windowsHide: true
          })

          let stdout = ''
          let stderr = ''
          proc.stdout.on('data', c => { stdout += c.toString() })
          proc.stderr.on('data', c => { stderr += c.toString() })
          proc.on('close', code => {
            if (code !== 0 && !stdout.trim()) {
              res.statusCode = 500
              return res.end(JSON.stringify({ error: `yt-dlp failed (${code}): ${stderr.slice(0, 300)}` }))
            }
            const items = []
            let playlistTitle = ''
            for (const line of stdout.split('\n')) {
              if (!line.trim()) continue
              try {
                const j = JSON.parse(line)
                if (!playlistTitle && j.playlist_title) playlistTitle = j.playlist_title
                items.push({
                  id: j.id,
                  url: j.url || `https://www.youtube.com/watch?v=${j.id}`,
                  title: j.title || j.id,
                  channel: j.channel || j.uploader || '',
                  duration: j.duration || 0,
                  thumbnail: j.thumbnails?.[0]?.url || j.thumbnail || null,
                  durationMs: (j.duration || 0) * 1000
                })
              } catch { }
            }
            const result = { title: playlistTitle || 'YouTube Playlist', totalItems: items.length, items }
            cacheSet(playlistUrl, result)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(result))
          })
          proc.on('error', err => {
            res.statusCode = 500; res.end(JSON.stringify({ error: err.message }))
          })
        } catch (err) {
          res.statusCode = 500; res.end(JSON.stringify({ error: err.message }))
        }
      })

      // ── /api/mass/start-ytdl — SSE: Download a list of resolved YT items ──
      // Reuses the same infrastructure as spotify-mass-download but accepts plain yt-dlp items
      server.middlewares.use('/api/mass/start-ytdl', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()

        const downloadId = urlObj.searchParams.get('downloadId')
        if (!downloadId) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Missing downloadId' })) }

        const formatStr = urlObj.searchParams.get('format') || 'mp3'
        const requestedConcurrency = Math.min(24, Math.max(1, parseInt(urlObj.searchParams.get('concurrency') || '3', 10)))
        const speedMode = urlObj.searchParams.get('speedMode') === 'MAXIMUM' ? 'MAXIMUM' : 'BALANCED'
        const profile = getBatchPerformanceProfile(requestedConcurrency, speedMode)
        const splitEvery = parseInt(urlObj.searchParams.get('splitEvery') || '0', 10)
        const outputZip = urlObj.searchParams.get('outputZip') !== 'false'
        const namingTpl = urlObj.searchParams.get('naming') || '{track_number} - {artist} - {title}'

        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')
        const send = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch { } }

        const dlState = { cancelled: false, paused: false, procs: new Set() }
        let batchControls = null

        const runDownload = async (bodyData) => {
          const items = (bodyData?.items || []).map((item, i) => ({ ...item, index: item.index || i + 1 }))
          if (items.length === 0) { send({ done: true, error: 'No items provided' }); return res.end() }

          const playlistName = sanitizeFilename(bodyData?.playlistName || 'mass-download') || 'mass-download'
          const downloadsDir = ensureDownloadsDir(typeof urlObj !== 'undefined' ? (urlObj.searchParams ? urlObj.searchParams.get('customPath') : null) : null)
          const tempDir = path.join(downloadsDir, `mass-ytdl-${playlistName}-${downloadId}`)
          fs.mkdirSync(tempDir, { recursive: true })

          send({ current: 0, total: items.length, status: `Starting ${items.length} tracks with ${profile.concurrency} workers, ${profile.fragments} fragments, and ${profile.ffmpegThreads} FFmpeg threads per worker…`, performanceProfile: profile })

          let completedCount = 0
          let failedCount = 0
          const startTimes = []
          const completedFiles = [] // [{index, filePath}]

          const downloadItem = async (item, i, context) => {
            if (dlState.cancelled) return { ok: false, error: 'Download cancelled' }
            // Pause loop
            while (dlState.paused && !dlState.cancelled) {
              await new Promise(r => setTimeout(r, 500))
            }
            if (dlState.cancelled) return

            const safeArtist = (item.artist || item.channel || 'Unknown').replace(/[<>:"/\\|?*]+/g, '_')
            const safeTitle = (item.title || 'Unknown').replace(/[<>:"/\\|?*]+/g, '_')
            const paddedIdx = String(i + 1).padStart(4, '0')

            // Build filename from naming template
            const tplName = namingTpl
              .replace('{track_number}', paddedIdx)
              .replace('{artist}', safeArtist)
              .replace('{title}', safeTitle)
              .replace('{year}', item.year || '')
              .replace('{album}', item.album || '')
              .replace(/[<>:"/\\|?*]+/g, '_')
              .replace(/\.+$/, '')

            const outputTemplate = path.join(tempDir, `${tplName}.%(ext)s`)
            const trackStartTime = Date.now()

            send({
              current: completedCount + failedCount + 1,
              total: items.length,
              percent: Math.round(((completedCount + failedCount) / items.length) * 100),
              title: item.title,
              artist: item.artist || item.channel || '',
              coverUrl: item.thumbnail || null
            })

            const ytDlpPath = path.resolve(__dirname, 'bin', 'yt-dlp.exe')
            let failureDetails = ''
            const ok = await new Promise((resolve) => {
              const args = [
                item.url,
                '-x', '--audio-format', formatStr,
                '--audio-quality', '0',
                '-o', outputTemplate,
                '--no-playlist',
                '--ffmpeg-location', ffmpegDir,
                '-N', String(profile.fragments),
                '--postprocessor-args', `ffmpeg:-threads ${profile.ffmpegThreads}`,
                '--no-warnings'
              ]
              const proc = spawn(ytDlpPath, args, {
                env: { ...process.env, PYTHONIOENCODING: 'utf-8', PATH: `${path.resolve(__dirname, 'bin')}${path.delimiter}${process.env.PATH}` },
                windowsHide: true
              })
              dlState.procs.add(proc)
              context?.registerProcess(proc)
              let stderr = ''
              proc.stderr.on('data', chunk => {
                const line = chunk.toString()
                stderr += line
                // Stream log lines to frontend
                for (const l of line.split('\n')) {
                  if (l.trim()) send({ logLine: l.trim() })
                }
              })
              proc.on('close', code => {
                dlState.procs.delete(proc)
                context?.unregisterProcess(proc)
                failureDetails = stderr
                resolve(code === 0)
              })
              proc.on('error', error => {
                dlState.procs.delete(proc)
                context?.unregisterProcess(proc)
                failureDetails = error.message
                resolve(false)
              })
            })

            if (ok) {
              // Find the downloaded file
              const AUDIO_EXTS = new Set(['mp3', 'ogg', 'wav', 'flac', 'm4a', 'opus', 'aac'])
              const files = fs.readdirSync(tempDir).filter(f => AUDIO_EXTS.has(f.split('.').pop().toLowerCase()))
              const justAdded = files.find(f => f.startsWith(tplName.slice(0, 40)))
              if (justAdded) completedFiles.push({ index: i, filePath: path.join(tempDir, justAdded) })
              completedCount++
              startTimes.push(Date.now() - trackStartTime)
              if (startTimes.length > 10) startTimes.shift()
              return { ok: true, output: justAdded || null }
            }
            failedCount++
            return { ok: false, error: failureDetails || `yt-dlp exited with an error for ${item.title || 'item'}` }
          }

          const jobsDirectory = path.join(downloadsDir, '.mediadl-jobs')
          const batch = createBatchEngine({
            jobsDirectory,
            jobId: downloadId,
            items,
            profile,
            onEvent: event => send({ ...event, percent: Math.round(((event.completedCount + event.failedCount) / items.length) * 100) })
          })
          batchControls = batch.controls
          activeMassYtdlDownloads.set(downloadId, batchControls)
          await batch.run((entry, context) => downloadItem(entry.item, entry.index, context))
          activeMassYtdlDownloads.delete(downloadId)
          dlState.cancelled = batchControls.state().cancelled
          completedCount = batchControls.state().completedCount
          failedCount = batchControls.state().failedCount

          if (dlState.cancelled) {
            try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch { }
            send({ done: true, cancelled: true })
            return res.end()
          }

          // ZIP output
          if (outputZip) {
            if (splitEvery > 0 && items.length > splitEvery) {
              // Split ZIP into parts
              const allFiles = fs.readdirSync(tempDir).map(f => ({ name: f, full: path.join(tempDir, f) }))
              const parts = []
              for (let p = 0; p * splitEvery < allFiles.length; p++) {
                const chunk = allFiles.slice(p * splitEvery, (p + 1) * splitEvery)
                const partName = `${playlistName}-Part${p + 1}.zip`
                const partPath = path.join(downloadsDir, partName)
                // Build a temp dir for this chunk
                const chunkDir = path.join(downloadsDir, `chunk-${p}-${downloadId}`)
                fs.mkdirSync(chunkDir, { recursive: true })
                for (const f of chunk) {
                  try { fs.copyFileSync(f.full, path.join(chunkDir, f.name)) } catch { }
                }
                await createZipFromDirectory(chunkDir, partPath)
                try { fs.rmSync(chunkDir, { recursive: true, force: true }) } catch { }
                parts.push(partName)
              }
              try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch { }
              send({ done: true, completedCount, failedCount, zipParts: parts })
            } else {
              const zipFilename = `${playlistName}-${downloadId}.zip`
              const zipPath = path.join(downloadsDir, zipFilename)
              send({ status: 'Creating ZIP…' })
              await createZipFromDirectory(tempDir, zipPath)
              try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch { }
              send({ done: true, completedCount, failedCount, zipPath: zipFilename })
            }
          } else {
            send({ done: true, completedCount, failedCount, outputDir: tempDir })
          }
          res.end()
        }

        req.on('aborted', () => {
          dlState.cancelled = true
          if (batchControls) batchControls.cancel()
          else for (const proc of dlState.procs) { try { proc.kill() } catch { } }
        })

        const parsedBody = req.method === 'POST' ? parseJsonBody(req) : Promise.resolve(null)
        parsedBody.then(body => {
          runDownload(body).catch(err => {
            send({ done: true, error: err.message }); res.end()
          })
        })
      })

      // ── /api/mass/cancel — Cancel a ytdl mass download ──
      const activeMassYtdlDownloads = new Map()
      server.middlewares.use('/api/mass/cancel', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()
        const downloadId = urlObj.searchParams.get('downloadId')
        if (downloadId && activeMassYtdlDownloads.has(downloadId)) {
          activeMassYtdlDownloads.get(downloadId).cancel()
        }
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ success: true }))
      })

      server.middlewares.use('/api/spotify-info', async (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()
        const spotUrl = urlObj.searchParams.get('url')
        const clientId = req.headers['x-spotify-client-id']
        const clientSecret = req.headers['x-spotify-client-secret']
        const accessToken = req.headers['x-spotify-access-token']

        if (!spotUrl) {
          res.statusCode = 400
          return res.end(JSON.stringify({ error: 'Missing url param' }))
        }

        try {
          res.setHeader('Content-Type', 'application/json')
          let metadata;
          try {
            metadata = await resolveSpotifyMetadata(spotUrl, clientId, clientSecret, accessToken)
          } catch (err) {
            // The browser fallback can only see Spotify's generic logged-out
            // page for an inaccessible playlist. Returning that page as if it
            // were the requested playlist produced bogus results such as
            // "Your Library". Authentication and not-found errors must reach
            // the UI unchanged.
            if (/^(SPOTIFY_(401|403|404)|Spotify auth failed|Missing SPOTIFY)/.test(err.message || '')) {
              throw err
            }
            console.log(`resolveSpotifyMetadata failed (${err.message}), trying fallback...`);
            try {
              metadata = await resolveSpotifyFallback(spotUrl);
            } catch (fallbackErr) {
              throw new Error(err.message); // Throw original error!
            }
          }
          return res.end(JSON.stringify(metadata))
        } catch (err) {
          console.error('Spotify info error:', err)
          res.statusCode = 500
          res.end(JSON.stringify({ error: err.message }))
        }
      })




      // ── Spotify Active Downloads map (for cancel support) ──
      const spotifyActiveDownloads = new Map()

      // 🎶 Spotify Extract Info (via spotdl save) 🎶
      server.middlewares.use('/api/spotdl-extract', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()
        const spotUrl = urlObj.searchParams.get('url')
        if (!spotUrl) {
          res.statusCode = 400
          return res.end(JSON.stringify({ error: 'Missing url param' }))
        }

        res.setHeader('Content-Type', 'application/json')
        const tempFile = path.join(os.tmpdir(), `spotdl_extract_${Date.now()}.spotdl`)
        const spotdlPath = path.resolve(__dirname, 'bin', 'spotdl.exe')

        const proc = spawn(spotdlPath, ['save', spotUrl, '--save-file', tempFile, '--ffmpeg', path.resolve(__dirname, 'bin', 'ffmpeg.exe')], {
          env: {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
            PATH: `${path.resolve(__dirname, 'bin')}${path.delimiter}${process.env.PATH}`
          }
        })

        // Drain stdout/stderr so spotdl doesn't block!
        proc.stdout.on('data', () => { })
        proc.stderr.on('data', () => { })

        proc.on('close', (code) => {
          if (fs.existsSync(tempFile)) {
            try {
              const raw = fs.readFileSync(tempFile, 'utf8')
              const tracks = JSON.parse(raw)
              fs.unlinkSync(tempFile)

              // Convert spotdl dump to our metadata format
              const metadata = {
                type: 'playlist',
                title: tracks[0]?.list_name || 'Spotify Playlist',
                trackCount: tracks.length,
                totalTracks: tracks.length,
                totalDurationMs: 0,
                tracks: tracks.map((t, i) => ({
                  trackNumber: i + 1,
                  title: t.name,
                  artist: t.artist,
                  allArtists: t.artists.join(', '),
                  durationMs: t.duration * 1000,
                  spotifyUrl: t.url,
                  coverUrl: t.cover_url
                }))
              }
              res.end(JSON.stringify(metadata))
            } catch (e) {
              res.statusCode = 500
              res.end(JSON.stringify({ error: e.message }))
            }
          } else {
            res.statusCode = 500
            res.end(JSON.stringify({ error: 'spotdl failed to extract' }))
          }
        })
      })

      // ── Spotify Cancel ──
      server.middlewares.use('/api/spotify-cancel', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()
        const downloadId = urlObj.searchParams.get('downloadId')
        if (!downloadId) {
          res.statusCode = 400
          return res.end(JSON.stringify({ error: 'Missing downloadId' }))
        }
        const dl = spotifyActiveDownloads.get(downloadId)
        if (dl) {
          dl.cancelled = true
          if (dl.proc) { try { dl.proc.kill() } catch { } }
          spotifyActiveDownloads.delete(downloadId)
        }
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ success: true }))
      })

      // ── Spotify Download (SSE, Multi-Track) ──
      server.middlewares.use('/api/spotify-download', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()
        const spotUrl = urlObj.searchParams.get('url')
        const format = urlObj.searchParams.get('format') || 'audio:mp3:0'
        const downloadId = urlObj.searchParams.get('downloadId') || Date.now().toString()
        const presetStr = urlObj.searchParams.get('preset')
        const preset = presetStr === 'AUTO' ? null : presetStr
        const hwaccel = urlObj.searchParams.get('hwaccel') || 'NONE'
        const clientId = req.headers['x-spotify-client-id']
        const clientSecret = req.headers['x-spotify-client-secret']
        const accessToken = req.headers['x-spotify-access-token']

        if (!spotUrl) {
          res.statusCode = 400
          return res.end(JSON.stringify({ error: 'Missing url param' }))
        }

        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')

        const send = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch { } }

        const dlState = { cancelled: false, proc: null }
        spotifyActiveDownloads.set(downloadId, dlState)

        const runDownload = async () => {
          const aiConfig = getOptimalDownloadConfig(preset);
          const downloadsDir = ensureDownloadsDir(typeof urlObj !== 'undefined' ? (urlObj.searchParams ? urlObj.searchParams.get('customPath') : null) : null)

          send({ status: 'Fetching track info from Spotify API...', progress: 2 })

          let metadata
          try {
            metadata = await resolveSpotifyMetadata(spotUrl, clientId, clientSecret, accessToken)
          } catch (e) {
            if (/^SPOTIFY_403/.test(e.message || '') && /spotify\.com\/playlist\//.test(spotUrl)) {
              console.log('Spotify API denied playlist download metadata; reading the public playlist instead.')
              metadata = await resolvePublicPlaylist(spotUrl)
            } else {
              try {
                console.log(`resolveSpotifyMetadata failed during download (${e.message}), trying fallback...`);
                metadata = await resolveSpotifyFallback(spotUrl);
              } catch (fallbackErr) {
                throw new Error(`Spotify metadata fetch failed: ${e.message} (Fallback failed: ${fallbackErr.message})`);
              }
            }
          }

          const isCollection = metadata.type === 'album' || metadata.type === 'playlist'
          let tracks = isCollection ? metadata.tracks : [metadata]

          const selectedStr = urlObj.searchParams.get('selectedTracks');

          if (selectedStr) {
            const selectedIndices = new Set(selectedStr.split(',').map(Number));
            tracks = tracks.filter(t => selectedIndices.has(t.trackNumber));
          }

          const totalTracks = tracks.length

          if (totalTracks === 0) {
            throw new Error('No tracks found to download (or all selected tracks were invalid).')
          }

          send({ status: `Found ${totalTracks} track${totalTracks > 1 ? 's' : ''} — starting download...`, progress: 5, totalTracks })

          let outputDir = downloadsDir
          let collectionDir = null

          let tempDirForZip = null
          if (isCollection) {
            const safeFolderName = sanitizeFilename(metadata.title)
            collectionDir = path.join(downloadsDir, safeFolderName)
            if (!fs.existsSync(collectionDir)) {
              fs.mkdirSync(collectionDir, { recursive: true })
            }
            outputDir = collectionDir
          }

          const completedTracks = []
          const failedTracks = []

          const limit = aiConfig.concurrentTracks || 1;
          const activePromises = new Set();
          let tracksProcessed = 0;
          const isNativePlaylist = urlObj.searchParams.get('nativePlaylist') === 'true';

          if (isNativePlaylist && isCollection) {
            // Hoist spotdl args so retry pass can reuse them
            const spotdlPath = path.resolve(__dirname, 'bin', 'spotdl.exe');
            const spotdlArgs = [
              spotUrl,
              '--output', path.join(outputDir, '{artists} - {title}.{output-ext}'),
              '--format', 'mp3',
              '--threads', String(aiConfig.concurrentTracks || 4),
              '--preload',
              '--audio', 'youtube',
              '--yt-dlp-args', `--js-runtimes=node:${process.execPath}`,
              '--add-unavailable'
            ];
            let spFfmpegArgs = `-threads ${aiConfig.ffmpegThreads}`
            if (hwaccel !== 'NONE') {
              if (hwaccel === 'AUTO') spFfmpegArgs = `-hwaccel auto ` + spFfmpegArgs
              else if (hwaccel === 'CUDA') spFfmpegArgs = `-hwaccel cuda ` + spFfmpegArgs
              else if (hwaccel === 'AMF') spFfmpegArgs = `-hwaccel d3d11va ` + spFfmpegArgs
              else if (hwaccel === 'QSV') spFfmpegArgs = `-hwaccel qsv ` + spFfmpegArgs
              spotdlArgs.push('--ffmpeg-args', spFfmpegArgs)
            }
            spotdlArgs.push('--ffmpeg', path.resolve(__dirname, 'bin', 'ffmpeg.exe'));

            const result = await new Promise((resolve) => {
              if (dlState.cancelled) return resolve({ skipped: true })

              send({
                currentTrack: 0,
                totalTracks: totalTracks,
                status: 'Se scanează și se asociază melodiile pe YouTube...',
                progress: 5
              });

              const proc = spawn(spotdlPath, spotdlArgs, {
                windowsHide: true,
                env: {
                  ...process.env,
                  PYTHONIOENCODING: 'utf-8',
                  PATH: `${path.resolve(__dirname, 'bin')}${path.delimiter}${process.env.PATH}`
                }
              })
              dlState.proc = proc;
              let stderr = '';
              let currentTrack = 0;
              let nativeTotalTracks = totalTracks;

              proc.stdout.on('data', c => {
                const text = c.toString();
                let mFound = text.match(/Found (\d+) songs in/);
                if (mFound) {
                  nativeTotalTracks = parseInt(mFound[1]);
                  send({ totalTracks: nativeTotalTracks });
                }

                // Depending on spotdl version and arguments, it either prints [1/10] Downloading ...
                // or just Downloaded "song name"
                let m1 = text.match(/\[(\d+)\/(\d+)\] Downloading (.+)/);
                if (m1) {
                  currentTrack = parseInt(m1[1]);
                  nativeTotalTracks = parseInt(m1[2]);
                  send({
                    currentTrack,
                    totalTracks: nativeTotalTracks,
                    status: `Downloading: ${m1[3]}`,
                    trackProgress: 0,
                    progress: Math.round(5 + (currentTrack / nativeTotalTracks) * 85)
                  });
                } else {
                  let mDl = text.match(/Downloaded "([^"]+)"/);
                  if (mDl) {
                    // Try to find correct track index by matching the name
                    const dName = (mDl[1] || '').toLowerCase().replace(/[^\w\s]/g, '');
                    const matchedIdx = tracks.findIndex(t => {
                      const tName = (t.title || '').toLowerCase().replace(/[^\w\s]/g, '');
                      return tName && (dName.includes(tName) || tName.includes(dName));
                    });
                    
                    const resolvedTrack = matchedIdx !== -1 ? matchedIdx + 1 : ++currentTrack;
                    
                    send({
                      currentTrack: resolvedTrack,
                      trackDone: true,
                      totalTracks: nativeTotalTracks,
                      status: `Downloaded: ${mDl[1]}`,
                      trackProgress: 100,
                      progress: Math.round(5 + (resolvedTrack / nativeTotalTracks) * 85)
                    });
                  } else {
                    let m2 = text.match(/(\d+)%/);
                    if (m2 && currentTrack > 0) {
                      send({
                        currentTrack,
                        trackProgress: parseFloat(m2[1])
                      });
                    }
                  }
                }
              });
              proc.stderr.on('data', c => { stderr += c.toString() });

              proc.on('close', async code => {
                if (dlState.cancelled) return resolve({ skipped: true })
                if (code !== 0) {
                  return resolve({ error: `spotdl failed with code ${code}: ${stderr}` })
                }
                resolve({ success: true, nativeTotalTracks })
              });
              proc.on('error', (err) => resolve({ error: `spotdl spawn failed: ${err.message}` }))
            });

            if (result.skipped) return;
            if (result.error) {
              failedTracks.push({ title: 'Playlist', error: result.error });
              send({ error: result.error, done: true });
              res.end();
              return;
            } else {
              try {
                let files = fs.readdirSync(outputDir).filter(f => f.endsWith('.mp3'));
                const expectedCount = result.nativeTotalTracks || totalTracks;

                // ── Smart rescue: identify EXACTLY which tracks are missing ──
                const norm = s => (s || '').toLowerCase()
                  .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

                const downloadedNorms = new Set(files.map(f => norm(f.replace(/\.mp3$/, ''))));

                const isDownloaded = (track) => {
                  const titleN = norm(track.title || '');
                  const artistFirstWord = norm((track.artist || '').split(' ')[0]);
                  for (const dn of downloadedNorms) {
                    if (dn.includes(titleN) && (artistFirstWord === '' || dn.includes(artistFirstWord))) return true;
                  }
                  return false;
                };

                const missingTracks = tracks.filter(t => !isDownloaded(t));

                if (missingTracks.length > 0) {
                  console.log(`[spotdl-rescue] ${files.length}/${expectedCount} downloaded. Rescuing ${missingTracks.length} missing tracks via yt-dlp...`);
                  send({ status: `Rescuing ${missingTracks.length} missing tracks via smart search...`, progress: 88 });

                  const ytDlpPath = path.resolve(__dirname, 'bin', 'yt-dlp.exe');
                  const ffmpegPath = path.resolve(__dirname, 'bin', 'ffmpeg.exe');

                  for (let mi = 0; mi < missingTracks.length; mi++) {
                    if (dlState.cancelled) break;
                    const track = missingTracks[mi];
                    const safeArtist = (track.artist || '').replace(/[<>:"/\\|?*]+/g, '_');
                    const safeTitle = (track.title || '').replace(/[<>:"/\\|?*]+/g, '_');
                    const finalOutputPath = path.join(outputDir, `${safeArtist} - ${safeTitle}.mp3`);

                    if (fs.existsSync(finalOutputPath)) continue;

                    const durationSec = track.durationMs ? Math.round(track.durationMs / 1000) : 0;

                    // 4 search strategies — try each until one succeeds
                    const searchStrategies = [
                      `ytsearch5:${track.artist} ${track.title}`,
                      `ytsearch5:"${track.title}" "${track.artist}"`,
                      `ytsearch5:${track.title} ${track.artist} official audio`,
                      `ytsearch8:${track.title} official audio`,
                    ];

                    let rescued = false;
                    for (const query of searchStrategies) {
                      if (dlState.cancelled || rescued) break;

                      send({
                        status: `Rescuing: ${track.title} — ${track.artist} (${mi + 1}/${missingTracks.length})`,
                        progress: 88 + Math.round((mi / missingTracks.length) * 7)
                      });

                      const matchFilter = durationSec > 0
                        ? `!is_live & duration>${Math.max(30, durationSec - 25)} & duration<${durationSec + 45}`
                        : '!is_live & duration>30';

                      const rescueArgs = [
                        query,
                        '--match-filter', matchFilter,
                        '--extractor-args', 'youtube:player_client=android,web',
                        '--js-runtimes', `node:${process.execPath}`,
                        '-x', '--audio-format', 'mp3',
                        '--audio-quality', '0',
                        '--ffmpeg-location', ffmpegPath,
                        '-o', finalOutputPath,
                        '--no-playlist',
                        '--playlist-items', '1',
                      ];

                      const ok = await new Promise((resolveRescue) => {
                        const rProc = spawn(ytDlpPath, rescueArgs, {
                          windowsHide: true,
                          env: { ...process.env, PYTHONIOENCODING: 'utf-8', PATH: `${path.resolve(__dirname, 'bin')}${path.delimiter}${process.env.PATH}` }
                        });
                        rProc.stdout.on('data', () => {});
                        rProc.stderr.on('data', () => {});
                        rProc.on('close', (code) => resolveRescue(code === 0 && fs.existsSync(finalOutputPath)));
                        rProc.on('error', () => resolveRescue(false));
                      });

                      if (ok) {
                        rescued = true;
                        downloadedNorms.add(norm(`${safeArtist} - ${safeTitle}`));
                        console.log(`[spotdl-rescue] ✓ Rescued: ${track.title}`);
                        
                        const trackRealIdx = tracks.findIndex(t => t.title === track.title && t.artist === track.artist);
                        if (trackRealIdx !== -1) {
                           send({
                             currentTrack: trackRealIdx + 1,
                             trackDone: true,
                             status: `Rescued: ${track.title}`,
                             trackProgress: 100
                           });
                        }
                        
                        // Write ID3 tags
                        try {
                          const tags = {
                            title: track.title,
                            artist: track.allArtists || track.artist,
                            album: track.album,
                            year: track.year,
                            trackNumber: `${track.trackNumber}/${track.totalTracks}`
                          };
                          if (track.coverUrl) {
                            try {
                              const coverBuf = await new Promise((r2, j2) => {
                                https.get(track.coverUrl, rImg => {
                                  if (rImg.statusCode === 200) {
                                    const ch = []; rImg.on('data', c => ch.push(c)); rImg.on('end', () => r2(Buffer.concat(ch)));
                                  } else j2(new Error(`${rImg.statusCode}`));
                                }).on('error', j2);
                              });
                              tags.image = { mime: 'image/jpeg', type: { id: 3, name: 'Front Cover' }, description: 'Cover', imageBuffer: coverBuf };
                            } catch {}
                          }
                          NodeID3.update(tags, finalOutputPath);
                        } catch {}
                      } else {
                        console.log(`[spotdl-rescue] ✗ Strategy failed: "${track.title}" | query: ${query.substring(0, 60)}`);
                        if (!ok) await new Promise(r => setTimeout(r, 800));
                      }
                    }

                    if (!rescued) {
                      console.log(`[spotdl-rescue] Could not rescue: ${track.title} — ${track.artist}`);
                      failedTracks.push({ title: track.title, artist: track.artist, error: 'No matching video found on YouTube' });
                    }
                    if (mi < missingTracks.length - 1) await new Promise(r => setTimeout(r, 600));
                  }

                  files = fs.readdirSync(outputDir).filter(f => f.endsWith('.mp3'));
                }

                console.log(`[spotdl] Final: ${files.length}/${expectedCount} tracks downloaded.`);
                for (const f of files) completedTracks.push(f);
                if (completedTracks.length === 0) {
                  send({ error: 'No files were downloaded.', done: true });
                  res.end();
                  return;
                }
                send({ trackDone: true, currentTrack: files.length, totalTracks: expectedCount, progress: 90 });
              } catch (e) { console.error('[spotdl] post-run error:', e.message); }
            }

          } else {
            // Cap Spotify concurrent downloads (ytsearch) to prevent 429 Too Many Requests
            const safeLimit = Math.min(limit, 3);

            for (let i = 0; i < tracks.length; i++) {
              if (dlState.cancelled) {
                if (collectionDir) try { fs.rmSync(collectionDir, { recursive: true, force: true }) } catch { }
                send({ done: true, error: 'Download cancelled by user.' })
                res.end()
                return
              }

              while (activePromises.size >= safeLimit) {
                await Promise.race(activePromises);
              }

              // Stagger spawns to avoid YouTube search rate limits
              if (i > 0) await new Promise(r => setTimeout(r, 1200));
              if (dlState.cancelled) break;

              const track = tracks[i];
              const trackIndex = i;

              const downloadTask = (async () => {
                send({
                  status: `Downloading: ${track.title} — ${track.artist}`,
                  progress: Math.round(5 + (tracksProcessed / totalTracks) * 85),
                  currentTrack: trackIndex + 1,
                  totalTracks,
                  trackTitle: track.title,
                  trackArtist: track.artist,
                  trackProgress: 0,
                });

                try {
                  const result = await new Promise((resolve) => {
                    if (dlState.cancelled) return resolve({ skipped: true })

                    const safeArtist = track.artist.replace(/[<>:"/\\|?*]+/g, '_');
                    const safeTitle = track.title.replace(/[<>:"/\\|?*]+/g, '_');
                    const finalOutputName = `${safeArtist} - ${safeTitle}.mp3`;

                    // Build a YouTube-focused search query. Prefer ISRC/Spotify track URL
                    // so we get the original (uncensored) version, not a YouTube Music
                    // auto-generated or censored upload.
                    const isrc = track.isrc || '';
                    const searchQuery = isrc
                      ? `ytsearch3:${track.artist} ${track.title}` // will rank-match ISRC below
                      : `ytsearch5:${track.artist} ${track.title}`;

                    const ytDlpArgs = [
                      searchQuery,
                      '--match-filter',
                      // Prefer non-auto-generated YouTube Music channels; pick the first non-music video
                      '!is_live & duration>60',
                      '--extractor-args', 'youtube:player_client=android,web',
                      '--js-runtimes', `node:${process.execPath}`,
                      '-x', '--audio-format', 'mp3',
                      '--audio-quality', '0',
                      '-o', path.join(outputDir, finalOutputName),
                      '--no-playlist',
                      '--playlist-items', '1'
                    ];

                    const ytDlpPath = path.resolve(__dirname, 'bin', 'yt-dlp.exe');
                    const proc = spawn(ytDlpPath, ytDlpArgs, {
                      windowsHide: true,
                      env: {
                        ...process.env,
                        PYTHONIOENCODING: 'utf-8',
                        PATH: `${path.resolve(__dirname, 'bin')}${path.delimiter}${process.env.PATH}`
                      }
                    })
                    // Store only the latest proc for cancellation
                    dlState.proc = proc;
                    let stderr = '';
                    let startTime = Date.now();

                    proc.stdout.on('data', c => {
                      const text = c.toString();
                      stderr += text; // Capture stdout in case of error
                      const pctMatch = text.match(/\[download\]\s+(\d+\.?\d*)%/);
                      if (pctMatch) {
                        send({
                          trackProgress: Math.min(parseFloat(pctMatch[1]), 95),
                          status: `Downloading: ${track.title}`,
                          currentTrack: trackIndex + 1,
                        });
                      }
                    });
                    proc.stderr.on('data', c => { stderr += c.toString() });

                    proc.on('close', async code => {
                      if (dlState.cancelled) return resolve({ skipped: true })
                      if (code !== 0) {
                        return resolve({ error: `yt-dlp failed with code ${code}: ${stderr}`, trackTitle: track.title })
                      }

                      let resolvedFilename = ''
                      if (fs.existsSync(path.join(outputDir, finalOutputName))) {
                        resolvedFilename = finalOutputName;
                      } else {
                        // Fallback scan without mtime restriction in case yt-dlp did something weird
                        try {
                          const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.mp3'))
                          if (files.length > 0) {
                            // Sort by creation time just in case, but just grab the file that includes the title
                            const matched = files.find(f => f.includes(safeTitle) || f.includes(safeArtist));
                            if (matched) resolvedFilename = matched;
                            else resolvedFilename = files[files.length - 1]; // last resort
                          }
                        } catch { }
                      }

                      if (!resolvedFilename) {
                        return resolve({ error: `Could not find downloaded file for ${track.title}`, trackTitle: track.title })
                      }

                      const finalFilename = resolvedFilename;

                      let coverBuffer = null
                      if (track.coverUrl) {
                        try {
                          coverBuffer = await new Promise((resolveImg, rejectImg) => {
                            const fetchImage = (url) => {
                              https.get(url, (resImg) => {
                                if (resImg.statusCode >= 300 && resImg.statusCode < 400 && resImg.headers.location) {
                                  fetchImage(resImg.headers.location)
                                } else if (resImg.statusCode === 200) {
                                  const chunks = []
                                  resImg.on('data', chunk => chunks.push(chunk))
                                  resImg.on('end', () => resolveImg(Buffer.concat(chunks)))
                                } else {
                                  rejectImg(new Error(`Status ${resImg.statusCode}`))
                                }
                              }).on('error', rejectImg)
                            }
                            fetchImage(track.coverUrl)
                          })
                        } catch (err) {
                          console.error(`Failed to fetch cover art for ${track.title}:`, err.message)
                        }
                      }

                      try {
                        const tags = {
                          title: track.title,
                          artist: track.allArtists,
                          album: track.album,
                          year: track.year,
                          trackNumber: `${track.trackNumber}/${track.totalTracks}`
                        }
                        if (coverBuffer) {
                          tags.image = {
                            mime: "image/jpeg",
                            type: { id: 3, name: "Front Cover" },
                            description: "Cover",
                            imageBuffer: coverBuffer
                          }
                        }
                        const filePath = path.resolve(outputDir, finalFilename)
                        const success = NodeID3.update(tags, filePath)
                        if (!success) {
                          console.warn(`Failed to write ID3 tags for ${track.title}`)
                        }
                      } catch (err) {
                        console.error(`Error writing tags for ${track.title}:`, err.message)
                      }

                      resolve({ filename: finalFilename, trackTitle: track.title })
                    });
                    proc.on('error', (err) => resolve({ error: `spotdl spawn failed: ${err.message}. Make sure spotdl is installed.`, trackTitle: track.title }))
                  });

                  tracksProcessed++;
                  const overallProgress = Math.round(5 + (tracksProcessed / totalTracks) * 85);

                  if (result.skipped) return;
                  if (result.error) {
                    failedTracks.push({ ...track, error: result.error });
                    send({ trackError: result.error, currentTrack: trackIndex + 1, trackTitle: track.title, progress: overallProgress });
                  } else {
                    completedTracks.push(result.filename);
                    send({
                      trackDone: true,
                      currentTrack: trackIndex + 1,
                      totalTracks,
                      trackTitle: track.title,
                      progress: overallProgress,
                    });
                  }
                } catch (e) {
                  tracksProcessed++;
                  failedTracks.push({ ...track, error: e.message });
                  send({ trackError: e.message, currentTrack: trackIndex + 1, trackTitle: track.title, progress: Math.round(5 + (tracksProcessed / totalTracks) * 85) });
                }
              })();

              activePromises.add(downloadTask);
              downloadTask.finally(() => activePromises.delete(downloadTask));
            }
            await Promise.all(activePromises);
          }

          if (dlState.cancelled) return

          spotifyActiveDownloads.delete(downloadId)

          if (isCollection) {
            // ZIP the collection folder
            send({ status: 'Creating ZIP archive...', progress: 92 })
            const safeZipName = sanitizeFilename(metadata.title)
            const zipFilename = `spotify-${metadata.type}-${safeZipName}.zip`
            const zipPath = path.join(downloadsDir, zipFilename)

            if (metadata.type === 'album' && metadata.coverUrl) {
              try {
                const coverRes = await fetch(metadata.coverUrl)
                const coverBuffer = Buffer.from(await coverRes.arrayBuffer())

                const metaDir = path.join(collectionDir, '.metadata')
                if (!fs.existsSync(metaDir)) fs.mkdirSync(metaDir)

                const jpgPath = path.join(metaDir, 'folder.jpg')
                fs.writeFileSync(jpgPath, coverBuffer)

                if (process.platform === 'win32') {
                  const icoPath = path.join(metaDir, 'album.ico')
                  await new Promise((resolve) => {
                    const child = spawn(ffmpegBin, ['-y', '-i', jpgPath, '-vf', 'scale=256:256', icoPath], { windowsHide: true })
                    child.on('close', () => resolve())
                  })

                  if (fs.existsSync(icoPath)) {
                    const iniContent = "[.ShellClassInfo]\r\nIconResource=.metadata\\album.ico,0\r\n[ViewState]\r\nMode=\r\nVid=\r\nFolderType=Music\r\n"
                    const iniPath = path.join(collectionDir, 'desktop.ini')
                    fs.writeFileSync(iniPath, iniContent)

                    // Run natively to try and make it automatic! Use shell: true for Windows built-ins
                    await new Promise((resolve) => {
                      const child = spawn('attrib', ['+s', `"${collectionDir}"`], { shell: true })
                      child.on('close', () => resolve())
                    })
                    await new Promise((resolve) => {
                      const child = spawn('attrib', ['+s', '+h', `"${iniPath}"`], { shell: true })
                      child.on('close', () => resolve())
                    })
                    await new Promise((resolve) => {
                      const child = spawn('attrib', ['+s', '+h', `"${metaDir}"`], { shell: true })
                      child.on('close', () => resolve())
                    })

                    spawn('ie4uinit.exe', ['-show'], { shell: true })
                    spawn('powershell', ['-Command', '$shell = New-Object -ComObject Shell.Application; $shell.Windows() | ForEach-Object { $_.Refresh() }'], { shell: true })
                  }
                }
              } catch (e) {
                console.error('Failed to set album folder thumbnail:', e)
              }
            } // Close if (metadata.type === 'album' && metadata.coverUrl)

            send({
              done: true,
              progress: 100,
              finalFilename: path.basename(collectionDir),
              downloadUrl: '',
              completedTracks: completedTracks.length,
              failedTracks: failedTracks.length,
              isArchive: false,
              collectionTitle: metadata.title,
              source: 'spotify',
              spotifyType: metadata.type
            })
            res.end()

          } else {
            // Single track
            const filename = completedTracks[0]
            if (!filename) {
              const errMsg = failedTracks[0]?.error || 'Failed to download track'
              send({ done: true, error: errMsg })
              res.end()
              return
            }
            const filePath = path.join(downloadsDir, filename)
            scheduleDownloadCleanup(filePath)

            send({
              done: true,
              progress: 100,
              finalFilename: filename,
              downloadUrl: `/api/download-file?file=${encodeURIComponent(filename)}`,
              completedTracks: 1,
              failedTracks: 0,
              collectionTitle: metadata.title,
              source: 'spotify',
              spotifyType: 'track'
            })
            res.end()
          }
        }

        req.on('close', () => {
          dlState.cancelled = true
          if (dlState.proc) { try { dlState.proc.kill() } catch { } }
          spotifyActiveDownloads.delete(downloadId)
        })

        runDownload().catch(err => {
          spotifyActiveDownloads.delete(downloadId)
          let errorMsg = err.message
          if (errorMsg.includes('Missing SPOTIFY_CLIENT_ID')) {
            errorMsg = "Add your Spotify credentials in Settings to use Spotify features."
          }
          send({ done: true, error: errorMsg })
          res.end()
        })
      })
    }
  }
}


export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5174,
    watch: {
      ignored: [
        '**/release-build/**',
        '**/*.exe',
        '**/*.dll',
        '**/win-unpacked/**',
      ],
    },
  },
  build: { outDir: 'dist-fe' },
  plugins: [react(), youtubeDownloaderPlugin()],
})
