/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IdleMicroBehavior, NormalizedGaze, PixelEmotion } from './PixelTypes';

interface PixelEyesProps {
  emotion: PixelEmotion;
  gaze: NormalizedGaze;
  size: number;
  microBehavior?: IdleMicroBehavior;
}

export const PixelEyes: React.FC<PixelEyesProps> = ({
  emotion,
  gaze,
  size,
  microBehavior = 'none',
}) => {
  // Natural randomized blink state
  const [isBlinking, setIsBlinking] = useState(false);
  const blinkTimeoutRef = useRef<number | null>(null);

  // Micro-saccade offset (natural random gaze wanders)
  const [microSaccade, setMicroSaccade] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });

  // Natural organic blinking schedule
  useEffect(() => {
    // Disable active blinking during sleep
    if (emotion === 'sleeping') {
      setIsBlinking(false);
      return;
    }

    let isMounted = true;

    const scheduleNextBlink = () => {
      // Blink interval: 3.2s to 6.5s
      const delay = Math.random() * 3300 + 3200;
      blinkTimeoutRef.current = window.setTimeout(() => {
        if (!isMounted) return;
        setIsBlinking(true);

        // Blink duration: 120ms to 160ms
        window.setTimeout(() => {
          if (!isMounted) return;
          setIsBlinking(false);

          // 20% chance of an immediate quick double-blink
          if (Math.random() < 0.22) {
            window.setTimeout(() => {
              if (!isMounted) return;
              setIsBlinking(true);
              window.setTimeout(() => {
                if (!isMounted) return;
                setIsBlinking(false);
                scheduleNextBlink();
              }, 110);
            }, 140);
          } else {
            scheduleNextBlink();
          }
        }, 130);
      }, delay);
    };

    scheduleNextBlink();

    return () => {
      isMounted = false;
      if (blinkTimeoutRef.current) {
        window.clearTimeout(blinkTimeoutRef.current);
      }
    };
  }, [emotion]);

  // Micro-saccades & Micro-Behaviors: subtle natural eye twitches
  useEffect(() => {
    if (emotion === 'sleeping' || emotion === 'sleepy') {
      setMicroSaccade({ x: 0, y: 0.15 });
      return;
    }

    if (microBehavior === 'look_up') {
      setMicroSaccade({ x: 0.05, y: -0.65 });
      return;
    }

    if (microBehavior === 'look_around') {
      setMicroSaccade({ x: 0.55, y: 0.1 });
      const t = window.setTimeout(() => {
        setMicroSaccade({ x: -0.55, y: -0.15 });
      }, 1500);
      return () => window.clearTimeout(t);
    }

    const saccadeInterval = window.setInterval(() => {
      if (Math.random() < 0.35) {
        setMicroSaccade({
          x: (Math.random() - 0.5) * 0.18,
          y: (Math.random() - 0.5) * 0.15,
        });
      } else {
        setMicroSaccade({ x: 0, y: 0 });
      }
    }, 2800);

    return () => window.clearInterval(saccadeInterval);
  }, [emotion, microBehavior]);

  // Eye scaling & pupil travel calculations based on size
  const eyeRadiusX = size * 0.135;
  const eyeRadiusY = size * 0.155;
  const eyeSpacing = size * 0.17; // distance from center of sphere
  const pupilRadius = size * 0.082;
  const maxPupilTravelX = size * 0.048;
  const maxPupilTravelY = size * 0.042;

  // Compute final damped pupil offsets
  const effectiveGazeX = Math.max(-1, Math.min(1, gaze.x + microSaccade.x));
  const effectiveGazeY = Math.max(-1, Math.min(1, gaze.y + microSaccade.y));

  // Modify gaze & pupil scale slightly per emotion
  let emotionGazeModX = 0;
  let emotionGazeModY = 0;
  let pupilScale = 1.0;

  if (emotion === 'thoughtful' || emotion === 'thinking') {
    emotionGazeModX = 0.45;
    emotionGazeModY = -0.55;
    pupilScale = 0.92;
  } else if (emotion === 'shy' || emotion === 'bashful') {
    emotionGazeModX = -0.3;
    emotionGazeModY = 0.42;
    pupilScale = 0.95;
  } else if (emotion === 'surprise' || emotion === 'surprised') {
    pupilScale = 1.25;
  } else if (emotion === 'curiosity' || emotion === 'curious') {
    pupilScale = 1.12;
  } else if (emotion === 'sleepy') {
    emotionGazeModY = 0.35;
    pupilScale = 0.88;
  } else if (emotion === 'sadness') {
    emotionGazeModY = 0.25;
    pupilScale = 0.95;
  }

  const finalPupilOffsetX =
    (effectiveGazeX * 0.75 + emotionGazeModX) * maxPupilTravelX;
  const finalPupilOffsetY =
    (effectiveGazeY * 0.75 + emotionGazeModY) * maxPupilTravelY;

  // Eye center coordinates relative to 100x100 viewBox
  const leftEyeCx = 50 - (eyeSpacing / size) * 100;
  const rightEyeCx = 50 + (eyeSpacing / size) * 100;
  const eyeCy = 46;

  // Convert computed radii to percentage of 100 viewBox
  const rxPct = (eyeRadiusX / size) * 100;
  const ryPct = (eyeRadiusY / size) * 100;
  const pupilRPct = (pupilRadius / size) * 100 * pupilScale;
  const pupilOffsetXPct = (finalPupilOffsetX / size) * 100;
  const pupilOffsetYPct = (finalPupilOffsetY / size) * 100;

  // Render eyelids & eye shapes based on emotion and micro-behaviors
  const isFullyClosed =
    emotion === 'sleeping' ||
    microBehavior === 'doze' ||
    (isBlinking && emotion !== 'happy' && emotion !== 'joy' && emotion !== 'interacting');

  const isHappyCrescents =
    emotion === 'happy' || emotion === 'joy' || emotion === 'interacting';

  // Eyebrow paths calculation
  // Subtle, delicate eyebrow accents only for inquiry/surprise states;
  // hidden completely for idle, calm, joy, speaking, listening, sleepy
  const getEyebrows = (): { left: string; right: string } | null => {
    const browBaseY = eyeCy - ryPct * 1.22;

    if (emotion === 'surprise' || emotion === 'surprised') {
      return {
        left: `M ${leftEyeCx - rxPct * 0.6} ${browBaseY - 1.2} Q ${leftEyeCx} ${browBaseY - 2.8} ${leftEyeCx + rxPct * 0.6} ${browBaseY - 1.2}`,
        right: `M ${rightEyeCx - rxPct * 0.6} ${browBaseY - 1.2} Q ${rightEyeCx} ${browBaseY - 2.8} ${rightEyeCx + rxPct * 0.6} ${browBaseY - 1.2}`,
      };
    }

    if (emotion === 'thoughtful' || emotion === 'thinking') {
      return {
        left: `M ${leftEyeCx - rxPct * 0.55} ${browBaseY} Q ${leftEyeCx} ${browBaseY - 0.4} ${leftEyeCx + rxPct * 0.55} ${browBaseY + 0.3}`,
        right: `M ${rightEyeCx - rxPct * 0.55} ${browBaseY - 1.0} Q ${rightEyeCx} ${browBaseY - 2.2} ${rightEyeCx + rxPct * 0.55} ${browBaseY - 0.8}`,
      };
    }

    if (emotion === 'curiosity' || emotion === 'curious') {
      return {
        left: `M ${leftEyeCx - rxPct * 0.55} ${browBaseY - 0.4} Q ${leftEyeCx} ${browBaseY - 1.6} ${leftEyeCx + rxPct * 0.55} ${browBaseY - 0.6}`,
        right: `M ${rightEyeCx - rxPct * 0.55} ${browBaseY - 0.8} Q ${rightEyeCx} ${browBaseY - 2.0} ${rightEyeCx + rxPct * 0.55} ${browBaseY - 1.0}`,
      };
    }

    // Completely no eyebrows for calm, idle, speaking, listening, happy, sleepy, etc.
    return null;
  };

  const eyebrows = getEyebrows();

  return (
    <g className="pixel-eyes-group">
      <defs>
        {/* Soft pastel eyelid gradient: delicate rosy-pearl with light blue undertone, NO dark indigo */}
        <linearGradient id="pixelEyelidGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FDF2F8" />
          <stop offset="70%" stopColor="#FBCFE8" />
          <stop offset="100%" stopColor="#F472B6" />
        </linearGradient>

        {/* Left eye clip path for pupil boundary containment */}
        <clipPath id="leftEyeClip">
          <ellipse cx={leftEyeCx} cy={eyeCy} rx={rxPct} ry={ryPct} />
        </clipPath>
        {/* Right eye clip path for pupil boundary containment */}
        <clipPath id="rightEyeClip">
          <ellipse cx={rightEyeCx} cy={eyeCy} rx={rxPct} ry={ryPct} />
        </clipPath>

        {/* Iris radial gradient: gentle sky cyan into soft lavender-indigo */}
        <radialGradient id="irisGrad" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#7DD3FC" />
          <stop offset="45%" stopColor="#38BDF8" />
          <stop offset="85%" stopColor="#818CF8" />
          <stop offset="100%" stopColor="#1E293B" />
        </radialGradient>

        {/* Sclera 3D sphere gradient */}
        <radialGradient id="scleraGrad" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="75%" stopColor="#F8FAFC" />
          <stop offset="100%" stopColor="#CBD5E1" />
        </radialGradient>
      </defs>

      {/* ULTRA-THIN DELICATE ACCENT EYEBROWS (Only for subtle thinking/curiosity/surprise) */}
      {eyebrows && (
        <g
          fill="none"
          stroke="#94A3B8"
          strokeWidth="0.8"
          strokeLinecap="round"
          opacity="0.32"
          className="transition-all duration-300 ease-out"
        >
          <path d={eyebrows.left} />
          <path d={eyebrows.right} />
        </g>
      )}

      {/* 1. HAPPY CRESCENTS MODE: Joyful upward curved smiling eyes (^ ^) */}
      {isHappyCrescents ? (
        <g
          fill="none"
          stroke="#1E293B"
          strokeWidth="3"
          strokeLinecap="round"
          className="transition-all duration-200"
        >
          {/* Left crescent */}
          <path
            d={`M ${leftEyeCx - rxPct * 0.9} ${eyeCy + 2} Q ${leftEyeCx} ${
              eyeCy - ryPct * 1.1
            } ${leftEyeCx + rxPct * 0.9} ${eyeCy + 2}`}
          />
          {/* Right crescent */}
          <path
            d={`M ${rightEyeCx - rxPct * 0.9} ${eyeCy + 2} Q ${rightEyeCx} ${
              eyeCy - ryPct * 1.1
            } ${rightEyeCx + rxPct * 0.9} ${eyeCy + 2}`}
          />
        </g>
      ) : isFullyClosed ? (
        /* 2. SLEEPING / BLINKING CLOSED LIDS: Gentle curved downward sleeping arcs */
        <g
          fill="none"
          stroke="#1E293B"
          strokeWidth="2.6"
          strokeLinecap="round"
          className="transition-all duration-200"
        >
          {/* Left closed eyelid */}
          <path
            d={`M ${leftEyeCx - rxPct * 0.85} ${eyeCy} Q ${leftEyeCx} ${
              eyeCy + ryPct * 0.9
            } ${leftEyeCx + rxPct * 0.85} ${eyeCy}`}
          />
          {/* Right closed eyelid */}
          <path
            d={`M ${rightEyeCx - rxPct * 0.85} ${eyeCy} Q ${rightEyeCx} ${
              eyeCy + ryPct * 0.9
            } ${rightEyeCx + rxPct * 0.85} ${eyeCy}`}
          />
        </g>
      ) : (
        /* 3. OPEN 3D LIVING EYES WITH IRIS, PUPILS & SPECULAR HIGHLIGHTS */
        <g className="pixel-open-eyes">
          {/* Left Eye Sclera */}
          <ellipse
            cx={leftEyeCx}
            cy={eyeCy}
            rx={rxPct}
            ry={ryPct}
            fill="url(#scleraGrad)"
            stroke="#CBD5E1"
            strokeWidth="1"
            strokeOpacity="0.6"
          />

          {/* Right Eye Sclera */}
          <ellipse
            cx={rightEyeCx}
            cy={eyeCy}
            rx={rxPct}
            ry={ryPct}
            fill="url(#scleraGrad)"
            stroke="#CBD5E1"
            strokeWidth="1"
            strokeOpacity="0.6"
          />

          {/* LEFT PUPIL & IRIS (Strictly clipped inside eye boundary) */}
          <g clipPath="url(#leftEyeClip)">
            <g
              transform={`translate(${pupilOffsetXPct}, ${pupilOffsetYPct})`}
              className="transition-transform duration-75 ease-out"
            >
              {/* Iridescent Iris */}
              <circle
                cx={leftEyeCx}
                cy={eyeCy}
                r={pupilRPct * 1.32}
                fill="url(#irisGrad)"
              />
              {/* Deep Glossy Pupil */}
              <circle
                cx={leftEyeCx}
                cy={eyeCy}
                r={pupilRPct * 0.92}
                fill="#0B0F19"
              />
              {/* Primary Glass Specular Highlight (Curved teardrop top-left) */}
              <ellipse
                cx={leftEyeCx - pupilRPct * 0.38}
                cy={eyeCy - pupilRPct * 0.38}
                rx={pupilRPct * 0.42}
                ry={pupilRPct * 0.32}
                fill="#FFFFFF"
                opacity="0.95"
              />
              {/* Secondary Bounce Highlight (Bottom-right soft cyan) */}
              <ellipse
                cx={leftEyeCx + pupilRPct * 0.42}
                cy={eyeCy + pupilRPct * 0.42}
                rx={pupilRPct * 0.22}
                ry={pupilRPct * 0.18}
                fill="#BAE6FD"
                opacity="0.75"
              />
              {/* Micro pin sparkle */}
              <circle
                cx={leftEyeCx + pupilRPct * 0.2}
                cy={eyeCy - pupilRPct * 0.48}
                r={pupilRPct * 0.12}
                fill="#FFFFFF"
                opacity="0.85"
              />
            </g>
          </g>

          {/* RIGHT PUPIL & IRIS (Strictly clipped inside eye boundary) */}
          <g clipPath="url(#rightEyeClip)">
            <g
              transform={`translate(${pupilOffsetXPct}, ${pupilOffsetYPct})`}
              className="transition-transform duration-75 ease-out"
            >
              {/* Iridescent Iris */}
              <circle
                cx={rightEyeCx}
                cy={eyeCy}
                r={pupilRPct * 1.32}
                fill="url(#irisGrad)"
              />
              {/* Deep Glossy Pupil */}
              <circle
                cx={rightEyeCx}
                cy={eyeCy}
                r={pupilRPct * 0.92}
                fill="#0B0F19"
              />
              {/* Primary Glass Specular Highlight (Curved teardrop top-left) */}
              <ellipse
                cx={rightEyeCx - pupilRPct * 0.38}
                cy={eyeCy - pupilRPct * 0.38}
                rx={pupilRPct * 0.42}
                ry={pupilRPct * 0.32}
                fill="#FFFFFF"
                opacity="0.95"
              />
              {/* Secondary Bounce Highlight (Bottom-right soft cyan) */}
              <ellipse
                cx={rightEyeCx + pupilRPct * 0.42}
                cy={eyeCy + pupilRPct * 0.42}
                rx={pupilRPct * 0.22}
                ry={pupilRPct * 0.18}
                fill="#BAE6FD"
                opacity="0.75"
              />
              {/* Micro pin sparkle */}
              <circle
                cx={rightEyeCx + pupilRPct * 0.2}
                cy={eyeCy - pupilRPct * 0.48}
                r={pupilRPct * 0.12}
                fill="#FFFFFF"
                opacity="0.85"
              />
            </g>
          </g>

          {/* EMOTION-SPECIFIC EYELID OVERLAYS: Rendered in soft pastel pearl/rose, NOT dark indigo */}
          {(emotion === 'sleepy' || microBehavior === 'slow_blink') && (
            /* Drooping gentle pastel eyelids covering upper 50% */
            <g fill="url(#pixelEyelidGrad)" stroke="#F472B6" strokeWidth="0.8" opacity="0.92">
              <path
                d={`M ${leftEyeCx - rxPct} ${eyeCy - ryPct} Q ${leftEyeCx} ${
                  eyeCy + ryPct * 0.2
                } ${leftEyeCx + rxPct} ${eyeCy - ryPct} Z`}
              />
              <path
                d={`M ${rightEyeCx - rxPct} ${eyeCy - ryPct} Q ${rightEyeCx} ${
                  eyeCy + ryPct * 0.2
                } ${rightEyeCx + rxPct} ${eyeCy - ryPct} Z`}
              />
            </g>
          )}

          {(emotion === 'thoughtful' || emotion === 'thinking') && (
            /* Contemplative soft squint */
            <g fill="url(#pixelEyelidGrad)" stroke="#F472B6" strokeWidth="0.6" opacity="0.85">
              <path
                d={`M ${leftEyeCx - rxPct} ${eyeCy - ryPct} Q ${leftEyeCx} ${
                  eyeCy - ryPct * 0.15
                } ${leftEyeCx + rxPct} ${eyeCy - ryPct} Z`}
              />
              <path
                d={`M ${rightEyeCx - rxPct} ${eyeCy - ryPct} Q ${rightEyeCx} ${
                  eyeCy - ryPct * 0.15
                } ${rightEyeCx + rxPct} ${eyeCy - ryPct} Z`}
              />
            </g>
          )}

          {(emotion === 'empathy' || emotion === 'empathetic') && (
            /* Caring gentle slant */
            <g fill="url(#pixelEyelidGrad)" stroke="#F472B6" strokeWidth="0.6" opacity="0.82">
              <path
                d={`M ${leftEyeCx - rxPct} ${eyeCy - ryPct * 0.5} Q ${leftEyeCx} ${
                  eyeCy - ryPct * 0.2
                } ${leftEyeCx + rxPct} ${eyeCy - ryPct} Z`}
              />
              <path
                d={`M ${rightEyeCx - rxPct} ${eyeCy - ryPct} Q ${rightEyeCx} ${
                  eyeCy - ryPct * 0.2
                } ${rightEyeCx + rxPct} ${eyeCy - ryPct * 0.5} Z`}
              />
            </g>
          )}
        </g>
      )}
    </g>
  );
};
