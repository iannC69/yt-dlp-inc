import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { resolveSpotifyMetadata } from './spotify-api.js'
import { getBatchPerformanceProfile } from './batch-engine.js'
import https from 'https'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = process.env.MEDIADL_APP_DIR || path.resolve(__dirname, '../../')
const bundledBinDir = process.env.MEDIADL_BIN_DIR || path.join(ROOT_DIR, 'bin')
const configPath = path.resolve(ROOT_DIR, 'config.json')

// ── CONFIG ──────────────────────────────────────────────────────────────
export function getConfig() {
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      return {
        customPath: cfg.customPath || '',
        spotifyThreshold: cfg.spotifyThreshold ?? 100,
        ytDlpFallbackEnabled: cfg.ytDlpFallbackEnabled ?? true,
        ytDlpDelay: cfg.ytDlpDelay ?? 2,
        audioFormat: (typeof urlObj !== 'undefined' && urlObj.searchParams && urlObj.searchParams.get('audioFormat') ? urlObj.searchParams.get('audioFormat') : cfg.audioFormat) || 'mp3',
        audioQuality: (typeof urlObj !== 'undefined' && urlObj.searchParams && urlObj.searchParams.get('audioQuality') ? urlObj.searchParams.get('audioQuality') : cfg.audioQuality) || '320k',
        spotifyClientId: cfg.spotifyClientId || '',
        spotifyClientSecret: cfg.spotifyClientSecret || ''
      }
    } catch (e) { }
  }
  return { 
    customPath: '', 
    spotifyThreshold: 100, 
    ytDlpFallbackEnabled: true, 
    ytDlpDelay: 2, 
    audioFormat: 'mp3', 
    audioQuality: '320k',
    spotifyClientId: '',
    spotifyClientSecret: ''
  }
}

export function saveConfig(cfg) {
  const current = getConfig();
  const merged = { ...current, ...cfg };
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

export function ensureDownloadsDir(customPath = null) {
  const cfg = getConfig();
  let dir = customPath || cfg.customPath;
  if (!dir) dir = path.join(ROOT_DIR, 'downloads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── LOGGING SYSTEM ──────────────────────────────────────────────────────
const logBuffer = [];
const sseClients = new Set();

export function log(level, source, message, trackTitle = null) {
  const entry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
    trackTitle
  };
  
  logBuffer.push(entry);
  if (logBuffer.length > 500) logBuffer.shift();
  
  // Notify SSE clients
  for (const client of sseClients) {
    try {
      client.write(`data: ${JSON.stringify(entry)}\n\n`);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// Keep-alive for SSE
const sseKeepAliveTimer = setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(':keepalive\n\n');
    } catch (e) {
      sseClients.delete(client);
    }
  }
}, 15000);
sseKeepAliveTimer.unref?.();

// ── STARTUP CHECKS ──────────────────────────────────────────────────────
export function checkDependencies() {
  const tools = ['yt-dlp', 'spotdl', 'ffmpeg'];
  const platformCmd = process.platform === 'win32' ? 'where' : 'which';
  
  for (const tool of tools) {
    const proc = spawn(platformCmd, [tool]);
    let output = '';
    proc.stdout.on('data', d => output += d);
    proc.on('close', (code) => {
      if (code === 0) {
        log('SUCCESS', 'system', `${tool} found: ${output.split('\n')[0].trim()}`);
      } else {
        log('ERROR', 'system', `${tool} NOT FOUND — install it before downloading`);
      }
    });
  }
}

export function configureNewBackend(server) {
  checkDependencies();

  // Settings Config API
  server.middlewares.use('/api/config', (req, res, next) => {
    const urlObj = new URL(req.url, `http://${req.headers.host}`)
    if (urlObj.pathname !== '/') return next()
    
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(getConfig()));
    }
    
    if (req.method === 'PATCH' || req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const newCfg = saveConfig(JSON.parse(body));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(newCfg));
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    next();
  });

  // Logging API
  server.middlewares.use('/api/logs/stream', (req, res, next) => {
    const urlObj = new URL(req.url, `http://${req.headers.host}`)
    if (urlObj.pathname !== '/') return next()

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  });

  server.middlewares.use('/api/logs', (req, res, next) => {
    const urlObj = new URL(req.url, `http://${req.headers.host}`)
    if (urlObj.pathname !== '/') return next()
    
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(logBuffer));
    }
    if (req.method === 'DELETE') {
      logBuffer.length = 0;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ success: true }));
    }
    next();
  });

  // Spotify test endpoint
  server.middlewares.use('/api/spotify/test', async (req, res, next) => {
    const urlObj = new URL(req.url, `http://${req.headers.host}`)
    if (urlObj.pathname !== '/') return next()
    
    const cfg = getConfig();
    if (!cfg.spotifyClientId || !cfg.spotifyClientSecret) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "No credentials provided" }));
    }
    try {
      await resolveSpotifyMetadata('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', cfg.spotifyClientId, cfg.spotifyClientSecret);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true }));
    } catch (e) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  // Task 1: URL List Resolver (moved from vite.config.js)
  server.middlewares.use('/api/mass/url-list', async (req, res, next) => {
    const urlObj = new URL(req.url, `http://${req.headers.host}`)
    if (urlObj.pathname !== '/') return next()
    if (req.method !== 'POST') {
      res.statusCode = 405;
      return res.end(JSON.stringify({ error: 'POST only' }))
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const urls = Array.isArray(payload.urls) ? payload.urls.slice(0, 5000) : [];
        if (urls.length === 0) {
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ items: [] }));
        }

        const cfg = getConfig();
        const results = [];

        for (const inputUrl of urls) {
          if (/spotify\.com\/(playlist|album|track)\//.test(inputUrl)) {
            try {
              log('INFO', 'spotify-api', `Resolving Spotify URL: ${inputUrl}`);
              const metadata = await resolveSpotifyMetadata(inputUrl, cfg.spotifyClientId, cfg.spotifyClientSecret);
              
              if (metadata.type === 'track') {
                results.push({
                  url: inputUrl,
                  id: String(metadata.trackNumber || 1),
                  title: metadata.title,
                  channel: metadata.artist,
                  duration: metadata.durationMs ? Math.floor(metadata.durationMs / 1000) : 0,
                  durationMs: metadata.durationMs || 0,
                  thumbnail: metadata.coverUrl || metadata.artistThumbnail || null,
                  type: 'spotify',
                  spotifyUrl: metadata.spotifyUrl
                });
              } else {
                // album or playlist
                log('SUCCESS', 'spotify-api', `Resolved ${metadata.tracks.length} tracks from ${metadata.title}`);
                const mapped = metadata.tracks.map(t => ({
                  url: t.spotifyUrl || inputUrl,
                  id: String(t.trackNumber),
                  title: t.title,
                  channel: t.artist,
                  duration: t.durationMs ? Math.floor(t.durationMs / 1000) : 0,
                  durationMs: t.durationMs || 0,
                  thumbnail: t.coverUrl || metadata.coverUrl || null,
                  type: 'spotify',
                  spotifyUrl: t.spotifyUrl
                }));
                results.push(...mapped);
              }
            } catch (e) {
              log('ERROR', 'spotify-api', `Failed to resolve ${inputUrl}: ${e.message}`);
              results.push({ url: inputUrl, error: e.message || 'Failed to fetch Spotify playlist', title: inputUrl });
            }
          } else {
             // Fallback for youtube urls or search terms
             results.push({
               url: inputUrl,
               id: crypto.randomUUID(),
               title: inputUrl,
               channel: 'Unknown',
               duration: 0,
               durationMs: 0,
               thumbnail: null,
               type: 'unknown'
             });
          }
        }
        
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ items: results }));
      } catch (e) {
        log('ERROR', 'system', `URL list resolution failed: ${e.message}`);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  });

  // Task 3: Hybrid Mass Download endpoint
  const activeMassDownloads = new Map();
  const getFfmpegDir = () => bundledBinDir;
  const parseJsonBody = async (req) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    return body ? JSON.parse(body) : null;
  };

  server.middlewares.use('/api/spotify-mass-cancel', (req, res, next) => {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    if (urlObj.pathname !== '/') return next();

    const downloadId = urlObj.searchParams.get('downloadId');
    if (downloadId && activeMassDownloads.has(downloadId)) {
      const dl = activeMassDownloads.get(downloadId);
      dl.cancelled = true;
      for (const proc of dl.procs || []) { try { proc.kill() } catch { } }
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true }));
  });

  server.middlewares.use('/api/spotify-mass-download', (req, res, next) => {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    if (urlObj.pathname !== '/') return next();

    const downloadId = urlObj.searchParams.get('downloadId');
    if (!downloadId) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'Missing downloadId param' }));
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { } };

    const dlState = { cancelled: false, proc: null, procs: new Set() };
    activeMassDownloads.set(downloadId, dlState);

    const runMassDownload = async (bodyData) => {
      const cfg = getConfig();
      const threshold = cfg.spotifyThreshold || 100;
      const ytDelay = cfg.ytDlpDelay || 2;
      const enableYtFallback = cfg.ytDlpFallbackEnabled ?? true;
      
      let tracks = bodyData?.tracks || [];
      const playlistName = bodyData?.playlistName || 'playlist';
      const safeName = playlistName.replace(/[\/\\:*?"<>|]/g, '_').trim() || 'playlist';
      
      if (tracks.length === 0) {
        send({ done: true, error: 'No tracks provided' });
        return res.end();
      }

      send({ current: 0, total: tracks.length, status: `Loaded ${tracks.length} tracks. Starting Hybrid Download.` });
      log('INFO', 'system', `Started mass download for ${tracks.length} tracks. Threshold: ${threshold}`);

      const tempDir = path.join(ensureDownloadsDir(typeof urlObj !== 'undefined' ? (urlObj.searchParams ? urlObj.searchParams.get('customPath') : null) : null), `mass-${safeName}-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });

      let completedCount = 0;
      let failedCount = 0;
      const activeProcs = new Set();
      const requestedConcurrency = Math.min(24, Math.max(1, parseInt(urlObj.searchParams.get('concurrency') || '3', 10)));
      const speedMode = urlObj.searchParams.get('speedMode') === 'MAXIMUM' ? 'MAXIMUM' : 'BALANCED';
      const performanceProfile = getBatchPerformanceProfile(requestedConcurrency, speedMode);
      const MASS_CONCURRENCY = performanceProfile.concurrency;
      send({ performanceProfile, status: `Starting ${tracks.length} tracks with ${MASS_CONCURRENCY} workers.` });

      const ytDlpPath = path.join(bundledBinDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
      const spotDlPath = path.join(bundledBinDir, process.platform === 'win32' ? 'spotdl.exe' : 'spotdl');
      
      const downloadTrack = async (track, i) => {
        if (dlState.cancelled) return;
        
        send({
          current: completedCount + failedCount + activeProcs.size,
          total: tracks.length,
          percent: Math.round(((completedCount + failedCount) / tracks.length) * 100),
          title: track.title,
          artist: track.artist,
          coverUrl: track.coverUrl,
          failed: failedCount,
          estimatedSecondsRemaining: 0
        });

        const safeArtist = track.artist.replace(/[<>:"/|?*]+/g, '_');
        const safeTitle = track.title.replace(/[<>:"/|?*]+/g, '_');
        const trackDir = path.join(tempDir, `${String(i + 1).padStart(4, '0')}-${safeArtist}-${safeTitle}`);
        fs.mkdirSync(trackDir, { recursive: true });

        // Hybrid Logic
        let useSpotDl = (i < threshold) && track.spotifyUrl;
        
        let downloadedOk = false;
        let finalFilename = '';
        
        if (useSpotDl) {
           log('INFO', 'spotdl', `Downloading via spotdl: ${track.artist} - ${track.title}`);
           downloadedOk = await new Promise(resolve => {
             const outputTemplate = path.join(trackDir, `{list-position} - {artist} - {title}.{output-ext}`);
             const args = [
               'download', track.spotifyUrl,
               '--output', outputTemplate,
               '--format', (typeof urlObj !== 'undefined' && urlObj.searchParams && urlObj.searchParams.get('audioFormat') ? urlObj.searchParams.get('audioFormat') : cfg.audioFormat) || 'mp3',
               '--bitrate', (typeof urlObj !== 'undefined' && urlObj.searchParams && urlObj.searchParams.get('audioQuality') ? urlObj.searchParams.get('audioQuality') : cfg.audioQuality) || '320k',
               '--threads', '1',
               '--ffmpeg', getFfmpegDir()
             ];
             const proc = spawn(spotDlPath, args, { shell: process.platform === 'win32' });
             activeProcs.add(proc);
             dlState.procs.add(proc);
             
             let out = '';
             proc.stdout.on('data', d => out += d);
             proc.stderr.on('data', d => out += d);
             proc.on('close', code => {
               activeProcs.delete(proc);
               dlState.procs.delete(proc);
               if (code === 0) resolve(true);
               else {
                 log('ERROR', 'spotdl', `Failed: ${track.title}. ${out.slice(0, 200)}`);
                 resolve(false);
               }
             });
             proc.on('error', (e) => {
               log('ERROR', 'spotdl', `Spawn error: ${e.message}`);
               resolve(false);
             });
           });
        }
        
        // Fallback or explicit yt-dlp
        if (!downloadedOk && (enableYtFallback || !useSpotDl)) {
           if (ytDelay > 0) {
             await new Promise(r => setTimeout(r, ytDelay * 1000));
           }
           log('INFO', 'yt-dlp', `Downloading via yt-dlp: ${track.artist} - ${track.title}`);
           const query = track.spotifyUrl && !useSpotDl 
              ? `ytsearch1:${track.artist} ${track.title} official audio`
              : (track.url && !track.url.startsWith('ytsearch') && !track.url.startsWith('http') ? `ytsearch1:${track.url}` : track.url);
              
           const outputName = `${String(i + 1).padStart(4, '0')} - ${safeArtist} - ${safeTitle}.%(ext)s`;
           downloadedOk = await new Promise(resolve => {
             const args = [
                query,
                '-x', '--audio-format', (typeof urlObj !== 'undefined' && urlObj.searchParams && urlObj.searchParams.get('audioFormat') ? urlObj.searchParams.get('audioFormat') : cfg.audioFormat) || 'mp3',
                '--audio-quality', '0',
                '-o', path.join(trackDir, outputName),
                '--no-playlist',
                '--ffmpeg-location', getFfmpegDir()
             ];
             const proc = spawn(ytDlpPath, args, { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
             activeProcs.add(proc);
             dlState.procs.add(proc);
             
             proc.on('close', code => {
               activeProcs.delete(proc);
               dlState.procs.delete(proc);
               resolve(code === 0);
             });
             proc.on('error', () => resolve(false));
           });
           
           if (downloadedOk && (typeof urlObj !== 'undefined' && urlObj.searchParams && urlObj.searchParams.get('audioFormat') ? urlObj.searchParams.get('audioFormat') : cfg.audioFormat) === 'mp3') {
              try {
                // simple tagging for yt-dlp fallback
                const files = fs.readdirSync(trackDir).filter(f => f.endsWith('.mp3'));
                if (files[0]) {
                  const fp = path.join(trackDir, files[0]);
                  NodeID3.update({
                    title: track.title,
                    artist: track.artist,
                    trackNumber: `${i + 1}`
                  }, fp);
                }
              } catch (e) { }
           }
        }

        if (dlState.cancelled) return;

        try {
          const files = fs.readdirSync(trackDir);
          if (downloadedOk && files.length > 0) {
            const finalFile = files.find(f => ['.mp3','.m4a','.flac','.opus','.wav','.ogg'].some(ext => f.endsWith(ext)));
            if (finalFile) {
              fs.renameSync(path.join(trackDir, finalFile), path.join(tempDir, finalFile));
              completedCount++;
              log('SUCCESS', useSpotDl ? 'spotdl' : 'yt-dlp', `Finished ${track.title}`);
            } else {
              failedCount++;
            }
          } else {
            failedCount++;
          }
        } catch { failedCount++; }
        
        try { fs.rmSync(trackDir, { recursive: true, force: true }); } catch { }
      };

      const queue = tracks.map((t, i) => ({ t, i }));
      let queueIdx = 0;
      const runConcurrent = async () => {
        while (true) {
          if (queueIdx >= queue.length || dlState.cancelled) break;
          const item = queue[queueIdx++];
          await downloadTrack(item.t, item.i);
        }
      };
      
      await Promise.all(Array.from({ length: MASS_CONCURRENCY }, () => runConcurrent()));
      activeMassDownloads.delete(downloadId);

      if (dlState.cancelled) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { }
        send({ done: true, cancelled: true });
        log('WARN', 'system', 'Mass download cancelled');
        return res.end();
      }

      send({ current: tracks.length, total: tracks.length, percent: 99, status: 'Creating ZIP...', estimatedSecondsRemaining: 0 });
      log('INFO', 'system', 'Archiving tracks into ZIP...');

      try {
        const archiver = (await import('archiver')).default;
        const zipFilename = `spotify-playlist-${safeName}.zip`;
        const zipPath = path.join(ensureDownloadsDir(typeof urlObj !== 'undefined' ? (urlObj.searchParams ? urlObj.searchParams.get('customPath') : null) : null), zipFilename);
        
        await new Promise((resolve, reject) => {
          const output = fs.createWriteStream(zipPath);
          const archive = archiver('zip', { zlib: { level: 9 } });
          output.on('close', resolve);
          archive.on('error', reject);
          archive.pipe(output);
          archive.directory(tempDir, false);
          archive.finalize();
        });

        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { }
        log('SUCCESS', 'system', `ZIP created successfully: ${zipFilename}`);
        send({ done: true, zipPath: zipFilename, completedCount, failedCount });
        res.end();
      } catch (e) {
        log('ERROR', 'system', 'ZIP creation failed: ' + e.message);
        send({ done: true, error: 'ZIP failed: ' + e.message });
        res.end();
      }
    };

    req.on('aborted', () => {
      dlState.cancelled = true;
      for (const proc of dlState.procs) { try { proc.kill(); } catch { } }
      activeMassDownloads.delete(downloadId);
    });

    const parsedBodyPromise = req.method === 'POST' ? parseJsonBody(req) : Promise.resolve(null);
    parsedBodyPromise.then(bodyData => {
      runMassDownload(bodyData).catch(err => {
        log('ERROR', 'system', 'Mass download crashed: ' + err.message);
        activeMassDownloads.delete(downloadId);
        send({ done: true, error: err.message });
        res.end();
      });
    });
  });
}
