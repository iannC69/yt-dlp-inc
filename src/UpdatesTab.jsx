import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, CheckCircle, User } from 'lucide-react';

export default function UpdatesTab() {
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState('idle'); // idle, checking, up-to-date
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    if (window.electronAPI?.updater) {
      window.electronAPI.updater.getAppVersion().then(v => setVersion(v));
      window.electronAPI.updater.getReleaseHistory().then(data => {
        setHistory(data || []);
        setLoadingHistory(false);
      }).catch(err => {
        console.error('Failed to fetch history', err);
        setLoadingHistory(false);
      });
    } else {
      setLoadingHistory(false);
    }
  }, []);

  const handleCheckForUpdates = async () => {
    if (!window.electronAPI?.updater || status === 'checking') return;
    setStatus('checking');
    try {
      const hasUpdate = await window.electronAPI.updater.manualCheckUpdate();
      if (!hasUpdate) {
        setStatus('up-to-date');
        setTimeout(() => setStatus('idle'), 3000);
      } else {
        setStatus('idle');
      }
    } catch (e) {
      console.error(e);
      setStatus('idle');
    }
  };

  return (
    <div style={{ padding: '32px', maxWidth: '1000px', margin: '0 auto', color: '#e8e6f0' }}>
      <style>{`
        .updates-btn {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 8px;
          padding: 8px 18px;
          font-size: 13px;
          color: rgba(255, 255, 255, 0.85);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: all 0.15s ease;
        }
        .updates-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.22);
        }
        .updates-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .changelog-section {
          margin-top: 32px;
        }

        .version-block {
          position: relative;
          margin-bottom: 28px;
        }

        .version-block:not(:last-child)::after {
          content: '';
          position: absolute;
          left: 4px;
          top: 18px;
          bottom: -18px;
          width: 1px;
          background: linear-gradient(
            to bottom,
            rgba(124, 92, 252, 0.25) 0%,
            rgba(124, 92, 252, 0.05) 100%
          );
        }

        .dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
          position: relative;
          z-index: 1;
        }

        .dot.active {
          background: #7c5cfc;
          box-shadow: 0 0 8px rgba(124, 92, 252, 0.7);
          border: none;
        }

        .dot.inactive {
          background: transparent;
          border: 1.5px solid rgba(255, 255, 255, 0.22);
        }

        .commit-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-left: 22px;
        }

        .commit-item {
          font-size: 13px;
          color: rgba(255, 255, 255, 0.7);
          display: flex;
          align-items: center;
          gap: 6px;
          line-height: 1.5;
        }

        .commit-item::before {
          content: '•';
          color: rgba(255, 255, 255, 0.25);
          margin-right: 4px;
        }

        .commit-sha {
          background: rgba(124, 92, 252, 0.12);
          border: 1px solid rgba(124, 92, 252, 0.2);
          border-radius: 4px;
          padding: 1px 6px;
          font-family: monospace;
          font-size: 11px;
          color: rgba(160, 130, 255, 0.9);
        }

        .commit-avatar {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          border: 1px solid rgba(124, 92, 252, 0.25);
          box-shadow: 0 0 0 2px rgba(124, 92, 252, 0.08);
          object-fit: cover;
          vertical-align: middle;
          flex-shrink: 0;
        }
        
        .commit-avatar-fallback {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: rgba(124, 92, 252, 0.15);
          border: 1px solid rgba(124, 92, 252, 0.2);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          color: rgba(160, 130, 255, 0.9);
        }
      `}</style>

      {/* Header Container */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        background: 'linear-gradient(135deg, rgba(88, 28, 220, 0.08) 0%, rgba(120, 40, 200, 0.04) 100%)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: '10px',
        padding: '18px 20px'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div style={{ color: 'rgba(255,255,255,0.7)' }}>
              <RefreshCw size={24} />
            </div>
            <div>
              <h2 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: '600' }}>MediaDL Updates</h2>
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.42)' }}>Keep your app up to date</div>
            </div>
          </div>
          
          <div style={{ fontFamily: 'monospace', color: 'rgba(255, 255, 255, 0.4)', fontSize: '12px', marginLeft: '40px' }}>
            Current version: <span style={{ color: 'rgba(160, 130, 255, 0.9)' }}>v{version || '...'}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <AnimatePresence>
            {status === 'up-to-date' && (
              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                style={{ fontSize: '13px', color: '#34d399', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                You're up to date <CheckCircle size={14} />
              </motion.div>
            )}
          </AnimatePresence>
          
          <button 
            className="updates-btn"
            onClick={handleCheckForUpdates}
            disabled={status === 'checking'}
          >
            {status === 'checking' ? (
              <>
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }} style={{ display: 'flex' }}>
                  <RefreshCw size={14} />
                </motion.div>
                Checking...
              </>
            ) : (
              'Check for Updates'
            )}
          </button>
        </div>
      </div>

      {/* Changelog */}
      <div className="changelog-section">
        <h3 style={{ 
          fontSize: '11px', 
          fontWeight: '600', 
          textTransform: 'uppercase', 
          letterSpacing: '0.08em', 
          color: 'rgba(255, 255, 255, 0.3)', 
          marginBottom: '20px',
          marginTop: '0'
        }}>Changelog</h3>
        
        {loadingHistory ? (
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.42)' }}>Loading history...</div>
        ) : history.length === 0 ? (
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.42)' }}>No history found.</div>
        ) : (
          history.map((release, i) => (
            <div key={i} className="version-block">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                <div className={`dot ${release.isLatest ? 'active' : 'inactive'}`} />
                <span style={{ 
                  background: release.isLatest ? 'rgba(88, 28, 220, 0.18)' : 'rgba(255, 255, 255, 0.04)',
                  border: `1px solid ${release.isLatest ? 'rgba(140, 80, 255, 0.35)' : 'rgba(255, 255, 255, 0.1)'}`,
                  borderRadius: '999px',
                  padding: '3px 12px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  color: release.isLatest ? 'rgba(190, 160, 255, 1)' : 'rgba(255, 255, 255, 0.5)'
                }}>
                  v{release.version}
                </span>
                {release.description && (
                  <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.48)' }}>
                    {release.description}
                  </span>
                )}
              </div>
              
              {release.commits && release.commits.length > 0 && (
                <div style={{ marginLeft: '22px', marginTop: '12px' }}>
                  <div style={{ 
                    fontSize: '11px', 
                    fontWeight: '600', 
                    textTransform: 'uppercase', 
                    letterSpacing: '0.06em', 
                    color: 'rgba(255, 255, 255, 0.25)', 
                    margin: '8px 0 10px 0' 
                  }}>
                    Changes
                  </div>
                  <ul className="commit-list">
                    {release.commits.map((commit, j) => (
                      <li key={j} className="commit-item">
                        {commit.message}
                        <span className="commit-sha">({commit.shortSha})</span>
                        <span style={{ color: 'rgba(255,255,255,0.18)' }}>—</span>
                        {commit.avatarUrl ? (
                          <img 
                            src={commit.avatarUrl} 
                            alt={commit.authorName} 
                            className="commit-avatar"
                            onError={(e) => {
                              e.target.style.display = 'none';
                              e.target.nextElementSibling.style.display = 'flex';
                            }}
                          />
                        ) : null}
                        <div 
                          className="commit-avatar-fallback" 
                          style={{ display: commit.avatarUrl ? 'none' : 'flex' }}
                          title={commit.authorName}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="8" r="5" />
                            <path d="M20 21a8 8 0 0 0-16 0" />
                          </svg>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
