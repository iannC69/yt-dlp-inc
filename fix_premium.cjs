const fs = require('fs');
const filePath = 'src/server/configure-routes.js';
let content = fs.readFileSync(filePath, 'utf8');

const target1 = `              proc.on('close', code => {
                clearTimeout(timeoutId);
                dlState.procs.delete(proc);
                if (dlState.cancelled) return resolve({ skipped: true });
                if (code !== 0) {
                  console.error(\`[yt-dlp] Failed with code \${code} for \${track.title}. stderr: \${stderr}\`);
                  return resolve({ error: \`yt-dlp failed (\${code}): \${stderr.slice(-300)}\`, trackTitle: track.title });
                }`;

const replacement1 = `              proc.on('close', code => {
                clearTimeout(timeoutId);
                dlState.procs.delete(proc);
                if (dlState.cancelled) return resolve({ skipped: true });
                
                // Premium-only pe YouTube Music → sari direct la ytsearch (attempt 3+)
                if (stderr.includes('Music Premium') || stderr.includes('Premium members')) {
                  console.warn(\`[yt-dlp] Premium-only track on YT Music: \${track.title} — switching to ytsearch\`);
                  return resolve({ error: 'PREMIUM_SKIP', trackTitle: track.title });
                }
                
                if (code !== 0) {
                  console.error(\`[yt-dlp] Failed with code \${code} for \${track.title}. stderr: \${stderr}\`);
                  return resolve({ error: \`yt-dlp failed (\${code}): \${stderr.slice(-300)}\`, trackTitle: track.title });
                }`;

content = content.replace(target1, replacement1);

const target2 = `              let result = await downloadViaYtdlp(track, trackIndex, currentAttemptForTrack);

              if (!result.error && !result.skipped) break;

              if (result.error) {
                currentAttemptForTrack++;
              }

              if (result.error && attempts < maxAttempts && !dlState.cancelled) {`;

const replacement2 = `              let result = await downloadViaYtdlp(track, trackIndex, currentAttemptForTrack);

              // Premium pe YT Music → sari direct la attempt 3 (ytsearch)
              if (result.error === 'PREMIUM_SKIP') {
                currentAttemptForTrack = 3;
                result = await downloadViaYtdlp(track, trackIndex, currentAttemptForTrack);
                if (!result.error && !result.skipped) break;
                currentAttemptForTrack++;
              } else if (result.error) {
                currentAttemptForTrack++;
              }

              if (!result.error && !result.skipped) break;

              if (result.error && attempts < maxAttempts && !dlState.cancelled) {`;

content = content.replace(target2, replacement2);

fs.writeFileSync(filePath, content, 'utf8');
