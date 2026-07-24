import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CloudDownload, Zap, RefreshCw, X, CheckCircle, Rocket, Clock, Wifi } from 'lucide-react';
import './UpdateOverlay.css';

function parseChangelog(html) {
  if (!html) return ['Performance improvements and bug fixes.'];
  // Convert HTML list items to plain strings
  const items = [];
  const liRegex = /<li[^>]*>(.*?)<\/li>/gi;
  let match;
  while ((match = liRegex.exec(html)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, '').trim();
    if (text) items.push(text);
  }
  if (items.length === 0) {
    // Fallback: strip all tags and split by newlines
    const plain = html.replace(/<[^>]+>/g, '\n').replace(/\n{2,}/g, '\n').trim();
    return plain.split('\n').filter(l => l.trim()).slice(0, 8);
  }
  return items.slice(0, 8);
}

function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB/s`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB/s`;
}

function formatEta(transferred, total, speed) {
  if (!speed || !total) return null;
  const remaining = total - transferred;
  const secs = Math.round(remaining / speed);
  if (secs < 60) return `~${secs}s remaining`;
  return `~${Math.ceil(secs / 60)}m remaining`;
}

export default function UpdateOverlay({
  status,   // 'downloading' | 'downloaded' | 'error'
  progress, // 0-100
  speed,    // bytes/sec
  transferred,
  total,
  info,     // { version, releaseNotes }
  onInstall,
  onDismiss,
  onLater
}) {
  const [countdown, setCountdown] = useState(null);
  const [particles, setParticles] = useState([]);
  const countdownRef = useRef(null);

  // Generate floating particles for atmosphere
  useEffect(() => {
    setParticles(
      Array.from({ length: 20 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 3 + 1,
        duration: Math.random() * 8 + 6,
        delay: Math.random() * 4,
      }))
    );
  }, []);

  const handleInstall = () => {
    // Animate 3-2-1 countdown then trigger install
    setCountdown(3);
    let c = 3;
    countdownRef.current = setInterval(() => {
      c--;
      if (c <= 0) {
        clearInterval(countdownRef.current);
        setCountdown(null);
        onInstall();
      } else {
        setCountdown(c);
      }
    }, 700);
  };

  useEffect(() => () => countdownRef.current && clearInterval(countdownRef.current), []);

  const changelog = parseChangelog(info?.releaseNotes);
  const eta = formatEta(transferred, total, speed);

  return (
    <motion.div
      className="uo-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Particle field */}
      <div className="uo-particles" aria-hidden>
        {particles.map(p => (
          <div
            key={p.id}
            className="uo-particle"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.size,
              height: p.size,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Countdown overlay */}
      <AnimatePresence>
        {countdown !== null && (
          <motion.div
            className="uo-countdown"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.5 }}
            key={countdown}
          >
            <div className="uo-countdown-number">{countdown || '🚀'}</div>
            <div className="uo-countdown-label">Restarting...</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main card */}
      <motion.div
        className="uo-card"
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28, delay: 0.1 }}
      >
        {/* Header */}
        <div className="uo-card-header">
          {/* Animated icon ring */}
          <div className="uo-icon-wrap">
            <div className="uo-icon-ring" />
            <div className="uo-icon-ring uo-icon-ring--2" />
            <div className="uo-icon-core">
              {status === 'downloaded'
                ? <CheckCircle size={28} />
                : <CloudDownload size={28} />
              }
            </div>
          </div>

          <div className="uo-header-text">
            <div className="uo-app-name">MediaDL</div>
            <div className="uo-version-badge">
              <span className="uo-version-old">current</span>
              <span className="uo-version-arrow">→</span>
              <span className="uo-version-new">v{info?.version || 'latest'}</span>
            </div>
          </div>

          {status !== 'downloading' && !countdown && (
            <button className="uo-btn-close" onClick={onDismiss} title="Dismiss">
              <X size={16} />
            </button>
          )}
        </div>

        {/* Progress section */}
        <div className="uo-progress-section">
          <div className="uo-progress-track">
            <motion.div
              className="uo-progress-fill"
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
              transition={{ ease: 'linear', duration: 0.3 }}
            />
            <div className="uo-progress-glow" style={{ left: `${progress}%` }} />
          </div>

          <div className="uo-progress-meta">
            <span className="uo-progress-pct">{Math.round(progress)}%</span>
            <div className="uo-progress-right">
              {status === 'downloading' && speed > 0 && (
                <span className="uo-speed">
                  <Wifi size={11} /> {formatBytes(speed)}
                </span>
              )}
              {eta && status === 'downloading' && (
                <span className="uo-eta">
                  <Clock size={11} /> {eta}
                </span>
              )}
              {status === 'downloaded' && (
                <span className="uo-ready-badge">
                  <CheckCircle size={11} /> Ready to install
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Status label */}
        <div className="uo-status-label">
          {status === 'downloading' && (
            <motion.span
              key="dl"
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ repeat: Infinity, duration: 1.8 }}
            >
              Downloading update...
            </motion.span>
          )}
          {status === 'downloaded' && <span>✓ Update downloaded and verified</span>}
          {status === 'error' && <span style={{ color: '#f87171' }}>⚠ Update failed. Try again later.</span>}
        </div>

        {/* Changelog */}
        <div className="uo-changelog">
          <div className="uo-changelog-label">What's new in v{info?.version}</div>
          <ul className="uo-changelog-list">
            {changelog.map((item, i) => (
              <motion.li
                key={i}
                className="uo-changelog-item"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.06 }}
              >
                <CheckCircle size={13} className="uo-check-icon" />
                {item}
              </motion.li>
            ))}
          </ul>
        </div>

        {/* Footer actions */}
        <div className="uo-footer">
          {status === 'downloading' ? (
            <div className="uo-footer-wait">
              <motion.div
                className="uo-dot-pulse"
                animate={{ scale: [1, 1.3, 1] }}
                transition={{ repeat: Infinity, duration: 1 }}
              />
              Downloading...
            </div>
          ) : status === 'downloaded' ? (
            <>
              <button className="uo-btn-later" onClick={onLater}>
                Later
              </button>
              <button className="uo-btn-install" onClick={handleInstall}>
                <Rocket size={15} />
                Restart &amp; Install
              </button>
            </>
          ) : (
            <button className="uo-btn-later" onClick={onDismiss}>
              Dismiss
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
