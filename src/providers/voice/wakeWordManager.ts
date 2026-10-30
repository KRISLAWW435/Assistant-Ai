/**
 * Global Standby Wake Word Manager for Pixel Companion.
 * Operates at the root React application level across all sections and modes.
 *
 * Key Capabilities:
 * - Single-word trigger: Saying «Пиксель» / «пиксел» / «pixel» / «эй пиксель» immediately wakes Pixel.
 * - Unified state machine: standby_listening, hearing_speech, wake_word_triggered, connecting_live, live_active, mic_muted, permission_denied, unsupported, error.
 * - Instant conflict-free microphone release (prevents NotReadableError in getUserMedia).
 * - Echo & self-trigger suppression (never re-triggers when Pixel or specialists speak).
 * - Honest engine audit for Russian language (Web Speech API cloud ru-RU recognition).
 * - Safe diagnostic logging [WakeWordDiagnostic] without logging private audio or transcript.
 */

import {
  WAKE_WORD_STATE_META,
  WakeWordState,
  WakeWordStateMeta,
} from '../../types/voice';
import { voiceManager } from './voiceManager';

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
  /(?:^|\s|[.,!?:;])(?:(?:эй|привет|слушай|помощник)\s+)?пиксел[ьяюеи]?(?:[,.\s!?:;]|$)|(?:^|\s)pixel\b/i;

const WAKE_WORD_EXPLICIT_PHRASES = [
  'пиксель',
  'пиксел',
  'пикселю',
  'пикселя',
  'пиксели',
  'пиксель ты тут',
  'пиксель привет',
  'эй пиксель',
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

  constructor() {
    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          // Temporarily pause standby recognition when tab is hidden for privacy & resource saving
          if (this.state === 'standby_listening' || this.state === 'hearing_speech') {
            this.safeDiagnostic('Tab hidden; pausing standby listening for privacy');
            this.stopInternalListening(false);
          }
        } else if (document.visibilityState === 'visible' && this.userEnabled && !this.isLiveModeActive) {
          this.safeDiagnostic('Tab visible; restoring standby listening');
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
      isCloudService: true, // Chromium routes ru-RU via Google Cloud speech endpoint
      language: 'ru-RU',
      supportsProcessLocally: hasProcessLocally,
      privacySummary:
        'Распознавание ключевого слова использует Web Speech API браузера для русского языка (ru-RU). Фоновые аудиозаписи не сохраняются и не используются для обучения. При распознавании слова «Пиксель» активируется сессия прямого диалога Gemini Live.',
    };
  }

  public init(callbacks: WakeWordCallbacks): void {
    this.callbacks = callbacks;
    const settings = voiceManager.getSettings();
    this.userEnabled = settings.wakeWordEnabled ?? true;
    this.sensitivity = settings.wakeWordSensitivity || 'normal';

    if (!this.isSupported()) {
      this.updateState('unsupported', 'Web Speech API не поддерживается данным браузером');
      return;
    }

    if (this.userEnabled) {
      this.safeDiagnostic('Initializing global wake word manager in root application context');
      this.startInternalListening();
    } else {
      this.updateState('mic_muted', 'Режим ожидания выключен');
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
      this.safeDiagnostic('User enabled wake word standby listening');
      this.startInternalListening();
    } else {
      this.safeDiagnostic('User disabled wake word standby listening');
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

  /**
   * Called when Live Voice Modal opens (or when Wake Word triggers)
   * Shuts down Web Speech API completely so getUserMedia gets free access to microphone
   */
  public pauseForLiveMode(): void {
    this.isLiveModeActive = true;
    this.safeDiagnostic('Pausing standby listening for active Gemini Live session');
    this.stopInternalListening(false);
    this.updateState('live_active');
  }

  /**
   * Called when Live Voice Modal closes.
   * Restores standby listening after a clean unmount of audio tracks.
   */
  public resumeAfterLiveMode(): void {
    this.isLiveModeActive = false;
    this.safeDiagnostic('Live session closed; resuming standby listening after track cleanup');

    if (this.userEnabled && document.visibilityState === 'visible') {
      // Delay slightly (250ms) to ensure previous getUserMedia tracks are fully terminated by OS
      setTimeout(() => {
        if (!this.isLiveModeActive && this.userEnabled) {
          this.startInternalListening();
        }
      }, 250);
    } else {
      this.updateState('mic_muted');
    }
  }

  private startInternalListening(): void {
    if (!this.isSupported()) {
      this.updateState('unsupported');
      return;
    }

    if (this.isLiveModeActive) {
      this.updateState('live_active');
      return;
    }

    // Clear any pending restart timeout
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    // Stop existing instance if running
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // ignore
      }
      this.recognition = null;
    }

    try {
      const SpeechRecognitionClass =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;

      const rec = new SpeechRecognitionClass();
      this.recognition = rec;
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'ru-RU';
      rec.maxAlternatives = 3;

      rec.onstart = () => {
        this.isPermissionGranted = true;
        this.safeDiagnostic('Standby listening started (ru-RU). Waiting for «Пиксель»...');
        this.updateState('standby_listening');
      };

      rec.onspeechstart = () => {
        if (this.state === 'standby_listening') {
          this.updateState('hearing_speech');
          this.safeDiagnostic('Microphone detected human voice activity');
        }
        if (this.speechActiveTimeout) {
          clearTimeout(this.speechActiveTimeout);
        }
      };

      rec.onspeechend = () => {
        // After speech ends, revert from hearing_speech back to standby_listening after brief pause
        if (this.state === 'hearing_speech') {
          this.speechActiveTimeout = setTimeout(() => {
            if (this.state === 'hearing_speech' && !this.isLiveModeActive) {
              this.updateState('standby_listening');
            }
          }, 1200);
        }
      };

      rec.onresult = (event: any) => {
        // Echo / Self-trigger Guard: ignore if any TTS speech is currently playing
        if (voiceManager.isSpeaking()) {
          return;
        }

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result) continue;

          // Check all alternatives (up to 3) provided by Web Speech engine
          for (let a = 0; a < result.length; a++) {
            const transcript = (result[a]?.transcript || '').trim();
            if (!transcript) continue;

            const matched = this.testWakeWordMatch(transcript);
            if (matched) {
              this.safeDiagnostic(
                `Wake word detected: "${matched}". Triggering transition to live mode.`
              );
              this.handleWakeWordTriggered(matched);
              return;
            }
          }
        }
      };

      rec.onerror = (e: any) => {
        const errType = e.error || 'unknown';

        if (errType === 'no-speech') {
          // Expected background silence timeout - browser automatically cycles
          return;
        }

        if (errType === 'not-allowed' || errType === 'service-not-allowed') {
          this.userEnabled = false;
          this.isPermissionGranted = false;
          this.safeDiagnostic('Microphone access denied by browser/user');
          this.updateState('permission_denied', 'Доступ к микрофону заблокирован в браузере');
          this.callbacks?.onError?.(
            new Error('Доступ к микрофону для режима ожидания заблокирован.')
          );
          return;
        }

        if (errType === 'network') {
          this.safeDiagnostic('Speech recognition network timeout; will auto-retry');
          return;
        }

        if (errType === 'aborted') {
          return;
        }

        this.safeDiagnostic(`Speech recognition error: ${errType}`);
        this.updateState('error', `Ошибка распознавания: ${errType}`);
      };

      rec.onend = () => {
        this.safeDiagnostic('Speech recognition session ended');

        // Clean auto-restart if still enabled, tab is visible, and Live mode is not active
        if (
          this.userEnabled &&
          !this.isLiveModeActive &&
          document.visibilityState === 'visible' &&
          this.state !== 'permission_denied' &&
          this.state !== 'unsupported'
        ) {
          this.restartTimeout = setTimeout(() => {
            if (this.userEnabled && !this.isLiveModeActive) {
              this.startInternalListening();
            }
          }, 350);
        } else if (!this.userEnabled && !this.isLiveModeActive) {
          this.updateState('mic_muted');
        }
      };

      rec.start();
    } catch (err: unknown) {
      this.safeDiagnostic(`Failed to start speech recognition: ${String(err)}`);
      this.updateState('error', 'Не удалось запустить распознавание');
    }
  }

  private stopInternalListening(notifyMuted = true): void {
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    if (this.speechActiveTimeout) {
      clearTimeout(this.speechActiveTimeout);
      this.speechActiveTimeout = null;
    }
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // ignore
      }
      this.recognition = null;
    }
    if (notifyMuted) {
      this.updateState('mic_muted');
    }
  }

  /**
   * Robust Russian wake word matcher.
   * Matches single-word «Пиксель» / «Пиксел» / «Pixel» as well as greeting variants.
   */
  private testWakeWordMatch(text: string): string | null {
    const clean = text
      .toLowerCase()
      .replace(/[.,!?;:«»"']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

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

    // 3. High sensitivity fallback: prefix / substring check
    if (this.sensitivity === 'high') {
      if (
        clean.includes('пикс') ||
        clean.includes('пиксел') ||
        clean.includes('биксель') ||
        clean.includes('вексель')
      ) {
        return 'Пиксель (чувствительный режим)';
      }
    }

    return null;
  }

  private handleWakeWordTriggered(phrase: string): void {
    const now = Date.now();
    // Debounce to prevent double trigger within 2.5 seconds
    if (now - this.lastTriggerTime < 2500) {
      return;
    }
    this.lastTriggerTime = now;

    // 1. Instantly stop all playing TTS audio from any specialist or assistant
    voiceManager.stopAll();

    // 2. Immediately stop Web Speech API to cleanly free the microphone hardware
    this.stopInternalListening(false);
    this.updateState('wake_word_triggered', `Ключевое слово «${phrase}» распознано`);

    // 3. Transition to connecting_live and notify React app root
    setTimeout(() => {
      this.updateState('connecting_live', 'Открытие живого голосового диалога...');
      this.callbacks?.onTriggered(phrase);
    }, 120);
  }

  private updateState(newState: WakeWordState, detail?: string): void {
    this.state = newState;
    this.callbacks?.onStateChange(newState, detail);
  }

  private safeDiagnostic(message: string): void {
    // Non-invasive, safe diagnostic log: never logs audio or private user speech
    console.log(`[WakeWordDiagnostic] ${message}`);
  }
}

export const wakeWordManager = new WakeWordManager();
