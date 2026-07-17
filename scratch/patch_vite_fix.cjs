const fs = require('fs');

let content = fs.readFileSync('vite.config.js', 'utf8');

// 1. Add queue logic variables and functions at the top scope
const queueCode = `
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
`;

if (!content.includes('function enqueueJob')) {
    content = content.replace('const activeJobs = new Map();', 'const activeJobs = new Map();\\n' + queueCode);
}

content = content.replaceAll('spawnYtDlp(jobId);', 'enqueueJob(jobId);');

// Wait, the hook for 'close'
const closeHookCode = `job.process.on('close', async code => {
    runningJobsCount = Math.max(0, runningJobsCount - 1);
    processQueue();
`;
content = content.replace("job.process.on('close', async code => {", closeHookCode);

const errorHookCode = `job.process.on('error', error => {
    runningJobsCount = Math.max(0, runningJobsCount - 1);
    processQueue();
`;
content = content.replace("job.process.on('error', error => {", errorHookCode);

// Write back
fs.writeFileSync('vite.config.js', content, 'utf8');
console.log('Successfully applied queue manager patch!');
