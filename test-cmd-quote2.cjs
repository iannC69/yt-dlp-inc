const { spawnSync } = require('child_process');
const spotdlPath = 'bin\\spotdl.exe';
console.log(spawnSync('cmd.exe', ['/c', 'chcp', '65001', '>', 'nul', '&', 'call', spotdlPath, '--version']).stdout?.toString());
