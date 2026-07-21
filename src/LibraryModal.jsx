import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Film, FolderOpen, Play, Music, LayoutGrid, List, X, ChevronDown, Scissors, Trash2, Search } from 'lucide-react';
import './LibraryModal.css';

const FILTERS = ['All', 'YouTube', 'Spotify', 'Cutter', 'Audio', 'Video'];
const SORTS = ['Date', 'Name', 'Source'];

// Shared spring config — iOS-like elastic feel
const spring = { type: 'spring', stiffness: 340, damping: 28 };
const springFast = { type: 'spring', stiffness: 420, damping: 32 };

export default function LibraryModal({ historyData, onClose }) {
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
                    key={item.id}
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
                      <div className="lib-card-body">
                        <p className="lib-card-title" title={item.title}>{item.title}</p>
                        <div className="lib-card-meta">
                          <span>{item.format}</span>
                          <span>{new Date(item.date).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <button className="lib-open-btn" onClick={() => handleOpenFolder(item.filename)} title="Open folder">
                        <FolderOpen size={14} />
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key={item.id}
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
                    <button className="lib-open-btn lib-open-btn--sm" onClick={() => handleOpenFolder(item.filename)}>
                      <FolderOpen size={13} />
                    </button>
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
