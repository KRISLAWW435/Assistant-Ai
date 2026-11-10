import React from 'react';

export const CozyTeaCup: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center select-none pointer-events-none">
      <div className="relative w-24 h-20 flex items-center justify-center">
        {/* Steam Wisps */}
        <div className="absolute top-0 left-7 flex items-center gap-1.5 z-10">
          <svg
            className="w-3.5 h-6 autumn-steam-anim text-amber-500/60"
            viewBox="0 0 14 24"
            fill="none"
            style={{ animationDelay: '0s' }}
          >
            <path
              d="M 7 22 Q 3 16, 8 10 Q 12 4, 7 0"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
          <svg
            className="w-3.5 h-6 autumn-steam-anim text-amber-600/70"
            viewBox="0 0 14 24"
            fill="none"
            style={{ animationDelay: '0.9s', animationDuration: '3.1s' }}
          >
            <path
              d="M 6 22 Q 11 15, 6 9 Q 2 3, 7 0"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <svg
            className="w-3 h-5 autumn-steam-anim text-orange-400/50"
            viewBox="0 0 14 24"
            fill="none"
            style={{ animationDelay: '1.7s', animationDuration: '2.6s' }}
          >
            <path
              d="M 7 20 Q 3 14, 8 8 Q 11 3, 7 0"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* Ceramic Mug & Saucer SVG */}
        <svg
          viewBox="0 0 88 56"
          className="w-20 h-14 mt-4 drop-shadow-xs"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Saucer */}
          <ellipse
            cx="40"
            cy="50"
            rx="34"
            ry="4.5"
            fill="#FED7AA"
            stroke="#EA580C"
            strokeWidth="1"
            opacity="0.85"
          />

          {/* Cup Body */}
          <path
            d="M 18 18 L 22 46 C 22 48.5, 27 50, 40 50 C 53 50, 58 48.5, 58 46 L 62 18 Z"
            fill="url(#mugGradient)"
            stroke="#D97706"
            strokeWidth="1.2"
          />

          {/* Cup Rim */}
          <ellipse
            cx="40"
            cy="18"
            rx="22"
            ry="4.5"
            fill="#FEF3C7"
            stroke="#D97706"
            strokeWidth="1.2"
          />

          {/* Tea Surface */}
          <ellipse
            cx="40"
            cy="19"
            rx="19"
            ry="3.5"
            fill="#B45309"
            opacity="0.9"
          />
          {/* Tea Reflection */}
          <ellipse
            cx="37"
            cy="18.5"
            rx="11"
            ry="1.8"
            fill="#F59E0B"
            opacity="0.6"
          />

          {/* Mug Handle */}
          <path
            d="M 59 23 C 68 23, 72 32, 67 39 C 63 44, 57 41, 57 41"
            stroke="#D97706"
            strokeWidth="3.2"
            strokeLinecap="round"
            fill="none"
          />

          {/* Little Cinnamon Stick on the right */}
          <line
            x1="48"
            y1="12"
            x2="59"
            y2="3"
            stroke="#78350F"
            strokeWidth="2.5"
            strokeLinecap="round"
          />

          {/* Gradients */}
          <defs>
            <linearGradient id="mugGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFF7ED" />
              <stop offset="60%" stopColor="#FFEDD5" />
              <stop offset="100%" stopColor="#FED7AA" />
            </linearGradient>
          </defs>
        </svg>

        {/* Little maple leaf next to cup */}
        <span
          className="absolute -bottom-1 -right-2 text-base rotate-12 select-none"
          role="img"
          aria-label="Осенний лист"
        >
          🍂
        </span>
      </div>

      {/* Text badge with leaf and ghost accents */}
      <div className="mt-2.5 flex items-center justify-center gap-1.5 bg-amber-50/90 px-3.5 py-1.5 rounded-full border border-amber-200/80 shadow-2xs">
        <span className="text-xs select-none" role="img" aria-label="Листик">🍁</span>
        <p className="text-xs font-bold text-amber-950 tracking-wide text-center">
          Уютная осенняя пауза с чашкой чая ☕
        </p>
        <span className="text-xs select-none opacity-80" role="img" aria-label="Призрак">👻</span>
      </div>
    </div>
  );
};
