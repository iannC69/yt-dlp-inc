import React, { useMemo } from 'react';
import './AuroraBackground.css';

const AuroraBackground = ({ activeColor = 'rgba(239, 68, 68, 0.12)' }) => {
  const colors = useMemo(() => {
    // If it's the YouTube red
    if (activeColor === '#ef4444' || activeColor === 'rgba(239, 68, 68, 0.12)') {
      return {
        color1: 'rgba(239, 68, 68, 0.3)',
        color2: 'rgba(249, 115, 22, 0.25)',
        color3: 'rgba(225, 29, 72, 0.2)',
      };
    }
    // If it's Spotify green
    if (activeColor === '#1DB954' || activeColor === 'rgba(29, 185, 84, 0.12)') {
      return {
        color1: 'rgba(29, 185, 84, 0.25)',
        color2: 'rgba(16, 185, 129, 0.2)',
        color3: 'rgba(20, 184, 166, 0.15)',
      };
    }
    // If it's Mass DL purple
    if (activeColor === '#a855f7' || activeColor === 'rgba(168, 85, 247, 0.12)') {
      return {
        color1: 'rgba(168, 85, 247, 0.3)',
        color2: 'rgba(139, 92, 246, 0.25)',
        color3: 'rgba(217, 70, 239, 0.2)',
      };
    }
    // Fallback based on whatever color is passed (assumes rgb/rgba format)
    if (activeColor.startsWith('rgba')) {
      return {
        color1: activeColor.replace(/0\.\d+\)/, '0.25)'),
        color2: activeColor.replace(/0\.\d+\)/, '0.2)'),
        color3: activeColor.replace(/0\.\d+\)/, '0.15)'),
      };
    }
    return {
      color1: 'rgba(255, 255, 255, 0.1)',
      color2: 'rgba(255, 255, 255, 0.05)',
      color3: 'rgba(255, 255, 255, 0.02)',
    };
  }, [activeColor]);

  return (
    <div className="aurora-container" style={{
      '--aurora-color-1': colors.color1,
      '--aurora-color-2': colors.color2,
      '--aurora-color-3': colors.color3,
    }}>
      <div className="aurora-blur">
        <div className="aurora-orb aurora-orb-1" />
        <div className="aurora-orb aurora-orb-2" />
        <div className="aurora-orb aurora-orb-3" />
      </div>
      <div className="aurora-overlay" />
    </div>
  );
};

export default AuroraBackground;
