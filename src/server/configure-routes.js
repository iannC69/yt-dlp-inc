import fs from 'fs'
import path from 'path'
import { spawn, spawnSync } from 'child_process'
import os from 'os'
import https from 'https'
import NodeID3 from 'node-id3'
import { resolveSpotifyMetadata, resolveSpotifyFallback, parseSpotifyEmbed, getAnonymousSpotifyToken, searchSpotifyAPI } from './spotify-api.js'
import { writeAndVerifyTags } from './tag-utils.js'
import { getOptimalDownloadConfig } from './smart-optimizer.js'
import { createBatchEngine, getBatchPerformanceProfile } from './batch-engine.js'


export function configureRoutes(middlewares, { appDir, binDir, ffmpegBin: _ffmpegBin }) {
  const binPath = path.join(binDir, 'yt-dlp.exe')
  const ffmpegBin = _ffmpegBin || path.join(binDir, 'ffmpeg.exe')
  const ffmpegDir = path.dirname(ffmpegBin)
  const spotdlBin = path.join(binDir, process.platform === 'win32' ? 'spotdl.exe' : 'spotdl')
  const aiConfig = getOptimalDownloadConfig()
  const COLLECTION_LIMIT = 5000
  const configPath = path.resolve(appDir, 'config.json')
  const scheduledPath = path.resolve(appDir, 'scheduled.json')
  const activeJobs = new Map()

  // Helper centralizat
  function getExtractorArgs() {
    const poToken = getConfig().youtubePoToken || '';
    return poToken
      ? 'youtube:player_client=ios,android;po_token=' + poToken
      : 'youtube:player_client=ios,android';
  }

  const metrics = { uptimeStart: Date.now(), totalHits: 0, successfulDownloads: 0, failedDownloads: 0 }
  const MAX_CONCURRENT_JOBS = 2
  let runningJobsCount = 0
  const urlMetaCache = new Map()
  const URL_CACHE_TTL = 24 * 60 * 60 * 1000
  const URL_CACHE_MAX = 500
  const activeMassYtdlDownloads = new Map()
  const spotifyActiveDownloads = new Map()

  function isYouTubeUrl(url) { return /^(https?:\/\/)?(www\.|music\.)?(youtube\.com|youtu\.be|soundcloud\.com)\/.+/.test(url) }
  function parseYtDlpError(s) {
    if (!s) return null
    if (s.includes('HTTP Error 429') || s.includes('Too Many Requests')) return 'YouTube Rate Limit. ÃŽncearcÄƒ mai tÃ¢rziu sau foloseÈ™te un VPN.'
    if (s.includes("Sign in to confirm") || s.includes('bot protection')) return 'YouTube a limitat temporar adresa ta IP (Rate Limit / Anti-Bot). FoloseÈ™te setarea PO Token (din System & Engine) sau actualizeazÄƒ cookie-urile.'
    if (s.includes('No space left')) return 'Nu mai este spaÈ›iu pe disc!'
    if (s.includes('Video unavailable') || s.includes('Private video')) return 'Videoclipul nu este disponibil sau este privat.'
    if (s.includes('members on level')) return 'Disponibil doar pentru membrii canalului.'
    return null
  }
  function sanitizeFilename(n) { return n.replace(/[/\\:*?"<>|]/g, '_').replace(/\.+$/, '').trim().substring(0, 200) }
  function getConfig() { if (fs.existsSync(configPath)) { try { return JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch { } } return { customPath: '' } }
  function saveConfig(cfg) { fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8') }
  function ensureDownloadsDir(custom) { const cfg = getConfig(); let d = custom || cfg.customPath; if (!d) d = path.join(appDir, 'downloads'); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); return d }
  function getScheduled() { if (fs.existsSync(scheduledPath)) { try { return JSON.parse(fs.readFileSync(scheduledPath, 'utf8')) } catch { } } return [] }
  function saveScheduled(j) { fs.writeFileSync(scheduledPath, JSON.stringify(j, null, 2), 'utf8') }
  function addScheduledJob(d) { const j = getScheduled(); j.push({ ...d, id: Date.now().toString() }); saveScheduled(j) }
  function sendSse(res, d) { res.write(`data: ${JSON.stringify(d)}\n\n`) }
  function scheduleDownloadCleanup(fp, ms = 15 * 60 * 1000) { setTimeout(() => fs.rm(fp, { recursive: true, force: true }, () => { }), ms) }
  async function createZipFromDirectory(dirPath, zipPath) {
    const { Archiver } = await import('archiver')
    return new Promise((resolve, reject) => {
      const out = fs.createWriteStream(zipPath); const arc = new Archiver('zip', { zlib: { level: 0 } })
      out.on('close', resolve); arc.on('error', reject); arc.pipe(out)
      for (const item of fs.readdirSync(dirPath)) {
        const ip = path.join(dirPath, item); const st = fs.statSync(ip)
        if (st.isDirectory()) { for (const f of fs.readdirSync(ip)) arc.file(path.join(ip, f), { name: `${item}/${f}` }) }
        else arc.file(ip, { name: item })
      }
      arc.finalize()
    })
  }
  function parseJsonBody(req) { return new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')) } catch { r({}) } }) }) }
  function cacheGet(u) { const e = urlMetaCache.get(u); if (!e) return null; if (Date.now() - e.timestamp > URL_CACHE_TTL) { urlMetaCache.delete(u); return null } return e.data }
  function cacheSet(u, d) { if (urlMetaCache.size >= URL_CACHE_MAX) urlMetaCache.delete(urlMetaCache.keys().next().value); urlMetaCache.set(u, { data: d, timestamp: Date.now() }) }

  function processQueue() {
    const q = Array.from(activeJobs.entries()).filter(([, j]) => j.queueStatus === 'queued' && !j.isPaused && !j.isCancelled)
    while (runningJobsCount < MAX_CONCURRENT_JOBS && q.length > 0) {
      const [id, job] = q.shift(); job.queueStatus = 'running'; runningJobsCount++; broadcast(id, { queueStatus: 'running' }); spawnYtDlp(id)
    }
  }
  function enqueueJob(id) { const j = activeJobs.get(id); if (!j) return; j.queueStatus = 'queued'; broadcast(id, { queueStatus: 'queued' }); processQueue() }
  function broadcast(id, d) { const j = activeJobs.get(id); if (!j) return; Object.assign(j.state, d); for (const c of j.clients) { try { sendSse(c, d) } catch { } } }
  function finishJob(id, d) {
    if (d.error) metrics.failedDownloads++; else metrics.successfulDownloads++
    const j = activeJobs.get(id)
    const upgradedThumb = (j?.state.thumbnail && j.state.thumbnail.includes('ytimg.com'))
      ? j.state.thumbnail.replace(/(\/vi(?:_webp)?\/[^/]+\/)([^/?#]+)(\.(?:jpg|webp))/i, '$1maxresdefault$3')
      : j?.state.thumbnail;
    if (!d.error && j && d.finalFilename) d.jobInfo = { title: j.state.title || d.finalFilename, thumbnail: upgradedThumb, format: j.type === 'single' ? (j.state.format || 'unknown') : 'playlist', filename: d.finalFilename, isArchive: d.isArchive, source: 'youtube', date: new Date().toISOString(), id: Date.now().toString() }
    broadcast(id, { ...d, done: true })
    if (j) { j.clients.forEach(c => c.end()); j.clients.clear(); setTimeout(() => activeJobs.delete(id), 10 * 60 * 1000) }
  }

  function spawnYtDlp(jobId) {
    const job = activeJobs.get(jobId); if (!job) return
    job.process = spawn(binPath, job.args); let settled = false
    let curItem = job.state.currentItem || 0, totItems = job.state.totalItems || (job.type === 'playlist' ? job.expectedCount : 1), finalFn = job.state.finalFilename || ''
    const onOut = text => {
      if (job.isPaused || job.isCancelled) return
      if (job.type === 'playlist') {
        const m = text.match(/Downloading item\s+(\d+)\s+of\s+(\d+)/i), mp = text.match(/\[download\]\s+([\d.]+)%/)
        if (m) { curItem = Number(m[1]); totItems = Number(m[2]) }
        const prog = totItems ? ((curItem - 1) / totItems) * 100 + ((mp ? Number(mp[1]) : 0) / totItems) : 0
        broadcast(jobId, { progress: Math.min(prog, 95), currentItem: curItem, totalItems: totItems, status: totItems ? `Se descarcÄƒ piesa ${curItem} din ${totItems}` : 'Se pregÄƒteÈ™te...' })
      } else {
        const dm = text.match(/Destination:\s*(.*)/), am = text.match(/\]\s+(.*?)\s*has already been downloaded/), mm = text.match(/Merging formats into "(.*)"/), pm = text.match(/\[download\]\s+([\d.]+)%/)
        if (dm?.[1]) finalFn = path.basename(dm[1].trim()); if (am?.[1]) finalFn = path.basename(am[1].trim()); if (mm?.[1]) finalFn = path.basename(mm[1].trim())
        let prog = job.state.progress; if (pm) prog = parseFloat(pm[1])
        broadcast(jobId, { raw: text, progress: prog, filename: finalFn })
      }
    }
    job.process.stdout.on('data', c => c.toString().split('\n').forEach(l => { if (l.trim()) onOut(l.trim()) }))
    let fullStderr = ''
    job.process.stderr.on('data', c => { const t = c.toString(); fullStderr += t; if (t.includes('[download]')) onOut(t.trim()) })
    job.process.on('close', async code => {
      runningJobsCount = Math.max(0, runningJobsCount - 1); processQueue()
      if (settled) return; settled = true; job.process = null
      if (job.isCancelled || job.isPaused) return
      if (code !== 0) { const ke = parseYtDlpError(fullStderr); if (ke) { if (job.collectionDir) { try { fs.rmSync(job.collectionDir, { recursive: true, force: true }) } catch { } } return finishJob(jobId, { error: ke }) } }
      if (job.type === 'single') {
        if (code !== 0) finishJob(jobId, { error: 'Eroare la descÄƒrcare. Cod: ' + code })
        else {
          const fp = path.join(job.downloadsDir, finalFn);
          if (fp.endsWith('.mp3')) { try { await augmentYtTags(fp); } catch (e) { console.error('[tags] single augment error:', e.message); } }
          scheduleDownloadCleanup(fp); finishJob(jobId, { code, finalFilename: finalFn, downloadUrl: `/api/download-file?file=${encodeURIComponent(finalFn)}` })
        }
      } else {
        const dlf = fs.existsSync(job.collectionDir) ? fs.readdirSync(job.collectionDir) : []
        if (!dlf.length) { try { fs.rmSync(job.collectionDir, { recursive: true, force: true }) } catch { }; finishJob(jobId, { error: 'Nu s-a descÄƒrcat niciun fiÈ™ier.' }); return }
        broadcast(jobId, { progress: 96, status: 'Se configureazÄƒ folderul...' })
        if (job.state.thumbnail) {
          try {
            // Upgrade thumbnail URL to highest available resolution before fetching
            const thumbVideoId = extractYtVideoId(job.state.thumbnail);
            const cb = await fetchHDCoverBuffer(thumbVideoId, job.state.thumbnail) || Buffer.from(await (await fetch(job.state.thumbnail)).arrayBuffer());
            const metaDir = path.join(job.collectionDir, '.metadata')
            if (!fs.existsSync(metaDir)) fs.mkdirSync(metaDir)
            if (os.platform() === 'win32') { try { spawnSync('attrib', ['+h', metaDir], { windowsHide: true }); } catch (e) { } }

            const rawJp = path.join(metaDir, 'raw_folder.jpg'); fs.writeFileSync(rawJp, cb)
            const jp = path.join(metaDir, 'folder.jpg');

            await new Promise(r => { spawn(ffmpegBin, ['-y', '-i', rawJp, '-vf', 'crop=min(iw\\,ih):min(iw\\,ih),scale=1920:1920:flags=lanczos', jp], { windowsHide: true }).on('close', r) })
            let finalCb = cb;
            if (fs.existsSync(jp)) { finalCb = fs.readFileSync(jp); } else { fs.writeFileSync(jp, cb); }
            try { fs.unlinkSync(rawJp); } catch (e) { }

            // Also place folder.jpg in the root so music players recognize the folder cover
            const rootJp = path.join(job.collectionDir, 'folder.jpg');
            if (fs.existsSync(jp)) { fs.copyFileSync(jp, rootJp); } else { fs.writeFileSync(rootJp, cb); }
            if (os.platform() === 'win32') { try { spawnSync('attrib', ['+h', rootJp], { windowsHide: true }); } catch (e) { } }

            const mp3s = fs.readdirSync(job.collectionDir).filter(f => f.endsWith('.mp3'))
            mp3s.sort()
            for (let i = 0; i < mp3s.length; i++) {
              const fp = path.join(job.collectionDir, mp3s[i])
              const plIdx = job.type === 'playlist' ? i + 1 : null
              try { await augmentYtTags(fp, plIdx, mp3s.length, null); } catch (e) { console.error('[tags] collection augment error:', e.message); }
            }

            if (process.platform === 'win32') {
              const ip = path.join(metaDir, 'album.ico')
              await new Promise(r => { spawn(ffmpegBin, ['-y', '-i', jp, '-vf', 'scale=256:256', ip], { windowsHide: true }).on('close', r) })
              if (fs.existsSync(ip)) {
                fs.writeFileSync(path.join(job.collectionDir, 'desktop.ini'), "[.ShellClassInfo]\r\nIconResource=.metadata\\album.ico,0\r\n[ViewState]\r\nMode=\r\nVid=\r\nFolderType=Music\r\n")

                await new Promise(r => { spawn('attrib', ['+s', `"${job.collectionDir}"`], { shell: true }).on('close', r) })
                await new Promise(r => { spawn('attrib', ['+s', '+h', `"${path.join(job.collectionDir, 'desktop.ini')}"`], { shell: true }).on('close', r) })
                await new Promise(r => { spawn('attrib', ['+h', `"${metaDir}"`], { shell: true }).on('close', r) })

                fs.writeFileSync(path.join(job.collectionDir, 'ApplyFolderIcon.bat'), `@echo off\r\nattrib +s "%~dp0."\r\nattrib +s +h "%~dp0desktop.ini"\r\nattrib +h "%~dp0.metadata"\r\nie4uinit.exe -show\r\npause\r\n`)
                await new Promise(r => { spawn('attrib', ['+h', `"${path.join(job.collectionDir, 'ApplyFolderIcon.bat')}"`], { shell: true }).on('close', r) })
              }
            }
          } catch (e) { console.error('Thumbnail error:', e) }
        }
        const failedIds = [...fullStderr.matchAll(/ERROR:\s*\[.*?\]\s*([\w-]+):/g)].map(m => m[1]);
        const validDlf = fs.existsSync(job.collectionDir) ? fs.readdirSync(job.collectionDir).filter(f => !f.startsWith('.') && !f.endsWith('.bat') && !f.endsWith('.ini') && !f.endsWith('.jpg') && !f.endsWith('.ico')) : [];
        finishJob(jobId, { progress: 100, finalFilename: path.basename(job.collectionDir), isArchive: false, collectionTitle: job.state.title || path.basename(job.collectionDir), downloadedCount: validDlf.length, failedIds })
      }
    })
    job.process.on('error', err => { runningJobsCount = Math.max(0, runningJobsCount - 1); processQueue(); if (settled) return; settled = true; job.process = null; if (job.isCancelled || job.isPaused) return; if (job.collectionDir) { try { fs.rmSync(job.collectionDir, { recursive: true, force: true }) } catch { } }; finishJob(jobId, { error: err.message || 'Eroare.' }) })
  }

  function isGoodMatch(a, b) { if (!a || !b) return false; const x = a.toLowerCase().trim(), y = b.toLowerCase().trim(); if (x.includes(y) || y.includes(x)) return true; const wa = x.split(/\s+/), wb = y.split(/\s+/); return wa.filter(w => w.length > 3 && wb.includes(w)).length > 0 }
  function httpsGet(url) { return new Promise((res, rej) => { https.get(url, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)) } catch { res({}) } }) }).on('error', rej) }) }
  async function fetchItunesMetadata(title, artist) { try { const d = await httpsGet(`https://itunes.apple.com/search?term=${encodeURIComponent(title + ' ' + artist)}&entity=song&limit=5&country=US`); for (const r of (d.results || [])) { if (isGoodMatch(artist, r.artistName)) return { title: r.trackName, artist: r.artistName, album: r.collectionName, year: r.releaseDate?.substring(0, 4) || '', coverUrl: r.artworkUrl100?.replace('100x100bb', '3000x3000bb') || null, source: 'itunes' } } } catch { }; return null }
  async function fetchYouTubeMusicMetadata(title, artist) { const q = `${title} ${artist} Topic`; return new Promise(resolve => { const p = spawn(binPath, ['--dump-json', '--no-playlist', '--no-warnings', `ytsearch1:${q}`], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }); let s = ''; p.stdout.on('data', c => s += c); p.on('close', () => { try { const i = JSON.parse(s); const u = i.uploader || i.channel || ''; if (!isGoodMatch(artist, u.replace(' - Topic', ''))) return resolve(null); resolve({ title: i.title, artist, album: i.album || '', year: i.release_year?.toString() || i.upload_date?.substring(0, 4) || '', coverUrl: i.thumbnail || null, source: 'youtube_music' }) } catch { resolve(null) } }); p.on('error', () => resolve(null)); setTimeout(() => { try { p.kill() } catch { }; resolve(null) }, 10000) }) }

  /**
   * Transform any ytimg.com thumbnail URL to the highest available resolution.
   * Replaces the quality token (e.g. hqdefault, mqdefault, sddefault, maxresdefault)
   * with maxresdefault so callers always request the best quality.
   */
  function upgradeYtThumbnailUrl(url) {
    if (!url) return url;
    // Upgrade Google User Content / yt3 (true square covers) to 2000x2000
    if (url.includes('lh3.googleusercontent.com') || url.includes('yt3.ggpht.com')) {
      return url.replace(/([=\\-])[ws]\d+(?:-h\d+)?([^?]*)/, '$1w2000-h2000$2');
    }
    // Replace known resolution tokens with maxresdefault
    return url.replace(/(\/(vi|vi_webp)\/[^/]+\/)([^/?#]+)(\.(jpg|webp))/i, '$1maxresdefault$4');
  }

  /**
   * Extract a YouTube video ID from a URL string (watch?v=, youtu.be/, /vi/ in ytimg, etc.)
   */
  function extractYtVideoId(str) {
    if (!str) return null;
    // ytimg.com URL: /vi/<id>/ or /vi_webp/<id>/
    let m = str.match(/\/vi(?:_webp)?\/([a-zA-Z0-9_-]{11})\//);
    if (m) return m[1];
    // Standard YouTube watch URL
    m = str.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
    // youtu.be short URL
    m = str.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
    // youtube.com/shorts/<id>
    m = str.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
    return null;
  }

  /**
   * Fetch the highest-resolution thumbnail available for a YouTube video.
   * Priority order: maxresdefault (1280px) â†’ sddefault (640px) â†’ hqdefault (480px) â†’ fallbackUrl.
   * Returns a Buffer or null.
   */
  async function fetchHDCoverBuffer(videoId, fallbackUrl) {
    const fetchBuf = (url) => new Promise((resolve) => {
      const mod = url.startsWith('https') ? https : require('http');
      const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => {
        if (r.statusCode === 301 || r.statusCode === 302) {
          if (r.headers.location) return resolve(fetchBuf(r.headers.location));
          return resolve(null);
        }
        if (r.statusCode !== 200) return resolve(null);
        const chunks = [];
        r.on('data', c => chunks.push(c));
        r.on('end', () => {
          const buf = Buffer.concat(chunks);
          // ytimg returns a tiny placeholder (~1-3KB) for unavailable sizes
          resolve(buf.length > 5000 ? buf : null);
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    });

    // Check if fallback URL is a native square Google image
    const isNativeSquare = fallbackUrl && (fallbackUrl.includes('lh3.googleusercontent.com') || fallbackUrl.includes('yt3.ggpht.com'));

    // Try native square FIRST, before maxresdefault
    if (isNativeSquare) {
      const upgradedUrl = upgradeYtThumbnailUrl(fallbackUrl);
      const buf = await fetchBuf(upgradedUrl);
      if (buf && buf.length > 10000) { // Native covers should be sizable
        console.log(`[cover] Native square cover fetched (${buf.length} bytes) from ${upgradedUrl}`);
        return buf;
      }
    }

    if (videoId) {
      // Try candidates in quality order
      const candidates = [
        `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      ];
      for (const url of candidates) {
        const buf = await fetchBuf(url);
        if (buf) {
          console.log(`[cover] HD thumbnail fetched (${buf.length} bytes) from ${url}`);
          return buf;
        }
      }
    }

    // Fall back to whatever URL was provided (e.g. from playlist JSON)
    if (fallbackUrl) {
      const upgradedUrl = upgradeYtThumbnailUrl(fallbackUrl);
      // Try upgraded URL first, then original
      for (const url of [upgradedUrl, fallbackUrl]) {
        if (!url) continue;
        const buf = await fetchBuf(url);
        if (buf) {
          console.log(`[cover] Fallback thumbnail fetched (${buf.length} bytes) from ${url}`);
          return buf;
        }
      }
    }

    return null;
  }

  const scheduledJobTimer = setInterval(() => { const j = getScheduled(); const now = new Date(); let ch = false; j.forEach(job => { if (!job.started && job.runAt && new Date(job.runAt) <= now) { job.started = true; ch = true; try { const id = job.id; const td = ensureDownloadsDir(null); if (job.type === 'single') { const bf = path.join(td, `batch-${id}.txt`); fs.writeFileSync(bf, (job.items || []).join('\n'), 'utf8'); const args = ['--batch-file', bf, '--paths', td, '--embed-metadata', '--embed-thumbnail']; if (job.format === 'audio') args.push('-x', '--audio-format', (job.formatStr || 'mp3').split(':')[0] || 'mp3', '--audio-quality', '0'); else args.push('-f', job.formatStr || 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b'); args.push('-o', '%(title)s.%(ext)s'); activeJobs.set(id, { id, type: 'single', args, clients: new Set(), downloadsDir: td, state: { progress: 0, status: 'Se pregÄƒteÈ™te...', currentItem: 0, totalItems: 1 } }); enqueueJob(id) } } catch (err) { console.error('Scheduled job failed:', err) } } }); if (ch) saveScheduled(j) }, 60000)
  scheduledJobTimer.unref?.()

  // â”€â”€ Setup wizard endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const setupMarker = path.join(appDir, 'setup_complete')

  middlewares.use('/api/setup/status', (req, res, next) => {
    const u = new URL(req.url, `http://${req.headers.host}`)
    if (u.pathname !== '/') return next()
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ complete: fs.existsSync(setupMarker) }))
  })

  middlewares.use('/api/setup/complete', async (req, res, next) => {
    const u = new URL(req.url, `http://${req.headers.host}`)
    if (u.pathname !== '/' || req.method !== 'POST') return next()
    try {
      const body = await parseJsonBody(req)
      fs.writeFileSync(setupMarker, '')
      // Persist Spotify creds + preferences into config.json
      let cfg = {}
      try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch { }
      if (body.clientId) cfg.SPOTIFY_CLIENT_ID = body.clientId
      if (body.clientSecret) cfg.SPOTIFY_CLIENT_SECRET = body.clientSecret
      if (body.audioFormat) cfg.audioFormat = body.audioFormat
      if (body.audioQuality) cfg.audioQuality = body.audioQuality
      if (body.customPath) cfg.customPath = body.customPath
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2))
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
  })

  // â”€â”€ Updates API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const releasesPath = path.join(appDir, 'releases.json')

  middlewares.use('/api/updates/history', (req, res, next) => {
    const u = new URL(req.url, `http://${req.headers.host}`)
    if (u.pathname !== '/') return next()
    res.setHeader('Content-Type', 'application/json')
    if (fs.existsSync(releasesPath)) {
      try {
        const data = fs.readFileSync(releasesPath, 'utf8')
        res.end(data)
      } catch (e) {
        res.end(JSON.stringify([]))
      }
    } else {
      res.end(JSON.stringify([]))
    }
  })

  middlewares.use('/api/updates/save', async (req, res, next) => {
    const u = new URL(req.url, `http://${req.headers.host}`)
    if (u.pathname !== '/' || req.method !== 'POST') return next()
    try {
      const body = await parseJsonBody(req)
      fs.writeFileSync(releasesPath, JSON.stringify(body, null, 2), 'utf8')
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ success: true }))
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ success: false, error: e.message }))
    }
  })

  // â”€â”€ Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  middlewares.use('/api/ytdl', (req, res, next) => { metrics.totalHits++; next() })

  middlewares.use('/api/ytdl/get-config', (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(getConfig())) })

  middlewares.use('/api/ytdl/select-folder', (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); const isTemp = u.searchParams.get('temp') === 'true'; const ps = `Add-Type -AssemblyName System.windows.forms\n$f=New-Object System.Windows.Forms.FolderBrowserDialog\n$f.Description='Select download folder'\n$f.ShowNewFolderButton=$true\nif($f.ShowDialog()-eq'OK'){Write-Output $f.SelectedPath}`; const c = spawn('powershell', ['-NoProfile', '-Command', ps]); let s = ''; c.stdout.on('data', d => s += d); c.on('close', () => { const p = s.trim(); if (p) { if (!isTemp) saveConfig({ customPath: p }); res.end(JSON.stringify({ success: true, path: p })) } else res.end(JSON.stringify({ success: false })) }) })

  middlewares.use('/api/ytdl/open-folder', (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); const t = u.searchParams.get('target'); if (t) { const dl = ensureDownloadsDir(u.searchParams.get('customPath')); let tp = path.join(dl, t); if (!fs.existsSync(tp)) { const cl = t.replace(/[^a-zA-Z0-9]/g, '').toLowerCase(); const fm = fs.readdirSync(dl).find(f => f.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === cl); if (fm) tp = path.join(dl, fm); else { res.statusCode = 404; return res.end(JSON.stringify({ success: false, error: 'File not found' })) } }; spawn('explorer.exe', ['/select,', tp]) } else spawn('explorer.exe', [ensureDownloadsDir(u.searchParams.get('customPath'))]); res.end(JSON.stringify({ success: true })) })

  middlewares.use('/api/ytdl/scheduled', (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(getScheduled().filter(j => !j.started))) })
  middlewares.use('/api/ytdl/batch-meta', async (req, res, next) => {
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (u.pathname !== '/') return next();
    if (req.method !== 'POST') {
      res.statusCode = 405;
      return res.end('Method Not Allowed');
    }
    const b = await parseJsonBody(req);
    if (!b.urls || !Array.isArray(b.urls)) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'Missing urls array' }));
    }
    try {
      const poToken = getConfig().youtubePoToken || '';
      const extArgs = getExtractorArgs();
      let args = ['--dump-json', '--no-playlist', '--extractor-args', extArgs, ...b.urls];
      const cp = path.resolve(appDir, 'cookies.txt');
      const cfb = getConfig().cookiesFromBrowser || '';
      if (cfb) args.splice(args.length - b.urls.length, 0, '--cookies-from-browser', cfb);
      else if (fs.existsSync(cp)) args.splice(args.length - b.urls.length, 0, '--cookies', cp);

      const c = spawn(binPath, args);
      let so = '';
      c.stdout.on('data', d => so += d);

      await new Promise((resolve) => {
        c.on('close', resolve);
        c.on('error', resolve);
        setTimeout(() => { c.kill(); resolve(); }, 30000);
      });

      const results = {};
      const lines = so.split('\n').filter(Boolean);
      const cfg = getConfig();
      const cid = cfg.SPOTIFY_CLIENT_ID || process.env.VITE_SPOTIFY_CLIENT_ID || null;
      const cs = cfg.SPOTIFY_CLIENT_SECRET || process.env.VITE_SPOTIFY_CLIENT_SECRET || null;

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.id) {
            let album = parsed.album || null;
            let artistThumbnail = parsed.artist_thumbnail || parsed.artistThumbnail || null;
            let thumbnail = (parsed.thumbnails && parsed.thumbnails.length > 0) ? parsed.thumbnails[parsed.thumbnails.length - 1].url : null;

            if (!album && cid && cs) {
              try {
                let qArtist = parsed.artist || parsed.creator || parsed.channel || parsed.uploader || '';
                let qTitle = parsed.title || '';
                qArtist = qArtist.replace(/VEVO/i, '').replace(/- Topic/i, '').trim();
                qTitle = qTitle.replace(/\(official.*?\)/i, '').replace(/\[official.*?\]/i, '').replace(/\(lyric.*?\)/i, '').trim();
                const q = `${qArtist} ${qTitle}`.trim();

                if (q) {
                  const spotData = await searchSpotifyAPI(q, cid, cs, null);
                  if (spotData && spotData.album) {
                    album = spotData.album;
                  }
                }
              } catch (e) { }
            }

            results[parsed.id] = { album, artistThumbnail, thumbnail };
          }
        } catch (e) { }
      }

      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, results }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  middlewares.use('/api/active-jobs', (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); const yt = Array.from(activeJobs.values()).map(j => ({ id: j.id, title: j.state?.title || j.state?.status || 'YouTube download', thumbnail: j.state?.thumbnail || null, filename: j.state?.finalFilename || null, format: j.state?.format || (j.type === 'playlist' ? 'Playlist' : 'Video'), percent: Number(j.state?.progress || 0), status: j.state?.done ? (j.state?.error ? 'failed' : 'done') : (j.queueStatus === 'queued' ? 'queued' : 'active'), error: j.state?.error || null })); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ youtube: yt, spotify: [] })) })

  middlewares.use('/api/ytdl/job-status', (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); const j = activeJobs.get(u.searchParams.get('jobId')); res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); if (!j) { sendSse(res, { error: 'Job not found or expired' }); return res.end() }; j.clients.add(res); sendSse(res, j.state); req.on('close', () => j.clients.delete(res)) })

  // yt-dlp Auto-update (weekly background check + manual trigger)
  const performYtdlpUpdate = () => new Promise((resolve) => {
    if (!fs.existsSync(binPath)) return resolve(false);
    const p = spawn(binPath, ['-U'], { windowsHide: true });
    p.on('close', (code) => resolve(code === 0));
    p.on('error', () => resolve(false));
  });

  // Weekly background check (runs every 7 days)
  setInterval(() => {
    console.log('[system] Running weekly background yt-dlp update check...');
    performYtdlpUpdate().then(success => {
      if (success) console.log('[system] yt-dlp auto-update successful.');
    });
  }, 7 * 24 * 60 * 60 * 1000);

  middlewares.use('/api/ytdl/update', async (req, res, next) => {
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (u.pathname !== '/') return next();
    res.setHeader('Content-Type', 'application/json');
    const success = await performYtdlpUpdate();
    if (success) {
      res.end(JSON.stringify({ success: true }));
    } else {
      res.end(JSON.stringify({ success: false, error: 'Update failed or yt-dlp not found' }));
    }
  });


  const killProcessTree = (proc) => {
    if (!proc) return;
    try {
      if (process.platform === 'win32' && proc.pid) {
        require('child_process').spawnSync('taskkill', ['/pid', proc.pid, '/f', '/t']);
      } else {
        proc.kill('SIGKILL');
      }
    } catch (e) { }
  };

  middlewares.use('/api/ytdl/job-action', (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); const j = activeJobs.get(u.searchParams.get('jobId')); const a = u.searchParams.get('action'); if (!j) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'Job not found' })) }; if (a === 'pause') { if (!j.isPaused && !j.state.done && j.process) { j.isPaused = true; killProcessTree(j.process); broadcast(u.searchParams.get('jobId'), { isPaused: true, status: 'Pauză.' }) } } else if (a === 'resume') { if (j.isPaused && !j.state.done) { j.isPaused = false; broadcast(u.searchParams.get('jobId'), { isPaused: false, status: 'Se reia...' }); spawnYtDlp(u.searchParams.get('jobId')) } } else if (a === 'cancel') { j.isCancelled = true; if (j.process) killProcessTree(j.process); if (j.collectionDir) { try { fs.rmSync(j.collectionDir, { recursive: true, force: true }) } catch { } }; finishJob(u.searchParams.get('jobId'), { error: 'Anulat.' }); activeJobs.delete(u.searchParams.get('jobId')) } else { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Invalid action' })) }; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: true })) })

  middlewares.use('/api/ytdl/info', async (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); const vid = u.searchParams.get('url'); if (!vid) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'No URL' })) }; if (!fs.existsSync(binPath)) { res.statusCode = 500; return res.end(JSON.stringify({ error: 'yt-dlp not found.' })) }; const extArgs = getExtractorArgs(); let args = ['--dump-json', '--no-playlist', '--playlist-items', '1', '--extractor-args', extArgs, vid]; const cp = path.resolve(appDir, 'cookies.txt'); const cfb = getConfig().cookiesFromBrowser || ''; if (cfb) { args.splice(args.length - 1, 0, '--cookies-from-browser', cfb) } else if (fs.existsSync(cp)) { args.splice(args.length - 1, 0, '--cookies', cp) }; const child = spawn(binPath, args); let ds = '', es = ''; child.stdout.on('data', c => ds += c); child.stderr.on('data', c => es += c); const kt = setTimeout(() => { try { child.kill() } catch { }; if (!res.headersSent) { res.statusCode = 500; res.end(JSON.stringify({ error: 'Timeout.' })) } }, 30000); child.on('close', async code => { clearTimeout(kt); if (res.headersSent) return; if (code !== 0) { res.statusCode = 500; return res.end(JSON.stringify({ error: parseYtDlpError(es) || 'yt-dlp failed.', details: es })) }; try { const info = JSON.parse(ds); const ah = new Set(); (info.formats || []).forEach(f => { if (f.height && f.height >= 360) ah.add(f.height) }); let at = info.channel_thumbnail || info.uploader_thumbnail || null; if (!at && (info.channel_url || info.uploader_url)) { try { const cr = await fetch(info.channel_url || info.uploader_url, { headers: { 'User-Agent': 'Mozilla/5.0' } }); const ch = await cr.text(); const am = ch.match(/"avatar"\s*:\s*\{\s*"thumbnails"\s*:\s*\[\s*\{\s*"url"\s*:\s*"([^"]+)"/i) || ch.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i); at = am?.[1]?.replace(/\\u0026/g, '&').replace(/&amp;/g, '&') || null } catch { } }; const isM = /music\.youtube\.com/i.test(vid) || /youtube:music|music/i.test(info.extractor_key || ''); const hasC = Boolean(info.playlist_count || info.n_entries || info._type === 'playlist' || info.playlist_id); const isP = /[?&]list=/i.test(vid); const isAlbum = isM && info.playlist_id && String(info.playlist_id).startsWith('OLAK5uy_'); const ct = hasC || isP ? (isAlbum ? 'album' : 'playlist') : (isM ? 'track' : 'video'); const cleanPlaylistTitle = info.playlist_title ? info.playlist_title.replace(/^(Album|EP|Single)\s*-\s*/i, '') : null; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ title: (hasC || isP) && cleanPlaylistTitle ? cleanPlaylistTitle : info.title, thumbnail: info.thumbnail, duration: info.duration, uploader: (hasC || isP) ? (info.playlist_uploader || info.playlist_channel || info.uploader || info.channel || null) : (info.uploader || info.channel || null), artistThumbnail: at, contentType: ct, platform: isM ? 'youtube_music' : 'youtube', album: info.album || cleanPlaylistTitle || null, albumArtist: info.album_artist || info.artist || info.uploader || info.channel || null, trackNumber: Number(info.track_number || info.playlist_index) || null, trackCount: Number(info.playlist_count || info.n_entries) || null, releaseYear: info.release_year || (info.release_date ? String(info.release_date).slice(0, 4) : null), viewCount: info.view_count || null, uploadDate: info.upload_date || null, availableHeights: Array.from(ah).sort((a, b) => b - a) })) } catch { res.statusCode = 500; res.end(JSON.stringify({ error: 'Parse error' })) } }) })

  middlewares.use('/api/ytdl/smart-download', (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed') }; let b = ''; req.on('data', c => b += c); req.on('end', () => { try { const d = JSON.parse(b); const { items, format, scope, title, scheduleTime, formatStr, prependNumbers, collectionType, prefixAlbumFolders } = d; if (!items?.length) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'No items' })) }; if (scheduleTime) { const [sh, sm] = scheduleTime.split(':').map(Number); let r = new Date(); r.setHours(sh, sm, 0, 0); if (r <= new Date()) r.setDate(r.getDate() + 1); addScheduledJob({ type: 'single', items, format, scope, title, formatStr, runAt: r.toISOString() }); res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ scheduled: true, runAt: r.toISOString() })) }; const jid = Date.now().toString(); const dl = ensureDownloadsDir(u.searchParams.get('customPath')); const rawCdName = title ? sanitizeFilename(title) : `youtube-playlist-${jid}`; const cleanCdName = rawCdName.replace(/^(Album\s*-\s*)+/i, ''); const cdName = (collectionType === 'album' && prefixAlbumFolders !== false && prefixAlbumFolders !== 'false') ? `Album - ${cleanCdName}` : cleanCdName; const cd = path.join(dl, cdName); const td = scope === 'playlist' ? cd : dl; if (!fs.existsSync(td)) fs.mkdirSync(td, { recursive: true }); const bf = path.join(td, `batch-${jid}.txt`); fs.writeFileSync(bf, items.join('\n'), 'utf8'); const ot = path.join(td, scope === 'playlist' && prependNumbers !== false ? '%(autonumber)03d - %(artist,uploader)s - %(title)s.%(ext)s' : '%(artist,uploader)s - %(title)s.%(ext)s'); let args = format === 'audio' ? ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', ot, '--ffmpeg-location', ffmpegDir] : ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--merge-output-format', 'mp4', '-o', ot, '--ffmpeg-location', ffmpegDir]; if (format === 'audio') args.push('--convert-thumbnails', 'jpg', '--ppa', 'ThumbnailsConvertor+ffmpeg_o:-vf crop=min(iw\\,ih):min(iw\\,ih),scale=1920:1920:flags=lanczos'); args.push('-a', bf, '--newline', '--embed-metadata', '--embed-thumbnail', '--extractor-args', getExtractorArgs(), '--extractor-retries', '5', '--fragment-retries', '10', '--retry-sleep', 'linear=1::2', '--add-header', 'Accept-Language:en-US,en;q=0.9',); const cp = path.resolve(appDir, 'cookies.txt'); const cfb = getConfig().cookiesFromBrowser || ''; if (cfb) { args.push('--cookies-from-browser', cfb) } else if (fs.existsSync(cp)) { args.push('--cookies', cp) }; activeJobs.set(jid, { id: jid, type: scope === 'playlist' ? 'playlist' : 'single', args, downloadsDir: dl, collectionDir: scope === 'playlist' ? cd : undefined, batchFile: bf, clients: new Set(), isPaused: false, isCancelled: false, state: { progress: 0, status: 'Se pregătește...', done: false, isPaused: false, totalItems: items.length, title, thumbnail: d.thumbnail } }); spawnYtDlp(jid); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jobId: jid })) } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) } }) })

  middlewares.use('/api/ytdl/download', (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); const jid = u.searchParams.get('jobId'); if (!jid) { res.statusCode = 400; return res.end('Missing jobId') }; if (activeJobs.has(jid)) { res.statusCode = 400; return res.end('Job exists.') }; const vid = u.searchParams.get('url'); const fmt = u.searchParams.get('format') || 'video:bestvideo[ext=mp4]+bestaudio[ext=m4a]/best'; const sched = u.searchParams.get('scheduleTime'); const title = u.searchParams.get('title') || ''; const thumb = u.searchParams.get('thumbnail') || ''; const preset = u.searchParams.get('preset'); const hwaccel = u.searchParams.get('hwaccel') || 'NONE'; const lac = getOptimalDownloadConfig(preset === 'AUTO' ? null : preset); if (!vid) { res.statusCode = 400; return res.end('No URL') }; if (sched) { const [sh, sm] = sched.split(':').map(Number); let r = new Date(); r.setHours(sh, sm, 0, 0); if (r <= new Date()) r.setDate(r.getDate() + 1); addScheduledJob({ type: 'single', url: vid, format: fmt, scheduleTime: sched, runAt: r.toISOString(), title, thumbnail: thumb }); res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ scheduled: true })) }; res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); const dl = ensureDownloadsDir(u.searchParams.get('customPath')); let args; if (fmt.startsWith('audio:')) { const [, af, aq] = fmt.split(':'); args = af === 'wav' ? ['-f', 'bestaudio/best', '-x', '--audio-format', 'wav', '-o', path.join(dl, '%(artist,uploader)s - %(title)s.%(ext)s'), '--ffmpeg-location', ffmpegDir, vid] : af === 'vorbis' ? ['-f', 'bestaudio/best', '-x', '--audio-format', 'vorbis', '--audio-quality', aq || '0', '-o', path.join(dl, '%(artist,uploader)s - %(title)s.%(ext)s'), '--ffmpeg-location', ffmpegDir, vid] : ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', aq || '0', '-o', path.join(dl, '%(artist,uploader)s - %(title)s.%(ext)s'), '--ffmpeg-location', ffmpegDir, vid] } else if (fmt.startsWith('video:')) { args = ['-f', fmt.substring(6), '--merge-output-format', 'mp4', '-o', path.join(dl, '%(artist,uploader)s - %(title)s.%(ext)s'), '--ffmpeg-location', ffmpegDir, vid] } else { args = ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--merge-output-format', 'mp4', '-o', path.join(dl, '%(artist,uploader)s - %(title)s.%(ext)s'), '--ffmpeg-location', ffmpegDir, vid] }; if (fmt.startsWith('audio:')) args.push('--convert-thumbnails', 'jpg', '--ppa', 'ThumbnailsConvertor+ffmpeg_o:-vf crop=min(iw\\,ih):min(iw\\,ih),scale=1920:1920:flags=lanczos'); args.push('--no-playlist', '--newline', '--embed-metadata', '--embed-thumbnail', '--extractor-args', getExtractorArgs(), '--extractor-retries', '5', '--fragment-retries', '10', '--retry-sleep', 'linear=1::2', '--add-header', 'Accept-Language:en-US,en;q=0.9', '-N', String(lac.ytdlpConcurrentFragments)); let fa = `-threads ${lac.ffmpegThreads}`; if (hwaccel === 'AUTO') fa = '-hwaccel auto ' + fa; else if (hwaccel === 'CUDA') fa = '-hwaccel cuda ' + fa; else if (hwaccel === 'AMF') fa = '-hwaccel d3d11va ' + fa; else if (hwaccel === 'QSV') fa = '-hwaccel qsv ' + fa; args.push('--postprocessor-args', `ffmpeg:-id3v2_version 3 ${fa}`); const cp = path.resolve(appDir, 'cookies.txt'); const cfb = getConfig().cookiesFromBrowser || ''; if (cfb) { args.push('--cookies-from-browser', cfb) } else if (fs.existsSync(cp)) { args.push('--cookies', cp) }; activeJobs.set(jid, { id: jid, type: 'single', args, downloadsDir: dl, clients: new Set([res]), isPaused: false, isCancelled: false, state: { progress: 0, status: 'Se pregătește...', done: false, isPaused: false, title, thumbnail: thumb } }); spawnYtDlp(jid); req.on('close', () => { const j = activeJobs.get(jid); if (j) j.clients.delete(res) }) })

  middlewares.use('/api/ytdl/collection-info', async (req, res, next) => {
    const u = new URL(req.url, 'http://' + req.headers.host); if (u.pathname !== '/') return next(); const vid = u.searchParams.get('url'); if (!vid || !isYouTubeUrl(vid)) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Link YouTube invalid.' })) }; try {
      const pl = await new Promise((resolve, reject) => { const extArgs = getExtractorArgs(); let args = ['--dump-single-json', '--flat-playlist', '-i', '--playlist-end', String(COLLECTION_LIMIT + 1), '--extractor-args', extArgs, vid]; const cp = path.resolve(appDir, 'cookies.txt'); const cfb = getConfig().cookiesFromBrowser || ''; if (cfb) { args.splice(args.length - 1, 0, '--cookies-from-browser', cfb) } else if (fs.existsSync(cp)) { args.splice(args.length - 1, 0, '--cookies', cp) }; const c = spawn(binPath, args); let so = '', se = '', settled = false; const t = setTimeout(() => { if (settled) return; settled = true; c.kill(); reject(new Error('Timeout.')) }, 30000); c.stdout.on('data', d => so += d); c.stderr.on('data', d => se += d); c.on('error', e => { if (!settled) { settled = true; clearTimeout(t); reject(e) } }); c.on('close', code => { if (settled) return; settled = true; clearTimeout(t); if (code !== 0 && !so.trim()) { const ke = parseYtDlpError(se.trim()); return reject(new Error(ke || se.trim() || 'yt-dlp error')) }; try { const p = JSON.parse(so); if (!p) return reject(new Error('Acest playlist este privat sau nu există.')); resolve(p) } catch { reject(new Error('Eroare la procesarea playlist-ului. Verificați link-ul.')) } }) }); const en = (pl.entries || []).filter(Boolean); if (!en.length && pl._type !== 'playlist') throw new Error('No playlist found.'); const cnt = Number(pl.playlist_count || pl.n_entries || en.length);
      const plTitle = pl.title || pl.playlist_title || 'YouTube Playlist';
      let extractedAlbum = null;
      if (plTitle.startsWith('Album - ')) extractedAlbum = plTitle.substring(8);
      else if (plTitle.startsWith('EP - ')) extractedAlbum = plTitle.substring(5);

      let pt = null;
      // For auto-generated albums, pl.thumbnails is often a generic grey box placeholder.
      // We prioritize the first song's thumbnail (the real album cover) ONLY for true auto-generated albums/EPs.
      const isAutoGeneratedAlbum = vid.includes('OLAK5uy_');
      if (!isAutoGeneratedAlbum) {
        pt = pl.thumbnails ? pl.thumbnails[pl.thumbnails.length - 1]?.url : null;
      }
      if (!pt && en.length > 0) {
        pt = en[0].thumbnails ? en[0].thumbnails[en[0].thumbnails.length - 1]?.url : (en[0].thumbnail || null);
      }

      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ title: plTitle, uploader: pl.uploader || pl.channel || null, thumbnail: pt, count: cnt, downloadableCount: Math.min(cnt || en.length, COLLECTION_LIMIT), isTruncated: cnt > COLLECTION_LIMIT, entries: en.slice(0, COLLECTION_LIMIT).map((e, i) => ({ id: e.id, index: i + 1, title: e.title || 'Video fÄƒrÄƒ titlu', uploader: e.uploader || e.channel || null, duration: e.duration || null, album: e.album || extractedAlbum || null, thumbnail: e.thumbnails ? e.thumbnails[e.thumbnails.length - 1]?.url : (e.thumbnail || null), view_count: e.view_count || e.popularity || 0 })) }))
    } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }
  })

  middlewares.use('/api/ytdl/collection-download', (req, res, next) => { const u = new URL(req.url, 'http://' + req.headers.host); if (u.pathname !== '/') return next(); const jid = u.searchParams.get('jobId'); if (!jid) { res.statusCode = 400; return res.end('Missing jobId') }; if (activeJobs.has(jid)) { res.statusCode = 400; return res.end('Job exists.') }; const vid = u.searchParams.get('url'); const fmt = u.searchParams.get('format') || 'video:bestvideo[ext=mp4]+bestaudio[ext=m4a]/best'; const sel = u.searchParams.get('selectedItems'); const sched = u.searchParams.get('scheduleTime'); const title = u.searchParams.get('title') || ''; const thumb = u.searchParams.get('thumbnail') || ''; const hwaccel = u.searchParams.get('hwaccel') || 'NONE'; const prependNumbers = u.searchParams.get('prependNumbers') !== 'false'; if (!vid || !isYouTubeUrl(vid) || !sel) { res.statusCode = 400; return res.end('Invalid.') }; if (sched) { const [sh, sm] = sched.split(':').map(Number); let r = new Date(); r.setHours(sh, sm, 0, 0); if (r <= new Date()) r.setDate(r.getDate() + 1); addScheduledJob({ type: 'playlist', url: vid, format: fmt, selectedItems: sel, scheduleTime: sched, runAt: r.toISOString(), title, thumbnail: thumb }); res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ scheduled: true })) }; res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); const dl = ensureDownloadsDir(u.searchParams.get('customPath')); const cd = path.join(dl, title ? sanitizeFilename(title) : 'youtube-playlist-' + jid); fs.mkdirSync(cd, { recursive: true }); const ot = path.join(cd, prependNumbers ? '%(playlist_index)03d - %(artist,uploader)s - %(title)s.%(ext)s' : '%(artist,uploader)s - %(title)s.%(ext)s'); let args; if (fmt.startsWith('audio:')) { const [, af, aq] = fmt.split(':'); const vaf = ['mp3', 'wav', 'vorbis'].includes(af) ? af : 'mp3'; const vaq = /^\d+$/.test(aq || '') ? aq : '0'; args = ['-x', '--audio-format', vaf, '-o', ot, '--ffmpeg-location', ffmpegDir]; if (vaf !== 'wav') args.splice(3, 0, '--audio-quality', vaq) } else { const vf = fmt.startsWith('video:') ? fmt.substring(6) : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'; args = ['-f', vf, '--merge-output-format', 'mp4', '-o', ot, '--ffmpeg-location', ffmpegDir] }; if (fmt.startsWith('audio:')) args.push('--convert-thumbnails', 'jpg', '--ppa', 'ThumbnailsConvertor+ffmpeg_o:-vf crop=min(iw\\,ih):min(iw\\,ih),scale=1920:1920:flags=lanczos'); args.push('-i', '--yes-playlist', '--playlist-items', sel, '--newline', '--embed-metadata', '--embed-thumbnail', '--extractor-args', getExtractorArgs(), '--extractor-retries', '5', '--fragment-retries', '10', '--retry-sleep', 'linear=1::2', '--add-header', 'Accept-Language:en-US,en;q=0.9', '-N', String(aiConfig.ytdlpConcurrentFragments)); let fa = `-threads ${aiConfig.ffmpegThreads}`; if (hwaccel === 'AUTO') fa = '-hwaccel auto ' + fa; else if (hwaccel === 'CUDA') fa = '-hwaccel cuda ' + fa; else if (hwaccel === 'AMF') fa = '-hwaccel d3d11va ' + fa; else if (hwaccel === 'QSV') fa = '-hwaccel qsv ' + fa; args.push('--postprocessor-args', `ffmpeg:-id3v2_version 3 ${fa}`, vid); const cp = path.resolve(appDir, 'cookies.txt'); const cfb = getConfig().cookiesFromBrowser || ''; if (cfb) { args.splice(args.length - 1, 0, '--cookies-from-browser', cfb) } else if (fs.existsSync(cp)) { args.splice(args.length - 1, 0, '--cookies', cp) }; activeJobs.set(jid, { id: jid, type: 'playlist', args, downloadsDir: dl, collectionDir: cd, expectedCount: sel.split(',').length, clients: new Set([res]), isPaused: false, isCancelled: false, state: { progress: 0, status: 'Se pregÄƒteÈ™te playlistul...', done: false, isPaused: false, title, thumbnail: thumb } }); spawnYtDlp(jid); req.on('close', () => { const j = activeJobs.get(jid); if (j) j.clients.delete(res) }) })

  // â”€â”€ YouTube Music per-track fallback download (10-attempt chain) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // 100% download rate goal: tries 10 sources per track before giving up.
  // Each failed track is logged to pending_manual.json with full attempt history.

  // Levenshtein distance for smart title matching
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    return dp[m][n];
  }
  function stringSimilarity(a, b) {
    if (!a || !b) return 0;
    const s1 = a.toLowerCase().trim(), s2 = b.toLowerCase().trim();
    if (s1 === s2) return 1;
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1;
    return (maxLen - levenshtein(s1, s2)) / maxLen;
  }

  // Rate limit state â€” shared across concurrent downloads for a session
  let yt429PauseUntil = 0;

  middlewares.use('/api/ytdl/ytmusic-playlist-download', (req, res, next) => {
    const u = new URL(req.url, 'http://' + req.headers.host);
    if (u.pathname !== '/') return next();

    const playlistUrl = u.searchParams.get('url');
    const fmtParam = u.searchParams.get('format') || 'audio:mp3:0';
    const title = u.searchParams.get('title') || '';
    const thumbnail = u.searchParams.get('thumbnail') || '';
    const selectedParam = u.searchParams.get('selectedItems') || '';
    const customPath = u.searchParams.get('customPath') || '';
    const concurrency = Math.min(3, Math.max(1, parseInt(u.searchParams.get('concurrency') || '3', 10)));
    const prependNumbers = u.searchParams.get('prependNumbers') !== 'false';
    const prefixAlbumFolders = u.searchParams.get('prefixAlbumFolders') !== 'false';
    const collectionType = u.searchParams.get('collectionType') || 'playlist';

    if (!playlistUrl) { res.statusCode = 400; return res.end('Missing url'); }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`) } catch { } };
    const dlState = { cancelled: false, procs: new Set() };

    // â”€â”€ Parse format â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const [, audioFmt = 'mp3'] = fmtParam.startsWith('audio:') ? fmtParam.split(':') : ['audio', 'mp3'];
    const safeAudioFmt = ['mp3', 'm4a', 'wav', 'vorbis'].includes(audioFmt) ? audioFmt : 'mp3';

    // â”€â”€ Error classifiers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const PREMIUM_MARKERS = ['Music Premium', 'Premium members', 'Premium-only', 'YouTube Premium', 'available to Music Premium'];
    const RECOVERABLE_MARKERS = [
      'Video unavailable', 'Private video', 'HTTP Error 403', 'HTTP Error 404', 'HTTP Error 410',
      'Sign in to confirm', 'This video is not available', 'region', 'geo-restrict',
      'Network error', 'timed out', 'Connection reset', 'No video formats found', 'DRM',
      'Requested format is not available', 'No downloadable formats'
    ];
    const RATE_LIMIT_MARKERS = ['HTTP Error 429', 'Too Many Requests', '429'];
    const BAD_MATCH_RE = /\b(remix|remixed|live\s+at|live\s+from|live\s+version|live\s+concert|slowed|reverb|8d\s+audio|8d|nightcore|sped\s+up|karaoke|instrumental\s+version|cover\s+by|covered\s+by)\b/i;

    const isPremiumError = s => PREMIUM_MARKERS.some(m => s.includes(m));
    const isRecoverableError = s => RECOVERABLE_MARKERS.some(m => s.toLowerCase().includes(m.toLowerCase()));
    const isRateLimited = s => RATE_LIMIT_MARKERS.some(m => s.includes(m));

    // â”€â”€ Candidate scoring â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const cleanStr = s => (s || '').toLowerCase()
      .replace(/\(official.*?\)/gi, '').replace(/\[official.*?\]/gi, '')
      .replace(/\s*-\s*topic\s*$/i, '').replace(/vevo$/i, '')
      .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

    const wordOverlap = (a, b) => {
      const wa = new Set(cleanStr(a).split(' ').filter(w => w.length > 2));
      const wb = new Set(cleanStr(b).split(' ').filter(w => w.length > 2));
      if (!wa.size || !wb.size) return 0;
      let hits = 0; for (const w of wa) if (wb.has(w)) hits++;
      return hits / Math.max(wa.size, wb.size);
    };

    const scoreCandidate = (candidate, origTitle, origArtist, origDurationSec) => {
      let score = 0;
      const ct = cleanStr(candidate.title);
      const ot = cleanStr(origTitle);
      const ch = cleanStr(candidate.channel || candidate.uploader || '');
      const oa = cleanStr(origArtist);

      // Title similarity
      const titleSim = wordOverlap(ct, ot);
      score += titleSim * 40;
      // Also check Levenshtein similarity (60% threshold required to pass)
      const levSim = stringSimilarity(ct, ot);
      if (levSim < 0.6) score -= 20; // penalise low-similarity titles

      // Artist / channel match
      if (ch.includes(oa) || oa.includes(ch) || wordOverlap(ch, oa) > 0.5) score += 30;

      // Duration proximity
      if (origDurationSec > 0 && candidate.duration > 0) {
        const diff = Math.abs(candidate.duration - origDurationSec);
        if (diff <= 10) score += 20;
        else if (diff <= 35) score += 20 * (1 - (diff - 10) / 25);
        else if (diff > 60) score -= 10;
      }

      // Official signals bonus
      if ((candidate.channel || '').endsWith('- Topic')) score += 8;
      if ((candidate.channel || '').toLowerCase().includes('vevo')) score += 5;
      if (candidate.title.toLowerCase().includes('official audio')) score += 7;
      if (candidate.title.toLowerCase().includes('official')) score += 3;

      // Bad match penalty (avoid covers/lives/remixes as primary result)
      if (BAD_MATCH_RE.test(candidate.title)) score -= 50;

      return score;
    };

    // â”€â”€ Sleep helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // â”€â”€ Run yt-dlp and return {ok, stderr, stdout} â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const runYtdlp = (args, { timeout = 90000 } = {}) => new Promise(resolve => {
      if (dlState.cancelled) return resolve({ ok: false, stderr: 'cancelled' });
      const cookiesPath = path.resolve(appDir, 'cookies.txt');
      const cfb = getConfig().cookiesFromBrowser || '';
      const fullArgs = [...args];
      if (cfb) fullArgs.push('--cookies-from-browser', cfb);
      else if (fs.existsSync(cookiesPath)) fullArgs.push('--cookies', cookiesPath);

      const proc = spawn(binPath, fullArgs, {
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
      });
      dlState.procs.add(proc);
      let stdout = '', stderr = '';
      proc.stdout.on('data', c => { stdout += c.toString(); });
      proc.stderr.on('data', c => { stderr += c.toString(); });
      const timer = setTimeout(() => { try { proc.kill(); } catch { } }, timeout);
      proc.on('close', code => {
        clearTimeout(timer);
        dlState.procs.delete(proc);
        resolve({ ok: code === 0, code, stdout, stderr });
      });
      proc.on('error', e => { clearTimeout(timer); dlState.procs.delete(proc); resolve({ ok: false, stderr: e.message }); });
    });

    // â”€â”€ Run spotdl for Spotify fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const runSpotdl = (artist, trackTitle, outputDir) => new Promise(resolve => {
      if (dlState.cancelled) return resolve({ ok: false, stderr: 'cancelled' });
      if (!fs.existsSync(spotdlBin)) return resolve({ ok: false, stderr: 'spotdl not found' });
      const query = `${artist} ${trackTitle}`;
      const proc = spawn(spotdlBin, ['download', query, '--output', outputDir, '--format', safeAudioFmt], {
        windowsHide: true,
        env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
      });
      dlState.procs.add(proc);
      let stdout = '', stderr = '';
      proc.stdout.on('data', c => { stdout += c.toString(); });
      proc.stderr.on('data', c => { stderr += c.toString(); });
      const timer = setTimeout(() => { try { proc.kill(); } catch { } }, 120000);
      proc.on('close', code => {
        clearTimeout(timer);
        dlState.procs.delete(proc);
        resolve({ ok: code === 0, code, stdout, stderr });
      });
      proc.on('error', e => { clearTimeout(timer); dlState.procs.delete(proc); resolve({ ok: false, stderr: e.message }); });
    });

    // â”€â”€ Build base yt-dlp audio-download args â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const buildDownloadArgs = (videoUrl, outputTemplate, extraArgs = []) => {
      const baseArgs = [
        videoUrl,
        '-f', 'bestaudio/best',
        '-x', '--audio-format', safeAudioFmt, '--audio-quality', '0',
        '--ffmpeg-location', ffmpegDir,
        '-o', outputTemplate,
        '--no-playlist', '--playlist-items', '1',
        '--embed-metadata',
        '--embed-thumbnail',
        '--convert-thumbnails', 'jpg',
        '--extractor-args', getExtractorArgs(),
        '--socket-timeout', '30',
        '--retries', '10',
        '--fragment-retries', '10',
        '--ignore-errors',
        '--no-abort-on-error',
        '--prefer-free-formats',
        '--add-metadata',
        '--geo-bypass',
        '--retry-sleep', 'linear=1::2',
        '--add-header', 'Accept-Language:en-US,en;q=0.9',
        '--newline',
        ...extraArgs
      ];
      return baseArgs;
    };

    // â”€â”€ Download a single track URL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const downloadSingleTrack = async (videoUrl, outputTemplate, extraArgs = []) => {
      const args = buildDownloadArgs(videoUrl, outputTemplate, extraArgs);
      return runYtdlp(args);
    };

    // â”€â”€ Search yt-dlp for candidates and score them â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const searchAndScore = async (query, origTitle, origArtist, durationSec, extraArgs = []) => {
      await sleep(2000); // 2s delay between search requests
      if (dlState.cancelled) return null;
      const result = await runYtdlp([
        query,
        '--dump-json', '--flat-playlist', '--no-warnings',
        '--playlist-end', '10',
        '--extractor-args', getExtractorArgs(),
        ...extraArgs
      ], { timeout: 30000 });
      if (!result.stdout) return null;

      const candidates = result.stdout.split('\n').filter(Boolean).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);

      if (!candidates.length) return null;

      const scored = candidates
        .map(c => ({ ...c, _score: scoreCandidate(c, origTitle, origArtist, durationSec) }))
        .sort((a, b) => b._score - a._score);

      const best = scored[0];
      if (best && best._score >= 30) {
        const videoId = best.id || best.url;
        return {
          url: videoId.startsWith('http') ? videoId : `https://www.youtube.com/watch?v=${videoId}`,
          title: best.title,
          score: best._score,
        };
      }
      return null;
    };

    // â”€â”€ Log helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const appendSessionLog = (logsDir, entry, attemptNum, source, result, reason) => {
      try {
        const line = `[${new Date().toISOString()}] Track: "${entry.title}" | Artist: "${entry.artist}" | Attempt: ${attemptNum}/10 | Source: ${source} | Result: ${result}${reason ? ' | Reason: ' + reason : ''}\n`;
        fs.appendFileSync(path.join(logsDir, 'session_log.txt'), line, 'utf8');
      } catch { }
    };

    const writeDownloadedLog = (logsDir, entry, source, attemptNum, quality) => {
      try {
        const logPath = path.join(logsDir, 'downloaded.json');
        let log = [];
        try { log = JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch { }
        log.push({ track: entry.title, artist: entry.artist, source, attempt_number: attemptNum, quality, timestamp: new Date().toISOString() });
        fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf8');
      } catch { }
    };

    const writePendingManual = (logsDir, entry, attemptLog) => {
      try {
        const logPath = path.join(logsDir, 'pending_manual.json');
        let log = [];
        try { log = JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch { }
        log.push({ track: entry.title, artist: entry.artist, url: entry.url, timestamp: new Date().toISOString(), attempts: attemptLog });
        fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf8');
      } catch { }
    };

    // â”€â”€ Main runner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const runDownload = async () => {
      const downloadsDir = ensureDownloadsDir(customPath);
      const rawTitle = title ? sanitizeFilename(title) : `ytmusic-playlist-${Date.now()}`;
      const cleanTitle = rawTitle.replace(/^(Album\s*-\s*)+/i, ''); const safeTitle = (collectionType === 'album' && prefixAlbumFolders !== false && prefixAlbumFolders !== 'false') ? `Album - ${cleanTitle}` : cleanTitle;
      const outputDir = path.join(downloadsDir, safeTitle);
      const logsDir = path.join(outputDir, 'logs');
      fs.mkdirSync(outputDir, { recursive: true });
      fs.mkdirSync(logsDir, { recursive: true });

      send({ status: 'Fetching playlist info...', progress: 2 });

      // Step 1: get flat playlist metadata
      const flatResult = await runYtdlp([
        '--flat-playlist', '--dump-json', '--no-warnings',
        '--playlist-end', '5000',
        '--extractor-args', getExtractorArgs(),
        playlistUrl,
      ]);

      if (dlState.cancelled) return;

      // Parse flat playlist entries
      let allEntries = [];
      for (const line of (flatResult.stdout || '').split('\n')) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line);
          allEntries.push({
            id: j.id,
            url: `https://music.youtube.com/watch?v=${j.id}`,
            title: j.title || j.id,
            artist: j.channel || j.uploader || '',
            duration: j.duration || 0,
            thumbnail: j.thumbnails?.[j.thumbnails.length - 1]?.url || j.thumbnail || null,
            album: j.album || null,
            trackNumber: j.playlist_index ?? j.track_number ?? null,
          });
        } catch { }
      }

      const totalTracksCount = allEntries.length;
      for (const e of allEntries) { e.totalTracks = totalTracksCount; }

      if (!allEntries.length) {
        send({ done: true, error: 'Could not read playlist entries.' });
        return res.end();
      }

      // Filter to selected indices (1-based)
      let selectedSet = null;
      if (selectedParam) {
        selectedSet = new Set(selectedParam.split(',').map(Number).filter(n => !isNaN(n)));
      }
      const entries = selectedSet
        ? allEntries.filter((_, i) => selectedSet.has(i + 1))
        : allEntries;

      const totalTracks = entries.length;
      if (!totalTracks) {
        send({ done: true, error: 'No tracks selected.' });
        return res.end();
      }

      send({ totalTracks, status: `Starting download of ${totalTracks} tracks...`, progress: 3 });

      let completedCount = 0;
      let pendingManualCount = 0;
      const pendingManualTracksData = [];
      const activePromises = new Set();

      for (let i = 0; i < entries.length; i++) {
        if (dlState.cancelled) break;

        // Respect concurrency limit (max 3)
        while (activePromises.size >= concurrency) {
          await Promise.race(activePromises);
        }
        if (dlState.cancelled) break;

        const entry = entries[i];
        const trackIndex = i + 1;

        const task = (async () => {
          const safeArtist = (entry.artist || '').replace(/[<>:"/\\|?*]+/g, '_');
          const safeTrackTitle = (entry.title || '').replace(/[<>:"/\\|?*]+/g, '_');
          const trackNum = prependNumbers ? String(trackIndex).padStart(3, '0') + ' - ' : '';
          const baseName = `${trackNum}${safeArtist ? safeArtist + ' - ' : ''}${safeTrackTitle}`;
          const outputTemplate = path.join(outputDir, `${baseName}.%(ext)s`);

          const calcProgress = () => Math.round(3 + ((completedCount + pendingManualCount) / totalTracks) * 90);

          const attemptLog = []; // record each attempt for pending_manual.json

          // â”€â”€ Find a downloaded file in outputDir matching baseName â”€â”€â”€â”€â”€â”€â”€â”€â”€
          const findDownloadedFile = () => {
            const finalPath = path.join(outputDir, `${baseName}.${safeAudioFmt}`);
            if (fs.existsSync(finalPath)) return finalPath;
            try {
              const all = fs.readdirSync(outputDir);
              const match = all.find(f => f.startsWith(baseName) && !f.endsWith('.part') && !f.endsWith('.ytdl'));
              if (match) return path.join(outputDir, match);
            } catch { }
            return null;
          };

          // â”€â”€ Attempt 1: Direct YTM URL + geo-bypass â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          send({
            currentTrack: trackIndex, totalTracks,
            trackTitle: entry.title, trackArtist: entry.artist,
            trackThumbnail: entry.thumbnail || null,
            status: `Downloading: ${entry.title}`,
            attemptNumber: 1, attemptSource: 'YouTube Music',
            progress: calcProgress(),
          });

          let downloadedFile = null;
          let lastError = '';

          // Wait if rate-limited
          if (yt429PauseUntil > Date.now()) {
            const waitMs = yt429PauseUntil - Date.now();
            send({ rateLimited: true, waitSeconds: Math.ceil(waitMs / 1000), trackTitle: entry.title });
            appendSessionLog(logsDir, entry, 1, 'YouTube Music', 'rate-limited', `429 pause for ${Math.ceil(waitMs / 1000)}s`);
            await sleep(waitMs);
          }

          let result1 = await downloadSingleTrack(entry.url, outputTemplate);
          lastError = result1.stderr || '';
          if (isRateLimited(lastError)) {
            yt429PauseUntil = Date.now() + 60000;
            send({ rateLimited: true, waitSeconds: 60, trackTitle: entry.title });
            appendSessionLog(logsDir, entry, 1, 'YouTube Music', 'rate-limited', '429 â€” pausing 60s');
            await sleep(60000);
            // Retry attempt 1 after pause
            result1 = await downloadSingleTrack(entry.url, outputTemplate);
            lastError = result1.stderr || '';
          }
          downloadedFile = findDownloadedFile();

          if (downloadedFile) {
            appendSessionLog(logsDir, entry, 1, 'YouTube Music', 'SUCCESS', null);
            attemptLog.push({ attempt: 1, source: 'YouTube Music', result: 'success' });
          } else {
            attemptLog.push({ attempt: 1, source: 'YouTube Music', result: 'failed', reason: lastError.slice(0, 200) });
            appendSessionLog(logsDir, entry, 1, 'YouTube Music', 'failed', lastError.slice(0, 200));
          }

          // â”€â”€ Attempt 2: YT search v1 â€” "{artist} {title}" â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          if (!downloadedFile && !dlState.cancelled) {
            send({
              currentTrack: trackIndex, totalTracks,
              trackTitle: entry.title, trackArtist: entry.artist,
              trackThumbnail: entry.thumbnail || null,
              status: `Retrying (2/10 â€” YouTube search)...`,
              attemptNumber: 2, attemptSource: 'YouTube',
              progress: calcProgress(),
            });
            if (yt429PauseUntil > Date.now()) await sleep(yt429PauseUntil - Date.now());
            const q2 = `ytsearch3:${entry.artist} ${entry.title} audio`;
            const fb2 = await searchAndScore(q2, entry.title, entry.artist, entry.duration);
            if (fb2 && !dlState.cancelled) {
              const r2 = await downloadSingleTrack(fb2.url, outputTemplate);
              lastError = r2.stderr || '';
              if (isRateLimited(lastError)) { yt429PauseUntil = Date.now() + 60000; send({ rateLimited: true, waitSeconds: 60, trackTitle: entry.title }); await sleep(60000); }
              downloadedFile = findDownloadedFile();
            }
            if (downloadedFile) {
              appendSessionLog(logsDir, entry, 2, 'YouTube', 'SUCCESS', fb2?.title);
              attemptLog.push({ attempt: 2, source: 'YouTube', result: 'success', match: fb2?.title });
            } else {
              attemptLog.push({ attempt: 2, source: 'YouTube', result: 'failed' });
              appendSessionLog(logsDir, entry, 2, 'YouTube', 'failed', 'No match found');
            }
          }

          // â”€â”€ Attempt 3: YT search v2 â€” "{title} audio" â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          if (!downloadedFile && !dlState.cancelled) {
            send({
              currentTrack: trackIndex, totalTracks,
              trackTitle: entry.title, trackArtist: entry.artist,
              trackThumbnail: entry.thumbnail || null,
              status: `Retrying (3/10 â€” YouTube audio search)...`,
              attemptNumber: 3, attemptSource: 'YouTube',
              progress: calcProgress(),
            });
            if (yt429PauseUntil > Date.now()) await sleep(yt429PauseUntil - Date.now());
            const q3 = `ytsearch3:${entry.artist} ${entry.title} topic`;
            const fb3 = await searchAndScore(q3, entry.title, entry.artist, entry.duration);
            if (fb3 && !dlState.cancelled) {
              const r3 = await downloadSingleTrack(fb3.url, outputTemplate);
              lastError = r3.stderr || '';
              if (isRateLimited(lastError)) { yt429PauseUntil = Date.now() + 60000; send({ rateLimited: true, waitSeconds: 60, trackTitle: entry.title }); await sleep(60000); }
              downloadedFile = findDownloadedFile();
            }
            if (downloadedFile) {
              appendSessionLog(logsDir, entry, 3, 'YouTube', 'SUCCESS', fb3?.title);
              attemptLog.push({ attempt: 3, source: 'YouTube', result: 'success', match: fb3?.title });
            } else {
              attemptLog.push({ attempt: 3, source: 'YouTube', result: 'failed' });
              appendSessionLog(logsDir, entry, 3, 'YouTube', 'failed', 'No match found');
            }
          }

          // â”€â”€ Attempt 4: YT with US geo-spoof â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          if (!downloadedFile && !dlState.cancelled) {
            send({
              currentTrack: trackIndex, totalTracks,
              trackTitle: entry.title, trackArtist: entry.artist,
              trackThumbnail: entry.thumbnail || null,
              status: `Retrying (4/10 â€” YouTube US geo-spoof)...`,
              attemptNumber: 4, attemptSource: 'YouTube (US)',
              progress: calcProgress(),
            });
            if (yt429PauseUntil > Date.now()) await sleep(yt429PauseUntil - Date.now());
            await sleep(2000);
            const q4 = `ytsearch1:${entry.artist} ${entry.title}`;
            const fb4 = await searchAndScore(q4, entry.title, entry.artist, entry.duration, ['--geo-bypass-country', 'US']);
            if (fb4 && !dlState.cancelled) {
              const r4 = await downloadSingleTrack(fb4.url, outputTemplate, ['--geo-bypass-country', 'US']);
              lastError = r4.stderr || '';
              if (isRateLimited(lastError)) { yt429PauseUntil = Date.now() + 60000; send({ rateLimited: true, waitSeconds: 60, trackTitle: entry.title }); await sleep(60000); }
              downloadedFile = findDownloadedFile();
            }
            if (downloadedFile) {
              appendSessionLog(logsDir, entry, 4, 'YouTube (US geo-spoof)', 'SUCCESS', fb4?.title);
              attemptLog.push({ attempt: 4, source: 'YouTube (US geo-spoof)', result: 'success', match: fb4?.title });
            } else {
              attemptLog.push({ attempt: 4, source: 'YouTube (US geo-spoof)', result: 'failed' });
              appendSessionLog(logsDir, entry, 4, 'YouTube (US geo-spoof)', 'failed', 'No match found');
            }
          }

          // â”€â”€ Attempt 5: YouTube with browser cookies (Premium bypass) â”€â”€â”€â”€â”€
          if (!downloadedFile && !dlState.cancelled) {
            send({
              currentTrack: trackIndex, totalTracks,
              trackTitle: entry.title, trackArtist: entry.artist,
              trackThumbnail: entry.thumbnail || null,
              status: `Retrying (5/10 â€” YouTube Premium bypass via cookies)...`,
              attemptNumber: 5, attemptSource: 'YouTube (cookies)',
              progress: calcProgress(),
            });
            if (yt429PauseUntil > Date.now()) await sleep(yt429PauseUntil - Date.now());
            // Build args manually here â€” force cookies-from-browser chrome even if config differs
            const cookieArgs = ['--cookies-from-browser', 'chrome', '--geo-bypass'];
            const r5 = await runYtdlp([
              entry.url,
              '-x', '--audio-format', safeAudioFmt, '--audio-quality', '0',
              '--ffmpeg-location', ffmpegDir,
              '-o', outputTemplate,
              '--no-playlist', '--playlist-items', '1',
              '--embed-metadata', '--embed-thumbnail', '--convert-thumbnails', 'jpg',
              '--extractor-args', getExtractorArgs(),
              '--socket-timeout', '30', '--retries', '10', '--fragment-retries', '10',
              '--newline', ...cookieArgs
            ]);
            lastError = r5.stderr || '';
            if (isRateLimited(lastError)) { yt429PauseUntil = Date.now() + 60000; send({ rateLimited: true, waitSeconds: 60, trackTitle: entry.title }); await sleep(60000); }
            downloadedFile = findDownloadedFile();
            if (downloadedFile) {
              appendSessionLog(logsDir, entry, 5, 'YouTube (cookies)', 'SUCCESS', null);
              attemptLog.push({ attempt: 5, source: 'YouTube (cookies)', result: 'success' });
            } else {
              attemptLog.push({ attempt: 5, source: 'YouTube (cookies)', result: 'failed', reason: lastError.slice(0, 200) });
              appendSessionLog(logsDir, entry, 5, 'YouTube (cookies)', 'failed', lastError.slice(0, 200));
            }
          }

          // â”€â”€ Attempt 6: SoundCloud search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          if (!downloadedFile && !dlState.cancelled) {
            send({
              currentTrack: trackIndex, totalTracks,
              trackTitle: entry.title, trackArtist: entry.artist,
              trackThumbnail: entry.thumbnail || null,
              status: `Retrying (6/10 â€” SoundCloud)...`,
              attemptNumber: 6, attemptSource: 'SoundCloud',
              progress: calcProgress(),
            });
            await sleep(2000);
            const scQuery = `scsearch3:${entry.artist} ${entry.title}`;
            // SoundCloud: search and pick best by score
            const scSearchResult = await runYtdlp([
              scQuery,
              '--dump-json', '--flat-playlist', '--no-warnings',
              '--playlist-end', '5',
            ], { timeout: 30000 });
            let scFallback = null;
            if (scSearchResult.stdout) {
              const scCandidates = scSearchResult.stdout.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
              const scScored = scCandidates.map(c => ({ ...c, _score: scoreCandidate(c, entry.title, entry.artist, entry.duration) })).sort((a, b) => b._score - a._score);
              if (scScored[0] && scScored[0]._score >= 20) {
                const vid = scScored[0].id || scScored[0].url || scScored[0].webpage_url;
                scFallback = { url: vid.startsWith('http') ? vid : `https://soundcloud.com/${vid}`, title: scScored[0].title };
              }
            }
            if (scFallback && !dlState.cancelled) {
              const r6 = await downloadSingleTrack(scFallback.url, outputTemplate);
              lastError = r6.stderr || '';
              downloadedFile = findDownloadedFile();
            }
            if (downloadedFile) {
              appendSessionLog(logsDir, entry, 6, 'SoundCloud', 'SUCCESS', scFallback?.title);
              attemptLog.push({ attempt: 6, source: 'SoundCloud', result: 'success', match: scFallback?.title });
            } else {
              attemptLog.push({ attempt: 6, source: 'SoundCloud', result: 'failed' });
              appendSessionLog(logsDir, entry, 6, 'SoundCloud', 'failed', scFallback ? lastError.slice(0, 200) : 'No SoundCloud match found');
            }
          }

          // â”€â”€ Attempt 7: Spotify via spotdl â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          if (!downloadedFile && !dlState.cancelled) {
            send({
              currentTrack: trackIndex, totalTracks,
              trackTitle: entry.title, trackArtist: entry.artist,
              trackThumbnail: entry.thumbnail || null,
              status: `Retrying (7/10 â€” Spotify / spotdl)...`,
              attemptNumber: 7, attemptSource: 'Spotify',
              progress: calcProgress(),
            });
            const filesBefore = fs.existsSync(outputDir) ? new Set(fs.readdirSync(outputDir)) : new Set();
            const r7 = await runSpotdl(entry.artist, entry.title, outputDir);
            // Find any new file created by spotdl
            if (fs.existsSync(outputDir)) {
              const filesAfter = fs.readdirSync(outputDir);
              const newFile = filesAfter.find(f => !filesBefore.has(f) && (f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.flac')));
              if (newFile) {
                downloadedFile = path.join(outputDir, newFile);
                // Rename to match our naming convention
                try {
                  const targetPath = path.join(outputDir, `${baseName}.${safeAudioFmt}`);
                  if (downloadedFile !== targetPath) fs.renameSync(downloadedFile, targetPath);
                  downloadedFile = fs.existsSync(targetPath) ? targetPath : downloadedFile;
                } catch { }
              }
            }
            if (downloadedFile) {
              appendSessionLog(logsDir, entry, 7, 'Spotify (spotdl)', 'SUCCESS', null);
              attemptLog.push({ attempt: 7, source: 'Spotify (spotdl)', result: 'success' });
            } else {
              attemptLog.push({ attempt: 7, source: 'Spotify (spotdl)', result: 'failed', reason: r7.stderr?.slice(0, 200) || 'spotdl failed or not found' });
              appendSessionLog(logsDir, entry, 7, 'Spotify (spotdl)', 'failed', r7.stderr?.slice(0, 200) || 'not found');
            }
          }

          // â”€â”€ Attempt 8: Internet Archive â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          if (!downloadedFile && !dlState.cancelled) {
            send({
              currentTrack: trackIndex, totalTracks,
              trackTitle: entry.title, trackArtist: entry.artist,
              trackThumbnail: entry.thumbnail || null,
              status: `Retrying (8/10 â€” Internet Archive)...`,
              attemptNumber: 8, attemptSource: 'Archive.org',
              progress: calcProgress(),
            });
            await sleep(2000);
            const archiveQuery = encodeURIComponent(`${entry.artist} ${entry.title}`);
            const archiveUrl = `https://archive.org/search?query=${archiveQuery}&and[]=mediatype%3A%22audio%22&output=json&rows=5`;
            // Search Archive.org API for matching audio
            let archiveFallbackUrl = null;
            try {
              const archiveRes = await fetch(archiveUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
              if (archiveRes.ok) {
                const archiveData = await archiveRes.json();
                const docs = archiveData?.response?.docs || [];
                for (const doc of docs) {
                  const sim = stringSimilarity(entry.title, doc.title || '');
                  if (sim >= 0.6) {
                    archiveFallbackUrl = `https://archive.org/details/${doc.identifier}`;
                    break;
                  }
                }
              }
            } catch { }
            if (archiveFallbackUrl && !dlState.cancelled) {
              const r8 = await downloadSingleTrack(archiveFallbackUrl, outputTemplate);
              lastError = r8.stderr || '';
              downloadedFile = findDownloadedFile();
            }
            if (downloadedFile) {
              appendSessionLog(logsDir, entry, 8, 'Archive.org', 'SUCCESS', archiveFallbackUrl);
              attemptLog.push({ attempt: 8, source: 'Archive.org', result: 'success', match: archiveFallbackUrl });
            } else {
              attemptLog.push({ attempt: 8, source: 'Archive.org', result: 'failed' });
              appendSessionLog(logsDir, entry, 8, 'Archive.org', 'failed', archiveFallbackUrl ? lastError.slice(0, 200) : 'No match in Archive.org');
            }
          }

          // â”€â”€ Attempt 9: YouTube cover/live version â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          if (!downloadedFile && !dlState.cancelled) {
            send({
              currentTrack: trackIndex, totalTracks,
              trackTitle: entry.title, trackArtist: entry.artist,
              trackThumbnail: entry.thumbnail || null,
              status: `Retrying (9/10 â€” YouTube cover/live)...`,
              attemptNumber: 9, attemptSource: 'YouTube (cover/live)',
              progress: calcProgress(),
            });
            if (yt429PauseUntil > Date.now()) await sleep(yt429PauseUntil - Date.now());
            const q9 = `ytsearch3:${entry.artist} ${entry.title} cover OR live OR acoustic`;
            // For this attempt, remove the BAD_MATCH_RE penalty by using a simpler score
            const scoreCoverLive = (candidate, origTitle, origArtist, origDurationSec) => {
              let score = 0;
              const ct = cleanStr(candidate.title);
              const ot = cleanStr(origTitle);
              const ch = cleanStr(candidate.channel || candidate.uploader || '');
              const oa = cleanStr(origArtist);
              score += wordOverlap(ct, ot) * 50;
              if (ch.includes(oa) || oa.includes(ch) || wordOverlap(ch, oa) > 0.5) score += 20;
              if (origDurationSec > 0 && candidate.duration > 0) {
                const diff = Math.abs(candidate.duration - origDurationSec);
                if (diff <= 30) score += 20;
              }
              return score;
            };
            await sleep(2000);
            const r9Search = await runYtdlp([
              q9, '--dump-json', '--flat-playlist', '--no-warnings', '--playlist-end', '5',
              '--extractor-args', getExtractorArgs(),
            ], { timeout: 30000 });
            let cover9 = null;
            if (r9Search.stdout) {
              const cands = r9Search.stdout.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
              const scored = cands.map(c => ({ ...c, _score: scoreCoverLive(c, entry.title, entry.artist, entry.duration) })).sort((a, b) => b._score - a._score);
              if (scored[0] && scored[0]._score >= 20) {
                const vid = scored[0].id || scored[0].url;
                cover9 = { url: vid.startsWith('http') ? vid : `https://www.youtube.com/watch?v=${vid}`, title: scored[0].title };
              }
            }
            if (cover9 && !dlState.cancelled) {
              const r9 = await downloadSingleTrack(cover9.url, outputTemplate);
              lastError = r9.stderr || '';
              if (isRateLimited(lastError)) { yt429PauseUntil = Date.now() + 60000; send({ rateLimited: true, waitSeconds: 60, trackTitle: entry.title }); await sleep(60000); }
              downloadedFile = findDownloadedFile();
            }
            if (downloadedFile) {
              appendSessionLog(logsDir, entry, 9, 'YouTube (cover/live)', 'SUCCESS', cover9?.title);
              attemptLog.push({ attempt: 9, source: 'YouTube (cover/live)', result: 'success', match: cover9?.title });
            } else {
              attemptLog.push({ attempt: 9, source: 'YouTube (cover/live)', result: 'failed' });
              appendSessionLog(logsDir, entry, 9, 'YouTube (cover/live)', 'failed', cover9 ? lastError.slice(0, 200) : 'No cover/live match found');
            }
          }

          // â”€â”€ Attempt 10: Deezer via yt-dlp â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          if (!downloadedFile && !dlState.cancelled) {
            send({
              currentTrack: trackIndex, totalTracks,
              trackTitle: entry.title, trackArtist: entry.artist,
              trackThumbnail: entry.thumbnail || null,
              status: `Retrying (10/10 â€” Deezer)...`,
              attemptNumber: 10, attemptSource: 'Deezer',
              progress: calcProgress(),
            });
            await sleep(2000);
            const deezerQuery = encodeURIComponent(`${entry.artist} ${entry.title}`);
            const deezerUrl = `https://deezer.com/search/${deezerQuery}`;
            const r10 = await downloadSingleTrack(deezerUrl, outputTemplate);
            lastError = r10.stderr || '';
            downloadedFile = findDownloadedFile();
            if (downloadedFile) {
              appendSessionLog(logsDir, entry, 10, 'Deezer', 'SUCCESS', null);
              attemptLog.push({ attempt: 10, source: 'Deezer', result: 'success' });
            } else {
              attemptLog.push({ attempt: 10, source: 'Deezer', result: 'failed', reason: lastError.slice(0, 200) });
              appendSessionLog(logsDir, entry, 10, 'Deezer', 'failed', lastError.slice(0, 200));
            }
          }

          if (dlState.cancelled) return;

          // â”€â”€ Check success â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          if (downloadedFile && fs.existsSync(downloadedFile)) {
            const successfulAttempt = attemptLog.find(a => a.result === 'success');
            const attemptNum = successfulAttempt?.attempt || 1;
            const sourceName = successfulAttempt?.source || 'YouTube Music';

            // â”€â”€ Write ID3 metadata â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            try {
              const existing = NodeID3.read(downloadedFile) || {};
              const tags = {
                title: entry.title || existing.title || '',
                artist: entry.artist || existing.artist || '',
                allArtists: entry.artist || existing.performerInfo || '',
                album: entry.album || existing.album || '',
                year: existing.year || '',
                genre: existing.genre || '',
                trackNumber: entry.trackNumber || (prependNumbers ? trackIndex : null) || existing.trackNumber || '',
                totalTracks: entry.totalTracks || null,
                discNumber: existing.partOfSet || '',
                isrc: existing.isrc || '',
              };

              let coverBuffer = null;
              // Fetch HD cover: use video ID (entry.id) for maxresdefault â†’ sddefault â†’ hqdefault chain
              // This avoids the low-quality 16:9 video thumbnail from flat-playlist JSON
              try {
                const rawBuf = await fetchHDCoverBuffer(entry.id, entry.thumbnail);
                if (rawBuf && rawBuf.length > 5000) {
                  const tempImg = downloadedFile + '.cover.jpg';
                  try {
                    spawnSync(ffmpegBin, ['-y', '-i', 'pipe:0', '-vf', 'crop=min(iw\\,ih):min(iw\\,ih),scale=1920:1920:flags=lanczos', '-frames:v', '1', '-q:v', '1', tempImg], { input: rawBuf, windowsHide: true });
                    if (fs.existsSync(tempImg) && fs.statSync(tempImg).size > 1000) {
                      coverBuffer = fs.readFileSync(tempImg);
                    } else {
                      coverBuffer = rawBuf;
                    }
                  } catch (_) { coverBuffer = rawBuf; }
                  finally { try { if (fs.existsSync(tempImg)) fs.unlinkSync(tempImg); } catch (_) { } }
                }
              } catch (_) { }

              await writeAndVerifyTags(downloadedFile, tags, coverBuffer);
            } catch (tagErr) {
              console.error(`[ytmusic-fallback] Tag write failed for ${entry.title}: ${tagErr.message}`);
            }

            completedCount++;
            writeDownloadedLog(logsDir, entry, sourceName, attemptNum, safeAudioFmt);
            send({
              trackDone: true,
              currentTrack: trackIndex, totalTracks,
              trackTitle: entry.title, trackArtist: entry.artist,
              trackThumbnail: entry.thumbnail || null,
              trackProgress: 100,
              usedFallback: attemptNum > 1,
              fallbackTitle: successfulAttempt?.match || null,
              attemptNumber: attemptNum,
              attemptSource: sourceName,
              progress: Math.round(3 + ((completedCount + pendingManualCount) / totalTracks) * 90),
            });
          } else {
            // â”€â”€ All 10 attempts failed â†’ pending manual â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            pendingManualCount++;
            pendingManualTracksData.push({ title: entry.title, artist: entry.artist, url: entry.url, attempts: attemptLog });
            writePendingManual(logsDir, entry, attemptLog);
            appendSessionLog(logsDir, entry, 10, 'ALL', 'PENDING MANUAL', 'All 10 attempts exhausted');

            send({
              pendingManual: true,
              currentTrack: trackIndex, totalTracks,
              trackTitle: entry.title, trackArtist: entry.artist,
              trackThumbnail: entry.thumbnail || null,
              attemptNumber: 10,
              progress: Math.round(3 + ((completedCount + pendingManualCount) / totalTracks) * 90),
              status: `Needs manual review: ${entry.title}`,
            });
          }
        })();

        activePromises.add(task);
        task.finally(() => activePromises.delete(task));
      }

      await Promise.all(activePromises);
      if (dlState.cancelled) return;

      // â”€â”€ Apply folder thumbnail + Windows folder icon â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (thumbnail) {
        try {
          const thumbVideoId = extractYtVideoId(thumbnail);
          const cb = await fetchHDCoverBuffer(thumbVideoId, thumbnail) || Buffer.from(await (await fetch(thumbnail)).arrayBuffer());
          const metaDir = path.join(outputDir, '.metadata');
          if (!fs.existsSync(metaDir)) fs.mkdirSync(metaDir);
          if (os.platform() === 'win32') { try { spawnSync('attrib', ['+h', metaDir], { windowsHide: true }); } catch { } }

          const rawJp = path.join(metaDir, 'raw_folder.jpg');
          fs.writeFileSync(rawJp, cb);
          const jp = path.join(metaDir, 'folder.jpg');

          await new Promise(r => { spawn(ffmpegBin, ['-y', '-i', rawJp, '-vf', 'crop=min(iw\\,ih):min(iw\\,ih),scale=1920:1920:flags=lanczos', jp], { windowsHide: true }).on('close', r); });
          if (!fs.existsSync(jp)) fs.writeFileSync(jp, cb);
          try { fs.unlinkSync(rawJp); } catch { }

          const rootJp = path.join(outputDir, 'folder.jpg');
          fs.copyFileSync(fs.existsSync(jp) ? jp : rawJp, rootJp);
          if (os.platform() === 'win32') { try { spawnSync('attrib', ['+h', rootJp], { windowsHide: true }); } catch { } }

          if (process.platform === 'win32') {
            const ip = path.join(metaDir, 'album.ico');
            await new Promise(r => { spawn(ffmpegBin, ['-y', '-i', jp, '-vf', 'scale=256:256', ip], { windowsHide: true }).on('close', r); });
            if (fs.existsSync(ip)) {
              fs.writeFileSync(
                path.join(outputDir, 'desktop.ini'),
                "[.ShellClassInfo]\r\nIconResource=.metadata\\album.ico,0\r\n[ViewState]\r\nMode=\r\nVid=\r\nFolderType=Music\r\n"
              );
              await new Promise(r => { spawn('attrib', ['+s', `"${outputDir}"`], { shell: true }).on('close', r); });
              await new Promise(r => { spawn('attrib', ['+s', '+h', `"${path.join(outputDir, 'desktop.ini')}"`], { shell: true }).on('close', r); });
              await new Promise(r => { spawn('attrib', ['+h', `"${metaDir}"`], { shell: true }).on('close', r); });

              const batPath = path.join(outputDir, 'ApplyFolderIcon.bat');
              fs.writeFileSync(batPath, `@echo off\r\nattrib +s "%~dp0."\r\nattrib +s +h "%~dp0desktop.ini"\r\nattrib +h "%~dp0.metadata"\r\nie4uinit.exe -show\r\npause\r\n`);
              await new Promise(r => { spawn('attrib', ['+h', `"${batPath}"`], { shell: true }).on('close', r); });
            }
          }
        } catch (e) { console.error('[ytmusic-fallback] folder thumbnail error:', e.message); }
      }

      send({
        done: true, progress: 100,
        completedTracks: completedCount,
        failedTracks: 0,
        pendingManualTracks: pendingManualCount,
        totalTracks,
        failedTracksData: pendingManualTracksData,
        pendingManualData: pendingManualTracksData,
        finalFilename: path.basename(outputDir),
        isArchive: false,
        collectionTitle: title || safeTitle,
        logsDir: path.join(path.basename(outputDir), 'logs'),
      });
      res.end();
    };

    req.on('close', () => {
      dlState.cancelled = true;
      for (const p of dlState.procs) {
        try {
          if (process.platform === 'win32') require('child_process').spawnSync('taskkill', ['/pid', p.pid, '/f', '/t']);
          else p.kill('SIGKILL');
        } catch { }
      }
    });

    runDownload().catch(err => {
      send({ done: true, error: err.message });
      res.end();
    });
  });

  middlewares.use('/api/ytdl/local-thumbnail', (req, res, next) => { const u = new URL(req.url, 'http://' + req.headers.host); if (u.pathname !== '/') return next(); const file = u.searchParams.get('file'); if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) { res.statusCode = 400; return res.end('Invalid') }; const fp = path.join(ensureDownloadsDir(u.searchParams.get('customPath')), file); const blank = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'); if (!fs.existsSync(fp)) { res.setHeader('Content-Type', 'image/gif'); res.setHeader('Cache-Control', 'public, max-age=86400'); return res.end(blank) }; if (fs.statSync(fp).isDirectory()) { const jp = path.join(fp, 'folder.jpg'); if (fs.existsSync(jp)) { res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Cache-Control', 'public, max-age=86400'); return fs.createReadStream(jp).pipe(res) }; res.setHeader('Content-Type', 'image/gif'); res.setHeader('Cache-Control', 'public, max-age=86400'); return res.end(blank) }; const p = spawn(ffmpegBin, ['-i', fp, '-map', '0:v', '-c:v', 'copy', '-f', 'image2pipe', '-']); let ho = false; p.stdout.on('data', c => { if (!ho) { res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'public, max-age=86400'); ho = true }; res.write(c) }); p.on('close', () => { if (!ho) { res.setHeader('Content-Type', 'image/gif'); res.setHeader('Cache-Control', 'public, max-age=86400'); res.end(blank) } else res.end() }); p.on('error', () => { if (!ho) { res.statusCode = 500; res.end('Error') } }) })

  middlewares.use('/api/download-file', (req, res, next) => { const u = new URL(req.url, 'http://' + req.headers.host); if (u.pathname !== '/') return next(); const file = u.searchParams.get('file'); if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) { res.statusCode = 400; return res.end('Invalid') }; const dl = ensureDownloadsDir(u.searchParams.get('customPath')); let tp = path.join(dl, file); if (!fs.existsSync(tp)) { const cl = file.replace(/[^a-zA-Z0-9]/g, '').toLowerCase(); const fm = fs.readdirSync(dl).find(f => f.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === cl); if (fm) tp = path.join(dl, fm); else { res.statusCode = 404; return res.end('File not found') } }; const on = u.searchParams.get('outName'); let dfn = path.basename(tp); if (on?.trim()) { const cn = on.trim().replace(/[^a-zA-Z0-9_ .-]/g, ''); const ext = path.extname(file) || '.mp3'; dfn = cn.endsWith(ext) ? cn : `${cn}${ext}` }; const st = fs.statSync(tp); res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': st.size, 'Content-Disposition': `attachment; filename="${dfn}"` }); const rs = fs.createReadStream(tp); rs.pipe(res); rs.on('end', () => scheduleDownloadCleanup(tp, 60 * 60 * 1000)); rs.on('error', () => { if (!res.headersSent) { res.statusCode = 500; res.end('Error') } }) })

  let lastCpu = { idle: 0, total: 0 };
  
  middlewares.use('/api/ytdl/system-status', (req, res, next) => { 
      const u = new URL(req.url, `http://${req.headers.host}`); 
      if (u.pathname !== '/') return next(); 
      try { 
          const dl = ensureDownloadsDir(u.searchParams.get('customPath')); 
          const st = fs.statfsSync(dl); 
          
          let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
          const cpus = os.cpus();
          for(let c of cpus) { user += c.times.user; nice += c.times.nice; sys += c.times.sys; idle += c.times.idle; irq += c.times.irq; }
          const total = user + nice + sys + idle + irq;
          const cpuUsage = lastCpu.total > 0 ? (1 - (idle - lastCpu.idle) / (total - lastCpu.total)) * 100 : 0;
          lastCpu = { idle, total };

          res.setHeader('Content-Type', 'application/json'); 
          res.end(JSON.stringify({ 
              freeSpace: st.bfree * st.bsize, 
              totalMem: os.totalmem(), 
              freeMem: os.freemem(), 
              activeJobs: activeJobs.size, 
              uptime: Date.now() - metrics.uptimeStart, 
              totalHits: metrics.totalHits, 
              successfulDownloads: metrics.successfulDownloads, 
              failedDownloads: metrics.failedDownloads,
              cpuUsage: cpuUsage
          })) 
      } catch { 
          res.statusCode = 500; res.end(JSON.stringify({ error: 'Status error' })) 
      } 
  })

  middlewares.use('/api/audio-cutter/select-source', (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); const ps = `Add-Type -AssemblyName System.Windows.Forms\n$d=New-Object System.Windows.Forms.OpenFileDialog\n$d.Title='Select audio file'\n$d.Filter='Audio files|*.mp3;*.m4a;*.aac;*.wav;*.flac;*.ogg;*.opus;*.webm|All files|*.*'\nif($d.ShowDialog()-eq'OK'){Write-Output $d.FileName}`; const c = spawn('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true }); let s = ''; c.stdout.on('data', d => s += d); c.on('close', () => { const sp = s.trim(); if (!sp) return res.end(JSON.stringify({ success: false })); if (!fs.existsSync(sp)) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'File not found.' })) }; const pb = spawn(ffmpegBin, ['-i', sp], { windowsHide: true }); let se = ''; pb.stderr.on('data', d => se += d); pb.on('close', () => { const dm = se.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/); const dur = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : 0; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: true, path: sp, name: path.basename(sp), extension: path.extname(sp).slice(1), duration: dur })) }) }) })

  middlewares.use('/api/audio-cutter/cut', async (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'POST only' })) }; const b = await parseJsonBody(req); const sp = typeof b.sourcePath === 'string' ? b.sourcePath : ''; const st = Number(b.start); const en = Number(b.end); const fmt = ['mp3', 'm4a', 'wav', 'flac'].includes(b.format) ? b.format : 'mp3'; const on = sanitizeFilename(String(b.outputName || 'audio-clip')).replace(/\.[^.]+$/, '') || 'audio-clip'; const ae = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus', '.webm']); if (!sp || !ae.has(path.extname(sp).toLowerCase()) || !fs.existsSync(sp)) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Invalid source file.' })) }; if (!Number.isFinite(st) || !Number.isFinite(en) || st < 0 || en <= st) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Invalid time range.' })) }; const fn = `${on}-${Date.now()}.${fmt}`; const op = path.join(ensureDownloadsDir(u.searchParams.get('customPath')), fn); const ca = fmt === 'mp3' ? ['-codec:a', 'libmp3lame', '-q:a', '0'] : fmt === 'm4a' ? ['-codec:a', 'aac', '-b:a', '256k'] : fmt === 'flac' ? ['-codec:a', 'flac'] : ['-codec:a', 'pcm_s16le']; const args = ['-y', '-ss', String(st), '-to', String(en), '-i', sp, '-map_metadata', '0', '-vn', ...ca, op]; const p = spawn(ffmpegBin, args, { windowsHide: true }); let se = ''; p.stderr.on('data', c => se += c); p.on('error', e => { res.statusCode = 500; res.end(JSON.stringify({ error: `FFmpeg start failed: ${e.message}` })) }); p.on('close', code => { if (code !== 0 || !fs.existsSync(op)) { res.statusCode = 500; return res.end(JSON.stringify({ error: `FFmpeg failed: ${se.slice(-400)}` })) }; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: true, filename: fn, title: on })) }) })

  middlewares.use('/api/audio-cutter/stream', (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); const fp = u.searchParams.get('path'); if (!fp) { res.statusCode = 400; return res.end('Missing path') }; const ae = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus', '.webm', '.wma']); const ext = path.extname(fp).toLowerCase(); if (!ae.has(ext) || !fs.existsSync(fp)) { res.statusCode = 403; return res.end('Forbidden') }; const mm = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.webm': 'audio/webm', '.wma': 'audio/x-ms-wma' }; const st = fs.statSync(fp); res.setHeader('Content-Type', mm[ext] || 'audio/mpeg'); res.setHeader('Content-Length', st.size); res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Cache-Control', 'no-cache'); fs.createReadStream(fp).pipe(res) })

  middlewares.use('/api/audio-cutter/export', async (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'POST only' })) }; const b = await parseJsonBody(req); const sp = typeof b.sourcePath === 'string' ? b.sourcePath : ''; const st = Number(b.start) || 0; const en = Number(b.end); const fmt = ['mp3', 'm4a', 'wav', 'flac'].includes(b.format) ? b.format : 'mp3'; const on = sanitizeFilename(String(b.outputName || 'audio-clip')).replace(/\.[^.]+$/, '') || 'audio-clip'; const fi = Math.max(0, Number(b.fadeIn) || 0); const fo = Math.max(0, Number(b.fadeOut) || 0); const vol = Number(b.volume) || 0; const spd = Math.min(2, Math.max(0.5, Number(b.speed) || 1)); const norm = Boolean(b.normalize); const meta = b.metadata || {}; const ae = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus', '.webm']); if (!sp || !ae.has(path.extname(sp).toLowerCase()) || !fs.existsSync(sp)) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Invalid source.' })) }; if (!Number.isFinite(en) || en <= st) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Invalid range.' })) }; const dur = en - st; const filters = []; if (fi > 0) filters.push(`afade=t=in:st=0:d=${fi.toFixed(3)}`); if (fo > 0) filters.push(`afade=t=out:st=${Math.max(0, dur - fo).toFixed(3)}:d=${fo.toFixed(3)}`); if (vol !== 0) filters.push(`volume=${vol}dB`); if (spd !== 1) filters.push(`atempo=${spd.toFixed(4)}`); if (norm) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11'); const ca = fmt === 'mp3' ? ['-codec:a', 'libmp3lame', '-q:a', '0'] : fmt === 'm4a' ? ['-codec:a', 'aac', '-b:a', '256k'] : fmt === 'flac' ? ['-codec:a', 'flac'] : ['-codec:a', 'pcm_s16le']; const fn = `${on}-${Date.now()}.${fmt}`; const op = path.join(ensureDownloadsDir(u.searchParams.get('customPath')), fn); const args = ['-y', '-ss', String(st), '-i', sp, '-t', String(dur), '-map_metadata', '0', '-vn']; if (filters.length) args.push('-af', filters.join(',')); args.push(...ca); if (meta.title) args.push('-metadata', `title=${meta.title}`); if (meta.artist) args.push('-metadata', `artist=${meta.artist}`); if (meta.album) args.push('-metadata', `album=${meta.album}`); if (meta.track) args.push('-metadata', `track=${meta.track}`); args.push('-id3v2_version', '3', op); const p = spawn(ffmpegBin, args, { windowsHide: true }); let se = ''; p.stderr.on('data', c => se += c); p.on('error', e => { if (!res.headersSent) { res.statusCode = 500; res.end(JSON.stringify({ error: `FFmpeg: ${e.message}` })) } }); p.on('close', code => { if (code !== 0 || !fs.existsSync(op)) { res.statusCode = 500; return res.end(JSON.stringify({ error: `FFmpeg error (${code}): ${se.slice(-500)}` })) }; scheduleDownloadCleanup(op, 60 * 60 * 1000); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: true, filename: fn, title: on })) }) })

  let pendingSpotifyToken = null;

  middlewares.use('/api/spotify-callback', async (req, res, next) => {
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (u.pathname !== '/') return next();

    const code = u.searchParams.get('code');
    if (!code) {
      res.statusCode = 400;
      return res.end('Missing code parameter');
    }

    const cid = process.env.VITE_SPOTIFY_CLIENT_ID || null;
    const cs = process.env.VITE_SPOTIFY_CLIENT_SECRET || null;
    const redirectUri = `http://127.0.0.1:5174/api/spotify-callback`;

    if (!cid || !cs) {
      res.statusCode = 500;
      return res.end('Missing Spotify credentials');
    }

    try {
      const tr = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${cid}:${cs}`).toString('base64')}`
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri
        })
      });
      const d = await tr.json();
      if (!tr.ok) throw new Error(d.error_description || d.error || 'Token fetch failed');

      pendingSpotifyToken = d;
      res.setHeader('Content-Type', 'text/html');
      res.end(`<html>
        <body style="background:#080a0f;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="text-align:center;">
            <svg viewBox="0 0 24 24" fill="#1DB954" width="64" height="64" style="margin-bottom:1rem;"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
            <h1 style="color:#1DB954;margin:0;">Spotify Connected!</h1>
            <p style="color:#94a3b8;margin-top:0.5rem;">Authentication successful. You can safely close this tab and return to MediaDL.</p>
            <script>setTimeout(() => window.close(), 3000)</script>
          </div>
        </body>
      </html>`);
    } catch (e) {
      res.statusCode = 500;
      res.end(`<html><body style="background:#080a0f;color:#fff;font-family:sans-serif;padding:2rem;"><h1>Error</h1><p>${e.message}</p></body></html>`);
    }
  });

  middlewares.use('/api/spotify-status', (req, res, next) => {
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (u.pathname !== '/') return next();
    res.setHeader('Content-Type', 'application/json');
    if (pendingSpotifyToken) {
      const d = { ...pendingSpotifyToken };
      pendingSpotifyToken = null;
      res.end(JSON.stringify({ success: true, data: d }));
    } else {
      res.end(JSON.stringify({ success: false }));
    }
  });

  middlewares.use('/api/spotify-refresh', async (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'POST only' })) }; const cid = req.headers['x-spotify-client-id']; const cs = req.headers['x-spotify-client-secret']; const b = await parseJsonBody(req); const { refresh_token } = b; if (!refresh_token || !cid || !cs) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Missing params' })) }; try { const tr = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${Buffer.from(`${cid}:${cs}`).toString('base64')}` }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token }) }); const d = await tr.json(); if (!tr.ok) throw new Error(d.error_description || d.error || 'Refresh failed'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(d)) } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) } })

  middlewares.use('/api/spotify-mass-fetch', async (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); const su = u.searchParams.get('url'); if (!su) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Missing url' })) }; const cid = req.headers['x-spotify-client-id']; const cs = req.headers['x-spotify-client-secret']; const at = req.headers['x-spotify-access-token']; try { res.setHeader('Content-Type', 'application/json'); let md = await resolveSpotifyMetadata(su, cid, cs, at); const conc = 20; for (let i = 0; i < md.tracks.length; i += conc) { const chunk = md.tracks.slice(i, i + conc); await Promise.all(chunk.map(async (t, idx) => { const ai = i + idx; let src = 'spotify'; const inc = !t.coverUrl || !t.album || !t.year || !t.durationMs; if (inc) { const id = await fetchItunesMetadata(t.title, t.artist); if (id) { t.album = t.album || id.album; t.year = t.year || id.year; t.coverUrl = t.coverUrl || id.coverUrl; src = 'itunes' } else { const yd = await fetchYouTubeMusicMetadata(t.title, t.artist); if (yd) { t.album = t.album || yd.album; t.year = t.year || yd.year; t.coverUrl = t.coverUrl || yd.coverUrl; src = 'youtube_music' } } }; t.metadataSource = src; t.index = ai + 1; t.searchRoute = ai < 100 ? 'spotify' : 'youtube_music' })) }; res.end(JSON.stringify({ playlistId: md.spotifyId, playlistName: md.title, playlistCover: md.coverUrl, owner: md.owner || 'Unknown', totalTracks: md.tracks.length, tracks: md.tracks })) } catch (err) { console.error('Mass fetch error:', err); res.statusCode = 500; res.end(JSON.stringify({ error: err?.message || String(err) })) } })

  middlewares.use('/api/mass/ytdl-playlist-info', async (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); const pu = u.searchParams.get('url'); if (!pu) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Missing url' })) }; const cached = cacheGet(pu); if (cached) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ...cached, _cached: true })) }; try { const extArgs = getExtractorArgs(); let args = ['--flat-playlist', '--dump-json', '--no-warnings', '--playlist-end', '2000', '--extractor-args', extArgs, pu]; const cp = path.resolve(appDir, 'cookies.txt'); const cfb = getConfig().cookiesFromBrowser || ''; if (cfb) { args.splice(args.length - 1, 0, '--cookies-from-browser', cfb) } else if (fs.existsSync(cp)) { args.splice(args.length - 1, 0, '--cookies', cp) }; const p = spawn(binPath, args, { env: { ...process.env, PYTHONIOENCODING: 'utf-8', PATH: `${binDir}${path.delimiter}${process.env.PATH}` }, windowsHide: true }); let so = '', se = ''; p.stdout.on('data', c => so += c); p.stderr.on('data', c => se += c); p.on('close', code => { if (code !== 0 && !so.trim()) { res.statusCode = 500; return res.end(JSON.stringify({ error: `yt-dlp failed (${code}): ${se.slice(0, 300)}` })) }; const items = []; let pt = ''; for (const l of so.split('\n')) { if (!l.trim()) continue; try { const j = JSON.parse(l); if (!pt && j.playlist_title) pt = j.playlist_title; items.push({ id: j.id, url: j.url || `https://www.youtube.com/watch?v=${j.id}`, title: j.title || j.id, channel: j.channel || j.uploader || '', duration: j.duration || 0, thumbnail: j.thumbnails?.[0]?.url || j.thumbnail || null, durationMs: (j.duration || 0) * 1000 }) } catch { } }; const r = { title: pt || 'YouTube Playlist', totalItems: items.length, items }; cacheSet(pu, r); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(r)) }); p.on('error', e => { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }) } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) } })

  middlewares.use('/api/youtube-avatar', async (req, res, next) => {
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (u.pathname !== '/') return next();
    const name = u.searchParams.get('name');
    if (!name) { res.statusCode = 400; return res.end('Missing name'); }
    try {
      const cr = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' channel')}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      const ch = await cr.text();
      const am = ch.match(/"url"\s*:\s*"(https:\/\/yt3\.ggpht\.com\/[^"]+)"/i);
      let at = am?.[1]?.replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
      if (at) {
        if (!at.startsWith('http')) at = 'https:' + at;
        res.writeHead(302, { Location: at, 'Cache-Control': 'public, max-age=86400' });
        return res.end();
      }
      res.writeHead(302, { Location: `https://unavatar.io/youtube/${encodeURIComponent(name)}`, 'Cache-Control': 'public, max-age=86400' });
      return res.end();
    } catch (e) {
      res.writeHead(302, { Location: `https://unavatar.io/youtube/${encodeURIComponent(name)}`, 'Cache-Control': 'public, max-age=86400' });
      return res.end();
    }
  });

  // ── Spotify OEmbed Proxy (Bypass CORS for frontend) ───────────────────
  middlewares.use('/api/spotify-oembed', async (req, res, next) => {
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (u.pathname !== '/') return next();
    const targetUrl = u.searchParams.get('url');
    if (!targetUrl) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'Missing url param' }));
    }
    try {
      const fetch = (await import('node-fetch')).default || globalThis.fetch;
      const resp = await fetch(`https://open.spotify.com/oembed?url=${targetUrl}`);
      if (!resp.ok) throw new Error('oembed fetch failed');
      const data = await resp.json();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  middlewares.use('/api/mass/start-ytdl', (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); const did = u.searchParams.get('downloadId'); if (!did) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Missing downloadId' })) }; const fmtStr = u.searchParams.get('format') || 'mp3'; const rc = Math.min(24, Math.max(1, parseInt(u.searchParams.get('concurrency') || '3', 10))); const sm = u.searchParams.get('speedMode') === 'MAXIMUM' ? 'MAXIMUM' : 'BALANCED'; const profile = getBatchPerformanceProfile(rc, sm); res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); const send = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`) } catch { } }; const runDownload = async bodyData => { const items = (bodyData?.items || []).map((item, i) => ({ ...item, index: item.index || i + 1 })); if (!items.length) { send({ done: true, error: 'No items' }); return res.end() }; const pn = sanitizeFilename(bodyData?.playlistName || 'mass-download') || 'mass-download'; const dl = ensureDownloadsDir(u.searchParams.get('customPath')); const td = path.join(dl, `mass-ytdl-${pn}-${did}`); fs.mkdirSync(td, { recursive: true }); send({ current: 0, total: items.length, status: `Starting ${items.length} tracks with ${profile.concurrency} workersâ€¦`, performanceProfile: profile }); let cc = 0, fc = 0; const downloadItem = async (entry, ctx) => { const { item, index } = entry; const isSp = item.type === 'spotify' || !!item.spotifyUrl; const qStr = isSp ? `ytsearch5:${item.channel || item.artist || ''} ${item.title}` : (item.url || `https://www.youtube.com/watch?v=${item.id}`); const sTitle = sanitizeFilename(item.title || `track-${index}`); const sArtist = sanitizeFilename(item.channel || item.artist || ''); const outName = sArtist ? `${sArtist} - ${sTitle}` : sTitle; const op = path.join(td, `${outName}.%(ext)s`); let args = []; if (fmtStr === 'mp3') { args = ['-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', op, '--ffmpeg-location', ffmpegDir, '--no-playlist', '--playlist-items', '1', '-N', String(profile.fragments || 4), '--extractor-args', getExtractorArgs(), '--extractor-retries', '5', '--fragment-retries', '10', '--retry-sleep', 'linear=1::2', '--add-header', 'Accept-Language:en-US,en;q=0.9', item.isrc ? `direct:${item.isrc}` : qStr] } else if (fmtStr === 'm4a') { args = ['-x', '--audio-format', 'm4a', '--audio-quality', '0', '-o', op, '--ffmpeg-location', ffmpegDir, '--no-playlist', '--playlist-items', '1', '-N', String(profile.fragments || 4), '--extractor-args', getExtractorArgs(), '--extractor-retries', '5', '--fragment-retries', '10', '--retry-sleep', 'linear=1::2', '--add-header', 'Accept-Language:en-US,en;q=0.9', item.isrc ? `direct:${item.isrc}` : qStr] } else { args = ['-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', op, '--ffmpeg-location', ffmpegDir, '--no-playlist', '--playlist-items', '1', '-N', String(profile.fragments || 4), '--extractor-args', getExtractorArgs(), '--extractor-retries', '5', '--fragment-retries', '10', '--retry-sleep', 'linear=1::2', '--add-header', 'Accept-Language:en-US,en;q=0.9', item.isrc ? `direct:${item.isrc}` : qStr] }; const cp = path.resolve(appDir, 'cookies.txt'); const cfb = getConfig().cookiesFromBrowser || ''; if (cfb) { args.splice(args.length - 1, 0, '--cookies-from-browser', cfb) } else if (fs.existsSync(cp)) { args.splice(args.length - 1, 0, '--cookies', cp) }; return new Promise(resolve => { const p = spawn(binPath, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PATH: `${binDir}${path.delimiter}${process.env.PATH}` } }); ctx.registerProcess(p); ctx.unregisterProcess && (p.on('close', () => ctx.unregisterProcess(p))); let se = ''; p.stdout.on('data', c => { const t = c.toString(); const m = t.match(/\[download\]\s+([\d.]+)%/); if (m) send({ current: cc, total: items.length, currentTrack: index, trackTitle: item.title, trackProgress: parseFloat(m[1]) }) }); p.stderr.on('data', c => se += c); p.on('close', code => { if (state?.cancelled) return resolve({ ok: false, error: 'cancelled' }); if (code !== 0) return resolve({ ok: false, error: `yt-dlp failed (${code}): ${se.slice(-200)}`, title: item.title }); const pattern = new RegExp(`^${outName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.[a-zA-Z0-9]+$`); const files = fs.existsSync(td) ? fs.readdirSync(td).filter(f => pattern.test(f)) : []; const fn = files[0] || null; if (!fn) return resolve({ ok: false, error: `No output for ${item.title || index}` }); resolve({ ok: true, output: fn }) }); p.on('error', e => resolve({ ok: false, error: e.message })) }) }; const jobsDir = path.join(os.tmpdir(), 'mediadl-jobs'); fs.mkdirSync(jobsDir, { recursive: true }); const batch = createBatchEngine({ jobsDirectory: jobsDir, jobId: did, items, profile, onEvent: evt => { if (evt.trackDone) { cc++; send({ current: cc, total: items.length, status: `Completed ${cc}/${items.length}`, currentTrack: evt.current, trackDone: true, percent: Math.round(cc / items.length * 100) }) } else if (evt.trackError) { fc++; send({ current: cc, total: items.length, trackError: evt.trackError, currentTrack: evt.current, percent: Math.round(cc / items.length * 100) }) } else if (evt.current !== undefined) { send({ current: evt.current, total: items.length, percent: Math.round((evt.completedCount || 0) / items.length * 100) }) } } }); activeMassYtdlDownloads.set(did, batch.controls); try { await batch.run(downloadItem) } finally { activeMassYtdlDownloads.delete(did) }; send({ done: true, progress: 100, completedTracks: cc, failedTracks: fc, outputDir: td }); res.end() }; const consume = async () => { let body = ''; req.on('data', c => body += c); req.on('end', async () => { try { const bd = JSON.parse(body || '{}'); await runDownload(bd) } catch (e) { send({ done: true, error: e.message }); res.end() } }); req.on('close', () => { const b = activeMassYtdlDownloads.get(did); if (b && b.cancel) b.cancel() }) }; consume() })

  middlewares.use('/api/mass/cancel', (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); const did = u.searchParams.get('downloadId'); if (did && activeMassYtdlDownloads.has(did)) activeMassYtdlDownloads.get(did).cancel(); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: true })) })

  middlewares.use('/api/spotify-info', async (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); const su = u.searchParams.get('url'); const cid = req.headers['x-spotify-client-id']; const cs = req.headers['x-spotify-client-secret']; const at = req.headers['x-spotify-access-token']; if (!su) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Missing url' })) }; try { res.setHeader('Content-Type', 'application/json'); let md; try { md = await resolveSpotifyMetadata(su, cid, cs, at) } catch (e) { if (/^(SPOTIFY_(401|403|404)|Spotify auth failed|Missing SPOTIFY)/.test(e.message || '')) throw e; console.log(`resolveSpotifyMetadata failed (${e.message}), fallbackâ€¦`); try { md = await resolveSpotifyFallback(su) } catch (fe) { throw new Error(e.message) } }; return res.end(JSON.stringify(md)) } catch (e) { console.error('Spotify info error:', e); res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) } })

  middlewares.use('/api/spotdl-extract', (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); const su = u.searchParams.get('url'); if (!su) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Missing url' })) }; res.setHeader('Content-Type', 'application/json'); const tf = path.join(os.tmpdir(), `spotdl_extract_${Date.now()}.spotdl`); const spotdlCmd = process.platform === 'win32' ? 'cmd.exe' : spotdlBin; const spotdlArgs = process.platform === 'win32' ? ['/c', 'chcp', '65001', '>', 'nul', '&', 'call', spotdlBin, 'save', su, '--save-file', tf] : ['save', su, '--save-file', tf]; const p = spawn(spotdlCmd, spotdlArgs, { env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PATH: `${binDir}${path.delimiter}${process.env.PATH}` } }); p.stdout.on('data', () => { }); p.stderr.on('data', () => { }); p.on('close', code => { if (fs.existsSync(tf)) { try { const tracks = JSON.parse(fs.readFileSync(tf, 'utf8')); fs.unlinkSync(tf); res.end(JSON.stringify({ type: 'playlist', title: tracks[0]?.list_name || 'Spotify Playlist', trackCount: tracks.length, totalTracks: tracks.length, totalDurationMs: 0, tracks: tracks.map((t, i) => ({ trackNumber: i + 1, title: t.name, artist: t.artist, allArtists: t.artists.join(', '), durationMs: t.duration * 1000, spotifyUrl: t.url, coverUrl: t.cover_url })) })) } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) } } else { res.statusCode = 500; res.end(JSON.stringify({ error: 'spotdl failed' })) } }) })

  // ── Spotify Artist Thumbnail — search Spotify API for artist image ──────────
  // Used by ArtistBubbles as a reliable fallback when artistThumbnail is missing.
  middlewares.use('/api/spotify-artist-thumbnail', async (req, res, next) => {
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (u.pathname !== '/') return next();
    const name = u.searchParams.get('name');
    if (!name) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Missing name' })); }

    try {
      const { spawn } = await import('child_process');
      const child = spawn(binPath, ['--dump-json', '--no-playlist', `ytsearch1:${name} music channel`]);
      child.on('error', (err) => {
        clearTimeout(timeout);
        res.statusCode = 500;
        if (!res.writableEnded) res.end(JSON.stringify({ error: err.message }));
      });
      let ds = '';
      child.stdout.on('data', c => ds += c);
      child.stderr.on('data', () => { }); // Consume stderr to prevent buffer overflow

      const timeout = setTimeout(() => {
        try { child.kill(); } catch (e) { }
      }, 15000);

      child.on('close', async code => {
        clearTimeout(timeout);
        if (code === 0) {
          try {
            const info = JSON.parse(ds.split('\n')[0]);
            let at = info.channel_thumbnail || info.uploader_thumbnail || null;
            if (!at && (info.channel_url || info.uploader_url)) {
              try {
                const cr = await fetch(info.channel_url || info.uploader_url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                const ch = await cr.text();
                const am = ch.match(/"avatar"\s*:\s*\{\s*"thumbnails"\s*:\s*\[\s*\{\s*"url"\s*:\s*"([^"]+)"/i) || ch.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
                at = am?.[1]?.replace(/\\u0026/g, '&').replace(/&amp;/g, '&') || null;
              } catch (e) { }
            }
            if (at && at.includes('=s')) {
              at = at.replace(/=s\d+-/, '=s1920-').replace(/=s\d+$/, '=s1920');
            }
            if (at) {
              if (!at.startsWith('http')) at = 'https:' + at;
              res.writeHead(302, { Location: at, 'Cache-Control': 'public, max-age=86400' });
              return res.end();
            }
          } catch (e) { }
        }
        
        // Final fallback if yt-dlp fails
        res.writeHead(302, { Location: `https://unavatar.io/youtube/${encodeURIComponent(name)}`, 'Cache-Control': 'public, max-age=86400' });
        return res.end();
      });
    } catch (e) {
      res.writeHead(302, { Location: `https://unavatar.io/youtube/${encodeURIComponent(name)}`, 'Cache-Control': 'public, max-age=86400' });
      return res.end();
    }
  });


  // ── Spotify Download (SSE, Multi-Track) ──
  const bulkMetadataCache = new Map();

  middlewares.use('/api/spotify-bulk-prep', (req, res, next) => {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    if (urlObj.pathname !== '/') return next();
    if (req.method !== 'POST') return next();
    
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const id = Date.now().toString() + Math.random().toString(36).slice(2);
        bulkMetadataCache.set(id, data);
        setTimeout(() => bulkMetadataCache.delete(id), 1000 * 60 * 60); // 1 hour
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, bulkId: id }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  });

  middlewares.use('/api/spotify-download', (req, res, next) => {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    if (urlObj.pathname !== '/') return next();
    
    const spotUrl = urlObj.searchParams.get('url');
    const downloadId = urlObj.searchParams.get('downloadId') || Date.now().toString();
    const clientId = req.headers['x-spotify-client-id'];
    const clientSecret = req.headers['x-spotify-client-secret'];
    const accessToken = req.headers['x-spotify-access-token'];

    if (!spotUrl) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'Missing url param' }));
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { } };
    const dlState = { cancelled: false, procs: new Set() };
    spotifyActiveDownloads.set(downloadId, dlState);
    
    req.on('close', () => {
      // Keep going in background
    });

    const runDownload = async () => {
      send({ status: 'Fetching metadata...', progress: 2 });
      let metadata;
      try {
        if (spotUrl.startsWith('bulk://')) {
          const bulkId = spotUrl.replace('bulk://', '');
          if (bulkMetadataCache.has(bulkId)) {
            metadata = bulkMetadataCache.get(bulkId);
          } else {
            throw new Error('Bulk metadata expired or not found.');
          }
        } else if (spotUrl.startsWith('{')) {
          metadata = JSON.parse(spotUrl);
        } else {
          metadata = await resolveSpotifyMetadata(spotUrl, clientId, clientSecret, accessToken);
        }
      } catch (e) {
        send({ error: e.message, done: true });
        return res.end();
      }

      const isCollection = metadata.type === 'album' || metadata.type === 'playlist';
      let tracks = isCollection ? metadata.tracks : [metadata];

      const selectedStr = urlObj.searchParams.get('selectedTracks');
      if (selectedStr) {
        const selectedIndices = new Set(selectedStr.split(',').map(Number));
        tracks = tracks.filter(t => selectedIndices.has(t.trackNumber));
      }

      if (tracks.length === 0) {
        send({ error: 'No tracks selected', done: true });
        return res.end();
      }

      // ── Download options from URL params ────────────────────────────────────
      const prependNumbers = urlObj.searchParams.get('prependNumbers') !== 'false';
      const prefixAlbumFolders = urlObj.searchParams.get('prefixAlbumFolders') !== 'false';
      const fmtParam = urlObj.searchParams.get('format') || 'audio:mp3:0';
      const [, audioFmtPart = 'mp3', audioQualPart = '0'] = fmtParam.startsWith('audio:') ? fmtParam.split(':') : ['audio', 'mp3', '0'];
      const safeAudioFormat = ['mp3', 'm4a', 'wav', 'vorbis'].includes(audioFmtPart) ? audioFmtPart : 'mp3';

      send({ status: `Starting download of ${tracks.length} tracks...`, progress: 5, totalTracks: tracks.length });
      send({ playlistDone: { total: tracks.length, done: 0, pending: tracks.length } });

      const downloadsDir = ensureDownloadsDir(urlObj.searchParams.get('customPath'));
      // Apply album folder prefix if needed
      let collectionFolderName = sanitizeFilename(metadata.title || 'Spotify Download');
      if (isCollection && metadata.type === 'album' && prefixAlbumFolders) {
        const cleanName = collectionFolderName.replace(/^(Album\s*-\s*)+/i, '');
        collectionFolderName = `Album - ${cleanName}`;
      }
      const outputDir = isCollection ? path.join(downloadsDir, collectionFolderName) : downloadsDir;
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      // Save folder.jpg for Windows Explorer icon and set custom folder icon
      if (isCollection && metadata.coverUrl) {
        const folderJpgPath = path.join(outputDir, 'folder.jpg');
        try {
            const res = await fetch(metadata.coverUrl);
            const buf = await res.arrayBuffer();
            if (!fs.existsSync(folderJpgPath)) {
                fs.writeFileSync(folderJpgPath, Buffer.from(buf));
            }
            if (process.platform === 'win32') {
                const metaDir = path.join(outputDir, '.metadata');
                if (!fs.existsSync(metaDir)) fs.mkdirSync(metaDir, { recursive: true });
                const icoPath = path.join(metaDir, 'album.ico');
                
                await new Promise(r => { spawn(ffmpegBin, ['-y', '-i', folderJpgPath, '-vf', 'scale=256:256', icoPath], { windowsHide: true }).on('close', r); });
                
                if (fs.existsSync(icoPath)) {
                    const desktopIniPath = path.join(outputDir, 'desktop.ini');
                    fs.writeFileSync(desktopIniPath, "[.ShellClassInfo]\r\nIconResource=.metadata\\album.ico,0\r\n[ViewState]\r\nMode=\r\nVid=\r\nFolderType=Music\r\n");
                    
                    await new Promise(r => { spawn('attrib', ['+s', `"${outputDir}"`], { shell: true }).on('close', r); });
                    await new Promise(r => { spawn('attrib', ['+s', '+h', `"${desktopIniPath}"`], { shell: true }).on('close', r); });
                    await new Promise(r => { spawn('attrib', ['+h', `"${metaDir}"`], { shell: true }).on('close', r); });
                    
                    const batPath = path.join(outputDir, 'ApplyFolderIcon.bat');
                    fs.writeFileSync(batPath, `@echo off\r\nattrib +s "%~dp0."\r\nattrib +s +h "%~dp0desktop.ini"\r\nattrib +h "%~dp0.metadata"\r\nie4uinit.exe -show\r\n`);
                    await new Promise(r => { spawn('attrib', ['+h', `"${batPath}"`], { shell: true }).on('close', r); });
                    
                    await new Promise(r => { spawn('cmd.exe', ['/c', batPath], { windowsHide: true }).on('close', r); });
                }
            }
        } catch(e) { console.error('[spotify] Folder icon error:', e.message); }
      }
      const logsDir = path.join(outputDir, 'logs');
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      // Optionally hide the logs folder
      if (process.platform === 'win32') { try { spawnSync('attrib', ['+h', logsDir], { windowsHide: true }); } catch { } }

      const downloadedJsonPath = path.join(logsDir, 'downloaded.json');
      const pendingJsonPath = path.join(logsDir, 'pending_manual.json');
      const logPath = path.join(logsDir, 'session_log.txt');

      const appendLog = (msg) => {
        try { fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`); } catch(e){}
      };
      
      const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p)); } catch(e) { return []; } };
      const writeJson = (p, d) => { try { fs.writeFileSync(p, JSON.stringify(d, null, 2)); } catch(e){} };

      function levenshteinDistance(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        const matrix = [];
        for (let i = 0; i <= b.length; i++) matrix[i] = [i];
        for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
        for (let i = 1; i <= b.length; i++) {
          for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
              matrix[i][j] = matrix[i - 1][j - 1];
            } else {
              matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
            }
          }
        }
        return matrix[b.length][a.length];
      }

      function normalizeTitle(t) {
        return (t || '').toLowerCase()
          .replace(/\(official video\)/g, '')
          .replace(/\(official audio\)/g, '')
          .replace(/\(audio\)/g, '')
          .replace(/\[4k\]/g, '')
          .replace(/\[hd\]/g, '')
          .replace(/- topic/g, '')
          .replace(/\(lyric video\)/g, '')
          .replace(/\(visualizer\)/g, '')
          .replace(/[^\w\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
      
      const processTrack = async (track, index) => {
        if (dlState.cancelled) return;

        send({ trackStart: { title: track.title, artist: track.artist, index, total: tracks.length } });
        appendLog(`Starting: ${track.artist} - ${track.title}`);

        const safeArtist = sanitizeFilename(track.artist || 'Unknown');
        const safeTitle = sanitizeFilename(track.title || 'Unknown');
        // Apply prependNumbers: prefix with zero-padded track index
        const trackNumPrefix = prependNumbers && isCollection
          ? String(index + 1).padStart(3, '0') + ' - '
          : '';
        const baseName = `${trackNumPrefix}${safeArtist} - ${safeTitle}`;
        const finalPath = path.join(outputDir, `${baseName}.${safeAudioFormat}`);

        if (fs.existsSync(finalPath)) {
          send({ trackDone: true, trackTitle: track.title, trackArtist: track.artist, source: 'cache' });
          appendLog(`Already exists: ${track.artist} - ${track.title}`);
          return { success: true, source: 'cache' };
        }

        // Pre-fetch cover art buffer for tag embedding
        let coverBuf = null;
        let coverUrlToFetch = track.coverUrl || metadata.coverUrl;
        if (coverUrlToFetch) {
          try {
            const cres = await fetch(coverUrlToFetch);
            if (cres.ok) coverBuf = Buffer.from(await cres.arrayBuffer());
          } catch(e) {}
        }

        const ytDlpArgsBase = [
          '-x',
          '--audio-format', safeAudioFormat,
          '--audio-quality', audioQualPart || '0',
          '--no-playlist', '--playlist-items', '1',
          '--ffmpeg-location', ffmpegDir,
          '--embed-metadata',
          '--convert-thumbnails', 'jpg',
          '--extractor-args', getExtractorArgs(),
          '--socket-timeout', '30',
          '--retries', '5',
          '--fragment-retries', '5',
          '-o', finalPath,
        ];

        // ── Query list: ISRC-first for exact match, then fallbacks ─────────────
        const queries = [];

        // Attempt 1: spotdl (Highest accuracy, strictly uses YouTube Music based on Spotify metadata)
        if (fs.existsSync(spotdlBin)) {
          queries.push({ q: track.spotifyUrl || `${track.artist} ${track.title}`, spotdl: true, src: 'spotdl (Primary)' });
        }

        // Attempt 2: ISRC-based search (100% exact match guarantee, direct download for maximum speed)
        if (track.isrc) {
          queries.push({ q: `ytsearch1:${track.isrc}`, src: 'YouTube Music (ISRC)', direct: true });
        }

        // (Removed Attempt 2: Spotify direct URL via yt-dlp, because yt-dlp searches the URL on YouTube, leading to 29s false songs!)

        // Attempt 3: YouTube Music search — "Artist - Title"
        queries.push({ q: `ytsearch3:${track.artist} - ${track.title} topic`, src: 'YouTube Music' });

        // Attempt 4: YouTube Music alt — "Title Artist audio"
        queries.push({ q: `ytsearch3:${track.title} ${track.artist} audio`, src: 'YouTube Music Alt' });

        // Attempt 5: YouTube search — official audio
        queries.push({ q: `ytsearch3:${track.artist} ${track.title} official audio`, src: 'YouTube' });

        // Attempt 6: YouTube search with geo bypass
        queries.push({ q: `ytsearch3:${track.artist} ${track.title}`, geo: true, src: 'YouTube GeoUS' });

        // Attempt 7: SoundCloud
        queries.push({ q: `scsearch3:${track.artist} ${track.title}`, src: 'SoundCloud' });

        // Attempt 9: Ultimate fallback (blindly download first result for unreleased/leaked songs)
        queries.push({ q: `ytsearch1:${track.artist} - ${track.title}`, src: 'Ultimate Fallback (No Checks)', direct: true });

        let success = false;
        let attemptNum = 1;
        let matchedSource = '';

        for (const query of queries) {
          if (dlState.cancelled) break;

          if (query.spotdl) {
            appendLog(`Attempt ${attemptNum} (spotdl): ${query.q}`);
            // Append .{output-ext} so spotdl treats the path as a file template rather than a directory!
            const spotdlOutTemplate = `${finalPath.slice(0, finalPath.lastIndexOf('.'))}.{output-ext}`;
            const spotdlArgs = process.platform === 'win32'
              ? ['/c', 'chcp', '65001', '>', 'nul', '&', 'call', spotdlBin, 'download', query.q, '--ffmpeg', ffmpegBin, '--output', spotdlOutTemplate, '--format', safeAudioFormat]
              : ['download', query.q, '--ffmpeg', ffmpegBin, '--output', spotdlOutTemplate, '--format', safeAudioFormat];
            const spotdlP = spawn(process.platform === 'win32' ? 'cmd.exe' : spotdlBin, spotdlArgs, {
              windowsHide: true,
              env: { ...process.env, PYTHONIOENCODING: 'utf-8', PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
            });
            dlState.procs.add(spotdlP);
            spotdlP.stdout.on('data', () => {}); // Consume stdout
            spotdlP.stderr.on('data', () => {}); // Consume stderr
            const ok = await new Promise(r => {
              spotdlP.on('close', code => { dlState.procs.delete(spotdlP); r(code === 0 && fs.existsSync(finalPath)); });
            });
            if (ok) { success = true; matchedSource = 'spotdl'; break; }

          } else if (query.direct) {
            // Direct URL (e.g. spotify:// or direct YT URL) — skip search step
            appendLog(`Attempt ${attemptNum} (${query.src}): ${query.q}`);
            const dlP = spawn(binPath, [...ytDlpArgsBase, query.q], { windowsHide: true });
            dlState.procs.add(dlP);
            dlP.stderr.on('data', () => {}); // Consume stderr
            dlP.stdout.on('data', d => {
              const m = d.toString().match(/\[download\]\s+([\d.]+)%/);
              if (m) send({ trackProgress: parseFloat(m[1]) });
            });
            const ok = await new Promise(r => dlP.on('close', code => {
              dlState.procs.delete(dlP); r(code === 0 && fs.existsSync(finalPath));
            }));
            if (ok) { success = true; matchedSource = query.src; break; }

          } else {
            appendLog(`Attempt ${attemptNum} (${query.src}): ${query.q}`);
            const searchArgs = ['--dump-json', '--no-playlist', query.q];
            if (query.geo) searchArgs.push('--geo-bypass-country', 'US');

            const searchP = spawn(binPath, searchArgs, { windowsHide: true });
            dlState.procs.add(searchP);
            let searchOut = '';
            searchP.stdout.on('data', d => searchOut += d.toString());
            searchP.stderr.on('data', () => {}); // Consume stderr
            await new Promise(r => searchP.on('close', r));
            dlState.procs.delete(searchP);

            const results = searchOut.trim().split('\n')
              .map(l => { try { return JSON.parse(l); } catch(e) { return null; } })
              .filter(Boolean);

            let bestMatch = null;
            for (const res of results) {
              const normTitleTarget = normalizeTitle(track.title);
              const normTitleFound = normalizeTitle(res.title);
              const normArtistTarget = normalizeTitle(track.artist);
              const normArtistFound = normalizeTitle(res.channel || res.uploader || '');

              const tDist = levenshteinDistance(normTitleTarget, normTitleFound);
              const aDist = levenshteinDistance(normArtistTarget, normArtistFound);
              const maxT = Math.max(normTitleTarget.length, normTitleFound.length, 1);
              const maxA = Math.max(normArtistTarget.length, normArtistFound.length, 1);
              let tScore = Math.max(0, 1 - tDist / maxT);
              let aScore = Math.max(0, 1 - aDist / maxA);
              let combinedScore = (tScore * 0.65) + (aScore * 0.35);

              let dScore = 1;
              if (track.durationMs && res.duration) {
                const diffMs = Math.abs((res.duration * 1000) - track.durationMs);
                if (diffMs > 15000) {
                  // > 15s difference means it's likely a short, a teaser, or an extended music video. Reject!
                  dScore = 0;
                  combinedScore *= 0.1;
                } else if (diffMs > 5000) {
                  dScore = 0.5;
                  combinedScore *= 0.8;
                }
              }

              appendLog(`  Scored "${res.title}" by "${res.channel}" -> T:${tScore.toFixed(2)}, A:${aScore.toFixed(2)}, D:${dScore.toFixed(2)}, C:${combinedScore.toFixed(2)}`);
              // ISRC searches are trusted more — lower threshold
              const threshold = query.src.includes('ISRC') ? 0.40 : 0.65;
              if (combinedScore >= threshold && aScore >= 0.25) {
                bestMatch = res.webpage_url || (res.id ? `https://www.youtube.com/watch?v=${res.id}` : null);
                break;
              }
            }

            if (bestMatch) {
              appendLog(`Downloading match: ${bestMatch}`);
              const dlArgs = [...ytDlpArgsBase, bestMatch];
              if (query.geo) dlArgs.push('--geo-bypass-country', 'US');

              const dlP = spawn(binPath, dlArgs, { windowsHide: true });
              dlState.procs.add(dlP);
              dlP.stderr.on('data', () => {}); // Consume stderr
              dlP.stdout.on('data', d => {
                const m = d.toString().match(/\[download\]\s+([\d.]+)%/);
                if (m) send({ trackProgress: parseFloat(m[1]) });
              });
              const ok = await new Promise(r => dlP.on('close', code => {
                dlState.procs.delete(dlP); r(code === 0 && fs.existsSync(finalPath));
              }));
              if (ok) { success = true; matchedSource = query.src; break; }
            } else {
              appendLog(`No smart match passed thresholds for attempt ${attemptNum}.`);
            }
          }
          attemptNum++;
          if (attemptNum <= queries.length) await new Promise(r => setTimeout(r, 1500));
        }

        if (success) {
          try {
            await writeAndVerifyTags(finalPath, track, coverBuf);
            const dlJson = readJson(downloadedJsonPath);
            dlJson.push({ track: track.title, artist: track.artist, source: matchedSource, attempt: attemptNum, timestamp: new Date().toISOString() });
            writeJson(downloadedJsonPath, dlJson);
            // ⚡ Send trackDone as boolean true so frontend detection works correctly
            send({
              trackDone: true,
              trackTitle: track.title,
              trackArtist: track.artist,
              source: matchedSource,
              attempt: attemptNum,
            });
            appendLog(`Success: ${track.title} via ${matchedSource}`);
          } catch(e) {
            send({ trackDone: true, trackTitle: track.title, trackArtist: track.artist, source: matchedSource });
            appendLog(`Tagging error for ${track.title}: ${e.message}`);
          }
          return { success: true, source: matchedSource };
        } else {
          const pendJson = readJson(pendingJsonPath);
          pendJson.push({ track: track.title, artist: track.artist, reason: 'All attempts failed', timestamp: new Date().toISOString() });
          writeJson(pendingJsonPath, pendJson);
          send({ trackPending: { title: track.title, artist: track.artist, reason: 'All attempts failed' } });
          appendLog(`Failed: ${track.title}`);
          return { success: false };
        }
      };

      const CONCURRENCY = 3;
      let qIndex = 0;
      let completedCount = 0;
      let failedCount = 0;
      const failedTracksData = [];

      const worker = async () => {
        while (qIndex < tracks.length && !dlState.cancelled) {
          const i = qIndex++;
          const result = await processTrack(tracks[i], i);
          if (result?.success) { completedCount++; } else { failedCount++; failedTracksData.push({ title: tracks[i]?.title, artist: tracks[i]?.artist }); }
          const processed = completedCount + failedCount;
          send({ playlistDone: { total: tracks.length, done: processed, pending: tracks.length - processed } });
          send({ progress: Math.round(5 + (processed / tracks.length) * 90) });
        }
      };

      const workers = Array.from({ length: CONCURRENCY }, worker);
      await Promise.all(workers);

      spotifyActiveDownloads.delete(downloadId);
      if (dlState.cancelled) {
        send({ error: 'Download cancelled', done: true });
      } else {
        send({
          done: true,
          progress: 100,
          completedTracks: completedCount,
          failedTracks: failedCount,
          failedTracksData,
          totalTracks: tracks.length,
          spotifyType: metadata.type,
          collectionTitle: isCollection ? (metadata.title || collectionFolderName) : null,
          finalFilename: isCollection ? collectionFolderName : `${sanitizeFilename(tracks[0]?.artist || 'Unknown')} - ${sanitizeFilename(tracks[0]?.title || 'Unknown')}.${safeAudioFormat}`,
        });
      }
      res.end();
    };

    req.on('aborted', () => {
      dlState.cancelled = true;
      for (const p of dlState.procs) { try { p.kill(); } catch {} }
      spotifyActiveDownloads.delete(downloadId);
    });

    runDownload().catch(e => {
      send({ error: e.message, done: true });
      res.end();
    });
  });

  middlewares.use('/api/spotify-cancel', (req, res, next) => { const u = new URL(req.url, `http://${req.headers.host}`); if (u.pathname !== '/') return next(); const did = u.searchParams.get('downloadId'); if (!did) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Missing downloadId' })) }; const dl = spotifyActiveDownloads.get(did); if (dl) { dl.cancelled = true; if (dl.procs) { for (const p of dl.procs) { try { if (process.platform === 'win32') { require('child_process').spawnSync('taskkill', ['/pid', p.pid, '/f', '/t']) } else { p.kill('SIGKILL') } } catch { } } }; if (dl.proc) { try { dl.proc.kill() } catch { } }; spotifyActiveDownloads.delete(did) }; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: true })) })

  // â”€â”€ Enrich tracks: instant Spotify lookup for playlist UI display â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  middlewares.use('/api/ytdl/enrich-tracks', (req, res, next) => {
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (u.pathname !== '/') return next();
    if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed'); }
    let b = '';
    req.on('data', c => (b += c));
    req.on('end', async () => {
      try {
        const d = JSON.parse(b);
        const { items } = d;
        if (!items || !Array.isArray(items) || items.length === 0 || items.length > 20) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: 'Invalid items array (max 20)' }));
        }
        const cfg = getConfig();
        const cid = cfg.SPOTIFY_CLIENT_ID || process.env.VITE_SPOTIFY_CLIENT_ID || null;
        const cs = cfg.SPOTIFY_CLIENT_SECRET || process.env.VITE_SPOTIFY_CLIENT_SECRET || null;

        let results = [];
        if (cid && cs) {
          let accessToken = null;
          results = await Promise.all(items.map(async (item) => {
            const q = `${item.uploader ? item.uploader + ' ' : ''}${item.title}`;
            try {
              const spotData = await searchSpotifyAPI(q, cid, cs, accessToken);
              if (spotData) return { id: item.id, title: spotData.title, thumbnail: spotData.coverUrl, uploader: spotData.artist, album: spotData.album, artistThumbnail: spotData.artistThumbnail, enriched: true };
            } catch (e) { }
            return { id: item.id, enriched: false };
          }));
        } else {
          results = items.map(item => ({ id: item.id, enriched: false }));
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, results: results.filter(r => r.enriched) }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
    });
  });

  // â”€â”€ Tag augmentation: enrich MP3 with Spotify official metadata â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function augmentYtTags(filePath, playlistIndex = null, playlistLength = null, coverBuffer = null) {
    try {
      // 1. Read ALL fields yt-dlp already embedded via --embed-metadata
      //    These are our baseline â€” we only override with better data, never destroy.
      const existingTags = NodeID3.read(filePath) || {};

      // Derive title/artist from filename as last resort
      let title = existingTags.title;
      let artist = existingTags.artist;
      if (!title && !artist) {
        const bn = path.basename(filePath, '.mp3');
        const parts = bn.split(' - ');
        if (parts.length >= 2) { artist = parts[0]; title = parts.slice(1).join(' - '); }
        else { title = bn; }
      }

      // 2. Build a complete tagTrack from yt-dlp's embedded data as the baseline
      //    node-id3 field names: performerInfo = album artist (TPE2), partOfSet = disc number
      const tagTrack = {
        title: title || '',
        artist: artist || '',
        allArtists: existingTags.performerInfo || artist || '',
        album: existingTags.album || '',
        year: existingTags.year || '',
        genre: existingTags.genre || '',
        trackNumber: existingTags.trackNumber || '',
        discNumber: existingTags.partOfSet || '',
        isrc: existingTags.isrc || '',
        copyright: existingTags.copyright || '',
        label: existingTags.publisher || '',
      };

      // 3. Try to enrich with Spotify â€” overlay only the fields Spotify provides
      const cfg = getConfig();
      const cid = cfg.SPOTIFY_CLIENT_ID || process.env.VITE_SPOTIFY_CLIENT_ID || null;
      const cs = cfg.SPOTIFY_CLIENT_SECRET || process.env.VITE_SPOTIFY_CLIENT_SECRET || null;

      if (cid && cs) {
        try {
          const q = `${artist ? artist + ' ' : ''}${title}`;
          const spotMetadata = await searchSpotifyAPI(q, cid, cs, null);
          if (spotMetadata) {
            // Overlay Spotify fields â€” Spotify data is authoritative for these
            if (spotMetadata.title) tagTrack.title = spotMetadata.title;
            if (spotMetadata.artist) tagTrack.artist = spotMetadata.artist;
            if (spotMetadata.allArtists) tagTrack.allArtists = spotMetadata.allArtists;
            if (spotMetadata.album) tagTrack.album = spotMetadata.album;
            if (spotMetadata.year) tagTrack.year = String(spotMetadata.year);
            if (spotMetadata.genre) tagTrack.genre = spotMetadata.genre;
            if (spotMetadata.trackNumber) tagTrack.trackNumber = spotMetadata.trackNumber;
            if (spotMetadata.totalTracks) tagTrack.totalTracks = spotMetadata.totalTracks;
            if (spotMetadata.discNumber) tagTrack.discNumber = spotMetadata.discNumber;
            if (spotMetadata.totalDiscs) tagTrack.totalDiscs = spotMetadata.totalDiscs;
            if (spotMetadata.isrc) tagTrack.isrc = spotMetadata.isrc;
            if (spotMetadata.releaseDate) tagTrack.releaseDate = spotMetadata.releaseDate;
            if (spotMetadata.label) tagTrack.label = spotMetadata.label;
            if (spotMetadata.copyright) tagTrack.copyright = spotMetadata.copyright;

            // Fetch Spotify cover art (640Ã—640) â€” higher quality than YouTube thumbnails.
            // Always fetch when Spotify has a cover URL, so we can compare with any existing
            // yt-dlp embedded thumbnail and keep the best one.
            if (spotMetadata.coverUrl) {
              try {
                const resp = await fetch(spotMetadata.coverUrl);
                if (resp.ok) {
                  const spotBuf = Buffer.from(await resp.arrayBuffer());
                  // Use Spotify cover if: no existing cover, OR Spotify's is substantially larger
                  const existingSize = existingTags.image?.imageBuffer?.length || 0;
                  if (!coverBuffer && (!existingTags.image || spotBuf.length > existingSize * 1.2)) {
                    coverBuffer = spotBuf;
                  }
                }
              } catch (_) { }
            }

            // If still no cover (or existing is tiny), try YouTube maxresdefault
            if (!coverBuffer || (existingTags.image?.imageBuffer?.length || 0) < 50000) {
              const ytVideoId = extractYtVideoId(
                existingTags.comment?.text || existingTags.comment || ''
              );
              if (ytVideoId) {
                try {
                  const hdBuf = await fetchHDCoverBuffer(ytVideoId, null);
                  if (hdBuf && hdBuf.length > (coverBuffer?.length || 0)) {
                    coverBuffer = hdBuf;
                  }
                } catch (_) { }
              }
            }
          }
        } catch (e) {
          console.log(`[tags] Spotify search failed for "${title}": ${e.message}`);
        }
      }

      // 4. Apply playlist index as track number when downloading playlists
      //    (only if no track number was found from Spotify or yt-dlp)
      const tagConfig = { playlistIndex, playlistLength, clearComments: true };

      // 4b. HD cover upgrade â€” runs even when Spotify is not configured.
      //     If we have no cover yet, or the existing embedded cover is tiny (< 50 KB),
      //     try to fetch maxresdefault from YouTube using the video ID stored in the
      //     comment tag by yt-dlp (e.g. "https://www.youtube.com/watch?v=XXXXXXXXXXX").
      if (!coverBuffer || (existingTags.image?.imageBuffer?.length || 0) < 50000) {
        const commentText = existingTags.comment?.text || (typeof existingTags.comment === 'string' ? existingTags.comment : '') || '';
        const ytVideoId = extractYtVideoId(commentText);
        if (ytVideoId) {
          try {
            const hdBuf = await fetchHDCoverBuffer(ytVideoId, null);
            if (hdBuf && hdBuf.length > (coverBuffer?.length || 0)) {
              // Square-crop and scale to 1400Ã—1400 via ffmpeg for best quality
              const tempCrop = filePath + '.hdcover.jpg';
              try {
                spawnSync(ffmpegBin, [
                  '-y', '-i', 'pipe:0',
                  '-vf', 'crop=min(iw\\,ih):min(iw\\,ih),scale=1920:1920:flags=lanczos',
                  '-frames:v', '1', '-q:v', '1', tempCrop
                ], { input: hdBuf, windowsHide: true });
                if (fs.existsSync(tempCrop) && fs.statSync(tempCrop).size > 5000) {
                  coverBuffer = fs.readFileSync(tempCrop);
                } else {
                  coverBuffer = hdBuf;
                }
              } catch (_) { coverBuffer = hdBuf; }
              finally { try { if (fs.existsSync(tempCrop)) fs.unlinkSync(tempCrop); } catch (_) { } }
              console.log(`[cover] HD YouTube cover applied (${coverBuffer.length} bytes) for "${tagTrack.title}"`);
            }
          } catch (_) { }
        }
      }

      // 5. Write tags â€” writeAndVerifyTags preserves the yt-dlp embedded cover if coverBuffer is null
      await writeAndVerifyTags(filePath, tagTrack, coverBuffer, tagConfig);
      console.log(`[tags] Tagged: ${tagTrack.title} | Artist: ${tagTrack.artist} | Album: ${tagTrack.album || '(none)'} | Year: ${tagTrack.year || '?'} | Genre: ${tagTrack.genre || '?'} | Track: ${tagTrack.trackNumber || playlistIndex || '?'}`);
    } catch (e) {
      console.error(`[tags] Error augmenting ${filePath}: ${e.message}`);
    }
  }

}



