import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Download, Music } from 'lucide-react';
import './DynamicIsland.css';

export default function DynamicIsland() {
  const [state, setState] = useState('idle');
  const [downloadData, setDownloadData] = useState(null);
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
            className="di-capsule di-capsule--active"
            layout
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 26 }}
          >
            {downloadData?.thumbnail ? (
              <img src={downloadData.thumbnail} alt="" className="di-thumb" />
            ) : (
              <div className="di-thumb di-thumb--fallback">
                {downloadData?.source === 'spotify' ? <Music size={12} /> : <Download size={12} />}
              </div>
            )}

            <div className="di-info">
              <span className="di-title">{downloadData?.title || 'Downloading...'}</span>
              <div className="di-progress-track">
                <motion.div
                  className="di-progress-fill"
                  animate={{ width: `${downloadData?.progress ?? 0}%` }}
                  transition={{ ease: 'easeOut', duration: 0.4 }}
                />
              </div>
              <span className="di-status">{downloadData?.status}</span>
            </div>

            <div className="di-pct">{Math.round(downloadData?.progress ?? 0)}%</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
