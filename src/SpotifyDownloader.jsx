import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Music, Download, Loader2, AlertCircle, CheckCircle2,
  Link2, List, Disc, Search, RefreshCw, Clipboard,
  X, ChevronDown, ChevronUp, FolderOpen, Clock,
  Star, Calendar, Hash, Users, Archive, Play, User, LogOut, ListVideo, HardDrive, Database
} from 'lucide-react';
import { getAverageColor } from './utils/colorUtils';
import WaveformBg from './WaveformBg';
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
  const expiresAt = parseInt(localStorage.getItem('spotify_expires_at') || '0', 10);
  const accessToken = localStorage.getItem('spotify_access_token') || '';
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
  // Do not keep presenting an expired token as a valid login when its refresh
  // failed. That used to leave the UI on "My Profile" while API requests were
  // silently retried with client credentials (which cannot read private lists).
  if (expiresAt && Date.now() >= expiresAt - 60000) {
    clearSpotifyAuth();
    return '';
  }
  return accessToken;
}

function clearSpotifyAuth() {
  localStorage.removeItem('spotify_access_token');
  localStorage.removeItem('spotify_refresh_token');
  localStorage.removeItem('spotify_expires_at');
}



const BUBBLE_POSITIONS = [
  { x: 42, y: 50 },
  { x: 65, y: 40 },
  { x: 25, y: 65 },
  { x: 75, y: 60 },
  { x: 30, y: 35 },
  { x: 55, y: 70 },
  { x: 85, y: 35 },
  { x: 15, y: 45 },
  { x: 45, y: 25 },
  { x: 70, y: 75 },
];

function ArtistBubbles({ artists, onRemove }) {
  if (!artists || artists.length === 0) {
    return (
      <div className="sp-artist-bubbles sp-artist-bubbles--empty">
        <div className="sp-bubbles-empty-hint">
          <div className="sp-bubbles-empty-icon">
            <User size={28} />
          </div>
          <span>Descarca ceva<br />ca sa apara artistii</span>
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
            <div
              key={artist.name + i}
              className="sp-bubble-wrapper"
              style={{
                position: 'absolute',
                left: `${pos.x}%`,
                top: `${pos.y}%`,
                width: 140,
                height: 140,
                transform: 'translate(-50%, -50%)',
                zIndex: 1
              }}
            >
              <motion.div
                className="sp-bubble"
                style={{ position: 'relative', left: 0, top: 0, width: '100%', height: '100%', transform: 'none' }}
                initial={{ opacity: 0, scale: 0 }}
                animate={{
                  opacity: 1,
                  scale: 1,
                  x: [0, dx1, dx2, 0],
                  y: [0, dy1, dy2, 0],
                }}
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
                  <div className="sp-bubble-fallback">
                    <User size={140 * 0.35} />
                  </div>
                )}
                <div className="sp-bubble-name">{artist.name}</div>
                <button
                  className="sp-bubble-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onRemove) onRemove(artist.name);
                  }}
                  title="Remove artist from history"
                >
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

export default function SpotifyDownloader({ activeDownloadId }) {
  const [url, setUrl] = useState('');
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(false);
  const [ambientColor, setAmbientColor] = useState('rgba(29, 185, 84, 0.12)'); // default green glow

  useEffect(() => {
    try {
      const saved = localStorage.getItem('sp_history');
      if (saved) setHistory(JSON.parse(saved));
    } catch { }
  }, []);

  const saveToHistory = (newUrl, title, thumbnail, artist, artistThumbnail) => {
    if (!newUrl) return;
    setHistory(prev => {
      const filtered = prev.filter(item => item.url !== newUrl);
      const updated = [{ url: newUrl, title: title || newUrl, thumbnail, artist: artist || '', artistThumbnail: artistThumbnail || null, date: Date.now() }, ...filtered].slice(0, 10);
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

  // Emit download_update for Dynamic Island
  useEffect(() => {
    const isActive = downloadState?.active && !downloadState?.done;
    if (isActive) {
      const completed = downloadState.current ?? 0;
      const total = downloadState.total ?? 1;
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
      window.dispatchEvent(new CustomEvent('download_update', {
        detail: {
          source: 'spotify',
          progress: pct,
          status: `${completed} / ${total} tracks`,
          thumbnail: info?.coverUrl || info?.thumbnail || info?.playlistCover || null,
          title: info?.title || info?.name || 'Spotify',
          done: false
        }
      }));
    } else if (downloadState?.done && !downloadState?.error) {
      window.dispatchEvent(new CustomEvent('download_update', { detail: { source: 'spotify', done: true } }));
    } else if (downloadState?.done && downloadState?.error) {
      window.dispatchEvent(new CustomEvent('download_update', { detail: { source: 'spotify', error: true } }));
    }
  }, [downloadState]);

  // Auto-paste removed to prevent interference with manual pasting

  useEffect(() => {
    const checkAuth = async () => {
      const clientId = localStorage.getItem('spotify_client_id') || '';
      const clientSecret = localStorage.getItem('spotify_client_secret') || '';
      const storedToken = await getValidAccessToken(clientId, clientSecret);
      if (storedToken) setAccessToken(storedToken);

      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      if (code) {
        window.history.replaceState({}, null, '/');
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
              console.error(`Eroare la obÈ›inerea token-ului Spotify: ${data.error || 'Necunoscut'}`);
            }
          } catch (err) {
            alert(`Eroare de reÈ›ea la autentificarea Spotify: ${err.message}`);
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
        .then(async r => {
          if (r.status === 401) {
            const clientId = localStorage.getItem('spotify_client_id');
            const clientSecret = localStorage.getItem('spotify_client_secret');
            const newToken = await getValidAccessToken(clientId, clientSecret);
            if (newToken && newToken !== accessToken) {
              setAccessToken(newToken);
            } else {
              clearSpotifyAuth();
              setAccessToken('');
            }
            throw new Error('Unauthorized');
          }
          return r.json();
        })
        .then(data => {
          if (data && !data.error) setUserProfile(data);
        })
        .catch(() => { });
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
        clearSpotifyAuth();
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
    // A preview may be requested long after the user authenticated. Refresh the
    // OAuth token first so private/collaborative playlists are read as the
    // signed-in user instead of falling back to the public client flow.
    const userAccessToken = await getValidAccessToken(clientId, clientSecret);
    if (userAccessToken && userAccessToken !== accessToken) {
      localStorage.setItem('spotify_access_token', userAccessToken);
      setAccessToken(userAccessToken);
    }

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

      // Extract color for dynamic background
      const imgUrl = data.coverUrl || data.thumbnail || data.playlistCover || data.artistThumbnail || data.ownerThumbnail;
      if (imgUrl) {
        getAverageColor(imgUrl).then(color => {
          setAmbientColor(color.replace('rgb', 'rgba').replace(')', ', 0.15)'));
        });
      } else {
        setAmbientColor('rgba(29, 185, 84, 0.12)'); // fallback
      }

      if (data.type !== 'track' && data.tracks) {
        setSelectedTracks(new Set(data.tracks.map(t => t.trackNumber)));
      } else {
        setSelectedTracks(new Set());
      }
      saveToHistory(target, data.title || data.name, data.coverUrl || data.thumbnail || data.playlistCover, data.artist || data.owner || '', data.artistThumbnail || data.ownerThumbnail || null);
      setFetchStatus('done');
    } catch (e) {
      setFetchError(e.message || 'Could not fetch Spotify info.');
      setFetchStatus('error');
    }
  }, [url, accessToken]);

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
                if (!d.error) {
                  const savedFilename = d.finalFilename || d.zipPath || d.collectionTitle;
                  if (savedFilename) {
                    try {
                      let h = JSON.parse(localStorage.getItem('global_history') || '[]');
                      h.unshift({
                        title: d.collectionTitle || d.finalFilename || info?.title || 'Unknown Title',
                        artist: info?.artists?.[0]?.name || info?.owner || 'Spotify',
                        thumbnail: info?.coverUrl || info?.thumbnail,
                        format: "audio:mp3",
                        filename: savedFilename,
                        source: "spotify",
                        spotifyType: d.spotifyType || info?.type || "track",
                        id: Date.now().toString(),
                        date: new Date().toISOString()
                      });
                      if (h.length > 500) h.length = 500;
                      localStorage.setItem('global_history', JSON.stringify(h));
                      window.dispatchEvent(new Event('history_updated'));
                    } catch (e) { }
                  }
                }
              }
            } catch (err) { }
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
                if (!d.error) {
                  const savedFilename = d.finalFilename || d.zipPath || d.collectionTitle;
                  if (savedFilename) {
                    try {
                      let h = JSON.parse(localStorage.getItem('global_history') || '[]');
                      h.unshift({
                        title: d.collectionTitle || d.finalFilename || info?.title || 'Unknown Title',
                        artist: info?.artists?.[0]?.name || info?.owner || 'Spotify',
                        thumbnail: info?.coverUrl || info?.thumbnail,
                        format: "audio:mp3",
                        filename: savedFilename,
                        source: "spotify",
                        spotifyType: d.spotifyType || info?.type || "track",
                        id: Date.now().toString(),
                        date: new Date().toISOString()
                      });
                      if (h.length > 500) h.length = 500;
                      localStorage.setItem('global_history', JSON.stringify(h));
                      window.dispatchEvent(new Event('history_updated'));
                    } catch (e) { }
                  }
                }
              }
            } catch (err) { }
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
      setMassFetchError("Te rugÄƒm sÄƒ introduci un link valid de Playlist Spotify.");
      return;
    }
    setIsExtracting(true);
    try {
      const clientId = localStorage.getItem('spotify_client_id') || '';
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
        saveToHistory(bulkMeta, data.playlistName || data.title, data.playlistCover || data.coverUrl, data.owner || '', data.ownerThumbnail || null);
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

    const clientId = localStorage.getItem('spotify_client_id') || '';
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
      massEsRef.current = { close: () => { reader.cancel().catch(() => { }); massEsRef.current = null; } };

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

                if (!d.error) {
                  const savedFilename = d.finalFilename || d.zipPath || d.collectionTitle;
                  if (savedFilename) {
                    try {
                      let h = JSON.parse(localStorage.getItem('global_history') || '[]');
                      h.unshift({
                        title: d.collectionTitle || d.finalFilename || massFetchInfo?.title || 'Unknown Title',
                        artist: massFetchInfo?.owner || 'Spotify',
                        thumbnail: massFetchInfo?.playlistCover || '',
                        format: "audio:mp3",
                        filename: savedFilename,
                        source: "spotify",
                        spotifyType: d.spotifyType || "playlist",
                        id: Date.now().toString(),
                        date: new Date().toISOString()
                      });
                      if (h.length > 500) h.length = 500;
                      localStorage.setItem('global_history', JSON.stringify(h));
                      window.dispatchEvent(new Event('history_updated'));
                    } catch (e) { }
                  }
                }
              }
            } catch (e) { }
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
    setMassDlState(prev => ({ ...prev, active: false, done: true, cancelled: true, error: 'DescÄƒrcarea a fost anulatÄƒ' }));
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

  const historyArtists = useMemo(() => {
    const seen = new Set();
    const artists = [];
    for (const h of history) {
      const type = getSpotifyType(h.url);
      if (type === 'playlist') continue;

      let name = h.artist;
      if (type === 'artist' && !name) name = h.title;

      if (name && !seen.has(name)) {
        seen.add(name);
        artists.push({ name, thumbnail: h.artistThumbnail || null });
      }
    }
    return artists;
  }, [history]);

  return (
    <div className="sp-page" style={{ '--ambient-color': ambientColor }}>
      {/* Background orbs */}
      <div className="sp-orb sp-orb-1" />
      <div className="sp-orb sp-orb-2" />
      <div className="sp-orb sp-orb-3" />
      <WaveformBg isActive={downloadState?.active && !downloadState?.done} color={ambientColor} />

      {/* â”€â”€ Scroll area â”€â”€ */}
      <div className="sp-scroll-area">
        <div className="sp-main">

          {/* â”€â”€ HERO â”€â”€ */}
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
                <p className="sp-subtitle">Download tracks, albums &amp; playlists as high-quality audio</p>
                <div className="sp-feature-pills">
                  <span className="sp-feature-pill sp-feature-pill--track"><Disc size={10} /> Track</span>
                  <span className="sp-feature-pill sp-feature-pill--album"><Music size={10} /> Album</span>
                  <span className="sp-feature-pill sp-feature-pill--playlist"><List size={10} /> Playlist</span>
                </div>
              </div>

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
                            clearSpotifyAuth();
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
            </div>
          </motion.div>

          {/* â”€â”€ URL INPUT CARD â”€â”€ */}
          <motion.div className="sp-input-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
            <div className="sp-input-wrapper">
              <AnimatePresence>
                {clipboardToast && (
                  <motion.div className="sp-clipboard-toast" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <Clipboard size={13} /> Spotify link detected!
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
                onFocus={() => setShowHistory(true)}
                onBlur={() => setTimeout(() => setShowHistory(false), 200)}
                onKeyDown={handleKeyDown}
                placeholder="https://open.spotify.com/track/..."
              />
              {url && (
                <button className="sp-input-clear" onClick={reset} title="Clear">
                  <X size={14} />
                </button>
              )}
              {spotifyType && (
                <div className="sp-input-type-pill">
                  <SpotifyBadge type={spotifyType} />
                </div>
              )}
              <AnimatePresence>
                {showHistory && history.length > 0 && !url && (
                  <motion.div
                    className="sp-history-dropdown"
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                  >
                    <div className="sp-history-label">Ultimele cautari</div>
                    {history.map((h, i) => (
                      <div
                        key={i}
                        className="sp-history-item"
                        onMouseDown={() => { setUrl(h.url); setShowHistory(false); setTimeout(() => fetchInfo(h.url), 100); }}
                      >
                        {h.thumbnail ? (
                          <img src={h.thumbnail} alt="" className="sp-history-item-thumb" />
                        ) : (
                          <div className="sp-history-item-icon"><Clock size={13} /></div>
                        )}
                        <span className="sp-history-item-name">{h.title}</span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
              <button className="sp-fetch-btn" onClick={() => fetchInfo()} disabled={fetchStatus === 'loading'}>
                {fetchStatus === 'loading' ? <Loader2 size={15} className="sp-spin" /> : <Search size={15} />}
                {fetchStatus === 'loading' ? 'Loading...' : 'Preview'}
              </button>
            </div>

            <div className="sp-input-row-bottom">
              <div className="sp-type-pills">
                <span className="sp-type-label">Supports:</span>
                <span className="sp-type-badge" style={{ background: 'rgba(29,185,84,0.1)', color: '#1DB954', borderColor: 'rgba(29,185,84,0.25)' }}><Disc size={10} /> Track</span>
                <span className="sp-type-badge" style={{ background: 'rgba(139,92,246,0.1)', color: '#a78bfa', borderColor: 'rgba(139,92,246,0.25)' }}><Music size={10} /> Album</span>
                <span className="sp-type-badge" style={{ background: 'rgba(251,146,60,0.1)', color: '#fb923c', borderColor: 'rgba(251,146,60,0.25)' }}><List size={10} /> Playlist</span>
              </div>
              {!showBulk && (
                <button className="sp-mass-trigger-btn" onClick={() => setShowBulk(true)}>
                  <ListVideo size={13} /> 100+ Melodii? Mass Downloader
                </button>
              )}
            </div>


          </motion.div>

          {/* â”€â”€ MASS DOWNLOADER CARD â”€â”€ */}
          <AnimatePresence>
            {showBulk && (
              <motion.div className="sp-mass-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                <div className="sp-mass-card-header">
                  <h3 className="sp-mass-card-title">
                    <ListVideo size={18} color="#93c5fd" /> Mass Downloader
                  </h3>
                  <button className="sp-mass-close-btn" onClick={() => { setShowBulk(false); setMassFetchInfo(null); setMassDlState(null); setMassFetchError(''); }}>
                    <X size={18} />
                  </button>
                </div>

                {!massFetchInfo && !massDlState ? (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <p className="sp-mass-description">
                      Introdu link-ul unui <strong>Playlist Spotify</strong>. Aplicația va scana toate piesele, depășind limitele de paginare, și le va pregăti pentru descărcare.
                    </p>
                    <input
                      type="text"
                      value={bulkMeta}
                      onChange={e => { setBulkMeta(e.target.value); setMassFetchError(''); }}
                      placeholder="https://open.spotify.com/playlist/..."
                      disabled={isExtracting}
                      className="sp-mass-input"
                    />
                    <button disabled={isExtracting} onClick={handleMassFetch} className="sp-mass-fetch-btn">
                      {isExtracting ? (
                        <><Loader2 size={18} className="sp-spin" /> Se scaneazÄƒ playlist-ul...</>
                      ) : (
                        <><Download size={18} /> Preia toate piesele</>
                      )}
                    </button>

                    <AnimatePresence>
                      {massFetchError && (
                        <motion.div className="sp-mass-error" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                          <div style={{ flex: 1 }}>
                            {massFetchError}
                            {massFetchError.includes('SPOTIFY_403') && (
                              <button onClick={() => {
                                const clientId = localStorage.getItem('spotify_client_id');
                                if (!clientId) return alert('Please set your Client ID in Settings first!');
                                const redirectUri = window.location.origin + '/';
                                const scope = encodeURIComponent('playlist-read-private playlist-read-collaborative');
                                window.location.href = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&show_dialog=true&_cb=${Date.now()}`;
                              }} className="sp-mass-fetch-btn" style={{ marginTop: 10 }}>
                                <User size={16} /> Login to Spotify
                              </button>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ) : massDlState ? (
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                    {!massDlState.done ? (
                      <div className="sp-mass-progress">
                        <div className="sp-mass-vinyl-wrap">
                          <motion.img
                            src={massDlState.coverUrl || massFetchInfo?.playlistCover || 'https://via.placeholder.com/150'}
                            animate={{ rotate: 360 }}
                            transition={{ repeat: Infinity, duration: 8, ease: 'linear' }}
                            className="sp-mass-vinyl"
                          />
                          <div className="sp-mass-vinyl-hole" />
                        </div>
                        <div className="sp-mass-current-title">{massDlState.title || 'Se pregÄƒteÈ™te...'}</div>
                        <div className="sp-mass-current-artist">{massDlState.artist || 'AÈ™teptare...'}</div>
                        {massDlState.status && <div className="sp-mass-current-status">{massDlState.status}</div>}

                        <div className="sp-mass-progress-bars">
                          <div className="sp-mass-progress-row">
                            <span>{massDlState.current} / {massDlState.total} piese</span>
                            <span>{massDlState.percent || 0}%</span>
                          </div>
                          <div className="sp-mass-progress-bar-track">
                            <motion.div className="sp-mass-progress-bar-fill" animate={{ width: `${massDlState.percent || 0}%` }} transition={{ duration: 0.3 }} />
                          </div>
                          <div className="sp-mass-track-bar-track">
                            <motion.div className="sp-mass-track-bar-fill" animate={{ width: `${massDlState.trackProgress || 0}%` }} transition={{ duration: 0.1 }} />
                          </div>
                        </div>

                        <div className="sp-mass-stats-row">
                          <div className="sp-mass-stat-item"><CheckCircle2 size={14} color="#1DB954" /><span style={{ color: '#fff' }}>{massDlState.current ? massDlState.current - 1 - (massDlState.failed || 0) : 0}</span> ok</div>
                          <div className="sp-mass-stat-item"><AlertCircle size={14} color={massDlState.failed ? '#ef4444' : '#6b7280'} /><span style={{ color: massDlState.failed ? '#ef4444' : '#fff' }}>{massDlState.failed || 0}</span> failed</div>
                          <div className="sp-mass-stat-item"><Clock size={14} color="#60a5fa" /><span style={{ color: '#fff' }}>{massDlState.estimatedSecondsRemaining ? `~${Math.ceil(massDlState.estimatedSecondsRemaining / 60)}m` : '...'}</span></div>
                        </div>

                        <button onClick={cancelMassDownload} className="sp-mass-cancel-btn">AnuleazÄƒ descÄƒrcarea</button>
                      </div>
                    ) : (
                      <motion.div className="sp-mass-done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                        <motion.div className="sp-mass-done-icon" style={{ background: massDlState.cancelled ? 'rgba(239,68,68,0.1)' : 'rgba(29,185,84,0.1)' }} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', bounce: 0.5 }}>
                          {massDlState.cancelled ? <AlertCircle size={32} color="#ef4444" /> : <CheckCircle2 size={32} color="#1DB954" />}
                        </motion.div>
                        <h3 className="sp-mass-done-title">{massDlState.cancelled ? 'DescÄƒrcare AnulatÄƒ' : 'DescÄƒrcare CompletÄƒ!'}</h3>
                        <p className="sp-mass-done-sub">{massDlState.completedCount || 0} piese descÄƒrcate Â· {massDlState.failedCount || 0} eÈ™uate</p>
                        {massDlState.error && <div className="sp-mass-done-error">Eroare: {massDlState.error}</div>}
                        <div className="sp-mass-done-actions">
                          {massDlState.zipPath && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && (
                            <button onClick={() => window.location.href = `/api/download-file?file=${encodeURIComponent(massDlState.zipPath)}`} className="sp-mass-save-btn">SalveazÄƒ ZIP</button>
                          )}
                          <button onClick={openFolder} className="sp-mass-open-btn"><FolderOpen size={15} style={{ marginRight: 4 }} /> Deschide</button>
                          <button onClick={() => { setMassDlState(null); setMassFetchInfo(null); }} className="sp-mass-new-btn">NouÄƒ</button>
                        </div>
                      </motion.div>
                    )}
                  </motion.div>
                ) : (
                  <motion.div className="sp-mass-result" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                    <div className="sp-mass-result-header">
                      {massFetchInfo.playlistCover ? (
                        <img src={massFetchInfo.playlistCover} alt="Cover" className="sp-mass-cover" />
                      ) : (
                        <div className="sp-mass-cover-placeholder"><Music size={32} color="#6b7280" /></div>
                      )}
                      <div className="sp-mass-meta">
                        <div className="sp-mass-name">{massFetchInfo.playlistName}</div>
                        <div className="sp-mass-owner">by {massFetchInfo.owner || 'Unknown'}</div>
                        <div className="sp-mass-stats">
                          <div className="sp-mass-stat"><Music size={13} /> {massFetchInfo.totalTracks} tracks</div>
                          <div className="sp-mass-stat"><Clock size={13} /> {fmtTotalDuration(massFetchInfo.tracks.reduce((a, t) => a + (t.durationMs || 0), 0))}</div>
                          <div className="sp-mass-stat"><HardDrive size={13} /> ~{estimateSize(massFetchInfo.tracks.reduce((a, t) => a + (t.durationMs || 0), 0), AUDIO_FORMATS.find(f => f.id === massFormat)?.kbps || 320)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="sp-meta-sources">
                      <div className="sp-meta-sources-label"><Database size={12} /> Metadata Sources</div>
                      <div className="sp-meta-sources-grid">
                        {(() => {
                          const counts = {
                            spotify: massFetchInfo.tracks.filter(t => t.metadataSource === 'spotify' || t.metadataSource === 'spotify-public').length,
                            itunes: massFetchInfo.tracks.filter(t => t.metadataSource === 'itunes').length,
                            yt: massFetchInfo.tracks.filter(t => t.metadataSource === 'youtube_music').length,
                          };
                          return (
                            <>
                              <motion.div className="sp-meta-source-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} style={{ borderColor: counts.spotify > 0 ? '#1DB954' : 'rgba(255,255,255,0.05)' }}>
                                <div className="sp-meta-source-name" style={{ color: counts.spotify > 0 ? '#1DB954' : '#666' }}>
                                  <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" /></svg>
                                  Spotify
                                </div>
                                <div className="sp-meta-source-count" style={{ color: counts.spotify > 0 ? '#fff' : '#666' }}>{counts.spotify}</div>
                              </motion.div>
                              <motion.div className="sp-meta-source-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} style={{ borderColor: counts.itunes > 0 ? '#fb923c' : 'rgba(255,255,255,0.05)' }}>
                                <div className="sp-meta-source-name" style={{ color: counts.itunes > 0 ? '#fb923c' : '#666' }}>
                                  <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M17.05 15.48c-.02-2.85 2.33-4.22 2.44-4.29-1.32-1.93-3.38-2.19-4.1-2.23-1.75-.18-3.41 1.03-4.3 1.03-.89 0-2.27-1.01-3.73-.98-1.9.03-3.66 1.1-4.63 2.8-1.97 3.41-.5 8.45 1.41 11.22.94 1.35 2.05 2.88 3.51 2.83 1.42-.05 1.95-.92 3.66-.92 1.7 0 2.19.92 3.68.89 1.51-.03 2.48-1.4 3.41-2.76 1.07-1.56 1.51-3.08 1.53-3.16-.03-.01-2.85-1.1-2.88-4.43z" /></svg>
                                  iTunes
                                </div>
                                <div className="sp-meta-source-count" style={{ color: counts.itunes > 0 ? '#fff' : '#666' }}>{counts.itunes}</div>
                              </motion.div>
                              <motion.div className="sp-meta-source-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} style={{ borderColor: counts.yt > 0 ? '#f43f5e' : 'rgba(255,255,255,0.05)' }}>
                                <div className="sp-meta-source-name" style={{ color: counts.yt > 0 ? '#f43f5e' : '#666' }}>
                                  <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M21.582 6.186a2.684 2.684 0 00-1.884-1.898C17.983 3.8 12 3.8 12 3.8s-5.983 0-7.698.488A2.684 2.684 0 002.418 6.186C1.94 7.915 1.94 12 1.94 12s0 4.085.478 5.814a2.684 2.684 0 001.884 1.898C5.983 20.2 12 20.2 12 20.2s5.983 0 7.698-.488a2.684 2.684 0 001.884-1.898C22.06 16.085 22.06 12 22.06 12s0-4.085-.478-5.814zM9.913 14.894V9.106l5.244 2.894-5.244 2.894z" /></svg>
                                  YT Music
                                </div>
                                <div className="sp-meta-source-count" style={{ color: counts.yt > 0 ? '#fff' : '#666' }}>{counts.yt}</div>
                              </motion.div>
                            </>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="sp-mass-actions">
                      <select value={massFormat} onChange={e => setMassFormat(e.target.value)} className="sp-mass-format-select">
                        {AUDIO_FORMATS.map(f => <option key={f.id} value={f.id}>{f.label} - {f.sub}</option>)}
                      </select>
                      <button onClick={startMassDownload} className="sp-mass-start-btn">Începe descărcarea</button>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* â”€â”€ Error â”€â”€ */}
          <AnimatePresence>
            {fetchStatus === 'error' && (
              <motion.div className="sp-error-card" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                <AlertCircle size={17} style={{ flexShrink: 0 }} />
                <span>{fetchError}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* â”€â”€ Info Card â”€â”€ */}
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
                      {info.totalTracks > 1 && info.type !== 'track' && (
                        <span className="sp-info-pill">
                          <Hash size={11} />
                          {info.trackCount < info.totalTracks
                            ? `${info.trackCount} / ${info.totalTracks} tracks`
                            : `${info.trackCount} tracks`}
                        </span>
                      )}
                      {info.type === 'track' && info.totalTracks > 1 && (
                        <span className="sp-info-pill">
                          <Hash size={11} /> Track {info.trackNumber} / {info.totalTracks}
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
                      <p className="sp-info-desc">{info.description.replace(/<[^>]*>/g, '').slice(0, 120)}{info.description.length > 120 ? 'â€¦' : ''}</p>
                    )}
                  </div>
                </div>

                {/* Tracklist */}
                {info.tracks?.length > 1 && (
                  info.type === 'playlist' ? (
                    <div className="sp-playlist-panel">
                      <div className="sp-playlist-panel-top">
                        <div className="sp-playlist-panel-icon"><ListVideo size={20} /></div>
                        <div>
                          <span className="sp-eyebrow">PLAYLIST GÄ‚SIT</span>
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
                          <div className="sp-playlist-utility" onClick={() => setShowAllTracks(true)}>
                            <Music size={12} /> Afișează încă {info.totalTracks - 5} melodii
                          </div>
                        )}
                        {showAllTracks && info.totalTracks > info.tracks.length && (
                          <div className="sp-playlist-utility" style={{ color: '#9ca3af', cursor: 'default' }}>
                            (Spotify ascunde restul pieselor. Loghează-te pentru toate.)
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
                            <Music size={12} /> È™i Ã®ncÄƒ {info.trackCount - 5} melodii...
                          </div>
                        )}
                        {info.type !== 'playlist' && info.trackCount < info.totalTracks && (
                          <div className="sp-tracklist-utility" style={{ color: '#fb923c' }}>
                            <AlertCircle size={12} /> + {info.totalTracks - info.trackCount} indisponibile
                          </div>
                        )}
                      </div>
                    </div>
                  )
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* â”€â”€ Download Action â”€â”€ */}
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

          {/* â”€â”€ Download Modal â”€â”€ */}
          <AnimatePresence>
            {showDownloadModal && info && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="sp-modal-overlay">
                <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="sp-modal">
                  <h3 className="sp-modal-title">SetÄƒri descÄƒrcare {info.trackCount > 1 && 'Playlist'}</h3>
                  <div className="sp-modal-settings">
                    <div className="sp-setting-group">
                      <span className="sp-setting-label">Formatul dorit</span>
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
                          <label className="sp-modal-label">
                            {info.type === 'playlist' ? 'MELODIILE DIN PLAYLIST' : `SELECTEAZÄ‚ (${selectedTracks.size} ALESE)`}
                          </label>
                          {info.type !== 'playlist' && (
                            <div className="sp-track-utils">
                              <button className="sp-track-util-btn" onClick={selectAllTracks}>Toate</button>
                              <button className="sp-track-util-btn" onClick={deselectAllTracks}>Niciuna</button>
                            </div>
                          )}
                        </div>
                        <div className="sp-track-list">
                          {info.tracks?.slice(0, info.type === 'playlist' ? 5 : undefined).map(track => {
                            const isSelected = info.type === 'playlist' || selectedTracks.has(track.trackNumber);
                            return (
                              <div key={track.trackNumber} className={`sp-track-item ${isSelected ? 'selected' : ''}`}
                                onClick={() => info.type !== 'playlist' && toggleTrack(track.trackNumber)}
                                style={{ cursor: info.type === 'playlist' ? 'default' : 'pointer' }}>
                                {info.type !== 'playlist' && <div className="sp-track-checkbox" />}
                                <span className="sp-track-index">{track.trackNumber}.</span>
                                <span className="sp-track-name">{track.title} {track.artist && track.artist !== info.artist ? `- ${track.artist}` : ''}</span>
                                <span className="sp-track-duration">{fmtDuration(track.durationMs)}</span>
                              </div>
                            );
                          })}
                          {info.type === 'playlist' && info.totalTracks > 5 && (
                            <p style={{ textAlign: 'center', padding: '0.75rem', fontSize: '0.82rem', color: 'rgba(255,255,255,0.4)' }}>
                              ... È™i Ã®ncÄƒ {info.totalTracks - 5} melodii
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {sizeEstimate && (
                      <div className="sp-format-summary">
                        <Archive size={13} />
                        <span>Estimated size: <strong>{sizeEstimate}</strong></span>
                      </div>
                    )}
                  </div>

                  <div className="sp-modal-actions">
                    <button className="sp-modal-cancel" onClick={() => setShowDownloadModal(false)}>AnuleazÄƒ</button>
                    <button className="sp-modal-confirm" onClick={handleDownload} disabled={info.trackCount > 1 && selectedTracks.size === 0}>
                      ÃŽncepe descÄƒrcarea
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* â”€â”€ Download Progress â”€â”€ */}
          <AnimatePresence>
            {downloadState && (
              <motion.div className="sp-progress-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>

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
                      <motion.div className="sp-progress-bar-fill" animate={{ width: `${downloadState.progress || 0}%` }} transition={{ duration: 0.4 }} />
                    </div>
                    {downloadState.totalTracks > 1 && (
                      <div className="sp-progress-sub">
                        <div className="sp-progress-bar-track sp-progress-bar-track--thin">
                          <motion.div className="sp-progress-bar-fill sp-progress-bar-fill--track" animate={{ width: `${downloadState.trackProgress || 0}%` }} transition={{ duration: 0.3 }} />
                        </div>
                      </div>
                    )}
                    <button className="sp-cancel-btn" onClick={handleCancel}><X size={14} /> Cancel</button>
                  </>
                )}

                {isDownloading && info?.tracks?.length > 1 && (
                  <div className="sp-dl-tracklist">
                    {info.tracks.filter(t => selectedTracks.size === 0 || selectedTracks.has(t.trackNumber)).slice(0, 20).map(track => (
                      <TrackRow
                        key={track.trackNumber}
                        track={track}
                        overrideUrl={trackOverrides[track.trackNumber - 1]}
                        onOverrideChange={val => setTrackOverrides(prev => ({ ...prev, [track.trackNumber - 1]: val }))}
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

                {hasError && (
                  <div className="sp-result sp-result--error">
                    <AlertCircle size={20} />
                    <div>
                      <strong>Download Failed</strong>
                      <p>{downloadState.error}</p>
                      <div className="sp-result-actions">
                        <button className="sp-retry-btn" onClick={() => { setDownloadState(null); setTrackStatuses({}); }}>Try Again</button>
                        <button className="sp-secondary-btn" onClick={reset}>New URL</button>
                      </div>
                    </div>
                  </div>
                )}

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
                          {downloadState.failedTracks > 0 && ` Â· ${downloadState.failedTracks} failed`}
                        </p>
                      )}
                      <div className="sp-result-actions">
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

        {/* â”€â”€ Recent Downloads Section â”€â”€ */}
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
                    <span className={`sp-feature-pill sp-feature-pill--${item.type}`}>{item.type}</span>
                  </div>
                  <button
                    className="sp-recent-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFromHistory(item.url);
                    }}
                    title="Remove from history"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Spacer ── */}
        <div style={{ height: '2rem' }} />

        {/* ── FOOTER ── */}
        <footer className="sp-footer">
          <div className="sp-footer-inner">
            <div className="sp-footer-brand">
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" style={{ color: '#1DB954' }}>
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
              <div className="sp-footer-brand-dot" />
              <span>Spotify Downloader</span>
            </div>
            <div className="sp-footer-links">
              <span className="sp-footer-badge">
                <HardDrive size={10} /> yt-dlp
              </span>
              <span className="sp-footer-badge">
                <Music size={10} /> Spotify API
              </span>
              <span className="sp-footer-link">
                <CheckCircle2 size={11} /> High Quality Audio
              </span>
            </div>
          </div>
          <div className="sp-footer-copy">Download for personal use only &middot; Respect artists and their work</div>
        </footer>
      </div>

      {/* â”€â”€ My Playlists Modal â”€â”€ */}
      <AnimatePresence>
        {showPlaylists && (
          <motion.div
            className="sp-playlists-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={e => e.target === e.currentTarget && setShowPlaylists(false)}
          >
            <motion.div
              className="sp-playlists-content"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <div className="sp-playlists-header">
                <h2>My Playlists</h2>
                <button className="sp-login-btn" onClick={() => setShowPlaylists(false)}><X size={16} /> Close</button>
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
                  <span>Failed to load playlists. Please log in again.</span>
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
                        <div className="sp-playlist-owner">{p.owner?.display_name} Â· {p.tracks?.total ?? '?'} tracks</div>
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
