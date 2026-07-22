const fs = require('fs');
let c = fs.readFileSync('vite.config.js', 'utf8');
c = c.replace(/ensureDownloadsDir\(\)/g, "ensureDownloadsDir(typeof urlObj !== 'undefined' ? (urlObj.searchParams ? urlObj.searchParams.get('customPath') : null) : null)");
fs.writeFileSync('vite.config.js', c);
let s = fs.readFileSync('src/server/index.js', 'utf8');
s = s.replace(/ensureDownloadsDir\(\)/g, "ensureDownloadsDir(typeof urlObj !== 'undefined' ? (urlObj.searchParams ? urlObj.searchParams.get('customPath') : null) : null)");
fs.writeFileSync('src/server/index.js', s);
