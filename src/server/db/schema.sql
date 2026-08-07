-- ══════════════════════════════════════════════════════════════════
-- MediaDL SQLite Schema
-- Creates 5 tables: downloads, cache_youtube, cache_spotify,
-- cache_musicbrainz, cache_lastfm
-- ══════════════════════════════════════════════════════════════════

PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
PRAGMA foreign_keys = ON;

-- ── Downloads history ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS downloads (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    url             TEXT NOT NULL,
    source          TEXT NOT NULL CHECK (source IN ('youtube', 'spotify', 'ytmusic', 'soundcloud')),
    title           TEXT,
    artist          TEXT,
    album           TEXT,
    release_date    TEXT,
    track_number    INTEGER,
    duration_ms     INTEGER,
    format          TEXT,
    bitrate         INTEGER,
    file_path       TEXT,
    cover_url       TEXT,
    spotify_id      TEXT,
    youtube_id      TEXT,
    mbid            TEXT,
    isrc            TEXT,
    metadata_json   TEXT,            -- full JSON blob of merged metadata
    downloaded_at   INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_downloads_source       ON downloads(source);
CREATE INDEX IF NOT EXISTS idx_downloads_artist       ON downloads(artist);
CREATE INDEX IF NOT EXISTS idx_downloads_downloaded_at ON downloads(downloaded_at DESC);

-- ── YouTube cache (TTL: 24 hours = 86400000 ms) ──────────────────
CREATE TABLE IF NOT EXISTS cache_youtube (
    video_id    TEXT PRIMARY KEY,
    data_json   TEXT NOT NULL,
    cached_at   INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- ── Spotify cache (TTL: 7 days = 604800000 ms) ───────────────────
CREATE TABLE IF NOT EXISTS cache_spotify (
    track_id    TEXT PRIMARY KEY,
    data_json   TEXT NOT NULL,
    cached_at   INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- ── MusicBrainz cache (TTL: 30 days = 2592000000 ms) ────────────
CREATE TABLE IF NOT EXISTS cache_musicbrainz (
    mbid        TEXT PRIMARY KEY,
    data_json   TEXT NOT NULL,
    cached_at   INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- ── Last.fm cache (TTL: 30 days = 2592000000 ms) ─────────────────
CREATE TABLE IF NOT EXISTS cache_lastfm (
    cache_key   TEXT PRIMARY KEY,    -- "artist::title"
    data_json   TEXT NOT NULL,
    cached_at   INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
