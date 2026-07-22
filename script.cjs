const fs = require('fs');
let block = fs.readFileSync('spotify_download_block.txt', 'utf8');
block = block.replace(/server\.middlewares\.use/g, 'middlewares.use');
let target = fs.readFileSync('src/server/configure-routes.js', 'utf8');
let marker = "middlewares.use('/api/spotify-cancel'";
let idx = target.indexOf(marker);
if (idx !== -1) {
  let newCode = target.substring(0, idx) + '\n' + block + '\n' + target.substring(idx);
  fs.writeFileSync('src/server/configure-routes.js', newCode);
  console.log('Successfully injected block.');
} else {
  console.log('Marker not found in configure-routes.js');
}
