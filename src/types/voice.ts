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
  timbreId?: PixelTimbreId;
  forceRefresh?: boolean;
  messageId?: string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
  /** Invoked if execution fell back to browser TTS */
  onFallbackUsed?: (reason: string) => void;
  /** Invoked when audio metadata and provider resolution is confirmed */
  onMetaResolved?: (meta: {
    provider: 'gemini' | 'browser';
    voice: string;
    model?: string;
    timbre?: string;
    fromCache?: boolean;
    isFallback?: boolean;
  }) => void;
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
  selectedLiveVoice: string; // 'Kore' | 'Puck' | 'Zephyr' | 'Charon' | 'Fenrir'
  allowBrowserFallback: boolean; // whether to allow system speech fallback on quota/timeout
  autoSpeakNewReplies: boolean;
  voiceURI?: string;
  voiceName?: string;
  rate: number; // 0.8 - 1.5
  pitch: number; // 0.8 - 1.2
  volume: number; // 0.1 - 1.0
  wakeWordEnabled: boolean; // local wake word detection in browser
  wakeWordSensitivity: 'normal' | 'high';
  ttsModel?: string; // Specific TTS model, default: 'gemini-3.8-flash-lite-tts'
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

export interface GeminiLiveVoiceOption {
  id: string; // 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr'
  name: string;
  gender: 'female' | 'male' | 'neutral';
  toneRu: string;
  descriptionRu: string;
}

export const GEMINI_LIVE_VOICES: GeminiLiveVoiceOption[] = [
  {
    id: 'Kore',
    name: 'Kore (Рекомендуется)',
    gender: 'female',
    toneRu: 'Тёплый, чистый, доброжелательный',
    descriptionRu: 'Наиболее близок к живому тёплому стилю Пикселя для диалога на русском языке',
  },
  {
    id: 'Puck',
    name: 'Puck',
    gender: 'neutral',
    toneRu: 'Энергичный, лёгкий, подвижный',
    descriptionRu: 'Живая, быстрая и непосредственная подача',
  },
  {
    id: 'Zephyr',
    name: 'Zephyr',
    gender: 'female',
    toneRu: 'Мягкий, спокойный, доверительный',
    descriptionRu: 'Плавный, размеренный тон для комфортной рабочей беседы',
  },
  {
    id: 'Charon',
    name: 'Charon',
    gender: 'male',
    toneRu: 'Глубокий, авторитетный, спокойный',
    descriptionRu: 'Низкий, уверенный мужской регистр',
  },
  {
    id: 'Fenrir',
    name: 'Fenrir',
    gender: 'male',
    toneRu: 'Чёткий, деловой, структурированный',
    descriptionRu: 'Строгий и ясный тон для быстрого решения вопросов',
  },
];

export type LiveVoiceState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'paused'
  | 'interrupted'
  | 'error';

export interface LiveVoiceStateMeta {
  state: LiveVoiceState;
  labelRu: string;
  descriptionRu: string;
  colorScheme: 'cyan' | 'emerald' | 'amber' | 'indigo' | 'rose' | 'slate';
}

export const LIVE_VOICE_STATE_META: Record<LiveVoiceState, LiveVoiceStateMeta> = {
  idle: {
    state: 'idle',
    labelRu: 'Готов к разговору',
    descriptionRu: 'Нажмите «Начать разговор» для прямого голосового диалога',
    colorScheme: 'slate',
  },
  connecting: {
    state: 'connecting',
    labelRu: 'Подключение...',
    descriptionRu: 'Инициализация WebSocket и аудиопотока Gemini Live 16 кГц',
    colorScheme: 'indigo',
  },
  listening: {
    state: 'listening',
    labelRu: 'Слушаю вас, Анна...',
    descriptionRu: 'Говорите свободно в естественном темпе. Паузы и перебивания поддерживаются',
    colorScheme: 'emerald',
  },
  thinking: {
    state: 'thinking',
    labelRu: 'Пиксель думает...',
    descriptionRu: 'Обработка запроса и формирование аудиоответа',
    colorScheme: 'amber',
  },
  speaking: {
    state: 'speaking',
    labelRu: 'Пиксель говорит',
    descriptionRu: 'Вы можете перебить Пикселя в любой момент — он сразу замолчит',
    colorScheme: 'cyan',
  },
  paused: {
    state: 'paused',
    labelRu: 'Разговор на паузе',
    descriptionRu: 'Микрофон временно отключён. Нажмите «Продолжить», чтобы возобновить',
    colorScheme: 'amber',
  },
  interrupted: {
    state: 'interrupted',
    labelRu: 'Перебивание зафиксировано',
    descriptionRu: 'Воспроизведение мгновенно остановлено, Пиксель снова слушает вас',
    colorScheme: 'rose',
  },
  error: {
    state: 'error',
    labelRu: 'Ошибка соединения',
    descriptionRu: 'Проверьте доступность сети или микрофона',
    colorScheme: 'rose',
  },
};

export type MessagePlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface MessagePlaybackState {
  messageId: string | null;
  status: MessagePlaybackStatus;
  provider: 'gemini' | 'browser';
  voiceName?: string;
  timbreId?: PixelTimbreId;
  timbreName?: string;
  model?: string;
  fromCache?: boolean;
  isFallback?: boolean;
  errorMessage?: string;
  fallbackReason?: string;
}

export const PIXEL_COMPARISON_PHRASE =
  'Привет! Я Пиксель. Давай посмотрим, какие задачи сегодня самые важные, и решим, с чего лучше начать.';

export const GEMINI_TTS_COMPARISON_PHRASE =
  'Здравствуйте! Я Пиксель. Я помогу вам разобраться с задачами, найти нужные документы и освободить время для действительно важных дел.';

export const GEMINI_TTS_STANDARD_STYLE =
  'Естественная русская разговорная речь. Чуть более высокий, светлый, лёгкий и мягкий регистр. Приветливый, открытый, воодушевляющий тон, без искусственности и без писклявости.';

/**
 * Global 3-state voice mode for Pixel Companion (Stage 6.1)
 * - OFF: Microphone completely disabled, standby off, text chat ready.
 * - STANDBY: Passive wake-word listening for «Пиксель» via Web Speech API (Chrome ru-RU).
 * - LIVE: Bidirectional spoken dialogue via Gemini Live API without blocking interface.
 */
export type PixelVoiceMode = 'OFF' | 'STANDBY' | 'LIVE';

/**
 * Unified Standby Wake Word state machine
 */
export type WakeWordState =
  | 'standby_listening'
  | 'hearing_speech'
  | 'wake_word_triggered'
  | 'connecting_live'
  | 'live_active'
  | 'mic_muted'
  | 'permission_denied'
  | 'unsupported'
  | 'error';

export interface WakeWordStateMeta {
  state: WakeWordState;
  labelRu: string;
  descriptionRu: string;
  badgeClass: string;
  dotClass: string;
}

export const WAKE_WORD_STATE_META: Record<WakeWordState, WakeWordStateMeta> = {
  standby_listening: {
    state: 'standby_listening',
    labelRu: 'Ожидание: «Пиксель»',
    descriptionRu: 'Фоновое распознавание активно. Скажите «Пиксель» в любом разделе для мгновенного вызова.',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    dotClass: 'bg-emerald-500 animate-pulse',
  },
  hearing_speech: {
    state: 'hearing_speech',
    labelRu: 'Слышу речь...',
    descriptionRu: 'Микрофон улавливает голос, идёт проверка ключевого слова...',
    badgeClass: 'bg-teal-50 text-teal-800 border-teal-300',
    dotClass: 'bg-teal-500 animate-ping',
  },
  wake_word_triggered: {
    state: 'wake_word_triggered',
    labelRu: 'Пиксель услышал!',
    descriptionRu: 'Ключевое слово распознано. Открытие живого голосового диалога...',
    badgeClass: 'bg-amber-50 text-amber-900 border-amber-300',
    dotClass: 'bg-amber-500 animate-bounce',
  },
  connecting_live: {
    state: 'connecting_live',
    labelRu: 'Подключение к Live API...',
    descriptionRu: 'Инициализация микрофона и прямого аудиопотока 16 кГц...',
    badgeClass: 'bg-indigo-50 text-indigo-900 border-indigo-300',
    dotClass: 'bg-indigo-500 animate-spin',
  },
  live_active: {
    state: 'live_active',
    labelRu: 'Живой разговор',
    descriptionRu: 'Идёт прямой голосовой диалог с Пикселем.',
    badgeClass: 'bg-cyan-50 text-cyan-900 border-cyan-300',
    dotClass: 'bg-cyan-500 animate-pulse',
  },
  mic_muted: {
    state: 'mic_muted',
    labelRu: 'Ожидание выкл.',
    descriptionRu: 'Фоновый микрофон ожидания выключен. Нажмите, чтобы включить вызов Пикселя голосом.',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
    dotClass: 'bg-slate-400',
  },
  permission_denied: {
    state: 'permission_denied',
    labelRu: 'Микрофон заблокирован',
    descriptionRu: 'В браузере заблокирован доступ к микрофону. Нажмите на значок замка в адресной строке и разрешите микрофон.',
    badgeClass: 'bg-rose-50 text-rose-800 border-rose-300',
    dotClass: 'bg-rose-500',
  },
  unsupported: {
    state: 'unsupported',
    labelRu: 'STT не поддерживается',
    descriptionRu: 'В вашем браузере не найден Web Speech API для распознавания речи.',
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-300',
    dotClass: 'bg-slate-400',
  },
  error: {
    state: 'error',
    labelRu: 'Сбой микрофона',
    descriptionRu: 'Произошла ошибка распознавания речи.',
    badgeClass: 'bg-rose-50 text-rose-800 border-rose-300',
    dotClass: 'bg-rose-500',
  },
};

export const DEFAULT_PIXEL_VOICE_SETTINGS: PixelVoiceSettings = {
  ttsProviderId: 'gemini',
  selectedGeminiVoice: 'Aoede',
  selectedTimbreId: 'bright',
  selectedLiveVoice: 'Kore',
  allowBrowserFallback: true,
  autoSpeakNewReplies: false,
  rate: 1.0,
  pitch: 1.05,
  volume: 1.0,
  wakeWordEnabled: true,
  wakeWordSensitivity: 'normal',
  ttsModel: 'gemini-3.8-flash-lite-tts',
};

export const DEMO_SPEECH_PHRASE =
  'Привет, Анна! Я Пиксель — ваш персональный помощник по KIBERONE и RENDERIA. Готов помочь вам с задачами и напомнить о важных делах!';

