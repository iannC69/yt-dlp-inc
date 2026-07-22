import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowRight, Check, ExternalLink, Eye, EyeOff,
  FolderOpen, Play, CheckCircle2, Music2, Scissors, Layers, Zap,
  Link2, Music, Folder, Cpu
} from 'lucide-react'
import './SetupWizard.css'
import { storage } from './storage';

const STEPS = ['Welcome', 'Spotify', 'Preferences', 'All Set']

const variants = {
  enter:  (d) => ({ x: d > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit:   (d) => ({ x: d > 0 ? -60 : 60, opacity: 0 }),
}

// ── Brand logo SVG ───────────────────────────────────────────────────────────
function LogoIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M5 18 L9 6 L12 13 L15 6 L19 18" stroke="white" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Step 0 — Welcome ─────────────────────────────────────────────────────────
function WelcomeStep({ onNext }) {
  const cards = [
    {
      icon: <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>,
      color: '#ef4444', title: 'YouTube', sub: 'Videos, music & playlists',
      desc: 'Any video or audio up to 4K quality',
    },
    {
      icon: <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>,
      color: '#1DB954', title: 'Spotify', sub: 'Full album & playlist support',
      desc: 'Convert entire playlists to MP3, FLAC or M4A',
    },
    {
      icon: <Scissors size={22} />, color: '#22d3ee', title: 'Audio Cutter', sub: 'Trim, fade & export',
      desc: 'Waveform editor with precise cut controls',
    },
    {
      icon: <Layers size={22} />, color: '#a855f7', title: 'Mass Downloads', sub: 'Hundreds at once',
      desc: 'Smart concurrency — queue as many as you want',
    },
  ]

  return (
    <div className="sw-step-content">
      <div className="sw-step-tag-row">
        <div className="sw-step-tag">Step 1 of 4</div>
        <span className="sw-badge sw-badge--purple">Welcome</span>
      </div>
      <h1 className="sw-step-title">Everything you<br />need to download.</h1>
      <p className="sw-step-sub">
        High-quality audio and video, right on your desktop.<br />Free. Offline. No account required.
      </p>

      <div className="sw-cards-grid">
        {cards.map((c, i) => (
          <motion.div
            key={c.title}
            className="sw-card"
            style={{ '--c': c.color }}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i, duration: 0.28 }}
          >
            <div className="sw-card-icon" style={{ background: c.color + '18', color: c.color }}>{c.icon}</div>
            <div className="sw-card-title">{c.title}</div>
            <div className="sw-card-sub">{c.sub}</div>
            <div className="sw-card-desc">{c.desc}</div>
          </motion.div>
        ))}
      </div>

      <div className="sw-nav" style={{ justifyContent: 'flex-end' }}>
        <button className="sw-btn-next sw-btn-next--lg" onClick={onNext}>
          Get Started <ArrowRight size={18} />
        </button>
      </div>
    </div>
  )
}

// ── Step 1 — Spotify ─────────────────────────────────────────────────────────
function SpotifyStep({ onNext, onBack }) {
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!storage.getItem('spotify_access_token'))

  const handleLogin = async () => {
    const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
    if (!clientId) return alert('Developer: Please set VITE_SPOTIFY_CLIENT_ID in the .env file!');

    const redirectUri = 'http://127.0.0.1:5174/api/spotify-callback';
    const scope   = encodeURIComponent('playlist-read-private playlist-read-collaborative');
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&show_dialog=true`;

    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(authUrl);
      
      const pollInterval = setInterval(async () => {
        try {
          const res = await fetch('/api/spotify-status');
          const data = await res.json();
          if (data.success && data.data.access_token) {
            clearInterval(pollInterval);
            storage.setItem('spotify_access_token',  data.data.access_token);
            storage.setItem('spotify_expires_at',    String(Date.now() + data.data.expires_in * 1000));
            if (data.data.refresh_token) storage.setItem('spotify_refresh_token', data.data.refresh_token);
            setIsLoggedIn(true);
          }
        } catch (err) {
          // Ignore polling errors
        }
      }, 1000);
    } else {
      window.location.href = authUrl;
    }
  }

  return (
    <div className="sw-step-content">
      <div className="sw-step-tag-row">
        <div className="sw-step-tag">Step 2 of 4</div>
        <span className="sw-badge sw-badge--skip">Optional</span>
      </div>

      <div className="sw-sp-header">
        <div className="sw-sp-icon">
          <svg viewBox="0 0 24 24" fill="#1DB954" width="32" height="32"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
        </div>
        <div>
          <h1 className="sw-step-title" style={{ marginBottom: '0.3rem' }}>Connect Spotify</h1>
          <p className="sw-step-sub" style={{ marginBottom: 0 }}>Log in to access your personal playlists and albums.</p>
        </div>
      </div>

      <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
        {isLoggedIn ? (
          <motion.div className="sw-sp-status" initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }}>
            <CheckCircle2 size={15} color="#1DB954" /> Successfully connected! You're ready to go.
          </motion.div>
        ) : (
          <button className="sw-btn-next" style={{ background: '#1DB954', color: 'black', fontWeight: 600 }} onClick={handleLogin}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" style={{ marginRight: 8 }}><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
            Log in with Spotify
          </button>
        )}
      </div>

      <div className="sw-nav" style={{ marginTop: 'auto' }}>
        <button className="sw-btn-back" onClick={onBack}>Back</button>
        <div style={{ display:'flex', gap:'0.75rem', alignItems:'center' }}>
          {!isLoggedIn && <button className="sw-btn-skip" onClick={onNext}>Skip for now</button>}
          <button className="sw-btn-next" onClick={onNext}>Continue <ArrowRight size={16} /></button>
        </div>
      </div>
    </div>
  )
}

// ── Step 2 — Preferences ─────────────────────────────────────────────────────
function PreferencesStep({ audioFormat, setAudioFormat, audioQuality, setAudioQuality, customPath, setCustomPath, onNext, onBack }) {
  const formats = [
    { id:'mp3',  label:'MP3',  desc:'Universal' },
    { id:'flac', label:'FLAC', desc:'Lossless' },
    { id:'m4a',  label:'M4A',  desc:'Apple' },
    { id:'wav',  label:'WAV',  desc:'Studio' },
    { id:'opus', label:'OPUS', desc:'Compact' },
  ]
  const qualities = [
    { value:'320k', label:'320 kbps', sub:'Best quality',    star: true  },
    { value:'256k', label:'256 kbps', sub:'High quality',    star: false },
    { value:'192k', label:'192 kbps', sub:'Standard',        star: false },
    { value:'128k', label:'128 kbps', sub:'Smallest size',   star: false },
  ]

  const handleFolder = async () => {
    try {
      const res  = await fetch('/api/ytdl/select-folder')
      const data = await res.json()
      if (data.success) setCustomPath(data.path)
    } catch {}
  }

  return (
    <div className="sw-step-content">
      <div className="sw-step-tag-row">
        <div className="sw-step-tag">Step 3 of 4</div>
      </div>
      <h1 className="sw-step-title">Your Preferences</h1>
      <p className="sw-step-sub">Set your default audio format and quality. Changeable anytime in Settings.</p>

      <div className="sw-pref-section">
        <div className="sw-pref-label">Audio Format</div>
        <div className="sw-format-grid">
          {formats.map(f => (
            <button key={f.id} className={`sw-format-btn ${audioFormat === f.id ? 'active' : ''}`}
              onClick={() => setAudioFormat(f.id)}>
              <span className="sw-format-id">{f.label}</span>
              <span className="sw-format-desc">{f.desc}</span>
              {audioFormat === f.id && <div className="sw-format-check"><Check size={10} strokeWidth={3}/></div>}
            </button>
          ))}
        </div>
      </div>

      <div className="sw-pref-section">
        <div className="sw-pref-label">Quality / Bitrate</div>
        <div className="sw-quality-grid">
          {qualities.map(q => (
            <button key={q.value} className={`sw-quality-card ${audioQuality === q.value ? 'active' : ''}`}
              onClick={() => setAudioQuality(q.value)}>
              <div className="sw-quality-value">{q.label}</div>
              <div className="sw-quality-sub">{q.sub}</div>
              {q.star && <div className="sw-quality-star">★</div>}
            </button>
          ))}
        </div>
      </div>

      <div className="sw-pref-section">
        <div className="sw-pref-label"><FolderOpen size={12} /> Download Folder</div>
        <div className="sw-path-row">
          <input className="sw-input" type="text" readOnly
            value={customPath || 'Default — next to the app'} title={customPath} />
          <button className="sw-path-btn" onClick={handleFolder}>
            <FolderOpen size={14} /> Browse
          </button>
        </div>
      </div>

      <div className="sw-nav">
        <button className="sw-btn-back" onClick={onBack}>Back</button>
        <button className="sw-btn-next" onClick={onNext}>Continue <ArrowRight size={16} /></button>
      </div>
    </div>
  )
}

// ── Step 3 — Done ────────────────────────────────────────────────────────────
function DoneStep({ audioFormat, audioQuality, customPath, onFinish }) {
  const [launching, setLaunching] = useState(false)
  const hasSpotify = !!storage.getItem('spotify_access_token')
  const summary = [
    { color: hasSpotify ? '#1DB954' : '#52525b', icon: hasSpotify ? <Check size={14}/> : <Link2 size={14}/>,
      label: 'Spotify', value: hasSpotify ? 'Connected' : 'Public fallback' },
    { color: '#a855f7', icon: <Music size={14}/>,
      label: 'Format', value: `${audioFormat.toUpperCase()} @ ${audioQuality}` },
    { color: '#3b82f6', icon: <Folder size={14}/>,
      label: 'Downloads', value: customPath ? customPath.split(/[\\/]/).pop() || customPath : 'App folder' },
    { color: '#ef4444', icon: <Cpu size={14}/>,
      label: 'Engine', value: 'yt-dlp + FFmpeg bundled' },
  ]

  return (
    <div className="sw-step-content">
      <div className="sw-step-tag-row">
        <div className="sw-step-tag">Step 4 of 4</div>
        <span className="sw-badge" style={{ background:'rgba(34,197,94,0.12)', color:'#4ade80', border:'1px solid rgba(34,197,94,0.2)' }}>All Set!</span>
      </div>

      <div className="sw-done-hero">
        <motion.div className="sw-done-ring sw-done-ring-1"
          initial={{ scale:0, opacity:0 }} animate={{ scale:1, opacity:1 }}
          transition={{ delay:0.1, duration:0.5 }} />
        <motion.div className="sw-done-ring sw-done-ring-2"
          initial={{ scale:0, opacity:0 }} animate={{ scale:1, opacity:1 }}
          transition={{ delay:0.2, duration:0.5 }} />
        <motion.div className="sw-done-check-big"
          initial={{ scale:0.3, opacity:0 }} animate={{ scale:1, opacity:1 }}
          transition={{ type:'spring', stiffness:280, damping:18, delay:0.15 }}>
          <Check size={48} color="white" strokeWidth={2.5} />
        </motion.div>
      </div>

      <h1 className="sw-step-title" style={{ textAlign:'center', marginBottom:'0.4rem' }}>You're all set!</h1>
      <p className="sw-step-sub" style={{ textAlign:'center', marginBottom:'1.5rem' }}>
        MediaDL is configured and ready to go.
      </p>

      <div className="sw-done-grid">
        {summary.map((s, i) => (
          <motion.div key={i} className="sw-done-tile"
            initial={{ opacity:0, scale:0.9 }} animate={{ opacity:1, scale:1 }}
            transition={{ delay: 0.25 + i * 0.07 }}>
            <div className="sw-done-tile-icon" style={{ color: s.color }}>{s.icon}</div>
            <div className="sw-done-tile-label">{s.label}</div>
            <div className="sw-done-tile-value" style={{ color: s.color }}>{s.value}</div>
          </motion.div>
        ))}
      </div>

      <button className="sw-btn-launch sw-btn-launch--big"
        onClick={async () => { setLaunching(true); try { await onFinish(); } catch { setLaunching(false); } }}
        disabled={launching}
        style={{ opacity: launching ? 0.7 : 1, cursor: launching ? 'default' : 'pointer' }}>
        <Zap size={20} /> {launching ? 'Starting…' : 'Launch MediaDL'}
      </button>
    </div>
  )
}

// ── Main Wizard ──────────────────────────────────────────────────────────────
export default function SetupWizard({ onComplete }) {
  const [step,          setStep]          = useState(0)
  const [direction,     setDirection]     = useState(1)
  const [audioFormat,   setAudioFormat]   = useState('mp3')
  const [audioQuality,  setAudioQuality]  = useState('320k')
  const [customPath,    setCustomPath]    = useState('')

  const go = (n) => {
    setDirection(n > step ? 1 : -1)
    setStep(n)
  }

  const finish = async () => {
    const data = {
      audioFormat,
      audioQuality,
      customPath,
    }
    // Mark setup done in localStorage (install-specific since userData is in {installDir}/app-data)
    storage.setItem('setup_complete',        '1')
    storage.setItem('audioFormat',           data.audioFormat)
    storage.setItem('audioQuality',          data.audioQuality)
    if (data.customPath) storage.setItem('customPath', data.customPath)
    // Also persist to config.json via backend (for server-side features)
    try {
      await fetch('/api/setup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    } catch {}
    onComplete(data)
  }

  const features = [
    { color: '#ef4444', icon: <Play size={15}/>,     title: 'YouTube',        sub: 'Videos, music & playlists' },
    { color: '#1DB954', icon: <Music2 size={15}/>,   title: 'Spotify',        sub: 'Full album & playlist support' },
    { color: '#22d3ee', icon: <Scissors size={15}/>, title: 'Audio Cutter',   sub: 'Trim, fade & export' },
    { color: '#a855f7', icon: <Layers size={15}/>,   title: 'Mass Downloads', sub: 'Hundreds at once' },
  ]

  return (
    <motion.div
      className="sw-root"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
    >
      {/* ── Left sidebar ── */}
      <div className="sw-left">
        <div className="sw-orb" />
        <div className="sw-orb-ring" />

        <div className="sw-logo-area">
          <div className="sw-logo">
            <div className="sw-logo-icon"><LogoIcon size={17} /></div>
            <div>
              <div className="sw-logo-name">MediaDL</div>
              <div className="sw-logo-sub">Media Downloader</div>
            </div>
          </div>
        </div>

        <div className="sw-left-body">
          <div className="sw-headline">Download<br />anything.</div>
          <div className="sw-tagline">Free, offline, and blazing fast.<br />No subscriptions. No limits.</div>
          <div className="sw-features">
            {features.map(f => (
              <div className="sw-feature" key={f.title} style={{ borderLeftColor: f.color }}>
                <div className="sw-feature-icon" style={{ background: f.color + '18', color: f.color }}>
                  {f.icon}
                </div>
                <div className="sw-feature-info">
                  <div className="sw-feature-title">{f.title}</div>
                  <div className="sw-feature-sub">{f.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="sw-steps-track">
            {STEPS.map((label, i) => (
              <div
                key={label}
                className={`sw-step-dot ${i === step ? 'active' : i < step ? 'done' : ''}`}
              >
                <div className="sw-step-pip" />
                {label}
              </div>
            ))}
          </div>
          <div className="sw-left-footer">
            v1.0.0 · All binaries bundled · No internet required for YouTube
          </div>
        </div>
      </div>

      {/* ── Right content ── */}
      <div className="sw-right">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            style={{ width: '100%' }}
          >
            {step === 0 && <WelcomeStep onNext={() => go(1)} />}
            {step === 1 && (
              <SpotifyStep
                onNext={() => go(2)}     onBack={() => go(0)}
              />
            )}
            {step === 2 && (
              <PreferencesStep
                audioFormat={audioFormat}   setAudioFormat={setAudioFormat}
                audioQuality={audioQuality} setAudioQuality={setAudioQuality}
                customPath={customPath}     setCustomPath={setCustomPath}
                onNext={() => go(3)}        onBack={() => go(1)}
              />
            )}
            {step === 3 && (
              <DoneStep
                audioFormat={audioFormat}
                audioQuality={audioQuality}
                customPath={customPath}
                onFinish={finish}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
