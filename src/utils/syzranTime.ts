/**
 * Точное время для управляющей Анны:
 * Часовой пояс: Europe/Samara (Сызрань, Самарская область).
 *
 * Все расчёты дат, сроков задач, планов на день и напоминаний
 * выполняются строго через IANA time zone `Europe/Samara`,
 * независимо от того, в каком часовом поясе находится устройство.
 */

export const SYZRAN_TIMEZONE = 'Europe/Samara';
export const SYZRAN_CITY_LABEL = 'Сызрань (Самарская область, Europe/Samara)';

export interface SyzranTimeSnapshot {
  /** Исходный объект Date системных часов */
  systemDate: Date;
  /** Timestamp в мс */
  timestampMs: number;
  /** Дата в формате YYYY-MM-DD по часовому поясу Europe/Samara */
  isoDate: string;
  /** Время ЧЧ:ММ по часовому поясу Europe/Samara */
  timeHHMM: string;
  /** Алиас времени ЧЧ:ММ (24-часовой формат) */
  time24: string;
  /** Время ЧЧ:ММ:СС по часовому поясу Europe/Samara */
  timeHHMMSS: string;
  /** День недели на русском языке (например, «понедельник») */
  dayOfWeekRu: string;
  /** Дата в формате ДД.ММ.ГГГГ (например, «02.11.2026») */
  dateFormattedRu: string;
  /** Алиас краткой даты ДД.ММ.ГГГГ */
  dateShortRu: string;
  /** Дата прописью (например, «2 ноября 2026 г.») */
  dateLongRu: string;
  /** Алиас даты прописью */
  dateRu: string;
  /** Полная строка даты и времени в Сызрани */
  fullLabelRu: string;
  /** Час (0–23) в Сызрани */
  hour: number;
  /** Минута (0–59) в Сызрани */
  minute: number;
  /** Секунда (0–59) в Сызрани */
  second: number;
  /** Год в Сызрани */
  year: number;
  /** Месяц (1–12) в Сызрани */
  month: number;
  /** День месяца (1–31) в Сызрани */
  day: number;
  /** Прошли ли системные часы базовую проверку достоверности */
  isSystemClockSane: boolean;
  /** Пояснение об источнике времени */
  sourceNoteRu: string;
}

const WEEKDAYS_RU: Record<string, string> = {
  понедельник: 'понедельник',
  вторник: 'вторник',
  среда: 'среда',
  четверг: 'четверг',
  пятница: 'пятница',
  суббота: 'суббота',
  воскресенье: 'воскресенье',
};

/**
 * Получает текущие дату и время в Сызрани (IANA: Europe/Samara)
 * на основе системного времени устройства.
 */
export function getSyzranNow(customDate?: Date): SyzranTimeSnapshot {
  const now = customDate instanceof Date ? customDate : new Date();
  const timestampMs = now.getTime();

  // Базовая проверка адекватности системных часов устройства (между 2024 и 2036 годом)
  const rawYear = now.getUTCFullYear();
  const isSystemClockSane =
    !Number.isNaN(timestampMs) && rawYear >= 2024 && rawYear <= 2036;

  try {
    const partsFormatter = new Intl.DateTimeFormat('ru-RU', {
      timeZone: SYZRAN_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'long',
      hour12: false,
    });

    const parts = partsFormatter.formatToParts(now);
    const map: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== 'literal') {
        map[part.type] = part.value;
      }
    }

    const yyyy = map.year || String(now.getFullYear());
    const mm = (map.month || String(now.getMonth() + 1)).padStart(2, '0');
    const dd = (map.day || String(now.getDate())).padStart(2, '0');
    const hhRaw = map.hour === '24' ? '00' : map.hour || '00';
    const hh = hhRaw.padStart(2, '0');
    const min = (map.minute || '00').padStart(2, '0');
    const sec = (map.second || '00').padStart(2, '0');
    const weekdayRaw = (map.weekday || '').toLowerCase();
    const dayOfWeekRu = WEEKDAYS_RU[weekdayRaw] || weekdayRaw || 'сегодня';

    const isoDate = `${yyyy}-${mm}-${dd}`;
    const timeHHMM = `${hh}:${min}`;
    const timeHHMMSS = `${hh}:${min}:${sec}`;
    const dateFormattedRu = `${dd}.${mm}.${yyyy}`;

    const longDateFormatter = new Intl.DateTimeFormat('ru-RU', {
      timeZone: SYZRAN_TIMEZONE,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const dateLongRu = longDateFormatter.format(now);

    const sourceNoteRu = isSystemClockSane
      ? 'Системное время устройства, преобразованное в часовой пояс Europe/Samara (Сызрань)'
      : 'Внимание: системные часы устройства показывают нестандартную дату; проверьте настройку часов ОС';

    const fullLabelRu = `${timeHHMM}, ${dateLongRu} (${dayOfWeekRu}), Сызрань (Europe/Samara)`;

    return {
      systemDate: now,
      timestampMs,
      isoDate,
      timeHHMM,
      time24: timeHHMM,
      timeHHMMSS,
      dayOfWeekRu,
      dateFormattedRu,
      dateShortRu: dateFormattedRu,
      dateLongRu,
      dateRu: dateLongRu,
      fullLabelRu,
      hour: Number(hh),
      minute: Number(min),
      second: Number(sec),
      year: Number(yyyy),
      month: Number(mm),
      day: Number(dd),
      isSystemClockSane,
      sourceNoteRu,
    };
  } catch {
    // На случай повреждения Intl в окружении — честный фоллбэк с предупреждением
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const sec = String(now.getSeconds()).padStart(2, '0');
    const isoDate = `${yyyy}-${mm}-${dd}`;
    const timeHHMM = `${hh}:${min}`;
    const timeHHMMSS = `${hh}:${min}:${sec}`;
    const dateFormattedRu = `${dd}.${mm}.${yyyy}`;

    return {
      systemDate: now,
      timestampMs,
      isoDate,
      timeHHMM,
      time24: timeHHMM,
      timeHHMMSS,
      dayOfWeekRu: '',
      dateFormattedRu,
      dateShortRu: dateFormattedRu,
      dateLongRu: dateFormattedRu,
      dateRu: dateFormattedRu,
      fullLabelRu: `${timeHHMM}, ${dateFormattedRu} (источник часового пояса не подтверждён)`,
      hour: Number(hh),
      minute: Number(min),
      second: Number(sec),
      year: Number(yyyy),
      month: Number(mm),
      day: Number(dd),
      isSystemClockSane: false,
      sourceNoteRu:
        'Не удалось применить базу часовых поясов IANA Europe/Samara; показано локальное системное время устройства',
    };
  }
}

/**
 * Возвращает YYYY-MM-DD в часовом поясе Europe/Samara (Сызрань).
 */
export function toSyzranIsoDate(date?: Date): string {
  return getSyzranNow(date).isoDate;
}

/**
 * Возвращает ЧЧ:ММ в часовом поясе Europe/Samara (Сызрань).
 */
export function formatSyzranTimeNow(date?: Date): string {
  return getSyzranNow(date).timeHHMM;
}

/**
 * Возвращает ДД.ММ.ГГГГ, ЧЧ:ММ в часовом поясе Europe/Samara (Сызрань).
 */
export function formatSyzranDateTimeShort(date?: Date): string {
  const snap = getSyzranNow(date);
  return `${snap.dateFormattedRu}, ${snap.timeHHMM}`;
}

/**
 * Прибавляет указанное число дней к дате YYYY-MM-DD (календарно, без сбоев на переходах суток).
 */
export function addDaysToIsoDate(baseIsoDate: string, daysToAdd: number): string {
  const parts = (baseIsoDate || toSyzranIsoDate()).split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    return toSyzranIsoDate();
  }
  const utcNoon = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  utcNoon.setUTCDate(utcNoon.getUTCDate() + daysToAdd);
  const yyyy = utcNoon.getUTCFullYear();
  const mm = String(utcNoon.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utcNoon.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Форматирует YYYY-MM-DD относительно сегодняшнего дня в Сызрани (Europe/Samara).
 */
export function formatSyzranIsoDateRu(isoDate?: string): string {
  if (!isoDate) return 'Без срока';
  const todayIso = toSyzranIsoDate();
  const tomorrowIso = addDaysToIsoDate(todayIso, 1);
  const dayAfterTomorrowIso = addDaysToIsoDate(todayIso, 2);
  const yesterdayIso = addDaysToIsoDate(todayIso, -1);

  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const formatted = `${parts[2]}.${parts[1]}.${parts[0]}`;

  if (isoDate === todayIso) return `Сегодня (${formatted})`;
  if (isoDate === tomorrowIso) return `Завтра (${formatted})`;
  if (isoDate === dayAfterTomorrowIso) return `Послезавтра (${formatted})`;
  if (isoDate === yesterdayIso) return `Вчера (${formatted})`;
  return formatted;
}

/**
 * Проверяет, спрашивает ли Анна текущее время, дату или день недели.
 */
export function isSyzranTimeQuestion(rawText: string): boolean {
  const lower = (rawText || '').trim().toLowerCase();
  if (!lower || lower.length > 90) return false;

  return (
    /(?:^|[^а-яёa-z0-9])(?:сколько\s+сейчас\s+времени|сколько\s+времени|который\s+час|подскажи\s+время|скажи\s+время|какое\s+сегодня\s+число|какая\s+сегодня\s+дата|какой\s+сегодня\s+день(?:\s+недели)?|время\s+в\s+сызрани|сколько\s+время)(?=$|[^а-яёa-z0-9])/i.test(
      lower
    )
  );
}

/**
 * Формирует точный, достоверный ответ Пикселя о текущем времени и дате в Сызрани.
 */
export function buildSyzranTimeResponse(): string {
  const snap = getSyzranNow();
  if (!snap.isSystemClockSane) {
    return [
      `Анна, по системным часам вашего устройства сейчас **${snap.timeHHMM}** (${snap.dateFormattedRu}), однако источник системного времени вызывает сомнения: *${snap.sourceNoteRu}*.`,
      `Рекомендую проверить синхронизацию времени в операционной системе.`,
    ].join('\n\n');
  }

  return [
    `Анна, сейчас в **Сызрани** (Самарская область, часовой пояс \`Europe/Samara\`):`,
    `• **Точное время:** ${snap.timeHHMM} (${snap.timeHHMMSS})`,
    `• **Дата:** ${snap.dateLongRu} (${snap.dateFormattedRu})`,
    `• **День недели:** ${snap.dayOfWeekRu}`,
  ].join('\n');
}
