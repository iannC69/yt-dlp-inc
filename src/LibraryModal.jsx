import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Film, FolderOpen, Play, Music, LayoutGrid, List, X, ChevronDown, Scissors, Trash2, Search, MonitorPlay, Headphones, HardDrive } from 'lucide-react';
import './LibraryModal.css';

const FILTERS = ['All', 'YouTube', 'Spotify', 'Cutter', 'Audio', 'Video'];
const SORTS = ['Date', 'Name', 'Source'];

// Shared spring config — iOS-like elastic feel
const spring = { type: 'spring', stiffness: 340, damping: 28 };
const springFast = { type: 'spring', stiffness: 420, damping: 32 };

export default function LibraryModal({ historyData, onClose, onSendToCutter }) {
  const [filter, setFilter] = useState('All');
  const [sortBy, setSortBy] = useState('Date');
  const [viewMode, setViewMode] = useState('grid');
  const [searchQuery, setSearchQuery] = useState('');

  const handleOpenFolder = async (filename) => {
    try {
      const response = await fetch(`/api/ytdl/open-folder?target=${encodeURIComponent(filename || '')}`);
      if (!response.ok) throw new Error('The downloaded item could not be found.');
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  };

  const lifetimeStats = useMemo(() => {
    const videos = historyData.filter(i => String(i.format).match(/mp4|webm|mkv|video/i)).length;
    const audio = historyData.filter(i => String(i.format).match(/mp3|ogg|wav|flac|m4a|audio/i)).length;
    return { videos, audio, total: historyData.length };
  }, [historyData]);

  const filtered = useMemo(() => {
    let items = [...historyData];
    if (filter === 'YouTube') items = items.filter(i => i.source === 'youtube');
    else if (filter === 'Spotify') items = items.filter(i => i.source === 'spotify');
    else if (filter === 'Cutter') items = items.filter(i => i.source === 'cutter');
    else if (filter === 'Audio') items = items.filter(i => i.format && /mp3|ogg|wav|flac|m4a/i.test(i.format));
    else if (filter === 'Video') items = items.filter(i => i.format && /mp4|webm|mkv/i.test(i.format));

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      items = items.filter(i => (i.title || '').toLowerCase().includes(q) || (i.format || '').toLowerCase().includes(q));
    }

    if (sortBy === 'Name') items.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    else if (sortBy === 'Source') items.sort((a, b) => (a.source || '').localeCompare(b.source || ''));
    else items.sort((a, b) => (b.date || 0) - (a.date || 0));

    return items;
  }, [historyData, filter, sortBy, searchQuery]);

  const clearHistory = () => {
    localStorage.removeItem('global_history');
    window.dispatchEvent(new Event('history_updated'));
    onClose();
  };

  const deleteSingleItem = (itemToDelete, e) => {
    e?.stopPropagation();
    try {
      const history = JSON.parse(localStorage.getItem('global_history') || '[]');
      const updated = history.filter(i => {
        if (itemToDelete.id && i.id) return i.id !== itemToDelete.id;
        return !(i.filename === itemToDelete.filename && i.date === itemToDelete.date);
      });
      localStorage.setItem('global_history', JSON.stringify(updated));
      window.dispatchEvent(new Event('history_updated'));
    } catch (err) {
      console.error('Failed to delete item from history:', err);
    }
  };

  const sourceDetails = (item) => item.source === 'spotify'
    ? { label: 'Spotify', icon: <Music size={10} />, className: 'lib-badge--spotify' }
    : item.source === 'cutter'
      ? { label: 'Cutter', icon: <Scissors size={10} />, className: 'lib-badge--cutter' }
      : { label: 'YouTube', icon: <Play size={10} />, className: 'lib-badge--youtube' };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      className="global-library-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 32, scale: 0.96 }}
        transition={spring}
        className="lib-modal"
      >
        {/* Header */}
        <div className="lib-header">
          <div className="lib-header-left">
            <h2 className="lib-title">Library</h2>
            <span className="lib-count">{filtered.length} items</span>
          </div>
          <div className="lib-header-actions">
            {historyData.length > 0 && <button className="lib-close-btn" onClick={clearHistory} title="Clear history"><Trash2 size={15} /></button>}
            <button className="lib-close-btn" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="lib-search-wrap">
          <div className="lib-search-inner">
            <span className="lib-search-icon"><Search size={15} /></span>
            <input
              className="lib-search-input"
              type="text"
              placeholder="Search downloads…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            <AnimatePresence>
              {searchQuery && (
                <motion.button
                  className="lib-search-clear"
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.7 }}
                  transition={springFast}
                  onClick={() => setSearchQuery('')}
                >
                  <X size={12} />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Stats Widget */}
        {historyData.length > 0 && (
          <div className="ytdl-stats-widget" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', margin: '0 1.5rem 1.5rem 1.5rem', background: 'linear-gradient(145deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.6) 100%)', padding: '1.25rem', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.02)', transition: 'background 0.2s ease' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}>
              <div style={{ padding: '0.8rem', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '12px', color: '#60a5fa', flexShrink: 0 }}><MonitorPlay size={24} strokeWidth={2.5} /></div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f8fafc', lineHeight: 1 }}>{lifetimeStats.videos || 0}</span>
                <span style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '0.2rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Videos Saved</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.02)', transition: 'background 0.2s ease' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}>
              <div style={{ padding: '0.8rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '12px', color: '#34d399', flexShrink: 0 }}><Headphones size={24} strokeWidth={2.5} /></div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f8fafc', lineHeight: 1 }}>{lifetimeStats.audio || 0}</span>
                <span style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '0.2rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Audio Tracks</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.02)', transition: 'background 0.2s ease' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}>
              <div style={{ padding: '0.8rem', background: 'rgba(168, 85, 247, 0.1)', borderRadius: '12px', color: '#c084fc', flexShrink: 0 }}><HardDrive size={24} strokeWidth={2.5} /></div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f8fafc', lineHeight: 1 }}>{lifetimeStats.total || 0}</span>
                <span style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '0.2rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Downloads</span>
              </div>
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div className="lib-toolbar">
          <div className="lib-filters">
            {FILTERS.map(f => (
              <button
                key={f}
                className={`lib-filter-btn ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >{f}</button>
            ))}
          </div>
          <div className="lib-toolbar-right">
            <div className="lib-sort">
              <ChevronDown size={13} />
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="lib-sort-select">
                {SORTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="lib-view-toggle">
              <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')}><LayoutGrid size={15} /></button>
              <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}><List size={15} /></button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className={`lib-content ${viewMode === 'list' ? 'lib-content--list' : 'lib-content--grid'}`}>
          <AnimatePresence mode="popLayout">
            {filtered.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={spring}
                className="lib-empty"
              >
                <div className="lib-empty-icon">
                  <Film size={48} strokeWidth={1} />
                </div>
                <p className="lib-empty-title">{searchQuery ? 'No results found' : 'No downloads yet'}</p>
                <p className="lib-empty-sub">{searchQuery ? `No items match "${searchQuery}"` : 'Your completed downloads will appear here.'}</p>
              </motion.div>
            ) : (
              filtered.map((item) => {
                const source = sourceDetails(item);
                return viewMode === 'grid' ? (
                  <motion.div
                    key={item.id || `${item.filename}_${item.date}`}
                    initial={{ opacity: 0, scale: 0.88, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.88, y: -8 }}
                    transition={spring}
                    className="lib-card"
                  >
                    <div className="lib-card-thumb">
                      <img
                        src={item.thumbnail && item.thumbnail !== 'undefined' ? item.thumbnail : `/api/ytdl/local-thumbnail?file=${encodeURIComponent(item.filename)}`}
                        alt=""
                        className="lib-thumb-img"
                        onError={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling.style.display = 'flex'; }}
                      />
                      <div className="lib-thumb-fallback"><Film size={28} /></div>
                      <div className="lib-card-shade" />
                      <span className={`lib-source-badge ${source.className}`}>
                        {source.icon}
                        {source.label}
                      </span>
                      <div className="lib-card-actions">
                        {item.format && /mp3|ogg|wav|flac|m4a|mp4|webm|mkv/i.test(item.format) && (
                          <button 
                            className="lib-action-btn" 
                            onClick={(e) => { e.stopPropagation(); onSendToCutter && onSendToCutter(item); }} 
                            title="Send to Cutter"
                          >
                            <Scissors size={14} />
                          </button>
                        )}
                        <button className="lib-action-btn lib-action-btn--sm" onClick={() => handleOpenFolder(item.filename)} title="Open folder">
                          <FolderOpen size={14} />
                        </button>
                        <button className="lib-action-btn lib-action-btn--delete" onClick={(e) => deleteSingleItem(item, e)} title="Remove item">
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="lib-card-body">
                      <p className="lib-card-title" title={item.title}>{item.title}</p>
                      <div className="lib-card-meta">
                        <span>{item.format}</span>
                        <span>{new Date(item.date).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key={item.id || `${item.filename}_${item.date}`}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 16, scale: 0.96 }}
                    transition={spring}
                    className="lib-list-row"
                  >
                    <img
                      src={item.thumbnail && item.thumbnail !== 'undefined' ? item.thumbnail : `/api/ytdl/local-thumbnail?file=${encodeURIComponent(item.filename)}`}
                      alt=""
                      className="lib-list-thumb"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                    <div className="lib-list-info">
                      <p className="lib-list-title">{item.title}</p>
                      <div className="lib-list-meta">
                        <span className={`lib-source-badge ${source.className}`}>
                          {source.icon}
                          {source.label}
                        </span>
                        <span>{item.format}</span>
                        <span>{new Date(item.date).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="lib-list-actions">
                      {item.format && /mp3|ogg|wav|flac|m4a|mp4|webm|mkv/i.test(item.format) && (
                        <button 
                          className="lib-open-btn lib-open-btn--sm" 
                          onClick={(e) => { e.stopPropagation(); onSendToCutter && onSendToCutter(item); }} 
                          title="Send to Cutter"
                        >
                          <Scissors size={13} />
                        </button>
                      )}
                      <button className="lib-open-btn lib-open-btn--sm" onClick={() => handleOpenFolder(item.filename)} title="Open folder">
                        <FolderOpen size={13} />
                      </button>
                      <button className="lib-open-btn lib-open-btn--danger" onClick={(e) => deleteSingleItem(item, e)} title="Remove item">
                        <X size={13} />
                      </button>
                    </div>
                  </motion.div>
                );
              })
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
