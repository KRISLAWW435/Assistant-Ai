import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  FileUp,
  Loader2,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  DocumentProcessingStatus,
  KnowledgeBaseBySchool,
  KnowledgeCategoryKey,
  SchoolId,
  UploadedDocumentRecord,
} from '../types/assistant';
import { KNOWLEDGE_CATEGORIES, SCHOOLS } from '../config/schoolsAndModes';
import {
  getStatusLabelRu,
  ParsedDocumentResult,
  parseDocumentFile,
} from '../utils/documentParser';
import { formatFileSizeRu } from './RightWorkspacePanel';

interface KnowledgeBaseViewProps {
  activeSchool: SchoolId;
  onSelectSchool: (school: SchoolId) => void;
  knowledgeBase: KnowledgeBaseBySchool;
  onUpdateCategory: (
    schoolId: SchoolId,
    categoryKey: KnowledgeCategoryKey,
    value: string
  ) => Promise<boolean>;
  uploadedDocuments: UploadedDocumentRecord[];
  onSaveVerifiedDocument: (
    doc: UploadedDocumentRecord,
    categoryUpdate?: {
      schoolId: SchoolId;
      categoryKey: KnowledgeCategoryKey;
      nextCategoryText: string;
    }
  ) => Promise<boolean>;
  onDeleteDocument: (docId: string) => Promise<boolean>;
  onTriggerExportBackup: () => void;
  onTriggerImportBackup: (file: File) => void;
  statusBanner: string | null;
  onDismissBanner: () => void;
}

type CompositeCategoryKey = `${SchoolId}:${KnowledgeCategoryKey}`;
type FlagByCompositeKey = Partial<Record<CompositeCategoryKey, boolean>>;
type CategoryInsertMode = 'append' | 'replace' | 'doc_only';

interface StagedKnowledgeDocument {
  schoolId: SchoolId;
  categoryKey: KnowledgeCategoryKey;
  parsed: ParsedDocumentResult;
  editableText: string;
  insertMode: CategoryInsertMode;
  confirmReplaceExisting: boolean;
}

export function renderStatusBadge(status: DocumentProcessingStatus) {
  const label = getStatusLabelRu(status);
  switch (status) {
    case 'processed':
    case 'verified':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          {label}
        </span>
      );
    case 'processing':
    case 'queued':
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-50 border border-sky-200 text-sky-800 text-[11px] font-semibold">
          <Loader2 className="w-3 h-3 animate-spin text-sky-600" />
          {label}
        </span>
      );
    case 'no_text':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-semibold">
          <AlertTriangle className="w-3 h-3 text-amber-600" />
          {label}
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 border border-red-200 text-red-800 text-[11px] font-semibold">
          <AlertTriangle className="w-3 h-3 text-red-600" />
          {label}
        </span>
      );
  }
}

export const KnowledgeBaseView: React.FC<KnowledgeBaseViewProps> = ({
  activeSchool,
  onSelectSchool,
  knowledgeBase,
  onUpdateCategory,
  uploadedDocuments,
  onSaveVerifiedDocument,
  onDeleteDocument,
  onTriggerExportBackup,
  onTriggerImportBackup,
  statusBanner,
  onDismissBanner,
}) => {
  const [selectedCategoryForUpload, setSelectedCategoryForUpload] =
    useState<KnowledgeCategoryKey>('programs');

  // Live parsing status indicator while reading a file
  const [activeParseState, setActiveParseState] = useState<{
    fileName: string;
    status: DocumentProcessingStatus;
    label: string;
  } | null>(null);

  // Staged document awaiting manager verification & confirmation
  const [stagedDoc, setStagedDoc] = useState<StagedKnowledgeDocument | null>(
    null
  );
  const [isCommittingStagedDoc, setIsCommittingStagedDoc] = useState(false);

  // Inspecting an already saved document
  const [inspectedDoc, setInspectedDoc] =
    useState<UploadedDocumentRecord | null>(null);
  const [docPendingDelete, setDocPendingDelete] =
    useState<UploadedDocumentRecord | null>(null);
  const [isDeletingDoc, setIsDeletingDoc] = useState(false);

  // Unsaved draft values isolated by schoolId and categoryKey
  const [draftFieldsBySchool, setDraftFieldsBySchool] =
    useState<KnowledgeBaseBySchool>(() => ({
      kiberone: { ...knowledgeBase.kiberone },
      renderia: { ...knowledgeBase.renderia },
    }));

  const [dirtyByKey, setDirtyByKey] = useState<FlagByCompositeKey>({});
  const [savedIndicatorByKey, setSavedIndicatorByKey] =
    useState<FlagByCompositeKey>({});
  const [savingByKey, setSavingByKey] = useState<FlagByCompositeKey>({});

  const saveTimersRef = useRef<
    Partial<Record<CompositeCategoryKey, ReturnType<typeof setTimeout>>>
  >({});
  const docInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const timers = saveTimersRef.current;
    return () => {
      Object.values(timers).forEach((timer) => {
        if (timer) clearTimeout(timer);
      });
    };
  }, []);

  const schoolConfig = SCHOOLS[activeSchool];
  const confirmedSchoolData = knowledgeBase[activeSchool];
  const schoolDocs = uploadedDocuments.filter(
    (d) => d.schoolId === activeSchool
  );

  const filledCount = KNOWLEDGE_CATEGORIES.filter(
    (c) => (confirmedSchoolData[c.key] || '').trim().length > 0
  ).length;

  const triggerSavedFlash = (
    schoolId: SchoolId,
    key: KnowledgeCategoryKey
  ) => {
    const compositeKey: CompositeCategoryKey = `${schoolId}:${key}`;
    const prevTimer = saveTimersRef.current[compositeKey];
    if (prevTimer) {
      clearTimeout(prevTimer);
    }
    setSavedIndicatorByKey((prev) => ({ ...prev, [compositeKey]: true }));
    saveTimersRef.current[compositeKey] = setTimeout(() => {
      setSavedIndicatorByKey((prev) => ({ ...prev, [compositeKey]: false }));
      delete saveTimersRef.current[compositeKey];
    }, 2600);
  };

  const handleDraftChange = (
    schoolId: SchoolId,
    key: KnowledgeCategoryKey,
    value: string
  ) => {
    const compositeKey: CompositeCategoryKey = `${schoolId}:${key}`;
    const confirmedVal = knowledgeBase[schoolId][key] ?? '';

    setDraftFieldsBySchool((prev) => ({
      ...prev,
      [schoolId]: {
        ...prev[schoolId],
        [key]: value,
      },
    }));

    setDirtyByKey((prev) => ({
      ...prev,
      [compositeKey]: value !== confirmedVal,
    }));

    if (savedIndicatorByKey[compositeKey]) {
      const prevTimer = saveTimersRef.current[compositeKey];
      if (prevTimer) {
        clearTimeout(prevTimer);
        delete saveTimersRef.current[compositeKey];
      }
      setSavedIndicatorByKey((prev) => ({ ...prev, [compositeKey]: false }));
    }
  };

  const handleConfirmCategoryField = async (
    schoolId: SchoolId,
    key: KnowledgeCategoryKey
  ) => {
    const compositeKey: CompositeCategoryKey = `${schoolId}:${key}`;
    const isDirty = Boolean(dirtyByKey[compositeKey]);
    const valueToCommit = isDirty
      ? draftFieldsBySchool[schoolId][key] ?? ''
      : knowledgeBase[schoolId][key] ?? '';

    setSavingByKey((prev) => ({ ...prev, [compositeKey]: true }));
    try {
      const ok = await onUpdateCategory(schoolId, key, valueToCommit);
      if (ok) {
        setDirtyByKey((prev) => ({ ...prev, [compositeKey]: false }));
        setDraftFieldsBySchool((prev) => ({
          ...prev,
          [schoolId]: {
            ...prev[schoolId],
            [key]: valueToCommit,
          },
        }));
        triggerSavedFlash(schoolId, key);
      }
    } finally {
      setSavingByKey((prev) => ({ ...prev, [compositeKey]: false }));
    }
  };

  const handleClearCategoryField = async (
    schoolId: SchoolId,
    key: KnowledgeCategoryKey
  ) => {
    const compositeKey: CompositeCategoryKey = `${schoolId}:${key}`;

    setDraftFieldsBySchool((prev) => ({
      ...prev,
      [schoolId]: {
        ...prev[schoolId],
        [key]: '',
      },
    }));

    const prevTimer = saveTimersRef.current[compositeKey];
    if (prevTimer) {
      clearTimeout(prevTimer);
      delete saveTimersRef.current[compositeKey];
    }
    setSavedIndicatorByKey((prev) => ({ ...prev, [compositeKey]: false }));

    setSavingByKey((prev) => ({ ...prev, [compositeKey]: true }));
    try {
      const ok = await onUpdateCategory(schoolId, key, '');
      if (ok) {
        setDirtyByKey((prev) => ({ ...prev, [compositeKey]: false }));
        triggerSavedFlash(schoolId, key);
      }
    } finally {
      setSavingByKey((prev) => ({ ...prev, [compositeKey]: false }));
    }
  };

  const handleDocUploadChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const targetSchool = activeSchool;
    const targetCat = selectedCategoryForUpload;

    setActiveParseState({
      fileName: file.name,
      status: 'queued',
      label: getStatusLabelRu('queued'),
    });

    const parsed = await parseDocumentFile(file, (status, label) => {
      setActiveParseState({
        fileName: file.name,
        status,
        label,
      });
    });

    setActiveParseState(null);

    const defaultInsertMode: CategoryInsertMode =
      parsed.extractedText.trim().length > 0 ? 'append' : 'doc_only';

    setStagedDoc({
      schoolId: targetSchool,
      categoryKey: targetCat,
      parsed,
      editableText: parsed.extractedText,
      insertMode: defaultInsertMode,
      confirmReplaceExisting: false,
    });
  };

  const handleCommitStagedDocument = async () => {
    if (!stagedDoc) return;

    const { schoolId, categoryKey, parsed, editableText, insertMode } =
      stagedDoc;
    const existingText = (knowledgeBase[schoolId][categoryKey] || '').trim();
    const cleanedDocText = editableText.trim();

    if (
      insertMode === 'replace' &&
      existingText.length > 0 &&
      !stagedDoc.confirmReplaceExisting
    ) {
      return;
    }

    setIsCommittingStagedDoc(true);
    try {
      const now = new Date();
      const nowStr = now.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const finalStatus: DocumentProcessingStatus =
        parsed.status === 'error'
          ? 'error'
          : cleanedDocText.length > 0
            ? 'processed'
            : 'no_text';

      const docRecord: UploadedDocumentRecord = {
        id: `doc-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
        name: parsed.name,
        extension: parsed.extension,
        sizeBytes: parsed.sizeBytes,
        schoolId,
        categoryKey,
        status: finalStatus,
        statusMessage: getStatusLabelRu(finalStatus),
        warning: parsed.warning,
        extractedText: cleanedDocText,
        createdAt: nowStr,
        createdAtMs: now.getTime(),
        verifiedByManager: true,
        pageCount: parsed.pageCount,
      };

      let categoryUpdate:
        | {
            schoolId: SchoolId;
            categoryKey: KnowledgeCategoryKey;
            nextCategoryText: string;
          }
        | undefined;

      if (insertMode === 'append' && cleanedDocText.length > 0) {
        const header = `[Источник: ${parsed.name}]`;
        const nextCategoryText = existingText
          ? `${existingText}\n\n${header}\n${cleanedDocText}`
          : `${header}\n${cleanedDocText}`;
        categoryUpdate = {
          schoolId,
          categoryKey,
          nextCategoryText,
        };
      } else if (insertMode === 'replace' && cleanedDocText.length > 0) {
        categoryUpdate = {
          schoolId,
          categoryKey,
          nextCategoryText: cleanedDocText,
        };
      }

      const ok = await onSaveVerifiedDocument(docRecord, categoryUpdate);
      if (ok) {
        if (categoryUpdate) {
          const compositeKey: CompositeCategoryKey = `${schoolId}:${categoryKey}`;
          setDirtyByKey((prev) => ({ ...prev, [compositeKey]: false }));
          setDraftFieldsBySchool((prev) => ({
            ...prev,
            [schoolId]: {
              ...prev[schoolId],
              [categoryKey]: categoryUpdate!.nextCategoryText,
            },
          }));
          triggerSavedFlash(schoolId, categoryKey);
        }
        setStagedDoc(null);
      }
    } finally {
      setIsCommittingStagedDoc(false);
    }
  };

  const handleConfirmDeleteDoc = async () => {
    if (!docPendingDelete) return;
    setIsDeletingDoc(true);
    try {
      await onDeleteDocument(docPendingDelete.id);
      if (inspectedDoc?.id === docPendingDelete.id) {
        setInspectedDoc(null);
      }
      setDocPendingDelete(null);
    } finally {
      setIsDeletingDoc(false);
    }
  };

  const handleBackupFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onTriggerImportBackup(file);
    e.target.value = '';
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Top Header & Typographic School Switcher Card */}
      <div className="glass-panel rounded-2xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="flex items-start gap-4 max-w-2xl">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2">
              <span
                className={`px-3.5 py-1 rounded-xl font-display font-extrabold text-sm tracking-wide transition-colors duration-200 ${
                  activeSchool === 'kiberone'
                    ? 'bg-[#FFD700] text-slate-950'
                    : 'bg-[#84CC16] text-slate-950'
                }`}
              >
                {schoolConfig.name}
              </span>
              <span className="text-xs font-medium text-slate-500">
                · Активная база знаний
              </span>
            </div>
            <h1 className="font-display font-bold text-xl sm:text-2xl text-slate-900">
              База знаний образовательных школ
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Сведения и загруженные документы хранятся раздельно для{' '}
              <strong>KIBERONE</strong> и <strong>RENDERIA</strong> в локальном
              хранилище <strong>IndexedDB</strong>.
            </p>
          </div>
        </div>

        {/* School Switcher + Backup Controls */}
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200/80">
            {(['kiberone', 'renderia'] as SchoolId[]).map((id) => {
              const s = SCHOOLS[id];
              const isSelected = activeSchool === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectSchool(id)}
                  className={`px-4 py-2 rounded-lg font-display font-extrabold text-xs sm:text-sm tracking-wide transition-colors duration-200 whitespace-nowrap ${
                    isSelected
                      ? id === 'kiberone'
                        ? 'bg-[#FFD700] text-slate-950 shadow-xs'
                        : 'bg-[#84CC16] text-slate-950 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/70'
                  }`}
                >
                  {s.name}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onTriggerExportBackup}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors whitespace-nowrap shadow-2xs"
          >
            <Download
              className={`w-4 h-4 ${
                activeSchool === 'renderia'
                  ? 'text-[#84CC16]'
                  : 'text-[#FFD700]'
              }`}
            />
            <span>Создать резервную копию</span>
          </button>

          <input
            ref={backupInputRef}
            type="file"
            accept=".json"
            onChange={handleBackupFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => backupInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold glass-button text-slate-800 hover:bg-white transition-colors whitespace-nowrap"
          >
            <Upload className="w-4 h-4 text-[#165B73]" />
            <span>Импорт копии (.json)</span>
          </button>
        </div>
      </div>

      {statusBanner && (
        <div className="glass-panel rounded-xl px-4 py-3 border border-[#00A8B5]/40 bg-[#00A8B5]/5 flex items-center justify-between gap-3 text-xs text-slate-800">
          <span>{statusBanner}</span>
          <button
            type="button"
            onClick={onDismissBanner}
            className="font-semibold text-[#00A8B5] hover:underline shrink-0"
          >
            Понятно
          </button>
        </div>
      )}

      {/* Document Upload & Text Extraction Bar */}
      <div
        className={`glass-panel rounded-2xl p-5 border flex flex-col md:flex-row md:items-center justify-between gap-4 ${
          activeSchool === 'renderia'
            ? 'border-[#84CC16]/60 bg-[#84CC16]/5'
            : 'border-slate-200/80'
        }`}
      >
        <div className="space-y-1">
          <div className="text-sm font-display font-bold text-slate-900">
            Загрузка и разбор документа для школы {schoolConfig.name}
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Поддерживаются форматы{' '}
            <strong>PDF, DOCX, PPTX, TXT, CSV, MD</strong>. После выбора файла
            текст будет автоматически извлечён и показан в окне предварительного
            просмотра для вашего подтверждения.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <select
            value={selectedCategoryForUpload}
            onChange={(e) =>
              setSelectedCategoryForUpload(
                e.target.value as KnowledgeCategoryKey
              )
            }
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00A8B5]"
          >
            {KNOWLEDGE_CATEGORIES.map((cat) => (
              <option key={cat.key} value={cat.key}>
                Раздел: {cat.title}
              </option>
            ))}
          </select>

          <input
            ref={docInputRef}
            type="file"
            accept=".pdf,.docx,.pptx,.txt,.md,.csv"
            onChange={handleDocUploadChange}
            className="hidden"
          />
          <button
            type="button"
            disabled={Boolean(activeParseState)}
            onClick={() => docInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            {activeParseState ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-[#00A8B5]" />
                <span>
                  {activeParseState.label}: {activeParseState.fileName}
                </span>
              </>
            ) : (
              <>
                <FileUp
                  className={`w-4 h-4 ${
                    activeSchool === 'renderia'
                      ? 'text-[#84CC16]'
                      : 'text-[#F5B800]'
                  }`}
                />
                <span>Загрузить документ</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Verified School Documents Section (Isolated by activeSchool) */}
      <div className="glass-panel rounded-2xl p-5 border border-slate-200/80 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display font-bold text-base text-slate-900">
              Подтверждённые документы школы {schoolConfig.name} (
              {schoolDocs.length})
            </h2>
            <p className="text-xs text-slate-500">
              Документы хранятся в IndexedDB отдельно для каждой школы. Удаление
              документа из списка не стирает текст разделов Базы знаний.
            </p>
          </div>
          <div className="text-xs text-slate-600">
            Заполнено текстовых разделов ({schoolConfig.name}):{' '}
            <span className="font-mono-tabular font-bold text-slate-900">
              {filledCount} из {KNOWLEDGE_CATEGORIES.length}
            </span>
          </div>
        </div>

        {schoolDocs.length === 0 ? (
          <div className="rounded-xl p-4 bg-white/85 border border-dashed border-slate-200 text-xs text-slate-500 text-center">
            Для школы <strong>{schoolConfig.name}</strong> пока нет загруженных
            документов. Анна, вы можете добавить PDF, DOCX, PPTX, TXT, CSV или
            MD в карточке выше — мы аккуратно извлечём текст и покажем его перед
            сохранением.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {schoolDocs.map((doc) => {
              const catMeta = KNOWLEDGE_CATEGORIES.find(
                (c) => c.key === doc.categoryKey
              );
              return (
                <div
                  key={doc.id}
                  className="rounded-xl p-3.5 bg-white border border-slate-200/90 flex flex-col justify-between gap-3 shadow-2xs"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-[#00A8B5] shrink-0" />
                        <span
                          className="font-semibold text-xs text-slate-900 truncate"
                          title={doc.name}
                        >
                          {doc.name}
                        </span>
                      </div>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono-tabular text-[10px] font-bold uppercase shrink-0">
                        .{doc.extension}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {renderStatusBadge(doc.status)}
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-medium truncate">
                        {catMeta?.title || doc.categoryKey}
                      </span>
                    </div>

                    {doc.warning && (
                      <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200/80 rounded-lg px-2.5 py-1.5 leading-snug">
                        {doc.warning}
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span className="font-mono-tabular">
                      {formatFileSizeRu(doc.sizeBytes)} · {doc.createdAt}
                    </span>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setInspectedDoc(doc)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Текст</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDocPendingDelete(doc)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg font-medium text-red-600 hover:bg-red-50 transition-colors"
                        title="Удалить карточку документа из Базы знаний"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 8 Structured Categories Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {KNOWLEDGE_CATEGORIES.map((category) => {
          const compositeKey: CompositeCategoryKey = `${activeSchool}:${category.key}`;
          const confirmedValue = confirmedSchoolData[category.key] ?? '';
          const isDirty = Boolean(dirtyByKey[compositeKey]);
          const displayedValue = isDirty
            ? draftFieldsBySchool[activeSchool][category.key] ?? ''
            : confirmedValue;

          const hasUnsavedChanges =
            isDirty && displayedValue !== confirmedValue;
          const isConfirmedFilled = confirmedValue.trim().length > 0;
          const isDraftOrConfirmedFilled =
            displayedValue.trim().length > 0 || isConfirmedFilled;
          const isRecentlySaved = Boolean(savedIndicatorByKey[compositeKey]);
          const isSaving = Boolean(savingByKey[compositeKey]);
          const categoryDocsCount = schoolDocs.filter(
            (d) => d.categoryKey === category.key
          ).length;

          return (
            <div
              key={compositeKey}
              className={`glass-panel rounded-2xl p-5 flex flex-col justify-between gap-3 border ${
                activeSchool === 'renderia' && isConfirmedFilled
                  ? 'border-[#84CC16]/60'
                  : 'border-slate-200/80'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display font-bold text-base text-slate-900">
                      {category.title}
                    </h3>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        activeSchool === 'kiberone'
                          ? 'bg-[#F5B800]/30 text-slate-900'
                          : 'bg-[#84CC16]/35 text-[#365314]'
                      }`}
                    >
                      {schoolConfig.name}
                    </span>
                    {categoryDocsCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-mono-tabular font-semibold">
                        Документов: {categoryDocsCount}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {category.subtitle}
                  </p>
                </div>
                <span className="text-xs text-slate-500 font-mono-tabular shrink-0">
                  {hasUnsavedChanges
                    ? `Черновик (${displayedValue.length} симв.)`
                    : isConfirmedFilled
                      ? `${confirmedValue.length} симв.`
                      : 'Пусто'}
                </span>
              </div>

              <textarea
                rows={5}
                value={displayedValue}
                onChange={(e) =>
                  handleDraftChange(activeSchool, category.key, e.target.value)
                }
                placeholder={category.placeholder}
                className="w-full rounded-xl border border-slate-200/90 bg-white/90 px-3.5 py-2.5 text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00A8B5] leading-relaxed resize-y"
              />

              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="text-[11px] text-slate-500">
                  {isSaving ? (
                    <span className="text-slate-700 font-medium">
                      Запись в IndexedDB ({schoolConfig.name})...
                    </span>
                  ) : hasUnsavedChanges ? (
                    <span className="text-amber-700 font-medium">
                      Черновик ({schoolConfig.name}) изменён — нажмите
                      «Сохранить»
                    </span>
                  ) : isRecentlySaved ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                      <Check className="w-3.5 h-3.5" />
                      Сохранено в IndexedDB для {schoolConfig.name}
                    </span>
                  ) : isConfirmedFilled ? (
                    <span className="font-medium text-slate-700">
                      Сохранено в IndexedDB для {schoolConfig.name}
                    </span>
                  ) : (
                    <span>
                      Нет данных ({schoolConfig.name}) — ИИ задаст уточняющий
                      вопрос
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isDraftOrConfirmedFilled && (
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() =>
                        handleClearCategoryField(activeSchool, category.key)
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-slate-500 hover:text-red-700 hover:bg-red-50 disabled:opacity-40 transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Очистить</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      handleConfirmCategoryField(activeSchool, category.key)
                    }
                    disabled={!hasUnsavedChanges || isSaving}
                    className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                      hasUnsavedChanges && !isSaving
                        ? 'bg-slate-900 text-white hover:bg-slate-800'
                        : 'bg-slate-100 text-slate-400 cursor-default'
                    }`}
                  >
                    <Save
                      className={`w-3 h-3 ${
                        hasUnsavedChanges && !isSaving
                          ? activeSchool === 'renderia'
                            ? 'text-[#84CC16]'
                            : 'text-[#F5B800]'
                          : 'text-slate-400'
                      }`}
                    />
                    <span>{isSaving ? 'Сохранение...' : 'Сохранить'}</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* MODAL 1: Document Extraction Preview & Manager Confirmation */}
      {stagedDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-xs"
          onClick={() => {
            if (!isCommittingStagedDoc) setStagedDoc(null);
          }}
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white border border-slate-200 shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-bold ${
                      stagedDoc.schoolId === 'kiberone'
                        ? 'bg-[#F5B800] text-slate-950'
                        : 'bg-[#84CC16] text-slate-950'
                    }`}
                  >
                    Школа: {SCHOOLS[stagedDoc.schoolId].name}
                  </span>
                  {renderStatusBadge(stagedDoc.parsed.status)}
                </div>
                <h3 className="font-display font-bold text-lg text-slate-900">
                  Проверка документа перед добавлением в Базу знаний
                </h3>
                <p className="text-xs text-slate-500">
                  До нажатия кнопки подтверждения документ не добавляется в
                  общую Базу знаний школы.
                </p>
              </div>
              <button
                type="button"
                disabled={isCommittingStagedDoc}
                onClick={() => setStagedDoc(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* File Metadata Summary */}
            <div className="rounded-xl p-3.5 bg-slate-50 border border-slate-200/80 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-slate-400 block">Файл</span>
                <span className="font-semibold text-slate-900 break-all">
                  {stagedDoc.parsed.name}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Формат и размер</span>
                <span className="font-mono-tabular font-semibold text-slate-800 uppercase">
                  .{stagedDoc.parsed.extension} ·{' '}
                  {formatFileSizeRu(stagedDoc.parsed.sizeBytes)}
                </span>
              </div>
              <div>
                <label className="text-slate-400 block mb-0.5">
                  Целевой раздел Базы знаний
                </label>
                <select
                  value={stagedDoc.categoryKey}
                  onChange={(e) =>
                    setStagedDoc((prev) =>
                      prev
                        ? {
                            ...prev,
                            categoryKey: e.target.value as KnowledgeCategoryKey,
                            confirmReplaceExisting: false,
                          }
                        : null
                    )
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-900"
                >
                  {KNOWLEDGE_CATEGORIES.map((cat) => (
                    <option key={cat.key} value={cat.key}>
                      {cat.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Warnings if partial or no text */}
            {stagedDoc.parsed.warning && (
              <div className="rounded-xl p-3.5 bg-amber-50 border border-amber-200 text-xs text-amber-950 flex items-start gap-2.5 leading-relaxed">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold mb-0.5">
                    Предупреждение при разборе файла
                  </div>
                  <div>{stagedDoc.parsed.warning}</div>
                </div>
              </div>
            )}

            {/* Editable Extracted Text */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800">
                  Извлечённый текст документа (можно отредактировать перед
                  сохранением):
                </span>
                <span className="font-mono-tabular text-slate-500">
                  {stagedDoc.editableText.length} симв.
                </span>
              </div>
              <textarea
                rows={9}
                value={stagedDoc.editableText}
                onChange={(e) =>
                  setStagedDoc((prev) =>
                    prev ? { ...prev, editableText: e.target.value } : null
                  )
                }
                placeholder="Если файл не содержит текстового слоя, вы можете ввести ключевые сведения вручную или сохранить только карточку документа..."
                className="w-full rounded-xl border border-slate-300 bg-white p-3 text-xs font-mono text-slate-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#00A8B5] resize-y"
              />
            </div>

            {/* Mode of adding to the Category (Prevents accidental overwrite!) */}
            {(() => {
              const existingCatText = (
                knowledgeBase[stagedDoc.schoolId][stagedDoc.categoryKey] || ''
              ).trim();
              const catMeta = KNOWLEDGE_CATEGORIES.find(
                (c) => c.key === stagedDoc.categoryKey
              );
              const hasTextToInsert =
                stagedDoc.editableText.trim().length > 0;

              return (
                <div className="rounded-xl p-3.5 bg-slate-50 border border-slate-200/90 space-y-2.5 text-xs">
                  <div className="font-semibold text-slate-900">
                    Как добавить содержимое в раздел «{catMeta?.title}» (
                    {SCHOOLS[stagedDoc.schoolId].name}):
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="kb-insert-mode"
                        checked={stagedDoc.insertMode === 'append'}
                        disabled={!hasTextToInsert}
                        onChange={() =>
                          setStagedDoc((prev) =>
                            prev ? { ...prev, insertMode: 'append' } : null
                          )
                        }
                        className="mt-0.5"
                      />
                      <span>
                        <strong>Дополнить раздел</strong> — добавить проверенный
                        текст документа к существующим материалам раздела без
                        потери старых данных.
                      </span>
                    </label>

                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="kb-insert-mode"
                        checked={stagedDoc.insertMode === 'doc_only'}
                        onChange={() =>
                          setStagedDoc((prev) =>
                            prev ? { ...prev, insertMode: 'doc_only' } : null
                          )
                        }
                        className="mt-0.5"
                      />
                      <span>
                        <strong>Только карточка документа</strong> — сохранить
                        документ и его извлечённый текст в списке документов
                        школы, не меняя текст поля раздела.
                      </span>
                    </label>

                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="kb-insert-mode"
                        checked={stagedDoc.insertMode === 'replace'}
                        disabled={!hasTextToInsert}
                        onChange={() =>
                          setStagedDoc((prev) =>
                            prev ? { ...prev, insertMode: 'replace' } : null
                          )
                        }
                        className="mt-0.5"
                      />
                      <span>
                        <strong>Заменить текст раздела</strong> — полностью
                        заменить текст раздела «{catMeta?.title}» текстом этого
                        документа.
                      </span>
                    </label>
                  </div>

                  {stagedDoc.insertMode === 'replace' &&
                    existingCatText.length > 0 && (
                      <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-950 space-y-1.5">
                        <div className="font-semibold">
                          Внимание: раздел «{catMeta?.title}» уже содержит{' '}
                          {existingCatText.length} симв.
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer font-medium">
                          <input
                            type="checkbox"
                            checked={stagedDoc.confirmReplaceExisting}
                            onChange={(e) =>
                              setStagedDoc((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      confirmReplaceExisting: e.target.checked,
                                    }
                                  : null
                              )
                            }
                          />
                          <span>
                            Подтверждаю замену существующих материалов раздела
                          </span>
                        </label>
                      </div>
                    )}
                </div>
              );
            })()}

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={isCommittingStagedDoc}
                onClick={() => setStagedDoc(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={
                  isCommittingStagedDoc ||
                  stagedDoc.parsed.status === 'error' ||
                  (stagedDoc.insertMode === 'replace' &&
                    (
                      knowledgeBase[stagedDoc.schoolId][
                        stagedDoc.categoryKey
                      ] || ''
                    ).trim().length > 0 &&
                    !stagedDoc.confirmReplaceExisting)
                }
                onClick={handleCommitStagedDocument}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 transition-colors shadow-xs"
              >
                <Check
                  className={`w-4 h-4 ${
                    stagedDoc.schoolId === 'renderia'
                      ? 'text-[#84CC16]'
                      : 'text-[#F5B800]'
                  }`}
                />
                <span>
                  {isCommittingStagedDoc
                    ? 'Сохранение в IndexedDB...'
                    : 'Подтвердить и добавить в Базу знаний'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Inspect Saved Document Text */}
      {inspectedDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-xs"
          onClick={() => setInspectedDoc(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white border border-slate-200 shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-bold ${
                      inspectedDoc.schoolId === 'kiberone'
                        ? 'bg-[#F5B800] text-slate-950'
                        : 'bg-[#84CC16] text-slate-950'
                    }`}
                  >
                    {SCHOOLS[inspectedDoc.schoolId].name}
                  </span>
                  {renderStatusBadge(inspectedDoc.status)}
                  <span className="text-xs text-slate-500 font-mono-tabular">
                    {formatFileSizeRu(inspectedDoc.sizeBytes)} ·{' '}
                    {inspectedDoc.createdAt}
                  </span>
                </div>
                <h3 className="font-display font-bold text-base text-slate-900 break-all">
                  {inspectedDoc.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectedDoc(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {inspectedDoc.warning && (
              <div className="rounded-xl p-3 bg-amber-50 border border-amber-200 text-xs text-amber-900">
                {inspectedDoc.warning}
              </div>
            )}

            {inspectedDoc.extractedText ? (
              <pre className="w-full max-h-96 overflow-auto rounded-xl bg-slate-900 text-slate-100 p-4 text-xs font-mono leading-relaxed whitespace-pre-wrap break-words">
                {inspectedDoc.extractedText}
              </pre>
            ) : (
              <div className="rounded-xl p-4 bg-slate-50 border border-slate-200 text-xs text-slate-600 text-center">
                В этом документе отсутствует извлечённый текст.
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  const target = inspectedDoc;
                  setInspectedDoc(null);
                  setDocPendingDelete(target);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-red-600 hover:bg-red-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Удалить документ</span>
              </button>
              <button
                type="button"
                onClick={() => setInspectedDoc(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Confirm Deleting a Saved Document */}
      {docPendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-xs"
          onClick={() => {
            if (!isDeletingDoc) setDocPendingDelete(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600 shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-display font-bold text-sm text-slate-900">
                  Удалить документ из списка?
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 break-all">
                  «{docPendingDelete.name}» (
                  {SCHOOLS[docPendingDelete.schoolId].name})
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Карточка документа будет удалена из таблицы{' '}
              <code>documents</code> в IndexedDB. Остальные документы и
              сохранённый текст разделов Базы знаний останутся без изменений.
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isDeletingDoc}
                onClick={() => setDocPendingDelete(null)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={isDeletingDoc}
                onClick={handleConfirmDeleteDoc}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingDoc ? 'Удаление...' : 'Удалить документ'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
