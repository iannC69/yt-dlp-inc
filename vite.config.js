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
import { resolveSpotifyMetadata, resolveSpotifyFallback } from './src/server/spotify-api.js'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const binPath = path.resolve(__dirname, 'bin', 'yt-dlp.exe')
// Use ffmpeg-static for bundled ffmpeg binary; fall back to local bin/ if present
const ffmpegBin = ffmpegStatic || path.resolve(__dirname, 'bin', 'ffmpeg.exe')
const ffmpegDir = path.dirname(ffmpegBin)

import { getOptimalDownloadConfig } from './src/server/smart-optimizer.js'
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

function ensureDownloadsDir() {
  const cfg = getConfig();
  let dir = cfg.customPath;
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
setInterval(() => {
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
        const targetDir = ensureDownloadsDir();
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
          const dlDir = ensureDownloadsDir();
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
          spawn('explorer.exe', [ensureDownloadsDir()])
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

        child.on('close', code => {
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
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              title: info.title,
              thumbnail: info.thumbnail,
              duration: info.duration,
              uploader: info.uploader || info.channel || null,
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
            const downloadsDir = ensureDownloadsDir()
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

        const downloadsDir = ensureDownloadsDir()
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

        const downloadsDir = ensureDownloadsDir()
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

        const filePath = path.join(ensureDownloadsDir(), file)
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404
          return res.end('File not found')
        }

        if (fs.statSync(filePath).isDirectory()) {
          const jpgPath = path.join(filePath, 'folder.jpg');
          if (fs.existsSync(jpgPath)) {
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return fs.createReadStream(jpgPath).pipe(res);
          }
          res.statusCode = 404;
          return res.end('No thumbnail found in folder');
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
            res.statusCode = 404
            res.end('No thumbnail found')
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

        const dlDir = ensureDownloadsDir();
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
          const downloadsDir = ensureDownloadsDir()
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

      // ── Spotify OAuth Token Exchange ──
      server.middlewares.use('/api/spotify-oauth', async (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()

        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end(JSON.stringify({ error: 'Method not allowed' }))
        }

        const clientId = req.headers['x-spotify-client-id']
        const clientSecret = req.headers['x-spotify-client-secret']

        const body = await parseJsonBody(req)
        const { code, redirectUri } = body

        if (!code || !redirectUri || !clientId || !clientSecret) {
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
              grant_type: 'authorization_code',
              code,
              redirect_uri: redirectUri
            })
          })

          const data = await tokenRes.json()
          if (!tokenRes.ok) throw new Error(data.error_description || data.error || 'Token fetch failed')

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(data))
        } catch (err) {
          console.error('Spotify OAuth error:', err)
          res.statusCode = 500
          res.end(JSON.stringify({ error: err.message }))
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

      // ── Public playlist fallback (used by both spotify-info and mass-fetch) ──
      const resolvePublicPlaylist = async (spotUrl) => {
        const [{ default: createSpotifyUrlInfo }, { default: fetch }] = await Promise.all([
          import('spotify-url-info'), import('node-fetch')
        ])
        const { getDetails } = createSpotifyUrlInfo(fetch)
        const { preview, tracks } = await getDetails(spotUrl)
        if (!tracks?.length) throw new Error('Pagina publică Spotify nu conține melodii pentru acest playlist.')
        return {
          type: 'playlist', title: preview?.title || 'Spotify Playlist', trackCount: tracks.length, totalTracks: tracks.length,
          coverUrl: preview?.image || null,
          totalDurationMs: tracks.reduce((total, track) => total + (track.duration || 0), 0),
          tracks: tracks.map((track, index) => ({
            trackNumber: index + 1, title: track.name, artist: track.artist,
            allArtists: track.artist, durationMs: track.duration || 0,
            spotifyUrl: track.uri ? `https://open.spotify.com/track/${track.uri.split(':').pop()}` : null,
            coverUrl: preview?.image || null
          }))
        }
      }

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
                const page = Math.floor(actualIdx / 100);
                const fallbackSource = (page % 2 === 0) ? 'itunes' : 'youtube_music';

                if (fallbackSource === 'itunes') {
                  const itunesData = await fetchItunesMetadata(track.title, track.artist);
                  if (itunesData) {
                    track.title = itunesData.title || track.title;
                    track.artist = itunesData.artist || track.artist;
                    track.album = itunesData.album || track.album;
                    track.year = itunesData.year || track.year;
                    track.coverUrl = itunesData.coverUrl || track.coverUrl;
                    source = 'itunes';
                  }
                } else {
                  const ytmData = await fetchYouTubeMusicMetadata(track.title, track.artist);
                  if (ytmData) {
                    track.title = ytmData.title || track.title;
                    track.artist = ytmData.artist || track.artist;
                    track.album = ytmData.album || track.album;
                    track.year = ytmData.year || track.year;
                    track.coverUrl = ytmData.coverUrl || track.coverUrl;
                    source = 'youtube_music';
                  }
                }
              }
              track.metadataSource = source;
              track.index = actualIdx + 1;
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

      // ── Mass Download API ──
      const activeMassDownloads = new Map()

      server.middlewares.use('/api/spotify-mass-cancel', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()

        const downloadId = urlObj.searchParams.get('downloadId')
        if (downloadId && activeMassDownloads.has(downloadId)) {
          const dl = activeMassDownloads.get(downloadId)
          dl.cancelled = true
          if (dl.proc) { try { dl.proc.kill() } catch { } }
        }
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ success: true }))
      })

      server.middlewares.use('/api/spotify-mass-download', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()

        const spotUrl = urlObj.searchParams.get('url')
        const downloadId = urlObj.searchParams.get('downloadId')
        if (!spotUrl || !downloadId) {
          res.statusCode = 400
          return res.end(JSON.stringify({ error: 'Missing params' }))
        }

        const formatStr = urlObj.searchParams.get('format') || 'audio:mp3:0'
        const audioFormat = formatStr.split(':')[1] || 'mp3'
        const clientId = req.headers['x-spotify-client-id']
        const clientSecret = req.headers['x-spotify-client-secret']
        const accessToken = req.headers['x-spotify-access-token']

        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')
        const send = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch { } }

        const dlState = { cancelled: false, proc: null }
        activeMassDownloads.set(downloadId, dlState)

        const runMassDownload = async () => {
          send({ current: 0, status: 'Fetching complete track list...' })

          let metadata
          try {
            metadata = await resolveSpotifyMetadata(spotUrl, clientId, clientSecret, accessToken)
          } catch (err) {
            if (/^SPOTIFY_403/.test(err?.message || '') && /spotify\.com\/playlist\//.test(spotUrl)) {
              console.log('[mass-download] 403 on API → trying public playlist fallback')
              metadata = await resolvePublicPlaylist(spotUrl)
            } else {
              throw err
            }
          }
          const tracks = metadata.tracks

          const safeName = sanitizeFilename(metadata.title) || 'playlist'
          const tempDir = path.join(ensureDownloadsDir(), `mass-${safeName}-${Date.now()}`)
          fs.mkdirSync(tempDir, { recursive: true })

          let completedCount = 0
          let failedCount = 0
          const startTimes = []

          for (let i = 0; i < tracks.length; i++) {
            if (dlState.cancelled) break

            const track = tracks[i]
            let source = 'spotify'
            const hasIncomplete = !track.coverUrl || !track.album || !track.year || !track.durationMs
            if (hasIncomplete) {
              const fallbackSource = (Math.floor(i / 100) % 2 === 0) ? 'itunes' : 'youtube_music'
              if (fallbackSource === 'itunes') {
                const itunesData = await fetchItunesMetadata(track.title, track.artist)
                if (itunesData) {
                  track.title = itunesData.title || track.title; track.artist = itunesData.artist || track.artist; track.album = itunesData.album || track.album; track.year = itunesData.year || track.year; track.coverUrl = itunesData.coverUrl || track.coverUrl; source = 'itunes'
                }
              } else {
                const ytmData = await fetchYouTubeMusicMetadata(track.title, track.artist)
                if (ytmData) {
                  track.title = ytmData.title || track.title; track.artist = ytmData.artist || track.artist; track.album = ytmData.album || track.album; track.year = ytmData.year || track.year; track.coverUrl = ytmData.coverUrl || track.coverUrl; source = 'youtube_music'
                }
              }
            }

            const trackStartTime = Date.now()
            let estSecs = 0
            if (startTimes.length > 0) {
              const avgMs = startTimes.reduce((a, b) => a + b, 0) / startTimes.length
              estSecs = Math.round((avgMs * (tracks.length - i)) / 1000)
            }

            send({
              current: i + 1,
              total: tracks.length,
              percent: Math.round(((i) / tracks.length) * 100),
              title: track.title,
              artist: track.artist,
              coverUrl: track.coverUrl,
              metadataSource: source,
              failed: failedCount,
              estimatedSecondsRemaining: estSecs
            })

            try {
              const ytDlpPath = path.resolve(__dirname, 'bin', 'yt-dlp.exe')
              const safeArtist = track.artist.replace(/[<>:"/\\|?*]+/g, '_')
              const safeTitle = track.title.replace(/[<>:"/\\|?*]+/g, '_')
              const finalOutputName = `${safeArtist} - ${safeTitle}.%(ext)s`

              // Try multiple search queries — fall back if the first fails
              const searchQueries = [
                `ytsearch1:${track.artist} - ${track.title} audio`,
                `ytsearch1:${track.artist} ${track.title}`,
                `ytsearch1:${track.title} ${track.artist} official audio`,
              ]

              let downloadedOk = false
              for (const query of searchQueries) {
                if (dlState.cancelled) break
                const ok = await new Promise((resolve) => {
                  const args = [
                    query,
                    '-x', '--audio-format', audioFormat,
                    '--audio-quality', '0',
                    '-o', path.join(tempDir, finalOutputName),
                    '--no-playlist',
                    '--ffmpeg-location', ffmpegDir,
                  ]
                  const proc = spawn(ytDlpPath, args, {
                    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PATH: `${path.resolve(__dirname, 'bin')}${path.delimiter}${process.env.PATH}` }
                  })
                  dlState.proc = proc
                  let stderr = ''
                  proc.stderr.on('data', chunk => { stderr += chunk.toString() })
                  proc.on('close', code => {
                    if (code === 0) resolve(true)
                    else { console.warn(`[mass-dl] yt-dlp failed (${code}) for query "${query}": ${stderr.slice(0, 200)}`); resolve(false) }
                  })
                  proc.on('error', () => resolve(false))
                })
                if (ok) { downloadedOk = true; break }
              }

              if (dlState.cancelled) break

              // Find file downloaded during this track's slot
              const AUDIO_EXTS = ['mp3', 'ogg', 'wav', 'flac', 'm4a', 'opus', 'aac']
              let finalFilename = ''
              try {
                const files = fs.readdirSync(tempDir).filter(f => {
                  const ext = f.split('.').pop().toLowerCase()
                  return AUDIO_EXTS.includes(ext)
                })
                let newestTime = 0
                for (const f of files) {
                  const stat = fs.statSync(path.join(tempDir, f))
                  if (stat.mtimeMs > newestTime && stat.mtimeMs >= trackStartTime) {
                    newestTime = stat.mtimeMs
                    finalFilename = f
                  }
                }
              } catch (e) { }

              if (downloadedOk && finalFilename) {
                const filePath = path.join(tempDir, finalFilename)
                let coverBuffer = null
                if (track.coverUrl && audioFormat === 'mp3') {
                  try {
                    coverBuffer = await new Promise((resolveImg, rejectImg) => {
                      const fetchImage = (url) => {
                        https.get(url, (resImg) => {
                          if (resImg.statusCode >= 300 && resImg.statusCode < 400 && resImg.headers.location) fetchImage(resImg.headers.location)
                          else if (resImg.statusCode === 200) {
                            const chunks = []; resImg.on('data', chunk => chunks.push(chunk)); resImg.on('end', () => resolveImg(Buffer.concat(chunks)))
                          } else rejectImg(new Error('Status ' + resImg.statusCode))
                        }).on('error', rejectImg)
                      }
                      fetchImage(track.coverUrl)
                    })
                  } catch (e) { }
                }

                if (audioFormat === 'mp3') {
                  const tags = {
                    title: track.title,
                    artist: track.allArtists || track.artist,
                    album: track.album,
                    year: track.year,
                    trackNumber: `${i + 1}/${tracks.length}`
                  }
                  if (coverBuffer) {
                    tags.image = { mime: "image/jpeg", type: { id: 3 }, description: "Cover", imageBuffer: coverBuffer }
                  }
                  try { NodeID3.update(tags, filePath) } catch (e) { }
                }
                completedCount++
                startTimes.push(Date.now() - trackStartTime)
                if (startTimes.length > 10) startTimes.shift() // Rolling average of last 10
              } else {
                failedCount++
                console.warn(`[mass-dl] Track failed after all retries: "${track.artist} - ${track.title}"`)
              }
            } catch (err) {
              failedCount++
              console.warn(`[mass-dl] Track exception: ${err.message}`)
            }
          }

          activeMassDownloads.delete(downloadId)

          if (dlState.cancelled) {
            try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch { }
            send({ done: true, cancelled: true })
            return res.end()
          }

          send({ current: tracks.length, total: tracks.length, percent: 99, status: 'Creating ZIP...', estimatedSecondsRemaining: 0 })

          const zipFilename = `spotify-playlist-${safeName}.zip`
          const zipPath = path.join(ensureDownloadsDir(), zipFilename)

          try {
            await createZipFromDirectory(tempDir, zipPath)
            try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch { }

            const historyPath = path.resolve(process.cwd(), 'history.json')
            let history = []
            try { history = JSON.parse(fs.readFileSync(historyPath, 'utf8')) } catch { }
            history.unshift({
              title: metadata.title,
              artist: metadata.owner || 'Unknown',
              format: "audio:" + audioFormat,
              filename: zipFilename,
              source: "spotify",
              spotifyType: "playlist",
              trackCount: completedCount,
              failedCount: failedCount,
              id: Date.now().toString(),
              date: new Date().toISOString()
            })
            fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8')

            send({
              done: true,
              zipPath: zipFilename,
              completedCount,
              failedCount
            })
            res.end()
          } catch (e) {
            send({ done: true, error: 'ZIP failed: ' + e.message })
            res.end()
          }
        }

        req.on('close', () => {
          dlState.cancelled = true
          if (dlState.proc) { try { dlState.proc.kill() } catch { } }
          activeMassDownloads.delete(downloadId)
        })

        runMassDownload().catch(err => {
          activeMassDownloads.delete(downloadId)
          send({ done: true, error: err.message })
          res.end()
        })
      })

      // resolvePublicPlaylist is now defined above (before spotify-mass-fetch middleware)

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
            if (/^SPOTIFY_403/.test(err.message || '') && /spotify\.com\/playlist\//.test(spotUrl)) {
              console.log('Spotify API denied playlist access; reading public playlist metadata instead.')
              metadata = await resolvePublicPlaylist(spotUrl)
              return res.end(JSON.stringify(metadata))
            }
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

        const proc = spawn(spotdlPath, ['save', spotUrl, '--save-file', tempFile], {
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
          const downloadsDir = ensureDownloadsDir()

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
            const result = await new Promise((resolve) => {
              if (dlState.cancelled) return resolve({ skipped: true })

              send({
                currentTrack: 0,
                totalTracks: totalTracks,
                status: 'Se scanează și se asociază melodiile pe YouTube...',
                progress: 5
              });

              const spotdlArgs = [
                spotUrl,
                '--output', path.join(outputDir, '{artists} - {title}.{output-ext}'),
                '--format', 'mp3',
                '--threads', String(aiConfig.concurrentTracks || 4),
                '--preload',
                '--audio', 'soundcloud', 'youtube', 'piped',
                '--yt-dlp-args', `--js-runtimes=node:${process.execPath}`
              ];
              let spFfmpegArgs = `-threads ${aiConfig.ffmpegThreads}`
              if (hwaccel !== 'NONE') {
                if (hwaccel === 'AUTO') spFfmpegArgs = `-hwaccel auto ` + spFfmpegArgs
                else if (hwaccel === 'CUDA') spFfmpegArgs = `-hwaccel cuda ` + spFfmpegArgs
                else if (hwaccel === 'AMF') spFfmpegArgs = `-hwaccel d3d11va ` + spFfmpegArgs
                else if (hwaccel === 'QSV') spFfmpegArgs = `-hwaccel qsv ` + spFfmpegArgs
                spotdlArgs.push('--ffmpeg-args', spFfmpegArgs)
              }

              const spotdlPath = path.resolve(__dirname, 'bin', 'spotdl.exe');
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
                    currentTrack++;
                    send({
                      currentTrack,
                      totalTracks: nativeTotalTracks,
                      status: `Downloaded: ${mDl[1]}`,
                      trackProgress: 100,
                      progress: Math.round(5 + (currentTrack / nativeTotalTracks) * 85)
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
                const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.mp3'))
                for (const f of files) completedTracks.push(f)
                if (completedTracks.length === 0) {
                  send({ error: 'No files were downloaded.', done: true });
                  res.end();
                  return;
                }
                send({
                  trackDone: true,
                  currentTrack: result.nativeTotalTracks,
                  totalTracks: result.nativeTotalTracks,
                  progress: 90
                });
              } catch (e) { }
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

                    const ytDlpArgs = [
                      `ytsearch1:${track.artist} ${track.title} audio`,
                      '-x', '--audio-format', 'mp3',
                      '--audio-quality', '0',
                      '--extractor-args', 'youtube:player_client=android,web',
                      '--js-runtimes', `node:${process.execPath}`,
                      '-o', path.join(outputDir, finalOutputName),
                      '--no-playlist'
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
  server: { host: '127.0.0.1', port: 5174 },
  plugins: [react(), youtubeDownloaderPlugin()],
})
