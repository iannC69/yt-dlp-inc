import { motion } from 'framer-motion';
import './WaveformBg.css';

const BAR_COUNT = 24;

export default function WaveformBg({ color = 'rgba(239, 68, 68, 0.15)', isActive = false }) {
  if (!isActive) return null;

  return (
    <div className="waveform-bg">
      <div className="waveform-bars">
        {Array.from({ length: BAR_COUNT }, (_, i) => {
          const baseHeight = 12 + Math.random() * 20;
          const amplitude = 18 + Math.random() * 30;
          const duration = 0.6 + Math.random() * 0.8;
          const delay = (i / BAR_COUNT) * 0.8;
          return (
            <motion.div
              key={i}
              className="waveform-bar"
              style={{ background: color }}
              animate={{
                height: [`${baseHeight}px`, `${baseHeight + amplitude}px`, `${baseHeight}px`],
                opacity: [0.4, 0.8, 0.4],
              }}
              transition={{
                duration,
                delay,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
