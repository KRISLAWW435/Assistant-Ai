export type SchoolId = 'kiberone' | 'renderia';

export type AgentMode = 'marketer' | 'manager' | 'methodist' | 'analyst' | 'designer';

export type NavSection =
  | 'home'
  | 'tasks'
  | 'marketer'
  | 'manager'
  | 'methodist'
  | 'analyst'
  | 'designer'
  | 'knowledge'
  | 'backups'
  | 'connections';

export type RightPanelTab = 'materials' | 'preview' | 'search' | 'context' | 'voice';

export type KnowledgeCategoryKey =
  | 'description'
  | 'programs'
  | 'age'
  | 'pricing'
  | 'schedule'
  | 'advantages'
  | 'faq'
  | 'contacts';

export interface KnowledgeCategoryMeta {
  key: KnowledgeCategoryKey;
  title: string;
  subtitle: string;
  placeholder: string;
}

export type SchoolKnowledgeFields = Record<KnowledgeCategoryKey, string>;

export type KnowledgeBaseBySchool = Record<SchoolId, SchoolKnowledgeFields>;

export type DocumentProcessingStatus =
  | 'queued'
  | 'processing'
  | 'processed'
  | 'no_text'
  | 'error'
  | 'pending'
  | 'verified';

export type DocumentSchoolScope = SchoolId | 'all';

export type VisualAssetRole =
  | 'logo'
  | 'brandbook'
  | 'reference'
  | 'template'
  | 'palette'
  | 'other';

export type KnowledgeFileType =
  | 'document'
  | 'image'
  | 'presentation'
  | 'archive'
  | 'video';

export interface VisualColorSample {
  hex: string;
  label?: string;
}

export interface ExtractedSlideItem {
  slideNumber: number;
  text: string;
  imageUrls?: string[];
  notes?: string;
}

export interface ExtractedDocumentImage {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
  sourceSlide?: number;
  visualRole?: VisualAssetRole;
}

export interface UploadedDocumentRecord {
  id: string;
  name: string;
  extension: string;
  sizeBytes: number;
  schoolId: DocumentSchoolScope;
  categoryKey: KnowledgeCategoryKey;
  status: DocumentProcessingStatus;
  statusMessage?: string;
  warning?: string;
  extractedText: string;
  createdAt: string;
  createdAtMs?: number;
  verifiedByManager: boolean;
  pageCount?: number;
  fileType?: KnowledgeFileType;
  mimeType?: string;
  tags?: string[];
  description?: string;
  visualRole?: VisualAssetRole;
  dataUrl?: string;
  thumbnailUrl?: string;
  slides?: ExtractedSlideItem[];
  colorPalette?: VisualColorSample[];
  extractedImages?: ExtractedDocumentImage[];
  durationSec?: number;
  videoWidth?: number;
  videoHeight?: number;
  archiveFilesCount?: number;
}

export interface ChatAttachment {
  id: string;
  name: string;
  extension: string;
  sizeBytes: number;
  sizeFormatted?: string;
  extractedText: string;
  status?: DocumentProcessingStatus;
  statusMessage?: string;
  warning?: string;
  pageCount?: number;
  mimeType?: string;
  createdAt?: string;
  createdAtMs?: number;
  dataUrl?: string;
  messageId?: string;
  schoolId?: SchoolId;
  uploadedAt?: string;
}

export interface ChatAttachmentMeta {
  id: string;
  name: string;
  extension: string;
  sizeBytes: number;
  status?: DocumentProcessingStatus;
  mimeType?: string;
  createdAt?: string;
  dataUrl?: string;
}

export type AIProviderId = 'gemini' | 'openrouter' | 'ollama';

export type AIProviderSelectionMode = 'auto' | AIProviderId;

export type AIProviderHealthStatus =
  | 'connected'
  | 'available'
  | 'temporarily_unavailable'
  | 'quota_exceeded'
  | 'not_configured'
  | 'key_check_required';

export type AIConnectionStatus =
  | 'connected'
  | 'available'
  | 'error'
  | 'not_configured'
  | 'quota_exceeded'
  | 'testing';

export interface AIConnectionProfile {
  id: string;
  providerId: AIProviderId;
  userDefinedName: string;
  maskedKey: string;
  encryptedCredentialReference: string;
  selectedModel: string;
  connectionStatus: AIConnectionStatus;
  isDefault?: boolean;
  lastCheckedAt?: string;
  lastError?: string;
  createdAt?: string;
}

export type SpecialistRoleKey =
  | 'marketer'
  | 'manager'
  | 'methodist'
  | 'analyst'
  | 'designer'
  | 'pixel';

export interface SpecialistModelSetting {
  providerSelection: 'auto' | AIProviderId;
  specificModel?: string;
}

export type SpecialistModelAssignments = Record<
  SpecialistRoleKey,
  SpecialistModelSetting
>;

export interface FailoverSequenceSettings {
  order: AIProviderId[];
  allowCloudFailoverForDocs: boolean;
  requireExplicitDocConsent: boolean;
}

export interface OllamaModelInfo {
  name: string;
  sizeBytes?: number;
  modifiedAt?: string;
  parameterSize?: string;
  format?: string;
  family?: string;
}

export interface OllamaLocalInfo {
  installed: boolean;
  running: boolean;
  version?: string;
  apiUrl: string;
  models: OllamaModelInfo[];
  lastCheckedAt?: string;
  error?: string;
}

export type DesignAspectRatio = '3:4' | '9:16' | '1:1' | '16:9' | '4:3';

export type DesignQualityMode = 'standard' | '1K' | '2K' | '4K';

export type DesignTemplatePresetId =
  | 'promo_banner'
  | 'story_vertical'
  | 'vk_post'
  | 'event_poster'
  | 'free_concept';

export interface DesignOverlayLayer {
  id: string;
  type: 'headline' | 'offer' | 'cta' | 'school_badge' | 'plate';
  label: string;
  text: string;
  visible: boolean;
  xPercent: number;
  yPercent: number;
  fontSizePx: number;
  textColor: string;
  backgroundColor?: string;
  accentColor?: string;
  align?: 'left' | 'center' | 'right';
}

export interface DesignSelectionBox {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
}

export type ImageProviderId = 'cloudflare';

export type FreeDesignImageModelId =
  | '@cf/black-forest-labs/flux-1-schnell'
  | '@cf/black-forest-labs/flux-2-klein-9b';

export type DesignImageModelId =
  | FreeDesignImageModelId
  | 'gemini-3.1-flash-lite-image'
  | 'gemini-nano-banana-2.1'
  | 'gemini-2.5-flash-image'
  | string;

export type ImageProviderAvailabilityStatus =
  | 'available'
  | 'not_configured'
  | 'quota_exceeded'
  | 'error';

export interface ImageModelDescriptor {
  id: FreeDesignImageModelId;
  providerId: ImageProviderId;
  label: string;
  shortLabel: string;
  descriptionRu: string;
  isFreeTier: true;
  status: ImageProviderAvailabilityStatus;
  statusLabelRu: string;
  supportsReferenceImage: boolean;
  supportsImageEditing: boolean;
  supportedAspectRatios: DesignAspectRatio[];
  maxResolutionLabel: string;
  inputImageLimitLabel: string;
  estimatedNeuronsPerRun: number;
  limitationsRu: string[];
}

export interface ImageProviderQuotaState {
  dailyLimitLabel: string;
  resetScheduleLabel: string;
  requestsTodayCount: number;
  estimatedNeuronsUsedToday: number;
  dailyFreeNeuronLimit: number;
  remainingQuotaStatus: 'unknown';
  remainingQuotaLabelRu: string;
  isExhausted: boolean;
  lastError?: string;
  utcDateKey: string;
}

export interface ImageProviderDescriptor {
  id: ImageProviderId;
  label: string;
  shortLabel: string;
  isFreeTierOnly: true;
  configured: boolean;
  status: ImageProviderAvailabilityStatus;
  statusLabelRu: string;
  lastCheckedAtIso?: string;
  quota: ImageProviderQuotaState;
  models: ImageModelDescriptor[];
}

export interface ImageProvidersRegistryState {
  defaultProviderId: ImageProviderId;
  defaultModelId: FreeDesignImageModelId;
  providers: ImageProviderDescriptor[];
}

export interface DesignVersionItem {
  id: string;
  versionNumber: number;
  label: string;
  promptUsed: string;
  editInstruction?: string;
  selectionBox?: DesignSelectionBox;
  providerId?: ImageProviderId | 'gemini';
  modelUsed: DesignImageModelId;
  aspectRatio: DesignAspectRatio;
  qualityMode: DesignQualityMode;
  backgroundImageDataUrl: string;
  layers: DesignOverlayLayer[];
  createdAt: string;
}

export interface DesignArtifactRecord {
  id: string;
  schoolId: SchoolId;
  sessionId: string;
  messageId?: string;
  title: string;
  conceptSummary: string;
  aspectRatio: DesignAspectRatio;
  qualityMode: DesignQualityMode;
  templatePreset: DesignTemplatePresetId;
  activeVersionId: string;
  versions: DesignVersionItem[];
  pendingVersion?: DesignVersionItem;
  sourceHandoffId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpecialistHandoffPacket {
  id: string;
  fromSpecialist: AgentMode;
  toSpecialist: AgentMode;
  sourceSessionId: string;
  sourceMessageId?: string;
  targetSessionId: string;
  schoolId: SchoolId;
  originalTask: string;
  goalAndAudience: string;
  approvedOfferAndText: string;
  additionalRequirements: string;
  discussionContext: string;
  attachments: ChatAttachment[];
  status: 'sent' | 'in_progress' | 'clarifying' | 'completed';
  resultSummary?: string;
  resultArtifactId?: string;
  resultImageDataUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpecialistHandoffResult {
  handoffId: string;
  fromSpecialist: AgentMode;
  toSpecialist: AgentMode;
  sourceSessionId: string;
  targetSessionId: string;
  schoolId: SchoolId;
  summary: string;
  artifactId?: string;
  previewImageDataUrl?: string;
  layersSummary?: string;
  completedAt: string;
}

export interface DesignerConceptOption {
  id: string;
  title: string;
  visualDirection: string;
  compositionAndStyle: string;
  suggestedHeadline: string;
  suggestedOffer: string;
  suggestedCta: string;
  recommendedAspectRatio: DesignAspectRatio;
  imageGenerationPrompt: string;
}

export interface DesignerClarifyingQuestion {
  id: string;
  question: string;
  options: string[];
  selectedOption?: string;
}

export interface DesignerInteractivePrompt {
  concepts: DesignerConceptOption[];
  selectedConceptId?: string;
  questions: DesignerClarifyingQuestion[];
  confirmedByAnna?: boolean;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  createdAtMs?: number;
  schoolId: SchoolId;
  mode: AgentMode;
  attachmentName?: string;
  attachmentMeta?: ChatAttachmentMeta;
  usedContextSummary?: string[];
  isStreaming?: boolean;
  isError?: boolean;
  modelName?: string;
  providerId?: AIProviderId;
  providerLabel?: string;
  failoverNotice?: string;
  consentRequiredFallbackProvider?: AIProviderId;
  delegatedByPixel?: boolean;
  delegationTaskId?: string;
  delegationIteration?: number;
  senderLabel?: string;
  handoffPacket?: SpecialistHandoffPacket;
  handoffResult?: SpecialistHandoffResult;
  interactiveDesignerPrompt?: DesignerInteractivePrompt;
  designArtifact?: DesignArtifactRecord;
}

export interface ChatSession {
  id: string;
  title: string;
  schoolId: SchoolId;
  mode: AgentMode;
  isPinned?: boolean;
  createdAt: string;
  updatedAt: string;
  createdAtMs?: number;
  updatedAtMs?: number;
  messages: ChatMessage[];
  attachments?: ChatAttachment[];
  linkedHandoffPacket?: SpecialistHandoffPacket;
  designArtifacts?: DesignArtifactRecord[];
}

export interface QuickPromptTemplate {
  id: string;
  label: string;
  category: string;
  getPrompt: (schoolName: string, schoolFocus: string) => string;
}

export interface AgentModeConfig {
  id: AgentMode;
  title: string;
  shortTitle: string;
  roleSubtitle: string;
  description: string;
  tasksSummary: string[];
  accentColor: string;
  quickPrompts: QuickPromptTemplate[];
}

export interface SchoolConfig {
  id: SchoolId;
  name: string;
  tagline: string;
  focusDescription: string;
  accentHex: string;
  secondaryHex: string;
  badgeTextClass: string;
  logoPath?: string;
}

export interface WorkspaceBackupSettings {
  activeSchool: SchoolId;
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  rightPanelTab: RightPanelTab;
}

// ============================================================================
// PIXEL COMPANION TYPES (Parts 3–11)
// ============================================================================

export type CompanionMoodState =
  | 'happy'
  | 'curious'
  | 'thinking'
  | 'sleepy'
  | 'sleeping'
  | 'playing'
  | 'excited'
  | 'working';

export type CompanionHousePose =
  | 'outside'
  | 'peeking'
  | 'inside_sleeping'
  | 'playing_yard'
  | 'running';

export type CompanionMemoryCategory =
  | 'profile'
  | 'projects'
  | 'preferences'
  | 'decisions';

export interface CompanionMemoryRecord {
  id: string;
  category: CompanionMemoryCategory;
  title: string;
  content: string;
  schoolId?: SchoolId | 'both';
  confirmedByAnna: boolean;
  createdAt: string;
  updatedAt: string;
  updatedAtMs: number;
}

export type CompanionTaskStatus =
  | 'new'
  | 'in_progress'
  | 'waiting_response'
  | 'waiting_anna_action'
  | 'done'
  | 'cancelled'
  | 'postponed';

export type CompanionTaskPriority = 'low' | 'medium' | 'high';

export type CompanionTaskReminderRepeat =
  | 'none'
  | 'daily'
  | 'weekdays'
  | 'weekly';

export interface CompanionTaskStep {
  id: string;
  title: string;
  done: boolean;
}

export interface CompanionTaskScheduleProposal {
  proposedDueDate: string;
  reason: string;
  createdAtMs: number;
}

export interface CompanionTaskRecord {
  id: string;
  title: string;
  description: string;
  dueDate: string; // YYYY-MM-DD or ''
  dueTime?: string; // HH:mm in Europe/Samara
  priority: CompanionTaskPriority;
  priorityReason?: string;
  urgencyScore?: number; // 1-10
  importanceScore?: number; // 1-10
  estimatedMinutes?: number;
  consequencesIfDelayed?: string;
  dependencyNote?: string;
  steps?: CompanionTaskStep[];
  status: CompanionTaskStatus;
  schoolId?: SchoolId | 'both';
  sourceType?: 'manual' | 'conversation_auto' | 'voice_command' | 'delegation' | 'reminder';
  sourceExcerpt?: string;
  sourceMessageId?: string;
  linkedDelegationTaskId?: string;
  linkedSpecialistId?: AgentMode;
  linkedChatId?: string;
  reminderAt?: string; // ISO string or YYYY-MM-DDTHH:mm
  reminderRepeat?: CompanionTaskReminderRepeat;
  lastReminderFiredAtMs?: number;
  deadlineWarningFired?: boolean;
  overdueWarningFired?: boolean;
  postponedAtMs?: number;
  pendingScheduleProposal?: CompanionTaskScheduleProposal;
  createdAt: string;
  createdAtMs: number;
  completedAt?: string;
  completedAtMs?: number;
}

export interface ProposedCompanionTaskDraft {
  title: string;
  description: string;
  dueDate: string;
  priority: CompanionTaskPriority;
  schoolId?: SchoolId | 'both';
  priorityReason?: string;
  estimatedMinutes?: number;
}

export interface ProposedCompanionMemoryDraft {
  category: CompanionMemoryCategory;
  title: string;
  content: string;
  schoolId?: SchoolId | 'both';
}

export type CoordinatorTaskStatus =
  | 'draft'
  | 'pending_confirmation'
  | 'sent'
  | 'processing'
  | 'completed'
  | 'needs_revision'
  | 'failed'
  | 'cancelled'
  | 'created'
  | 'in_progress'
  | 'reviewing'
  | 'error';

export type PixelDelegationStatus = CoordinatorTaskStatus;

export interface SpecialistAnalysisResult {
  isTaskCompleted: boolean;
  allQuestionsAnswered: boolean;
  actionableRecommendations: string[];
  schoolConsidered: boolean;
  schoolName: string;
  contradictionsOrGaps?: string[];
  missingData?: string[];
  critiqueRemarks: string[];
  unresolvedQuestions?: string[];
  proposedNextSteps: string[];
  briefSummary: string;
  verdict: 'approved' | 'needs_revision' | 'acceptable';
}

export interface SpecialistRevisionItem {
  id: string;
  iteration: number;
  requestedAt: string;
  requestedAtMs: number;
  revisionPrompt: string;
  cleanInstruction?: string;
  status: 'pending_confirmation' | 'sent' | 'completed' | 'cancelled';
  resultMessageId?: string;
  resultPreview?: string;
  reviewComment?: string;
}

export interface PixelDelegatedTaskState {
  taskId: string;
  targetMode: AgentMode;
  specialistId: AgentMode;
  schoolId: SchoolId;
  chatId: string;
  sessionId: string;
  sessionTitle?: string;
  isNewChatCreated?: boolean;
  instruction: string;
  cleanInstruction?: string;
  originalUserRequest: string;
  status: CoordinatorTaskStatus;
  statusLabelRu: string;
  messageId?: string;
  resultMessageId?: string;
  lastSpecialistMessageId?: string;
  resultText?: string;
  iterationCount: number;
  maxRevisions: number;
  analysis?: SpecialistAnalysisResult;
  reviewSummary?: string;
  revisions?: SpecialistRevisionItem[];
  revisionFeedbackHistory?: string[];
  specialistReplyPreview?: string;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
  updatedAt: string;
  createdAtMs: number;
  completedAtMs?: number;
  updatedAtMs: number;
  sourceMode: 'text' | 'voice';
}

export interface PixelPendingDelegationDraft {
  draftId: string;
  targetSchool: SchoolId;
  targetMode: AgentMode;
  targetSpecialistNameRu: string;
  cleanInstruction: string;
  originalUserRequest: string;
  sessionId?: string;
  sessionTitle?: string;
  isFollowUp?: boolean;
  status: 'awaiting_confirmation' | 'confirmed' | 'cancelled';
  createdAt: string;
  createdAtMs: number;
  sourceMode: 'text' | 'voice';
}

export interface PixelPendingRevisionDraft {
  revisionDraftId: string;
  taskId: string;
  schoolId: SchoolId;
  targetMode: AgentMode;
  targetSpecialistNameRu: string;
  sessionId: string;
  sessionTitle: string;
  iteration: number;
  revisionPrompt: string;
  cleanInstruction: string;
  status: 'awaiting_confirmation' | 'confirmed' | 'cancelled';
  createdAt: string;
  createdAtMs: number;
  sourceMode: 'text' | 'voice';
}

export interface PixelChatNavigationItem {
  sessionId: string;
  sessionTitle: string;
  schoolId: SchoolId;
  schoolName: string;
  mode: AgentMode;
  specialistTitle: string;
  messagesCount: number;
  updatedAt: string;
  updatedAtMs: number;
  lastMessagePreview?: string;
  isCurrentlyOpen: boolean;
}

export interface PixelPendingChatDeletion {
  deletionId: string;
  sessionId: string;
  sessionTitle: string;
  schoolId: SchoolId;
  schoolName: string;
  mode: AgentMode;
  specialistTitle: string;
  messagesCount: number;
  updatedAt: string;
  status: 'awaiting_confirmation' | 'confirmed' | 'cancelled';
  createdAt?: string;
  createdAtMs: number;
}

export type PersonalTaskDraftStep =
  | 'clarifying_date'
  | 'clarifying_priority'
  | 'clarifying_reminder'
  | 'ready_for_confirmation';

export interface PixelPendingPersonalTaskDraft {
  draftId: string;
  title: string;
  description: string;
  schoolId: SchoolId | 'both';
  dueDate?: string; // YYYY-MM-DD
  dueTime?: string; // HH:mm in Europe/Samara
  hasExplicitDate: boolean;
  hasExplicitDueTime: boolean;
  priority?: CompanionTaskPriority;
  hasExplicitPriority: boolean;
  wantsReminder?: boolean;
  reminderDate?: string;
  reminderTime?: string;
  reminderAt?: string; // ISO string in Europe/Samara
  hasExplicitReminder: boolean;
  step: PersonalTaskDraftStep;
  status: 'drafting' | 'awaiting_confirmation' | 'confirmed' | 'cancelled';
  createdAtMs: number;
}

export interface CompanionMessage {
  id: string;
  role: 'user' | 'pixel';
  content: string;
  createdAt: string;
  createdAtMs: number;
  schoolId?: SchoolId | 'both';
  isSpoken?: boolean;
  usedContextLabels?: string[];
  proposedTask?: ProposedCompanionTaskDraft;
  proposedMemory?: ProposedCompanionMemoryDraft;
  proposalStatus?: 'pending' | 'confirmed' | 'dismissed';
  autoCreatedTask?: CompanionTaskRecord;
  taskUndoAvailable?: boolean;
  pendingDelegationDraft?: PixelPendingDelegationDraft;
  pendingRevisionDraft?: PixelPendingRevisionDraft;
  pendingChatDeletion?: PixelPendingChatDeletion;
  pendingPersonalTaskDraft?: PixelPendingPersonalTaskDraft;
  deletableChatsList?: PixelChatNavigationItem[];
  chatDisambiguationList?: PixelChatNavigationItem[];
  delegatedTask?: PixelDelegatedTaskState;
  isStreaming?: boolean;
  isError?: boolean;
  modelName?: string;
  providerId?: AIProviderId;
  providerLabel?: string;
  failoverNotice?: string;
  durationMs?: number;
  selectedProvider?: AIProviderSelectionMode;
  errorReason?: string;
  imageAttachment?: ChatAttachment;
}

export interface CompanionCustomPosition {
  /** Offset in pixels from the left of the viewport, or relative to workspace */
  x: number;
  /** Offset in pixels from the top of the viewport */
  y: number;
}

export interface CompanionPreferencesRecord {
  id: 'pixel_state';
  quietMode: boolean;
  breakRemindersEnabled: boolean;
  proactiveTipsEnabled?: boolean;
  autoCaptureTasksEnabled?: boolean;
  interactionPaused?: boolean;
  characterHidden?: boolean;
  activeWorkElapsedMs: number;
  breakSnoozeUntilMs?: number | null;
  lastActiveInteractionMs: number;
  lastAutonomousMessageMs: number;
  mood: CompanionMoodState;
  housePose?: CompanionHousePose;
  collapsed?: boolean;
  customPosition?: CompanionCustomPosition | null;
}

export interface PixelActiveChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  authorType: 'anna' | 'pixel' | 'specialist';
  authorLabel: string;
  content: string;
  createdAt: string;
}

export interface PixelActiveChatContext {
  isSpecialistChatOpen?: boolean;
  sessionId: string;
  sessionTitle: string;
  schoolId: SchoolId;
  schoolName: string;
  mode: AgentMode;
  specialistTitle: string;
  specialistRoleSubtitle: string;
  messagesCount: number;
  lastSpecialistMessage?: {
    id: string;
    content: string;
    createdAt: string;
  };
  recentMessages: PixelActiveChatMessageItem[];
}

/**
 * Structured context bundle prepared for future selective Gemini API integration (Part 11).
 */
export interface PixelRelevantContextBundle {
  activeSchool: SchoolId;
  schoolName: string;
  relevantMemories: Pick<
    CompanionMemoryRecord,
    'id' | 'category' | 'title' | 'content'
  >[];
  activeTasks: Pick<
    CompanionTaskRecord,
    'id' | 'title' | 'dueDate' | 'priority' | 'status'
  >[];
  activeChatContext?: PixelActiveChatContext;
  contextSummaryLabels: string[];
}
