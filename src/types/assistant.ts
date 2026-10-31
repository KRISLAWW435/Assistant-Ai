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

export type RightPanelTab = 'materials' | 'preview' | 'search' | 'context';

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
}

export interface ChatAttachmentMeta {
  id: string;
  name: string;
  extension: string;
  sizeBytes: number;
  status?: DocumentProcessingStatus;
  mimeType?: string;
  createdAt?: string;
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

export type CompanionTaskStatus = 'new' | 'in_progress' | 'done';

export type CompanionTaskPriority = 'low' | 'medium' | 'high';

export interface CompanionTaskRecord {
  id: string;
  title: string;
  description: string;
  dueDate: string; // YYYY-MM-DD or ''
  priority: CompanionTaskPriority;
  status: CompanionTaskStatus;
  schoolId?: SchoolId | 'both';
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
}

export interface ProposedCompanionMemoryDraft {
  category: CompanionMemoryCategory;
  title: string;
  content: string;
  schoolId?: SchoolId | 'both';
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
  isStreaming?: boolean;
  isError?: boolean;
  modelName?: string;
  providerId?: AIProviderId;
  providerLabel?: string;
  failoverNotice?: string;
  durationMs?: number;
  selectedProvider?: AIProviderSelectionMode;
  errorReason?: string;
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
  activeWorkElapsedMs: number;
  breakSnoozeUntilMs?: number | null;
  lastActiveInteractionMs: number;
  lastAutonomousMessageMs: number;
  mood: CompanionMoodState;
  housePose?: CompanionHousePose;
  collapsed?: boolean;
  customPosition?: CompanionCustomPosition | null;
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
  contextSummaryLabels: string[];
}
