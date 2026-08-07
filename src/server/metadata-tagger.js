/**
 * metadata-tagger.js
 * ID3v2.4 tag writer and verifier using node-id3.
 *
 * Supports all 25 standard + custom tags:
 *  TIT2, TPE1, TPE2, TALB, TRCK, TPOS, TDRC, TCON, COMM, TCOP,
 *  TPUB, TBPM, TKEY, APIC (cover art),
 *  USLT (unsynced lyrics), SYLT (synced lyrics),
 *  TXXX frames: ISRC, MBID, SOURCE, SPOTIFY_ID, YOUTUBE_ID,
 *               ENERGY, DANCEABILITY, VALENCE
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

// node-id3 may not be installed — gracefully degrade
let NodeID3;
try {
  NodeID3 = require('node-id3');
} catch {
  console.warn('[metadata-tagger] node-id3 not installed — tagging disabled');
  NodeID3 = null;
}

// ── Utility ────────────────────────────────────────────────────────────────────

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    if (!url) return resolve(null);
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const mimeType = res.headers['content-type'] || 'image/jpeg';
        resolve({ imageBuffer: buf, mimeType });
      });
    }).on('error', () => resolve(null));
  });
}

function keyIndexToString(keyIndex) {
  // Spotify key: 0=C, 1=C#, 2=D, 3=D#, 4=E, 5=F, 6=F#, 7=G, 8=G#, 9=A, 10=A#, 11=B
  const keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  if (keyIndex === undefined || keyIndex === null || keyIndex === -1) return null;
  return keys[keyIndex] || null;
}

// ── writeTags ──────────────────────────────────────────────────────────────────

/**
 * Write ID3v2.4 tags to an audio file.
 * @param {string} filePath - Absolute path to the audio file (.mp3)
 * @param {Object} metadata - Metadata object (from mergeMetadata or raw)
 * @param {Object} [opts]
 * @param {boolean} [opts.overwrite=true]    - Overwrite existing tags
 * @param {boolean} [opts.downloadCover=true] - Download & embed cover art from URL
 * @returns {Promise<{success: boolean, tagsWritten: string[], error?: string}>}
 */
async function writeTags(filePath, metadata, opts = {}) {
  if (!NodeID3) return { success: false, error: 'node-id3 not installed' };
  if (!filePath || !fs.existsSync(filePath)) return { success: false, error: `File not found: ${filePath}` };
  if (path.extname(filePath).toLowerCase() !== '.mp3') {
    return { success: false, error: 'Only .mp3 files are supported for ID3 tagging' };
  }

  const { overwrite = true, downloadCover = true } = opts;
  const tagsWritten = [];

  // Build the tags object
  const tags = {};

  // ── Standard tags ──────────────────────────────────────────────────────────

  if (metadata.title) {
    tags.title = metadata.title;
    tagsWritten.push('TIT2');
  }

  if (metadata.artist) {
    tags.artist = Array.isArray(metadata.artists)
      ? metadata.artists.map(a => (typeof a === 'string' ? a : a.name)).join('; ')
      : metadata.artist;
    tagsWritten.push('TPE1');
  }

  // Album artist (TPE2)
  if (metadata.albumArtist || metadata.artist) {
    tags.albumArtist = metadata.albumArtist || metadata.artist;
    tagsWritten.push('TPE2');
  }

  if (metadata.album) {
    tags.album = metadata.album;
    tagsWritten.push('TALB');
  }

  // Track number/total (TRCK)
  if (metadata.trackNumber) {
    tags.trackNumber = metadata.totalTracks
      ? `${metadata.trackNumber}/${metadata.totalTracks}`
      : String(metadata.trackNumber);
    tagsWritten.push('TRCK');
  }

  // Disc number (TPOS)
  if (metadata.discNumber) {
    tags.partOfSet = String(metadata.discNumber);
    tagsWritten.push('TPOS');
  }

  // Release year (TDRC)
  if (metadata.releaseDate) {
    tags.year = metadata.releaseDate.slice(0, 4);
    tagsWritten.push('TDRC');
  }

  // Genre (TCON)
  if (metadata.genres?.length > 0) {
    tags.genre = metadata.genres.join('; ');
    tagsWritten.push('TCON');
  }

  // Comment (COMM)
  if (metadata.wikiSummary || metadata.description) {
    tags.comment = {
      language: 'eng',
      text: (metadata.wikiSummary || metadata.description || '').slice(0, 500),
    };
    tagsWritten.push('COMM');
  }

  // Copyright (TCOP)
  if (metadata.copyright) {
    tags.copyright = metadata.copyright;
    tagsWritten.push('TCOP');
  }

  // Publisher (TPUB)
  if (metadata.publisher || metadata.label) {
    tags.publisher = metadata.publisher || metadata.label;
    tagsWritten.push('TPUB');
  }

  // BPM (TBPM)
  if (metadata.bpm) {
    tags.bpm = String(Math.round(metadata.bpm));
    tagsWritten.push('TBPM');
  }

  // Key (TKEY)
  const keyStr = keyIndexToString(metadata.key);
  if (keyStr) {
    tags.initialKey = keyStr + (metadata.mode === 0 ? 'm' : '');
    tagsWritten.push('TKEY');
  }

  // ── Lyrics ─────────────────────────────────────────────────────────────────

  if (metadata.lyricsUnsynced) {
    tags.unsynchronisedLyrics = {
      language: 'eng',
      text: metadata.lyricsUnsynced,
    };
    tagsWritten.push('USLT');
  }

  if (metadata.lyricsSynced && Array.isArray(metadata.lyricsSynced)) {
    tags.synchronisedLyrics = [{
      language: 'eng',
      timestampFormat: 2, // milliseconds
      contentType: 1,     // lyrics
      synchronisedText: metadata.lyricsSynced, // [{timestamp, text}]
    }];
    tagsWritten.push('SYLT');
  }

  // ── Cover art (APIC) ───────────────────────────────────────────────────────

  const coverUrl = metadata.coverUrl || metadata.thumbnail;
  if (downloadCover && coverUrl) {
    try {
      const imageData = await downloadImage(coverUrl);
      if (imageData && imageData.imageBuffer.length > 0) {
        tags.image = {
          type: { id: 3, name: 'Front Cover' },
          mime: imageData.mimeType,
          description: 'Cover',
          imageBuffer: imageData.imageBuffer,
        };
        tagsWritten.push('APIC');
      }
    } catch (err) {
      console.warn('[metadata-tagger] Cover art download failed:', err.message);
    }
  } else if (metadata.coverBuffer) {
    tags.image = {
      type: { id: 3, name: 'Front Cover' },
      mime: 'image/jpeg',
      description: 'Cover',
      imageBuffer: metadata.coverBuffer,
    };
    tagsWritten.push('APIC');
  }

  // ── TXXX custom frames ─────────────────────────────────────────────────────

  const userDefinedFrames = [];

  const addTxxx = (key, value) => {
    if (value !== undefined && value !== null && value !== '') {
      userDefinedFrames.push({ description: key, value: String(value) });
      tagsWritten.push(`TXXX:${key}`);
    }
  };

  addTxxx('ISRC', metadata.isrc);
  addTxxx('MBID', metadata.mbid);
  addTxxx('ACOUSTID', metadata.acoustId);
  addTxxx('SOURCE', metadata._sources?.join(',') || 'mediadl');
  addTxxx('SPOTIFY_ID', metadata.spotifyId);
  addTxxx('YOUTUBE_ID', metadata.videoId);
  addTxxx('ENERGY', metadata.energy !== undefined ? metadata.energy.toFixed(3) : null);
  addTxxx('DANCEABILITY', metadata.danceability !== undefined ? metadata.danceability.toFixed(3) : null);
  addTxxx('VALENCE', metadata.valence !== undefined ? metadata.valence.toFixed(3) : null);
  addTxxx('LISTENERS', metadata.listeners);

  if (userDefinedFrames.length > 0) {
    tags.userDefinedText = userDefinedFrames;
  }

  // ── Write tags ─────────────────────────────────────────────────────────────

  try {
    let success;
    if (overwrite) {
      success = NodeID3.write(tags, filePath);
    } else {
      // Merge with existing
      const existing = NodeID3.read(filePath);
      const merged = { ...existing, ...tags };
      success = NodeID3.write(merged, filePath);
    }

    if (success === true || success === undefined) {
      return { success: true, tagsWritten };
    } else {
      return { success: false, error: 'node-id3 write returned false', tagsWritten };
    }
  } catch (err) {
    return { success: false, error: err.message, tagsWritten };
  }
}

// ── verifyTags ─────────────────────────────────────────────────────────────────

/**
 * Read back tags from a file and verify the key fields are set correctly.
 * @param {string} filePath
 * @returns {Promise<{success: boolean, tags: Object, missing: string[]}>}
 */
async function verifyTags(filePath) {
  if (!NodeID3) return { success: false, error: 'node-id3 not installed' };
  if (!filePath || !fs.existsSync(filePath)) return { success: false, error: 'File not found' };

  try {
    const tags = NodeID3.read(filePath);
    const missing = [];

    // Check essential fields
    const required = ['title', 'artist', 'album'];
    for (const field of required) {
      if (!tags[field]) missing.push(field);
    }

    // Check cover art size
    if (tags.image && tags.image.imageBuffer) {
      const w = tags.image.width || 0;
      const h = tags.image.height || 0;
      if (w > 0 && h > 0 && (w < 100 || h < 100)) {
        missing.push('APIC (too small)');
      }
    } else {
      missing.push('APIC (missing)');
    }

    return {
      success: missing.length === 0,
      tags: {
        title: tags.title,
        artist: tags.artist,
        album: tags.album,
        year: tags.year,
        genre: tags.genre,
        trackNumber: tags.trackNumber,
        bpm: tags.bpm,
        hasCover: !!(tags.image?.imageBuffer),
        userDefined: tags.userDefinedText || [],
      },
      missing,
    };
  } catch (err) {
    return { success: false, error: err.message, missing: [] };
  }
}

module.exports = { writeTags, verifyTags };
