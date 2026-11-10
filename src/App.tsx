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
  DesignAspectRatio,
  DesignArtifactRecord,
  DesignerConceptOption,
  DesignOverlayLayer,
  DesignQualityMode,
  DesignSelectionBox,
  DesignTemplatePresetId,
  DesignVersionItem,
  DocumentProcessingStatus,
  FreeDesignImageModelId,
  ImageProviderId,
  ImageProvidersRegistryState,
  KnowledgeBaseBySchool,
  KnowledgeCategoryKey,
  NavSection,
  RightPanelTab,
  SchoolId,
  SpecialistHandoffPacket,
  SpecialistHandoffResult,
  UploadedDocumentRecord,
} from './types/assistant';
import {
  AGENT_MODES,
  createEmptyKnowledgeBase,
  getSchoolNameRu,
  KNOWLEDGE_CATEGORIES,
  SCHOOLS,
} from './config/schoolsAndModes';
import {
  deleteChatFolderFromLocalDisk,
  deleteFileFromLocalDisk,
  saveFileToLocalDisk,
} from './utils/diskFileManager';
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
  parseDesignerConceptsFromMarkdown,
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
import { TasksView } from './components/TasksView';
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
import {
  buildFallbackTaskFromUserRequest,
  extractAutoTaskFromConversation,
  parseAndExecuteTaskCommand,
} from './utils/pixelTaskManagerEngine';
import { useAutumnTheme } from './utils/autumnTheme';
import { AutumnLeafFall } from './components/autumn/AutumnLeafFall';
import { BackgroundMusic } from './components/BackgroundMusic';
import { ToastNotification } from './components/ToastNotification';

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
      saved === 'context' ||
      saved === 'voice'
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
    if (saved === 'kiberone' || saved === 'renderia' || saved === 'all') {
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
  const { isAutumnTheme } = useAutumnTheme();

  // Open directly on the Overview dashboard ('home')
  const [activeSection, setActiveSection] = useState<NavSection>('home');
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
  const [isFlowPanelOpen, setIsFlowPanelOpen] = useState(false);

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
  const [draftAttachments, setDraftAttachments] = useState<ChatAttachment[]>([]);
  const draftAttachment = draftAttachments[0] || null;

  const setDraftAttachment = (att: ChatAttachment | null) => {
    if (!att) {
      setDraftAttachments([]);
    } else {
      setDraftAttachments((prev) =>
        prev.some((a) => a.id === att.id)
          ? prev.map((a) => (a.id === att.id ? att : a))
          : [...prev, att]
      );
    }
  };

  const handleStageFilesForDraft = async (files: File[]) => {
    if (!files || files.length === 0) return;
    const now = new Date();
    const newPlaceholders: { file: File; attachment: ChatAttachment }[] = files.map(
      (file, idx) => {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const attId = `att-stage-${now.getTime()}-${idx}-${Math.random().toString(36).slice(2, 6)}`;
        return {
          file,
          attachment: {
            id: attId,
            name: file.name,
            extension: ext,
            sizeBytes: file.size,
            extractedText: '',
            status: 'uploading' as DocumentProcessingStatus,
            statusMessage: 'Загружается...',
            createdAt: formatTimeNow(now),
            createdAtMs: now.getTime(),
          },
        };
      }
    );

    // Immediately display all files in UI with "Загружается" status
    setDraftAttachments((prev) => [
      ...prev,
      ...newPlaceholders.map((p) => p.attachment),
    ]);
    setIsParsingChatFile(true);
    setChatParsingStatus('processing');
    setChatParsingLabel(`Обработка файлов (0/${files.length})...`);

    let completedCount = 0;

    await Promise.allSettled(
      newPlaceholders.map(async ({ file, attachment }) => {
        const ext = attachment.extension;
        const attId = attachment.id;

        // Transition to processing
        setDraftAttachments((prev) =>
          prev.map((a) =>
            a.id === attId
              ? {
                  ...a,
                  status: 'processing' as DocumentProcessingStatus,
                  statusMessage: 'Обрабатывается...',
                }
              : a
          )
        );

        try {
          let dataUrl: string | undefined;
          if (
            DATA_URL_PREVIEW_EXTENSIONS.has(ext) &&
            file.size <= 10 * 1024 * 1024
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
          let statusMessage: string | undefined = 'Готов';
          let pageCount: number | undefined;

          if (IMAGE_ONLY_EXTENSIONS.has(ext)) {
            status = 'processed';
            extractedText = '';
            statusMessage = 'Готов';
          } else {
            parsedResult = await documentProvider.parseFile(
              file,
              (_nextStatus: DocumentProcessingStatus, customLabel?: string) => {
                if (customLabel) {
                  setChatParsingLabel(customLabel);
                }
              }
            );
            status = parsedResult.status;
            extractedText = parsedResult.extractedText;
            warning = parsedResult.warning;
            statusMessage =
              parsedResult.status === 'error'
                ? parsedResult.warning || 'Ошибка обработки'
                : 'Готов';
            pageCount = parsedResult.pageCount;
          }

          const resolvedMimeType =
            file.type ||
            (IMAGE_ONLY_EXTENSIONS.has(ext)
              ? ext === 'png'
                ? 'image/png'
                : ext === 'webp'
                  ? 'image/webp'
                  : 'image/jpeg'
              : undefined);

          let diskResult: {
            absolutePath?: string;
            folderPath?: string;
            sizeBytes?: number;
          } | null = null;
          try {
            diskResult = await saveFileToLocalDisk(
              file,
              activeSchool,
              'Chats',
              currentSession?.id || 'general'
            );
          } catch {
            // disk backup is non-fatal
          }

          const resolvedThumbnailUrl =
            parsedResult?.thumbnailUrl ||
            (parsedResult?.extractedImages &&
              parsedResult.extractedImages[0]?.dataUrl) ||
            (dataUrl && IMAGE_ONLY_EXTENSIONS.has(ext) ? dataUrl : undefined);

          setDraftAttachments((prev) =>
            prev.map((a) => {
              if (a.id !== attId) return a;
              return {
                ...a,
                sizeBytes: diskResult?.sizeBytes ?? file.size,
                extractedText,
                status,
                statusMessage,
                warning,
                pageCount,
                mimeType: resolvedMimeType,
                dataUrl,
                thumbnailUrl: resolvedThumbnailUrl,
                filePath: diskResult?.absolutePath,
                diskFolderPath: diskResult?.folderPath,
                extractedImages: parsedResult?.extractedImages,
                slides: parsedResult?.slides,
                tableSheets: parsedResult?.tableSheets,
              };
            })
          );
          setSelectedAttachmentId(attId);
        } catch (err) {
          const errMsg =
            err instanceof Error ? err.message : 'Не удалось прочитать файл';
          setDraftAttachments((prev) =>
            prev.map((a) =>
              a.id === attId
                ? {
                    ...a,
                    status: 'error' as DocumentProcessingStatus,
                    statusMessage: errMsg,
                    warning: `Ошибка: ${errMsg}`,
                  }
                : a
            )
          );
        } finally {
          completedCount += 1;
          setChatParsingLabel(
            `Обработка файлов (${completedCount}/${files.length})...`
          );
        }
      })
    );

    setIsParsingChatFile(false);
    setChatParsingStatus(null);
    setChatParsingLabel(null);
  };

  const handleRemoveDraftAttachment = (attachmentId: string) => {
    setDraftAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    if (selectedAttachmentId === attachmentId) {
      setSelectedAttachmentId(null);
    }
  };
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<
    string | null
  >(null);
  const [selectedDesignArtifactId, setSelectedDesignArtifactId] = useState<
    string | null
  >(null);
  const [isGeneratingDesignImage, setIsGeneratingDesignImage] =
    useState<boolean>(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null);

  // Chat file parsing & preview modal state
  const [isParsingChatFile, setIsParsingChatFile] = useState(false);
  const [chatParsingStatus, setChatParsingStatus] =
    useState<DocumentProcessingStatus | null>(null);
  const [chatParsingLabel, setChatParsingLabel] = useState<string | null>(null);
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
  const [imageProvidersState, setImageProvidersState] =
    useState<ImageProvidersRegistryState | null>(null);
  const [isCheckingImageProviders, setIsCheckingImageProviders] =
    useState(false);
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
      onNavigate: handleSelectSection,
      onDelegatedTaskSyncToAnnaTasks: async (delegationState) => {
        // Internal AI specialist delegations must not automatically create tasks in Anna's "Мои задачи".
        // Only sync status if Anna has already explicitly linked a personal task to this delegation.
        const existing = companionTasksRef.current.find(
          (t) => t.linkedDelegationTaskId === delegationState.taskId
        );
        if (!existing) return;

        const specialistTitle = AGENT_MODES[delegationState.targetMode].shortTitle;
        const schoolName = SCHOOLS[delegationState.schoolId].name;
        const now = new Date();

        let mappedStatus: CompanionTaskRecord['status'];
        if (existing.status === 'done' || existing.status === 'cancelled') {
          mappedStatus = existing.status;
        } else if (delegationState.status === 'cancelled') {
          mappedStatus = 'cancelled';
        } else if (delegationState.status === 'draft') {
          mappedStatus = 'new';
        } else if (delegationState.status === 'pending_confirmation') {
          mappedStatus = 'waiting_anna_action';
        } else if (
          delegationState.status === 'sent' ||
          delegationState.status === 'processing'
        ) {
          mappedStatus = 'waiting_response';
        } else if (delegationState.status === 'completed') {
          mappedStatus = 'waiting_anna_action';
        } else if (delegationState.status === 'needs_revision') {
          mappedStatus = 'in_progress';
        } else {
          mappedStatus = 'in_progress';
        }

        const summaryText =
          delegationState.reviewSummary ||
          delegationState.resultText ||
          delegationState.specialistReplyPreview;

        const taskRecord: CompanionTaskRecord = {
          ...existing,
          status: mappedStatus,
          description: summaryText
            ? `Поручение: ${delegationState.instruction}\nИтог: ${summaryText.slice(0, 260)}`
            : `Поручение ${specialistTitle} (${schoolName}): ${delegationState.instruction}`,
          completedAt:
            mappedStatus === 'done' ? formatDateTimeShort(now) : existing.completedAt,
          completedAtMs:
            mappedStatus === 'done' ? now.getTime() : existing.completedAtMs,
        };

        await handleSaveCompanionTask(taskRecord);
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
        for (const msg of newMessages) {
          if (msg.role === 'user' && msg.content?.trim()) {
            const cmd = parseAndExecuteTaskCommand(
              msg.content,
              activeSchoolRef.current,
              companionTasksRef.current
            );
            if (cmd?.handled) {
              if (cmd.createdTask) {
                try {
                  await handleSaveCompanionTask(cmd.createdTask);
                } catch (err) {
                  const errText =
                    err instanceof Error
                      ? err.message
                      : 'Ошибка записи задачи в хранилище IndexedDB.';
                  const errMsg: CompanionMessage = {
                    id: `comp-voice-taskerr-${Date.now()}`,
                    role: 'pixel',
                    content: `❌ **Не удалось сохранить задачу в хранилище:** ${errText}`,
                    createdAt: formatTimeNow(new Date()),
                    createdAtMs: Date.now(),
                    schoolId: activeSchoolRef.current,
                    isError: true,
                  };
                  await handleSaveCompanionMessages([
                    ...companionMessagesRef.current,
                    errMsg,
                  ]);
                }
              }
              if (cmd.updatedTasks) {
                for (const ut of cmd.updatedTasks) {
                  try {
                    await handleSaveCompanionTask(ut);
                  } catch {
                    // error handled in handleSaveCompanionTask
                  }
                }
              }
            } else {
              const autoTask = extractAutoTaskFromConversation(
                msg.content,
                activeSchoolRef.current,
                companionTasksRef.current,
                msg.id
              );
              if (autoTask) {
                try {
                  await handleSaveCompanionTask(autoTask.taskRecord);
                } catch (err) {
                  const errText =
                    err instanceof Error
                      ? err.message
                      : 'Ошибка записи задачи в хранилище IndexedDB.';
                  const errMsg: CompanionMessage = {
                    id: `comp-voice-taskerr-${Date.now()}`,
                    role: 'pixel',
                    content: `❌ **Не удалось сохранить задачу в хранилище:** ${errText}`,
                    createdAt: formatTimeNow(new Date()),
                    createdAtMs: Date.now(),
                    schoolId: activeSchoolRef.current,
                    isError: true,
                  };
                  await handleSaveCompanionMessages([
                    ...companionMessagesRef.current,
                    errMsg,
                  ]);
                }
              }
            }
          } else if (
            msg.role === 'pixel' &&
            msg.content &&
            /(?:записал[аи]?|поставил[аи]?|создал[аи]?|добавил[аи]?|внесл[аи]?|зафиксировал[аи]?)\s+(?:[^.!?]{0,45})?(?:задач[уи]|в\s+список\s+дел|в\s+задачи|напоминание)/i.test(
              msg.content
            )
          ) {
            const recentTaskSaved = companionTasksRef.current.some(
              (t) => Date.now() - t.createdAtMs < 15000
            );
            if (!recentTaskSaved) {
              const lastUserMsg = [...companionMessagesRef.current]
                .reverse()
                .find((m) => m.role === 'user' && m.content?.trim());
              const fallbackTask = lastUserMsg
                ? buildFallbackTaskFromUserRequest(
                    lastUserMsg.content,
                    activeSchoolRef.current
                  )
                : null;
              if (fallbackTask) {
                try {
                  await handleSaveCompanionTask(fallbackTask);
                } catch (err) {
                  const errText =
                    err instanceof Error
                      ? err.message
                      : 'Не удалось сохранить задачу в хранилище.';
                  const warnMsg: CompanionMessage = {
                    id: `comp-voice-falseconfirm-${Date.now()}`,
                    role: 'pixel',
                    content: `❌ **Внимание: задача НЕ была сохранена в списке дел.** Причина: ${errText}`,
                    createdAt: formatTimeNow(new Date()),
                    createdAtMs: Date.now(),
                    schoolId: activeSchoolRef.current,
                    isError: true,
                  };
                  await handleSaveCompanionMessages([
                    ...companionMessagesRef.current,
                    warnMsg,
                  ]);
                }
              }
            }
          }
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
        attachments?: ChatAttachment[];
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
      const [checked, imgChecked] = await Promise.all([
        aiProviderManager.checkAllProvidersOnDemand(),
        geminiProvider.getDesignImageProviders().catch(() => null),
      ]);
      setProvidersState(checked);
      if (imgChecked) {
        setImageProvidersState(imgChecked);
      }
    } catch {
      // ignore check error
    } finally {
      setIsCheckingProviders(false);
    }
  };

  const handleCheckImageProvidersOnDemand = async (
    providerId?: ImageProviderId
  ) => {
    if (isCheckingImageProviders) return;
    setIsCheckingImageProviders(true);
    try {
      const checked = await geminiProvider.checkDesignImageProviders(providerId);
      setImageProvidersState(checked);
    } catch {
      // ignore check error
    } finally {
      setIsCheckingImageProviders(false);
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

  const handleOpenRightPanelVoiceSettings = () => {
    handleChangeRightPanelTab('voice');
    setRightPanelCollapsed(false);
    try {
      window.localStorage.setItem(RIGHT_PANEL_COLLAPSED_STORAGE_KEY, 'false');
    } catch {
      // Ignore storage errors
    }
    setRightPanelMobileOpen(true);
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

    geminiProvider
      .getDesignImageProviders()
      .then((imgState) => {
        if (!cancelled) {
          setImageProvidersState(imgState);
        }
      })
      .catch(() => {
        // Image providers state optional on initial load
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
      const targetSession = sessionsRef.current.find((s) => s.id === sessionId);
      if (targetSession) {
        deleteChatFolderFromLocalDisk(sessionId, targetSession.schoolId).catch(() => {});
      }
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

  const handleClearSessionMessages = async (sessionId: string): Promise<boolean> => {
    const now = new Date();
    const updatedAt = formatTimeNow(now);
    const updatedAtMs = now.getTime();

    const nextList = sortSessionsPinnedAndUpdatedDesc(
      sessionsRef.current.map((s) =>
        s.id === sessionId
          ? { ...s, messages: [], attachments: [], updatedAt, updatedAtMs }
          : s
      )
    );
    sessionsRef.current = nextList;
    setSessions(nextList);
    setSelectedAttachmentId(null);

    try {
      await storageProvider.clearSessionMessages(sessionId, updatedAt, updatedAtMs);
      setStorageError(null);
      return true;
    } catch (err) {
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Ошибка очистки сообщений в IndexedDB.'
      );
      return false;
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
    setChatParsingLabel(
      ext === 'pptx' ? 'Конвертация PPTX в PDF для полного анализа...' : null
    );

    try {
      let dataUrl: string | undefined;
      if (
        DATA_URL_PREVIEW_EXTENSIONS.has(ext) &&
        file.size <= 10 * 1024 * 1024
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
        warning = undefined;
      } else {
        parsedResult = await documentProvider.parseFile(
          file,
          (nextStatus: DocumentProcessingStatus, customLabel?: string) => {
            setChatParsingStatus(nextStatus);
            if (customLabel) {
              setChatParsingLabel(customLabel);
            }
          }
        );
        status = parsedResult.status;
        extractedText = parsedResult.extractedText;
        warning = parsedResult.warning;
        statusMessage = parsedResult.statusLabel;
        pageCount = parsedResult.pageCount;
      }

      const resolvedMimeType =
        file.type ||
        (IMAGE_ONLY_EXTENSIONS.has(ext)
          ? ext === 'png'
            ? 'image/png'
            : ext === 'webp'
              ? 'image/webp'
              : 'image/jpeg'
          : undefined);

      const diskResult = await saveFileToLocalDisk(
        file,
        activeSchool,
        'Chats',
        currentSession?.id || 'general'
      );

      const resolvedThumbnailUrl =
        parsedResult?.thumbnailUrl ||
        (parsedResult?.extractedImages && parsedResult.extractedImages[0]?.dataUrl) ||
        (dataUrl && IMAGE_ONLY_EXTENSIONS.has(ext) ? dataUrl : undefined);

      const attachment: ChatAttachment = {
        id: `att-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        extension: ext,
        sizeBytes: diskResult?.sizeBytes ?? file.size,
        extractedText,
        status,
        statusMessage,
        warning,
        pageCount,
        mimeType: resolvedMimeType,
        createdAt: formatTimeNow(now),
        createdAtMs: now.getTime(),
        dataUrl,
        thumbnailUrl: resolvedThumbnailUrl,
        filePath: diskResult?.absolutePath,
        diskFolderPath: diskResult?.folderPath,
        extractedImages: parsedResult?.extractedImages,
        slides: parsedResult?.slides,
        tableSheets: parsedResult?.tableSheets,
      };

      // Stage draft attachments directly without blocking preview modal
      if (target === 'draft') {
        setDraftAttachments((prev) => {
          if (prev.some((a) => a.id === attachment.id)) return prev;
          return [...prev, attachment];
        });
        setSelectedAttachmentId(attachment.id);
        return;
      }

      setStagedChatFileModal({
        target,
        attachment,
        parsedResult,
      });
    } finally {
      setIsParsingChatFile(false);
      setChatParsingStatus(null);
      setChatParsingLabel(null);
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
      const targetSession = sessionsRef.current.find((s) => s.id === sessionId);
      const targetAtt = targetSession?.attachments?.find((a) => a.id === attachmentId);
      if (targetAtt?.filePath) {
        deleteFileFromLocalDisk(targetAtt.filePath).catch(() => {});
      }

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
    contextOptions: SendMessageContextOptions,
    targetOverride?: {
      sessionId: string;
      schoolId: SchoolId;
      mode: AgentMode;
    },
    explicitAttachments?: ChatAttachment[]
  ) => {
    if (isGeneratingChat) return;

    const currentSessions = sessionsRef.current;
    const desiredSessionId = targetOverride?.sessionId ?? activeSessionId;
    const desiredSchool = targetOverride?.schoolId ?? activeSchool;
    const desiredMode = targetOverride?.mode ?? activeAgentMode;

    const existingTarget = desiredSessionId
      ? currentSessions.find((s) => s.id === desiredSessionId) || null
      : null;

    // Ensure we never overwrite schoolId/mode of an incompatible session
    const canUseExisting =
      existingTarget !== null &&
      existingTarget.schoolId === desiredSchool &&
      existingTarget.mode === desiredMode;

    const targetSchool: SchoolId = canUseExisting
      ? existingTarget.schoolId
      : desiredSchool;
    const targetMode: AgentMode = canUseExisting
      ? existingTarget.mode
      : desiredMode;

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

    const outgoingDrafts: ChatAttachment[] =
      explicitAttachments && explicitAttachments.length > 0
        ? explicitAttachments
        : draftAttachments.length > 0
          ? draftAttachments
          : attachment
            ? [attachment]
            : [];

    // Completeness verification: do not send if files are uploading/processing or failed
    const pendingProcessing = outgoingDrafts.filter(
      (a) =>
        a.status === 'uploading' ||
        a.status === 'processing' ||
        a.status === 'queued'
    );
    if (pendingProcessing.length > 0) {
      console.warn(
        `[handleSendMessage] Запрос отклонён: ${pendingProcessing.length} файлов ещё обрабатываются:`,
        pendingProcessing.map((f) => f.name)
      );
      return;
    }

    const failedFiles = outgoingDrafts.filter((a) => a.status === 'error');
    if (failedFiles.length > 0) {
      console.warn(
        `[handleSendMessage] Запрос отклонён: ${failedFiles.length} файлов содержат ошибку:`,
        failedFiles.map((f) => `${f.name}: ${f.statusMessage}`)
      );
      return;
    }

    console.log(
      `[Completeness Check] Выбрано: ${outgoingDrafts.length}, Готово: ${outgoingDrafts.length}, Передано провайдеру: ${outgoingDrafts.length}`
    );

    const firstAttachment = outgoingDrafts[0] || null;
    const linkedAttachment: ChatAttachment | null = firstAttachment
      ? {
          ...firstAttachment,
          messageId: userMsgId,
        }
      : null;

    // Prepare strictly isolated active-school Knowledge Base & explicitly selected documents
    const kbContext = documentProvider.prepareKnowledgeContextForSchool(
      targetSchool,
      knowledgeBase,
      contextOptions.includeKnowledgeBase
    );

    const { sendableDocuments, sendableImages: docImages, skippedNoTextDocuments } =
      documentProvider.prepareSelectedDocumentsForApi({
        draftAttachments: outgoingDrafts,
        dialogueAttachments: baseSession.attachments || [],
        selectedDialogueAttachmentIds:
          contextOptions.selectedDialogueAttachmentIds,
        schoolDocuments: uploadedDocuments,
        selectedSchoolDocumentIds: contextOptions.selectedSchoolDocumentIds,
        activeSchool: targetSchool,
      });

    const combinedImages = (docImages || []).slice(0, 500);
    const actualSentImagesCount = combinedImages.length;

    const attachmentNameDisplay =
      outgoingDrafts.length > 1
        ? `Прикреплено файлов (${outgoingDrafts.length} шт.): ${outgoingDrafts.map((d) => d.name).join(', ')}`
        : linkedAttachment?.name;

    const userMsg: ChatMessage = {
      id: userMsgId,
      sessionId: baseSession.id,
      role: 'user',
      content: text,
      createdAt: formatTimeNow(nowUser),
      createdAtMs: nowUserMs,
      schoolId: targetSchool,
      mode: targetMode,
      attachmentName: attachmentNameDisplay,
      sentImagesCount: actualSentImagesCount,
      attachmentMeta: linkedAttachment
        ? {
            id: linkedAttachment.id,
            name: attachmentNameDisplay || linkedAttachment.name,
            extension: linkedAttachment.extension,
            sizeBytes: linkedAttachment.sizeBytes,
            mimeType: linkedAttachment.mimeType,
            createdAt: linkedAttachment.createdAt,
            status: linkedAttachment.status,
            dataUrl: linkedAttachment.dataUrl,
            thumbnailUrl: linkedAttachment.thumbnailUrl,
            filePath: linkedAttachment.filePath,
            diskFolderPath: linkedAttachment.diskFolderPath,
            extractedImages: linkedAttachment.extractedImages,
            extractedImagesCount: linkedAttachment.extractedImages?.length || 0,
            sentImagesCount: actualSentImagesCount,
            tableSheets: linkedAttachment.tableSheets,
          }
        : undefined,
      attachmentsMeta: outgoingDrafts.map((d) => ({
        id: d.id,
        name: d.name,
        extension: d.extension,
        sizeBytes: d.sizeBytes,
        mimeType: d.mimeType,
        createdAt: d.createdAt,
        status: d.status,
        dataUrl: d.dataUrl,
        thumbnailUrl: d.thumbnailUrl,
        filePath: d.filePath,
        diskFolderPath: d.diskFolderPath,
        extractedImages: d.extractedImages,
        extractedImagesCount: d.extractedImages?.length || 0,
        sentImagesCount: d.extractedImages?.length || 0,
        tableSheets: d.tableSheets,
      })),
      attachments: outgoingDrafts,
    };

    const usedContextSummary: string[] = [
      `Школа: ${schoolCfg.name}`,
      `Роль: ${modeCfg.shortTitle}`,
    ];
    if (kbContext.length > 0) {
      usedContextSummary.push(
        `База знаний ${schoolCfg.name} (${kbContext.length} разд.)`
      );
    }
    if (outgoingDrafts.length > 0) {
      usedContextSummary.push(`Файлов в запросе: ${outgoingDrafts.length} шт.`);
    }
    if (combinedImages.length > 0) {
      usedContextSummary.push(
        `Визуальных материалов передано ИИ: ${combinedImages.length} шт.`
      );
      for (const img of combinedImages.slice(0, 10)) {
        usedContextSummary.push(`Визуальный материал: «${img.name}»`);
      }
      if (combinedImages.length > 10) {
        usedContextSummary.push(`…и ещё ${combinedImages.length - 10} материалов`);
      }
    }
    for (const doc of sendableDocuments) {
      usedContextSummary.push(`Документ: «${doc.name}»`);
    }
    for (const skippedName of skippedNoTextDocuments) {
      usedContextSummary.push(`Без текстового слоя: «${skippedName}»`);
    }

    // Default primary provider is Gemini with gemini-3.1-flash-lite
    const initialEstimatedProvider: AIProviderId =
      contextOptions.providerSelection === 'openrouter'
        ? 'openrouter'
        : contextOptions.providerSelection === 'ollama'
          ? 'ollama'
          : 'gemini';

    const initialEstimatedModel =
      initialEstimatedProvider === 'openrouter'
        ? 'openrouter/auto'
        : initialEstimatedProvider === 'ollama'
          ? 'llama3.2'
          : (geminiStatus?.model || 'gemini-3.1-flash-lite');

    const initialAssistantReply: ChatMessage = {
      id: assistantMsgId,
      sessionId: baseSession.id,
      role: 'assistant',
      createdAt: formatTimeNow(new Date(nowAssistantMs)),
      createdAtMs: nowAssistantMs,
      schoolId: targetSchool,
      mode: targetMode,
      content: '',
      sentImagesCount: actualSentImagesCount,
      usedContextSummary,
      isStreaming: true,
      providerId: initialEstimatedProvider,
      modelName: initialEstimatedModel,
    };

    const nextTitleFromText =
      text.slice(0, 46) + (text.length > 46 ? '…' : '');

    const existingAttachments = baseSession.attachments || [];
    const draftIdsSet = new Set(outgoingDrafts.map((d) => d.id));
    const mergedAttachments = [
      ...outgoingDrafts,
      ...existingAttachments.filter((a) => !draftIdsSet.has(a.id)),
    ];

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
      attachments: outgoingDrafts,
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

    // Clear staged attachments now that they have been committed to session
    setDraftAttachments([]);
    setDraftAttachment(null);
    if (linkedAttachment) {
      setSelectedAttachmentId(linkedAttachment.id);
    }

    // Save user message immediately to IndexedDB
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
        selectedImages: combinedImages,
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
        onDelta: (_delta, accumulated, meta) => {
          updateAssistantMessageInSession(
            {
              content: accumulated,
              isStreaming: true,
              ...(meta?.model ? { modelName: meta.model } : {}),
              ...(meta?.providerId ? { providerId: meta.providerId } : {}),
              ...(meta?.providerLabel ? { providerLabel: meta.providerLabel } : {}),
            },
            false
          );
        },
      });

      const rawFinalContent = result.aborted
        ? result.text.trim()
          ? `${result.text.trim()}\n\n[Генерация остановлена управляющей]`
          : '[Генерация ответа остановлена управляющей]'
        : result.text.trim() || 'Ответ от модели получен (пустой текст).';

      const parsedDesigner =
        targetMode === 'designer' && !result.aborted
          ? parseDesignerConceptsFromMarkdown(rawFinalContent)
          : { cleanText: rawFinalContent };

      updateAssistantMessageInSession(
        {
          content: parsedDesigner.cleanText,
          interactiveDesignerPrompt: parsedDesigner.interactivePrompt,
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

      let friendlyError = errorMsg;
      if (
        errorMsg.includes('REQUEST_TIMEOUT') ||
        errorMsg.includes('таймаут') ||
        errorMsg.includes('timed out') ||
        errorMsg.includes('timeout')
      ) {
        friendlyError =
          initialEstimatedProvider === 'openrouter'
            ? 'OpenRouter перегружен или время ожидания истекло. Рекомендуется прикрепить меньше файлов (2-3 шт.) или повторить запрос.'
            : 'Превышено время ожидания ответа (таймаут). Попробуйте отправить меньше файлов (2-3 шт.) или повторить запрос.';
      }

      updateAssistantMessageInSession(
        {
          content: `Ошибка запроса: ${friendlyError}`,
          isStreaming: false,
          isError: true,
          providerId: initialEstimatedProvider,
          modelName: initialEstimatedModel,
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
    const retryAttachments =
      savedPayload?.attachments && savedPayload.attachments.length > 0
        ? savedPayload.attachments
        : retryAttachment
          ? [retryAttachment]
          : [];

    const retryContextOptions: SendMessageContextOptions =
      savedPayload?.contextOptions || {
        includeKnowledgeBase: true,
        selectedDialogueAttachmentIds: retryAttachments.map((a) => a.id),
        selectedSchoolDocumentIds: [],
        externalApiConsentConfirmed: retryAttachments.length > 0,
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

    void handleSendMessage(
      retryText,
      retryAttachment,
      retryContextOptions,
      undefined,
      retryAttachments
    );
  };

  // ============================================================================
  // STAGE 1 & 2: INTER-SPECIALIST HANDOFF & DESIGNER VISUAL GENERATION / LAYERS
  // ============================================================================

  const handleInspectDesignArtifactInRightPanel = (artifactId: string) => {
    setSelectedDesignArtifactId(artifactId);
    setSelectedAttachmentId(null);
    handleChangeRightPanelTab('preview');
    if (rightPanelCollapsed) {
      handleToggleRightPanelCollapsed();
    }
    setRightPanelMobileOpen(true);
  };

  const handleHandoffTaskToSpecialist = async (params: {
    fromSpecialist: AgentMode;
    toSpecialist: AgentMode;
    sourceSessionId: string;
    sourceMessageId?: string;
    schoolId: SchoolId;
    originalTask: string;
    goalAndAudience: string;
    approvedOfferAndText: string;
    additionalRequirements: string;
    discussionContext: string;
    attachments: ChatAttachment[];
  }) => {
    if (isGeneratingChat) return;
    const now = new Date();
    const nowMs = now.getTime();
    const timeStr = formatTimeNow(now);

    const currentSessions = sessionsRef.current;
    const sourceSession = currentSessions.find(
      (s) => s.id === params.sourceSessionId
    );
    if (!sourceSession) return;

    // Reuse an existing target session if already linked to this sourceSessionId + school + target specialist, to avoid duplicates
    const existingTargetSession = currentSessions.find(
      (s) =>
        s.schoolId === params.schoolId &&
        s.mode === params.toSpecialist &&
        s.linkedHandoffPacket?.sourceSessionId === params.sourceSessionId
    );

    const baseTargetSession =
      existingTargetSession ||
      buildNewSession(params.toSpecialist, params.schoolId, currentSessions);

    const handoffId =
      existingTargetSession?.linkedHandoffPacket?.id ||
      `handoff-${nowMs}-${Math.random().toString(36).slice(2, 6)}`;

    const packet: SpecialistHandoffPacket = {
      id: handoffId,
      fromSpecialist: params.fromSpecialist,
      toSpecialist: params.toSpecialist,
      sourceSessionId: params.sourceSessionId,
      sourceMessageId: params.sourceMessageId,
      targetSessionId: baseTargetSession.id,
      schoolId: params.schoolId,
      originalTask: params.originalTask.trim(),
      goalAndAudience: params.goalAndAudience.trim(),
      approvedOfferAndText: params.approvedOfferAndText.trim(),
      additionalRequirements: params.additionalRequirements.trim(),
      discussionContext: params.discussionContext.trim(),
      attachments: params.attachments,
      status: 'in_progress',
      createdAt: timeStr,
      updatedAt: timeStr,
    };

    const fromTitle = AGENT_MODES[params.fromSpecialist].title;
    const toTitle = AGENT_MODES[params.toSpecialist].title;
    const schoolTitle = SCHOOLS[params.schoolId].name;

    // 1. Record handoff status card in the source specialist chat (preserving full history)
    const sourceStatusMsg: ChatMessage = {
      id: `msg-handoff-src-${nowMs}`,
      sessionId: sourceSession.id,
      role: 'assistant',
      content: `Задача передана специалисту **«${toTitle}»** (школа **${schoolTitle}**).\n\n- **Исходная задача:** ${packet.originalTask}\n- **Цель и аудитория:** ${packet.goalAndAudience || 'По контексту обсуждения'}\n- **Утверждённый оффер / текст:** ${packet.approvedOfferAndText || 'По контексту обсуждения'}\n\nИстория текущего диалога сохранена. Когда ${toTitle} завершит разработку и вы подтвердите результат, итоговый макет и статус вернутся сюда.`,
      createdAt: timeStr,
      createdAtMs: nowMs,
      schoolId: params.schoolId,
      mode: params.fromSpecialist,
      handoffPacket: packet,
      senderLabel: `Передача задачи → ${toTitle}`,
    };

    const updatedSourceSession: ChatSession = {
      ...sourceSession,
      updatedAt: timeStr,
      updatedAtMs: nowMs,
      linkedHandoffPacket: packet,
      messages: [...sourceSession.messages, sourceStatusMsg],
    };

    // 2. Prepare target specialist session with attachments and handoff briefing
    const mergedTargetAttachments = [
      ...params.attachments,
      ...(baseTargetSession.attachments || []).filter(
        (a) => !params.attachments.some((pa) => pa.id === a.id)
      ),
    ];

    const targetSessionReady: ChatSession = {
      ...baseTargetSession,
      title:
        baseTargetSession.messages.length === 0
          ? `От ${fromTitle}: ${packet.originalTask.slice(0, 34)}`
          : baseTargetSession.title,
      updatedAt: timeStr,
      updatedAtMs: nowMs + 1,
      attachments: mergedTargetAttachments,
      linkedHandoffPacket: packet,
    };

    const nextSessions = sortSessionsPinnedAndUpdatedDesc([
      targetSessionReady,
      updatedSourceSession,
      ...currentSessions.filter(
        (s) => s.id !== targetSessionReady.id && s.id !== updatedSourceSession.id
      ),
    ]);

    sessionsRef.current = nextSessions;
    setSessions(nextSessions);

    if (!isStorageLoading) {
      await storageProvider
        .saveSessionAndMessages(updatedSourceSession, [sourceStatusMsg])
        .catch(() => {});
      await storageProvider.saveSession(targetSessionReady).catch(() => {});
    }

    // 3. Switch to the target specialist's chat and send the structured handoff briefing
    setActiveSchool(params.schoolId);
    writeActiveSchoolToStorage(params.schoolId);
    setActiveAgentMode(params.toSpecialist);
    setActiveSection(params.toSpecialist);
    setActiveSessionId(targetSessionReady.id);

    const structuredBriefPrompt = [
      `📥 **Передача задачи от специалиста «${fromTitle}» (школа ${schoolTitle})**`,
      `**Исходная задача:** ${packet.originalTask}`,
      packet.goalAndAudience
        ? `**Цель и целевая аудитория:** ${packet.goalAndAudience}`
        : '',
      packet.approvedOfferAndText
        ? `**Утверждённый текст и оффер:**\n${packet.approvedOfferAndText}`
        : '',
      packet.additionalRequirements
        ? `**Дополнительные требования:** ${packet.additionalRequirements}`
        : '',
      packet.discussionContext
        ? `**Контекст обсуждения:**\n${packet.discussionContext}`
        : '',
      params.toSpecialist === 'designer'
        ? `\nПроанализируй задачу и брендбук школы ${schoolTitle}, предложи 2–3 визуальные концепции с разделением чистого фона и редактируемых слоёв (заголовок, оффер, CTA, бейдж школы) и задай мне уточняющие вопросы перед генерацией.`
        : `\nПроанализируй переданную задачу и предложи решение для школы ${schoolTitle}.`,
    ]
      .filter(Boolean)
      .join('\n\n');

    setTimeout(() => {
      void handleSendMessage(
        structuredBriefPrompt,
        params.attachments[0] || null,
        {
          includeKnowledgeBase: true,
          selectedDialogueAttachmentIds: params.attachments.map((a) => a.id),
          selectedSchoolDocumentIds: [],
          externalApiConsentConfirmed: true,
        },
        {
          sessionId: targetSessionReady.id,
          schoolId: params.schoolId,
          mode: params.toSpecialist,
        }
      );
    }, 60);
  };

  const handleReturnHandoffResultToSourceSpecialist = async (params: {
    handoffPacket: SpecialistHandoffPacket;
    summary: string;
    artifact?: DesignArtifactRecord;
    navigateBack?: boolean;
  }) => {
    const now = new Date();
    const nowMs = now.getTime();
    const timeStr = formatTimeNow(now);

    const { handoffPacket, summary, artifact, navigateBack = true } = params;
    const activeVer = artifact
      ? artifact.versions.find((v) => v.id === artifact.activeVersionId) ||
        artifact.versions[artifact.versions.length - 1]
      : undefined;

    const layersSummary = activeVer
      ? activeVer.layers
          .filter((l) => l.visible && l.text.trim())
          .map((l) => `${l.label}: «${l.text}»`)
          .join(' • ')
      : undefined;

    const updatedPacket: SpecialistHandoffPacket = {
      ...handoffPacket,
      status: 'completed',
      resultSummary: summary,
      resultArtifactId: artifact?.id,
      resultImageDataUrl: activeVer?.backgroundImageDataUrl,
      updatedAt: timeStr,
    };

    const handoffResult: SpecialistHandoffResult = {
      handoffId: handoffPacket.id,
      fromSpecialist: handoffPacket.fromSpecialist,
      toSpecialist: handoffPacket.toSpecialist,
      sourceSessionId: handoffPacket.sourceSessionId,
      targetSessionId: handoffPacket.targetSessionId,
      schoolId: handoffPacket.schoolId,
      summary,
      artifactId: artifact?.id,
      previewImageDataUrl: activeVer?.backgroundImageDataUrl,
      layersSummary,
      completedAt: timeStr,
    };

    const toTitle = AGENT_MODES[handoffPacket.toSpecialist].title;
    const fromTitle = AGENT_MODES[handoffPacket.fromSpecialist].title;

    const returnMsgInSource: ChatMessage = {
      id: `msg-handoff-return-${nowMs}`,
      sessionId: handoffPacket.sourceSessionId,
      role: 'assistant',
      content: `✅ **Специалист «${toTitle}» завершил работу по переданной задаче и вернул результат:**\n\n${summary}${
        layersSummary ? `\n\n**Текстовые слои макета:** ${layersSummary}` : ''
      }`,
      createdAt: timeStr,
      createdAtMs: nowMs,
      schoolId: handoffPacket.schoolId,
      mode: handoffPacket.fromSpecialist,
      handoffPacket: updatedPacket,
      handoffResult,
      designArtifact: artifact,
      senderLabel: `Результат от: ${toTitle}`,
    };

    const confirmMsgInTarget: ChatMessage = {
      id: `msg-handoff-confirm-${nowMs + 1}`,
      sessionId: handoffPacket.targetSessionId,
      role: 'assistant',
      content: `Результат и утверждённый макет переданы обратно в чат специалиста **«${fromTitle}»**. Статус поручения обновлён на «Выполнено».`,
      createdAt: timeStr,
      createdAtMs: nowMs + 1,
      schoolId: handoffPacket.schoolId,
      mode: handoffPacket.toSpecialist,
      handoffPacket: updatedPacket,
      handoffResult,
    };

    const nextSessions = sortSessionsPinnedAndUpdatedDesc(
      sessionsRef.current.map((s) => {
        if (s.id === handoffPacket.sourceSessionId) {
          const updatedMessages = s.messages.map((m) =>
            m.handoffPacket?.id === handoffPacket.id
              ? { ...m, handoffPacket: updatedPacket }
              : m
          );
          return {
            ...s,
            updatedAt: timeStr,
            updatedAtMs: nowMs,
            linkedHandoffPacket: updatedPacket,
            designArtifacts: artifact
              ? [
                  artifact,
                  ...(s.designArtifacts || []).filter(
                    (a) => a.id !== artifact.id
                  ),
                ]
              : s.designArtifacts,
            messages: [...updatedMessages, returnMsgInSource],
          };
        }
        if (s.id === handoffPacket.targetSessionId) {
          return {
            ...s,
            updatedAt: timeStr,
            updatedAtMs: nowMs + 1,
            linkedHandoffPacket: updatedPacket,
            messages: [...s.messages, confirmMsgInTarget],
          };
        }
        return s;
      })
    );

    sessionsRef.current = nextSessions;
    setSessions(nextSessions);

    const updatedSource = nextSessions.find(
      (s) => s.id === handoffPacket.sourceSessionId
    );
    const updatedTarget = nextSessions.find(
      (s) => s.id === handoffPacket.targetSessionId
    );

    if (!isStorageLoading) {
      if (updatedSource) {
        await storageProvider
          .saveSessionAndMessages(updatedSource, updatedSource.messages)
          .catch(() => {});
      }
      if (updatedTarget) {
        await storageProvider
          .saveSessionAndMessages(updatedTarget, [confirmMsgInTarget])
          .catch(() => {});
      }
    }

    if (navigateBack && updatedSource) {
      setActiveSchool(updatedSource.schoolId);
      setActiveAgentMode(updatedSource.mode);
      setActiveSection(updatedSource.mode);
      setActiveSessionId(updatedSource.id);
    }
  };

  const handleUpdateDesignerInteractivePrompt = (
    sessionId: string,
    messageId: string,
    updater: (
      prev: NonNullable<ChatMessage['interactiveDesignerPrompt']>
    ) => NonNullable<ChatMessage['interactiveDesignerPrompt']>
  ) => {
    const nextList = sessionsRef.current.map((s) => {
      if (s.id !== sessionId) return s;
      let changedMsg: ChatMessage | null = null;
      const nextMessages = s.messages.map((m) => {
        if (m.id === messageId && m.interactiveDesignerPrompt) {
          changedMsg = {
            ...m,
            interactiveDesignerPrompt: updater(m.interactiveDesignerPrompt),
          };
          return changedMsg;
        }
        return m;
      });
      const updatedSess = { ...s, messages: nextMessages };
      if (changedMsg && !isStorageLoading) {
        storageProvider
          .saveSessionAndMessages(updatedSess, [changedMsg])
          .catch(() => {});
      }
      return updatedSess;
    });
    sessionsRef.current = nextList;
    setSessions(nextList);
  };

  const handleGenerateDesignArtifact = async (params: {
    sessionId?: string;
    schoolId: SchoolId;
    title: string;
    prompt: string;
    aspectRatio: DesignAspectRatio;
    qualityMode: DesignQualityMode;
    templatePreset: DesignTemplatePresetId;
    providerId?: ImageProviderId;
    modelId?: FreeDesignImageModelId;
    concept?: DesignerConceptOption;
    referenceImageDataUrl?: string;
    existingArtifactId?: string;
  }) => {
    if (isGeneratingDesignImage) return;
    setIsGeneratingDesignImage(true);
    setStorageError(null);

    try {
      const currentSessions = sessionsRef.current;
      const existingTarget = params.sessionId
        ? currentSessions.find((s) => s.id === params.sessionId) || null
        : activeSessionId
          ? currentSessions.find((s) => s.id === activeSessionId) || null
          : null;

      const baseSession =
        existingTarget && existingTarget.schoolId === params.schoolId
          ? existingTarget
          : buildNewSession('designer', params.schoolId, currentSessions);

      const genResult = await geminiProvider.generateDesignImage({
        schoolId: params.schoolId,
        prompt: params.concept?.imageGenerationPrompt || params.prompt,
        aspectRatio: params.aspectRatio,
        qualityMode: params.qualityMode,
        templatePreset: params.templatePreset,
        providerId: params.providerId,
        modelId: params.modelId,
        suggestedHeadline: params.concept?.suggestedHeadline,
        suggestedOffer: params.concept?.suggestedOffer,
        suggestedCta: params.concept?.suggestedCta,
        referenceImageBase64: params.referenceImageDataUrl,
      });

      if (genResult.registryState) {
        setImageProvidersState(genResult.registryState);
      }

      const now = new Date();
      const nowMs = now.getTime();
      const timeStr = formatTimeNow(now);

      const existingArtifact = params.existingArtifactId
        ? (baseSession.designArtifacts || []).find(
            (a) => a.id === params.existingArtifactId
          )
        : undefined;

      const nextVersionNum = existingArtifact
        ? existingArtifact.versions.length + 1
        : 1;

      const newVersion: DesignVersionItem = {
        id: `ver-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
        versionNumber: nextVersionNum,
        label: `Вариант ${nextVersionNum} (${genResult.aspectRatio})`,
        promptUsed: params.concept?.imageGenerationPrompt || params.prompt,
        providerId: genResult.providerId,
        modelUsed: genResult.modelUsed,
        aspectRatio: genResult.aspectRatio,
        qualityMode: genResult.qualityMode,
        backgroundImageDataUrl: genResult.backgroundImageDataUrl,
        layers:
          genResult.defaultLayers ||
          existingArtifact?.versions[existingArtifact.versions.length - 1]
            ?.layers ||
          [],
        createdAt: timeStr,
      };

      const msgId = `msg-design-${nowMs}`;

      const updatedArtifact: DesignArtifactRecord = existingArtifact
        ? {
            ...existingArtifact,
            aspectRatio: genResult.aspectRatio,
            qualityMode: genResult.qualityMode,
            activeVersionId: newVersion.id,
            versions: [...existingArtifact.versions, newVersion],
            pendingVersion: undefined,
            updatedAt: timeStr,
          }
        : {
            id: `design-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
            schoolId: params.schoolId,
            sessionId: baseSession.id,
            messageId: msgId,
            title: params.concept?.title || params.title || 'Макет Дизайнера',
            conceptSummary:
              params.concept?.visualDirection || params.prompt.slice(0, 160),
            aspectRatio: genResult.aspectRatio,
            qualityMode: genResult.qualityMode,
            templatePreset: params.templatePreset,
            activeVersionId: newVersion.id,
            versions: [newVersion],
            sourceHandoffId: baseSession.linkedHandoffPacket?.id,
            createdAt: timeStr,
            updatedAt: timeStr,
          };

      const assistantDesignMsg: ChatMessage = {
        id: msgId,
        sessionId: baseSession.id,
        role: 'assistant',
        content: `🎨 **Готов визуальный макет «${updatedArtifact.title}» (${newVersion.label})**\n\n- **Формат:** \`${genResult.aspectRatio}\`\n- **Разделение слоёв:** чистая визуальная основа + ${newVersion.layers.length} редактируемых слоя (Заголовок, Оффер, CTA, Бейдж школы).\n\nОткройте макет в правой панели «Просмотр», чтобы отредактировать текст на плашках, выполнить точечное AI-редактирование выбранной области или скачать готовый PNG.`,
        createdAt: timeStr,
        createdAtMs: nowMs,
        schoolId: params.schoolId,
        mode: 'designer',
        modelName: genResult.modelUsed,
        providerId: 'gemini',
        designArtifact: updatedArtifact,
      };

      const updatedSession: ChatSession = {
        ...baseSession,
        updatedAt: timeStr,
        updatedAtMs: nowMs,
        designArtifacts: [
          updatedArtifact,
          ...(baseSession.designArtifacts || []).filter(
            (a) => a.id !== updatedArtifact.id
          ),
        ],
        messages: [...baseSession.messages, assistantDesignMsg],
      };

      const nextList = sortSessionsPinnedAndUpdatedDesc([
        updatedSession,
        ...currentSessions.filter((s) => s.id !== updatedSession.id),
      ]);
      sessionsRef.current = nextList;
      setSessions(nextList);
      setActiveSessionId(updatedSession.id);

      if (!isStorageLoading) {
        await storageProvider
          .saveSessionAndMessages(updatedSession, [assistantDesignMsg])
          .catch(() => {});
      }

      handleInspectDesignArtifactInRightPanel(updatedArtifact.id);
    } catch (err) {
      geminiProvider
        .getDesignImageProviders()
        .then(setImageProvidersState)
        .catch(() => {});
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Ошибка при генерации изображения.'
      );
    } finally {
      setIsGeneratingDesignImage(false);
    }
  };

  const updateDesignArtifactAcrossState = (
    artifactId: string,
    updater: (art: DesignArtifactRecord) => DesignArtifactRecord
  ) => {
    const nextList = sessionsRef.current.map((s) => {
      const hasArtifact =
        (s.designArtifacts || []).some((a) => a.id === artifactId) ||
        s.messages.some((m) => m.designArtifact?.id === artifactId);
      if (!hasArtifact) return s;

      let updatedArt: DesignArtifactRecord | null = null;
      const nextDesignArtifacts = (s.designArtifacts || []).map((a) => {
        if (a.id === artifactId) {
          updatedArt = updater(a);
          return updatedArt;
        }
        return a;
      });

      const changedMsgs: ChatMessage[] = [];
      const nextMessages = s.messages.map((m) => {
        if (m.designArtifact?.id === artifactId) {
          const art = updatedArt || updater(m.designArtifact);
          updatedArt = art;
          const nextMsg = { ...m, designArtifact: art };
          changedMsgs.push(nextMsg);
          return nextMsg;
        }
        return m;
      });

      const nextSession: ChatSession = {
        ...s,
        designArtifacts: nextDesignArtifacts,
        messages: nextMessages,
      };

      if (!isStorageLoading) {
        storageProvider
          .saveSessionAndMessages(nextSession, changedMsgs)
          .catch(() => {});
      }
      return nextSession;
    });

    sessionsRef.current = nextList;
    setSessions(nextList);
  };

  // Non-destructive layer change preview: creates/updates pendingVersion so Anna can confirm or reject
  const handlePreviewDesignLayerChanges = (
    artifactId: string,
    nextLayers: DesignOverlayLayer[]
  ) => {
    const timeStr = formatTimeNow(new Date());
    updateDesignArtifactAcrossState(artifactId, (art) => {
      const baseVer =
        art.pendingVersion ||
        art.versions.find((v) => v.id === art.activeVersionId) ||
        art.versions[art.versions.length - 1];
      if (!baseVer) return art;

      const pendingVer: DesignVersionItem = {
        ...baseVer,
        id: art.pendingVersion?.id || `pending-${Date.now()}`,
        versionNumber: art.versions.length + 1,
        label: `Предпросмотр правок слоёв (Версия ${art.versions.length + 1})`,
        layers: nextLayers,
        createdAt: timeStr,
      };
      return {
        ...art,
        pendingVersion: pendingVer,
        updatedAt: timeStr,
      };
    });
  };

  // Regional / Point AI Editing: generates a candidate pendingVersion without overwriting the original
  const handleRequestRegionalAiEdit = async (params: {
    artifactId: string;
    selectionBox?: DesignSelectionBox;
    editInstruction: string;
  }) => {
    if (isGeneratingDesignImage) return;
    setIsGeneratingDesignImage(true);
    setStorageError(null);

    try {
      let targetArtifact: DesignArtifactRecord | null = null;
      for (const s of sessionsRef.current) {
        const found =
          (s.designArtifacts || []).find((a) => a.id === params.artifactId) ||
          s.messages.find((m) => m.designArtifact?.id === params.artifactId)
            ?.designArtifact;
        if (found) {
          targetArtifact = found;
          break;
        }
      }
      if (!targetArtifact) return;

      const baseVer =
        targetArtifact.pendingVersion ||
        targetArtifact.versions.find(
          (v) => v.id === targetArtifact!.activeVersionId
        ) ||
        targetArtifact.versions[targetArtifact.versions.length - 1];
      if (!baseVer) return;

      const genResult = await geminiProvider.generateDesignImage({
        schoolId: targetArtifact.schoolId,
        prompt: baseVer.promptUsed,
        aspectRatio: baseVer.aspectRatio,
        qualityMode: baseVer.qualityMode,
        templatePreset: targetArtifact.templatePreset,
        providerId: 'cloudflare',
        modelId: '@cf/black-forest-labs/flux-2-klein-9b',
        sourceImageBase64: baseVer.backgroundImageDataUrl,
        selectionBox: params.selectionBox,
        editInstruction: params.editInstruction,
      });

      if (genResult.registryState) {
        setImageProvidersState(genResult.registryState);
      }

      const timeStr = formatTimeNow(new Date());
      const candidateVersion: DesignVersionItem = {
        id: `pending-ai-${Date.now()}`,
        versionNumber: targetArtifact.versions.length + 1,
        label: `AI-правка: ${params.editInstruction.slice(0, 28)}`,
        promptUsed: baseVer.promptUsed,
        editInstruction: params.editInstruction,
        selectionBox: params.selectionBox,
        providerId: genResult.providerId,
        modelUsed: genResult.modelUsed,
        aspectRatio: genResult.aspectRatio,
        qualityMode: genResult.qualityMode,
        backgroundImageDataUrl: genResult.backgroundImageDataUrl,
        layers: baseVer.layers,
        createdAt: timeStr,
      };

      updateDesignArtifactAcrossState(params.artifactId, (art) => ({
        ...art,
        pendingVersion: candidateVersion,
        updatedAt: timeStr,
      }));
    } catch (err) {
      geminiProvider
        .getDesignImageProviders()
        .then(setImageProvidersState)
        .catch(() => {});
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Не удалось выполнить точечное AI-редактирование макета.'
      );
    } finally {
      setIsGeneratingDesignImage(false);
    }
  };

  // Anna confirms the previewed changes -> saves as a new version, preserving all previous versions
  const handleConfirmPendingDesignVersion = (artifactId: string) => {
    const timeStr = formatTimeNow(new Date());
    updateDesignArtifactAcrossState(artifactId, (art) => {
      if (!art.pendingVersion) return art;
      const confirmedVer: DesignVersionItem = {
        ...art.pendingVersion,
        id: `ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        versionNumber: art.versions.length + 1,
        label: art.pendingVersion.editInstruction
          ? `Версия ${art.versions.length + 1} (AI-правка)`
          : `Версия ${art.versions.length + 1} (Слои обновлены)`,
        createdAt: timeStr,
      };
      return {
        ...art,
        activeVersionId: confirmedVer.id,
        versions: [...art.versions, confirmedVer],
        pendingVersion: undefined,
        updatedAt: timeStr,
      };
    });
  };

  // Anna rejects the previewed changes -> original version remains untouched
  const handleRejectPendingDesignVersion = (artifactId: string) => {
    const timeStr = formatTimeNow(new Date());
    updateDesignArtifactAcrossState(artifactId, (art) => ({
      ...art,
      pendingVersion: undefined,
      updatedAt: timeStr,
    }));
  };

  const handleSelectDesignVersion = (artifactId: string, versionId: string) => {
    updateDesignArtifactAcrossState(artifactId, (art) => ({
      ...art,
      activeVersionId: versionId,
      pendingVersion: undefined,
    }));
  };

  const handleUpdateKnowledgeCategory = async (
    schoolId: SchoolId,
    categoryKey: KnowledgeCategoryKey,
    value: string
  ): Promise<boolean> => {
    if (isStorageLoading) return false;
    try {
      if ((categoryKey as string) === 'general_business') {
        await storageProvider.saveKnowledgeCategory('all', 'general_business' as any, value);
        setKnowledgeBase((prev) => ({
          ...prev,
          generalBusinessInfo: value,
        }));
      } else if (schoolId === 'all') {
        await storageProvider.saveKnowledgeCategory('kiberone', categoryKey, value);
        await storageProvider.saveKnowledgeCategory('renderia', categoryKey, value);
        setKnowledgeBase((prev) => ({
          ...prev,
          kiberone: { ...prev.kiberone, [categoryKey]: value },
          renderia: { ...prev.renderia, [categoryKey]: value },
        }));
      } else {
        await storageProvider.saveKnowledgeCategory(schoolId, categoryKey, value);
        setKnowledgeBase((prev) => ({
          ...prev,
          [schoolId]: {
            ...prev[schoolId],
            [categoryKey]: value,
          },
        }));
      }
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
        if (categoryUpdate.schoolId === 'all') {
          await storageProvider.saveKnowledgeCategory(
            'kiberone',
            categoryUpdate.categoryKey,
            categoryUpdate.nextCategoryText
          );
          await storageProvider.saveKnowledgeCategory(
            'renderia',
            categoryUpdate.categoryKey,
            categoryUpdate.nextCategoryText
          );
          setKnowledgeBase((prev) => ({
            ...prev,
            kiberone: {
              ...prev.kiberone,
              [categoryUpdate.categoryKey]: categoryUpdate.nextCategoryText,
            },
            renderia: {
              ...prev.renderia,
              [categoryUpdate.categoryKey]: categoryUpdate.nextCategoryText,
            },
          }));
        } else {
          const targetSch = categoryUpdate.schoolId as 'kiberone' | 'renderia';
          await storageProvider.saveKnowledgeCategory(
            targetSch,
            categoryUpdate.categoryKey,
            categoryUpdate.nextCategoryText
          );
          setKnowledgeBase((prev) => ({
            ...prev,
            [targetSch]: {
              ...prev[targetSch],
              [categoryUpdate.categoryKey]: categoryUpdate.nextCategoryText,
            },
          }));
        }
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
          ? `Документ «${doc.name}» (${getSchoolNameRu(doc.schoolId)}) успешно сохранён в IndexedDB, а раздел «${catTitle}» обновлён.`
          : `Документ «${doc.name}» (${getSchoolNameRu(doc.schoolId)}) сохранён в списке документов школы (раздел «${catTitle}»).`
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
      if (target?.filePath) {
        await deleteFileFromLocalDisk(target.filePath).catch(() => {});
      }
      await storageProvider.deleteDocument(docId);
      setUploadedDocuments((prev) => prev.filter((d) => d.id !== docId));
      if (target) {
        setKnowledgeBanner(
          `Документ «${target.name}» удалён из хранилища и с диска (${getSchoolNameRu(target.schoolId)}).`
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
        ws?.activeSchool === 'kiberone' ||
        ws?.activeSchool === 'renderia' ||
        ws?.activeSchool === 'all'
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
    try {
      const greeting = createInitialCompanionGreetingMessage();
      await storageProvider.clearCompanionMessages(greeting);
      companionMessagesRef.current = [greeting];
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
    setCompanionMemory((prev) => {
      const next = [record, ...prev.filter((m) => m.id !== record.id)].sort(
        (a, b) => b.updatedAtMs - a.updatedAtMs
      );
      companionMemoryRef.current = next;
      return next;
    });
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
    setCompanionMemory((prev) => {
      const next = prev.filter((m) => m.id !== id);
      companionMemoryRef.current = next;
      return next;
    });
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
    companionMemoryRef.current = [];
    setCompanionMemory([]);
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
    try {
      // 1. Write to primary storage (IndexedDB + Electron mirror) and verify before updating UI state
      await storageProvider.saveCompanionTask(task);
      setCompanionTasks((prev) => {
        const next = [task, ...prev.filter((t) => t.id !== task.id)].sort(
          (a, b) => {
            if (a.status === 'done' && b.status !== 'done') return 1;
            if (a.status !== 'done' && b.status === 'done') return -1;
            return b.createdAtMs - a.createdAtMs;
          }
        );
        companionTasksRef.current = next;
        return next;
      });
      setStorageError(null);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Не удалось сохранить задачу Анны в IndexedDB.';
      setStorageError(message);
      throw err instanceof Error ? err : new Error(message);
    }
  };

  const handleDeleteCompanionTask = async (taskId: string) => {
    try {
      await storageProvider.deleteCompanionTask(taskId);
      setCompanionTasks((prev) => {
        const next = prev.filter((t) => t.id !== taskId);
        companionTasksRef.current = next;
        return next;
      });
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
    all:
      KNOWLEDGE_CATEGORIES.filter(
        (c) => knowledgeBase.kiberone[c.key]?.trim().length > 0
      ).length +
      KNOWLEDGE_CATEGORIES.filter(
        (c) => knowledgeBase.renderia[c.key]?.trim().length > 0
      ).length,
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
    <div
      className={`min-h-screen flex text-slate-900 transition-colors duration-500 ${
        isAutumnTheme ? 'autumn-subtle-pattern' : 'bg-[#F9FAFB]'
      } ${
        isAgentModeSection(activeSection)
          ? 'h-screen max-h-screen overflow-hidden'
          : ''
      }`}
    >
      {/* Periodic Autumn Leaf Burst Component (pointer-events: none) */}
      <AutumnLeafFall enabled={isAutumnTheme} />
      {/* Background Music Player with Audio Ducking during voice conversation */}
      <BackgroundMusic />
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
        onClearSessionMessages={handleClearSessionMessages}
        onDeleteSession={handleDeleteSession}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={handleToggleSidebarCollapsed}
        filledCategoriesCount={filledCategoriesCount}
        totalCategoriesCount={KNOWLEDGE_CATEGORIES.length}
      />

      {/* 2. CENTER PANEL: Active Dialogue or Selected App Section */}
      <div
        className={`flex-1 flex flex-col min-w-0 ${
          isAgentModeSection(activeSection)
            ? 'h-screen max-h-screen overflow-hidden'
            : 'min-h-screen'
        }`}
      >
        <TopBar
          activeSection={activeSection}
          activeSchool={activeSchool}
          activeAgentMode={activeAgentMode}
          currentSession={currentSession}
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
          onCreateNewSession={handleCreateNewSession}
          onRenameSession={handleRenameSession}
          isFlowPanelOpen={isFlowPanelOpen}
          onToggleFlowView={() => setIsFlowPanelOpen((prev) => !prev)}
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

        <main
          className={`flex-1 flex flex-col min-w-0 ${
            isAgentModeSection(activeSection) ? 'min-h-0 overflow-hidden' : ''
          }`}
        >
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
                  tasks={companionTasks}
                  onSaveTask={handleSaveCompanionTask}
                  onOpenSpecialistChat={(mode, schoolId) => {
                    handleSelectSchool(schoolId);
                    handleChangeChatMode(mode);
                  }}
                />
              )}

              {activeSection === 'tasks' && (
                <TasksView
                  tasks={companionTasks}
                  activeSchool={activeSchool}
                  onSaveTask={handleSaveCompanionTask}
                  onDeleteTask={handleDeleteCompanionTask}
                  onNavigate={handleSelectSection}
                  onOpenSpecialistChat={(mode, schoolId, sessionId) => {
                    handleSelectSchool(schoolId);
                    handleChangeChatMode(mode);
                    if (sessionId) {
                      handleSelectSession(sessionId);
                    }
                  }}
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
                  draftAttachments={draftAttachments}
                  onStageFileForDraft={handleStageFileForDraft}
                  onStageFilesForDraft={handleStageFilesForDraft}
                  onClearDraftAttachment={() => setDraftAttachments([])}
                  onRemoveDraftAttachment={handleRemoveDraftAttachment}
                  onInspectAttachmentInRightPanel={
                    handleInspectAttachmentInRightPanel
                  }
                  highlightedMessageId={highlightedMessageId}
                  isParsingFile={isParsingChatFile}
                  parsingStatusLabel={
                    chatParsingLabel ||
                    (chatParsingStatus
                      ? documentProvider.getStatusLabel(chatParsingStatus)
                      : null)
                  }
                  onOpenVoiceSettings={handleOpenRightPanelVoiceSettings}
                  onHandoffTaskToSpecialist={handleHandoffTaskToSpecialist}
                  onReturnHandoffResult={handleReturnHandoffResultToSourceSpecialist}
                  onUpdateDesignerInteractivePrompt={
                    handleUpdateDesignerInteractivePrompt
                  }
                  onGenerateDesignArtifact={handleGenerateDesignArtifact}
                  isGeneratingDesignImage={isGeneratingDesignImage}
                  imageProvidersState={imageProvidersState}
                  isCheckingImageProviders={isCheckingImageProviders}
                  onCheckImageProviders={handleCheckImageProvidersOnDemand}
                  onInspectDesignArtifactInRightPanel={
                    handleInspectDesignArtifactInRightPanel
                  }
                  isFlowPanelOpen={isFlowPanelOpen}
                  onToggleFlowPanel={() => setIsFlowPanelOpen((prev) => !prev)}
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
                  imageProvidersState={imageProvidersState}
                  isCheckingImageProviders={isCheckingImageProviders}
                  onCheckImageProviders={handleCheckImageProvidersOnDemand}
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
        stagedDraftAttachments={draftAttachments}
        isParsingDialogueFile={isParsingChatFile}
        parsingStatusLabel={
          chatParsingLabel ||
          (chatParsingStatus
            ? documentProvider.getStatusLabel(chatParsingStatus)
            : null)
        }
        geminiStatus={geminiStatus}
        providersState={providersState}
        providerSelection={providerSelection}
        onChangeProviderSelection={handleChangeProviderSelection}
        onCheckProvidersOnDemand={handleCheckProvidersOnDemand}
        isCheckingProviders={isCheckingProviders}
        onOpenPixelChat={() => setPixelForceOpenChatTrigger((c) => c + 1)}
        selectedDesignArtifactId={selectedDesignArtifactId}
        onSelectDesignArtifact={setSelectedDesignArtifactId}
        onPreviewDesignLayerChanges={handlePreviewDesignLayerChanges}
        onRequestRegionalAiEdit={handleRequestRegionalAiEdit}
        onConfirmPendingDesignVersion={handleConfirmPendingDesignVersion}
        onRejectPendingDesignVersion={handleRejectPendingDesignVersion}
        onSelectDesignVersion={handleSelectDesignVersion}
        isGeneratingDesignImage={isGeneratingDesignImage}
        imageProvidersState={imageProvidersState}
        isCheckingImageProviders={isCheckingImageProviders}
        onCheckImageProviders={handleCheckImageProvidersOnDemand}
        onReturnHandoffResult={handleReturnHandoffResultToSourceSpecialist}
        onInsertFileToDraft={(attachment) => setDraftAttachment(attachment)}
        onDeleteDocument={handleDeleteDocument}
      />

      {/* 4. PIXEL VOICE WIDGET (STAGE 6.1: PERSISTENT VOICE ASSISTANT) */}
      <PixelVoiceWidget
        onOpenPixelChat={() => setPixelForceOpenChatTrigger((c) => c + 1)}
        onOpenFullscreenModal={handleOpenRightPanelVoiceSettings}
        onOpenSettings={handleOpenRightPanelVoiceSettings}
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
        onOpenLiveVoice={handleOpenRightPanelVoiceSettings}
        onOpenRightPanelVoiceSettings={handleOpenRightPanelVoiceSettings}
        onNavigate={handleSelectSection}
      />

      {/* Floating Toast Notifications for Anna */}
      <ToastNotification />

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
