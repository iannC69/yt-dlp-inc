import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Download, Music, X, Activity } from 'lucide-react';
import './DynamicIsland.css';

export default function DynamicIsland() {
  const [state, setState] = useState('idle');
  const [downloadData, setDownloadData] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const doneTimerRef = useRef(null);

  useEffect(() => {
    const handleUpdate = (e) => {
      const { source, progress, status, thumbnail, title, done, error } = e.detail;
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);

      if (error) {
        setState('error');
        setDownloadData(prev => ({ ...prev, status: 'Download failed' }));
        doneTimerRef.current = setTimeout(() => { setState('idle'); setDownloadData(null); }, 3000);
        return;
      }

      if (done) {
        setState('done');
        doneTimerRef.current = setTimeout(() => { setState('idle'); setDownloadData(null); }, 4000);
        return;
      }

      setState('active');
      setDownloadData({ source, progress: progress ?? 0, status: status || 'Downloading...', thumbnail, title });
    };

    window.addEventListener('download_update', handleUpdate);
    return () => {
      window.removeEventListener('download_update', handleUpdate);
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    };
  }, []);

  const isActive = state === 'active';
  const isDone = state === 'done';
  const isError = state === 'error';
  const isIdle = state === 'idle';

  return (
    <div className="dynamic-island-container">
      <AnimatePresence mode="wait">
        {isIdle ? (
          <motion.div
            key="idle"
            className="di-capsule di-capsule--idle"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <span className="di-dot" />
            <span className="di-dot" />
            <span className="di-dot" />
          </motion.div>
        ) : isDone ? (
          <motion.div
            key="done"
            className="di-capsule di-capsule--done"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <CheckCircle2 size={14} className="di-done-icon" />
            <span className="di-done-text">Downloaded!</span>
          </motion.div>
        ) : isError ? (
          <motion.div
            key="error"
            className="di-capsule di-capsule--error"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <span className="di-error-text">Failed</span>
          </motion.div>
        ) : (
          <motion.div
            key="active"
            className={`di-capsule di-capsule--active ${isExpanded ? 'di-expanded' : ''}`}
            layout
            initial={{ scale: 0.8, opacity: 0, borderRadius: 32 }}
            animate={{ scale: 1, opacity: 1, borderRadius: isExpanded ? 24 : 32 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 26 }}
            onMouseEnter={() => setIsExpanded(true)}
            onMouseLeave={() => setIsExpanded(false)}
          >
            {isExpanded ? (
              <div className="di-expanded-layout">
                <div className="di-expanded-header">
                  <div className="di-expanded-thumb">
                    {downloadData?.thumbnail ? (
                      <img src={downloadData.thumbnail} alt="" />
                    ) : (
                      <div className="di-thumb-fallback">
                        {downloadData?.source === 'spotify' ? <Music size={24} /> : <Download size={24} />}
                      </div>
                    )}
                  </div>
                  <div className="di-expanded-info">
                    <span className="di-expanded-title">{downloadData?.title || 'Downloading...'}</span>
                    <span className="di-expanded-status">{downloadData?.status}</span>
                  </div>
                </div>
                
                <div className="di-expanded-waveform-container">
                  <div className="di-progress-track">
                    <motion.div
                      className="di-progress-fill"
                      animate={{ width: `${downloadData?.progress ?? 0}%` }}
                      transition={{ ease: 'easeOut', duration: 0.4 }}
                    />
                  </div>
                  <span className="di-expanded-pct">{Math.round(downloadData?.progress ?? 0)}%</span>
                </div>
                
                <div className="di-expanded-actions">
                  <button 
                    className="di-action-btn di-cancel-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.dispatchEvent(new CustomEvent('app:global-cancel'));
                      setState('idle');
                    }}
                  >
                    <X size={14} /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="di-collapsed-layout">
                <Activity size={14} className="di-waveform-icon-collapsed" style={{ animation: 'pulse-wave 1.5s infinite ease-in-out', color: '#10b981' }} />
                <div className="di-pct">{Math.round(downloadData?.progress ?? 0)}%</div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
