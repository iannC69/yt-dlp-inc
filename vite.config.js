import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import crypto from 'crypto'
import os from 'os'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const binPath = path.resolve(__dirname, 'bin', 'yt-dlp.exe')

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

const configPath = path.resolve(__dirname, 'config.json')

function getConfig() {
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch(e) {}
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

const historyPath = path.resolve(__dirname, 'history.json')
function getHistory() {
  if (fs.existsSync(historyPath)) {
    try { return JSON.parse(fs.readFileSync(historyPath, 'utf8')); } catch(e) {}
  }
  return [];
}
function saveToHistory(entry) {
  const h = getHistory();
  h.unshift({ ...entry, id: Date.now().toString(), date: new Date().toISOString() });
  if (h.length > 500) h.length = 500;
  fs.writeFileSync(historyPath, JSON.stringify(h, null, 2), 'utf8');
}

const scheduledPath = path.resolve(__dirname, 'scheduled.json')
function getScheduled() {
  if (fs.existsSync(scheduledPath)) {
    try { return JSON.parse(fs.readFileSync(scheduledPath, 'utf8')); } catch(e) {}
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
          spawnYtDlp(jobId);
        }
      } catch(err) {
        console.error('Failed to start scheduled job:', err);
      }
    }
  });
  if (changed) saveScheduled(jobs);
}, 60000);

function createZipFromDirectory(dirPath, zipPath) {
  return new Promise((resolve, reject) => {
    const psCommand = `Compress-Archive -Path '${dirPath}\\*' -DestinationPath '${zipPath}' -Force`
    const child = spawn('powershell', ['-Command', psCommand])
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ZIP creation failed (code ${code}): ${stderr.trim()}`))
    })
    child.on('error', reject)
  })
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
    const job = activeJobs.get(jobId);
    if (job && data.finalFilename) {
      saveToHistory({
        title: job.state.title || data.finalFilename,
        thumbnail: job.state.thumbnail,
        format: job.type === 'single' ? (job.state.format || 'unknown') : 'playlist',
        filename: data.finalFilename,
        isArchive: data.isArchive
      });
    }
  }

  broadcast(jobId, { ...data, done: true })
  const job = activeJobs.get(jobId)
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
         finishJob(jobId, { code, finalFilename });
      }
    } else {
      // Playlist completion
      const downloadedFiles = fs.existsSync(job.collectionDir) ? fs.readdirSync(job.collectionDir) : []
      if (downloadedFiles.length === 0) {
        try { fs.rmSync(job.collectionDir, { recursive: true, force: true }) } catch { /* ignore */ }
        finishJob(jobId, { error: 'Nu s-a descărcat niciun fișier. Verifică link-ul.' })
        return
      }

      broadcast(jobId, { progress: 96, status: 'Se creează arhiva ZIP...' })
      const zipFilename = 'youtube-playlist-' + jobId + '.zip'
      const zipPath = path.join(job.downloadsDir, zipFilename)
      try {
        await createZipFromDirectory(job.collectionDir, zipPath)
        fs.rmSync(job.collectionDir, { recursive: true, force: true })
        scheduleDownloadCleanup(zipPath)
        finishJob(jobId, { progress: 100, finalFilename: zipFilename, isArchive: true })
      } catch (err) {
        try { fs.rmSync(job.collectionDir, { recursive: true, force: true }) } catch { /* ignore */ }
        finishJob(jobId, { error: `Eroare la crearea arhivei: ${err.message}` })
      }
    }
  });

  job.process.on('error', error => {
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
          const targetPath = path.join(ensureDownloadsDir(), target)
          spawn('explorer.exe', ['/select,', targetPath])
        } else {
          spawn('explorer.exe', [ensureDownloadsDir()])
        }
        res.end(JSON.stringify({ success: true }))
      })

      // ── History API ──
      server.middlewares.use('/api/ytdl/history', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()
        
        if (req.method === 'DELETE') {
           fs.writeFileSync(historyPath, '[]', 'utf8')
           return res.end(JSON.stringify({ success: true }))
        }
        
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(getHistory()))
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
            ;(info.formats || []).forEach(f => {
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
               return res.end(JSON.stringify({error: 'No items provided'}))
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

            const ffmpegPath = path.resolve(__dirname, 'bin')
            let args = []
            if (format === 'audio') {
              args = ['-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', path.join(targetDir, '%(title)s.%(ext)s'), '--ffmpeg-location', ffmpegPath]
            } else {
              args = ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--merge-output-format', 'mp4', '-o', path.join(targetDir, '%(title)s.%(ext)s'), '--ffmpeg-location', ffmpegPath]
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

        const ffmpegPath = path.resolve(__dirname, 'bin')
        const downloadsDir = ensureDownloadsDir()
        let args

        if (format.startsWith('audio:')) {
          const parts = format.split(':')
          const audioFmt = parts[1] || 'mp3'
          const audioQuality = parts[2] || '0'
          if (audioFmt === 'wav') {
            args = ['-x', '--audio-format', 'wav', '-o', path.join(downloadsDir, '%(title)s.%(ext)s'), '--ffmpeg-location', ffmpegPath, videoUrl]
          } else if (audioFmt === 'vorbis') {
            args = ['-x', '--audio-format', 'vorbis', '--audio-quality', audioQuality, '-o', path.join(downloadsDir, '%(title)s.%(ext)s'), '--ffmpeg-location', ffmpegPath, videoUrl]
          } else {
            args = ['-x', '--audio-format', 'mp3', '--audio-quality', audioQuality, '-o', path.join(downloadsDir, '%(title)s.%(ext)s'), '--ffmpeg-location', ffmpegPath, videoUrl]
          }
        } else if (format.startsWith('video:')) {
          const formatStr = format.substring(6)
          args = ['-f', formatStr, '--merge-output-format', 'mp4', '-o', path.join(downloadsDir, '%(title)s.%(ext)s'), '--ffmpeg-location', ffmpegPath, videoUrl]
        } else {
          args = ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--merge-output-format', 'mp4', '-o', path.join(downloadsDir, '%(title)s.%(ext)s'), '--ffmpeg-location', ffmpegPath, videoUrl]
        }

        args.push(
          '--no-playlist', 
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
          args = ['-x', '--audio-format', audioFormat, '-o', outputTemplate, '--ffmpeg-location', path.resolve(__dirname, 'bin')]
          if (audioFormat !== 'wav') args.splice(3, 0, '--audio-quality', audioQuality)
        } else {
          const videoFormat = format.startsWith('video:') ? format.substring(6) : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
          args = ['-f', videoFormat, '--merge-output-format', 'mp4', '-o', outputTemplate, '--ffmpeg-location', path.resolve(__dirname, 'bin')]
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
          videoUrl
        )

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

        const filePath = path.join(__dirname, 'downloads', file)
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404
          return res.end('File not found')
        }

        const ffmpegPath = path.resolve(__dirname, 'bin', 'ffmpeg.exe')
        const args = ['-i', filePath, '-map', '0:v', '-c:v', 'copy', '-f', 'image2pipe', '-']
        
        const proc = spawn(ffmpegPath, args)
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

        const filePath = path.join(__dirname, 'downloads', file)
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404
          return res.end('File not found or expired')
        }

        const outNameRaw = urlObj.searchParams.get('outName')
        let downloadFilename = file
        if (outNameRaw && outNameRaw.trim()) {
          const cleanName = outNameRaw.trim().replace(/[^a-zA-Z0-9_ .-]/g, '')
          const ext = path.extname(file) || '.mp3'
          downloadFilename = cleanName.endsWith(ext) ? cleanName : `${cleanName}${ext}`
        }

        const stat = fs.statSync(filePath)
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': stat.size,
          'Content-Disposition': `attachment; filename="${downloadFilename}"`
        })

        const readStream = fs.createReadStream(filePath)
        readStream.pipe(res)
        readStream.on('end', () => {
          scheduleDownloadCleanup(filePath, 60 * 60 * 1000)
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
    }
  }
}

export default defineConfig({
  plugins: [react(), youtubeDownloaderPlugin()],
})
