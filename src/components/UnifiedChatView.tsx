import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  Clock,
  Copy,
  Eraser,
  Eye,
  FileText,
  FolderOpen,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  PenLine,
  Pin,
  PinOff,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  AgentMode,
  AIProviderId,
  AIProviderSelectionMode,
  ChatAttachment,
  ChatMessage,
  ChatSession,
  KnowledgeBaseBySchool,
  NavSection,
  SchoolId,
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
}

const STAGE_ORDER: GenerationStage[] = [
  'connecting',
  'waiting_model',
  'generating',
  'finishing',
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
}) => {
  const [draftPrompt, setDraftPrompt] = useState('');
  const [selectedQuickPromptId, setSelectedQuickPromptId] = useState<
    string | null
  >(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);

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

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
    () => uploadedDocuments.filter((d) => d.schoolId === activeSchool),
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

  // Determine which documents with extracted text are slated to be sent in this request
  const selectedDocNamesWithText = useMemo(() => {
    const names: string[] = [];
    if (
      draftAttachment &&
      (draftAttachment.extractedText || '').trim().length > 0 &&
      draftAttachment.status !== 'error'
    ) {
      names.push(draftAttachment.name);
    }
    const selDialSet = new Set(selectedDialogueAttachmentIds);
    for (const att of dialogueAttachments) {
      if (
        selDialSet.has(att.id) &&
        (att.extractedText || '').trim().length > 0 &&
        att.status !== 'error' &&
        !names.includes(att.name)
      ) {
        names.push(att.name);
      }
    }
    const selSchoolSet = new Set(selectedSchoolDocumentIds);
    for (const doc of schoolDocuments) {
      if (
        selSchoolSet.has(doc.id) &&
        (doc.extractedText || '').trim().length > 0 &&
        doc.status !== 'error' &&
        !names.includes(doc.name)
      ) {
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
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedMessageId(msg.id);
      setTimeout(() => {
        setCopiedMessageId((prev) => (prev === msg.id ? null : prev));
      }, 2000);
    } catch {
      const el = document.createElement('textarea');
      el.value = msg.content;
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
      trimmed || `Проанализируй прикреплённый документ: ${draftAttachment?.name}`,
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
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 mb-1.5 px-1">
                      <span className="font-semibold text-slate-700">
                        {isUser ? 'Управляющая' : `ИИ · ${msgMode.shortTitle}`}
                      </span>
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
                          ? 'bg-slate-900 text-white shadow-2xs'
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

                      {(msg.attachmentMeta || msg.attachmentName) && (
                        <div
                          className={`flex items-center justify-between gap-3 text-xs pb-2.5 mb-2.5 border-b ${
                            isUser
                              ? 'border-slate-700 text-[#F5B800]'
                              : 'border-slate-100 text-[#00A8B5]'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate font-medium">
                              {msg.attachmentMeta?.name || msg.attachmentName}
                            </span>
                            {msg.attachmentMeta && (
                              <span className="text-[10px] opacity-80 font-mono-tabular shrink-0">
                                ({formatFileSizeRu(msg.attachmentMeta.sizeBytes)}
                                )
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
                      )}

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

                      {!isUser && !msg.isStreaming && (
                        <div className="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[10px] text-slate-400 font-mono-tabular">
                            {formatMessageProviderAttribution(
                              msg.providerId,
                              msg.modelName,
                              geminiStatus?.model
                            )}
                          </span>
                          <div className="flex items-center gap-1.5">
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
                                  <span>Копировать ответ</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}
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

          {/* Pre-send Attachment Preview Card (Name, Format, Size, Status, Warnings, Preview & Remove) */}
          {draftAttachment && (
            <div className="rounded-xl bg-slate-50 border border-slate-200/90 p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-[#00A8B5] shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900 truncate">
                        {draftAttachment.name}
                      </span>
                      {renderStatusBadge(draftAttachment.status || 'processed')}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono-tabular mt-0.5">
                      <span className="uppercase font-bold text-slate-700">
                        .{draftAttachment.extension || 'file'}
                      </span>
                      <span>·</span>
                      <span>{formatFileSizeRu(draftAttachment.sizeBytes)}</span>
                      <span>·</span>
                      <span>
                        Текст: {draftAttachment.extractedText.length} симв.
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
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
                  <button
                    type="button"
                    onClick={onClearDraftAttachment}
                    className="p-1.5 text-slate-400 hover:text-slate-800 rounded-lg hover:bg-slate-200/60"
                    aria-label="Убрать прикреплённый файл"
                    title="Убрать файл из черновика"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {draftAttachment.warning && (
                <div className="rounded-lg p-2 bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                  {draftAttachment.warning}
                </div>
              )}

              {(!draftAttachment.extractedText ||
                draftAttachment.extractedText.trim().length === 0) && (
                <div className="rounded-lg p-2 bg-slate-100 border border-slate-200 text-[11px] text-slate-700">
                  Ограничение: в этом файле отсутствует извлечённый текстовый
                  слой (например, скан без OCR или изображение). Он сохранится в
                  материалах диалога, но его текст не может быть передан в
                  текстовый запрос Gemini API.
                </div>
              )}
            </div>
          )}

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
                              const hasText =
                                (att.extractedText || '').trim().length > 0 &&
                                att.status !== 'error';
                              return (
                                <label
                                  key={att.id}
                                  className={`flex items-start gap-2 p-1.5 rounded-lg border text-[11px] ${
                                    hasText
                                      ? 'border-slate-200/80 hover:bg-slate-50 cursor-pointer'
                                      : 'border-slate-100 bg-slate-50/60 text-slate-400 cursor-not-allowed'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    disabled={!hasText}
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
                                      {hasText
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
                          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Документы школы {schoolConfig.name} (
                            {schoolDocuments.length})
                          </div>
                          <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                            {schoolDocuments.map((doc) => {
                              const hasText =
                                (doc.extractedText || '').trim().length > 0 &&
                                doc.status !== 'error';
                              return (
                                <label
                                  key={doc.id}
                                  className={`flex items-start gap-2 p-1.5 rounded-lg border text-[11px] ${
                                    hasText
                                      ? 'border-slate-200/80 hover:bg-slate-50 cursor-pointer'
                                      : 'border-slate-100 bg-slate-50/60 text-slate-400 cursor-not-allowed'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    disabled={!hasText}
                                    checked={selectedSchoolDocumentIds.includes(
                                      doc.id
                                    )}
                                    onChange={() =>
                                      handleToggleSchoolDocumentSelection(doc.id)
                                    }
                                    className="mt-0.5 rounded border-slate-300"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="font-medium text-slate-800 truncate">
                                      {doc.name}
                                    </div>
                                    <div className="text-[10px] text-slate-500">
                                      {hasText
                                        ? `${doc.extractedText.length.toLocaleString('ru-RU')} симв.`
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
              <div className="flex items-center gap-2">
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60 transition-colors"
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
                      <span>Прикрепить документ</span>
                    </>
                  )}
                </button>

                <span className="text-[11px] text-slate-400 hidden sm:inline">
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
    </div>
  );
};
