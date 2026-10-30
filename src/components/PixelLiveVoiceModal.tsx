/**
 * Standalone Screen for Live Real-Time Voice Conversation with Pixel.
 * Features:
 * - Large expressive organic animated audio sphere with distinct states (Listening, Thinking, Speaking, Interrupted)
 * - True bidirectional spoken conversation (Gemini Live API gemini-3.8-live / 16kHz PCM in / 24kHz PCM out)
 * - Instant user barge-in (interruption halts model playback immediately)
 * - Live synchronized speech transcripts (user and Pixel)
 * - Mute, Pause/Resume, and Finish Conversation controls
 * - Auto-saving conversation turns to Pixel's permanent history upon session completion
 * - Strict school isolation and memory/task grounding
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Headphones,
  Info,
  Loader2,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import {
  CompanionMemoryRecord,
  CompanionMessage,
  CompanionTaskRecord,
  SchoolId,
} from '../types/assistant';
import { SCHOOLS } from '../config/schoolsAndModes';
import {
  geminiLiveClient,
  LiveTranscriptEntry,
} from '../providers/voice/geminiLiveClient';
import {
  GEMINI_LIVE_VOICES,
  LIVE_VOICE_STATE_META,
  LiveVoiceState,
} from '../types/voice';
import { voiceManager } from '../providers/voice/voiceManager';

import { wakeWordManager } from '../providers/voice/wakeWordManager';

interface PixelLiveVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeSchool: SchoolId;
  companionMemory: CompanionMemoryRecord[];
  companionTasks: CompanionTaskRecord[];
  companionMessages: CompanionMessage[];
  onAppendCompanionMessages: (messages: CompanionMessage[]) => Promise<void>;
  onOpenSettings: () => void;
  triggeredByWakeWord?: boolean;
}

export const PixelLiveVoiceModal: React.FC<PixelLiveVoiceModalProps> = ({
  isOpen,
  onClose,
  activeSchool,
  companionMemory,
  companionTasks,
  companionMessages,
  onAppendCompanionMessages,
  onOpenSettings,
  triggeredByWakeWord = false,
}) => {
  const [liveState, setLiveState] = useState<LiveVoiceState>('idle');
  const [stateDetail, setStateDetail] = useState<string>('');
  const [transcripts, setTranscripts] = useState<LiveTranscriptEntry[]>([]);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<string>(() => {
    return voiceManager.getSettings().selectedLiveVoice || 'Kore';
  });
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [sessionElapsedSec, setSessionElapsedSec] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const transcriptsEndRef = useRef<HTMLDivElement | null>(null);
  const initialTurnsCountRef = useRef(0);

  const schoolConfig = SCHOOLS[activeSchool];
  const stateMeta = LIVE_VOICE_STATE_META[liveState];

  // Auto-scroll transcript container on new entries
  useEffect(() => {
    if (transcriptsEndRef.current) {
      transcriptsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcripts]);

  // Session timer
  useEffect(() => {
    if (!isOpen || liveState === 'idle' || liveState === 'error') {
      return;
    }
    const timer = setInterval(() => {
      if (sessionStartTime) {
        setSessionElapsedSec(
          Math.floor((Date.now() - sessionStartTime) / 1000)
        );
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen, liveState, sessionStartTime]);

  // Initialize live session when modal opens
  useEffect(() => {
    if (!isOpen) return;

    // Immediately pause standby wake word listener to free the audio input device cleanly
    wakeWordManager.pauseForLiveMode();

    let isMounted = true;
    initialTurnsCountRef.current = 0;
    setErrorMessage(null);
    setSessionStartTime(Date.now());
    setSessionElapsedSec(0);
    setIsMicMuted(false);
    setIsPaused(false);

    // Filter relevant memories for the active school or shared personal preferences
    const relevantMemories = companionMemory
      .filter((m) => !m.schoolId || m.schoolId === activeSchool)
      .slice(0, 8)
      .map((m) => ({
        id: m.id,
        category: m.category,
        title: m.title,
        content: m.content,
      }));

    // Filter active tasks
    const activeTasks = companionTasks
      .filter((t) => t.status !== 'done')
      .slice(0, 8)
      .map((t) => ({
        id: t.id,
        title: t.title,
        dueDate: t.dueDate || '',
        priority: t.priority,
        status: t.status,
      }));

    // Start Live Client session with initial greeting if triggered by wake word
    geminiLiveClient
      .startSession({
        schoolId: activeSchool,
        voiceName: selectedVoice,
        initialWakeGreeting: Boolean(triggeredByWakeWord),
        pixelContext: {
          activeSchool,
          schoolName: schoolConfig.name,
          relevantMemories,
          activeTasks,
        },
        callbacks: {
          onStateChange: (newState, meta) => {
            if (!isMounted) return;
            setLiveState(newState);
            setStateDetail(meta?.detail || '');
            if (newState === 'error' && meta?.detail) {
              setErrorMessage(meta.detail);
            }
          },
          onTranscriptUpdate: (updated) => {
            if (!isMounted) return;
            setTranscripts(updated);
          },
          onInterrupted: () => {
            if (!isMounted) return;
            setLiveState('interrupted');
          },
          onError: (err) => {
            if (!isMounted) return;
            setErrorMessage(err.message);
          },
        },
      })
      .catch((err) => {
        if (!isMounted) return;
        setErrorMessage(err.message);
      });

    return () => {
      isMounted = false;
      geminiLiveClient.stopSession();
      // Resume standby listening cleanly after live mode closes
      wakeWordManager.resumeAfterLiveMode();
    };
  }, [isOpen, activeSchool, selectedVoice, triggeredByWakeWord]);

  if (!isOpen) return null;

  const handleToggleMute = () => {
    const next = !isMicMuted;
    setIsMicMuted(next);
    geminiLiveClient.setMicrophoneMuted(next);
  };

  const handleTogglePause = () => {
    if (isPaused) {
      setIsPaused(false);
      geminiLiveClient.resumeConversation();
    } else {
      setIsPaused(true);
      geminiLiveClient.pauseConversation();
    }
  };

  const handleFinishAndSave = async () => {
    // Collect finalized turns into companion messages
    const finishedTranscripts = geminiLiveClient.getTranscripts();
    geminiLiveClient.stopSession();

    if (finishedTranscripts.length > 0) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const nowMs = now.getTime();

      const newMessages: CompanionMessage[] = finishedTranscripts
        .filter((t) => t.text.trim().length > 0)
        .map((t, idx) => ({
          id: `live-turn-${nowMs}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          role: t.role === 'user' ? 'user' : 'pixel',
          content: t.text.trim(),
          schoolId: activeSchool,
          createdAt: t.timestamp || timeStr,
          createdAtMs: nowMs + idx * 10,
          providerId: 'gemini',
          modelName: 'gemini-3.8-live',
        }));

      if (newMessages.length > 0) {
        try {
          await onAppendCompanionMessages(newMessages);
        } catch (saveErr) {
          console.warn('[PixelLiveModal] Failed to append live conversation messages:', saveErr);
        }
      }
    }

    onClose();
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Живой голосовой разговор с Пикселем"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-2xl h-[92vh] max-h-[820px] bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-white">
        {/* 1. Header with Active School, Status, and Controls */}
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between gap-3 bg-slate-900/60 backdrop-blur-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#00A8B5] to-[#FFD700] flex items-center justify-center shadow-xs">
              <Sparkles className="w-4 h-4 text-slate-950" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-display font-extrabold text-sm sm:text-base text-white truncate">
                  Живой разговор с Пикселем
                </h2>
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide uppercase ${
                    activeSchool === 'renderia'
                      ? 'bg-[#84CC16] text-slate-950'
                      : 'bg-[#FFD700] text-slate-950'
                  }`}
                >
                  {schoolConfig.name}
                </span>
                {triggeredByWakeWord && (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Вызов: «Пиксель»</span>
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 flex items-center gap-2">
                <span>Gemini Live 16/24 кГц</span>
                <span>·</span>
                <span>Голос: {selectedVoice}</span>
                <span>·</span>
                <span className="font-mono-tabular font-medium text-emerald-400">
                  {formatTimer(sessionElapsedSec)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onOpenSettings}
              title="Настройки голоса"
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <Headphones className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleFinishAndSave}
              title="Закрыть и сохранить"
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 2. Central Visualizer Sphere Area */}
        <div className="relative py-8 px-6 flex flex-col items-center justify-center border-b border-slate-800/60 bg-gradient-to-b from-slate-900 via-slate-900/90 to-slate-950">
          {/* Organic Pulsing Voice Orb */}
          <div className="relative w-44 h-44 sm:w-52 sm:h-52 flex items-center justify-center">
            {/* Outer Ripple Layers */}
            <div
              className={`absolute inset-0 rounded-full blur-2xl transition-all duration-700 ${
                liveState === 'speaking'
                  ? 'bg-[#00A8B5]/35 scale-125 animate-pulse'
                  : liveState === 'listening'
                    ? 'bg-emerald-500/25 scale-110 animate-pulse'
                    : liveState === 'thinking'
                      ? 'bg-amber-500/30 scale-115'
                      : liveState === 'interrupted'
                        ? 'bg-rose-500/40 scale-120'
                        : liveState === 'connecting'
                          ? 'bg-indigo-500/25 scale-105'
                          : 'bg-slate-700/20 scale-95'
              }`}
            />

            {/* Middle Glow Ring */}
            <div
              className={`absolute inset-4 rounded-full border transition-all duration-500 ${
                liveState === 'speaking'
                  ? 'border-[#00A8B5]/60 shadow-[0_0_40px_rgba(0,168,181,0.5)] animate-spin-slow'
                  : liveState === 'listening'
                    ? 'border-emerald-500/50 shadow-[0_0_30px_rgba(16,185,129,0.4)]'
                    : liveState === 'thinking'
                      ? 'border-amber-400/60 shadow-[0_0_35px_rgba(245,158,11,0.5)] animate-spin'
                      : liveState === 'interrupted'
                        ? 'border-rose-500/70 shadow-[0_0_40px_rgba(244,63,94,0.6)]'
                        : 'border-slate-700/50'
              }`}
            />

            {/* Core Animated Sphere */}
            <div
              className={`relative w-28 h-28 sm:w-32 sm:h-32 rounded-full flex flex-col items-center justify-center shadow-inner transition-all duration-500 ${
                liveState === 'speaking'
                  ? 'bg-gradient-to-tr from-[#00A8B5] via-teal-400 to-[#FFD700] scale-105 shadow-[0_0_30px_#00A8B5]'
                  : liveState === 'listening'
                    ? 'bg-gradient-to-tr from-emerald-600 via-teal-500 to-emerald-400 scale-100 shadow-[0_0_25px_#10B981]'
                    : liveState === 'thinking'
                      ? 'bg-gradient-to-tr from-amber-600 via-amber-400 to-yellow-300 scale-100 animate-pulse shadow-[0_0_25px_#F59E0B]'
                      : liveState === 'interrupted'
                        ? 'bg-gradient-to-tr from-rose-600 via-red-500 to-amber-500 scale-95'
                        : liveState === 'paused'
                          ? 'bg-slate-700 opacity-80'
                          : 'bg-gradient-to-tr from-slate-800 to-slate-700'
              }`}
            >
              {liveState === 'connecting' ? (
                <Loader2 className="w-8 h-8 text-white animate-spin" />
              ) : liveState === 'speaking' ? (
                <Volume2 className="w-9 h-9 text-slate-950 animate-bounce" />
              ) : liveState === 'listening' ? (
                <Mic className="w-9 h-9 text-slate-950" />
              ) : liveState === 'thinking' ? (
                <Sparkles className="w-9 h-9 text-slate-950 animate-spin" />
              ) : liveState === 'interrupted' ? (
                <Zap className="w-9 h-9 text-white animate-ping" />
              ) : liveState === 'paused' ? (
                <Pause className="w-8 h-8 text-slate-300" />
              ) : (
                <Mic className="w-8 h-8 text-slate-400" />
              )}
            </div>
          </div>

          {/* Current State Text Label */}
          <div className="mt-4 text-center space-y-1">
            <div className="font-display font-extrabold text-lg text-white">
              {stateMeta.labelRu}
            </div>
            <div className="text-xs text-slate-400 max-w-sm px-2">
              {stateDetail || stateMeta.descriptionRu}
            </div>
          </div>
        </div>

        {/* 3. Live Synchronized Transcript Feed */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5 bg-slate-950/40">
          {transcripts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-2">
              <Headphones className="w-8 h-8 opacity-40 text-emerald-400" />
              <div className="text-sm font-semibold text-slate-200">
                {triggeredByWakeWord
                  ? 'Пиксель откликается: «Я тут, Анна!»'
                  : 'Живой диалог готов к началу'}
              </div>
              <div className="text-xs text-slate-400 max-w-xs">
                {triggeredByWakeWord
                  ? 'Говорите свободно — Пиксель слушает вас в реальном времени.'
                  : 'Слушайте или скажите: «Пиксель, напомни мне о планах школы» или «Какие задачи сегодня в приоритете?»'}
              </div>
            </div>
          ) : (
            transcripts.map((entry) => {
              const isUser = entry.role === 'user';
              return (
                <div
                  key={entry.id}
                  className={`flex flex-col ${
                    isUser ? 'items-end' : 'items-start'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-1 px-1">
                    <span className="font-semibold text-slate-400">
                      {isUser ? 'Анна (Голос)' : 'Пиксель (Live)'}
                    </span>
                    <span>·</span>
                    <span className="font-mono-tabular">{entry.timestamp}</span>
                    {entry.isPartial && (
                      <span className="text-[#00A8B5] font-semibold animate-pulse">
                        · говорит...
                      </span>
                    )}
                  </div>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      isUser
                        ? 'bg-slate-800 text-slate-100 border border-slate-700/80 rounded-tr-xs'
                        : 'bg-[#00A8B5]/15 text-white border border-[#00A8B5]/30 rounded-tl-xs'
                    }`}
                  >
                    {entry.text}
                  </div>
                </div>
              );
            })
          )}
          <div ref={transcriptsEndRef} />
        </div>

        {/* Error Alert Bar if any */}
        {errorMessage && (
          <div className="px-4 py-2.5 bg-rose-950/80 border-t border-rose-800 text-xs text-rose-200 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-rose-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* 4. Bottom Controls Toolbar */}
        <div className="p-4 sm:p-5 bg-slate-900 border-t border-slate-800 flex items-center justify-between gap-3">
          {/* Mute Mic Toggle */}
          <button
            type="button"
            onClick={handleToggleMute}
            title={isMicMuted ? 'Включить микрофон' : 'Выключить микрофон'}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold border transition-all ${
              isMicMuted
                ? 'bg-rose-500/20 border-rose-500 text-rose-300'
                : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
            }`}
          >
            {isMicMuted ? (
              <>
                <MicOff className="w-4 h-4 text-rose-400" />
                <span className="hidden sm:inline">Микрофон выкл.</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4 text-emerald-400" />
                <span className="hidden sm:inline">Микрофон вкл.</span>
              </>
            )}
          </button>

          {/* Pause / Resume Button */}
          <button
            type="button"
            onClick={handleTogglePause}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold border transition-all ${
              isPaused
                ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
            }`}
          >
            {isPaused ? (
              <>
                <Play className="w-4 h-4 text-amber-400 fill-current" />
                <span>Продолжить</span>
              </>
            ) : (
              <>
                <Pause className="w-4 h-4 text-slate-400" />
                <span>Пауза</span>
              </>
            )}
          </button>

          {/* End Conversation and Commit History */}
          <button
            type="button"
            onClick={handleFinishAndSave}
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-bold bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white shadow-lg transition-all"
          >
            <Check className="w-4 h-4" />
            <span>Завершить разговор</span>
          </button>
        </div>
      </div>
    </div>
  );
};
