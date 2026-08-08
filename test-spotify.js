import { resolveSpotifyMetadata } from './src/server/spotify-api.js';

async function test() {
  try {
    const md = await resolveSpotifyMetadata('https://open.spotify.com/playlist/37i9dQZF1DX5KpP2LN299J', '71eaf6d9db064a05a8600b17c310d31a', '3d8380457ea54ec3b98e4d8ffa08e5e7');
    console.log(`Playlist totalTracks: ${md.totalTracks}, tracks array length: ${md.tracks.length}`);
  } catch (err) {
    console.error(err);
  }
}
test();
