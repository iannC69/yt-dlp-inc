import { useEffect, useState, useCallback, useRef } from 'react';
import SetupWizard from './SetupWizard';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Settings, X, HelpCircle, ExternalLink, Palette, Library, FolderOpen, RefreshCw, ListVideo, CheckCircle2, Leaf, Scale, Zap, Rocket, Bot, Scissors, Layers, SlidersHorizontal, Cpu, Music2, Filter, Terminal, LayoutGrid, Globe, Check, Music, Folder, Link, Link2 } from 'lucide-react';
import YoutubeDownloader from './YoutubeDownloader';
import SpotifyDownloader from './SpotifyDownloader';
import AudioCutter from './AudioCutter';
import MassDownloader from './MassDownloader';
import LibraryModal from './LibraryModal';
import QueueModal from './QueueModal';
import LogsTab from './LogsTab';
import UpdatesTab from './UpdatesTab';
import UpdateOverlay from './UpdateOverlay';
import './App.css';
import { storage } from './storage';

const PLATFORMS = [
  {
    id: 'youtube',
    label: 'YouTube',
    color: '#ef4444',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
    ),
  },
  {
    id: 'spotify',
    label: 'Spotify',
    color: '#1DB954',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
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
];

const slideVariants = {
  enter: (dir) => ({ x: dir > 0 ? '100%' : '-100%', opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir) => ({ x: dir > 0 ? '-100%' : '100%', opacity: 0 }),
};

export default function App() {
  const [setupDone, setSetupDone] = useState(() => storage.getItem('setup_complete') === '1');
  const [activeIdx, setActiveIdx] = useState(0);
  const [direction, setDirection] = useState(1);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState('general');
  const [showLibrary, setShowLibrary] = useState(false);
  const [showQueueModal, setShowQueueModal] = useState(false);
  const [updateNotice, setUpdateNotice] = useState(null);
  const [showUpdateOverlay, setShowUpdateOverlay] = useState(false);
  const [updateState, setUpdateState] = useState('idle');
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateSpeed, setUpdateSpeed] = useState(0);
  const [updateInfo, setUpdateInfo] = useState({});
  const [historyData, setHistoryData] = useState([]);
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
    primary:     '#ef4444',
    secondary:   '#3b82f6',
    bgBase:      '#080a0f',
    panelColor:  '#0f111a',
    navColor:    '#06080e',
    textColor:   '#f1f5f9',
    borderColor: '#ffffff',
    // YouTube panel
    ytBg:        '#080a0f',
    ytAccent:    '#ef4444',
    ytSecondary: '#3b82f6',
    ytText:      '#f1f5f9',
    // Spotify panel
    spBg:        '#060a06',
    spAccent:    '#1DB954',
    spText:      '#f8fafc',
    // Mass DL panel
    mdBg:        '#07060f',
    mdAccent:    '#a855f7',
    mdSecondary: '#d946ef',
    mdText:      '#e2d9f3',
    // Audio Cutter panel
    acBg:        '#060910',
    acAccent:    '#22d3ee',
    acText:      '#d8e4f0',
  });
  const [showHelp, setShowHelp] = useState(false);
  const [activeYoutubeJob, setActiveYoutubeJob] = useState(null);
  const [activeSpotifyJob, setActiveSpotifyJob] = useState(null);

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
      if (data.success) alert('Engine-ul yt-dlp a fost actualizat cu succes!');
      else alert('Eroare la actualizare: ' + data.error);
    } catch (err) {
      alert('Eroare de rețea la actualizare.');
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
    }).catch(() => { });

    const savedTheme = storage.getItem('global_theme');
    if (savedTheme) {
      try { setCustomTheme(prev => ({ ...prev, ...JSON.parse(savedTheme) })); } catch {}
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
      .catch(() => {});
      
    const handleHistoryUpdate = () => fetchHistory();
    window.addEventListener('history_updated', handleHistoryUpdate);
    
    let cleanupUpdater = () => {};
    if (window.electronAPI && window.electronAPI.updater) {
      cleanupUpdater = window.electronAPI.updater.onUpdaterEvent((name, data) => {
        if (name === 'update-available') {
          setUpdateNotice('available');
          if (data) setUpdateInfo(data);
        }
        if (name === 'download-progress') {
          setUpdateNotice(null);
          setShowUpdateOverlay(true);
          setUpdateState('downloading');
          if (data && data.percent) setUpdateProgress(data.percent);
          if (data && data.bytesPerSecond) setUpdateSpeed(data.bytesPerSecond);
        }
        if (name === 'update-downloaded') {
          setUpdateNotice('downloaded');
          setUpdateState('downloaded');
          if (data) setUpdateInfo(data);
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

  useEffect(() => {
    const root = document.documentElement;
    const hexToRgb = (hex) => {
      let c = (hex || '#000000').replace('#', '');
      if (c.length === 3) c = c.split('').map(x => x + x).join('');
      const num = parseInt(c, 16);
      return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
    };

    // Global
    root.style.setProperty('--primary',      customTheme.primary);
    root.style.setProperty('--primary-dark',  customTheme.primary + 'CC');
    root.style.setProperty('--secondary',     customTheme.secondary);
    root.style.setProperty('--bg-base',       customTheme.bgBase);
    root.style.setProperty('--bg-panel',      customTheme.bgBase + 'F2');
    root.style.setProperty('--panel-color',   customTheme.panelColor  || '#0f111a');
    root.style.setProperty('--nav-color',     customTheme.navColor    || '#06080e');
    root.style.setProperty('--text-color',    customTheme.textColor   || '#f1f5f9');
    root.style.setProperty('--border-color',  customTheme.borderColor || '#ffffff');
    // YouTube
    root.style.setProperty('--theme-bg',      customTheme.ytBg     || '#080a0f');
    root.style.setProperty('--theme-primary', customTheme.ytAccent || '#ef4444');
    root.style.setProperty('--theme-secondary', customTheme.ytSecondary || '#3b82f6');
    root.style.setProperty('--yt-text',       customTheme.ytText   || '#f1f5f9');
    // Spotify
    root.style.setProperty('--sp-bg',         customTheme.spBg     || '#060a06');
    root.style.setProperty('--sp-green',      customTheme.spAccent || '#1DB954');
    root.style.setProperty('--sp-green-dim',  (customTheme.spAccent || '#1DB954') + '26');
    root.style.setProperty('--sp-text',       customTheme.spText   || '#f8fafc');
    // Mass DL
    root.style.setProperty('--md-bg',         customTheme.mdBg        || '#07060f');
    root.style.setProperty('--md-purple',     customTheme.mdAccent    || '#a855f7');
    root.style.setProperty('--md-purple-rgb', hexToRgb(customTheme.mdAccent || '#a855f7'));
    root.style.setProperty('--md-magenta',    customTheme.mdSecondary || '#d946ef');
    root.style.setProperty('--md-magenta-rgb',hexToRgb(customTheme.mdSecondary || '#d946ef'));
    root.style.setProperty('--md-text',       customTheme.mdText      || '#e2d9f3');
    // Audio Cutter
    root.style.setProperty('--ac-bg',         customTheme.acBg     || '#060910');
    root.style.setProperty('--ac-accent',     customTheme.acAccent || '#22d3ee');
    root.style.setProperty('--ac-accent-rgb', hexToRgb(customTheme.acAccent || '#22d3ee'));
    root.style.setProperty('--ac-text',       customTheme.acText   || '#d8e4f0');
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
    if (clientId)      setSpotifyClientId(clientId);
    if (clientSecret)  setSpotifyClientSecret(clientSecret);
    if (audioFormat)   setAudioFormat(audioFormat);
    if (audioQuality)  setAudioQuality(audioQuality);
    if (customPath)    setCustomPath(customPath);
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

  if (!setupDone) {
    return <SetupWizard onComplete={handleSetupComplete} />;
  }

  return (
    <div className="app-root">
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
            {activeIdx === 0 && <YoutubeDownloader activeJobId={activeYoutubeJob} />}
            {activeIdx === 1 && <SpotifyDownloader activeDownloadId={activeSpotifyJob} />}
            {activeIdx === 2 && <AudioCutter initialPayload={cutterPayload} />}
            {activeIdx === 3 && <MassDownloader />}
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
          <motion.div 
            className="settings-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(e) => { overlayMouseDownRef.current = e.target === e.currentTarget; }}
            onClick={(e) => { if (e.target === e.currentTarget && overlayMouseDownRef.current && !colorPickerActiveRef.current) { overlayMouseDownRef.current = false; setShowSettingsModal(false); } }}
          >
            <motion.div 
              className="settings-modal-content control-panel-mode"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="control-panel-sidebar">
                <h2>MediaDL</h2>
                <div className="cp-tab-section-label">General</div>
                {[
                  { id: 'general', label: 'General',        icon: <SlidersHorizontal size={14}/> },
                  { id: 'theme',   label: 'Appearance',     icon: <Palette size={14}/> },
                  { id: 'system',  label: 'System & Engine', icon: <Cpu size={14}/> },
                ].map(t => (
                  <button key={t.id} className={`cp-tab ${activeSettingsTab === t.id ? 'active' : ''}`} onClick={() => setActiveSettingsTab(t.id)}>
                    <span className="cp-tab-icon">{t.icon}</span>{t.label}
                  </button>
                ))}
                <div className="cp-tab-section-label">Modules</div>
                {[
                  { id: 'youtube', label: 'YouTube',      icon: <Play size={14}/> },
                  { id: 'spotify', label: 'Spotify',      icon: <Music2 size={14}/> },
                  { id: 'massdl',  label: 'Mass DL',      icon: <Layers size={14}/> },
                  { id: 'cutter',  label: 'Audio Cutter', icon: <Scissors size={14}/> },
                ].map(t => (
                  <button key={t.id} className={`cp-tab ${activeSettingsTab === t.id ? 'active' : ''}`} onClick={() => setActiveSettingsTab(t.id)}>
                    <span className="cp-tab-icon">{t.icon}</span>{t.label}
                  </button>
                ))}
                <div className="cp-tab-section-label">Advanced</div>
                {[
                  { id: 'rules', label: 'Download Rules', icon: <Filter size={14}/> },
                  { id: 'logs',  label: 'Logs',           icon: <Terminal size={14}/> },
                  { id: 'updates', label: 'Updates',      icon: <RefreshCw size={14}/> },
                ].map(t => (
                  <button key={t.id} className={`cp-tab ${activeSettingsTab === t.id ? 'active' : ''}`} onClick={() => setActiveSettingsTab(t.id)}>
                    <span className="cp-tab-icon">{t.icon}</span>{t.label}
                  </button>
                ))}
              </div>

              <div className="control-panel-body">
                <div className="control-panel-header">
                  <div>
                    <h3 className="cp-title">
                      {activeSettingsTab === 'general' && 'General'}
                      {activeSettingsTab === 'rules' && 'Download Rules'}
                      {activeSettingsTab === 'theme' && 'Appearance'}
                      {activeSettingsTab === 'spotify' && 'Spotify'}
                      {activeSettingsTab === 'system' && 'System & Engine'}
                      {activeSettingsTab === 'logs' && 'Server Logs'}
                      {activeSettingsTab === 'youtube' && 'YouTube'}
                      { activeSettingsTab === 'massdl' && 'Mass Download' }
                      { activeSettingsTab === 'cutter' && 'Audio Cutter' }
                      { activeSettingsTab === 'updates' && 'Software Update' }
                    </h3>
                    <div style={{ fontSize: '0.75rem', color: '#52525b', marginTop: '2px' }}>
                      {activeSettingsTab === 'general' && 'Download path, format and quality defaults'}
                      {activeSettingsTab === 'rules' && 'Naming patterns and quality filters'}
                      {activeSettingsTab === 'theme' && 'Colors, presets and panel customization'}
                      {activeSettingsTab === 'spotify' && 'API credentials and search behavior (Updater Test v1.0.3!)'}
                      {activeSettingsTab === 'system' && 'Engine performance and hardware settings'}
                      {activeSettingsTab === 'logs' && 'Live server output and error trace'}
                      {activeSettingsTab === 'youtube' && 'Default quality, format and playlist options'}
                      { activeSettingsTab === 'massdl' && 'Concurrency, retry and batch behavior' }
                      { activeSettingsTab === 'cutter' && 'Export format, fade and waveform settings' }
                      { activeSettingsTab === 'updates' && 'Check for app updates and releases' }
                    </div>
                  </div>
                  <button className="settings-modal-close" onClick={() => setShowSettingsModal(false)}>
                    <X size={18} />
                  </button>
                </div>
                
                <div className="settings-scroll-content">
                  {activeSettingsTab === 'general' && (
                    <div className="settings-section">
                      <div className="settings-field">
                        <label className="settings-label-row">Download Directory (Local)</label>
                        <div className="settings-path-picker">
                          <input
                            type="text"
                            readOnly
                            value={customPath || 'Mod Implicit (Folderul Aplicației/downloads)'}
                            className="settings-input"
                            title={customPath}
                          />
                          <button className="settings-save-btn" onClick={handleSelectFolder} style={{ width: 'auto', padding: '0.5rem 1rem' }}>
                            <FolderOpen size={16} style={{ display: 'inline', marginRight: '4px' }} /> Folder
                          </button>
                        </div>
                      </div>

                      <div className="settings-field" style={{ marginTop: '20px' }}>
                        <label className="settings-label-row">Audio Format</label>
                        <div className="settings-hw-toggle">
                          {['mp3', 'm4a', 'flac', 'wav', 'opus'].map(f => (
                            <button
                              key={f}
                              className={`settings-hw-btn ${audioFormat === f ? 'active' : ''}`}
                              onClick={() => {
                                setAudioFormat(f);
                                storage.setItem('audioFormat', f);
                              }}
                            >
                              {f.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      <div className="settings-field">
                        <label className="settings-label-row">Audio Quality (Bitrate)</label>
                        <div className="settings-hw-toggle">
                          {[
                            { value: '320k', label: '320k (High)' },
                            { value: '256k', label: '256k' },
                            { value: '192k', label: '192k (Std)' },
                            { value: '128k', label: '128k (Low)' }
                          ].map(q => (
                            <button
                              key={q.value}
                              className={`settings-hw-btn ${audioQuality === q.value ? 'active' : ''}`}
                              onClick={() => {
                                setAudioQuality(q.value);
                                storage.setItem('audioQuality', q.value);
                              }}
                            >
                              {q.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeSettingsTab === 'rules' && (
                    <div className="settings-section">
                      <div className="settings-field">
                        <label>Spotify Threshold (spotdl)</label>
                        <p className="settings-hint" style={{ marginBottom: '8px' }}>
                          If a Spotify playlist has fewer tracks than this number, we'll try to download the tracks directly from Spotify via spotdl instead of searching on YouTube.
                        </p>
                        <input
                          type="number"
                          className="settings-input"
                          value={spotifyThreshold}
                          onChange={e => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val)) {
                              setSpotifyThreshold(val);
                              saveConfigToBackend({ spotifyThreshold: val });
                            }
                          }}
                        />
                      </div>
                      <div className="settings-field" style={{ marginTop: '20px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={ytDlpFallbackEnabled}
                            onChange={e => {
                              setYtDlpFallbackEnabled(e.target.checked);
                              saveConfigToBackend({ ytDlpFallbackEnabled: e.target.checked });
                            }}
                          />
                          Enable yt-dlp fallback
                        </label>
                        <p className="settings-hint">
                          If spotdl fails to download a track, fallback to finding it on YouTube with yt-dlp.
                        </p>
                      </div>
                    </div>
                  )}

                  {activeSettingsTab === 'logs' && (
                    <div className="settings-section" style={{ height: '400px', padding: 0 }}>
                      <LogsTab />
                    </div>
                  )}

                  {activeSettingsTab === 'updates' && (
                    <UpdatesTab />
                  )}

                  {activeSettingsTab === 'theme' && (() => {
                    const DEFAULTS = {
                      primary:'#ef4444', secondary:'#3b82f6', bgBase:'#080a0f',
                      panelColor:'#0f111a', navColor:'#06080e', textColor:'#f1f5f9', borderColor:'#ffffff',
                      ytBg:'#080a0f', ytAccent:'#ef4444',
                      spBg:'#060a06', spAccent:'#1DB954',
                      mdBg:'#07060f', mdAccent:'#a855f7', mdSecondary:'#d946ef',
                      acBg:'#060910', acAccent:'#22d3ee',
                    }
                    const PRESETS = [
                      { label:'Default', primary:'#ef4444', bgBase:'#080a0f', panelColor:'#0f111a', navColor:'#06080e', textColor:'#f1f5f9', borderColor:'#ffffff' },
                      { label:'Blue',    primary:'#3b82f6', bgBase:'#080c18', panelColor:'#0a0f20', navColor:'#050810', textColor:'#e2e8f0', borderColor:'#3b82f6' },
                      { label:'Purple',  primary:'#a855f7', bgBase:'#0d0814', panelColor:'#110c1a', navColor:'#07050e', textColor:'#f5f3ff', borderColor:'#a855f7' },
                      { label:'Green',   primary:'#22c55e', bgBase:'#06110a', panelColor:'#080f0b', navColor:'#040b06', textColor:'#ecfdf5', borderColor:'#22c55e' },
                      { label:'Midnight',primary:'#818cf8', bgBase:'#0f0f23', panelColor:'#141428', navColor:'#0a0a1a', textColor:'#e0e7ff', borderColor:'#4f46e5' },
                      { label:'Nord',    primary:'#88c0d0', bgBase:'#1a1d2e', panelColor:'#212338', navColor:'#151726', textColor:'#eceff4', borderColor:'#5e81ac' },
                      { label:'Amber',   primary:'#f59e0b', bgBase:'#100c04', panelColor:'#1a1408', navColor:'#0c0900', textColor:'#fef3c7', borderColor:'#f59e0b' },
                      { label:'Rose',    primary:'#fb7185', bgBase:'#120811', panelColor:'#1a0c18', navColor:'#0e050d', textColor:'#ffe4e6', borderColor:'#fb7185' },
                    ]
                    const activePreset = PRESETS.find(p => p.primary === customTheme.primary && p.bgBase === customTheme.bgBase)

                    const armColorPicker = () => {
                      colorPickerActiveRef.current = true;
                      clearTimeout(colorPickerTimerRef.current);
                      // Safety fallback: always disarm after 6s
                      colorPickerTimerRef.current = setTimeout(() => { colorPickerActiveRef.current = false; }, 6000);
                    };
                    const onColorChange = (stateKey, val) => {
                      setCustomTheme(prev => ({ ...prev, [stateKey]: val }));
                      // change fires when OS picker closes after selection — disarm shortly after
                      clearTimeout(colorPickerTimerRef.current);
                      colorPickerTimerRef.current = setTimeout(() => { colorPickerActiveRef.current = false; }, 600);
                    };

                    const renderCPicker = (stateKey, label) => (
                      <div className="cp-color-row" key={stateKey}>
                        <div className="cp-color-swatch-wrap" onMouseDown={armColorPicker}>
                          <input type="color"
                            value={customTheme[stateKey] || '#000000'}
                            onChange={e => onColorChange(stateKey, e.target.value)}
                            title={label}
                          />
                          <div className="cp-color-swatch-preview" style={{ background: customTheme[stateKey] || '#000000' }} />
                        </div>
                        <span className="cp-color-label">{label}</span>
                        <input type="text" className="cp-color-hex"
                          value={(customTheme[stateKey] || '#000000').toUpperCase()}
                          onChange={e => { if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) setCustomTheme(prev => ({ ...prev, [stateKey]: e.target.value })); }}
                          maxLength={7}
                        />
                      </div>
                    )

                    const renderPanelSection = (title, icon, children) => (
                      <div className="cp-panel-section" key={title}>
                        <div className="cp-panel-section-title"><span style={{display:'flex',alignItems:'center',gap:'6px'}}>{icon}<span>{title}</span></span></div>
                        <div className="cp-color-grid">{children}</div>
                      </div>
                    )

                    return (
                      <div>
                        <div className="settings-field" style={{ marginBottom: '14px' }}>
                          <label className="settings-label-row" style={{ marginBottom: '8px' }}>Quick Presets</label>
                          <div className="settings-swatch-grid">
                            {PRESETS.map(t => (
                              <button key={t.label}
                                className={`settings-swatch ${activePreset?.label === t.label ? 'active' : ''}`}
                                style={{ '--swatch-color': t.primary }}
                                onClick={() => setCustomTheme(prev => ({ ...prev, ...t }))}
                                title={t.label}
                              >
                                <span className="settings-swatch-dot" />
                                <span className="settings-swatch-label">{t.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {renderPanelSection("Global", <Globe size={11}/>, [
                          renderCPicker("primary", "Accent / Buttons"),
                          renderCPicker("bgBase", "App Background"),
                          renderCPicker("panelColor", "Panel / Card"),
                          renderCPicker("navColor", "Navbar"),
                          renderCPicker("textColor", "Primary Text"),
                          renderCPicker("borderColor", "Borders & Glow")
                        ])}

                        {renderPanelSection("YouTube Panel", <Play size={11}/>, [
                          renderCPicker("ytBg", "Background"),
                          renderCPicker("ytAccent", "Accent color"),
                          renderCPicker("ytSecondary", "Secondary color"),
                          renderCPicker("ytText", "Text color")
                        ])}

                        {renderPanelSection("Spotify Panel", <Music2 size={11}/>, [
                          renderCPicker("spBg", "Background"),
                          renderCPicker("spAccent", "Accent / Green"),
                          renderCPicker("spText", "Text color")
                        ])}

                        {renderPanelSection("Mass DL Panel", <Layers size={11}/>, [
                          renderCPicker("mdBg", "Background"),
                          renderCPicker("mdAccent", "Purple accent"),
                          renderCPicker("mdSecondary", "Magenta accent"),
                          renderCPicker("mdText", "Text color")
                        ])}

                        {renderPanelSection("Audio Cutter Panel", <Scissors size={11}/>, [
                          renderCPicker("acBg", "Background"),
                          renderCPicker("acAccent", "Cyan accent"),
                          renderCPicker("acText", "Text color")
                        ])}

                        <button className="settings-reset-btn" style={{ marginTop: '8px' }}
                          onClick={() => setCustomTheme(DEFAULTS)}>
                          <RefreshCw size={13} /> Reset All to Default
                        </button>
                      </div>
                    )
                  })()}

                  {activeSettingsTab === 'spotify' && (
                    <div className="settings-section">
                      <div className="settings-cred-header">
                        <div className="settings-cred-status">
                          <span className={`settings-cred-dot ok`} />
                          <span className="settings-cred-status-label">Pre-configured integration</span>
                        </div>
                      </div>
                      <p className="settings-hint" style={{ color: '#1DB954', fontWeight: 500, margin: '16px 0' }}>
                        <CheckCircle2 size={14} style={{ display: 'inline-block', verticalAlign: 'text-bottom', marginRight: 4 }} />
                        Spotify integration is fully configured! Head over to the Spotify tab and click "Login" to sync your playlists and albums.
                      </p>
                      <div className="settings-field" style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '18px' }}>
                        <label className="settings-label-row">Download Engine Priority</label>
                        <div className="settings-hw-toggle">
                          {[
                            { value: 'spotdl', label: 'spotdl first' },
                            { value: 'ytdlp', label: 'yt-dlp first' },
                          ].map(e => (
                            <button key={e.value} className={`settings-hw-btn ${spotDlEngine === e.value ? 'active' : ''}`}
                              onClick={() => { setSpotDlEngine(e.value); storage.setItem('spotdl_engine', e.value); }}>
                              {e.label}
                            </button>
                          ))}
                        </div>
                        <p className="settings-hint">spotdl gives higher quality matches; yt-dlp is faster and more reliable.</p>
                      </div>
                      <div className="settings-field">
                        <label style={{ display:'flex', alignItems:'center', gap:'8px', cursor:'pointer' }}>
                          <input type="checkbox" checked={spotDlLyrics}
                            onChange={e => { setSpotDlLyrics(e.target.checked); storage.setItem('spotdl_lyrics', String(e.target.checked)); }} />
                          Embed lyrics in downloaded tracks
                        </label>
                      </div>
                      <div className="settings-field">
                        <label style={{ display:'flex', alignItems:'center', gap:'8px', cursor:'pointer' }}>
                          <input type="checkbox" checked={spotDlArchive}
                            onChange={e => { setSpotDlArchive(e.target.checked); storage.setItem('spotdl_archive', String(e.target.checked)); }} />
                          Skip already downloaded tracks (archive mode)
                        </label>
                        <p className="settings-hint">Keeps a record of downloaded tracks and skips re-downloads when syncing playlists.</p>
                      </div>
                    </div>
                  )}

                  {activeSettingsTab === 'youtube' && (
                    <div className="settings-section">
                      <div className="settings-field">
                        <label className="settings-label-row">Default Video Quality</label>
                        <div className="settings-preset-cards">
                          {[
                            { value: 'best', label: 'Best', sub: 'Auto highest' },
                            { value: '2160p', label: '4K', sub: '2160p' },
                            { value: '1080p', label: '1080p', sub: 'Full HD' },
                            { value: '720p', label: '720p', sub: 'HD' },
                            { value: '480p', label: '480p', sub: 'SD' },
                          ].map(q => (
                            <button
                              key={q.value}
                              className={`settings-preset-card ${ytVideoQuality === q.value ? 'active' : ''}`}
                              onClick={() => { setYtVideoQuality(q.value); storage.setItem('yt_video_quality', q.value); }}
                            >
                              <span className="settings-preset-label">{q.label}</span>
                              <span className="settings-preset-sub">{q.sub}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="settings-field">
                        <label className="settings-label-row">Subtitle Download</label>
                        <div className="settings-hw-toggle">
                          {[
                            { value: 'off', label: 'Off' },
                            { value: 'auto', label: 'Auto' },
                            { value: 'en', label: 'English' },
                            { value: 'ro', label: 'Romanian' },
                            { value: 'all', label: 'All langs' },
                          ].map(s => (
                            <button key={s.value} className={`settings-hw-btn ${ytSubtitles === s.value ? 'active' : ''}`}
                              onClick={() => { setYtSubtitles(s.value); storage.setItem('yt_subtitles', s.value); }}>
                              {s.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="settings-field">
                        <label className="settings-label-row">Filename Template</label>
                        <input
                          type="text"
                          className="settings-input"
                          value={ytFilenameTemplate}
                          onChange={e => { setYtFilenameTemplate(e.target.value); storage.setItem('yt_filename_template', e.target.value); }}
                          placeholder="%(title)s"
                        />
                        <p className="settings-hint">yt-dlp output template. Variables: %(title)s %(uploader)s %(id)s %(ext)s</p>
                      </div>
                      <div className="settings-field">
                        <label style={{ display:'flex', alignItems:'center', gap:'8px', cursor:'pointer' }}>
                          <input type="checkbox" checked={ytEmbedThumbnail}
                            onChange={e => { setYtEmbedThumbnail(e.target.checked); storage.setItem('yt_embed_thumbnail', String(e.target.checked)); }} />
                          Embed thumbnail in audio files
                        </label>
                      </div>
                      <div className="settings-field">
                        <label style={{ display:'flex', alignItems:'center', gap:'8px', cursor:'pointer' }}>
                          <input type="checkbox" checked={ytWriteThumbnail}
                            onChange={e => { setYtWriteThumbnail(e.target.checked); storage.setItem('yt_write_thumbnail', String(e.target.checked)); }} />
                          Save thumbnail as separate image file
                        </label>
                      </div>
                      <div className="settings-field">
                        <label style={{ display:'flex', alignItems:'center', gap:'8px', cursor:'pointer' }}>
                          <input type="checkbox" checked={ytSponsorBlock}
                            onChange={e => { setYtSponsorBlock(e.target.checked); storage.setItem('yt_sponsorblock', String(e.target.checked)); }} />
                          SponsorBlock — mark/remove sponsor segments
                        </label>
                        <p className="settings-hint">Removes sponsor, intro, and self-promo segments from downloaded videos.</p>
                      </div>
                      <div className="settings-field">
                        <label className="settings-label-row">YouTube PO Token (optional)</label>
                        <input
                          type="text"
                          className="settings-input"
                          value={youtubePoToken}
                          onChange={e => {
                            setYoutubePoToken(e.target.value);
                            saveConfigToBackend({ youtubePoToken: e.target.value });
                          }}
                          placeholder="PO_TOKEN"
                        />
                        <p className="settings-hint">Passes the Proof of Origin token to bypass bot detection on some connections.</p>
                      </div>
                      <div className="settings-field" style={{ marginTop: '20px' }}>
                        <label className="settings-label-row">Browser Cookies</label>
                        <button className="settings-save-btn" onClick={async () => {
                          try {
                            const res = await fetch('/api/cookies/import', { method: 'POST' });
                            const data = await res.json();
                            if (data.success) alert('Cookies imported successfully!');
                            else alert('Failed to import cookies: ' + data.error);
                          } catch (e) {
                            alert('Network error while importing cookies.');
                          }
                        }} style={{ width: 'auto', padding: '0.5rem 1rem' }}>
                          Import cookies from Chrome
                        </button>
                        <p className="settings-hint">Imports YouTube cookies from Chrome to help bypass restrictions.</p>
                      </div>
                    </div>
                  )}

                  {activeSettingsTab === 'massdl' && (
                    <div className="settings-section">
                      <div className="settings-field">
                        <label className="settings-label-row">Default Audio Format</label>
                        <div className="settings-hw-toggle">
                          {['mp3','flac','m4a','wav','opus'].map(f => (
                            <button key={f} className={`settings-hw-btn ${massDlOutputFormat === f ? 'active' : ''}`}
                              onClick={() => { setMassDlOutputFormat(f); storage.setItem('massdl_output_format', f); }}>
                              {f.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="settings-field">
                        <label className="settings-label-row">Max Concurrent Downloads — <strong style={{color:'#f4f4f5'}}>{massDlConcurrency}</strong></label>
                        <input type="range" min="1" max="20" value={massDlConcurrency}
                          onChange={e => { setMassDlConcurrency(+e.target.value); storage.setItem('massdl_concurrency', e.target.value); }}
                          style={{ width:'100%', accentColor:'var(--primary)' }}
                        />
                        <p className="settings-hint">Higher = faster downloads but more CPU and RAM usage. Recommended: 3–8.</p>
                      </div>
                      <div className="settings-field">
                        <label className="settings-label-row">Delay Between Downloads — <strong style={{color:'#f4f4f5'}}>{massDlDelay}s</strong></label>
                        <input type="range" min="0" max="10" value={massDlDelay}
                          onChange={e => { setMassDlDelay(+e.target.value); storage.setItem('massdl_delay', e.target.value); }}
                          style={{ width:'100%', accentColor:'var(--primary)' }}
                        />
                        <p className="settings-hint">Adds a pause between each download to avoid rate limiting.</p>
                      </div>
                      <div className="settings-field">
                        <label className="settings-label-row">Max Retries per Failed Track</label>
                        <div className="settings-hw-toggle">
                          {[0,1,2,3,5].map(n => (
                            <button key={n} className={`settings-hw-btn ${massDlRetries === n ? 'active' : ''}`}
                              onClick={() => { setMassDlRetries(n); storage.setItem('massdl_retries', String(n)); }}>
                              {n}×
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="settings-field">
                        <label style={{ display:'flex', alignItems:'center', gap:'8px', cursor:'pointer' }}>
                          <input type="checkbox" checked={massDlContinueOnError}
                            onChange={e => { setMassDlContinueOnError(e.target.checked); storage.setItem('massdl_continue_on_error', String(e.target.checked)); }} />
                          Continue batch on error
                        </label>
                        <p className="settings-hint">If a track fails all retries, skip it and continue with the rest instead of stopping.</p>
                      </div>
                    </div>
                  )}

                  {activeSettingsTab === 'cutter' && (
                    <div className="settings-section">
                      <div className="settings-field">
                        <label className="settings-label-row">Default Export Format</label>
                        <div className="settings-hw-toggle">
                          {['mp3','flac','wav','m4a','opus'].map(f => (
                            <button key={f} className={`settings-hw-btn ${cutterOutputFormat === f ? 'active' : ''}`}
                              onClick={() => { setCutterOutputFormat(f); storage.setItem('cutter_output_format', f); }}>
                              {f.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="settings-field">
                        <label className="settings-label-row">Default Export Bitrate</label>
                        <div className="settings-hw-toggle">
                          {['320k','256k','192k','128k'].map(q => (
                            <button key={q} className={`settings-hw-btn ${cutterBitrate === q ? 'active' : ''}`}
                              onClick={() => { setCutterBitrate(q); storage.setItem('cutter_bitrate', q); }}>
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="settings-field">
                        <label className="settings-label-row">Default Fade In/Out — <strong style={{color:'#f4f4f5'}}>{cutterFadeDuration}ms</strong></label>
                        <input type="range" min="0" max="3000" step="50" value={cutterFadeDuration}
                          onChange={e => { setCutterFadeDuration(+e.target.value); storage.setItem('cutter_fade_duration', e.target.value); }}
                          style={{ width:'100%', accentColor:'var(--primary)' }}
                        />
                        <p className="settings-hint">Applied automatically when exporting cuts. Set to 0 to disable.</p>
                      </div>
                      <div className="settings-field">
                        <label style={{ display:'flex', alignItems:'center', gap:'8px', cursor:'pointer' }}>
                          <input type="checkbox" checked={cutterNormalize}
                            onChange={e => { setCutterNormalize(e.target.checked); storage.setItem('cutter_normalize', String(e.target.checked)); }} />
                          Normalize audio loudness on export
                        </label>
                        <p className="settings-hint">Uses FFmpeg loudnorm filter to bring volume to a consistent level.</p>
                      </div>
                    </div>
                  )}

                  {activeSettingsTab === 'system' && (
                    <div className="settings-section">
                      <div className="settings-field">
                        <label className="settings-label-row">Download Speed Preset</label>
                        <div className="settings-preset-cards">
                          {[
                            { value: 'ECO', label: 'Eco', sub: 'Low CPU', icon: <Leaf size={18} /> },
                            { value: 'BALANCED', label: 'Balanced', sub: 'Recommended', icon: <Scale size={18} /> },
                            { value: 'HIGH_PERFORMANCE', label: 'Fast', sub: 'High CPU', icon: <Zap size={18} /> },
                            { value: 'ULTRA_PERFORMANCE', label: 'Ultra', sub: 'Max speed', icon: <Rocket size={18} /> },
                            { value: 'AUTO', label: 'Auto', sub: 'AI decides', icon: <Bot size={18} /> },
                          ].map(p => (
                            <button
                              key={p.value}
                              className={`settings-preset-card ${downloadPreset === p.value ? 'active' : ''}`}
                              onClick={() => setDownloadPreset(p.value)}
                            >
                              <span className="settings-preset-icon">{p.icon}</span>
                              <span className="settings-preset-label">{p.label}</span>
                              <span className="settings-preset-sub">{p.sub}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="settings-field">
                        <label className="settings-label-row">Hardware Acceleration (FFmpeg)</label>
                        <div className="settings-hw-toggle">
                          {[
                            { value: 'NONE', label: 'CPU Only' },
                            { value: 'AUTO', label: 'Auto' },
                            { value: 'CUDA', label: 'NVIDIA' },
                            { value: 'AMF', label: 'AMD' },
                            { value: 'QSV', label: 'Intel' },
                          ].map(h => (
                            <button
                              key={h.value}
                              className={`settings-hw-btn ${hardwareAcceleration === h.value ? 'active' : ''}`}
                              onClick={() => setHardwareAcceleration(h.value)}
                            >
                              {h.label}
                            </button>
                          ))}
                        </div>
                        <p className="settings-hint">GPU encoding speeds up video conversion. MP3 is always CPU.</p>
                      </div>
                      <div className="settings-field">
                        <label className="settings-label-row">Engine (yt-dlp)</label>
                        <button
                          className="settings-update-btn"
                          onClick={handleUpdateEngine}
                        >
                          <RefreshCw size={15} /> Check for Updates
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="control-panel-footer">
                  <button className="settings-save-btn settings-save-btn--cta" onClick={saveSettings}>
                    <CheckCircle2 size={16} /> Save Settings
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
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
            info={updateInfo}
            onInstall={() => window.electronAPI.updater.installUpdate()}
            onDismiss={() => setShowUpdateOverlay(false)}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
