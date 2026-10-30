import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Menu,
  MessageSquareText,
  Mic,
  PanelRight,
  Sliders,
} from 'lucide-react';
import { NavSection, SchoolId } from '../types/assistant';
import { AGENT_MODES, SCHOOLS } from '../config/schoolsAndModes';
import { isAgentModeSection } from './Sidebar';
import { WAKE_WORD_STATE_META, WakeWordState } from '../types/voice';

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
  isWakeWordListening?: boolean;
  wakeWordState?: WakeWordState;
  wakeWordDetail?: string;
  onToggleWakeWord?: () => void;
}

const SECTION_TITLES: Record<NavSection, string> = {
  home: 'Обзор кабинета',
  marketer: 'Маркетолог',
  manager: 'Менеджер по работе с родителями',
  methodist: 'Методист',
  analyst: 'Бизнес-аналитик',
  knowledge: 'База знаний двух школ',
  backups: 'Резервные копии',
  connections: 'Подключения ИИ и модели',
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
  onOpenLiveVoice,
  onOpenVoiceSettings,
  isWakeWordListening = false,
  wakeWordState,
  wakeWordDetail,
  onToggleWakeWord,
}) => {
  const [showMicInfo, setShowMicInfo] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const school = SCHOOLS[activeSchool];
  const isChatMode = isAgentModeSection(activeSection);

  const resolvedState: WakeWordState =
    wakeWordState || (isWakeWordListening ? 'standby_listening' : 'mic_muted');
  const currentWakeMeta = WAKE_WORD_STATE_META[resolvedState];

  const isListeningActive =
    resolvedState === 'standby_listening' || resolvedState === 'hearing_speech';

  const statusMeta = useMemo(() => {
    if (resolvedState === 'error' || resolvedState === 'unsupported') {
      return {
        label: 'Микрофон недоступен',
        dotClass: 'bg-rose-500',
        badgeClass: 'text-rose-700 bg-rose-50 border-rose-200',
      };
    }
    if (isListeningActive) {
      return {
        label: 'Ожидает вызова',
        dotClass: 'bg-emerald-500 animate-pulse',
        badgeClass: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      };
    }
    if (
      resolvedState === 'wake_word_triggered' ||
      resolvedState === 'connecting_live'
    ) {
      return {
        label: 'Подключение...',
        dotClass: 'bg-cyan-500 animate-ping',
        badgeClass: 'text-cyan-700 bg-cyan-50 border-cyan-200',
      };
    }
    return {
      label: 'Ожидание выключено',
      dotClass: 'bg-slate-400',
      badgeClass: 'text-slate-600 bg-slate-100 border-slate-200',
    };
  }, [resolvedState, isListeningActive]);

  useEffect(() => {
    if (!showMicInfo) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node)
      ) {
        setShowMicInfo(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showMicInfo]);

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

        {/* Zone 3: Quick Voice Actions & Right Panel Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Rich Standby Wake Word Indicator Pill with compact popover */}
          <div className="relative" ref={popoverRef}>
            <button
              type="button"
              onClick={() => setShowMicInfo((prev) => !prev)}
              aria-expanded={showMicInfo}
              title={`${statusMeta.label}. Нажмите для управления.`}
              className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${currentWakeMeta.badgeClass}`}
            >
              <span className={`w-2 h-2 rounded-full ${currentWakeMeta.dotClass}`} />
              <span>{statusMeta.label}</span>
            </button>

            {/* Compact Popover */}
            {showMicInfo && (
              <div
                className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl shadow-xl border border-slate-200 p-3.5 z-50 text-slate-800 animate-in fade-in zoom-in-95 duration-100"
              >
                {/* 1. Status row */}
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
                      <Mic className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">
                      Голосовой вызов
                    </span>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${statusMeta.badgeClass}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dotClass}`} />
                    <span>{statusMeta.label}</span>
                  </span>
                </div>

                {/* 2. Switch row */}
                <div className="flex items-center justify-between py-2.5 border-b border-slate-100">
                  <div className="min-w-0 pr-2">
                    <div className="text-xs font-semibold text-slate-700">
                      Ожидание фразы «Пиксель»
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {isListeningActive
                        ? 'Микрофон слушает ключевое слово'
                        : 'Фоновое распознавание отключено'}
                    </div>
                  </div>
                  {onToggleWakeWord && (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isListeningActive}
                      onClick={onToggleWakeWord}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-hidden ${
                        isListeningActive ? 'bg-emerald-600' : 'bg-slate-300'
                      }`}
                      title={
                        isListeningActive
                          ? 'Выключить ожидание'
                          : 'Включить ожидание'
                      }
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out mt-0.5 ml-0.5 ${
                          isListeningActive ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  )}
                </div>

                {/* 3. Actions */}
                <div className="pt-2.5 space-y-2">
                  {onOpenLiveVoice && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowMicInfo(false);
                        onOpenLiveVoice();
                      }}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-[#00A8B5] to-[#165B73] hover:from-[#00929d] hover:to-[#124d62] transition-colors shadow-2xs cursor-pointer"
                    >
                      <Mic className="w-3.5 h-3.5 text-[#FFD700]" />
                      <span>Поговорить</span>
                    </button>
                  )}

                  {onOpenVoiceSettings && (
                    <div className="flex justify-center pt-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setShowMicInfo(false);
                          onOpenVoiceSettings();
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                      >
                        <Sliders className="w-3 h-3" />
                        <span>Настройки голоса</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Prominent Live Voice Button: «Поговорить с Пикселем» */}
          {onOpenLiveVoice && (
            <button
              type="button"
              onClick={onOpenLiveVoice}
              title="Открыть живой голосовой разговор с Пикселем (Gemini Live)"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold bg-gradient-to-r from-[#00A8B5] to-[#165B73] hover:from-[#00929d] hover:to-[#124d62] text-white shadow-xs transition-all whitespace-nowrap shrink-0"
            >
              <Mic className="w-3.5 h-3.5 text-[#FFD700] animate-pulse" />
              <span className="hidden sm:inline">Поговорить с Пикселем</span>
              <span className="sm:hidden">Пиксель</span>
            </button>
          )}

          {onOpenVoiceSettings && (
            <button
              type="button"
              onClick={onOpenVoiceSettings}
              title="Настройки голоса, тембра и режима ожидания"
              aria-label="Настройки голоса"
              className="p-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-colors shrink-0"
            >
              <Sliders className="w-4 h-4" />
            </button>
          )}

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

          {onToggleRightPanel && (
            <button
              type="button"
              onClick={onToggleRightPanel}
              title={
                rightPanelOpen
                  ? 'Скрыть панель «Рабочие материалы»'
                  : 'Открыть панель «Рабочие материалы»'
              }
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 ${
                rightPanelOpen
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <PanelRight className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Материалы</span>
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
