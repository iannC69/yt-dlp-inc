import fetch from 'node-fetch';
async function test() {
  const res = await fetch('https://open.spotify.com/playlist/6gkgc2xiT9xmD14DJGrllv', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  const html = await res.text();
  const matches = html.match(/ab677570[a-zA-Z0-9]+/g);
  console.log("Matches:", matches);
}
test();
