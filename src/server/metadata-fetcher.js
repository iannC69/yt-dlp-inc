/**
 * metadata-fetcher.js
 * Unified metadata aggregator — fetches from multiple sources and merges.
 *
 * Sources:
 *  1. YouTube Data API v3 (via yt-dlp --dump-json)
 *  2. Spotify Web API (track, audio features, album, artist)
 *  3. MusicBrainz (MBID, ISRC, BPM, genre)
 *  4. Last.fm (bio, tags, album cover, wiki)
 *  5. AcoustID (Chromaprint fingerprint + AcoustID lookup)
 *
 * All API calls are gracefully degrading — if any source fails, the rest
 * are still merged using available data.
 */

const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

// ── Environment keys ───────────────────────────────────────────────────────────
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const LASTFM_API_KEY = process.env.LASTFM_API_KEY || '';
const ACOUSTID_API_KEY = process.env.ACOUSTID_API_KEY || '';
const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
const FPCALC_BIN = process.env.FPCALC_BIN || 'fpcalc';

// ── Utility ────────────────────────────────────────────────────────────────────

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          console.log(`[metadata-fetcher] ${url.slice(0, 80)}... → ${Date.now() - start}ms`);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`JSON parse error for ${url}: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

function postJson(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers,
      },
    };

    const req = protocol.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
          console.log(`[metadata-fetcher] POST ${url.slice(0, 80)} → ${Date.now() - start}ms`);
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
    req.write(bodyStr);
    req.end();
  });
}

// ── Spotify token cache ────────────────────────────────────────────────────────
let _spotifyToken = null;
let _spotifyTokenExpiry = 0;

async function getSpotifyClientToken() {
  if (_spotifyToken && Date.now() < _spotifyTokenExpiry - 5000) return _spotifyToken;
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) return null;

  const creds = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await new Promise((resolve, reject) => {
    const body = 'grant_type=client_credentials';
    const options = {
      hostname: 'accounts.spotify.com',
      path: '/api/token',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, r => {
      let d = '';
      r.on('data', c => { d += c; });
      r.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  if (res.access_token) {
    _spotifyToken = res.access_token;
    _spotifyTokenExpiry = Date.now() + (res.expires_in * 1000);
  }
  return _spotifyToken;
}

// ── 1. YouTube Metadata ────────────────────────────────────────────────────────

/**
 * Fetch metadata for a YouTube video using yt-dlp --dump-json
 * Optionally enriches with YouTube Data API v3 if key is available.
 * @param {string} videoIdOrUrl - YouTube video ID or URL
 * @returns {Promise<Object>}
 */
async function fetchYoutubeMetadata(videoIdOrUrl) {
  const url = videoIdOrUrl.startsWith('http') ? videoIdOrUrl : `https://www.youtube.com/watch?v=${videoIdOrUrl}`;

  return new Promise((resolve) => {
    const proc = spawn(YTDLP_BIN, ['--dump-json', '--no-playlist', url]);
    let raw = '';
    let errRaw = '';
    proc.stdout.on('data', chunk => { raw += chunk; });
    proc.stderr.on('data', chunk => { errRaw += chunk; });
    proc.on('close', code => {
      try {
        const info = JSON.parse(raw);
        const metadata = {
          title: info.title,
          artist: info.uploader || info.channel,
          uploader: info.uploader,
          channel: info.channel,
          channelId: info.channel_id,
          duration: info.duration,
          thumbnail: info.thumbnail,
          thumbnails: info.thumbnails,
          viewCount: info.view_count,
          likeCount: info.like_count,
          uploadDate: info.upload_date,
          description: info.description,
          tags: info.tags || [],
          categories: info.categories || [],
          videoId: info.id,
          url: info.webpage_url,
          source: 'youtube',
        };

        // Optionally enrich with YouTube Data API
        if (YOUTUBE_API_KEY && info.id) {
          const apiUrl = `https://www.googleapis.com/youtube/v3/videos?id=${info.id}&part=snippet,statistics,contentDetails&key=${YOUTUBE_API_KEY}`;
          fetchJson(apiUrl)
            .then(apiData => {
              const item = apiData.items?.[0];
              if (item) {
                metadata.youtubeDescription = item.snippet?.description;
                metadata.youtubeTags = item.snippet?.tags || [];
                metadata.youtubeCategories = [item.snippet?.categoryId];
                metadata.statistics = item.statistics;
                metadata.contentDetails = item.contentDetails;
              }
              resolve(metadata);
            })
            .catch(() => resolve(metadata));
        } else {
          resolve(metadata);
        }
      } catch {
        resolve({ error: 'Failed to parse yt-dlp output', raw: errRaw });
      }
    });
  });
}

// ── 2. Spotify Metadata ────────────────────────────────────────────────────────

/**
 * Fetch Spotify metadata for a track/album/artist.
 * @param {string} idOrUrl - Spotify track/album/artist ID or URL
 * @param {'track'|'album'|'artist'|'playlist'} type
 * @param {string} [accessToken] - User access token (optional, falls back to client token)
 * @returns {Promise<Object>}
 */
async function fetchSpotifyMetadata(idOrUrl, type = 'track', accessToken = null) {
  const token = accessToken || await getSpotifyClientToken();
  if (!token) return { error: 'No Spotify token available' };

  // Extract ID from URL if needed
  let id = idOrUrl;
  const urlMatch = idOrUrl.match(/spotify\.com\/(track|album|artist|playlist)\/([a-zA-Z0-9]+)/);
  if (urlMatch) {
    type = urlMatch[1];
    id = urlMatch[2];
  }

  const headers = { headers: { 'Authorization': `Bearer ${token}` } };

  try {
    const base = await fetchJson(`https://api.spotify.com/v1/${type}s/${id}`, headers);

    const metadata = {
      title: base.name,
      artist: base.artists?.[0]?.name || base.name,
      artists: base.artists || [],
      album: base.album?.name || base.name,
      albumId: base.album?.id || base.id,
      releaseDate: base.release_date || base.album?.release_date,
      trackNumber: base.track_number,
      discNumber: base.disc_number,
      durationMs: base.duration_ms,
      isExplicit: base.explicit,
      popularity: base.popularity,
      spotifyId: base.id,
      spotifyUrl: base.external_urls?.spotify,
      isrc: base.external_ids?.isrc,
      type: type,
      source: 'spotify',
    };

    // Cover art (highest res)
    const images = base.images || base.album?.images || [];
    if (images.length > 0) {
      images.sort((a, b) => (b.width || 0) - (a.width || 0));
      metadata.coverUrl = images[0].url;
      metadata.thumbnail = images[0].url;
    }

    // Audio features (only for tracks)
    if (type === 'track') {
      try {
        const features = await fetchJson(`https://api.spotify.com/v1/audio-features/${id}`, headers);
        metadata.bpm = features.tempo;
        metadata.key = features.key;
        metadata.mode = features.mode;
        metadata.energy = features.energy;
        metadata.danceability = features.danceability;
        metadata.valence = features.valence;
        metadata.acousticness = features.acousticness;
        metadata.loudness = features.loudness;
        metadata.timeSignature = features.time_signature;
      } catch { }
    }

    // Artist info
    if (base.artists?.[0]?.id) {
      try {
        const artistData = await fetchJson(`https://api.spotify.com/v1/artists/${base.artists[0].id}`, headers);
        metadata.artistGenres = artistData.genres || [];
        metadata.artistPopularity = artistData.popularity;
        if (artistData.images?.length > 0) {
          metadata.artistThumbnail = artistData.images[0].url;
        }
      } catch { }
    }

    return metadata;
  } catch (err) {
    return { error: `Spotify metadata fetch failed: ${err.message}` };
  }
}

// ── 3. MusicBrainz Metadata ───────────────────────────────────────────────────

/**
 * Search MusicBrainz for a recording and return MBID, ISRC, genres.
 * @param {string} artist
 * @param {string} title
 * @returns {Promise<Object>}
 */
async function fetchMusicBrainz(artist, title) {
  if (!artist || !title) return {};

  const query = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
  const url = `https://musicbrainz.org/ws/2/recording/?query=${query}&limit=5&fmt=json`;

  try {
    const data = await fetchJson(url, {
      headers: { 'User-Agent': 'MediaDL/1.0 (mediadl@localhost)' }
    });

    const rec = data.recordings?.[0];
    if (!rec) return {};

    return {
      mbid: rec.id,
      isrc: rec.isrcs?.[0] || null,
      disambiguation: rec.disambiguation,
      releases: rec.releases?.map(r => ({
        id: r.id,
        title: r.title,
        date: r.date,
        country: r['release-country'],
      })) || [],
      source: 'musicbrainz',
    };
  } catch (err) {
    console.warn('[metadata-fetcher] MusicBrainz failed:', err.message);
    return {};
  }
}

// ── 4. Last.fm Metadata ───────────────────────────────────────────────────────

/**
 * Fetch Last.fm metadata for artist/track — bio, tags, wiki.
 * @param {string} artist
 * @param {string} title
 * @returns {Promise<Object>}
 */
async function fetchLastfm(artist, title) {
  if (!LASTFM_API_KEY || !artist || !title) return {};

  const encodedArtist = encodeURIComponent(artist);
  const encodedTitle = encodeURIComponent(title);
  const url = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${LASTFM_API_KEY}&artist=${encodedArtist}&track=${encodedTitle}&format=json`;

  try {
    const data = await fetchJson(url);
    const track = data.track;
    if (!track) return {};

    return {
      lastfmUrl: track.url,
      listeners: parseInt(track.listeners, 10),
      playcount: parseInt(track.playcount, 10),
      tags: track.toptags?.tag?.map(t => t.name) || [],
      wikiSummary: track.wiki?.summary?.replace(/<[^>]*>/g, '').trim() || null,
      albumCoverUrl: track.album?.image?.find(i => i.size === 'extralarge')?.['#text'] || null,
      source: 'lastfm',
    };
  } catch (err) {
    console.warn('[metadata-fetcher] Last.fm failed:', err.message);
    return {};
  }
}

// ── 5. AcoustID / Chromaprint ─────────────────────────────────────────────────

/**
 * Generate an AcoustID fingerprint for a local audio file and query AcoustID.
 * Requires fpcalc (Chromaprint) to be installed.
 * @param {string} filePath - Absolute path to audio file
 * @returns {Promise<Object>}
 */
async function fetchAcoustId(filePath) {
  if (!ACOUSTID_API_KEY) return {};

  const { fingerprint, duration } = await _generateFingerprint(filePath);
  if (!fingerprint || !duration) return {};

  const url = `https://api.acoustid.org/v2/lookup?client=${ACOUSTID_API_KEY}&duration=${duration}&fingerprint=${fingerprint}&meta=recordings+releasegroups+releases+tracks+sources+compress`;

  try {
    const data = await fetchJson(url);
    const result = data.results?.[0];
    if (!result) return {};

    const recording = result.recordings?.[0];
    return {
      acoustId: result.id,
      acoustIdScore: result.score,
      mbid: recording?.id,
      title: recording?.title,
      artists: recording?.artists?.map(a => a.name) || [],
      releaseGroups: recording?.releasegroups?.map(rg => ({
        id: rg.id,
        title: rg.title,
        type: rg.type,
      })) || [],
      source: 'acoustid',
    };
  } catch (err) {
    console.warn('[metadata-fetcher] AcoustID failed:', err.message);
    return {};
  }
}

function _generateFingerprint(filePath) {
  return new Promise((resolve) => {
    const proc = spawn(FPCALC_BIN, ['-json', filePath]);
    let raw = '';
    proc.stdout.on('data', chunk => { raw += chunk; });
    proc.on('close', code => {
      if (code !== 0) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        resolve({ fingerprint: parsed.fingerprint, duration: Math.round(parsed.duration) });
      } catch {
        resolve({});
      }
    });
    proc.on('error', () => resolve({}));
  });
}

// ── Merge ──────────────────────────────────────────────────────────────────────

/**
 * Merge metadata from multiple sources using priority order:
 * Spotify > YouTube > AcoustID > MusicBrainz > Last.fm
 * @param {Object[]} sources - Array of metadata objects
 * @returns {Object} merged metadata
 */
function mergeMetadata(sources) {
  const merged = {};

  const pick = (key, ...fallbacks) => {
    for (const src of sources) {
      if (src && src[key] !== undefined && src[key] !== null && src[key] !== '') {
        return src[key];
      }
    }
    for (const fb of fallbacks) {
      if (fb !== undefined && fb !== null && fb !== '') return fb;
    }
    return null;
  };

  merged.title        = pick('title');
  merged.artist       = pick('artist');
  merged.artists      = pick('artists') || [];
  merged.album        = pick('album');
  merged.albumId      = pick('albumId');
  merged.releaseDate  = pick('releaseDate');
  merged.trackNumber  = pick('trackNumber');
  merged.discNumber   = pick('discNumber');
  merged.durationMs   = pick('durationMs');
  merged.duration     = pick('duration');
  merged.isExplicit   = pick('isExplicit');
  merged.popularity   = pick('popularity');
  merged.spotifyId    = pick('spotifyId');
  merged.spotifyUrl   = pick('spotifyUrl');
  merged.isrc         = pick('isrc');
  merged.mbid         = pick('mbid');
  merged.acoustId     = pick('acoustId');
  merged.bpm          = pick('bpm');
  merged.key          = pick('key');
  merged.energy       = pick('energy');
  merged.danceability = pick('danceability');
  merged.valence      = pick('valence');
  merged.coverUrl     = pick('coverUrl', pick('thumbnail'), pick('albumCoverUrl'));
  merged.thumbnail    = merged.coverUrl;
  merged.artistThumbnail = pick('artistThumbnail');
  merged.genres       = pick('artistGenres') || pick('tags') || [];
  merged.tags         = pick('tags') || pick('youtubeTags') || [];
  merged.wikiSummary  = pick('wikiSummary') || pick('description');
  merged.listeners    = pick('listeners');
  merged.videoId      = pick('videoId');
  merged.channelId    = pick('channelId');

  // Collect all sources used
  merged._sources = sources.filter(s => s && !s.error).map(s => s.source).filter(Boolean);

  return merged;
}

module.exports = {
  fetchYoutubeMetadata,
  fetchSpotifyMetadata,
  fetchMusicBrainz,
  fetchLastfm,
  fetchAcoustId,
  mergeMetadata,
};
