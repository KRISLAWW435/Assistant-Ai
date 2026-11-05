import React, { useEffect, useState } from 'react';
import {
  Check,
  Clock,
  Menu,
  MessageSquarePlus,
  PanelRight,
  PenLine,
  Sparkles,
} from 'lucide-react';
import { AgentMode, ChatSession, NavSection, SchoolId } from '../types/assistant';
import { SCHOOLS } from '../config/schoolsAndModes';
import { isAgentModeSection } from './Sidebar';
import { getSyzranNow } from '../utils/syzranTime';

export interface TopBarProps {
  activeSection: NavSection;
  activeSchool: SchoolId;
  activeAgentMode?: AgentMode;
  currentSession?: ChatSession | null;
  onSelectSchool?: (school: SchoolId) => void;
  onSelectSection?: (section: NavSection) => void;
  onOpenMobileMenu: () => void;
  onToggleRightPanel?: () => void;
  rightPanelOpen?: boolean;
  dialogueFilesCount?: number;
  onCreateNewSession?: (mode?: AgentMode, school?: SchoolId) => void;
  onRenameSession?: (sessionId: string, newTitle: string) => Promise<boolean>;
  isFlowPanelOpen?: boolean;
  onToggleFlowView?: () => void;
}

const SECTION_TITLES: Record<NavSection, string> = {
  home: 'Обзор кабинета',
  tasks: 'Мои задачи',
  marketer: 'Маркетолог',
  manager: 'Менеджер по работе с родителями',
  methodist: 'Методист',
  analyst: 'Бизнес-аналитик',
  designer: 'Дизайнер',
  knowledge: 'База знаний двух школ',
  backups: 'Резервные копии',
  connections: 'Настройки и ИИ',
};

export const TopBar: React.FC<TopBarProps> = ({
  activeSection,
  activeSchool,
  activeAgentMode,
  currentSession,
  onOpenMobileMenu,
  onToggleRightPanel,
  rightPanelOpen,
  dialogueFilesCount = 0,
  onCreateNewSession,
  onRenameSession,
  isFlowPanelOpen = false,
  onToggleFlowView,
}) => {
  const school = SCHOOLS[activeSchool];
  const isChatMode = isAgentModeSection(activeSection);

  const [syzranClock, setSyzranClock] = useState(() => getSyzranNow());
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSyzranClock(getSyzranNow());
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  const handleCommitRename = async () => {
    setIsEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && currentSession && trimmed !== currentSession.title && onRenameSession) {
      await onRenameSession(currentSession.id, trimmed);
    }
  };

  return (
    <header className="sticky top-0 z-20 shrink-0 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-3 sm:px-5 py-1.5">
      <div className="flex items-center justify-between gap-2.5">
        {/* Left Side: Mobile Menu + School Badge + Editable Chat/Section Title */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onOpenMobileMenu}
            className="lg:hidden p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 shrink-0 cursor-pointer"
            aria-label="Открыть левую панель"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 min-w-0 text-sm">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-lg font-display font-extrabold text-xs tracking-wide shrink-0 transition-colors duration-200 ${
                activeSchool === 'all'
                  ? 'bg-[#00A8B5] text-white'
                  : activeSchool === 'kiberone'
                    ? 'bg-[#FFD700] text-slate-950'
                    : 'bg-[#84CC16] text-slate-950'
              }`}
            >
              {school.name}
            </span>

            {isChatMode && currentSession ? (
              isEditingTitle ? (
                <div className="flex items-center gap-1 min-w-0">
                  <input
                    type="text"
                    value={titleDraft}
                    autoFocus
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleCommitRename();
                      } else if (e.key === 'Escape') {
                        setIsEditingTitle(false);
                      }
                    }}
                    onBlur={() => void handleCommitRename()}
                    className="rounded-md border border-[#00A8B5] bg-white px-2 py-0.5 text-xs sm:text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00A8B5]"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCommitRename()}
                    className="p-1 rounded-md bg-slate-900 text-white hover:bg-slate-800"
                    title="Сохранить название"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(currentSession.title);
                    setIsEditingTitle(true);
                  }}
                  className="group flex items-center gap-1.5 px-2 py-0.5 rounded-lg hover:bg-slate-100 transition-colors text-left min-w-0 cursor-pointer"
                  title="Нажмите, чтобы переименовать чат"
                >
                  <span className="font-display font-bold text-slate-900 text-xs sm:text-sm truncate">
                    {currentSession.title}
                  </span>
                  <PenLine className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              )
            ) : (
              <span className="font-display font-bold text-slate-900 text-xs sm:text-sm truncate">
                {SECTION_TITLES[activeSection]}
              </span>
            )}
          </div>
        </div>

        {/* Right Side: Flow Toggle (Designer Mode) + New Chat + Clock + Right Panel Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          {onToggleFlowView &&
            (activeSection === 'designer' || activeAgentMode === 'designer') && (
              <button
                type="button"
                onClick={onToggleFlowView}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  isFlowPanelOpen
                    ? 'bg-purple-600 text-white shadow-xs hover:bg-purple-700'
                    : 'bg-purple-50 text-purple-700 border border-purple-200/90 hover:bg-purple-100/90'
                }`}
                title={
                  isFlowPanelOpen
                    ? 'Скрыть рабочую область Google Flow'
                    : 'Показать рабочую область Google Flow (Nano Banana)'
                }
              >
                <Sparkles
                  className={`w-3.5 h-3.5 ${
                    isFlowPanelOpen ? 'text-amber-300' : 'text-purple-600'
                  }`}
                />
                <span className="hidden sm:inline">
                  {isFlowPanelOpen ? 'Скрыть Flow' : 'Показать Flow'}
                </span>
                <span className="sm:hidden">Flow</span>
              </button>
            )}

          {onCreateNewSession && (
            <button
              type="button"
              onClick={() =>
                onCreateNewSession(
                  activeAgentMode ||
                    (isAgentModeSection(activeSection)
                      ? activeSection
                      : 'marketer'),
                  activeSchool
                )
              }
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeSchool === 'renderia'
                  ? 'bg-[#84CC16] text-slate-950 hover:bg-[#76b813]'
                  : 'bg-[#FFD700] text-slate-950 hover:bg-[#f0ca00]'
              }`}
              title="Создать новый независимый чат"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              <span>Новый чат</span>
            </button>
          )}

          <div
            title={`Текущее время в Сызрани (Europe/Samara): ${syzranClock.fullLabelRu}`}
            className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200/80 text-xs font-medium text-slate-600 whitespace-nowrap"
          >
            <Clock className="w-3.5 h-3.5 text-[#00A8B5] shrink-0" />
            <span className="font-semibold text-slate-800 font-mono-tabular">
              {syzranClock.time24}
            </span>
          </div>

          {onToggleRightPanel && (
            <button
              type="button"
              onClick={onToggleRightPanel}
              title={
                rightPanelOpen
                  ? 'Скрыть правую панель инструментов'
                  : 'Открыть правую панель инструментов'
              }
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                rightPanelOpen
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <PanelRight className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Панель</span>
              {dialogueFilesCount > 0 && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono-tabular font-bold ${
                    activeSchool === 'renderia'
                      ? 'bg-[#84CC16] text-slate-950'
                      : 'bg-[#FFD700] text-slate-950'
                  }`}
                >
                  {dialogueFilesCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
