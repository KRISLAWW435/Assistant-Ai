/**
 * Voice interfaces and types for Pixel Companion (STT & TTS architecture).
 * Supports:
 * - Robust deduplicating Web Speech Recognition (STT)
 * - Google Gemini TTS Studio (24kHz) with 3 timbres (natural, bright, high)
 * - Configurable browser SpeechSynthesis fallback with double-playback prevention
 */

export type SpeechInputStatus =
  | 'idle'
  | 'requesting_permission'
  | 'listening'
  | 'recognizing'
  | 'error'
  | 'unsupported';

export interface SpeechInputError {
  code:
    | 'not-allowed'
    | 'not-found'
    | 'not-readable'
    | 'security-error'
    | 'service-not-allowed'
    | 'no-speech'
    | 'network'
    | 'audio-capture'
    | 'not-supported'
    | 'aborted'
    | 'unknown';
  message: string;
  isPermissionDenied?: boolean;
  isNetworkError?: boolean;
  technicalErrorName?: string;
}

export interface SpeechInputOptions {
  lang?: string; // Default: 'ru-RU'
  continuous?: boolean;
  interimResults?: boolean;
  onInterimResult?: (transcript: string) => void;
}

export interface SpeechRecognitionResultEvent {
  /** The finalized text committed so far across this recording session */
  finalTranscript: string;
  /** The current live unfinalized draft clause (replaces previous interim) */
  interimTranscript: string;
  /** Full text combining finalized chunks + current interim draft */
  fullTranscript: string;
  /** Whether the latest chunk was marked final */
  isFinal: boolean;
}

/**
 * Interface for Speech-to-Text providers.
 * Implementation: BrowserSpeechInputProvider (Web Speech API).
 */
export interface ISpeechInputProvider {
  readonly id: string;
  readonly name: string;
  isSupported(): boolean;
  /** Whether recognition relies on an external/cloud speech service (like Chrome webkitSpeechRecognition) */
  isRemoteService(): boolean;
  getStatus(): SpeechInputStatus;
  start(options?: SpeechInputOptions): Promise<void>;
  stop(): void;
  cancel(): void;
  onResult(callback: (event: SpeechRecognitionResultEvent) => void): () => void;
  onError(callback: (error: SpeechInputError) => void): () => void;
  onStatusChange(callback: (status: SpeechInputStatus) => void): () => void;
}

export interface SpeechVoiceOption {
  voiceURI: string;
  name: string;
  lang: string;
  isRussian: boolean;
  isDefault: boolean;
  isLocalService: boolean;
  source: 'browser_builtin' | 'gemini_tts' | 'silero_local' | 'external_tts';
}

export interface SpeechOutputOptions {
  voiceURI?: string;
  rate?: number; // 0.8 to 1.5, default: 1.0
  pitch?: number; // 0.8 to 1.2, default: 1.05
  volume?: number; // 0.1 to 1.0, default: 1.0
  lang?: string; // Default: 'ru-RU'
  style?: string; // Style prompt for Gemini TTS
  model?: string; // Specific TTS model
  messageId?: string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
  /** Invoked if execution fell back to browser TTS */
  onFallbackUsed?: (reason: string) => void;
}

/**
 * Interface for Text-to-Speech providers.
 */
export interface ISpeechOutputProvider {
  readonly id: string;
  readonly name: string;
  isSupported(): boolean;
  getVoices(): Promise<SpeechVoiceOption[]>;
  speak(text: string, options?: SpeechOutputOptions): Promise<void>;
  stop(): void;
  pause(): void;
  resume(): void;
  isSpeaking(): boolean;
  getCurrentMessageId(): string | null;
  onStateChange(
    callback: (speaking: boolean, messageId: string | null) => void
  ): () => void;
}

export type PixelTtsProviderId = 'gemini' | 'browser';

export type PixelTimbreId = 'natural' | 'bright' | 'high';

export interface PixelTimbreOption {
  id: PixelTimbreId;
  name: string;
  shortDesc: string;
  stylePrompt: string;
  sampleUrl: string;
}

export interface GeminiVoiceSampleOption {
  id: string; // 'Aoede' | 'Achernar' | 'Sulafat' | 'Vindemiatrix'
  name: string;
  description: string;
  sampleUrl: string;
  styleTitle: string;
}

export interface PixelVoiceSettings {
  ttsProviderId: PixelTtsProviderId;
  selectedGeminiVoice: string; // 'Aoede' | 'Achernar' | 'Sulafat' | 'Vindemiatrix'
  selectedTimbreId: PixelTimbreId; // 'natural' | 'bright' | 'high'
  allowBrowserFallback: boolean; // whether to allow system speech fallback on quota/timeout
  autoSpeakNewReplies: boolean;
  voiceURI?: string;
  voiceName?: string;
  rate: number; // 0.8 - 1.5
  pitch: number; // 0.8 - 1.2
  volume: number; // 0.1 - 1.0
}

export const PIXEL_TIMBRE_OPTIONS: PixelTimbreOption[] = [
  {
    id: 'natural',
    name: 'Естественный',
    shortDesc: 'Обычный приятный и спокойный регистр',
    stylePrompt:
      'Естественная русская разговорная речь. Приятный средний регистр, спокойный, тёплый, доброжелательный тембр. Умеренный темп, чёткая артикуляция, естественные паузы.',
    sampleUrl: '/assets/audio/pixel_timbre_natural.wav',
  },
  {
    id: 'bright',
    name: 'Светлый',
    shortDesc: 'Немного выше, легче и мягче (Рекомендуется)',
    stylePrompt:
      'Естественная русская разговорная речь. Чуть более высокий, светлый, лёгкий и мягкий регистр. Приветливый, открытый, воодушевляющий тон, без искусственности и без писклявости.',
    sampleUrl: '/assets/audio/pixel_timbre_bright.wav',
  },
  {
    id: 'high',
    name: 'Высокий',
    shortDesc: 'Заметно более высокий и звонкий, без детскости',
    stylePrompt:
      'Естественная русская разговорная речь. Заметно более высокий, звонкий и мелодичный регистр, ясная дикция, живая дружелюбная интонация, без детской манеры и без мультяшности.',
    sampleUrl: '/assets/audio/pixel_timbre_high.wav',
  },
];

export const GEMINI_TTS_VOICES: GeminiVoiceSampleOption[] = [
  {
    id: 'Aoede',
    name: 'Aoede',
    description: 'Лёгкая, непринуждённая подача',
    sampleUrl: '/assets/audio/pixel_sample_aoede.wav',
    styleTitle: 'Лёгкий, живой, естественный разговорный тембр',
  },
  {
    id: 'Achernar',
    name: 'Achernar',
    description: 'Мягкая подача',
    sampleUrl: '/assets/audio/pixel_sample_achernar.wav',
    styleTitle: 'Спокойный, мягкий, доброжелательный тембр',
  },
  {
    id: 'Sulafat',
    name: 'Sulafat',
    description: 'Тёплая подача',
    sampleUrl: '/assets/audio/pixel_sample_sulafat.wav',
    styleTitle: 'Тёплый, поддерживающий, доверительный тембр',
  },
  {
    id: 'Vindemiatrix',
    name: 'Vindemiatrix',
    description: 'Деликатная подача',
    sampleUrl: '/assets/audio/pixel_sample_vindemiatrix.wav',
    styleTitle: 'Деликатный, интеллигентный, спокойный тембр',
  },
];

export const PIXEL_COMPARISON_PHRASE =
  'Привет! Я Пиксель. Давай посмотрим, какие задачи сегодня самые важные, и решим, с чего лучше начать.';

export const GEMINI_TTS_COMPARISON_PHRASE =
  'Здравствуйте! Я Пиксель. Я помогу вам разобраться с задачами, найти нужные документы и освободить время для действительно важных дел.';

export const GEMINI_TTS_STANDARD_STYLE =
  'Естественная русская разговорная речь. Чуть более высокий, светлый, лёгкий и мягкий регистр. Приветливый, открытый, воодушевляющий тон, без искусственности и без писклявости.';

export const DEFAULT_PIXEL_VOICE_SETTINGS: PixelVoiceSettings = {
  ttsProviderId: 'gemini',
  selectedGeminiVoice: 'Aoede',
  selectedTimbreId: 'bright',
  allowBrowserFallback: true,
  autoSpeakNewReplies: false,
  rate: 1.0,
  pitch: 1.05,
  volume: 1.0,
};

export const DEMO_SPEECH_PHRASE =
  'Привет, Анна! Я Пиксель — ваш персональный помощник по KIBERONE и RENDERIA. Готов помочь вам с задачами и напомнить о важных делах!';
