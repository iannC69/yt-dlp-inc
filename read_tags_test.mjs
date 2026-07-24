import NodeID3 from 'node-id3';

const filePath = 'spotdl_test.mp3/Rick Astley - Never Gonna Give You Up.mp3';
const tags = NodeID3.read(filePath);
console.log('Has image?', !!tags.image);
if (tags.image) {
  console.log('Image mime:', tags.image.mime);
  console.log('Image buffer size:', tags.image.imageBuffer.length);
}
console.log('Title:', tags.title);
console.log('Artist:', tags.artist);
console.log('Album:', tags.album);

// Simulate what our server code does:
const newTags = {
  ...tags,
  title: 'Test Override Title',
  album: undefined, // Simulating missing track.album!
  artist: 'Test Override Artist'
};
delete newTags.comment;
delete newTags.userDefinedUrl;
delete newTags.description;

console.log('Writing back...');
NodeID3.write(newTags, filePath);

const readBack = NodeID3.read(filePath);
console.log('Read back album:', readBack.album);
console.log('Read back artist:', readBack.artist);
console.log('Read back title:', readBack.title);
console.log('Has image now?', !!readBack.image);

