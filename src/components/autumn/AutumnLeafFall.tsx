import React, { useEffect, useRef, useState } from 'react';
import { AUTUMN_LEAF_BURST_EVENT } from '../../utils/autumnTheme';

interface LeafParticle {
  id: number;
  leftPercent: number;
  emoji: '🍁' | '🍂';
  sizePx: number;
  opacity: number;
  driftX: number;
  rotEnd: number;
  delaySec: number;
  durationSec: number;
}

interface AutumnLeafFallProps {
  enabled: boolean;
}

export const AutumnLeafFall: React.FC<AutumnLeafFallProps> = ({ enabled }) => {
  const [leaves, setLeaves] = useState<LeafParticle[]>([]);
  const timeoutRef = useRef<number | null>(null);

  const spawnBurst = () => {
    // Generate ~20 varied autumn leaves
    const newLeaves: LeafParticle[] = Array.from({ length: 22 }, (_, idx) => {
      const isMaple = Math.random() > 0.45;
      const leftPercent = 3 + Math.random() * 94;
      const sizePx = 14 + Math.floor(Math.random() * 12); // 14px to 26px
      const opacity = 0.5 + Math.random() * 0.35; // 0.5 to 0.85
      const driftX = (Math.random() - 0.5) * 140; // -70px to +70px drift
      const rotEnd = (Math.random() > 0.5 ? 1 : -1) * (200 + Math.random() * 520);
      const delaySec = Math.random() * 3.2; // Staggered entry across first 3.2 seconds
      const durationSec = 6.0 + Math.random() * 2.8; // 6s to 8.8s fall duration

      return {
        id: Date.now() + idx,
        leftPercent,
        emoji: isMaple ? '🍁' : '🍂',
        sizePx,
        opacity,
        driftX,
        rotEnd,
        delaySec,
        durationSec,
      };
    });

    setLeaves(newLeaves);

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    // Leaves burst lasts for 10 seconds, then clears DOM cleanly
    timeoutRef.current = window.setTimeout(() => {
      setLeaves([]);
    }, 10000);
  };

  useEffect(() => {
    if (!enabled) {
      setLeaves([]);
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
      return;
    }

    // 1. Initial gentle burst after a small delay on first enablement
    const initialTimer = window.setTimeout(() => {
      spawnBurst();
    }, 1200);

    // 2. Interval every 5 minutes (300,000 ms)
    const intervalTimer = window.setInterval(() => {
      spawnBurst();
    }, 300000);

    // 3. Listener for manual test / trigger event
    const handleManualBurst = () => {
      spawnBurst();
    };
    window.addEventListener(AUTUMN_LEAF_BURST_EVENT, handleManualBurst);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalTimer);
      window.removeEventListener(AUTUMN_LEAF_BURST_EVENT, handleManualBurst);
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [enabled]);

  if (!enabled || leaves.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 pointer-events-none z-50 overflow-hidden select-none"
      aria-hidden="true"
    >
      {leaves.map((leaf) => (
        <span
          key={leaf.id}
          className="absolute top-0 autumn-leaf-anim inline-block select-none"
          style={
            {
              left: `${leaf.leftPercent}%`,
              fontSize: `${leaf.sizePx}px`,
              opacity: leaf.opacity,
              animationDuration: `${leaf.durationSec}s`,
              animationDelay: `${leaf.delaySec}s`,
              '--drift-x': `${leaf.driftX}px`,
              '--rot-end': `${leaf.rotEnd}deg`,
            } as React.CSSProperties
          }
        >
          {leaf.emoji}
        </span>
      ))}
    </div>
  );
};
