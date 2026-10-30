import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Headphones,
  Info,
  Loader2,
  Mic,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Volume2,
  Wand2,
  X,
} from 'lucide-react';
import {
  DEFAULT_PIXEL_VOICE_SETTINGS,
  DEMO_SPEECH_PHRASE,
  GEMINI_TTS_VOICES,
  GeminiVoiceSampleOption,
  PIXEL_COMPARISON_PHRASE,
  PIXEL_TIMBRE_OPTIONS,
  PixelTimbreId,
  PixelTimbreOption,
  PixelVoiceSettings,
  SpeechVoiceOption,
} from '../types/voice';
import { voiceManager } from '../providers/voice/voiceManager';

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
  const [browserVoices, setBrowserVoices] = useState<SpeechVoiceOption[]>([]);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [isBrowserTtsSupported, setIsBrowserTtsSupported] = useState(true);

  // Live on-demand generation state
  const [isGeneratingLive, setIsGeneratingLive] = useState(false);
  const [liveTestError, setLiveTestError] = useState<string | null>(null);

  // Audio player ref for auditioning comparison samples & live audio
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const browserTts = voiceManager.getBrowserOutputProvider();
    setIsBrowserTtsSupported(browserTts.isSupported());

    browserTts.getVoices().then((loaded) => {
      setBrowserVoices(loaded);
    });

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
    const next = voiceManager.updateSettings(partial);
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

  const handlePlayTimbreSample = (timbre: PixelTimbreOption) => {
    handlePlayStaticAudio(`timbre_${timbre.id}`, timbre.sampleUrl);
  };

  const handlePlayVoiceSample = (voice: GeminiVoiceSampleOption) => {
    handlePlayStaticAudio(`voice_${voice.id}`, voice.sampleUrl);
  };

  const handleSelectTimbre = (timbreId: PixelTimbreId) => {
    handleUpdate({
      selectedTimbreId: timbreId,
    });
  };

  const handleSelectGeminiVoice = (voiceId: string) => {
    handleUpdate({
      ttsProviderId: 'gemini',
      selectedGeminiVoice: voiceId,
    });
  };

  const handleGenerateLiveTest = async () => {
    stopAnySample();
    voiceManager.stopSpeaking();
    setIsGeneratingLive(true);
    setLiveTestError(null);

    const activeTimbre =
      PIXEL_TIMBRE_OPTIONS.find((t) => t.id === settings.selectedTimbreId) ||
      PIXEL_TIMBRE_OPTIONS[1];

    try {
      const response = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: PIXEL_COMPARISON_PHRASE,
          voice: settings.selectedGeminiVoice || 'Aoede',
          style: activeTimbre.stylePrompt,
          model: 'gemini-3.8-flash-lite-tts',
        }),
      });

      if (!response.ok) {
        let errMessage = `Сбой API (${response.status})`;
        try {
          const errData = await response.json();
          if (errData?.error) errMessage = errData.error;
        } catch {
          // ignore json error
        }
        throw new Error(errMessage);
      }

      const data = await response.json();
      if (!data?.audioBase64) {
        throw new Error('Пустой аудио-ответ от сервера');
      }

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
        setLiveTestError('Ошибка воспроизведения сгенерированного аудиофайла');
      };

      await audio.play();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLiveTestError(msg);
    } finally {
      setIsGeneratingLive(false);
    }
  };

  const handlePlayBrowserDemo = async () => {
    if (playingVoiceId === 'browser_demo') {
      voiceManager.stopSpeaking();
      setPlayingVoiceId(null);
      return;
    }

    stopAnySample();
    setPlayingVoiceId('browser_demo');

    try {
      await voiceManager.getBrowserOutputProvider().speak(DEMO_SPEECH_PHRASE, {
        voiceURI: settings.voiceURI,
        rate: settings.rate,
        pitch: settings.pitch,
        volume: settings.volume,
        onEnd: () => setPlayingVoiceId(null),
        onError: () => setPlayingVoiceId(null),
      });
    } catch {
      setPlayingVoiceId(null);
    }
  };

  const handleResetDefaults = () => {
    stopAnySample();
    voiceManager.stopSpeaking();
    const reset = voiceManager.updateSettings({
      ...DEFAULT_PIXEL_VOICE_SETTINGS,
    });
    setSettings(reset);
    setLiveTestError(null);
  };

  const ruBrowserVoices = browserVoices.filter((v) => v.isRussian);
  const activeTimbre =
    PIXEL_TIMBRE_OPTIONS.find((t) => t.id === settings.selectedTimbreId) ||
    PIXEL_TIMBRE_OPTIONS[1];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]"
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
                  Голосовой интерфейс и тембр Пикселя
                </h3>
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono">
                  Gemini TTS 24kHz
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                Тонкая настройка тембра, студийных голосов и резервного синтеза
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
          {/* TTS Engine Switcher */}
          <div className="space-y-1.5">
            <div className="font-semibold text-slate-900 flex items-center justify-between">
              <span>Основной движок озвучивания (TTS)</span>
              <span className="text-[11px] text-slate-500 font-normal">
                {settings.ttsProviderId === 'gemini'
                  ? 'Студийный нейросинтез Google'
                  : 'Локальный синтез ОС'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleUpdate({ ttsProviderId: 'gemini' })}
                className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                  settings.ttsProviderId === 'gemini'
                    ? 'border-[#00A8B5] bg-cyan-50/50 ring-2 ring-[#00A8B5]/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#00A8B5]" />
                    Google Gemini TTS
                  </span>
                  {settings.ttsProviderId === 'gemini' && (
                    <CheckCircle2 className="w-4 h-4 text-[#00A8B5]" />
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                  Естественные русские нейроголоса 24 кГц, тонкая настройка тембра и живые интонации
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleUpdate({ ttsProviderId: 'browser' })}
                className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                  settings.ttsProviderId === 'browser'
                    ? 'border-[#00A8B5] bg-cyan-50/50 ring-2 ring-[#00A8B5]/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-slate-600" />
                    Браузер (Резерв)
                  </span>
                  {settings.ttsProviderId === 'browser' && (
                    <CheckCircle2 className="w-4 h-4 text-[#00A8B5]" />
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                  Стандартный системный синтезатор речи вашей операционной системы
                </p>
              </button>
            </div>
          </div>

          {/* Section 1: Gemini TTS Settings */}
          {settings.ttsProviderId === 'gemini' && (
            <div className="space-y-4 pt-1">
              {/* Phrase Banner */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
                  Тестовая фраза для проверки и сравнения
                </div>
                <div className="text-xs font-medium text-slate-800 italic leading-relaxed">
                  «{PIXEL_COMPARISON_PHRASE}»
                </div>
              </div>

              {/* Part 1: Timbre of Pixel (Requested: Slightly higher, lighter, warmer, pleasant) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                    <Wand2 className="w-3.5 h-3.5 text-[#00A8B5]" />
                    Тембр голоса Пикселя (Высота и теплота регистра)
                  </span>
                  <span className="text-[11px] text-slate-500 font-normal">
                    Быстрое сравнение без расхода квоты
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  {PIXEL_TIMBRE_OPTIONS.map((timbre) => {
                    const isSelected = settings.selectedTimbreId === timbre.id;
                    const isPlaying = playingVoiceId === `timbre_${timbre.id}`;
                    const isRecommended = timbre.id === 'bright';

                    return (
                      <div
                        key={timbre.id}
                        className={`p-3 rounded-xl border transition-all flex flex-col justify-between ${
                          isSelected
                            ? 'border-[#00A8B5] bg-cyan-50/40 shadow-xs ring-1 ring-[#00A8B5]/30'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-bold text-slate-900 text-xs">
                              {timbre.name}
                            </span>
                            {isRecommended && (
                              <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                                Рекомендуется
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-600 mt-1 leading-snug">
                            {timbre.shortDesc}
                          </p>
                        </div>

                        <div className="mt-3 pt-2 border-t border-slate-150/70 flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handlePlayTimbreSample(timbre)}
                            className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-colors ${
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
                                <span>Образец</span>
                              </>
                            )}
                          </button>

                          {!isSelected ? (
                            <button
                              type="button"
                              onClick={() => handleSelectTimbre(timbre.id)}
                              className="py-1.5 px-2.5 rounded-lg text-xs font-medium border border-slate-300 text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                            >
                              Выбрать
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 px-2">
                              <Check className="w-3.5 h-3.5" />
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Part 2: Persona Voices */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-900 flex items-center justify-between">
                  <span>Базовый студийный голос:</span>
                  <span className="text-[11px] font-normal text-slate-500">
                    Основной голос: <b className="text-slate-800">Aoede</b> (лёгкий и живой)
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {GEMINI_TTS_VOICES.map((v) => {
                    const isSelected = settings.selectedGeminiVoice === v.id;
                    const isPlaying = playingVoiceId === `voice_${v.id}`;
                    const isPersona = v.id === 'Aoede';

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
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-900 text-xs">
                                {v.name}
                              </span>
                              {isPersona && (
                                <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.2 rounded-md">
                                  Персона Пикселя
                                </span>
                              )}
                            </div>
                            {isSelected && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                                <Check className="w-3 h-3" />
                                Активен
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 mt-1">
                            {v.description} · {v.styleTitle}
                          </p>
                        </div>

                        {/* Card Action Buttons */}
                        <div className="mt-3 pt-2.5 border-t border-slate-150/70 flex items-center gap-1.5">
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
                                <span>Остановить</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3 h-3 fill-current text-[#FFD700]" />
                                <span>Прослушать</span>
                              </>
                            )}
                          </button>

                          {!isSelected && (
                            <button
                              type="button"
                              onClick={() => handleSelectGeminiVoice(v.id)}
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

              {/* Part 3: Live API Test Generation (Explicit On-Demand) */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                      Живой тест через API на сервере
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Сгенерировать контрольную фразу с выбранным голосом (
                      <span className="font-semibold text-slate-700">
                        {settings.selectedGeminiVoice || 'Aoede'}
                      </span>
                      ) и тембром (
                      <span className="font-semibold text-slate-700">
                        {activeTimbre.name}
                      </span>
                      )
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
                        <span>Генерация...</span>
                      </>
                    ) : playingVoiceId === 'live_test' ? (
                      <>
                        <Square className="w-3.5 h-3.5 fill-current" />
                        <span>Остановить</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current text-amber-300" />
                        <span>Тест через API</span>
                      </>
                    )}
                  </button>
                </div>

                {liveTestError && (
                  <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                    <div>
                      <div className="font-semibold">Ответ Gemini TTS API:</div>
                      <div className="text-[10px] text-amber-800 mt-0.5">{liveTestError}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Section 2: Browser TTS Options (When directly chosen or for fallback) */}
          {settings.ttsProviderId === 'browser' && (
            <div className="space-y-3 pt-1">
              {!isBrowserTtsSupported && (
                <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-900 text-[11px] flex items-start gap-2">
                  <Info className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                  <span>
                    Ваш браузер не поддерживает SpeechSynthesis API. Рекомендуется
                    переключиться на Google Gemini TTS.
                  </span>
                </div>
              )}

              <div className="space-y-1">
                <label className="font-semibold text-slate-800 flex items-center justify-between">
                  <span>Системный голос</span>
                  {ruBrowserVoices.length > 0 ? (
                    <span className="text-[10px] text-emerald-600 font-medium">
                      Русских голосов: {ruBrowserVoices.length}
                    </span>
                  ) : (
                    <span className="text-[10px] text-amber-600 font-medium">
                      Русские голоса не обнаружены
                    </span>
                  )}
                </label>
                {ruBrowserVoices.length === 0 ? (
                  <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-[11px]">
                    В операционной системе нет русского языкового пакета речи. Используйте
                    Google Gemini TTS для чистого русского звучания.
                  </div>
                ) : (
                  <select
                    value={settings.voiceURI || ''}
                    onChange={(e) => {
                      const uri = e.target.value;
                      const found = browserVoices.find((v) => v.voiceURI === uri);
                      handleUpdate({
                        voiceURI: uri,
                        voiceName: found?.name || '',
                      });
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00A8B5]/40"
                  >
                    {ruBrowserVoices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <button
                type="button"
                onClick={handlePlayBrowserDemo}
                className="w-full py-2 px-3 rounded-xl font-semibold flex items-center justify-center gap-2 text-xs transition-colors bg-slate-900 text-white hover:bg-slate-800"
              >
                {playingVoiceId === 'browser_demo' ? (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Остановить пример</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current text-[#FFD700]" />
                    <span>Прослушать системный голос</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Section 3: Fallback & Playback Controls */}
          <div className="pt-2 border-t border-slate-100 space-y-3">
            {/* Transparent Browser Fallback Switch */}
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-900 text-xs">
                  Резервное воспроизведение через браузер при ошибке или исчерпании квоты API
                </div>
                <div className="text-[10px] text-slate-500">
                  Если Gemini TTS недоступен или лимит исчерпан, ответ будет автоматически прочитан голосом браузера без зависания.
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={settings.allowBrowserFallback}
                  onChange={(e) =>
                    handleUpdate({ allowBrowserFallback: e.target.checked })
                  }
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#00A8B5]" />
              </label>
            </div>

            {/* Auto-Speak Toggle */}
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-900 text-xs">
                  Автоматическое чтение новых ответов
                </div>
                <div className="text-[10px] text-slate-500">
                  По умолчанию выключено. Ручное озвучивание любого сообщения доступно по кнопке динамика рядом с ним.
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={settings.autoSpeakNewReplies}
                  onChange={(e) =>
                    handleUpdate({ autoSpeakNewReplies: e.target.checked })
                  }
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#00A8B5]" />
              </label>
            </div>

            {/* Volume Slider */}
            <div className="space-y-1 pt-1">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-700">Громкость воспроизведения</span>
                <span className="font-mono-tabular text-slate-500 font-semibold text-[11px]">
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
          </div>

          {/* Microphone Status Info Card */}
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] space-y-1 text-slate-600">
            <div className="font-semibold text-slate-800 flex items-center gap-1.5">
              <Mic className="w-3.5 h-3.5 text-emerald-600" />
              <span>Голосовой ввод без дублирования слов</span>
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Алгоритм распознавания разделяет утверждённый текст и текущий промежуточный набросок фразы. При диктовке промежуточные варианты не дублируются в строке ввода.
            </p>
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
            <span>Сбросить</span>
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
            <span>Сохранить настройки</span>
          </button>
        </div>
      </div>
    </div>
  );
};
