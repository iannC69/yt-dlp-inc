const fs = require('fs');

let c = fs.readFileSync('src/server/spotify-api.js', 'utf8');

const imports = `import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
`;

c = c.replace("import https from 'https'", "import https from 'https'\n" + imports);

const cacheLogic = `
const CACHE_FILE = path.join(__dirname, 'spotify_cache.json');
let memCache = null;

function loadCache() {
  if (memCache) return memCache;
  if (fs.existsSync(CACHE_FILE)) {
    try { memCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch(e) {}
  }
  if (!memCache) memCache = {};
  return memCache;
}

function saveCache() {
  if (memCache) fs.writeFileSync(CACHE_FILE, JSON.stringify(memCache), 'utf8');
}

export async function resolveSpotifyMetadata(spotifyUrlString, clientId, clientSecret, accessToken = null) {
  const match = (spotifyUrlString || '').split('?')[0].match(/open\\.spotify\\.com\\/(track|album|playlist)\\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error(\`Invalid Spotify URL. Supported: track, album, playlist.\`);
  
  const cacheKey = \`\${match[1]}_\${match[2]}\`;
  const cache = loadCache();
  if (cache[cacheKey] && Date.now() - cache[cacheKey].timestamp < 48 * 60 * 60 * 1000) {
      console.log(\`[spotify-api] Smart Caching HIT for \${cacheKey}\`);
      return cache[cacheKey].data;
  }

  const data = await _resolveSpotifyMetadata(spotifyUrlString, clientId, clientSecret, accessToken);
  cache[cacheKey] = { timestamp: Date.now(), data };
  saveCache();
  return data;
}

async function _resolveSpotifyMetadata(spotifyUrlString, clientId, clientSecret, accessToken = null) {
`;

c = c.replace("export async function resolveSpotifyMetadata(spotifyUrlString, clientId, clientSecret, accessToken = null) {", cacheLogic);

fs.writeFileSync('src/server/spotify-api.js', c, 'utf8');
console.log('spotify-api.js patched for Smart Caching');
