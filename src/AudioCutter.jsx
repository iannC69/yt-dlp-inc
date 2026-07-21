import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, FileAudio, FolderOpen, Loader2, Scissors,
  XCircle, Play, Pause, Square, SkipBack, Repeat,
  Volume2, Gauge, Sliders, Tag, Download, Music2
} from 'lucide-react';
import './AudioCutter.css';

const spring = { type: 'spring', stiffness: 320, damping: 28 };
const springFast = { type: 'spring', stiffness: 420, damping: 32 };
const BARS = 700;

function fmt(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const ss = (s % 60).toFixed(1).padStart(4, '0');
  return `${String(m).padStart(2, '0')}:${ss}`;
}

// ── Canvas waveform renderer ────────────────────────────────────────────────
function drawTimeline(canvas, { peaks, trimStart, trimEnd, playhead, fadeIn, fadeOut, duration }) {
  if (!canvas || !peaks || !duration) return;
  const ctx2d = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  if (!W || !H) return;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx2d.scale(dpr, dpr);

  // BG
  ctx2d.fillStyle = '#050810';
  ctx2d.fillRect(0, 0, W, H);

  const toX = t => (t / duration) * W;
  const sx = toX(trimStart);
  const ex = toX(trimEnd);

  // Dim outside selection
  ctx2d.fillStyle = 'rgba(0,0,0,0.52)';
  ctx2d.fillRect(0, 0, sx, H);
  ctx2d.fillRect(ex, 0, W - ex, H);

  // Grid
  ctx2d.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx2d.lineWidth = 1;
  for (let i = 1; i < 10; i++) {
    const gx = (i / 10) * W;
    ctx2d.beginPath(); ctx2d.moveTo(gx, 0); ctx2d.lineTo(gx, H); ctx2d.stroke();
  }
  ctx2d.beginPath(); ctx2d.moveTo(0, H / 2); ctx2d.lineTo(W, H / 2); ctx2d.stroke();

  // Bars
  const bw = W / peaks.length;
  for (let i = 0; i < peaks.length; i++) {
    const x = i * bw;
    const t = (i / peaks.length) * duration;
    const inSel = t >= trimStart && t <= trimEnd;
    const h = peaks[i] * H * 0.90;
    const y = (H - h) / 2;
    ctx2d.fillStyle = inSel
      ? `rgba(34,211,238,${0.55 + peaks[i] * 0.45})`
      : `rgba(55,70,95,${0.2 + peaks[i] * 0.2})`;
    ctx2d.fillRect(x + 0.5, y, Math.max(bw - 0.8, 0.8), h);
  }

  // Fade In gradient
  const clipLen = trimEnd - trimStart;
  if (fadeIn > 0 && clipLen > 0) {
    const fiD = Math.min(fadeIn, clipLen * 0.95);
    const fiEx = toX(trimStart + fiD);
    const g = ctx2d.createLinearGradient(sx, 0, fiEx, 0);
    g.addColorStop(0, 'rgba(168,85,247,0.55)');
    g.addColorStop(1, 'rgba(168,85,247,0)');
    ctx2d.fillStyle = g;
    ctx2d.fillRect(sx, 0, fiEx - sx, H);
    if (fiEx - sx > 28) {
      ctx2d.font = 'bold 9px system-ui';
      ctx2d.fillStyle = 'rgba(216,180,254,0.85)';
      ctx2d.fillText('FADE IN', sx + 5, 13);
    }
  }

  // Fade Out gradient
  if (fadeOut > 0 && clipLen > 0) {
    const foD = Math.min(fadeOut, clipLen * 0.95);
    const foSx = toX(trimEnd - foD);
    const g = ctx2d.createLinearGradient(foSx, 0, ex, 0);
    g.addColorStop(0, 'rgba(239,68,68,0)');
    g.addColorStop(1, 'rgba(239,68,68,0.55)');
    ctx2d.fillStyle = g;
    ctx2d.fillRect(foSx, 0, ex - foSx, H);
    if (ex - foSx > 28) {
      ctx2d.font = 'bold 9px system-ui';
      ctx2d.fillStyle = 'rgba(252,165,165,0.85)';
      ctx2d.textAlign = 'right';
      ctx2d.fillText('FADE OUT', ex - 5, 13);
      ctx2d.textAlign = 'left';
    }
  }

  // Selection outline
  ctx2d.strokeStyle = 'rgba(34,211,238,0.22)';
  ctx2d.lineWidth = 1;
  ctx2d.strokeRect(sx, 0, ex - sx, H);

  // ── Start handle ──
  ctx2d.fillStyle = '#22d3ee';
  ctx2d.fillRect(sx - 1.5, 0, 3, H);
  // Arrow head pointing right
  ctx2d.beginPath();
  ctx2d.moveTo(sx - 9, 2); ctx2d.lineTo(sx + 4, 2);
  ctx2d.lineTo(sx + 4, 20); ctx2d.lineTo(sx - 1, 27);
  ctx2d.lineTo(sx - 9, 20); ctx2d.closePath();
  ctx2d.fill();

  // ── End handle ──
  ctx2d.fillStyle = '#22d3ee';
  ctx2d.fillRect(ex - 1.5, 0, 3, H);
  ctx2d.beginPath();
  ctx2d.moveTo(ex + 9, 2); ctx2d.lineTo(ex - 3, 2);
  ctx2d.lineTo(ex - 3, 20); ctx2d.lineTo(ex + 1, 27);
  ctx2d.lineTo(ex + 9, 20); ctx2d.closePath();
  ctx2d.fill();

  // ── Playhead ──
  if (playhead >= 0 && playhead <= duration) {
    const px = toX(playhead);
    ctx2d.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx2d.lineWidth = 1.5;
    ctx2d.setLineDash([5, 3]);
    ctx2d.beginPath(); ctx2d.moveTo(px, 0); ctx2d.lineTo(px, H); ctx2d.stroke();
    ctx2d.setLineDash([]);
    // Triangle cap
    ctx2d.fillStyle = '#fff';
    ctx2d.beginPath();
    ctx2d.moveTo(px - 6, 0); ctx2d.lineTo(px + 6, 0); ctx2d.lineTo(px, 11); ctx2d.closePath();
    ctx2d.fill();
  }
}

// ── VU Meter (vertical bars) ────────────────────────────────────────────────
function VUMeter({ analyserRef, isPlaying }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const analyser = analyserRef.current;
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.scale(dpr, dpr);

      ctx.fillStyle = '#050810';
      ctx.fillRect(0, 0, W, H);

      let rms = 0;
      if (analyser && isPlaying) {
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let v of data) sum += v * v;
        rms = Math.min(1, Math.sqrt(sum / data.length) * 6);
      }

      const SEGMENTS = 22;
      const segH = (H - SEGMENTS) / SEGMENTS;
      for (let i = 0; i < SEGMENTS; i++) {
        const y = i * (segH + 1);
        const level = (SEGMENTS - 1 - i) / SEGMENTS;
        const active = rms > level * 0.85;
        let base, glow;
        if (i < 3) { base = 'rgba(239,68,68,'; glow = '#ef4444'; }
        else if (i < 6) { base = 'rgba(251,146,60,'; glow = '#fb923c'; }
        else { base = 'rgba(34,211,238,'; glow = '#22d3ee'; }

        if (active) {
          ctx.fillStyle = base + '1)';
          ctx.shadowBlur = 8; ctx.shadowColor = glow;
        } else {
          ctx.fillStyle = base + '0.1)';
          ctx.shadowBlur = 0;
        }
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(2, y, W - 4, segH, 2);
        else ctx.rect(2, y, W - 4, segH);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyserRef, isPlaying]);

  return <canvas ref={canvasRef} className="ac-vu-canvas" />;
}

// ── Custom range slider component ───────────────────────────────────────────
function Slider({ min, max, step, value, onChange, className = '' }) {
  return (
    <input
      type="range"
      min={min} max={max} step={step} value={value}
      onChange={e => onChange(Number(e.target.value))}
      className={`ac-slider ${className}`}
    />
  );
}

// ── Main component ───────────────────────────────────────────────────────────
const TABS = ['Effects', 'Metadata'];

export default function AudioCutter({ initialPayload }) {
  const [source, setSource] = useState(null);
  const [peaks, setPeaks] = useState(null);
  const [loadingWave, setLoadingWave] = useState(false);

  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loop, setLoop] = useState(false);

  const [effects, setEffects] = useState({ fadeIn: 0, fadeOut: 0, volume: 0, speed: 1.0, normalize: false });
  const setFx = (k, v) => setEffects(p => ({ ...p, [k]: v }));

  const [meta, setMeta] = useState({ title: '', artist: '', album: '', track: '' });
  const setMetaF = (k, v) => setMeta(p => ({ ...p, [k]: v }));

  const [format, setFormat] = useState('mp3');
  const [outputName, setOutputName] = useState('');
  const [status, setStatus] = useState({ type: 'idle', msg: '' });
  const [activeTab, setActiveTab] = useState('Effects');

  // Audio refs
  const canvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const audioBufRef = useRef(null);
  const srcNodeRef = useRef(null);
  const analyserRef = useRef(null);
  const playStartRef = useRef(0);   // audioCtx.currentTime at play
  const playOffRef = useRef(0);     // playhead at play
  const rafRef = useRef(null);
  const dragRef = useRef(null);     // 'start' | 'end' | 'seek' | null
  const isPlayingRef = useRef(false);
  const loopRef = useRef(false);
  const trimStartRef = useRef(0);
  const trimEndRef = useRef(0);
  const playheadRef = useRef(0);
  const sourceRef = useRef(null);

  // Keep refs in sync
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { loopRef.current = loop; }, [loop]);
  useEffect(() => { trimStartRef.current = trimStart; }, [trimStart]);
  useEffect(() => { trimEndRef.current = trimEnd; }, [trimEnd]);
  useEffect(() => { playheadRef.current = playhead; }, [playhead]);
  useEffect(() => { sourceRef.current = source; }, [source]);

  // Redraw canvas whenever these change
  useEffect(() => {
    if (!source || !peaks) return;
    drawTimeline(canvasRef.current, {
      peaks, trimStart, trimEnd, playhead,
      fadeIn: effects.fadeIn, fadeOut: effects.fadeOut,
      duration: source.duration
    });
  }, [peaks, trimStart, trimEnd, playhead, effects.fadeIn, effects.fadeOut, source]);

  // Cleanup on unmount
  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    if (srcNodeRef.current) { try { srcNodeRef.current.stop(); } catch {} }
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch {} }
  }, []);

  // ── Playback ──────────────────────────────────────────────────────────────
  const stopPlay = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (srcNodeRef.current) {
      try {
        srcNodeRef.current.onended = null;
        srcNodeRef.current.stop();
      } catch {}
      srcNodeRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const startPlay = useCallback(() => {
    const ctx = audioCtxRef.current;
    const buf = audioBufRef.current;
    if (!ctx || !buf) return;
    
    // stop any running
    if (srcNodeRef.current) {
      try {
        srcNodeRef.current.onended = null;
        srcNodeRef.current.stop();
      } catch {}
      srcNodeRef.current = null;
    }
    cancelAnimationFrame(rafRef.current);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyserRef.current = analyser;

    const node = ctx.createBufferSource();
    node.buffer = buf;
    
    // 1. Apply Speed
    const currentSpeed = effects.speed || 1.0;
    node.playbackRate.value = currentSpeed;

    // 2. Apply Volume & Fades via GainNode
    const gainNode = ctx.createGain();
    const baseGain = Math.pow(10, (effects.volume || 0) / 20);
    gainNode.gain.value = baseGain;

    node.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(ctx.destination);

    const offset = Math.max(trimStartRef.current, Math.min(playheadRef.current, trimEndRef.current - 0.05));
    const dur = trimEndRef.current - offset;
    
    // Apply Fades if applicable
    if (effects.fadeIn > 0 || effects.fadeOut > 0) {
      const now = ctx.currentTime;
      // Reset gain to base just in case
      gainNode.gain.setValueAtTime(baseGain, now);
      
      // If we are starting within the fade-in region
      if (effects.fadeIn > 0 && offset < trimStartRef.current + effects.fadeIn) {
        const timeIntoFade = offset - trimStartRef.current;
        const startGain = baseGain * (timeIntoFade / effects.fadeIn);
        const remainingFadeTime = (effects.fadeIn - timeIntoFade) / currentSpeed;
        
        gainNode.gain.setValueAtTime(startGain, now);
        gainNode.gain.linearRampToValueAtTime(baseGain, now + remainingFadeTime);
      }
      
      // If the playback will reach the fade-out region
      if (effects.fadeOut > 0) {
        const fadeOutStart = trimEndRef.current - effects.fadeOut;
        if (offset < trimEndRef.current) {
          const timeUntilFadeOut = Math.max(0, fadeOutStart - offset) / currentSpeed;
          const fadeDuration = effects.fadeOut / currentSpeed;
          
          if (offset >= fadeOutStart) {
            // We started already inside the fade out zone
            const timeIntoFadeOut = offset - fadeOutStart;
            const currentFadeGain = baseGain * (1 - (timeIntoFadeOut / effects.fadeOut));
            const remainingFadeTime = (effects.fadeOut - timeIntoFadeOut) / currentSpeed;
            
            gainNode.gain.setValueAtTime(currentFadeGain, now);
            gainNode.gain.linearRampToValueAtTime(0, now + remainingFadeTime);
          } else {
            // We will hit the fade out zone later
            gainNode.gain.setValueAtTime(baseGain, now + timeUntilFadeOut);
            gainNode.gain.linearRampToValueAtTime(0, now + timeUntilFadeOut + fadeDuration);
          }
        }
      }
    }

    playOffRef.current = offset;
    playStartRef.current = ctx.currentTime;
    
    // Compensate duration for speed
    node.start(0, offset, dur);
    
    node.onended = () => {
      if (!loopRef.current) setIsPlaying(false);
    };
    srcNodeRef.current = node;
    setIsPlaying(true);

    // Playhead animation
    const tick = () => {
      if (!isPlayingRef.current) return;
      const ctx2 = audioCtxRef.current;
      if (!ctx2) return;
      const pos = playOffRef.current + (ctx2.currentTime - playStartRef.current) * (effects.speed || 1.0);
      const clamped = Math.min(pos, trimEndRef.current);
      setPlayhead(clamped);
      if (clamped >= trimEndRef.current) {
        if (loopRef.current) {
          stopPlay();
          setTimeout(startPlay, 10);
        } else { stopPlay(); }
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopPlay, effects]);

  const togglePlay = useCallback(() => {
    if (isPlayingRef.current) stopPlay();
    else startPlay();
  }, [startPlay, stopPlay]);

  const goToStart = useCallback(() => { stopPlay(); setPlayhead(trimStartRef.current); }, [stopPlay]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'Home') { e.preventDefault(); goToStart(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, goToStart]);

  // ── File loading ──────────────────────────────────────────────────────────
  const loadFile = useCallback(async (data) => {
    stopPlay();
    setSource(data);
    setTrimStart(0); setTrimEnd(data.duration || 0);
    setPlayhead(0); setPeaks(null);
    setOutputName(data.name?.replace(/\.[^.]+$/, '') || 'clip');
    setMeta(p => ({ ...p, title: data.name?.replace(/\.[^.]+$/, '') || '' }));
    setStatus({ type: 'idle', msg: '' });
    setLoadingWave(true);

    try {
      if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch {} }
      const newCtx = new AudioContext();
      audioCtxRef.current = newCtx;

      const resp = await fetch(`/api/audio-cutter/stream?path=${encodeURIComponent(data.path)}`);
      if (!resp.ok) throw new Error('Could not stream audio file.');
      const arrBuf = await resp.arrayBuffer();
      const audioBuf = await newCtx.decodeAudioData(arrBuf);
      audioBufRef.current = audioBuf;

      // Generate peaks
      const len = audioBuf.length;
      const bk = Math.max(1, Math.floor(len / BARS));
      const numCh = Math.min(audioBuf.numberOfChannels, 2);
      const p = new Float32Array(BARS);
      for (let i = 0; i < BARS; i++) {
        let mx = 0;
        for (let ch = 0; ch < numCh; ch++) {
          const chData = audioBuf.getChannelData(ch);
          for (let j = 0; j < bk; j++) {
            const idx = i * bk + j;
            if (idx < chData.length) { const a = Math.abs(chData[idx]); if (a > mx) mx = a; }
          }
        }
        p[i] = mx;
      }
      setPeaks(p);
    } catch (err) {
      setStatus({ type: 'error', msg: 'Could not decode audio: ' + err.message });
    } finally { setLoadingWave(false); }
  }, [stopPlay]);

  useEffect(() => {
    if (initialPayload && initialPayload.filename) {
      loadFile({
        path: initialPayload.filename,
        name: initialPayload.title || initialPayload.filename.split(/[/\\]/).pop(),
        thumbnail: initialPayload.thumbnail,
        original_source: initialPayload.source,
        ...initialPayload
      });
    }
  }, [initialPayload, loadFile]);

  const selectSource = async () => {
    setStatus({ type: 'idle', msg: '' });
    try {
      const r = await fetch('/api/audio-cutter/select-source');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (data.success) await loadFile(data);
    } catch (err) { setStatus({ type: 'error', msg: err.message }); }
  };

  // ── Canvas mouse handling ─────────────────────────────────────────────────
  const getTime = useCallback((canvas, clientX) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    return (x / rect.width) * (sourceRef.current?.duration || 1);
  }, []);

  const onCanvasDown = useCallback(e => {
    const src = sourceRef.current;
    if (!src || !peaks) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const SNAP = 14;
    const sX = (trimStartRef.current / src.duration) * rect.width;
    const eX = (trimEndRef.current / src.duration) * rect.width;

    if (Math.abs(cx - sX) <= SNAP) dragRef.current = 'start';
    else if (Math.abs(cx - eX) <= SNAP) dragRef.current = 'end';
    else {
      dragRef.current = 'seek';
      stopPlay();
      const t = getTime(canvas, e.clientX);
      const clamped = Math.max(trimStartRef.current, Math.min(t, trimEndRef.current));
      setPlayhead(clamped);
    }
    e.preventDefault();
  }, [peaks, stopPlay, getTime]);

  const onMouseMove = useCallback(e => {
    const src = sourceRef.current;
    if (!dragRef.current || !src) return;
    const t = getTime(canvasRef.current, e.clientX);
    if (dragRef.current === 'start') setTrimStart(Math.max(0, Math.min(t, trimEndRef.current - 0.1)));
    else if (dragRef.current === 'end') setTrimEnd(Math.min(src.duration, Math.max(t, trimStartRef.current + 0.1)));
    else setPlayhead(Math.max(trimStartRef.current, Math.min(t, trimEndRef.current)));
  }, [getTime]);

  const onMouseUp = useCallback(() => { dragRef.current = null; }, []);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
  }, [onMouseMove, onMouseUp]);

  // ── Export ────────────────────────────────────────────────────────────────
  const doExport = async () => {
    if (!source) return setStatus({ type: 'error', msg: 'Choose an audio file first.' });
    if (trimEnd <= trimStart) return setStatus({ type: 'error', msg: 'Set a valid trim range.' });
    setStatus({ type: 'working', msg: 'Processing with FFmpeg…' });
    try {
      const r = await fetch('/api/audio-cutter/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath: source.path, start: trimStart, end: trimEnd, format, outputName, ...effects, metadata: meta })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Export failed.');
      setStatus({ type: 'done', msg: data.filename });
      const hist = JSON.parse(localStorage.getItem('global_history') || '[]');
      hist.unshift({ 
        id: `cutter_${Date.now()}`, 
        title: outputName || meta.title || 'Audio clip', 
        format: `audio:${format}`, 
        filename: data.filename, 
        source: 'cutter',
        thumbnail: source.thumbnail || null,
        original_source: source.original_source || null,
        date: Date.now() 
      });
      localStorage.setItem('global_history', JSON.stringify(hist.slice(0, 500)));
      window.dispatchEvent(new Event('history_updated'));
    } catch (err) { setStatus({ type: 'error', msg: err.message }); }
  };

  const clipLen = Math.max(0, trimEnd - trimStart);
  const fadeCap = Math.max(0.1, clipLen * 0.45);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="ac-page">
      <div className="ac-glow" />

      {/* Top bar */}
      <div className="ac-topbar">
        <div className="ac-topbar-left">
          <span className="ac-badge"><Scissors size={12} /> Audio Editor</span>
          {source
            ? <span className="ac-topbar-file"><Music2 size={13} />{source.name}</span>
            : <span className="ac-topbar-file ac-topbar-file--dim">No file loaded</span>}
        </div>
        <button className="ac-open-btn" onClick={selectSource}>
          <FileAudio size={14} />{source ? 'Change file' : 'Open file'}
        </button>
      </div>

      {/* Main body */}
      <div className="ac-body">
        {!source ? (
          /* Drop zone */
          <motion.div className="ac-dropzone" onClick={selectSource} whileHover={{ scale: 1.01 }} transition={spring}>
            <div className="ac-dropzone-icon"><FileAudio size={44} strokeWidth={1.1} /></div>
            <p className="ac-dz-title">Open an audio file to edit</p>
            <p className="ac-dz-sub">MP3 · WAV · M4A · FLAC · OGG · OPUS · WEBM</p>
            <span className="ac-dz-btn">Browse files</span>
          </motion.div>
        ) : (
          <>
            {/* Time info row */}
            <div className="ac-timerow">
              {[
                { label: 'Start', val: fmt(trimStart) },
                { label: 'Duration', val: fmt(clipLen), main: true },
                { label: 'End', val: fmt(trimEnd) },
                { label: 'Total', val: fmt(source.duration) },
                { label: 'Playhead', val: fmt(playhead), bright: true },
              ].map(({ label, val, main, bright }) => (
                <div key={label} className={`ac-tc${main ? ' ac-tc--main' : ''}${bright ? ' ac-tc--bright' : ''}`}>
                  <span className="ac-tc-label">{label}</span>
                  <span className="ac-tc-val">{val}</span>
                </div>
              ))}
            </div>

            {/* Waveform + VU */}
            <div className="ac-waveform-row">
              <div className="ac-waveform-wrap">
                <AnimatePresence>
                  {loadingWave && (
                    <motion.div className="ac-waveform-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <Loader2 size={22} className="ac-spin" />
                      <span>Decoding waveform…</span>
                    </motion.div>
                  )}
                </AnimatePresence>
                <canvas ref={canvasRef} className="ac-waveform-canvas" onMouseDown={onCanvasDown} style={{ cursor: 'col-resize' }} />
                {/* Ruler */}
                <div className="ac-ruler">
                  {Array.from({ length: 11 }, (_, i) => (
                    <span key={i} style={{ left: `${i * 10}%` }}>{fmt((i / 10) * source.duration)}</span>
                  ))}
                </div>
              </div>
              <div className="ac-vu-col">
                <VUMeter analyserRef={analyserRef} isPlaying={isPlaying} />
                <span className="ac-vu-label">VU</span>
              </div>
            </div>

            {/* Transport bar */}
            <div className="ac-transport">
              <div className="ac-transport-left">
                <button className="ac-tbtn" onClick={goToStart} title="Go to start (Home)"><SkipBack size={15} /></button>
                <button className={`ac-tbtn ac-tbtn--play ${isPlaying ? 'playing' : ''}`} onClick={togglePlay} title="Play/Pause (Space)">
                  {isPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
                </button>
                <button className="ac-tbtn" onClick={stopPlay} title="Stop"><Square size={14} fill="currentColor" /></button>
                <button className={`ac-tbtn ${loop ? 'ac-tbtn--active' : ''}`} onClick={() => setLoop(l => !l)} title="Loop region">
                  <Repeat size={14} />
                </button>
              </div>
              <div className="ac-transport-sep" />
              <div className="ac-trim-fields">
                <label className="ac-trim-field">
                  <span>Start (s)</span>
                  <input type="number" min="0" max={trimEnd - 0.1} step="0.01"
                    value={trimStart.toFixed(2)}
                    onChange={e => setTrimStart(Math.max(0, Math.min(Number(e.target.value), trimEnd - 0.1)))}
                  />
                </label>
                <label className="ac-trim-field">
                  <span>End (s)</span>
                  <input type="number" min={trimStart + 0.1} max={source.duration} step="0.01"
                    value={trimEnd.toFixed(2)}
                    onChange={e => setTrimEnd(Math.min(source.duration, Math.max(Number(e.target.value), trimStart + 0.1)))}
                  />
                </label>
              </div>
            </div>

            {/* Tabs */}
            <div className="ac-tabs">
              {TABS.map(t => (
                <button key={t} className={`ac-tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>
                  {t === 'Effects' && <Sliders size={13} />}
                  {t === 'Metadata' && <Tag size={13} />}
                  {t}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {activeTab === 'Effects' && (
                <motion.div key="fx" className="ac-panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={spring}>
                  <div className="ac-fx-grid">

                    {/* Volume */}
                    <div className="ac-fx-item">
                      <div className="ac-fx-hdr"><Volume2 size={13} /><span>Volume / Gain</span><span className="ac-fx-val">{effects.volume > 0 ? '+' : ''}{effects.volume} dB</span></div>
                      <Slider min={-20} max={20} step={0.5} value={effects.volume} onChange={v => setFx('volume', v)} />
                      <div className="ac-slider-marks"><span>-20 dB</span><span>0</span><span>+20 dB</span></div>
                    </div>

                    {/* Speed */}
                    <div className="ac-fx-item">
                      <div className="ac-fx-hdr"><Gauge size={13} /><span>Speed / Tempo</span><span className="ac-fx-val">{effects.speed.toFixed(2)}×</span></div>
                      <Slider min={0.5} max={2.0} step={0.05} value={effects.speed} onChange={v => setFx('speed', v)} className="ac-slider--speed" />
                      <div className="ac-slider-marks"><span>0.5×</span><span>1×</span><span>2×</span></div>
                    </div>

                    {/* Fade In */}
                    <div className="ac-fx-item">
                      <div className="ac-fx-hdr"><span className="ac-dot ac-dot--in" /><span>Fade In</span><span className="ac-fx-val">{effects.fadeIn.toFixed(1)} s</span></div>
                      <Slider min={0} max={fadeCap} step={0.1} value={Math.min(effects.fadeIn, fadeCap)} onChange={v => setFx('fadeIn', v)} className="ac-slider--fi" />
                      <div className="ac-slider-marks"><span>Off</span><span>{fadeCap.toFixed(1)} s max</span></div>
                    </div>

                    {/* Fade Out */}
                    <div className="ac-fx-item">
                      <div className="ac-fx-hdr"><span className="ac-dot ac-dot--out" /><span>Fade Out</span><span className="ac-fx-val">{effects.fadeOut.toFixed(1)} s</span></div>
                      <Slider min={0} max={fadeCap} step={0.1} value={Math.min(effects.fadeOut, fadeCap)} onChange={v => setFx('fadeOut', v)} className="ac-slider--fo" />
                      <div className="ac-slider-marks"><span>Off</span><span>{fadeCap.toFixed(1)} s max</span></div>
                    </div>

                    {/* Normalize */}
                    <div className="ac-fx-item ac-fx-item--full">
                      <label className="ac-toggle-row">
                        <div className="ac-toggle-switch">
                          <input type="checkbox" checked={effects.normalize} onChange={e => setFx('normalize', e.target.checked)} />
                          <span className="ac-toggle-track"><span className="ac-toggle-thumb" /></span>
                        </div>
                        <div className="ac-toggle-copy">
                          <strong>Normalize loudness</strong>
                          <small>EBU R128 — FFmpeg loudnorm filter (−16 LUFS target)</small>
                        </div>
                      </label>
                    </div>

                  </div>
                </motion.div>
              )}

              {activeTab === 'Metadata' && (
                <motion.div key="meta" className="ac-panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={spring}>
                  <div className="ac-meta-grid">
                    {[['title', 'Title', 'Track title'], ['artist', 'Artist', 'Artist name'], ['album', 'Album', 'Album name'], ['track', 'Track #', '1']].map(([k, lbl, ph]) => (
                      <label key={k} className="ac-meta-field">
                        <span>{lbl}</span>
                        <input value={meta[k]} onChange={e => setMetaF(k, e.target.value)} placeholder={ph} type={k === 'track' ? 'number' : 'text'} min={k === 'track' ? 1 : undefined} />
                      </label>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>

      {/* Export bar */}
      {source && (
        <motion.div className="ac-export-bar" initial={{ y: 60 }} animate={{ y: 0 }} transition={spring}>
          <input className="ac-export-name" value={outputName} onChange={e => setOutputName(e.target.value)} placeholder="Output filename…" maxLength={120} />
          <select className="ac-format-sel" value={format} onChange={e => setFormat(e.target.value)}>
            <option value="mp3">MP3</option>
            <option value="m4a">M4A / AAC</option>
            <option value="wav">WAV</option>
            <option value="flac">FLAC</option>
          </select>
          <button className="ac-export-btn" onClick={doExport} disabled={status.type === 'working'}>
            {status.type === 'working'
              ? <><Loader2 size={15} className="ac-spin" /> Processing…</>
              : <><Download size={15} /> Export clip</>}
          </button>
        </motion.div>
      )}

      {/* Status toast */}
      <AnimatePresence>
        {status.type !== 'idle' && (
          <motion.div
            className={`ac-toast ac-toast--${status.type}`}
            initial={{ opacity: 0, y: 24, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.94 }}
            transition={springFast}
          >
            {status.type === 'done' && <CheckCircle2 size={15} />}
            {status.type === 'error' && <XCircle size={15} />}
            {status.type === 'working' && <Loader2 size={15} className="ac-spin" />}
            <span>{status.type === 'done' ? `Saved: ${status.msg}` : status.msg}</span>
            {status.type === 'done' && (
              <button className="ac-toast-open" onClick={() => fetch(`/api/ytdl/open-folder?target=${encodeURIComponent(status.msg)}`)}>
                <FolderOpen size={13} /> Open folder
              </button>
            )}
            <button className="ac-toast-x" onClick={() => setStatus({ type: 'idle', msg: '' })}>✕</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
