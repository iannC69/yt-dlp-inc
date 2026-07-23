import fetch from 'node-fetch';
async function test() {
  const res = await fetch('https://open.spotify.com/embed/playlist/6gkgc2xiT9xmD14DJGrllv', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/);
  if (match) {
    const json = JSON.parse(match[1]);
    const entity = json.props.pageProps.state?.data?.entity || json.props.pageProps.entity;
    console.log(JSON.stringify(entity, null, 2));
  }
}
test();
