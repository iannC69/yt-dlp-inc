import { resolveSpotifyMetadata } from './src/server/spotify-api.js';

const clientId = 'b82d49c670a442e3bcc6b8b0e77d01cd';
const clientSecret = '3f9f70cdbb7c4491ba681b9e2c6dc67b';

async function run() {
  try {
    const data = await resolveSpotifyMetadata('https://open.spotify.com/playlist/6gkgc2xiT9U3S9g76161uC', clientId, clientSecret);
    console.log("SUCCESS");
    console.log(JSON.stringify(data).slice(0, 500));
  } catch(e) {
    console.error("ERROR:", e);
  }
}
run();
