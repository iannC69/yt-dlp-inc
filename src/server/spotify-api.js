import https from 'https'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))


// ── Token Cache ──────────────────────────────────────────────────────────────
let tokenCache = null

export async function getSpotifyToken(clientId, clientSecret) {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken
  }
  if (!clientId || !clientSecret) {
    throw new Error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET from request headers")
  }
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const data = 'grant_type=client_credentials'
  return new Promise((resolve, reject) => {
    const req = https.request('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk.toString())
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(body)
            if (json.access_token) {
              tokenCache = {
                accessToken: json.access_token,
                expiresAt: Date.now() + (json.expires_in - 60) * 1000
              }
              resolve(tokenCache.accessToken)
            } else {
              reject(new Error("Failed to get Spotify token: No access_token in response"))
            }
          } catch (e) {
            reject(new Error("Failed to parse Spotify token response"))
          }
        } else {
          reject(new Error(`Spotify auth failed with status ${res.statusCode}: ${body}`))
        }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

// ── Raw API Request ──────────────────────────────────────────────────────────
function spotifyApiRequest(path, token) {
  return new Promise((resolve, reject) => {
    https.request(`https://api.spotify.com${path}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    }, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk.toString())
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)) }
          catch (e) { reject(new Error("Failed to parse Spotify API response")) }
        } else {
          reject({ status: res.statusCode, body, headers: res.headers })
        }
      })
    }).on('error', reject).end()
  })
}

// ── Fetch with Retry ─────────────────────────────────────────────────────────
async function fetchWithRetry(path, clientId, clientSecret, accessToken) {
  let token = accessToken || await getSpotifyToken(clientId, clientSecret)
  try {
    return await spotifyApiRequest(path, token)
  } catch (err) {
    if (err.status === 401) {
      // OAuth expired — try refresh via client credentials
      if (accessToken && clientId && clientSecret) {
        console.warn('[spotify-api] OAuth token expired, falling back to client credentials')
        tokenCache = null
        token = await getSpotifyToken(clientId, clientSecret)
        return await spotifyApiRequest(path.replace('market=from_token', 'market=US'), token)
      }
      tokenCache = null
      token = await getSpotifyToken(clientId, clientSecret)
      return await spotifyApiRequest(path.replace('market=from_token', 'market=US'), token)
    }
    if (err.status === 429) {
      const retryAfter = parseInt(err.headers?.['retry-after'] || '3', 10)
      console.warn(`[spotify-api] Rate limited. Waiting ${retryAfter}s...`)
      await new Promise(r => setTimeout(r, retryAfter * 1000))
      return await spotifyApiRequest(path, token)
    }
    if (err.status === 403) {
      throw new Error(
        `SPOTIFY_403: Această funcție necesită autentificare. (Diagnostic: Token=${!!accessToken}, Spotify Error: ${err.body})`
      )
    }
    if (err.status === 404) throw new Error("Spotify item not found. Check the URL.")
    throw new Error(`Spotify API error ${err.status}: ${err.body}`)
  }
}

// ── Pagination Helper ────────────────────────────────────────────────────────
// Fetches ALL pages of a Spotify paginated response.
// firstPage: { items, next, total }
// Works for album tracks (50/page), playlist tracks (100/page).
async function fetchAllPages(firstPage, clientId, clientSecret, accessToken) {
  const allItems = [...(firstPage?.items || [])]
  let nextUrl = firstPage?.next || null

  while (nextUrl) {
    const nextPath = nextUrl.replace('https://api.spotify.com', '')
    const page = await fetchWithRetry(nextPath, clientId, clientSecret, accessToken)
    if (page?.items?.length) allItems.push(...page.items)
    nextUrl = page?.next || null
  }

  console.log(`[spotify-api] Pagination complete: ${allItems.length} items total`)
  return allItems
}

// ── Main Metadata Resolver ───────────────────────────────────────────────────

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
  const match = (spotifyUrlString || '').split('?')[0].match(/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error(`Invalid Spotify URL. Supported: track, album, playlist.`);
  
  const cacheKey = `${match[1]}_${match[2]}`;
  const cache = loadCache();
  if (cache[cacheKey] && Date.now() - cache[cacheKey].timestamp < 48 * 60 * 60 * 1000) {
      console.log(`[spotify-api] Smart Caching HIT for ${cacheKey}`);
      return cache[cacheKey].data;
  }

  const data = await _resolveSpotifyMetadata(spotifyUrlString, clientId, clientSecret, accessToken);
  cache[cacheKey] = { timestamp: Date.now(), data };
  saveCache();
  return data;
}

async function _resolveSpotifyMetadata(spotifyUrlString, clientId, clientSecret, accessToken = null) {

  const match = (spotifyUrlString || '').split('?')[0].match(
    /open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/
  )
  if (!match) {
    throw new Error(`Invalid Spotify URL. Supported: track, album, playlist.`)
  }

  const type = match[1]
  const id = match[2]

  // ── Track ──────────────────────────────────────────────────────────────────
  if (type === 'track') {
    const track = await fetchWithRetry(`/v1/tracks/${id}`, clientId, clientSecret, accessToken)
    const artist = track.artists?.[0]?.name
    if (!artist) throw new Error(`Could not resolve artist for track: ${id}`)
    return {
      type: 'track',
      title: track.name,
      artist,
      allArtists: track.artists.map(a => a.name).join(', '),
      album: track.album.name,
      year: track.album.release_date?.substring(0, 4) || '',
      trackNumber: track.track_number,
      totalTracks: track.album.total_tracks,
      coverUrl: track.album.images?.[0]?.url || null,
      spotifyId: track.id,
      spotifyUrl: `https://open.spotify.com/track/${track.id}`,
      durationMs: track.duration_ms
    }
  }

  // ── Album ──────────────────────────────────────────────────────────────────
  if (type === 'album') {
    const market = accessToken ? '?market=from_token' : '?market=US'
    const album = await fetchWithRetry(`/v1/albums/${id}${market}`, clientId, clientSecret, accessToken)
    const artist = album.artists?.[0]?.name
    if (!artist) throw new Error(`Could not resolve artist for album: ${id}`)

    const albumCover = album.images?.[0]?.url || null
    const albumYear = album.release_date?.substring(0, 4) || ''
    const totalTracks = album.total_tracks

    // Max 50 tracks per page for albums
    const allTracks = await fetchAllPages(album.tracks, clientId, clientSecret, accessToken)

    if (allTracks.length !== totalTracks) {
      console.warn(`[spotify-api] Album mismatch: expected ${totalTracks}, got ${allTracks.length}`)
    }

    return {
      type: 'album',
      title: album.name,
      artist,
      allArtists: album.artists.map(a => a.name).join(', '),
      year: albumYear,
      coverUrl: albumCover,
      trackCount: allTracks.length,
      totalTracks,
      spotifyId: album.id,
      tracks: allTracks.map(track => ({
        trackNumber: track.track_number,
        title: track.name,
        artist: track.artists?.[0]?.name || artist,
        allArtists: track.artists?.map(a => a.name).join(', ') || artist,
        album: album.name,
        year: albumYear,
        coverUrl: albumCover,
        spotifyId: track.id,
        spotifyUrl: `https://open.spotify.com/track/${track.id}`,
        durationMs: track.duration_ms,
        totalTracks
      }))
    }
  }

  // ── Playlist ───────────────────────────────────────────────────────────────
  if (type === 'playlist') {
    const market = accessToken ? '&market=from_token' : '&market=US'

    // Get playlist metadata first (name, cover, owner)
    const playlist = await fetchWithRetry(
      `/v1/playlists/${id}?fields=id,name,owner,images,tracks.total${market.replace('&', '&')}`,
      clientId, clientSecret, accessToken
    )

    // Fetch ALL tracks with full pagination — max 100 per page
    // This is where 116-track playlists were getting cut to 100
    const firstPage = await fetchWithRetry(
      `/v1/playlists/${id}/tracks?limit=100${market}`,
      clientId, clientSecret, accessToken
    )

    const allItems = await fetchAllPages(firstPage, clientId, clientSecret, accessToken)

    // Filter out episodes, deleted tracks, local files
    const validTracks = allItems.filter(
      item => item?.track && item.track.type === 'track' && !item.track.is_local
    )

    const trackCount = validTracks.length

    if (allItems.length !== validTracks.length) {
      console.log(`[spotify-api] Filtered ${allItems.length - validTracks.length} non-track items`)
    }

    return {
      type: 'playlist',
      title: playlist.name,
      owner: playlist.owner?.display_name || playlist.owner?.id || 'Unknown',
      coverUrl: playlist.images?.[0]?.url || null,
      trackCount,
      totalTracks: playlist.tracks?.total || trackCount,
      spotifyId: playlist.id,
      tracks: validTracks.map((item, index) => {
        const track = item.track
        const tArtist = track.artists?.[0]?.name
        if (!tArtist) console.warn(`[spotify-api] No artist for track ${track.id}`)
        return {
          trackNumber: index + 1,
          title: track.name,
          artist: tArtist || 'Unknown Artist',
          allArtists: track.artists?.map(a => a.name).join(', ') || tArtist || '',
          album: track.album?.name || '',
          year: track.album?.release_date?.substring(0, 4) || '',
          coverUrl: track.album?.images?.[0]?.url || null,
          spotifyId: track.id,
          spotifyUrl: `https://open.spotify.com/track/${track.id}`,
          durationMs: track.duration_ms,
          totalTracks: trackCount
        }
      })
    }
  }

  throw new Error(`Unsupported Spotify URL type: ${type}`)
}

// Kept for backward compatibility — used as fallback in vite.config.js
// Now throws a proper error instead of using broken scraper
export async function resolveSpotifyFallback(url) {
  let browser;
  try {
    const puppeteer = (await import('puppeteer')).default;
    // Launchesc browser invizibil
    browser = await puppeteer.launch({ 
      headless: "new", 
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    
    // Mascam ca un utilizator normal
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    
    // Mergem la URL
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    
    // Extragem datele din DOM-ul paginii Spotify Web
    const data = await page.evaluate((url) => {
      const titleEl = document.querySelector('h1');
      const title = titleEl ? titleEl.innerText : 'Spotify Audio';
      
      const tracks = [];
      const rows = document.querySelectorAll('[data-testid="tracklist-row"]');
      
      rows.forEach((row, index) => {
        // Cautam numele melodiei
        const nameEl = row.querySelector('.t_yrXoUO3qGsJS4Y6iXX, .standalone-ellipsis-one-line') || row.querySelector('div[dir="auto"]');
        const name = nameEl ? nameEl.innerText : 'Track ' + (index + 1);
        
        // Cautam artistul
        const artistEls = row.querySelectorAll('a[href^="/artist/"]');
        const artists = Array.from(artistEls).map(a => a.innerText);
        const artist = artists.length > 0 ? artists[0] : 'Unknown Artist';
        const allArtists = artists.join(', ');
        
        // Cautam durata
        const durationEl = row.querySelector('[data-testid="tracklist-duration"], .Btg2qCGi3mQ8gQ0FOUbQ') || row.querySelector('div[aria-colindex="last()"]');
        let durationMs = 0;
        if (durationEl && durationEl.innerText) {
          const parts = durationEl.innerText.trim().split(':');
          if (parts.length === 2) {
            durationMs = (parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10)) * 1000;
          }
        }
        
        tracks.push({
          trackNumber: index + 1,
          title: name,
          artist,
          allArtists,
          durationMs,
          coverUrl: null
        });
      });
      
      const coverEl = document.querySelector('img[data-testid="entity-image"], img[data-testid="cover-art-image"]');
      const coverUrl = coverEl ? coverEl.src : null;
      
      return {
        type: url.includes('/album/') ? 'album' : 'playlist',
        title,
        trackCount: tracks.length,
        totalTracks: tracks.length,
        totalDurationMs: tracks.reduce((acc, t) => acc + t.durationMs, 0),
        tracks,
        coverUrl
      };
    }, url);
    
    if (!data.tracks || data.tracks.length === 0) {
      throw new Error("Puppeteer a gasit 0 melodii. Pagina s-ar putea sa necesite login sau s-a incarcat greu.");
    }
    
    return data;
  } catch (err) {
    throw new Error(`Extragere Puppeteer fallback esuata: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }
}