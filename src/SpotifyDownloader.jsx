import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Music, Download, Loader2, AlertCircle, CheckCircle2,
  Link2, List, Disc, Search, RefreshCw, Clipboard,
  X, ChevronDown, ChevronUp, FolderOpen, Clock,
  Star, Calendar, Hash, Users, Archive, Play, User, LogOut, ListVideo, HardDrive, Database
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

async function getValidAccessToken(clientId, clientSecret) {
  const expiresAt   = parseInt(localStorage.getItem('spotify_expires_at') || '0', 10);
  const accessToken = localStorage.getItem('spotify_access_token')  || '';
  const refreshToken = localStorage.getItem('spotify_refresh_token') || '';

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
        localStorage.setItem('spotify_access_token', data.access_token);
        localStorage.setItem('spotify_expires_at', Date.now() + data.expires_in * 1000);
        if (data.refresh_token) localStorage.setItem('spotify_refresh_token', data.refresh_token);
        return data.access_token;
      }
    } catch (e) {
      console.warn('[spotify] Token refresh failed:', e);
    }
  }
  return accessToken;
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
  
  // Mass Downloader specific state
  const [massFetchInfo, setMassFetchInfo] = useState(null);
  const [massFetchError, setMassFetchError] = useState('');
  const [massDlState, setMassDlState] = useState(null);
  const [massFormat, setMassFormat] = useState('mp3_320');
  const massEsRef = useRef(null);
  const massDownloadIdRef = useRef(null);
  
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
              if (data.expires_in) localStorage.setItem('spotify_expires_at', Date.now() + data.expires_in * 1000);
              setAccessToken(data.access_token);
            } else {
              console.error(`Eroare la obținerea token-ului Spotify: ${data.error || 'Necunoscut'}`);
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

  const handleMassFetch = async () => {
    setMassFetchError('');
    if (!bulkMeta.trim() || !bulkMeta.includes('spotify.com/playlist')) {
      setMassFetchError("Te rugăm să introduci un link valid de Playlist Spotify.");
      return;
    }
    setIsExtracting(true);
    try {
      const clientId     = localStorage.getItem('spotify_client_id')     || '';
      const clientSecret = localStorage.getItem('spotify_client_secret') || '';
      const userAccessToken = await getValidAccessToken(clientId, clientSecret);
      if (userAccessToken && userAccessToken !== accessToken) setAccessToken(userAccessToken);
      const res = await fetch(`/api/spotify-mass-fetch?url=${encodeURIComponent(bulkMeta)}`, {
        headers: {
          'x-spotify-client-id': clientId,
          'x-spotify-client-secret': clientSecret,
          'x-spotify-access-token': userAccessToken
        }
      });
      const data = await res.json();
      if (res.ok) {
        setMassFetchInfo(data);
      } else {
        throw new Error(data.error || 'Failed to fetch playlist');
      }
    } catch (err) {
      console.error(err);
      setMassFetchError(err.message);
    }
    setIsExtracting(false);
  };

  const startMassDownload = async () => {
    if (!massFetchInfo || massDlState?.active) return;
    if (massEsRef.current) massEsRef.current.close();
    
    const fmt = AUDIO_FORMATS.find(f => f.id === massFormat);
    const formatStr = `audio:${fmt.audioFmt}:${fmt.quality}`;
    const dlId = Date.now().toString();
    massDownloadIdRef.current = dlId;

    const clientId     = localStorage.getItem('spotify_client_id')     || '';
    const clientSecret = localStorage.getItem('spotify_client_secret') || '';
    const userAccessToken = await getValidAccessToken(clientId, clientSecret);
    if (userAccessToken && userAccessToken !== accessToken) setAccessToken(userAccessToken);

    setMassDlState({ active: true, done: false, error: null, current: 0, total: massFetchInfo.totalTracks });

    try {
      const params = new URLSearchParams({ url: bulkMeta, format: formatStr, downloadId: dlId });
      const res = await fetch(`/api/spotify-mass-download?${params}`, {
        headers: {
          'x-spotify-client-id': clientId,
          'x-spotify-client-secret': clientSecret,
          'x-spotify-access-token': userAccessToken
        }
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      massEsRef.current = { close: () => { reader.cancel().catch(()=>{}); massEsRef.current = null; } };

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
              setMassDlState(prev => {
                const next = { ...prev, ...d };
                if (d.done) next.active = false;
                return next;
              });
              if (d.done && massEsRef.current) {
                massEsRef.current.close(); massEsRef.current = null;
              }
            } catch (e) {}
          }
        }
      }
    } catch (err) {
      setMassDlState(prev => ({ ...prev, active: false, done: true, error: 'Connection lost' }));
    }
  };

  const cancelMassDownload = async () => {
    if (massEsRef.current) massEsRef.current.close();
    if (massDownloadIdRef.current) {
      try { await fetch(`/api/spotify-mass-cancel?downloadId=${massDownloadIdRef.current}`); } catch { }
    }
    setMassDlState(prev => ({ ...prev, active: false, done: true, cancelled: true, error: 'Descărcarea a fost anulată' }));
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
            <motion.div 
              className="sp-bulk-container" 
              initial={{ opacity: 0, y: 10 }} 
              animate={{ opacity: 1, y: 0 }} 
              exit={{ opacity: 0, y: -10 }}
              style={{ textAlign: 'left', width: '100%', marginTop: 20, background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 20, border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h3 style={{ margin: 0, color: '#fff', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ListVideo size={18} color="#1DB954" /> Mass Downloader
                </h3>
                <button onClick={() => { setShowBulk(false); setMassFetchInfo(null); setMassDlState(null); setMassFetchError(''); }} style={{ background: 'none', border: 'none', color: '#a0a0a0', cursor: 'pointer', transition: 'color 0.2s', padding: 4, borderRadius: 4 }}><X size={18} /></button>
              </div>

              {!massFetchInfo && !massDlState ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ padding: '5px 0' }}>
                  <p style={{ color: '#a0a0a0', fontSize: '0.9rem', marginBottom: 15, lineHeight: 1.5 }}>
                    Introdu link-ul către un <b>Playlist Spotify</b>. Aplicația va ocoli limitele de paginare și va scana sute de piese, pregătindu-le pentru descărcare simultană.
                  </p>
                  <div style={{ position: 'relative' }}>
                    <input 
                      type="text"
                      value={bulkMeta}
                      onChange={(e) => { setBulkMeta(e.target.value); setMassFetchError(''); }}
                      placeholder="https://open.spotify.com/playlist/..."
                      disabled={isExtracting}
                      style={{ width: '100%', padding: '12px 15px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 8, outline: 'none', fontSize: '0.9rem' }}
                    />
                  </div>
                  <button 
                    disabled={isExtracting}
                    onClick={handleMassFetch}
                    style={{ width: '100%', padding: '12px', marginTop: 15, background: '#1DB954', color: '#000', fontWeight: 'bold', border: 'none', borderRadius: 8, cursor: isExtracting ? 'not-allowed' : 'pointer', opacity: isExtracting ? 0.8 : 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
                  >
                    {isExtracting ? (
                      <>
                        <Loader2 size={18} className="sp-spin" />
                        <span>Se scanează playlist-ul<motion.span animate={{ opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 1.5 }}>...</motion.span></span>
                      </>
                    ) : (
                      <>
                        <Download size={18} /> Preia toate piesele
                      </>
                    )}
                  </button>

                  <AnimatePresence>
                    {massFetchError && (
                      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} style={{ marginTop: 15, padding: 15, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 8, color: '#ef4444', fontSize: '0.85rem', lineHeight: 1.5 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                          <div style={{ flex: 1 }}>{massFetchError}</div>
                        </div>
                        {massFetchError.includes('SPOTIFY_403') && (
                          <button onClick={() => {
                            const clientId = localStorage.getItem('spotify_client_id');
                            if (!clientId) return alert('Please set your Client ID in Settings first!');
                            const redirectUri = window.location.origin + '/';
                            const scope = encodeURIComponent('playlist-read-private playlist-read-collaborative');
                            window.location.href = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&show_dialog=true&_cb=${Date.now()}`;
                          }} style={{ marginTop: 12, width: '100%', padding: '10px', background: '#1DB954', color: '#000', fontWeight: 'bold', border: 'none', borderRadius: 6, cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
                            <User size={16} /> Login to Spotify
                          </button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ) : massDlState ? (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0' }}>
                  {!massDlState.done ? (
                    <>
                      {/* Rotating Vinyl/Cover */}
                      <div style={{ position: 'relative', width: 120, height: 120, marginBottom: 20 }}>
                        <motion.img 
                          src={massDlState.coverUrl || massFetchInfo?.playlistCover || 'https://via.placeholder.com/150'} 
                          animate={{ rotate: 360 }} 
                          transition={{ repeat: Infinity, duration: 8, ease: "linear" }}
                          style={{ width: 120, height: 120, borderRadius: '50%', objectFit: 'cover', border: '4px solid #1DB954', boxShadow: '0 0 30px rgba(29, 185, 84, 0.4)' }}
                        />
                        <div style={{ position: 'absolute', top: '50%', left: '50%', width: 24, height: 24, background: '#121212', borderRadius: '50%', transform: 'translate(-50%, -50%)', border: '2px solid #1DB954' }} />
                      </div>

                      {/* Current Track Info */}
                      <div style={{ textAlign: 'center', marginBottom: 25, width: '100%' }}>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 4 }}>
                          {massDlState.title || 'Se pregătește...'}
                        </div>
                        <div style={{ fontSize: '0.9rem', color: '#a0a0a0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {massDlState.artist || 'Așteptare...'}
                        </div>
                        {massDlState.status && <div style={{ color: '#1DB954', fontSize: '0.8rem', marginTop: 6, fontWeight: 500 }}>{massDlState.status}</div>}
                      </div>

                      {/* Progress Bars */}
                      <div style={{ width: '100%', marginBottom: 20 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#a0a0a0', marginBottom: 6 }}>
                          <span>{massDlState.current} / {massDlState.total} piese</span>
                          <span>{massDlState.percent || 0}%</span>
                        </div>
                        <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
                          <motion.div animate={{ width: `${massDlState.percent || 0}%` }} transition={{ duration: 0.3 }} style={{ height: '100%', background: '#1DB954' }} />
                        </div>
                        <div style={{ width: '100%', height: 2, background: 'rgba(255,255,255,0.05)', borderRadius: 1, overflow: 'hidden' }}>
                          <motion.div animate={{ width: `${massDlState.trackProgress || 0}%` }} transition={{ duration: 0.1 }} style={{ height: '100%', background: 'rgba(255,255,255,0.4)' }} />
                        </div>
                      </div>

                      {/* Stats row */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '0.85rem', color: '#a0a0a0', marginBottom: 25, background: 'rgba(0,0,0,0.3)', padding: '12px 15px', borderRadius: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><CheckCircle2 size={15} color="#1DB954" /> <span style={{ color: '#fff' }}>{massDlState.current ? massDlState.current - 1 - (massDlState.failed || 0) : 0}</span> ok</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><AlertCircle size={15} color={massDlState.failed ? '#ef4444' : '#a0a0a0'} /> <span style={{ color: massDlState.failed ? '#ef4444' : '#fff' }}>{massDlState.failed || 0}</span> failed</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Clock size={15} color="#60a5fa" /> <span style={{ color: '#fff' }}>{massDlState.estimatedSecondsRemaining ? `~${Math.ceil(massDlState.estimatedSecondsRemaining / 60)}m` : '...'}</span></div>
                      </div>

                      <button onClick={cancelMassDownload} style={{ width: '100%', padding: '12px', background: 'transparent', border: '1px solid rgba(239, 68, 68, 0.5)', color: '#ef4444', borderRadius: 8, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500, transition: 'all 0.2s', ':hover': { background: 'rgba(239, 68, 68, 0.1)' } }}>
                        Anulează descărcarea
                      </button>
                    </>
                  ) : (
                    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={{ textAlign: 'center', padding: '10px 0', width: '100%' }}>
                      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', bounce: 0.5 }} style={{ width: 64, height: 64, borderRadius: '50%', background: massDlState.cancelled ? 'rgba(239,68,68,0.1)' : 'rgba(29,185,84,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 15px' }}>
                        {massDlState.cancelled ? <AlertCircle size={32} color="#ef4444" /> : <CheckCircle2 size={32} color="#1DB954" />}
                      </motion.div>
                      
                      <h3 style={{ color: '#fff', margin: '0 0 8px 0', fontSize: '1.2rem' }}>
                        {massDlState.cancelled ? 'Descărcare Anulată' : 'Descărcare Completă!'}
                      </h3>
                      
                      <p style={{ color: '#a0a0a0', fontSize: '0.95rem', margin: '0 0 25px 0' }}>
                        {massDlState.completedCount || 0} piese descărcate • {massDlState.failedCount || 0} eșuate
                        {massDlState.error && <span style={{ display: 'block', color: '#ef4444', marginTop: 10, padding: 10, background: 'rgba(239,68,68,0.1)', borderRadius: 6, fontSize: '0.85rem' }}>Eroare: {massDlState.error}</span>}
                      </p>
                      
                      <div style={{ display: 'flex', gap: 10 }}>
                        {massDlState.zipPath && (
                          <button onClick={() => window.location.href = `/api/download-file?file=${encodeURIComponent(massDlState.zipPath)}`} style={{ flex: 1.5, padding: '12px', background: '#1DB954', border: 'none', color: '#000', borderRadius: 8, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 'bold' }}>
                            Salvează ZIP
                          </button>
                        )}
                        <button onClick={openFolder} style={{ flex: 1, padding: '12px', background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: '0.9rem' }}>
                          <FolderOpen size={16} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} /> Deschide
                        </button>
                        <button onClick={() => { setMassDlState(null); setMassFetchInfo(null); }} style={{ flex: 1, padding: '12px', background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: '0.9rem' }}>
                          Nouă
                        </button>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              ) : (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {/* Header */}
                  <div style={{ display: 'flex', gap: 20, background: 'rgba(0,0,0,0.2)', padding: 15, borderRadius: 10 }}>
                    {massFetchInfo.playlistCover ? (
                      <img src={massFetchInfo.playlistCover} alt="Cover" style={{ width: 80, height: 80, borderRadius: 10, objectFit: 'cover', boxShadow: '0 8px 16px rgba(0,0,0,0.3)' }} />
                    ) : (
                      <div style={{ width: 80, height: 80, borderRadius: 10, background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 16px rgba(0,0,0,0.3)' }}><Music size={32} color="#a0a0a0" /></div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1 }}>
                      <h4 style={{ margin: '0 0 4px 0', color: '#fff', fontSize: '1.1rem', fontWeight: 600 }}>{massFetchInfo.playlistName}</h4>
                      <div style={{ color: '#1DB954', fontSize: '0.85rem', marginBottom: 10, fontWeight: 500 }}>by {massFetchInfo.owner || 'Unknown'}</div>
                      
                      <div style={{ display: 'flex', gap: 15, color: '#a0a0a0', fontSize: '0.85rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Music size={14} /> {massFetchInfo.totalTracks} tracks</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Clock size={14} /> {fmtTotalDuration(massFetchInfo.tracks.reduce((acc, t) => acc + (t.durationMs || 0), 0))}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><HardDrive size={14} /> ~{estimateSize(massFetchInfo.tracks.reduce((acc, t) => acc + (t.durationMs || 0), 0), AUDIO_FORMATS.find(f => f.id === massFormat)?.kbps || 320)}</div>
                      </div>
                    </div>
                  </div>

                  <div style={{ height: 1, background: 'rgba(255,255,255,0.1)' }} />

                  {/* Metadata Sources */}
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#a0a0a0', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, letterSpacing: 0.5 }}><Database size={13} /> METADATA SOURCES</div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      {(() => {
                        const counts = {
                          spotify: massFetchInfo.tracks.filter(t => t.metadataSource === 'spotify').length,
                          itunes: massFetchInfo.tracks.filter(t => t.metadataSource === 'itunes').length,
                          yt: massFetchInfo.tracks.filter(t => t.metadataSource === 'youtube_music').length,
                        };
                        return (
                          <>
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} style={{ flex: 1, background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 12, border: `1px solid ${counts.spotify > 0 ? '#1DB954' : 'rgba(255,255,255,0.05)'}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: counts.spotify > 0 ? '#1DB954' : '#666', fontSize: '0.75rem', fontWeight: 600 }}>
                                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" /></svg>
                                Spotify API
                              </div>
                              <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} style={{ fontSize: '1.2rem', color: counts.spotify > 0 ? '#fff' : '#666', fontWeight: 'bold' }}>{counts.spotify}</motion.div>
                            </motion.div>
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} style={{ flex: 1, background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 12, border: `1px solid ${counts.itunes > 0 ? '#fb923c' : 'rgba(255,255,255,0.05)'}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: counts.itunes > 0 ? '#fb923c' : '#666', fontSize: '0.75rem', fontWeight: 600 }}>
                                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M17.05 15.48c-.02-2.85 2.33-4.22 2.44-4.29-1.32-1.93-3.38-2.19-4.1-2.23-1.75-.18-3.41 1.03-4.3 1.03-.89 0-2.27-1.01-3.73-.98-1.9.03-3.66 1.1-4.63 2.8-1.97 3.41-.5 8.45 1.41 11.22.94 1.35 2.05 2.88 3.51 2.83 1.42-.05 1.95-.92 3.66-.92 1.7 0 2.19.92 3.68.89 1.51-.03 2.48-1.4 3.41-2.76 1.07-1.56 1.51-3.08 1.53-3.16-.03-.01-2.85-1.1-2.88-4.43zM14.65 5.54c.78-.94 1.3-2.25 1.16-3.54-1.11.04-2.47.74-3.27 1.69-.71.84-1.34 2.18-1.18 3.44 1.24.1 2.51-.65 3.29-1.59z"/></svg>
                                iTunes
                              </div>
                              <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} style={{ fontSize: '1.2rem', color: counts.itunes > 0 ? '#fff' : '#666', fontWeight: 'bold' }}>{counts.itunes}</motion.div>
                            </motion.div>
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} style={{ flex: 1, background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 12, border: `1px solid ${counts.yt > 0 ? '#f43f5e' : 'rgba(255,255,255,0.05)'}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: counts.yt > 0 ? '#f43f5e' : '#666', fontSize: '0.75rem', fontWeight: 600 }}>
                                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M21.582 6.186a2.684 2.684 0 00-1.884-1.898C17.983 3.8 12 3.8 12 3.8s-5.983 0-7.698.488A2.684 2.684 0 002.418 6.186C1.94 7.915 1.94 12 1.94 12s0 4.085.478 5.814a2.684 2.684 0 001.884 1.898C5.983 20.2 12 20.2 12 20.2s5.983 0 7.698-.488a2.684 2.684 0 001.884-1.898C22.06 16.085 22.06 12 22.06 12s0-4.085-.478-5.814zM9.913 14.894V9.106l5.244 2.894-5.244 2.894z"/></svg>
                                YT Music
                              </div>
                              <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} style={{ fontSize: '1.2rem', color: counts.yt > 0 ? '#fff' : '#666', fontWeight: 'bold' }}>{counts.yt}</motion.div>
                            </motion.div>
                          </>
                        )
                      })()}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                    <select 
                      value={massFormat} 
                      onChange={(e) => setMassFormat(e.target.value)}
                      style={{ flex: 1, padding: '12px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 8, outline: 'none', cursor: 'pointer' }}
                    >
                      {AUDIO_FORMATS.map(f => (
                        <option key={f.id} value={f.id}>{f.label} - {f.sub}</option>
                      ))}
                    </select>
                    <button onClick={startMassDownload} style={{ flex: 1.5, padding: '12px', background: '#1DB954', color: '#000', fontWeight: 'bold', border: 'none', borderRadius: 8, cursor: 'pointer', transition: 'background 0.2s', ':hover': { background: '#1ed760' } }}>
                      Începe descărcarea
                    </button>
                  </div>
                </motion.div>
              )}
            </motion.div>
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
