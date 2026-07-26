import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DownloadCloud } from 'lucide-react';

export default function SplashScreen({ onComplete }) {
  const [phase, setPhase] = useState(0);
  
  useEffect(() => {
    // Elegant, smooth timing
    const t1 = setTimeout(() => setPhase(1), 800);
    const t2 = setTimeout(() => setPhase(2), 2200);
    const t3 = setTimeout(() => setPhase(3), 2800); // Trigger exit early
    const t4 = setTimeout(() => onComplete(), 3400);
    
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [onComplete]);

  return (
    <motion.div
      className="splash-screen"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, filter: 'blur(16px)', scale: 1.02 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <style>{`
        .splash-screen {
          position: fixed;
          inset: 0;
          z-index: 999999;
          background-color: #0A0A0A;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'SF Pro Display', sans-serif;
          user-select: none;
        }

        /* Premium Aurora Ambient Glow combining all brand colors */
        .splash-aurora {
          position: absolute;
          inset: -50%;
          z-index: 1;
          filter: blur(120px) saturate(150%);
          opacity: 0.2;
          pointer-events: none;
          background: conic-gradient(from 0deg at 50% 50%, 
            rgba(255, 0, 0, 0.8),     /* YouTube Red */
            rgba(255, 85, 0, 0.8),    /* SoundCloud Orange */
            rgba(29, 185, 84, 0.8),   /* Spotify Green */
            rgba(0, 199, 242, 0.8),   /* Deezer Cyan */
            rgba(250, 36, 60, 0.8),   /* Apple Music Pink/Red */
            rgba(255, 0, 0, 0.8)      /* Loop */
          );
          animation: aurora-spin 25s linear infinite;
        }

        @keyframes aurora-spin {
          0% { transform: rotate(0deg) scale(1.2); }
          50% { transform: rotate(180deg) scale(1.6); }
          100% { transform: rotate(360deg) scale(1.2); }
        }

        .splash-content {
          position: relative;
          z-index: 10;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
        }

        .splash-logo-container {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 64px;
          height: 64px;
          border-radius: 16px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.02) 100%);
          border: 1px solid rgba(255, 255, 255, 0.05);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        }

        /* Soft breathing shadow */
        .splash-logo-shadow {
          position: absolute;
          inset: 0;
          border-radius: 16px;
          box-shadow: 0 0 20px rgba(255, 255, 255, 0.08);
          animation: breath-shadow 4s ease-in-out infinite alternate;
        }

        @keyframes breath-shadow {
          0% { opacity: 0.3; transform: scale(0.95); }
          100% { opacity: 0.8; transform: scale(1.05); }
        }

        .splash-title {
          font-size: 1.25rem;
          font-weight: 500;
          letter-spacing: 0.15em;
          color: rgba(255, 255, 255, 0.9);
          margin: 0;
          margin-right: -0.15em; /* Compensate for tracking */
          text-transform: uppercase;
        }

        /* Ultra-thin indeterminate loader */
        .splash-loader-wrapper {
          position: absolute;
          bottom: -40px;
          left: 50%;
          transform: translateX(-50%);
          width: 140px;
          height: 1px;
          background: rgba(255, 255, 255, 0.05);
          overflow: hidden;
          border-radius: 1px;
        }

        .splash-loader-indicator {
          position: absolute;
          top: 0;
          left: 0;
          height: 100%;
          background: rgba(255, 255, 255, 0.8);
          box-shadow: 0 0 10px rgba(255, 255, 255, 0.4);
        }

        .splash-version {
          position: absolute;
          bottom: 24px;
          right: 24px;
          font-size: 0.7rem;
          font-weight: 400;
          color: rgba(255, 255, 255, 0.2);
          letter-spacing: 0.05em;
        }
      `}</style>

      <div className="splash-aurora" />

      <motion.div 
        className="splash-content"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.div 
          className="splash-logo-container"
          animate={{ scale: [1, 1.02, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        >
          <div className="splash-logo-shadow" />
          <DownloadCloud size={28} color="rgba(255, 255, 255, 0.9)" strokeWidth={1.5} style={{ zIndex: 2 }} />
        </motion.div>

        <motion.h1 
          className="splash-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 1 }}
        >
          MediaDL
        </motion.h1>

        <AnimatePresence>
          {phase < 3 && (
            <motion.div 
              className="splash-loader-wrapper"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 140 }}
              exit={{ opacity: 0, scaleX: 0 }}
              transition={{ delay: 0.8, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            >
              <motion.div 
                className="splash-loader-indicator" 
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ delay: 1, duration: 2, ease: "easeInOut" }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <motion.div 
        className="splash-version"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 1 }}
      >
        v1.0.65
      </motion.div>

    </motion.div>
  );
}
