/**
 * Studio-quality Gemini Text-to-Speech Output Provider.
 * Calls the secure backend proxy endpoint POST /api/voice/tts (using @google/genai interactions.create).
 * Audio is returned as 24kHz 16-bit mono WAV and played via browser Audio API.
 */

import {
  GEMINI_TTS_STANDARD_STYLE,
  GEMINI_TTS_VOICES,
  ISpeechOutputProvider,
  SpeechOutputOptions,
  SpeechVoiceOption,
} from '../../types/voice';
import { cleanTextForSpeech } from '../../utils/speechTextCleaner';

export class GeminiTtsOutputProvider implements ISpeechOutputProvider {
  public readonly id = 'gemini';
  public readonly name = 'Google Gemini TTS (Студийные нейроголоса 24 кГц)';

  private currentAudio: HTMLAudioElement | null = null;
  private currentMessageId: string | null = null;
  private abortController: AbortController | null = null;
  private speaking = false;
  private stateChangeListeners = new Set<
    (speaking: boolean, messageId: string | null) => void
  >();

  public isSupported(): boolean {
    return typeof window !== 'undefined' && typeof window.Audio !== 'undefined';
  }

  public async getVoices(): Promise<SpeechVoiceOption[]> {
    return GEMINI_TTS_VOICES.map((v, idx) => ({
      voiceURI: `gemini://${v.id}`,
      name: `${v.name} (${v.description})`,
      lang: 'ru-RU',
      isRussian: true,
      isDefault: idx === 0,
      isLocalService: false,
      source: 'gemini_tts',
    }));
  }

  public async speak(text: string, options?: SpeechOutputOptions): Promise<void> {
    this.stop();

    const cleaned = cleanTextForSpeech(text);
    if (!cleaned) {
      options?.onEnd?.();
      return;
    }

    const messageId = options?.messageId || null;
    this.currentMessageId = messageId;
    this.updateSpeaking(true, messageId);
    options?.onStart?.();

    const controller = new AbortController();
    this.abortController = controller;

    try {
      const voiceId = this.extractVoiceId(options?.voiceURI) || 'Aoede';
      const style = options?.style || GEMINI_TTS_STANDARD_STYLE;
      const model = options?.model || 'gemini-3.8-flash-lite-tts';

      const response = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text: cleaned,
          voice: voiceId,
          style,
          model,
        }),
      });

      if (!response.ok) {
        let errorDetail = `HTTP ${response.status}`;
        try {
          const errJson = await response.json();
          if (errJson?.error) errorDetail = errJson.error;
        } catch {
          // ignore json parse error
        }
        throw new Error(errorDetail);
      }

      const data = await response.json();
      if (!data?.audioBase64) {
        throw new Error('Пустой аудио-поток от сервера Gemini TTS');
      }

      // Check if aborted while downloading json
      if (controller.signal.aborted) {
        return;
      }

      const mimeType = data.mimeType || 'audio/wav';
      const audioUrl = `data:${mimeType};base64,${data.audioBase64}`;

      const audio = new Audio(audioUrl);
      this.currentAudio = audio;

      if (typeof options?.volume === 'number') {
        audio.volume = Math.max(0, Math.min(1, options.volume));
      }

      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          this.currentAudio = null;
          this.updateSpeaking(false, null);
          options?.onEnd?.();
          resolve();
        };

        audio.onerror = () => {
          this.currentAudio = null;
          this.updateSpeaking(false, null);
          const err = new Error('Ошибка воспроизведения аудиофайла Gemini TTS');
          options?.onError?.(err);
          reject(err);
        };

        audio.play().catch((playErr) => {
          this.currentAudio = null;
          this.updateSpeaking(false, null);
          options?.onError?.(playErr);
          reject(playErr);
        });
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Request was intentionally stopped/aborted; silently clean up
        this.currentAudio = null;
        this.updateSpeaking(false, null);
        return;
      }
      this.currentAudio = null;
      this.updateSpeaking(false, null);
      const e = err instanceof Error ? err : new Error(String(err));
      options?.onError?.(e);
      throw e;
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }

  public stop(): void {
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {
        // ignore
      }
      this.abortController = null;
    }
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch {
        // ignore audio pause error
      }
      this.currentAudio = null;
    }
    this.updateSpeaking(false, null);
  }

  public pause(): void {
    if (this.currentAudio && !this.currentAudio.paused) {
      this.currentAudio.pause();
      this.updateSpeaking(false, this.currentMessageId);
    }
  }

  public resume(): void {
    if (this.currentAudio && this.currentAudio.paused) {
      this.currentAudio.play().catch(() => {});
      this.updateSpeaking(true, this.currentMessageId);
    }
  }

  public isSpeaking(): boolean {
    return this.speaking;
  }

  public getCurrentMessageId(): string | null {
    return this.currentMessageId;
  }

  public onStateChange(
    callback: (speaking: boolean, messageId: string | null) => void
  ): () => void {
    this.stateChangeListeners.add(callback);
    return () => this.stateChangeListeners.delete(callback);
  }

  private updateSpeaking(speaking: boolean, messageId: string | null): void {
    this.speaking = speaking;
    this.currentMessageId = messageId;
    for (const listener of this.stateChangeListeners) {
      try {
        listener(speaking, messageId);
      } catch {
        // ignore listener error
      }
    }
  }

  private extractVoiceId(voiceURI?: string): string | null {
    if (!voiceURI) return null;
    if (voiceURI.startsWith('gemini://')) {
      return voiceURI.replace('gemini://', '');
    }
    return voiceURI;
  }
}

export const geminiTtsOutput = new GeminiTtsOutputProvider();
