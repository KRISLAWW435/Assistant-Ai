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
import {
  cleanTextForSpeech,
  splitTextIntoSpeechChunks,
} from '../../utils/speechTextCleaner';

const ENVELOPE_FPS = 25; // 40ms frames for smooth lip-sync

/**
 * Computes a normalized (0..1) RMS volume envelope from a base64-encoded 16-bit PCM WAV file.
 * Falls back gracefully to a natural speech syllable envelope if WAV header differs.
 */
function extractWavVolumeEnvelope(audioBase64: string): number[] {
  try {
    const binary = atob(audioBase64);
    const len = binary.length;
    if (len < 100) return [];

    // Standard WAV header is 44 bytes; 24kHz 16-bit mono = 48000 bytes/sec
    const headerOffset = 44;
    const sampleRate = 24000;
    const samplesPerFrame = Math.floor(sampleRate / ENVELOPE_FPS); // 960 samples (1920 bytes) per 40ms frame
    const bytesPerFrame = samplesPerFrame * 2;

    const envelope: number[] = [];
    for (let offset = headerOffset; offset + 2 < len; offset += bytesPerFrame) {
      const end = Math.min(len - 1, offset + bytesPerFrame);
      let sumSq = 0;
      let count = 0;
      // Step by 4 bytes (every 2nd sample) for fast, accurate RMS
      for (let i = offset; i + 1 < end; i += 4) {
        const lo = binary.charCodeAt(i);
        const hi = binary.charCodeAt(i + 1);
        let sample = (hi << 8) | lo;
        if (sample & 0x8000) sample = sample - 0x10000;
        const norm = sample / 32768;
        sumSq += norm * norm;
        count++;
      }
      if (count > 0) {
        const rms = Math.sqrt(sumSq / count);
        // Scale RMS (typical speech RMS is 0.03..0.28) into 0..1
        const level = Math.min(1, Math.max(0, (rms - 0.012) * 4.5));
        envelope.push(Number(level.toFixed(3)));
      }
    }
    return envelope;
  } catch {
    return [];
  }
}

export class GeminiTtsOutputProvider implements ISpeechOutputProvider {
  public readonly id = 'gemini';
  public readonly name = 'Google Gemini TTS (Студийные нейроголоса 24 кГц)';

  private currentAudio: HTMLAudioElement | null = null;
  private currentMessageId: string | null = null;
  private abortController: AbortController | null = null;
  private speaking = false;
  private isPausedState = false;
  private levelInterval: ReturnType<typeof setInterval> | null = null;
  private stateChangeListeners = new Set<
    (speaking: boolean, messageId: string | null) => void
  >();
  private audioLevelListeners = new Set<(level: number) => void>();

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

    // Split long text into natural sentence chunks (~520 chars) so long responses are read verbatim to the end
    const chunks = splitTextIntoSpeechChunks(cleaned, 520);
    if (chunks.length === 0) {
      options?.onEnd?.();
      return;
    }

    const startIdx = Math.max(
      0,
      Math.min(chunks.length - 1, options?.startChunkIndex ?? 0)
    );

    const messageId = options?.messageId || null;
    this.currentMessageId = messageId;
    this.isPausedState = false;
    this.updateSpeaking(true, messageId);
    options?.onStart?.();

    const controller = new AbortController();
    this.abortController = controller;

    const voiceId = this.extractVoiceId(options?.voiceURI) || 'Aoede';
    const style = options?.style || GEMINI_TTS_STANDARD_STYLE;
    const model = options?.model || 'gemini-3.8-flash-lite-tts';

    const fetchChunkAudio = async (chunkText: string) => {
      const response = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text: chunkText,
          voice: voiceId,
          style,
          model,
          timbreId: options?.timbreId,
          forceRefresh: Boolean(options?.forceRefresh),
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
      return data as {
        audioBase64: string;
        mimeType?: string;
        voice?: string;
        model?: string;
        timbre?: string;
        fromCache?: boolean;
      };
    };

    try {
      let nextChunkPromise: ReturnType<typeof fetchChunkAudio> | null =
        fetchChunkAudio(chunks[startIdx]);

      for (let i = startIdx; i < chunks.length; i++) {
        if (controller.signal.aborted) {
          return;
        }

        options?.onChunkProgress?.(i, chunks.length);

        const currentPromise = nextChunkPromise || fetchChunkAudio(chunks[i]);
        // Prefetch the following chunk in parallel so sequential reading has no gap
        if (i + 1 < chunks.length) {
          const prefetch = fetchChunkAudio(chunks[i + 1]);
          // Prevent unhandled rejection if current chunk fails or is aborted
          prefetch.catch(() => {});
          nextChunkPromise = prefetch;
        } else {
          nextChunkPromise = null;
        }

        const data = await currentPromise;
        if (controller.signal.aborted) {
          return;
        }

        if (i === startIdx) {
          options?.onMetaResolved?.({
            provider: 'gemini',
            voice: data.voice || voiceId,
            model: data.model || model,
            timbre: data.timbre || options?.timbreId,
            fromCache: Boolean(data.fromCache),
            isFallback: false,
          });
        }

        const mimeType = data.mimeType || 'audio/wav';
        const audioUrl = `data:${mimeType};base64,${data.audioBase64}`;
        const envelope = extractWavVolumeEnvelope(data.audioBase64);

        const audio = new Audio(audioUrl);
        this.currentAudio = audio;

        if (typeof options?.volume === 'number') {
          audio.volume = Math.max(0, Math.min(1, options.volume));
        }

        this.startAudioLevelTracking(audio, envelope, options?.onAudioLevel);

        await new Promise<void>((resolve, reject) => {
          audio.onended = () => {
            this.stopAudioLevelTracking(options?.onAudioLevel);
            this.currentAudio = null;
            resolve();
          };

          audio.onerror = () => {
            this.stopAudioLevelTracking(options?.onAudioLevel);
            this.currentAudio = null;
            const err = new Error('Ошибка воспроизведения аудиофайла Gemini TTS');
            reject(err);
          };

          audio.play().catch((playErr) => {
            this.stopAudioLevelTracking(options?.onAudioLevel);
            this.currentAudio = null;
            reject(playErr);
          });
        });
      }

      if (!controller.signal.aborted) {
        this.stopAudioLevelTracking(options?.onAudioLevel);
        this.currentAudio = null;
        this.updateSpeaking(false, null);
        options?.onEnd?.();
      }
    } catch (err: unknown) {
      this.stopAudioLevelTracking(options?.onAudioLevel);
      if (
        (err instanceof Error && err.name === 'AbortError') ||
        controller.signal.aborted
      ) {
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

  private startAudioLevelTracking(
    audio: HTMLAudioElement,
    envelope: number[],
    onLevel?: (level: number) => void
  ): void {
    this.stopAudioLevelTracking(onLevel);
    let tick = 0;
    this.levelInterval = setInterval(() => {
      if (!this.currentAudio || this.currentAudio !== audio || audio.paused) {
        this.emitAudioLevel(0, onLevel);
        return;
      }
      tick++;
      let level = 0;
      if (envelope.length > 0) {
        const frameIdx = Math.floor(audio.currentTime * ENVELOPE_FPS);
        level = envelope[Math.min(envelope.length - 1, Math.max(0, frameIdx))] ?? 0;
      } else {
        // Fallback natural syllable cadence if non-WAV
        level = 0.35 + 0.35 * Math.abs(Math.sin(tick * 0.55));
      }
      this.emitAudioLevel(level, onLevel);
    }, 40);
  }

  private stopAudioLevelTracking(onLevel?: (level: number) => void): void {
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
    this.stopAudioLevelTracking();
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
    this.isPausedState = false;
    this.updateSpeaking(false, null);
  }

  public pause(): void {
    if (this.currentAudio && !this.currentAudio.paused) {
      this.currentAudio.pause();
      this.isPausedState = true;
      this.emitAudioLevel(0);
      this.updateSpeaking(false, this.currentMessageId);
    }
  }

  public resume(): void {
    if (this.currentAudio && this.currentAudio.paused) {
      this.currentAudio.play().catch(() => {});
      this.isPausedState = false;
      this.updateSpeaking(true, this.currentMessageId);
    }
  }

  public isSpeaking(): boolean {
    return this.speaking;
  }

  public isPaused(): boolean {
    return this.isPausedState;
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
    if (!speaking) {
      this.emitAudioLevel(0);
    }
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
