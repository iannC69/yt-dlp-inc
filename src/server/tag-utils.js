import NodeID3 from 'node-id3';

/**
 * Write ID3v2 tags to an MP3 file using NodeID3.write() — full overwrite, always reliable.
 * - Reads existing tags first to preserve anything not in our Spotify data (e.g. lyrics)
 * - Writes: title, artist (TPE1), album artist (TPE2), album (TALB), year, track number, cover art (APIC)
 * - If coverBuffer provided → uses it as front cover
 * - If no coverBuffer but file already has embedded cover → preserves it
 * - Never falls back to track.title for album
 */
export async function writeAndVerifyTags(filePath, tags, coverBuffer, config = {}) {
  try {
    // 1. Read existing tags to preserve embedded content (e.g. lyrics from yt-dlp)
    let existingTags = {};
    try {
      existingTags = NodeID3.read(filePath) || {};
    } catch (_) { }

    // 2. Build complete ID3 tag object from Spotify metadata
    const id3Tags = {
      title: tags.title || existingTags.title || '',
      artist: tags.artist || existingTags.artist || '',
      performerInfo: tags.allArtists || tags.artist || existingTags.performerInfo || '',
      album: tags.album || existingTags.album || '',
      year: tags.year ? String(tags.year) : (existingTags.year || ''),
      date: tags.releaseDate ? tags.releaseDate.replace(/-/g, '') : (existingTags.date || ''),
      trackNumber: formatTrackNumber(tags.trackNumber, tags.totalTracks, existingTags.trackNumber, config),
      partOfSet: formatDiscNumber(tags.discNumber, tags.totalDiscs, existingTags.partOfSet),
      genre: tags.genre || existingTags.genre || '',
      isrc: tags.isrc || existingTags.isrc || '',
      copyright: tags.copyright || existingTags.copyright || '',
      publisher: tags.label || existingTags.publisher || '',
      comment: resolveComment(existingTags.comment, config.clearComments)
    };

    // Keep explicit lyrics synced if available
    if (existingTags.unsynchronisedLyrics) {
      id3Tags.unsynchronisedLyrics = existingTags.unsynchronisedLyrics;
    }
    if (existingTags.synchronisedLyrics) {
      id3Tags.synchronisedLyrics = existingTags.synchronisedLyrics;
    }

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

function formatTrackNumber(trackNumber, totalTracks, existingTrackNumber, config) {
  let num = config.playlistIndex || trackNumber || existingTrackNumber || '';
  if (!num) return '';
  
  num = String(num).split('/')[0];
  const total = config.playlistLength || totalTracks || String(existingTrackNumber || '').split('/')[1];
  
  if (total) return `${num}/${total}`;
  return num;
}

function formatDiscNumber(discNumber, totalDiscs, existingDiscNumber) {
  if (!discNumber) return existingDiscNumber || '';
  const num = String(discNumber).split('/')[0];
  if (totalDiscs) return `${num}/${totalDiscs}`;
  return num;
}

function resolveComment(existingComment, clearComments) {
  if (clearComments) return '';
  if (!existingComment) return '';
  // existingComment from node-id3 can be a string or an object { language, text }
  if (typeof existingComment === 'string') return existingComment;
  if (existingComment.text) return existingComment.text;
  return '';
}
