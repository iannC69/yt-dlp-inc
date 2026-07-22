import fs from 'fs';
import os from 'os';
import path from 'path';

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function atomicWrite(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

export function getBatchPerformanceProfile(requestedConcurrency, mode = 'MAXIMUM') {
  const cores = Math.max(1, os.cpus().length);
  const freeMemoryGb = os.freemem() / (1024 ** 3);
  const memoryLimit = freeMemoryGb < 2 ? 2 : freeMemoryGb < 4 ? 3 : Math.max(4, Math.floor(freeMemoryGb * 1.5));
  const cpuLimit = mode === 'MAXIMUM' ? Math.max(2, cores * 2) : Math.max(1, Math.floor(cores * 0.75));
  const requested = Number.parseInt(requestedConcurrency, 10) || 1;
  const concurrency = clamp(requested, 1, Math.min(24, memoryLimit, cpuLimit));
  const fragments = clamp(Math.ceil(cores / Math.max(1, concurrency)), 1, 8);
  const ffmpegThreads = clamp(Math.floor(cores / Math.max(1, concurrency)), 1, 4);
  return { cores, freeMemoryGb, concurrency, fragments, ffmpegThreads, mode };
}

export function isTransientDownloadError(message = '') {
  return /\b(429|408|425|500|502|503|504)\b|too many requests|rate limit|timed? out|temporar|network|socket|connection reset/i.test(message);
}

export function createBatchEngine({ jobsDirectory, jobId, items, profile, onEvent, maxAttempts = 3 }) {
  fs.mkdirSync(jobsDirectory, { recursive: true });
  const statePath = path.join(jobsDirectory, `${jobId}.json`);
  const existing = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;
  const state = existing || {
    id: jobId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'queued',
    profile,
    items: items.map((item, index) => ({ index, item, status: 'pending', attempts: 0, error: null, output: null })),
    completedCount: 0,
    failedCount: 0,
    cancelled: false,
    paused: false
  };
  let activeProcesses = new Set();

  const persist = () => {
    state.updatedAt = new Date().toISOString();
    atomicWrite(statePath, state);
  };
  const emit = (data) => {
    persist();
    onEvent?.({ jobId, completedCount: state.completedCount, failedCount: state.failedCount, total: state.items.length, ...data });
  };
  const controls = {
    cancel() {
      state.cancelled = true;
      state.status = 'cancelling';
      for (const process of activeProcesses) {
        try { process.kill(); } catch { }
      }
      emit({ status: 'Cancelling download…', cancelled: true });
    },
    pause() {
      state.paused = true;
      state.status = 'paused';
      emit({ status: 'Paused', paused: true });
    },
    resume() {
      state.paused = false;
      state.status = 'running';
      emit({ status: 'Resuming…', paused: false });
    },
    state: () => state,
    statePath
  };

  const run = async (downloadItem) => {
    state.status = 'running';
    state.cancelled = false;
    const pending = state.items.filter(entry => entry.status === 'pending' || (entry.status === 'failed' && entry.attempts < maxAttempts));
    let cursor = 0;
    const worker = async () => {
      while (!state.cancelled) {
        while (state.paused && !state.cancelled) await wait(300);
        const entry = pending[cursor++];
        if (!entry || state.cancelled) return;
        entry.status = 'running';
        emit({ current: entry.index + 1, itemIndex: entry.index, itemStatus: 'running', status: `Downloading ${entry.index + 1}/${state.items.length}` });
        let result;
        for (let attempt = entry.attempts + 1; attempt <= maxAttempts; attempt++) {
          entry.attempts = attempt;
          result = await downloadItem(entry, { profile, registerProcess: process => activeProcesses.add(process), unregisterProcess: process => activeProcesses.delete(process) });
          if (result?.ok || state.cancelled || !isTransientDownloadError(result?.error)) break;
          await wait((750 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 500));
        }
        if (state.cancelled) return;
        if (result?.ok) {
          entry.status = 'completed';
          entry.output = result.output || null;
          entry.error = null;
          state.completedCount++;
          emit({ current: entry.index + 1, itemIndex: entry.index, itemStatus: 'completed', trackDone: true, output: entry.output });
        } else {
          entry.status = 'failed';
          entry.error = result?.error || 'Download failed';
          state.failedCount++;
          emit({ current: entry.index + 1, itemIndex: entry.index, itemStatus: 'failed', trackError: entry.error });
        }
      }
    };
    await Promise.all(Array.from({ length: profile.concurrency }, worker));
    state.status = state.cancelled ? 'cancelled' : 'completed';
    emit({ done: true, cancelled: state.cancelled, failedItems: state.items.filter(entry => entry.status === 'failed').map(entry => entry.index) });
    return state;
  };

  persist();
  return { run, controls, statePath };
}
