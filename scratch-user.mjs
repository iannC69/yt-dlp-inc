import fetch from 'node-fetch';
async function test() {
  const res = await fetch('https://open.spotify.com/user/IANNC');
  console.log("Status:", res.status);
  const html = await res.text();
  const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/);
  console.log("OG Image:", ogImage?.[1]);
}
test();
