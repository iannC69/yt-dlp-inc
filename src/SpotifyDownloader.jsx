import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Music, Download, Loader2, AlertCircle, CheckCircle2,
  Link2, List, Disc, Search, RefreshCw, Clipboard,
  X, ChevronDown, ChevronUp, FolderOpen, Clock,
  Star, Calendar, Hash, Users, Archive, Play, User, LogOut, ListVideo
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

function TrackRow({ track, status, progress, errorText, overrideUrl, onOverrideChange }) {
  return (
    <>
    <div className={`sp-track-row ${status === 'downloading' ? 'sp-track-row--active' : ''}`}>
      <div className="sp-track-num">{String(track.index ?? track.trackNumber ?? 1).padStart(2, '0')}</div>
      {track.coverUrl && <img src={track.coverUrl} alt="" className="sp-track-row-art" />}
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
        {status === 'done' && <CheckCircle2 size={14} className="sp-track-done-icon" title="Downloaded successfully" />}
        {status === 'error' && (
          <div className="sp-track-error-container" title={errorText || 'Download failed'}>
            <AlertCircle size={14} className="sp-track-error-icon" />
          </div>
        )}
      </div>
    </div>
    {status === 'error' && errorText && (
      <div className="sp-track-error-text">
        Eroare: {errorText}
      </div>
    )}
    </>
  );
}

export default function SpotifyDownloader({ activeDownloadId }) {
  const [url, setUrl] = useState('');
  const [bulkMeta, setBulkMeta] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [info, setInfo] = useState(null);
  const [fetchStatus, setFetchStatus] = useState('idle'); // idle | loading | done | error
  const [fetchError, setFetchError] = useState('');
  const [selectedFormat, setSelectedFormat] = useState('mp3_320');
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [selectedTracks, setSelectedTracks] = useState(new Set());
  const [downloadState, setDownloadState] = useState(null);
  const [trackStatuses, setTrackStatuses] = useState({});
  const [trackErrors, setTrackErrors] = useState({});
  const [trackOverrides, setTrackOverrides] = useState({});
  const [clipboardToast, setClipboardToast] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [myPlaylists, setMyPlaylists] = useState(null);
  const [myPlaylistsStatus, setMyPlaylistsStatus] = useState('idle');
  const [showPlaylists, setShowPlaylists] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  
  const downloadIdRef = useRef(null);
  const esRef = useRef(null);
  const inputRef = useRef(null);

  const spotifyType = isSpotifyUrl(url) ? getSpotifyType(url) : null;

  // Auto-paste removed to prevent interference with manual pasting

  useEffect(() => {
    const checkAuth = async () => {
      const storedToken = localStorage.getItem('spotify_access_token');
      if (storedToken) setAccessToken(storedToken);

      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      if (code) {
        window.history.replaceState({}, null, '/');
        const clientId = localStorage.getItem('spotify_client_id') || '';
        const clientSecret = localStorage.getItem('spotify_client_secret') || '';
        if (!clientSecret) {
          alert('Lipsește Spotify Client Secret! Te rugăm să adaugi și Client Secret în Setări pentru a te putea autentifica.');
        } else if (clientId && clientSecret) {
          try {
            const res = await fetch('/api/spotify-oauth', {
              method: 'POST',
              headers: {
                'x-spotify-client-id': clientId,
                'x-spotify-client-secret': clientSecret,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ code, redirectUri: window.location.origin + '/' })
            });
            const data = await res.json();
            if (data.access_token) {
              localStorage.setItem('spotify_access_token', data.access_token);
              if (data.refresh_token) localStorage.setItem('spotify_refresh_token', data.refresh_token);
              setAccessToken(data.access_token);
              alert('Autentificare Spotify reușită!');
            } else {
              alert(`Eroare la obținerea token-ului Spotify: ${data.error || 'Necunoscut'}`);
            }
          } catch (err) {
            alert(`Eroare de rețea la autentificarea Spotify: ${err.message}`);
          }
        }
      }
    };
    checkAuth();
  }, []);

  useEffect(() => {
    if (accessToken) {
      fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
        .then(r => r.json())
        .then(data => {
          if (!data.error) setUserProfile(data);
        })
        .catch(() => {});
    } else {
      setUserProfile(null);
    }
  }, [accessToken]);

  const fetchMyPlaylists = useCallback(async () => {
    if (!accessToken) return;
    setShowPlaylists(true);
    setMyPlaylistsStatus('loading');
    try {
      const res = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.status === 401) {
        localStorage.removeItem('spotify_access_token');
        setAccessToken('');
        throw new Error('Token expired');
      }
      const data = await res.json();
      setMyPlaylists(data.items);
      setMyPlaylistsStatus('done');
    } catch (err) {
      setMyPlaylistsStatus('error');
    }
  }, [accessToken]);

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

    const clientId = localStorage.getItem('spotify_client_id') || '';
    const clientSecret = localStorage.getItem('spotify_client_secret') || '';
    const userAccessToken = localStorage.getItem('spotify_access_token') || '';

    if (!clientId.trim() || !clientSecret.trim()) {
      setFetchError('Add your Spotify credentials in Settings to use Spotify features.');
      setFetchStatus('error');
      return;
    }

    setFetchStatus('loading');
    setFetchError('');
    setInfo(null);
    setDownloadState(null);
    setTrackStatuses({});
    setShowAllTracks(false);
    setShowDownloadModal(false);
    setSelectedTracks(new Set());
    try {
      const res = await fetch(`/api/spotify-info?url=${encodeURIComponent(target)}`, {
        headers: {
          'x-spotify-client-id': clientId,
          'x-spotify-client-secret': clientSecret,
          'x-spotify-access-token': userAccessToken
        }
      });
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

  const selectAllTracks = () => {
    if (!info?.tracks) return;
    setSelectedTracks(new Set(info.tracks.map(t => t.trackNumber)));
  };

  const deselectAllTracks = () => {
    setSelectedTracks(new Set());
  };

  const toggleTrack = (trackNumber) => {
    const newSet = new Set(selectedTracks);
    if (newSet.has(trackNumber)) {
      newSet.delete(trackNumber);
    } else {
      newSet.add(trackNumber);
    }
    setSelectedTracks(newSet);
  };

  const openDownloadModal = () => {
    if (!info) return;
    if (info.trackCount > 1) {
      // pre-select all tracks by default
      selectAllTracks();
    }
    setShowDownloadModal(true);
  };

  
  useEffect(() => {
    if (activeDownloadId && !downloadState?.active) {
      reconnect(activeDownloadId);
    }
  }, [activeDownloadId]);

  const reconnect = async (dlId) => {
    downloadIdRef.current = dlId;
    setDownloadState({ active: true, status: 'Reconnecting to download...', progress: 0, trackProgress: 0, currentTrack: 0, totalTracks: 1, done: false, error: null });

    if (esRef.current) esRef.current.close();

    try {
      const res = await fetch(`/api/spotify-status?downloadId=${dlId}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      esRef.current = { close: () => { reader.cancel().catch(()=>{}); esRef.current = null; } };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';
        
        for (const chunk of chunks) {
          if (chunk.startsWith('data: ')) {
            try {
              const d = JSON.parse(chunk.slice(6));
              if (d.error && d.done) {
                 setDownloadState(prev => ({ ...prev, active: false, done: true, error: d.error }));
                 if (esRef.current) { esRef.current.close(); esRef.current = null; }
                 return;
              }
              setDownloadState(prev => {
                const next = { ...prev, ...d };
                if (!d.done) next.active = true;
                if (d.done) next.active = false;
                return next;
              });

              if (d.trackDone && d.currentTrack) {
                setTrackStatuses(prev => ({ ...prev, [d.currentTrack - 1]: 'done' }));
              }
              if (d.trackError && d.currentTrack) {
                setTrackStatuses(prev => ({ ...prev, [d.currentTrack - 1]: 'error' }));
                setTrackErrors(prev => ({ ...prev, [d.currentTrack - 1]: d.trackError }));
              }
              if (d.currentTrack && !d.trackDone && !d.trackError) {
                setTrackStatuses(prev => ({ ...prev, [d.currentTrack - 1]: 'downloading' }));
              }

              if (d.done) {
                if (esRef.current) { esRef.current.close(); esRef.current = null; }
              }
            } catch (err) {}
          }
        }
      }
    } catch (err) {
      setDownloadState(prev => ({ ...prev, active: false, done: true, error: 'Connection lost. Please try again.' }));
    }
  };
  const handleDownload = async () => {
    if (!info || downloadState?.active) return;
    if (esRef.current) esRef.current.close();
    setShowDownloadModal(false);
    
    const fmt = AUDIO_FORMATS.find(f => f.id === selectedFormat);
    const formatStr = `audio:${fmt.audioFmt}:${fmt.quality}`;
    const dlId = Date.now().toString();
    downloadIdRef.current = dlId;

    const clientId = localStorage.getItem('spotify_client_id') || '';
    const clientSecret = localStorage.getItem('spotify_client_secret') || '';
    const userAccessToken = localStorage.getItem('spotify_access_token') || '';

    if (!clientId.trim() || !clientSecret.trim()) {
      alert('Add your Spotify credentials in Settings to use Spotify features.');
      return;
    }

    // Init track statuses only for selected tracks (or all if none explicitly selected, though we pre-select)
    const initStatuses = {};
    let totalToDownload = info.trackCount || 1;
    if (info.tracks?.length) {
      let count = 0;
      info.tracks.forEach((track) => {
        if (selectedTracks.size === 0 || selectedTracks.has(track.trackNumber)) {
          initStatuses[track.trackNumber - 1] = 'pending'; // UI maps by 0-index currently
          count++;
        }
      });
      if (selectedTracks.size > 0) totalToDownload = count;
    }
    setTrackStatuses(initStatuses);
    setDownloadState({ active: true, status: 'Connecting to Spotify...', progress: 0, trackProgress: 0, currentTrack: 0, totalTracks: totalToDownload, done: false, error: null });

    const actualUrl = url === 'bulk://meta' ? bulkMeta : url;
    const params = new URLSearchParams({ 
      url: actualUrl, 
      format: formatStr, 
      downloadId: dlId,
      preset: localStorage.getItem('download_preset') || 'AUTO',
      hwaccel: localStorage.getItem('hardware_acceleration') || 'NONE',
      overrides: JSON.stringify(trackOverrides)
    });

    if (info.type === 'playlist') {
      params.append('nativePlaylist', 'true');
    } else if (selectedTracks.size > 0) {
      params.append('selectedTracks', Array.from(selectedTracks).join(','));
    }
    
    try {
      const res = await fetch(`/api/spotify-download?${params}`, {
        headers: {
          'x-spotify-client-id': clientId,
          'x-spotify-client-secret': clientSecret,
          'x-spotify-access-token': userAccessToken
        }
      });
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      esRef.current = { close: () => { reader.cancel().catch(()=>{}); esRef.current = null; } };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';
        
        for (const chunk of chunks) {
          if (chunk.startsWith('data: ')) {
            try {
              const d = JSON.parse(chunk.slice(6));
              setDownloadState(prev => {
                const next = { ...prev, ...d };
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
                  setTrackErrors(prev => ({ ...prev, [idx]: d.trackError }));
                } else if (d.trackProgress !== undefined && d.trackProgress > 0) {
                  setTrackStatuses(prev => ({ ...prev, [idx]: 'downloading' }));
                } else if (d.status?.startsWith('Search')) {
                  setTrackStatuses(prev => ({ ...prev, [idx]: 'searching' }));
                }
              }

              if (d.done) {
                if (esRef.current) { esRef.current.close(); esRef.current = null; }
              }
            } catch (err) {}
          }
        }
      }
    } catch (err) {
      setDownloadState(prev => ({ ...prev, active: false, done: true, error: 'Connection lost. Please try again.' }));
    }
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
    setTrackErrors({});
    setShowAllTracks(false);
    downloadIdRef.current = null;
  };

  const selectedFmt = AUDIO_FORMATS.find(f => f.id === selectedFormat);
  const totalDuration = info?.totalDurationMs || (info?.durationMs ? info.durationMs : 0);
  const sizeEstimate = estimateSize(totalDuration, selectedFmt?.kbps);

  const tracksToShow = useMemo(() => {
    if (!info?.tracks) return [];
    return showAllTracks ? info.tracks : info.tracks.slice(0, 5);
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
          <div className="sp-header-actions">
            {!accessToken ? (
              <button className="sp-login-btn" onClick={() => {
                const clientId = localStorage.getItem('spotify_client_id');
                if (!clientId) return alert('Please set your Client ID in Settings first!');
                const redirectUri = window.location.origin + '/';
                const scope = encodeURIComponent('playlist-read-private playlist-read-collaborative');
                window.location.href = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&show_dialog=true&_cb=${Date.now()}`;
              }}>
                <User size={16} /> Login to Spotify
              </button>
            ) : (
              <div className="sp-profile-container">
                <button className="sp-profile-btn" onClick={() => setShowProfileMenu(!showProfileMenu)}>
                  {userProfile?.images?.[0]?.url ? (
                    <img src={userProfile.images[0].url} alt="Profile" className="sp-profile-img" />
                  ) : (
                    <User size={16} />
                  )}
                  <span className="sp-profile-name">{userProfile?.display_name || 'My Profile'}</span>
                  <ChevronDown size={14} className={`sp-profile-chevron ${showProfileMenu ? 'open' : ''}`} />
                </button>

                <AnimatePresence>
                  {showProfileMenu && (
                    <motion.div 
                      className="sp-profile-dropdown"
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                    >
                      <button className="sp-dropdown-item" onClick={() => { setShowProfileMenu(false); fetchMyPlaylists(); }}>
                        <List size={16} /> My Playlists
                      </button>
                      <div className="sp-dropdown-divider" />
                      <button className="sp-dropdown-item sp-logout-item" onClick={() => {
                        localStorage.removeItem('spotify_access_token');
                        setAccessToken('');
                        setShowProfileMenu(false);
                      }}>
                        <LogOut size={16} /> Log Out
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
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

          {!showBulk ? (
            <div style={{ textAlign: 'center', marginTop: 15 }}>
              <button className="sp-bulk-btn" onClick={() => setShowBulk(true)} style={{ padding: '8px 12px', background: 'rgba(59, 130, 246, 0.2)', border: '1px solid #3b82f6', borderRadius: 8, color: '#60a5fa', cursor: 'pointer', fontSize: '0.85rem' }}>
                <ListVideo size={14} style={{ verticalAlign: 'middle', marginRight: 6 }}/>
                Peste 100 Melodii? (Spotify Mass Downloader)
              </button>
            </div>
          ) : (
            <div className="sp-bulk-container" style={{ textAlign: 'left', width: '100%', marginTop: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h3 style={{ margin: 0, color: '#fff', fontSize: '1rem' }}>Spotify Mass Downloader</h3>
                <button onClick={() => setShowBulk(false)} style={{ background: 'none', border: 'none', color: '#a0a0a0', cursor: 'pointer' }}><X size={16} /></button>
              </div>
              <p style={{ color: '#a0a0a0', fontSize: '0.8rem', marginBottom: 10 }}>
                Introdu mai jos link-ul către un <b>Playlist Spotify</b> (fără limite). Aplicația va scana automat sute de piese și le va descărca direct.
              </p>
              
              <input 
                type="text"
                value={bulkMeta}
                onChange={(e) => setBulkMeta(e.target.value)}
                placeholder="https://open.spotify.com/playlist/..."
                style={{ width: '100%', padding: '10px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 8, outline: 'none' }}
              />

              <button 
                disabled={isExtracting}
                onClick={async () => {
                  if (!bulkMeta.trim()) return;
                  const url = bulkMeta.trim();

                  if (url.includes('spotify.com/playlist')) {
                    setIsExtracting(true);
                    try {
                      const res = await fetch(`/api/spotify-info?url=${encodeURIComponent(url)}`);
                      if (res.ok) {
                        const metadata = await res.json();
                        setShowBulk(false);
                        setInfo(metadata);
                        setSelectedTracks(new Set(metadata.tracks.map((_, i) => i + 1)));
                        setUrl('bulk://meta'); // Treat it as bulk
                        setFetchStatus('done');
                      } else {
                        throw new Error('Failed to extract playlist');
                      }
                    } catch (err) {
                      console.error("Failed to extract Spotify link", err);
                      setBulkMeta("Eroare la extragerea playlist-ului. Încearcă din nou.");
                    }
                    setIsExtracting(false);
                  } else {
                    setBulkMeta("Te rugăm să introduci un link valid de Playlist Spotify.");
                  }
                }}
                style={{ width: '100%', padding: '10px', marginTop: 10, background: '#1DB954', color: '#000', fontWeight: 'bold', border: 'none', borderRadius: 8, cursor: isExtracting ? 'not-allowed' : 'pointer', opacity: isExtracting ? 0.7 : 1 }}
              >
                {isExtracting ? 'Se extrag melodiile (~30s)...' : 'Preia toate piesele'}
              </button>
            </div>
          )}
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
                  {info.coverUrl ? (
                    <img src={info.coverUrl} alt={info.title} className="sp-info-thumb" />
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
                    {info.totalTracks > 1 && (
                      <span className="sp-info-pill">
                        <Hash size={11} /> 
                        {info.trackCount < info.totalTracks 
                          ? `${info.trackCount} / ${info.totalTracks} tracks`
                          : `${info.trackCount} tracks`}
                      </span>
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
                info.type === 'playlist' ? (
                  <div className="sp-playlist-panel">
                    <div className="sp-playlist-panel-top">
                      <div className="sp-playlist-panel-icon">
                        <ListVideo size={20} />
                      </div>
                      <div>
                        <span className="sp-eyebrow">PLAYLIST GĂSIT</span>
                        <strong>{info.title}</strong>
                      </div>
                      <div className="sp-playlist-count">
                        {info.totalTracks}
                        <small>MELODI{info.totalTracks !== 1 && 'I'}</small>
                      </div>
                    </div>

                    <div className="sp-playlist-preview">
                      {tracksToShow.map((track, i) => (
                        <div key={i} className="sp-playlist-preview-row">
                          <span>{String(track.trackNumber ?? i + 1).padStart(2, '0')}</span>
                          <strong>{track.title} {track.artist && track.artist !== info.artist ? `- ${track.artist}` : ''}</strong>
                          <small>{fmtDuration(track.durationMs)}</small>
                        </div>
                      ))}
                      {info.totalTracks > 5 && !showAllTracks && (
                        <div className="sp-playlist-utility" onClick={() => setShowAllTracks(true)} style={{ cursor: 'pointer', padding: '0.5rem', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px', textAlign: 'center', marginTop: '0.5rem' }}>
                          <Music size={12} style={{ marginRight: '6px' }} />
                          Afișează încă {info.totalTracks - 5} melodii
                        </div>
                      )}
                      {showAllTracks && info.totalTracks > info.tracks.length && (
                        <div className="sp-playlist-utility" style={{ padding: '0.5rem', color: '#9ca3af', textAlign: 'center', marginTop: '0.5rem' }}>
                          (Spotify ascunde restul de {info.totalTracks - info.tracks.length} piese. Loghează-te în Setări cu API keys pentru a le vedea pe toate.)
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
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
                      {info.type !== 'playlist' && info.trackCount > 5 && !showAllTracks && (
                        <div className="sp-tracklist-utility" onClick={() => setShowAllTracks(true)} style={{ cursor: 'pointer' }}>
                          <Music size={12} />
                          și încă {info.trackCount - 5} melodii descărcabile... (Apasă pentru a vedea tot)
                        </div>
                      )}
                      {info.type !== 'playlist' && info.trackCount < info.totalTracks && (
                        <div className="sp-tracklist-utility" style={{ color: '#fb923c', background: 'rgba(251,146,60,0.1)' }}>
                          <AlertCircle size={12} />
                          + alte {info.totalTracks - info.trackCount} melodii ascunse/indisponibile
                        </div>
                      )}
                    </div>
                  </div>
                )
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Download Action ── */}
        <AnimatePresence>
          {info && fetchStatus === 'done' && !downloadState && (
            <motion.div className="sp-dl-actions" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <button
                className={`sp-dl-btn ${info.trackCount === 1 ? 'sp-single-dl-btn' : 'sp-playlist-dl-btn'}`}
                onClick={openDownloadModal}
              >
                {info.trackCount > 1 ? <><List size={22} /> Descarcă playlistul</> : <><Download size={22} /> Descarcă acum</>}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Download Modal ── */}
        <AnimatePresence>
          {showDownloadModal && info && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="sp-modal-overlay"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="sp-modal"
              >
                <h3 className="sp-modal-title">
                  Setări descărcare {info.trackCount > 1 && 'Playlist'}
                </h3>

                <div className="sp-modal-settings">
                  <div className="sp-setting-group">
                    <span className="sp-setting-label">Formatul dorit</span>
                    <div className="sp-format-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
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
                        </button>
                      ))}
                    </div>
                  </div>

                  {info.trackCount > 1 && info.tracks && (
                    <div className="sp-track-selection-section">
                      <div className="sp-track-selection-header">
                        <label className="sp-modal-label">
                          {info.type === 'playlist' ? 'MELODIILE DIN PLAYLIST' : `SELECTEAZĂ MELODIILE (${selectedTracks.size} ALESE)`}
                        </label>
                        {info.type !== 'playlist' && (
                          <div className="sp-track-utils">
                            <button className="sp-track-util-btn" onClick={selectAllTracks}>Toate</button>
                            <button className="sp-track-util-btn" onClick={deselectAllTracks}>Niciuna</button>
                          </div>
                        )}
                      </div>
                      <div className="track-list">
                        {info.tracks?.slice(0, info.type === 'playlist' ? 5 : undefined).map((track) => {
                          const isSelected = info.type === 'playlist' || selectedTracks.has(track.trackNumber);
                          return (
                            <div
                              key={track.trackNumber}
                              className={`sp-track-item ${isSelected ? 'selected' : ''}`}
                              onClick={() => info.type !== 'playlist' && toggleTrack(track.trackNumber)}
                              style={{ cursor: info.type === 'playlist' ? 'default' : 'pointer' }}
                            >
                              {info.type !== 'playlist' && <div className="sp-track-checkbox" />}
                              <span className="sp-track-index">{track.trackNumber}.</span>
                              <span className="sp-track-name">{track.title} {track.artist && track.artist !== info.artist ? `- ${track.artist}` : ''}</span>
                              <span className="sp-track-duration">{fmtDuration(track.durationMs)}</span>
                            </div>
                          );
                        })}
                        {info.type === 'playlist' && info.totalTracks > 5 && (
                          <p style={{textAlign: 'center', marginTop: '10px', fontSize: '0.9rem', color: 'rgba(255,255,255,0.5)'}}>
                            ... și încă {info.totalTracks - 5} melodii...
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {sizeEstimate && (
                    <div className="sp-format-summary" style={{ marginTop: '1rem' }}>
                      <Archive size={13} />
                      <span>Estimated size: <strong>{sizeEstimate}</strong></span>
                    </div>
                  )}
                </div>

                <div className="sp-modal-actions">
                  <button className="sp-modal-cancel" onClick={() => setShowDownloadModal(false)}>
                    Anulează
                  </button>
                  <button
                    className="sp-modal-confirm"
                    onClick={handleDownload}
                    disabled={info.trackCount > 1 && selectedTracks.size === 0}
                  >
                    Începe descărcarea
                  </button>
                </div>
              </motion.div>
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
                  {info.tracks.filter(t => selectedTracks.size === 0 || selectedTracks.has(t.trackNumber)).slice(0, 20).map((track, i) => (
                    <TrackRow
                      key={track.trackNumber}
                      track={track}
                            overrideUrl={trackOverrides[track.trackNumber - 1]}
                            onOverrideChange={(val) => setTrackOverrides(prev => ({ ...prev, [track.trackNumber - 1]: val }))}
                      status={trackStatuses[track.trackNumber - 1] || 'pending'}
                      progress={track.trackNumber === downloadState.currentTrack ? downloadState.trackProgress : 0}
                      errorText={trackErrors[track.trackNumber - 1]}
                    />
                  ))}
                  {info.tracks.filter(t => selectedTracks.size === 0 || selectedTracks.has(t.trackNumber)).length > 20 && (
                    <div className="sp-dl-tracklist-more">+{info.tracks.filter(t => selectedTracks.size === 0 || selectedTracks.has(t.trackNumber)).length - 20} more tracks</div>
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

      <AnimatePresence>
        {showPlaylists && (
          <motion.div 
            className="sp-playlists-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => e.target === e.currentTarget && setShowPlaylists(false)}
          >
            <motion.div 
              className="sp-playlists-content"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <div className="sp-playlists-header">
                <h2>My Playlists</h2>
                {!accessToken ? (
                <button className="sp-login-btn" onClick={() => setShowPlaylists(!showPlaylists)}>
                  <User size={18} /> Login to Spotify
                </button>
              ) : (
                <button className="sp-login-btn sp-logged-in-btn" onClick={() => setShowPlaylists(!showPlaylists)}>
                  <User size={18} /> My Playlists
                </button>
              )}
              </div>
              
              {myPlaylistsStatus === 'loading' && (
                <div className="sp-pl-loading">
                  <Loader2 className="sp-spin" size={32} />
                  <span>Fetching your playlists...</span>
                </div>
              )}
              {myPlaylistsStatus === 'error' && (
                <div className="sp-pl-error">
                  <AlertCircle size={24} />
                  <span>Failed to load playlists. Your token may have expired. Please log in again.</span>
                </div>
              )}
              
              {myPlaylistsStatus === 'done' && (
                <div className="sp-playlists-grid">
                  {myPlaylists?.map(p => (
                    <div key={p.id} className="sp-playlist-card" onClick={() => {
                      setShowPlaylists(false);
                      setUrl(p.external_urls.spotify);
                      fetchInfo(p.external_urls.spotify);
                    }}>
                      <img src={p.images?.[0]?.url || 'https://via.placeholder.com/150'} alt="" />
                      <div className="sp-playlist-meta">
                        <div className="sp-playlist-title">{p.name}</div>
                        <div className="sp-playlist-owner">{p.owner?.display_name} • {p.tracks?.total ?? '?'} tracks</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}
