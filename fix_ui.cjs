const fs = require('fs');
const filePath = 'src/YoutubeDownloader.jsx';

let content = fs.readFileSync(filePath, 'utf8');

const regex = /missingEntries = Array\.from\(selectedTracks\)\s*\.map\(id => info\.playlist\.entries\.find\(e => e\.id === id\)\)/;

if (regex.test(content)) {
  content = content.replace(regex, `missingEntries = Array.from(selectedTracks)\n                   .map(idx => info.playlist.entries.find(e => e.index === idx))`);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Fixed missingEntries logic');
} else {
  console.log('Target regex not found');
}
