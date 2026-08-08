import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Layers, Music, Download, Loader2, AlertCircle, CheckCircle2,
  Link2, Search, X, FolderOpen, Clock, HardDrive,
  Play, Pause, SquareStop, RefreshCw, Terminal, ChevronDown, ChevronUp,
  Archive, Zap, FileText, LayoutGrid, ListVideo, ExternalLink,
  Activity, Sparkles, Shield, Trash2, Upload,
  Gauge, Headphones, Settings2,
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
    <label className="md3-toggle">
      <div className={`md3-toggle-track${checked ? ' md3-toggle-track--on' : ''}`} onClick={() => onChange(!checked)}>
        <div className="md3-toggle-thumb" />
      </div>
      <span>{label}</span>
    </label>
  );
}

function SegBtn({ active, onClick, children, danger }) {
  return (
    <button className={`md3-seg${active ? ' md3-seg--on' : ''}${danger ? ' md3-seg--fire' : ''}`} onClick={onClick}>
      {children}
    </button>
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
    <div className="md3-root">
      <div className="md3-orb md3-orb-1" />
      <div className="md3-orb md3-orb-2" />

      {/* ═══ LEFT SIDEBAR ═══ */}
      <aside className="md3-sidebar">
        <div className="md3-brand">
          <div className="md3-brand-dot" />
          <span className="md3-brand-name">Mass Downloader</span>
          <span className={`md3-engine-pill${isDownloading ? ' md3-engine-pill--on' : ''}`}>
            {isDownloading ? 'ACTIVE' : 'READY'}
          </span>
        </div>

        <div className="md3-src-tabs">
          {[
            { id: 'spotify',  icon: <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>, label: 'Spotify' },
            { id: 'youtube', icon: <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M21.582 6.186a2.684 2.684 0 00-1.884-1.898C17.983 3.8 12 3.8 12 3.8s-5.983 0-7.698.488A2.684 2.684 0 002.418 6.186C1.94 7.915 1.94 12 1.94 12s0 4.085.478 5.814a2.684 2.684 0 001.884 1.898C5.983 20.2 12 20.2 12 20.2s5.983 0 7.698-.488a2.684 2.684 0 001.884-1.898C22.06 16.085 22.06 12 22.06 12s0-4.085-.478-5.814zM9.913 14.894V9.106l5.244 2.894-5.244 2.894z"/></svg>, label: 'YouTube' },
            { id: 'urllist', icon: <FileText size={13} />, label: 'URL List' },
          ].map(t => (
            <button key={t.id} className={`md3-src-tab${sourceTab === t.id ? ' md3-src-tab--on' : ''}`} onClick={() => setSourceTab(t.id)}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        <div className="md3-src-input-area">
          {sourceTab === 'spotify' && (
            <div className="md3-url-group">
              <div className="md3-url-wrap">
                <Search size={13} className="md3-url-icon" />
                <input className="md3-url-input" value={spotUrl} onChange={e => { setSpotUrl(e.target.value); setSpotError(''); setSpotResult(null); }} onKeyDown={e => e.key === 'Enter' && fetchSpotify()} placeholder="Paste Spotify playlist URL…" />
                {spotUrl && <button className="md3-url-clear" onClick={() => { setSpotUrl(''); setSpotResult(null); setSpotError(''); }}><X size={12} /></button>}
              </div>
              <button className="md3-scan-btn" onClick={fetchSpotify} disabled={spotFetching || !spotUrl.trim()}>
                {spotFetching ? <Loader2 size={13} className="md3-spin" /> : <Search size={13} />} Scan
              </button>
              {spotError && <div className="md3-src-err"><AlertCircle size={12} />{spotError}</div>}
            </div>
          )}
          {sourceTab === 'youtube' && (
            <div className="md3-url-group">
              <div className="md3-url-wrap">
                <Search size={13} className="md3-url-icon" />
                <input className="md3-url-input" value={ytUrl} onChange={e => { setYtUrl(e.target.value); setYtError(''); setYtResult(null); }} onKeyDown={e => e.key === 'Enter' && fetchYoutube()} placeholder="Paste YouTube playlist URL…" />
                {ytUrl && <button className="md3-url-clear" onClick={() => { setYtUrl(''); setYtResult(null); setYtError(''); }}><X size={12} /></button>}
              </div>
              <button className="md3-scan-btn" onClick={fetchYoutube} disabled={ytFetching || !ytUrl.trim()}>
                {ytFetching ? <Loader2 size={13} className="md3-spin" /> : <Search size={13} />} Load
              </button>
              {ytError && <div className="md3-src-err"><AlertCircle size={12} />{ytError}</div>}
            </div>
          )}
          {sourceTab === 'urllist' && (
            <div className="md3-url-group">
              <textarea className="md3-url-textarea" value={urlListText} onChange={e => setUrlListText(e.target.value)} placeholder="Paste URLs one per line…" rows={4} />
              <button className="md3-scan-btn" onClick={resolveUrlList} disabled={urlListResolving || !urlListText.trim()}>
                {urlListResolving ? <Loader2 size={13} className="md3-spin" /> : <Search size={13} />} Resolve
              </button>
              {urlListError && <div className="md3-src-err"><AlertCircle size={12} />{urlListError}</div>}
            </div>
          )}
        </div>

        {/* Settings */}
        <div className="md3-settings-scroll">
          <div className="md3-settings-section">
            <div className="md3-field">
              <label className="md3-field-label"><Headphones size={11} />Format</label>
              <select className="md3-select" value={format} onChange={e => setFormat(e.target.value)}>
                {AUDIO_FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
            <div className="md3-field">
              <label className="md3-field-label"><Gauge size={11} />Parallel Downloads <span className="md3-field-val">{concurrency}</span></label>
              <input type="range" min="1" max="24" value={concurrency} onChange={e => setConcurrency(Number(e.target.value))} className="md3-slider" style={{ '--pct': `${concurrencyPct}%` }} />
            </div>
            <div className="md3-field">
              <label className="md3-field-label">Speed Mode</label>
              <div className="md3-seg-row">
                <SegBtn active={speedMode === 'BALANCED'} onClick={() => setSpeedMode('BALANCED')}>Balanced</SegBtn>
                <SegBtn active={speedMode === 'MAXIMUM'}  onClick={() => setSpeedMode('MAXIMUM')} danger><Zap size={11} />Max</SegBtn>
              </div>
            </div>
            <div className="md3-field">
              <label className="md3-field-label">Output</label>
              <div className="md3-seg-row">
                <SegBtn active={outputMode === 'zip'}    onClick={() => setOutputMode('zip')}><Archive size={11} />ZIP</SegBtn>
                <SegBtn active={outputMode === 'folder'} onClick={() => setOutputMode('folder')}><FolderOpen size={11} />Folder</SegBtn>
              </div>
            </div>
            <div className="md3-toggles-grid">
              <ToggleSwitch checked={embedMetadata} onChange={setEmbedMetadata} label="Tags" />
              <ToggleSwitch checked={embedLyrics}   onChange={setEmbedLyrics}   label="Lyrics" />
              <ToggleSwitch checked={skipExisting}  onChange={setSkipExisting}  label="Skip Existing" />
              <ToggleSwitch checked={autoRetry}     onChange={setAutoRetry}     label="Auto Retry" />
            </div>

            <button className="md3-adv-toggle" onClick={() => setAdvancedMode(!advancedMode)}>
              <Settings2 size={12} />Advanced Settings
              {advancedMode ? <ChevronUp size={12} style={{ marginLeft: 'auto' }} /> : <ChevronDown size={12} style={{ marginLeft: 'auto' }} />}
            </button>

            <AnimatePresence>
              {advancedMode && (
                <motion.div className="md3-adv-panel" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
                  <div className="md3-adv-inner">
                    <div className="md3-field">
                      <label className="md3-field-label">Folder / ZIP Name</label>
                      <input className="md3-input" value={folderName} onChange={e => setFolderName(e.target.value)} placeholder="Playlist name" />
                    </div>
                    <div className="md3-field">
                      <label className="md3-field-label">File Structure</label>
                      <select className="md3-select" value={outputStructure} onChange={e => setOutputStructure(e.target.value)}>
                        <option value="flat">Flat Folder</option>
                        <option value="artist_album">Artist / Album</option>
                      </select>
                    </div>
                    <div className="md3-field">
                      <label className="md3-field-label">Codec Priority</label>
                      <select className="md3-select" value={audioCodecPriority} onChange={e => setAudioCodecPriority(e.target.value)}>
                        <option value="quality">Highest Quality</option>
                        <option value="compatibility">Compatibility</option>
                        <option value="lossless">Lossless</option>
                      </select>
                    </div>
                    <div className="md3-field">
                      <label className="md3-field-label">Speed Limit</label>
                      <select className="md3-select" value={speedLimit} onChange={e => setSpeedLimit(e.target.value)}>
                        <option value="0">No Limit</option>
                        <option value="500K">500 KB/s</option>
                        <option value="1M">1 MB/s</option>
                        <option value="5M">5 MB/s</option>
                        <option value="10M">10 MB/s</option>
                      </select>
                    </div>
                    <div className="md3-toggles-grid">
                      <ToggleSwitch checked={volumeNorm}     onChange={setVolumeNorm}     label="Vol Normalize" />
                      <ToggleSwitch checked={trimSilence}    onChange={setTrimSilence}    label="Trim Silence" />
                      <ToggleSwitch checked={generateNFO}    onChange={setGenerateNFO}    label=".NFO Files" />
                      <ToggleSwitch checked={exportLRC}      onChange={setExportLRC}      label=".LRC Lyrics" />
                      <ToggleSwitch checked={bandwidthSaver} onChange={setBandwidthSaver} label="Bw Saver" />
                    </div>
                    <div className="md3-field">
                      <label className="md3-field-label">File Naming Template</label>
                      <div className="md3-token-row">
                        {NAMING_TOKENS.map(tok => (
                          <button key={tok} className="md3-token" onClick={() => setNamingTpl(p => p + tok)}>{tok}</button>
                        ))}
                      </div>
                      <input className="md3-input md3-input--mono" value={namingTpl} onChange={e => setNamingTpl(e.target.value)} />
                      <div className="md3-naming-preview"><FileText size={10} />{namingPreview}</div>
                    </div>
                    {outputMode === 'zip' && (
                      <div className="md3-field">
                        <label className="md3-field-label">Split ZIP every</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input type="checkbox" checked={splitEnabled} onChange={e => setSplitEnabled(e.target.checked)} />
                          <input className="md3-input" style={{ width: 70 }} type="number" min="50" max="500" step="50" value={splitEvery} onChange={e => setSplitEvery(Number(e.target.value))} disabled={!splitEnabled} />
                          <span style={{ fontSize: 11, color: 'rgba(245,243,255,0.4)' }}>tracks</span>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </aside>

      {/* ═══ RIGHT MAIN ═══ */}
      <main className="md3-main">

        {/* ZERO STATE */}
        <AnimatePresence>
          {allItems.length === 0 && !isDownloading && !isDone && (
            <motion.div className="md3-zero" key="zero" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={springBounce}>
              <div className="md3-zero-glow" />
              <div className="md3-zero-ring-wrap">
                <div className="md3-zero-ring" />
                <Activity size={44} className="md3-zero-icon" />
              </div>
              <h2 className="md3-zero-title">Ready to Download</h2>
              <p className="md3-zero-sub">Paste a Spotify or YouTube playlist URL in the sidebar to get started.</p>

            </motion.div>
          )}
        </AnimatePresence>

        {/* TRACK LIST */}
        <AnimatePresence>
          {allItems.length > 0 && !isDownloading && !isDone && (
            <motion.div className="md3-tracklist-wrap" key="tl" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring}>

              {/* Playlist strip */}
              <div className="md3-pl-strip">
                <div className="md3-pl-art">
                  {(spotResult?.playlistCover || ytResult?.items?.[0]?.thumbnail) ? (
                    <img src={spotResult?.playlistCover || ytResult?.items?.[0]?.thumbnail} alt="" className="md3-pl-cover" />
                  ) : (
                    <div className="md3-pl-cover-ph"><Music size={20} /></div>
                  )}
                </div>
                <div className="md3-pl-info">
                  <div className="md3-pl-name">{spotResult?.playlistName || ytResult?.title || 'URL Batch'}</div>
                  {spotResult?.owner && <div className="md3-pl-owner">by {spotResult.owner}</div>}
                  <div className="md3-pl-pills">
                    <span className="md3-pill"><Music size={10} />{allItems.length} tracks</span>
                    {totalDurationMs > 0 && <span className="md3-pill"><Clock size={10} />{fmtDur(totalDurationMs)}</span>}
                    <span className="md3-pill"><HardDrive size={10} />{fmtSize(totalDurationMs, format)}</span>
                    {dupCount > 0 && <span className="md3-pill md3-pill--warn">⚠ {dupCount} dups</span>}
                    {dupCount === 0 && <span className="md3-pill md3-pill--ok">✓ No dupes</span>}
                    {sourceTab === 'spotify' && spotResult && metaCounts.spotify > 0 && <span className="md3-pill" style={{ color: '#1DB954' }}>SPT {metaCounts.spotify}</span>}
                    {sourceTab === 'spotify' && spotResult && metaCounts.itunes  > 0 && <span className="md3-pill" style={{ color: '#fb923c' }}>AMS {metaCounts.itunes}</span>}
                    {sourceTab === 'spotify' && spotResult && metaCounts.youtube > 0 && <span className="md3-pill" style={{ color: '#f87171' }}>YTM {metaCounts.youtube}</span>}
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="md3-tl-controls">
                <div className="md3-search-wrap">
                  <Search size={13} className="md3-search-icon" />
                  <input className="md3-search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter tracks…" />
                  {filter && <button className="md3-search-x" onClick={() => setFilter('')}><X size={11} /></button>}
                </div>
                <select className="md3-sort" value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
                  <option value="default">Default</option>
                  <option value="az">A → Z</option>
                  <option value="za">Z → A</option>
                </select>
                <button className="md3-ctrl-btn" onClick={() => setGridView(!gridView)}>
                  {gridView ? <ListVideo size={13} /> : <LayoutGrid size={13} />}
                </button>
                <div className="md3-ctrl-sep" />
                <button className="md3-ctrl-btn" onClick={selectAll}>All</button>
                <button className="md3-ctrl-btn" onClick={deselectAll}>None</button>
                {dupCount > 0 && <motion.button className="md3-ctrl-btn md3-ctrl-btn--danger" onClick={removeDups} initial={{ scale: 0 }} animate={{ scale: 1 }}><Trash2 size={12} />Rm Dups</motion.button>}
                <button className="md3-ctrl-btn" onClick={exportUrls}><Upload size={12} />Export</button>
                <span className="md3-tl-count">{selectedCount} / {allItems.length}</span>
              </div>

              {/* Track table */}
              <div className={`md3-tracks${gridView ? ' md3-tracks--grid' : ''}`}>
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
                        className={['md3-track', isSelected ? 'md3-track--sel' : '', isDup ? 'md3-track--dup' : '', tStatus === 'downloading' ? 'md3-track--dl' : '', tStatus === 'done' ? 'md3-track--done' : '', tStatus === 'failed' ? 'md3-track--fail' : ''].filter(Boolean).join(' ')}
                        onClick={() => toggleItem(realIdx)}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ ...spring, delay: Math.min(visIdx * 0.008, 0.24) }}
                      >
                        <div className={`md3-chk${isSelected ? ' md3-chk--on' : ''}`}>
                          {isSelected && <CheckCircle2 size={11} color="white" />}
                        </div>
                        <span className="md3-track-num">{String(realIdx + 1).padStart(2, '0')}</span>
                        {item.thumbnail || item.coverUrl ? (
                          <img src={item.thumbnail || item.coverUrl} alt="" className="md3-thumb" />
                        ) : (
                          <div className="md3-thumb-ph"><Music size={12} /></div>
                        )}
                        <div className="md3-track-info">
                          <div className="md3-track-title">{item.title}</div>
                          <div className="md3-track-artist">{item.artist || item.channel || ''}</div>
                        </div>
                        <span className="md3-track-dur">{fmtDur(item.durationMs || item.duration * 1000)}</span>
                        {item.metadataSource && (
                          <span className={`md3-mbadge md3-mbadge--${item.metadataSource === 'spotify' || item.metadataSource === 'spotify-public' ? 'spt' : item.metadataSource === 'itunes' ? 'ams' : 'ytm'}`}>
                            {item.metadataSource === 'spotify' || item.metadataSource === 'spotify-public' ? 'SPT' : item.metadataSource === 'itunes' ? 'AMS' : 'YTM'}
                          </span>
                        )}
                        {isDup && <span className="md3-mbadge md3-mbadge--dup">DUP</span>}
                        {hasPreview && (
                          <motion.button className={`md3-prev-btn${previewingIdx === realIdx ? ' md3-prev-btn--on' : ''}`} onClick={e => { e.stopPropagation(); togglePreview(realIdx, item.preview_url); }} whileTap={{ scale: 0.86 }}>
                            {previewingIdx === realIdx ? <Pause size={10} /> : <Play size={10} />}
                          </motion.button>
                        )}
                        <button className="md3-insp-btn" onClick={e => { e.stopPropagation(); setInspectorItem(item); }} title="Inspect">
                          <Terminal size={11} />
                        </button>
                        {tStatus === 'downloading' && <div className="md3-dl-bar"><div className="md3-dl-bar-fill" /></div>}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>

              {/* Sticky CTA */}
              <div className="md3-cta-bar">
                <div className="md3-cta-info">
                  <span className="md3-cta-count">{selectedCount} tracks selected</span>
                  {totalDurationMs > 0 && <span className="md3-cta-meta">{fmtDur(totalDurationMs)} · {fmtSize(totalDurationMs, format)}</span>}
                </div>
                <motion.button className="md3-dl-btn" onClick={startDownload} disabled={selectedCount === 0} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} transition={spring}>
                  <Download size={15} />Download {selectedCount} track{selectedCount !== 1 ? 's' : ''}
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* PROGRESS */}
        <AnimatePresence>
          {isDownloading && (
            <motion.div className="md3-prog-wrap" key="prog" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring}>
              <div className="md3-prog-bar-track">
                <div className="md3-prog-bar-fill" style={{ width: `${dlState?.percent || 0}%` }}>
                  <div className="md3-prog-shimmer" />
                </div>
              </div>
              <div className="md3-prog-now">
                {dlState?.coverUrl ? (
                  <img src={dlState.coverUrl} alt="" className="md3-prog-art" />
                ) : (
                  <div className="md3-prog-art-ph"><Music size={18} /></div>
                )}
                <div className="md3-prog-info">
                  <div className="md3-prog-label">Now Downloading</div>
                  <div className="md3-prog-track">{dlState?.title || 'Preparing…'}</div>
                  <div className="md3-prog-artist">{dlState?.artist || ''}</div>
                </div>
                <div className="md3-prog-pct">{dlState?.percent || 0}%</div>
              </div>
              <div className="md3-prog-stats">
                {[
                  { label: 'Done',    val: dlState?.completedCount ?? 0,                       color: '#4ade80' },
                  { label: 'Tracks',  val: `${dlState?.current || 0} / ${dlState?.total || 0}`, color: null },
                  { label: 'ETA',     val: fmtSecs(dlState?.estimatedSecondsRemaining),         color: 'var(--cr)' },
                  { label: 'Elapsed', val: fmtSecs(elapsedSecs),                                color: null },
                  ...(tracksPerMin ? [{ label: 'Trk/min', val: tracksPerMin, color: null }] : []),
                  { label: 'Failed',  val: dlState?.failedCount || 0,                           color: '#f87171' },
                ].map((s, i) => (
                  <div key={i} className="md3-prog-stat">
                    <span className="md3-prog-stat-val" style={s.color ? { color: s.color } : {}}>{s.val}</span>
                    <span className="md3-prog-stat-lbl">{s.label}</span>
                  </div>
                ))}
              </div>
              {allItems.filter((_, i) => selectedItems.has(i)).length <= 60 && (
                <div className="md3-prog-dots">
                  {allItems.filter((_, i) => selectedItems.has(i)).map((_, i) => {
                    const cur = dlState?.current || 0;
                    const st  = i < cur - 1 ? 'done' : i === cur - 1 ? 'dl' : 'pend';
                    return <div key={i} className={`md3-dot md3-dot--${st}`} />;
                  })}
                </div>
              )}
              {allItems.filter((_, i) => selectedItems.has(i)).length > 60 && (
                <div className="md3-dl-list">
                  {allItems.filter((_, i) => selectedItems.has(i)).slice(Math.max(0, (dlState?.current || 1) - 4), (dlState?.current || 0) + 2).map((item, i) => {
                    const absIdx = Math.max(0, (dlState?.current || 1) - 4) + i;
                    const cur    = dlState?.current || 0;
                    const st     = absIdx < cur - 1 ? 'done' : absIdx === cur - 1 ? 'downloading' : 'pending';
                    return (
                      <div key={absIdx} className={`md3-dl-row md3-dl-row--${st}`}>
                        {st === 'downloading' && <Loader2 size={12} className="md3-spin" style={{ color: 'var(--cr)' }} />}
                        {st === 'done'        && <CheckCircle2 size={12} style={{ color: '#4ade80' }} />}
                        {st === 'pending'     && <div className="md3-dl-dot" />}
                        <span className="md3-dl-name">{item.title}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="md3-prog-actions">
                <button className="md3-act md3-act--pause" onClick={() => setPaused(p => !p)}>
                  {paused ? <><Play size={13} />Resume</> : <><Pause size={13} />Pause</>}
                </button>
                <button className="md3-act md3-act--cancel" onClick={cancelDownload}><SquareStop size={13} />Cancel</button>
                <button className="md3-act" onClick={() => setShowLog(p => !p)}><Terminal size={13} />{showLog ? 'Hide' : 'Show'} Log</button>
                <button className="md3-act" onClick={clearCompleted}><Trash2 size={13} />Clear Done</button>
                {paused && <span className="md3-paused-badge">PAUSED</span>}
              </div>
              <AnimatePresence>
                {showLog && (
                  <motion.div className="md3-log" style={{ overflow: 'hidden' }} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                    <div className="md3-log-header">
                      <div className="md3-log-dots"><div /><div /><div /></div>
                      <span className="md3-log-lbl">yt-dlp stdout</span>
                    </div>
                    <div className="md3-log-body">
                      {logLines.length === 0 && <div className="md3-log-line">Waiting for output…</div>}
                      {logLines.map((l, i) => <div key={i} className="md3-log-line">{l}</div>)}
                      <div ref={logEndRef} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {/* DONE */}
        <AnimatePresence>
          {isDone && (
            <motion.div className="md3-done-wrap" key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={springBounce}>
              <motion.div className={`md3-done-icon${dlState?.cancelled ? ' md3-done-icon--cancel' : ''}`} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={springBounce}>
                {dlState?.cancelled ? <AlertCircle size={40} color="#f87171" /> : <CheckCircle2 size={40} color="#4ade80" />}
              </motion.div>
              <div className="md3-done-title">{dlState?.cancelled ? 'Cancelled' : dlState?.error ? 'Failed' : 'Download Complete!'}</div>
              <div className="md3-done-sub">
                {dlState?.completedCount !== undefined
                  ? `${dlState.completedCount} downloaded · ${dlState.failedCount || 0} failed`
                  : dlState?.error || ''}
              </div>
              {dlState?.zipParts?.length > 0 && (
                <div className="md3-done-parts">
                  {dlState.zipParts.map((p, i) => (
                    <div key={i} className="md3-done-part"><Archive size={13} style={{ color: 'var(--cr)' }} /><span>{p}</span></div>
                  ))}
                </div>
              )}
              <div className="md3-done-actions">
                <button className="md3-act" onClick={openFolder}><FolderOpen size={14} />Open Folder</button>
                {dlState?.failedCount > 0 && (
                  <motion.button className="md3-act md3-act--retry" onClick={retryFailed} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={springBounce}>
                    <RefreshCw size={14} />Retry Failed ({dlState.failedCount})
                  </motion.button>
                )}
                <button className="md3-dl-btn" onClick={resetAll}><Layers size={14} />New Download</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* INSPECTOR */}
      <AnimatePresence>
        {inspectorItem && (
          <motion.div className="md3-inspector" initial={{ x: '100%', opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '100%', opacity: 0 }} transition={{ type: 'spring', damping: 26, stiffness: 200 }}>
            <div className="md3-insp-head">
              <span className="md3-insp-title"><Terminal size={13} style={{ display: 'inline', marginRight: 6, marginBottom: -2 }} />Inspector</span>
              <button className="md3-insp-close" onClick={() => setInspectorItem(null)}><X size={14} /></button>
            </div>
            {(inspectorItem.coverUrl || inspectorItem.thumbnail) && (
              <img src={inspectorItem.coverUrl || inspectorItem.thumbnail} alt="" className="md3-insp-cover" />
            )}
            <div className="md3-insp-track">{inspectorItem.title}</div>
            <div className="md3-insp-artist">{inspectorItem.artist || inspectorItem.channel || 'Unknown'}</div>
            <div className="md3-insp-section">
              <div className="md3-insp-label">Details</div>
              <div className="md3-insp-val">
                SRC: {inspectorItem.metadataSource || 'Unknown'}<br />
                ID: {inspectorItem.id}<br />
                DUR: {fmtDur(inspectorItem.durationMs || inspectorItem.duration * 1000)}<br />
                ~320 kbps
              </div>
            </div>
            <div className="md3-insp-section">
              <div className="md3-insp-label">URL</div>
              <div className="md3-insp-val" style={{ fontSize: '0.63rem', wordBreak: 'break-all' }}>{inspectorItem.url}</div>
            </div>
            <button className="md3-dl-btn" style={{ marginTop: 'auto', fontSize: '0.84rem', minHeight: 38 }} onClick={() => window.open(inspectorItem.url, '_blank')}>
              <ExternalLink size={13} />Open in Browser
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}