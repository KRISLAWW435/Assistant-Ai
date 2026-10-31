/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type PixelEmotion =
  | 'idle'        // Calm breathing, natural blinking, tracking cursor
  | 'happy'       // Joyful bounce, smiling crescent eyes, sparkles/hearts
  | 'curious'     // Widened pupils, slight head tilt toward mouse/object
  | 'surprised'   // Wide open eyes, pupils dilated, slight hop
  | 'thinking'    // Pupils glance up/aside, contemplative squint, twilight pulse
  | 'empathetic'  // Soft caring eyelids, slow rhythmic breathing
  | 'bashful'     // Cheeks rosy flush, eyes avert momentarily
  | 'sleepy'      // Drooping heavy eyelids, yawns, dimming glow
  | 'sleeping'    // Closed eyes, slow peaceful breathing, floating 'z' particles
  | 'waking'      // Eyes flutter open, stretch/squash bounce, bright wake flash
  | 'listening'   // Attentive posture, focused eyes, emerald/cyan live pulse
  | 'speaking'    // Voice undulating pulse, animated expression in rhythm
  | 'interacting';// Elastic squash-and-stretch on click, pet response

export type PixelSize = 48 | 72 | 120 | number;

export interface NormalizedGaze {
  x: number; // -1 to 1
  y: number; // -1 to 1
}

export interface FloatingParticle {
  id: string;
  type: 'heart' | 'sparkle' | 'sleep-z';
  x: number;       // relative origin X in px
  y: number;       // relative origin Y in px
  targetX: number; // destination X offset in px
  targetY: number; // destination Y offset in px
  scale: number;
  rotation: number;
  color: string;
  delayMs: number;
  durationMs: number;
}

export interface PixelCharacterProps {
  size?: PixelSize;
  emotion?: PixelEmotion;
  onEmotionChange?: (emotion: PixelEmotion) => void;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onPet?: () => void;
  petTrigger?: number;
  interactive?: boolean;
  isSpeaking?: boolean;
  isListening?: boolean;
  isThinking?: boolean;
  disabledTrackMouse?: boolean;
  className?: string;
  showAura?: boolean;
  proactiveTipText?: string | null;
  onDismissTip?: () => void;
}
