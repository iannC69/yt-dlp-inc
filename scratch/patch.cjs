const fs = require('fs');

let c = fs.readFileSync('vite.config.js', 'utf8');

const queueCode = `
const MAX_CONCURRENT_JOBS = 2;
let runningJobsCount = 0;

function processQueue() {
  const queuedJobs = Array.from(activeJobs.values()).filter(j => j.queueStatus === 'queued' && !j.isPaused && !j.isCancelled);
  
  while (runningJobsCount < MAX_CONCURRENT_JOBS && queuedJobs.length > 0) {
    const jobToRun = queuedJobs.shift();
    jobToRun.queueStatus = 'running';
    runningJobsCount++;
    
    // Find jobId
    const jobId = Array.from(activeJobs.entries()).find(([k,v]) => v === jobToRun)[0];
    broadcast(jobId, { queueStatus: 'running', status: 'Descărcarea a început...' });
    spawnYtDlp(jobId);
  }
}

function enqueueJob(jobId) {
  const job = activeJobs.get(jobId);
  if (job) {
    job.queueStatus = 'queued';
    
    const cfg = getConfig();
    if (cfg.hardwareAcceleration && cfg.hardwareAcceleration !== 'NONE') {
       job.args.push('--postprocessor-args', 'ffmpeg:-hwaccel auto');
    }
    
    broadcast(jobId, { status: 'În așteptare...', queueStatus: 'queued', progress: 0 });
    processQueue();
  }
}
`;

if (!c.includes('function enqueueJob')) {
    c = c.replace('const activeJobs = new Map()', 'const activeJobs = new Map()\\n' + queueCode);
}

// Replace spawnYtDlp(jobId) calls
c = c.replaceAll('spawnYtDlp(jobId)', 'enqueueJob(jobId)');

// Restore the one inside processQueue
c = c.replaceAll("broadcast(jobId, { queueStatus: 'running', status: 'Descărcarea a început...' });\\n    enqueueJob(jobId);", "broadcast(jobId, { queueStatus: 'running', status: 'Descărcarea a început...' });\\n    spawnYtDlp(jobId);");

// Function def
c = c.replaceAll('function enqueueJob {', 'function spawnYtDlp(jobId) {');

c = c.replace("job.process.on('close', async code => {", `job.process.on('close', async code => {
    runningJobsCount = Math.max(0, runningJobsCount - 1);
    processQueue();`);

c = c.replace("job.process.on('error', error => {", `job.process.on('error', error => {
    runningJobsCount = Math.max(0, runningJobsCount - 1);
    processQueue();`);

c = c.replaceAll('activeJobs.delete(jobId)', `activeJobs.delete(jobId)
          runningJobsCount = Math.max(0, runningJobsCount - 1);
          processQueue();`);

c = c.replace('job.process.kill()\\n            broadcast(jobId, { isPaused: true', `job.process.kill()
            runningJobsCount = Math.max(0, runningJobsCount - 1);
            processQueue();
            broadcast(jobId, { isPaused: true`);

const updateEndpoint = `
      server.middlewares.use('/api/ytdl/update', (req, res, next) => {
        const urlObj = new URL(req.url, 'http://' + req.headers.host);
        if (urlObj.pathname !== '/') return next();

        if (!fs.existsSync(binPath)) {
          res.statusCode = 500;
          return res.end(JSON.stringify({ error: 'yt-dlp binary not found.' }));
        }

        const child = spawn(binPath, ['-U']);
        let out = '';
        child.stdout.on('data', c => out += c.toString());
        child.stderr.on('data', c => out += c.toString());

        child.on('close', code => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: code === 0, log: out }));
        });
      });
`;

if (!c.includes('/api/ytdl/update')) {
    c = c.replace("server.middlewares.use('/api/ytdl/job-status'", updateEndpoint + "\\n      server.middlewares.use('/api/ytdl/job-status'");
}

fs.writeFileSync('vite.config.js', c, 'utf8');
console.log('Success');
