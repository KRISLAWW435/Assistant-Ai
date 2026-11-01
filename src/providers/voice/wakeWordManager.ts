/**
 * Global Standby Wake Word Manager for Pixel Companion.
 * Operates across all sections and modes in both browser and Electron desktop runtime.
 *
 * Key Capabilities:
 * - Single-word & phrase trigger: Saying «Пиксель» / «пиксел» / «pixel» / «эй пиксель» immediately triggers Live dialogue.
 * - Accurate state reporting: Only reports 'standby_listening' when microphone is actually capturing audio.
 * - Robust error handling: Handles network timeouts, permission states, and browser limitations with clear diagnostics.
 * - Clean microphone handover: Releases microphone cleanly before Gemini Live acquires getUserMedia.
 * - Full telemetry: Integrates with voiceDiagnosticManager for live monitoring in Electron and browser.
 */

import {
  WAKE_WORD_STATE_META,
  WakeWordState,
  WakeWordStateMeta,
} from '../../types/voice';
import { voiceManager } from './voiceManager';
import { voiceDiagnosticManager } from './voiceDiagnosticManager';

export interface WakeWordCallbacks {
  onTriggered: (matchedPhrase: string) => void;
  onStateChange: (state: WakeWordState, detail?: string) => void;
  onError?: (err: Error) => void;
}

export interface SpeechEngineAuditInfo {
  isSupported: boolean;
  engineName: string;
  isCloudService: boolean;
  language: string;
  supportsProcessLocally: boolean;
  privacySummary: string;
}

const WAKE_WORD_TRIGGER_REGEX =
  /(?:^|\s|[.,!?:;])(?:(?:эй|привет|слушай|помощник|скажи)\s+)?(?:пиксел[ьяюеиь]?|пикс[еэё]ль|пик\s+сел[ьяь]?|pixel)(?:[,.\s!?:;]|$)/iu;

const WAKE_WORD_EXPLICIT_PHRASES = [
  'пиксель',
  'пиксел',
  'пикселю',
  'пикселя',
  'пиксели',
  'пикселем',
  'пикселе',
  'пиксэль',
  'пик сель',
  'пик сел',
  'пиксель ты тут',
  'пиксель привет',
  'эй пиксель',
  'слушай пиксель',
  'пиксель слушай',
  'помощник пиксель',
  'pixel',
];

export class WakeWordManager {
  private recognition: any = null;
  private state: WakeWordState = 'mic_muted';
  private userEnabled = false;
  private sensitivity: 'normal' | 'high' = 'normal';
  private callbacks: WakeWordCallbacks | null = null;
  private restartTimeout: ReturnType<typeof setTimeout> | null = null;
  private speechActiveTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastTriggerTime = 0;
  private isLiveModeActive = false;
  private isPermissionGranted = false;
  private isStarting = false;
  private isRecognitionActive = false;
  private isAbortPending = false;
  private pendingRestart = false;
  private consecutiveNetworkErrors = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          if (this.state === 'standby_listening' || this.state === 'hearing_speech') {
            voiceDiagnosticManager.log(
              'info',
              'engine',
              'Вкладка скрыта: приостановка прослушивания микрофона'
            );
            this.stopInternalListening(false);
          }
        } else if (
          document.visibilityState === 'visible' &&
          this.userEnabled &&
          !this.isLiveModeActive
        ) {
          voiceDiagnosticManager.log(
            'info',
            'engine',
            'Вкладка активна: восстановление фонового прослушивания'
          );
          this.startInternalListening();
        }
      });
    }
  }

  public isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    return Boolean(
      'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
    );
  }

  public getState(): WakeWordState {
    return this.state;
  }

  public getStateMeta(): WakeWordStateMeta {
    return WAKE_WORD_STATE_META[this.state] || WAKE_WORD_STATE_META.mic_muted;
  }

  public isUserEnabled(): boolean {
    return this.userEnabled;
  }

  public getSpeechEngineAudit(): SpeechEngineAuditInfo {
    const supported = this.isSupported();
    let hasProcessLocally = false;
    if (typeof window !== 'undefined') {
      const recClass =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;
      if (recClass && 'processLocally' in (recClass.prototype || {})) {
        hasProcessLocally = true;
      }
    }

    return {
      isSupported: supported,
      engineName: 'Web Speech API (Chrome ru-RU)',
      isCloudService: true,
      language: 'ru-RU',
      supportsProcessLocally: hasProcessLocally,
      privacySummary:
        'Распознавание ключевого слова использует Web Speech API браузера/Electron для русского языка (ru-RU). При распознавании слова «Пиксель» активируется сессия прямого диалога Gemini Live.',
    };
  }

  public init(callbacks: WakeWordCallbacks): void {
    this.callbacks = callbacks;
    const settings = voiceManager.getSettings();
    this.userEnabled = settings.wakeWordEnabled ?? true;
    this.sensitivity = settings.wakeWordSensitivity || 'normal';

    if (!this.isSupported()) {
      voiceDiagnosticManager.log(
        'warn',
        'engine',
        'Web Speech API не поддерживается текущей средой выполнения'
      );
      this.updateState('unsupported', 'Web Speech API не поддерживается в данном окружении');
      return;
    }

    if (this.userEnabled) {
      voiceDiagnosticManager.log(
        'info',
        'engine',
        'Инициализация менеджера ключевого слова',
        `Чувствительность: ${this.sensitivity}`
      );
      this.startInternalListening();
    } else {
      this.updateState('mic_muted', 'Режим ожидания выключен в настройках');
    }
  }

  public setEnabled(enabled: boolean, sensitivity?: 'normal' | 'high'): void {
    this.userEnabled = enabled;
    if (sensitivity) {
      this.sensitivity = sensitivity;
    }
    voiceManager.updateSettings({
      wakeWordEnabled: enabled,
      wakeWordSensitivity: this.sensitivity,
    });

    if (enabled) {
      voiceDiagnosticManager.log('info', 'engine', 'Пользователь включил режим ожидания');
      this.consecutiveNetworkErrors = 0;
      this.startInternalListening();
    } else {
      voiceDiagnosticManager.log('info', 'engine', 'Пользователь выключил режим ожидания');
      this.stop();
    }
  }

  public startListening(): void {
    this.setEnabled(true);
  }

  public stopListening(): void {
    this.setEnabled(false);
  }

  public stop(): void {
    this.userEnabled = false;
    this.stopInternalListening(false);
    this.updateState('mic_muted');
  }

  public requestStandbyRestart(reason = 'Пользовательский перезапуск'): void {
    voiceDiagnosticManager.log('info', 'restart', reason);
    this.stopInternalListening(false);
    this.startListening();
  }

  /**
   * Explicit user-gesture driven permission request.
   * Invoked when user clicks "Разрешить микрофон" in UI.
   */
  public async requestMicrophonePermission(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.updateState('unsupported', 'Аудиоустройства не поддерживаются в данном браузере');
      return false;
    }

    try {
      voiceDiagnosticManager.log(
        'info',
        'permission',
        'Запрос разрешения микрофона через интерфейс браузера...'
      );
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Immediately release probe stream
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });

      this.isPermissionGranted = true;
      this.userEnabled = true;
      voiceDiagnosticManager.log(
        'success',
        'permission',
        'Разрешение к микрофону успешно получено от пользователя'
      );

      // Give browser audio stack 250ms to close capture endpoint before starting SpeechRecognition
      setTimeout(() => {
        this.startListening();
      }, 250);
      return true;
    } catch (err: unknown) {
      const isDenied =
        (err as any)?.name === 'NotAllowedError' ||
        (err as any)?.name === 'PermissionDeniedError';
      voiceDiagnosticManager.log(
        'warn',
        'permission',
        isDenied
          ? 'Пользователь или система отклонили доступ к микрофону'
          : 'Ошибка доступа к аудиоустройству',
        err instanceof Error ? err.message : String(err)
      );
      this.updateState('permission_denied', 'Доступ к микрофону не предоставлен');
      return false;
    }
  }

  /**
   * Called when Live Voice starts.
   * Shuts down Web Speech API so getUserMedia has 100% free access to audio hardware.
   */
  public pauseForLiveMode(): void {
    this.isLiveModeActive = true;
    voiceDiagnosticManager.log(
      'info',
      'live',
      'Остановка Web Speech API для освобождения микрофона под Gemini Live'
    );
    this.stopInternalListening(false);
    this.updateState('live_active');
  }

  /**
   * Called when Live Voice closes.
   * Restores standby listening after a clean unmount of audio tracks.
   */
  public resumeAfterLiveMode(): void {
    this.isLiveModeActive = false;
    voiceDiagnosticManager.log(
      'info',
      'live',
      'Gemini Live завершён: подготовка к возобновлению ожидания ключевого слова'
    );

    if (this.userEnabled && (typeof document === 'undefined' || document.visibilityState === 'visible')) {
      // 300ms pause to ensure previous getUserMedia tracks are fully closed
      setTimeout(() => {
        if (!this.isLiveModeActive && this.userEnabled) {
          this.startInternalListening();
        }
      }, 300);
    } else {
      this.updateState('mic_muted');
    }
  }

  private startInternalListening(): void {
    if (!this.isSupported()) {
      this.updateState('unsupported', 'Web Speech API не поддерживается');
      return;
    }

    if (this.isLiveModeActive) {
      this.updateState('live_active');
      return;
    }

    if (!this.userEnabled) {
      this.updateState('mic_muted');
      return;
    }

    // Guard against duplicate start calls while active or starting
    if (this.isRecognitionActive || this.isStarting) {
      return;
    }

    // If previous instance is still in abort transition, wait for its onend before restarting
    if (this.isAbortPending) {
      this.pendingRestart = true;
      return;
    }

    // Clear any pending restart timeout
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    this.isStarting = true;
    this.pendingRestart = false;

    try {
      const SpeechRecognitionClass =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;

      const rec = new SpeechRecognitionClass();
      this.recognition = rec;
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'ru-RU';
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        this.isStarting = false;
        this.isRecognitionActive = true;
        this.isPermissionGranted = true;
        this.consecutiveNetworkErrors = 0;
        voiceDiagnosticManager.log(
          'success',
          'engine',
          'Распознавание Web Speech API запущено (ru-RU)',
          'Микрофон активен. Ожидает фразу «Пиксель».'
        );
        this.updateState('standby_listening');
      };

      rec.onspeechstart = () => {
        if (this.state === 'standby_listening') {
          this.updateState('hearing_speech');
          voiceDiagnosticManager.log(
            'info',
            'speech',
            'Микрофон уловил звук человеческой речи...'
          );
        }
        if (this.speechActiveTimeout) {
          clearTimeout(this.speechActiveTimeout);
          this.speechActiveTimeout = null;
        }
      };

      rec.onspeechend = () => {
        if (this.state === 'hearing_speech') {
          this.speechActiveTimeout = setTimeout(() => {
            if (this.state === 'hearing_speech' && !this.isLiveModeActive) {
              this.updateState('standby_listening');
            }
          }, 1200);
        }
      };

      rec.onresult = (event: any) => {
        // Echo guard: ignore input if assistant is currently speaking aloud
        if (voiceManager.isSpeaking()) {
          return;
        }

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result) continue;

          for (let a = 0; a < result.length; a++) {
            const transcript = (result[a]?.transcript || '').trim();
            if (!transcript) continue;

            const isFinal = Boolean(result.isFinal);
            voiceDiagnosticManager.log(
              'info',
              'speech',
              `Получен текст [${isFinal ? 'финал' : 'промежуточный'}]: "${transcript}"`
            );

            const matched = this.testWakeWordMatch(transcript);
            if (matched) {
              voiceDiagnosticManager.log(
                'success',
                'match',
                `ОБНАРУЖЕНО КЛЮЧЕВОЕ СЛОВО: "${matched}"!`,
                `Фрагмент текста: "${transcript}". Запуск Live-диалога с Пикселем...`
              );
              this.handleWakeWordTriggered(matched);
              return;
            }
          }
        }
      };

      rec.onerror = (e: any) => {
        this.isStarting = false;
        const errType = e?.error || 'unknown';

        if (errType === 'no-speech') {
          // Normal background silence timeout: Chromium will trigger onend and restart
          return;
        }

        if (errType === 'aborted') {
          // Expected on programmatic abort
          return;
        }

        if (errType === 'not-allowed' || errType === 'service-not-allowed') {
          this.isRecognitionActive = false;
          this.isPermissionGranted = false;
          voiceDiagnosticManager.log(
            'warn',
            'permission',
            'Ожидается разрешение на доступ к микрофону',
            `Код события: ${errType}. Нажмите «Разрешить микрофон» в верхней панели или кнопку «Поговорить».`
          );
          this.updateState(
            'permission_denied',
            'Требуется разрешение микрофона (нажмите «Разрешить микрофон»)'
          );
          return;
        }

        if (errType === 'network') {
          this.consecutiveNetworkErrors++;
          voiceDiagnosticManager.log(
            'warn',
            'engine',
            `Ошибка связи с облачным сервисом Web Speech API (network, попытка ${this.consecutiveNetworkErrors})`,
            voiceDiagnosticManager.isElectron()
              ? 'В среде Electron распознавание речи обращается к серверам Google. Если сервис недоступен, используйте кнопку "Поговорить".'
              : 'Проверьте подключение к сети.'
          );

          if (this.consecutiveNetworkErrors >= 3) {
            this.updateState(
              'error',
              'Сбой сети Web Speech API (нажмите "Поговорить" для прямого Gemini Live)'
            );
          }
          return;
        }

        voiceDiagnosticManager.log(
          'warn',
          'engine',
          `Событие Web Speech API: ${errType}`
        );
        this.updateState('error', `Ошибка распознавания: ${errType}`);
      };

      rec.onend = () => {
        this.isStarting = false;
        this.isRecognitionActive = false;
        this.isAbortPending = false;
        this.recognition = null;

        // If a restart was requested while previous instance was aborting, execute it cleanly now
        if (this.pendingRestart && this.userEnabled && !this.isLiveModeActive) {
          this.pendingRestart = false;
          this.startInternalListening();
          return;
        }

        // Clean auto-restart if enabled, tab is visible, and Live mode is not active
        if (
          this.userEnabled &&
          !this.isLiveModeActive &&
          (typeof document === 'undefined' || document.visibilityState === 'visible') &&
          this.state !== 'permission_denied' &&
          this.state !== 'unsupported'
        ) {
          const restartDelay = this.consecutiveNetworkErrors > 0 ? 2500 : 350;
          this.restartTimeout = setTimeout(() => {
            if (this.userEnabled && !this.isLiveModeActive && !this.isRecognitionActive) {
              this.startInternalListening();
            }
          }, restartDelay);
        } else if (!this.userEnabled && !this.isLiveModeActive) {
          this.updateState('mic_muted');
        }
      };

      rec.start();
    } catch (err: unknown) {
      this.isStarting = false;
      this.isRecognitionActive = false;
      this.isAbortPending = false;
      this.recognition = null;
      const errMsg = err instanceof Error ? err.message : String(err);
      voiceDiagnosticManager.log(
        'warn',
        'engine',
        `Исключение при вызове start() SpeechRecognition: ${errMsg}`
      );
      this.updateState('error', `Не удалось запустить микрофон: ${errMsg}`);
    }
  }

  private stopInternalListening(notifyMuted = true): void {
    this.isStarting = false;
    this.isRecognitionActive = false;
    this.pendingRestart = false;

    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    if (this.speechActiveTimeout) {
      clearTimeout(this.speechActiveTimeout);
      this.speechActiveTimeout = null;
    }

    if (this.recognition) {
      this.isAbortPending = true;
      try {
        this.recognition.abort();
      } catch {
        this.isAbortPending = false;
        this.recognition = null;
      }
    } else {
      this.isAbortPending = false;
    }

    if (notifyMuted) {
      this.updateState('mic_muted');
    }
  }

  /**
   * Robust Russian wake word matcher.
   * Matches single-word «Пиксель» / «Пиксел» / «Pixel» as well as syllables and variations.
   */
  private testWakeWordMatch(text: string): string | null {
    if (!text) return null;

    let clean = text
      .toLowerCase()
      .replace(/[ё]/g, 'е')
      .replace(/[.,!?;:«»"'\-—]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Syllable normalization (e.g. STT hears "пик сель" or "пик сел")
    clean = clean
      .replace(/\bпик\s+сел[ьяеиь]?\b/g, 'пиксель')
      .replace(/\bпикс\s+эль\b/g, 'пиксель');

    // 1. Primary Regex Match (matches single word "пиксель", "пиксел", "эй пиксель", "pixel")
    if (WAKE_WORD_TRIGGER_REGEX.test(clean)) {
      return 'Пиксель';
    }

    // 2. Explicit Phrases Check
    for (const phrase of WAKE_WORD_EXPLICIT_PHRASES) {
      if (clean.includes(phrase)) {
        return phrase;
      }
    }

    // 3. Direct substring inclusion for "пиксель" / "пиксел" / "pixel"
    if (
      clean.includes('пиксель') ||
      clean.includes('пиксел') ||
      clean.includes('pixel')
    ) {
      return 'Пиксель';
    }

    return null;
  }

  private handleWakeWordTriggered(matchedPhrase: string): void {
    const now = Date.now();
    // Debounce triggers: at least 3.5 seconds between triggers
    if (now - this.lastTriggerTime < 3500) {
      return;
    }
    this.lastTriggerTime = now;

    this.updateState('wake_word_triggered');
    this.stopInternalListening(false);

    try {
      this.callbacks?.onTriggered(matchedPhrase);
    } catch (err) {
      console.error('[WakeWordManager] onTriggered callback error:', err);
    }
  }

  private updateState(newState: WakeWordState, detail?: string): void {
    this.state = newState;
    this.callbacks?.onStateChange(newState, detail);
  }
}

export const wakeWordManager = new WakeWordManager();
