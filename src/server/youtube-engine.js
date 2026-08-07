/**
 * youtube-engine.js
 * Standalone YouTube download engine with yt-dlp.
 * Handles video, audio, playlists, channels, and YouTube Music.
 * Supports SSE progress streaming and a max-3 concurrent download queue.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const EventEmitter = require('events');

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_CONCURRENT = 3;
const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

// ── Download Queue ─────────────────────────────────────────────────────────────

const activeJobs = new Map();  // jobId → { process, status, progress }
const jobQueue = [];            // pending { opts, resolve, reject }
let runningCount = 0;

function processQueue() {
  while (runningCount < MAX_CONCURRENT && jobQueue.length > 0) {
    const { opts, resolve, reject } = jobQueue.shift();
    runningCount++;
    _runDownload(opts)
      .then(resolve)
      .catch(reject)
      .finally(() => {
        runningCount--;
        processQueue();
      });
  }
}

/**
 * Download a YouTube video/audio/playlist.
 * @param {Object} opts
 * @param {string} opts.url                  - YouTube URL (video, playlist, channel, music)
 * @param {string} [opts.format='video']     - 'video' | 'audio'
 * @param {string} [opts.formatStr]          - Full format string e.g. 'audio:mp3:0'
 * @param {string} [opts.quality='best']     - 'best' | '4k' | '1080p' | '720p' | '480p' | '360p'
 * @param {string} [opts.audioFmt='mp3']     - 'mp3' | 'm4a' | 'opus' | 'wav'
 * @param {string} [opts.audioQuality='0']   - '0' (best) to '9' (worst)
 * @param {string} [opts.outputDir]          - Output directory (default: ~/Downloads/MediaDL)
 * @param {string} [opts.preset='AUTO']      - Hardware acceleration preset
 * @param {string} [opts.hwaccel='NONE']     - 'NONE' | 'NVIDIA' | 'AMD' | 'INTEL'
 * @param {boolean} [opts.embedMetadata=true]
 * @param {boolean} [opts.embedThumbnail=true]
 * @param {boolean} [opts.embedChapters=true]
 * @param {boolean} [opts.sponsorBlock=false]
 * @param {boolean} [opts.prependNumbers=false]
 * @param {string[]} [opts.selectedItems]    - Array of item indices to download (for playlists)
 * @param {string} [opts.jobId]              - Unique job ID
 * @param {Function} [opts.onProgress]       - Callback(progress: number, status: string)
 * @param {Function} [opts.onTrackStart]     - Callback(trackTitle: string, index: number)
 * @param {Function} [opts.onTrackDone]      - Callback(trackTitle: string, filename: string)
 * @returns {Promise<{finalFilename: string, outputPath: string}>}
 */
function downloadYoutube(opts) {
  return new Promise((resolve, reject) => {
    jobQueue.push({ opts, resolve, reject });
    processQueue();
  });
}

async function _runDownload(opts) {
  const {
    url,
    format = 'video',
    formatStr,
    quality = 'best',
    audioFmt = 'mp3',
    audioQuality = '0',
    outputDir = path.join(os.homedir(), 'Downloads', 'MediaDL'),
    preset = 'AUTO',
    hwaccel = 'NONE',
    embedMetadata = true,
    embedThumbnail = true,
    embedChapters = true,
    sponsorBlock = false,
    prependNumbers = false,
    selectedItems = null,
    jobId = Date.now().toString(),
    onProgress = null,
    onTrackStart = null,
    onTrackDone = null,
  } = opts;

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const isAudio = format === 'audio' || (formatStr && formatStr.startsWith('audio:'));
  let parsedAudioFmt = audioFmt;
  let parsedAudioQuality = audioQuality;

  if (formatStr && formatStr.startsWith('audio:')) {
    const parts = formatStr.split(':');
    parsedAudioFmt = parts[1] || 'mp3';
    parsedAudioQuality = parts[2] || '0';
  }

  // Build output template
  const outputTemplate = prependNumbers
    ? path.join(outputDir, '%(playlist_index)s - %(title)s.%(ext)s')
    : path.join(outputDir, '%(title)s.%(ext)s');

  // Build yt-dlp args
  const args = ['--no-playlist-random-order', '--no-warnings'];

  // Format selection
  if (isAudio) {
    args.push('-x', '--audio-format', parsedAudioFmt, '--audio-quality', parsedAudioQuality);
  } else {
    // Video format
    let fmtSelector;
    switch (quality) {
      case '4k':   fmtSelector = 'bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/best[height<=2160]'; break;
      case '1080p': fmtSelector = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]'; break;
      case '720p':  fmtSelector = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]'; break;
      case '480p':  fmtSelector = 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]'; break;
      case '360p':  fmtSelector = 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]'; break;
      default:     fmtSelector = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best'; break;
    }
    args.push('-f', fmtSelector, '--merge-output-format', 'mp4');

    // Hardware acceleration
    if (hwaccel === 'NVIDIA') {
      args.push('--postprocessor-args', 'ffmpeg:-c:v h264_nvenc');
    } else if (hwaccel === 'AMD') {
      args.push('--postprocessor-args', 'ffmpeg:-c:v h264_amf');
    } else if (hwaccel === 'INTEL') {
      args.push('--postprocessor-args', 'ffmpeg:-c:v h264_qsv');
    }
  }

  // Metadata & embedding
  if (embedMetadata) args.push('--embed-metadata', '--add-metadata');
  if (embedThumbnail) args.push('--embed-thumbnail');
  if (embedChapters) args.push('--embed-chapters');
  if (sponsorBlock) args.push('--sponsorblock-remove', 'sponsor');

  // Playlist items selection
  if (selectedItems && selectedItems.length > 0) {
    args.push('--playlist-items', selectedItems.join(','));
  }

  // Progress tracking
  args.push('--newline', '--progress-template', '%(progress._percent_str)s|%(progress._eta_str)s|%(info.title)s');

  // Output
  args.push('-o', outputTemplate);
  args.push('--ffmpeg-location', FFMPEG_BIN);

  // URL
  args.push(url);

  return new Promise((resolve, reject) => {
    let lastFilename = null;
    let progress = 0;
    let buffer = '';

    const proc = spawn(YTDLP_BIN, args, { env: { ...process.env } });

    activeJobs.set(jobId, { process: proc, status: 'downloading', progress: 0 });

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Parse progress line: "75.3%|00:10|Title"
        const parts = trimmed.split('|');
        if (parts.length >= 1 && parts[0].includes('%')) {
          const pct = parseFloat(parts[0].replace('%', '').trim());
          if (!isNaN(pct)) {
            progress = pct;
            activeJobs.get(jobId).progress = pct;
            const title = parts[2] || '';
            onProgress && onProgress(pct, title ? `Downloading: ${title}` : `Downloading... ${pct.toFixed(0)}%`);
          }
        }

        // Detect output filename
        if (trimmed.startsWith('[download] Destination:')) {
          lastFilename = trimmed.replace('[download] Destination:', '').trim();
          onTrackStart && onTrackStart(path.basename(lastFilename), 0);
        }

        if (trimmed.startsWith('[ExtractAudio] Destination:') || trimmed.startsWith('[ffmpeg] Destination:')) {
          lastFilename = trimmed.split(':').slice(1).join(':').trim();
          onTrackDone && onTrackDone(path.basename(lastFilename), lastFilename);
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      const msg = chunk.toString();
      if (msg.includes('ERROR')) {
        console.error('[youtube-engine] ERROR:', msg.trim());
      }
    });

    proc.on('close', (code) => {
      activeJobs.delete(jobId);
      if (code === 0) {
        onProgress && onProgress(100, 'Download complete!');
        resolve({ finalFilename: lastFilename ? path.basename(lastFilename) : null, outputPath: lastFilename || outputDir });
      } else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      activeJobs.delete(jobId);
      reject(new Error(`yt-dlp spawn error: ${err.message}`));
    });
  });
}

/**
 * Cancel a running download job.
 * @param {string} jobId
 */
function cancelDownload(jobId) {
  const job = activeJobs.get(jobId);
  if (job && job.process) {
    try { job.process.kill('SIGTERM'); } catch { }
    activeJobs.delete(jobId);
    return true;
  }
  return false;
}

/**
 * Get status of all active jobs.
 */
function getActiveJobs() {
  const result = {};
  for (const [id, job] of activeJobs.entries()) {
    result[id] = { status: job.status, progress: job.progress };
  }
  return result;
}

module.exports = { downloadYoutube, cancelDownload, getActiveJobs };
