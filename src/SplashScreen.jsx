import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function SplashScreen({ onComplete }) {
  const [phase, setPhase] = useState(0);
  const [loadingText, setLoadingText] = useState('Initializing Engine...');
  
  useEffect(() => {
    // Highly detailed loading sequence
    const texts = [
      'Waking up MediaDL...',
      'Connecting to Spotify API...',
      'Initializing YouTube Engine...',
      'Allocating Audio Buffers...',
      'Loading UI Components...',
      'Optimizing Workspace...',
      'Almost Ready...'
    ];
    let i = 0;
    const interval = setInterval(() => {
      setLoadingText(texts[i]);
      i = (i + 1) % texts.length;
    }, 450);

    // Timing logic
    const t1 = setTimeout(() => setPhase(1), 300);
    const t2 = setTimeout(() => setPhase(2), 2600);
    const t3 = setTimeout(() => setPhase(3), 3200); // Exit animation starts
    const t4 = setTimeout(() => onComplete(), 3800);
    
    return () => {
      clearInterval(interval);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [onComplete]);

  return (
    <motion.div
      className="splash-screen-pro"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, filter: 'blur(30px)', scale: 1.1 }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@900&display=swap');

        .splash-screen-pro {
          position: fixed;
          inset: 0;
          z-index: 999999;
          background-color: #010308;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          user-select: none;
        }

        /* ── ORGANIC INFINITE WAVES ── */
        .wave-container {
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          height: 60vh;
          overflow: hidden;
          z-index: 0;
          pointer-events: none;
          opacity: 0.8;
        }

        .wave {
          position: absolute;
          width: 250vw;
          height: 250vw;
          left: -75vw;
          top: 40vh;
          border-radius: 43%;
          animation: wave-spin infinite linear;
          mix-blend-mode: screen;
        }

        .wave-1 {
          background: rgba(124, 58, 237, 0.15); /* Deep Purple */
          animation-duration: 20s;
          top: 35vh;
          box-shadow: inset 0 0 100px rgba(124, 58, 237, 0.3);
        }
        
        .wave-2 {
          background: rgba(34, 245, 199, 0.12); /* Vibrant Teal */
          animation-duration: 25s;
          animation-direction: reverse;
          top: 38vh;
          box-shadow: inset 0 0 100px rgba(34, 245, 199, 0.2);
        }
        
        .wave-3 {
          background: rgba(217, 70, 239, 0.15); /* Pink */
          animation-duration: 30s;
          top: 42vh;
          box-shadow: inset 0 0 150px rgba(217, 70, 239, 0.3);
        }

        @keyframes wave-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        /* Ambient Glow */
        .ambient-glow {
          position: absolute;
          width: 600px;
          height: 600px;
          background: radial-gradient(circle, rgba(124,58,237,0.2) 0%, transparent 60%);
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          filter: blur(80px);
          z-index: 1;
        }

        /* ── CENTER CONTENT ── */
        .content-layer {
          position: relative;
          z-index: 10;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        /* Huge Premium Title */
        .splash-huge-title {
          font-family: 'Montserrat', 'Arial Black', sans-serif;
          font-size: 9.5rem;
          font-weight: 900;
          letter-spacing: -0.06em;
          margin: 0;
          line-height: 1;
          color: #ffffff;
          background: linear-gradient(
            110deg,
            #e2e8f0 10%,
            #ffffff 30%,
            #64748b 50%,
            #ffffff 70%,
            #e2e8f0 90%
          );
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: title-shimmer 6s linear infinite;
        }
        
        @keyframes title-shimmer {
          to { background-position: -200% center; }
        }

        .splash-detailed-subtitle {
          font-size: 1.2rem;
          font-weight: 400;
          letter-spacing: 0.4em;
          color: rgba(255, 255, 255, 0.6);
          margin-top: 8px;
          margin-bottom: 60px;
          text-transform: uppercase;
        }

        /* Pro Max Loader */
        .pro-loader-container {
          width: 440px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .pro-loader-track {
          width: 100%;
          height: 4px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
          overflow: hidden;
          position: relative;
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.5);
        }

        .pro-loader-fill {
          height: 100%;
          border-radius: 4px;
          background: linear-gradient(90deg, transparent, #22f5c7, #7c3aed, #ff00a0);
          background-size: 200% 100%;
          box-shadow: 0 0 20px rgba(124, 58, 237, 0.8), 0 0 10px rgba(34, 245, 199, 0.6);
          position: relative;
        }

        /* Glowing head of the loading bar */
        .pro-loader-fill::after {
          content: '';
          position: absolute;
          right: 0;
          top: -2px;
          height: 8px;
          width: 20px;
          background: #ffffff;
          border-radius: 10px;
          box-shadow: 0 0 15px #ffffff;
          filter: blur(1px);
        }

        .pro-status-text {
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.5);
          text-align: center;
          font-weight: 500;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          height: 16px;
        }

        /* Vertical Details */
        .vertical-text {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          font-size: 0.65rem;
          font-weight: 700;
          letter-spacing: 0.3em;
          color: rgba(255, 255, 255, 0.1);
          line-height: 2.5;
          z-index: 5;
        }
        .vertical-text.left { left: 48px; }
        .vertical-text.right { right: 48px; text-align: right; }
        /* ── PREMIUM TECHNICAL DETAILS ── */
        .tech-grid {
          position: absolute;
          inset: 0;
          background-image: 
            linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
          background-size: 40px 40px;
          opacity: 0.3;
          z-index: 1;
          pointer-events: none;
          mask-image: radial-gradient(circle at center, black 20%, transparent 80%);
          -webkit-mask-image: radial-gradient(circle at center, black 20%, transparent 80%);
        }

        .scanlines {
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0, 0, 0, 0.2) 2px,
            rgba(0, 0, 0, 0.2) 4px
          );
          z-index: 100;
          pointer-events: none;
          opacity: 0.4;
        }

        .reticle {
          position: absolute;
          width: 20px;
          height: 20px;
          border: 1px solid rgba(255,255,255,0.15);
          z-index: 5;
        }
        .reticle::before {
          content: ''; position: absolute; background: rgba(255,255,255,0.5);
        }
        .reticle.tl { top: 40px; left: 40px; border-right: none; border-bottom: none; }
        .reticle.tr { top: 40px; right: 40px; border-left: none; border-bottom: none; }
        .reticle.bl { bottom: 40px; left: 40px; border-right: none; border-top: none; }
        .reticle.br { bottom: 40px; right: 40px; border-left: none; border-top: none; }

        .system-badge {
          display: inline-block;
          font-size: 0.65rem;
          color: #22f5c7;
          border: 1px solid rgba(34, 245, 199, 0.3);
          background: rgba(34, 245, 199, 0.05);
          padding: 4px 10px;
          border-radius: 4px;
          letter-spacing: 0.1em;
          margin-bottom: 24px;
          box-shadow: 0 0 10px rgba(34, 245, 199, 0.1);
        }
      `}</style>

      {/* Background Elements */}
      <div className="ambient-glow" />
      <div className="tech-grid" />
      <div className="scanlines" />
      
      {/* HUD Reticles */}
      <div className="reticle tl" />
      <div className="reticle tr" />
      <div className="reticle bl" />
      <div className="reticle br" />

      <div className="wave-container">
        <div className="wave wave-1"></div>
        <div className="wave wave-2"></div>
        <div className="wave wave-3"></div>
      </div>

      <div className="vertical-text left">
        SYSTEM<br/>BOOT<br/>SEQUENCE
      </div>
      <div className="vertical-text right">
        MEDIA.DL<br/>V1.0.75<br/>ONLINE
      </div>

      <div className="content-layer">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5, duration: 0.8 }}
          className="system-badge"
        >
          SYS.CORE // INITIATING
        </motion.div>

        <motion.h1 
          className="splash-huge-title"
          initial={{ y: 30, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        >
          MediaDL
        </motion.h1>

        <motion.div 
          className="splash-detailed-subtitle"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 1, delay: 0.3, ease: "easeOut" }}
        >
          Premium Media Engine
        </motion.div>

        <AnimatePresence>
          {phase < 3 && (
            <motion.div 
              className="pro-loader-container"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 15, scale: 0.95 }}
              transition={{ delay: 0.6, duration: 0.8, ease: "easeOut" }}
            >
              <div className="pro-loader-track">
                <motion.div 
                  className="pro-loader-fill"
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ delay: 0.8, duration: 2.4, ease: [0.4, 0, 0.2, 1] }}
                />
              </div>
              
              <motion.div 
                className="pro-status-text"
                key={loadingText}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                {loadingText}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
