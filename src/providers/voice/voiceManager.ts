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
import { geminiLiveClient } from './geminiLiveClient';
import {
  cleanTextForSpeech,
  splitTextIntoSpeechChunks,
} from '../../utils/speechTextCleaner';

const VOICE_SETTINGS_STORAGE_KEY = 'kiber_renderia_pixel_voice_settings_v3';

export interface StoppedReadingSession {
  playbackId: string;
  originalMessageId: string;
  rawText: string;
  cleanedText: string;
  chunks: string[];
  resumeChunkIndex: number;
  totalChunks: number;
  specialistTitle?: string;
  schoolName?: string;
  stoppedAtMs: number;
}

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

  private currentAudioLevel = 0;
  private activeReadingSession: StoppedReadingSession | null = null;
  private lastStoppedReading: StoppedReadingSession | null = null;

  private playbackListeners = new Set<(state: MessagePlaybackState) => void>();
  private audioLevelListeners = new Set<(level: number) => void>();
  private settingsListeners = new Set<(settings: PixelVoiceSettings) => void>();
  private stoppedReadingListeners = new Set<
    (stopped: StoppedReadingSession | null) => void
  >();

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

    // Subscribe to real-time audio volume levels across TTS and Live Voice for lip-sync
    geminiTtsOutput.onAudioLevelChange((level) => {
      if (this.currentPlaybackState.provider === 'gemini') {
        this.emitAudioLevel(level);
      }
    });

    browserSpeechOutput.onAudioLevelChange((level) => {
      if (this.currentPlaybackState.provider === 'browser') {
        this.emitAudioLevel(level);
      }
    });

    geminiLiveClient.onOutputAudioLevelChange((level) => {
      if (this.currentPlaybackState.status !== 'playing') {
        this.emitAudioLevel(level);
      }
    });
  }

  public getAudioLevel(): number {
    return this.currentAudioLevel;
  }

  public getCurrentSpokenText(): string | null {
    if (
      this.currentPlaybackState.status !== 'playing' &&
      this.currentPlaybackState.status !== 'loading'
    ) {
      return null;
    }
    if (!this.activeReadingSession) return null;
    const { chunks, resumeChunkIndex, cleanedText } = this.activeReadingSession;
    if (
      chunks &&
      chunks.length > 0 &&
      typeof resumeChunkIndex === 'number' &&
      chunks[resumeChunkIndex]
    ) {
      return chunks[resumeChunkIndex];
    }
    return cleanedText || null;
  }

  public onAudioLevelChange(callback: (level: number) => void): () => void {
    this.audioLevelListeners.add(callback);
    callback(this.currentAudioLevel);
    return () => this.audioLevelListeners.delete(callback);
  }

  private emitAudioLevel(level: number): void {
    const clamped = Math.max(0, Math.min(1, level));
    if (this.currentAudioLevel === clamped && clamped === 0) return;
    this.currentAudioLevel = clamped;
    for (const listener of this.audioLevelListeners) {
      try {
        listener(clamped);
      } catch {
        // ignore
      }
    }
  }

  public getStoppedReadingSession(): StoppedReadingSession | null {
    return this.lastStoppedReading ? { ...this.lastStoppedReading } : null;
  }

  public hasStoppedReading(): boolean {
    return Boolean(
      this.lastStoppedReading &&
        this.lastStoppedReading.resumeChunkIndex <
          this.lastStoppedReading.totalChunks
    );
  }

  public onStoppedReadingChange(
    callback: (stopped: StoppedReadingSession | null) => void
  ): () => void {
    this.stoppedReadingListeners.add(callback);
    callback(this.getStoppedReadingSession());
    return () => this.stoppedReadingListeners.delete(callback);
  }

  private setLastStoppedReading(session: StoppedReadingSession | null): void {
    this.lastStoppedReading = session;
    const snap = this.getStoppedReadingSession();
    for (const listener of this.stoppedReadingListeners) {
      try {
        listener(snap);
      } catch {
        // ignore
      }
    }
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

  public onSettingsChange(
    callback: (settings: PixelVoiceSettings) => void
  ): () => void {
    this.settingsListeners.add(callback);
    callback(this.getSettings());
    return () => this.settingsListeners.delete(callback);
  }

  public updateSettings(partial: Partial<PixelVoiceSettings>): PixelVoiceSettings {
    const prev = this.loadStoredSettings();
    this.currentSettings = {
      ...prev,
      ...partial,
      // Stage 6.5 (4): Strict on-demand reading only — never auto-speak new messages
      autoSpeakNewReplies: false,
      selectedTimbreId:
        partial.selectedTimbreId || prev.selectedTimbreId || 'bright',
    };
    this.saveStoredSettings(this.currentSettings);
    if (typeof partial.volume === 'number') {
      geminiTtsOutput.setVolume(this.currentSettings.volume);
    }
    if (partial.ttsEnabled === false) {
      this.stopSpeaking(false);
    }
    const snap = { ...this.currentSettings };
    for (const listener of this.settingsListeners) {
      try {
        listener(snap);
      } catch {
        // ignore listener error
      }
    }
    return snap;
  }

  public setVolume(volume: number): PixelVoiceSettings {
    const clamped = Math.max(0, Math.min(1, Number(volume) || 0));
    geminiTtsOutput.setVolume(clamped);
    return this.updateSettings({ volume: clamped });
  }

  public setTtsEnabled(enabled: boolean): PixelVoiceSettings {
    return this.updateSettings({ ttsEnabled: Boolean(enabled) });
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
    if (
      this.currentPlaybackState.status === 'idle' ||
      this.currentPlaybackState.status === 'paused' ||
      this.currentPlaybackState.status === 'error'
    ) {
      this.emitAudioLevel(0);
    }
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
   * Stage 6.4 (1): Reads a specialist's response verbatim using Pixel's own playback ID
   * (`pixel-verbatim-${originalMessageId}`) so the specialist's own TTS button in UnifiedChatView
   * is NEVER triggered, and supports continuing from the stopped chunk if interrupted.
   */
  public async playVerbatimSpecialistMessage(
    originalMessageId: string,
    rawText: string,
    options?: {
      specialistTitle?: string;
      schoolName?: string;
      startChunkIndex?: number;
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (err: Error) => void;
      onFallbackUsed?: (reason: string) => void;
      forceRefresh?: boolean;
    }
  ): Promise<void> {
    const pixelPlaybackId = originalMessageId.startsWith('pixel-verbatim-')
      ? originalMessageId
      : `pixel-verbatim-${originalMessageId}`;

    await this.playMessage(pixelPlaybackId, rawText, {
      ...options,
      originalMessageId: originalMessageId.replace(/^pixel-verbatim-/, ''),
    });
  }

  /**
   * Resumes a previously stopped/paused reading session from the exact chunk where it stopped.
   */
  public async resumeStoppedReading(callbacks?: {
    onFallbackUsed?: (reason: string) => void;
  }): Promise<boolean> {
    if (this.currentPlaybackState.status === 'paused' && this.currentPlaybackState.messageId) {
      this.resumeMessage(this.currentPlaybackState.messageId);
      return true;
    }
    if (!this.lastStoppedReading) {
      return false;
    }
    const session = this.lastStoppedReading;
    this.setLastStoppedReading(null);
    await this.playMessage(session.playbackId, session.rawText, {
      originalMessageId: session.originalMessageId,
      specialistTitle: session.specialistTitle,
      schoolName: session.schoolName,
      startChunkIndex: session.resumeChunkIndex,
      onFallbackUsed: callbacks?.onFallbackUsed,
    });
    return true;
  }

  /**
   * Main player method for all specialist and Pixel messages.
   * Cleans text, halts previous playback, and starts TTS with fallback support and chunk-level resume tracking.
   */
  public async playMessage(
    messageId: string,
    rawText: string,
    callbacks?: {
      originalMessageId?: string;
      specialistTitle?: string;
      schoolName?: string;
      startChunkIndex?: number;
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (err: Error) => void;
      onFallbackUsed?: (reason: string) => void;
      forceRefresh?: boolean;
    }
  ): Promise<void> {
    // If this message is already paused and no explicit startChunkIndex override is given, simply resume it
    if (
      callbacks?.startChunkIndex === undefined &&
      this.currentPlaybackState.messageId === messageId &&
      this.currentPlaybackState.status === 'paused'
    ) {
      this.resumeMessage(messageId);
      return;
    }

    // Stop any existing playback first without overwriting the new session we are about to start
    this.stopSpeaking(false);

    const cleaned = cleanTextForSpeech(rawText);
    if (!cleaned) {
      this.updatePlaybackState({
        messageId: null,
        status: 'idle',
      });
      return;
    }

    const chunks = splitTextIntoSpeechChunks(cleaned, 520);
    const startChunkIdx = Math.max(
      0,
      Math.min(Math.max(0, chunks.length - 1), callbacks?.startChunkIndex ?? 0)
    );

    let activeChunkIdx = startChunkIdx;
    this.activeReadingSession = {
      playbackId: messageId,
      originalMessageId: callbacks?.originalMessageId || messageId,
      rawText,
      cleanedText: cleaned,
      chunks,
      resumeChunkIndex: startChunkIdx,
      totalChunks: chunks.length,
      specialistTitle: callbacks?.specialistTitle,
      schoolName: callbacks?.schoolName,
      stoppedAtMs: Date.now(),
    };

    // Always dynamically load fresh settings from storage before playback
    this.currentSettings = this.loadStoredSettings();
    const s = this.currentSettings;
    if (s.ttsEnabled === false) {
      this.activeReadingSession = null;
      this.updatePlaybackState({
        messageId,
        status: 'error',
        provider: s.ttsProviderId === 'browser' ? 'browser' : 'gemini',
        errorMessage:
          'Голосовые ответы (TTS) выключены в правой панели настроек Пикселя.',
      });
      return;
    }
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

    const handleChunkProgress = (chunkIndex: number, totalChunks: number) => {
      activeChunkIdx = chunkIndex;
      if (this.activeReadingSession && this.activeReadingSession.playbackId === messageId) {
        this.activeReadingSession.resumeChunkIndex = chunkIndex;
        this.activeReadingSession.totalChunks = totalChunks;
      }
    };

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
          startChunkIndex: startChunkIdx,
          onChunkProgress: handleChunkProgress,
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
            if (this.activeReadingSession?.playbackId === messageId) {
              this.activeReadingSession = null;
              this.setLastStoppedReading(null);
            }
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
            startChunkIndex: activeChunkIdx,
            onChunkProgress: handleChunkProgress,
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
              if (this.activeReadingSession?.playbackId === messageId) {
                this.activeReadingSession = null;
                this.setLastStoppedReading(null);
              }
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
        startChunkIndex: startChunkIdx,
        onChunkProgress: handleChunkProgress,
        onStart: () => {
          this.updatePlaybackState({
            messageId,
            status: 'playing',
            provider: 'browser',
          });
          callbacks?.onStart?.();
        },
        onEnd: () => {
          if (this.activeReadingSession?.playbackId === messageId) {
            this.activeReadingSession = null;
            this.setLastStoppedReading(null);
          }
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

    if (this.activeReadingSession) {
      this.setLastStoppedReading({
        ...this.activeReadingSession,
        stoppedAtMs: Date.now(),
      });
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
    this.stopSpeaking(true);
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

  public stopSpeaking(recordForResume = true): void {
    if (
      recordForResume &&
      this.activeReadingSession &&
      (this.currentPlaybackState.status === 'playing' ||
        this.currentPlaybackState.status === 'loading' ||
        this.currentPlaybackState.status === 'paused')
    ) {
      this.setLastStoppedReading({
        ...this.activeReadingSession,
        stoppedAtMs: Date.now(),
      });
    }
    this.activeReadingSession = null;
    geminiTtsOutput.stop();
    browserSpeechOutput.stop();
    this.emitAudioLevel(0);
    this.updatePlaybackState({
      messageId: null,
      status: 'idle',
      errorMessage: undefined,
    });
  }

  public stopAll(): void {
    this.stopSpeaking(true);
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
        const validVoices = ['Aoede', 'Achernar', 'Sulafat', 'Vindemiatrix'];
        const voice = validVoices.includes(parsed.selectedGeminiVoice)
          ? parsed.selectedGeminiVoice
          : 'Aoede';

        const validTimbres = ['natural', 'bright', 'high'];
        const timbre = validTimbres.includes(parsed.selectedTimbreId)
          ? parsed.selectedTimbreId
          : 'bright';

        return {
          ttsEnabled:
            parsed.ttsEnabled !== undefined ? Boolean(parsed.ttsEnabled) : true,
          continuousListeningEnabled: Boolean(
            parsed.continuousListeningEnabled
          ),
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
          autoSpeakNewReplies: false,
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
              ? Math.max(0.0, Math.min(1.0, parsed.volume))
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
