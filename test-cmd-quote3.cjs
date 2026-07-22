const { spawnSync } = require('child_process');
const spotdlPath = 'C:\\Users\\iannc\\Documents\\youtube-downloader-standalone\\bin\\spotdl.exe';
console.log(spawnSync('cmd.exe', ['/c', 'chcp', '65001', '>', 'nul', '&', 'call', spotdlPath, '--version']).stdout?.toString());
