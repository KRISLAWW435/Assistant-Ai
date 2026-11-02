import {
  AgentMode,
  CompanionTaskPriority,
  CompanionTaskRecord,
  CompanionTaskStep,
  CompanionTaskStatus,
  PixelDelegatedTaskState,
  SchoolId,
} from '../types/assistant';
import {
  addDaysToIsoDate,
  formatSyzranIsoDateRu,
  getSyzranNow,
  toSyzranIsoDate,
} from './syzranTime';

export interface TaskPriorityEvaluation {
  priority: CompanionTaskPriority;
  urgencyScore: number; // 1..10
  importanceScore: number; // 1..10
  estimatedMinutes: number;
  consequencesIfDelayed: string;
  dependencyNote: string;
  priorityReason: string;
}

export interface AutoExtractedTaskResult {
  taskRecord: CompanionTaskRecord;
  shortConfirmationText: string;
}

export interface TaskCommandExecutionResult {
  handled: boolean;
  responseText: string;
  spokenSummary?: string;
  createdTask?: CompanionTaskRecord;
  updatedTasks?: CompanionTaskRecord[];
  openTasksTabWithFilter?:
    | 'all'
    | 'today'
    | 'tomorrow'
    | 'week'
    | 'urgent'
    | 'overdue'
    | 'waiting_response';
}

export interface DueReminderAlert {
  id: string;
  type:
    | 'task_reminder'
    | 'approaching_deadline'
    | 'overdue_task'
    | 'postponed_task'
    | 'unanswered_delegation';
  title: string;
  message: string;
  taskId?: string;
  delegationTaskId?: string;
  updatedTaskPatch?: Partial<CompanionTaskRecord>;
}

const SPECIALIST_DELEGATION_PATTERN =
  /(?:поручи|передай|делегируй|отправь|попроси|скажи|напиши|дай\s+задани[ея]|поставь\s+задачу|пусть|спроси\s+у)\s+.*?(?:маркетолог|менеджер|методист|аналитик)/i;

const HYPOTHETICAL_OR_QUOTE_PATTERN =
  /(?:например|допустим|предположим|представь|если\s+бы|в\s+качестве\s+примера|как\s+вариант|цитирую|он\s+сказал|она\s+сказала|клиент\s+написал|родитель\s+спросил|«.+»|".+")/i;

/**
 * Multi-criteria priority evaluation:
 * 1. Срочность (Urgency)
 * 2. Важность (Importance)
 * 3. Дедлайн (Deadline proximity)
 * 4. Последствия невыполнения (Consequences)
 * 5. Зависимость от других задач (Dependencies)
 * 6. Предполагаемые трудозатраты (Effort in minutes)
 */
export function evaluateTaskPriorityMultiCriteria(
  title: string,
  description: string,
  dueDate: string,
  todayIso: string = toSyzranIsoDate()
): TaskPriorityEvaluation {
  const combined = `${title} ${description}`.toLowerCase();

  let urgencyScore = 5;
  let importanceScore = 5;
  let estimatedMinutes = 30;
  let consequencesIfDelayed = 'Перенос текущей операционной задачи';
  let dependencyNote = 'Не блокирует другие задачи напрямую';
  const reasons: string[] = [];

  // 1. Deadline proximity
  if (dueDate) {
    if (dueDate < todayIso) {
      urgencyScore = Math.max(urgencyScore, 10);
      reasons.push('срок уже прошёл (просрочено)');
    } else if (dueDate === todayIso) {
      urgencyScore = Math.max(urgencyScore, 9);
      reasons.push('дедлайн сегодня');
    } else if (dueDate === addDaysToIsoDate(todayIso, 1)) {
      urgencyScore = Math.max(urgencyScore, 7);
      reasons.push('срок уже завтра');
    } else if (dueDate <= addDaysToIsoDate(todayIso, 3)) {
      urgencyScore = Math.max(urgencyScore, 6);
      reasons.push('срок в ближайшие 3 дня');
    } else {
      urgencyScore = Math.min(urgencyScore, 4);
    }
  } else {
    urgencyScore = 3;
    reasons.push('жёсткий дедлайн не задан');
  }

  // 2. Explicit urgency markers
  if (/(срочно|немедленно|прямо сейчас|до обеда|до вечера|сегодня обязательно|горит|критично)/i.test(combined)) {
    urgencyScore = Math.min(10, urgencyScore + 2);
    reasons.push('отмечено как срочное');
  } else if (/(когда-нибудь|не к спеху|потом|на досуге|при случае|по возможности)/i.test(combined)) {
    urgencyScore = Math.max(1, urgencyScore - 2);
  }

  // 3. Importance & consequences (clients, parents, payments, schedule, teachers)
  if (/(родител|клиент|оплат|договор|возврат|жалоб|перенос\s+занят|расписани|пробн\w*\s+урок|набор\s+групп|зарплат|педагог|тьютор)/i.test(combined)) {
    importanceScore = Math.max(importanceScore, 9);
    consequencesIfDelayed =
      'Риск потери лояльности родителей/учеников или срыва расписания занятий';
    reasons.push('влияет на родителей, расписание или выручку школы');
  } else if (/(отчет|отчёт|аналитик|статистик|бюджет|контент-план|реклам|кампани|методич|программ)/i.test(combined)) {
    importanceScore = Math.max(importanceScore, 7);
    consequencesIfDelayed =
      'Задержка управленческого контроля или маркетингового запуска';
    reasons.push('важно для управления и развития филиала');
  } else if (/(обновить презентацию|разобрать архив|почистить|шаблон|идеи|оформлени)/i.test(combined)) {
    importanceScore = Math.min(importanceScore, 5);
    consequencesIfDelayed = 'Внутренняя задача улучшения без немедленного риска';
  }

  // 4. Dependencies
  if (/(до\s+запуска|перед\s+звонком|перед\s+встречей|для\s+маркетолога|для\s+методиста|чтобы\s+отправить|согласовать)/i.test(combined)) {
    importanceScore = Math.min(10, importanceScore + 1);
    dependencyNote = 'От этой задачи зависят следующие действия команды';
    reasons.push('блокирует следующий шаг работы');
  }

  // 5. Effort estimation in minutes
  if (/(позвонить|написать|ответить|напомнить|отправить\s+сообщение|проверить|уточнить)/i.test(combined)) {
    estimatedMinutes = 15;
  } else if (/(составить|подготовить|разработать|проанализировать|провести\s+встречу|отчёт|отчет|презентац|план)/i.test(combined)) {
    estimatedMinutes = 60;
  } else if (/(аудит|стратеги|большой|полный\s+разбор|обучение)/i.test(combined)) {
    estimatedMinutes = 90;
  } else {
    estimatedMinutes = 30;
  }

  const compositeScore = urgencyScore * 0.55 + importanceScore * 0.45;
  let priority: CompanionTaskPriority = 'medium';
  if (compositeScore >= 7.4 || (urgencyScore >= 9 && importanceScore >= 7)) {
    priority = 'high';
  } else if (compositeScore <= 4.3 && urgencyScore <= 4) {
    priority = 'low';
  }

  const priorityLabelRu =
    priority === 'high'
      ? 'Высокий приоритет'
      : priority === 'medium'
      ? 'Средний приоритет'
      : 'Низкий приоритет';

  const reasonText =
    reasons.length > 0
      ? `${priorityLabelRu}: ${reasons.join(', ')}. Оценка времени: ~${estimatedMinutes} мин.`
      : `${priorityLabelRu}: стандартная рабочая задача (~${estimatedMinutes} мин).`;

  return {
    priority,
    urgencyScore,
    importanceScore,
    estimatedMinutes,
    consequencesIfDelayed,
    dependencyNote,
    priorityReason: reasonText,
  };
}

/**
 * Generates actionable sub-steps for a task («Разбей эту задачу на шаги»).
 */
export function generateTaskSteps(title: string, description: string = ''): CompanionTaskStep[] {
  const combined = `${title} ${description}`.toLowerCase();
  const baseId = `step_${Date.now()}`;

  if (/(родител|перенос|расписани|уведомить|написать)/i.test(combined)) {
    return [
      { id: `${baseId}_1`, title: 'Уточнить список групп и родителей, которых касается изменение', done: false },
      { id: `${baseId}_2`, title: 'Подготовить короткое вежливое сообщение с датой и временем', done: false },
      { id: `${baseId}_3`, title: 'Отправить сообщение в чат/мессенджер и собрать подтверждения', done: false },
    ];
  }

  if (/(презентац|программ|методич|урок|модуль)/i.test(combined)) {
    return [
      { id: `${baseId}_1`, title: 'Собрать актуальную структуру модулей и возрастные группы', done: false },
      { id: `${baseId}_2`, title: 'Обновить ключевые слайды и примеры проектов учеников', done: false },
      { id: `${baseId}_3`, title: 'Проверить контакты, цены и призыв к записи на пробный урок', done: false },
    ];
  }

  if (/(отчет|отчёт|аналитик|воронк|конверси|бюджет|статистик)/i.test(combined)) {
    return [
      { id: `${baseId}_1`, title: 'Выгрузить данные по заявкам, пробным занятиям и оплатам за период', done: false },
      { id: `${baseId}_2`, title: 'Сравнить показатели по KIBERone и RENDERIA с планом', done: false },
      { id: `${baseId}_3`, title: 'Зафиксировать узкие места и список решений на следующую неделю', done: false },
    ];
  }

  if (/(контент|пост|реклам|акци|рассылк|маркетинг)/i.test(combined)) {
    return [
      { id: `${baseId}_1`, title: 'Определить целевую аудиторию и главный оффер школы', done: false },
      { id: `${baseId}_2`, title: 'Подготовить текст и визуальные материалы', done: false },
      { id: `${baseId}_3`, title: 'Согласовать дату публикации и запустить', done: false },
    ];
  }

  return [
    { id: `${baseId}_1`, title: `Подготовить исходные данные по задаче «${title}»`, done: false },
    { id: `${baseId}_2`, title: 'Выполнить основную часть и проверить детали', done: false },
    { id: `${baseId}_3`, title: 'Зафиксировать итог и отметить задачу выполненной', done: false },
  ];
}

export function detectSchoolFromTaskText(
  text: string,
  fallbackSchool: SchoolId | 'both' = 'both'
): SchoolId | 'both' {
  const lower = text.toLowerCase();
  const hasKiberone =
    lower.includes('kiberone') ||
    lower.includes('кибероне') ||
    lower.includes('киберван') ||
    lower.includes('кибер1');
  const hasRenderia =
    lower.includes('renderia') ||
    lower.includes('рендери') ||
    lower.includes('рэндэри');

  if (hasKiberone && hasRenderia) return 'both';
  if (hasKiberone) return 'kiberone';
  if (hasRenderia) return 'renderia';
  return fallbackSchool;
}

export function parseRelativeDateAndTimeFromRuText(
  text: string,
  todayIso: string = toSyzranIsoDate()
): { dueDate: string; dueTime?: string; dateLabelRu: string } {
  const lower = text.toLowerCase();

  let dueTime: string | undefined;
  const timeMatch = lower.match(/(?:в|к)\s*(\d{1,2})(?::(\d{2}))?\s*(?:час(?:а|ов)?|ч\b|утра|дня|вечера)?/i);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      if (lower.includes('вечера') && hour < 12) hour += 12;
      dueTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  // Dateless markers («когда-нибудь», «без срока», «при случае»)
  if (/(когда-нибудь|без\s+срока|не\s+к\s+спеху|на\s+будущее|в\s+долгий\s+ящик)/i.test(lower)) {
    return { dueDate: '', dueTime, dateLabelRu: 'без жёсткого срока' };
  }

  if (lower.includes('послезавтра')) {
    const dueDate = addDaysToIsoDate(todayIso, 2);
    return { dueDate, dueTime, dateLabelRu: 'на послезавтра' };
  }

  if (lower.includes('завтра')) {
    const dueDate = addDaysToIsoDate(todayIso, 1);
    return { dueDate, dueTime, dateLabelRu: 'на завтра' };
  }

  if (lower.includes('сегодня') || lower.includes('до вечера') || lower.includes('до обеда')) {
    return { dueDate: todayIso, dueTime, dateLabelRu: 'на сегодня' };
  }

  const inDaysMatch = lower.match(/через\s+(\d{1,2})\s+дн/);
  if (inDaysMatch) {
    const days = parseInt(inDaysMatch[1], 10);
    const dueDate = addDaysToIsoDate(todayIso, days);
    return { dueDate, dueTime, dateLabelRu: `на ${formatSyzranIsoDateRu(dueDate)}` };
  }

  if (lower.includes('на следующей неделе') || lower.includes('через неделю')) {
    const dueDate = addDaysToIsoDate(todayIso, 7);
    return { dueDate, dueTime, dateLabelRu: `на ${formatSyzranIsoDateRu(dueDate)}` };
  }

  // Day of week detection
  const weekdays: Array<{ pattern: RegExp; targetDow: number; label: string }> = [
    { pattern: /в\s+понедельник/, targetDow: 1, label: 'в понедельник' },
    { pattern: /во?\s+вторник/, targetDow: 2, label: 'во вторник' },
    { pattern: /в\s+среду/, targetDow: 3, label: 'в среду' },
    { pattern: /в\s+четверг/, targetDow: 4, label: 'в четверг' },
    { pattern: /в\s+пятницу/, targetDow: 5, label: 'в пятницу' },
    { pattern: /в\s+субботу/, targetDow: 6, label: 'в субботу' },
    { pattern: /в\s+воскресенье/, targetDow: 0, label: 'в воскресенье' },
  ];

  const [y, m, d] = todayIso.split('-').map(Number);
  const currentDow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();

  for (const wd of weekdays) {
    if (wd.pattern.test(lower)) {
      let delta = (wd.targetDow - currentDow + 7) % 7;
      if (delta === 0) delta = 7;
      const dueDate = addDaysToIsoDate(todayIso, delta);
      return { dueDate, dueTime, dateLabelRu: `${wd.label} (${formatSyzranIsoDateRu(dueDate)})` };
    }
  }

  const explicitIsoMatch = lower.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (explicitIsoMatch) {
    const dueDate = explicitIsoMatch[1];
    return { dueDate, dueTime, dateLabelRu: `на ${formatSyzranIsoDateRu(dueDate)}` };
  }

  return { dueDate: '', dueTime, dateLabelRu: 'без даты' };
}

function cleanExtractedTaskTitle(raw: string): string {
  let cleaned = raw
    .replace(/^(?:мне\s+)?(?:сегодня|завтра|послезавтра|на\s+следующей\s+неделе|в\s+понедельник|во?\s+вторник|в\s+среду|в\s+четверг|в\s+пятницу|в\s+субботу|в\s+воскресенье)?\s*(?:мне\s+)?(?:нужно|надо|необходимо|предстоит|не\s+забыть(?:\s+бы)?|стоит|планирую|хочу\s+не\s+забыть|важно)\s*(?:будет\s+)?(?:когда-нибудь\s+|сегодня\s+|завтра\s+|послезавтра\s+)?/i, '')
    .replace(/^(?:добавь|создай|запиши|поставь)\s+(?:мне\s+)?задач[уи]\s*[:—-]?\s*/i, '')
    .replace(/\s+(?:сегодня|завтра|послезавтра|когда-нибудь|до\s+вечера|до\s+обеда)\s*$/i, '')
    .replace(/[.!?;]+$/g, '')
    .trim();

  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Automatically extracts a personal task for Anna from normal conversational statements:
 * e.g. «Завтра нужно написать родителям о переносе занятия»
 * or «Мне нужно когда-нибудь обновить презентацию»
 *
 * Strictly ignores:
 * - Questions («Нужно ли мне...?»)
 * - Hypotheticals, examples, quotes («Например, завтра нужно...»)
 * - Specialist delegations («Попроси Маркетолога...»)
 * - Direct task manager commands (handled by parseAndExecuteTaskCommand)
 */
export function extractAutoTaskFromConversation(
  userText: string,
  activeSchool: SchoolId,
  existingTasks: CompanionTaskRecord[],
  sourceMessageId?: string
): AutoExtractedTaskResult | null {
  const trimmed = userText.trim();
  if (trimmed.length < 10 || trimmed.length > 260) return null;
  if (trimmed.includes('?')) return null;
  if (SPECIALIST_DELEGATION_PATTERN.test(trimmed)) return null;
  if (HYPOTHETICAL_OR_QUOTE_PATTERN.test(trimmed)) return null;

  // Match personal obligation statements by Anna
  const obligationPatterns = [
    /^(?:мне\s+)?(?:сегодня|завтра|послезавтра|в\s+[а-яё]+|на\s+следующей\s+неделе)\s+(?:мне\s+)?(?:нужно|надо|необходимо|предстоит|важно)\s+(?:будет\s+)?(.{5,180})$/i,
    /^(?:мне\s+)?(?:нужно|надо|необходимо|не\s+забыть(?:\s+бы)?)\s+(?:будет\s+)?(?:сегодня|завтра|послезавтра|когда-нибудь|до\s+вечера|до\s+обеда)?\s*(.{5,180})$/i,
  ];

  let matchedRawAction: string | null = null;
  for (const pattern of obligationPatterns) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      matchedRawAction = match[1].trim();
      break;
    }
  }

  if (!matchedRawAction) return null;

  // Avoid extracting AI meta-requests like "Мне нужно чтобы ты ответила..." or "Мне нужно узнать..."
  if (/^(?:чтобы\s+ты|узнать\s+у\s+тебя|спросить\s+тебя|понять\s+как\s+ты|поговорить\s+с\s+тобой)/i.test(matchedRawAction)) {
    return null;
  }

  const title = cleanExtractedTaskTitle(matchedRawAction);
  if (!title || title.length < 4) return null;

  // Deduplicate against active tasks
  const normalizedTitle = title.toLowerCase();
  const alreadyExists = existingTasks.some(
    (t) =>
      t.status !== 'done' &&
      (t.title.toLowerCase() === normalizedTitle ||
        t.title.toLowerCase().includes(normalizedTitle) ||
        normalizedTitle.includes(t.title.toLowerCase()))
  );
  if (alreadyExists) return null;

  const syzranNow = getSyzranNow();
  const { dueDate, dueTime, dateLabelRu } = parseRelativeDateAndTimeFromRuText(
    trimmed,
    syzranNow.isoDate
  );

  const evaluation = evaluateTaskPriorityMultiCriteria(
    title,
    trimmed,
    dueDate,
    syzranNow.isoDate
  );

  const schoolId = detectSchoolFromTaskText(trimmed, activeSchool);
  const nowMs = Date.now();

  const taskRecord: CompanionTaskRecord = {
    id: `ctask_auto_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
    title,
    description: `Создано автоматически из сообщения Анны: «${trimmed}»`,
    dueDate,
    dueTime,
    priority: evaluation.priority,
    priorityReason: evaluation.priorityReason,
    urgencyScore: evaluation.urgencyScore,
    importanceScore: evaluation.importanceScore,
    estimatedMinutes: evaluation.estimatedMinutes,
    consequencesIfDelayed: evaluation.consequencesIfDelayed,
    dependencyNote: evaluation.dependencyNote,
    status: 'new',
    schoolId,
    sourceType: 'conversation_auto',
    sourceExcerpt: trimmed,
    sourceMessageId,
    createdAt: syzranNow.time24,
    createdAtMs: nowMs,
  };

  const shortConfirmationText =
    dueDate
      ? `Добавила задачу ${dateLabelRu}: «${title}» (${evaluation.priorityReason})`
      : `Добавила задачу без жёсткой даты: «${title}» (${evaluation.priorityReason})`;

  return {
    taskRecord,
    shortConfirmationText,
  };
}

/**
 * Finds the best matching active task by title query or returns the latest created/mentioned task.
 */
function findMatchingTask(
  tasks: CompanionTaskRecord[],
  queryText: string
): CompanionTaskRecord | null {
  const active = tasks.filter((t) => t.status !== 'done');
  if (active.length === 0) return null;

  const cleanedQuery = queryText
    .toLowerCase()
    .replace(/(?:задач[уи]|дело|пункт|это|эту|ту|мо[юй]|про|о\s+том\s+что)/gi, '')
    .trim();

  if (!cleanedQuery || cleanedQuery.length < 3) {
    // Return most recently created active task
    return [...active].sort((a, b) => b.createdAtMs - a.createdAtMs)[0];
  }

  const words = cleanedQuery.split(/\s+/).filter((w) => w.length >= 3);
  let bestTask: CompanionTaskRecord | null = null;
  let bestScore = 0;

  for (const task of active) {
    const hay = `${task.title} ${task.description}`.toLowerCase();
    if (hay.includes(cleanedQuery)) {
      return task;
    }
    let score = 0;
    for (const w of words) {
      if (hay.includes(w.slice(0, Math.max(3, w.length - 1)))) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestTask = task;
    }
  }

  return bestScore > 0 ? bestTask : [...active].sort((a, b) => b.createdAtMs - a.createdAtMs)[0];
}

/**
 * Builds a comprehensive workday or weekly plan report with workload estimation and
 * safe reschedule proposals (never moving deadlines silently).
 */
export function buildWorkdayPlanReport(
  tasks: CompanionTaskRecord[],
  targetScope: 'today' | 'tomorrow' | 'week',
  todayIso: string = toSyzranIsoDate()
): {
  reportMarkdown: string;
  spokenSummary: string;
  tasksWithProposals: CompanionTaskRecord[];
} {
  const tomorrowIso = addDaysToIsoDate(todayIso, 1);
  const weekEndIso = addDaysToIsoDate(todayIso, 7);

  const active = tasks.filter((t) => t.status !== 'done');
  const overdue = active.filter((t) => t.dueDate && t.dueDate < todayIso);
  const waitingResponse = active.filter((t) => t.status === 'waiting_response');

  let scopedTasks: CompanionTaskRecord[] = [];
  let scopeTitleRu = '';

  if (targetScope === 'today') {
    scopedTasks = active.filter((t) => t.dueDate === todayIso);
    scopeTitleRu = `на сегодня (${formatSyzranIsoDateRu(todayIso)})`;
  } else if (targetScope === 'tomorrow') {
    scopedTasks = active.filter((t) => t.dueDate === tomorrowIso);
    scopeTitleRu = `на завтра (${formatSyzranIsoDateRu(tomorrowIso)})`;
  } else {
    scopedTasks = active.filter(
      (t) => t.dueDate >= todayIso && t.dueDate <= weekEndIso
    );
    scopeTitleRu = `на неделю (${formatSyzranIsoDateRu(todayIso)} — ${formatSyzranIsoDateRu(weekEndIso)})`;
  }

  // Sort by priority and urgency
  const priorityOrder: Record<CompanionTaskPriority, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  const sortedScoped = [...scopedTasks].sort(
    (a, b) =>
      priorityOrder[a.priority] - priorityOrder[b.priority] ||
      (b.urgencyScore || 5) - (a.urgencyScore || 5)
  );

  const totalMinutes = sortedScoped.reduce(
    (sum, t) => sum + (t.estimatedMinutes || 30),
    0
  );
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const durationLabel =
    hours > 0 ? `${hours} ч ${mins > 0 ? `${mins} мин` : ''}`.trim() : `${mins} мин`;

  const lines: string[] = [];
  lines.push(`### План задач ${scopeTitleRu}`);
  lines.push(
    `**Время в Сызрани:** ${getSyzranNow().fullLabelRu}`
  );

  if (overdue.length > 0) {
    lines.push('');
    lines.push(`⚠️ **Просроченные задачи (${overdue.length}):**`);
    for (const t of overdue.slice(0, 5)) {
      lines.push(
        `- **${t.title}** (срок был ${formatSyzranIsoDateRu(t.dueDate)}, ~${t.estimatedMinutes || 30} мин) — *${t.priorityReason || 'требует внимания'}*`
      );
    }
  }

  if (sortedScoped.length === 0) {
    lines.push('');
    lines.push(`На выбранный период (${scopeTitleRu}) жёстко привязанных задач пока нет.`);
    const unscheduled = active.filter((t) => !t.dueDate);
    if (unscheduled.length > 0) {
      lines.push('');
      lines.push(`📌 **Задачи без даты (${unscheduled.length}), которые можно взять в работу:**`);
      for (const t of unscheduled.slice(0, 4)) {
        lines.push(`- **${t.title}** (~${t.estimatedMinutes || 30} мин)`);
      }
    }
  } else {
    lines.push('');
    lines.push(
      `📋 **Запланировано задач:** ${sortedScoped.length} | **Оценка общей нагрузки:** ~${durationLabel}`
    );
    lines.push('');
    for (let i = 0; i < sortedScoped.length; i++) {
      const t = sortedScoped[i];
      const badge =
        t.priority === 'high'
          ? '🔴 Срочно/Важно'
          : t.priority === 'medium'
          ? 'amber Средний'
          : '🟢 Спокойный';
      const timeSuffix = t.dueTime ? ` к ${t.dueTime}` : '';
      lines.push(
        `${i + 1}. **${t.title}** (${badge.replace('amber ', '🟡 ')}, ~${t.estimatedMinutes || 30} мин${timeSuffix})\n   *Причина приоритета:* ${t.priorityReason || 'рабочая задача'}`
      );
    }
  }

  if (waitingResponse.length > 0) {
    lines.push('');
    lines.push(`⏳ **Ожидают ответа специалистов (${waitingResponse.length}):**`);
    for (const t of waitingResponse.slice(0, 4)) {
      lines.push(`- **${t.title}**`);
    }
  }

  // Workload check: if single day load > 240 mins or > 5 tasks, propose moving low/medium tasks WITHOUT changing dueDate silently
  const tasksWithProposals: CompanionTaskRecord[] = [];
  if (
    (targetScope === 'today' || targetScope === 'tomorrow') &&
    (totalMinutes > 240 || sortedScoped.length > 5)
  ) {
    const candidates = sortedScoped.filter((t) => t.priority !== 'high');
    if (candidates.length > 0) {
      const candidate = candidates[candidates.length - 1];
      const nextDayIso = addDaysToIsoDate(
        targetScope === 'today' ? todayIso : tomorrowIso,
        1
      );
      const updatedCandidate: CompanionTaskRecord = {
        ...candidate,
        pendingScheduleProposal: {
          proposedDueDate: nextDayIso,
          reason: `Высокая плотность дня (~${durationLabel}). Перенос разгрузит расписание без риска для срочных дел.`,
          createdAtMs: Date.now(),
        },
      };
      tasksWithProposals.push(updatedCandidate);

      lines.push('');
      lines.push(
        `💡 **Рекомендация по нагрузке:** суммарный объём задач составляет ~${durationLabel}. Я **не меняла дедлайны автоматически**, но предлагаю перенести несрочную задачу **«${candidate.title}»** на ${formatSyzranIsoDateRu(nextDayIso)}. Вы можете подтвердить перенос одной кнопкой во вкладке «Задачи» или сказать: *«Перенеси задачу ${candidate.title} на завтра»*.`
      );
    }
  }

  const spokenSummary =
    sortedScoped.length > 0
      ? `План ${scopeTitleRu}: всего задач ${sortedScoped.length}, ориентировочная нагрузка ${durationLabel}. Самое важное: ${sortedScoped[0].title}.`
      : `На период ${scopeTitleRu} запланированных задач нет.${overdue.length > 0 ? ` Но есть просроченные задачи: ${overdue.length}.` : ''}`;

  return {
    reportMarkdown: lines.join('\n'),
    spokenSummary,
    tasksWithProposals,
  };
}

/**
 * Parses and executes voice & text task management commands directly against Anna's task list.
 */
export function parseAndExecuteTaskCommand(
  userText: string,
  activeSchool: SchoolId,
  existingTasks: CompanionTaskRecord[]
): TaskCommandExecutionResult | null {
  const trimmed = userText.trim();
  const lower = trimmed.toLowerCase();
  const syzranNow = getSyzranNow();
  const todayIso = syzranNow.isoDate;
  const tomorrowIso = addDaysToIsoDate(todayIso, 1);

  if (SPECIALIST_DELEGATION_PATTERN.test(trimmed)) {
    return null;
  }

  // 1. Explicit «Добавь задачу...» / «Создай задачу...» / «Запиши задачу...»
  const addMatch = trimmed.match(
    /^(?:пиксель\s*,?\s*)?(?:добавь|создай|запиши|поставь)\s+(?:мне\s+)?задач[уи]\s*[:—-]?\s*(.+)$/i
  );
  if (addMatch && addMatch[1]) {
    const rawBody = addMatch[1].trim();
    const { dueDate, dueTime, dateLabelRu } = parseRelativeDateAndTimeFromRuText(
      rawBody,
      todayIso
    );
    const title = cleanExtractedTaskTitle(rawBody) || rawBody;
    const evaluation = evaluateTaskPriorityMultiCriteria(
      title,
      rawBody,
      dueDate,
      todayIso
    );
    const schoolId = detectSchoolFromTaskText(rawBody, activeSchool);
    const nowMs = Date.now();

    const newTask: CompanionTaskRecord = {
      id: `ctask_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      description: `Поставлено командой Анны: «${trimmed}»`,
      dueDate,
      dueTime,
      priority: evaluation.priority,
      priorityReason: evaluation.priorityReason,
      urgencyScore: evaluation.urgencyScore,
      importanceScore: evaluation.importanceScore,
      estimatedMinutes: evaluation.estimatedMinutes,
      consequencesIfDelayed: evaluation.consequencesIfDelayed,
      dependencyNote: evaluation.dependencyNote,
      status: 'new',
      schoolId,
      sourceType: 'voice_command',
      sourceExcerpt: trimmed,
      createdAt: syzranNow.time24,
      createdAtMs: nowMs,
    };

    const dueInfo = dueDate ? ` (${dateLabelRu}, ${formatSyzranIsoDateRu(dueDate)})` : ' (без жёсткого срока)';
    return {
      handled: true,
      createdTask: newTask,
      openTasksTabWithFilter: 'all',
      responseText: `Записала задачу **«${newTask.title}»**${dueInfo}.\n\n- **Приоритет:** ${evaluation.priorityReason}\n- **Последствия при откладывании:** ${evaluation.consequencesIfDelayed}`,
      spokenSummary: `Добавила задачу: ${newTask.title}${dueDate ? ` ${dateLabelRu}` : ''}.`,
    };
  }

  // 2. «Что мне нужно сделать сегодня?» / «Какие дела на сегодня?» / «Сколько у меня сегодня дел?»
  if (
    /(?:что\s+(?:мне\s+)?(?:нужно|надо)\s+сделать\s+сегодня|какие\s+(?:у\s+меня\s+)?(?:задачи|дела)\s+на\s+сегодня|сколько\s+у\s+меня\s+сегодня\s+(?:дел|задач)|план\s+на\s+сегодня)/i.test(
      lower
    )
  ) {
    const plan = buildWorkdayPlanReport(existingTasks, 'today', todayIso);
    return {
      handled: true,
      updatedTasks: plan.tasksWithProposals.length > 0 ? plan.tasksWithProposals : undefined,
      openTasksTabWithFilter: 'today',
      responseText: plan.reportMarkdown,
      spokenSummary: plan.spokenSummary,
    };
  }

  // 3. «Составь план на завтра» / «Что у меня на завтра?»
  if (
    /(?:составь\s+план\s+на\s+завтра|план\s+на\s+завтра|какие\s+(?:задачи|дела)\s+на\s+завтра|что\s+(?:нужно\s+сделать\s+)?на\s+завтра)/i.test(
      lower
    )
  ) {
    const plan = buildWorkdayPlanReport(existingTasks, 'tomorrow', todayIso);
    return {
      handled: true,
      updatedTasks: plan.tasksWithProposals.length > 0 ? plan.tasksWithProposals : undefined,
      openTasksTabWithFilter: 'tomorrow',
      responseText: plan.reportMarkdown,
      spokenSummary: plan.spokenSummary,
    };
  }

  // 4. «Составь план на неделю» / «План на неделю»
  if (/(?:план\s+на\s+неделю|задачи\s+на\s+неделю|дела\s+на\s+неделю)/i.test(lower)) {
    const plan = buildWorkdayPlanReport(existingTasks, 'week', todayIso);
    return {
      handled: true,
      openTasksTabWithFilter: 'week',
      responseText: plan.reportMarkdown,
      spokenSummary: plan.spokenSummary,
    };
  }

  // 5. «Что самое срочное?» / «Какие задачи самые срочные?»
  if (/(?:что\s+самое\s+срочное|какие\s+задачи\s+(?:самые\s+)?срочные|приоритетные\s+задачи|с\s+чего\s+начать\s+день)/i.test(lower)) {
    const active = existingTasks.filter((t) => t.status !== 'done');
    if (active.length === 0) {
      return {
        handled: true,
        openTasksTabWithFilter: 'urgent',
        responseText: 'Сейчас у вас нет активных незавершённых задач — все срочные дела закрыты!',
        spokenSummary: 'Сейчас у вас нет активных срочных задач.',
      };
    }

    const sorted = [...active].sort((a, b) => {
      const aOverdue = a.dueDate && a.dueDate < todayIso ? 1 : 0;
      const bOverdue = b.dueDate && b.dueDate < todayIso ? 1 : 0;
      if (aOverdue !== bOverdue) return bOverdue - aOverdue;
      const pMap = { high: 3, medium: 2, low: 1 };
      if (pMap[a.priority] !== pMap[b.priority]) return pMap[b.priority] - pMap[a.priority];
      return (b.urgencyScore || 5) - (a.urgencyScore || 5);
    });

    const top = sorted.slice(0, 4);
    const lines = [
      `### Самые срочные задачи на ${syzranNow.dateRu}`,
      '',
      ...top.map(
        (t, idx) =>
          `${idx + 1}. **${t.title}** (${t.dueDate ? `срок: ${formatSyzranIsoDateRu(t.dueDate)}` : 'без даты'}, ~${t.estimatedMinutes || 30} мин)\n   *Почему срочно:* ${t.priorityReason || 'Высокая важность для работы школ'}`
      ),
    ];

    return {
      handled: true,
      openTasksTabWithFilter: 'urgent',
      responseText: lines.join('\n'),
      spokenSummary: `Самая срочная задача сейчас: ${top[0].title}. Всего приоритетных задач: ${top.length}.`,
    };
  }

  // 6. «Какие задачи я просрочила?» / «Что просрочено?»
  if (/(?:какие\s+задачи\s+(?:я\s+)?просрочил[аи]?|что\s+(?:у\s+меня\s+)?просрочено|просроченные\s+задачи)/i.test(lower)) {
    const overdue = existingTasks.filter(
      (t) => t.status !== 'done' && t.dueDate && t.dueDate < todayIso
    );
    if (overdue.length === 0) {
      return {
        handled: true,
        openTasksTabWithFilter: 'overdue',
        responseText: `Отличные новости, Анна! По состоянию на **${syzranNow.dateRu}** просроченных задач нет.`,
        spokenSummary: 'Просроченных задач нет, вы идёте по графику!',
      };
    }

    const lines = [
      `### Просроченные задачи (${overdue.length})`,
      '',
      ...overdue.map(
        (t, i) =>
          `${i + 1}. **${t.title}** — дедлайн был **${formatSyzranIsoDateRu(t.dueDate)}** (~${t.estimatedMinutes || 30} мин)`
      ),
      '',
      'Могу перенести их на сегодня или завтра по вашей команде, например: *«Перенеси это на завтра»*.',
    ];

    return {
      handled: true,
      openTasksTabWithFilter: 'overdue',
      responseText: lines.join('\n'),
      spokenSummary: `У вас ${overdue.length} просроченных задач. Первая из них: ${overdue[0].title}.`,
    };
  }

  // 7. «Что я ещё не закончила?» / «Какие задачи не закрыты?»
  if (/(?:что\s+я\s+(?:ещ[её]\s+)?не\s+закончила|какие\s+задачи\s+(?:ещ[её]\s+)?не\s+(?:закрыты|выполнены|сделаны)|список\s+активных\s+задач)/i.test(lower)) {
    const unfinished = existingTasks.filter((t) => t.status !== 'done');
    if (unfinished.length === 0) {
      return {
        handled: true,
        openTasksTabWithFilter: 'all',
        responseText: 'Все задачи в списке отмечены выполненными!',
        spokenSummary: 'Все задачи выполнены!',
      };
    }

    const inProgress = unfinished.filter((t) => t.status === 'in_progress');
    const waiting = unfinished.filter((t) => t.status === 'waiting_response');
    const postponed = unfinished.filter((t) => t.status === 'postponed');
    const newOnes = unfinished.filter((t) => t.status === 'new');

    const lines = [
      `### Незавершённые задачи (всего: ${unfinished.length})`,
      `- **В работе:** ${inProgress.length}`,
      `- **Новые:** ${newOnes.length}`,
      `- **Ожидают ответа специалиста:** ${waiting.length}`,
      `- **Отложенные:** ${postponed.length}`,
      '',
      ...unfinished.slice(0, 7).map(
        (t, i) =>
          `${i + 1}. **${t.title}** (${t.dueDate ? formatSyzranIsoDateRu(t.dueDate) : 'без даты'})`
      ),
    ];

    return {
      handled: true,
      openTasksTabWithFilter: 'all',
      responseText: lines.join('\n'),
      spokenSummary: `У вас осталось ${unfinished.length} незавершённых задач.`,
    };
  }

  // 8. «Перенеси это на завтра» / «Перенеси задачу ... на завтра / послезавтра»
  const rescheduleMatch = trimmed.match(
    /^(?:пиксель\s*,?\s*)?перенеси\s+(?:задач[уи]\s+|дело\s+)?(.+?)\s+на\s+(сегодня|завтра|послезавтра|следующую\s+неделю|понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)$/i
  );
  if (rescheduleMatch) {
    const taskQuery = rescheduleMatch[1].trim();
    const targetWhenText = `на ${rescheduleMatch[2].trim()}`;
    const targetTask = findMatchingTask(existingTasks, taskQuery);
    if (!targetTask) {
      return {
        handled: true,
        responseText: 'Не нашла подходящую активную задачу для переноса.',
        spokenSummary: 'Не нашла активную задачу для переноса.',
      };
    }

    const { dueDate, dateLabelRu } = parseRelativeDateAndTimeFromRuText(
      targetWhenText,
      todayIso
    );
    const finalDate = dueDate || tomorrowIso;
    const updated: CompanionTaskRecord = {
      ...targetTask,
      dueDate: finalDate,
      pendingScheduleProposal: undefined,
    };

    return {
      handled: true,
      updatedTasks: [updated],
      responseText: `Перенесла задачу **«${updated.title}»** ${dateLabelRu} (**${formatSyzranIsoDateRu(finalDate)}**).`,
      spokenSummary: `Перенесла задачу ${updated.title} на ${formatSyzranIsoDateRu(finalDate)}.`,
    };
  }

  // 9. «Отложи задачу...»
  const postponeMatch = trimmed.match(
    /^(?:пиксель\s*,?\s*)?отложи\s+(?:пока\s+)?(?:задач[уи]\s+)?(.+)$/i
  );
  if (postponeMatch && postponeMatch[1]) {
    const targetTask = findMatchingTask(existingTasks, postponeMatch[1]);
    if (!targetTask) {
      return {
        handled: true,
        responseText: 'Не нашла активную задачу, которую нужно отложить.',
        spokenSummary: 'Не нашла задачу для откладывания.',
      };
    }

    const updated: CompanionTaskRecord = {
      ...targetTask,
      status: 'postponed',
      postponedAtMs: Date.now(),
    };

    return {
      handled: true,
      updatedTasks: [updated],
      responseText: `Отложила задачу **«${updated.title}»** (статус: *Отложена*). Я мягко напомню о ней позже, чтобы она не потерялась.`,
      spokenSummary: `Отложила задачу ${updated.title}.`,
    };
  }

  // 10. «Отметь выполненной...» / «Закрой задачу...»
  const completeMatch = trimmed.match(
    /^(?:пиксель\s*,?\s*)?(?:отметь\s+выполненн(?:ой|ым)|заверши\s+задачу|закрой\s+задачу|я\s+сделала|выполнено)\s*(.*)$/i
  );
  if (completeMatch) {
    const query = completeMatch[1] || '';
    const targetTask = findMatchingTask(existingTasks, query);
    if (!targetTask) {
      return {
        handled: true,
        responseText: 'Не нашла активную задачу, которую можно отметить выполненной.',
        spokenSummary: 'Не нашла активную задачу для завершения.',
      };
    }

    const nowMs = Date.now();
    const updated: CompanionTaskRecord = {
      ...targetTask,
      status: 'done',
      completedAt: syzranNow.time24,
      completedAtMs: nowMs,
      pendingScheduleProposal: undefined,
    };

    return {
      handled: true,
      updatedTasks: [updated],
      responseText: `Отметила задачу **«${updated.title}»** выполненной! Отличная работа, Анна.`,
      spokenSummary: `Задача ${updated.title} отмечена выполненной!`,
    };
  }

  // 11. «Разбей эту задачу на шаги» / «Разбей задачу ... на шаги»
  const breakdownMatch = trimmed.match(
    /^(?:пиксель\s*,?\s*)?разбей\s+(?:эту\s+)?(?:задач[уи]\s*)?(.*?)\s*на\s+(?:шаги|этапы|подзадачи)$/i
  );
  if (breakdownMatch) {
    const query = breakdownMatch[1] || '';
    const targetTask = findMatchingTask(existingTasks, query);
    if (!targetTask) {
      return {
        handled: true,
        responseText: 'Не нашла активную задачу, которую можно разбить на шаги.',
        spokenSummary: 'Не нашла активную задачу для декомпозиции.',
      };
    }

    const steps = generateTaskSteps(targetTask.title, targetTask.description);
    const updated: CompanionTaskRecord = {
      ...targetTask,
      steps,
      status: targetTask.status === 'new' ? 'in_progress' : targetTask.status,
    };

    const lines = [
      `### Разбила задачу «${updated.title}» на пошаговый план:`,
      '',
      ...steps.map((s, idx) => `${idx + 1}. ${s.title}`),
      '',
      'Шаги сохранены в карточке задачи — вы можете отмечать их по мере выполнения.',
    ];

    return {
      handled: true,
      updatedTasks: [updated],
      openTasksTabWithFilter: 'all',
      responseText: lines.join('\n'),
      spokenSummary: `Разбила задачу ${updated.title} на ${steps.length} шага и сохранила чек-лист.`,
    };
  }

  // 12. «Напомни мне об этом...» / «Напомни мне через ...» / «Напомни завтра в 10:00 ...»
  const remindMatch = trimmed.match(
    /^(?:пиксель\s*,?\s*)?напомни\s+(?:мне\s+)?(.+)$/i
  );
  if (remindMatch && remindMatch[1]) {
    const body = remindMatch[1].trim();
    const inMinutesMatch = body.match(/через\s+(\d{1,3})\s*(?:минут[уы]?|мин\b)/i);
    const inHoursMatch = body.match(/через\s+(\d{1,2})\s*(?:час(?:а|ов)?|ч\b)/i);

    let reminderAtMs = Date.now() + 30 * 60 * 1000; // default +30 min
    let reminderLabelRu = 'через 30 минут';

    if (inMinutesMatch) {
      const mins = Math.max(1, parseInt(inMinutesMatch[1], 10));
      reminderAtMs = Date.now() + mins * 60 * 1000;
      reminderLabelRu = `через ${mins} мин.`;
    } else if (inHoursMatch) {
      const hrs = Math.max(1, parseInt(inHoursMatch[1], 10));
      reminderAtMs = Date.now() + hrs * 60 * 60 * 1000;
      reminderLabelRu = `через ${hrs} ч.`;
    } else {
      const parsed = parseRelativeDateAndTimeFromRuText(body, todayIso);
      const datePart = parsed.dueDate || todayIso;
      const timePart = parsed.dueTime || '10:00';
      // Syzran is UTC+4
      const [y, m, d] = datePart.split('-').map(Number);
      const [hh, mm] = timePart.split(':').map(Number);
      reminderAtMs = Date.UTC(y, m - 1, d, hh - 4, mm, 0);
      if (reminderAtMs <= Date.now()) {
        reminderAtMs = Date.now() + 15 * 60 * 1000;
      }
      reminderLabelRu = `${formatSyzranIsoDateRu(datePart)} в ${timePart} (по Сызрани)`;
    }

    const repeat: 'none' | 'daily' | 'weekdays' | 'weekly' =
      /каждый\s+день|ежедневно/i.test(body)
        ? 'daily'
        : /по\s+будням/i.test(body)
        ? 'weekdays'
        : /каждую\s+неделю|еженедельно/i.test(body)
        ? 'weekly'
        : 'none';

    const cleanedQuery = body
      .replace(/через\s+\d+\s*(?:минут[уы]?|мин|час(?:а|ов)?|ч)\b/gi, '')
      .replace(/(?:сегодня|завтра|послезавтра)?\s*(?:в|к)\s*\d{1,2}(?::\d{2})?\s*(?:утра|дня|вечера)?/gi, '')
      .replace(/^(?:об\s+этом|о\s+том\s+чтобы|про\s+то\s+чтобы|что\s+нужно|про)\s*/i, '')
      .trim();

    if (!cleanedQuery || /^об\s+этом$/i.test(body.trim())) {
      const latestTask = findMatchingTask(existingTasks, '');
      if (latestTask) {
        const updated: CompanionTaskRecord = {
          ...latestTask,
          reminderAt: new Date(reminderAtMs).toISOString(),
          reminderRepeat: repeat,
          lastReminderFiredAtMs: undefined,
        };
        return {
          handled: true,
          updatedTasks: [updated],
          responseText: `Поставила напоминание по задаче **«${updated.title}»** — сработает **${reminderLabelRu}**.`,
          spokenSummary: `Напомню о задаче ${updated.title} ${reminderLabelRu}.`,
        };
      }
    }

    // Create a dedicated task with reminder
    const title = cleanExtractedTaskTitle(cleanedQuery) || cleanedQuery || 'Напоминание Анне';
    const evaluation = evaluateTaskPriorityMultiCriteria(title, body, todayIso, todayIso);
    const nowMs = Date.now();
    const newTask: CompanionTaskRecord = {
      id: `ctask_rem_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      description: `Напоминание (${reminderLabelRu}): «${trimmed}»`,
      dueDate: toSyzranIsoDate(new Date(reminderAtMs)),
      dueTime: getSyzranNow(new Date(reminderAtMs)).time24,
      priority: evaluation.priority,
      priorityReason: evaluation.priorityReason,
      urgencyScore: evaluation.urgencyScore,
      importanceScore: evaluation.importanceScore,
      estimatedMinutes: 15,
      status: 'new',
      schoolId: detectSchoolFromTaskText(body, activeSchool),
      sourceType: 'voice_command',
      sourceExcerpt: trimmed,
      reminderAt: new Date(reminderAtMs).toISOString(),
      reminderRepeat: repeat,
      createdAt: syzranNow.time24,
      createdAtMs: nowMs,
    };

    return {
      handled: true,
      createdTask: newTask,
      openTasksTabWithFilter: 'today',
      responseText: `Записала напоминание **«${newTask.title}»** на **${reminderLabelRu}**${repeat !== 'none' ? ' (повторяющееся)' : ''}.\n\n*Примечание:* напоминание сработает в активном или свёрнутом окне браузера/приложения, а если приложение будет полностью закрыто — я сразу покажу пропущенное напоминание при следующем запуске.`,
      spokenSummary: `Записала напоминание: ${newTask.title}, ${reminderLabelRu}.`,
    };
  }

  return null;
}

/**
 * Checks due reminders, approaching deadlines, overdue tasks, postponed tasks,
 * and unanswered specialist delegations.
 */
export function checkDueTaskAndDelegationReminders(
  tasks: CompanionTaskRecord[],
  delegatedTasks: PixelDelegatedTaskState[],
  nowMs: number = Date.now()
): DueReminderAlert[] {
  const alerts: DueReminderAlert[] = [];
  const syzranNow = getSyzranNow(new Date(nowMs));
  const todayIso = syzranNow.isoDate;

  for (const task of tasks) {
    if (task.status === 'done') continue;

    // 1. Explicit reminderAt check
    if (task.reminderAt) {
      const reminderMs = new Date(task.reminderAt).getTime();
      if (
        !Number.isNaN(reminderMs) &&
        nowMs >= reminderMs &&
        (!task.lastReminderFiredAtMs || task.lastReminderFiredAtMs < reminderMs)
      ) {
        let nextReminderIso: string | undefined = undefined;
        if (task.reminderRepeat === 'daily') {
          nextReminderIso = new Date(reminderMs + 24 * 60 * 60 * 1000).toISOString();
        } else if (task.reminderRepeat === 'weekly') {
          nextReminderIso = new Date(reminderMs + 7 * 24 * 60 * 60 * 1000).toISOString();
        } else if (task.reminderRepeat === 'weekdays') {
          let nextMs = reminderMs + 24 * 60 * 60 * 1000;
          const dow = new Date(nextMs).getDay();
          if (dow === 6) nextMs += 2 * 24 * 60 * 60 * 1000;
          if (dow === 0) nextMs += 1 * 24 * 60 * 60 * 1000;
          nextReminderIso = new Date(nextMs).toISOString();
        }

        alerts.push({
          id: `rem_${task.id}_${nowMs}`,
          type: 'task_reminder',
          title: `Напоминание: ${task.title}`,
          message: `Анна, напоминаю о задаче **«${task.title}»** (${syzranNow.time24} по Сызрани).`,
          taskId: task.id,
          updatedTaskPatch: {
            lastReminderFiredAtMs: nowMs,
            reminderAt: nextReminderIso,
          },
        });
        continue;
      }
    }

    // 2. Approaching deadline today with dueTime within 45 minutes
    if (task.dueDate === todayIso && task.dueTime && !task.deadlineWarningFired) {
      const [hh, mm] = task.dueTime.split(':').map(Number);
      const dueMinutesTotal = hh * 60 + mm;
      const nowMinutesTotal = syzranNow.hour * 60 + syzranNow.minute;
      const diff = dueMinutesTotal - nowMinutesTotal;
      if (diff >= 0 && diff <= 45) {
        alerts.push({
          id: `deadline_${task.id}_${nowMs}`,
          type: 'approaching_deadline',
          title: `Приближается дедлайн (${task.dueTime})`,
          message: `Через ${diff} мин. (${task.dueTime}) срок задачи **«${task.title}»**.`,
          taskId: task.id,
          updatedTaskPatch: {
            deadlineWarningFired: true,
          },
        });
        continue;
      }
    }

    // 3. Overdue task notification (once per task)
    if (task.dueDate && task.dueDate < todayIso && !task.overdueWarningFired) {
      alerts.push({
        id: `overdue_${task.id}_${nowMs}`,
        type: 'overdue_task',
        title: `Просрочена задача: ${task.title}`,
        message: `Задача **«${task.title}»** была запланирована на ${formatSyzranIsoDateRu(task.dueDate)}. Перенести её на сегодня или завтра?`,
        taskId: task.id,
        updatedTaskPatch: {
          overdueWarningFired: true,
        },
      });
      continue;
    }

    // 4. Postponed task gentle reminder (if postponed > 4 hours ago)
    if (
      task.status === 'postponed' &&
      task.postponedAtMs &&
      nowMs - task.postponedAtMs > 4 * 60 * 60 * 1000 &&
      (!task.lastReminderFiredAtMs || nowMs - task.lastReminderFiredAtMs > 4 * 60 * 60 * 1000)
    ) {
      alerts.push({
        id: `postponed_${task.id}_${nowMs}`,
        type: 'postponed_task',
        title: `Отложенная задача: ${task.title}`,
        message: `Вы ранее отложили задачу **«${task.title}»**. Вернём её в работу или перенесём на завтра?`,
        taskId: task.id,
        updatedTaskPatch: {
          lastReminderFiredAtMs: nowMs,
        },
      });
    }
  }

  // 5. Unanswered specialist delegations (> 3 minutes in 'sent' or 'in_progress')
  for (const dTask of delegatedTasks) {
    if (
      (dTask.status === 'sent' || dTask.status === 'in_progress' || dTask.status === 'processing') &&
      nowMs - dTask.updatedAtMs > 3 * 60 * 1000
    ) {
      alerts.push({
        id: `deleg_wait_${dTask.taskId}`,
        type: 'unanswered_delegation',
        title: 'Ожидание ответа специалиста',
        message: `Поручение **«${dTask.instruction.slice(0, 60)}»** ожидает завершения ответа специалиста.`,
        delegationTaskId: dTask.taskId,
      });
    }
  }

  return alerts;
}
