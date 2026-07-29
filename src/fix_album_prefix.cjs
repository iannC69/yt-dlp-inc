const fs = require('fs');
const fp = 'c:/Users/iannc/Documents/youtube-downloader-standalone/src/server/configure-routes.js';
let c = fs.readFileSync(fp, 'utf8');

// Fix smart-download route
const oldSmart = "const cdName = (collectionType === 'album' && prefixAlbumFolders !== false && prefixAlbumFolders !== 'false') ? `Album - ${rawCdName}` : rawCdName;";
const newSmart = "const cleanCdName = rawCdName.replace(/^(Album\\s*-\\s*)+/i, ''); const cdName = (collectionType === 'album' && prefixAlbumFolders !== false && prefixAlbumFolders !== 'false') ? `Album - ${cleanCdName}` : cleanCdName;";

if (c.includes(oldSmart)) {
  c = c.replace(oldSmart, newSmart);
  console.log("Replaced in smart-download");
} else {
  console.log("NOT FOUND in smart-download");
}

// Fix ytmusic-playlist-download route
const oldYtMusic = "const safeTitle = (collectionType === 'album' && prefixAlbumFolders !== false && prefixAlbumFolders !== 'false') ? `Album - ${rawTitle}` : rawTitle;";
const newYtMusic = "const cleanTitle = rawTitle.replace(/^(Album\\s*-\\s*)+/i, ''); const safeTitle = (collectionType === 'album' && prefixAlbumFolders !== false && prefixAlbumFolders !== 'false') ? `Album - ${cleanTitle}` : cleanTitle;";

if (c.includes(oldYtMusic)) {
  c = c.replace(oldYtMusic, newYtMusic);
  console.log("Replaced in ytmusic-playlist-download");
} else {
  console.log("NOT FOUND in ytmusic");
}

fs.writeFileSync(fp, c, 'utf8');
