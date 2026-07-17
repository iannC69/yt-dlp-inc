import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, ListVideo } from 'lucide-react';
import './LibraryModal.css';

export default function QueueModal({ onClose }) {
  return (
    <motion.div 
      className="settings-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ zIndex: 9999 }}
    >
      <motion.div 
        className="settings-modal-content"
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 50, opacity: 0 }}
      >
        <button className="settings-modal-close" onClick={onClose}>
          <X size={20} />
        </button>
        
        <div className="settings-header">
          <ListVideo size={24} color="#3b82f6" />
          <h2>Queue Manager</h2>
        </div>
        
        <div className="library-list" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
           <h3 style={{ color: '#fff', marginBottom: '1rem' }}>Sistemul de Coadă rulează în fundal</h3>
           <p style={{ color: '#9ca3af', textAlign: 'center', maxWidth: '400px' }}>
              Limita este setată la <strong>2 descărcări simultane</strong>. Orice link adăugat în plus va fi pus pe modul "În așteptare" și va porni automat.
           </p>
        </div>
      </motion.div>
    </motion.div>
  );
}
