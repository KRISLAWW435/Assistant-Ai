import {
  parseRelativeDateAndTimeFromRuText,
  cleanExtractedTaskTitle,
  parseAndExecuteTaskCommand,
} from '../src/utils/pixelTaskManagerEngine';
import { getSyzranNow } from '../src/utils/syzranTime';

console.log('--- ЗАПУСК ТЕСТОВ РАСПОЗНАВАНИЯ ДАТ В PIXEL TASK MANAGER ---\n');

const syzranNow = getSyzranNow();
const todayIso = '2026-11-03'; // Фиксированная дата в Сызрани для воспроизводимости тестов (3 ноября 2026)
console.log(`Базовая дата теста в часовом поясе Europe/Samara: ${todayIso} (текущий год: 2026)\n`);

interface TestCase {
  name: string;
  input: string;
  validate: (result: ReturnType<typeof parseRelativeDateAndTimeFromRuText>) => { ok: boolean; reason?: string };
}

const testCases: TestCase[] = [
  {
    name: '1. «Добавь задачу на 4 ноября»',
    input: 'Добавь задачу на 4 ноября',
    validate: (res) => {
      if (res.dueDate !== '2026-11-04') {
        return { ok: false, reason: `Ожидалась дата 2026-11-04, получено: '${res.dueDate}'` };
      }
      if (res.isDateAmbiguous) {
        return { ok: false, reason: 'Дата не должна быть неоднозначной' };
      }
      if (!res.dateLabelRu.includes('4 ноября')) {
        return { ok: false, reason: `Лейбл должен содержать '4 ноября', получено: '${res.dateLabelRu}'` };
      }
      return { ok: true };
    },
  },
  {
    name: '2. «Напомни мне 15 декабря в 15:00»',
    input: 'Напомни мне 15 декабря в 15:00',
    validate: (res) => {
      if (res.dueDate !== '2026-12-15') {
        return { ok: false, reason: `Ожидалась дата 2026-12-15, получено: '${res.dueDate}'` };
      }
      if (res.dueTime !== '15:00') {
        return { ok: false, reason: `Ожидалось время 15:00, получено: '${res.dueTime}'` };
      }
      if (res.isDateAmbiguous) {
        return { ok: false, reason: 'Дата не должна быть неоднозначной' };
      }
      return { ok: true };
    },
  },
  {
    name: '3. «Запланируй на 1 мая» (дата без года в прошлом относительно 3 ноября 2026)',
    input: 'Запланируй на 1 мая',
    validate: (res) => {
      if (res.dueDate !== '') {
        return { ok: false, reason: `Дата без года из прошлого не должна подставляться автоматически (ожидалась пустая строка), получено: '${res.dueDate}'` };
      }
      if (!res.isDateAmbiguous) {
        return { ok: false, reason: 'Должен быть выставлен флаг isDateAmbiguous: true' };
      }
      if (!res.ambiguityPromptRu || !res.ambiguityPromptRu.includes('уже прошло')) {
        return { ok: false, reason: `ambiguityPromptRu должен содержать пояснение о прошедшей дате, получено: '${res.ambiguityPromptRu}'` };
      }
      return { ok: true };
    },
  },
  {
    name: '4. «На сегодня, на среду» (противоречивые указания дат в одной фразе)',
    input: 'На сегодня, на среду',
    validate: (res) => {
      if (res.dueDate !== '') {
        return { ok: false, reason: `При несовпадающих датах dueDate не должен заполняться, получено: '${res.dueDate}'` };
      }
      if (!res.isDateAmbiguous) {
        return { ok: false, reason: 'Должен быть выставлен флаг isDateAmbiguous: true' };
      }
      if (!res.ambiguityPromptRu || !res.ambiguityPromptRu.includes('несколько разных дат')) {
        return { ok: false, reason: `Запрос уточнения должен указывать на конфликт дат, получено: '${res.ambiguityPromptRu}'` };
      }
      return { ok: true };
    },
  },
  {
    name: '5. «На 4 ноября 2027 года» (явное указание будущего года)',
    input: 'На 4 ноября 2027 года',
    validate: (res) => {
      if (res.dueDate !== '2027-11-04') {
        return { ok: false, reason: `Ожидалась дата 2027-11-04, получено: '${res.dueDate}'` };
      }
      if (res.isDateAmbiguous) {
        return { ok: false, reason: 'Дата с явным годом не должна быть неоднозначной' };
      }
      if (!res.dateLabelRu.includes('2027')) {
        return { ok: false, reason: `Лейбл должен содержать 2027 год, получено: '${res.dateLabelRu}'` };
      }
      return { ok: true };
    },
  },
  {
    name: '6. «На 35 ноября» (некорректное число дней в месяце)',
    input: 'На 35 ноября',
    validate: (res) => {
      if (res.dueDate !== '') {
        return { ok: false, reason: `Некорректная дата не должна сохраняться как dueDate, получено: '${res.dueDate}'` };
      }
      if (!res.isDateAmbiguous) {
        return { ok: false, reason: 'Некорректная дата должна возвращать isDateAmbiguous: true' };
      }
      if (!res.ambiguityPromptRu || !res.ambiguityPromptRu.includes('не может быть 35')) {
        return { ok: false, reason: `Должно быть пояснение про невозможность 35 дней, получено: '${res.ambiguityPromptRu}'` };
      }
      return { ok: true };
    },
  },
  {
    name: '7. «На неизвестную дату» (неопределённый запрос даты)',
    input: 'На неизвестную дату',
    validate: (res) => {
      if (res.dueDate !== '') {
        return { ok: false, reason: `Для неизвестной даты dueDate должен быть пустым (без автоподстановки todayIso), получено: '${res.dueDate}'` };
      }
      if (!res.isDateAmbiguous) {
        return { ok: false, reason: 'Должен быть выставлен флаг isDateAmbiguous: true' };
      }
      if (!res.ambiguityPromptRu) {
        return { ok: false, reason: 'Должен быть текст запроса уточнения у Анны' };
      }
      return { ok: true };
    },
  },
];

let allPassed = true;

for (const tc of testCases) {
  const result = parseRelativeDateAndTimeFromRuText(tc.input, todayIso);
  const check = tc.validate(result);
  if (check.ok) {
    console.log(`✅ [ПРОЙДЕН] ${tc.name}`);
    console.log(`   Результат: dueDate='${result.dueDate}', time='${result.dueTime || '—'}', ambiguous=${result.isDateAmbiguous || false}`);
    if (result.ambiguityPromptRu) {
      console.log(`   Вопрос для Анны: «${result.ambiguityPromptRu}»`);
    }
  } else {
    allPassed = false;
    console.error(`❌ [ОШИБКА] ${tc.name}`);
    console.error(`   Причина: ${check.reason}`);
    console.error(`   Фактический вывод:`, result);
  }
  console.log('');
}

// Тест интеграции сквозной команды создания задачи
console.log('--- ТЕСТ СКВОЗНОЙ КОМАНДЫ ПИКСЕЛЯ ---');
const cmd1 = parseAndExecuteTaskCommand('Пиксель, добавь задачу на 4 ноября подготовить отчёт по школам', 'kiberone', []);
console.log('Команда: «Пиксель, добавь задачу на 4 ноября подготовить отчёт по школам»');
console.log(`- Создана задача: «${cmd1?.createdTask?.title}»`);
console.log(`- Дата: ${cmd1?.createdTask?.dueDate}`);
console.log(`- Школа: ${cmd1?.createdTask?.schoolId}`);
if (cmd1?.createdTask?.dueDate === '2026-11-04' && cmd1?.createdTask?.title === 'Подготовить отчёт по школам') {
  console.log('✅ Сквозная команда на 4 ноября отработала корректно!\n');
} else {
  console.error('❌ Ошибка в сквозной команде:', cmd1);
  allPassed = false;
}

const cmd2 = parseAndExecuteTaskCommand('Пиксель, добавь задачу на сегодня, на среду обновить прайс', 'kiberone', []);
console.log('Команда: «Пиксель, добавь задачу на сегодня, на среду обновить прайс»');
console.log(`- ambiguityBlock в ответе:`, cmd2?.responseText.includes('Уточните дату/время'));
if (cmd2?.responseText.includes('Уточните дату/время') && !cmd2?.createdTask?.dueDate) {
  console.log('✅ Противоречивые даты вызвали запрос уточнения у Анны без автоподстановки!\n');
} else {
  console.error('❌ Ошибка при противоречивых датах:', cmd2);
  allPassed = false;
}

if (!allPassed) {
  process.exit(1);
} else {
  console.log('🎉 Все тесты успешно пройдены!');
}
