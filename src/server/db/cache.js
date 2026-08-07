/**
 * db/cache.js
 * SQLite cache helpers for MediaDL using better-sqlite3.
 *
 * Features:
 *  - Per-table TTL enforcement
 *  - cacheGet / cacheSet / cacheInvalidate helpers
 *  - recordDownload — insert into the downloads table
 *  - searchLibrary  — full-text search on title/artist/album
 *  - Database auto-created at {appDir}/mediadl.db
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// better-sqlite3 may not be installed — gracefully degrade
let Database;
try {
  Database = require('better-sqlite3');
} catch {
  console.warn('[db/cache] better-sqlite3 not installed — SQLite cache disabled');
  Database = null;
}

// ── TTL constants (ms) ─────────────────────────────────────────────────────────
const TTL = {
  cache_youtube:     24 * 60 * 60 * 1000,       // 24 hours
  cache_spotify:      7 * 24 * 60 * 60 * 1000,  // 7 days
  cache_musicbrainz: 30 * 24 * 60 * 60 * 1000,  // 30 days
  cache_lastfm:      30 * 24 * 60 * 60 * 1000,  // 30 days
};

// ── DB initialization ──────────────────────────────────────────────────────────

const DB_DIR = process.env.MEDIADL_DATA_DIR || path.join(os.homedir(), '.mediadl');
const DB_PATH = path.join(DB_DIR, 'mediadl.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let _db = null;

function getDb() {
  if (_db) return _db;
  if (!Database) return null;

  try {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('foreign_keys = ON');

    // Apply schema
    if (fs.existsSync(SCHEMA_PATH)) {
      const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
      // Run each statement
      const stmts = schema
        .split(';')
        .map(s => s.trim())
        .filter(s => s && !s.startsWith('--') && !s.startsWith('PRAGMA'));
      for (const stmt of stmts) {
        try { _db.prepare(stmt).run(); } catch { /* ignore "already exists" */ }
      }
      // Apply PRAGMAs separately
      const pragmas = schema
        .split('\n')
        .filter(l => l.trim().startsWith('PRAGMA'));
      for (const pg of pragmas) {
        try { _db.pragma(pg.replace('PRAGMA ', '').replace(';', '').trim()); } catch { }
      }
    }

    console.log('[db/cache] SQLite database opened:', DB_PATH);
    return _db;
  } catch (err) {
    console.error('[db/cache] Failed to open SQLite DB:', err.message);
    _db = null;
    return null;
  }
}

// ── cacheGet ───────────────────────────────────────────────────────────────────

/**
 * Retrieve a cached value, returning null if missing or expired.
 * @param {'cache_youtube'|'cache_spotify'|'cache_musicbrainz'|'cache_lastfm'} table
 * @param {string} key - Primary key (video_id / track_id / mbid / cache_key)
 * @returns {Object|null} Parsed data or null
 */
function cacheGet(table, key) {
  const db = getDb();
  if (!db) return null;

  const keyCol = _getKeyColumn(table);
  if (!keyCol) return null;

  try {
    const row = db.prepare(`SELECT data_json, cached_at FROM ${table} WHERE ${keyCol} = ?`).get(key);
    if (!row) return null;

    const ttl = TTL[table];
    if (Date.now() - row.cached_at > ttl) {
      // Expired — delete and return null
      db.prepare(`DELETE FROM ${table} WHERE ${keyCol} = ?`).run(key);
      return null;
    }

    return JSON.parse(row.data_json);
  } catch (err) {
    console.warn(`[db/cache] cacheGet(${table}, ${key}) failed:`, err.message);
    return null;
  }
}

// ── cacheSet ───────────────────────────────────────────────────────────────────

/**
 * Store a value in the cache (upsert).
 * @param {'cache_youtube'|'cache_spotify'|'cache_musicbrainz'|'cache_lastfm'} table
 * @param {string} key
 * @param {Object} data
 */
function cacheSet(table, key, data) {
  const db = getDb();
  if (!db) return;

  const keyCol = _getKeyColumn(table);
  if (!keyCol) return;

  try {
    const json = JSON.stringify(data);
    const now = Date.now();
    db.prepare(`
      INSERT INTO ${table} (${keyCol}, data_json, cached_at)
      VALUES (?, ?, ?)
      ON CONFLICT(${keyCol}) DO UPDATE SET data_json = excluded.data_json, cached_at = excluded.cached_at
    `).run(key, json, now);
  } catch (err) {
    console.warn(`[db/cache] cacheSet(${table}, ${key}) failed:`, err.message);
  }
}

// ── cacheInvalidate ────────────────────────────────────────────────────────────

/**
 * Manually invalidate a cache entry.
 * @param {'cache_youtube'|'cache_spotify'|'cache_musicbrainz'|'cache_lastfm'} table
 * @param {string} key
 */
function cacheInvalidate(table, key) {
  const db = getDb();
  if (!db) return;

  const keyCol = _getKeyColumn(table);
  if (!keyCol) return;

  try {
    db.prepare(`DELETE FROM ${table} WHERE ${keyCol} = ?`).run(key);
  } catch (err) {
    console.warn(`[db/cache] cacheInvalidate(${table}, ${key}) failed:`, err.message);
  }
}

// ── recordDownload ─────────────────────────────────────────────────────────────

/**
 * Insert a completed download into the downloads table.
 * @param {Object} metadata - Merged metadata + download info
 * @returns {string|null} Inserted ID or null
 */
function recordDownload(metadata) {
  const db = getDb();
  if (!db) return null;

  try {
    const id = metadata.id || (Date.now().toString(16) + Math.random().toString(16).slice(2));
    db.prepare(`
      INSERT OR REPLACE INTO downloads (
        id, url, source, title, artist, album, release_date,
        track_number, duration_ms, format, bitrate, file_path,
        cover_url, spotify_id, youtube_id, mbid, isrc,
        metadata_json, downloaded_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
      )
    `).run(
      id,
      metadata.url || metadata.spotifyUrl || metadata.youtubeUrl || '',
      metadata.source || 'youtube',
      metadata.title || null,
      metadata.artist || null,
      metadata.album || null,
      metadata.releaseDate || null,
      metadata.trackNumber || null,
      metadata.durationMs || metadata.duration || null,
      metadata.format || null,
      metadata.bitrate || null,
      metadata.filePath || metadata.file_path || null,
      metadata.coverUrl || metadata.thumbnail || null,
      metadata.spotifyId || null,
      metadata.videoId || null,
      metadata.mbid || null,
      metadata.isrc || null,
      JSON.stringify(metadata),
      Date.now()
    );
    return id;
  } catch (err) {
    console.warn('[db/cache] recordDownload failed:', err.message);
    return null;
  }
}

// ── searchLibrary ──────────────────────────────────────────────────────────────

/**
 * Full-text search across title, artist, album in the downloads table.
 * @param {string} query - Search term
 * @param {number} [limit=20] - Max results
 * @returns {Object[]} Array of download records
 */
function searchLibrary(query, limit = 20) {
  const db = getDb();
  if (!db || !query) return [];

  try {
    const like = `%${query}%`;
    const rows = db.prepare(`
      SELECT id, url, source, title, artist, album, cover_url, file_path, downloaded_at
      FROM downloads
      WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?
      ORDER BY downloaded_at DESC
      LIMIT ?
    `).all(like, like, like, limit);
    return rows;
  } catch (err) {
    console.warn('[db/cache] searchLibrary failed:', err.message);
    return [];
  }
}

/**
 * Get recent downloads.
 * @param {number} [limit=50]
 * @param {string} [source] - Filter by source: 'youtube' | 'spotify' | null
 */
function getRecentDownloads(limit = 50, source = null) {
  const db = getDb();
  if (!db) return [];

  try {
    if (source) {
      return db.prepare(`
        SELECT id, url, source, title, artist, album, cover_url, file_path, downloaded_at
        FROM downloads WHERE source = ? ORDER BY downloaded_at DESC LIMIT ?
      `).all(source, limit);
    }
    return db.prepare(`
      SELECT id, url, source, title, artist, album, cover_url, file_path, downloaded_at
      FROM downloads ORDER BY downloaded_at DESC LIMIT ?
    `).all(limit);
  } catch (err) {
    console.warn('[db/cache] getRecentDownloads failed:', err.message);
    return [];
  }
}

/**
 * Prune expired cache rows from all tables.
 * Call periodically (e.g., on server start).
 */
function pruneExpiredCache() {
  const db = getDb();
  if (!db) return;

  const now = Date.now();
  for (const [table, ttl] of Object.entries(TTL)) {
    try {
      const result = db.prepare(`DELETE FROM ${table} WHERE cached_at < ?`).run(now - ttl);
      if (result.changes > 0) {
        console.log(`[db/cache] Pruned ${result.changes} expired rows from ${table}`);
      }
    } catch { }
  }
}

// ── Helper ─────────────────────────────────────────────────────────────────────

function _getKeyColumn(table) {
  const cols = {
    cache_youtube: 'video_id',
    cache_spotify: 'track_id',
    cache_musicbrainz: 'mbid',
    cache_lastfm: 'cache_key',
  };
  return cols[table] || null;
}

// ── Auto-prune on load ─────────────────────────────────────────────────────────
// Run once on import to clean stale cache
try { pruneExpiredCache(); } catch { }

module.exports = {
  getDb,
  cacheGet,
  cacheSet,
  cacheInvalidate,
  recordDownload,
  searchLibrary,
  getRecentDownloads,
  pruneExpiredCache,
  DB_PATH,
};
