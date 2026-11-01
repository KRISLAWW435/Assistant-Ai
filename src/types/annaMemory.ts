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
  | 'hypothesis'        // Рабочая гипотеза Пикселя
  | 'needs_verification'; // Требует деликатного уточнения в диалоге

export interface AnnaMemoryItem {
  id: string;
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
  backgroundSummary: string;
  psychologicalBackground: string;
  communicationStyle: string;
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
  backgroundSummary: 'Чуткий, тёплый и ответственный руководитель. Бережно относится к детям и образовательному процессу.',
  psychologicalBackground: 'Высшее образование детского психолога (чуткое понимание возрастной психологии и бережный контакт с учениками и родителями)',
  communicationStyle: 'Спокойный, уважительный, тёплый, поддерживающий диалог без фамильярности и без сухого корпоративного тона',
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
    id: 'mem-warm-character',
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
    category: 'work_context',
    content: 'Руководит направлениями двух школ: кибершколы KIBERone и школы креативных индустрий Renderia.',
    status: 'confirmed',
    confidence: 1.0,
    sourceContext: 'Рабочий контекст',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];
