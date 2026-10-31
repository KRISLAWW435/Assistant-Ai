/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FloatingParticle, NormalizedGaze, PixelCharacterProps, PixelEmotion } from './PixelTypes';
import { PixelEyes } from './PixelEyes';
import { PixelEffects } from './PixelEffects';
import { pixelEmotionManager } from './PixelEmotionManager';
import { voiceManager } from '../../providers/voice/voiceManager';

const HEART_COLORS = [
  '#F472B6', // Pastel Pink
  '#C084FC', // Soft Lilac
  '#38BDF8', // Electric Cyan
  '#FDE047', // Warm Gold
  '#FB7185', // Coral Rosy
];

export const PixelCharacter: React.FC<PixelCharacterProps> = ({
  size = 72,
  emotion: controlledEmotion,
  onEmotionChange,
  onClick,
  onPet,
  petTrigger,
  interactive = true,
  isSpeaking = false,
  isListening = false,
  isThinking = false,
  disabledTrackMouse = false,
  className = '',
  showAura = true,
}) => {
  // Container DOM ref for tracking relative mouse position
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Managed or controlled emotion
  const [internalEmotion, setInternalEmotion] = useState<PixelEmotion>(() =>
    pixelEmotionManager.getEmotion()
  );
  const activeEmotion = controlledEmotion || internalEmotion;

  // Subscribe to emotion manager if not strictly controlled
  useEffect(() => {
    if (controlledEmotion) return;
    const unsub = pixelEmotionManager.subscribe((emo) => {
      setInternalEmotion(emo);
      if (onEmotionChange) onEmotionChange(emo);
    });
    return unsub;
  }, [controlledEmotion, onEmotionChange]);

  // Sync external voice and thinking states
  useEffect(() => {
    pixelEmotionManager.setVoiceState({ isListening, isSpeaking });
  }, [isListening, isSpeaking]);

  useEffect(() => {
    pixelEmotionManager.setThinkingState(isThinking);
  }, [isThinking]);

  // Real-time lip-sync mouth openness (0..1) driven by voice amplitude when speaking (never when listening/idle)
  const [mouthOpenness, setMouthOpenness] = useState<number>(0);

  useEffect(() => {
    if (isListening || (activeEmotion !== 'speaking' && !isSpeaking)) {
      setMouthOpenness(0);
      return;
    }
    const unsub = voiceManager.onAudioLevelChange((level) => {
      if (isListening) {
        setMouthOpenness(0);
      } else {
        setMouthOpenness(level);
      }
    });
    return () => {
      unsub();
      setMouthOpenness(0);
    };
  }, [activeEmotion, isSpeaking, isListening]);

  // Mouse tracking state with smooth spring lerp
  const [targetGaze, setTargetGaze] = useState<NormalizedGaze>({ x: 0, y: 0 });
  const [currentGaze, setCurrentGaze] = useState<NormalizedGaze>({ x: 0, y: 0 });
  const animFrameRef = useRef<number | null>(null);

  // Squash-and-stretch click state
  const [isSquashing, setIsSquashing] = useState(false);
  const [clickCount, setClickCount] = useState(0);

  // Floating particles (hearts / sparkles)
  const [particles, setParticles] = useState<FloatingParticle[]>([]);

  // Smooth gaze animation loop (Lerp with damping)
  useEffect(() => {
    if (disabledTrackMouse || activeEmotion === 'sleeping') {
      setCurrentGaze({ x: 0, y: 0 });
      return;
    }

    const lerpSpeed = 0.14; // smooth fluid damping

    const updateGaze = () => {
      setCurrentGaze((prev) => {
        const dx = targetGaze.x - prev.x;
        const dy = targetGaze.y - prev.y;

        // If distance is very small, snap to target
        if (Math.abs(dx) < 0.005 && Math.abs(dy) < 0.005) {
          return targetGaze;
        }

        return {
          x: prev.x + dx * lerpSpeed,
          y: prev.y + dy * lerpSpeed,
        };
      });

      animFrameRef.current = requestAnimationFrame(updateGaze);
    };

    animFrameRef.current = requestAnimationFrame(updateGaze);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [targetGaze, disabledTrackMouse, activeEmotion]);

  // Global mouse move listener for realistic gaze tracking
  useEffect(() => {
    if (disabledTrackMouse) return;

    let throttleTimeout: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      if (throttleTimeout) return;

      throttleTimeout = window.setTimeout(() => {
        throttleTimeout = null;
      }, 20); // ~50fps sampling

      // Wake up on mouse activity
      pixelEmotionManager.reportUserActivity();

      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const deltaX = e.clientX - centerX;
      const deltaY = e.clientY - centerY;
      const distance = Math.hypot(deltaX, deltaY);

      // Max tracking threshold: cursor within 700px influences gaze
      const maxDistance = 700;
      const normalizedDist = Math.min(distance / maxDistance, 1);

      // Nonlinear response: closer mouse = more concentrated gaze
      const angle = Math.atan2(deltaY, deltaX);
      const intensity = Math.pow(normalizedDist, 0.75);

      const normX = Math.cos(angle) * intensity;
      const normY = Math.sin(angle) * intensity;

      setTargetGaze({
        x: Math.max(-1, Math.min(1, normX)),
        y: Math.max(-1, Math.min(1, normY)),
      });
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (throttleTimeout) window.clearTimeout(throttleTimeout);
    };
  }, [disabledTrackMouse]);

  // Spawn bursting hearts on click / pet
  const spawnHearts = useCallback(() => {
    const count = 5 + Math.floor(Math.random() * 3); // 5 to 7 hearts
    const newItems: FloatingParticle[] = [];
    const now = Date.now();

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const distance = size * 0.55 + Math.random() * (size * 0.45);
      const targetX = Math.cos(angle) * distance;
      const targetY = Math.sin(angle) * distance - (size * 0.35); // rise upwards

      newItems.push({
        id: `heart-${now}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        type: Math.random() < 0.25 ? 'sparkle' : 'heart',
        x: (Math.random() - 0.5) * 16,
        y: (Math.random() - 0.5) * 16,
        targetX,
        targetY,
        scale: 0.6 + Math.random() * 0.5,
        rotation: (Math.random() - 0.5) * 45,
        color: HEART_COLORS[Math.floor(Math.random() * HEART_COLORS.length)],
        delayMs: i * 40,
        durationMs: 700 + Math.floor(Math.random() * 300),
      });
    }

    setParticles((prev) => [...prev.slice(-10), ...newItems]);
  }, [size]);

  const handleRemoveParticle = useCallback((id: string) => {
    setParticles((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // Handle external petTrigger (e.g. when parent component confirms a click)
  const lastHandledTriggerRef = useRef(0);
  useEffect(() => {
    if (petTrigger && petTrigger > 0 && petTrigger !== lastHandledTriggerRef.current) {
      lastHandledTriggerRef.current = petTrigger;
      pixelEmotionManager.triggerPetInteraction();
      setIsSquashing(true);
      setClickCount((c) => c + 1);
      spawnHearts();
      window.setTimeout(() => {
        setIsSquashing(false);
      }, 450);
      if (onPet) onPet();
    }
  }, [petTrigger, onPet, spawnHearts]);

  // Handle click on the character
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!interactive) return;

    // Report activity and trigger squash animation
    pixelEmotionManager.triggerPetInteraction();
    setIsSquashing(true);
    setClickCount((c) => c + 1);

    spawnHearts();

    // Reset squash after animation completes
    window.setTimeout(() => {
      setIsSquashing(false);
    }, 450);

    if (onPet) onPet();
    if (onClick) onClick(e);
  };

  // Mouse enter: curious look or wake up
  const handleMouseEnter = () => {
    if (activeEmotion === 'sleeping' || activeEmotion === 'sleepy') {
      pixelEmotionManager.wakeUp();
    } else if (activeEmotion === 'idle') {
      pixelEmotionManager.setEmotion('curious', 1800);
    }
  };

  // Compute organic 3D transform based on emotion & squash
  let transformStyle = '';
  if (isSquashing) {
    transformStyle = 'scale(1.18, 0.84) translateY(3px)';
  } else if (activeEmotion === 'sleeping') {
    transformStyle = 'translateY(2px) scale(0.98, 0.98)';
  } else if (activeEmotion === 'happy' || activeEmotion === 'interacting') {
    transformStyle = 'translateY(-4px) scale(1.04, 1.02)';
  } else if (activeEmotion === 'curious') {
    transformStyle = 'rotate(3deg) translateY(-2px)';
  } else if (activeEmotion === 'speaking') {
    transformStyle = 'scale(1.02, 1.01)';
  }

  // Rosy cheeks opacity
  const cheeksOpacity =
    activeEmotion === 'happy' || activeEmotion === 'interacting' || activeEmotion === 'bashful'
      ? 0.85
      : 0.5;

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      className={`relative inline-flex items-center justify-center select-none cursor-pointer transition-transform duration-200 ease-out ${className}`}
      style={{
        width: size,
        height: size,
      }}
      role="button"
      tabIndex={0}
      aria-label="ИИ-помощник Пиксель"
    >
      {/* 1. AMBIENT GLOWING AURA & BURSTING PARTICLES */}
      {showAura && (
        <PixelEffects
          emotion={activeEmotion}
          size={size}
          particles={particles}
          onRemoveParticle={handleRemoveParticle}
        />
      )}

      {/* 2. 3D GLOWING SILICONE / GEL SPHERE */}
      <div
        className="w-full h-full relative will-change-transform transition-all duration-300"
        style={{
          transform: transformStyle,
        }}
      >
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full overflow-visible drop-shadow-md"
        >
          <defs>
            {/* SPHERE BASE GRADIENT: Rich deep violet into electric blue / indigo */}
            <radialGradient id="pixelBodyGrad" cx="38%" cy="32%" r="68%">
              <stop offset="0%" stopColor="#7C3AED" />    {/* Radiant Violet Highlight */}
              <stop offset="35%" stopColor="#4F46E5" />   {/* Electric Indigo */}
              <stop offset="70%" stopColor="#312E81" />   {/* Deep Velvet Purple */}
              <stop offset="95%" stopColor="#1E1B4B" />   {/* Midnight Perimeter */}
              <stop offset="100%" stopColor="#0F172A" />  {/* Ambient Shadow Edge */}
            </radialGradient>

            {/* TRANSLUCENT INNER CORE GLOW: Cyan & electric blue luminescent center */}
            <radialGradient id="pixelCoreGlow" cx="50%" cy="52%" r="48%">
              <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.45" />
              <stop offset="50%" stopColor="#06B6D4" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#4F46E5" stopOpacity="0" />
            </radialGradient>

            {/* FRESNEL RIM LIGHT: Bright turquoise/cyan bottom-left bounce & top-right gleam */}
            <linearGradient id="pixelFresnelGrad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#00F0FF" stopOpacity="0.75" />
              <stop offset="40%" stopColor="#38BDF8" stopOpacity="0.1" />
              <stop offset="70%" stopColor="#818CF8" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#C084FC" stopOpacity="0.7" />
            </linearGradient>

            {/* 3D GLASS PRIMARY SPECULAR HIGHLIGHT (Top-Left Curved Gleam) */}
            <linearGradient id="pixelSpecularGrad" x1="20%" y1="0%" x2="80%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85" />
              <stop offset="60%" stopColor="#A5F3FC" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#38BDF8" stopOpacity="0" />
            </linearGradient>

            {/* ROSY CHEEKS GRADIENT */}
            <radialGradient id="pixelCheekGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#F43F5E" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#F43F5E" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* SPHERE BASE MESH */}
          <circle
            cx="50"
            cy="50"
            r="46"
            fill="url(#pixelBodyGrad)"
          />

          {/* INNER TRANSLUCENT LUMINESCENT CORE */}
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="url(#pixelCoreGlow)"
          />

          {/* FRESNEL RIM HIGHLIGHT (Subtle luminous 3D edge) */}
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="url(#pixelFresnelGrad)"
            strokeWidth="2.2"
          />

          {/* 3. ROSY BLUSH CHEEKS */}
          <ellipse
            cx="24"
            cy="58"
            rx="7.5"
            ry="4.2"
            fill="url(#pixelCheekGrad)"
            opacity={cheeksOpacity}
            className="transition-opacity duration-300"
          />
          <ellipse
            cx="76"
            cy="58"
            rx="7.5"
            ry="4.2"
            fill="url(#pixelCheekGrad)"
            opacity={cheeksOpacity}
            className="transition-opacity duration-300"
          />

          {/* 4. EXPRESSIVE LIVING EYES */}
          <PixelEyes
            emotion={activeEmotion}
            gaze={currentGaze}
            size={size}
          />

          {/* 5. MOUTH / EMOTION EXPRESSION CURVE (With Audio-Synced Lip Animation) */}
          {activeEmotion === 'speaking' && !isListening ? (
            mouthOpenness > 0.04 ? (
              <g>
                <ellipse
                  cx="50"
                  cy={Number((63.4 + mouthOpenness * 0.7).toFixed(2))}
                  rx={Number((3.6 + mouthOpenness * 1.5).toFixed(2))}
                  ry={Number((0.85 + mouthOpenness * 3.4).toFixed(2))}
                  fill="#0F172A"
                  stroke="#38BDF8"
                  strokeWidth="1.2"
                />
                {mouthOpenness > 0.32 && (
                  <ellipse
                    cx="50"
                    cy={Number((64.4 + mouthOpenness * 1.1).toFixed(2))}
                    rx={Number((1.8 + mouthOpenness * 0.8).toFixed(2))}
                    ry={Number((0.5 + mouthOpenness * 0.9).toFixed(2))}
                    fill="#F472B6"
                    opacity="0.75"
                  />
                )}
              </g>
            ) : (
              /* Brief consonant closure / pause between words */
              <path
                d="M 45.2 63.2 Q 50 65.6 54.8 63.2"
                fill="none"
                stroke="#0F172A"
                strokeWidth="2"
                strokeLinecap="round"
              />
            )
          ) : activeEmotion === 'happy' || activeEmotion === 'interacting' ? (
            /* Cheerful warm open smile */
            <path
              d="M 43 62 Q 50 69 57 62"
              fill="none"
              stroke="#0F172A"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          ) : activeEmotion === 'surprised' ? (
            /* Little round surprised "O" */
            <circle
              cx="50"
              cy="64"
              r="3.2"
              fill="#0F172A"
            />
          ) : activeEmotion === 'thinking' ? (
            /* Thoughtful small sideways mouth */
            <path
              d="M 46 64 Q 50 63 54 64"
              fill="none"
              stroke="#0F172A"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          ) : activeEmotion === 'curious' ? (
            /* Quizzical tiny inquisitive mouth */
            <ellipse
              cx="50"
              cy="63.5"
              rx="2.2"
              ry="2"
              fill="#0F172A"
            />
          ) : (
            /* Calm gentle smile (idle, sleeping, empathetic) */
            <path
              d="M 45 63 Q 50 66.5 55 63"
              fill="none"
              stroke="#0F172A"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}

          {/* 6. PRIMARY 3D GLASS SPECULAR REFLECTION (Curved Top-Left Teardrop) */}
          <path
            d="M 24 24 Q 38 14 58 18 Q 42 22 30 36 Q 23 31 24 24 Z"
            fill="url(#pixelSpecularGrad)"
          />

          {/* Secondary tiny specular sparkle glint (Top-right) */}
          <ellipse
            cx="68"
            cy="24"
            rx="4.5"
            ry="2.8"
            transform="rotate(25 68 24)"
            fill="#FFFFFF"
            opacity="0.65"
          />

          {/* Bottom bounce light reflection */}
          <path
            d="M 32 82 Q 50 88 68 82 Q 50 85 32 82 Z"
            fill="#38BDF8"
            opacity="0.4"
          />
        </svg>
      </div>
    </div>
  );
};
