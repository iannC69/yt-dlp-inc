import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Layers, Music, Download, Loader2, AlertCircle, CheckCircle2,
  Link2, List, Search, X, FolderOpen, Clock, HardDrive, Database,
  Play, Pause, SquareStop, RefreshCw, Terminal, ChevronDown, ChevronUp,
  Archive, Disc, Zap, FileText
} from 'lucide-react';
import './MassDownloader.css';

// ── Constants ────────────────────────────────────────────────
const AUDIO_FORMATS = [
  { id: 'mp3', label: 'MP3 320kbps', sub: 'Best quality' },
  { id: 'mp3_192', label: 'MP3 192kbps', sub: 'Balanced', ytdlFmt: 'mp3' },
  { id: 'm4a', label: 'M4A / AAC', sub: 'Apple format' },
  { id: 'wav', label: 'WAV', sub: 'Lossless raw' },
  { id: 'flac', label: 'FLAC', sub: 'Lossless compressed' },
  { id: 'ogg', label: 'OGG Vorbis', sub: 'Open format' },
];

const NAMING_TOKENS = ['{track_number}', '{artist}', '{title}', '{year}', '{album}'];

const spring = { type: 'spring', stiffness: 400, damping: 25 };
const springBounce = { type: 'spring', stiffness: 350, damping: 20 };

function fmtDur(ms) {
  if (!ms) return '';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
function fmtSecs(s) {
  if (!s) return '--:--';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `~${m}m ${sec}s`;
  return `~${sec}s`;
}
function fmtSize(totalMs, fmt) {
  const kbpsMap = { mp3: 320, mp3_192: 192, m4a: 256, wav: 1411, flac: 900, ogg: 192 };
  const kbps = kbpsMap[fmt] || 320;
  const bytes = (kbps * 1000 / 8) * (totalMs / 1000);
  const mb = bytes / 1024 / 1024;
  return mb < 1 ? `~${Math.round(mb * 1024)} KB` : `~${mb.toFixed(1)} MB`;
}
function applyNaming(tpl, item, idx) {
  return tpl
    .replace('{track_number}', String(idx + 1).padStart(4, '0'))
    .replace('{artist}', item.artist || item.channel || 'Unknown')
    .replace('{title}', item.title || 'Unknown')
    .replace('{year}', item.year || '')
    .replace('{album}', item.album || '');
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
        headers: { 'Content-Type': 'application/json', 'x-spotify-client-id': clientId, 'x-spotify-client-secret': clientSecret },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const data = await res.json();
      if (data.access_token) {
        localStorage.setItem('spotify_access_token', data.access_token);
        localStorage.setItem('spotify_expires_at', Date.now() + data.expires_in * 1000);
        if (data.refresh_token) localStorage.setItem('spotify_refresh_token', data.refresh_token);
        return data.access_token;
      }
    } catch {}
  }
  if (expiresAt && Date.now() >= expiresAt - 60000) {
    localStorage.removeItem('spotify_access_token');
    localStorage.removeItem('spotify_refresh_token');
    localStorage.removeItem('spotify_expires_at');
    return '';
  }
  return accessToken;
}

// ── Component ─────────────────────────────────────────────────
export default function MassDownloader() {
  // Source tab
  const [sourceTab, setSourceTab] = useState('spotify'); // spotify | youtube | urllist

  // Spotify source
  const [spotUrl, setSpotUrl] = useState('');
  const [spotFetching, setSpotFetching] = useState(false);
  const [spotError, setSpotError] = useState('');
  const [spotResult, setSpotResult] = useState(null); // { title, owner, totalTracks, tracks, playlistCover, playlistId }

  // YouTube source
  const [ytUrl, setYtUrl] = useState('');
  const [ytFetching, setYtFetching] = useState(false);
  const [ytError, setYtError] = useState('');
  const [ytResult, setYtResult] = useState(null); // { title, totalItems, items }

  // URL List source
  const [urlListText, setUrlListText] = useState('');
  const [urlListResolving, setUrlListResolving] = useState(false);
  const [urlListItems, setUrlListItems] = useState([]);
  const [urlListError, setUrlListError] = useState('');

  // Track list
  const [selectedItems, setSelectedItems] = useState(new Set()); // indices
  const [filter, setFilter] = useState('');
  const [sortOrder, setSortOrder] = useState('default'); // default | az | za
  const [previewingIdx, setPreviewingIdx] = useState(null);
  const audioRef = useRef(null);

  // Export settings
  const [format, setFormat] = useState('mp3');
  const [concurrency, setConcurrency] = useState(3);
  const [speedMode, setSpeedMode] = useState('BALANCED');
  const [outputMode, setOutputMode] = useState('zip'); // zip | folder
  const [namingTpl, setNamingTpl] = useState('{track_number} - {artist} - {title}');
  const [splitEvery, setSplitEvery] = useState(100);
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [folderName, setFolderName] = useState('');

  // Download state
  const [dlState, setDlState] = useState(null); // null | { active, done, error, cancelled, current, total, percent, title, artist, coverUrl, completedCount, failedCount, status, zipPath, zipParts, estimatedSecondsRemaining }
  const [paused, setPaused] = useState(false);
  const [trackStatuses, setTrackStatuses] = useState({}); // idx → 'pending'|'downloading'|'done'|'failed'
  const [logLines, setLogLines] = useState([]);
  const [showLog, setShowLog] = useState(false);
  const [failedItems, setFailedItems] = useState([]);

  const dlReaderRef = useRef(null);
  const logEndRef = useRef(null);
  const startTimeRef = useRef(null);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const elapsedRef = useRef(null);

  // ── Computed track list ─────────────────────────────────────
  const allItems = useMemo(() => {
    if (sourceTab === 'spotify' && spotResult?.tracks) return spotResult.tracks;
    if (sourceTab === 'youtube' && ytResult?.items) return ytResult.items;
    if (sourceTab === 'urllist') return urlListItems.filter(i => !i.error);
    return [];
  }, [sourceTab, spotResult, ytResult, urlListItems]);

  const filteredItems = useMemo(() => {
    let items = allItems;
    if (filter.trim()) {
      const q = filter.toLowerCase();
      items = items.filter(t => (t.title || '').toLowerCase().includes(q) || (t.artist || t.channel || '').toLowerCase().includes(q));
    }
    if (sortOrder === 'az') items = [...items].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    if (sortOrder === 'za') items = [...items].sort((a, b) => (b.title || '').localeCompare(a.title || ''));
    return items;
  }, [allItems, filter, sortOrder]);

  // Duplicate detection
  const duplicateSet = useMemo(() => {
    const seen = new Map();
    const dupIndices = new Set();
    allItems.forEach((item, i) => {
      const key = `${(item.title || '').toLowerCase().trim()}::${(item.artist || item.channel || '').toLowerCase().trim()}`;
      if (seen.has(key)) {
        dupIndices.add(seen.get(key));
        dupIndices.add(i);
      } else {
        seen.set(key, i);
      }
    });
    return dupIndices;
  }, [allItems]);

  const dupCount = duplicateSet.size;

  // Auto-select all when items load
  useEffect(() => {
    setSelectedItems(new Set(allItems.map((_, i) => i)));
    setFilter('');
    setSortOrder('default');
  }, [allItems.length, sourceTab]);

  // Elapsed timer
  useEffect(() => {
    if (dlState?.active && !dlState?.done) {
      if (!startTimeRef.current) startTimeRef.current = Date.now();
      elapsedRef.current = setInterval(() => {
        setElapsedSecs(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else {
      clearInterval(elapsedRef.current);
      if (!dlState?.active) { startTimeRef.current = null; setElapsedSecs(0); }
    }
    return () => clearInterval(elapsedRef.current);
  }, [dlState?.active, dlState?.done]);

  // Auto-scroll log
  useEffect(() => {
    if (showLog && logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [logLines, showLog]);

  // Auto-enable split if items > 500
  useEffect(() => {
    if (allItems.length > 500) setSplitEnabled(true);
  }, [allItems.length]);

  // Handle global shortcuts and paste
  useEffect(() => {
    if (appMode !== 'mass') return;
    const handlePaste = (e) => {
      const url = e.detail;
      if (url.includes('spotify.com')) {
        setSpotUrl(url);
        // We could auto-fetch, but let's just populate the input
      } else {
        setYtUrl(url);
      }
    };
    const handleDownloadShortcut = () => {
      if (allItems.length > 0 && !dlState?.active) startDownload();
    };
    window.addEventListener('app:paste-url', handlePaste);
    window.addEventListener('app:global-download', handleDownloadShortcut);
    return () => {
      window.removeEventListener('app:paste-url', handlePaste);
      window.removeEventListener('app:global-download', handleDownloadShortcut);
    };
  }, [allItems, dlState?.active, appMode]);

  // ── Naming preview ───────────────────────────────────────────
  const namingPreview = useMemo(() => {
    const sample = allItems[0] || { title: 'Song Title', artist: 'Artist', channel: 'Channel', year: '2024', album: 'Album' };
    return applyNaming(namingTpl, sample, 0) + '.' + format.replace('_192', '').replace('_320', '');
  }, [namingTpl, allItems, format]);

  // ── Source Fetch Functions ───────────────────────────────────
  const fetchSpotify = useCallback(async () => {
    if (!spotUrl.trim()) return;
    setSpotError('');
    setSpotResult(null);
    setSpotFetching(true);
    try {
      const clientId = localStorage.getItem('spotify_client_id') || '';
      const clientSecret = localStorage.getItem('spotify_client_secret') || '';
      const token = clientId && clientSecret ? await getValidAccessToken(clientId, clientSecret) : ''; 
      const res = await fetch(`/api/spotify-mass-fetch?url=${encodeURIComponent(spotUrl)}`, {
        headers: { 'x-spotify-client-id': clientId, 'x-spotify-client-secret': clientSecret, 'x-spotify-access-token': token }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fetch failed');
      setSpotResult(data);
      setFolderName(data.playlistName || 'Spotify Playlist');
    } catch (e) {
      setSpotError(e.message);
    }
    setSpotFetching(false);
  }, [spotUrl]);

  const fetchYoutube = useCallback(async () => {
    if (!ytUrl.trim()) return;
    setYtError('');
    setYtResult(null);
    setYtFetching(true);
    try {
      const res = await fetch(`/api/mass/ytdl-playlist-info?url=${encodeURIComponent(ytUrl)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fetch failed');
      if (!data.items || data.items.length === 0) throw new Error('No items found in playlist.');
      setYtResult(data);
      setFolderName(data.title || 'YouTube Playlist');
    } catch (e) {
      setYtError(e.message);
    }
    setYtFetching(false);
  }, [ytUrl]);

  const resolveUrlList = useCallback(async () => {
    const lines = urlListText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    setUrlListError('');
    setUrlListItems([]);
    setUrlListResolving(true);
    try {
      const res = await fetch('/api/mass/url-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: lines })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Resolve failed');
      setUrlListItems(data.items || []);
      setFolderName('URL List');
    } catch (e) {
      setUrlListError(e.message);
    }
    setUrlListResolving(false);
  }, [urlListText]);

  // ── Selection helpers ────────────────────────────────────────
  const selectAll    = () => setSelectedItems(new Set(allItems.map((_, i) => i)));
  const deselectAll  = () => setSelectedItems(new Set());
  const removeDups   = () => setSelectedItems(prev => { const n = new Set(prev); duplicateSet.forEach(i => n.delete(i)); return n; });
  const toggleItem   = (i) => setSelectedItems(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  // ── Audio Preview ────────────────────────────────────────────
  const togglePreview = (idx, previewUrl) => {
    if (!previewUrl) return;
    if (previewingIdx === idx) {
      audioRef.current?.pause();
      setPreviewingIdx(null);
    } else {
      if (audioRef.current) { audioRef.current.pause(); }
      audioRef.current = new Audio(previewUrl);
      audioRef.current.play().catch(() => {});
      audioRef.current.onended = () => setPreviewingIdx(null);
      setPreviewingIdx(idx);
    }
  };

  // ── Download ─────────────────────────────────────────────────
  const startDownload = async () => {
    const items = allItems.filter((_, i) => selectedItems.has(i));
    if (items.length === 0) return;

    const dlId = Date.now().toString();
    setDlState({ active: true, done: false, error: null, cancelled: false, current: 0, total: items.length, percent: 0, completedCount: 0, failedCount: 0, jobId: dlId });
    setTrackStatuses({});
    setLogLines([]);
    setFailedItems([]);
    setPaused(false);

    const clientId = localStorage.getItem('spotify_client_id') || '';
    const clientSecret = localStorage.getItem('spotify_client_secret') || '';
    const token = clientId && clientSecret ? await getValidAccessToken(clientId, clientSecret) : ''; 

    const fmtKey = format.replace('_192', '');

    // For Spotify: use spotify-mass-download. For YT / URL list: use mass/start-ytdl
    let endpoint, bodyPayload, params;
    if (sourceTab === 'spotify' && spotResult) {
      params = new URLSearchParams({ 
        format: `audio:${fmtKey}:0`, 
        downloadId: dlId,
        concurrency: String(concurrency),
        speedMode,
        customPath: localStorage.getItem('customPath') || '',
        audioFormat: localStorage.getItem('audioFormat') || 'mp3',
        audioQuality: localStorage.getItem('audioQuality') || '320k'
      });
      endpoint = `/api/spotify-mass-download?${params}`;
      bodyPayload = {
        tracks: items,
        playlistName: folderName || spotResult.playlistName,
        playlistCover: spotResult.playlistCover,
        owner: spotResult.owner
      };
    } else {
      params = new URLSearchParams({
        format: fmtKey,
        downloadId: dlId,
        concurrency: String(concurrency),
        speedMode,
        outputZip: outputMode === 'zip' ? 'true' : 'false',
        naming: namingTpl,
        splitEvery: splitEnabled ? String(splitEvery) : '0',
        customPath: localStorage.getItem('customPath') || '',
        audioFormat: localStorage.getItem('audioFormat') || 'mp3',
        audioQuality: localStorage.getItem('audioQuality') || '320k',
        embedLyrics: localStorage.getItem('spotdl_lyrics') === 'true' ? 'true' : 'false'
      });
      endpoint = `/api/mass/start-ytdl?${params}`;
      bodyPayload = {
        items,
        playlistName: folderName || 'mass-download'
      };
    }

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (clientId) { headers['x-spotify-client-id'] = clientId; headers['x-spotify-client-secret'] = clientSecret; headers['x-spotify-access-token'] = token; }

      const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(bodyPayload) });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      dlReaderRef.current = reader;
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';
        for (const chunk of chunks) {
          if (!chunk.startsWith('data: ')) continue;
          try {
            const d = JSON.parse(chunk.slice(6));
            if (d.logLine) {
              setLogLines(prev => [...prev.slice(-299), d.logLine]);
              continue;
            }
            setDlState(prev => {
              const next = { ...prev, ...d };
              if (d.done) next.active = false;
              return next;
            });
            if (d.current !== undefined) {
              setTrackStatuses(prev => {
                const n = { ...prev };
                const idx = d.current - 1;
                if (idx >= 0) n[idx] = 'downloading';
                if (idx > 0) n[idx - 1] = 'done';
                return n;
              });
            }
            if (d.done && d.failedCount > 0) {
              setFailedItems(items.filter((_, i) => trackStatuses[i] === 'failed'));
            }
          } catch {}
        }
      }
    } catch (err) {
      setDlState(prev => ({ ...prev, active: false, done: true, error: err.message }));
    }
  };

  const cancelDownload = async () => {
    const downloadId = dlState?.jobId;
    if (downloadId) {
      try { await fetch(`/api/mass/cancel?downloadId=${encodeURIComponent(downloadId)}`); } catch {}
    }
    if (dlReaderRef.current) { try { dlReaderRef.current.cancel(); } catch {} }
    setDlState(prev => ({ ...prev, active: false, done: true, cancelled: true }));
  };

  const retryFailed = () => {
    // Re-select only failed items and restart
    const failedIdxSet = new Set(
      allItems.map((item, i) => (trackStatuses[i] === 'failed' ? i : null)).filter(i => i !== null)
    );
    if (failedIdxSet.size === 0) return;
    setSelectedItems(failedIdxSet);
    setDlState(null);
    setTimeout(() => startDownload(), 50);
  };

  const resetAll = () => {
    setDlState(null);
    setTrackStatuses({});
    setLogLines([]);
    setFailedItems([]);
    setPaused(false);
    setSpotResult(null);
    setYtResult(null);
    setUrlListItems([]);
    setSpotUrl('');
    setYtUrl('');
    setUrlListText('');
    setFilter('');
  };

  const openFolder = () => {
    const cp = localStorage.getItem('customPath') || '';
    fetch(`/api/ytdl/open-folder?customPath=${encodeURIComponent(cp)}`);
  };

  // ── Computed derived values ───────────────────────────────────
  const isDownloading = dlState?.active && !dlState?.done;
  const isDone        = dlState?.done;
  const totalDurationMs = allItems.filter((_, i) => selectedItems.has(i)).reduce((a, t) => a + (t.durationMs || 0), 0);
  const selectedCount   = selectedItems.size;
  const tracksPerMin  = dlState?.current > 0 && elapsedSecs > 0 ? ((dlState.current / elapsedSecs) * 60).toFixed(1) : null;

  const metaCounts = useMemo(() => {
    const src = allItems.filter((_, i) => selectedItems.has(i));
    return {
      spotify: src.filter(t => t.metadataSource === 'spotify' || t.metadataSource === 'spotify-public').length,
      itunes: src.filter(t => t.metadataSource === 'itunes').length,
      youtube: src.filter(t => t.metadataSource === 'youtube_music').length,
    };
  }, [allItems, selectedItems]);

  // ── Concurrency slider CSS var ───────────────────────────────
  const concurrencyPct = ((concurrency - 1) / 23) * 100;

  // ══════════════════════════════════════════════════════════════
  // ── RENDER ────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════
  return (
    <div className="md-page">
      <div className="md-orb md-orb-1" />
      <div className="md-orb md-orb-2" />
      <div className="md-orb md-orb-3" />

      <div className="md-scroll">
        {/* Hero */}
        <motion.div className="md-hero" initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
          <div className="md-hero-icon"><Layers size={24} color="white" /></div>
          <div className="md-hero-text">
            <h1>Mass Downloader</h1>
            <p>Spotify playlists · YouTube playlists · Mixed URL lists — all in one purple-powered engine</p>
          </div>
        </motion.div>

        {/* ─── SOURCE CARD ─── */}
        <AnimatePresence mode="wait">
          {!isDownloading && !isDone && (
            <motion.div className="md-card" key="source" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={spring}>
              <div className="md-card-header">
                <span className="md-card-title-icon"><Download size={15} /></span>
                <span className="md-card-title">Source</span>
              </div>
              <div className="md-card-body">
                {/* Tabs */}
                <div className="md-source-tabs">
                  {[
                    { id: 'spotify', label: 'Spotify', icon: <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg> },
                    { id: 'youtube', label: 'YouTube', icon: <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M21.582 6.186a2.684 2.684 0 00-1.884-1.898C17.983 3.8 12 3.8 12 3.8s-5.983 0-7.698.488A2.684 2.684 0 002.418 6.186C1.94 7.915 1.94 12 1.94 12s0 4.085.478 5.814a2.684 2.684 0 001.884 1.898C5.983 20.2 12 20.2 12 20.2s5.983 0 7.698-.488a2.684 2.684 0 001.884-1.898C22.06 16.085 22.06 12 22.06 12s0-4.085-.478-5.814zM9.913 14.894V9.106l5.244 2.894-5.244 2.894z"/></svg> },
                    { id: 'urllist', label: 'URL List', icon: <FileText size={13} /> },
                  ].map(tab => (
                    <motion.button key={tab.id} className={`md-source-tab ${sourceTab === tab.id ? 'md-source-tab--active' : ''}`} onClick={() => setSourceTab(tab.id)} whileTap={{ scale: 0.96 }}>
                      {tab.icon} {tab.label}
                    </motion.button>
                  ))}
                </div>

                {/* Spotify input */}
                <AnimatePresence mode="wait">
                  {sourceTab === 'spotify' && (
                    <motion.div key="sp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                      <div className="md-input-row">
                        <div className="md-input-wrap">
                          <div className="md-input-icon"><Link2 size={15} /></div>
                          <input className="md-input" value={spotUrl} onChange={e => { setSpotUrl(e.target.value); setSpotError(''); setSpotResult(null); }} onKeyDown={e => e.key === 'Enter' && fetchSpotify()} placeholder="https://open.spotify.com/playlist/..." />
                          {spotUrl && <button className="md-input-clear" onClick={() => { setSpotUrl(''); setSpotResult(null); setSpotError(''); }}><X size={14} /></button>}
                        </div>
                        <button className="md-fetch-btn" onClick={fetchSpotify} disabled={spotFetching || !spotUrl.trim()}>
                          {spotFetching ? <><Loader2 size={15} className="md-spin" /> Scanning…</> : <><Search size={15} /> Scan Playlist</>}
                        </button>
                      </div>
                      {spotError && (
                        <motion.div className="md-error" style={{ marginTop: 10 }} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
                          <AlertCircle size={15} /><span>{spotError}</span>
                        </motion.div>
                      )}
                    </motion.div>
                  )}

                  {/* YouTube input */}
                  {sourceTab === 'youtube' && (
                    <motion.div key="yt" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                      <div className="md-input-row">
                        <div className="md-input-wrap">
                          <div className="md-input-icon"><Link2 size={15} /></div>
                          <input className="md-input" value={ytUrl} onChange={e => { setYtUrl(e.target.value); setYtError(''); setYtResult(null); }} onKeyDown={e => e.key === 'Enter' && fetchYoutube()} placeholder="https://youtube.com/playlist?list=..." />
                          {ytUrl && <button className="md-input-clear" onClick={() => { setYtUrl(''); setYtResult(null); setYtError(''); }}><X size={14} /></button>}
                        </div>
                        <button className="md-fetch-btn" onClick={fetchYoutube} disabled={ytFetching || !ytUrl.trim()}>
                          {ytFetching ? <><Loader2 size={15} className="md-spin" /> Loading…</> : <><Search size={15} /> Load Playlist</>}
                        </button>
                      </div>
                      {ytError && (
                        <motion.div className="md-error" style={{ marginTop: 10 }} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
                          <AlertCircle size={15} /><span>{ytError}</span>
                        </motion.div>
                      )}
                    </motion.div>
                  )}

                  {/* URL List input */}
                  {sourceTab === 'urllist' && (
                    <motion.div key="ul" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                      <textarea className="md-textarea" value={urlListText} onChange={e => setUrlListText(e.target.value)} placeholder={"https://www.youtube.com/watch?v=...\nhttps://open.spotify.com/track/...\n(one URL per line, max 100)"} />
                      <p className="md-resolve-hint">Paste YouTube or Spotify track URLs, one per line. We'll resolve title, duration & thumbnail for each.</p>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button className="md-fetch-btn" style={{ flex: 1 }} onClick={resolveUrlList} disabled={urlListResolving || !urlListText.trim()}>
                          {urlListResolving ? <><Loader2 size={15} className="md-spin" /> Resolving…</> : <><Search size={15} /> Resolve URLs</>}
                        </button>
                        {urlListItems.length > 0 && <button className="md-tl-btn md-tl-btn--danger" onClick={() => setUrlListItems([])}><X size={13} /> Clear</button>}
                      </div>
                      {urlListError && (
                        <motion.div className="md-error" style={{ marginTop: 10 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                          <AlertCircle size={15} /><span>{urlListError}</span>
                        </motion.div>
                      )}
                      {/* Resolved items */}
                      <AnimatePresence>
                        {urlListItems.length > 0 && (
                          <motion.div className="md-url-items" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                            {urlListItems.map((item, i) => (
                              <motion.div key={i} className={`md-url-item ${item.error ? 'md-url-item--error' : ''}`} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring, delay: i * 0.03 }}>
                                {item.thumbnail ? <img src={item.thumbnail} alt="" className="md-url-item-thumb" /> : <div className="md-url-item-thumb" />}
                                <div className="md-url-item-info">
                                  <div className="md-url-item-title">{item.error ? `Error: ${item.url}` : item.title}</div>
                                  <div className="md-url-item-sub">{item.channel} {item.duration ? `· ${fmtDur(item.durationMs)}` : ''} {item._cached ? '· cached' : ''}</div>
                                </div>
                                <button className="md-url-item-del" onClick={() => setUrlListItems(prev => prev.filter((_, j) => j !== i))}><X size={14} /></button>
                              </motion.div>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── TRACK LIST ─── */}
        <AnimatePresence>
          {allItems.length > 0 && !isDownloading && !isDone && (
            <motion.div className="md-card" key="tracklist" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring}>
              <div className="md-card-header">
                <span className="md-card-title-icon"><Music size={15} /></span>
                <span className="md-card-title">Track List</span>
                <span className="md-tracklist-count">{selectedCount} / {allItems.length} selected</span>
                {dupCount > 0 && (
                  <motion.span className="md-meta-badge md-meta-badge--dup" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={springBounce}>
                    ⚠ {dupCount} dups
                  </motion.span>
                )}
              </div>
              <div className="md-card-body">
                {/* Playlist result header */}
                <AnimatePresence>
                  {(spotResult || ytResult) && (
                    <motion.div className="md-result-header" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      {(spotResult?.playlistCover || ytResult?.items?.[0]?.thumbnail) ?
                        <img src={spotResult?.playlistCover || ytResult?.items?.[0]?.thumbnail} alt="" className="md-result-cover" />
                        : <div className="md-result-cover-ph"><Music size={24} color="rgba(168,85,247,0.5)" /></div>}
                      <div>
                        <div className="md-result-name">{spotResult?.playlistName || ytResult?.title}</div>
                        {spotResult?.owner && <div className="md-result-owner">by {spotResult.owner}</div>}
                        <div className="md-result-stats">
                          <span className="md-result-stat"><Music size={11} /> {allItems.length} tracks</span>
                          {totalDurationMs > 0 && <span className="md-result-stat"><Clock size={11} /> {fmtDur(totalDurationMs)}</span>}
                          <span className="md-result-stat"><HardDrive size={11} /> {fmtSize(totalDurationMs, format)}</span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Metadata sources */}
                {sourceTab === 'spotify' && spotResult && (metaCounts.spotify + metaCounts.itunes + metaCounts.youtube) > 0 && (
                  <div className="md-meta-sources">
                    <div className="md-meta-source-card" style={{ borderColor: metaCounts.spotify > 0 ? 'rgba(29,185,84,0.4)' : '' }}>
                      <div className="md-meta-source-name" style={{ color: metaCounts.spotify > 0 ? '#1DB954' : '' }}>Spotify</div>
                      <div className="md-meta-source-count">{metaCounts.spotify}</div>
                    </div>
                    <div className="md-meta-source-card" style={{ borderColor: metaCounts.itunes > 0 ? 'rgba(251,146,60,0.4)' : '' }}>
                      <div className="md-meta-source-name" style={{ color: metaCounts.itunes > 0 ? '#fb923c' : '' }}>iTunes</div>
                      <div className="md-meta-source-count">{metaCounts.itunes}</div>
                    </div>
                    <div className="md-meta-source-card" style={{ borderColor: metaCounts.youtube > 0 ? 'rgba(239,68,68,0.4)' : '' }}>
                      <div className="md-meta-source-name" style={{ color: metaCounts.youtube > 0 ? '#f87171' : '' }}>YTMusic</div>
                      <div className="md-meta-source-count">{metaCounts.youtube}</div>
                    </div>
                  </div>
                )}

                {/* Controls */}
                <div className="md-tracklist-controls">
                  <input className="md-tl-search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter tracks…" />
                  <select className="md-tl-sort" value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
                    <option value="default">Default order</option>
                    <option value="az">A → Z</option>
                    <option value="za">Z → A</option>
                  </select>
                  <button className="md-tl-btn" onClick={selectAll}>All</button>
                  <button className="md-tl-btn" onClick={deselectAll}>None</button>
                  {dupCount > 0 && (
                    <motion.button className="md-tl-btn md-tl-btn--danger" onClick={removeDups} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={springBounce}>
                      Remove Dups
                    </motion.button>
                  )}
                </div>

                {/* Track rows */}
                <div className="md-tracks">
                  <AnimatePresence>
                    {filteredItems.map((item, visIdx) => {
                      const realIdx = allItems.indexOf(item);
                      const isSelected = selectedItems.has(realIdx);
                      const isDup = duplicateSet.has(realIdx);
                      const hasPreview = !!item.preview_url;

                      return (
                        <motion.div
                          key={item.id || item.url || realIdx}
                          className={`md-track-row ${isSelected ? 'md-track-row--selected' : ''} ${isDup ? 'md-track-row--duplicate' : ''}`}
                          onClick={() => toggleItem(realIdx)}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 8 }}
                          transition={{ ...spring, delay: Math.min(visIdx * 0.015, 0.3) }}
                        >
                          <motion.div className={`md-track-check ${isSelected ? 'md-track-check--on' : ''}`} animate={isSelected ? { scale: [1, 1.2, 1] } : {}} transition={spring}>
                            {isSelected && <CheckCircle2 size={12} color="white" />}
                          </motion.div>
                          <div className="md-track-num">{String(realIdx + 1).padStart(2, '0')}</div>
                          {item.thumbnail || item.coverUrl ? (
                            <img src={item.thumbnail || item.coverUrl} alt="" className="md-track-thumb" />
                          ) : (
                            <div className="md-track-thumb-placeholder"><Music size={14} /></div>
                          )}
                          <div className="md-track-info">
                            <div className="md-track-name">{item.title}</div>
                            <div className="md-track-artist">{item.artist || item.channel || ''}</div>
                          </div>
                          <div className="md-track-dur">{fmtDur(item.durationMs || item.duration * 1000)}</div>
                          {item.metadataSource && (
                            <span className={`md-meta-badge md-meta-badge--${item.metadataSource === 'spotify' || item.metadataSource === 'spotify-public' ? 'spotify' : item.metadataSource === 'itunes' ? 'itunes' : 'youtube'}`}>
                              {item.metadataSource === 'spotify' || item.metadataSource === 'spotify-public' ? 'SPT' : item.metadataSource === 'itunes' ? 'AMS' : 'YTM'}
                            </span>
                          )}
                          {isDup && <span className="md-meta-badge md-meta-badge--dup">DUP</span>}
                          {hasPreview && (
                            <motion.button
                              className={`md-preview-btn ${previewingIdx === realIdx ? 'md-preview-btn--playing' : ''}`}
                              onClick={e => { e.stopPropagation(); togglePreview(realIdx, item.preview_url); }}
                              whileTap={{ scale: 0.9 }}
                              transition={spring}
                            >
                              {previewingIdx === realIdx ? <Pause size={11} /> : <Play size={11} />}
                            </motion.button>
                          )}
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── EXPORT SETTINGS ─── */}
        <AnimatePresence>
          {allItems.length > 0 && !isDownloading && !isDone && (
            <motion.div className="md-card" key="settings" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ ...spring, delay: 0.05 }}>
              <div className="md-card-header">
                <span className="md-card-title-icon"><Zap size={15} /></span>
                <span className="md-card-title">Export Settings</span>
              </div>
              <div className="md-card-body">
                <div className="md-settings-grid">
                  <div className="md-settings-field">
                    <label className="md-settings-label">Format</label>
                    <select className="md-select" value={format} onChange={e => setFormat(e.target.value)}>
                      {AUDIO_FORMATS.map(f => <option key={f.id} value={f.id}>{f.label} — {f.sub}</option>)}
                    </select>
                  </div>

                  <div className="md-settings-field">
                    <label className="md-settings-label">Parallel Downloads</label>
                    <div className="md-concurrency-row">
                      <input type="range" min="1" max="24" value={concurrency} onChange={e => setConcurrency(Number(e.target.value))} className="md-concurrency-slider" style={{ '--pct': `${concurrencyPct}%` }} />
                      <span className="md-concurrency-val">{concurrency}</span>
                    </div>
                  </div>

                  <div className="md-settings-field">
                    <label className="md-settings-label">Speed Mode</label>
                    <div className="md-output-toggle">
                      <button className={`md-toggle-btn ${speedMode === 'BALANCED' ? 'md-toggle-btn--active' : ''}`} onClick={() => setSpeedMode('BALANCED')}>Balanced</button>
                      <button className={`md-toggle-btn ${speedMode === 'MAXIMUM' ? 'md-toggle-btn--active' : ''}`} onClick={() => setSpeedMode('MAXIMUM')}><Zap size={13} /> Maximum</button>
                    </div>
                  </div>

                  <div className="md-settings-field">
                    <label className="md-settings-label">Output</label>
                    <div className="md-output-toggle">
                      <button className={`md-toggle-btn ${outputMode === 'zip' ? 'md-toggle-btn--active' : ''}`} onClick={() => setOutputMode('zip')}><Archive size={13} /> ZIP</button>
                      <button className={`md-toggle-btn ${outputMode === 'folder' ? 'md-toggle-btn--active' : ''}`} onClick={() => setOutputMode('folder')}><FolderOpen size={13} /> Folder</button>
                    </div>
                  </div>

                  <div className="md-settings-field">
                    <label className="md-settings-label">Folder / ZIP Name</label>
                    <input className="md-input" style={{ padding: '9px 12px' }} value={folderName} onChange={e => setFolderName(e.target.value)} placeholder="Playlist name" />
                  </div>

                  <div className="md-settings-field" style={{ gridColumn: '1 / -1' }}>
                    <label className="md-settings-label">File Naming Template</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                      {NAMING_TOKENS.map(tok => (
                        <button key={tok} className="md-tl-btn" style={{ fontSize: '0.72rem', padding: '4px 8px' }} onClick={() => setNamingTpl(prev => prev + tok)}>{tok}</button>
                      ))}
                    </div>
                    <input className="md-input" style={{ padding: '9px 12px' }} value={namingTpl} onChange={e => setNamingTpl(e.target.value)} placeholder="{track_number} - {artist} - {title}" />
                    <div className="md-naming-preview"><FileText size={12} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> {namingPreview}</div>
                  </div>

                  {outputMode === 'zip' && (
                    <div className="md-split-row">
                      <label className="md-settings-label" style={{ marginBottom: 0 }}>
                        <input type="checkbox" checked={splitEnabled} onChange={e => setSplitEnabled(e.target.checked)} style={{ marginRight: 8 }} />
                        Split ZIP every
                      </label>
                      <input className="md-split-input" type="number" min="50" max="500" step="50" value={splitEvery} onChange={e => setSplitEvery(Number(e.target.value))} disabled={!splitEnabled} />
                      <span className="md-split-on">tracks</span>
                      {allItems.length > 500 && <span className="md-meta-badge md-meta-badge--dup" style={{ transform: 'none' }}>Auto-on (500+ tracks)</span>}
                    </div>
                  )}
                </div>

                <div style={{ height: 14 }} />

                <motion.button
                  className="md-start-btn"
                  onClick={startDownload}
                  disabled={selectedCount === 0}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  transition={spring}
                >
                  <Download size={18} />
                  Start Download — {selectedCount} track{selectedCount !== 1 ? 's' : ''}
                  {totalDurationMs > 0 && <span style={{ opacity: 0.7, fontWeight: 400, fontSize: '0.85rem' }}>· {fmtSize(totalDurationMs, format)}</span>}
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── PROGRESS ─── */}
        <AnimatePresence>
          {isDownloading && (
            <motion.div className="md-card" key="progress" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={spring}>
              <div className="md-card-header">
                <span className="md-card-title-icon"><Download size={15} /></span>
                <span className="md-card-title">Downloading</span>
                {paused && <motion.span className="md-meta-badge md-meta-badge--dup" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={springBounce}>PAUSED</motion.span>}
              </div>
              <div className="md-card-body">
                <div className="md-progress-header">
                  {dlState?.coverUrl ? <img src={dlState.coverUrl} alt="" className="md-progress-cover" /> : <div className="md-progress-cover-ph"><Music size={22} /></div>}
                  <div className="md-progress-meta">
                    <div className="md-progress-playlist">MASS DOWNLOAD</div>
                    <div className="md-progress-now">{dlState?.title || 'Preparing…'}</div>
                    <div className="md-progress-artist">{dlState?.artist || ''}</div>
                  </div>
                  <div className="md-progress-counters">
                    <div className="md-prog-counter md-prog-counter--done">
                      <div className="md-prog-counter-val">{dlState?.completedCount ?? Math.max(0, (dlState?.current || 0) - 1 - (dlState?.failedCount || 0))}</div>
                      <div className="md-prog-counter-label">Done</div>
                    </div>
                    <div className="md-prog-counter md-prog-counter--fail">
                      <div className="md-prog-counter-val">{dlState?.failedCount || 0}</div>
                      <div className="md-prog-counter-label">Failed</div>
                    </div>
                    <div className="md-prog-counter md-prog-counter--eta">
                      <div className="md-prog-counter-val">{fmtSecs(dlState?.estimatedSecondsRemaining)}</div>
                      <div className="md-prog-counter-label">ETA</div>
                    </div>
                  </div>
                </div>

                <div className="md-prog-bar-labels">
                  <span>{dlState?.current || 0} / {dlState?.total || 0} tracks</span>
                  <span className="md-prog-pct">{dlState?.percent || 0}%</span>
                </div>
                <div className="md-prog-bar-outer">
                  <div className="md-prog-bar-fill" style={{ width: `${dlState?.percent || 0}%` }} />
                </div>

                <div className="md-stats-row">
                  <div className="md-stat-chip"><Clock size={12} /> Elapsed: {fmtSecs(elapsedSecs)}</div>
                  {tracksPerMin && <div className="md-stat-chip"><Zap size={12} /> {tracksPerMin} tracks/min</div>}
                  {dlState?.status && <div className="md-stat-chip"><Database size={12} /> {dlState.status}</div>}
                </div>

                {/* Track dots (≤60 tracks) */}
                {allItems.filter((_, i) => selectedItems.has(i)).length <= 60 && (
                  <div className="md-prog-dots">
                    {allItems.filter((_, i) => selectedItems.has(i)).map((_, i) => {
                      const cur = dlState?.current || 0;
                      let st = 'pending';
                      if (i < cur - 1) st = 'done';
                      else if (i === cur - 1) st = 'downloading';
                      return <div key={i} className={`md-prog-dot md-prog-dot--${st}`} />;
                    })}
                  </div>
                )}

                {/* Named track rows (>60 tracks) */}
                {allItems.filter((_, i) => selectedItems.has(i)).length > 60 && (
                  <div className="md-dl-tracks">
                    {allItems.filter((_, i) => selectedItems.has(i)).slice(Math.max(0, (dlState?.current || 1) - 4), (dlState?.current || 0) + 2).map((item, i) => {
                      const absIdx = Math.max(0, (dlState?.current || 1) - 4) + i;
                      const cur = dlState?.current || 0;
                      const st = absIdx < cur - 1 ? 'done' : absIdx === cur - 1 ? 'downloading' : 'pending';
                      return (
                        <div key={absIdx} className={`md-dl-track md-dl-track--${st}`}>
                          {st === 'downloading' && <Loader2 size={13} className="md-spin" color="var(--md-magenta)" />}
                          {st === 'done' && <CheckCircle2 size={13} color="#4ade80" />}
                          {st === 'pending' && <div style={{ width: 13, height: 13, borderRadius: '50%', background: 'rgba(168,85,247,0.2)' }} />}
                          <span className="md-dl-track-name">{item.title}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Actions */}
                <div className="md-prog-actions">
                  <button className="md-prog-btn md-prog-btn--pause" onClick={() => setPaused(p => !p)}>
                    {paused ? <><Play size={14} /> Resume</> : <><Pause size={14} /> Pause</>}
                  </button>
                  <button className="md-prog-btn md-prog-btn--cancel" onClick={cancelDownload}>
                    <SquareStop size={14} /> Cancel
                  </button>
                  <button className="md-log-toggle" onClick={() => setShowLog(p => !p)}>
                    <Terminal size={12} /> {showLog ? 'Hide' : 'Show'} Logs
                  </button>
                </div>

                {/* Log console */}
                <AnimatePresence>
                  {showLog && (
                    <motion.div className="md-log-console" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                      <div className="md-log-console-header">
                        <div className="md-log-dots">
                          <div className="md-log-dot" /><div className="md-log-dot" /><div className="md-log-dot" />
                        </div>
                        <span className="md-log-label">yt-dlp stdout</span>
                      </div>
                      <div className="md-log-body">
                        {logLines.length === 0 && <div className="md-log-line">Waiting for output…</div>}
                        {logLines.map((line, i) => <div key={i} className="md-log-line">{line}</div>)}
                        <div ref={logEndRef} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── DONE ─── */}
        <AnimatePresence>
          {isDone && (
            <motion.div className="md-card" key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={springBounce}>
              <div className="md-card-body md-done-card">
                <motion.div className={`md-done-icon ${dlState?.cancelled ? 'md-done-icon--cancel' : ''}`} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={springBounce}>
                  {dlState?.cancelled ? <AlertCircle size={32} color="#f87171" /> : <CheckCircle2 size={32} color="#4ade80" />}
                </motion.div>
                <div className="md-done-title">{dlState?.cancelled ? 'Download Cancelled' : dlState?.error ? 'Download Failed' : 'Download Complete!'}</div>
                <div className="md-done-sub">
                  {dlState?.completedCount !== undefined
                    ? `${dlState.completedCount} downloaded · ${dlState.failedCount || 0} failed`
                    : dlState?.error || ''}
                </div>

                {/* ZIP parts */}
                {dlState?.zipParts?.length > 0 && (
                  <div className="md-done-parts">
                    {dlState.zipParts.map((part, i) => (
                      <div key={i} className="md-done-part">
                        <Archive size={14} color="var(--md-purple)" />
                        <span style={{ flex: 1 }}>{part}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="md-done-actions">
                  <button className="md-done-btn md-done-btn--open" onClick={openFolder}><FolderOpen size={15} /> Open Folder</button>
                  {dlState?.failedCount > 0 && (
                    <motion.button className="md-prog-btn md-prog-btn--retry" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={springBounce} onClick={retryFailed}>
                      <RefreshCw size={14} /> Retry Failed ({dlState.failedCount})
                    </motion.button>
                  )}
                  <button className="md-done-btn md-done-btn--new" onClick={resetAll}><Layers size={15} /> New Download</button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
