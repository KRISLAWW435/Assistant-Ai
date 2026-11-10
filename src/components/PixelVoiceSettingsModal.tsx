import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Headphones,
  Loader2,
  Mic,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import {
  DEFAULT_PIXEL_VOICE_SETTINGS,
  GEMINI_TTS_STANDARD_STYLE,
  GEMINI_TTS_VOICES,
  GeminiVoiceSampleOption,
  PIXEL_COMPARISON_PHRASE,
  PixelVoiceSettings,
} from '../types/voice';
import {
  resolveBrowserPitchForTimbre,
  voiceManager,
} from '../providers/voice/voiceManager';
import { useAutumnTheme } from '../utils/autumnTheme';

interface PixelVoiceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PixelVoiceSettingsModal: React.FC<PixelVoiceSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [settings, setSettings] = useState<PixelVoiceSettings>(() =>
    voiceManager.getSettings()
  );
  const { isAutumnTheme, toggleAutumnTheme, triggerLeafBurst } = useAutumnTheme();
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [isGeneratingLive, setIsGeneratingLive] = useState(false);
  const [liveTestError, setLiveTestError] = useState<string | null>(null);
  const [liveTestResult, setLiveTestResult] = useState<{
    provider: 'gemini' | 'browser_fallback';
    voice: string;
    fromCache?: boolean;
    model?: string;
    notice?: string;
  } | null>(null);

  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSettings(voiceManager.getSettings());

    return () => {
      stopAnySample();
      voiceManager.stopSpeaking();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const stopAnySample = () => {
    if (sampleAudioRef.current) {
      try {
        sampleAudioRef.current.pause();
        sampleAudioRef.current.currentTime = 0;
      } catch {
        // ignore
      }
      sampleAudioRef.current = null;
    }
    setPlayingVoiceId(null);
  };

  const handleUpdate = (partial: Partial<PixelVoiceSettings>) => {
    const next = voiceManager.updateSettings({
      ...partial,
      ttsProviderId: 'gemini',
      selectedTimbreId: 'bright',
      autoSpeakNewReplies: false,
    });
    setSettings(next);
  };

  const handlePlayStaticAudio = (audioId: string, audioUrl: string) => {
    if (playingVoiceId === audioId) {
      stopAnySample();
      return;
    }

    stopAnySample();
    voiceManager.stopSpeaking();

    const audio = new Audio(audioUrl);
    sampleAudioRef.current = audio;
    audio.volume = settings.volume;
    setPlayingVoiceId(audioId);

    audio.onended = () => {
      setPlayingVoiceId(null);
      sampleAudioRef.current = null;
    };

    audio.onerror = () => {
      setPlayingVoiceId(null);
      sampleAudioRef.current = null;
    };

    audio.play().catch(() => {
      setPlayingVoiceId(null);
      sampleAudioRef.current = null;
    });
  };

  const handlePlayVoiceSample = (voice: GeminiVoiceSampleOption) => {
    handlePlayStaticAudio(`voice_${voice.id}`, voice.sampleUrl);
  };

  const handleSelectUnifiedVoice = (voiceId: string) => {
    handleUpdate({
      selectedGeminiVoice: voiceId,
    });
  };

  const handleGenerateLiveTest = async () => {
    if (playingVoiceId === 'live_test') {
      stopAnySample();
      voiceManager.stopSpeaking();
      return;
    }

    stopAnySample();
    voiceManager.stopSpeaking();
    setIsGeneratingLive(true);
    setLiveTestError(null);
    setLiveTestResult(null);

    try {
      const response = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: PIXEL_COMPARISON_PHRASE,
          voice: settings.selectedGeminiVoice || 'Aoede',
          style: GEMINI_TTS_STANDARD_STYLE,
          timbreId: 'bright',
          model: 'gemini-3.8-flash-lite-tts',
          forceRefresh: true,
        }),
      });

      if (!response.ok) {
        let errMessage = `Сбой API (${response.status})`;
        try {
          const errData = await response.json();
          if (errData?.error) errMessage = errData.error;
        } catch {
          // ignore
        }

        if (
          settings.allowBrowserFallback &&
          voiceManager.getBrowserOutputProvider().isSupported()
        ) {
          const adaptedPitch = resolveBrowserPitchForTimbre(
            'bright',
            settings.pitch
          );
          setPlayingVoiceId('live_test');
          setLiveTestResult({
            provider: 'browser_fallback',
            voice: settings.selectedGeminiVoice || 'Aoede',
            notice:
              response.status === 429
                ? 'Лимит Gemini TTS временно исчерпан. Сработал резервный синтез речи браузера.'
                : `Сервер вернул статус ${response.status}. Воспроизведён резервный синтез.`,
          });

          await voiceManager
            .getBrowserOutputProvider()
            .speak(PIXEL_COMPARISON_PHRASE, {
              voiceURI: settings.voiceURI,
              rate: settings.rate,
              pitch: adaptedPitch,
              volume: settings.volume,
              onEnd: () => setPlayingVoiceId(null),
              onError: () => setPlayingVoiceId(null),
            });
          return;
        }

        throw new Error(errMessage);
      }

      const data = await response.json();
      if (!data?.audioBase64) {
        throw new Error('Пустой аудио-ответ от сервера');
      }

      setLiveTestResult({
        provider: 'gemini',
        voice: data.voice || settings.selectedGeminiVoice || 'Aoede',
        fromCache: Boolean(data.fromCache),
        model: data.model || 'gemini-3.8-flash-lite-tts',
      });

      const audioUrl = `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`;
      const audio = new Audio(audioUrl);
      sampleAudioRef.current = audio;
      audio.volume = settings.volume;
      setPlayingVoiceId('live_test');

      audio.onended = () => {
        setPlayingVoiceId(null);
        sampleAudioRef.current = null;
      };

      audio.onerror = () => {
        setPlayingVoiceId(null);
        sampleAudioRef.current = null;
        setLiveTestError('Ошибка воспроизведения аудиофайла');
      };

      await audio.play();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLiveTestError(msg);
    } finally {
      setIsGeneratingLive(false);
    }
  };

  const handleResetDefaults = () => {
    stopAnySample();
    voiceManager.stopSpeaking();
    const reset = voiceManager.updateSettings({
      ...DEFAULT_PIXEL_VOICE_SETTINGS,
      autoSpeakNewReplies: false,
      selectedTimbreId: 'bright',
    });
    setSettings(reset);
    setLiveTestError(null);
    setLiveTestResult(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-linear-to-r from-slate-900 via-slate-850 to-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-400/20 border border-amber-400/30 flex items-center justify-center text-amber-300">
              <Headphones className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold tracking-tight text-white">
                  Единая система озвучки Пикселя
                </h3>
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono">
                  Единый TTS
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                Один выбранный голос озвучивает ответы всех специалистов и реплики Пикселя
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 overflow-y-auto text-xs text-slate-700">
          {/* Autumn Theme Card */}
          <div className="p-3.5 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/90 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="font-bold text-amber-950 text-xs flex items-center gap-1.5">
                  <span>Осенняя тема 🍂</span>
                  <span className="text-[10px] font-semibold text-amber-800 bg-amber-200/60 px-2 py-0.5 rounded-full">
                    Уютный режим
                  </span>
                </span>
                <p className="text-[11px] text-amber-800/80 leading-relaxed mt-0.5">
                  Активирует гирлянду на главной, лёгкую текстуру фона, чашечку чая в чате и редкий листопад раз в 5 минут.
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggleAutumnTheme()}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer shrink-0 ${
                  isAutumnTheme
                    ? 'bg-amber-600 text-white border-amber-700 hover:bg-amber-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span>{isAutumnTheme ? 'Включена' : 'Выключена'}</span>
                <span
                  className={`inline-block w-7 h-4 rounded-full p-0.5 transition-colors relative ${
                    isAutumnTheme ? 'bg-amber-900' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`block w-3 h-3 rounded-full bg-white transition-transform ${
                      isAutumnTheme ? 'translate-x-3' : 'translate-x-0'
                    }`}
                  />
                </span>
              </button>
            </div>
            {isAutumnTheme && (
              <div className="pt-1 flex items-center justify-between text-[10px] text-amber-800 border-t border-amber-200/60">
                <span>Хотите проверить анимацию листьев прямо сейчас?</span>
                <button
                  type="button"
                  onClick={() => triggerLeafBurst()}
                  className="font-semibold text-amber-900 underline hover:text-amber-950 cursor-pointer"
                >
                  Запустить листопад 🍁
                </button>
              </div>
            )}
          </div>

          {/* Unified On-Demand Policy Notice */}
          <div className="p-3 rounded-xl bg-cyan-50/70 border border-cyan-200/80 space-y-1">
            <div className="font-bold text-slate-900 flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5 text-[#00A8B5]" />
              <span>Озвучка строго по запросу Анны</span>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Автоматическое чтение новых сообщений отключено. Пиксель читает сообщения дословно и последовательно только тогда, когда вы просите:{' '}
              <span className="font-semibold text-slate-800">
                «Пиксель, прочитай ответ»
              </span>
              ,{' '}
              <span className="font-semibold text-slate-800">
                «Пиксель, зачитай всё сообщение»
              </span>{' '}
              или{' '}
              <span className="font-semibold text-slate-800">
                «Пиксель, прочитай последнее сообщение Маркетолога»
              </span>
              .
            </p>
          </div>

          {/* 4 Studio Voices Selection */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 text-xs">
                Выберите единый голос (4 варианта):
              </span>
              <span className="text-[11px] text-slate-500">
                Активен:{' '}
                <strong className="text-slate-900">
                  {settings.selectedGeminiVoice || 'Aoede'}
                </strong>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {GEMINI_TTS_VOICES.map((v) => {
                const isSelected =
                  (settings.selectedGeminiVoice || 'Aoede') === v.id;
                const isPlaying = playingVoiceId === `voice_${v.id}`;
                const isDefaultPersona = v.id === 'Aoede';

                return (
                  <div
                    key={v.id}
                    className={`p-3 rounded-xl border transition-all flex flex-col justify-between ${
                      isSelected
                        ? 'border-[#00A8B5] bg-cyan-50/40 shadow-xs ring-1 ring-[#00A8B5]/30'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900 text-xs">
                            {v.name}
                          </span>
                          {isDefaultPersona && (
                            <span className="text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-md">
                              Основной
                            </span>
                          )}
                        </div>
                        {isSelected && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                            <Check className="w-3 h-3" />
                            Выбран
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {v.description} · {v.styleTitle}
                      </p>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-100 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handlePlayVoiceSample(v)}
                        className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                          isPlaying
                            ? 'bg-amber-500 text-white hover:bg-amber-600'
                            : 'bg-slate-900 text-white hover:bg-slate-800'
                        }`}
                      >
                        {isPlaying ? (
                          <>
                            <Square className="w-3 h-3 fill-current" />
                            <span>Стоп</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 fill-current text-[#FFD700]" />
                            <span>Пример</span>
                          </>
                        )}
                      </button>

                      {!isSelected && (
                        <button
                          type="button"
                          onClick={() => handleSelectUnifiedVoice(v.id)}
                          className="py-1.5 px-2.5 rounded-lg text-xs font-medium border border-slate-300 text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                        >
                          Выбрать
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live Test of Selected Unified Voice */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>Проверка выбранного голоса</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Озвучить тестовую фразу выбранным единым голосом (
                  <strong className="text-slate-700">
                    {settings.selectedGeminiVoice || 'Aoede'}
                  </strong>
                  ).
                </p>
              </div>

              <button
                type="button"
                onClick={handleGenerateLiveTest}
                disabled={isGeneratingLive}
                className="shrink-0 px-3 py-2 rounded-xl bg-cyan-700 hover:bg-cyan-800 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors"
              >
                {isGeneratingLive ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Синтез...</span>
                  </>
                ) : playingVoiceId === 'live_test' ? (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Остановить</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current text-amber-300" />
                    <span>Проверить голос</span>
                  </>
                )}
              </button>
            </div>

            {liveTestResult && (
              <div
                className={`p-2.5 rounded-lg border text-[11px] flex items-center justify-between gap-2 ${
                  liveTestResult.provider === 'gemini'
                    ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                    : 'bg-amber-50/80 border-amber-200 text-amber-950'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>
                    Голос: {liveTestResult.voice}
                    {liveTestResult.notice ? ` · ${liveTestResult.notice}` : ''}
                  </span>
                </div>
              </div>
            )}

            {liveTestError && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-[11px] flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                <span>{liveTestError}</span>
              </div>
            )}
          </div>

          {/* Volume & Wake Word */}
          <div className="pt-2 border-t border-slate-100 space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-800">
                  Громкость озвучки
                </span>
                <span className="font-mono-tabular text-slate-600 font-semibold text-[11px]">
                  {Math.round(settings.volume * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={settings.volume}
                onChange={(e) =>
                  handleUpdate({ volume: parseFloat(e.target.value) })
                }
                className="w-full accent-slate-900 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <div>
                <div className="font-semibold text-slate-900 text-xs flex items-center gap-1.5">
                  <Mic className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Голосовой вызов по слову «Пиксель»</span>
                </div>
                <div className="text-[10px] text-slate-500">
                  Локальное ожидание ключевой фразы в активной вкладке
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={settings.wakeWordEnabled}
                  onChange={(e) =>
                    handleUpdate({ wakeWordEnabled: e.target.checked })
                  }
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600" />
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-100 text-xs font-medium transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            <span>По умолчанию</span>
          </button>

          <button
            type="button"
            onClick={() => {
              stopAnySample();
              onClose();
            }}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-2xs transition-colors"
          >
            <Check className="w-3.5 h-3.5 text-[#FFD700]" />
            <span>Готово</span>
          </button>
        </div>
      </div>
    </div>
  );
};
