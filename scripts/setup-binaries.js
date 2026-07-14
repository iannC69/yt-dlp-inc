import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const binDir = path.resolve(__dirname, '..', 'bin');
const ytDlpPath = path.join(binDir, 'yt-dlp.exe');
const YT_DLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';

if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url}...`);
    const file = fs.createWriteStream(dest);
    
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
      }

      response.pipe(file);
      
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

async function setup() {
  try {
    if (fs.existsSync(ytDlpPath)) {
      console.log('✅ yt-dlp.exe is already installed.');
    } else {
      console.log('⏳ Downloading yt-dlp.exe...');
      await downloadFile(YT_DLP_URL, ytDlpPath);
      console.log('✅ yt-dlp.exe downloaded successfully!');
    }
    console.log('🎉 Setup complete!');
  } catch (error) {
    console.error('❌ Failed to download yt-dlp.exe:', error.message);
    process.exit(1);
  }
}

setup();
