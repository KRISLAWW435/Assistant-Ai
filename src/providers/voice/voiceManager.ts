/**
 * Unified Voice Manager for Pixel Companion.
 * Coordinates STT (Speech-to-Text) and TTS (Text-to-Speech) providers.
 * Supports Google Gemini TTS Studio (24kHz) and Browser Native (Web Speech API) fallback.
 */

import {
  DEFAULT_PIXEL_VOICE_SETTINGS,
  ISpeechInputProvider,
  ISpeechOutputProvider,
  PIXEL_TIMBRE_OPTIONS,
  PixelVoiceSettings,
} from '../../types/voice';
import { browserSpeechInput } from './browserSpeechInputProvider';
import { browserSpeechOutput } from './browserSpeechOutputProvider';
import { geminiTtsOutput } from './geminiTtsProvider';

const VOICE_SETTINGS_STORAGE_KEY = 'kiber_renderia_pixel_voice_settings_v2';

export class VoiceManager {
  private activeInputProvider: ISpeechInputProvider = browserSpeechInput;
  private currentSettings: PixelVoiceSettings;

  constructor() {
    this.currentSettings = this.loadStoredSettings();
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

  /**
   * Safe helper to speak text with currently active voice settings.
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
    const s = this.currentSettings;

    if (s.ttsProviderId === 'gemini') {
      const selectedTimbre =
        PIXEL_TIMBRE_OPTIONS.find((t) => t.id === s.selectedTimbreId) ||
        PIXEL_TIMBRE_OPTIONS[1]; // default: bright

      const voiceURI = `gemini://${s.selectedGeminiVoice || 'Aoede'}`;

      try {
        await geminiTtsOutput.speak(text, {
          messageId,
          voiceURI,
          volume: s.volume,
          style: selectedTimbre.stylePrompt,
          onStart: callbacks?.onStart,
          onEnd: callbacks?.onEnd,
          onError: (err) => {
            console.warn('[VoiceManager] Gemini TTS error:', err.message);
            if (!s.allowBrowserFallback) {
              callbacks?.onError?.(err);
              return;
            }
            console.warn('[VoiceManager] Falling back to browser speech.');
            callbacks?.onFallbackUsed?.(
              'Озвучено через встроенный синтез браузера (квота или сбой Gemini TTS)'
            );
            // Guarantee Gemini audio is halted before fallback playback
            geminiTtsOutput.stop();
            browserSpeechOutput
              .speak(text, {
                messageId,
                voiceURI: s.voiceURI,
                rate: s.rate,
                pitch: s.pitch,
                volume: s.volume,
                lang: 'ru-RU',
                onStart: callbacks?.onStart,
                onEnd: callbacks?.onEnd,
                onError: callbacks?.onError,
              })
              .catch(() => {});
          },
        });
        return;
      } catch (err: unknown) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        console.warn(
          '[VoiceManager] Gemini TTS call failed:',
          errorObj.message
        );
        if (!s.allowBrowserFallback) {
          callbacks?.onError?.(errorObj);
          throw errorObj;
        }

        console.warn('[VoiceManager] Executing browser speech fallback.');
        callbacks?.onFallbackUsed?.(
          'Озвучено через встроенный синтез браузера (квота или сбой Gemini TTS)'
        );
        geminiTtsOutput.stop();
        await browserSpeechOutput.speak(text, {
          messageId,
          voiceURI: s.voiceURI,
          rate: s.rate,
          pitch: s.pitch,
          volume: s.volume,
          lang: 'ru-RU',
          onStart: callbacks?.onStart,
          onEnd: callbacks?.onEnd,
          onError: callbacks?.onError,
        });
        return;
      }
    }

    // Direct browser speech provider
    await browserSpeechOutput.speak(text, {
      messageId,
      voiceURI: s.voiceURI,
      rate: s.rate,
      pitch: s.pitch,
      volume: s.volume,
      lang: 'ru-RU',
      onStart: callbacks?.onStart,
      onEnd: callbacks?.onEnd,
      onError: callbacks?.onError,
    });
  }

  public stopSpeaking(): void {
    geminiTtsOutput.stop();
    browserSpeechOutput.stop();
  }

  public isSpeaking(): boolean {
    return geminiTtsOutput.isSpeaking() || browserSpeechOutput.isSpeaking();
  }

  public getCurrentMessageId(): string | null {
    return (
      geminiTtsOutput.getCurrentMessageId() ||
      browserSpeechOutput.getCurrentMessageId()
    );
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
          allowBrowserFallback:
            parsed.allowBrowserFallback !== undefined
              ? Boolean(parsed.allowBrowserFallback)
              : true,
          autoSpeakNewReplies: Boolean(parsed.autoSpeakNewReplies),
          voiceURI: typeof parsed.voiceURI === 'string' ? parsed.voiceURI : undefined,
          voiceName: typeof parsed.voiceName === 'string' ? parsed.voiceName : undefined,
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
