/**
 * Browser native Speech-to-Text provider utilizing the Web Speech Recognition API.
 * (window.SpeechRecognition || window.webkitSpeechRecognition).
 */

import {
  ISpeechInputProvider,
  SpeechInputError,
  SpeechInputOptions,
  SpeechInputStatus,
} from '../../types/voice';

// Type definitions for Web Speech API in TypeScript without dom-speech lib
interface IWindowSpeechRecognition {
  new (): ISpeechRecognitionInstance;
}

interface ISpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onaudiostart: (() => void) | null;
  onsoundstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onsoundend: (() => void) | null;
  onaudioend: (() => void) | null;
  onresult: ((event: ISpeechRecognitionEvent) => void) | null;
  onerror: ((event: ISpeechRecognitionErrorEvent) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
}

interface ISpeechRecognitionEvent {
  resultIndex: number;
  results: {
    length: number;
    item(index: number): ISpeechRecognitionResult;
    [index: number]: ISpeechRecognitionResult;
  };
}

interface ISpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): ISpeechRecognitionAlternative;
  [index: number]: ISpeechRecognitionAlternative;
}

interface ISpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface ISpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

export class BrowserSpeechInputProvider implements ISpeechInputProvider {
  public readonly id = 'browser';
  public readonly name = 'Встроенное распознавание браузера (Web Speech API)';

  private recognition: ISpeechRecognitionInstance | null = null;
  private status: SpeechInputStatus = 'idle';
  private resultListeners = new Set<
    (transcript: string, isFinal: boolean) => void
  >();
  private errorListeners = new Set<(error: SpeechInputError) => void>();
  private statusListeners = new Set<(status: SpeechInputStatus) => void>();

  private intentionalStop = false;
  private currentOptions?: SpeechInputOptions;

  constructor() {
    this.updateStatus(this.isSupported() ? 'idle' : 'unsupported');
  }

  public isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    const win = window as unknown as {
      SpeechRecognition?: IWindowSpeechRecognition;
      webkitSpeechRecognition?: IWindowSpeechRecognition;
    };
    return Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
  }

  /**
   * Chromium's webkitSpeechRecognition sends audio stream to Google's cloud speech backend.
   * This method lets the UI transparently inform the user about speech service mode.
   */
  public isRemoteService(): boolean {
    if (typeof window === 'undefined') return false;
    const win = window as unknown as {
      SpeechRecognition?: IWindowSpeechRecognition;
      webkitSpeechRecognition?: IWindowSpeechRecognition;
    };
    return Boolean(win.webkitSpeechRecognition && !win.SpeechRecognition);
  }

  public getStatus(): SpeechInputStatus {
    return this.status;
  }

  public async start(options?: SpeechInputOptions): Promise<void> {
    if (!this.isSupported()) {
      const err: SpeechInputError = {
        code: 'not-supported',
        message:
          'Ваш браузер не поддерживает распознавание речи (SpeechRecognition API). Рекомендуется использовать Chrome, Edge или Safari.',
      };
      this.notifyError(err);
      this.updateStatus('unsupported');
      return;
    }

    if (this.status === 'listening' || this.status === 'recognizing') {
      this.stop();
      return;
    }

    this.currentOptions = options;
    this.intentionalStop = false;
    this.updateStatus('requesting_permission');

    try {
      const win = window as unknown as {
        SpeechRecognition?: IWindowSpeechRecognition;
        webkitSpeechRecognition?: IWindowSpeechRecognition;
      };
      const SpeechClass = win.SpeechRecognition || win.webkitSpeechRecognition!;
      const rec = new SpeechClass();
      this.recognition = rec;

      rec.lang = options?.lang || 'ru-RU';
      rec.continuous = options?.continuous !== false; // keep listening while user pauses
      rec.interimResults = true; // live feedback
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        this.updateStatus('listening');
      };

      rec.onspeechstart = () => {
        this.updateStatus('recognizing');
      };

      rec.onresult = (event: ISpeechRecognitionEvent) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          const text = item[0]?.transcript || '';
          if (item.isFinal) {
            finalTranscript += text;
          } else {
            interimTranscript += text;
          }
        }

        if (finalTranscript.trim()) {
          this.notifyResult(finalTranscript.trim(), true);
        } else if (interimTranscript.trim()) {
          if (this.currentOptions?.onInterimResult) {
            this.currentOptions.onInterimResult(interimTranscript.trim());
          }
          this.notifyResult(interimTranscript.trim(), false);
        }
      };

      rec.onerror = (event: ISpeechRecognitionErrorEvent) => {
        // If aborted intentionally by stop() / cancel(), ignore
        if (event.error === 'aborted' && this.intentionalStop) {
          return;
        }

        let friendlyMessage = 'Ошибка распознавания речи.';
        let isDenied = false;
        let isNet = false;

        switch (event.error) {
          case 'not-allowed':
          case 'service-not-allowed':
            friendlyMessage =
              'Доступ к микрофону заблокирован в браузере. Разрешите микрофон в настройках сайта.';
            isDenied = true;
            break;
          case 'no-speech':
            friendlyMessage = 'Речь не обнаружена. Попробуйте сказать фразу ближе к микрофону.';
            break;
          case 'audio-capture':
            friendlyMessage = 'Микрофон не обнаружен или занят другой программой.';
            break;
          case 'network':
            friendlyMessage =
              'Сетевая ошибка службы распознавания речи браузера. Проверьте интернет-соединение.';
            isNet = true;
            break;
          default:
            friendlyMessage = event.message || `Сбой распознавания (${event.error}).`;
            break;
        }

        const err: SpeechInputError = {
          code: (event.error as SpeechInputError['code']) || 'unknown',
          message: friendlyMessage,
          isPermissionDenied: isDenied,
          isNetworkError: isNet,
        };

        this.updateStatus('error');
        this.notifyError(err);
      };

      rec.onend = () => {
        this.recognition = null;
        if (!this.intentionalStop && this.status !== 'error') {
          this.updateStatus('idle');
        } else if (this.intentionalStop) {
          this.updateStatus('idle');
        }
      };

      rec.start();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.updateStatus('error');
      this.notifyError({
        code: 'unknown',
        message: `Не удалось запустить микрофон: ${msg}`,
      });
    }
  }

  public stop(): void {
    this.intentionalStop = true;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // ignore already stopped
      }
    }
    this.updateStatus('idle');
  }

  public cancel(): void {
    this.intentionalStop = true;
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // ignore already aborted
      }
    }
    this.recognition = null;
    this.updateStatus('idle');
  }

  public onResult(
    callback: (transcript: string, isFinal: boolean) => void
  ): () => void {
    this.resultListeners.add(callback);
    return () => this.resultListeners.delete(callback);
  }

  public onError(callback: (error: SpeechInputError) => void): () => void {
    this.errorListeners.add(callback);
    return () => this.errorListeners.delete(callback);
  }

  public onStatusChange(callback: (status: SpeechInputStatus) => void): () => void {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  private updateStatus(newStatus: SpeechInputStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      for (const listener of this.statusListeners) {
        try {
          listener(newStatus);
        } catch {
          // ignore callback error
        }
      }
    }
  }

  private notifyResult(transcript: string, isFinal: boolean): void {
    for (const listener of this.resultListeners) {
      try {
        listener(transcript, isFinal);
      } catch {
        // ignore callback error
      }
    }
  }

  private notifyError(error: SpeechInputError): void {
    for (const listener of this.errorListeners) {
      try {
        listener(error);
      } catch {
        // ignore callback error
      }
    }
  }
}

export const browserSpeechInput = new BrowserSpeechInputProvider();
