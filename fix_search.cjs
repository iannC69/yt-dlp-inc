const fs = require('fs');
const filePath = 'src/server/configure-routes.js';
let content = fs.readFileSync(filePath, 'utf8');

const searchFunc = `const buildYtSearchQuery = (artist, title, attempt, durationMs) => {
                const cleanTitle = title
                  .replace(/\\s*\\(official.*?\\)/gi, '')
                  .replace(/\\s*\\[official.*?\\]/gi, '')
                  .replace(/\\s*\\(lyric.*?\\)/gi, '')
                  .replace(/\\s*\\(audio.*?\\)/gi, '')
                  .trim();

                if (attempt === 1) return \`ytsearch5:\${artist} \${cleanTitle} audio\`;
                if (attempt === 2) return \`ytsearch5:"\${cleanTitle}" "\${artist}"\`;
                
                // Păcălim YouTube Premium (jump to attempt 3)
                // Căutăm versiuni fan-made (lyric videos) sau excludem oficialele
                if (attempt === 3) return \`ytsearch5:\${artist} \${cleanTitle} lyric video\`;
                return \`ytsearch10:\${cleanTitle} \${artist} audio -official -topic\`;
              };`;

content = content.replace(/const buildYtSearchQuery = \(artist, title, attempt, durationMs\) => \{[\s\S]*?\n\s*\};\r?\n?/g, searchFunc + '\n');
fs.writeFileSync(filePath, content, 'utf8');
