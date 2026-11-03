import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Eraser,
  ExternalLink,
  Eye,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Layers,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Monitor,
  Palette,
  Paperclip,
  Pause,
  PenLine,
  Pin,
  PinOff,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  Sliders,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  Wand2,
  X,
} from 'lucide-react';
import { voiceManager } from '../providers/voice/voiceManager';
import { MessagePlaybackState } from '../types/voice';
import {
  AgentMode,
  AIProviderId,
  AIProviderSelectionMode,
  ChatAttachment,
  ChatMessage,
  ChatSession,
  DesignAspectRatio,
  DesignArtifactRecord,
  DesignerConceptOption,
  DesignQualityMode,
  DesignTemplatePresetId,
  FreeDesignImageModelId,
  ImageProviderId,
  ImageProvidersRegistryState,
  KnowledgeBaseBySchool,
  NavSection,
  SchoolId,
  SpecialistHandoffPacket,
  UploadedDocumentRecord,
} from '../types/assistant';
import {
  AGENT_MODE_LIST,
  AGENT_MODES,
  KNOWLEDGE_CATEGORIES,
  SCHOOLS,
} from '../config/schoolsAndModes';
import { formatFileSizeRu } from './RightWorkspacePanel';
import { renderStatusBadge } from './KnowledgeBaseView';
import {
  GenerationStage,
  getGenerationStageLabelRu,
} from '../providers/geminiProvider';
import {
  AIProvidersSystemState,
  formatMessageProviderAttribution,
  PROVIDER_LABELS_RU,
  PROVIDER_SHORT_LABELS_RU,
} from '../providers/aiProviderManager';
import { MarkdownMessageContent } from './MarkdownMessageContent';

export interface SendMessageContextOptions {
  includeKnowledgeBase: boolean;
  selectedDialogueAttachmentIds: string[];
  selectedSchoolDocumentIds: string[];
  externalApiConsentConfirmed: boolean;
  consentedProviders?: AIProviderId[];
  providerSelection?: AIProviderSelectionMode;
}

export interface PendingFallbackDocumentConsentState {
  sessionId: string;
  targetProvider: AIProviderId;
  targetProviderLabel: string;
  failedProvider?: AIProviderId;
  failedReason?: string;
}

interface UnifiedChatViewProps {
  activeMode: AgentMode;
  activeSchool: SchoolId;
  onChangeMode: (mode: AgentMode) => void;
  onChangeSchool: (school: SchoolId) => void;
  onNavigate: (section: NavSection) => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession?: (sessionId: string) => void;
  onCreateNewSession: (mode?: AgentMode, school?: SchoolId) => void;
  onSendMessage: (
    text: string,
    attachment: ChatAttachment | null,
    contextOptions: SendMessageContextOptions
  ) => void;
  onRetryLastMessage?: (sessionId?: string) => void;
  onStopGeneration?: () => void;
  isGenerating?: boolean;
  generatingSessionId?: string | null;
  generationStage?: GenerationStage | null;
  generationElapsedSec?: number;
  isSlowGeneration?: boolean;
  restoredDraft?: { id: number; text: string } | null;
  geminiStatus?: { configured: boolean; model: string } | null;
  providerSelection?: AIProviderSelectionMode;
  onChangeProviderSelection?: (mode: AIProviderSelectionMode) => void;
  providersState?: AIProvidersSystemState | null;
  onCheckProvidersOnDemand?: () => Promise<void>;
  isCheckingProviders?: boolean;
  pendingFallbackConsentPrompt?: PendingFallbackDocumentConsentState | null;
  onConfirmFallbackDocumentConsent?: () => void;
  onDismissFallbackDocumentConsent?: () => void;
  onClearCurrentSession: () => void;
  onDeleteSession: (sessionId: string) => Promise<boolean> | void;
  onRenameSession: (sessionId: string, newTitle: string) => Promise<boolean>;
  onTogglePinSession: (sessionId: string, isPinned: boolean) => Promise<boolean>;
  knowledgeBase: KnowledgeBaseBySchool;
  uploadedDocuments: UploadedDocumentRecord[];
  draftAttachment: ChatAttachment | null;
  onStageFileForDraft: (file: File) => Promise<void>;
  onClearDraftAttachment: () => void;
  onInspectAttachmentInRightPanel: (attachmentId: string) => void;
  highlightedMessageId: string | null;
  isParsingFile?: boolean;
  parsingStatusLabel?: string | null;
  onOpenVoiceSettings?: () => void;
  onHandoffTaskToSpecialist?: (params: {
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
  }) => Promise<void>;
  onReturnHandoffResult?: (params: {
    handoffPacket: SpecialistHandoffPacket;
    summary: string;
    artifact?: DesignArtifactRecord;
    navigateBack?: boolean;
  }) => Promise<void>;
  onUpdateDesignerInteractivePrompt?: (
    sessionId: string,
    messageId: string,
    updater: (
      prev: NonNullable<ChatMessage['interactiveDesignerPrompt']>
    ) => NonNullable<ChatMessage['interactiveDesignerPrompt']>
  ) => void;
  onGenerateDesignArtifact?: (params: {
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
  }) => Promise<void>;
  isGeneratingDesignImage?: boolean;
  imageProvidersState?: ImageProvidersRegistryState | null;
  isCheckingImageProviders?: boolean;
  onCheckImageProviders?: (providerId?: ImageProviderId) => Promise<void>;
  onInspectDesignArtifactInRightPanel?: (artifactId: string) => void;
}

const STAGE_ORDER: GenerationStage[] = [
  'connecting',
  'waiting_model',
  'generating',
  'finishing',
];

const DESIGN_ASPECT_RATIOS: Array<{ id: DesignAspectRatio; label: string }> = [
  { id: '3:4', label: '3:4 (Пост ВК)' },
  { id: '9:16', label: '9:16 (Stories)' },
  { id: '1:1', label: '1:1 (Квадрат)' },
  { id: '16:9', label: '16:9 (Широкий)' },
  { id: '4:3', label: '4:3 (Презентация)' },
];

type DesignerModelSelection = 'auto' | FreeDesignImageModelId;

const DESIGNER_MODEL_OPTIONS: Array<{
  id: DesignerModelSelection;
  label: string;
}> = [
  { id: 'auto', label: 'Автовыбор' },
  {
    id: '@cf/black-forest-labs/flux-1-schnell',
    label: 'Быстрая генерация (FLUX.1)',
  },
  {
    id: '@cf/black-forest-labs/flux-2-klein-9b',
    label: 'Детальная + референсы (FLUX.2)',
  },
];

function resolveDesignerModelId(
  selection: DesignerModelSelection,
  hasReferenceImage: boolean
): FreeDesignImageModelId {
  if (selection === 'auto') {
    return hasReferenceImage
      ? '@cf/black-forest-labs/flux-2-klein-9b'
      : '@cf/black-forest-labs/flux-1-schnell';
  }
  if (
    hasReferenceImage &&
    selection === '@cf/black-forest-labs/flux-1-schnell'
  ) {
    return '@cf/black-forest-labs/flux-2-klein-9b';
  }
  return selection;
}

const DESIGN_TEMPLATE_PRESETS: Array<{
  id: DesignTemplatePresetId;
  label: string;
  defaultRatio: DesignAspectRatio;
}> = [
  { id: 'promo_banner', label: 'Рекламный баннер', defaultRatio: '3:4' },
  { id: 'story_vertical', label: 'Stories 9:16', defaultRatio: '9:16' },
  { id: 'vk_post', label: 'Карточка ВК', defaultRatio: '3:4' },
  { id: 'event_poster', label: 'Афиша мастер-класса', defaultRatio: '3:4' },
  { id: 'free_concept', label: 'Свободный концепт', defaultRatio: '1:1' },
];

export const UnifiedChatView: React.FC<UnifiedChatViewProps> = ({
  activeMode,
  activeSchool,
  onChangeMode,
  onChangeSchool,
  onNavigate,
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateNewSession,
  onSendMessage,
  onRetryLastMessage,
  onStopGeneration,
  isGenerating = false,
  generatingSessionId = null,
  generationStage = null,
  generationElapsedSec = 0,
  isSlowGeneration = false,
  restoredDraft = null,
  geminiStatus = null,
  providerSelection = 'auto',
  onChangeProviderSelection,
  providersState = null,
  onCheckProvidersOnDemand,
  isCheckingProviders = false,
  pendingFallbackConsentPrompt = null,
  onConfirmFallbackDocumentConsent,
  onDismissFallbackDocumentConsent,
  onClearCurrentSession,
  onDeleteSession,
  onRenameSession,
  onTogglePinSession,
  knowledgeBase,
  uploadedDocuments,
  draftAttachment,
  onStageFileForDraft,
  onClearDraftAttachment,
  onInspectAttachmentInRightPanel,
  highlightedMessageId,
  isParsingFile = false,
  parsingStatusLabel = null,
  onOpenVoiceSettings,
  onHandoffTaskToSpecialist,
  onReturnHandoffResult,
  onUpdateDesignerInteractivePrompt,
  onGenerateDesignArtifact,
  isGeneratingDesignImage = false,
  imageProvidersState = null,
  isCheckingImageProviders = false,
  onCheckImageProviders,
  onInspectDesignArtifactInRightPanel,
}) => {
  const [draftPrompt, setDraftPrompt] = useState('');
  const [selectedQuickPromptId, setSelectedQuickPromptId] = useState<
    string | null
  >(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);

  // Designer Composer Toolbar State
  const [designAspectRatio, setDesignAspectRatio] =
    useState<DesignAspectRatio>('3:4');
  const [designQualityMode] = useState<DesignQualityMode>('standard');
  const [designProviderId] = useState<ImageProviderId>('cloudflare');
  const [designModelId, setDesignModelId] =
    useState<DesignerModelSelection>('auto');
  const [designTemplatePreset, setDesignTemplatePreset] =
    useState<DesignTemplatePresetId>('promo_banner');

  // Inter-Specialist Task Handoff Modal State (Stage 1)
  const [handoffModalState, setHandoffModalState] = useState<{
    isOpen: boolean;
    toSpecialist: AgentMode;
    sourceMessageId?: string;
    originalTask: string;
    goalAndAudience: string;
    approvedOfferAndText: string;
    additionalRequirements: string;
    discussionContext: string;
  } | null>(null);

  // Playback state for specialist and assistant messages
  const [playbackState, setPlaybackState] = useState<MessagePlaybackState>(() =>
    voiceManager.getPlaybackState()
  );

  useEffect(() => {
    return voiceManager.onPlaybackStateChange((st) => {
      setPlaybackState(st);
    });
  }, []);

  // Selective context & per-provider document consent state (Stage 3.1 & Stage 3.3 Part 7)
  const [includeKnowledgeBase, setIncludeKnowledgeBase] = useState(true);
  const [selectedDialogueAttachmentIds, setSelectedDialogueAttachmentIds] =
    useState<string[]>([]);
  const [selectedSchoolDocumentIds, setSelectedSchoolDocumentIds] = useState<
    string[]
  >([]);
  const [showDocPickerPopover, setShowDocPickerPopover] = useState(false);
  const [showProviderPopover, setShowProviderPopover] = useState(false);
  const [consentedProviders, setConsentedProviders] = useState<AIProviderId[]>(
    []
  );

  // Header inline rename state
  const [isRenamingHeader, setIsRenamingHeader] = useState(false);
  const [headerRenameDraft, setHeaderRenameDraft] = useState('');

  // Delete confirmation modal state
  const [sessionPendingDelete, setSessionPendingDelete] =
    useState<ChatSession | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);

  // Google Flow (Nano Banana) Integration State & Interactive Splitter
  const isElectronFlowAvailable = Boolean(window.electronAPI?.flow?.isAvailable);
  const [isFlowPanelOpen, setIsFlowPanelOpen] = useState(false);
  const [isBrowserFlowModalOpen, setIsBrowserFlowModalOpen] = useState(false);
  const [isFlowFullscreen, setIsFlowFullscreen] = useState(false);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);
  const [chatWidthPercent, setChatWidthPercent] = useState<number>(() => {
    try {
      const saved = window.localStorage.getItem('kiber_renderia_flow_chat_split');
      if (saved) {
        const parsed = Number(saved);
        if (!Number.isNaN(parsed) && parsed >= 20 && parsed <= 80) return parsed;
      }
    } catch {}
    return 45;
  });
  const currentPercentRef = useRef(chatWidthPercent);
  useEffect(() => {
    currentPercentRef.current = chatWidthPercent;
  }, [chatWidthPercent]);

  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const [flowState, setFlowState] = useState<{
    isVisible: boolean;
    isLoading: boolean;
    currentUrl?: string;
    error?: string | null;
  }>({
    isVisible: false,
    isLoading: false,
    currentUrl: 'https://flow.google.com/',
    error: null,
  });

  const flowTargetRef = useRef<HTMLDivElement | null>(null);

  const updateFlowRect = useCallback(() => {
    if (!flowTargetRef.current || !window.electronAPI?.flow) return;
    const rect = flowTargetRef.current.getBoundingClientRect();
    if (rect.width > 20 && rect.height > 20) {
      window.electronAPI.flow.updateBounds({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    }
  }, []);

  const handleToggleFlow = useCallback(() => {
    if (!isElectronFlowAvailable) {
      setIsBrowserFlowModalOpen(true);
      return;
    }
    setIsFlowPanelOpen((prev) => {
      if (prev) {
        setIsFlowFullscreen(false);
      }
      return !prev;
    });
  }, [isElectronFlowAvailable]);

  // Close Flow panel if mode changes away from designer
  useEffect(() => {
    if (activeMode !== 'designer' && isFlowPanelOpen) {
      setIsFlowPanelOpen(false);
      setIsFlowFullscreen(false);
      window.electronAPI?.flow?.hide();
    }
  }, [activeMode, isFlowPanelOpen]);

  // Splitter mouse/pointer drag handlers
  const handleSplitterPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDraggingSplitter(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
    },
    []
  );

  useEffect(() => {
    if (!isDraggingSplitter) return;

    let rafId: number | null = null;

    const handlePointerMove = (e: MouseEvent | PointerEvent) => {
      if (!splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const offsetX = e.clientX - rect.left;
      const rawPercent = (offsetX / rect.width) * 100;
      const clamped = Math.min(80, Math.max(20, Math.round(rawPercent * 10) / 10));

      setChatWidthPercent(clamped);

      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        updateFlowRect();
      });
    };

    const handlePointerUp = () => {
      setIsDraggingSplitter(false);
      try {
        window.localStorage.setItem(
          'kiber_renderia_flow_chat_split',
          String(currentPercentRef.current)
        );
      } catch {}
      setTimeout(updateFlowRect, 30);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isDraggingSplitter, updateFlowRect]);

  // Recalculate Flow bounds whenever fullscreen state toggles
  useEffect(() => {
    if (!isFlowPanelOpen) return;
    updateFlowRect();
    const t1 = setTimeout(updateFlowRect, 50);
    const t2 = setTimeout(updateFlowRect, 200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isFlowFullscreen, isFlowPanelOpen, updateFlowRect]);

  // Sync Flow WebContentsView with target container coordinates
  useEffect(() => {
    if (!isFlowPanelOpen) return;
    const bridge = window.electronAPI?.flow;
    if (!bridge || !bridge.isAvailable) return;

    let resizeObserver: ResizeObserver | null = null;

    const timer = setTimeout(() => {
      if (flowTargetRef.current) {
        const rect = flowTargetRef.current.getBoundingClientRect();
        bridge.show({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        });

        resizeObserver = new ResizeObserver(() => {
          updateFlowRect();
        });
        resizeObserver.observe(flowTargetRef.current);
      }
    }, 60);

    const unsubscribe = bridge.onStateChange?.((state) => {
      setFlowState(state);
    });

    const handleWindowResize = () => {
      updateFlowRect();
    };
    window.addEventListener('resize', handleWindowResize);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleWindowResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      unsubscribe?.();
      bridge.hide();
    };
  }, [isFlowPanelOpen, updateFlowRect]);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const modeConfig = AGENT_MODES[activeMode];
  const schoolConfig = SCHOOLS[activeSchool];

  // Ensure currentSession strictly matches activeSessionId AND current school/mode
  const currentSession: ChatSession | null = useMemo(() => {
    if (!activeSessionId) return null;
    const found = sessions.find((s) => s.id === activeSessionId);
    if (!found) return null;
    if (found.schoolId !== activeSchool || found.mode !== activeMode) {
      return null;
    }
    return found;
  }, [activeSessionId, sessions, activeSchool, activeMode]);

  const currentMessages = currentSession ? currentSession.messages : [];
  const dialogueAttachments = useMemo(
    () => currentSession?.attachments || [],
    [currentSession]
  );
  const schoolDocuments = useMemo(
    () =>
      uploadedDocuments.filter(
        (d) => d.schoolId === activeSchool || d.schoolId === 'all'
      ),
    [uploadedDocuments, activeSchool]
  );

  const schoolKnowledge = knowledgeBase[activeSchool];
  const filledCount = KNOWLEDGE_CATEGORIES.filter(
    (cat) => (schoolKnowledge[cat.key] || '').trim().length > 0
  ).length;

  // Reset selected documents when switching school or session so context never leaks across schools
  useEffect(() => {
    setSelectedDialogueAttachmentIds([]);
    setSelectedSchoolDocumentIds([]);
    setShowDocPickerPopover(false);
  }, [activeSchool, currentSession?.id]);

  // Determine which documents/images are slated to be sent in this request
  const selectedDocNamesWithText = useMemo(() => {
    const names: string[] = [];
    const isDraftSendable =
      draftAttachment &&
      (((draftAttachment.extractedText || '').trim().length > 0 &&
        draftAttachment.status !== 'error') ||
        Boolean(
          draftAttachment.dataUrl &&
            (draftAttachment.mimeType?.startsWith('image/') ||
              ['png', 'jpg', 'jpeg', 'webp'].includes(draftAttachment.extension))
        ));

    if (draftAttachment && isDraftSendable) {
      names.push(draftAttachment.name);
    }
    const selDialSet = new Set(selectedDialogueAttachmentIds);
    for (const att of dialogueAttachments) {
      const isSendable =
        ((att.extractedText || '').trim().length > 0 && att.status !== 'error') ||
        Boolean(
          att.dataUrl &&
            (att.mimeType?.startsWith('image/') ||
              ['png', 'jpg', 'jpeg', 'webp'].includes(att.extension))
        );
      if (selDialSet.has(att.id) && isSendable && !names.includes(att.name)) {
        names.push(att.name);
      }
    }
    const selSchoolSet = new Set(selectedSchoolDocumentIds);
    for (const doc of schoolDocuments) {
      const isSendable =
        ((doc.extractedText || '').trim().length > 0 && doc.status !== 'error') ||
        Boolean(
          doc.dataUrl &&
            (doc.fileType === 'image' ||
              ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(doc.extension))
        );
      if (selSchoolSet.has(doc.id) && isSendable && !names.includes(doc.name)) {
        names.push(doc.name);
      }
    }
    return names;
  }, [
    draftAttachment,
    selectedDialogueAttachmentIds,
    dialogueAttachments,
    selectedSchoolDocumentIds,
    schoolDocuments,
  ]);

  const hasSelectedDocsWithText = selectedDocNamesWithText.length > 0;

  const hasSelectedImages = useMemo(() => {
    if (
      draftAttachment?.dataUrl &&
      (draftAttachment.mimeType?.startsWith('image/') ||
        ['png', 'jpg', 'jpeg', 'webp'].includes(draftAttachment.extension))
    ) {
      return true;
    }
    const selSchoolSet = new Set(selectedSchoolDocumentIds);
    for (const doc of schoolDocuments) {
      if (
        selSchoolSet.has(doc.id) &&
        doc.dataUrl &&
        (doc.fileType === 'image' ||
          ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(doc.extension))
      ) {
        return true;
      }
    }
    return false;
  }, [draftAttachment, selectedSchoolDocumentIds, schoolDocuments]);

  const primaryProviderForDocs: AIProviderId =
    providerSelection === 'auto' ? 'gemini' : providerSelection;

  const handleToggleProviderConsent = (providerId: AIProviderId) => {
    setConsentedProviders((prev) =>
      prev.includes(providerId)
        ? prev.filter((p) => p !== providerId)
        : [...prev, providerId]
    );
  };

  // Scroll to highlighted message when jumped to from Right Panel Search
  useEffect(() => {
    if (!highlightedMessageId) return;
    const el = document.getElementById(`chat-msg-${highlightedMessageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightedMessageId, currentSession?.id]);

  // Reset inline header rename when switching sessions
  useEffect(() => {
    setIsRenamingHeader(false);
  }, [currentSession?.id]);

  // Restore user's text into composer if a request fails and composer is currently empty
  useEffect(() => {
    if (!restoredDraft?.text) return;
    setDraftPrompt((prev) => (prev.trim().length === 0 ? restoredDraft.text : prev));
  }, [restoredDraft?.id, restoredDraft?.text]);

  const isCurrentSessionGenerating = Boolean(
    isGenerating &&
      (!generatingSessionId || generatingSessionId === currentSession?.id)
  );
  const backgroundGeneratingSession = useMemo(() => {
    if (!isGenerating || !generatingSessionId) return null;
    if (generatingSessionId === currentSession?.id) return null;
    return sessions.find((s) => s.id === generatingSessionId) || null;
  }, [isGenerating, generatingSessionId, currentSession?.id, sessions]);

  const handleSelectQuickPrompt = (
    promptId: string,
    getPromptFn: (schoolName: string, schoolFocus: string) => string
  ) => {
    const generated = getPromptFn(
      schoolConfig.name,
      schoolConfig.focusDescription
    );
    setDraftPrompt(generated);
    setSelectedQuickPromptId(promptId);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(
          generated.length,
          generated.length
        );
      }
    }, 20);
  };

  const handleCopyMessage = async (msg: ChatMessage) => {
    const cleanText = msg.content
      .replace(/\[(?:Генерация[^\]]*|Остановлено[^\]]*|Запрос прерван[^\]]*)\]/gi, '')
      .trim();
    try {
      await navigator.clipboard.writeText(cleanText);
      setCopiedMessageId(msg.id);
      setTimeout(() => {
        setCopiedMessageId((prev) => (prev === msg.id ? null : prev));
      }, 2000);
    } catch {
      const el = document.createElement('textarea');
      el.value = cleanText;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopiedMessageId(msg.id);
      setTimeout(() => setCopiedMessageId(null), 2000);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const maxSizeBytes = 15 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      setAttachmentNotice('Файл превышает допустимый размер 15 МБ.');
      return;
    }

    setAttachmentNotice(null);
    await onStageFileForDraft(file);
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const isSupportedImage =
      ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      ['png', 'jpg', 'jpeg', 'webp'].includes(ext);

    if (!isSupportedImage) {
      setAttachmentNotice(
        'Поддерживаются только изображения форматов PNG, JPG, JPEG и WEBP.'
      );
      return;
    }

    const maxImageBytes = 10 * 1024 * 1024;
    if (file.size > maxImageBytes) {
      setAttachmentNotice('Размер изображения превышает допустимый лимит 10 МБ.');
      return;
    }

    setAttachmentNotice(null);
    await onStageFileForDraft(file);
  };

  const handleClearChatClick = () => {
    setDraftPrompt('');
    setSelectedQuickPromptId(null);
    onClearDraftAttachment();
    setAttachmentNotice(null);
    onClearCurrentSession();
  };

  const handleStartHeaderRename = () => {
    if (!currentSession) return;
    setHeaderRenameDraft(currentSession.title);
    setIsRenamingHeader(true);
  };

  const handleCommitHeaderRename = async () => {
    if (!currentSession) return;
    const trimmed = headerRenameDraft.trim();
    if (!trimmed) {
      setIsRenamingHeader(false);
      return;
    }
    await onRenameSession(currentSession.id, trimmed);
    setIsRenamingHeader(false);
  };

  const handleConfirmDeleteSession = async () => {
    if (!sessionPendingDelete) return;
    setIsDeletingSession(true);
    try {
      await onDeleteSession(sessionPendingDelete.id);
      setSessionPendingDelete(null);
    } finally {
      setIsDeletingSession(false);
    }
  };

  const handleToggleDialogueAttachmentSelection = (id: string) => {
    setSelectedDialogueAttachmentIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleToggleSchoolDocumentSelection = (id: string) => {
    setSelectedSchoolDocumentIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isGenerating || isParsingFile) return;

    const trimmed = draftPrompt.trim();
    if (!trimmed && !draftAttachment) return;

    const isDraftImage = Boolean(
      draftAttachment?.dataUrl &&
        (draftAttachment.mimeType?.startsWith('image/') ||
          ['png', 'jpg', 'jpeg', 'webp'].includes(draftAttachment.extension))
    );

    if (
      (isDraftImage || hasSelectedImages) &&
      (providerSelection === 'ollama' || providerSelection === 'openrouter')
    ) {
      setAttachmentNotice(
        `Выбранный провайдер (${PROVIDER_LABELS_RU[providerSelection]}) не поддерживает мультимодальный анализ изображений. Пожалуйста, переключите провайдера на «Автовыбор ИИ» или «Google Gemini Free».`
      );
      return;
    }

    if (
      hasSelectedDocsWithText &&
      !consentedProviders.includes(primaryProviderForDocs)
    ) {
      setAttachmentNotice(
        primaryProviderForDocs === 'ollama'
          ? 'Пожалуйста, подтвердите обработку текста выбранного документа локальной моделью Ollama (галочка ниже).'
          : `Пожалуйста, подтвердите согласие на отправку извлечённого текста документа в ${PROVIDER_LABELS_RU[primaryProviderForDocs]} (галочка ниже) или отключите передачу документа.`
      );
      return;
    }

    setAttachmentNotice(null);
    onSendMessage(
      trimmed ||
        (isDraftImage
          ? `Внимательно проанализируй прикреплённое изображение (${draftAttachment?.name}) и дай подробный разбор.`
          : `Проанализируй прикреплённый документ: ${draftAttachment?.name}`),
      draftAttachment,
      {
        includeKnowledgeBase,
        selectedDialogueAttachmentIds,
        selectedSchoolDocumentIds,
        externalApiConsentConfirmed: consentedProviders.includes(
          primaryProviderForDocs
        ),
        consentedProviders,
        providerSelection,
      }
    );
    setDraftPrompt('');
    setSelectedQuickPromptId(null);
    setShowDocPickerPopover(false);
    setShowProviderPopover(false);
    onClearDraftAttachment();
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white">
      {/* 1. Active Dialogue Subheader Bar */}
      <div className="px-4 sm:px-6 py-3 border-b border-slate-200/80 bg-white flex flex-wrap items-center justify-between gap-3">
        {/* Left: Current Dialogue Title + Pin Badge + Inline Rename */}
        <div className="flex items-center gap-2 min-w-0">
          {currentSession ? (
            isRenamingHeader ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={headerRenameDraft}
                  autoFocus
                  onChange={(e) => setHeaderRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCommitHeaderRename();
                    } else if (e.key === 'Escape') {
                      setIsRenamingHeader(false);
                    }
                  }}
                  className="rounded-lg border border-[#00A8B5] bg-white px-2.5 py-1 text-xs sm:text-sm font-semibold text-slate-900 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleCommitHeaderRename}
                  className="p-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
                  title="Сохранить название"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsRenamingHeader(false)}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                  title="Отмена"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 min-w-0">
                {currentSession.isPinned && (
                  <span title="Закреплённый диалог" className="shrink-0">
                    <Pin
                      className={`w-3.5 h-3.5 rotate-45 ${
                        activeSchool === 'renderia'
                          ? 'text-[#65A30D]'
                          : 'text-[#D97706]'
                      }`}
                    />
                  </span>
                )}
                <h1
                  className="font-display font-bold text-sm sm:text-base text-slate-900 truncate"
                  title={currentSession.title}
                >
                  {currentSession.title}
                </h1>
                <button
                  type="button"
                  onClick={handleStartHeaderRename}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors shrink-0"
                  title="Переименовать диалог"
                  aria-label="Переименовать диалог"
                >
                  <PenLine className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onTogglePinSession(
                      currentSession.id,
                      !currentSession.isPinned
                    )
                  }
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors shrink-0"
                  title={
                    currentSession.isPinned
                      ? 'Открепить диалог'
                      : 'Закрепить диалог вверху списка'
                  }
                >
                  {currentSession.isPinned ? (
                    <PinOff className="w-3.5 h-3.5 text-amber-600" />
                  ) : (
                    <Pin className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            )
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="font-display font-bold text-sm sm:text-base text-slate-900 truncate">
                Новый диалог · {modeConfig.shortTitle} ({schoolConfig.name})
              </h1>
            </div>
          )}
        </div>

        {/* Right: Specialist Selector + Session Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Compact Specialist Switcher */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200/70">
            {AGENT_MODE_LIST.map((m) => {
              const active = m.id === activeMode;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onChangeMode(m.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                    active
                      ? 'bg-slate-900 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {m.shortTitle}
                </button>
              );
            })}
          </div>

          {/* Google Flow (Nano Banana) Workspace Toggle (Designer Mode Only) */}
          {activeMode === 'designer' && (
            <button
              type="button"
              onClick={handleToggleFlow}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                isFlowPanelOpen
                  ? 'bg-purple-600 text-white shadow-xs hover:bg-purple-700'
                  : 'bg-purple-50 text-purple-700 border border-purple-200/90 hover:bg-purple-100/90'
              }`}
              title={
                isElectronFlowAvailable
                  ? isFlowPanelOpen
                    ? 'Скрыть рабочую область Google Flow'
                    : 'Показать рабочую область Google Flow (Nano Banana)'
                  : 'Google Flow доступен в десктопном приложении Windows'
              }
            >
              <Sparkles className={`w-3.5 h-3.5 ${isFlowPanelOpen ? 'text-amber-300' : 'text-purple-600'}`} />
              <span>{isFlowPanelOpen ? 'Скрыть Flow' : 'Показать Flow'}</span>
              {!isElectronFlowAvailable && (
                <span className="px-1.5 py-0.2 rounded text-[10px] bg-purple-200/60 text-purple-900 font-bold">
                  Desktop
                </span>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => onCreateNewSession(activeMode, activeSchool)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeSchool === 'renderia'
                ? 'bg-[#84CC16] text-slate-950 hover:bg-[#76b813]'
                : 'bg-[#FFD700] text-slate-950 hover:bg-[#f0ca00]'
            }`}
            title="Создать новый независимый чат"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            <span>Новый чат</span>
          </button>

          {currentSession && (
            <>
              <button
                type="button"
                onClick={handleClearChatClick}
                disabled={currentMessages.length === 0}
                title="Очистить только сообщения внутри этого диалога"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 hover:text-amber-800 hover:bg-amber-50 border border-slate-200/80 disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                <Eraser className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Очистить</span>
              </button>

              <button
                type="button"
                onClick={() => setSessionPendingDelete(currentSession)}
                title="Полностью удалить диалог из истории и IndexedDB"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-red-600 hover:bg-red-50 border border-red-200/70 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Удалить чат</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Background Dialogue Generation Notice (when user switches dialogue while generating) */}
      {backgroundGeneratingSession && (
        <div className="px-4 sm:px-6 py-2 bg-amber-50/90 border-b border-amber-200/80 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-950">
          <div className="flex items-center gap-2 min-w-0">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#00A8B5] shrink-0" />
            <span className="truncate">
              В диалоге «<strong>{backgroundGeneratingSession.title}</strong>»
              выполняется запрос: {getGenerationStageLabelRu(generationStage)} (
              {generationElapsedSec} с)
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onSelectSession && (
              <button
                type="button"
                onClick={() => onSelectSession(backgroundGeneratingSession.id)}
                className="px-2.5 py-1 rounded-lg bg-white border border-amber-300 font-semibold text-amber-950 hover:bg-amber-100 transition-colors"
              >
                Перейти к диалогу
              </button>
            )}
            {onStopGeneration && (
              <button
                type="button"
                onClick={onStopGeneration}
                className="px-2.5 py-1 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors"
              >
                Остановить
              </button>
            )}
          </div>
        </div>
      )}

      {/* Linked Inter-Specialist Handoff Banner (Stage 1) */}
      {currentSession?.linkedHandoffPacket && (
        <div className="px-4 sm:px-6 py-2.5 bg-purple-50/90 border-b border-purple-200 text-xs text-purple-950 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <ArrowRightLeft className="w-4 h-4 text-purple-700 shrink-0" />
            <div className="truncate">
              {activeMode === currentSession.linkedHandoffPacket.toSpecialist ? (
                <>
                  <strong>
                    Поручение от специалиста «
                    {
                      AGENT_MODES[
                        currentSession.linkedHandoffPacket.fromSpecialist
                      ].title
                    }
                    »:
                  </strong>{' '}
                  {currentSession.linkedHandoffPacket.originalTask}
                </>
              ) : (
                <>
                  <strong>
                    Передано специалисту «
                    {
                      AGENT_MODES[
                        currentSession.linkedHandoffPacket.toSpecialist
                      ].title
                    }
                    » (статус:{' '}
                    {currentSession.linkedHandoffPacket.status === 'completed'
                      ? 'Выполнено'
                      : 'В работе'}
                    ):
                  </strong>{' '}
                  {currentSession.linkedHandoffPacket.originalTask}
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeMode === currentSession.linkedHandoffPacket.toSpecialist &&
              currentSession.linkedHandoffPacket.status !== 'completed' &&
              onReturnHandoffResult && (
                <button
                  type="button"
                  onClick={() => {
                    const latestAssistant = [...currentMessages]
                      .reverse()
                      .find((m) => m.role === 'assistant' && m.content.trim());
                    const latestArtifact =
                      currentSession.designArtifacts?.[0] ||
                      [...currentMessages]
                        .reverse()
                        .find((m) => m.designArtifact)?.designArtifact;
                    void onReturnHandoffResult({
                      handoffPacket: currentSession.linkedHandoffPacket!,
                      summary:
                        latestAssistant?.content.slice(0, 600) ||
                        'Визуальная концепция и макет подготовлены по заданию.',
                      artifact: latestArtifact,
                      navigateBack: true,
                    });
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-purple-700 text-white font-semibold hover:bg-purple-800 transition-colors shadow-2xs cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>
                    Вернуть результат в чат «
                    {
                      AGENT_MODES[
                        currentSession.linkedHandoffPacket.fromSpecialist
                      ].shortTitle
                    }
                    »
                  </span>
                </button>
              )}

            {activeMode === currentSession.linkedHandoffPacket.fromSpecialist &&
              onSelectSession && (
                <button
                  type="button"
                  onClick={() => {
                    const pkt = currentSession.linkedHandoffPacket!;
                    onChangeMode(pkt.toSpecialist);
                    onSelectSession(pkt.targetSessionId);
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white border border-purple-300 text-purple-900 font-semibold hover:bg-purple-100 transition-colors cursor-pointer"
                >
                  <Palette className="w-3.5 h-3.5 text-purple-700" />
                  <span>
                    Открыть чат «
                    {
                      AGENT_MODES[
                        currentSession.linkedHandoffPacket.toSpecialist
                      ].shortTitle
                    }
                    »
                  </span>
                </button>
              )}
          </div>
        </div>
      )}

      <div ref={splitContainerRef} className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* Chat Stream + Composer Column */}
        <div
          style={
            isFlowPanelOpen
              ? isFlowFullscreen
                ? { display: 'none' }
                : { width: `${chatWidthPercent}%` }
              : undefined
          }
          className={`flex flex-col min-w-0 ${
            isFlowPanelOpen
              ? isFlowFullscreen
                ? 'hidden'
                : 'border-r border-slate-200/80 shrink-0'
              : 'w-full'
          } ${isDraggingSplitter ? 'transition-none select-none' : 'transition-[width] duration-150'}`}
        >
          {/* 2. Messages Viewport (ChatGPT-Style Centered Stream) */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 pt-6 pb-20 bg-[#F9FAFB]/60">
        <div className="max-w-3xl mx-auto">
          {currentMessages.length === 0 ? (
            /* Warm Personal Welcome Screen for Anna with Expressive Typographic School Badge */
            <div className="py-6 sm:py-10 flex flex-col items-center text-center space-y-6">
              <div className="flex flex-col items-center space-y-3.5 max-w-xl">
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <span
                    className={`inline-flex items-center px-4 py-1.5 rounded-xl font-display font-extrabold text-base sm:text-lg tracking-wide shadow-2xs transition-colors duration-200 ${
                      activeSchool === 'kiberone'
                        ? 'bg-[#FFD700] text-slate-950'
                        : 'bg-[#84CC16] text-slate-950'
                    }`}
                  >
                    {schoolConfig.name}
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200/90 text-xs font-semibold text-slate-700 shadow-2xs">
                    <span>{modeConfig.title}</span>
                  </span>
                </div>

                <h2 className="font-display font-extrabold text-xl sm:text-2xl text-slate-900 tracking-tight">
                  Анна, над какой задачей для {schoolConfig.name} поработаем?
                </h2>

                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  {modeConfig.description}
                </p>

                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      onChangeSchool(
                        activeSchool === 'kiberone' ? 'renderia' : 'kiberone'
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200/90 text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    <span>
                      Переключить на{' '}
                      {activeSchool === 'kiberone' ? 'RENDERIA' : 'KIBERONE'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onNavigate('knowledge')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200/90 text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    <BookOpen className="w-3.5 h-3.5 text-[#00A8B5]" />
                    <span>
                      База знаний {schoolConfig.name}: {filledCount}/
                      {KNOWLEDGE_CATEGORIES.length}
                    </span>
                  </button>
                </div>
              </div>

              {/* Example Task Cards Grid (ChatGPT Starter Cards) */}
              <div className="w-full space-y-2.5 text-left">
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-semibold text-slate-500">
                    Примеры задач специалиста «{modeConfig.shortTitle}» (нажмите,
                    чтобы подставить в поле ввода):
                  </span>
                  {selectedQuickPromptId && (
                    <span className="text-xs font-semibold text-[#00A8B5] flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" />
                      Шаблон в поле ввода ниже
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {modeConfig.quickPrompts.map((qp) => {
                    const isSelected = selectedQuickPromptId === qp.id;
                    return (
                      <button
                        key={qp.id}
                        type="button"
                        onClick={() =>
                          handleSelectQuickPrompt(qp.id, qp.getPrompt)
                        }
                        className={`rounded-2xl p-4 text-left border transition-all flex flex-col justify-between gap-2 ${
                          isSelected
                            ? activeSchool === 'renderia'
                              ? 'bg-[#84CC16]/15 border-[#84CC16] shadow-xs'
                              : 'bg-[#F5B800]/15 border-[#F5B800] shadow-xs'
                            : 'bg-white hover:bg-slate-50 border-slate-200/90 shadow-2xs'
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                            {qp.category}
                          </div>
                          <div className="text-xs sm:text-sm font-bold text-slate-900">
                            {qp.label}
                          </div>
                        </div>
                        <div className="text-[11px] text-slate-500 line-clamp-2">
                          {qp.getPrompt(
                            schoolConfig.name,
                            schoolConfig.focusDescription
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            /* Active Conversation Messages List */
            <div className="space-y-5">
              {currentMessages.map((msg) => {
                const isUser = msg.role === 'user';
                const msgSchool = SCHOOLS[msg.schoolId];
                const msgMode = AGENT_MODES[msg.mode];
                const isHighlighted = highlightedMessageId === msg.id;

                return (
                  <div
                    key={msg.id}
                    id={`chat-msg-${msg.id}`}
                    className={`flex flex-col transition-all rounded-2xl ${
                      isUser ? 'items-end' : 'items-start'
                    } ${
                      isHighlighted
                        ? 'ring-2 ring-[#00A8B5] bg-[#00A8B5]/5 p-2'
                        : ''
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 mb-1.5 px-1">
                      {isUser && msg.delegatedByPixel ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#00A8B5]/15 text-[#007A85] border border-[#00A8B5]/30 font-bold text-[10px]">
                          <Sparkles className="w-3 h-3 text-[#00A8B5]" />
                          <span>
                            {msg.senderLabel || 'Пиксель · Поручение Анны'}
                          </span>
                        </span>
                      ) : (
                        <span className="font-semibold text-slate-700">
                          {isUser
                            ? 'Управляющая'
                            : `ИИ · ${msgMode.shortTitle}`}
                        </span>
                      )}
                      {!isUser && msg.delegatedByPixel && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-800 border border-cyan-200/80 text-[10px] font-semibold">
                          <span>Ответ по поручению Пикселя</span>
                        </span>
                      )}
                      {msg.delegationTaskId && (
                        <span className="font-mono-tabular px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200/70 text-[10px]">
                          ID: {msg.delegationTaskId}
                        </span>
                      )}
                      <span>·</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          msg.schoolId === 'kiberone'
                            ? 'bg-[#F5B800]/35 text-slate-900'
                            : 'bg-[#84CC16]/35 text-[#365314]'
                        }`}
                      >
                        {msgSchool.name}
                      </span>
                      <span>·</span>
                      <span className="font-mono-tabular">{msg.createdAt}</span>
                    </div>

                    <div
                      className={`max-w-2xl w-full sm:w-auto rounded-2xl px-4 py-3.5 text-sm leading-relaxed overflow-hidden ${
                        isUser
                          ? msg.delegatedByPixel
                            ? 'bg-slate-900 border-2 border-[#00A8B5]/50 text-white shadow-2xs'
                            : 'bg-slate-900 text-white shadow-2xs'
                          : msg.isError
                            ? 'bg-red-50/90 border border-red-200 text-red-950 shadow-2xs'
                            : 'bg-white border border-slate-200/90 text-slate-800 shadow-2xs'
                      }`}
                    >
                      {/* Unobtrusive Failover Notice Badge (Stage 3.3 Part 5) */}
                      {!isUser && msg.failoverNotice && (
                        <div className="mb-2.5 px-2.5 py-1.5 rounded-xl bg-amber-50/90 border border-amber-200/80 text-[11px] text-amber-900 flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span>{msg.failoverNotice}</span>
                        </div>
                      )}

                      {(msg.attachmentMeta || msg.attachmentName) && (() => {
                        const matchedAttachment = msg.attachmentMeta
                          ? dialogueAttachments.find(
                              (a) => a.id === msg.attachmentMeta!.id
                            )
                          : undefined;
                        const imageDataUrl =
                          msg.attachmentMeta?.dataUrl ||
                          matchedAttachment?.dataUrl;

                        return (
                          <div
                            className={`space-y-2 pb-2.5 mb-2.5 border-b ${
                              isUser
                                ? 'border-slate-700 text-[#F5B800]'
                                : 'border-slate-100 text-[#00A8B5]'
                            }`}
                          >
                            {imageDataUrl && (
                              <div className="overflow-hidden rounded-xl border border-slate-200/30 bg-black/15">
                                <img
                                  src={imageDataUrl}
                                  alt={
                                    msg.attachmentMeta?.name ||
                                    msg.attachmentName ||
                                    'Прикреплённое изображение'
                                  }
                                  className="max-h-72 w-auto max-w-full object-contain rounded-lg mx-auto"
                                />
                              </div>
                            )}
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <div className="flex items-center gap-2 min-w-0">
                                {imageDataUrl ? (
                                  <ImageIcon className="w-3.5 h-3.5 shrink-0" />
                                ) : (
                                  <FileText className="w-3.5 h-3.5 shrink-0" />
                                )}
                                <span className="truncate font-medium">
                                  {msg.attachmentMeta?.name || msg.attachmentName}
                                </span>
                                {msg.attachmentMeta && (
                                  <span className="text-[10px] opacity-80 font-mono-tabular shrink-0">
                                    ({formatFileSizeRu(msg.attachmentMeta.sizeBytes)})
                                  </span>
                                )}
                              </div>

                              {msg.attachmentMeta && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onInspectAttachmentInRightPanel(
                                      msg.attachmentMeta!.id
                                    )
                                  }
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold shrink-0 transition-colors ${
                                    isUser
                                      ? 'bg-slate-800 text-white hover:bg-slate-700'
                                      : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                                  }`}
                                >
                                  <Eye className="w-3 h-3" />
                                  <span>Просмотр</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      <div>
                        {msg.isStreaming ? (
                          <div className="space-y-3">
                            {/* Multi-stage progress header with elapsed time counter */}
                            <div className="rounded-xl p-3 bg-slate-50 border border-slate-200/90 space-y-2">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                                  <Loader2 className="w-4 h-4 animate-spin text-[#00A8B5] shrink-0" />
                                  <span>
                                    {getGenerationStageLabelRu(generationStage)}
                                  </span>
                                </div>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-[11px] font-mono-tabular text-slate-600 shrink-0">
                                  <Clock className="w-3 h-3 text-[#00A8B5]" />
                                  <span>{generationElapsedSec} с</span>
                                </span>
                              </div>

                              {/* 4-step stage bar */}
                              <div className="grid grid-cols-4 gap-1.5 pt-0.5">
                                {STAGE_ORDER.map((st, idx) => {
                                  const currentIdx = Math.max(
                                    0,
                                    STAGE_ORDER.indexOf(
                                      generationStage || 'connecting'
                                    )
                                  );
                                  const isDone = idx < currentIdx;
                                  const isCurrent = idx === currentIdx;
                                  return (
                                    <div
                                      key={st}
                                      className={`h-1.5 rounded-full transition-all ${
                                        isDone
                                          ? 'bg-[#00A8B5]'
                                          : isCurrent
                                            ? 'bg-[#00A8B5] animate-pulse'
                                            : 'bg-slate-200'
                                      }`}
                                      title={getGenerationStageLabelRu(st)}
                                    />
                                  );
                                })}
                              </div>

                              {/* 20-second slow response warning */}
                              {isSlowGeneration && (
                                <div className="rounded-lg p-2.5 bg-amber-50 border border-amber-200 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-2">
                                  <span>
                                    Модель пока формирует ответ. Можно
                                    продолжить ожидание или остановить запрос
                                  </span>
                                  {onStopGeneration && (
                                    <button
                                      type="button"
                                      onClick={onStopGeneration}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-600 text-white text-[11px] font-semibold hover:bg-red-700 transition-colors shrink-0"
                                    >
                                      <Square className="w-3 h-3 fill-current" />
                                      <span>Остановить</span>
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>

                            {msg.content && (
                              <div className="pt-1">
                                <MarkdownMessageContent
                                  content={msg.content}
                                  variant="chat"
                                  isUserMessage={false}
                                />
                                <span className="inline-block w-2 h-4 ml-1 align-middle bg-[#00A8B5] animate-pulse rounded-xs" />
                              </div>
                            )}
                          </div>
                        ) : (
                          <MarkdownMessageContent
                            content={msg.content}
                            variant="chat"
                            isUserMessage={isUser}
                          />
                        )}
                      </div>

                      {!isUser &&
                        msg.usedContextSummary &&
                        msg.usedContextSummary.length > 0 && (
                          <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                            <span className="font-semibold text-slate-600">
                              Использовано в запросе:
                            </span>
                            {msg.usedContextSummary.map((label, idx) => (
                              <span
                                key={`${msg.id}-ctx-${idx}`}
                                className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                        )}

                      {isUser && !msg.isStreaming && msg.content.trim() && (
                        <div className="mt-2 pt-1.5 border-t border-slate-700/70 flex justify-end">
                          <button
                            type="button"
                            onClick={() => handleCopyMessage(msg)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                          >
                            {copiedMessageId === msg.id ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-300">Скопировано</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Копировать</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}

                      {/* Inter-Specialist Handoff Result Card if returned */}
                      {msg.handoffResult && (
                        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 space-y-2 text-xs text-emerald-950">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold flex items-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              <span>
                                Результат от специалиста «
                                {
                                  AGENT_MODES[msg.handoffResult.toSpecialist]
                                    .title
                                }
                                »
                              </span>
                            </span>
                            <span className="text-[10px] font-mono-tabular px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                              Выполнено · {msg.handoffResult.completedAt}
                            </span>
                          </div>
                          {msg.handoffResult.layersSummary && (
                            <div className="text-[11px] text-emerald-900 bg-white/80 rounded-lg p-2 border border-emerald-200/70">
                              <strong>Слои макета:</strong>{' '}
                              {msg.handoffResult.layersSummary}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Interactive Designer Concept & Clarifying Questions Cards (Stage 1 & 2) */}
                      {!isUser &&
                        !msg.isStreaming &&
                        msg.interactiveDesignerPrompt && (
                          <div className="mt-4 pt-3 border-t border-purple-100 space-y-3.5">
                            {msg.interactiveDesignerPrompt.concepts.length >
                              0 && (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-bold text-purple-950 flex items-center gap-1.5">
                                    <Palette className="w-4 h-4 text-purple-600" />
                                    <span>
                                      Предложенные визуальные концепции (выберите
                                      для генерации макета):
                                    </span>
                                  </span>
                                </div>
                                <div className="grid grid-cols-1 gap-2.5">
                                  {msg.interactiveDesignerPrompt.concepts.map(
                                    (concept, cIdx) => {
                                      const isSelectedConcept =
                                        msg.interactiveDesignerPrompt
                                          ?.selectedConceptId === concept.id;
                                      return (
                                        <div
                                          key={concept.id || cIdx}
                                          onClick={() => {
                                            if (
                                              currentSession &&
                                              onUpdateDesignerInteractivePrompt
                                            ) {
                                              onUpdateDesignerInteractivePrompt(
                                                currentSession.id,
                                                msg.id,
                                                (prev) => ({
                                                  ...prev,
                                                  selectedConceptId: concept.id,
                                                })
                                              );
                                            }
                                            setDesignAspectRatio(
                                              concept.recommendedAspectRatio ||
                                                '3:4'
                                            );
                                          }}
                                          className={`rounded-xl p-3 border transition-all cursor-pointer space-y-2 ${
                                            isSelectedConcept
                                              ? 'bg-purple-50/90 border-purple-400 shadow-xs'
                                              : 'bg-slate-50/70 hover:bg-slate-100/80 border-slate-200'
                                          }`}
                                        >
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                              <span className="px-2 py-0.5 rounded-md bg-purple-700 text-white text-[10px] font-bold">
                                                Концепция {cIdx + 1}
                                              </span>
                                              <span className="font-bold text-xs text-slate-900">
                                                {concept.title}
                                              </span>
                                            </div>
                                            <span className="text-[10px] font-mono-tabular px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700 font-semibold">
                                              Формат:{' '}
                                              {concept.recommendedAspectRatio}
                                            </span>
                                          </div>

                                          <p className="text-xs text-slate-700 leading-relaxed">
                                            {concept.visualDirection}
                                          </p>

                                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 pt-1 text-[11px]">
                                            <div className="rounded-lg bg-white p-2 border border-slate-200/80">
                                              <span className="text-[10px] font-semibold text-slate-400 block">
                                                Слой «Заголовок»:
                                              </span>
                                              <span className="font-bold text-slate-900">
                                                {concept.suggestedHeadline ||
                                                  '—'}
                                              </span>
                                            </div>
                                            <div className="rounded-lg bg-white p-2 border border-slate-200/80">
                                              <span className="text-[10px] font-semibold text-slate-400 block">
                                                Слой «Оффер»:
                                              </span>
                                              <span className="text-slate-800">
                                                {concept.suggestedOffer || '—'}
                                              </span>
                                            </div>
                                            <div className="rounded-lg bg-white p-2 border border-slate-200/80">
                                              <span className="text-[10px] font-semibold text-slate-400 block">
                                                Слой «Кнопка CTA»:
                                              </span>
                                              <span className="font-semibold text-purple-800">
                                                {concept.suggestedCta || '—'}
                                              </span>
                                            </div>
                                          </div>

                                          {onGenerateDesignArtifact && (
                                            <div className="pt-1 flex flex-wrap items-center justify-end gap-2">
                                              <button
                                                type="button"
                                                disabled={isGeneratingDesignImage}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  const effectiveModelId =
                                                    resolveDesignerModelId(
                                                      designModelId,
                                                      Boolean(
                                                        draftAttachment?.dataUrl
                                                      )
                                                    );
                                                  void onGenerateDesignArtifact({
                                                    sessionId:
                                                      currentSession?.id,
                                                    schoolId: activeSchool,
                                                    title: concept.title,
                                                    prompt:
                                                      concept.imageGenerationPrompt ||
                                                      concept.visualDirection,
                                                    aspectRatio:
                                                      concept.recommendedAspectRatio ||
                                                      designAspectRatio,
                                                    qualityMode:
                                                      designQualityMode,
                                                    templatePreset:
                                                      designTemplatePreset,
                                                    providerId:
                                                      designProviderId,
                                                    modelId: effectiveModelId,
                                                    concept,
                                                    referenceImageDataUrl:
                                                      draftAttachment?.dataUrl,
                                                  });
                                                }}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white text-xs font-semibold disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                                              >
                                                {isGeneratingDesignImage ? (
                                                  <>
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    <span>
                                                      Генерация макета...
                                                    </span>
                                                  </>
                                                ) : (
                                                  <>
                                                    <Wand2 className="w-3.5 h-3.5" />
                                                    <span>
                                                      Сгенерировать макет по
                                                      концепции {cIdx + 1}
                                                    </span>
                                                  </>
                                                )}
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    }
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Interactive Clarifying Questions */}
                            {msg.interactiveDesignerPrompt.questions.length >
                              0 && (
                              <div className="rounded-xl bg-purple-50/60 border border-purple-200/80 p-3 space-y-2.5">
                                <div className="text-xs font-bold text-purple-950">
                                  Уточняющие вопросы Дизайнера (нажмите на
                                  вариант, чтобы выбрать):
                                </div>
                                {msg.interactiveDesignerPrompt.questions.map(
                                  (q) => (
                                    <div key={q.id} className="space-y-1.5">
                                      <div className="text-xs font-semibold text-slate-800">
                                        {q.question}
                                      </div>
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        {q.options.map((opt) => {
                                          const isChosen =
                                            q.selectedOption === opt;
                                          return (
                                            <button
                                              key={opt}
                                              type="button"
                                              onClick={() => {
                                                if (
                                                  currentSession &&
                                                  onUpdateDesignerInteractivePrompt
                                                ) {
                                                  onUpdateDesignerInteractivePrompt(
                                                    currentSession.id,
                                                    msg.id,
                                                    (prev) => ({
                                                      ...prev,
                                                      questions:
                                                        prev.questions.map(
                                                          (item) =>
                                                            item.id === q.id
                                                              ? {
                                                                  ...item,
                                                                  selectedOption:
                                                                    opt,
                                                                }
                                                              : item
                                                        ),
                                                    })
                                                  );
                                                }
                                              }}
                                              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                                                isChosen
                                                  ? 'bg-purple-700 text-white border-purple-700 font-semibold'
                                                  : 'bg-white text-slate-700 border-slate-200 hover:bg-purple-100/60'
                                              }`}
                                            >
                                              {opt}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )
                                )}
                                <div className="pt-1 flex justify-end">
                                  <button
                                    type="button"
                                    disabled={isGenerating}
                                    onClick={() => {
                                      const promptData =
                                        msg.interactiveDesignerPrompt!;
                                      const chosenConcept =
                                        promptData.concepts.find(
                                          (c) =>
                                            c.id ===
                                            promptData.selectedConceptId
                                        ) || promptData.concepts[0];
                                      const answersText = promptData.questions
                                        .filter((q) => q.selectedOption)
                                        .map(
                                          (q) =>
                                            `- ${q.question}: **${q.selectedOption}**`
                                        )
                                        .join('\n');
                                      const replyText = [
                                        chosenConcept
                                          ? `Выбираю концепцию: «${chosenConcept.title}» (формат ${chosenConcept.recommendedAspectRatio}).`
                                          : '',
                                        answersText
                                          ? `Мои ответы на уточнения:\n${answersText}`
                                          : '',
                                      ]
                                        .filter(Boolean)
                                        .join('\n\n');
                                      if (replyText.trim()) {
                                        onSendMessage(replyText, null, {
                                          includeKnowledgeBase,
                                          selectedDialogueAttachmentIds,
                                          selectedSchoolDocumentIds,
                                          externalApiConsentConfirmed: true,
                                        });
                                      }
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer"
                                  >
                                    <Check className="w-3.5 h-3.5 text-[#FFD700]" />
                                    <span>Подтвердить выбор и ответы</span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                      {/* In-Chat Generated Design Artifact Preview Card with Live Editable Overlay Layers (Stage 2) */}
                      {msg.designArtifact && (() => {
                        const art = msg.designArtifact;
                        const displayVer =
                          art.pendingVersion ||
                          art.versions.find(
                            (v) => v.id === art.activeVersionId
                          ) ||
                          art.versions[art.versions.length - 1];
                        if (!displayVer) return null;

                        return (
                          <div className="mt-3.5 rounded-2xl border border-purple-200 bg-slate-950/95 text-white overflow-hidden shadow-md">
                            <div className="px-3.5 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                              <div className="flex items-center gap-2">
                                <Layers className="w-4 h-4 text-purple-400" />
                                <span className="font-bold">{art.title}</span>
                                <span className="px-2 py-0.5 rounded bg-purple-900/70 text-purple-200 text-[10px] font-mono-tabular">
                                  {displayVer.aspectRatio}
                                </span>
                                {art.pendingVersion && (
                                  <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 text-[10px] font-bold">
                                    Ожидает подтверждения
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] text-slate-400">
                                Версий: {art.versions.length}
                              </span>
                            </div>

                            {/* Composite Preview (Clean Background + Editable Overlay Layers) */}
                            <div className="relative w-full max-h-[420px] flex items-center justify-center bg-slate-950 p-3 overflow-hidden">
                              <div className="relative inline-block max-w-full">
                                <img
                                  src={displayVer.backgroundImageDataUrl}
                                  alt={art.title}
                                  className="max-h-[380px] w-auto rounded-xl object-contain block mx-auto"
                                />
                                {/* Live Editable Overlay Layers */}
                                {displayVer.layers
                                  .filter((l) => l.visible && l.text.trim())
                                  .map((layer) => (
                                    <div
                                      key={layer.id}
                                      style={{
                                        left: `${layer.xPercent}%`,
                                        top: `${layer.yPercent}%`,
                                        color: layer.textColor,
                                        backgroundColor:
                                          layer.backgroundColor ||
                                          'rgba(15,23,42,0.75)',
                                        textAlign: layer.align || 'left',
                                        fontSize: `${Math.max(10, Math.round((layer.fontSizePx || 14) * 0.65))}px`,
                                      }}
                                      className={`absolute max-w-[84%] px-2.5 py-1 rounded-lg shadow-sm backdrop-blur-xs pointer-events-none ${
                                        layer.type === 'headline'
                                          ? 'font-display font-extrabold leading-tight'
                                          : layer.type === 'cta'
                                            ? 'font-bold px-3 py-1.5 rounded-xl shadow-md'
                                            : layer.type === 'school_badge'
                                              ? 'font-extrabold uppercase tracking-wider'
                                              : 'leading-snug'
                                      }`}
                                    >
                                      {layer.text}
                                    </div>
                                  ))}
                              </div>
                            </div>

                            <div className="px-3.5 py-2.5 bg-slate-900 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {onInspectDesignArtifactInRightPanel && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onInspectDesignArtifactInRightPanel(art.id)
                                    }
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                                  >
                                    <Layers className="w-3.5 h-3.5" />
                                    <span>
                                      Редактировать слои и области в правой
                                      панели
                                    </span>
                                  </button>
                                )}

                                {onGenerateDesignArtifact && (
                                  <button
                                    type="button"
                                    disabled={isGeneratingDesignImage}
                                    onClick={() =>
                                      void onGenerateDesignArtifact({
                                        sessionId: currentSession?.id,
                                        schoolId: art.schoolId,
                                        title: art.title,
                                        prompt: displayVer.promptUsed,
                                        aspectRatio: displayVer.aspectRatio,
                                        qualityMode: displayVer.qualityMode,
                                        templatePreset: art.templatePreset,
                                        existingArtifactId: art.id,
                                      })
                                    }
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                                  >
                                    <Wand2 className="w-3.5 h-3.5 text-purple-400" />
                                    <span>Ещё вариант</span>
                                  </button>
                                )}
                              </div>

                              {currentSession?.linkedHandoffPacket &&
                                currentSession.linkedHandoffPacket.status !==
                                  'completed' &&
                                onReturnHandoffResult && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void onReturnHandoffResult({
                                        handoffPacket:
                                          currentSession.linkedHandoffPacket!,
                                        summary: `Утверждён макет «${art.title}» (${displayVer.label}).`,
                                        artifact: art,
                                        navigateBack: true,
                                      })
                                    }
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>
                                      Вернуть макет специалисту «
                                      {
                                        AGENT_MODES[
                                          currentSession.linkedHandoffPacket
                                            .fromSpecialist
                                        ].shortTitle
                                      }
                                      »
                                    </span>
                                  </button>
                                )}
                            </div>
                          </div>
                        );
                      })()}

                      {!isUser && !msg.isStreaming && (
                        <div className="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[10px] text-slate-400 font-mono-tabular">
                            {formatMessageProviderAttribution(
                              msg.providerId,
                              msg.modelName,
                              geminiStatus?.model
                            )}
                          </span>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {/* Inter-Specialist Handoff Button (Stage 1) */}
                            {onHandoffTaskToSpecialist &&
                              activeMode !== 'designer' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const firstUserMsg = currentMessages.find(
                                      (m) => m.role === 'user'
                                    );
                                    setHandoffModalState({
                                      isOpen: true,
                                      toSpecialist: 'designer',
                                      sourceMessageId: msg.id,
                                      originalTask:
                                        firstUserMsg?.content.slice(0, 300) ||
                                        currentSession?.title ||
                                        'Разработка визуального креатива по задаче',
                                      goalAndAudience: `${schoolConfig.name}: ${schoolConfig.focusDescription}`,
                                      approvedOfferAndText: msg.content.slice(
                                        0,
                                        800
                                      ),
                                      additionalRequirements:
                                        'Соблюдать брендбук школы, разделить фоновое изображение и редактируемые слои заголовка, оффера и кнопки CTA.',
                                      discussionContext: currentMessages
                                        .slice(-4)
                                        .map(
                                          (m) =>
                                            `${m.role === 'user' ? 'Анна' : modeConfig.shortTitle}: ${m.content.slice(0, 220)}`
                                        )
                                        .join('\n'),
                                    });
                                  }}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-purple-50 text-purple-800 border border-purple-200 hover:bg-purple-100 transition-colors cursor-pointer"
                                  title="Передать задачу, утверждённый оффер и контекст Дизайнеру"
                                >
                                  <Palette className="w-3.5 h-3.5 text-purple-600" />
                                  <span>Передать Дизайнеру</span>
                                </button>
                              )}

                            {(msg.isError ||
                              msg.content.includes('[Генерация')) &&
                              onRetryLastMessage && (
                                <button
                                  type="button"
                                  disabled={isGenerating}
                                  onClick={() =>
                                    onRetryLastMessage(currentSession?.id)
                                  }
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 transition-colors"
                                >
                                  <RotateCcw className="w-3.5 h-3.5 text-[#FFD700]" />
                                  <span>Повторить отправку</span>
                                </button>
                              )}
                            <button
                              type="button"
                              onClick={() => handleCopyMessage(msg)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                            >
                              {copiedMessageId === msg.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  <span className="text-emerald-700">
                                    Скопировано
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Копировать</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Unified Voice Playback Toolbar (uses the single unified Pixel voice) */}
                      {!isUser &&
                        !msg.isStreaming &&
                        !msg.isError &&
                        msg.content.trim() && (() => {
                          const isThisMsgActive =
                            playbackState.messageId === msg.id ||
                            playbackState.messageId === `pixel-verbatim-${msg.id}`;
                          return (
                            <div className="mt-2.5 pt-2 border-t border-slate-100/90 flex flex-wrap items-center justify-between gap-2 bg-slate-50/80 -mx-4 -mb-3.5 px-4 py-2 rounded-b-2xl">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {isThisMsgActive &&
                                playbackState.status === 'loading' ? (
                                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-200">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#00A8B5]" />
                                    <span>
                                      {playbackState.provider === 'gemini'
                                        ? `Озвучка Пикселем (${playbackState.voiceName || 'Aoede'})...`
                                        : 'Запуск озвучки...'}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        voiceManager.stopSpeaking()
                                      }
                                      title="Отмена"
                                      className="ml-1 p-0.5 text-slate-500 hover:text-slate-900"
                                    >
                                      <Square className="w-2.5 h-2.5 fill-current" />
                                    </button>
                                  </div>
                                ) : isThisMsgActive &&
                                  playbackState.status === 'playing' ? (
                                  <div className="inline-flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        voiceManager.pauseMessage()
                                      }
                                      title="Приостановить воспроизведение"
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#00A8B5] text-white hover:bg-[#00929d] transition-colors shadow-2xs"
                                    >
                                      <Pause className="w-3.5 h-3.5 fill-current" />
                                      <span>Пауза</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        voiceManager.stopSpeaking()
                                      }
                                      title="Остановить воспроизведение"
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-200 hover:bg-slate-300 text-slate-800 transition-colors"
                                    >
                                      <Square className="w-3 h-3 fill-current" />
                                      <span>Остановить</span>
                                    </button>
                                    <span className="flex items-center gap-0.5 px-1 text-[#00A8B5]">
                                      <span className="w-1 h-3 bg-[#00A8B5] rounded-full animate-pulse" />
                                      <span className="w-1 h-4 bg-[#00A8B5] rounded-full animate-bounce" />
                                      <span className="w-1 h-2 bg-[#00A8B5] rounded-full animate-pulse" />
                                    </span>
                                  </div>
                                ) : isThisMsgActive &&
                                  playbackState.status === 'paused' ? (
                                  <div className="inline-flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        voiceManager.resumeMessage()
                                      }
                                      title="Продолжить воспроизведение"
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-2xs"
                                    >
                                      <Play className="w-3.5 h-3.5 fill-current" />
                                      <span>Продолжить</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        voiceManager.stopSpeaking()
                                      }
                                      title="Остановить"
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-200 hover:bg-slate-300 text-slate-800 transition-colors"
                                    >
                                      <Square className="w-3 h-3 fill-current" />
                                      <span>Остановить</span>
                                    </button>
                                    <span className="text-[11px] text-amber-700 font-medium">
                                      На паузе
                                    </span>
                                  </div>
                                ) : (
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void voiceManager.playVerbatimSpecialistMessage(
                                          msg.id,
                                          msg.content,
                                          {
                                            specialistTitle: msgMode.shortTitle,
                                            schoolName: msgSchool.name,
                                          }
                                        )
                                      }
                                      title="Прочитать ответ единым голосом Пикселя"
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200/90 transition-colors shadow-2xs"
                                    >
                                      <Volume2 className="w-3.5 h-3.5 text-[#00A8B5]" />
                                      <span>Озвучить Пикселем</span>
                                    </button>
                                  </div>
                                )}

                                {isThisMsgActive &&
                                  playbackState.provider === 'browser' && (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-900 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded-md font-medium">
                                      <Info className="w-3 h-3 text-amber-600 shrink-0" />
                                      <span>
                                        {playbackState.isFallback
                                          ? (playbackState.fallbackReason || 'Системный голос браузера')
                                          : 'Системный голос браузера'}
                                      </span>
                                    </span>
                                  )}

                                {isThisMsgActive &&
                                  playbackState.provider === 'gemini' &&
                                  playbackState.status !== 'error' && (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-cyan-900 bg-cyan-50 border border-cyan-200 px-2 py-0.5 rounded-md font-medium">
                                      <Sparkles className="w-3 h-3 text-cyan-600 shrink-0" />
                                      <span>
                                        Единый голос: <b>{playbackState.voiceName || 'Aoede'}</b>
                                      </span>
                                    </span>
                                  )}

                                {isThisMsgActive &&
                                  playbackState.status === 'error' && (
                                    <span className="text-[10px] text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-md">
                                      {playbackState.errorMessage ||
                                        'Ошибка озвучки'}
                                    </span>
                                  )}
                              </div>

                              {onOpenVoiceSettings && (
                                <button
                                  type="button"
                                  onClick={onOpenVoiceSettings}
                                  title="Настройки единого голоса Пикселя"
                                  className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
                                >
                                  <Sliders className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          );
                        })()}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* 3. Bottom Composer Area (ChatGPT Style) */}
      <div className="border-t border-slate-200/80 bg-white px-4 sm:px-6 py-3.5">
        <form
          onSubmit={handleSubmit}
          className="max-w-3xl mx-auto space-y-2.5"
        >
          {/* Compact Quick Prompt Chips when conversation already has messages */}
          {currentMessages.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <span className="text-[11px] font-semibold text-slate-400 shrink-0 pr-1">
                Шаблоны:
              </span>
              {modeConfig.quickPrompts.map((qp) => {
                const isSelected = selectedQuickPromptId === qp.id;
                return (
                  <button
                    key={qp.id}
                    type="button"
                    onClick={() => handleSelectQuickPrompt(qp.id, qp.getPrompt)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap border transition-colors ${
                      isSelected
                        ? activeSchool === 'renderia'
                          ? 'bg-[#84CC16]/20 border-[#84CC16] text-slate-950 font-semibold'
                          : 'bg-[#F5B800]/20 border-[#F5B800] text-slate-950 font-semibold'
                        : 'bg-slate-50 hover:bg-slate-100 border-slate-200/80 text-slate-600'
                    }`}
                  >
                    {qp.label}
                  </button>
                );
              })}
            </div>
          )}

          {attachmentNotice && (
            <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <span>{attachmentNotice}</span>
              <button
                type="button"
                onClick={() => setAttachmentNotice(null)}
                className="text-amber-700 hover:text-amber-950"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Pre-send Attachment Preview Card (Image Thumbnail or Document Preview & Remove) */}
          {draftAttachment && (() => {
            const isDraftImage = Boolean(
              draftAttachment.dataUrl &&
                (draftAttachment.mimeType?.startsWith('image/') ||
                  ['png', 'jpg', 'jpeg', 'webp'].includes(
                    draftAttachment.extension
                  ))
            );
            return (
              <div className="rounded-xl bg-slate-50 border border-slate-200/90 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {isDraftImage && draftAttachment.dataUrl ? (
                      <img
                        src={draftAttachment.dataUrl}
                        alt={draftAttachment.name}
                        className="w-14 h-14 rounded-xl object-cover border border-slate-200 bg-white shrink-0 shadow-2xs"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-[#00A8B5] shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900 truncate">
                          {draftAttachment.name}
                        </span>
                        {isDraftImage ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-900 text-[10px] font-bold">
                            <ImageIcon className="w-3 h-3 text-emerald-700" />
                            <span>Визуальный анализ ИИ</span>
                          </span>
                        ) : (
                          renderStatusBadge(
                            draftAttachment.status || 'processed'
                          )
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono-tabular mt-0.5">
                        <span className="uppercase font-bold text-slate-700">
                          .{draftAttachment.extension || 'file'}
                        </span>
                        <span>·</span>
                        <span>
                          {formatFileSizeRu(draftAttachment.sizeBytes)}
                        </span>
                        {!isDraftImage && (
                          <>
                            <span>·</span>
                            <span>
                              Текст: {draftAttachment.extractedText.length} симв.
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {!isDraftImage && (
                      <button
                        type="button"
                        onClick={() =>
                          onInspectAttachmentInRightPanel(draftAttachment.id)
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                      >
                        <Eye className="w-3 h-3" />
                        <span>Проверить текст</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onClearDraftAttachment}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                      aria-label="Убрать прикреплённый файл"
                      title="Удалить прикреплённое изображение или файл"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {isDraftImage ? (
                  providerSelection === 'ollama' ||
                  providerSelection === 'openrouter' ? (
                    <div className="rounded-lg p-2.5 bg-amber-50 border border-amber-300 text-[11px] text-amber-950 flex flex-wrap items-center justify-between gap-2">
                      <span>
                        Выбранный провайдер (
                        <strong>{PROVIDER_LABELS_RU[providerSelection]}</strong>
                        ) не поддерживает анализ изображений. Для отправки
                        картинки переключите режим на{' '}
                        <strong>Автовыбор ИИ</strong> или{' '}
                        <strong>Google Gemini Free</strong>.
                      </span>
                      {onChangeProviderSelection && (
                        <button
                          type="button"
                          onClick={() => onChangeProviderSelection('auto')}
                          className="px-2.5 py-1 rounded-lg bg-slate-900 text-white font-semibold text-[11px] hover:bg-slate-800 shrink-0"
                        >
                          Включить Автовыбор ИИ
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-lg p-2 bg-emerald-50/70 border border-emerald-200/80 text-[11px] text-emerald-950">
                      Изображение будет передано модели как визуальные данные
                      вместе с вашим вопросом после нажатия «Отправить».
                    </div>
                  )
                ) : (
                  <>
                    {draftAttachment.warning && (
                      <div className="rounded-lg p-2 bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                        {draftAttachment.warning}
                      </div>
                    )}

                    {(!draftAttachment.extractedText ||
                      draftAttachment.extractedText.trim().length === 0) && (
                      <div className="rounded-lg p-2 bg-slate-100 border border-slate-200 text-[11px] text-slate-700">
                        Ограничение: в этом файле отсутствует извлечённый
                        текстовый слой (например, скан без OCR). Он сохранится в
                        материалах диалога, но его текст не может быть передан в
                        текстовый запрос.
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}

          {/* Selective Context Controls (Knowledge Base + Explicit Document Selection) */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-50 border border-slate-200/90 text-[11px] font-medium text-slate-700 cursor-pointer hover:bg-slate-100 transition-colors">
                <input
                  type="checkbox"
                  checked={includeKnowledgeBase && filledCount > 0}
                  disabled={filledCount === 0}
                  onChange={(e) => setIncludeKnowledgeBase(e.target.checked)}
                  className="rounded border-slate-300 text-slate-900 focus:ring-[#00A8B5]"
                />
                <BookOpen className="w-3.5 h-3.5 text-[#00A8B5]" />
                <span>
                  База знаний {schoolConfig.name} ({filledCount}/
                  {KNOWLEDGE_CATEGORIES.length})
                </span>
              </label>

              {(dialogueAttachments.length > 0 ||
                schoolDocuments.length > 0) && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowDocPickerPopover((v) => !v)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-medium transition-colors ${
                      selectedDialogueAttachmentIds.length +
                        selectedSchoolDocumentIds.length >
                      0
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50 text-slate-700 border-slate-200/90 hover:bg-slate-100'
                    }`}
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-[#F5B800]" />
                    <span>
                      Выбрать документы для запроса (
                      {selectedDialogueAttachmentIds.length +
                        selectedSchoolDocumentIds.length}
                      )
                    </span>
                  </button>

                  {showDocPickerPopover && (
                    <div className="absolute bottom-full left-0 mb-2 w-80 sm:w-96 rounded-2xl bg-white border border-slate-200 shadow-xl p-3.5 z-40 space-y-3 text-xs">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <span className="font-bold text-slate-900">
                          Документы для отправки в этот запрос
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowDocPickerPopover(false)}
                          className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Документы из IndexedDB никогда не отправляются
                        автоматически. Отметьте только те материалы школы{' '}
                        <strong>{schoolConfig.name}</strong> или текущего
                        диалога, которые нужны специалисту сейчас:
                      </p>

                      {dialogueAttachments.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Файлы текущего диалога ({dialogueAttachments.length})
                          </div>
                          <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                            {dialogueAttachments.map((att) => {
                              const isImg = Boolean(
                                att.dataUrl &&
                                  (att.mimeType?.startsWith('image/') ||
                                    ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(att.extension))
                              );
                              const hasText =
                                (att.extractedText || '').trim().length > 0 &&
                                att.status !== 'error';
                              const isSendable = hasText || isImg;
                              return (
                                <label
                                  key={att.id}
                                  className={`flex items-start gap-2 p-1.5 rounded-lg border text-[11px] ${
                                    isSendable
                                      ? 'border-slate-200/80 hover:bg-slate-50 cursor-pointer'
                                      : 'border-slate-100 bg-slate-50/60 text-slate-400 cursor-not-allowed'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    disabled={!isSendable}
                                    checked={selectedDialogueAttachmentIds.includes(
                                      att.id
                                    )}
                                    onChange={() =>
                                      handleToggleDialogueAttachmentSelection(
                                        att.id
                                      )
                                    }
                                    className="mt-0.5 rounded border-slate-300"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="font-medium text-slate-800 truncate">
                                      {att.name}
                                    </div>
                                    <div className="text-[10px] text-slate-500">
                                      {isImg
                                        ? 'Изображение (мультимодальный анализ Gemini)'
                                        : hasText
                                          ? `${att.extractedText.length.toLocaleString('ru-RU')} симв.`
                                          : 'Нет текстового слоя (не отправляется)'}
                                    </div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {schoolDocuments.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                            <span>Материалы Базы знаний ({schoolDocuments.length})</span>
                            <span className="text-[9px] lowercase font-normal text-slate-400">
                              {schoolConfig.name} + общие
                            </span>
                          </div>
                          <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                            {schoolDocuments.map((doc) => {
                              const isImg = Boolean(
                                doc.dataUrl &&
                                  (doc.fileType === 'image' ||
                                    ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(doc.extension))
                              );
                              const hasText =
                                (doc.extractedText || '').trim().length > 0 &&
                                doc.status !== 'error';
                              const isSendable = hasText || isImg;
                              return (
                                <label
                                  key={doc.id}
                                  className={`flex items-start gap-2 p-1.5 rounded-lg border text-[11px] ${
                                    isSendable
                                      ? 'border-slate-200/80 hover:bg-slate-50 cursor-pointer'
                                      : 'border-slate-100 bg-slate-50/60 text-slate-400 cursor-not-allowed'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    disabled={!isSendable}
                                    checked={selectedSchoolDocumentIds.includes(
                                      doc.id
                                    )}
                                    onChange={() =>
                                      handleToggleSchoolDocumentSelection(doc.id)
                                    }
                                    className="mt-0.5 rounded border-slate-300"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="font-medium text-slate-800 truncate flex items-center gap-1">
                                      <span className="truncate">{doc.name}</span>
                                      {doc.schoolId === 'all' && (
                                        <span className="shrink-0 px-1 py-0.2 rounded text-[9px] bg-slate-100 text-slate-600 font-medium">
                                          обе
                                        </span>
                                      )}
                                      {doc.visualRole && (
                                        <span className="shrink-0 px-1 py-0.2 rounded text-[9px] bg-[#00A8B5]/10 text-[#00A8B5] font-semibold">
                                          {doc.visualRole === 'logo'
                                            ? 'лого'
                                            : doc.visualRole === 'brandbook'
                                              ? 'брендбук'
                                              : doc.visualRole === 'template'
                                                ? 'шаблон'
                                                : doc.visualRole === 'reference'
                                                  ? 'реф'
                                                  : doc.visualRole}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-slate-500">
                                      {isImg
                                        ? 'Визуальный материал (анализ Gemini)'
                                        : doc.slides && doc.slides.length > 0
                                          ? `Презентация (${doc.slides.length} сл., ${(doc.extractedText || '').length} симв.)`
                                          : hasText
                                            ? `${(doc.extractedText || '').length.toLocaleString('ru-RU')} симв.`
                                            : 'Нет текстового слоя'}
                                    </div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* Free AI Provider Selector & Health Popover (Stage 3.3 Parts 3–6) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowProviderPopover((v) => !v)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-50 border border-slate-200/90 text-[11px] font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                title="Режим выбора бесплатного ИИ-провайдера и статус подключения"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#00A8B5]" />
                <span>
                  {providerSelection === 'auto'
                    ? 'Автовыбор ИИ (Free)'
                    : `Провайдер: ${PROVIDER_SHORT_LABELS_RU[providerSelection]}`}
                </span>
              </button>

              {showProviderPopover && (
                <div className="absolute bottom-full right-0 mb-2 w-80 sm:w-96 rounded-2xl bg-white border border-slate-200 shadow-xl p-3.5 z-40 space-y-3 text-xs">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="font-bold text-slate-900">
                      Бесплатные ИИ-провайдеры (Этап 3.3)
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowProviderPopover(false)}
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Selection Mode */}
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-slate-600">
                      Режим маршрутизации запросов:
                    </label>
                    <select
                      value={providerSelection}
                      onChange={(e) =>
                        onChangeProviderSelection?.(
                          e.target.value as AIProviderSelectionMode
                        )
                      }
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00A8B5]"
                    >
                      <option value="auto">
                        Автоматический выбор модели (1. Gemini → 2. OpenRouter → 3. Ollama)
                      </option>
                      <option value="gemini">
                        Только Google Gemini Free (основной)
                      </option>
                      <option value="openrouter">
                        Только OpenRouter Free (openrouter/free)
                      </option>
                      <option value="ollama">
                        Только Ollama Local (127.0.0.1:11434)
                      </option>
                    </select>
                  </div>

                  {/* Provider Status Cards */}
                  {providersState && (
                    <div className="space-y-1.5">
                      {(
                        ['gemini', 'openrouter', 'ollama'] as AIProviderId[]
                      ).map((pid, idx) => {
                        const p = providersState.providers[pid];
                        if (!p) return null;
                        const isConnectedOrAvail =
                          p.status === 'connected' || p.status === 'available';
                        const isQuotaOrDown =
                          p.status === 'quota_exceeded' ||
                          p.status === 'temporarily_unavailable';
                        return (
                          <div
                            key={pid}
                            className="rounded-xl p-2.5 bg-slate-50 border border-slate-200/80 space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-slate-900 text-[11px]">
                                {idx + 1}. {p.label}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                  isConnectedOrAvail
                                    ? 'bg-emerald-100 text-emerald-900'
                                    : isQuotaOrDown
                                      ? 'bg-amber-100 text-amber-900'
                                      : 'bg-slate-200/80 text-slate-700'
                                }`}
                              >
                                {p.statusLabelRu}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono-tabular flex items-center justify-between">
                              <span>
                                Модель: {p.lastResolvedModel || p.defaultModel}
                              </span>
                              {p.cooldownRemainingSec ? (
                                <span className="text-amber-700">
                                  Пауза: {p.cooldownRemainingSec} с
                                </span>
                              ) : null}
                            </div>
                            {p.lastErrorReason && (
                              <div className="text-[10px] text-slate-500 leading-snug pt-0.5">
                                {p.lastErrorReason}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {onCheckProvidersOnDemand && (
                    <div className="pt-1 flex items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-400">
                        Проверка не расходует лимит генерации
                      </span>
                      <button
                        type="button"
                        disabled={isCheckingProviders}
                        onClick={() => void onCheckProvidersOnDemand()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-[11px] font-semibold hover:bg-slate-800 disabled:opacity-50"
                      >
                        {isCheckingProviders ? (
                          <Loader2 className="w-3 h-3 animate-spin text-[#FFD700]" />
                        ) : (
                          <RotateCcw className="w-3 h-3 text-[#FFD700]" />
                        )}
                        <span>Проверить подключение</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Interactive Fallback Document Consent Prompt when Auto-Failover Pauses (Part 7) */}
          {pendingFallbackConsentPrompt &&
            (!currentSession ||
              pendingFallbackConsentPrompt.sessionId === currentSession.id) && (
              <div className="rounded-xl p-3.5 bg-amber-50 border border-amber-300 space-y-2.5 text-xs text-amber-950 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div className="leading-relaxed">
                      <strong>
                        Требуется отдельное согласие для резервного провайдера{' '}
                        {pendingFallbackConsentPrompt.targetProviderLabel}:
                      </strong>{' '}
                      основной провайдер сейчас недоступен, а к запросу
                      прикреплён документ. Согласие на отправку в Google Gemini
                      не означает автоматического согласия на отправку в{' '}
                      {pendingFallbackConsentPrompt.targetProviderLabel}.
                    </div>
                  </div>
                  {onDismissFallbackDocumentConsent && (
                    <button
                      type="button"
                      onClick={onDismissFallbackDocumentConsent}
                      className="p-1 rounded-lg text-amber-700 hover:bg-amber-100"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {onDismissFallbackDocumentConsent && (
                    <button
                      type="button"
                      onClick={onDismissFallbackDocumentConsent}
                      className="px-3 py-1.5 rounded-xl bg-white border border-amber-300 text-amber-900 font-semibold hover:bg-amber-100"
                    >
                      Не отправлять
                    </button>
                  )}
                  {onConfirmFallbackDocumentConsent && (
                    <button
                      type="button"
                      onClick={onConfirmFallbackDocumentConsent}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800"
                    >
                      <Check className="w-3.5 h-3.5 text-[#FFD700]" />
                      <span>
                        Разрешить передачу текста документа в{' '}
                        {pendingFallbackConsentPrompt.targetProviderLabel} и
                        повторить
                      </span>
                    </button>
                  )}
                </div>
              </div>
            )}

          {/* Explicit Per-Provider Document Transmission Consent Box (Stage 3.3 Part 7) */}
          {hasSelectedDocsWithText && (
            <div className="rounded-xl p-3 bg-amber-50/90 border border-amber-200/90 space-y-2 text-xs text-amber-950">
              <div className="flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="space-y-1 leading-relaxed">
                  <div>
                    <strong>Контроль передачи документов провайдерам ИИ:</strong>
                  </div>
                  <div className="text-[11px] text-amber-900 space-y-0.5">
                    <div>
                      • <strong>Выбранные файлы:</strong>{' '}
                      {selectedDocNamesWithText.map((n) => `«${n}»`).join(', ')}
                    </div>
                    <div>
                      • <strong>Тип передаваемых данных:</strong> извлечённый
                      текст документа (исходный файл остаётся локально в
                      IndexedDB)
                    </div>
                    <div>
                      • <strong>Целевой провайдер:</strong>{' '}
                      {primaryProviderForDocs === 'ollama'
                        ? 'Ollama Local — обработка происходит на локальном компьютере без отправки во внешнее облако'
                        : PROVIDER_LABELS_RU[primaryProviderForDocs]}
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-1 space-y-1.5 border-t border-amber-200/70">
                <label className="flex items-center gap-2 cursor-pointer select-none font-semibold text-amber-950">
                  <input
                    type="checkbox"
                    checked={consentedProviders.includes(primaryProviderForDocs)}
                    onChange={() =>
                      handleToggleProviderConsent(primaryProviderForDocs)
                    }
                    className="rounded border-amber-400 text-slate-900 focus:ring-amber-600"
                  />
                  <span>
                    {primaryProviderForDocs === 'ollama'
                      ? 'Подтверждаю передачу извлечённого текста выбранных документов в локальную модель Ollama на компьютере'
                      : `Подтверждаю отправку извлечённого текста выбранных документов в ${PROVIDER_LABELS_RU[primaryProviderForDocs]}`}
                  </span>
                </label>

                {providerSelection === 'auto' && (
                  <label className="flex items-center gap-2 cursor-pointer select-none text-[11px] text-amber-900">
                    <input
                      type="checkbox"
                      checked={consentedProviders.includes('openrouter')}
                      onChange={() => handleToggleProviderConsent('openrouter')}
                      className="rounded border-amber-400 text-slate-900 focus:ring-amber-600"
                    />
                    <span>
                      Дополнительно разрешить отправку текста документа в
                      резервный провайдер <strong>OpenRouter Free</strong> (на
                      случай недоступности Gemini)
                    </span>
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Designer Mode User Controls Toolbar */}
          {activeMode === 'designer' &&
            (() => {
              const activeProviderDesc =
                imageProvidersState?.providers.find(
                  (p) => p.id === designProviderId
                ) ||
                imageProvidersState?.providers[0] ||
                null;
              const isGeneratorConnected = Boolean(
                activeProviderDesc?.configured &&
                  activeProviderDesc?.status !== 'not_configured'
              );
              const providerStatus =
                activeProviderDesc?.status || 'not_configured';
              const hasReferenceDraft = Boolean(
                draftAttachment?.dataUrl &&
                  draftAttachment.dataUrl.startsWith('data:image/')
              );

              return (
                <div className="rounded-2xl border border-purple-200/90 bg-purple-50/50 p-2.5 space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* School Selector */}
                      <div className="inline-flex rounded-lg bg-white border border-purple-200 p-0.5">
                        {(['kiberone', 'renderia'] as SchoolId[]).map((sch) => (
                          <button
                            key={sch}
                            type="button"
                            onClick={() => onChangeSchool(sch)}
                            className={`px-2 py-0.5 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                              activeSchool === sch
                                ? sch === 'kiberone'
                                  ? 'bg-[#FFD700] text-slate-950'
                                  : 'bg-[#84CC16] text-slate-950'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {SCHOOLS[sch].name}
                          </button>
                        ))}
                      </div>

                      {/* Template Preset Selector */}
                      <select
                        aria-label="Шаблон макета"
                        value={designTemplatePreset}
                        onChange={(e) => {
                          const nextPreset = e.target
                            .value as DesignTemplatePresetId;
                          setDesignTemplatePreset(nextPreset);
                          const found = DESIGN_TEMPLATE_PRESETS.find(
                            (p) => p.id === nextPreset
                          );
                          if (found) setDesignAspectRatio(found.defaultRatio);
                        }}
                        className="rounded-lg border border-purple-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-purple-600"
                      >
                        {DESIGN_TEMPLATE_PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            Шаблон: {preset.label}
                          </option>
                        ))}
                      </select>

                      {/* Aspect Ratio Selector */}
                      <select
                        aria-label="Формат макета"
                        value={designAspectRatio}
                        onChange={(e) =>
                          setDesignAspectRatio(
                            e.target.value as DesignAspectRatio
                          )
                        }
                        className="rounded-lg border border-purple-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-purple-600"
                      >
                        {DESIGN_ASPECT_RATIOS.map((ar) => (
                          <option key={ar.id} value={ar.id}>
                            Формат: {ar.label}
                          </option>
                        ))}
                      </select>

                      {/* Model Selector with Auto-select */}
                      <select
                        aria-label="Модель генерации"
                        value={designModelId}
                        onChange={(e) =>
                          setDesignModelId(
                            e.target.value as DesignerModelSelection
                          )
                        }
                        className="rounded-lg border border-purple-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-purple-600"
                      >
                        {DESIGNER_MODEL_OPTIONS.map((m) => (
                          <option key={m.id} value={m.id}>
                            Модель: {m.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {onGenerateDesignArtifact && (
                      <button
                        type="button"
                        disabled={
                          isGeneratingDesignImage ||
                          isGenerating ||
                          !draftPrompt.trim() ||
                          !isGeneratorConnected ||
                          providerStatus === 'quota_exceeded'
                        }
                        onClick={() => {
                          if (!draftPrompt.trim()) return;
                          const effectiveModelId = resolveDesignerModelId(
                            designModelId,
                            hasReferenceDraft
                          );
                          void onGenerateDesignArtifact({
                            sessionId: currentSession?.id,
                            schoolId: activeSchool,
                            title: draftPrompt.slice(0, 42),
                            prompt: draftPrompt,
                            aspectRatio: designAspectRatio,
                            qualityMode: designQualityMode,
                            templatePreset: designTemplatePreset,
                            providerId: designProviderId,
                            modelId: effectiveModelId,
                            referenceImageDataUrl: draftAttachment?.dataUrl,
                          });
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-purple-700 hover:bg-purple-800 text-white text-[11px] font-semibold disabled:opacity-40 transition-colors shadow-2xs cursor-pointer"
                      >
                        {isGeneratingDesignImage ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Генерация...</span>
                          </>
                        ) : (
                          <>
                            <Wand2 className="w-3.5 h-3.5" />
                            <span>Сгенерировать макет</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {!isGeneratorConnected && (
                    <div className="rounded-xl bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[11px] text-amber-900 flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                      <span>
                        Генератор изображений не подключён. Обратитесь к
                        администратору
                      </span>
                    </div>
                  )}

                  {isGeneratorConnected &&
                    providerStatus === 'quota_exceeded' && (
                      <div className="rounded-xl bg-red-50 border border-red-200 px-2.5 py-1.5 text-[11px] text-red-900 flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-600" />
                        <span>
                          Дневной лимит генерации изображений исчерпан. Повторите
                          попытку после 00:00 UTC.
                        </span>
                      </div>
                    )}
                </div>
              );
            })()}

          {/* Composer Box */}
          <div className="rounded-2xl border border-slate-300/90 bg-white shadow-2xs focus-within:ring-2 focus-within:ring-[#00A8B5] focus-within:border-transparent transition-all p-2.5 space-y-2">
            <textarea
              ref={textareaRef}
              rows={3}
              value={draftPrompt}
              disabled={isCurrentSessionGenerating}
              onChange={(e) => setDraftPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder={
                isCurrentSessionGenerating
                  ? `${getGenerationStageLabelRu(generationStage)} (${generationElapsedSec} с)`
                  : `Напишите задачу для специалиста «${modeConfig.shortTitle}» (школа ${schoolConfig.name})...`
              }
              className="w-full bg-transparent px-2 py-1 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none resize-y disabled:opacity-60"
            />

            <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                  onChange={handleImageChange}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isParsingFile || isGenerating}
                  onClick={() => imageInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-900 border border-slate-200/80 disabled:opacity-60 transition-colors cursor-pointer"
                  title="Прикрепить изображение (PNG, JPG, JPEG, WEBP) для визуального анализа специалистом"
                >
                  <ImageIcon className="w-4 h-4 text-emerald-600" />
                  <span>Изображение</span>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.pptx,.txt,.md,.csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isParsingFile || isGenerating}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-slate-200/80 disabled:opacity-60 transition-colors cursor-pointer"
                  title="Прикрепить документ (PDF, DOCX, PPTX, TXT, CSV, MD) к текущему диалогу"
                >
                  {isParsingFile ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-[#00A8B5]" />
                      <span>{parsingStatusLabel || 'Разбор файла...'}</span>
                    </>
                  ) : (
                    <>
                      <Paperclip className="w-4 h-4 text-[#00A8B5]" />
                      <span>Документ</span>
                    </>
                  )}
                </button>

                <span className="text-[11px] text-slate-400 hidden md:inline">
                  Школа:{' '}
                  <strong className="text-slate-600">{schoolConfig.name}</strong>
                </span>
              </div>

              <div className="flex items-center gap-2.5">
                <span className="text-[11px] text-slate-400 font-mono-tabular hidden sm:inline">
                  {draftPrompt.length} симв.
                </span>

                {isGenerating ? (
                  <button
                    type="button"
                    onClick={onStopGeneration}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors shadow-2xs"
                    title="Остановить генерацию ответа"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Остановить</span>
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={
                      (!draftPrompt.trim() && !draftAttachment) ||
                      isParsingFile ||
                      isGenerating
                    }
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none transition-colors shadow-2xs"
                  >
                    <Send
                      className={`w-3.5 h-3.5 ${
                        activeSchool === 'renderia'
                          ? 'text-[#84CC16]'
                          : 'text-[#F5B800]'
                      }`}
                    />
                    <span>Отправить</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>

    {/* Resizable Splitter Handle between Chat and Flow */}
    {isFlowPanelOpen && !isFlowFullscreen && (
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-valuenow={chatWidthPercent}
        aria-valuemin={20}
        aria-valuemax={80}
        onPointerDown={handleSplitterPointerDown}
        onDoubleClick={() => {
          setChatWidthPercent(45);
          setTimeout(updateFlowRect, 30);
        }}
        title="Перетащите для изменения ширины колонок (двойной клик: 45%)"
        className={`hidden lg:flex items-center justify-center w-2.5 -mx-1 z-20 cursor-col-resize group shrink-0 select-none ${
          isDraggingSplitter ? 'bg-purple-500/20' : 'hover:bg-purple-500/10'
        }`}
      >
        <div
          className={`w-1 h-12 rounded-full transition-colors flex items-center justify-center ${
            isDraggingSplitter
              ? 'bg-purple-500 ring-2 ring-purple-400/40'
              : 'bg-slate-300 group-hover:bg-purple-500'
          }`}
        >
          <div className="flex flex-col gap-0.5 pointer-events-none">
            <span className="w-0.5 h-0.5 rounded-full bg-white/80" />
            <span className="w-0.5 h-0.5 rounded-full bg-white/80" />
            <span className="w-0.5 h-0.5 rounded-full bg-white/80" />
          </div>
        </div>
      </div>
    )}

    {/* Embedded Google Flow Panel (Electron WebContentsView target) */}
    {isFlowPanelOpen && (
      <div
        style={
          isFlowFullscreen
            ? { width: '100%' }
            : { width: `${100 - chatWidthPercent}%` }
        }
        className={`hidden lg:flex flex-col bg-slate-900 min-w-0 relative ${
          isFlowFullscreen ? 'w-full flex-1' : 'shrink-0'
        } ${isDraggingSplitter ? 'transition-none' : 'transition-[width] duration-150'}`}
      >
        {/* Flow Panel Header */}
        <div className="px-4 py-2.5 bg-slate-800 border-b border-slate-700/80 flex items-center justify-between gap-3 text-xs shrink-0 select-none">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-purple-600 via-indigo-600 to-amber-400 flex items-center justify-center text-white font-bold text-xs shadow-xs shrink-0">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-100 truncate">
                  Google Flow
                </span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  Nano Banana
                </span>
              </div>
            </div>

            {/* Floating Restore Chat Button in Fullscreen Mode */}
            {isFlowFullscreen && (
              <button
                type="button"
                onClick={() => setIsFlowFullscreen(false)}
                className="ml-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer shrink-0"
                title="Вернуть чат (восстановить разделение экрана)"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Вернуть чат</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Status Indicator */}
            {flowState.isLoading ? (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[11px]">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Загрузка...</span>
              </div>
            ) : flowState.error ? (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-red-500/20 text-red-300 text-[11px]">
                <AlertTriangle className="w-3 h-3 text-red-400" />
                <span>Ошибка</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[11px]">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Подключено</span>
              </div>
            )}

            {/* Reload Button */}
            <button
              type="button"
              onClick={() => window.electronAPI?.flow?.reload()}
              title="Перезагрузить страницу Google Flow"
              className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-700/70 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>

            {/* Open in external browser */}
            <button
              type="button"
              onClick={() => {
                const url = 'https://flow.google.com/';
                if (window.electronAPI?.shell?.openExternal) {
                  void window.electronAPI.shell.openExternal(url);
                } else {
                  window.open(url, '_blank');
                }
              }}
              title="Открыть Google Flow в системном браузере"
              className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-700/70 transition-colors cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>

            {/* Fullscreen / Restore Toggle Button */}
            <button
              type="button"
              onClick={() => setIsFlowFullscreen((prev) => !prev)}
              title={
                isFlowFullscreen
                  ? 'Вернуть чат (восстановить разделение экрана)'
                  : 'Развернуть Flow на весь экран'
              }
              className={`p-1 rounded-lg transition-colors cursor-pointer ${
                isFlowFullscreen
                  ? 'text-purple-300 hover:text-white hover:bg-purple-600/40'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-700/70'
              }`}
            >
              {isFlowFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Close Flow View */}
            <button
              type="button"
              onClick={handleToggleFlow}
              title="Скрыть панель Google Flow"
              className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-700/70 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Target Container for Electron WebContentsView */}
        <div
          ref={flowTargetRef}
          className="flex-1 w-full bg-slate-950 relative overflow-hidden"
        >
          {/* Overlay on error */}
          {flowState.error && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center bg-slate-900 text-white space-y-3">
              <AlertTriangle className="w-10 h-10 text-amber-400" />
              <div className="font-semibold text-sm">Не удалось загрузить Google Flow</div>
              <div className="text-xs text-slate-400 max-w-sm">{flowState.error}</div>
              <button
                type="button"
                onClick={() => window.electronAPI?.flow?.reload()}
                className="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-xs font-semibold text-white transition-colors cursor-pointer"
              >
                Повторить попытку
              </button>
            </div>
          )}

          {flowState.isLoading && !flowState.error && (
            <div className="absolute inset-0 z-0 flex flex-col items-center justify-center p-6 text-center bg-slate-950 text-white space-y-3 pointer-events-none">
              <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
              <div className="text-sm font-medium text-slate-200">
                Загрузка Google Flow (flow.google.com)...
              </div>
              <div className="text-xs text-slate-500 max-w-xs">
                Сессия сохраняется в изолированном профиле persist:google_flow.
              </div>
            </div>
          )}
        </div>
      </div>
    )}
  </div>

  {/* Confirmation Modal for Deleting Active Dialogue */}
      {sessionPendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
          onClick={() => {
            if (!isDeletingSession) setSessionPendingDelete(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600 shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-base text-slate-900">
                    Удалить диалог навсегда?
                  </h3>
                  <p className="text-xs text-slate-500">
                    Подтверждение полного удаления из IndexedDB
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isDeletingSession}
                onClick={() => setSessionPendingDelete(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                aria-label="Закрыть окно"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-xl p-3.5 bg-slate-50 border border-slate-200/80 space-y-1.5 text-xs">
              <div className="font-semibold text-slate-900 break-words">
                «{sessionPendingDelete.title}»
              </div>
              <div className="flex flex-wrap items-center gap-2 text-slate-600">
                <span
                  className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                    sessionPendingDelete.schoolId === 'kiberone'
                      ? 'bg-[#F5B800] text-slate-950'
                      : 'bg-[#84CC16] text-slate-950'
                  }`}
                >
                  {SCHOOLS[sessionPendingDelete.schoolId].name}
                </span>
                <span>·</span>
                <span>{AGENT_MODES[sessionPendingDelete.mode].title}</span>
                <span>·</span>
                <span className="font-mono-tabular">
                  {sessionPendingDelete.messages.length} сообщ.
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Сессия, все сообщения и прикреплённые к ней файлы будут{' '}
              <strong>атомарно удалены</strong> из локального хранилища браузера
              IndexedDB без возможности восстановления.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isDeletingSession}
                onClick={() => setSessionPendingDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={isDeletingSession}
                onClick={handleConfirmDeleteSession}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors shadow-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  {isDeletingSession ? 'Удаление...' : 'Удалить диалог'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inter-Specialist Task Handoff Modal (Stage 1) */}
      {handoffModalState?.isOpen && currentSession && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          onClick={() => setHandoffModalState(null)}
        >
          <div
            className="w-full max-w-xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 bg-purple-50/70 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-700 text-white flex items-center justify-center shrink-0">
                  <Palette className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-base text-slate-900">
                    Передать задачу специалисту «
                    {AGENT_MODES[handoffModalState.toSpecialist].title}»
                  </h3>
                  <p className="text-xs text-slate-600">
                    Школа: <strong>{schoolConfig.name}</strong> · Из чата:{' '}
                    {modeConfig.title} (история чата сохранится)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHandoffModalState(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-800 mb-1">
                  1. Исходная задача
                </label>
                <input
                  type="text"
                  value={handoffModalState.originalTask}
                  onChange={(e) =>
                    setHandoffModalState((prev) =>
                      prev ? { ...prev, originalTask: e.target.value } : null
                    )
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-600"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">
                  2. Цель и целевая аудитория ({schoolConfig.name})
                </label>
                <input
                  type="text"
                  value={handoffModalState.goalAndAudience}
                  onChange={(e) =>
                    setHandoffModalState((prev) =>
                      prev ? { ...prev, goalAndAudience: e.target.value } : null
                    )
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-600"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">
                  3. Текст и утверждённый оффер
                </label>
                <textarea
                  rows={4}
                  value={handoffModalState.approvedOfferAndText}
                  onChange={(e) =>
                    setHandoffModalState((prev) =>
                      prev
                        ? { ...prev, approvedOfferAndText: e.target.value }
                        : null
                    )
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-600"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">
                  4. Дополнительные требования к визуалу и слоям
                </label>
                <textarea
                  rows={2}
                  value={handoffModalState.additionalRequirements}
                  onChange={(e) =>
                    setHandoffModalState((prev) =>
                      prev
                        ? { ...prev, additionalRequirements: e.target.value }
                        : null
                    )
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-600"
                />
              </div>

              {dialogueAttachments.length > 0 && (
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <span className="font-bold text-slate-800 block mb-1">
                    Приложенные файлы и изображения (будут переданы Дизайнеру):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {dialogueAttachments.map((att) => (
                      <span
                        key={att.id}
                        className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[11px] text-slate-700 font-medium"
                      >
                        {att.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setHandoffModalState(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!onHandoffTaskToSpecialist || !currentSession) return;
                  const st = handoffModalState;
                  setHandoffModalState(null);
                  void onHandoffTaskToSpecialist({
                    fromSpecialist: activeMode,
                    toSpecialist: st.toSpecialist,
                    sourceSessionId: currentSession.id,
                    sourceMessageId: st.sourceMessageId,
                    schoolId: activeSchool,
                    originalTask: st.originalTask,
                    goalAndAudience: st.goalAndAudience,
                    approvedOfferAndText: st.approvedOfferAndText,
                    additionalRequirements: st.additionalRequirements,
                    discussionContext: st.discussionContext,
                    attachments: dialogueAttachments,
                  });
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-purple-700 text-white hover:bg-purple-800 transition-colors shadow-xs cursor-pointer"
              >
                <ArrowRightLeft className="w-4 h-4" />
                <span>Передать задачу и открыть чат Дизайнера</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Browser Preview Google Flow Fallback Modal */}
      {isBrowserFlowModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden text-slate-900">
            <div className="px-6 py-4 bg-gradient-to-r from-purple-700 to-indigo-800 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-amber-300" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-base">
                    Google Flow · Режим встроенного окна
                  </h3>
                  <p className="text-xs text-purple-200">
                    Интеграция Nano Banana в рабочее пространство
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBrowserFlowModalOpen(false)}
                className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs text-slate-600 leading-relaxed">
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-xs text-amber-900">
                  <Monitor className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Встроенный сплит-режим работает в приложении для Windows</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  В веб-версии Preview сервис Google Flow блокирует встраивание через iframe
                  (заголовки безопасности <code>X-Frame-Options: SAMEORIGIN</code> и <code>CSP frame-ancestors: 'self'</code>).
                </p>
              </div>

              <div className="space-y-2">
                <p className="font-semibold text-slate-800">
                  В десктопном приложении (Electron) реализовано:
                </p>
                <ul className="list-disc pl-4 space-y-1 text-slate-600">
                  <li>Нативное разделение экрана через <strong>WebContentsView</strong>.</li>
                  <li>Постоянная сессия <code>persist:google_flow</code> — авторизация в Google не сбрасывается при перезапуске.</li>
                  <li>Штатный интерфейс Flow и модели Nano Banana без сторонних прокси.</li>
                  <li>Возможность работать в чате Дизайнера и во Flow в одном окне.</li>
                </ul>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-mono text-slate-700">
                <span className="text-slate-400 block font-sans font-medium mb-1">Команда для запуска на Windows:</span>
                <code>npm run electron:dev</code>
              </div>
            </div>

            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setIsBrowserFlowModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Закрыть
              </button>
              <button
                type="button"
                onClick={() => {
                  window.open('https://flow.google.com/', '_blank');
                  setIsBrowserFlowModalOpen(false);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-purple-700 text-white hover:bg-purple-800 transition-colors shadow-xs cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Открыть Google Flow в новой вкладке</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
