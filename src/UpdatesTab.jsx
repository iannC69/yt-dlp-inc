import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Download, CheckCircle, AlertTriangle, ArrowDownCircle, Rocket, Tag, Clock, ExternalLink, Zap } from 'lucide-react';

const STATUS_LABELS = {
  idle: '',
  checking: 'Checking for updates...',
  available: 'Update available!',
  'not-available': "You're up to date",
  downloading: 'Downloading update...',
  downloaded: 'Ready to install',
  error: 'Update failed'
};

const STATUS_COLORS = {
  idle: 'rgba(255,255,255,0.3)',
  checking: '#818cf8',
  available: '#f59e0b',
  'not-available': '#34d399',
  downloading: '#6366f1',
  downloaded: '#34d399',
  error: '#f87171'
};

export default function UpdatesTab() {
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [changelog, setChangelog] = useState([]);

  useEffect(() => {
    if (!window.electronAPI?.updater) return;
    window.electronAPI.updater.getAppVersion().then(v => setVersion(v));

    const cleanup = window.electronAPI.updater.onUpdaterEvent((name, data) => {
      if (name === 'checking-for-update') setStatus('checking');
      if (name === 'update-available') {
        setStatus('available');
        setUpdateInfo(data);
        if (data?.releaseNotes) {
          const lines = parseChangelog(data.releaseNotes);
          setChangelog(lines);
        }
      }
      if (name === 'update-not-available') setStatus('not-available');
      if (name === 'error') {
        setStatus('error');
        setErrorMessage(typeof data === 'string' ? data : data?.message || 'Unknown error');
      }
      if (name === 'download-progress') {
        setStatus('downloading');
        setProgress(data?.percent || 0);
        setSpeed(data?.bytesPerSecond || 0);
      }
      if (name === 'update-downloaded') {
        setStatus('downloaded');
        setUpdateInfo(prev => ({ ...prev, ...data }));
      }
    });
    return cleanup;
  }, []);

  function parseChangelog(html) {
    if (!html) return [];
    const items = [];
    const liRegex = /<li[^>]*>(.*?)<\/li>/gi;
    let m;
    while ((m = liRegex.exec(html)) !== null) {
      const t = m[1].replace(/<[^>]+>/g, '').trim();
      if (t) items.push(t);
    }
    if (items.length === 0) {
      return html.replace(/<[^>]+>/g, '\n').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 8);
    }
    return items.slice(0, 8);
  }

  const checkForUpdates = () => {
    if (!window.electronAPI?.updater) return;
    setStatus('checking');
    setUpdateInfo(null);
    setChangelog([]);
    window.electronAPI.updater.checkForUpdates();
  };

  const downloadUpdate = () => {
    if (!window.electronAPI?.updater) return;
    setStatus('downloading');
    setProgress(0);
    window.electronAPI.updater.downloadUpdate();
  };

  const installUpdate = () => {
    if (!window.electronAPI?.updater) return;
    window.electronAPI.updater.installUpdate();
  };

  const color = STATUS_COLORS[status] || STATUS_COLORS.idle;

  return (
    <div className="ut-wrap">
      <style>{`
        .ut-wrap {
          padding: 1.5rem 2rem;
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          font-family: 'Inter', system-ui, sans-serif;
          overflow-y: auto;
        }

        /* App version card */
        .ut-version-card {
          background: linear-gradient(135deg, rgba(99,102,241,0.08), rgba(168,85,247,0.08));
          border: 1px solid rgba(99,102,241,0.2);
          border-radius: 16px;
          padding: 1.25rem 1.5rem;
          display: flex;
          align-items: center;
          gap: 1rem;
        }
        .ut-app-icon {
          width: 48px; height: 48px;
          border-radius: 12px;
          background: linear-gradient(135deg, #6366f1, #a855f7);
          display: flex; align-items: center; justify-content: center;
          color: #fff; font-weight: 800; font-size: 1.1rem;
          box-shadow: 0 4px 16px rgba(99,102,241,0.35);
          flex-shrink: 0;
        }
        .ut-version-info { flex: 1; }
        .ut-version-title {
          font-size: 1rem; font-weight: 700; color: #f1f5f9; margin-bottom: 0.2rem;
        }
        .ut-version-num {
          font-size: 0.82rem; color: rgba(255,255,255,0.45);
        }
        .ut-status-pill {
          display: flex; align-items: center; gap: 0.4rem;
          font-size: 0.8rem; font-weight: 600;
          padding: 0.35rem 0.85rem;
          border-radius: 999px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.5);
          transition: color 0.3s;
        }

        /* Status dot */
        .ut-dot {
          width: 7px; height: 7px; border-radius: 50%;
          flex-shrink: 0; transition: background 0.3s;
        }

        /* Progress bar */
        .ut-progress-wrap {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 12px;
          padding: 1rem 1.25rem;
        }
        .ut-progress-label {
          display: flex; justify-content: space-between;
          font-size: 0.82rem; color: rgba(255,255,255,0.5);
          margin-bottom: 0.65rem;
        }
        .ut-bar {
          height: 8px;
          background: rgba(255,255,255,0.06);
          border-radius: 999px;
          overflow: hidden;
        }
        .ut-bar-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #6366f1, #a855f7);
          box-shadow: 0 0 10px rgba(99,102,241,0.5);
          transition: width 0.3s linear;
        }
        .ut-speed {
          display: flex; align-items: center; gap: 0.3rem;
          font-size: 0.78rem; color: rgba(255,255,255,0.35);
          margin-top: 0.5rem;
        }

        /* Changelog */
        .ut-changelog-card {
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px;
          padding: 1rem 1.25rem;
        }
        .ut-changelog-title {
          font-size: 0.72rem; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.08em;
          color: rgba(255,255,255,0.3);
          margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem;
        }
        .ut-changelog-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
        .ut-changelog-item {
          display: flex; align-items: flex-start; gap: 0.55rem;
          font-size: 0.86rem; color: rgba(255,255,255,0.7); line-height: 1.4;
        }
        .ut-changelog-icon { color: #34d399; flex-shrink: 0; margin-top: 1px; }

        /* Buttons */
        .ut-actions { display: flex; flex-direction: column; gap: 0.65rem; }
        .ut-btn-check {
          display: flex; align-items: center; justify-content: center; gap: 0.5rem;
          padding: 0.75rem 1.5rem; border-radius: 10px;
          background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.3);
          color: #818cf8; font-weight: 600; font-size: 0.9rem;
          cursor: pointer; transition: all 0.2s; font-family: inherit;
          width: 100%;
        }
        .ut-btn-check:hover { background: rgba(99,102,241,0.18); border-color: rgba(99,102,241,0.5); color: #a5b4fc; }
        .ut-btn-download {
          display: flex; align-items: center; justify-content: center; gap: 0.5rem;
          padding: 0.75rem 1.5rem; border-radius: 10px;
          background: linear-gradient(135deg, rgba(99,102,241,0.2), rgba(168,85,247,0.2));
          border: 1px solid rgba(99,102,241,0.4);
          color: #c4b5fd; font-weight: 600; font-size: 0.9rem;
          cursor: pointer; transition: all 0.2s; font-family: inherit;
          width: 100%;
        }
        .ut-btn-download:hover { background: linear-gradient(135deg, rgba(99,102,241,0.3), rgba(168,85,247,0.3)); transform: translateY(-1px); }
        .ut-btn-install {
          display: flex; align-items: center; justify-content: center; gap: 0.5rem;
          padding: 0.75rem 1.5rem; border-radius: 10px;
          background: linear-gradient(135deg, #6366f1, #a855f7);
          border: none;
          color: #fff; font-weight: 700; font-size: 0.9rem;
          cursor: pointer; transition: all 0.2s; font-family: inherit;
          width: 100%;
          box-shadow: 0 4px 16px rgba(99,102,241,0.35);
        }
        .ut-btn-install:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(99,102,241,0.5); }

        /* Up to date message */
        .ut-uptodate {
          display: flex; flex-direction: column; align-items: center;
          gap: 0.5rem; padding: 1.5rem; text-align: center;
          background: rgba(52,211,153,0.05); border: 1px solid rgba(52,211,153,0.15);
          border-radius: 12px;
        }
        .ut-uptodate svg { color: #34d399; }
        .ut-uptodate-msg { font-size: 0.95rem; color: #34d399; font-weight: 600; }
        .ut-uptodate-sub { font-size: 0.82rem; color: rgba(255,255,255,0.35); }

        /* Error */
        .ut-error-box {
          display: flex; flex-direction: column; gap: 0.5rem;
          padding: 1rem 1.25rem;
          background: rgba(248,113,113,0.06); border: 1px solid rgba(248,113,113,0.2);
          border-radius: 12px;
        }
        .ut-error-title { display: flex; align-items: center; gap: 0.5rem; color: #f87171; font-weight: 600; font-size: 0.9rem; }
        .ut-error-msg { font-size: 0.8rem; color: rgba(255,255,255,0.4); word-break: break-word; }

        /* Spin */
        @keyframes ut-spin { to { transform: rotate(360deg); } }
        .ut-spinning { animation: ut-spin 1.2s linear infinite; }

        .ut-wrap::-webkit-scrollbar { width: 4px; }
        .ut-wrap::-webkit-scrollbar-track { background: transparent; }
        .ut-wrap::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
      `}</style>

      {/* Version card */}
      <div className="ut-version-card">
        <div className="ut-app-icon">M</div>
        <div className="ut-version-info">
          <div className="ut-version-title">MediaDL</div>
          <div className="ut-version-num">Version {version || '...'}</div>
        </div>
        <div className="ut-status-pill" style={{ color }}>
          <div className="ut-dot" style={{ background: color }} />
          {STATUS_LABELS[status] || 'Idle'}
        </div>
      </div>

      {/* Downloading progress */}
      <AnimatePresence>
        {status === 'downloading' && (
          <motion.div
            className="ut-progress-wrap"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <div className="ut-progress-label">
              <span>Downloading v{updateInfo?.version}...</span>
              <span style={{ color: '#818cf8', fontWeight: 700 }}>{Math.round(progress)}%</span>
            </div>
            <div className="ut-bar">
              <div className="ut-bar-fill" style={{ width: `${progress}%` }} />
            </div>
            {speed > 0 && (
              <div className="ut-speed">
                <Zap size={11} />
                {(speed / 1024 / 1024).toFixed(1)} MB/s
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Changelog */}
      <AnimatePresence>
        {changelog.length > 0 && (
          <motion.div
            className="ut-changelog-card"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="ut-changelog-title">
              <Tag size={12} /> What's new in v{updateInfo?.version}
            </div>
            <ul className="ut-changelog-list">
              {changelog.map((item, i) => (
                <motion.li
                  key={i}
                  className="ut-changelog-item"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <CheckCircle size={13} className="ut-changelog-icon" />
                  {item}
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Up to date */}
      <AnimatePresence>
        {status === 'not-available' && (
          <motion.div className="ut-uptodate" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <CheckCircle size={32} />
            <div className="ut-uptodate-msg">You're up to date!</div>
            <div className="ut-uptodate-sub">MediaDL v{version} is the latest version.</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      <AnimatePresence>
        {status === 'error' && (
          <motion.div className="ut-error-box" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="ut-error-title"><AlertTriangle size={15} /> Update failed</div>
            <div className="ut-error-msg">{errorMessage}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions */}
      <div className="ut-actions">
        {(status === 'idle' || status === 'not-available' || status === 'error') && (
          <button className="ut-btn-check" onClick={checkForUpdates}>
            <RefreshCw size={15} className={status === 'checking' ? 'ut-spinning' : ''} />
            {status === 'checking' ? 'Checking...' : 'Check for Updates'}
          </button>
        )}
        {status === 'available' && (
          <button className="ut-btn-download" onClick={downloadUpdate}>
            <ArrowDownCircle size={15} />
            Download Update v{updateInfo?.version}
          </button>
        )}
        {status === 'downloaded' && (
          <button className="ut-btn-install" onClick={installUpdate}>
            <Rocket size={15} />
            Restart &amp; Install v{updateInfo?.version}
          </button>
        )}
      </div>
    </div>
  );
}
