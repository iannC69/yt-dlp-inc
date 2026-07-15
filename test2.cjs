const { getSpotifyToken } = require('./src/server/spotify-api.js'); 
const https = require('https'); 
getSpotifyToken('71eaf6d9db064a05a8600b17c310d31a', '3d8380457ea54ec3b98e4d8ffa08e5e7')
.then(token => { 
  https.request('https://api.spotify.com/v1/playlists/6gkgc2xiT9xmD14DJGrllv?market=US', { 
    headers: { 'Authorization': 'Bearer ' + token } 
  }, res => { 
    let b=''; 
    res.on('data', c=>b+=c); 
    res.on('end', ()=> {
      const p = JSON.parse(b);
      console.log('Playlist keys:', Object.keys(p));
      if (p.tracks) console.log('Tracks total:', p.tracks.total);
    }) 
  }).end(); 
}).catch(console.error)
