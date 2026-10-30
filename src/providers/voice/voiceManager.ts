/**
 * Unified Voice Manager for Pixel Companion.
 * Coordinates STT (Speech-to-Text) and TTS (Text-to-Speech) providers.
 * Prepared for pluggable future engines (Silero, Whisper.cpp).
 */

import {
  DEFAULT_PIXEL_VOICE_SETTINGS,
  ISpeechInputProvider,
  ISpeechOutputProvider,
  PixelVoiceSettings,
} from '../../types/voice';
import { browserSpeechInput } from './browserSpeechInputProvider';
import { browserSpeechOutput } from './browserSpeechOutputProvider';

const VOICE_SETTINGS_STORAGE_KEY = 'kiber_renderia_pixel_voice_settings_v1';

export class VoiceManager {
  private activeInputProvider: ISpeechInputProvider = browserSpeechInput;
  private activeOutputProvider: ISpeechOutputProvider = browserSpeechOutput;
  private currentSettings: PixelVoiceSettings;

  constructor() {
    this.currentSettings = this.loadStoredSettings();
  }

  public getInputProvider(): ISpeechInputProvider {
    return this.activeInputProvider;
  }

  public getOutputProvider(): ISpeechOutputProvider {
    return this.activeOutputProvider;
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
    }
  ): Promise<void> {
    const s = this.currentSettings;
    await this.activeOutputProvider.speak(text, {
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
    this.activeOutputProvider.stop();
  }

  public isSpeaking(): boolean {
    return this.activeOutputProvider.isSpeaking();
  }

  private loadStoredSettings(): PixelVoiceSettings {
    try {
      if (typeof window === 'undefined') return DEFAULT_PIXEL_VOICE_SETTINGS;
      const raw = window.localStorage.getItem(VOICE_SETTINGS_STORAGE_KEY);
      if (!raw) return DEFAULT_PIXEL_VOICE_SETTINGS;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          autoSpeakNewReplies: Boolean(parsed.autoSpeakNewReplies),
          voiceURI: typeof parsed.voiceURI === 'string' ? parsed.voiceURI : undefined,
          voiceName: typeof parsed.voiceName === 'string' ? parsed.voiceName : undefined,
          rate: typeof parsed.rate === 'number' ? Math.max(0.7, Math.min(1.8, parsed.rate)) : 1.0,
          pitch: typeof parsed.pitch === 'number' ? Math.max(0.7, Math.min(1.3, parsed.pitch)) : 1.05,
          volume: typeof parsed.volume === 'number' ? Math.max(0.1, Math.min(1.0, parsed.volume)) : 1.0,
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
