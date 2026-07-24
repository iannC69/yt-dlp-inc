import NodeID3 from 'node-id3';

/**
 * Write accurate Spotify ID3v2 tags to an MP3 file.
 * - Writes all standard fields: title, artist, album artist, album, year, track number
 * - If coverBuffer is provided, embeds it as APIC front cover
 * - If coverBuffer is null/empty but the file already has a cover (e.g. from spotdl),
 *   the existing cover is preserved
 * - Never uses track.title as album fallback (leaves album empty instead)
 * - Verifies tags were written and retries once on failure
 */
export async function writeAndVerifyTags(filePath, tags, coverBuffer) {
  try {
    // 1. Read whatever is already in the file so we can preserve fields we're not overwriting
    let existingTags = {};
    try {
      existingTags = NodeID3.read(filePath) || {};
    } catch (_) {}

    // 2. Build the ID3 tag object with full Spotify metadata
    const id3Tags = {
      // TIT2 — track title
      title:         tags.title  || existingTags.title  || '',
      // TPE1 — lead performer(s)
      artist:        tags.artist || existingTags.artist || '',
      // TPE2 — album artist (all featured artists from Spotify)
      performerInfo: tags.allArtists || tags.artist || existingTags.performerInfo || '',
      // TALB — album name (NEVER fall back to track title — better empty than wrong)
      album:         tags.album  || existingTags.album  || '',
      // TDRC / TYER — year
      year:          tags.year   ? String(tags.year)    : (existingTags.year || ''),
      // TRCK — track number formatted as "x/total"
      trackNumber:   formatTrackNumber(tags.trackNumber, tags.totalTracks, existingTags.trackNumber),
    };

    // 3. Cover art: use Spotify cover if available, otherwise preserve existing
    if (coverBuffer && coverBuffer.length > 1000) {
      id3Tags.image = {
        mime:        'image/jpeg',
        type:        { id: 3, name: 'Front Cover' },
        description: 'Cover',
        imageBuffer: coverBuffer
      };
    } else if (existingTags.image && existingTags.image.imageBuffer && existingTags.image.imageBuffer.length > 1000) {
      // Preserve what spotdl or yt-dlp already embedded
      id3Tags.image = existingTags.image;
    }

    // 4. Write tags (update preserves any non-overlapping frames like lyrics)
    NodeID3.update(id3Tags, filePath);

    // 5. Verification loop — retry once if the write didn't take
    let verified = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const readTags = NodeID3.read(filePath) || {};
        const hasTitle  = !id3Tags.title  || readTags.title  === id3Tags.title;
        const hasArtist = !id3Tags.artist || readTags.artist === id3Tags.artist;
        let   hasImage  = true;
        if (id3Tags.image) {
          hasImage = !!(readTags.image && readTags.image.imageBuffer && readTags.image.imageBuffer.length > 0);
        }
        if (hasTitle && hasArtist && hasImage) {
          verified = true;
          break;
        }
        await new Promise(r => setTimeout(r, 800));
        NodeID3.update(id3Tags, filePath);
      } catch (_verifyErr) {
        await new Promise(r => setTimeout(r, 800));
        NodeID3.update(id3Tags, filePath);
      }
    }

    return { success: verified, file: filePath };
  } catch (e) {
    console.error(`[tags] Error in writeAndVerifyTags for ${filePath}: ${e.message}`);
    return { success: false, file: filePath };
  }
}

/**
 * Formats the track number as "x/total" for TRCK frame.
 * Falls back to existing value or empty string.
 */
function formatTrackNumber(trackNumber, totalTracks, existingTrackNumber) {
  if (!trackNumber) return existingTrackNumber || '';
  const num = String(trackNumber).split('/')[0]; // handle if already formatted
  if (totalTracks) return `${num}/${totalTracks}`;
  return num;
}
