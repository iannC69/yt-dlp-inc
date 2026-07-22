const fs = require('fs');
let code = fs.readFileSync('vite.config.js', 'utf8');
let start = code.indexOf('// ── Spotify Download (SSE, Multi-Track) ──');
let realEnd = code.indexOf('export default defineConfig', start);
let block = code.substring(start, realEnd).trim();

// The block ends with `} } }`. We just remove the last 3 `}`.
let lastIndex = block.lastIndexOf('}');
block = block.substring(0, lastIndex).trim();
lastIndex = block.lastIndexOf('}');
block = block.substring(0, lastIndex).trim();
lastIndex = block.lastIndexOf('}');
block = block.substring(0, lastIndex).trim();

fs.writeFileSync('spotify_download_block.txt', block.replace(/server\.middlewares\.use/g, 'middlewares.use'));
console.log('Fixed block');
