fetch('https://open.spotify.com/playlist/6gkgc2xiT9xmD14DJGrllv', { 
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' } 
})
.then(r => r.text())
.then(t => { 
  const match = t.match(/<script id="session"[^>]*>(.*?)<\/script>/s); 
  if (match) {
    const data = JSON.parse(match[1]);
    console.log("Token:", data.accessToken); 
  } else {
    console.log('No token found'); 
  }
})
.catch(console.error);
