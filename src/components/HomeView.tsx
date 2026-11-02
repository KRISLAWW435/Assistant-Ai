import React from 'react';
import {
  Archive,
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  CheckSquare,
  Clock,
  Cpu,
  GraduationCap,
  Megaphone,
  MessageSquareHeart,
  Pin,
  Sparkles,
} from 'lucide-react';
import {
  AgentMode,
  ChatSession,
  KnowledgeBaseBySchool,
  NavSection,
  SchoolId,
} from '../types/assistant';
import {
  AGENT_MODE_LIST,
  AGENT_MODES,
  KNOWLEDGE_CATEGORIES,
  SCHOOLS,
} from '../config/schoolsAndModes';

interface HomeViewProps {
  activeSchool: SchoolId;
  onSelectSchool: (school: SchoolId) => void;
  onNavigate: (section: NavSection) => void;
  onOpenSession: (session: ChatSession) => void;
  onStartNewChat: () => void;
  sessions: ChatSession[];
  knowledgeBase: KnowledgeBaseBySchool;
}

const MODE_ICONS: Record<
  AgentMode,
  React.ComponentType<{ className?: string }>
> = {
  marketer: Megaphone,
  manager: MessageSquareHeart,
  methodist: GraduationCap,
  analyst: BarChart3,
};

export const HomeView: React.FC<HomeViewProps> = ({
  activeSchool,
  onSelectSchool,
  onNavigate,
  onOpenSession,
  onStartNewChat,
  sessions,
  knowledgeBase,
}) => {
  const currentSchool = SCHOOLS[activeSchool];

  const getFilledCategories = (id: SchoolId) =>
    KNOWLEDGE_CATEGORIES.filter(
      (cat) => knowledgeBase[id][cat.key]?.trim().length > 0
    ).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-8 pb-24">
      {/* Warm Greeting for Anna & Quick School Selector Hero */}
      <section className="glass-panel rounded-2xl p-6 sm:p-8 border border-slate-200/80">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-7 space-y-3">
            <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-500">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>
                Личное рабочее пространство Анны · Активная школа:{' '}
                <strong className="font-semibold text-slate-800">
                  {currentSchool.name}
                </strong>
              </span>
            </div>
            <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-slate-900 tracking-tight text-balance">
              Добро пожаловать, Анна
            </h1>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl">
              Здесь собраны ваши помощники по управлению школами{' '}
              <strong>KIBERONE</strong> и <strong>RENDERIA</strong>: от тёплых
              ответов родителям и контент-планов до методических сценариев и
              разбора отчётов.
            </p>
            <div className="pt-2 flex flex-wrap items-center gap-2 sm:gap-3">
              {/* Primary High-Priority CTA */}
              <button
                type="button"
                onClick={() => onNavigate('marketer')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-xs"
              >
                <span>Перейти в рабочий чат</span>
                <ArrowRight
                  className={`w-4 h-4 ${
                    activeSchool === 'renderia'
                      ? 'text-[#84CC16]'
                      : 'text-[#FFD700]'
                  }`}
                />
              </button>

              {/* Secondary Subtle Links */}
              <button
                type="button"
                onClick={() => onNavigate('tasks')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium text-slate-700 bg-slate-100 hover:text-slate-900 hover:bg-slate-200/90 transition-colors"
              >
                <CheckSquare className="w-4 h-4 text-[#00A8B5]" />
                <span>Мои задачи</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('knowledge')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100/90 transition-colors"
              >
                <BookOpen className="w-4 h-4 text-[#00A8B5]" />
                <span>База знаний</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('backups')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100/90 transition-colors"
              >
                <Archive className="w-4 h-4 text-slate-500" />
                <span>Резервные копии</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('connections')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100/90 transition-colors"
              >
                <Cpu className="w-4 h-4 text-teal-600" />
                <span>Подключения ИИ</span>
              </button>
            </div>
          </div>

          {/* Two Informative School Summary Cards (Non-conflicting with TopBar/Sidebar switchers) */}
          <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {(['kiberone', 'renderia'] as SchoolId[]).map((id) => {
              const s = SCHOOLS[id];
              const isSelected = activeSchool === id;
              const filled = getFilledCategories(id);
              const progressPct = Math.round(
                (filled / KNOWLEDGE_CATEGORIES.length) * 100
              );

              return (
                <div
                  key={id}
                  className={`rounded-2xl p-3.5 sm:p-4 transition-all duration-200 border flex flex-col justify-between gap-3 min-w-0 overflow-hidden ${
                    isSelected
                      ? id === 'kiberone'
                        ? 'bg-[#FFD700]/10 border-[#FFD700] ring-2 ring-[#FFD700]/30 shadow-xs'
                        : 'bg-[#84CC16]/10 border-[#84CC16] ring-2 ring-[#84CC16]/30 shadow-xs'
                      : 'bg-white/60 border-slate-200/70 opacity-70'
                  }`}
                >
                  <div className="space-y-2.5 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-lg font-display font-black text-xs sm:text-sm tracking-wide shrink-0 ${
                          id === 'kiberone'
                            ? 'bg-[#FFD700] text-slate-950'
                            : 'bg-[#84CC16] text-slate-950'
                        }`}
                      >
                        {s.name}
                      </span>
                      {isSelected ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-900 text-white shadow-2xs shrink-0 whitespace-nowrap">
                          <Check className="w-2.5 h-2.5 text-emerald-400" />
                          <span>Активна</span>
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md text-slate-400 bg-slate-100 shrink-0 whitespace-nowrap">
                          Вторая школа
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">
                      {s.tagline}
                    </p>
                  </div>

                  {/* Knowledge Base Progress Bar */}
                  <div className="pt-2.5 border-t border-slate-200/60 space-y-1.5">
                    <div className="text-[11px] font-medium text-slate-600">
                      База знаний
                    </div>
                    <div className="w-full h-1.5 bg-slate-200/80 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          id === 'kiberone' ? 'bg-[#FFD700]' : 'bg-[#84CC16]'
                        }`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono-tabular">
                      {filled} из {KNOWLEDGE_CATEGORIES.length} разделов
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 4 Working Instrument Cards */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="font-display font-bold text-lg text-slate-900">
            Специалисты ИИ · {currentSchool.name}
          </h2>
          <span className="text-xs text-slate-500">
            Выберите нужную роль для сегодняшней задачи
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5">
          {AGENT_MODE_LIST.map((mode) => {
            const Icon = MODE_ICONS[mode.id];
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => onNavigate(mode.id)}
                className="glass-panel rounded-2xl p-4 sm:p-4.5 text-left bg-white/85 hover:bg-white hover:-translate-y-0.5 hover:shadow-md hover:border-slate-300 transition-all duration-200 border border-slate-200/80 flex flex-col justify-between gap-3 group cursor-pointer"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-2xs group-hover:scale-105 transition-transform"
                      style={{ backgroundColor: mode.accentColor }}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono-tabular">
                      {mode.quickPrompts.length} шабл.
                    </span>
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-sm sm:text-base text-slate-900 group-hover:text-[#00A8B5] transition-colors leading-snug">
                      {mode.title}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 leading-snug">
                      {mode.description}
                    </p>
                  </div>
                </div>

                <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-800">
                  <span className="group-hover:text-[#00A8B5] transition-colors">
                    Открыть диалог
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-[#00A8B5] group-hover:translate-x-1.5 transition-transform duration-200" />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Recent Dialogues Section */}
      <section className="glass-panel rounded-2xl p-5 sm:p-6 border border-slate-200/80 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display font-bold text-base sm:text-lg text-slate-900">
              Недавние диалоги
            </h2>
            <p className="text-xs text-slate-500">
              Быстрый возврат к вашим последним и закреплённым рабочим чатам
            </p>
          </div>
          {sessions.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('marketer')}
              className="text-xs font-semibold text-[#00A8B5] hover:underline"
            >
              Перейти в чат
            </button>
          )}
        </div>

        {sessions.length === 0 ? (
          <div className="rounded-2xl p-6 bg-gradient-to-r from-white/95 via-slate-50/60 to-white/95 border border-slate-200/90 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-600 flex items-center justify-center shrink-0">
                <Sparkles className="w-6 h-6 text-amber-500" />
              </div>
              <div className="space-y-1">
                <div className="font-display font-bold text-sm text-slate-900">
                  У нас пока нет начатых бесед, Анна
                </div>
                <p className="text-xs text-slate-600 leading-relaxed max-w-xl">
                  Откройте новый диалог для школы{' '}
                  <strong>{currentSchool.name}</strong> или выберите готовый
                  шаблон — все черновики и заметки бережно сохранятся.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onStartNewChat}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-xs whitespace-nowrap shrink-0 self-start sm:self-auto group"
            >
              <span>Начать первый чат</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#FFD700] group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {sessions.slice(0, 3).map((sess) => {
              const sSchool = SCHOOLS[sess.schoolId];
              const sMode = AGENT_MODES[sess.mode];
              return (
                <button
                  key={sess.id}
                  type="button"
                  onClick={() => onOpenSession(sess)}
                  className="text-left rounded-xl p-4 bg-white/85 hover:bg-white border border-slate-200/80 transition-colors flex flex-col justify-between gap-2.5"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {sess.isPinned && (
                      <Pin className="w-3.5 h-3.5 text-amber-600 rotate-45 shrink-0" />
                    )}
                    <div className="font-semibold text-sm text-slate-900 truncate">
                      {sess.title}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span
                      className={`px-2 py-0.5 rounded font-display font-extrabold text-[10px] ${
                        sess.schoolId === 'kiberone'
                          ? 'bg-[#FFD700] text-slate-950'
                          : 'bg-[#84CC16] text-slate-950'
                      }`}
                    >
                      {sSchool.name}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{sMode.shortTitle}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">
                      {sess.messages.length} сообщ.
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono-tabular">
                    <Clock className="w-3 h-3" />
                    <span>{sess.updatedAt}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
