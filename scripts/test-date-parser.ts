import {
  parseRelativeDateAndTimeFromRuText,
  cleanExtractedTaskTitle,
  parseAndExecuteTaskCommand,
  initPersonalTaskDraft,
  processPersonalTaskDraftInput,
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

// Тест сквозной команды Пикселя и диалога создания задач
console.log('--- ТЕСТ СКВОЗНОЙ КОМАНДЫ И ДИАЛОГА СОЗДАНИЯ ЗАДАЧ ---');
const cmd1 = parseAndExecuteTaskCommand(
  'Пиксель, добавь задачу на 4 ноября в 15:00 подготовить отчёт по школам',
  'kiberone',
  []
);
console.log('Команда: «Пиксель, добавь задачу на 4 ноября в 15:00 подготовить отчёт по школам»');
console.log(`- Создана ли задача сразу в БД: ${cmd1?.createdTask ? 'ДА (ОШИБКА)' : 'НЕТ (ВЕРНО: ожидает уточнения и подтверждения)'}`);
console.log(`- Черновик: «${cmd1?.personalTaskDraft?.title}»`);
console.log(`- Дата выполнения (dueDate): ${cmd1?.personalTaskDraft?.dueDate}`);
console.log(`- Время выполнения (dueTime): ${cmd1?.personalTaskDraft?.dueTime}`);
console.log(`- Школа (schoolId): ${cmd1?.personalTaskDraft?.schoolId}`);
console.log(`- Шаг диалога: ${cmd1?.personalTaskDraft?.step}`);

if (
  !cmd1?.createdTask &&
  cmd1?.personalTaskDraft?.dueDate === '2026-11-04' &&
  cmd1?.personalTaskDraft?.dueTime === '15:00' &&
  cmd1?.personalTaskDraft?.title === 'Подготовить отчёт по школам' &&
  cmd1?.personalTaskDraft?.step === 'clarifying_priority'
) {
  console.log('✅ Задача переведена в черновик, dueDate и dueTime заполнены, Пиксель запросил приоритет без несогласованного сохранения в базе!\n');
} else {
  console.error('❌ Ошибка в инициализации черновика задачи:', cmd1);
  allPassed = false;
}

// Тест шага 2: уточнение приоритета
console.log('Шаг 2: Анна отвечает на вопрос о приоритете («Обычный»)...');
const step2 = processPersonalTaskDraftInput(cmd1!.personalTaskDraft!, 'Обычный', todayIso);
console.log(`- Приоритет в черновике: ${step2.draft.priority}`);
console.log(`- Следующий шаг: ${step2.draft.step}`);
console.log(`- Вопрос Пикселя: ${step2.responseRu}`);

if (step2.draft.priority === 'low' && step2.draft.step === 'clarifying_reminder') {
  console.log('✅ Приоритет «обычный» сохранён, Пиксель запросил дату и время напоминания!\n');
} else {
  console.error('❌ Ошибка на шаге уточнения приоритета:', step2);
  allPassed = false;
}

// Тест шага 3: указание времени напоминания отдельно от времени выполнения
console.log('Шаг 3: Анна задаёт напоминание («Напомни 4 ноября в 14:00»)...');
const step3 = processPersonalTaskDraftInput(step2.draft, 'Напомни 4 ноября в 14:00', todayIso);
console.log(`- Время выполнения события (dueTime): ${step3.draft.dueTime}`);
console.log(`- Дата напоминания (reminderDate): ${step3.draft.reminderDate}`);
console.log(`- Время напоминания (reminderTime): ${step3.draft.reminderTime}`);
console.log(`- reminderAt ISO: ${step3.draft.reminderAt}`);
console.log(`- Следующий шаг: ${step3.draft.step}`);

if (
  step3.draft.dueTime === '15:00' &&
  step3.draft.reminderTime === '14:00' &&
  step3.draft.reminderDate === '2026-11-04' &&
  step3.draft.step === 'ready_for_confirmation' &&
  step3.responseRu.includes('Подтверждение создания задачи')
) {
  console.log('✅ Время выполнения (15:00) и время напоминания (14:00) сохранены отдельно! Показана итоговая карточка.\n');
} else {
  console.error('❌ Ошибка на шаге настройки напоминания:', step3);
  allPassed = false;
}

// Тест шага 4: подтверждение создания задачи Анной («Да, создавай»)
console.log('Шаг 4: Анна подтверждает создание («Создавай»)...');
const step4 = processPersonalTaskDraftInput(step3.draft, 'Создавай', todayIso);
console.log(`- Статус действия: ${step4.action}`);
console.log(`- Созданная задача title: ${step4.readyTask?.title}`);
console.log(`- Созданная задача dueDate: ${step4.readyTask?.dueDate}`);
console.log(`- Созданная задача dueTime: ${step4.readyTask?.dueTime}`);
console.log(`- Созданная задача priority: ${step4.readyTask?.priority}`);
console.log(`- Созданная задача reminderAt: ${step4.readyTask?.reminderAt}`);
console.log(`- Уведомление о доставке напоминания: ${step4.responseRu.includes('Напоминание установлено')}`);

if (
  step4.action === 'confirmed' &&
  step4.readyTask?.title === 'Подготовить отчёт по школам' &&
  step4.readyTask?.dueDate === '2026-11-04' &&
  step4.readyTask?.dueTime === '15:00' &&
  step4.readyTask?.priority === 'low' &&
  step4.readyTask?.reminderAt &&
  step4.responseRu.includes('Напоминание установлено')
) {
  console.log('✅ Задача подтверждена и подготовлена к сохранению в IndexedDB со всеми 7 полями!\n');
} else {
  console.error('❌ Ошибка при подтверждении задачи:', step4);
  allPassed = false;
}

// Тест: если пользователь сразу назвал все параметры, повторные вопросы не задаются
console.log('Тест: полное первичное указание («Добавь срочную задачу провести вебинар на 4 ноября в 18:00 без напоминания»)...');
const fullCmd = initPersonalTaskDraft(
  'Добавь срочную задачу провести вебинар на 4 ноября в 18:00 без напоминания',
  'renderia',
  todayIso
);
console.log(`- Шаг: ${fullCmd.draft.step}`);
console.log(`- Приоритет: ${fullCmd.draft.priority}`);
console.log(`- dueTime: ${fullCmd.draft.dueTime}`);
console.log(`- wantsReminder: ${fullCmd.draft.wantsReminder}`);

if (
  fullCmd.draft.step === 'ready_for_confirmation' &&
  fullCmd.draft.priority === 'high' &&
  fullCmd.draft.dueTime === '18:00' &&
  fullCmd.draft.wantsReminder === false
) {
  console.log('✅ Известные поля повторно не запрашиваются — сразу показана карточка подтверждения!\n');
} else {
  console.error('❌ Ошибка при первичном заполнении всех полей:', fullCmd);
  allPassed = false;
}

// Тест противоречивых дат
const cmd2 = parseAndExecuteTaskCommand('Пиксель, добавь задачу на сегодня, на среду обновить прайс', 'kiberone', []);
console.log('Команда: «Пиксель, добавь задачу на сегодня, на среду обновить прайс»');
console.log(`- Шаг черновика: ${cmd2?.personalTaskDraft?.step}`);
console.log(`- ambiguityPrompt в ответе:`, cmd2?.responseText.includes('разных дат') || cmd2?.responseText.includes('Уточните'));
if (
  (cmd2?.responseText.includes('разных дат') || cmd2?.responseText.includes('Уточните')) &&
  !cmd2?.createdTask?.dueDate &&
  cmd2?.personalTaskDraft?.step === 'clarifying_date'
) {
  console.log('✅ Противоречивые даты вызвали запрос уточнения даты у Анны без автоподстановки!\n');
} else {
  console.error('❌ Ошибка при противоречивых датах:', cmd2);
  allPassed = false;
}

if (!allPassed) {
  process.exit(1);
} else {
  console.log('🎉 Все тесты парсера и сценария создания задач успешно пройдены!');
}
