import { resolveSpotifyMetadata } from './src/server/spotify-api.js';

const clientId = 'YOUR_CLIENT_ID'; // Need to get from localStorage
const clientSecret = 'YOUR_CLIENT_SECRET'; // Need to get from localStorage
const accessToken = 'YOUR_ACCESS_TOKEN'; // Need to get from localStorage

const testUrl = 'https://open.spotify.com/playlist/6gkgc2xiT9xmD14DJGrllv?si=c42abe3251a74b8c';

console.log('Testing URL:', testUrl);
console.log('Extracted ID:', testUrl.match(/playlist\/([a-zA-Z0-9]+)/)?.[1]);

try {
  const result = await resolveSpotifyMetadata(testUrl, clientId, clientSecret, accessToken);
  console.log('Result:', JSON.stringify(result, null, 2));
} catch (error) {
  console.error('Error:', error.message);
}
