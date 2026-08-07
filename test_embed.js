const url = 'https://open.spotify.com/embed/track/2P4OICZRVAQcYAV2JReAlm';
fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } })
  .then(r => r.text())
  .then(html => {
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
    if(m){
      const j = JSON.parse(m[1]);
      console.log(JSON.stringify(j.props.pageProps, null, 2));
    }
  });
