import puppeteer from 'puppeteer';
async function test() {
  const start = Date.now();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('https://open.spotify.com/playlist/6gkgc2xiT9xmD14DJGrllv', { waitUntil: 'domcontentloaded' });
  const imgs = await page.evaluate(() => Array.from(document.querySelectorAll('img')).map(img => img.src));
  console.log("Images:", imgs.filter(src => src.includes('ab677570')));
  await browser.close();
  console.log("Time:", Date.now() - start, "ms");
}
test();
