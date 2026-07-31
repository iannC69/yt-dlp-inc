import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Layers, Music, Download, Loader2, AlertCircle, CheckCircle2,
  Link2, List, Search, X, FolderOpen, Clock, HardDrive, Database,
  Play, Pause, SquareStop, RefreshCw, Terminal, ChevronDown, ChevronUp,
  Archive, Disc, Zap, FileText, Cpu, LayoutGrid, ListVideo, ExternalLink,
  Activity, Sparkles, Shield, Trash2, Upload,
  Gauge, Headphones, Timer, SlidersHorizontal, Flame, Settings2,
  SkipForward, CheckSquare, RotateCcw, TrendingUp
} from 'lucide-react';
import './MassDownloader.css';

// ── Constants ────────────────────────────────────────────────
const AUDIO_FORMATS = [
  { id: 'mp3',     label: 'MP3 320kbps',  sub: 'Best quality' },
  { id: 'mp3_192', label: 'MP3 192kbps',  sub: 'Balanced' },
  { id: 'm4a',     label: 'M4A / AAC',    sub: 'Apple format' },
  { id: 'wav',     label: 'WAV',          sub: 'Lossless raw' },
  { id: 'flac',    label: 'FLAC',         sub: 'Lossless compressed' },
  { id: 'ogg',     label: 'OGG Vorbis',   sub: 'Open format' },
];

const NAMING_TOKENS = ['{track_number}', '{artist}', '{title}', '{year}', '{album}'];

const spring       = { type: 'spring', stiffness: 400, damping: 25 };
const springBounce = { type: 'spring', stiffness: 350, damping: 20 };

function fmtDur(ms) {
  if (!ms) return '';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function fmtSecs(s) {
  if (!s) return '--:--';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `~${m}m ${sec}s`;
  return `~${sec}s`;
}
function fmtSize(totalMs, fmt) {
  const kbpsMap = { mp3: 320, mp3_192: 192, m4a: 256, wav: 1411, flac: 900, ogg: 192 };
  const mb = ((kbpsMap[fmt] || 320) * 1000 / 8) * (totalMs / 1000) / 1024 / 1024;
  return mb < 1 ? `~${Math.round(mb * 1024)} KB` : `~${mb.toFixed(1)} MB`;
}
function applyNaming(tpl, item, idx) {
  return tpl
    .replace('{track_number}', String(idx + 1).padStart(4, '0'))
    .replace('{artist}',       item.artist || item.channel || 'Unknown')
    .replace('{title}',        item.title  || 'Unknown')
    .replace('{year}',         item.year   || '')
    .replace('{album}',        item.album  || '');
}

async function getValidAccessToken(clientId, clientSecret) {
  const expiresAt    = parseInt(localStorage.getItem('spotify_expires_at')   || '0', 10);
  const accessToken  = localStorage.getItem('spotify_access_token')  || '';
  const refreshToken = localStorage.getItem('spotify_refresh_token') || '';
  if (accessToken && Date.now() < expiresAt - 60000) return accessToken;
  if (refreshToken && clientId && clientSecret) {
    try {
      const res  = await fetch('/api/spotify-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-spotify-client-id': clientId, 'x-spotify-client-secret': clientSecret },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const data = await res.json();
      if (data.access_token) {
        localStorage.setItem('spotify_access_token', data.access_token);
        localStorage.setItem('spotify_expires_at',   Date.now() + data.expires_in * 1000);
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

// ─── Sub-components ──────────────────────────────────────────

function MiniStat({ label, value, accent, pulse }) {
  return (
    <div className={`v2-mini-stat${pulse ? ' v2-mini-stat--pulse' : ''}`} style={{ '--accent': accent }}>
      <span className="v2-mini-val">{value}</span>
      <span className="v2-mini-lbl">{label}</span>
    </div>
  );
}

function ToggleSwitch({ checked, onChange, label }) {
  return (
    <label className="v2-switch">
      <div className={`v2-switch-track${checked ? ' v2-switch-track--on' : ''}`} onClick={() => onChange(!checked)}>
        <div className="v2-switch-thumb" />
      </div>
      <span>{label}</span>
    </label>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button className={`v2-src-tab${active ? ' v2-src-tab--active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

// ─── Main ────────────────────────────────────────────────────
export default function MassDownloader() {
  // Source
  const [sourceTab, setSourceTab] = useState('spotify');
  const [spotUrl,      setSpotUrl]      = useState('');
  const [spotFetching, setSpotFetching] = useState(false);
  const [spotError,    setSpotError]    = useState('');
  const [spotResult,   setSpotResult]   = useState(null);
  const [ytUrl,        setYtUrl]        = useState('');
  const [ytFetching,   setYtFetching]   = useState(false);
  const [ytError,      setYtError]      = useState('');
  const [ytResult,     setYtResult]     = useState(null);
  const [urlListText,      setUrlListText]      = useState('');
  const [urlListResolving, setUrlListResolving] = useState(false);
  const [urlListItems,     setUrlListItems]     = useState([]);
  const [urlListError,     setUrlListError]     = useState('');

  // Track list
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [filter,        setFilter]        = useState('');
  const [sortOrder,     setSortOrder]     = useState('default');
  const [previewingIdx, setPreviewingIdx] = useState(null);
  const audioRef = useRef(null);

  // Settings
  const [format,         setFormat]         = useState('mp3');
  const [concurrency,    setConcurrency]    = useState(3);
  const [speedMode,      setSpeedMode]      = useState('BALANCED');
  const [outputMode,     setOutputMode]     = useState('zip');
  const [namingTpl,      setNamingTpl]      = useState('{track_number} - {artist} - {title}');
  const [splitEvery,     setSplitEvery]     = useState(100);
  const [splitEnabled,   setSplitEnabled]   = useState(false);
  const [folderName,     setFolderName]     = useState('');
  const [embedMetadata,  setEmbedMetadata]  = useState(true);
  const [embedLyrics,    setEmbedLyrics]    = useState(false);
  const [skipExisting,   setSkipExisting]   = useState(true);
  const [volumeNorm,     setVolumeNorm]     = useState(false);
  const [advancedMode,   setAdvancedMode]   = useState(false);
  const [speedLimit,     setSpeedLimit]     = useState('0');
  const [autoRetry,      setAutoRetry]      = useState(false);
  const [bandwidthSaver, setBandwidthSaver] = useState(false);
  const [outputStructure,    setOutputStructure]    = useState('flat');
  const [generateNFO,        setGenerateNFO]        = useState(false);
  const [trimSilence,        setTrimSilence]        = useState(false);
  const [exportLRC,          setExportLRC]          = useState(false);
  const [audioCodecPriority, setAudioCodecPriority] = useState('quality');
  const [gridView,           setGridView]           = useState(false);
  const [inspectorItem,      setInspectorItem]      = useState(null);

  // UI panels
  const [settingsOpen,   setSettingsOpen]   = useState(false);
  const [sourceOpen,     setSourceOpen]     = useState(true);

  // Download state
  const [dlState,       setDlState]       = useState(null);
  const [paused,        setPaused]        = useState(false);
  const [trackStatuses, setTrackStatuses] = useState({});
  const [logLines,      setLogLines]      = useState([]);
  const [showLog,       setShowLog]       = useState(false);
  const [failedItems,   setFailedItems]   = useState([]);

  const dlReaderRef  = useRef(null);
  const logEndRef    = useRef(null);
  const startTimeRef = useRef(null);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const elapsedRef   = useRef(null);

  // ── Computed ─────────────────────────────────────────────────
  const allItems = useMemo(() => {
    if (sourceTab === 'spotify'  && spotResult?.tracks) return spotResult.tracks;
    if (sourceTab === 'youtube'  && ytResult?.items)    return ytResult.items;
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

  const duplicateSet = useMemo(() => {
    const seen = new Map(), dupIndices = new Set();
    allItems.forEach((item, i) => {
      const key = `${(item.title || '').toLowerCase().trim()}::${(item.artist || item.channel || '').toLowerCase().trim()}`;
      if (seen.has(key)) { dupIndices.add(seen.get(key)); dupIndices.add(i); }
      else seen.set(key, i);
    });
    return dupIndices;
  }, [allItems]);

  const dupCount        = duplicateSet.size;
  const isDownloading   = dlState?.active && !dlState?.done;
  const isDone          = dlState?.done;
  const totalDurationMs = allItems.filter((_, i) => selectedItems.has(i)).reduce((a, t) => a + (t.durationMs || 0), 0);
  const selectedCount   = selectedItems.size;
  const tracksPerMin    = dlState?.current > 0 && elapsedSecs > 0 ? ((dlState.current / elapsedSecs) * 60).toFixed(1) : null;
  const concurrencyPct  = ((concurrency - 1) / 23) * 100;
  const doneCount       = Object.values(trackStatuses).filter(s => s === 'done').length;

  const namingPreview = useMemo(() => {
    const s = allItems[0] || { title: 'Song Title', artist: 'Artist', channel: 'Channel', year: '2024', album: 'Album' };
    return applyNaming(namingTpl, s, 0) + '.' + format.replace('_192', '');
  }, [namingTpl, allItems, format]);

  const metaCounts = useMemo(() => {
    const src = allItems.filter((_, i) => selectedItems.has(i));
    return {
      spotify: src.filter(t => t.metadataSource === 'spotify' || t.metadataSource === 'spotify-public').length,
      itunes:  src.filter(t => t.metadataSource === 'itunes').length,
      youtube: src.filter(t => t.metadataSource === 'youtube_music').length,
    };
  }, [allItems, selectedItems]);

  // ── Effects ──────────────────────────────────────────────────
  useEffect(() => {
    setSelectedItems(new Set(allItems.map((_, i) => i)));
    setFilter(''); setSortOrder('default');
  }, [allItems.length, sourceTab]);

  useEffect(() => {
    if (dlState?.active && !dlState?.done) {
      if (!startTimeRef.current) startTimeRef.current = Date.now();
      elapsedRef.current = setInterval(() => setElapsedSecs(Math.floor((Date.now() - startTimeRef.current) / 1000)), 1000);
    } else {
      clearInterval(elapsedRef.current);
      if (!dlState?.active) { startTimeRef.current = null; setElapsedSecs(0); }
    }
    return () => clearInterval(elapsedRef.current);
  }, [dlState?.active, dlState?.done]);

  useEffect(() => {
    if (showLog && logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [logLines, showLog]);

  useEffect(() => { if (allItems.length > 500) setSplitEnabled(true); }, [allItems.length]);

  useEffect(() => {
    const handlePaste = (e) => {
      const url = e.detail;
      if (url.includes('spotify.com')) setSpotUrl(url); else setYtUrl(url);
    };
    const handleDL = () => { if (allItems.length > 0 && !dlState?.active) startDownload(); };
    window.addEventListener('app:paste-url',       handlePaste);
    window.addEventListener('app:global-download', handleDL);
    return () => {
      window.removeEventListener('app:paste-url',       handlePaste);
      window.removeEventListener('app:global-download', handleDL);
    };
  }, [allItems, dlState?.active]);

  // ── Sources ──────────────────────────────────────────────────
  const fetchSpotify = useCallback(async () => {
    if (!spotUrl.trim()) return;
    setSpotError(''); setSpotResult(null); setSpotFetching(true);
    try {
      const cid = localStorage.getItem('spotify_client_id') || '';
      const csec = localStorage.getItem('spotify_client_secret') || '';
      const token = cid && csec ? await getValidAccessToken(cid, csec) : '';
      const res  = await fetch(`/api/spotify-mass-fetch?url=${encodeURIComponent(spotUrl)}`, {
        headers: { 'x-spotify-client-id': cid, 'x-spotify-client-secret': csec, 'x-spotify-access-token': token }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fetch failed');
      const san = { ...data };
      if (san.tracks) san.tracks = san.tracks.map(t => ({ ...t, album: t.album || '' }));
      setSpotResult(san);
      setFolderName(data.playlistName || 'Spotify Playlist');
    } catch (e) { setSpotError(e.message); }
    setSpotFetching(false);
  }, [spotUrl]);

  const fetchYoutube = useCallback(async () => {
    if (!ytUrl.trim()) return;
    setYtError(''); setYtResult(null); setYtFetching(true);
    try {
      const res  = await fetch(`/api/mass/ytdl-playlist-info?url=${encodeURIComponent(ytUrl)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fetch failed');
      if (!data.items?.length) throw new Error('No items found in playlist.');
      setYtResult(data);
      setFolderName(data.title || 'YouTube Playlist');
    } catch (e) { setYtError(e.message); }
    setYtFetching(false);
  }, [ytUrl]);

  const resolveUrlList = useCallback(async () => {
    const lines = urlListText.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    setUrlListError(''); setUrlListItems([]); setUrlListResolving(true);
    try {
      const res  = await fetch('/api/mass/url-list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: lines }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Resolve failed');
      setUrlListItems(data.items || []);
      setFolderName('URL List');
    } catch (e) { setUrlListError(e.message); }
    setUrlListResolving(false);
  }, [urlListText]);

  // ── Selection ────────────────────────────────────────────────
  const selectAll  = () => setSelectedItems(new Set(allItems.map((_, i) => i)));
  const deselectAll = () => setSelectedItems(new Set());
  const removeDups  = () => setSelectedItems(prev => { const n = new Set(prev); duplicateSet.forEach(i => n.delete(i)); return n; });
  const toggleItem  = (i) => setSelectedItems(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const clearCompleted = () => setTrackStatuses(prev => {
    const n = { ...prev };
    Object.entries(n).forEach(([k, v]) => { if (v === 'done') delete n[k]; });
    return n;
  });

  // ── Preview ──────────────────────────────────────────────────
  const togglePreview = (idx, previewUrl) => {
    if (!previewUrl) return;
    if (previewingIdx === idx) { audioRef.current?.pause(); setPreviewingIdx(null); }
    else {
      audioRef.current?.pause();
      audioRef.current = new Audio(previewUrl);
      audioRef.current.onended = () => setPreviewingIdx(null);
      audioRef.current.play().catch(() => {});
      setPreviewingIdx(idx);
    }
  };

  // ── Export URLs ──────────────────────────────────────────────
  const exportUrls = () => {
    const urls = allItems.filter((_, i) => selectedItems.has(i)).map(t => t.url).filter(Boolean);
    if (!urls.length) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([urls.join('\n')], { type: 'text/plain' }));
    a.download = `exported_urls_${Date.now()}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // ── Download ─────────────────────────────────────────────────
  const startDownload = async () => {
    const items = allItems.filter((_, i) => selectedItems.has(i));
    if (!items.length) return;

    const dlId = Date.now().toString();
    setDlState({ active: true, done: false, error: null, cancelled: false, current: 0, total: items.length, percent: 0, completedCount: 0, failedCount: 0, jobId: dlId });
    setTrackStatuses({}); setLogLines([]); setFailedItems([]); setPaused(false);

    const cid  = localStorage.getItem('spotify_client_id')     || '';
    const csec = localStorage.getItem('spotify_client_secret') || '';
    const token = cid && csec ? await getValidAccessToken(cid, csec) : '';
    const fmtKey = format.replace('_192', '');

    let endpoint, bodyPayload, params;
    if (sourceTab === 'spotify' && spotResult) {
      params = new URLSearchParams({ format: `audio:${fmtKey}:0`, downloadId: dlId, concurrency: String(concurrency), speedMode,
        customPath: localStorage.getItem('customPath') || '', audioFormat: localStorage.getItem('audioFormat') || 'mp3',
        audioQuality: localStorage.getItem('audioQuality') || '320k',
        embedLyrics: embedLyrics ? 'true' : 'false', embedMetadata: embedMetadata ? 'true' : 'false',
        skipExisting: skipExisting ? 'true' : 'false', volumeNorm: volumeNorm ? 'true' : 'false',
        speedLimit, outputStructure, generateNFO: generateNFO ? 'true' : 'false',
        trimSilence: trimSilence ? 'true' : 'false', exportLRC: exportLRC ? 'true' : 'false', audioCodecPriority });
      endpoint    = `/api/spotify-mass-download?${params}`;
      bodyPayload = { tracks: items, playlistName: folderName || spotResult.playlistName, playlistCover: spotResult.playlistCover, owner: spotResult.owner };
    } else {
      params = new URLSearchParams({ format: fmtKey, downloadId: dlId, concurrency: String(concurrency), speedMode,
        outputZip: outputMode === 'zip' ? 'true' : 'false', naming: namingTpl,
        splitEvery: splitEnabled ? String(splitEvery) : '0',
        customPath: localStorage.getItem('customPath') || '', audioFormat: localStorage.getItem('audioFormat') || 'mp3',
        audioQuality: localStorage.getItem('audioQuality') || '320k',
        embedLyrics: embedLyrics ? 'true' : 'false', embedMetadata: embedMetadata ? 'true' : 'false',
        skipExisting: skipExisting ? 'true' : 'false', volumeNorm: volumeNorm ? 'true' : 'false',
        speedLimit, outputStructure, generateNFO: generateNFO ? 'true' : 'false',
        trimSilence: trimSilence ? 'true' : 'false', exportLRC: exportLRC ? 'true' : 'false', audioCodecPriority });
      endpoint    = `/api/mass/start-ytdl?${params}`;
      bodyPayload = { items, playlistName: folderName || 'mass-download' };
    }

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (cid) { headers['x-spotify-client-id'] = cid; headers['x-spotify-client-secret'] = csec; headers['x-spotify-access-token'] = token; }
      const res     = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(bodyPayload) });
      const reader  = res.body.getReader();
      dlReaderRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n'); buffer = chunks.pop() || '';
        for (const chunk of chunks) {
          if (!chunk.startsWith('data: ')) continue;
          try {
            const d = JSON.parse(chunk.slice(6));
            if (d.logLine) { setLogLines(prev => [...prev.slice(-299), d.logLine]); continue; }
            setDlState(prev => { const next = { ...prev, ...d }; if (d.done) next.active = false; return next; });
            if (d.current !== undefined) {
              setTrackStatuses(prev => {
                const n = { ...prev }, idx = d.current - 1;
                if (idx >= 0) n[idx] = 'downloading';
                if (idx > 0)  n[idx - 1] = 'done';
                return n;
              });
            }
            if (d.done && d.failedCount > 0) setFailedItems(items.filter((_, i) => trackStatuses[i] === 'failed'));
          } catch {}
        }
      }
    } catch (err) {
      setDlState(prev => ({ ...prev, active: false, done: true, error: err.message }));
    }
  };

  const cancelDownload = async () => {
    const dlId = dlState?.jobId;
    if (dlId) { try { await fetch(`/api/mass/cancel?downloadId=${encodeURIComponent(dlId)}`); } catch {} }
    if (dlReaderRef.current) { try { dlReaderRef.current.cancel(); } catch {} }
    setDlState(prev => ({ ...prev, active: false, done: true, cancelled: true }));
  };

  const retryFailed = () => {
    const s = new Set(allItems.map((_, i) => trackStatuses[i] === 'failed' ? i : null).filter(i => i !== null));
    if (!s.size) return;
    setSelectedItems(s); setDlState(null); setTimeout(() => startDownload(), 50);
  };

  const resetAll = () => {
    setDlState(null); setTrackStatuses({}); setLogLines([]); setFailedItems([]); setPaused(false);
    setSpotResult(null); setYtResult(null); setUrlListItems([]);
    setSpotUrl(''); setYtUrl(''); setUrlListText(''); setFilter('');
  };

  const openFolder = () => fetch(`/api/ytdl/open-folder?customPath=${encodeURIComponent(localStorage.getItem('customPath') || '')}`);

  // ════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════
  return (
    <div className="v2-page">
      {/* ambient */}
      <div className="v2-orb v2-orb-1" />
      <div className="v2-orb v2-orb-2" />
      <div className="v2-grid" />

      {/* ═══ HEADER BAR ═══ */}
      <header className="v2-header">
        <div className="v2-header-brand">
          <div className="v2-brand-dot" />
          <span className="v2-brand-name">Mass Downloader</span>
          <span className={`v2-engine-badge${isDownloading ? ' v2-engine-badge--active' : ''}`}>
            {isDownloading ? 'ACTIVE' : 'STANDBY'}
          </span>
        </div>

        {/* Source input — lives inline in header */}
        <div className="v2-header-source">
          <div className="v2-src-tabs">
            <TabBtn active={sourceTab === 'spotify'}  onClick={() => setSourceTab('spotify')}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
              Spotify
            </TabBtn>
            <TabBtn active={sourceTab === 'youtube'}  onClick={() => setSourceTab('youtube')}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M21.582 6.186a2.684 2.684 0 00-1.884-1.898C17.983 3.8 12 3.8 12 3.8s-5.983 0-7.698.488A2.684 2.684 0 002.418 6.186C1.94 7.915 1.94 12 1.94 12s0 4.085.478 5.814a2.684 2.684 0 001.884 1.898C5.983 20.2 12 20.2 12 20.2s5.983 0 7.698-.488a2.684 2.684 0 001.884-1.898C22.06 16.085 22.06 12 22.06 12s0-4.085-.478-5.814zM9.913 14.894V9.106l5.244 2.894-5.244 2.894z"/></svg>
              YouTube
            </TabBtn>
            <TabBtn active={sourceTab === 'urllist'} onClick={() => setSourceTab('urllist')}>
              <FileText size={12} /> URLs
            </TabBtn>
          </div>

          {/* Spotify input */}
          {sourceTab === 'spotify' && (
            <div className="v2-src-input-row">
              <div className="v2-src-input-wrap">
                <Link2 size={13} className="v2-src-icon" />
                <input
                  className="v2-src-input"
                  value={spotUrl}
                  onChange={e => { setSpotUrl(e.target.value); setSpotError(''); setSpotResult(null); }}
                  onKeyDown={e => e.key === 'Enter' && fetchSpotify()}
                  placeholder="Paste a Spotify playlist URL…"
                />
                {spotUrl && <button className="v2-src-clear" onClick={() => { setSpotUrl(''); setSpotResult(null); setSpotError(''); }}><X size={12} /></button>}
              </div>
              <button className="v2-src-btn" onClick={fetchSpotify} disabled={spotFetching || !spotUrl.trim()}>
                {spotFetching ? <Loader2 size={13} className="v2-spin" /> : <Search size={13} />} Scan
              </button>
              {spotError && <span className="v2-src-err"><AlertCircle size={12} /> {spotError}</span>}
            </div>
          )}

          {/* YouTube input */}
          {sourceTab === 'youtube' && (
            <div className="v2-src-input-row">
              <div className="v2-src-input-wrap">
                <Link2 size={13} className="v2-src-icon" />
                <input
                  className="v2-src-input"
                  value={ytUrl}
                  onChange={e => { setYtUrl(e.target.value); setYtError(''); setYtResult(null); }}
                  onKeyDown={e => e.key === 'Enter' && fetchYoutube()}
                  placeholder="Paste a YouTube playlist URL…"
                />
                {ytUrl && <button className="v2-src-clear" onClick={() => { setYtUrl(''); setYtResult(null); setYtError(''); }}><X size={12} /></button>}
              </div>
              <button className="v2-src-btn" onClick={fetchYoutube} disabled={ytFetching || !ytUrl.trim()}>
                {ytFetching ? <Loader2 size={13} className="v2-spin" /> : <Search size={13} />} Load
              </button>
              {ytError && <span className="v2-src-err"><AlertCircle size={12} /> {ytError}</span>}
            </div>
          )}

          {/* URL list input */}
          {sourceTab === 'urllist' && (
            <div className="v2-src-input-row">
              <textarea
                className="v2-src-textarea"
                value={urlListText}
                onChange={e => setUrlListText(e.target.value)}
                placeholder="Paste URLs one per line…"
                rows={2}
              />
              <button className="v2-src-btn" onClick={resolveUrlList} disabled={urlListResolving || !urlListText.trim()}>
                {urlListResolving ? <Loader2 size={13} className="v2-spin" /> : <Search size={13} />} Resolve
              </button>
              {urlListError && <span className="v2-src-err"><AlertCircle size={12} /> {urlListError}</span>}
            </div>
          )}
        </div>

        {/* Header right: stats pills */}
        <div className="v2-header-stats">
          <MiniStat label="Queued"   value={allItems.length}   accent="var(--cr)" />
          <MiniStat label="Selected" value={selectedCount}     accent="var(--cr)" />
          {isDownloading && <MiniStat label="Done"   value={dlState?.completedCount ?? 0} accent="#22c55e" pulse />}
          {isDownloading && <MiniStat label="Failed" value={dlState?.failedCount ?? 0}    accent="#ef4444" />}
        </div>
      </header>

      {/* ═══ SETTINGS DRAWER ═══ */}
      <AnimatePresence>
        {allItems.length > 0 && !isDownloading && !isDone && (
          <motion.div className="v2-settings-bar" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={spring}>
            {/* Always-visible quick settings */}
            <div className="v2-quick-bar">
              {/* Format */}
              <div className="v2-qs-group">
                <label className="v2-qs-label"><Headphones size={11} /> Format</label>
                <select className="v2-qs-select" value={format} onChange={e => setFormat(e.target.value)}>
                  {AUDIO_FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </div>

              {/* Parallelism */}
              <div className="v2-qs-group">
                <label className="v2-qs-label"><Gauge size={11} /> Parallel: {concurrency}</label>
                <input type="range" min="1" max="24" value={concurrency} onChange={e => setConcurrency(Number(e.target.value))} className="v2-qs-slider" style={{ '--pct': `${concurrencyPct}%` }} />
              </div>

              {/* Speed mode */}
              <div className="v2-qs-group">
                <label className="v2-qs-label">Mode</label>
                <div className="v2-seg-group">
                  <button className={`v2-seg${speedMode === 'BALANCED' ? ' v2-seg--on' : ''}`} onClick={() => setSpeedMode('BALANCED')}>Balanced</button>
                  <button className={`v2-seg${speedMode === 'MAXIMUM'  ? ' v2-seg--on v2-seg--fire' : ''}`} onClick={() => setSpeedMode('MAXIMUM')}><Zap size={11} /> Max</button>
                </div>
              </div>

              {/* Output */}
              <div className="v2-qs-group">
                <label className="v2-qs-label">Output</label>
                <div className="v2-seg-group">
                  <button className={`v2-seg${outputMode === 'zip'    ? ' v2-seg--on' : ''}`} onClick={() => setOutputMode('zip')}><Archive size={11} /> ZIP</button>
                  <button className={`v2-seg${outputMode === 'folder' ? ' v2-seg--on' : ''}`} onClick={() => setOutputMode('folder')}><FolderOpen size={11} /> Folder</button>
                </div>
              </div>

              {/* Quick toggles inline */}
              <div className="v2-qs-group v2-qs-toggles">
                <ToggleSwitch checked={embedMetadata} onChange={setEmbedMetadata} label="Tags" />
                <ToggleSwitch checked={embedLyrics}   onChange={setEmbedLyrics}   label="Lyrics" />
                <ToggleSwitch checked={skipExisting}  onChange={setSkipExisting}  label="Skip Existing" />
                <ToggleSwitch checked={autoRetry}     onChange={setAutoRetry}     label="Auto Retry" />
              </div>

              {/* Advanced toggle */}
              <button className="v2-adv-btn" onClick={() => setAdvancedMode(!advancedMode)}>
                <Settings2 size={13} />
                {advancedMode ? 'Less' : 'More'}
                {advancedMode ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
            </div>

            {/* Advanced panel */}
            <AnimatePresence>
              {advancedMode && (
                <motion.div className="v2-adv-panel" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }}>
                  <div className="v2-adv-inner">
                    {/* Folder name */}
                    <div className="v2-qs-group">
                      <label className="v2-qs-label">Folder / ZIP Name</label>
                      <input className="v2-qs-input" value={folderName} onChange={e => setFolderName(e.target.value)} placeholder="Playlist name" />
                    </div>

                    {/* Output structure */}
                    <div className="v2-qs-group">
                      <label className="v2-qs-label">Structure</label>
                      <select className="v2-qs-select" value={outputStructure} onChange={e => setOutputStructure(e.target.value)}>
                        <option value="flat">Flat Folder</option>
                        <option value="artist_album">Nested (Artist / Album)</option>
                      </select>
                    </div>

                    {/* Codec priority */}
                    <div className="v2-qs-group">
                      <label className="v2-qs-label">Codec</label>
                      <select className="v2-qs-select" value={audioCodecPriority} onChange={e => setAudioCodecPriority(e.target.value)}>
                        <option value="quality">Highest Quality</option>
                        <option value="compatibility">Compatibility</option>
                        <option value="lossless">Lossless</option>
                      </select>
                    </div>

                    {/* Speed limit */}
                    <div className="v2-qs-group">
                      <label className="v2-qs-label">Speed Limit</label>
                      <select className="v2-qs-select" value={speedLimit} onChange={e => setSpeedLimit(e.target.value)}>
                        <option value="0">No Limit</option>
                        <option value="500K">500 KB/s</option>
                        <option value="1M">1 MB/s</option>
                        <option value="5M">5 MB/s</option>
                        <option value="10M">10 MB/s</option>
                      </select>
                    </div>

                    {/* Extra flags */}
                    <div className="v2-qs-group v2-qs-toggles">
                      <ToggleSwitch checked={volumeNorm}    onChange={setVolumeNorm}    label="Vol. Normalize" />
                      <ToggleSwitch checked={trimSilence}   onChange={setTrimSilence}   label="Trim Silence" />
                      <ToggleSwitch checked={generateNFO}   onChange={setGenerateNFO}   label=".NFO Files" />
                      <ToggleSwitch checked={exportLRC}     onChange={setExportLRC}     label=".LRC Lyrics" />
                      <ToggleSwitch checked={bandwidthSaver} onChange={setBandwidthSaver} label="Bw Saver" />
                    </div>

                    {/* Naming template */}
                    <div className="v2-qs-group v2-qs-group--wide">
                      <label className="v2-qs-label">File Naming</label>
                      <div className="v2-token-row">
                        {NAMING_TOKENS.map(tok => (
                          <button key={tok} className="v2-token" onClick={() => setNamingTpl(p => p + tok)}>{tok}</button>
                        ))}
                      </div>
                      <input className="v2-qs-input v2-qs-input--mono" value={namingTpl} onChange={e => setNamingTpl(e.target.value)} />
                      <span className="v2-naming-preview"><FileText size={10} /> {namingPreview}</span>
                    </div>

                    {/* ZIP split */}
                    {outputMode === 'zip' && (
                      <div className="v2-qs-group">
                        <label className="v2-qs-label">Split ZIP</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="checkbox" checked={splitEnabled} onChange={e => setSplitEnabled(e.target.checked)} />
                          <input className="v2-split-num" type="number" min="50" max="500" step="50" value={splitEvery} onChange={e => setSplitEvery(Number(e.target.value))} disabled={!splitEnabled} />
                          <span className="v2-qs-label">tracks</span>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ MAIN CONTENT AREA ═══ */}
      <main className="v2-main">

        {/* ── ZERO STATE ── */}
        <AnimatePresence>
          {allItems.length === 0 && !isDownloading && !isDone && (
            <motion.div className="v2-zero" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={springBounce}>
              <div className="v2-zero-glow" />
              <div className="v2-zero-ring-wrap">
                <div className="v2-zero-ring" />
                <Activity size={44} className="v2-zero-icon" />
              </div>
              <h2 className="v2-zero-title">Ready to Download</h2>
              <p className="v2-zero-sub">Paste a Spotify or YouTube playlist URL in the bar above to get started.</p>
              <div className="v2-zero-tips">
                {[
                  { icon: <Gauge size={18} />,      t: 'Optimal Parallelism', d: 'Use 3–5 parallel downloads for best stability.' },
                  { icon: <Shield size={18} />,     t: 'Auto Deduplication',  d: 'Duplicate tracks are flagged and removed in one click.' },
                  { icon: <Sparkles size={18} />,   t: 'Smart Metadata',      d: 'Tags sourced from Spotify, iTunes & YouTube Music.' },
                ].map((tip, i) => (
                  <motion.div key={i} className="v2-tip-card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.1 + i * 0.08 }}>
                    <div className="v2-tip-icon">{tip.icon}</div>
                    <div className="v2-tip-title">{tip.t}</div>
                    <div className="v2-tip-text">{tip.d}</div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── TRACK LIST ── */}
        <AnimatePresence>
          {allItems.length > 0 && !isDownloading && !isDone && (
            <motion.div className="v2-tracklist-wrap" key="tl" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring}>

              {/* Playlist header strip */}
              <div className="v2-pl-strip">
                {(spotResult?.playlistCover || ytResult?.items?.[0]?.thumbnail) ? (
                  <img src={spotResult?.playlistCover || ytResult?.items?.[0]?.thumbnail} alt="" className="v2-pl-cover" />
                ) : (
                  <div className="v2-pl-cover-ph"><Music size={20} /></div>
                )}
                <div className="v2-pl-meta">
                  <div className="v2-pl-name">{spotResult?.playlistName || ytResult?.title || 'URL Batch'}</div>
                  {spotResult?.owner && <div className="v2-pl-owner">by {spotResult.owner}</div>}
                </div>
                <div className="v2-pl-pills">
                  <span className="v2-pill"><Music size={10} /> {allItems.length}</span>
                  {totalDurationMs > 0 && <span className="v2-pill"><Clock size={10} /> {fmtDur(totalDurationMs)}</span>}
                  <span className="v2-pill"><HardDrive size={10} /> {fmtSize(totalDurationMs, format)}</span>
                  {dupCount > 0 && <span className="v2-pill v2-pill--warn">⚠ {dupCount} dups</span>}
                  {dupCount === 0 && <span className="v2-pill v2-pill--ok">✓ No dupes</span>}
                  {/* Metadata sources (spotify) */}
                  {sourceTab === 'spotify' && spotResult && metaCounts.spotify > 0 && <span className="v2-pill" style={{ color: '#1DB954' }}>SPT {metaCounts.spotify}</span>}
                  {sourceTab === 'spotify' && spotResult && metaCounts.itunes  > 0 && <span className="v2-pill" style={{ color: '#fb923c' }}>AMS {metaCounts.itunes}</span>}
                  {sourceTab === 'spotify' && spotResult && metaCounts.youtube > 0 && <span className="v2-pill" style={{ color: '#f87171' }}>YTM {metaCounts.youtube}</span>}
                </div>

                {/* CTA */}
                <motion.button
                  className="v2-dl-btn"
                  onClick={startDownload}
                  disabled={selectedCount === 0}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  transition={spring}
                >
                  <Download size={15} />
                  Download {selectedCount} track{selectedCount !== 1 ? 's' : ''}
                  {totalDurationMs > 0 && <span className="v2-dl-size">{fmtSize(totalDurationMs, format)}</span>}
                </motion.button>
              </div>

              {/* Track controls */}
              <div className="v2-tl-controls">
                <div className="v2-search-wrap">
                  <Search size={13} className="v2-search-icon" />
                  <input className="v2-search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter tracks…" />
                  {filter && <button className="v2-search-x" onClick={() => setFilter('')}><X size={11} /></button>}
                </div>
                <select className="v2-sort" value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
                  <option value="default">Default</option>
                  <option value="az">A → Z</option>
                  <option value="za">Z → A</option>
                </select>
                <button className="v2-ctrl-btn" onClick={() => setGridView(!gridView)}>
                  {gridView ? <ListVideo size={13} /> : <LayoutGrid size={13} />}
                </button>
                <div className="v2-ctrl-sep" />
                <button className="v2-ctrl-btn" onClick={selectAll}>All</button>
                <button className="v2-ctrl-btn" onClick={deselectAll}>None</button>
                {dupCount > 0 && <motion.button className="v2-ctrl-btn v2-ctrl-btn--danger" onClick={removeDups} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={springBounce}><Trash2 size={12} /> Rm Dups</motion.button>}
                <button className="v2-ctrl-btn" onClick={exportUrls}><Upload size={12} /> Export</button>
                <span className="v2-tl-count">{selectedCount} / {allItems.length}</span>
              </div>

              {/* Track table */}
              <div className={`v2-tracks${gridView ? ' v2-tracks--grid' : ''}`}>
                <AnimatePresence>
                  {filteredItems.map((item, visIdx) => {
                    const realIdx    = allItems.indexOf(item);
                    const isSelected = selectedItems.has(realIdx);
                    const isDup      = duplicateSet.has(realIdx);
                    const hasPreview = !!item.preview_url;
                    const tStatus    = trackStatuses[realIdx];

                    return (
                      <motion.div
                        key={item.id || item.url || realIdx}
                        className={[
                          'v2-track',
                          isSelected          ? 'v2-track--sel'   : '',
                          isDup               ? 'v2-track--dup'   : '',
                          tStatus === 'downloading' ? 'v2-track--dl'  : '',
                          tStatus === 'done'        ? 'v2-track--done': '',
                          tStatus === 'failed'      ? 'v2-track--fail': '',
                        ].filter(Boolean).join(' ')}
                        onClick={() => toggleItem(realIdx)}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ ...spring, delay: Math.min(visIdx * 0.008, 0.24) }}
                      >
                        {/* Check */}
                        <div className={`v2-chk${isSelected ? ' v2-chk--on' : ''}`}>
                          {isSelected && <CheckCircle2 size={11} color="white" />}
                        </div>

                        {/* Number */}
                        <span className="v2-track-num">{String(realIdx + 1).padStart(2, '0')}</span>

                        {/* Thumbnail */}
                        {item.thumbnail || item.coverUrl ? (
                          <img src={item.thumbnail || item.coverUrl} alt="" className="v2-thumb" />
                        ) : (
                          <div className="v2-thumb-ph"><Music size={12} /></div>
                        )}

                        {/* Info */}
                        <div className="v2-track-info">
                          <div className="v2-track-title">{item.title}</div>
                          <div className="v2-track-artist">{item.artist || item.channel || ''}</div>
                        </div>

                        {/* Duration */}
                        <span className="v2-track-dur">{fmtDur(item.durationMs || item.duration * 1000)}</span>

                        {/* Meta badge */}
                        {item.metadataSource && (
                          <span className={`v2-mbadge v2-mbadge--${item.metadataSource === 'spotify' || item.metadataSource === 'spotify-public' ? 'spt' : item.metadataSource === 'itunes' ? 'ams' : 'ytm'}`}>
                            {item.metadataSource === 'spotify' || item.metadataSource === 'spotify-public' ? 'SPT' : item.metadataSource === 'itunes' ? 'AMS' : 'YTM'}
                          </span>
                        )}
                        {isDup && <span className="v2-mbadge v2-mbadge--dup">DUP</span>}

                        {/* Preview */}
                        {hasPreview && (
                          <motion.button
                            className={`v2-prev-btn${previewingIdx === realIdx ? ' v2-prev-btn--on' : ''}`}
                            onClick={e => { e.stopPropagation(); togglePreview(realIdx, item.preview_url); }}
                            whileTap={{ scale: 0.86 }}
                          >
                            {previewingIdx === realIdx ? <Pause size={10} /> : <Play size={10} />}
                          </motion.button>
                        )}

                        {/* Inspector */}
                        <button className="v2-insp-btn" onClick={e => { e.stopPropagation(); setInspectorItem(item); }} title="Inspect">
                          <Terminal size={11} />
                        </button>

                        {/* Download bar */}
                        {tStatus === 'downloading' && <div className="v2-dl-bar"><div className="v2-dl-bar-fill" /></div>}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── PROGRESS ── */}
        <AnimatePresence>
          {isDownloading && (
            <motion.div className="v2-progress-wrap" key="prog" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring}>
              {/* Big progress bar at top */}
              <div className="v2-prog-mega-bar">
                <div className="v2-prog-mega-fill" style={{ width: `${dlState?.percent || 0}%` }}>
                  <div className="v2-shimmer" />
                </div>
              </div>

              {/* Progress body */}
              <div className="v2-prog-body">
                {/* Currently playing / downloading */}
                <div className="v2-prog-now">
                  {dlState?.coverUrl ? (
                    <img src={dlState.coverUrl} alt="" className="v2-prog-art" />
                  ) : (
                    <div className="v2-prog-art-ph"><Music size={18} /></div>
                  )}
                  <div className="v2-prog-info">
                    <div className="v2-prog-label">Now Downloading</div>
                    <div className="v2-prog-title">{dlState?.title || 'Preparing…'}</div>
                    <div className="v2-prog-artist">{dlState?.artist || ''}</div>
                  </div>
                </div>

                {/* Stats row */}
                <div className="v2-prog-stats">
                  <div className="v2-prog-stat">
                    <span className="v2-prog-stat-val v2-prog-stat-val--red">{dlState?.percent || 0}%</span>
                    <span className="v2-prog-stat-lbl">Progress</span>
                  </div>
                  <div className="v2-prog-stat">
                    <span className="v2-prog-stat-val v2-prog-stat-val--green">{dlState?.completedCount ?? 0}</span>
                    <span className="v2-prog-stat-lbl">Done</span>
                  </div>
                  <div className="v2-prog-stat">
                    <span className="v2-prog-stat-val">{dlState?.current || 0} / {dlState?.total || 0}</span>
                    <span className="v2-prog-stat-lbl">Tracks</span>
                  </div>
                  <div className="v2-prog-stat">
                    <span className="v2-prog-stat-val v2-prog-stat-val--red">{fmtSecs(dlState?.estimatedSecondsRemaining)}</span>
                    <span className="v2-prog-stat-lbl">ETA</span>
                  </div>
                  <div className="v2-prog-stat">
                    <span className="v2-prog-stat-val">{fmtSecs(elapsedSecs)}</span>
                    <span className="v2-prog-stat-lbl">Elapsed</span>
                  </div>
                  {tracksPerMin && (
                    <div className="v2-prog-stat">
                      <span className="v2-prog-stat-val">{tracksPerMin}</span>
                      <span className="v2-prog-stat-lbl">Tracks/min</span>
                    </div>
                  )}
                  <div className="v2-prog-stat">
                    <span className="v2-prog-stat-val v2-prog-stat-val--red">{dlState?.failedCount || 0}</span>
                    <span className="v2-prog-stat-lbl">Failed</span>
                  </div>
                </div>

                {/* Dots (≤60 tracks) */}
                {allItems.filter((_, i) => selectedItems.has(i)).length <= 60 && (
                  <div className="v2-prog-dots">
                    {allItems.filter((_, i) => selectedItems.has(i)).map((_, i) => {
                      const cur = dlState?.current || 0;
                      const st  = i < cur - 1 ? 'done' : i === cur - 1 ? 'dl' : 'pend';
                      return <div key={i} className={`v2-dot v2-dot--${st}`} />;
                    })}
                  </div>
                )}

                {/* Rolling track list (> 60) */}
                {allItems.filter((_, i) => selectedItems.has(i)).length > 60 && (
                  <div className="v2-dl-list">
                    {allItems.filter((_, i) => selectedItems.has(i)).slice(Math.max(0, (dlState?.current || 1) - 4), (dlState?.current || 0) + 2).map((item, i) => {
                      const absIdx = Math.max(0, (dlState?.current || 1) - 4) + i;
                      const cur    = dlState?.current || 0;
                      const st     = absIdx < cur - 1 ? 'done' : absIdx === cur - 1 ? 'downloading' : 'pending';
                      return (
                        <div key={absIdx} className={`v2-dl-row v2-dl-row--${st}`}>
                          {st === 'downloading' && <Loader2 size={12} className="v2-spin" style={{ color: 'var(--cr)' }} />}
                          {st === 'done'        && <CheckCircle2 size={12} style={{ color: '#4ade80' }} />}
                          {st === 'pending'     && <div className="v2-dl-dot" />}
                          <span className="v2-dl-name">{item.title}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Actions */}
                <div className="v2-prog-actions">
                  <button className="v2-act v2-act--pause" onClick={() => setPaused(p => !p)}>
                    {paused ? <><Play size={13} /> Resume</> : <><Pause size={13} /> Pause</>}
                  </button>
                  <button className="v2-act v2-act--cancel" onClick={cancelDownload}><SquareStop size={13} /> Cancel</button>
                  <button className="v2-act" onClick={() => setShowLog(p => !p)}><Terminal size={13} /> {showLog ? 'Hide' : 'Show'} Log</button>
                  <button className="v2-act" onClick={clearCompleted}><Trash2 size={13} /> Clear Done</button>
                  {paused && <span className="v2-paused-badge">PAUSED</span>}
                </div>

                {/* Log */}
                <AnimatePresence>
                  {showLog && (
                    <motion.div className="v2-log" style={{ overflow: 'hidden' }} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                      <div className="v2-log-header">
                        <div className="v2-log-dots"><div /><div /><div /></div>
                        <span className="v2-log-lbl">yt-dlp stdout</span>
                      </div>
                      <div className="v2-log-body">
                        {logLines.length === 0 && <div className="v2-log-line">Waiting for output…</div>}
                        {logLines.map((l, i) => <div key={i} className="v2-log-line">{l}</div>)}
                        <div ref={logEndRef} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── DONE ── */}
        <AnimatePresence>
          {isDone && (
            <motion.div className="v2-done-wrap" key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={springBounce}>
              <motion.div className={`v2-done-icon${dlState?.cancelled ? ' v2-done-icon--cancel' : ''}`} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={springBounce}>
                {dlState?.cancelled ? <AlertCircle size={36} color="#f87171" /> : <CheckCircle2 size={36} color="#4ade80" />}
              </motion.div>
              <div className="v2-done-title">{dlState?.cancelled ? 'Cancelled' : dlState?.error ? 'Failed' : 'Download Complete!'}</div>
              <div className="v2-done-sub">
                {dlState?.completedCount !== undefined
                  ? `${dlState.completedCount} downloaded · ${dlState.failedCount || 0} failed`
                  : dlState?.error || ''}
              </div>
              {dlState?.zipParts?.length > 0 && (
                <div className="v2-done-parts">
                  {dlState.zipParts.map((p, i) => (
                    <div key={i} className="v2-done-part"><Archive size={13} style={{ color: 'var(--cr)' }} /><span>{p}</span></div>
                  ))}
                </div>
              )}
              <div className="v2-done-actions">
                <button className="v2-act" onClick={openFolder}><FolderOpen size={14} /> Open Folder</button>
                {dlState?.failedCount > 0 && (
                  <motion.button className="v2-act v2-act--retry" onClick={retryFailed} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={springBounce}>
                    <RefreshCw size={14} /> Retry Failed ({dlState.failedCount})
                  </motion.button>
                )}
                <button className="v2-dl-btn" onClick={resetAll}><Layers size={14} /> New Download</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </main>

      {/* ═══ INSPECTOR PANEL ═══ */}
      <AnimatePresence>
        {inspectorItem && (
          <motion.div
            className="v2-inspector"
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 200 }}
          >
            <div className="v2-insp-head">
              <span className="v2-insp-title"><Terminal size={13} style={{ display: 'inline', marginRight: 6, marginBottom: -2 }} />Inspector</span>
              <button className="v2-insp-close" onClick={() => setInspectorItem(null)}><X size={14} /></button>
            </div>
            {(inspectorItem.coverUrl || inspectorItem.thumbnail) && (
              <img src={inspectorItem.coverUrl || inspectorItem.thumbnail} alt="" className="v2-insp-cover" />
            )}
            <div className="v2-insp-track">{inspectorItem.title}</div>
            <div className="v2-insp-artist">{inspectorItem.artist || inspectorItem.channel || 'Unknown'}</div>
            <div className="v2-insp-section">
              <div className="v2-insp-label">Details</div>
              <div className="v2-insp-val">
                SRC: {inspectorItem.metadataSource || 'Unknown'}<br />
                ID: {inspectorItem.id}<br />
                DUR: {fmtDur(inspectorItem.durationMs || inspectorItem.duration * 1000)}<br />
                ~320 kbps
              </div>
            </div>
            <div className="v2-insp-section">
              <div className="v2-insp-label">URL</div>
              <div className="v2-insp-val" style={{ fontSize: '0.63rem', wordBreak: 'break-all' }}>{inspectorItem.url}</div>
            </div>
            <button className="v2-dl-btn" style={{ marginTop: 'auto', fontSize: '0.84rem', minHeight: 38 }} onClick={() => window.open(inspectorItem.url, '_blank')}>
              <ExternalLink size={13} /> Open in Browser
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
