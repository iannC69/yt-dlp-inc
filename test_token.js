const url = 'https://open.spotify.com/playlist/6gkgc2xiT9xmD14DJGrllv';
fetch(url).then(r => r.text()).then(html => {
  const match = html.match(/accessToken":"([^"]+)"/);
  if(match) console.log('Token:', match[1].substring(0, 30));
  else console.log('No token');
});
