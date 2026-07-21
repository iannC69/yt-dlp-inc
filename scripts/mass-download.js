import { spawn } from 'child_process';

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || ''; // Optional: Add your client ID
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || ''; // Optional: Add your client secret

/**
 * Strips query params (like ?si=...) and extracts the playlist ID
 */
function extractPlaylistId(url) {
  const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Gets a temporary access token using Client Credentials Flow
 */
async function getAccessToken() {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error('Spotify credentials not provided. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET env variables.');
  }
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
    },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) throw new Error('Failed to get Spotify token');
  const data = await res.json();
  return data.access_token;
}

/**
 * Fetches all tracks from a Spotify Playlist using pagination
 */
async function fetchAllPlaylistTracks(playlistId, token) {
  let allTracks = [];
  let nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;

  while (nextUrl) {
    console.log(`Fetching page... (${allTracks.length} tracks so far)`);
    const res = await fetch(nextUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) {
      if (res.status === 403) throw new Error('403 Forbidden: Playlist might be private.');
      throw new Error(`Spotify API error: ${res.statusText}`);
    }

    const data = await res.json();
    
    // Extract metadata (Artist Name - Track Title)
    const tracks = data.items
      .map(item => item.track)
      .filter(track => track && track.name) // Filter out null/local tracks
      .map(track => {
        const artistName = track.artists.map(a => a.name).join(', ');
        return {
          title: track.name,
          artist: artistName,
          query: `${artistName} - ${track.name}`,
          durationMs: track.duration_ms
        };
      });

    allTracks.push(...tracks);
    nextUrl = data.next; // URL for the next page, or null if done
  }

  return allTracks;
}

/**
 * Downloads a track using yt-dlp's ytsearch
 */
function downloadTrack(track) {
  return new Promise((resolve, reject) => {
    console.log(`\nStarting download: ${track.query}`);
    
    // Use ytsearch1: to grab the first YouTube result matching the artist & title
    const searchStr = `ytsearch1:${track.query}`;
    
    const proc = spawn('yt-dlp', [
      searchStr,
      '-x', // Extract audio
      '--audio-format', 'mp3',
      '--audio-quality', '0', // Best quality
      '-o', `downloads/%(title)s.%(ext)s`, // Save to downloads folder
      '--no-playlist'
    ], { stdio: 'inherit' }); // pipe output directly to console

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Finished: ${track.query}`);
        resolve();
      } else {
        console.error(`❌ Failed (code ${code}): ${track.query}`);
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      console.error(`❌ Spawn error: ${err.message}`);
      reject(err);
    });
  });
}

/**
 * Main execution script
 */
async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node mass-download.js <spotify_playlist_url>');
    process.exit(1);
  }

  const playlistId = extractPlaylistId(url);
  if (!playlistId) {
    console.error('Invalid Spotify Playlist URL');
    process.exit(1);
  }

  try {
    console.log(`Authenticating with Spotify...`);
    const token = await getAccessToken();

    console.log(`Fetching playlist ${playlistId}...`);
    const tracks = await fetchAllPlaylistTracks(playlistId, token);
    
    console.log(`\nSuccessfully fetched ${tracks.length} tracks metadata. Beginning downloads...\n`);

    // Download sequentially to avoid rate-limiting/CPU overload
    // (You can use Promise.all with chunking for parallel downloads)
    for (let i = 0; i < tracks.length; i++) {
      console.log(`[Track ${i + 1}/${tracks.length}]`);
      try {
        await downloadTrack(tracks[i]);
      } catch (err) {
        console.error(`Skipping track due to error.`);
      }
    }

    console.log('\n🎉 All downloads completed!');
  } catch (err) {
    console.error(`\nFatal Error: ${err.message}`);
  }
}

main();
