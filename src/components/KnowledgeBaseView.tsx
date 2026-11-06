import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileText,
  FileUp,
  Film,
  Filter,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  Loader2,
  Palette,
  Play,
  Plus,
  Presentation,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import {
  DocumentProcessingStatus,
  DocumentSchoolScope,
  ExtractedDocumentImage,
  ExtractedSlideItem,
  KnowledgeBaseBySchool,
  KnowledgeCategoryKey,
  KnowledgeFileType,
  SchoolId,
  UploadedDocumentRecord,
  VisualAssetRole,
  VisualColorSample,
} from '../types/assistant';
import {
  getSchoolNameRu,
  KNOWLEDGE_CATEGORIES,
  SCHOOLS,
} from '../config/schoolsAndModes';
import {
  getStatusLabelRu,
  inspectZipArchive,
  ParsedDocumentResult,
  parseDocumentFile,
  unpackSelectedZipEntries,
  ZipArchiveEntry,
} from '../utils/documentParser';
import { formatFileSizeRu } from './RightWorkspacePanel';
import {
  downloadOrExportFile,
  openLocalFolder,
  saveFileToLocalDisk,
} from '../utils/diskFileManager';

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

export type KnowledgeSubTab =
  | 'categories'
  | 'visual_library'
  | 'brandbooks'
  | 'all_files';

interface StagedKnowledgeDocument {
  schoolId: DocumentSchoolScope;
  categoryKey: KnowledgeCategoryKey;
  parsed: ParsedDocumentResult;
  editableText: string;
  insertMode: CategoryInsertMode;
  confirmReplaceExisting: boolean;
  visualRole?: VisualAssetRole;
  tags: string[];
  description: string;
  sourceFile?: File;
}

const DEFAULT_BRAND_COLORS: Record<SchoolId, VisualColorSample[]> = {
  all: [
    { hex: '#FFD700', label: 'Жёлтый (KIBERone)' },
    { hex: '#00A8B5', label: 'Бирюзовый (KIBERone)' },
    { hex: '#84CC16', label: 'Лайм (RENDERIA)' },
    { hex: '#65A30D', label: 'Зелёный (RENDERIA)' },
  ],
  kiberone: [
    { hex: '#FFD700', label: 'Фирменный жёлтый' },
    { hex: '#00A8B5', label: 'Бирюзовый акцент' },
    { hex: '#165B73', label: 'Глубокий петроль' },
    { hex: '#9B2C2C', label: 'Кирпичный акцент' },
    { hex: '#0F172A', label: 'Тёмный графит' },
    { hex: '#FFFFFF', label: 'Базовый белый' },
  ],
  renderia: [
    { hex: '#84CC16', label: 'Яркий лайм' },
    { hex: '#65A30D', label: 'Глубокий зелёный' },
    { hex: '#1E293B', label: 'Тёмный слейт' },
    { hex: '#38BDF8', label: 'Небесный акцент' },
    { hex: '#F8FAFC', label: 'Фоновый светлый' },
  ],
};

const VISUAL_ROLE_LABELS_RU: Record<VisualAssetRole, { label: string; badgeClass: string }> = {
  logo: { label: 'Логотип', badgeClass: 'bg-blue-100 text-blue-800 border-blue-200' },
  brandbook: { label: 'Брендбук', badgeClass: 'bg-purple-100 text-purple-800 border-purple-200' },
  reference: { label: 'Референс', badgeClass: 'bg-amber-100 text-amber-900 border-amber-200' },
  template: { label: 'Шаблон', badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  palette: { label: 'Палитра', badgeClass: 'bg-rose-100 text-rose-800 border-rose-200' },
  other: { label: 'Материал', badgeClass: 'bg-slate-100 text-slate-700 border-slate-200' },
};

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
  const [activeSubTab, setActiveSubTab] = useState<KnowledgeSubTab>('categories');

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [visualRoleFilter, setVisualRoleFilter] = useState<'all' | VisualAssetRole>('all');
  const [schoolScopeFilter, setSchoolScopeFilter] = useState<'current' | 'all_schools'>('current');
  const [fileTypeFilter, setFileTypeFilter] = useState<'all' | KnowledgeFileType>('all');

  const [selectedCategoryForUpload, setSelectedCategoryForUpload] =
    useState<KnowledgeCategoryKey>('programs');

  // Live parsing status indicator
  const [activeParseState, setActiveParseState] = useState<{
    fileName: string;
    status: DocumentProcessingStatus;
    label: string;
  } | null>(null);

  // Staged document awaiting manager verification
  const [stagedDoc, setStagedDoc] = useState<StagedKnowledgeDocument | null>(null);
  const [isCommittingStagedDoc, setIsCommittingStagedDoc] = useState(false);
  const [tagInput, setTagInput] = useState('');

  // Modals for deep inspection & media viewing
  const [fullSizeImageDoc, setFullSizeImageDoc] = useState<UploadedDocumentRecord | null>(null);
  const [videoPlayerDoc, setVideoPlayerDoc] = useState<UploadedDocumentRecord | null>(null);
  const [pptxSlidesDoc, setPptxSlidesDoc] = useState<UploadedDocumentRecord | null>(null);
  const [selectedSlideIndex, setSelectedSlideIndex] = useState(0);

  // Zip Archive Explorer Modal
  const [zipExplorerState, setZipExplorerState] = useState<{
    file: File;
    entries: ZipArchiveEntry[];
    selectedPaths: Set<string>;
    targetSchool: DocumentSchoolScope;
    targetCategory: KnowledgeCategoryKey;
  } | null>(null);
  const [isUnpackingZip, setIsUnpackingZip] = useState(false);

  // Text Document Inspection & Delete
  const [inspectedDoc, setInspectedDoc] = useState<UploadedDocumentRecord | null>(null);
  const [docPendingDelete, setDocPendingDelete] = useState<UploadedDocumentRecord | null>(null);
  const [isDeletingDoc, setIsDeletingDoc] = useState(false);

  // Color Copy Feedback
  const [copiedHex, setCopiedHex] = useState<string | null>(null);

  // Unsaved category draft values isolated by schoolId and categoryKey
  const [draftFieldsBySchool, setDraftFieldsBySchool] = useState<KnowledgeBaseBySchool>(() => ({
    kiberone: { ...knowledgeBase.kiberone },
    renderia: { ...knowledgeBase.renderia },
  }));

  const [dirtyByKey, setDirtyByKey] = useState<FlagByCompositeKey>({});
  const [savedIndicatorByKey, setSavedIndicatorByKey] = useState<FlagByCompositeKey>({});
  const [savingByKey, setSavingByKey] = useState<FlagByCompositeKey>({});

  const saveTimersRef = useRef<Partial<Record<CompositeCategoryKey, ReturnType<typeof setTimeout>>>>({});
  const universalInputRef = useRef<HTMLInputElement | null>(null);
  const brandbookInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const videoPlayerRef = useRef<HTMLVideoElement | null>(null);

  // Drag and drop upload support for Knowledge Base
  const [isDraggingOverKB, setIsDraggingOverKB] = useState(false);
  const kbDragCounterRef = useRef(0);

  // Custom Brandbook Palette Management
  const [showAddColorModal, setShowAddColorModal] = useState(false);
  const [newColorHex, setNewColorHex] = useState('#00A8B5');
  const [newColorLabel, setNewColorLabel] = useState('');
  const [paletteOverrides, setPaletteOverrides] = useState<
    Record<SchoolId, { added: VisualColorSample[]; removed: string[] }>
  >(() => {
    try {
      const raw = localStorage.getItem('kiber_renderia_custom_palette_v1');
      if (raw) return JSON.parse(raw);
    } catch {}
    return {
      all: { added: [], removed: [] },
      kiberone: { added: [], removed: [] },
      renderia: { added: [], removed: [] },
    };
  });

  useEffect(() => {
    const timers = saveTimersRef.current;
    return () => {
      Object.values(timers).forEach((timer) => {
        if (timer) clearTimeout(timer);
      });
    };
  }, []);

  // General Business Info State (Ecosystem-wide, internal code 'all')
  const [generalBusinessDraft, setGeneralBusinessDraft] = useState<string>(
    knowledgeBase.generalBusinessInfo ?? ''
  );
  const [isGeneralBusinessDirty, setIsGeneralBusinessDirty] = useState(false);
  const [isGeneralBusinessSaving, setIsGeneralBusinessSaving] = useState(false);
  const [generalBusinessSavedFlash, setGeneralBusinessSavedFlash] = useState(false);
  const generalBusinessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync general business info from outside if not currently edited
  useEffect(() => {
    if (!isGeneralBusinessDirty) {
      setGeneralBusinessDraft(knowledgeBase.generalBusinessInfo ?? '');
    }
  }, [knowledgeBase.generalBusinessInfo, isGeneralBusinessDirty]);

  const handleGeneralBusinessChange = (val: string) => {
    setGeneralBusinessDraft(val);
    setIsGeneralBusinessDirty(val !== (knowledgeBase.generalBusinessInfo ?? ''));
    if (generalBusinessSavedFlash) {
      if (generalBusinessTimerRef.current) clearTimeout(generalBusinessTimerRef.current);
      setGeneralBusinessSavedFlash(false);
    }
  };

  const handleSaveGeneralBusiness = async () => {
    setIsGeneralBusinessSaving(true);
    try {
      const ok = await onUpdateCategory('all', 'general_business' as any, generalBusinessDraft);
      if (ok) {
        setIsGeneralBusinessDirty(false);
        setGeneralBusinessSavedFlash(true);
        if (generalBusinessTimerRef.current) clearTimeout(generalBusinessTimerRef.current);
        generalBusinessTimerRef.current = setTimeout(() => {
          setGeneralBusinessSavedFlash(false);
        }, 2600);
      }
    } finally {
      setIsGeneralBusinessSaving(false);
    }
  };

  const handleClearGeneralBusiness = async () => {
    setGeneralBusinessDraft('');
    setIsGeneralBusinessSaving(true);
    try {
      const ok = await onUpdateCategory('all', 'general_business' as any, '');
      if (ok) {
        setIsGeneralBusinessDirty(false);
        setGeneralBusinessSavedFlash(true);
        if (generalBusinessTimerRef.current) clearTimeout(generalBusinessTimerRef.current);
        generalBusinessTimerRef.current = setTimeout(() => {
          setGeneralBusinessSavedFlash(false);
        }, 2600);
      }
    } finally {
      setIsGeneralBusinessSaving(false);
    }
  };

  // Sub-filters when viewing 'all' materials
  const [visualScopeFilter, setVisualScopeFilter] = useState<'all' | 'common' | 'kiberone' | 'renderia'>('all');
  const [filesScopeFilter, setFilesScopeFilter] = useState<'all' | 'common' | 'kiberone' | 'renderia'>('all');

  // Eligible documents for active view:
  // - 'all': all uploaded documents
  // - 'kiberone': kiberone + general materials (all), excludes renderia
  // - 'renderia': renderia + general materials (all), excludes kiberone
  const eligibleSchoolDocs = useMemo(() => {
    if (activeSchool === 'all') {
      return uploadedDocuments;
    }
    return uploadedDocuments.filter(
      (d) => d.schoolId === activeSchool || d.schoolId === 'all'
    );
  }, [uploadedDocuments, activeSchool]);

  // Visual Library Items
  const visualLibraryItems = useMemo(() => {
    return uploadedDocuments.filter((d) => {
      // Primary view scope isolation
      if (activeSchool !== 'all') {
        if (d.schoolId !== activeSchool && d.schoolId !== 'all') return false;
      } else {
        // Quick sub-filter when viewing 'all'
        if (visualScopeFilter === 'common' && d.schoolId !== 'all') return false;
        if (visualScopeFilter === 'kiberone' && d.schoolId !== 'kiberone') return false;
        if (visualScopeFilter === 'renderia' && d.schoolId !== 'renderia') return false;
      }

      // Must be visual: image, presentation, pdf, pptx, docx or have extracted images/slides/dataUrl/thumbnail
      const extLower = (d.extension || '').toLowerCase();
      const isVisual =
        d.fileType === 'image' ||
        d.fileType === 'presentation' ||
        ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'pdf', 'pptx', 'docx'].includes(extLower) ||
        Boolean(d.slides && d.slides.length > 0) ||
        Boolean(d.extractedImages && d.extractedImages.length > 0) ||
        Boolean(d.dataUrl && d.mimeType?.startsWith('image/')) ||
        Boolean(d.thumbnailUrl);

      if (!isVisual) return false;

      // Role filter
      if (visualRoleFilter !== 'all' && d.visualRole !== visualRoleFilter) {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = d.name.toLowerCase().includes(q);
        const matchDesc = (d.description || '').toLowerCase().includes(q);
        const matchTag = (d.tags || []).some((t) => t.toLowerCase().includes(q));
        const matchText = (d.extractedText || '').toLowerCase().includes(q);
        if (!matchName && !matchDesc && !matchTag && !matchText) return false;
      }

      return true;
    });
  }, [uploadedDocuments, activeSchool, visualScopeFilter, visualRoleFilter, searchQuery]);

  // All Files List (with full filtering)
  const filteredAllFiles = useMemo(() => {
    return uploadedDocuments.filter((d) => {
      // Primary view scope isolation
      if (activeSchool !== 'all') {
        if (d.schoolId !== activeSchool && d.schoolId !== 'all') return false;
      } else {
        // Quick sub-filter when viewing 'all'
        if (filesScopeFilter === 'common' && d.schoolId !== 'all') return false;
        if (filesScopeFilter === 'kiberone' && d.schoolId !== 'kiberone') return false;
        if (filesScopeFilter === 'renderia' && d.schoolId !== 'renderia') return false;
      }

      if (fileTypeFilter !== 'all') {
        if (d.fileType !== fileTypeFilter) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = d.name.toLowerCase().includes(q);
        const matchDesc = (d.description || '').toLowerCase().includes(q);
        const matchTag = (d.tags || []).some((t) => t.toLowerCase().includes(q));
        if (!matchName && !matchDesc && !matchTag) return false;
      }
      return true;
    });
  }, [uploadedDocuments, activeSchool, filesScopeFilter, fileTypeFilter, searchQuery]);

  // Brandbook Palette & Documents with Custom Management Support
  const brandbookData = useMemo(() => {
    const schoolOverrides = paletteOverrides[activeSchool] || { added: [], removed: [] };
    const removedUpper = new Set((schoolOverrides.removed || []).map((h) => h.toUpperCase()));

    const basePalette = (DEFAULT_BRAND_COLORS[activeSchool] || []).filter(
      (p) => !removedUpper.has(p.hex.toUpperCase())
    );
    const extractedPalettes: VisualColorSample[] = [];
    const seenHex = new Set(basePalette.map((p) => p.hex.toUpperCase()));

    for (const doc of eligibleSchoolDocs) {
      if (Array.isArray(doc.colorPalette)) {
        for (const c of doc.colorPalette) {
          const clean = c.hex.toUpperCase();
          if (!seenHex.has(clean) && !removedUpper.has(clean)) {
            seenHex.add(clean);
            extractedPalettes.push({
              hex: clean,
              label: c.label || `Из: ${doc.name}`,
            });
          }
        }
      }
    }

    const customAdded: VisualColorSample[] = [];
    for (const c of schoolOverrides.added || []) {
      const clean = c.hex.toUpperCase();
      if (!seenHex.has(clean) && !removedUpper.has(clean)) {
        seenHex.add(clean);
        customAdded.push({
          hex: clean,
          label: c.label || 'Пользовательский цвет',
        });
      }
    }

    const brandDocs = eligibleSchoolDocs.filter(
      (d) =>
        d.visualRole === 'brandbook' ||
        d.visualRole === 'logo' ||
        d.visualRole === 'palette' ||
        (d.tags || []).some((t) => t.toLowerCase().includes('бренд') || t.toLowerCase().includes('лого'))
    );

    return {
      palette: [...basePalette, ...extractedPalettes, ...customAdded],
      brandDocs,
    };
  }, [activeSchool, eligibleSchoolDocs, paletteOverrides]);

  const kiberFilledCount = KNOWLEDGE_CATEGORIES.filter(
    (c) => (knowledgeBase.kiberone[c.key] || '').trim().length > 0
  ).length;

  const renderiaFilledCount = KNOWLEDGE_CATEGORIES.filter(
    (c) => (knowledgeBase.renderia[c.key] || '').trim().length > 0
  ).length;

  const totalCategoriesBadgeText =
    activeSchool === 'all'
      ? `KIBER: ${kiberFilledCount}/8 · RENDER: ${renderiaFilledCount}/8`
      : activeSchool === 'kiberone'
        ? `${kiberFilledCount}/8`
        : `${renderiaFilledCount}/8`;

  const triggerSavedFlash = (schoolId: 'kiberone' | 'renderia', key: KnowledgeCategoryKey) => {
    const compositeKey: CompositeCategoryKey = `${schoolId}:${key}`;
    const prevTimer = saveTimersRef.current[compositeKey];
    if (prevTimer) clearTimeout(prevTimer);
    setSavedIndicatorByKey((prev) => ({ ...prev, [compositeKey]: true }));
    saveTimersRef.current[compositeKey] = setTimeout(() => {
      setSavedIndicatorByKey((prev) => ({ ...prev, [compositeKey]: false }));
      delete saveTimersRef.current[compositeKey];
    }, 2600);
  };

  const handleDraftChange = (targetSchool: 'kiberone' | 'renderia', key: KnowledgeCategoryKey, value: string) => {
    const compositeKey: CompositeCategoryKey = `${targetSchool}:${key}`;
    const confirmedVal = knowledgeBase[targetSchool]?.[key] ?? '';

    setDraftFieldsBySchool((prev) => ({
      ...prev,
      [targetSchool]: {
        ...prev[targetSchool],
        [key]: value,
      },
    }));

    setDirtyByKey((prev) => ({
      ...prev,
      [compositeKey]: value !== confirmedVal,
    }));

    if (savedIndicatorByKey[compositeKey]) {
      const prevTimer = saveTimersRef.current[compositeKey];
      if (prevTimer) clearTimeout(prevTimer);
      setSavedIndicatorByKey((prev) => ({ ...prev, [compositeKey]: false }));
    }
  };

  const handleConfirmCategoryField = async (targetSchool: 'kiberone' | 'renderia', key: KnowledgeCategoryKey) => {
    const compositeKey: CompositeCategoryKey = `${targetSchool}:${key}`;
    const isDirty = Boolean(dirtyByKey[compositeKey]);
    const valueToCommit = isDirty
      ? draftFieldsBySchool[targetSchool]?.[key] ?? ''
      : knowledgeBase[targetSchool]?.[key] ?? '';

    setSavingByKey((prev) => ({ ...prev, [compositeKey]: true }));
    try {
      const ok = await onUpdateCategory(targetSchool, key, valueToCommit);
      if (ok) {
        setDirtyByKey((prev) => ({ ...prev, [compositeKey]: false }));
        setDraftFieldsBySchool((prev) => ({
          ...prev,
          [targetSchool]: {
            ...prev[targetSchool],
            [key]: valueToCommit,
          },
        }));
        triggerSavedFlash(targetSchool, key);
      }
    } finally {
      setSavingByKey((prev) => ({ ...prev, [compositeKey]: false }));
    }
  };

  const handleClearCategoryField = async (targetSchool: 'kiberone' | 'renderia', key: KnowledgeCategoryKey) => {
    const compositeKey: CompositeCategoryKey = `${targetSchool}:${key}`;
    setDraftFieldsBySchool((prev) => ({
      ...prev,
      [targetSchool]: {
        ...prev[targetSchool],
        [key]: '',
      },
    }));

    const prevTimer = saveTimersRef.current[compositeKey];
    if (prevTimer) clearTimeout(prevTimer);
    setSavedIndicatorByKey((prev) => ({ ...prev, [compositeKey]: false }));

    setSavingByKey((prev) => ({ ...prev, [compositeKey]: true }));
    try {
      const ok = await onUpdateCategory(targetSchool, key, '');
      if (ok) {
        setDirtyByKey((prev) => ({ ...prev, [compositeKey]: false }));
        triggerSavedFlash(targetSchool, key);
      }
    } finally {
      setSavingByKey((prev) => ({ ...prev, [compositeKey]: false }));
    }
  };

  // Main file upload handler supporting all formats
  const handleUniversalFileUpload = async (
    file: File,
    presetRole?: VisualAssetRole
  ) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    // If zip archive: open Archive Explorer Modal directly
    if (ext === 'zip') {
      try {
        setActiveParseState({
          fileName: file.name,
          status: 'processing',
          label: 'Чтение архива ZIP',
        });
        const entries = await inspectZipArchive(file);
        setActiveParseState(null);
        setZipExplorerState({
          file,
          entries,
          selectedPaths: new Set(entries.filter((e) => e.isSupported).map((e) => e.path)),
          targetSchool: activeSchool,
          targetCategory: selectedCategoryForUpload,
        });
      } catch (err) {
        setActiveParseState(null);
        alert(
          `Ошибка открытия архива ZIP: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      return;
    }

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

    const defaultRole: VisualAssetRole =
      presetRole ||
      (parsed.fileType === 'image'
        ? file.name.toLowerCase().includes('logo') || file.name.toLowerCase().includes('лого')
          ? 'logo'
          : file.name.toLowerCase().includes('brand') || file.name.toLowerCase().includes('бренд')
            ? 'brandbook'
            : 'reference'
        : 'other');

    const defaultInsertMode: CategoryInsertMode =
      parsed.extractedText.trim().length > 0 && parsed.fileType === 'document'
        ? 'append'
        : 'doc_only';

    const defaultTags: string[] = [];
    if (parsed.fileType === 'image') defaultTags.push('визуал');
    if (defaultRole === 'logo') defaultTags.push('логотип');
    if (defaultRole === 'brandbook') defaultTags.push('брендбук');
    if (parsed.fileType === 'video') defaultTags.push('видео');
    if (parsed.fileType === 'presentation') defaultTags.push('презентация');

    setStagedDoc({
      schoolId: activeSchool,
      categoryKey: selectedCategoryForUpload,
      parsed,
      editableText: parsed.extractedText,
      insertMode: defaultInsertMode,
      confirmReplaceExisting: false,
      visualRole: defaultRole,
      tags: defaultTags,
      description: '',
      sourceFile: file,
    });
  };

  const handleCommitStagedDocument = async () => {
    if (!stagedDoc) return;

    const {
      schoolId,
      categoryKey,
      parsed,
      editableText,
      insertMode,
      visualRole,
      tags,
      description,
    } = stagedDoc;

    const targetSchoolForCategory: 'kiberone' | 'renderia' =
      schoolId === 'renderia' ? 'renderia' : 'kiberone';
    const existingText = (
      knowledgeBase[targetSchoolForCategory]?.[categoryKey] || ''
    ).trim();
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
          : cleanedDocText.length > 0 ||
              parsed.fileType === 'image' ||
              parsed.fileType === 'video'
            ? 'processed'
            : 'no_text';

      let diskRes: { absolutePath?: string; folderPath?: string; sizeBytes?: number } | null = null;
      if (stagedDoc.sourceFile) {
        diskRes = await saveFileToLocalDisk(
          stagedDoc.sourceFile,
          schoolId === 'all' ? activeSchool : schoolId,
          visualRole === 'brandbook' || visualRole === 'logo' ? 'Brandbook' : 'Knowledge_Base'
        );
      }

      const docRecord: UploadedDocumentRecord = {
        id: `doc-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
        name: parsed.name,
        extension: parsed.extension,
        sizeBytes: diskRes?.sizeBytes ?? parsed.sizeBytes,
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
        fileType: parsed.fileType,
        mimeType: parsed.mimeType,
        tags: tags.length > 0 ? tags : undefined,
        description: description.trim() || undefined,
        visualRole,
        dataUrl: parsed.dataUrl,
        thumbnailUrl: parsed.thumbnailUrl,
        slides: parsed.slides,
        colorPalette: parsed.colorPalette,
        extractedImages: parsed.extractedImages,
        durationSec: parsed.durationSec,
        videoWidth: parsed.videoWidth,
        videoHeight: parsed.videoHeight,
        filePath: diskRes?.absolutePath,
        diskFolderPath: diskRes?.folderPath,
      };

      let categoryUpdate:
        | {
            schoolId: SchoolId;
            categoryKey: KnowledgeCategoryKey;
            nextCategoryText: string;
          }
        | undefined;

      if (
        insertMode === 'append' &&
        cleanedDocText.length > 0 &&
        parsed.fileType === 'document'
      ) {
        const header = `[Источник: ${parsed.name}]`;
        const nextCategoryText = existingText
          ? `${existingText}\n\n${header}\n${cleanedDocText}`
          : `${header}\n${cleanedDocText}`;
        categoryUpdate = {
          schoolId: targetSchoolForCategory,
          categoryKey,
          nextCategoryText,
        };
      } else if (
        insertMode === 'replace' &&
        cleanedDocText.length > 0 &&
        parsed.fileType === 'document'
      ) {
        categoryUpdate = {
          schoolId: targetSchoolForCategory,
          categoryKey,
          nextCategoryText: cleanedDocText,
        };
      }

      const ok = await onSaveVerifiedDocument(docRecord, categoryUpdate);
      if (ok) {
        if (categoryUpdate) {
          const compositeKey: CompositeCategoryKey = `${targetSchoolForCategory}:${categoryKey}`;
          setDirtyByKey((prev) => ({ ...prev, [compositeKey]: false }));
          setDraftFieldsBySchool((prev) => ({
            ...prev,
            [targetSchoolForCategory]: {
              ...prev[targetSchoolForCategory],
              [categoryKey]: categoryUpdate!.nextCategoryText,
            },
          }));
          triggerSavedFlash(targetSchoolForCategory, categoryKey);
        }
        setStagedDoc(null);
        setTagInput('');
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
      if (inspectedDoc?.id === docPendingDelete.id) setInspectedDoc(null);
      if (fullSizeImageDoc?.id === docPendingDelete.id) setFullSizeImageDoc(null);
      if (videoPlayerDoc?.id === docPendingDelete.id) setVideoPlayerDoc(null);
      if (pptxSlidesDoc?.id === docPendingDelete.id) setPptxSlidesDoc(null);
      setDocPendingDelete(null);
    } finally {
      setIsDeletingDoc(false);
    }
  };

  const handleUpdateDocMetadata = async (
    doc: UploadedDocumentRecord,
    patch: Partial<UploadedDocumentRecord>
  ) => {
    const updated: UploadedDocumentRecord = {
      ...doc,
      ...patch,
    };
    await onSaveVerifiedDocument(updated);
    if (fullSizeImageDoc?.id === doc.id) setFullSizeImageDoc(updated);
  };

  const handleCaptureVideoFrameToVisualLibrary = async () => {
    if (!videoPlayerDoc || !videoPlayerRef.current) return;
    const video = videoPlayerRef.current;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 360;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

      const now = new Date();
      const timecode = Math.floor(video.currentTime || 0);
      const newImgDoc: UploadedDocumentRecord = {
        id: `doc-frame-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
        name: `Стоп-кадр: ${videoPlayerDoc.name} (${timecode}с).jpg`,
        extension: 'jpg',
        sizeBytes: Math.round(dataUrl.length * 0.75),
        schoolId: videoPlayerDoc.schoolId,
        categoryKey: videoPlayerDoc.categoryKey,
        status: 'processed',
        statusMessage: 'Сохранён стоп-кадр',
        extractedText: `[Стоп-кадр из видео «${videoPlayerDoc.name}», таймкод: ${timecode} с]`,
        createdAt: now.toLocaleString('ru-RU'),
        createdAtMs: now.getTime(),
        verifiedByManager: true,
        fileType: 'image',
        mimeType: 'image/jpeg',
        visualRole: 'reference',
        tags: ['кадр_из_видео', 'референс'],
        dataUrl,
        thumbnailUrl: dataUrl,
      };

      await onSaveVerifiedDocument(newImgDoc);
      alert('Стоп-кадр успешно сохранён в Визуальную библиотеку!');
    } catch {
      alert('Не удалось захватить кадр видео.');
    }
  };

  const handleSavePptxSlideImageToLibrary = async (
    img: ExtractedDocumentImage,
    slideNum?: number
  ) => {
    if (!pptxSlidesDoc) return;
    const now = new Date();
    const newDoc: UploadedDocumentRecord = {
      id: `doc-slideimg-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
      name: `Слайд ${slideNum || 1} - ${img.name}`,
      extension: img.mimeType.includes('png') ? 'png' : 'jpg',
      sizeBytes: Math.round(img.dataUrl.length * 0.75),
      schoolId: pptxSlidesDoc.schoolId,
      categoryKey: pptxSlidesDoc.categoryKey,
      status: 'processed',
      statusMessage: 'Изображение со слайда',
      extractedText: `[Изображение из презентации «${pptxSlidesDoc.name}», слайд ${slideNum || 1}]`,
      createdAt: now.toLocaleString('ru-RU'),
      createdAtMs: now.getTime(),
      verifiedByManager: true,
      fileType: 'image',
      mimeType: img.mimeType,
      visualRole: 'reference',
      tags: ['слайд_презентации', 'референс'],
      dataUrl: img.dataUrl,
      thumbnailUrl: img.dataUrl,
    };
    await onSaveVerifiedDocument(newDoc);
    alert('Изображение со слайда сохранено в Визуальную библиотеку!');
  };

  const handleUnpackSelectedZip = async () => {
    if (!zipExplorerState || zipExplorerState.selectedPaths.size === 0) return;
    setIsUnpackingZip(true);
    try {
      const selected = Array.from(zipExplorerState.selectedPaths);
      const files = await unpackSelectedZipEntries(zipExplorerState.file, selected);

      let successCount = 0;
      for (const f of files) {
        const parsed = await parseDocumentFile(f);
        const now = new Date();
        const role: VisualAssetRole =
          parsed.fileType === 'image'
            ? f.name.toLowerCase().includes('logo')
              ? 'logo'
              : 'reference'
            : 'other';

        const docRecord: UploadedDocumentRecord = {
          id: `doc-zip-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
          name: f.name,
          extension: parsed.extension,
          sizeBytes: f.size,
          schoolId: zipExplorerState.targetSchool,
          categoryKey: zipExplorerState.targetCategory,
          status: parsed.status,
          statusMessage: parsed.statusLabel,
          warning: parsed.warning,
          extractedText: parsed.extractedText,
          createdAt: now.toLocaleString('ru-RU'),
          createdAtMs: now.getTime(),
          verifiedByManager: true,
          pageCount: parsed.pageCount,
          fileType: parsed.fileType,
          mimeType: parsed.mimeType,
          tags: ['из_архива', zipExplorerState.file.name.replace(/\.zip$/i, '')],
          visualRole: role,
          dataUrl: parsed.dataUrl,
          thumbnailUrl: parsed.thumbnailUrl,
          slides: parsed.slides,
          colorPalette: parsed.colorPalette,
          extractedImages: parsed.extractedImages,
          durationSec: parsed.durationSec,
          videoWidth: parsed.videoWidth,
          videoHeight: parsed.videoHeight,
        };

        await onSaveVerifiedDocument(docRecord);
        successCount++;
      }

      setZipExplorerState(null);
      alert(`Успешно распаковано и добавлено файлов в Базу знаний: ${successCount}!`);
    } catch (err) {
      alert(`Ошибка распаковки: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsUnpackingZip(false);
    }
  };

  const handleCopyHex = (hex: string) => {
    navigator.clipboard?.writeText(hex);
    setCopiedHex(hex);
    setTimeout(() => setCopiedHex((prev) => (prev === hex ? null : prev)), 2000);
  };

  const handleAddCustomColor = (e?: React.FormEvent) => {
    e?.preventDefault();
    let hex = newColorHex.trim();
    if (!hex) return;
    if (!hex.startsWith('#')) hex = '#' + hex;
    if (!/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex)) {
      alert('Пожалуйста, введите корректный HEX-код цвета (например, #00A8B5 или #FFF)');
      return;
    }
    hex = hex.toUpperCase();
    const label = newColorLabel.trim() || 'Фирменный цвет';

    setPaletteOverrides((prev) => {
      const cur = prev[activeSchool] || { added: [], removed: [] };
      const nextRemoved = cur.removed.filter((h) => h.toUpperCase() !== hex);
      const nextAdded = [...cur.added.filter((c) => c.hex.toUpperCase() !== hex), { hex, label }];
      const next = {
        ...prev,
        [activeSchool]: {
          added: nextAdded,
          removed: nextRemoved,
        },
      };
      try {
        localStorage.setItem('kiber_renderia_custom_palette_v1', JSON.stringify(next));
      } catch {}
      return next;
    });

    setShowAddColorModal(false);
    setNewColorLabel('');
  };

  const handleDeleteCustomColor = (hexToDelete: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const clean = hexToDelete.toUpperCase();
    setPaletteOverrides((prev) => {
      const cur = prev[activeSchool] || { added: [], removed: [] };
      const nextAdded = cur.added.filter((c) => c.hex.toUpperCase() !== clean);
      const nextRemoved = Array.from(new Set([...cur.removed, clean]));
      const next = {
        ...prev,
        [activeSchool]: {
          added: nextAdded,
          removed: nextRemoved,
        },
      };
      try {
        localStorage.setItem('kiber_renderia_custom_palette_v1', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handleResetPalette = () => {
    setPaletteOverrides((prev) => {
      const next = {
        ...prev,
        [activeSchool]: { added: [], removed: [] },
      };
      try {
        localStorage.setItem('kiber_renderia_custom_palette_v1', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Drag and drop handlers for Knowledge Base
  const handleKBDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    kbDragCounterRef.current += 1;
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      setIsDraggingOverKB(true);
    }
  };

  const handleKBDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleKBDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    kbDragCounterRef.current -= 1;
    if (kbDragCounterRef.current <= 0) {
      kbDragCounterRef.current = 0;
      setIsDraggingOverKB(false);
    }
  };

  const handleKBDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    kbDragCounterRef.current = 0;
    setIsDraggingOverKB(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const rolePreset: VisualAssetRole | undefined =
      activeSubTab === 'brandbooks'
        ? 'brandbook'
        : activeSubTab === 'visual_library'
          ? 'reference'
          : undefined;
    await handleUniversalFileUpload(file, rolePreset);
  };

  const handleBackupFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onTriggerImportBackup(file);
    e.target.value = '';
  };

  return (
    <div
      onDragEnter={handleKBDragEnter}
      onDragOver={handleKBDragOver}
      onDragLeave={handleKBDragLeave}
      onDrop={handleKBDrop}
      className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6 relative min-h-screen"
    >
      {/* Top Header & View Scope Switcher */}
      <div className="glass-panel rounded-2xl p-5 sm:p-6 flex flex-col xl:flex-row xl:items-center justify-between gap-5 border border-slate-200/90 shadow-2xs">
        <div className="space-y-1.5 max-w-2xl">
          <div className="inline-flex items-center gap-2 flex-wrap">
            <span
              className={`px-3 py-1 rounded-xl font-display font-extrabold text-xs sm:text-sm tracking-wide shadow-2xs ${
                activeSchool === 'all'
                  ? 'bg-[#00A8B5] text-white'
                  : activeSchool === 'kiberone'
                    ? 'bg-[#FFD700] text-slate-950'
                    : 'bg-[#84CC16] text-slate-950'
              }`}
            >
              {activeSchool === 'all'
                ? 'Область: Все материалы (Общие + KIBERONE + RENDERIA)'
                : activeSchool === 'kiberone'
                  ? 'Область: KIBERONE (+ общие материалы)'
                  : 'Область: RENDERIA (+ общие материалы)'}
            </span>
            <span className="text-xs font-medium text-slate-500">
              · Единая база знаний экосистемы
            </span>
          </div>
          <h1 className="font-display font-bold text-xl sm:text-2xl text-slate-900">
            База знаний и визуальная библиотека
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
            Хранение документов (PDF, DOCX, TXT), презентаций (PPTX), архивов (ZIP),
            видео (MP4) и брендбуков. Раздельный доступ к <strong>KIBERONE</strong> и <strong>RENDERIA</strong> с поддержкой общих материалов <code>ALL</code> для обеих школ.
          </p>
        </div>

        {/* View Scope Switcher & Actions Strip */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
          {/* Scope Switcher Tabs */}
          <div className="flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200/90 shadow-inner">
            {(
              [
                { id: 'all', label: 'Все материалы' },
                { id: 'kiberone', label: 'KIBERONE' },
                { id: 'renderia', label: 'RENDERIA' },
              ] as const
            ).map((item) => {
              const isSelected = activeSchool === item.id;
              const activeClass =
                item.id === 'all'
                  ? 'bg-[#00A8B5] text-white shadow-xs'
                  : item.id === 'kiberone'
                    ? 'bg-[#FFD700] text-slate-950 shadow-xs'
                    : 'bg-[#84CC16] text-slate-950 shadow-xs';
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectSchool(item.id)}
                  className={`px-3 sm:px-4 py-2 rounded-lg font-display font-extrabold text-xs sm:text-sm tracking-wide transition-all whitespace-nowrap cursor-pointer ${
                    isSelected
                      ? activeClass
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Backup & Folder Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onTriggerExportBackup}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors whitespace-nowrap shadow-2xs cursor-pointer"
              title="Экспорт резервной копии базы знаний (.json)"
            >
              <Download className="w-3.5 h-3.5 text-[#FFD700]" />
              <span>Резервная копия</span>
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
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
              title="Импорт базы знаний из .json файла"
            >
              <Upload className="w-3.5 h-3.5 text-[#165B73]" />
              <span>Импорт (.json)</span>
            </button>

            <button
              type="button"
              onClick={() =>
                openLocalFolder({
                  school: activeSchool,
                  category: activeSubTab === 'brandbooks' ? 'Brandbook' : 'Knowledge_Base',
                })
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-[#00A8B5] text-white hover:bg-[#00929E] transition-colors whitespace-nowrap shadow-2xs cursor-pointer"
              title="Открыть локальную папку в Проводнике Windows"
            >
              <FolderOpen className="w-3.5 h-3.5 text-white" />
              <span>Папка базы знаний</span>
            </button>
          </div>
        </div>
      </div>

      {/* Local Files Path Banner */}
      <div className="glass-panel rounded-xl px-4 py-2.5 border border-slate-200/90 bg-slate-50/90 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-700">
        <div className="flex items-center gap-2 flex-wrap">
          <FolderOpen className="w-4 h-4 text-[#00A8B5] shrink-0" />
          <span>
            Локальная папка файлов:{' '}
            <code className="font-mono font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
              {activeSchool === 'all'
                ? 'Документы/BusinessAssistant/ (Общие материалы / KIBERONE / RENDERIA)'
                : `Документы/BusinessAssistant/${activeSchool.toUpperCase()}/${
                    activeSubTab === 'brandbooks' ? 'Brandbook' : 'Knowledge_Base'
                  }`}
            </code>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {activeSchool === 'all' ? (
            <>
              <button
                type="button"
                onClick={() => openLocalFolder({ school: 'kiberone', category: 'Knowledge_Base' })}
                className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-950 font-bold cursor-pointer text-[11px]"
              >
                <span>KIBERONE</span>
                <ExternalLink className="w-3 h-3 text-[#FFD700]" />
              </button>
              <span className="text-slate-300">|</span>
              <button
                type="button"
                onClick={() => openLocalFolder({ school: 'renderia', category: 'Knowledge_Base' })}
                className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-950 font-bold cursor-pointer text-[11px]"
              >
                <span>RENDERIA</span>
                <ExternalLink className="w-3 h-3 text-[#84CC16]" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() =>
                openLocalFolder({
                  school: activeSchool,
                  category: activeSubTab === 'brandbooks' ? 'Brandbook' : 'Knowledge_Base',
                })
              }
              className="inline-flex items-center gap-1 text-[#00A8B5] font-bold hover:underline cursor-pointer"
            >
              <span>Открыть в Проводнике</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {statusBanner && (
        <div className="glass-panel rounded-xl px-4 py-3 border border-[#00A8B5]/40 bg-[#00A8B5]/5 flex items-center justify-between gap-3 text-xs text-slate-800">
          <span>{statusBanner}</span>
          <button
            type="button"
            onClick={onDismissBanner}
            className="font-semibold text-[#00A8B5] hover:underline shrink-0 cursor-pointer"
          >
            Понятно
          </button>
        </div>
      )}

      {/* 4 Main Knowledge Base Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setActiveSubTab('categories')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              activeSubTab === 'categories'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Layers className="w-4 h-4 text-[#FFD700]" />
            <span>Разделы базы знаний</span>
            <span className="px-2 py-0.5 rounded-md bg-white/20 text-[11px] font-mono-tabular">
              {totalCategoriesBadgeText}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('visual_library')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              activeSubTab === 'visual_library'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <ImageIcon className="w-4 h-4 text-[#00A8B5]" />
            <span>Визуальная библиотека</span>
            <span className="px-2 py-0.5 rounded-md bg-white/20 text-[11px] font-mono-tabular">
              {visualLibraryItems.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('brandbooks')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              activeSubTab === 'brandbooks'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Palette className="w-4 h-4 text-[#84CC16]" />
            <span>Брендбуки и стиль</span>
            <span className="px-2 py-0.5 rounded-md bg-white/20 text-[11px] font-mono-tabular">
              {brandbookData.brandDocs.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('all_files')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              activeSubTab === 'all_files'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <FolderOpen className="w-4 h-4 text-[#165B73]" />
            <span>Все документы и медиа</span>
            <span className="px-2 py-0.5 rounded-md bg-white/20 text-[11px] font-mono-tabular">
              {eligibleSchoolDocs.length}
            </span>
          </button>
        </div>

        {/* Universal Fast Upload Button */}
        <div className="flex items-center gap-2">
          <input
            ref={universalInputRef}
            type="file"
            accept=".pdf,.docx,.pptx,.ppt,.txt,.csv,.md,.zip,.mp4,.mov,.webm,.png,.jpg,.jpeg,.webp,.svg"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUniversalFileUpload(f);
              e.target.value = '';
            }}
            className="hidden"
          />

          <input
            ref={brandbookInputRef}
            type="file"
            accept=".pdf,.docx,.pptx,.ppt,.png,.jpg,.jpeg,.webp,.svg,.txt,.zip"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUniversalFileUpload(f, 'brandbook');
              e.target.value = '';
            }}
            className="hidden"
          />

          <button
            type="button"
            disabled={Boolean(activeParseState)}
            onClick={() => universalInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-[#00A8B5] text-white hover:bg-[#00929E] transition-colors shadow-xs cursor-pointer disabled:opacity-60"
          >
            {activeParseState ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>{activeParseState.label}...</span>
              </>
            ) : (
              <>
                <FileUp className="w-4 h-4 text-white" />
                <span>Загрузить любой материал</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ====================================================================
          TAB 1: ТЕКСТОВЫЕ РАЗДЕЛЫ БАЗЫ ЗНАНИЙ
         ==================================================================== */}
      {activeSubTab === 'categories' && (
        <div className="space-y-6">
          {/* GENERAL BUSINESS INFORMATION SECTION (ALL) */}
          <div className="rounded-2xl p-5 sm:p-6 bg-gradient-to-br from-white via-sky-50/40 to-teal-50/30 border-2 border-[#00A8B5]/50 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-3 py-0.5 rounded-full bg-[#00A8B5] text-white text-[11px] font-black uppercase tracking-wider shadow-2xs">
                    Общие материалы экосистемы (ALL)
                  </span>
                  <span className="text-xs font-bold text-slate-600">
                    Доступно обеим школам: KIBERONE и RENDERIA
                  </span>
                </div>
                <h3 className="font-display font-bold text-base sm:text-lg text-slate-900">
                  Общие сведения о бизнесе, управление Анны и правила экосистемы
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed max-w-3xl">
                  Связь KIBERONE и RENDERIA, общая информация об управлении Анны, стратегия развития, совместное использование помещения, принципы кросс-маркетинга, правила перенаправления клиентов и общие регламенты. Хранится один раз и автоматически передаётся в контекст ИИ для обеих школ.
                </p>
              </div>
              <span className="text-xs text-slate-500 font-mono-tabular shrink-0">
                {isGeneralBusinessDirty
                  ? `Черновик (${generalBusinessDraft.length} симв.)`
                  : generalBusinessDraft.trim().length > 0
                    ? `${generalBusinessDraft.length} симв.`
                    : 'Пусто'}
              </span>
            </div>

            <div className="rounded-xl bg-amber-50/90 border border-amber-200/90 px-3.5 py-2 text-[11px] text-amber-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Внимание:</strong> Не вносите сюда расписания, прайс-листы и учебные модули конкретной школы — для них используются собственные разделы KIBERONE и RENDERIA ниже.
              </span>
            </div>

            <textarea
              rows={7}
              value={generalBusinessDraft}
              onChange={(e) => handleGeneralBusinessChange(e.target.value)}
              placeholder="Опишите структуру управления Анны, стратегию взаимодействия KIBERONE и RENDERIA, совместное помещение, кросс-маркетинг и правила перенаправления..."
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00A8B5] leading-relaxed resize-y shadow-2xs font-sans"
            />

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-200/80">
              <div className="text-[11px] text-slate-500">
                {isGeneralBusinessSaving ? (
                  <span className="inline-flex items-center gap-1.5 text-[#00A8B5] font-semibold">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Сохранение общих сведений в IndexedDB...
                  </span>
                ) : generalBusinessSavedFlash ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                    <Check className="w-3.5 h-3.5" />
                    Общие сведения успешно сохранены и применены для обеих школ
                  </span>
                ) : isGeneralBusinessDirty ? (
                  <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Есть несохранённые изменения в общих сведениях
                  </span>
                ) : generalBusinessDraft.trim().length > 0 ? (
                  <span className="text-slate-500">
                    Общие правила синхронизированы и доступны в ИИ-диалогах
                  </span>
                ) : (
                  <span className="text-slate-400">Сведения пока не заполнены</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {generalBusinessDraft.trim().length > 0 && (
                  <button
                    type="button"
                    disabled={isGeneralBusinessSaving}
                    onClick={handleClearGeneralBusiness}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-500 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
                  >
                    Очистить
                  </button>
                )}

                <button
                  type="button"
                  disabled={isGeneralBusinessSaving || !isGeneralBusinessDirty}
                  onClick={handleSaveGeneralBusiness}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[#00A8B5] text-white hover:bg-[#00929E] disabled:opacity-40 transition-colors shadow-xs cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Сохранить для обеих школ</span>
                </button>
              </div>
            </div>
          </div>

          {/* SCHOOL SECTIONS: KIBERONE AND/OR RENDERIA */}
          {(activeSchool === 'all' || activeSchool === 'kiberone') && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs">
                <div className="flex items-center gap-2.5">
                  <span className="px-2.5 py-1 rounded-xl text-xs font-black uppercase tracking-wider bg-[#FFD700] text-slate-950 border border-[#EAB308]">
                    KIBERONE
                  </span>
                  <h3 className="font-display font-bold text-sm sm:text-base text-slate-900">
                    Собственная база знаний KIBERONE (8 разделов)
                  </h3>
                  <span className="text-xs text-slate-500 font-mono-tabular">
                    (Заполнено: {kiberFilledCount} из 8)
                  </span>
                </div>
                <span className="text-xs text-slate-500">
                  Учебные модули, прайс, расписание и регламенты только KIBERONE
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {KNOWLEDGE_CATEGORIES.map((category) => {
                  const compositeKey: CompositeCategoryKey = `kiberone:${category.key}`;
                  const confirmedValue = knowledgeBase.kiberone[category.key] ?? '';
                  const isDirty = Boolean(dirtyByKey[compositeKey]);
                  const displayedValue = isDirty
                    ? draftFieldsBySchool.kiberone[category.key] ?? ''
                    : confirmedValue;

                  const hasUnsavedChanges = isDirty && displayedValue !== confirmedValue;
                  const isConfirmedFilled = confirmedValue.trim().length > 0;
                  const isRecentlySaved = Boolean(savedIndicatorByKey[compositeKey]);
                  const isSaving = Boolean(savingByKey[compositeKey]);
                  const categoryDocsCount = uploadedDocuments.filter(
                    (d) => d.schoolId === 'kiberone' && d.categoryKey === category.key
                  ).length;

                  return (
                    <div
                      key={compositeKey}
                      className={`rounded-2xl p-5 flex flex-col justify-between gap-3 bg-white border transition-all shadow-2xs ${
                        hasUnsavedChanges
                          ? 'border-amber-300 ring-1 ring-amber-200'
                          : isConfirmedFilled
                            ? 'border-[#FFD700]/70'
                            : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-display font-bold text-sm sm:text-base text-slate-900 truncate">
                              {category.title}
                            </h4>
                            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-[#FFD700] text-slate-950">
                              KIBERONE
                            </span>
                            {categoryDocsCount > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-mono-tabular font-semibold">
                                Файлов: {categoryDocsCount}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 leading-snug">
                            {category.subtitle}
                          </p>
                        </div>
                        <span className="text-[11px] text-slate-500 font-mono-tabular shrink-0">
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
                          handleDraftChange('kiberone', category.key, e.target.value)
                        }
                        placeholder={category.placeholder}
                        className="w-full rounded-xl border border-slate-200/90 bg-white/95 px-3.5 py-2.5 text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00A8B5] leading-relaxed resize-y"
                      />

                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                        <div className="text-[11px] text-slate-500">
                          {isSaving ? (
                            <span className="inline-flex items-center gap-1.5 text-[#00A8B5] font-semibold">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Запись в IndexedDB...
                            </span>
                          ) : isRecentlySaved ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <Check className="w-3.5 h-3.5" />
                              Сохранено для KIBERONE
                            </span>
                          ) : hasUnsavedChanges ? (
                            <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              Несохранённые изменения
                            </span>
                          ) : isConfirmedFilled ? (
                            <span className="text-slate-400">Синхронизировано</span>
                          ) : (
                            <span className="text-slate-400">Раздел пока не заполнен</span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {displayedValue.trim().length > 0 && (
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => handleClearCategoryField('kiberone', category.key)}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
                            >
                              Очистить
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={isSaving || !hasUnsavedChanges}
                            onClick={() => handleConfirmCategoryField('kiberone', category.key)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 transition-colors shadow-2xs cursor-pointer"
                          >
                            <Save className="w-3.5 h-3.5 text-[#FFD700]" />
                            <span>Сохранить</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(activeSchool === 'all' || activeSchool === 'renderia') && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs">
                <div className="flex items-center gap-2.5">
                  <span className="px-2.5 py-1 rounded-xl text-xs font-black uppercase tracking-wider bg-[#84CC16] text-slate-950 border border-[#65A30D]">
                    RENDERIA
                  </span>
                  <h3 className="font-display font-bold text-sm sm:text-base text-slate-900">
                    Собственная база знаний RENDERIA (8 разделов)
                  </h3>
                  <span className="text-xs text-slate-500 font-mono-tabular">
                    (Заполнено: {renderiaFilledCount} из 8)
                  </span>
                </div>
                <span className="text-xs text-slate-500">
                  Учебные модули, прайс, расписание и регламенты только RENDERIA
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {KNOWLEDGE_CATEGORIES.map((category) => {
                  const compositeKey: CompositeCategoryKey = `renderia:${category.key}`;
                  const confirmedValue = knowledgeBase.renderia[category.key] ?? '';
                  const isDirty = Boolean(dirtyByKey[compositeKey]);
                  const displayedValue = isDirty
                    ? draftFieldsBySchool.renderia[category.key] ?? ''
                    : confirmedValue;

                  const hasUnsavedChanges = isDirty && displayedValue !== confirmedValue;
                  const isConfirmedFilled = confirmedValue.trim().length > 0;
                  const isRecentlySaved = Boolean(savedIndicatorByKey[compositeKey]);
                  const isSaving = Boolean(savingByKey[compositeKey]);
                  const categoryDocsCount = uploadedDocuments.filter(
                    (d) => d.schoolId === 'renderia' && d.categoryKey === category.key
                  ).length;

                  return (
                    <div
                      key={compositeKey}
                      className={`rounded-2xl p-5 flex flex-col justify-between gap-3 bg-white border transition-all shadow-2xs ${
                        hasUnsavedChanges
                          ? 'border-amber-300 ring-1 ring-amber-200'
                          : isConfirmedFilled
                            ? 'border-[#84CC16]/70'
                            : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-display font-bold text-sm sm:text-base text-slate-900 truncate">
                              {category.title}
                            </h4>
                            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-[#84CC16] text-slate-950">
                              RENDERIA
                            </span>
                            {categoryDocsCount > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-mono-tabular font-semibold">
                                Файлов: {categoryDocsCount}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 leading-snug">
                            {category.subtitle}
                          </p>
                        </div>
                        <span className="text-[11px] text-slate-500 font-mono-tabular shrink-0">
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
                          handleDraftChange('renderia', category.key, e.target.value)
                        }
                        placeholder={category.placeholder}
                        className="w-full rounded-xl border border-slate-200/90 bg-white/95 px-3.5 py-2.5 text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00A8B5] leading-relaxed resize-y"
                      />

                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                        <div className="text-[11px] text-slate-500">
                          {isSaving ? (
                            <span className="inline-flex items-center gap-1.5 text-[#00A8B5] font-semibold">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Запись в IndexedDB...
                            </span>
                          ) : isRecentlySaved ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <Check className="w-3.5 h-3.5" />
                              Сохранено для RENDERIA
                            </span>
                          ) : hasUnsavedChanges ? (
                            <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              Несохранённые изменения
                            </span>
                          ) : isConfirmedFilled ? (
                            <span className="text-slate-400">Синхронизировано</span>
                          ) : (
                            <span className="text-slate-400">Раздел пока не заполнен</span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {displayedValue.trim().length > 0 && (
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => handleClearCategoryField('renderia', category.key)}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
                            >
                              Очистить
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={isSaving || !hasUnsavedChanges}
                            onClick={() => handleConfirmCategoryField('renderia', category.key)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 transition-colors shadow-2xs cursor-pointer"
                          >
                            <Save className="w-3.5 h-3.5 text-[#84CC16]" />
                            <span>Сохранить</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ====================================================================
          TAB 2: ВИЗУАЛЬНАЯ БИБЛИОТЕКА (ИЗОБРАЖЕНИЯ, ЛОГОТИПЫ, РЕФЕРЕНСЫ)
         ==================================================================== */}
      {activeSubTab === 'visual_library' && (
        <div className="space-y-6">
          {/* Controls & Filter Bar */}
          <div className="glass-panel rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 border border-slate-200">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Search */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск по названию или тегам..."
                  className="pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00A8B5] w-52 sm:w-64"
                />
              </div>

              {/* Visual Role Filter */}
              <div className="flex items-center gap-1 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setVisualRoleFilter('all')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                    visualRoleFilter === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Все ({visualLibraryItems.length})
                </button>
                {(['logo', 'brandbook', 'reference', 'template', 'palette'] as VisualAssetRole[]).map(
                  (role) => {
                    const cfg = VISUAL_ROLE_LABELS_RU[role];
                    const isSelected = visualRoleFilter === role;
                    return (
                      <button
                        key={role}
                        type="button"
                        onClick={() => setVisualRoleFilter(role)}
                        className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {cfg.label}
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            {/* School Scope Filter & Add Button */}
            <div className="flex items-center gap-2 flex-wrap">
              {activeSchool === 'all' ? (
                <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-xl border border-slate-200">
                  {(
                    [
                      { id: 'all', label: 'Все области' },
                      { id: 'common', label: 'Общие (ALL)' },
                      { id: 'kiberone', label: 'KIBERONE' },
                      { id: 'renderia', label: 'RENDERIA' },
                    ] as const
                  ).map((f) => {
                    const isSelected = visualScopeFilter === f.id;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setVisualScopeFilter(f.id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200/80">
                  Область: {activeSchool === 'kiberone' ? 'KIBERONE + Общие (ALL)' : 'RENDERIA + Общие (ALL)'}
                </span>
              )}

              <input
                ref={imageInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.svg,.gif,.pdf,.pptx,.docx,image/*,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUniversalFileUpload(f, 'reference');
                  e.target.value = '';
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#FFD700]" />
                <span>Добавить материал</span>
              </button>
            </div>
          </div>

          {/* Grid of Visual Assets */}
          {visualLibraryItems.length === 0 ? (
            <div className="glass-panel rounded-2xl p-10 text-center space-y-3 border border-dashed border-slate-300">
              <div className="w-12 h-12 rounded-2xl bg-[#00A8B5]/10 text-[#00A8B5] flex items-center justify-center mx-auto">
                <ImageIcon className="w-6 h-6" />
              </div>
              <h3 className="font-display font-bold text-base text-slate-900">
                В визуальной библиотеке пока нет материалов
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                Загрузите презентации (PPTX), PDF-методички, логотипы, страницы брендбуков или референсы оформления.
                Из PDF и PPTX автоматически извлекаются слайды, текст и визуальные материалы для передачи ИИ-специалистам!
              </p>
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-[#00A8B5] text-white hover:bg-[#00929E] transition-colors cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>Загрузите материалы: презентации, PDF-документы или изображения</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {visualLibraryItems.map((doc) => {
                const roleMeta =
                  VISUAL_ROLE_LABELS_RU[doc.visualRole || 'other'] ||
                  VISUAL_ROLE_LABELS_RU.other;

                return (
                  <div
                    key={doc.id}
                    className="glass-panel rounded-2xl overflow-hidden border border-slate-200/90 hover:border-slate-300 transition-all flex flex-col justify-between shadow-2xs group"
                  >
                    {/* Thumbnail Preview Area */}
                    <div
                      onClick={() => {
                        if (doc.slides && doc.slides.length > 0) {
                          setSelectedSlideIndex(0);
                          setPptxSlidesDoc(doc);
                        } else {
                          setFullSizeImageDoc(doc);
                        }
                      }}
                      className="relative h-44 bg-slate-950 flex items-center justify-center cursor-pointer overflow-hidden"
                    >
                      {doc.dataUrl || doc.thumbnailUrl || doc.extractedImages?.[0]?.dataUrl ? (
                        <img
                          src={doc.thumbnailUrl || doc.dataUrl || doc.extractedImages?.[0]?.dataUrl}
                          alt={doc.name}
                          className="max-h-full max-w-full object-contain transition-transform duration-300 group-hover:scale-105"
                          loading="lazy"
                        />
                      ) : doc.fileType === 'presentation' || doc.extension.toLowerCase() === 'pptx' ? (
                        <div className="flex flex-col items-center gap-1 text-[#00A8B5] p-2">
                          <Presentation className="w-10 h-10" />
                          <span className="text-[10px] font-extrabold uppercase tracking-wider">
                            {doc.slides?.length ? `${doc.slides.length} слайдов` : 'Презентация'}
                          </span>
                        </div>
                      ) : doc.extension.toLowerCase() === 'pdf' ? (
                        <div className="flex flex-col items-center gap-1 text-rose-400 p-2">
                          <FileText className="w-10 h-10" />
                          <span className="text-[10px] font-extrabold uppercase tracking-wider">
                            {doc.pageCount ? `${doc.pageCount} стр.` : 'PDF Документ'}
                          </span>
                        </div>
                      ) : (
                        <ImageIcon className="w-10 h-10 text-slate-700" />
                      )}

                      {/* Top Badges */}
                      <div className="absolute top-2 left-2 right-2 flex items-center justify-between gap-1">
                        <span
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wide border shadow-xs ${
                            doc.schoolId === 'all'
                              ? 'bg-[#00A8B5] text-white border-transparent'
                              : doc.schoolId === 'renderia'
                                ? 'bg-[#84CC16] text-slate-950 border-transparent'
                                : 'bg-[#FFD700] text-slate-950 border-transparent'
                          }`}
                        >
                          {doc.schoolId === 'all'
                            ? 'Общий (ALL)'
                            : doc.schoolId === 'renderia'
                              ? 'RENDERIA'
                              : 'KIBERONE'}
                        </span>

                        <span
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border shadow-xs ${roleMeta.badgeClass}`}
                        >
                          {roleMeta.label}
                        </span>
                      </div>

                      {/* Hover Overlay */}
                      <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <span className="px-3 py-1.5 rounded-xl bg-white/95 text-slate-900 text-xs font-bold shadow-md flex items-center gap-1.5">
                          <Eye className="w-3.5 h-3.5" />
                          <span>Просмотр</span>
                        </span>
                      </div>
                    </div>

                    {/* Metadata & Tag Footer */}
                    <div className="p-3.5 space-y-2.5 flex-1 flex flex-col justify-between">
                      <div className="space-y-1">
                        <h4
                          className="font-display font-bold text-xs text-slate-900 truncate"
                          title={doc.name}
                        >
                          {doc.name}
                        </h4>
                        {doc.description && (
                          <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                            {doc.description}
                          </p>
                        )}
                      </div>

                      {/* Tags */}
                      {doc.tags && doc.tags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          {doc.tags.slice(0, 3).map((t) => (
                            <span
                              key={t}
                              className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium"
                            >
                              #{t}
                            </span>
                          ))}
                          {doc.tags.length > 3 && (
                            <span className="text-[10px] text-slate-400">
                              +{doc.tags.length - 3}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Footer Actions */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-mono-tabular">
                        <span>{formatFileSizeRu(doc.sizeBytes)}</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setFullSizeImageDoc(doc)}
                            className="p-1 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                            title="Открыть в полном размере и редактировать теги"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDocPendingDelete(doc)}
                            className="p-1 rounded-md text-red-600 hover:bg-red-50 cursor-pointer"
                            title="Удалить из библиотеки"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ====================================================================
          TAB 3: БРЕНДБУКИ И СТИЛЬ (ПАЛИТРА, ПРАВИЛА, ЛОГОТИПЫ)
         ==================================================================== */}
      {activeSubTab === 'brandbooks' && (
        <div className="space-y-6">
          {/* Corporate Color Palette Section */}
          <div className="glass-panel rounded-2xl p-5 border border-slate-200/90 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display font-bold text-base text-slate-900 flex items-center gap-2">
                  <Palette className="w-4 h-4 text-[#00A8B5]" />
                  <span>
                    Фирменные цвета и палитра:{' '}
                    {activeSchool === 'all'
                      ? 'Экосистема (KIBERONE + RENDERIA)'
                      : activeSchool === 'kiberone'
                        ? 'KIBERONE'
                        : 'RENDERIA'}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Нажмите на образец цвета для копирования HEX. Наведите для удаления цвета из палитры.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {copiedHex && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-emerald-100 text-emerald-800 text-xs font-bold shadow-xs">
                    <Check className="w-3.5 h-3.5" />
                    <span>Скопировано: {copiedHex}</span>
                  </span>
                )}
                {((paletteOverrides[activeSchool]?.added?.length || 0) > 0 ||
                  (paletteOverrides[activeSchool]?.removed?.length || 0) > 0) && (
                  <button
                    type="button"
                    onClick={handleResetPalette}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer"
                    title="Сбросить палитру к стандартным цветам"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Сбросить</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowAddColorModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#00A8B5] text-white hover:bg-[#00929E] transition-colors shadow-2xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Добавить цвет</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {brandbookData.palette.map((color, idx) => (
                <div
                  key={`${color.hex}-${idx}`}
                  onClick={() => handleCopyHex(color.hex)}
                  className="rounded-xl p-3 bg-white border border-slate-200 hover:border-slate-300 hover:shadow-xs transition-all cursor-pointer space-y-2 group relative"
                >
                  <div
                    className="w-full h-14 rounded-lg border border-black/10 flex items-end justify-between p-1.5 shadow-2xs relative"
                    style={{ backgroundColor: color.hex }}
                  >
                    <button
                      type="button"
                      onClick={(e) => handleDeleteCustomColor(color.hex, e)}
                      className="absolute top-1 right-1 p-1 rounded-md bg-black/60 text-white/90 hover:bg-red-600 hover:text-white transition-all opacity-0 group-hover:opacity-100 shadow-xs cursor-pointer z-10"
                      title={`Удалить ${color.hex} из палитры`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <div />
                    <Copy className="w-3.5 h-3.5 text-white/80 opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-sm" />
                  </div>
                  <div className="space-y-0.5">
                    <div className="font-mono text-xs font-bold text-slate-900">
                      {color.hex}
                    </div>
                    {color.label && (
                      <div className="text-[10px] text-slate-500 truncate" title={color.label}>
                        {color.label}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Official Brandbook Documents & Guidelines */}
          <div className="glass-panel rounded-2xl p-5 border border-slate-200/90 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display font-bold text-base text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#84CC16]" />
                  <span>Материалы брендбука и правила стиля</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Официальные брендбуки в PDF, презентации со слайдами и правила оформления, используемые специалистами.
                </p>
              </div>

              <button
                type="button"
                onClick={() => brandbookInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#FFD700]" />
                <span>Добавить материал брендбука</span>
              </button>
            </div>

            {brandbookData.brandDocs.length === 0 ? (
              <div className="p-6 rounded-xl bg-slate-50/70 border border-dashed border-slate-200 text-center text-xs text-slate-500 space-y-2">
                <p>
                  Для выбранной области{' '}
                  <strong>
                    {activeSchool === 'all'
                      ? '«Все материалы»'
                      : activeSchool === 'kiberone'
                        ? '«KIBERONE»'
                        : '«RENDERIA»'}
                  </strong>{' '}
                  пока не загружены отдельные брендбук-материалы.
                </p>
                <p className="text-[11px] text-slate-400">
                  Вы можете загрузить PDF-гайдлайн, презентацию PPTX или логотип и назначить роль «Брендбук» или «Логотип».
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {brandbookData.brandDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="p-4 rounded-xl bg-white border border-slate-200/90 flex flex-col justify-between gap-3 shadow-2xs"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {doc.dataUrl ? (
                            <img
                              src={doc.dataUrl}
                              alt={doc.name}
                              className="w-8 h-8 rounded-lg object-contain bg-slate-950 p-1 shrink-0"
                            />
                          ) : (
                            <FileText className="w-5 h-5 text-[#84CC16] shrink-0" />
                          )}
                          <span
                            className="font-semibold text-xs text-slate-900 truncate"
                            title={doc.name}
                          >
                            {doc.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase ${
                              doc.schoolId === 'all'
                                ? 'bg-[#00A8B5] text-white'
                                : doc.schoolId === 'renderia'
                                  ? 'bg-[#84CC16] text-slate-950'
                                  : 'bg-[#FFD700] text-slate-950'
                            }`}
                          >
                            {doc.schoolId === 'all' ? 'ALL' : doc.schoolId.toUpperCase()}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-bold uppercase">
                            {doc.visualRole || 'Бренд'}
                          </span>
                        </div>
                      </div>

                      {doc.description && (
                        <p className="text-[11px] text-slate-600 line-clamp-2">
                          {doc.description}
                        </p>
                      )}

                      {doc.extractedText && (
                        <div className="p-2.5 rounded-lg bg-slate-50 text-[11px] text-slate-700 font-mono line-clamp-3 leading-relaxed">
                          {doc.extractedText}
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-mono-tabular">
                      <span>{formatFileSizeRu(doc.sizeBytes)}</span>
                      <div className="flex items-center gap-1.5">
                        {doc.dataUrl && (
                          <button
                            type="button"
                            onClick={() => setFullSizeImageDoc(doc)}
                            className="px-2 py-1 rounded-md text-slate-700 hover:bg-slate-100 font-semibold cursor-pointer"
                          >
                            Визуал
                          </button>
                        )}
                        {doc.extractedText && (
                          <button
                            type="button"
                            onClick={() => setInspectedDoc(doc)}
                            className="px-2 py-1 rounded-md text-slate-700 hover:bg-slate-100 font-semibold cursor-pointer"
                          >
                            Текст правил
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====================================================================
          TAB 4: ВСЕ ДОКУМЕНТЫ И МЕДИАФАЙЛЫ (РЕПОЗИТОРИЙ)
         ==================================================================== */}
      {activeSubTab === 'all_files' && (
        <div className="space-y-6">
          {/* Filters Bar */}
          <div className="glass-panel rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 border border-slate-200">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск по названию или тегам..."
                  className="pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00A8B5] w-52 sm:w-64"
                />
              </div>

              {/* Type filter */}
              <div className="flex items-center gap-1 overflow-x-auto">
                {(
                  [
                    { id: 'all', label: 'Все' },
                    { id: 'document', label: 'Документы (PDF/DOCX/TXT)' },
                    { id: 'presentation', label: 'Презентации (PPTX)' },
                    { id: 'image', label: 'Изображения' },
                    { id: 'video', label: 'Видео' },
                    { id: 'archive', label: 'Архивы (ZIP)' },
                  ] as const
                ).map((t) => {
                  const isSelected = fileTypeFilter === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setFileTypeFilter(t.id as any)}
                      className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${
                        isSelected
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Scope Filter for All Files */}
            <div className="flex items-center gap-2 flex-wrap">
              {activeSchool === 'all' ? (
                <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-xl border border-slate-200">
                  {(
                    [
                      { id: 'all', label: 'Все области' },
                      { id: 'common', label: 'Общие (ALL)' },
                      { id: 'kiberone', label: 'KIBERONE' },
                      { id: 'renderia', label: 'RENDERIA' },
                    ] as const
                  ).map((f) => {
                    const isSelected = filesScopeFilter === f.id;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFilesScopeFilter(f.id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200/80">
                  Область: {activeSchool === 'kiberone' ? 'KIBERONE + Общие (ALL)' : 'RENDERIA + Общие (ALL)'}
                </span>
              )}
            </div>
          </div>

          {/* Files Grid / List */}
          {filteredAllFiles.length === 0 ? (
            <div className="glass-panel rounded-2xl p-10 text-center space-y-3 border border-dashed border-slate-300">
              <FolderOpen className="w-10 h-10 text-slate-400 mx-auto" />
              <div className="text-sm font-semibold text-slate-800">
                Документов по заданным фильтрам не найдено
              </div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Загрузите любой учебный план, прайс, брендбук, видео или архив кнопкой «Загрузить любой материал» вверху.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {filteredAllFiles.map((doc) => {
                const catMeta = KNOWLEDGE_CATEGORIES.find(
                  (c) => c.key === doc.categoryKey
                );
                const isPptx = doc.extension === 'pptx';
                const isVideo = doc.fileType === 'video' || ['mp4', 'mov', 'webm'].includes(doc.extension);
                const isImage = doc.fileType === 'image' || Boolean(doc.dataUrl);

                return (
                  <div
                    key={doc.id}
                    className="rounded-2xl p-4 bg-white border border-slate-200/90 flex flex-col justify-between gap-3 shadow-2xs hover:border-slate-300 transition-all"
                  >
                    <div className="space-y-2.5">
                      {/* Header with Type Icon, Name & Scope */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-center shrink-0">
                            {isVideo ? (
                              <Film className="w-4 h-4 text-rose-600" />
                            ) : isImage ? (
                              <ImageIcon className="w-4 h-4 text-[#00A8B5]" />
                            ) : isPptx ? (
                              <Presentation className="w-4 h-4 text-amber-600" />
                            ) : doc.extension === 'zip' ? (
                              <Archive className="w-4 h-4 text-purple-600" />
                            ) : doc.extension === 'csv' ? (
                              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                            ) : (
                              <FileText className="w-4 h-4 text-slate-700" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <h4
                              className="font-semibold text-xs text-slate-900 truncate"
                              title={doc.name}
                            >
                              {doc.name}
                            </h4>
                            <span className="text-[10px] text-slate-400 font-mono-tabular uppercase">
                              .{doc.extension} · {formatFileSizeRu(doc.sizeBytes)}
                            </span>
                          </div>
                        </div>

                        {/* School Scope Badge */}
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase shrink-0 ${
                            doc.schoolId === 'all'
                              ? 'bg-[#00A8B5] text-white'
                              : doc.schoolId === 'renderia'
                                ? 'bg-[#84CC16] text-slate-950'
                                : 'bg-[#FFD700] text-slate-950'
                          }`}
                        >
                          {doc.schoolId === 'all'
                            ? 'Общий (ALL)'
                            : doc.schoolId === 'renderia'
                              ? 'RENDERIA'
                              : 'KIBERONE'}
                        </span>
                      </div>

                      {/* Status & Category */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {renderStatusBadge(doc.status)}
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-medium truncate">
                          {catMeta?.title || doc.categoryKey}
                        </span>
                        {doc.visualRole && (
                          <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 text-[10px] font-bold">
                            {VISUAL_ROLE_LABELS_RU[doc.visualRole]?.label || doc.visualRole}
                          </span>
                        )}
                      </div>

                      {/* Video / Image thumbnail preview */}
                      {doc.thumbnailUrl && (
                        <div
                          onClick={() => {
                            if (isVideo) setVideoPlayerDoc(doc);
                            else if (isImage) setFullSizeImageDoc(doc);
                          }}
                          className="h-28 w-full rounded-xl bg-slate-950 flex items-center justify-center overflow-hidden cursor-pointer relative group"
                        >
                          <img
                            src={doc.thumbnailUrl}
                            alt={doc.name}
                            className="max-h-full max-w-full object-contain"
                          />
                          {isVideo && (
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                              <div className="w-8 h-8 rounded-full bg-white/90 text-slate-900 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                                <Play className="w-4 h-4 fill-current ml-0.5" />
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Warnings if any */}
                      {doc.warning && (
                        <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200/80 rounded-lg px-2.5 py-1.5 leading-snug">
                          {doc.warning}
                        </div>
                      )}

                      {/* Tags */}
                      {doc.tags && doc.tags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          {doc.tags.map((t) => (
                            <span
                              key={t}
                              className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium"
                            >
                              #{t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-slate-400 font-mono-tabular">
                        {doc.createdAt}
                      </span>

                      <div className="flex items-center gap-1">
                        {isPptx && doc.slides && doc.slides.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setPptxSlidesDoc(doc);
                              setSelectedSlideIndex(0);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold bg-amber-50 text-amber-900 hover:bg-amber-100 cursor-pointer"
                          >
                            <Presentation className="w-3.5 h-3.5" />
                            <span>Слайды ({doc.slides.length})</span>
                          </button>
                        )}

                        {isVideo && (
                          <button
                            type="button"
                            onClick={() => setVideoPlayerDoc(doc)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold bg-rose-50 text-rose-900 hover:bg-rose-100 cursor-pointer"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            <span>Видео</span>
                          </button>
                        )}

                        {isImage && (
                          <button
                            type="button"
                            onClick={() => setFullSizeImageDoc(doc)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Просмотр</span>
                          </button>
                        )}

                        {doc.extractedText && !isImage && (
                          <button
                            type="button"
                            onClick={() => setInspectedDoc(doc)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Текст</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setDocPendingDelete(doc)}
                          className="p-1 rounded-lg font-medium text-red-600 hover:bg-red-50 cursor-pointer"
                          title="Удалить карточку"
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
      )}

      {/* ====================================================================
          MODAL 1: STAGED DOCUMENT CONFIRMATION (ANY FORMAT)
         ==================================================================== */}
      {stagedDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
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
                      stagedDoc.schoolId === 'all'
                        ? 'bg-[#00A8B5] text-white'
                        : stagedDoc.schoolId === 'kiberone'
                          ? 'bg-[#FFD700] text-slate-950'
                          : 'bg-[#84CC16] text-slate-950'
                    }`}
                  >
                    Область применения:{' '}
                    {stagedDoc.schoolId === 'all'
                      ? 'Обеим школам (Общие материалы — ALL)'
                      : stagedDoc.schoolId === 'kiberone'
                        ? 'Только KIBERONE'
                        : 'Только RENDERIA'}
                  </span>
                  {renderStatusBadge(stagedDoc.parsed.status)}
                </div>
                <h3 className="font-display font-bold text-lg text-slate-900">
                  Добавление материала в Базу знаний
                </h3>
              </div>
              <button
                type="button"
                disabled={isCommittingStagedDoc}
                onClick={() => setStagedDoc(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Preview if image or video */}
            {stagedDoc.parsed.dataUrl && stagedDoc.parsed.fileType === 'image' && (
              <div className="h-56 bg-slate-950 rounded-xl flex items-center justify-center p-2 overflow-hidden border border-slate-200">
                <img
                  src={stagedDoc.parsed.dataUrl}
                  alt={stagedDoc.parsed.name}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            )}

            {/* Metadata Fields */}
            <div className="rounded-xl p-3.5 bg-slate-50 border border-slate-200/80 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-slate-400 block">Файл</span>
                <span className="font-semibold text-slate-900 break-all">
                  {stagedDoc.parsed.name}
                </span>
                <span className="font-mono-tabular text-slate-500 block text-[10px] uppercase">
                  .{stagedDoc.parsed.extension} · {formatFileSizeRu(stagedDoc.parsed.sizeBytes)}
                </span>
              </div>

              <div>
                <label className="text-slate-600 font-bold block mb-0.5">
                  Область применения:
                </label>
                <select
                  value={stagedDoc.schoolId}
                  onChange={(e) =>
                    setStagedDoc((prev) =>
                      prev
                        ? { ...prev, schoolId: e.target.value as DocumentSchoolScope }
                        : null
                    )
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-900"
                >
                  <option value="all">Обеим школам (Общие материалы — ALL)</option>
                  <option value="kiberone">Только KIBERONE</option>
                  <option value="renderia">Только RENDERIA</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-0.5">
                  Категория Базы знаний
                </label>
                <select
                  value={stagedDoc.categoryKey}
                  onChange={(e) =>
                    setStagedDoc((prev) =>
                      prev
                        ? { ...prev, categoryKey: e.target.value as KnowledgeCategoryKey }
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

            {/* Visual Role & Tags if Image/Brandbook */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Назначение материала (Visual Role)
                </label>
                <select
                  value={stagedDoc.visualRole || 'other'}
                  onChange={(e) =>
                    setStagedDoc((prev) =>
                      prev ? { ...prev, visualRole: e.target.value as VisualAssetRole } : null
                    )
                  }
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900"
                >
                  <option value="logo">Логотип школы</option>
                  <option value="brandbook">Брендбук / Руководство по стилю</option>
                  <option value="reference">Референс оформления / Визуал</option>
                  <option value="template">Шаблон макета</option>
                  <option value="palette">Цветовая палитра</option>
                  <option value="other">Обычный материал / документ</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Теги (через запятую)
                </label>
                <input
                  type="text"
                  value={stagedDoc.tags.join(', ')}
                  onChange={(e) => {
                    const parsedTags = e.target.value
                      .split(',')
                      .map((t) => t.trim().replace(/^#/, ''))
                      .filter(Boolean);
                    setStagedDoc((prev) => (prev ? { ...prev, tags: parsedTags } : null));
                  }}
                  placeholder="логотип, вконтакте, шапка, баннер"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                />
              </div>
            </div>

            {/* Extracted Text (editable) */}
            {stagedDoc.parsed.fileType !== 'image' && stagedDoc.parsed.fileType !== 'video' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">
                    Извлечённый текст (будет доступен ИИ):
                  </span>
                  <span className="font-mono-tabular text-slate-500">
                    {stagedDoc.editableText.length} симв.
                  </span>
                </div>
                <textarea
                  rows={6}
                  value={stagedDoc.editableText}
                  onChange={(e) =>
                    setStagedDoc((prev) =>
                      prev ? { ...prev, editableText: e.target.value } : null
                    )
                  }
                  className="w-full rounded-xl border border-slate-300 bg-white p-3 text-xs font-mono text-slate-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#00A8B5] resize-y"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={isCommittingStagedDoc}
                onClick={() => setStagedDoc(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={isCommittingStagedDoc || stagedDoc.parsed.status === 'error'}
                onClick={handleCommitStagedDocument}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 transition-colors shadow-xs cursor-pointer"
              >
                <Check className="w-4 h-4 text-[#00A8B5]" />
                <span>
                  {isCommittingStagedDoc
                    ? 'Сохранение в IndexedDB...'
                    : 'Подтвердить и сохранить в Базу знаний'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL 2: FULL-SIZE VISUAL VIEWER & METADATA EDITOR
         ==================================================================== */}
      {fullSizeImageDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
          onClick={() => setFullSizeImageDoc(null)}
        >
          <div
            className="w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white border border-slate-200 shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-bold ${
                      fullSizeImageDoc.schoolId === 'all'
                        ? 'bg-[#00A8B5] text-white'
                        : fullSizeImageDoc.schoolId === 'renderia'
                          ? 'bg-[#84CC16] text-slate-950'
                          : 'bg-[#FFD700] text-slate-950'
                    }`}
                  >
                    {getSchoolNameRu(fullSizeImageDoc.schoolId)}
                  </span>
                  <span className="px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-800">
                    {VISUAL_ROLE_LABELS_RU[fullSizeImageDoc.visualRole || 'other']?.label || 'Материал'}
                  </span>
                </div>
                <h3 className="font-display font-bold text-lg text-slate-900 break-all">
                  {fullSizeImageDoc.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setFullSizeImageDoc(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Large Image Container */}
            {/* Large Image / Document Container */}
            <div className="w-full min-h-[280px] max-h-[500px] bg-slate-950 rounded-2xl flex flex-col items-center justify-center p-3 overflow-hidden border border-slate-300">
              {fullSizeImageDoc.dataUrl || fullSizeImageDoc.thumbnailUrl || fullSizeImageDoc.extractedImages?.[0]?.dataUrl ? (
                <img
                  src={fullSizeImageDoc.dataUrl || fullSizeImageDoc.thumbnailUrl || fullSizeImageDoc.extractedImages?.[0]?.dataUrl}
                  alt={fullSizeImageDoc.name}
                  className="max-h-[480px] max-w-full object-contain"
                />
              ) : (
                <div className="text-center p-6 space-y-3 text-slate-300 max-w-lg">
                  <FileText className="w-12 h-12 mx-auto text-[#00A8B5]" />
                  <div className="text-sm font-bold text-white">{fullSizeImageDoc.name}</div>
                  {fullSizeImageDoc.extractedText ? (
                    <div className="text-xs text-slate-400 max-h-40 overflow-y-auto p-3 bg-slate-900 rounded-xl border border-slate-800 text-left font-mono leading-relaxed">
                      {fullSizeImageDoc.extractedText.slice(0, 800)}...
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">Предпросмотр визуального содержимого недоступен</div>
                  )}
                </div>
              )}
            </div>

            {/* Editable Tags & Visual Role */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs">
              <div>
                <label className="text-slate-500 font-semibold block mb-1">
                  Назначение
                </label>
                <select
                  value={fullSizeImageDoc.visualRole || 'other'}
                  onChange={(e) =>
                    handleUpdateDocMetadata(fullSizeImageDoc, {
                      visualRole: e.target.value as VisualAssetRole,
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-slate-900"
                >
                  <option value="logo">Логотип школы</option>
                  <option value="brandbook">Брендбук / Гайдлайн</option>
                  <option value="reference">Референс оформления</option>
                  <option value="template">Шаблон</option>
                  <option value="palette">Палитра</option>
                  <option value="other">Материал</option>
                </select>
              </div>

              <div>
                <label className="text-slate-500 font-semibold block mb-1">
                  Школа (привязка)
                </label>
                <select
                  value={fullSizeImageDoc.schoolId}
                  onChange={(e) =>
                    handleUpdateDocMetadata(fullSizeImageDoc, {
                      schoolId: e.target.value as DocumentSchoolScope,
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-slate-900"
                >
                  <option value="kiberone">Только KIBERONE</option>
                  <option value="renderia">Только RENDERIA</option>
                  <option value="all">Обе школы (ALL)</option>
                </select>
              </div>

              <div>
                <label className="text-slate-500 font-semibold block mb-1">
                  Добавить тег
                </label>
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && tagInput.trim()) {
                        e.preventDefault();
                        const currentTags = fullSizeImageDoc.tags || [];
                        const next = Array.from(new Set([...currentTags, tagInput.trim()]));
                        handleUpdateDocMetadata(fullSizeImageDoc, { tags: next });
                        setTagInput('');
                      }
                    }}
                    placeholder="лого, шапка..."
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (tagInput.trim()) {
                        const currentTags = fullSizeImageDoc.tags || [];
                        const next = Array.from(new Set([...currentTags, tagInput.trim()]));
                        handleUpdateDocMetadata(fullSizeImageDoc, { tags: next });
                        setTagInput('');
                      }
                    }}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 text-white font-semibold cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Current Tags Chips */}
            {fullSizeImageDoc.tags && fullSizeImageDoc.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-slate-500 font-semibold">Теги:</span>
                {fullSizeImageDoc.tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 font-medium"
                  >
                    <span>#{t}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = (fullSizeImageDoc.tags || []).filter((x) => x !== t);
                        handleUpdateDocMetadata(fullSizeImageDoc, { tags: next });
                      }}
                      className="text-slate-400 hover:text-red-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
              <button
                type="button"
                onClick={() => {
                  const target = fullSizeImageDoc;
                  setFullSizeImageDoc(null);
                  setDocPendingDelete(target);
                }}
                className="text-red-600 hover:underline font-semibold cursor-pointer"
              >
                Удалить из библиотеки
              </button>

              <button
                type="button"
                onClick={() => setFullSizeImageDoc(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold cursor-pointer"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL 3: VIDEO PLAYER & SNAPSHOT FRAME CAPTURER
         ==================================================================== */}
      {videoPlayerDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm"
          onClick={() => setVideoPlayerDoc(null)}
        >
          <div
            className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white border border-slate-200 shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display font-bold text-base text-slate-900">
                  {videoPlayerDoc.name}
                </h3>
                <span className="text-xs text-slate-500 font-mono-tabular">
                  {formatFileSizeRu(videoPlayerDoc.sizeBytes)} · Формат .
                  {videoPlayerDoc.extension.toUpperCase()}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setVideoPlayerDoc(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Video HTML5 Player */}
            <div className="w-full bg-slate-950 rounded-2xl overflow-hidden flex items-center justify-center">
              {videoPlayerDoc.dataUrl ? (
                <video
                  ref={videoPlayerRef}
                  controls
                  playsInline
                  src={videoPlayerDoc.dataUrl}
                  className="max-h-[460px] w-full"
                />
              ) : (
                <div className="p-8 text-center text-slate-400 text-xs">
                  Большие видеозаписи хранятся локально в IndexedDB без base64-дублирования.
                </div>
              )}
            </div>

            {/* Video Action Controls */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
              <button
                type="button"
                onClick={handleCaptureVideoFrameToVisualLibrary}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#00A8B5] text-white font-bold hover:bg-[#00929E] cursor-pointer shadow-xs"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>Захватить кадр в Визуальную библиотеку</span>
              </button>

              <button
                type="button"
                onClick={() => setVideoPlayerDoc(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold cursor-pointer"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL 4: PPTX SLIDE EXPLORER & EMBEDDED IMAGES EXTRACTOR
         ==================================================================== */}
      {pptxSlidesDoc && pptxSlidesDoc.slides && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
          onClick={() => setPptxSlidesDoc(null)}
        >
          <div
            className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white border border-slate-200 shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display font-bold text-base text-slate-900">
                  Презентация: {pptxSlidesDoc.name} ({pptxSlidesDoc.slides.length} сл.)
                </h3>
                <p className="text-xs text-slate-500">
                  Просмотр слайдов, заметок докладчика и встроенных иллюстраций
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPptxSlidesDoc(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Slide Index Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-slate-200">
              {pptxSlidesDoc.slides.map((s, idx) => (
                <button
                  key={s.slideNumber}
                  type="button"
                  onClick={() => setSelectedSlideIndex(idx)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-colors cursor-pointer ${
                    selectedSlideIndex === idx
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Слайд {s.slideNumber}
                </button>
              ))}
            </div>

            {/* Active Slide Body */}
            {(() => {
              const slide = pptxSlidesDoc.slides[selectedSlideIndex];
              if (!slide) return null;
              return (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div className="text-xs font-bold text-slate-900">
                      Текст слайда #{slide.slideNumber}:
                    </div>
                    <pre className="text-xs font-mono text-slate-800 whitespace-pre-wrap leading-relaxed max-h-52 overflow-y-auto">
                      {slide.text || '(На этом слайде нет текстовых блоков)'}
                    </pre>

                    {slide.notes && (
                      <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950">
                        <strong>Заметки:</strong> {slide.notes}
                      </div>
                    )}
                  </div>

                  {/* Slide Images */}
                  {slide.imageUrls && slide.imageUrls.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-slate-900">
                        Иллюстрации слайда #{slide.slideNumber} ({slide.imageUrls.length}):
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {slide.imageUrls.map((url, i) => (
                          <div
                            key={i}
                            className="rounded-xl border border-slate-200 overflow-hidden bg-slate-950 p-2 flex flex-col justify-between gap-2"
                          >
                            <img
                              src={url}
                              alt={`Слайд ${slide.slideNumber} img ${i}`}
                              className="max-h-36 max-w-full object-contain mx-auto"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                handleSavePptxSlideImageToLibrary(
                                  {
                                    id: `img-${slide.slideNumber}-${i}`,
                                    name: `Иллюстрация со слайда ${slide.slideNumber}`,
                                    dataUrl: url,
                                    mimeType: 'image/png',
                                  },
                                  slide.slideNumber
                                )
                              }
                              className="w-full py-1 text-[11px] font-bold rounded-lg bg-white/90 hover:bg-white text-slate-900 cursor-pointer shadow-xs"
                            >
                              В библиотеку
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="flex items-center justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setPptxSlidesDoc(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold cursor-pointer"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL 5: ZIP ARCHIVE EXPLORER & UNPACKER
         ==================================================================== */}
      {zipExplorerState && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
          onClick={() => {
            if (!isUnpackingZip) setZipExplorerState(null);
          }}
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white border border-slate-200 shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display font-bold text-base text-slate-900 flex items-center gap-2">
                  <Archive className="w-5 h-5 text-purple-600" />
                  <span>Содержимое архива: {zipExplorerState.file.name}</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Архив открыт безопасно без исполнения файлов. Выберите, какие материалы добавить в Базу знаний.
                </p>
              </div>
              <button
                type="button"
                disabled={isUnpackingZip}
                onClick={() => setZipExplorerState(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Target Settings */}
            <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
              <div>
                <label className="text-slate-600 font-bold block mb-1">
                  Область применения материалов:
                </label>
                <select
                  value={zipExplorerState.targetSchool}
                  onChange={(e) =>
                    setZipExplorerState((prev) =>
                      prev
                        ? { ...prev, targetSchool: e.target.value as DocumentSchoolScope }
                        : null
                    )
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-slate-900"
                >
                  <option value="all">Обеим школам (Общие материалы — ALL)</option>
                  <option value="kiberone">Только KIBERONE</option>
                  <option value="renderia">Только RENDERIA</option>
                </select>
              </div>

              <div>
                <label className="text-slate-500 font-semibold block mb-1">
                  Целевой раздел
                </label>
                <select
                  value={zipExplorerState.targetCategory}
                  onChange={(e) =>
                    setZipExplorerState((prev) =>
                      prev
                        ? { ...prev, targetCategory: e.target.value as KnowledgeCategoryKey }
                        : null
                    )
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-slate-900"
                >
                  {KNOWLEDGE_CATEGORIES.map((cat) => (
                    <option key={cat.key} value={cat.key}>
                      {cat.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Entries List with Checkboxes */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-600 px-1">
                <span>
                  Файлов в архиве: <strong>{zipExplorerState.entries.length}</strong> (выбрано{' '}
                  <strong>{zipExplorerState.selectedPaths.size}</strong>)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const allSupported = zipExplorerState.entries
                      .filter((e) => e.isSupported)
                      .map((e) => e.path);
                    setZipExplorerState((prev) =>
                      prev
                        ? {
                            ...prev,
                            selectedPaths:
                              prev.selectedPaths.size === allSupported.length
                                ? new Set()
                                : new Set(allSupported),
                          }
                        : null
                    );
                  }}
                  className="text-[#00A8B5] font-semibold hover:underline"
                >
                  {zipExplorerState.selectedPaths.size === zipExplorerState.entries.length
                    ? 'Снять выбор'
                    : 'Выбрать все поддерживаемые'}
                </button>
              </div>

              <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                {zipExplorerState.entries.map((entry) => {
                  const isChecked = zipExplorerState.selectedPaths.has(entry.path);
                  return (
                    <label
                      key={entry.path}
                      className="flex items-center justify-between p-2.5 hover:bg-slate-50 cursor-pointer text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const next = new Set(zipExplorerState.selectedPaths);
                            if (e.target.checked) next.add(entry.path);
                            else next.delete(entry.path);
                            setZipExplorerState((prev) =>
                              prev ? { ...prev, selectedPaths: next } : null
                            );
                          }}
                          className="rounded text-[#00A8B5]"
                        />
                        <span className="font-semibold text-slate-900 truncate" title={entry.path}>
                          {entry.name}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 font-mono-tabular text-slate-500 text-[11px]">
                        <span>{formatFileSizeRu(entry.sizeBytes)}</span>
                        <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 uppercase font-bold text-[10px]">
                          .{entry.extension}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 text-xs">
              <button
                type="button"
                disabled={isUnpackingZip}
                onClick={() => setZipExplorerState(null)}
                className="px-4 py-2 rounded-xl text-slate-700 bg-slate-100 hover:bg-slate-200 cursor-pointer font-semibold"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={isUnpackingZip || zipExplorerState.selectedPaths.size === 0}
                onClick={handleUnpackSelectedZip}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 disabled:opacity-40 transition-colors cursor-pointer shadow-xs"
              >
                {isUnpackingZip ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#00A8B5]" />
                    <span>Распаковка и анализ файлов...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 text-[#00A8B5]" />
                    <span>Распаковать выбранные ({zipExplorerState.selectedPaths.size})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL 6: INSPECT DOCUMENT TEXT (TXT / PDF / DOCX)
         ==================================================================== */}
      {inspectedDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
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
                      inspectedDoc.schoolId === 'all'
                        ? 'bg-[#00A8B5] text-white'
                        : inspectedDoc.schoolId === 'kiberone'
                          ? 'bg-[#FFD700] text-slate-950'
                          : 'bg-[#84CC16] text-slate-950'
                    }`}
                  >
                    {getSchoolNameRu(inspectedDoc.schoolId)}
                  </span>
                  {renderStatusBadge(inspectedDoc.status)}
                  <span className="text-xs text-slate-500 font-mono-tabular">
                    {formatFileSizeRu(inspectedDoc.sizeBytes)} · {inspectedDoc.createdAt}
                  </span>
                </div>
                <h3 className="font-display font-bold text-base text-slate-900 break-all">
                  {inspectedDoc.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectedDoc(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {inspectedDoc.warning && (
              <div className="rounded-xl p-3 bg-amber-50 border border-amber-200 text-xs text-amber-900">
                {inspectedDoc.warning}
              </div>
            )}

            {/* Extracted Page Images Scrollable Reader */}
            {inspectedDoc.extractedImages && inspectedDoc.extractedImages.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs font-bold text-slate-900 bg-slate-100 p-2.5 rounded-xl border border-slate-200/80">
                  <span className="flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-[#00A8B5]" />
                    <span>Страницы и изображения ({inspectedDoc.extractedImages.length})</span>
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono-tabular font-normal">
                    Просмотр всех страниц
                  </span>
                </div>

                <div className="max-h-80 overflow-y-auto space-y-3 pr-1.5 custom-scrollbar">
                  {inspectedDoc.extractedImages.map((pageImg, idx) => (
                    <div
                      key={pageImg.id || idx}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 text-white font-mono-tabular font-bold text-[10px]">
                          Страница {idx + 1} / {inspectedDoc.extractedImages!.length}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-600">
                          {pageImg.name || `Стр. ${idx + 1}`}
                        </span>
                      </div>
                      <div className="rounded-lg overflow-hidden border border-slate-200 bg-white flex items-center justify-center p-1">
                        <img
                          src={pageImg.dataUrl}
                          alt={pageImg.name || `Страница ${idx + 1}`}
                          className="w-full h-auto max-h-72 object-contain rounded"
                          loading="lazy"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {inspectedDoc.extractedText ? (
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-slate-800">Извлечённый текст:</div>
                <pre className="w-full max-h-64 overflow-auto rounded-xl bg-slate-900 text-slate-100 p-4 text-xs font-mono leading-relaxed whitespace-pre-wrap break-words">
                  {inspectedDoc.extractedText}
                </pre>
              </div>
            ) : !inspectedDoc.extractedImages || inspectedDoc.extractedImages.length === 0 ? (
              <div className="rounded-xl p-4 bg-slate-50 border border-slate-200 text-xs text-slate-600 text-center">
                В этом документе отсутствует извлечённый текст.
              </div>
            ) : null}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  const target = inspectedDoc;
                  setInspectedDoc(null);
                  setDocPendingDelete(target);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Удалить документ</span>
              </button>
              <button
                type="button"
                onClick={() => setInspectedDoc(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 cursor-pointer"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL 7: CONFIRM DELETION
         ==================================================================== */}
      {docPendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
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
                  Удалить материал из Базы знаний?
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 break-all">
                  «{docPendingDelete.name}» ({getSchoolNameRu(docPendingDelete.schoolId)})
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Карточка документа и его медиа-данные будут удалены из локального хранилища IndexedDB.
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isDeletingDoc}
                onClick={() => setDocPendingDelete(null)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={isDeletingDoc}
                onClick={handleConfirmDeleteDoc}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingDoc ? 'Удаление...' : 'Удалить'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL 8: ADD BRAND COLOR
         ==================================================================== */}
      {showAddColorModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          onClick={() => setShowAddColorModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h4 className="font-display font-bold text-sm text-slate-900 flex items-center gap-2">
                <Palette className="w-4 h-4 text-[#00A8B5]" />
                <span>
                  Новый цвет:{' '}
                  {activeSchool === 'all'
                    ? 'Экосистема'
                    : activeSchool === 'kiberone'
                      ? 'KIBERONE'
                      : 'RENDERIA'}
                </span>
              </h4>
              <button
                type="button"
                onClick={() => setShowAddColorModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddCustomColor} className="space-y-3.5">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Выбор цвета (палитра или HEX):
                </label>
                <div className="flex items-center gap-2.5">
                  <input
                    type="color"
                    value={
                      newColorHex.startsWith('#') && newColorHex.length === 7
                        ? newColorHex
                        : '#00A8B5'
                    }
                    onChange={(e) => setNewColorHex(e.target.value.toUpperCase())}
                    className="w-11 h-11 rounded-xl cursor-pointer border border-slate-200 p-0.5 bg-white shrink-0 shadow-2xs"
                  />
                  <input
                    type="text"
                    value={newColorHex}
                    onChange={(e) => setNewColorHex(e.target.value.toUpperCase())}
                    placeholder="#00A8B5"
                    className="flex-1 font-mono text-xs px-3 py-2.5 rounded-xl border border-slate-200 uppercase font-bold focus:outline-none focus:ring-2 focus:ring-[#00A8B5] text-slate-900"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Название цвета (необязательно):
                </label>
                <input
                  type="text"
                  value={newColorLabel}
                  onChange={(e) => setNewColorLabel(e.target.value)}
                  placeholder="Например: Неоновый акцент баннеров"
                  className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#00A8B5] text-slate-900"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddColorModal(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-xs cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5 text-[#FFD700]" />
                  <span>Сохранить цвет</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          FULLSCREEN DRAG-AND-DROP OVERLAY FOR KNOWLEDGE BASE
         ==================================================================== */}
      {isDraggingOverKB && (
        <div className="fixed inset-0 z-50 pointer-events-none bg-slate-900/60 backdrop-blur-xs flex flex-col items-center justify-center p-6 transition-all animate-in fade-in duration-150">
          <div className="flex flex-col items-center text-center p-8 bg-white/95 rounded-3xl shadow-2xl border-2 border-dashed border-[#00A8B5] max-w-md space-y-4 pointer-events-none">
            <div className="w-16 h-16 rounded-2xl bg-[#00A8B5]/15 text-[#00A8B5] flex items-center justify-center shadow-inner">
              <Upload className="w-8 h-8 animate-bounce" />
            </div>
            <div>
              <h3 className="font-display font-bold text-lg text-slate-900">
                Загрузить в Базу знаний
              </h3>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Перетащите файлы сюда (PDF, DOCX, PPTX, изображения, видео или ZIP-архивы)
              </p>
            </div>
            <div className="text-[11px] font-semibold text-[#00A8B5] bg-[#00A8B5]/10 px-3 py-1.5 rounded-xl">
              {activeSubTab === 'brandbooks'
                ? 'Файл будет помечен как материал брендбука'
                : activeSubTab === 'visual_library'
                  ? 'Файл будет добавлен в визуальную библиотеку'
                  : 'Автоматический анализ структуры документа'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
