/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PixelEmotion } from './PixelTypes';

export interface EmotionManagerConfig {
  sleepyTimeoutMs?: number; // default: 2 min (120,000 ms)
  sleepTimeoutMs?: number;  // default: 5 min (300,000 ms)
  enableProactiveTips?: boolean;
}

const EMOTION_PRIORITY: Record<PixelEmotion, number> = {
  speaking: 5,
  listening: 5,
  thinking: 5,
  interacting: 4,
  waking: 4,
  happy: 3,
  curious: 3,
  surprised: 3,
  bashful: 3,
  empathetic: 3,
  sleepy: 2,
  sleeping: 2,
  idle: 1,
};

export class PixelEmotionManager {
  private currentEmotion: PixelEmotion = 'idle';
  private lockedUntilMs = 0;
  private lastActivityMs = Date.now();
  private sleepyTimeoutMs = 2 * 60 * 1000; // 2 minutes
  private sleepTimeoutMs = 5 * 60 * 1000;  // 5 minutes
  private checkInterval: number | null = null;
  private listeners = new Set<(emotion: PixelEmotion) => void>();
  private isVoiceActive = false;
  private isThinkingActive = false;

  constructor(config?: EmotionManagerConfig) {
    if (config?.sleepyTimeoutMs) this.sleepyTimeoutMs = config.sleepyTimeoutMs;
    if (config?.sleepTimeoutMs) this.sleepTimeoutMs = config.sleepTimeoutMs;

    this.startInactivityChecker();
  }

  public getEmotion(): PixelEmotion {
    return this.currentEmotion;
  }

  public setEmotion(
    nextEmotion: PixelEmotion,
    durationMs = 0,
    force = false
  ): void {
    const now = Date.now();

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
      // Auto-revert after duration
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

  /**
   * Called when user moves mouse, clicks, or interacts with the app
   */
  public reportUserActivity(): void {
    this.lastActivityMs = Date.now();

    // If Pixel was sleepy or sleeping, wake up!
    if (this.currentEmotion === 'sleeping' || this.currentEmotion === 'sleepy') {
      this.wakeUp();
    }
  }

  /**
   * Wake up sequence with joyful stretch
   */
  public wakeUp(): void {
    this.lastActivityMs = Date.now();
    this.setEmotion('waking', 1200, true);
    window.setTimeout(() => {
      this.revertToDefaultState();
    }, 1200);
  }

  /**
   * Signal voice state updates (speaking / listening)
   */
  public setVoiceState(state: { isListening: boolean; isSpeaking: boolean }): void {
    this.isVoiceActive = state.isListening || state.isSpeaking;

    if (state.isSpeaking) {
      this.setEmotion('speaking', 0, true);
    } else if (state.isListening) {
      this.setEmotion('listening', 0, true);
    } else {
      if (this.currentEmotion === 'speaking' || this.currentEmotion === 'listening') {
        this.revertToDefaultState();
      }
    }
  }

  /**
   * Signal LLM generation / thinking state
   */
  public setThinkingState(isThinking: boolean): void {
    this.isThinkingActive = isThinking;
    if (isThinking) {
      this.setEmotion('thinking', 0, true);
    } else if (this.currentEmotion === 'thinking') {
      this.revertToDefaultState();
    }
  }

  /**
   * Trigger pet / click interaction with playful bounce and heart burst
   */
  public triggerPetInteraction(): void {
    this.reportUserActivity();
    // Quick burst of interacting / happy
    this.setEmotion('interacting', 900, true);
    window.setTimeout(() => {
      if (this.currentEmotion === 'interacting') {
        this.setEmotion('happy', 1400, true);
      }
    }, 900);
  }

  public subscribe(listener: (emotion: PixelEmotion) => void): () => void {
    this.listeners.add(listener);
    listener(this.currentEmotion);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public destroy(): void {
    if (this.checkInterval) {
      window.clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.listeners.clear();
  }

  private revertToDefaultState(): void {
    if (this.isSpeakingActive) {
      this.setEmotion('speaking', 0, true);
    } else if (this.isVoiceActive) {
      this.setEmotion('listening', 0, true);
    } else if (this.isThinkingActive) {
      this.setEmotion('thinking', 0, true);
    } else {
      this.setEmotion('idle', 0, true);
    }
  }

  private startInactivityChecker(): void {
    if (typeof window === 'undefined') return;

    this.checkInterval = window.setInterval(() => {
      // Never put to sleep if actively speaking, listening, or thinking
      if (this.isVoiceActive || this.isThinkingActive) {
        this.lastActivityMs = Date.now();
        return;
      }

      const idleDuration = Date.now() - this.lastActivityMs;

      if (idleDuration >= this.sleepTimeoutMs) {
        if (this.currentEmotion !== 'sleeping') {
          this.setEmotion('sleeping', 0, false);
        }
      } else if (idleDuration >= this.sleepyTimeoutMs) {
        if (this.currentEmotion !== 'sleepy' && this.currentEmotion !== 'sleeping') {
          this.setEmotion('sleepy', 0, false);
        }
      }
    }, 3000);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.currentEmotion);
      } catch (err) {
        console.warn('[PixelEmotionManager] Listener error:', err);
      }
    }
  }

  private get isSpeakingActive(): boolean {
    return this.isVoiceActive && this.currentEmotion === 'speaking';
  }
}

export const pixelEmotionManager = new PixelEmotionManager();
