import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download, Film, Loader2, AlertCircle, CheckCircle2,
  Zap, Clock, MonitorPlay, Headphones, Link2, RefreshCw, Save, ListVideo, Music, Pause, Play, XCircle, HardDrive, Activity, Cpu, ArrowLeft, CalendarClock, FolderOpen
} from 'lucide-react';
import './YoutubeDownloader.css';

const RESOLUTIONS = [
  { id: '4k', label: '4K', sub: '2160p', minH: 2160, format: 'bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/best[height<=2160]' },
  { id: '1440p', label: '2K', sub: '1440p', minH: 1440, format: 'bestvideo[height<=1440][ext=mp4]+bestaudio[ext=m4a]/best[height<=1440]' },
  { id: '1080p', label: '1080p', sub: 'Full HD', minH: 1080, format: 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]' },
  { id: '720p', label: '720p', sub: 'HD', minH: 720, format: 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]' },
  { id: '480p', label: '480p', sub: 'SD', minH: 480, format: 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]' },
  { id: '360p', label: '360p', sub: 'Low', minH: 360, format: 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]' },
];

const AUDIO_FORMATS = [
  { id: 'mp3_320', label: '320kbps MP3', sub: 'Cea mai bună', quality: '0', audioFmt: 'mp3' },
  { id: 'mp3_192', label: '192kbps MP3', sub: 'Standard', quality: '5', audioFmt: 'mp3' },
  { id: 'mp3_128', label: '128kbps MP3', sub: 'Compresat', quality: '9', audioFmt: 'mp3' },
  { id: 'ogg', label: 'OGG Vorbis', sub: 'Format deschis', quality: '0', audioFmt: 'vorbis' },
  { id: 'wav', label: 'WAV', sub: 'Fără pierderi', quality: '0', audioFmt: 'wav' },
];

// ── Clickable Suggestion Chips ──────────────────────────────────────────────
const SUGGESTIONS = [
  // Popular music
  { label: 'Bohemian Rhapsody', url: 'https://www.youtube.com/watch?v=fJ9rUzIMcZQ', tag: 'Music', color: '#a855f7' },
  { label: 'Blinding Lights', url: 'https://www.youtube.com/watch?v=4NRXx6U8ABQ', tag: 'Music', color: '#a855f7' },
  { label: 'Shape of You', url: 'https://www.youtube.com/watch?v=JGwWNGJdvx8', tag: 'Music', color: '#a855f7' },
  { label: 'Stairway to Heaven', url: 'https://www.youtube.com/watch?v=QkF3oxziUI4', tag: 'Music', color: '#a855f7' },
  { label: 'Hotel California', url: 'https://www.youtube.com/watch?v=BciS5krYL80', tag: 'Music', color: '#a855f7' },
  { label: 'Smells Like Teen Spirit', url: 'https://www.youtube.com/watch?v=hTWKbfoikeg', tag: 'Music', color: '#a855f7' },
  { label: 'Lose Yourself', url: 'https://www.youtube.com/watch?v=_Yhyp-_hX2s', tag: 'Rap', color: '#f59e0b' },
  { label: 'HUMBLE. - Kendrick Lamar', url: 'https://www.youtube.com/watch?v=tvTRZJ-4EyI', tag: 'Rap', color: '#f59e0b' },
  // Popular videos
  { label: 'Gangnam Style', url: 'https://www.youtube.com/watch?v=9bZkp7q19f0', tag: 'Viral', color: '#ef4444' },
  { label: 'Baby Shark', url: 'https://www.youtube.com/watch?v=XqZsoesa55w', tag: 'Viral', color: '#ef4444' },
  { label: 'Despacito', url: 'https://www.youtube.com/watch?v=kTJczUoc26U', tag: 'Music', color: '#a855f7' },
  // Playlists
  { label: 'Lo-Fi Hip Hop Playlist', url: 'https://www.youtube.com/playlist?list=PLofht4PTcKYnaH8w5olJCI-pPmIBOOFAy', tag: 'Playlist', color: '#10b981' },
  { label: 'Top 50 Global', url: 'https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI', tag: 'Playlist', color: '#10b981' },
  // Podcasts / long form
  { label: 'Joe Rogan #2228', url: 'https://www.youtube.com/watch?v=3dg9CgjBXSc', tag: 'Podcast', color: '#3b82f6' },
  { label: 'Lex Fridman - Elon Musk', url: 'https://www.youtube.com/watch?v=DxREm3s1scA', tag: 'Podcast', color: '#3b82f6' },
  // Tutorials
  { label: 'Learn React in 1 Hour', url: 'https://www.youtube.com/watch?v=SqcY0GlETPk', tag: 'Tutorial', color: '#06b6d4' },
  { label: 'Python Full Course', url: 'https://www.youtube.com/watch?v=eWRfhZUzrAc', tag: 'Tutorial', color: '#06b6d4' },
  { label: 'Git & GitHub Crash Course', url: 'https://www.youtube.com/watch?v=RGOj5yH7evk', tag: 'Tutorial', color: '#06b6d4' },
  // YouTube Music
  { label: 'Eminem – Without Me', url: 'https://music.youtube.com/watch?v=YVkUvmDQ3HY', tag: 'YT Music', color: '#ec4899' },
  { label: 'Arctic Monkeys – R U Mine?', url: 'https://music.youtube.com/watch?v=f1gkGmOQJPE', tag: 'YT Music', color: '#ec4899' },
  { label: 'Daft Punk – Get Lucky', url: 'https://music.youtube.com/watch?v=5NV6Rdv1a3I', tag: 'YT Music', color: '#ec4899' },
];

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(secs) {
  if (!secs) return '--:--';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatViews(n) {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M vizionări`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K vizionări`;
  return `${n} vizionări`;
}

function isPlaylistUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.searchParams.has('list') || parsed.pathname.split('/').includes('playlist');
  } catch {
    return false;
  }
}

function isMusicUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.hostname === 'music.youtube.com';
  } catch {
    return false;
  }
}

function generateJobId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

const YoutubeDownloader = ({ activeJobId }) => {
  const [url, setUrl] = useState('');
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('ytdl_history');
      if (saved) setHistory(JSON.parse(saved));
    } catch {}
  }, []);

  const saveToHistory = (newUrl, title, thumbnail) => {
    if (!newUrl) return;
    setHistory(prev => {
      const filtered = prev.filter(item => item.url !== newUrl);
      const updated = [{ url: newUrl, title: title || newUrl, thumbnail, date: Date.now() }, ...filtered].slice(0, 10);
      localStorage.setItem('ytdl_history', JSON.stringify(updated));
      return updated;
    });
  };
  const [info, setInfo] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [error, setError] = useState(null);

  const [mediaType, setMediaType] = useState('video');
  const [selectedRes, setSelectedRes] = useState('1080p');
  const [selectedAudio, setSelectedAudio] = useState('mp3_320');

  const [selectedTracks, setSelectedTracks] = useState(new Set());

  const [downloading, setDownloading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState(0);
  const [downloadComplete, setDownloadComplete] = useState(false);
  const [finalFilename, setFinalFilename] = useState('');
  const [outputName, setOutputName] = useState('');
  const [downloadFormat, setDownloadFormat] = useState('video');
  const [downloadSourceMode, setDownloadSourceMode] = useState('standard');

  useEffect(() => {
    if (activeJobId && !downloading) {
      setCurrentJobId(activeJobId);
      reconnectToJob(activeJobId);
    }
  }, [activeJobId]);

  const [downloadScope, setDownloadScope] = useState('single');
  const [downloadStatus, setDownloadStatus] = useState('');
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [pendingScope, setPendingScope] = useState('single');
  const [currentJobId, setCurrentJobId] = useState(null);
  const [clipboardToast, setClipboardToast] = useState(false);

  const eventSourceRef = useRef(null);
  const [systemStatus, setSystemStatus] = useState(null);
  const [customPath, setCustomPath] = useState('');

  const [appMode, setAppMode] = useState(null);
  const [scheduleTime, setScheduleTime] = useState('');

  useEffect(() => {
    fetch('/api/ytdl/get-config').then(r => r.json()).then(data => {
      if (data.customPath) setCustomPath(data.customPath);
    }).catch(() => { });
  }, []);

  // Smart Clipboard Auto-Detect
  useEffect(() => {
    const handleFocus = async () => {
      if (downloading || downloadComplete || info || !appMode) return;
      try {
        const text = await navigator.clipboard.readText();
        if (text && isYouTubeUrl(text) && text !== url) {
          setUrl(text);
          setClipboardToast(true);
          setTimeout(() => setClipboardToast(false), 3000);
        }
      } catch (err) {
        // Ignore if clipboard access is denied or unavailable
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [url, downloading, downloadComplete, info, appMode]);



  const handleOpenFolder = async (target = '') => {
    try {
      const res = await fetch(`/api/ytdl/open-folder?target=${encodeURIComponent(target)}`);
      if (!res.ok) {
        alert("Eroare: Fișierul nu a fost găsit. A fost mutat sau șters?");
      }
    } catch (e) {
      alert("Eroare la deschiderea folderului.");
    }
  };

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/ytdl/system-status');
        if (res.ok) setSystemStatus(await res.json());
      } catch (e) { }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const savedJobId = localStorage.getItem('ytdl_job_id');
    const savedScope = localStorage.getItem('ytdl_job_scope');

    if (savedJobId) {
      const savedUrl = localStorage.getItem('ytdl_url');
      const savedInfo = localStorage.getItem('ytdl_info');
      if (savedUrl) setUrl(savedUrl);
      if (savedInfo) {
        try {
          const parsedInfo = JSON.parse(savedInfo);
          setInfo(parsedInfo);
          let safeName = (parsedInfo.title || 'video').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 60);
          if (parsedInfo.playlist) {
            const allIndices = new Set(parsedInfo.playlist.entries.map(e => e.index));
            setSelectedTracks(allIndices);
            if (parsedInfo.playlist.title) {
              safeName = parsedInfo.playlist.title.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 60);
            }
          }
          setOutputName(safeName);
        } catch (e) { }
      }

      setDownloadScope(savedScope || 'single');
      setCurrentJobId(savedJobId);
      reconnectToJob(savedJobId);
    }
  }, []);

  const reconnectToJob = (jobId) => {
    setDownloading(true);
    setStep(1);
    setDownloadStatus('Se reia conexiunea cu serverul...');

    if (eventSourceRef.current) eventSourceRef.current.close();

    const eventSource = new EventSource(`/api/ytdl/job-status?jobId=${jobId}`);
    eventSourceRef.current = eventSource;

    setupEventSourceHandlers(eventSource, jobId);
  };

  const setupEventSourceHandlers = (eventSource, jobId) => {
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.progress !== undefined) {
          setProgress(data.progress);
          if (data.progress > 0 && data.progress < 95) setStep(2);
        }
        if (data.status) {
          setDownloadStatus(data.status);
          if (data.status.includes('arhiv')) setStep(3);
        }
        if (data.isPaused !== undefined) {
          setIsPaused(data.isPaused);
        }
        if (data.currentItem && data.totalItems) {
          setDownloadStatus(`Se descarcă videoclipul ${data.currentItem} din ${data.totalItems}`);
        }
        if (data.raw && data.raw.includes('Merging formats')) {
          setStep(3);
          setDownloadStatus('Se asamblează fișierul final...');
        }
        if (data.error) {
          eventSource.close();
          setDownloading(false);
          setError(data.error);
          setStep(0);
          setCurrentJobId(null);
          localStorage.removeItem('ytdl_job_id');
          localStorage.removeItem('ytdl_job_scope');
          return;
        }
        if (data.done) {
          eventSource.close();
          setDownloading(false);
          setDownloadComplete(true);
          setStep(4);
          setCurrentJobId(null);
          localStorage.removeItem('ytdl_job_id');
          localStorage.removeItem('ytdl_job_scope');

          if (data.finalFilename) {
            setFinalFilename(data.finalFilename);
          }
        }
      } catch (e) {
        console.error('Failed to parse event data:', e);
      }
    };

    eventSource.onerror = () => {
      console.warn('EventSource connection lost.');
      eventSource.close();
      setDownloading(false);
      setError('Conexiunea cu serverul a fost pierdută.');
      setStep(0);
    };
  };

  const fetchInfo = async () => {
    if (!url) return;
    setLoadingInfo(true);
    setError(null);
    setInfo(null);
    setDownloadComplete(false);
    setProgress(0);
    setStep(0);

    if (isMusicUrl(url)) {
      setMediaType('audio');
      setDownloadFormat('audio');
      setDownloadSourceMode('standard');
    } else {
      setMediaType('video');
      setDownloadSourceMode('standard');
    }

    try {
      const res = await fetch(`/api/ytdl/info?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch info');

      let playlist = null;
      if (isPlaylistUrl(url)) {
        const playlistRes = await fetch('/api/ytdl/collection-info?url=' + encodeURIComponent(url));
        if (playlistRes.ok) {
          playlist = await playlistRes.json();
          const allIndices = new Set(playlist.entries.map(e => e.index));
          setSelectedTracks(allIndices);
        }
      }
      setInfo({ ...data, playlist });
      saveToHistory(url, playlist ? playlist.title : data.title, data.thumbnail);
      localStorage.setItem('ytdl_url', url);
      localStorage.setItem('ytdl_info', JSON.stringify({ ...data, playlist }));
      const safeName = (data.title || 'video').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 60);
      setOutputName(safeName);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingInfo(false);
    }
  };

  const openDownloadModal = (scope = 'single') => {
    setPendingScope(scope);
    setShowOptionsModal(true);
  };

  const toggleTrack = (index) => {
    const newSet = new Set(selectedTracks);
    if (newSet.has(index)) newSet.delete(index);
    else newSet.add(index);
    setSelectedTracks(newSet);
  };

  const selectAllTracks = () => {
    if (!info?.playlist) return;
    setSelectedTracks(new Set(info.playlist.entries.map(e => e.index)));
  };

  const deselectAllTracks = () => {
    setSelectedTracks(new Set());
  };

  const handleDownload = async (scope, computedFormat) => {
    setDownloading(true);
    setDownloadComplete(false);
    setDownloadStatus('Se conectează la server...');
    setStep(1);
    setError(null);
    setDownloadScope(scope);

    const formatToUse = computedFormat || downloadFormat;

    try {
      let jobId;
      if (downloadSourceMode === 'smart') {
        let items = [];
        if (scope === 'single') {
          items.push(`ytsearch1:${info.uploader || ''} ${info.title} official audio`);
        } else {
          const selectedEntries = info.playlist.entries.filter(e => selectedTracks.has(e.index));
          items = selectedEntries.map(e => `ytsearch1:${e.uploader || ''} ${e.title} official audio`);
        }

        const res = await fetch('/api/ytdl/smart-download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: info.url || url,
            items,
            format: mediaType,
            scope,
            title: info.title,
            thumbnail: info.thumbnail,
            formatStr: computedFormat || downloadFormat,
            scheduleTime: scheduleTime || null,
            preset: localStorage.getItem('download_preset') || 'AUTO',
            hwaccel: localStorage.getItem('hardware_acceleration') || 'NONE'
          })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Server error');

        if (data.scheduled) {
          setDownloading(false);
          setDownloadComplete(true);
          setFinalFilename(`[Programat la ${scheduleTime}]`);
          return;
        }
        jobId = data.jobId;
      } else {
        const endpoint = scope === 'playlist' ? '/api/ytdl/collection-download' : '/api/ytdl/download';
        const queryParams = new URLSearchParams({
          url: info.url || url,
          format: formatToUse,
          title: info.title || '',
          thumbnail: info.thumbnail || '',
          jobId: Date.now().toString(),
          preset: localStorage.getItem('download_preset') || 'AUTO',
          hwaccel: localStorage.getItem('hardware_acceleration') || 'NONE'
        });
        if (scope === 'playlist') {
          queryParams.append('selectedItems', Array.from(selectedTracks).sort((a, b) => a - b).join(','));
        }
        if (scheduleTime) {
          queryParams.append('scheduleTime', scheduleTime);
        }
        jobId = queryParams.get('jobId');

        const res = await fetch(`${endpoint}?${queryParams.toString()}`);
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const data = await res.json();
          if (data.scheduled) {
            setDownloading(false);
            setDownloadComplete(true);
            setFinalFilename(`[Programat la ${scheduleTime}]`);
            return;
          }
        }
      }

      setCurrentJobId(jobId);
      localStorage.setItem('ytdl_job_id', jobId);
      localStorage.setItem('ytdl_job_scope', scope);
      reconnectToJob(jobId);
    } catch (err) {
      setError(err.message);
      setDownloading(false);
      setStep(0);
    }
  };

  const startDownload = () => {
    if (pendingScope === 'playlist' && selectedTracks.size === 0) {
      alert("Te rog selectează cel puțin o melodie.");
      return;
    }

    setShowOptionsModal(false);
    if (!url) return;

    setDownloadStatus(pendingScope === 'playlist' ? 'Se pregătește playlistul...' : 'Se pregătește descărcarea...');

    if (pendingScope === 'playlist' && info?.playlist?.title) {
      setOutputName(info.playlist.title.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 60) || 'youtube_playlist');
    }

    let formatStr;
    if (mediaType === 'audio') {
      const af = AUDIO_FORMATS.find(a => a.id === selectedAudio) || AUDIO_FORMATS[0];
      formatStr = `audio:${af.audioFmt}:${af.quality}`;
    } else {
      const resOpt = RESOLUTIONS.find(r => r.id === selectedRes) || RESOLUTIONS[2];
      formatStr = `video:${resOpt.format}`;
    }
    setDownloadFormat(formatStr);

    handleDownload(pendingScope, formatStr);
  };

  const handleJobAction = async (action) => {
    if (!currentJobId) return;
    try {
      await fetch(`/api/ytdl/job-action?jobId=${currentJobId}&action=${action}`);
      if (action === 'cancel') {
        if (eventSourceRef.current) eventSourceRef.current.close();
        handleReset();
      }
    } catch (err) {
      console.error(`Failed to ${action} job`, err);
    }
  };

  const handleReset = () => {
    if (downloading && !currentJobId) {
      if (!confirm("Ești sigur că vrei să anulezi descărcarea curentă?")) return;
    }
    setInfo(null);
    setUrl('');
    setDownloadComplete(false);
    setDownloading(false);
    setIsPaused(false);
    setProgress(0);
    setFinalFilename('');
    setError(null);
    setDownloadScope('single');
    setDownloadStatus('');
    setStep(0);
    setCurrentJobId(null);
    setAppMode(null);
    setShowLibrary(false);
    setScheduleTime('');
    localStorage.removeItem('ytdl_job_id');
    localStorage.removeItem('ytdl_job_scope');
    localStorage.removeItem('ytdl_url');
    localStorage.removeItem('ytdl_info');
  };

  const selectAppMode = (mode) => {
    setAppMode(mode);
    if (mode === 'music') {
      setMediaType('audio');
      setDownloadFormat('audio');
      setDownloadSourceMode('standard');
    } else {
      setMediaType('video');
      setDownloadSourceMode('standard');
    }
  };

  return (
    <div className="ytdl-page">
      <div className="ytdl-bg-glow" />

      <div className="ytdl-layout">
        <motion.header
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="ytdl-header"
        >
          {/* Left spacer — balances the right actions column */}
          <div />

          {/* Center: badge + title + subtitle */}
          <div className="ytdl-header-center">
            <div className="ytdl-platform-badge">
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
              YouTube
            </div>
            <h1 className="ytdl-title">YouTube Downloader</h1>
            <p className="ytdl-subtitle">Descarcă orice videoclip sau playlist ca MP4 sau MP3</p>
          </div>

          {/* Right: action buttons */}
          <div className="ytdl-header-actions">
            {info && !downloading && (
              <button className="ytdl-reset-btn" onClick={handleReset} title="Resetare">
                <RefreshCw size={18} />
              </button>
            )}
          </div>
        </motion.header>

        <AnimatePresence>
          {systemStatus && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="ytdl-system-status"
            >
              <div className="ytdl-status-item" title="API Hits">
                <Activity size={16} />
                <span>API Hits: <strong>{systemStatus.totalHits || 0}</strong></span>
              </div>
              <div className="ytdl-status-item" title="Timp de rulare server (Uptime)">
                <Clock size={16} />
                <span>Uptime: <strong>{Math.floor((systemStatus.uptime || 0) / 60000)}m</strong></span>
              </div>
              <div className="ytdl-status-item" title="Memorie RAM folosită vs. Totală">
                <Cpu size={16} />
                <span>RAM: <strong>{((1 - (systemStatus.freeMem / systemStatus.totalMem)) * 100).toFixed(1)}%</strong></span>
              </div>
              <div className="ytdl-status-item" title="Rata de succes a descărcărilor">
                <CheckCircle2 size={16} />
                <span>Succes: <strong>
                  {systemStatus.totalHits > 0
                    ? ((systemStatus.successfulDownloads / Math.max(1, systemStatus.successfulDownloads + systemStatus.failedDownloads)) * 100).toFixed(0) + '%'
                    : '100%'}
                </strong></span>
              </div>
              <div className="ytdl-status-item" title="Spațiu liber pe disc">
                <HardDrive size={16} />
                <span>
                  Liber:
                  <strong className={systemStatus.freeSpace < 1073741824 ? 'text-danger' : ''}>
                    {' '}{formatBytes(systemStatus.freeSpace)}
                  </strong>
                </span>
              </div>
              <div className="ytdl-status-item" title="Sarcini de descărcare active">
                <Zap size={16} />
                <span>Active: <strong>{systemStatus.activeJobs}</strong></span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {appMode === null && !downloading && !downloadComplete && !info && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="ytdl-mode-selector"
          >
            <div className="ytdl-mode-card youtube-mode" onClick={() => selectAppMode('youtube')}>
              <MonitorPlay size={48} className="ytdl-mode-icon" />
              <h2>YouTube Video</h2>
              <p>Descarcă videoclipuri MP4 la calitatea maximă disponibilă. (Până la 4K)</p>
            </div>

            <div className="ytdl-mode-card music-mode" onClick={() => selectAppMode('music')}>
              <Music size={48} className="ytdl-mode-icon" />
              <h2>YouTube Music</h2>
              <p>Descarcă melodii Originale în format MP3 la claritate maximă (320kbps).</p>
            </div>
          </motion.div>
        )}

        {appMode !== null && !downloading && !downloadComplete && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className={`ytdl-url-card ${appMode === 'music' ? 'music-active' : 'youtube-active'}`}
            style={{ position: 'relative' }}
          >
            {!info && (
              <button
                className="ytdl-back-btn"
                onClick={() => setAppMode(null)}
                title="Înapoi la meniu"
              >
                <ArrowLeft size={20} />
              </button>
            )}

            {clipboardToast && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="ytdl-clipboard-toast"
              >
                Link detectat din clipboard!
              </motion.div>
            )}

            <div className="ytdl-url-icon"><Link2 size={24} /></div>
            <input
              type="text"
              placeholder={appMode === 'music' ? "Lipește link-ul piesei de YouTube Music..." : "Lipește link-ul de YouTube (Video)..."}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onFocus={() => setShowHistory(true)}
              onBlur={() => setTimeout(() => setShowHistory(false), 200)}
              onKeyDown={(e) => e.key === 'Enter' && fetchInfo()}
              disabled={loadingInfo}
              className="ytdl-url-input"
            />
            {url && (
              <button className="ytdl-input-clear" style={{ position: 'absolute', right: '120px', background: 'none', border: 'none', color: '#fff', cursor: 'pointer', zIndex: 5 }} onClick={() => { setUrl(''); setInfo(null); setDownloadComplete(false); }}>
                <XCircle size={16} />
              </button>
            )}
            <AnimatePresence>
              {showHistory && history.length > 0 && !url && (
                <motion.div 
                  className="ytdl-history-dropdown"
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'rgba(30,30,40,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '0.5rem', zIndex: 10, marginTop: '0.5rem', backdropFilter: 'blur(10px)' }}
                >
                  <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', padding: '0 0.5rem 0.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: '0.5rem' }}>Ultimele descărcări</div>
                  {history.map((h, i) => (
                    <div 
                      key={i} 
                      style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0.5rem', cursor: 'pointer', borderRadius: '4px', fontSize: '0.85rem', color: '#fff' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      onMouseDown={() => {
                        setUrl(h.url);
                        setShowHistory(false);
                        setTimeout(() => fetchInfo(h.url), 100);
                      }}
                    >
                      {h.thumbnail ? (
                        <img src={h.thumbnail} alt="" style={{ width: 24, height: 24, borderRadius: '4px', objectFit: 'cover' }} />
                      ) : (
                        <Clock size={14} style={{ opacity: 0.5 }} />
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.title}</span>
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
            <button
              className="ytdl-fetch-btn"
              onClick={fetchInfo}
              disabled={!url || loadingInfo}
            >
              {loadingInfo
                ? <><Loader2 className="spin" size={20} /> Se caută...</>
                : <><Zap size={20} fill="currentColor" /> Procesează</>
              }
            </button>
          </motion.div>
        )}

        {/* ── Suggestion Chips ───────────────────────────────── */}
        {appMode !== null && !info && !loadingInfo && !downloading && !downloadComplete && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15 }}
            className="ytdl-suggestions-wrap"
          >
            <span className="ytdl-suggestions-label">Try these:</span>
            <div className="ytdl-suggestions-chips">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.url}
                  className="ytdl-suggestion-chip"
                  style={{ '--chip-color': s.color }}
                  onClick={() => {
                    setUrl(s.url);
                    setTimeout(() => fetchInfo(), 100);
                  }}
                  title={s.url}
                >
                  <span className="ytdl-chip-tag" style={{ background: s.color + '22', color: s.color, borderColor: s.color + '44' }}>
                    {s.tag}
                  </span>
                  <span className="ytdl-chip-label">{s.label}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="ytdl-error"
            >
              <AlertCircle size={20} /> {error}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {loadingInfo && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="ytdl-skeleton-card"
            >
              <div className="ytdl-skel-cover" />
              <div className="ytdl-skel-lines">
                <div className="ytdl-skel-line long" />
                <div className="ytdl-skel-line short" />
                <div className="ytdl-skel-line chips" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {(info || downloading || downloadComplete) && !loadingInfo && (
            <motion.div
              initial={{ opacity: 0, y: 30, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
              className="ytdl-main-card"
            >
              {info && (
                <>
                  <div className="ytdl-preview-section">
                    <div className="ytdl-thumbnail-wrapper">
                      <img src={info.thumbnail} alt="thumbnail" className="ytdl-thumbnail" />
                      <span className="ytdl-duration-badge">{formatDuration(info.duration)}</span>
                    </div>
                    <div className="ytdl-video-meta">
                      <h2 className="ytdl-video-title">{info.title}</h2>
                      <div className="ytdl-video-channel">
                        <span style={{ fontWeight: 700, color: '#f1f5f9' }}>{info.uploader}</span> • YouTube
                      </div>
                      <div className="ytdl-video-stats">
                        <span className="ytdl-stat-chip">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                          {formatViews(info.viewCount) || 'Multe'}
                        </span>
                        <span className="ytdl-stat-chip">
                          <Clock size={14} /> {formatDuration(info.duration)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {info.playlist && !downloading && !downloadComplete && (
                    <div className="ytdl-playlist-panel">
                      <div className="ytdl-playlist-panel-top">
                        <div className="ytdl-playlist-panel-icon">
                          <ListVideo size={20} />
                        </div>
                        <div>
                          <span className="ytdl-eyebrow">PLAYLIST GĂSIT</span>
                          <strong>{info.playlist.title}</strong>
                        </div>
                        <div className="ytdl-playlist-count">
                          {info.playlist.downloadableCount}
                          <small>VIDEO{info.playlist.downloadableCount !== 1 && 'S'}</small>
                        </div>
                      </div>

                      <div className="ytdl-playlist-preview">
                        {info.playlist.entries.slice(0, 5).map((entry, i) => (
                          <div key={i} className="ytdl-playlist-preview-row">
                            <span>{String(entry.index).padStart(2, '0')}</span>
                            <strong>{entry.title}</strong>
                            <small>{formatDuration(entry.duration)}</small>
                          </div>
                        ))}
                        {info.playlist.downloadableCount > 5 && (
                          <div className="ytdl-playlist-utility">
                            <Music size={12} />
                            și încă {info.playlist.downloadableCount - 5} melodii...
                            {info.playlist.isTruncated && <span>(Limitat la primele 5000)</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              <AnimatePresence>
                {showOptionsModal && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="ytdl-modal-overlay"
                  >
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: 20 }}
                      className="ytdl-modal"
                    >
                      <h3 className="ytdl-modal-title">
                        Setări descărcare {pendingScope === 'playlist' && 'Playlist'}
                      </h3>

                      <div className="ytdl-settings">
                        <div className="ytdl-setting-group">
                          <span className="ytdl-setting-label">Sursă:</span>
                          <div className="ytdl-type-tabs">
                            <button
                              className={`ytdl-type-tab ${downloadSourceMode === 'standard' ? 'active' : ''}`}
                              onClick={() => setDownloadSourceMode('standard')}
                            >
                              Standard (Link exact)
                            </button>
                            <button
                              className={`ytdl-type-tab ${downloadSourceMode === 'smart' ? 'active' : ''}`}
                              onClick={() => setDownloadSourceMode('smart')}
                              disabled={appMode === 'youtube'}
                            >
                              Smart Song Match
                            </button>
                          </div>
                        </div>
                        <div className="ytdl-setting-group">
                          <span className="ytdl-setting-label">Formatul dorit</span>
                          <div className="ytdl-type-tabs">
                            <button
                              className={`ytdl-type-tab ${mediaType === 'video' ? 'active' : ''}`}
                              onClick={() => setMediaType('video')}
                            >
                              <MonitorPlay size={18} /> Video (MP4)
                            </button>
                            <button
                              className={`ytdl-type-tab ${mediaType === 'audio' ? 'active' : ''}`}
                              onClick={() => setMediaType('audio')}
                            >
                              <Headphones size={18} /> Audio
                            </button>
                          </div>
                        </div>

                        <div className="ytdl-formats-grid">
                          {mediaType === 'video' ? (
                            RESOLUTIONS.map(resOpt => (
                              <div
                                key={resOpt.id}
                                onClick={() => setSelectedRes(resOpt.id)}
                                className={`ytdl-format-card ${selectedRes === resOpt.id ? 'selected' : ''}`}
                              >
                                <div className="ytdl-format-label">{resOpt.label}</div>
                                <div className="ytdl-format-sub">{resOpt.sub}</div>
                              </div>
                            ))
                          ) : (
                            AUDIO_FORMATS.map(af => (
                              <div
                                key={af.id}
                                onClick={() => setSelectedAudio(af.id)}
                                className={`ytdl-format-card ${selectedAudio === af.id ? 'selected' : ''}`}
                              >
                                <div className="ytdl-format-label">{af.label}</div>
                                <div className="ytdl-format-sub">{af.sub}</div>
                              </div>
                            ))
                          )}
                        </div>

                        {pendingScope === 'playlist' && info?.playlist && (
                          <div className="ytdl-track-selection-section">
                            <div className="ytdl-track-selection-header">
                              <label className="ytdl-modal-label">Selectează melodiile ({selectedTracks.size} alese)</label>
                              <div className="ytdl-track-utils">
                                <button className="ytdl-track-util-btn" onClick={selectAllTracks}>Toate</button>
                                <button className="ytdl-track-util-btn" onClick={deselectAllTracks}>Niciuna</button>
                              </div>
                            </div>
                            <div className="ytdl-track-list">
                              {info.playlist.entries.map((entry) => {
                                const isSelected = selectedTracks.has(entry.index);
                                return (
                                  <div
                                    key={entry.index}
                                    className={`ytdl-track-item ${isSelected ? 'selected' : ''}`}
                                    onClick={() => toggleTrack(entry.index)}
                                  >
                                    <div className="ytdl-track-checkbox" />
                                    <span className="ytdl-track-index">{entry.index}.</span>
                                    <span className="ytdl-track-name">{entry.title}</span>
                                    <span className="ytdl-track-duration">{formatDuration(entry.duration)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div className="ytdl-setting-group" style={{ marginTop: '1rem' }}>
                          <span className="ytdl-setting-label"><CalendarClock size={16} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px' }} /> Programare Descărcare (Opțional)</span>
                          <p className="ytdl-setting-desc">Lăsați gol pentru descărcare imediată, sau setați o oră la care serverul să înceapă procesul automat.</p>
                          <input
                            type="time"
                            className="ytdl-url-input ytdl-time-input"
                            style={{ width: '100%', cursor: 'text' }}
                            value={scheduleTime}
                            onChange={(e) => setScheduleTime(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="ytdl-modal-actions">
                        <button className="ytdl-modal-cancel" onClick={() => setShowOptionsModal(false)}>
                          Anulează
                        </button>
                        <button
                          className="ytdl-modal-confirm"
                          onClick={startDownload}
                          disabled={pendingScope === 'playlist' && selectedTracks.size === 0}
                        >
                          Începe descărcarea
                        </button>
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="ytdl-action-area">
                <AnimatePresence mode="wait">
                  {info && !downloadComplete && !downloading && (
                    <motion.div
                      key="actions"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className={info.playlist ? 'ytdl-dl-actions' : ''}
                    >
                      <button
                        className={`ytdl-dl-btn ${info.playlist ? 'ytdl-single-dl-btn' : ''}`}
                        onClick={() => openDownloadModal('single')}
                      >
                        <Download size={22} /> {info.playlist ? 'Descarcă doar acest clip' : 'Descarcă acum'}
                      </button>
                      {info.playlist && (
                        <button className="ytdl-dl-btn ytdl-playlist-dl-btn" onClick={() => openDownloadModal('playlist')}>
                          <ListVideo size={22} /> Descarcă playlistul
                        </button>
                      )}
                    </motion.div>
                  )}

                  {downloading && (
                    <motion.div
                      key="progress"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="ytdl-progress-block"
                    >
                      <div className="ytdl-step-indicators">
                        <div className={`ytdl-step ${step >= 1 ? 'active' : ''}`}><span className="ytdl-step-dot"></span> Pregătire</div>
                        <div className={`ytdl-step ${step >= 2 ? 'active' : ''}`}><span className="ytdl-step-dot"></span> Descărcare</div>
                        <div className={`ytdl-step ${step >= 3 ? 'active' : ''}`}><span className="ytdl-step-dot"></span> Finalizare</div>
                      </div>

                      <div className="ytdl-progress-header">
                        <span className="ytdl-progress-label">
                          {isPaused ? <Pause size={16} /> : <Loader2 className="spin" size={16} />}
                          {downloadScope === 'playlist' ? 'Descărcare playlist în curs...' : 'Descărcare în curs...'}
                        </span>
                        <span>{progress.toFixed(1)}%</span>
                      </div>

                      {downloadStatus && (
                        <div className={`ytdl-progress-detail ${isPaused ? 'paused-text' : ''}`}>
                          {downloadStatus}
                        </div>
                      )}

                      <div className="ytdl-progress-track">
                        <motion.div
                          className={`ytdl-progress-fill ${step === 3 ? 'pulsing' : ''} ${isPaused ? 'paused-fill' : ''}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${progress}%` }}
                          transition={{ ease: 'linear' }}
                        />
                      </div>

                      <div className="ytdl-job-actions">
                        {isPaused ? (
                          <button className="ytdl-job-btn resume" onClick={() => handleJobAction('resume')}>
                            <Play size={18} /> Reia descărcarea
                          </button>
                        ) : (
                          <button className="ytdl-job-btn pause" onClick={() => handleJobAction('pause')} disabled={step === 3}>
                            <Pause size={18} /> Pune pe pauză
                          </button>
                        )}
                        <button className="ytdl-job-btn cancel" onClick={() => handleJobAction('cancel')}>
                          <XCircle size={18} /> Anulează
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {downloadComplete && finalFilename && (
                    <motion.div
                      key="complete"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="ytdl-complete-block"
                    >
                      <div className="ytdl-complete-icon"><CheckCircle2 size={36} /></div>
                      <div className="ytdl-complete-info">
                        <span className="ytdl-complete-title">
                          {downloadScope === 'playlist'
                            ? 'Playlist descărcat cu succes!'
                            : 'Descărcare finalizată!'}
                        </span>

                        {downloadScope === 'playlist' ? (
                          <div className="ytdl-archive-notice">
                            Fișierele au fost salvate cu succes în locația ta.
                          </div>
                        ) : (
                          <div className="ytdl-name-input-row" style={{ justifyContent: 'center', margin: '1rem 0', flexDirection: 'column', alignItems: 'center' }}>
                            <p className="ytdl-ready-filename">{finalFilename}</p>
                            <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)', marginTop: '0.5rem' }}>Fișierul a fost salvat local.</p>
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', justifyContent: 'center', width: '100%' }}>
                          <button className="ytdl-new-dl-btn" onClick={() => fetch(`/api/ytdl/open-folder${finalFilename ? '?target=' + encodeURIComponent(finalFilename) : ''}`)} style={{ marginTop: 0, width: 'auto', padding: '0.8rem 1.5rem', background: 'rgba(255,255,255,0.1)' }}>
                            <FolderOpen size={18} /> Deschide Folder
                          </button>
                          <button className="ytdl-new-dl-btn" onClick={handleReset} style={{ marginTop: 0, width: 'auto', padding: '0.8rem 1.5rem' }}>
                            <RefreshCw size={18} /> Alt videoclip
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>


      </div>
    </div>
  );
};

export default YoutubeDownloader;
