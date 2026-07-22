const { spawnSync } = require('child_process');
console.log(spawnSync('cmd.exe', ['/c', 'echo', '--yt-dlp-args', ' --js-runtimes="node:C:\\Program Files\\nodejs\\node.exe"']).stdout.toString())
