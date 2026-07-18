import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, ChevronLeft, ChevronRight, Settings, X, HelpCircle, ExternalLink, Palette, Library, FolderOpen, RefreshCw, ListVideo } from 'lucide-react';
import DynamicIsland from './DynamicIsland';
import YoutubeDownloader from './YoutubeDownloader';
import SpotifyDownloader from './SpotifyDownloader';
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
          setActiveYoutubeJob(data.youtube[0]);
          setActiveIdx(0);
        } else if (data.spotify && data.spotify.length > 0) {
          setActiveSpotifyJob(data.spotify[0]);
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

  const active = PLATFORMS[activeIdx];

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
          {/* Arrow nav */}
          <div className="platform-arrows">
            <button
              className="platform-arrow"
              onClick={() => switchTo((activeIdx - 1 + PLATFORMS.length) % PLATFORMS.length)}
              title="Previous Platform"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="platform-arrow-label" style={{ color: active.color }}>
              {activeIdx + 1} / {PLATFORMS.length}
            </span>
            <button
              className="platform-arrow"
              onClick={() => switchTo((activeIdx + 1) % PLATFORMS.length)}
              title="Next Platform"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <DynamicIsland />
          <div className="global-top-actions">
            <button 
              className="settings-button"
              onClick={() => setShowQueueModal(true)}
              title="Queue Manager"
            >
              <ListVideo size={18} />
            </button>
            <button 
              className="settings-button"
              onClick={() => setShowSettingsModal(true)}
              title="Theme / Palette"
            >
              <Palette size={18} />
            </button>
            <button 
              className="settings-button"
              onClick={() => { fetchHistory(); setShowLibrary(true); }}
              title="Library / History"
            >
              <Library size={18} />
            </button>
            <button 
              className="settings-button"
              onClick={() => setShowSettingsModal(true)}
              title="Settings"
            >
              <Settings size={18} />
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
                      <h3>Culori (Hex)</h3>
                      <div className="settings-theme-pickers">
                        <div className="settings-color-picker-item">
                          <label>Accent Principal</label>
                          <div className="settings-color-input-wrapper">
                            <input
                              type="color"
                              value={customTheme.primary}
                              onChange={(e) => setCustomTheme(prev => ({ ...prev, primary: e.target.value }))}
                            />
                            <span>{customTheme.primary.toUpperCase()}</span>
                          </div>
                        </div>
                        <div className="settings-color-picker-item">
                          <label>Culoare Fundal</label>
                          <div className="settings-color-input-wrapper">
                            <input
                              type="color"
                              value={customTheme.bgBase}
                              onChange={(e) => setCustomTheme(prev => ({ ...prev, bgBase: e.target.value }))}
                            />
                            <span>{customTheme.bgBase.toUpperCase()}</span>
                          </div>
                        </div>
                        <div className="settings-color-picker-item">
                          <button
                            className="settings-save-btn"
                            style={{ width: 'auto', padding: '0.5rem 1rem', background: '#475569' }}
                            onClick={() => setCustomTheme({ primary: '#ef4444', secondary: '#3b82f6', bgBase: '#080a0f' })}
                          >
                            <RefreshCw size={14} style={{ display: 'inline', marginRight: '4px' }}/> Reset
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeSettingsTab === 'spotify' && (
                    <div className="settings-section">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                         <h3 style={{ margin: 0 }}>Credentials</h3>
                         <button className="settings-help-btn" onClick={() => setShowHelp(!showHelp)} title="How to get these?">
                           <HelpCircle size={16} />
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
                        <input 
                          type="text" 
                          value={spotifyClientId} 
                          onChange={e => setSpotifyClientId(e.target.value)} 
                          placeholder="Paste Client ID..."
                        />
                      </div>
                      <div className="settings-field">
                        <label>Spotify Client Secret</label>
                        <input 
                          type="text" 
                          value={spotifyClientSecret} 
                          onChange={e => setSpotifyClientSecret(e.target.value)} 
                          placeholder="Paste Client Secret..."
                        />
                      </div>
                    </div>
                  )}

                  {activeSettingsTab === 'system' && (
                    <div className="settings-section">
                      <div className="settings-field">
                        <label>Download Speed Preset</label>
                        <select 
                          value={downloadPreset} 
                          onChange={e => setDownloadPreset(e.target.value)}
                          className="settings-select"
                          style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.05)', color: 'white', border: '1px solid rgba(255, 255, 255, 0.1)', outline: 'none' }}
                        >
                          <option value="AUTO" style={{ color: 'black' }}>AUTO (AI Smart Optimizer)</option>
                          <option value="ULTRA_PERFORMANCE" style={{ color: 'black' }}>Ultra Performance (Fastest, High CPU)</option>
                          <option value="HIGH_PERFORMANCE" style={{ color: 'black' }}>High Performance</option>
                          <option value="BALANCED" style={{ color: 'black' }}>Balanced</option>
                          <option value="ECO" style={{ color: 'black' }}>Eco (Slow, Low CPU)</option>
                        </select>
                      </div>
                      <div className="settings-field">
                        <label>Hardware Acceleration (FFmpeg)</label>
                        <select 
                          value={hardwareAcceleration} 
                          onChange={e => setHardwareAcceleration(e.target.value)}
                          className="settings-select"
                          style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.05)', color: 'white', border: '1px solid rgba(255, 255, 255, 0.1)', outline: 'none' }}
                        >
                          <option value="NONE" style={{ color: 'black' }}>CPU Only (Recommended for Audio)</option>
                          <option value="AUTO" style={{ color: 'black' }}>Auto (Let FFmpeg decide)</option>
                          <option value="CUDA" style={{ color: 'black' }}>NVIDIA GPU (CUDA / NVENC)</option>
                          <option value="AMF" style={{ color: 'black' }}>AMD GPU (AMF)</option>
                          <option value="QSV" style={{ color: 'black' }}>Intel GPU (QSV)</option>
                        </select>
                        <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginTop: '4px' }}>GPU encoding mostly speeds up Video conversion. MP3 is always CPU.</p>
                      </div>
                      <div className="settings-field">
                        <label>Actualizare Engine (yt-dlp)</label>
                        <button 
                          className="settings-save-btn" 
                          style={{ width: '100%', background: '#3b82f6', marginTop: '4px' }}
                          onClick={handleUpdateEngine}
                        >
                          <RefreshCw size={16} style={{ display: 'inline', marginRight: '6px' }} /> Verifică pentru Actualizări
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="control-panel-footer">
                  <button className="settings-save-btn" onClick={saveSettings}>
                    Salvează Setările
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
