import React from 'react';
import { motion } from 'framer-motion';
import { CloudDownload, Zap, RefreshCw, X, FileText } from 'lucide-react';
import './UpdateOverlay.css';

export default function UpdateOverlay({ 
  status, // 'downloading', 'downloaded', 'error'
  progress, // 0-100
  speed, // bytes/sec
  info, // { version: string, releaseNotes: string }
  onInstall,
  onDismiss 
}) {
  const mbps = speed ? (speed / 1024 / 1024).toFixed(2) : 0;
  
  // Clean release notes HTML from electron-updater
  const createMarkup = (html) => {
    return { __html: html || '<p>Performance improvements and bug fixes.</p>' };
  };

  return (
    <motion.div 
      className="update-overlay"
      initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
      animate={{ opacity: 1, backdropFilter: "blur(16px)" }}
      exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
    >
      <div className="update-overlay-content">
        <div className="uo-header">
          <div className="uo-icon">
            <CloudDownload size={28} />
          </div>
          <div>
            <div className="uo-title">
              {status === 'downloading' ? 'Downloading Update' : 'Update Ready'}
            </div>
            <div className="uo-subtitle">Version {info?.version || 'Latest'}</div>
          </div>
          {status !== 'downloading' && (
            <button className="uo-close" onClick={onDismiss}><X size={20} /></button>
          )}
        </div>

        <div className="uo-progress-container">
          <div className="uo-progress-bar">
            <motion.div 
              className="uo-progress-fill" 
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ ease: "linear", duration: 0.2 }}
            />
          </div>
          <div className="uo-progress-stats">
            <span>{Math.round(progress)}% completed</span>
            {status === 'downloading' && <span><Zap size={12} style={{marginRight: 4, display: 'inline'}} /> {mbps} MB/s</span>}
          </div>
        </div>

        <div className="uo-notes">
          <div className="uo-notes-title"><FileText size={14} /> Release Notes</div>
          <div className="uo-notes-body" dangerouslySetInnerHTML={createMarkup(info?.releaseNotes)} />
        </div>

        <div className="uo-footer">
          {status === 'downloading' ? (
            <div className="uo-wait">Please wait while the update downloads...</div>
          ) : (
            <button className="uo-btn-install" onClick={onInstall}>
              <RefreshCw size={16} /> Restart & Install
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
