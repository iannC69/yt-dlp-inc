import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ListVideo, Play, Music, Loader2, CheckCircle2, XCircle, FolderOpen, RefreshCw } from 'lucide-react';
import './LibraryModal.css';
import './QueueModal.css';

function JobCard({ job, onCancel }) {
  const isSpotify = job.source === 'spotify';
  const isDone = job.status === 'done';
  const isFailed = job.status === 'failed' || job.status === 'error';
  const isActive = job.status === 'active' || job.status === 'downloading';

  const handleOpenFolder = async () => {
    try {
      await fetch('/api/ytdl/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: job.filename || job.title })
      });
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
            <div className="queue-job-bar-fill" style={{ width: `${job.percent || 0}%` }} />
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
      await fetch(`/api/ytdl/cancel?downloadId=${id}`, { method: 'POST' });
      fetchJobs();
    } catch (e) { console.error(e); }
  };

  const allJobs = [
    ...jobs.youtube.map(j => ({ ...j, source: 'youtube' })),
    ...jobs.spotify.map(j => ({ ...j, source: 'spotify' })),
  ];

  const activeCount = allJobs.filter(j => j.status === 'active' || j.status === 'downloading').length;

  return (
    <motion.div
      className="global-library-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        className="lib-modal queue-modal"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
      >
        {/* Header */}
        <div className="lib-header">
          <div className="lib-header-left">
            <ListVideo size={20} style={{ color: '#3b82f6' }} />
            <h2 className="lib-title">Queue</h2>
            {activeCount > 0 && (
              <span className="queue-active-badge">{activeCount} active</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
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
            <div className="lib-empty">
              <div className="lib-empty-icon"><ListVideo size={36} strokeWidth={1} /></div>
              <p className="lib-empty-title">No active downloads</p>
              <p className="lib-empty-sub">Start a download from the YouTube or Spotify tab.</p>
            </div>
          ) : (
            <AnimatePresence>
              {allJobs.map(job => (
                <motion.div key={job.id || job.url}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                >
                  <JobCard job={job} onCancel={handleCancel} />
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>

        {/* Footer info */}
        <div className="queue-footer">
          <span>Max 3 concurrent downloads</span>
          <span style={{ color: '#3b82f6', fontWeight: 700 }}>{activeCount} / 3 running</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
