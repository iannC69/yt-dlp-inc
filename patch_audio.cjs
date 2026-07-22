const fs = require('fs');
let s = fs.readFileSync('src/server/index.js', 'utf8');
s = s.replace(/cfg\.audioFormat/g, "(typeof urlObj !== 'undefined' && urlObj.searchParams && urlObj.searchParams.get('audioFormat') ? urlObj.searchParams.get('audioFormat') : cfg.audioFormat)");
s = s.replace(/cfg\.audioQuality/g, "(typeof urlObj !== 'undefined' && urlObj.searchParams && urlObj.searchParams.get('audioQuality') ? urlObj.searchParams.get('audioQuality') : cfg.audioQuality)");
fs.writeFileSync('src/server/index.js', s);
