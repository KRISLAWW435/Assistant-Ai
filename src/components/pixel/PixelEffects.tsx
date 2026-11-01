/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
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

  // Glow intensities tuned per emotion: gentle, translucent, never harsh
  const isSleeping = emotion === 'sleeping';
  const isListening = emotion === 'listening';
  const isJoy = emotion === 'joy' || emotion === 'happy' || emotion === 'interacting';
  const isThoughtful = emotion === 'thoughtful' || emotion === 'thinking';

  const glowOpacity = isSleeping ? 0.35 : isListening ? 0.85 : isJoy ? 0.8 : 0.65;

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-visible select-none bg-transparent"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* 1. DELICATE LUMINOUS PASTEL AURA (Pure SVG radial glow without dark box-shadows or white backing) */}
      <svg
        viewBox="0 0 160 160"
        className="absolute -inset-[30%] w-[160%] h-[160%] overflow-visible pointer-events-none transition-opacity duration-700 ease-out"
        style={{ opacity: glowOpacity }}
      >
        <defs>
          <radialGradient id="pixelAmbientGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.45" />
            <stop offset="28%" stopColor="#FDF2F8" stopOpacity="0.35" />
            <stop offset="55%" stopColor="#BAE6FD" stopOpacity="0.28" />
            <stop offset="78%" stopColor="#DDD6FE" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#DDD6FE" stopOpacity="0" />
          </radialGradient>

          {isListening && (
            <radialGradient id="pixelListeningGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.6" />
              <stop offset="35%" stopColor="#7DD3FC" stopOpacity="0.4" />
              <stop offset="70%" stopColor="#BAE6FD" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#7DD3FC" stopOpacity="0" />
            </radialGradient>
          )}

          {isThoughtful && (
            <radialGradient id="pixelThoughtfulGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
              <stop offset="35%" stopColor="#DDD6FE" stopOpacity="0.38" />
              <stop offset="70%" stopColor="#BAE6FD" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#DDD6FE" stopOpacity="0" />
            </radialGradient>
          )}
        </defs>

        <circle
          cx="80"
          cy="80"
          r="76"
          fill={
            isListening
              ? 'url(#pixelListeningGlow)'
              : isThoughtful
                ? 'url(#pixelThoughtfulGlow)'
                : 'url(#pixelAmbientGlow)'
          }
        />
      </svg>

      {/* 2. SLEEP "z Z z" FLOATING BUBBLE PARTICLES */}
      {isSleeping && (
        <div className="absolute -top-3 -right-2 text-sky-400 font-display font-medium select-none">
          <span className="pixel-sleep-z1 inline-block text-xs opacity-70">z</span>
          <span className="pixel-sleep-z2 inline-block text-[10px] ml-0.5 opacity-50">z</span>
          <span className="pixel-sleep-z1 inline-block text-[8px] ml-0.5 opacity-30">z</span>
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
            ) : p.type === 'sparkle' ? (
              <svg
                width={size * 0.24}
                height={size * 0.24}
                viewBox="0 0 24 24"
                fill="currentColor"
                className="drop-shadow-xs"
              >
                <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z" />
              </svg>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
