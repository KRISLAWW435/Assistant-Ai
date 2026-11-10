import React from 'react';

interface BulbConfig {
  x: number;
  y: number;
  color: string;
  glow: string;
  delay: string;
  duration: string;
  size: number;
}

const BULBS: BulbConfig[] = [
  { x: 50, y: 22, color: '#F59E0B', glow: '#F59E0B', delay: '0s', duration: '2.6s', size: 6 },
  { x: 150, y: 24, color: '#EA580C', glow: '#EA580C', delay: '1.2s', duration: '3.1s', size: 6.5 },
  { x: 250, y: 22, color: '#FBBF24', glow: '#FBBF24', delay: '0.5s', duration: '2.4s', size: 6 },
  { x: 350, y: 23, color: '#D97706', glow: '#D97706', delay: '1.8s', duration: '2.9s', size: 6 },
  { x: 450, y: 24, color: '#FB923C', glow: '#FB923C', delay: '0.3s', duration: '3.2s', size: 6.5 },
  { x: 550, y: 22, color: '#F59E0B', glow: '#F59E0B', delay: '1.5s', duration: '2.7s', size: 6 },
  { x: 650, y: 23, color: '#EA580C', glow: '#EA580C', delay: '0.8s', duration: '2.5s', size: 6.5 },
  { x: 750, y: 24, color: '#FBBF24', glow: '#FBBF24', delay: '2.1s', duration: '3.0s', size: 6 },
  { x: 850, y: 22, color: '#F97316', glow: '#F97316', delay: '0.4s', duration: '2.8s', size: 6 },
  { x: 950, y: 23, color: '#F59E0B', glow: '#F59E0B', delay: '1.6s', duration: '3.1s', size: 6.5 },
  { x: 1050, y: 24, color: '#EA580C', glow: '#EA580C', delay: '0.9s', duration: '2.6s', size: 6 },
  { x: 1150, y: 22, color: '#FBBF24', glow: '#FBBF24', delay: '1.9s', duration: '2.9s', size: 6 },
];

export const AutumnGarland: React.FC = () => {
  return (
    <div
      className="w-full pointer-events-none select-none overflow-hidden -mb-2 z-10 transition-opacity duration-500 ease-in-out"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 1200 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-8 sm:h-9"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="garlandWire" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#78350F" stopOpacity="0.25" />
            <stop offset="50%" stopColor="#92400E" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#78350F" stopOpacity="0.25" />
          </linearGradient>
        </defs>

        {/* Wavy hanging wire */}
        <path
          d="M 0 8 Q 50 22, 100 10 Q 150 24, 200 9 Q 250 22, 300 10 Q 350 23, 400 9 Q 450 24, 500 10 Q 550 22, 600 8 Q 650 23, 700 10 Q 750 24, 800 9 Q 850 22, 900 10 Q 950 23, 1000 9 Q 1050 24, 1100 10 Q 1150 22, 1200 8"
          stroke="url(#garlandWire)"
          strokeWidth="1.25"
          fill="none"
        />

        {/* Bulbs and sockets */}
        {BULBS.map((bulb, i) => (
          <g key={i}>
            {/* Small socket cap */}
            <rect
              x={bulb.x - 2}
              y={bulb.y - 4}
              width="4"
              height="4"
              rx="1"
              fill="#52525B"
              opacity="0.8"
            />
            {/* Hanging wire link */}
            <line
              x1={bulb.x}
              y1={bulb.y - 6}
              x2={bulb.x}
              y2={bulb.y - 2}
              stroke="#71717A"
              strokeWidth="1"
            />
            {/* Glowing Bulb */}
            <circle
              cx={bulb.x}
              cy={bulb.y + 3}
              r={bulb.size}
              fill={bulb.color}
              className="garland-bulb-glow"
              style={
                {
                  '--bulb-glow': bulb.glow,
                  animationDelay: bulb.delay,
                  animationDuration: bulb.duration,
                } as React.CSSProperties
              }
            />
            {/* Inner bright highlight filament */}
            <circle
              cx={bulb.x - 1.2}
              cy={bulb.y + 1.8}
              r={bulb.size * 0.35}
              fill="#FFFFFF"
              opacity="0.75"
            />
          </g>
        ))}
      </svg>
    </div>
  );
};
