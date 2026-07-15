import os from 'os';

/**
 * Smart Optimizer (AI Performance Tuner)
 * Evaluates system resources and determines the optimal settings for downloading and encoding.
 */

export function getOptimalDownloadConfig(forcedProfile = null) {
  const cpus = os.cpus();
  const numCores = cpus.length;
  const totalMemGB = os.totalmem() / (1024 ** 3);
  const freeMemGB = os.freemem() / (1024 ** 3);

  let profile = 'BALANCED';

  if (forcedProfile && ['ULTRA_PERFORMANCE', 'HIGH_PERFORMANCE', 'BALANCED', 'ECO'].includes(forcedProfile)) {
    profile = forcedProfile;
  } else {
    // Auto-detect Extremely High-End PC
    if (numCores >= 12 && totalMemGB >= 16) {
      profile = 'ULTRA_PERFORMANCE';
    }
    // High-End PC
    else if (numCores >= 8 && totalMemGB >= 8) {
      profile = 'HIGH_PERFORMANCE';
    }
    // Mid-Range PC
    else if (numCores >= 4 && totalMemGB >= 4) {
      profile = 'BALANCED';
    }
    // Low-End PC
    else {
      profile = 'ECO';
    }

    // Safety cap based on free memory (only if auto-detecting)
    if (freeMemGB < 1.5 && profile !== 'ECO') {
      console.warn('[SmartOptimizer] Low free memory detected. Dialing back performance profile to prevent crashes.');
      profile = 'ECO'; // force ECO
    }
  }

  let ffmpegThreads = 2;
  let ytdlpConcurrentFragments = 3;
  let concurrentTracks = 2;

  switch (profile) {
    case 'ULTRA_PERFORMANCE':
      ffmpegThreads = Math.max(4, numCores - 2);
      ytdlpConcurrentFragments = 16;
      concurrentTracks = 12;
      break;
    case 'HIGH_PERFORMANCE':
      ffmpegThreads = Math.max(4, Math.floor(numCores * 0.75));
      ytdlpConcurrentFragments = 8;
      concurrentTracks = 8;
      break;
    case 'BALANCED':
      ffmpegThreads = Math.max(2, Math.floor(numCores / 2));
      ytdlpConcurrentFragments = 4;
      concurrentTracks = 2;
      break;
    case 'ECO':
    default:
      ffmpegThreads = 1;
      ytdlpConcurrentFragments = 1;
      concurrentTracks = 1;
      break;
  }

  console.log(`[SmartOptimizer] System Profile: ${profile} ${forcedProfile ? '(Forced)' : '(Auto)'} | Cores: ${numCores} | RAM: ${Math.round(totalMemGB)}GB (${Math.round(freeMemGB)}GB free)`);
  console.log(`[SmartOptimizer] Tuning -> FFmpeg Threads: ${ffmpegThreads} | yt-dlp Fragments: ${ytdlpConcurrentFragments} | Concurrent Tracks: ${concurrentTracks}`);

  return {
    profile,
    ffmpegThreads,
    ytdlpConcurrentFragments,
    concurrentTracks
  };
}
