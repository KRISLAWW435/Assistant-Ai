export type SchoolId = 'kiberone' | 'renderia';

export type AgentMode = 'marketer' | 'manager' | 'methodist' | 'analyst';

export type NavSection =
  | 'home'
  | 'marketer'
  | 'manager'
  | 'methodist'
  | 'analyst'
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

export interface UploadedDocumentRecord {
  id: string;
  name: string;
  extension: string;
  sizeBytes: number;
  schoolId: SchoolId;
  categoryKey: KnowledgeCategoryKey;
  status: DocumentProcessingStatus;
  statusMessage?: string;
  warning?: string;
  extractedText: string;
  createdAt: string;
  createdAtMs?: number;
  verifiedByManager: boolean;
  pageCount?: number;
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
  | 'postponed'
  | 'waiting_response'
  | 'done';

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
  sourceType?: 'manual' | 'conversation_auto' | 'voice_command' | 'delegation';
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
