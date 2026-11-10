import React from 'react';

interface LampConfig {
  id: number;
  color: string;
  glow: string;
  glowSoft: string;
  swingDelay: string;
  swingDuration: string;
  glowDelay: string;
  glowDuration: string;
}

const LAMPS: LampConfig[] = [
  { id: 1, color: '#F59E0B', glow: 'rgba(245, 158, 11, 0.95)', glowSoft: 'rgba(253, 230, 138, 0.65)', swingDelay: '0s', swingDuration: '4.2s', glowDelay: '0.2s', glowDuration: '2.6s' },
  { id: 2, color: '#EA580C', glow: 'rgba(234, 88, 12, 0.95)', glowSoft: 'rgba(253, 186, 116, 0.65)', swingDelay: '1.2s', swingDuration: '4.6s', glowDelay: '1.4s', glowDuration: '3.1s' },
  { id: 3, color: '#FBBF24', glow: 'rgba(251, 191, 36, 0.95)', glowSoft: 'rgba(254, 240, 138, 0.65)', swingDelay: '0.5s', swingDuration: '4.0s', glowDelay: '0.7s', glowDuration: '2.4s' },
  { id: 4, color: '#D97706', glow: 'rgba(217, 119, 6, 0.95)', glowSoft: 'rgba(252, 211, 77, 0.65)', swingDelay: '1.8s', swingDuration: '4.5s', glowDelay: '2.1s', glowDuration: '3.3s' },
  { id: 5, color: '#FB923C', glow: 'rgba(251, 146, 60, 0.95)', glowSoft: 'rgba(254, 215, 170, 0.65)', swingDelay: '0.3s', swingDuration: '4.3s', glowDelay: '0.4s', glowDuration: '2.8s' },
  { id: 6, color: '#F59E0B', glow: 'rgba(245, 158, 11, 0.95)', glowSoft: 'rgba(253, 230, 138, 0.65)', swingDelay: '1.5s', swingDuration: '4.1s', glowDelay: '1.8s', glowDuration: '2.9s' },
  { id: 7, color: '#EA580C', glow: 'rgba(234, 88, 12, 0.95)', glowSoft: 'rgba(253, 186, 116, 0.65)', swingDelay: '0.8s', swingDuration: '4.7s', glowDelay: '0.9s', glowDuration: '3.2s' },
  { id: 8, color: '#FBBF24', glow: 'rgba(251, 191, 36, 0.95)', glowSoft: 'rgba(254, 240, 138, 0.65)', swingDelay: '2.0s', swingDuration: '4.2s', glowDelay: '2.5s', glowDuration: '2.7s' },
  { id: 9, color: '#F97316', glow: 'rgba(249, 115, 22, 0.95)', glowSoft: 'rgba(254, 215, 170, 0.65)', swingDelay: '0.6s', swingDuration: '4.4s', glowDelay: '1.2s', glowDuration: '3.0s' },
  { id: 10, color: '#F59E0B', glow: 'rgba(245, 158, 11, 0.95)', glowSoft: 'rgba(253, 230, 138, 0.65)', swingDelay: '1.7s', swingDuration: '4.3s', glowDelay: '0.5s', glowDuration: '2.5s' },
];

export const AutumnGarland: React.FC = () => {
  return (
    <div
      className="relative z-20 w-full pointer-events-none select-none overflow-visible pt-1 pb-2 transition-opacity duration-500 ease-in-out"
      aria-hidden="true"
    >
      {/* 1. Main Garland Wire (Stylized Cable with subtle gradient) */}
      <div className="absolute inset-x-2 sm:inset-x-4 top-[7px] h-[1.5px] bg-gradient-to-r from-stone-400/30 via-stone-600/75 to-stone-400/30 dark:from-stone-600/30 dark:via-stone-400/60 dark:to-stone-600/30 rounded-full" />

      {/* Wall anchor pins at the ends */}
      <div className="absolute left-1 sm:left-3 top-[5px] w-2 h-2 rounded-full bg-stone-700/80 dark:bg-stone-500/80 shadow-xs flex-shrink-0" />
      <div className="absolute right-1 sm:right-3 top-[5px] w-2 h-2 rounded-full bg-stone-700/80 dark:bg-stone-500/80 shadow-xs flex-shrink-0" />

      {/* 2. Hanging Lamps distributed evenly across width */}
      <div className="relative flex justify-between items-start px-3 sm:px-6 w-full">
        {LAMPS.map((lamp) => (
          <div
            key={lamp.id}
            className="flex flex-col items-center flex-shrink-0 garland-lamp-swing"
            style={{
              animationDelay: lamp.swingDelay,
              animationDuration: lamp.swingDuration,
            }}
          >
            {/* Cable clip on the wire */}
            <div className="w-1.5 h-1.5 rounded-full bg-stone-800 dark:bg-stone-600 flex-shrink-0 -mb-[1px] shadow-xs" />

            {/* Drop cord */}
            <div className="w-[1.5px] h-2 sm:h-2.5 bg-stone-700 dark:bg-stone-600 flex-shrink-0" />

            {/* Lamp socket (Патрон) */}
            <div className="w-2.5 h-1.5 bg-stone-800 dark:bg-stone-700 rounded-t-xs flex-shrink-0 border-b border-stone-900/50" />

            {/* Bulb (Лампочка: strictly fixed size w-3.5 h-3.5 sm:w-4 sm:h-4, flex-shrink-0, perfectly round with pulseGlow) */}
            <div
              className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full flex-shrink-0 garland-bulb-pulse relative overflow-hidden transition-transform"
              style={
                {
                  backgroundColor: lamp.color,
                  '--glow-color': lamp.glow,
                  '--glow-soft': lamp.glowSoft,
                  animationDelay: lamp.glowDelay,
                  animationDuration: lamp.glowDuration,
                } as React.CSSProperties
              }
            >
              {/* Delicate specular glass gleam */}
              <div className="absolute top-[2px] left-[3px] w-1 h-1 bg-white/70 rounded-full blur-[0.2px]" />
              {/* Internal warm filament glow */}
              <div className="absolute inset-1 rounded-full bg-white/25 blur-[1px]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
