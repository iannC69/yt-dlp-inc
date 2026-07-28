import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, SlidersHorizontal, Palette, Cpu, Play, Music2, Layers, Scissors,
  Filter, Terminal, RefreshCw, FolderOpen, Globe, Zap, Music, Download,
  Upload, Shield, BarChart2, CheckCircle2, Server, HardDrive, Gauge,
  Wifi, AlertTriangle, Trash2, RotateCcw, Eye, EyeOff, Bell, BellOff,
  MonitorDown, Package, ExternalLink
} from 'lucide-react';
import LogsTab from './LogsTab';
import UpdatesTab from './UpdatesTab';
import { toast } from './ToastSystem';
import { storage } from './storage';
import './SettingsModal.css';

/* ── helpers ── */
const Toggle = ({ checked, onChange }) => (
  <label className="sm-toggle">
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
    <div className="sm-toggle-track" />
    <div className="sm-toggle-thumb" />
  </label>
);

const ToggleRow = ({ label, desc, checked, onChange }) => (
  <div className="sm-toggle-row">
    <div className="sm-toggle-info">
      <span className="sm-toggle-label">{label}</span>
      {desc && <span className="sm-toggle-desc">{desc}</span>}
    </div>
    <Toggle checked={checked} onChange={onChange} />
  </div>
);

const Seg = ({ options, value, onChange }) => (
  <div className="sm-seg">
    {options.map(o => (
      <button
        key={o.value ?? o}
        className={`sm-seg-btn ${(o.value ?? o) === value ? 'active' : ''}`}
        onClick={() => onChange(o.value ?? o)}
      >
        {o.label ?? o}
      </button>
    ))}
  </div>
);

/* ════════════════════════════════════════════════════════════════
   TAB DEFINITIONS
   ════════════════════════════════════════════════════════════════ */
const SIDEBAR_TABS = [
  { group: 'General', tabs: [
    { id: 'general',   label: 'General',       icon: <SlidersHorizontal size={14} />,  sub: 'Paths, formats & defaults' },
    { id: 'theme',     label: 'Appearance',     icon: <Palette size={14} />,            sub: 'Colors, presets & wallpaper' },
    { id: 'system',    label: 'System & Engine',icon: <Cpu size={14} />,               sub: 'Performance & hardware' },
  ]},
  { group: 'Modules', tabs: [
    { id: 'youtube',   label: 'YouTube',        icon: <Play size={14} />,              sub: 'Quality, subtitles & cookies' },
    { id: 'spotify',   label: 'Spotify',        icon: <Music2 size={14} />,            sub: 'Engine & sync options' },
    { id: 'massdl',    label: 'Mass DL',        icon: <Layers size={14} />,            sub: 'Concurrency & batch config' },
    { id: 'cutter',    label: 'Audio Cutter',   icon: <Scissors size={14} />,          sub: 'Output format & effects' },
  ]},
  { group: 'Tools', tabs: [
    { id: 'rules',     label: 'Download Rules', icon: <Filter size={14} />,            sub: 'Naming, quality filters' },
    { id: 'privacy',   label: 'Privacy',        icon: <Shield size={14} />,            sub: 'History & data control' },
    { id: 'stats',     label: 'Statistics',     icon: <BarChart2 size={14} />,         sub: 'Usage & download history', badge: 'NEW' },
    { id: 'logs',      label: 'Logs',           icon: <Terminal size={14} />,          sub: 'Live server output' },
    { id: 'updates',   label: 'Updates',        icon: <RefreshCw size={14} />,         sub: 'App version & changelog' },
  ]},
];

const TAB_META = Object.fromEntries(
  SIDEBAR_TABS.flatMap(g => g.tabs).map(t => [t.id, { label: t.label, sub: t.sub }])
);

/* ════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════ */
export default function SettingsModal({
  onClose,
  activeTab, setActiveTab,
  /* General */
  customPath, handleSelectFolder,
  audioFormat, setAudioFormat,
  audioQuality, setAudioQuality,
  /* Theme */
  customTheme, setCustomTheme,
  liveBackground, setLiveBackground,
  colorPickerActiveRef, colorPickerTimerRef,
  /* System */
  downloadPreset, setDownloadPreset,
  hardwareAcceleration, setHardwareAcceleration,
  handleUpdateEngine,
  saveConfigToBackend,
  /* YouTube */
  ytVideoQuality, setYtVideoQuality,
  ytSubtitles, setYtSubtitles,
  ytEmbedThumbnail, setYtEmbedThumbnail,
  ytWriteThumbnail, setYtWriteThumbnail,
  ytSponsorBlock, setYtSponsorBlock,
  ytFilenameTemplate, setYtFilenameTemplate,
  youtubePoToken, setYoutubePoToken,
  cookiesFromBrowser, setCookiesFromBrowser,
  /* Spotify */
  spotDlEngine, setSpotDlEngine,
  spotDlLyrics, setSpotDlLyrics,
  spotDlArchive, setSpotDlArchive,
  /* Mass DL */
  massDlConcurrency, setMassDlConcurrency,
  massDlRetries, setMassDlRetries,
  massDlContinueOnError, setMassDlContinueOnError,
  massDlOutputFormat, setMassDlOutputFormat,
  massDlDelay, setMassDlDelay,
  /* Cutter */
  cutterOutputFormat, setCutterOutputFormat,
  cutterFadeDuration, setCutterFadeDuration,
  cutterNormalize, setCutterNormalize,
  cutterBitrate, setCutterBitrate,
  /* Rules */
  spotifyThreshold, setSpotifyThreshold,
  ytDlpFallbackEnabled, setYtDlpFallbackEnabled,
  /* App version */
  appVersion,
}) {
  const overlayRef = useRef(null);
  const mouseDownOnOverlayRef = useRef(false);

  /* New settings stored locally */
  const [autoOpenFolder, setAutoOpenFolder] = useState(() => storage.getItem('auto_open_folder') !== 'false');
  const [desktopNotif, setDesktopNotif]     = useState(() => storage.getItem('desktop_notif') !== 'false');
  const [proxyUrl, setProxyUrl]             = useState(() => storage.getItem('proxy_url') || '');
  const [maxDlSpeed, setMaxDlSpeed]         = useState(() => parseInt(storage.getItem('max_dl_speed') || '0'));
  const [ffmpegThreads, setFfmpegThreads]   = useState(() => parseInt(storage.getItem('ffmpeg_threads') || '0'));
  const [clearHistoryOnExit, setClearHistoryOnExit] = useState(() => storage.getItem('clear_history_on_exit') === 'true');
  const [saveThumbs, setSaveThumbs]         = useState(() => storage.getItem('save_thumbs') !== 'false');
  const [cutterSampleRate, setCutterSampleRate] = useState(() => storage.getItem('cutter_sample_rate') || '44100');
  const [cutterChannels, setCutterChannels] = useState(() => storage.getItem('cutter_channels') || 'stereo');
  const [ytDefaultMode, setYtDefaultMode]   = useState(() => storage.getItem('yt_default_mode') || 'ask');
  const [serverStatus, setServerStatus]     = useState({ running: true, port: 5174 });
  const [diskInfo, setDiskInfo]             = useState(null);
  const [engineVersion, setEngineVersion]   = useState('');

  /* Stats computed from history */
  const stats = (() => {
    try {
      const h = JSON.parse(storage.getItem('global_history') || '[]');
      const byPlatform = { YouTube: 0, Spotify: 0, MassDL: 0, Cutter: 0 };
      h.forEach(item => {
        if (item.platform === 'youtube') byPlatform.YouTube++;
        else if (item.platform === 'spotify') byPlatform.Spotify++;
        else if (item.platform === 'massdl') byPlatform.MassDL++;
        else if (item.platform === 'cutter') byPlatform.Cutter++;
      });
      return { total: h.length, byPlatform };
    } catch { return { total: 0, byPlatform: { YouTube: 0, Spotify: 0, MassDL: 0, Cutter: 0 } }; }
  })();

  /* Fetch disk & engine info */
  useEffect(() => {
    fetch('/api/ytdl/system-status')
      .then(r => r.json())
      .then(d => {
        if (d.ytdlpVersion) setEngineVersion(d.ytdlpVersion);
        if (d.disk) setDiskInfo(d.disk);
      })
      .catch(() => {});
  }, []);

  /* Close on overlay click */
  const handleOverlayMouseDown = (e) => {
    mouseDownOnOverlayRef.current = e.target === overlayRef.current;
  };
  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current && mouseDownOnOverlayRef.current) {
      if (!colorPickerActiveRef?.current) onClose();
    }
    mouseDownOnOverlayRef.current = false;
  };

  /* ── Theme helpers ── */
  const THEME_DEFAULTS = {
    primary: '#ef4444', secondary: '#3b82f6', bgBase: '#080a0f',
    panelColor: '#0f111a', navColor: '#06080e', textColor: '#f1f5f9', borderColor: '#ffffff',
    ytBg: '#080a0f', ytAccent: '#ef4444', ytSecondary: '#3b82f6', ytText: '#f1f5f9',
    spBg: '#060a06', spAccent: '#1DB954', spText: '#f8fafc',
    mdBg: '#07060f', mdAccent: '#a855f7', mdSecondary: '#d946ef', mdText: '#e2d9f3',
    acBg: '#060910', acAccent: '#22d3ee', acText: '#d8e4f0',
  };

  const PRESETS = [
    { label: 'Default',     primary: '#ef4444', secondary: '#3b82f6', bgBase: '#080a0f', panelColor: '#0f111a', navColor: '#06080e', textColor: '#f1f5f9', borderColor: '#ffffff', ytBg: '#080a0f', ytAccent: '#ef4444', ytSecondary: '#3b82f6', ytText: '#f8fafc', spBg: '#060a06', spAccent: '#1DB954', spText: '#f8fafc', mdBg: '#07060f', mdAccent: '#a855f7', mdSecondary: '#d946ef', mdText: '#e2d9f3', acBg: '#060910', acAccent: '#22d3ee', acText: '#d8e4f0' },
    { label: 'Blue',        primary: '#3b82f6', secondary: '#60a5fa', bgBase: '#080c18', panelColor: '#0a0f20', navColor: '#050810', textColor: '#e2e8f0', borderColor: '#3b82f6', ytBg: '#060914', ytAccent: '#3b82f6', ytSecondary: '#60a5fa', ytText: '#e2e8f0', spBg: '#040a12', spAccent: '#0ea5e9', spText: '#e0f2fe', mdBg: '#080c18', mdAccent: '#6366f1', mdSecondary: '#8b5cf6', mdText: '#e0e7ff', acBg: '#070d18', acAccent: '#38bdf8', acText: '#bae6fd' },
    { label: 'Purple',      primary: '#a855f7', secondary: '#d946ef', bgBase: '#0d0814', panelColor: '#110c1a', navColor: '#07050e', textColor: '#f5f3ff', borderColor: '#a855f7', ytBg: '#0d0814', ytAccent: '#c084fc', ytSecondary: '#e879f9', ytText: '#f5f3ff', spBg: '#0a0512', spAccent: '#d946ef', spText: '#fae8ff', mdBg: '#0d0814', mdAccent: '#a855f7', mdSecondary: '#c084fc', mdText: '#f3e8ff', acBg: '#0c0716', acAccent: '#e879f9', acText: '#fdf4ff' },
    { label: 'Green',       primary: '#22c55e', secondary: '#10b981', bgBase: '#06110a', panelColor: '#080f0b', navColor: '#040b06', textColor: '#ecfdf5', borderColor: '#22c55e', ytBg: '#040e08', ytAccent: '#22c55e', ytSecondary: '#4ade80', ytText: '#d1fae5', spBg: '#040d07', spAccent: '#10b981', spText: '#a7f3d0', mdBg: '#051009', mdAccent: '#34d399', mdSecondary: '#10b981', mdText: '#ecfdf5', acBg: '#030a06', acAccent: '#6ee7b7', acText: '#d1fae5' },
    { label: 'Midnight',    primary: '#818cf8', secondary: '#6366f1', bgBase: '#0f0f23', panelColor: '#141428', navColor: '#0a0a1a', textColor: '#e0e7ff', borderColor: '#4f46e5', ytBg: '#0d0d21', ytAccent: '#818cf8', ytSecondary: '#a5b4fc', ytText: '#e0e7ff', spBg: '#0b0b1c', spAccent: '#6366f1', spText: '#c7d2fe', mdBg: '#0e0e24', mdAccent: '#4f46e5', mdSecondary: '#6366f1', mdText: '#e0e7ff', acBg: '#0a0a1d', acAccent: '#a5b4fc', acText: '#c7d2fe' },
    { label: 'Nord',        primary: '#88c0d0', secondary: '#81a1c1', bgBase: '#1a1d2e', panelColor: '#212338', navColor: '#151726', textColor: '#eceff4', borderColor: '#5e81ac', ytBg: '#181a29', ytAccent: '#bf616a', ytSecondary: '#d08770', ytText: '#eceff4', spBg: '#161824', spAccent: '#a3be8c', spText: '#e5e9f0', mdBg: '#191b2b', mdAccent: '#b48ead', mdSecondary: '#88c0d0', mdText: '#eceff4', acBg: '#171927', acAccent: '#81a1c1', acText: '#e5e9f0' },
    { label: 'Amber',       primary: '#f59e0b', secondary: '#fbbf24', bgBase: '#100c04', panelColor: '#1a1408', navColor: '#0c0900', textColor: '#fef3c7', borderColor: '#f59e0b', ytBg: '#0e0a02', ytAccent: '#f59e0b', ytSecondary: '#fbbf24', ytText: '#fef3c7', spBg: '#0a0701', spAccent: '#d97706', spText: '#fde68a', mdBg: '#0c0903', mdAccent: '#b45309', mdSecondary: '#f59e0b', mdText: '#fef3c7', acBg: '#090702', acAccent: '#fcd34d', acText: '#fde68a' },
    { label: 'Rose',        primary: '#fb7185', secondary: '#f43f5e', bgBase: '#120811', panelColor: '#1a0c18', navColor: '#0e050d', textColor: '#ffe4e6', borderColor: '#fb7185', ytBg: '#10060e', ytAccent: '#fb7185', ytSecondary: '#fda4af', ytText: '#ffe4e6', spBg: '#0d040b', spAccent: '#f43f5e', spText: '#fecdd3', mdBg: '#11070f', mdAccent: '#e11d48', mdSecondary: '#fb7185', mdText: '#ffe4e6', acBg: '#0c0509', acAccent: '#fda4af', acText: '#fecdd3' },
    { label: 'Mono',        primary: '#e5e5e5', secondary: '#a3a3a3', bgBase: '#0a0a0a', panelColor: '#171717', navColor: '#000000', textColor: '#ffffff', borderColor: '#404040', ytBg: '#000000', ytAccent: '#d4d4d4', ytSecondary: '#737373', ytText: '#ffffff', spBg: '#050505', spAccent: '#f5f5f5', spText: '#ffffff', mdBg: '#080808', mdAccent: '#e5e5e5', mdSecondary: '#a3a3a3', mdText: '#ffffff', acBg: '#030303', acAccent: '#a3a3a3', acText: '#ffffff' },
  ];

  const activePreset = PRESETS.find(p => p.primary === customTheme.primary && p.bgBase === customTheme.bgBase);

  const armColorPicker = () => {
    if (!colorPickerActiveRef) return;
    colorPickerActiveRef.current = true;
    clearTimeout(colorPickerTimerRef.current);
    colorPickerTimerRef.current = setTimeout(() => { colorPickerActiveRef.current = false; }, 6000);
  };

  const onColorChange = (key, val) => {
    setCustomTheme(prev => ({ ...prev, [key]: val }));
    if (colorPickerActiveRef) {
      clearTimeout(colorPickerTimerRef.current);
      colorPickerTimerRef.current = setTimeout(() => { colorPickerActiveRef.current = false; }, 600);
    }
  };

  const renderColorPicker = (key, label) => (
    <div className="sm-color-row" key={key}>
      <div className="sm-color-swatch" onMouseDown={armColorPicker}>
        <input type="color" value={customTheme[key] || '#000000'} onChange={e => onColorChange(key, e.target.value)} />
        <div className="sm-color-swatch-preview" style={{ background: customTheme[key] || '#000000' }} />
      </div>
      <span className="sm-color-lbl">{label}</span>
      <input
        className="sm-color-hex"
        type="text"
        value={(customTheme[key] || '#000000').toUpperCase()}
        onChange={e => { if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) setCustomTheme(prev => ({ ...prev, [key]: e.target.value })); }}
        maxLength={7}
      />
    </div>
  );

  const ColorSection = ({ title, icon, keys }) => (
    <div className="sm-card">
      <div className="sm-card-title">{icon}{title}</div>
      <div className="sm-color-grid">{keys.map(([k, l]) => renderColorPicker(k, l))}</div>
    </div>
  );

  /* ── RENDER ── */
  return (
    <motion.div
      className="sm-overlay"
      ref={overlayRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={handleOverlayMouseDown}
      onClick={handleOverlayClick}
    >
      <motion.div
        className="sm-shell"
        initial={{ scale: 0.95, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 8 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Body ── */}
        <div className="sm-body">
          {/* ── Sidebar ── */}
          <div className="sm-sidebar">
            <div className="sm-sidebar-brand">
              <div className="sm-sidebar-brand-icon"><Play size={12} fill="currentColor" /></div>
              <div>
                <div className="sm-sidebar-brand-name">MediaDL</div>
                <div className="sm-sidebar-brand-sub">Control Center</div>
              </div>
            </div>

            {SIDEBAR_TABS.map(group => (
              <div key={group.group}>
                <div className="sm-sidebar-group-label">{group.group}</div>
                {group.tabs.map(t => (
                  <button
                    key={t.id}
                    className={`sm-tab ${activeTab === t.id ? 'active' : ''}`}
                    onClick={() => setActiveTab(t.id)}
                  >
                    <span className="sm-tab-icon">{t.icon}</span>
                    {t.label}
                    {t.badge && <span className="sm-tab-badge">{t.badge}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* ── Content ── */}
          <div className="sm-content">
            {/* Header */}
            <div className="sm-header">
              <div>
                <h3 className="sm-header-title">{TAB_META[activeTab]?.label}</h3>
                <div className="sm-header-sub">{TAB_META[activeTab]?.sub}</div>
              </div>
              <button className="sm-close-btn" onClick={onClose}><X size={16} /></button>
            </div>

            {/* Scroll area */}
            <div className="sm-scroll">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                >

                  {/* ══════════════ GENERAL ══════════════ */}
                  {activeTab === 'general' && (
                    <>
                      <div className="sm-card">
                        <div className="sm-card-title"><FolderOpen size={12} />Download Location</div>
                        <div className="sm-field">
                          <label className="sm-label">Download Directory</label>
                          <div className="sm-path-row">
                            <input className="sm-input" readOnly value={customPath || 'Default (app/downloads)'} title={customPath} />
                            <button className="sm-btn sm-btn-ghost" onClick={handleSelectFolder} style={{ whiteSpace: 'nowrap' }}>
                              <FolderOpen size={14} /> Browse
                            </button>
                          </div>
                          <div className="sm-hint">Where downloaded files are saved on your PC.</div>
                        </div>
                        <ToggleRow
                          label="Auto-open folder after download"
                          desc="Automatically opens the download folder in Explorer when a download finishes."
                          checked={autoOpenFolder}
                          onChange={v => { setAutoOpenFolder(v); storage.setItem('auto_open_folder', String(v)); }}
                        />
                        <ToggleRow
                          label="Desktop notifications"
                          desc="Show a system notification when a download completes."
                          checked={desktopNotif}
                          onChange={v => { setDesktopNotif(v); storage.setItem('desktop_notif', String(v)); }}
                        />
                      </div>

                      <div className="sm-card">
                        <div className="sm-card-title"><Music size={12} />Default Audio Settings</div>
                        <div className="sm-field">
                          <label className="sm-label">Audio Format</label>
                          <Seg
                            options={['mp3','m4a','flac','wav','opus'].map(f => ({ value: f, label: f.toUpperCase() }))}
                            value={audioFormat}
                            onChange={v => { setAudioFormat(v); storage.setItem('audioFormat', v); }}
                          />
                        </div>
                        <div className="sm-field">
                          <label className="sm-label">Audio Quality (Bitrate)</label>
                          <Seg
                            options={[
                              { value: '320k', label: '320k (Hi)' },
                              { value: '256k', label: '256k' },
                              { value: '192k', label: '192k' },
                              { value: '128k', label: '128k (Lo)' },
                            ]}
                            value={audioQuality}
                            onChange={v => { setAudioQuality(v); storage.setItem('audioQuality', v); }}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {/* ══════════════ THEME / APPEARANCE ══════════════ */}
                  {activeTab === 'theme' && (
                    <>
                      <div className="sm-card">
                        <div className="sm-card-title"><Palette size={12} />Quick Presets</div>
                        <div className="sm-preset-grid">
                          {PRESETS.map(p => (
                            <button
                              key={p.label}
                              className={`sm-preset-btn ${activePreset?.label === p.label ? 'active' : ''}`}
                              style={{ '--swatch-color': p.primary }}
                              onClick={() => setCustomTheme(prev => ({ ...prev, ...p }))}
                            >
                              <span className="sm-preset-dot" />
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="sm-card">
                        <div className="sm-card-title"><Zap size={12} />Effects</div>
                        <ToggleRow
                          label="Live Aurora Background"
                          desc="Animated gradient background that reacts to the current platform."
                          checked={liveBackground}
                          onChange={v => { setLiveBackground(v); storage.setItem('live_background', String(v)); }}
                        />
                        <div className="sm-toggle-row">
                          <div className="sm-toggle-info">
                            <span className="sm-toggle-label">Custom PC Wallpaper</span>
                            <span className="sm-toggle-desc">Use your own image as the app background.</span>
                          </div>
                          {customTheme.customWallpaper ? (
                            <button className="sm-btn sm-btn-danger" onClick={() => setCustomTheme(p => ({ ...p, customWallpaper: null }))}>
                              <Trash2 size={13} /> Remove
                            </button>
                          ) : (
                            <button className="sm-btn sm-btn-ghost" onClick={() => {
                              const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
                              inp.onchange = e => {
                                const file = e.target.files[0]; if (!file) return;
                                const reader = new FileReader();
                                reader.onload = ev => {
                                  const img = new Image();
                                  img.onload = () => {
                                    const canvas = document.createElement('canvas');
                                    let { width, height } = img; const max = 1920;
                                    if (width > max || height > max) {
                                      if (width > height) { height = Math.round(height * max / width); width = max; }
                                      else { width = Math.round(width * max / height); height = max; }
                                    }
                                    canvas.width = width; canvas.height = height;
                                    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                                    setCustomTheme(p => ({ ...p, customWallpaper: canvas.toDataURL('image/jpeg', 0.85) }));
                                  };
                                  img.src = ev.target.result;
                                };
                                reader.readAsDataURL(file);
                              };
                              inp.click();
                            }}>
                              <FolderOpen size={13} /> Browse PC
                            </button>
                          )}
                        </div>
                        {customTheme.customWallpaper && (
                          <div className="sm-field" style={{ marginTop: 12 }}>
                            <label className="sm-label">Overlay Intensity — <strong style={{ color: '#f4f4f5' }}>{customTheme.wallpaperOpacity ?? 85}%</strong></label>
                            <div className="sm-slider-row">
                              <input type="range" className="sm-slider" min="0" max="100"
                                value={customTheme.wallpaperOpacity ?? 85}
                                onChange={e => setCustomTheme(p => ({ ...p, wallpaperOpacity: +e.target.value }))}
                              />
                              <span className="sm-slider-val">{customTheme.wallpaperOpacity ?? 85}%</span>
                            </div>
                          </div>
                        )}
                      </div>

                      <ColorSection title="Global Colors" icon={<Globe size={12} />} keys={[
                        ['primary','Accent / Buttons'],['bgBase','App Background'],
                        ['panelColor','Panel / Cards'],['navColor','Navbar'],
                        ['textColor','Primary Text'],['borderColor','Borders & Glow'],
                      ]} />
                      <ColorSection title="YouTube Panel" icon={<Play size={12} />} keys={[
                        ['ytBg','Background'],['ytAccent','Accent'],['ytSecondary','Secondary'],['ytText','Text'],
                      ]} />
                      <ColorSection title="Spotify Panel" icon={<Music2 size={12} />} keys={[
                        ['spBg','Background'],['spAccent','Accent'],['spText','Text'],
                      ]} />
                      <ColorSection title="Mass DL Panel" icon={<Layers size={12} />} keys={[
                        ['mdBg','Background'],['mdAccent','Purple Accent'],['mdSecondary','Magenta'],['mdText','Text'],
                      ]} />
                      <ColorSection title="Audio Cutter Panel" icon={<Scissors size={12} />} keys={[
                        ['acBg','Background'],['acAccent','Cyan Accent'],['acText','Text'],
                      ]} />

                      <div className="sm-btn-row">
                        <button className="sm-btn sm-btn-ghost" onClick={() => setCustomTheme(THEME_DEFAULTS)}><RotateCcw size={13} />Reset All</button>
                        <button className="sm-btn sm-btn-ghost" onClick={() => {
                          const a = document.createElement('a');
                          a.href = URL.createObjectURL(new Blob([JSON.stringify(customTheme, null, 2)], { type: 'application/json' }));
                          a.download = `mediadl-theme-${Date.now()}.json`; a.click();
                        }}><Download size={13} />Export</button>
                        <button className="sm-btn sm-btn-ghost" onClick={() => {
                          const i = document.createElement('input'); i.type = 'file'; i.accept = 'application/json';
                          i.onchange = e => {
                            const f = e.target.files[0]; if (!f) return;
                            const r = new FileReader();
                            r.onload = ev => { try { setCustomTheme(p => ({ ...p, ...JSON.parse(ev.target.result) })); toast.success('Theme imported!'); } catch { toast.error('Invalid JSON'); } };
                            r.readAsText(f);
                          };
                          i.click();
                        }}><Upload size={13} />Import</button>
                      </div>
                    </>
                  )}

                  {/* ══════════════ SYSTEM & ENGINE ══════════════ */}
                  {activeTab === 'system' && (
                    <>
                      <div className="sm-card">
                        <div className="sm-card-title"><Server size={12} />Engine Info</div>
                        <div className="sm-engine-row"><span className="sm-engine-key">yt-dlp version</span><span className="sm-engine-val">{engineVersion || '—'} <span className="sm-engine-badge">Active</span></span></div>
                        <div className="sm-engine-row"><span className="sm-engine-key">Server port</span><span className="sm-engine-val">:{serverStatus.port}</span></div>
                        {diskInfo && <div className="sm-engine-row"><span className="sm-engine-key">Free disk space</span><span className="sm-engine-val">{Math.round(diskInfo.free / 1024 / 1024 / 1024)} GB free of {Math.round(diskInfo.total / 1024 / 1024 / 1024)} GB</span></div>}
                        <div className="sm-btn-row" style={{ marginTop: 12 }}>
                          <button className="sm-btn sm-btn-primary" onClick={handleUpdateEngine}><RefreshCw size={13} />Update yt-dlp</button>
                        </div>
                      </div>

                      <div className="sm-card">
                        <div className="sm-card-title"><Gauge size={12} />Performance</div>
                        <div className="sm-field">
                          <label className="sm-label">Download Preset</label>
                          <Seg
                            options={[
                              { value: 'AUTO', label: 'Auto' }, { value: 'FAST', label: 'Fast' },
                              { value: 'BALANCED', label: 'Balanced' }, { value: 'QUALITY', label: 'Quality' },
                            ]}
                            value={downloadPreset}
                            onChange={v => { setDownloadPreset(v); storage.setItem('download_preset', v); }}
                          />
                        </div>
                        <div className="sm-field">
                          <label className="sm-label">Hardware Acceleration</label>
                          <Seg
                            options={[
                              { value: 'NONE', label: 'None' }, { value: 'NVENC', label: 'NVENC (Nvidia)' },
                              { value: 'AMF', label: 'AMF (AMD)' }, { value: 'QSV', label: 'QSV (Intel)' },
                            ]}
                            value={hardwareAcceleration}
                            onChange={v => { setHardwareAcceleration(v); storage.setItem('hardware_acceleration', v); }}
                          />
                        </div>
                        <div className="sm-field">
                          <label className="sm-label">FFmpeg Threads — <strong style={{ color: '#f4f4f5' }}>{ffmpegThreads === 0 ? 'Auto' : ffmpegThreads}</strong></label>
                          <div className="sm-slider-row">
                            <input type="range" className="sm-slider" min="0" max="16" value={ffmpegThreads}
                              onChange={e => { setFfmpegThreads(+e.target.value); storage.setItem('ffmpeg_threads', String(e.target.value)); }}
                            />
                            <span className="sm-slider-val">{ffmpegThreads === 0 ? 'Auto' : ffmpegThreads}</span>
                          </div>
                          <div className="sm-hint">0 = let FFmpeg decide automatically. Higher = faster encoding, more CPU usage.</div>
                        </div>
                        <div className="sm-field">
                          <label className="sm-label">Max Download Speed — <strong style={{ color: '#f4f4f5' }}>{maxDlSpeed === 0 ? 'Unlimited' : `${maxDlSpeed} KB/s`}</strong></label>
                          <div className="sm-slider-row">
                            <input type="range" className="sm-slider" min="0" max="10000" step="100" value={maxDlSpeed}
                              onChange={e => { setMaxDlSpeed(+e.target.value); storage.setItem('max_dl_speed', String(e.target.value)); }}
                            />
                            <span className="sm-slider-val">{maxDlSpeed === 0 ? '∞' : `${maxDlSpeed}`}</span>
                          </div>
                        </div>
                      </div>

                      <div className="sm-card">
                        <div className="sm-card-title"><Wifi size={12} />Network</div>
                        <div className="sm-field">
                          <label className="sm-label">Proxy URL</label>
                          <input className="sm-input" placeholder="http://host:port or socks5://..." value={proxyUrl}
                            onChange={e => { setProxyUrl(e.target.value); storage.setItem('proxy_url', e.target.value); }}
                          />
                          <div className="sm-hint">Leave empty to use your direct connection. Supports HTTP and SOCKS5 proxies.</div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* ══════════════ YOUTUBE ══════════════ */}
                  {activeTab === 'youtube' && (
                    <>
                      <div className="sm-card">
                        <div className="sm-card-title"><Play size={12} />Download Defaults</div>
                        <div className="sm-field">
                          <label className="sm-label">Default Mode</label>
                          <Seg
                            options={[
                              { value: 'ask', label: 'Ask every time' },
                              { value: 'video', label: 'Video' },
                              { value: 'audio', label: 'Audio only' },
                            ]}
                            value={ytDefaultMode}
                            onChange={v => { setYtDefaultMode(v); storage.setItem('yt_default_mode', v); }}
                          />
                        </div>
                        <div className="sm-field">
                          <label className="sm-label">Default Video Quality</label>
                          <div className="sm-quality-grid">
                            {[
                              { value: 'best', label: 'Best', sub: 'Auto' },
                              { value: '2160p', label: '4K', sub: '2160p' },
                              { value: '1080p', label: '1080p', sub: 'FHD' },
                              { value: '720p', label: '720p', sub: 'HD' },
                              { value: '480p', label: '480p', sub: 'SD' },
                            ].map(q => (
                              <button key={q.value}
                                className={`sm-quality-card ${ytVideoQuality === q.value ? 'active' : ''}`}
                                onClick={() => { setYtVideoQuality(q.value); storage.setItem('yt_video_quality', q.value); }}
                              >
                                <span className="sm-quality-card-label">{q.label}</span>
                                <span className="sm-quality-card-sub">{q.sub}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="sm-field">
                          <label className="sm-label">Subtitle Download</label>
                          <Seg
                            options={[
                              { value: 'off', label: 'Off' }, { value: 'auto', label: 'Auto' },
                              { value: 'en', label: 'EN' }, { value: 'ro', label: 'RO' },
                              { value: 'all', label: 'All' },
                            ]}
                            value={ytSubtitles}
                            onChange={v => { setYtSubtitles(v); storage.setItem('yt_subtitles', v); }}
                          />
                        </div>
                      </div>

                      <div className="sm-card">
                        <div className="sm-card-title"><Package size={12} />Output Options</div>
                        <div className="sm-field">
                          <label className="sm-label">Filename Template</label>
                          <input className="sm-input" value={ytFilenameTemplate}
                            onChange={e => { setYtFilenameTemplate(e.target.value); storage.setItem('yt_filename_template', e.target.value); }}
                            placeholder="%(title)s"
                          />
                          <div className="sm-hint">yt-dlp output template. Variables: %(title)s %(uploader)s %(id)s %(ext)s</div>
                        </div>
                        <ToggleRow label="Embed thumbnail in audio" desc="Writes album art into the MP3/M4A file." checked={ytEmbedThumbnail} onChange={v => { setYtEmbedThumbnail(v); storage.setItem('yt_embed_thumbnail', String(v)); }} />
                        <ToggleRow label="Save thumbnail as image" desc="Exports a separate .jpg alongside the download." checked={ytWriteThumbnail} onChange={v => { setYtWriteThumbnail(v); storage.setItem('yt_write_thumbnail', String(v)); }} />
                        <ToggleRow label="SponsorBlock segments" desc="Automatically remove sponsor, intro, and self-promo segments." checked={ytSponsorBlock} onChange={v => { setYtSponsorBlock(v); storage.setItem('yt_sponsorblock', String(v)); }} />
                      </div>

                      <div className="sm-card">
                        <div className="sm-card-title"><Shield size={12} />Bot Bypass</div>
                        <div className="sm-field">
                          <label className="sm-label">PO Token (optional)</label>
                          <input className="sm-input" placeholder="Proof-of-Origin token..." value={youtubePoToken}
                            onChange={e => { setYoutubePoToken(e.target.value); saveConfigToBackend({ youtubePoToken: e.target.value }); }}
                          />
                          <div className="sm-hint">Passes a Proof-of-Origin token to bypass bot detection.</div>
                        </div>
                        <div className="sm-field">
                          <label className="sm-label">Browser Cookies Source</label>
                          <select className="sm-select" value={cookiesFromBrowser}
                            onChange={e => { setCookiesFromBrowser(e.target.value); saveConfigToBackend({ cookiesFromBrowser: e.target.value }); }}
                          >
                            <option value="">None</option>
                            <option value="chrome">Google Chrome</option>
                            <option value="edge">Microsoft Edge</option>
                            <option value="brave">Brave</option>
                            <option value="firefox">Firefox</option>
                            <option value="opera">Opera</option>
                          </select>
                          <div className="sm-hint">Automatically extract your active YouTube session to bypass bot blocks.</div>
                        </div>
                        <div className="sm-btn-row">
                          <button className="sm-btn sm-btn-ghost" onClick={async () => {
                            try { const r = await fetch('/api/cookies/import', { method: 'POST' }); const d = await r.json(); if (d.success) toast.success('Cookies imported!'); else toast.error(d.error); } catch { toast.error('Network error'); }
                          }}><Download size={13} />Import from Chrome</button>
                          <button className="sm-btn sm-btn-danger" onClick={async () => {
                            try { const r = await fetch('/api/ytdl/clear-cookies'); const d = await r.json(); if (d.success) toast.success('Cookies cleared'); else toast.error(d.error); } catch { toast.error('Network error'); }
                          }}><Trash2 size={13} />Clear Cookies</button>
                        </div>
                      </div>
                    </>
                  )}

                  {/* ══════════════ SPOTIFY ══════════════ */}
                  {activeTab === 'spotify' && (
                    <>
                      <div className="sm-card">
                        <div className="sm-card-title"><CheckCircle2 size={12} style={{ color: '#1DB954' }} />Integration Status</div>
                        <p style={{ fontSize: '0.85rem', color: '#1DB954', fontWeight: 500, margin: '0 0 12px' }}>
                          <CheckCircle2 size={14} style={{ display: 'inline-block', verticalAlign: 'text-bottom', marginRight: 4 }} />
                          Spotify integration is fully configured. Go to the Spotify tab and click Login to sync.
                        </p>
                      </div>
                      <div className="sm-card">
                        <div className="sm-card-title"><Gauge size={12} />Engine & Behavior</div>
                        <div className="sm-field">
                          <label className="sm-label">Download Engine Priority</label>
                          <Seg
                            options={[{ value: 'spotdl', label: 'spotdl first' }, { value: 'ytdlp', label: 'yt-dlp first' }]}
                            value={spotDlEngine}
                            onChange={v => { setSpotDlEngine(v); storage.setItem('spotdl_engine', v); }}
                          />
                          <div className="sm-hint">spotdl gives higher quality matches; yt-dlp is faster and more reliable.</div>
                        </div>
                        <ToggleRow label="Embed lyrics" desc="Embed synced lyrics into downloaded tracks." checked={spotDlLyrics} onChange={v => { setSpotDlLyrics(v); storage.setItem('spotdl_lyrics', String(v)); }} />
                        <ToggleRow label="Archive mode (skip re-downloads)" desc="Keeps a record to skip already downloaded tracks when syncing." checked={spotDlArchive} onChange={v => { setSpotDlArchive(v); storage.setItem('spotdl_archive', String(v)); }} />
                      </div>
                    </>
                  )}

                  {/* ══════════════ MASS DL ══════════════ */}
                  {activeTab === 'massdl' && (
                    <>
                      <div className="sm-card">
                        <div className="sm-card-title"><Layers size={12} />Batch Settings</div>
                        <div className="sm-field">
                          <label className="sm-label">Default Audio Format</label>
                          <Seg
                            options={['mp3','flac','m4a','wav','opus'].map(f => ({ value: f, label: f.toUpperCase() }))}
                            value={massDlOutputFormat}
                            onChange={v => { setMassDlOutputFormat(v); storage.setItem('massdl_output_format', v); }}
                          />
                        </div>
                        <div className="sm-field">
                          <label className="sm-label">Max Concurrent Downloads — <strong style={{ color: '#f4f4f5' }}>{massDlConcurrency}</strong></label>
                          <div className="sm-slider-row">
                            <input type="range" className="sm-slider" min="1" max="20" value={massDlConcurrency}
                              onChange={e => { setMassDlConcurrency(+e.target.value); storage.setItem('massdl_concurrency', String(e.target.value)); }}
                            />
                            <span className="sm-slider-val">{massDlConcurrency}</span>
                          </div>
                          <div className="sm-hint">Higher = faster but more CPU/RAM. Recommended: 3–8.</div>
                        </div>
                        <div className="sm-field">
                          <label className="sm-label">Delay Between Downloads — <strong style={{ color: '#f4f4f5' }}>{massDlDelay}s</strong></label>
                          <div className="sm-slider-row">
                            <input type="range" className="sm-slider" min="0" max="10" value={massDlDelay}
                              onChange={e => { setMassDlDelay(+e.target.value); storage.setItem('massdl_delay', String(e.target.value)); }}
                            />
                            <span className="sm-slider-val">{massDlDelay}s</span>
                          </div>
                        </div>
                        <div className="sm-field">
                          <label className="sm-label">Max Retries per Track</label>
                          <Seg
                            options={[0,1,2,3,5].map(n => ({ value: n, label: `${n}×` }))}
                            value={massDlRetries}
                            onChange={v => { setMassDlRetries(v); storage.setItem('massdl_retries', String(v)); }}
                          />
                        </div>
                        <ToggleRow label="Continue batch on error" desc="Skip failed tracks and continue instead of stopping the batch." checked={massDlContinueOnError} onChange={v => { setMassDlContinueOnError(v); storage.setItem('massdl_continue_on_error', String(v)); }} />
                      </div>
                    </>
                  )}

                  {/* ══════════════ AUDIO CUTTER ══════════════ */}
                  {activeTab === 'cutter' && (
                    <>
                      <div className="sm-card">
                        <div className="sm-card-title"><Scissors size={12} />Export Settings</div>
                        <div className="sm-field">
                          <label className="sm-label">Output Format</label>
                          <Seg
                            options={['mp3','flac','wav','m4a','opus','aac'].map(f => ({ value: f, label: f.toUpperCase() }))}
                            value={cutterOutputFormat}
                            onChange={v => { setCutterOutputFormat(v); storage.setItem('cutter_output_format', v); }}
                          />
                        </div>
                        <div className="sm-field">
                          <label className="sm-label">Bitrate</label>
                          <Seg
                            options={['128k','192k','256k','320k'].map(b => ({ value: b, label: b }))}
                            value={cutterBitrate}
                            onChange={v => { setCutterBitrate(v); storage.setItem('cutter_bitrate', v); }}
                          />
                        </div>
                        <div className="sm-field">
                          <label className="sm-label">Sample Rate</label>
                          <Seg
                            options={[
                              { value: '44100', label: '44.1 kHz' },
                              { value: '48000', label: '48 kHz' },
                              { value: '96000', label: '96 kHz' },
                            ]}
                            value={cutterSampleRate}
                            onChange={v => { setCutterSampleRate(v); storage.setItem('cutter_sample_rate', v); }}
                          />
                        </div>
                        <div className="sm-field">
                          <label className="sm-label">Channels</label>
                          <Seg
                            options={[{ value: 'stereo', label: 'Stereo' }, { value: 'mono', label: 'Mono' }]}
                            value={cutterChannels}
                            onChange={v => { setCutterChannels(v); storage.setItem('cutter_channels', v); }}
                          />
                        </div>
                        <div className="sm-field">
                          <label className="sm-label">Fade Duration — <strong style={{ color: '#f4f4f5' }}>{cutterFadeDuration}ms</strong></label>
                          <div className="sm-slider-row">
                            <input type="range" className="sm-slider" min="0" max="1000" step="10" value={cutterFadeDuration}
                              onChange={e => { setCutterFadeDuration(+e.target.value); storage.setItem('cutter_fade_duration', String(e.target.value)); }}
                            />
                            <span className="sm-slider-val">{cutterFadeDuration}ms</span>
                          </div>
                        </div>
                        <ToggleRow label="Peak normalization" desc="Normalize audio volume to prevent clipping." checked={cutterNormalize} onChange={v => { setCutterNormalize(v); storage.setItem('cutter_normalize', String(v)); }} />
                      </div>
                    </>
                  )}

                  {/* ══════════════ DOWNLOAD RULES ══════════════ */}
                  {activeTab === 'rules' && (
                    <>
                      <div className="sm-card">
                        <div className="sm-card-title"><Filter size={12} />Spotify Routing</div>
                        <div className="sm-field">
                          <label className="sm-label">spotdl Threshold</label>
                          <input type="number" className="sm-input" value={spotifyThreshold}
                            onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) { setSpotifyThreshold(v); saveConfigToBackend({ spotifyThreshold: v }); } }}
                          />
                          <div className="sm-hint">Playlists with fewer tracks than this will use spotdl directly instead of YouTube search.</div>
                        </div>
                        <ToggleRow
                          label="Enable yt-dlp fallback"
                          desc="If spotdl fails, fall back to searching YouTube with yt-dlp."
                          checked={ytDlpFallbackEnabled}
                          onChange={v => { setYtDlpFallbackEnabled(v); saveConfigToBackend({ ytDlpFallbackEnabled: v }); }}
                        />
                      </div>
                    </>
                  )}

                  {/* ══════════════ PRIVACY ══════════════ */}
                  {activeTab === 'privacy' && (
                    <>
                      <div className="sm-card">
                        <div className="sm-card-title"><Shield size={12} />Data & History</div>
                        <ToggleRow
                          label="Clear history on exit"
                          desc="Wipes all download history when the app is closed."
                          checked={clearHistoryOnExit}
                          onChange={v => { setClearHistoryOnExit(v); storage.setItem('clear_history_on_exit', String(v)); }}
                        />
                        <ToggleRow
                          label="Cache thumbnails"
                          desc="Store album art locally for faster display. Disable to save disk space."
                          checked={saveThumbs}
                          onChange={v => { setSaveThumbs(v); storage.setItem('save_thumbs', String(v)); }}
                        />
                      </div>
                      <div className="sm-card">
                        <div className="sm-card-title"><Trash2 size={12} />Clear Data</div>
                        <div className="sm-btn-row">
                          <button className="sm-btn sm-btn-danger" onClick={() => {
                            storage.removeItem('global_history');
                            toast.success('Download history cleared');
                          }}><Trash2 size={13} />Clear Download History</button>
                          <button className="sm-btn sm-btn-danger" onClick={async () => {
                            try { await fetch('/api/ytdl/clear-cookies'); toast.success('Cookies cleared'); } catch { toast.error('Error'); }
                          }}><Trash2 size={13} />Clear Cookies</button>
                        </div>
                        <div className="sm-btn-row" style={{ marginTop: 4 }}>
                          <button className="sm-btn sm-btn-danger" onClick={() => {
                            const keys = ['global_history','spotify_client_id','spotify_client_secret','ytdl_job_id','ytdl_url','ytdl_info'];
                            keys.forEach(k => storage.removeItem(k));
                            toast.success('Session data cleared');
                          }}><Trash2 size={13} />Clear All Session Data</button>
                        </div>
                        <div className="sm-hint" style={{ marginTop: 10 }}>Settings and preferences are not affected by clearing session data.</div>
                      </div>
                    </>
                  )}

                  {/* ══════════════ STATS ══════════════ */}
                  {activeTab === 'stats' && (
                    <>
                      <div className="sm-stats-grid">
                        <div className="sm-stat-card">
                          <div className="sm-stat-card-icon"><Download size={14} /></div>
                          <div className="sm-stat-card-val">{stats.total}</div>
                          <div className="sm-stat-card-label">Total Downloads</div>
                        </div>
                        <div className="sm-stat-card">
                          <div className="sm-stat-card-icon" style={{ color: '#ef4444' }}><Play size={14} /></div>
                          <div className="sm-stat-card-val">{stats.byPlatform.YouTube}</div>
                          <div className="sm-stat-card-label">YouTube</div>
                        </div>
                        <div className="sm-stat-card">
                          <div className="sm-stat-card-icon" style={{ color: '#1DB954' }}><Music2 size={14} /></div>
                          <div className="sm-stat-card-val">{stats.byPlatform.Spotify}</div>
                          <div className="sm-stat-card-label">Spotify</div>
                        </div>
                      </div>

                      <div className="sm-card">
                        <div className="sm-card-title"><BarChart2 size={12} />Platform Breakdown</div>
                        {[
                          { name: 'YouTube', count: stats.byPlatform.YouTube, color: '#ef4444' },
                          { name: 'Spotify', count: stats.byPlatform.Spotify, color: '#1DB954' },
                          { name: 'Mass DL', count: stats.byPlatform.MassDL, color: '#a855f7' },
                          { name: 'Cutter',  count: stats.byPlatform.Cutter,  color: '#22d3ee' },
                        ].map(row => (
                          <div className="sm-plat-row" key={row.name}>
                            <span className="sm-plat-name">{row.name}</span>
                            <div className="sm-plat-bar-wrap">
                              <div className="sm-plat-bar" style={{ width: stats.total > 0 ? `${Math.round((row.count / stats.total) * 100)}%` : '0%', background: row.color }} />
                            </div>
                            <span className="sm-plat-count">{row.count}</span>
                          </div>
                        ))}
                      </div>

                      {diskInfo && (
                        <div className="sm-card">
                          <div className="sm-card-title"><HardDrive size={12} />Disk Usage</div>
                          <div className="sm-engine-row">
                            <span className="sm-engine-key">Free space</span>
                            <span className="sm-engine-val">{(diskInfo.free / 1024 / 1024 / 1024).toFixed(1)} GB</span>
                          </div>
                          <div className="sm-engine-row">
                            <span className="sm-engine-key">Total disk</span>
                            <span className="sm-engine-val">{(diskInfo.total / 1024 / 1024 / 1024).toFixed(1)} GB</span>
                          </div>
                          <div className="sm-engine-row">
                            <span className="sm-engine-key">Used</span>
                            <span className="sm-engine-val">{(((diskInfo.total - diskInfo.free) / diskInfo.total) * 100).toFixed(1)}%</span>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* ══════════════ LOGS ══════════════ */}
                  {activeTab === 'logs' && (
                    <div style={{ height: '460px', marginTop: -4 }}>
                      <LogsTab />
                    </div>
                  )}

                  {/* ══════════════ UPDATES ══════════════ */}
                  {activeTab === 'updates' && <UpdatesTab />}

                </motion.div>
              </AnimatePresence>
            </div>

            {/* Status bar */}
            <div className="sm-statusbar">
              <div className="sm-statusbar-item">
                <div className="sm-status-dot" />
                Server running :5174
              </div>
              {appVersion && (
                <div className="sm-statusbar-item">v{appVersion}</div>
              )}
              {engineVersion && (
                <div className="sm-statusbar-item">yt-dlp {engineVersion}</div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
