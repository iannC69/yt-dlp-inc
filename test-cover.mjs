/**
 * Standalone test: fetch YT Music thumbnail → convert to JPEG via ffmpeg → embed in MP3
 * Run: node test-cover.mjs
 */
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import NodeID3 from 'node-id3';

const ffmpegBin = './bin/ffmpeg.exe';
// A real YT Music playlist thumbnail URL
const thumbnailUrl = 'https://lh3.googleusercontent.com/FMBG0P9rkS5TfCBJV6m9j2CKjkRi8Fq4rrFJnvLx5F4K_x3QzBl6-dE2ZA8JwQOKYqtVwZLHoUPEg=w226-h226-l90-rj';
const testMp3 = './test-cover-out.mp3';

// Create a tiny valid MP3 (just ID3 header, enough to test tag writing)
const minimalMp3 = Buffer.from([
  0xFF, 0xFB, 0x90, 0x00, // MPEG frame sync
  ...new Array(200).fill(0x00) // silent padding
]);
fs.writeFileSync(testMp3, minimalMp3);

console.log('1. ffmpegBin exists?', fs.existsSync(ffmpegBin));
console.log('2. NodeID3 version:', typeof NodeID3.write);

// Step 1: fetch thumbnail
const fetchThumb = (url) => new Promise((resolve, reject) => {
  const mod = url.startsWith('https') ? https : http;
  mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => {
    if ((r.statusCode === 301 || r.statusCode === 302) && r.headers.location) {
      return resolve(fetchThumb(r.headers.location));
    }
    console.log('  HTTP status:', r.statusCode, 'Content-Type:', r.headers['content-type']);
    const chunks = [];
    r.on('data', c => chunks.push(c));
    r.on('end', () => resolve(Buffer.concat(chunks)));
  }).on('error', reject);
});

console.log('\n3. Fetching thumbnail...');
const tbuf = await fetchThumb(thumbnailUrl);
console.log('   Downloaded buffer size:', tbuf.length, 'bytes');
console.log('   First 4 bytes (hex):', tbuf.slice(0, 4).toString('hex'));
// WebP magic: 52494646, JPEG magic: ffd8
fs.writeFileSync('./test-thumb-raw', tbuf);
console.log('   Saved raw to test-thumb-raw');

// Step 2: convert with ffmpeg
console.log('\n4. Converting with ffmpeg...');
const tempImg = testMp3 + '.jpg';
const result = spawnSync(ffmpegBin, [
  '-y',
  '-i', 'pipe:0',
  '-vf', 'crop=min(iw\\,ih):min(iw\\,ih)',
  tempImg
], { input: tbuf });

console.log('   ffmpeg exit code:', result.status);
if (result.error) console.log('   ffmpeg spawn error:', result.error.message);
const errOutput = result.stderr?.toString();
// Show last few lines of stderr
const errLines = errOutput.split('\n').slice(-10).join('\n');
console.log('   ffmpeg stderr (last 10 lines):\n', errLines);
console.log('   tempImg exists?', fs.existsSync(tempImg), fs.existsSync(tempImg) ? 'size=' + fs.statSync(tempImg).size : '');

// Step 3: write ID3
if (fs.existsSync(tempImg) && fs.statSync(tempImg).size > 0) {
  console.log('\n5. Writing ID3 tags with image path...');
  const tags = {
    title: 'Test Track',
    artist: 'Test Artist',
    album: 'Test Album',
    image: tempImg, // NodeID3 accepts a file path
  };
  const writeResult = NodeID3.write(tags, testMp3);
  console.log('   NodeID3.write result:', writeResult);
  
  // Read back to verify
  const readBack = NodeID3.read(testMp3);
  console.log('   Read back image?', !!readBack.image, readBack.image ? 'mime=' + readBack.image.mime + ' size=' + readBack.image.imageBuffer?.length : '');
  console.log('   Read back title:', readBack.title);
  
  // Clean up temp
  fs.unlinkSync(tempImg);
} else {
  console.log('\n5. SKIPPED - ffmpeg failed to produce a jpg');
}

console.log('\n--- Output file:', testMp3, 'size:', fs.statSync(testMp3).size, 'bytes');
console.log('Done.');
