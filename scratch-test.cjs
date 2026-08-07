const https = require('https');
https.get('https://www.youtube.com/results?search_query=Drake+channel', res => {
  let s='';
  res.on('data', d=>s+=d);
  res.on('end', () => {
    const m = s.match(/"url"\s*:\s*"(https:\/\/yt3\.ggpht\.com\/[^"]+)"/);
    console.log('Result:', m ? m[1] : 'Not found');
  });
});
