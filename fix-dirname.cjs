const fs = require('fs');
let code = fs.readFileSync('src/server/configure-routes.js', 'utf8');

// The file has these exact strings:
code = code.replace(/path\.resolve\(__dirname, 'bin', 'spotdl\.exe'\)/g, 'spotdlBin');
code = code.replace(/path\.resolve\(__dirname, 'bin', 'ffmpeg\.exe'\)/g, 'ffmpegBin');
code = code.replace(/path\.resolve\(__dirname, 'bin', 'yt-dlp\.exe'\)/g, 'binPath');
code = code.replace(/path\.resolve\(__dirname, 'bin'\)/g, 'binDir');

fs.writeFileSync('src/server/configure-routes.js', code);
console.log('Fixed dirname references in configure-routes.js');
