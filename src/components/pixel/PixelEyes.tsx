/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NormalizedGaze, PixelEmotion } from './PixelTypes';

interface PixelEyesProps {
  emotion: PixelEmotion;
  gaze: NormalizedGaze;
  size: number;
}

export const PixelEyes: React.FC<PixelEyesProps> = ({
  emotion,
  gaze,
  size,
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

  // Micro-saccades: subtle natural eye twitches when in idle or thinking
  useEffect(() => {
    if (emotion === 'sleeping' || emotion === 'sleepy') {
      setMicroSaccade({ x: 0, y: 0 });
      return;
    }

    const saccadeInterval = window.setInterval(() => {
      // 35% chance to glance slightly aside or center
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
  }, [emotion]);

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

  // Modify gaze slightly per emotion
  let emotionGazeModX = 0;
  let emotionGazeModY = 0;
  let pupilScale = 1.0;

  if (emotion === 'thinking') {
    emotionGazeModX = 0.45;
    emotionGazeModY = -0.55;
    pupilScale = 0.92;
  } else if (emotion === 'bashful') {
    emotionGazeModX = -0.35;
    emotionGazeModY = 0.45;
    pupilScale = 0.95;
  } else if (emotion === 'surprised') {
    pupilScale = 1.25;
  } else if (emotion === 'curious') {
    pupilScale = 1.12;
  } else if (emotion === 'sleepy') {
    emotionGazeModY = 0.35;
    pupilScale = 0.88;
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

  // Render eyelids & eye shapes based on emotion
  const isFullyClosed =
    emotion === 'sleeping' ||
    (isBlinking && emotion !== 'happy' && emotion !== 'interacting');

  const isHappyCrescents =
    emotion === 'happy' || emotion === 'interacting';

  return (
    <g className="pixel-eyes-group">
      {/* 1. HAPPY CRESCENTS MODE: Joyful upward curved smiling eyes (^ ^) */}
      {isHappyCrescents ? (
        <g
          fill="none"
          stroke="#0F172A"
          strokeWidth="3.2"
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
          stroke="#0F172A"
          strokeWidth="2.8"
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
          {/* SCLERA (White eyeball with ambient soft blue tint & depth) */}
          <defs>
            {/* Left eye clip path for pupil boundary containment */}
            <clipPath id="leftEyeClip">
              <ellipse
                cx={leftEyeCx}
                cy={eyeCy}
                rx={rxPct}
                ry={ryPct}
              />
            </clipPath>
            {/* Right eye clip path for pupil boundary containment */}
            <clipPath id="rightEyeClip">
              <ellipse
                cx={rightEyeCx}
                cy={eyeCy}
                rx={rxPct}
                ry={ryPct}
              />
            </clipPath>

            {/* Iris radial gradient: vibrant cyan-electric blue into rich violet */}
            <radialGradient id="irisGrad" cx="35%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#38BDF8" />     {/* Electric cyan core */}
              <stop offset="45%" stopColor="#0284C7" />    {/* Deep sky azure */}
              <stop offset="85%" stopColor="#4338CA" />    {/* Rich indigo ring */}
              <stop offset="100%" stopColor="#1E1B4B" />   {/* Deep outer rim */}
            </radialGradient>

            {/* Sclera 3D sphere gradient */}
            <radialGradient id="scleraGrad" cx="40%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="75%" stopColor="#F0F4FF" />
              <stop offset="100%" stopColor="#CBD5E1" />
            </radialGradient>
          </defs>

          {/* Left Eye Sclera */}
          <ellipse
            cx={leftEyeCx}
            cy={eyeCy}
            rx={rxPct}
            ry={ryPct}
            fill="url(#scleraGrad)"
            stroke="#1E1B4B"
            strokeWidth="1.2"
            strokeOpacity="0.4"
          />

          {/* Right Eye Sclera */}
          <ellipse
            cx={rightEyeCx}
            cy={eyeCy}
            rx={rxPct}
            ry={ryPct}
            fill="url(#scleraGrad)"
            stroke="#1E1B4B"
            strokeWidth="1.2"
            strokeOpacity="0.4"
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

          {/* EMOTION-SPECIFIC EYELID OVERLAYS (Sleepy, Thinking, Empathetic, Bashful) */}
          {emotion === 'sleepy' && (
            /* Drooping heavy upper eyelids covering top 55% */
            <g fill="#312E81" opacity="0.95">
              <path
                d={`M ${leftEyeCx - rxPct} ${eyeCy - ryPct} Q ${leftEyeCx} ${
                  eyeCy + ryPct * 0.25
                } ${leftEyeCx + rxPct} ${eyeCy - ryPct} Z`}
              />
              <path
                d={`M ${rightEyeCx - rxPct} ${eyeCy - ryPct} Q ${rightEyeCx} ${
                  eyeCy + ryPct * 0.25
                } ${rightEyeCx + rxPct} ${eyeCy - ryPct} Z`}
              />
            </g>
          )}

          {emotion === 'thinking' && (
            /* Contemplative squint: slightly lowered upper eyelids */
            <g fill="#312E81" opacity="0.9">
              <path
                d={`M ${leftEyeCx - rxPct} ${eyeCy - ryPct} Q ${leftEyeCx} ${
                  eyeCy - ryPct * 0.1
                } ${leftEyeCx + rxPct} ${eyeCy - ryPct} Z`}
              />
              <path
                d={`M ${rightEyeCx - rxPct} ${eyeCy - ryPct} Q ${rightEyeCx} ${
                  eyeCy - ryPct * 0.1
                } ${rightEyeCx + rxPct} ${eyeCy - ryPct} Z`}
              />
            </g>
          )}

          {emotion === 'empathetic' && (
            /* Caring slant eyelids */
            <g fill="#312E81" opacity="0.85">
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
