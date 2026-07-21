import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ListVideo, Play, Music, Loader2, CheckCircle2, XCircle, FolderOpen, RefreshCw, Trash2 } from 'lucide-react';
import './LibraryModal.css';
import './QueueModal.css';

// Shared spring config — iOS-like elastic feel
const spring = { type: 'spring', stiffness: 340, damping: 28 };
const springFast = { type: 'spring', stiffness: 420, damping: 32 };

function JobCard({ job, onCancel }) {
  const isSpotify = job.source === 'spotify';
  const isDone = job.status === 'done';
  const isFailed = job.status === 'failed' || job.status === 'error';
  const isActive = job.status === 'active' || job.status === 'downloading';

  const handleOpenFolder = async () => {
    try {
      await fetch(`/api/ytdl/open-folder?target=${encodeURIComponent(job.filename || '')}`);
    } catch (e) { console.error(e); }
  };

  return (
    <div className={`queue-job-card ${isDone ? 'queue-job--done' : ''} ${isFailed ? 'queue-job--failed' : ''}`}>
      {job.thumbnail ? (
        <img src={job.thumbnail} alt="" className="queue-job-thumb" onError={(e) => { e.target.style.display = 'none'; }} />
      ) : (
        <div className="queue-job-thumb queue-job-thumb--fallback">
          {isSpotify ? <Music size={18} /> : <Play size={18} />}
        </div>
      )}

      <div className="queue-job-info">
        <p className="queue-job-title">{job.title || job.url || 'Unknown'}</p>
        <div className="queue-job-meta">
          <span className={`lib-source-badge ${isSpotify ? 'lib-badge--spotify' : 'lib-badge--youtube'}`} style={{ position: 'static' }}>
            {isSpotify ? <Music size={9} /> : <Play size={9} />}
            {isSpotify ? 'Spotify' : 'YouTube'}
          </span>
          {job.format && <span className="queue-job-fmt">{job.format}</span>}
          <span className={`queue-job-status-label ${isDone ? 'done' : isFailed ? 'failed' : ''}`}>
            {isDone ? 'Done' : isFailed ? 'Failed' : isActive ? 'Downloading' : 'Queued'}
          </span>
        </div>

        {(isActive || job.percent > 0) && !isDone && !isFailed && (
          <div className="queue-job-bar-track">
            <motion.div
              className="queue-job-bar-fill"
              animate={{ width: `${job.percent || 0}%` }}
              transition={{ type: 'spring', stiffness: 60, damping: 18 }}
            />
          </div>
        )}
      </div>

      <div className="queue-job-actions">
        {isDone && (
          <button className="queue-action-btn queue-action-btn--open" onClick={handleOpenFolder} title="Open folder">
            <FolderOpen size={14} />
          </button>
        )}
        {!isDone && !isFailed && (
          <button className="queue-action-btn queue-action-btn--cancel" onClick={() => onCancel(job.id)} title="Cancel">
            <X size={14} />
          </button>
        )}
        {isDone && <CheckCircle2 size={18} className="queue-done-icon" />}
        {isFailed && <XCircle size={18} className="queue-fail-icon" />}
        {isActive && <Loader2 size={16} className="queue-spin-icon" />}
      </div>
    </div>
  );
}

export default function QueueModal({ onClose }) {
  const [jobs, setJobs] = useState({ youtube: [], spotify: [] });
  const [loading, setLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/active-jobs');
      const data = await res.json();
      setJobs({ youtube: data.youtube || [], spotify: data.spotify || [] });
    } catch (e) {
      setJobs({ youtube: [], spotify: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 2000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const handleCancel = async (id) => {
    try {
      await fetch(`/api/ytdl/job-action?jobId=${encodeURIComponent(id)}&action=cancel`);
      fetchJobs();
    } catch (e) { console.error(e); }
  };

  const allJobs = [
    ...jobs.youtube.map(j => ({ ...j, source: 'youtube' })),
    ...jobs.spotify.map(j => ({ ...j, source: 'spotify' })),
  ];

  const activeCount = allJobs.filter(j => j.status === 'active' || j.status === 'downloading').length;
  const completedCount = allJobs.filter(j => j.status === 'done' || j.status === 'failed' || j.status === 'error').length;

  const clearCompleted = () => {
    // Optimistically remove done/failed from local state — server jobs will expire on their own
    setJobs(prev => ({
      youtube: prev.youtube.filter(j => j.status !== 'done' && j.status !== 'failed' && j.status !== 'error'),
      spotify: prev.spotify.filter(j => j.status !== 'done' && j.status !== 'failed' && j.status !== 'error'),
    }));
  };

  return (
    <motion.div
      className="global-library-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        className="lib-modal queue-modal"
        initial={{ opacity: 0, y: 56, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 40, scale: 0.95 }}
        transition={spring}
      >
        {/* Header */}
        <div className="lib-header">
          <div className="lib-header-left">
            <ListVideo size={20} style={{ color: '#3b82f6' }} />
            <h2 className="lib-title">Queue</h2>
            {activeCount > 0 && (
              <motion.span
                className="queue-active-badge"
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={springFast}
              >
                {activeCount} active
              </motion.span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            {completedCount > 0 && (
              <motion.button
                className="queue-clear-btn"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={springFast}
                onClick={clearCompleted}
                title="Clear completed & failed jobs"
              >
                <Trash2 size={13} />
                Clear ({completedCount})
              </motion.button>
            )}
            <button className="lib-close-btn" onClick={fetchJobs} title="Refresh">
              <RefreshCw size={15} />
            </button>
            <button className="lib-close-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="lib-content lib-content--list queue-content">
          {loading ? (
            <div className="lib-empty">
              <Loader2 size={32} className="queue-spin-icon" style={{ color: '#3b82f6' }} />
              <p className="lib-empty-sub">Loading jobs…</p>
            </div>
          ) : allJobs.length === 0 ? (
            <motion.div
              className="lib-empty"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={spring}
            >
              <div className="lib-empty-icon"><ListVideo size={36} strokeWidth={1} /></div>
              <p className="lib-empty-title">No active downloads</p>
              <p className="lib-empty-sub">Start a download from the YouTube or Spotify tab.</p>
            </motion.div>
          ) : (
            <AnimatePresence mode="popLayout">
              {allJobs.map(job => (
                <motion.div
                  key={job.id || job.url}
                  layout
                  initial={{ opacity: 0, x: -20, scale: 0.97 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 24, scale: 0.95, height: 0, marginBottom: 0 }}
                  transition={spring}
                  style={{ overflow: 'hidden' }}
                >
                  <JobCard job={job} onCancel={handleCancel} />
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>

        {/* Footer */}
        <div className="queue-footer">
          <span>Max 3 concurrent downloads</span>
          <span style={{ color: '#3b82f6', fontWeight: 700 }}>{activeCount} / 3 running</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
