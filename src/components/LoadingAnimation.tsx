import React, { useEffect, useState } from 'react';

const LOADING_PHRASES: string[] = [
  'Работаю над вашей задачей, не отвлекайте... шучу, отдыхайте!',
  'Секундочку, я изучаю материалы...',
  'Анализирую картинки, чтобы всё было идеально!',
  'Собираю мысли в кучу...',
  'Ещё чуть-чуть, и будет готово!',
  'Мозговой штурм в самом разгаре...',
  'Проверяю каждый слайд, чтобы ничего не упустить.',
];

interface LoadingAnimationProps {
  elapsedSec?: number;
  variant?: 'compact' | 'full';
  className?: string;
}

export const LoadingAnimation: React.FC<LoadingAnimationProps> = ({
  elapsedSec,
  variant = 'full',
  className = '',
}) => {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setPhraseIndex((prev) => (prev + 1) % LOADING_PHRASES.length);
        setFade(true);
      }, 300);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  if (variant === 'compact') {
    return (
      <div
        className={`flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/90 text-slate-100 border border-slate-700/60 shadow-lg ${className}`}
      >
        {/* Animated neural / pulsing dots */}
        <div className="relative flex items-center justify-center w-6 h-6 shrink-0">
          <span className="absolute w-5 h-5 rounded-full bg-[#00A8B5]/30 animate-ping" />
          <span className="relative w-2.5 h-2.5 rounded-full bg-[#00A8B5] shadow-[0_0_8px_#00A8B5]" />
        </div>

        <div className="flex-1 min-w-0">
          <p
            className={`text-xs font-medium text-slate-200 transition-opacity duration-300 truncate ${
              fade ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {LOADING_PHRASES[phraseIndex]}
          </p>
        </div>

        {typeof elapsedSec === 'number' && (
          <span className="px-2 py-0.5 rounded-md bg-slate-800 text-[10px] font-mono font-semibold text-[#00A8B5] shrink-0 border border-slate-700/50">
            {elapsedSec} с
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl p-4 bg-slate-900/95 text-slate-100 border border-slate-800 shadow-xl space-y-3 relative overflow-hidden backdrop-blur-md ${className}`}
    >
      {/* Background Neural Network / Wave Glow */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#00A8B5]/10 via-purple-500/10 to-[#FFD700]/10 pointer-events-none animate-pulse" />

      <div className="relative z-10 flex items-center gap-3.5">
        {/* Animated Wave / Neural Nodes Container */}
        <div className="relative flex items-center justify-center w-10 h-10 shrink-0">
          {/* Outer glowing pulsing ring */}
          <span className="absolute inset-0 rounded-xl bg-[#00A8B5]/20 animate-ping opacity-75" />
          <span className="absolute inset-1 rounded-lg bg-gradient-to-br from-[#00A8B5] to-indigo-600 opacity-30 blur-xs animate-pulse" />

          {/* Neural nodes grid */}
          <div className="relative grid grid-cols-2 gap-1 p-2">
            <span className="w-2 h-2 rounded-full bg-[#00A8B5] animate-bounce [animation-delay:-0.3s] shadow-[0_0_6px_#00A8B5]" />
            <span className="w-2 h-2 rounded-full bg-[#FFD700] animate-bounce [animation-delay:-0.15s] shadow-[0_0_6px_#FFD700]" />
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce [animation-delay:-0.45s] shadow-[0_0_6px_#34d399]" />
            <span className="w-2 h-2 rounded-full bg-cyan-300 animate-bounce shadow-[0_0_6px_#67e8f9]" />
          </div>
        </div>

        {/* Text Content */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#00A8B5]">
              Генерация ответа
            </span>
            {typeof elapsedSec === 'number' && (
              <span className="px-2 py-0.5 rounded-lg bg-slate-800/80 border border-slate-700/80 text-[11px] font-mono font-bold text-[#00A8B5] shrink-0">
                {elapsedSec} с
              </span>
            )}
          </div>

          <p
            className={`text-xs font-semibold text-slate-100 leading-relaxed transition-all duration-300 ${
              fade ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'
            }`}
          >
            {LOADING_PHRASES[phraseIndex]}
          </p>
        </div>
      </div>

      {/* Pulsing Wave Bar at the bottom */}
      <div className="relative w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-[#00A8B5] via-[#FFD700] to-emerald-400 rounded-full animate-[shimmer_2s_infinite] shadow-[0_0_10px_#00A8B5]" />
      </div>
    </div>
  );
};
