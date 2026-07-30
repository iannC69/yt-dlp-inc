const titles = [
  'The Weeknd - Blinding Lights (Official Audio)',
  'Justin Bieber - Confident (Single Version)',
  'Queen - Bohemian Rhapsody (Official Video)'
];
async function test() {
  for (let title of titles) {
    let clean = title.replace(/[\(\[].*?(official|video|audio|lyric|live|remix).*?[\)\]]/ig, '').replace(/-|\/|\|/g, ' ').replace(/\s+/g, ' ').trim();
    let query = encodeURIComponent((clean).substring(0, 50));
    let url = `https://itunes.apple.com/search?term=${query}&entity=song&limit=1`;
    let res = await fetch(url).then(r => r.json());
    console.log(title, '->', clean, '->', res.results?.[0]?.collectionName || 'NOT FOUND');
  }
}
test();
