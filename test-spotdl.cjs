const { spawnSync } = require('child_process');
const args = [
  'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', 
  '--yt-dlp-args', ` --js-runtimes="node:${process.execPath}"`, 
  '--ffmpeg', 'bin/ffmpeg.exe'
];
console.log('Spawning with args:', args);
const res = spawnSync('bin/spotdl.exe', args);
if (res.stdout) console.log('STDOUT:', res.stdout.toString());
if (res.stderr) console.log('STDERR:', res.stderr.toString());
