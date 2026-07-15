const fs = require('fs');
const html = fs.readFileSync('temp.html', 'utf8');
const match = html.match(/"accessToken":"([^"]+)"/);
if (match) {
  console.log('Token found:', match[1].substring(0, 30));
} else {
  console.log('No accessToken string found in HTML');
}
