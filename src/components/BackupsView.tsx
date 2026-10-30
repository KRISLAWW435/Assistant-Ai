import React, { useRef } from 'react';
import {
  Archive,
  BookOpen,
  CheckCircle2,
  Database,
  Download,
  HardDrive,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import {
  ChatSession,
  KnowledgeBaseBySchool,
  NavSection,
  SchoolId,
  UploadedDocumentRecord,
} from '../types/assistant';
import { KNOWLEDGE_CATEGORIES, SCHOOLS } from '../config/schoolsAndModes';
import { DB_NAME, DB_VERSION } from '../storage/indexedDb';

interface BackupsViewProps {
  activeSchool: SchoolId;
  onNavigate: (section: NavSection) => void;
  sessions: ChatSession[];
  knowledgeBase: KnowledgeBaseBySchool;
  uploadedDocuments: UploadedDocumentRecord[];
  companionMessagesCount?: number;
  companionMemoriesCount?: number;
  companionTasksCount?: number;
  onTriggerExportBackup: () => void;
  onTriggerImportBackup: (file: File) => void;
  statusBanner: string | null;
  onDismissBanner: () => void;
}

export const BackupsView: React.FC<BackupsViewProps> = ({
  activeSchool,
  onNavigate,
  sessions,
  knowledgeBase,
  uploadedDocuments,
  companionMessagesCount = 0,
  companionMemoriesCount = 0,
  companionTasksCount = 0,
  onTriggerExportBackup,
  onTriggerImportBackup,
  statusBanner,
  onDismissBanner,
}) => {
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  const pinnedSessionsCount = sessions.filter((s) => s.isPinned).length;
  const totalMessages = sessions.reduce((acc, s) => acc + s.messages.length, 0);
  const totalDialogueFiles = sessions.reduce(
    (acc, s) => acc + (s.attachments?.length || 0),
    0
  );
  const kiberoneFilled = KNOWLEDGE_CATEGORIES.filter(
    (c) => (knowledgeBase.kiberone[c.key] || '').trim().length > 0
  ).length;
  const renderiaFilled = KNOWLEDGE_CATEGORIES.filter(
    (c) => (knowledgeBase.renderia[c.key] || '').trim().length > 0
  ).length;
  const kiberoneDocs = uploadedDocuments.filter(
    (d) => d.schoolId === 'kiberone'
  ).length;
  const renderiaDocs = uploadedDocuments.filter(
    (d) => d.schoolId === 'renderia'
  ).length;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onTriggerImportBackup(file);
    e.target.value = '';
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs">
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0">
            <Archive
              className={`w-6 h-6 ${
                activeSchool === 'renderia'
                  ? 'text-[#84CC16]'
                  : 'text-[#F5B800]'
              }`}
            />
          </div>
          <div>
            <h1 className="font-display font-bold text-xl text-slate-900">
              Резервное копирование и восстановление
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 mt-0.5 leading-relaxed">
              Экспорт всех диалогов, сообщений, документов, Базы знаний обеих
              школ и данных ИИ-компаньона «Пиксель» в один файл{' '}
              <code>.json</code> и транзакционное восстановление.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onTriggerExportBackup}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors shrink-0 self-start sm:self-auto shadow-xs"
        >
          <Download
            className={`w-4 h-4 ${
              activeSchool === 'renderia'
                ? 'text-[#84CC16]'
                : 'text-[#F5B800]'
            }`}
          />
          <span>Создать резервную копию</span>
        </button>
      </div>

      {statusBanner && (
        <div className="rounded-xl px-4 py-3 bg-[#00A8B5]/10 border border-[#00A8B5]/40 text-xs text-slate-800 flex items-center justify-between gap-3">
          <span>{statusBanner}</span>
          <button
            type="button"
            onClick={onDismissBanner}
            className="font-semibold text-[#00A8B5] hover:underline shrink-0"
          >
            Понятно
          </button>
        </div>
      )}

      {/* IndexedDB Live Statistics */}
      <div className="rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 space-y-4 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-[#00A8B5]" />
            <h2 className="font-display font-bold text-base text-slate-900">
              Состояние локальной базы данных IndexedDB
            </h2>
          </div>
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-800">
            <CheckCircle2 className="w-3 h-3" />
            Хранилище активно (v{DB_VERSION})
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="rounded-xl p-3.5 bg-slate-50 border border-slate-200/80">
            <div className="text-[11px] text-slate-500">Диалогов в базе</div>
            <div className="font-mono-tabular font-bold text-lg text-slate-900 mt-0.5">
              {sessions.length}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Закреплено: {pinnedSessionsCount}
            </div>
          </div>

          <div className="rounded-xl p-3.5 bg-slate-50 border border-slate-200/80">
            <div className="text-[11px] text-slate-500">Сообщений в чатах</div>
            <div className="font-mono-tabular font-bold text-lg text-slate-900 mt-0.5">
              {totalMessages}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Файлов чатов: {totalDialogueFiles}
            </div>
          </div>

          <div className="rounded-xl p-3.5 bg-slate-50 border border-slate-200/80">
            <div className="text-[11px] text-slate-500">
              Школа {SCHOOLS.kiberone.name}
            </div>
            <div className="font-mono-tabular font-bold text-lg text-slate-900 mt-0.5">
              {kiberoneFilled} / {KNOWLEDGE_CATEGORIES.length} разд.
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Документов: {kiberoneDocs}
            </div>
          </div>

          <div className="rounded-xl p-3.5 bg-slate-50 border border-slate-200/80">
            <div className="text-[11px] text-slate-500">
              Школа {SCHOOLS.renderia.name}
            </div>
            <div className="font-mono-tabular font-bold text-lg text-slate-900 mt-0.5">
              {renderiaFilled} / {KNOWLEDGE_CATEGORIES.length} разд.
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Документов: {renderiaDocs}
            </div>
          </div>

          <div className="rounded-xl p-3.5 bg-slate-50 border border-slate-200/80 col-span-2 sm:col-span-1">
            <div className="text-[11px] text-slate-500">Помощник Пиксель</div>
            <div className="font-mono-tabular font-bold text-lg text-slate-900 mt-0.5">
              {companionTasksCount} задач
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Память: {companionMemoriesCount} · Чат: {companionMessagesCount}
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2 pt-1">
          <span>
            Имя базы данных: <code>{DB_NAME}</code> (схема v{DB_VERSION})
          </span>
          <span>
            Таблицы: <code>sessions</code>, <code>messages</code>,{' '}
            <code>knowledge_base</code>, <code>documents</code>,{' '}
            <code>companion_messages</code>, <code>companion_memory</code>,{' '}
            <code>companion_tasks</code>, <code>companion_preferences</code>
          </span>
        </div>
      </div>

      {/* Export / Import Controls */}
      <div className="rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 space-y-4 shadow-2xs">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-slate-700" />
          <h2 className="font-display font-bold text-base text-slate-900">
            Управление файлами резервных копий (.json)
          </h2>
        </div>

        <div className="rounded-xl p-4 bg-slate-50 border border-slate-200/80 space-y-2 text-xs text-slate-600 leading-relaxed">
          <div className="flex items-center gap-2 font-semibold text-slate-900">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Что входит в полную резервную копию:</span>
          </div>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Все диалоги обеих школ и 4 специалистов (включая статус
              закрепления и прикреплённые к диалогам файлы).
            </li>
            <li>Все сообщения в истории переписки.</li>
            <li>
              Все 8 разделов Базы знаний для школы <strong>KIBERone</strong> и 8
              разделов для школы <strong>Renderia</strong>.
            </li>
            <li>
              Все загруженные документы школ вместе с их извлечённым текстом и
              статусами обработки.
            </li>
            <li>
              Все данные ИИ-компаньона «Пиксель»: личный чат с Анной, задачи и
              сроки («Список дел Анны»), подтверждённые факты памяти об Анне и
              настройки режима помощника.
            </li>
            <li>
              Настройки рабочего пространства (активная школа и состояние
              боковых панелей).
            </li>
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            onClick={onTriggerExportBackup}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-2xs"
          >
            <Download
              className={`w-4 h-4 ${
                activeSchool === 'renderia'
                  ? 'text-[#84CC16]'
                  : 'text-[#F5B800]'
              }`}
            />
            <span>Создать резервную копию</span>
          </button>

          <input
            ref={backupInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => backupInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-100 text-slate-800 hover:bg-slate-200 transition-colors"
          >
            <Upload className="w-4 h-4 text-[#00A8B5]" />
            <span>Восстановить из копии (.json)</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('knowledge')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <BookOpen className="w-4 h-4 text-[#00A8B5]" />
            <span>Перейти в Базу знаний</span>
          </button>
        </div>
      </div>
    </div>
  );
};
