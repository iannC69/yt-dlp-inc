import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, FileAudio, FolderOpen, Loader2, Music2, Scissors, Timer, XCircle } from 'lucide-react';
import './AudioCutter.css';

function secondsToTime(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60);
  return [hours, minutes, remainder].map((part, index) => index === 0 ? String(part).padStart(2, '0') : String(part).padStart(2, '0')).join(':');
}

export default function AudioCutter() {
  const [source, setSource] = useState(null);
  const [start, setStart] = useState('0');
  const [end, setEnd] = useState('');
  const [outputName, setOutputName] = useState('');
  const [format, setFormat] = useState('mp3');
  const [state, setState] = useState({ status: 'idle', message: '' });

  const selectSource = async () => {
    setState({ status: 'idle', message: '' });
    try {
      const response = await fetch('/api/audio-cutter/select-source');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not select the source file.');
      if (data.success) {
        setSource(data);
        setStart('0');
        setEnd(data.duration ? String(Math.floor(data.duration)) : '');
        setOutputName(data.name?.replace(/\.[^.]+$/, '') || 'clip');
      }
    } catch (error) {
      setState({ status: 'error', message: error.message });
    }
  };

  const cutAudio = async () => {
    const startSeconds = Number(start);
    const endSeconds = Number(end);
    if (!source) return setState({ status: 'error', message: 'Choose an audio file first.' });
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds) {
      return setState({ status: 'error', message: 'Set an end time that is greater than the start time.' });
    }
    if (source.duration && endSeconds > source.duration + 0.1) {
      return setState({ status: 'error', message: 'The end time is beyond the source duration.' });
    }

    setState({ status: 'working', message: 'Cutting audio and preserving metadata…' });
    try {
      const response = await fetch('/api/audio-cutter/cut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath: source.path, start: startSeconds, end: endSeconds, outputName, format })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Audio cutting failed.');
      setState({ status: 'done', message: data.filename });
      const history = JSON.parse(localStorage.getItem('global_history') || '[]');
      history.unshift({
        id: `cutter_${Date.now()}`,
        title: data.title || outputName || 'Audio clip',
        format: `audio:${format}`,
        filename: data.filename,
        source: 'cutter',
        date: Date.now()
      });
      localStorage.setItem('global_history', JSON.stringify(history.slice(0, 500)));
      window.dispatchEvent(new Event('history_updated'));
    } catch (error) {
      setState({ status: 'error', message: error.message });
    }
  };

  const openFolder = () => fetch(`/api/ytdl/open-folder?target=${encodeURIComponent(state.message)}`);

  return (
    <div className="cutter-page">
      <div className="cutter-glow" />
      <main className="cutter-layout">
        <header className="cutter-header">
          <div className="cutter-badge"><Scissors size={14} /> Audio tools</div>
          <h1>Precision audio cutter</h1>
          <p>Trim a local track into a clean clip. Your original file is never changed.</p>
        </header>

        <section className="cutter-card">
          <button className="cutter-source" onClick={selectSource}>
            <span className="cutter-source-icon">{source ? <Music2 size={24} /> : <FileAudio size={24} />}</span>
            <span className="cutter-source-copy">
              <strong>{source?.name || 'Choose an audio file'}</strong>
              <small>{source ? `${source.extension?.toUpperCase()} · ${secondsToTime(source.duration)}` : 'MP3, WAV, M4A, FLAC, OGG and more'}</small>
            </span>
            <span className="cutter-source-action">Browse</span>
          </button>

          <div className="cutter-grid">
            <label><span><Timer size={14} /> Start (seconds)</span><input type="number" min="0" step="0.01" value={start} onChange={(event) => setStart(event.target.value)} disabled={!source || state.status === 'working'} /></label>
            <label><span><Timer size={14} /> End (seconds)</span><input type="number" min="0" step="0.01" value={end} onChange={(event) => setEnd(event.target.value)} disabled={!source || state.status === 'working'} /></label>
            <label className="cutter-name"><span>Clip name</span><input value={outputName} maxLength="120" onChange={(event) => setOutputName(event.target.value)} disabled={!source || state.status === 'working'} /></label>
            <label><span>Export format</span><select value={format} onChange={(event) => setFormat(event.target.value)} disabled={!source || state.status === 'working'}><option value="mp3">MP3</option><option value="m4a">M4A</option><option value="wav">WAV</option><option value="flac">FLAC</option></select></label>
          </div>

          {source && Number(end) > Number(start) && <div className="cutter-range"><span style={{ left: `${source.duration ? Math.min(100, (Number(start) / source.duration) * 100) : 0}%`, width: `${source.duration ? Math.min(100, ((Number(end) - Number(start)) / source.duration) * 100) : 0}%` }} /></div>}

          <button className="cutter-submit" onClick={cutAudio} disabled={!source || state.status === 'working'}>
            {state.status === 'working' ? <Loader2 className="cutter-spin" size={18} /> : <Scissors size={18} />}
            {state.status === 'working' ? 'Creating clip…' : 'Create audio clip'}
          </button>
        </section>

        <AnimatePresence>
          {state.status !== 'idle' && <motion.div className={`cutter-status cutter-status--${state.status}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {state.status === 'done' ? <CheckCircle2 size={18} /> : state.status === 'error' ? <XCircle size={18} /> : <Loader2 className="cutter-spin" size={18} />}
            <span>{state.status === 'done' ? `Saved ${state.message}` : state.message}</span>
            {state.status === 'done' && <button onClick={openFolder}><FolderOpen size={15} /> Open folder</button>}
          </motion.div>}
        </AnimatePresence>
      </main>
      <footer className="tool-footer"><span>MediaDL Audio Cutter</span><span>Non-destructive editing · Metadata preserved where supported</span></footer>
    </div>
  );
}
