import React, { useEffect, useState } from 'react';
import { Terminal, Trash2, StopCircle, PlayCircle } from 'lucide-react';

export default function LogsTab() {
  const [logs, setLogs] = useState([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isStreaming, setIsStreaming] = useState(true);

  useEffect(() => {
    let eventSource;
    
    if (isStreaming) {
      eventSource = new EventSource('/api/logs/stream');
      
      eventSource.onmessage = (e) => {
        try {
          const newLog = JSON.parse(e.data);
          setLogs(prev => {
            const updated = [...prev, newLog];
            return updated.slice(-1000); // Keep last 1000 logs max
          });
        } catch (err) {}
      };
      
      eventSource.onerror = () => {
        eventSource.close();
        setTimeout(() => {
          if (isStreaming) {
            setIsStreaming(false);
            setTimeout(() => setIsStreaming(true), 2000);
          }
        }, 2000);
      };
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [isStreaming]);

  useEffect(() => {
    // Initial fetch of logs buffer
    fetch('/api/logs/buffer')
      .then(r => r.json())
      .then(data => {
        if (data.logs) {
          setLogs(data.logs);
        }
      })
      .catch(() => {});
  }, []);

  const logsEndRef = React.useRef(null);
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const clearLogs = () => {
    fetch('/api/logs', { method: 'DELETE' }).then(() => setLogs([]));
  };

  const getLevelColor = (level) => {
    switch (level) {
      case 'ERROR': return '#ef4444';
      case 'WARN': return '#f59e0b';
      case 'SUCCESS': return '#10b981';
      case 'INFO': default: return '#3b82f6';
    }
  };

  return (
    <div className="logs-tab-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '10px' }}>
      <div className="logs-toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <Terminal size={18} />
          <strong style={{ fontSize: '1.1rem' }}>Live Server Logs</strong>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.9rem', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={autoScroll} 
              onChange={e => setAutoScroll(e.target.checked)} 
            />
            Auto-scroll
          </label>
          <button 
            className="settings-save-btn" 
            style={{ width: 'auto', padding: '0.4rem 0.8rem', background: '#374151' }}
            onClick={() => setIsStreaming(!isStreaming)}
          >
            {isStreaming ? <StopCircle size={14} /> : <PlayCircle size={14} />}
            {isStreaming ? ' Pause' : ' Resume'}
          </button>
          <button 
            className="settings-save-btn" 
            style={{ width: 'auto', padding: '0.4rem 0.8rem', background: '#991b1b' }}
            onClick={clearLogs}
          >
            <Trash2 size={14} /> Clear
          </button>
        </div>
      </div>
      
      <div 
        className="logs-viewer" 
        style={{ 
          flex: 1, 
          background: '#0a0a0a', 
          borderRadius: '8px', 
          padding: '10px', 
          overflowY: 'auto',
          fontFamily: 'monospace',
          fontSize: '0.85rem',
          lineHeight: '1.4',
          border: '1px solid #333'
        }}
      >
        {logs.length === 0 ? (
          <div style={{ color: '#666', textAlign: 'center', marginTop: '20px' }}>No logs yet...</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} style={{ marginBottom: '4px', borderBottom: '1px solid #1a1a1a', paddingBottom: '4px' }}>
              <span style={{ color: '#666', marginRight: '8px' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
              <span style={{ color: getLevelColor(log.level), fontWeight: 'bold', width: '60px', display: 'inline-block' }}>{log.level}</span>
              <span style={{ color: '#a855f7', marginRight: '8px' }}>[{log.module}]</span>
              <span style={{ color: '#e5e5e5' }}>{log.message}</span>
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
