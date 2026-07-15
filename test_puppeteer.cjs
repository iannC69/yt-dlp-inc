const puppeteer = require('puppeteer');

(async () => {
  try {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.goto('https://open.spotify.com/playlist/6gkgc2xiT9xmD14DJGrllv', { waitUntil: 'domcontentloaded' });
    
    // Evaluate in browser context to get the token
    const token = await page.evaluate(() => {
      const script = document.getElementById('session');
      if (script) {
        try {
          const data = JSON.parse(script.textContent);
          return data.accessToken;
        } catch(e){}
      }
      return null;
    });
    
    console.log('Token:', token);
    await browser.close();
  } catch (err) {
    console.error('Puppeteer error:', err);
  }
})();
