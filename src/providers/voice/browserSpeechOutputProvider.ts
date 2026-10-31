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
  private levelInterval: ReturnType<typeof setInterval> | null = null;
  private stateListeners = new Set<
    (speaking: boolean, messageId: string | null) => void
  >();
  private audioLevelListeners = new Set<(level: number) => void>();

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

    // Use 520-char sentence chunks so chunk indices align cleanly with Gemini TTS when resuming
    const chunks = splitTextIntoSpeechChunks(cleaned, 520);
    if (chunks.length === 0) return;

    const startIdx = Math.max(
      0,
      Math.min(chunks.length - 1, options?.startChunkIndex ?? 0)
    );

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
    this.startAudioLevelLoop(options?.onAudioLevel);

    return new Promise<void>((resolve, reject) => {
      let outerIdx = startIdx;

      const playNextOuterChunk = () => {
        if (!this.isCurrentlySpeaking) {
          this.stopAudioLevelLoop(options?.onAudioLevel);
          resolve();
          return;
        }

        if (outerIdx >= chunks.length) {
          this.stopAudioLevelLoop(options?.onAudioLevel);
          this.isCurrentlySpeaking = false;
          this.currentMessageId = null;
          this.notifyState();
          options?.onEnd?.();
          resolve();
          return;
        }

        const currentOuterIdx = outerIdx;
        outerIdx++;
        options?.onChunkProgress?.(currentOuterIdx, chunks.length);

        // Split outer chunk into ~180 char sub-utterances so Chromium SpeechSynthesis never stalls
        const subChunks = splitTextIntoSpeechChunks(chunks[currentOuterIdx], 180);
        let subIdx = 0;

        const playNextSubChunk = () => {
          if (!this.isCurrentlySpeaking) {
            this.stopAudioLevelLoop(options?.onAudioLevel);
            resolve();
            return;
          }

          if (subIdx >= subChunks.length) {
            playNextOuterChunk();
            return;
          }

          const subText = subChunks[subIdx];
          subIdx++;

          const utterance = new SpeechSynthesisUtterance(subText);
          if (selectedVoice) {
            utterance.voice = selectedVoice;
          }
          utterance.lang = selectedVoice?.lang || options?.lang || 'ru-RU';
          utterance.rate = options?.rate ?? 1.0;
          utterance.pitch = options?.pitch ?? 1.05;
          utterance.volume = options?.volume ?? 1.0;

          utterance.onend = () => {
            playNextSubChunk();
          };

          utterance.onerror = (e) => {
            // If canceled via stop(), do not treat as fatal error
            if (e.error === 'canceled' || e.error === 'interrupted') {
              this.stopAudioLevelLoop(options?.onAudioLevel);
              resolve();
              return;
            }
            this.stopAudioLevelLoop(options?.onAudioLevel);
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
            this.stopAudioLevelLoop(options?.onAudioLevel);
            this.isCurrentlySpeaking = false;
            this.currentMessageId = null;
            this.notifyState();
            reject(err);
          }
        };

        playNextSubChunk();
      };

      playNextOuterChunk();
    });
  }

  private startAudioLevelLoop(onLevel?: (level: number) => void): void {
    this.stopAudioLevelLoop(onLevel);
    let tick = 0;
    this.levelInterval = setInterval(() => {
      if (!this.isCurrentlySpeaking || this.isCurrentlyPaused) {
        this.emitAudioLevel(0, onLevel);
        return;
      }
      tick++;
      // Natural syllable envelope with brief consonant dips
      const wave =
        0.42 +
        0.32 * Math.sin(tick * 0.65) +
        0.18 * Math.cos(tick * 1.15);
      const level = tick % 9 === 0 ? 0.08 : Math.max(0.12, Math.min(0.92, wave));
      this.emitAudioLevel(level, onLevel);
    }, 45);
  }

  private stopAudioLevelLoop(onLevel?: (level: number) => void): void {
    if (this.levelInterval) {
      clearInterval(this.levelInterval);
      this.levelInterval = null;
    }
    this.emitAudioLevel(0, onLevel);
  }

  private emitAudioLevel(level: number, onLevel?: (level: number) => void): void {
    const clamped = Math.max(0, Math.min(1, level));
    onLevel?.(clamped);
    for (const listener of this.audioLevelListeners) {
      try {
        listener(clamped);
      } catch {
        // ignore
      }
    }
  }

  public onAudioLevelChange(callback: (level: number) => void): () => void {
    this.audioLevelListeners.add(callback);
    return () => this.audioLevelListeners.delete(callback);
  }

  public stop(): void {
    if (!this.isSupported()) return;
    this.stopAudioLevelLoop();
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
      this.emitAudioLevel(0);
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
    if (!this.isCurrentlySpeaking || this.isCurrentlyPaused) {
      this.emitAudioLevel(0);
    }
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
