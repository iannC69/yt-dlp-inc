import NodeID3 from 'node-id3';
import fs from 'fs';

/**
 * Write ID3v2 tags to an MP3 file using NodeID3.update() — partial update, preserves existing tags.
 * - Reads existing tags first to preserve anything already embedded (e.g. lyrics, cover from yt-dlp)
 * - Writes: title, artist (TPE1), album artist (TPE2), album (TALB), year, track number, disc number,
 *   genre, ISRC, cover art (APIC), and more
 * - coverBuffer can be a Buffer OR a file path string (will be read automatically)
 * - If coverBuffer provided → uses it as front cover
 * - If no coverBuffer but file already has embedded cover → preserves it (with retry for race conditions)
 * - Never falls back to track.title for album
 */
export async function writeAndVerifyTags(filePath, tags, coverBuffer, config = {}) {
  try {
    // Normalize coverBuffer: accept file path string as well as Buffer
    if (coverBuffer && typeof coverBuffer === 'string') {
      try {
        coverBuffer = fs.existsSync(coverBuffer) ? fs.readFileSync(coverBuffer) : null;
      } catch (_) { coverBuffer = null; }
    }

    // 1. Read existing tags to preserve embedded content (e.g. cover art, lyrics from yt-dlp)
    //    Retry up to 3 times with a short delay to handle race conditions where ffmpeg is still
    //    writing the file's embedded thumbnail when we try to read it.
    let existingTags = {};
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        existingTags = NodeID3.read(filePath) || {};
        // If we still need a cover and haven't found one yet, wait and retry
        if (!coverBuffer && !existingTags.image && attempt < 2) {
          await new Promise(r => setTimeout(r, 400));
          continue;
        }
        break;
      } catch (_) {
        if (attempt < 2) await new Promise(r => setTimeout(r, 400));
      }
    }

    // 2. Build complete ID3 tag object — existing tags are the baseline, incoming tags override
    const id3Tags = {
      title: tags.title || existingTags.title || '',
      artist: tags.artist || existingTags.artist || '',
      performerInfo: tags.allArtists || tags.albumArtist || tags.artist || existingTags.performerInfo || '',
      album: tags.album || existingTags.album || '',
      year: tags.year ? String(tags.year) : (existingTags.year || ''),
      date: tags.releaseDate ? tags.releaseDate.replace(/-/g, '') : (existingTags.date || ''),
      trackNumber: formatTrackNumber(tags.trackNumber, tags.totalTracks, existingTags.trackNumber, config),
      partOfSet: formatDiscNumber(tags.discNumber, tags.totalDiscs, existingTags.partOfSet),
      genre: tags.genre || existingTags.genre || '',
      isrc: tags.isrc || existingTags.isrc || '',
      copyright: tags.copyright || existingTags.copyright || '',
      publisher: tags.label || existingTags.publisher || '',
      comment: { language: 'eng', text: 'Downloaded by MediaDL' },
    };

    // Keep explicit lyrics synced if available
    if (existingTags.unsynchronisedLyrics) {
      id3Tags.unsynchronisedLyrics = existingTags.unsynchronisedLyrics;
    }
    if (existingTags.synchronisedLyrics) {
      id3Tags.synchronisedLyrics = existingTags.synchronisedLyrics;
    }

    // 3. Cover art — provided buffer takes priority; yt-dlp embedded cover is the fallback
    if (coverBuffer && coverBuffer.length > 1000) {
      id3Tags.image = {
        mime: detectMime(coverBuffer),
        type: { id: 3, name: 'Front Cover' },
        description: 'Cover',
        imageBuffer: coverBuffer,
      };
    } else if (existingTags.image && existingTags.image.imageBuffer && existingTags.image.imageBuffer.length > 1000) {
      id3Tags.image = existingTags.image;
    }

    // 4. Clean up empty/null tags so NodeID3.update doesn't overwrite good existing values
    for (const key in id3Tags) {
      if (id3Tags[key] === '' || id3Tags[key] === null || id3Tags[key] === undefined) {
        delete id3Tags[key];
      }
    }

    // 5. NodeID3.update() — preserves all existing tags not specified in id3Tags
    const writeOk = NodeID3.update(id3Tags, filePath);
    if (!writeOk) {
      // Retry once after a short delay (file may still be locked by ffmpeg)
      await new Promise(r => setTimeout(r, 600));
      NodeID3.update(id3Tags, filePath);
    }

    return { success: true, file: filePath };
  } catch (e) {
    console.error(`[tags] writeAndVerifyTags failed for ${filePath}: ${e.message}`);
    return { success: false, file: filePath, error: e.message };
  }
}

/**
 * Detect MIME type from image buffer magic bytes.
 * Defaults to image/jpeg for ID3 compatibility.
 */
function detectMime(buf) {
  if (!buf || buf.length < 4) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  return 'image/jpeg';
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
