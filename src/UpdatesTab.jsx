import React, { useState, useEffect } from 'react';
import { RefreshCw, Download, Check, AlertTriangle, ArrowDownCircle } from 'lucide-react';

export default function UpdatesTab() {
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState('idle'); // idle, checking, available, not-available, downloading, downloaded, error
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!window.electronAPI?.updater) return;

    window.electronAPI.updater.getAppVersion().then(v => setVersion(v));

    const cleanup = window.electronAPI.updater.onUpdaterEvent((name, data) => {
      console.log('Updater Event:', name, data);
      if (name === 'checking-for-update') setStatus('checking');
      if (name === 'update-available') setStatus('available');
      if (name === 'update-not-available') setStatus('not-available');
      if (name === 'error') {
        setStatus('error');
        setErrorMessage(data || 'Unknown error');
      }
      if (name === 'download-progress') {
        setStatus('downloading');
        setProgress(data.percent || 0);
      }
      if (name === 'update-downloaded') setStatus('downloaded');
    });

    return cleanup;
  }, []);

  const checkForUpdates = () => {
    if (!window.electronAPI?.updater) return alert('Updates are not supported in this environment.');
    setStatus('checking');
    window.electronAPI.updater.checkForUpdates();
  };

  const downloadUpdate = () => {
    if (!window.electronAPI?.updater) return;
    setStatus('downloading');
    window.electronAPI.updater.downloadUpdate();
  };

  const installUpdate = () => {
    if (!window.electronAPI?.updater) return;
    window.electronAPI.updater.installUpdate();
  };

  return (
    <div className="settings-section" style={{ height: '400px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', padding: 0 }}>
      <div style={{ textAlign: 'center' }}>
        <RefreshCw size={48} style={{ color: '#52525b', marginBottom: '10px' }} className={status === 'checking' ? 'spin' : ''} />
        <h2 style={{ margin: 0, color: '#f1f5f9' }}>Software Update</h2>
        <p style={{ color: '#94a3b8', margin: '5px 0' }}>Current version: {version || 'Unknown'}</p>
      </div>

      {status === 'idle' || status === 'not-available' ? (
        <div style={{ textAlign: 'center' }}>
          {status === 'not-available' && <p style={{ color: '#10b981', marginBottom: '15px' }}>You are up to date!</p>}
          <button className="settings-save-btn" onClick={checkForUpdates} style={{ width: 'auto', padding: '0.75rem 1.5rem', cursor: 'pointer' }}>
            Check for Updates
          </button>
        </div>
      ) : null}

      {status === 'checking' && (
        <p style={{ color: '#94a3b8' }}>Checking for updates...</p>
      )}

      {status === 'available' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#3b82f6', marginBottom: '15px' }}>A new update is available!</p>
          <button className="settings-save-btn" onClick={downloadUpdate} style={{ width: 'auto', padding: '0.75rem 1.5rem', cursor: 'pointer' }}>
            <ArrowDownCircle size={16} style={{ display: 'inline', marginRight: '6px' }} /> Download Update
          </button>
        </div>
      )}

      {status === 'downloading' && (
        <div style={{ width: '80%', textAlign: 'center' }}>
          <p style={{ color: '#94a3b8', marginBottom: '10px' }}>Downloading update... {Math.round(progress)}%</p>
          <div style={{ width: '100%', height: '8px', background: '#1e293b', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: '#3b82f6', transition: 'width 0.2s' }} />
          </div>
        </div>
      )}

      {status === 'downloaded' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#10b981', marginBottom: '15px' }}>Update downloaded and ready to install.</p>
          <button className="settings-save-btn" onClick={installUpdate} style={{ width: 'auto', padding: '0.75rem 1.5rem', background: '#10b981', color: '#fff', cursor: 'pointer' }}>
            <Check size={16} style={{ display: 'inline', marginRight: '6px' }} /> Restart & Install
          </button>
        </div>
      )}

      {status === 'error' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#ef4444', marginBottom: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <AlertTriangle size={18} /> Update failed
          </p>
          <p style={{ color: '#fca5a5', fontSize: '0.85rem', maxWidth: '300px', wordBreak: 'break-word', marginBottom: '15px' }}>{errorMessage}</p>
          <button className="settings-save-btn" onClick={checkForUpdates} style={{ width: 'auto', padding: '0.75rem 1.5rem', cursor: 'pointer' }}>
            Try Again
          </button>
        </div>
      )}
      
      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
        .spin { animation: spin 2s linear infinite; }
      `}</style>
    </div>
  );
}
