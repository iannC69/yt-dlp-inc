const fs = require('fs');
const path = require('path');

const targetFile = path.resolve(__dirname, '../src/server/configure-routes.js');
let content = fs.readFileSync(targetFile, 'utf8');

const startMarker = "middlewares.use('/api/spotify-download', (req, res, next) => {";
const endMarker = "middlewares.use('/api/spotify-cancel', (req, res, next) => {";

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error("Markers not found");
  process.exit(1);
}

const newBlock = `  middlewares.use('/api/spotify-download', (req, res, next) => {
    const urlObj = new URL(req.url, \`http://\${req.headers.host}\`);
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

    const send = (data) => { try { res.write(\`data: \${JSON.stringify(data)}\\n\\n\`); } catch { } };
    const dlState = { cancelled: false, procs: new Set() };
    spotifyActiveDownloads.set(downloadId, dlState);
    
    req.on('close', () => {
      // Keep going in background
    });

    const runDownload = async () => {
      send({ status: 'Fetching metadata...', progress: 2 });
      let metadata;
      try {
        if (spotUrl.startsWith('{')) {
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

      send({ status: \`Starting download of \${tracks.length} tracks...\`, progress: 5, totalTracks: tracks.length });
      send({ playlistDone: { total: tracks.length, done: 0, pending: tracks.length } }); 

      const downloadsDir = ensureDownloadsDir(urlObj.searchParams.get('customPath'));
      const outputDir = isCollection ? path.join(downloadsDir, sanitizeFilename(metadata.title)) : downloadsDir;
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
      
      const downloadedJsonPath = path.join(outputDir, 'downloaded.json');
      const pendingJsonPath = path.join(outputDir, 'pending_manual.json');
      const logPath = path.join(process.cwd(), 'logs', 'session_log.txt');
      
      if (!fs.existsSync(path.dirname(logPath))) fs.mkdirSync(path.dirname(logPath), { recursive: true });
      const appendLog = (msg) => {
        try { fs.appendFileSync(logPath, \`[\${new Date().toISOString()}] \${msg}\\n\`); } catch(e){}
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
          .replace(/\\(official video\\)/g, '')
          .replace(/\\(official audio\\)/g, '')
          .replace(/\\(audio\\)/g, '')
          .replace(/\\[4k\\]/g, '')
          .replace(/\\[hd\\]/g, '')
          .replace(/- topic/g, '')
          .replace(/\\(lyric video\\)/g, '')
          .replace(/\\(visualizer\\)/g, '')
          .replace(/[^\\w\\s]/g, ' ')
          .replace(/\\s+/g, ' ')
          .trim();
      }
      
      const processTrack = async (track, index) => {
        if (dlState.cancelled) return;
        
        send({ trackStart: { title: track.title, artist: track.artist, index, total: tracks.length } });
        appendLog(\`Starting: \${track.artist} - \${track.title}\`);

        const safeArtist = sanitizeFilename(track.artist || 'Unknown');
        const safeTitle = sanitizeFilename(track.title || 'Unknown');
        const finalPath = path.join(outputDir, \`\${safeArtist} - \${safeTitle}.mp3\`);
        
        if (fs.existsSync(finalPath)) {
          send({ trackDone: { title: track.title, artist: track.artist, source: 'cache', attempt: 0 } });
          appendLog(\`Already exists: \${track.artist} - \${track.title}\`);
          return { success: true };
        }
        
        let coverBuf = null;
        if (track.coverUrl) {
          try {
            const fetch = (await import('node-fetch')).default;
            const cres = await fetch(track.coverUrl);
            if (cres.ok) coverBuf = await cres.buffer();
          } catch(e) {}
        }

        const ytDlpArgsBase = [
          '--format', 'bestaudio',
          '--extract-audio', '--audio-format', 'mp3',
          '--no-playlist', '--playlist-items', '1',
          '--ffmpeg-location', ffmpegBin,
          '-o', finalPath,
        ];

        const queries = [
          { q: \`ytmsearch3:\${track.artist} - \${track.title}\`, src: 'YouTube Music' },
          { q: \`ytmsearch3:\${track.title} \${track.artist} audio\`, src: 'YouTube Music Alt' },
          { q: \`ytsearch3:\${track.artist} \${track.title} official audio\`, src: 'YouTube' },
          { q: \`ytsearch3:\${track.artist} \${track.title}\`, geo: true, src: 'YouTube GeoUS' },
          { q: \`\${track.artist} \${track.title}\`, spotdl: true, src: 'spotdl' }
        ];

        let success = false;
        let attemptNum = 1;
        let matchedSource = '';

        for (const query of queries) {
          if (dlState.cancelled) break;
          
          if (query.spotdl) {
            appendLog(\`Attempt \${attemptNum} (spotdl): \${query.q}\`);
            const spotdlArgs = process.platform === 'win32' 
                ? ['/c', 'chcp', '65001', '>', 'nul', '&', 'call', spotdlBin, 'download', query.q, '--output', finalPath, '--format', 'mp3'] 
                : ['download', query.q, '--output', finalPath, '--format', 'mp3'];
            const spotdlP = spawn(process.platform === 'win32' ? 'cmd.exe' : spotdlBin, spotdlArgs, { windowsHide: true, env: {...process.env, PYTHONIOENCODING: 'utf-8', PATH: \`\${binDir}\${path.delimiter}\${process.env.PATH}\`} });
            dlState.procs.add(spotdlP);
            const ok = await new Promise(r => {
              spotdlP.on('close', code => { dlState.procs.delete(spotdlP); r(code === 0 && fs.existsSync(finalPath)); });
            });
            if (ok) {
              success = true;
              matchedSource = 'spotdl';
              break;
            }
          } else {
            appendLog(\`Attempt \${attemptNum} (\${query.src}): \${query.q}\`);
            const searchArgs = ['--dump-json', '--no-playlist', query.q];
            if (query.geo) searchArgs.push('--geo-bypass-country', 'US');
            
            const searchP = spawn(binPath, searchArgs, { windowsHide: true });
            dlState.procs.add(searchP);
            let searchOut = '';
            searchP.stdout.on('data', d => searchOut += d.toString());
            await new Promise(r => searchP.on('close', r));
            dlState.procs.delete(searchP);
            
            const results = searchOut.trim().split('\\n').map(l => {
              try { return JSON.parse(l); } catch(e) { return null; }
            }).filter(Boolean);

            let bestMatch = null;
            for (const res of results) {
              const normTitleTarget = normalizeTitle(track.title);
              const normTitleFound = normalizeTitle(res.title);
              const normArtistTarget = normalizeTitle(track.artist);
              const normArtistFound = normalizeTitle(res.channel || res.uploader);
              
              const tDist = levenshteinDistance(normTitleTarget, normTitleFound);
              const aDist = levenshteinDistance(normArtistTarget, normArtistFound);
              
              const tScore = Math.max(0, 1 - (tDist / Math.max(normTitleTarget.length, normTitleFound.length, 1)));
              const aScore = Math.max(0, 1 - (aDist / Math.max(normArtistTarget.length, normArtistFound.length, 1)));
              const combinedScore = (tScore * 0.65) + (aScore * 0.35);
              
              appendLog(\`Scored: \${res.title} by \${res.channel} -> T:\${tScore.toFixed(2)}, A:\${aScore.toFixed(2)}, C:\${combinedScore.toFixed(2)}\`);
              if (combinedScore >= 0.65 && aScore >= 0.30) {
                bestMatch = res.webpage_url;
                break;
              }
            }

            if (bestMatch) {
              appendLog(\`Downloading match: \${bestMatch}\`);
              const dlArgs = [...ytDlpArgsBase, bestMatch];
              if (query.geo) dlArgs.push('--geo-bypass-country', 'US');
              
              const dlP = spawn(binPath, dlArgs, { windowsHide: true });
              dlState.procs.add(dlP);
              
              dlP.stdout.on('data', d => {
                const text = d.toString();
                const m = text.match(/\\[download\\]\\s+(\\d+\\.\\d+)%/);
                if (m) {
                  send({ trackProgress: { percent: parseFloat(m[1]), speed: '' } });
                }
              });

              const ok = await new Promise(r => dlP.on('close', code => { dlState.procs.delete(dlP); r(code === 0 && fs.existsSync(finalPath)); }));
              if (ok) {
                success = true;
                matchedSource = query.src;
                break;
              }
            } else {
              appendLog(\`No smart match passed thresholds.\`);
            }
          }
          attemptNum++;
          await new Promise(r => setTimeout(r, 2000));
        }

        if (success) {
          try {
            await writeAndVerifyTags(finalPath, track, coverBuf);
            const dlJson = readJson(downloadedJsonPath);
            dlJson.push({ track: track.title, artist: track.artist, source: matchedSource, attempt: attemptNum, timestamp: new Date().toISOString() });
            writeJson(downloadedJsonPath, dlJson);
            send({ trackDone: { title: track.title, artist: track.artist, source: matchedSource, attempt: attemptNum } });
            appendLog(\`Success: \${track.title} via \${matchedSource}\`);
          } catch(e) {
            appendLog(\`Tagging error for \${track.title}: \${e.message}\`);
          }
        } else {
          const pendJson = readJson(pendingJsonPath);
          pendJson.push({ track: track.title, artist: track.artist, reason: 'All attempts failed', timestamp: new Date().toISOString() });
          writeJson(pendingJsonPath, pendJson);
          send({ trackPending: { title: track.title, artist: track.artist, reason: 'All attempts failed' } });
          appendLog(\`Failed: \${track.title}\`);
        }
      };

      const CONCURRENCY = 3;
      let qIndex = 0;
      let doneCount = 0;
      const worker = async () => {
        while (qIndex < tracks.length && !dlState.cancelled) {
          const i = qIndex++;
          await processTrack(tracks[i], i);
          doneCount++;
          send({ playlistDone: { total: tracks.length, done: doneCount, pending: tracks.length - doneCount } });
          send({ progress: Math.round(5 + (doneCount / tracks.length) * 95) });
        }
      };

      const workers = Array.from({ length: CONCURRENCY }, worker);
      await Promise.all(workers);

      spotifyActiveDownloads.delete(downloadId);
      if (dlState.cancelled) {
        send({ error: 'Download cancelled', done: true });
      } else {
        send({ done: true, finalFilename: isCollection ? metadata.title : \`\${tracks[0]?.artist} - \${tracks[0]?.title}.mp3\` });
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

  `;

content = content.substring(0, startIndex) + newBlock + content.substring(endIndex);
fs.writeFileSync(targetFile, content);
console.log("Successfully patched configure-routes.js");
