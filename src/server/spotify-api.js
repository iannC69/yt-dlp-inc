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
          // Reject cu plain object { status, body, headers } pentru fetchWithRetry
          // să poată inspecta status-ul. fetchWithRetry convertește la Error înainte
          // să propageze în afară.
          reject({ status: res.statusCode, body, headers: res.headers })
        }
      })
    }).on('error', reject).end()
  })
}

// ── Normalize raw rejection to Error ─────────────────────────────────────────
// spotifyApiRequest rejectează cu { status, body } (plain object).
// Această funcție convertește la Error cu mesaj lizibil.
function toSpotifyError(err, context = '') {
  if (err instanceof Error) return err
  const status = err?.status ?? 'UNKNOWN'
  const body = err?.body ?? ''
  let msg = `SPOTIFY_${status}`
  if (context) msg += ` [${context}]`
  try {
    const parsed = JSON.parse(body)
    const detail = parsed?.error?.message || ''
    if (detail) msg += `: ${detail}`
  } catch {
    if (body) msg += `: ${body.slice(0, 200)}`
  }
  return new Error(msg)
}

// ── Fetch with Retry ─────────────────────────────────────────────────────────
async function fetchWithRetry(path, clientId, clientSecret, accessToken) {
  let token = accessToken || await getSpotifyToken(clientId, clientSecret)
  try {
    return await spotifyApiRequest(path, token)
  } catch (err) {
    // ── 401 OAuth expirat ──────────────────────────────────────────────────
    if (err.status === 401) {
      if (accessToken && clientId && clientSecret) {
        console.warn('[spotify-api] OAuth token expired, falling back to client credentials')
      }
      tokenCache = null
      try {
        token = await getSpotifyToken(clientId, clientSecret)
        return await spotifyApiRequest(path.replace('market=from_token', 'market=US'), token)
      } catch (retryErr) {
        throw toSpotifyError(retryErr, '401-fallback')
      }
    }

    // ── 429 Rate limit ─────────────────────────────────────────────────────
    if (err.status === 429) {
      const retryAfter = parseInt(err.headers?.['retry-after'] || '3', 10)
      console.warn(`[spotify-api] Rate limited. Waiting ${retryAfter}s...`)
      await new Promise(r => setTimeout(r, retryAfter * 1000))
      try {
        return await spotifyApiRequest(path, token)
      } catch (retryErr) {
        throw toSpotifyError(retryErr, '429-retry')
      }
    }

    // ── 403 Forbidden ──────────────────────────────────────────────────────
    // An OAuth token can be stale or lack a scope even when the target
    // playlist is public. Retry once with client credentials: that succeeds
    // for public resources and correctly remains forbidden for private ones.
    if (err.status === 403) {
      console.warn('[spotify-api] 403 Forbidden — retrying public access with client credentials.')
      tokenCache = null

      if (!clientId || !clientSecret) {
        throw new Error('SPOTIFY_403: Token OAuth invalid și nu există client credentials configurate pentru fallback.')
      }

      try {
        token = await getSpotifyToken(clientId, clientSecret)
        return await spotifyApiRequest(path.replace('market=from_token', 'market=US'), token)
      } catch (retryErr) {
        if (retryErr?.status === 403) {
          // Client credentials tot dau 403 — conținut privat sigur
          throw new Error(
            'SPOTIFY_403: Conținut privat (ex. "Your Library", playlist privat). ' +
            'Client credentials nu pot accesa acest resource. ' +
            'Autentifică-te prin "My Profile" cu un token OAuth care are scope-ul playlist-read-private.'
          )
        }
        throw toSpotifyError(retryErr, '403-fallback')
      }
    }

    // ── 404 Not found ──────────────────────────────────────────────────────
    if (err.status === 404) {
      throw new Error('SPOTIFY_404: Item negăsit. Verifică URL-ul.')
    }

    // ── Orice alt status ───────────────────────────────────────────────────
    throw toSpotifyError(err)
  }
}

// ── Pagination Helper ────────────────────────────────────────────────────────
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

// ── Smart Cache ──────────────────────────────────────────────────────────────
const CACHE_FILE = path.join(__dirname, 'spotify_cache.json')
let memCache = null

function loadCache() {
  if (memCache) return memCache
  if (fs.existsSync(CACHE_FILE)) {
    try { memCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) } catch (e) { }
  }
  if (!memCache) memCache = {}
  return memCache
}

function saveCache() {
  if (memCache) fs.writeFileSync(CACHE_FILE, JSON.stringify(memCache), 'utf8')
}

// ── Main Metadata Resolver ───────────────────────────────────────────────────
export async function resolveSpotifyMetadata(spotifyUrlString, clientId, clientSecret, accessToken = null) {
  const match = (spotifyUrlString || '').split('?')[0].match(/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/)
  if (!match) throw new Error('Invalid Spotify URL. Supported: track, album, playlist.')

  console.log('[spotify-api] Processing URL:', spotifyUrlString)
  console.log('[spotify-api] Extracted type:', match[1], 'ID:', match[2])

  const cacheKey = `${match[1]}_${match[2]}`
  const cache = loadCache()
  if (cache[cacheKey] && Date.now() - cache[cacheKey].timestamp < 48 * 60 * 60 * 1000) {
    console.log(`[spotify-api] Smart Caching HIT for ${cacheKey}`)
    console.log('[spotify-api] Cached data:', JSON.stringify({
      type: cache[cacheKey].data?.type,
      title: cache[cacheKey].data?.title,
      trackCount: cache[cacheKey].data?.trackCount
    }))
    return cache[cacheKey].data
  }

  const data = await _resolveSpotifyMetadata(spotifyUrlString, clientId, clientSecret, accessToken)
  console.log('[spotify-api] Fresh API data:', JSON.stringify({
    type: data?.type,
    title: data?.title,
    trackCount: data?.trackCount,
    firstTrack: data?.tracks?.[0]?.title,
    firstTrackArtist: data?.tracks?.[0]?.artist
  }))
  cache[cacheKey] = { timestamp: Date.now(), data }
  saveCache()
  return data
}

async function _resolveSpotifyMetadata(spotifyUrlString, clientId, clientSecret, accessToken = null) {
  const match = (spotifyUrlString || '').split('?')[0].match(
    /open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/
  )
  if (!match) {
    throw new Error('Invalid Spotify URL. Supported: track, album, playlist.')
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

    const playlist = await fetchWithRetry(
      `/v1/playlists/${id}?fields=id,name,owner,images,tracks.total${market}`,
      clientId, clientSecret, accessToken
    )

    const firstPage = await fetchWithRetry(
      `/v1/playlists/${id}/tracks?limit=100${market}`,
      clientId, clientSecret, accessToken
    )

    const allItems = await fetchAllPages(firstPage, clientId, clientSecret, accessToken)

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

// ── Fallback Puppeteer ────────────────────────────────────────────────────────
export async function resolveSpotifyFallback(url) {
  let browser
  try {
    const expected = (url || '').split('?')[0].match(/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/)
    if (!expected) throw new Error('URL Spotify invalid pentru fallback.')
    const [, expectedType, expectedId] = expected

    const puppeteer = (await import('puppeteer')).default
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
    const page = await browser.newPage()
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 })

    const data = await page.evaluate((url) => {
      const pagePath = window.location.pathname
      const expectedPath = new URL(url).pathname
      const titleEl = document.querySelector('h1')
      const title = titleEl ? titleEl.innerText : 'Spotify Audio'

      const tracks = []
      const rows = document.querySelectorAll('[data-testid="tracklist-row"]')

      rows.forEach((row, index) => {
        const nameEl = row.querySelector('.t_yrXoUO3qGsJS4Y6iXX, .standalone-ellipsis-one-line') || row.querySelector('div[dir="auto"]')
        const name = nameEl ? nameEl.innerText : 'Track ' + (index + 1)

        const artistEls = row.querySelectorAll('a[href^="/artist/"]')
        const artists = Array.from(artistEls).map(a => a.innerText)
        const artist = artists.length > 0 ? artists[0] : 'Unknown Artist'
        const allArtists = artists.join(', ')

        const durationEl = row.querySelector('[data-testid="tracklist-duration"], .Btg2qCGi3mQ8gQ0FOUbQ, div[aria-colindex="last()"]')
        let durationMs = 0
        if (durationEl && durationEl.innerText) {
          const text = durationEl.innerText.trim()
          const parts = text.split(':')
          if (parts.length === 2) {
            durationMs = (parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10)) * 1000
          } else if (parts.length === 3) {
            durationMs = (parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10)) * 1000
          }
        } else {
          const timeMatch = row.innerText.match(/\b(\d{1,2}):(\d{2})\b/)
          if (timeMatch) {
            durationMs = (parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10)) * 1000
          }
        }

        tracks.push({ trackNumber: index + 1, title: name, artist, allArtists, durationMs, coverUrl: null })
      })

      const coverEl = document.querySelector('meta[property="og:image"], img[data-testid="entity-image"], img[data-testid="cover-art-image"]')
      const coverUrl = coverEl ? (coverEl.content || coverEl.src) : null

      return {
        pagePath,
        expectedPath,
        type: url.includes('/album/') ? 'album' : 'playlist',
        title,
        trackCount: tracks.length,
        totalTracks: tracks.length,
        totalDurationMs: tracks.reduce((acc, t) => acc + t.durationMs, 0),
        tracks,
        coverUrl
      }
    }, url)

    // Do not turn Spotify's login/home shell into metadata for the URL that
    // was requested. The fallback is only safe when the browser stayed on the
    // exact resource and did not render the user's library/home view.
    if (data.pagePath !== data.expectedPath || data.type !== expectedType ||
        /^(your library|spotify audio)$/i.test(data.title.trim())) {
      throw new Error(`Pagina Spotify nu a confirmat ${expectedType}/${expectedId}.`)
    }

    if (!data.tracks || data.tracks.length === 0) {
      throw new Error('Puppeteer a gasit 0 melodii. Pagina s-ar putea sa necesite login sau s-a incarcat greu.')
    }

    delete data.pagePath
    delete data.expectedPath
    return data
  } catch (err) {
    throw new Error(`Extragere Puppeteer fallback esuata: ${err.message}`)
  } finally {
    if (browser) await browser.close()
  }
}
