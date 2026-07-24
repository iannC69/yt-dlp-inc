import NodeID3 from 'node-id3';
import https from 'https';
import fs from 'fs';

async function test() {
  const coverUrl = 'https://i.scdn.co/image/ab67616d0000b27329596af4b7261d76329fc5f3';
  const coverBuffer = await new Promise((resolveImg, rejectImg) => {
    https.get(coverUrl, (resImg) => {
      console.log('Status code:', resImg.statusCode);
      const chunks = [];
      resImg.on('data', chunk => chunks.push(chunk));
      resImg.on('end', () => resolveImg(Buffer.concat(chunks)));
    }).on('error', rejectImg);
  });

  console.log('Cover buffer size:', coverBuffer.length);

  const tags = {
    title: 'Test Title',
    artist: 'Test Artist',
    image: {
      mime: 'image/jpeg',
      type: { id: 3, name: 'Front Cover' },
      description: 'Cover',
      imageBuffer: coverBuffer
    }
  };

  // Create an empty MP3 file to test tagging
  const emptyMp3 = Buffer.from([0xFF, 0xFB, 0x90, 0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  fs.writeFileSync('test.mp3', emptyMp3);

  const success = NodeID3.write(tags, 'test.mp3');
  console.log('NodeID3 write success:', success);
  
  const readBack = NodeID3.read('test.mp3');
  console.log('Read back title:', readBack.title);
  console.log('Read back image:', readBack.image ? readBack.image.mime : null);
}

test();
