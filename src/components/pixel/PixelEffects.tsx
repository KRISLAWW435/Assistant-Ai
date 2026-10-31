/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { FloatingParticle, PixelEmotion } from './PixelTypes';

interface PixelEffectsProps {
  emotion: PixelEmotion;
  size: number;
  particles: FloatingParticle[];
  onRemoveParticle: (id: string) => void;
}

export const PixelEffects: React.FC<PixelEffectsProps> = ({
  emotion,
  size,
  particles,
  onRemoveParticle,
}) => {
  // Clean up completed particles automatically after their duration
  useEffect(() => {
    if (particles.length === 0) return;

    const timers = particles.map((p) => {
      return window.setTimeout(() => {
        onRemoveParticle(p.id);
      }, p.durationMs + p.delayMs + 50);
    });

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [particles, onRemoveParticle]);

  // Compute emotion aura glow styles
  let auraGlowColor = 'rgba(99, 102, 241, 0.45)'; // default electric indigo
  let auraBlur = size * 0.35;
  let auraSpread = size * 0.12;

  if (emotion === 'happy' || emotion === 'interacting') {
    auraGlowColor = 'rgba(236, 72, 153, 0.6)'; // bright magenta/pink
    auraBlur = size * 0.55;
    auraSpread = size * 0.22;
  } else if (emotion === 'listening') {
    auraGlowColor = 'rgba(16, 185, 129, 0.65)'; // emerald wake/listening pulse
    auraBlur = size * 0.5;
    auraSpread = size * 0.2;
  } else if (emotion === 'speaking') {
    auraGlowColor = 'rgba(56, 189, 248, 0.7)'; // bright cyan vocal pulse
    auraBlur = size * 0.55;
    auraSpread = size * 0.22;
  } else if (emotion === 'thinking') {
    auraGlowColor = 'rgba(139, 92, 246, 0.55)'; // twilight violet pulse
    auraBlur = size * 0.45;
  } else if (emotion === 'sleeping') {
    auraGlowColor = 'rgba(99, 102, 241, 0.2)'; // very soft dim lavender
    auraBlur = size * 0.25;
    auraSpread = size * 0.05;
  }

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-visible"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* 1. AMBIENT BACKLIGHT AURA (Diffused soft sphere bloom) */}
      <div
        className="absolute inset-0 rounded-full transition-all duration-500 ease-out"
        style={{
          boxShadow: `0 0 ${auraBlur}px ${auraSpread}px ${auraGlowColor}`,
          opacity: emotion === 'sleeping' ? 0.35 : 0.85,
        }}
      />

      {/* 2. SLEEP "z Z z" FLOATING BUBBLE PARTICLES */}
      {emotion === 'sleeping' && (
        <div className="absolute -top-4 -right-3 text-indigo-400 font-display font-extrabold select-none">
          <span className="pixel-sleep-z1 inline-block text-xs opacity-80">z</span>
          <span className="pixel-sleep-z2 inline-block text-[10px] ml-1 opacity-60">z</span>
          <span className="pixel-sleep-z1 inline-block text-[8px] ml-1 opacity-40">z</span>
        </div>
      )}

      {/* 3. BURSTING FLOATING HEARTS & SPARKLES ON PETTING / CLICK */}
      {particles.map((p) => {
        const style: React.CSSProperties = {
          position: 'absolute',
          left: `${50 + p.x}%`,
          top: `${50 + p.y}%`,
          transform: `translate(-50%, -50%) translate(${p.targetX}px, ${p.targetY}px) scale(${p.scale}) rotate(${p.rotation}deg)`,
          transition: `all ${p.durationMs}ms cubic-bezier(0.16, 1, 0.3, 1) ${p.delayMs}ms`,
          color: p.color,
          pointerEvents: 'none',
          willChange: 'transform, opacity',
        };

        return (
          <div
            key={p.id}
            style={style}
            className="pixel-heart-burst"
          >
            {p.type === 'heart' ? (
              <svg
                width={size * 0.28}
                height={size * 0.28}
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="rgba(255, 255, 255, 0.7)"
                strokeWidth="1.2"
                className="drop-shadow-xs"
              >
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            ) : (
              /* Sparkle 4-point star */
              <svg
                width={size * 0.22}
                height={size * 0.22}
                viewBox="0 0 24 24"
                fill="currentColor"
                className="drop-shadow-xs"
              >
                <path d="M12 0L14.5 9.5L24 12L14.5 14.5L12 24L9.5 14.5L0 12L9.5 9.5L12 0Z" />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
};
