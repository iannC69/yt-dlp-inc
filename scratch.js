const fetch = require('node-fetch');
async function test() {
  const res = await fetch('https://open.spotify.com/playlist/6gkgc2xiT9xmD14DJGrllv');
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/);
  if (match) {
    const json = JSON.parse(match[1]);
    const entity = json.props.pageProps.state?.data?.entity || json.props.pageProps.entity;
    console.log("SUBTITLE:", entity.subtitle);
    console.log("CREATOR:", JSON.stringify(entity.creator, null, 2));
    console.log("OWNER:", JSON.stringify(entity.owner, null, 2));
    console.log("AUTHORS:", JSON.stringify(entity.authors, null, 2));
    console.log("VISUAL IDENTITY:", JSON.stringify(entity.visualIdentity, null, 2));
  }
}
test();
