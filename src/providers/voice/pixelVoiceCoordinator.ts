/**
 * Pixel Voice Coordinator — Centralized Application-Wide Voice Lifecycle Manager.
 * Operates at the root application level and remains active across all sections (Marketer,
 * Manager, Methodist, Analyst, Knowledge Base, Backups, Connections, Home).
 *
 * Implements 3 strictly decoupled voice modes:
 * 1. OFF: Microphone capture completely terminated. Standby off. Text chat available.
 * 2. STANDBY: Listens for wake word «Пиксель» via Web Speech API (Chrome ru-RU).
 *    Background sound is never streamed to Gemini Live.
 * 3. LIVE: Full bidirectional spoken dialogue via Gemini Live API (16kHz in / 24kHz out).
 *    Runs in background without forcing a full-screen modal over the user interface.
 *
 * Guarantees:
 * - Single microphone owner: WakeWordManager and GeminiLiveClient never capture mic simultaneously.
 * - Non-blocking: User can continue working in any section while Pixel listens and speaks.
 * - Unified history: Spoken dialogue turns are synced directly into Pixel's companionMessages.
 * - Full-screen modal remains available on demand for deep inspection and animated audio sphere.
 */

import {
  CompanionMemoryRecord,
  CompanionMessage,
  CompanionTaskRecord,
  PixelActiveChatContext,
  SchoolId,
} from '../../types/assistant';
import {
  LiveTranscriptEntry,
  geminiLiveClient,
  IncomingPixelContext,
} from './geminiLiveClient';
import { wakeWordManager } from './wakeWordManager';
import { voiceManager } from './voiceManager';
import { browserSpeechInput } from './browserSpeechInputProvider';
import { LiveVoiceState, PixelVoiceMode, WakeWordState } from '../../types/voice';

export interface CoordinatorSnapshot {
  mode: PixelVoiceMode;
  liveState: LiveVoiceState;
  wakeWordState: WakeWordState;
  isMicMuted: boolean;
  isPaused: boolean;
  activeSchool: SchoolId;
  transcripts: LiveTranscriptEntry[];
  errorDetail?: string;
  sessionStartTime: number | null;
  sessionElapsedSec: number;
}

export interface CoordinatorContextResolvers {
  getActiveSchool: () => SchoolId;
  getCompanionMemory: () => CompanionMemoryRecord[];
  getCompanionTasks: () => CompanionTaskRecord[];
  getActiveChatContext?: () => PixelActiveChatContext | undefined;
  onAppendCompanionMessages: (messages: CompanionMessage[]) => Promise<void>;
  onWakeWordTriggered?: (phrase: string) => void;
}

export class PixelVoiceCoordinator {
  private mode: PixelVoiceMode = 'STANDBY';
  private liveState: LiveVoiceState = 'idle';
  private wakeWordState: WakeWordState = 'standby_listening';
  private isMicMuted = false;
  private isPaused = false;
  private activeSchool: SchoolId = 'kiberone';
  private transcripts: LiveTranscriptEntry[] = [];
  private errorDetail?: string;
  private sessionStartTime: number | null = null;
  private sessionElapsedSec = 0;
  private timerInterval: ReturnType<typeof setInterval> | null = null;

  private savedTranscriptIds = new Set<string>();
  private contextResolvers: CoordinatorContextResolvers | null = null;
  private listeners = new Set<(snapshot: CoordinatorSnapshot) => void>();
  private isTransitioning = false;
  private isStoppingLive = false;

  constructor() {
    // Check initial stored setting for wake word
    const settings = voiceManager.getSettings();
    if (!settings.wakeWordEnabled) {
      this.mode = 'OFF';
      this.wakeWordState = 'mic_muted';
    }
  }

  public init(resolvers: CoordinatorContextResolvers): void {
    this.contextResolvers = resolvers;
    this.activeSchool = resolvers.getActiveSchool();

    // Wire up WakeWordManager callbacks
    wakeWordManager.init({
      onTriggered: (phrase) => {
        console.log('[PixelVoiceCoordinator] Wake word triggered:', phrase);
        voiceManager.stopAll();
        this.contextResolvers?.onWakeWordTriggered?.(phrase);
        // Spoken wake word directly initiates LIVE mode
        void this.startLive({ initialWakeGreeting: true });
      },
      onStateChange: (state, detail) => {
        this.wakeWordState = state;
        if (state === 'error' && detail) {
          this.errorDetail = detail;
        }
        this.notifyListeners();
      },
      onError: (err) => {
        console.warn('[PixelVoiceCoordinator] WakeWordManager error:', err.message);
        this.errorDetail = err.message;
        this.notifyListeners();
      },
    });

    // If wake word is disabled in settings, ensure wakeWordManager is stopped
    if (this.mode === 'OFF') {
      wakeWordManager.stop();
    }
  }

  public updateActiveSchool(school: SchoolId): void {
    this.activeSchool = school;
    this.notifyListeners();
  }

  public getSnapshot(): CoordinatorSnapshot {
    return {
      mode: this.mode,
      liveState: this.liveState,
      wakeWordState: this.wakeWordState,
      isMicMuted: this.isMicMuted,
      isPaused: this.isPaused,
      activeSchool: this.activeSchool,
      transcripts: [...this.transcripts],
      errorDetail: this.errorDetail,
      sessionStartTime: this.sessionStartTime,
      sessionElapsedSec: this.sessionElapsedSec,
    };
  }

  public onStateChange(listener: (snapshot: CoordinatorSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Set global mode (OFF | STANDBY | LIVE)
   */
  public async setMode(targetMode: PixelVoiceMode): Promise<void> {
    if (targetMode === 'OFF') {
      await this.stopLive(false);
      wakeWordManager.stop();
      browserSpeechInput.cancel();
      browserSpeechInput.stop();
      this.mode = 'OFF';
      this.liveState = 'idle';
      this.wakeWordState = 'mic_muted';
      this.errorDetail = undefined;
      voiceManager.updateSettings({
        wakeWordEnabled: false,
        continuousListeningEnabled: false,
      });
      this.notifyListeners();
      return;
    }

    if (this.mode === targetMode) return;

    if (targetMode === 'STANDBY') {
      if (this.mode === 'LIVE') {
        voiceManager.updateSettings({
          wakeWordEnabled: true,
          continuousListeningEnabled: true,
        });
        await this.stopLive(true);
      } else {
        this.mode = 'STANDBY';
        this.errorDetail = undefined;
        voiceManager.updateSettings({
          wakeWordEnabled: true,
          continuousListeningEnabled: true,
        });
        wakeWordManager.startListening();
      }
      this.notifyListeners();
    } else if (targetMode === 'LIVE') {
      await this.startLive();
    }
  }

  /**
   * Start Live Voice Session (Gemini Live API)
   * Safely pauses wake word before acquiring microphone.
   */
  public async startLive(options?: {
    initialWakeGreeting?: boolean;
    voiceName?: string;
  }): Promise<void> {
    if (this.isTransitioning) return;
    this.isTransitioning = true;

    try {
      // 1. Pause any running TTS audio
      voiceManager.stopAll();

      // 2. Pause standby listening so Web Speech API releases mic hardware cleanly
      wakeWordManager.pauseForLiveMode();

      // 3. Mark mode as LIVE
      this.mode = 'LIVE';
      this.liveState = 'connecting';
      this.errorDetail = undefined;
      this.isMicMuted = false;
      this.isPaused = false;
      this.sessionStartTime = Date.now();
      this.sessionElapsedSec = 0;
      this.startTimer();
      this.notifyListeners();

      // Gather selective contextual memories and tasks
      const pixelContext = this.buildPixelContext();
      const settings = voiceManager.getSettings();
      const chosenVoice = options?.voiceName || settings.selectedLiveVoice || 'Kore';

      // 4. Start Gemini Live session
      await geminiLiveClient.startSession({
        schoolId: this.activeSchool,
        voiceName: chosenVoice,
        initialWakeGreeting: options?.initialWakeGreeting,
        pixelContext,
        callbacks: {
          onStateChange: (state, meta) => {
            this.liveState = state;
            if (meta?.detail) {
              this.errorDetail = meta.detail;
            }
            if (state === 'idle' && this.mode === 'LIVE' && !this.isStoppingLive) {
              // Session closed from server side or ended
              void this.handleSessionEnded();
            }
            this.notifyListeners();
          },
          onTranscriptUpdate: (transcripts) => {
            this.transcripts = transcripts;
            this.syncFinalizedTurnsToCompanionHistory(transcripts);
            this.notifyListeners();
          },
          onInterrupted: () => {
            this.notifyListeners();
          },
          onError: (err) => {
            console.warn('[PixelVoiceCoordinator] Live Client Error:', err);
            this.errorDetail = err.message;
            this.liveState = 'error';
            this.notifyListeners();
          },
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.errorDetail = msg;
      this.liveState = 'error';
      this.mode = 'OFF';
      this.stopTimer();
      geminiLiveClient.stopSession();
      wakeWordManager.stop();
    } finally {
      this.isTransitioning = false;
      this.notifyListeners();
    }
  }

  /**
   * Stop Live Voice session cleanly and optionally restore STANDBY only if wakeWordEnabled is true
   */
  public async stopLive(restoreStandby = false): Promise<void> {
    if (this.isStoppingLive) return;
    this.isStoppingLive = true;

    const shouldRestoreStandby =
      Boolean(restoreStandby) && Boolean(voiceManager.getSettings().wakeWordEnabled);
    const targetMode: PixelVoiceMode = shouldRestoreStandby ? 'STANDBY' : 'OFF';
    this.mode = targetMode;
    this.liveState = 'idle';

    try {
      this.stopTimer();

      // 1. Commit and persist any remaining dialogue turns
      if (this.transcripts.length > 0) {
        this.syncFinalizedTurnsToCompanionHistory(this.transcripts, true);
      }

      // 2. Shut down Gemini Live client & release microphone tracks
      geminiLiveClient.stopSession();
      this.sessionStartTime = null;
      this.sessionElapsedSec = 0;

      // 3. Update wakeWordManager based on target mode
      if (targetMode === 'STANDBY') {
        wakeWordManager.resumeAfterLiveMode();
      } else {
        wakeWordManager.stop();
        this.wakeWordState = 'mic_muted';
      }
    } finally {
      this.isStoppingLive = false;
      this.notifyListeners();
    }
  }

  /**
   * Guaranteed master stop for all voice activity:
   * Stops microphone capture, Gemini Live session, wake word detection, browser STT, and TTS audio playback.
   */
  public async disableAllVoiceActivity(disableTtsSetting = false): Promise<void> {
    this.stopTimer();
    geminiLiveClient.stopSession();
    wakeWordManager.stop();
    browserSpeechInput.cancel();
    browserSpeechInput.stop();
    voiceManager.stopAll();

    this.mode = 'OFF';
    this.liveState = 'idle';
    this.wakeWordState = 'mic_muted';
    this.isMicMuted = false;
    this.isPaused = false;
    this.sessionStartTime = null;
    this.sessionElapsedSec = 0;
    this.errorDetail = undefined;

    voiceManager.updateSettings({
      wakeWordEnabled: false,
      continuousListeningEnabled: false,
      ...(disableTtsSetting ? { ttsEnabled: false } : {}),
    });

    this.notifyListeners();
  }

  public clearError(): void {
    this.errorDetail = undefined;
    if (this.liveState === 'error') {
      this.liveState = 'idle';
    }
    this.notifyListeners();
  }

  /**
   * Mute / unmute microphone in Live mode
   */
  public toggleMute(): void {
    if (this.mode !== 'LIVE') return;
    this.isMicMuted = !this.isMicMuted;
    geminiLiveClient.setMicrophoneMuted(this.isMicMuted);
    this.notifyListeners();
  }

  /**
   * Pause / resume conversation in Live mode
   */
  public togglePause(): void {
    if (this.mode !== 'LIVE') return;
    if (this.liveState === 'paused' || this.isPaused) {
      this.isPaused = false;
      geminiLiveClient.resumeConversation();
    } else {
      this.isPaused = true;
      geminiLiveClient.pauseConversation();
    }
    this.notifyListeners();
  }

  /**
   * Toggle between OFF and STANDBY modes
   */
  public async toggleStandby(): Promise<void> {
    if (this.mode === 'LIVE') {
      const restoreStandby = Boolean(voiceManager.getSettings().wakeWordEnabled);
      await this.stopLive(restoreStandby);
      return;
    }
    if (this.mode === 'STANDBY') {
      await this.setMode('OFF');
    } else {
      await this.setMode('STANDBY');
    }
  }

  /**
   * Triggers explicit browser permission prompt on user interaction
   */
  public async requestMicrophonePermission(): Promise<boolean> {
    const success = await wakeWordManager.requestMicrophonePermission();
    if (success) {
      this.mode = 'STANDBY';
      this.errorDetail = undefined;
      voiceManager.updateSettings({
        wakeWordEnabled: true,
        continuousListeningEnabled: true,
      });
      this.notifyListeners();
    }
    return success;
  }

  private async handleSessionEnded(): Promise<void> {
    if (this.mode !== 'LIVE' || this.isStoppingLive) return;
    const restoreStandby = Boolean(voiceManager.getSettings().wakeWordEnabled);
    await this.stopLive(restoreStandby);
  }

  private startTimer(): void {
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      if (this.sessionStartTime && this.liveState !== 'idle' && this.liveState !== 'error') {
        this.sessionElapsedSec = Math.floor((Date.now() - this.sessionStartTime) / 1000);
        this.notifyListeners();
      }
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private buildPixelContext(): IncomingPixelContext | undefined {
    if (!this.contextResolvers) return undefined;

    const memories = this.contextResolvers.getCompanionMemory();
    const tasks = this.contextResolvers.getCompanionTasks();
    const school = this.activeSchool;

    const relevantMemories = memories
      .filter((m) => !m.schoolId || m.schoolId === school)
      .slice(0, 8)
      .map((m) => ({
        id: m.id,
        category: m.category,
        title: m.title,
        content: m.content,
      }));

    const activeTasks = tasks
      .filter((t) => !t.schoolId || t.schoolId === school)
      .filter((t) => t.status !== 'done')
      .slice(0, 10)
      .map((t) => ({
        id: t.id,
        title: t.title,
        dueDate: t.dueDate || '',
        priority: t.priority,
        status: t.status,
      }));

    return {
      activeSchool: school,
      schoolName: school === 'kiberone' ? 'KIBERONE' : 'RENDERIA',
      relevantMemories,
      activeTasks,
      activeChatContext: this.contextResolvers.getActiveChatContext?.(),
    };
  }

  /**
   * Commits finalized spoken turns to Pixel's permanent companionMessages
   * so switching to text chat seamlessly reveals everything spoken.
   */
  private syncFinalizedTurnsToCompanionHistory(
    transcripts: LiveTranscriptEntry[],
    forceAll = false
  ): void {
    if (!this.contextResolvers) return;

    const newMessagesToSave: CompanionMessage[] = [];
    const nowIso = new Date().toISOString();

    for (const turn of transcripts) {
      if (!turn.text || !turn.text.trim()) continue;

      // If turn is still partial and not forcing save, wait until completed
      if (turn.isPartial && !forceAll) continue;

      if (!this.savedTranscriptIds.has(turn.id)) {
        this.savedTranscriptIds.add(turn.id);
        newMessagesToSave.push({
          id: `live-turn-${turn.id}`,
          role: turn.role === 'user' ? 'user' : 'pixel',
          content: turn.text.trim(),
          createdAt: turn.timestamp || nowIso,
          createdAtMs: Date.now(),
          schoolId: this.activeSchool,
          isSpoken: true,
        });
      }
    }

    if (newMessagesToSave.length > 0) {
      void this.contextResolvers.onAppendCompanionMessages(newMessagesToSave);
    }
  }

  public stop(): void {
    void this.stopLive(false);
    wakeWordManager.stop();
    this.mode = 'OFF';
    this.stopTimer();
    this.notifyListeners();
  }

  private notifyListeners(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.warn('[PixelVoiceCoordinator] Listener error:', err);
      }
    }
  }
}

export const pixelVoiceCoordinator = new PixelVoiceCoordinator();
