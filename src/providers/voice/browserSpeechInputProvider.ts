/**
 * Browser native Speech-to-Text provider utilizing Web Speech Recognition API
 * (window.SpeechRecognition || window.webkitSpeechRecognition) and MediaDevices diagnostic check.
 * Strictly prevents word duplication by keeping immutable finalized segments and cleanly replacing interim clauses.
 */

import {
  ISpeechInputProvider,
  SpeechInputError,
  SpeechInputOptions,
  SpeechInputStatus,
  SpeechRecognitionResultEvent,
} from '../../types/voice';

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
    (event: SpeechRecognitionResultEvent) => void
  >();
  private errorListeners = new Set<(error: SpeechInputError) => void>();
  private statusListeners = new Set<(status: SpeechInputStatus) => void>();

  private intentionalStop = false;
  private currentOptions?: SpeechInputOptions;
  private lastSessionFinal = '';

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

  /**
   * Diagnostic permission check triggered ONLY when the user clicks the microphone button.
   * If getUserMedia succeeds, the track is stopped immediately to release the hardware.
   */
  private async checkMicrophonePermissionDiagnostic(): Promise<SpeechInputError | null> {
    if (typeof window === 'undefined') return null;

    if (window.isSecureContext === false) {
      return {
        code: 'security-error',
        technicalErrorName: 'InsecureContext',
        message:
          'Микрофон требует защищённого соединения (HTTPS / Secure Context). В небезопасном контексте браузер блокирует медиаустройства.',
      };
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop tracks immediately after diagnostic check to release hardware
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore track close error
        }
      });
      return null;
    } catch (err: unknown) {
      const errorObj = err as Error;
      const errorName = errorObj.name || '';
      const rawMsg = errorObj.message || '';

      if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
        return {
          code: 'not-allowed',
          technicalErrorName: errorName,
          message:
            'Доступ к микрофону заблокирован в браузере (NotAllowedError). Нажмите на значок настроек/замка в адресной строке и разрешите микрофон для этого сайта.',
          isPermissionDenied: true,
        };
      }

      if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        return {
          code: 'not-found',
          technicalErrorName: errorName,
          message:
            'Микрофон не обнаружен (NotFoundError). Проверьте подключение аудиоустройства или настройки входа в операционной системе.',
        };
      }

      if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
        return {
          code: 'not-readable',
          technicalErrorName: errorName,
          message:
            'Микрофон занят другой программой или заблокирован на уровне ОС (NotReadableError). Закройте другие приложения, использующие микрофон.',
        };
      }

      if (errorName === 'SecurityError') {
        return {
          code: 'security-error',
          technicalErrorName: errorName,
          message:
            'Доступ к микрофону заблокирован политикой безопасности iframe или браузера (SecurityError / Permissions Policy).',
        };
      }

      if (errorName === 'AbortError') {
        return {
          code: 'aborted',
          technicalErrorName: errorName,
          message: 'Запрос на доступ к микрофону был прерван (AbortError).',
        };
      }

      return {
        code: 'unknown',
        technicalErrorName: errorName,
        message: `Ошибка доступа к микрофону (${errorName || 'Unknown'}): ${rawMsg}`,
      };
    }
  }

  public async start(options?: SpeechInputOptions): Promise<void> {
    if (!this.isSupported()) {
      const err: SpeechInputError = {
        code: 'not-supported',
        message:
          'Ваш браузер не поддерживает SpeechRecognition API. Рекомендуется использовать Chrome, Edge или Safari.',
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
    this.lastSessionFinal = '';
    this.updateStatus('requesting_permission');

    // Diagnostic preflight check on user click
    const preflightError = await this.checkMicrophonePermissionDiagnostic();
    if (preflightError) {
      this.updateStatus('error');
      this.notifyError(preflightError);
      return;
    }

    try {
      const win = window as unknown as {
        SpeechRecognition?: IWindowSpeechRecognition;
        webkitSpeechRecognition?: IWindowSpeechRecognition;
      };
      const SpeechClass = win.SpeechRecognition || win.webkitSpeechRecognition!;
      const rec = new SpeechClass();
      this.recognition = rec;

      rec.lang = 'ru-RU';
      rec.continuous = options?.continuous !== false;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        this.updateStatus('listening');
      };

      rec.onspeechstart = () => {
        this.updateStatus('recognizing');
      };

      rec.onresult = (event: ISpeechRecognitionEvent) => {
        let sessionFinal = '';
        let currentInterim = '';

        // Iterate over full results array from the beginning of this recognition session.
        // Web Speech API keeps all isFinal chunks in results[0..n-1] and interim in results[n].
        for (let i = 0; i < event.results.length; ++i) {
          const item = event.results[i];
          const text = (item[0]?.transcript || '').trim();
          if (!text) continue;

          if (item.isFinal) {
            sessionFinal = sessionFinal ? `${sessionFinal} ${text}` : text;
          } else {
            currentInterim = currentInterim ? `${currentInterim} ${text}` : text;
          }
        }

        this.lastSessionFinal = sessionFinal;

        const fullTranscript = sessionFinal
          ? currentInterim
            ? `${sessionFinal} ${currentInterim}`
            : sessionFinal
          : currentInterim;

        const isLatestFinal =
          event.results.length > 0 &&
          event.results[event.results.length - 1]?.isFinal === true;

        if (this.currentOptions?.onInterimResult && currentInterim) {
          this.currentOptions.onInterimResult(currentInterim);
        }

        this.notifyResult({
          finalTranscript: sessionFinal,
          interimTranscript: currentInterim,
          fullTranscript,
          isFinal: isLatestFinal,
        });
      };

      rec.onerror = (event: ISpeechRecognitionErrorEvent) => {
        if (event.error === 'aborted' && this.intentionalStop) {
          return;
        }

        let friendlyMessage = 'Ошибка распознавания речи.';
        let isDenied = false;
        let isNet = false;
        let code: SpeechInputError['code'] = 'unknown';

        switch (event.error) {
          case 'not-allowed':
            code = 'not-allowed';
            friendlyMessage =
              'Доступ к микрофону заблокирован в браузере (not-allowed). Разрешите микрофон в настройках сайта.';
            isDenied = true;
            break;
          case 'service-not-allowed':
            code = 'service-not-allowed';
            friendlyMessage =
              'Служба распознавания речи Google отклонила запрос (service-not-allowed). Возможно, заблокирован сетевой доступ к речевым серверам.';
            isDenied = true;
            break;
          case 'network':
            code = 'network';
            friendlyMessage =
              'Сетевая ошибка службы распознавания речи Google (network). Проверьте подключение к интернету.';
            isNet = true;
            break;
          case 'no-speech':
            code = 'no-speech';
            friendlyMessage = 'Речь не обнаружена. Говорите ближе к микрофону.';
            break;
          case 'audio-capture':
            code = 'audio-capture';
            friendlyMessage =
              'Не удалось захватить аудиопоток: микрофон не найден или отключён (audio-capture).';
            break;
          default:
            code = (event.error as SpeechInputError['code']) || 'unknown';
            friendlyMessage = event.message || `Сбой распознавания речи (${event.error}).`;
            break;
        }

        const err: SpeechInputError = {
          code,
          technicalErrorName: event.error,
          message: friendlyMessage,
          isPermissionDenied: isDenied,
          isNetworkError: isNet,
        };

        this.updateStatus('error');
        this.notifyError(err);
      };

      rec.onend = () => {
        // Emit final state on clean recognition finish
        if (this.lastSessionFinal) {
          this.notifyResult({
            finalTranscript: this.lastSessionFinal,
            interimTranscript: '',
            fullTranscript: this.lastSessionFinal,
            isFinal: true,
          });
        }

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
    callback: (event: SpeechRecognitionResultEvent) => void
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

  private notifyResult(event: SpeechRecognitionResultEvent): void {
    for (const listener of this.resultListeners) {
      try {
        listener(event);
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
