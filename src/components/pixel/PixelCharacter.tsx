/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FloatingParticle, IdleMicroBehavior, NormalizedGaze, PixelCharacterProps, PixelEmotion } from './PixelTypes';
import { PixelEyes } from './PixelEyes';
import { PixelEffects } from './PixelEffects';
import { pixelEmotionManager } from './PixelEmotionManager';
import { voiceManager } from '../../providers/voice/voiceManager';

const HEART_COLORS = [
  '#F472B6', // Pastel Pink
  '#FBCFE8', // Soft Rose Mist
  '#BAE6FD', // Tender Sky Blue
  '#7DD3FC', // Light Cyan
  '#C4B5FD', // Soft Pearl Lilac
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

  // Idle micro-behavior subscription
  const [microBehavior, setMicroBehavior] = useState<IdleMicroBehavior>(() =>
    pixelEmotionManager.getMicroBehavior()
  );

  useEffect(() => {
    const unsub = pixelEmotionManager.subscribeMicroBehavior((b) => {
      setMicroBehavior(b);
    });
    return unsub;
  }, []);

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

  // Real-time speech lip-sync: audio level (0..1) + organic harmonic rhythm
  const [mouthOpenness, setMouthOpenness] = useState<number>(0);
  const [speechHarmonic, setSpeechHarmonic] = useState<number>(0);
  const speechHarmonicRef = useRef<number | null>(null);

  useEffect(() => {
    if (isListening || (activeEmotion !== 'speaking' && !isSpeaking)) {
      setMouthOpenness(0);
      setSpeechHarmonic(0);
      if (speechHarmonicRef.current) {
        cancelAnimationFrame(speechHarmonicRef.current);
        speechHarmonicRef.current = null;
      }
      return;
    }

    // Subscribe to real audio levels
    const unsub = voiceManager.onAudioLevelChange((level) => {
      if (isListening) {
        setMouthOpenness(0);
      } else {
        // Natural smoothing and clamping
        setMouthOpenness(Math.max(0, Math.min(1, level)));
      }
    });

    // Animate subtle vowel modulation while speaking
    const animateSpeech = () => {
      setSpeechHarmonic((Date.now() / 120) % (Math.PI * 2));
      speechHarmonicRef.current = requestAnimationFrame(animateSpeech);
    };
    speechHarmonicRef.current = requestAnimationFrame(animateSpeech);

    return () => {
      unsub();
      if (speechHarmonicRef.current) {
        cancelAnimationFrame(speechHarmonicRef.current);
        speechHarmonicRef.current = null;
      }
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

  // Handle external petTrigger
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

    pixelEmotionManager.triggerPetInteraction();
    setIsSquashing(true);
    setClickCount((c) => c + 1);

    spawnHearts();

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
    } else if (activeEmotion === 'idle' || activeEmotion === 'calm') {
      pixelEmotionManager.setEmotion('curiosity', 1800);
    }
  };

  // Compute organic 3D transform based on emotion, squash & micro-behaviors
  let transformStyle = '';
  if (isSquashing) {
    transformStyle = 'scale(1.18, 0.84) translateY(3px)';
  } else if (activeEmotion === 'sleeping' || microBehavior === 'doze') {
    transformStyle = 'translateY(2px) scale(0.98, 0.98) rotate(-1.5deg)';
  } else if (activeEmotion === 'happy' || activeEmotion === 'joy' || activeEmotion === 'interacting') {
    transformStyle = 'translateY(-4px) scale(1.04, 1.02)';
  } else if (activeEmotion === 'curious' || activeEmotion === 'curiosity') {
    transformStyle = 'rotate(3deg) translateY(-2px)';
  } else if (activeEmotion === 'speaking') {
    transformStyle = 'scale(1.02, 1.01)';
  } else if (microBehavior === 'music_sway') {
    transformStyle = 'rotate(2.6deg) translateY(-1px)';
  } else if (microBehavior === 'stretch_bounce') {
    transformStyle = 'scale(1.04, 0.96) translateY(1.5px)';
  }

  // Rosy cheeks opacity
  const cheeksOpacity =
    activeEmotion === 'happy' ||
    activeEmotion === 'joy' ||
    activeEmotion === 'interacting' ||
    activeEmotion === 'bashful' ||
    activeEmotion === 'shy'
      ? 0.85
      : 0.5;

  // Dynamic speech mouth coordinates calculation
  // Varies aperture organically based on voice volume + harmonic wave
  const speechRx = Math.max(3.2, Math.min(6.2, 3.6 + mouthOpenness * 2.2 + Math.sin(speechHarmonic) * 0.6));
  const speechRy = Math.max(0.8, Math.min(4.8, 1.0 + mouthOpenness * 3.6 + Math.cos(speechHarmonic) * 0.4));
  const speechCy = 63.5 + mouthOpenness * 0.6;

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      className={`relative inline-flex items-center justify-center select-none cursor-pointer transition-transform duration-200 ease-out bg-transparent ${className}`}
      style={{
        width: size,
        height: size,
      }}
      role="button"
      tabIndex={0}
      aria-label="ИИ-помощник Пиксель"
    >
      {/* 1. AMBIENT GLOWING AURA & BURSTING PARTICLES (Transparent SVG glow, NO dark box-shadow) */}
      {showAura && (
        <PixelEffects
          emotion={activeEmotion}
          size={size}
          particles={particles}
          onRemoveParticle={handleRemoveParticle}
        />
      )}

      {/* 2. 3D GLOWING TRANSLUCENT PEARLESCENT SPHERE */}
      <div
        className={`w-full h-full relative will-change-transform transition-all duration-300 bg-transparent ${
          activeEmotion === 'sleeping'
            ? 'pixel-sleep-body'
            : isListening
              ? 'pixel-listening-body'
              : isSquashing
                ? 'pixel-pet-bounce'
                : 'pixel-idle-body'
        }`}
        style={{
          transform: transformStyle,
        }}
      >
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full overflow-visible"
        >
          <defs>
            {/* SPHERE BASE GRADIENT: Smooth transition from light pastel pink to tender sky-blue */}
            <radialGradient id="pixelBodyGrad" cx="35%" cy="28%" r="72%">
              <stop offset="0%" stopColor="#FFFFFF" />    {/* Pearl Top-Left Gleam */}
              <stop offset="18%" stopColor="#FDF2F8" />   {/* Soft Baby Pearl */}
              <stop offset="42%" stopColor="#F472B6" />   {/* Gentle Pastel Rose */}
              <stop offset="70%" stopColor="#BAE6FD" />   {/* Tender Sky Azure */}
              <stop offset="90%" stopColor="#7DD3FC" />   {/* Light Luminous Cyan */}
              <stop offset="100%" stopColor="#38BDF8" />  {/* Soft Pastel Blue Edge */}
            </radialGradient>

            {/* TRANSLUCENT INNER PEARLESCENT CORE GLOW */}
            <radialGradient id="pixelCoreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.65" />
              <stop offset="35%" stopColor="#FBCFE8" stopOpacity="0.45" />
              <stop offset="70%" stopColor="#BAE6FD" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#DDD6FE" stopOpacity="0" />
            </radialGradient>

            {/* FRESNEL RIM LIGHT: Delicate soft luminous pearl rim */}
            <linearGradient id="pixelFresnelGrad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#7DD3FC" stopOpacity="0.75" />
              <stop offset="40%" stopColor="#BAE6FD" stopOpacity="0.3" />
              <stop offset="75%" stopColor="#F472B6" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.9" />
            </linearGradient>

            {/* 3D GLASS PRIMARY SPECULAR HIGHLIGHT */}
            <linearGradient id="pixelSpecularGrad" x1="15%" y1="0%" x2="85%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.92" />
              <stop offset="55%" stopColor="#FDF4FF" stopOpacity="0.38" />
              <stop offset="100%" stopColor="#E0F2FE" stopOpacity="0" />
            </linearGradient>

            {/* ROSY BLUSH CHEEKS GRADIENT */}
            <radialGradient id="pixelCheekGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FB7185" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#FB7185" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* SPHERE BASE MESH */}
          <circle
            cx="50"
            cy="50"
            r="46"
            fill="url(#pixelBodyGrad)"
          />

          {/* INNER TRANSLUCENT LUMINESCENT CORE (Gently shifts in thinking state) */}
          <g className={isThinking ? 'pixel-thinking-core' : ''}>
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="url(#pixelCoreGlow)"
            />
          </g>

          {/* FRESNEL RIM HIGHLIGHT (Subtle luminous 3D edge) */}
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="url(#pixelFresnelGrad)"
            strokeWidth="1.8"
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

          {/* 4. EXPRESSIVE LIVING EYES & EYEBROWS */}
          <PixelEyes
            emotion={activeEmotion}
            gaze={currentGaze}
            size={size}
            microBehavior={microBehavior}
          />

          {/* 5. MOUTH / EMOTION EXPRESSION CURVE (With Speech Lip-Sync & Attentive Listening) */}
          {activeEmotion === 'speaking' && !isListening ? (
            mouthOpenness > 0.05 ? (
              <g className="pixel-speaking-mouth">
                {/* Outer mouth opening */}
                <ellipse
                  cx="50"
                  cy={Number(speechCy.toFixed(2))}
                  rx={Number(speechRx.toFixed(2))}
                  ry={Number(speechRy.toFixed(2))}
                  fill="#1E293B"
                  stroke="#38BDF8"
                  strokeWidth="1.2"
                />
                {/* Delicate pink tongue gleam inside mouth on vowels */}
                {mouthOpenness > 0.28 && (
                  <ellipse
                    cx="50"
                    cy={Number((speechCy + speechRy * 0.35).toFixed(2))}
                    rx={Number((speechRx * 0.55).toFixed(2))}
                    ry={Number((speechRy * 0.45).toFixed(2))}
                    fill="#F472B6"
                    opacity="0.85"
                  />
                )}
              </g>
            ) : (
              /* Brief consonant resting pause during speech */
              <path
                d="M 45.2 63.2 Q 50 65.6 54.8 63.2"
                fill="none"
                stroke="#1E293B"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            )
          ) : isListening ? (
            /* ATTENTIVE LISTENING: Mouth calmly closed, gentle receptive presence */
            <path
              d="M 46 63.5 Q 50 65.4 54 63.5"
              fill="none"
              stroke="#1E293B"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          ) : activeEmotion === 'joy' || activeEmotion === 'happy' || activeEmotion === 'interacting' ? (
            /* Cheerful warm open smile */
            <path
              d="M 42 61.5 Q 50 69 58 61.5"
              fill="none"
              stroke="#1E293B"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          ) : activeEmotion === 'surprise' || activeEmotion === 'surprised' ? (
            /* Surprised round 'O' mouth */
            <ellipse
              cx="50"
              cy="63.8"
              rx="3.2"
              ry="3.6"
              fill="#1E293B"
            />
          ) : activeEmotion === 'sadness' ? (
            /* Downturned gentle comforting mouth */
            <path
              d="M 44.5 64.8 Q 50 62.6 55.5 64.8"
              fill="none"
              stroke="#1E293B"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          ) : activeEmotion === 'empathy' || activeEmotion === 'empathetic' ? (
            /* Understanding soft smile */
            <path
              d="M 44.5 63.2 Q 50 66.8 55.5 63.2"
              fill="none"
              stroke="#1E293B"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          ) : activeEmotion === 'thoughtful' || activeEmotion === 'thinking' ? (
            /* Contemplative small mouth */
            <path
              d="M 46 64 Q 50 63.2 54 64"
              fill="none"
              stroke="#1E293B"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          ) : activeEmotion === 'curiosity' || activeEmotion === 'curious' ? (
            /* Inquisitive tiny mouth */
            <ellipse
              cx="50"
              cy="63.5"
              rx="2.4"
              ry="2"
              fill="#1E293B"
            />
          ) : activeEmotion === 'shy' || activeEmotion === 'bashful' ? (
            /* Shy soft smile */
            <path
              d="M 46 63.6 Q 50 66.2 54 63.6"
              fill="none"
              stroke="#1E293B"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          ) : microBehavior === 'chew' ? (
            /* Tiny cute nibble micro-behavior */
            <ellipse
              cx="50"
              cy="63.6"
              rx="2.2"
              ry="1.4"
              fill="#1E293B"
            />
          ) : (
            /* Default calm resting smile (idle, sleeping, calm) */
            <path
              d="M 45 63 Q 50 66.2 55 63"
              fill="none"
              stroke="#1E293B"
              strokeWidth="1.8"
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
            rx="4.2"
            ry="2.6"
            transform="rotate(25 68 24)"
            fill="#FFFFFF"
            opacity="0.75"
          />

          {/* Bottom bounce light reflection */}
          <path
            d="M 32 82 Q 50 88 68 82 Q 50 85 32 82 Z"
            fill="#BAE6FD"
            opacity="0.45"
          />
        </svg>
      </div>
    </div>
  );
};
