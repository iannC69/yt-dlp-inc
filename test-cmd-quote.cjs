const { spawnSync } = require('child_process');
console.log(spawnSync('cmd.exe', ['/c', 'chcp', '65001', '>', 'nul', '&', 'call', '"bin\\spotdl.exe"', '--version']).stdout?.toString());
