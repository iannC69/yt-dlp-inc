import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Music, Download, Loader2, AlertCircle, CheckCircle2,
  Link2, List, Disc, Search, RefreshCw, Clipboard
} from 'lucide-react';
import './SpotifyDownloader.css';

const AUDIO_FORMATS = [
  { id: 'mp3_320', label: '320kbps MP3', sub: 'Best Quality', quality: '0', audioFmt: 'mp3' },
  { id: 'mp3_192', label: '192kbps MP3', sub: 'Standard', quality: '5', audioFmt: 'mp3' },
  { id: 'mp3_128', label: '128kbps MP3', sub: 'Compressed', quality: '9', audioFmt: 'mp3' },
  { id: 'ogg', label: 'OGG Vorbis', sub: 'Open Format', quality: '0', audioFmt: 'vorbis' },
  { id: 'wav', label: 'WAV', sub: 'Lossless', quality: '0', audioFmt: 'wav' },
];

function isSpotifyUrl(url) {
  return /^(https?:\/\/)?(open\.)?spotify\.com\/(track|album|playlist|artist)\/[a-zA-Z0-9]+/.test(url);
}

function getSpotifyType(url) {
  const m = url.match(/spotify\.com\/(track|album|playlist|artist)\//);
  return m ? m[1] : 'track';
}

export default function SpotifyDownloader() {
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState(null);
  const [fetchStatus, setFetchStatus] = useState('idle'); // idle | loading | done | error
  const [fetchError, setFetchError] = useState('');

  const [selectedFormat, setSelectedFormat] = useState('mp3_320');
  const [downloadState, setDownloadState] = useState(null); // null | { status, progress, error, done, downloadUrl, filename }

  const [clipboardToast, setClipboardToast] = useState(false);
  const esRef = useRef(null);
  const inputRef = useRef(null);

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
      } catch {}
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [url]);

  const fetchInfo = async (inputUrl) => {
    const target = inputUrl || url;
    if (!target.trim() || !isSpotifyUrl(target)) {
      setFetchError('Please paste a valid Spotify track, album, or playlist URL.');
      setFetchStatus('error');
      return;
    }
    setFetchStatus('loading');
    setFetchError('');
    setInfo(null);
    setDownloadState(null);
    try {
      const res = await fetch(`/api/spotify-info?url=${encodeURIComponent(target)}`);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to fetch info');
      setInfo(data);
      setFetchStatus('done');
    } catch (e) {
      setFetchError(e.message || 'Could not fetch Spotify info.');
      setFetchStatus('error');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') fetchInfo();
  };

  const handleDownload = () => {
    if (!info || downloadState?.done === false) return;
    if (esRef.current) esRef.current.close();

    const fmt = AUDIO_FORMATS.find(f => f.id === selectedFormat);
    const formatStr = `audio:${fmt.audioFmt}:${fmt.quality}`;

    const params = new URLSearchParams({ url, format: formatStr });
    const es = new EventSource(`/api/spotify-download?${params}`);
    esRef.current = es;
    setDownloadState({ status: 'Searching on YouTube Music...', progress: 0, done: false, error: null });

    es.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.done) {
        es.close();
        esRef.current = null;
        if (d.error) {
          setDownloadState(prev => ({ ...prev, done: true, error: d.error, status: 'Error' }));
        } else {
          setDownloadState(prev => ({ ...prev, done: true, error: null, status: 'Done!', progress: 100, downloadUrl: d.downloadUrl, filename: d.finalFilename }));
        }
      } else {
        setDownloadState(prev => ({ ...prev, ...d }));
      }
    };
    es.onerror = () => {
      es.close();
      setDownloadState(prev => ({ ...prev, done: true, error: 'Connection lost. Please try again.' }));
    };
  };

  const reset = () => {
    if (esRef.current) esRef.current.close();
    setUrl('');
    setInfo(null);
    setFetchStatus('idle');
    setFetchError('');
    setDownloadState(null);
  };

  const spotifyType = isSpotifyUrl(url) ? getSpotifyType(url) : 'track';

  return (
    <div className="sp-page">
      {/* Background orbs */}
      <div className="sp-orb sp-orb-1" />
      <div className="sp-orb sp-orb-2" />
      <div className="sp-orb sp-orb-3" />

      <div className="sp-container">
        {/* Hero */}
        <motion.div
          className="sp-hero"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="sp-logo">
            <svg viewBox="0 0 24 24" fill="currentColor" className="sp-logo-icon">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
            </svg>
            <span>Spotify</span>
          </div>
          <h1 className="sp-title">Spotify Downloader</h1>
          <p className="sp-subtitle">Paste any Spotify track, album, or playlist link to download as MP3</p>
        </motion.div>

        {/* Input */}
        <motion.div
          className="sp-input-section"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className="sp-input-wrapper">
            <AnimatePresence>
              {clipboardToast && (
                <motion.div
                  className="sp-clipboard-toast"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <Clipboard size={14} /> Spotify link detected from clipboard!
                </motion.div>
              )}
            </AnimatePresence>
            <div className="sp-input-icon"><Link2 size={18} /></div>
            <input
              ref={inputRef}
              type="text"
              className="sp-input"
              value={url}
              onChange={e => { setUrl(e.target.value); setFetchStatus('idle'); setInfo(null); setFetchError(''); }}
              onKeyDown={handleKeyDown}
              placeholder="https://open.spotify.com/track/..."
            />
            {url && (
              <button className="sp-input-clear" onClick={reset} title="Clear">
                <RefreshCw size={15} />
              </button>
            )}
            <button
              className="sp-fetch-btn"
              onClick={() => fetchInfo()}
              disabled={fetchStatus === 'loading'}
            >
              {fetchStatus === 'loading' ? <Loader2 size={16} className="sp-spin" /> : <Search size={16} />}
              {fetchStatus === 'loading' ? 'Searching...' : 'Preview'}
            </button>
          </div>

          {/* Quick suggestions */}
          <div className="sp-suggestions">
            <span className="sp-suggestions-label">Examples:</span>
            <span className="sp-badge sp-badge-track"><Disc size={11} /> Track</span>
            <span className="sp-badge sp-badge-album"><Music size={11} /> Album</span>
            <span className="sp-badge sp-badge-playlist"><List size={11} /> Playlist</span>
          </div>
        </motion.div>

        {/* Error */}
        <AnimatePresence>
          {fetchStatus === 'error' && (
            <motion.div
              className="sp-error-card"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              <AlertCircle size={18} />
              <span>{fetchError}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Info Card */}
        <AnimatePresence>
          {info && fetchStatus === 'done' && (
            <motion.div
              className="sp-info-card"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <div className="sp-info-thumb-wrapper">
                {info.thumbnail_url ? (
                  <img src={info.thumbnail_url} alt={info.title} className="sp-info-thumb" />
                ) : (
                  <div className="sp-info-thumb-fallback"><Music size={32} /></div>
                )}
                <div className="sp-info-type-badge">
                  {spotifyType === 'track' && <><Disc size={11} /> Track</>}
                  {spotifyType === 'album' && <><Music size={11} /> Album</>}
                  {spotifyType === 'playlist' && <><List size={11} /> Playlist</>}
                </div>
              </div>
              <div className="sp-info-details">
                <h3 className="sp-info-title">{info.title}</h3>
                {info.author_name && <p className="sp-info-artist">{info.author_name}</p>}
                <p className="sp-info-source">Source: Spotify • Download via YouTube Music match</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Format Picker */}
        <AnimatePresence>
          {info && fetchStatus === 'done' && !downloadState && (
            <motion.div
              className="sp-format-section"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <h3 className="sp-section-title"><Music size={16} /> Choose Format</h3>
              <div className="sp-format-grid">
                {AUDIO_FORMATS.map(fmt => (
                  <button
                    key={fmt.id}
                    className={`sp-format-card ${selectedFormat === fmt.id ? 'sp-format-card--active' : ''}`}
                    onClick={() => setSelectedFormat(fmt.id)}
                  >
                    <span className="sp-format-label">{fmt.label}</span>
                    <span className="sp-format-sub">{fmt.sub}</span>
                  </button>
                ))}
              </div>
              <button className="sp-download-btn" onClick={handleDownload}>
                <Download size={18} /> Download
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Download Progress */}
        <AnimatePresence>
          {downloadState && (
            <motion.div
              className="sp-progress-card"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {!downloadState.done && (
                <>
                  <div className="sp-progress-header">
                    <Loader2 size={18} className="sp-spin" />
                    <span>{downloadState.status}</span>
                  </div>
                  <div className="sp-progress-bar-track">
                    <motion.div
                      className="sp-progress-bar-fill"
                      animate={{ width: `${downloadState.progress || 0}%` }}
                      transition={{ duration: 0.4 }}
                    />
                  </div>
                  <div className="sp-progress-pct">{Math.round(downloadState.progress || 0)}%</div>
                </>
              )}

              {downloadState.done && downloadState.error && (
                <div className="sp-result sp-result--error">
                  <AlertCircle size={20} />
                  <div>
                    <strong>Download Failed</strong>
                    <p>{downloadState.error}</p>
                  </div>
                  <button className="sp-retry-btn" onClick={() => { setDownloadState(null); }}>Try Again</button>
                </div>
              )}

              {downloadState.done && !downloadState.error && (
                <div className="sp-result sp-result--success">
                  <CheckCircle2 size={20} />
                  <div>
                    <strong>Download Complete!</strong>
                    <p>{downloadState.filename}</p>
                  </div>
                  {downloadState.downloadUrl && (
                    <a className="sp-download-link" href={downloadState.downloadUrl} download={downloadState.filename}>
                      <Download size={15} /> Save File
                    </a>
                  )}
                  <button className="sp-retry-btn" onClick={reset}>New Download</button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
