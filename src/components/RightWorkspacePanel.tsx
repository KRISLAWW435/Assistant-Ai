import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Clock,
  Eye,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Layers,
  Loader2,
  Paperclip,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  AgentMode,
  AIProviderId,
  AIProviderSelectionMode,
  ChatAttachment,
  ChatSession,
  KnowledgeBaseBySchool,
  NavSection,
  RightPanelTab,
  SchoolId,
  UploadedDocumentRecord,
} from '../types/assistant';
import {
  AGENT_MODES,
  KNOWLEDGE_CATEGORIES,
  SCHOOLS,
} from '../config/schoolsAndModes';
import { renderStatusBadge } from './KnowledgeBaseView';
import { AIProvidersSystemState } from '../providers/aiProviderManager';

interface RightWorkspacePanelProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  activeTab: RightPanelTab;
  onChangeTab: (tab: RightPanelTab) => void;
  activeSchool: SchoolId;
  activeMode: AgentMode;
  currentSession: ChatSession | null;
  sessions: ChatSession[];
  selectedAttachmentId: string | null;
  onSelectAttachment: (attachmentId: string | null) => void;
  onRequestStageDialogueFile: (file: File) => Promise<void>;
  onRemoveAttachmentFromDialogue: (
    sessionId: string,
    attachmentId: string
  ) => Promise<void>;
  onJumpToSearchResult: (sessionId: string, messageId?: string) => void;
  onNavigate: (section: NavSection) => void;
  knowledgeBase: KnowledgeBaseBySchool;
  uploadedDocuments: UploadedDocumentRecord[];
  stagedDraftAttachment: ChatAttachment | null;
  isParsingDialogueFile?: boolean;
  parsingStatusLabel?: string | null;
  geminiStatus?: { configured: boolean; model: string } | null;
  providersState?: AIProvidersSystemState | null;
  providerSelection?: AIProviderSelectionMode;
  onChangeProviderSelection?: (mode: AIProviderSelectionMode) => void;
  onCheckProvidersOnDemand?: () => Promise<void>;
  isCheckingProviders?: boolean;
}

interface SearchHit {
  id: string;
  sessionId: string;
  sessionTitle: string;
  schoolId: SchoolId;
  mode: AgentMode;
  messageId?: string;
  role?: 'user' | 'assistant';
  snippet: string;
  timestamp: string;
  updatedAtMs: number;
  matchType: 'title' | 'message' | 'attachment';
}

const IMAGE_PREVIEW_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'jfif',
  'svg',
]);

export function formatFileSizeRu(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} КБ`;
  return `${(kb / 1024).toFixed(1)} МБ`;
}

export const RightWorkspacePanel: React.FC<RightWorkspacePanelProps> = ({
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
  activeTab,
  onChangeTab,
  activeSchool,
  activeMode,
  currentSession,
  sessions,
  selectedAttachmentId,
  onSelectAttachment,
  onRequestStageDialogueFile,
  onRemoveAttachmentFromDialogue,
  onJumpToSearchResult,
  onNavigate,
  knowledgeBase,
  uploadedDocuments,
  stagedDraftAttachment,
  isParsingDialogueFile = false,
  parsingStatusLabel = null,
  geminiStatus = null,
  providersState = null,
  providerSelection = 'auto',
  onChangeProviderSelection,
  onCheckProvidersOnDemand,
  isCheckingProviders = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [attachmentPendingDelete, setAttachmentPendingDelete] =
    useState<ChatAttachment | null>(null);
  const [isDeletingAttachment, setIsDeletingAttachment] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const schoolConfig = SCHOOLS[activeSchool];
  const modeConfig = AGENT_MODES[activeMode];

  // Combine saved dialogue attachments + currently staged draft attachment (if any)
  const sessionAttachments: ChatAttachment[] = useMemo(() => {
    const saved = currentSession?.attachments || [];
    if (
      stagedDraftAttachment &&
      !saved.some((a) => a.id === stagedDraftAttachment.id)
    ) {
      return [stagedDraftAttachment, ...saved];
    }
    return saved;
  }, [currentSession, stagedDraftAttachment]);

  const selectedAttachment: ChatAttachment | null = useMemo(() => {
    if (sessionAttachments.length === 0) return null;
    if (selectedAttachmentId) {
      const found = sessionAttachments.find(
        (a) => a.id === selectedAttachmentId
      );
      if (found) return found;
    }
    return sessionAttachments[0];
  }, [sessionAttachments, selectedAttachmentId]);

  // Search across all saved sessions & messages & extracted text of dialogue attachments
  const searchResults: SearchHit[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];

    const hits: SearchHit[] = [];

    for (const sess of sessions) {
      const titleMatch = sess.title.toLowerCase().includes(q);
      if (titleMatch) {
        hits.push({
          id: `title-${sess.id}`,
          sessionId: sess.id,
          sessionTitle: sess.title,
          schoolId: sess.schoolId,
          mode: sess.mode,
          snippet: `Совпадение в названии диалога: «${sess.title}» (${sess.messages.length} сообщ.)`,
          timestamp: sess.updatedAt,
          updatedAtMs: sess.updatedAtMs ?? 0,
          matchType: 'title',
        });
      }

      for (const att of sess.attachments || []) {
        if (
          att.name.toLowerCase().includes(q) ||
          (att.extractedText && att.extractedText.toLowerCase().includes(q))
        ) {
          hits.push({
            id: `att-${sess.id}-${att.id}`,
            sessionId: sess.id,
            sessionTitle: sess.title,
            schoolId: sess.schoolId,
            mode: sess.mode,
            messageId: att.messageId,
            snippet: `Файл диалога: ${att.name} (${formatFileSizeRu(att.sizeBytes)})`,
            timestamp: att.createdAt || sess.updatedAt,
            updatedAtMs: att.createdAtMs ?? sess.updatedAtMs ?? 0,
            matchType: 'attachment',
          });
        }
      }

      for (const msg of sess.messages) {
        const lowerContent = msg.content.toLowerCase();
        const idx = lowerContent.indexOf(q);
        if (idx !== -1) {
          const start = Math.max(0, idx - 48);
          const end = Math.min(msg.content.length, idx + q.length + 72);
          const prefix = start > 0 ? '…' : '';
          const suffix = end < msg.content.length ? '…' : '';
          const snippet = `${prefix}${msg.content.slice(start, end).replace(/\s+/g, ' ')}${suffix}`;

          hits.push({
            id: `msg-${msg.id}`,
            sessionId: sess.id,
            sessionTitle: sess.title,
            schoolId: sess.schoolId,
            mode: sess.mode,
            messageId: msg.id,
            role: msg.role,
            snippet,
            timestamp: msg.createdAt,
            updatedAtMs: msg.createdAtMs ?? sess.updatedAtMs ?? 0,
            matchType: 'message',
          });
        }
      }
    }

    return hits.sort((a, b) => b.updatedAtMs - a.updatedAtMs).slice(0, 40);
  }, [searchQuery, sessions]);

  const schoolKnowledge = knowledgeBase[activeSchool];
  const filledCategories = useMemo(
    () =>
      KNOWLEDGE_CATEGORIES.filter(
        (cat) => (schoolKnowledge[cat.key] || '').trim().length > 0
      ),
    [schoolKnowledge]
  );
  const emptyCategories = useMemo(
    () =>
      KNOWLEDGE_CATEGORIES.filter(
        (cat) => (schoolKnowledge[cat.key] || '').trim().length === 0
      ),
    [schoolKnowledge]
  );
  const schoolDocs = useMemo(
    () => uploadedDocuments.filter((d) => d.schoolId === activeSchool),
    [uploadedDocuments, activeSchool]
  );

  const handleFileInputChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const maxSizeBytes = 15 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      setUploadError('Файл превышает допустимый размер 15 МБ.');
      return;
    }

    setUploadError(null);
    await onRequestStageDialogueFile(file);
  };

  const handleConfirmDeleteAttachment = async () => {
    if (!attachmentPendingDelete || !currentSession) return;
    setIsDeletingAttachment(true);
    try {
      await onRemoveAttachmentFromDialogue(
        currentSession.id,
        attachmentPendingDelete.id
      );
      setAttachmentPendingDelete(null);
    } finally {
      setIsDeletingAttachment(false);
    }
  };

  const renderFileTypeIcon = (ext: string) => {
    const lower = ext.toLowerCase();
    if (IMAGE_PREVIEW_EXTENSIONS.has(lower)) {
      return <ImageIcon className="w-4 h-4 text-emerald-600 shrink-0" />;
    }
    if (lower === 'csv' || lower === 'xlsx' || lower === 'xls') {
      return <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />;
    }
    return <FileText className="w-4 h-4 text-[#00A8B5] shrink-0" />;
  };

  const TABS: {
    id: RightPanelTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }[] = [
    {
      id: 'materials',
      label: 'Материалы',
      icon: FolderOpen,
      badge: sessionAttachments.length,
    },
    {
      id: 'preview',
      label: 'Просмотр',
      icon: Eye,
    },
    {
      id: 'search',
      label: 'Поиск',
      icon: Search,
    },
    {
      id: 'context',
      label: 'Контекст',
      icon: Layers,
    },
  ];

  // Collapsed slim rail on desktop
  if (collapsed && !mobileOpen) {
    return (
      <aside className="hidden xl:flex flex-col items-center w-14 shrink-0 h-screen sticky top-0 bg-white border-l border-slate-200/80 py-3.5 gap-3 z-30 select-none">
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Развернуть панель «Рабочие материалы»"
          aria-label="Развернуть правую панель"
          className="w-9 h-9 rounded-xl border border-slate-200/90 bg-slate-50 text-slate-700 hover:bg-slate-900 hover:text-white hover:border-slate-900 flex items-center justify-center transition-colors shadow-2xs"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="w-7 border-t border-slate-200/80 my-0.5" />

        <div className="flex flex-col items-center gap-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <div key={tab.id} className="relative group">
                <button
                  type="button"
                  onClick={() => {
                    onChangeTab(tab.id);
                    onToggleCollapsed();
                  }}
                  title={`${tab.label}${tab.badge ? ` (${tab.badge})` : ''}`}
                  aria-label={tab.label}
                  className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
                    isActive
                      ? 'bg-slate-900 text-white shadow-2xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {typeof tab.badge === 'number' && tab.badge > 0 && (
                    <span
                      className={`absolute -top-1 -right-1 px-1 rounded-full text-[9px] font-mono-tabular font-bold leading-tight ${
                        activeSchool === 'renderia'
                          ? 'bg-[#84CC16] text-slate-950'
                          : 'bg-[#F5B800] text-slate-950'
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
                <div
                  role="tooltip"
                  className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute right-full top-1/2 -translate-y-1/2 mr-2.5 z-50 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium whitespace-nowrap shadow-md"
                >
                  {tab.label}
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    );
  }

  const renderPanelContent = (isDrawer: boolean) => (
    <div
      className={`flex flex-col h-full bg-white border-l border-slate-200/80 ${
        isDrawer ? 'w-80 sm:w-96' : 'w-80 2xl:w-96'
      } shrink-0 select-none`}
    >
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-slate-200/80 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display font-bold text-sm text-slate-900 truncate">
            Рабочие материалы
          </h2>
          <p className="text-[11px] text-slate-500 truncate">
            Документы диалога, просмотр, поиск и контекст
          </p>
        </div>

        {isDrawer ? (
          <button
            type="button"
            onClick={onCloseMobile}
            className="p-1.5 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
            aria-label="Закрыть панель материалов"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleCollapsed}
            title="Свернуть панель «Рабочие материалы» (>>)"
            aria-label="Свернуть правую панель"
            className="inline-flex items-center justify-center gap-1 w-8 h-8 rounded-xl border border-slate-200/90 bg-slate-50 text-slate-700 hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-colors shrink-0 cursor-pointer"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 4 Tabs Navigation */}
      <div className="px-3 pt-2.5 pb-2 border-b border-slate-200/70 bg-slate-50/70">
        <div className="grid grid-cols-4 gap-1 p-1 bg-slate-200/60 rounded-xl">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChangeTab(tab.id)}
                className={`relative flex flex-col items-center justify-center gap-1 py-1.5 px-1 rounded-lg text-[11px] font-semibold transition-all ${
                  isActive
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <div className="relative flex items-center justify-center">
                  <Icon className="w-3.5 h-3.5" />
                  {typeof tab.badge === 'number' && tab.badge > 0 && (
                    <span
                      className={`ml-1 px-1 rounded text-[9px] font-mono-tabular font-bold ${
                        activeSchool === 'renderia'
                          ? 'bg-[#84CC16] text-slate-950'
                          : 'bg-[#F5B800] text-slate-950'
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </div>
                <span className="truncate max-w-full">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 select-text">
        {/* TAB 1: МАТЕРИАЛЫ (Files of the current dialogue ONLY) */}
        {activeTab === 'materials' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-bold text-slate-900">
                  Файлы текущего диалога
                </div>
                <div className="text-[11px] text-slate-500">
                  PDF, DOCX, PPTX, TXT, CSV, MD
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.pptx,.txt,.md,.csv"
                onChange={handleFileInputChange}
                className="hidden"
              />
              <button
                type="button"
                disabled={isParsingDialogueFile}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60 transition-colors shrink-0 shadow-2xs"
              >
                {isParsingDialogueFile ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#00A8B5]" />
                    <span>{parsingStatusLabel || 'Разбор...'}</span>
                  </>
                ) : (
                  <>
                    <Paperclip
                      className={`w-3.5 h-3.5 ${
                        activeSchool === 'renderia'
                          ? 'text-[#84CC16]'
                          : 'text-[#F5B800]'
                      }`}
                    />
                    <span>Прикрепить</span>
                  </>
                )}
              </button>
            </div>

            {uploadError && (
              <div className="rounded-xl p-2.5 bg-red-50 border border-red-200 text-xs text-red-800 flex items-center justify-between gap-2">
                <span>{uploadError}</span>
                <button
                  type="button"
                  onClick={() => setUploadError(null)}
                  className="text-red-600 hover:text-red-900"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Separation Notice */}
            <div className="rounded-xl p-3 bg-slate-50 border border-slate-200/80 text-[11px] text-slate-600 leading-relaxed flex items-start gap-2">
              <Info className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
              <span>
                Файлы, прикреплённые в чате, связаны только с{' '}
                <strong>этим диалогом</strong> и не попадают автоматически в
                общую Базу знаний школы.
              </span>
            </div>

            {sessionAttachments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center space-y-2.5 bg-slate-50/50">
                <div className="w-10 h-10 rounded-xl bg-white border border-slate-200/80 flex items-center justify-center mx-auto text-slate-400">
                  <FolderOpen className="w-5 h-5" />
                </div>
                <div className="text-xs font-semibold text-slate-800">
                  В этом диалоге пока нет документов
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Прикрепите рабочий документ (.pdf, .docx, .pptx, .txt, .csv,
                  .md) кнопкой выше или через скрепку внизу чата.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {sessionAttachments.map((att) => {
                  const isSelected = selectedAttachment?.id === att.id;
                  const isStagedOnly =
                    stagedDraftAttachment?.id === att.id &&
                    !(currentSession?.attachments || []).some(
                      (a) => a.id === att.id
                    );

                  return (
                    <div
                      key={att.id}
                      onClick={() => {
                        onSelectAttachment(att.id);
                      }}
                      className={`rounded-xl p-3 border transition-all cursor-pointer space-y-2 ${
                        isSelected
                          ? activeSchool === 'renderia'
                            ? 'bg-[#84CC16]/10 border-[#84CC16] shadow-2xs'
                            : 'bg-[#F5B800]/10 border-[#F5B800] shadow-2xs'
                          : 'bg-white hover:bg-slate-50 border-slate-200/80'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {renderFileTypeIcon(att.extension)}
                          <span
                            className="text-xs font-semibold text-slate-900 truncate"
                            title={att.name}
                          >
                            {att.name}
                          </span>
                        </div>
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono-tabular text-[10px] font-bold uppercase shrink-0">
                          .{att.extension || 'файл'}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {renderStatusBadge(att.status || 'processed')}
                        {isStagedOnly && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-sans font-semibold text-[10px]">
                            В черновике
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                        <div className="flex items-center gap-1.5 font-mono-tabular">
                          <span>{formatFileSizeRu(att.sizeBytes)}</span>
                          {att.createdAt && (
                            <>
                              <span>·</span>
                              <span>{att.createdAt}</span>
                            </>
                          )}
                        </div>

                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              onSelectAttachment(att.id);
                              onChangeTab('preview');
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                            title="Открыть извлечённый текст документа"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Текст</span>
                          </button>

                          {!isStagedOnly && currentSession && (
                            <button
                              type="button"
                              onClick={() => setAttachmentPendingDelete(att)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-red-600 hover:bg-red-50 transition-colors"
                              title="Удалить файл из текущего диалога"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: ПРОСМОТР (Extracted Text & Status of Selected Dialogue File) */}
        {activeTab === 'preview' && (
          <div className="space-y-4">
            {!selectedAttachment ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center space-y-2 bg-slate-50/50">
                <Eye className="w-6 h-6 text-slate-400 mx-auto" />
                <div className="text-xs font-semibold text-slate-800">
                  Документ для просмотра не выбран
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Прикрепите документ к текущему диалогу или выберите его на
                  вкладке «Материалы», чтобы проверить извлечённый текст.
                </p>
              </div>
            ) : (
              <div className="space-y-3.5">
                {/* File Metadata & Status Card */}
                <div className="rounded-xl p-3.5 bg-slate-50 border border-slate-200/80 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {renderFileTypeIcon(selectedAttachment.extension)}
                      <div className="font-semibold text-xs text-slate-900 break-all">
                        {selectedAttachment.name}
                      </div>
                    </div>
                    {currentSession &&
                      (currentSession.attachments || []).some(
                        (a) => a.id === selectedAttachment.id
                      ) && (
                        <button
                          type="button"
                          onClick={() =>
                            setAttachmentPendingDelete(selectedAttachment)
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-red-600 hover:bg-red-50 shrink-0"
                          title="Удалить файл из диалога"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Удалить</span>
                        </button>
                      )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {renderStatusBadge(
                      selectedAttachment.status || 'processed'
                    )}
                    <span className="text-[11px] font-mono-tabular text-slate-600">
                      .{selectedAttachment.extension.toUpperCase()} ·{' '}
                      {formatFileSizeRu(selectedAttachment.sizeBytes)}
                    </span>
                  </div>

                  {selectedAttachment.warning && (
                    <div className="rounded-lg p-2.5 bg-amber-50 border border-amber-200 text-[11px] text-amber-950 leading-relaxed">
                      {selectedAttachment.warning}
                    </div>
                  )}
                </div>

                {/* Extracted Text Preview */}
                {selectedAttachment.extractedText &&
                selectedAttachment.extractedText.trim().length > 0 ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span className="font-semibold text-slate-700">
                        Извлечённый текст документа
                      </span>
                      <span className="font-mono-tabular">
                        {selectedAttachment.extractedText.length} симв.
                      </span>
                    </div>
                    <pre className="w-full max-h-[440px] overflow-auto rounded-xl bg-slate-900 text-slate-100 p-3.5 text-xs font-mono leading-relaxed whitespace-pre-wrap break-words">
                      {selectedAttachment.extractedText}
                    </pre>
                  </div>
                ) : (
                  <div className="rounded-xl p-4 bg-slate-50 border border-slate-200/90 space-y-1.5">
                    <div className="text-xs font-semibold text-slate-900">
                      Нет доступного извлечённого текста
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      {selectedAttachment.warning ||
                        'В выбранном файле не обнаружено текстового содержимого (например, это отсканированный PDF без текстового слоя).'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: ПОИСК (Full-Text Search Across Dialogues & Messages) */}
        {activeTab === 'search' && (
          <div className="space-y-3.5">
            <div>
              <label
                htmlFor="right-panel-global-search"
                className="block text-xs font-bold text-slate-900 mb-1.5"
              >
                Поиск по всем диалогам и сообщениям
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="right-panel-global-search"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Введите слово или фразу из переписки..."
                  className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-8 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00A8B5]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    aria-label="Очистить поиск"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {!searchQuery.trim() ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-center space-y-1.5 bg-slate-50/50">
                <Search className="w-5 h-5 text-slate-400 mx-auto" />
                <div className="text-xs font-semibold text-slate-800">
                  Быстрый поиск по истории переписки
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Ищите по заголовкам чатов, текстам сообщений и содержимому
                  прикреплённых файлов обеих школ. Нажмите на результат, чтобы
                  перейти к найденному сообщению.
                </p>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="rounded-xl p-4 bg-slate-50 border border-slate-200 text-center text-xs text-slate-600">
                По запросу <strong>«{searchQuery}»</strong> совпадений в
                сохранённых диалогах не найдено.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-[11px] text-slate-500 font-medium">
                  Найдено совпадений: {searchResults.length}
                </div>
                {searchResults.map((hit) => {
                  const hitSchool = SCHOOLS[hit.schoolId];
                  const hitMode = AGENT_MODES[hit.mode];
                  return (
                    <button
                      key={hit.id}
                      type="button"
                      onClick={() =>
                        onJumpToSearchResult(hit.sessionId, hit.messageId)
                      }
                      className="w-full text-left rounded-xl p-3 bg-white hover:bg-slate-50 border border-slate-200/90 transition-all space-y-1.5 shadow-2xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-xs text-slate-900 truncate">
                          {hit.sessionTitle}
                        </span>
                        <span className="text-[10px] font-mono-tabular text-slate-400 shrink-0 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {hit.timestamp}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span
                          className={`px-2 py-0.5 rounded font-display font-extrabold ${
                            hit.schoolId === 'kiberone'
                              ? 'bg-[#FFD700] text-slate-950'
                              : 'bg-[#84CC16] text-slate-950'
                          }`}
                        >
                          {hitSchool.name}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                          {hitMode.shortTitle}
                        </span>
                        {hit.role && (
                          <span className="text-slate-400">
                            · {hit.role === 'user' ? 'Запрос' : 'Ответ'}
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-600 leading-relaxed line-clamp-3">
                        {hit.snippet}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: КОНТЕКСТ (Active School, Specialist, Knowledge Base Status & Honest AI Status) */}
        {activeTab === 'context' && (
          <div className="space-y-4">
            {/* Active School & Specialist Summary Card with Expressive Typographic Badge */}
            <div className="rounded-xl p-3.5 bg-slate-50 border border-slate-200/80 space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded-lg font-display font-extrabold text-xs tracking-wide transition-colors duration-200 ${
                      activeSchool === 'kiberone'
                        ? 'bg-[#FFD700] text-slate-950'
                        : 'bg-[#84CC16] text-slate-950'
                    }`}
                  >
                    {schoolConfig.name}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 leading-relaxed">
                  {schoolConfig.tagline}
                </div>
              </div>

              <div className="pt-2.5 border-t border-slate-200/70 space-y-1">
                <div className="text-[11px] text-slate-400">
                  Активный специалист
                </div>
                <div className="text-xs font-bold text-slate-900">
                  {modeConfig.title}
                </div>
                <div className="text-[11px] text-slate-600 leading-relaxed">
                  {modeConfig.roleSubtitle}
                </div>
              </div>

              <div className="pt-2.5 border-t border-slate-200/70 flex items-center justify-between text-[11px]">
                <span className="text-slate-500">Документов в диалоге:</span>
                <span className="font-mono-tabular font-bold text-slate-900">
                  {sessionAttachments.length}
                </span>
              </div>
            </div>

            {/* Honest AI Providers & Failover Status Banner (Stage 3.3) */}
            <div className="rounded-xl p-3.5 border border-slate-200/90 bg-white space-y-2.5 shadow-2xs">
              <div className="flex items-center justify-between gap-2 text-xs font-bold text-slate-900">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#00A8B5] shrink-0" />
                  <span>Бесплатные ИИ-провайдеры (Этап 3.3)</span>
                </div>
                {onCheckProvidersOnDemand && (
                  <button
                    type="button"
                    disabled={isCheckingProviders}
                    onClick={() => void onCheckProvidersOnDemand()}
                    className="px-2 py-0.5 rounded-lg bg-slate-900 text-white text-[10px] font-semibold hover:bg-slate-800 disabled:opacity-50"
                  >
                    {isCheckingProviders ? 'Проверка…' : 'Проверить подключение'}
                  </button>
                )}
              </div>

              {onChangeProviderSelection && (
                <select
                  value={providerSelection}
                  onChange={(e) =>
                    onChangeProviderSelection(
                      e.target.value as AIProviderSelectionMode
                    )
                  }
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00A8B5]"
                >
                  <option value="auto">
                    Автоматический выбор модели (1. Gemini → 2. OpenRouter → 3. Ollama)
                  </option>
                  <option value="gemini">Только Google Gemini Free</option>
                  <option value="openrouter">
                    Только OpenRouter Free (openrouter/free)
                  </option>
                  <option value="ollama">
                    Только Ollama Local (127.0.0.1:11434)
                  </option>
                </select>
              )}

              {providersState ? (
                <div className="space-y-1.5">
                  {(['gemini', 'openrouter', 'ollama'] as AIProviderId[]).map(
                    (pid, idx) => {
                      const p = providersState.providers[pid];
                      if (!p) return null;
                      const isOk =
                        p.status === 'connected' || p.status === 'available';
                      const isWarn =
                        p.status === 'quota_exceeded' ||
                        p.status === 'temporarily_unavailable';
                      return (
                        <div
                          key={pid}
                          className="rounded-lg p-2 bg-slate-50 border border-slate-200/80 space-y-0.5 text-[11px]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900">
                              {idx + 1}. {p.label}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                isOk
                                  ? 'bg-emerald-100 text-emerald-900'
                                  : isWarn
                                    ? 'bg-amber-100 text-amber-900'
                                    : 'bg-slate-200 text-slate-700'
                              }`}
                            >
                              {p.statusLabelRu}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono-tabular">
                            Модель: {p.lastResolvedModel || p.defaultModel}
                          </div>
                          {p.lastErrorReason && (
                            <div className="text-[10px] text-slate-500 leading-snug">
                              {p.lastErrorReason}
                            </div>
                          )}
                        </div>
                      );
                    }
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Основная модель:{' '}
                  <strong>{geminiStatus?.model || 'gemini-3.8-flash'}</strong>.
                  В запрос передаются только разделы Базы знаний школы{' '}
                  <strong>{schoolConfig.name}</strong> и явно выбранные вами
                  документы.
                </p>
              )}
            </div>

            {/* Active School Knowledge Base Categories Status */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">
                  База знаний школы {schoolConfig.name}
                </span>
                <span className="text-[11px] font-mono-tabular font-semibold text-slate-700">
                  {filledCategories.length} / {KNOWLEDGE_CATEGORIES.length}{' '}
                  заполнено
                </span>
              </div>

              <div className="space-y-1.5">
                {KNOWLEDGE_CATEGORIES.map((cat) => {
                  const val = (schoolKnowledge[cat.key] || '').trim();
                  const isFilled = val.length > 0;
                  return (
                    <div
                      key={cat.key}
                      className={`rounded-xl p-2.5 border text-xs ${
                        isFilled
                          ? 'bg-white border-slate-200/90'
                          : 'bg-slate-50/70 border-slate-200/60 text-slate-400'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <CheckCircle2
                            className={`w-3.5 h-3.5 shrink-0 ${
                              isFilled ? 'text-emerald-600' : 'text-slate-300'
                            }`}
                          />
                          <span
                            className={`font-semibold truncate ${
                              isFilled ? 'text-slate-900' : 'text-slate-500'
                            }`}
                          >
                            {cat.title}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono-tabular shrink-0">
                          {isFilled ? `${val.length} симв.` : 'Пусто'}
                        </span>
                      </div>
                      {isFilled && (
                        <p className="mt-1 text-[11px] text-slate-600 line-clamp-2 pl-5">
                          {val}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {emptyCategories.length > 0 && (
                <div className="text-[11px] text-slate-500 leading-relaxed">
                  Не заполнено разделов: {emptyCategories.length}. Вы можете
                  внести проверенные данные или загрузить документы в разделе
                  «База знаний».
                </div>
              )}

              <div className="pt-1 flex items-center justify-between text-[11px] text-slate-500">
                <span>Подтверждённых документов школы:</span>
                <span className="font-mono-tabular font-semibold text-slate-800">
                  {schoolDocs.length}
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  onNavigate('knowledge');
                  onCloseMobile();
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 transition-colors"
              >
                <BookOpen className="w-3.5 h-3.5 text-[#00A8B5]" />
                <span>Открыть Базу знаний ({schoolConfig.name})</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal for Deleting an Attachment from Current Dialogue */}
      {attachmentPendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
          onClick={() => {
            if (!isDeletingAttachment) setAttachmentPendingDelete(null);
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 shadow-xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600 shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="font-display font-bold text-sm text-slate-900">
                  Удалить файл из диалога?
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 break-all">
                  «{attachmentPendingDelete.name}»
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Файл будет удалён из материалов текущего диалога в локальном
              хранилище IndexedDB. Общая База знаний школы не изменится.
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isDeletingAttachment}
                onClick={() => setAttachmentPendingDelete(null)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={isDeletingAttachment}
                onClick={handleConfirmDeleteAttachment}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingAttachment ? 'Удаление...' : 'Удалить'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop 3rd Column */}
      <aside className="hidden xl:block shrink-0 h-screen sticky top-0 z-30">
        {renderPanelContent(false)}
      </aside>

      {/* Responsive Drawer for < xl screens */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 xl:hidden flex justify-end">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <div className="relative z-10 h-full">
            {renderPanelContent(true)}
          </div>
        </div>
      )}
    </>
  );
};
