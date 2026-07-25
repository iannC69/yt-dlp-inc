const fs = require('fs');
const filePath = 'src/server/configure-routes.js';
let content = fs.readFileSync(filePath, 'utf8');

// Normalize line endings for easier matching
content = content.replace(/\r\n/g, '\n');

// 1. Add getExtractorArgs helper
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

// 2. Fix buildYtSearchQuery
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
content = content.replace(/const buildYtSearchQuery = \(artist, title, attempt, durationMs\) => \{[\s\S]*?\n\s*\};\n/g, searchFunc + '\n');
content = content.replace(/durationSec - 20/g, 'durationSec - 35').replace(/durationSec \+ 20/g, 'durationSec + 35');

// 3. Remove js-runtimes
content = content.replace(/'--js-runtimes',\s*`node:\$\{process\.execPath\}`,\s*/g, '');
content = content.replace(/--js-runtimes="node:\$\{process\.execPath\}" /g, '');

// 4. Replace extractorArgs everywhere
content = content.replace(/const poToken=getConfig\(\)\.youtubePoToken\|\|'';\s*const extArgs=poToken\?`youtube:player_client=android,web;po_token=\$\{poToken\}`:'youtube:player_client=android,web';/g, 'const extArgs=getExtractorArgs();');
content = content.replace(/const poToken=getConfig\(\)\.youtubePoToken\|\|'';const extArgs=poToken\?`youtube:player_client=android,web;po_token=\$\{poToken\}`:'youtube:player_client=android,web';/g, 'const extArgs=getExtractorArgs();');
content = content.replace(/getConfig\(\)\.youtubePoToken \? `youtube:player_client=android,web;po_token=\$\{getConfig\(\)\.youtubePoToken\}` : 'youtube:player_client=android,web'/g, 'getExtractorArgs()');
content = content.replace(/poToken \? `youtube:player_client=android,web;po_token=\$\{poToken\}` : 'youtube:player_client=android,web'/g, 'getExtractorArgs()');
content = content.replace(/const poToken = getConfig\(\)\.youtubePoToken \|\| '';\n\s*const extractorArgs = poToken \n\s*\? `youtube:player_client=android,web;po_token=\$\{poToken\}` \n\s*: 'youtube:player_client=android,web';/g, 'const extractorArgs = getExtractorArgs();');
content = content.replace(/const poToken = getConfig\(\)\.youtubePoToken \|\| '';\s*const extractorArgs = poToken \s*\? `youtube:player_client=android,web;po_token=\$\{poToken\}` \s*: 'youtube:player_client=android,web';/g, 'const extractorArgs = getExtractorArgs();');
content = content.replace(/const poToken = getConfig\(\)\.youtubePoToken \|\| '';\s*const extractorArgs = poToken \s*\? `ios,mweb;po_token=\$\{poToken\}` \s*: 'ios,mweb';/g, 'const extractorArgs = getExtractorArgs();');

// 5. Apply PREMIUM_SKIP logic

content = content.replace(
  /proc\.on\('close', code => \{\n\s*clearTimeout\(timeoutId\);\n\s*dlState\.procs\.delete\(proc\);\n\s*if \(dlState\.cancelled\) return resolve\(\{ skipped: true \}\);\n\s*if \(code !== 0\) \{/g,
  `proc.on('close', code => {
                clearTimeout(timeoutId);
                dlState.procs.delete(proc);
                if (dlState.cancelled) return resolve({ skipped: true });
                
                // Premium-only pe YouTube Music → sari direct la ytsearch (attempt 3+)
                if (stderr.includes('Music Premium') || stderr.includes('Premium members')) {
                  console.warn(\`[yt-dlp] Premium-only track on YT Music: \${track.title} — switching to ytsearch\`);
                  return resolve({ error: 'PREMIUM_SKIP', trackTitle: track.title });
                }
                
                if (code !== 0) {`
);

content = content.replace(
  /result = await downloadViaYtdlp\(track, trackIndex, currentAttemptForTrack\);\n\s*if \(result\.error\) currentAttemptForTrack\+\+;\n\n\s*if \(!result\.error && !result\.skipped\) \{\n\s*break; \/\/ Success!\n\s*\}/g,
  `result = await downloadViaYtdlp(track, trackIndex, currentAttemptForTrack);
                    
                    // Premium pe YT Music → sari direct la attempt 3 (ytsearch)
                    if (result.error === 'PREMIUM_SKIP') {
                      currentAttemptForTrack = 3;
                      result = await downloadViaYtdlp(track, trackIndex, currentAttemptForTrack);
                      if (!result.error && !result.skipped) break; // Success on attempt 3!
                      currentAttemptForTrack++;
                    } else if (result.error) {
                      currentAttemptForTrack++;
                    }

                    if (!result.error && !result.skipped) {
                      break; // Success!
                    }`
);

fs.writeFileSync(filePath, content, 'utf8');
