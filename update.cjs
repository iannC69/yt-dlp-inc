const fs = require('fs');
let code = fs.readFileSync('src/server/configure-routes.js', 'utf8');

const helper = `// Helper centralizat
function getExtractorArgs() {
  const poToken = getConfig().youtubePoToken || '';
  return poToken
    ? 'youtube:player_client=ios,mweb;po_token=' + poToken
    : 'youtube:player_client=ios,mweb';
}
`;
code = code.replace('const activeJobs    = new Map()', 'const activeJobs    = new Map()\n' + helper);

const str1 = "getConfig().youtubePoToken ? `youtube:player_client=android,web;po_token=${getConfig().youtubePoToken}` : 'youtube:player_client=android,web'";
const str2 = "poToken?`youtube:player_client=android,web;po_token=${poToken}`:'youtube:player_client=android,web'";
const str3 = "poToken ? `youtube:player_client=android,web;po_token=${poToken}` : 'youtube:player_client=android,web'";
const str4 = "youtube:player_client=android,web";

code = code.split(str1).join('getExtractorArgs()');
code = code.split(str2).join('getExtractorArgs()');
code = code.split(str3).join('getExtractorArgs()');
code = code.replace(/const poToken=getConfig\(\)\.youtubePoToken\|\|'';const extArgs=getExtractorArgs\(\);/g, 'const extArgs=getExtractorArgs();');
code = code.replace(/const poToken\s*=\s*getConfig\(\)\.youtubePoToken\s*\|\|\s*'';\s*const extArgs\s*=\s*getExtractorArgs\(\);/g, 'const extArgs=getExtractorArgs();');

const apiRoute = `
  middlewares.use('/api/ytdl/clear-cookies', (req, res, next) => {
    const u = new URL(req.url, \`http://\${req.headers.host}\`);
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
`;
code = code.replace("middlewares.use('/api/ytdl/job-action'", apiRoute + "\n  middlewares.use('/api/ytdl/job-action'");

// Finally, we need to replace str4 in places where they are not caught
code = code.split(str4).join("ios,mweb");

fs.writeFileSync('src/server/configure-routes.js', code);
console.log('Update complete');
