import fs from 'fs';
fetch('https://open.spotify.com/playlist/6gkgc2xiT9xmD14DJGrllv', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36)'
  }
})
  .then(r => r.text())
  .then(html => fs.writeFileSync('spotify_dump.html', html))
  .catch(err => console.error(err));
