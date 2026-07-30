import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Music, Download, Loader2, AlertCircle, CheckCircle2,
  Link2, List, Disc, Search, RefreshCw, Clipboard,
  X, ChevronDown, ChevronUp, FolderOpen, Clock,
  Star, Calendar, Hash, Archive, Play, User, LogOut, ListVideo, HardDrive,
  Zap, Activity, Cpu, Check, LayoutGrid, XCircle, Pause, CalendarClock
} from 'lucide-react';
import { getAverageColor } from './utils/colorUtils';
import WaveformBg from './WaveformBg';
import { storage } from './storage';
import './SpotifyDownloader.css';

// ── Constants ──────────────────────────────────────────────────────────────────

const AUDIO_FORMATS = [
  { id: 'mp3_320', label: '320kbps MP3', sub: 'Best Quality', ext: 'mp3', quality: '0', audioFmt: 'mp3', kbps: 320 },
  { id: 'mp3_192', label: '192kbps MP3', sub: 'Balanced',     ext: 'mp3', quality: '5', audioFmt: 'mp3', kbps: 192 },
  { id: 'mp3_128', label: '128kbps MP3', sub: 'Compressed',   ext: 'mp3', quality: '9', audioFmt: 'mp3', kbps: 128 },
  { id: 'ogg',     label: 'OGG Vorbis',  sub: 'Open Format',  ext: 'ogg', quality: '0', audioFmt: 'vorbis', kbps: 192 },
  { id: 'wav',     label: 'WAV',          sub: 'Lossless',     ext: 'wav', quality: '0', audioFmt: 'wav',    kbps: 1411 },
];

const SPOTIFY_SUGGESTIONS = [
  { label: 'Blinding Lights',       url: 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b', tag: 'Track',    color: '#1DB954' },
  { label: 'As It Was - Harry',     url: 'https://open.spotify.com/track/4H9oo2bPD4hpgGhubGbWRT', tag: 'Track',    color: '#1DB954' },
  { label: 'Bohemian Rhapsody',     url: 'https://open.spotify.com/track/3z8h0TU7ReDPLIbEnYhWZb', tag: 'Track',    color: '#1DB954' },
  { label: 'Starboy - The Weeknd',  url: 'https://open.spotify.com/track/7MXVkk9YMctZqd1Srtv4MB', tag: 'Track',    color: '#1DB954' },
  { label: '1989 - Taylor Swift',   url: 'https://open.spotify.com/album/64LU4c1Vi6eBk7QMnR6AN9', tag: 'Album',    color: '#818cf8' },
  { label: 'DAMN. - Kendrick',      url: 'https://open.spotify.com/album/4eLPsYPBmXABThSJ821sqY', tag: 'Album',    color: '#818cf8' },
  { label: 'After Hours - Weeknd',  url: 'https://open.spotify.com/album/4yP0hdKOZPNshxUOjY0cZj', tag: 'Album',    color: '#818cf8' },
  { label: 'Top 50 Global',         url: 'https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2tF', tag: 'Playlist', color: '#fb923c' },
  { label: 'Hot Hits',              url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', tag: 'Playlist', color: '#fb923c' },
  { label: 'Lo-Fi Beats',           url: 'https://open.spotify.com/playlist/37i9dQZF1DWWQRwui0ExPn', tag: 'Playlist', color: '#fb923c' },
];

// ── Utility functions ──────────────────────────────────────────────────────────

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

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SpotifyBadge({ type }) {
  const colors = {
    track:    { bg: 'rgba(29,185,84,0.12)',  color: '#1DB954', border: 'rgba(29,185,84,0.3)' },
    album:    { bg: 'rgba(99,102,241,0.12)', color: '#818cf8', border: 'rgba(99,102,241,0.3)' },
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

// ── Auth helpers ───────────────────────────────────────────────────────────────

async function getValidAccessToken(clientId, clientSecret) {
  const expiresAt = parseInt(storage.getItem('spotify_expires_at') || '0', 10);
  const accessToken = storage.getItem('spotify_access_token') || '';
  const refreshToken = storage.getItem('spotify_refresh_token') || '';

  if (accessToken && Date.now() < expiresAt - 60000) return accessToken;

  if (refreshToken && clientId && clientSecret) {
    try {
      const res = await fetch('/api/spotify-refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-spotify-client-id': clientId,
          'x-spotify-client-secret': clientSecret,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const data = await res.json();
      if (data.access_token) {
        storage.setItem('spotify_access_token', data.access_token);
        storage.setItem('spotify_expires_at', Date.now() + data.expires_in * 1000);
        if (data.refresh_token) storage.setItem('spotify_refresh_token', data.refresh_token);
        return data.access_token;
      }
    } catch (e) {
      console.warn('[spotify] Token refresh failed:', e);
    }
  }
  if (expiresAt && Date.now() >= expiresAt - 60000) {
    clearSpotifyAuth();
    return '';
  }
  return accessToken;
}

function clearSpotifyAuth() {
  storage.removeItem('spotify_access_token');
  storage.removeItem('spotify_refresh_token');
  storage.removeItem('spotify_expires_at');
}

// ── Artist Bubbles ─────────────────────────────────────────────────────────────

const BUBBLE_POSITIONS = [
  { x: 42, y: 50 }, { x: 65, y: 40 }, { x: 25, y: 65 }, { x: 75, y: 60 }, { x: 30, y: 35 },
  { x: 55, y: 70 }, { x: 85, y: 35 }, { x: 15, y: 45 }, { x: 45, y: 25 }, { x: 70, y: 75 },
];

function ArtistBubbles({ artists, onRemove }) {
  if (!artists || artists.length === 0) {
    return (
      <div className="sp-artist-bubbles sp-artist-bubbles--empty">
        <div className="sp-bubbles-empty-hint">
          <div className="sp-bubbles-empty-icon"><User size={28} /></div>
          <span>Download something<br />to see artists here</span>
        </div>
      </div>
    );
  }

  return (
    <div className="sp-artist-bubbles">
      <motion.div
        className="sp-bubbles-field"
        animate={{ rotate: [0, 3, -2, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      >
        {artists.slice(0, 10).map((artist, i) => {
          const pos = BUBBLE_POSITIONS[i % BUBBLE_POSITIONS.length];
          const dx1 = (i % 3 === 0 ? 15 : i % 2 === 0 ? -12 : 8) + (i * 1.5);
          const dx2 = (i % 2 === 0 ? -10 : i % 3 === 0 ? 12 : -15) - i;
          const dy1 = (i % 2 === 0 ? 12 : i % 3 === 0 ? -14 : 10) + i;
          const dy2 = (i % 3 === 0 ? -10 : i % 2 === 0 ? 15 : -8) - (i * 1.2);
          return (
            <div key={artist.name + i} className="sp-bubble-wrapper" style={{ position: 'absolute', left: `${pos.x}%`, top: `${pos.y}%`, width: 140, height: 140, transform: 'translate(-50%, -50%)', zIndex: 1 }}>
              <motion.div
                className="sp-bubble"
                style={{ position: 'relative', left: 0, top: 0, width: '100%', height: '100%', transform: 'none' }}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1, x: [0, dx1, dx2, 0], y: [0, dy1, dy2, 0] }}
                transition={{
                  opacity: { duration: 0.5, delay: i * 0.12 },
                  scale: { duration: 0.5, delay: i * 0.12, type: 'spring', bounce: 0.4 },
                  x: { duration: 15 + i * 1.5, repeat: Infinity, ease: 'easeInOut', delay: i * 0.2 },
                  y: { duration: 18 + i * 1.2, repeat: Infinity, ease: 'easeInOut', delay: i * 0.3 },
                }}
              >
                {artist.thumbnail ? (
                  <img src={artist.thumbnail} alt={artist.name} className="sp-bubble-img" />
                ) : (
                  <div className="sp-bubble-fallback"><User size={140 * 0.35} /></div>
                )}
                <div className="sp-bubble-name">{artist.name}</div>
                <button className="sp-bubble-delete" onClick={(e) => { e.stopPropagation(); if (onRemove) onRemove(artist.name); }} title="Remove artist from history">
                  <X size={14} />
                </button>
              </motion.div>
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function SpotifyDownloader({ activeDownloadId }) {

  // ─── Core state ───────────────────────────────────────────────────────────
  const [url, setUrl] = useState('');
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [ambientColor, setAmbientColor] = useState('rgba(29, 185, 84, 0.12)');
  const [hasCookies, setHasCookies] = useState(true);

  // Info / fetch
  const [info, setInfo] = useState(null);
  const [fetchStatus, setFetchStatus] = useState('idle'); // idle | loading | done | error
  const [fetchError, setFetchError] = useState('');
  const [error, setError] = useState(null); // ← FIXED: was never declared

  // Format & track selection
  const [selectedFormat, setSelectedFormat] = useState('mp3_320');
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [selectedTracks, setSelectedTracks] = useState(new Set());
  const [playlistViewMode, setPlaylistViewMode] = useState('list'); // ← NEW: 'list' | 'grid'

  // Download state
  const [downloadState, setDownloadState] = useState(null);
  const [trackStatuses, setTrackStatuses] = useState({});
  const [trackErrors, setTrackErrors] = useState({});
  const [trackOverrides, setTrackOverrides] = useState({});
  const [step, setStep] = useState(0); // ← NEW: 0=idle, 1=connecting, 2=downloading, 3=finalizing, 4=done
  const [missingTracks, setMissingTracks] = useState(null); // ← NEW

  // Retry / bulk meta — FIXED: was never declared, caused retryFailedTracks to crash
  const [bulkMeta, setBulkMeta] = useState('');

  // Auth
  const [clipboardToast, setClipboardToast] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [myPlaylists, setMyPlaylists] = useState(null);
  const [myPlaylistsStatus, setMyPlaylistsStatus] = useState('idle');
  const [showPlaylists, setShowPlaylists] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  // ─── NEW: Download options ─────────────────────────────────────────────────
  const [scheduleTime, setScheduleTime] = useState('');
  const [localCustomPath, setLocalCustomPath] = useState('');
  const [prependNumbers, setPrependNumbers] = useState(() => {
    const saved = localStorage.getItem('sp_prepend_numbers');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [prefixAlbumFolders, setPrefixAlbumFolders] = useState(() => {
    const saved = localStorage.getItem('sp_prefix_album_folders');
    return saved !== null ? JSON.parse(saved) : true;
  });

  // ─── NEW: System status ────────────────────────────────────────────────────
  const [systemStatus, setSystemStatus] = useState(null);
  const [isStatusExpanded, setIsStatusExpanded] = useState(false);

  // ─── NEW: Lifetime stats ───────────────────────────────────────────────────
  const [lifetimeStats, setLifetimeStats] = useState({ tracks: 0, albums: 0, playlists: 0, total: 0 });

  // Refs
  const downloadIdRef = useRef(null);
  const esRef = useRef(null);
  const inputRef = useRef(null);

  // ─── Computed ──────────────────────────────────────────────────────────────
  const spotifyType = isSpotifyUrl(url) ? getSpotifyType(url) : null;
  const isDownloading = downloadState?.active && !downloadState?.done;
  const isDone = downloadState?.done;
  const hasError = downloadState?.done && downloadState?.error;
  const isSuccess = downloadState?.done && !downloadState?.error;

  const selectedFmt = AUDIO_FORMATS.find(f => f.id === selectedFormat);
  const totalDuration = info?.totalDurationMs || (info?.durationMs ? info.durationMs : 0);
  const sizeEstimate = estimateSize(totalDuration, selectedFmt?.kbps);

  const tracksToShow = useMemo(() => {
    if (!info?.tracks) return [];
    return showAllTracks ? info.tracks : info.tracks.slice(0, 10);
  }, [info, showAllTracks]);

  const historyArtists = useMemo(() => {
    const seen = new Set();
    const artists = [];
    for (const h of history) {
      const type = h.url ? getSpotifyType(h.url) : null;
      if (type === 'playlist') continue;
      const name = h.artist;
      if (name && !seen.has(name)) {
        seen.add(name);
        artists.push({ name, thumbnail: h.artistThumbnail || null });
      }
    }
    return artists;
  }, [history]);

  // ─── Effects ───────────────────────────────────────────────────────────────

  // Load history from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('sp_history');
      if (saved) setHistory(JSON.parse(saved));
    } catch {}
  }, []);

  // Check cookies
  useEffect(() => {
    fetch('/api/cookies/status')
      .then(res => res.json())
      .then(data => { if (data?.hasCookies !== undefined) setHasCookies(data.hasCookies); })
      .catch(() => {});
  }, []);

  // NEW: System status polling
  useEffect(() => {
    const fetchSysStatus = async () => {
      try {
        const res = await fetch('/api/ytdl/system-status');
        if (res.ok) setSystemStatus(await res.json());
      } catch {}
    };
    fetchSysStatus();
    const interval = setInterval(fetchSysStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // NEW: Lifetime stats from global_history
  useEffect(() => {
    const calcStats = () => {
      try {
        const gHist = JSON.parse(localStorage.getItem('global_history') || '[]');
        const spotifyItems = gHist.filter(i => i.source === 'spotify');
        setLifetimeStats({
          tracks: spotifyItems.filter(i => i.spotifyType === 'track').length,
          albums: spotifyItems.filter(i => i.spotifyType === 'album').length,
          playlists: spotifyItems.filter(i => i.spotifyType === 'playlist').length,
          total: spotifyItems.length,
        });
      } catch {}
    };
    calcStats();
    window.addEventListener('history_updated', calcStats);
    return () => window.removeEventListener('history_updated', calcStats);
  }, []);

  // NEW: Smart clipboard auto-detect on window focus
  useEffect(() => {
    const handleFocus = async () => {
      if (downloadState?.active || info || fetchStatus === 'loading') return;
      try {
        const text = await navigator.clipboard.readText();
        if (text && isSpotifyUrl(text) && text !== url) {
          setUrl(text);
          setClipboardToast(true);
          setTimeout(() => setClipboardToast(false), 3000);
        }
      } catch {}
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [url, downloadState?.active, info, fetchStatus]);

  // Reset local custom path when download modal opens
  useEffect(() => {
    if (showDownloadModal) {
      setLocalCustomPath(localStorage.getItem('customPath') || '');
    }
  }, [showDownloadModal]);

  // Emit download_update for Dynamic Island
  useEffect(() => {
    const isActive = downloadState?.active && !downloadState?.done;
    if (isActive) {
      const completed = Object.values(trackStatuses).filter(s => s === 'done').length;
      const total = downloadState.totalTracks ?? 1;
      const pct = downloadState.progress ?? 0;
      window.dispatchEvent(new CustomEvent('download_update', {
        detail: {
          source: 'spotify', progress: pct,
          status: `${completed} / ${total} tracks`,
          thumbnail: info?.coverUrl || info?.thumbnail || null,
          title: info?.title || info?.name || 'Spotify', done: false,
        }
      }));
    } else if (downloadState?.done && !downloadState?.error) {
      window.dispatchEvent(new CustomEvent('download_update', { detail: { source: 'spotify', done: true } }));
    } else if (downloadState?.done && downloadState?.error) {
      window.dispatchEvent(new CustomEvent('download_update', { detail: { source: 'spotify', error: true } }));
    }
  }, [downloadState, trackStatuses, info]);

  // Auth check + OAuth code exchange
  useEffect(() => {
    const checkAuth = async () => {
      const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID || '';
      const clientSecret = import.meta.env.VITE_SPOTIFY_CLIENT_SECRET || '';
      const storedToken = await getValidAccessToken(clientId, clientSecret);
      if (storedToken) setAccessToken(storedToken);

      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      if (code) {
        window.history.replaceState({}, null, '/');
        if (!clientSecret) {
          alert('Missing Spotify Client Secret! Please add it in Settings.');
        } else if (clientId && clientSecret) {
          try {
            const res = await fetch('/api/spotify-oauth', {
              method: 'POST',
              headers: { 'x-spotify-client-id': clientId, 'x-spotify-client-secret': clientSecret, 'Content-Type': 'application/json' },
              body: JSON.stringify({ code, redirectUri: window.location.origin + '/' })
            });
            const data = await res.json();
            if (data.access_token) {
              localStorage.setItem('spotify_access_token', data.access_token);
              if (data.refresh_token) localStorage.setItem('spotify_refresh_token', data.refresh_token);
              if (data.expires_in) localStorage.setItem('spotify_expires_at', Date.now() + data.expires_in * 1000);
              setAccessToken(data.access_token);
            } else {
              console.error(`Spotify token error: ${data.error || 'Unknown'}`);
            }
          } catch (err) {
            alert(`Network error during Spotify auth: ${err.message}`);
          }
        }
      }
    };
    checkAuth();
  }, []);

  // Fetch user profile
  useEffect(() => {
    if (accessToken) {
      fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${accessToken}` } })
        .then(async r => {
          if (r.status === 401) {
            const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID || '';
            const clientSecret = import.meta.env.VITE_SPOTIFY_CLIENT_SECRET || '';
            const newToken = await getValidAccessToken(clientId, clientSecret);
            if (newToken && newToken !== accessToken) { setAccessToken(newToken); } else { clearSpotifyAuth(); setAccessToken(''); }
            throw new Error('Unauthorized');
          }
          return r.json();
        })
        .then(data => { if (data && !data.error) setUserProfile(data); })
        .catch(() => {});
    } else {
      setUserProfile(null);
    }
  }, [accessToken]);

  // Global shortcuts and paste
  useEffect(() => {
    const handlePaste = (e) => { setUrl(e.detail); setInfo(null); setError(null); setFetchStatus('idle'); setFetchError(''); };
    const handleDownloadShortcut = () => { if (info && !downloadState?.active) openDownloadModal(); };
    window.addEventListener('app:paste-url', handlePaste);
    window.addEventListener('app:global-download', handleDownloadShortcut);
    return () => {
      window.removeEventListener('app:paste-url', handlePaste);
      window.removeEventListener('app:global-download', handleDownloadShortcut);
    };
  }, [info, downloadState?.active]);

  // Reconnect to active download on mount
  useEffect(() => {
    if (activeDownloadId && !downloadState?.active) {
      reconnect(activeDownloadId);
    }
  }, [activeDownloadId]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const saveToHistory = (newUrl, title, thumbnail, artist, artistThumbnail, isCollection = false) => {
    if (!newUrl) return;
    setHistory(prev => {
      const filtered = prev.filter(item => item.url !== newUrl);
      const updated = [
        { url: newUrl, title: title || newUrl, thumbnail, artist: artist || '', artistThumbnail: artistThumbnail || null, isCollection, date: Date.now() },
        ...filtered
      ].slice(0, 10);
      localStorage.setItem('sp_history', JSON.stringify(updated));
      return updated;
    });
  };

  const removeFromHistory = (urlToRemove) => {
    setHistory(prev => {
      const updated = prev.filter(item => item.url !== urlToRemove);
      localStorage.setItem('sp_history', JSON.stringify(updated));
      return updated;
    });
  };

  const removeArtistFromHistory = (artistName) => {
    setHistory(prev => {
      const updated = prev.filter(item => (item.artist || item.title) !== artistName);
      localStorage.setItem('sp_history', JSON.stringify(updated));
      return updated;
    });
  };

  const fetchMyPlaylists = useCallback(async () => {
    if (!accessToken) return;
    setShowPlaylists(true);
    setMyPlaylistsStatus('loading');
    try {
      const res = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.status === 401) { clearSpotifyAuth(); setAccessToken(''); throw new Error('Token expired'); }
      const data = await res.json();
      setMyPlaylists(data.items);
      setMyPlaylistsStatus('done');
    } catch {
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
      setFetchError('Artist pages are not supported. Please use a track, album, or playlist URL.');
      setFetchStatus('error');
      return;
    }

    const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID || '';
    const clientSecret = import.meta.env.VITE_SPOTIFY_CLIENT_SECRET || '';
    const userAccessToken = await getValidAccessToken(clientId, clientSecret);
    if (userAccessToken !== accessToken) {
      if (userAccessToken) localStorage.setItem('spotify_access_token', userAccessToken);
      setAccessToken(userAccessToken);
    }

    if (!clientId.trim() || !clientSecret.trim()) {
      setFetchError('Add your Spotify credentials in Settings to use Spotify features.');
      setFetchStatus('error');
      return;
    }

    setFetchStatus('loading');
    setFetchError('');
    setError(null);
    setInfo(null);
    setDownloadState(null);
    setTrackStatuses({});
    setShowAllTracks(false);
    setShowDownloadModal(false);
    setSelectedTracks(new Set());
    setStep(0);
    setMissingTracks(null);

    try {
      const res = await fetch(`/api/spotify-info?url=${encodeURIComponent(target)}`, {
        headers: {
          'x-spotify-client-id': clientId,
          'x-spotify-client-secret': clientSecret,
          'x-spotify-access-token': userAccessToken,
        }
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        if (data.error === 'artist_not_supported') throw new Error('Artist pages are not supported. Please use a track, album, or playlist URL.');
        throw new Error(data.error || 'Failed to fetch info');
      }
      setInfo(data);

      const imgUrl = data.coverUrl || data.thumbnail || data.playlistCover || data.artistThumbnail || data.ownerThumbnail;
      if (imgUrl) {
        getAverageColor(imgUrl).then(color => {
          setAmbientColor(color.replace('rgb', 'rgba').replace(')', ', 0.15)'));
        });
      } else {
        setAmbientColor('rgba(29, 185, 84, 0.12)');
      }

      if (data.type !== 'track' && data.tracks) {
        setSelectedTracks(new Set(data.tracks.map(t => t.trackNumber)));
      } else {
        setSelectedTracks(new Set());
      }

      const isCollection = data.type !== 'track';
      saveToHistory(
        target,
        data.title || data.name,
        data.coverUrl || data.thumbnail || data.playlistCover,
        data.artist || data.owner || '',
        data.artistThumbnail || data.ownerThumbnail || null,
        isCollection,
      );
      setFetchStatus('done');
    } catch (e) {
      setFetchError(e.message || 'Could not fetch Spotify info.');
      setFetchStatus('error');
    }
  }, [url, accessToken]);

  const handleKeyDown = (e) => { if (e.key === 'Enter') fetchInfo(); };

  const selectAllTracks = () => {
    if (!info?.tracks) return;
    setSelectedTracks(new Set(info.tracks.map(t => t.trackNumber)));
  };

  const deselectAllTracks = () => setSelectedTracks(new Set());

  const toggleTrack = (trackNumber) => {
    const newSet = new Set(selectedTracks);
    if (newSet.has(trackNumber)) newSet.delete(trackNumber);
    else newSet.add(trackNumber);
    setSelectedTracks(newSet);
  };

  const openDownloadModal = () => {
    if (!info) return;
    if (info.trackCount > 1) selectAllTracks();
    setShowDownloadModal(true);
  };

  const handleQuickDownload = (trackNumber) => {
    if (downloadState?.active) return;
    setSelectedTracks(new Set([trackNumber]));
    setShowDownloadModal(true);
  };

  const reconnect = async (dlId) => {
    downloadIdRef.current = dlId;
    setDownloadState({ active: true, status: 'Reconnecting to download...', progress: 0, trackProgress: 0, currentTrack: 0, totalTracks: 1, done: false, error: null });
    setStep(1);
    if (esRef.current) esRef.current.close();

    try {
      const res = await fetch(`/api/spotify-status?downloadId=${dlId}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      esRef.current = { close: () => { reader.cancel().catch(() => {}); esRef.current = null; } };

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
                setStep(0);
                if (esRef.current) { esRef.current.close(); esRef.current = null; }
                return;
              }
              setDownloadState(prev => {
                const next = { ...prev, ...d };
                if (!d.done) next.active = true;
                if (d.done) next.active = false;
                return next;
              });
              if (d.progress > 0 && d.progress < 95) setStep(2);
              if (d.progress >= 95) setStep(3);
              if (d.trackDone && d.currentTrack) setTrackStatuses(prev => ({ ...prev, [d.currentTrack - 1]: 'done' }));
              if (d.trackError && d.currentTrack) {
                setTrackStatuses(prev => ({ ...prev, [d.currentTrack - 1]: 'error' }));
                setTrackErrors(prev => ({ ...prev, [d.currentTrack - 1]: d.trackError }));
              }
              if (d.currentTrack && !d.trackDone && !d.trackError) setTrackStatuses(prev => ({ ...prev, [d.currentTrack - 1]: 'downloading' }));
              if (d.done) {
                setStep(4);
                if (esRef.current) { esRef.current.close(); esRef.current = null; }
                if (!d.error) {
                  const savedFilename = d.finalFilename || d.zipPath || d.collectionTitle;
                  if (savedFilename) {
                    try {
                      let h = JSON.parse(localStorage.getItem('global_history') || '[]');
                      h.unshift({ title: d.collectionTitle || d.finalFilename || info?.title || 'Unknown', artist: info?.artists?.[0]?.name || info?.owner || 'Spotify', thumbnail: info?.coverUrl || info?.thumbnail, format: 'audio:mp3', filename: savedFilename, source: 'spotify', spotifyType: d.spotifyType || info?.type || 'track', id: Date.now().toString(), date: new Date().toISOString() });
                      if (h.length > 500) h.length = 500;
                      localStorage.setItem('global_history', JSON.stringify(h));
                      window.dispatchEvent(new Event('history_updated'));
                    } catch {}
                  }
                }
              }
            } catch {}
          }
        }
      }
    } catch {
      setDownloadState(prev => ({ ...prev, active: false, done: true, error: 'Connection lost. Please try again.' }));
      setStep(0);
    }
  };

  // FIXED: retryFailedTracks now works because bulkMeta is properly declared
  const retryFailedTracks = () => {
    if (!downloadState || !downloadState.failedTracksData || downloadState.failedTracksData.length === 0) return;
    const failedData = downloadState.failedTracksData;
    const retryInfo = {
      type: 'album',
      title: `Retry: ${downloadState.collectionTitle}`,
      artist: 'Failed Tracks',
      coverUrl: info?.coverUrl || null,
      trackCount: failedData.length,
      tracks: failedData.map((t, idx) => ({ trackNumber: idx + 1, title: t.title, artist: t.artist, duration: t.duration || 0, spotifyUrl: t.spotifyUrl || null }))
    };
    setInfo(retryInfo);
    setUrl('bulk://meta');
    setBulkMeta(JSON.stringify(retryInfo));
    setDownloadState(null);
    setTrackStatuses({});
    setMissingTracks(null);
    setSelectedTracks(new Set(retryInfo.tracks.map(t => t.trackNumber)));
    setShowDownloadModal(true);
  };

  const handleDownload = async () => {
    if (!info || downloadState?.active) return;
    if (esRef.current) esRef.current.close();
    setShowDownloadModal(false);
    setStep(1);
    setMissingTracks(null);

    const fmt = AUDIO_FORMATS.find(f => f.id === selectedFormat);
    const formatStr = `audio:${fmt.audioFmt}:${fmt.quality}`;
    const dlId = Date.now().toString();
    downloadIdRef.current = dlId;

    const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID || '';
    const clientSecret = import.meta.env.VITE_SPOTIFY_CLIENT_SECRET || '';
    const userAccessToken = localStorage.getItem('spotify_access_token') || '';

    if (!clientId.trim() || !clientSecret.trim()) {
      alert('Add your Spotify credentials in Settings to use Spotify features.');
      setStep(0);
      return;
    }

    const initStatuses = {};
    let totalToDownload = info.trackCount || 1;
    if (info.tracks?.length) {
      let count = 0;
      info.tracks.forEach((track) => {
        if (selectedTracks.size === 0 || selectedTracks.has(track.trackNumber)) {
          initStatuses[track.trackNumber - 1] = 'pending';
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
      embedLyrics: localStorage.getItem('spotdl_lyrics') === 'true' ? 'true' : 'false',
      overrides: JSON.stringify(trackOverrides),
      prependNumbers: prependNumbers.toString(),         // ← NEW
      customPath: localCustomPath || localStorage.getItem('customPath') || '',  // ← NEW
    });
    if (scheduleTime) params.append('scheduleTime', scheduleTime); // ← NEW
    if (info.type === 'playlist') params.append('nativePlaylist', 'true');
    if (selectedTracks.size > 0) params.append('selectedTracks', Array.from(selectedTracks).join(','));

    try {
      const res = await fetch(`/api/spotify-download?${params}`, {
        headers: {
          'x-spotify-client-id': clientId,
          'x-spotify-client-secret': clientSecret,
          'x-spotify-access-token': userAccessToken,
        }
      });

      // Handle scheduled response
      const ct = res.headers.get('content-type');
      if (ct && ct.includes('application/json')) {
        const data = await res.json();
        if (data.scheduled) {
          setDownloadState({ active: false, done: true, status: `Scheduled for ${scheduleTime}`, progress: 100, scheduled: true });
          setStep(4);
          return;
        }
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      esRef.current = { close: () => { reader.cancel().catch(() => {}); esRef.current = null; } };

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

              // Step timeline updates
              if (d.status?.toLowerCase().includes('search') || d.status?.toLowerCase().includes('connect')) setStep(1);
              if (d.progress > 0 && d.progress < 95) setStep(2);
              if (d.progress >= 95 || d.status?.toLowerCase().includes('finaliz')) setStep(3);

              // Per-track status updates
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
                setStep(4);
                if (esRef.current) { esRef.current.close(); esRef.current = null; }

                // Check for missing tracks
                if (!d.error && d.completedTracks !== undefined && d.totalTracks !== undefined) {
                  if (d.completedTracks < d.totalTracks) {
                    setMissingTracks({ actual: d.completedTracks, expected: d.totalTracks, failed: d.failedTracksData || [] });
                  }
                }

                if (!d.error) {
                  const savedFilename = d.finalFilename || d.zipPath || d.collectionTitle;
                  if (savedFilename) {
                    try {
                      let h = JSON.parse(localStorage.getItem('global_history') || '[]');
                      h.unshift({ title: d.collectionTitle || d.finalFilename || info?.title || 'Unknown', artist: info?.artists?.[0]?.name || info?.owner || 'Spotify', thumbnail: info?.coverUrl || info?.thumbnail, format: 'audio:mp3', filename: savedFilename, source: 'spotify', spotifyType: d.spotifyType || info?.type || 'track', id: Date.now().toString(), date: new Date().toISOString() });
                      if (h.length > 500) h.length = 500;
                      localStorage.setItem('global_history', JSON.stringify(h));
                      window.dispatchEvent(new Event('history_updated'));
                    } catch {}
                  }
                }
              }
            } catch {}
          }
        }
      }
    } catch {
      setDownloadState(prev => ({ ...prev, active: false, done: true, error: 'Connection lost. Please try again.' }));
      setStep(0);
    }
  };

  const handleCancel = async () => {
    if (esRef.current) esRef.current.close();
    if (downloadIdRef.current) {
      try { await fetch(`/api/spotify-cancel?downloadId=${downloadIdRef.current}`); } catch {}
    }
    setDownloadState(prev => ({ ...prev, active: false, done: true, error: 'Download cancelled.' }));
    setStep(0);
  };

  // NEW: Select local folder for this download only
  const handleSelectLocalFolder = async () => {
    try {
      const res = await fetch('/api/ytdl/select-folder?temp=true');
      const data = await res.json();
      if (data.success && data.path) setLocalCustomPath(data.path);
    } catch {}
  };

  const openFolder = () => { fetch('/api/ytdl/open-folder'); };

  const reset = () => {
    if (esRef.current) esRef.current.close();
    setUrl('');
    setInfo(null);
    setFetchStatus('idle');
    setFetchError('');
    setError(null);
    setDownloadState(null);
    setTrackStatuses({});
    setTrackErrors({});
    setShowAllTracks(false);
    setBulkMeta('');
    setStep(0);
    setMissingTracks(null);
    setScheduleTime('');
    setLocalCustomPath('');
    downloadIdRef.current = null;
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="sp-page" style={{ '--ambient-color': ambientColor }}>
      {/* Background orbs */}
      <div className="sp-orb sp-orb-1" />
      <div className="sp-orb sp-orb-2" />
      <div className="sp-orb sp-orb-3" />
      <WaveformBg isActive={downloadState?.active && !downloadState?.done} color={ambientColor} />

      {/* ── Scroll area ── */}
      <div className="sp-scroll-area">
        <div className="sp-main">

          {/* ── HERO ── */}
          <motion.div className="sp-hero" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="sp-hero-top">
              <div className="sp-hero-brand">
                <div className="sp-logo-pill">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="sp-logo-icon">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                  </svg>
                  Spotify
                </div>
                <h1 className="sp-title">Spotify Downloader</h1>
                <p className="sp-subtitle">Download tracks, albums &amp; playlists as high-quality audio — no limits</p>
                <div className="sp-feature-pills">
                  <span className="sp-feature-pill sp-feature-pill--track"><Disc size={10} /> Track</span>
                  <span className="sp-feature-pill sp-feature-pill--album"><Music size={10} /> Album</span>
                  <span className="sp-feature-pill sp-feature-pill--playlist"><List size={10} /> Playlist</span>
                </div>
                {/* NEW: Lifetime stats */}
                {lifetimeStats.total > 0 && (
                  <div className="sp-lifetime-stats">
                    <span className="sp-lifetime-stat"><Music size={11} /> {lifetimeStats.tracks} tracks</span>
                    <span className="sp-lifetime-stat"><Disc size={11} /> {lifetimeStats.albums} albums</span>
                    <span className="sp-lifetime-stat"><List size={11} /> {lifetimeStats.playlists} playlists</span>
                  </div>
                )}
              </div>

              <div className="sp-header-actions">
                {!accessToken ? (
                  <button className="sp-login-btn" onClick={async () => {
                    const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
                    if (!clientId) return alert('Please set VITE_SPOTIFY_CLIENT_ID in the .env file!');
                    const redirectUri = 'http://127.0.0.1:5174/api/spotify-callback';
                    const scope = encodeURIComponent('playlist-read-private playlist-read-collaborative');
                    const authUrl = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&show_dialog=true`;
                    if (window.electronAPI?.openExternal) {
                      window.electronAPI.openExternal(authUrl);
                      const pollInterval = setInterval(async () => {
                        try {
                          const res = await fetch('/api/spotify-status');
                          const data = await res.json();
                          if (data.success && data.data?.access_token) {
                            clearInterval(pollInterval);
                            storage.setItem('spotify_access_token', data.data.access_token);
                            storage.setItem('spotify_expires_at', String(Date.now() + data.data.expires_in * 1000));
                            if (data.data.refresh_token) storage.setItem('spotify_refresh_token', data.data.refresh_token);
                            setAccessToken(data.data.access_token);
                          }
                        } catch {}
                      }, 1000);
                    } else {
                      window.location.href = authUrl;
                    }
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
                        <motion.div className="sp-profile-dropdown" initial={{ opacity: 0, y: -10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.95 }} transition={{ duration: 0.15 }}>
                          <button className="sp-dropdown-item" onClick={() => { setShowProfileMenu(false); fetchMyPlaylists(); }}>
                            <List size={16} /> My Playlists
                          </button>
                          <div className="sp-dropdown-divider" />
                          <button className="sp-dropdown-item sp-logout-item" onClick={() => { clearSpotifyAuth(); setAccessToken(''); setShowProfileMenu(false); }}>
                            <LogOut size={16} /> Log Out
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
                {info && !downloadState && (
                  <button className="sp-reset-btn" onClick={reset} title="New search"><RefreshCw size={16} /></button>
                )}
              </div>
            </div>
          </motion.div>

          {/* ── NEW: System Status Panel ── */}
          <AnimatePresence>
            {systemStatus && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className={`sp-system-status ${isStatusExpanded ? 'expanded' : 'collapsed'}`}
              >
                <div className="sp-status-header-row" onClick={() => setIsStatusExpanded(!isStatusExpanded)}>
                  <div className="sp-status-quick">
                    <Activity size={15} />
                    <span>System Status</span>
                    {systemStatus.activeJobs > 0 && (
                      <span className="sp-status-badge">{systemStatus.activeJobs} Active Jobs</span>
                    )}
                    {(1 - systemStatus.freeMem / systemStatus.totalMem) * 100 > 85 && (
                      <span className="sp-status-badge sp-status-badge--warn">High RAM</span>
                    )}
                  </div>
                  <div className="sp-status-toggle">
                    {isStatusExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </div>
                </div>
                <AnimatePresence>
                  {isStatusExpanded && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="sp-status-grid-container">
                      <div className="sp-status-grid">
                        <div className="sp-status-item"><Activity size={15} /><span>API Hits: <strong>{systemStatus.totalHits || 0}</strong></span></div>
                        <div className="sp-status-item"><Clock size={15} /><span>Uptime: <strong>{Math.floor((systemStatus.uptime || 0) / 60000)}m</strong></span></div>
                        <div className="sp-status-item"><Zap size={15} /><span>Active: <strong>{systemStatus.activeJobs}</strong></span></div>
                        <div className="sp-status-item"><CheckCircle2 size={15} /><span>Success: <strong>
                          {systemStatus.totalHits > 0
                            ? ((systemStatus.successfulDownloads / Math.max(1, systemStatus.successfulDownloads + systemStatus.failedDownloads)) * 100).toFixed(0) + '%'
                            : '100%'}
                        </strong></span></div>
                      </div>
                      <div className="sp-status-bars">
                        <div className="sp-status-bar-wrapper">
                          <div className="sp-status-bar-labels">
                            <span><Cpu size={13} /> RAM Usage</span>
                            <strong>{((1 - systemStatus.freeMem / systemStatus.totalMem) * 100).toFixed(1)}%</strong>
                          </div>
                          <div className="sp-status-progress-bg">
                            <div className="sp-status-progress-fill" style={{ width: `${(1 - systemStatus.freeMem / systemStatus.totalMem) * 100}%` }} />
                          </div>
                        </div>
                        <div className="sp-status-bar-wrapper">
                          <div className="sp-status-bar-labels">
                            <span><HardDrive size={13} /> Free Space</span>
                            <strong className={systemStatus.freeSpace < 1073741824 ? 'text-danger' : ''}>{formatBytes(systemStatus.freeSpace)}</strong>
                          </div>
                          <div className="sp-status-progress-bg">
                            <div className="sp-status-progress-fill sp-space-fill" style={{ width: `${Math.max(0, Math.min(100, 100 - (systemStatus.freeSpace / 500000000000) * 100))}%` }} />
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── New Download Card (YouTube-style layout) ── */}
          <motion.div
            className={`sp-new-dl-card ${
              spotifyType === 'track' ? 'sp-new-dl-card--track'
              : spotifyType === 'album' ? 'sp-new-dl-card--album'
              : spotifyType === 'playlist' ? 'sp-new-dl-card--playlist'
              : 'sp-new-dl-card--default'
            }`}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            {/* Label + hint */}
            <div className="sp-new-dl-label-row">
              <span>New download</span>
              <small>Paste a Spotify track, album, or playlist link</small>
            </div>

            {/* Type mode tabs */}
            <div className="sp-new-dl-tabs">
              <button
                className={`sp-new-dl-tab sp-new-dl-tab--track ${spotifyType === 'track' ? 'active' : ''}`}
                onClick={() => { setUrl(''); setInfo(null); setFetchStatus('idle'); inputRef.current?.focus(); }}
              >
                <Disc size={13} /> Track
              </button>
              <button
                className={`sp-new-dl-tab sp-new-dl-tab--album ${spotifyType === 'album' ? 'active' : ''}`}
                onClick={() => { setUrl(''); setInfo(null); setFetchStatus('idle'); inputRef.current?.focus(); }}
              >
                <Music size={13} /> Album
              </button>
              <button
                className={`sp-new-dl-tab sp-new-dl-tab--playlist ${spotifyType === 'playlist' ? 'active' : ''}`}
                onClick={() => { setUrl(''); setInfo(null); setFetchStatus('idle'); inputRef.current?.focus(); }}
              >
                <List size={13} /> Playlist
              </button>
            </div>

            {/* Clipboard toast */}
            {clipboardToast && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="sp-clipboard-toast"
              >
                <Clipboard size={12} /> Spotify link detected from clipboard!
              </motion.div>
            )}

            {/* Spotify icon */}
            <div className="sp-new-dl-icon">
              <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
            </div>

            {/* Input area */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', position: 'relative' }}>
              <input
                ref={inputRef}
                type="text"
                className="sp-new-dl-input"
                value={url}
                onChange={e => { setUrl(e.target.value); setFetchStatus('idle'); setInfo(null); setFetchError(''); setError(null); setDownloadState(null); }}
                onFocus={() => setShowHistory(true)}
                onBlur={() => setTimeout(() => setShowHistory(false), 200)}
                onKeyDown={handleKeyDown}
                placeholder="Paste Spotify link here..."
                style={{ width: '100%', paddingRight: url ? '3rem' : '0' }}
              />
              {url && (
                <button className="sp-new-dl-clear" onClick={reset} title="Clear"><X size={16} strokeWidth={2.5} /></button>
              )}
              <AnimatePresence>
                {showHistory && history.length > 0 && !url && (
                  <motion.div className="sp-history-dropdown" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
                    <div className="sp-history-label">Recent searches</div>
                    {history.map((h, i) => (
                      <div key={i} className="sp-history-item" onMouseDown={() => { setUrl(h.url); setShowHistory(false); setTimeout(() => fetchInfo(h.url), 100); }}>
                        {h.thumbnail ? (
                          <img src={h.thumbnail} alt="" className="sp-history-item-thumb" />
                        ) : (
                          <div className="sp-history-item-icon"><Clock size={13} /></div>
                        )}
                        <span className="sp-history-item-name">{h.title}</span>
                        <button className="sp-history-item-remove" onMouseDown={(e) => { e.stopPropagation(); removeFromHistory(h.url); }} title="Remove">
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Process button */}
            <button
              className="sp-new-dl-btn"
              onClick={() => fetchInfo()}
              disabled={!url || fetchStatus === 'loading'}
            >
              {fetchStatus === 'loading' ? (
                <><Loader2 className="sp-spin" size={18} /> Loading...</>
              ) : (
                <><Zap size={18} fill="currentColor" /> Preview</>
              )}
            </button>

            {/* Feature capability pills row */}
            <div className="sp-new-dl-capability-row">
              <span><Music size={13} /> MP3 320kbps</span>
              <span><Hash size={13} /> Embedded metadata</span>
              <span><Disc size={13} /> Album artwork</span>
              <span><Zap size={13} /> Local processing</span>
            </div>
          </motion.div>

          {/* ── NEW: Skeleton Loading Card ── */}
          <AnimatePresence>
            {fetchStatus === 'loading' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.3 }} className="sp-skeleton-card">
                <motion.div className="sp-skel-cover" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.05, duration: 0.4 }} />
                <div className="sp-skel-lines">
                  {[{ cls: 'sp-skel-long', delay: 0.1 }, { cls: 'sp-skel-short', delay: 0.18 }, { cls: 'sp-skel-chips', delay: 0.26 }].map(({ cls, delay }) => (
                    <motion.div key={cls} className={`sp-skel-line ${cls}`} initial={{ opacity: 0, scaleX: 0, originX: 0 }} animate={{ opacity: 1, scaleX: 1 }} transition={{ delay, duration: 0.4, ease: 'easeOut' }} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Error ── */}
          <AnimatePresence>
            {fetchStatus === 'error' && (
              <motion.div className="sp-error-card" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                <AlertCircle size={17} style={{ flexShrink: 0 }} />
                <span>{fetchError}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Info Card ── */}
          <AnimatePresence>
            {info && fetchStatus === 'done' && (
              <motion.div className="sp-info-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>

                <div className="sp-info-top">
                  <div className="sp-info-thumb-wrap">
                    {info.coverUrl ? (
                      <img src={info.coverUrl} alt={info.title} className="sp-info-thumb" />
                    ) : (
                      <div className="sp-info-thumb-fallback"><Music size={28} /></div>
                    )}
                  </div>
                  <div className="sp-info-meta">
                    <h3 className="sp-info-title">{info.title}</h3>
                    {info.artist && <p className="sp-info-artist">{info.artist}</p>}
                    {info.owner && (
                      <div className="sp-info-owner-wrap">
                        {info.ownerThumbnail ? (
                          <img src={info.ownerThumbnail} alt={info.owner} className="sp-info-owner-pfp" />
                        ) : (
                          <div className="sp-info-owner-pfp-fallback">{info.owner.charAt(0).toUpperCase()}</div>
                        )}
                        <span className="sp-info-owner-name">{info.owner}</span>
                      </div>
                    )}
                    <div className="sp-info-pills">
                      <SpotifyBadge type={info.type} />
                      {info.releaseDate && (
                        <span className="sp-info-pill"><Calendar size={11} /> {info.releaseDate.slice(0, 4)}</span>
                      )}
                      {info.totalTracks > 1 && info.type !== 'track' && (
                        <span className="sp-info-pill">
                          <Hash size={11} />
                          {info.trackCount < info.totalTracks ? `${info.trackCount} / ${info.totalTracks} tracks` : `${info.trackCount} tracks`}
                        </span>
                      )}
                      {info.type === 'track' && info.totalTracks > 1 && (
                        <span className="sp-info-pill"><Hash size={11} /> Track {info.trackNumber} / {info.totalTracks}</span>
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

                {/* ── Tracklist with Grid/List toggle (albums & playlists) ── */}
                {info.tracks?.length > 1 && (
                  <div className="sp-tracklist-container">
                    {/* Toolbar */}
                    <div className="sp-tracklist-toolbar">
                      <div className="sp-tracklist-toolbar-left">
                        <span className="sp-tracklist-count-label">{selectedTracks.size} / {info.trackCount} selected</span>
                      </div>
                      <div className="sp-tracklist-toolbar-right">
                        {/* View toggle */}
                        <button
                          className={`sp-view-btn ${playlistViewMode === 'list' ? 'active' : ''}`}
                          onClick={() => setPlaylistViewMode('list')} title="List view"
                          style={playlistViewMode === 'list' ? { background: 'var(--sp-green)', color: '#000', borderColor: 'var(--sp-green)' } : {}}
                        >
                          <ListVideo size={14} />
                        </button>
                        <button
                          className={`sp-view-btn ${playlistViewMode === 'grid' ? 'active' : ''}`}
                          onClick={() => setPlaylistViewMode('grid')} title="Grid view"
                          style={playlistViewMode === 'grid' ? { background: 'var(--sp-green)', color: '#000', borderColor: 'var(--sp-green)' } : {}}
                        >
                          <LayoutGrid size={14} />
                        </button>
                        <button className="sp-track-util-btn" onClick={selectAllTracks}>All</button>
                        <button className="sp-track-util-btn" onClick={deselectAllTracks}>None</button>
                      </div>
                    </div>

                    {/* ── List View ── */}
                    {playlistViewMode === 'list' && (
                      <>
                        <div className="sp-playlist-preview-header">
                          <div></div><div></div>
                          <div>Title</div>
                          <div>Artist</div>
                          <div style={{ textAlign: 'right' }}>Duration</div>
                          <div></div>
                        </div>
                        <div className="sp-tracklist-body">
                          {tracksToShow.map((track, i) => {
                            const isSelected = selectedTracks.has(track.trackNumber);
                            let cleanTitle = track.title;
                            let featArtist = '';
                            let isExplicit = false;
                            const featMatch = cleanTitle.match(/\((?:feat\.|ft\.)\s+(.+?)\)/i) || cleanTitle.match(/feat\.\s+(.+?)(?=\s*-|\s*$)/i);
                            if (featMatch) { featArtist = featMatch[1]; cleanTitle = cleanTitle.replace(featMatch[0], '').trim(); }
                            if (cleanTitle.match(/\(Explicit\)/i)) { isExplicit = true; cleanTitle = cleanTitle.replace(/\(Explicit\)/i, '').trim(); }
                            return (
                              <div key={track.trackNumber} className={`sp-playlist-preview-row ${isSelected ? 'selected' : ''}`} onClick={() => toggleTrack(track.trackNumber)}>
                                <div className="sp-preview-checkbox-wrapper">
                                  <span className="sp-track-num">{i + 1}</span>
                                  <div className={`sp-playlist-checkbox ${isSelected ? 'checked' : ''}`}>
                                    {isSelected && <Check size={11} strokeWidth={2.5} color="#fff" />}
                                  </div>
                                </div>
                                {track.coverUrl ? (
                                  <img src={track.coverUrl} alt="" className="sp-preview-row-thumb" />
                                ) : (
                                  <div className="sp-preview-row-thumb-fallback"><Music size={13} /></div>
                                )}
                                <div className="sp-preview-row-title-col">
                                  <strong>{cleanTitle}{isExplicit && <span className="sp-explicit-badge">E</span>}</strong>
                                  {featArtist && <span className="sp-feat-artist">feat. {featArtist}</span>}
                                </div>
                                <div className="sp-preview-row-text-col" style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {track.artist && track.artist !== info.artist ? track.artist : ''}
                                </div>
                                <span className="sp-preview-row-duration">{fmtDuration(track.durationMs)}</span>
                                <button className="sp-preview-quick-dl" title="Download only this track" onClick={(e) => { e.stopPropagation(); handleQuickDownload(track.trackNumber); }}>
                                  <Download size={13} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}

                    {/* ── Grid View ── */}
                    {playlistViewMode === 'grid' && (
                      <div className="sp-playlist-grid">
                        {tracksToShow.map((track) => {
                          const isSelected = selectedTracks.has(track.trackNumber);
                          return (
                            <div key={track.trackNumber} className={`sp-playlist-card ${isSelected ? 'selected' : ''}`} onClick={() => toggleTrack(track.trackNumber)}>
                              <div className="sp-playlist-card-thumb">
                                {track.coverUrl ? <img src={track.coverUrl} alt="" /> : <div className="sp-playlist-card-fallback"><Music size={22} /></div>}
                                <div className="sp-playlist-card-overlay">
                                  <div className="sp-playlist-card-top">
                                    <div className={`sp-playlist-card-check ${isSelected ? 'checked' : ''}`}>
                                      {isSelected && <Check size={12} strokeWidth={3} />}
                                    </div>
                                  </div>
                                  <div className="sp-playlist-card-bottom">
                                    <span className="sp-playlist-card-duration">{fmtDuration(track.durationMs)}</span>
                                    <button className="sp-playlist-card-quick-dl" title="Download only this track" onClick={(e) => { e.stopPropagation(); handleQuickDownload(track.trackNumber); }}>
                                      <Download size={13} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                              <div className="sp-playlist-card-info">
                                <strong className="sp-playlist-card-title">{track.title}</strong>
                                <span className="sp-playlist-card-artist">{track.artist}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* More tracks pill */}
                    {info.trackCount > 10 && !showAllTracks && (
                      <div className="sp-more-tracks-pill" onClick={() => setShowAllTracks(true)}>
                        <span className="sp-more-tracks-pill__count">+{info.trackCount - 10}</span>
                        <span className="sp-more-tracks-pill__label">{info.trackCount - 10 === 1 ? 'more track' : 'more tracks'} — all will be downloaded</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Single track tracklist (playlist display, simplified) */}
                {info.tracks?.length === 1 && info.type === 'track' && info.totalTracks > 1 && (
                  <div className="sp-tracklist">
                    <div className="sp-tracklist-header">
                      <span className="sp-tracklist-title"><List size={13} /> Album Track</span>
                    </div>
                  </div>
                )}

              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Download Action ── */}
          <AnimatePresence>
            {info && fetchStatus === 'done' && !downloadState && (
              <motion.div className="sp-dl-actions" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className="sp-dl-copy">
                  <span className="sp-dl-copy-title">
                    {info.type === 'track' ? 'Ready to download' : info.type === 'album' ? 'Album ready' : 'Playlist ready'}
                  </span>
                  <span className="sp-dl-copy-sub">
                    {info.type === 'track'
                      ? 'High-quality audio · Choose your format'
                      : `${info.trackCount} track${info.trackCount !== 1 ? 's' : ''} · Select format and start`}
                  </span>
                </div>
                <button
                  className={`sp-dl-btn ${info.trackCount === 1 ? 'sp-single-dl-btn' : 'sp-playlist-dl-btn'}`}
                  onClick={openDownloadModal}
                >
                  {info.trackCount > 1 ? <><List size={20} /> Download {info.type === 'album' ? 'Album' : 'Playlist'}</> : <><Download size={20} /> Download Now</>}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Download Modal ── */}
          <AnimatePresence>
            {showDownloadModal && info && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="sp-modal-overlay">
                <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="sp-modal">
                  <h3 className="sp-modal-title">Download Settings {info.trackCount > 1 ? `— ${info.type === 'album' ? 'Album' : 'Playlist'}` : ''}</h3>

                  <div className="sp-modal-settings">
                    {/* Format picker */}
                    <div className="sp-setting-group">
                      <span className="sp-setting-label">Audio Format</span>
                      <div className="sp-format-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                        {AUDIO_FORMATS.map(fmt => (
                          <button key={fmt.id} className={`sp-format-card ${selectedFormat === fmt.id ? 'sp-format-card--active' : ''}`} onClick={() => setSelectedFormat(fmt.id)}>
                            <div className="sp-format-top-row">
                              <span className="sp-format-label">{fmt.label}</span>
                              {fmt.id === 'mp3_320' && <span className="sp-format-rec">Best</span>}
                            </div>
                            <span className="sp-format-sub">{fmt.sub}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Track selection for collections */}
                    {info.trackCount > 1 && info.tracks && (
                      <div className="sp-track-selection-section">
                        <div className="sp-track-selection-header">
                          <label className="sp-modal-label">SELECT TRACKS ({selectedTracks.size} SELECTED)</label>
                          <div className="sp-track-utils">
                            <button className="sp-track-util-btn" onClick={selectAllTracks}>All</button>
                            <button className="sp-track-util-btn" onClick={deselectAllTracks}>None</button>
                          </div>
                        </div>
                        <div className="sp-track-list">
                          {info.tracks.map(track => {
                            const isSelected = selectedTracks.has(track.trackNumber);
                            return (
                              <div key={track.trackNumber} className={`sp-track-item ${isSelected ? 'selected' : ''}`} onClick={() => toggleTrack(track.trackNumber)} style={{ cursor: 'pointer' }}>
                                <div className="sp-track-checkbox" />
                                <span className="sp-track-index">{track.trackNumber}.</span>
                                <span className="sp-track-name">{track.title}{track.artist && track.artist !== info.artist ? ` - ${track.artist}` : ''}</span>
                                <span className="sp-track-duration">{fmtDuration(track.durationMs)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* NEW: Options checkboxes for collections */}
                    {info.trackCount > 1 && (
                      <div className="sp-setting-group">
                        <span className="sp-setting-label">OPTIONS</span>
                        <label className="sp-checkbox-label">
                          <input type="checkbox" checked={prependNumbers} onChange={e => { setPrependNumbers(e.target.checked); localStorage.setItem('sp_prepend_numbers', JSON.stringify(e.target.checked)); }} style={{ accentColor: 'var(--sp-green)', width: 15, height: 15 }} />
                          Prepend track number to filename (e.g. 001 - Track Name)
                        </label>
                        {info.type === 'album' && (
                          <label className="sp-checkbox-label" style={{ marginTop: '0.4rem' }}>
                            <input type="checkbox" checked={prefixAlbumFolders} onChange={e => { setPrefixAlbumFolders(e.target.checked); localStorage.setItem('sp_prefix_album_folders', JSON.stringify(e.target.checked)); }} style={{ accentColor: 'var(--sp-green)', width: 15, height: 15 }} />
                            Prefix folder name with "Album -"
                          </label>
                        )}
                      </div>
                    )}

                    {/* NEW: Schedule download */}
                    <div className="sp-setting-group">
                      <span className="sp-setting-label">
                        <CalendarClock size={14} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: 4 }} />
                        Schedule Download (optional)
                      </span>
                      <p className="sp-setting-desc">Leave empty for immediate download, or set a time to start automatically.</p>
                      <input type="time" className="sp-modal-time-input" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} />
                    </div>

                    {/* NEW: Custom folder per download */}
                    <div className="sp-setting-group">
                      <span className="sp-setting-label">
                        <FolderOpen size={14} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: 4 }} />
                        Download Folder (this download only)
                      </span>
                      <p className="sp-setting-desc">Select a custom folder for this download only, overriding global settings.</p>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                        <input type="text" className="sp-input" readOnly value={localCustomPath || 'Default folder'} style={{ flex: 1, color: localCustomPath ? '#ffffff' : '#666', fontSize: '0.85rem' }} />
                        <button className="sp-modal-confirm" onClick={handleSelectLocalFolder} style={{ padding: '0 1rem', whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                          Choose folder
                        </button>
                      </div>
                    </div>

                    {/* Size estimate */}
                    {sizeEstimate && (
                      <div className="sp-format-summary">
                        <Archive size={13} />
                        <span>Estimated size: <strong>{sizeEstimate}</strong></span>
                      </div>
                    )}
                  </div>

                  <div className="sp-modal-actions">
                    <button className="sp-modal-cancel" onClick={() => setShowDownloadModal(false)}>Cancel</button>
                    <button className="sp-modal-confirm" onClick={handleDownload} disabled={info.trackCount > 1 && selectedTracks.size === 0}>
                      {scheduleTime ? `Schedule for ${scheduleTime}` : 'Start Download'}
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

                {/* Scheduled success */}
                {downloadState.scheduled && isSuccess && (
                  <div className="sp-result sp-result--success">
                    <motion.div className="sp-success-icon-wrap" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', bounce: 0.5 }}>
                      <CalendarClock size={36} className="sp-success-icon" />
                      <div className="sp-success-ring" />
                    </motion.div>
                    <div className="sp-success-info">
                      <strong>Download Scheduled!</strong>
                      <p className="sp-success-filename">{downloadState.status}</p>
                      <div className="sp-result-actions">
                        <button className="sp-retry-btn" onClick={reset}>New Download</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Active download */}
                {isDownloading && !downloadState.scheduled && (() => {
                  const activeTracks = info?.tracks
                    ? info.tracks.filter(t => selectedTracks.size === 0 || selectedTracks.has(t.trackNumber))
                    : [];
                  const doneCount = Object.values(trackStatuses).filter(s => s === 'done').length;
                  const failCount = Object.values(trackStatuses).filter(s => s === 'error').length;
                  const totalDl = downloadState.totalTracks || activeTracks.length || 1;
                  const currentCoverUrl = (info?.tracks?.find(t => t.title === downloadState.trackTitle)?.coverUrl) || info?.coverUrl;

                  return (
                    <>
                      {/* NEW: Step timeline */}
                      <div className="sp-step-timeline">
                        {[{ label: 'Connecting', idx: 1 }, { label: 'Downloading', idx: 2 }, { label: 'Finalizing', idx: 3 }].map(({ label, idx }, i, arr) => (
                          <div key={idx} className="sp-step-timeline-item">
                            <div className={`sp-step-node ${step >= idx ? 'active' : ''} ${step === idx ? 'current' : ''}`}>
                              {step > idx ? <CheckCircle2 size={13} /> : <span>{idx}</span>}
                            </div>
                            <span className={`sp-step-label ${step >= idx ? 'active' : ''}`}>{label}</span>
                            {i < arr.length - 1 && <div className={`sp-step-connector ${step > idx ? 'filled' : ''}`} />}
                          </div>
                        ))}
                      </div>

                      {/* Vinyl spotlight */}
                      <div className="sp-prog-spotlight">
                        <div className="sp-prog-vinyl-wrap">
                          <motion.div
                            className="sp-prog-vinyl"
                            animate={{ rotate: 360 }}
                            transition={{ repeat: Infinity, duration: 6, ease: 'linear' }}
                            style={{ backgroundImage: currentCoverUrl ? `url(${currentCoverUrl})` : undefined }}
                          >
                            <div className="sp-prog-vinyl-hole" />
                          </motion.div>
                        </div>
                        <div className="sp-prog-spotlight-meta">
                          <div className="sp-prog-now-label">NOW DOWNLOADING</div>
                          <div className="sp-prog-track-name">{downloadState.trackTitle || info?.title || '...'}</div>
                          <div className="sp-prog-track-artist">{downloadState.trackArtist || info?.artist || ''}</div>
                          <div className="sp-prog-eq-row">
                            <EqualizerBars active={true} />
                            <span className="sp-prog-status-text">{downloadState.status || 'Downloading...'}</span>
                          </div>
                        </div>
                        <div className="sp-prog-counters">
                          <div className="sp-prog-counter sp-prog-counter--done"><CheckCircle2 size={13} /><span>{doneCount}</span></div>
                          <div className="sp-prog-counter sp-prog-counter--fail"><AlertCircle size={13} /><span>{failCount}</span></div>
                          <div className="sp-prog-counter sp-prog-counter--remain"><Clock size={13} /><span>{Math.max(0, totalDl - doneCount - failCount)}</span></div>
                        </div>
                      </div>

                      {/* Progress bars */}
                      <div className="sp-prog-bar-section">
                        <div className="sp-prog-bar-labels">
                          <span>Track {downloadState.currentTrack || 0} of {totalDl}</span>
                          <span>{Math.round(downloadState.progress || 0)}%</span>
                        </div>
                        <div className="sp-prog-bar-outer">
                          <motion.div className="sp-prog-bar-fill" animate={{ width: `${downloadState.progress || 0}%` }} transition={{ duration: 0.4 }} />
                          <motion.div className="sp-prog-bar-glow" animate={{ left: `${Math.min((downloadState.progress || 0) - 2, 97)}%` }} transition={{ duration: 0.4 }} />
                        </div>
                        {totalDl > 1 && (
                          <div className="sp-prog-bar-outer sp-prog-bar-outer--thin" style={{ marginTop: 6 }}>
                            <motion.div className="sp-prog-bar-fill sp-prog-bar-fill--track" animate={{ width: `${downloadState.trackProgress || 0}%` }} transition={{ duration: 0.2 }} />
                          </div>
                        )}
                      </div>

                      {/* Track dots */}
                      {activeTracks.length > 1 && activeTracks.length <= 80 && (
                        <div className="sp-prog-dots">
                          {activeTracks.map((track) => {
                            const st = trackStatuses[track.trackNumber - 1] || 'pending';
                            return (
                              <motion.div key={track.trackNumber} className={`sp-prog-dot sp-prog-dot--${st}`} title={`${track.title} — ${st}`} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: track.trackNumber * 0.01 }} />
                            );
                          })}
                        </div>
                      )}

                      {/* Failed tracks details */}
                      {failCount > 0 && (
                        <details className="sp-prog-failed">
                          <summary><AlertCircle size={13} /> {failCount} track{failCount > 1 ? 's' : ''} failed</summary>
                          <div className="sp-prog-failed-list">
                            {activeTracks.filter(t => trackStatuses[t.trackNumber - 1] === 'error').map(t => (
                              <div key={t.trackNumber} className="sp-prog-failed-row">
                                <span className="sp-prog-failed-name">{t.title}</span>
                                <span className="sp-prog-failed-err">{trackErrors[t.trackNumber - 1] || 'Unknown error'}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}

                      <button className="sp-cancel-btn" onClick={handleCancel}><X size={14} /> Cancel</button>
                    </>
                  );
                })()}

                {/* Error state */}
                {hasError && (
                  <div className="sp-result sp-result--error">
                    <AlertCircle size={20} />
                    <div>
                      <strong>Download Failed</strong>
                      <p>{downloadState.error}</p>
                      <div className="sp-result-actions">
                        <button className="sp-retry-btn" onClick={() => { setDownloadState(null); setTrackStatuses({}); setStep(0); }}>Try Again</button>
                        <button className="sp-secondary-btn" onClick={reset}>New URL</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Success state */}
                {isSuccess && !downloadState.scheduled && (
                  <div className="sp-result sp-result--success">
                    <motion.div className="sp-success-icon-wrap" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', bounce: 0.5 }}>
                      <CheckCircle2 size={36} className="sp-success-icon" />
                      <div className="sp-success-ring" />
                    </motion.div>
                    <div className="sp-success-info">
                      <strong>Download Complete!</strong>
                      <p className="sp-success-filename">{downloadState.finalFilename || downloadState.collectionTitle}</p>
                      {downloadState.completedTracks > 1 && (
                        <p className="sp-success-sub">
                          {downloadState.completedTracks} tracks downloaded
                          {downloadState.failedTracks > 0 && ` · ${downloadState.failedTracks} failed`}
                        </p>
                      )}

                      {/* NEW: Missing tracks warning */}
                      {missingTracks && (
                        <div className="sp-missing-tracks">
                          <AlertCircle size={15} style={{ flexShrink: 0 }} />
                          <div>
                            <strong>Warning:</strong> {missingTracks.actual} of {missingTracks.expected} tracks downloaded.
                            {missingTracks.failed?.length > 0 && (
                              <div className="sp-missing-list">
                                {missingTracks.failed.map((t, i) => (
                                  <div key={i}>• {t.artist ? `${t.artist} — ${t.title}` : t.title}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="sp-result-actions">
                        {downloadState.failedTracks > 0 && downloadState.failedTracksData && (
                          <button className="sp-retry-failed-btn" onClick={retryFailedTracks} style={{ background: 'var(--sp-green)', color: '#000' }}>
                            <RefreshCw size={14} /> Retry Failed ({downloadState.failedTracks})
                          </button>
                        )}
                        {downloadState.downloadUrl && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && (
                          <a className="sp-download-link" href={downloadState.downloadUrl} download={downloadState.finalFilename}>
                            <Download size={14} /> Save File
                          </a>
                        )}
                        <button className="sp-open-folder-btn" onClick={openFolder}><FolderOpen size={14} /> Open Folder</button>
                        <button className="sp-retry-btn" onClick={reset}>New Download</button>
                      </div>
                    </div>
                  </div>
                )}

              </motion.div>
            )}
          </AnimatePresence>

        </div>

        {/* ── Artist Gallery Section ── */}
        <div className="sp-gallery-section">
          <div className="sp-gallery-title">Artist History</div>
          <ArtistBubbles artists={historyArtists} onRemove={removeArtistFromHistory} />
        </div>

        {/* ── Recent Downloads Section ── */}
        {history && history.length > 0 && (
          <div className="sp-recent-section">
            <div className="sp-recent-title">Recent Downloads</div>
            <div className="sp-recent-list">
              {history.slice(0, 5).map((item, i) => (
                <div key={i} className="sp-recent-item" onClick={() => { setUrl(item.url); fetchInfo(item.url); }}>
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt={item.title} className="sp-recent-thumb" />
                  ) : (
                    <div className="sp-recent-thumb sp-recent-thumb-fallback"><Music size={16} /></div>
                  )}
                  <div className="sp-recent-info">
                    <div className="sp-recent-song-title">{item.title}</div>
                    <div className="sp-recent-artist">{item.artist || 'Unknown Artist'}</div>
                  </div>
                  <div className="sp-recent-type">
                    {item.url && getSpotifyType(item.url) && (
                      <span className={`sp-feature-pill sp-feature-pill--${getSpotifyType(item.url)}`}>{getSpotifyType(item.url)}</span>
                    )}
                  </div>
                  <button className="sp-recent-delete" onClick={(e) => { e.stopPropagation(); removeFromHistory(item.url); }} title="Remove from history">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── FOOTER ── */}
        <footer className="sp-footer">
          <div className="sp-footer-inner">
            <div className="sp-footer-top">
              <div className="sp-footer-brand">
                <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15" style={{ color: '#1DB954' }}>
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                </svg>
                <div className="sp-footer-brand-dot" />
                <span className="sp-footer-brand-name">MediaDL</span>
                <span className="sp-footer-brand-sep">&middot;</span>
                <span className="sp-footer-brand-sub">Spotify</span>
              </div>
              <div className="sp-footer-badges">
                <span className="sp-footer-badge sp-footer-badge--green"><HardDrive size={9} /> yt-dlp</span>
                <span className="sp-footer-badge sp-footer-badge--green"><Music size={9} /> Spotify API</span>
                <span className="sp-footer-badge sp-footer-badge--dim"><CheckCircle2 size={9} /> Lossless Quality</span>
                <span className="sp-footer-badge sp-footer-badge--dim"><HardDrive size={9} /> ID3 Tags</span>
              </div>
            </div>
            <div className="sp-footer-divider" />
            <div className="sp-footer-bottom">
              <span className="sp-footer-copy">&copy; 2026 MediaDL &nbsp;&middot;&nbsp; v1.0.69</span>
              <span className="sp-footer-tagline">For personal use only &middot; Respect artists &amp; their work</span>
            </div>
          </div>
        </footer>
      </div>

      {/* ── My Playlists Modal ── */}
      <AnimatePresence>
        {showPlaylists && (
          <motion.div className="sp-playlists-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={e => e.target === e.currentTarget && setShowPlaylists(false)}>
            <motion.div className="sp-playlists-content" initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}>
              <div className="sp-playlists-header">
                <h2>My Playlists</h2>
                <button className="sp-login-btn" onClick={() => setShowPlaylists(false)}><X size={16} /> Close</button>
              </div>
              {myPlaylistsStatus === 'loading' && (
                <div className="sp-pl-loading"><Loader2 className="sp-spin" size={32} /><span>Fetching your playlists...</span></div>
              )}
              {myPlaylistsStatus === 'error' && (
                <div className="sp-pl-error"><AlertCircle size={24} /><span>Failed to load playlists. Please log in again.</span></div>
              )}
              {myPlaylistsStatus === 'done' && (
                <div className="sp-playlists-grid">
                  {myPlaylists?.map(p => (
                    <div key={p.id} className="sp-playlist-card-modal" onClick={() => { setShowPlaylists(false); setUrl(p.external_urls.spotify); fetchInfo(p.external_urls.spotify); }}>
                      <img src={p.images?.[0]?.url || ''} alt="" onError={e => { e.target.style.display = 'none'; }} />
                      <div className="sp-playlist-meta">
                        <div className="sp-playlist-title">{p.name}</div>
                        <div className="sp-playlist-owner">{p.owner?.display_name} · {p.tracks?.total ?? '?'} tracks</div>
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
  );
}
