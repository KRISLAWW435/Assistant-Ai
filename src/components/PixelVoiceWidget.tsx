/**
 * Compact Persistent Pixel Voice Widget (Stage 6.1).
 * Displays constant voice state across all routes without full-screen modal blocking.
 *
 * Shows:
 * - Current mode (OFF / STANDBY / LIVE)
 * - Microphone state (active, muted, off)
 * - Speaking indicator (when Pixel speaks)
 * - Listening indicator (when user speaks / Pixel listens)
 * - Pause / Resume button
 * - Mute button
 * - Open Pixel text chat button
 * - Open Fullscreen Live Modal button (on manual demand)
 */

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Eye,
  Headphones,
  Maximize2,
  MessageCircleHeart,
  Mic,
  MicOff,
  Pause,
  Play,
  Radio,
  Sliders,
  Sparkles,
  Square,
  Volume2,
} from 'lucide-react';
import {
  CoordinatorSnapshot,
  pixelVoiceCoordinator,
} from '../providers/voice/pixelVoiceCoordinator';
import { LIVE_VOICE_STATE_META } from '../types/voice';
import { PixelCharacter } from './pixel';

interface PixelVoiceWidgetProps {
  onOpenPixelChat: () => void;
  onOpenFullscreenModal: () => void;
  onOpenSettings?: () => void;
}

export const PixelVoiceWidget: React.FC<PixelVoiceWidgetProps> = ({
  onOpenPixelChat,
  onOpenFullscreenModal,
  onOpenSettings,
}) => {
  const [snapshot, setSnapshot] = useState<CoordinatorSnapshot>(() =>
    pixelVoiceCoordinator.getSnapshot()
  );

  useEffect(() => {
    return pixelVoiceCoordinator.onStateChange((next) => {
      setSnapshot(next);
    });
  }, []);

  const { mode, liveState, isMicMuted, isPaused, sessionElapsedSec } = snapshot;

  const formatElapsed = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const isModelSpeaking = liveState === 'speaking';
  const isListening = liveState === 'listening';
  const isThinking = liveState === 'thinking';

  // Render compact widget based on mode
  if (mode === 'OFF') {
    return (
      <div className="fixed bottom-24 right-6 z-40 animate-in fade-in slide-in-from-bottom-2 duration-200">
        <div className="flex items-center gap-1.5 p-1 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200 shadow-md text-slate-700 text-xs select-none">
          <button
            type="button"
            onClick={() => void pixelVoiceCoordinator.setMode('STANDBY')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
            title="Включить голосовое ожидание «Пиксель»"
          >
            <MicOff className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-medium text-[11px]">Голос выкл.</span>
          </button>

          <div className="w-px h-3.5 bg-slate-200" />

          <button
            type="button"
            onClick={() => void pixelVoiceCoordinator.setMode('LIVE')}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition-colors text-[11px] font-semibold cursor-pointer shadow-2xs"
            title="Начать голосовой диалог с Пикселем"
          >
            <Mic className="w-3 h-3 text-[#FFD700]" />
            <span>В эфир</span>
          </button>

          <button
            type="button"
            onClick={onOpenPixelChat}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
            title="Открыть текстовый чат с Пикселем"
            aria-label="Текстовый чат"
          >
            <MessageCircleHeart className="w-3.5 h-3.5 text-[#00A8B5]" />
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'STANDBY') {
    return (
      <div className="fixed bottom-24 right-6 z-40 animate-in fade-in slide-in-from-bottom-2 duration-200">
        <div className="flex items-center gap-1.5 p-1 bg-white/95 backdrop-blur-md rounded-2xl border border-emerald-200 shadow-md text-slate-800 text-xs select-none">
          {/* Standby Indicator */}
          <button
            type="button"
            onClick={() => void pixelVoiceCoordinator.setMode('OFF')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
            title="Ожидание фразы «Пиксель». Нажмите, чтобы выключить."
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="font-semibold text-[11px] text-emerald-800">
              Ожидает: «Пиксель»
            </span>
          </button>

          <div className="w-px h-3.5 bg-slate-200" />

          {/* Quick Start Live Button */}
          <button
            type="button"
            onClick={() => void pixelVoiceCoordinator.startLive()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-gradient-to-r from-[#00A8B5] to-[#165B73] hover:from-[#00929d] hover:to-[#124d62] text-white shadow-2xs text-[11px] font-bold transition-all cursor-pointer"
            title="Начать говорить прямо сейчас (без ключевого слова)"
          >
            <Mic className="w-3 h-3 text-[#FFD700]" />
            <span>Поговорить</span>
          </button>

          {/* Open Text Chat Button */}
          <button
            type="button"
            onClick={onOpenPixelChat}
            className="p-1.5 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
            title="Открыть текстовый чат с Пикселем"
            aria-label="Текстовый чат"
          >
            <MessageCircleHeart className="w-3.5 h-3.5 text-[#00A8B5]" />
          </button>
        </div>
      </div>
    );
  }

  // mode === 'LIVE' (Full Interactive Spoken Dialogue)
  return (
    <div className="fixed bottom-24 right-6 z-40 animate-in fade-in slide-in-from-bottom-3 duration-200">
      <div className="flex items-center gap-2 p-1.5 bg-slate-950/95 backdrop-blur-md rounded-2xl border border-cyan-500/40 shadow-xl text-white text-xs select-none">
        {/* Status Indicator with animated Pixel character */}
        <div className="flex items-center gap-2 pl-1.5 pr-1">
          <div className="shrink-0 flex items-center justify-center">
            <PixelCharacter
              size={32}
              showAura={false}
              interactive={false}
              isSpeaking={isModelSpeaking}
              isListening={isListening}
              isThinking={isThinking}
            />
          </div>

          <div className="flex flex-col min-w-0 pr-1">
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-[11px] text-cyan-300 tracking-wide uppercase">
                {isModelSpeaking
                  ? 'Пиксель говорит'
                  : isListening
                    ? 'Слушаю вас...'
                    : isThinking
                      ? 'Думает...'
                      : isPaused
                        ? 'Пауза'
                        : 'В эфире'}
              </span>
              <span className="text-[10px] font-mono-tabular text-slate-400">
                {formatElapsed(sessionElapsedSec)}
              </span>
            </div>
            {isMicMuted && (
              <span className="text-[9px] text-rose-300 font-semibold">
                Микрофон заглушён
              </span>
            )}
          </div>
        </div>

        <div className="w-px h-5 bg-white/15" />

        {/* Live Controls */}
        <div className="flex items-center gap-1">
          {/* Pause / Resume */}
          <button
            type="button"
            onClick={() => pixelVoiceCoordinator.togglePause()}
            className={`p-1.5 rounded-xl transition-colors cursor-pointer ${
              isPaused
                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
            title={isPaused ? 'Возобновить разговор' : 'Приостановить разговор'}
            aria-label="Пауза"
          >
            {isPaused ? (
              <Play className="w-3.5 h-3.5 fill-current" />
            ) : (
              <Pause className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Mute Mic */}
          <button
            type="button"
            onClick={() => pixelVoiceCoordinator.toggleMute()}
            className={`p-1.5 rounded-xl transition-colors cursor-pointer ${
              isMicMuted
                ? 'bg-rose-500 text-white hover:bg-rose-600'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
            title={isMicMuted ? 'Включить микрофон' : 'Заглушить микрофон'}
            aria-label="Микрофон"
          >
            {isMicMuted ? (
              <MicOff className="w-3.5 h-3.5" />
            ) : (
              <Mic className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Open Text Chat */}
          <button
            type="button"
            onClick={onOpenPixelChat}
            className="p-1.5 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Открыть текстовый диалог с Пикселем (разговор не прерывается)"
            aria-label="Текстовый диалог"
          >
            <MessageCircleHeart className="w-3.5 h-3.5 text-[#00A8B5]" />
          </button>

          {/* Maximize to Fullscreen Modal */}
          <button
            type="button"
            onClick={onOpenFullscreenModal}
            className="p-1.5 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Развернуть большой голосовой экран со сферой и расшифровкой"
            aria-label="Полноэкранный режим"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          {/* Finish Live Session Button */}
          <button
            type="button"
            onClick={() => void pixelVoiceCoordinator.stopLive(true)}
            className="p-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white transition-colors cursor-pointer ml-0.5"
            title="Завершить разговор (возврат в режим ожидания)"
            aria-label="Завершить"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
        </div>
      </div>
    </div>
  );
};
