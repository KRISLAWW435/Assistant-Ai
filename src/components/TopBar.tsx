import React, { useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Headphones,
  Info,
  Menu,
  MessageSquareText,
  Mic,
  MicOff,
  PanelRight,
  Sliders,
  Sparkles,
  Volume2,
  X,
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
  const school = SCHOOLS[activeSchool];
  const isChatMode = isAgentModeSection(activeSection);

  const resolvedState: WakeWordState =
    wakeWordState || (isWakeWordListening ? 'standby_listening' : 'mic_muted');
  const currentWakeMeta = WAKE_WORD_STATE_META[resolvedState];

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
          {/* Rich Standby Wake Word Indicator Pill */}
          <button
            type="button"
            onClick={() => setShowMicInfo(true)}
            title={`${currentWakeMeta.labelRu}: ${currentWakeMeta.descriptionRu}. Нажмите для управления.`}
            className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${currentWakeMeta.badgeClass}`}
          >
            <span className={`w-2 h-2 rounded-full ${currentWakeMeta.dotClass}`} />
            <span>{currentWakeMeta.labelRu}</span>
          </button>

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

      {/* Interactive Wake Word & Mic Status Dialog */}
      {showMicInfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setShowMicInfo(false)}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
                  <Mic className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">
                    Голосовой вызов Пикселя («Пиксель»)
                  </h4>
                  <p className="text-[10px] text-slate-400">
                    Статус режима ожидания и микрофона
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowMicInfo(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-3.5 text-xs">
              {/* Current Status Pill Card */}
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-500">
                    Текущее состояние:
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${currentWakeMeta.badgeClass}`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${currentWakeMeta.dotClass}`}
                    />
                    <span>{currentWakeMeta.labelRu}</span>
                  </span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  {wakeWordDetail || currentWakeMeta.descriptionRu}
                </p>
              </div>

              {/* Trigger instructions */}
              <div className="p-3 rounded-xl bg-cyan-50/70 border border-cyan-200/80 space-y-1.5">
                <div className="text-[11px] font-bold text-cyan-950 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-[#00A8B5]" />
                  <span>Как вызвать Пикселя голосом:</span>
                </div>
                <div className="text-xs text-cyan-900 leading-relaxed">
                  Произнесите вслух в любой момент:{' '}
                  <span className="font-bold font-mono text-cyan-950">
                    «Пиксель»
                  </span>
                  .
                </div>
                <div className="text-[11px] text-cyan-800 leading-snug">
                  Пиксель мгновенно откликнется: <strong>«Я тут, Анна!»</strong>{' '}
                  и откроет живой диалог без нажатия лишних кнопок.
                </div>
                <div className="text-[10px] text-cyan-700 pt-1 border-t border-cyan-200/60">
                  Также распознаются варианты: «Пиксель, ты тут?», «Пиксель,
                  привет», «Пиксель, слушай», «Эй, Пиксель».
                </div>
              </div>

              {/* Engine & Privacy Audit notice */}
              <div className="p-2.5 rounded-xl bg-slate-100 border border-slate-200 text-[11px] text-slate-600 space-y-1">
                <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-slate-500" />
                  <span>Движок распознавания речи (Audit):</span>
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Используется Web Speech API браузера (модель ru-RU Google Cloud).
                  Фоновое аудио не сохраняется на сервере и не записывается.
                  При сворачивании вкладки браузера микрофон автоматически
                  деактивируется.
                </p>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
              {onToggleWakeWord && (
                <button
                  type="button"
                  onClick={() => {
                    onToggleWakeWord();
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                    resolvedState === 'standby_listening' ||
                    resolvedState === 'hearing_speech'
                      ? 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100'
                      : 'border-emerald-300 bg-emerald-600 text-white hover:bg-emerald-700 shadow-2xs'
                  }`}
                >
                  {resolvedState === 'standby_listening' ||
                  resolvedState === 'hearing_speech'
                    ? 'Отключить ожидание'
                    : 'Включить ожидание'}
                </button>
              )}

              <div className="flex items-center gap-2">
                {onOpenVoiceSettings && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowMicInfo(false);
                      onOpenVoiceSettings();
                    }}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 transition-colors"
                  >
                    Все настройки
                  </button>
                )}
                {onOpenLiveVoice && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowMicInfo(false);
                      onOpenLiveVoice();
                    }}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#00A8B5] text-white hover:bg-[#00929d] transition-colors shadow-2xs"
                  >
                    Открыть диалог
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
