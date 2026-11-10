import React, { useEffect, useRef, useState } from 'react';
import { AUTUMN_LEAF_BURST_EVENT } from '../../utils/autumnTheme';

interface LeafParticle {
  id: number;
  leftPercent: number;
  emoji: '🍁' | '🍂';
  sizePx: number;
  opacity: number;
  driftX: number;
  sway1: number;
  sway2: number;
  sway3: number;
  sway4: number;
  sway5: number;
  durationSec: number;
  delaySec: number;
}

interface AutumnLeafFallProps {
  enabled: boolean;
}

export const AutumnLeafFall: React.FC<AutumnLeafFallProps> = ({ enabled }) => {
  const [leaves, setLeaves] = useState<LeafParticle[]>([]);
  const cycleIntervalRef = useRef<number | null>(null);
  const spawnTimerRef = useRef<number | null>(null);
  const activeWindowTimerRef = useRef<number | null>(null);
  const initialDelayTimerRef = useRef<number | null>(null);
  const spawnedCountRef = useRef<number>(0);
  const targetBatchCountRef = useRef<number>(5);

  const clearAllTimers = () => {
    if (cycleIntervalRef.current) window.clearInterval(cycleIntervalRef.current);
    if (spawnTimerRef.current) window.clearTimeout(spawnTimerRef.current);
    if (activeWindowTimerRef.current) window.clearTimeout(activeWindowTimerRef.current);
    if (initialDelayTimerRef.current) window.clearTimeout(initialDelayTimerRef.current);
  };

  const spawnOneOrTwoLeaves = () => {
    if (spawnedCountRef.current >= targetBatchCountRef.current) {
      return;
    }

    const remaining = targetBatchCountRef.current - spawnedCountRef.current;
    // Spawn 1 or 2 leaves (respecting batch maximum 4-6)
    const countToSpawn = Math.min(remaining, Math.random() > 0.5 ? 2 : 1);
    const newItems: LeafParticle[] = [];

    for (let i = 0; i < countToSpawn; i++) {
      const isMaple = Math.random() > 0.45;
      const leftPercent = 4 + Math.random() * 92;
      const sizePx = 18 + Math.floor(Math.random() * 8); // 18px to 26px
      // Gentle opacity 0.4 to 0.58 so leaves stay cozy and unobtrusive
      const opacity = 0.4 + Math.random() * 0.18;
      const driftX = (Math.random() - 0.4) * 85;
      const sway1 = 20 + Math.random() * 20;
      const sway2 = -20 - Math.random() * 18;
      const sway3 = 24 + Math.random() * 22;
      const sway4 = -22 - Math.random() * 18;
      const sway5 = 18 + Math.random() * 18;
      // Staggered durations & random start delays so leaves fall asynchronously
      const durationSec = 12.0 + Math.random() * 4.0;
      const delaySec = Math.random() * 1.2;
      const leafId = Date.now() + Math.random();

      newItems.push({
        id: leafId,
        leftPercent,
        emoji: isMaple ? '🍁' : '🍂',
        sizePx,
        opacity,
        driftX,
        sway1,
        sway2,
        sway3,
        sway4,
        sway5,
        durationSec,
        delaySec,
      });

      // Automatically clean up leaf particle from DOM after it finishes falling
      window.setTimeout(() => {
        setLeaves((prev) => prev.filter((item) => item.id !== leafId));
      }, (durationSec + delaySec + 1) * 1000);
    }

    spawnedCountRef.current += countToSpawn;
    setLeaves((prev) => [...prev, ...newItems]);

    // Schedule next spawn in 3 to 4 seconds if batch limit not yet reached
    if (spawnedCountRef.current < targetBatchCountRef.current) {
      const nextDelayMs = 3000 + Math.random() * 1000;
      spawnTimerRef.current = window.setTimeout(() => {
        spawnOneOrTwoLeaves();
      }, nextDelayMs);
    }
  };

  /**
   * Starts a 1-minute batch cycle (4-6 leaves total, appearing 1-2 at a time every 3-4s).
   */
  const startBatchCycle = () => {
    if (spawnTimerRef.current) window.clearTimeout(spawnTimerRef.current);
    if (activeWindowTimerRef.current) window.clearTimeout(activeWindowTimerRef.current);

    // Target 4 to 6 leaves for this batch
    targetBatchCountRef.current = 4 + Math.floor(Math.random() * 3); // 4, 5, or 6
    spawnedCountRef.current = 0;

    // First spawn immediately at start of minute window
    spawnOneOrTwoLeaves();

    // 1-minute active window timeout: stops further spawns until next 5-minute cycle
    activeWindowTimerRef.current = window.setTimeout(() => {
      if (spawnTimerRef.current) {
        window.clearTimeout(spawnTimerRef.current);
      }
    }, 60000);
  };

  useEffect(() => {
    if (!enabled) {
      setLeaves([]);
      clearAllTimers();
      return;
    }

    // 1. Initial gentle batch after polite 2.5s delay
    initialDelayTimerRef.current = window.setTimeout(() => {
      startBatchCycle();
    }, 2500);

    // 2. Main cycle: every 5 minutes (300,000 ms)
    cycleIntervalRef.current = window.setInterval(() => {
      startBatchCycle();
    }, 300000);

    // 3. Listener for manual test / trigger event
    const handleManualBurst = () => {
      startBatchCycle();
    };
    window.addEventListener(AUTUMN_LEAF_BURST_EVENT, handleManualBurst);

    return () => {
      clearAllTimers();
      window.removeEventListener(AUTUMN_LEAF_BURST_EVENT, handleManualBurst);
    };
  }, [enabled]);

  if (!enabled || leaves.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 pointer-events-none z-30 overflow-hidden select-none"
      aria-hidden="true"
    >
      {/* Falling Leaves (Pure ambient decor) */}
      {leaves.map((leaf) => (
        <span
          key={leaf.id}
          className="absolute -top-[5%] autumn-leaf-anim inline-block select-none pointer-events-none"
          style={
            {
              left: `${leaf.leftPercent}%`,
              fontSize: `${leaf.sizePx}px`,
              opacity: leaf.opacity,
              animationDuration: `${leaf.durationSec}s`,
              animationDelay: `${leaf.delaySec}s`,
              '--leaf-opacity': leaf.opacity,
              '--drift-x': `${leaf.driftX}px`,
              '--sway-1': `${leaf.sway1}px`,
              '--sway-2': `${leaf.sway2}px`,
              '--sway-3': `${leaf.sway3}px`,
              '--sway-4': `${leaf.sway4}px`,
              '--sway-5': `${leaf.sway5}px`,
            } as React.CSSProperties
          }
        >
          {leaf.emoji}
        </span>
      ))}
    </div>
  );
};
