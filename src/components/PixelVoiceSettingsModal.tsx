import React, { useEffect, useState } from 'react';
import {
  Check,
  Info,
  Play,
  RotateCcw,
  Sliders,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  DEFAULT_PIXEL_VOICE_SETTINGS,
  DEMO_SPEECH_PHRASE,
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
  const [voices, setVoices] = useState<SpeechVoiceOption[]>([]);
  const [isPlayingDemo, setIsPlayingDemo] = useState(false);
  const [isSupported, setIsSupported] = useState(true);

  useEffect(() => {
    if (!isOpen) return;

    const tts = voiceManager.getOutputProvider();
    setIsSupported(tts.isSupported());

    tts.getVoices().then((loaded) => {
      setVoices(loaded);
      // If voiceURI is not set or not in list, auto-select first Russian voice
      if (loaded.length > 0) {
        const ruVoices = loaded.filter((v) => v.isRussian);
        const currentUri = settings.voiceURI;
        const exists = loaded.some((v) => v.voiceURI === currentUri);
        if (!exists && ruVoices.length > 0) {
          const defaultRu = ruVoices.find((v) => v.isDefault) || ruVoices[0];
          const updated = voiceManager.updateSettings({
            voiceURI: defaultRu.voiceURI,
            voiceName: defaultRu.name,
          });
          setSettings(updated);
        }
      }
    });

    // Track active speaking state
    const unsubscribe = tts.onStateChange((speaking) => {
      if (!speaking) {
        setIsPlayingDemo(false);
      }
    });

    return () => {
      unsubscribe();
      tts.stop();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const ruVoices = voices.filter((v) => v.isRussian);
  const otherVoices = voices.filter((v) => !v.isRussian);

  const handleUpdate = (partial: Partial<PixelVoiceSettings>) => {
    const next = voiceManager.updateSettings(partial);
    setSettings(next);
  };

  const handleVoiceSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const uri = e.target.value;
    const found = voices.find((v) => v.voiceURI === uri);
    handleUpdate({
      voiceURI: uri,
      voiceName: found?.name || '',
    });
  };

  const handlePlayDemo = async () => {
    if (isPlayingDemo) {
      voiceManager.stopSpeaking();
      setIsPlayingDemo(false);
      return;
    }

    setIsPlayingDemo(true);
    try {
      await voiceManager.speakReply(DEMO_SPEECH_PHRASE, 'demo-phrase', {
        onStart: () => setIsPlayingDemo(true),
        onEnd: () => setIsPlayingDemo(false),
        onError: () => setIsPlayingDemo(false),
      });
    } catch {
      setIsPlayingDemo(false);
    }
  };

  const handleResetDefaults = () => {
    voiceManager.stopSpeaking();
    setIsPlayingDemo(false);
    const ruDefault = ruVoices.find((v) => v.isDefault) || ruVoices[0];
    const reset = voiceManager.updateSettings({
      ...DEFAULT_PIXEL_VOICE_SETTINGS,
      voiceURI: ruDefault?.voiceURI,
      voiceName: ruDefault?.name,
    });
    setSettings(reset);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Голосовой интерфейс Пикселя
              </h3>
              <p className="text-[11px] text-slate-500">
                Синтез речи (TTS) и настройки микрофона
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 overflow-y-auto text-xs text-slate-700">
          {!isSupported && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-900 text-[11px] flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
              <span>
                Ваш текущий браузер не поддерживает встроенный SpeechSynthesis API.
                Рекомендуется использовать Google Chrome, Microsoft Edge или Safari.
              </span>
            </div>
          )}

          {/* Voice Engine Info */}
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-[11px]">
            <span className="text-slate-500">Движок озвучивания:</span>
            <span className="font-semibold text-slate-800">
              Встроенный Web Speech API
            </span>
          </div>

          {/* Russian Voice Selection */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-800 flex items-center justify-between">
              <span>Голос Пикселя</span>
              {ruVoices.length > 0 ? (
                <span className="text-[10px] text-emerald-600 font-medium">
                  Доступно русских голосов: {ruVoices.length}
                </span>
              ) : (
                <span className="text-[10px] text-amber-600 font-medium">
                  Русские голоса не найдены
                </span>
              )}
            </label>

            {ruVoices.length === 0 ? (
              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-[11px] space-y-1">
                <div className="font-semibold">Русский голос отсутствует в системе</div>
                <div className="text-[10px] text-amber-900 leading-relaxed">
                  Браузер использует системные голоса вашей ОС. Чтобы Пиксель заговорил
                  на русском, добавьте русский языковой пакет в настройках Windows/macOS.
                </div>
              </div>
            ) : (
              <select
                value={settings.voiceURI || ''}
                onChange={handleVoiceSelect}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00A8B5]/40"
              >
                <optgroup label="Русские голоса">
                  {ruVoices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name} ({v.lang}) {v.isDefault ? '— По умолчанию' : ''}
                    </option>
                  ))}
                </optgroup>
                {otherVoices.length > 0 && (
                  <optgroup label="Другие голоса (не рекомендуется)">
                    {otherVoices.slice(0, 10).map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}
          </div>

          {/* Listen to Demo Button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!isSupported || ruVoices.length === 0}
              onClick={handlePlayDemo}
              className={`flex-1 py-2 px-3 rounded-xl font-semibold flex items-center justify-center gap-2 text-xs transition-colors shadow-2xs ${
                isPlayingDemo
                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                  : 'bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40'
              }`}
            >
              {isPlayingDemo ? (
                <>
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Остановить пример</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current text-[#FFD700]" />
                  <span>Прослушать пример голоса</span>
                </>
              )}
            </button>
          </div>

          {/* Speech Rate (Speed) Slider */}
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-slate-700">Скорость речи</span>
              <span className="font-mono-tabular text-slate-500 font-semibold text-[11px]">
                {settings.rate.toFixed(1)}x
              </span>
            </div>
            <input
              type="range"
              min="0.8"
              max="1.5"
              step="0.05"
              value={settings.rate}
              onChange={(e) => handleUpdate({ rate: parseFloat(e.target.value) })}
              className="w-full accent-[#00A8B5] cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>Медленнее (0.8x)</span>
              <span>Обычная (1.0x)</span>
              <span>Быстрее (1.5x)</span>
            </div>
          </div>

          {/* Speech Pitch (Height) Slider */}
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-slate-700">Высота тона</span>
              <span className="font-mono-tabular text-slate-500 font-semibold text-[11px]">
                {settings.pitch.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min="0.8"
              max="1.2"
              step="0.05"
              value={settings.pitch}
              onChange={(e) => handleUpdate({ pitch: parseFloat(e.target.value) })}
              className="w-full accent-purple-600 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>Ниже</span>
              <span>Стандарт (1.05)</span>
              <span>Выше</span>
            </div>
          </div>

          {/* Volume Slider */}
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-slate-700">Громкость</span>
              <span className="font-mono-tabular text-slate-500 font-semibold text-[11px]">
                {Math.round(settings.volume * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0.2"
              max="1.0"
              step="0.05"
              value={settings.volume}
              onChange={(e) =>
                handleUpdate({ volume: parseFloat(e.target.value) })
              }
              className="w-full accent-slate-900 cursor-pointer"
            />
          </div>

          {/* Auto-Speak Toggle */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-slate-900 text-xs">
                Автоматическое чтение ответов
              </div>
              <div className="text-[10px] text-slate-500">
                Озвучивать каждый новый ответ Пикселя сразу после генерации
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
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
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
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
            onClick={onClose}
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
