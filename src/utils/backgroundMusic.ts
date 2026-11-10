/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { getAutumnThemeStored, AUTUMN_THEME_CHANGE_EVENT } from './autumnTheme';
import { pixelVoiceCoordinator } from '../providers/voice/pixelVoiceCoordinator';
import { voiceManager } from '../providers/voice/voiceManager';
import { browserSpeechInput } from '../providers/voice/browserSpeechInputProvider';

export const BG_MUSIC_PLAYING_STORAGE_KEY = 'kiberone_bg_music_playing';
export const BG_MUSIC_VOLUME_STORAGE_KEY = 'kiberone_bg_music_volume';
export const BG_MUSIC_STATE_CHANGE_EVENT = 'kiberone:bg-music-state-changed';

export interface BackgroundMusicState {
  isPlaying: boolean;
  volume: number; // 0.0 to 1.0 (default 0.40)
  isDucked: boolean;
  duckReason: 'mic' | 'tts' | null;
  effectiveVolume: number;
}

export function getStoredMusicPlaying(): boolean {
  try {
    if (typeof window === 'undefined') return true;
    const item = localStorage.getItem(BG_MUSIC_PLAYING_STORAGE_KEY);
    if (item === null) return true; // Default ON
    return item === 'true';
  } catch {
    return true;
  }
}

export function setStoredMusicPlaying(playing: boolean): void {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem(BG_MUSIC_PLAYING_STORAGE_KEY, playing ? 'true' : 'false');
  } catch {
    // Ignore storage write failures
  }
}

export function getStoredMusicVolume(): number {
  try {
    if (typeof window === 'undefined') return 0.4;
    const item = localStorage.getItem(BG_MUSIC_VOLUME_STORAGE_KEY);
    if (item === null) return 0.4; // Default 40%
    const num = parseFloat(item);
    if (!isNaN(num) && num >= 0 && num <= 1) return num;
    return 0.4;
  } catch {
    return 0.4;
  }
}

export function setStoredMusicVolume(vol: number): void {
  try {
    if (typeof window === 'undefined') return;
    const clamped = Math.max(0, Math.min(1, vol));
    localStorage.setItem(BG_MUSIC_VOLUME_STORAGE_KEY, clamped.toString());
  } catch {
    // Ignore storage write failures
  }
}

/**
 * Singleton Audio element reference manager so background music persists across route and tab changes.
 */
class BackgroundAudioManager {
  private audioElement: HTMLAudioElement | null = null;
  private userPlaying: boolean = true;
  private userVolume: number = 0.4;
  private isDucked: boolean = false;
  private duckReason: 'mic' | 'tts' | null = null;
  private fadeInterval: ReturnType<typeof setInterval> | null = null;
  private autoplayUnlocked = false;

  constructor() {
    this.userPlaying = getStoredMusicPlaying();
    this.userVolume = getStoredMusicVolume();
  }

  public registerAudioElement(element: HTMLAudioElement | null): void {
    this.audioElement = element;
    if (!element) return;

    element.volume = this.getEffectiveVolume();
    element.loop = true;

    // Browser Autoplay Policy safety: unlock upon first user gesture
    if (!this.autoplayUnlocked) {
      const unlockAutoplay = () => {
        this.autoplayUnlocked = true;
        if (this.shouldBePlaying()) {
          this.audioElement?.play().catch(() => {});
        }
        window.removeEventListener('pointerdown', unlockAutoplay);
        window.removeEventListener('keydown', unlockAutoplay);
      };
      window.addEventListener('pointerdown', unlockAutoplay, { once: true });
      window.addEventListener('keydown', unlockAutoplay, { once: true });
    }

    this.syncPlaybackState();
  }

  public shouldBePlaying(): boolean {
    const autumnThemeActive = getAutumnThemeStored();
    return autumnThemeActive && this.userPlaying;
  }

  public getEffectiveVolume(): number {
    if (this.isDucked) {
      return 0; // Duck to 0 so speech capture and TTS are crystal clear
    }
    return this.userVolume;
  }

  public setPlaying(playing: boolean): void {
    this.userPlaying = playing;
    setStoredMusicPlaying(playing);
    this.syncPlaybackState();
    this.emitStateChange();
  }

  public togglePlaying(): void {
    this.setPlaying(!this.userPlaying);
  }

  public setVolume(vol: number): void {
    const clamped = Math.max(0, Math.min(1, vol));
    this.userVolume = clamped;
    setStoredMusicVolume(clamped);
    if (!this.isDucked && this.audioElement) {
      this.smoothVolumeTransition(clamped);
    }
    this.emitStateChange();
  }

  public setDucking(ducked: boolean, reason: 'mic' | 'tts' | null): void {
    if (this.isDucked === ducked && this.duckReason === reason) return;
    this.isDucked = ducked;
    this.duckReason = reason;

    const targetVol = this.getEffectiveVolume();
    this.smoothVolumeTransition(targetVol);
    this.emitStateChange();
  }

  public handleAutumnThemeChange(enabled: boolean): void {
    if (!enabled) {
      // Pause immediately when autumn theme is turned off
      if (this.audioElement && !this.audioElement.paused) {
        this.audioElement.pause();
      }
    } else {
      // Resume if user had it playing
      this.syncPlaybackState();
    }
    this.emitStateChange();
  }

  public syncPlaybackState(): void {
    if (!this.audioElement) return;

    if (this.shouldBePlaying()) {
      if (this.audioElement.paused) {
        const playPromise = this.audioElement.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            // Autoplay prevented by browser policy — waiting for user gesture
            console.log('[BackgroundMusic] Autoplay deferred until user gesture:', err.name);
          });
        }
      }
      this.smoothVolumeTransition(this.getEffectiveVolume());
    } else {
      if (!this.audioElement.paused) {
        this.audioElement.pause();
      }
    }
  }

  private smoothVolumeTransition(targetVolume: number): void {
    if (!this.audioElement) return;
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }

    const startVolume = this.audioElement.volume;
    if (Math.abs(startVolume - targetVolume) < 0.01) {
      this.audioElement.volume = targetVolume;
      return;
    }

    const durationMs = targetVolume === 0 ? 220 : 380; // Duck quickly (220ms), return gently (380ms)
    const stepIntervalMs = 25;
    const totalSteps = Math.max(1, Math.floor(durationMs / stepIntervalMs));
    const volumeStep = (targetVolume - startVolume) / totalSteps;
    let step = 0;

    this.fadeInterval = setInterval(() => {
      step++;
      if (!this.audioElement) {
        if (this.fadeInterval) clearInterval(this.fadeInterval);
        return;
      }

      if (step >= totalSteps) {
        this.audioElement.volume = targetVolume;
        if (this.fadeInterval) {
          clearInterval(this.fadeInterval);
          this.fadeInterval = null;
        }
      } else {
        const nextVol = Math.max(0, Math.min(1, startVolume + volumeStep * step));
        this.audioElement.volume = nextVol;
      }
    }, stepIntervalMs);
  }

  public getState(): BackgroundMusicState {
    return {
      isPlaying: this.userPlaying,
      volume: this.userVolume,
      isDucked: this.isDucked,
      duckReason: this.duckReason,
      effectiveVolume: this.audioElement ? this.audioElement.volume : this.getEffectiveVolume(),
    };
  }

  private emitStateChange(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent(BG_MUSIC_STATE_CHANGE_EVENT, { detail: this.getState() })
    );
  }
}

export const backgroundAudioManager = new BackgroundAudioManager();

/**
 * React hook to observe and control background music.
 */
export function useBackgroundMusic() {
  const [musicState, setMusicState] = useState<BackgroundMusicState>(() =>
    backgroundAudioManager.getState()
  );

  useEffect(() => {
    // 1. Listen for background music state changes
    const handleMusicChange = (event: Event) => {
      const customEvent = event as CustomEvent<BackgroundMusicState>;
      if (customEvent.detail) {
        setMusicState(customEvent.detail);
      } else {
        setMusicState(backgroundAudioManager.getState());
      }
    };

    // 2. Listen for Autumn theme toggles
    const handleThemeChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ enabled: boolean }>;
      const enabled =
        customEvent.detail && typeof customEvent.detail.enabled === 'boolean'
          ? customEvent.detail.enabled
          : getAutumnThemeStored();
      backgroundAudioManager.handleAutumnThemeChange(enabled);
      setMusicState(backgroundAudioManager.getState());
    };

    window.addEventListener(BG_MUSIC_STATE_CHANGE_EVENT, handleMusicChange);
    window.addEventListener(AUTUMN_THEME_CHANGE_EVENT, handleThemeChange);

    // 3. Audio Ducking Coordination:
    // Watch mic capture and speech synthesis from all providers
    const evaluateDucking = () => {
      const coordSnap = pixelVoiceCoordinator.getSnapshot();
      const isPixelSpeakingLive = coordSnap.liveState === 'speaking';
      const isMicListeningLive = coordSnap.liveState === 'listening';
      const isTtsSpeaking = voiceManager.isSpeaking();
      const isSpeechInputListening =
        browserSpeechInput.getStatus() === 'listening' ||
        browserSpeechInput.getStatus() === 'recognizing';

      if (isMicListeningLive || isSpeechInputListening) {
        backgroundAudioManager.setDucking(true, 'mic');
      } else if (isPixelSpeakingLive || isTtsSpeaking) {
        backgroundAudioManager.setDucking(true, 'tts');
      } else {
        backgroundAudioManager.setDucking(false, null);
      }
    };

    const unsubCoord = pixelVoiceCoordinator.onStateChange(() => {
      evaluateDucking();
    });

    const unsubTts = voiceManager.onPlaybackStateChange(() => {
      evaluateDucking();
    });

    const unsubSpeechInput = browserSpeechInput.onStatusChange(() => {
      evaluateDucking();
    });

    // Initial evaluation
    evaluateDucking();

    return () => {
      window.removeEventListener(BG_MUSIC_STATE_CHANGE_EVENT, handleMusicChange);
      window.removeEventListener(AUTUMN_THEME_CHANGE_EVENT, handleThemeChange);
      unsubCoord();
      unsubTts();
      unsubSpeechInput();
    };
  }, []);

  const togglePlaying = useCallback(() => {
    backgroundAudioManager.togglePlaying();
  }, []);

  const setPlaying = useCallback((playing: boolean) => {
    backgroundAudioManager.setPlaying(playing);
  }, []);

  const setVolume = useCallback((volume: number) => {
    backgroundAudioManager.setVolume(volume);
  }, []);

  return {
    ...musicState,
    togglePlaying,
    setPlaying,
    setVolume,
  };
}
