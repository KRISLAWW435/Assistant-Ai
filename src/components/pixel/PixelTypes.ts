/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type PixelEmotion =
  | 'idle'        // Calm breathing, natural blinking, tracking cursor
  | 'calm'        // Спокойное ожидание (нейтральное доброжелательное выражение)
  | 'happy'       // Радость (старое имя)
  | 'joy'         // Радость — мягкая улыбка, живые глаза, лёгкий румянец
  | 'curious'     // Любопытство (старое имя)
  | 'curiosity'   // Любопытство — внимательный взгляд, приподнятые брови, лёгкий наклон сферы
  | 'surprised'   // Удивление (старое имя)
  | 'surprise'    // Удивление — немного расширенные глаза, приподнятые брови, округлый рот
  | 'thinking'    // Задумчивость (старое имя)
  | 'thoughtful'  // Задумчивость — взгляд в сторону или вверх, приподнятая бровь, движение глаз
  | 'empathetic'  // Сочувствие (старое имя)
  | 'empathy'     // Сочувствие — спокойный взгляд, мягкие опущенные веки, заботливое выражение
  | 'sadness'     // Грусть — печальные глаза, мягко сведённые брови, опущенные уголки рта
  | 'bashful'     // Смущение (старое имя)
  | 'shy'         // Смущение — немного отведённый взгляд, деликатный румянец
  | 'sleepy'      // Сонливость — медленное моргание, закрывающиеся веки
  | 'sleeping'    // Сон — закрытые глаза, спокойное дыхание, частицы 'z'
  | 'waking'      // Пробуждение — потягивание сферы, открытие глаз
  | 'listening'   // Слушает Анну — сосредоточенный взгляд, рот спокойно закрыт
  | 'speaking'    // Говорит — синхронизация рта со звуком речи
  | 'interacting';// Реакция на поглаживание / клик

export type IdleMicroBehavior =
  | 'none'           // Обычное дыхание
  | 'look_around'    // Плавный осмотр по сторонам
  | 'look_up'        // Задумчивый взгляд вверх
  | 'slow_blink'     // Медленное ленивое моргание
  | 'chew'           // Притворяется, что жуёт что-то крошечное (микро-движение рта и щёк)
  | 'music_sway'     // Плавное покачивание, словно слушает тихую музыку
  | 'stretch_bounce' // Мягкое потягивание / пружинистое микро-движение
  | 'doze';          // Короткая лёгкая дрёма с опущенными веками

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
  showAutumnBeanie?: boolean;
  proactiveTipText?: string | null;
  onDismissTip?: () => void;
}
