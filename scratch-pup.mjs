import puppeteer from 'puppeteer';
async function test() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const res = await page.goto('https://open.spotify.com/playlist/6gkgc2xiT9xmD14DJGrllv', { waitUntil: 'networkidle2' });
  console.log("URL:", page.url());
  const html = await page.content();
  console.log("Has IANNC?", html.includes('IANNC'));
  const imgs = await page.evaluate(() => Array.from(document.querySelectorAll('img')).map(img => img.src));
  console.log("Images:", imgs);
  await browser.close();
}
test();
