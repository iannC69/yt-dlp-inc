import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Music, Download, Loader2, AlertCircle, CheckCircle2,
  Link2, List, Disc, Search, RefreshCw, Clipboard,
  X, ChevronDown, ChevronUp, FolderOpen, Clock,
  Star, Calendar, Hash, Archive, Play, User, LogOut, ListVideo, HardDrive,
  Zap, Activity, Cpu, Check, LayoutGrid, XCircle, Pause, CalendarClock
} from 'lucide-react';
import AuroraBackground from './AuroraBackground';
import { getAverageColor } from './utils/colorUtils';
import WaveformBg from './WaveformBg';
import { storage } from './storage';
import './SpotifyDownloader.css';

// ── Constants ──────────────────────────────────────────────────────────────────

const AUDIO_FORMATS = [
  { id: 'mp3_320', label: '320kbps MP3', sub: 'Best Quality', ext: 'mp3', quality: '0', audioFmt: 'mp3', kbps: 320 },
  { id: 'mp3_192', label: '192kbps MP3', sub: 'Balanced', ext: 'mp3', quality: '5', audioFmt: 'mp3', kbps: 192 },
  { id: 'mp3_128', label: '128kbps MP3', sub: 'Compressed', ext: 'mp3', quality: '9', audioFmt: 'mp3', kbps: 128 },
  { id: 'ogg', label: 'OGG Vorbis', sub: 'Open Format', ext: 'ogg', quality: '0', audioFmt: 'vorbis', kbps: 192 },
  { id: 'wav', label: 'WAV', sub: 'Lossless', ext: 'wav', quality: '0', audioFmt: 'wav', kbps: 1411 },
];

const SPOTIFY_SUGGESTIONS = [
  { label: 'Blinding Lights', url: 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b', tag: 'Track', color: '#1DB954' },
  { label: 'As It Was - Harry', url: 'https://open.spotify.com/track/4H9oo2bPD4hpgGhubGbWRT', tag: 'Track', color: '#1DB954' },
  { label: 'Bohemian Rhapsody', url: 'https://open.spotify.com/track/3z8h0TU7ReDPLIbEnYhWZb', tag: 'Track', color: '#1DB954' },
  { label: 'Starboy - The Weeknd', url: 'https://open.spotify.com/track/7MXVkk9YMctZqd1Srtv4MB', tag: 'Track', color: '#1DB954' },
  { label: '1989 - Taylor Swift', url: 'https://open.spotify.com/album/64LU4c1Vi6eBk7QMnR6AN9', tag: 'Album', color: '#818cf8' },
  { label: 'DAMN. - Kendrick', url: 'https://open.spotify.com/album/4eLPsYPBmXABThSJ821sqY', tag: 'Album', color: '#818cf8' },
  { label: 'After Hours - Weeknd', url: 'https://open.spotify.com/album/4yP0hdKOZPNshxUOjY0cZj', tag: 'Album', color: '#818cf8' },
  { label: 'Top 50 Global', url: 'https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2tF', tag: 'Playlist', color: '#fb923c' },
  { label: 'Hot Hits', url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', tag: 'Playlist', color: '#fb923c' },
  { label: 'Lo-Fi Beats', url: 'https://open.spotify.com/playlist/37i9dQZF1DWWQRwui0ExPn', tag: 'Playlist', color: '#fb923c' },
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
    track: { bg: 'color-mix(in srgb, var(--sp-green) 12%, transparent)', color: 'var(--sp-green)', border: 'color-mix(in srgb, var(--sp-green) 30%, transparent)' },
    album: { bg: 'color-mix(in srgb, var(--sp-green) 12%, transparent)', color: 'var(--sp-green)', border: 'color-mix(in srgb, var(--sp-green) 30%, transparent)' },
    playlist: { bg: 'color-mix(in srgb, var(--sp-green) 12%, transparent)', color: 'var(--sp-green)', border: 'color-mix(in srgb, var(--sp-green) 30%, transparent)' },
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

// ── Spotify SVG Icon ──────────────────────────────────────────────────────────
const SpotifyIcon = ({ size = 16, color = 'currentColor' }) => (
  <svg viewBox="0 0 24 24" fill={color} width={size} height={size}>
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
  </svg>
);

// ── Main Component ─────────────────────────────────────────────────────────────

export default function SpotifyDownloader({ activeDownloadId }) {

  // ─── Core state ───────────────────────────────────────────────────────────
  const [url, setUrl] = useState('');
  const [history, setHistory] = useState([]);
  const [globalHistory, setGlobalHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [ambientColor, setAmbientColor] = useState('rgba(29, 185, 84, 0.12)');
  const [hasCookies, setHasCookies] = useState(true);

  // Info / fetch
  const [info, setInfo] = useState(null);
  const [fetchStatus, setFetchStatus] = useState('idle'); // idle | loading | done | error
  const [fetchError, setFetchError] = useState('');
  const [error, setError] = useState(null);

  // Active tab (track | album | playlist) — controlled
  const [activeTab, setActiveTab] = useState('track');

  useEffect(() => {
    if (activeTab === 'album') {
      setAmbientColor('rgba(217, 70, 239, 0.12)');
    } else if (activeTab === 'playlist') {
      setAmbientColor('rgba(59, 130, 246, 0.12)');
    } else {
      setAmbientColor('rgba(29, 185, 84, 0.12)');
    }
  }, [activeTab]);

  // Format & track selection
  const [selectedFormat, setSelectedFormat] = useState('mp3_320');
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [selectedTracks, setSelectedTracks] = useState(new Set());
  const [playlistViewMode, setPlaylistViewMode] = useState('list');

  // Download state
  const [downloadState, setDownloadState] = useState(null);
  const [trackStatuses, setTrackStatuses] = useState({});
  const [trackErrors, setTrackErrors] = useState({});
  const [trackOverrides, setTrackOverrides] = useState({});
  const [step, setStep] = useState(0);
  const [missingTracks, setMissingTracks] = useState(null);

  // Retry / bulk meta
  const [bulkMeta, setBulkMeta] = useState('');

  // Auth
  const [clipboardToast, setClipboardToast] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [myPlaylists, setMyPlaylists] = useState(null);
  const [myPlaylistsStatus, setMyPlaylistsStatus] = useState('idle');
  const [showPlaylists, setShowPlaylists] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  // Download options
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

  // System status
  const [systemStatus, setSystemStatus] = useState(null);
  const [isStatusExpanded, setIsStatusExpanded] = useState(false);

  // Lifetime stats
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
    const sorted = [...history].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    for (const h of sorted) {
      const name = h.artist;
      if (name && name !== 'Unknown' && name !== 'Spotify' && name !== '' && !seen.has(name)) {
        seen.add(name);
        artists.push({ name, thumbnail: h.artistThumbnail || h.thumbnail || null });
      }
    }
    return artists;
  }, [history]);

  // ─── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    try {
      const saved = localStorage.getItem('sp_history');
      if (saved) setHistory(JSON.parse(saved));
    } catch { }
  }, []);

  useEffect(() => {
    fetch('/api/cookies/status')
      .then(res => res.json())
      .then(data => { if (data?.hasCookies !== undefined) setHasCookies(data.hasCookies); })
      .catch(() => { });
  }, []);

  useEffect(() => {
    const fetchSysStatus = async () => {
      try {
        const res = await fetch('/api/ytdl/system-status');
        if (res.ok) setSystemStatus(await res.json());
      } catch { }
    };
    fetchSysStatus();
    const interval = setInterval(fetchSysStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const calcStats = () => {
      try {
        const gHist = JSON.parse(localStorage.getItem('global_history') || '[]');
        setGlobalHistory(gHist);
        const spotifyItems = gHist.filter(i => i.source === 'spotify');
        setLifetimeStats({
          tracks: spotifyItems.filter(i => i.spotifyType === 'track').length,
          albums: spotifyItems.filter(i => i.spotifyType === 'album').length,
          playlists: spotifyItems.filter(i => i.spotifyType === 'playlist').length,
          total: spotifyItems.length,
        });
      } catch { }
    };
    calcStats();
    window.addEventListener('history_updated', calcStats);
    return () => window.removeEventListener('history_updated', calcStats);
  }, []);

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
      } catch { }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [url, downloadState?.active, info, fetchStatus]);

  useEffect(() => {
    if (showDownloadModal) {
      setLocalCustomPath(localStorage.getItem('customPath') || '');
    }
  }, [showDownloadModal]);

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
              storage.setItem('spotify_access_token', data.access_token);
              storage.setItem('spotify_expires_at', String(Date.now() + data.expires_in * 1000));
              if (data.refresh_token) storage.setItem('spotify_refresh_token', data.refresh_token);
              setAccessToken(data.access_token);
            }
          } catch { }
        }
      }

      if (storedToken) {
        try {
          const res = await fetch('https://api.spotify.com/v1/me', { headers: { 'Authorization': `Bearer ${storedToken}` } });
          if (res.ok) setUserProfile(await res.json());
        } catch { }
      }
    };
    checkAuth();
  }, []);

  useEffect(() => {
    const handlePaste = (e) => {
      const pastedUrl = e.detail;
      if (pastedUrl && isSpotifyUrl(pastedUrl)) {
        setUrl(pastedUrl);
        setTimeout(() => fetchInfo(pastedUrl), 100);
      }
    };
    window.addEventListener('app:paste-url', handlePaste);
    return () => window.removeEventListener('app:paste-url', handlePaste);
  }, []);

  // ─── Fetch & Download handlers ─────────────────────────────────────────────

  const fetchInfo = async (inputUrl = url) => {
    const targetUrl = typeof inputUrl === 'string' ? inputUrl.trim() : url.trim();
    if (!targetUrl || !isSpotifyUrl(targetUrl)) return;
    setUrl(targetUrl);
    setFetchStatus('loading');
    setFetchError('');
    setInfo(null);
    setError(null);
    setDownloadState(null);
    setTrackStatuses({});
    setStep(0);

    const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID || '';
    const clientSecret = import.meta.env.VITE_SPOTIFY_CLIENT_SECRET || '';

    try {
      const res = await fetch(`/api/spotify-info?url=${encodeURIComponent(targetUrl)}`, {
        headers: {
          'x-spotify-client-id': clientId,
          'x-spotify-client-secret': clientSecret,
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch info');
      setInfo(data);
      setFetchStatus('done');

      if (data.type) setActiveTab(data.type);

      if (data.tracks?.length) {
        const allNums = new Set(data.tracks.map(t => t.trackNumber));
        setSelectedTracks(allNums);
      }

      if (data.coverUrl || data.thumbnail) {
        try {
          const color = await getAverageColor(data.coverUrl || data.thumbnail);
          setAmbientColor(color);
        } catch { }
      }

      saveToHistory(targetUrl, data.title, data.coverUrl || data.thumbnail, data.artist || data.owner, data.artistThumbnail);
    } catch (err) {
      setFetchStatus('error');
      setFetchError(err.message || 'Failed to load Spotify metadata');
    }
  };

  const saveToHistory = (newUrl, title, thumbnail, artist, artistThumbnail) => {
    if (!newUrl) return;
    setHistory(prev => {
      const filtered = prev.filter(item => item.url !== newUrl);
      const updated = [{ url: newUrl, title: title || newUrl, thumbnail, artist, artistThumbnail, date: Date.now() }, ...filtered].slice(0, 10);
      localStorage.setItem('sp_history', JSON.stringify(updated));
      return updated;
    });
  };

  const removeFromHistory = (targetUrl) => {
    setHistory(prev => {
      const updated = prev.filter(item => item.url !== targetUrl);
      localStorage.setItem('sp_history', JSON.stringify(updated));
      return updated;
    });
  };

  const removeArtistFromHistory = (artistName) => {
    try {
      let gHist = JSON.parse(localStorage.getItem('global_history') || '[]');
      gHist = gHist.filter(i => i.artist !== artistName);
      localStorage.setItem('global_history', JSON.stringify(gHist));
      setGlobalHistory(gHist);
      window.dispatchEvent(new Event('history_updated'));
    } catch { }
  };

  const toggleTrack = (num) => {
    setSelectedTracks(prev => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num); else next.add(num);
      return next;
    });
  };

  const selectAllTracks = () => {
    if (info?.tracks) setSelectedTracks(new Set(info.tracks.map(t => t.trackNumber)));
  };

  const deselectAllTracks = () => setSelectedTracks(new Set());

  const openDownloadModal = () => {
    if (info?.tracks?.length) setSelectedTracks(new Set(info.tracks.map(t => t.trackNumber)));
    setShowDownloadModal(true);
  };

  const handleQuickDownload = (trackNum) => {
    setSelectedTracks(new Set([trackNum]));
    setShowDownloadModal(true);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') fetchInfo();
  };

  const fetchMyPlaylists = async () => {
    if (!accessToken) return;
    setMyPlaylistsStatus('loading');
    setShowPlaylists(true);
    try {
      const res = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed');
      setMyPlaylists(data.items || []);
      setMyPlaylistsStatus('done');
    } catch {
      setMyPlaylistsStatus('error');
    }
  };

  // ─── SSE Download ────────────────────────────────────────────────────────

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
      prependNumbers: prependNumbers.toString(),
      prefixAlbumFolders: prefixAlbumFolders.toString(),
      customPath: localCustomPath || localStorage.getItem('customPath') || '',
    });
    if (scheduleTime) params.append('scheduleTime', scheduleTime);
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

      esRef.current = { close: () => { reader.cancel().catch(() => { }); esRef.current = null; } };

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

              if (d.trackStart) {
                d.currentTrack = d.trackStart.index + 1;
                d.status = `Downloading: ${d.trackStart.title}`;
              }
              let trackDoneSource = null;
              if (d.trackDone === true) {
                trackDoneSource = d.source || d.trackSource || null;
                if (d.trackTitle) d.status = `Downloaded: ${d.trackTitle}${trackDoneSource ? ` via ${trackDoneSource}` : ''}`;
              } else if (d.trackDone && typeof d.trackDone === 'object' && d.trackDone.title) {
                trackDoneSource = d.trackDone.source || null;
                d.status = `Downloaded: ${d.trackDone.title}${trackDoneSource ? ` via ${trackDoneSource}` : ''}`;
                d.trackDone = true;
              }
              if (d.trackPending) {
                d.status = `Failed: ${d.trackPending.title || d.trackTitle || ''}`;
                d.trackError = d.trackPending.reason || 'All attempts failed';
              }
              if (d.trackProgress && typeof d.trackProgress === 'object') d.trackProgress = d.trackProgress.percent;

              setDownloadState(prev => {
                const next = { ...prev, ...d };
                if (!d.done) next.active = true;
                if (d.done) next.active = false;
                if (d.trackStart) next.currentTrack = d.trackStart.index + 1;
                return next;
              });

              if (d.status?.toLowerCase().includes('search') || d.status?.toLowerCase().includes('connect')) setStep(1);
              if (d.progress > 0 && d.progress < 95) setStep(2);
              if (d.progress >= 95 || d.status?.toLowerCase().includes('finaliz')) setStep(3);

              if (d.trackStart) setTrackStatuses(prev => ({ ...prev, [d.trackStart.index]: 'downloading' }));
              if (d.trackDone === true) {
                const doneTitle = d.trackTitle;
                let doneIdx = (downloadState?.currentTrack || 1) - 1;
                if (doneTitle && info?.tracks) {
                  const foundIdx = info.tracks.findIndex(t => t.title === doneTitle);
                  if (foundIdx >= 0) doneIdx = foundIdx;
                }
                setTrackStatuses(prev => ({ ...prev, [doneIdx]: 'done' }));
              }
              if (d.trackError || (d.trackPending && d.trackTitle)) {
                const errTitle = d.trackTitle || d.trackPending?.title;
                let errIdx = (downloadState?.currentTrack || 1) - 1;
                if (errTitle && info?.tracks) {
                  const foundIdx = info.tracks.findIndex(t => t.title === errTitle);
                  if (foundIdx >= 0) errIdx = foundIdx;
                }
                setTrackStatuses(prev => ({ ...prev, [errIdx]: 'error' }));
                if (d.trackError) setTrackErrors(prev => ({ ...prev, [errIdx]: d.trackError }));
              }

              if (d.done) {
                setStep(4);
                if (esRef.current) { esRef.current.close(); esRef.current = null; }

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
                    } catch { }
                  }
                }
              }
            } catch { }
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
      try { await fetch(`/api/spotify-cancel?downloadId=${downloadIdRef.current}`); } catch { }
    }
    setDownloadState(prev => ({ ...prev, active: false, done: true, error: 'Download cancelled.' }));
    setStep(0);
  };

  const handleSelectLocalFolder = async () => {
    try {
      const res = await fetch('/api/ytdl/select-folder?temp=true');
      const data = await res.json();
      if (data.success && data.path) setLocalCustomPath(data.path);
    } catch { }
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
    <div className={`sp-page mode-${activeTab}`} style={{ '--ambient-color': ambientColor }}>
      <WaveformBg isActive={downloadState?.active && !downloadState?.done} color={ambientColor} />

      <div className="sp-scroll-area">
        <div className="sp-main">

          {/* ── HEADER (mirrors YouTube ytdl-header) ── */}
          <motion.header
            initial={{ opacity: 0, y: -30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="sp-header"
          >
            <div className="sp-header-center">
              <div className="sp-platform-badge">
                <SpotifyIcon size={14} color="currentColor" />
                Spotify
              </div>
              <h1 className="sp-title">Spotify tracks & music</h1>
              <p className="sp-subtitle">
                A focused workspace for tracks, albums, playlists and Spotify Music.
              </p>
            </div>

            {/* Right: action buttons & login */}
            <div className="sp-header-actions">
              {!accessToken ? (
                <button className="sp-account-pill" onClick={async () => {
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
                      } catch { }
                    }, 1000);
                  } else {
                    window.location.href = authUrl;
                  }
                }}>
                  <div className="sp-account-avatar">
                    <User size={13} />
                  </div>
                  <span className="sp-account-name">Login</span>
                  <ChevronDown size={13} className="sp-account-chevron" />
                </button>
              ) : (
                <div className="sp-profile-container" style={{ position: 'relative' }}>
                  <button className="sp-account-pill" onClick={() => setShowProfileMenu(!showProfileMenu)}>
                    {userProfile?.images?.[0]?.url ? (
                      <img src={userProfile.images[0].url} alt="Profile" className="sp-account-avatar sp-account-avatar--img" />
                    ) : (
                      <div className="sp-account-avatar"><User size={13} /></div>
                    )}
                    <span className="sp-account-name">{userProfile?.display_name || 'IANNC'}</span>
                    <ChevronDown size={13} className={`sp-account-chevron ${showProfileMenu ? 'open' : ''}`} />
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
                <button
                  className="sp-reset-btn"
                  onClick={reset}
                  title="Resetare"
                >
                  <RefreshCw size={18} />
                </button>
              )}
            </div>
          </motion.header>

          {/* ── SYSTEM STATUS ── */}
          <AnimatePresence>
            {systemStatus && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className={`sp-system-status ${isStatusExpanded ? 'expanded' : 'collapsed'}`}
              >
                <div className="sp-status-header-row" onClick={() => setIsStatusExpanded(!isStatusExpanded)}>
                  <div className="sp-status-quick">
                    <Zap size={15} />
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
                        <div className="sp-status-item"><Activity size={14} /><span>API Hits: <strong>{systemStatus.totalHits || 0}</strong></span></div>
                        <div className="sp-status-item"><Clock size={14} /><span>Uptime: <strong>{Math.floor((systemStatus.uptime || 0) / 60000)}m</strong></span></div>
                        <div className="sp-status-item"><Zap size={14} /><span>Active: <strong>{systemStatus.activeJobs}</strong></span></div>
                        <div className="sp-status-item"><CheckCircle2 size={14} /><span>Success: <strong>
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

          {/* ── NEW DOWNLOAD CARD ── */}
          {!downloadState && (
            <motion.div
              className="sp-url-card"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              style={{ position: "relative", zIndex: 50 }}
            >
              <div className="sp-input-section-label">
                <span>New download</span>
                <small>Paste a Spotify track, album, or playlist link</small>
              </div>

              <div className="sp-mode-toggle">
                {[
                  { id: 'track', icon: <Disc size={14} />, label: 'Track' },
                  { id: 'album', icon: <Music size={14} />, label: 'Album' },
                  { id: 'playlist', icon: <List size={14} />, label: 'Playlist' },
                ].map(tab => (
                  <button
                    key={tab.id}
                    className={`sp-mode-toggle-btn ${activeTab === tab.id ? 'active' : ''}`}
                    onClick={() => {
                      setActiveTab(tab.id);
                      setUrl('');
                      setInfo(null);
                      setFetchStatus('idle');
                      inputRef.current?.focus();
                    }}
                  >
                    {tab.icon} {tab.label}
                  </button>
                ))}
              </div>

              {clipboardToast && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="sp-clipboard-toast"
                >
                  Link detectat din clipboard!
                </motion.div>
              )}

              <div className="sp-url-icon">
                <SpotifyIcon size={24} color="var(--sp-green)" />
              </div>
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  position: "relative",
                }}
              >
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Paste Spotify link here..."
                  value={url}
                  onChange={e => { setUrl(e.target.value); setFetchStatus('idle'); setInfo(null); setFetchError(''); setError(null); setDownloadState(null); }}
                  onFocus={() => setShowHistory(true)}
                  onBlur={() => setTimeout(() => setShowHistory(false), 200)}
                  onKeyDown={handleKeyDown}
                  disabled={fetchStatus === 'loading'}
                  className="sp-url-input"
                  style={{ width: "100%", paddingRight: url ? "3rem" : "0" }}
                />
                {url && (
                  <button
                    className="sp-input-clear"
                    type="button"
                    onClick={reset}
                    title="Clear URL"
                  >
                    <X size={16} strokeWidth={2.5} />
                  </button>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center" }}>
                <button
                  className="sp-preview-btn"
                  onClick={() => fetchInfo()}
                  disabled={!url || fetchStatus === 'loading'}
                >
                  {fetchStatus === 'loading' ? (
                    <><Loader2 className="sp-spin" size={16} /> Loading...</>
                  ) : (
                    <><span className="sp-sparkle">✦</span> Preview</>
                  )}
                </button>
              </div>

              <AnimatePresence>
                {showHistory && history.length > 0 && !url && (
                  <motion.div
                    className="sp-history-dropdown"
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      background: "#121218",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "8px",
                      padding: "0.5rem",
                      zIndex: 60,
                      marginTop: "0.5rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                      boxShadow: "0 10px 25px rgba(0,0,0,0.5)"
                    }}
                  >
                    <div style={{ fontSize: "0.7rem", color: "#64748b", padding: "0.25rem 0.5rem", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Recent searches</div>
                    {history.map((h, i) => (
                      <div key={i} className="sp-history-item" onMouseDown={() => { setUrl(h.url); setShowHistory(false); setTimeout(() => fetchInfo(h.url), 100); }} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0.5rem", borderRadius: "6px", cursor: "pointer", color: "#cbd5e1", transition: "background 0.15s" }}>
                        {h.thumbnail ? <img src={h.thumbnail} alt="" style={{ width: "24px", height: "24px", borderRadius: "4px", objectFit: "cover" }} /> : <Clock size={14} style={{ opacity: 0.5, flexShrink: 0 }} />}
                        <span style={{ flex: 1, fontSize: "0.82rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.title}</span>
                        <button style={{ background: "transparent", border: "none", color: "#64748b", padding: "2px", display: "flex", alignItems: "center", cursor: "pointer" }} onMouseDown={e => { e.stopPropagation(); removeFromHistory(h.url); }}><X size={14} /></button>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="sp-capability-row">
                <span><Music size={13} /> MP3 320kbps</span>
                <span><Hash size={13} /> Embedded metadata</span>
                <span><Disc size={13} /> Album artwork</span>
                <span><Zap size={13} /> Local processing</span>
              </div>
            </motion.div>
          )}

          {/* ── Skeleton ── */}
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

          {/* ── INFO CARD ── */}
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
                        <img
                          src={info.ownerThumbnail || `/api/spotify-artist-thumbnail?name=${encodeURIComponent(info.owner)}`}
                          alt={info.owner}
                          className="sp-info-owner-pfp"
                          onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                        />
                        <div className="sp-info-owner-pfp-fallback" style={info.ownerThumbnail ? { display: 'none' } : { display: 'flex' }}>{info.owner.charAt(0).toUpperCase()}</div>
                        <span className="sp-info-owner-name">{info.owner}</span>
                      </div>
                    )}
                    <div className="sp-info-pills">
                      <SpotifyBadge type={info.type} />
                      {info.releaseDate && <span className="sp-info-pill"><Calendar size={11} /> {info.releaseDate.slice(0, 4)}</span>}
                      {info.totalTracks > 1 && info.type !== 'track' && (
                        <span className="sp-info-pill">
                          <Hash size={11} />
                          {info.trackCount < info.totalTracks ? `${info.trackCount} / ${info.totalTracks} tracks` : `${info.trackCount} tracks`}
                        </span>
                      )}
                      {info.durationMs > 0 && <span className="sp-info-pill"><Clock size={11} /> {fmtDuration(info.durationMs)}</span>}
                      {info.totalDurationMs > 0 && <span className="sp-info-pill"><Clock size={11} /> {fmtTotalDuration(info.totalDurationMs)}</span>}
                      {info.album && info.type === 'track' && <span className="sp-info-pill sp-info-pill--album"><Disc size={11} /> {info.album}</span>}
                    </div>
                    {info.type === 'track' && info.popularity > 0 && <PopularityMeter value={info.popularity} />}
                    {info.description && <p className="sp-info-desc">{info.description.replace(/<[^>]*>/g, '').slice(0, 120)}{info.description.length > 120 ? '…' : ''}</p>}
                  </div>
                </div>

                {/* Tracklist for albums/playlists */}
                {info.tracks?.length > 1 && (
                  <div className="sp-tracklist-container">
                    <div className="sp-tracklist-toolbar">
                      <div className="sp-tracklist-toolbar-left">
                        <span className="sp-tracklist-count-label">{selectedTracks.size} / {info.trackCount} selected</span>
                      </div>
                      <div className="sp-tracklist-toolbar-right">
                        <button className={`sp-view-btn ${playlistViewMode === 'list' ? 'active' : ''}`} onClick={() => setPlaylistViewMode('list')} title="List view" style={playlistViewMode === 'list' ? { background: '#1DB954', color: '#000', borderColor: '#1DB954' } : {}}>
                          <ListVideo size={14} />
                        </button>
                        <button className={`sp-view-btn ${playlistViewMode === 'grid' ? 'active' : ''}`} onClick={() => setPlaylistViewMode('grid')} title="Grid view" style={playlistViewMode === 'grid' ? { background: '#1DB954', color: '#000', borderColor: '#1DB954' } : {}}>
                          <LayoutGrid size={14} />
                        </button>
                        <button className="sp-track-util-btn" onClick={selectAllTracks}>All</button>
                        <button className="sp-track-util-btn" onClick={deselectAllTracks}>None</button>
                      </div>
                    </div>

                    {playlistViewMode === 'list' && (
                      <>
                        <div className="sp-playlist-preview-header">
                          <div /><div />
                          <div>Title</div>
                          <div>Artist</div>
                          <div style={{ textAlign: 'right' }}>Duration</div>
                          <div />
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
                                {track.coverUrl ? <img src={track.coverUrl} alt="" className="sp-preview-row-thumb" /> : <div className="sp-preview-row-thumb-fallback"><Music size={13} /></div>}
                                <div className="sp-preview-row-title-col">
                                  <strong>{cleanTitle}{isExplicit && <span className="sp-explicit-badge">E</span>}</strong>
                                  {featArtist && <span className="sp-feat-artist">feat. {featArtist}</span>}
                                </div>
                                <div className="sp-preview-row-text-col" style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {track.artist && track.artist !== info.artist ? track.artist : ''}
                                </div>
                                <span className="sp-preview-row-duration">{fmtDuration(track.durationMs)}</span>
                                <button className="sp-preview-quick-dl" title="Download only this track" onClick={e => { e.stopPropagation(); handleQuickDownload(track.trackNumber); }}>
                                  <Download size={13} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}

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
                                    <button className="sp-playlist-card-quick-dl" title="Download only this track" onClick={e => { e.stopPropagation(); handleQuickDownload(track.trackNumber); }}>
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

                    {info.trackCount > 10 && !showAllTracks && (
                      <div className="sp-more-tracks-pill" onClick={() => setShowAllTracks(true)}>
                        <span className="sp-more-tracks-pill__count">+{info.trackCount - 10}</span>
                        <span className="sp-more-tracks-pill__label">{info.trackCount - 10 === 1 ? 'more track' : 'more tracks'} — all will be downloaded</span>
                      </div>
                    )}
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
                    <div className="sp-setting-group">
                      <span className="sp-setting-label">
                        <CalendarClock size={14} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: 4 }} />
                        Schedule Download (optional)
                      </span>
                      <p className="sp-setting-desc">Leave empty for immediate download, or set a time to start automatically.</p>
                      <input type="time" className="sp-modal-time-input" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} />
                    </div>
                    <div className="sp-setting-group">
                      <span className="sp-setting-label">
                        <FolderOpen size={14} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: 4 }} />
                        Download Folder (this download only)
                      </span>
                      <p className="sp-setting-desc">Select a custom folder for this download only, overriding global settings.</p>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                        <input type="text" className="sp-url-input" readOnly value={localCustomPath || 'Default folder'} style={{ flex: 1, color: localCustomPath ? '#ffffff' : '#666', fontSize: '0.85rem' }} />
                        <button className="sp-modal-confirm" onClick={handleSelectLocalFolder} style={{ padding: '0 1rem', whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                          Choose folder
                        </button>
                      </div>
                    </div>
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

                {/* Scheduled */}
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


        {/* ── RECENTLY PLAYED ARTISTS (gallery card, floating bubbles — mirrors YouTube) ── */}
        {history?.length > 0 && (
          <>
            <section className="sp-artist-gallery">
              <div className="sp-history-panel-title">
                <Music size={14} /> Recently played artists
              </div>
              <div className="sp-artist-bubbles">
                {historyArtists.slice(0, 6).map((artist, index) => (
                  <button
                    key={artist.name}
                    className="sp-artist-bubble"
                    style={{ '--bubble-index': index }}
                    onClick={() => {
                      setUrl(`https://open.spotify.com/search/${encodeURIComponent(artist.name)}`);
                      fetchInfo(`https://open.spotify.com/search/${encodeURIComponent(artist.name)}`);
                    }}
                    title={artist.name}
                  >
                    {artist.thumbnail ? (
                      <img src={artist.thumbnail} alt="" />
                    ) : (
                      <span>{artist.name.slice(0, 1).toUpperCase()}</span>
                    )}
                    <strong>{artist.name}</strong>
                    <span
                      className="sp-history-remove"
                      role="button"
                      tabIndex={0}
                      onClick={e => { e.stopPropagation(); removeArtistFromHistory(artist.name); }}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); removeArtistFromHistory(artist.name); }}}
                      title="Remove artist from history"
                    >
                      <X size={12} strokeWidth={2.5} />
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {/* ── BOTTOM 2-COLUMN GRID ── */}
            <section className="sp-history-panels">
              {/* Left — Recent Artists */}
              <div className="sp-history-panel">
                <div className="sp-history-panel-title">
                  <Music size={14} /> Recent artists
                </div>
                <div className="sp-channel-chips">
                  {historyArtists.slice(0, 6).map((artist) => (
                    <button
                      key={artist.name}
                      className="sp-channel-chip"
                      onClick={() => {
                        setUrl(`https://open.spotify.com/search/${encodeURIComponent(artist.name)}`);
                        fetchInfo(`https://open.spotify.com/search/${encodeURIComponent(artist.name)}`);
                      }}
                      title={`Open ${artist.name}`}
                    >
                      {artist.thumbnail ? (
                        <img src={artist.thumbnail} alt="" className="sp-channel-avatar" />
                      ) : (
                        <span className="sp-channel-avatar">{artist.name.slice(0, 1).toUpperCase()}</span>
                      )}
                      <span className="sp-channel-name">{artist.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Right — Recent Downloads */}
              <div className="sp-history-panel">
                <div className="sp-history-panel-title">
                  <Clock size={14} /> Recent downloads
                </div>
                <div className="sp-recent-list">
                  {history.slice(0, 4).map((item) => (
                    <button
                      key={item.url}
                      className="sp-recent-item"
                      onClick={() => { setUrl(item.url); fetchInfo(item.url); }}
                    >
                      {item.thumbnail ? (
                        <img src={item.thumbnail} alt="" className="sp-recent-thumb" />
                      ) : (
                        <span className="sp-recent-thumb" />
                      )}
                      <span className="sp-recent-name">{item.title}</span>
                      <span className="sp-recent-date">
                        {new Date(item.date || Date.now()).toLocaleDateString()}
                      </span>
                      <span
                        className="sp-recent-remove"
                        role="button"
                        tabIndex={0}
                        onClick={e => { e.stopPropagation(); removeFromHistory(item.url); }}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); removeFromHistory(item.url); }}}
                        title="Remove from history"
                      >
                        <X size={13} strokeWidth={2.5} />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}

        {/* Fallback: only recent downloads, no artist history */}
        {(!historyArtists?.length && history?.length > 0) && (
          <section className="sp-history-panels sp-history-panels--single">
            <div className="sp-history-panel">
              <div className="sp-history-panel-title">
                <Clock size={14} /> Recent downloads
              </div>
              <div className="sp-recent-list">
                {history.slice(0, 4).map((item) => (
                  <button
                    key={item.url}
                    className="sp-recent-item"
                    onClick={() => { setUrl(item.url); fetchInfo(item.url); }}
                  >
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt="" className="sp-recent-thumb" />
                    ) : (
                      <span className="sp-recent-thumb" />
                    )}
                    <span className="sp-recent-name">{item.title}</span>
                    <span className="sp-recent-date">
                      {new Date(item.date || Date.now()).toLocaleDateString()}
                    </span>
                    <span
                      className="sp-recent-remove"
                      role="button"
                      tabIndex={0}
                      onClick={e => { e.stopPropagation(); removeFromHistory(item.url); }}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); removeFromHistory(item.url); }}}
                      title="Remove from history"
                    >
                      <X size={13} strokeWidth={2.5} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── FOOTER ── */}
        <footer className="sp-footer">
          <div className="sp-footer-inner">
            <div className="sp-footer-top">
              <div className="sp-footer-brand">
                <span className="sp-footer-dot" />
                <span className="sp-footer-brand-name">MediaDL</span>
                <span className="sp-footer-brand-sep">&middot;</span>
                <span className="sp-footer-brand-sub">SPOTIFY</span>
              </div>
              <div className="sp-footer-badges">
                <span className="sp-footer-badge sp-badge--spotdl">SPOTDL</span>
                <span className="sp-footer-badge sp-badge--api">SPOTIFY API</span>
                <span className="sp-footer-badge sp-badge--quality">LOSSLESS QUALITY</span>
                <span className="sp-footer-badge sp-badge--id3">ID3 TAGS</span>
              </div>
            </div>
            <div className="sp-footer-divider" />
            <div className="sp-footer-bottom">
              <span className="sp-footer-copy">&copy; 2026 MediaDL &nbsp;&middot;&nbsp; v1.0.69</span>
              <span className="sp-footer-tagline">For personal use only &middot; Respect artists &amp; their work</span>
            </div>
          </div>
        </footer>

        </div>{/* end sp-main */}

      </div>{/* end sp-scroll-area */}

      {/* ── My Playlists Modal ── */}
      <AnimatePresence>
        {showPlaylists && (
          <motion.div className="sp-modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={e => e.target === e.currentTarget && setShowPlaylists(false)}>
            <motion.div className="sp-modal" initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}>
              <div className="sp-modal-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>My Playlists</span>
                <button className="sp-modal-cancel" onClick={() => setShowPlaylists(false)}><X size={16} /> Close</button>
              </div>
              {myPlaylistsStatus === 'loading' && <div className="sp-pl-loading"><Loader2 className="sp-spin" size={32} /><span>Fetching your playlists...</span></div>}
              {myPlaylistsStatus === 'error' && <div className="sp-pl-error"><AlertCircle size={24} /><span>Failed to load playlists. Please log in again.</span></div>}
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
