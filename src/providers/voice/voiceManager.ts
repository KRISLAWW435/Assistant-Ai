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

export function resolveBrowserPitchForTimbre(
  timbreId: PixelVoiceSettings['selectedTimbreId'],
  basePitch: number
): number {
  if (timbreId === 'natural') {
    return Math.max(0.7, Math.min(1.2, basePitch * 0.95));
  }
  if (timbreId === 'bright') {
    return Math.max(0.8, Math.min(1.4, basePitch * 1.1));
  }
  if (timbreId === 'high') {
    return Math.max(0.9, Math.min(1.6, basePitch * 1.25));
  }
  return basePitch;
}

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
    this.currentSettings = this.loadStoredSettings();
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
      forceRefresh?: boolean;
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

    // Always dynamically load fresh settings from storage before playback
    this.currentSettings = this.loadStoredSettings();
    const s = this.currentSettings;
    const providerToUse = s.ttsProviderId === 'browser' ? 'browser' : 'gemini';

    const selectedTimbre =
      PIXEL_TIMBRE_OPTIONS.find((t) => t.id === s.selectedTimbreId) ||
      PIXEL_TIMBRE_OPTIONS[1]; // default: bright

    const voiceId = s.selectedGeminiVoice || 'Aoede';
    const ttsModel = s.ttsModel || 'gemini-3.8-flash-lite-tts';

    this.updatePlaybackState({
      messageId,
      status: 'loading',
      provider: providerToUse,
      voiceName: providerToUse === 'gemini' ? voiceId : (s.voiceName || 'Системный голос'),
      timbreId: s.selectedTimbreId,
      timbreName: selectedTimbre.name,
      model: ttsModel,
      fromCache: undefined,
      isFallback: false,
      errorMessage: undefined,
      fallbackReason: undefined,
    });

    if (providerToUse === 'gemini') {
      const voiceURI = `gemini://${voiceId}`;

      try {
        await geminiTtsOutput.speak(cleaned, {
          messageId,
          voiceURI,
          volume: s.volume,
          style: selectedTimbre.stylePrompt,
          timbreId: s.selectedTimbreId,
          model: ttsModel,
          forceRefresh: Boolean(callbacks?.forceRefresh),
          onMetaResolved: (meta) => {
            this.updatePlaybackState({
              messageId,
              provider: 'gemini',
              voiceName: meta.voice,
              timbreName: selectedTimbre.name,
              timbreId: s.selectedTimbreId,
              model: meta.model,
              fromCache: meta.fromCache,
              isFallback: false,
            });
          },
          onStart: () => {
            this.updatePlaybackState({
              messageId,
              status: 'playing',
              provider: 'gemini',
              voiceName: voiceId,
              timbreName: selectedTimbre.name,
              isFallback: false,
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
        });
        return;
      } catch (err: unknown) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        console.warn('[VoiceManager] Gemini TTS error, assessing fallback:', errorObj.message);

        if (!s.allowBrowserFallback) {
          this.updatePlaybackState({
            messageId,
            status: 'error',
            provider: 'gemini',
            errorMessage: errorObj.message,
            isFallback: false,
          });
          callbacks?.onError?.(errorObj);
          return;
        }

        const fallbackNotice =
          'Используется системный голос браузера (квота или сбой Gemini TTS)';
        console.warn('[VoiceManager] Switching to browser speech fallback:', fallbackNotice);
        this.updatePlaybackState({
          messageId,
          status: 'loading',
          provider: 'browser',
          isFallback: true,
          fallbackReason: fallbackNotice,
        });
        callbacks?.onFallbackUsed?.(fallbackNotice);

        geminiTtsOutput.stop();

        try {
          await browserSpeechOutput.speak(cleaned, {
            messageId,
            voiceURI: s.voiceURI,
            rate: s.rate,
            pitch: resolveBrowserPitchForTimbre(s.selectedTimbreId, s.pitch),
            volume: s.volume,
            lang: 'ru-RU',
            onStart: () => {
              this.updatePlaybackState({
                messageId,
                status: 'playing',
                provider: 'browser',
                isFallback: true,
                fallbackReason: fallbackNotice,
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
                isFallback: true,
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
            isFallback: true,
            errorMessage: fbErr.message,
          });
          callbacks?.onError?.(fbErr);
        }
        return;
      }
    }

    // Direct Browser Speech Provider
    try {
      await browserSpeechOutput.speak(cleaned, {
        messageId,
        voiceURI: s.voiceURI,
        rate: s.rate,
        pitch: resolveBrowserPitchForTimbre(s.selectedTimbreId, s.pitch),
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
      forceRefresh?: boolean;
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

  public stopAll(): void {
    this.stopSpeaking();
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
      let raw = window.localStorage.getItem(VOICE_SETTINGS_STORAGE_KEY);
      if (!raw) {
        // Fallback check for legacy storage keys
        raw =
          window.localStorage.getItem('kiber_renderia_pixel_voice_settings_v2') ||
          window.localStorage.getItem('kiber_renderia_pixel_voice_settings');
      }
      if (!raw) return DEFAULT_PIXEL_VOICE_SETTINGS;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const timbre =
          parsed.selectedTimbreId === 'natural' ||
          parsed.selectedTimbreId === 'high' ||
          parsed.selectedTimbreId === 'bright'
            ? parsed.selectedTimbreId
            : 'bright';

        const validVoices = ['Aoede', 'Achernar', 'Sulafat', 'Vindemiatrix'];
        const voice = validVoices.includes(parsed.selectedGeminiVoice)
          ? parsed.selectedGeminiVoice
          : 'Aoede';

        return {
          ttsProviderId:
            parsed.ttsProviderId === 'browser' ? 'browser' : 'gemini',
          selectedGeminiVoice: voice,
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
          ttsModel:
            typeof parsed.ttsModel === 'string' && parsed.ttsModel
              ? parsed.ttsModel
              : 'gemini-3.8-flash-lite-tts',
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
