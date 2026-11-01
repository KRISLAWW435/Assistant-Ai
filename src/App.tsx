/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  Database,
  FileText,
  Loader2,
  Paperclip,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  AgentMode,
  AIProviderId,
  AIProviderSelectionMode,
  ChatAttachment,
  ChatMessage,
  ChatSession,
  CompanionMemoryRecord,
  CompanionMessage,
  CompanionPreferencesRecord,
  CompanionTaskRecord,
  DocumentProcessingStatus,
  KnowledgeBaseBySchool,
  KnowledgeCategoryKey,
  NavSection,
  RightPanelTab,
  SchoolId,
  UploadedDocumentRecord,
} from './types/assistant';
import {
  AGENT_MODES,
  createEmptyKnowledgeBase,
  KNOWLEDGE_CATEGORIES,
  SCHOOLS,
} from './config/schoolsAndModes';
import {
  createDefaultCompanionPreferences,
  createInitialCompanionGreetingMessage,
  sortSessionsPinnedAndUpdatedDesc,
  storageProvider,
  ValidatedBackupSummary,
} from './providers/storageProvider';
import {
  documentProvider,
  ParsedDocumentResult,
} from './providers/documentProvider';
import {
  geminiProvider,
  GeminiServerStatus,
  GenerationStage,
  ProviderDocumentConsentRequiredError,
} from './providers/geminiProvider';
import {
  aiProviderManager,
  AIProvidersSystemState,
  readStoredProviderSelection,
  writeStoredProviderSelection,
} from './providers/aiProviderManager';
import { isAgentModeSection, Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { HomeView } from './components/HomeView';
import {
  PendingFallbackDocumentConsentState,
  SendMessageContextOptions,
  UnifiedChatView,
} from './components/UnifiedChatView';
import {
  KnowledgeBaseView,
  renderStatusBadge,
} from './components/KnowledgeBaseView';
import { BackupsView } from './components/BackupsView';
import { ConnectionsView } from './components/ConnectionsView';
import {
  formatFileSizeRu,
  RightWorkspacePanel,
} from './components/RightWorkspacePanel';
import { PixelCompanion } from './components/PixelCompanion';
import { PixelLiveVoiceModal } from './components/PixelLiveVoiceModal';
import { PixelVoiceSettingsModal } from './components/PixelVoiceSettingsModal';
import { VoiceDiagnosticModal } from './components/VoiceDiagnosticModal';
import { PixelVoiceWidget } from './components/PixelVoiceWidget';
import { pixelVoiceCoordinator } from './providers/voice/pixelVoiceCoordinator';
import { geminiLiveClient } from './providers/voice/geminiLiveClient';
import { wakeWordManager } from './providers/voice/wakeWordManager';
import { voiceManager } from './providers/voice/voiceManager';
import { WakeWordState } from './types/voice';
import { pixelAgentCoordinator } from './providers/PixelAgentCoordinator';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'kiber_renderia_sidebar_collapsed';
const RIGHT_PANEL_COLLAPSED_STORAGE_KEY = 'kiber_renderia_right_panel_collapsed';
const RIGHT_PANEL_TAB_STORAGE_KEY = 'kiber_renderia_right_panel_tab';
const ACTIVE_SCHOOL_STORAGE_KEY = 'kiber_renderia_active_school';
const PIXEL_COLLAPSED_STORAGE_KEY = 'kiber_renderia_pixel_collapsed';

function readInitialBoolean(key: string, defaultVal: boolean): boolean {
  try {
    const val = window.localStorage.getItem(key);
    if (val === 'true') return true;
    if (val === 'false') return false;
  } catch {
    // ignore storage errors
  }
  return defaultVal;
}

function readInitialRightPanelCollapsed(): boolean {
  try {
    const val = window.localStorage.getItem(RIGHT_PANEL_COLLAPSED_STORAGE_KEY);
    if (val === 'true') return true;
    if (val === 'false') return false;
  } catch {
    // ignore storage errors
  }
  return typeof window !== 'undefined' ? window.innerWidth < 1440 : false;
}

function readInitialRightPanelTab(): RightPanelTab {
  try {
    const saved = window.localStorage.getItem(RIGHT_PANEL_TAB_STORAGE_KEY);
    if (
      saved === 'materials' ||
      saved === 'preview' ||
      saved === 'search' ||
      saved === 'context'
    ) {
      return saved;
    }
  } catch {
    // ignore storage errors
  }
  return 'context';
}

function readInitialActiveSchool(): SchoolId {
  try {
    const saved = window.localStorage.getItem(ACTIVE_SCHOOL_STORAGE_KEY);
    if (saved === 'kiberone' || saved === 'renderia') {
      return saved;
    }
  } catch {
    // ignore storage errors
  }
  return 'kiberone';
}

function writeActiveSchoolToStorage(school: SchoolId): void {
  try {
    window.localStorage.setItem(ACTIVE_SCHOOL_STORAGE_KEY, school);
  } catch {
    // ignore storage errors
  }
}

function formatTimeNow(date: Date = new Date()): string {
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateTimeShort(date: Date = new Date()): string {
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildBackupFilename(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `kiberone-renderia-backup-${yyyy}-${mm}-${dd}_${hh}-${min}.json`;
}

function buildNewSession(
  mode: AgentMode,
  school: SchoolId,
  existingSessions: ChatSession[] = []
): ChatSession {
  const schoolCfg = SCHOOLS[school];
  const modeCfg = AGENT_MODES[mode];
  const now = new Date();
  const timeStr = formatTimeNow(now);
  const nowMs = now.getTime();

  const sameBucketCount = existingSessions.filter(
    (s) => s.schoolId === school && s.mode === mode
  ).length;

  const baseTitle = `${modeCfg.shortTitle} · ${schoolCfg.name}`;
  const title =
    sameBucketCount === 0
      ? baseTitle
      : `${baseTitle} #${sameBucketCount + 1}`;

  return {
    id: `session-${nowMs}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    schoolId: school,
    mode,
    createdAt: timeStr,
    updatedAt: timeStr,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    isPinned: false,
    messages: [],
    attachments: [],
  };
}

const DATA_URL_PREVIEW_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'jfif',
  'svg',
  'pdf',
]);

const IMAGE_ONLY_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'jfif',
  'svg',
]);

interface StagedChatFileModalState {
  target: 'draft' | 'dialogue';
  attachment: ChatAttachment;
  parsedResult: ParsedDocumentResult | null;
}

export default function App() {
  // Open directly in the ChatGPT-style AI Assistant workspace ('marketer')
  const [activeSection, setActiveSection] = useState<NavSection>('marketer');
  const [activeSchool, setActiveSchool] = useState<SchoolId>(() =>
    readInitialActiveSchool()
  );
  const [activeAgentMode, setActiveAgentMode] = useState<AgentMode>('marketer');

  // Left and Right panel states (persisted in localStorage)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    readInitialBoolean(SIDEBAR_COLLAPSED_STORAGE_KEY, false)
  );
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState<boolean>(() =>
    readInitialRightPanelCollapsed()
  );
  const [rightPanelMobileOpen, setRightPanelMobileOpen] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>(() =>
    readInitialRightPanelTab()
  );
  const [pixelCollapsed, setPixelCollapsed] = useState<boolean>(() =>
    readInitialBoolean(PIXEL_COLLAPSED_STORAGE_KEY, false)
  );

  const [isStorageLoading, setIsStorageLoading] = useState<boolean>(true);
  const [storageError, setStorageError] = useState<string | null>(null);

  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBaseBySchool>(() =>
    createEmptyKnowledgeBase()
  );
  const [uploadedDocuments, setUploadedDocuments] = useState<
    UploadedDocumentRecord[]
  >([]);
  const [knowledgeBanner, setKnowledgeBanner] = useState<string | null>(null);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Pixel Companion persistent state (IndexedDB v3)
  const [companionMessages, setCompanionMessages] = useState<
    CompanionMessage[]
  >(() => [createInitialCompanionGreetingMessage()]);
  const [companionMemory, setCompanionMemory] = useState<
    CompanionMemoryRecord[]
  >([]);
  const [companionTasks, setCompanionTasks] = useState<CompanionTaskRecord[]>(
    []
  );
  const [companionPreferences, setCompanionPreferences] =
    useState<CompanionPreferencesRecord>(() =>
      createDefaultCompanionPreferences()
    );

  // Dialogue-scoped attachments & search highlight state
  const [draftAttachment, setDraftAttachment] = useState<ChatAttachment | null>(
    null
  );
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<
    string | null
  >(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null);

  // Chat file parsing & preview modal state
  const [isParsingChatFile, setIsParsingChatFile] = useState(false);
  const [chatParsingStatus, setChatParsingStatus] =
    useState<DocumentProcessingStatus | null>(null);
  const [stagedChatFileModal, setStagedChatFileModal] =
    useState<StagedChatFileModalState | null>(null);

  // Backup restore confirmation modal state
  const [pendingBackupRestore, setPendingBackupRestore] =
    useState<ValidatedBackupSummary | null>(null);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);

  // Stage 3.1, 3.2 & 3.3: Multi-provider AI streaming, status, failover & per-provider consent state
  const [geminiStatus, setGeminiStatus] = useState<GeminiServerStatus | null>(
    null
  );
  const [providersState, setProvidersState] =
    useState<AIProvidersSystemState | null>(null);
  const [providerSelection, setProviderSelection] =
    useState<AIProviderSelectionMode>(() => readStoredProviderSelection());
  const [isCheckingProviders, setIsCheckingProviders] = useState(false);
  const [pendingFallbackConsentPrompt, setPendingFallbackConsentPrompt] =
    useState<PendingFallbackDocumentConsentState | null>(null);
  const [isGeneratingChat, setIsGeneratingChat] = useState(false);
  const [generatingSessionId, setGeneratingSessionId] = useState<string | null>(
    null
  );
  const [chatGenerationStage, setChatGenerationStage] =
    useState<GenerationStage | null>(null);
  const [chatGenerationElapsedSec, setChatGenerationElapsedSec] = useState(0);
  const [chatSlowWarning, setChatSlowWarning] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState<{
    id: number;
    text: string;
  } | null>(null);

  // Live Voice Mode & Voice Settings Modal state (Stage 6.1: Global Coordinator)
  const [isLiveVoiceOpen, setIsLiveVoiceOpen] = useState(false);
  const [isLiveVoiceFromWakeWord, setIsLiveVoiceFromWakeWord] = useState(false);
  const [isVoiceSettingsOpen, setIsVoiceSettingsOpen] = useState(false);
  const [isVoiceDiagnosticsOpen, setIsVoiceDiagnosticsOpen] = useState(false);
  const [wakeWordState, setWakeWordState] = useState<WakeWordState>(() =>
    wakeWordManager.getState()
  );
  const [wakeWordDetail, setWakeWordDetail] = useState<string>('');
  const [pixelForceOpenChatTrigger, setPixelForceOpenChatTrigger] = useState(0);

  // References to keep latest context available to pixelVoiceCoordinator & pixelAgentCoordinator
  const activeSchoolRef = useRef<SchoolId>(activeSchool);
  useEffect(() => {
    activeSchoolRef.current = activeSchool;
    pixelVoiceCoordinator.updateActiveSchool(activeSchool);
  }, [activeSchool]);

  const activeSectionRef = useRef<NavSection>(activeSection);
  useEffect(() => {
    activeSectionRef.current = activeSection;
  }, [activeSection]);

  const activeAgentModeRef = useRef<AgentMode>(activeAgentMode);
  useEffect(() => {
    activeAgentModeRef.current = activeAgentMode;
  }, [activeAgentMode]);

  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // Stage 6.3 (6): Notify Pixel when Anna switches to another specialist chat or school
  useEffect(() => {
    if (isAgentModeSection(activeSection)) {
      pixelAgentCoordinator.notifyContextSwitch(
        activeSchool,
        activeSection,
        activeSessionId
      );
    }
  }, [activeSchool, activeSection, activeSessionId]);

  const companionMemoryRef = useRef<CompanionMemoryRecord[]>(companionMemory);
  useEffect(() => {
    companionMemoryRef.current = companionMemory;
  }, [companionMemory]);

  const companionTasksRef = useRef<CompanionTaskRecord[]>(companionTasks);
  useEffect(() => {
    companionTasksRef.current = companionTasks;
  }, [companionTasks]);

  const companionMessagesRef = useRef<CompanionMessage[]>(companionMessages);
  useEffect(() => {
    companionMessagesRef.current = companionMessages;
  }, [companionMessages]);

  const knowledgeBaseRef = useRef<KnowledgeBaseBySchool>(knowledgeBase);
  useEffect(() => {
    knowledgeBaseRef.current = knowledgeBase;
  }, [knowledgeBase]);

  const uploadedDocumentsRef =
    useRef<UploadedDocumentRecord[]>(uploadedDocuments);
  useEffect(() => {
    uploadedDocumentsRef.current = uploadedDocuments;
  }, [uploadedDocuments]);

  const providerSelectionRef =
    useRef<AIProviderSelectionMode>(providerSelection);
  useEffect(() => {
    providerSelectionRef.current = providerSelection;
  }, [providerSelection]);

  const filterOutReadAloudTurns = (
    incoming: CompanionMessage[]
  ): CompanionMessage[] => {
    const hasReadAloudUserTurn = incoming.some(
      (m) =>
        m.role === 'user' &&
        Boolean(
          pixelAgentCoordinator.parseReadAloudIntent(
            m.content,
            activeSchoolRef.current
          )
        )
    );
    if (hasReadAloudUserTurn) {
      // Stage 6.3 (2): Do not create a copy of the specialist's message in Pixel's chat on read-aloud command
      return [];
    }
    return incoming;
  };

  useEffect(() => {
    pixelAgentCoordinator.init({
      getActiveSchool: () => activeSchoolRef.current,
      getActiveSection: () => activeSectionRef.current,
      getActiveAgentMode: () => activeAgentModeRef.current,
      getActiveSessionId: () => activeSessionIdRef.current,
      getSessions: () => sessionsRef.current,
      onUpdateSessions: (nextSessions, selectSessionId) => {
        sessionsRef.current = nextSessions;
        setSessions(nextSessions);
        if (selectSessionId !== undefined) {
          activeSessionIdRef.current = selectSessionId;
          setActiveSessionId(selectSessionId);
        }
      },
      onDeleteSession: async (sessionId) => {
        try {
          await storageProvider.deleteSessionCascade(sessionId);
          const remaining = sortSessionsPinnedAndUpdatedDesc(
            sessionsRef.current.filter((s) => s.id !== sessionId)
          );
          sessionsRef.current = remaining;
          setSessions(remaining);

          if (sessionId === activeSessionIdRef.current) {
            const sameContextMatch = remaining.find(
              (s) =>
                s.schoolId === activeSchoolRef.current &&
                s.mode === activeAgentModeRef.current
            );
            const nextId = sameContextMatch ? sameContextMatch.id : null;
            activeSessionIdRef.current = nextId;
            setActiveSessionId(nextId);
          }
          setStorageError(null);
          return true;
        } catch {
          return false;
        }
      },
      getKnowledgeBase: () => knowledgeBaseRef.current,
      getUploadedDocuments: () => uploadedDocumentsRef.current,
      getProviderSelection: () => providerSelectionRef.current,
      getCompanionMessages: () => companionMessagesRef.current,
      onSaveCompanionMessages: async (msgs) => {
        await handleSaveCompanionMessages(msgs);
      },
      onSpecialistGenerationStateChange: ({
        isGenerating,
        sessionId,
        stage,
      }) => {
        setIsGeneratingChat(isGenerating);
        setGeneratingSessionId(sessionId);
        setChatGenerationStage(stage);
      },
      onOpenDelegatedChat: (schoolId, mode, sessionId, highlightMessageId) => {
        activeSchoolRef.current = schoolId;
        activeAgentModeRef.current = mode;
        activeSectionRef.current = mode;
        activeSessionIdRef.current = sessionId;
        setActiveSchool(schoolId);
        writeActiveSchoolToStorage(schoolId);
        setActiveAgentMode(mode);
        setActiveSection(mode);
        setActiveSessionId(sessionId);
        setRightPanelMobileOpen(false);
        if (highlightMessageId) {
          setHighlightedMessageId(highlightMessageId);
          setTimeout(() => {
            setHighlightedMessageId((prev) =>
              prev === highlightMessageId ? null : prev
            );
          }, 3500);
        }
      },
      onHighlightSpecialistMessage: (_sessionId, messageId) => {
        setHighlightedMessageId(messageId);
        setTimeout(() => {
          setHighlightedMessageId((prev) =>
            prev === messageId ? null : prev
          );
        }, 4000);
      },
      onNotifyLiveVoice: (notificationText) => {
        if (pixelVoiceCoordinator.getSnapshot().mode === 'LIVE') {
          geminiLiveClient.sendTextPrompt(notificationText);
        }
      },
    });
  }, []);

  useEffect(() => {
    pixelVoiceCoordinator.init({
      getActiveSchool: () => activeSchoolRef.current,
      getCompanionMemory: () => companionMemoryRef.current,
      getCompanionTasks: () => companionTasksRef.current,
      getActiveChatContext: () => pixelAgentCoordinator.getActiveChatContext(),
      onWakeWordTriggered: (phrase) => {
        setIsLiveVoiceFromWakeWord(true);
        // Do not auto-open the large modal; conversation runs in the compact widget
        setIsLiveVoiceOpen(false);
      },
      onAppendCompanionMessages: async (newMessages) => {
        const filtered = filterOutReadAloudTurns(newMessages);
        if (filtered.length > 0) {
          await handleSaveCompanionMessages([
            ...companionMessagesRef.current,
            ...filtered,
          ]);
        }
        pixelAgentCoordinator.handleSpokenUserMessagesIfAny(newMessages);
      },
    });

    const unsubscribe = pixelVoiceCoordinator.onStateChange((snapshot) => {
      setWakeWordState(snapshot.wakeWordState);
      if (snapshot.errorDetail) {
        setWakeWordDetail(snapshot.errorDetail);
      }
    });

    return () => {
      unsubscribe();
      pixelVoiceCoordinator.stop();
    };
  }, []);

  const handleToggleWakeWord = async () => {
    const current = voiceManager.getSettings();
    const nextEnabled = !current.wakeWordEnabled;
    await voiceManager.updateSettings({ wakeWordEnabled: nextEnabled });
    if (nextEnabled) {
      pixelVoiceCoordinator.setMode('STANDBY');
    } else {
      pixelVoiceCoordinator.setMode('OFF');
    }
  };

  const handleAppendLiveCompanionMessages = async (
    newMessages: CompanionMessage[]
  ) => {
    const filtered = filterOutReadAloudTurns(newMessages);
    if (filtered.length > 0) {
      await handleSaveCompanionMessages([
        ...companionMessagesRef.current,
        ...filtered,
      ]);
    }
    pixelAgentCoordinator.handleSpokenUserMessagesIfAny(newMessages);
  };
  const lastRetryPayloadRef = useRef<
    Record<
      string,
      {
        text: string;
        attachment: ChatAttachment | null;
        contextOptions: SendMessageContextOptions;
      }
    >
  >({});
  const chatAbortRef = useRef<AbortController | null>(null);

  const handleChangeProviderSelection = (nextMode: AIProviderSelectionMode) => {
    setProviderSelection(nextMode);
    writeStoredProviderSelection(nextMode);
  };

  const handleCheckProvidersOnDemand = async () => {
    if (isCheckingProviders) return;
    setIsCheckingProviders(true);
    try {
      const checked = await aiProviderManager.checkAllProvidersOnDemand();
      setProvidersState(checked);
    } catch {
      // ignore check error
    } finally {
      setIsCheckingProviders(false);
    }
  };

  useEffect(() => {
    if (!isGeneratingChat) {
      setChatGenerationElapsedSec(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setChatGenerationElapsedSec(
        Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isGeneratingChat]);

  // Ref to always have the latest sessions list during rapid school/mode switches
  const sessionsRef = useRef<ChatSession[]>(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const handleToggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(
          SIDEBAR_COLLAPSED_STORAGE_KEY,
          String(next)
        );
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  const handleToggleRightPanelCollapsed = () => {
    setRightPanelCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(
          RIGHT_PANEL_COLLAPSED_STORAGE_KEY,
          String(next)
        );
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  const handleChangeRightPanelTab = (tab: RightPanelTab) => {
    setRightPanelTab(tab);
    try {
      window.localStorage.setItem(RIGHT_PANEL_TAB_STORAGE_KEY, tab);
    } catch {
      // Ignore storage errors
    }
  };

  const handleTogglePixelCollapsed = (nextCollapsed: boolean) => {
    setPixelCollapsed(nextCollapsed);
    try {
      window.localStorage.setItem(
        PIXEL_COLLAPSED_STORAGE_KEY,
        String(nextCollapsed)
      );
    } catch {
      // Ignore storage errors
    }
  };

  // Load saved data from IndexedDB once on startup & check server Gemini status
  useEffect(() => {
    let cancelled = false;

    geminiProvider
      .getStatus()
      .then((status) => {
        if (!cancelled) {
          setGeminiStatus(status);
          if (status.providersState) {
            setProvidersState(status.providersState);
          }
        }
      })
      .catch(() => {
        // Server status optional on initial load
      });

    async function hydrateFromIndexedDb() {
      setIsStorageLoading(true);
      try {
        const loaded = await storageProvider.initAndLoadWorkspace();
        if (cancelled) return;

        const orderedSessions = sortSessionsPinnedAndUpdatedDesc(
          loaded.sessions
        );
        setKnowledgeBase(loaded.knowledgeBase);
        knowledgeBaseRef.current = loaded.knowledgeBase;
        setUploadedDocuments(loaded.documents);
        uploadedDocumentsRef.current = loaded.documents;
        setSessions(orderedSessions);
        sessionsRef.current = orderedSessions;
        setCompanionMessages(loaded.companionMessages);
        companionMessagesRef.current = loaded.companionMessages;
        setCompanionMemory(loaded.companionMemory);
        setCompanionTasks(loaded.companionTasks);
        setCompanionPreferences(loaded.companionPreferences);

        const initialSchool = readInitialActiveSchool();
        const matchingSession = orderedSessions.find(
          (s) => s.schoolId === initialSchool && s.mode === 'marketer'
        );

        if (matchingSession) {
          setActiveSessionId(matchingSession.id);
        } else {
          setActiveSessionId(null);
        }
        setStorageError(null);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : 'Не удалось загрузить данные из локального хранилища IndexedDB.';
        setStorageError(message);
      } finally {
        if (!cancelled) {
          setIsStorageLoading(false);
        }
      }
    }

    hydrateFromIndexedDb();
    return () => {
      cancelled = true;
    };
  }, []);

  // Current active session matching school & mode
  const currentSession: ChatSession | null = useMemo(() => {
    if (!activeSessionId) return null;
    const found = sessions.find((s) => s.id === activeSessionId);
    if (!found) return null;
    if (found.schoolId !== activeSchool || found.mode !== activeAgentMode) {
      return null;
    }
    return found;
  }, [activeSessionId, sessions, activeSchool, activeAgentMode]);

  const syncSessionForContext = (
    targetSchool: SchoolId,
    targetMode: AgentMode,
    options?: { createIfMissing?: boolean }
  ) => {
    const currentSessions = sortSessionsPinnedAndUpdatedDesc(
      sessionsRef.current
    );
    const currentActive = activeSessionId
      ? currentSessions.find((s) => s.id === activeSessionId)
      : null;

    if (
      currentActive &&
      currentActive.schoolId === targetSchool &&
      currentActive.mode === targetMode
    ) {
      return;
    }

    const existingMatch = currentSessions.find(
      (s) => s.schoolId === targetSchool && s.mode === targetMode
    );

    if (existingMatch) {
      setActiveSessionId(existingMatch.id);
      return;
    }

    if (options?.createIfMissing) {
      const created = buildNewSession(
        targetMode,
        targetSchool,
        currentSessions
      );
      const nextList = sortSessionsPinnedAndUpdatedDesc([
        created,
        ...currentSessions,
      ]);
      sessionsRef.current = nextList;
      setSessions(nextList);
      setActiveSessionId(created.id);

      if (!isStorageLoading) {
        storageProvider.saveSession(created).catch((err) => {
          setStorageError(
            err instanceof Error
              ? err.message
              : 'Ошибка сохранения нового диалога в IndexedDB.'
          );
        });
      }
    } else {
      setActiveSessionId(null);
    }
  };

  const handleSelectSchool = (nextSchool: SchoolId) => {
    setActiveSchool(nextSchool);
    writeActiveSchoolToStorage(nextSchool);
    setDraftAttachment(null);
    syncSessionForContext(nextSchool, activeAgentMode);
  };

  const handleSelectSection = (section: NavSection) => {
    setActiveSection(section);
    if (isAgentModeSection(section)) {
      setActiveAgentMode(section);
      setDraftAttachment(null);
      syncSessionForContext(activeSchool, section);
    }
  };

  const handleChangeChatMode = (mode: AgentMode) => {
    setActiveAgentMode(mode);
    setActiveSection(mode);
    setDraftAttachment(null);
    syncSessionForContext(activeSchool, mode);
  };

  const handleCreateNewSession = (
    mode: AgentMode = activeAgentMode,
    school: SchoolId = activeSchool
  ) => {
    const currentSessions = sessionsRef.current;
    const newSession = buildNewSession(mode, school, currentSessions);
    const nextList = sortSessionsPinnedAndUpdatedDesc([
      newSession,
      ...currentSessions,
    ]);
    sessionsRef.current = nextList;
    setSessions(nextList);
    setActiveSessionId(newSession.id);
    setActiveSchool(school);
    writeActiveSchoolToStorage(school);
    setActiveAgentMode(mode);
    setActiveSection(mode);
    setDraftAttachment(null);

    if (!isStorageLoading) {
      storageProvider.saveSession(newSession).catch((err) => {
        setStorageError(
          err instanceof Error
            ? err.message
            : 'Не удалось сохранить созданный диалог в IndexedDB.'
        );
      });
    }
  };

  const handleSelectSession = (sessionId: string) => {
    const target = sessionsRef.current.find((s) => s.id === sessionId);
    if (!target) return;
    setActiveSessionId(target.id);
    setActiveSchool(target.schoolId);
    writeActiveSchoolToStorage(target.schoolId);
    setActiveAgentMode(target.mode);
    setActiveSection(target.mode);
    setDraftAttachment(null);
  };

  const handleRenameSession = async (
    sessionId: string,
    newTitle: string
  ): Promise<boolean> => {
    const trimmed = newTitle.trim();
    if (!trimmed || isStorageLoading) return false;

    const now = new Date();
    const updatedAt = formatTimeNow(now);
    const updatedAtMs = now.getTime();

    try {
      await storageProvider.renameSession(
        sessionId,
        trimmed,
        updatedAt,
        updatedAtMs
      );
      const nextList = sortSessionsPinnedAndUpdatedDesc(
        sessionsRef.current.map((s) =>
          s.id === sessionId
            ? { ...s, title: trimmed, updatedAt, updatedAtMs }
            : s
        )
      );
      sessionsRef.current = nextList;
      setSessions(nextList);
      setStorageError(null);
      return true;
    } catch (err) {
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Не удалось переименовать диалог в IndexedDB.'
      );
      return false;
    }
  };

  // Pin / Unpin dialogue WITHOUT changing updatedAt or updatedAtMs
  const handleTogglePinSession = async (
    sessionId: string,
    isPinned: boolean
  ): Promise<boolean> => {
    if (isStorageLoading) return false;
    try {
      await storageProvider.togglePinSession(sessionId, isPinned);
      const nextList = sortSessionsPinnedAndUpdatedDesc(
        sessionsRef.current.map((s) =>
          s.id === sessionId ? { ...s, isPinned } : s
        )
      );
      sessionsRef.current = nextList;
      setSessions(nextList);
      setStorageError(null);
      return true;
    } catch (err) {
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Не удалось закрепить/открепить диалог в IndexedDB.'
      );
      return false;
    }
  };

  const handleDeleteSession = async (sessionId: string): Promise<boolean> => {
    if (isStorageLoading) return false;
    try {
      await storageProvider.deleteSessionCascade(sessionId);

      const remaining = sortSessionsPinnedAndUpdatedDesc(
        sessionsRef.current.filter((s) => s.id !== sessionId)
      );
      sessionsRef.current = remaining;
      setSessions(remaining);

      if (sessionId === activeSessionId) {
        const sameContextMatch = remaining.find(
          (s) => s.schoolId === activeSchool && s.mode === activeAgentMode
        );
        if (sameContextMatch) {
          setActiveSessionId(sameContextMatch.id);
        } else {
          setActiveSessionId(null);
        }
      }
      setStorageError(null);
      return true;
    } catch (err) {
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Ошибка удаления диалога и сообщений из IndexedDB.'
      );
      return false;
    }
  };

  const handleClearCurrentSession = () => {
    if (!activeSessionId) return;
    const now = new Date();
    const updatedAt = formatTimeNow(now);
    const updatedAtMs = now.getTime();

    const nextList = sortSessionsPinnedAndUpdatedDesc(
      sessionsRef.current.map((s) =>
        s.id === activeSessionId
          ? { ...s, messages: [], attachments: [], updatedAt, updatedAtMs }
          : s
      )
    );
    sessionsRef.current = nextList;
    setSessions(nextList);
    setSelectedAttachmentId(null);

    if (!isStorageLoading) {
      storageProvider
        .clearSessionMessages(activeSessionId, updatedAt, updatedAtMs)
        .catch((err) => {
          setStorageError(
            err instanceof Error
              ? err.message
              : 'Ошибка очистки сообщений текущей сессии в IndexedDB.'
          );
        });
    }
  };

  // Parse chat file and open Preview & Confirmation Modal before attaching
  const prepareChatFileWithPreviewModal = async (
    file: File,
    target: 'draft' | 'dialogue'
  ) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const now = new Date();
    setIsParsingChatFile(true);
    setChatParsingStatus('queued');

    try {
      let dataUrl: string | undefined;
      if (
        DATA_URL_PREVIEW_EXTENSIONS.has(ext) &&
        file.size <= 5 * 1024 * 1024
      ) {
        try {
          dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
        } catch {
          dataUrl = undefined;
        }
      }

      let parsedResult: ParsedDocumentResult | null = null;
      let status: DocumentProcessingStatus = 'processed';
      let extractedText = '';
      let warning: string | undefined;
      let statusMessage: string | undefined;
      let pageCount: number | undefined;

      if (IMAGE_ONLY_EXTENSIONS.has(ext)) {
        status = 'processed';
        extractedText = '';
        warning =
          'Изображение готово к визуальному просмотру в материалах диалога. Распознавание текста (OCR) с изображений не используется.';
      } else {
        parsedResult = await documentProvider.parseFile(file, (nextStatus) => {
          setChatParsingStatus(nextStatus);
        });
        status = parsedResult.status;
        extractedText = parsedResult.extractedText;
        warning = parsedResult.warning;
        statusMessage = parsedResult.statusLabel;
        pageCount = parsedResult.pageCount;
      }

      const attachment: ChatAttachment = {
        id: `att-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        extension: ext,
        sizeBytes: file.size,
        extractedText,
        status,
        statusMessage,
        warning,
        pageCount,
        mimeType: file.type || undefined,
        createdAt: formatTimeNow(now),
        createdAtMs: now.getTime(),
        dataUrl,
      };

      setStagedChatFileModal({
        target,
        attachment,
        parsedResult,
      });
    } finally {
      setIsParsingChatFile(false);
      setChatParsingStatus(null);
    }
  };

  const handleStageFileForDraft = async (file: File) => {
    await prepareChatFileWithPreviewModal(file, 'draft');
  };

  const handleRequestStageDialogueFile = async (file: File) => {
    await prepareChatFileWithPreviewModal(file, 'dialogue');
  };

  const handleConfirmStagedChatFile = () => {
    if (!stagedChatFileModal) return;
    const { target, attachment } = stagedChatFileModal;
    setStagedChatFileModal(null);

    if (target === 'draft') {
      setDraftAttachment(attachment);
      setSelectedAttachmentId(attachment.id);
      handleChangeRightPanelTab('preview');
      return;
    }

    // Attach to current dialogue (and draft so user can immediately send or inspect)
    const currentSessions = sessionsRef.current;
    const existingTarget = activeSessionId
      ? currentSessions.find((s) => s.id === activeSessionId) || null
      : null;

    const canUseExisting =
      existingTarget !== null &&
      existingTarget.schoolId === activeSchool &&
      existingTarget.mode === activeAgentMode;

    if (!canUseExisting || !existingTarget) {
      const created = buildNewSession(
        activeAgentMode,
        activeSchool,
        currentSessions
      );
      const withAttachment: ChatSession = {
        ...created,
        attachments: [attachment],
      };
      const nextList = sortSessionsPinnedAndUpdatedDesc([
        withAttachment,
        ...currentSessions,
      ]);
      sessionsRef.current = nextList;
      setSessions(nextList);
      setActiveSessionId(withAttachment.id);
      setDraftAttachment(attachment);
      setSelectedAttachmentId(attachment.id);
      handleChangeRightPanelTab('preview');

      if (!isStorageLoading) {
        storageProvider.saveSession(withAttachment).catch((err) => {
          setStorageError(
            err instanceof Error
              ? err.message
              : 'Не удалось сохранить диалог с вложением в IndexedDB.'
          );
        });
      }
      return;
    }

    const now = new Date();
    const updatedAt = formatTimeNow(now);
    const updatedAtMs = now.getTime();
    const updatedAttachments = [
      attachment,
      ...(existingTarget.attachments || []).filter(
        (a) => a.id !== attachment.id
      ),
    ];

    const updatedSession: ChatSession = {
      ...existingTarget,
      attachments: updatedAttachments,
      updatedAt,
      updatedAtMs,
    };

    const nextList = sortSessionsPinnedAndUpdatedDesc([
      updatedSession,
      ...currentSessions.filter((s) => s.id !== existingTarget.id),
    ]);
    sessionsRef.current = nextList;
    setSessions(nextList);
    setDraftAttachment(attachment);
    setSelectedAttachmentId(attachment.id);
    handleChangeRightPanelTab('preview');

    if (!isStorageLoading) {
      storageProvider
        .addSessionAttachment(
          existingTarget.id,
          attachment,
          updatedAt,
          updatedAtMs
        )
        .catch((err) => {
          setStorageError(
            err instanceof Error
              ? err.message
              : 'Не удалось сохранить файл диалога в IndexedDB.'
          );
        });
    }
  };

  const handleRemoveAttachmentFromDialogue = async (
    sessionId: string,
    attachmentId: string
  ) => {
    if (isStorageLoading) return;
    const now = new Date();
    const updatedAt = formatTimeNow(now);
    const updatedAtMs = now.getTime();

    try {
      await storageProvider.removeSessionAttachment(
        sessionId,
        attachmentId,
        updatedAt,
        updatedAtMs
      );

      const nextList = sortSessionsPinnedAndUpdatedDesc(
        sessionsRef.current.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            attachments: (s.attachments || []).filter(
              (a) => a.id !== attachmentId
            ),
            messages: s.messages.map((m) =>
              m.attachmentMeta?.id === attachmentId
                ? { ...m, attachmentName: undefined, attachmentMeta: undefined }
                : m
            ),
            updatedAt,
            updatedAtMs,
          };
        })
      );
      sessionsRef.current = nextList;
      setSessions(nextList);

      if (draftAttachment?.id === attachmentId) {
        setDraftAttachment(null);
      }
      if (selectedAttachmentId === attachmentId) {
        setSelectedAttachmentId(null);
      }
      setStorageError(null);
    } catch (err) {
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Не удалось удалить файл из диалога в IndexedDB.'
      );
    }
  };

  const handleInspectAttachmentInRightPanel = (attachmentId: string) => {
    setSelectedAttachmentId(attachmentId);
    handleChangeRightPanelTab('preview');
    if (rightPanelCollapsed) {
      handleToggleRightPanelCollapsed();
    }
    setRightPanelMobileOpen(true);
  };

  const handleJumpToSearchResult = (sessionId: string, messageId?: string) => {
    const target = sessionsRef.current.find((s) => s.id === sessionId);
    if (!target) return;

    setActiveSessionId(target.id);
    setActiveSchool(target.schoolId);
    writeActiveSchoolToStorage(target.schoolId);
    setActiveAgentMode(target.mode);
    setActiveSection(target.mode);
    setRightPanelMobileOpen(false);

    if (messageId) {
      setHighlightedMessageId(messageId);
      setTimeout(() => {
        setHighlightedMessageId((prev) =>
          prev === messageId ? null : prev
        );
      }, 3200);
    }
  };

  const handleStopGeneration = () => {
    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
      chatAbortRef.current = null;
    }
  };

  const handleSendMessage = async (
    text: string,
    attachment: ChatAttachment | null,
    contextOptions: SendMessageContextOptions
  ) => {
    if (isGeneratingChat) return;

    const currentSessions = sessionsRef.current;
    const existingTarget = activeSessionId
      ? currentSessions.find((s) => s.id === activeSessionId) || null
      : null;

    // Ensure we never overwrite schoolId/mode of an incompatible session
    const canUseExisting =
      existingTarget !== null &&
      existingTarget.schoolId === activeSchool &&
      existingTarget.mode === activeAgentMode;

    const targetSchool: SchoolId = canUseExisting
      ? existingTarget.schoolId
      : activeSchool;
    const targetMode: AgentMode = canUseExisting
      ? existingTarget.mode
      : activeAgentMode;

    const baseSession: ChatSession =
      canUseExisting && existingTarget
        ? existingTarget
        : buildNewSession(targetMode, targetSchool, currentSessions);

    const schoolCfg = SCHOOLS[targetSchool];
    const modeCfg = AGENT_MODES[targetMode];

    const nowUser = new Date();
    const nowUserMs = nowUser.getTime();
    const nowAssistantMs = nowUserMs + 1;

    const userMsgId = `msg-user-${nowUserMs}-${Math.random().toString(36).slice(2, 6)}`;
    const assistantMsgId = `msg-assistant-${nowAssistantMs}-${Math.random().toString(36).slice(2, 6)}`;

    const linkedAttachment: ChatAttachment | null = attachment
      ? {
          ...attachment,
          messageId: userMsgId,
        }
      : null;

    const userMsg: ChatMessage = {
      id: userMsgId,
      sessionId: baseSession.id,
      role: 'user',
      content: text,
      createdAt: formatTimeNow(nowUser),
      createdAtMs: nowUserMs,
      schoolId: targetSchool,
      mode: targetMode,
      attachmentName: linkedAttachment?.name,
      attachmentMeta: linkedAttachment
        ? {
            id: linkedAttachment.id,
            name: linkedAttachment.name,
            extension: linkedAttachment.extension,
            sizeBytes: linkedAttachment.sizeBytes,
            mimeType: linkedAttachment.mimeType,
            createdAt: linkedAttachment.createdAt,
            status: linkedAttachment.status,
          }
        : undefined,
    };

    // Prepare strictly isolated active-school Knowledge Base & explicitly selected documents
    const kbContext = documentProvider.prepareKnowledgeContextForSchool(
      targetSchool,
      knowledgeBase,
      contextOptions.includeKnowledgeBase
    );

    const { sendableDocuments, skippedNoTextDocuments } =
      documentProvider.prepareSelectedDocumentsForApi({
        draftAttachment: linkedAttachment,
        dialogueAttachments: baseSession.attachments || [],
        selectedDialogueAttachmentIds:
          contextOptions.selectedDialogueAttachmentIds,
        schoolDocuments: uploadedDocuments,
        selectedSchoolDocumentIds: contextOptions.selectedSchoolDocumentIds,
        activeSchool: targetSchool,
      });

    const usedContextSummary: string[] = [
      `Школа: ${schoolCfg.name}`,
      `Роль: ${modeCfg.shortTitle}`,
    ];
    if (kbContext.length > 0) {
      usedContextSummary.push(
        `База знаний ${schoolCfg.name} (${kbContext.length} разд.)`
      );
    }
    for (const doc of sendableDocuments) {
      usedContextSummary.push(`Документ: «${doc.name}»`);
    }
    for (const skippedName of skippedNoTextDocuments) {
      usedContextSummary.push(`Без текстового слоя: «${skippedName}»`);
    }

    const initialAssistantReply: ChatMessage = {
      id: assistantMsgId,
      sessionId: baseSession.id,
      role: 'assistant',
      createdAt: formatTimeNow(new Date(nowAssistantMs)),
      createdAtMs: nowAssistantMs,
      schoolId: targetSchool,
      mode: targetMode,
      content: '',
      usedContextSummary,
      isStreaming: true,
      modelName: geminiStatus?.model || 'gemini-3.8-flash',
    };

    const nextTitleFromText =
      text.slice(0, 46) + (text.length > 46 ? '…' : '');

    const existingAttachments = baseSession.attachments || [];
    const mergedAttachments = linkedAttachment
      ? [
          linkedAttachment,
          ...existingAttachments.filter((a) => a.id !== linkedAttachment.id),
        ]
      : existingAttachments;

    const initialUpdatedSession: ChatSession = {
      ...baseSession,
      title:
        baseSession.messages.length === 0
          ? nextTitleFromText
          : baseSession.title,
      updatedAt: formatTimeNow(new Date(nowAssistantMs)),
      updatedAtMs: nowAssistantMs,
      messages: [...baseSession.messages, userMsg, initialAssistantReply],
      attachments: mergedAttachments,
    };

    lastRetryPayloadRef.current[initialUpdatedSession.id] = {
      text,
      attachment: linkedAttachment,
      contextOptions,
    };

    let nextList: ChatSession[];
    if (canUseExisting && existingTarget) {
      nextList = sortSessionsPinnedAndUpdatedDesc([
        initialUpdatedSession,
        ...currentSessions.filter((s) => s.id !== existingTarget.id),
      ]);
    } else {
      nextList = sortSessionsPinnedAndUpdatedDesc([
        initialUpdatedSession,
        ...currentSessions,
      ]);
      setActiveSessionId(initialUpdatedSession.id);
    }

    sessionsRef.current = nextList;
    setSessions(nextList);

    if (linkedAttachment) {
      setSelectedAttachmentId(linkedAttachment.id);
    }

    // Save user message immediately to IndexedDB (without storing a stuck isStreaming=true placeholder)
    if (!isStorageLoading) {
      storageProvider
        .saveSessionAndMessages(initialUpdatedSession, [
          userMsg,
          {
            ...initialAssistantReply,
            isStreaming: false,
            content: '[Запрос прерван до завершения ответа]',
          },
        ])
        .catch(() => {
          // Will retry on completion
        });
    }

    const abortController = new AbortController();
    chatAbortRef.current = abortController;
    setIsGeneratingChat(true);
    setGeneratingSessionId(initialUpdatedSession.id);
    setChatGenerationStage('connecting');
    setChatSlowWarning(false);

    const updateAssistantMessageInSession = (
      patch: Partial<ChatMessage>,
      persistToDb: boolean
    ) => {
      const targetSess = sessionsRef.current.find(
        (s) => s.id === initialUpdatedSession.id
      );
      if (!targetSess) return;

      let updatedAssistantMsg: ChatMessage | null = null;
      const updatedMessages = targetSess.messages.map((m) => {
        if (m.id === assistantMsgId) {
          updatedAssistantMsg = { ...m, ...patch };
          return updatedAssistantMsg;
        }
        return m;
      });

      const nextSess: ChatSession = {
        ...targetSess,
        messages: updatedMessages,
      };

      const updatedSessionsList = sortSessionsPinnedAndUpdatedDesc([
        nextSess,
        ...sessionsRef.current.filter((s) => s.id !== nextSess.id),
      ]);
      sessionsRef.current = updatedSessionsList;
      setSessions(updatedSessionsList);

      if (persistToDb && updatedAssistantMsg && !isStorageLoading) {
        storageProvider
          .saveSessionAndMessages(nextSess, [userMsg, updatedAssistantMsg])
          .catch((err) => {
            setStorageError(
              err instanceof Error
                ? err.message
                : 'Не удалось сохранить ответ специалиста в IndexedDB.'
            );
          });
      }
    };

    try {
      const historyForApi = [...baseSession.messages.slice(-12), userMsg].map(
        (m) => ({
          role: m.role,
          content: m.content,
        })
      );

      const result = await geminiProvider.streamChat({
        schoolId: targetSchool,
        mode: targetMode,
        sessionId: initialUpdatedSession.id,
        messages: historyForApi,
        selectedDocuments: sendableDocuments,
        knowledgeBaseContext: kbContext,
        externalApiConsentConfirmed:
          contextOptions.externalApiConsentConfirmed,
        consentedProviders: contextOptions.consentedProviders,
        providerSelection:
          contextOptions.providerSelection || providerSelection,
        signal: abortController.signal,
        onStageChange: (stage) => {
          setChatGenerationStage(stage);
        },
        onSlowWarning: () => {
          setChatSlowWarning(true);
        },
        onDelta: (_delta, accumulated) => {
          updateAssistantMessageInSession(
            {
              content: accumulated,
              isStreaming: true,
            },
            false
          );
        },
      });

      const finalContent = result.aborted
        ? result.text.trim()
          ? `${result.text.trim()}\n\n[Генерация остановлена управляющей]`
          : '[Генерация ответа остановлена управляющей]'
        : result.text.trim() || 'Ответ от модели получен (пустой текст).';

      updateAssistantMessageInSession(
        {
          content: finalContent,
          isStreaming: false,
          isError: false,
          modelName: result.model,
          providerId: result.providerId,
          providerLabel: result.providerLabel,
          failoverNotice: result.failoverNotice,
        },
        true
      );
      setPendingFallbackConsentPrompt(null);
      aiProviderManager
        .getProvidersState()
        .then((st) => setProvidersState(st))
        .catch(() => {});
    } catch (err) {
      if (err instanceof ProviderDocumentConsentRequiredError) {
        setPendingFallbackConsentPrompt({
          sessionId: initialUpdatedSession.id,
          targetProvider: err.targetProvider,
          targetProviderLabel: err.targetProviderLabel,
          failedProvider: err.failedProvider,
          failedReason: err.failedReason,
        });
      }
      const errorMsg =
        err instanceof Error
          ? err.message
          : 'Не удалось получить ответ от серверного маршрута ИИ-провайдера.';
      updateAssistantMessageInSession(
        {
          content: `Ошибка запроса: ${errorMsg}`,
          isStreaming: false,
          isError: true,
          consentRequiredFallbackProvider:
            err instanceof ProviderDocumentConsentRequiredError
              ? err.targetProvider
              : undefined,
        },
        true
      );
      setRestoredDraft({ id: Date.now(), text });
      aiProviderManager
        .getProvidersState()
        .then((st) => setProvidersState(st))
        .catch(() => {});
    } finally {
      // Guarantee no message in the target session remains stuck with isStreaming=true
      const checkSess = sessionsRef.current.find(
        (s) => s.id === initialUpdatedSession.id
      );
      if (checkSess?.messages.some((m) => m.id === assistantMsgId && m.isStreaming)) {
        updateAssistantMessageInSession({ isStreaming: false }, true);
      }
      chatAbortRef.current = null;
      setIsGeneratingChat(false);
      setGeneratingSessionId(null);
      setChatGenerationStage(null);
      setChatSlowWarning(false);
    }
  };

  const handleConfirmFallbackDocumentConsent = () => {
    if (!pendingFallbackConsentPrompt || isGeneratingChat) return;
    const targetSessionId = pendingFallbackConsentPrompt.sessionId;
    const targetProvider = pendingFallbackConsentPrompt.targetProvider;
    const savedPayload = lastRetryPayloadRef.current[targetSessionId];
    if (!savedPayload) {
      setPendingFallbackConsentPrompt(null);
      return;
    }

    const prevConsented = savedPayload.contextOptions.consentedProviders || [
      'gemini',
    ];
    const nextConsented: AIProviderId[] = prevConsented.includes(targetProvider)
      ? prevConsented
      : [...prevConsented, targetProvider];

    lastRetryPayloadRef.current[targetSessionId] = {
      ...savedPayload,
      contextOptions: {
        ...savedPayload.contextOptions,
        externalApiConsentConfirmed: true,
        consentedProviders: nextConsented,
      },
    };
    setPendingFallbackConsentPrompt(null);
    handleRetryLastMessage();
  };

  const handleRetryLastMessage = () => {
    if (isGeneratingChat || !activeSessionId) return;
    const targetSess = sessionsRef.current.find(
      (s) => s.id === activeSessionId
    );
    if (!targetSess || targetSess.messages.length === 0) return;

    const savedPayload = lastRetryPayloadRef.current[activeSessionId];
    const lastMessages = targetSess.messages;
    const lastAssistantIdx = lastMessages.length - 1;
    const lastAssistant = lastMessages[lastAssistantIdx];
    const precedingUser =
      lastAssistantIdx >= 1 ? lastMessages[lastAssistantIdx - 1] : null;

    const retryText =
      savedPayload?.text ||
      (precedingUser?.role === 'user' ? precedingUser.content : '');
    if (!retryText.trim()) return;

    const retryAttachment = savedPayload?.attachment || null;
    const retryContextOptions: SendMessageContextOptions =
      savedPayload?.contextOptions || {
        includeKnowledgeBase: true,
        selectedDialogueAttachmentIds: retryAttachment
          ? [retryAttachment.id]
          : [],
        selectedSchoolDocumentIds: [],
        externalApiConsentConfirmed: Boolean(retryAttachment),
      };

    // Strip the failed/stopped assistant bubble and its immediately preceding user message before re-sending
    if (
      lastAssistant &&
      lastAssistant.role === 'assistant' &&
      (lastAssistant.isError ||
        lastAssistant.content.includes('[Генерация ответа остановлена') ||
        lastAssistant.content.includes('[Генерация остановлена'))
    ) {
      const stripCount = precedingUser?.role === 'user' ? 2 : 1;
      const trimmedSession: ChatSession = {
        ...targetSess,
        messages: targetSess.messages.slice(0, -stripCount),
      };
      const updatedList = sortSessionsPinnedAndUpdatedDesc([
        trimmedSession,
        ...sessionsRef.current.filter((s) => s.id !== trimmedSession.id),
      ]);
      sessionsRef.current = updatedList;
      setSessions(updatedList);
      if (!isStorageLoading) {
        storageProvider
          .clearSessionMessages(
            trimmedSession.id,
            trimmedSession.updatedAt,
            trimmedSession.updatedAtMs ?? Date.now()
          )
          .then(() =>
            storageProvider.saveSessionAndMessages(
              trimmedSession,
              trimmedSession.messages
            )
          )
          .catch(() => {
            // Ignore transient cleanup error
          });
      }
    }

    if (restoredDraft?.text === retryText) {
      setRestoredDraft({ id: Date.now(), text: '' });
    }

    void handleSendMessage(retryText, retryAttachment, retryContextOptions);
  };

  const handleUpdateKnowledgeCategory = async (
    schoolId: SchoolId,
    categoryKey: KnowledgeCategoryKey,
    value: string
  ): Promise<boolean> => {
    if (isStorageLoading) return false;
    try {
      await storageProvider.saveKnowledgeCategory(schoolId, categoryKey, value);
      setKnowledgeBase((prev) => ({
        ...prev,
        [schoolId]: {
          ...prev[schoolId],
          [categoryKey]: value,
        },
      }));
      setStorageError(null);
      return true;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Ошибка при записи категории Базы знаний в IndexedDB.';
      setStorageError(msg);
      return false;
    }
  };

  // Save verified document to school's Knowledge Base + optional category update
  const handleSaveVerifiedDocument = async (
    doc: UploadedDocumentRecord,
    categoryUpdate?: {
      schoolId: SchoolId;
      categoryKey: KnowledgeCategoryKey;
      nextCategoryText: string;
    }
  ): Promise<boolean> => {
    if (isStorageLoading) return false;
    try {
      await storageProvider.saveDocument(doc);
      if (categoryUpdate) {
        await storageProvider.saveKnowledgeCategory(
          categoryUpdate.schoolId,
          categoryUpdate.categoryKey,
          categoryUpdate.nextCategoryText
        );
        setKnowledgeBase((prev) => ({
          ...prev,
          [categoryUpdate.schoolId]: {
            ...prev[categoryUpdate.schoolId],
            [categoryUpdate.categoryKey]: categoryUpdate.nextCategoryText,
          },
        }));
      }

      setUploadedDocuments((prev) =>
        [doc, ...prev.filter((d) => d.id !== doc.id)].sort(
          (a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0)
        )
      );

      const catTitle =
        KNOWLEDGE_CATEGORIES.find((c) => c.key === doc.categoryKey)?.title ||
        doc.categoryKey;
      setKnowledgeBanner(
        categoryUpdate
          ? `Документ «${doc.name}» (${SCHOOLS[doc.schoolId].name}) успешно сохранён в IndexedDB, а раздел «${catTitle}» обновлён.`
          : `Документ «${doc.name}» (${SCHOOLS[doc.schoolId].name}) сохранён в списке документов школы (раздел «${catTitle}»).`
      );
      setStorageError(null);
      return true;
    } catch (err) {
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Не удалось сохранить документ Базы знаний в IndexedDB.'
      );
      return false;
    }
  };

  const handleDeleteDocument = async (docId: string): Promise<boolean> => {
    if (isStorageLoading) return false;
    try {
      const target = uploadedDocuments.find((d) => d.id === docId);
      await storageProvider.deleteDocument(docId);
      setUploadedDocuments((prev) => prev.filter((d) => d.id !== docId));
      if (target) {
        setKnowledgeBanner(
          `Документ «${target.name}» удалён из хранилища школы ${SCHOOLS[target.schoolId].name}.`
        );
      }
      setStorageError(null);
      return true;
    } catch (err) {
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Не удалось удалить документ из IndexedDB.'
      );
      return false;
    }
  };

  // Full JSON backup export
  const handleTriggerExportBackup = async () => {
    if (isStorageLoading) return;
    try {
      const archive = await storageProvider.exportBackup({
        activeSchool,
        sidebarCollapsed,
        rightPanelCollapsed,
        rightPanelTab,
      });

      const jsonText = JSON.stringify(archive, null, 2);
      const blob = new Blob([jsonText], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const filename = buildBackupFilename(new Date());

      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      setKnowledgeBanner(
        `Резервная копия «${filename}» успешно сформирована и скачана (диалогов: ${archive.data.sessions.length}, документов школ: ${archive.data.documents.length}, задач Пикселя: ${(archive.data.companionTasks || []).length}, фактов памяти: ${(archive.data.companionMemory || []).length}).`
      );
      setStorageError(null);
    } catch (err) {
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Не удалось сформировать резервную копию из IndexedDB.'
      );
    }
  };

  // Validate backup file first, then show confirmation modal before overwriting
  const handleTriggerImportBackup = async (file: File) => {
    if (isStorageLoading) return;
    try {
      const rawText = await file.text();
      const validated = storageProvider.validateBackupJson(rawText);
      setPendingBackupRestore(validated);
      setStorageError(null);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Файл резервной копии повреждён или не соответствует формату приложения.';
      setStorageError(
        `Импорт отклонён (существующие данные не изменены): ${msg}`
      );
    }
  };

  const handleConfirmRestoreBackup = async () => {
    if (!pendingBackupRestore || isRestoringBackup) return;
    setIsRestoringBackup(true);
    try {
      const loaded = await storageProvider.restoreBackup(
        pendingBackupRestore.archive
      );
      const orderedSessions = sortSessionsPinnedAndUpdatedDesc(loaded.sessions);

      setKnowledgeBase(loaded.knowledgeBase);
      setUploadedDocuments(loaded.documents);
      setSessions(orderedSessions);
      sessionsRef.current = orderedSessions;
      setCompanionMessages(loaded.companionMessages);
      setCompanionMemory(loaded.companionMemory);
      setCompanionTasks(loaded.companionTasks);
      setCompanionPreferences(loaded.companionPreferences);
      setDraftAttachment(null);
      setSelectedAttachmentId(null);

      // Restore workspace settings if present
      const ws = pendingBackupRestore.archive.workspaceSettings;
      const nextSchool: SchoolId =
        ws?.activeSchool === 'kiberone' || ws?.activeSchool === 'renderia'
          ? ws.activeSchool
          : activeSchool;

      setActiveSchool(nextSchool);
      writeActiveSchoolToStorage(nextSchool);

      if (typeof ws?.sidebarCollapsed === 'boolean') {
        setSidebarCollapsed(ws.sidebarCollapsed);
        try {
          window.localStorage.setItem(
            SIDEBAR_COLLAPSED_STORAGE_KEY,
            String(ws.sidebarCollapsed)
          );
        } catch {
          // ignore
        }
      }

      if (typeof ws?.rightPanelCollapsed === 'boolean') {
        setRightPanelCollapsed(ws.rightPanelCollapsed);
        try {
          window.localStorage.setItem(
            RIGHT_PANEL_COLLAPSED_STORAGE_KEY,
            String(ws.rightPanelCollapsed)
          );
        } catch {
          // ignore
        }
      }

      if (
        ws?.rightPanelTab === 'materials' ||
        ws?.rightPanelTab === 'preview' ||
        ws?.rightPanelTab === 'search' ||
        ws?.rightPanelTab === 'context'
      ) {
        setRightPanelTab(ws.rightPanelTab);
        try {
          window.localStorage.setItem(
            RIGHT_PANEL_TAB_STORAGE_KEY,
            ws.rightPanelTab
          );
        } catch {
          // ignore
        }
      }

      const targetMode = isAgentModeSection(activeSection)
        ? activeSection
        : activeAgentMode;
      const matchingSession = orderedSessions.find(
        (s) => s.schoolId === nextSchool && s.mode === targetMode
      );
      setActiveSessionId(matchingSession ? matchingSession.id : null);

      setKnowledgeBanner(
        `Данные успешно восстановлены из резервной копии: диалогов — ${orderedSessions.length}, сообщений — ${pendingBackupRestore.messagesCount}, документов школ — ${loaded.documents.length}, задач Пикселя — ${loaded.companionTasks.length}, фактов памяти — ${loaded.companionMemory.length}.`
      );
      setPendingBackupRestore(null);
      setStorageError(null);
    } catch (err) {
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Ошибка транзакции восстановления резервной копии в IndexedDB.'
      );
    } finally {
      setIsRestoringBackup(false);
    }
  };

  // Pixel Companion IndexedDB v3 persistence handlers
  const handleSaveCompanionMessages = async (messages: CompanionMessage[]) => {
    const ordered = [...messages].sort((a, b) => a.createdAtMs - b.createdAtMs);
    companionMessagesRef.current = ordered;
    setCompanionMessages(ordered);
    if (isStorageLoading) return;
    try {
      await storageProvider.saveCompanionMessages(ordered);
      setStorageError(null);
    } catch (err) {
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Не удалось сохранить сообщения Пикселя в IndexedDB.'
      );
    }
  };

  const handleClearCompanionMessages = async () => {
    if (isStorageLoading) return;
    try {
      const greeting = createInitialCompanionGreetingMessage();
      await storageProvider.clearCompanionMessages(greeting);
      setCompanionMessages([greeting]);
      setStorageError(null);
    } catch (err) {
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Не удалось очистить переписку с Пикселем в IndexedDB.'
      );
    }
  };

  const handleSaveCompanionMemory = async (record: CompanionMemoryRecord) => {
    setCompanionMemory((prev) =>
      [record, ...prev.filter((m) => m.id !== record.id)].sort(
        (a, b) => b.updatedAtMs - a.updatedAtMs
      )
    );
    if (isStorageLoading) return;
    try {
      await storageProvider.saveCompanionMemory(record);
      setStorageError(null);
    } catch (err) {
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Не удалось сохранить запись памяти об Анне в IndexedDB.'
      );
    }
  };

  const handleDeleteCompanionMemory = async (id: string) => {
    setCompanionMemory((prev) => prev.filter((m) => m.id !== id));
    if (isStorageLoading) return;
    try {
      await storageProvider.deleteCompanionMemory(id);
      setStorageError(null);
    } catch (err) {
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Не удалось удалить запись памяти в IndexedDB.'
      );
    }
  };

  const handleClearAllCompanionMemory = async () => {
    setCompanionMemory([]);
    if (isStorageLoading) return;
    try {
      await storageProvider.clearAllCompanionMemory();
      setStorageError(null);
    } catch (err) {
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Не удалось очистить память Пикселя в IndexedDB.'
      );
    }
  };

  const handleSaveCompanionTask = async (task: CompanionTaskRecord) => {
    setCompanionTasks((prev) =>
      [task, ...prev.filter((t) => t.id !== task.id)].sort((a, b) => {
        if (a.status === 'done' && b.status !== 'done') return 1;
        if (a.status !== 'done' && b.status === 'done') return -1;
        return b.createdAtMs - a.createdAtMs;
      })
    );
    if (isStorageLoading) return;
    try {
      await storageProvider.saveCompanionTask(task);
      setStorageError(null);
    } catch (err) {
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Не удалось сохранить задачу Анны в IndexedDB.'
      );
    }
  };

  const handleDeleteCompanionTask = async (taskId: string) => {
    setCompanionTasks((prev) => prev.filter((t) => t.id !== taskId));
    if (isStorageLoading) return;
    try {
      await storageProvider.deleteCompanionTask(taskId);
      setStorageError(null);
    } catch (err) {
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Не удалось удалить задачу из IndexedDB.'
      );
    }
  };

  const handleSaveCompanionPreferences = async (
    prefs: CompanionPreferencesRecord
  ) => {
    setCompanionPreferences(prefs);
    if (isStorageLoading) return;
    try {
      await storageProvider.saveCompanionPreferences(prefs);
      setStorageError(null);
    } catch (err) {
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Не удалось сохранить настройки Пикселя в IndexedDB.'
      );
    }
  };

  const filledCategoriesCount: Record<SchoolId, number> = {
    kiberone: KNOWLEDGE_CATEGORIES.filter(
      (c) => knowledgeBase.kiberone[c.key]?.trim().length > 0
    ).length,
    renderia: KNOWLEDGE_CATEGORIES.filter(
      (c) => knowledgeBase.renderia[c.key]?.trim().length > 0
    ).length,
  };

  const currentDialogueFilesCount =
    (currentSession?.attachments?.length || 0) +
    (draftAttachment &&
    !(currentSession?.attachments || []).some(
      (a) => a.id === draftAttachment.id
    )
      ? 1
      : 0);

  return (
    <div className="min-h-screen flex bg-[#F9FAFB] text-slate-900">
      {/* 1. LEFT PANEL: Navigation, Specialists, Dialogue History, App Sections */}
      <Sidebar
        activeSection={activeSection}
        activeSchool={activeSchool}
        activeAgentMode={activeAgentMode}
        onSelectSection={handleSelectSection}
        onSelectSchool={handleSelectSchool}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onCreateNewSession={handleCreateNewSession}
        onRenameSession={handleRenameSession}
        onTogglePinSession={handleTogglePinSession}
        onDeleteSession={handleDeleteSession}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={handleToggleSidebarCollapsed}
        filledCategoriesCount={filledCategoriesCount}
        totalCategoriesCount={KNOWLEDGE_CATEGORIES.length}
      />

      {/* 2. CENTER PANEL: Active Dialogue or Selected App Section */}
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          activeSection={activeSection}
          activeSchool={activeSchool}
          onSelectSchool={handleSelectSchool}
          onSelectSection={handleSelectSection}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onToggleRightPanel={() => {
            if (window.innerWidth < 1280) {
              setRightPanelMobileOpen((v) => !v);
            } else {
              handleToggleRightPanelCollapsed();
            }
          }}
          rightPanelOpen={!rightPanelCollapsed}
          dialogueFilesCount={currentDialogueFilesCount}
          onOpenLiveVoice={() => {
            voiceManager.stopAll();
            setIsLiveVoiceFromWakeWord(false);
            setIsLiveVoiceOpen(true);
          }}
          onOpenVoiceSettings={() => setIsVoiceSettingsOpen(true)}
          onOpenVoiceDiagnostics={() => setIsVoiceDiagnosticsOpen(true)}
          isWakeWordListening={
            wakeWordState === 'standby_listening' ||
            wakeWordState === 'hearing_speech'
          }
          wakeWordState={wakeWordState}
          wakeWordDetail={wakeWordDetail}
          onToggleWakeWord={handleToggleWakeWord}
        />

        {/* IndexedDB / Validation Error Notification Banner */}
        {storageError && (
          <div className="max-w-5xl w-full mx-auto px-4 sm:px-6 pt-3">
            <div className="rounded-xl px-4 py-3 bg-red-50 border border-red-200 text-red-900 text-xs flex items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span className="font-medium">{storageError}</span>
              </div>
              <button
                type="button"
                onClick={() => setStorageError(null)}
                className="p-1 rounded-lg text-red-700 hover:bg-red-100 shrink-0"
                aria-label="Скрыть уведомление об ошибке"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <main className="flex-1 flex flex-col min-w-0">
          {isStorageLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-8">
              <div className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-[#00A8B5] shadow-xs">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
              <div className="font-display font-bold text-base text-slate-900 flex items-center gap-2">
                <Database className="w-4 h-4 text-[#F5B800]" />
                <span>
                  Загрузка данных из локального хранилища IndexedDB...
                </span>
              </div>
              <p className="text-xs text-slate-500 max-w-md">
                Восстанавливаем сохранённые диалоги, сообщения, файлы чатов,
                документы и разделы Базы знаний для школ KIBERone и Renderia.
              </p>
            </div>
          ) : (
            <>
              {activeSection === 'home' && (
                <HomeView
                  activeSchool={activeSchool}
                  onSelectSchool={handleSelectSchool}
                  onNavigate={handleSelectSection}
                  onOpenSession={(sess) => handleSelectSession(sess.id)}
                  onStartNewChat={() =>
                    handleCreateNewSession(activeAgentMode, activeSchool)
                  }
                  sessions={sessions}
                  knowledgeBase={knowledgeBase}
                />
              )}

              {isAgentModeSection(activeSection) && (
                <UnifiedChatView
                  activeMode={activeAgentMode}
                  activeSchool={activeSchool}
                  onChangeMode={handleChangeChatMode}
                  onChangeSchool={handleSelectSchool}
                  onNavigate={handleSelectSection}
                  sessions={sessions}
                  activeSessionId={activeSessionId}
                  onSelectSession={handleSelectSession}
                  onCreateNewSession={handleCreateNewSession}
                  onSendMessage={handleSendMessage}
                  onRetryLastMessage={handleRetryLastMessage}
                  onStopGeneration={handleStopGeneration}
                  isGenerating={isGeneratingChat}
                  generatingSessionId={generatingSessionId}
                  generationStage={chatGenerationStage}
                  generationElapsedSec={chatGenerationElapsedSec}
                  isSlowGeneration={chatSlowWarning}
                  restoredDraft={restoredDraft}
                  geminiStatus={geminiStatus}
                  providerSelection={providerSelection}
                  onChangeProviderSelection={handleChangeProviderSelection}
                  providersState={providersState}
                  onCheckProvidersOnDemand={handleCheckProvidersOnDemand}
                  isCheckingProviders={isCheckingProviders}
                  pendingFallbackConsentPrompt={pendingFallbackConsentPrompt}
                  onConfirmFallbackDocumentConsent={
                    handleConfirmFallbackDocumentConsent
                  }
                  onDismissFallbackDocumentConsent={() =>
                    setPendingFallbackConsentPrompt(null)
                  }
                  onClearCurrentSession={handleClearCurrentSession}
                  onDeleteSession={handleDeleteSession}
                  onRenameSession={handleRenameSession}
                  onTogglePinSession={handleTogglePinSession}
                  knowledgeBase={knowledgeBase}
                  uploadedDocuments={uploadedDocuments}
                  draftAttachment={draftAttachment}
                  onStageFileForDraft={handleStageFileForDraft}
                  onClearDraftAttachment={() => setDraftAttachment(null)}
                  onInspectAttachmentInRightPanel={
                    handleInspectAttachmentInRightPanel
                  }
                  highlightedMessageId={highlightedMessageId}
                  isParsingFile={isParsingChatFile}
                  parsingStatusLabel={
                    chatParsingStatus
                      ? documentProvider.getStatusLabel(chatParsingStatus)
                      : null
                  }
                  onOpenVoiceSettings={() => setIsVoiceSettingsOpen(true)}
                />
              )}

              {activeSection === 'knowledge' && (
                <KnowledgeBaseView
                  activeSchool={activeSchool}
                  onSelectSchool={handleSelectSchool}
                  knowledgeBase={knowledgeBase}
                  onUpdateCategory={handleUpdateKnowledgeCategory}
                  uploadedDocuments={uploadedDocuments}
                  onSaveVerifiedDocument={handleSaveVerifiedDocument}
                  onDeleteDocument={handleDeleteDocument}
                  onTriggerExportBackup={handleTriggerExportBackup}
                  onTriggerImportBackup={handleTriggerImportBackup}
                  statusBanner={knowledgeBanner}
                  onDismissBanner={() => setKnowledgeBanner(null)}
                />
              )}

              {activeSection === 'backups' && (
                <BackupsView
                  activeSchool={activeSchool}
                  onNavigate={handleSelectSection}
                  sessions={sessions}
                  knowledgeBase={knowledgeBase}
                  uploadedDocuments={uploadedDocuments}
                  companionMessagesCount={companionMessages.length}
                  companionMemoriesCount={companionMemory.length}
                  companionTasksCount={companionTasks.length}
                  onTriggerExportBackup={handleTriggerExportBackup}
                  onTriggerImportBackup={handleTriggerImportBackup}
                  statusBanner={knowledgeBanner}
                  onDismissBanner={() => setKnowledgeBanner(null)}
                />
              )}

              {activeSection === 'connections' && (
                <ConnectionsView
                  activeSchool={activeSchool}
                  onNavigate={handleSelectSection}
                  onRefreshProviders={handleCheckProvidersOnDemand}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* 3. RIGHT PANEL: Рабочие материалы (Материалы, Просмотр, Поиск, Контекст) */}
      <RightWorkspacePanel
        collapsed={rightPanelCollapsed}
        onToggleCollapsed={handleToggleRightPanelCollapsed}
        mobileOpen={rightPanelMobileOpen}
        onCloseMobile={() => setRightPanelMobileOpen(false)}
        activeTab={rightPanelTab}
        onChangeTab={handleChangeRightPanelTab}
        activeSchool={activeSchool}
        activeMode={activeAgentMode}
        currentSession={currentSession}
        sessions={sessions}
        selectedAttachmentId={selectedAttachmentId}
        onSelectAttachment={setSelectedAttachmentId}
        onRequestStageDialogueFile={handleRequestStageDialogueFile}
        onRemoveAttachmentFromDialogue={handleRemoveAttachmentFromDialogue}
        onJumpToSearchResult={handleJumpToSearchResult}
        onNavigate={handleSelectSection}
        knowledgeBase={knowledgeBase}
        uploadedDocuments={uploadedDocuments}
        stagedDraftAttachment={draftAttachment}
        isParsingDialogueFile={isParsingChatFile}
        parsingStatusLabel={
          chatParsingStatus
            ? documentProvider.getStatusLabel(chatParsingStatus)
            : null
        }
        geminiStatus={geminiStatus}
        providersState={providersState}
        providerSelection={providerSelection}
        onChangeProviderSelection={handleChangeProviderSelection}
        onCheckProvidersOnDemand={handleCheckProvidersOnDemand}
        isCheckingProviders={isCheckingProviders}
      />

      {/* 4. PIXEL VOICE WIDGET (STAGE 6.1: PERSISTENT VOICE ASSISTANT) */}
      <PixelVoiceWidget
        onOpenPixelChat={() => setPixelForceOpenChatTrigger((c) => c + 1)}
        onOpenFullscreenModal={() => {
          setIsLiveVoiceFromWakeWord(false);
          setIsLiveVoiceOpen(true);
        }}
        onOpenSettings={() => setIsVoiceSettingsOpen(true)}
        onOpenDiagnostics={() => setIsVoiceDiagnosticsOpen(true)}
      />

      {/* 5. PIXEL AI COMPANION & PERSONAL ASSISTANT FOR ANNA */}
      <PixelCompanion
        activeSchool={activeSchool}
        activeSection={activeSection}
        sidebarCollapsed={sidebarCollapsed}
        rightPanelOpen={!rightPanelCollapsed}
        isBusyWithFileOrBackup={isParsingChatFile || isRestoringBackup}
        companionMessages={companionMessages}
        companionMemory={companionMemory}
        companionTasks={companionTasks}
        companionPreferences={companionPreferences}
        forceOpenChatTrigger={pixelForceOpenChatTrigger}
        onSaveCompanionMessages={handleSaveCompanionMessages}
        onClearCompanionMessages={handleClearCompanionMessages}
        onSaveCompanionMemory={handleSaveCompanionMemory}
        onDeleteCompanionMemory={handleDeleteCompanionMemory}
        onClearAllCompanionMemory={handleClearAllCompanionMemory}
        onSaveCompanionTask={handleSaveCompanionTask}
        onDeleteCompanionTask={handleDeleteCompanionTask}
        onSaveCompanionPreferences={handleSaveCompanionPreferences}
        onOpenLiveVoice={() => setIsLiveVoiceOpen(true)}
      />

      {/* MODAL 1: Chat File Preview & Manager Confirmation Modal */}
      {stagedChatFileModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          onClick={() => setStagedChatFileModal(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-slate-900 text-[#F5B800] flex items-center justify-center shrink-0">
                  <Paperclip className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-display font-bold text-base text-slate-900 truncate">
                    Предпросмотр файла перед прикреплением к диалогу
                  </h3>
                  <p className="text-xs text-slate-500">
                    Школа: {SCHOOLS[activeSchool].name} · Специалист:{' '}
                    {AGENT_MODES[activeAgentMode].title}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStagedChatFileModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
                aria-label="Закрыть предпросмотр"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              {/* File Summary Card */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {stagedChatFileModal.attachment.name}
                    </div>
                    <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2 mt-0.5">
                      <span className="uppercase font-semibold text-slate-700">
                        .{stagedChatFileModal.attachment.extension || 'file'}
                      </span>
                      <span>•</span>
                      <span>
                        {formatFileSizeRu(
                          stagedChatFileModal.attachment.sizeBytes
                        )}
                      </span>
                      {stagedChatFileModal.parsedResult?.pageCount !==
                        undefined && (
                        <>
                          <span>•</span>
                          <span>
                            Страниц / слайдов:{' '}
                            {stagedChatFileModal.parsedResult.pageCount}
                          </span>
                        </>
                      )}
                      <span>•</span>
                      <span>
                        Извлечено символов:{' '}
                        {(
                          stagedChatFileModal.attachment.extractedText || ''
                        ).length.toLocaleString('ru-RU')}
                      </span>
                    </div>
                  </div>
                </div>
                <div>
                  {renderStatusBadge(
                    stagedChatFileModal.attachment.status || 'processed'
                  )}
                </div>
              </div>

              {/* Isolation Guarantee & External Gemini API Notice */}
              <div className="rounded-xl bg-slate-100 border border-slate-200 px-3.5 py-2.5 text-xs text-slate-700 space-y-1.5">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    Этот файл будет прикреплён{' '}
                    <strong className="font-semibold text-slate-900">
                      только к текущему диалогу
                    </strong>{' '}
                    в локальном хранилище IndexedDB и не попадёт в постоянную
                    Базу знаний школы {SCHOOLS[activeSchool].name}.
                  </div>
                </div>
                <div className="flex items-start gap-2.5 text-amber-900 pt-1 border-t border-slate-200/80">
                  <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong>Передача во внешний Gemini API:</strong> извлечённый
                    текст файла не отправляется автоматически — перед отправкой
                    запроса специалисту внизу чата потребуется ваше явное
                    подтверждение.
                  </div>
                </div>
              </div>

              {/* Warning / Error Notices */}
              {stagedChatFileModal.attachment.warning && (
                <div
                  className={`rounded-xl p-3.5 text-xs flex items-start gap-2.5 ${
                    stagedChatFileModal.attachment.status === 'error'
                      ? 'bg-red-50 border border-red-200 text-red-900'
                      : 'bg-amber-50 border border-amber-200 text-amber-900'
                  }`}
                >
                  <AlertTriangle
                    className={`w-4 h-4 shrink-0 mt-0.5 ${
                      stagedChatFileModal.attachment.status === 'error'
                        ? 'text-red-600'
                        : 'text-amber-600'
                    }`}
                  />
                  <div className="leading-relaxed">
                    <span className="font-semibold block mb-0.5">
                      {stagedChatFileModal.attachment.status === 'error'
                        ? 'Ошибка при разборе файла:'
                        : 'Обратите внимание:'}
                    </span>
                    {stagedChatFileModal.attachment.warning}
                  </div>
                </div>
              )}

              {/* Image Preview if applicable */}
              {stagedChatFileModal.attachment.dataUrl &&
                IMAGE_ONLY_EXTENSIONS.has(
                  stagedChatFileModal.attachment.extension
                ) && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center justify-center">
                    <img
                      src={stagedChatFileModal.attachment.dataUrl}
                      alt={stagedChatFileModal.attachment.name}
                      className="max-h-56 w-auto object-contain rounded-lg"
                    />
                  </div>
                )}

              {/* Extracted Text Preview */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-slate-700">
                    Предпросмотр извлечённого текста файла:
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Доступен во вкладке «Просмотр» правой панели
                  </span>
                </div>
                {stagedChatFileModal.attachment.extractedText &&
                stagedChatFileModal.attachment.extractedText.trim().length >
                  0 ? (
                  <pre className="w-full max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-800 whitespace-pre-wrap font-sans leading-relaxed">
                    {stagedChatFileModal.attachment.extractedText}
                  </pre>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
                    Текстовый слой в файле отсутствует или не содержит
                    распознаваемых символов.
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setStagedChatFileModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 transition-colors"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleConfirmStagedChatFile}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-xs"
              >
                <CheckCircle2 className="w-4 h-4 text-[#F5B800]" />
                <span>Подтвердить и прикрепить к диалогу</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Backup Restore Confirmation Modal */}
      {pendingBackupRestore && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          onClick={() => {
            if (!isRestoringBackup) setPendingBackupRestore(null);
          }}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-amber-50/70">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-base text-slate-900">
                    Подтверждение восстановления из копии
                  </h3>
                  <p className="text-xs text-slate-600">
                    Проверка структуры JSON пройдена успешно
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isRestoringBackup}
                onClick={() => setPendingBackupRestore(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
                aria-label="Закрыть окно"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 text-xs text-amber-950 leading-relaxed">
                <strong className="font-semibold block mb-1">
                  Внимание: текущие данные будут заменены!
                </strong>
                При подтверждении все текущие диалоги, сообщения, документы и
                категории Базы знаний в локальном хранилище IndexedDB будут
                атомарно заменены данными из выбранного файла резервной копии.
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs">
                <div className="font-semibold text-slate-900 mb-1">
                  Сводка проверенного архива:
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Дата создания архива:</span>
                  <span className="font-medium text-slate-900">
                    {pendingBackupRestore.exportedAtFormatted}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Версия схемы архива:</span>
                  <span className="font-medium text-slate-900">
                    v{pendingBackupRestore.backupVersion} (DB v
                    {pendingBackupRestore.archive.dbVersion})
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Диалогов и переписок:</span>
                  <span className="font-semibold text-slate-900">
                    {pendingBackupRestore.sessionsCount} (сообщений:{' '}
                    {pendingBackupRestore.messagesCount})
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Заполненных разделов Базы знаний:</span>
                  <span className="font-semibold text-slate-900">
                    KIBERone: {pendingBackupRestore.kiberoneCategoriesFilled}/
                    {KNOWLEDGE_CATEGORIES.length} · Renderia:{' '}
                    {pendingBackupRestore.renderiaCategoriesFilled}/
                    {KNOWLEDGE_CATEGORIES.length}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Документов Базы знаний школ:</span>
                  <span className="font-semibold text-slate-900">
                    {pendingBackupRestore.documentsCount}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Прикреплённых файлов диалогов:</span>
                  <span className="font-semibold text-slate-900">
                    {pendingBackupRestore.dialogueAttachmentsCount}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Данные помощника «Пиксель»:</span>
                  <span className="font-semibold text-slate-900">
                    Задач: {pendingBackupRestore.companionTasksCount} · Память:{' '}
                    {pendingBackupRestore.companionMemoriesCount} · Чат:{' '}
                    {pendingBackupRestore.companionMessagesCount}
                  </span>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={isRestoringBackup}
                onClick={() => setPendingBackupRestore(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 transition-colors"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={isRestoringBackup}
                onClick={handleConfirmRestoreBackup}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-xs disabled:opacity-50"
              >
                {isRestoringBackup ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#F5B800]" />
                    <span>Восстановление...</span>
                  </>
                ) : (
                  <>
                    <ArchiveRestore className="w-4 h-4 text-[#F5B800]" />
                    <span>Подтвердить и заменить данные</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Pixel Live Voice Mode (Gemini Live API) */}
      <PixelLiveVoiceModal
        isOpen={isLiveVoiceOpen}
        triggeredByWakeWord={isLiveVoiceFromWakeWord}
        onClose={() => {
          setIsLiveVoiceOpen(false);
          setIsLiveVoiceFromWakeWord(false);
        }}
        activeSchool={activeSchool}
        companionMemory={companionMemory}
        companionTasks={companionTasks}
        companionMessages={companionMessages}
        onAppendCompanionMessages={handleAppendLiveCompanionMessages}
        onOpenSettings={() => setIsVoiceSettingsOpen(true)}
      />

      {/* MODAL: Global Voice & Live API Settings Modal */}
      <PixelVoiceSettingsModal
        isOpen={isVoiceSettingsOpen}
        onClose={() => setIsVoiceSettingsOpen(false)}
      />

      {/* MODAL: Pixel Voice & Electron Diagnostics */}
      <VoiceDiagnosticModal
        isOpen={isVoiceDiagnosticsOpen}
        onClose={() => setIsVoiceDiagnosticsOpen(false)}
        onOpenLiveVoice={() => {
          setIsLiveVoiceFromWakeWord(false);
          setIsLiveVoiceOpen(true);
        }}
      />
    </div>
  );
}
