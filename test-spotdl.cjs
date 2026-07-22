const { spawnSync } = require('child_process');
const args = [
  '/c', 'chcp 65001 >nul & bin\\spotdl.exe',
  'https://open.spotify.com/playlist/7x5q5yD6i85n04gDXZqJjK', 
  '--yt-dlp-args', ` --js-runtimes="node:${process.execPath}"`, 
  '--ffmpeg', 'bin/ffmpeg.exe'
];
console.log('Spawning with args:', args);
const res = spawnSync('cmd.exe', args, { env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsVerbatimArguments: true });
if (res.stdout) console.log('STDOUT:', res.stdout.toString());
if (res.stderr) console.log('STDERR:', res.stderr.toString());
