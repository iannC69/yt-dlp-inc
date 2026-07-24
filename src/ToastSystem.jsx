import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, AlertCircle, Info, X, AlertTriangle, Download } from 'lucide-react';

// ── Global toast event bus ─────────────────────────────────────────────────
const listeners = new Set();

export function toast(message, type = 'info', duration = 4000) {
  const id = Date.now() + Math.random();
  const event = { id, message, type, duration };
  listeners.forEach(fn => fn(event));
  return id;
}

// Convenience shortcuts
toast.success = (msg, dur) => toast(msg, 'success', dur);
toast.error   = (msg, dur) => toast(msg, 'error',   dur ?? 6000);
toast.warn    = (msg, dur) => toast(msg, 'warn',    dur);
toast.info    = (msg, dur) => toast(msg, 'info',    dur);
toast.download = (msg, dur) => toast(msg, 'download', dur ?? 5000);

// ── Toast icons & config ───────────────────────────────────────────────────
const TOAST_CONFIG = {
  success:  { icon: CheckCircle,  color: '#34d399', bg: 'rgba(52,211,153,0.1)',  border: 'rgba(52,211,153,0.25)' },
  error:    { icon: AlertCircle,  color: '#f87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.25)' },
  warn:     { icon: AlertTriangle,color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.25)' },
  info:     { icon: Info,         color: '#818cf8', bg: 'rgba(99,102,241,0.1)',  border: 'rgba(99,102,241,0.25)' },
  download: { icon: Download,     color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.25)' },
};

// ── Individual Toast ───────────────────────────────────────────────────────
function ToastItem({ id, message, type, duration, onRemove }) {
  const cfg = TOAST_CONFIG[type] || TOAST_CONFIG.info;
  const Icon = cfg.icon;
  const progressRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => onRemove(id), duration);
    return () => clearTimeout(timer);
  }, [id, duration, onRemove]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 60, scale: 0.92 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 12,
        padding: '0.75rem 1rem',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.65rem',
        maxWidth: 340,
        minWidth: 240,
        position: 'relative',
        overflow: 'hidden',
        backdropFilter: 'blur(16px)',
        boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)`,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {/* Progress bar */}
      <motion.div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: 2,
          background: cfg.color,
          borderRadius: '0 0 0 12px',
          opacity: 0.5,
        }}
        initial={{ width: '100%' }}
        animate={{ width: '0%' }}
        transition={{ duration: duration / 1000, ease: 'linear' }}
      />

      {/* Icon */}
      <Icon size={17} style={{ color: cfg.color, flexShrink: 0, marginTop: 1 }} />

      {/* Message */}
      <span style={{
        fontSize: '0.875rem',
        color: 'rgba(255,255,255,0.85)',
        fontWeight: 500,
        lineHeight: 1.45,
        flex: 1,
      }}>
        {message}
      </span>

      {/* Close */}
      <button
        onClick={() => onRemove(id)}
        style={{
          background: 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.3)',
          cursor: 'pointer',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          marginTop: 1,
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => e.target.style.color = 'rgba(255,255,255,0.7)'}
        onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.3)'}
      >
        <X size={13} />
      </button>
    </motion.div>
  );
}

// ── Toast Container ────────────────────────────────────────────────────────
export default function ToastSystem() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((event) => {
    setToasts(prev => {
      // Max 5 toasts at once
      const next = [...prev, event];
      return next.slice(-5);
    });
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    listeners.add(addToast);
    return () => listeners.delete(addToast);
  }, [addToast]);

  return (
    <div style={{
      position: 'fixed',
      bottom: '1.5rem',
      right: '1.5rem',
      zIndex: 999999,
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
      alignItems: 'flex-end',
      pointerEvents: 'none',
    }}>
      <AnimatePresence mode="sync">
        {toasts.map(t => (
          <div key={t.id} style={{ pointerEvents: 'auto' }}>
            <ToastItem {...t} onRemove={removeToast} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
