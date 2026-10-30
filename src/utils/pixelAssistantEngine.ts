import {
  CompanionMemoryCategory,
  CompanionMemoryRecord,
  CompanionTaskPriority,
  CompanionTaskRecord,
  PixelRelevantContextBundle,
  ProposedCompanionMemoryDraft,
  ProposedCompanionTaskDraft,
  SchoolId,
} from '../types/assistant';
import { SCHOOLS } from '../config/schoolsAndModes';

export const MEMORY_CATEGORY_META: Record<
  CompanionMemoryCategory,
  { title: string; subtitle: string; badgeClass: string }
> = {
  profile: {
    title: 'Профиль Анны',
    subtitle: 'Как обращаться, основные обязанности и долгосрочные направления',
    badgeClass: 'bg-amber-100 text-amber-900 border-amber-200',
  },
  projects: {
    title: 'Проекты школ',
    subtitle: 'Текущие проекты, задачи по KIBERONE и RENDERIA, планы и договорённости',
    badgeClass: 'bg-sky-100 text-sky-900 border-sky-200',
  },
  preferences: {
    title: 'Предпочтения в работе',
    subtitle: 'Удобный формат ответов, приоритеты и организация рабочего процесса',
    badgeClass: 'bg-emerald-100 text-emerald-900 border-emerald-200',
  },
  decisions: {
    title: 'История рабочих решений',
    subtitle: 'Важные управленческие решения, сохранённые идеи и направления',
    badgeClass: 'bg-purple-100 text-purple-900 border-purple-200',
  },
};

export function toIsoDateString(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function formatIsoDateRu(isoDate: string): string {
  if (!isoDate) return 'Без срока';
  const today = toIsoDateString(new Date());
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = toIsoDateString(tomorrowDate);

  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const formatted = `${parts[2]}.${parts[1]}.${parts[0]}`;

  if (isoDate === today) return `Сегодня (${formatted})`;
  if (isoDate === tomorrow) return `Завтра (${formatted})`;
  return formatted;
}

const SENSITIVE_PATTERNS = [
  /парол[ьяюеи]/i,
  /password/i,
  /secret[\s_-]*key/i,
  /api[\s_-]*key/i,
  /ai[a-z0-9_-]{25,}/i,
  /sk-[a-z0-9]{20,}/i,
  /токен/i,
  /пин[-\s]*код/i,
  /cvv|cvc/i,
  /серия\s+и\s+номер\s+паспорта/i,
];

export function containsSensitiveCredentials(text: string): boolean {
  return SENSITIVE_PATTERNS.some((rx) => rx.test(text));
}

function detectSchoolFromText(
  text: string,
  fallbackSchool: SchoolId
): SchoolId | 'both' {
  const lower = text.toLowerCase();
  const hasKiber =
    lower.includes('kiber') ||
    lower.includes('киберван') ||
    lower.includes('киберон');
  const hasRenderia =
    lower.includes('renderia') ||
    lower.includes('рендери') ||
    lower.includes('рендерия');

  if (hasKiber && hasRenderia) return 'both';
  if (hasKiber) return 'kiberone';
  if (hasRenderia) return 'renderia';
  return fallbackSchool;
}

/**
 * Parses a natural language message from Anna to check if she is asking Pixel to create/remind about a task.
 * Example: «Пиксель, напомни мне завтра проверить презентацию для Renderia»
 */
export function parseTaskProposalFromMessage(
  rawText: string,
  activeSchool: SchoolId
): ProposedCompanionTaskDraft | null {
  const text = rawText.trim();
  const lower = text.toLowerCase();

  const taskTriggers = [
    /^(?:пиксель[\s,:-]*)?(?:пожалуйста[\s,:-]*)?напомни(?:те)?(?:\s+мне)?\s+(.+)$/i,
    /^(?:пиксель[\s,:-]*)?добавь\s+задачу[\s:,-]*(.+)$/i,
    /^(?:пиксель[\s,:-]*)?создай\s+задачу[\s:,-]*(.+)$/i,
    /^(?:пиксель[\s,:-]*)?запиши\s+в\s+дела[\s:,-]*(.+)$/i,
    /^(?:пиксель[\s,:-]*)?не\s+забыть\s+(.+)$/i,
  ];

  let body = '';
  for (const rx of taskTriggers) {
    const match = text.match(rx);
    if (match && match[1]) {
      body = match[1].trim();
      break;
    }
  }

  if (!body) return null;

  const now = new Date();
  let dueDate = toIsoDateString(now);

  // Extract relative or explicit date
  if (/\bпослезавтра\b/i.test(body)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    dueDate = toIsoDateString(d);
    body = body.replace(/\bпослезавтра\b/gi, '').trim();
  } else if (/\bзавтра\b/i.test(body)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    dueDate = toIsoDateString(d);
    body = body.replace(/\bзавтра\b/gi, '').trim();
  } else if (/\bсегодня\b/i.test(body)) {
    dueDate = toIsoDateString(now);
    body = body.replace(/\bсегодня\b/gi, '').trim();
  } else if (/\bчерез\s+(\d+)\s+дн/i.test(body)) {
    const m = body.match(/\bчерез\s+(\d+)\s+дн[яей]*/i);
    if (m) {
      const days = Math.min(365, Math.max(1, Number(m[1])));
      const d = new Date(now);
      d.setDate(d.getDate() + days);
      dueDate = toIsoDateString(d);
      body = body.replace(m[0], '').trim();
    }
  } else {
    const ddmmyyyy = body.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
    if (ddmmyyyy) {
      const dd = ddmmyyyy[1].padStart(2, '0');
      const mm = ddmmyyyy[2].padStart(2, '0');
      const yyyy = ddmmyyyy[3];
      dueDate = `${yyyy}-${mm}-${dd}`;
      body = body.replace(ddmmyyyy[0], '').trim();
    }
  }

  // Clean up leading prepositions/punctuation left after date extraction
  body = body
    .replace(/^(?:мне|нам|о\s+том,?\s+чтобы|чтобы|про\s+то,?\s+чтобы)\s+/i, '')
    .replace(/^[,.:;-]+\s*/, '')
    .replace(/[.!]+$/, '')
    .trim();

  if (!body) {
    body = 'Новая рабочая задача';
  }

  const cleanTitle = body.charAt(0).toUpperCase() + body.slice(1);
  const priority: CompanionTaskPriority =
    lower.includes('срочно') ||
    lower.includes('важно') ||
    lower.includes('приоритет')
      ? 'high'
      : 'medium';

  const schoolId = detectSchoolFromText(text, activeSchool);

  return {
    title: cleanTitle,
    description: `Создано из диалога с Пикселем: «${text}»`,
    dueDate,
    priority,
    schoolId,
  };
}

/**
 * Parses a message from Anna to see if it contains potentially useful long-term memory information.
 * Never auto-saves: returns a draft so Pixel asks «Анна, запомнить это?».
 */
export function parseMemoryProposalFromMessage(
  rawText: string,
  activeSchool: SchoolId
): ProposedCompanionMemoryDraft | null {
  const text = rawText.trim();
  if (text.length < 10 || containsSensitiveCredentials(text)) {
    return null;
  }

  const lower = text.toLowerCase();

  const explicitTriggers = [
    /^(?:пиксель[\s,:-]*)?запомни(?:те)?[\s,:-]+(.+)$/i,
    /^(?:пиксель[\s,:-]*)?сохрани\s+в\s+память[\s,:-]+(.+)$/i,
    /^(?:пиксель[\s,:-]*)?важная\s+заметка[\s,:-]+(.+)$/i,
  ];

  let extractedContent = '';
  for (const rx of explicitTriggers) {
    const m = text.match(rx);
    if (m && m[1]) {
      extractedContent = m[1].trim();
      break;
    }
  }

  const isImplicitMemoryCandidate =
    !extractedContent &&
    text.length >= 22 &&
    !text.endsWith('?') &&
    (lower.includes('я предпочитаю') ||
      lower.includes('мне удобнее') ||
      lower.includes('мы решили') ||
      lower.includes('приняли решение') ||
      lower.includes('наш главный проект') ||
      lower.includes('моя обязанность') ||
      lower.includes('обращайся ко мне') ||
      lower.includes('приоритет по школе'));

  if (isImplicitMemoryCandidate) {
    extractedContent = text;
  }

  if (!extractedContent) return null;

  let category: CompanionMemoryCategory = 'projects';
  if (
    lower.includes('предпочитаю') ||
    lower.includes('удобнее') ||
    lower.includes('формат') ||
    lower.includes('кратко') ||
    lower.includes('подробно')
  ) {
    category = 'preferences';
  } else if (
    lower.includes('решили') ||
    lower.includes('решение') ||
    lower.includes('договорились') ||
    lower.includes('идея')
  ) {
    category = 'decisions';
  } else if (
    lower.includes('обращайся') ||
    lower.includes('обязанност') ||
    lower.includes('управляющ') ||
    lower.includes('мой график')
  ) {
    category = 'profile';
  }

  const schoolId = detectSchoolFromText(extractedContent, activeSchool);
  const titleWords = extractedContent.split(/\s+/).slice(0, 6).join(' ');
  const title =
    titleWords.charAt(0).toUpperCase() +
    titleWords.slice(1) +
    (extractedContent.split(/\s+/).length > 6 ? '…' : '');

  return {
    category,
    title,
    content: extractedContent,
    schoolId,
  };
}

/**
 * Builds a selective, relevant context bundle for Pixel's responses and future Gemini API integration (Part 11).
 */
export function buildSelectivePixelContext(
  query: string,
  activeSchool: SchoolId,
  memories: CompanionMemoryRecord[],
  tasks: CompanionTaskRecord[]
): PixelRelevantContextBundle {
  const schoolCfg = SCHOOLS[activeSchool];
  const lowerQuery = query.toLowerCase();

  // Select up to 4 most relevant confirmed memories
  const confirmedMemories = memories.filter((m) => m.confirmedByAnna);
  const relevantMemories = confirmedMemories
    .filter(
      (m) =>
        m.schoolId === activeSchool ||
        m.schoolId === 'both' ||
        m.category === 'profile' ||
        m.category === 'preferences' ||
        lowerQuery
          .split(/\s+/)
          .some((w) => w.length > 3 && m.content.toLowerCase().includes(w))
    )
    .slice(0, 4)
    .map((m) => ({
      id: m.id,
      category: m.category,
      title: m.title,
      content: m.content,
    }));

  // Select active (not done) tasks
  const activeTasks = tasks
    .filter((t) => t.status !== 'done')
    .slice(0, 5)
    .map((t) => ({
      id: t.id,
      title: t.title,
      dueDate: t.dueDate,
      priority: t.priority,
      status: t.status,
    }));

  const contextSummaryLabels: string[] = [`Школа: ${schoolCfg.name}`];
  if (relevantMemories.length > 0) {
    contextSummaryLabels.push(
      `Память об Анне: ${relevantMemories.length} зап.`
    );
  }
  if (activeTasks.length > 0) {
    contextSummaryLabels.push(`Активные задачи: ${activeTasks.length}`);
  }

  return {
    activeSchool,
    schoolName: schoolCfg.name,
    relevantMemories,
    activeTasks,
    contextSummaryLabels,
  };
}

/**
 * Generates an honest, warm local response from Pixel without faking an LLM API.
 */
export function generateHonestPixelReply(
  userText: string,
  activeSchool: SchoolId,
  memories: CompanionMemoryRecord[],
  tasks: CompanionTaskRecord[]
): {
  replyText: string;
  usedContextLabels: string[];
  proposedTask?: ProposedCompanionTaskDraft;
  proposedMemory?: ProposedCompanionMemoryDraft;
} {
  const trimmed = userText.trim();
  const lower = trimmed.toLowerCase();
  const contextBundle = buildSelectivePixelContext(
    trimmed,
    activeSchool,
    memories,
    tasks
  );

  // 1. Check for sensitive credentials first (Part 7 rule)
  if (containsSensitiveCredentials(trimmed)) {
    return {
      replyText:
        'Анна, я заметил в сообщении слова, похожие на пароль, ключ или секретный токен. Из соображений вашей безопасности я никогда не сохраняю пароли и секретные ключи в память.',
      usedContextLabels: ['Защита конфиденциальности'],
    };
  }

  // 2. Check if Anna is asking to create a task (Part 8)
  const taskProposal = parseTaskProposalFromMessage(trimmed, activeSchool);
  if (taskProposal) {
    return {
      replyText: `Анна, я подготовил черновик задачи: «${taskProposal.title}» на срок «${formatIsoDateRu(taskProposal.dueDate)}». Проверьте карточку ниже и нажмите «Подтвердить и сохранить», чтобы добавить её в ваш список дел!`,
      usedContextLabels: contextBundle.contextSummaryLabels,
      proposedTask: taskProposal,
    };
  }

  // 3. Check if Anna is asking about her tasks today / active tasks
  if (
    lower.includes('какие задачи') ||
    lower.includes('мои дела') ||
    lower.includes('список дел') ||
    lower.includes('что на сегодня')
  ) {
    const todayIso = toIsoDateString(new Date());
    const openTasks = tasks.filter((t) => t.status !== 'done');
    const todayTasks = openTasks.filter((t) => t.dueDate === todayIso);

    if (openTasks.length === 0) {
      return {
        replyText:
          'Анна, сейчас в вашем списке нет невыполненных задач! Вы можете написать мне, например: «Пиксель, напомни мне завтра проверить презентацию для RENDERIA», или открыть вкладку «Задачи» сверху.',
        usedContextLabels: contextBundle.contextSummaryLabels,
      };
    }

    const listPreview = openTasks
      .slice(0, 4)
      .map(
        (t, idx) =>
          `${idx + 1}. ${t.title} (${formatIsoDateRu(t.dueDate)})`
      )
      .join('\n');

    return {
      replyText: [
        `Анна, сейчас у вас в работе ${openTasks.length} задач(и), из них на сегодня — ${todayTasks.length}:`,
        listPreview,
        `Полный список можно открыть на вкладке «Задачи» прямо в этом окне.`,
      ].join('\n'),
      usedContextLabels: contextBundle.contextSummaryLabels,
    };
  }

  // 4. Check if Anna is asking what Pixel remembers about her
  if (
    lower.includes('что ты помнишь') ||
    lower.includes('что знаешь обо мне') ||
    lower.includes('моя память')
  ) {
    if (memories.length === 0) {
      return {
        replyText:
          'Анна, моя память пока чиста — я ничего не записываю без вашего согласия. Напишите мне «Запомни: ...» или добавьте запись во вкладке «Что я помню», и я буду бережно хранить её в IndexedDB.',
        usedContextLabels: contextBundle.contextSummaryLabels,
      };
    }

    const memPreview = memories
      .slice(0, 3)
      .map(
        (m) =>
          `• [${MEMORY_CATEGORY_META[m.category].title}] ${m.title}: ${m.content}`
      )
      .join('\n');

    return {
      replyText: [
        `Анна, сейчас в моей памяти сохранено записей: ${memories.length}. Вот основные из них:`,
        memPreview,
        `Вы всегда можете просмотреть, отредактировать или удалить любую запись во вкладке «Что я помню».`,
      ].join('\n'),
      usedContextLabels: contextBundle.contextSummaryLabels,
    };
  }

  // 5. Check if message contains a memory proposal candidate (Part 7)
  const memoryProposal = parseMemoryProposalFromMessage(trimmed, activeSchool);
  if (memoryProposal) {
    return {
      replyText: `Анна, это звучит как полезная рабочая деталь для раздела «${MEMORY_CATEGORY_META[memoryProposal.category].title}». Анна, запомнить это? Подтвердите сохранение в карточке ниже.`,
      usedContextLabels: contextBundle.contextSummaryLabels,
      proposedMemory: memoryProposal,
    };
  }

  // 6. Honest default reply explaining current local capabilities before Stage 3 Gemini API
  return {
    replyText: [
      `Анна, я записал ваше сообщение в нашу личную переписку!`,
      `Сейчас мы находимся на этапе локального хранилища IndexedDB (серверный маршрут Gemini API для свободных ответов подключается на Этапе 3).`,
      `Уже сейчас я умею реально выполнять для вас:`,
      `• создаю задачи с датой (напишите: «Пиксель, напомни мне завтра ...»);`,
      `• запоминаю важные факты и решения с вашего согласия (напишите: «Запомни: ...»);`,
      `• слежу за временем активной работы, чтобы вовремя предложить перерыв.`,
    ].join('\n'),
    usedContextLabels: contextBundle.contextSummaryLabels,
  };
}
