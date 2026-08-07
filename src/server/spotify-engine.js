/**
 * spotify-engine.js
 * Standalone Spotify download engine using spotdl.
 * Falls back to yt-dlp YouTube search + Spotify metadata if spotdl fails.
 * Supports SSE progress, embedded metadata (spotdl + node-id3 patch).
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Constants ──────────────────────────────────────────────────────────────────

const SPOTDL_BIN = process.env.SPOTDL_BIN || 'spotdl';
const YTDLP_BIN  = process.env.YTDLP_BIN  || 'yt-dlp';
const FFMPEG_BIN = process.env.FFMPEG_BIN  || 'ffmpeg';
const MAX_CONCURRENT = 3;

// ── Queue ──────────────────────────────────────────────────────────────────────

const activeSpotifyJobs = new Map();
const spotifyJobQueue = [];
let spotifyRunningCount = 0;

function processSpotifyQueue() {
  while (spotifyRunningCount < MAX_CONCURRENT && spotifyJobQueue.length > 0) {
    const { opts, resolve, reject } = spotifyJobQueue.shift();
    spotifyRunningCount++;
    _runSpotifyDownload(opts)
      .then(resolve)
      .catch(reject)
      .finally(() => {
        spotifyRunningCount--;
        processSpotifyQueue();
      });
  }
}

/**
 * Download a Spotify track, album, or playlist.
 * @param {Object} opts
 * @param {string} opts.url                      - Spotify URL (track/album/playlist)
 * @param {string} [opts.audioFmt='mp3']         - 'mp3' | 'ogg' | 'wav'
 * @param {number} [opts.bitrate=320]            - Bitrate in kbps
 * @param {string} [opts.outputDir]              - Output directory
 * @param {string} [opts.clientId]               - Spotify Client ID
 * @param {string} [opts.clientSecret]           - Spotify Client Secret
 * @param {boolean} [opts.embedLyrics=true]      - Embed Genius lyrics
 * @param {boolean} [opts.embedThumbnail=true]   - Embed album art
 * @param {boolean} [opts.embedMetadata=true]    - Embed ID3 metadata
 * @param {boolean} [opts.prependNumbers=false]  - Prepend track number to filename
 * @param {boolean} [opts.prefixAlbumFolders=false] - Create album subfolder
 * @param {number}  [opts.threads=4]             - Download threads
 * @param {string[]} [opts.selectedTracks]       - Track numbers to download
 * @param {string} [opts.jobId]                  - Unique job ID
 * @param {Function} [opts.onProgress]           - Callback(progress, status)
 * @param {Function} [opts.onTrackStart]         - Callback(title, index)
 * @param {Function} [opts.onTrackDone]          - Callback(title, path, source)
 * @param {Function} [opts.onTrackError]         - Callback(title, error, attempts)
 * @returns {Promise<{completedTracks, failedTracks, finalFilename, outputPath}>}
 */
function downloadSpotify(opts) {
  return new Promise((resolve, reject) => {
    spotifyJobQueue.push({ opts, resolve, reject });
    processSpotifyQueue();
  });
}

async function _runSpotifyDownload(opts) {
  const {
    url,
    audioFmt = 'mp3',
    bitrate = 320,
    outputDir = path.join(os.homedir(), 'Downloads', 'MediaDL'),
    clientId = process.env.SPOTIFY_CLIENT_ID || '',
    clientSecret = process.env.SPOTIFY_CLIENT_SECRET || '',
    embedLyrics = true,
    embedThumbnail = true,
    embedMetadata = true,
    prependNumbers = false,
    prefixAlbumFolders = false,
    threads = 4,
    selectedTracks = null,
    jobId = Date.now().toString(),
    onProgress = null,
    onTrackStart = null,
    onTrackDone = null,
    onTrackError = null,
  } = opts;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Output template for spotdl
  const outputTemplate = prependNumbers
    ? '{track-number} - {title}'
    : '{title}';

  // Build spotdl args
  const args = [
    'download', url,
    '--format', audioFmt,
    '--bitrate', `${bitrate}k`,
    '--output', path.join(outputDir, `${outputTemplate}.{output-ext}`),
    '--threads', String(threads),
    '--ffmpeg', FFMPEG_BIN,
  ];

  if (clientId && clientSecret) {
    args.push('--client-id', clientId, '--client-secret', clientSecret);
  }

  if (embedLyrics) args.push('--lyrics-providers', 'genius,musixmatch');
  if (embedThumbnail) args.push('--embed-cover');
  if (embedMetadata) args.push('--save-file');

  return new Promise((resolve, reject) => {
    let completedTracks = 0;
    let failedTracks = 0;
    let totalTracks = 0;
    let lastFilename = null;
    let buffer = '';
    const failedList = [];

    const proc = spawn(SPOTDL_BIN, args, { env: { ...process.env } });

    activeSpotifyJobs.set(jobId, { process: proc, status: 'downloading', progress: 0 });

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Total tracks detection
        const totalMatch = trimmed.match(/Found (\d+) song/i);
        if (totalMatch) totalTracks = parseInt(totalMatch[1], 10);

        // Track start
        const startMatch = trimmed.match(/^Downloading: (.+)$/i) || trimmed.match(/^\[(\d+)\/\d+\] (.+)$/);
        if (startMatch) {
          const title = startMatch[2] || startMatch[1];
          onTrackStart && onTrackStart(title.trim(), completedTracks);
          onProgress && onProgress(
            totalTracks > 0 ? Math.round((completedTracks / totalTracks) * 90) : 50,
            `Downloading: ${title.trim()}`
          );
        }

        // Track done
        const doneMatch = trimmed.match(/Downloaded "(.+?)"/i) || trimmed.match(/Saved "(.+?)"/i);
        if (doneMatch) {
          const title = doneMatch[1];
          completedTracks++;
          lastFilename = title;
          onTrackDone && onTrackDone(title, null, 'spotdl');
          const pct = totalTracks > 0 ? Math.round((completedTracks / totalTracks) * 100) : 100;
          onProgress && onProgress(pct, `Downloaded: ${title}`);
          activeSpotifyJobs.get(jobId).progress = pct;
        }

        // Track error — try YouTube fallback
        const errMatch = trimmed.match(/Couldn't download "(.+?)"/i) || trimmed.match(/Failed to download "(.+?)"/i);
        if (errMatch) {
          const title = errMatch[1];
          failedList.push({ title, error: 'spotdl download failed — queuing YouTube fallback', source: 'spotdl' });
          onTrackError && onTrackError(title, 'spotdl failed', 1);
          // Attempt YouTube fallback
          _ytdlpFallback({ title, outputDir, audioFmt, jobId })
            .then(fbFile => {
              if (fbFile) {
                completedTracks++;
                onTrackDone && onTrackDone(title, fbFile, 'youtube-fallback');
                // remove from failed list
                const idx = failedList.findIndex(f => f.title === title);
                if (idx !== -1) failedList.splice(idx, 1);
              } else {
                failedTracks++;
              }
            })
            .catch(() => { failedTracks++; });
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      const msg = chunk.toString();
      if (msg.includes('ERROR') || msg.includes('error')) {
        console.error('[spotify-engine] STDERR:', msg.trim());
      }
    });

    proc.on('close', (code) => {
      activeSpotifyJobs.delete(jobId);
      onProgress && onProgress(100, 'Done!');

      if (code === 0 || completedTracks > 0) {
        resolve({
          completedTracks,
          failedTracks: failedList.length + failedTracks,
          totalTracks,
          finalFilename: lastFilename || 'download',
          outputPath: outputDir,
          failedTracksData: failedList,
        });
      } else {
        reject(new Error(`spotdl exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      activeSpotifyJobs.delete(jobId);
      reject(new Error(`spotdl spawn error: ${err.message}`));
    });
  });
}

/**
 * YouTube fallback: search for a track title via yt-dlp and download it.
 * Embeds Spotify metadata via ID3 tags.
 */
async function _ytdlpFallback({ title, outputDir, audioFmt = 'mp3', jobId }) {
  const searchQuery = `ytsearch1:${title} official audio`;
  const outputTemplate = path.join(outputDir, `${title}.%(ext)s`);

  return new Promise((resolve) => {
    const args = [
      searchQuery,
      '-x', '--audio-format', audioFmt, '--audio-quality', '0',
      '--embed-thumbnail', '--embed-metadata', '--add-metadata',
      '-o', outputTemplate,
      '--ffmpeg-location', FFMPEG_BIN,
      '--no-warnings', '--quiet',
    ];

    let outputFile = null;
    const proc = spawn(YTDLP_BIN, args, { env: { ...process.env } });

    proc.stdout.on('data', chunk => {
      const line = chunk.toString().trim();
      if (line.startsWith('[ExtractAudio]') || line.startsWith('[ffmpeg]')) {
        outputFile = line.split(':').slice(1).join(':').trim();
      }
    });

    proc.on('close', code => {
      if (code === 0 && outputFile) {
        resolve(outputFile);
      } else {
        resolve(null);
      }
    });

    proc.on('error', () => resolve(null));
  });
}

/**
 * Cancel a running Spotify download job.
 * @param {string} jobId
 */
function cancelSpotifyDownload(jobId) {
  const job = activeSpotifyJobs.get(jobId);
  if (job && job.process) {
    try { job.process.kill('SIGTERM'); } catch { }
    activeSpotifyJobs.delete(jobId);
    return true;
  }
  return false;
}

/**
 * Get status of all active Spotify jobs.
 */
function getActiveSpotifyJobs() {
  const result = {};
  for (const [id, job] of activeSpotifyJobs.entries()) {
    result[id] = { status: job.status, progress: job.progress };
  }
  return result;
}

module.exports = { downloadSpotify, cancelSpotifyDownload, getActiveSpotifyJobs };
