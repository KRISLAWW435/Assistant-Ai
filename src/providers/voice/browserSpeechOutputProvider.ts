/**
 * Browser native Text-to-Speech provider utilizing the Web Speech Synthesis API.
 * (window.speechSynthesis).
 */

import {
  ISpeechOutputProvider,
  SpeechOutputOptions,
  SpeechVoiceOption,
} from '../../types/voice';
import {
  cleanTextForSpeech,
  splitTextIntoSpeechChunks,
} from '../../utils/speechTextCleaner';

export class BrowserSpeechOutputProvider implements ISpeechOutputProvider {
  public readonly id = 'browser';
  public readonly name = 'Встроенный синтезатор браузера (SpeechSynthesis API)';

  private currentMessageId: string | null = null;
  private isCurrentlySpeaking = false;
  private isCurrentlyPaused = false;
  private currentUtteranceQueue: SpeechSynthesisUtterance[] = [];
  private stateListeners = new Set<
    (speaking: boolean, messageId: string | null) => void
  >();

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        // Voices loaded/updated asynchronously by the browser
      };
    }
  }

  public isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      'SpeechSynthesisUtterance' in window
    );
  }

  public async getVoices(): Promise<SpeechVoiceOption[]> {
    if (!this.isSupported()) return [];

    let rawVoices = window.speechSynthesis.getVoices();

    // In Chrome, getVoices() may initially be empty until voiceschanged fires
    if (rawVoices.length === 0) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 800);
        window.speechSynthesis.onvoiceschanged = () => {
          clearTimeout(timeout);
          resolve();
        };
      });
      rawVoices = window.speechSynthesis.getVoices();
    }

    return rawVoices.map((v) => {
      const langLower = (v.lang || '').toLowerCase();
      const isRu = langLower.startsWith('ru') || langLower.includes('ru_');
      return {
        voiceURI: v.voiceURI,
        name: v.name,
        lang: v.lang,
        isRussian: isRu,
        isDefault: v.default,
        isLocalService: v.localService,
        source: 'browser_builtin' as const,
      };
    });
  }

  public async speak(
    rawText: string,
    options?: SpeechOutputOptions
  ): Promise<void> {
    if (!this.isSupported()) {
      throw new Error(
        'Ваш браузер не поддерживает синтез речи (SpeechSynthesis API).'
      );
    }

    // Stop any previous playback first
    this.stop();

    const cleaned = cleanTextForSpeech(rawText);
    if (!cleaned) return;

    const chunks = splitTextIntoSpeechChunks(cleaned, 180);
    if (chunks.length === 0) return;

    const allVoices = window.speechSynthesis.getVoices();
    const ruVoices = allVoices.filter((v) => {
      const l = (v.lang || '').toLowerCase();
      return l.startsWith('ru') || l.includes('ru_');
    });

    let selectedVoice: SpeechSynthesisVoice | undefined;

    if (options?.voiceURI) {
      selectedVoice = allVoices.find((v) => v.voiceURI === options.voiceURI);
    }

    if (!selectedVoice && ruVoices.length > 0) {
      // Prefer default Russian voice or natural Russian voice
      selectedVoice =
        ruVoices.find((v) => v.default) ||
        ruVoices.find((v) => /natural|yandex|google|alisa|elena|irina/i.test(v.name)) ||
        ruVoices[0];
    }

    // Strict requirement: Never speak Russian text with a non-Russian voice without warning
    if (!selectedVoice && ruVoices.length === 0) {
      throw new Error(
        'В вашем браузере не найден русский голос синтеза речи. Установите языковой пакет «Русский» в системе или используйте Chrome/Edge.'
      );
    }

    this.currentMessageId = options?.messageId || null;
    this.isCurrentlySpeaking = true;
    this.isCurrentlyPaused = false;
    this.notifyState();

    options?.onStart?.();

    return new Promise<void>((resolve, reject) => {
      let chunkIdx = 0;

      const playNextChunk = () => {
        if (!this.isCurrentlySpeaking) {
          resolve();
          return;
        }

        if (chunkIdx >= chunks.length) {
          this.isCurrentlySpeaking = false;
          this.currentMessageId = null;
          this.notifyState();
          options?.onEnd?.();
          resolve();
          return;
        }

        const chunkText = chunks[chunkIdx];
        chunkIdx++;

        const utterance = new SpeechSynthesisUtterance(chunkText);
        if (selectedVoice) {
          utterance.voice = selectedVoice;
        }
        utterance.lang = selectedVoice?.lang || options?.lang || 'ru-RU';
        utterance.rate = options?.rate ?? 1.0;
        utterance.pitch = options?.pitch ?? 1.05;
        utterance.volume = options?.volume ?? 1.0;

        utterance.onend = () => {
          playNextChunk();
        };

        utterance.onerror = (e) => {
          // If canceled via stop(), do not treat as fatal error
          if (e.error === 'canceled' || e.error === 'interrupted') {
            resolve();
            return;
          }
          this.isCurrentlySpeaking = false;
          this.currentMessageId = null;
          this.notifyState();
          const err = new Error(`Ошибка синтеза речи: ${e.error}`);
          options?.onError?.(err);
          reject(err);
        };

        try {
          window.speechSynthesis.speak(utterance);
        } catch (err) {
          this.isCurrentlySpeaking = false;
          this.currentMessageId = null;
          this.notifyState();
          reject(err);
        }
      };

      playNextChunk();
    });
  }

  public stop(): void {
    if (!this.isSupported()) return;
    this.isCurrentlySpeaking = false;
    this.isCurrentlyPaused = false;
    this.currentMessageId = null;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
    this.notifyState();
  }

  public pause(): void {
    if (!this.isSupported()) return;
    try {
      window.speechSynthesis.pause();
      this.isCurrentlyPaused = true;
      this.notifyState();
    } catch {
      // ignore
    }
  }

  public resume(): void {
    if (!this.isSupported()) return;
    try {
      window.speechSynthesis.resume();
      this.isCurrentlyPaused = false;
      this.notifyState();
    } catch {
      // ignore
    }
  }

  public isSpeaking(): boolean {
    return this.isCurrentlySpeaking;
  }

  public isPaused(): boolean {
    return this.isCurrentlyPaused;
  }

  public getCurrentMessageId(): string | null {
    return this.currentMessageId;
  }

  public onStateChange(
    callback: (speaking: boolean, messageId: string | null) => void
  ): () => void {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }

  private notifyState(): void {
    for (const listener of this.stateListeners) {
      try {
        listener(this.isCurrentlySpeaking, this.currentMessageId);
      } catch {
        // ignore callback error
      }
    }
  }
}

export const browserSpeechOutput = new BrowserSpeechOutputProvider();
