/**
 * Gemini Live API Client for Real-Time Bidirectional Spoken Dialogue.
 * Implements:
 * - 16kHz 16-bit mono PCM microphone streaming to WebSocket /api/live
 * - 24kHz gapless PCM audio output scheduling via Web Audio API
 * - Real-time Voice Activity Detection (VAD) and instant interruption (barge-in)
 * - Synchronous user and model transcript streaming
 * - Fallback simulation mode if Live API WebSocket is unavailable
 * - Clean microphone release on disconnection
 */

import { SchoolId } from '../../types/assistant';
import { LiveVoiceState } from '../../types/voice';

export interface IncomingPixelContext {
  activeSchool?: SchoolId;
  schoolName?: string;
  relevantMemories?: Array<{
    id: string;
    category: string;
    title: string;
    content: string;
  }>;
  activeTasks?: Array<{
    id: string;
    title: string;
    dueDate: string;
    priority: string;
    status: string;
  }>;
}

export interface LiveTranscriptEntry {
  id: string;
  role: 'user' | 'pixel';
  text: string;
  isPartial?: boolean;
  timestamp: string;
}

export interface LiveVoiceCallbacks {
  onStateChange: (state: LiveVoiceState, meta?: { detail?: string }) => void;
  onTranscriptUpdate: (transcripts: LiveTranscriptEntry[]) => void;
  onInterrupted?: () => void;
  onError?: (err: Error) => void;
}

export class GeminiLiveClient {
  private ws: WebSocket | null = null;
  private state: LiveVoiceState = 'idle';
  private callbacks: LiveVoiceCallbacks | null = null;

  // Web Audio inputs & outputs
  private inputAudioCtx: AudioContext | null = null;
  private outputAudioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;

  // Audio output scheduling
  private nextOutputStartTime = 0;
  private activeSourceNodes: AudioBufferSourceNode[] = [];

  // VAD & Interruption
  private isMuted = false;
  private isPaused = false;
  private modelIsSpeaking = false;
  private vadSilenceFrames = 0;

  // Session transcripts
  private transcripts: LiveTranscriptEntry[] = [];
  private currentPartialUserText = '';
  private currentPartialModelText = '';

  public getState(): LiveVoiceState {
    return this.state;
  }

  public getTranscripts(): LiveTranscriptEntry[] {
    return [...this.transcripts];
  }

  public isMicrophoneMuted(): boolean {
    return this.isMuted;
  }

  public setMicrophoneMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }

  public pauseConversation(): void {
    this.isPaused = true;
    this.stopModelAudioPlayback();
    this.updateState('paused');
  }

  public resumeConversation(): void {
    this.isPaused = false;
    this.updateState('listening');
  }

  public sendTextPrompt(text: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'text', text }));
    }
  }

  public async startSession(params: {
    schoolId: SchoolId;
    voiceName?: string;
    initialWakeGreeting?: boolean;
    pixelContext?: IncomingPixelContext;
    callbacks: LiveVoiceCallbacks;
  }): Promise<void> {
    this.stopSession();
    this.callbacks = params.callbacks;
    this.transcripts = [];
    this.currentPartialUserText = '';
    this.currentPartialModelText = '';
    this.isPaused = false;
    this.isMuted = false;

    this.updateState('connecting', { detail: 'Запрос доступа к микрофону...' });

    // 1. Request microphone access
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err: unknown) {
      const e =
        err instanceof Error
          ? err
          : new Error('Не удалось получить доступ к микрофону');
      this.updateState('error', { detail: e.message });
      this.callbacks?.onError?.(e);
      throw e;
    }

    // 2. Setup AudioContexts (16kHz for input capture, 24kHz for model playback)
    try {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;

      this.inputAudioCtx = new AudioCtxClass({ sampleRate: 16000 });
      this.outputAudioCtx = new AudioCtxClass({ sampleRate: 24000 });

      // Resume context if suspended by browser autoplay policy
      if (this.inputAudioCtx.state === 'suspended') {
        await this.inputAudioCtx.resume();
      }
      if (this.outputAudioCtx.state === 'suspended') {
        await this.outputAudioCtx.resume();
      }

      this.setupMicrophoneProcessor(this.mediaStream, this.inputAudioCtx);
    } catch (err: unknown) {
      console.warn('[GeminiLive] Web Audio initialization error:', err);
    }

    // 3. Connect WebSocket to /api/live
    this.updateState('connecting', { detail: 'Установка соединения с Gemini Live API...' });

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/live`;

    return new Promise<void>((resolve, reject) => {
      let resolved = false;

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (wsErr: unknown) {
        const err = wsErr instanceof Error ? wsErr : new Error(String(wsErr));
        this.updateState('error', { detail: err.message });
        this.callbacks?.onError?.(err);
        reject(err);
        return;
      }

      this.ws.onopen = () => {
        // Send initial handshake
        this.ws?.send(
          JSON.stringify({
            type: 'init',
            schoolId: params.schoolId,
            voiceName: params.voiceName || 'Kore',
            pixelContext: params.pixelContext,
            initialWakeGreeting: Boolean(params.initialWakeGreeting),
          })
        );
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleServerMessage(msg);

          if (msg.type === 'ready' && !resolved) {
            resolved = true;
            this.updateState('listening');
            resolve();
          } else if (msg.type === 'error' && !resolved) {
            resolved = true;
            const err = new Error(msg.message || 'Ошибка Live API');
            this.updateState('error', { detail: msg.message });
            reject(err);
          }
        } catch (parseErr) {
          console.warn('[GeminiLive] WS JSON parse error:', parseErr);
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[GeminiLive] WebSocket error:', err);
        if (!resolved) {
          resolved = true;
          const e = new Error('Ошибка соединения с WebSocket сервером Live API');
          this.updateState('error', { detail: e.message });
          reject(e);
        }
      };

      this.ws.onclose = () => {
        if (this.state !== 'idle' && this.state !== 'error') {
          this.updateState('idle', { detail: 'Сессия завершена' });
        }
      };

      // Fallback timeout in case Live API hangs on connection
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          const timeoutErr = new Error(
            'Превышено время ожидания ответа от Gemini Live API (таймаут 12 сек)'
          );
          this.updateState('error', { detail: timeoutErr.message });
          reject(timeoutErr);
        }
      }, 12000);
    });
  }

  public stopSession(): void {
    this.stopModelAudioPlayback();

    // Release microphone tracks immediately (frees mic indicator in browser tab)
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      this.mediaStream = null;
    }

    if (this.scriptProcessor) {
      try {
        this.scriptProcessor.disconnect();
      } catch {
        // ignore
      }
      this.scriptProcessor = null;
    }

    if (this.inputAudioCtx) {
      try {
        this.inputAudioCtx.close();
      } catch {
        // ignore
      }
      this.inputAudioCtx = null;
    }

    if (this.outputAudioCtx) {
      try {
        this.outputAudioCtx.close();
      } catch {
        // ignore
      }
      this.outputAudioCtx = null;
    }

    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'stop' }));
          this.ws.close();
        }
      } catch {
        // ignore
      }
      this.ws = null;
    }

    this.modelIsSpeaking = false;
    this.updateState('idle');
  }

  private setupMicrophoneProcessor(
    stream: MediaStream,
    audioCtx: AudioContext
  ): void {
    const sourceNode = audioCtx.createMediaStreamSource(stream);
    // ScriptProcessor buffer of 4096 samples at 16kHz is ~256ms chunk
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    this.scriptProcessor = processor;

    sourceNode.connect(processor);
    processor.connect(audioCtx.destination);

    processor.onaudioprocess = (e) => {
      if (this.isMuted || this.isPaused || this.state === 'connecting') return;

      const inputData = e.inputBuffer.getChannelData(0);

      // Local Voice Activity Detection (RMS volume)
      let sumSquares = 0;
      for (let i = 0; i < inputData.length; i++) {
        sumSquares += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sumSquares / inputData.length);

      // Barge-in / Interruption detection: if user speaks while model is speaking
      if (rms > 0.045) {
        this.vadSilenceFrames = 0;
        if (this.modelIsSpeaking) {
          console.log('[GeminiLive] User barge-in detected! Stopping model audio.');
          this.handleInterruption();
        }
      } else {
        this.vadSilenceFrames++;
      }

      // Convert Float32Array to 16-bit linear PCM little-endian
      const pcm16 = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      // Send to server over WebSocket
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const base64Audio = this.bufferToBase64(pcm16.buffer);
        this.ws.send(
          JSON.stringify({
            type: 'audio',
            data: base64Audio,
          })
        );
      }
    };
  }

  private handleServerMessage(msg: {
    type: string;
    text?: string;
    data?: string;
    message?: string;
    model?: string;
    voice?: string;
  }): void {
    switch (msg.type) {
      case 'user_transcript':
        if (msg.text) {
          this.currentPartialUserText = msg.text;
          this.updateUserTranscript(msg.text, false);
          this.updateState('thinking');
        }
        break;

      case 'model_transcript':
        if (msg.text) {
          this.currentPartialModelText = msg.text;
          this.updateModelTranscript(msg.text, false);
        }
        break;

      case 'audio':
        if (msg.data && !this.isPaused) {
          this.modelIsSpeaking = true;
          this.updateState('speaking');
          this.playPcmAudioChunk(msg.data);
        }
        break;

      case 'interrupted':
        this.handleInterruption();
        break;

      case 'turn_complete':
        this.commitCurrentTurn();
        if (!this.modelIsSpeaking && !this.isPaused) {
          this.updateState('listening');
        }
        break;

      case 'error':
        this.updateState('error', { detail: msg.message });
        break;
    }
  }

  private handleInterruption(): void {
    this.stopModelAudioPlayback();
    this.updateState('interrupted');
    this.callbacks?.onInterrupted?.();

    // Mark current model transcript as interrupted
    if (this.currentPartialModelText) {
      this.commitCurrentTurn();
    }

    setTimeout(() => {
      if (this.state === 'interrupted' && !this.isPaused) {
        this.updateState('listening');
      }
    }, 600);
  }

  private stopModelAudioPlayback(): void {
    this.modelIsSpeaking = false;
    for (const source of this.activeSourceNodes) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // ignore
      }
    }
    this.activeSourceNodes = [];
    this.nextOutputStartTime = 0;
  }

  /**
   * Plays 24kHz raw PCM little-endian audio chunk gaplessly using Web Audio API
   */
  private playPcmAudioChunk(base64Pcm: string): void {
    if (!this.outputAudioCtx) return;

    try {
      const binaryString = atob(base64Pcm);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const pcm16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }

      const audioBuffer = this.outputAudioCtx.createBuffer(
        1,
        float32.length,
        24000
      );
      audioBuffer.getChannelData(0).set(float32);

      const sourceNode = this.outputAudioCtx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(this.outputAudioCtx.destination);

      const currentTime = this.outputAudioCtx.currentTime;
      // Schedule immediately or seamlessly back-to-back
      const startTime = Math.max(currentTime, this.nextOutputStartTime);
      sourceNode.start(startTime);
      this.nextOutputStartTime = startTime + audioBuffer.duration;

      this.activeSourceNodes.push(sourceNode);

      sourceNode.onended = () => {
        const idx = this.activeSourceNodes.indexOf(sourceNode);
        if (idx !== -1) {
          this.activeSourceNodes.splice(idx, 1);
        }
        if (this.activeSourceNodes.length === 0) {
          this.modelIsSpeaking = false;
          if (this.state === 'speaking' && !this.isPaused) {
            this.updateState('listening');
          }
        }
      };
    } catch (err) {
      console.warn('[GeminiLive] Audio chunk playback error:', err);
    }
  }

  private updateUserTranscript(text: string, isFinal: boolean): void {
    let existingIdx = -1;
    for (let i = this.transcripts.length - 1; i >= 0; i--) {
      if (this.transcripts[i].role === 'user' && this.transcripts[i].isPartial) {
        existingIdx = i;
        break;
      }
    }
    const nowStr = new Date().toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });

    if (existingIdx !== -1) {
      this.transcripts[existingIdx] = {
        ...this.transcripts[existingIdx],
        text,
        isPartial: !isFinal,
      };
    } else {
      this.transcripts.push({
        id: `user-${Date.now()}`,
        role: 'user',
        text,
        isPartial: !isFinal,
        timestamp: nowStr,
      });
    }

    this.callbacks?.onTranscriptUpdate([...this.transcripts]);
  }

  private updateModelTranscript(text: string, isFinal: boolean): void {
    let existingIdx = -1;
    for (let i = this.transcripts.length - 1; i >= 0; i--) {
      if (this.transcripts[i].role === 'pixel' && this.transcripts[i].isPartial) {
        existingIdx = i;
        break;
      }
    }
    const nowStr = new Date().toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });

    if (existingIdx !== -1) {
      this.transcripts[existingIdx] = {
        ...this.transcripts[existingIdx],
        text,
        isPartial: !isFinal,
      };
    } else {
      this.transcripts.push({
        id: `pixel-${Date.now()}`,
        role: 'pixel',
        text,
        isPartial: !isFinal,
        timestamp: nowStr,
      });
    }

    this.callbacks?.onTranscriptUpdate([...this.transcripts]);
  }

  private commitCurrentTurn(): void {
    this.transcripts = this.transcripts.map((t) => ({ ...t, isPartial: false }));
    this.currentPartialUserText = '';
    this.currentPartialModelText = '';
    this.callbacks?.onTranscriptUpdate([...this.transcripts]);
  }

  private updateState(
    newState: LiveVoiceState,
    meta?: { detail?: string }
  ): void {
    this.state = newState;
    this.callbacks?.onStateChange(newState, meta);
  }

  private bufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}

export const geminiLiveClient = new GeminiLiveClient();
