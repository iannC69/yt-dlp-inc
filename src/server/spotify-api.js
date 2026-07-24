import https from 'https'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))


// ── Token Cache ──────────────────────────────────────────────────────────────
let tokenCache = null

export async function getSpotifyToken(clientId, clientSecret) {
  if (tokenCache && tokenCache.accessToken && tokenCache.expiresAt > Date.now()) {
    return tokenCache.accessToken
  }

  const useAnonymous = async () => {
    console.log('[spotify-api] Falling back to anonymous token')
    const anonToken = await getAnonymousSpotifyToken()
    if (!anonToken) throw new Error("Could not fetch anonymous token")
    tokenCache = {
      accessToken: anonToken,
      expiresAt: Date.now() + 3500 * 1000
    }
    return anonToken
  }

  if (!clientId || !clientSecret) {
    return useAnonymous()
  }
  
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const data = 'grant_type=client_credentials'

  return new Promise((resolve, reject) => {
    const req = https.request('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': data.length
      }
    }, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk)
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(body)
            if (json.access_token) {
              tokenCache = {
                accessToken: json.access_token,
                expiresAt: Date.now() + (json.expires_in - 60) * 1000
              }
              resolve(json.access_token)
            } else {
              resolve(useAnonymous())
            }
          } catch (e) {
            resolve(useAnonymous())
          }
        } else {
          resolve(useAnonymous())
        }
      })
    })
    req.on('error', () => resolve(useAnonymous()))
    req.write(data)
    req.end()
  })
}

// ── Anonymous Web Player Token ────────────────────────────────────────────────
// Fetches a real Spotify access token from Spotify's own web player endpoint.
// Works for any PUBLIC content without needing user credentials.
// This replaces the broken spotify-url-info scraping library.
export async function getAnonymousSpotifyToken() {
  const res = await fetch(
    'https://open.spotify.com/get_access_token?reason=transport&productType=web_player',
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en',
        'Referer': 'https://open.spotify.com/',
        'Origin': 'https://open.spotify.com',
      }
    }
  )
  if (!res.ok) throw new Error(`Spotify anonymous token endpoint returned ${res.status}`)
  const data = await res.json()
  if (!data.accessToken) throw new Error('No accessToken in Spotify anonymous token response')
  console.log('[spotify-api] Got anonymous Spotify token (expires in ~1h)')
  return data.accessToken
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
      if (retryAfter > 15) {
        throw new Error(`SPOTIFY_429: Rate limited by Spotify. Please try again in ${retryAfter} seconds.`)
      }
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
            'SPOTIFY_403: Acces respins. Acest playlist este privat.\n\n' +
            'Dacă ești deja logat ("My Profile"), înseamnă că playlistul aparține altui cont Spotify, ' +
            'iar tu nu ai permisiunea să îl vezi. Dacă e al tău, asigură-te că ești logat cu contul corect. ' +
            'Dacă nu ești logat, autentifică-te pentru a accesa playlisturile tale private.'
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
  const expectedTotal = firstPage?.total ?? null
  const allItems = [...(firstPage?.items || [])]
  let nextUrl = firstPage?.next || null

  while (nextUrl) {
    const nextPath = nextUrl.replace('https://api.spotify.com', '')
    const page = await fetchWithRetry(nextPath, clientId, clientSecret, accessToken)
    if (page?.items?.length) allItems.push(...page.items)
    nextUrl = page?.next || null
  }

  console.log(`[spotify-api] Pagination complete: ${allItems.length} items total (expected: ${expectedTotal ?? 'unknown'})`)

  // If we got fewer items than declared, retry once with a fresh token
  if (expectedTotal !== null && allItems.length < expectedTotal) {
    console.warn(`[spotify-api] Track count mismatch: got ${allItems.length}, expected ${expectedTotal}. Retrying with fresh token...`)
    tokenCache = null
    const retryItems = [...(firstPage?.items || [])]
    let retryNext = firstPage?.next || null
    try {
      while (retryNext) {
        const retryPath = retryNext.replace('https://api.spotify.com', '')
        const retryPage = await fetchWithRetry(retryPath, clientId, clientSecret, null)
        if (retryPage?.items?.length) retryItems.push(...retryPage.items)
        retryNext = retryPage?.next || null
      }
      if (retryItems.length > allItems.length) {
        console.log(`[spotify-api] Retry recovered ${retryItems.length - allItems.length} extra items (${retryItems.length} total)`)
        return retryItems
      }
      console.warn(`[spotify-api] Retry did not improve count (${retryItems.length}), keeping original ${allItems.length}`)
    } catch (retryErr) {
      console.warn(`[spotify-api] Retry failed (${retryErr.message}), keeping original ${allItems.length}`)
    }
  }

  return allItems
}

// ── Smart Cache ──────────────────────────────────────────────────────────────
const CACHE_FILE = path.join(process.env.MEDIADL_APP_DIR || __dirname, 'spotify_cache.json')
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
  // Force bust cache once to clear corrupted embed data
  if (cache[cacheKey] && Date.now() - cache[cacheKey].timestamp < -1) {
    const cachedData = cache[cacheKey].data;
    // Bust cache if we don't have artistThumbnail (added recently)
    if (cachedData && (cachedData.type === 'track' || cachedData.type === 'album') && cachedData.artistThumbnail === undefined) {
      console.log(`[spotify-api] Cache BUST for ${cacheKey} due to missing artistThumbnail`);
    // Bust cache if playlist trackCount < totalTracks (stale partial fetch)
    } else if (cachedData && cachedData.type === 'playlist' && cachedData.trackCount < cachedData.totalTracks) {
      console.log(`[spotify-api] Cache BUST for ${cacheKey}: cached ${cachedData.trackCount} tracks but totalTracks=${cachedData.totalTracks} — partial fetch stored`)
    } else {
      console.log(`[spotify-api] Smart Caching HIT for ${cacheKey}`)
      console.log('[spotify-api] Cached data:', JSON.stringify({
        type: cachedData?.type,
        title: cachedData?.title,
        trackCount: cachedData?.trackCount
      }))
      return cachedData
    }
  }

  let data
  try {
    data = await _resolveSpotifyMetadata(spotifyUrlString, clientId, clientSecret, accessToken)
  } catch (apiErr) {
    console.warn(`[spotify-api] API call failed (${apiErr.message}). Attempting Embed Parser fallback...`)
    try {
      data = await parseSpotifyEmbed(spotifyUrlString, clientId, clientSecret)
      console.log(`[spotify-api] Embed Parser succeeded for ${spotifyUrlString} (${data.tracks?.length || 1} tracks)`)
    } catch (embedErr) {
      console.warn(`[spotify-api] Embed Parser fallback failed (${embedErr.message}). Attempting Puppeteer fallback...`)
      try {
        data = await resolveSpotifyFallback(spotifyUrlString)
        console.log(`[spotify-api] Puppeteer fallback succeeded for ${spotifyUrlString} (${data.tracks?.length || 1} tracks)`)
      } catch (puppeteerErr) {
        console.error(`[spotify-api] All fallbacks failed. Original error: ${apiErr.message}`)
        throw apiErr
      }
    }
  }

  console.log('[spotify-api] Fresh data:', JSON.stringify({
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
    const artistId = track.artists?.[0]?.id
    let artistThumbnail = null
    if (artistId) {
      try {
        const artistData = await fetchWithRetry(`/v1/artists/${artistId}`, clientId, clientSecret, accessToken)
        artistThumbnail = artistData.images?.[0]?.url || null
      } catch(e) {}
    }
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
      durationMs: track.duration_ms,
      artistThumbnail
    }
  }

  // ── Album ──────────────────────────────────────────────────────────────────
  if (type === 'album') {
    const market = accessToken ? '?market=from_token' : '?market=US'
    const album = await fetchWithRetry(`/v1/albums/${id}${market}`, clientId, clientSecret, accessToken)
    const artist = album.artists?.[0]?.name
    const artistId = album.artists?.[0]?.id
    let artistThumbnail = null
    if (artistId) {
      try {
        const artistData = await fetchWithRetry(`/v1/artists/${artistId}`, clientId, clientSecret, accessToken)
        artistThumbnail = artistData.images?.[0]?.url || null
      } catch(e) {}
    }
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
      artistThumbnail,
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

    let ownerThumbnail = playlist.owner?.images?.[0]?.url || null
    if (!ownerThumbnail && playlist.owner?.id) {
      try {
        const ownerData = await fetchWithRetry(`/v1/users/${playlist.owner.id}`, clientId, clientSecret, accessToken)
        ownerThumbnail = ownerData?.images?.[0]?.url || null
      } catch (err) {
        console.warn(`[spotify-api] Could not fetch owner thumbnail for ${playlist.owner.id}`)
      }
    }

    return {
      type: 'playlist',
      title: playlist.name,
      owner: playlist.owner?.display_name || playlist.owner?.id || 'Unknown',
      ownerThumbnail,
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

// ── Embed Parser Fallback (No API Keys Required) ──────────────────────────────────
export async function parseSpotifyEmbed(urlStr, clientId = null, clientSecret = null) {
  const match = (urlStr || '').split('?')[0].match(/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/)
  if (!match) throw new Error('Invalid Spotify URL for embed fallback.')
  const type = match[1]
  const id = match[2]
  const embedUrl = `https://open.spotify.com/embed/${type}/${id}`

  const res = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  })

  if (!res.ok) throw new Error(`Spotify embed HTTP ${res.status}`)
  const html = await res.text()
  const scriptMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s)
  if (!scriptMatch) throw new Error('No __NEXT_DATA__ found on Spotify embed page')

  const json = JSON.parse(scriptMatch[1])
  const entity = json.props.pageProps.state?.data?.entity || json.props.pageProps.entity
  if (!entity) throw new Error('No entity data found in Spotify embed page')

  const title = entity.title || entity.name || 'Spotify Resource'
  const coverUrl = entity.coverArt?.sources?.[0]?.url || entity.visualIdentity?.image?.[0]?.url || null

  if (type === 'track') {
    const artist = entity.subtitle || entity.authors?.[0]?.name || 'Unknown Artist'
    const spotifyId = entity.id || id
    return {
      type: 'track',
      title,
      artist,
      allArtists: artist,
      album: '',
      year: '',
      trackNumber: 1,
      totalTracks: 1,
      coverUrl,
      spotifyId,
      spotifyUrl: `https://open.spotify.com/track/${spotifyId}`,
      durationMs: entity.duration || 0,
      artistThumbnail: null
    }
  } else {
    const rawTracks = entity.trackList || []
    const tracks = rawTracks.map((t, idx) => {
      const trackId = t.uri ? t.uri.split(':').pop() : `${id}_${idx + 1}`
      const tTitle = t.title || 'Track ' + (idx + 1)
      const tArtist = t.subtitle || 'Unknown Artist'
      return {
        trackNumber: idx + 1,
        title: tTitle,
        artist: tArtist,
        allArtists: tArtist,
        album: '',
        year: '',
        coverUrl: null,
        spotifyId: trackId,
        spotifyUrl: `https://open.spotify.com/track/${trackId}`,
        durationMs: t.duration || 0,
        totalTracks: rawTracks.length,
        audioPreview: t.audioPreview?.url || null
      }
    })

    // If embed returned 100 tracks, attempt to fetch tracks 101..N via Spotify API if token is available
    if (tracks.length === 100) {
      try {
        const token = await getSpotifyToken(clientId, clientSecret)
        let offset = 100
        let hasMore = true
        while (hasMore && offset < 5000) {
          const pageRes = await spotifyApiRequest(`/v1/${type}s/${id}/tracks?offset=${offset}&limit=100`, token)
          if (pageRes?.items?.length) {
            const extra = pageRes.items.filter(item => item?.track && item.track.type === 'track').map((item, idx) => {
              const track = item.track
              const tArtist = track.artists?.[0]?.name || 'Unknown Artist'
              return {
                trackNumber: offset + idx + 1,
                title: track.name,
                artist: tArtist,
                allArtists: track.artists?.map(a => a.name).join(', ') || tArtist,
                album: '',
                year: track.album?.release_date?.substring(0, 4) || '',
                coverUrl: track.album?.images?.[0]?.url || coverUrl,
                spotifyId: track.id,
                spotifyUrl: `https://open.spotify.com/track/${track.id}`,
                durationMs: track.duration_ms,
                totalTracks: tracks.length + pageRes.items.length
              }
            })
            tracks.push(...extra)
            offset += pageRes.items.length
            if (!pageRes.next || pageRes.items.length < 100) hasMore = false
          } else {
            hasMore = false
          }
        }
      } catch (pagErr) {
        console.warn('[parseSpotifyEmbed] Additional page fetch skipped:', pagErr.message || pagErr)
      }
    }

    let ownerThumbnail = null;
    try {
      const puppeteer = (await import('puppeteer')).default;
      const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.goto(urlStr, { waitUntil: 'networkidle2', timeout: 15000 });
      const imgs = await page.evaluate(() => Array.from(document.querySelectorAll('img')).map(img => img.src));
      const pfp = imgs.find(src => src.includes('ab677570'));
      if (pfp) ownerThumbnail = pfp;
      await browser.close();
    } catch (pagErr) {
      console.warn('[parseSpotifyEmbed] Failed to scrape owner thumbnail:', pagErr.message || pagErr);
    }

    return {
      type,
      title,
      owner: entity.subtitle || 'Spotify',
      ownerThumbnail,
      coverUrl,
      trackCount: tracks.length,
      totalTracks: tracks.length,
      spotifyId: id,
      tracks
    }
  }
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
      headless: 'shell',
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
