import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, ChevronLeft, ChevronRight, Settings, X, HelpCircle, ExternalLink } from 'lucide-react';
import YoutubeDownloader from './YoutubeDownloader';
import SpotifyDownloader from './SpotifyDownloader';
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
  const [spotifyClientId, setSpotifyClientId] = useState('');
  const [spotifyClientSecret, setSpotifyClientSecret] = useState('');
  const [downloadPreset, setDownloadPreset] = useState('AUTO');
  const [hardwareAcceleration, setHardwareAcceleration] = useState('NONE');
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    setSpotifyClientId(localStorage.getItem('spotify_client_id') || '');
    setSpotifyClientSecret(localStorage.getItem('spotify_client_secret') || '');
    setDownloadPreset(localStorage.getItem('download_preset') || 'AUTO');
    setHardwareAcceleration(localStorage.getItem('hardware_acceleration') || 'NONE');
  }, []);

  const saveSettings = () => {
    localStorage.setItem('spotify_client_id', spotifyClientId.trim());
    localStorage.setItem('spotify_client_secret', spotifyClientSecret.trim());
    localStorage.setItem('download_preset', downloadPreset);
    localStorage.setItem('hardware_acceleration', hardwareAcceleration);
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
            {activeIdx === 0 && <YoutubeDownloader />}
            {activeIdx === 1 && <SpotifyDownloader />}
          </motion.div>
        </AnimatePresence>
      </div>

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
              className="settings-modal-content"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <button className="settings-modal-close" onClick={() => setShowSettingsModal(false)}>
                <X size={18} />
              </button>
              <div className="settings-header">
                <h2>Settings</h2>
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
                      <li>Name your app, and set the Redirect URI strictly to: <code>http://127.0.0.1:5174/</code></li>
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
              <button className="settings-save-btn" onClick={saveSettings}>
                Save Settings
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
