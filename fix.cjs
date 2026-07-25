const fs = require('fs');
const filePath = 'src/server/configure-routes.js';
let content = fs.readFileSync(filePath, 'utf8');

const helperCode = `
// Helper centralizat
function getExtractorArgs() {
  const poToken = getConfig().youtubePoToken || '';
  return poToken
    ? 'youtube:player_client=ios,android;po_token=' + poToken
    : 'youtube:player_client=ios,android';
}
`;

if (!content.includes('function getExtractorArgs')) {
  content = content.replace('const activeJobs    = new Map()', `const activeJobs    = new Map()\n${helperCode}`);
}

content = content.replace(/const poToken = getConfig\(\)\.youtubePoToken \|\| '';\s*const extractorArgs = poToken \s*\? `youtube:player_client=[^`]+` \s*: 'youtube:player_client=[^']+';\r?\n?/g, 'const extractorArgs = getExtractorArgs();\n');
content = content.replace(/const poToken = getConfig\(\)\.youtubePoToken \|\| '';\s*const extractorArgs = poToken \s*\? `ios,mweb;po_token=\$\{poToken\}` \s*: 'ios,mweb';\r?\n?/g, 'const extractorArgs = getExtractorArgs();\n');

const searchFunc = `const buildYtSearchQuery = (artist, title, attempt, durationMs) => {
                const cleanTitle = title
                  .replace(/\\s*\\(official.*?\\)/gi, '')
                  .replace(/\\s*\\[official.*?\\]/gi, '')
                  .replace(/\\s*\\(lyric.*?\\)/gi, '')
                  .replace(/\\s*\\(audio.*?\\)/gi, '')
                  .trim();

                if (attempt === 1) return \`ytsearch5:\${artist} \${cleanTitle} audio\`;
                if (attempt === 2) return \`ytsearch5:"\${cleanTitle}" "\${artist}"\`;
                if (attempt === 3) return \`ytsearch5:\${artist} \${cleanTitle}\`;
                return \`ytsearch10:\${cleanTitle} \${artist} lyrics\`;
              };`;

content = content.replace(/const buildYtSearchQuery = \(artist, title, attempt, durationMs\) => \{[\s\S]*?\n\s*\};\r?\n?/g, searchFunc + '\n');
content = content.replace(/durationSec - 20/g, 'durationSec - 35').replace(/durationSec \+ 20/g, 'durationSec + 35');
content = content.replace(/'--js-runtimes',\s*`node:\$\{process\.execPath\}`,\s*/g, '');
content = content.replace(/'--js-runtimes',\s*`node:.*?`,\s*/g, '');

fs.writeFileSync(filePath, content, 'utf8');
