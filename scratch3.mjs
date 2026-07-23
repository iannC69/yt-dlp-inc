import { getAnonymousSpotifyToken } from './src/server/spotify-api.js';
import fetch from 'node-fetch';
async function test() {
  const token = await getAnonymousSpotifyToken();
  const res = await fetch('https://api.spotify.com/v1/playlists/37i9dQZF1DXcBWIGoYBM5M', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  console.log("OWNER:", JSON.stringify(data.owner, null, 2));
}
test();
