/**
 * Types and interfaces for Anna's Long-Term Personal Memory in Pixel Companion.
 * Stored in %APPDATA%/kiberone-renderia-assistant/PixelData/Anna/ in Electron,
 * and in IndexedDB (anna_long_term_memory_v1) in web preview.
 */

export type AnnaMemoryCategory =
  | 'confirmed_fact' // Подтверждённые факты (Анна прямо рассказала о себе)
  | 'preference'     // Предпочтения (то, что ей нравится или не нравится)
  | 'work_context'   // Рабочий контекст (проекты, обязанности, цели)
  | 'observation'    // Наблюдения (осторожные предположения / гипотезы)
  | 'temporary_note';// Временные сведения (текущие планы, которые могут устареть)

export type AnnaMemoryStatus =
  | 'confirmed'         // Подтверждено Анной
  | 'confirmed_fact'    // Совместимость с UI статусом проверенного факта
  | 'hypothesis'        // Рабочая гипотеза Пикселя
  | 'observation'       // Наблюдение (требует проверки)
  | 'temporary_note'    // Черновик / временная заметка
  | 'needs_verification'; // Требует деликатного уточнения в диалоге

export interface AnnaMemoryItem {
  id: string;
  title?: string;
  category: AnnaMemoryCategory;
  content: string;
  status: AnnaMemoryStatus;
  confidence: number; // 0.0 - 1.0
  sourceContext?: string; // e.g. "Разговор в чате от 01.11.2026"
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt?: string;
  tags?: string[];
}

export interface AnnaProfile {
  name: string;
  preferredName: string;
  role: string;
  schools?: string[];
  background?: string;
  backgroundVerification?: string;
  backgroundSummary: string;
  psychologicalBackground: string;
  communicationStyle: string;
  communicationTone?: string;
  updatedAt: string;
}

export interface AnnaInterest {
  id: string;
  topic: string;
  description: string;
  addedAt: string;
}

export interface AnnaPreference {
  id: string;
  category: 'visual' | 'speech' | 'work' | 'colors' | 'lifestyle';
  description: string;
  status: AnnaMemoryStatus;
  addedAt: string;
}

export interface AnnaProjectContext {
  id: string;
  schoolId: 'kiberone' | 'renderia' | 'both';
  name: string;
  description: string;
  status: 'active' | 'planning' | 'completed';
  updatedAt: string;
}

export interface AnnaMemoryBundle {
  profile: AnnaProfile;
  interests: AnnaInterest[];
  preferences: AnnaPreference[];
  projects: AnnaProjectContext[];
  memories: AnnaMemoryItem[];
  storageInfo: {
    isElectron: boolean;
    storagePath: string;
    autoSaveEnabled: boolean;
    lastSavedAt: string;
    version: string;
  };
}

export const INITIAL_ANNA_PROFILE: AnnaProfile = {
  name: 'Анна',
  preferredName: 'Анна',
  role: 'Управляющая кибершколами KIBERone и Renderia',
  schools: ['KIBERone', 'Renderia'],
  background: 'Высшее образование детского психолога',
  backgroundVerification: 'Подтверждено в диалоге',
  backgroundSummary: 'Чуткий, тёплый и ответственный руководитель. Бережно относится к детям и образовательному процессу.',
  psychologicalBackground: 'Высшее образование детского психолога (чуткое понимание возрастной психологии и бережный контакт с учениками и родителями)',
  communicationStyle: 'Спокойный, уважительный, тёплый, поддерживающий диалог без фамильярности и без сухого корпоративного тона',
  communicationTone: 'Спокойный, тёплый, поддерживающий',
  updatedAt: new Date().toISOString(),
};

export const INITIAL_ANNA_PREFERENCES: AnnaPreference[] = [
  {
    id: 'pref-colors',
    category: 'colors',
    description: 'Светлые, нежные пастельные оттенки: светло-розовый, нежно-голубой, молочный, мягкая лаванда',
    status: 'confirmed',
    addedAt: new Date().toISOString(),
  },
  {
    id: 'pref-visual',
    category: 'visual',
    description: 'Мягкий, эстетичный, воздушный стиль без агрессивных неоновых цветов и тяжёлых теней',
    status: 'confirmed',
    addedAt: new Date().toISOString(),
  },
  {
    id: 'pref-work',
    category: 'work',
    description: 'Комфортный размеренный рабочий ритм, поддержка при усталости, аккуратные сводки задач',
    status: 'confirmed',
    addedAt: new Date().toISOString(),
  },
];

export const INITIAL_ANNA_INTERESTS: AnnaInterest[] = [
  {
    id: 'int-child-dev',
    topic: 'Детская психология и гармоничное развитие',
    description: 'Интерес к бережным и развивающим методикам раскрытия талантов детей в цифровых технологиях',
    addedAt: new Date().toISOString(),
  },
  {
    id: 'int-creative-tech',
    topic: 'Творческое образование и дизайн',
    description: 'Развитие школ KIBERone и Renderia как уютного и вдохновляющего пространства для детей',
    addedAt: new Date().toISOString(),
  },
];

export const INITIAL_ANNA_MEMORIES: AnnaMemoryItem[] = [
  {
    id: 'mem-creator-kristina',
    title: 'Создатель Пикселя — Кристина',
    category: 'confirmed_fact',
    content: 'Пикселя создала Кристина с любовью для Анны. Анна — главный пользователь приложения и управляющая двух школ (KIBERone и Renderia). Пиксель знает Анну лично, преданно помогает ей во всех рабочих и повседневных делах и никогда не знакомится заново.',
    status: 'confirmed',
    confidence: 1.0,
    sourceContext: 'Основа создания Пикселя',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'mem-pixel-role-and-mission',
    title: 'Роль и назначение Пикселя',
    category: 'work_context',
    content: 'Пиксель — надёжный напарник, цифровой помощник и компаньон Анны. Он помогает управлять рабочими процессами школ KIBERone и Renderia, координировать задачи со специалистами (Маркетолог, Менеджер, Методист, Аналитик), работать с документами, информацией и идеями, бережно поддерживая Анну в сложных ситуациях без подмены профессионального психолога.',
    status: 'confirmed',
    confidence: 1.0,
    sourceContext: 'Миссия и назначение Пикселя',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'mem-warm-character',
    title: 'Чуткий характер и теплота',
    category: 'confirmed_fact',
    content: 'Анна — тёплый, деликатный и чуткий человек, с душой относящийся к детям и своей работе.',
    status: 'confirmed',
    confidence: 1.0,
    sourceContext: 'Первичное знакомство',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'mem-psych-degree',
    title: 'Психологическое образование',
    category: 'observation',
    content: 'Имеет психологическое образование (детский психолог). В беседах проявляет понимание детской мотивации.',
    status: 'needs_verification',
    confidence: 0.85,
    sourceContext: 'Первичное знакомство — гипотеза для деликатного уточнения',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'mem-pastel-palette',
    title: 'Пастельная цветовая палитра',
    category: 'preference',
    content: 'Предпочитает светлые пастельные тона (розовый, небесно-голубой, молочный, лавандовый) в визуальных решениях.',
    status: 'confirmed',
    confidence: 0.98,
    sourceContext: 'Пожелания по стилю оформления',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'mem-kiber-renderia',
    title: 'Руководство двумя школами',
    category: 'work_context',
    content: 'Руководит направлениями двух школ: кибершколы KIBERone и школы креативных индустрий Renderia.',
    status: 'confirmed',
    confidence: 1.0,
    sourceContext: 'Рабочий контекст',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];
