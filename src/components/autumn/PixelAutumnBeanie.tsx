import React from 'react';

interface PixelAutumnBeanieProps {
  className?: string;
  style?: React.CSSProperties;
}

export const PixelAutumnBeanie: React.FC<PixelAutumnBeanieProps> = ({
  className = '',
  style,
}) => {
  return (
    <svg
      viewBox="0 0 100 86"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`overflow-visible select-none pointer-events-none drop-shadow-[0_3px_5px_rgba(15,23,42,0.22)] ${className}`}
      style={style}
      aria-hidden="true"
    >
      <defs>
        {/* Deep Royal/Cobalt Blue Knitted Dome Gradient */}
        <linearGradient id="beanieBlueKnitGrad" x1="18%" y1="0%" x2="82%" y2="100%">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="25%" stopColor="#2563EB" />
          <stop offset="70%" stopColor="#1D4ED8" />
          <stop offset="100%" stopColor="#1E3A8A" />
        </linearGradient>

        {/* Deep Blue Beanie Cuff Gradient */}
        <linearGradient id="beanieBlueCuffGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="20%" stopColor="#2563EB" />
          <stop offset="75%" stopColor="#1D4ED8" />
          <stop offset="100%" stopColor="#172554" />
        </linearGradient>

        {/* Contrast White / Ice-Blue Stripe Gradient */}
        <linearGradient id="beanieStripeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#E0F2FE" />
          <stop offset="50%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#E0F2FE" />
        </linearGradient>

        {/* Fluffy Vibrant Pink Pom-pom Radial Gradient */}
        <radialGradient id="pompomPinkGrad" cx="38%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#FFF1F2" />
          <stop offset="22%" stopColor="#F472B6" />
          <stop offset="65%" stopColor="#FB7185" />
          <stop offset="85%" stopColor="#E11D48" />
          <stop offset="100%" stopColor="#9F1239" />
        </radialGradient>
      </defs>

      {/* 1. SOFT REALISTIC DROP SHADOW ONTO PIXEL'S HEAD */}
      {/* Outer soft ambient shadow */}
      <ellipse
        cx="50"
        cy="75"
        rx="42"
        ry="6.5"
        fill="rgba(15, 23, 42, 0.22)"
      />
      {/* Darker contact shadow immediately beneath cuff edge */}
      <path
        d="M 9 70 Q 50 78 91 70 Q 50 82 9 70 Z"
        fill="rgba(15, 23, 42, 0.35)"
      />

      {/* 2. MAIN BEANIE DOME (Knitted Crown) */}
      <path
        d="M 14 64 C 13 35 28 22 50 22 C 72 22 87 35 86 64 Z"
        fill="url(#beanieBlueKnitGrad)"
      />

      {/* Vertical curved knit panel seams (Рельефные вязаные швы) */}
      <path
        d="M 30 63 C 30 42 38 28 49 22"
        stroke="#1E3A8A"
        strokeWidth="1"
        strokeDasharray="2.5 1.5"
        fill="none"
        opacity="0.6"
      />
      <path
        d="M 70 63 C 70 42 62 28 51 22"
        stroke="#1E3A8A"
        strokeWidth="1"
        strokeDasharray="2.5 1.5"
        fill="none"
        opacity="0.6"
      />
      <path
        d="M 50 64 L 50 22"
        stroke="#172554"
        strokeWidth="0.8"
        strokeDasharray="2 2"
        fill="none"
        opacity="0.45"
      />

      {/* Soft wool highlight on left curve */}
      <path
        d="M 24 34 C 32 26 42 24 50 24 C 40 27 30 36 26 44 Z"
        fill="#93C5FD"
        opacity="0.32"
      />

      {/* 3. BEANIE CUFF (Отворот шапки с контрастной светлой полоской и резинкой) */}
      {/* Main cuff body */}
      <path
        d="M 8 58 Q 50 65 92 58 C 94 63 94 68 91 72 Q 50 80 9 72 C 6 68 6 63 8 58 Z"
        fill="url(#beanieBlueCuffGrad)"
        stroke="#1E3A8A"
        strokeWidth="0.75"
      />

      {/* White / Soft Ice-Blue Contrast Stripe across cuff (Светлая полоска) */}
      <path
        d="M 8.5 63.5 Q 50 70.5 91.5 63.5 C 91.8 65.5 91.6 67.5 90.5 68.5 Q 50 75.5 9.5 68.5 C 8.4 67.5 8.2 65.5 8.5 63.5 Z"
        fill="url(#beanieStripeGrad)"
        opacity="0.95"
      />

      {/* Top rolled edge highlight of cuff */}
      <path
        d="M 8 58 Q 50 65 92 58"
        stroke="#93C5FD"
        strokeWidth="1.3"
        strokeLinecap="round"
        fill="none"
        opacity="0.85"
      />

      {/* Ribbed knit texture lines (Вертикальные полоски рельефной резинки) */}
      {[
        { x: 16, y1: 59, y2: 70 },
        { x: 22, y1: 60, y2: 72 },
        { x: 28, y1: 61, y2: 74 },
        { x: 34, y1: 62, y2: 75.5 },
        { x: 40, y1: 63, y2: 76.5 },
        { x: 46, y1: 63.5, y2: 77 },
        { x: 54, y1: 63.5, y2: 77 },
        { x: 60, y1: 63, y2: 76.5 },
        { x: 66, y1: 62, y2: 75.5 },
        { x: 72, y1: 61, y2: 74 },
        { x: 78, y1: 60, y2: 72 },
        { x: 84, y1: 59, y2: 70 },
      ].map((rib, idx) => (
        <g key={`rib-${idx}`}>
          {/* Shadow line */}
          <line
            x1={rib.x}
            y1={rib.y1}
            x2={rib.x}
            y2={rib.y2}
            stroke="#172554"
            strokeWidth="0.9"
            strokeLinecap="round"
            opacity="0.55"
          />
          {/* Highlight line */}
          <line
            x1={rib.x + 0.8}
            y1={rib.y1}
            x2={rib.x + 0.8}
            y2={rib.y2}
            stroke="#93C5FD"
            strokeWidth="0.7"
            strokeLinecap="round"
            opacity="0.6"
          />
        </g>
      ))}

      {/* 4. EXTRA FLUFFY BRIGHT-PINK POM-POM (Пышный ярко-розовый помпон) */}
      <g
        className="autumn-pompom-anim"
        style={{ transformOrigin: '50px 22px' }}
      >
        {/* Stitched connection knot at crown */}
        <ellipse cx="50" cy="22" rx="4" ry="2.2" fill="#1E3A8A" />

        {/* Soft shadow cast by pom-pom onto crown */}
        <ellipse cx="50" cy="21" rx="7" ry="2.8" fill="rgba(15, 23, 42, 0.3)" />

        {/* Outer Fluffy Yarn Tufts Layer (Множество пушистых завитков по контуру) */}
        <circle cx="41" cy="7" r="4.2" fill="#FB7185" />
        <circle cx="46" cy="4" r="4.5" fill="#FDA4AF" />
        <circle cx="51" cy="3.5" r="4.6" fill="#FDF2F8" />
        <circle cx="56" cy="4" r="4.5" fill="#FDA4AF" />
        <circle cx="61" cy="7" r="4.3" fill="#FB7185" />
        <circle cx="63.5" cy="12" r="4.6" fill="#F472B6" />
        <circle cx="61.5" cy="17" r="4.4" fill="#E11D48" />
        <circle cx="56" cy="19.5" r="4.6" fill="#BE123C" />
        <circle cx="50" cy="20" r="4.6" fill="#BE123C" />
        <circle cx="44" cy="19.5" r="4.6" fill="#BE123C" />
        <circle cx="38.5" cy="17" r="4.4" fill="#E11D48" />
        <circle cx="36.5" cy="12" r="4.6" fill="#F472B6" />

        {/* Mid-layer fluffy filler tufts for extra volume */}
        <circle cx="43" cy="10" r="4.8" fill="#FDA4AF" />
        <circle cx="57" cy="10" r="4.8" fill="#F472B6" />
        <circle cx="44" cy="15" r="4.8" fill="#FB7185" />
        <circle cx="56" cy="15" r="4.8" fill="#FB7185" />

        {/* Main central fluffy pom-pom body */}
        <circle cx="50" cy="12" r="10" fill="url(#pompomPinkGrad)" />

        {/* Fine fluffy yarn strands & highlights */}
        <path
          d="M 45 7 Q 49 5 53 7"
          stroke="#FFFFFF"
          strokeWidth="0.9"
          strokeLinecap="round"
          fill="none"
          opacity="0.85"
        />
        <path
          d="M 43 11 Q 48 9 53 11"
          stroke="#FFFFFF"
          strokeWidth="0.85"
          strokeLinecap="round"
          fill="none"
          opacity="0.8"
        />
        <path
          d="M 47 14 Q 51 13 55 14"
          stroke="#FDF2F8"
          strokeWidth="0.8"
          strokeLinecap="round"
          fill="none"
          opacity="0.75"
        />
        <circle cx="47" cy="9.5" r="3.2" fill="#FFFFFF" opacity="0.4" />
      </g>
    </svg>
  );
};
