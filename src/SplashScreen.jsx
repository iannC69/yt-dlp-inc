import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DownloadCloud } from 'lucide-react';

export default function SplashScreen({ onComplete }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 800);
    const t2 = setTimeout(() => setPhase(2), 1800);
    const t3 = setTimeout(() => setPhase(3), 2600); // Trigger loader exit early
    const t4 = setTimeout(() => onComplete(), 3200);
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
      exit={{ opacity: 0, filter: 'blur(12px)', scale: 1.05 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <style>{`
        .splash-screen {
          position: fixed;
          inset: 0;
          z-index: 999999;
          background-color: #050505;
          background-image: radial-gradient(circle at 50% 40%, rgba(170, 59, 255, 0.15) 0%, transparent 60%);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          font-family: 'Inter', -apple-system, sans-serif;
        }

        .splash-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.5rem;
          position: relative;
          z-index: 10;
        }

        .splash-icon-wrapper {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 72px;
          height: 72px;
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), inset 0 0 0 1px rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(10px);
        }

        .splash-icon-glow {
          position: absolute;
          inset: 0;
          border-radius: 20px;
          box-shadow: 0 0 40px rgba(170, 59, 255, 0.4);
          opacity: 0.5;
        }

        .splash-title-wrapper {
          padding: 10px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
        }

        .splash-title {
          font-size: 2.5rem;
          font-weight: 700;
          letter-spacing: -0.02em;
          margin: 0;
          color: #ffffff;
          text-shadow: 0 4px 20px rgba(255, 255, 255, 0.2);
        }

        .splash-subtitle-container {
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .splash-subtitle {
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.4);
          letter-spacing: 0.1em;
          font-weight: 500;
          text-transform: uppercase;
        }

        .splash-loader-container {
          width: 140px;
          height: 3px;
          background: rgba(255, 255, 255, 0.08);
          border-radius: 4px;
          overflow: hidden;
          position: relative;
          margin-top: 1.5rem;
          box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2);
        }

        .splash-loader-bar {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 40%;
          background: linear-gradient(90deg, transparent, rgba(170, 59, 255, 0.8), #c084fc, rgba(170, 59, 255, 0.8), transparent);
          border-radius: 4px;
          animation: splash-loader-slide 1.5s cubic-bezier(0.65, 0, 0.35, 1) infinite;
          box-shadow: 0 0 10px rgba(170, 59, 255, 0.5);
        }

        @keyframes splash-loader-slide {
          0% { left: -50%; }
          100% { left: 100%; }
        }
      `}</style>

      <div className="splash-content">
        <motion.div
          className="splash-icon-wrapper"
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.div 
            className="splash-icon-glow"
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          />
          <DownloadCloud size={32} color="#ffffff" strokeWidth={1.5} />
        </motion.div>

        <motion.div
          className="splash-title-wrapper"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1 className="splash-title">MediaDL</h1>
          
          <div className="splash-subtitle-container">
            <AnimatePresence mode="wait">
              {phase === 0 && (
                <motion.div key="p0" className="splash-subtitle" initial={{opacity:0, y: 10}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-10}} transition={{duration:0.4, ease: "easeOut"}}>
                  INITIALIZING ENGINE
                </motion.div>
              )}
              {phase === 1 && (
                <motion.div key="p1" className="splash-subtitle" initial={{opacity:0, y: 10}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-10}} transition={{duration:0.4, ease: "easeOut"}}>
                  LOADING MODULES
                </motion.div>
              )}
              {phase >= 2 && (
                <motion.div key="p2" className="splash-subtitle" initial={{opacity:0, y: 10}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-10}} transition={{duration:0.4, ease: "easeOut"}}>
                  SYSTEM READY
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        <motion.div 
          className="splash-loader-container"
          initial={{ opacity: 0, width: 40 }}
          animate={{ opacity: phase >= 3 ? 0 : 1, width: phase >= 3 ? 40 : 140 }}
          transition={{ delay: 0.3, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="splash-loader-bar" />
        </motion.div>
      </div>
    </motion.div>
  );
}
