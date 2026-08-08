import { useEffect, useState, useCallback, useRef, lazy } from 'react';
import SetupWizard from './SetupWizard';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Settings, X, HelpCircle, ExternalLink, Palette, Library, FolderOpen, RefreshCw, ListVideo, CheckCircle2, Leaf, Scale, Zap, Rocket, Bot, Scissors, Layers, SlidersHorizontal, Cpu, Music2, Filter, Terminal, LayoutGrid, Globe, Check, Music, Folder, Link, Link2, Download, Upload } from 'lucide-react';
import YoutubeDownloader from './YoutubeDownloader';
import SpotifyDownloader from './SpotifyDownloader';
import AudioCutter from './AudioCutter';
import MassDownloader from './MassDownloader';
import PlaylistAnalyzer from './PlaylistAnalyzer';
import LibraryModal from './LibraryModal';
import QueueModal from './QueueModal';
import LogsTab from './LogsTab';
import UpdatesTab from './UpdatesTab';
import UpdateOverlay from './UpdateOverlay';
import SplashScreen from './SplashScreen';
import ToastSystem, { toast } from './ToastSystem';
import AuroraBackground from './AuroraBackground';
import SettingsModal from './SettingsModal';
import AdminPanel from './AdminPanel';
import './App.css';
import { storage } from './storage';

const PLATFORMS = [
  {
    id: 'youtube',
    label: 'YouTube',
    color: '#ef4444',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
  },
  {
    id: 'spotify',
    label: 'Spotify',
    color: '#1DB954',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
      </svg>
    ),
  },
  {
    id: 'cutter',
    label: 'Audio Cutter',
    color: '#22d3ee',
    icon: <Scissors size={18} />,
  },
  {
    id: 'mass',
    label: 'Mass DL',
    color: '#a855f7',
    icon: <Layers size={18} />,
  },
  {
    id: 'analyzer',
    label: 'Analyzer',
    color: '#8B5CF6',
    icon: <Globe size={18} />,
  },
];

const slideVariants = {
  enter: (dir) => ({ x: dir > 0 ? '100%' : '-100%', opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir) => ({ x: dir > 0 ? '-100%' : '100%', opacity: 0 }),
};

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [setupDone, setSetupDone] = useState(() => storage.getItem('setup_complete') === '1');
  const [activeIdx, setActiveIdx] = useState(0);
  const [direction, setDirection] = useState(1);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState('general');
  const [showLibrary, setShowLibrary] = useState(false);
  const [showQueueModal, setShowQueueModal] = useState(false);
  const [updateNotice, setUpdateNotice] = useState(null);
  const [showUpdateOverlay, setShowUpdateOverlay] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [updateState, setUpdateState] = useState('idle');
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateSpeed, setUpdateSpeed] = useState(0);
  const [updateTransferred, setUpdateTransferred] = useState(0);
  const [updateTotal, setUpdateTotal] = useState(0);
  const [updateInfo, setUpdateInfo] = useState({});
  const [historyData, setHistoryData] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const overlayMouseDownRef = useRef(false);
  const colorPickerActiveRef = useRef(false);
  const colorPickerTimerRef = useRef(null);

  // Cross-module payload for Cutter
  const [cutterPayload, setCutterPayload] = useState(null);

  const [spotifyClientId, setSpotifyClientId] = useState('');
  const [spotifyClientSecret, setSpotifyClientSecret] = useState('');
  const [downloadPreset, setDownloadPreset] = useState('AUTO');
  const [hardwareAcceleration, setHardwareAcceleration] = useState('NONE');
  const [customPath, setCustomPath] = useState(() => storage.getItem('customPath') || '');
  const [customTheme, setCustomTheme] = useState({
    // Global
    primary: '#ef4444',
    secondary: '#3b82f6',
    bgBase: '#080a0f',
    panelColor: '#0f111a',
    navColor: '#06080e',
    textColor: '#f1f5f9',
    borderColor: '#ffffff',
    // YouTube panel
    ytBg: '#080a0f',
    ytAccent: '#ef4444',
    ytSecondary: '#3b82f6',
    ytMusic: '#8b5cf6',
    ytText: '#f1f5f9',
    // Spotify panel
    spBg: '#000000',
    spCard: '#0c0c0c',
    spCardBorder: '#1a1a1a',
    spAccent: '#1DB954',
    spText: '#f8fafc',
    // Mass DL panel
    mdBg: '#0f0505',
    mdAccent: '#f43f5e',
    mdSecondary: '#be123c',
    mdText: '#fce7f3',
    // Audio Cutter panel
    acBg: '#060910',
    acAccent: '#22d3ee',
    acText: '#d8e4f0',
    // Playlist Analyzer panel
    paBg: '#09090F',
    paAccent1: '#8B5CF6',
    paAccent2: '#EC4899',
    paAccent3: '#10B981',
    paText: '#F5F3FF',
  });
  const [showHelp, setShowHelp] = useState(false);
  const [activeYoutubeJob, setActiveYoutubeJob] = useState(null);
  const [activeSpotifyJob, setActiveSpotifyJob] = useState(null);
  const [liveBackground, setLiveBackground] = useState(() => storage.getItem('live_background') !== 'false');
  const [auroraIntensity, setAuroraIntensity] = useState(() => parseInt(storage.getItem('aurora_intensity') || '100', 10));
  const [auroraStyle, setAuroraStyle] = useState(() => storage.getItem('aurora_style') || 'normal');

  // Backend Config State
  const [audioFormat, setAudioFormat] = useState(() => storage.getItem('audioFormat') || 'mp3');
  const [audioQuality, setAudioQuality] = useState(() => storage.getItem('audioQuality') || '320k');
  const [spotifyThreshold, setSpotifyThreshold] = useState(100);
  const [ytDlpFallbackEnabled, setYtDlpFallbackEnabled] = useState(true);

  // YouTube settings
  const [ytVideoQuality, setYtVideoQuality] = useState(() => storage.getItem('yt_video_quality') || 'best');
  const [ytSubtitles, setYtSubtitles] = useState(() => storage.getItem('yt_subtitles') || 'off');
  const [ytEmbedThumbnail, setYtEmbedThumbnail] = useState(() => storage.getItem('yt_embed_thumbnail') !== 'false');
  const [ytSponsorBlock, setYtSponsorBlock] = useState(() => storage.getItem('yt_sponsorblock') === 'true');
  const [ytFilenameTemplate, setYtFilenameTemplate] = useState(() => storage.getItem('yt_filename_template') || '%(title)s');
  const [ytWriteThumbnail, setYtWriteThumbnail] = useState(() => storage.getItem('yt_write_thumbnail') === 'true');
  const [youtubePoToken, setYoutubePoToken] = useState('');
  const [cookiesFromBrowser, setCookiesFromBrowser] = useState('');

  // Spotify extra settings
  const [spotDlLyrics, setSpotDlLyrics] = useState(() => storage.getItem('spotdl_lyrics') === 'true');
  const [spotDlArchive, setSpotDlArchive] = useState(() => storage.getItem('spotdl_archive') === 'true');
  const [spotDlEngine, setSpotDlEngine] = useState(() => storage.getItem('spotdl_engine') || 'spotdl');

  // Mass DL settings
  const [massDlConcurrency, setMassDlConcurrency] = useState(() => parseInt(storage.getItem('massdl_concurrency') || '3'));
  const [massDlRetries, setMassDlRetries] = useState(() => parseInt(storage.getItem('massdl_retries') || '2'));
  const [massDlContinueOnError, setMassDlContinueOnError] = useState(() => storage.getItem('massdl_continue_on_error') !== 'false');
  const [massDlOutputFormat, setMassDlOutputFormat] = useState(() => storage.getItem('massdl_output_format') || 'mp3');
  const [massDlDelay, setMassDlDelay] = useState(() => parseInt(storage.getItem('massdl_delay') || '0'));

  // Audio Cutter settings
  const [cutterOutputFormat, setCutterOutputFormat] = useState(() => storage.getItem('cutter_output_format') || 'mp3');
  const [cutterFadeDuration, setCutterFadeDuration] = useState(() => parseInt(storage.getItem('cutter_fade_duration') || '50'));
  const [cutterNormalize, setCutterNormalize] = useState(() => storage.getItem('cutter_normalize') === 'true');
  const [cutterBitrate, setCutterBitrate] = useState(() => storage.getItem('cutter_bitrate') || '320k');

  const saveConfigToBackend = async (updates) => {
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
    } catch (e) {
      console.error('Failed to save config:', e);
    }
  };

  const fetchHistory = () => {
    try {
      const saved = storage.getItem('global_history');
      if (saved) {
        setHistoryData(JSON.parse(saved));
      } else {
        setHistoryData([]);
      }
    } catch (e) {
      console.error(e);
      setHistoryData([]);
    }
  };

  const handleSelectFolder = async () => {
    try {
      const res = await fetch('/api/ytdl/select-folder');
      const data = await res.json();
      if (data.success) {
        setCustomPath(data.path);
        storage.setItem('customPath', data.path);
      }
    } catch (e) { }
  };

  const handleUpdateEngine = async () => {
    try {
      const res = await fetch('/api/ytdl/update');
      const data = await res.json();
      if (data.success) toast.success('yt-dlp engine updated successfully!');
      else toast.error('Update failed: ' + data.error);
    } catch (err) {
      toast.error('Network error while updating engine.');
    }
  };

  useEffect(() => {
    setSpotifyClientId(storage.getItem('spotify_client_id') || '');
    setSpotifyClientSecret(storage.getItem('spotify_client_secret') || '');
    setDownloadPreset(storage.getItem('download_preset') || 'AUTO');
    setHardwareAcceleration(storage.getItem('hardware_acceleration') || 'NONE');

    fetch('/api/ytdl/get-config').then(r => r.json()).then(data => {
      if (data.customPath) setCustomPath(data.customPath);
    }).catch(() => { });

    fetch('/api/config').then(r => r.json()).then(data => {
      if (data.spotifyThreshold !== undefined) setSpotifyThreshold(data.spotifyThreshold);
      if (data.ytDlpFallbackEnabled !== undefined) setYtDlpFallbackEnabled(data.ytDlpFallbackEnabled);
      if (data.youtubePoToken !== undefined) setYoutubePoToken(data.youtubePoToken);
      if (data.cookiesFromBrowser !== undefined) setCookiesFromBrowser(data.cookiesFromBrowser);
    }).catch(() => { });

    const savedTheme = storage.getItem('global_theme');
    if (savedTheme) {
      try { setCustomTheme(prev => ({ ...prev, ...JSON.parse(savedTheme) })); } catch { }
    }

    // Auto-reconnect to background jobs
    fetch('/api/active-jobs')
      .then(r => r.json())
      .then(data => {
        if (data.youtube && data.youtube.length > 0) {
          setActiveYoutubeJob(data.youtube[0].id);
          setActiveIdx(0);
        } else if (data.spotify && data.spotify.length > 0) {
          setActiveSpotifyJob(data.spotify[0].id);
          setActiveIdx(1);
        }
      })
      .catch(() => { });

    const handleHistoryUpdate = () => fetchHistory();
    window.addEventListener('history_updated', handleHistoryUpdate);

    let cleanupUpdater = () => { };
    if (window.electronAPI && window.electronAPI.updater) {
      cleanupUpdater = window.electronAPI.updater.onUpdaterEvent((name, data) => {
        if (name === 'update-available') {
          setUpdateNotice('available');
          if (data) setUpdateInfo(data);
          toast.info(`Update v${data?.version} available — click to download`, { toastId: 'update-available' });
        }
        if (name === 'download-progress') {
          setUpdateNotice(null);
          setShowUpdateOverlay(true);
          setUpdateState('downloading');
          if (data?.percent !== undefined) setUpdateProgress(data.percent);
          if (data?.bytesPerSecond) setUpdateSpeed(data.bytesPerSecond);
          if (data?.transferred) setUpdateTransferred(data.transferred);
          if (data?.total) setUpdateTotal(data.total);
        }
        if (name === 'update-downloaded') {
          setUpdateNotice('downloaded');
          setUpdateState('downloaded');
          setShowUpdateOverlay(true);
          if (data) setUpdateInfo(data);
          toast.success(`v${data?.version} downloaded — restart to install!`, { autoClose: 8000, toastId: 'update-downloaded' });
        }
      });
      // Check for updates quietly in background on startup
      setTimeout(() => {
        window.electronAPI.updater.checkForUpdates();
      }, 5000);
    }

    return () => {
      window.removeEventListener('history_updated', handleHistoryUpdate);
      cleanupUpdater();
    };
  }, []);

  // Sync aurora intensity as CSS custom property
  useEffect(() => {
    document.documentElement.style.setProperty('--aurora-intensity', String(auroraIntensity / 100));
  }, [auroraIntensity]);

  // Sync aurora style class on <html> root
  useEffect(() => {
    const html = document.documentElement;
    ['aurora-subtle', 'aurora-normal', 'aurora-intense', 'aurora-cosmic'].forEach(c => html.classList.remove(c));
    html.classList.add(`aurora-${auroraStyle}`);
  }, [auroraStyle]);

  useEffect(() => {
    const root = document.documentElement;
    const hexToRgb = (hex) => {
      let c = (hex || '#000000').replace('#', '');
      if (c.length === 3) c = c.split('').map(x => x + x).join('');
      const num = parseInt(c, 16);
      return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
    };
    const isWallpaper = !!customTheme.customWallpaper;
    const wpOpacity = customTheme.wallpaperOpacity !== undefined ? customTheme.wallpaperOpacity : 85;
    const applyBg = (hexColor) => {
      if (!isWallpaper) return hexColor;
      return `rgba(${hexToRgb(hexColor)}, ${wpOpacity / 100})`;
    };

    // Global
    root.style.setProperty('--primary', customTheme.primary);
    root.style.setProperty('--primary-dark', customTheme.primary + 'CC');
    root.style.setProperty('--secondary', customTheme.secondary);
    root.style.setProperty('--bg-base', applyBg(customTheme.bgBase || '#080a0f'));
    root.style.setProperty('--bg-panel', (customTheme.bgBase || '#080a0f') + 'F2');
    root.style.setProperty('--panel-color', customTheme.panelColor || '#0f111a');
    root.style.setProperty('--nav-color', isWallpaper && wpOpacity === 0 ? 'rgba(6, 8, 14, 0.4)' : applyBg(customTheme.navColor || '#06080e'));
    root.style.setProperty('--text-color', customTheme.textColor || '#f1f5f9');
    root.style.setProperty('--border-color', customTheme.borderColor || '#ffffff');
    // YouTube
    root.style.setProperty('--theme-bg', applyBg(customTheme.ytBg || '#080a0f'));
    root.style.setProperty('--theme-primary', customTheme.ytAccent || '#ef4444');
    root.style.setProperty('--theme-secondary', customTheme.ytSecondary || '#3b82f6');
    root.style.setProperty('--theme-music', customTheme.ytMusic || '#8b5cf6');
    root.style.setProperty('--theme-music-bg', applyBg(customTheme.ytMusicBg || '#120a1f'));
    root.style.setProperty('--theme-music-text', customTheme.ytMusicText || '#f5f3ff');
    root.style.setProperty('--theme-music-secondary', customTheme.ytMusicSecondary || '#c084fc');
    root.style.setProperty('--yt-text', customTheme.ytText || '#f1f5f9');
    // Spotify
    root.style.setProperty('--sp-bg', applyBg(customTheme.spBg || '#000000'));
    root.style.setProperty('--sp-card', customTheme.spCard || '#0c0c0c');
    root.style.setProperty('--sp-card-border', customTheme.spCardBorder || '#1a1a1a');
    root.style.setProperty('--sp-green', customTheme.spAccent || '#1DB954');
    root.style.setProperty('--sp-green-dim', (customTheme.spAccent || '#1DB954') + '26');
    root.style.setProperty('--sp-text', customTheme.spText || '#f8fafc');
    // Mass DL
    const mdBgResolved = applyBg(customTheme.mdBg || '#0D0814');
    const mdAccentResolved = customTheme.mdAccent || '#A855F7';
    const mdSecondaryResolved = customTheme.mdSecondary || '#C084FC';
    const mdTextResolved = customTheme.mdText || '#F3E8FF';
    root.style.setProperty('--md-bg', mdBgResolved);
    root.style.setProperty('--md-purple', mdAccentResolved);
    root.style.setProperty('--md-purple-rgb', hexToRgb(mdAccentResolved));
    root.style.setProperty('--md-magenta', mdSecondaryResolved);
    root.style.setProperty('--md-magenta-rgb', hexToRgb(mdSecondaryResolved));
    root.style.setProperty('--md-text', mdTextResolved);
    // MassDownloader.css uses --md3-* variables — alias them to the same values
    root.style.setProperty('--md3-bg', mdBgResolved);
    root.style.setProperty('--md3-accent', mdAccentResolved);
    root.style.setProperty('--md3-spotify', mdSecondaryResolved);
    root.style.setProperty('--md3-text', mdTextResolved);
    // Audio Cutter
    root.style.setProperty('--ac-bg', applyBg(customTheme.acBg || '#060910'));
    root.style.setProperty('--ac-accent', customTheme.acAccent || '#22d3ee');
    root.style.setProperty('--ac-accent-rgb', hexToRgb(customTheme.acAccent || '#22d3ee'));
    root.style.setProperty('--ac-text', customTheme.acText || '#d8e4f0');
    // Playlist Analyzer
    root.style.setProperty('--pa-bg', applyBg(customTheme.paBg || '#09090F'));
    root.style.setProperty('--pa-accent-1', customTheme.paAccent1 || '#8B5CF6');
    root.style.setProperty('--pa-accent-1-rgb', hexToRgb(customTheme.paAccent1 || '#8B5CF6'));
    root.style.setProperty('--pa-accent-2', customTheme.paAccent2 || '#EC4899');
    root.style.setProperty('--pa-accent-2-rgb', hexToRgb(customTheme.paAccent2 || '#EC4899'));
    root.style.setProperty('--pa-accent-3', customTheme.paAccent3 || '#10B981');
    root.style.setProperty('--pa-text', customTheme.paText || '#F5F3FF');
  }, [customTheme]);

  const saveSettings = () => {
    storage.setItem('spotify_client_id', spotifyClientId.trim());
    storage.setItem('spotify_client_secret', spotifyClientSecret.trim());
    storage.setItem('download_preset', downloadPreset);
    storage.setItem('hardware_acceleration', hardwareAcceleration);
    storage.setItem('global_theme', JSON.stringify(customTheme));
    setShowSettingsModal(false);
  };

  const isConfigured = spotifyClientId.trim() !== '' && spotifyClientSecret.trim() !== '';

  const handleSetupComplete = useCallback(({ clientId, clientSecret, audioFormat, audioQuality, customPath }) => {
    if (clientId) setSpotifyClientId(clientId);
    if (clientSecret) setSpotifyClientSecret(clientSecret);
    if (audioFormat) setAudioFormat(audioFormat);
    if (audioQuality) setAudioQuality(audioQuality);
    if (customPath) setCustomPath(customPath);
    setSetupDone(true);
  }, []);

  const handleSendToCutter = (item) => {
    setCutterPayload(item);
    setActiveIdx(2);
    setShowLibrary(false);
  };

  const switchTo = (idx) => {
    if (idx === activeIdx) return;
    setDirection(idx > activeIdx ? 1 : -1);
    setActiveIdx(idx);
  };

  // ── Drag & Drop URL detection ──────────────────────────────────────────
  const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const text = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list') || '';
    const url = text.trim();
    if (!url) return;
    if (url.includes('spotify.com')) {
      switchTo(1);
      window.dispatchEvent(new CustomEvent('app:paste-url', { detail: url }));
      toast.info('Spotify URL detected — switching to Spotify downloader');
    } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
      switchTo(0);
      window.dispatchEvent(new CustomEvent('app:paste-url', { detail: url }));
      toast.info('YouTube URL detected — switching to YouTube downloader');
    } else {
      window.dispatchEvent(new CustomEvent('app:paste-url', { detail: url }));
      toast.info('URL pasted!');
    }
  };

  // ── Global Keyboard Shortcuts ───────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Escape closes modals
      if (e.key === 'Escape') {
        if (showLibrary) setShowLibrary(false);
        if (showQueueModal) setShowQueueModal(false);
        if (showSettingsModal) setShowSettingsModal(false);
        if (showUpdateOverlay) setShowUpdateOverlay(false);
      }

      // Ctrl+D triggers global download
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('app:global-download'));
      }

      // Ctrl+Shift+A triggers Admin Panel
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setShowAdminPanel(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showLibrary, showQueueModal, showSettingsModal, showUpdateOverlay]);

  if (!setupDone) {
    return <SetupWizard onComplete={handleSetupComplete} />;
  }

  return (
    <div
      className={[
        'app-root',
        dragOver ? 'app-root--drag' : '',
        customTheme.customWallpaper ? 'has-wallpaper' : '',
        !liveBackground ? 'no-aurora' : '',
      ].filter(Boolean).join(' ')}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={customTheme.customWallpaper ? {
        backgroundImage: `url(${customTheme.customWallpaper})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed'
      } : {}}
    >
      {/* Splash Screen */}
      <AnimatePresence>
        {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
      </AnimatePresence>

      {/* Drag-over overlay */}
      <AnimatePresence>
        {dragOver && (
          <motion.div
            className="app-drag-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="app-drag-glass-card">
              <div className="app-drag-icon-wrapper">
                <Link2 size={48} strokeWidth={1.5} className="app-drag-lucide" />
              </div>
              <div className="app-drag-text">
                <div className="app-drag-label">Drop URL to download</div>
                <div className="app-drag-sublabel">Release to instantly fetch media</div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dedicated drag region: covers navbar except right 160px where window controls live */}
      <div className="app-drag-zone" />

      {/* Window Controls — fixed top-right, no parent interference */}
      <div className="custom-window-controls">
        <button className="win-btn win-min" onClick={() => window.electronAPI?.window?.minimize()} title="Minimize">
          <svg viewBox="0 0 10 10" shapeRendering="crispEdges"><path d="M 0,5 h 10" stroke="currentColor" strokeWidth="1" /></svg>
        </button>
        <button className="win-btn win-max" onClick={() => window.electronAPI?.window?.maximize()} title="Maximize">
          <svg viewBox="0 0 10 10" shapeRendering="crispEdges"><rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
        </button>
        <button className="win-btn win-close" onClick={() => window.electronAPI?.window?.close()} title="Close">
          <svg viewBox="0 0 10 10" shapeRendering="crispEdges"><path d="M 1,1 L 9,9 M 9,1 L 1,9" stroke="currentColor" strokeWidth="1" /></svg>
        </button>
      </div>

      {/* Platform Switcher Bar */}
      <div className="platform-bar">
        <div className="platform-bar-inner">
          <div className="platform-brand">
            <div className="platform-brand-logo">
              <Play size={13} fill="currentColor" />
            </div>
            <div className="platform-brand-text">
              <span className="platform-brand-name">MediaDL</span>
              <span className="platform-brand-sub">Media Downloader</span>
            </div>
          </div>
          <div className="platform-tabs">
            {PLATFORMS.map((p, i) => (
              <button
                key={p.id}
                className={`platform-tab ${activeIdx === i ? 'platform-tab--active' : ''}`}
                onClick={() => switchTo(i)}
                style={{ '--tab-color': p.color }}
              >
                <span className="platform-tab-icon">{p.icon}</span>
                <span className="platform-tab-label">{p.label}</span>
                {activeIdx === i && (
                  <motion.span
                    className="platform-tab-indicator"
                    layoutId="tab-indicator"
                    style={{ background: p.color }}
                  />
                )}
              </button>
            ))}
          </div>
          <div className="global-top-actions">
            <button
              className="settings-button"
              onClick={() => setShowQueueModal(true)}
              title="Queue Manager"
            >
              <ListVideo size={18} />
              <span className="navbar-action-label">Queue</span>
            </button>
            <button
              className="settings-button"
              onClick={() => setShowSettingsModal(true)}
              title="Theme / Palette"
            >
              <Palette size={18} />
              <span className="navbar-action-label">Theme</span>
            </button>
            <button
              className="settings-button"
              onClick={() => { fetchHistory(); setShowLibrary(true); }}
              title="Library / History"
            >
              <Library size={18} />
              <span className="navbar-action-label">Library</span>
            </button>
            <button
              className="settings-button"
              onClick={() => setShowSettingsModal(true)}
              title="Settings"
            >
              <Settings size={18} />
              <span className="navbar-action-label">Settings</span>
              <span className="settings-status-dot" style={{ backgroundColor: isConfigured ? '#1DB954' : '#f59e0b' }} />
            </button>
          </div>
        </div>
      </div>

      {/* Panel Viewport */}
      <div className="panel-viewport">
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={activeIdx}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              x: { type: 'spring', stiffness: 280, damping: 30 },
              opacity: { duration: 0.2 },
            }}
            className="panel-slide"
          >
            {activeIdx === 0 && <YoutubeDownloader activeJobId={activeYoutubeJob} setShowLibrary={setShowLibrary} />}
            {activeIdx === 1 && <SpotifyDownloader activeDownloadId={activeSpotifyJob} />}
            {activeIdx === 2 && <AudioCutter initialPayload={cutterPayload} />}
            {activeIdx === 3 && <MassDownloader />}
            {activeIdx === 4 && <PlaylistAnalyzer liveBackground={liveBackground} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showLibrary && (
          <LibraryModal
            historyData={historyData}
            onClose={() => setShowLibrary(false)}
            onSendToCutter={handleSendToCutter}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showQueueModal && (
          <QueueModal onClose={() => setShowQueueModal(false)} />
        )}
      </AnimatePresence>


      <AnimatePresence>
        {showSettingsModal && (
          <SettingsModal
            onClose={saveSettings}
            activeTab={activeSettingsTab}
            setActiveTab={setActiveSettingsTab}
            /* General */
            customPath={customPath}
            handleSelectFolder={handleSelectFolder}
            audioFormat={audioFormat}
            setAudioFormat={setAudioFormat}
            audioQuality={audioQuality}
            setAudioQuality={setAudioQuality}
            /* Theme */
            customTheme={customTheme}
            setCustomTheme={setCustomTheme}
            liveBackground={liveBackground}
            setLiveBackground={setLiveBackground}
            auroraIntensity={auroraIntensity}
            setAuroraIntensity={setAuroraIntensity}
            auroraStyle={auroraStyle}
            setAuroraStyle={setAuroraStyle}
            colorPickerActiveRef={colorPickerActiveRef}
            colorPickerTimerRef={colorPickerTimerRef}
            /* System */
            downloadPreset={downloadPreset}
            setDownloadPreset={setDownloadPreset}
            hardwareAcceleration={hardwareAcceleration}
            setHardwareAcceleration={setHardwareAcceleration}
            handleUpdateEngine={handleUpdateEngine}
            saveConfigToBackend={saveConfigToBackend}
            /* YouTube */
            ytVideoQuality={ytVideoQuality}
            setYtVideoQuality={setYtVideoQuality}
            ytSubtitles={ytSubtitles}
            setYtSubtitles={setYtSubtitles}
            ytEmbedThumbnail={ytEmbedThumbnail}
            setYtEmbedThumbnail={setYtEmbedThumbnail}
            ytWriteThumbnail={ytWriteThumbnail}
            setYtWriteThumbnail={setYtWriteThumbnail}
            ytSponsorBlock={ytSponsorBlock}
            setYtSponsorBlock={setYtSponsorBlock}
            ytFilenameTemplate={ytFilenameTemplate}
            setYtFilenameTemplate={setYtFilenameTemplate}
            youtubePoToken={youtubePoToken}
            setYoutubePoToken={setYoutubePoToken}
            cookiesFromBrowser={cookiesFromBrowser}
            setCookiesFromBrowser={setCookiesFromBrowser}
            /* Spotify */
            spotDlEngine={spotDlEngine}
            setSpotDlEngine={setSpotDlEngine}
            spotDlLyrics={spotDlLyrics}
            setSpotDlLyrics={setSpotDlLyrics}
            spotDlArchive={spotDlArchive}
            setSpotDlArchive={setSpotDlArchive}
            /* Mass DL */
            massDlConcurrency={massDlConcurrency}
            setMassDlConcurrency={setMassDlConcurrency}
            massDlRetries={massDlRetries}
            setMassDlRetries={setMassDlRetries}
            massDlContinueOnError={massDlContinueOnError}
            setMassDlContinueOnError={setMassDlContinueOnError}
            massDlOutputFormat={massDlOutputFormat}
            setMassDlOutputFormat={setMassDlOutputFormat}
            massDlDelay={massDlDelay}
            setMassDlDelay={setMassDlDelay}
            /* Cutter */
            cutterOutputFormat={cutterOutputFormat}
            setCutterOutputFormat={setCutterOutputFormat}
            cutterFadeDuration={cutterFadeDuration}
            setCutterFadeDuration={setCutterFadeDuration}
            cutterNormalize={cutterNormalize}
            setCutterNormalize={setCutterNormalize}
            cutterBitrate={cutterBitrate}
            setCutterBitrate={setCutterBitrate}
            /* Rules */
            spotifyThreshold={spotifyThreshold}
            setSpotifyThreshold={setSpotifyThreshold}
            ytDlpFallbackEnabled={ytDlpFallbackEnabled}
            setYtDlpFallbackEnabled={setYtDlpFallbackEnabled}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showAdminPanel && (
          <AdminPanel onClose={() => setShowAdminPanel(false)} />
        )}
      </AnimatePresence>



      {/* Update Toast */}
      <AnimatePresence>
        {updateNotice && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="update-toast"
          >
            <div className="update-toast-icon">
              {updateNotice === 'available' ? <RefreshCw size={16} /> : <CheckCircle2 size={16} />}
            </div>
            <div className="update-toast-info">
              <div className="update-toast-title">
                {updateNotice === 'available' ? 'Update Available' : 'Update Ready'}
              </div>
              <div className="update-toast-desc">
                {updateNotice === 'available' ? 'A new version can be downloaded.' : 'Restart to install the new version.'}
              </div>
            </div>
            <button className="update-toast-btn" onClick={() => {
              setUpdateNotice(null);
              setShowSettingsModal(true);
              setActiveSettingsTab('updates');
            }}>
              View
            </button>
            <button className="update-toast-close" onClick={() => setUpdateNotice(null)}>
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Update Overlay */}
      <AnimatePresence>
        {showUpdateOverlay && (
          <UpdateOverlay
            status={updateState}
            progress={updateProgress}
            speed={updateSpeed}
            transferred={updateTransferred}
            total={updateTotal}
            info={updateInfo}
            onInstall={() => window.electronAPI?.updater?.installUpdate()}
            onDismiss={() => setShowUpdateOverlay(false)}
            onLater={() => setShowUpdateOverlay(false)}
          />
        )}
      </AnimatePresence>

      {/* Global Toast System */}
      <ToastSystem />

      {/* Background layer */}
      {liveBackground && !customTheme.customWallpaper && (
        <AuroraBackground activeColor={PLATFORMS[activeIdx]?.color} />
      )}
      {customTheme.customWallpaper && (
        <>
          {/* Wallpaper image — always full brightness */}
          <div style={{
            position: 'fixed', inset: 0, zIndex: -2,
            backgroundImage: `url(${customTheme.customWallpaper})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat'
          }} />
          {/* Dark overlay — controlled by Overlay Intensity slider */}
          <div style={{
            position: 'fixed', inset: 0, zIndex: -1,
            background: 'rgb(4, 6, 10)',
            opacity: (customTheme.wallpaperOpacity ?? 75) / 100
          }} />
        </>
      )}
    </div>
  );
}
