import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Settings, X, HelpCircle, ExternalLink, Palette, Library, FolderOpen, RefreshCw, ListVideo, CheckCircle2, Leaf, Scale, Zap, Rocket, Bot, Scissors } from 'lucide-react';
import YoutubeDownloader from './YoutubeDownloader';
import SpotifyDownloader from './SpotifyDownloader';
import AudioCutter from './AudioCutter';
import LibraryModal from './LibraryModal';
import QueueModal from './QueueModal';
import './App.css';

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
];

const slideVariants = {
  enter: (dir) => ({ x: dir > 0 ? '100%' : '-100%', opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir) => ({ x: dir > 0 ? '-100%' : '100%', opacity: 0 }),
};

export default function App() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [direction, setDirection] = useState(1);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState('general');
  const [showLibrary, setShowLibrary] = useState(false);
  const [showQueueModal, setShowQueueModal] = useState(false);
  const [historyData, setHistoryData] = useState([]);
  
  const [spotifyClientId, setSpotifyClientId] = useState('');
  const [spotifyClientSecret, setSpotifyClientSecret] = useState('');
  const [downloadPreset, setDownloadPreset] = useState('AUTO');
  const [hardwareAcceleration, setHardwareAcceleration] = useState('NONE');
  const [customPath, setCustomPath] = useState('');
  const [customTheme, setCustomTheme] = useState({ primary: '#ef4444', secondary: '#3b82f6', bgBase: '#080a0f' });
  const [showHelp, setShowHelp] = useState(false);
  const [activeYoutubeJob, setActiveYoutubeJob] = useState(null);
  const [activeSpotifyJob, setActiveSpotifyJob] = useState(null);

  const fetchHistory = () => {
    try {
      const saved = localStorage.getItem('global_history');
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
    setSpotifyClientId(localStorage.getItem('spotify_client_id') || '');
    setSpotifyClientSecret(localStorage.getItem('spotify_client_secret') || '');
    setDownloadPreset(localStorage.getItem('download_preset') || 'AUTO');
    setHardwareAcceleration(localStorage.getItem('hardware_acceleration') || 'NONE');

    fetch('/api/ytdl/get-config').then(r => r.json()).then(data => {
      if (data.customPath) setCustomPath(data.customPath);
    }).catch(() => { });

    const savedTheme = localStorage.getItem('global_theme');
    if (savedTheme) {
      try {
        setCustomTheme(JSON.parse(savedTheme));
      } catch (e) {}
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
    return () => window.removeEventListener('history_updated', handleHistoryUpdate);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--primary', customTheme.primary);
    root.style.setProperty('--primary-dark', customTheme.primary + 'CC');
    root.style.setProperty('--secondary', customTheme.secondary);
    root.style.setProperty('--bg-base', customTheme.bgBase);
    root.style.setProperty('--bg-panel', customTheme.bgBase + 'F2'); // add opacity
  }, [customTheme]);

  const saveSettings = () => {
    localStorage.setItem('spotify_client_id', spotifyClientId.trim());
    localStorage.setItem('spotify_client_secret', spotifyClientSecret.trim());
    localStorage.setItem('download_preset', downloadPreset);
    localStorage.setItem('hardware_acceleration', hardwareAcceleration);
    localStorage.setItem('global_theme', JSON.stringify(customTheme));
    setShowSettingsModal(false);
  };

  const isConfigured = spotifyClientId.trim() !== '' && spotifyClientSecret.trim() !== '';

  const switchTo = (idx) => {
    if (idx === activeIdx) return;
    setDirection(idx > activeIdx ? 1 : -1);
    setActiveIdx(idx);
  };

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
              <span className="settings-status-dot" style={{ backgroundColor: isConfigured ? '#1DB954' : '#ef4444' }} />
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
            {activeIdx === 2 && <AudioCutter />}
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showLibrary && (
          <LibraryModal historyData={historyData} onClose={() => setShowLibrary(false)} />
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
            onClick={(e) => e.target === e.currentTarget && setShowSettingsModal(false)}
          >
            <motion.div 
              className="settings-modal-content control-panel-mode"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <div className="control-panel-sidebar">
                <h2>Setări</h2>
                <button className={`cp-tab ${activeSettingsTab === 'general' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('general')}>General</button>
                <button className={`cp-tab ${activeSettingsTab === 'theme' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('theme')}>Temă & Aspect</button>
                <button className={`cp-tab ${activeSettingsTab === 'spotify' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('spotify')}>Spotify API</button>
                <button className={`cp-tab ${activeSettingsTab === 'system' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('system')}>Sistem & Motor</button>
              </div>

              <div className="control-panel-body">
                <div className="control-panel-header">
                  <h3 className="cp-title">
                    {activeSettingsTab === 'general' && 'General'}
                    {activeSettingsTab === 'theme' && 'Personalizare Temă'}
                    {activeSettingsTab === 'spotify' && 'Conexiune Spotify'}
                    {activeSettingsTab === 'system' && 'Sistem & Motor'}
                  </h3>
                  <button className="settings-modal-close" onClick={() => setShowSettingsModal(false)}>
                    <X size={18} />
                  </button>
                </div>
                
                <div className="settings-scroll-content">
                  {activeSettingsTab === 'general' && (
                    <div className="settings-section">
                      <h3>Director descărcări (Local)</h3>
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
                  )}

                  {activeSettingsTab === 'theme' && (
                    <div className="settings-section">
                      <div className="settings-field">
                        <label className="settings-label-row">Theme Presets</label>
                        <div className="settings-swatch-grid">
                          {[
                            { label: 'Red', primary: '#ef4444', bgBase: '#0a080f' },
                            { label: 'Green', primary: '#22c55e', bgBase: '#06110a' },
                            { label: 'Blue', primary: '#3b82f6', bgBase: '#080c18' },
                            { label: 'Purple', primary: '#a855f7', bgBase: '#0d0814' },
                            { label: 'Orange', primary: '#f97316', bgBase: '#110a05' },
                            { label: 'Cyan', primary: '#06b6d4', bgBase: '#04101a' },
                          ].map(t => (
                            <button
                              key={t.label}
                              className={`settings-swatch ${customTheme.primary === t.primary ? 'active' : ''}`}
                              style={{ '--swatch-color': t.primary }}
                              onClick={() => setCustomTheme(prev => ({ ...prev, primary: t.primary, bgBase: t.bgBase }))}
                              title={t.label}
                            >
                              <span className="settings-swatch-dot" />
                              <span className="settings-swatch-label">{t.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="settings-theme-pickers">
                        <div className="settings-color-picker-item">
                          <label>Accent Color</label>
                          <div className="settings-color-input-wrapper">
                            <input
                              type="color"
                              value={customTheme.primary}
                              onChange={(e) => setCustomTheme(prev => ({ ...prev, primary: e.target.value }))}
                            />
                            <input
                              type="text"
                              className="settings-hex-input"
                              value={customTheme.primary.toUpperCase()}
                              onChange={(e) => { if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) setCustomTheme(prev => ({ ...prev, primary: e.target.value })); }}
                              maxLength={7}
                            />
                          </div>
                        </div>
                        <div className="settings-color-picker-item">
                          <label>Background</label>
                          <div className="settings-color-input-wrapper">
                            <input
                              type="color"
                              value={customTheme.bgBase}
                              onChange={(e) => setCustomTheme(prev => ({ ...prev, bgBase: e.target.value }))}
                            />
                            <input
                              type="text"
                              className="settings-hex-input"
                              value={customTheme.bgBase.toUpperCase()}
                              onChange={(e) => { if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) setCustomTheme(prev => ({ ...prev, bgBase: e.target.value })); }}
                              maxLength={7}
                            />
                          </div>
                        </div>
                      </div>
                      <button
                        className="settings-reset-btn"
                        onClick={() => setCustomTheme({ primary: '#ef4444', secondary: '#3b82f6', bgBase: '#080a0f' })}
                      >
                        <RefreshCw size={13} /> Reset to Default
                      </button>
                    </div>
                  )}

                  {activeSettingsTab === 'spotify' && (
                    <div className="settings-section">
                      <div className="settings-cred-header">
                        <div className="settings-cred-status">
                          <span className={`settings-cred-dot ${isConfigured ? 'ok' : 'err'}`} />
                          <span className="settings-cred-status-label">{isConfigured ? 'Connected' : 'Not configured'}</span>
                        </div>
                        <button className="settings-help-btn" onClick={() => setShowHelp(!showHelp)} title="How to get these?">
                          <HelpCircle size={15} />
                        </button>
                      </div>

                      <AnimatePresence>
                        {showHelp && (
                          <motion.div
                            className="settings-help-box"
                            initial={{ height: 0, opacity: 0, marginBottom: 0 }}
                            animate={{ height: 'auto', opacity: 1, marginBottom: 16 }}
                            exit={{ height: 0, opacity: 0, marginBottom: 0 }}
                            style={{ overflow: 'hidden' }}
                          >
                            <h4>How to get your credentials:</h4>
                            <ol>
                              <li>Go to the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">Spotify Developer Dashboard <ExternalLink size={10} /></a> and log in.</li>
                              <li>Click <strong>Create app</strong>.</li>
                              <li>Name your app, and set the Redirect URI to: <code>http://localhost:5174/</code></li>
                              <li>Check the <strong>Web API</strong> box and accept the terms to save.</li>
                              <li>Click <strong>Settings</strong> to reveal your Client ID and Client Secret.</li>
                            </ol>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div className="settings-field">
                        <label>Spotify Client ID</label>
                        <div className="settings-masked-input-wrap">
                          <input
                            type="text"
                            value={spotifyClientId}
                            onChange={e => setSpotifyClientId(e.target.value)}
                            placeholder="Paste Client ID..."
                            className="settings-masked-input"
                          />
                          {spotifyClientId && <span className="settings-input-check"><CheckCircle2 size={14} color="#1DB954" /></span>}
                        </div>
                      </div>
                      <div className="settings-field">
                        <label>Spotify Client Secret</label>
                        <div className="settings-masked-input-wrap">
                          <input
                            type="password"
                            value={spotifyClientSecret}
                            onChange={e => setSpotifyClientSecret(e.target.value)}
                            placeholder="Paste Client Secret..."
                            className="settings-masked-input"
                          />
                          {spotifyClientSecret && <span className="settings-input-check"><CheckCircle2 size={14} color="#1DB954" /></span>}
                        </div>
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
    </div>
  );
}
