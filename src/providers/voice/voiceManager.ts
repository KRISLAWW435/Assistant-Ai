/**
 * Unified Voice Manager for Pixel Companion and All AI Specialists.
 * Coordinates STT (Speech-to-Text) and TTS (Text-to-Speech) providers.
 * Supports:
 * - Play/Pause/Resume/Stop controls for all specialist messages (Marketer, Manager, Methodist, Analyst, Pixel)
 * - Single-playback guarantee (starting new audio stops any prior playback immediately)
 * - Clean text formatting (stripping Markdown, technical markers, tables, code blocks)
 * - Studio-quality Google Gemini TTS (24kHz) with configurable timbres
 * - Graceful browser SpeechSynthesis fallback on quota exhaustion or error
 */

import {
  DEFAULT_PIXEL_VOICE_SETTINGS,
  ISpeechInputProvider,
  ISpeechOutputProvider,
  MessagePlaybackState,
  PIXEL_TIMBRE_OPTIONS,
  PixelVoiceSettings,
} from '../../types/voice';
import { browserSpeechInput } from './browserSpeechInputProvider';
import { browserSpeechOutput } from './browserSpeechOutputProvider';
import { geminiTtsOutput } from './geminiTtsProvider';
import { cleanTextForSpeech } from '../../utils/speechTextCleaner';

const VOICE_SETTINGS_STORAGE_KEY = 'kiber_renderia_pixel_voice_settings_v3';

export class VoiceManager {
  private activeInputProvider: ISpeechInputProvider = browserSpeechInput;
  private currentSettings: PixelVoiceSettings;

  private currentPlaybackState: MessagePlaybackState = {
    messageId: null,
    status: 'idle',
    provider: 'gemini',
  };

  private playbackListeners = new Set<(state: MessagePlaybackState) => void>();

  constructor() {
    this.currentSettings = this.loadStoredSettings();

    // Listen to low-level state changes to keep unified state in sync
    geminiTtsOutput.onStateChange((speaking, msgId) => {
      if (this.currentPlaybackState.provider === 'gemini') {
        if (!speaking && this.currentPlaybackState.status === 'playing') {
          if (geminiTtsOutput.isPaused()) {
            this.updatePlaybackState({ status: 'paused', messageId: msgId });
          } else {
            this.updatePlaybackState({ status: 'idle', messageId: null });
          }
        }
      }
    });

    browserSpeechOutput.onStateChange((speaking, msgId) => {
      if (this.currentPlaybackState.provider === 'browser') {
        if (!speaking && this.currentPlaybackState.status === 'playing') {
          if (browserSpeechOutput.isPaused()) {
            this.updatePlaybackState({ status: 'paused', messageId: msgId });
          } else {
            this.updatePlaybackState({ status: 'idle', messageId: null });
          }
        }
      }
    });
  }

  public getInputProvider(): ISpeechInputProvider {
    return this.activeInputProvider;
  }

  public getOutputProvider(): ISpeechOutputProvider {
    if (this.currentSettings.ttsProviderId === 'browser') {
      return browserSpeechOutput;
    }
    return geminiTtsOutput;
  }

  public getGeminiOutputProvider(): ISpeechOutputProvider {
    return geminiTtsOutput;
  }

  public getBrowserOutputProvider(): ISpeechOutputProvider {
    return browserSpeechOutput;
  }

  public getSettings(): PixelVoiceSettings {
    return { ...this.currentSettings };
  }

  public updateSettings(partial: Partial<PixelVoiceSettings>): PixelVoiceSettings {
    this.currentSettings = {
      ...this.currentSettings,
      ...partial,
    };
    this.saveStoredSettings(this.currentSettings);
    return { ...this.currentSettings };
  }

  public getPlaybackState(): MessagePlaybackState {
    return { ...this.currentPlaybackState };
  }

  public onPlaybackStateChange(
    callback: (state: MessagePlaybackState) => void
  ): () => void {
    this.playbackListeners.add(callback);
    callback(this.getPlaybackState());
    return () => this.playbackListeners.delete(callback);
  }

  private updatePlaybackState(partial: Partial<MessagePlaybackState>): void {
    this.currentPlaybackState = {
      ...this.currentPlaybackState,
      ...partial,
    };
    const snapshot = { ...this.currentPlaybackState };
    for (const listener of this.playbackListeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.warn('[VoiceManager] State listener error:', err);
      }
    }
  }

  /**
   * Main player method for all specialist and Pixel messages.
   * Cleans text, halts previous playback, and starts TTS with fallback support.
   */
  public async playMessage(
    messageId: string,
    rawText: string,
    callbacks?: {
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (err: Error) => void;
      onFallbackUsed?: (reason: string) => void;
    }
  ): Promise<void> {
    // If this message is already paused, simply resume it
    if (
      this.currentPlaybackState.messageId === messageId &&
      this.currentPlaybackState.status === 'paused'
    ) {
      this.resumeMessage(messageId);
      return;
    }

    // Stop any existing playback first
    this.stopSpeaking();

    const cleaned = cleanTextForSpeech(rawText);
    if (!cleaned) {
      this.updatePlaybackState({
        messageId: null,
        status: 'idle',
      });
      return;
    }

    const s = this.currentSettings;
    const providerToUse = s.ttsProviderId === 'browser' ? 'browser' : 'gemini';

    this.updatePlaybackState({
      messageId,
      status: 'loading',
      provider: providerToUse,
      errorMessage: undefined,
      fallbackReason: undefined,
    });

    if (providerToUse === 'gemini') {
      const selectedTimbre =
        PIXEL_TIMBRE_OPTIONS.find((t) => t.id === s.selectedTimbreId) ||
        PIXEL_TIMBRE_OPTIONS[1]; // default: bright

      const voiceURI = `gemini://${s.selectedGeminiVoice || 'Aoede'}`;

      try {
        await geminiTtsOutput.speak(cleaned, {
          messageId,
          voiceURI,
          volume: s.volume,
          style: selectedTimbre.stylePrompt,
          onStart: () => {
            this.updatePlaybackState({
              messageId,
              status: 'playing',
              provider: 'gemini',
            });
            callbacks?.onStart?.();
          },
          onEnd: () => {
            this.updatePlaybackState({
              messageId: null,
              status: 'idle',
              provider: 'gemini',
            });
            callbacks?.onEnd?.();
          },
          onError: async (err) => {
            console.warn('[VoiceManager] Gemini TTS error:', err.message);
            if (!s.allowBrowserFallback) {
              this.updatePlaybackState({
                messageId,
                status: 'error',
                provider: 'gemini',
                errorMessage: err.message,
              });
              callbacks?.onError?.(err);
              return;
            }

            const fallbackNotice =
              'Озвучено через встроенный синтез браузера (квота или сбой Gemini TTS)';
            console.warn('[VoiceManager] Falling back to browser speech.');
            this.updatePlaybackState({
              messageId,
              status: 'loading',
              provider: 'browser',
              fallbackReason: fallbackNotice,
            });
            callbacks?.onFallbackUsed?.(fallbackNotice);

            geminiTtsOutput.stop();

            try {
              await browserSpeechOutput.speak(cleaned, {
                messageId,
                voiceURI: s.voiceURI,
                rate: s.rate,
                pitch: s.pitch,
                volume: s.volume,
                lang: 'ru-RU',
                onStart: () => {
                  this.updatePlaybackState({
                    messageId,
                    status: 'playing',
                    provider: 'browser',
                  });
                  callbacks?.onStart?.();
                },
                onEnd: () => {
                  this.updatePlaybackState({
                    messageId: null,
                    status: 'idle',
                    provider: 'browser',
                  });
                  callbacks?.onEnd?.();
                },
                onError: (bErr) => {
                  this.updatePlaybackState({
                    messageId,
                    status: 'error',
                    provider: 'browser',
                    errorMessage: bErr.message,
                  });
                  callbacks?.onError?.(bErr);
                },
              });
            } catch (fallbackErr: unknown) {
              const bErr =
                fallbackErr instanceof Error
                  ? fallbackErr
                  : new Error(String(fallbackErr));
              this.updatePlaybackState({
                messageId,
                status: 'error',
                provider: 'browser',
                errorMessage: bErr.message,
              });
              callbacks?.onError?.(bErr);
            }
          },
        });
      } catch (err: unknown) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        console.warn('[VoiceManager] Direct Gemini TTS exception:', errorObj.message);
        if (!s.allowBrowserFallback) {
          this.updatePlaybackState({
            messageId,
            status: 'error',
            provider: 'gemini',
            errorMessage: errorObj.message,
          });
          callbacks?.onError?.(errorObj);
          return;
        }

        const fallbackNotice =
          'Озвучено через встроенный синтез браузера (квота или сбой Gemini TTS)';
        this.updatePlaybackState({
          messageId,
          status: 'loading',
          provider: 'browser',
          fallbackReason: fallbackNotice,
        });
        callbacks?.onFallbackUsed?.(fallbackNotice);

        geminiTtsOutput.stop();

        try {
          await browserSpeechOutput.speak(cleaned, {
            messageId,
            voiceURI: s.voiceURI,
            rate: s.rate,
            pitch: s.pitch,
            volume: s.volume,
            lang: 'ru-RU',
            onStart: () => {
              this.updatePlaybackState({
                messageId,
                status: 'playing',
                provider: 'browser',
              });
              callbacks?.onStart?.();
            },
            onEnd: () => {
              this.updatePlaybackState({
                messageId: null,
                status: 'idle',
                provider: 'browser',
              });
              callbacks?.onEnd?.();
            },
            onError: (bErr) => {
              this.updatePlaybackState({
                messageId,
                status: 'error',
                provider: 'browser',
                errorMessage: bErr.message,
              });
              callbacks?.onError?.(bErr);
            },
          });
        } catch (bErr: unknown) {
          const fbErr =
            bErr instanceof Error ? bErr : new Error(String(bErr));
          this.updatePlaybackState({
            messageId,
            status: 'error',
            provider: 'browser',
            errorMessage: fbErr.message,
          });
          callbacks?.onError?.(fbErr);
        }
      }
      return;
    }

    // Direct Browser Speech Provider
    try {
      await browserSpeechOutput.speak(cleaned, {
        messageId,
        voiceURI: s.voiceURI,
        rate: s.rate,
        pitch: s.pitch,
        volume: s.volume,
        lang: 'ru-RU',
        onStart: () => {
          this.updatePlaybackState({
            messageId,
            status: 'playing',
            provider: 'browser',
          });
          callbacks?.onStart?.();
        },
        onEnd: () => {
          this.updatePlaybackState({
            messageId: null,
            status: 'idle',
            provider: 'browser',
          });
          callbacks?.onEnd?.();
        },
        onError: (err) => {
          this.updatePlaybackState({
            messageId,
            status: 'error',
            provider: 'browser',
            errorMessage: err.message,
          });
          callbacks?.onError?.(err);
        },
      });
    } catch (err: unknown) {
      const errObj = err instanceof Error ? err : new Error(String(err));
      this.updatePlaybackState({
        messageId,
        status: 'error',
        provider: 'browser',
        errorMessage: errObj.message,
      });
      callbacks?.onError?.(errObj);
    }
  }

  public pauseMessage(messageId?: string): void {
    if (messageId && this.currentPlaybackState.messageId !== messageId) return;

    if (this.currentPlaybackState.provider === 'gemini') {
      geminiTtsOutput.pause();
    } else {
      browserSpeechOutput.pause();
    }

    this.updatePlaybackState({ status: 'paused' });
  }

  public resumeMessage(messageId?: string): void {
    if (messageId && this.currentPlaybackState.messageId !== messageId) return;

    if (this.currentPlaybackState.provider === 'gemini') {
      geminiTtsOutput.resume();
    } else {
      browserSpeechOutput.resume();
    }

    this.updatePlaybackState({ status: 'playing' });
  }

  public stopMessage(messageId?: string): void {
    if (messageId && this.currentPlaybackState.messageId !== messageId) {
      return;
    }
    this.stopSpeaking();
  }

  /**
   * Compatibility alias for existing PixelCompanion code
   */
  public async speakReply(
    text: string,
    messageId?: string,
    callbacks?: {
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (err: Error) => void;
      onFallbackUsed?: (reason: string) => void;
    }
  ): Promise<void> {
    const id = messageId || `auto-${Date.now()}`;
    await this.playMessage(id, text, callbacks);
  }

  public stopSpeaking(): void {
    geminiTtsOutput.stop();
    browserSpeechOutput.stop();
    this.updatePlaybackState({
      messageId: null,
      status: 'idle',
      errorMessage: undefined,
    });
  }

  public isSpeaking(): boolean {
    return (
      this.currentPlaybackState.status === 'playing' ||
      this.currentPlaybackState.status === 'loading'
    );
  }

  public isPaused(): boolean {
    return this.currentPlaybackState.status === 'paused';
  }

  public getCurrentMessageId(): string | null {
    return this.currentPlaybackState.messageId;
  }

  private loadStoredSettings(): PixelVoiceSettings {
    try {
      if (typeof window === 'undefined') return DEFAULT_PIXEL_VOICE_SETTINGS;
      const raw = window.localStorage.getItem(VOICE_SETTINGS_STORAGE_KEY);
      if (!raw) return DEFAULT_PIXEL_VOICE_SETTINGS;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const timbre =
          parsed.selectedTimbreId === 'natural' ||
          parsed.selectedTimbreId === 'high' ||
          parsed.selectedTimbreId === 'bright'
            ? parsed.selectedTimbreId
            : 'bright';

        return {
          ttsProviderId:
            parsed.ttsProviderId === 'browser' ? 'browser' : 'gemini',
          selectedGeminiVoice:
            typeof parsed.selectedGeminiVoice === 'string'
              ? parsed.selectedGeminiVoice
              : 'Aoede',
          selectedTimbreId: timbre,
          selectedLiveVoice:
            typeof parsed.selectedLiveVoice === 'string'
              ? parsed.selectedLiveVoice
              : 'Kore',
          allowBrowserFallback:
            parsed.allowBrowserFallback !== undefined
              ? Boolean(parsed.allowBrowserFallback)
              : true,
          autoSpeakNewReplies: Boolean(parsed.autoSpeakNewReplies),
          voiceURI:
            typeof parsed.voiceURI === 'string' ? parsed.voiceURI : undefined,
          voiceName:
            typeof parsed.voiceName === 'string' ? parsed.voiceName : undefined,
          rate:
            typeof parsed.rate === 'number'
              ? Math.max(0.7, Math.min(1.8, parsed.rate))
              : 1.0,
          pitch:
            typeof parsed.pitch === 'number'
              ? Math.max(0.7, Math.min(1.3, parsed.pitch))
              : 1.05,
          volume:
            typeof parsed.volume === 'number'
              ? Math.max(0.1, Math.min(1.0, parsed.volume))
              : 1.0,
          wakeWordEnabled: Boolean(parsed.wakeWordEnabled),
          wakeWordSensitivity:
            parsed.wakeWordSensitivity === 'high' ? 'high' : 'normal',
        };
      }
    } catch {
      // ignore storage error
    }
    return DEFAULT_PIXEL_VOICE_SETTINGS;
  }

  private saveStoredSettings(settings: PixelVoiceSettings): void {
    try {
      if (typeof window === 'undefined') return;
      window.localStorage.setItem(
        VOICE_SETTINGS_STORAGE_KEY,
        JSON.stringify(settings)
      );
    } catch {
      // ignore storage error
    }
  }
}

export const voiceManager = new VoiceManager();
