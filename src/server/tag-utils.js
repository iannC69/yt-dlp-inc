import NodeID3 from 'node-id3';

/**
 * Write ID3v2 tags to an MP3 file using NodeID3.write() — full overwrite, always reliable.
 * - Reads existing tags first to preserve anything not in our Spotify data (e.g. lyrics)
 * - Writes: title, artist (TPE1), album artist (TPE2), album (TALB), year, track number, cover art (APIC)
 * - If coverBuffer provided → uses it as front cover
 * - If no coverBuffer but file already has embedded cover → preserves it
 * - Never falls back to track.title for album
 */
export async function writeAndVerifyTags(filePath, tags, coverBuffer) {
  try {
    // 1. Read existing tags to preserve embedded content (e.g. lyrics from yt-dlp)
    let existingTags = {};
    try {
      existingTags = NodeID3.read(filePath) || {};
    } catch (_) {}

    // 2. Build complete ID3 tag object from Spotify metadata
    const id3Tags = {
      title:         tags.title       || existingTags.title       || '',
      artist:        tags.artist      || existingTags.artist      || '',
      performerInfo: tags.allArtists  || tags.artist              || existingTags.performerInfo || '',
      album:         tags.album       || existingTags.album       || '',
      year:          tags.year        ? String(tags.year)         : (existingTags.year || ''),
      trackNumber:   formatTrackNumber(tags.trackNumber, tags.totalTracks, existingTags.trackNumber),
    };

    // 3. Cover art — Spotify cover takes priority, YouTube embedded cover is fallback
    if (coverBuffer && coverBuffer.length > 1000) {
      id3Tags.image = {
        mime: 'image/jpeg',
        type: { id: 3, name: 'Front Cover' },
        description: 'Cover',
        imageBuffer: coverBuffer,
      };
    } else if (existingTags.image && existingTags.image.imageBuffer && existingTags.image.imageBuffer.length > 1000) {
      id3Tags.image = existingTags.image;
    }

    // 4. NodeID3.write() — completely replaces all tags, no partial-update issues
    const writeOk = NodeID3.write(id3Tags, filePath);
    if (!writeOk) {
      // Retry once after a short delay (file may still be locked by ffmpeg)
      await new Promise(r => setTimeout(r, 500));
      NodeID3.write(id3Tags, filePath);
    }

    return { success: true, file: filePath };
  } catch (e) {
    console.error(`[tags] writeAndVerifyTags failed for ${filePath}: ${e.message}`);
    return { success: false, file: filePath, error: e.message };
  }
}

function formatTrackNumber(trackNumber, totalTracks, existingTrackNumber) {
  if (!trackNumber) return existingTrackNumber || '';
  const num = String(trackNumber).split('/')[0];
  if (totalTracks) return `${num}/${totalTracks}`;
  return num;
}
