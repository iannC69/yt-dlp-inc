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
const PLAYLIST_TRACK_FIELDS = 'next,total,items(track(id,name,duration_ms,type,is_local,artists(id,name),album(id,name,release_date,images,total_tracks),track_number,external_ids))'
async function fetchAllPages(firstPage, clientId, clientSecret, accessToken) {
  const expectedTotal = firstPage?.total ?? null
  const allItems = [...(firstPage?.items || [])]
  let nextUrl = firstPage?.next || null
  let pageNum = 1

  while (nextUrl) {
    pageNum++
    let nextPath = nextUrl.replace('https://api.spotify.com', '')

    // Spotify's `next` URL often returns broken/double-encoded `fields` parameters for complex queries.
    // Instead of using their string blindly, we parse out the offset/limit and rebuild the URL cleanly.
    try {
      const u = new URL(nextUrl);
      const limit = u.searchParams.get('limit') || '100';
      const offset = u.searchParams.get('offset') || String(allItems.length);
      const marketParams = accessToken ? 'market=from_token' : 'market=US';
      const base = u.pathname;

      if (base.includes('/playlists/') && base.includes('/tracks')) {
        nextPath = `${base}?limit=${limit}&offset=${offset}&${marketParams}`;
      } else if (base.includes('/albums/') && base.includes('/tracks')) {
        nextPath = `${base}?limit=${limit}&offset=${offset}&${marketParams}`;
      }
    } catch (e) {
      // fallback if URL parsing fails
    }
    console.log(`[spotify-api] Fetching page ${pageNum} (${allItems.length} items so far)...`)
    try {
      const page = await fetchWithRetry(nextPath, clientId, clientSecret, accessToken)
      if (page?.items?.length) allItems.push(...page.items)
      nextUrl = page?.next || null
    } catch (e) {
      console.warn(`[spotify-api] Failed to fetch page ${pageNum}: ${e.message}. Stopping pagination early.`)
      break;
    }
  }

  console.log(`[spotify-api] Pagination complete: ${allItems.length} items total (expected: ${expectedTotal ?? 'unknown'})`)

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
export async function resolveSpotifyMetadata(spotifyUrlString, clientId, clientSecret, accessToken = null, forceRefresh = false) {
  const match = (spotifyUrlString || '').split('?')[0].match(/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/)
  if (!match) throw new Error('Invalid Spotify URL. Supported: track, album, playlist.')

  console.log('[spotify-api] Processing URL:', spotifyUrlString)
  console.log('[spotify-api] Extracted type:', match[1], 'ID:', match[2])

  const cacheKey = `${match[1]}_${match[2]}`
  const cache = loadCache()
  // Cache TTL: 5 minutes for playlists (content changes), 24 hours for tracks/albums
  const CACHE_TTL_PLAYLIST = 5 * 60 * 1000
  const CACHE_TTL_STATIC = 24 * 60 * 60 * 1000
  if (!forceRefresh && cache[cacheKey] && cache[cacheKey].timestamp) {
    const cachedData = cache[cacheKey].data;
    const age = Date.now() - cache[cacheKey].timestamp;
    const ttl = (cachedData?.type === 'playlist') ? CACHE_TTL_PLAYLIST : CACHE_TTL_STATIC;
    // Bust cache if playlist trackCount < totalTracks (incomplete fetch stored previously)
    const isPartial = cachedData?.type === 'playlist' && typeof cachedData.trackCount === 'number' && typeof cachedData.totalTracks === 'number' && cachedData.trackCount < cachedData.totalTracks;
    if (isPartial) {
      console.log(`[spotify-api] Cache BUST for ${cacheKey}: cached ${cachedData.trackCount} tracks but totalTracks=${cachedData.totalTracks} — forcing full re-fetch`);
    } else if (age < ttl) {
      console.log(`[spotify-api] Cache HIT for ${cacheKey} (age: ${Math.round(age / 60000)}min, ttl: ${Math.round(ttl / 60000)}min)`);
      console.log('[spotify-api] Cached data:', JSON.stringify({
        type: cachedData?.type,
        title: cachedData?.title,
        trackCount: cachedData?.trackCount
      }))
      return cachedData
    } else {
      console.log(`[spotify-api] Cache EXPIRED for ${cacheKey} (age: ${Math.round(age / 60000)}min) — re-fetching`);
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
    const albumId = track.album?.id

    let artistData = null;
    let albumData = null;

    try {
      const promises = [];
      if (artistId) promises.push(fetchWithRetry(`/v1/artists/${artistId}`, clientId, clientSecret, accessToken).then(d => artistData = d).catch(() => { }));
      if (albumId) promises.push(fetchWithRetry(`/v1/albums/${albumId}`, clientId, clientSecret, accessToken).then(d => albumData = d).catch(() => { }));
      await Promise.all(promises);
    } catch (e) { }

    let artistThumbnail = artistData?.images?.[0]?.url || null;
    let genre = artistData?.genres?.join(', ') || '';

    if (!artist) throw new Error(`Could not resolve artist for track: ${id}`)
    return {
      type: 'track',
      title: track.name,
      artist,
      allArtists: track.artists.map(a => a.name).join(', '),
      album: track.album.name,
      year: track.album.release_date?.substring(0, 4) || '',
      releaseDate: track.album.release_date || '',
      trackNumber: track.track_number,
      totalTracks: track.album.total_tracks,
      discNumber: track.disc_number,
      totalDiscs: albumData?.tracks?.items ? Math.max(...albumData.tracks.items.map(t => t.disc_number)) : 1,
      isrc: track.external_ids?.isrc || '',
      label: albumData?.label || '',
      copyright: albumData?.copyrights?.[0]?.text || '',
      explicit: track.explicit || false,
      genre,
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

    let artistData = null;
    let artistThumbnail = null;
    if (artistId) {
      try {
        artistData = await fetchWithRetry(`/v1/artists/${artistId}`, clientId, clientSecret, accessToken)
        artistThumbnail = artistData.images?.[0]?.url || null
      } catch (e) { }
    }
    if (!artist) throw new Error(`Could not resolve artist for album: ${id}`)

    const albumCover = album.images?.[0]?.url || null
    const albumYear = album.release_date?.substring(0, 4) || ''
    const totalTracks = album.total_tracks
    const genre = artistData?.genres?.join(', ') || ''
    const label = album.label || ''
    const copyright = album.copyrights?.[0]?.text || ''
    const releaseDate = album.release_date || ''

    const allTracks = await fetchAllPages(album.tracks, clientId, clientSecret, accessToken)
    const totalDiscs = Math.max(1, ...allTracks.map(t => t.disc_number || 1))

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
        releaseDate,
        totalTracks,
        discNumber: track.disc_number,
        totalDiscs,
        isrc: track.external_ids?.isrc || '',
        label,
        copyright,
        explicit: track.explicit || false,
        genre,
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
      `/v1/playlists/${id}/tracks?limit=100&fields=next,total,items(track(id,name,duration_ms,type,is_local,artists(id,name),album(id,name,release_date,images,total_tracks),track_number,external_ids))${market}`,
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

    // ── Batch-fetch artist thumbnails for all unique artists in playlist ──────
    // Spotify /v1/artists?ids= accepts up to 50 comma-separated IDs per request.
    const artistThumbnailMap = new Map() // artistId → imageUrl
    try {
      // Collect all unique artist IDs from playlist tracks
      const uniqueArtistIds = []
      const seenIds = new Set()
      for (const item of validTracks) {
        for (const a of (item.track?.artists || [])) {
          if (a.id && !seenIds.has(a.id)) {
            seenIds.add(a.id)
            uniqueArtistIds.push(a.id)
          }
        }
      }

      console.log(`[spotify-api] Fetching thumbnails for ${uniqueArtistIds.length} unique artists in playlist...`)

      // Batch in groups of 50
      for (let i = 0; i < uniqueArtistIds.length; i += 50) {
        const chunk = uniqueArtistIds.slice(i, i + 50)
        try {
          const batchRes = await fetchWithRetry(
            `/v1/artists?ids=${chunk.join(',')}`,
            clientId, clientSecret, accessToken
          )
          for (const artist of (batchRes?.artists || [])) {
            if (artist?.id && artist.images?.[0]?.url) {
              artistThumbnailMap.set(artist.id, artist.images[0].url)
            }
          }
          // Small delay between batches to avoid 429
          if (i + 50 < uniqueArtistIds.length) {
            await new Promise(r => setTimeout(r, 50))
          }
        } catch (batchErr) {
          console.warn(`[spotify-api] Batch artist fetch failed for chunk starting at ${i}: ${batchErr.message}`)
        }
      }

      console.log(`[spotify-api] Got thumbnails for ${artistThumbnailMap.size} / ${uniqueArtistIds.length} artists`)
    } catch (artistErr) {
      console.warn(`[spotify-api] Artist batch thumbnail fetch failed: ${artistErr.message}`)
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
        const tArtistId = track.artists?.[0]?.id
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
          totalTracks: trackCount,
          isrc: track.external_ids?.isrc || '',
          artistId: tArtistId || null,
          artistThumbnail: tArtistId ? (artistThumbnailMap.get(tArtistId) || null) : null,
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

  // 🔍 Debug: log entity structure so we can identify new Spotify embed formats
  console.log(`[parseSpotifyEmbed] entity keys: ${Object.keys(entity).join(', ')}`)
  console.log(`[parseSpotifyEmbed] entity.subtitle=${entity.subtitle}, entity.name=${entity.name}, entity.title=${entity.title}`)
  if (entity.artists) console.log(`[parseSpotifyEmbed] entity.artists[0]=${JSON.stringify(entity.artists?.[0])}`)
  if (entity.data) console.log(`[parseSpotifyEmbed] entity.data keys: ${Object.keys(entity.data || {}).join(', ')}`)

  const title = entity.title || entity.name || 'Spotify Resource'
  const coverUrl = entity.coverArt?.sources?.[0]?.url || entity.visualIdentity?.image?.[0]?.url || null

  if (type === 'track') {
    // Spotify embed JSON structure changes frequently.
    // Try every known path to find the artist name — never return 'Unknown Artist' without exhausting all options.
    const extractArtist = (entity, json) => {
      // Latest Spotify embed structure (2024+): GraphQL-style
      const gqlArtists =
        entity?.data?.trackUnion?.firstArtist?.items?.[0]?.profile?.name ||
        entity?.data?.trackUnion?.artists?.items?.[0]?.profile?.name ||
        entity?.trackUnion?.firstArtist?.items?.[0]?.profile?.name ||
        entity?.trackUnion?.artists?.items?.[0]?.profile?.name;
      if (gqlArtists) return gqlArtists;

      // Classic subtitle field
      if (entity.subtitle && entity.subtitle !== title) return entity.subtitle;

      // authors array (common in older embed responses)
      const authName = entity.authors?.[0]?.name ||
        entity.author?.[0]?.name ||
        entity.creators?.[0]?.name ||
        entity.artist?.name;
      if (authName) return authName;

      // artists array on entity directly
      const directArtist = entity.artists?.[0]?.name ||
        entity.artistWithRole?.[0]?.artist?.name;
      if (directArtist) return directArtist;

      // Try scanning deeper in pageProps state
      try {
        const state = json.props?.pageProps?.state;
        const entities = state?.entities?.items || {};
        for (const val of Object.values(entities)) {
          if (val?.type === 'artist' && val?.data?.profile?.name) {
            return val.data.profile.name;
          }
          if (val?.data?.artist?.profile?.name) return val.data.artist.profile.name;
        }
        // Dig into trackUnion from state
        const tu = state?.data?.trackUnion;
        if (tu?.firstArtist?.items?.[0]?.profile?.name) return tu.firstArtist.items[0].profile.name;
        if (tu?.artists?.items?.[0]?.profile?.name) return tu.artists.items[0].profile.name;
      } catch { }

      // Last resort: scan entire JSON string for artist patterns
      try {
        const jsonStr = JSON.stringify(json);
        // Look for "profile":{"name":"ArtistName"}
        const profileMatch = jsonStr.match(/"profile"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
        if (profileMatch?.[1]) return profileMatch[1];
      } catch { }

      return null; // caller will use title-based fallback
    };

    let artistName = extractArtist(entity, json);

    // Fallback: fetch the main page and extract artist from <title> tag
    if (!artistName) {
      try {
        const trackUrl = `https://open.spotify.com/track/${id}`;
        const r = await fetch(trackUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } });
        const html = await r.text();
        const titleMatch = html.match(/<title>(.*?)<\/title>/i);
        if (titleMatch) {
          const tText = titleMatch[1];
          // Usually: "Title - song and lyrics by Artist | Spotify"
          const byMatch = tText.match(/song and lyrics by (.*?) \|/i) || tText.match(/- Single by (.*?) \|/i);
          if (byMatch) {
            artistName = byMatch[1].trim();
          } else {
            // "Title - song by Artist | Spotify"
            const byMatch2 = tText.match(/song by (.*?) \|/i);
            if (byMatch2) artistName = byMatch2[1].trim();
          }
        }
      } catch (err) {
        console.warn('[parseSpotifyEmbed] Title fallback failed:', err.message);
      }
    }

    console.log(`[parseSpotifyEmbed] extracted artist="${artistName}" for title="${title}"`);

    // Cover art — try multiple paths
    const coverUrl =
      entity.coverArt?.sources?.find(s => s.width >= 300)?.url ||
      entity.coverArt?.sources?.[0]?.url ||
      entity.visualIdentity?.image?.[0]?.url ||
      entity.data?.trackUnion?.albumOfTrack?.coverArt?.sources?.[0]?.url ||
      entity.albumOfTrack?.coverArt?.sources?.[0]?.url ||
      null;

    // Album name
    const albumName =
      entity.data?.trackUnion?.albumOfTrack?.name ||
      entity.albumOfTrack?.name ||
      entity.album?.name ||
      '';

    const spotifyId = entity.id || entity.data?.trackUnion?.id || id;
    const artist = artistName || 'Unknown Artist';
    return {
      type: 'track',
      title,
      artist,
      allArtists: artist,
      album: albumName,
      year: '',
      trackNumber: 1,
      totalTracks: 1,
      coverUrl,
      spotifyId,
      spotifyUrl: `https://open.spotify.com/track/${spotifyId}`,
      durationMs: entity.duration || entity.data?.trackUnion?.duration?.totalMilliseconds || 0,
      artistThumbnail: null,
      isrc: entity.data?.trackUnion?.externalIds?.isrc || '',
    };
  } else {
    const rawTracks = entity.trackList || []
    const tracks = rawTracks.map((t, idx) => {
      const trackId = t.uri ? t.uri.split(':').pop() : (t.id || `${id}_${idx + 1}`)
      const tTitle = t.title || t.name || 'Track ' + (idx + 1)
      // Try all known paths for artist in playlist/album embed JSON
      const tArtist =
        t.subtitle ||
        t.artists?.[0]?.name ||
        t.firstArtist?.items?.[0]?.profile?.name ||
        t.artistWithRole?.[0]?.artist?.profile?.name ||
        t.authors?.[0]?.name ||
        'Unknown Artist'
      return {
        trackNumber: idx + 1,
        title: tTitle,
        artist: tArtist,
        allArtists: tArtist,
        album: '',
        year: '',
        coverUrl: t.coverArt?.sources?.[0]?.url || t.albumOfTrack?.coverArt?.sources?.[0]?.url || null,
        spotifyId: trackId,
        spotifyUrl: `https://open.spotify.com/track/${trackId}`,
        durationMs: t.duration || t.duration_ms || t.durationMs || 0,
        totalTracks: rawTracks.length,
        audioPreview: t.audioPreview?.url || null
      }
    })

    // If embed returned 100 tracks, attempt to fetch tracks 101..N via Spotify API if token is available
    if (tracks.length === 100) {
      let apiSucceeded = false;
      try {
        const token = await getSpotifyToken(clientId, clientSecret)
        let offset = 100
        let hasMore = true
        while (hasMore && offset < 5000) {
          const pageRes = await spotifyApiRequest(`/v1/${type}s/${id}/tracks?offset=${offset}&limit=100`, token)
          apiSucceeded = true;
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
        console.warn('[parseSpotifyEmbed] Additional page fetch skipped or failed:', pagErr.message || pagErr)
      }

      // If API failed (e.g. 404 for user playlists with client_credentials), use Puppeteer to scroll and get all tracks
      if (!apiSucceeded && type === 'playlist') {
        console.log('[parseSpotifyEmbed] API pagination failed, using Puppeteer to scroll and scrape all tracks...');
        try {
          const puppeteerData = await resolveSpotifyFallback(urlStr);
          if (puppeteerData?.tracks?.length > 100) {
            return puppeteerData;
          }
        } catch (pupErr) {
          console.warn('[parseSpotifyEmbed] Puppeteer pagination fallback failed:', pupErr.message);
        }
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

    const data = await page.evaluate(async (url) => {
      const pagePath = window.location.pathname;
      const expectedPath = new URL(url).pathname;
      const titleEl = document.querySelector('h1');
      const title = titleEl ? titleEl.innerText : 'Spotify Audio';

      const tracksMap = new Map();
      let previousTrackCount = 0;
      let unchangedScrolls = 0;

      // Scroll and collect tracks for up to ~1500 tracks or until no new tracks appear
      while (unchangedScrolls < 4) {
        const rows = document.querySelectorAll('[data-testid="tracklist-row"]');
        rows.forEach((row) => {
          // Extract track index from the aria-rowindex or the first column
          const ariaIndex = row.getAttribute('aria-rowindex');
          let trackIndex = parseInt(ariaIndex, 10);

          if (!trackIndex || isNaN(trackIndex)) {
            const indexEl = row.querySelector('[aria-colindex="1"]');
            if (indexEl) trackIndex = parseInt(indexEl.innerText.trim(), 10);
          }

          if (!trackIndex || isNaN(trackIndex)) return;

          if (!tracksMap.has(trackIndex)) {
            const nameEl = row.querySelector('.t_yrXoUO3qGsJS4Y6iXX, .standalone-ellipsis-one-line') || row.querySelector('div[dir="auto"]');
            const name = nameEl ? nameEl.innerText : 'Track ' + trackIndex;

            const artistEls = row.querySelectorAll('a[href^="/artist/"]');
            const artists = Array.from(artistEls).map(a => a.innerText);
            const artist = artists.length > 0 ? artists[0] : 'Unknown Artist';
            const allArtists = artists.join(', ');

            const durationEl = row.querySelector('[data-testid="tracklist-duration"], .Btg2qCGi3mQ8gQ0FOUbQ, div[aria-colindex="last()"]');
            let durationMs = 0;
            if (durationEl && durationEl.innerText) {
              const text = durationEl.innerText.trim();
              const parts = text.split(':');
              if (parts.length === 2) {
                durationMs = (parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10)) * 1000;
              } else if (parts.length === 3) {
                durationMs = (parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10)) * 1000;
              }
            } else {
              const timeMatch = row.innerText.match(/\b(\d{1,2}):(\d{2})\b/);
              if (timeMatch) {
                durationMs = (parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10)) * 1000;
              }
            }

            tracksMap.set(trackIndex, { trackNumber: trackIndex, title: name, artist, allArtists, durationMs, coverUrl: null });
          }
        });

        if (tracksMap.size === previousTrackCount) {
          unchangedScrolls++;
        } else {
          unchangedScrolls = 0;
          previousTrackCount = tracksMap.size;
        }

        // Scroll down by 800px
        window.scrollBy(0, 800);
        await new Promise(r => setTimeout(r, 600));
      }

      // Sort tracks by index
      const tracks = Array.from(tracksMap.values()).sort((a, b) => a.trackNumber - b.trackNumber);
      // Re-number tracks to ensure sequential (in case Spotify aria-rowindex starts at 2 or has gaps)
      tracks.forEach((t, i) => { t.trackNumber = i + 1; });

      const coverEl = document.querySelector('meta[property="og:image"], img[data-testid="entity-image"], img[data-testid="cover-art-image"]');
      const coverUrl = coverEl ? (coverEl.content || coverEl.src) : null;

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

export async function searchSpotifyAPI(query, clientId, clientSecret, accessToken = null) {
  const market = accessToken ? "market=from_token" : "market=US";
  const q = encodeURIComponent(query);
  const res = await fetchWithRetry(`/v1/search?q=${q}&type=track&limit=1&${market}`, clientId, clientSecret, accessToken);
  if (res && res.tracks && res.tracks.items && res.tracks.items.length > 0) {
    return _resolveSpotifyMetadata(`https://open.spotify.com/track/${res.tracks.items[0].id}`, clientId, clientSecret, accessToken);
  }
  return null;
}
