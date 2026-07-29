const fs = require('fs');
const fp = 'c:/Users/iannc/Documents/youtube-downloader-standalone/src/server/configure-routes.js';
let c = fs.readFileSync(fp, 'utf8');

// For smart-download
const oldSmartDestruct = 'const { items, format, scope, title, scheduleTime, formatStr, prependNumbers, collectionType } = d;';
const newSmartDestruct = 'const { items, format, scope, title, scheduleTime, formatStr, prependNumbers, collectionType, prefixAlbumFolders } = d;';

// For ytmusic-playlist-download
// In ytmusic it reads query params, probably: const collectionType = u.searchParams.get('collectionType');
// We need to add: const prefixAlbumFolders = u.searchParams.get('prefixAlbumFolders') === 'true';

// Actually, in both cases they build `cdName`:
const oldCdName = "const cdName = collectionType === 'album' ? `Album - ${rawCdName}` : rawCdName;";
// We need to update ALL instances of this line (there should be two)
const newCdName = "const cdName = (collectionType === 'album' && prefixAlbumFolders !== false && prefixAlbumFolders !== 'false') ? `Album - ${rawCdName}` : rawCdName;";

if (c.includes(oldSmartDestruct)) {
  c = c.replace(oldSmartDestruct, newSmartDestruct);
}

if (c.includes("const collectionType = u.searchParams.get('collectionType');")) {
  c = c.replace(
    "const collectionType = u.searchParams.get('collectionType');",
    "const collectionType = u.searchParams.get('collectionType'); const prefixAlbumFolders = u.searchParams.get('prefixAlbumFolders');"
  );
}

let count = 0;
while (c.includes(oldCdName)) {
  c = c.replace(oldCdName, newCdName);
  count++;
}

fs.writeFileSync(fp, c, 'utf8');
console.log(`Replaced cdName ${count} times.`);
