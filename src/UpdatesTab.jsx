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
  
  // Custom Timeline History
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    fetchHistory();
    
    if (!window.electronAPI?.updater) return;
    window.electronAPI.updater.getAppVersion().then(v => setVersion(v));

    const cleanup = window.electronAPI.updater.onUpdaterEvent((name, data) => {
      if (name === 'checking-for-update') setStatus('checking');
      if (name === 'update-available') {
        setStatus('available');
        setUpdateInfo(data);
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

  const fetchHistory = async () => {
    try {
      setLoadingHistory(true);
      // Try to fetch from live GitHub repository first for real-time updates
      const res = await fetch('https://raw.githubusercontent.com/iannC69/yt-dlp-inc/main/releases.json?cachebust=' + Date.now());
      if (!res.ok) throw new Error('Live fetch failed');
      const data = await res.json();
      setHistory(Array.isArray(data) ? data : []);
    } catch (e) {
      console.warn('Live fetch failed, falling back to local history', e);
      // Fallback to local history
      try {
        const localRes = await fetch('/api/updates/history');
        const localData = await localRes.json();
        setHistory(Array.isArray(localData) ? localData : []);
      } catch (localErr) {
        console.error('Failed to fetch local history', localErr);
      }
    } finally {
      setLoadingHistory(false);
    }
  };

  const checkForUpdates = () => {
    if (!window.electronAPI?.updater) return;
    setStatus('checking');
    setUpdateInfo(null);
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
    <div className="ut-glass-wrap">
      <style>{`
        .ut-glass-wrap {
          padding: 2rem;
          height: 100%;
          display: flex;
          gap: 2rem;
          font-family: 'Inter', system-ui, sans-serif;
          overflow: hidden;
          background: #090a10;
        }

        /* Left Panel - Status & Actions */
        .ut-left-panel {
          width: 280px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .ut-status-card {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          position: relative;
          overflow: hidden;
        }
        
        .ut-status-card::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 2px;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
        }

        .ut-icon-wrapper {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.05);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 1rem;
          color: #f1f5f9;
        }

        .ut-status-title {
          font-size: 1.1rem;
          font-weight: 600;
          color: #fff;
          margin-bottom: 0.5rem;
        }

        .ut-status-desc {
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.5);
          margin-bottom: 1.5rem;
          line-height: 1.4;
        }

        .ut-version-flow {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          background: rgba(0, 0, 0, 0.3);
          padding: 0.5rem 1rem;
          border-radius: 999px;
          font-family: monospace;
          font-size: 0.85rem;
          margin-bottom: 1.5rem;
          border: 1px solid rgba(255, 255, 255, 0.05);
        }

        .ut-v-current { color: rgba(255, 255, 255, 0.6); }
        .ut-v-arrow { color: rgba(255, 255, 255, 0.3); }
        .ut-v-new { color: #fff; font-weight: bold; background: rgba(255,255,255,0.1); padding: 0.1rem 0.4rem; border-radius: 4px;}

        .ut-btn {
          width: 100%;
          padding: 0.8rem;
          border-radius: 8px;
          font-weight: 600;
          font-size: 0.9rem;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          border: none;
          font-family: inherit;
        }

        .ut-btn.primary {
          background: #f1f5f9;
          color: #0f172a;
        }
        .ut-btn.primary:hover { background: #fff; }

        .ut-btn.secondary {
          background: transparent;
          color: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .ut-btn.secondary:hover { background: rgba(255, 255, 255, 0.05); color: #fff; }

        .ut-progress-container {
          width: 100%;
          margin-bottom: 1rem;
        }
        .ut-progress-bar {
          height: 6px;
          background: rgba(255,255,255,0.1);
          border-radius: 999px;
          overflow: hidden;
          margin-bottom: 0.5rem;
        }
        .ut-progress-fill {
          height: 100%;
          background: #fff;
          border-radius: 999px;
          transition: width 0.3s;
        }
        .ut-progress-text {
          font-size: 0.75rem;
          color: rgba(255,255,255,0.5);
          display: flex;
          justify-content: space-between;
        }

        /* Right Panel - Timeline */
        .ut-right-panel {
          flex: 1;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 16px;
          padding: 2rem;
          overflow-y: auto;
          position: relative;
        }

        .ut-timeline-line {
          position: absolute;
          top: 2rem;
          bottom: 2rem;
          left: 2rem;
          width: 2px;
          background: rgba(255, 255, 255, 0.05);
          z-index: 1;
        }

        .ut-timeline-item {
          position: relative;
          z-index: 2;
          padding-left: 2rem;
          margin-bottom: 3rem;
        }

        .ut-timeline-item:last-child {
          margin-bottom: 0;
        }

        .ut-timeline-dot {
          position: absolute;
          left: -4px;
          top: 0.4rem;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.2);
          border: 2px solid #090a10;
        }
        .ut-timeline-dot.latest {
          background: #34d399;
          box-shadow: 0 0 10px rgba(52, 211, 153, 0.5);
        }

        .ut-tl-header {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 0.5rem;
        }

        .ut-tl-version {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
          padding: 0.2rem 0.6rem;
          border-radius: 6px;
          font-weight: 600;
          font-size: 0.85rem;
          font-family: monospace;
        }

        .ut-tl-desc {
          color: rgba(255, 255, 255, 0.6);
          font-size: 0.95rem;
        }

        .ut-tl-changes {
          margin-top: 1rem;
        }
        .ut-tl-changes-title {
          font-size: 0.85rem;
          font-weight: 600;
          color: #fff;
          margin-bottom: 0.75rem;
        }

        .ut-tl-commits {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .ut-tl-commit {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
          color: rgba(255, 255, 255, 0.5);
          font-size: 0.85rem;
          line-height: 1.5;
        }

        .ut-tl-commit::before {
          content: '•';
          color: rgba(255, 255, 255, 0.3);
          margin-top: -1px;
        }
        
        .ut-tl-commit-avatar {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.1);
          margin-left: 0.5rem;
          display: inline-block;
          vertical-align: middle;
        }

        .ut-spin { animation: spin 1.2s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        
        .ut-right-panel::-webkit-scrollbar { width: 4px; }
        .ut-right-panel::-webkit-scrollbar-track { background: transparent; }
        .ut-right-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
      `}</style>

      {/* LEFT PANEL */}
      <div className="ut-left-panel">
        <div className="ut-status-card">
          <div className="ut-icon-wrapper">
            <Download size={24} />
          </div>
          
          <h3 className="ut-status-title">
            {status === 'available' ? 'Update available' : 
             status === 'downloading' ? 'Downloading Update' :
             status === 'downloaded' ? 'Update Ready' :
             status === 'checking' ? 'Checking...' :
             status === 'not-available' ? 'Up to date' :
             status === 'error' ? 'Update Error' :
             'MediaDL Updates'}
          </h3>
          
          <p className="ut-status-desc">
            {updateInfo?.releaseNotes?.replace(/<[^>]+>/g, '').substring(0, 80) || 
             (status === 'available' ? 'A new version of MediaDL is ready to be downloaded.' :
              status === 'not-available' ? 'You are running the latest version.' :
              'Keep your app up to date to get the latest features and security improvements.')}
          </p>

          {(status === 'available' || status === 'downloading' || status === 'downloaded') && (
            <div className="ut-version-flow">
              <span className="ut-v-current">v{version}</span>
              <span className="ut-v-arrow">→</span>
              <span className="ut-v-new">v{updateInfo?.version || '...'}</span>
            </div>
          )}

          {status === 'downloading' && (
            <div className="ut-progress-container">
              <div className="ut-progress-bar">
                <div className="ut-progress-fill" style={{ width: `${progress}%` }}></div>
              </div>
              <div className="ut-progress-text">
                <span>{Math.round(progress)}%</span>
                <span>{(speed / 1024 / 1024).toFixed(1)} MB/s</span>
              </div>
            </div>
          )}

          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {status === 'available' && (
              <>
                <button className="ut-btn primary" onClick={downloadUpdate}>Download</button>
                <button className="ut-btn secondary">Later</button>
              </>
            )}
            {status === 'downloaded' && (
              <button className="ut-btn primary" onClick={installUpdate}>Restart to Install</button>
            )}
            {(status === 'idle' || status === 'not-available' || status === 'error') && (
              <button className="ut-btn secondary" onClick={checkForUpdates}>
                {status === 'checking' ? <RefreshCw className="ut-spin" size={16}/> : 'Check for Updates'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT PANEL - TIMELINE */}
      <div className="ut-right-panel">
        <div className="ut-timeline-line"></div>
        
        {loadingHistory ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'rgba(255,255,255,0.5)' }}>
            <RefreshCw className="ut-spin" />
          </div>
        ) : history.length > 0 ? (
          history.map((release, i) => (
            <div key={i} className="ut-timeline-item">
              <div className={`ut-timeline-dot ${i === 0 ? 'latest' : ''}`}></div>
              
              <div className="ut-tl-header">
                <span className="ut-tl-version">{release.version}</span>
                <span className="ut-tl-desc">{release.title}</span>
              </div>

              {release.changes && release.changes.length > 0 && (
                <div className="ut-tl-changes">
                  <div className="ut-tl-changes-title">Changes</div>
                  <div className="ut-tl-commits">
                    {release.changes.map((change, j) => {
                      const msg = typeof change === 'string' ? change : (change.message || '');
                      const author = change.author || 'System';
                      const email = change.email || '';
                      const avatarUrl = email ? `https://unavatar.io/${email}` : `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(msg)}`;
                      
                      return (
                        <div key={j} className="ut-tl-commit">
                          <span>{msg} <span style={{ opacity: 0.6, fontSize: '0.85em', marginLeft: '0.4rem', color: '#818cf8' }}>by {author}</span></span>
                          <div className="ut-tl-commit-avatar" style={{
                             backgroundImage: `url(${avatarUrl})`,
                             backgroundSize: 'cover'
                          }}></div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))
        ) : (
          <div style={{ color: 'rgba(255,255,255,0.5)', paddingLeft: '2rem' }}>No release history found.</div>
        )}
      </div>
    </div>
  );
}
