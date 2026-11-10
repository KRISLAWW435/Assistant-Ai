/**
 * Standalone Screen for Live Real-Time Voice Conversation with Pixel.
 * Features:
 * - Large expressive organic animated audio sphere with distinct states (Listening, Thinking, Speaking, Interrupted)
 * - True bidirectional spoken conversation (Gemini Live API gemini-2.5-flash-live / 16kHz PCM in / 24kHz PCM out)
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
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import {
  CompanionMemoryRecord,
  CompanionMessage,
  CompanionTaskRecord,
  PixelDelegatedTaskState,
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
import { pixelVoiceCoordinator } from '../providers/voice/pixelVoiceCoordinator';
import {
  PIXEL_DELEGATION_STATUS_LABELS,
  SPECIALIST_NAMES_DATIVE_RU,
  SPECIALIST_NAMES_INSTRUMENTAL_RU,
  pixelAgentCoordinator,
} from '../providers/PixelAgentCoordinator';
import { PixelCharacter } from './pixel';

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
  const [snapshot, setSnapshot] = useState(() =>
    pixelVoiceCoordinator.getSnapshot()
  );
  const [selectedVoice, setSelectedVoice] = useState<string>(() => {
    return voiceManager.getSettings().selectedLiveVoice || 'Kore';
  });
  const [connectedVoice, setConnectedVoice] = useState<string>(() => {
    return voiceManager.getSettings().selectedLiveVoice || 'Kore';
  });
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [latestDelegatedTask, setLatestDelegatedTask] =
    useState<PixelDelegatedTaskState | null>(null);

  const transcriptsEndRef = useRef<HTMLDivElement | null>(null);

  const schoolConfig = SCHOOLS[activeSchool];
  const liveState = snapshot.liveState;
  const transcripts = snapshot.transcripts;
  const isMicMuted = snapshot.isMicMuted;
  const isPaused = snapshot.isPaused;
  const sessionElapsedSec = snapshot.sessionElapsedSec;
  const stateMeta = LIVE_VOICE_STATE_META[liveState];

  // Subscribe to coordinator state changes
  useEffect(() => {
    return pixelVoiceCoordinator.onStateChange((next) => {
      setSnapshot(next);
      if (next.errorDetail) {
        setErrorMessage(next.errorDetail);
      }
      if (next.mode === 'STANDBY' || next.mode === 'OFF') {
        onClose();
      }
    });
  }, [onClose]);

  // Subscribe to delegated specialist tasks during Live Voice session
  useEffect(() => {
    return pixelAgentCoordinator.onTasksChange((tasks, updatedTask) => {
      if (updatedTask) {
        setLatestDelegatedTask(updatedTask);
      } else if (tasks.length > 0) {
        setLatestDelegatedTask(tasks[0]);
      }
    });
  }, []);

  // When modal is opened, if live session is not running yet, initiate it via coordinator
  useEffect(() => {
    if (!isOpen) return;

    setErrorMessage(null);
    const freshVoice = voiceManager.getSettings().selectedLiveVoice || 'Kore';
    setSelectedVoice(freshVoice);
    setConnectedVoice(freshVoice);

    if (pixelVoiceCoordinator.getSnapshot().mode !== 'LIVE') {
      pixelVoiceCoordinator
        .startLive({ voiceName: freshVoice })
        .catch((err) => {
          setErrorMessage(err.message);
        });
    }
  }, [isOpen, activeSchool]);

  // Auto-scroll transcript container on new entries
  useEffect(() => {
    if (transcriptsEndRef.current) {
      transcriptsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcripts]);

  if (!isOpen) return null;

  const handleSelectLiveVoice = (newVoice: string) => {
    setSelectedVoice(newVoice);
    voiceManager.updateSettings({ selectedLiveVoice: newVoice });
  };

  const handleReconnectWithNewVoice = async (voiceToUse: string) => {
    setIsReconnecting(true);
    setErrorMessage(null);
    try {
      await pixelVoiceCoordinator.startLive({ voiceName: voiceToUse });
      setConnectedVoice(voiceToUse);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Ошибка переподключения с голосом ${voiceToUse}: ${msg}`);
    } finally {
      setIsReconnecting(false);
    }
  };

  const handleToggleMute = () => {
    pixelVoiceCoordinator.toggleMute();
  };

  const handleTogglePause = () => {
    pixelVoiceCoordinator.togglePause();
  };

  const handleFinishAndSave = async () => {
    await pixelVoiceCoordinator.stopLive(true);
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
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl h-[92vh] max-h-[820px] bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-white"
        onClick={(e) => e.stopPropagation()}
      >
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
              <div className="text-[11px] text-slate-400 flex items-center gap-2 flex-wrap">
                <span>Gemini Live</span>
                <span>·</span>
                <label className="flex items-center gap-1 cursor-pointer">
                  <span className="text-slate-400">Голос:</span>
                  <select
                    value={selectedVoice}
                    onChange={(e) => handleSelectLiveVoice(e.target.value)}
                    className="bg-slate-800 text-cyan-300 text-[11px] font-bold rounded px-1.5 py-0.5 border border-slate-700 hover:border-slate-600 focus:outline-none focus:border-[#00A8B5] cursor-pointer"
                  >
                    {GEMINI_LIVE_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.toneRu})
                      </option>
                    ))}
                  </select>
                </label>
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
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Headphones className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Свернуть в виджет (разговор продолжится в фоне)"
              className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer flex items-center gap-1 text-xs"
            >
              <Minimize2 className="w-4 h-4" />
              <span className="hidden sm:inline">Свернуть</span>
            </button>
            <button
              type="button"
              onClick={handleFinishAndSave}
              title="Завершить разговор"
              className="px-2.5 py-1.5 rounded-xl bg-red-600/80 hover:bg-red-600 text-white text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ml-1"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Завершить</span>
            </button>
          </div>
        </div>

        {/* Voice Change Notice Banner with Reconnection Action */}
        {connectedVoice !== selectedVoice && (
          <div className="px-5 py-2.5 bg-amber-500/15 border-b border-amber-500/30 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-3 animate-in fade-in">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Выбран новый голос: <b>{selectedVoice}</b>. В активном соединении звучит: <b>{connectedVoice}</b>. Новый голос применится при следующем звонке или переподключении.
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleReconnectWithNewVoice(selectedVoice)}
              disabled={isReconnecting}
              className="px-3 py-1 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-1.5 transition-colors shrink-0 shadow-xs"
            >
              {isReconnecting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Переподключение...</span>
                </>
              ) : (
                <>
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Переподключить сейчас</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* 2. Central Visualizer Sphere Area */}
        <div className="relative py-8 px-6 flex flex-col items-center justify-center border-b border-slate-800/60 bg-gradient-to-b from-slate-900 via-slate-900/90 to-slate-950">
          {/* 3D Glowing Pixel Character (120px Master Avatar) */}
          <div className="relative py-4 flex items-center justify-center overflow-visible">
            <PixelCharacter
              size={120}
              isSpeaking={liveState === 'speaking'}
              isListening={liveState === 'listening'}
              isThinking={liveState === 'thinking'}
            />
          </div>

          {/* Current State Text Label */}
          <div className="mt-4 text-center space-y-1">
            <div className="font-display font-extrabold text-lg text-white">
              {stateMeta.labelRu}
            </div>
            <div className="text-xs text-slate-400 max-w-sm px-2">
              {errorMessage || stateMeta.descriptionRu}
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

        {/* Live Delegated Task Banner (Stage 6.2) */}
        {latestDelegatedTask && (
          <div className="px-4 py-3 bg-slate-900/95 border-t border-slate-800 text-xs flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1 min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                    latestDelegatedTask.status === 'completed'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : latestDelegatedTask.status === 'error'
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  }`}
                >
                  {latestDelegatedTask.status !== 'completed' &&
                    latestDelegatedTask.status !== 'error' && (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    )}
                  <span>
                    {PIXEL_DELEGATION_STATUS_LABELS[
                      latestDelegatedTask.status
                    ] || latestDelegatedTask.statusLabelRu}
                  </span>
                </span>
                <span className="font-semibold text-white truncate">
                  Поручение{' '}
                  {SPECIALIST_NAMES_DATIVE_RU[latestDelegatedTask.targetMode]} (
                  {SCHOOLS[latestDelegatedTask.schoolId].name})
                </span>
                <span className="font-mono-tabular text-[10px] text-slate-400">
                  ID: {latestDelegatedTask.taskId}
                </span>
              </div>
              <div className="text-[11px] text-slate-300 truncate">
                {latestDelegatedTask.reviewSummary ||
                  latestDelegatedTask.errorMessage ||
                  `Задача: «${latestDelegatedTask.instruction}»`}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                pixelAgentCoordinator.openDelegatedChat(
                  latestDelegatedTask.schoolId,
                  latestDelegatedTask.targetMode,
                  latestDelegatedTask.sessionId,
                  latestDelegatedTask.lastSpecialistMessageId
                );
              }}
              className="px-3 py-1.5 rounded-xl bg-[#00A8B5] hover:bg-[#00939F] text-slate-950 font-bold text-xs transition-colors shrink-0 cursor-pointer"
            >
              Открыть чат с{' '}
              {SPECIALIST_NAMES_INSTRUMENTAL_RU[latestDelegatedTask.targetMode]}
            </button>
          </div>
        )}

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
