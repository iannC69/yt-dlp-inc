import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Music, Download, Loader2, AlertCircle, CheckCircle2,
  Link2, List, Disc, Search, RefreshCw, Clipboard,
  X, ChevronDown, ChevronUp, FolderOpen, Clock,
  Star, Calendar, Hash, Users, Archive, Play
} from 'lucide-react';
import './SpotifyDownloader.css';

const AUDIO_FORMATS = [
  { id: 'mp3_320', label: '320kbps MP3', sub: 'Best Quality', ext: 'mp3', quality: '0', audioFmt: 'mp3', kbps: 320 },
  { id: 'mp3_192', label: '192kbps MP3', sub: 'Balanced', ext: 'mp3', quality: '5', audioFmt: 'mp3', kbps: 192 },
  { id: 'mp3_128', label: '128kbps MP3', sub: 'Compressed', ext: 'mp3', quality: '9', audioFmt: 'mp3', kbps: 128 },
  { id: 'ogg', label: 'OGG Vorbis', sub: 'Open Format', ext: 'ogg', quality: '0', audioFmt: 'vorbis', kbps: 192 },
  { id: 'wav', label: 'WAV', sub: 'Lossless', ext: 'wav', quality: '0', audioFmt: 'wav', kbps: 1411 },
];

function isSpotifyUrl(url) {
  return /^(https?:\/\/)?(open\.)?spotify\.com\/(track|album|playlist|artist)\/[a-zA-Z0-9]+/.test(url);
}

function getSpotifyType(url) {
  const m = url.match(/spotify\.com\/(track|album|playlist|artist)\//);
  return m ? m[1] : null;
}

function fmtDuration(ms) {
  if (!ms) return '--:--';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtTotalDuration(ms) {
  if (!ms) return '';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return `${h}h ${min}m`;
}

function estimateSize(totalDurationMs, kbps) {
  if (!totalDurationMs || !kbps) return '';
  const bytes = (kbps * 1000 / 8) * (totalDurationMs / 1000);
  const mb = bytes / (1024 * 1024);
  return mb < 1 ? `~${Math.round(mb * 1024)} KB` : `~${mb.toFixed(1)} MB`;
}

function SpotifyBadge({ type }) {
  const colors = {
    track: { bg: 'rgba(29,185,84,0.12)', color: '#1DB954', border: 'rgba(29,185,84,0.3)' },
    album: { bg: 'rgba(99,102,241,0.12)', color: '#818cf8', border: 'rgba(99,102,241,0.3)' },
    playlist: { bg: 'rgba(251,146,60,0.12)', color: '#fb923c', border: 'rgba(251,146,60,0.3)' },
  };
  const c = colors[type] || colors.track;
  const icons = { track: <Disc size={11} />, album: <Music size={11} />, playlist: <List size={11} /> };
  const labels = { track: 'Track', album: 'Album', playlist: 'Playlist' };
  return (
    <span className="sp-type-badge" style={{ background: c.bg, color: c.color, borderColor: c.border }}>
      {icons[type]} {labels[type]}
    </span>
  );
}

function PopularityMeter({ value }) {
  return (
    <div className="sp-popularity">
      <span className="sp-popularity-label"><Star size={11} /> Popularity</span>
      <div className="sp-popularity-track">
        <motion.div
          className="sp-popularity-fill"
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.8, delay: 0.2 }}
        />
      </div>
      <span className="sp-popularity-val">{value}</span>
    </div>
  );
}

function EqualizerBars({ active }) {
  return (
    <div className={`sp-equalizer ${active ? 'sp-equalizer--active' : ''}`}>
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="sp-eq-bar" style={{ animationDelay: `${(i - 1) * 0.1}s` }} />
      ))}
    </div>
  );
}

function TrackRow({ track, status, progress }) {
  // status: 'pending' | 'searching' | 'downloading' | 'done' | 'error'
  return (
    <div className={`sp-track-row sp-track-row--${status}`}>
      <div className="sp-track-num">{String(track.index ?? track.trackNumber ?? 1).padStart(2, '0')}</div>
      {track.thumbnail && <img src={track.thumbnail} alt="" className="sp-track-row-art" />}
      <div className="sp-track-info">
        <span className="sp-track-name">{track.title}</span>
        <span className="sp-track-artist">{track.artist}</span>
      </div>
      <div className="sp-track-dur">{fmtDuration(track.durationMs)}</div>
      <div className="sp-track-status-icon">
        {status === 'pending' && <div className="sp-track-dot" />}
        {status === 'searching' && <Loader2 size={14} className="sp-spin sp-spin--slow" />}
        {status === 'downloading' && (
          <div className="sp-track-progress-mini">
            <motion.div className="sp-track-progress-fill" animate={{ width: `${progress || 0}%` }} />
          </div>
        )}
        {status === 'done' && <CheckCircle2 size={14} className="sp-track-done-icon" />}
        {status === 'error' && <AlertCircle size={14} className="sp-track-error-icon" />}
      </div>
    </div>
  );
}

export default function SpotifyDownloader() {
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState(null);
  const [fetchStatus, setFetchStatus] = useState('idle'); // idle | loading | done | error
  const [fetchError, setFetchError] = useState('');
  const [selectedFormat, setSelectedFormat] = useState('mp3_320');
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [downloadState, setDownloadState] = useState(null);
  const [trackStatuses, setTrackStatuses] = useState({});
  const [clipboardToast, setClipboardToast] = useState(false);
  const downloadIdRef = useRef(null);
  const esRef = useRef(null);
  const inputRef = useRef(null);

  const spotifyType = isSpotifyUrl(url) ? getSpotifyType(url) : null;

  // Clipboard auto-detect on focus
  useEffect(() => {
    const onFocus = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (isSpotifyUrl(text) && text !== url) {
          setUrl(text);
          setClipboardToast(true);
          setTimeout(() => setClipboardToast(false), 3000);
        }
      } catch { }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [url]);

  const fetchInfo = useCallback(async (inputUrl) => {
    const target = inputUrl || url;
    if (!target.trim() || !isSpotifyUrl(target)) {
      setFetchError('Please paste a valid Spotify track, album, or playlist URL.');
      setFetchStatus('error');
      return;
    }
    const type = getSpotifyType(target);
    if (type === 'artist') {
      setFetchError('Artist pages are not supported. Please paste a track, album, or playlist URL.');
      setFetchStatus('error');
      return;
    }
    setFetchStatus('loading');
    setFetchError('');
    setInfo(null);
    setDownloadState(null);
    setTrackStatuses({});
    setShowAllTracks(false);
    try {
      const res = await fetch(`/api/spotify-info?url=${encodeURIComponent(target)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        if (data.error === 'artist_not_supported') throw new Error('Artist pages are not supported. Please use a track, album, or playlist URL.');
        throw new Error(data.error || 'Failed to fetch info');
      }
      setInfo(data);
      setFetchStatus('done');
    } catch (e) {
      setFetchError(e.message || 'Could not fetch Spotify info.');
      setFetchStatus('error');
    }
  }, [url]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') fetchInfo();
  };

  const handleDownload = () => {
    if (!info || downloadState?.active) return;
    if (esRef.current) esRef.current.close();
    const fmt = AUDIO_FORMATS.find(f => f.id === selectedFormat);
    const formatStr = `audio:${fmt.audioFmt}:${fmt.quality}`;
    const dlId = Date.now().toString();
    downloadIdRef.current = dlId;

    // Init track statuses
    const initStatuses = {};
    if (info.tracks?.length) {
      info.tracks.forEach((_, i) => { initStatuses[i] = 'pending'; });
    }
    setTrackStatuses(initStatuses);
    setDownloadState({ active: true, status: 'Connecting to Spotify...', progress: 0, trackProgress: 0, currentTrack: 0, totalTracks: info.trackCount || 1, done: false, error: null });

    const params = new URLSearchParams({ url, format: formatStr, downloadId: dlId });
    const es = new EventSource(`/api/spotify-download?${params}`);
    esRef.current = es;

    es.onmessage = (e) => {
      const d = JSON.parse(e.data);
      setDownloadState(prev => {
        const next = { ...prev, ...d };
        // Keep active=true unless done
        if (!d.done) next.active = true;
        if (d.done) next.active = false;
        return next;
      });

      // Update per-track statuses
      if (d.currentTrack !== undefined && info.tracks?.length) {
        const idx = d.currentTrack - 1;
        if (d.trackDone) {
          setTrackStatuses(prev => ({ ...prev, [idx]: 'done' }));
        } else if (d.trackError) {
          setTrackStatuses(prev => ({ ...prev, [idx]: 'error' }));
        } else if (d.trackProgress !== undefined && d.trackProgress > 0) {
          setTrackStatuses(prev => ({ ...prev, [idx]: 'downloading' }));
        } else if (d.status?.startsWith('Search')) {
          setTrackStatuses(prev => ({ ...prev, [idx]: 'searching' }));
        }
      }

      if (d.done) {
        es.close();
        esRef.current = null;
      }
    };
    es.onerror = () => {
      es.close();
      setDownloadState(prev => ({ ...prev, active: false, done: true, error: 'Connection lost. Please try again.' }));
    };
  };

  const handleCancel = async () => {
    if (esRef.current) esRef.current.close();
    if (downloadIdRef.current) {
      try { await fetch(`/api/spotify-cancel?downloadId=${downloadIdRef.current}`); } catch { }
    }
    setDownloadState(prev => ({ ...prev, active: false, done: true, error: 'Download cancelled.' }));
  };

  const openFolder = () => {
    fetch('/api/ytdl/open-folder');
  };

  const reset = () => {
    if (esRef.current) esRef.current.close();
    setUrl('');
    setInfo(null);
    setFetchStatus('idle');
    setFetchError('');
    setDownloadState(null);
    setTrackStatuses({});
    setShowAllTracks(false);
    downloadIdRef.current = null;
  };

  const selectedFmt = AUDIO_FORMATS.find(f => f.id === selectedFormat);
  const totalDuration = info?.totalDurationMs || (info?.durationMs ? info.durationMs : 0);
  const sizeEstimate = estimateSize(totalDuration, selectedFmt?.kbps);

  const tracksToShow = useMemo(() => {
    if (!info?.tracks) return [];
    return showAllTracks ? info.tracks : info.tracks.slice(0, 8);
  }, [info, showAllTracks]);

  const isDownloading = downloadState?.active && !downloadState?.done;
  const isDone = downloadState?.done;
  const hasError = downloadState?.done && downloadState?.error;
  const isSuccess = downloadState?.done && !downloadState?.error;

  return (
    <div className="sp-page">
      {/* Background orbs */}
      <div className="sp-orb sp-orb-1" />
      <div className="sp-orb sp-orb-2" />
      <div className="sp-orb sp-orb-3" />

      <div className="sp-container">

        {/* ── Hero ── */}
        <motion.div className="sp-hero" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="sp-logo">
            <svg viewBox="0 0 24 24" fill="currentColor" className="sp-logo-icon">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
            </svg>
            <span>Spotify</span>
          </div>
          <h1 className="sp-title">Spotify Downloader</h1>
          <p className="sp-subtitle">Download tracks, albums &amp; playlists as high-quality audio</p>
        </motion.div>

        {/* ── URL Input ── */}
        <motion.div className="sp-input-section" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
          <div className="sp-input-wrapper">
            <AnimatePresence>
              {clipboardToast && (
                <motion.div className="sp-clipboard-toast" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <Clipboard size={13} /> Spotify link detected from clipboard!
                </motion.div>
              )}
            </AnimatePresence>
            <div className="sp-input-icon"><Link2 size={17} /></div>
            <input
              ref={inputRef}
              type="text"
              className="sp-input"
              value={url}
              onChange={e => { setUrl(e.target.value); setFetchStatus('idle'); setInfo(null); setFetchError(''); setDownloadState(null); }}
              onKeyDown={handleKeyDown}
              placeholder="https://open.spotify.com/track/..."
            />
            {spotifyType && (
              <div className="sp-input-type-pill">
                <SpotifyBadge type={spotifyType} />
              </div>
            )}
            {url && (
              <button className="sp-input-clear" onClick={reset} title="Clear">
                <X size={14} />
              </button>
            )}
            <button
              className="sp-fetch-btn"
              onClick={() => fetchInfo()}
              disabled={fetchStatus === 'loading'}
            >
              {fetchStatus === 'loading' ? <Loader2 size={15} className="sp-spin" /> : <Search size={15} />}
              {fetchStatus === 'loading' ? 'Loading...' : 'Preview'}
            </button>
          </div>
          <div className="sp-suggestions">
            <span className="sp-suggestions-label">Supports:</span>
            <span className="sp-badge sp-badge-track"><Disc size={10} /> Track</span>
            <span className="sp-badge sp-badge-album"><Music size={10} /> Album</span>
            <span className="sp-badge sp-badge-playlist"><List size={10} /> Playlist</span>
          </div>
        </motion.div>

        {/* ── Error ── */}
        <AnimatePresence>
          {fetchStatus === 'error' && (
            <motion.div className="sp-error-card" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
              <AlertCircle size={17} />
              <span>{fetchError}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Info Card ── */}
        <AnimatePresence>
          {info && fetchStatus === 'done' && (
            <motion.div className="sp-info-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>

              {/* Thumbnail + meta top */}
              <div className="sp-info-top">
                <div className="sp-info-thumb-wrap">
                  {info.thumbnail ? (
                    <img src={info.thumbnail} alt={info.title} className="sp-info-thumb" />
                  ) : (
                    <div className="sp-info-thumb-fallback"><Music size={28} /></div>
                  )}
                  <SpotifyBadge type={info.type} />
                </div>

                <div className="sp-info-meta">
                  <h3 className="sp-info-title">{info.title}</h3>
                  {info.artist && <p className="sp-info-artist">{info.artist}</p>}
                  {info.owner && <p className="sp-info-owner"><Users size={12} /> {info.owner}</p>}

                  <div className="sp-info-pills">
                    {info.releaseDate && (
                      <span className="sp-info-pill"><Calendar size={11} /> {info.releaseDate.slice(0, 4)}</span>
                    )}
                    {info.trackCount > 1 && (
                      <span className="sp-info-pill"><Hash size={11} /> {info.trackCount} tracks</span>
                    )}
                    {info.durationMs > 0 && (
                      <span className="sp-info-pill"><Clock size={11} /> {fmtDuration(info.durationMs)}</span>
                    )}
                    {info.totalDurationMs > 0 && (
                      <span className="sp-info-pill"><Clock size={11} /> {fmtTotalDuration(info.totalDurationMs)}</span>
                    )}
                    {info.album && info.type === 'track' && (
                      <span className="sp-info-pill sp-info-pill--album"><Disc size={11} /> {info.album}</span>
                    )}
                  </div>

                  {info.type === 'track' && info.popularity > 0 && (
                    <PopularityMeter value={info.popularity} />
                  )}

                  {info.description && (
                    <p className="sp-info-desc">{info.description.replace(/<[^>]*>/g, '').slice(0, 120)}{info.description.length > 120 ? '…' : ''}</p>
                  )}
                </div>
              </div>

              {/* Tracklist (album/playlist) */}
              {info.tracks?.length > 1 && (
                <div className="sp-tracklist">
                  <div className="sp-tracklist-header">
                    <span className="sp-tracklist-title"><List size={13} /> Tracks</span>
                    <span className="sp-tracklist-count">{info.trackCount} songs</span>
                  </div>
                  <div className="sp-tracklist-body">
                    {tracksToShow.map((track, i) => (
                      <div key={i} className="sp-tracklist-row">
                        <span className="sp-tracklist-idx">{String(track.index ?? track.trackNumber ?? i + 1).padStart(2, '0')}</span>
                        <div className="sp-tracklist-info">
                          <span className="sp-tracklist-name">{track.title}</span>
                          {track.artist && track.artist !== info.artist && (
                            <span className="sp-tracklist-sub">{track.artist}</span>
                          )}
                        </div>
                        <span className="sp-tracklist-dur">{fmtDuration(track.durationMs)}</span>
                      </div>
                    ))}
                    {info.tracks.length > 8 && (
                      <button className="sp-tracklist-more" onClick={() => setShowAllTracks(v => !v)}>
                        {showAllTracks
                          ? <><ChevronUp size={13} /> Show less</>
                          : <><ChevronDown size={13} /> Show all {info.tracks.length} tracks</>
                        }
                      </button>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Format Picker ── */}
        <AnimatePresence>
          {info && fetchStatus === 'done' && !downloadState && (
            <motion.div className="sp-format-section" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <h3 className="sp-section-title"><Music size={14} /> Choose Format</h3>
              <div className="sp-format-grid">
                {AUDIO_FORMATS.map(fmt => (
                  <button
                    key={fmt.id}
                    className={`sp-format-card ${selectedFormat === fmt.id ? 'sp-format-card--active' : ''}`}
                    onClick={() => setSelectedFormat(fmt.id)}
                  >
                    <div className="sp-format-top-row">
                      <span className="sp-format-label">{fmt.label}</span>
                      {fmt.id === 'mp3_320' && <span className="sp-format-rec">Best</span>}
                    </div>
                    <span className="sp-format-sub">{fmt.sub}</span>
                    {totalDuration > 0 && (
                      <span className="sp-format-size">{estimateSize(totalDuration, fmt.kbps)}</span>
                    )}
                  </button>
                ))}
              </div>

              {sizeEstimate && (
                <div className="sp-format-summary">
                  <Archive size={13} />
                  <span>Estimated size: <strong>{sizeEstimate}</strong></span>
                  {info.trackCount > 1 && <span className="sp-format-summary-zip"> · Will be downloaded as ZIP</span>}
                </div>
              )}

              <button className="sp-download-btn" onClick={handleDownload}>
                <Download size={18} />
                {info.trackCount > 1 ? `Download ${info.trackCount} Tracks` : 'Download Track'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Download Progress ── */}
        <AnimatePresence>
          {downloadState && (
            <motion.div className="sp-progress-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>

              {/* Animated album art while downloading */}
              {isDownloading && info?.thumbnail && (
                <div className="sp-dl-art-row">
                  <div className="sp-dl-art-wrapper">
                    <img src={info.thumbnail} alt="" className="sp-dl-art" />
                    <div className="sp-dl-art-pulse" />
                  </div>
                  <div className="sp-dl-meta">
                    <div className="sp-dl-title">{downloadState.trackTitle || info.title}</div>
                    <div className="sp-dl-artist">{downloadState.trackArtist || info.artist}</div>
                    <div className="sp-dl-status-row">
                      <EqualizerBars active={isDownloading} />
                      <span className="sp-dl-status-text">{downloadState.status}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Overall progress bar */}
              {isDownloading && (
                <>
                  <div className="sp-progress-label-row">
                    <span className="sp-progress-label">
                      {downloadState.totalTracks > 1
                        ? `Track ${downloadState.currentTrack || 0} of ${downloadState.totalTracks}`
                        : 'Downloading...'}
                    </span>
                    <span className="sp-progress-pct">{Math.round(downloadState.progress || 0)}%</span>
                  </div>
                  <div className="sp-progress-bar-track">
                    <motion.div
                      className="sp-progress-bar-fill"
                      animate={{ width: `${downloadState.progress || 0}%` }}
                      transition={{ duration: 0.4 }}
                    />
                  </div>
                  {downloadState.totalTracks > 1 && (
                    <div className="sp-progress-sub">
                      <div className="sp-progress-bar-track sp-progress-bar-track--thin">
                        <motion.div
                          className="sp-progress-bar-fill sp-progress-bar-fill--track"
                          animate={{ width: `${downloadState.trackProgress || 0}%` }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                    </div>
                  )}
                  <button className="sp-cancel-btn" onClick={handleCancel}>
                    <X size={14} /> Cancel
                  </button>
                </>
              )}

              {/* Per-track list during multi-track download */}
              {isDownloading && info?.tracks?.length > 1 && (
                <div className="sp-dl-tracklist">
                  {info.tracks.slice(0, 20).map((track, i) => (
                    <TrackRow
                      key={i}
                      track={track}
                      status={trackStatuses[i] || 'pending'}
                      progress={i === (downloadState.currentTrack - 1) ? downloadState.trackProgress : 0}
                    />
                  ))}
                  {info.tracks.length > 20 && (
                    <div className="sp-dl-tracklist-more">+{info.tracks.length - 20} more tracks</div>
                  )}
                </div>
              )}

              {/* Error */}
              {hasError && (
                <div className="sp-result sp-result--error">
                  <AlertCircle size={20} />
                  <div>
                    <strong>Download Failed</strong>
                    <p>{downloadState.error}</p>
                  </div>
                  <div className="sp-result-actions">
                    <button className="sp-retry-btn" onClick={() => { setDownloadState(null); setTrackStatuses({}); }}>Try Again</button>
                    <button className="sp-secondary-btn" onClick={reset}>New URL</button>
                  </div>
                </div>
              )}

              {/* Success */}
              {isSuccess && (
                <div className="sp-result sp-result--success">
                  <div className="sp-success-icon-wrap">
                    <CheckCircle2 size={32} className="sp-success-icon" />
                    <div className="sp-success-ring" />
                  </div>
                  <div className="sp-success-info">
                    <strong>Download Complete!</strong>
                    <p className="sp-success-filename">{downloadState.finalFilename}</p>
                    {downloadState.completedTracks > 1 && (
                      <p className="sp-success-sub">
                        {downloadState.completedTracks} tracks downloaded
                        {downloadState.failedTracks > 0 && ` · ${downloadState.failedTracks} failed`}
                      </p>
                    )}
                  </div>
                  <div className="sp-result-actions">
                    {downloadState.downloadUrl && (
                      <a className="sp-download-link" href={downloadState.downloadUrl} download={downloadState.finalFilename}>
                        <Download size={14} /> Save File
                      </a>
                    )}
                    <button className="sp-open-folder-btn" onClick={openFolder}>
                      <FolderOpen size={14} /> Open Folder
                    </button>
                    <button className="sp-retry-btn" onClick={reset}>New Download</button>
                  </div>
                </div>
              )}

            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
