import {
  AgentMode,
  AIProviderId,
  AIProviderSelectionMode,
  ChatMessage,
  ChatSession,
  CompanionMessage,
  CompanionTaskPriority,
  CompanionTaskRecord,
  CoordinatorTaskStatus,
  KnowledgeBaseBySchool,
  NavSection,
  PixelActiveChatContext,
  PixelActiveChatMessageItem,
  PixelChatNavigationItem,
  PixelDelegatedTaskState,
  PixelDelegationStatus,
  PixelPendingChatDeletion,
  PixelPendingDelegationDraft,
  PixelPendingPersonalTaskDraft,
  PixelPendingRevisionDraft,
  SchoolId,
  SpecialistAnalysisResult,
  SpecialistRevisionItem,
  UploadedDocumentRecord,
} from '../types/assistant';
import { AGENT_MODES, SCHOOLS } from '../config/schoolsAndModes';
import { documentProvider } from './documentProvider';
import {
  geminiProvider,
  GenerationStage,
  parseDesignerConceptsFromMarkdown,
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
import { geminiLiveClient } from './voice/geminiLiveClient';
import {
  formatSyzranIsoDateRu,
  getSyzranNow,
  toSyzranIsoDate,
} from '../utils/syzranTime';
import { processPersonalTaskDraftInput } from '../utils/pixelTaskManagerEngine';
import { showToast } from '../components/ToastNotification';

export const PIXEL_DELEGATION_STATUS_LABELS: Record<
  CoordinatorTaskStatus,
  string
> = {
  draft: 'Черновик',
  pending_confirmation: 'Ждёт подтверждения',
  sent: 'Ожидает ответа',
  waiting_for_reply: 'Ожидает ответа',
  processing: 'Выполняется',
  completed: 'Завершено',
  needs_revision: 'Требуется доработка',
  failed: 'Ошибка',
  cancelled: 'Отменено',
  created: 'Создано',
  in_progress: 'Ожидает ответа',
  reviewing: 'Проверяется Пикселем',
  error: 'Ошибка',
};

export const MAX_DELEGATION_REVISIONS = 3;

export const SPECIALIST_NAMES_GENITIVE_RU: Record<AgentMode, string> = {
  marketer: 'Маркетолога',
  manager: 'Менеджера',
  methodist: 'Методиста',
  analyst: 'Аналитика',
  designer: 'Дизайнера',
};

export const SPECIALIST_NAMES_DATIVE_RU: Record<AgentMode, string> = {
  marketer: 'Маркетологу',
  manager: 'Менеджеру',
  methodist: 'Методисту',
  analyst: 'Аналитику',
  designer: 'Дизайнеру',
};

export const SPECIALIST_NAMES_INSTRUMENTAL_RU: Record<AgentMode, string> = {
  marketer: 'Маркетологом',
  manager: 'Менеджером',
  methodist: 'Методистом',
  analyst: 'Аналитиком',
  designer: 'Дизайнером',
};

export interface ParsedInquireResultIntent {
  isInquiry: boolean;
  targetMode?: AgentMode;
  targetSchool?: SchoolId;
  hasExplicitSchool?: boolean;
  originalText: string;
}

export interface ParsedRevisionIntent {
  isRevision: boolean;
  targetMode?: AgentMode;
  targetSchool?: SchoolId;
  hasExplicitSchool?: boolean;
  revisionPrompt: string;
  originalText: string;
}

export interface ParsedPendingRevisionAction {
  action: 'confirm' | 'cancel' | 'none';
  draft?: PixelPendingRevisionDraft;
}

export interface ParsedDelegationIntent {
  isDelegation: boolean;
  isSupportedSpecialist: boolean;
  targetMode: AgentMode;
  targetModes?: AgentMode[];
  targetSpecialistNameRu: string;
  targetSchool: SchoolId;
  targetBothSchools?: boolean;
  forceNewChat?: boolean;
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
  onDelegatedTaskSyncToAnnaTasks?: (taskState: PixelDelegatedTaskState) => void;
  onSaveCompanionTask?: (task: CompanionTaskRecord) => Promise<void>;
  onNavigate?: (section: NavSection) => void;
}

function isAgentModeSection(section: NavSection): section is AgentMode {
  return (
    section === 'marketer' ||
    section === 'manager' ||
    section === 'methodist' ||
    section === 'analyst' ||
    section === 'designer'
  );
}

function formatTimeNow(date: Date = new Date()): string {
  return getSyzranNow(date).time24;
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

export function detectAllSpecialistsFromText(lower: string): AgentMode[] {
  const modes: AgentMode[] = [];
  if (
    /(?:^|[^а-яёa-z0-9])маркетолог(?:а|у|е|ом|и|ов)?(?=$|[^а-яёa-z0-9])/i.test(
      lower
    ) ||
    /(?:^|[^а-яёa-z0-9])специалист(?:а|у|ом)?\s+по\s+маркетингу(?=$|[^а-яёa-z0-9])/i.test(
      lower
    )
  ) {
    modes.push('marketer');
  }
  if (
    /(?:^|[^а-яёa-z0-9])менеджер(?:а|у|е|ом|ы|ов)?(?=$|[^а-яёa-z0-9])/i.test(
      lower
    ) ||
    /(?:^|[^а-яёa-z0-9])специалист(?:а|у|ом)?\s+по\s+продажам(?=$|[^а-яёa-z0-9])/i.test(
      lower
    )
  ) {
    modes.push('manager');
  }
  if (
    /(?:^|[^а-яёa-z0-9])методист(?:а|у|е|ом|ы|ов)?(?=$|[^а-яёa-z0-9])/i.test(
      lower
    )
  ) {
    modes.push('methodist');
  }
  if (
    /(?:^|[^а-яёa-z0-9])аналитик(?:а|у|е|ом|и|ов)?(?=$|[^а-яёa-z0-9])/i.test(
      lower
    )
  ) {
    modes.push('analyst');
  }
  if (
    /(?:^|[^а-яёa-z0-9])дизайнер(?:а|у|е|ом|ы|ов)?(?=$|[^а-яёa-z0-9])/i.test(
      lower
    ) ||
    /(?:^|[^а-яёa-z0-9])специалист(?:а|у|ом)?\s+по\s+дизайну(?=$|[^а-яёa-z0-9])/i.test(
      lower
    )
  ) {
    modes.push('designer');
  }
  return modes;
}

export function detectSpecialistFromText(lower: string): {
  matched: boolean;
  mode?: AgentMode;
  nameRu?: string;
} {
  const all = detectAllSpecialistsFromText(lower);
  if (all.length > 0) {
    const first = all[0];
    return {
      matched: true,
      mode: first,
      nameRu: AGENT_MODES[first].shortTitle,
    };
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
 * Formats a clean, professional Russian business specification (ТЗ) for a specialist chat.
 * Removes conversational parasitic commands («напиши», «скажи», «попроси»),
 * converts vague user phrasing into actionable directives, and ensures respectful imperative tone.
 */
export function buildCleanBusinessInstruction(
  rawInstruction: string,
  targetSchool: SchoolId,
  targetMode?: AgentMode
): string {
  void targetSchool;

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
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!text) return '';

  // 1. Strip conversational parasite commands and specialist address prefixes
  const parasiticPrefixRegex =
    /^(?:пиксель[\s,.:!-]*)*(?:пожалуйста[\s,.:!-]*)*(?:плиз[\s,.:!-]*)*(?:слушай[\s,.:!-]*)*(?:короче[\s,.:!-]*)*(?:попроси(?:те|ть)?|напиши(?:те)?|скажи(?:те)?|передай(?:те)?|отправь(?:те)?|поручи(?:те|ть)?|делегируй(?:те)?|спроси(?:те|ть)?|уточни(?:те|ть)?|узнай(?:те)?|поставь(?:те)?\s+задачу|дай(?:те)?\s+задани[ея]|дай(?:те)?\s+задачу|обратись\s+к|обратитесь\s+к)\s+(?:у\s+)?(?:ему|ей|его|её|ее|специалиста|специалисту|методиста|методисту|маркетолога|маркетологу|менеджера|менеджеру|аналитика|аналитику|дизайнера|дизайнеру|нашего\s+[а-яё]+|своего\s+[а-яё]+)?(?:\s+(?:из|в|для|школы)?\s*(?:renderia|kiberone|киберван|киберон|рендери[яи]))?(?:\s+в\s+(?:рабочий\s+|его\s+|этот\s+|текущий\s+)?чат)?(?:\s+(?:задачу|поручение|задание|сообщение|вопрос))?[\s,.:;-]*/i;

  while (parasiticPrefixRegex.test(text)) {
    text = text.replace(parasiticPrefixRegex, '').trim();
  }

  // Strip subordinate clauses like "чтобы он...", "пусть он...", "нужно чтобы..."
  text = text
    .replace(/^(?:чтобы\s+(?:он|она|они|специалист)\s+)/i, '')
    .replace(/^пусть\s+(?:он|она|они|специалист)\s+/i, '')
    .replace(/^(?:надо\s+(?:чтобы\s+)?|нужно\s+(?:чтобы\s+)?)/i, '')
    .replace(/^(?:что\s+нужно\s+)/i, '')
    .replace(/^[,.:;—–-]+\s*/, '')
    .trim();

  // 2. Intelligent reformulation of meta-questions and vague inquiries into actionable business specs
  const metaQuestionTaskMatch = text.match(
    /^(?:какую\s+задачу\s+поставить|какие\s+задачи\s+поставить|какую\s+поставить\s+задачу)(?:\s+(?:для|по|к|в|на)\s+(.+))?[.!?]?$/i
  );
  if (metaQuestionTaskMatch) {
    const scope = metaQuestionTaskMatch[1]?.trim();
    if (targetMode === 'methodist') {
      return scope
        ? `Сформулируйте варианты ключевых методических задач и рекомендации по их постановке для ${scope}.`
        : `Сформулируйте варианты ключевых методических задач и рекомендации по их постановке для текущего учебного блока.`;
    }
    if (targetMode === 'marketer') {
      return scope
        ? `Сформулируйте ключевые маркетинговые задачи и цели по продвижению для ${scope}.`
        : `Сформулируйте ключевые маркетинговые задачи и цели по продвижению.`;
    }
    if (targetMode === 'manager') {
      return scope
        ? `Сформулируйте ключевые задачи по продажам и регламенту общения с клиентами для ${scope}.`
        : `Сформулируйте ключевые задачи по продажам и регламенту работы с клиентами.`;
    }
    if (targetMode === 'analyst') {
      return scope
        ? `Сформулируйте аналитические задачи, метрики эффективности и гипотезы для ${scope}.`
        : `Сформулируйте аналитические задачи и метрики эффективности для анализа текущих показателей.`;
    }
    if (targetMode === 'designer') {
      return scope
        ? `Сформулируйте техническое задание на дизайн и визуальные концепции для ${scope}.`
        : `Сформулируйте техническое задание на разработку визуальных концепций и материалов.`;
    }
    return scope
      ? `Сформулируйте варианты ключевых профессиональных задач и план действий для ${scope}.`
      : `Сформулируйте варианты ключевых рабочих задач и пошаговый план действий.`;
  }

  const whatToDoMatch = text.match(
    /^(?:что\s+делать\s+с|что\s+делать\s+по|как\s+быть\s+с)\s+(.+)[.!?]?$/i
  );
  if (whatToDoMatch) {
    const topic = whatToDoMatch[1]?.trim();
    return `Разработайте регламент и пошаговый план действий по вопросу: ${topic}.`;
  }

  const howToOrganizeMatch = text.match(
    /^(?:как\s+организовать|как\s+выстроить|как\s+запустить)\s+(.+)[.!?]?$/i
  );
  if (howToOrganizeMatch) {
    const topic = howToOrganizeMatch[1]?.trim();
    return `Предложите структуру и пошаговый план по организации процесса: ${topic}.`;
  }

  const postsMatch = text.match(
    /^(?:какие\s+посты|какой\s+пост)\s+(?:написать|опубликовать|сделать)?(?:\s+(?:для|про|по|на\s+тему)\s+(.+))?[.!?]?$/i
  );
  if (postsMatch) {
    const topic = postsMatch[1]?.trim();
    return topic
      ? `Подготовьте контент-план и концепции публикаций на тему: ${topic}.`
      : `Подготовьте контент-план и список тем для публикаций на ближайший период.`;
  }

  const writePostMatch = text.match(
    /^(?:напиши|написать|сделай|составь)\s+пост(?:\s+(?:для|про|по|на\s+тему)\s+(.+))?[.!?]?$/i
  );
  if (writePostMatch) {
    const topic = writePostMatch[1]?.trim();
    return topic
      ? `Подготовьте текст публикации для социальных сетей на тему: ${topic}.`
      : `Подготовьте текст публикации для социальных сетей.`;
  }

  const isSimpleGreeting =
    /^(?:привет|здравствуй(?:те)?|добрый\s+(?:день|вечер)|доброе\s+утро)$/i.test(
      text.replace(/[.!?,]+$/, '').trim()
    );

  if (isSimpleGreeting) {
    const rawGreeting = text.replace(/[.!?,]+$/, '').trim();
    return rawGreeting.charAt(0).toUpperCase() + rawGreeting.slice(1);
  }

  const DELIM = '(?=$|[^а-яёa-z0-9])';

  // Convert common leading infinitive verbs, informal imperatives, or past subjunctive into polite business plural imperative
  const verbConversions: Array<[RegExp, string]> = [
    [new RegExp('^(?:разработать|разработал(?:а)?|разработай)' + DELIM, 'i'), 'Разработайте'],
    [new RegExp('^(?:составить|составил(?:а)?|составь)' + DELIM, 'i'), 'Составьте'],
    [new RegExp('^(?:подготовить|подготовил(?:а)?|подготовь)' + DELIM, 'i'), 'Подготовьте'],
    [new RegExp('^(?:сделать|сделал(?:а)?|сделай)' + DELIM, 'i'), 'Сделайте'],
    [new RegExp('^(?:доработать|доработал(?:а)?|доработай)' + DELIM, 'i'), 'Доработайте'],
    [new RegExp('^(?:переделать|переделал(?:а)?|переделай)' + DELIM, 'i'), 'Переделайте'],
    [new RegExp('^(?:исправить|исправил(?:а)?|исправь)' + DELIM, 'i'), 'Исправьте'],
    [new RegExp('^(?:уточнить|уточнил(?:а)?|уточни)' + DELIM, 'i'), 'Уточните'],
    [new RegExp('^(?:дополнить|дополнил(?:а)?|дополни)' + DELIM, 'i'), 'Дополните'],
    [new RegExp('^(?:расширить|расширил(?:а)?|расширь)' + DELIM, 'i'), 'Расширьте'],
    [new RegExp('^(?:сократить|сократил(?:а)?|сократи)' + DELIM, 'i'), 'Сократите'],
    [new RegExp('^(?:добавить|добавил(?:а)?|добавь)' + DELIM, 'i'), 'Добавьте'],
    [new RegExp('^(?:проанализировать|проанализировал(?:а)?|проанализируй)' + DELIM, 'i'), 'Проанализируйте'],
    [new RegExp('^(?:рассчитать|рассчитал(?:а)?|рассчитай)' + DELIM, 'i'), 'Рассчитайте'],
    [new RegExp('^(?:придумать|придумал(?:а)?|придумай)' + DELIM, 'i'), 'Придумайте'],
    [new RegExp('^(?:предложить|предложил(?:а)?|предложи)' + DELIM, 'i'), 'Предложите'],
    [new RegExp('^(?:проверить|проверил(?:а)?|проверь)' + DELIM, 'i'), 'Проверьте'],
    [new RegExp('^(?:описать|описал(?:а)?|опиши)' + DELIM, 'i'), 'Опишите'],
    [new RegExp('^(?:расписать|расписал(?:а)?|распиши)' + DELIM, 'i'), 'Распишите'],
    [new RegExp('^(?:подобрать|подобрал(?:а)?|подбери)' + DELIM, 'i'), 'Подберите'],
    [new RegExp('^(?:сформировать|сформировал(?:а)?|сформируй)' + DELIM, 'i'), 'Сформируйте'],
    [new RegExp('^(?:собрать|собрал(?:а)?|собери)' + DELIM, 'i'), 'Соберите'],
    [new RegExp('^(?:отправить|отправил(?:а)?|отправь)' + DELIM, 'i'), 'Отправьте'],
    [new RegExp('^(?:передать|передал(?:а)?|передай)' + DELIM, 'i'), 'Передайте'],
    [new RegExp('^(?:связаться|связался|связалась|свяжись)' + DELIM, 'i'), 'Свяжитесь'],
    [new RegExp('^(?:позвонить|позвонил(?:а)?|позвони)' + DELIM, 'i'), 'Позвоните'],
    [new RegExp('^(?:ответить|ответил(?:а)?|ответь)' + DELIM, 'i'), 'Ответьте'],
    [new RegExp('^(?:написать|написал(?:а)?|напиши)' + DELIM, 'i'), 'Напишите'],
  ];

  for (const [rx, replacement] of verbConversions) {
    if (rx.test(text)) {
      text = text.replace(rx, replacement);
      break;
    }
  }

  // Convert secondary coordinated verbs after 'и' or 'а также'
  const secondaryConversions: Array<[RegExp, string]> = [
    [/\b(и|а\s+также)\s+(?:исправить|исправь|исправил(?:а)?)\b/gi, '$1 исправьте'],
    [/\b(и|а\s+также)\s+(?:доработать|доработай|доработал(?:а)?)\b/gi, '$1 доработайте'],
    [/\b(и|а\s+также)\s+(?:подготовить|подготовь|подготовил(?:а)?)\b/gi, '$1 подготовьте'],
    [/\b(и|а\s+также)\s+(?:составить|составь|составил(?:а)?)\b/gi, '$1 составьте'],
    [/\b(и|а\s+также)\s+(?:написать|напиши|написал(?:а)?)\b/gi, '$1 напишите'],
    [/\b(и|а\s+также)\s+(?:прислать|пришли|прислал(?:а)?)\b/gi, '$1 пришлите'],
    [/\b(и|а\s+также)\s+(?:предложить|предложи|предложил(?:а)?)\b/gi, '$1 предложите'],
    [/\b(и|а\s+также)\s+(?:проверить|проверь|проверил(?:а)?)\b/gi, '$1 проверьте'],
    [/\b(и|а\s+также)\s+(?:добавить|добавь|добавил(?:а)?)\b/gi, '$1 добавьте'],
  ];

  for (const [rx, replacement] of secondaryConversions) {
    text = text.replace(rx, replacement);
  }

  // Capitalize first letter
  text = text.charAt(0).toUpperCase() + text.slice(1);

  // Normalize school name mention casing if already present in instruction
  text = text
    .replace(/\b(?:рендерия|рендерии|рендерию|renderia)\b/gi, 'RENDERIA')
    .replace(/\b(?:киберван|киберон|kiberone)\b/gi, 'KIBERONE');

  // Ensure clean ending punctuation
  const isQuestion =
    /^(?:какие|какой|какая|какое|как|сколько|почему|зачем|где|когда|кто|что|можно\s+ли|есть\s+ли|стоит\s+ли)\b/i.test(
      text
    ) || text.endsWith('?');

  text = text.replace(/[.!?,:;—–-]+$/, '').trim();

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

  // Greetings (e.g. «Привет», «Здравствуйте», «Добрый день») are intentional concise messages
  const isGreeting =
    /^(?:привет|здравствуй(?:те)?|добрый\s+(?:день|вечер)|доброе\s+утро)(?:[,.!?-]|\s|$)/i.test(
      instrTrimmed
    );
  if (isGreeting) {
    return { isIncomplete: false };
  }

  // 3. Instruction is just a bare verb or polite/filler words without real business object (e.g., «пожалуйста», «новое сообщение», «написать для Renderia»)
  const fillerRegex =
    /(?:^|[^\p{L}\p{N}])(?:пожалуйста|плиз|пжл|пж|новое\s+сообщение|новое\s+поручение|новое\s+задание|новую\s+задачу|новое\s+письмо|сообщение|поручение|задание|задача|задачу|вопрос|письмо|спасибо|благодарю)(?=$|[^\p{L}\p{N}])/giu;

  const strippedSchool = instrTrimmed
    .replace(/(?:^|[^\p{L}\p{N}])(?:для\s+)?(?:школы\s+)?(?:renderia|рендерия|рендерии|рендерию|kiberone|киберван|киберон)(?=$|[^\p{L}\p{N}])/giu, ' ')
    .replace(fillerRegex, ' ')
    .replace(/[.!?,:;—–-]+/g, ' ')
    .trim();

  const meaningfulWords = strippedSchool
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  if (
    meaningfulWords.length === 0 ||
    (meaningfulWords.length === 1 &&
      /^(?:разработать|разработайте|сделать|сделайте|написать|напишите|подготовить|подготовьте|составить|составьте|доработать|доработайте|переделать|переделайте|исправить|исправьте|уточнить|уточните|дополнить|дополните|добавить|добавьте|проверить|проверьте|придумать|придумайте|предложить|предложите|попросить|попроси|попросите|поручить|поручи|поручите|отправить|отправь|отправьте|передать|передай|передайте|задача|поручение|вопрос|сообщение|ответ)$/i.test(
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
  private pendingRevisionDraft: PixelPendingRevisionDraft | null = null;
  private pendingChatDeletion: PixelPendingChatDeletion | null = null;
  private pendingPersonalTaskDraft: PixelPendingPersonalTaskDraft | null = null;

  public init(deps: PixelAgentCoordinatorDeps): void {
    this.deps = deps;
    this.loadTasksFromStorage();
  }

  public getPendingPersonalTaskDraft(): PixelPendingPersonalTaskDraft | null {
    return this.pendingPersonalTaskDraft;
  }

  public setPendingPersonalTaskDraft(
    draft: PixelPendingPersonalTaskDraft | null
  ): void {
    this.pendingPersonalTaskDraft = draft;
  }

  /**
   * Delegates a task to a specialist chat and registers a delegated task.
   * Strictly used for Specialist branch execution (Branch B).
   */
  public async delegateTaskToSpecialist(params: {
    specialistMode: AgentMode;
    taskDescription: string;
    specialistNameRu?: string;
    schoolId?: SchoolId | 'both';
    sourceMode?: 'text' | 'voice';
    skipAddingUserCompanionMessage?: boolean;
    userCompanionMessage?: CompanionMessage;
  }): Promise<PixelDelegatedTaskState> {
    const targetSchool: SchoolId =
      params.schoolId === 'renderia'
        ? 'renderia'
        : params.schoolId === 'kiberone'
        ? 'kiberone'
        : this.deps?.getActiveSchool() || 'kiberone';

    const targetBothSchools = params.schoolId === 'both';
    const specName =
      params.specialistNameRu ||
      AGENT_MODES[params.specialistMode]?.shortTitle ||
      params.specialistMode;

    const intent: ParsedDelegationIntent = {
      isDelegation: true,
      isSupportedSpecialist: true,
      targetMode: params.specialistMode,
      targetSpecialistNameRu: specName,
      targetSchool,
      targetBothSchools,
      instruction: params.taskDescription,
      cleanInstruction: params.taskDescription,
      originalText: params.taskDescription,
    };

    return await this.executeDelegation({
      intent,
      sourceMode: params.sourceMode || 'text',
      userCompanionMessage: params.userCompanionMessage,
      skipAddingUserCompanionMessage: params.skipAddingUserCompanionMessage,
    });
  }

  /**
   * Directly creates and saves a personal task for Anna from a completed wizard draft,
   * guaranteeing real persistence in IndexedDB / storageProvider and immediate UI update.
   */
  public async createAndSavePersonalTask(
    draft: PixelPendingPersonalTaskDraft
  ): Promise<CompanionTaskRecord> {
    const nowMs = Date.now();
    const syzranNow = getSyzranNow(new Date(nowMs));
    const formattedNow = formatSyzranIsoDateRu(syzranNow.isoDate);

    // Clean and normalize dueDate strictly to YYYY-MM-DD
    let cleanDueDate = (draft.dueDate || syzranNow.isoDate).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(cleanDueDate)) {
      cleanDueDate = cleanDueDate.slice(0, 10);
    } else if (cleanDueDate.includes('T')) {
      cleanDueDate = cleanDueDate.split('T')[0];
    }

    // Clean dueTime to HH:mm
    let cleanDueTime = draft.dueTime ? draft.dueTime.trim() : undefined;
    if (cleanDueTime && !/^\d{1,2}:\d{2}$/.test(cleanDueTime)) {
      const timeMatch = cleanDueTime.match(/(\d{1,2}):(\d{2})/);
      if (timeMatch) {
        cleanDueTime = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
      }
    }

    // Priority: default to 'low' ("Обычный")
    const resolvedPriority: CompanionTaskPriority =
      draft.priority === 'high' || draft.priority === 'medium'
        ? draft.priority
        : 'low';

    const newTask: CompanionTaskRecord = {
      id: `task-manual-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
      title: (draft.title || draft.description || 'Личная задача Анны').trim(),
      description: (draft.description || '').trim(),
      dueDate: cleanDueDate,
      dueTime: cleanDueTime,
      priority: resolvedPriority,
      priorityReason: `Приоритет: ${
        resolvedPriority === 'high'
          ? 'высокий'
          : resolvedPriority === 'medium'
          ? 'средний'
          : 'обычный'
      }`,
      urgencyScore: resolvedPriority === 'high' ? 9 : resolvedPriority === 'medium' ? 6 : 3,
      importanceScore: resolvedPriority === 'high' ? 9 : resolvedPriority === 'medium' ? 6 : 4,
      estimatedMinutes: 30,
      status: 'new',
      schoolId: draft.schoolId || 'both',
      sourceType: 'manual',
      reminderDate: draft.wantsReminder ? draft.reminderDate : undefined,
      reminderTime: draft.wantsReminder ? (draft.reminderTime || '09:00') : undefined,
      reminderAt: draft.wantsReminder ? draft.reminderAt : undefined,
      reminderRepeat: draft.wantsReminder && draft.reminderAt ? 'none' : undefined,
      createdAt: formattedNow,
      createdAtMs: nowMs,
    };

    if (this.deps?.onSaveCompanionTask) {
      await this.deps.onSaveCompanionTask(newTask);
    } else {
      await storageProvider.saveCompanionTask(newTask);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('tasksUpdated', { detail: { task: newTask } })
      );
    }

    return newTask;
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

  private draftListeners = new Set<
    (draft: PixelPendingDelegationDraft | null) => void
  >();

  public onDraftChange(
    callback: (draft: PixelPendingDelegationDraft | null) => void
  ): () => void {
    this.draftListeners.add(callback);
    callback(this.getPendingConfirmationDraft());
    return () => {
      this.draftListeners.delete(callback);
    };
  }

  public notifyDraftListeners(
    draft: PixelPendingDelegationDraft | null
  ): void {
    for (const listener of this.draftListeners) {
      try {
        listener(draft ? { ...draft } : null);
      } catch (err) {
        console.error('Error in draft listener:', err);
      }
    }
  }

  public getTasks(): PixelDelegatedTaskState[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => b.updatedAtMs - a.updatedAtMs
    );
  }

  public getTaskById(taskId: string): PixelDelegatedTaskState | undefined {
    return this.tasks.get(taskId);
  }

  public getPendingRevisionDraft(): PixelPendingRevisionDraft | null {
    if (
      !this.pendingRevisionDraft ||
      this.pendingRevisionDraft.status !== 'awaiting_confirmation'
    ) {
      return null;
    }
    return { ...this.pendingRevisionDraft };
  }

  private loadTasksFromStorage(): void {
    try {
      const stored = window.localStorage.getItem(
        'kiber_renderia_coordinator_tasks_v1'
      );
      if (stored) {
        const parsed = JSON.parse(stored) as PixelDelegatedTaskState[];
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.taskId) {
              this.tasks.set(item.taskId, item);
            }
          }
        }
      }
    } catch {
      // ignore storage error
    }

    this.syncTasksWithCompanionMessages();
  }

  public saveTasksToStorage(): void {
    try {
      const all = this.getTasks();
      window.localStorage.setItem(
        'kiber_renderia_coordinator_tasks_v1',
        JSON.stringify(all)
      );
    } catch {
      // ignore
    }
  }

  public syncTasksWithCompanionMessages(): void {
    if (!this.deps) return;
    try {
      const msgs = this.deps.getCompanionMessages();
      for (const m of msgs) {
        if (m.delegatedTask && m.delegatedTask.taskId) {
          const existing = this.tasks.get(m.delegatedTask.taskId);
          if (!existing || m.delegatedTask.updatedAtMs >= existing.updatedAtMs) {
            this.tasks.set(m.delegatedTask.taskId, m.delegatedTask);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  public getLatestTaskForSpecialist(
    mode: AgentMode,
    schoolId?: SchoolId
  ): PixelDelegatedTaskState | undefined {
    this.syncTasksWithCompanionMessages();
    const all = this.getTasks();
    if (schoolId) {
      const exact = all.find(
        (t) => t.targetMode === mode && t.schoolId === schoolId
      );
      if (exact) return exact;
    }
    return all.find((t) => t.targetMode === mode);
  }

  public getLatestCompletedTask(
    mode?: AgentMode,
    schoolId?: SchoolId
  ): PixelDelegatedTaskState | undefined {
    this.syncTasksWithCompanionMessages();
    const all = this.getTasks();
    return all.find((t) => {
      if (t.status !== 'completed' && !t.resultText) return false;
      if (mode && t.targetMode !== mode) return false;
      if (schoolId && t.schoolId !== schoolId) return false;
      return true;
    });
  }

  /**
   * Reads the full specialist response for a task aloud using Pixel's unified voice.
   * Completely independent of which chat is open on the screen.
   */
  public async readTaskResult(taskId: string): Promise<boolean> {
    const task = this.getTaskById(taskId);
    if (
      !task ||
      task.status !== 'completed' ||
      !task.resultText ||
      !task.resultMessageId
    ) {
      this.showBubble(
        'Поручение ещё выполняется специалистом. Ответ пока готовится.'
      );
      return false;
    }

    const schoolCfg = SCHOOLS[task.schoolId];
    const modeCfg = AGENT_MODES[task.targetMode];

    this.showBubble(
      `Читаю полный ответ специалиста «${modeCfg.shortTitle}» (${schoolCfg.name})…`
    );

    try {
      await voiceManager.playVerbatimSpecialistMessage(
        task.resultMessageId || `task-${task.taskId}`,
        task.resultText,
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
      /(?:^|[^а-яёa-z0-9])(?:ответ|сообщени[ея]|результат|текст|всё|все|полностью|целиком|до\s+конца|что\s+(?:он|она|специалист|маркетолог|менеджер|методист|аналитик|дизайнер)\s+(?:ответил|написал|подготовил|предложил)|последн(?:ий|ее)|маркетолог(?:а|у)?|менеджер(?:а|у)?|методист(?:а|у)?|аналитик(?:а|у)?|дизайнер(?:а|у)?)(?=$|[^а-яёa-z0-9])/i.test(
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
   * Stage 6.4 (1): Detects natural commands to stop or pause ongoing read-aloud playback:
   * - «Стоп»
   * - «Останови чтение»
   * - «Хватит»
   * - «Пауза»
   * - «Перестань читать»
   */
  public parseStopReadingIntent(rawText: string): boolean {
    const text = (rawText || '').trim();
    if (!text || text.length < 3) return false;
    const lower = text.toLowerCase();
    return /^(?:пиксель[\s,:-]*)?(?:стоп|останови(?:те)?\s+(?:чтение|озвучку)|остановись|хватит|перестань(?:\s+читать)?|пауза|поставь\s+на\s+паузу|замолчи)(?:[\s.!,])*$/i.test(
      lower
    );
  }

  /**
   * Stage 6.4 (1), Stage 6.5 (1 & 4) & Coordinator Stage 6: Reads aloud the full specialist response
   * verbatim in sequential chunks using Pixel's single unified voice:
   * - Decoupled from currently open screen or chat: queries completed delegation tasks or specialist sessions directly.
   * - Never reports "no answer" if the specialist has already prepared an answer.
   * - Does NOT force-navigate the UI away when Anna is listening in Pixel's dialog.
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
    // 0. Immediately silence any active Live Voice conversational speech so voices never overlap!
    geminiLiveClient.stopModelAudioPlayback();

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

    // 1. Check if there is an active in-progress task for this specialist
    const tasks = Array.from(this.tasks.values());
    const inProgressTask = tasks.find(
      (t) =>
        t.targetMode === targetMode &&
        (t.status === 'in_progress' ||
          t.status === 'sent' ||
          t.status === 'created' ||
          t.status === 'waiting_for_reply')
    );
    if (inProgressTask) {
      const waitMsg = `Поручение успешно передано специалисту «${modeCfg.shortTitle}». Ответ ещё готовится, я сообщу, когда он будет готов.`;
      this.showBubble(waitMsg);
      return {
        success: false,
        specialistTitleRu: modeCfg.shortTitle,
        reason: waitMsg,
      };
    }

    // 2. Look up completed task directly in coordinator registry
    let textToRead = '';
    let messageIdToUse = '';
    let finalSchool = resolvedSchool;

    const completedTask =
      this.getLatestCompletedTask(targetMode, intent.targetSchool ? resolvedSchool : undefined) ||
      (!intent.targetSchool ? this.getLatestCompletedTask(targetMode) : undefined);

    if (
      completedTask &&
      completedTask.status === 'completed' &&
      completedTask.resultText &&
      completedTask.resultMessageId
    ) {
      textToRead = completedTask.resultText;
      messageIdToUse = completedTask.resultMessageId;
      finalSchool = completedTask.schoolId;
    } else {
      // 2. Look up specialist messages in all sessions for targetMode
      const sessions = this.deps?.getSessions() || [];
      let candidate = sessions.find(
        (s) => s.schoolId === resolvedSchool && s.mode === targetMode && s.messages.some((m) => m.role === 'assistant' && !m.isStreaming && m.content.trim())
      );

      if (!candidate && !intent.targetSchool) {
        const otherSchool: SchoolId = resolvedSchool === 'kiberone' ? 'renderia' : 'kiberone';
        candidate = sessions.find(
          (s) => s.schoolId === otherSchool && s.mode === targetMode && s.messages.some((m) => m.role === 'assistant' && !m.isStreaming && m.content.trim())
        );
        if (candidate) {
          finalSchool = otherSchool;
        }
      }

      if (candidate) {
        const validAssistantMsgs = candidate.messages.filter(
          (m) => !m.isStreaming && m.role === 'assistant' && m.content.trim().length > 0
        );
        if (validAssistantMsgs.length > 0) {
          const lastMsg = validAssistantMsgs[validAssistantMsgs.length - 1];
          textToRead = lastMsg.content;
          messageIdToUse = lastMsg.id;
        }
      }
    }

    const schoolCfg = SCHOOLS[finalSchool];

    if (!textToRead) {
      const noReplyMsg = `В диалогах специалиста «${modeCfg.shortTitle}» (${schoolCfg.name}) пока нет ответа для озвучивания.`;
      this.showBubble(noReplyMsg);
      return {
        success: false,
        specialistTitleRu: modeCfg.shortTitle,
        reason: noReplyMsg,
      };
    }

    // Check if this exact specialist message was previously stopped mid-reading and Anna asks to continue
    const stoppedSession = voiceManager.getStoppedReadingSession();
    const startChunkIndex =
      intent.isResume &&
      stoppedSession &&
      stoppedSession.originalMessageId === messageIdToUse
        ? stoppedSession.resumeChunkIndex
        : 0;

    const bubbleNotice =
      startChunkIndex > 0
        ? `Продолжаю дословное чтение ответа специалиста «${modeCfg.shortTitle}» (${schoolCfg.name})…`
        : `Читаю полный ответ специалиста «${modeCfg.shortTitle}» (${schoolCfg.name})…`;
    this.showBubble(bubbleNotice);

    try {
      await voiceManager.playVerbatimSpecialistMessage(
        messageIdToUse,
        textToRead,
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
      messageId: messageIdToUse,
    };
  }

  /**
   * Checks if Anna is responding affirmatively to Pixel's offer
   * «Специалист ответил на вашу задачу. Прочитать?»
   */
  public parseReadPendingTaskResponseIntent(
    rawText: string
  ): PixelDelegatedTaskState | null {
    if (this.pendingPersonalTaskDraft || this.pendingConfirmationDraft) {
      return null;
    }
    const text = (rawText || '').trim();
    if (!text) return null;
    const lower = text.toLowerCase();

    // Prevent matching on delegation or creation confirmation phrases
    if (/(?:отправляй|создавай|отправь|создай|запиши|добавь|удали|для\s+меня|для\s+специалиста)/i.test(lower)) {
      return null;
    }

    const isAffirmative =
      /^(?:да|давай|прочитай|зачитай|прочти|покажи|прочитать|показать|хорошо|да,?\s*прочитай|да,?\s*покажи|да,?\s*давай|покажи\s+ответ|прочитай\s+ответ|выведи\s+ответ|хочу\s+прочитать|конечно)[\s.!]*$/i.test(
        lower
      );

    if (!isAffirmative) return null;

    // Check if the latest companion message from Pixel was explicitly asking "ответил на вашу задачу. Прочитать?"
    const msgs = this.deps?.getCompanionMessages() || [];
    const lastPixelMsg = [...msgs].reverse().find((m) => m.role === 'pixel');
    if (
      lastPixelMsg &&
      lastPixelMsg.delegatedTask &&
      lastPixelMsg.delegatedTask.status === 'completed' &&
      lastPixelMsg.delegatedTask.resultText &&
      lastPixelMsg.delegatedTask.resultMessageId &&
      lastPixelMsg.content.includes('Прочитать?')
    ) {
      return lastPixelMsg.delegatedTask;
    }

    return null;
  }

  /**
   * Outputs the full original specialist response directly into Pixel's companion chat.
   */
  public async executeDisplayFullSpecialistResponse(
    task: PixelDelegatedTaskState,
    userCompanionMessage?: CompanionMessage
  ): Promise<void> {
    if (!this.deps || !task.resultText) return;
    const now = new Date();
    const nowMs = now.getTime();
    const modeCfg = AGENT_MODES[task.targetMode];
    const schoolCfg = SCHOOLS[task.schoolId];

    const replyMsg: CompanionMessage = {
      id: `comp-pixel-full-reply-${nowMs}`,
      role: 'pixel',
      content: `Вот полный оригинальный ответ специалиста **${modeCfg.shortTitle}** (${schoolCfg.name}):\n\n${task.resultText}`,
      createdAt: formatTimeNow(now),
      createdAtMs: nowMs,
      schoolId: task.schoolId,
      usedContextLabels: [
        `Специалист: ${modeCfg.shortTitle}`,
        `Школа: ${schoolCfg.name}`,
        'Оригинальный ответ специалиста',
      ],
      delegatedTask: task,
    };

    const current = this.deps.getCompanionMessages();
    const next = [...current];
    if (
      userCompanionMessage &&
      !next.some((m) => m.id === userCompanionMessage.id)
    ) {
      next.push(userCompanionMessage);
    }
    next.push(replyMsg);
    await this.deps.onSaveCompanionMessages(next);
  }

  /**
   * Stage 3 & 4: Detects natural questions asking Pixel about specialist responses, results, or task status:
   * - «Что ответил Маркетолог?»
   * - «Какой ответ у Маркетолога?»
   * - «Какой результат по задаче?»
   * - «Что там с поручением Маркетологу?»
   * - «Покажи ответ Маркетолога»
   * - «Что подготовил Методист?»
   */
  public parseInquireResultIntent(
    rawText: string,
    activeSchool: SchoolId
  ): ParsedInquireResultIntent | null {
    const text = (rawText || '').trim();
    if (text.length < 5) return null;

    // Do not conflict with explicit read aloud ("зачитай", "озвучь", "прочитай")
    if (this.parseReadAloudIntent(text, activeSchool)) return null;

    // Do not conflict with chat deletion or draft confirmations
    if (
      this.parseChatDeletionIntent(text, activeSchool) ||
      this.parsePendingDraftAction(text).action !== 'none' ||
      this.parsePendingRevisionAction(text).action !== 'none'
    ) {
      return null;
    }

    // Do not conflict with delegation verbs ("попроси", "поручи", "отправь", "напиши")
    if (
      /(?:^|[^а-яёa-z0-9])(?:попроси(?:те|ть)?|поручи(?:те|ть)?|напиши(?:те)?|отправь(?:те)?|передай(?:те)?|делегируй(?:те)?|дай(?:те)?\s+задачу|поставь(?:те)?\s+задачу)(?=$|[^а-яёa-z0-9])/i.test(
        text
      )
    ) {
      return null;
    }

    const lower = text.toLowerCase();

    // Check inquiry patterns
    const hasInquiryPattern =
      /(?:^|[^а-яёa-z0-9])(?:что\s+(?:ответил|сказал|написал|подготовил|предложил|сделал|выдал|там)|какой\s+(?:ответ|результат|вариант)|покажи(?:те)?\s+(?:ответ|результат|вариант)|есть\s+ли\s+ответ|готов\s+ли\s+ответ|ответил\s+ли|что\s+по\s+(?:задаче|поручению|запросу)|что\s+с\s+(?:задачей|поручением)|как\s+там\s+(?:задача|поручение)|результат\s+(?:поручения|задачи|работы)|итог\s+(?:поручения|задачи|работы))(?=$|[^а-яёa-z0-9])/i.test(
        lower
      ) ||
      /(?:^|[^а-яёa-z0-9])(?:ответ|результат)\s+(?:маркетолога|менеджера|методиста|аналитика|специалиста)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      );

    if (!hasInquiryPattern) return null;

    const specMatch = detectSpecialistFromText(lower);
    const explicitSchool = hasExplicitSchoolMention(text);
    const targetSchool = explicitSchool
      ? detectTargetSchoolFromText(text, activeSchool)
      : undefined;

    return {
      isInquiry: true,
      targetMode: specMatch.matched ? specMatch.mode : undefined,
      targetSchool,
      hasExplicitSchool: explicitSchool,
      originalText: text,
    };
  }

  /**
   * Stage 3 & 4: Executes coordinator result retrieval:
   * - Locates latest completed or processing task for requested specialist & school regardless of open screen.
   * - Generates structured response in Pixel's dialog with TL;DR, critique, and proposed next actions.
   */
  public async executeInquireResult(
    intent: ParsedInquireResultIntent,
    sourceMode: 'text' | 'voice' = 'text',
    userCompanionMessage?: CompanionMessage
  ): Promise<void> {
    if (!this.deps) return;
    const activeSchool = this.deps.getActiveSchool();
    const targetMode = intent.targetMode || this.resolveActiveAgentMode();
    const targetSchool: SchoolId = intent.targetSchool || activeSchool;
    const modeCfg = AGENT_MODES[targetMode];
    const schoolCfg = SCHOOLS[targetSchool];
    const genitiveName = SPECIALIST_NAMES_GENITIVE_RU[targetMode];

    const task =
      this.getLatestTaskForSpecialist(targetMode, intent.targetSchool ? targetSchool : undefined) ||
      this.getLatestCompletedTask(targetMode);

    const now = new Date();
    const nowMs = now.getTime();

    // 1. Task currently processing
    if (
      task &&
      (task.status === 'in_progress' ||
        task.status === 'processing' ||
        task.status === 'reviewing' ||
        task.status === 'created')
    ) {
      const inProgressReply: CompanionMessage = {
        id: `comp-pixel-inq-${nowMs}`,
        role: 'pixel',
        content: `Анна, поручение для **${genitiveName}** (${schoolCfg.name}) по запросу «*${task.instruction}*» сейчас находится в процессе выполнения в чате «*${task.sessionTitle || schoolCfg.name}*».\n\nКак только специалист завершит ответ, я сразу проведу анализ качества и пришлю вам отчёт прямо сюда!`,
        createdAt: formatTimeNow(now),
        createdAtMs: nowMs,
        schoolId: task.schoolId,
        usedContextLabels: [
          `Статус: ${task.statusLabelRu}`,
          `Специалист: ${modeCfg.shortTitle}`,
          `Школа: ${SCHOOLS[task.schoolId].name}`,
        ],
        delegatedTask: task,
      };

      const existing = this.deps.getCompanionMessages();
      const nextMsgs = userCompanionMessage
        ? [...existing, userCompanionMessage, inProgressReply]
        : [...existing, inProgressReply];
      await this.deps.onSaveCompanionMessages(nextMsgs);

      this.showBubble(
        `${modeCfg.shortTitle} (${SCHOOLS[task.schoolId].name}) ещё выполняет задачу в чате.`
      );
      if (sourceMode === 'voice') {
        this.deps.onNotifyLiveVoice?.(
          `Системное уведомление: ${modeCfg.shortTitle} (${SCHOOLS[task.schoolId].name}) ещё выполняет задачу в чате «${task.sessionTitle}». Сообщи Анне коротко (1 фраза), что специалист сейчас в процессе и ответ скоро будет готов.`
        );
      }
      return;
    }

    // 2. Task completed with resultText
    if (task && task.status === 'completed' && task.resultText) {
      const analysis = task.analysis;
      const brief =
        analysis?.briefSummary ||
        task.reviewSummary ||
        task.resultText.slice(0, 220) + '…';
      const taskSchoolCfg = SCHOOLS[task.schoolId];

      const reportContent = [
        `Анна, вот результат по поручению для **${SPECIALIST_NAMES_GENITIVE_RU[task.targetMode]}** (${taskSchoolCfg.name}):`,
        ``,
        `• **Исходный запрос:** «${task.instruction}»`,
        `• **Краткая выжимка (TL;DR):** ${brief}`,
        ``,
        `**Оценка Пикселя:**`,
        `• Вопрос решён: ${analysis?.allQuestionsAnswered !== false ? '✅ Да, вопрос проработан' : '⚠️ Требует дополнения'}`,
        `• Специфика школы: ${analysis?.schoolConsidered !== false ? `✅ Учтена (${taskSchoolCfg.name})` : '⚠️ Общие слова'}`,
        analysis?.actionableRecommendations && analysis.actionableRecommendations.length > 0
          ? `• Практические рекомендации: ${analysis.actionableRecommendations.slice(0, 3).join('; ')}`
          : '',
        analysis?.critiqueRemarks && analysis.critiqueRemarks.length > 0
          ? `• Замечания: ${analysis.critiqueRemarks.slice(0, 2).join('; ')}`
          : '',
        analysis?.proposedNextSteps && analysis.proposedNextSteps.length > 0
          ? `\n**Рекомендуемые следующие шаги:**\n${analysis.proposedNextSteps.map((s) => `– ${s}`).join('\n')}`
          : '',
        ``,
        `Вы можете нажать **«Озвучить ответ»**, чтобы я прочитал его вслух, или **«Запросить доработку»**, если нужно внести изменения.`,
      ]
        .filter(Boolean)
        .join('\n');

      const completedInqReply: CompanionMessage = {
        id: `comp-pixel-inq-${nowMs}`,
        role: 'pixel',
        content: reportContent,
        createdAt: formatTimeNow(now),
        createdAtMs: nowMs,
        schoolId: task.schoolId,
        usedContextLabels: [
          `Специалист: ${AGENT_MODES[task.targetMode].shortTitle}`,
          `Школа: ${taskSchoolCfg.name}`,
          'Результат поручения',
        ],
        delegatedTask: task,
      };

      const existing = this.deps.getCompanionMessages();
      const nextMsgs = userCompanionMessage
        ? [...existing, userCompanionMessage, completedInqReply]
        : [...existing, completedInqReply];
      await this.deps.onSaveCompanionMessages(nextMsgs);

      this.showBubble(
        `${AGENT_MODES[task.targetMode].shortTitle} (${taskSchoolCfg.name}): ${brief.slice(0, 90)}…`
      );

      if (sourceMode === 'voice') {
        this.deps.onNotifyLiveVoice?.(
          `Системное уведомление: Анна спросила результат ${SPECIALIST_NAMES_GENITIVE_RU[task.targetMode]} (${taskSchoolCfg.name}). Краткая выжимка: ${brief}. Зачитай Анне краткую выжимку (2-3 фразы) и предложи озвучить полный ответ или отправить замечания.`
        );
      }
      return;
    }

    // 3. Fallback: check session history
    const sessions = this.deps.getSessions();
    const candidateSessions = sessions.filter(
      (s) => s.schoolId === targetSchool && s.mode === targetMode
    );
    let candidateReply: { text: string; id: string; sessionTitle: string; sessionId: string } | null = null;
    for (const sess of candidateSessions) {
      const assistantMsgs = (sess.messages || []).filter(
        (m) => !m.isStreaming && m.role === 'assistant' && m.content.trim().length > 0
      );
      if (assistantMsgs.length > 0) {
        const last = assistantMsgs[assistantMsgs.length - 1];
        candidateReply = {
          text: last.content,
          id: last.id,
          sessionTitle: sess.title,
          sessionId: sess.id,
        };
        break;
      }
    }

    if (candidateReply) {
      const snippet =
        candidateReply.text.slice(0, 300) +
        (candidateReply.text.length > 300 ? '…' : '');
      const replyContent = [
        `Анна, в чате «*${candidateReply.sessionTitle}*» есть ответ от **${genitiveName}** (${schoolCfg.name}):`,
        ``,
        snippet,
        ``,
        `Вы можете нажать **«Озвучить ответ»** ниже или открыть рабочий чат специалиста.`,
      ].join('\n');

      const fallbackReplyMsg: CompanionMessage = {
        id: `comp-pixel-inq-${nowMs}`,
        role: 'pixel',
        content: replyContent,
        createdAt: formatTimeNow(now),
        createdAtMs: nowMs,
        schoolId: targetSchool,
        usedContextLabels: [
          `Специалист: ${modeCfg.shortTitle}`,
          `Школа: ${schoolCfg.name}`,
          `Чат: ${candidateReply.sessionTitle}`,
        ],
      };

      const existing = this.deps.getCompanionMessages();
      const nextMsgs = userCompanionMessage
        ? [...existing, userCompanionMessage, fallbackReplyMsg]
        : [...existing, fallbackReplyMsg];
      await this.deps.onSaveCompanionMessages(nextMsgs);
      this.showBubble(
        `Ответ ${genitiveName} (${schoolCfg.name}) найден в чате «${candidateReply.sessionTitle}».`
      );
      return;
    }

    // 4. No answers found
    const notFoundReply: CompanionMessage = {
      id: `comp-pixel-inq-${nowMs}`,
      role: 'pixel',
      content: `Анна, в диалогах **${genitiveName}** (${schoolCfg.name}) пока нет выполненных поручений или ответов.\n\nХотите, я подготовлю для него задачу? Напишите или скажите, что нужно сделать (например: *«Поручи Маркетологу составить план постов на неделю»*).`,
      createdAt: formatTimeNow(now),
      createdAtMs: nowMs,
      schoolId: targetSchool,
      usedContextLabels: [
        `Специалист: ${modeCfg.shortTitle}`,
        `Школа: ${schoolCfg.name}`,
        'Нет выполненных задач',
      ],
    };

    const existing = this.deps.getCompanionMessages();
    const nextMsgs = userCompanionMessage
      ? [...existing, userCompanionMessage, notFoundReply]
      : [...existing, notFoundReply];
    await this.deps.onSaveCompanionMessages(nextMsgs);
    this.showBubble(
      `В чате ${genitiveName} (${schoolCfg.name}) пока нет ответов.`
    );
  }

  /**
   * Stage 5: Detects when Anna wants to request a revision from a specialist:
   * - «Попроси его доработать: ...»
   * - «Попроси Маркетолога дополнить: ...»
   * - «Пусть добавит смету и сроки»
   * - «Отправь на доработку: ...»
   */
  public parseRevisionIntent(
    rawText: string,
    activeSchool: SchoolId
  ): ParsedRevisionIntent | null {
    const text = (rawText || '').trim();
    if (text.length < 5) return null;

    if (
      this.parseReadAloudIntent(text, activeSchool) ||
      this.parsePendingDraftAction(text).action !== 'none' ||
      this.parsePendingRevisionAction(text).action !== 'none' ||
      this.parseChatDeletionIntent(text, activeSchool)
    ) {
      return null;
    }

    const lower = text.toLowerCase();

    const isRevisionCommand =
      /(?:^|[^а-яёa-z0-9])(?:попроси(?:те|ть)?\s+(?:его\s+|её\s+|ее\s+|специалиста\s+|маркетолога\s+|менеджера\s+|методиста\s+|аналитика\s+)?(?:доработать|переделать|уточнить|исправить|дополнить|сократить|расширить|добавить)|пусть\s+(?:он|она|специалист|маркетолог|менеджер|методист|аналитик)\s+(?:доработает|добавит|уточнит|переделает|исправит|распишет|расширит|сократит)|отправь(?:те)?\s+(?:на\s+доработку|замечания|уточнения|доработку)|надо\s+(?:доработать|дополнить|уточнить|исправить)|нужно\s+(?:доработать|дополнить|уточнить|исправить))(?=$|[^а-яёa-z0-9])/i.test(
        lower
      );

    if (!isRevisionCommand) return null;

    const specMatch = detectSpecialistFromText(lower);
    const explicitSchool = hasExplicitSchoolMention(text);
    const targetSchool = explicitSchool
      ? detectTargetSchoolFromText(text, activeSchool)
      : undefined;

    let cleanPrompt = text
      .replace(/^(?:пиксель[\s,.:!-]*)+/i, '')
      .replace(/^(?:пожалуйста[\s,.:!-]*)+/i, '')
      .replace(
        /^(?:попроси(?:те|ть)?\s+(?:его\s+|её\s+|ее\s+|специалиста\s+|маркетолога\s+|менеджера\s+|методиста\s+|аналитика\s+)?(?:доработать|переделать|уточнить|исправить|дополнить|сократить|расширить|добавить))[\s,.:;-]*/i,
        ''
      )
      .replace(
        /^пусть\s+(?:он|она|специалист|маркетолог|менеджер|методист|аналитик)\s+(?:доработает|добавит|уточнит|переделает|исправит|распишет|расширит|сократит)[\s,.:;-]*/i,
        ''
      )
      .replace(
        /^(?:отправь(?:те)?\s+(?:на\s+доработку|замечания|уточнения|доработку)|надо\s+(?:доработать|дополнить|уточнить|исправить)|нужно\s+(?:доработать|дополнить|уточнить|исправить))[\s,.:;-]*/i,
        ''
      )
      .trim();

    if (!cleanPrompt || cleanPrompt.length < 3) {
      cleanPrompt = text;
    }

    return {
      isRevision: true,
      targetMode: specMatch.matched ? specMatch.mode : undefined,
      targetSchool,
      hasExplicitSchool: explicitSchool,
      revisionPrompt: cleanPrompt,
      originalText: text,
    };
  }

  /**
   * Stage 5: Parses whether Anna is confirming («Да, отправляй») or cancelling a revision draft.
   */
  public parsePendingRevisionAction(
    rawText: string
  ): ParsedPendingRevisionAction {
    const draft = this.getPendingRevisionDraft();
    if (!draft) return { action: 'none' };

    const text = (rawText || '').trim();
    if (!text) return { action: 'none' };
    const lower = text.toLowerCase();

    if (
      /^(?:нет[\s,.-]*)?(?:не\s+отправляй(?:те)?|не\s+надо|не\s+нужно|отмена|отменить|отмени(?:\s+отправку)?|стоп|оставь)(?:[\s.!])*$/i.test(
        lower
      )
    ) {
      return { action: 'cancel', draft };
    }

    if (
      /^(?:пиксель[\s,:-]*)?(?:да[\s,!-]*)*(?:отправляй(?:те)?|отправь(?:те)?|да,\s*отправляй(?:те)?|да,\s*отправь(?:те)?|подтверждаю|посылай|запускай|согласна|да|ок|хорошо|давай)[\s.!]*$/i.test(
        lower
      )
    ) {
      return { action: 'confirm', draft };
    }

    return { action: 'none' };
  }

  /**
   * Stage 5 & 7: Prepares a revision draft for Anna's confirmation.
   * Strictly never sends to specialist until confirmed.
   */
  public async prepareRevisionForConfirmation(params: {
    intent: ParsedRevisionIntent;
    sourceMode: 'text' | 'voice';
    userCompanionMessage?: CompanionMessage;
  }): Promise<PixelPendingRevisionDraft | null> {
    if (!this.deps) return null;
    const { intent, sourceMode, userCompanionMessage } = params;
    const activeSchool = this.deps.getActiveSchool();
    const targetMode = intent.targetMode || this.resolveActiveAgentMode();
    const targetSchool = intent.targetSchool || activeSchool;
    const modeCfg = AGENT_MODES[targetMode];
    const schoolCfg = SCHOOLS[targetSchool];
    const genitiveName = SPECIALIST_NAMES_GENITIVE_RU[targetMode];
    const dativeName = SPECIALIST_NAMES_DATIVE_RU[targetMode];

    const task =
      this.getLatestTaskForSpecialist(targetMode, intent.targetSchool ? targetSchool : undefined) ||
      this.getLatestCompletedTask(targetMode);

    let targetSessionId = task?.sessionId;
    let targetSessionTitle =
      task?.sessionTitle || `${modeCfg.shortTitle} · ${schoolCfg.name}`;

    if (!targetSessionId) {
      const sessions = this.deps.getSessions();
      const sess = sessions.find(
        (s) => s.schoolId === targetSchool && s.mode === targetMode
      );
      if (sess) {
        targetSessionId = sess.id;
        targetSessionTitle = sess.title;
      }
    }

    if (!targetSessionId) {
      const noSessMsg: CompanionMessage = {
        id: `comp-pixel-rev-nosess-${Date.now()}`,
        role: 'pixel',
        content: `Анна, я не нашёл активного диалога с **${genitiveName}** (${schoolCfg.name}), чтобы отправить доработку. Сначала создайте задачу для специалиста.`,
        createdAt: formatTimeNow(new Date()),
        createdAtMs: Date.now(),
      };
      const existing = this.deps.getCompanionMessages();
      await this.deps.onSaveCompanionMessages(
        userCompanionMessage
          ? [...existing, userCompanionMessage, noSessMsg]
          : [...existing, noSessMsg]
      );
      return null;
    }

    const now = new Date();
    const nowMs = now.getTime();
    const revisionDraftId = `prevdraft-${nowMs}-${Math.random().toString(36).slice(2, 6)}`;
    const iteration = (task?.iterationCount || 0) + 1;
    const cleanInstruction = buildCleanBusinessInstruction(
      intent.revisionPrompt,
      targetSchool
    );

    const revisionDraft: PixelPendingRevisionDraft = {
      revisionDraftId,
      taskId: task?.taskId || `ptask-${nowMs}`,
      schoolId: targetSchool,
      targetMode,
      targetSpecialistNameRu: modeCfg.shortTitle,
      sessionId: targetSessionId,
      sessionTitle: targetSessionTitle,
      iteration,
      revisionPrompt: intent.revisionPrompt,
      cleanInstruction,
      status: 'awaiting_confirmation',
      createdAt: formatTimeNow(now),
      createdAtMs: nowMs,
      sourceMode,
    };

    this.pendingRevisionDraft = revisionDraft;

    const draftMsg: CompanionMessage = {
      id: `comp-pixel-rev-card-${revisionDraftId}`,
      role: 'pixel',
      content: [
        `Анна, я подготовил запрос на доработку #${iteration} для **${genitiveName}** (${schoolCfg.name}) в чат «*${targetSessionTitle}*»:`,
        ``,
        `• **Специалист:** ${modeCfg.shortTitle}`,
        `• **Школа:** ${schoolCfg.name}`,
        `• **Текст доработки:** «${cleanInstruction}»`,
        ``,
        `Отправить этот запрос специалисту? Скажите или напишите **«Да, отправляй»** (или нажмите кнопку ниже).`,
      ].join('\n'),
      createdAt: formatTimeNow(new Date(nowMs + 1)),
      createdAtMs: nowMs + 1,
      schoolId: targetSchool,
      usedContextLabels: [
        `Школа: ${schoolCfg.name}`,
        `Специалист: ${modeCfg.shortTitle}`,
        `Доработка #${iteration}`,
        'Ожидает подтверждения: «Да, отправляй»',
      ],
      pendingRevisionDraft: revisionDraft,
    };

    const existing = this.deps.getCompanionMessages().map((m) =>
      m.pendingRevisionDraft &&
      m.pendingRevisionDraft.status === 'awaiting_confirmation'
        ? {
            ...m,
            pendingRevisionDraft: {
              ...m.pendingRevisionDraft,
              status: 'cancelled' as const,
            },
          }
        : m
    );

    const next = userCompanionMessage
      ? [...existing, userCompanionMessage, draftMsg]
      : [...existing, draftMsg];
    await this.deps.onSaveCompanionMessages(next);
    this.showBubble(
      `Подготовлена доработка для ${genitiveName} (${schoolCfg.name}). Подтвердите: «Да, отправляй».`
    );

    if (sourceMode === 'voice') {
      this.deps.onNotifyLiveVoice?.(
        `Системное уведомление: Подготовлен запрос на доработку для ${genitiveName} (${schoolCfg.name}): «${cleanInstruction}». Запрос ждёт подтверждения Анны. Спроси Анну: «Отправить доработку ${dativeName}? Скажите: Да, отправляй».`
      );
    }

    return revisionDraft;
  }

  /**
   * Stage 5: Confirms and dispatches the revision to the exact same specialist chat.
   */
  public async confirmPendingRevision(params?: {
    draftId?: string;
    sourceMode?: 'text' | 'voice';
    userCompanionMessage?: CompanionMessage;
  }): Promise<PixelDelegatedTaskState | null> {
    if (!this.deps) return null;
    const targetId =
      params?.draftId || this.pendingRevisionDraft?.revisionDraftId;
    const draft =
      (this.pendingRevisionDraft &&
      (!targetId || this.pendingRevisionDraft.revisionDraftId === targetId)
        ? this.pendingRevisionDraft
        : null) ||
      this.deps
        .getCompanionMessages()
        .find(
          (m) =>
            m.pendingRevisionDraft &&
            (!targetId ||
              m.pendingRevisionDraft.revisionDraftId === targetId) &&
            m.pendingRevisionDraft.status === 'awaiting_confirmation'
        )?.pendingRevisionDraft ||
      null;

    if (!draft) return null;
    if (this.dispatchedDraftIds.has(draft.revisionDraftId)) return null;
    this.dispatchedDraftIds.add(draft.revisionDraftId);
    draft.status = 'confirmed';
    this.pendingRevisionDraft = null;

    const updatedMessages = this.deps.getCompanionMessages().map((m) =>
      m.pendingRevisionDraft?.revisionDraftId === draft.revisionDraftId
        ? {
            ...m,
            pendingRevisionDraft: {
              ...m.pendingRevisionDraft,
              status: 'confirmed' as const,
            },
          }
        : m
    );
    await this.deps.onSaveCompanionMessages(updatedMessages);

    const delegationIntent: ParsedDelegationIntent = {
      isDelegation: true,
      isSupportedSpecialist: true,
      targetMode: draft.targetMode,
      targetSpecialistNameRu: draft.targetSpecialistNameRu,
      targetSchool: draft.schoolId,
      instruction: draft.revisionPrompt,
      cleanInstruction: draft.cleanInstruction,
      originalText: draft.revisionPrompt,
      preferredSessionId: draft.sessionId,
      isFollowUp: true,
    };

    return await this.executeDelegation({
      intent: delegationIntent,
      sourceMode: params?.sourceMode || 'text',
      userCompanionMessage: params?.userCompanionMessage,
      existingTaskId: draft.taskId,
      isRevisionExecution: true,
      revisionIteration: draft.iteration,
    });
  }

  /**
   * Stage 5: Cancels a pending revision draft.
   */
  public async cancelPendingRevision(
    draftId?: string,
    userCompanionMessage?: CompanionMessage
  ): Promise<void> {
    if (!this.deps) return;
    const targetId = draftId || this.pendingRevisionDraft?.revisionDraftId;
    if (
      this.pendingRevisionDraft &&
      (!targetId || this.pendingRevisionDraft.revisionDraftId === targetId)
    ) {
      this.pendingRevisionDraft = null;
    }

    const current = this.deps.getCompanionMessages();
    const updated = current.map((m) =>
      m.pendingRevisionDraft &&
      (!targetId || m.pendingRevisionDraft.revisionDraftId === targetId) &&
      m.pendingRevisionDraft.status === 'awaiting_confirmation'
        ? {
            ...m,
            pendingRevisionDraft: {
              ...m.pendingRevisionDraft,
              status: 'cancelled' as const,
            },
          }
        : m
    );

    if (userCompanionMessage) {
      const now = new Date();
      const cancelReply: CompanionMessage = {
        id: `comp-pixel-rev-cancel-${now.getTime()}`,
        role: 'pixel',
        content:
          'Хорошо, Анна! Отправка доработки отменена — специалисту ничего не отправлено.',
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

    this.showBubble('Отправка доработки отменена.');
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

  public setPendingClarificationMode(mode: AgentMode, schoolId: SchoolId): void {
    this.pendingClarification = {
      targetMode: mode,
      targetSchool: schoolId,
      createdAtMs: Date.now(),
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

    // Do NOT switch Anna's screen when asking a clarification question
    const matchingChats = this.getAllWorkingChats().filter(
      (c) => c.schoolId === intent.targetSchool && c.mode === intent.targetMode
    );
    void matchingChats;

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
    if (
      this.pendingConfirmationDraft &&
      this.pendingConfirmationDraft.status === 'awaiting_confirmation'
    ) {
      return { ...this.pendingConfirmationDraft };
    }
    if (this.deps) {
      const msgs = this.deps.getCompanionMessages();
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (
          m.pendingDelegationDraft &&
          m.pendingDelegationDraft.status === 'awaiting_confirmation'
        ) {
          this.pendingConfirmationDraft = m.pendingDelegationDraft;
          return { ...m.pendingDelegationDraft };
        }
      }
    }
    return null;
  }

  public getLatestAwaitingConfirmationDraft(): PixelPendingDelegationDraft | null {
    return this.getPendingConfirmationDraft();
  }

  /**
   * Refines raw instruction into an actionable professional business specification (ТЗ)
   * using LLM (Gemini) or rule-based fallback.
   * Strips conversational parasites and parasitic commands («напиши», «скажи», «попроси»).
   */
  public async refineInstructionIntoBusinessSpec(
    rawText: string,
    targetMode: AgentMode,
    targetSchool: SchoolId
  ): Promise<string> {
    const fallback = buildCleanBusinessInstruction(rawText, targetSchool, targetMode);
    try {
      const schoolCfg = SCHOOLS[targetSchool];
      const modeCfg = AGENT_MODES[targetMode];
      const prompt = [
        `Ты — координатор. Твоя задача — формулировать четкие ТЗ для специалистов, убирая из речи пользователя слова-паразиты и команды (напиши, скажи, попроси и т.д.).`,
        ``,
        `Запрос управляющей Анны: "${rawText}"`,
        `Специалист: ИИ-${modeCfg.shortTitle}`,
        `Школа: ${schoolCfg.name}`,
        ``,
        `Инструкция по формированию ТЗ:`,
        `- Сформулируй четкое, конкретное ТЗ для специалиста в деловом тоне от лица руководителя.`,
        `- Исключи любые слова-паразиты и вводные команды («напиши», «скажи», «попроси», «узнай», «спроси», «передай»).`,
        `- Если запрос абстрактный («какую задачу поставить», «что делать»), сформулируй профессиональное задание (например: «Сформулируйте варианты ключевых задач и регламент реализации для...»).`,
        `- Используй уважительное повелительное наклонение множественного числа («Разработайте...», «Подготовьте...», «Предложите...»).`,
        `- Верни ТОЛЬКО готовый текст ТЗ (1–3 предложения), без кавычек и вводных слов.`,
      ].join('\n');

      const response = await fetch('/api/gemini/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolId: targetSchool,
          mode: 'pixel',
          sessionId: `pixel-refine-spec-${Date.now()}`,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const text = typeof data.text === 'string' ? data.text.trim() : '';
        if (text && text.length >= 8 && !/^(?:напиши|скажи|попроси|передай)\b/i.test(text)) {
          return buildCleanBusinessInstruction(text, targetSchool, targetMode);
        }
      }
    } catch {
      // Fallback to rule-based spec builder
    }
    return fallback;
  }

  /**
   * Stage 6.4 (2) & Stage 6.5 (1 & 2): Prepares a delegation draft, autonomously finds/opens
   * the target specialist's working chat (so Anna never has to switch manually), and presents the draft
   * for explicit confirmation («Подтвердить и отправить»). Strictly NEVER sends anything until confirmed.
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
    const allMentioned = detectAllSpecialistsFromText(intent.originalText.toLowerCase());
    const targetModes =
      intent.targetModes && intent.targetModes.length > 0
        ? intent.targetModes
        : allMentioned.length > 0
        ? allMentioned
        : [targetMode];

    const schoolCfg = SCHOOLS[targetSchool];
    const modeCfg = AGENT_MODES[targetMode];
    const genitiveName = SPECIALIST_NAMES_GENITIVE_RU[targetMode];

    const cleanInstruction =
      intent.cleanInstruction ||
      (await this.refineInstructionIntoBusinessSpec(
        intent.instruction || intent.originalText,
        targetMode,
        targetSchool
      ));

    // Find existing working chat without forcibly switching Anna's main screen
    const matchingChats = this.getAllWorkingChats().filter(
      (c) => c.schoolId === targetSchool && c.mode === targetMode
    );
    const switchedItem =
      (intent.preferredSessionId
        ? matchingChats.find((c) => c.sessionId === intent.preferredSessionId)
        : undefined) || matchingChats[0] || null;

    const draft: PixelPendingDelegationDraft = {
      draftId,
      targetSchool,
      targetMode,
      targetModes,
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
    this.notifyDraftListeners(draft);

    const specialistsText = targetModes
      .map((m) => AGENT_MODES[m].shortTitle)
      .join(', ');

    const previewContent = `Анна, я подготовил черновик поручения для **${genitiveName}** (${schoolCfg.name}). Пожалуйста, проверьте специалистов и текст перед отправкой:`;

    const pixelDraftMsg: CompanionMessage = {
      id: `comp-pixel-draft-${draftId}`,
      role: 'pixel',
      content: previewContent,
      createdAt: formatTimeNow(new Date(nowMs + 1)),
      createdAtMs: nowMs + 1,
      schoolId: targetSchool,
      usedContextLabels: [
        `Школа: ${schoolCfg.name}`,
        `Специалист: ${specialistsText}`,
        `Чат: ${draft.sessionTitle}`,
        'Ожидает подтверждения: «Подтвердить и отправить»',
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
      `Переключился на ${genitiveName} ${schoolCfg.name}. Подтвердите: «Подтвердить и отправить».`
    );

    if (sourceMode === 'voice') {
      this.deps.onNotifyLiveVoice?.(
        `Системное уведомление: Чат переключён на ${genitiveName} ${schoolCfg.name}. Поручение ещё НЕ отправлено и ждёт подтверждения Анны. Озвучь Анне коротко: «Переключился на ${genitiveName} ${schoolCfg.name}. Текст поручения: ${cleanInstruction}. Отправлять? Скажите: Да, отправляй»`
      );
    }

    return draft;
  }

  /**
   * Stage 6.4 (2) & Stage 6.5 (1): Updates school, specialists, target session, or instruction text
   * on a pending draft before confirmation, and switches the open workspace accordingly.
   */
  public async updatePendingDelegationDraft(
    draftId: string,
    patch: {
      targetSchool?: SchoolId;
      targetMode?: AgentMode;
      targetModes?: AgentMode[];
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
    const nextModes =
      patch.targetModes && patch.targetModes.length > 0
        ? patch.targetModes
        : patch.targetMode
        ? [patch.targetMode]
        : currentDraft.targetModes || [currentDraft.targetMode];
    const nextMode = patch.targetMode || nextModes[0] || currentDraft.targetMode;
    const schoolCfg = SCHOOLS[nextSchool];
    const modeCfg = AGENT_MODES[nextMode];
    const genitiveName = SPECIALIST_NAMES_GENITIVE_RU[nextMode];

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
      targetModes: nextModes,
      targetSpecialistNameRu: modeCfg.shortTitle,
      cleanInstruction: nextInstruction,
      sessionId: switchedItem?.sessionId || currentDraft.sessionId,
      sessionTitle:
        switchedItem?.sessionTitle ||
        `${modeCfg.shortTitle} · ${schoolCfg.name}`,
    };

    this.pendingConfirmationDraft = updatedDraft;
    this.notifyDraftListeners(updatedDraft);

    const specialistsText = nextModes
      .map((m) => AGENT_MODES[m].shortTitle)
      .join(', ');

    const previewContent = `Анна, я обновил параметры поручения перед отправкой (${specialistsText} · ${schoolCfg.name}):`;

    const updatedMessages = this.deps.getCompanionMessages().map((m) =>
      m.pendingDelegationDraft?.draftId === draftId
        ? {
            ...m,
            content: previewContent,
            schoolId: nextSchool,
            usedContextLabels: [
              `Школа: ${schoolCfg.name}`,
              `Специалист: ${specialistsText}`,
              `Чат: ${updatedDraft.sessionTitle}`,
              'Ожидает подтверждения: «Подтвердить и отправить»',
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
      this.notifyDraftListeners(null);
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
   * Supports edited instruction text from <textarea> and dispatching to multiple specialists.
   * Protected by `dispatchedDraftIds` so duplicate clicks or voice events never send twice.
   */
  public async confirmPendingDelegation(params?: {
    draftId?: string;
    sourceMode?: 'text' | 'voice';
    userCompanionMessage?: CompanionMessage;
    editedInstruction?: string;
    targetModes?: AgentMode[];
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
    this.notifyDraftListeners(null);

    const finalInstruction = (
      params?.editedInstruction !== undefined
        ? params.editedInstruction.trim()
        : draft.cleanInstruction
    ) || draft.cleanInstruction;

    const modesToDispatch =
      params?.targetModes && params.targetModes.length > 0
        ? params.targetModes
        : draft.targetModes && draft.targetModes.length > 0
        ? draft.targetModes
        : [draft.targetMode];

    // Mark the draft card as confirmed in companionMessages
    const currentMsgs = this.deps.getCompanionMessages();
    const updatedMsgs = currentMsgs.map((m) =>
      m.pendingDelegationDraft?.draftId === draft.draftId
        ? {
            ...m,
            pendingDelegationDraft: {
              ...m.pendingDelegationDraft,
              cleanInstruction: finalInstruction,
              targetModes: modesToDispatch,
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

    let primaryResult: PixelDelegatedTaskState | null = null;
    for (let i = 0; i < modesToDispatch.length; i++) {
      const mode = modesToDispatch[i];
      const confirmedIntent: ParsedDelegationIntent = {
        isDelegation: true,
        isSupportedSpecialist: true,
        targetMode: mode,
        targetModes: modesToDispatch,
        targetSpecialistNameRu: AGENT_MODES[mode].shortTitle,
        targetSchool: draft.targetSchool,
        instruction: finalInstruction,
        cleanInstruction: finalInstruction,
        originalText: draft.originalUserRequest,
        isFollowUp: draft.isFollowUp,
        isAmbiguous: false,
        preferredSessionId: i === 0 ? draft.sessionId : undefined,
      };

      const result = await this.executeDelegation({
        intent: confirmedIntent,
        sourceMode: params?.sourceMode || draft.sourceMode,
        skipAddingUserCompanionMessage: i > 0,
      });

      if (i === 0) {
        primaryResult = result;
      }
    }

    return primaryResult;
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

    // 1. Check explicit cancellation first («не отправляй», «отмена», «нет, не надо», «стоп», «отбой»)
    if (
      /^(?:нет[\s,.-]*)?(?:не\s+отправляй(?:те)?|не\s+надо(?:\s+отправлять)?|не\s+нужно(?:\s+отправлять)?|отмена|отменить|отмени(?:\s+отправку|\s+поручение)?|стоп|отбой)$/i.test(
        lower
      )
    ) {
      return { action: 'cancel', draft };
    }

    // 2. Check explicit confirmation («Да», «Да, отправляй», «Отправляй», «Подтверждаю», «Всё верно»)
    const isExplicitConfirm =
      /^(?:пиксель[\s,:-]*)?(?:да|ага|ок|хорошо|верно|всё\s+верно|отлично|подтверждаю|отправляй|отправь|запускай)(?:[\s,!-]+(?:да|ага|ок|хорошо|верно|всё\s+верно|отлично|подтверждаю|отправляй(?:те)?|отправь(?:те)?|запускай(?:те)?|поручение|сообщение|задачу|ему|ей))*[\s.!]*$/i.test(
        lower
      ) ||
      /^(?:да|отправляй|отправь|подтверждаю|всё\s+верно)[\s.!]*/i.test(lower);

    if (isExplicitConfirm) {
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

    return { action: 'none', draft };
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

    // Task creation triggers («поставь задачу», «новая задача», «добавь задачу», «создай задачу», etc.) must ALWAYS start the Task Wizard instead of skipping to direct delegation
    const isTaskWizardTrigger =
      /^(?:пиксель[\s,:-]*)?(?:пожалуйста[\s,:-]*)?(?:поставь\s+задачу|создай\s+задачу|добавь\s+задачу|запиши\s+задачу|запланируй\s+задачу|сделай\s+задачу|напомни(?:те)?(?:\s+мне)?|поставь\s+напоминание|создай\s+напоминание|сделай\s+напоминание|новая\s+задача)(?=$|[^а-яёa-z0-9])/i.test(
        text
      );
    if (isTaskWizardTrigger) {
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
      /(?:^|[^а-яёa-z0-9])(?:задай(?:те)?|попроси(?:те|ть)?\s+задать)\s+(?:ему\s+|ей\s+|специалисту\s+|маркетологу\s+|менеджеру\s+|методисту\s+|аналитику\s+|дизайнеру\s+)?(?:уточняющ(?:ий|ие)\s+)?вопрос(?:ы)?(?=$|[^а-яёa-z0-9])/i.test(
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
      /^(?:пиксель[\s,:-]*)?(?:для\s+)?(?:маркетолога|маркетологу|менеджера|менеджеру|методиста|методисту|аналитика|аналитику|дизайнера|дизайнеру)(?:\s+(?:renderia|рендерия|рендерии|kiberone|киберван|киберон))?[\s:,-]+/i.test(
        lower
      ) ||
      /^(?:пиксель[\s,:-]*)?(?:задача|поручение|задание|вопрос)\s+(?:для\s+|к\s+)?(?:маркетолога|маркетологу|менеджера|менеджеру|методиста|методисту|аналитика|аналитику|дизайнера|дизайнеру)(?=$|[^а-яёa-z0-9])/i.test(
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

    const hasBothSchoolsKeywords =
      /(?:обе(?:их|им)?\s+школ|по\s+обеим\s+школам|для\s+обеих\s+школ|в\s+обе\s+школы|(?:kiber|киберван|киберон).*?(?:renderia|рендери)|(?:renderia|рендери).*?(?:kiber|киберван|киберон))/i.test(
        lower
      );

    const forceNewChat =
      /(?:создай(?:те)?\s+новый\s+чат|в\s+новом\s+чате|открой(?:те)?\s+новый\s+чат|начни(?:те)?\s+новый\s+(?:чат|диалог)|нов(?:ый|ую)\s+(?:чат|ветку|сессию))/i.test(
        lower
      );

    const isFollowUp =
      !forceNewChat &&
      (hasImplicitFollowUpPattern ||
        /(?:^|[^а-яёa-z0-9])(?:спроси|уточни|доработать|доработай|доработку|переделать|исправить|дополнить|уточняющий\s+вопрос|задай\s+вопрос)(?=$|[^а-яёa-z0-9])/i.test(
          lower
        ));

    let cleaned = text
      .replace(/^(?:пиксель[\s,.:!-]*)+/i, '')
      .replace(/^(?:пожалуйста[\s,.:!-]*)+/i, '')
      .replace(/(?:создай(?:те)?\s+новый\s+чат\s+(?:с\s+[а-яё]+\s+)?(?:и\s+)?|в\s+новом\s+чате\s*)/gi, '')
      .trim();

    const prefixPatterns: RegExp[] = [
      /^(?:попроси(?:те|ть)?\s+задать|задай(?:те)?)\s+(?:ему\s+|ей\s+|специалисту\s+|(?:нашему\s+)?(?:ии[-\s]*)?(?:маркетолог[ауеом]?|менеджер[ауеом]?|методист[ауеом]?|аналитик[ауеом]?|дизайнер[ауеом]?)(?:\s+(?:школы\s+)?(?:renderia|рендери[яию]|kiberone|киберван|киберон))?\s+)?(?:уточняющ(?:ий|ие)\s+)?вопрос(?:ы)?(?:\s+о\s+том|\s+про\s+то|\s+по\s+поводу\s+того)?[\s,.:;-]*/i,
      /^(?:спроси(?:те|ть)?|уточни(?:те|ть)?)\s+(?:у\s+)?(?:нашего\s+|своего\s+)?(?:ии[-\s]*)?(?:маркетолог[ауеом]?|менеджер[ауеом]?|методист[ауеом]?|аналитик[ауеом]?|дизайнер[ауеом]?|специалист[ау]?|него|неё|нее|его|её|ее)(?:\s+(?:школы\s+)?(?:renderia|рендери[яию]|kiberone|киберван|киберон))?(?:\s+в\s+(?:рабочем\s+|его\s+)?чате)?[\s,.:;-]*/i,
      /^(?:попроси(?:те|ть)?|поручи(?:те|ть)?|напиши(?:те)?|передай(?:те)?|скажи(?:те)?|отправь(?:те)?|делегируй(?:те)?|обратись\s+к|обратитесь\s+к)\s+(?:нашему\s+|своему\s+)?(?:ии[-\s]*)?(?:маркетолог[ауеом]?|менеджер[ауеом]?|методист[ауеом]?|аналитик[ауеом]?|дизайнер[ауеом]?|специалист[ау]?\s+по\s+(?:маркетингу|продажам|дизайну)|специалист[ау]?|ему|ей|его|её|ее)(?:\s+(?:из\s+|школы\s+|в\s+)?(?:renderia|рендери[яию]|kiberone|киберван|киберон))?(?:\s+в\s+(?:рабочий\s+|его\s+|этот\s+|текущий\s+)?чат)?(?:\s+(?:задачу|поручение|задание|сообщение|вопрос))?(?:\s*,?\s*чтобы\s+(?:он|она))?[\s,.:;-]*/i,
      /^(?:попроси(?:те|ть)?)\s+(?:его\s+|её\s+|ее\s+|специалиста\s+)?(?=(?:доработать|переделать|уточнить|исправить|дополнить|сократить|расширить|добавить))/i,
      /^(?:поставь(?:те)?\s+задачу|дай(?:те)?\s+задани[ея]|дай(?:те)?\s+задачу)\s+(?:нашему\s+)?(?:ии[-\s]*)?(?:маркетолог[ауеом]?|менеджер[ауеом]?|методист[ауеом]?|аналитик[ауеом]?|дизайнер[ауеом]?|ему|ей)(?:\s+(?:школы\s+)?(?:renderia|рендери[яию]|kiberone|киберван|киберон))?(?:\s+в\s+чат)?[\s,.:;-]*/i,
      /^пусть\s+(?:наш\s+)?(?:ии[-\s]*)?(?:маркетолог|менеджер|методист|аналитик|дизайнер|специалист|он|она)(?:\s+(?:школы\s+)?(?:renderia|рендери[яию]|kiberone|киберван|киберон))?\s+/i,
      /^(?:задача|поручение|задание|вопрос)\s+(?:для\s+|к\s+)?(?:маркетолог[ау]?|менеджер[ау]?|методист[ау]?|аналитик[ау]?|дизайнер[ау]?)(?:\s+(?:renderia|рендери[яию]|kiberone|киберван|киберон))?[\s,.:;-]*/i,
      /^(?:для\s+)?(?:маркетолог[ау]|менеджер[ау]|методист[ау]|аналитик[ау]|дизайнер[ау])(?:\s+(?:renderia|рендери[яию]|kiberone|киберван|киберон))?[\s,.:;-]+/i,
      /^(?:отправь(?:те)?|напиши(?:те)?)\s+(?:сообщение\s+)?в\s+(?:этот\s+|текущий\s+|рабочий\s+|его\s+)?чат[\s,.:;-]*/i,
    ];

    for (const rx of prefixPatterns) {
      if (rx.test(cleaned)) {
        cleaned = cleaned.replace(rx, '').trim();
        break;
      }
    }

    cleaned = cleaned.replace(/^[,.:;-]+\s*/, '').trim();

    // Strip polite words and generic conversational fillers from the end or entire phrase
    const fillerWordRegex =
      /(?:^|[^\p{L}\p{N}])(?:пожалуйста|плиз|пжл|пж|новое\s+сообщение|новое\s+поручение|новое\s+задание|новую\s+задачу|новое\s+письмо|сообщение|поручение|задание|задача|задачу|вопрос|письмо)(?=$|[^\p{L}\p{N}])/giu;
    const strippedMeaningful = cleaned
      .replace(fillerWordRegex, ' ')
      .replace(/^[,.:;-]+\s*/, '')
      .replace(/[,.:;-]+\s*$/, '')
      .trim();

    const hasRealInstruction = strippedMeaningful.length >= 3;
    if (!hasRealInstruction) {
      cleaned = '';
    }

    const completeness = checkUtteranceCompleteness(text, cleaned);

    const isBareOrVague =
      completeness.isIncomplete ||
      !hasRealInstruction ||
      cleaned.length < 4 ||
      /^(?:доработать(?:\s+(?:ответ|его|это|результат|вариант))?|переделать(?:\s+(?:ответ|его|это))?|исправить(?:\s+(?:ответ|его|это))?|уточнить(?:\s+(?:ответ|детали|это))?|дополнить(?:\s+(?:ответ|его|это))?|задать\s+(?:уточняющий\s+)?вопрос|уточняющий\s+вопрос|вопрос|сообщение|что-нибудь|это|ответ|ещё\s+раз)$/i.test(
        cleaned
      );

    if (cleaned.length >= 2) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    } else {
      cleaned = '';
    }

    const allDetected = detectAllSpecialistsFromText(lower);
    const targetModes = allDetected.length > 0 ? allDetected : [targetMode];

    const cleanInstruction = cleaned
      ? buildCleanBusinessInstruction(cleaned, targetSchool, targetMode)
      : '';

    return {
      isDelegation: true,
      isSupportedSpecialist,
      targetMode,
      targetModes,
      targetSpecialistNameRu,
      targetSchool,
      targetBothSchools: hasBothSchoolsKeywords,
      forceNewChat,
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

      // 0. Check stop / pause reading command («Стоп», «Останови чтение», «Хватит», «Пауза»)
      if (this.parseStopReadingIntent(msg.content)) {
        this.processedSpokenTurnIds.add(msg.id);
        if (voiceManager.isSpeaking() || voiceManager.isPaused()) {
          voiceManager.stopSpeaking(true);
          geminiLiveClient.stopModelAudioPlayback();
          this.showBubble(
            'Остановил чтение. Скажите «Продолжи чтение», чтобы дослушать с места остановки.'
          );
        }
        continue;
      }

      // 0.5 Check affirmative answer to «Специалист ответил на вашу задачу. Прочитать?»
      const taskToRead = this.parseReadPendingTaskResponseIntent(msg.content);
      if (taskToRead) {
        this.processedSpokenTurnIds.add(msg.id);
        void this.executeDisplayFullSpecialistResponse(taskToRead);
        void this.readTaskResult(taskToRead.taskId);
        continue;
      }

      // 1. Check read-aloud / resume command («Пиксель, прочитай ответ», «Продолжи чтение»)
      const readIntent = this.parseReadAloudIntent(msg.content, activeSchool);
      if (readIntent) {
        this.processedSpokenTurnIds.add(msg.id);
        void this.executeReadAloud(readIntent, 'voice');
        continue;
      }

      // 1.2 Check voice task trigger: task wizard via voice is disabled; voice acts as dictaphone only
      const isVoiceTaskTrigger =
        /^(?:[«"„“]+)?(?:пиксель[\s,:-]*)?(?:пожалуйста[\s,:-]*)?(?:мне\s+)?(?:надо|нужно|необходимо|хочу|давай(?:те)?\s+)?(?:поставь(?:те)?|поставить|создай(?:те)?|создать|добавь(?:те)?|добавить|запиши(?:те)?|записать|запланируй(?:те)?|запланировать|сделай(?:те)?|сделать)\s+(?:мне\s+)?(?:в\s+список\s+дел\s+|в\s+задачи\s+)?(?:новую\s+)?задач[уи](?:$|[\s:.!?,—-])/i.test(
          msg.content
        ) ||
        /^(?:[«"„“]+)?(?:пиксель[\s,:-]*)?(?:пожалуйста[\s,:-]*)?(?:новая\s+задача|нужно\s+не\s+забыть|надо\s+не\s+забыть)(?:$|[\s:.!?,—-])/i.test(
          msg.content
        ) ||
        /^(?:добавить\s+задачу|поставить\s+задачу|создать\s+задачу|надо\s+добавить\s+задачу|нужно\s+добавить\s+задачу|поставь\s+задачу|добавь\s+задачу|создай\s+задачу)(?:$|[\s:.!?,—-])/i.test(
          msg.content
        ) ||
        /^(?:написать\s+специалисту|напиши\s+специалисту|поручение\s+специалисту|задача\s+специалисту)(?:$|[\s:.!?,—-])/i.test(
          msg.content
        );

      if (isVoiceTaskTrigger) {
        this.processedSpokenTurnIds.add(msg.id);
        const refusalText =
          'Анна, для постановки задачи, пожалуйста, нажмите кнопку «Поставить задачу» внизу экрана, чтобы я мог все заполнить без ошибок.';
        const refusalMsg: CompanionMessage = {
          id: `comp-voice-refuse-${Date.now()}`,
          role: 'pixel',
          content: refusalText,
          createdAt: formatTimeNow(new Date()),
          createdAtMs: Date.now(),
          schoolId: activeSchool,
        };
        if (this.deps) {
          const cur = this.deps.getCompanionMessages();
          void this.deps.onSaveCompanionMessages([...cur, refusalMsg]);
        }
        this.showBubble(refusalText);
        continue;
      }

      // 1.5. Check multi-turn personal or specialist task draft wizard («Для меня», «Да, отправляй», etc.)
      if (this.pendingPersonalTaskDraft) {
        this.processedSpokenTurnIds.add(msg.id);
        const activeDraft = this.pendingPersonalTaskDraft;
        const todayIso = toSyzranIsoDate();
        void (async () => {
          const draftResult = await processPersonalTaskDraftInput(
            activeDraft,
            msg.content,
            todayIso,
            this.deps?.onSaveCompanionTask
          );

          if (draftResult.action === 'confirmed') {
            this.pendingPersonalTaskDraft = null;
            if (draftResult.readySpecialistDelegation) {
              const spec = draftResult.readySpecialistDelegation;
              const targetSchool =
                spec.schoolId === 'both' ? activeSchool : spec.schoolId;

              const confirmReplyMsg: CompanionMessage = {
                id: `comp-voice-specconfirm-${Date.now()}`,
                role: 'pixel',
                content: draftResult.responseRu,
                createdAt: formatTimeNow(new Date()),
                createdAtMs: Date.now(),
                schoolId: activeSchool,
              };
              if (this.deps) {
                const cur = this.deps.getCompanionMessages();
                await this.deps.onSaveCompanionMessages([...cur, confirmReplyMsg]);
              }
              this.showBubble(draftResult.spokenSummary || draftResult.responseRu);
              await this.executeDelegation({
                intent: {
                  isDelegation: true,
                  isSupportedSpecialist: true,
                  targetMode: spec.targetMode,
                  targetSpecialistNameRu: spec.targetSpecialistNameRu,
                  targetSchool,
                  instruction: spec.instruction,
                  cleanInstruction: spec.cleanInstruction,
                  originalText: msg.content,
                },
                sourceMode: 'voice',
                skipAddingUserCompanionMessage: true,
              });
            } else if (draftResult.readyTask) {
              if (this.deps?.onSaveCompanionTask) {
                await this.deps.onSaveCompanionTask(draftResult.readyTask);
              }
              const confirmReplyMsg: CompanionMessage = {
                id: `comp-voice-taskconfirm-${Date.now()}`,
                role: 'pixel',
                content: draftResult.responseRu,
                createdAt: formatTimeNow(new Date()),
                createdAtMs: Date.now(),
                schoolId: activeSchool,
                autoCreatedTask: draftResult.readyTask,
              };
              if (this.deps) {
                const cur = this.deps.getCompanionMessages();
                await this.deps.onSaveCompanionMessages([...cur, confirmReplyMsg]);
              }
              this.showBubble(draftResult.spokenSummary || draftResult.responseRu);
            }
            return;
          }

          if (draftResult.action === 'cancelled') {
            this.pendingPersonalTaskDraft = null;
            const cancelReplyMsg: CompanionMessage = {
              id: `comp-voice-taskcancel-${Date.now()}`,
              role: 'pixel',
              content: draftResult.responseRu,
              createdAt: formatTimeNow(new Date()),
              createdAtMs: Date.now(),
              schoolId: activeSchool,
            };
            if (this.deps) {
              const cur = this.deps.getCompanionMessages();
              await this.deps.onSaveCompanionMessages([...cur, cancelReplyMsg]);
            }
            this.showBubble(draftResult.spokenSummary || draftResult.responseRu);
            return;
          }

          // Action === 'updated': continue wizard steps
          this.pendingPersonalTaskDraft = draftResult.draft;
          const updateReplyMsg: CompanionMessage = {
            id: `comp-voice-taskdraft-${Date.now()}`,
            role: 'pixel',
            content: draftResult.responseRu,
            createdAt: formatTimeNow(new Date()),
            createdAtMs: Date.now(),
            schoolId: activeSchool,
            pendingPersonalTaskDraft: draftResult.draft,
          };
          if (this.deps) {
            const cur = this.deps.getCompanionMessages();
            await this.deps.onSaveCompanionMessages([...cur, updateReplyMsg]);
          }
          this.showBubble(draftResult.spokenSummary || draftResult.responseRu);
        })();
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

      // Always present draft for confirmation with buttons («Отправить», «Изменить», «Отменить»)
      void this.prepareDelegationForConfirmation({
        intent,
        sourceMode: 'voice',
        skipAddingUserCompanionMessage: true,
      });
    }
  }

  /**
   * Executes a real delegated task or follow-up message in the target specialist's working chat
   * WITHOUT forcibly switching Anna's main screen away from her current work:
   * 1. Status 'created' (Создано): Finds or creates the target session for targetMode & targetSchool.
   * 2. Status 'sent' (Отправлено): Persists real message from Pixel with taskId to specialist chat.
   * 3. Status 'in_progress' (Выполняется): Streams AI specialist generation in background.
   * 4. Saves specialist's response to IndexedDB & session state regardless of which chat is open.
   * 5. Status 'completed' (Завершено) or 'needs_revision' (Требуется доработка) or 'error' (Ошибка):
   *    Analyzes response, delivers summary & next steps into Pixel's dialog, and syncs to Anna's Task Manager.
   */
  public async executeDelegation(params: {
    intent: ParsedDelegationIntent;
    sourceMode: 'text' | 'voice';
    userCompanionMessage?: CompanionMessage;
    skipAddingUserCompanionMessage?: boolean;
    existingTaskId?: string;
    isRevisionExecution?: boolean;
    revisionIteration?: number;
    isSecondaryBothSchoolRun?: boolean;
  }): Promise<PixelDelegatedTaskState> {
    if (!this.deps) {
      throw new Error('PixelAgentCoordinator не инициализирован.');
    }

    const { intent, sourceMode } = params;

    // If Anna asked to delegate to BOTH schools («для обеих школ»), execute for KIBERONE and RENDERIA
    if (intent.targetBothSchools && !params.isSecondaryBothSchoolRun) {
      const primarySchool: SchoolId = 'kiberone';
      const secondarySchool: SchoolId = 'renderia';
      const primaryResult = await this.executeDelegation({
        ...params,
        intent: {
          ...intent,
          targetSchool: primarySchool,
          targetBothSchools: false,
          cleanInstruction: buildCleanBusinessInstruction(
            intent.instruction,
            primarySchool
          ),
        },
        isSecondaryBothSchoolRun: true,
      });
      void this.executeDelegation({
        ...params,
        skipAddingUserCompanionMessage: true,
        intent: {
          ...intent,
          targetSchool: secondarySchool,
          targetBothSchools: false,
          cleanInstruction: buildCleanBusinessInstruction(
            intent.instruction,
            secondarySchool
          ),
        },
        isSecondaryBothSchoolRun: true,
      });
      return primaryResult;
    }

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
    let isNewChatCreated = false;

    if (!intent.forceNewChat) {
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
    }

    if (!targetSession) {
      isNewChatCreated = true;
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

    const isContinuingExistingChat =
      !isNewChatCreated && targetSession.messages.length > 0;
    const existingTask = params.existingTaskId
      ? this.tasks.get(params.existingTaskId)
      : undefined;

    const currentIteration = params.isRevisionExecution
      ? params.revisionIteration || (existingTask?.iterationCount || 0) + 1
      : (existingTask?.iterationCount || 0);

    // 2. Initialize task state: 'created' (Создано) with all required linked entities
    let taskState: PixelDelegatedTaskState = {
      taskId,
      targetMode,
      specialistId: targetMode,
      schoolId: targetSchool,
      chatId: targetSession.id,
      sessionId: targetSession.id,
      sessionTitle: targetSession.title,
      isNewChatCreated,
      instruction: intent.instruction,
      cleanInstruction:
        intent.cleanInstruction ||
        buildCleanBusinessInstruction(intent.instruction, targetSchool),
      originalUserRequest: intent.originalText,
      status: 'created',
      statusLabelRu: PIXEL_DELEGATION_STATUS_LABELS.created,
      iterationCount: currentIteration,
      maxRevisions: MAX_DELEGATION_REVISIONS,
      revisions: existingTask?.revisions || [],
      revisionFeedbackHistory: existingTask?.revisionFeedbackHistory || [],
      createdAt: existingTask?.createdAt || formatTimeNow(now),
      updatedAt: formatTimeNow(now),
      createdAtMs: existingTask?.createdAtMs || nowMs,
      updatedAtMs: nowMs,
      sourceMode,
    };

    this.tasks.set(taskId, taskState);
    this.saveTasksToStorage();
    this.notifyListeners(taskState);
    this.deps.onDelegatedTaskSyncToAnnaTasks?.(taskState);

    // Create Pixel status/report message in companionMessages showing chat creation & message dispatch
    const pixelCompanionMsgId = `comp-pixel-delegation-${taskId}`;
    const initialPixelCompanionMsg: CompanionMessage = {
      id: pixelCompanionMsgId,
      role: 'pixel',
      content: isNewChatCreated
        ? `✅ **Создан новый чат** «*${targetSession.title}*» (${modeCfg.shortTitle} · ${schoolCfg.name}).\nОтправляю поручение **${dativeName}**: «*${intent.instruction}*»…`
        : isContinuingExistingChat
        ? `✅ **Найден рабочий чат** «*${targetSession.title}*» (${modeCfg.shortTitle} · ${schoolCfg.name}).\nПередаю запрос **${dativeName}**: «*${intent.instruction}*»…`
        : `✅ **Чат специалиста:** «*${targetSession.title}*» (${modeCfg.shortTitle} · ${schoolCfg.name}).\nОтправляю поручение **${dativeName}**: «*${intent.instruction}*»…`,
      createdAt: formatTimeNow(new Date(nowMs + 1)),
      createdAtMs: nowMs + 1,
      schoolId: targetSchool,
      usedContextLabels: [
        `Школа: ${schoolCfg.name}`,
        `Специалист: ${modeCfg.shortTitle}`,
        isNewChatCreated
          ? `Новый чат: ${targetSession.title}`
          : `Чат: ${targetSession.title}`,
        `Поручение: ${taskId}`,
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
      this.saveTasksToStorage();
      this.notifyListeners(taskState);
      this.deps.onDelegatedTaskSyncToAnnaTasks?.(taskState);

      const latestCompanion = this.deps.getCompanionMessages();
      const updatedCompanion = latestCompanion.map((m) =>
        m.id === pixelCompanionMsgId
          ? {
              ...m,
              content: companionContent ?? m.content,
              delegatedTask: taskState,
              isError: taskState.status === 'failed' || taskState.status === 'error',
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

    try {
      // 3. Transition status to 'in_progress' (Выполняется)
      await updateTaskAndCompanionMessage(
        {
          status: 'in_progress',
          statusLabelRu:
            currentIteration > 0
              ? `${PIXEL_DELEGATION_STATUS_LABELS.in_progress} (доработка #${currentIteration})`
              : PIXEL_DELEGATION_STATUS_LABELS.in_progress,
          iterationCount: currentIteration,
        },
        currentIteration > 0
          ? `Анна, я отправил ${dativeName} (${schoolCfg.name}) запрос на доработку #${currentIteration}. ${modeCfg.shortTitle} готовит обновлённое решение…`
          : isContinuingExistingChat
            ? `Анна, я написал ${dativeName} (${schoolCfg.name}) в рабочий чат «*${targetSession.title}*» и жду ответа по запросу: «*${intent.instruction}*»…`
            : `Анна, я написал ${dativeName} (${schoolCfg.name}) в рабочий чат и запустил разработку по поручению: «*${intent.instruction}*»…`
      );

      // Fetch fresh targetSession from state
      const freshSessions = this.deps.getSessions();
      const currentTargetSession =
        freshSessions.find((s) => s.id === targetSession!.id) ||
        targetSession!;

      const reqTime = new Date();
      const reqMs = reqTime.getTime();
      const repMs = reqMs + 1;

      const pixelMsgId = `msg-pixel-req-${taskId}-it${currentIteration}-${reqMs}`;
      const specialistMsgId = `msg-${targetMode}-rep-${taskId}-it${currentIteration}-${repMs}`;

      const cleanInstructionToSend =
        intent.cleanInstruction ||
        buildCleanBusinessInstruction(intent.instruction, targetSchool);

      const pixelMessageContent = cleanInstructionToSend;

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
        senderLabel:
          currentIteration > 0
            ? `Пиксель · Доработка #${currentIteration}`
            : currentTargetSession.messages.length > 0
              ? 'Пиксель · Запрос от Анны'
              : 'Пиксель · Поручение Анны',
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

      await storageProvider.saveSessionAndMessages(sessionWithStreaming, [
        pixelRequestMsg,
        {
          ...initialSpecialistReply,
          isStreaming: false,
          content: `[Выполняется генерация ответа специалиста (${modeCfg.shortTitle}) по запросу Пикселя…]`,
        },
      ]);

      // Transition status to 'sent' (Отправлено) then 'in_progress' (Выполняется) with concrete messageId & chatId
      await updateTaskAndCompanionMessage(
        {
          status: 'sent',
          statusLabelRu: PIXEL_DELEGATION_STATUS_LABELS.sent,
          chatId: sessionWithStreaming.id,
          sessionId: sessionWithStreaming.id,
          sessionTitle: sessionWithStreaming.title,
          specialistId: targetMode,
          messageId: pixelMsgId,
        },
        isNewChatCreated
          ? `✅ **Создан новый чат** «*${sessionWithStreaming.title}*» (${modeCfg.shortTitle} · ${schoolCfg.name}).\n📨 **Сообщение отправлено** (${pixelMsgId}). Специалист готовит ответ…`
          : `📨 **Сообщение отправлено** в чат «*${sessionWithStreaming.title}*» (${modeCfg.shortTitle} · ${schoolCfg.name}).\n⏳ **Выполняется:** специалист готовит ответ по запросу «*${intent.instruction}*»…`
      );

      this.showBubble(`Поручение успешно передано специалисту ${modeCfg.shortTitle}!`);

      await updateTaskAndCompanionMessage({
        status: 'in_progress',
        statusLabelRu:
          currentIteration > 0
            ? `${PIXEL_DELEGATION_STATUS_LABELS.in_progress} (доработка #${currentIteration})`
            : PIXEL_DELEGATION_STATUS_LABELS.in_progress,
        chatId: sessionWithStreaming.id,
        sessionId: sessionWithStreaming.id,
        sessionTitle: sessionWithStreaming.title,
        specialistId: targetMode,
        messageId: pixelMsgId,
      });

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

      const parsedDesigner =
        targetMode === 'designer'
          ? parseDesignerConceptsFromMarkdown(generatedText)
          : { cleanText: generatedText };

      await updateSpecialistReplyInStateAndDb(
        {
          content: parsedDesigner.cleanText,
          interactiveDesignerPrompt: parsedDesigner.interactivePrompt,
          isStreaming: false,
          isError: false,
          modelName: generationResult.model,
          providerId: generationResult.providerId,
          providerLabel: generationResult.providerLabel,
          failoverNotice: generationResult.failoverNotice,
        },
        true
      );

      // 4. Transition status to 'reviewing' (Проверяется Пикселем)
      await updateTaskAndCompanionMessage(
        {
          status: 'reviewing',
          statusLabelRu: PIXEL_DELEGATION_STATUS_LABELS.reviewing,
          lastSpecialistMessageId: specialistMsgId,
          resultMessageId: specialistMsgId,
          resultText: generatedText,
          messageId: pixelMsgId,
          specialistReplyPreview:
            generatedText.slice(0, 260) +
            (generatedText.length > 260 ? '…' : ''),
        },
        `${modeCfg.shortTitle} (${schoolCfg.name}) подготовил ответ. Провожу анализ соответствия задаче…`
      );

      // 5. Pixel performs deep quality analysis across all 6 criteria (Stage 4)
      const analysis = await this.analyzeSpecialistResponse({
        taskId,
        schoolId: targetSchool,
        targetMode,
        instruction: intent.instruction,
        specialistReply: generatedText,
        iteration: currentIteration,
        providerSelection: selectedProviderMode,
      });

      // 6. Record revision item if this was a revision run
      const nextRevisions = [...(taskState.revisions || [])];
      if (currentIteration > 0) {
        nextRevisions.push({
          id: `rev-${Date.now()}`,
          iteration: currentIteration,
          requestedAt: formatTimeNow(new Date()),
          requestedAtMs: Date.now(),
          revisionPrompt: intent.instruction,
          cleanInstruction: pixelMessageContent,
          status: 'completed',
          resultMessageId: specialistMsgId,
          resultPreview: generatedText.slice(0, 160) + '…',
          reviewComment: analysis.briefSummary,
        });
      }

      const completedAtDate = new Date();
      const completedAtTime = formatTimeNow(completedAtDate);
      const completedAtMs = completedAtDate.getTime();

      const finalStatus =
        analysis.verdict === 'needs_revision' ? 'needs_revision' : 'completed';

      const briefSummarySentence = analysis.briefSummary
        ? analysis.briefSummary.split('.')[0] + '.'
        : '';
      const completedContent = [
        `Анна, **${modeCfg.shortTitle}** ответил на вашу задачу! ${briefSummarySentence}`,
        ``,
        `• **Школа:** ${schoolCfg.name}`,
        `• **Поручение:** «${intent.cleanInstruction || intent.instruction}»`,
        `• **Краткая выжимка:** ${analysis.briefSummary}`,
        analysis.actionableRecommendations.length > 0
          ? `• **Рекомендации:** ${analysis.actionableRecommendations.slice(0, 2).join('; ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      showToast({
        title: 'Оповещаю вас, Анна',
        message: `Анна, ${modeCfg.shortTitle} ответил на вашу задачу! ${analysis.briefSummary || ''}`,
        type: 'info',
        actionLabel: 'Открыть чат специалиста',
        onAction: () => {
          this.deps?.onNavigate?.(intent.targetMode);
        },
      });

      await updateTaskAndCompanionMessage(
        {
          status: finalStatus,
          statusLabelRu: PIXEL_DELEGATION_STATUS_LABELS[finalStatus],
          resultMessageId: specialistMsgId,
          lastSpecialistMessageId: specialistMsgId,
          resultText: generatedText,
          messageId: pixelMsgId,
          completedAt: completedAtTime,
          completedAtMs,
          analysis,
          reviewSummary: analysis.briefSummary,
          revisions: nextRevisions,
          specialistReplyPreview:
            generatedText.slice(0, 280) +
            (generatedText.length > 280 ? '…' : ''),
        },
        completedContent
      );

      // Attribution
      if (this.deps && (generationResult.providerId || generationResult.model)) {
        const latestMsgs = this.deps.getCompanionMessages();
        const attributed = latestMsgs.map((m) =>
          m.id === pixelCompanionMsgId
            ? {
                ...m,
                providerId: generationResult.providerId,
                modelName: generationResult.model,
              }
            : m
        );
        await this.deps.onSaveCompanionMessages(attributed);
      }

      this.deps?.onNotifyLiveVoice?.(
        `Системное уведомление: ${modeCfg.shortTitle} (${schoolCfg.name}) ответил по запросу «${intent.instruction}». Краткая выжимка: ${analysis.briefSummary}. Сообщи Анне голосом в 1-2 фразы, что специалист ответил, и предложи озвучить полный ответ или отправить доработку.`
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
                  content: `Ошибка выполнения поручения: ${errorMsg}`,
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
        `Анна, при генерации ответа ${dativeName} (${schoolCfg.name}) возникла ошибка: **${errorMsg}**.\n\nПоручение не завершено. Вы можете нажать «Повторить поручение» ниже или открыть диалог со специалистом.`
      );

      this.deps?.onNotifyLiveVoice?.(
        `Системное уведомление: при выполнении поручения ${dativeName} (${schoolCfg.name}) произошла ошибка: ${errorMsg}. Честно сообщи Анне, что генерация завершилась ошибкой.`
      );

      return taskState;
    } finally {
      this.activeTaskExecutionLocks.delete(taskId);
    }
  }

  /**
   * Stage 4: Critical evaluation of the specialist's response across 6 criteria:
   * 1. Answered initial questions?
   * 2. Actionable recommendations vs generic fluff?
   * 3. Target school context honored (KIBERONE vs RENDERIA)?
   * 4. Contradictions or gaps?
   * 5. Missing data / questions to Anna?
   * 6. Recommended next steps?
   */
  public async analyzeSpecialistResponse(params: {
    taskId: string;
    schoolId: SchoolId;
    targetMode: AgentMode;
    instruction: string;
    specialistReply: string;
    iteration?: number;
    providerSelection?: AIProviderSelectionMode;
  }): Promise<SpecialistAnalysisResult> {
    const {
      schoolId,
      targetMode,
      instruction,
      specialistReply,
      iteration = 0,
      providerSelection = 'auto',
    } = params;
    const schoolCfg = SCHOOLS[schoolId];
    const modeCfg = AGENT_MODES[targetMode];
    const otherSchoolId: SchoolId =
      schoolId === 'kiberone' ? 'renderia' : 'kiberone';
    const otherSchoolName = SCHOOLS[otherSchoolId].name;
    const trimmed = specialistReply.trim();
    const lower = trimmed.toLowerCase();

    // 1. Deterministic checks
    const mentionsTarget =
      schoolId === 'renderia'
        ? lower.includes('renderia') || lower.includes('рендери')
        : lower.includes('kiber') ||
          lower.includes('киберван') ||
          lower.includes('киберон');
    const mentionsOther =
      otherSchoolId === 'renderia'
        ? lower.includes('renderia') || lower.includes('рендери')
        : lower.includes('kiber') ||
          lower.includes('киберван') ||
          lower.includes('киберон');

    const schoolConsidered =
      mentionsTarget || (!mentionsOther && trimmed.length > 100);

    const sentences = trimmed
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 15 && !s.startsWith('#'));
    const defaultBrief =
      sentences.slice(0, 2).join(' ') ||
      `Специалист ИИ-${modeCfg.shortTitle} подготовил ответ по запросу для школы ${schoolCfg.name}.`;

    const recommendationLines = trimmed
      .split('\n')
      .map((l) => l.trim())
      .filter(
        (l) =>
          /^[•\-*\d.]+\s+/.test(l) ||
          /^(?:рекоменду(?:ется|ю)|шаг|пункт|этап)\b/i.test(l)
      )
      .map((l) =>
        l
          .replace(/^[•\-*\d.]+\s+/, '')
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .trim()
      )
      .filter((l) => l.length > 12)
      .slice(0, 4);

    let result: SpecialistAnalysisResult = {
      isTaskCompleted: trimmed.length >= 80,
      allQuestionsAnswered: trimmed.length >= 100,
      actionableRecommendations:
        recommendationLines.length > 0
          ? recommendationLines
          : [
              `Ознакомиться со структурой ответа ${modeCfg.shortTitle}`,
              `Применить рекомендации в рабочих процессах ${schoolCfg.name}`,
            ],
      schoolConsidered,
      schoolName: schoolCfg.name,
      contradictionsOrGaps: !schoolConsidered
        ? [`Упомянута школа ${otherSchoolName} вместо ${schoolCfg.name}`]
        : [],
      missingData: [],
      critiqueRemarks: [
        trimmed.length >= 150
          ? `Ответ структурирован (${trimmed.length} симв.)`
          : 'Ответ лаконичен, при необходимости можно запросить расширение',
      ],
      unresolvedQuestions: [],
      proposedNextSteps: [
        `Озвучить ответ голосом Пикселя`,
        `Задать уточняющий вопрос или направить замечания`,
      ],
      briefSummary: defaultBrief,
      verdict:
        trimmed.length >= 80 && schoolConsidered ? 'approved' : 'needs_revision',
    };

    // 2. Perform deep AI quality evaluation using Gemini
    try {
      const evaluationPrompt = [
        `Вы — ИИ-ассистент Пиксель, координатор специалистов для управляющей Анны.`,
        `Проанализируйте ответ специалиста «ИИ-${modeCfg.shortTitle}» для школы «${schoolCfg.name}».`,
        `Задание Анны: «${instruction}»`,
        `Итерация: ${iteration + 1}`,
        ``,
        `Ответ специалиста (${modeCfg.shortTitle}):`,
        `"""`,
        trimmed.slice(0, 4500),
        `"""`,
        ``,
        `Оцените ответ строго по 6 критериям:`,
        `1. Ответил ли специалист на исходный вопрос Анны?`,
        `2. Содержит ли ответ конкретные рекомендации или только общие слова?`,
        `3. Учтена ли специфика школы ${schoolCfg.name} (без смешивания с ${otherSchoolName})?`,
        `4. Нет ли явных пробелов или противоречий?`,
        `5. Нужны ли дополнительные данные от Анны?`,
        `6. Какие следующие шаги рекомендуются?`,
        ``,
        `Верните ТОЛЬКО валидный JSON без markdown-тегов:`,
        `{`,
        `  "allQuestionsAnswered": true,`,
        `  "actionableRecommendations": ["конкретная рекомендация 1", "конкретная рекомендация 2"],`,
        `  "schoolConsidered": true,`,
        `  "contradictionsOrGaps": ["пробел или замечание, если есть"],`,
        `  "missingData": ["каких данных не хватает, если есть"],`,
        `  "critiqueRemarks": ["что получилось хорошо, а что стоит доработать"],`,
        `  "unresolvedQuestions": ["открытые вопросы, если есть"],`,
        `  "proposedNextSteps": ["рекомендуемый шаг 1", "рекомендуемый шаг 2"],`,
        `  "briefSummary": "Краткая выжимка (TL;DR) в 1-2 предложениях для Анны",`,
        `  "verdict": "approved"`,
        `}`,
      ].join('\n');

      const evaluationResp = await geminiProvider.streamChat({
        schoolId,
        mode: 'pixel',
        sessionId: `pixel-analysis-${params.taskId}-${iteration}`,
        messages: [{ role: 'user', content: evaluationPrompt }],
        providerSelection,
        timeoutMs: 18000,
        onDelta: () => {},
      });

      const rawJson = (evaluationResp.text || '')
        .replace(/^```(?:json)?/im, '')
        .replace(/```$/im, '')
        .trim();

      const parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed === 'object') {
        result = {
          isTaskCompleted: true,
          allQuestionsAnswered: Boolean(parsed.allQuestionsAnswered ?? true),
          actionableRecommendations:
            Array.isArray(parsed.actionableRecommendations) &&
            parsed.actionableRecommendations.length > 0
              ? parsed.actionableRecommendations
              : result.actionableRecommendations,
          schoolConsidered: Boolean(parsed.schoolConsidered ?? schoolConsidered),
          schoolName: schoolCfg.name,
          contradictionsOrGaps: Array.isArray(parsed.contradictionsOrGaps)
            ? parsed.contradictionsOrGaps
            : result.contradictionsOrGaps,
          missingData: Array.isArray(parsed.missingData)
            ? parsed.missingData
            : [],
          critiqueRemarks:
            Array.isArray(parsed.critiqueRemarks) &&
            parsed.critiqueRemarks.length > 0
              ? parsed.critiqueRemarks
              : result.critiqueRemarks,
          unresolvedQuestions: Array.isArray(parsed.unresolvedQuestions)
            ? parsed.unresolvedQuestions
            : [],
          proposedNextSteps:
            Array.isArray(parsed.proposedNextSteps) &&
            parsed.proposedNextSteps.length > 0
              ? parsed.proposedNextSteps
              : result.proposedNextSteps,
          briefSummary:
            typeof parsed.briefSummary === 'string' &&
            parsed.briefSummary.trim()
              ? parsed.briefSummary.trim()
              : defaultBrief,
          verdict:
            parsed.verdict === 'approved' ||
            parsed.verdict === 'needs_revision' ||
            parsed.verdict === 'acceptable'
              ? parsed.verdict
              : 'approved',
        };
      }
    } catch {
      // Fallback: result already holds sensible deterministic analysis
    }

    return result;
  }
}

export const pixelAgentCoordinator = new PixelAgentCoordinator();

