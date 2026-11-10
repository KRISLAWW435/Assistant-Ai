/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Play, Pause, Music, SlidersHorizontal } from 'lucide-react';
import { backgroundAudioManager, useBackgroundMusic } from '../utils/backgroundMusic';
import { useAutumnTheme } from '../utils/autumnTheme';

/**
 * BackgroundMusic Core Audio Component:
 * Embeds the persistent <audio> tag with loop attribute and registers with backgroundAudioManager.
 */
export const BackgroundMusic: React.FC = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (audioRef.current) {
      backgroundAudioManager.registerAudioElement(audioRef.current);
    }
    return () => {
      backgroundAudioManager.registerAudioElement(null);
    };
  }, []);

  return (
    <audio
      ref={audioRef}
      src="/AutumnRain.mp3"
      loop
      preload="auto"
      className="hidden"
      aria-hidden="true"
    />
  );
};

interface BackgroundMusicButtonProps {
  collapsed?: boolean;
}

/**
 * Compact Music Control Button for Right Workspace Panel:
 * - Hidden when Autumn Theme is OFF.
 * - Visible and interactive when Autumn Theme is ON.
 * - 1-Click Play/Pause.
 * - Volume adjustment slider and mute toggle.
 * - Visual ducking indicator when speech / mic is active.
 */
export const BackgroundMusicButton: React.FC<BackgroundMusicButtonProps> = ({
  collapsed = false,
}) => {
  const { isAutumnTheme } = useAutumnTheme();
  const { isPlaying, volume, isDucked, duckReason, togglePlaying, setVolume } =
    useBackgroundMusic();
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close volume popover on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowVolumeSlider(false);
      }
    };
    if (showVolumeSlider) {
      document.addEventListener('pointerdown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick);
    };
  }, [showVolumeSlider]);

  // Requirement 3: If autumn theme is disabled, hide the control
  if (!isAutumnTheme) {
    return null;
  }

  const volumePercent = Math.round(volume * 100);
  const isEffectivelyMuted = !isPlaying || volume === 0;

  if (collapsed) {
    return (
      <div className="relative group">
        <button
          type="button"
          onClick={togglePlaying}
          title={
            isPlaying
              ? `Осенняя музыка играет (${volumePercent}%). Нажмите для паузы`
              : 'Включить фоновую осеннюю музыку'
          }
          aria-label={
            isPlaying
              ? 'Пауза осенней музыки'
              : 'Включить осеннюю музыку'
          }
          className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-colors cursor-pointer ${
            isPlaying
              ? 'bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200'
              : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
          }`}
        >
          {isEffectivelyMuted ? (
            <VolumeX className="w-4 h-4 text-slate-400" />
          ) : (
            <Volume2 className="w-4 h-4 text-amber-800" />
          )}
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <div
        className={`inline-flex items-center gap-1 rounded-lg border text-[10px] font-bold transition-all ${
          isPlaying
            ? isDucked
              ? 'bg-amber-50/90 text-amber-800 border-amber-300'
              : 'bg-amber-100 text-amber-950 border-amber-300 hover:bg-amber-200/90'
            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
        }`}
      >
        {/* Play / Pause Toggle Button */}
        <button
          type="button"
          onClick={togglePlaying}
          title={
            isPlaying
              ? `Осенний дождь (${volumePercent}%)${isDucked ? ' — Приглушено во время речи' : ''}. Нажмите для паузы`
              : 'Включить фоновую мелодию «Осенний дождь» (40%)'
          }
          aria-label={isPlaying ? 'Приостановить музыку' : 'Воспроизвести музыку'}
          className="inline-flex items-center gap-1.5 px-2 py-1.5 cursor-pointer rounded-l-lg hover:opacity-85 transition-opacity"
        >
          {isPlaying ? (
            isDucked ? (
              <span className="w-3.5 h-3.5 flex items-center justify-center text-amber-600">
                <Music className="w-3 h-3 animate-pulse" />
              </span>
            ) : (
              <Pause className="w-3 h-3 fill-current text-amber-900" />
            )
          ) : (
            <Play className="w-3 h-3 fill-current text-slate-600" />
          )}

          <span className="truncate max-w-[75px] sm:max-w-[85px]">
            {isDucked ? 'Приглушено' : isPlaying ? 'Мелодия' : 'Музыка'}
          </span>
        </button>

        {/* Volume & Popover Trigger Button */}
        <button
          type="button"
          onClick={() => setShowVolumeSlider((prev) => !prev)}
          title={`Громкость: ${volumePercent}%. Нажмите для настройки`}
          aria-label="Регулировка громкости музыки"
          className="px-1.5 py-1.5 border-l border-amber-200/70 hover:bg-amber-200/50 rounded-r-lg transition-colors cursor-pointer flex items-center gap-1"
        >
          {isEffectivelyMuted ? (
            <VolumeX className="w-3 h-3 text-slate-400" />
          ) : (
            <Volume2 className="w-3 h-3 text-amber-900" />
          )}
          <span className="font-mono-tabular text-[9px] text-amber-950">
            {volumePercent}%
          </span>
        </button>
      </div>

      {/* Floating Volume Adjustment Popover */}
      {showVolumeSlider && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-48 p-2.5 rounded-xl bg-white border border-slate-200/90 shadow-xl space-y-2 select-none animate-in fade-in zoom-in-95">
          <div className="flex items-center justify-between text-[11px] text-slate-700 font-semibold">
            <span className="flex items-center gap-1 text-amber-900">
              <Music className="w-3 h-3 text-amber-600" />
              <span>Осенний дождь</span>
            </span>
            <span className="font-mono-tabular text-slate-900 text-[10px]">
              {volumePercent}%
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setVolume(volume === 0 ? 0.4 : 0)}
              title={volume === 0 ? 'Включить звук' : 'Заглушить'}
              className="text-slate-500 hover:text-slate-900 p-0.5 rounded cursor-pointer"
            >
              {volume === 0 ? (
                <VolumeX className="w-3.5 h-3.5 text-rose-500" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-amber-600"
              aria-label="Громкость фоновой музыки"
            />
          </div>

          {isDucked && (
            <div className="text-[10px] text-amber-700 bg-amber-50 px-2 py-1 rounded-md border border-amber-200 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
              <span>
                {duckReason === 'mic'
                  ? 'Приглушено: Пиксель слушает'
                  : 'Приглушено: Пиксель говорит'}
              </span>
            </div>
          )}

          <div className="pt-1 border-t border-slate-100 flex items-center justify-between text-[9px] text-slate-400">
            <span>Audio Ducking включён</span>
            <span>Авто-повтор 🔁</span>
          </div>
        </div>
      )}
    </div>
  );
};
