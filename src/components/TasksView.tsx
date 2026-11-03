import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  Calendar as CalendarIcon,
  CalendarCheck,
  CalendarDays,
  CalendarOff,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  GraduationCap,
  ListFilter,
  Megaphone,
  MessageSquare,
  MessageSquareHeart,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  User,
  X,
} from 'lucide-react';
import {
  AgentMode,
  CompanionTaskPriority,
  CompanionTaskRecord,
  CompanionTaskStatus,
  NavSection,
  SchoolId,
} from '../types/assistant';
import { AGENT_MODES, SCHOOLS } from '../config/schoolsAndModes';
import {
  addDaysToIsoDate,
  formatSyzranIsoDateRu,
  getSyzranNow,
  toSyzranIsoDate,
} from '../utils/syzranTime';

export interface TasksViewProps {
  tasks: CompanionTaskRecord[];
  activeSchool: SchoolId;
  onSaveTask: (task: CompanionTaskRecord) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
  onNavigate: (section: NavSection) => void;
  onOpenSpecialistChat?: (
    mode: AgentMode,
    schoolId: SchoolId,
    sessionId?: string
  ) => void;
}

export const REAL_TASK_STATUS_LABELS: Record<CompanionTaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  waiting_response: 'Ожидает ответа',
  waiting_anna_action: 'Ожидает действия Анны',
  done: 'Завершена',
  cancelled: 'Отменена',
  postponed: 'Ожидает действия Анны',
};

export const STATUS_BADGE_STYLES: Record<
  CompanionTaskStatus,
  { bg: string; text: string; border: string; dot: string }
> = {
  new: {
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
    dot: 'bg-blue-500',
  },
  in_progress: {
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
    dot: 'bg-amber-500',
  },
  waiting_response: {
    bg: 'bg-sky-50',
    text: 'text-sky-800',
    border: 'border-sky-200',
    dot: 'bg-sky-500',
  },
  waiting_anna_action: {
    bg: 'bg-purple-50',
    text: 'text-purple-800',
    border: 'border-purple-200',
    dot: 'bg-purple-600 animate-pulse',
  },
  done: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    dot: 'bg-emerald-600',
  },
  cancelled: {
    bg: 'bg-slate-100',
    text: 'text-slate-500',
    border: 'border-slate-200',
    dot: 'bg-slate-400',
  },
  postponed: {
    bg: 'bg-purple-50',
    text: 'text-purple-800',
    border: 'border-purple-200',
    dot: 'bg-purple-600',
  },
};

type TaskViewMode = 'list' | 'calendar';
type StatusFilter = 'all' | 'active' | CompanionTaskStatus;
type SchoolFilter = 'all' | 'kiberone' | 'renderia' | 'both';
type TypeFilter =
  | 'all'
  | 'personal'
  | 'delegation'
  | 'pixel_auto'
  | 'reminder';

export function getTaskTypeInfo(task: CompanionTaskRecord): {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  colorClass: string;
} {
  if (
    task.sourceType === 'delegation' ||
    task.linkedDelegationTaskId ||
    task.linkedSpecialistId
  ) {
    const specMode = task.linkedSpecialistId;
    let icon = Bot;
    if (specMode === 'marketer') icon = Megaphone;
    else if (specMode === 'manager') icon = MessageSquareHeart;
    else if (specMode === 'methodist') icon = GraduationCap;
    else if (specMode === 'analyst') icon = BarChart3;
    else if (specMode === 'designer') icon = Palette;

    const specTitle = specMode ? AGENT_MODES[specMode].shortTitle : 'Специалисту';
    return {
      key: 'delegation',
      label: `Поручение (${specTitle})`,
      icon,
      colorClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    };
  }

  if (task.sourceType === 'reminder' || task.reminderAt) {
    return {
      key: 'reminder',
      label: 'Напоминание',
      icon: Bell,
      colorClass: 'bg-amber-50 text-amber-800 border-amber-200',
    };
  }

  if (
    task.sourceType === 'conversation_auto' ||
    task.sourceType === 'voice_command'
  ) {
    return {
      key: 'pixel_auto',
      label: 'Диалог с Пикселем',
      icon: Sparkles,
      colorClass: 'bg-cyan-50 text-cyan-800 border-cyan-200',
    };
  }

  return {
    key: 'personal',
    label: 'Личная задача Анны',
    icon: User,
    colorClass: 'bg-slate-100 text-slate-700 border-slate-200',
  };
}

export const TasksView: React.FC<TasksViewProps> = ({
  tasks,
  activeSchool,
  onSaveTask,
  onDeleteTask,
  onNavigate,
  onOpenSpecialistChat,
}) => {
  const todayIso = toSyzranIsoDate();
  const tomorrowIso = addDaysToIsoDate(todayIso, 1);
  const weekEndIso = addDaysToIsoDate(todayIso, 7);

  // View state
  const [viewMode, setViewMode] = useState<TaskViewMode>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [schoolFilter, setSchoolFilter] = useState<SchoolFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTask, setEditingTask] = useState<CompanionTaskRecord | null>(
    null
  );
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string>('');

  // Calendar month state (defaults to today's month)
  const [calendarDate, setCalendarDate] = useState(() => {
    const [y, m] = todayIso.split('-');
    return new Date(Number(y), Number(m) - 1, 1);
  });

  // Form states for creating / editing task
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formDueTime, setFormDueTime] = useState('');
  const [formPriority, setFormPriority] =
    useState<CompanionTaskPriority>('medium');
  const [formStatus, setFormStatus] = useState<CompanionTaskStatus>('new');
  const [formSchool, setFormSchool] = useState<SchoolId | 'both'>(activeSchool);
  const [formReminderAt, setFormReminderAt] = useState('');

  // Open modal for new task
  const handleOpenCreateModal = (prefillDueDate?: string) => {
    setEditingTask(null);
    setFormTitle('');
    setFormDescription('');
    setFormDueDate(prefillDueDate || '');
    setFormDueTime('');
    setFormPriority('medium');
    setFormStatus('new');
    setFormSchool(activeSchool);
    setFormReminderAt('');
    setShowCreateModal(true);
  };

  // Open modal to edit existing task
  const handleOpenEditModal = (task: CompanionTaskRecord) => {
    setEditingTask(task);
    setFormTitle(task.title);
    setFormDescription(task.description || '');
    setFormDueDate(task.dueDate || '');
    setFormDueTime(task.dueTime || '');
    setFormPriority(task.priority);
    setFormStatus(task.status);
    setFormSchool(task.schoolId || 'both');
    setFormReminderAt(task.reminderAt || '');
    setShowCreateModal(true);
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) return;

    const now = new Date();
    const formattedNow = formatSyzranIsoDateRu(todayIso);

    if (editingTask) {
      const isNowDone = formStatus === 'done';
      const wasDone = editingTask.status === 'done';
      const updated: CompanionTaskRecord = {
        ...editingTask,
        title: formTitle.trim(),
        description: formDescription.trim(),
        dueDate: formDueDate,
        dueTime: formDueTime || undefined,
        priority: formPriority,
        status: formStatus,
        schoolId: formSchool,
        reminderAt: formReminderAt || undefined,
        completedAt: isNowDone
          ? wasDone
            ? editingTask.completedAt
            : formattedNow
          : undefined,
        completedAtMs: isNowDone
          ? wasDone
            ? editingTask.completedAtMs
            : now.getTime()
          : undefined,
      };
      await onSaveTask(updated);
    } else {
      const newTask: CompanionTaskRecord = {
        id: `task-manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: formTitle.trim(),
        description: formDescription.trim(),
        dueDate: formDueDate,
        dueTime: formDueTime || undefined,
        priority: formPriority,
        status: formStatus,
        schoolId: formSchool,
        sourceType: 'manual',
        reminderAt: formReminderAt || undefined,
        createdAt: formattedNow,
        createdAtMs: now.getTime(),
      };
      await onSaveTask(newTask);
    }

    setShowCreateModal(false);
    setEditingTask(null);
  };

  // Quick status change handler
  const handleUpdateStatus = async (
    task: CompanionTaskRecord,
    nextStatus: CompanionTaskStatus
  ) => {
    const now = new Date();
    const isNowDone = nextStatus === 'done';
    const updated: CompanionTaskRecord = {
      ...task,
      status: nextStatus,
      completedAt: isNowDone ? formatSyzranIsoDateRu(todayIso) : undefined,
      completedAtMs: isNowDone ? now.getTime() : undefined,
    };
    await onSaveTask(updated);
  };

  // Quick toggle between Done / In Progress
  const handleToggleDone = async (task: CompanionTaskRecord) => {
    if (task.status === 'done') {
      await handleUpdateStatus(task, 'in_progress');
    } else {
      await handleUpdateStatus(task, 'done');
    }
  };

  // Quick date assignment (for undated tasks)
  const handleQuickAssignDate = async (
    task: CompanionTaskRecord,
    targetDate: string
  ) => {
    await onSaveTask({
      ...task,
      dueDate: targetDate,
    });
  };

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      // 1. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = t.title.toLowerCase().includes(q);
        const matchesDesc = (t.description || '').toLowerCase().includes(q);
        const matchesSpec = t.linkedSpecialistId
          ? AGENT_MODES[t.linkedSpecialistId].title.toLowerCase().includes(q)
          : false;
        if (!matchesTitle && !matchesDesc && !matchesSpec) return false;
      }

      // 2. School filter
      if (schoolFilter !== 'all') {
        if (schoolFilter === 'both' && t.schoolId && t.schoolId !== 'both')
          return false;
        if (
          schoolFilter !== 'both' &&
          t.schoolId &&
          t.schoolId !== schoolFilter &&
          t.schoolId !== 'both'
        ) {
          return false;
        }
      }

      // 3. Status filter
      if (statusFilter === 'active') {
        if (t.status === 'done' || t.status === 'cancelled') return false;
      } else if (statusFilter !== 'all') {
        if (statusFilter === 'waiting_anna_action') {
          if (t.status !== 'waiting_anna_action' && t.status !== 'postponed')
            return false;
        } else if (t.status !== statusFilter) {
          return false;
        }
      }

      // 4. Type filter
      if (typeFilter !== 'all') {
        const typeInfo = getTaskTypeInfo(t);
        if (typeFilter === 'personal' && typeInfo.key !== 'personal')
          return false;
        if (typeFilter === 'delegation' && typeInfo.key !== 'delegation')
          return false;
        if (typeFilter === 'pixel_auto' && typeInfo.key !== 'pixel_auto')
          return false;
        if (typeFilter === 'reminder' && typeInfo.key !== 'reminder')
          return false;
      }

      return true;
    });
  }, [tasks, searchQuery, schoolFilter, statusFilter, typeFilter]);

  // Metrics
  const metrics = useMemo(() => {
    const total = tasks.length;
    const active = tasks.filter(
      (t) => t.status !== 'done' && t.status !== 'cancelled'
    ).length;
    const waitingAnna = tasks.filter(
      (t) => t.status === 'waiting_anna_action' || t.status === 'postponed'
    ).length;
    const waitingResponse = tasks.filter(
      (t) => t.status === 'waiting_response'
    ).length;
    const undated = tasks.filter(
      (t) =>
        !t.dueDate && (t.status !== 'done' && t.status !== 'cancelled')
    ).length;
    const completed = tasks.filter((t) => t.status === 'done').length;
    const cancelled = tasks.filter((t) => t.status === 'cancelled').length;
    const overdue = tasks.filter(
      (t) =>
        t.status !== 'done' &&
        t.status !== 'cancelled' &&
        t.dueDate &&
        t.dueDate < todayIso
    ).length;

    return {
      total,
      active,
      waitingAnna,
      waitingResponse,
      undated,
      completed,
      cancelled,
      overdue,
    };
  }, [tasks, todayIso]);

  // Grouped tasks for List View
  const groupedList = useMemo(() => {
    const overdue: CompanionTaskRecord[] = [];
    const today: CompanionTaskRecord[] = [];
    const tomorrow: CompanionTaskRecord[] = [];
    const thisWeek: CompanionTaskRecord[] = [];
    const upcoming: CompanionTaskRecord[] = [];
    const undated: CompanionTaskRecord[] = [];
    const finishedOrCancelled: CompanionTaskRecord[] = [];

    for (const t of filteredTasks) {
      if (t.status === 'done' || t.status === 'cancelled') {
        finishedOrCancelled.push(t);
        continue;
      }

      if (!t.dueDate) {
        undated.push(t);
        continue;
      }

      if (t.dueDate < todayIso) {
        overdue.push(t);
      } else if (t.dueDate === todayIso) {
        today.push(t);
      } else if (t.dueDate === tomorrowIso) {
        tomorrow.push(t);
      } else if (t.dueDate <= weekEndIso) {
        thisWeek.push(t);
      } else {
        upcoming.push(t);
      }
    }

    // Sort function: by time if present, then priority
    const sortGroup = (arr: CompanionTaskRecord[]) =>
      arr.sort((a, b) => {
        if (a.dueTime && b.dueTime && a.dueTime !== b.dueTime) {
          return a.dueTime.localeCompare(b.dueTime);
        }
        if (a.dueTime && !b.dueTime) return -1;
        if (!a.dueTime && b.dueTime) return 1;
        const priorityWeight = { high: 0, medium: 1, low: 2 };
        return priorityWeight[a.priority] - priorityWeight[b.priority];
      });

    return {
      overdue: sortGroup(overdue),
      today: sortGroup(today),
      tomorrow: sortGroup(tomorrow),
      thisWeek: sortGroup(thisWeek),
      upcoming: sortGroup(upcoming),
      undated: sortGroup(undated),
      finishedOrCancelled,
    };
  }, [filteredTasks, todayIso, tomorrowIso, weekEndIso]);

  // Calendar calculations
  const calendarDays = useMemo(() => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();

    // First day of current month
    const firstDay = new Date(year, month, 1);
    // 0 = Sunday, convert to Monday-first (0 = Monday, 6 = Sunday)
    const startDayIndex = (firstDay.getDay() + 6) % 7;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const days: Array<{
      dateIso: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      isToday: boolean;
      tasks: CompanionTaskRecord[];
    }> = [];

    // Previous month padding
    for (let i = startDayIndex - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const prevMonth = month === 0 ? 11 : month - 1;
      const prevYear = month === 0 ? year - 1 : year;
      const pad = (n: number) => String(n).padStart(2, '0');
      const dateIso = `${prevYear}-${pad(prevMonth + 1)}-${pad(d)}`;
      days.push({
        dateIso,
        dayNumber: d,
        isCurrentMonth: false,
        isToday: dateIso === todayIso,
        tasks: filteredTasks.filter((t) => t.dueDate === dateIso),
      });
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const pad = (n: number) => String(n).padStart(2, '0');
      const dateIso = `${year}-${pad(month + 1)}-${pad(d)}`;
      days.push({
        dateIso,
        dayNumber: d,
        isCurrentMonth: true,
        isToday: dateIso === todayIso,
        tasks: filteredTasks.filter((t) => t.dueDate === dateIso),
      });
    }

    // Next month padding to reach 35 or 42 cells (full weeks)
    const totalSlots = days.length <= 35 ? 35 : 42;
    const remaining = totalSlots - days.length;
    for (let d = 1; d <= remaining; d++) {
      const nextMonth = month === 11 ? 0 : month + 1;
      const nextYear = month === 11 ? year + 1 : year;
      const pad = (n: number) => String(n).padStart(2, '0');
      const dateIso = `${nextYear}-${pad(nextMonth + 1)}-${pad(d)}`;
      days.push({
        dateIso,
        dayNumber: d,
        isCurrentMonth: false,
        isToday: dateIso === todayIso,
        tasks: filteredTasks.filter((t) => t.dueDate === dateIso),
      });
    }

    return days;
  }, [calendarDate, filteredTasks, todayIso]);

  const monthLabel = useMemo(() => {
    return calendarDate.toLocaleDateString('ru-RU', {
      month: 'long',
      year: 'numeric',
    });
  }, [calendarDate]);

  const handlePrevMonth = () => {
    setCalendarDate(
      new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1)
    );
  };

  const handleNextMonth = () => {
    setCalendarDate(
      new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1)
    );
  };

  const handleCurrentMonth = () => {
    const [y, m] = todayIso.split('-');
    setCalendarDate(new Date(Number(y), Number(m) - 1, 1));
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6 pb-28">
      {/* 1. Header & Hero Bar */}
      <section className="glass-panel rounded-2xl p-6 sm:p-7 border border-slate-200/90 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
              <CheckSquare className="w-4 h-4 text-[#00A8B5]" />
              <span>Единый органайзер дел Анны</span>
              <span>·</span>
              <span className="text-slate-700">
                Время в Сызрани:{' '}
                <strong className="font-mono-tabular">
                  {getSyzranNow().timeHHMM}
                </strong>
              </span>
            </div>
            <h1 className="font-display font-black text-2xl sm:text-3xl text-slate-900 tracking-tight">
              Мои задачи
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-2xl">
              Все дела в одном месте: личные задачи, поручения специалистам,
              вопросы из диалогов с Пикселем и напоминания по школам{' '}
              <strong>KIBERone</strong> и <strong>Renderia</strong>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {/* View switcher */}
            <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  viewMode === 'list'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <CheckSquare className="w-3.5 h-3.5 text-[#00A8B5]" />
                <span>Список</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('calendar')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  viewMode === 'calendar'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <CalendarDays className="w-3.5 h-3.5 text-[#FFD700]" />
                <span>Календарь</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => handleOpenCreateModal()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-all shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4 text-[#FFD700]" />
              <span>Новая задача</span>
            </button>
          </div>
        </div>

        {/* Quick Metrics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setStatusFilter('active')}
            className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer ${
              statusFilter === 'active'
                ? 'bg-cyan-50/70 border-[#00A8B5] ring-2 ring-[#00A8B5]/20'
                : 'bg-white/80 border-slate-200/80 hover:bg-white'
            }`}
          >
            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
              Активных дел
            </div>
            <div className="text-lg font-bold text-slate-900 font-mono-tabular">
              {metrics.active}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('waiting_anna_action')}
            className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer ${
              statusFilter === 'waiting_anna_action'
                ? 'bg-purple-50 border-purple-400 ring-2 ring-purple-300'
                : 'bg-white/80 border-slate-200/80 hover:bg-white'
            }`}
          >
            <div className="text-[10px] font-medium text-purple-700 uppercase tracking-wider">
              Ждут действия
            </div>
            <div className="text-lg font-bold text-purple-900 font-mono-tabular">
              {metrics.waitingAnna}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('waiting_response')}
            className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer ${
              statusFilter === 'waiting_response'
                ? 'bg-sky-50 border-sky-400 ring-2 ring-sky-300'
                : 'bg-white/80 border-slate-200/80 hover:bg-white'
            }`}
          >
            <div className="text-[10px] font-medium text-sky-700 uppercase tracking-wider">
              Ждут ответа
            </div>
            <div className="text-lg font-bold text-sky-900 font-mono-tabular">
              {metrics.waitingResponse}
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setStatusFilter('active');
              // scroll to undated group or filter
            }}
            className="p-2.5 rounded-xl text-left bg-white/80 border border-slate-200/80 hover:bg-white transition-all cursor-pointer"
          >
            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
              Без даты
            </div>
            <div className="text-lg font-bold text-slate-700 font-mono-tabular">
              {metrics.undated}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('done')}
            className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer ${
              statusFilter === 'done'
                ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-300'
                : 'bg-white/80 border-slate-200/80 hover:bg-white'
            }`}
          >
            <div className="text-[10px] font-medium text-emerald-700 uppercase tracking-wider">
              Завершено
            </div>
            <div className="text-lg font-bold text-emerald-800 font-mono-tabular">
              {metrics.completed}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-slate-100 border-slate-400 ring-2 ring-slate-300'
                : 'bg-white/80 border-slate-200/80 hover:bg-white'
            }`}
          >
            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
              Всего в базе
            </div>
            <div className="text-lg font-bold text-slate-900 font-mono-tabular">
              {metrics.total}
            </div>
          </button>
        </div>
      </section>

      {/* 2. Search & Filters Bar */}
      <section className="glass-panel rounded-2xl p-4 border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Search box */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по названию, деталям или специалисту…"
              className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#00A8B5]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Filter dropdowns */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter */}
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <span className="font-medium hidden sm:inline">Статус:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00A8B5] cursor-pointer"
              >
                <option value="active">Только активные ({metrics.active})</option>
                <option value="all">Все статусы ({metrics.total})</option>
                <option value="new">Новая</option>
                <option value="in_progress">В работе</option>
                <option value="waiting_response">Ожидает ответа</option>
                <option value="waiting_anna_action">
                  Ожидает действия Анны
                </option>
                <option value="done">Завершена ({metrics.completed})</option>
                <option value="cancelled">Отменена ({metrics.cancelled})</option>
              </select>
            </div>

            {/* School Filter */}
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <span className="font-medium hidden sm:inline">Школа:</span>
              <select
                value={schoolFilter}
                onChange={(e) => setSchoolFilter(e.target.value as SchoolFilter)}
                className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00A8B5] cursor-pointer"
              >
                <option value="all">Все школы</option>
                <option value="kiberone">Только KIBERONE</option>
                <option value="renderia">Только RENDERIA</option>
                <option value="both">Обе школы (общие)</option>
              </select>
            </div>

            {/* Type Filter */}
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <span className="font-medium hidden sm:inline">Тип:</span>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#00A8B5] cursor-pointer"
              >
                <option value="all">Все типы</option>
                <option value="personal">Личные задачи</option>
                <option value="delegation">Поручения специалистам</option>
                <option value="pixel_auto">Из диалога с Пикселем</option>
                <option value="reminder">Напоминания</option>
              </select>
            </div>

            {(searchQuery ||
              statusFilter !== 'active' ||
              schoolFilter !== 'all' ||
              typeFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('active');
                  setSchoolFilter('all');
                  setTypeFilter('all');
                }}
                className="px-2.5 py-1.5 rounded-xl text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                title="Сбросить фильтры"
              >
                Сброс
              </button>
            )}
          </div>
        </div>
      </section>

      {/* 3. CONTENT AREA: LIST VIEW OR CALENDAR VIEW */}
      {viewMode === 'list' ? (
        <div className="space-y-6">
          {/* Overdue Section */}
          {groupedList.overdue.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-rose-700 px-1">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <span>Просроченные дела ({groupedList.overdue.length})</span>
                <span className="text-[11px] font-normal text-rose-500">
                  — срок выполнения уже прошёл
                </span>
              </div>
              <div className="space-y-2.5">
                {groupedList.overdue.map((task) => (
                  <TaskCardItem
                    key={task.id}
                    task={task}
                    onToggleDone={handleToggleDone}
                    onUpdateStatus={handleUpdateStatus}
                    onEdit={handleOpenEditModal}
                    onDelete={onDeleteTask}
                    onNavigateToChat={onOpenSpecialistChat}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Today Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                <CalendarCheck className="w-4 h-4 text-[#00A8B5]" />
                <span>Сегодня, {formatSyzranIsoDateRu(todayIso)}</span>
                <span className="px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-900 text-[11px] font-mono-tabular">
                  {groupedList.today.length}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleOpenCreateModal(todayIso)}
                className="text-xs font-semibold text-[#00A8B5] hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Добавить на сегодня</span>
              </button>
            </div>
            {groupedList.today.length === 0 ? (
              <div className="rounded-2xl p-4 bg-white/70 border border-dashed border-slate-200 text-center text-xs text-slate-500">
                На сегодня пока нет запланированных дел.
              </div>
            ) : (
              <div className="space-y-2.5">
                {groupedList.today.map((task) => (
                  <TaskCardItem
                    key={task.id}
                    task={task}
                    onToggleDone={handleToggleDone}
                    onUpdateStatus={handleUpdateStatus}
                    onEdit={handleOpenEditModal}
                    onDelete={onDeleteTask}
                    onNavigateToChat={onOpenSpecialistChat}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Tomorrow Section */}
          {groupedList.tomorrow.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 px-1">
                <Clock className="w-4 h-4 text-amber-500" />
                <span>Завтра, {formatSyzranIsoDateRu(tomorrowIso)}</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-800 text-[11px] font-mono-tabular">
                  {groupedList.tomorrow.length}
                </span>
              </div>
              <div className="space-y-2.5">
                {groupedList.tomorrow.map((task) => (
                  <TaskCardItem
                    key={task.id}
                    task={task}
                    onToggleDone={handleToggleDone}
                    onUpdateStatus={handleUpdateStatus}
                    onEdit={handleOpenEditModal}
                    onDelete={onDeleteTask}
                    onNavigateToChat={onOpenSpecialistChat}
                  />
                ))}
              </div>
            </div>
          )}

          {/* This Week Section */}
          {groupedList.thisWeek.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 px-1">
                <CalendarDays className="w-4 h-4 text-indigo-500" />
                <span>На этой неделе</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-800 text-[11px] font-mono-tabular">
                  {groupedList.thisWeek.length}
                </span>
              </div>
              <div className="space-y-2.5">
                {groupedList.thisWeek.map((task) => (
                  <TaskCardItem
                    key={task.id}
                    task={task}
                    onToggleDone={handleToggleDone}
                    onUpdateStatus={handleUpdateStatus}
                    onEdit={handleOpenEditModal}
                    onDelete={onDeleteTask}
                    onNavigateToChat={onOpenSpecialistChat}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Upcoming Section */}
          {groupedList.upcoming.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 px-1">
                <CalendarIcon className="w-4 h-4 text-slate-500" />
                <span>Предстоящие дела</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-800 text-[11px] font-mono-tabular">
                  {groupedList.upcoming.length}
                </span>
              </div>
              <div className="space-y-2.5">
                {groupedList.upcoming.map((task) => (
                  <TaskCardItem
                    key={task.id}
                    task={task}
                    onToggleDone={handleToggleDone}
                    onUpdateStatus={handleUpdateStatus}
                    onEdit={handleOpenEditModal}
                    onDelete={onDeleteTask}
                    onNavigateToChat={onOpenSpecialistChat}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 4. Undated Section (Requirement 4: отдельная группа «Без даты», не исчезают!) */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                <CalendarOff className="w-4 h-4 text-slate-500" />
                <span>Без даты ({groupedList.undated.length})</span>
                <span className="text-[11px] font-normal text-slate-500">
                  — дела без жёсткого дедлайна, всегда видны в списке
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleOpenCreateModal()}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Добавить задачу</span>
              </button>
            </div>

            {groupedList.undated.length === 0 ? (
              <div className="rounded-2xl p-4 bg-white/70 border border-slate-200/70 text-center text-xs text-slate-400">
                Нет задач без срока выполнения.
              </div>
            ) : (
              <div className="space-y-2.5">
                {groupedList.undated.map((task) => (
                  <TaskCardItem
                    key={task.id}
                    task={task}
                    isUndatedGroup
                    todayIso={todayIso}
                    tomorrowIso={tomorrowIso}
                    onQuickAssignDate={handleQuickAssignDate}
                    onToggleDone={handleToggleDone}
                    onUpdateStatus={handleUpdateStatus}
                    onEdit={handleOpenEditModal}
                    onDelete={onDeleteTask}
                    onNavigateToChat={onOpenSpecialistChat}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Finished & Cancelled Section */}
          {groupedList.finishedOrCancelled.length > 0 && (
            <div className="space-y-3 pt-4 border-t border-slate-200/80">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>
                    Завершённые и отменённые дела (
                    {groupedList.finishedOrCancelled.length})
                  </span>
                </div>
              </div>
              <div className="space-y-2 opacity-80 hover:opacity-100 transition-opacity">
                {groupedList.finishedOrCancelled.map((task) => (
                  <TaskCardItem
                    key={task.id}
                    task={task}
                    onToggleDone={handleToggleDone}
                    onUpdateStatus={handleUpdateStatus}
                    onEdit={handleOpenEditModal}
                    onDelete={onDeleteTask}
                    onNavigateToChat={onOpenSpecialistChat}
                  />
                ))}
              </div>
            </div>
          )}

          {filteredTasks.length === 0 && (
            <div className="rounded-2xl p-10 bg-white border border-dashed border-slate-200 text-center space-y-3">
              <CheckSquare className="w-10 h-10 text-slate-300 mx-auto" />
              <div className="font-display font-bold text-sm text-slate-800">
                Задачи по выбранным фильтрам не найдены
              </div>
              <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                Попробуйте изменить статус фильтрации или добавьте новую задачу
                для себя или поручение специалисту.
              </p>
              <button
                type="button"
                onClick={() => handleOpenCreateModal()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#FFD700]" />
                <span>Создать первую задачу</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        /* ================= CALENDAR VIEW ================= */
        <div className="space-y-6">
          {/* Calendar Header */}
          <div className="glass-panel rounded-2xl p-4 border border-slate-200/90 shadow-2xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="font-display font-bold text-lg sm:text-xl text-slate-900 capitalize">
                {monthLabel}
              </h2>
              <button
                type="button"
                onClick={handleCurrentMonth}
                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
              >
                Текущий месяц
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePrevMonth}
                aria-label="Предыдущий месяц"
                className="p-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                aria-label="Следующий месяц"
                className="p-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Calendar Grid */}
          <div className="glass-panel rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
            {/* Weekdays header */}
            <div className="grid grid-cols-7 border-b border-slate-200/80 bg-slate-50/90 text-center text-[11px] font-bold text-slate-600 py-2.5">
              <span>Пн</span>
              <span>Вт</span>
              <span>Ср</span>
              <span>Чт</span>
              <span>Пт</span>
              <span className="text-amber-700">Сб</span>
              <span className="text-rose-700">Вс</span>
            </div>

            {/* Days grid */}
            <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-slate-100 bg-slate-100/40">
              {calendarDays.map((day, idx) => {
                const dayTasks = day.tasks;
                const hasTasks = dayTasks.length > 0;
                const isSelected = selectedCalendarDate === day.dateIso;

                return (
                  <div
                    key={`${day.dateIso}-${idx}`}
                    onClick={() => setSelectedCalendarDate(day.dateIso)}
                    className={`min-h-[105px] sm:min-h-[125px] p-1.5 sm:p-2 flex flex-col justify-between transition-colors bg-white ${
                      !day.isCurrentMonth ? 'bg-slate-50/60 opacity-60' : ''
                    } ${
                      day.isToday
                        ? 'ring-2 ring-inset ring-[#00A8B5]/60 bg-cyan-50/15'
                        : ''
                    } ${
                      isSelected
                        ? 'bg-amber-50/30 ring-2 ring-inset ring-amber-400'
                        : ''
                    }`}
                  >
                    {/* Date Number Header */}
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span
                        className={`text-xs font-semibold px-1.5 py-0.5 rounded-md ${
                          day.isToday
                            ? 'bg-[#00A8B5] text-white font-bold'
                            : day.isCurrentMonth
                            ? 'text-slate-800'
                            : 'text-slate-400'
                        }`}
                      >
                        {day.dayNumber}
                      </span>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenCreateModal(day.dateIso);
                        }}
                        title={`Добавить дело на ${day.dateIso}`}
                        className="opacity-0 hover:opacity-100 group-hover:opacity-100 p-0.5 rounded text-slate-400 hover:text-slate-800 transition-opacity cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Day Task Pills */}
                    <div className="space-y-1 flex-1 min-h-0 overflow-y-auto">
                      {dayTasks.slice(0, 3).map((task) => {
                        const isDone = task.status === 'done';
                        const badgeStyle = STATUS_BADGE_STYLES[task.status];
                        const schoolAccent =
                          task.schoolId === 'renderia'
                            ? '#84CC16'
                            : task.schoolId === 'kiberone'
                            ? '#FFD700'
                            : '#00A8B5';

                        return (
                          <div
                            key={task.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEditModal(task);
                            }}
                            className={`group text-[10px] p-1 sm:p-1.5 rounded-lg border transition-all cursor-pointer flex items-center justify-between gap-1 ${
                              isDone
                                ? 'bg-slate-100/80 text-slate-400 line-through border-slate-200'
                                : 'bg-white hover:bg-slate-50 border-slate-200 shadow-2xs hover:border-slate-300'
                            }`}
                            style={{
                              borderLeftWidth: '3px',
                              borderLeftColor: schoolAccent,
                            }}
                            title={`${task.title} (${REAL_TASK_STATUS_LABELS[task.status]})`}
                          >
                            <div className="min-w-0 truncate flex items-center gap-1">
                              {task.dueTime && (
                                <span className="font-mono-tabular font-bold text-[9px] text-slate-500 shrink-0">
                                  {task.dueTime}
                                </span>
                              )}
                              <span
                                className={`truncate ${
                                  isDone ? 'text-slate-400' : 'text-slate-800'
                                } font-medium`}
                              >
                                {task.title}
                              </span>
                            </div>
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${badgeStyle.dot}`}
                            />
                          </div>
                        );
                      })}

                      {dayTasks.length > 3 && (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCalendarDate(day.dateIso);
                          }}
                          className="text-[9px] font-bold text-[#00A8B5] hover:underline px-1 cursor-pointer"
                        >
                          + ещё {dayTasks.length - 3}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Undated Tasks Panel in Calendar View (Requirement 4) */}
          <div className="glass-panel rounded-2xl p-5 border border-slate-200/90 shadow-2xs space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CalendarOff className="w-4 h-4 text-amber-600" />
                <h3 className="font-display font-bold text-sm text-slate-900">
                  Задачи без даты ({groupedList.undated.length})
                </h3>
                <span className="text-xs text-slate-500">
                  Не попадают в сетку календаря, но всегда под рукой
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleOpenCreateModal()}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#00A8B5] hover:underline cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Добавить</span>
              </button>
            </div>

            {groupedList.undated.length === 0 ? (
              <p className="text-xs text-slate-400 py-2">
                Все задачи распределены по датам календаря.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {groupedList.undated.map((task) => {
                  const typeInfo = getTaskTypeInfo(task);
                  const Icon = typeInfo.icon;
                  const isDone = task.status === 'done';

                  return (
                    <div
                      key={task.id}
                      className="p-3 rounded-xl bg-white border border-slate-200 hover:border-slate-300 transition-all flex flex-col justify-between gap-2 shadow-2xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-semibold border ${typeInfo.colorClass}`}
                          >
                            <Icon className="w-3 h-3" />
                            <span>{typeInfo.label}</span>
                          </span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-md font-semibold border ${
                              STATUS_BADGE_STYLES[task.status].bg
                            } ${STATUS_BADGE_STYLES[task.status].text} ${
                              STATUS_BADGE_STYLES[task.status].border
                            }`}
                          >
                            {REAL_TASK_STATUS_LABELS[task.status]}
                          </span>
                        </div>
                        <div
                          className={`text-xs font-bold ${
                            isDone
                              ? 'line-through text-slate-400'
                              : 'text-slate-900'
                          }`}
                        >
                          {task.title}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-1 pt-1 border-t border-slate-100 text-[11px]">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              handleQuickAssignDate(task, todayIso)
                            }
                            className="px-2 py-0.5 rounded bg-cyan-50 text-cyan-800 hover:bg-cyan-100 font-semibold cursor-pointer"
                          >
                            Сегодня
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleQuickAssignDate(task, tomorrowIso)
                            }
                            className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 font-medium cursor-pointer"
                          >
                            Завтра
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(task)}
                          className="p-1 rounded text-slate-400 hover:text-slate-700 cursor-pointer"
                          title="Редактировать задачу"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. MODAL: CREATE / EDIT TASK */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <CheckSquare className="w-5 h-5 text-[#00A8B5]" />
                <h3 className="font-display font-bold text-base text-slate-900">
                  {editingTask ? 'Редактировать дело' : 'Новая задача Анны'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false);
                  setEditingTask(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveForm} className="space-y-3.5 text-xs">
              {/* Title */}
              <div className="space-y-1">
                <label className="block text-slate-700 font-bold">
                  Название задачи <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Что нужно сделать или проверить?"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00A8B5]"
                />
              </div>

              {/* Description */}
              <div className="space-y-1">
                <label className="block text-slate-700 font-medium">
                  Описание или детали
                </label>
                <textarea
                  rows={2}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Дополнительные примечания, контакты или условия…"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00A8B5]"
                />
              </div>

              {/* School & Status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-slate-700 font-medium">
                    Школа
                  </label>
                  <select
                    value={formSchool}
                    onChange={(e) =>
                      setFormSchool(e.target.value as SchoolId | 'both')
                    }
                    className="w-full px-2.5 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800"
                  >
                    <option value="kiberone">KIBERONE</option>
                    <option value="renderia">RENDERIA</option>
                    <option value="both">Обе школы (общая задача)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-slate-700 font-medium">
                    Статус задачи
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) =>
                      setFormStatus(e.target.value as CompanionTaskStatus)
                    }
                    className="w-full px-2.5 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-semibold"
                  >
                    <option value="new">Новая</option>
                    <option value="in_progress">В работе</option>
                    <option value="waiting_response">Ожидает ответа</option>
                    <option value="waiting_anna_action">
                      Ожидает действия Анны
                    </option>
                    <option value="done">Завершена</option>
                    <option value="cancelled">Отменена</option>
                  </select>
                </div>
              </div>

              {/* Date, Time & Priority */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="block text-slate-700 font-medium">
                    Дата выполнения
                  </label>
                  <input
                    type="date"
                    value={formDueDate}
                    onChange={(e) => setFormDueDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-mono-tabular"
                  />
                  <span className="text-[10px] text-slate-400">
                    Оставьте пустым для «Без даты»
                  </span>
                </div>

                <div className="space-y-1">
                  <label className="block text-slate-700 font-medium">
                    Время (Сызрань)
                  </label>
                  <input
                    type="time"
                    value={formDueTime}
                    onChange={(e) => setFormDueTime(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-mono-tabular"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-slate-700 font-medium">
                    Приоритет
                  </label>
                  <select
                    value={formPriority}
                    onChange={(e) =>
                      setFormPriority(e.target.value as CompanionTaskPriority)
                    }
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs bg-white text-slate-800"
                  >
                    <option value="low">Обычный</option>
                    <option value="medium">Средний</option>
                    <option value="high">Высокий (срочно)</option>
                  </select>
                </div>
              </div>

              {/* Reminder date / time */}
              <div className="space-y-1 pt-1 border-t border-slate-100">
                <label className="block text-slate-700 font-medium">
                  Напоминание (дата и время)
                </label>
                <input
                  type="datetime-local"
                  value={formReminderAt}
                  onChange={(e) => setFormReminderAt(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-mono-tabular"
                />
              </div>

              {/* Form Action buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setEditingTask(null);
                  }}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 font-medium cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 transition-colors shadow-xs cursor-pointer"
                >
                  {editingTask ? 'Сохранить изменения' : 'Создать задачу'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// SINGLE TASK CARD COMPONENT
// ============================================================================

interface TaskCardItemProps {
  task: CompanionTaskRecord;
  isUndatedGroup?: boolean;
  todayIso?: string;
  tomorrowIso?: string;
  onQuickAssignDate?: (task: CompanionTaskRecord, date: string) => void;
  onToggleDone: (task: CompanionTaskRecord) => void;
  onUpdateStatus: (
    task: CompanionTaskRecord,
    status: CompanionTaskStatus
  ) => void;
  onEdit: (task: CompanionTaskRecord) => void;
  onDelete: (id: string) => void;
  onNavigateToChat?: (
    mode: AgentMode,
    schoolId: SchoolId,
    sessionId?: string
  ) => void;
}

const TaskCardItem: React.FC<TaskCardItemProps> = ({
  task,
  isUndatedGroup,
  todayIso = toSyzranIsoDate(),
  tomorrowIso = addDaysToIsoDate(toSyzranIsoDate(), 1),
  onQuickAssignDate,
  onToggleDone,
  onUpdateStatus,
  onEdit,
  onDelete,
  onNavigateToChat,
}) => {
  const isDone = task.status === 'done';
  const isCancelled = task.status === 'cancelled';
  const isOverdue =
    !isDone && !isCancelled && task.dueDate && task.dueDate < todayIso;

  const typeInfo = getTaskTypeInfo(task);
  const TypeIcon = typeInfo.icon;
  const statusBadge = STATUS_BADGE_STYLES[task.status];

  const schoolConfig =
    task.schoolId && task.schoolId !== 'both'
      ? SCHOOLS[task.schoolId]
      : null;

  return (
    <div
      data-testid={`task-card-${task.id}`}
      className={`rounded-2xl p-4 bg-white border transition-all duration-150 flex flex-col justify-between gap-3 shadow-2xs ${
        isDone
          ? 'border-slate-200/60 bg-slate-50/50 opacity-75'
          : isCancelled
          ? 'border-slate-200/60 bg-slate-50/50 opacity-60'
          : isOverdue
          ? 'border-rose-300 bg-rose-50/20'
          : task.status === 'waiting_anna_action' ||
            task.status === 'postponed'
          ? 'border-purple-200 bg-purple-50/15'
          : 'border-slate-200/90 hover:border-slate-300'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left: Complete Checkbox + Title & Details */}
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onToggleDone(task)}
            title={
              isDone
                ? 'Нажмите, чтобы вернуть в работу'
                : 'Нажмите, чтобы завершить задачу'
            }
            className={`mt-0.5 w-5 h-5 rounded-lg border flex items-center justify-center shrink-0 transition-all cursor-pointer ${
              isDone
                ? 'bg-emerald-600 border-emerald-600 text-white shadow-2xs'
                : isCancelled
                ? 'bg-slate-300 border-slate-300 text-white'
                : 'border-slate-300 hover:border-[#00A8B5] hover:scale-105'
            }`}
          >
            {isDone && <Check className="w-3.5 h-3.5" />}
            {isCancelled && <X className="w-3.5 h-3.5" />}
          </button>

          <div className="space-y-1.5 min-w-0 flex-1">
            {/* Badges Bar: Task Type, Status, School, Priority */}
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Type Badge */}
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md border ${typeInfo.colorClass}`}
              >
                <TypeIcon className="w-3 h-3" />
                <span>{typeInfo.label}</span>
              </span>

              {/* Status Selector Dropdown */}
              <div className="relative inline-flex items-center">
                <select
                  value={task.status}
                  onChange={(e) =>
                    onUpdateStatus(
                      task,
                      e.target.value as CompanionTaskStatus
                    )
                  }
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border cursor-pointer appearance-none pr-5 ${statusBadge.bg} ${statusBadge.text} ${statusBadge.border}`}
                >
                  <option value="new">Новая</option>
                  <option value="in_progress">В работе</option>
                  <option value="waiting_response">Ожидает ответа</option>
                  <option value="waiting_anna_action">
                    Ожидает действия Анны
                  </option>
                  <option value="done">Завершена</option>
                  <option value="cancelled">Отменена</option>
                </select>
                <ChevronDown className="w-3 h-3 text-current opacity-60 absolute right-1.5 pointer-events-none" />
              </div>

              {/* School Badge */}
              {schoolConfig ? (
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                    task.schoolId === 'kiberone'
                      ? 'bg-[#FFD700] text-slate-950'
                      : 'bg-[#84CC16] text-slate-950'
                  }`}
                >
                  {schoolConfig.name}
                </span>
              ) : (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                  Обе школы
                </span>
              )}

              {/* Priority */}
              {task.priority === 'high' && !isDone && !isCancelled && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800">
                  Срочно
                </span>
              )}
            </div>

            {/* Task Title */}
            <div
              className={`font-semibold text-xs sm:text-sm break-words ${
                isDone
                  ? 'line-through text-slate-400'
                  : isCancelled
                  ? 'line-through text-slate-400'
                  : 'text-slate-900'
              }`}
            >
              {task.title}
            </div>

            {/* Date and Time Details */}
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 font-medium">
              {task.dueDate ? (
                <span className="inline-flex items-center gap-1">
                  <CalendarIcon className="w-3.5 h-3.5 text-[#00A8B5]" />
                  <span
                    className={
                      isOverdue
                        ? 'text-rose-600 font-bold'
                        : task.dueDate === todayIso
                        ? 'text-cyan-800 font-bold'
                        : 'text-slate-700'
                    }
                  >
                    {formatSyzranIsoDateRu(task.dueDate)}
                  </span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-slate-400">
                  <CalendarOff className="w-3.5 h-3.5" />
                  <span>Без даты</span>
                </span>
              )}

              {task.dueTime && (
                <span className="inline-flex items-center gap-1 font-mono-tabular text-cyan-900 bg-cyan-50 px-1.5 py-0.5 rounded border border-cyan-200/60">
                  <Clock className="w-3 h-3 text-[#00A8B5]" />
                  <span>{task.dueTime}</span>
                </span>
              )}

              {task.reminderAt && !isDone && (
                <span className="inline-flex items-center gap-1 text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                  <Bell className="w-3 h-3 text-amber-600" />
                  <span>Напоминание настроено</span>
                </span>
              )}
            </div>

            {/* Description */}
            {task.description && (
              <div className="text-xs text-slate-600 whitespace-pre-line leading-relaxed pt-0.5">
                {task.description}
              </div>
            )}

            {/* Specialist Delegation Link (Requirement 5) */}
            {(task.linkedSpecialistId || task.linkedDelegationTaskId) && (
              <div className="mt-2 p-2.5 rounded-xl bg-indigo-50/80 border border-indigo-200/90 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-indigo-600 shrink-0" />
                  <div className="space-y-0.5">
                    <div className="font-bold text-indigo-950">
                      Связано с поручением:{' '}
                      {task.linkedSpecialistId
                        ? AGENT_MODES[task.linkedSpecialistId].title
                        : 'ИИ-специалисту'}
                    </div>
                    <div className="text-[11px] text-indigo-800">
                      Статус поручения:{' '}
                      <strong className="underline">
                        {REAL_TASK_STATUS_LABELS[task.status]}
                      </strong>
                    </div>
                  </div>
                </div>

                {onNavigateToChat && task.linkedSpecialistId && (
                  <button
                    type="button"
                    onClick={() =>
                      onNavigateToChat(
                        task.linkedSpecialistId!,
                        (task.schoolId && task.schoolId !== 'both'
                          ? task.schoolId
                          : 'kiberone') as SchoolId,
                        task.linkedChatId
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold hover:bg-indigo-700 transition-colors shadow-2xs cursor-pointer"
                  >
                    <span>Открыть диалог</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Quick Date buttons for undated tasks */}
          {isUndatedGroup && onQuickAssignDate && (
            <div className="hidden sm:flex items-center gap-1 mr-1">
              <button
                type="button"
                onClick={() => onQuickAssignDate(task, todayIso)}
                className="px-2 py-1 rounded-lg bg-cyan-50 text-cyan-800 hover:bg-cyan-100 text-[11px] font-semibold cursor-pointer"
              >
                На сегодня
              </button>
              <button
                type="button"
                onClick={() => onQuickAssignDate(task, tomorrowIso)}
                className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-[11px] font-medium cursor-pointer"
              >
                На завтра
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => onEdit(task)}
            title="Редактировать"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(task.id)}
            title="Удалить"
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
