import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  BookOpen,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  Eraser,
  GraduationCap,
  Home,
  Megaphone,
  MessageSquare,
  MessageSquareHeart,
  MessageSquarePlus,
  MoreVertical,
  Palette,
  PenLine,
  Pin,
  PinOff,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  AgentMode,
  ChatSession,
  NavSection,
  SchoolId,
} from '../types/assistant';
import { AGENT_MODES, SCHOOLS } from '../config/schoolsAndModes';
import { sortSessionsPinnedAndUpdatedDesc } from '../storage/indexedDb';

interface SidebarProps {
  activeSection: NavSection;
  activeSchool: SchoolId;
  activeAgentMode: AgentMode;
  onSelectSection: (section: NavSection) => void;
  onSelectSchool: (school: SchoolId) => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onCreateNewSession: (mode?: AgentMode, school?: SchoolId) => void;
  onRenameSession: (sessionId: string, newTitle: string) => Promise<boolean>;
  onTogglePinSession: (sessionId: string, isPinned: boolean) => Promise<boolean>;
  onClearSessionMessages?: (sessionId: string) => Promise<boolean>;
  onDeleteSession: (sessionId: string) => Promise<boolean>;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  filledCategoriesCount: Record<SchoolId, number>;
  totalCategoriesCount: number;
}

interface SpecialistItem {
  id: AgentMode;
  label: string;
  sublabel: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface AppSectionItem {
  id: Exclude<NavSection, AgentMode>;
  label: string;
  sublabel: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface PortalMenuState {
  session: ChatSession;
  top: number;
  left: number;
}

const SPECIALIST_ITEMS: SpecialistItem[] = [
  {
    id: 'marketer',
    label: 'Маркетолог',
    sublabel: 'Посты VK, реклама, видео',
    icon: Megaphone,
  },
  {
    id: 'manager',
    label: 'Менеджер',
    sublabel: 'Родители и возражения',
    icon: MessageSquareHeart,
  },
  {
    id: 'methodist',
    label: 'Методист',
    sublabel: 'Уроки и мастер-классы',
    icon: GraduationCap,
  },
  {
    id: 'analyst',
    label: 'Аналитик',
    sublabel: 'Заявки, конверсия, отчёты',
    icon: BarChart3,
  },
  {
    id: 'designer',
    label: 'Дизайнер',
    sublabel: 'Концепции, баннеры, креативы',
    icon: Palette,
  },
];

const APP_SECTION_ITEMS: AppSectionItem[] = [
  {
    id: 'home',
    label: 'Обзор кабинета',
    sublabel: 'Быстрый старт и сводка',
    icon: Home,
  },
  {
    id: 'tasks',
    label: 'Мои задачи',
    sublabel: 'Все дела, поручения и календарь',
    icon: CheckSquare,
  },
  {
    id: 'knowledge',
    label: 'База знаний',
    sublabel: 'Сведения и документы школ',
    icon: BookOpen,
  },
  {
    id: 'backups',
    label: 'Резервные копии',
    sublabel: 'Экспорт и импорт базы',
    icon: Archive,
  },
  {
    id: 'connections',
    label: 'Настройки и ИИ',
    sublabel: 'Ключи, голос Пикселя, тесты',
    icon: Cpu,
  },
];

const MENU_WIDTH = 196;
const MENU_HEIGHT = 132;
const VIEWPORT_PADDING = 12;

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  activeSchool,
  activeAgentMode,
  onSelectSection,
  onSelectSchool,
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateNewSession,
  onRenameSession,
  onTogglePinSession,
  onClearSessionMessages,
  onDeleteSession,
  mobileOpen,
  onCloseMobile,
  collapsed,
  onToggleCollapsed,
  filledCategoriesCount,
  totalCategoriesCount,
}) => {
  const [historySearch, setHistorySearch] = useState('');
  const [portalMenu, setPortalMenu] = useState<PortalMenuState | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(
    null
  );
  const [renameDraft, setRenameDraft] = useState('');
  const [sessionPendingDelete, setSessionPendingDelete] =
    useState<ChatSession | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);

  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const historyListRef = useRef<HTMLDivElement | null>(null);

  const currentSchool = SCHOOLS[activeSchool];
  const currentModeConfig = AGENT_MODES[activeAgentMode];

  // Close Portal context menu on outside click, Escape key, window resize, or scroll
  useEffect(() => {
    if (!portalMenu) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (
        menuContainerRef.current &&
        menuContainerRef.current.contains(e.target as Node)
      ) {
        return;
      }
      setPortalMenu(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPortalMenu(null);
      }
    };

    const handleCloseOnScrollOrResize = () => {
      setPortalMenu(null);
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleCloseOnScrollOrResize);
    const scrollEl = historyListRef.current;
    if (scrollEl) {
      scrollEl.addEventListener('scroll', handleCloseOnScrollOrResize, {
        passive: true,
      });
    }

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleCloseOnScrollOrResize);
      if (scrollEl) {
        scrollEl.removeEventListener('scroll', handleCloseOnScrollOrResize);
      }
    };
  }, [portalMenu]);

  // Filter sessions strictly by activeSchool and activeAgentMode, sorted with pinned on top and updatedAtMs desc within each group
  const specialistSessions = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    const matchingContext = sessions.filter(
      (s) => s.schoolId === activeSchool && s.mode === activeAgentMode
    );
    const sorted = sortSessionsPinnedAndUpdatedDesc(matchingContext);

    if (!q) return sorted;
    return sorted.filter((s) => {
      if (s.title.toLowerCase().includes(q)) return true;
      return s.messages.some((m) => m.content.toLowerCase().includes(q));
    });
  }, [sessions, activeSchool, activeAgentMode, historySearch]);

  const handleOpenPortalMenu = (
    e: React.MouseEvent<HTMLButtonElement>,
    sess: ChatSession
  ) => {
    e.stopPropagation();

    if (portalMenu?.session.id === sess.id) {
      setPortalMenu(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    // Position menu to the right/below trigger, clamped inside viewport boundaries
    let left = rect.right - MENU_WIDTH;
    if (left < VIEWPORT_PADDING) {
      left = Math.min(rect.left, viewportW - MENU_WIDTH - VIEWPORT_PADDING);
    }
    if (left + MENU_WIDTH > viewportW - VIEWPORT_PADDING) {
      left = viewportW - MENU_WIDTH - VIEWPORT_PADDING;
    }
    left = Math.max(VIEWPORT_PADDING, left);

    let top = rect.bottom + 6;
    if (top + MENU_HEIGHT > viewportH - VIEWPORT_PADDING) {
      top = Math.max(VIEWPORT_PADDING, rect.top - MENU_HEIGHT - 6);
    }

    setPortalMenu({
      session: sess,
      top,
      left,
    });
  };

  const handleNavClick = (section: NavSection) => {
    setPortalMenu(null);
    onSelectSection(section);
    onCloseMobile();
  };

  const handleStartNewChat = () => {
    setPortalMenu(null);
    onCreateNewSession(activeAgentMode, activeSchool);
    onCloseMobile();
  };

  const handleStartRename = (sess: ChatSession) => {
    setPortalMenu(null);
    setRenamingSessionId(sess.id);
    setRenameDraft(sess.title);
  };

  const handleCommitRename = async (sessionId: string) => {
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      setRenamingSessionId(null);
      return;
    }
    await onRenameSession(sessionId, trimmed);
    setRenamingSessionId(null);
  };

  const handleTogglePin = async (sess: ChatSession) => {
    setPortalMenu(null);
    await onTogglePinSession(sess.id, !sess.isPinned);
  };

  const handleConfirmDelete = async () => {
    if (!sessionPendingDelete) return;
    setIsDeletingSession(true);
    try {
      await onDeleteSession(sessionPendingDelete.id);
      setSessionPendingDelete(null);
    } finally {
      setIsDeletingSession(false);
    }
  };

  const kbRatio = `${filledCategoriesCount[activeSchool]}/${totalCategoriesCount}`;

  const renderSidebarContent = (
    isCollapsedMode: boolean,
    isMobileDrawer: boolean
  ) => (
    <div
      className={`flex flex-col h-full bg-[#F9FAFB] border-r border-slate-200/80 select-none transition-[width] duration-200 ${
        isCollapsedMode ? 'w-20' : 'w-76'
      }`}
    >
      {/* Top Row: Expressive Typographic Brand Identity + Collapse Button */}
      <div
        className={`border-b border-slate-200/70 flex items-center ${
          isCollapsedMode
            ? 'flex-col gap-2.5 px-2 py-3.5 justify-center'
            : 'px-3.5 py-3.5 justify-between gap-2.5'
        }`}
      >
        <button
          type="button"
          onClick={() => handleNavClick('home')}
          title="KIBERONE & RENDERIA — Кабинет Анны"
          className="flex items-center gap-2.5 text-left min-w-0 focus:outline-none"
        >
          {isCollapsedMode ? (
            <div
              title={`Активная школа: ${currentSchool.name}`}
              className={`w-8 h-8 rounded-full font-display font-black text-xs tracking-tight flex items-center justify-center shrink-0 shadow-2xs transition-colors duration-200 ${
                activeSchool === 'kiberone'
                  ? 'bg-[#FFD700] text-slate-950'
                  : 'bg-[#84CC16] text-slate-950'
              }`}
            >
              {activeSchool === 'kiberone' ? 'K' : 'R'}
            </div>
          ) : (
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-1.5">
                <span
                  className={`px-2.5 py-0.5 rounded-lg font-display font-extrabold text-sm tracking-wide transition-colors duration-200 ${
                    activeSchool === 'kiberone'
                      ? 'bg-[#FFD700] text-slate-950'
                      : 'bg-[#84CC16] text-slate-950'
                  }`}
                >
                  {currentSchool.name}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                Кабинет Анны · обе школы рядом
              </div>
            </div>
          )}
        </button>

        {!isMobileDrawer && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={
              isCollapsedMode
                ? 'Развернуть левую панель'
                : 'Свернуть левую панель'
            }
            aria-label={
              isCollapsedMode
                ? 'Развернуть левую панель'
                : 'Свернуть левую панель'
            }
            className="hidden lg:inline-flex items-center justify-center w-8 h-8 rounded-xl border border-slate-200/90 bg-white text-slate-600 hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-colors shrink-0"
          >
            {isCollapsedMode ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>
        )}

        {isMobileDrawer && (
          <button
            type="button"
            onClick={onCloseMobile}
            className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 shrink-0"
            aria-label="Закрыть панель"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* New Chat Button + Enlarged School Switcher */}
      {isCollapsedMode ? (
        <div className="px-2 py-3 border-b border-slate-200/70 flex flex-col items-center gap-2.5">
          {/* Collapsed New Chat */}
          <div className="relative group">
            <button
              type="button"
              onClick={handleStartNewChat}
              title={`Новый чат (${currentModeConfig.shortTitle} · ${currentSchool.name})`}
              aria-label="Новый чат"
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors shadow-2xs ${
                activeSchool === 'renderia'
                  ? 'bg-[#84CC16] text-slate-950 hover:bg-[#76b813]'
                  : activeSchool === 'all'
                    ? 'bg-[#00A8B5] text-white hover:bg-[#00929e]'
                    : 'bg-[#FFD700] text-slate-950 hover:bg-[#f0ca00]'
              }`}
            >
              <MessageSquarePlus className="w-5 h-5" />
            </button>
            <div
              role="tooltip"
              className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute left-full top-1/2 -translate-y-1/2 ml-2.5 z-50 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium whitespace-nowrap shadow-md"
            >
              Новый чат ({currentModeConfig.shortTitle})
            </div>
          </div>

          {/* Collapsed School Switcher with Circular Single-Letter Badges */}
          <div className="flex flex-col gap-2 p-1.5 bg-slate-200/60 rounded-xl w-full items-center">
            {(['all', 'kiberone', 'renderia'] as SchoolId[]).map((id) => {
              const s = SCHOOLS[id];
              const isSelected = activeSchool === id;
              const letter = id === 'all' ? 'О' : id === 'kiberone' ? 'K' : 'R';
              const activeColor =
                id === 'all'
                  ? 'bg-[#00A8B5] text-white ring-2 ring-slate-900/15 shadow-xs scale-105'
                  : id === 'kiberone'
                    ? 'bg-[#FFD700] text-slate-950 ring-2 ring-slate-900/15 shadow-xs scale-105'
                    : 'bg-[#84CC16] text-slate-950 ring-2 ring-slate-900/15 shadow-xs scale-105';
              return (
                <div key={id} className="relative group">
                  <button
                    type="button"
                    onClick={() => onSelectSchool(id)}
                    title={`Режим: ${s.name} (нажмите для переключения)`}
                    aria-label={`Режим: ${s.name}`}
                    className={`w-8 h-8 rounded-full font-display font-black text-xs tracking-tight flex items-center justify-center transition-all duration-200 cursor-pointer ${
                      isSelected
                        ? activeColor
                        : 'bg-white/80 text-slate-600 hover:text-slate-900 hover:bg-white hover:scale-105'
                    }`}
                  >
                    {letter}
                  </button>
                  <div
                    role="tooltip"
                    className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute left-full top-1/2 -translate-y-1/2 ml-2.5 z-50 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium whitespace-nowrap shadow-md"
                  >
                    {s.name}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="p-3 border-b border-slate-200/70 space-y-2.5">
          {/* Prominent New Chat Button (Monolithic Style) */}
          <button
            type="button"
            onClick={handleStartNewChat}
            className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-2xs text-xs font-semibold cursor-pointer"
          >
            <MessageSquarePlus
              className={`w-4 h-4 shrink-0 ${
                activeSchool === 'renderia'
                  ? 'text-[#84CC16]'
                  : activeSchool === 'all'
                    ? 'text-[#00A8B5]'
                    : 'text-[#FFD700]'
              }`}
            />
            <span>Новый чат</span>
          </button>

          {/* Expressive Typographic School Switcher (Общее / KIBERONE / RENDERIA) */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-200/60 rounded-xl">
            {(['all', 'kiberone', 'renderia'] as SchoolId[]).map((id) => {
              const s = SCHOOLS[id];
              const isSelected = activeSchool === id;
              const activeBg =
                id === 'all'
                  ? 'bg-[#00A8B5] text-white shadow-2xs'
                  : id === 'kiberone'
                    ? 'bg-[#FFD700] text-slate-950 shadow-2xs'
                    : 'bg-[#84CC16] text-slate-950 shadow-2xs';
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectSchool(id)}
                  className={`flex items-center justify-center px-1.5 py-2 rounded-lg font-display font-extrabold text-xs tracking-tight transition-colors duration-200 cursor-pointer ${
                    isSelected
                      ? activeBg
                      : 'bg-white/75 text-slate-600 hover:text-slate-900 hover:bg-white'
                  }`}
                >
                  <span className="truncate">{s.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Scrollable Area: Specialists + Dialogue History + App Sections */}
      {isCollapsedMode ? (
        <div className="flex-1 py-3 px-2 flex flex-col items-center justify-between">
          <div className="space-y-1.5 flex flex-col items-center w-full">
            {SPECIALIST_ITEMS.map((spec) => {
              const Icon = spec.icon;
              const isChatActive =
                isAgentModeSection(activeSection) &&
                activeAgentMode === spec.id;
              return (
                <div key={spec.id} className="relative group">
                  <button
                    type="button"
                    onClick={() => handleNavClick(spec.id)}
                    aria-label={spec.label}
                    className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                      isChatActive
                        ? 'bg-slate-900 text-white shadow-2xs'
                        : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                  <div
                    role="tooltip"
                    className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute left-full top-1/2 -translate-y-1/2 ml-2.5 z-50 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium whitespace-nowrap shadow-md"
                  >
                    {spec.label} — {spec.sublabel}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-1.5 flex flex-col items-center w-full pt-3 border-t border-slate-200/70">
            {APP_SECTION_ITEMS.map((sec) => {
              const Icon = sec.icon;
              const isActive = activeSection === sec.id;
              return (
                <div key={sec.id} className="relative group">
                  <button
                    type="button"
                    onClick={() => handleNavClick(sec.id)}
                    aria-label={sec.label}
                    className={`relative w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                      isActive
                        ? 'bg-slate-900 text-white shadow-2xs'
                        : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {sec.id === 'knowledge' && (
                      <span className="absolute -top-1 -right-1 px-1 rounded bg-white border border-slate-200 text-[9px] font-mono-tabular font-bold text-slate-800">
                        {kbRatio}
                      </span>
                    )}
                  </button>
                  <div
                    role="tooltip"
                    className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute left-full top-1/2 -translate-y-1/2 ml-2.5 z-50 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium whitespace-nowrap shadow-md"
                  >
                    {sec.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {/* 1. Specialists Section */}
          <div className="space-y-1">
            <div className="px-2 pb-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Специалисты ИИ
            </div>
            <div className="grid grid-cols-2 gap-1">
              {SPECIALIST_ITEMS.map((spec) => {
                const Icon = spec.icon;
                const isSelected = activeAgentMode === spec.id;
                const isViewingChat = isAgentModeSection(activeSection);
                const count = sessions.filter(
                  (s) => s.schoolId === activeSchool && s.mode === spec.id
                ).length;

                return (
                  <button
                    key={spec.id}
                    type="button"
                    onClick={() => handleNavClick(spec.id)}
                    className={`flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-xl text-left transition-all border ${
                      isSelected && isViewingChat
                        ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                        : isSelected
                          ? 'bg-white text-slate-900 border-slate-300 shadow-2xs'
                          : 'bg-white/60 hover:bg-white text-slate-700 border-slate-200/70'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isSelected && isViewingChat
                            ? activeSchool === 'renderia'
                              ? 'text-[#84CC16]'
                              : 'text-[#FFD700]'
                            : 'text-slate-500'
                        }`}
                      />
                      <span className="text-xs font-semibold truncate">
                        {spec.label}
                      </span>
                    </div>
                    {count > 0 && (
                      <span
                        className={`text-[10px] font-mono-tabular shrink-0 ${
                          isSelected && isViewingChat
                            ? 'text-slate-300'
                            : 'text-slate-400'
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Dialogue History for Active School & Specialist */}
          <div className="space-y-2 pt-1 border-t border-slate-200/70">
            <div className="flex items-center justify-between px-2">
              <span className="text-[11px] font-semibold text-slate-500 truncate">
                Чаты: {currentModeConfig.shortTitle} · {currentSchool.name}
              </span>
              <span className="text-[10px] font-mono-tabular text-slate-400">
                {specialistSessions.length}
              </span>
            </div>

            {/* Search Input in Left Panel History */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder={`Поиск в чатах (${currentModeConfig.shortTitle})...`}
                className="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-7 py-1.5 text-xs text-slate-900 placeholder:text-slate-500 font-medium focus:outline-none focus:ring-2 focus:ring-[#00A8B5]"
              />
              {historySearch && (
                <button
                  type="button"
                  onClick={() => setHistorySearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  aria-label="Сбросить фильтр"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Compact ChatGPT-style Dialogue List (Pinned on top, then unpinned) */}
            {specialistSessions.length === 0 ? (
              <div className="rounded-xl p-3.5 bg-white/85 border border-slate-200/70 text-center space-y-1.5">
                <div className="text-xs font-semibold text-slate-700">
                  {historySearch.trim()
                    ? 'По запросу ничего не нашлось'
                    : `Здесь пока тихо (${currentModeConfig.shortTitle})`}
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  {historySearch.trim()
                    ? 'Попробуйте другое слово или загляните в глобальный поиск справа.'
                    : `Начните новый диалог для школы ${currentSchool.name} — он бережно сохранится в истории.`}
                </p>
              </div>
            ) : (
              <div
                ref={historyListRef}
                className="space-y-1 max-h-68 overflow-y-auto pr-0.5"
              >
                {specialistSessions.map((sess) => {
                  const isSelected =
                    activeSessionId === sess.id &&
                    isAgentModeSection(activeSection);
                  const isMenuOpen = portalMenu?.session.id === sess.id;
                  const isRenaming = renamingSessionId === sess.id;
                  const isPinned = Boolean(sess.isPinned);

                  return (
                    <div
                      key={sess.id}
                      onClick={() => {
                        if (!isRenaming) {
                          setPortalMenu(null);
                          onSelectSession(sess.id);
                          onCloseMobile();
                        }
                      }}
                      className={`relative group rounded-xl px-2.5 py-2 transition-all cursor-pointer border ${
                        isSelected
                          ? 'bg-white border-slate-300 shadow-2xs text-slate-900'
                          : isPinned
                            ? 'bg-slate-100/80 hover:bg-slate-200/60 border-slate-200/70 text-slate-800'
                            : 'bg-transparent hover:bg-slate-200/50 border-transparent text-slate-700'
                      }`}
                    >
                      {isRenaming ? (
                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            value={renameDraft}
                            autoFocus
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleCommitRename(sess.id);
                              } else if (e.key === 'Escape') {
                                setRenamingSessionId(null);
                              }
                            }}
                            className="flex-1 min-w-0 rounded-lg border border-[#00A8B5] bg-white px-2 py-1 text-xs text-slate-900 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleCommitRename(sess.id)}
                            className="p-1 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
                            title="Сохранить название"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingSessionId(null)}
                            className="p-1 rounded-lg text-slate-500 hover:bg-slate-200"
                            title="Отмена"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="flex items-start gap-2 min-w-0">
                            {isPinned ? (
                              <Pin
                                className={`w-3.5 h-3.5 mt-0.5 shrink-0 rotate-45 ${
                                  activeSchool === 'renderia'
                                    ? 'text-[#65A30D]'
                                    : 'text-[#D97706]'
                                }`}
                                aria-label="Закреплённый диалог"
                              />
                            ) : (
                              <MessageSquare
                                className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                                  isSelected
                                    ? activeSchool === 'renderia'
                                      ? 'text-[#65A30D]'
                                      : 'text-[#00A8B5]'
                                    : 'text-slate-400'
                                }`}
                              />
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1 min-w-0">
                                <span
                                  className="text-xs font-medium truncate"
                                  title={sess.title}
                                >
                                  {sess.title}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono-tabular mt-0.5">
                                <Clock className="w-2.5 h-2.5" />
                                <span>{sess.updatedAt}</span>
                                <span>·</span>
                                <span>{sess.messages.length} сообщ.</span>
                              </div>
                            </div>
                          </div>

                          {/* Hover Quick Actions & 3-Dots Context Menu */}
                          <div
                            className="shrink-0 flex items-center gap-0.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="hidden group-hover:flex items-center gap-0.5 mr-0.5">
                              {onClearSessionMessages && sess.messages.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => void onClearSessionMessages(sess.id)}
                                  className="p-1 rounded-md text-slate-400 hover:text-amber-700 hover:bg-amber-100 transition-colors"
                                  title="Очистить сообщения чата"
                                >
                                  <Eraser className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setSessionPendingDelete(sess)}
                                className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-100 transition-colors"
                                title="Удалить чат из истории"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={(e) => handleOpenPortalMenu(e, sess)}
                              className={`p-1 rounded-lg transition-colors ${
                                isMenuOpen
                                  ? 'bg-slate-900 text-white'
                                  : 'text-slate-400 hover:text-slate-800 hover:bg-slate-200/70'
                              }`}
                              aria-label="Действия с диалогом"
                              title="Действия с диалогом"
                            >
                              <MoreVertical className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3. Application Sections (Only Overview, Knowledge Base, Backups) */}
          <div className="space-y-1 pt-2 border-t border-slate-200/70">
            <div className="px-2 pb-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Разделы приложения
            </div>
            {APP_SECTION_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavClick(item.id)}
                  className={`w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all ${
                    isActive
                      ? 'bg-slate-900 text-white shadow-2xs'
                      : 'text-slate-700 hover:bg-slate-200/60 hover:text-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive
                          ? activeSchool === 'renderia'
                            ? 'text-[#84CC16]'
                            : 'text-[#F5B800]'
                          : 'text-slate-500'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">
                        {item.label}
                      </div>
                    </div>
                  </div>

                  {item.id === 'knowledge' && (
                    <span
                      className={`text-[10px] font-mono-tabular px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                        isActive
                          ? 'bg-slate-800 text-white'
                          : 'bg-slate-200/70 text-slate-700'
                      }`}
                    >
                      {kbRatio}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Portal Dropdown Menu rendered in document.body to prevent clipping */}
      {portalMenu &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuContainerRef}
            style={{
              position: 'fixed',
              top: `${portalMenu.top}px`,
              left: `${portalMenu.left}px`,
              width: `${MENU_WIDTH}px`,
            }}
            className="z-[9999] rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 text-xs text-slate-800 select-none"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => handleStartRename(portalMenu.session)}
              className="w-full px-3.5 py-2 text-left hover:bg-slate-100 flex items-center gap-2.5 font-medium transition-colors"
            >
              <PenLine className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span>Переименовать</span>
            </button>

            <button
              type="button"
              onClick={() => handleTogglePin(portalMenu.session)}
              className="w-full px-3.5 py-2 text-left hover:bg-slate-100 flex items-center gap-2.5 font-medium transition-colors"
            >
              {portalMenu.session.isPinned ? (
                <>
                  <PinOff className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Открепить</span>
                </>
              ) : (
                <>
                  <Pin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>Закрепить</span>
                </>
              )}
            </button>

            {onClearSessionMessages && portalMenu.session.messages.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const targetId = portalMenu.session.id;
                  setPortalMenu(null);
                  void onClearSessionMessages(targetId);
                }}
                className="w-full px-3.5 py-2 text-left hover:bg-amber-50 text-amber-900 flex items-center gap-2.5 font-medium transition-colors"
              >
                <Eraser className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>Очистить сообщения</span>
              </button>
            )}

            <div className="my-1 border-t border-slate-100" />

            <button
              type="button"
              onClick={() => {
                const target = portalMenu.session;
                setPortalMenu(null);
                setSessionPendingDelete(target);
              }}
              className="w-full px-3.5 py-2 text-left text-red-600 hover:bg-red-50 flex items-center gap-2.5 font-semibold transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              <span>Удалить</span>
            </button>
          </div>,
          document.body
        )}

      {/* Confirmation Modal for Deleting a Dialogue from Sidebar */}
      {sessionPendingDelete &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs select-text"
            onClick={() => {
              if (!isDeletingSession) setSessionPendingDelete(null);
            }}
          >
            <div
              className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-xl p-5 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600 shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-base text-slate-900">
                      Удалить диалог навсегда?
                    </h3>
                    <p className="text-xs text-slate-500">
                      Полное удаление из локальной базы IndexedDB
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isDeletingSession}
                  onClick={() => setSessionPendingDelete(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="rounded-xl p-3 bg-slate-50 border border-slate-200/80 space-y-1 text-xs">
                <div className="font-semibold text-slate-900 break-words">
                  «{sessionPendingDelete.title}»
                </div>
                <div className="text-slate-500">
                  {SCHOOLS[sessionPendingDelete.schoolId].name} ·{' '}
                  {AGENT_MODES[sessionPendingDelete.mode].title} ·{' '}
                  {sessionPendingDelete.messages.length} сообщ.
                </div>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                Диалог, его сообщения и прикреплённые к нему файлы будут удалены
                из IndexedDB без возможности восстановления.
              </p>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={isDeletingSession}
                  onClick={() => setSessionPendingDelete(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={isDeletingSession}
                  onClick={handleConfirmDelete}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>
                    {isDeletingSession ? 'Удаление...' : 'Удалить диалог'}
                  </span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block shrink-0 h-screen sticky top-0 z-40">
        {renderSidebarContent(collapsed, false)}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <div className="relative z-10 h-full">
            {renderSidebarContent(false, true)}
          </div>
        </div>
      )}
    </>
  );
};

export function isAgentModeSection(section: NavSection): section is AgentMode {
  return (
    section === 'marketer' ||
    section === 'manager' ||
    section === 'methodist' ||
    section === 'analyst' ||
    section === 'designer'
  );
}
