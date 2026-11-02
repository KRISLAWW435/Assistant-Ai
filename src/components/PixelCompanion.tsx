import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BellOff,
  Brain,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Coffee,
  Copy,
  Edit3,
  FolderOpen,
  ListTodo,
  Loader2,
  MessageCircleHeart,
  MessageSquare,
  Mic,
  MicOff,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Sliders,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  AgentMode,
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
  PixelDelegatedTaskState,
  PixelPendingRevisionDraft,
  ProposedCompanionMemoryDraft,
  ProposedCompanionTaskDraft,
  SchoolId,
} from '../types/assistant';
import { AGENT_MODES, SCHOOLS } from '../config/schoolsAndModes';
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
  CoordinatorSnapshot,
  pixelVoiceCoordinator,
} from '../providers/voice/pixelVoiceCoordinator';
import {
  SpeechInputStatus,
  SpeechRecognitionResultEvent,
} from '../types/voice';
import { PixelVoiceSettingsModal } from './PixelVoiceSettingsModal';
import { PixelCharacter, pixelEmotionManager } from './pixel';
import {
  PIXEL_DELEGATION_STATUS_LABELS,
  SPECIALIST_NAMES_DATIVE_RU,
  SPECIALIST_NAMES_GENITIVE_RU,
  SPECIALIST_NAMES_INSTRUMENTAL_RU,
  pixelAgentCoordinator,
} from '../providers/PixelAgentCoordinator';
import { annaMemoryManager } from '../providers/annaMemoryManager';

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

function cleanSpeechBubbleText(text: string): string {
  if (!text) return '';
  return text
    .replace(/^\[(?:Отправлено через Пикселя|GeminiProvider|Specialist)\]\s*/i, '')
    .replace(
      /\n*\[(?:Остановлено|Генерация остановлена|Генерация ответа Пикселя остановлена)\]\s*$/i,
      ''
    )
    .replace(/\s*\(ID:\s*[a-zA-Z0-9_-]+\)/gi, '')
    .replace(/```[\s\S]*?```/g, ' [таблица/код] ')
    .trim();
}

function isTechnicalOrErrorMessage(text: string): boolean {
  if (!text) return true;
  const lower = text.toLowerCase();
  return (
    lower.includes('quota exceeded') ||
    lower.includes('rate limit') ||
    lower.includes('websocket error') ||
    lower.includes('network error') ||
    lower.includes('429') ||
    lower.includes('500 internal') ||
    lower.includes('stack trace') ||
    lower.includes('api_key') ||
    lower.startsWith('error:') ||
    lower.startsWith('{')
  );
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
    isError?: boolean;
  } | null>(null);
  const [isBubbleHovered, setIsBubbleHovered] = useState(false);
  const [isBubbleFadingOut, setIsBubbleFadingOut] = useState(false);
  const [isBubbleDismissedByUser, setIsBubbleDismissedByUser] = useState(false);
  const [dismissedBubbleKey, setDismissedBubbleKey] = useState<string | null>(null);
  const [isBubbleTextExpanded, setIsBubbleTextExpanded] = useState(false);
  const [lastSavedBubble, setLastSavedBubble] = useState<{
    id: string;
    speaker: string;
    text: string;
    isSpeaking?: boolean;
    isListening?: boolean;
    isUser?: boolean;
    isBreakReminder?: boolean;
    isError?: boolean;
  } | null>(null);
  const lastResolvedKeyRef = useRef<string | null>(null);
  const bubbleAutoHideTimeoutRef = useRef<number | null>(null);

  const clearBubbleTimer = () => {
    if (bubbleAutoHideTimeoutRef.current) {
      window.clearTimeout(bubbleAutoHideTimeoutRef.current);
      bubbleAutoHideTimeoutRef.current = null;
    }
  };

  const scheduleBubbleAutoHide = (delayMs = 8000) => {
    clearBubbleTimer();
    setIsBubbleFadingOut(false);
    bubbleAutoHideTimeoutRef.current = window.setTimeout(() => {
      setIsBubbleFadingOut(true);
      window.setTimeout(() => {
        setIsBubbleDismissedByUser(true);
        if (lastResolvedKeyRef.current) {
          setDismissedBubbleKey(lastResolvedKeyRef.current);
        }
        setSpeechBubble(null);
        setIsBubbleFadingOut(false);
      }, 250);
    }, delayMs);
  };

  useEffect(() => {
    pixelAgentCoordinator.setBubbleHandler((text) => {
      setSpeechBubble({ text });
      setIsBubbleDismissedByUser(false);
      setDismissedBubbleKey(null);
      setIsBubbleTextExpanded(false);
    });
    return () => {
      pixelAgentCoordinator.setBubbleHandler(null);
    };
  }, []);

  const handleBubbleMouseEnter = () => {
    setIsBubbleHovered(true);
    setIsBubbleFadingOut(false);
    clearBubbleTimer();
  };

  const handleBubbleMouseLeave = () => {
    setIsBubbleHovered(false);
    if (!isBubbleDismissedByUser) {
      scheduleBubbleAutoHide(6000);
    }
  };

  const handleCloseSpeechBubble = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    clearBubbleTimer();
    setIsBubbleDismissedByUser(true);
    if (lastResolvedKeyRef.current) {
      setDismissedBubbleKey(lastResolvedKeyRef.current);
    }
    setSpeechBubble(null);
    setIsBubbleFadingOut(false);
  };

  const handleReopenLastBubble = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setIsBubbleDismissedByUser(false);
    setDismissedBubbleKey(null);
    setIsBubbleFadingOut(false);
    scheduleBubbleAutoHide(8000);
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

  // Clear legacy custom drag position from localStorage on mount
  useEffect(() => {
    try {
      window.localStorage.removeItem('kiber_renderia_pixel_custom_position_v1');
    } catch {
      // ignore
    }
  }, []);

  const [controlsVisibleByTap, setControlsVisibleByTap] = useState(false);
  const [isRecentHistoryExpanded, setIsRecentHistoryExpanded] = useState(false);

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef<boolean>(true);

  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceToBottom < 90;
  };

  useEffect(() => {
    if (isNearBottomRef.current && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [companionMessages, isPixelGenerating]);

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

  // Stage 8: Coordinator tasks sub-tab state & reactive updates
  const [tasksSubTab, setTasksSubTab] = useState<'anna' | 'coordinator'>('anna');
  const [coordinatorTasks, setCoordinatorTasks] = useState<PixelDelegatedTaskState[]>(() =>
    pixelAgentCoordinator.getTasks()
  );
  const [expandedTaskResultId, setExpandedTaskResultId] = useState<string | null>(null);
  const [expandedAnalysisTaskId, setExpandedAnalysisTaskId] = useState<string | null>(null);

  useEffect(() => {
    return pixelAgentCoordinator.onTasksChange((tasks) => {
      setCoordinatorTasks(tasks);
    });
  }, []);

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
  const [playbackState, setPlaybackState] = useState(() =>
    voiceManager.getPlaybackState()
  );
  const [stoppedReadingSession, setStoppedReadingSession] = useState(() =>
    voiceManager.getStoppedReadingSession()
  );
  const [coordinatorSnapshot, setCoordinatorSnapshot] =
    useState<CoordinatorSnapshot>(() => pixelVoiceCoordinator.getSnapshot());

  // Store pre-speech text to avoid ever duplicating/accumulating interim recognition chunks
  const speechSessionBaseTextRef = useRef<string>('');
  const lastSpeechResultIsFinalRef = useRef<boolean>(true);
  const latestStabilizedInputRef = useRef<string>('');

  const isMicSupported = useMemo(() => browserSpeechInput.isSupported(), []);
  const isRemoteSpeechService = useMemo(
    () => browserSpeechInput.isRemoteService(),
    []
  );

  // Subscribe to speech recognition, TTS and Gemini Live coordinator events
  useEffect(() => {
    const unsubStatus = browserSpeechInput.onStatusChange((status) => {
      setSpeechInputStatus(status);
      if (status !== 'error') {
        setSpeechInputError(null);
      }
      if (status === 'idle' || status === 'error') {
        speechSessionBaseTextRef.current = '';
        lastSpeechResultIsFinalRef.current = true;
      }
    });

    const unsubError = browserSpeechInput.onError((err) => {
      setSpeechInputError(err.message);
      speechSessionBaseTextRef.current = '';
      lastSpeechResultIsFinalRef.current = true;
    });

    const unsubResult = browserSpeechInput.onResult(
      (event: SpeechRecognitionResultEvent) => {
        const base = speechSessionBaseTextRef.current;
        const spoken = event.fullTranscript.trim();
        lastSpeechResultIsFinalRef.current = Boolean(event.isFinal);
        if (!spoken) return;

        // Auto-capitalize first word if inserting at beginning
        const formattedSpoken =
          !base && spoken.length > 0
            ? spoken.charAt(0).toUpperCase() + spoken.slice(1)
            : spoken;

        const combined = base ? `${base} ${formattedSpoken}` : formattedSpoken;
        latestStabilizedInputRef.current = combined;
        setChatInput(combined);
      }
    );

    const unsubPlayback = voiceManager.onPlaybackStateChange((st) => {
      setPlaybackState(st);
      setCurrentlySpeakingMsgId(st.messageId);
    });

    const unsubStoppedReading = voiceManager.onStoppedReadingChange((sess) => {
      setStoppedReadingSession(sess);
    });

    const unsubCoordinator = pixelVoiceCoordinator.onStateChange((snap) => {
      setCoordinatorSnapshot(snap);
    });

    return () => {
      unsubStatus();
      unsubError();
      unsubResult();
      unsubPlayback();
      unsubStoppedReading();
      unsubCoordinator();
    };
  }, []);

  // Unified voice states across TTS, STT, and Gemini Live
  const isSpeakingUnified =
    playbackState.status === 'playing' ||
    coordinatorSnapshot.liveState === 'speaking';

  const isListeningUnified =
    speechInputStatus === 'listening' ||
    speechInputStatus === 'recognizing' ||
    coordinatorSnapshot.liveState === 'listening';

  const isThinkingUnified =
    isPixelGenerating ||
    coordinatorSnapshot.liveState === 'thinking';

  // Synchronize emotion manager across whole application (both main screen and dialog)
  useEffect(() => {
    pixelEmotionManager.setVoiceState({
      isListening: isListeningUnified,
      isSpeaking: isSpeakingUnified,
    });
  }, [isListeningUnified, isSpeakingUnified]);

  useEffect(() => {
    pixelEmotionManager.setThinkingState(isThinkingUnified);
  }, [isThinkingUnified]);

  // Backward compatibility alias for any existing callbacks
  const isSpeakingActive = isSpeakingUnified;

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

  const [copiedCompanionMsgId, setCopiedCompanionMsgId] = useState<string | null>(
    null
  );
  const [isQuickChatSwitcherOpen, setIsQuickChatSwitcherOpen] = useState(false);

  const handleCopyCompanionMessage = async (msgId: string, content: string) => {
    const cleanText = content
      .replace(/^\[Отправлено через Пикселя\]\s*/i, '')
      .replace(
        /\n*\[(?:Остановлено|Генерация остановлена|Генерация ответа Пикселя остановлена)\]\s*$/i,
        ''
      )
      .replace(/\s*\(ID:\s*[a-zA-Z0-9_-]+\)/gi, '')
      .trim();
    if (!cleanText) return;
    try {
      await navigator.clipboard.writeText(cleanText);
      setCopiedCompanionMsgId(msgId);
      setTimeout(() => {
        setCopiedCompanionMsgId((prev) => (prev === msgId ? null : prev));
      }, 2000);
    } catch {
      // Clipboard API may be blocked in restricted contexts
    }
  };

  // Refs for accurate active time tracking & autonomous behavior
  const prefsRef = useRef<CompanionPreferencesRecord>(companionPreferences);
  useEffect(() => {
    prefsRef.current = companionPreferences;
  }, [companionPreferences]);

  // Resolve active conversational speech bubble turn for main screen
  const activeConversationBubble = useMemo(() => {
    // 1. If currently speaking (Gemini Live or TTS)
    if (isSpeakingUnified) {
      if (coordinatorSnapshot.liveState === 'speaking') {
        const lastModelTurn = [...coordinatorSnapshot.transcripts]
          .reverse()
          .find((t) => t.role === 'pixel' && t.text.trim());
        if (lastModelTurn) {
          const clean = cleanSpeechBubbleText(lastModelTurn.text);
          if (clean && !isTechnicalOrErrorMessage(clean)) {
            return {
              id: lastModelTurn.id || `live-${lastModelTurn.timestamp}`,
              speaker: 'Пиксель',
              text: clean,
              isSpeaking: true,
              isListening: false,
              isUser: false,
            };
          }
        }
      }
      const spokenTts = voiceManager.getCurrentSpokenText();
      if (spokenTts) {
        const clean = cleanSpeechBubbleText(spokenTts);
        if (clean && !isTechnicalOrErrorMessage(clean)) {
          return {
            id: `tts-${playbackState.messageId || 'current'}`,
            speaker: 'Пиксель',
            text: clean,
            isSpeaking: true,
            isListening: false,
            isUser: false,
          };
        }
      }
      if (playbackState.messageId) {
        const msg = companionMessages.find(
          (m) => m.id === playbackState.messageId
        );
        if (msg) {
          const clean = cleanSpeechBubbleText(msg.content);
          if (clean && !isTechnicalOrErrorMessage(clean)) {
            return {
              id: msg.id,
              speaker: 'Пиксель',
              text: clean,
              isSpeaking: true,
              isListening: false,
              isUser: false,
            };
          }
        }
      }
    }

    // 2. If user is actively speaking (Listening state)
    if (isListeningUnified) {
      if (chatInput.trim()) {
        return {
          id: 'user-dictating-active',
          speaker: 'Анна (слушаю...)',
          text: chatInput.trim(),
          isSpeaking: false,
          isListening: true,
          isUser: true,
        };
      }
      if (coordinatorSnapshot.liveState === 'listening') {
        const lastUserTurn = [...coordinatorSnapshot.transcripts]
          .reverse()
          .find((t) => t.role === 'user' && t.text.trim());
        if (lastUserTurn) {
          return {
            id: lastUserTurn.id || `user-live-${lastUserTurn.timestamp}`,
            speaker: 'Анна (слушаю...)',
            text: lastUserTurn.text.trim(),
            isSpeaking: false,
            isListening: true,
            isUser: true,
          };
        }
      }
      return {
        id: 'user-listening-idle',
        speaker: 'Анна',
        text: 'Слушаю вас, Анна...',
        isSpeaking: false,
        isListening: true,
        isUser: true,
      };
    }

    // 3. Autonomous reminder, break reminder, or petting reaction
    if (speechBubble) {
      return {
        id: `bubble-${speechBubble.text.slice(0, 16)}`,
        speaker: 'Пиксель',
        text: speechBubble.text,
        isBreakReminder: Boolean(speechBubble.isBreakReminder),
        isSpeaking: false,
        isListening: false,
        isUser: false,
      };
    }

    // 4. Most recent conversation turn between Anna and Pixel
    if (companionMessages.length > 0) {
      const lastMsg = companionMessages[companionMessages.length - 1];
      if (lastMsg) {
        const clean = cleanSpeechBubbleText(lastMsg.content);
        if (clean && !isTechnicalOrErrorMessage(clean)) {
          return {
            id: lastMsg.id,
            speaker: lastMsg.role === 'pixel' ? 'Пиксель' : 'Анна',
            text: clean,
            isSpeaking: false,
            isListening: false,
            isUser: lastMsg.role === 'user',
          };
        }
      }
    }

    return null;
  }, [
    isSpeakingUnified,
    isListeningUnified,
    coordinatorSnapshot.liveState,
    coordinatorSnapshot.transcripts,
    playbackState.messageId,
    companionMessages,
    chatInput,
    speechBubble,
  ]);

  const currentBubbleKey = activeConversationBubble
    ? `${activeConversationBubble.speaker}::${activeConversationBubble.text.trim()}`
    : null;

  // Track new message arrival to reset dismissal
  useEffect(() => {
    if (!currentBubbleKey || !activeConversationBubble) return;

    if (currentBubbleKey !== lastResolvedKeyRef.current) {
      lastResolvedKeyRef.current = currentBubbleKey;
      setIsBubbleDismissedByUser(false);
      setDismissedBubbleKey(null);
      setIsBubbleTextExpanded(false);
      setLastSavedBubble(activeConversationBubble);
    }
  }, [currentBubbleKey, activeConversationBubble]);

  const isCurrentBubbleDismissed =
    isBubbleDismissedByUser ||
    (currentBubbleKey !== null && currentBubbleKey === dismissedBubbleKey);

  const visibleBubbleTurn = isCurrentBubbleDismissed
    ? null
    : activeConversationBubble;

  // Auto-hide timer effect for visible bubble
  useEffect(() => {
    if (!visibleBubbleTurn) {
      clearBubbleTimer();
      setIsBubbleFadingOut(false);
      return;
    }

    if (
      visibleBubbleTurn.isBreakReminder ||
      visibleBubbleTurn.isSpeaking ||
      visibleBubbleTurn.isListening
    ) {
      clearBubbleTimer();
      setIsBubbleFadingOut(false);
      return;
    }

    if (!isBubbleHovered) {
      scheduleBubbleAutoHide(8000);
    } else {
      clearBubbleTimer();
      setIsBubbleFadingOut(false);
    }

    return () => {
      clearBubbleTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleBubbleTurn, isBubbleHovered]);

  // Last 3 non-technical conversational turns for compact history viewing
  const recentTurns = useMemo(() => {
    return companionMessages
      .filter((m) => {
        const clean = cleanSpeechBubbleText(m.content);
        return Boolean(clean) && !isTechnicalOrErrorMessage(clean);
      })
      .slice(-3);
  }, [companionMessages]);

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

  const handleConfirmPendingDelegation = async (
    draftId?: string,
    userCompanionMessage?: CompanionMessage
  ) => {
    if (isPixelGenerating) return;
    updatePreferences({ mood: 'thinking' });
    setIsPixelGenerating(true);
    setPixelGenerationStage('generating');
    setPixelSlowWarning(false);

    try {
      const taskResult = await pixelAgentCoordinator.confirmPendingDelegation({
        draftId,
        sourceMode: 'text',
        userCompanionMessage,
      });

      if (!taskResult) return;

      updatePreferences({
        mood: taskResult.status === 'completed' ? 'happy' : 'curious',
      });
    } finally {
      setIsPixelGenerating(false);
      setPixelGenerationStage(null);
      setPixelSlowWarning(false);
      setPixelElapsedSec(0);
    }
  };

  const handleConfirmPendingRevision = async (
    draftId?: string,
    userCompanionMessage?: CompanionMessage
  ) => {
    if (isPixelGenerating) return;
    updatePreferences({ mood: 'thinking' });
    setIsPixelGenerating(true);
    setPixelGenerationStage('generating');
    setPixelSlowWarning(false);

    try {
      const taskResult = await pixelAgentCoordinator.confirmPendingRevision(
        draftId,
        userCompanionMessage
      );

      if (!taskResult) return;

      updatePreferences({
        mood: taskResult.status === 'completed' ? 'happy' : 'curious',
      });
    } finally {
      setIsPixelGenerating(false);
      setPixelGenerationStage(null);
      setPixelSlowWarning(false);
      setPixelElapsedSec(0);
    }
  };

  const executePixelChatRequest = async (
    rawText: string,
    options?: { replaceMessageId?: string }
  ) => {
    // Stage 6.4 (3): If speech recognition was actively listening, stop and wait briefly for final text stabilization
    const wasListening =
      speechInputStatus === 'listening' || speechInputStatus === 'recognizing';
    if (wasListening) {
      browserSpeechInput.stop();
      await new Promise((r) => setTimeout(r, 180));
    }

    const stabilizedCandidate =
      wasListening && latestStabilizedInputRef.current.trim().length > rawText.trim().length
        ? latestStabilizedInputRef.current.trim()
        : rawText.trim();

    const text = stabilizedCandidate;
    if (!text || isPixelGenerating) return;

    setChatInput('');
    latestStabilizedInputRef.current = '';
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

    // 1.2 Stage 6.3 (2), 6.4 (1) & 6.5 (1, 4): Verbatim read aloud of last specialist response or resume stopped reading
    // Strictly does NOT create a copy of the specialist's message in Pixel's chat (`companionMessages`)
    const readAloudIntent = pixelAgentCoordinator.parseReadAloudIntent(
      text,
      activeSchool
    );
    if (readAloudIntent) {
      updatePreferences({ mood: 'happy' });
      await pixelAgentCoordinator.executeReadAloud(readAloudIntent, 'text');
      return;
    }

    // 1.25 Stage 6.5 (5): Check if Anna is confirming or cancelling a pending chat deletion
    const pendingDeletionAction =
      pixelAgentCoordinator.parsePendingChatDeletionAction(text);
    if (
      pendingDeletionAction.action !== 'none' &&
      pendingDeletionAction.deletion
    ) {
      if (pendingDeletionAction.action === 'confirm') {
        await pixelAgentCoordinator.confirmPendingChatDeletion(
          pendingDeletionAction.deletion.deletionId,
          existingLastUser ? undefined : userMsg
        );
        updatePreferences({ mood: 'happy' });
        return;
      }
      if (pendingDeletionAction.action === 'cancel') {
        await pixelAgentCoordinator.cancelPendingChatDeletion(
          pendingDeletionAction.deletion.deletionId,
          existingLastUser ? undefined : userMsg
        );
        updatePreferences({ mood: 'curious' });
        return;
      }
    }

    // 1.3 Stage 6.4 (2): Check if Anna is confirming («Да, отправляй»), cancelling, or adjusting a pending delegation draft
    const pendingDraftAction =
      pixelAgentCoordinator.parsePendingDraftAction(text);
    if (pendingDraftAction.action !== 'none' && pendingDraftAction.draft) {
      if (pendingDraftAction.action === 'confirm') {
        await handleConfirmPendingDelegation(
          pendingDraftAction.draft.draftId,
          existingLastUser ? undefined : userMsg
        );
        return;
      }
      if (pendingDraftAction.action === 'cancel') {
        await pixelAgentCoordinator.cancelPendingDelegation(
          pendingDraftAction.draft.draftId,
          existingLastUser ? undefined : userMsg
        );
        updatePreferences({ mood: 'curious' });
        return;
      }
      if (
        pendingDraftAction.action === 'adjust_school' &&
        pendingDraftAction.newSchool
      ) {
        await pixelAgentCoordinator.updatePendingDelegationDraft(
          pendingDraftAction.draft.draftId,
          { targetSchool: pendingDraftAction.newSchool },
          existingLastUser ? undefined : userMsg
        );
        updatePreferences({ mood: 'thinking' });
        return;
      }
      if (
        pendingDraftAction.action === 'adjust_specialist' &&
        pendingDraftAction.newMode
      ) {
        await pixelAgentCoordinator.updatePendingDelegationDraft(
          pendingDraftAction.draft.draftId,
          { targetMode: pendingDraftAction.newMode },
          existingLastUser ? undefined : userMsg
        );
        updatePreferences({ mood: 'thinking' });
        return;
      }
    }

    // 1.32 Stage 5 & 7: Check if Anna is confirming («Да, отправляй») or cancelling a pending revision draft
    const pendingRevisionAction =
      pixelAgentCoordinator.parsePendingRevisionAction(text);
    if (
      pendingRevisionAction.action !== 'none' &&
      pendingRevisionAction.draft
    ) {
      if (pendingRevisionAction.action === 'confirm') {
        await handleConfirmPendingRevision(
          pendingRevisionAction.draft.draftId,
          existingLastUser ? undefined : userMsg
        );
        return;
      }
      if (pendingRevisionAction.action === 'cancel') {
        await pixelAgentCoordinator.cancelPendingRevision(
          pendingRevisionAction.draft.draftId,
          existingLastUser ? undefined : userMsg
        );
        updatePreferences({ mood: 'curious' });
        return;
      }
    }

    // 1.33 Stage 3 & 4: Inquire result from specialist without leaving Pixel's dialog
    // («Что ответил Маркетолог?», «Какой результат у Методиста?»)
    const inquireResultIntent = pixelAgentCoordinator.parseInquireResultIntent(
      text,
      activeSchool
    );
    if (inquireResultIntent) {
      updatePreferences({ mood: 'happy' });
      await pixelAgentCoordinator.executeInquireResult(
        inquireResultIntent,
        'text',
        existingLastUser ? undefined : userMsg
      );
      return;
    }

    // 1.34 Stage 5: Request revision from specialist with confirmation card
    // («Попроси его доработать...», «Пусть Маркетолог добавит смету»)
    const revisionIntent = pixelAgentCoordinator.parseRevisionIntent(
      text,
      activeSchool
    );
    if (revisionIntent) {
      updatePreferences({ mood: 'thinking' });
      await pixelAgentCoordinator.prepareRevisionForConfirmation({
        intent: revisionIntent,
        sourceMode: 'text',
        userCompanionMessage: existingLastUser ? undefined : userMsg,
      });
      return;
    }

    // 1.35 Stage 6.5 (5): Manage working chat deletion («Пиксель, удали этот чат», «Покажи, какие чаты можно удалить»)
    const chatDeletionIntent = pixelAgentCoordinator.parseChatDeletionIntent(
      text,
      activeSchool
    );
    if (chatDeletionIntent) {
      updatePreferences({ mood: 'thinking' });
      await pixelAgentCoordinator.executeChatDeletionIntent(
        chatDeletionIntent,
        existingLastUser ? undefined : userMsg
      );
      return;
    }

    // 1.4 Stage 6.5 (1 & 2): Autonomous working chat switching & navigation («Вернись к нашему разговору с Методистом», «Открой чат Маркетолога Renderia»)
    const chatNavIntent = pixelAgentCoordinator.parseChatNavigationIntent(
      text,
      activeSchool
    );
    if (chatNavIntent) {
      updatePreferences({ mood: 'happy' });
      await pixelAgentCoordinator.executeChatNavigation(
        chatNavIntent,
        existingLastUser ? undefined : userMsg
      );
      return;
    }

    // 1.45 Stage 6.5 (6): Honest report when Anna asks for an unimplemented capability
    const unsupportedCap =
      pixelAgentCoordinator.parseUnsupportedCapabilityIntent(text);
    if (unsupportedCap) {
      updatePreferences({ mood: 'curious' });
      await pixelAgentCoordinator.replyUnsupportedCapability(
        unsupportedCap,
        existingLastUser ? undefined : userMsg
      );
      return;
    }

    // 1.5 Stage 6.2, 6.3, 6.4 (2) & 6.5 (1): Safe task delegation & follow-up continuation across all AI Specialists
    const clarifiedIntent = pixelAgentCoordinator.consumePendingClarification(
      text,
      activeSchool
    );
    const delegationIntent =
      clarifiedIntent ||
      pixelAgentCoordinator.parseDelegationIntent(text, activeSchool);

    if (delegationIntent) {
      if (delegationIntent.isAmbiguous) {
        await pixelAgentCoordinator.requestClarificationForAmbiguousIntent(
          delegationIntent,
          existingLastUser ? undefined : userMsg
        );
        updatePreferences({ mood: 'curious' });
        return;
      }

      // Stage 6.4 (2) & 6.5 (4): NEVER send to specialist without showing school, specialist, clean text, and waiting for «Да, отправляй»
      // Stage 6.5 (4): Do NOT auto-speak new replies; TTS starts only on explicit request
      updatePreferences({ mood: 'thinking' });
      await pixelAgentCoordinator.prepareDelegationForConfirmation({
        intent: delegationIntent,
        sourceMode: 'text',
        userCompanionMessage: existingLastUser ? undefined : userMsg,
      });
      return;
    }

    // 2. Client-side detection of task & memory proposals (Gemini never modifies IndexedDB directly)
    const proposedTask =
      parseTaskProposalFromMessage(text, activeSchool) || undefined;
    const proposedMemory = !proposedTask
      ? parseMemoryProposalFromMessage(text, activeSchool) || undefined
      : undefined;

    const activeChatContext = pixelAgentCoordinator.getActiveChatContext();
    const contextBundle = buildSelectivePixelContext(
      text,
      activeSchool,
      companionMemory,
      companionTasks,
      activeChatContext
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
      // Semantic emotion reaction based on conversation context
      pixelEmotionManager.analyzeDialogueContext(text, finalText);
      // Continuous long-term memory extraction for Anna in PixelData/Anna/
      void annaMemoryManager.extractMemoriesFromConversation(text, finalText);
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

  // Anchored to bottom-left of central workspace, smoothly adjusting with sidebar width
  const baseLeftClass = sidebarCollapsed
    ? 'left-4 sm:left-6 lg:left-[84px]'
    : 'left-4 sm:left-6 lg:left-[304px]';

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
      {dialogOpen && (() => {
        const activeChatCtx = pixelAgentCoordinator.getActiveChatContext();
        const allWorkingChats = pixelAgentCoordinator.getAllWorkingChats();
        const currentSchoolId = activeChatCtx?.schoolId || activeSchool;
        const currentMode = activeChatCtx?.mode || 'marketer';

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 md:p-6 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150"
            onClick={() => setDialogOpen(false)}
          >
            <div
              className="w-full max-w-[880px] h-[86vh] max-h-[820px] min-h-[560px] rounded-3xl bg-white border border-slate-200/90 shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150 select-text"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 1. UPPER PANEL: Header with School, Specialist, Chats, Voice & Window Controls */}
              <div className="bg-gradient-to-r from-pink-50/70 via-white to-sky-50/70 border-b border-slate-200/80 shrink-0">
                <div className="px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
                  {/* Left: Pixel identity */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="shrink-0 relative">
                      <PixelCharacter
                        size={36}
                        showAura={false}
                        interactive={false}
                        isSpeaking={isSpeakingUnified}
                        isListening={isListeningUnified}
                        isThinking={isThinkingUnified}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-display font-bold text-base text-slate-900">
                          Пиксель
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-md font-display font-bold text-[10px] tracking-wide shrink-0 ${
                            currentSchoolId === 'kiberone'
                              ? 'bg-amber-100 text-amber-900 border border-amber-200'
                              : 'bg-lime-100 text-lime-900 border border-lime-200'
                          }`}
                        >
                          {SCHOOLS[currentSchoolId].name}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-medium truncate">
                        Помощник управляющей Анны
                      </div>
                    </div>
                  </div>

                  {/* Center: School switch & Specialist switch */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* School Selector Pills */}
                    <div className="inline-flex items-center p-0.5 rounded-xl bg-slate-100/90 border border-slate-200/70">
                      {(['kiberone', 'renderia'] as SchoolId[]).map((sId) => {
                        const isCurrent = currentSchoolId === sId;
                        return (
                          <button
                            key={sId}
                            type="button"
                            onClick={() => {
                              void pixelAgentCoordinator.switchToWorkingChat({
                                schoolId: sId,
                                mode: currentMode,
                                announceInCompanion: true,
                              });
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                              isCurrent
                                ? sId === 'renderia'
                                  ? 'bg-[#84CC16] text-slate-950 shadow-2xs'
                                  : 'bg-[#FFD700] text-slate-950 shadow-2xs'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                            }`}
                          >
                            {SCHOOLS[sId].name}
                          </button>
                        );
                      })}
                    </div>

                    {/* Specialist Segmented Control */}
                    <div className="inline-flex items-center p-0.5 rounded-xl bg-slate-100/90 border border-slate-200/70 flex-wrap">
                      {(
                        ['marketer', 'manager', 'methodist', 'analyst'] as AgentMode[]
                      ).map((mId) => {
                        const isCurrent = currentMode === mId;
                        return (
                          <button
                            key={mId}
                            type="button"
                            onClick={() => {
                              void pixelAgentCoordinator.switchToWorkingChat({
                                schoolId: currentSchoolId,
                                mode: mId,
                                announceInCompanion: true,
                              });
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                              isCurrent
                                ? 'bg-slate-900 text-white shadow-2xs'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                            }`}
                          >
                            {AGENT_MODES[mId].shortTitle}
                          </button>
                        );
                      })}
                    </div>

                    {/* Working Chats Quick Switcher Popover Button */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setIsQuickChatSwitcherOpen((v) => !v)}
                        title="Рабочие чаты специалистов"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-[#00A8B5]" />
                        <span className="hidden sm:inline">Чаты ({allWorkingChats.length})</span>
                        <ChevronDown
                          className={`w-3 h-3 text-slate-400 transition-transform ${
                            isQuickChatSwitcherOpen ? 'rotate-180' : ''
                          }`}
                        />
                      </button>

                      {/* Working Chats Dropdown */}
                      {isQuickChatSwitcherOpen && (
                        <div className="absolute right-0 top-full mt-1.5 w-72 rounded-2xl bg-white border border-slate-200 shadow-xl p-2.5 z-30 space-y-1.5 text-xs">
                          <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 pb-1 border-b border-slate-100">
                            <span>Рабочие чаты специалистов</span>
                            <button
                              type="button"
                              onClick={() => setIsQuickChatSwitcherOpen(false)}
                              className="text-slate-400 hover:text-slate-700"
                            >
                              Закрыть
                            </button>
                          </div>
                          <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                            {allWorkingChats.length === 0 ? (
                              <div className="text-slate-400 py-2 text-center text-[11px]">
                                Пока нет открытых чатов
                              </div>
                            ) : (
                              allWorkingChats.map((chatItem) => (
                                <div
                                  key={chatItem.sessionId}
                                  className={`flex items-center justify-between gap-1.5 p-2 rounded-xl border text-[11px] ${
                                    chatItem.isCurrentlyOpen
                                      ? 'bg-cyan-50/80 border-cyan-300 text-slate-900'
                                      : 'bg-white border-slate-200/80 text-slate-700 hover:bg-slate-50'
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsQuickChatSwitcherOpen(false);
                                      void pixelAgentCoordinator.switchToWorkingChat({
                                        schoolId: chatItem.schoolId,
                                        mode: chatItem.mode,
                                        sessionId: chatItem.sessionId,
                                        announceInCompanion: true,
                                      });
                                    }}
                                    className="flex-1 text-left truncate cursor-pointer"
                                  >
                                    <span
                                      className={`inline-block px-1.5 py-0.2 rounded text-[9px] font-bold mr-1 ${
                                        chatItem.schoolId === 'renderia'
                                          ? 'bg-[#84CC16]/40 text-slate-900'
                                          : 'bg-[#FFD700]/50 text-slate-900'
                                      }`}
                                    >
                                      {chatItem.schoolName}
                                    </span>
                                    <strong className="font-semibold">
                                      {chatItem.specialistTitle}:
                                    </strong>{' '}
                                    <span>«{chatItem.sessionTitle}»</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsQuickChatSwitcherOpen(false);
                                      void pixelAgentCoordinator.prepareChatDeletionForConfirmation(
                                        chatItem.sessionId
                                      );
                                    }}
                                    title="Удалить чат"
                                    className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer shrink-0"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: Actions (Silence, Voice Settings, Minimize, Close) */}
                  <div className="flex items-center gap-1 shrink-0">
                    {isSpeakingUnified && (
                      <button
                        type="button"
                        onClick={() => voiceManager.stopSpeaking()}
                        title="Остановить текущее озвучивание"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-pink-500 text-white text-xs font-bold hover:bg-pink-600 animate-pulse transition-colors cursor-pointer shadow-xs"
                      >
                        <Square className="w-3 h-3 fill-current" />
                        <span>Молчать</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setIsVoiceSettingsOpen(true)}
                      title="Настройки голоса Пикселя"
                      aria-label="Настройки голоса"
                      className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      <Sliders className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setDialogOpen(false)}
                      title="Свернуть окно (разговор не прерывается)"
                      aria-label="Свернуть окно"
                      className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      <Minus className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setDialogOpen(false)}
                      title="Закрыть окно"
                      aria-label="Закрыть окно"
                      className="p-2 rounded-xl text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Navigation Tabs Bar */}
                <div className="flex items-center gap-1 px-4 sm:px-6 bg-slate-50/60 border-t border-slate-200/60">
                  <button
                    type="button"
                    onClick={() => setActiveTab('chat')}
                    className={`inline-flex items-center gap-2 py-2.5 px-4 border-b-2 text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                      activeTab === 'chat'
                        ? 'border-sky-500 text-slate-900 bg-white shadow-2xs rounded-t-xl'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <MessageCircleHeart className="w-4 h-4 text-amber-500" />
                    <span>Диалог</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('tasks')}
                    className={`inline-flex items-center gap-2 py-2.5 px-4 border-b-2 text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                      activeTab === 'tasks'
                        ? 'border-sky-500 text-slate-900 bg-white shadow-2xs rounded-t-xl'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <ListTodo className="w-4 h-4 text-[#00A8B5]" />
                    <span>Задачи</span>
                    {activeTasksList.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-slate-200/80 text-slate-800 text-[10px] font-mono-tabular font-bold">
                        {activeTasksList.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('memory')}
                    className={`inline-flex items-center gap-2 py-2.5 px-4 border-b-2 text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                      activeTab === 'memory'
                        ? 'border-sky-500 text-slate-900 bg-white shadow-2xs rounded-t-xl'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Brain className="w-4 h-4 text-purple-600" />
                    <span>Память</span>
                    {companionMemory.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-slate-200/80 text-slate-800 text-[10px] font-mono-tabular font-bold">
                        {companionMemory.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* TAB 1: PERSONAL CHAT WITH PIXEL */}
              {activeTab === 'chat' && (
                <div className="flex-1 flex flex-col min-h-0 bg-[#F9FAFB]/70">
                  {dueOrOverdueTasks.length > 0 && (
                    <div className="px-4 sm:px-6 py-2 bg-amber-50/90 border-b border-amber-200/80 flex items-center justify-between gap-2 text-xs text-amber-950 shrink-0">
                      <div className="flex items-center gap-1.5 truncate">
                        <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span className="truncate">
                          Задач со сроком на сегодня: <strong>{dueOrOverdueTasks.length}</strong>
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('tasks')}
                        className="font-semibold text-amber-900 underline shrink-0 cursor-pointer"
                      >
                        Открыть задачи
                      </button>
                    </div>
                  )}

                  {/* Messages Stream with Smart Scroll */}
                  <div
                    ref={messagesContainerRef}
                    onScroll={handleMessagesScroll}
                    className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4 bg-gradient-to-b from-slate-50/50 to-white"
                  >
                    {companionMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${
                          msg.role === 'user' ? 'items-end' : 'items-start'
                        }`}
                      >
                        <div
                          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed overflow-hidden shadow-2xs ${
                            msg.role === 'user'
                              ? 'bg-slate-900 text-white rounded-br-xs max-w-[85%] sm:max-w-[78%]'
                              : msg.isError
                                ? 'bg-red-50/90 border border-red-200 text-red-950 rounded-bl-xs max-w-[90%] sm:max-w-[85%]'
                                : 'bg-white border border-slate-200/90 text-slate-800 rounded-bl-xs max-w-[90%] sm:max-w-[85%]'
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

                      {/* Stage 6.4 (2): Mandatory Safe Delegation Confirmation Card («Да, отправляй») */}
                      {msg.pendingDelegationDraft && (
                        <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-2.5">
                          <div className="rounded-xl p-2.5 bg-cyan-50/70 border border-cyan-200/90 space-y-2 text-[11px]">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                                <ShieldCheck className="w-3.5 h-3.5 text-[#00A8B5] shrink-0" />
                                <span>Проверка поручения перед отправкой</span>
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                  msg.pendingDelegationDraft.status ===
                                  'confirmed'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : msg.pendingDelegationDraft.status ===
                                        'cancelled'
                                      ? 'bg-slate-200 text-slate-600'
                                      : 'bg-amber-100 text-amber-900'
                                }`}
                              >
                                {msg.pendingDelegationDraft.status ===
                                'confirmed'
                                  ? 'Отправлено'
                                  : msg.pendingDelegationDraft.status ===
                                      'cancelled'
                                    ? 'Отменено'
                                    : 'Ожидает подтверждения'}
                              </span>
                            </div>

                            {/* 1. School selector / indicator */}
                            <div className="flex items-center justify-between gap-2 flex-wrap pt-1 border-t border-cyan-200/50">
                              <span className="text-slate-600 font-medium">
                                1. Школа:
                              </span>
                              {msg.pendingDelegationDraft.status ===
                              'awaiting_confirmation' ? (
                                <div className="inline-flex items-center gap-1">
                                  {(['kiberone', 'renderia'] as SchoolId[]).map(
                                    (sId) => {
                                      const isSelected =
                                        msg.pendingDelegationDraft!
                                          .targetSchool === sId;
                                      return (
                                        <button
                                          key={sId}
                                          type="button"
                                          onClick={() => {
                                            if (!isSelected) {
                                              void pixelAgentCoordinator.updatePendingDelegationDraft(
                                                msg.pendingDelegationDraft!
                                                  .draftId,
                                                { targetSchool: sId }
                                              );
                                            }
                                          }}
                                          className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                                            isSelected
                                              ? sId === 'renderia'
                                                ? 'bg-[#84CC16] text-slate-950 shadow-2xs'
                                                : 'bg-[#FFD700] text-slate-950 shadow-2xs'
                                              : 'bg-white/80 text-slate-500 border border-slate-200 hover:text-slate-900'
                                          }`}
                                        >
                                          {SCHOOLS[sId].name}
                                        </button>
                                      );
                                    }
                                  )}
                                </div>
                              ) : (
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    msg.pendingDelegationDraft.targetSchool ===
                                    'renderia'
                                      ? 'bg-[#84CC16]/40 text-slate-900'
                                      : 'bg-[#FFD700]/50 text-slate-900'
                                  }`}
                                >
                                  {
                                    SCHOOLS[
                                      msg.pendingDelegationDraft.targetSchool
                                    ].name
                                  }
                                </span>
                              )}
                            </div>

                            {/* 2. Specialist selector / indicator */}
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-slate-600 font-medium">
                                2. Специалист:
                              </span>
                              {msg.pendingDelegationDraft.status ===
                              'awaiting_confirmation' ? (
                                <div className="flex items-center gap-1 flex-wrap justify-end">
                                  {(
                                    [
                                      'marketer',
                                      'manager',
                                      'methodist',
                                      'analyst',
                                    ] as AgentMode[]
                                  ).map((mId) => {
                                    const isSelected =
                                      msg.pendingDelegationDraft!.targetMode ===
                                      mId;
                                    return (
                                      <button
                                        key={mId}
                                        type="button"
                                        onClick={() => {
                                          if (!isSelected) {
                                            void pixelAgentCoordinator.updatePendingDelegationDraft(
                                              msg.pendingDelegationDraft!
                                                .draftId,
                                              { targetMode: mId }
                                            );
                                          }
                                        }}
                                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                                          isSelected
                                            ? 'bg-slate-900 text-white shadow-2xs'
                                            : 'bg-white/80 text-slate-500 border border-slate-200 hover:text-slate-900'
                                        }`}
                                      >
                                        {AGENT_MODES[mId].shortTitle}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <span className="font-bold text-slate-900">
                                  {
                                    AGENT_MODES[
                                      msg.pendingDelegationDraft.targetMode
                                    ].shortTitle
                                  }
                                </span>
                              )}
                            </div>

                            {/* 3. Clean business instruction text */}
                            <div className="pt-1.5 border-t border-cyan-200/50 space-y-1">
                              <div className="text-[10px] font-semibold text-slate-600">
                                3. Текст поручения (без системных меток):
                              </div>
                              <div className="p-2 rounded-lg bg-white border border-slate-200/80 text-slate-900 font-medium leading-relaxed">
                                «{msg.pendingDelegationDraft.cleanInstruction}»
                              </div>
                            </div>
                          </div>

                          {msg.pendingDelegationDraft.status === 'confirmed' ? (
                            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>
                                Подтверждено Анной («Да, отправляй») —
                                отправлено однократно
                              </span>
                            </div>
                          ) : msg.pendingDelegationDraft.status ===
                            'cancelled' ? (
                            <div className="text-[11px] text-slate-400">
                              Отправка поручения отменена
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={isPixelGenerating}
                                onClick={() =>
                                  void handleConfirmPendingDelegation(
                                    msg.pendingDelegationDraft!.draftId
                                  )
                                }
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-[11px] font-bold hover:bg-slate-800 disabled:opacity-40 transition-colors cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5 text-[#FFD700]" />
                                <span>Да, отправляй</span>
                              </button>
                              <button
                                type="button"
                                disabled={isPixelGenerating}
                                onClick={() =>
                                  void pixelAgentCoordinator.cancelPendingDelegation(
                                    msg.pendingDelegationDraft!.draftId
                                  )
                                }
                                className="px-2.5 py-1.5 rounded-xl bg-slate-100 text-slate-600 text-[11px] font-medium hover:bg-slate-200 disabled:opacity-40 transition-colors cursor-pointer"
                              >
                                Отменить
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Stage 5 & 7: Pending Specialist Revision Confirmation Card */}
                      {msg.pendingRevisionDraft && (
                        <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-2">
                          <div className="rounded-xl p-3 bg-amber-50/80 border border-amber-200/90 space-y-2 text-[11px]">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-amber-950 flex items-center gap-1.5">
                                <Edit3 className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                <span>Запрос на доработку специалисту</span>
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  msg.pendingRevisionDraft.status === 'confirmed'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : msg.pendingRevisionDraft.status ===
                                        'cancelled'
                                      ? 'bg-slate-200 text-slate-600'
                                      : 'bg-amber-100 text-amber-900'
                                }`}
                              >
                                {msg.pendingRevisionDraft.status === 'confirmed'
                                  ? 'Отправлено'
                                  : msg.pendingRevisionDraft.status ===
                                      'cancelled'
                                    ? 'Отменено'
                                    : 'Ждёт подтверждения'}
                              </span>
                            </div>
                            <div className="text-slate-700 space-y-1">
                              <div>
                                Специалист:{' '}
                                <strong className="text-slate-900">
                                  {
                                    AGENT_MODES[
                                      msg.pendingRevisionDraft.targetMode
                                    ].shortTitle
                                  }
                                </strong>{' '}
                                · Школа:{' '}
                                <strong className="text-slate-900">
                                  {
                                    SCHOOLS[msg.pendingRevisionDraft.schoolId]
                                      .name
                                  }
                                </strong>
                              </div>
                              <div className="p-2 rounded-lg bg-white border border-amber-200/70 text-slate-900 font-medium leading-relaxed">
                                «{msg.pendingRevisionDraft.cleanInstruction}»
                              </div>
                            </div>
                          </div>

                          {msg.pendingRevisionDraft.status ===
                          'awaiting_confirmation' ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={isPixelGenerating}
                                onClick={() =>
                                  void handleConfirmPendingRevision(
                                    msg.pendingRevisionDraft!.draftId
                                  )
                                }
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 text-white text-[11px] font-bold hover:bg-amber-700 disabled:opacity-40 transition-colors cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5 text-[#FFD700]" />
                                <span>Да, отправить на доработку</span>
                              </button>
                              <button
                                type="button"
                                disabled={isPixelGenerating}
                                onClick={() =>
                                  void pixelAgentCoordinator.cancelPendingRevision(
                                    msg.pendingRevisionDraft!.draftId
                                  )
                                }
                                className="px-2.5 py-1.5 rounded-xl bg-slate-100 text-slate-600 text-[11px] font-medium hover:bg-slate-200 disabled:opacity-40 transition-colors cursor-pointer"
                              >
                                Отменить
                              </button>
                            </div>
                          ) : msg.pendingRevisionDraft.status === 'confirmed' ? (
                            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Подтверждено Анной — задача передана в работу специалисту</span>
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-400">
                              Отправка доработки отменена
                            </div>
                          )}
                        </div>
                      )}

                      {/* Stage 6.2, 3, 4, 8: Delegated Specialist Task Coordinator Card */}
                      {msg.delegatedTask && (
                        <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border ${
                                  msg.delegatedTask.status === 'completed'
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                    : msg.delegatedTask.status === 'error'
                                      ? 'bg-rose-50 text-rose-800 border-rose-200'
                                      : msg.delegatedTask.status ===
                                          'needs_revision'
                                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                                        : 'bg-cyan-50 text-cyan-800 border-cyan-200'
                                }`}
                              >
                                {(msg.delegatedTask.status === 'created' ||
                                  msg.delegatedTask.status === 'in_progress' ||
                                  msg.delegatedTask.status === 'reviewing' ||
                                  msg.delegatedTask.status === 'processing' ||
                                  msg.delegatedTask.status ===
                                    'needs_revision') && (
                                  <Loader2 className="w-3 h-3 animate-spin text-[#00A8B5]" />
                                )}
                                {msg.delegatedTask.status === 'completed' && (
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                )}
                                <span>
                                  {PIXEL_DELEGATION_STATUS_LABELS[
                                    msg.delegatedTask.status
                                  ] || msg.delegatedTask.statusLabelRu}
                                </span>
                              </span>

                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  msg.delegatedTask.schoolId === 'renderia'
                                    ? 'bg-[#84CC16]/30 text-[#365314]'
                                    : 'bg-[#FFD700]/40 text-slate-900'
                                }`}
                              >
                                {SCHOOLS[msg.delegatedTask.schoolId].name}
                              </span>
                            </div>

                            <span className="font-mono-tabular text-[10px] text-slate-400">
                              ID: {msg.delegatedTask.taskId}
                            </span>
                          </div>

                          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2 text-[11px]">
                            <div className="font-bold text-slate-900 flex items-center justify-between gap-2">
                              <span>
                                Исполнитель: ИИ-
                                {
                                  AGENT_MODES[msg.delegatedTask.targetMode]
                                    .shortTitle
                                }
                              </span>
                              {msg.delegatedTask.iterationCount > 0 && (
                                <span className="text-[10px] font-medium text-slate-500">
                                  Итераций: {msg.delegatedTask.iterationCount}
                                </span>
                              )}
                            </div>

                            <div className="text-slate-600">
                              Запрос: «{msg.delegatedTask.instruction}»
                            </div>

                            {/* TL;DR Summary */}
                            {(msg.delegatedTask.analysis?.briefSummary ||
                              msg.delegatedTask.reviewSummary) && (
                              <div className="pt-1.5 border-t border-slate-200/60 text-slate-800">
                                <span className="font-bold text-slate-900">
                                  Краткая выжимка (TL;DR):{' '}
                                </span>
                                {msg.delegatedTask.analysis?.briefSummary ||
                                  msg.delegatedTask.reviewSummary}
                              </div>
                            )}

                            {/* Structured AI Analysis Accordion (Stage 4) */}
                            {msg.delegatedTask.analysis && (
                              <div className="pt-1.5 border-t border-slate-200/60 space-y-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedAnalysisTaskId((cur) =>
                                      cur === msg.delegatedTask!.taskId
                                        ? null
                                        : msg.delegatedTask!.taskId
                                    )
                                  }
                                  className="flex items-center justify-between w-full text-[10px] font-bold text-slate-700 hover:text-slate-900 cursor-pointer"
                                >
                                  <span className="flex items-center gap-1">
                                    <Sparkles className="w-3 h-3 text-[#00A8B5]" />
                                    <span>Анализ качества Пикселя (6 критериев)</span>
                                  </span>
                                  {expandedAnalysisTaskId ===
                                  msg.delegatedTask.taskId ? (
                                    <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                                  )}
                                </button>

                                {expandedAnalysisTaskId ===
                                  msg.delegatedTask.taskId && (
                                  <div className="mt-1.5 p-2 rounded-lg bg-white border border-slate-200/70 space-y-1.5 text-[10px] text-slate-700">
                                    <div className="flex items-center gap-2">
                                      <span>Вопрос проработан:</span>
                                      <strong className="text-slate-900">
                                        {msg.delegatedTask.analysis
                                          .allQuestionsAnswered !== false
                                          ? '✅ Да, полностью'
                                          : '⚠️ Требует дополнения'}
                                      </strong>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span>Специфика школы:</span>
                                      <strong className="text-slate-900">
                                        {msg.delegatedTask.analysis
                                          .schoolConsidered !== false
                                          ? `✅ Учтена (${SCHOOLS[msg.delegatedTask.schoolId].name})`
                                          : '⚠️ Общие слова'}
                                      </strong>
                                    </div>
                                    {msg.delegatedTask.analysis
                                      .actionableRecommendations &&
                                      msg.delegatedTask.analysis
                                        .actionableRecommendations.length >
                                        0 && (
                                        <div>
                                          <div className="font-semibold text-slate-800">
                                            Практические шаги:
                                          </div>
                                          <ul className="list-disc list-inside text-slate-600 pl-1 space-y-0.5">
                                            {msg.delegatedTask.analysis.actionableRecommendations.map(
                                              (rec, i) => (
                                                <li key={i}>{rec}</li>
                                              )
                                            )}
                                          </ul>
                                        </div>
                                      )}
                                    {msg.delegatedTask.analysis
                                      .critiqueRemarks &&
                                      msg.delegatedTask.analysis.critiqueRemarks
                                        .length > 0 && (
                                        <div>
                                          <div className="font-semibold text-slate-800">
                                            Замечания:
                                          </div>
                                          <ul className="list-disc list-inside text-slate-600 pl-1 space-y-0.5">
                                            {msg.delegatedTask.analysis.critiqueRemarks.map(
                                              (rem, i) => (
                                                <li key={i}>{rem}</li>
                                              )
                                            )}
                                          </ul>
                                        </div>
                                      )}
                                    {msg.delegatedTask.analysis
                                      .proposedNextSteps &&
                                      msg.delegatedTask.analysis
                                        .proposedNextSteps.length > 0 && (
                                        <div>
                                          <div className="font-semibold text-slate-800">
                                            Следующие шаги:
                                          </div>
                                          <ul className="list-disc list-inside text-slate-600 pl-1 space-y-0.5">
                                            {msg.delegatedTask.analysis.proposedNextSteps.map(
                                              (step, i) => (
                                                <li key={i}>{step}</li>
                                              )
                                            )}
                                          </ul>
                                        </div>
                                      )}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Expandable Full Response Text (Stage 8) */}
                            {msg.delegatedTask.resultText && (
                              <div className="pt-1.5 border-t border-slate-200/60">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedTaskResultId((cur) =>
                                      cur === msg.delegatedTask!.taskId
                                        ? null
                                        : msg.delegatedTask!.taskId
                                    )
                                  }
                                  className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-700 hover:text-slate-900 cursor-pointer"
                                >
                                  <span>
                                    {expandedTaskResultId ===
                                    msg.delegatedTask.taskId
                                      ? 'Скрыть полный текст ответа специалиста'
                                      : 'Показать полный текст ответа специалиста'}
                                  </span>
                                  {expandedTaskResultId ===
                                  msg.delegatedTask.taskId ? (
                                    <ChevronUp className="w-3 h-3 text-slate-400" />
                                  ) : (
                                    <ChevronDown className="w-3 h-3 text-slate-400" />
                                  )}
                                </button>

                                {expandedTaskResultId ===
                                  msg.delegatedTask.taskId && (
                                  <div className="mt-2 p-3 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 max-h-64 overflow-y-auto space-y-2 whitespace-pre-wrap leading-relaxed">
                                    <div className="flex items-center justify-between gap-2 pb-1 border-b border-slate-100 text-[10px] text-slate-400 font-semibold">
                                      <span>
                                        Ответ{' '}
                                        {
                                          AGENT_MODES[
                                            msg.delegatedTask.targetMode
                                          ].shortTitle
                                        }
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void navigator.clipboard.writeText(
                                            msg.delegatedTask!.resultText || ''
                                          );
                                        }}
                                        className="hover:text-slate-700 cursor-pointer flex items-center gap-1"
                                      >
                                        <Copy className="w-3 h-3" />
                                        <span>Копировать</span>
                                      </button>
                                    </div>
                                    <MarkdownMessageContent
                                      content={msg.delegatedTask.resultText}
                                      role="assistant"
                                    />
                                  </div>
                                )}
                              </div>
                            )}

                            {msg.delegatedTask.errorMessage && (
                              <div className="pt-1 border-t border-rose-200/60 text-rose-700 font-medium">
                                Ошибка: {msg.delegatedTask.errorMessage}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {/* Read Aloud Button (Stage 6) */}
                            {msg.delegatedTask.resultText && (
                              <button
                                type="button"
                                onClick={() => {
                                  void pixelAgentCoordinator.readTaskResult(
                                    msg.delegatedTask!.taskId
                                  );
                                }}
                                title="Озвучить полный ответ специалиста голосом Пикселя без открытия других окон"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#00A8B5]/15 text-[#007A85] text-[11px] font-bold hover:bg-[#00A8B5]/25 transition-colors cursor-pointer"
                              >
                                <Volume2 className="w-3.5 h-3.5" />
                                <span>Озвучить ответ</span>
                              </button>
                            )}

                            {/* Request Revision Button (Stage 5) */}
                            {msg.delegatedTask.status === 'completed' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setChatInput(
                                    `Попроси ${SPECIALIST_NAMES_GENITIVE_RU[msg.delegatedTask!.targetMode]} доработать: `
                                  );
                                  if (textareaRef.current) {
                                    textareaRef.current.focus();
                                  }
                                }}
                                title="Подготовить замечания для доработки ответа специалистом"
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-50 text-amber-900 border border-amber-200/80 text-[11px] font-semibold hover:bg-amber-100 transition-colors cursor-pointer"
                              >
                                <Edit3 className="w-3 h-3 text-amber-700" />
                                <span>Запросить доработку</span>
                              </button>
                            )}

                            {/* Open Specialist Chat (Stage 8) */}
                            <button
                              type="button"
                              onClick={() => {
                                pixelAgentCoordinator.openDelegatedChat(
                                  msg.delegatedTask!.schoolId,
                                  msg.delegatedTask!.targetMode,
                                  msg.delegatedTask!.sessionId,
                                  msg.delegatedTask!.resultMessageId ||
                                    msg.delegatedTask!.lastSpecialistMessageId
                                );
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-[11px] font-semibold hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                              <span>
                                Открыть чат с{' '}
                                {
                                  SPECIALIST_NAMES_INSTRUMENTAL_RU[
                                    msg.delegatedTask.targetMode
                                  ]
                                }
                              </span>
                            </button>

                            {/* Retry on Error */}
                            {msg.delegatedTask.status === 'error' && (
                              <button
                                type="button"
                                disabled={isPixelGenerating}
                                onClick={() => {
                                  const dt = msg.delegatedTask!;
                                  const retryIntent =
                                    pixelAgentCoordinator.parseDelegationIntent(
                                      dt.originalUserRequest,
                                      dt.schoolId
                                    ) || {
                                      isDelegation: true,
                                      isSupportedSpecialist: true,
                                      targetMode: dt.targetMode,
                                      targetSpecialistNameRu:
                                        AGENT_MODES[dt.targetMode].shortTitle,
                                      targetSchool: dt.schoolId,
                                      instruction: dt.instruction,
                                      cleanInstruction: dt.instruction,
                                      originalText: dt.originalUserRequest,
                                    };
                                  void pixelAgentCoordinator.executeDelegation({
                                    intent: retryIntent,
                                    sourceMode: 'text',
                                    skipAddingUserCompanionMessage: true,
                                    existingTaskId: dt.taskId,
                                  });
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-100 text-amber-900 text-[11px] font-semibold hover:bg-amber-200 transition-colors cursor-pointer disabled:opacity-50"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Повторить поручение</span>
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Stage 6.5 (1): Disambiguation list when multiple chats match */}
                      {msg.chatDisambiguationList &&
                        msg.chatDisambiguationList.length > 0 && (
                          <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-1.5">
                            <div className="text-[10px] font-bold text-slate-700">
                              Выберите нужный диалог:
                            </div>
                            <div className="space-y-1.5">
                              {msg.chatDisambiguationList.map((chatItem) => (
                                <div
                                  key={chatItem.sessionId}
                                  className="p-2 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-2 text-[11px]"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="font-bold text-slate-900 truncate">
                                      «{chatItem.sessionTitle}»
                                    </div>
                                    <div className="text-[10px] text-slate-500">
                                      {chatItem.specialistTitle} ·{' '}
                                      {chatItem.schoolName} ·{' '}
                                      {chatItem.messagesCount} сообщ.
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void pixelAgentCoordinator.switchToWorkingChat(
                                        {
                                          schoolId: chatItem.schoolId,
                                          mode: chatItem.mode,
                                          sessionId: chatItem.sessionId,
                                          announceInCompanion: true,
                                        }
                                      );
                                    }}
                                    className="px-2.5 py-1 rounded-xl bg-slate-900 text-white text-[10px] font-bold hover:bg-slate-800 shrink-0 cursor-pointer"
                                  >
                                    Открыть
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                      {/* Stage 6.5 (5): Safe Working Chat Deletion Confirmation Card */}
                      {msg.pendingChatDeletion && (
                        <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-2">
                          <div className="rounded-xl p-2.5 bg-rose-50/70 border border-rose-200/90 space-y-1.5 text-[11px]">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-rose-950 flex items-center gap-1.5">
                                <Trash2 className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                <span>Подтверждение удаления чата</span>
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  msg.pendingChatDeletion.status === 'confirmed'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : msg.pendingChatDeletion.status ===
                                        'cancelled'
                                      ? 'bg-slate-200 text-slate-600'
                                      : 'bg-amber-100 text-amber-900'
                                }`}
                              >
                                {msg.pendingChatDeletion.status === 'confirmed'
                                  ? 'Удалено'
                                  : msg.pendingChatDeletion.status ===
                                      'cancelled'
                                    ? 'Отменено'
                                    : 'Ждёт подтверждения'}
                              </span>
                            </div>
                            <div className="text-slate-700 space-y-0.5">
                              <div>
                                Чат:{' '}
                                <strong className="text-slate-900">
                                  «{msg.pendingChatDeletion.sessionTitle}»
                                </strong>
                              </div>
                              <div>
                                Школа:{' '}
                                <strong className="text-slate-900">
                                  {msg.pendingChatDeletion.schoolName}
                                </strong>{' '}
                                · Специалист:{' '}
                                <strong className="text-slate-900">
                                  {msg.pendingChatDeletion.specialistTitle}
                                </strong>{' '}
                                ({msg.pendingChatDeletion.messagesCount} сообщ.)
                              </div>
                            </div>
                          </div>

                          {msg.pendingChatDeletion.status ===
                            'awaiting_confirmation' && (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  void pixelAgentCoordinator.confirmPendingChatDeletion(
                                    msg.pendingChatDeletion!.deletionId
                                  );
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 text-white text-[11px] font-bold hover:bg-rose-700 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Да, удалить чат</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void pixelAgentCoordinator.cancelPendingChatDeletion(
                                    msg.pendingChatDeletion!.deletionId
                                  );
                                }}
                                className="px-2.5 py-1.5 rounded-xl bg-slate-100 text-slate-600 text-[11px] font-medium hover:bg-slate-200 transition-colors cursor-pointer"
                              >
                                Отмена
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Stage 6.5 (5): Deletable Working Chats List Card */}
                      {msg.deletableChatsList &&
                        msg.deletableChatsList.length > 0 && (
                          <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-1.5">
                            <div className="text-[10px] font-bold text-slate-700">
                              Рабочие чаты (выберите для открытия или удаления):
                            </div>
                            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                              {msg.deletableChatsList.map((chatItem) => (
                                <div
                                  key={chatItem.sessionId}
                                  className="p-2 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-2 text-[11px]"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="font-bold text-slate-900 truncate">
                                      «{chatItem.sessionTitle}»
                                    </div>
                                    <div className="text-[10px] text-slate-500">
                                      {chatItem.schoolName} ·{' '}
                                      {chatItem.specialistTitle} ·{' '}
                                      {chatItem.messagesCount} сообщ.
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void pixelAgentCoordinator.switchToWorkingChat(
                                          {
                                            schoolId: chatItem.schoolId,
                                            mode: chatItem.mode,
                                            sessionId: chatItem.sessionId,
                                            announceInCompanion: true,
                                          }
                                        );
                                      }}
                                      className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 text-[10px] font-semibold hover:bg-slate-100 cursor-pointer"
                                    >
                                      Открыть
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void pixelAgentCoordinator.prepareChatDeletionForConfirmation(
                                          chatItem.sessionId
                                        );
                                      }}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-semibold hover:bg-rose-100 cursor-pointer"
                                    >
                                      <Trash2 className="w-2.5 h-2.5" />
                                      <span>Удалить…</span>
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                    </div>

                    {/* Transparent Context, Copy Action & Provider Attribution Indicator */}
                    <div className="mt-1 px-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                      <span>{msg.createdAt}</span>

                      {/* Stage 6.5 (3): Copy button for Pixel & user messages */}
                      {!msg.isStreaming && msg.content.trim() && (
                        <button
                          type="button"
                          onClick={() =>
                            void handleCopyCompanionMessage(msg.id, msg.content)
                          }
                          title="Скопировать полный чистый текст сообщения без технических тегов"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-white hover:bg-slate-100 text-slate-600 border border-slate-200/80 transition-colors cursor-pointer"
                        >
                          {copiedCompanionMsgId === msg.id ? (
                            <>
                              <Check className="w-2.5 h-2.5 text-emerald-600" />
                              <span className="text-emerald-700 font-semibold">
                                Скопировано
                              </span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-2.5 h-2.5 text-slate-500" />
                              <span>Копировать</span>
                            </>
                          )}
                        </button>
                      )}

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
                                    title="Прослушать ответ единым голосом Пикселя"
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 transition-colors"
                                  >
                                    <Volume2 className="w-2.5 h-2.5 text-[#00A8B5]" />
                                    <span>Прослушать</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleSpeakMessage(msg.id, msg.content, true)}
                                    title="Заново синтезировать речь без кэша с выбранным голосом Пикселя"
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
                                    Голос Пикселя: <b>{playbackState.voiceName || 'Aoede'}</b>
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

              {/* ZONE 3: LOWER INPUT PANEL */}
              <div className="border-t border-slate-200/80 bg-white px-4 sm:px-6 py-3 space-y-2.5 shrink-0">
                {/* Quick Action Chips & History Actions */}
                <div className="flex items-center justify-between gap-2 overflow-x-auto pb-0.5">
                  <div className="flex items-center gap-1.5 flex-nowrap">
                    {activeChatCtx?.lastSpecialistMessage && (
                      <button
                        type="button"
                        onClick={() => {
                          void executePixelChatRequest('Пиксель, прочитай ответ');
                        }}
                        className="px-2.5 py-1 rounded-xl bg-[#00A8B5]/10 hover:bg-[#00A8B5]/20 text-[11px] font-semibold text-[#007A85] whitespace-nowrap transition-colors cursor-pointer inline-flex items-center gap-1"
                      >
                        <Volume2 className="w-3 h-3" />
                        <span>Прочитай ответ</span>
                      </button>
                    )}
                    {stoppedReadingSession && !isSpeakingUnified && (
                      <button
                        type="button"
                        onClick={() => {
                          void voiceManager.resumeStoppedReading();
                        }}
                        className="px-2.5 py-1 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 text-[11px] font-bold whitespace-nowrap transition-colors cursor-pointer inline-flex items-center gap-1"
                      >
                        <Play className="w-2.5 h-2.5 fill-current" />
                        <span>
                          Продолжить чтение ({stoppedReadingSession.resumeChunkIndex + 1}/{stoppedReadingSession.totalChunks})
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const ctx = pixelAgentCoordinator.getActiveChatContext();
                        const genName = ctx
                          ? SPECIALIST_NAMES_GENITIVE_RU[ctx.mode]
                          : 'Маркетолога';
                        setChatInput(
                          `Спроси ${genName}: какие 3 главных шага стоит запустить в первую очередь?`
                        );
                        if (textareaRef.current) {
                          textareaRef.current.focus();
                        }
                      }}
                      className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-[11px] font-medium text-slate-700 whitespace-nowrap transition-colors cursor-pointer"
                    >
                      + Уточнить в чате...
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setChatInput(
                          `Пиксель, напомни мне завтра проверить презентацию для ${SCHOOLS[currentSchoolId].name}`
                        );
                        if (textareaRef.current) {
                          textareaRef.current.focus();
                        }
                      }}
                      className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-[11px] font-medium text-slate-700 whitespace-nowrap transition-colors cursor-pointer"
                    >
                      + Напомнить завтра...
                    </button>
                  </div>

                  {companionMessages.length > 1 && (
                    <button
                      type="button"
                      onClick={onClearCompanionMessages}
                      title="Очистить историю диалога с Пикселем"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Active Speech Recognition Banner */}
                {(speechInputStatus === 'listening' || speechInputStatus === 'recognizing') && (
                  <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900">
                    <div className="flex items-center gap-2 truncate">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-ping shrink-0" />
                      <span className="font-semibold">
                        {speechInputStatus === 'listening' ? 'Слушаю вас... Говорите' : 'Распознавание речи...'}
                      </span>
                      {isRemoteSpeechService && (
                        <span className="text-[10px] text-red-700 bg-red-100 px-1.5 py-0.5 rounded font-mono">
                          Браузерная служба
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => browserSpeechInput.stop()}
                        className="px-2.5 py-0.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 transition-colors cursor-pointer"
                      >
                        Готово
                      </button>
                      <button
                        type="button"
                        onClick={() => browserSpeechInput.cancel()}
                        className="px-2 py-0.5 rounded-lg text-red-700 hover:bg-red-100 text-xs cursor-pointer"
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
                      className="p-0.5 hover:bg-amber-100 rounded text-amber-700 shrink-0 cursor-pointer"
                      title="Закрыть уведомление"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Textarea Form */}
                <form
                  onSubmit={handleSendCompanionMessage}
                  className="flex items-end gap-2"
                >
                  <div className="flex-1 min-w-0 relative">
                    <textarea
                      ref={textareaRef}
                      rows={1}
                      value={chatInput}
                      disabled={isPixelGenerating}
                      onChange={(e) => {
                        setChatInput(e.target.value);
                        if (textareaRef.current) {
                          textareaRef.current.style.height = 'auto';
                          textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void handleSendCompanionMessage(e);
                        }
                      }}
                      placeholder={
                        isPixelGenerating
                          ? `${getGenerationStageLabelRu(pixelGenerationStage)} (${pixelElapsedSec} с)...`
                          : 'Напишите задачу, вопрос или поручение... (Enter — отправить, Shift+Enter — перенос)'
                      }
                      className="w-full rounded-2xl border border-slate-300 bg-slate-50/80 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#00A8B5] focus:border-transparent resize-none leading-relaxed transition-all max-h-32 min-h-[42px]"
                    />
                  </div>

                  {/* STT Button */}
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
                    className={`p-2.5 rounded-2xl transition-all shrink-0 cursor-pointer ${
                      speechInputStatus === 'listening' || speechInputStatus === 'recognizing'
                        ? 'bg-red-600 text-white animate-pulse shadow-md scale-105'
                        : !isMicSupported
                          ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                          : 'bg-slate-100 text-slate-700 hover:text-slate-900 hover:bg-slate-200'
                    }`}
                  >
                    {speechInputStatus === 'listening' || speechInputStatus === 'recognizing' ? (
                      <MicOff className="w-4 h-4" />
                    ) : (
                      <Mic className="w-4 h-4" />
                    )}
                  </button>

                  {/* Send or Stop Button */}
                  {isPixelGenerating ? (
                    <button
                      type="button"
                      onClick={handleStopPixelGeneration}
                      className="p-2.5 rounded-2xl bg-red-600 text-white hover:bg-red-700 transition-colors shrink-0 cursor-pointer shadow-xs"
                      aria-label="Остановить ответ Пикселя"
                      title="Остановить генерацию ответа"
                    >
                      <Square className="w-4 h-4 fill-current" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!chatInput.trim() || isPixelGenerating}
                      className="p-2.5 rounded-2xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 transition-all shrink-0 cursor-pointer shadow-xs hover:scale-102 active:scale-98"
                      aria-label="Отправить сообщение Пикселю"
                    >
                      <Send className="w-4 h-4 text-[#FFD700]" />
                    </button>
                  )}
                </form>
              </div>
            </div>
          )}

          {/* TAB 2: ANNA'S TO-DO LIST */}
          {activeTab === 'tasks' && (
            <div className="flex-1 flex flex-col min-h-0 p-4 sm:p-6 space-y-4 overflow-y-auto bg-[#F9FAFB]/70">
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
            <div className="flex-1 flex flex-col min-h-0 p-4 sm:p-6 space-y-4 overflow-y-auto bg-[#F9FAFB]/70">
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
              <div className="px-4 sm:px-6 py-2.5 bg-slate-50 border-t border-slate-200/80 flex items-center justify-between text-xs text-slate-600 shrink-0">
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
          </div>
        );
      })()}

      {/* ====================================================================
          2. ANCHORED DIGITAL PET «ПИКСЕЛЬ» IN BOTTOM-LEFT OF CENTRAL WORKSPACE
          Strictly fixed in bottom-left; adjusts smoothly when sidebar collapses/expands.
          No dragging displacement; clicks trigger petting & toggle dialog.
         ==================================================================== */}
      <div
        ref={petContainerRef}
        className={`fixed z-30 flex flex-col items-start pointer-events-none select-none bottom-4 sm:bottom-6 ${baseLeftClass} transition-[left] duration-300 ease-out`}
      >
        {/* Compact Conversational Speech Bubble (Positioned strictly above Pixel in bottom-left) */}
        {!dialogOpen && visibleBubbleTurn && (
          <div
            role="status"
            aria-live="polite"
            onMouseEnter={handleBubbleMouseEnter}
            onMouseLeave={handleBubbleMouseLeave}
            className={`pointer-events-auto relative mb-2.5 max-w-[290px] sm:max-w-[360px] rounded-2xl bg-white/98 backdrop-blur-md border border-slate-200/90 shadow-xl px-3.5 py-2.5 text-xs text-slate-800 transition-all duration-200 select-text ${
              isBubbleFadingOut
                ? 'opacity-0 scale-95 pointer-events-none'
                : 'opacity-100 scale-100 animate-in fade-in slide-in-from-bottom-2 duration-150'
            }`}
          >
            {/* Header: Speaker identity + live activity indicators + mini actions */}
            <div className="flex items-center justify-between gap-1.5 pb-1.5 border-b border-slate-100">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    visibleBubbleTurn.isSpeaking
                      ? 'bg-rose-500 animate-ping'
                      : visibleBubbleTurn.isListening
                        ? 'bg-sky-500 animate-pulse'
                        : visibleBubbleTurn.isUser
                          ? 'bg-emerald-500'
                          : 'bg-pink-400'
                  }`}
                />
                <span className="font-bold text-[11px] text-slate-900 truncate">
                  {visibleBubbleTurn.speaker}
                </span>
                {visibleBubbleTurn.isSpeaking && (
                  <span className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] font-semibold bg-rose-50 text-rose-600">
                    <Volume2 className="w-2.5 h-2.5 animate-pulse" />
                    <span>речь</span>
                  </span>
                )}
                {visibleBubbleTurn.isListening && (
                  <span className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] font-semibold bg-sky-50 text-sky-600">
                    <Mic className="w-2.5 h-2.5 animate-pulse" />
                    <span>слушает</span>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {recentTurns.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setIsRecentHistoryExpanded((v) => !v)}
                    title={
                      isRecentHistoryExpanded
                        ? 'Скрыть историю'
                        : 'Показать последние реплики'
                    }
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    {isRecentHistoryExpanded
                      ? 'Скрыть'
                      : `История (${recentTurns.length})`}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDialogOpen(true)}
                  title="Развернуть окно диалога"
                  aria-label="Развернуть окно диалога"
                  className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-sky-600 hover:text-sky-800 hover:bg-sky-50 transition-colors cursor-pointer"
                >
                  Диалог
                </button>
                <button
                  type="button"
                  onClick={handleCloseSpeechBubble}
                  title="Закрыть облачко"
                  aria-label="Закрыть облачко"
                  className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0 cursor-pointer transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Main Current Spoken / Turn Text with Preview / Truncation for long messages */}
            <div className="mt-2 text-[12px] sm:text-[13px] text-slate-800 leading-relaxed font-normal break-words whitespace-pre-wrap max-h-[160px] overflow-y-auto">
              {visibleBubbleTurn.text.length > 160 && !isBubbleTextExpanded ? (
                <>
                  <span>{visibleBubbleTurn.text.slice(0, 160)}...</span>
                  <button
                    type="button"
                    onClick={() => setIsBubbleTextExpanded(true)}
                    className="ml-1 text-sky-600 font-semibold hover:underline cursor-pointer text-[11px]"
                  >
                    Подробнее
                  </button>
                </>
              ) : (
                <>
                  <span>{visibleBubbleTurn.text}</span>
                  {visibleBubbleTurn.text.length > 160 && isBubbleTextExpanded && (
                    <button
                      type="button"
                      onClick={() => setIsBubbleTextExpanded(false)}
                      className="ml-1 text-slate-400 font-semibold hover:underline cursor-pointer text-[11px]"
                    >
                      Свернуть
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Expandable Mini-History Drawer (Last 2-3 Turns) */}
            {isRecentHistoryExpanded && recentTurns.length > 0 && (
              <div className="mt-2.5 pt-2 border-t border-slate-100/90 space-y-1.5 max-h-[130px] overflow-y-auto pr-1">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Последние реплики:
                </div>
                {recentTurns.map((turn) => {
                  const isUserTurn = turn.role === 'user';
                  const cleanTurn = cleanSpeechBubbleText(turn.content);
                  return (
                    <div
                      key={turn.id}
                      className={`p-1.5 rounded-xl text-[11px] leading-snug break-words whitespace-pre-wrap ${
                        isUserTurn
                          ? 'bg-slate-100/80 text-slate-700'
                          : 'bg-pink-50/70 text-slate-800 border border-pink-100/50'
                      }`}
                    >
                      <span className="font-semibold text-slate-900 mr-1">
                        {isUserTurn ? 'Анна:' : 'Пиксель:'}
                      </span>
                      <span>{cleanTurn}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 60-Minute Active Work Break Actions */}
            {visibleBubbleTurn.isBreakReminder && (
              <div className="mt-2 pt-2 border-t border-slate-100 grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={handleTakeBreakNow}
                  className="col-span-2 inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-xl bg-slate-900 text-white text-[10px] font-semibold hover:bg-slate-800 cursor-pointer"
                >
                  <Coffee className="w-3 h-3 text-[#FFD700]" />
                  <span>Отдохнуть сейчас</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSnoozeBreak(15)}
                  className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[10px] font-semibold text-slate-700 cursor-pointer"
                >
                  Через 15 мин
                </button>
                <button
                  type="button"
                  onClick={() => handleSnoozeBreak(30)}
                  className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[10px] font-semibold text-slate-700 cursor-pointer"
                >
                  Через 30 мин
                </button>
                <button
                  type="button"
                  onClick={handleDisableBreakReminders}
                  className="col-span-2 inline-flex items-center justify-center gap-1 py-0.5 text-[10px] text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <BellOff className="w-2.5 h-2.5" />
                  <span>Отключить напоминания</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Pet Wrapper with Dialogue Button & Reopen Last Remark Button */}
        <div
          className="relative group pointer-events-auto flex items-center gap-2"
          onMouseLeave={() => setControlsVisibleByTap(false)}
        >
          {/* Action buttons beside Pixel */}
          <div className="relative z-20 flex items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSpeechBubble(null);
                setDialogOpen((v) => !v);
              }}
              title="Поговорить с Пикселем"
              aria-label="Поговорить с Пикселем"
              className={`relative w-8 h-8 rounded-full bg-white/95 hover:bg-white border shadow-sm hover:shadow-md flex items-center justify-center transition-all duration-200 cursor-pointer hover:scale-105 active:scale-95 group/btn ${
                dialogOpen
                  ? 'border-sky-300 ring-2 ring-sky-100 text-sky-600'
                  : 'border-pink-200/90 hover:border-sky-300 text-pink-500 hover:text-sky-500'
              }`}
            >
              <MessageCircleHeart className="w-4 h-4 transition-colors" />
              {dueOrOverdueTasks.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-pink-400 text-white font-mono-tabular font-extrabold text-[9px] flex items-center justify-center border border-white">
                  {dueOrOverdueTasks.length}
                </span>
              )}
            </button>

            {/* Reopen Last Bubble Button when bubble was dismissed and dialog is closed */}
            {!dialogOpen && isCurrentBubbleDismissed && (lastSavedBubble || companionMessages.length > 0) && (
              <button
                type="button"
                onClick={handleReopenLastBubble}
                title="Показать последнее сообщение Пикселя"
                aria-label="Показать последнее сообщение"
                className="w-7 h-7 rounded-full bg-white/95 hover:bg-white border border-slate-200/90 shadow-2xs hover:shadow text-slate-500 hover:text-sky-600 flex items-center justify-center transition-all cursor-pointer hover:scale-105 active:scale-95"
              >
                <MessageSquare className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Floating Hearts on Petting */}
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

          {/* Interactive Fixed & Pettable Fantasy Creature (No Dragging displacement!) */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              triggerPettingReaction();
              setDialogOpen((v) => !v);
            }}
            title="Нажмите, чтобы погладить Пикселя и открыть диалог"
            className="bg-transparent overflow-visible cursor-pointer transition-transform duration-150 hover:scale-105 active:scale-95"
          >
            {/* 3D Glowing Sphere Character */}
            <div className="w-[54px] h-[54px] sm:w-[64px] sm:h-[64px] lg:w-[74px] lg:h-[74px] flex items-center justify-center">
              <PixelCharacter
                size={characterSize}
                petTrigger={petTriggerCount}
                isSpeaking={isSpeakingUnified}
                isListening={isListeningUnified}
                isThinking={isThinkingUnified}
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
