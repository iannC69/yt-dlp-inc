const fs = require('fs');
let code = fs.readFileSync('src/server/configure-routes.js', 'utf8');

const helper = // Helper centralizat
function getExtractorArgs() {
  const poToken = getConfig().youtubePoToken || '';
  return poToken
    ? 'youtube:player_client=ios,mweb;po_token=' + poToken
    : 'youtube:player_client=ios,mweb';
}
;
code = code.replace('const activeJobs    = new Map()', 'const activeJobs    = new Map()\n' + helper);

// Replace inline occurrences
const oldInline1 = getConfig().youtubePoToken ? \youtube:player_client=android,web;po_token=\\ : 'youtube:player_client=android,web';
const oldInline2 = poToken?\youtube:player_client=android,web;po_token=\\:'youtube:player_client=android,web';
const oldInline3 = poToken ? \youtube:player_client=android,web;po_token=\\ : 'youtube:player_client=android,web';

code = code.split(oldInline1).join('getExtractorArgs()');
code = code.split(oldInline2).join('getExtractorArgs()');
code = code.split(oldInline3).join('getExtractorArgs()');

// Replace local poToken assignments safely if needed
code = code.replace(/const poToken\s*=\s*getConfig\(\)\.youtubePoToken\s*\|\|\s*'';\s*const extArgs\s*=\s*poToken\?[^:]+:[^;]+;/g, 'const extArgs=getExtractorArgs();');
code = code.replace(/const poToken=getConfig\(\)\.youtubePoToken\|\|'';const extArgs=getExtractorArgs\(\);/g, 'const extArgs=getExtractorArgs();');

// Add clear cookies route
const clearCookiesRoute = 
  middlewares.use('/api/ytdl/clear-cookies', (req, res, next) => {
    const u = new URL(req.url, \http://\\);
    if (u.pathname !== '/') return next();
    const cp = path.resolve(appDir, 'cookies.txt');
    try {
      if (fs.existsSync(cp)) fs.unlinkSync(cp);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
  });
;

code = code.replace("middlewares.use('/api/ytdl/job-action'", clearCookiesRoute + "\n  middlewares.use('/api/ytdl/job-action'");

fs.writeFileSync('src/server/configure-routes.js', code);
console.log('Update complete');
