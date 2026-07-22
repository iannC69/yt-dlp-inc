const { spawnSync } = require('child_process');
console.log(spawnSync('cmd.exe', ['/c', 'bin\\spotdl.exe', '--yt-dlp-args', ' --js-runtimes="node:C:\\Program Files\\nodejs\\node.exe"', '--help']).stdout?.toString())
