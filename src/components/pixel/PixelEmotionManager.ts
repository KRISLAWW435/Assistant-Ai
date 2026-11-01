/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { IdleMicroBehavior, PixelEmotion } from './PixelTypes';

export interface EmotionManagerConfig {
  sleepyTimeoutMs?: number; // default: 2.5 min
  sleepTimeoutMs?: number;  // default: 6 min
  enableProactiveTips?: boolean;
}

const EMOTION_PRIORITY: Record<PixelEmotion, number> = {
  speaking: 5,
  listening: 5,
  thinking: 5,
  thoughtful: 5,
  interacting: 4,
  waking: 4,
  happy: 3,
  joy: 3,
  curious: 3,
  curiosity: 3,
  surprised: 3,
  surprise: 3,
  bashful: 3,
  shy: 3,
  empathetic: 3,
  empathy: 3,
  sadness: 3,
  sleepy: 2,
  sleeping: 2,
  idle: 1,
  calm: 1,
};

const IDLE_BEHAVIOR_OPTIONS: IdleMicroBehavior[] = [
  'look_around',
  'look_up',
  'slow_blink',
  'chew',
  'music_sway',
  'stretch_bounce',
  'doze',
];

export class PixelEmotionManager {
  private currentEmotion: PixelEmotion = 'calm';
  private currentMicroBehavior: IdleMicroBehavior = 'none';
  private lockedUntilMs = 0;
  private lastActivityMs = Date.now();
  private sleepyTimeoutMs = 2.5 * 60 * 1000; // 2.5 minutes
  private sleepTimeoutMs = 6 * 60 * 1000;   // 6 minutes
  private checkInterval: number | null = null;
  private microBehaviorTimer: number | null = null;
  private microBehaviorDurationTimer: number | null = null;

  private listeners = new Set<(emotion: PixelEmotion) => void>();
  private microBehaviorListeners = new Set<(behavior: IdleMicroBehavior) => void>();

  private isVoiceActive = false;
  private isThinkingActive = false;

  constructor(config?: EmotionManagerConfig) {
    if (config?.sleepyTimeoutMs) this.sleepyTimeoutMs = config.sleepyTimeoutMs;
    if (config?.sleepTimeoutMs) this.sleepTimeoutMs = config.sleepTimeoutMs;

    this.startInactivityChecker();
    this.scheduleNextMicroBehavior();
  }

  public getEmotion(): PixelEmotion {
    return this.currentEmotion;
  }

  public getMicroBehavior(): IdleMicroBehavior {
    return this.currentMicroBehavior;
  }

  public setEmotion(
    nextEmotion: PixelEmotion,
    durationMs = 0,
    force = false
  ): void {
    const now = Date.now();

    // Interrupt any active idle micro-behavior when emotion shifts
    if (this.currentMicroBehavior !== 'none' && nextEmotion !== 'idle' && nextEmotion !== 'calm') {
      this.setMicroBehavior('none');
    }

    // Respect active lock unless forced or incoming emotion is higher priority
    if (
      !force &&
      now < this.lockedUntilMs &&
      EMOTION_PRIORITY[nextEmotion] < EMOTION_PRIORITY[this.currentEmotion]
    ) {
      return;
    }

    if (durationMs > 0) {
      this.lockedUntilMs = now + durationMs;
      window.setTimeout(() => {
        if (this.currentEmotion === nextEmotion && Date.now() >= this.lockedUntilMs) {
          this.revertToDefaultState();
        }
      }, durationMs);
    } else {
      this.lockedUntilMs = 0;
    }

    if (this.currentEmotion !== nextEmotion) {
      this.currentEmotion = nextEmotion;
      this.notifyListeners();
    }
  }

  public setMicroBehavior(behavior: IdleMicroBehavior): void {
    if (this.currentMicroBehavior !== behavior) {
      this.currentMicroBehavior = behavior;
      this.notifyMicroBehaviorListeners();
    }
  }

  /**
   * Called when Anna moves mouse, clicks, or speaks to immediately stop idle activity
   */
  public reportUserActivity(): void {
    this.lastActivityMs = Date.now();

    // Instantly cancel any micro behavior
    if (this.currentMicroBehavior !== 'none') {
      this.setMicroBehavior('none');
    }

    // If Pixel was sleepy or sleeping, wake up!
    if (this.currentEmotion === 'sleeping' || this.currentEmotion === 'sleepy') {
      this.wakeUp();
    }
  }

  /**
   * Wake up sequence with soft stretch
   */
  public wakeUp(): void {
    this.setEmotion('waking', 800, true);
    window.setTimeout(() => {
      this.setEmotion('calm', 0, true);
    }, 850);
  }

  public setVoiceState({
    isListening,
    isSpeaking,
  }: {
    isListening: boolean;
    isSpeaking: boolean;
  }): void {
    this.reportUserActivity();
    this.isVoiceActive = isListening || isSpeaking;

    if (isSpeaking) {
      this.setEmotion('speaking', 0, true);
    } else if (isListening) {
      this.setEmotion('listening', 0, true);
    } else {
      this.revertToDefaultState();
    }
  }

  public setThinkingState(isThinking: boolean): void {
    this.isThinkingActive = isThinking;
    if (isThinking) {
      this.setEmotion('thoughtful', 0, true);
    } else {
      this.revertToDefaultState();
    }
  }

  /**
   * Analyzes the semantic context of Anna's input and Pixel's response
   * to determine a natural, non-theatrical emotional reaction.
   */
  public analyzeDialogueContext(userText: string, assistantText = ''): void {
    const combined = `${userText} ${assistantText}`.toLowerCase();

    // 1. Empathy / Caring response (problems, tiredness, illness, overload)
    if (
      combined.includes('устал') ||
      combined.includes('тяжел') ||
      combined.includes('трудно') ||
      combined.includes('сложно') ||
      combined.includes('грустн') ||
      combined.includes('не получается') ||
      combined.includes('проблем') ||
      combined.includes('болею') ||
      combined.includes('пережива') ||
      combined.includes('выгора')
    ) {
      this.setEmotion('empathy', 4500);
      return;
    }

    // 2. Joy / Celebration / Relief (good news, gratitude, fun)
    if (
      combined.includes('ура') ||
      combined.includes('спасибо') ||
      combined.includes('получилось') ||
      combined.includes('отлично') ||
      combined.includes('здорово') ||
      combined.includes('супер') ||
      combined.includes('рада') ||
      combined.includes('смешн') ||
      combined.includes('ха-ха') ||
      combined.includes('класс') ||
      combined.includes('замечательно')
    ) {
      this.setEmotion('joy', 4000);
      return;
    }

    // 3. Curiosity / Exploration (questions about ideas, plans, creative concepts)
    if (
      combined.includes('как думаешь') ||
      combined.includes('а если') ||
      combined.includes('интересно') ||
      combined.includes('расскажи') ||
      combined.includes('новый проект') ||
      combined.includes('почему')
    ) {
      this.setEmotion('curiosity', 3500);
      return;
    }

    // 4. Surprise (unexpected turns, surprising facts)
    if (
      combined.includes('ничего себе') ||
      combined.includes('правда?') ||
      combined.includes('ого') ||
      combined.includes('неожиданно') ||
      combined.includes('серьёзно?')
    ) {
      this.setEmotion('surprise', 3000);
      return;
    }

    // 5. Thoughtful / Planning
    if (
      combined.includes('давай подумаем') ||
      combined.includes('план') ||
      combined.includes('стратеги') ||
      combined.includes('расписание') ||
      combined.includes('проанализируй')
    ) {
      this.setEmotion('thoughtful', 3500);
      return;
    }

    // 6. Shy / Gentle praise
    if (
      combined.includes('милый') ||
      combined.includes('ты хороший') ||
      combined.includes('ты умница') ||
      combined.includes('люблю тебя') ||
      combined.includes('прелесть')
    ) {
      this.setEmotion('shy', 4000);
      return;
    }

    // Default: calm, friendly presence
    this.setEmotion('calm', 2500);
  }

  private revertToDefaultState(): void {
    if (this.isVoiceActive) return;
    if (this.isThinkingActive) {
      this.setEmotion('thoughtful');
      return;
    }

    const elapsed = Date.now() - this.lastActivityMs;
    if (elapsed > this.sleepTimeoutMs) {
      this.setEmotion('sleeping');
    } else if (elapsed > this.sleepyTimeoutMs) {
      this.setEmotion('sleepy');
    } else {
      this.setEmotion('calm');
    }
  }

  private startInactivityChecker(): void {
    if (typeof window === 'undefined') return;

    this.checkInterval = window.setInterval(() => {
      if (this.isVoiceActive || this.isThinkingActive) return;
      const now = Date.now();
      if (now < this.lockedUntilMs) return;

      const elapsed = now - this.lastActivityMs;

      if (elapsed > this.sleepTimeoutMs && this.currentEmotion !== 'sleeping') {
        this.setEmotion('sleeping');
      } else if (
        elapsed > this.sleepyTimeoutMs &&
        elapsed <= this.sleepTimeoutMs &&
        this.currentEmotion !== 'sleepy' &&
        this.currentEmotion !== 'sleeping'
      ) {
        this.setEmotion('sleepy');
      }
    }, 10000);
  }

  private scheduleNextMicroBehavior(): void {
    if (typeof window === 'undefined') return;

    // Random interval between 14 and 26 seconds
    const nextIntervalMs = Math.random() * 12000 + 14000;

    this.microBehaviorTimer = window.setTimeout(() => {
      const isIdleOrCalm =
        (this.currentEmotion === 'idle' || this.currentEmotion === 'calm') &&
        !this.isVoiceActive &&
        !this.isThinkingActive;

      const idleTime = Date.now() - this.lastActivityMs;

      // Only trigger if Anna hasn't interacted for at least 8 seconds
      if (isIdleOrCalm && idleTime > 8000) {
        const randomBehavior =
          IDLE_BEHAVIOR_OPTIONS[
            Math.floor(Math.random() * IDLE_BEHAVIOR_OPTIONS.length)
          ];
        const duration = randomBehavior === 'doze' ? 12000 : 3500;

        this.setMicroBehavior(randomBehavior);

        if (this.microBehaviorDurationTimer) {
          window.clearTimeout(this.microBehaviorDurationTimer);
        }

        this.microBehaviorDurationTimer = window.setTimeout(() => {
          this.setMicroBehavior('none');
        }, duration);
      }

      this.scheduleNextMicroBehavior();
    }, nextIntervalMs);
  }

  public subscribe(callback: (emotion: PixelEmotion) => void): () => void {
    this.listeners.add(callback);
    callback(this.currentEmotion);
    return () => this.listeners.delete(callback);
  }

  public subscribeMicroBehavior(
    callback: (behavior: IdleMicroBehavior) => void
  ): () => void {
    this.microBehaviorListeners.add(callback);
    callback(this.currentMicroBehavior);
    return () => this.microBehaviorListeners.delete(callback);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.currentEmotion);
      } catch {
        // ignore
      }
    }
  }

  private notifyMicroBehaviorListeners(): void {
    for (const listener of this.microBehaviorListeners) {
      try {
        listener(this.currentMicroBehavior);
      } catch {
        // ignore
      }
    }
  }

  public destroy(): void {
    if (this.checkInterval) window.clearInterval(this.checkInterval);
    if (this.microBehaviorTimer) window.clearTimeout(this.microBehaviorTimer);
    if (this.microBehaviorDurationTimer) window.clearTimeout(this.microBehaviorDurationTimer);
    this.listeners.clear();
    this.microBehaviorListeners.clear();
  }
}

export const pixelEmotionManager = new PixelEmotionManager();
