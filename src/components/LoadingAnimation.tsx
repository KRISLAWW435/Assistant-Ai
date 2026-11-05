import React, { useEffect, useRef, useState } from 'react';

export const WARM_ANNA_PHRASES: string[] = [
  'Анна, вы сегодня молодец! Немного отдохните, я пока поработаю 💗',
  'Я уже занимаюсь вашей задачей. Можно пока выдохнуть ☺️',
  'Анна, мои алгоритмы сообщают: сегодня вы невероятно крутая! 💕',
  'Пока я думаю, у вас есть время на чашечку чая ☕',
  'Всё под контролем. Работаю над вашим результатом ✨',
  'Анна, не переживайте, я внимательно всё проверяю 💗',
  'Вы отдыхайте, а я пока включу свои нейронные извилины 😄',
  'Кажется, у меня получается что-то хорошее! Ещё немного ✨',
  'Анна, вдохновение уже в процессе, собираю лучший ответ 🌸',
  'Ещё чуточку терпения — полирую детали для вас 💫',
];

interface LoadingAnimationProps {
  elapsedSec?: number;
  variant?: 'compact' | 'full';
  className?: string;
  stageLabel?: string;
}

export const LoadingAnimation: React.FC<LoadingAnimationProps> = ({
  elapsedSec,
  variant = 'full',
  className = '',
  stageLabel,
}) => {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [opacity, setOpacity] = useState(1);
  const lastIndexRef = useRef(0);

  useEffect(() => {
    // Strictly switch phrase every 4000ms, never repeating the same phrase twice
    const interval = setInterval(() => {
      setOpacity(0);
      setTimeout(() => {
        let nextIndex: number;
        do {
          nextIndex = Math.floor(Math.random() * WARM_ANNA_PHRASES.length);
        } while (
          nextIndex === lastIndexRef.current &&
          WARM_ANNA_PHRASES.length > 1
        );

        lastIndexRef.current = nextIndex;
        setPhraseIndex(nextIndex);
        setOpacity(1);
      }, 350);
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  const currentPhrase = WARM_ANNA_PHRASES[phraseIndex];

  if (variant === 'compact') {
    return (
      <div
        className={`flex items-center gap-3 p-2.5 rounded-xl bg-white/95 text-slate-800 border border-slate-200/90 shadow-xs ${className}`}
      >
        {/* Circular Progress Spinner */}
        <div className="relative flex items-center justify-center w-6 h-6 shrink-0">
          <svg
            className="w-6 h-6 animate-spin text-[#00A8B5]"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-20"
              cx="12"
              cy="12"
              r="9"
              stroke="currentColor"
              strokeWidth="2.5"
            />
            <path
              className="opacity-90"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <p
            className="text-xs font-medium text-slate-700 transition-opacity duration-350 truncate"
            style={{ opacity }}
          >
            {currentPhrase}
          </p>
        </div>

        {typeof elapsedSec === 'number' && (
          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-mono font-semibold text-slate-600 shrink-0 border border-slate-200/80">
            {elapsedSec} с
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl p-4 bg-white/95 text-slate-900 border border-slate-200/90 shadow-sm relative overflow-hidden backdrop-blur-xs transition-all ${className}`}
    >
      <div className="relative z-10 flex items-center gap-3.5">
        {/* Soft Circular Spinner */}
        <div className="relative flex items-center justify-center w-10 h-10 shrink-0">
          <svg
            className="w-9 h-9 animate-spin text-[#00A8B5]"
            viewBox="0 0 36 36"
            fill="none"
          >
            <defs>
              <linearGradient
                id="spinnerGradient"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" stopColor="#00A8B5" stopOpacity="0.2" />
                <stop offset="50%" stopColor="#00A8B5" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#00808C" stopOpacity="1" />
              </linearGradient>
            </defs>
            <circle
              cx="18"
              cy="18"
              r="14"
              stroke="#E2E8F0"
              strokeWidth="3"
            />
            <path
              d="M18 4 A14 14 0 0 1 32 18"
              stroke="url(#spinnerGradient)"
              strokeWidth="3.2"
              strokeLinecap="round"
            />
          </svg>
          {/* Gentle center pulse */}
          <span className="absolute w-2 h-2 rounded-full bg-[#00A8B5] animate-ping opacity-60" />
          <span className="absolute w-2 h-2 rounded-full bg-[#00A8B5]" />
        </div>

        {/* Text Content */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#00A8B5] flex items-center gap-1.5">
              <span>{stageLabel || 'Обработка запроса'}</span>
            </span>
            {typeof elapsedSec === 'number' && (
              <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[11px] font-mono font-semibold text-slate-600 shrink-0">
                {elapsedSec} с
              </span>
            )}
          </div>

          <p
            className="text-xs font-medium text-slate-700 leading-relaxed transition-opacity duration-350"
            style={{ opacity }}
          >
            {currentPhrase}
          </p>
        </div>
      </div>
    </div>
  );
};
