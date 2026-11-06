import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowRight,
  BarChart3,
  BookOpen,
  Calendar,
  Check,
  CheckSquare,
  Clock,
  ExternalLink,
  GraduationCap,
  Heart,
  Megaphone,
  MessageSquare,
  MessageSquareHeart,
  Palette,
  Pin,
  Plus,
  Settings,
  Sparkles,
} from 'lucide-react';
import {
  AgentMode,
  ChatSession,
  CompanionTaskRecord,
  KnowledgeBaseBySchool,
  NavSection,
  SchoolId,
} from '../types/assistant';
import {
  AGENT_MODES,
  KNOWLEDGE_CATEGORIES,
  SCHOOLS,
} from '../config/schoolsAndModes';
import { getDailyLetterForToday } from '../data/dailyLetters';
import { getDynamicGreeting } from '../data/dailyGreetings';
import {
  formatSyzranIsoDateRu,
  getSyzranNow,
} from '../utils/syzranTime';

interface HomeViewProps {
  activeSchool: SchoolId;
  onSelectSchool: (school: SchoolId) => void;
  onNavigate: (section: NavSection) => void;
  onOpenSession: (session: ChatSession) => void;
  onStartNewChat: () => void;
  sessions: ChatSession[];
  knowledgeBase: KnowledgeBaseBySchool;
  tasks?: CompanionTaskRecord[];
  onSaveTask?: (task: CompanionTaskRecord) => Promise<void> | Promise<boolean> | void;
  onOpenSpecialistChat?: (mode: AgentMode, schoolId: SchoolId) => void;
}

const SPECIALIST_CONFIGS: {
  id: AgentMode;
  title: string;
  shortSubtitle: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string;
  cardBg: string;
  cardBorder: string;
  badgeBg: string;
}[] = [
  {
    id: 'marketer',
    title: 'Маркетолог',
    shortSubtitle: 'VK, реклама и видео',
    description: 'Посты для соцсетей, контент-планы, рекламные офферы и сценарии роликов.',
    icon: Megaphone,
    accentColor: '#F59E0B',
    cardBg: 'bg-gradient-to-br from-white via-amber-50/60 to-amber-100/30',
    cardBorder: 'border-amber-200/80 hover:border-amber-300',
    badgeBg: 'bg-amber-100 text-amber-800 border border-amber-200',
  },
  {
    id: 'manager',
    title: 'Менеджер',
    shortSubtitle: 'Клиенты и продажи',
    description: 'Скрипты общения с родителями, отработка сомнений и запись на пробные уроки.',
    icon: MessageSquareHeart,
    accentColor: '#E11D48',
    cardBg: 'bg-gradient-to-br from-white via-rose-50/60 to-rose-100/30',
    cardBorder: 'border-rose-200/80 hover:border-rose-300',
    badgeBg: 'bg-rose-100 text-rose-800 border border-rose-200',
  },
  {
    id: 'methodist',
    title: 'Методист',
    shortSubtitle: 'Уроки и программы',
    description: 'Учебные модули, сценарии мастер-классов и адаптация материалов под возраст.',
    icon: GraduationCap,
    accentColor: '#8B5CF6',
    cardBg: 'bg-gradient-to-br from-white via-purple-50/60 to-purple-100/30',
    cardBorder: 'border-purple-200/80 hover:border-purple-300',
    badgeBg: 'bg-purple-100 text-purple-800 border border-purple-200',
  },
  {
    id: 'analyst',
    title: 'Аналитик',
    shortSubtitle: 'Метрики и воронка',
    description: 'Анализ конверсий, стоимости лида, динамики групп и причин оттока.',
    icon: BarChart3,
    accentColor: '#2563EB',
    cardBg: 'bg-gradient-to-br from-white via-blue-50/60 to-blue-100/30',
    cardBorder: 'border-blue-200/80 hover:border-blue-300',
    badgeBg: 'bg-blue-100 text-blue-800 border border-blue-200',
  },
  {
    id: 'designer',
    title: 'Дизайнер',
    shortSubtitle: 'Визуалы и баннеры',
    description: 'Идеи креативов, концепции оформления постов, баннеры и фирменные стили.',
    icon: Palette,
    accentColor: '#10B981',
    cardBg: 'bg-gradient-to-br from-white via-emerald-50/60 to-emerald-100/30',
    cardBorder: 'border-emerald-200/80 hover:border-emerald-300',
    badgeBg: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  },
];

export const HomeView: React.FC<HomeViewProps> = ({
  activeSchool,
  onSelectSchool,
  onNavigate,
  onOpenSession,
  onStartNewChat,
  sessions,
  knowledgeBase,
  tasks = [],
  onSaveTask,
  onOpenSpecialistChat,
}) => {
  const currentSchool = SCHOOLS[activeSchool];
  const syzranTime = useMemo(() => getSyzranNow(), []);

  // ============================================================================
  // ПИСЬМО ДНЯ: логика выбора фразы (365 дней) и сохранение состояния открытия
  // ============================================================================
  const todayDateKey = syzranTime.isoDate; // YYYY-MM-DD
  const storageLetterKey = `kiber_daily_letter_opened_${todayDateKey}`;

  const [dailyLetter, setDailyLetter] = useState<{
    text: string;
    dayIndex: number;
    totalCount: number;
  }>(() => getDailyLetterForToday());

  const [isLetterOpened, setIsLetterOpened] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(storageLetterKey) === 'true';
    } catch {
      return false;
    }
  });

  const [isOpeningAnimating, setIsOpeningAnimating] = useState(false);

  useEffect(() => {
    // Получаем и логируем выбор фразы при монтировании
    const selected = getDailyLetterForToday();
    setDailyLetter(selected);
  }, []);

  const handleOpenEnvelope = () => {
    if (isLetterOpened) return;
    setIsOpeningAnimating(true);
    setTimeout(() => {
      setIsLetterOpened(true);
      setIsOpeningAnimating(false);
      try {
        window.localStorage.setItem(storageLetterKey, 'true');
      } catch {
        // ignore storage error
      }
    }, 250);
  };

  const handleToggleLetterFold = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsLetterOpened((prev) => !prev);
  };

  // ============================================================================
  // МОИ ЗАДАЧИ НА СЕГОДНЯ: первые 3-5 невыполненных задач из базы
  // ============================================================================
  const pendingTasks = useMemo(() => {
    return tasks
      .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
      .slice(0, 5);
  }, [tasks]);

  const handleQuickToggleTask = async (task: CompanionTaskRecord) => {
    if (!onSaveTask) return;
    const isCompleted = task.status === 'done';
    const nextStatus = isCompleted ? 'new' : 'done';
    await onSaveTask({
      ...task,
      status: nextStatus,
      completedAt: isCompleted ? undefined : syzranTime.timeHHMM,
      completedAtMs: isCompleted ? undefined : Date.now(),
    });
  };

  // ============================================================================
  // ПОСЛЕДНИЕ ЧАТЫ: первые 3 диалога
  // ============================================================================
  const recentSessions = useMemo(() => {
    return sessions.slice(0, 3);
  }, [sessions]);

  const handleSpecialistClick = (modeId: AgentMode) => {
    if (onOpenSpecialistChat) {
      onOpenSpecialistChat(modeId, activeSchool);
    } else {
      onNavigate(modeId);
    }
  };

  // Красивая капитализация даты: "Пятница, 6 ноября 2026 г."
  const formattedDateTitle = useMemo(() => {
    const raw = `${syzranTime.dayOfWeekRu}, ${syzranTime.dateLongRu}`;
    if (!raw) return 'Сегодня';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [syzranTime]);

  // Динамическое приветствие для Анны (Europe/Samara)
  const dynamicGreeting = useMemo(() => {
    return getDynamicGreeting(syzranTime);
  }, [syzranTime]);

  return (
    <div className="min-h-full bg-stone-50/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-8 pb-28">
        {/* ====================================================================
            1. ВЕРХНИЙ БЛОК: Приветствие Анны + Компонент «Письмо дня»
           ==================================================================== */}
        <section className="glass-panel rounded-3xl p-6 sm:p-8 border border-slate-200/90 shadow-sm relative overflow-hidden bg-gradient-to-br from-white via-slate-50/70 to-emerald-50/20 lg:min-h-[400px] flex items-center">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center w-full">
            {/* Левая часть: Крупное персональное приветствие */}
            <div className="lg:col-span-7 space-y-3.5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200/80 text-xs font-semibold text-slate-700">
                <Calendar className="w-3.5 h-3.5 text-[#00A8B5]" />
                <span>{formattedDateTitle}</span>
              </div>

              <h1 className="font-display font-extrabold text-2xl sm:text-3xl lg:text-4xl text-slate-800 tracking-tight leading-tight text-balance">
                {dynamicGreeting}
              </h1>

              <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-xl">
                Ваш личный рабочий кабинет для уверенного и гармоничного управления школами{' '}
                <strong className="text-slate-900">KIBERone</strong> и{' '}
                <strong className="text-slate-900">RENDERIA</strong>.
              </p>

              {/* Быстрые действия в пастельных тонах (без кнопки «Новый чат») */}
              <div className="pt-3 flex flex-wrap items-center gap-2.5 sm:gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('tasks')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold bg-sky-100 hover:bg-sky-200 text-sky-900 border border-sky-200/80 transition-colors shadow-2xs cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-sky-700" />
                  <span>Создать задачу</span>
                </button>

                <button
                  type="button"
                  onClick={() => onNavigate('knowledge')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border border-emerald-200/80 transition-colors shadow-2xs cursor-pointer"
                >
                  <BookOpen className="w-4 h-4 text-emerald-700" />
                  <span>Открыть Базу знаний</span>
                </button>
              </div>
            </div>

            {/* Правая часть: Компонент «Письмо дня» в нежно-мятной палитре с фиксированной высотой (без прыжков) */}
            <div className="lg:col-span-5 flex justify-center lg:justify-end">
              <div
                className={`w-full max-w-md h-[310px] rounded-2xl p-5 sm:p-6 transition-all duration-300 relative select-none border border-emerald-200/90 shadow-sm hover:shadow-md flex flex-col justify-between overflow-hidden ${
                  isLetterOpened ? 'bg-emerald-50/90' : 'bg-emerald-50/70'
                }`}
              >
                {!isLetterOpened ? (
                  /* Закрытый нежно-мятный конверт */
                  <div className="flex-1 flex flex-col items-center justify-between transition-all duration-300 ease-out">
                    <div
                      onClick={handleOpenEnvelope}
                      className="relative mx-auto w-48 sm:w-54 h-28 sm:h-32 rounded-2xl bg-gradient-to-b from-emerald-100 via-emerald-200 to-emerald-300/80 border-2 border-emerald-300 shadow-md cursor-pointer hover:scale-[1.02] active:scale-[0.99] transition-transform duration-200 overflow-hidden flex items-center justify-center group"
                    >
                      {/* Линии сгибов конверта */}
                      <svg
                        className="absolute inset-0 w-full h-full pointer-events-none"
                        viewBox="0 0 200 120"
                        preserveAspectRatio="none"
                      >
                        {/* Нижний клапан */}
                        <polygon
                          points="0,120 100,65 200,120"
                          fill="#059669"
                          fillOpacity="0.10"
                        />
                        {/* Боковые сгибы */}
                        <polygon
                          points="0,0 100,65 0,120"
                          fill="#047857"
                          fillOpacity="0.08"
                        />
                        <polygon
                          points="200,0 100,65 200,120"
                          fill="#047857"
                          fillOpacity="0.08"
                        />
                        {/* Верхний закрытый треугольный клапан */}
                        <polygon
                          points="0,0 100,60 200,0"
                          fill="#ECFDF5"
                          stroke="#6EE7B7"
                          strokeWidth="1.5"
                        />
                      </svg>

                      {/* Нежная сургучная печать с сердечком */}
                      <div className="relative z-10 w-11 h-11 rounded-full bg-gradient-to-br from-rose-400 via-rose-500 to-rose-600 border-2 border-white text-white flex items-center justify-center shadow-md group-hover:scale-110 transition-transform">
                        <Heart className="w-5 h-5 fill-white text-white drop-shadow-xs" />
                      </div>
                    </div>

                    {/* Текст под конвертом: призыв к действию */}
                    <p className="text-xs sm:text-sm text-emerald-800 font-medium text-center leading-relaxed px-2 my-1">
                      Откройте, чтобы узнать новое послание для вас 💌
                    </p>

                    <button
                      type="button"
                      onClick={handleOpenEnvelope}
                      disabled={isOpeningAnimating}
                      className="inline-flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl font-display font-extrabold text-xs sm:text-sm text-white bg-emerald-600 hover:bg-emerald-700 transition-all shadow-xs cursor-pointer hover:shadow-md"
                    >
                      <Sparkles className="w-4 h-4 text-emerald-200" />
                      <span>{isOpeningAnimating ? 'Раскрываем послание...' : 'Открыть конверт ✨'}</span>
                    </button>
                  </div>
                ) : (
                  /* Раскрытое письмо внутри фиксированного блока */
                  <div className="h-full flex flex-col justify-between transition-all duration-300 ease-out animate-in fade-in zoom-in-95">
                    <div className="flex items-center justify-between pb-1">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-100 border border-emerald-200 text-emerald-800 text-[10px] font-bold tracking-wide">
                        <Heart className="w-3 h-3 fill-rose-400 text-rose-400" />
                        Вдохновение дня
                      </span>
                      <button
                        type="button"
                        onClick={handleToggleLetterFold}
                        className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 transition-colors cursor-pointer"
                        title="Свернуть конверт"
                      >
                        Свернуть
                      </button>
                    </div>

                    {/* Карточка послания */}
                    <div className="flex-1 flex flex-col justify-center my-2 p-3.5 sm:p-4 rounded-xl bg-white border border-emerald-200 shadow-2xs overflow-y-auto">
                      <p className="font-display font-bold text-sm sm:text-base text-slate-800 leading-relaxed italic text-center">
                        «{dailyLetter.text}»
                      </p>
                    </div>

                    <div className="pt-2 border-t border-emerald-200/60 flex items-center justify-between text-[11px] text-emerald-700">
                      <span>Только для вас, Анна</span>
                      <span>🌸 Улыбнитесь новому дню</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

      {/* ====================================================================
          2. БЛОКИ «МОИ ЗАДАЧИ НА СЕГОДНЯ» И «ПОСЛЕДНИЕ ЧАТЫ»
         ==================================================================== */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Блок «Мои задачи на сегодня» (6 колонок) */}
        <div className="lg:col-span-6 glass-panel rounded-2xl p-5 sm:p-6 border border-rose-200/70 shadow-sm space-y-4 flex flex-col justify-between bg-gradient-to-br from-white via-rose-50/35 to-amber-50/20">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-teal-500/10 text-[#00A8B5] flex items-center justify-center">
                  <CheckSquare className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-display font-bold text-base sm:text-lg text-slate-900">
                    Мои задачи на сегодня
                  </h2>
                  <p className="text-xs text-slate-500">
                    Первые невыполненные дела и поручения
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onNavigate('tasks')}
                className="text-xs font-semibold text-[#00A8B5] hover:text-[#008f9a] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>Все задачи</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Список задач */}
            {pendingTasks.length === 0 ? (
              <div className="rounded-xl p-6 bg-slate-50/80 border border-slate-200/70 text-center space-y-2">
                <Check className="w-8 h-8 text-emerald-500 mx-auto" />
                <div className="text-xs font-bold text-slate-800">
                  Все текущие задачи выполнены!
                </div>
                <p className="text-[11px] text-slate-500">
                  У вас нет горящих дел на сегодня. Отличный повод спланировать новую цель.
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('tasks')}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-[#00A8B5]" />
                  <span>Добавить задачу</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {pendingTasks.map((t) => {
                  const isHigh = t.priority === 'high';
                  const isMed = t.priority === 'medium';
                  const priorityClass = isHigh
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : isMed
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200';
                  const priorityLabel = isHigh
                    ? 'Срочно'
                    : isMed
                      ? 'Важно'
                      : 'Обычная';

                  return (
                    <div
                      key={t.id}
                      className="group p-3 rounded-xl bg-white border border-slate-200/80 hover:border-slate-300 hover:shadow-2xs transition-all flex items-start justify-between gap-3"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <button
                          type="button"
                          onClick={() => handleQuickToggleTask(t)}
                          className="mt-0.5 w-4 h-4 rounded border border-slate-300 group-hover:border-[#00A8B5] flex items-center justify-center bg-white transition-colors cursor-pointer shrink-0"
                          title="Отметить выполненной"
                        >
                          <Check className="w-3 h-3 text-transparent group-hover:text-slate-300 transition-colors" />
                        </button>
                        <div className="min-w-0 space-y-0.5">
                          <div
                            onClick={() => onNavigate('tasks')}
                            className="font-medium text-xs text-slate-900 hover:text-[#00A8B5] truncate cursor-pointer"
                            title={t.title}
                          >
                            {t.title}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono-tabular">
                            <span>{formatSyzranIsoDateRu(t.dueDate)}</span>
                            {t.dueTime && <span>в {t.dueTime}</span>}
                          </div>
                        </div>
                      </div>

                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${priorityClass}`}
                      >
                        {priorityLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>
              Невыполненных дел: <strong className="text-slate-800">{pendingTasks.length}</strong>
            </span>
            <button
              type="button"
              onClick={() => onNavigate('tasks')}
              className="text-[#00A8B5] font-semibold hover:underline cursor-pointer"
            >
              Открыть список задач
            </button>
          </div>
        </div>

        {/* Блок «Последние чаты» (6 колонок) */}
        <div className="lg:col-span-6 glass-panel rounded-2xl p-5 sm:p-6 border border-sky-200/70 shadow-sm space-y-4 flex flex-col justify-between bg-gradient-to-br from-white via-sky-50/35 to-blue-50/20">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-display font-bold text-base sm:text-lg text-slate-900">
                    Последние диалоги
                  </h2>
                  <p className="text-xs text-slate-500">
                    Быстрый возврат к недавним беседам
                  </p>
                </div>
              </div>

              {recentSessions.length > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigate('marketer')}
                  className="text-xs font-semibold text-[#00A8B5] hover:text-[#008f9a] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span>Все чаты</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Список последних 3 диалогов */}
            {recentSessions.length === 0 ? (
              <div className="rounded-xl p-6 bg-slate-50/80 border border-slate-200/70 text-center space-y-2">
                <MessageSquare className="w-8 h-8 text-slate-400 mx-auto" />
                <div className="text-xs font-bold text-slate-800">
                  У вас пока нет начатых диалогов
                </div>
                <p className="text-[11px] text-slate-500">
                  Выберите любого специалиста ниже или начните новый чат.
                </p>
                <button
                  type="button"
                  onClick={onStartNewChat}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-[#FFD700]" />
                  <span>Начать первый чат</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {recentSessions.map((sess) => {
                  const sSchool = SCHOOLS[sess.schoolId];
                  const sMode = AGENT_MODES[sess.mode];
                  const schoolBadge =
                    sess.schoolId === 'kiberone'
                      ? 'bg-[#FFD700] text-slate-950'
                      : sess.schoolId === 'renderia'
                        ? 'bg-[#84CC16] text-slate-950'
                        : 'bg-[#00A8B5] text-white';

                  return (
                    <button
                      key={sess.id}
                      type="button"
                      onClick={() => onOpenSession(sess)}
                      className="w-full text-left p-3 rounded-xl bg-white border border-slate-200/80 hover:border-slate-300 hover:shadow-2xs transition-all flex items-center justify-between gap-3 cursor-pointer group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {sess.isPinned ? (
                          <Pin className="w-3.5 h-3.5 text-amber-600 rotate-45 shrink-0" />
                        ) : (
                          <MessageSquare className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#00A8B5] shrink-0 transition-colors" />
                        )}
                        <div className="min-w-0">
                          <div className="font-semibold text-xs text-slate-900 group-hover:text-[#00A8B5] truncate transition-colors">
                            {sess.title}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                            <span
                              className={`px-1.5 py-0.2 rounded font-extrabold text-[9px] ${schoolBadge}`}
                            >
                              {sSchool.name}
                            </span>
                            <span>·</span>
                            <span>{sMode.shortTitle}</span>
                            <span>·</span>
                            <span className="font-mono-tabular">
                              {sess.messages.length} сообщ.
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono-tabular">
                          <Clock className="w-3 h-3" />
                          <span>{sess.updatedAt}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>
              Всего бесед в истории: <strong className="text-slate-800">{sessions.length}</strong>
            </span>
            <button
              type="button"
              onClick={onStartNewChat}
              className="text-[#00A8B5] font-semibold hover:underline cursor-pointer"
            >
              + Начать новый чат
            </button>
          </div>
        </div>
      </section>

      {/* ====================================================================
          3. СЕТКА КАРТОЧЕК 5 СПЕЦИАЛИСТОВ
         ==================================================================== */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 px-1">
          <div>
            <h2 className="font-display font-bold text-lg sm:text-xl text-slate-900">
              Команда ИИ-специалистов
            </h2>
            <p className="text-xs text-slate-500">
              Выберите профильную роль для решения сегодняшней задачи
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-500">
            Контекст: {currentSchool.name}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {SPECIALIST_CONFIGS.map((spec) => {
            const Icon = spec.icon;
            return (
              <button
                key={spec.id}
                type="button"
                onClick={() => handleSpecialistClick(spec.id)}
                className={`rounded-2xl p-4.5 text-left ${spec.cardBg} ${spec.cardBorder} hover:-translate-y-1 hover:shadow-md transition-all duration-200 border flex flex-col justify-between gap-4 group cursor-pointer shadow-2xs`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-xs group-hover:scale-105 transition-transform"
                      style={{ backgroundColor: spec.accentColor }}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${spec.badgeBg}`}>
                      ИИ-эксперт
                    </span>
                  </div>

                  <div>
                    <h3 className="font-display font-bold text-base text-slate-900 group-hover:text-[#00A8B5] transition-colors">
                      {spec.title}
                    </h3>
                    <p className="text-[11px] font-semibold text-slate-500 mt-0.5">
                      {spec.shortSubtitle}
                    </p>
                    <p className="text-xs text-slate-600 mt-1.5 leading-snug line-clamp-3">
                      {spec.description}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-200/60 flex items-center justify-between text-xs font-semibold text-slate-800">
                  <span className="group-hover:text-[#00A8B5] transition-colors">
                    Открыть чат
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-[#00A8B5] group-hover:translate-x-1 transition-transform" />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ====================================================================
          4. ПАНЕЛЬ БЫСТРЫХ СЕРВИСНЫХ ДЕЙСТВИЙ
         ==================================================================== */}
      <section className="glass-panel rounded-2xl p-5 border border-slate-200/80 bg-slate-50/70">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-bold text-slate-800">
              Быстрый доступ к сервисам:
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate('tasks')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 shadow-2xs cursor-pointer transition-colors"
            >
              <CheckSquare className="w-3.5 h-3.5 text-[#00A8B5]" />
              <span>Создать задачу</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('knowledge')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 shadow-2xs cursor-pointer transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5 text-[#00A8B5]" />
              <span>Открыть Базу знаний</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('backups')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 shadow-2xs cursor-pointer transition-colors"
            >
              <Archive className="w-3.5 h-3.5 text-slate-500" />
              <span>Резервные копии</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('connections')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 shadow-2xs cursor-pointer transition-colors"
            >
              <Settings className="w-3.5 h-3.5 text-[#00A8B5]" />
              <span>Настройки и ИИ</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  </div>
  );
};
