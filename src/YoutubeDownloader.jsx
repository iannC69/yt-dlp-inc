import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download, Film, Loader2, AlertCircle, CheckCircle2,
  Zap, Clock, MonitorPlay, Headphones, Link2, RefreshCw, Save, ListVideo, Music, Pause, Play, X, XCircle, HardDrive, Activity, Cpu, ArrowLeft, CalendarClock, FolderOpen
} from 'lucide-react';
import { getAverageColor } from './utils/colorUtils';
import WaveformBg from './WaveformBg';
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
  { id: 'mp3_320', label: '320kbps MP3', sub: 'Cea mai buna', quality: '0', audioFmt: 'mp3' },
  { id: 'mp3_192', label: '192kbps MP3', sub: 'Standard', quality: '5', audioFmt: 'mp3' },
  { id: 'mp3_128', label: '128kbps MP3', sub: 'Compresat', quality: '9', audioFmt: 'mp3' },
  { id: 'ogg', label: 'OGG Vorbis', sub: 'Format deschis', quality: '0', audioFmt: 'vorbis' },
  { id: 'wav', label: 'WAV', sub: 'Fara pierderi', quality: '0', audioFmt: 'wav' },
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

function isYouTubeUrl(url) {
  return /^(https?:\/\/)?(www\.|music\.)?(youtube\.com|youtu\.be|soundcloud\.com)\/.+/.test(url);
}

function isPlaylistUrl(value) {
  try {
    const parsed = new URL(value);
    const list = parsed.searchParams.get('list');
    // Ignore YouTube auto-generated radio mixes (RD...) as playlists
    if (list && list.startsWith('RD')) return false;
    return !!list || parsed.pathname.split('/').includes('playlist');
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
    } catch { }
  }, []);

  const saveToHistory = (newUrl, title, thumbnail, uploader = '', artistThumbnail = '', isCollection = false) => {
    if (!newUrl) return;
    setHistory(prev => {
      const filtered = prev.filter(item => item.url !== newUrl);
      const updated = [{ url: newUrl, title: title || newUrl, thumbnail, uploader, artistThumbnail, isCollection, date: Date.now() }, ...filtered].slice(0, 10);
      localStorage.setItem('ytdl_history', JSON.stringify(updated));
      return updated;
    });
  };
  const removeHistoryItem = (targetUrl) => {
    setHistory(prev => {
      const updated = prev.filter(item => item.url !== targetUrl);
      localStorage.setItem('ytdl_history', JSON.stringify(updated));
      return updated;
    });
  };

  const removeChannelHistory = (uploader) => {
    setHistory(prev => {
      const updated = prev.filter(item => item.uploader !== uploader);
      localStorage.setItem('ytdl_history', JSON.stringify(updated));
      return updated;
    });
  };

  const recentChannels = useMemo(() => {
    const seen = new Set();
    return history.filter(item => item.uploader && !item.isCollection && !isPlaylistUrl(item.url) && !seen.has(item.uploader) && seen.add(item.uploader)).slice(0, 6);
  }, [history]);

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
  const [ambientColor, setAmbientColor] = useState('rgba(239, 68, 68, 0.12)');

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

  // Emit download_update for Dynamic Island with title + thumbnail
  useEffect(() => {
    if (!downloading) return;
    window.dispatchEvent(new CustomEvent('download_update', {
      detail: {
        source: 'youtube',
        progress,
        status: downloadStatus || 'Connecting...',
        thumbnail: info?.thumbnail || null,
        title: info?.title || url || 'YouTube',
        done: false
      }
    }));
  }, [downloading, progress, downloadStatus]);

  // Handle global shortcuts and paste
  useEffect(() => {
    if (appMode !== 'single') return;
    const handlePaste = (e) => {
      setUrl(e.detail);
      setInfo(null);
      setError(null);
    };
    const handleDownload = () => {
      if (info && !downloading) handleDownloadClick();
    };
    window.addEventListener('app:paste-url', handlePaste);
    window.addEventListener('app:global-download', handleDownload);
    return () => {
      window.removeEventListener('app:paste-url', handlePaste);
      window.removeEventListener('app:global-download', handleDownload);
    };
  }, [info, downloading, appMode]);

  const handleOpenFolder = async (target = '') => {
    try {
      const cp = localStorage.getItem('customPath') || '';
      const res = await fetch(`/api/ytdl/open-folder?target=${encodeURIComponent(target)}&customPath=${encodeURIComponent(cp)}`);
      if (!res.ok) {
        alert("Eroare: Fisierul nu a fost gasit. A fost mutat sau sters?");
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
          window.dispatchEvent(new CustomEvent('download_update', { detail: {
            source: 'youtube', progress: data.progress, status: data.status || 'Downloading...', 
            thumbnail: null, title: null, done: false
          }}));
        }
        if (data.status) {
          setDownloadStatus(data.status);
          if (data.status.includes('arhiv')) setStep(3);
        }
        if (data.isPaused !== undefined) {
          setIsPaused(data.isPaused);
        }
        if (data.currentItem && data.totalItems) {
          setDownloadStatus(`Se descarca videoclipul ${data.currentItem} din ${data.totalItems}`);
        }
        if (data.raw && data.raw.includes('Merging formats')) {
          setStep(3);
          setDownloadStatus('Se asambleaza fisierul final...');
        }
        if (data.error) {
          eventSource.close();
          setDownloading(false);
          setError(data.error);
          setStep(0);
          setCurrentJobId(null);
          localStorage.removeItem('ytdl_job_id');
          localStorage.removeItem('ytdl_job_scope');
          window.dispatchEvent(new CustomEvent('download_update', { detail: { source: 'youtube', error: true } }));
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
          window.dispatchEvent(new CustomEvent('download_update', { detail: { source: 'youtube', done: true } }));

          if (data.finalFilename) {
            setFinalFilename(data.finalFilename);

            try {
              let h = JSON.parse(localStorage.getItem('global_history') || '[]');
              h.unshift({
                id: 'youtube_' + Date.now(),
                title: info ? info.title : url,
                thumbnail: info ? info.thumbnail : null,
                date: Date.now(),
                source: 'youtube',
                format: downloadFormat === 'audio' ? 'Audio' : 'Video',
                filename: data.finalFilename
              });
              if (h.length > 500) h.length = 500;
              localStorage.setItem('global_history', JSON.stringify(h));
              window.dispatchEvent(new Event('history_updated'));
            } catch (e) {
              console.error('Failed to update global history', e);
            }
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
      setError('Conexiunea cu serverul a fost pierduta.');
      setStep(0);
    };
  };

  const fetchInfo = async (inputUrl = url) => {
    const targetUrl = typeof inputUrl === 'string' ? inputUrl.trim() : url.trim();
    if (!targetUrl) return;
    setUrl(targetUrl);
    setLoadingInfo(true);
    setError(null);
    setInfo(null);
    setDownloadComplete(false);
    setProgress(0);
    setStep(0);

    if (isMusicUrl(targetUrl)) {
      setMediaType('audio');
      setDownloadFormat('audio');
      setDownloadSourceMode('standard');
      if (appMode === null) setAppMode('music');
    } else {
      setMediaType('video');
      setDownloadSourceMode('standard');
      if (appMode === null) setAppMode('youtube');
    }

    try {
      const res = await fetch(`/api/ytdl/info?url=${encodeURIComponent(targetUrl)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch info');

      let playlist = null;
      if (data.contentType === 'album' || data.contentType === 'playlist' || isPlaylistUrl(targetUrl)) {
        const playlistRes = await fetch('/api/ytdl/collection-info?url=' + encodeURIComponent(targetUrl));
        if (playlistRes.ok) {
          playlist = await playlistRes.json();
          const allIndices = new Set(playlist.entries.map(e => e.index));
          setSelectedTracks(allIndices);
        }
      }
      if (data.platform === 'youtube_music') {
        setAppMode('music');
        setMediaType('audio');
      } else {
        setAppMode('youtube');
      }
      setInfo({ ...data, playlist });
      
      // Dynamic ambient color from thumbnail
      if (data.thumbnail || (playlist && playlist.thumbnail)) {
        getAverageColor(data.thumbnail || playlist.thumbnail).then(color => {
          setAmbientColor(color.replace('rgb', 'rgba').replace(')', ', 0.15)'));
        });
      } else {
        setAmbientColor('rgba(239, 68, 68, 0.12)');
      }

      saveToHistory(targetUrl, playlist ? playlist.title : data.title, data.thumbnail, data.uploader || playlist?.uploader || '', data.artistThumbnail || '', Boolean(playlist));
      localStorage.setItem('ytdl_url', targetUrl);
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
    setDownloadStatus('Se conecteaza la server...');
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
          hwaccel: localStorage.getItem('hardware_acceleration') || 'NONE',
          customPath: localStorage.getItem('customPath') || ''
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
      alert("Te rog selecteaza cel putin o melodie.");
      return;
    }

    setShowOptionsModal(false);
    if (!url) return;

    setDownloadStatus(pendingScope === 'playlist' ? 'Se pregateste playlistul...' : 'Se pregateste descarcarea...');

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
      if (!confirm("Esti sigur ca vrei sa anulezi descarcarea curenta?")) return;
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
    <div className="ytdl-page" style={{ '--ambient-color': ambientColor }}>
      <div className="ytdl-bg-glow" />
      <WaveformBg isActive={downloading} color={ambientColor} />

      <div className="ytdl-layout">
        <motion.header
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="ytdl-header"
        >
          {/* Left spacer — balances the right actions column */}
          <div className="ytdl-header-center">
            <div className="ytdl-platform-badge">
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
              YouTube
            </div>
            <h1 className="ytdl-title">YouTube video & music</h1>
            <p className="ytdl-subtitle">A focused workspace for video, audio, playlists and YouTube Music.</p>
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
              <div className="ytdl-status-item" title="Memorie RAM folosita vs. Totala">
                <Cpu size={16} />
                <span>RAM: <strong>{((1 - (systemStatus.freeMem / systemStatus.totalMem)) * 100).toFixed(1)}%</strong></span>
              </div>
              <div className="ytdl-status-item" title="Rata de succes a descarcarilor">
                <CheckCircle2 size={16} />
                <span>Succes: <strong>
                  {systemStatus.totalHits > 0
                    ? ((systemStatus.successfulDownloads / Math.max(1, systemStatus.successfulDownloads + systemStatus.failedDownloads)) * 100).toFixed(0) + '%'
                    : '100%'}
                </strong></span>
              </div>
              <div className="ytdl-status-item" title="Spatiu liber pe disc">
                <HardDrive size={16} />
                <span>
                  Liber:
                  <strong className={systemStatus.freeSpace < 1073741824 ? 'text-danger' : ''}>
                    {' '}{formatBytes(systemStatus.freeSpace)}
                  </strong>
                </span>
              </div>
              <div className="ytdl-status-item" title="Sarcini de descarcare active">
                <Zap size={16} />
                <span>Active: <strong>{systemStatus.activeJobs}</strong></span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!downloading && !downloadComplete && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className={`ytdl-url-card ${appMode === 'music' ? 'music-active' : 'youtube-active'}`}
            style={{ position: 'relative', zIndex: 50 }}
          >
            <div className="ytdl-input-section-label"><span>New download</span><small>Paste a YouTube video, playlist, or Music link</small></div>
            {!downloading && !downloadComplete && (
              <div className="ytdl-mode-toggle">
                <button
                  className={`ytdl-mode-toggle-btn ${appMode !== 'music' ? 'active' : ''}`}
                  onClick={() => selectAppMode('youtube')}
                >
                  <MonitorPlay size={14} /> Video
                </button>
                <button
                  className={`ytdl-mode-toggle-btn ${appMode === 'music' ? 'active' : ''}`}
                  onClick={() => selectAppMode('music')}
                >
                  <Music size={14} /> Music
                </button>
              </div>
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
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', position: 'relative' }}>
              <input
                type="text"
                placeholder={appMode === 'music' ? "Lipeste link-ul piesei de YouTube Music..." : "Lipeste link-ul de YouTube (Video)..."}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onFocus={() => setShowHistory(true)}
                onBlur={() => setTimeout(() => setShowHistory(false), 200)}
                onKeyDown={(e) => e.key === 'Enter' && fetchInfo()}
                disabled={loadingInfo}
                className="ytdl-url-input"
                style={{ width: '100%', paddingRight: url ? '3rem' : '0' }}
              />
              {url && (
                <button className="ytdl-input-clear" type="button" aria-label="Clear URL" title="Clear URL" onClick={() => { setUrl(''); setInfo(null); setDownloadComplete(false); }}>
                  <X size={16} strokeWidth={2.5} />
                </button>
              )}
            </div>
            <AnimatePresence>
              {showHistory && history.length > 0 && !url && (
                <motion.div
                  className="ytdl-history-dropdown"
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#121218', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '0.5rem', zIndex: 100, marginTop: '0.5rem', boxShadow: '0 8px 32px rgba(0,0,0,0.8)' }}
                >
                  <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', padding: '0 0.5rem 0.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: '0.5rem' }}>Ultimele descarcari</div>
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
              onClick={() => fetchInfo()}
              disabled={!url || loadingInfo}
            >
              {loadingInfo
                ? <><Loader2 className="spin" size={20} /> Se cauta...</>
                : <><Zap size={20} fill="currentColor" /> Proceseaza</>
              }
            </button>
            <div className="ytdl-capability-row">
              <span><MonitorPlay size={14} /> MP4 up to 4K</span>
              <span><Headphones size={14} /> High-quality audio</span>
              <span><ListVideo size={14} /> Playlist selection</span>
              <span><Zap size={14} /> Local processing</span>
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
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.3 }}
              className="ytdl-skeleton-card"
            >
              <motion.div
                className="ytdl-skel-cover"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.05, duration: 0.4 }}
              />
              <div className="ytdl-skel-lines">
                {[{ cls: 'long', delay: 0.1 }, { cls: 'short', delay: 0.18 }, { cls: 'chips', delay: 0.26 }].map(({ cls, delay }) => (
                  <motion.div
                    key={cls}
                    className={`ytdl-skel-line ${cls}`}
                    initial={{ opacity: 0, scaleX: 0, originX: 0 }}
                    animate={{ opacity: 1, scaleX: 1 }}
                    transition={{ delay, duration: 0.4, ease: 'easeOut' }}
                  />
                ))}
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
                    <div className={"ytdl-thumbnail-wrapper" + ((info.contentType === 'track' || info.contentType === 'album') ? " ytdl-thumbnail-square" : "")}>
                      <img src={info.thumbnail} alt="thumbnail" className="ytdl-thumbnail" />
                      <span className="ytdl-duration-badge">{formatDuration(info.duration)}</span>
                    </div>
                    <div className="ytdl-video-meta">
                      <h2 className="ytdl-video-title">{info.title}</h2>
                      <div className="ytdl-video-channel">
                        <span style={{ fontWeight: 700, color: '#f1f5f9' }}>{info.uploader}</span> • {info.platform === 'youtube_music' ? 'YouTube Music' : 'YouTube'}
                      </div>
                      {info.album && <p className="ytdl-video-album">{info.album}{info.albumArtist && info.albumArtist !== info.uploader ? ` · ${info.albumArtist}` : ''}</p>}
                      <div className="ytdl-video-stats">
                        <span className="ytdl-stat-chip">
                          <Clock size={14} /> {formatDuration(info.duration)}
                        </span>
                        {info.trackNumber && info.trackCount && <span className="ytdl-stat-chip">Track {info.trackNumber} / {info.trackCount}</span>}
                        {info.releaseYear && <span className="ytdl-stat-chip">{info.releaseYear}</span>}
                        <div className="ytdl-content-tags">
                          <span className={`ytdl-content-badge ytdl-content-badge--${info.contentType || 'video'}`}>
                            {info.contentType === 'album' ? 'Album' : info.contentType === 'playlist' ? 'Playlist' : info.contentType === 'track' ? 'Track' : 'Video'}
                          </span>
                          {info.album && info.contentType === 'track' && <span className="ytdl-content-badge ytdl-content-badge--album">Album track</span>}
                        </div>
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
                          <span className="ytdl-eyebrow">{info.contentType === 'album' ? 'ALBUM GASIT' : appMode === 'music' ? 'PLAYLIST GASIT' : 'PLAYLIST GASIT'}</span>
                          <strong>{info.playlist.title}</strong>
                        </div>
                        <div className="ytdl-playlist-count">
                          {info.playlist.downloadableCount}
                          <small>{appMode === 'music' ? `PIES${info.playlist.downloadableCount !== 1 ? 'E' : 'A'}` : `VIDEO${info.playlist.downloadableCount !== 1 ? 'S' : ''}`}</small>
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
                            si inca {info.playlist.downloadableCount - 5} melodii...
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
                        {pendingScope === 'playlist' ? 'Setari Descarcare Playlist' : 'Setari Descarcare'}
                      </h3>

                      <div className="ytdl-modal-body ytdl-settings">
                        <div className="ytdl-setting-group">
                          <span className="ytdl-setting-label">Sursa:</span>
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
                          <span className="ytdl-setting-label">Formatul dorit:</span>
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
                              <label className="ytdl-modal-label">Selecteaza melodiile ({selectedTracks.size} alese)</label>
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
                          <span className="ytdl-setting-label"><CalendarClock size={16} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px' }} /> Programare descarcare (optional)</span>
                          <p className="ytdl-setting-desc">Lasati liber pentru descarcare imediata sau setati o ora la care sa inceapa procesul automat.</p>
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
                          Anuleaza
                        </button>
                        <button
                          className="ytdl-modal-confirm"
                          onClick={startDownload}
                          disabled={pendingScope === 'playlist' && selectedTracks.size === 0}
                        >
                          Incepe descarcarea
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
                      className={`ytdl-download-actions ${info.playlist ? 'ytdl-dl-actions' : ''}`}
                    >
                      <div className="ytdl-download-action-copy">
                        <span>{info.contentType === 'album' ? 'Album ready' : info.playlist ? 'Collection ready' : 'Ready to download'}</span>
                        <small>{info.playlist ? `${info.playlist.downloadableCount} ${appMode === 'music' ? 'tracks' : 'videos'} available` : `${mediaType === 'audio' ? 'Audio' : 'Video'} · Choose your preferred quality`}</small>
                      </div>
                      <button
                        className={`ytdl-dl-btn ${info.playlist ? 'ytdl-single-dl-btn' : ''}`}
                        onClick={() => openDownloadModal('single')}
                      >
                        <Download size={22} /> {info.playlist ? (appMode === 'music' ? 'Descarca doar aceasta piesa' : 'Descarca doar acest clip') : 'Descarca acum'}
                      </button>
                      {info.playlist && (
                        <button className="ytdl-dl-btn ytdl-playlist-dl-btn" onClick={() => openDownloadModal('playlist')}>
                          <ListVideo size={22} /> {appMode === 'music' ? 'Descarca albumul / playlistul' : 'Descarca playlistul'}
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
                      {/* Multi-step timeline */}
                      <div className="ytdl-step-timeline">
                        {[
                          { label: 'Pregatire', idx: 1 },
                          { label: 'Descarcare', idx: 2 },
                          { label: 'Finalizare', idx: 3 },
                        ].map(({ label, idx }, i, arr) => (
                          <div key={idx} className="ytdl-step-timeline-item">
                            <div className={`ytdl-step-node ${step >= idx ? 'active' : ''} ${step === idx ? 'current' : ''}`}>
                              {step > idx ? <CheckCircle2 size={14} /> : <span>{idx}</span>}
                            </div>
                            <span className={`ytdl-step-label ${step >= idx ? 'active' : ''}`}>{label}</span>
                            {i < arr.length - 1 && <div className={`ytdl-step-connector ${step > idx ? 'filled' : ''}`} />}
                          </div>
                        ))}
                      </div>

                      {/* Track info spotlight if thumbnail available */}
                      {info?.thumbnail && (
                        <div className="sp-prog-spotlight" style={{ paddingTop: '0.5rem' }}>
                          <div className="sp-prog-vinyl-wrap">
                            <motion.div
                              className="sp-prog-vinyl"
                              animate={isPaused ? {} : { rotate: 360 }}
                              transition={{ repeat: Infinity, duration: 6, ease: 'linear' }}
                              style={{ backgroundImage: `url(${info.thumbnail})` }}
                            >
                              <div className="sp-prog-vinyl-hole" />
                            </motion.div>
                          </div>
                          <div className="sp-prog-spotlight-meta">
                            <div className="sp-prog-now-label">{isPaused ? 'PAUSED' : 'DOWNLOADING'}</div>
                            <div className="sp-prog-track-name">{info?.title || 'YouTube Video'}</div>
                            <div className="sp-prog-track-artist">{info?.uploader || ''}</div>
                            {downloadStatus && (
                              <div className="sp-prog-eq-row">
                                {isPaused ? <Pause size={13} style={{ color: '#fb923c' }} /> : <Loader2 size={13} className="spin" style={{ color: '#60a5fa' }} />}
                                <span className="sp-prog-status-text">{downloadStatus}</span>
                              </div>
                            )}
                          </div>
                          <div className="sp-prog-counter sp-prog-counter--remain" style={{ fontSize: '1rem', fontWeight: 700, padding: '0.4rem 0.75rem' }}>
                            {progress.toFixed(0)}%
                          </div>
                        </div>
                      )}

                      {/* Progress bar with glow */}
                      <div className="sp-prog-bar-section">
                        {!info?.thumbnail && (
                          <div className="sp-prog-bar-labels">
                            <span>{isPaused ? 'Paused' : (downloadScope === 'playlist' ? 'Downloading playlist...' : 'Downloading...')}</span>
                            <span>{progress.toFixed(1)}%</span>
                          </div>
                        )}
                        <div className="sp-prog-bar-outer">
                          <motion.div
                            className={`sp-prog-bar-fill${isPaused ? ' sp-prog-bar-fill--paused' : ''}`}
                            animate={{ width: `${progress}%` }}
                            transition={{ ease: 'linear', duration: 0.3 }}
                          />
                          {!isPaused && (
                            <motion.div
                              className="sp-prog-bar-glow"
                              animate={{ left: `${Math.min(progress - 2, 97)}%` }}
                              transition={{ ease: 'linear', duration: 0.3 }}
                            />
                          )}
                        </div>
                      </div>

                      {!info?.thumbnail && downloadStatus && (
                        <div className={`ytdl-progress-detail ${isPaused ? 'paused-text' : ''}`}>
                          {downloadStatus}
                        </div>
                      )}

                      <div className="ytdl-job-actions">
                        {isPaused ? (
                          <button className="ytdl-job-btn resume" onClick={() => handleJobAction('resume')}>
                            <Play size={18} /> Reia descarcarea
                          </button>
                        ) : (
                          <button className="ytdl-job-btn pause" onClick={() => handleJobAction('pause')} disabled={step === 3}>
                            <Pause size={18} /> Pune pe pauza
                          </button>
                        )}
                        <button className="ytdl-job-btn cancel" onClick={() => handleJobAction('cancel')}>
                          <XCircle size={18} /> Anuleaza
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
                            ? 'Playlist descarcat cu succes!'
                            : 'Descarcare finalizata!'}
                        </span>

                        {downloadScope === 'playlist' ? (
                          <div className="ytdl-archive-notice">
                            Fisierele au fost salvate cu succes in locatia ta.
                          </div>
                        ) : (
                          <div className="ytdl-name-input-row" style={{ justifyContent: 'center', margin: '1rem 0', flexDirection: 'column', alignItems: 'center' }}>
                            <p className="ytdl-complete-media-title">{info?.title || finalFilename}</p>
                            {info?.uploader && <p className="ytdl-complete-media-sub">{info.uploader} · {downloadFormat === 'audio' ? 'Audio' : 'Video'} saved locally</p>}
                            <p className="ytdl-ready-filename" title={finalFilename}>{finalFilename}</p>
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', justifyContent: 'center', width: '100%' }}>
                          <button className="ytdl-new-dl-btn" onClick={() => {
                            const cp = localStorage.getItem('customPath') || '';
                            const q = finalFilename ? `?target=${encodeURIComponent(finalFilename)}&customPath=${encodeURIComponent(cp)}` : `?customPath=${encodeURIComponent(cp)}`;
                            fetch(`/api/ytdl/open-folder${q}`);
                          }} style={{ marginTop: 0, width: 'auto', padding: '0.8rem 1.5rem', background: 'rgba(255,255,255,0.1)' }}>
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

        {history.length > 0 && (
          <>
            <section className="ytdl-artist-gallery">
              <div className="ytdl-history-panel-title"><Music size={14} /> Recently played channels</div>
              <div className="ytdl-artist-bubbles">
                {recentChannels.map((item, index) => (
                  <button key={item.url} className="ytdl-artist-bubble" style={{ '--bubble-index': index }} onClick={() => { setUrl(item.url); fetchInfo(item.url); }} title={item.uploader || item.title}>
                    {item.artistThumbnail ? <img src={item.artistThumbnail} alt="" /> : <span>{(item.uploader || item.title).slice(0, 1).toUpperCase()}</span>}
                    <strong>{item.uploader || item.title}</strong>
                    <span className="ytdl-history-remove" role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); removeChannelHistory(item.uploader); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); removeChannelHistory(item.uploader); } }} title="Remove channel from history" aria-label={`Remove ${item.uploader} from history`}><X size={12} strokeWidth={2.5} /></span>
                  </button>
                ))}
              </div>
            </section>
            <section className="ytdl-history-panels">
            <div className="ytdl-history-panel">
              <div className="ytdl-history-panel-title"><Music size={14} /> Recent channels</div>
              <div className="ytdl-channel-chips">
                {recentChannels.map(item => (
                  <button key={item.uploader} className="ytdl-channel-chip" onClick={() => { setUrl(item.url); fetchInfo(item.url); }} title={`Open ${item.uploader}`}>
                    {item.artistThumbnail ? <img src={item.artistThumbnail} alt="" className="ytdl-channel-avatar" /> : <span className="ytdl-channel-avatar">{item.uploader.slice(0, 1).toUpperCase()}</span>}
                    <span className="ytdl-channel-name">{item.uploader}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="ytdl-history-panel">
              <div className="ytdl-history-panel-title"><Clock size={14} /> Recent downloads</div>
              <div className="ytdl-recent-list">
                {history.slice(0, 4).map(item => (
                  <button key={item.url} className="ytdl-recent-item" onClick={() => { setUrl(item.url); fetchInfo(item.url); }}>
                    {item.thumbnail ? <img src={item.thumbnail} alt="" className="ytdl-recent-thumb" /> : <span className="ytdl-recent-thumb" />}
                    <span className="ytdl-recent-name">{item.title}</span>
                    <span className="ytdl-recent-date">{new Date(item.date).toLocaleDateString()}</span>
                    <span className="ytdl-recent-remove" role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); removeHistoryItem(item.url); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); removeHistoryItem(item.url); } }} title="Remove from history" aria-label={`Remove ${item.title} from history`}><X size={13} strokeWidth={2.5} /></span>
                  </button>
                ))}
              </div>
            </div>
            </section>
          </>
        )}

        <footer className="ytdl-footer">
          <div className="ytdl-footer-brand"><span className="ytdl-footer-dot" /> MediaDL YouTube</div>
          <div className="ytdl-footer-details"><span>Video & audio</span><span>Playlist-aware</span><span>Powered by yt-dlp + FFmpeg</span></div>
        </footer>
      </div>
    </div>
  );
};

export default YoutubeDownloader;
