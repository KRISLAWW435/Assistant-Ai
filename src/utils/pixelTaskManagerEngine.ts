import {
  AgentMode,
  CompanionTaskPriority,
  CompanionTaskRecord,
  CompanionTaskStep,
  CompanionTaskStatus,
  PixelDelegatedTaskState,
  PixelPendingPersonalTaskDraft,
  PersonalTaskDraftStep,
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
  personalTaskDraft?: PixelPendingPersonalTaskDraft;
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
  /(?:поручи|передай|делегируй|отправь|попроси|скажи|напиши|дай\s+задани[ея]|поставь\s+задачу|пусть|спроси\s+у)\s+.*?(?:маркетолог|менеджер|методист|аналитик|дизайнер)/i;

const HYPOTHETICAL_OR_QUOTE_PATTERN =
  /(?:допустим|предположим|представь\s+себе|если\s+бы|в\s+качестве\s+примера|цитирую|он\s+сказал|она\s+сказала|клиент\s+написал|родитель\s+спросил)/i;

export function hasExplicitReminderRequest(text: string): boolean {
  return /(?:напомн[иить]|предупред[иить]|с\s+напоминанием|поставить\s+напоминание|включи\s+напоминание)/i.test(
    text
  );
}

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
  } else if (/(отчет|отчёт|аналитик|статистик|бюджет|контент-план|реклам|кампани|методич|программ|мероприят|мастер-класс)/i.test(combined)) {
    importanceScore = Math.max(importanceScore, 7);
    consequencesIfDelayed =
      'Задержка управленческого контроля или подготовки мероприятия филиала';
    reasons.push('важно для управления и мероприятий филиала');
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
  } else if (/(составить|подготовить|подготовиться|разработать|проанализировать|провести|мероприят|отчёт|отчет|презентац|план)/i.test(combined)) {
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

export function buildSyzranReminderIso(
  dueDate: string,
  dueTime?: string
): string | undefined {
  if (!dueDate || !dueTime) return undefined;
  const dateParts = dueDate.split('-').map(Number);
  const timeParts = dueTime.split(':').map(Number);
  if (
    dateParts.length !== 3 ||
    timeParts.length < 2 ||
    dateParts.some((n) => Number.isNaN(n)) ||
    timeParts.some((n) => Number.isNaN(n))
  ) {
    return undefined;
  }
  const [y, m, d] = dateParts;
  const [hh, mm] = timeParts;
  // Europe/Samara is UTC+4
  const utcMs = Date.UTC(y, m - 1, d, hh - 4, mm, 0);
  if (Number.isNaN(utcMs)) return undefined;
  return new Date(utcMs).toISOString();
}

const RUSSIAN_MONTHS: Record<number, { name: string; genitive: string }> = {
  1: { name: 'январь', genitive: 'января' },
  2: { name: 'февраль', genitive: 'февраля' },
  3: { name: 'март', genitive: 'марта' },
  4: { name: 'апрель', genitive: 'апреля' },
  5: { name: 'май', genitive: 'мая' },
  6: { name: 'июнь', genitive: 'июня' },
  7: { name: 'июль', genitive: 'июля' },
  8: { name: 'август', genitive: 'августа' },
  9: { name: 'сентябрь', genitive: 'сентября' },
  10: { name: 'октябрь', genitive: 'октября' },
  11: { name: 'ноябрь', genitive: 'ноября' },
  12: { name: 'декабрь', genitive: 'декабря' },
};

function parseRussianMonthNumber(monthStr: string): number | null {
  const m = monthStr.trim().toLowerCase();
  if (m.startsWith('янв')) return 1;
  if (m.startsWith('фев')) return 2;
  if (m.startsWith('мар')) return 3;
  if (m.startsWith('апр')) return 4;
  if (m.startsWith('ма')) return 5;
  if (m.startsWith('июн')) return 6;
  if (m.startsWith('июл')) return 7;
  if (m.startsWith('авг')) return 8;
  if (m.startsWith('сен')) return 9;
  if (m.startsWith('окт')) return 10;
  if (m.startsWith('ноя')) return 11;
  if (m.startsWith('дек')) return 12;
  return null;
}

interface ExtractedDateCandidate {
  isoDate: string;
  labelRu: string;
  nameRu?: string;
  explicitYear?: number;
  isPastWithoutYear?: boolean;
  isInvalidDay?: boolean;
  invalidReason?: string;
  isVagueWeek?: boolean;
}

export function parseRelativeDateAndTimeFromRuText(
  text: string,
  todayIso: string = toSyzranIsoDate()
): {
  dueDate: string;
  dueTime?: string;
  dateLabelRu: string;
  isDateAmbiguous?: boolean;
  ambiguityPromptRu?: string;
} {
  const lower = text.toLowerCase();

  let dueTime: string | undefined;
  let isTimeAmbiguous = false;
  const timeWithColonMatch = lower.match(
    /(?:^|[^а-яёa-z0-9])(?:(?:в|во|к|на|до)\s+)?(\d{1,2}):(\d{2})(?:\s*(час(?:а|ов)?|ч(?=$|[^а-яёa-z0-9])|утра|дня|вечера|ночи))?(?=$|[^а-яёa-z0-9])/i
  );
  const timeWithDotMatch = lower.match(
    /(?:^|[^а-яёa-z0-9])(?:в|во|к|на|до)\s+(\d{1,2})\.(\d{2})(?:\s*(час(?:а|ов)?|ч(?=$|[^а-яёa-z0-9])|утра|дня|вечера|ночи))?(?=$|[^а-яёa-z0-9])/i
  );
  const timeWordMatch = lower.match(
    /(?:^|[^а-яёa-z0-9])(?:в|во|к|на|до)\s*(\d{1,2})\s*(час(?:а|ов)?|ч(?=$|[^а-яёa-z0-9])|утра|дня|вечера|ночи)(?=$|[^а-яёa-z0-9])/i
  );

  if (timeWithColonMatch) {
    let hour = parseInt(timeWithColonMatch[1], 10);
    const minute = parseInt(timeWithColonMatch[2], 10);
    const period = (timeWithColonMatch[3] || '').toLowerCase();
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      if ((period === 'дня' || period === 'вечера') && hour < 12) {
        hour += 12;
      }
      dueTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  } else if (timeWithDotMatch) {
    let hour = parseInt(timeWithDotMatch[1], 10);
    const minute = parseInt(timeWithDotMatch[2], 10);
    const period = (timeWithDotMatch[3] || '').toLowerCase();
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      if ((period === 'дня' || period === 'вечера') && hour < 12) {
        hour += 12;
      }
      dueTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  } else if (timeWordMatch) {
    let hour = parseInt(timeWordMatch[1], 10);
    const minute = 0;
    const period = (timeWordMatch[2] || '').toLowerCase();
    if (hour >= 0 && hour <= 23) {
      if ((period === 'дня' || period === 'вечера') && hour < 12) {
        hour += 12;
      } else if (!period.startsWith('утр') && hour >= 1 && hour <= 6) {
        hour += 12;
        isTimeAmbiguous = true;
      }
      dueTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  // 1. Explicit unknown date markers («на неизвестную дату», «не знаю когда», «на какую-то дату»)
  if (
    /(?:^|[^а-яёa-z0-9])(?:на\s+)?(?:неизвестн[а-яё0-9]*\s+дат[а-яё0-9]*|непонятн[а-яё0-9]*\s+дат[а-яё0-9]*|какую-то\s+дат[а-яё0-9]*|какой-то\s+день|не\s+знаю\s+какого\s+числа|не\s+знаю\s+когда)(?=$|[^а-яёa-z0-9])/i.test(
      lower
    )
  ) {
    return {
      dueDate: '',
      dueTime,
      dateLabelRu: 'дата требует уточнения',
      isDateAmbiguous: true,
      ambiguityPromptRu:
        'Дата указана как неизвестная. Уточните, пожалуйста, конкретный день и время для задачи.',
    };
  }

  // 2. Explicit ambiguous combinations with «или» and vague timeframes
  if (
    /(?:^|[^а-яёa-z0-9])(?:на\s+днях|через\s+пару\s+дней|через\s+несколько\s+дней|в\s+ближайшее\s+время|скоро|в\s+первой\s+половине\s+недели|в\s+конце\s+недели|(?:завтра|сегодня|понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)\s+или\s+(?:завтра|послезавтра|понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье))(?=$|[^а-яёa-z0-9])/i.test(
      lower
    )
  ) {
    return {
      dueDate: '',
      dueTime,
      dateLabelRu: 'дата требует уточнения',
      isDateAmbiguous: true,
      ambiguityPromptRu:
        'Дата указана неоднозначно. Уточните, пожалуйста, точный день и время (например: «Перенеси задачу на среду в 15:00» или «на завтра в 12:00»).',
    };
  }

  // 3. Dateless markers («когда-нибудь», «без срока», «при случае»)
  if (
    /(?:^|[^а-яёa-z0-9])(?:когда-нибудь|без\s+срока|не\s+к\s+спеху|на\s+будущее|в\s+долгий\s+ящик)(?=$|[^а-яёa-z0-9])/i.test(
      lower
    )
  ) {
    return { dueDate: '', dueTime, dateLabelRu: 'без жёсткого срока' };
  }

  const [yStr, mStr, dStr] = todayIso.split('-');
  const currentYear = parseInt(yStr, 10);
  const currentDow = new Date(
    Date.UTC(parseInt(yStr, 10), parseInt(mStr, 10) - 1, parseInt(dStr, 10), 12, 0, 0)
  ).getUTCDay();

  const candidates: ExtractedDateCandidate[] = [];

  // 4. Textual dates with Russian month names («4 ноября», «15 декабря», «1 мая», «4 ноября 2027 года»)
  const textualMonthRegex =
    /(?:^|[^а-яёa-z0-9])(?:(?:на|к|до|в|во)\s+)?(\d{1,2})(?:-(?:е|го|ое|ье|ья|м))?\s+(январ[яеью]?|феврал[яеью]?|март[аеу]?|апрел[яеью]?|ма[яеюйо]|июн[яеью]?|июл[яеью]?|август[аеу]?|сентябр[яеью]?|октябр[яеью]?|ноябр[яеью]?|декабр[яеью]?)(?:\s+(20\d{2})(?:\s*года|\s*г\.?|\s*г)?|\s+(?:года|г\.?|г))?(?=$|[^а-яёa-z0-9])/gi;

  let monthMatch: RegExpExecArray | null;
  while ((monthMatch = textualMonthRegex.exec(lower)) !== null) {
    const dayNum = parseInt(monthMatch[1], 10);
    const monthNum = parseRussianMonthNumber(monthMatch[2]);
    if (!monthNum) continue;
    const explicitYear = monthMatch[3] ? parseInt(monthMatch[3], 10) : undefined;
    const targetYear = explicitYear || currentYear;
    const maxDays = new Date(targetYear, monthNum, 0).getDate();
    const monthInfo = RUSSIAN_MONTHS[monthNum];
    const monthGenitive = monthInfo?.genitive || monthMatch[2];

    if (dayNum < 1 || dayNum > maxDays) {
      candidates.push({
        isoDate: '',
        labelRu: `${dayNum} ${monthGenitive}`,
        nameRu: `${dayNum} ${monthGenitive}`,
        isInvalidDay: true,
        invalidReason: `Дата указана некорректно: в месяце ${monthInfo?.name || monthMatch[2]} не может быть ${dayNum} дней (максимум ${maxDays}). Уточните, пожалуйста, правильную дату.`,
      });
      continue;
    }

    const iso = `${targetYear}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const label = explicitYear
      ? `на ${dayNum} ${monthGenitive} ${explicitYear} г.`
      : `на ${dayNum} ${monthGenitive}`;

    if (!explicitYear && iso < todayIso) {
      candidates.push({
        isoDate: iso,
        labelRu: label,
        nameRu: `${dayNum} ${monthGenitive}`,
        isPastWithoutYear: true,
        invalidReason: `${dayNum} ${monthGenitive} текущего года (${currentYear} г.) уже прошло. Уточните, пожалуйста, имелась ли в виду эта дата в следующем году или другой день.`,
      });
    } else {
      candidates.push({
        isoDate: iso,
        labelRu: label,
        nameRu: label.replace(/^на\s+/, ''),
        explicitYear,
      });
    }
  }

  // 5. Numeric dates (DD.MM.YYYY, DD.MM) with Cyrillic boundaries
  const numericDateRegex =
    /(?:^|[^а-яёa-z0-9])(?:(?:на|к|до|в|во)\s+)?(\d{1,2})\.(\d{1,2})(?:\.(20\d{2}))?(?=$|[^а-яёa-z0-9])/gi;

  let numMatch: RegExpExecArray | null;
  while ((numMatch = numericDateRegex.exec(lower)) !== null) {
    const dayNum = parseInt(numMatch[1], 10);
    const monthNum = parseInt(numMatch[2], 10);
    const explicitYear = numMatch[3] ? parseInt(numMatch[3], 10) : undefined;
    const targetYear = explicitYear || currentYear;
    if (monthNum < 1 || monthNum > 12) continue;
    const maxDays = new Date(targetYear, monthNum, 0).getDate();
    if (dayNum < 1 || dayNum > maxDays) {
      candidates.push({
        isoDate: '',
        labelRu: `${dayNum}.${monthNum}`,
        nameRu: `${dayNum}.${monthNum}`,
        isInvalidDay: true,
        invalidReason: `Дата указана некорректно: ${dayNum}.${monthNum}. Уточните, пожалуйста, правильную дату.`,
      });
      continue;
    }
    const iso = `${targetYear}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const label = `на ${formatSyzranIsoDateRu(iso)}`;
    if (!explicitYear && iso < todayIso) {
      candidates.push({
        isoDate: iso,
        labelRu: label,
        nameRu: `${dayNum}.${String(monthNum).padStart(2, '0')}`,
        isPastWithoutYear: true,
        invalidReason: `${dayNum}.${String(monthNum).padStart(2, '0')} текущего года уже прошло. Уточните, пожалуйста, имелся ли в виду следующий год или другой день.`,
      });
    } else {
      candidates.push({
        isoDate: iso,
        labelRu: label,
        nameRu: label.replace(/^на\s+/, ''),
        explicitYear,
      });
    }
  }

  // 6. Explicit ISO match (YYYY-MM-DD)
  const explicitIsoMatch = lower.match(/(?:^|[^а-яёa-z0-9])(20\d{2}-\d{2}-\d{2})(?=$|[^а-яёa-z0-9])/);
  if (explicitIsoMatch) {
    const iso = explicitIsoMatch[1];
    candidates.push({
      isoDate: iso,
      labelRu: `на ${formatSyzranIsoDateRu(iso)}`,
      nameRu: iso,
    });
  }

  // 7. Relative day keywords
  if (/(?:^|[^а-яёa-z0-9])(?:на\s+)?послезавтра(?=$|[^а-яёa-z0-9])/i.test(lower)) {
    const iso = addDaysToIsoDate(todayIso, 2);
    candidates.push({
      isoDate: iso,
      labelRu: 'на послезавтра',
      nameRu: 'послезавтра',
    });
  }

  if (/(?:^|[^а-яёa-z0-9])(?:на\s+)?(?<!после)завтра(?=$|[^а-яёa-z0-9])/i.test(lower)) {
    const iso = addDaysToIsoDate(todayIso, 1);
    candidates.push({
      isoDate: iso,
      labelRu: 'на завтра',
      nameRu: 'завтра',
    });
  }

  if (/(?:^|[^а-яёa-z0-9])(?:(?:на|до)\s+)?(?:сегодня|до\s+вечера|до\s+обеда)(?=$|[^а-яёa-z0-9])/i.test(lower)) {
    if (!dueTime && lower.includes('до обеда')) dueTime = '13:00';
    if (!dueTime && lower.includes('до вечера')) dueTime = '18:00';
    candidates.push({
      isoDate: todayIso,
      labelRu: 'на сегодня',
      nameRu: 'сегодня',
    });
  }

  const inDaysMatch = lower.match(/(?:^|[^а-яёa-z0-9])через\s+(\d{1,2})\s+дн[а-яё]*(?=$|[^а-яёa-z0-9])/i);
  if (inDaysMatch) {
    const days = parseInt(inDaysMatch[1], 10);
    const iso = addDaysToIsoDate(todayIso, days);
    candidates.push({
      isoDate: iso,
      labelRu: `на ${formatSyzranIsoDateRu(iso)}`,
      nameRu: `через ${days} дн.`,
    });
  }

  // 8. Days of the week with Cyrillic boundaries
  const weekdays: Array<{ pattern: RegExp; targetDow: number; label: string; nameRu: string }> = [
    {
      pattern: /(?:^|[^а-яёa-z0-9])(?:(?:в|во|на|к|до)\s+)?(?:понедельник|понедельника|понедельнику)(?=$|[^а-яёa-z0-9])/i,
      targetDow: 1,
      label: 'на понедельник',
      nameRu: 'понедельник',
    },
    {
      pattern: /(?:^|[^а-яёa-z0-9])(?:(?:в|во|на|к|до)\s+)?(?:вторник|вторника|вторнику)(?=$|[^а-яёa-z0-9])/i,
      targetDow: 2,
      label: 'на вторник',
      nameRu: 'вторник',
    },
    {
      pattern: /(?:^|[^а-яёa-z0-9])(?:(?:в|во|на|к|до)\s+)?(?:среду|среды|среде|среда)(?=$|[^а-яёa-z0-9])/i,
      targetDow: 3,
      label: 'на среду',
      nameRu: 'на среду',
    },
    {
      pattern: /(?:^|[^а-яёa-z0-9])(?:(?:в|во|на|к|до)\s+)?(?:четверг|четверга|четвергу)(?=$|[^а-яёa-z0-9])/i,
      targetDow: 4,
      label: 'на четверг',
      nameRu: 'четверг',
    },
    {
      pattern: /(?:^|[^а-яёa-z0-9])(?:(?:в|во|на|к|до)\s+)?(?:пятницу|пятницы|пятнице|пятница)(?=$|[^а-яёa-z0-9])/i,
      targetDow: 5,
      label: 'на пятницу',
      nameRu: 'пятницу',
    },
    {
      pattern: /(?:^|[^а-яёa-z0-9])(?:(?:в|во|на|к|до)\s+)?(?:субботу|субботы|субботе|суббота)(?=$|[^а-яёa-z0-9])/i,
      targetDow: 6,
      label: 'на субботу',
      nameRu: 'субботу',
    },
    {
      pattern: /(?:^|[^а-яёa-z0-9])(?:(?:в|во|на|к|до)\s+)?(?:воскресенье|воскресенья|воскресенью)(?=$|[^а-яёa-z0-9])/i,
      targetDow: 0,
      label: 'на воскресенье',
      nameRu: 'воскресенье',
    },
  ];

  for (const wd of weekdays) {
    if (wd.pattern.test(lower)) {
      let delta = (wd.targetDow - currentDow + 7) % 7;
      if (delta === 0) delta = 7;
      const targetIso = addDaysToIsoDate(todayIso, delta);
      candidates.push({
        isoDate: targetIso,
        labelRu: `${wd.label} (${formatSyzranIsoDateRu(targetIso)})`,
        nameRu: wd.nameRu,
      });
    }
  }

  // 9. Vague week indicator
  if (/(?:^|[^а-яёa-z0-9])(?:на\s+следующей\s+неделе|через\s+неделю)(?=$|[^а-яёa-z0-9])/i.test(lower)) {
    const targetIso = addDaysToIsoDate(todayIso, 7);
    candidates.push({
      isoDate: targetIso,
      labelRu: `на ${formatSyzranIsoDateRu(targetIso)}`,
      nameRu: 'на следующей неделе',
      isVagueWeek: true,
    });
  }

  // Check 1: Invalid day in month (e.g. «На 35 ноября»)
  const invalidCandidate = candidates.find((c) => c.isInvalidDay);
  if (invalidCandidate) {
    return {
      dueDate: '',
      dueTime,
      dateLabelRu: 'дата требует уточнения',
      isDateAmbiguous: true,
      ambiguityPromptRu:
        invalidCandidate.invalidReason ||
        'Дата указана некорректно. Уточните, пожалуйста, правильную дату.',
    };
  }

  // Check 2: Date without year that has already passed in Europe/Samara (e.g. «Запланируй на 1 мая»)
  const pastCandidate = candidates.find((c) => c.isPastWithoutYear);
  if (pastCandidate) {
    return {
      dueDate: '',
      dueTime,
      dateLabelRu: 'дата требует уточнения',
      isDateAmbiguous: true,
      ambiguityPromptRu:
        pastCandidate.invalidReason ||
        'Указанная дата текущего года уже прошла. Уточните, пожалуйста, имелся ли в виду следующий год или другой день.',
    };
  }

  // Check 3: Multiple non-matching dates in the same request (e.g. «На сегодня, на среду»)
  const validCandidates = candidates.filter((c) => Boolean(c.isoDate));
  const uniqueIsoDates = Array.from(new Set(validCandidates.map((c) => c.isoDate)));
  if (uniqueIsoDates.length > 1) {
    const names = Array.from(new Set(validCandidates.map((c) => c.nameRu || c.labelRu)));
    return {
      dueDate: '',
      dueTime,
      dateLabelRu: 'дата требует уточнения',
      isDateAmbiguous: true,
      ambiguityPromptRu: `В запросе указано несколько разных дат: ${names.join(' и ')}. Уточните, пожалуйста, на какую именно дату поставить задачу.`,
    };
  }

  // Check 4: Exactly one unique date matched
  if (uniqueIsoDates.length === 1) {
    const candidate = validCandidates[0];
    if (candidate.isVagueWeek) {
      return {
        dueDate: candidate.isoDate,
        dueTime,
        dateLabelRu: candidate.labelRu,
        isDateAmbiguous: true,
        ambiguityPromptRu:
          'Вы указали «на следующей неделе» без конкретного дня недели — я предварительно поставила дату через 7 дней. Уточните, пожалуйста, на какой именно день недели назначить задачу.',
      };
    }
    return {
      dueDate: candidate.isoDate,
      dueTime,
      dateLabelRu: candidate.labelRu,
      isDateAmbiguous: isTimeAmbiguous,
      ambiguityPromptRu: isTimeAmbiguous
        ? `Я поставила время ${dueTime} (день). Если имелось в виду утро, уточните, пожалуйста.`
        : undefined,
    };
  }

  // Check 5: Time specified without any recognized date -> DO NOT silently default to todayIso!
  if (dueTime) {
    return {
      dueDate: '',
      dueTime,
      dateLabelRu: 'дата требует уточнения',
      isDateAmbiguous: true,
      ambiguityPromptRu: `Указано время ${dueTime}, но не указана дата. Уточните, пожалуйста, на какой день запланировать задачу (на сегодня, завтра или конкретную дату).`,
    };
  }

  // Check 6: Unrecognized date attempt with date-related preposition
  if (
    /(?:^|[^а-яёa-z0-9])(?:на|к|до)\s+(?:число|дату|срок)(?=$|[^а-яёa-z0-9])/i.test(lower)
  ) {
    return {
      dueDate: '',
      dueTime,
      dateLabelRu: 'дата требует уточнения',
      isDateAmbiguous: true,
      ambiguityPromptRu:
        'Дата задачи не распознана. Уточните, пожалуйста, число и месяц для задачи.',
    };
  }

  return { dueDate: '', dueTime, dateLabelRu: 'без даты' };
}

export function cleanExtractedTaskTitle(raw: string): string {
  let cleaned = raw
    .trim()
    .replace(/^[«"„“]+|[»"”“.!?;]+$/g, '')
    .replace(/^(?:пиксель\s*,?\s*)?/i, '')
    .replace(
      /^(?:пожалуйста\s*,?\s*)?(?:добавь|создай|запиши|поставь|зафиксируй|внеси|запланируй)\s*(?:,\s*пожалуйста\s*,?|\s+пожалуйста\s*,?)?\s*(?:мне\s+)?(?:в\s+список\s+дел\s+|в\s+задачи\s+|задач[уи]\s+|дело\s*)?[:—-]?\s*/i,
      ''
    )
    // Remove textual dates with Russian months anywhere in the text
    .replace(
      /(?:^|[^а-яёa-z0-9])(?:(?:в|во|на|к|до)\s+)?\d{1,2}(?:-(?:е|го|ое|ье|ья|м))?\s+(?:январ[яеью]?|феврал[яеью]?|март[аеу]?|апрел[яеью]?|ма[яеюйо]|июн[яеью]?|июл[яеью]?|август[аеу]?|сентябр[яеью]?|октябр[яеью]?|ноябр[яеью]?|декабр[яеью]?)(?:\s+\d{4}(?:\s*года|\s*г\.?|\s*г)?)?(?=$|[^а-яёa-z0-9])/gi,
      ' '
    )
    // Remove numeric dates: "04.11.2026", "04.11", "2026-11-04"
    .replace(
      /(?:^|[^а-яёa-z0-9])(?:(?:в|во|на|к|до)\s+)?(?:\d{1,2}\.\d{1,2}(?:\.\d{2,4})?|\d{4}-\d{2}-\d{2})(?=$|[^а-яёa-z0-9])/gi,
      ' '
    )
    // Remove weekday/relative date tokens anywhere in the text
    .replace(
      /(?:^|[^а-яёa-z0-9])(?:(?:в|во|на|к|до)\s+)?(?:понедельник|понедельника|понедельнику|вторник|вторника|вторнику|среду|среды|среде|среда|четверг|четверга|четвергу|пятницу|пятницы|пятнице|пятница|субботу|субботы|субботе|суббота|воскресенье|воскресенья|воскресенью|сегодня|завтра|послезавтра|когда-нибудь|на\s+следующей\s+неделе|через\s+\d{1,2}\s+дн[а-яё]*|на\s+днях|через\s+пару\s+дней|через\s+несколько\s+дней|до\s+вечера|до\s+обеда|неизвестн\w*\s+дат\w*)(?=$|[^а-яёa-z0-9])/gi,
      ' '
    )
    // Remove time tokens like "в 15:00", "на 15:00", "15:00", "в 15 часов"
    .replace(
      /(?:^|[^а-яёa-z0-9])(?:(?:в|во|к|на|до)\s+)?\d{1,2}:\d{2}(?:\s*(?:час(?:а|ов)?|ч|утра|дня|вечера|ночи))?(?=$|[^а-яёa-z0-9])/gi,
      ' '
    )
    .replace(
      /(?:^|[^а-яёa-z0-9])(?:в|во|к|на|до)\s*\d{1,2}(?:\.\d{2})?\s*(?:час(?:а|ов)?|ч(?=$|[^а-яёa-z0-9])|утра|дня|вечера|ночи)?(?=$|[^а-яёa-z0-9])/gi,
      ' '
    )
    // Remove priority tokens from title if present
    .replace(
      /(?:^|[^а-яёa-z0-9])(?:с\s+)?(?:высоким|средним|обычным|низким)\s+приоритетом(?=$|[^а-яёa-z0-9])/gi,
      ' '
    )
    .replace(
      /(?:^|[^а-яёa-z0-9])(?:приоритет\s*(?:обычный|средний|высокий|низкий))(?=$|[^а-яёa-z0-9])/gi,
      ' '
    )
    // Remove reminder clauses from title if present
    .replace(
      /(?:^|[^а-яёa-z0-9])(?:напомни(?:ть)?\s+.*|без\s+напоминания|с\s+напоминанием\s+.*)(?=$|[^а-яёa-z0-9])/gi,
      ' '
    )
    // Remove leftover leading "задачу / дело" if date stood before it
    .replace(/^[\s.,!?;:—–\-]*(?:в\s+список\s+дел|в\s+задачи|задач[уи]|дело)(?=\s|$|[.,!?;:])/i, '')
    // Strip leading punctuation and conversational obligation/filler prefixes («Чтобы мне, например, ...», «Мне нужно ...»)
    .replace(/^[\s.,!?;:—–\-]+/, '')
    .replace(
      /^(?:чтобы\s+)?(?:мне\s*,?\s*)?(?:например\s*,?\s*)?(?:мне\s*,?\s*)?(?:нужно\s+не\s+забыть|надо\s+не\s+забыть|не\s+забыть(?:\s+бы)?|нужно|надо|необходимо|предстоит|стоит|планирую|хочу\s+не\s+забыть|важно)?\s*(?:будет\s+)?(?:,\s*например\s*,?|\s+например\s*,?)?\s*[:—-]?\s*/i,
      ''
    )
    // Also strip inline filler ", например," or "например,"
    .replace(/(?:^|\s),?\s*например\s*,?(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,:;—–\-.!?\s]+|[,:;—–\-.!?\s]+$/g, '')
    .trim();

  // Merge follow-up sentence «... к мероприятию. Это будет мафия в школе» -> «... к мероприятию „Мафия“ в школе»
  const eventFollowUpMatch = cleaned.match(
    /^(.+?\bмероприяти[юяе])\s*[.!;—–-]+\s*это\s+(?:будет\s+|у\s+нас\s+)?([а-яёa-z0-9«»"„“\-]+)(?:\s+(.+))?$/i
  );
  if (eventFollowUpMatch) {
    const basePart = eventFollowUpMatch[1].trim();
    const rawEventName = eventFollowUpMatch[2]
      .replace(/^[«"„“]+|[»"”"]+$/g, '')
      .trim();
    const formattedEventName = rawEventName
      ? `„${rawEventName.charAt(0).toUpperCase()}${rawEventName.slice(1)}“`
      : '';
    const tailPart = (eventFollowUpMatch[3] || '').trim();
    cleaned = [basePart, formattedEventName, tailPart].filter(Boolean).join(' ');
  } else {
    // General follow-up «<action>. Это будет <detail>» -> «<action> (<detail>)»
    const genericFollowUpMatch = cleaned.match(
      /^(.+?)\s*[.!;]+\s*это\s+(?:будет\s+|у\s+нас\s+)?(.+)$/i
    );
    if (genericFollowUpMatch) {
      cleaned = `${genericFollowUpMatch[1].trim()} (${genericFollowUpMatch[2].trim()})`;
    }
  }

  cleaned = cleaned
    .replace(/\s+/g, ' ')
    .replace(/^[,:;—–\-.!?\s]+|[,:;—–\-.!?\s]+$/g, '')
    .trim();

  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Automatically extracts a personal task for Anna from normal conversational statements:
 * e.g. «Завтра нужно написать родителям о переносе занятия»
 * or «Мне нужно когда-нибудь обновить презентацию»
 * or «В среду провести мероприятие по Мафии в 15:00»
 * or «Мне нужно в среду подготовиться к мероприятию Мафия»
 */
export function extractAutoTaskFromConversation(
  userText: string,
  activeSchool: SchoolId,
  existingTasks: CompanionTaskRecord[],
  sourceMessageId?: string
): AutoExtractedTaskResult | null {
  const trimmed = userText.trim();
  if (trimmed.length < 8 || trimmed.length > 360) return null;
  if (trimmed.includes('?')) return null;
  if (SPECIALIST_DELEGATION_PATTERN.test(trimmed)) return null;
  if (HYPOTHETICAL_OR_QUOTE_PATTERN.test(trimmed)) return null;

  // Match personal obligation statements or weekday+time+infinitive statements by Anna
  const obligationPatterns = [
    /^(?:мне\s+)?(?:сегодня|завтра|послезавтра|(?:в|во|на)\s+[а-яё]+|на\s+следующей\s+неделе)\s+(?:мне\s+)?(?:нужно\s+не\s+забыть|надо\s+не\s+забыть|не\s+забыть|нужно|надо|необходимо|предстоит|важно)\s+(?:будет\s+)?([\s\S]{4,240})$/i,
    /^(?:мне\s+)?(?:нужно\s+не\s+забыть|надо\s+не\s+забыть|не\s+забыть(?:\s+бы)?|нужно|надо|необходимо|предстоит|важно|хочу\s+не\s+забыть)\s+(?:будет\s+)?(?:(?:сегодня|завтра|послезавтра|когда-нибудь|до\s+вечера|до\s+обеда|(?:в|во|на)\s+[а-яё]+)\s+)?([\s\S]{4,240})$/i,
    /^(?:(?:в|во|на)\s+(?:понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)|сегодня|завтра|послезавтра)\s+(?:(?:в|к)\s*\d{1,2}(?:[:.]\d{2})?\s*)?((?:провести|сделать|написать|позвонить|подготовить|подготовиться|отправить|проверить|собрать|обновить|согласовать|встретиться|запустить|оплатить|выгрузить|составить|организовать|напомнить|заказать|купить|передать|разработать)(?=\s|$|[.,!?;:])[\s\S]{3,240})$/i,
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

  const title = cleanExtractedTaskTitle(matchedRawAction) || cleanExtractedTaskTitle(trimmed);
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
  const { dueDate, dueTime, dateLabelRu, isDateAmbiguous, ambiguityPromptRu } =
    parseRelativeDateAndTimeFromRuText(trimmed, syzranNow.isoDate);

  const evaluation = evaluateTaskPriorityMultiCriteria(
    title,
    trimmed,
    dueDate,
    syzranNow.isoDate
  );

  const schoolId = detectSchoolFromTaskText(trimmed, activeSchool);
  const nowMs = Date.now();
  const explicitReminder = hasExplicitReminderRequest(trimmed);
  const autoReminderIso = explicitReminder
    ? buildSyzranReminderIso(dueDate, dueTime)
    : undefined;
  const validReminderIso =
    autoReminderIso && new Date(autoReminderIso).getTime() > nowMs
      ? autoReminderIso
      : undefined;

  const taskRecord: CompanionTaskRecord = {
    id: `ctask_auto_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
    title,
    description: `Создано автоматически из сообщения Анны: «${trimmed}»`,
    dueDate,
    dueTime,
    reminderAt: validReminderIso,
    reminderRepeat: validReminderIso ? 'none' : undefined,
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

  const timePartRu = dueTime ? ` в ${dueTime}` : '';
  const ambiguitySuffix =
    isDateAmbiguous && ambiguityPromptRu ? ` ⚠️ ${ambiguityPromptRu}` : '';
  const shortConfirmationText = dueDate
    ? `Добавила задачу ${dateLabelRu}${timePartRu}: «${title}» (${evaluation.priorityReason}).${ambiguitySuffix}`
    : `Добавила задачу без жёсткой даты: «${title}» (${evaluation.priorityReason}).${ambiguitySuffix}`;

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

export function buildFallbackTaskFromUserRequest(
  userText: string,
  activeSchool: SchoolId,
  todayIso: string = toSyzranIsoDate()
): CompanionTaskRecord | null {
  const trimmed = userText.trim();
  if (!trimmed || trimmed.length < 4) return null;
  const syzranNow = getSyzranNow();
  const { dueDate, dueTime, dateLabelRu } = parseRelativeDateAndTimeFromRuText(
    trimmed,
    todayIso
  );
  const fallbackDateTitle = dueDate
    ? `Задача ${dateLabelRu.replace(/\s*\([^)]*\)/, '')}${dueTime ? ` в ${dueTime}` : ''}`
    : 'Новая задача';
  const title =
    cleanExtractedTaskTitle(trimmed) || fallbackDateTitle;
  const evaluation = evaluateTaskPriorityMultiCriteria(
    title,
    trimmed,
    dueDate,
    todayIso
  );
  const schoolId = detectSchoolFromTaskText(trimmed, activeSchool);
  const nowMs = Date.now();
  const explicitReminder = hasExplicitReminderRequest(trimmed);
  const autoReminderIso = explicitReminder
    ? buildSyzranReminderIso(dueDate, dueTime)
    : undefined;
  const validReminderIso =
    autoReminderIso && new Date(autoReminderIso).getTime() > nowMs
      ? autoReminderIso
      : undefined;

  return {
    id: `ctask_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
    title,
    description: `Поставлено командой Анны: «${trimmed}»`,
    dueDate,
    dueTime,
    reminderAt: validReminderIso,
    reminderRepeat: validReminderIso ? 'none' : undefined,
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
}

/**
 * Subtracts minutes from a given date and time in Syzran timezone (Europe/Samara, UTC+4).
 */
export function subtractTimeFromSyzranDateTime(
  dateIso: string,
  timeHHMM: string,
  minutesToSubtract: number
): { dateIso: string; timeHHMM: string } {
  const [y, m, d] = dateIso.split('-').map(Number);
  const [hh, mm] = timeHHMM.split(':').map(Number);
  // Europe/Samara is UTC+4
  const eventUtcMs = Date.UTC(y, m - 1, d, hh - 4, mm, 0);
  const reminderUtcMs = eventUtcMs - minutesToSubtract * 60 * 1000;
  const remSnap = getSyzranNow(new Date(reminderUtcMs));
  return { dateIso: remSnap.isoDate, timeHHMM: remSnap.timeHHMM };
}

/**
 * Extracts explicit task priority from Russian text.
 * Strictly avoids guessing or auto-assigning high priority without explicit grounds.
 */
export function parseExplicitPriorityFromRuText(text: string): {
  priority?: CompanionTaskPriority;
  hasExplicitPriority: boolean;
} {
  const lower = text.toLowerCase();
  // High priority markers
  if (
    /(?:^|[^а-яёa-z0-9])(?:высок(?:ий|ая|ое|ую|ом|им)|срочн(?:о|ый|ая|ое|ую|ом|им)|критич(?:но|ный|ная|ное|ную)|как\s+можно\s+быстрее|горит|максимальн(?:ый|ая|ое|ую))(?=$|[^а-яёa-z0-9])/i.test(
      lower
    )
  ) {
    return { priority: 'high', hasExplicitPriority: true };
  }
  // Medium priority markers
  if (
    /(?:^|[^а-яёa-z0-9])(?:средн(?:ий|яя|ее|юю|ей|им|ем)|умеренн(?:ый|ая|ое|ую)|нормальн(?:ый|ая|ое|ую))(?=$|[^а-яёa-z0-9])/i.test(
      lower
    )
  ) {
    return { priority: 'medium', hasExplicitPriority: true };
  }
  // Low/Ordinary priority markers
  if (
    /(?:^|[^а-яёa-z0-9])(?:обычн(?:ый|ая|ое|ую|ом|им)|низк(?:ий|ая|ое|ую|ом|им)|несрочн(?:о|ый|ая|ое|ую)|не\s+к\s+спеху|спокойн(?:о|ый|ая|ое|ую)|минимальн(?:ый|ая|ое|ую)|стандартн(?:ый|ая|ое|ую))(?=$|[^а-яёa-z0-9])/i.test(
      lower
    )
  ) {
    return { priority: 'low', hasExplicitPriority: true };
  }
  return { priority: undefined, hasExplicitPriority: false };
}

/**
 * Extracts explicit reminder date and time from Russian text.
 * Strictly separates reminder time/date from task execution time/date.
 */
export function parseExplicitReminderFromRuText(
  text: string,
  taskDueDate?: string,
  taskDueTime?: string,
  todayIso: string = toSyzranIsoDate(),
  isDirectAnswer: boolean = false
): {
  wantsReminder?: boolean;
  reminderDate?: string;
  reminderTime?: string;
  reminderAt?: string;
  hasExplicitReminder: boolean;
  isAmbiguous?: boolean;
  ambiguityPromptRu?: string;
} {
  const lower = text.toLowerCase().trim();

  // 1. Explicit refusal
  if (
    /(?:без\s+напоминани|не\s+надо\s+напомина|не\s+напоминай|не\s+нужно\s+напомина|напоминание\s+не\s+нужно|без\s+него|не\s+нужно|не\s+надо|нет(?=$|[^а-яёa-z0-9]))/i.test(
      lower
    )
  ) {
    return {
      wantsReminder: false,
      hasExplicitReminder: true,
      reminderDate: undefined,
      reminderTime: undefined,
      reminderAt: undefined,
    };
  }

  // If this is NOT a direct answer to a reminder question, check for explicit reminder cues
  const hasReminderCue = /(?:напомн|предупред|напоминани|без\s+напоминани|не\s+напоминай|с\s+напоминанием|за\s+\d+\s*(?:час|мин)|за\s+(?:час|полчаса|день)|накануне)/i.test(
    lower
  );
  if (!isDirectAnswer && !hasReminderCue) {
    return {
      hasExplicitReminder: false,
    };
  }

  // 2. Relative offset: "за 1 час", "за час", "за 2 часа"
  const hoursBeforeMatch = lower.match(
    /(?:за\s+)?(\d{1,2})\s*(?:час(?:а|ов)?|ч)\s*(?:до\s+(?:начала|дедлайна|срока|задачи)|до)?/i
  ) || (lower.includes('за час') ? [null, '1'] : null);

  if (hoursBeforeMatch && hoursBeforeMatch[1]) {
    const hours = parseInt(hoursBeforeMatch[1], 10);
    if (taskDueDate && taskDueTime) {
      const shifted = subtractTimeFromSyzranDateTime(taskDueDate, taskDueTime, hours * 60);
      const iso = buildSyzranReminderIso(shifted.dateIso, shifted.timeHHMM);
      return {
        wantsReminder: true,
        reminderDate: shifted.dateIso,
        reminderTime: shifted.timeHHMM,
        reminderAt: iso,
        hasExplicitReminder: true,
      };
    }
  }

  // 3. Relative offset: "за 30 минут", "за полчаса", "за 15 минут"
  const minsBeforeMatch = lower.match(
    /(?:за\s+)?(\d{1,3})\s*(?:минут[уы]?|мин)\s*(?:до\s+(?:начала|дедлайна|срока|задачи)|до)?/i
  ) || (lower.includes('полчаса') || lower.includes('пол-часа') ? [null, '30'] : null);

  if (minsBeforeMatch && minsBeforeMatch[1]) {
    const mins = parseInt(minsBeforeMatch[1], 10);
    if (taskDueDate && taskDueTime) {
      const shifted = subtractTimeFromSyzranDateTime(taskDueDate, taskDueTime, mins);
      const iso = buildSyzranReminderIso(shifted.dateIso, shifted.timeHHMM);
      return {
        wantsReminder: true,
        reminderDate: shifted.dateIso,
        reminderTime: shifted.timeHHMM,
        reminderAt: iso,
        hasExplicitReminder: true,
      };
    }
  }

  // 4. Relative offset: "за 1 день", "за день", "накануне"
  if (lower.includes('накануне') || lower.includes('за день') || lower.includes('за сутки')) {
    if (taskDueDate) {
      const prevDate = addDaysToIsoDate(taskDueDate, -1);
      const time = taskDueTime || '10:00';
      const iso = buildSyzranReminderIso(prevDate, time);
      return {
        wantsReminder: true,
        reminderDate: prevDate,
        reminderTime: time,
        reminderAt: iso,
        hasExplicitReminder: true,
      };
    }
  }

  // 5. Look for explicit date and/or time mentioned after reminder cue, or standalone reply
  let reminderSubtext = lower;
  const reminderCueMatch = lower.match(
    /(?:напомни(?:ть)?|напоминани[ея]|предупреди(?:ть)?)\s*(?:мне\s+)?(?:о\s+ней\s+)?(?:в\s+|на\s+)?(.+)/i
  );
  if (reminderCueMatch && reminderCueMatch[1]) {
    reminderSubtext = reminderCueMatch[1];
  }

  const parsed = parseRelativeDateAndTimeFromRuText(reminderSubtext, todayIso);

  // If both date and time are detected for reminder:
  if (parsed.dueDate && parsed.dueTime) {
    const iso = buildSyzranReminderIso(parsed.dueDate, parsed.dueTime);
    return {
      wantsReminder: true,
      reminderDate: parsed.dueDate,
      reminderTime: parsed.dueTime,
      reminderAt: iso,
      hasExplicitReminder: true,
    };
  }

  // If only time is detected for reminder:
  if (parsed.dueTime && !parsed.dueDate) {
    const rDate = taskDueDate || todayIso;
    const iso = buildSyzranReminderIso(rDate, parsed.dueTime);
    return {
      wantsReminder: true,
      reminderDate: rDate,
      reminderTime: parsed.dueTime,
      reminderAt: iso,
      hasExplicitReminder: true,
    };
  }

  // If only date is detected for reminder, but no time:
  if (parsed.dueDate && !parsed.dueTime) {
    return {
      wantsReminder: true,
      reminderDate: parsed.dueDate,
      reminderTime: undefined,
      hasExplicitReminder: false,
      isAmbiguous: true,
      ambiguityPromptRu: `Вы указали дату напоминания (${formatSyzranIsoDateRu(parsed.dueDate)}), но не указали время. Во сколько напомнить?`,
    };
  }

  return {
    hasExplicitReminder: false,
  };
}

/**
 * Formats the final personal task card for Anna's confirmation.
 */
export function formatPersonalTaskConfirmationCard(
  draft: PixelPendingPersonalTaskDraft
): string {
  const schoolLabel =
    draft.schoolId === 'kiberone'
      ? 'KIBERone (КиберШкола)'
      : draft.schoolId === 'renderia'
      ? 'Renderia (Рендерия)'
      : 'Обе школы';

  const dateLabel = draft.dueDate
    ? `${formatSyzranIsoDateRu(draft.dueDate)}`
    : 'Без жёсткого срока';

  const timeLabel = draft.dueTime
    ? `${draft.dueTime} (по Сызрани, Europe/Samara)`
    : 'Не указано';

  const priorityLabel =
    draft.priority === 'high'
      ? '🔴 Высокий'
      : draft.priority === 'medium'
      ? '🟡 Средний'
      : '🟢 Обычный';

  let reminderLabel = 'Без напоминания';
  if (draft.wantsReminder && draft.reminderDate && draft.reminderTime) {
    reminderLabel = `🔔 ${formatSyzranIsoDateRu(draft.reminderDate)} в ${draft.reminderTime} (по Сызрани)`;
  } else if (draft.reminderAt) {
    const snap = getSyzranNow(new Date(draft.reminderAt));
    reminderLabel = `🔔 ${formatSyzranIsoDateRu(snap.isoDate)} в ${snap.timeHHMM} (по Сызрани)`;
  }

  const lines = [
    '### 📋 Подтверждение создания задачи',
    '',
    `- **Название:** ${draft.title}`,
    `- **Описание:** ${draft.description || 'Не указано'}`,
    `- **Школа:** ${schoolLabel}`,
    `- **Дата выполнения:** ${dateLabel}`,
    `- **Время выполнения:** ${timeLabel}`,
    `- **Приоритет:** ${priorityLabel}`,
    `- **Напоминание:** ${reminderLabel}`,
    '',
    'Все параметры заполнены. Подтвердите создание задачи («Создать» или «Да») либо укажите, что изменить («Отмена»).',
  ];

  return lines.join('\n');
}

/**
 * Initializes a new personal task draft from Anna's request.
 * Follows sequential short questions and never asks for already provided info.
 */
export function initPersonalTaskDraft(
  userText: string,
  activeSchool: SchoolId,
  todayIso: string = toSyzranIsoDate()
): {
  draft: PixelPendingPersonalTaskDraft;
  questionRu: string;
  spokenSummary: string;
} {
  const trimmed = userText.trim();
  const nowMs = Date.now();
  const draftId = `draft_${nowMs}_${Math.random().toString(36).slice(2, 6)}`;

  // 1. Title & description extraction
  const explicitAddMatch = trimmed.match(
    /^(?:[«"„“]+)?(?:пиксель\s*,?\s*)?(?:пожалуйста\s*,?\s*)?(?:добавь|создай|запиши|поставь|зафиксируй|внеси|запланируй)(?:\s*,?\s*пожалуйста\s*,?)?(?:\s+мне)?(?:\s+(?:в\s+список\s+дел|в\s+задачи|задач[уи]|дело))?[\s:—,-]*([\s\S]+)$/i
  ) || trimmed.match(
    /^(?:[«"„“]+)?(?:пиксель\s*,?\s*)?(?:мне\s+)?(?:нужно\s+не\s+забыть|надо\s+не\s+забыть|не\s+забыть(?:\s+бы)?|хочу\s+не\s+забыть)\s*[:—-]?\s*([\s\S]+)$/i
  ) || trimmed.match(
    /^(?:[«"„“]+)?(?:пиксель\s*,?\s*)?(?:мне\s+)?(?:(?:сегодня|завтра|послезавтра|(?:в|во|на)\s+(?:понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье))\s+)?(?:мне\s+)?(?:нужно|надо|необходимо|предстоит)\s+(?:будет\s+)?(?:(?:сегодня|завтра|послезавтра|(?:в|во|на)\s+(?:понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье))\s+)?(?:(?:в|к)\s*\d{1,2}(?:[:.]\d{2})?\s*)?((?:провести|сделать|написать|позвонить|подготовить|подготовиться|отправить|проверить|собрать|обновить|согласовать|встретиться|запустить|оплатить|выгрузить|составить|организовать|заказать|купить|передать|разработать)(?=\s|$|[.,!?;:])[\s\S]+)$/i
  );

  const rawBody = explicitAddMatch && explicitAddMatch[1] ? explicitAddMatch[1].trim() : trimmed;
  let title = cleanExtractedTaskTitle(rawBody) || cleanExtractedTaskTitle(trimmed) || 'Личная задача';

  // 2. School
  const schoolId = detectSchoolFromTaskText(trimmed, activeSchool);

  // 3. Date & execution time
  const parsedDateTime = parseRelativeDateAndTimeFromRuText(trimmed, todayIso);
  const dueDate = parsedDateTime.dueDate || '';
  const dueTime = parsedDateTime.dueTime;
  const hasExplicitDate = Boolean(dueDate);
  const hasExplicitDueTime = Boolean(dueTime);

  // 4. Priority
  const explicitPriority = parseExplicitPriorityFromRuText(trimmed);

  // 5. Reminder
  const explicitReminder = parseExplicitReminderFromRuText(trimmed, dueDate, dueTime, todayIso);

  title = title
    .replace(/(?:^|[^а-яёa-z0-9])(?:с\s+)?(?:высоким|средним|обычным|низким)\s+приоритетом(?=$|[^а-яёa-z0-9])/gi, '')
    .replace(/(?:^|[^а-яёa-z0-9])(?:напомни\s+.*|без\s+напоминания)(?=$|[^а-яёa-z0-9])/gi, '')
    .trim();
  if (!title) title = 'Личная задача';

  const draft: PixelPendingPersonalTaskDraft = {
    draftId,
    title,
    description: `Поставлено Анной: «${trimmed}»`,
    schoolId,
    dueDate,
    dueTime,
    hasExplicitDate,
    hasExplicitDueTime,
    priority: explicitPriority.priority,
    hasExplicitPriority: explicitPriority.hasExplicitPriority,
    wantsReminder: explicitReminder.wantsReminder,
    reminderDate: explicitReminder.reminderDate,
    reminderTime: explicitReminder.reminderTime,
    reminderAt: explicitReminder.reminderAt,
    hasExplicitReminder: explicitReminder.hasExplicitReminder,
    step: 'ready_for_confirmation',
    status: 'drafting',
    createdAtMs: nowMs,
  };

  // Sequential question 1: Date is missing or ambiguous
  if (!hasExplicitDate) {
    draft.step = 'clarifying_date';
    const ambiguityNote = parsedDateTime.isDateAmbiguous && parsedDateTime.ambiguityPromptRu
      ? `${parsedDateTime.ambiguityPromptRu}`
      : 'На какую дату запланировать задачу? (например: сегодня, завтра или конкретное число)';
    const questionRu = `Поставила в черновик задачу: **«${title}»**.\n\n${ambiguityNote}`;
    return {
      draft,
      questionRu,
      spokenSummary: `Поставила в черновик задачу ${title}. На какую дату её запланировать?`,
    };
  }

  // Sequential question 2: Priority is missing
  if (!explicitPriority.hasExplicitPriority) {
    draft.step = 'clarifying_priority';
    const datePart = dueDate ? ` на **${formatSyzranIsoDateRu(dueDate)}**` : '';
    const timePart = dueTime ? ` в **${dueTime}**` : '';
    const questionRu = `Записала в черновик задачу **«${title}»**${datePart}${timePart}.\n\nУточните, пожалуйста, приоритет задачи: **обычный**, **средний** или **высокий**?`;
    return {
      draft,
      questionRu,
      spokenSummary: `Уточните, пожалуйста, приоритет задачи: обычный, средний или высокий?`,
    };
  }

  // Sequential question 3: Reminder is missing
  if (!explicitReminder.hasExplicitReminder) {
    draft.step = 'clarifying_reminder';
    const questionRu = `Задача **«${title}»** (приоритет: ${draft.priority === 'high' ? 'высокий' : draft.priority === 'medium' ? 'средний' : 'обычный'}).\n\nНужно ли поставить напоминание? Если да, когда (дата) и во сколько напомнить? (Или скажите «без напоминания»)`;
    return {
      draft,
      questionRu,
      spokenSummary: `Нужно ли поставить напоминание? Когда и во сколько напомнить, или без напоминания?`,
    };
  }

  // All fields were already provided in initial prompt!
  draft.step = 'ready_for_confirmation';
  draft.status = 'awaiting_confirmation';
  const cardText = formatPersonalTaskConfirmationCard(draft);
  return {
    draft,
    questionRu: cardText,
    spokenSummary: `Подготовила карточку задачи ${title}. Пожалуйста, подтвердите создание.`,
  };
}

/**
 * Handles conversational input while a personal task draft is being clarified or confirmed.
 */
export function processPersonalTaskDraftInput(
  draft: PixelPendingPersonalTaskDraft,
  userText: string,
  todayIso: string = toSyzranIsoDate()
): {
  action: 'updated' | 'confirmed' | 'cancelled';
  draft: PixelPendingPersonalTaskDraft;
  responseRu: string;
  spokenSummary: string;
  readyTask?: CompanionTaskRecord;
} {
  const trimmed = userText.trim();
  const lower = trimmed.toLowerCase();

  // 1. Cancellation check
  if (
    /^(?:отмена|отмени|не\s+надо|не\s+создавай|отбой|забудь|стоп)(?=$|[^а-яёa-z0-9])/i.test(
      lower
    )
  ) {
    return {
      action: 'cancelled',
      draft: { ...draft, status: 'cancelled' },
      responseRu: 'Создание задачи отменено.',
      spokenSummary: 'Создание задачи отменено.',
    };
  }

  // 2. Confirmation check (when ready)
  if (draft.step === 'ready_for_confirmation' || draft.status === 'awaiting_confirmation') {
    if (
      /^(?:да|создавай|создать|подтверждаю|сохраняй|сохранить|ок|хорошо|всё\s+верно|давай|ага|точно)(?=$|[^а-яёa-z0-9])/i.test(
        lower
      )
    ) {
      const nowMs = Date.now();
      const syzranNow = getSyzranNow(new Date(nowMs));
      const readyTask: CompanionTaskRecord = {
        id: `ctask_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
        title: draft.title,
        description: draft.description,
        dueDate: draft.dueDate || '',
        dueTime: draft.dueTime,
        priority: draft.priority || 'low',
        priorityReason: `Приоритет выбран Анной: ${draft.priority === 'high' ? 'высокий' : draft.priority === 'medium' ? 'средний' : 'обычный'}`,
        urgencyScore: draft.priority === 'high' ? 9 : draft.priority === 'medium' ? 6 : 3,
        importanceScore: draft.priority === 'high' ? 9 : draft.priority === 'medium' ? 6 : 4,
        estimatedMinutes: 30,
        status: 'new',
        schoolId: draft.schoolId,
        sourceType: 'voice_command',
        sourceExcerpt: draft.description,
        reminderAt: draft.wantsReminder ? draft.reminderAt : undefined,
        reminderRepeat: draft.wantsReminder && draft.reminderAt ? 'none' : undefined,
        createdAt: syzranNow.time24,
        createdAtMs: nowMs,
      };

      const priorityRu =
        readyTask.priority === 'high' ? 'Высокий' : readyTask.priority === 'medium' ? 'Средний' : 'Обычный';
      const dateRu = readyTask.dueDate ? formatSyzranIsoDateRu(readyTask.dueDate) : 'Без даты';
      const timeRu = readyTask.dueTime ? `${readyTask.dueTime} (по Сызрани)` : 'Не указано';

      let reminderNotice = 'Без напоминания.';
      if (readyTask.reminderAt) {
        const remSnap = getSyzranNow(new Date(readyTask.reminderAt));
        reminderNotice = `🔔 **Напоминание установлено:** на **${formatSyzranIsoDateRu(remSnap.isoDate)}** в **${remSnap.timeHHMM}** (по Сызрани).\n*Доставка уведомления:* сработает в приложении со звуковым сигналом и сообщением в чате (пока открыта вкладка или запущено приложение).`;
      }

      const responseRu = `✅ **Задача «${readyTask.title}» успешно сохранена в списке дел!**\n\n- **Школа:** ${readyTask.schoolId === 'kiberone' ? 'KIBERone' : readyTask.schoolId === 'renderia' ? 'Renderia' : 'Обе школы'}\n- **Дата выполнения:** ${dateRu}\n- **Время выполнения:** ${timeRu}\n- **Приоритет:** ${priorityRu}\n- **Напоминание:** ${reminderNotice}`;

      return {
        action: 'confirmed',
        draft: { ...draft, status: 'confirmed' },
        readyTask,
        responseRu,
        spokenSummary: `Задача ${readyTask.title} сохранена в списке дел.`,
      };
    }
  }

  // 3. Answering step: clarifying_date
  if (draft.step === 'clarifying_date') {
    const parsed = parseRelativeDateAndTimeFromRuText(trimmed, todayIso);
    if (parsed.isDateAmbiguous && parsed.ambiguityPromptRu) {
      return {
        action: 'updated',
        draft,
        responseRu: `⚠️ ${parsed.ambiguityPromptRu}`,
        spokenSummary: 'Пожалуйста, уточните дату.',
      };
    }
    if (parsed.dueDate) {
      const nextDraft = {
        ...draft,
        dueDate: parsed.dueDate,
        hasExplicitDate: true,
        dueTime: parsed.dueTime || draft.dueTime,
        hasExplicitDueTime: Boolean(parsed.dueTime || draft.dueTime),
      };

      if (!nextDraft.hasExplicitPriority) {
        nextDraft.step = 'clarifying_priority';
        const datePart = ` на **${formatSyzranIsoDateRu(nextDraft.dueDate)}**`;
        const timePart = nextDraft.dueTime ? ` в **${nextDraft.dueTime}**` : '';
        return {
          action: 'updated',
          draft: nextDraft,
          responseRu: `Дата установлена:${datePart}${timePart}.\n\nУточните, пожалуйста, приоритет задачи: **обычный**, **средний** или **высокий**?`,
          spokenSummary: 'Уточните, пожалуйста, приоритет задачи: обычный, средний или высокий?',
        };
      }

      if (!nextDraft.hasExplicitReminder) {
        nextDraft.step = 'clarifying_reminder';
        return {
          action: 'updated',
          draft: nextDraft,
          responseRu: `Дата установлена: **${formatSyzranIsoDateRu(nextDraft.dueDate)}**.\n\nНужно ли поставить напоминание? Если да, когда (дата) и во сколько напомнить? (Или скажите «без напоминания»)`,
          spokenSummary: 'Нужно ли поставить напоминание, когда и во сколько?',
        };
      }

      nextDraft.step = 'ready_for_confirmation';
      nextDraft.status = 'awaiting_confirmation';
      return {
        action: 'updated',
        draft: nextDraft,
        responseRu: formatPersonalTaskConfirmationCard(nextDraft),
        spokenSummary: 'Все параметры заполнены. Подтвердите создание задачи.',
      };
    }

    return {
      action: 'updated',
      draft,
      responseRu: 'Не удалось распознать дату. Укажите, пожалуйста, день для задачи (например: «на завтра», «на 4 ноября» или «на среду»).',
      spokenSummary: 'Не удалось распознать дату. Укажите, пожалуйста, день для задачи.',
    };
  }

  // 4. Answering step: clarifying_priority
  if (draft.step === 'clarifying_priority') {
    const parsedPriority = parseExplicitPriorityFromRuText(trimmed);
    if (parsedPriority.hasExplicitPriority) {
      const nextDraft = {
        ...draft,
        priority: parsedPriority.priority,
        hasExplicitPriority: true,
      };

      // Also check if user specified time in this reply
      const timeParsed = parseRelativeDateAndTimeFromRuText(trimmed, todayIso);
      if (timeParsed.dueTime && !nextDraft.dueTime) {
        nextDraft.dueTime = timeParsed.dueTime;
        nextDraft.hasExplicitDueTime = true;
      }

      // Also check if user already answered reminder in this reply
      const remParsed = parseExplicitReminderFromRuText(trimmed, nextDraft.dueDate, nextDraft.dueTime, todayIso);
      if (remParsed.hasExplicitReminder) {
        nextDraft.wantsReminder = remParsed.wantsReminder;
        nextDraft.reminderDate = remParsed.reminderDate;
        nextDraft.reminderTime = remParsed.reminderTime;
        nextDraft.reminderAt = remParsed.reminderAt;
        nextDraft.hasExplicitReminder = true;
      }

      if (!nextDraft.hasExplicitReminder) {
        nextDraft.step = 'clarifying_reminder';
        const pLabel = nextDraft.priority === 'high' ? 'высокий' : nextDraft.priority === 'medium' ? 'средний' : 'обычный';
        return {
          action: 'updated',
          draft: nextDraft,
          responseRu: `Приоритет: **${pLabel}**.\n\nНужно ли поставить напоминание? Если да, когда (дата) и во сколько напомнить? (Или скажите «без напоминания»)`,
          spokenSummary: 'Нужно ли поставить напоминание? Когда и во сколько?',
        };
      }

      nextDraft.step = 'ready_for_confirmation';
      nextDraft.status = 'awaiting_confirmation';
      return {
        action: 'updated',
        draft: nextDraft,
        responseRu: formatPersonalTaskConfirmationCard(nextDraft),
        spokenSummary: 'Все параметры заполнены. Подтвердите создание задачи.',
      };
    }

    return {
      action: 'updated',
      draft,
      responseRu: 'Пожалуйста, выберите приоритет: **обычный**, **средний** или **высокий**.',
      spokenSummary: 'Пожалуйста, выберите приоритет: обычный, средний или высокий.',
    };
  }

  // 5. Answering step: clarifying_reminder
  if (draft.step === 'clarifying_reminder') {
    const parsedRem = parseExplicitReminderFromRuText(trimmed, draft.dueDate, draft.dueTime, todayIso, true);
    if (parsedRem.isAmbiguous && parsedRem.ambiguityPromptRu) {
      return {
        action: 'updated',
        draft,
        responseRu: parsedRem.ambiguityPromptRu,
        spokenSummary: 'Во сколько напомнить?',
      };
    }

    if (parsedRem.hasExplicitReminder) {
      const nextDraft: PixelPendingPersonalTaskDraft = {
        ...draft,
        wantsReminder: parsedRem.wantsReminder,
        reminderDate: parsedRem.reminderDate,
        reminderTime: parsedRem.reminderTime,
        reminderAt: parsedRem.reminderAt,
        hasExplicitReminder: true,
        step: 'ready_for_confirmation',
        status: 'awaiting_confirmation',
      };

      return {
        action: 'updated',
        draft: nextDraft,
        responseRu: formatPersonalTaskConfirmationCard(nextDraft),
        spokenSummary: 'Все параметры заполнены. Подтвердите создание задачи.',
      };
    }

    return {
      action: 'updated',
      draft,
      responseRu: 'Пожалуйста, укажите дату и время напоминания (например: «4 ноября в 10:00», «за 1 час» или «без напоминания»).',
      spokenSummary: 'Укажите время напоминания или скажите без напоминания.',
    };
  }

  // 6. Adjusting fields while in ready_for_confirmation
  const nextDraft = { ...draft };
  let modifiedAny = false;

  const prioAdj = parseExplicitPriorityFromRuText(trimmed);
  if (prioAdj.hasExplicitPriority) {
    nextDraft.priority = prioAdj.priority;
    modifiedAny = true;
  }

  const isReminderAdjustment = /(?:напомн|предупред|напоминани|без\s+напоминани)/i.test(trimmed);
  if (isReminderAdjustment) {
    const remAdj = parseExplicitReminderFromRuText(trimmed, nextDraft.dueDate, nextDraft.dueTime, todayIso, true);
    if (remAdj.hasExplicitReminder) {
      nextDraft.wantsReminder = remAdj.wantsReminder;
      nextDraft.reminderDate = remAdj.reminderDate;
      nextDraft.reminderTime = remAdj.reminderTime;
      nextDraft.reminderAt = remAdj.reminderAt;
      modifiedAny = true;
    }
  } else {
    const dtAdj = parseRelativeDateAndTimeFromRuText(trimmed, todayIso);
    if (dtAdj.dueDate) {
      nextDraft.dueDate = dtAdj.dueDate;
      modifiedAny = true;
    }
    if (dtAdj.dueTime) {
      nextDraft.dueTime = dtAdj.dueTime;
      modifiedAny = true;
    }
  }

  if (modifiedAny) {
    nextDraft.step = 'ready_for_confirmation';
    nextDraft.status = 'awaiting_confirmation';
    return {
      action: 'updated',
      draft: nextDraft,
      responseRu: `Обновила параметры черновика:\n\n${formatPersonalTaskConfirmationCard(nextDraft)}`,
      spokenSummary: 'Обновила параметры задачи. Подтвердите создание.',
    };
  }

  return {
    action: 'updated',
    draft,
    responseRu: `Пожалуйста, подтвердите создание задачи («Создать» или «Да») либо укажите, что изменить:\n\n${formatPersonalTaskConfirmationCard(draft)}`,
    spokenSummary: 'Пожалуйста, подтвердите создание задачи или укажите изменения.',
  };
}

/**
 * Parses and executes voice & text task management commands directly against Anna's task list.
 */
export function parseAndExecuteTaskCommand(
  userText: string,
  activeSchool: SchoolId,
  existingTasks: CompanionTaskRecord[],
  todayIsoOverride?: string
): TaskCommandExecutionResult | null {
  const trimmed = userText.trim();
  const lower = trimmed.toLowerCase();
  const syzranNow = getSyzranNow();
  const todayIso = todayIsoOverride || syzranNow.isoDate;
  const tomorrowIso = addDaysToIsoDate(todayIso, 1);

  if (SPECIALIST_DELEGATION_PATTERN.test(trimmed)) {
    return null;
  }

  const isTimerCommand =
    /^(?:пиксель\s*,?\s*)?(?:пожалуйста\s*,?\s*)?(?:поставь\s+таймер|включи\s+таймер|запусти\s+таймер|засеки(?:\s+время)?|таймер\b)/i.test(
      trimmed
    );

  // 1. Explicit «Добавь задачу...» / «Создай задачу...» / «Запиши задачу...» / «Поставь, пожалуйста, задачу на среду...» / «Мне нужно...» / «В среду провести...»
  const explicitAddMatch = !isTimerCommand
    ? trimmed.match(
        /^(?:[«"„“]+)?(?:пиксель\s*,?\s*)?(?:пожалуйста\s*,?\s*)?(?:добавь|создай|запиши|поставь|зафиксируй|внеси|запланируй)(?:\s*,?\s*пожалуйста\s*,?)?(?:\s+мне)?(?:\s+(?:в\s+список\s+дел|в\s+задачи|задач[уи]|дело))?[\s:—,-]*([\s\S]+)$/i
      ) ||
      trimmed.match(
        /^(?:[«"„“]+)?(?:пиксель\s*,?\s*)?(?:мне\s+)?(?:нужно\s+не\s+забыть|надо\s+не\s+забыть|не\s+забыть(?:\s+бы)?|хочу\s+не\s+забыть)\s*[:—-]?\s*([\s\S]+)$/i
      ) ||
      trimmed.match(
        /^(?:[«"„“]+)?(?:пиксель\s*,?\s*)?(?:мне\s+)?(?:(?:сегодня|завтра|послезавтра|(?:в|во|на)\s+(?:понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье))\s+)?(?:мне\s+)?(?:нужно|надо|необходимо|предстоит)\s+(?:будет\s+)?(?:(?:сегодня|завтра|послезавтра|(?:в|во|на)\s+(?:понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье))\s+)?(?:(?:в|к)\s*\d{1,2}(?:[:.]\d{2})?\s*)?((?:провести|сделать|написать|позвонить|подготовить|подготовиться|отправить|проверить|собрать|обновить|согласовать|встретиться|запустить|оплатить|выгрузить|составить|организовать|заказать|купить|передать|разработать)(?=\s|$|[.,!?;:])[\s\S]+)$/i
      ) ||
      trimmed.match(
        /^(?:[«"„“]+)?(?:пиксель\s*,?\s*)?((?:(?:в|во|на)\s+(?:понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)|сегодня|завтра|послезавтра)\s+(?:(?:в|к)\s*\d{1,2}(?:[:.]\d{2})?\s*)?(?:провести|сделать|написать|позвонить|подготовить|подготовиться|отправить|проверить|собрать|обновить|согласовать|встретиться|запустить|оплатить|выгрузить|составить|организовать|заказать|купить|передать|разработать)(?=\s|$|[.,!?;:])[\s\S]+)$/i
      )
    : null;

  if (explicitAddMatch && explicitAddMatch[1] && !trimmed.includes('?')) {
    const draftInit = initPersonalTaskDraft(trimmed, activeSchool, todayIso);
    return {
      handled: true,
      personalTaskDraft: draftInit.draft,
      responseText: draftInit.questionRu,
      spokenSummary: draftInit.spokenSummary,
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

  // 8. Cancel reminder / timer: «Отмени напоминание...» / «Удали напоминание...» / «Отмени таймер...» / «Не напоминай...»
  const cancelReminderMatch = trimmed.match(
    /^(?:пиксель\s*,?\s*)?(?:отмени|удали|сними|выключи|останови)\s+(?:напоминани[ея]|таймер)\s*(.*)$/i
  ) || trimmed.match(/^(?:пиксель\s*,?\s*)?не\s+напоминай\s*(.*)$/i);
  if (cancelReminderMatch) {
    const query = (cancelReminderMatch[1] || '').trim();
    const tasksWithReminders = existingTasks.filter(
      (t) => t.status !== 'done' && Boolean(t.reminderAt)
    );
    const targetTask =
      tasksWithReminders.length > 0
        ? findMatchingTask(tasksWithReminders, query)
        : findMatchingTask(existingTasks, query);

    if (!targetTask || !targetTask.reminderAt) {
      return {
        handled: true,
        responseText:
          'Сейчас нет активного запланированного напоминания или таймера, который можно отменить.',
        spokenSummary: 'Активных напоминаний для отмены не найдено.',
      };
    }

    const isPureReminderOrTimer =
      targetTask.id.startsWith('ctask_rem_') ||
      targetTask.id.startsWith('ctask_timer_') ||
      targetTask.sourceType === 'reminder' ||
      /^(?:таймер|напоминание)/i.test(targetTask.title);

    const updated: CompanionTaskRecord = {
      ...targetTask,
      reminderAt: undefined,
      reminderRepeat: 'none',
      status: isPureReminderOrTimer ? 'done' : targetTask.status,
      completedAt: isPureReminderOrTimer ? syzranNow.time24 : targetTask.completedAt,
      completedAtMs: isPureReminderOrTimer ? Date.now() : targetTask.completedAtMs,
    };

    return {
      handled: true,
      updatedTasks: [updated],
      openTasksTabWithFilter: 'all',
      responseText: `Отменила напоминание по задаче **«${updated.title}»**. Уведомление больше не сработает.`,
      spokenSummary: `Отменила напоминание: ${updated.title}.`,
    };
  }

  // 9. Reschedule reminder / timer: «Перенеси напоминание ... на ... / через ...»
  const rescheduleReminderMatch = trimmed.match(
    /^(?:пиксель\s*,?\s*)?(?:перенеси|отложи|сдвинь)\s+(?:напоминани[ея]|таймер)\s*(.*?)\s+(?:на\s+|через\s+)(.+)$/i
  );
  if (rescheduleReminderMatch) {
    const rawQuery = (rescheduleReminderMatch[1] || '').trim();
    const rawWhen = trimmed.slice(trimmed.toLowerCase().lastIndexOf(rescheduleReminderMatch[2].toLowerCase()) - 6).trim();
    const tasksWithReminders = existingTasks.filter(
      (t) => t.status !== 'done' && Boolean(t.reminderAt)
    );
    const targetTask =
      tasksWithReminders.length > 0
        ? findMatchingTask(tasksWithReminders, rawQuery)
        : findMatchingTask(existingTasks, rawQuery);

    if (!targetTask) {
      return {
        handled: true,
        responseText: 'Не нашла активное напоминание или задачу для переноса.',
        spokenSummary: 'Не нашла напоминание для переноса.',
      };
    }

    const inSecondsMatch = rawWhen.match(/через\s+(\d{1,3})\s*(?:секунд[уы]?|сек(?=\s|$|[.,!?;:]))/i);
    const inMinutesMatch = rawWhen.match(/(?:через|на)\s+(\d{1,3})\s*(?:минут[уы]?|мин(?=\s|$|[.,!?;:]))/i);
    const inHoursMatch = rawWhen.match(/(?:через|на)\s+(\d{1,2})\s*(?:час(?:а|ов)?|ч(?=\s|$|[.,!?;:]))/i);

    let newReminderMs = Date.now() + 15 * 60 * 1000;
    let newLabelRu = '';

    if (inSecondsMatch) {
      const secs = Math.max(5, parseInt(inSecondsMatch[1], 10));
      newReminderMs = Date.now() + secs * 1000;
      const fireSnap = getSyzranNow(new Date(newReminderMs));
      newLabelRu = `через ${secs} сек. (в ${fireSnap.timeHHMMSS} по Сызрани)`;
    } else if (inMinutesMatch) {
      const mins = Math.max(1, parseInt(inMinutesMatch[1], 10));
      newReminderMs = Date.now() + mins * 60 * 1000;
      const fireSnap = getSyzranNow(new Date(newReminderMs));
      newLabelRu = `через ${mins} мин. (в ${fireSnap.timeHHMM}:${String(fireSnap.second).padStart(2, '0')} по Сызрани)`;
    } else if (inHoursMatch) {
      const hrs = Math.max(1, parseInt(inHoursMatch[1], 10));
      newReminderMs = Date.now() + hrs * 60 * 60 * 1000;
      const fireSnap = getSyzranNow(new Date(newReminderMs));
      newLabelRu = `через ${hrs} ч. (в ${fireSnap.timeHHMM} по Сызрани)`;
    } else {
      const parsed = parseRelativeDateAndTimeFromRuText(rawWhen, todayIso);
      const datePart = parsed.dueDate || targetTask.dueDate || todayIso;
      const timePart = parsed.dueTime || targetTask.dueTime || '10:00';
      const iso = buildSyzranReminderIso(datePart, timePart);
      newReminderMs = iso ? new Date(iso).getTime() : Date.now() + 30 * 60 * 1000;
      newLabelRu = `на ${formatSyzranIsoDateRu(datePart)} в ${timePart} (по Сызрани)`;
    }

    const fireSnap = getSyzranNow(new Date(newReminderMs));
    const updated: CompanionTaskRecord = {
      ...targetTask,
      dueDate: fireSnap.isoDate,
      dueTime: fireSnap.timeHHMM,
      reminderAt: new Date(newReminderMs).toISOString(),
      lastReminderFiredAtMs: undefined,
    };

    return {
      handled: true,
      updatedTasks: [updated],
      openTasksTabWithFilter: 'all',
      responseText: `Перенесла напоминание по задаче **«${updated.title}»** — новое время срабатывания: **${newLabelRu}**.`,
      spokenSummary: `Перенесла напоминание ${updated.title} ${newLabelRu}.`,
    };
  }

  // 10. «Перенеси это на завтра» / «Перенеси задачу ... на завтра / на среду в 16:00 / на 4 ноября»
  const rescheduleMatch = trimmed.match(
    /^(?:пиксель\s*,?\s*)?перенеси\s+(?:задач[уи]\s+|дело\s+)?(.+?)\s+на\s+((?:сегодня|завтра|послезавтра|следующую\s+неделю|понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье|\d{1,2}\.\d{1,2}(?:\.\d{4})?|\d{1,2}\s+(?:январ[яеью]?|феврал[яеью]?|март[аеу]?|апрел[яеью]?|ма[яеюйо]|июн[яеью]?|июл[яеью]?|август[аеу]?|сентябр[яеью]?|октябр[яеью]?|ноябр[яеью]?|декабр[яеью]?)(?:\s+\d{4}(?:\s*года)?)?)(?:\s+(?:в|к)\s*\d{1,2}(?:[:.]\d{2})?)?)$/i
  );
  if (rescheduleMatch) {
    const taskQuery = rescheduleMatch[1].trim();
    const targetWhenText = `в ${rescheduleMatch[2].trim()}`;
    const targetTask = findMatchingTask(existingTasks, taskQuery);
    if (!targetTask) {
      return {
        handled: true,
        responseText: 'Не нашла подходящую активную задачу для переноса.',
        spokenSummary: 'Не нашла активную задачу для переноса.',
      };
    }

    const { dueDate, dueTime, dateLabelRu } = parseRelativeDateAndTimeFromRuText(
      targetWhenText,
      todayIso
    );
    const finalDate = dueDate || tomorrowIso;
    const finalTime = dueTime || targetTask.dueTime;
    const nextReminderIso = buildSyzranReminderIso(finalDate, finalTime);

    const updated: CompanionTaskRecord = {
      ...targetTask,
      dueDate: finalDate,
      dueTime: finalTime,
      reminderAt: nextReminderIso || targetTask.reminderAt,
      lastReminderFiredAtMs: nextReminderIso ? undefined : targetTask.lastReminderFiredAtMs,
      pendingScheduleProposal: undefined,
    };

    const timeInfo = finalTime ? ` в **${finalTime}**` : '';
    return {
      handled: true,
      updatedTasks: [updated],
      responseText: `Перенесла задачу **«${updated.title}»** ${dateLabelRu} (**${formatSyzranIsoDateRu(finalDate)}**${timeInfo}).`,
      spokenSummary: `Перенесла задачу ${updated.title} на ${formatSyzranIsoDateRu(finalDate)}${finalTime ? ` в ${finalTime}` : ''}.`,
    };
  }

  // 11. «Отложи задачу...»
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

  // 12. «Отметь выполненной...» / «Закрой задачу...»
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

  // 13. «Разбей эту задачу на шаги» / «Разбей задачу ... на шаги»
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

  // 14. Explicit Timer command: «Поставь таймер на 5 минут...» / «Засеки 1 минуту...» / «Таймер на 2 минуты...»
  const timerMatch = trimmed.match(
    /^(?:пиксель\s*,?\s*)?(?:поставь\s+таймер|включи\s+таймер|запусти\s+таймер|засеки(?:\s+время)?|таймер)\s+(?:на\s+)?(\d{1,3})\s*(минут[уы]?|мин(?=\s|$|[.,!?;:])|секунд[уы]?|сек(?=\s|$|[.,!?;:])|час(?:а|ов)?|ч(?=\s|$|[.,!?;:]))\s*(.*)$/i
  );
  if (timerMatch) {
    const amount = Math.max(1, parseInt(timerMatch[1], 10));
    const unitRaw = timerMatch[2].toLowerCase();
    const extraLabel = (timerMatch[3] || '').replace(/^[:—-]\s*/, '').trim();

    let durationMs = amount * 60 * 1000;
    let durationLabelRu = `${amount} мин.`;
    if (unitRaw.startsWith('сек')) {
      durationMs = amount * 1000;
      durationLabelRu = `${amount} сек.`;
    } else if (unitRaw.startsWith('ч')) {
      durationMs = amount * 60 * 60 * 1000;
      durationLabelRu = `${amount} ч.`;
    }

    const nowMs = Date.now();
    const reminderAtMs = nowMs + durationMs;
    const fireSnap = getSyzranNow(new Date(reminderAtMs));
    const title = extraLabel
      ? `Таймер (${durationLabelRu}): ${cleanExtractedTaskTitle(extraLabel) || extraLabel}`
      : `Таймер на ${durationLabelRu}`;

    const newTask: CompanionTaskRecord = {
      id: `ctask_timer_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      description: `Таймер запущен в ${syzranNow.timeHHMMSS} на ${durationLabelRu}. Сработает в ${fireSnap.timeHHMMSS} по Сызрани.`,
      dueDate: fireSnap.isoDate,
      dueTime: fireSnap.timeHHMM,
      priority: 'high',
      priorityReason: `Активный таймер на ${durationLabelRu} (до ${fireSnap.timeHHMMSS})`,
      urgencyScore: 9,
      importanceScore: 8,
      estimatedMinutes: Math.max(1, Math.round(durationMs / 60000)),
      status: 'in_progress',
      schoolId: detectSchoolFromTaskText(trimmed, activeSchool),
      sourceType: 'reminder',
      sourceExcerpt: trimmed,
      reminderAt: new Date(reminderAtMs).toISOString(),
      reminderRepeat: 'none',
      createdAt: syzranNow.time24,
      createdAtMs: nowMs,
    };

    return {
      handled: true,
      createdTask: newTask,
      openTasksTabWithFilter: 'today',
      responseText: `Запустила таймер **«${newTask.title}»** на **${durationLabelRu}**.\n\n- **Время запуска:** ${syzranNow.timeHHMMSS} (Сызрань)\n- **Время срабатывания:** **${fireSnap.timeHHMMSS}** (${formatSyzranIsoDateRu(fireSnap.isoDate)})\n\nЯ пришлю уведомление в чат и системное оповещение ровно в момент завершения таймера.`,
      spokenSummary: `Таймер на ${durationLabelRu} запущен. Я сообщу, когда время выйдет.`,
    };
  }

  // 15. «Напомни мне об этом...» / «Напомни мне через ...» / «Напомни завтра в 10:00 ...»
  const remindMatch = trimmed.match(
    /^(?:пиксель\s*,?\s*)?напомни\s+(?:мне\s+)?(.+)$/i
  );
  if (remindMatch && remindMatch[1]) {
    const body = remindMatch[1].trim();
    const inSecondsMatch = body.match(/через\s+(\d{1,3})\s*(?:секунд[уы]?|сек(?=\s|$|[.,!?;:]))/i);
    const inMinutesMatch = body.match(/через\s+(?:(\d{1,3})\s*)?(?:минут[уы]?|мин(?=\s|$|[.,!?;:]))/i);
    const inHoursMatch = body.match(/через\s+(?:(\d{1,2})\s*)?(?:час(?:а|ов)?|ч(?=\s|$|[.,!?;:]))/i);

    let reminderAtMs = Date.now() + 30 * 60 * 1000; // default +30 min
    let reminderLabelRu = 'через 30 минут';

    if (inSecondsMatch) {
      const secs = Math.max(5, parseInt(inSecondsMatch[1], 10));
      reminderAtMs = Date.now() + secs * 1000;
      const fireSnap = getSyzranNow(new Date(reminderAtMs));
      reminderLabelRu = `через ${secs} сек. (в ${fireSnap.timeHHMMSS} по Сызрани)`;
    } else if (inMinutesMatch) {
      const mins = inMinutesMatch[1] ? Math.max(1, parseInt(inMinutesMatch[1], 10)) : 1;
      reminderAtMs = Date.now() + mins * 60 * 1000;
      const fireSnap = getSyzranNow(new Date(reminderAtMs));
      reminderLabelRu = `через ${mins} мин. (в ${fireSnap.timeHHMM}:${String(fireSnap.second).padStart(2, '0')} по Сызрани)`;
    } else if (inHoursMatch) {
      const hrs = inHoursMatch[1] ? Math.max(1, parseInt(inHoursMatch[1], 10)) : 1;
      reminderAtMs = Date.now() + hrs * 60 * 60 * 1000;
      const fireSnap = getSyzranNow(new Date(reminderAtMs));
      reminderLabelRu = `через ${hrs} ч. (в ${fireSnap.timeHHMM} по Сызрани)`;
    } else {
      const parsed = parseRelativeDateAndTimeFromRuText(body, todayIso);
      if (parsed.isDateAmbiguous && parsed.ambiguityPromptRu) {
        return {
          handled: true,
          responseText: `⚠️ **Уточните дату напоминания:** ${parsed.ambiguityPromptRu}`,
          spokenSummary: `Пожалуйста, уточните дату напоминания.`,
        };
      }
      if (!parsed.dueDate) {
        return {
          handled: true,
          responseText: `⚠️ Не удалось определить дату для напоминания. Уточните, пожалуйста, день и время (например: «напомни завтра в 10:00» или «напомни 15 декабря в 15:00»).`,
          spokenSummary: `Уточните, пожалуйста, день и время для напоминания.`,
        };
      }
      const datePart = parsed.dueDate;
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
      .replace(/через\s+(?:\d+\s*)?(?:секунд[уы]?|сек|минут[уы]?|мин|час(?:а|ов)?|ч)(?=\s|$|[.,!?;:])/gi, '')
      .replace(/(?:каждый\s+день|ежедневно|по\s+будням|каждую\s+неделю|еженедельно)/gi, '')
      .replace(
        /(?:^|[^а-яёa-z0-9])(?:(?:в|во|на|к|до)\s+)?\d{1,2}(?:-(?:е|го|ое|ье|ья|м))?\s+(?:январ[яеью]?|феврал[яеью]?|март[аеу]?|апрел[яеью]?|ма[яеюйо]|июн[яеью]?|июл[яеью]?|август[аеу]?|сентябр[яеью]?|октябр[яеью]?|ноябр[яеью]?|декабр[яеью]?)(?:\s+\d{4}(?:\s*года|\s*г\.?|\s*г)?)?(?=$|[^а-яёa-z0-9])/gi,
        ' '
      )
      .replace(/(?:сегодня|завтра|послезавтра)?\s*(?:в|к)\s*\d{1,2}(?::\d{2})?\s*(?:утра|дня|вечера)?/gi, '')
      .replace(/^(?:об\s+этом|о\s+том\s+чтобы|о\s+том\s+что|про\s+то\s+чтобы|что\s+нужно|про|о)\s*/i, '')
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
    const fireSnap = getSyzranNow(new Date(reminderAtMs));
    const newTask: CompanionTaskRecord = {
      id: `ctask_rem_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      description: `Напоминание (${reminderLabelRu}): «${trimmed}»`,
      dueDate: fireSnap.isoDate,
      dueTime: fireSnap.timeHHMM,
      priority: evaluation.priority,
      priorityReason: evaluation.priorityReason,
      urgencyScore: evaluation.urgencyScore,
      importanceScore: evaluation.importanceScore,
      estimatedMinutes: 15,
      status: 'new',
      schoolId: detectSchoolFromTaskText(body, activeSchool),
      sourceType: 'reminder',
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
      responseText: `Записала напоминание **«${newTask.title}»**:\n\n- **Задача:** ${newTask.title}\n- **Дата:** ${formatSyzranIsoDateRu(fireSnap.isoDate)}\n- **Время срабатывания:** **${reminderLabelRu}**${repeat !== 'none' ? ` (повтор: ${repeat === 'daily' ? 'каждый день' : repeat === 'weekdays' ? 'по будням' : 'каждую неделю'})` : ''}\n\n*Примечание:* напоминание сработает автоматически в назначенное время (включая свёрнутое окно приложения). Если приложение будет полностью закрыто — я сразу покажу пропущенное напоминание при следующем запуске.`,
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

    // 1. Explicit reminderAt check (one-shot reminders, recurring reminders, and timers)
    if (task.reminderAt) {
      const reminderMs = new Date(task.reminderAt).getTime();
      if (!Number.isNaN(reminderMs)) {
        if (
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

          const isTimer =
            task.id.startsWith('ctask_timer_') || /^таймер(?=\s|$|[.,!?;:(\-])/i.test(task.title);
          const isMissed = nowMs - reminderMs > 90 * 1000;
          const scheduledSnap = getSyzranNow(new Date(reminderMs));

          const alertTitle = isTimer
            ? `Таймер завершён: ${task.title}`
            : isMissed
            ? `Пропущенное напоминание: ${task.title}`
            : `Напоминание: ${task.title}`;

          const alertMessage = isTimer
            ? `⏱️ **Таймер завершён!** Время вышло по задаче **«${task.title}»** (${syzranNow.timeHHMMSS} по Сызрани).`
            : isMissed
            ? `🔔 **Пропущенное напоминание** (было назначено на ${scheduledSnap.dateFormattedRu} в ${scheduledSnap.timeHHMM}): **«${task.title}»**.`
            : `🔔 **Напоминание (${syzranNow.timeHHMM} по Сызрани):** Анна, напоминаю о задаче **«${task.title}»**.`;

          alerts.push({
            id: `rem_${task.id}_${reminderMs}`,
            type: 'task_reminder',
            title: alertTitle,
            message: alertMessage,
            taskId: task.id,
            updatedTaskPatch: {
              lastReminderFiredAtMs: nowMs,
              reminderAt: nextReminderIso,
              ...(isTimer && !nextReminderIso
                ? {
                    status: 'done' as CompanionTaskStatus,
                    completedAt: syzranNow.time24,
                    completedAtMs: nowMs,
                  }
                : {}),
            },
          });
        }
        // Do not fall through to generic approaching_deadline when an explicit reminderAt is configured
        continue;
      }
    }

    // 2. Approaching deadline today with dueTime within 45 minutes (only if no explicit reminderAt and not just created)
    if (
      task.dueDate === todayIso &&
      task.dueTime &&
      !task.deadlineWarningFired &&
      task.sourceType !== 'reminder' &&
      nowMs - task.createdAtMs > 5 * 60 * 1000
    ) {
      const [hh, mm] = task.dueTime.split(':').map(Number);
      const dueMinutesTotal = hh * 60 + mm;
      const nowMinutesTotal = syzranNow.hour * 60 + syzranNow.minute;
      const diff = dueMinutesTotal - nowMinutesTotal;
      if (diff > 0 && diff <= 45) {
        alerts.push({
          id: `deadline_${task.id}_${todayIso}`,
          type: 'approaching_deadline',
          title: `Приближается дедлайн (${task.dueTime})`,
          message: `⏰ Через ${diff} мин. (${task.dueTime}) наступает срок задачи **«${task.title}»**.`,
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
