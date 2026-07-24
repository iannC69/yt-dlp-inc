import NodeID3 from 'node-id3';

export async function writeAndVerifyTags(filePath, tags, coverBuffer) {
  try {
    // 1. Build the full Spotify text tags
    const id3Tags = {
      title: tags.title || '',
      artist: tags.artist || '',
      album: tags.album || '',
      year: tags.year ? String(tags.year) : '',
      trackNumber: tags.trackNumber || '',
      performerInfo: tags.artist || ''
    };

    // 2. Add cover art if we have it
    if (coverBuffer && coverBuffer.length > 1000) {
      id3Tags.image = {
        mime: 'image/jpeg',
        type: { id: 3, name: 'Front Cover' },
        description: 'Cover',
        imageBuffer: coverBuffer
      };
    }

    // 3. Write tags using NodeID3.update (to preserve lyrics, etc.)
    NodeID3.update(id3Tags, filePath);

    // 4. Verification loop
    let verified = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const readTags = NodeID3.read(filePath) || {};
        
        // Basic verification: title and artist should match if we provided them
        const hasTitle = !id3Tags.title || (readTags.title && readTags.title === id3Tags.title);
        const hasArtist = !id3Tags.artist || (readTags.artist && readTags.artist === id3Tags.artist);
        
        // Image verification: if we provided a cover, we should see it
        let hasImage = true;
        if (coverBuffer && coverBuffer.length > 1000) {
           hasImage = readTags.image && readTags.image.imageBuffer && readTags.image.imageBuffer.length > 0;
        }

        if (hasTitle && hasArtist && hasImage) {
          verified = true;
          break; // Success
        }

        // Verification failed, wait a bit and retry the write
        await new Promise(r => setTimeout(r, 1000));
        NodeID3.update(id3Tags, filePath);
      } catch (verifyErr) {
        // Read failed, wait and retry
        await new Promise(r => setTimeout(r, 1000));
        NodeID3.update(id3Tags, filePath);
      }
    }

    return { success: verified, file: filePath };
  } catch (e) {
    console.error(`[tags] Error in writeAndVerifyTags for ${filePath}: ${e.message}`);
    return { success: false, file: filePath };
  }
}
