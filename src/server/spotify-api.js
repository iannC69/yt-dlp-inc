import https from 'https'
import spotifyUrlInfo from 'spotify-url-info'

// Initialize spotify-url-info with native fetch
const { getTracks } = spotifyUrlInfo(fetch);// ── Token Cache ──────────────────────────────────────────────────────────────
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
          try {
            resolve(JSON.parse(body))
          } catch (e) {
            reject(new Error("Failed to parse Spotify API response"))
          }
        } else {
          reject({ status: res.statusCode, body, headers: res.headers })
        }
      })
    }).on('error', reject).end()
  })
}

// ── Fetch with Retry (401 refresh + 429 backoff) ─────────────────────────────
async function fetchWithRetry(path, clientId, clientSecret, accessToken) {
  let token = accessToken || await getSpotifyToken(clientId, clientSecret)

  try {
    return await spotifyApiRequest(path, token)
  } catch (err) {
    if (err.status === 401) {
      if (accessToken && clientId && clientSecret) {
        // OAuth token expired — fall back to client credentials silently
        console.warn('[spotify-api] OAuth token expired, falling back to client credentials')
        tokenCache = null
        token = await getSpotifyToken(clientId, clientSecret)
        path = path.replace('market=from_token', 'market=US')
        return await spotifyApiRequest(path, token)
      }
      if (accessToken) throw new Error("Spotify user token expired — please log in again.")
      tokenCache = null
      token = await getSpotifyToken(clientId, clientSecret)
      path = path.replace('market=from_token', 'market=US')
      return await spotifyApiRequest(path, token)
    }

    if (err.status === 429) {
      const retryAfter = parseInt(err.headers?.['retry-after'] || '3', 10)
      console.warn(`Spotify rate limited. Waiting ${retryAfter}s...`)
      await new Promise(r => setTimeout(r, retryAfter * 1000))
      return await spotifyApiRequest(path, token)
    }

    if (err.status === 404) throw new Error("Spotify item not found. Check the URL.")

    throw new Error(`Spotify API error ${err.status}: ${err.body}`)
  }
}

// ── Pagination Helper ────────────────────────────────────────────────────────
// Collects ALL items across all pages for any Spotify paginated response.
// firstPage must be a Spotify paging object: { items, next, total }
// Works for album tracks (50/page), playlist tracks (100/page), user playlists (50/page).
async function fetchAllPages(firstPage, clientId, clientSecret, accessToken) {
  // Spread into a new array — never mutate the original
  const allItems = [...(firstPage?.items || [])]
  let nextUrl = firstPage?.next || null  // null when no more pages

  while (nextUrl) {
    try {
      const nextPath = nextUrl.replace('https://api.spotify.com', '')
      const page = await fetchWithRetry(nextPath, clientId, clientSecret, accessToken)

      if (page?.items?.length) {
        allItems.push(...page.items)
      }

      nextUrl = page?.next || null
    } catch (err) {
      if (err.message.includes('403')) {
        console.warn('[spotify-api] 403 Forbidden during pagination. Spotify restricts pagination without User OAuth. Returning items fetched so far.')
        break
      }
      throw err
    }
  }

  console.log(`[spotify-api] Pagination complete: fetched ${allItems.length} items total`)
  return allItems
}

// ── Main Metadata Resolver ───────────────────────────────────────────────────
export async function resolveSpotifyMetadata(spotifyUrlString, clientId, clientSecret, accessToken = null) {
  const match = spotifyUrlString.split('?')[0].match(
    /open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/
  )
  if (!match) {
    throw new Error("Invalid Spotify URL. Supported types: track, album, playlist.")
  }

  const type = match[1]
  const id = match[2]

  // ── Track ──────────────────────────────────────────────────────────────────
  if (type === 'track') {
    const track = await fetchWithRetry(`/v1/tracks/${id}`, clientId, clientSecret, accessToken)

    const artist = track.artists?.[0]?.name
    if (!artist) throw new Error(`Could not resolve artist from Spotify API for track: ${id}`)

    return {
      type: 'track',
      title: track.name,
      artist,
      allArtists: track.artists.map(a => a.name).join(', '),
      album: track.album.name,
      year: track.album.release_date?.substring(0, 4) || '',
      trackNumber: track.track_number,
      totalTracks: track.album.total_tracks,
      coverUrl: track.album.images?.[0]?.url || track.album.images?.[1]?.url || null,
      spotifyId: track.id,
      spotifyUrl: `https://open.spotify.com/track/${track.id}`,
      durationMs: track.duration_ms
    }
  }

  // ── Album ──────────────────────────────────────────────────────────────────
  if (type === 'album') {
    // We add market parameter to ensure we get all tracks for the album.
    // Without market, Spotify may return only globally available tracks.
    const marketQuery = accessToken ? '?market=from_token' : '?market=US'; 
    const album = await fetchWithRetry(`/v1/albums/${id}${marketQuery}`, clientId, clientSecret, accessToken)

    const artist = album.artists?.[0]?.name
    if (!artist) throw new Error(`Could not resolve artist from Spotify API for album: ${id}`)

    const albumCover = album.images?.[0]?.url || album.images?.[1]?.url || null
    const albumYear = album.release_date?.substring(0, 4) || ''
    const totalTracks = album.total_tracks

    // Paginate — Spotify returns max 50 tracks per page for albums
    const allTracks = await fetchAllPages(album.tracks, clientId, clientSecret, accessToken)

    if (allTracks.length !== totalTracks) {
      console.warn(`[spotify-api] Album track count mismatch: expected ${totalTracks}, got ${allTracks.length}`)
    }

    return {
      type: 'album',
      title: album.name,
      artist,
      allArtists: album.artists.map(a => a.name).join(', '),
      year: albumYear,
      coverUrl: albumCover,
      trackCount: allTracks.length,
      totalTracks: totalTracks,
      spotifyId: album.id,
      tracks: allTracks.map(track => ({
        trackNumber: track.track_number,
        title: track.name,
        artist: track.artists?.[0]?.name || artist,
        allArtists: track.artists?.map(a => a.name).join(', ') || artist,
        album: album.name,
        year: albumYear,
        coverUrl: albumCover,              // all tracks share the album cover
        spotifyId: track.id,
        spotifyUrl: `https://open.spotify.com/track/${track.id}`,
        durationMs: track.duration_ms,
        totalTracks                           // needed for ID3 TRCK tag (e.g. "3/12")
      }))
    }
  }

  // ── Playlist ───────────────────────────────────────────────────────────────
  if (type === 'playlist') {
    const marketQuery = accessToken ? '?market=from_token' : '?market=US';
    const playlist = await fetchWithRetry(`/v1/playlists/${id}${marketQuery}`, clientId, clientSecret, accessToken)

    // ALWAYS fetch the tracks endpoint directly for reliable pagination!
    // The main playlist object often omits tracks or items.
    let allItems = [];
    let fallbackUsed = false;

    try {
      let firstTracksPage = await fetchWithRetry(`/v1/playlists/${id}/tracks?limit=100${accessToken ? '&market=from_token' : '&market=US'}`, clientId, clientSecret, accessToken)
      allItems = await fetchAllPages(firstTracksPage, clientId, clientSecret, accessToken)
    } catch (err) {
      if (err.message.includes('403')) {
        console.warn('[spotify-api] 403 Forbidden on tracks endpoint. Using spotify-url-info fallback...');
        fallbackUsed = true;
        try {
          const fallbackTracks = await getTracks(spotifyUrlString);
          allItems = fallbackTracks.map(t => ({
            track: {
              type: 'track',
              is_local: false,
              name: t.name,
              artists: [{ name: t.artist }],
              album: { name: 'Unknown', images: [] },
              id: t.uri ? t.uri.split(':').pop() : '',
              duration_ms: t.duration
            }
          }));
        } catch (fallbackErr) {
          console.error('[spotify-api] Fallback scraper failed:', fallbackErr);
          throw new Error('Spotify API restrictions require you to Log In to Spotify (or re-login to update permissions) to read this playlist, and the fallback scraper also failed.')
        }
      } else {
        throw err;
      }
    }

    // Filter out episodes, local files, and null entries (deleted tracks)
    const validTracks = allItems.filter(
      item => item?.track && item.track.type === 'track' && !item.track.is_local
    )

    const trackCount = validTracks.length;
    if (fallbackUsed && trackCount === 100) {
      console.warn('[spotify-api] Only 100 tracks fetched due to fallback.');
    }

    if (allItems.length !== validTracks.length) {
      console.log(`[spotify-api] Filtered out ${allItems.length - validTracks.length} non-track items (episodes/local/deleted)`)
    }

    return {
      type: 'playlist',
      title: playlist.name,
      owner: playlist.owner?.display_name || playlist.owner?.id || 'Unknown',
      coverUrl: playlist.images?.[0]?.url || null,
      trackCount: trackCount,
      totalTracks: playlist.tracks?.total || trackCount,
      spotifyId: playlist.id,
      tracks: validTracks.map((item, index) => {
        const track = item.track
        const tArtist = track.artists?.[0]?.name

        if (!tArtist) {
          console.warn(`[spotify-api] No artist for track ${track.id} — skipping artist field`)
        }

        return {
          trackNumber: index + 1,
          title: track.name,
          artist: tArtist || 'Unknown Artist',
          allArtists: track.artists?.map(a => a.name).join(', ') || tArtist || '',
          album: track.album?.name || '',
          year: track.album?.release_date?.substring(0, 4) || '',
          coverUrl: track.album?.images?.[0]?.url || track.album?.images?.[1]?.url || null,
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