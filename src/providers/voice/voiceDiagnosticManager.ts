/**
 * Voice Diagnostics & Telemetry Manager for Pixel Companion & Electron Runtime.
 *
 * Provides transparent, exportable diagnostics for:
 * 1. Microphone hardware & OS permissions (granted, denied, prompt)
 * 2. Web Speech API engine availability and runtime session state (ru-RU)
 * 3. Speech detection events and recognized transcripts
 * 4. Wake word keyword detection («Пиксель»)
 * 5. Recognition errors (network, not-allowed, service-not-allowed, no-speech, aborted)
 * 6. Stop and restart reasons with timestamps
 * 7. Live mode handoffs (Gemini Live vs Standby)
 *
 * Works in both browser preview and packaged Windows Electron application.
 */

export type VoiceDiagnosticLevel = 'info' | 'warn' | 'error' | 'success';

export type VoiceDiagnosticCategory =
  | 'permission'
  | 'engine'
  | 'speech'
  | 'match'
  | 'live'
  | 'restart';

export interface VoiceDiagnosticEntry {
  id: string;
  timestamp: string;
  timestampMs: number;
  level: VoiceDiagnosticLevel;
  category: VoiceDiagnosticCategory;
  message: string;
  detail?: string;
  rawPayload?: Record<string, unknown>;
}

export interface MicrophoneDiagnosticReport {
  isElectron: boolean;
  userAgent: string;
  isWebSpeechSupported: boolean;
  webSpeechClassName: string;
  permissionState: 'granted' | 'denied' | 'prompt' | 'unknown';
  hasAudioInputDevices: boolean;
  audioDeviceCount: number;
  audioDeviceLabels: string[];
  lastError?: string;
  testedAt: string;
}

const STORAGE_KEY = 'kiber_pixel_voice_diagnostics_v1';
const MAX_ENTRIES = 150;

class VoiceDiagnosticManager {
  private entries: VoiceDiagnosticEntry[] = [];
  private listeners = new Set<(entries: VoiceDiagnosticEntry[]) => void>();

  constructor() {
    this.entries = this.loadStoredEntries();
    this.log(
      'info',
      'engine',
      'Модуль диагностики инициализирован',
      `Среда: ${this.isElectron() ? 'Electron (Windows Desktop)' : 'Браузер'}`
    );
  }

  public isElectron(): boolean {
    if (typeof window === 'undefined') return false;
    return Boolean(
      window.electronAPI ||
        (window as any).process?.versions?.electron ||
        navigator.userAgent.toLowerCase().includes('electron')
    );
  }

  public getEntries(): VoiceDiagnosticEntry[] {
    return [...this.entries];
  }

  public log(
    level: VoiceDiagnosticLevel,
    category: VoiceDiagnosticCategory,
    message: string,
    detail?: string,
    rawPayload?: Record<string, unknown>
  ): void {
    const now = new Date();
    const entry: VoiceDiagnosticEntry = {
      id: `diag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }) + `.${String(now.getMilliseconds()).padStart(3, '0')}`,
      timestampMs: now.getTime(),
      level,
      category,
      message,
      detail,
      rawPayload,
    };

    this.entries.unshift(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.pop();
    }

    this.persistEntries();
    this.notifyListeners();

    // Console output for standard DevTools / terminal inspection
    const prefix = `[VoiceDiag:${category.toUpperCase()}]`;
    if (level === 'error') {
      console.error(prefix, message, detail || '', rawPayload || '');
    } else if (level === 'warn') {
      console.warn(prefix, message, detail || '', rawPayload || '');
    } else {
      console.log(prefix, message, detail || '');
    }
  }

  public onEntriesChange(
    callback: (entries: VoiceDiagnosticEntry[]) => void
  ): () => void {
    this.listeners.add(callback);
    callback(this.getEntries());
    return () => {
      this.listeners.delete(callback);
    };
  }

  public clear(): void {
    this.entries = [];
    this.persistEntries();
    this.notifyListeners();
  }

  /**
   * Performs an honest runtime test of microphone hardware and permission.
   */
  public async runHardwareAndPermissionTest(
    requestIfPrompt = false
  ): Promise<MicrophoneDiagnosticReport> {
    const isElec = this.isElectron();
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown';
    const isSupported =
      typeof window !== 'undefined' &&
      Boolean(
        (window as any).SpeechRecognition ||
          (window as any).webkitSpeechRecognition
      );
    const className =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition
          ? 'SpeechRecognition'
          : (window as any).webkitSpeechRecognition
            ? 'webkitSpeechRecognition'
            : 'Отсутствует'
        : 'Отсутствует';

    let permState: 'granted' | 'denied' | 'prompt' | 'unknown' = 'unknown';
    let deviceLabels: string[] = [];
    let deviceCount = 0;
    let lastError: string | undefined;

    // 1. Query permissions API if available
    try {
      if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
        const queryResult = await navigator.permissions.query({
          name: 'microphone' as PermissionName,
        });
        permState = queryResult.state;
      }
    } catch {
      // Permissions query for 'microphone' might not be supported in some runtimes
    }

    // 2. Query audio devices
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.mediaDevices?.enumerateDevices
      ) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter((d) => d.kind === 'audioinput');
        deviceCount = audioInputs.length;
        deviceLabels = audioInputs
          .map((d) => d.label || `Микрофон (ID: ${d.deviceId.slice(0, 8)})`)
          .filter(Boolean);
      }
    } catch (devErr) {
      lastError = `Не удалось опросить список устройств: ${String(devErr)}`;
    }

    // 3. Perform active audio stream probe ONLY if explicitly requested by user click
    if (
      requestIfPrompt &&
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices?.getUserMedia &&
      permState !== 'denied'
    ) {
      try {
        const probeStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        permState = 'granted';
        // Immediately release probe tracks
        probeStream.getTracks().forEach((t) => t.stop());

        // Re-enumerate devices with acquired permission to read real device labels
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter((d) => d.kind === 'audioinput');
        deviceCount = audioInputs.length;
        deviceLabels = audioInputs
          .map((d) => d.label || `Микрофон (ID: ${d.deviceId.slice(0, 8)})`)
          .filter(Boolean);
      } catch (err: unknown) {
        const isNotAllowed =
          (err as any)?.name === 'NotAllowedError' ||
          (err as any)?.name === 'PermissionDeniedError';
        permState = isNotAllowed ? 'denied' : 'unknown';
        lastError =
          err instanceof Error
            ? `${err.name}: ${err.message}`
            : String(err);
      }
    }

    const report: MicrophoneDiagnosticReport = {
      isElectron: isElec,
      userAgent: ua,
      isWebSpeechSupported: isSupported,
      webSpeechClassName: className,
      permissionState: permState,
      hasAudioInputDevices: deviceCount > 0,
      audioDeviceCount: deviceCount,
      audioDeviceLabels: deviceLabels,
      lastError,
      testedAt: new Date().toISOString(),
    };

    if (requestIfPrompt) {
      this.log(
        permState === 'granted' ? 'success' : 'warn',
        'permission',
        `Проверка микрофона: ${permState === 'granted' ? 'Доступ разрешён' : permState === 'denied' ? 'Доступ запрещён' : 'Ожидает разрешения'}`,
        `Устройств ввода: ${deviceCount}. Web Speech API: ${isSupported ? className : 'Не поддерживается'}`,
        report as unknown as Record<string, unknown>
      );
    }

    return report;
  }

  /**
   * Generates formatted text report for copy/paste or saving to file.
   */
  public exportLogAsText(): string {
    const lines: string[] = [
      '====================================================================',
      'KIBERONE & RENDERIA — ДИАГНОСТИКА ГОЛОСОВОЙ СИСТЕМЫ И WAKE WORD',
      `Дата экспорта: ${new Date().toLocaleString('ru-RU')}`,
      `Среда: ${this.isElectron() ? 'Electron Desktop (Windows)' : 'Браузер'}`,
      `User Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'}`,
      '====================================================================',
      '',
      '--- ХРОНОЛОГИЯ СОБЫТИЙ (ОТ НОВЫХ К СТАРЫМ) ---',
      '',
    ];

    if (this.entries.length === 0) {
      lines.push('(Записи в журнале отсутствуют)');
    } else {
      for (const e of this.entries) {
        const symbol =
          e.level === 'error'
            ? '❌ [ОШИБКА]'
            : e.level === 'warn'
              ? '⚠️ [ВНИМАНИЕ]'
              : e.level === 'success'
                ? '✅ [УСПЕХ]'
                : 'ℹ️ [ИНФО]';
        lines.push(
          `${e.timestamp} | ${symbol} [${e.category.toUpperCase()}]: ${e.message}`
        );
        if (e.detail) {
          lines.push(`   Детали: ${e.detail}`);
        }
        if (e.rawPayload && Object.keys(e.rawPayload).length > 0) {
          lines.push(`   Данные: ${JSON.stringify(e.rawPayload)}`);
        }
        lines.push('');
      }
    }

    lines.push('====================================================================');
    lines.push('КОНЕЦ ОТЧЁТА');
    return lines.join('\n');
  }

  private loadStoredEntries(): VoiceDiagnosticEntry[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed
            .map((entry: any) => {
              if (
                entry &&
                entry.category === 'permission' &&
                entry.level === 'error' &&
                (entry.detail?.includes('not-allowed') ||
                  entry.message?.includes('not-allowed') ||
                  entry.message?.includes('заблокирован'))
              ) {
                return { ...entry, level: 'warn' as const };
              }
              return entry;
            })
            .slice(0, MAX_ENTRIES);
        }
      }
    } catch {
      // ignore
    }
    return [];
  }

  private persistEntries(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(this.entries.slice(0, 50))
      );
    } catch {
      // ignore
    }
  }

  private notifyListeners(): void {
    const copy = this.getEntries();
    for (const l of this.listeners) {
      try {
        l(copy);
      } catch {
        // ignore listener errors
      }
    }
  }
}

export const voiceDiagnosticManager = new VoiceDiagnosticManager();
