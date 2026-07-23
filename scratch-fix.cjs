const fs = require('fs');
let code = fs.readFileSync('src/server/spotify-api.js', 'utf8');
code = code.replace(/headless: true/g, "headless: 'shell'");
fs.writeFileSync('src/server/spotify-api.js', code);
console.log("Replaced!");
