import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Info,
  Mic,
  Monitor,
  Radio,
  RefreshCw,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import {
  voiceDiagnosticManager,
  VoiceDiagnosticEntry,
  MicrophoneDiagnosticReport,
} from '../providers/voice/voiceDiagnosticManager';
import { wakeWordManager } from '../providers/voice/wakeWordManager';
import { pixelVoiceCoordinator } from '../providers/voice/pixelVoiceCoordinator';
import { WAKE_WORD_STATE_META } from '../types/voice';

interface VoiceDiagnosticModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenLiveVoice?: () => void;
}

export const VoiceDiagnosticModal: React.FC<VoiceDiagnosticModalProps> = ({
  isOpen,
  onClose,
  onOpenLiveVoice,
}) => {
  const [entries, setEntries] = useState<VoiceDiagnosticEntry[]>(() =>
    voiceDiagnosticManager.getEntries()
  );
  const [activeFilter, setActiveFilter] = useState<
    'all' | 'errors' | 'speech' | 'matches'
  >('all');
  const [isTestingHardware, setIsTestingHardware] = useState(false);
  const [hardwareReport, setHardwareReport] =
    useState<MicrophoneDiagnosticReport | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [coordinatorSnapshot, setCoordinatorSnapshot] = useState(() =>
    pixelVoiceCoordinator.getSnapshot()
  );

  useEffect(() => {
    if (!isOpen) return;

    const unsubEntries = voiceDiagnosticManager.onEntriesChange((updated) => {
      setEntries(updated);
    });

    const unsubCoord = pixelVoiceCoordinator.onStateChange((snap) => {
      setCoordinatorSnapshot(snap);
    });

    // Auto-run lightweight non-capturing hardware check when opened
    voiceDiagnosticManager
      .runHardwareAndPermissionTest(false)
      .then((rep) => setHardwareReport(rep))
      .catch(() => {
        // ignore
      });

    return () => {
      unsubEntries();
      unsubCoord();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const isElectron = voiceDiagnosticManager.isElectron();
  const wakeMeta = WAKE_WORD_STATE_META[coordinatorSnapshot.wakeWordState];

  const handleTestHardware = async () => {
    setIsTestingHardware(true);
    try {
      const rep = await voiceDiagnosticManager.runHardwareAndPermissionTest(true);
      setHardwareReport(rep);
      if (rep.permissionState === 'granted') {
        wakeWordManager.startListening();
      }
    } finally {
      setIsTestingHardware(false);
    }
  };

  const handleRestartStandby = () => {
    wakeWordManager.requestStandbyRestart('Ручной перезапуск из панели диагностики');
  };

  const handleCopyLog = async () => {
    const text = voiceDiagnosticManager.exportLogAsText();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2500);
    } catch {
      // ignore
    }
  };

  const handleDownloadLog = () => {
    const text = voiceDiagnosticManager.exportLogAsText();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pixel-voice-diag-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredEntries = entries.filter((e) => {
    if (activeFilter === 'errors') {
      return e.level === 'error' || e.level === 'warn';
    }
    if (activeFilter === 'speech') {
      return e.category === 'speech' || e.category === 'engine';
    }
    if (activeFilter === 'matches') {
      return e.category === 'match';
    }
    return true;
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-[#00A8B5] flex items-center justify-center shadow-xs">
              <Activity className="w-5 h-5 text-[#FFD700]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display font-extrabold text-slate-900 text-base">
                  Диагностика голосовой системы и Electron
                </h3>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    isElectron
                      ? 'bg-purple-100 text-purple-800 border border-purple-200'
                      : 'bg-blue-100 text-blue-800 border border-blue-200'
                  }`}
                >
                  {isElectron ? 'Electron Runtime' : 'Browser Preview'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Мониторинг Web Speech API, ключевого слова «Пиксель», микрофона и Gemini Live
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-800 hover:bg-slate-200/60 transition-colors"
            title="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {/* 1. Mic Permission */}
            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between">
              <span className="text-[11px] font-medium text-slate-500">
                Разрешение микрофона
              </span>
              <div className="flex items-center gap-2 mt-2">
                {hardwareReport?.permissionState === 'granted' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : hardwareReport?.permissionState === 'denied' ? (
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                )}
                <span className="text-xs font-bold text-slate-900">
                  {hardwareReport?.permissionState === 'granted'
                    ? 'Разрешён'
                    : hardwareReport?.permissionState === 'denied'
                      ? 'Запрещён'
                      : 'Требуется запрос'}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 truncate">
                {hardwareReport?.audioDeviceCount
                  ? `Устройств: ${hardwareReport.audioDeviceCount}`
                  : 'Поиск устройств...'}
              </span>
            </div>

            {/* 2. Web Speech Engine */}
            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between">
              <span className="text-[11px] font-medium text-slate-500">
                Движок распознавания
              </span>
              <div className="flex items-center gap-2 mt-2">
                {hardwareReport?.isWebSpeechSupported ? (
                  <Radio className="w-4 h-4 text-emerald-600 shrink-0 animate-pulse" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                )}
                <span className="text-xs font-bold text-slate-900 truncate">
                  {hardwareReport?.webSpeechClassName || 'Web Speech API'}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 truncate">
                Язык: ru-RU · Непрерывный
              </span>
            </div>

            {/* 3. Standby / Wake Word State */}
            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between">
              <span className="text-[11px] font-medium text-slate-500">
                Статус фонового вызова
              </span>
              <div className="flex items-center gap-2 mt-2">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    coordinatorSnapshot.wakeWordState === 'standby_listening'
                      ? 'bg-emerald-500 animate-pulse'
                      : coordinatorSnapshot.wakeWordState === 'hearing_speech'
                        ? 'bg-teal-500 animate-ping'
                        : coordinatorSnapshot.wakeWordState === 'live_active'
                          ? 'bg-cyan-500'
                          : coordinatorSnapshot.wakeWordState === 'error'
                            ? 'bg-red-500'
                            : 'bg-slate-400'
                  }`}
                />
                <span className="text-xs font-bold text-slate-900 truncate">
                  {wakeMeta?.labelRu || coordinatorSnapshot.wakeWordState}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 truncate">
                Режим: {coordinatorSnapshot.mode}
              </span>
            </div>

            {/* 4. Active Audio Output / Live API */}
            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between">
              <span className="text-[11px] font-medium text-slate-500">
                Gemini Live API
              </span>
              <div className="flex items-center gap-2 mt-2">
                <Volume2 className="w-4 h-4 text-[#00A8B5] shrink-0" />
                <span className="text-xs font-bold text-slate-900">
                  {coordinatorSnapshot.liveState === 'speaking'
                    ? 'Пиксель говорит'
                    : coordinatorSnapshot.liveState === 'listening'
                      ? 'Слушает Live'
                      : coordinatorSnapshot.liveState === 'connecting'
                        ? 'Подключение'
                        : 'Готов к запуску'}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 truncate">
                16kHz In · 24kHz Out (PCM)
              </span>
            </div>
          </div>

          {/* Electron Notice / Fallback helper */}
          {coordinatorSnapshot.wakeWordState === 'permission_denied' && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-bold block text-slate-900">
                    Доступ к микрофону ожидает подтверждения:
                  </span>
                  <p className="leading-relaxed text-slate-700">
                    Для активации вызова голосом нажмите «Разрешить микрофон» и подтвердите доступ в браузере.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleTestHardware}
                disabled={isTestingHardware}
                className="shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <Mic className="w-3.5 h-3.5 text-white" />
                <span>Разрешить микрофон</span>
              </button>
            </div>
          )}

          {coordinatorSnapshot.wakeWordState === 'error' && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold block">
                  Особенность распознавания речи в Electron:
                </span>
                <p className="leading-relaxed">
                  Web Speech API в настольных приложениях на Chromium может выдавать ошибку{' '}
                  <code className="bg-amber-100 px-1 py-0.5 rounded font-mono">network</code>, если
                  отсутствует доступ к облачным сервисам Google Speech. Нажмите{' '}
                  <strong>«Перезапустить прослушивание»</strong> или используйте кнопку{' '}
                  <strong>«Поговорить»</strong> — прямой диалог с Пикселем через Gemini Live работает
                  стабильно через интернет без ограничений Web Speech API.
                </p>
              </div>
            </div>
          )}

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleTestHardware}
                disabled={isTestingHardware}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 text-[#FFD700] ${
                    isTestingHardware ? 'animate-spin' : ''
                  }`}
                />
                <span>Протестировать микрофон</span>
              </button>

              <button
                type="button"
                onClick={handleRestartStandby}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <Mic className="w-3.5 h-3.5 text-emerald-600" />
                <span>Перезапустить ожидание</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  if (onOpenLiveVoice) {
                    onOpenLiveVoice();
                  } else {
                    void pixelVoiceCoordinator.startLive();
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-[#00A8B5] to-[#165B73] text-white hover:from-[#00929d] hover:to-[#124d62] transition-colors cursor-pointer shadow-2xs"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#FFD700]" />
                <span>Поговорить с Пикселем (Live)</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyLog}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                title="Скопировать лог в буфер обмена"
              >
                <Copy className="w-3.5 h-3.5 text-slate-500" />
                <span>{copySuccess ? 'Скопировано!' : 'Копировать'}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadLog}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                title="Скачать отчёт в формате .txt"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>Скачать .txt</span>
              </button>

              <button
                type="button"
                onClick={() => voiceDiagnosticManager.clear()}
                className="p-1.5 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                title="Очистить журнал"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center justify-between border-t border-slate-200 pt-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-600 mr-1">
                Журнал событий:
              </span>
              {(
                [
                  { id: 'all', label: `Все (${entries.length})` },
                  {
                    id: 'errors',
                    label: `Ошибки (${
                      entries.filter((e) => e.level === 'error' || e.level === 'warn')
                        .length
                    })`,
                  },
                  {
                    id: 'speech',
                    label: `Речь (${
                      entries.filter(
                        (e) => e.category === 'speech' || e.category === 'engine'
                      ).length
                    })`,
                  },
                  {
                    id: 'matches',
                    label: `Срабатывания (${
                      entries.filter((e) => e.category === 'match').length
                    })`,
                  },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveFilter(tab.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    activeFilter === tab.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-slate-400">
              Показано: {filteredEntries.length} из {entries.length}
            </span>
          </div>

          {/* Event Stream Log Table */}
          <div className="rounded-xl border border-slate-200 bg-slate-900 text-slate-100 font-mono text-xs max-h-72 overflow-y-auto divide-y divide-slate-800 p-2 space-y-1">
            {filteredEntries.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                Записей в этой категории пока нет
              </div>
            ) : (
              filteredEntries.map((e) => {
                const isErr = e.level === 'error';
                const isWarn = e.level === 'warn';
                const isSuccess = e.level === 'success';

                return (
                  <div
                    key={e.id}
                    className="p-2 rounded-lg hover:bg-slate-800/60 transition-colors space-y-1"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-[10px] shrink-0">
                        {e.timestamp}
                      </span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-bold shrink-0 ${
                          isErr
                            ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                            : isWarn
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                              : isSuccess
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                        }`}
                      >
                        {e.category}
                      </span>
                      <span
                        className={`font-semibold ${
                          isErr
                            ? 'text-red-300'
                            : isWarn
                              ? 'text-amber-300'
                              : isSuccess
                                ? 'text-emerald-300'
                                : 'text-slate-100'
                        }`}
                      >
                        {e.message}
                      </span>
                    </div>

                    {e.detail && (
                      <div className="text-[11px] text-slate-300 pl-4 border-l-2 border-slate-700 ml-2">
                        {e.detail}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <Monitor className="w-3.5 h-3.5 text-slate-400" />
            <span>
              {isElectron
                ? 'Windows Electron App — IPC Media Handlers активны'
                : 'Web Browser Environment'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl font-semibold bg-slate-200 text-slate-800 hover:bg-slate-300 transition-colors cursor-pointer"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
