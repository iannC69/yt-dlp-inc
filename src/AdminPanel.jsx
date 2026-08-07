import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Save, X, RefreshCw } from 'lucide-react';
import { toast } from './ToastSystem';
import './AdminPanel.css';

export default function AdminPanel({ onClose }) {
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/updates/history');
      const data = await res.json();
      setReleases(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error('Failed to fetch release history');
    } finally {
      setLoading(false);
    }
  };

  const saveHistory = async (newReleases) => {
    try {
      const res = await fetch('/api/updates/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newReleases)
      });
      if (res.ok) {
        toast.success('Saved successfully');
      } else {
        toast.error('Failed to save');
      }
    } catch (e) {
      toast.error('Failed to save');
    }
  };

  const addRelease = () => {
    const newRelease = {
      version: 'v1.1.5',
      title: 'New Update',
      date: new Date().toISOString(),
      changes: ['feat: initial release']
    };
    const updated = [newRelease, ...releases];
    setReleases(updated);
    saveHistory(updated);
  };

  const updateRelease = (index, field, value) => {
    const updated = [...releases];
    updated[index][field] = value;
    setReleases(updated);
  };

  const deleteRelease = (index) => {
    if (!window.confirm('Delete this release?')) return;
    const updated = releases.filter((_, i) => i !== index);
    setReleases(updated);
    saveHistory(updated);
  };

  const addChange = (index) => {
    const updated = [...releases];
    updated[index].changes.push('chore: minor update');
    setReleases(updated);
  };

  const updateChange = (releaseIndex, changeIndex, value) => {
    const updated = [...releases];
    updated[releaseIndex].changes[changeIndex] = value;
    setReleases(updated);
  };

  const removeChange = (releaseIndex, changeIndex) => {
    const updated = [...releases];
    updated[releaseIndex].changes = updated[releaseIndex].changes.filter((_, i) => i !== changeIndex);
    setReleases(updated);
  };

  return (
    <div className="admin-overlay">
      <div className="admin-panel">
        <div className="admin-header">
          <h2>Admin Panel - Manage Updates</h2>
          <div className="admin-header-actions">
            <button className="admin-btn primary" onClick={() => saveHistory(releases)}>
              <Save size={16} /> Save All
            </button>
            <button className="admin-btn close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="admin-content">
          <button className="admin-btn full-width add" onClick={addRelease}>
            <Plus size={16} /> Add New Release
          </button>

          {loading ? (
            <div className="admin-loading"><RefreshCw className="spin" size={24}/></div>
          ) : (
            <div className="admin-releases">
              {releases.map((release, i) => (
                <div key={i} className="admin-release-card">
                  <div className="admin-release-header">
                    <input
                      type="text"
                      className="admin-input version"
                      value={release.version}
                      onChange={(e) => updateRelease(i, 'version', e.target.value)}
                      placeholder="Version (e.g. v1.1.4)"
                    />
                    <input
                      type="text"
                      className="admin-input title"
                      value={release.title}
                      onChange={(e) => updateRelease(i, 'title', e.target.value)}
                      placeholder="Title / Summary"
                    />
                    <button className="admin-btn icon-only danger" onClick={() => deleteRelease(i)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                  
                  <div className="admin-changes">
                    <h4>Changelog</h4>
                    {release.changes?.map((change, j) => (
                      <div key={j} className="admin-change-item">
                        <input
                          type="text"
                          className="admin-input change"
                          value={change}
                          onChange={(e) => updateChange(i, j, e.target.value)}
                          placeholder="Change description"
                        />
                        <button className="admin-btn icon-only" onClick={() => removeChange(i, j)}>
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                    <button className="admin-btn text-only" onClick={() => addChange(i)}>
                      + Add Change Line
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
