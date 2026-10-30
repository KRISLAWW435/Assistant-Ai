/**
 * Voice interfaces and types for Pixel Companion (STT & TTS architecture).
 * Designed for pluggable providers (Browser Native, and future Silero / Whisper.cpp).
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
    | 'no-speech'
    | 'network'
    | 'audio-capture'
    | 'not-supported'
    | 'aborted'
    | 'unknown';
  message: string;
  isPermissionDenied?: boolean;
  isNetworkError?: boolean;
}

export interface SpeechInputOptions {
  lang?: string; // Default: 'ru-RU'
  continuous?: boolean;
  interimResults?: boolean;
  onInterimResult?: (transcript: string) => void;
}

/**
 * Interface for Speech-to-Text providers.
 * Initial implementation: BrowserSpeechInputProvider (Web Speech API).
 * Future implementation: WhisperCppInputProvider (local webassembly / electron).
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
  onResult(callback: (transcript: string, isFinal: boolean) => void): () => void;
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
  source: 'browser_builtin' | 'silero_local' | 'external_tts';
}

export interface SpeechOutputOptions {
  voiceURI?: string;
  rate?: number; // 0.8 to 1.5, default: 1.0
  pitch?: number; // 0.8 to 1.2, default: 1.05
  volume?: number; // 0.1 to 1.0, default: 1.0
  lang?: string; // Default: 'ru-RU'
  messageId?: string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
}

/**
 * Interface for Text-to-Speech providers.
 * Initial implementation: BrowserSpeechOutputProvider (SpeechSynthesis API).
 * Future implementation: SileroTtsOutputProvider (local neural voice).
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

export interface PixelVoiceSettings {
  autoSpeakNewReplies: boolean;
  voiceURI?: string;
  voiceName?: string;
  rate: number; // 0.8 - 1.5
  pitch: number; // 0.8 - 1.2
  volume: number; // 0.1 - 1.0
}

export const DEFAULT_PIXEL_VOICE_SETTINGS: PixelVoiceSettings = {
  autoSpeakNewReplies: false,
  rate: 1.0,
  pitch: 1.05,
  volume: 1.0,
};

export const DEMO_SPEECH_PHRASE =
  'Привет, Анна! Я Пиксель — ваш персональный помощник по KIBERONE и RENDERIA. Готов помочь вам с задачами и напомнить о важных делах!';
