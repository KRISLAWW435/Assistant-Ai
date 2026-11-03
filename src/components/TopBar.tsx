import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Clock,
  Menu,
  MessageSquareText,
  PanelRight,
  Sliders,
} from 'lucide-react';
import { NavSection, SchoolId } from '../types/assistant';
import { AGENT_MODES, SCHOOLS } from '../config/schoolsAndModes';
import { isAgentModeSection } from './Sidebar';
import { WakeWordState } from '../types/voice';
import { getSyzranNow } from '../utils/syzranTime';

interface TopBarProps {
  activeSection: NavSection;
  activeSchool: SchoolId;
  onSelectSchool: (school: SchoolId) => void;
  onSelectSection: (section: NavSection) => void;
  onOpenMobileMenu: () => void;
  onToggleRightPanel?: () => void;
  rightPanelOpen?: boolean;
  dialogueFilesCount?: number;
  onOpenLiveVoice?: () => void;
  onOpenVoiceSettings?: () => void;
  onOpenVoiceDiagnostics?: () => void;
  isWakeWordListening?: boolean;
  wakeWordState?: WakeWordState;
  wakeWordDetail?: string;
  onToggleWakeWord?: () => void;
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
  onSelectSchool,
  onSelectSection,
  onOpenMobileMenu,
  onToggleRightPanel,
  rightPanelOpen,
  dialogueFilesCount = 0,
  onOpenVoiceSettings,
}) => {
  const school = SCHOOLS[activeSchool];
  const isChatMode = isAgentModeSection(activeSection);

  const [syzranClock, setSyzranClock] = useState(() => getSyzranNow());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSyzranClock(getSyzranNow());
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 py-2.5">
      <div className="flex items-center justify-between gap-3">
        {/* Zone 1: Mobile Menu + Expressive Typographic School Badge & Section Title */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onOpenMobileMenu}
            className="lg:hidden p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 shrink-0"
            aria-label="Открыть левую панель"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2.5 min-w-0 text-sm">
            <span
              className={`inline-flex items-center px-3 py-1 rounded-lg font-display font-extrabold text-xs sm:text-sm tracking-wide shrink-0 transition-colors duration-200 ${
                activeSchool === 'kiberone'
                  ? 'bg-[#FFD700] text-slate-950'
                  : 'bg-[#84CC16] text-slate-950'
              }`}
            >
              {school.name}
            </span>

            <span className="font-display font-bold text-slate-900 truncate">
              {SECTION_TITLES[activeSection]}
            </span>

            {isChatMode && (
              <>
                <span
                  className="text-slate-300 hidden md:inline"
                  aria-hidden="true"
                >
                  ·
                </span>
                <span className="hidden md:inline text-xs text-slate-500 truncate">
                  {AGENT_MODES[activeSection].roleSubtitle}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Zone 2: Typographic School Switcher (KIBERONE / RENDERIA) */}
        <div className="hidden md:flex items-center gap-1.5 p-1 bg-slate-100/90 rounded-xl border border-slate-200/70 shrink-0">
          {(['kiberone', 'renderia'] as SchoolId[]).map((id) => {
            const s = SCHOOLS[id];
            const isSelected = activeSchool === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectSchool(id)}
                className={`px-3.5 py-1.5 rounded-lg font-display font-extrabold text-xs tracking-wide transition-colors duration-200 whitespace-nowrap shrink-0 ${
                  isSelected
                    ? id === 'kiberone'
                      ? 'bg-[#FFD700] text-slate-950 shadow-2xs'
                      : 'bg-[#84CC16] text-slate-950 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/70'
                }`}
              >
                {s.name}
              </button>
            );
          })}
        </div>

        {/* Zone 3: Syzran Time (Europe/Samara) & Right Panel Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            title={`Текущее время в Сызрани (Europe/Samara): ${syzranClock.fullLabelRu}`}
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs font-medium text-slate-600 whitespace-nowrap"
          >
            <Clock className="w-3.5 h-3.5 text-[#00A8B5] shrink-0" />
            <span className="font-semibold text-slate-800 font-mono-tabular">
              {syzranClock.time24}
            </span>
            <span className="text-[11px] text-slate-400 hidden lg:inline">
              Сызрань · {syzranClock.dateShortRu}
            </span>
          </div>

          {activeSection === 'knowledge' ? (
            <button
              type="button"
              onClick={() => onSelectSection('marketer')}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <MessageSquareText className="w-3.5 h-3.5 text-[#FFD700]" />
              <span>Открыть чат</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSelectSection('knowledge')}
              className="hidden xl:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <BookOpen className="w-3.5 h-3.5 text-[#00A8B5]" />
              <span>База знаний</span>
            </button>
          )}

          {onOpenVoiceSettings && (
            <button
              type="button"
              onClick={onOpenVoiceSettings}
              title="Настройки голоса и параметров Пикселя в правой панели"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5 text-[#00A8B5]" />
              <span className="hidden md:inline">Настройки Пикселя</span>
            </button>
          )}

          {onToggleRightPanel && (
            <button
              type="button"
              onClick={onToggleRightPanel}
              title={
                rightPanelOpen
                  ? 'Скрыть правую панель инструментов'
                  : 'Открыть правую панель инструментов'
              }
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 ${
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

