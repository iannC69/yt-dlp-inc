import { motion } from 'framer-motion';
import { Film, FolderOpen, Play, Music } from 'lucide-react';
import './LibraryModal.css';

export default function LibraryModal({ historyData, onClose }) {
  const handleOpenFolder = async (filename) => {
    try {
      await fetch('/api/ytdl/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="global-library-overlay"
    >
      <div className="global-library-header">
        <h2>Librărie Descărcări</h2>
        <button className="global-modal-cancel" onClick={onClose}>Închide</button>
      </div>
      <div className="global-library-grid">
        {historyData.length === 0 ? (
          <div style={{ color: '#94a3b8', textAlign: 'center', marginTop: '2rem' }}>
            Nicio descărcare recentă.
          </div>
        ) : (
          historyData.map((item) => {
            const isSpotify = item.source === 'spotify';
            
            return (
              <div key={item.id} className="global-library-card">
                <div className="global-lib-thumb-wrapper">
                  {item.thumbnail && item.thumbnail !== 'undefined' && item.thumbnail !== 'null' ? (
                    <img
                      src={item.thumbnail}
                      alt="thumbnail"
                      className="global-lib-thumb"
                      onError={(e) => {
                        if (!e.target.dataset.triedLocal) {
                          e.target.dataset.triedLocal = 'true';
                          e.target.src = `/api/ytdl/local-thumbnail?file=${encodeURIComponent(item.filename)}`;
                        } else {
                          e.target.style.display = 'none';
                          e.target.nextElementSibling.style.display = 'flex';
                        }
                      }}
                    />
                  ) : (
                    <img
                      src={`/api/ytdl/local-thumbnail?file=${encodeURIComponent(item.filename)}`}
                      alt="thumbnail"
                      className="global-lib-thumb"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextElementSibling.style.display = 'flex';
                      }}
                    />
                  )}
                  <div className="global-lib-thumb-fallback" style={{ display: 'none' }}>
                    <Film size={32} color="rgba(255,255,255,0.2)" />
                  </div>
                  
                  {/* Source Badge */}
                  <div className={`global-lib-badge ${isSpotify ? 'badge-spotify' : 'badge-youtube'}`}>
                    {isSpotify ? <Music size={12} /> : <Play size={12} />}
                    <span>{isSpotify ? 'Spotify' : 'YouTube'}</span>
                  </div>
                </div>

                <div className="global-lib-info">
                  <h4 className="global-lib-title" title={item.title}>{item.title}</h4>
                  <div className="global-lib-meta">
                    <span>{item.format}</span>
                    <span>{new Date(item.date).toLocaleDateString()}</span>
                  </div>
                  <button className="global-lib-open-btn" onClick={() => handleOpenFolder(item.filename)}>
                    <FolderOpen size={16} /> Folder
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </motion.div>
  );
}
