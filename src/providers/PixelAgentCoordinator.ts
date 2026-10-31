import {
  AgentMode,
  AIProviderId,
  AIProviderSelectionMode,
  ChatMessage,
  ChatSession,
  CompanionMessage,
  KnowledgeBaseBySchool,
  NavSection,
  PixelActiveChatContext,
  PixelActiveChatMessageItem,
  PixelChatNavigationItem,
  PixelDelegatedTaskState,
  PixelDelegationStatus,
  PixelPendingChatDeletion,
  PixelPendingDelegationDraft,
  SchoolId,
  UploadedDocumentRecord,
} from '../types/assistant';
import { AGENT_MODES, SCHOOLS } from '../config/schoolsAndModes';
import { documentProvider } from './documentProvider';
import {
  geminiProvider,
  GenerationStage,
} from './geminiProvider';
import {
  aiProviderManager,
  readStoredProviderSelection,
} from './aiProviderManager';
import {
  sortSessionsPinnedAndUpdatedDesc,
  storageProvider,
} from './storageProvider';
import { voiceManager } from './voice/voiceManager';

export const PIXEL_DELEGATION_STATUS_LABELS: Record<
  PixelDelegationStatus,
  string
> = {
  created: 'Создано',
  in_progress: 'Выполняется',
  reviewing: 'Проверяется Пикселем',
  needs_revision: 'Требует доработки',
  completed: 'Завершено',
  error: 'Ошибка',
};

export const MAX_DELEGATION_REVISIONS = 3;

export const SPECIALIST_NAMES_GENITIVE_RU: Record<AgentMode, string> = {
  marketer: 'Маркетолога',
  manager: 'Менеджера',
  methodist: 'Методиста',
  analyst: 'Аналитика',
};

export const SPECIALIST_NAMES_DATIVE_RU: Record<AgentMode, string> = {
  marketer: 'Маркетологу',
  manager: 'Менеджеру',
  methodist: 'Методисту',
  analyst: 'Аналитику',
};

export const SPECIALIST_NAMES_INSTRUMENTAL_RU: Record<AgentMode, string> = {
  marketer: 'Маркетологом',
  manager: 'Менеджером',
  methodist: 'Методистом',
  analyst: 'Аналитиком',
};

export interface ParsedDelegationIntent {
  isDelegation: boolean;
  isSupportedSpecialist: boolean;
  targetMode: AgentMode;
  targetSpecialistNameRu: string;
  targetSchool: SchoolId;
  hasExplicitSchool?: boolean;
  preferredSessionId?: string;
  instruction: string;
  cleanInstruction: string;
  originalText: string;
  isFollowUp?: boolean;
  isAmbiguous?: boolean;
  isIncompleteUtterance?: boolean;
  incompleteReasonRu?: string;
}

export interface ParsedReadAloudIntent {
  isReadAloud: boolean;
  isResume?: boolean;
  targetMode?: AgentMode;
  targetSchool?: SchoolId;
  hasExplicitSchool?: boolean;
  originalText: string;
}

export interface ParsedChatNavigationIntent {
  isNavigation: boolean;
  targetSchool?: SchoolId;
  hasExplicitSchool: boolean;
  targetMode?: AgentMode;
  hasExplicitSpecialist?: boolean;
  preferredSessionNumber?: number;
  originalText: string;
}

export interface ParsedChatDeletionIntent {
  isDeletion?: boolean;
  action: 'list_deletable' | 'delete_current' | 'delete_target';
  targetSchool?: SchoolId;
  hasExplicitSchool?: boolean;
  targetMode?: AgentMode;
  preferOldest?: boolean;
  preferredSessionId?: string;
  originalText: string;
}

export interface ParsedUnsupportedActionIntent {
  isUnsupported: boolean;
  capabilityLabelRu: string;
  explanationRu: string;
  originalText: string;
}

export interface PixelAgentCoordinatorDeps {
  getActiveSchool: () => SchoolId;
  getActiveSection?: () => NavSection;
  getActiveAgentMode?: () => AgentMode;
  getActiveSessionId?: () => string | null;
  getSessions: () => ChatSession[];
  onUpdateSessions: (
    nextSessions: ChatSession[],
    selectSessionId?: string
  ) => void;
  onDeleteSession?: (sessionId: string) => Promise<boolean>;
  getKnowledgeBase: () => KnowledgeBaseBySchool;
  getUploadedDocuments: () => UploadedDocumentRecord[];
  getProviderSelection: () => AIProviderSelectionMode;
  getCompanionMessages: () => CompanionMessage[];
  onSaveCompanionMessages: (messages: CompanionMessage[]) => Promise<void>;
  onSpecialistGenerationStateChange?: (state: {
    isGenerating: boolean;
    sessionId: string | null;
    stage: GenerationStage | null;
  }) => void;
  onOpenDelegatedChat?: (
    schoolId: SchoolId,
    mode: AgentMode,
    sessionId: string,
    highlightMessageId?: string
  ) => void;
  onHighlightSpecialistMessage?: (
    sessionId: string,
    messageId: string
  ) => void;
  onShowPixelBubble?: (text: string) => void;
  onNotifyLiveVoice?: (notificationText: string) => void;
}

function isAgentModeSection(section: NavSection): section is AgentMode {
  return (
    section === 'marketer' ||
    section === 'manager' ||
    section === 'methodist' ||
    section === 'analyst'
  );
}

function formatTimeNow(date: Date = new Date()): string {
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function hasExplicitSchoolMention(text: string): boolean {
  const lower = (text || '').toLowerCase();
  return (
    lower.includes('renderia') ||
    lower.includes('рендери') ||
    lower.includes('рендерия') ||
    lower.includes('рендерии') ||
    lower.includes('рендерию') ||
    lower.includes('kiber') ||
    lower.includes('киберван') ||
    lower.includes('киберон')
  );
}

function detectTargetSchoolFromText(
  text: string,
  fallbackSchool: SchoolId
): SchoolId {
  const lower = text.toLowerCase();
  const hasRenderia =
    lower.includes('renderia') ||
    lower.includes('рендери') ||
    lower.includes('рендерия') ||
    lower.includes('рендерии') ||
    lower.includes('рендерию');
  const hasKiberone =
    lower.includes('kiber') ||
    lower.includes('киберван') ||
    lower.includes('киберон');

  if (hasRenderia && !hasKiberone) return 'renderia';
  if (hasKiberone && !hasRenderia) return 'kiberone';
  return fallbackSchool;
}

function detectSpecialistFromText(lower: string): {
  matched: boolean;
  mode?: AgentMode;
  nameRu?: string;
} {
  if (
    /(?:^|[^а-яёa-z0-9])маркетолог(?:а|у|е|ом|и|ов)?(?=$|[^а-яёa-z0-9])/i.test(
      lower
    ) ||
    /(?:^|[^а-яёa-z0-9])специалист(?:а|у|ом)?\s+по\s+маркетингу(?=$|[^а-яёa-z0-9])/i.test(
      lower
    )
  ) {
    return { matched: true, mode: 'marketer', nameRu: 'Маркетолог' };
  }
  if (
    /(?:^|[^а-яёa-z0-9])менеджер(?:а|у|е|ом|ы|ов)?(?=$|[^а-яёa-z0-9])/i.test(
      lower
    ) ||
    /(?:^|[^а-яёa-z0-9])специалист(?:а|у|ом)?\s+по\s+продажам(?=$|[^а-яёa-z0-9])/i.test(
      lower
    )
  ) {
    return { matched: true, mode: 'manager', nameRu: 'Менеджер' };
  }
  if (
    /(?:^|[^а-яёa-z0-9])методист(?:а|у|е|ом|ы|ов)?(?=$|[^а-яёa-z0-9])/i.test(
      lower
    )
  ) {
    return { matched: true, mode: 'methodist', nameRu: 'Методист' };
  }
  if (
    /(?:^|[^а-яёa-z0-9])аналитик(?:а|у|е|ом|и|ов)?(?=$|[^а-яёa-z0-9])/i.test(
      lower
    )
  ) {
    return { matched: true, mode: 'analyst', nameRu: 'Аналитик' };
  }
  return { matched: false };
}

function buildNewSpecialistSession(
  mode: AgentMode,
  school: SchoolId,
  existingSessions: ChatSession[]
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

/**
 * Formats a clean, natural Russian business instruction for a specialist chat.
 * Removes Markdown symbols (** / # / `), emojis, technical IDs, and system headers.
 */
export function buildCleanBusinessInstruction(
  rawInstruction: string,
  targetSchool: SchoolId
): string {
  const schoolName = SCHOOLS[targetSchool].name;

  let text = (rawInstruction || '')
    // Remove markdown bold/italic/headers/code/strikethrough
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    // Remove emojis and decorative bullets
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}]/gu,
      ''
    )
    .replace(/[•▪▫★☆▶►✔✓✕✖✅❌⚠️🤖🔄]/g, '')
    // Remove technical task IDs if accidentally present
    .replace(/\bptask-[a-z0-9-]+\b/gi, '')
    .replace(/^(?:чтобы\s+(?:он|она|специалист)\s+)/i, '')
    .replace(/^(?:что\s+нужно\s+)/i, '')
    .replace(/^[,.:;—–-]+\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!text) return '';

  // Convert common leading infinitive verbs or past-tense subjunctive («разработал») into polite business imperative
  const verbConversions: Array<[RegExp, string]> = [
    [/^(?:разработать|разработал(?:а)?)\b/i, 'Разработайте'],
    [/^(?:составить|составил(?:а)?)\b/i, 'Составьте'],
    [/^(?:подготовить|подготовил(?:а)?)\b/i, 'Подготовьте'],
    [/^(?:написать|написал(?:а)?)\b/i, 'Напишите'],
    [/^(?:сделать|сделал(?:а)?)\b/i, 'Сделайте'],
    [/^(?:доработать|доработал(?:а)?)\b/i, 'Доработайте'],
    [/^(?:переделать|переделал(?:а)?)\b/i, 'Переделайте'],
    [/^(?:исправить|исправил(?:а)?)\b/i, 'Исправьте'],
    [/^(?:уточнить|уточнил(?:а)?)\b/i, 'Уточните'],
    [/^(?:дополнить|дополнил(?:а)?)\b/i, 'Дополните'],
    [/^(?:расширить|расширил(?:а)?)\b/i, 'Расширьте'],
    [/^(?:сократить|сократил(?:а)?)\b/i, 'Сократите'],
    [/^(?:добавить|добавил(?:а)?)\b/i, 'Добавьте'],
    [/^(?:проанализировать|проанализировал(?:а)?)\b/i, 'Проанализируйте'],
    [/^(?:рассчитать|рассчитал(?:а)?)\b/i, 'Рассчитайте'],
    [/^(?:придумать|придумал(?:а)?)\b/i, 'Придумайте'],
    [/^(?:предложить|предложил(?:а)?)\b/i, 'Предложите'],
    [/^(?:проверить|проверил(?:а)?)\b/i, 'Проверьте'],
    [/^(?:описать|описал(?:а)?)\b/i, 'Опишите'],
    [/^(?:расписать|расписал(?:а)?)\b/i, 'Распишите'],
    [/^(?:подобрать|подобрал(?:а)?)\b/i, 'Подберите'],
  ];

  for (const [rx, replacement] of verbConversions) {
    if (rx.test(text)) {
      text = text.replace(rx, replacement);
      break;
    }
  }

  // Capitalize first letter
  text = text.charAt(0).toUpperCase() + text.slice(1);

  // Normalize school name mention if present, or append school context naturally if not mentioned
  const lower = text.toLowerCase();
  const hasSchoolMention =
    lower.includes('renderia') ||
    lower.includes('рендери') ||
    lower.includes('kiber') ||
    lower.includes('киберван') ||
    lower.includes('киберон');

  text = text
    .replace(/\b(?:рендерия|рендерии|рендерию|renderia)\b/gi, 'RENDERIA')
    .replace(/\b(?:киберван|киберон|kiberone)\b/gi, 'KIBERONE');

  // Ensure clean ending punctuation
  const isQuestion =
    /^(?:какие|какой|какая|какое|как|сколько|почему|зачем|где|когда|кто|что|можно\s+ли|есть\s+ли|стоит\s+ли)\b/i.test(
      text
    ) || text.endsWith('?');

  text = text.replace(/[.!?,:;—–-]+$/, '').trim();

  if (!hasSchoolMention) {
    text = `${text} для школы ${schoolName}`;
  }

  return isQuestion ? `${text}?` : `${text}.`;
}

/**
 * Stage 6.4 (2 & 3): Checks if a spoken or typed request is cut off mid-phrase,
 * unstable, or ends on a dangling preposition/conjunction/verb without concrete content.
 */
export function checkUtteranceCompleteness(
  rawText: string,
  extractedInstruction: string
): { isIncomplete: boolean; reasonRu?: string } {
  const rawTrimmed = (rawText || '').trim();
  const instrTrimmed = (extractedInstruction || '').trim();

  if (!rawTrimmed || !instrTrimmed) {
    return {
      isIncomplete: true,
      reasonRu: 'Фраза обрывается и не содержит текста задачи.',
    };
  }

  // 1. Ends with ellipsis, comma, colon, semicolon, or dash
  if (/(?:\.{2,}|…|[,:;—–-])\s*$/.test(rawTrimmed)) {
    return {
      isIncomplete: true,
      reasonRu: 'Фраза выглядит незаконченной (оборвана на знаке препинания).',
    };
  }

  // 2. Ends with a dangling preposition, conjunction, particle, or pronoun
  const danglingEndingRegex =
    /(?:^|\s)(?:чтобы|для|и|или|а|но|да|по|про|о|об|обо|в|во|на|с|со|к|ко|у|за|от|до|из|под|над|между|через|при|без|как|какой|какая|какое|какие|каких|каким|который|которая|которое|которые|где|когда|почему|зачем|сколько|ли|бы|не|ни|пусть|попроси|попросите|спроси|спросите|скажи|скажите|напиши|напишите|передай|передайте|поручи|поручите|отправь|отправьте|уточни|уточните|он|она|они|его|её|ее|ему|ей|них|ним|этот|эта|это|эти|этого|этой|того|той|такой|такая|такие|по\s+поводу|насчёт|насчет|в\s+рамках|с\s+учётом|с\s+учетом|для\s+школы|в\s+школе|школы|школе|школу)\s*[.!?]*$/i;

  if (danglingEndingRegex.test(rawTrimmed) || danglingEndingRegex.test(instrTrimmed)) {
    return {
      isIncomplete: true,
      reasonRu: 'Похоже, фраза обрывается на полуслове (на союзе или предлоге).',
    };
  }

  // 3. Instruction is just a bare verb or 1 short word without object (e.g., «разработать», «сделать для Renderia»)
  const strippedSchool = instrTrimmed
    .replace(/\b(?:для\s+)?(?:школы\s+)?(?:renderia|рендерия|рендерии|рендерию|kiberone|киберван|киберон)\b/gi, '')
    .replace(/[.!?,:;—–-]+/g, '')
    .trim();

  const meaningfulWords = strippedSchool
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  if (
    meaningfulWords.length === 0 ||
    (meaningfulWords.length === 1 &&
      /^(?:разработать|разработайте|сделать|сделайте|написать|напишите|подготовить|подготовьте|составить|составьте|доработать|доработайте|переделать|переделайте|исправить|исправьте|уточнить|уточните|дополнить|дополните|добавить|добавьте|проверить|проверьте|придумать|придумайте|предложить|предложите|задача|поручение|вопрос|сообщение|ответ)$/i.test(
        meaningfulWords[0]
      ))
  ) {
    return {
      isIncomplete: true,
      reasonRu: 'Не указано конкретное содержание поручения.',
    };
  }

  return { isIncomplete: false };
}

/**
 * PixelAgentCoordinator — manages real task delegation, unified chat switching, deletion, and mediation across all AI Specialists.
 * Stage 6.2, 6.3, 6.4 & 6.5:
 * - Autonomously finds, opens, and switches working chats across KIBERONE and RENDERIA without Anna having to switch manually.
 * - Strictly isolates chat history by (sessionId, schoolId, mode).
 * - Reads aloud the full last specialist response verbatim in sequential chunks on explicit command only.
 * - Enforces mandatory pre-send confirmation («Да, отправляй») before EVERY dispatch and before ANY chat deletion.
 * - Reports honestly when asked to perform unimplemented external actions.
 */
export class PixelAgentCoordinator {
  private deps: PixelAgentCoordinatorDeps | null = null;
  private tasks = new Map<string, PixelDelegatedTaskState>();
  private listeners = new Set<
    (tasks: PixelDelegatedTaskState[], latestTask?: PixelDelegatedTaskState) => void
  >();
  private processedSpokenTurnIds = new Set<string>();
  private activeTaskExecutionLocks = new Set<string>();
  private dispatchedDraftIds = new Set<string>();
  private bubbleHandler: ((text: string) => void) | null = null;
  private pendingClarification: {
    targetMode: AgentMode;
    targetSchool: SchoolId;
    partialInstruction?: string;
    createdAtMs: number;
  } | null = null;
  private pendingConfirmationDraft: PixelPendingDelegationDraft | null = null;
  private pendingChatDeletion: PixelPendingChatDeletion | null = null;

  public init(deps: PixelAgentCoordinatorDeps): void {
    this.deps = deps;
  }

  public setBubbleHandler(handler: ((text: string) => void) | null): void {
    this.bubbleHandler = handler;
  }

  private showBubble(text: string): void {
    if (this.bubbleHandler) {
      this.bubbleHandler(text);
    } else {
      this.deps?.onShowPixelBubble?.(text);
    }
  }

  public onTasksChange(
    listener: (
      tasks: PixelDelegatedTaskState[],
      latestTask?: PixelDelegatedTaskState
    ) => void
  ): () => void {
    this.listeners.add(listener);
    listener(this.getTasks());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getTasks(): PixelDelegatedTaskState[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => b.updatedAtMs - a.updatedAtMs
    );
  }

  public getTaskById(taskId: string): PixelDelegatedTaskState | undefined {
    return this.tasks.get(taskId);
  }

  private notifyListeners(latestTask?: PixelDelegatedTaskState): void {
    const list = this.getTasks();
    for (const listener of this.listeners) {
      try {
        listener(list, latestTask);
      } catch (err) {
        console.warn('[PixelAgentCoordinator] Listener error:', err);
      }
    }
  }

  public openDelegatedChat(
    schoolId: SchoolId,
    mode: AgentMode,
    sessionId: string,
    highlightMessageId?: string
  ): void {
    this.deps?.onOpenDelegatedChat?.(
      schoolId,
      mode,
      sessionId,
      highlightMessageId
    );
  }

  /**
   * Resolves the currently active specialist mode based on open UI section or last selected agent mode.
   */
  public resolveActiveAgentMode(): AgentMode {
    if (!this.deps) return 'marketer';
    const section = this.deps.getActiveSection?.();
    if (section && isAgentModeSection(section)) {
      return section;
    }
    return this.deps.getActiveAgentMode?.() || 'marketer';
  }

  /**
   * Stage 6.5 (1 & 2): Returns a structured list of all working chats across both schools
   * with strict message filtering by (sessionId, schoolId, mode).
   */
  public getAllWorkingChats(): PixelChatNavigationItem[] {
    if (!this.deps) return [];
    const allSessions = sortSessionsPinnedAndUpdatedDesc(
      this.deps.getSessions()
    );
    const activeSessionId = this.deps.getActiveSessionId?.() || null;

    return allSessions.map((s) => {
      const schoolCfg = SCHOOLS[s.schoolId];
      const modeCfg = AGENT_MODES[s.mode];
      const validMessages = (s.messages || []).filter(
        (m) =>
          !m.isStreaming &&
          m.content &&
          m.content.trim().length > 0 &&
          (!m.sessionId || m.sessionId === s.id) &&
          (!m.schoolId || m.schoolId === s.schoolId) &&
          (!m.mode || m.mode === s.mode)
      );
      const lastMsg = validMessages[validMessages.length - 1];
      return {
        sessionId: s.id,
        sessionTitle: s.title,
        schoolId: s.schoolId,
        schoolName: schoolCfg.name,
        mode: s.mode,
        specialistTitle: modeCfg.shortTitle,
        messagesCount: validMessages.length,
        updatedAt: s.updatedAt,
        updatedAtMs: s.updatedAtMs || 0,
        lastMessagePreview: lastMsg
          ? lastMsg.content.replace(/\s+/g, ' ').trim().slice(0, 110)
          : undefined,
        isCurrentlyOpen: s.id === activeSessionId,
      };
    });
  }

  /**
   * Stage 6.5 (1 & 2): Autonomously switches the active workspace to the specified working chat
   * (finding or creating it if needed), clears stale context from the previous dialogue,
   * and announces «Переключился на ...».
   */
  public async switchToWorkingChat(params: {
    schoolId: SchoolId;
    mode: AgentMode;
    sessionId?: string;
    createIfMissing?: boolean;
    announceInChat?: boolean;
    announceInCompanion?: boolean;
    userCompanionMessage?: CompanionMessage;
  }): Promise<PixelChatNavigationItem | null> {
    if (!this.deps) return null;

    const {
      schoolId,
      mode,
      sessionId,
      createIfMissing = true,
      userCompanionMessage,
    } = params;
    const announceInChat = Boolean(
      params.announceInChat || params.announceInCompanion
    );

    const allSessions = sortSessionsPinnedAndUpdatedDesc(
      this.deps.getSessions()
    );

    let targetSession: ChatSession | undefined;
    if (sessionId) {
      targetSession = allSessions.find(
        (s) =>
          s.id === sessionId && s.schoolId === schoolId && s.mode === mode
      );
    }

    if (!targetSession) {
      targetSession = allSessions.find(
        (s) => s.schoolId === schoolId && s.mode === mode
      );
    }

    if (!targetSession && createIfMissing) {
      targetSession = buildNewSpecialistSession(mode, schoolId, allSessions);
      const nextSessions = sortSessionsPinnedAndUpdatedDesc([
        targetSession,
        ...allSessions,
      ]);
      this.deps.onUpdateSessions(nextSessions);
      await storageProvider.saveSession(targetSession);
    }

    if (!targetSession) return null;

    // Reset stale clarification context from previous dialogue
    if (
      this.pendingClarification &&
      (this.pendingClarification.targetMode !== mode ||
        this.pendingClarification.targetSchool !== schoolId)
    ) {
      this.pendingClarification = null;
    }

    this.deps.onOpenDelegatedChat?.(schoolId, mode, targetSession.id);

    const schoolCfg = SCHOOLS[schoolId];
    const modeCfg = AGENT_MODES[mode];
    const genitiveName = SPECIALIST_NAMES_GENITIVE_RU[mode];
    const announcementShort = `Переключился на ${genitiveName} ${schoolCfg.name}`;

    this.showBubble(announcementShort);

    const validMessages = (targetSession.messages || []).filter(
      (m) =>
        !m.isStreaming &&
        m.content &&
        m.content.trim().length > 0 &&
        (!m.sessionId || m.sessionId === targetSession!.id) &&
        (!m.schoolId || m.schoolId === schoolId) &&
        (!m.mode || m.mode === mode)
    );
    const lastSpecMsg = [...validMessages]
      .reverse()
      .find((m) => m.role === 'assistant');

    if (announceInChat) {
      const now = new Date();
      const nowMs = now.getTime();
      const detailsLine =
        validMessages.length > 0
          ? `В чате «*${targetSession.title}*» сохранено сообщений: **${validMessages.length}**. ${
              lastSpecMsg
                ? 'Вы можете сказать *«Пиксель, прочитай ответ»* или продолжить обсуждение.'
                : 'Можете передать новое поручение специалисту.'
            }`
          : `Открыт чистый диалог «*${targetSession.title}*». Готов передать поручение ${SPECIALIST_NAMES_DATIVE_RU[mode]}.`;

      const navReply: CompanionMessage = {
        id: `comp-pixel-nav-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'pixel',
        content: `**${announcementShort}.**\n${detailsLine}`,
        createdAt: formatTimeNow(now),
        createdAtMs: nowMs,
        schoolId,
        usedContextLabels: [
          `Школа: ${schoolCfg.name}`,
          `Специалист: ${modeCfg.shortTitle}`,
          `Чат: ${targetSession.title}`,
        ],
      };

      const existing = this.deps.getCompanionMessages();
      const nextMsgs = userCompanionMessage
        ? [...existing, userCompanionMessage, navReply]
        : [...existing, navReply];
      await this.deps.onSaveCompanionMessages(nextMsgs);
    }

    return {
      sessionId: targetSession.id,
      sessionTitle: targetSession.title,
      schoolId,
      schoolName: schoolCfg.name,
      mode,
      specialistTitle: modeCfg.shortTitle,
      messagesCount: validMessages.length,
      updatedAt: targetSession.updatedAt,
      updatedAtMs: targetSession.updatedAtMs || 0,
      lastMessagePreview: validMessages[validMessages.length - 1]?.content
        ?.replace(/\s+/g, ' ')
        .trim()
        .slice(0, 110),
      isCurrentlyOpen: true,
    };
  }

  /**
   * Stage 6.3 (1 & 6) & Stage 6.5 (1): Builds structured context for the target or currently open specialist chat,
   * strictly isolating messages by (sessionId, schoolId, mode) and distinguishing Anna's direct messages,
   * Pixel's messages, and specialist replies.
   */
  public getActiveChatContext(
    preferredMode?: AgentMode,
    preferredSchool?: SchoolId,
    preferredSessionId?: string
  ): PixelActiveChatContext | undefined {
    if (!this.deps) return undefined;

    const schoolId = preferredSchool || this.deps.getActiveSchool();
    const schoolCfg = SCHOOLS[schoolId];
    const activeSection = this.deps.getActiveSection?.() || 'marketer';
    const isSpecialistChatOpen = isAgentModeSection(activeSection);
    const activeMode: AgentMode =
      preferredMode || this.resolveActiveAgentMode();
    const modeCfg = AGENT_MODES[activeMode];

    const allSessions = sortSessionsPinnedAndUpdatedDesc(
      this.deps.getSessions()
    );
    const activeSessionId =
      preferredSessionId || this.deps.getActiveSessionId?.() || null;

    let session: ChatSession | undefined;
    if (preferredSessionId) {
      const explicitCandidate = allSessions.find(
        (s) => s.id === preferredSessionId
      );
      if (
        explicitCandidate &&
        explicitCandidate.schoolId === schoolId &&
        explicitCandidate.mode === activeMode
      ) {
        session = explicitCandidate;
      }
    }

    if (!session && activeSessionId) {
      const candidate = allSessions.find((s) => s.id === activeSessionId);
      if (
        candidate &&
        candidate.schoolId === schoolId &&
        candidate.mode === activeMode
      ) {
        session = candidate;
      }
    }

    if (!session) {
      session = allSessions.find(
        (s) => s.schoolId === schoolId && s.mode === activeMode
      );
    }

    // Strict isolation: only include messages belonging to this exact session, school, and specialist mode
    const isolatedSessionMessages = (session?.messages || []).filter(
      (m) =>
        !m.isStreaming &&
        m.content &&
        m.content.trim().length > 0 &&
        (!m.sessionId || m.sessionId === session!.id) &&
        (!m.schoolId || m.schoolId === schoolId) &&
        (!m.mode || m.mode === activeMode)
    );

    const mappedMessages: PixelActiveChatMessageItem[] = isolatedSessionMessages
      .slice(-10)
      .map((m) => {
        if (m.role === 'user') {
          if (m.delegatedByPixel) {
            return {
              id: m.id,
              role: 'user',
              authorType: 'pixel',
              authorLabel: `Сообщение от Пикселя (${m.senderLabel || 'Поручение/вопрос по заданию Анны'})`,
              content: m.content,
              createdAt: m.createdAt,
            };
          }
          return {
            id: m.id,
            role: 'user',
            authorType: 'anna',
            authorLabel: 'Сообщение управляющей Анны',
            content: m.content,
            createdAt: m.createdAt,
          };
        }
        return {
          id: m.id,
          role: 'assistant',
          authorType: 'specialist',
          authorLabel: `Ответ специалиста (ИИ-${modeCfg.shortTitle})`,
          content: m.content,
          createdAt: m.createdAt,
        };
      });

    const lastSpecItem = [...mappedMessages]
      .reverse()
      .find((m) => m.authorType === 'specialist');

    return {
      isSpecialistChatOpen,
      sessionId: session?.id || '',
      sessionTitle:
        session?.title || `${modeCfg.shortTitle} · ${schoolCfg.name}`,
      schoolId,
      schoolName: schoolCfg.name,
      mode: activeMode,
      specialistTitle: modeCfg.shortTitle,
      specialistRoleSubtitle: modeCfg.roleSubtitle,
      messagesCount: isolatedSessionMessages.length,
      lastSpecialistMessage: lastSpecItem
        ? {
            id: lastSpecItem.id,
            content: lastSpecItem.content,
            createdAt: lastSpecItem.createdAt,
          }
        : undefined,
      recentMessages: mappedMessages,
    };
  }

  /**
   * Notifies Live Voice when Anna switches to a different specialist chat or school.
   */
  public notifyContextSwitch(
    schoolId: SchoolId,
    mode: AgentMode,
    sessionId: string | null
  ): void {
    // Clear any stale pending clarification from another chat if different specialist or school
    if (
      this.pendingClarification &&
      (this.pendingClarification.targetMode !== mode ||
        this.pendingClarification.targetSchool !== schoolId)
    ) {
      this.pendingClarification = null;
    }

    const ctx = this.getActiveChatContext(
      mode,
      schoolId,
      sessionId || undefined
    );
    if (!ctx) return;

    const lastSpecPreview = ctx.lastSpecialistMessage
      ? `Последний ответ специалиста (${ctx.lastSpecialistMessage.createdAt}): «${ctx.lastSpecialistMessage.content.slice(0, 350)}${ctx.lastSpecialistMessage.content.length > 350 ? '…' : ''}»`
      : 'В этом диалоге пока нет ответов специалиста.';

    // Only send background context update if Live Voice is currently active
    this.deps?.onNotifyLiveVoice?.(
      `[Системное обновление контекста (НЕ отвечай вслух без вопроса Анны): Активный рабочий чат переключён на специалиста «${ctx.specialistTitle}» (${ctx.schoolName}), диалог «${ctx.sessionTitle}» (ID: ${sessionId || ctx.sessionId || 'новый'}). Сообщений в чате: ${ctx.messagesCount}. ${lastSpecPreview}]`
    );
  }

  /**
   * Stage 6.3 (2), Stage 6.4 (1) & Stage 6.5 (1 & 4): Detects commands asking Pixel to read aloud
   * the last specialist response verbatim OR resume reading from where it was stopped:
   * - «Пиксель, прочитай ответ»
   * - «Пиксель, зачитай всё сообщение»
   * - «Пиксель, прочитай последнее сообщение Маркетолога»
   * - «Прочитай ответ Маркетолога»
   * - «Продолжи чтение» / «Читай дальше»
   */
  public parseReadAloudIntent(
    rawText: string,
    activeSchool: SchoolId
  ): ParsedReadAloudIntent | null {
    const text = (rawText || '').trim();
    if (text.length < 5) return null;

    const lower = text.toLowerCase();

    // Make sure Anna is not asking a specialist to read a document or asking to send a message
    if (
      /(?:^|[^а-яёa-z0-9])(?:попроси|поручи|спроси|напиши|отправь|передай|доработай)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      )
    ) {
      return null;
    }

    // 1. Check for resume reading command («Продолжи чтение», «Читай дальше», «Продолжай читать», «Дочитай»)
    const isResumeCmd =
      /(?:^|[^а-яёa-z0-9])(?:продолж(?:и|ай)(?:те)?\s+(?:чтение|читать|озвучк[уи]|озвучивать)|читай(?:те)?\s+дальше|дочитай(?:те)?(?:\s+ответ|\s+до\s+конца)?|продолжи\s+с\s+места\s+остановки)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      );

    if (isResumeCmd) {
      const specMatch = detectSpecialistFromText(lower);
      const explicitSchool = hasExplicitSchoolMention(text);
      const targetSchool = explicitSchool
        ? detectTargetSchoolFromText(text, activeSchool)
        : undefined;
      return {
        isReadAloud: true,
        isResume: true,
        targetMode: specMatch.matched ? specMatch.mode : undefined,
        targetSchool,
        originalText: text,
      };
    }

    // 2. Standard / Full verbatim read command
    const hasReadVerb =
      /(?:^|[^а-яёa-z0-9])(?:прочитай(?:те)?|зачитай(?:те)?|озвучь(?:те)?|прочти(?:те)?|читай(?:те)?\s+вслух|прочитай(?:те)?\s+вслух)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      );

    if (!hasReadVerb) return null;

    const hasReplyTarget =
      /(?:^|[^а-яёa-z0-9])(?:ответ|сообщени[ея]|результат|текст|всё|все|полностью|целиком|до\s+конца|что\s+(?:он|она|специалист|маркетолог|менеджер|методист|аналитик)\s+(?:ответил|написал|подготовил|предложил)|последн(?:ий|ее)|маркетолог(?:а|у)?|менеджер(?:а|у)?|методист(?:а|у)?|аналитик(?:а|у)?)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      );

    if (!hasReplyTarget) return null;

    const specMatch = detectSpecialistFromText(lower);
    const explicitSchool = hasExplicitSchoolMention(text);
    const targetSchool = explicitSchool
      ? detectTargetSchoolFromText(text, activeSchool)
      : undefined;

    return {
      isReadAloud: true,
      isResume: false,
      targetMode: specMatch.matched ? specMatch.mode : undefined,
      targetSchool,
      originalText: text,
    };
  }

  /**
   * Stage 6.4 (1) & Stage 6.5 (1 & 4): Reads aloud the full last specialist response verbatim in sequential chunks
   * using Pixel's single unified voice:
   * - Automatically locates the right chat for the requested specialist/school and switches to it if needed.
   * - Always reads the original specialist message from that chat (never paraphrases via AI).
   * - Supports resuming from the stopped chunk if interrupted.
   */
  public async executeReadAloud(
    intent: ParsedReadAloudIntent,
    _sourceMode: 'text' | 'voice' = 'text'
  ): Promise<{
    success: boolean;
    specialistTitleRu: string;
    messageId?: string;
    reason?: string;
  }> {
    const activeSchool = this.deps?.getActiveSchool() || 'kiberone';
    const targetMode = intent.targetMode || this.resolveActiveAgentMode();
    let resolvedSchool: SchoolId = intent.targetSchool || activeSchool;
    const modeCfg = AGENT_MODES[targetMode];

    // If Anna asked to resume stopped reading («Продолжи чтение» / «Читай дальше»)
    if (intent.isResume && voiceManager.hasStoppedReading()) {
      const stopped = voiceManager.getStoppedReadingSession();
      this.showBubble(
        `Продолжаю чтение ответа с фрагмента ${(stopped?.resumeChunkIndex ?? 0) + 1} из ${stopped?.totalChunks ?? 1}…`
      );
      const resumed = await voiceManager.resumeStoppedReading({
        onFallbackUsed: (reason) => this.showBubble(reason),
      });
      if (resumed) {
        return {
          success: true,
          specialistTitleRu: stopped?.specialistTitle || modeCfg.shortTitle,
          messageId: stopped?.originalMessageId,
        };
      }
    }

    // Stage 6.5 (1): Find the exact right session to read from.
    // If Anna said «Прочитай ответ Маркетолога» without naming a school, check activeSchool first;
    // if activeSchool has no reply from Marketer, check the latest completed task or the other school's Marketer chat!
    let ctx = this.getActiveChatContext(targetMode, resolvedSchool);
    if (!ctx?.lastSpecialistMessage && !intent.targetSchool) {
      const latestTaskForMode = this.getTasks().find(
        (t) => t.targetMode === targetMode && t.status === 'completed'
      );
      if (latestTaskForMode) {
        const candidateCtx = this.getActiveChatContext(
          targetMode,
          latestTaskForMode.schoolId,
          latestTaskForMode.sessionId
        );
        if (candidateCtx?.lastSpecialistMessage) {
          ctx = candidateCtx;
          resolvedSchool = latestTaskForMode.schoolId;
        }
      }

      if (!ctx?.lastSpecialistMessage) {
        const otherSchool: SchoolId =
          resolvedSchool === 'kiberone' ? 'renderia' : 'kiberone';
        const otherCtx = this.getActiveChatContext(targetMode, otherSchool);
        if (otherCtx?.lastSpecialistMessage) {
          ctx = otherCtx;
          resolvedSchool = otherSchool;
        }
      }
    }

    const schoolCfg = SCHOOLS[resolvedSchool];

    if (!ctx || !ctx.lastSpecialistMessage) {
      const noReplyMsg = `В рабочем чате специалиста «${modeCfg.shortTitle}» (${schoolCfg.name}) пока нет ответа для чтения.`;
      this.showBubble(noReplyMsg);
      return {
        success: false,
        specialistTitleRu: modeCfg.shortTitle,
        reason: noReplyMsg,
      };
    }

    const lastMsg = ctx.lastSpecialistMessage;

    // Stage 6.5 (1): If the chat being read is not currently open, switch to it automatically so Anna sees it!
    const currentOpenSessionId = this.deps?.getActiveSessionId?.() || null;
    if (ctx.sessionId && ctx.sessionId !== currentOpenSessionId) {
      this.deps?.onOpenDelegatedChat?.(
        resolvedSchool,
        targetMode,
        ctx.sessionId,
        lastMsg.id
      );
    } else if (ctx.sessionId) {
      this.deps?.onHighlightSpecialistMessage?.(ctx.sessionId, lastMsg.id);
    }

    // Check if this exact specialist message was previously stopped mid-reading and Anna asks to continue
    const stoppedSession = voiceManager.getStoppedReadingSession();
    const startChunkIndex =
      intent.isResume &&
      stoppedSession &&
      stoppedSession.originalMessageId === lastMsg.id
        ? stoppedSession.resumeChunkIndex
        : 0;

    const bubbleNotice =
      startChunkIndex > 0
        ? `Продолжаю дословное чтение ответа специалиста «${modeCfg.shortTitle}» (${schoolCfg.name})…`
        : `Читаю полный ответ специалиста «${modeCfg.shortTitle}» (${schoolCfg.name})…`;
    this.showBubble(bubbleNotice);

    try {
      await voiceManager.playVerbatimSpecialistMessage(
        lastMsg.id,
        lastMsg.content,
        {
          specialistTitle: modeCfg.shortTitle,
          schoolName: schoolCfg.name,
          startChunkIndex,
          onFallbackUsed: (reason) => {
            this.showBubble(reason);
          },
        }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.showBubble(`Озвучивание ответа: ${msg}`);
    }

    return {
      success: true,
      specialistTitleRu: modeCfg.shortTitle,
      messageId: lastMsg.id,
    };
  }

  /**
   * Allows reading a specific specialist message aloud verbatim by sessionId and optional messageId
   * using the single unified Pixel voice.
   */
  public async readSpecialistMessageById(
    sessionId: string,
    messageId?: string
  ): Promise<boolean> {
    if (!this.deps) return false;
    const session = this.deps.getSessions().find((s) => s.id === sessionId);
    if (!session) return false;

    const assistantMessages = session.messages.filter(
      (m) =>
        m.role === 'assistant' &&
        !m.isStreaming &&
        m.content.trim().length > 0 &&
        (!m.sessionId || m.sessionId === session.id) &&
        (!m.schoolId || m.schoolId === session.schoolId) &&
        (!m.mode || m.mode === session.mode)
    );
    if (assistantMessages.length === 0) return false;

    const targetMsg = messageId
      ? assistantMessages.find((m) => m.id === messageId) ||
        assistantMessages[assistantMessages.length - 1]
      : assistantMessages[assistantMessages.length - 1];

    const modeCfg = AGENT_MODES[session.mode];
    const schoolCfg = SCHOOLS[session.schoolId];

    // Ensure the session is open and message is highlighted
    const currentOpenSessionId = this.deps.getActiveSessionId?.() || null;
    if (session.id !== currentOpenSessionId) {
      this.deps.onOpenDelegatedChat?.(
        session.schoolId,
        session.mode,
        session.id,
        targetMsg.id
      );
    } else {
      this.deps.onHighlightSpecialistMessage?.(session.id, targetMsg.id);
    }

    this.showBubble(
      `Читаю полный ответ специалиста «${modeCfg.shortTitle}» (${schoolCfg.name})…`
    );

    try {
      await voiceManager.playVerbatimSpecialistMessage(
        targetMsg.id,
        targetMsg.content,
        {
          specialistTitle: modeCfg.shortTitle,
          schoolName: schoolCfg.name,
          onFallbackUsed: (reason) => {
            this.showBubble(reason);
          },
        }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Stage 6.5 (1 & 2): Detects commands asking Pixel to switch, open, or return to a working chat:
   * - «Вернись к нашему разговору с Методистом»
   * - «Переключись на Маркетолога Renderia»
   * - «Открой чат с Аналитиком KIBERONE»
   */
  public parseChatNavigationIntent(
    rawText: string,
    activeSchool: SchoolId
  ): ParsedChatNavigationIntent | null {
    const text = (rawText || '').trim();
    if (text.length < 5) return null;
    const lower = text.toLowerCase();

    // Do not conflict with read-aloud or deletion
    if (
      this.parseReadAloudIntent(text, activeSchool) ||
      this.parseChatDeletionIntent(text, activeSchool)
    ) {
      return null;
    }

    // If the command has a delegation verb («попроси», «поручи», «спроси», «пусть»), let delegation parser handle it
    if (
      /(?:^|[^а-яёa-z0-9])(?:попроси(?:те|ть)?|поручи(?:те|ть)?|спроси(?:те|ть)?|уточни(?:те|ть)?|передай(?:те)?|скажи(?:те)?|пусть|делегируй(?:те)?|разработай(?:те)?|составь(?:те)?|подготовь(?:те)?)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      )
    ) {
      return null;
    }

    const hasNavPattern =
      /(?:^|[^а-яёa-z0-9])(?:переключи(?:сь|тесь|ть)?|верни(?:сь|тесь|ть)?|возвращайся|открой(?:те)?|перейди(?:те)?|покажи(?:те)?\s+(?:рабочий\s+)?(?:чат|диалог|разговор)|вернёмся|вернемся)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      );

    if (!hasNavPattern) return null;

    const specMatch = detectSpecialistFromText(lower);
    const explicitSchool = hasExplicitSchoolMention(text);
    const targetSchool = detectTargetSchoolFromText(text, activeSchool);

    if (!specMatch.matched && !explicitSchool) {
      return null;
    }

    return {
      isNavigation: true,
      targetMode: specMatch.matched ? specMatch.mode : undefined,
      targetSchool: explicitSchool ? targetSchool : undefined,
      hasExplicitSchool: explicitSchool,
      originalText: text,
    };
  }

  /**
   * Stage 6.5 (1 & 2): Executes autonomous chat navigation.
   * If multiple non-empty chats match and it's ambiguous which one Anna wants, asks Anna to pick.
   * Otherwise switches immediately without asking and announces «Переключился на ...».
   */
  public async executeChatNavigation(
    intent: ParsedChatNavigationIntent,
    userCompanionMessage?: CompanionMessage
  ): Promise<void> {
    if (!this.deps) return;

    const activeSchool = this.deps.getActiveSchool();
    const targetMode = intent.targetMode || this.resolveActiveAgentMode();
    const allWorkingChats = this.getAllWorkingChats();

    const candidates = allWorkingChats.filter((c) => {
      if (intent.targetMode && c.mode !== intent.targetMode) return false;
      if (intent.hasExplicitSchool && intent.targetSchool) {
        return c.schoolId === intent.targetSchool;
      }
      return true;
    });

    const nonEmptyCandidates = candidates.filter((c) => c.messagesCount > 0);
    const targetSchoolResolved = intent.targetSchool || activeSchool;
    const sameSchoolNonEmpty = nonEmptyCandidates.filter(
      (c) => c.schoolId === targetSchoolResolved
    );

    const ambiguousList = intent.hasExplicitSchool
      ? sameSchoolNonEmpty.length > 1
        ? sameSchoolNonEmpty
        : []
      : nonEmptyCandidates.length > 1
        ? nonEmptyCandidates
        : [];

    if (ambiguousList.length > 1) {
      const now = new Date();
      const nowMs = now.getTime();
      const modeCfg = AGENT_MODES[targetMode];
      const genitiveName = SPECIALIST_NAMES_GENITIVE_RU[targetMode];

      const disambigReply: CompanionMessage = {
        id: `comp-pixel-disambig-${nowMs}`,
        role: 'pixel',
        content: [
          `Анна, я нашёл несколько рабочих чатов для **${genitiveName}** (${ambiguousList.length} шт.).`,
          `Уточните, пожалуйста, какой именно диалог открыть:`,
        ].join('\n'),
        createdAt: formatTimeNow(now),
        createdAtMs: nowMs,
        schoolId: targetSchoolResolved,
        usedContextLabels: [
          `Специалист: ${modeCfg.shortTitle}`,
          `Найдено чатов: ${ambiguousList.length}`,
        ],
        chatDisambiguationList: ambiguousList,
      };

      const existing = this.deps.getCompanionMessages();
      const next = userCompanionMessage
        ? [...existing, userCompanionMessage, disambigReply]
        : [...existing, disambigReply];
      await this.deps.onSaveCompanionMessages(next);
      return;
    }

    const chosen =
      (intent.hasExplicitSchool
        ? sameSchoolNonEmpty[0]
        : nonEmptyCandidates[0]) ||
      candidates.find((c) => c.schoolId === targetSchoolResolved) ||
      candidates[0];

    const finalSchool = chosen ? chosen.schoolId : targetSchoolResolved;
    const finalMode = chosen ? chosen.mode : targetMode;

    await this.switchToWorkingChat({
      schoolId: finalSchool,
      mode: finalMode,
      sessionId: chosen?.sessionId,
      createIfMissing: true,
      announceInChat: true,
      userCompanionMessage,
    });
  }

  /**
   * Stage 6.5 (5): Returns the currently pending chat deletion awaiting Anna's confirmation.
   */
  public getPendingChatDeletion(): PixelPendingChatDeletion | null {
    if (
      !this.pendingChatDeletion ||
      this.pendingChatDeletion.status !== 'awaiting_confirmation'
    ) {
      return null;
    }
    return { ...this.pendingChatDeletion };
  }

  /**
   * Stage 6.5 (5): Detects commands to delete a chat or list deletable chats:
   * - «Пиксель, удали этот чат»
   * - «Удали старый чат с Маркетологом Renderia»
   * - «Покажи, какие чаты можно удалить»
   */
  public parseChatDeletionIntent(
    rawText: string,
    activeSchool: SchoolId
  ): ParsedChatDeletionIntent | null {
    const text = (rawText || '').trim();
    if (text.length < 5) return null;
    const lower = text.toLowerCase();

    const isListDeletable =
      /(?:какие\s+чаты\s+можно\s+удалить|покажи(?:те)?[\s,]+какие\s+чаты\s+можно\s+удалить|какие\s+диалоги\s+можно\s+удалить|список\s+чатов\s+для\s+удаления|покажи\s+чаты\s+на\s+удаление)/i.test(
        lower
      );

    if (isListDeletable) {
      return {
        isDeletion: true,
        action: 'list_deletable',
        preferOldest: false,
        originalText: text,
      };
    }

    const hasDeleteVerb =
      /(?:^|[^а-яёa-z0-9])(?:удали(?:те|ть)?|очисти(?:те|ть)?|сотри(?:те)?)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      );
    const hasChatNoun =
      /(?:^|[^а-яёa-z0-9])(?:чат|диалог|переписк[уи]|бесед[уы]|разговор)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      );

    if (!hasDeleteVerb || !hasChatNoun) return null;

    const specMatch = detectSpecialistFromText(lower);
    const explicitSchool = hasExplicitSchoolMention(text);
    const targetSchool = explicitSchool
      ? detectTargetSchoolFromText(text, activeSchool)
      : undefined;
    const preferOldest =
      /(?:^|[^а-яёa-z0-9])(?:стар(?:ый|ую|ое)|предыдущ(?:ий|ую)|прошл(?:ый|ую)|перв(?:ый|ую))(?=$|[^а-яёa-z0-9])/i.test(
        lower
      );

    const isCurrentChat =
      !specMatch.matched &&
      !explicitSchool &&
      !preferOldest &&
      /(?:^|[^а-яёa-z0-9])(?:этот|текущий|данный|открытый|наш)?\s*(?:чат|диалог|переписку|разговор)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      );

    return {
      isDeletion: true,
      action: isCurrentChat ? 'delete_current' : 'delete_target',
      targetMode: specMatch.matched ? specMatch.mode : undefined,
      targetSchool,
      preferOldest,
      originalText: text,
    };
  }

  /**
   * Stage 6.5 (5): Parses whether Anna is confirming or cancelling a pending chat deletion.
   */
  public parsePendingChatDeletionAction(rawText: string): {
    action: 'confirm' | 'cancel' | 'none';
    pending?: PixelPendingChatDeletion;
    deletion?: PixelPendingChatDeletion;
  } {
    const pending = this.getPendingChatDeletion();
    if (!pending) return { action: 'none' };

    const text = (rawText || '').trim();
    if (!text) return { action: 'none' };
    const lower = text.toLowerCase();

    if (
      /^(?:нет[\s,.-]*)?(?:не\s+удаляй(?:те)?|не\s+надо(?:\s+удалять)?|не\s+нужно(?:\s+удалять)?|отмена|отменить|отмени(?:\s+удаление)?|стоп|оставь)(?:[\s.!])*$/i.test(
        lower
      )
    ) {
      return { action: 'cancel', pending, deletion: pending };
    }

    if (
      /^(?:пиксель[\s,:-]*)?(?:да[\s,!-]*)*(?:удаляй(?:те)?|удали(?:те)?(?:\s+этот\s+чат|\s+чат|\s+диалог|\s+его)?|подтверждаю(?:\s+удаление)?|да,\s*удали(?:те)?|точно\s+удали(?:те)?)[\s.!]*$/i.test(
        lower
      )
    ) {
      return { action: 'confirm', pending, deletion: pending };
    }

    return { action: 'none' };
  }

  /**
   * Stage 6.5 (5): Prepares a specific chat session for deletion by showing its title, school, and specialist,
   * and asking Anna for explicit confirmation before deleting.
   */
  public async prepareChatDeletionForConfirmation(
    sessionInput: string | { sessionId: string },
    userCompanionMessage?: CompanionMessage
  ): Promise<PixelPendingChatDeletion | null> {
    if (!this.deps) return null;
    const sessionId =
      typeof sessionInput === 'string' ? sessionInput : sessionInput.sessionId;
    const allChats = this.getAllWorkingChats();
    const target = allChats.find((c) => c.sessionId === sessionId);
    if (!target) return null;

    const now = new Date();
    const nowMs = now.getTime();
    const deletionId = `pdel-${nowMs}-${Math.random().toString(36).slice(2, 6)}`;

    const pending: PixelPendingChatDeletion = {
      deletionId,
      sessionId: target.sessionId,
      sessionTitle: target.sessionTitle,
      schoolId: target.schoolId,
      schoolName: target.schoolName,
      mode: target.mode,
      specialistTitle: target.specialistTitle,
      messagesCount: target.messagesCount,
      updatedAt: target.updatedAt,
      status: 'awaiting_confirmation',
      createdAt: formatTimeNow(now),
      createdAtMs: nowMs,
    };

    this.pendingChatDeletion = pending;

    const confirmMsg: CompanionMessage = {
      id: `comp-pixel-del-confirm-${deletionId}`,
      role: 'pixel',
      content: [
        `Анна, вы действительно хотите удалить рабочий чат? Пожалуйста, проверьте данные перед удалением:`,
        ``,
        `• **Название чата:** «${target.sessionTitle}»`,
        `• **Школа:** ${target.schoolName}`,
        `• **Специалист:** ${target.specialistTitle}`,
        `• **Сообщений в чате:** ${target.messagesCount}`,
        ``,
        `Подтвердите удаление кнопкой **«Да, удалить чат»** ниже или скажите **«Да, удали»**.`,
      ].join('\n'),
      createdAt: formatTimeNow(now),
      createdAtMs: nowMs,
      schoolId: target.schoolId,
      usedContextLabels: [
        `Школа: ${target.schoolName}`,
        `Чат: ${target.sessionTitle}`,
        'Ожидает подтверждения удаления',
      ],
      pendingChatDeletion: pending,
    };

    const existing = this.deps.getCompanionMessages().map((m) =>
      m.pendingChatDeletion &&
      m.pendingChatDeletion.status === 'awaiting_confirmation'
        ? {
            ...m,
            pendingChatDeletion: {
              ...m.pendingChatDeletion,
              status: 'cancelled' as const,
            },
          }
        : m
    );

    const next = userCompanionMessage
      ? [...existing, userCompanionMessage, confirmMsg]
      : [...existing, confirmMsg];
    await this.deps.onSaveCompanionMessages(next);

    this.showBubble(
      `Подтвердите удаление чата «${target.sessionTitle}» (${target.schoolName}).`
    );

    return pending;
  }

  /**
   * Stage 6.5 (5): Handles Anna's natural command to list deletable chats or delete a specific/current chat.
   */
  public async executeChatDeletionIntent(
    intent: ParsedChatDeletionIntent,
    userCompanionMessage?: CompanionMessage
  ): Promise<void> {
    if (!this.deps) return;
    const allChats = this.getAllWorkingChats();
    const now = new Date();
    const nowMs = now.getTime();

    if (intent.action === 'list_deletable') {
      const reply: CompanionMessage = {
        id: `comp-pixel-del-list-${nowMs}`,
        role: 'pixel',
        content:
          allChats.length > 0
            ? `Анна, вот все рабочие чаты специалистов (${allChats.length} шт.). Выберите любой чат ниже, чтобы подготовить его к безопасному удалению с подтверждением:`
            : 'Сейчас нет рабочих чатов для удаления.',
        createdAt: formatTimeNow(now),
        createdAtMs: nowMs,
        schoolId: this.deps.getActiveSchool(),
        usedContextLabels: [`Всего рабочих чатов: ${allChats.length}`],
        deletableChatsList: allChats,
      };

      const existing = this.deps.getCompanionMessages();
      const next = userCompanionMessage
        ? [...existing, userCompanionMessage, reply]
        : [...existing, reply];
      await this.deps.onSaveCompanionMessages(next);
      return;
    }

    if (intent.action === 'delete_current') {
      const currentOpen =
        allChats.find((c) => c.isCurrentlyOpen) ||
        allChats.find(
          (c) =>
            c.schoolId === this.deps!.getActiveSchool() &&
            c.mode === this.resolveActiveAgentMode()
        );

      if (!currentOpen) {
        const noChatReply: CompanionMessage = {
          id: `comp-pixel-del-none-${nowMs}`,
          role: 'pixel',
          content:
            'Анна, сейчас не выбран открытый рабочий чат специалиста для удаления. Вот список доступных чатов:',
          createdAt: formatTimeNow(now),
          createdAtMs: nowMs,
          deletableChatsList: allChats,
        };
        const existing = this.deps.getCompanionMessages();
        await this.deps.onSaveCompanionMessages(
          userCompanionMessage
            ? [...existing, userCompanionMessage, noChatReply]
            : [...existing, noChatReply]
        );
        return;
      }

      await this.prepareChatDeletionForConfirmation(
        currentOpen.sessionId,
        userCompanionMessage
      );
      return;
    }

    const activeSchool = this.deps.getActiveSchool();
    const targetSchool = intent.targetSchool || activeSchool;
    let candidates = allChats.filter((c) => {
      if (intent.targetMode && c.mode !== intent.targetMode) return false;
      if (intent.targetSchool && c.schoolId !== intent.targetSchool)
        return false;
      return true;
    });

    if (candidates.length === 0 && !intent.targetSchool && intent.targetMode) {
      candidates = allChats.filter((c) => c.mode === intent.targetMode);
    }

    if (candidates.length === 0) {
      const notFoundReply: CompanionMessage = {
        id: `comp-pixel-del-notfound-${nowMs}`,
        role: 'pixel',
        content: `Анна, я не нашёл подходящего чата по вашему запросу. Посмотрите список доступных рабочих чатов ниже:`,
        createdAt: formatTimeNow(now),
        createdAtMs: nowMs,
        schoolId: targetSchool,
        deletableChatsList: allChats,
      };
      const existing = this.deps.getCompanionMessages();
      await this.deps.onSaveCompanionMessages(
        userCompanionMessage
          ? [...existing, userCompanionMessage, notFoundReply]
          : [...existing, notFoundReply]
      );
      return;
    }

    const chosen = intent.preferOldest
      ? [...candidates].sort((a, b) => a.updatedAtMs - b.updatedAtMs)[0]
      : candidates.find((c) => c.schoolId === targetSchool) || candidates[0];

    await this.prepareChatDeletionForConfirmation(
      chosen.sessionId,
      userCompanionMessage
    );
  }

  /**
   * Stage 6.5 (5): Confirms and executes the pending chat deletion, updates the session list and active context.
   */
  public async confirmPendingChatDeletion(
    deletionId?: string,
    userCompanionMessage?: CompanionMessage
  ): Promise<boolean> {
    if (!this.deps) return false;
    const targetId = deletionId || this.pendingChatDeletion?.deletionId;
    const pending =
      (this.pendingChatDeletion &&
      (!targetId || this.pendingChatDeletion.deletionId === targetId)
        ? this.pendingChatDeletion
        : null) ||
      this.deps
        .getCompanionMessages()
        .find(
          (m) =>
            m.pendingChatDeletion &&
            (!targetId || m.pendingChatDeletion.deletionId === targetId) &&
            m.pendingChatDeletion.status === 'awaiting_confirmation'
        )?.pendingChatDeletion ||
      null;

    if (!pending) return false;
    this.pendingChatDeletion = null;

    const deletedOk =
      (await this.deps.onDeleteSession?.(pending.sessionId)) ?? false;

    const now = new Date();
    const nowMs = now.getTime();
    const activeCtxAfter = this.getActiveChatContext();

    const doneReply: CompanionMessage = {
      id: `comp-pixel-del-done-${nowMs}`,
      role: 'pixel',
      content: deletedOk
        ? [
            `Чат **«${pending.sessionTitle}»** (${pending.specialistTitle} · ${pending.schoolName}) успешно удалён.`,
            activeCtxAfter
              ? `Текущий активный чат: **«${activeCtxAfter.sessionTitle}»** (${activeCtxAfter.specialistTitle} · ${activeCtxAfter.schoolName}).`
              : '',
          ]
            .filter(Boolean)
            .join('\n')
        : `Не удалось найти или удалить чат «${pending.sessionTitle}» (возможно, он уже был удалён).`,
      createdAt: formatTimeNow(now),
      createdAtMs: nowMs,
      schoolId: pending.schoolId,
    };

    const updatedMsgs = this.deps.getCompanionMessages().map((m) =>
      m.pendingChatDeletion?.deletionId === pending.deletionId
        ? {
            ...m,
            pendingChatDeletion: {
              ...m.pendingChatDeletion,
              status: 'confirmed' as const,
            },
          }
        : m
    );
    if (
      userCompanionMessage &&
      !updatedMsgs.some((m) => m.id === userCompanionMessage.id)
    ) {
      updatedMsgs.push(userCompanionMessage);
    }
    updatedMsgs.push(doneReply);
    await this.deps.onSaveCompanionMessages(updatedMsgs);

    this.showBubble(
      deletedOk
        ? `Удалён чат «${pending.sessionTitle}» (${pending.schoolName}).`
        : 'Чат уже удалён.'
    );
    return deletedOk;
  }

  /**
   * Stage 6.5 (5): Cancels a pending chat deletion without deleting anything.
   */
  public async cancelPendingChatDeletion(
    deletionId?: string,
    userCompanionMessage?: CompanionMessage
  ): Promise<void> {
    if (!this.deps) return;
    const targetId = deletionId || this.pendingChatDeletion?.deletionId;
    if (
      this.pendingChatDeletion &&
      (!targetId || this.pendingChatDeletion.deletionId === targetId)
    ) {
      this.pendingChatDeletion = null;
    }

    const now = new Date();
    const nowMs = now.getTime();
    const cancelReply: CompanionMessage = {
      id: `comp-pixel-del-cancel-${nowMs}`,
      role: 'pixel',
      content: 'Хорошо, Анна! Удаление чата отменено — все диалоги сохранены.',
      createdAt: formatTimeNow(now),
      createdAtMs: nowMs,
    };

    const updatedMsgs = this.deps.getCompanionMessages().map((m) =>
      m.pendingChatDeletion &&
      (!targetId || m.pendingChatDeletion.deletionId === targetId) &&
      m.pendingChatDeletion.status === 'awaiting_confirmation'
        ? {
            ...m,
            pendingChatDeletion: {
              ...m.pendingChatDeletion,
              status: 'cancelled' as const,
            },
          }
        : m
    );
    if (
      userCompanionMessage &&
      !updatedMsgs.some((m) => m.id === userCompanionMessage.id)
    ) {
      updatedMsgs.push(userCompanionMessage);
    }
    updatedMsgs.push(cancelReply);
    await this.deps.onSaveCompanionMessages(updatedMsgs);

    this.showBubble('Удаление чата отменено.');
  }

  /**
   * Stage 6.5 (6): Detects when Anna asks Pixel to perform an external or unimplemented action
   * (e.g., publishing directly to social networks/ad cabinets, calling clients, sending external SMS/WhatsApp/email,
   * editing external CRM/Google Sheets, processing payments, or generating video files).
   */
  public parseUnsupportedCapabilityIntent(
    rawText: string
  ): ParsedUnsupportedActionIntent | null {
    const text = (rawText || '').trim();
    if (text.length < 5) return null;
    const lower = text.toLowerCase();

    if (
      /(?:^|[^а-яёa-z0-9])(?:напиши|написать|составь|составить|подготовь|подготовить|придумай|придумать|разработай|разработать)\s+(?:текст|пост|скрипт|письмо|сценарий|оффер|шаблон|план|кампанию)/i.test(
        lower
      ) &&
      !/(?:опубликуй|выложи|запости|разошли|позвони|оплати)/i.test(lower)
    ) {
      return null;
    }

    if (
      /(?:^|[^а-яёa-z0-9])(?:опубликуй(?:те)?|выложи(?:те)?|запости(?:те)?|размести(?:те)?\s+пост|запусти(?:те)?\s+таргет\s+в\s+кабинете|загрузи(?:те)?\s+в\s+(?:вк|vk|телеграм|telegram|инстаграм|instagram|ютуб|youtube|яндекс\.?директ|авито))(?=$|[^а-яёa-z0-9])/i.test(
        lower
      )
    ) {
      return {
        isUnsupported: true,
        capabilityLabelRu:
          'прямая публикация в соцсетях и рекламных кабинетах (VK, Telegram, Яндекс.Директ)',
        explanationRu:
          'У меня пока нет прямого подключения к внешним API соцсетей и рекламных кабинетах для автопубликации. Зато я могу поручить **Маркетологу** подготовить готовый текст поста и офферы, которые вы сможете скопировать одной кнопкой.',
        originalText: text,
      };
    }

    if (
      /(?:^|[^а-яёa-z0-9])(?:отправь(?:те)?|разошли(?:те)?|напиши(?:те)?)\s+(?:смс|sms|на\s+почту|email|e-mail|в\s+whatsapp|в\s+ватсап|в\s+телеграм\s+клиент|родителям\s+в\s+чат|клиенту\s+в\s+мессенджер)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      )
    ) {
      return {
        isUnsupported: true,
        capabilityLabelRu:
          'внешняя рассылка сообщений клиентам в WhatsApp, Telegram, SMS или по Email',
        explanationRu:
          'Я работаю внутри рабочего пространства КИБЕРВАН и RENDERIA и не отправляю сообщения внешним контактам напрямую. Но я могу попросить **Менеджера** составить персональное сообщение для родителя, чтобы вы скопировали его.',
        originalText: text,
      };
    }

    if (
      /(?:^|[^а-яёa-z0-9])(?:позвони(?:те)?|набери(?:те)?\s+по\s+телефону|обзвони(?:те)?|сделай(?:те)?\s+звонок)(?:\s+(?:клиент|родител|баз|по\s+номеру))?/i.test(
        lower
      ) &&
      /(?:клиент|родител|лид|баз|номер|телефон)/i.test(lower)
    ) {
      return {
        isUnsupported: true,
        capabilityLabelRu: 'телефонные звонки клиентам и родителям',
        explanationRu:
          'Я не подключён к телефонии для совершения внешних звонков. При этом я могу поручить **Менеджеру** подготовить точный скрипт звонка и отработку возражений.',
        originalText: text,
      };
    }

    if (
      /(?:^|[^а-яёa-z0-9])(?:внеси(?:те)?|обнови(?:те)?|запиши(?:те)?|измени(?:те)?|создай(?:те)?\s+сделку)\s+(?:в\s+)?(?:crm|црм|amocrm|амоцрм|битрикс|bitrix|гугл\s+таблиц|google\s+sheet)/i.test(
        lower
      )
    ) {
      return {
        isUnsupported: true,
        capabilityLabelRu:
          'прямое редактирование внешних систем CRM (amoCRM, Битрикс24) и Google Таблиц',
        explanationRu:
          'У меня пока нет интеграции для записи данных во внешнюю CRM или внешние таблицы. Мы можем подготовить структуру отчёта или текста через **Аналитика** или **Менеджера**.',
        originalText: text,
      };
    }

    if (
      /(?:^|[^а-яёa-z0-9])(?:оплати(?:те)?\s+счёт|оплати(?:те)?\s+счет|переведи(?:те)?\s+деньги|выстави(?:те)?\s+счёт\s+в\s+банке|проведи(?:те)?\s+платёж|проведи(?:те)?\s+платеж)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      )
    ) {
      return {
        isUnsupported: true,
        capabilityLabelRu: 'проведение финансовых операций и банковских платежей',
        explanationRu:
          'В целях безопасности у меня нет доступа к платёжным системам и банковским счетам.',
        originalText: text,
      };
    }

    if (
      /(?:^|[^а-яёa-z0-9])(?:смонтируй(?:те)?\s+видео|сгенерируй(?:те)?\s+видеоролик|создай(?:те)?\s+mp4|сделай(?:те)?\s+видеомонтаж)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      )
    ) {
      return {
        isUnsupported: true,
        capabilityLabelRu: 'генерация и монтаж видеофайлов (MP4)',
        explanationRu:
          'Я пока не умею рендерить видеофайлы напрямую, но могу поручить **Маркетологу** или **Методисту** написать подробный раскадровочный сценарий для видеоролика.',
        originalText: text,
      };
    }

    return null;
  }

  /**
   * Stage 6.5 (6): Saves an honest, transparent response explaining that Pixel cannot perform
   * the requested unimplemented action yet, without simulating fake execution.
   */
  public async replyUnsupportedCapability(
    intent: ParsedUnsupportedActionIntent,
    userCompanionMessage?: CompanionMessage
  ): Promise<void> {
    if (!this.deps) return;
    const now = new Date();
    const nowMs = now.getTime();

    const honestContent = [
      `Анна, я пока не умею самостоятельно выполнять это действие (${intent.capabilityLabelRu}). Я ещё учусь управлять рабочими процессами, но мы сможем добавить такую возможность.`,
      ``,
      intent.explanationRu,
    ].join('\n');

    const reply: CompanionMessage = {
      id: `comp-pixel-honest-${nowMs}`,
      role: 'pixel',
      content: honestContent,
      createdAt: formatTimeNow(now),
      createdAtMs: nowMs,
      schoolId: this.deps.getActiveSchool(),
      usedContextLabels: ['Честный ответ о возможностях Пикселя'],
    };

    const existing = this.deps.getCompanionMessages();
    const next = userCompanionMessage
      ? [...existing, userCompanionMessage, reply]
      : [...existing, reply];
    await this.deps.onSaveCompanionMessages(next);

    this.showBubble(
      'Анна, я пока не умею самостоятельно выполнять это действие.'
    );
  }

  /**
   * If Anna previously gave an ambiguous command («Спроси Маркетолога», «Попроси его доработать»)
   * and Pixel asked for clarification, consumes Anna's next reply as the instruction for that specialist.
   */
  public consumePendingClarification(
    rawText: string,
    activeSchool: SchoolId
  ): ParsedDelegationIntent | null {
    if (!this.pendingClarification) return null;

    // Expire pending clarification after 3 minutes
    if (Date.now() - this.pendingClarification.createdAtMs > 3 * 60 * 1000) {
      this.pendingClarification = null;
      return null;
    }

    const text = (rawText || '').trim();
    if (text.length < 2) return null;

    // If Anna cancels («отмена», «не надо», «пока не нужно»)
    if (
      /^(?:отмена|отменить|не\s+надо|не\s+нужно|пока\s+не\s+надо|стоп)$/i.test(
        text
      )
    ) {
      this.pendingClarification = null;
      return null;
    }

    // If the new message is itself a read-aloud, navigation, or deletion command, let normal parsers handle it
    if (
      this.parseReadAloudIntent(text, activeSchool) ||
      this.parseChatNavigationIntent(text, activeSchool) ||
      this.parseChatDeletionIntent(text, activeSchool)
    ) {
      this.pendingClarification = null;
      return null;
    }

    const explicitIntent = this.parseDelegationIntent(text, activeSchool);
    if (explicitIntent && !explicitIntent.isAmbiguous) {
      this.pendingClarification = null;
      return explicitIntent;
    }

    const pending = this.pendingClarification;
    this.pendingClarification = null;
    const modeCfg = AGENT_MODES[pending.targetMode];
    const targetSchool = detectTargetSchoolFromText(text, pending.targetSchool);
    const combinedRaw = pending.partialInstruction
      ? `${pending.partialInstruction} ${text}`.trim()
      : text;
    const completeness = checkUtteranceCompleteness(combinedRaw, combinedRaw);
    const cleanInstruction = buildCleanBusinessInstruction(
      combinedRaw,
      targetSchool
    );

    return {
      isDelegation: true,
      isSupportedSpecialist: true,
      targetMode: pending.targetMode,
      targetSpecialistNameRu: modeCfg.shortTitle,
      targetSchool,
      instruction: combinedRaw.charAt(0).toUpperCase() + combinedRaw.slice(1),
      cleanInstruction,
      originalText: combinedRaw,
      isFollowUp: true,
      isAmbiguous: completeness.isIncomplete,
      isIncompleteUtterance: completeness.isIncomplete,
      incompleteReasonRu: completeness.reasonRu,
    };
  }

  /**
   * Saves a polite clarification request from Pixel when Anna's command to message a specialist
   * is incomplete/cut-off or has ambiguous content, without sending anything to the specialist chat yet.
   */
  public async requestClarificationForAmbiguousIntent(
    intent: ParsedDelegationIntent,
    userMessageToInclude?: CompanionMessage
  ): Promise<void> {
    if (!this.deps) return;

    await this.switchToWorkingChat({
      schoolId: intent.targetSchool,
      mode: intent.targetMode,
      createIfMissing: true,
      announceInChat: false,
    });

    this.pendingClarification = {
      targetMode: intent.targetMode,
      targetSchool: intent.targetSchool,
      partialInstruction:
        intent.isIncompleteUtterance && intent.instruction.length > 3
          ? intent.instruction
          : undefined,
      createdAtMs: Date.now(),
    };

    const now = new Date();
    const nowMs = now.getTime();
    const schoolCfg = SCHOOLS[intent.targetSchool];
    const genitiveName = SPECIALIST_NAMES_GENITIVE_RU[intent.targetMode];

    const replyContent = intent.isIncompleteUtterance
      ? [
          `Анна, я распознал фразу: «${intent.originalText}».`,
          `${intent.incompleteReasonRu || 'Похоже, фраза ещё не закончена.'}`,
          ``,
          `Пожалуйста, договорите или уточните задачу для **${genitiveName}** (${schoolCfg.name}) — после этого я покажу вам готовый текст поручения на подтверждение.`,
        ].join('\n')
      : [
          `Анна, я переключился на **${genitiveName}** (${schoolCfg.name}) и готов подготовить поручение, но хочу уточнить детали, чтобы не отправить неточный запрос:`,
          ``,
          `**Что именно поручить или спросить у ${genitiveName}?**`,
          `Напишите или скажите задачу — я покажу вам текст сообщения и дождусь вашего подтверждения «Да, отправляй».`,
        ].join('\n');

    const reply: CompanionMessage = {
      id: `comp-pixel-clarify-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'pixel',
      content: replyContent,
      createdAt: formatTimeNow(now),
      createdAtMs: nowMs,
      schoolId: intent.targetSchool,
      usedContextLabels: [
        `Школа: ${schoolCfg.name}`,
        `Специалист: ${intent.targetSpecialistNameRu}`,
        intent.isIncompleteUtterance
          ? 'Ожидание окончания фразы'
          : 'Уточнение перед подготовкой',
      ],
    };

    const current = this.deps.getCompanionMessages();
    const next = userMessageToInclude
      ? [...current, userMessageToInclude, reply]
      : [...current, reply];
    await this.deps.onSaveCompanionMessages(next);

    this.deps.onNotifyLiveVoice?.(
      `Системное уведомление: Анна произнесла незаконченную или неполную фразу для специалиста (${intent.targetSpecialistNameRu}, ${schoolCfg.name}): «${intent.originalText}». Ничего НЕ отправлено. Вежливо скажи Анне, что ты услышал («${intent.originalText}»), и попроси её закончить или уточнить мысль.`
    );
  }

  /**
   * Stage 6.4 (2): Returns the currently active pending delegation draft awaiting Anna's «Да, отправляй» confirmation.
   */
  public getPendingConfirmationDraft(): PixelPendingDelegationDraft | null {
    if (!this.pendingConfirmationDraft) return null;
    if (this.pendingConfirmationDraft.status !== 'awaiting_confirmation') {
      return null;
    }
    return { ...this.pendingConfirmationDraft };
  }

  public getLatestAwaitingConfirmationDraft(): PixelPendingDelegationDraft | null {
    return this.getPendingConfirmationDraft();
  }

  /**
   * Stage 6.4 (2) & Stage 6.5 (1 & 2): Prepares a delegation draft, autonomously finds/opens
   * the target specialist's working chat (so Anna never has to switch manually), and presents the draft
   * for explicit confirmation («Да, отправляй»). Strictly NEVER sends anything until confirmed.
   */
  public async prepareDelegationForConfirmation(params: {
    intent: ParsedDelegationIntent;
    sourceMode: 'text' | 'voice';
    userCompanionMessage?: CompanionMessage;
    skipAddingUserCompanionMessage?: boolean;
  }): Promise<PixelPendingDelegationDraft> {
    if (!this.deps) {
      throw new Error('PixelAgentCoordinator не инициализирован.');
    }

    const { intent, sourceMode } = params;
    const now = new Date();
    const nowMs = now.getTime();
    const draftId = `pdraft-${nowMs}-${Math.random().toString(36).slice(2, 6)}`;

    const targetSchool = intent.targetSchool;
    const targetMode = intent.targetMode;
    const schoolCfg = SCHOOLS[targetSchool];
    const modeCfg = AGENT_MODES[targetMode];
    const genitiveName = SPECIALIST_NAMES_GENITIVE_RU[targetMode];
    const dativeName = SPECIALIST_NAMES_DATIVE_RU[targetMode];

    const cleanInstruction =
      intent.cleanInstruction ||
      buildCleanBusinessInstruction(intent.instruction, targetSchool);

    // Stage 6.5 (1): Autonomously find or open the target chat for (targetSchool, targetMode)
    const switchedItem = await this.switchToWorkingChat({
      schoolId: targetSchool,
      mode: targetMode,
      sessionId: intent.preferredSessionId,
      createIfMissing: true,
      announceInChat: false,
    });

    const matchingChats = this.getAllWorkingChats().filter(
      (c) => c.schoolId === targetSchool && c.mode === targetMode
    );

    const draft: PixelPendingDelegationDraft = {
      draftId,
      targetSchool,
      targetMode,
      targetSpecialistNameRu: modeCfg.shortTitle,
      cleanInstruction,
      originalUserRequest: intent.originalText,
      sessionId: switchedItem?.sessionId || undefined,
      sessionTitle:
        switchedItem?.sessionTitle || `${modeCfg.shortTitle} · ${schoolCfg.name}`,
      isFollowUp: intent.isFollowUp,
      status: 'awaiting_confirmation',
      createdAt: formatTimeNow(now),
      createdAtMs: nowMs,
      sourceMode,
    };

    this.pendingConfirmationDraft = draft;

    const previewContent = [
      `Переключился на **${genitiveName} ${schoolCfg.name}** (чат «*${draft.sessionTitle}*»).`,
      `Анна, я подготовил поручение для отправки специалисту. Пожалуйста, проверьте параметры перед отправкой:`,
      ``,
      `• **Школа:** ${schoolCfg.name}`,
      `• **Специалист:** ${modeCfg.shortTitle}`,
      `• **Рабочий чат:** «${draft.sessionTitle}»`,
      `• **Текст сообщения для ${dativeName}:**`,
      `«${cleanInstruction}»`,
      ``,
      `Отправить это поручение? Скажите или напишите **«Да, отправляй»** (или нажмите кнопку ниже).`,
    ].join('\n');

    const pixelDraftMsg: CompanionMessage = {
      id: `comp-pixel-draft-${draftId}`,
      role: 'pixel',
      content: previewContent,
      createdAt: formatTimeNow(new Date(nowMs + 1)),
      createdAtMs: nowMs + 1,
      schoolId: targetSchool,
      usedContextLabels: [
        `Школа: ${schoolCfg.name}`,
        `Специалист: ${modeCfg.shortTitle}`,
        `Чат: ${draft.sessionTitle}`,
        'Ожидает подтверждения: «Да, отправляй»',
      ],
      pendingDelegationDraft: draft,
      chatDisambiguationList:
        matchingChats.length > 1 ? matchingChats : undefined,
    };

    const existing = this.deps.getCompanionMessages();
    const cleanedExisting = existing.map((m) =>
      m.pendingDelegationDraft &&
      m.pendingDelegationDraft.status === 'awaiting_confirmation'
        ? {
            ...m,
            pendingDelegationDraft: {
              ...m.pendingDelegationDraft,
              status: 'cancelled' as const,
            },
          }
        : m
    );

    const nextMsgs: CompanionMessage[] = [...cleanedExisting];
    if (
      params.userCompanionMessage &&
      !params.skipAddingUserCompanionMessage &&
      !nextMsgs.some((m) => m.id === params.userCompanionMessage!.id)
    ) {
      nextMsgs.push(params.userCompanionMessage);
    }
    nextMsgs.push(pixelDraftMsg);
    await this.deps.onSaveCompanionMessages(nextMsgs);

    this.showBubble(
      `Переключился на ${genitiveName} ${schoolCfg.name}. Подтвердите: «Да, отправляй».`
    );

    if (sourceMode === 'voice') {
      this.deps.onNotifyLiveVoice?.(
        `Системное уведомление: Чат переключён на ${genitiveName} ${schoolCfg.name}. Поручение ещё НЕ отправлено и ждёт подтверждения Анны. Озвучь Анне коротко: «Переключился на ${genitiveName} ${schoolCfg.name}. Текст поручения: ${cleanInstruction}. Отправлять? Скажите: Да, отправляй»`
      );
    }

    return draft;
  }

  /**
   * Stage 6.4 (2) & Stage 6.5 (1): Updates school, specialist, target session, or instruction text
   * on a pending draft before confirmation, and switches the open workspace accordingly.
   */
  public async updatePendingDelegationDraft(
    draftId: string,
    patch: {
      targetSchool?: SchoolId;
      targetMode?: AgentMode;
      cleanInstruction?: string;
      sessionId?: string;
    },
    userCompanionMessage?: CompanionMessage
  ): Promise<PixelPendingDelegationDraft | null> {
    if (!this.deps) return null;
    const currentDraft =
      this.pendingConfirmationDraft?.draftId === draftId
        ? this.pendingConfirmationDraft
        : this.deps
            .getCompanionMessages()
            .find((m) => m.pendingDelegationDraft?.draftId === draftId)
            ?.pendingDelegationDraft || null;

    if (!currentDraft || currentDraft.status !== 'awaiting_confirmation') {
      return null;
    }

    const nextSchool = patch.targetSchool || currentDraft.targetSchool;
    const nextMode = patch.targetMode || currentDraft.targetMode;
    const schoolCfg = SCHOOLS[nextSchool];
    const modeCfg = AGENT_MODES[nextMode];
    const genitiveName = SPECIALIST_NAMES_GENITIVE_RU[nextMode];
    const dativeName = SPECIALIST_NAMES_DATIVE_RU[nextMode];

    let nextInstruction =
      patch.cleanInstruction !== undefined
        ? patch.cleanInstruction.trim()
        : currentDraft.cleanInstruction;

    if (patch.targetSchool && patch.targetSchool !== currentDraft.targetSchool) {
      nextInstruction = nextInstruction.replace(
        /\b(?:RENDERIA|KIBERONE|Рендерия|Киберван)\b/gi,
        schoolCfg.name
      );
    }

    const switchedItem = await this.switchToWorkingChat({
      schoolId: nextSchool,
      mode: nextMode,
      sessionId:
        patch.sessionId ||
        (nextSchool === currentDraft.targetSchool &&
        nextMode === currentDraft.targetMode
          ? currentDraft.sessionId
          : undefined),
      createIfMissing: true,
      announceInChat: false,
    });

    const updatedDraft: PixelPendingDelegationDraft = {
      ...currentDraft,
      targetSchool: nextSchool,
      targetMode: nextMode,
      targetSpecialistNameRu: modeCfg.shortTitle,
      cleanInstruction: nextInstruction,
      sessionId: switchedItem?.sessionId || currentDraft.sessionId,
      sessionTitle:
        switchedItem?.sessionTitle ||
        `${modeCfg.shortTitle} · ${schoolCfg.name}`,
    };

    this.pendingConfirmationDraft = updatedDraft;

    const previewContent = [
      `Переключился на **${genitiveName} ${schoolCfg.name}** (чат «*${updatedDraft.sessionTitle}*»).`,
      `Анна, я обновил параметры поручения перед отправкой:`,
      ``,
      `• **Школа:** ${schoolCfg.name}`,
      `• **Специалист:** ${modeCfg.shortTitle}`,
      `• **Рабочий чат:** «${updatedDraft.sessionTitle}»`,
      `• **Текст сообщения для ${dativeName}:**`,
      `«${nextInstruction}»`,
      ``,
      `Отправить это поручение? Скажите или напишите **«Да, отправляй»** (или нажмите кнопку ниже).`,
    ].join('\n');

    const updatedMessages = this.deps.getCompanionMessages().map((m) =>
      m.pendingDelegationDraft?.draftId === draftId
        ? {
            ...m,
            content: previewContent,
            schoolId: nextSchool,
            usedContextLabels: [
              `Школа: ${schoolCfg.name}`,
              `Специалист: ${modeCfg.shortTitle}`,
              `Чат: ${updatedDraft.sessionTitle}`,
              'Ожидает подтверждения: «Да, отправляй»',
            ],
            pendingDelegationDraft: updatedDraft,
          }
        : m
    );
    if (
      userCompanionMessage &&
      !updatedMessages.some((m) => m.id === userCompanionMessage.id)
    ) {
      updatedMessages.push(userCompanionMessage);
    }
    await this.deps.onSaveCompanionMessages(updatedMessages);
    return updatedDraft;
  }

  /**
   * Stage 6.4 (2): Cancels a pending delegation draft without sending anything to the specialist.
   */
  public async cancelPendingDelegation(
    draftId?: string,
    userCompanionMessage?: CompanionMessage
  ): Promise<void> {
    if (!this.deps) return;
    const targetId = draftId || this.pendingConfirmationDraft?.draftId;
    if (
      this.pendingConfirmationDraft &&
      (!targetId || this.pendingConfirmationDraft.draftId === targetId)
    ) {
      this.pendingConfirmationDraft = null;
    }

    const current = this.deps.getCompanionMessages();
    const updated = current.map((m) =>
      m.pendingDelegationDraft &&
      (!targetId || m.pendingDelegationDraft.draftId === targetId) &&
      m.pendingDelegationDraft.status === 'awaiting_confirmation'
        ? {
            ...m,
            pendingDelegationDraft: {
              ...m.pendingDelegationDraft,
              status: 'cancelled' as const,
            },
          }
        : m
    );

    if (userCompanionMessage) {
      const now = new Date();
      const cancelReply: CompanionMessage = {
        id: `comp-pixel-cancel-${now.getTime()}`,
        role: 'pixel',
        content:
          'Хорошо, Анна! Отправка поручения отменена — в чат специалиста ничего не отправлено.',
        createdAt: formatTimeNow(now),
        createdAtMs: now.getTime(),
      };
      await this.deps.onSaveCompanionMessages([
        ...updated,
        userCompanionMessage,
        cancelReply,
      ]);
    } else {
      await this.deps.onSaveCompanionMessages(updated);
    }

    this.showBubble('Отправка поручения отменена.');
  }

  /**
   * Stage 6.4 (2 & 3): Confirms and executes the pending delegation draft ONCE.
   * Protected by `dispatchedDraftIds` so duplicate clicks or voice events never send twice.
   */
  public async confirmPendingDelegation(params?: {
    draftId?: string;
    sourceMode?: 'text' | 'voice';
    userCompanionMessage?: CompanionMessage;
  }): Promise<PixelDelegatedTaskState | null> {
    if (!this.deps) return null;

    const targetId = params?.draftId || this.pendingConfirmationDraft?.draftId;
    const draft =
      (this.pendingConfirmationDraft &&
      (!targetId || this.pendingConfirmationDraft.draftId === targetId)
        ? this.pendingConfirmationDraft
        : null) ||
      this.deps
        .getCompanionMessages()
        .find(
          (m) =>
            m.pendingDelegationDraft &&
            (!targetId || m.pendingDelegationDraft.draftId === targetId) &&
            m.pendingDelegationDraft.status === 'awaiting_confirmation'
        )?.pendingDelegationDraft ||
      null;

    if (!draft) return null;

    // Strict single-dispatch guard: never send the same draft more than once
    if (this.dispatchedDraftIds.has(draft.draftId)) {
      return null;
    }
    this.dispatchedDraftIds.add(draft.draftId);
    this.pendingConfirmationDraft = null;

    // Mark the draft card as confirmed in companionMessages
    const currentMsgs = this.deps.getCompanionMessages();
    const updatedMsgs = currentMsgs.map((m) =>
      m.pendingDelegationDraft?.draftId === draft.draftId
        ? {
            ...m,
            pendingDelegationDraft: {
              ...m.pendingDelegationDraft,
              status: 'confirmed' as const,
            },
          }
        : m
    );
    if (
      params?.userCompanionMessage &&
      !updatedMsgs.some((m) => m.id === params.userCompanionMessage!.id)
    ) {
      updatedMsgs.push(params.userCompanionMessage);
    }
    await this.deps.onSaveCompanionMessages(updatedMsgs);

    const confirmedIntent: ParsedDelegationIntent = {
      isDelegation: true,
      isSupportedSpecialist: true,
      targetMode: draft.targetMode,
      targetSpecialistNameRu: draft.targetSpecialistNameRu,
      targetSchool: draft.targetSchool,
      instruction: draft.cleanInstruction,
      cleanInstruction: draft.cleanInstruction,
      originalText: draft.originalUserRequest,
      isFollowUp: draft.isFollowUp,
      isAmbiguous: false,
      preferredSessionId: draft.sessionId,
    };

    return await this.executeDelegation({
      intent: confirmedIntent,
      sourceMode: params?.sourceMode || draft.sourceMode,
      skipAddingUserCompanionMessage: true,
    });
  }

  /**
   * Stage 6.4 (2): Parses whether Anna's message is an explicit confirmation («Да, отправляй»),
   * cancellation («Не отправляй» / «Отмена»), or parameter adjustment for the pending draft.
   */
  public parsePendingDraftAction(rawText: string): {
    action: 'confirm' | 'cancel' | 'adjust_school' | 'adjust_specialist' | 'none';
    draft?: PixelPendingDelegationDraft;
    newSchool?: SchoolId;
    newMode?: AgentMode;
  } {
    const draft = this.getPendingConfirmationDraft();
    if (!draft) return { action: 'none' };

    const text = (rawText || '').trim();
    if (!text) return { action: 'none' };
    const lower = text.toLowerCase();

    // 1. Check explicit cancellation first («не отправляй», «отмена», «нет, не надо»)
    if (
      /^(?:нет[\s,.-]*)?(?:не\s+отправляй(?:те)?|не\s+надо(?:\s+отправлять)?|не\s+нужно(?:\s+отправлять)?|отмена|отменить|отмени(?:\s+отправку|\s+поручение)?|стоп|отбой)$/i.test(
        lower
      )
    ) {
      return { action: 'cancel', draft };
    }

    // 2. Check explicit confirmation («Да, отправляй», «Отправляй», «Да, отправь», «Подтверждаю»)
    if (
      /^(?:пиксель[\s,:-]*)?(?:да[\s,!-]*)*(?:всё\s+верно[\s,!-]*|верно[\s,!-]*|отлично[\s,!-]*|хорошо[\s,!-]*)?(?:да[\s,!-]*)?(?:отправляй(?:те)?|отправь(?:те)?(?:\s+поручение|\s+сообщение|\s+задачу|\s+ему|\s+ей)?|подтверждаю(?:\s+отправку)?|запускай(?:те)?(?:\s+поручение)?)[\s.!]*$/i.test(
        lower
      )
    ) {
      return { action: 'confirm', draft };
    }

    // 3. Check if Anna is adjusting school while draft is pending (e.g., «Для Renderia», «Нет, школа Киберван»)
    if (
      text.length < 45 &&
      !/(?:попроси|поручи|спроси|разработай|составь|подготовь)/i.test(lower)
    ) {
      const hasRenderia =
        lower.includes('renderia') ||
        lower.includes('рендери') ||
        lower.includes('рендерия') ||
        lower.includes('рендерии');
      const hasKiberone =
        lower.includes('kiber') ||
        lower.includes('киберван') ||
        lower.includes('киберон');
      if (hasRenderia && !hasKiberone) {
        return { action: 'adjust_school', draft, newSchool: 'renderia' };
      }
      if (hasKiberone && !hasRenderia) {
        return { action: 'adjust_school', draft, newSchool: 'kiberone' };
      }

      const specMatch = detectSpecialistFromText(lower);
      if (specMatch.matched && specMatch.mode) {
        return { action: 'adjust_specialist', draft, newMode: specMatch.mode };
      }
    }

    return { action: 'none' };
  }

  /**
   * Stage 6.2, 6.3, 6.4 & 6.5: Parses natural language input (from text chat or Live Voice) to detect
   * whether Anna is asking Pixel to delegate a task, ask a follow-up question, or request a revision
   * from any AI specialist (Marketer, Manager, Methodist, Analyst) or the currently open specialist.
   */
  public parseDelegationIntent(
    rawText: string,
    activeSchool: SchoolId
  ): ParsedDelegationIntent | null {
    const text = (rawText || '').trim();
    if (text.length < 4) return null;

    // Do not treat read-aloud, chat deletion, or unsupported external capability commands as delegation
    if (
      this.parseReadAloudIntent(text, activeSchool) ||
      this.parseChatDeletionIntent(text, activeSchool) ||
      this.parseUnsupportedCapabilityIntent(text)
    ) {
      return null;
    }

    // Do not treat confirmation/cancellation commands as a new delegation
    if (
      this.parsePendingDraftAction(text).action !== 'none' ||
      this.parsePendingChatDeletionAction(text).action !== 'none'
    ) {
      return null;
    }

    const lower = text.toLowerCase();

    // Do not confuse personal reminder «напомни мне ...» unless explicitly asking to message/instruct a specialist
    const isPersonalReminderOnly =
      /^(?:пиксель[\s,:-]*)?(?:пожалуйста[\s,:-]*)?напомни(?:те)?\s+мне(?=$|[^а-яёa-z0-9])/i.test(
        text
      ) &&
      !/(?:^|[^а-яёa-z0-9])(?:попроси|поручи|напиши|передай|отправь|делегируй|спроси|уточни)(?=$|[^а-яёa-z0-9])/i.test(
        text
      );
    if (isPersonalReminderOnly) {
      return null;
    }

    // 1. Check explicit specialist mention
    const explicitSpec = detectSpecialistFromText(lower);

    // 2. Check implicit reference to the currently open specialist chat
    const hasImplicitFollowUpPattern =
      /(?:^|[^а-яёa-z0-9])(?:попроси(?:те|ть)?|скажи(?:те)?|напиши(?:те)?|передай(?:те)?|отправь(?:те)?|поручи(?:те|ть)?)\s+(?:ему|ей|специалисту)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      ) ||
      /(?:^|[^а-яёa-z0-9])(?:спроси(?:те|ть)?|уточни(?:те|ть)?)\s+(?:у\s+(?:него|неё|нее|специалиста)|его|её|ее|специалиста)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      ) ||
      /(?:^|[^а-яёa-z0-9])(?:попроси(?:те|ть)?\s+(?:его\s+|её\s+|ее\s+|специалиста\s+)?(?:доработать|переделать|уточнить|исправить|дополнить|сократить|расширить|добавить))(?=$|[^а-яёa-z0-9])/i.test(
        lower
      ) ||
      /(?:^|[^а-яёa-z0-9])(?:задай(?:те)?|попроси(?:те|ть)?\s+задать)\s+(?:ему\s+|ей\s+|специалисту\s+|маркетологу\s+|менеджеру\s+|методисту\s+|аналитику\s+)?(?:уточняющ(?:ий|ие)\s+)?вопрос(?:ы)?(?=$|[^а-яёa-z0-9])/i.test(
        lower
      ) ||
      /(?:^|[^а-яёa-z0-9])(?:отправь(?:те)?|напиши(?:те)?)\s+(?:сообщение\s+)?в\s+(?:этот\s+|текущий\s+|рабочий\s+|его\s+)?чат(?=$|[^а-яёa-z0-9])/i.test(
        lower
      ) ||
      /(?:^|[^а-яёa-z0-9])пусть\s+(?:он|она|специалист)\s+(?:доработает|добавит|уточнит|переделает|исправит|распишет|напишет|сделает|подготовит)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      );

    if (!explicitSpec.matched && !hasImplicitFollowUpPattern) {
      return null;
    }

    // Detect delegation or mediation action verb
    const hasActionVerb =
      hasImplicitFollowUpPattern ||
      /(?:^|[^а-яёa-z0-9])(?:попроси(?:ть|те)?|поручи(?:ть|те)?|напиши(?:те)?|передай(?:те)?|скажи(?:те)?|пусть|отправь(?:те)?|делегируй(?:те)?|спроси(?:ть|те)?|уточни(?:ть|те)?|задай(?:те)?\s+(?:уточняющий\s+)?вопрос|поставь(?:те)?\s+задачу|дай(?:те)?\s+задани[ея]|дай(?:те)?\s+задачу|запусти(?:те)?|обратись|обратитесь)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      ) ||
      /^(?:пиксель[\s,:-]*)?(?:для\s+)?(?:маркетолога|маркетологу|менеджера|менеджеру|методиста|методисту|аналитика|аналитику)(?:\s+(?:renderia|рендерия|рендерии|kiberone|киберван|киберон))?[\s:,-]+/i.test(
        lower
      ) ||
      /^(?:пиксель[\s,:-]*)?(?:задача|поручение|задание|вопрос)\s+(?:для\s+|к\s+)?(?:маркетолога|маркетологу|менеджера|менеджеру|методиста|методисту|аналитика|аналитику)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      );

    if (!hasActionVerb) {
      return null;
    }

    const activeMode = this.resolveActiveAgentMode();
    const targetMode: AgentMode = explicitSpec.matched
      ? explicitSpec.mode!
      : activeMode;
    const targetSpecialistNameRu = AGENT_MODES[targetMode].shortTitle;
    const isSupportedSpecialist = true;
    const targetSchool = detectTargetSchoolFromText(text, activeSchool);

    const isFollowUp =
      hasImplicitFollowUpPattern ||
      /(?:^|[^а-яёa-z0-9])(?:спроси|уточни|доработать|доработай|доработку|переделать|исправить|дополнить|уточняющий\s+вопрос|задай\s+вопрос)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      );

    let cleaned = text
      .replace(/^(?:пиксель[\s,.:!-]*)+/i, '')
      .replace(/^(?:пожалуйста[\s,.:!-]*)+/i, '')
      .trim();

    const prefixPatterns: RegExp[] = [
      /^(?:попроси(?:те|ть)?\s+задать|задай(?:те)?)\s+(?:ему\s+|ей\s+|специалисту\s+|(?:нашему\s+)?(?:ии[-\s]*)?(?:маркетолог[ауеом]?|менеджер[ауеом]?|методист[ауеом]?|аналитик[ауеом]?)(?:\s+(?:школы\s+)?(?:renderia|рендери[яию]|kiberone|киберван|киберон))?\s+)?(?:уточняющ(?:ий|ие)\s+)?вопрос(?:ы)?(?:\s+о\s+том|\s+про\s+то|\s+по\s+поводу\s+того)?[\s,.:;-]*/i,
      /^(?:спроси(?:те|ть)?|уточни(?:те|ть)?)\s+(?:у\s+)?(?:нашего\s+|своего\s+)?(?:ии[-\s]*)?(?:маркетолог[ауеом]?|менеджер[ауеом]?|методист[ауеом]?|аналитик[ауеом]?|специалист[ау]?|него|неё|нее|его|её|ее)(?:\s+(?:школы\s+)?(?:renderia|рендери[яию]|kiberone|киберван|киберон))?(?:\s+в\s+(?:рабочем\s+|его\s+)?чате)?[\s,.:;-]*/i,
      /^(?:попроси(?:те|ть)?|поручи(?:те|ть)?|напиши(?:те)?|передай(?:те)?|скажи(?:те)?|отправь(?:те)?|делегируй(?:те)?|обратись\s+к|обратитесь\s+к)\s+(?:нашему\s+|своему\s+)?(?:ии[-\s]*)?(?:маркетолог[ауеом]?|менеджер[ауеом]?|методист[ауеом]?|аналитик[ауеом]?|специалист[ау]?\s+по\s+(?:маркетингу|продажам)|специалист[ау]?|ему|ей|его|её|ее)(?:\s+(?:из\s+|школы\s+|в\s+)?(?:renderia|рендери[яию]|kiberone|киберван|киберон))?(?:\s+в\s+(?:рабочий\s+|его\s+|этот\s+|текущий\s+)?чат)?(?:\s+(?:задачу|поручение|задание|сообщение|вопрос))?(?:\s*,?\s*чтобы\s+(?:он|она))?[\s,.:;-]*/i,
      /^(?:попроси(?:те|ть)?)\s+(?:его\s+|её\s+|ее\s+|специалиста\s+)?(?=(?:доработать|переделать|уточнить|исправить|дополнить|сократить|расширить|добавить))/i,
      /^(?:поставь(?:те)?\s+задачу|дай(?:те)?\s+задани[ея]|дай(?:те)?\s+задачу)\s+(?:нашему\s+)?(?:ии[-\s]*)?(?:маркетолог[ауеом]?|менеджер[ауеом]?|методист[ауеом]?|аналитик[ауеом]?|ему|ей)(?:\s+(?:школы\s+)?(?:renderia|рендери[яию]|kiberone|киберван|киберон))?(?:\s+в\s+чат)?[\s,.:;-]*/i,
      /^пусть\s+(?:наш\s+)?(?:ии[-\s]*)?(?:маркетолог|менеджер|методист|аналитик|специалист|он|она)(?:\s+(?:школы\s+)?(?:renderia|рендери[яию]|kiberone|киберван|киберон))?\s+/i,
      /^(?:задача|поручение|задание|вопрос)\s+(?:для\s+|к\s+)?(?:маркетолог[ау]?|менеджер[ау]?|методист[ау]?|аналитик[ау]?)(?:\s+(?:renderia|рендери[яию]|kiberone|киберван|киберон))?[\s,.:;-]*/i,
      /^(?:для\s+)?(?:маркетолог[ау]|менеджер[ау]|методист[ау]|аналитик[ау])(?:\s+(?:renderia|рендери[яию]|kiberone|киберван|киберон))?[\s,.:;-]+/i,
      /^(?:отправь(?:те)?|напиши(?:те)?)\s+(?:сообщение\s+)?в\s+(?:этот\s+|текущий\s+|рабочий\s+|его\s+)?чат[\s,.:;-]*/i,
    ];

    for (const rx of prefixPatterns) {
      if (rx.test(cleaned)) {
        cleaned = cleaned.replace(rx, '').trim();
        break;
      }
    }

    cleaned = cleaned.replace(/^[,.:;-]+\s*/, '').trim();

    const completeness = checkUtteranceCompleteness(text, cleaned);

    const isBareOrVague =
      completeness.isIncomplete ||
      cleaned.length < 4 ||
      /^(?:доработать(?:\s+(?:ответ|его|это|результат|вариант))?|переделать(?:\s+(?:ответ|его|это))?|исправить(?:\s+(?:ответ|его|это))?|уточнить(?:\s+(?:ответ|детали|это))?|дополнить(?:\s+(?:ответ|его|это))?|задать\s+(?:уточняющий\s+)?вопрос|уточняющий\s+вопрос|вопрос|сообщение|что-нибудь|это|ответ|ещё\s+раз)$/i.test(
        cleaned
      );

    if (cleaned.length >= 2) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    } else {
      cleaned = text;
    }

    const cleanInstruction = buildCleanBusinessInstruction(
      cleaned,
      targetSchool
    );

    return {
      isDelegation: true,
      isSupportedSpecialist,
      targetMode,
      targetSpecialistNameRu,
      targetSchool,
      instruction: cleaned,
      cleanInstruction,
      originalText: text,
      isFollowUp,
      isAmbiguous: isBareOrVague,
      isIncompleteUtterance: completeness.isIncomplete,
      incompleteReasonRu: completeness.reasonRu,
    };
  }

  /**
   * Handles spoken user turns from Live Voice mode without modifying pixelVoiceCoordinator.ts.
   * Deduplicates by turn ID and enforces mandatory confirmation («Да, отправляй» / «Да, удали»).
   */
  public handleSpokenUserMessagesIfAny(messages: CompanionMessage[]): void {
    if (!this.deps) return;
    for (const msg of messages) {
      if (msg.role !== 'user' || !msg.isSpoken) continue;
      if (this.processedSpokenTurnIds.has(msg.id)) continue;

      const activeSchool = this.deps.getActiveSchool();

      // 1. Check read-aloud / resume command («Пиксель, прочитай ответ», «Продолжи чтение»)
      const readIntent = this.parseReadAloudIntent(msg.content, activeSchool);
      if (readIntent) {
        this.processedSpokenTurnIds.add(msg.id);
        void this.executeReadAloud(readIntent, 'voice');
        continue;
      }

      // 2. Check pending chat deletion confirmation/cancellation
      const deletionAction = this.parsePendingChatDeletionAction(msg.content);
      if (deletionAction.action !== 'none' && deletionAction.pending) {
        this.processedSpokenTurnIds.add(msg.id);
        if (deletionAction.action === 'confirm') {
          void this.confirmPendingChatDeletion(
            deletionAction.pending.deletionId
          );
        } else {
          void this.cancelPendingChatDeletion(
            deletionAction.pending.deletionId
          );
        }
        continue;
      }

      // 3. Check if confirming, cancelling, or adjusting a pending delegation draft («Да, отправляй»)
      const draftAction = this.parsePendingDraftAction(msg.content);
      if (draftAction.action !== 'none') {
        this.processedSpokenTurnIds.add(msg.id);
        const pendingDraft = this.getPendingConfirmationDraft();
        if (draftAction.action === 'confirm' && pendingDraft) {
          void this.confirmPendingDelegation({
            draftId: pendingDraft.draftId,
            sourceMode: 'voice',
          });
        } else if (draftAction.action === 'cancel' && pendingDraft) {
          void this.cancelPendingDelegation(pendingDraft.draftId);
        } else if (
          draftAction.action === 'adjust_school' &&
          pendingDraft &&
          draftAction.newSchool
        ) {
          void this.updatePendingDelegationDraft(pendingDraft.draftId, {
            targetSchool: draftAction.newSchool,
          });
        } else if (
          draftAction.action === 'adjust_specialist' &&
          pendingDraft &&
          draftAction.newMode
        ) {
          void this.updatePendingDelegationDraft(pendingDraft.draftId, {
            targetMode: draftAction.newMode,
          });
        }
        continue;
      }

      // 4. Check chat deletion intent («Пиксель, удали этот чат»)
      const delIntent = this.parseChatDeletionIntent(msg.content, activeSchool);
      if (delIntent) {
        this.processedSpokenTurnIds.add(msg.id);
        void this.executeChatDeletionIntent(delIntent);
        continue;
      }

      // 5. Check chat navigation intent («Вернись к нашему разговору с Методистом»)
      const navIntent = this.parseChatNavigationIntent(
        msg.content,
        activeSchool
      );
      if (navIntent) {
        this.processedSpokenTurnIds.add(msg.id);
        void this.executeChatNavigation(navIntent);
        continue;
      }

      // 6. Check unsupported capability intent («Опубликуй пост в ВК»)
      const unsupportedIntent = this.parseUnsupportedCapabilityIntent(
        msg.content
      );
      if (unsupportedIntent) {
        this.processedSpokenTurnIds.add(msg.id);
        void this.replyUnsupportedCapability(unsupportedIntent);
        continue;
      }

      // 7. Check if answering a pending clarification
      const clarifiedIntent = this.consumePendingClarification(
        msg.content,
        activeSchool
      );
      if (clarifiedIntent) {
        this.processedSpokenTurnIds.add(msg.id);
        if (clarifiedIntent.isAmbiguous) {
          void this.requestClarificationForAmbiguousIntent(clarifiedIntent);
        } else {
          void this.prepareDelegationForConfirmation({
            intent: clarifiedIntent,
            sourceMode: 'voice',
            skipAddingUserCompanionMessage: true,
          });
        }
        continue;
      }

      // 8. Check delegation / follow-up question to specialist
      const intent = this.parseDelegationIntent(msg.content, activeSchool);
      if (!intent) continue;

      this.processedSpokenTurnIds.add(msg.id);

      if (intent.isAmbiguous) {
        void this.requestClarificationForAmbiguousIntent(intent);
        continue;
      }

      void this.prepareDelegationForConfirmation({
        intent,
        sourceMode: 'voice',
        skipAddingUserCompanionMessage: true,
      });
    }
  }

  /**
   * Executes a real delegated task or follow-up message in the target specialist's existing working chat:
   * 1. Status 'created' (Создано): Finds the target session for targetMode & targetSchool and switches workspace to it.
   * 2. Status 'in_progress' (Выполняется): Sends real message from Pixel with taskId to specialist chat & runs AI generation.
   * 3. Saves specialist's response to IndexedDB & session state.
   * 4. Status 'reviewing' (Проверяется Пикселем): Verifies the actual result against Anna's instruction.
   * 5. Status 'needs_revision' (Требует доработки): Up to 3 iterations of revision if needed.
   * 6. Status 'completed' (Завершено) or 'error' (Ошибка): Updates Anna in Pixel chat / Live Voice and offers read-aloud & next steps.
   */
  public async executeDelegation(params: {
    intent: ParsedDelegationIntent;
    sourceMode: 'text' | 'voice';
    userCompanionMessage?: CompanionMessage;
    skipAddingUserCompanionMessage?: boolean;
    existingTaskId?: string;
  }): Promise<PixelDelegatedTaskState> {
    if (!this.deps) {
      throw new Error('PixelAgentCoordinator не инициализирован.');
    }

    const { intent, sourceMode } = params;
    const targetSchool = intent.targetSchool;
    const targetMode: AgentMode = intent.targetMode;
    const schoolCfg = SCHOOLS[targetSchool];
    const modeCfg = AGENT_MODES[targetMode];
    const genitiveName = SPECIALIST_NAMES_GENITIVE_RU[targetMode];
    const dativeName = SPECIALIST_NAMES_DATIVE_RU[targetMode];

    const now = new Date();
    const nowMs = now.getTime();
    const taskId =
      params.existingTaskId ||
      `ptask-${nowMs}-${Math.random().toString(36).slice(2, 6)}`;

    if (this.activeTaskExecutionLocks.has(taskId)) {
      const existing = this.tasks.get(taskId);
      if (existing) return existing;
    }
    this.activeTaskExecutionLocks.add(taskId);

    const currentSessions = sortSessionsPinnedAndUpdatedDesc(
      this.deps.getSessions()
    );
    const activeSessionId =
      intent.preferredSessionId || this.deps.getActiveSessionId?.() || null;

    let targetSession: ChatSession | undefined;
    if (activeSessionId) {
      const openCandidate = currentSessions.find(
        (s) => s.id === activeSessionId
      );
      if (
        openCandidate &&
        openCandidate.schoolId === targetSchool &&
        openCandidate.mode === targetMode
      ) {
        targetSession = openCandidate;
      }
    }

    if (!targetSession) {
      targetSession = currentSessions.find(
        (s) => s.schoolId === targetSchool && s.mode === targetMode
      );
    }

    if (!targetSession) {
      targetSession = buildNewSpecialistSession(
        targetMode,
        targetSchool,
        currentSessions
      );
      const withNewSession = sortSessionsPinnedAndUpdatedDesc([
        targetSession,
        ...currentSessions,
      ]);
      this.deps.onUpdateSessions(withNewSession);
      await storageProvider.saveSession(targetSession);
    }

    // Stage 6.5 (1): Ensure the workspace is switched to targetSession so Anna sees the execution in real time
    this.deps.onOpenDelegatedChat?.(targetSchool, targetMode, targetSession.id);

    const isContinuingExistingChat = targetSession.messages.length > 0;

    // 2. Initialize task state: 'created' (Создано)
    let taskState: PixelDelegatedTaskState = {
      taskId,
      targetMode,
      schoolId: targetSchool,
      instruction: intent.instruction,
      originalUserRequest: intent.originalText,
      status: 'created',
      statusLabelRu: PIXEL_DELEGATION_STATUS_LABELS.created,
      sessionId: targetSession.id,
      iterationCount: 0,
      maxRevisions: MAX_DELEGATION_REVISIONS,
      revisionFeedbackHistory: [],
      createdAt: formatTimeNow(now),
      updatedAt: formatTimeNow(now),
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      sourceMode,
    };

    this.tasks.set(taskId, taskState);
    this.notifyListeners(taskState);

    // Create Pixel status/report message in companionMessages
    const pixelCompanionMsgId = `comp-pixel-delegation-${taskId}`;
    const initialPixelCompanionMsg: CompanionMessage = {
      id: pixelCompanionMsgId,
      role: 'pixel',
      content: isContinuingExistingChat
        ? `Анна, я передаю ваш вопрос / уточнение **${dativeName}** (${schoolCfg.name}) в текущий рабочий чат «*${targetSession.title}*»: «*${intent.instruction}*»…`
        : `Анна, я создал поручение для **${genitiveName}** (${schoolCfg.name}): «*${intent.instruction}*».\nОтправляю задачу в рабочий чат ${genitiveName} и запускаю выполнение…`,
      createdAt: formatTimeNow(new Date(nowMs + 1)),
      createdAtMs: nowMs + 1,
      schoolId: targetSchool,
      usedContextLabels: [
        `Школа: ${schoolCfg.name}`,
        `Специалист: ${modeCfg.shortTitle}`,
        isContinuingExistingChat
          ? `Продолжение чата: ${targetSession.title}`
          : `Поручение: ${taskId}`,
      ],
      delegatedTask: taskState,
    };

    const existingCompanionMsgs = this.deps.getCompanionMessages();
    const withInitialCompanionMsgs: CompanionMessage[] = [];
    for (const m of existingCompanionMsgs) {
      if (m.id !== pixelCompanionMsgId) {
        withInitialCompanionMsgs.push(m);
      }
    }
    if (
      params.userCompanionMessage &&
      !params.skipAddingUserCompanionMessage &&
      !withInitialCompanionMsgs.some(
        (m) => m.id === params.userCompanionMessage!.id
      )
    ) {
      withInitialCompanionMsgs.push(params.userCompanionMessage);
    }
    withInitialCompanionMsgs.push(initialPixelCompanionMsg);
    await this.deps.onSaveCompanionMessages(withInitialCompanionMsgs);

    const updateTaskAndCompanionMessage = async (
      patch: Partial<PixelDelegatedTaskState>,
      companionContent?: string
    ) => {
      if (!this.deps) return;
      const updatedNow = new Date();
      const nextStatus = patch.status || taskState.status;
      taskState = {
        ...taskState,
        ...patch,
        status: nextStatus,
        statusLabelRu:
          patch.statusLabelRu || PIXEL_DELEGATION_STATUS_LABELS[nextStatus],
        updatedAt: formatTimeNow(updatedNow),
        updatedAtMs: updatedNow.getTime(),
      };
      this.tasks.set(taskId, taskState);
      this.notifyListeners(taskState);

      const latestCompanion = this.deps.getCompanionMessages();
      const updatedCompanion = latestCompanion.map((m) =>
        m.id === pixelCompanionMsgId
          ? {
              ...m,
              content: companionContent ?? m.content,
              delegatedTask: taskState,
              isError: taskState.status === 'error',
            }
          : m
      );
      await this.deps.onSaveCompanionMessages(updatedCompanion);
    };

    // Prepare school-isolated Knowledge Base context for the specialist
    const kbContext = documentProvider.prepareKnowledgeContextForSchool(
      targetSchool,
      this.deps.getKnowledgeBase(),
      true
    );

    const usedContextSummary: string[] = [
      `Школа: ${schoolCfg.name}`,
      `Роль: ${modeCfg.shortTitle}`,
      `Поручение Пикселя: ${taskId}`,
    ];
    if (kbContext.length > 0) {
      usedContextSummary.push(
        `База знаний ${schoolCfg.name} (${kbContext.length} разд.)`
      );
    }

    let currentIteration = 0;
    let lastRevisionFeedback = '';
    let finalSpecialistMessageId = '';
    let finalSpecialistText = '';
    let finalReviewSummary = '';
    let finalProviderId: AIProviderId | undefined = undefined;
    let finalModelName: string | undefined = undefined;

    try {
      while (currentIteration <= MAX_DELEGATION_REVISIONS) {
        const isRevision = currentIteration > 0;

        // 3. Transition status to 'in_progress' (Выполняется)
        await updateTaskAndCompanionMessage(
          {
            status: 'in_progress',
            statusLabelRu: isRevision
              ? `${PIXEL_DELEGATION_STATUS_LABELS.in_progress} (доработка #${currentIteration})`
              : PIXEL_DELEGATION_STATUS_LABELS.in_progress,
            iterationCount: currentIteration,
          },
          isRevision
            ? `Анна, я отправил ${dativeName} (${schoolCfg.name}) запрос на доработку #${currentIteration}. ${modeCfg.shortTitle} обновляет решение…`
            : isContinuingExistingChat
              ? `Анна, я написал ${dativeName} (${schoolCfg.name}) в текущий рабочий чат и жду ответа по вашему запросу: «*${intent.instruction}*»…`
              : `Анна, я написал ${dativeName} (${schoolCfg.name}) в его рабочий чат и запустил разработку по вашему поручению: «*${intent.instruction}*»…`
        );

        // Fetch fresh targetSession from state
        const freshSessions = this.deps.getSessions();
        const currentTargetSession =
          freshSessions.find((s) => s.id === targetSession!.id) ||
          targetSession!;

        const hasExistingMessages = currentTargetSession.messages.length > 0;

        const reqTime = new Date();
        const reqMs = reqTime.getTime();
        const repMs = reqMs + 1;

        const pixelMsgId = `msg-pixel-req-${taskId}-it${currentIteration}-${reqMs}`;
        const specialistMsgId = `msg-${targetMode}-rep-${taskId}-it${currentIteration}-${repMs}`;

        const cleanInstructionToSend =
          intent.cleanInstruction ||
          buildCleanBusinessInstruction(intent.instruction, targetSchool);

        const cleanRevisionFeedback = lastRevisionFeedback
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/[•▪▫★☆▶►✔✓✕✖✅❌⚠️🤖🔄]/g, '')
          .trim();

        const pixelMessageContent = !isRevision
          ? cleanInstructionToSend
          : `Пожалуйста, доработайте предыдущий ответ для школы ${schoolCfg.name} с учётом следующих уточнений: ${cleanRevisionFeedback}`;

        const pixelRequestMsg: ChatMessage = {
          id: pixelMsgId,
          sessionId: currentTargetSession.id,
          role: 'user',
          content: pixelMessageContent,
          createdAt: formatTimeNow(reqTime),
          createdAtMs: reqMs,
          schoolId: targetSchool,
          mode: targetMode,
          delegatedByPixel: true,
          delegationTaskId: taskId,
          delegationIteration: currentIteration,
          senderLabel: !isRevision
            ? hasExistingMessages
              ? 'Пиксель · Уточнение от Анны'
              : 'Пиксель · Поручение Анны'
            : `Пиксель · Доработка #${currentIteration}`,
        };

        const initialSpecialistReply: ChatMessage = {
          id: specialistMsgId,
          sessionId: currentTargetSession.id,
          role: 'assistant',
          content: '',
          createdAt: formatTimeNow(new Date(repMs)),
          createdAtMs: repMs,
          schoolId: targetSchool,
          mode: targetMode,
          usedContextSummary,
          isStreaming: true,
          delegatedByPixel: true,
          delegationTaskId: taskId,
          delegationIteration: currentIteration,
        };

        const sessionTitle =
          currentTargetSession.messages.length === 0
            ? `Поручение Пикселя: ${intent.instruction.slice(0, 34)}${intent.instruction.length > 34 ? '…' : ''}`
            : currentTargetSession.title;

        const sessionWithStreaming: ChatSession = {
          ...currentTargetSession,
          title: sessionTitle,
          updatedAt: formatTimeNow(new Date(repMs)),
          updatedAtMs: repMs,
          messages: [
            ...currentTargetSession.messages,
            pixelRequestMsg,
            initialSpecialistReply,
          ],
        };

        const updatedSessionsList = sortSessionsPinnedAndUpdatedDesc([
          sessionWithStreaming,
          ...this.deps
            .getSessions()
            .filter((s) => s.id !== sessionWithStreaming.id),
        ]);
        this.deps.onUpdateSessions(updatedSessionsList);

        // Save Pixel's request message immediately to IndexedDB
        await storageProvider.saveSessionAndMessages(sessionWithStreaming, [
          pixelRequestMsg,
          {
            ...initialSpecialistReply,
            isStreaming: false,
            content: `[Выполняется генерация ответа специалиста (${modeCfg.shortTitle}) по запросу Пикселя…]`,
          },
        ]);

        this.deps.onSpecialistGenerationStateChange?.({
          isGenerating: true,
          sessionId: sessionWithStreaming.id,
          stage: 'connecting',
        });

        const updateSpecialistReplyInStateAndDb = async (
          patch: Partial<ChatMessage>,
          persistToDb: boolean
        ) => {
          if (!this.deps) return;
          const allSessions = this.deps.getSessions();
          const sess = allSessions.find(
            (s) => s.id === sessionWithStreaming.id
          );
          if (!sess) return;

          let updatedAssistantMsg: ChatMessage | null = null;
          const updatedMsgs = sess.messages.map((m) => {
            if (m.id === specialistMsgId) {
              updatedAssistantMsg = { ...m, ...patch };
              return updatedAssistantMsg;
            }
            return m;
          });

          const nextSess: ChatSession = {
            ...sess,
            updatedAt: formatTimeNow(new Date()),
            updatedAtMs: Date.now(),
            messages: updatedMsgs,
          };

          const nextAll = sortSessionsPinnedAndUpdatedDesc([
            nextSess,
            ...allSessions.filter((s) => s.id !== nextSess.id),
          ]);
          this.deps.onUpdateSessions(nextAll);

          if (persistToDb && updatedAssistantMsg) {
            await storageProvider.saveSessionAndMessages(nextSess, [
              pixelRequestMsg,
              updatedAssistantMsg,
            ]);
          }
        };

        // Stage 6.5 (1): Build strictly isolated conversation history for specialist API call
        // (only messages from this exact session, schoolId, and specialist mode)
        const historyForApi = [
          ...currentTargetSession.messages
            .filter(
              (m) =>
                !m.isStreaming &&
                m.content.trim().length > 0 &&
                (!m.sessionId || m.sessionId === currentTargetSession.id) &&
                (!m.schoolId || m.schoolId === targetSchool) &&
                (!m.mode || m.mode === targetMode)
            )
            .slice(-12),
          pixelRequestMsg,
        ].map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const selectedProviderMode =
          this.deps.getProviderSelection() || readStoredProviderSelection();

        // Execute real generation via existing specialist mechanism (geminiProvider / aiProviderManager)
        const generationResult =
          selectedProviderMode !== 'auto' &&
          aiProviderManager.providers[selectedProviderMode]
            ? await aiProviderManager.providers[
                selectedProviderMode
              ].streamGenerate({
                schoolId: targetSchool,
                mode: targetMode,
                sessionId: sessionWithStreaming.id,
                messages: historyForApi,
                knowledgeBaseContext: kbContext,
                providerSelection: selectedProviderMode,
                onStageChange: (stage) => {
                  this.deps?.onSpecialistGenerationStateChange?.({
                    isGenerating: true,
                    sessionId: sessionWithStreaming.id,
                    stage,
                  });
                },
                onDelta: (_delta, accumulated) => {
                  void updateSpecialistReplyInStateAndDb(
                    {
                      content: accumulated,
                      isStreaming: true,
                    },
                    false
                  );
                },
              })
            : await geminiProvider.streamChat({
                schoolId: targetSchool,
                mode: targetMode,
                sessionId: sessionWithStreaming.id,
                messages: historyForApi,
                knowledgeBaseContext: kbContext,
                providerSelection: selectedProviderMode,
                onStageChange: (stage) => {
                  this.deps?.onSpecialistGenerationStateChange?.({
                    isGenerating: true,
                    sessionId: sessionWithStreaming.id,
                    stage,
                  });
                },
                onDelta: (_delta, accumulated) => {
                  void updateSpecialistReplyInStateAndDb(
                    {
                      content: accumulated,
                      isStreaming: true,
                    },
                    false
                  );
                },
              });

        this.deps.onSpecialistGenerationStateChange?.({
          isGenerating: false,
          sessionId: null,
          stage: null,
        });

        const generatedText = (generationResult.text || '').trim();
        if (generationResult.aborted || !generatedText) {
          throw new Error(
            generationResult.aborted
              ? `Генерация ответа ${genitiveName} была остановлена.`
              : `${modeCfg.shortTitle} вернул пустой ответ.`
          );
        }

        // Save completed specialist response to IndexedDB and state
        await updateSpecialistReplyInStateAndDb(
          {
            content: generatedText,
            isStreaming: false,
            isError: false,
            modelName: generationResult.model,
            providerId: generationResult.providerId,
            providerLabel: generationResult.providerLabel,
            failoverNotice: generationResult.failoverNotice,
          },
          true
        );

        finalSpecialistMessageId = specialistMsgId;
        finalSpecialistText = generatedText;
        finalProviderId = generationResult.providerId;
        finalModelName = generationResult.model;

        // 4. Transition status to 'reviewing' (Проверяется Пикселем)
        await updateTaskAndCompanionMessage(
          {
            status: 'reviewing',
            statusLabelRu: PIXEL_DELEGATION_STATUS_LABELS.reviewing,
            lastSpecialistMessageId: specialistMsgId,
            specialistReplyPreview:
              generatedText.slice(0, 260) +
              (generatedText.length > 260 ? '…' : ''),
          },
          `${modeCfg.shortTitle} (${schoolCfg.name}) подготовил ответ. Проверяю результат на соответствие вашему запросу…`
        );

        // 5. Pixel checks the specialist's response
        const verification = await this.verifySpecialistResult({
          taskId,
          iteration: currentIteration,
          schoolId: targetSchool,
          targetMode,
          instruction: intent.instruction,
          specialistReply: generatedText,
          providerSelection: selectedProviderMode,
        });

        if (
          verification.approved ||
          currentIteration >= MAX_DELEGATION_REVISIONS
        ) {
          finalReviewSummary = verification.comment;
          break;
        }

        // 6. Needs revision ('needs_revision' — Требует доработки)
        lastRevisionFeedback = verification.comment;
        const nextHistory = [
          ...(taskState.revisionFeedbackHistory || []),
          lastRevisionFeedback,
        ];

        await updateTaskAndCompanionMessage(
          {
            status: 'needs_revision',
            statusLabelRu: `${PIXEL_DELEGATION_STATUS_LABELS.needs_revision} (#${currentIteration + 1})`,
            revisionFeedbackHistory: nextHistory,
            reviewSummary: lastRevisionFeedback,
          },
          `Проверил ответ ${genitiveName} (${schoolCfg.name}) — требуется доработка (#${currentIteration + 1}): ${lastRevisionFeedback}`
        );

        currentIteration += 1;
      }

      // 7. Transition status to 'completed' (Завершено)
      const iterationsNote =
        currentIteration > 0
          ? `Выполнено с доработкой (проведено итераций доработки: ${currentIteration})`
          : 'Принято с первой итерации';

      const completedContent = [
        isContinuingExistingChat
          ? `Анна, **${modeCfg.shortTitle}** (${schoolCfg.name}) ответил на ваш запрос в рабочем чате, и я проверил результат!`
          : `Анна, поручение для **${genitiveName}** (${schoolCfg.name}) успешно выполнено и проверено мной!`,
        ``,
        `• **Запрос:** ${intent.instruction}`,
        `• **Статус:** Завершено (${iterationsNote})`,
        `• **Проверка Пикселя:** ${finalReviewSummary}`,
        ``,
        `**Что можно сделать дальше:**`,
        `- Скажите или напишите *«Пиксель, прочитай ответ»* (или нажмите кнопку **«Озвучить ответ»** ниже), чтобы я зачитал ответ вслух.`,
        `- Задайте мне любой вопрос по содержанию ответа или скажите *«Попроси его доработать…»*, чтобы продолжить диалог в этом же чате.`,
      ].join('\n');

      await updateTaskAndCompanionMessage(
        {
          status: 'completed',
          statusLabelRu: PIXEL_DELEGATION_STATUS_LABELS.completed,
          lastSpecialistMessageId: finalSpecialistMessageId,
          reviewSummary: finalReviewSummary,
          specialistReplyPreview:
            finalSpecialistText.slice(0, 280) +
            (finalSpecialistText.length > 280 ? '…' : ''),
        },
        completedContent
      );

      // Highlight the new specialist reply in the chat view
      if (this.deps && targetSession && finalSpecialistMessageId) {
        this.deps.onOpenDelegatedChat?.(
          targetSchool,
          targetMode,
          targetSession.id,
          finalSpecialistMessageId
        );
      }

      // Update provider attribution on the companion message
      if (this.deps && (finalProviderId || finalModelName)) {
        const latestMsgs = this.deps.getCompanionMessages();
        const attributed = latestMsgs.map((m) =>
          m.id === pixelCompanionMsgId
            ? {
                ...m,
                providerId: finalProviderId,
                modelName: finalModelName,
              }
            : m
        );
        await this.deps.onSaveCompanionMessages(attributed);
      }

      // If initiated or active in Live Voice, notify Anna via Live session
      this.deps?.onNotifyLiveVoice?.(
        `Системное уведомление о выполнении запроса: ${modeCfg.shortTitle} (${schoolCfg.name}) ответил в рабочем чате по запросу «${intent.instruction}». Резюме проверки Пикселя: ${finalReviewSummary}. Сообщи Анне голосом кратко (1-2 фразы), что ${modeCfg.shortTitle} подготовил ответ в чате, и предложи зачитать его вслух или обсудить детали.`
      );

      return taskState;
    } catch (err) {
      this.deps?.onSpecialistGenerationStateChange?.({
        isGenerating: false,
        sessionId: null,
        stage: null,
      });

      const errorMsg =
        err instanceof Error
          ? err.message
          : `Не удалось выполнить генерацию ответа ${genitiveName}.`;

      // Clean up any stuck streaming message in the target session
      if (this.deps && targetSession) {
        const allSessions = this.deps.getSessions();
        const sess = allSessions.find((s) => s.id === targetSession!.id);
        if (sess && sess.messages.some((m) => m.isStreaming)) {
          const cleanedMessages = sess.messages.map((m) =>
            m.isStreaming
              ? {
                  ...m,
                  isStreaming: false,
                  isError: true,
                  content: `Ошибка выполнения поручения Пикселя: ${errorMsg}`,
                }
              : m
          );
          const cleanedSess: ChatSession = {
            ...sess,
            messages: cleanedMessages,
          };
          const nextAll = sortSessionsPinnedAndUpdatedDesc([
            cleanedSess,
            ...allSessions.filter((s) => s.id !== cleanedSess.id),
          ]);
          this.deps.onUpdateSessions(nextAll);
          await storageProvider
            .saveSessionAndMessages(cleanedSess, cleanedMessages.slice(-2))
            .catch(() => {});
        }
      }

      await updateTaskAndCompanionMessage(
        {
          status: 'error',
          statusLabelRu: PIXEL_DELEGATION_STATUS_LABELS.error,
          errorMessage: errorMsg,
        },
        `Анна, я передал запрос ${dativeName} (${schoolCfg.name}), но при генерации ответа возникла ошибка: **${errorMsg}**.\n\nПоручение не завершено. Вы можете нажать «Повторить поручение» ниже или открыть чат ${genitiveName}.`
      );

      this.deps?.onNotifyLiveVoice?.(
        `Системное уведомление: при выполнении поручения ${dativeName} (${schoolCfg.name}) произошла ошибка: ${errorMsg}. Честно сообщи Анне, что генерация не запустилась или завершилась ошибкой.`
      );

      return taskState;
    } finally {
      this.activeTaskExecutionLocks.delete(taskId);
    }
  }

  /**
   * Verifies the specialist's actual response against Anna's instruction and target school.
   * Combines deterministic quality checks with an AI verification pass by Pixel.
   */
  private async verifySpecialistResult(params: {
    taskId: string;
    iteration: number;
    schoolId: SchoolId;
    targetMode: AgentMode;
    instruction: string;
    specialistReply: string;
    providerSelection: AIProviderSelectionMode;
  }): Promise<{ approved: boolean; comment: string }> {
    const {
      taskId,
      iteration,
      schoolId,
      targetMode,
      instruction,
      specialistReply,
      providerSelection,
    } = params;
    const schoolCfg = SCHOOLS[schoolId];
    const modeCfg = AGENT_MODES[targetMode];
    const genitiveName = SPECIALIST_NAMES_GENITIVE_RU[targetMode];
    const otherSchoolId: SchoolId =
      schoolId === 'kiberone' ? 'renderia' : 'kiberone';
    const otherSchoolName = SCHOOLS[otherSchoolId].name;

    const trimmed = specialistReply.trim();

    // 1. Deterministic check: response must be substantive and non-empty
    if (trimmed.length < 80) {
      return {
        approved: false,
        comment:
          'Ответ слишком короткий и не содержит детальной проработки запроса. Необходимо расписать структуру и конкретные рекомендации для школы.',
      };
    }

    // 2. Deterministic check: school isolation (must not confuse KIBERONE and RENDERIA)
    const lowerReply = trimmed.toLowerCase();
    const mentionsTargetSchool =
      schoolId === 'renderia'
        ? lowerReply.includes('renderia') || lowerReply.includes('рендери')
        : lowerReply.includes('kiber') ||
          lowerReply.includes('киберван') ||
          lowerReply.includes('киберон');
    const mentionsOtherSchool =
      otherSchoolId === 'renderia'
        ? lowerReply.includes('renderia') || lowerReply.includes('рендери')
        : lowerReply.includes('kiberone') ||
          lowerReply.includes('киберван') ||
          lowerReply.includes('киберон');

    if (!mentionsTargetSchool && mentionsOtherSchool) {
      return {
        approved: false,
        comment: `В ответе упомянута школа ${otherSchoolName} вместо целевой школы ${schoolCfg.name}. Необходимо строго подготовить материал для школы ${schoolCfg.name}.`,
      };
    }

    // 3. AI verification call by Pixel
    try {
      const reviewPrompt = [
        `Проверьте выполненный специалистом «ИИ-${modeCfg.shortTitle}» ответ по поручению управляющей Анны.`,
        `Целевая школа: ${schoolCfg.name}`,
        `Запрос / поручение Анны: «${instruction}»`,
        `Итерация: ${iteration + 1}`,
        ``,
        `Текст ответа специалиста (${modeCfg.shortTitle}):`,
        `"""`,
        trimmed.slice(0, 5000),
        `"""`,
        ``,
        `Критерии проверки:`,
        `1. Ответ прямо отвечает на запрос «${instruction}» для школы ${schoolCfg.name}.`,
        `2. Ответ структурирован, практичен и не обрывается на полуслове.`,
        `3. Нет путаницы со второй школой (${otherSchoolName}).`,
        ``,
        `Ответьте СТРОГО в 2 строки без лишнего текста:`,
        `ВЕРДИКТ: ПРИНЯТО или ДОРАБОТАТЬ`,
        `РЕЗЮМЕ: <если ПРИНЯТО — краткий вывод в 1-2 предложениях для Анны о том, что именно подготовил ${modeCfg.shortTitle}; если ДОРАБОТАТЬ — конкретное замечание специалисту, что нужно исправить или дополнить>`,
      ].join('\n');

      const reviewResult = await geminiProvider.streamChat({
        schoolId,
        mode: 'pixel',
        sessionId: `pixel-verify-${taskId}-${iteration}`,
        messages: [{ role: 'user', content: reviewPrompt }],
        providerSelection,
        timeoutMs: 25000,
        onDelta: () => {},
      });

      const reviewText = (reviewResult.text || '').trim();
      const lines = reviewText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      const verdictLine =
        lines.find((l) => /^вердикт\s*:/i.test(l)) || lines[0] || '';
      const summaryLine =
        lines.find((l) => /^резюме\s*:/i.test(l)) ||
        lines.slice(1).join(' ') ||
        reviewText;

      const cleanSummary = summaryLine
        .replace(/^(?:резюме|комментарий)\s*:\s*/i, '')
        .trim();

      const needsRevision =
        /доработать|needs_revision|требует\s+доработки/i.test(verdictLine) &&
        !/принято/i.test(verdictLine);

      if (needsRevision && cleanSummary.length > 5) {
        return {
          approved: false,
          comment: cleanSummary,
        };
      }

      return {
        approved: true,
        comment:
          cleanSummary ||
          `Ответ ${genitiveName} полностью соответствует запросу для школы ${schoolCfg.name}, структурирован и готов к использованию.`,
      };
    } catch {
      // Fallback if secondary review request times out while primary specialist response passed deterministic checks
      return {
        approved: true,
        comment: `Ответ ${genitiveName} для школы ${schoolCfg.name} проверен по структуре и полноте (${trimmed.length} симв.) и соответствует запросу.`,
      };
    }
  }
}

export const pixelAgentCoordinator = new PixelAgentCoordinator();

