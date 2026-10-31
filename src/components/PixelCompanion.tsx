import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BellOff,
  Brain,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Coffee,
  Edit3,
  ListTodo,
  Loader2,
  MessageCircleHeart,
  Mic,
  MicOff,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Sliders,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  CompanionCustomPosition,
  CompanionMemoryCategory,
  CompanionMemoryRecord,
  CompanionMessage,
  CompanionMoodState,
  CompanionPreferencesRecord,
  CompanionTaskPriority,
  CompanionTaskRecord,
  CompanionTaskStatus,
  NavSection,
  ProposedCompanionMemoryDraft,
  ProposedCompanionTaskDraft,
  SchoolId,
} from '../types/assistant';
import { SCHOOLS } from '../config/schoolsAndModes';
import {
  buildSelectivePixelContext,
  containsSensitiveCredentials,
  formatIsoDateRu,
  MEMORY_CATEGORY_META,
  parseMemoryProposalFromMessage,
  parseTaskProposalFromMessage,
  toIsoDateString,
} from '../utils/pixelAssistantEngine';
import {
  geminiProvider,
  GenerationStage,
  getGenerationStageLabelRu,
} from '../providers/geminiProvider';
import {
  formatMessageProviderAttribution,
  readStoredProviderSelection,
} from '../providers/aiProviderManager';
import { MarkdownMessageContent } from './MarkdownMessageContent';
import { browserSpeechInput } from '../providers/voice/browserSpeechInputProvider';
import { voiceManager } from '../providers/voice/voiceManager';
import {
  SpeechInputStatus,
  SpeechRecognitionResultEvent,
} from '../types/voice';
import { PixelVoiceSettingsModal } from './PixelVoiceSettingsModal';
import { PixelCharacter, pixelEmotionManager } from './pixel';

interface PixelCompanionProps {
  activeSchool: SchoolId;
  activeSection: NavSection;
  sidebarCollapsed?: boolean;
  rightPanelOpen: boolean;
  isBusyWithFileOrBackup?: boolean;
  companionMessages: CompanionMessage[];
  companionMemory: CompanionMemoryRecord[];
  companionTasks: CompanionTaskRecord[];
  companionPreferences: CompanionPreferencesRecord;
  onSaveCompanionMessages: (messages: CompanionMessage[]) => Promise<void>;
  onClearCompanionMessages: () => Promise<void>;
  onSaveCompanionMemory: (record: CompanionMemoryRecord) => Promise<void>;
  onDeleteCompanionMemory: (id: string) => Promise<void>;
  onClearAllCompanionMemory: () => Promise<void>;
  onSaveCompanionTask: (task: CompanionTaskRecord) => Promise<void>;
  onDeleteCompanionTask: (taskId: string) => Promise<void>;
  onSaveCompanionPreferences: (
    prefs: CompanionPreferencesRecord
  ) => Promise<void>;
  onOpenLiveVoice?: () => void;
  forceOpenChatTrigger?: number;
}

type CompanionPanelTab = 'chat' | 'tasks' | 'memory';
type TaskFilterMode = 'all' | 'today';

interface FloatingHeartItem {
  id: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  delayMs: number;
}

const PIXEL_POSITION_STORAGE_KEY = 'kiber_renderia_pixel_custom_position_v1';

const IDLE_SLEEP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes of inactivity triggers 60s nap
const AUTO_NAP_DURATION_MS = 60 * 1000; // 60 seconds nap duration
const BREAK_REMINDER_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes of active work
const AUTONOMOUS_MESSAGE_INTERVAL_MS = 40 * 60 * 1000; // Rare autonomous check-in (~40 min)
const TYPING_COOLDOWN_MS = 8 * 1000; // Never interrupt while typing
const DRAG_THRESHOLD_PX = 6; // Movement < 6px is a click (petting); >= 6px is drag-and-drop

const PETTING_REACTIONS: readonly string[] = [
  'Мур! Мне приятно, Анна.',
  'Ой, как приятно!',
  'Вы у меня замечательная!',
  'Мрр... Спасибо за заботу, Анна!',
  'Мне очень уютно работать рядом с вами!',
  'Тепло и радостно! Спасибо, Анна.',
];

const AUTONOMOUS_MESSAGES: readonly string[] = [
  'Анна, если нужно записать задачу или важную мысль — я рядом.',
  'Спокойного и продуктивного рабочего ритма, Анна!',
  'Если захотите сверить задачи на сегодня — загляните ко мне в диалог.',
];

const TASK_STATUS_LABELS: Record<CompanionTaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  done: 'Выполнена',
};

const TASK_PRIORITY_LABELS: Record<CompanionTaskPriority, string> = {
  low: 'Обычный',
  medium: 'Средний',
  high: 'Высокий',
};

function formatDateTimeShort(date: Date = new Date()): string {
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTimeOnly(date: Date = new Date()): string {
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function readStoredCustomPosition(): CompanionCustomPosition | null {
  try {
    const raw = window.localStorage.getItem(PIXEL_POSITION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      Number.isFinite(parsed.x) &&
      Number.isFinite(parsed.y)
    ) {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

function writeStoredCustomPosition(pos: CompanionCustomPosition | null): void {
  try {
    if (!pos) {
      window.localStorage.removeItem(PIXEL_POSITION_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        PIXEL_POSITION_STORAGE_KEY,
        JSON.stringify(pos)
      );
    }
  } catch {
    // ignore storage errors
  }
}

function getPetDimensionsPx(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 72, height: 72 };
  if (window.innerWidth < 640) return { width: 54, height: 54 };
  if (window.innerWidth < 1024) return { width: 64, height: 64 };
  return { width: 74, height: 74 };
}

function clampPositionToCentralWorkspace(
  pos: CompanionCustomPosition,
  sidebarCollapsed: boolean,
  rightPanelOpen: boolean
): CompanionCustomPosition {
  if (typeof window === 'undefined') return pos;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const { width: petW, height: petH } = getPetDimensionsPx();

  // Left boundary of the central workspace (respects Sidebar on lg+)
  const sidebarWidth = vw >= 1024 ? (sidebarCollapsed ? 68 : 288) : 0;
  // Right boundary of the central workspace (respects RightWorkspacePanel on xl+)
  const rightPanelWidth = vw >= 1280 && rightPanelOpen ? 340 : 0;
  // Top boundary (respects TopBar)
  const topBarHeight = 64;

  const minX = sidebarWidth + 12;
  const maxX = Math.max(minX, vw - rightPanelWidth - petW - 12);
  const minY = topBarHeight + 12;
  const maxY = Math.max(minY, vh - petH - 12);

  return {
    x: Math.round(Math.min(maxX, Math.max(minX, pos.x))),
    y: Math.round(Math.min(maxY, Math.max(minY, pos.y))),
  };
}

export const PixelCompanion: React.FC<PixelCompanionProps> = ({
  activeSchool,
  activeSection,
  sidebarCollapsed = false,
  rightPanelOpen,
  isBusyWithFileOrBackup = false,
  companionMessages,
  companionMemory,
  companionTasks,
  companionPreferences,
  onSaveCompanionMessages,
  onClearCompanionMessages,
  onSaveCompanionMemory,
  onDeleteCompanionMemory,
  onClearAllCompanionMemory,
  onSaveCompanionTask,
  onDeleteCompanionTask,
  onSaveCompanionPreferences,
  onOpenLiveVoice,
  forceOpenChatTrigger,
}) => {
  // Speech bubble state (separate from character)
  const [speechBubble, setSpeechBubble] = useState<{
    text: string;
    isBreakReminder?: boolean;
  } | null>(null);
  const [isBubbleHovered, setIsBubbleHovered] = useState(false);
  const [isBubbleFadingOut, setIsBubbleFadingOut] = useState(false);
  const bubbleAutoHideTimeoutRef = useRef<number | null>(null);

  const clearBubbleTimer = () => {
    if (bubbleAutoHideTimeoutRef.current) {
      window.clearTimeout(bubbleAutoHideTimeoutRef.current);
      bubbleAutoHideTimeoutRef.current = null;
    }
  };

  const scheduleBubbleAutoHide = (delayMs = 5000) => {
    clearBubbleTimer();
    setIsBubbleFadingOut(false);
    bubbleAutoHideTimeoutRef.current = window.setTimeout(() => {
      setIsBubbleFadingOut(true);
      window.setTimeout(() => {
        setSpeechBubble(null);
        setIsBubbleFadingOut(false);
      }, 300);
    }, delayMs);
  };

  useEffect(() => {
    if (speechBubble) {
      if (!isBubbleHovered) {
        scheduleBubbleAutoHide(5000);
      }
    } else {
      clearBubbleTimer();
      setIsBubbleFadingOut(false);
    }
    return () => {
      clearBubbleTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speechBubble]);

  const handleBubbleMouseEnter = () => {
    setIsBubbleHovered(true);
    setIsBubbleFadingOut(false);
    clearBubbleTimer();
  };

  const handleBubbleMouseLeave = () => {
    setIsBubbleHovered(false);
    if (speechBubble) {
      scheduleBubbleAutoHide(5000);
    }
  };

  // Personal assistant dialog window state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<CompanionPanelTab>('chat');

  useEffect(() => {
    if (forceOpenChatTrigger && forceOpenChatTrigger > 0) {
      setDialogOpen(true);
      setActiveTab('chat');
    }
  }, [forceOpenChatTrigger]);

  // Petting animation & floating hearts state (Part 4)
  const [isPetting, setIsPetting] = useState(false);
  const [petTriggerCount, setPetTriggerCount] = useState(0);
  const [characterSize, setCharacterSize] = useState<number>(() => {
    if (typeof window === 'undefined') return 74;
    if (window.innerWidth < 640) return 54;
    if (window.innerWidth < 1024) return 64;
    return 74;
  });

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 640) setCharacterSize(54);
      else if (window.innerWidth < 1024) setCharacterSize(64);
      else setCharacterSize(74);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [floatingHearts, setFloatingHearts] = useState<FloatingHeartItem[]>([]);
  const lastPetReactionIdxRef = useRef<number>(-1);
  const petReactionTimeoutRef = useRef<number | null>(null);
  const petBounceTimeoutRef = useRef<number | null>(null);

  // Automatic 60-second short sleep after 5 minutes of inactivity (Part 5)
  const [isAutoSleeping, setIsAutoSleeping] = useState(false);
  const isAutoSleepingRef = useRef(false);
  useEffect(() => {
    isAutoSleepingRef.current = isAutoSleeping;
  }, [isAutoSleeping]);

  const hasSleptThisIdleCycleRef = useRef<boolean>(false);
  const autoWakeTimeoutRef = useRef<number | null>(null);

  // Delicate cursor eye-tracking state (Part 8)
  const petContainerRef = useRef<HTMLDivElement | null>(null);
  const [pupilOffset, setPupilOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });

  // Drag-and-drop position state (Part 3)
  const [customPos, setCustomPos] = useState<CompanionCustomPosition | null>(
    () => {
      const fromLocal = readStoredCustomPosition();
      if (fromLocal) return fromLocal;
      return companionPreferences.customPosition || null;
    }
  );
  const [isDragging, setIsDragging] = useState(false);
  const [controlsVisibleByTap, setControlsVisibleByTap] = useState(false);

  const dragStartRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    hasMovedBeyondThreshold: boolean;
  } | null>(null);

  // Chat input & streaming state
  const [chatInput, setChatInput] = useState('');
  const [isPixelGenerating, setIsPixelGenerating] = useState(false);
  const [pixelGenerationStage, setPixelGenerationStage] =
    useState<GenerationStage | null>(null);
  const [pixelElapsedSec, setPixelElapsedSec] = useState(0);
  const [pixelSlowWarning, setPixelSlowWarning] = useState(false);
  const [lastFailedPixelText, setLastFailedPixelText] = useState<string | null>(
    null
  );
  const pixelAbortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isPixelGenerating) {
      setPixelElapsedSec(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setPixelElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isPixelGenerating]);

  // Tasks tab state
  const [taskFilter, setTaskFilter] = useState<TaskFilterMode>('all');
  const [showNewTaskForm, setShowNewTaskForm] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskDueDate, setNewTaskDueDate] = useState(() =>
    toIsoDateString(new Date())
  );
  const [newTaskPriority, setNewTaskPriority] =
    useState<CompanionTaskPriority>('medium');

  // Memory tab state
  const [selectedMemoryCat, setSelectedMemoryCat] = useState<
    CompanionMemoryCategory | 'all'
  >('all');
  const [showNewMemoryForm, setShowNewMemoryForm] = useState(false);
  const [newMemCat, setNewMemCat] =
    useState<CompanionMemoryCategory>('projects');
  const [newMemTitle, setNewMemTitle] = useState('');
  const [newMemContent, setNewMemContent] = useState('');
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editMemTitle, setEditMemTitle] = useState('');
  const [editMemContent, setEditMemContent] = useState('');
  const [confirmClearAllMemory, setConfirmClearAllMemory] = useState(false);

  // Voice (STT & TTS) state (Stage 5.3)
  const [isVoiceSettingsOpen, setIsVoiceSettingsOpen] = useState(false);
  const [speechInputStatus, setSpeechInputStatus] = useState<SpeechInputStatus>(
    () => browserSpeechInput.getStatus()
  );
  const [speechInputError, setSpeechInputError] = useState<string | null>(null);
  const [currentlySpeakingMsgId, setCurrentlySpeakingMsgId] = useState<
    string | null
  >(null);
  const [isSpeakingActive, setIsSpeakingActive] = useState(false);
  const [playbackState, setPlaybackState] = useState(() =>
    voiceManager.getPlaybackState()
  );

  // Store pre-speech text to avoid ever duplicating/accumulating interim recognition chunks
  const speechSessionBaseTextRef = useRef<string>('');

  const isMicSupported = useMemo(() => browserSpeechInput.isSupported(), []);
  const isRemoteSpeechService = useMemo(
    () => browserSpeechInput.isRemoteService(),
    []
  );

  // Subscribe to speech recognition and speech synthesis events
  useEffect(() => {
    const unsubStatus = browserSpeechInput.onStatusChange((status) => {
      setSpeechInputStatus(status);
      if (status !== 'error') {
        setSpeechInputError(null);
      }
      if (status === 'idle' || status === 'error') {
        speechSessionBaseTextRef.current = '';
      }
    });

    const unsubError = browserSpeechInput.onError((err) => {
      setSpeechInputError(err.message);
      speechSessionBaseTextRef.current = '';
    });

    const unsubResult = browserSpeechInput.onResult(
      (event: SpeechRecognitionResultEvent) => {
        const base = speechSessionBaseTextRef.current;
        const spoken = event.fullTranscript.trim();
        if (!spoken) return;

        // Auto-capitalize first word if inserting at beginning
        const formattedSpoken =
          !base && spoken.length > 0
            ? spoken.charAt(0).toUpperCase() + spoken.slice(1)
            : spoken;

        setChatInput(base ? `${base} ${formattedSpoken}` : formattedSpoken);
      }
    );

    const unsubPlayback = voiceManager.onPlaybackStateChange((st) => {
      setPlaybackState(st);
      setIsSpeakingActive(st.status === 'playing' || st.status === 'loading');
      setCurrentlySpeakingMsgId(st.messageId);
    });

    return () => {
      unsubStatus();
      unsubError();
      unsubResult();
      unsubPlayback();
    };
  }, []);

  const handleToggleVoiceRecord = async () => {
    if (speechInputStatus === 'listening' || speechInputStatus === 'recognizing') {
      browserSpeechInput.stop();
      speechSessionBaseTextRef.current = '';
      return;
    }
    setSpeechInputError(null);
    voiceManager.stopSpeaking();

    // Snapshot existing draft so speech replaces the live dictated portion cleanly
    speechSessionBaseTextRef.current = chatInput.trim();

    await browserSpeechInput.start({
      lang: 'ru-RU',
      continuous: true,
      interimResults: true,
    });
  };

  const handleToggleSpeakMessage = async (
    msgId: string,
    content: string,
    forceRefresh = false
  ) => {
    if (!forceRefresh && playbackState.messageId === msgId && playbackState.status === 'playing') {
      voiceManager.pauseMessage(msgId);
      return;
    }
    if (!forceRefresh && playbackState.messageId === msgId && playbackState.status === 'paused') {
      voiceManager.resumeMessage(msgId);
      return;
    }
    try {
      await voiceManager.playMessage(msgId, content, {
        forceRefresh,
        onFallbackUsed: (reason) => {
          setSpeechBubble({
            text: reason,
          });
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSpeechBubble({
        text: `Озвучивание: ${msg}`,
      });
    }
  };

  // Refs for accurate active time tracking & autonomous behavior
  const prefsRef = useRef<CompanionPreferencesRecord>(companionPreferences);
  useEffect(() => {
    prefsRef.current = companionPreferences;
  }, [companionPreferences]);

  // Sync customPosition if restored from backup or loaded from IndexedDB
  useEffect(() => {
    if (companionPreferences.customPosition !== undefined) {
      const incoming = companionPreferences.customPosition || null;
      if (incoming) {
        const clamped = clampPositionToCentralWorkspace(
          incoming,
          sidebarCollapsed,
          rightPanelOpen
        );
        setCustomPos(clamped);
        writeStoredCustomPosition(clamped);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companionPreferences.customPosition]);

  // Re-clamp custom position on window resize or when panels open/close
  useEffect(() => {
    const handleReclamp = () => {
      setCustomPos((prev) => {
        if (!prev) return null;
        const clamped = clampPositionToCentralWorkspace(
          prev,
          sidebarCollapsed,
          rightPanelOpen
        );
        if (clamped.x !== prev.x || clamped.y !== prev.y) {
          writeStoredCustomPosition(clamped);
          return clamped;
        }
        return prev;
      });
    };

    handleReclamp();
    window.addEventListener('resize', handleReclamp);
    return () => window.removeEventListener('resize', handleReclamp);
  }, [sidebarCollapsed, rightPanelOpen]);

  const lastUserActivityMsRef = useRef<number>(Date.now());
  const lastTypingMsRef = useRef<number>(0);
  const lastAutonomousIdxRef = useRef<number>(-1);

  const mood: CompanionMoodState = isAutoSleeping
    ? 'sleeping'
    : companionPreferences.mood || 'happy';
  const quietMode = Boolean(companionPreferences.quietMode);
  const breakRemindersEnabled =
    companionPreferences.breakRemindersEnabled !== false;

  const updatePreferences = (
    partial: Partial<CompanionPreferencesRecord>
  ) => {
    const next: CompanionPreferencesRecord = {
      ...prefsRef.current,
      ...partial,
      id: 'pixel_state',
    };
    prefsRef.current = next;
    onSaveCompanionPreferences(next);
  };

  // Delicate cursor eye tracking (Part 8)
  useEffect(() => {
    if (isAutoSleeping || isPetting) {
      setPupilOffset({ x: 0, y: 0 });
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!petContainerRef.current) return;
      const rect = petContainerRef.current.getBoundingClientRect();
      const eyeCenterX = rect.left + rect.width * 0.5;
      const eyeCenterY = rect.top + rect.height * 0.48;

      const dx = e.clientX - eyeCenterX;
      const dy = e.clientY - eyeCenterY;
      const dist = Math.hypot(dx, dy) || 1;

      // Very delicate pupil shift
      const maxX = 2.0;
      const maxY = 1.4;
      const factor = Math.min(1, dist / 260);

      const nx = (dx / dist) * maxX * factor;
      const ny = (dy / dist) * maxY * factor;

      setPupilOffset({
        x: Number(nx.toFixed(2)),
        y: Number(ny.toFixed(2)),
      });
    };

    const handleMouseLeave = () => {
      setPupilOffset({ x: 0, y: 0 });
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [isAutoSleeping, isPetting]);

  // Automatic 60-second short sleep after 5 minutes of inactivity + 60-min active work timer (Parts 5 & 9)
  useEffect(() => {
    const wakeUpIfSleeping = () => {
      if (isAutoSleepingRef.current) {
        isAutoSleepingRef.current = false;
        setIsAutoSleeping(false);
      }
      if (autoWakeTimeoutRef.current) {
        window.clearTimeout(autoWakeTimeoutRef.current);
        autoWakeTimeoutRef.current = null;
      }
    };

    const recordUserActivity = () => {
      lastUserActivityMsRef.current = Date.now();
      // User returned: reset idle sleep cycle flag and wake up immediately if napping
      hasSleptThisIdleCycleRef.current = false;
      wakeUpIfSleeping();
    };

    const recordTyping = () => {
      const now = Date.now();
      lastUserActivityMsRef.current = now;
      lastTypingMsRef.current = now;
      hasSleptThisIdleCycleRef.current = false;
      wakeUpIfSleeping();
    };

    window.addEventListener('mousemove', recordUserActivity, { passive: true });
    window.addEventListener('mousedown', recordUserActivity, { passive: true });
    window.addEventListener('scroll', recordUserActivity, { passive: true });
    window.addEventListener('touchstart', recordUserActivity, {
      passive: true,
    });
    window.addEventListener('keydown', recordTyping, { passive: true });

    // Check every 1 second for accurate 5-minute idle sleep & every 15 seconds for active work accumulation
    let workTickAccumulatorMs = 0;
    const CHECK_INTERVAL_MS = 1000;

    const intervalId = window.setInterval(() => {
      // Do not trigger sleep or accumulate work if tab is hidden
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }

      const now = Date.now();
      const idleDurationMs = now - lastUserActivityMsRef.current;

      // PART 5: Automatic 60-second nap after 5 minutes of inactivity
      // Only one nap per inactivity period; never during file parsing or open dialog
      if (
        idleDurationMs >= IDLE_SLEEP_THRESHOLD_MS &&
        !hasSleptThisIdleCycleRef.current &&
        !isAutoSleepingRef.current &&
        !dialogOpen &&
        !isBusyWithFileOrBackup
      ) {
        hasSleptThisIdleCycleRef.current = true;
        isAutoSleepingRef.current = true;
        setIsAutoSleeping(true);

        if (autoWakeTimeoutRef.current) {
          window.clearTimeout(autoWakeTimeoutRef.current);
        }
        autoWakeTimeoutRef.current = window.setTimeout(() => {
          isAutoSleepingRef.current = false;
          setIsAutoSleeping(false);
          autoWakeTimeoutRef.current = null;
        }, AUTO_NAP_DURATION_MS);
        return;
      }

      // Pause active work timer if idle > 5 minutes
      if (idleDurationMs >= IDLE_SLEEP_THRESHOLD_MS) {
        return;
      }

      workTickAccumulatorMs += CHECK_INTERVAL_MS;
      if (workTickAccumulatorMs < 15000) {
        return;
      }

      const elapsedDelta = workTickAccumulatorMs;
      workTickAccumulatorMs = 0;

      const currentPrefs = prefsRef.current;
      const nextActiveElapsed =
        (currentPrefs.activeWorkElapsedMs || 0) + elapsedDelta;
      const isTypingRightNow =
        now - lastTypingMsRef.current < TYPING_COOLDOWN_MS;
      const snoozeUntil = currentPrefs.breakSnoozeUntilMs || 0;

      // 1. Check if 60 minutes of active work reached for break reminder
      if (
        currentPrefs.breakRemindersEnabled &&
        nextActiveElapsed >= BREAK_REMINDER_THRESHOLD_MS &&
        now >= snoozeUntil &&
        !isTypingRightNow &&
        !isBusyWithFileOrBackup
      ) {
        setSpeechBubble({
          text: 'Анна, вы активно работаете уже 60 минут. Сделаем небольшую паузу для отдыха?',
          isBreakReminder: true,
        });
        updatePreferences({
          activeWorkElapsedMs: nextActiveElapsed,
          lastActiveInteractionMs: now,
          breakSnoozeUntilMs: now + 15 * 60 * 1000,
        });
        return;
      }

      // 2. Rare autonomous check-in (disabled in quietMode)
      const sinceLastAutonomous =
        now - (currentPrefs.lastAutonomousMessageMs || 0);
      if (
        !currentPrefs.quietMode &&
        !dialogOpen &&
        !isTypingRightNow &&
        !isBusyWithFileOrBackup &&
        sinceLastAutonomous >= AUTONOMOUS_MESSAGE_INTERVAL_MS
      ) {
        let nextIdx = Math.floor(Math.random() * AUTONOMOUS_MESSAGES.length);
        if (
          nextIdx === lastAutonomousIdxRef.current &&
          AUTONOMOUS_MESSAGES.length > 1
        ) {
          nextIdx = (nextIdx + 1) % AUTONOMOUS_MESSAGES.length;
        }
        lastAutonomousIdxRef.current = nextIdx;
        setSpeechBubble({
          text: AUTONOMOUS_MESSAGES[nextIdx],
        });
        updatePreferences({
          activeWorkElapsedMs: nextActiveElapsed,
          lastActiveInteractionMs: now,
          lastAutonomousMessageMs: now,
        });
        return;
      }

      updatePreferences({
        activeWorkElapsedMs: nextActiveElapsed,
        lastActiveInteractionMs: now,
      });
    }, CHECK_INTERVAL_MS);

    return () => {
      window.removeEventListener('mousemove', recordUserActivity);
      window.removeEventListener('mousedown', recordUserActivity);
      window.removeEventListener('scroll', recordUserActivity);
      window.removeEventListener('touchstart', recordUserActivity);
      window.removeEventListener('keydown', recordTyping);
      window.clearInterval(intervalId);
      if (autoWakeTimeoutRef.current) {
        window.clearTimeout(autoWakeTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen, isBusyWithFileOrBackup]);

  // Scroll Pixel dialog chat to bottom on new message
  useEffect(() => {
    if (dialogOpen && activeTab === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [companionMessages.length, dialogOpen, activeTab]);

  // Clean up timeouts on unmount
  useEffect(() => {
    return () => {
      if (petReactionTimeoutRef.current) {
        window.clearTimeout(petReactionTimeoutRef.current);
      }
      if (petBounceTimeoutRef.current) {
        window.clearTimeout(petBounceTimeoutRef.current);
      }
    };
  }, []);

  // ============================================================================
  // PETTING & FLOATING HEARTS (Part 4)
  // ============================================================================

  const triggerPettingReaction = () => {
    // Wake up immediately if sleeping
    if (isAutoSleepingRef.current) {
      isAutoSleepingRef.current = false;
      setIsAutoSleeping(false);
    }

    setIsPetting(true);
    setControlsVisibleByTap(true);
    setPetTriggerCount((c) => c + 1);
    pixelEmotionManager.triggerPetInteraction();

    if (petBounceTimeoutRef.current) {
      window.clearTimeout(petBounceTimeoutRef.current);
    }
    petBounceTimeoutRef.current = window.setTimeout(() => {
      setIsPetting(false);
    }, 850);

    // Spawn 3 floating hearts with varied offsets
    const nowId = Date.now();
    const newHearts: FloatingHeartItem[] = [
      { id: `${nowId}-1`, offsetX: -14, offsetY: -4, scale: 0.95, delayMs: 0 },
      { id: `${nowId}-2`, offsetX: 2, offsetY: -10, scale: 1.1, delayMs: 110 },
      { id: `${nowId}-3`, offsetX: 15, offsetY: -3, scale: 0.85, delayMs: 220 },
    ];
    setFloatingHearts(newHearts);
    window.setTimeout(() => {
      setFloatingHearts((prev) =>
        prev.filter((h) => !newHearts.some((nh) => nh.id === h.id))
      );
    }, 1250);

    // Pick a warm reaction phrase without repeating the same one consecutively
    let nextIdx = Math.floor(Math.random() * PETTING_REACTIONS.length);
    if (
      nextIdx === lastPetReactionIdxRef.current &&
      PETTING_REACTIONS.length > 1
    ) {
      nextIdx = (nextIdx + 1) % PETTING_REACTIONS.length;
    }
    lastPetReactionIdxRef.current = nextIdx;

    // Only update speech bubble if break reminder isn't currently awaiting action
    if (!speechBubble?.isBreakReminder) {
      setSpeechBubble({
        text: PETTING_REACTIONS[nextIdx],
      });

      if (petReactionTimeoutRef.current) {
        window.clearTimeout(petReactionTimeoutRef.current);
      }
      petReactionTimeoutRef.current = window.setTimeout(() => {
        setSpeechBubble((current) =>
          current && !current.isBreakReminder ? null : current
        );
      }, 4200);
    }
  };

  // ============================================================================
  // DRAG-AND-DROP VS. CLICK (PETTING) HANDLERS (Part 3)
  // ============================================================================

  const handleCharacterPointerDown = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    // Only primary button for mouse
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!petContainerRef.current) return;

    const rect = petContainerRef.current.getBoundingClientRect();
    dragStartRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: rect.left,
      originY: rect.top,
      hasMovedBeyondThreshold: false,
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore pointer capture errors
    }
  };

  const handleCharacterPointerMove = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    const dragState = dragStartRef.current;
    if (!dragState || dragState.pointerId !== e.pointerId) return;

    const dx = e.clientX - dragState.startClientX;
    const dy = e.clientY - dragState.startClientY;
    const dist = Math.hypot(dx, dy);

    if (!dragState.hasMovedBeyondThreshold) {
      if (dist < DRAG_THRESHOLD_PX) {
        return;
      }
      dragState.hasMovedBeyondThreshold = true;
      setIsDragging(true);
    }

    const nextCandidate: CompanionCustomPosition = {
      x: dragState.originX + dx,
      y: dragState.originY + dy,
    };
    const clamped = clampPositionToCentralWorkspace(
      nextCandidate,
      sidebarCollapsed,
      rightPanelOpen
    );
    setCustomPos(clamped);
  };

  const handleCharacterPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStartRef.current;
    if (!dragState || dragState.pointerId !== e.pointerId) return;

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }

    const wasDragged = dragState.hasMovedBeyondThreshold;
    dragStartRef.current = null;
    setIsDragging(false);

    if (wasDragged) {
      // Persist new dragged position; DO NOT trigger petting
      if (customPos) {
        writeStoredCustomPosition(customPos);
        updatePreferences({
          customPosition: customPos,
        });
      }
      return;
    }

    // Normal click/tap without dragging -> Pet Pixel!
    triggerPettingReaction();
  };

  const handleCharacterPointerCancel = () => {
    dragStartRef.current = null;
    setIsDragging(false);
  };

  const handleResetToCorner = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setCustomPos(null);
    writeStoredCustomPosition(null);
    updatePreferences({
      customPosition: null,
    });
  };

  // ============================================================================
  // BREAK REMINDER ACTIONS (Part 9)
  // ============================================================================

  const handleTakeBreakNow = () => {
    updatePreferences({
      activeWorkElapsedMs: 0,
      breakSnoozeUntilMs: null,
      mood: 'happy',
    });
    setSpeechBubble({
      text: 'Отличное решение, Анна! Приятного отдыха.',
    });
  };

  const handleSnoozeBreak = (minutes: number) => {
    const snoozeUntil = Date.now() + minutes * 60 * 1000;
    updatePreferences({
      breakSnoozeUntilMs: snoozeUntil,
      mood: 'working',
    });
    setSpeechBubble({
      text: `Хорошо, Анна! Напомню о перерыве через ${minutes} минут.`,
    });
  };

  const handleDisableBreakReminders = () => {
    updatePreferences({
      breakRemindersEnabled: false,
      breakSnoozeUntilMs: null,
    });
    setSpeechBubble({
      text: 'Напоминания о перерывах отключены. Их всегда можно включить в моём окне.',
    });
  };

  // ============================================================================
  // PERSONAL DIALOG, TASKS & MEMORY HANDLERS (Parts 6, 7, 8)
  // ============================================================================

  const handleStopPixelGeneration = () => {
    if (pixelAbortRef.current) {
      pixelAbortRef.current.abort();
      pixelAbortRef.current = null;
    }
  };

  const executePixelChatRequest = async (
    rawText: string,
    options?: { replaceMessageId?: string }
  ) => {
    const text = rawText.trim();
    if (!text || isPixelGenerating) return;

    setChatInput('');
    voiceManager.stopSpeaking();
    browserSpeechInput.stop();
    const now = new Date();
    const nowMs = now.getTime();

    const priorMessages = options?.replaceMessageId
      ? companionMessages.filter((m) => m.id !== options.replaceMessageId)
      : companionMessages;

    const existingLastUser =
      options?.replaceMessageId &&
      priorMessages.length > 0 &&
      priorMessages[priorMessages.length - 1].role === 'user' &&
      priorMessages[priorMessages.length - 1].content === text
        ? priorMessages[priorMessages.length - 1]
        : null;

    const userMsg: CompanionMessage =
      existingLastUser || {
        id: `comp-user-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'user',
        content: text,
        createdAt: formatTimeOnly(now),
        createdAtMs: nowMs,
      };

    const historyWithUser = existingLastUser
      ? priorMessages
      : [...priorMessages, userMsg];

    // 1. Privacy protection: never send passwords or secret keys to external Gemini API or memory
    if (containsSensitiveCredentials(text)) {
      const privacyReply: CompanionMessage = {
        id: `comp-pixel-${nowMs + 1}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'pixel',
        content:
          'Анна, я заметил в сообщении слова, похожие на пароль, ключ или секретный токен. Из соображений вашей безопасности я не отправляю такие данные во внешний Gemini API и никогда не сохраняю их в память.',
        createdAt: formatTimeOnly(new Date(nowMs + 1)),
        createdAtMs: nowMs + 1,
        usedContextLabels: ['Защита конфиденциальности'],
      };
      await onSaveCompanionMessages([...historyWithUser, privacyReply]);
      return;
    }

    // 2. Client-side detection of task & memory proposals (Gemini never modifies IndexedDB directly)
    const proposedTask =
      parseTaskProposalFromMessage(text, activeSchool) || undefined;
    const proposedMemory = !proposedTask
      ? parseMemoryProposalFromMessage(text, activeSchool) || undefined
      : undefined;

    const contextBundle = buildSelectivePixelContext(
      text,
      activeSchool,
      companionMemory,
      companionTasks
    );

    const pixelMsgId = `comp-pixel-${nowMs + 1}-${Math.random().toString(36).slice(2, 6)}`;
    const initialPixelReply: CompanionMessage = {
      id: pixelMsgId,
      role: 'pixel',
      content: '',
      createdAt: formatTimeOnly(new Date(nowMs + 1)),
      createdAtMs: nowMs + 1,
      usedContextLabels: contextBundle.contextSummaryLabels,
      proposedTask,
      proposedMemory,
      proposalStatus:
        proposedTask || proposedMemory ? ('pending' as const) : undefined,
      isStreaming: true,
    };

    const baseList = [...historyWithUser, initialPixelReply];
    await onSaveCompanionMessages(baseList);
    updatePreferences({ mood: 'thinking' });

    const abortController = new AbortController();
    pixelAbortRef.current = abortController;
    setIsPixelGenerating(true);
    setPixelGenerationStage('connecting');
    setPixelSlowWarning(false);

    try {
      const recentChatHistory = historyWithUser.slice(-12).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const result = await geminiProvider.streamChat({
        schoolId: activeSchool,
        mode: 'pixel',
        sessionId: 'pixel-personal-companion',
        messages: recentChatHistory,
        pixelContext: contextBundle,
        providerSelection: readStoredProviderSelection(),
        signal: abortController.signal,
        onStageChange: (stage) => {
          setPixelGenerationStage(stage);
        },
        onSlowWarning: (isSlow) => {
          setPixelSlowWarning(isSlow);
        },
        onDelta: (_delta, accumulated) => {
          const streamingList = baseList.map((m) =>
            m.id === pixelMsgId ? { ...m, content: accumulated } : m
          );
          onSaveCompanionMessages(streamingList);
        },
      });

      const finalText =
        result.text.trim() ||
        (result.aborted
          ? '[Генерация ответа Пикселя остановлена]'
          : 'Анна, я на связи!');

      if (result.aborted) {
        setLastFailedPixelText(text);
      } else {
        setLastFailedPixelText(null);
      }

      const durationMs = result.metrics?.durationMs || (Date.now() - nowMs);
      const selectedProvider = readStoredProviderSelection();

      const finalList = baseList.map((m) =>
        m.id === pixelMsgId
          ? {
              ...m,
              content:
                result.aborted && result.text.trim()
                  ? `${result.text.trim()}\n\n[Остановлено]`
                  : finalText,
              isStreaming: false,
              isError: false,
              modelName: result.model,
              providerId: result.providerId,
              providerLabel: result.providerLabel,
              failoverNotice: result.failoverNotice,
              durationMs,
              selectedProvider,
            }
          : m
      );
      await onSaveCompanionMessages(finalList);
      updatePreferences({
        mood: proposedTask || proposedMemory ? 'thinking' : 'happy',
      });

      if (
        voiceManager.getSettings().autoSpeakNewReplies &&
        !quietMode &&
        !result.aborted &&
        finalText.trim()
      ) {
        voiceManager.speakReply(finalText, pixelMsgId).catch(() => {});
      }
    } catch (err) {
      const errMessage =
        err instanceof Error
          ? err.message
          : 'Не удалось получить ответ от серверного маршрута ИИ-провайдера.';
      const fallbackNote = proposedTask
        ? `\n\nЧерновик задачи «${proposedTask.title}» подготовлен локально — вы можете подтвердить его сохранение ниже.`
        : proposedMemory
          ? `\n\nЧерновик заметки в память подготовлен локально — вы можете подтвердить его сохранение ниже.`
          : '';

      const durationMs = Date.now() - nowMs;
      const selectedProvider = readStoredProviderSelection();

      setLastFailedPixelText(text);
      setChatInput((prev) => (prev.trim().length === 0 ? text : prev));

      const errorList = baseList.map((m) =>
        m.id === pixelMsgId
          ? {
              ...m,
              content: `Не удалось получить ответ: ${errMessage}${fallbackNote}`,
              isStreaming: false,
              isError: true,
              errorReason: errMessage,
              durationMs,
              selectedProvider,
            }
          : m
      );
      await onSaveCompanionMessages(errorList);
      updatePreferences({ mood: 'curious' });
    } finally {
      pixelAbortRef.current = null;
      setIsPixelGenerating(false);
      setPixelGenerationStage(null);
      setPixelSlowWarning(false);
      setPixelElapsedSec(0);
    }
  };

  const handleSendCompanionMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    await executePixelChatRequest(chatInput);
  };

  const handleRetryPixelMessage = async (failedMsgId: string) => {
    if (isPixelGenerating) return;
    const idx = companionMessages.findIndex((m) => m.id === failedMsgId);
    let promptToRetry = lastFailedPixelText || '';
    if (idx > 0 && companionMessages[idx - 1].role === 'user') {
      promptToRetry = companionMessages[idx - 1].content;
    }
    if (!promptToRetry.trim()) return;
    await executePixelChatRequest(promptToRetry, {
      replaceMessageId: failedMsgId,
    });
  };

  const handleConfirmTaskProposal = async (
    messageId: string,
    draft: ProposedCompanionTaskDraft
  ) => {
    const now = new Date();
    const newTask: CompanionTaskRecord = {
      id: `task-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
      title: draft.title,
      description: draft.description,
      dueDate: draft.dueDate,
      priority: draft.priority,
      status: 'new',
      schoolId: draft.schoolId || activeSchool,
      createdAt: formatDateTimeShort(now),
      createdAtMs: now.getTime(),
    };

    await onSaveCompanionTask(newTask);

    const updatedMessages = companionMessages.map((m) =>
      m.id === messageId
        ? { ...m, proposalStatus: 'confirmed' as const }
        : m
    );
    await onSaveCompanionMessages(updatedMessages);
    updatePreferences({ mood: 'happy' });
  };

  const handleConfirmMemoryProposal = async (
    messageId: string,
    draft: ProposedCompanionMemoryDraft
  ) => {
    const now = new Date();
    const newRecord: CompanionMemoryRecord = {
      id: `mem-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
      category: draft.category,
      title: draft.title,
      content: draft.content,
      schoolId: draft.schoolId || activeSchool,
      confirmedByAnna: true,
      createdAt: formatDateTimeShort(now),
      updatedAt: formatDateTimeShort(now),
      updatedAtMs: now.getTime(),
    };

    await onSaveCompanionMemory(newRecord);

    const updatedMessages = companionMessages.map((m) =>
      m.id === messageId
        ? { ...m, proposalStatus: 'confirmed' as const }
        : m
    );
    await onSaveCompanionMessages(updatedMessages);
    updatePreferences({ mood: 'happy' });
  };

  const handleDismissProposal = async (messageId: string) => {
    const updatedMessages = companionMessages.map((m) =>
      m.id === messageId
        ? { ...m, proposalStatus: 'dismissed' as const }
        : m
    );
    await onSaveCompanionMessages(updatedMessages);
  };

  // Manual Task Creation
  const handleCreateManualTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTaskTitle.trim();
    if (!trimmed) return;

    const now = new Date();
    const task: CompanionTaskRecord = {
      id: `task-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
      title: trimmed,
      description: newTaskDesc.trim(),
      dueDate: newTaskDueDate,
      priority: newTaskPriority,
      status: 'new',
      schoolId: activeSchool,
      createdAt: formatDateTimeShort(now),
      createdAtMs: now.getTime(),
    };

    await onSaveCompanionTask(task);
    setNewTaskTitle('');
    setNewTaskDesc('');
    setShowNewTaskForm(false);
    updatePreferences({ mood: 'happy' });
  };

  const handleCycleTaskStatus = async (task: CompanionTaskRecord) => {
    const nextStatus: CompanionTaskStatus =
      task.status === 'new'
        ? 'in_progress'
        : task.status === 'in_progress'
          ? 'done'
          : 'new';
    const now = new Date();

    const updated: CompanionTaskRecord = {
      ...task,
      status: nextStatus,
      completedAt:
        nextStatus === 'done' ? formatDateTimeShort(now) : undefined,
      completedAtMs: nextStatus === 'done' ? now.getTime() : undefined,
    };
    await onSaveCompanionTask(updated);
  };

  const handleChangeTaskDueDate = async (
    task: CompanionTaskRecord,
    nextDueDate: string
  ) => {
    await onSaveCompanionTask({
      ...task,
      dueDate: nextDueDate,
    });
  };

  // Manual Memory Creation & Editing
  const handleCreateManualMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newMemTitle.trim();
    const content = newMemContent.trim();
    if (!title || !content) return;

    const now = new Date();
    const rec: CompanionMemoryRecord = {
      id: `mem-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
      category: newMemCat,
      title,
      content,
      schoolId: activeSchool,
      confirmedByAnna: true,
      createdAt: formatDateTimeShort(now),
      updatedAt: formatDateTimeShort(now),
      updatedAtMs: now.getTime(),
    };

    await onSaveCompanionMemory(rec);
    setNewMemTitle('');
    setNewMemContent('');
    setShowNewMemoryForm(false);
  };

  const handleCommitEditMemory = async (rec: CompanionMemoryRecord) => {
    const t = editMemTitle.trim();
    const c = editMemContent.trim();
    if (!t || !c) return;

    const now = new Date();
    await onSaveCompanionMemory({
      ...rec,
      title: t,
      content: c,
      updatedAt: formatDateTimeShort(now),
      updatedAtMs: now.getTime(),
    });
    setEditingMemoryId(null);
  };

  // Computed task counters & due reminders strictly isolated by active school
  const todayIso = toIsoDateString(new Date());
  const schoolTasks = useMemo(
    () =>
      companionTasks.filter(
        (t) =>
          !t.schoolId || t.schoolId === activeSchool || t.schoolId === 'both'
      ),
    [companionTasks, activeSchool]
  );
  const activeTasksList = useMemo(
    () => schoolTasks.filter((t) => t.status !== 'done'),
    [schoolTasks]
  );
  const dueOrOverdueTasks = useMemo(
    () =>
      activeTasksList.filter((t) => t.dueDate && t.dueDate <= todayIso),
    [activeTasksList, todayIso]
  );
  const filteredTasks = useMemo(() => {
    if (taskFilter === 'today') {
      return schoolTasks.filter((t) => t.dueDate === todayIso);
    }
    return schoolTasks;
  }, [schoolTasks, taskFilter, todayIso]);

  const schoolMemories = useMemo(
    () =>
      companionMemory.filter(
        (m) =>
          !m.schoolId || m.schoolId === activeSchool || m.schoolId === 'both'
      ),
    [companionMemory, activeSchool]
  );
  const filteredMemories = useMemo(() => {
    if (selectedMemoryCat === 'all') return schoolMemories;
    return schoolMemories.filter((m) => m.category === selectedMemoryCat);
  }, [schoolMemories, selectedMemoryCat]);

  const activeMinutesCount = Math.floor(
    (companionPreferences.activeWorkElapsedMs || 0) / 60000
  );

  const isChatSection =
    activeSection === 'marketer' ||
    activeSection === 'manager' ||
    activeSection === 'methodist' ||
    activeSection === 'analyst';

  // Default corner position when customPos is null:
  // Placed in bottom-right of central workspace area, never overlapping input or right panel
  const defaultVerticalClass = isChatSection
    ? 'bottom-28 xl:bottom-4'
    : 'bottom-4';
  const defaultHorizontalClass = rightPanelOpen
    ? 'right-3 xl:right-[354px]'
    : 'right-3 sm:right-5';

  // Fixed dialog anchor in bottom-right of central workspace so dialog is always comfortably on-screen
  const dialogPositionClass = rightPanelOpen
    ? 'bottom-24 xl:bottom-24 right-3 xl:right-[354px]'
    : 'bottom-24 right-3 sm:right-5';

  const school = SCHOOLS[activeSchool];

  const getBodyAnimationClass = (): string => {
    if (isPetting) return 'pixel-pet-bounce';
    if (isAutoSleeping) return 'pixel-sleep-body';
    return 'pixel-idle-body';
  };

  return (
    <>
      {/* ====================================================================
          1. PERSONAL ASSISTANT DIALOG WINDOW (Parts 6, 7, 8, 9, 11)
         ==================================================================== */}
      {dialogOpen && (
        <div
          className={`fixed z-40 w-[336px] sm:w-[396px] max-h-[75vh] rounded-3xl bg-white/98 border border-slate-200/90 shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 select-text ${dialogPositionClass}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Window Header */}
          <div className="px-4 py-3 bg-gradient-to-r from-amber-50/90 via-white to-lime-50/70 border-b border-slate-200/80 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <PixelCharacter
                size={34}
                showAura={false}
                interactive={false}
                isSpeaking={isSpeakingActive}
                isThinking={isPixelGenerating}
              />
              <span
                className={`px-2 py-0.5 rounded-md font-display font-extrabold text-[10px] tracking-wide shrink-0 ${
                  activeSchool === 'kiberone'
                    ? 'bg-[#FFD700] text-slate-950'
                    : 'bg-[#84CC16] text-slate-950'
                }`}
              >
                {school.name}
              </span>
              <div className="min-w-0">
                <div className="font-display font-extrabold text-sm text-slate-900 truncate">
                  Пиксель · Помощник Анны
                </div>
                <div className="text-[11px] text-slate-500 flex items-center gap-1.5 truncate">
                  <span>
                    {isAutoSleeping ? 'Дремлет' : 'На связи'}
                  </span>
                  <span>·</span>
                  <span title="Активное время работы в приложении (без учёта пауз и скрытых вкладок)">
                    Активно: {activeMinutesCount} мин.
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {isSpeakingActive && (
                <button
                  type="button"
                  onClick={() => voiceManager.stopSpeaking()}
                  title="Остановить текущее озвучивание"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-xl bg-amber-500 text-white text-[10px] font-bold hover:bg-amber-600 animate-pulse transition-colors"
                >
                  <Square className="w-2.5 h-2.5 fill-current" />
                  <span>Молчать</span>
                </button>
              )}
              {customPos && (
                <button
                  type="button"
                  onClick={handleResetToCorner}
                  title="Вернуть Пикселя в правый нижний угол"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-xl border border-slate-200 bg-white text-[10px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>В угол</span>
                </button>
              )}
              {onOpenLiveVoice && (
                <button
                  type="button"
                  onClick={() => {
                    voiceManager.stopSpeaking();
                    onOpenLiveVoice();
                  }}
                  title="Открыть живой голосовой диалог с Пикселем (Gemini Live API)"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-gradient-to-r from-[#00A8B5] to-[#165B73] hover:from-[#00929d] hover:to-[#124d62] text-white text-[10px] font-extrabold shadow-2xs transition-all"
                >
                  <Mic className="w-3 h-3 text-[#FFD700] animate-pulse" />
                  <span>Поговорить</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsVoiceSettingsOpen(true)}
                title="Настройки голоса и озвучивания (скорость, высота, авточтение)"
                aria-label="Настройки голоса"
                className="p-1.5 rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors"
              >
                <Sliders className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => updatePreferences({ quietMode: !quietMode })}
                title={
                  quietMode
                    ? 'Тихий режим включён (самостоятельные реплики скрыты). Нажмите, чтобы выключить'
                    : 'Включить тихий режим (без самостоятельных всплывающих реплик)'
                }
                className={`p-1.5 rounded-xl border text-xs transition-colors ${
                  quietMode
                    ? 'bg-slate-900 text-[#FFD700] border-slate-900'
                    : 'bg-white text-slate-500 border-slate-200 hover:text-slate-900'
                }`}
              >
                {quietMode ? (
                  <VolumeX className="w-3.5 h-3.5" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  voiceManager.stopSpeaking();
                  browserSpeechInput.cancel();
                  setDialogOpen(false);
                }}
                title="Закрыть окно Пикселя"
                aria-label="Закрыть окно Пикселя"
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 3 Navigation Tabs: Диалог | Задачи | Память */}
          <div className="grid grid-cols-3 gap-1 p-1.5 bg-slate-100/80 border-b border-slate-200/70 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={`flex items-center justify-center gap-1.5 py-1.5 rounded-xl transition-all ${
                activeTab === 'chat'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <MessageCircleHeart className="w-3.5 h-3.5 text-amber-500" />
              <span>Диалог</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('tasks')}
              className={`flex items-center justify-center gap-1.5 py-1.5 rounded-xl transition-all ${
                activeTab === 'tasks'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ListTodo className="w-3.5 h-3.5 text-[#00A8B5]" />
              <span>Задачи</span>
              {activeTasksList.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-slate-200/80 text-slate-800 text-[10px] font-mono-tabular">
                  {activeTasksList.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('memory')}
              className={`flex items-center justify-center gap-1.5 py-1.5 rounded-xl transition-all ${
                activeTab === 'memory'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Brain className="w-3.5 h-3.5 text-purple-600" />
              <span>Память</span>
              {companionMemory.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-slate-200/80 text-slate-800 text-[10px] font-mono-tabular">
                  {companionMemory.length}
                </span>
              )}
            </button>
          </div>

          {/* TAB 1: PERSONAL CHAT WITH PIXEL */}
          {activeTab === 'chat' && (
            <div className="flex-1 flex flex-col min-h-0 max-h-[52vh]">
              {/* Active Provider Diagnostics Bar */}
              <div className="px-3 py-1.5 bg-slate-50/90 border-b border-slate-200/70 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  <span className="truncate">
                    ИИ-режим: <strong className="text-slate-700">Авто</strong> (Gemini 2.5-flash → Резерв: OpenRouter Free)
                  </span>
                </div>
                <span className="font-mono-tabular shrink-0 text-slate-400 font-medium">
                  {school.name}
                </span>
              </div>

              {dueOrOverdueTasks.length > 0 && (
                <div className="px-3.5 py-2 bg-amber-50/90 border-b border-amber-200/80 flex items-center justify-between gap-2 text-[11px] text-amber-950">
                  <div className="flex items-center gap-1.5 truncate">
                    <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span className="truncate">
                      Задач со сроком на сегодня:{' '}
                      <strong>{dueOrOverdueTasks.length}</strong>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('tasks')}
                    className="font-semibold text-amber-900 underline shrink-0"
                  >
                    Открыть
                  </button>
                </div>
              )}

              {/* Messages Stream */}
              <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-[#F9FAFB]/70">
                {companionMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed overflow-hidden ${
                        msg.role === 'user'
                          ? 'bg-slate-900 text-white rounded-br-xs'
                          : msg.isError
                            ? 'bg-red-50/90 border border-red-200 text-red-950 rounded-bl-xs shadow-2xs'
                            : 'bg-white border border-slate-200/90 text-slate-800 rounded-bl-xs shadow-2xs'
                      }`}
                    >
                      {msg.role === 'pixel' && msg.failoverNotice && (
                        <div className="mb-2 px-2 py-1 rounded-lg bg-amber-50 border border-amber-200/80 text-[10px] text-amber-900">
                          {msg.failoverNotice}
                        </div>
                      )}

                      {msg.isStreaming ? (
                        <div className="space-y-2">
                          <div className="rounded-xl p-2 bg-slate-50 border border-slate-200/80 space-y-1.5">
                            <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-800">
                              <span className="inline-flex items-center gap-1.5">
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#00A8B5] shrink-0" />
                                <span>
                                  {getGenerationStageLabelRu(
                                    pixelGenerationStage
                                  )}
                                </span>
                              </span>
                              <span className="font-mono-tabular text-[10px] text-slate-500">
                                {pixelElapsedSec} с
                              </span>
                            </div>
                            {pixelSlowWarning && (
                              <div className="rounded-lg p-2 bg-amber-50 border border-amber-200 text-[10px] text-amber-950 space-y-1">
                                <div>
                                  Модель пока формирует ответ. Можно продолжить
                                  ожидание или остановить запрос
                                </div>
                                <button
                                  type="button"
                                  onClick={handleStopPixelGeneration}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-600 text-white font-semibold"
                                >
                                  <Square className="w-2.5 h-2.5 fill-current" />
                                  <span>Остановить</span>
                                </button>
                              </div>
                            )}
                          </div>
                          {msg.content && (
                            <div>
                              <MarkdownMessageContent
                                content={msg.content}
                                variant="compact"
                                isUserMessage={false}
                              />
                              <span className="inline-block w-1.5 h-3.5 ml-1 align-middle bg-[#00A8B5] animate-pulse rounded-xs" />
                            </div>
                          )}
                        </div>
                      ) : (
                        <MarkdownMessageContent
                          content={msg.content}
                          variant="compact"
                          isUserMessage={msg.role === 'user'}
                        />
                      )}

                      {msg.role === 'pixel' &&
                        !msg.isStreaming &&
                        (msg.isError ||
                          msg.content.includes('[Остановлено]') ||
                          msg.content.includes('остановлена')) && (
                          <div className="mt-2 pt-2 border-t border-slate-200/70 flex justify-end">
                            <button
                              type="button"
                              disabled={isPixelGenerating}
                              onClick={() => handleRetryPixelMessage(msg.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-900 text-white text-[11px] font-semibold hover:bg-slate-800 disabled:opacity-40 transition-colors"
                            >
                              <RotateCcw className="w-3 h-3 text-[#FFD700]" />
                              <span>Повторить отправку</span>
                            </button>
                          </div>
                        )}

                      {/* Proposed Task Confirmation Card */}
                      {msg.proposedTask && (
                        <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-2">
                          <div className="rounded-xl p-2.5 bg-amber-50/70 border border-amber-200/80 space-y-1">
                            <div className="text-[11px] font-bold text-slate-900 flex items-center gap-1.5">
                              <ListTodo className="w-3.5 h-3.5 text-[#00A8B5]" />
                              <span>Новая задача: {msg.proposedTask.title}</span>
                            </div>
                            <div className="text-[10px] text-slate-600 flex flex-wrap items-center gap-2">
                              <span>
                                Срок: {formatIsoDateRu(msg.proposedTask.dueDate)}
                              </span>
                              <span>·</span>
                              <span>
                                Приоритет:{' '}
                                {TASK_PRIORITY_LABELS[msg.proposedTask.priority]}
                              </span>
                            </div>
                          </div>

                          {msg.proposalStatus === 'confirmed' ? (
                            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Сохранено в список дел Анны</span>
                            </div>
                          ) : msg.proposalStatus === 'dismissed' ? (
                            <div className="text-[11px] text-slate-400">
                              Черновик задачи отменён
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  handleConfirmTaskProposal(
                                    msg.id,
                                    msg.proposedTask!
                                  )
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-900 text-white text-[11px] font-semibold hover:bg-slate-800"
                              >
                                <Check className="w-3 h-3 text-[#FFD700]" />
                                <span>Подтвердить и сохранить</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDismissProposal(msg.id)}
                                className="px-2.5 py-1.5 rounded-xl bg-slate-100 text-slate-600 text-[11px] font-medium hover:bg-slate-200"
                              >
                                Не нужно
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Proposed Memory Confirmation Card («Анна, запомнить это?») */}
                      {msg.proposedMemory && (
                        <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-2">
                          <div className="rounded-xl p-2.5 bg-purple-50/70 border border-purple-200/80 space-y-1">
                            <div className="text-[11px] font-bold text-slate-900 flex items-center gap-1.5">
                              <Brain className="w-3.5 h-3.5 text-purple-600" />
                              <span>Анна, запомнить это?</span>
                            </div>
                            <div className="text-[10px] font-semibold text-purple-900">
                              Раздел:{' '}
                              {
                                MEMORY_CATEGORY_META[msg.proposedMemory.category]
                                  .title
                              }
                            </div>
                            <div className="text-[11px] text-slate-700">
                              «{msg.proposedMemory.content}»
                            </div>
                          </div>

                          {msg.proposalStatus === 'confirmed' ? (
                            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Записано в память Пикселя</span>
                            </div>
                          ) : msg.proposalStatus === 'dismissed' ? (
                            <div className="text-[11px] text-slate-400">
                              Запись в память отклонена
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  handleConfirmMemoryProposal(
                                    msg.id,
                                    msg.proposedMemory!
                                  )
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-900 text-white text-[11px] font-semibold hover:bg-slate-800"
                              >
                                <Check className="w-3 h-3 text-[#FFD700]" />
                                <span>Да, запомнить</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDismissProposal(msg.id)}
                                className="px-2.5 py-1.5 rounded-xl bg-slate-100 text-slate-600 text-[11px] font-medium hover:bg-slate-200"
                              >
                                Не сохранять
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Transparent Context & Provider Attribution Indicator */}
                    <div className="mt-1 px-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                      <span>{msg.createdAt}</span>

                      {msg.role === 'pixel' && (
                        <>
                          {/* Duration badge */}
                          {typeof msg.durationMs === 'number' && msg.durationMs > 0 && (
                            <span className="font-mono-tabular px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-medium border border-slate-200/60">
                              ⏱️ {msg.durationMs < 1000 ? `${msg.durationMs} мс` : `${(msg.durationMs / 1000).toFixed(1)} с`}
                            </span>
                          )}

                          {/* Provider and Model badge */}
                          {(msg.providerId || msg.modelName) && (
                            <span
                              className={`inline-flex items-center gap-1 font-mono-tabular px-1.5 py-0.5 rounded font-medium border ${
                                msg.providerId === 'openrouter'
                                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200/70'
                                  : msg.providerId === 'ollama'
                                    ? 'bg-amber-50 text-amber-800 border-amber-200/70'
                                    : 'bg-emerald-50 text-emerald-700 border-emerald-200/70'
                              }`}
                            >
                              <span>
                                {msg.providerId === 'openrouter'
                                  ? 'OpenRouter Free'
                                  : msg.providerId === 'ollama'
                                    ? 'Ollama'
                                    : 'Gemini'}
                              </span>
                              {msg.modelName && (
                                <span className="opacity-75">· {msg.modelName}</span>
                              )}
                            </span>
                          )}

                          {/* Failover notice badge */}
                          {msg.failoverNotice && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-100/90 text-amber-900 border border-amber-300/80 font-medium">
                              🔄 Переключение
                            </span>
                          )}

                          {/* Voice playback controls for Pixel response (Part A: Listen, Pause, Resume, Stop) */}
                          {!msg.isStreaming && !msg.isError && msg.content.trim() && (
                            <div className="inline-flex items-center gap-1 flex-wrap">
                              {playbackState.messageId === msg.id && playbackState.status === 'loading' ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-900 border border-amber-200">
                                  <Loader2 className="w-2.5 h-2.5 animate-spin text-[#00A8B5]" />
                                  <span>
                                    {playbackState.provider === 'gemini'
                                      ? `Синтез Gemini (${playbackState.voiceName || 'Aoede'})...`
                                      : 'Запуск озвучки...'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => voiceManager.stopMessage(msg.id)}
                                    title="Отмена"
                                    className="p-0.5 text-slate-500 hover:text-slate-900"
                                  >
                                    <Square className="w-2 h-2 fill-current" />
                                  </button>
                                </span>
                              ) : playbackState.messageId === msg.id && playbackState.status === 'playing' ? (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => voiceManager.pauseMessage(msg.id)}
                                    title="Приостановить воспроизведение"
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-[#00A8B5] text-white hover:bg-[#00929d] transition-colors"
                                  >
                                    <Pause className="w-2.5 h-2.5 fill-current" />
                                    <span>Пауза</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => voiceManager.stopMessage(msg.id)}
                                    title="Остановить воспроизведение"
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-slate-200 hover:bg-slate-300 text-slate-800 transition-colors"
                                  >
                                    <Square className="w-2.5 h-2.5 fill-current" />
                                    <span>Остановить</span>
                                  </button>
                                  <span className="flex items-center gap-0.5 px-0.5 text-[#00A8B5]">
                                    <span className="w-0.5 h-2 bg-[#00A8B5] rounded-full animate-pulse" />
                                    <span className="w-0.5 h-3 bg-[#00A8B5] rounded-full animate-bounce" />
                                    <span className="w-0.5 h-1.5 bg-[#00A8B5] rounded-full animate-pulse" />
                                  </span>
                                </div>
                              ) : playbackState.messageId === msg.id && playbackState.status === 'paused' ? (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => voiceManager.resumeMessage(msg.id)}
                                    title="Продолжить воспроизведение"
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                                  >
                                    <Play className="w-2.5 h-2.5 fill-current" />
                                    <span>Продолжить</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => voiceManager.stopMessage(msg.id)}
                                    title="Остановить воспроизведение"
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-slate-200 hover:bg-slate-300 text-slate-800 transition-colors"
                                  >
                                    <Square className="w-2.5 h-2.5 fill-current" />
                                    <span>Остановить</span>
                                  </button>
                                </div>
                              ) : (
                                <div className="inline-flex items-center gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => handleToggleSpeakMessage(msg.id, msg.content)}
                                    title="Прослушать ответ Пикселя"
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 transition-colors"
                                  >
                                    <Volume2 className="w-2.5 h-2.5 text-[#00A8B5]" />
                                    <span>Прослушать</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleSpeakMessage(msg.id, msg.content, true)}
                                    title="Заново синтезировать речь без кэша с актуальным голосом и тембром"
                                    className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                                  >
                                    <RotateCcw className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              )}

                              {playbackState.messageId === msg.id &&
                                playbackState.provider === 'browser' && (
                                  <span className="text-[10px] text-amber-900 bg-amber-100/90 border border-amber-300/80 px-1 py-0.5 rounded font-medium">
                                    {playbackState.isFallback
                                      ? (playbackState.fallbackReason || 'Используется системный голос браузера')
                                      : 'Используется системный голос браузера'}
                                  </span>
                                )}

                              {playbackState.messageId === msg.id &&
                                playbackState.provider === 'gemini' &&
                                playbackState.status !== 'error' && (
                                  <span className="text-[10px] text-cyan-900 bg-cyan-50 border border-cyan-200 px-1.5 py-0.5 rounded font-medium">
                                    Голос: <b>{playbackState.voiceName || 'Aoede'}</b> · {playbackState.timbreName || 'Светлый'}
                                    {playbackState.fromCache ? ' (кэш)' : ''}
                                  </span>
                                )}
                            </div>
                          )}
                        </>
                      )}

                      {msg.role === 'pixel' &&
                        msg.usedContextLabels &&
                        msg.usedContextLabels.length > 0 && (
                          <span className="truncate">
                            · Контекст: {msg.usedContextLabels.join(', ')}
                          </span>
                        )}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Quick Suggestions + Input Form */}
              <div className="p-2.5 bg-white border-t border-slate-200/80 space-y-2">
                <div className="flex items-center justify-between gap-1 overflow-x-auto pb-0.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        setChatInput(
                          `Пиксель, напомни мне завтра проверить презентацию для ${school.name}`
                        )
                      }
                      className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[10px] font-medium text-slate-700 whitespace-nowrap"
                    >
                      + Напомнить завтра...
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setChatInput(
                          `Запомни: по школе ${school.name} приоритет на запись на пробные уроки`
                        )
                      }
                      className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[10px] font-medium text-slate-700 whitespace-nowrap"
                    >
                      + Запомнить факт...
                    </button>
                  </div>
                  {companionMessages.length > 1 && (
                    <button
                      type="button"
                      onClick={onClearCompanionMessages}
                      title="Очистить историю переписки с Пикселем"
                      className="p-1 text-slate-400 hover:text-red-600 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Active Speech Recognition Banner */}
                {(speechInputStatus === 'listening' || speechInputStatus === 'recognizing') && (
                  <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900">
                    <div className="flex items-center gap-2 truncate">
                      <span className="w-2 h-2 rounded-full bg-red-600 animate-ping shrink-0" />
                      <span className="font-semibold">
                        {speechInputStatus === 'listening' ? 'Слушаю вас... Говорите' : 'Распознавание...'}
                      </span>
                      {isRemoteSpeechService && (
                        <span
                          className="text-[10px] text-red-700 bg-red-100 px-1.5 py-0.5 rounded font-mono"
                          title="Распознавание выполняется через службу браузера"
                        >
                          Браузерная служба
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => browserSpeechInput.stop()}
                        className="px-2 py-0.5 rounded-lg bg-red-600 text-white text-[11px] font-bold hover:bg-red-700 transition-colors"
                      >
                        Готово
                      </button>
                      <button
                        type="button"
                        onClick={() => browserSpeechInput.cancel()}
                        className="px-1.5 py-0.5 rounded-lg text-red-700 hover:bg-red-100 text-[11px]"
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                )}

                {/* Speech Input Error Banner */}
                {speechInputError && (
                  <div className="flex items-start justify-between gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950">
                    <div className="flex items-start gap-1.5 leading-snug">
                      <MicOff className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                      <span>{speechInputError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSpeechInputError(null)}
                      className="p-0.5 hover:bg-amber-100 rounded text-amber-700 shrink-0"
                      title="Закрыть уведомление"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <form
                  onSubmit={handleSendCompanionMessage}
                  className="flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    value={chatInput}
                    disabled={isPixelGenerating}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder={
                      isPixelGenerating
                        ? `${getGenerationStageLabelRu(pixelGenerationStage)} (${pixelElapsedSec} с)`
                        : 'Напишите Пикселю задачу, вопрос или заметку...'
                    }
                    className="flex-1 min-w-0 rounded-xl border border-slate-300 bg-slate-50/70 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#00A8B5] disabled:opacity-60"
                  />
                  {/* Microphone STT Button */}
                  <button
                    type="button"
                    onClick={handleToggleVoiceRecord}
                    disabled={isPixelGenerating || !isMicSupported}
                    title={
                      !isMicSupported
                        ? 'Голосовой ввод не поддерживается данным браузером'
                        : speechInputStatus === 'listening' || speechInputStatus === 'recognizing'
                          ? 'Остановить запись голоса'
                          : 'Голосовой ввод (нажмите и говорите)'
                    }
                    className={`p-2 rounded-xl transition-colors shrink-0 ${
                      speechInputStatus === 'listening' || speechInputStatus === 'recognizing'
                        ? 'bg-red-600 text-white animate-pulse'
                        : !isMicSupported
                          ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                          : 'bg-slate-100 text-slate-700 hover:text-slate-900 hover:bg-slate-200'
                    }`}
                  >
                    {speechInputStatus === 'listening' || speechInputStatus === 'recognizing' ? (
                      <MicOff className="w-3.5 h-3.5" />
                    ) : (
                      <Mic className="w-3.5 h-3.5" />
                    )}
                  </button>
                  {isPixelGenerating ? (
                    <button
                      type="button"
                      onClick={handleStopPixelGeneration}
                      className="p-2 rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors shrink-0"
                      aria-label="Остановить ответ Пикселя"
                      title="Остановить генерацию ответа"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!chatInput.trim() || isPixelGenerating}
                      className="p-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 transition-colors shrink-0"
                      aria-label="Отправить сообщение Пикселю"
                    >
                      <Send className="w-3.5 h-3.5 text-[#FFD700]" />
                    </button>
                  )}
                </form>
              </div>
            </div>
          )}

          {/* TAB 2: ANNA'S TO-DO LIST */}
          {activeTab === 'tasks' && (
            <div className="flex-1 flex flex-col min-h-0 max-h-[52vh] p-3.5 space-y-3 overflow-y-auto bg-[#F9FAFB]/70">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-200/70 text-[11px] font-semibold">
                  <button
                    type="button"
                    onClick={() => setTaskFilter('all')}
                    className={`px-2.5 py-1 rounded-lg transition-all ${
                      taskFilter === 'all'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Все ({companionTasks.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTaskFilter('today')}
                    className={`px-2.5 py-1 rounded-lg transition-all ${
                      taskFilter === 'today'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    На сегодня (
                    {
                      companionTasks.filter((t) => t.dueDate === todayIso)
                        .length
                    }
                    )
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowNewTaskForm((v) => !v)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-900 text-white text-[11px] font-semibold hover:bg-slate-800"
                >
                  <Plus className="w-3.5 h-3.5 text-[#FFD700]" />
                  <span>Новая задача</span>
                </button>
              </div>

              {showNewTaskForm && (
                <form
                  onSubmit={handleCreateManualTask}
                  className="rounded-2xl p-3 bg-white border border-slate-200 shadow-xs space-y-2.5 text-xs"
                >
                  <div className="font-bold text-slate-900">
                    Добавить задачу для Анны
                  </div>
                  <input
                    type="text"
                    required
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder="Что нужно сделать?"
                    className="w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#00A8B5]"
                  />
                  <input
                    type="text"
                    value={newTaskDesc}
                    onChange={(e) => setNewTaskDesc(e.target.value)}
                    placeholder="Описание или детали (необязательно)"
                    className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#00A8B5]"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">
                        Срок выполнения
                      </label>
                      <input
                        type="date"
                        value={newTaskDueDate}
                        onChange={(e) => setNewTaskDueDate(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">
                        Приоритет
                      </label>
                      <select
                        value={newTaskPriority}
                        onChange={(e) =>
                          setNewTaskPriority(
                            e.target.value as CompanionTaskPriority
                          )
                        }
                        className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs bg-white"
                      >
                        <option value="low">Обычный</option>
                        <option value="medium">Средний</option>
                        <option value="high">Высокий</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowNewTaskForm(false)}
                      className="px-2.5 py-1 rounded-lg text-slate-600 hover:bg-slate-100"
                    >
                      Отмена
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1 rounded-lg bg-slate-900 text-white font-semibold"
                    >
                      Сохранить
                    </button>
                  </div>
                </form>
              )}

              {filteredTasks.length === 0 ? (
                <div className="rounded-2xl p-5 bg-white border border-dashed border-slate-200 text-center space-y-1.5">
                  <div className="text-xs font-bold text-slate-800">
                    {taskFilter === 'today'
                      ? 'На сегодня задач нет, Анна!'
                      : 'Список дел пока пуст'}
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Добавьте задачу кнопкой выше или напишите в диалоге:
                    «Пиксель, напомни мне завтра проверить презентацию для
                    RENDERIA».
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredTasks.map((task) => {
                    const isDone = task.status === 'done';
                    const isOverdue =
                      !isDone && task.dueDate && task.dueDate < todayIso;
                    const isToday = !isDone && task.dueDate === todayIso;

                    return (
                      <div
                        key={task.id}
                        className={`rounded-2xl p-3 bg-white border transition-all space-y-2 ${
                          isDone
                            ? 'border-slate-200/60 opacity-70'
                            : isOverdue
                              ? 'border-amber-300 bg-amber-50/30'
                              : 'border-slate-200/90 shadow-2xs'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 min-w-0">
                            <button
                              type="button"
                              onClick={() => handleCycleTaskStatus(task)}
                              title={`Статус: ${TASK_STATUS_LABELS[task.status]}. Нажмите для переключения`}
                              className={`mt-0.5 w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                                isDone
                                  ? 'bg-emerald-600 border-emerald-600 text-white'
                                  : task.status === 'in_progress'
                                    ? 'bg-amber-100 border-amber-400 text-amber-900'
                                    : 'border-slate-300 hover:border-slate-600'
                              }`}
                            >
                              {isDone && <Check className="w-3 h-3" />}
                              {task.status === 'in_progress' && (
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
                              )}
                            </button>
                            <div className="min-w-0">
                              <div
                                className={`text-xs font-semibold break-words ${
                                  isDone
                                    ? 'line-through text-slate-400'
                                    : 'text-slate-900'
                                }`}
                              >
                                {task.title}
                              </div>
                              {task.description && (
                                <div className="text-[11px] text-slate-500 mt-0.5 break-words">
                                  {task.description}
                                </div>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => onDeleteCompanionTask(task.id)}
                            title="Удалить задачу"
                            className="p-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-100 text-[10px]">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleCycleTaskStatus(task)}
                              className={`px-2 py-0.5 rounded-md font-semibold ${
                                isDone
                                  ? 'bg-emerald-50 text-emerald-800'
                                  : task.status === 'in_progress'
                                    ? 'bg-amber-100 text-amber-900'
                                    : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {TASK_STATUS_LABELS[task.status]}
                            </button>

                            <span
                              className={`px-1.5 py-0.5 rounded font-medium ${
                                task.priority === 'high'
                                  ? 'bg-rose-50 text-rose-700'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {TASK_PRIORITY_LABELS[task.priority]}
                            </span>

                            {(isToday || isOverdue) && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-semibold">
                                {isOverdue ? 'Срок прошёл' : 'Сегодня!'}
                              </span>
                            )}
                          </div>

                          <label className="inline-flex items-center gap-1 text-slate-500 cursor-pointer">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            <input
                              type="date"
                              value={task.dueDate || ''}
                              onChange={(e) =>
                                handleChangeTaskDueDate(task, e.target.value)
                              }
                              className="bg-transparent text-[10px] font-mono-tabular text-slate-700 focus:outline-none"
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: WHAT PIXEL REMEMBERS ABOUT ANNA */}
          {activeTab === 'memory' && (
            <div className="flex-1 flex flex-col min-h-0 max-h-[52vh] p-3.5 space-y-3 overflow-y-auto bg-[#F9FAFB]/70">
              <div className="rounded-xl p-2.5 bg-white border border-slate-200/80 flex items-start gap-2 text-[11px] text-slate-600">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-slate-900">
                    Что я помню об Анне:
                  </strong>{' '}
                  записи сохраняются локально в IndexedDB только с вашего
                  подтверждения. Пароли и ключи никогда не записываются.
                </div>
              </div>

              {/* Category Filter Pills + Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedMemoryCat('all')}
                    className={`px-2 py-1 rounded-lg text-[10px] font-semibold ${
                      selectedMemoryCat === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'bg-white border border-slate-200 text-slate-600'
                    }`}
                  >
                    Все ({companionMemory.length})
                  </button>
                  {(
                    [
                      'profile',
                      'projects',
                      'preferences',
                      'decisions',
                    ] as CompanionMemoryCategory[]
                  ).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedMemoryCat(cat)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-semibold ${
                        selectedMemoryCat === cat
                          ? 'bg-slate-900 text-white'
                          : 'bg-white border border-slate-200 text-slate-600'
                      }`}
                    >
                      {MEMORY_CATEGORY_META[cat].title.split(' ')[0]}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowNewMemoryForm((v) => !v)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-900 text-white text-[10px] font-semibold"
                  >
                    <Plus className="w-3 h-3 text-[#FFD700]" />
                    <span>Добавить</span>
                  </button>
                  {companionMemory.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setConfirmClearAllMemory(true)}
                      title="Полностью очистить память Пикселя"
                      className="p-1.5 rounded-xl bg-white border border-red-200 text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {confirmClearAllMemory && (
                <div className="rounded-xl p-3 bg-red-50 border border-red-200 space-y-2 text-xs text-red-950">
                  <div className="font-bold">
                    Очистить всю память Пикселя об Анне?
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmClearAllMemory(false)}
                      className="px-2.5 py-1 rounded-lg bg-white text-slate-700 border border-slate-200"
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await onClearAllCompanionMemory();
                        setConfirmClearAllMemory(false);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-red-600 text-white font-semibold"
                    >
                      Очистить всё
                    </button>
                  </div>
                </div>
              )}

              {showNewMemoryForm && (
                <form
                  onSubmit={handleCreateManualMemory}
                  className="rounded-2xl p-3 bg-white border border-slate-200 shadow-xs space-y-2 text-xs"
                >
                  <div className="font-bold text-slate-900">
                    Новая запись в память Пикселя
                  </div>
                  <select
                    value={newMemCat}
                    onChange={(e) =>
                      setNewMemCat(e.target.value as CompanionMemoryCategory)
                    }
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
                  >
                    <option value="profile">Профиль Анны</option>
                    <option value="projects">Проекты школ</option>
                    <option value="preferences">Предпочтения в работе</option>
                    <option value="decisions">История рабочих решений</option>
                  </select>
                  <input
                    type="text"
                    required
                    value={newMemTitle}
                    onChange={(e) => setNewMemTitle(e.target.value)}
                    placeholder="Краткий заголовок (например: Формат отчётов)"
                    className="w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs"
                  />
                  <textarea
                    rows={2}
                    required
                    value={newMemContent}
                    onChange={(e) => setNewMemContent(e.target.value)}
                    placeholder="Подробности, которые Пиксель должен помнить..."
                    className="w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowNewMemoryForm(false)}
                      className="px-2.5 py-1 rounded-lg text-slate-600 hover:bg-slate-100"
                    >
                      Отмена
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1 rounded-lg bg-slate-900 text-white font-semibold"
                    >
                      Сохранить
                    </button>
                  </div>
                </form>
              )}

              {filteredMemories.length === 0 ? (
                <div className="rounded-2xl p-5 bg-white border border-dashed border-slate-200 text-center space-y-1.5">
                  <div className="text-xs font-bold text-slate-800">
                    Записей пока нет
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Добавьте сведения о ваших предпочтениях, проектах KIBERONE и
                    RENDERIA или важных решениях — Пиксель сохранит их в
                    IndexedDB.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredMemories.map((mem) => {
                    const catMeta = MEMORY_CATEGORY_META[mem.category];
                    const isEditing = editingMemoryId === mem.id;

                    return (
                      <div
                        key={mem.id}
                        className="rounded-2xl p-3 bg-white border border-slate-200/90 shadow-2xs space-y-2 text-xs"
                      >
                        {isEditing ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={editMemTitle}
                              onChange={(e) => setEditMemTitle(e.target.value)}
                              className="w-full rounded-lg border border-[#00A8B5] px-2.5 py-1 text-xs font-semibold"
                            />
                            <textarea
                              rows={2}
                              value={editMemContent}
                              onChange={(e) =>
                                setEditMemContent(e.target.value)
                              }
                              className="w-full rounded-lg border border-[#00A8B5] px-2.5 py-1 text-xs"
                            />
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setEditingMemoryId(null)}
                                className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-[11px]"
                              >
                                Отмена
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCommitEditMemory(mem)}
                                className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-[11px] font-semibold"
                              >
                                Сохранить
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <div className="space-y-1 min-w-0">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold border ${catMeta.badgeClass}`}
                                >
                                  {catMeta.title}
                                </span>
                                <div className="font-bold text-slate-900 break-words">
                                  {mem.title}
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingMemoryId(mem.id);
                                    setEditMemTitle(mem.title);
                                    setEditMemContent(mem.content);
                                  }}
                                  title="Изменить запись"
                                  className="p-1 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onDeleteCompanionMemory(mem.id)
                                  }
                                  title="Удалить запись"
                                  className="p-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            <p className="text-slate-600 leading-relaxed break-words">
                              {mem.content}
                            </p>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Window Footer: Break Reminder Settings Toggle */}
          <div className="px-3.5 py-2 bg-slate-50 border-t border-slate-200/80 flex items-center justify-between text-[11px] text-slate-600">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={breakRemindersEnabled}
                onChange={(e) =>
                  updatePreferences({
                    breakRemindersEnabled: e.target.checked,
                  })
                }
                className="rounded border-slate-300 text-slate-900 focus:ring-0"
              />
              <span>Напоминать о перерыве каждые 60 мин. работы</span>
            </label>
          </div>
        </div>
      )}

      {/* ====================================================================
          2. COMPACT DRAGGABLE DIGITAL PET «ПИКСЕЛЬ» (Parts 1–6, 8)
          No rectangular background, no house, no yarn, no antenna!
         ==================================================================== */}
      <div
        ref={petContainerRef}
        style={
          customPos
            ? {
                left: `${customPos.x}px`,
                top: `${customPos.y}px`,
              }
            : undefined
        }
        className={`fixed z-30 flex flex-col items-end pointer-events-none select-none ${
          customPos
            ? ''
            : `transition-all duration-200 ${defaultVerticalClass} ${defaultHorizontalClass}`
        }`}
      >
        {/* Compact Speech Bubble (Separate from Character, positioned strictly above Pixel, with 5s auto-hide) */}
        {!dialogOpen && speechBubble && (
          <div
            role="status"
            aria-live="polite"
            onMouseEnter={handleBubbleMouseEnter}
            onMouseLeave={handleBubbleMouseLeave}
            className={`pointer-events-auto relative mb-2 max-w-[215px] sm:max-w-[240px] rounded-2xl bg-white/98 border border-slate-200/90 shadow-xl px-3.5 py-2.5 text-xs text-slate-800 transition-all duration-300 select-text ${
              isBubbleFadingOut
                ? 'opacity-0 scale-95 pointer-events-none'
                : 'opacity-100 scale-100 animate-in fade-in slide-in-from-bottom-1 duration-150'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] sm:text-xs text-slate-800 leading-snug font-medium">
                {speechBubble.text}
              </p>
              <button
                type="button"
                onClick={() => setSpeechBubble(null)}
                title="Закрыть"
                aria-label="Закрыть"
                className="p-0.5 rounded-md text-slate-400 hover:text-slate-700 shrink-0 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            {/* 60-Minute Active Work Break Actions */}
            {speechBubble.isBreakReminder && (
              <div className="mt-2 pt-2 border-t border-slate-100 grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={handleTakeBreakNow}
                  className="col-span-2 inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-xl bg-slate-900 text-white text-[10px] font-semibold hover:bg-slate-800"
                >
                  <Coffee className="w-3 h-3 text-[#FFD700]" />
                  <span>Отдохнуть сейчас</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSnoozeBreak(15)}
                  className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[10px] font-semibold text-slate-700"
                >
                  Через 15 мин
                </button>
                <button
                  type="button"
                  onClick={() => handleSnoozeBreak(30)}
                  className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[10px] font-semibold text-slate-700"
                >
                  Через 30 мин
                </button>
                <button
                  type="button"
                  onClick={handleDisableBreakReminders}
                  className="col-span-2 inline-flex items-center justify-center gap-1 py-0.5 text-[10px] text-slate-400 hover:text-slate-700"
                >
                  <BellOff className="w-2.5 h-2.5" />
                  <span>Отключить напоминания</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Pet Wrapper with Unobtrusive Hover Chat Icon & Optional Reset-to-Corner */}
        <div
          className="relative group pointer-events-auto flex items-center"
          onMouseLeave={() => setControlsVisibleByTap(false)}
        >
          {/* Unobtrusive Action Buttons (Appear on Hover / Focus / Selection) */}
          <div
            className={`absolute -top-2 -left-2 z-20 flex items-center gap-1 transition-opacity duration-150 ${
              dialogOpen || controlsVisibleByTap || dueOrOverdueTasks.length > 0
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
            }`}
          >
            {/* Open Personal Assistant Dialog Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSpeechBubble(null);
                setDialogOpen((v) => !v);
              }}
              title="Открыть личный диалог с Пикселем (Задачи и Память)"
              aria-label="Открыть личный диалог с Пикселем"
              className="relative w-7 h-7 rounded-full bg-slate-900 text-white shadow-md hover:bg-slate-800 flex items-center justify-center transition-transform hover:scale-105"
            >
              <MessageCircleHeart
                className={`w-3.5 h-3.5 ${
                  activeSchool === 'renderia'
                    ? 'text-[#84CC16]'
                    : 'text-[#FFD700]'
                }`}
              />
              {dueOrOverdueTasks.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-amber-400 text-slate-950 font-mono-tabular font-extrabold text-[9px] flex items-center justify-center border border-white">
                  {dueOrOverdueTasks.length}
                </span>
              )}
            </button>

            {/* Return to Corner Button (Only shown when Pixel was dragged from default corner) */}
            {customPos && (
              <button
                type="button"
                onClick={handleResetToCorner}
                title="Вернуть в угол"
                aria-label="Вернуть в угол"
                className="h-6 px-2 rounded-full bg-white/95 border border-slate-200/90 text-slate-700 hover:text-slate-950 hover:bg-white shadow-sm text-[10px] font-semibold inline-flex items-center gap-1 transition-transform hover:scale-105 whitespace-nowrap"
              >
                <RotateCcw className="w-2.5 h-2.5 text-slate-500" />
                <span>В угол</span>
              </button>
            )}
          </div>

          {/* Floating Hearts on Petting (2-4 hearts that rise & fade out) */}
          {floatingHearts.length > 0 && (
            <div
              className="pointer-events-none absolute inset-0 overflow-visible z-30"
              aria-hidden="true"
            >
              {floatingHearts.map((h) => (
                <svg
                  key={h.id}
                  viewBox="0 0 24 24"
                  style={{
                    left: `calc(50% + ${h.offsetX}px - 8px)`,
                    top: `${h.offsetY}px`,
                    animationDelay: `${h.delayMs}ms`,
                    transform: `scale(${h.scale})`,
                  }}
                  className="w-4 h-4 absolute pixel-heart-float fill-rose-500 drop-shadow-2xs"
                >
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
              ))}
            </div>
          )}

          {/* Interactive Draggable & Pettable Little Fantasy Creature */}
          <div
            onPointerDown={handleCharacterPointerDown}
            onPointerMove={handleCharacterPointerMove}
            onPointerUp={handleCharacterPointerUp}
            onPointerCancel={handleCharacterPointerCancel}
            style={{ touchAction: 'none' }}
            title="Нажмите, чтобы погладить Пикселя · Перетащите, чтобы переместить"
            className={`bg-transparent overflow-visible ${
              isDragging ? 'cursor-grabbing scale-105' : 'cursor-grab'
            } transition-transform duration-150`}
          >
            {/* 3D Glowing Sphere Character (Stage 7: Living Animated AI Companion) */}
            <div className="w-[54px] h-[54px] sm:w-[64px] sm:h-[64px] lg:w-[74px] lg:h-[74px] flex items-center justify-center">
              <PixelCharacter
                size={characterSize}
                petTrigger={petTriggerCount}
                isSpeaking={isSpeakingActive}
                isThinking={isPixelGenerating}
                interactive={false}
              />
            </div>
          </div>
        </div>
      </div>

      <PixelVoiceSettingsModal
        isOpen={isVoiceSettingsOpen}
        onClose={() => setIsVoiceSettingsOpen(false)}
      />
    </>
  );
};
