import React from 'react';
import {
  Archive,
  ArrowRight,
  BarChart3,
  BookOpen,
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
            <div className="pt-2 flex flex-wrap items-center gap-3">
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
              <button
                type="button"
                onClick={() => onNavigate('knowledge')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold glass-button text-slate-800 hover:bg-white transition-colors"
              >
                <BookOpen className="w-4 h-4 text-[#00A8B5]" />
                <span>База знаний ({currentSchool.name})</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('backups')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold glass-button text-slate-700 hover:bg-white transition-colors"
              >
                <Archive className="w-4 h-4 text-slate-600" />
                <span>Резервные копии</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('connections')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold glass-button text-slate-700 hover:bg-white transition-colors"
              >
                <Cpu className="w-4 h-4 text-teal-600" />
                <span>Подключения ИИ</span>
              </button>
            </div>
          </div>

          {/* Two Expressive Typographic School Switch Cards */}
          <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {(['kiberone', 'renderia'] as SchoolId[]).map((id) => {
              const s = SCHOOLS[id];
              const isSelected = activeSchool === id;
              const filled = getFilledCategories(id);

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectSchool(id)}
                  className={`text-left rounded-2xl p-4 transition-colors duration-200 border flex flex-col justify-between gap-3 ${
                    isSelected
                      ? id === 'kiberone'
                        ? 'bg-[#FFD700]/15 border-[#FFD700] shadow-xs'
                        : 'bg-[#84CC16]/20 border-[#84CC16] shadow-xs'
                      : 'bg-white/85 hover:bg-white border-slate-200/80'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center px-3 py-1.5 rounded-xl font-display font-extrabold text-base sm:text-lg tracking-wide ${
                          id === 'kiberone'
                            ? 'bg-[#FFD700] text-slate-950'
                            : 'bg-[#84CC16] text-slate-950'
                        }`}
                      >
                        {s.name}
                      </span>
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-md shrink-0 ${
                          isSelected
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-500 bg-slate-100'
                        }`}
                      >
                        {isSelected ? 'Активна' : 'Выбрать'}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">
                    {s.tagline}
                  </p>
                  <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-500">
                    <span>База знаний</span>
                    <span className="font-mono-tabular font-semibold text-slate-800">
                      {filled}/{KNOWLEDGE_CATEGORIES.length} разд.
                    </span>
                  </div>
                </button>
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

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {AGENT_MODE_LIST.map((mode) => {
            const Icon = MODE_ICONS[mode.id];
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => onNavigate(mode.id)}
                className="glass-panel rounded-2xl p-5 text-left hover:bg-white transition-colors duration-200 border border-slate-200/80 flex flex-col justify-between gap-4 group"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-2xs"
                      style={{ backgroundColor: mode.accentColor }}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="text-xs text-slate-400 font-mono-tabular">
                      {mode.quickPrompts.length} шабл.
                    </span>
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-base text-slate-900 group-hover:text-[#00A8B5] transition-colors">
                      {mode.title}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      {mode.description}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-800">
                  <span>Открыть диалог</span>
                  <ArrowRight className="w-4 h-4 text-[#00A8B5] group-hover:translate-x-0.5 transition-transform" />
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
          <div className="rounded-xl p-6 bg-white/80 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="font-display font-bold text-sm text-slate-900">
                У нас пока нет начатых бесед, Анна
              </div>
              <p className="text-xs text-slate-600">
                Откройте новый диалог для школы{' '}
                <strong>{currentSchool.name}</strong> или выберите готовый
                шаблон — все черновики и заметки бережно сохранятся.
              </p>
            </div>
            <button
              type="button"
              onClick={onStartNewChat}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
            >
              <span>Начать первый чат</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#FFD700]" />
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
