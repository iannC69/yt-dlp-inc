const { spawnSync } = require('child_process');
const spotdlPath = 'bin\\spotdl.exe';
const spotdlArgs = [
  '--yt-dlp-args', ` --js-runtimes="node:${process.execPath}"`,
  '--help'
];
console.log('Spawning');
const res = spawnSync('cmd.exe', ['/c', 'chcp', '65001', '>', 'nul', '&', 'call', spotdlPath, ...spotdlArgs]);
console.log('STDOUT:', res.stdout?.toString()?.slice(0, 100));
console.log('STDERR:', res.stderr?.toString());
