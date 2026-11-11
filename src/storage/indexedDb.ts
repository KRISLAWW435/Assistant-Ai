import {
  AgentMode,
  ChatAttachment,
  ChatMessage,
  ChatSession,
  CompanionHousePose,
  CompanionMemoryCategory,
  CompanionMemoryRecord,
  CompanionMessage,
  CompanionMoodState,
  CompanionPreferencesRecord,
  CompanionTaskPriority,
  CompanionTaskRecord,
  CompanionTaskStatus,
  DocumentProcessingStatus,
  KnowledgeBaseBySchool,
  KnowledgeCategoryKey,
  SchoolId,
  UploadedDocumentRecord,
  WorkspaceBackupSettings,
} from '../types/assistant';
import {
  createEmptyKnowledgeBase,
  DEFAULT_GENERAL_BUSINESS_INFO,
  KNOWLEDGE_CATEGORIES,
} from '../config/schoolsAndModes';

export const DB_NAME = 'kiberone_renderia_assistant_db';
export const DB_VERSION = 3;

export const STORE_SESSIONS = 'sessions';
export const STORE_MESSAGES = 'messages';
export const STORE_KNOWLEDGE = 'knowledge_base';
export const STORE_DOCUMENTS = 'documents';

export const STORE_COMPANION_MESSAGES = 'companion_messages';
export const STORE_COMPANION_MEMORY = 'companion_memory';
export const STORE_COMPANION_TASKS = 'companion_tasks';
export const STORE_COMPANION_PREFERENCES = 'companion_preferences';

export const BACKUP_FORMAT_ID = 'kiberone_renderia_assistant_backup';
export const BACKUP_FORMAT_VERSION = 1;

export interface StoredSessionRecord {
  id: string;
  title: string;
  schoolId: SchoolId;
  mode: ChatSession['mode'];
  isPinned?: boolean;
  createdAt: string;
  updatedAt: string;
  createdAtMs: number;
  updatedAtMs: number;
  attachments?: ChatAttachment[];
  linkedHandoffPacket?: ChatSession['linkedHandoffPacket'];
  designArtifacts?: ChatSession['designArtifacts'];
}

export interface StoredKnowledgeCategoryRecord {
  id: string; // `${schoolId}:${categoryKey}`
  schoolId: SchoolId;
  categoryKey: KnowledgeCategoryKey;
  content: string;
  updatedAt: string;
  updatedAtMs: number;
}

export interface LoadedWorkspaceData {
  sessions: ChatSession[];
  knowledgeBase: KnowledgeBaseBySchool;
  documents: UploadedDocumentRecord[];
  companionMessages: CompanionMessage[];
  companionMemory: CompanionMemoryRecord[];
  companionTasks: CompanionTaskRecord[];
  companionPreferences: CompanionPreferencesRecord;
}

export interface BackupArchiveV1 {
  backupFormat: typeof BACKUP_FORMAT_ID;
  backupVersion: number;
  dbVersion: number;
  exportedAt: string;
  exportedAtFormatted: string;
  workspaceSettings: WorkspaceBackupSettings;
  data: {
    sessions: StoredSessionRecord[];
    messages: ChatMessage[];
    knowledgeBase: StoredKnowledgeCategoryRecord[];
    documents: UploadedDocumentRecord[];
    companionMessages?: CompanionMessage[];
    companionMemory?: CompanionMemoryRecord[];
    companionTasks?: CompanionTaskRecord[];
    companionPreferences?: CompanionPreferencesRecord;
  };
}

export interface ValidatedBackupSummary {
  exportedAtFormatted: string;
  backupVersion: number;
  sessionsCount: number;
  messagesCount: number;
  dialogueAttachmentsCount: number;
  kiberoneCategoriesFilled: number;
  renderiaCategoriesFilled: number;
  documentsCount: number;
  companionMessagesCount: number;
  companionMemoriesCount: number;
  companionTasksCount: number;
  archive: BackupArchiveV1;
}

const SCHOOL_IDS: SchoolId[] = ['kiberone', 'renderia'];
const VALID_MODES = new Set<AgentMode>([
  'marketer',
  'manager',
  'methodist',
  'analyst',
  'designer',
]);
const VALID_CATEGORIES = new Set<KnowledgeCategoryKey>(
  KNOWLEDGE_CATEGORIES.map((c) => c.key)
);

const VALID_MEMORY_CATEGORIES = new Set<CompanionMemoryCategory>([
  'profile',
  'projects',
  'preferences',
  'decisions',
]);

const VALID_TASK_STATUSES = new Set<CompanionTaskStatus>([
  'new',
  'in_progress',
  'waiting_response',
  'waiting_anna_action',
  'done',
  'cancelled',
  'postponed',
]);

const VALID_TASK_PRIORITIES = new Set<CompanionTaskPriority>([
  'low',
  'medium',
  'high',
]);

function formatDateTimeRu(date: Date = new Date()): string {
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTimeShortRu(date: Date = new Date()): string {
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function createDefaultCompanionPreferences(): CompanionPreferencesRecord {
  const nowMs = Date.now();
  return {
    id: 'pixel_state',
    quietMode: false,
    breakRemindersEnabled: true,
    proactiveTipsEnabled: true,
    activeWorkElapsedMs: 0,
    breakSnoozeUntilMs: null,
    lastActiveInteractionMs: nowMs,
    lastAutonomousMessageMs: nowMs,
    mood: 'happy',
    housePose: 'outside',
    collapsed: false,
  };
}

export function createInitialCompanionGreetingMessage(): CompanionMessage {
  const now = new Date();
  return {
    id: 'pixel-msg-welcome-initial',
    role: 'pixel',
    content:
      'Привет, Анна! Я Пиксель — ваш надёжный напарник, цифровой помощник и компаньон. Меня создала Кристина с любовью для вас, чтобы помогать в управлении рабочими процессами школ KIBERone и Renderia, координировать задачи со специалистами, структурировать дела и поддерживать вас каждый день.',
    createdAt: formatTimeShortRu(now),
    createdAtMs: now.getTime(),
    usedContextLabels: ['Приветствие Пикселя'],
  };
}

/**
 * Sorts sessions with pinned sessions first, and within each group from newest to oldest by updatedAtMs.
 */
export function sortSessionsPinnedAndUpdatedDesc(
  list: ChatSession[]
): ChatSession[] {
  return list.slice().sort((a, b) => {
    const aPinned = Boolean(a.isPinned);
    const bPinned = Boolean(b.isPinned);
    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }
    return (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Opens and initializes the IndexedDB database with safe migration from v1/v2 to v3.
 * Never clears or deletes existing records during version upgrades.
 */
export function openAssistantDatabase(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      dbPromise = null;
      reject(
        new Error('IndexedDB не поддерживается в текущем окружении браузера.')
      );
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;

      // 1. Sessions store
      let sessionStore: IDBObjectStore;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        sessionStore = db.createObjectStore(STORE_SESSIONS, {
          keyPath: 'id',
        });
        sessionStore.createIndex('by_school', 'schoolId', { unique: false });
        sessionStore.createIndex('by_mode', 'mode', { unique: false });
        sessionStore.createIndex('by_school_mode', ['schoolId', 'mode'], {
          unique: false,
        });
        sessionStore.createIndex('by_updated_at', 'updatedAtMs', {
          unique: false,
        });
      } else if (tx) {
        sessionStore = tx.objectStore(STORE_SESSIONS);
      } else {
        sessionStore = null as unknown as IDBObjectStore;
      }

      // 2. Messages store
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const messageStore = db.createObjectStore(STORE_MESSAGES, {
          keyPath: 'id',
        });
        messageStore.createIndex('by_session', 'sessionId', { unique: false });
        messageStore.createIndex('by_created_at', 'createdAtMs', {
          unique: false,
        });
      }

      // 3. Knowledge base store (separate records per school & category)
      if (!db.objectStoreNames.contains(STORE_KNOWLEDGE)) {
        const knowledgeStore = db.createObjectStore(STORE_KNOWLEDGE, {
          keyPath: 'id',
        });
        knowledgeStore.createIndex('by_school', 'schoolId', { unique: false });
        knowledgeStore.createIndex(
          'by_school_category',
          ['schoolId', 'categoryKey'],
          { unique: true }
        );
      }

      // 4. Documents store
      if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
        const docStore = db.createObjectStore(STORE_DOCUMENTS, {
          keyPath: 'id',
        });
        docStore.createIndex('by_school', 'schoolId', { unique: false });
        docStore.createIndex('by_category', 'categoryKey', { unique: false });
        docStore.createIndex(
          'by_school_category',
          ['schoolId', 'categoryKey'],
          { unique: false }
        );
        docStore.createIndex('by_created_at', 'createdAtMs', { unique: false });
      }

      // 5. Companion messages store (new in v3)
      if (!db.objectStoreNames.contains(STORE_COMPANION_MESSAGES)) {
        const compMsgStore = db.createObjectStore(STORE_COMPANION_MESSAGES, {
          keyPath: 'id',
        });
        compMsgStore.createIndex('by_created_at', 'createdAtMs', {
          unique: false,
        });
      }

      // 6. Companion memory store (new in v3)
      if (!db.objectStoreNames.contains(STORE_COMPANION_MEMORY)) {
        const compMemStore = db.createObjectStore(STORE_COMPANION_MEMORY, {
          keyPath: 'id',
        });
        compMemStore.createIndex('by_category', 'category', { unique: false });
        compMemStore.createIndex('by_updated_at', 'updatedAtMs', {
          unique: false,
        });
      }

      // 7. Companion tasks store (new in v3)
      if (!db.objectStoreNames.contains(STORE_COMPANION_TASKS)) {
        const compTaskStore = db.createObjectStore(STORE_COMPANION_TASKS, {
          keyPath: 'id',
        });
        compTaskStore.createIndex('by_status', 'status', { unique: false });
        compTaskStore.createIndex('by_due_date', 'dueDate', { unique: false });
      }

      // 8. Companion preferences store (new in v3)
      if (!db.objectStoreNames.contains(STORE_COMPANION_PREFERENCES)) {
        db.createObjectStore(STORE_COMPANION_PREFERENCES, {
          keyPath: 'id',
        });
      }

      // Safe migration from v1 -> v2+: normalize existing sessions with isPinned boolean without losing any records
      if (event.oldVersion >= 1 && event.oldVersion < 2 && sessionStore) {
        const cursorReq = sessionStore.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            const val = cursor.value as StoredSessionRecord;
            if (
              typeof val.isPinned !== 'boolean' ||
              !Array.isArray(val.attachments)
            ) {
              cursor.update({
                ...val,
                isPinned: Boolean(val.isPinned),
                attachments: Array.isArray(val.attachments)
                  ? val.attachments
                  : [],
              });
            }
            cursor.continue();
          }
        };
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(
        request.error ||
          new Error('Не удалось открыть локальную базу данных IndexedDB.')
      );
    };

    request.onblocked = () => {
      dbPromise = null;
      reject(
        new Error(
          'База данных IndexedDB заблокирована другой открытой вкладкой.'
        )
      );
    };
  });

  return dbPromise;
}

function getAllFromStore<T>(
  store: IDBObjectStore | IDBIndex,
  query?: IDBValidKey | IDBKeyRange | null
): Promise<T[]> {
  return new Promise<T[]>((resolve, reject) => {
    const req = query ? store.getAll(query) : store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) || []);
    req.onerror = () => reject(req.error);
  });
}

function toStoredSessionRecord(session: ChatSession): StoredSessionRecord {
  const nowMs = Date.now();
  return {
    id: session.id,
    title: session.title,
    schoolId: session.schoolId,
    mode: session.mode,
    isPinned: Boolean(session.isPinned),
    createdAt: session.createdAt || session.updatedAt,
    updatedAt: session.updatedAt,
    createdAtMs: session.createdAtMs ?? nowMs,
    updatedAtMs: session.updatedAtMs ?? nowMs,
    attachments: session.attachments || [],
    linkedHandoffPacket: session.linkedHandoffPacket,
    designArtifacts: Array.isArray(session.designArtifacts) ? session.designArtifacts : undefined,
  };
}

function assembleLoadedWorkspaceData(
  rawSessions: StoredSessionRecord[],
  rawMessages: ChatMessage[],
  rawKnowledge: StoredKnowledgeCategoryRecord[],
  rawDocuments: UploadedDocumentRecord[],
  rawCompanionMessages: CompanionMessage[],
  rawCompanionMemory: CompanionMemoryRecord[],
  rawCompanionTasks: CompanionTaskRecord[],
  rawCompanionPreferences: CompanionPreferencesRecord | undefined
): LoadedWorkspaceData {
  // 1. Assemble KnowledgeBaseBySchool with strict school separation
  const knowledgeBase = createEmptyKnowledgeBase();
  for (const rec of rawKnowledge) {
    if (
      (rec.schoolId === 'kiberone' || rec.schoolId === 'renderia') &&
      rec.categoryKey in knowledgeBase[rec.schoolId]
    ) {
      knowledgeBase[rec.schoolId][rec.categoryKey] = rec.content ?? '';
    } else if (
      rec.schoolId === 'all' &&
      ((rec.categoryKey as string) === 'general_business' || (rec.categoryKey as string) === 'general_business_info')
    ) {
      if (rec.content && rec.content.trim().length > 0) {
        const isLegacyDefault =
          rec.content.includes('подростки 12–18 лет') ||
          (rec.content.includes('Экосистема объединяет два взаимодополняющих') &&
            !rec.content.includes('Формат обучения (обе школы)'));
        knowledgeBase.generalBusinessInfo = isLegacyDefault
          ? DEFAULT_GENERAL_BUSINESS_INFO
          : rec.content;
      }
    }
  }

  // 2. Group messages by sessionId and sort chronologically (normalizing any stale isStreaming flag)
  const messagesBySessionId = new Map<string, ChatMessage[]>();
  for (const rawMsg of rawMessages) {
    if (!rawMsg.sessionId) continue;
    const msg: ChatMessage = rawMsg.isStreaming
      ? {
          ...rawMsg,
          isStreaming: false,
          isError: !rawMsg.content?.trim() ? true : rawMsg.isError,
          content:
            rawMsg.content?.trim() ||
            'Генерация ответа была прервана до завершения. Вы можете нажать «Повторить отправку».',
        }
      : rawMsg;
    const list = messagesBySessionId.get(msg.sessionId) || [];
    list.push(msg);
    messagesBySessionId.set(msg.sessionId, list);
  }

  for (const list of messagesBySessionId.values()) {
    list.sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));
  }

  // 3. Hydrate sessions and sort by pinned first, then updatedAtMs desc
  const hydratedSessions: ChatSession[] = sortSessionsPinnedAndUpdatedDesc(
    rawSessions.map((s) => {
      const sessMessages = messagesBySessionId.get(s.id) || [];
      const sessAttachments: ChatAttachment[] = Array.isArray(s.attachments)
        ? s.attachments
        : [];

      if (sessAttachments.length === 0 && sessMessages.length > 0) {
        const seenIds = new Set<string>();
        for (const m of sessMessages) {
          if (m.attachmentMeta && !seenIds.has(m.attachmentMeta.id)) {
            seenIds.add(m.attachmentMeta.id);
            sessAttachments.push({
              id: m.attachmentMeta.id,
              name: m.attachmentMeta.name,
              extension: m.attachmentMeta.extension,
              sizeBytes: m.attachmentMeta.sizeBytes,
              extractedText: '',
              status: m.attachmentMeta.status || 'processed',
              createdAt: m.createdAt,
              createdAtMs: m.createdAtMs,
              messageId: m.id,
            });
          }
        }
      }

      return {
        id: s.id,
        title: s.title,
        schoolId: s.schoolId,
        mode: s.mode,
        isPinned: Boolean(s.isPinned),
        createdAt: s.createdAt || s.updatedAt,
        updatedAt: s.updatedAt,
        createdAtMs: s.createdAtMs,
        updatedAtMs: s.updatedAtMs,
        messages: sessMessages,
        attachments: sessAttachments,
        linkedHandoffPacket: s.linkedHandoffPacket,
        designArtifacts: Array.isArray(s.designArtifacts) ? s.designArtifacts : undefined,
      };
    })
  );

  // 4. Sort documents by creation date descending
  const sortedDocuments = rawDocuments
    .slice()
    .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));

  // 5. Sort companion messages chronologically (normalizing any stale isStreaming flag or interrupted delegation task)
  const sortedCompanionMessages = rawCompanionMessages
    .map((m) => {
      let normalized = m;
      if (normalized.isStreaming) {
        normalized = {
          ...normalized,
          isStreaming: false,
          isError: !normalized.content?.trim() ? true : normalized.isError,
          content:
            normalized.content?.trim() ||
            'Генерация ответа Пикселя была прервана. Вы можете повторить отправку.',
        };
      }
      if (
        normalized.delegatedTask &&
        normalized.delegatedTask.status !== 'completed' &&
        normalized.delegatedTask.status !== 'error' &&
        normalized.delegatedTask.status !== 'waiting_for_reply'
      ) {
        normalized = {
          ...normalized,
          delegatedTask: {
            ...normalized.delegatedTask,
            status: 'error',
            statusLabelRu: 'Ошибка',
            errorMessage:
              'Выполнение поручения было прервано при перезагрузке страницы.',
          },
        };
      }
      return normalized;
    })
    .sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));

  // 6. Sort companion memories by updatedAtMs descending
  const sortedCompanionMemory = rawCompanionMemory
    .slice()
    .sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));

  // 7. Sort companion tasks: active first, then by due date / createdAtMs
  const sortedCompanionTasks = rawCompanionTasks.slice().sort((a, b) => {
    const aFinished = a.status === 'done' || a.status === 'cancelled';
    const bFinished = b.status === 'done' || b.status === 'cancelled';
    if (aFinished !== bFinished) return aFinished ? 1 : -1;
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate);
    }
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0);
  });

  const preferences = rawCompanionPreferences || createDefaultCompanionPreferences();

  return {
    sessions: hydratedSessions,
    knowledgeBase,
    documents: sortedDocuments,
    companionMessages: sortedCompanionMessages,
    companionMemory: sortedCompanionMemory,
    companionTasks: sortedCompanionTasks,
    companionPreferences: preferences,
  };
}

/**
 * Loads all saved sessions, messages, knowledge base categories (both schools), documents,
 * and Pixel companion entities on application startup.
 */
export async function initAndLoadWorkspaceData(): Promise<LoadedWorkspaceData> {
  let electronMirroredTasks: CompanionTaskRecord[] = [];
  if (typeof window !== 'undefined' && window.electronAPI?.companionTasks?.loadAll) {
    try {
      const loaded = await window.electronAPI.companionTasks.loadAll();
      if (Array.isArray(loaded)) {
        electronMirroredTasks = loaded;
      }
    } catch {
      // ignore Electron disk mirror read failure
    }
  }

  const db = await openAssistantDatabase();

  return new Promise<LoadedWorkspaceData>((resolve, reject) => {
    const tx = db.transaction(
      [
        STORE_SESSIONS,
        STORE_MESSAGES,
        STORE_KNOWLEDGE,
        STORE_DOCUMENTS,
        STORE_COMPANION_MESSAGES,
        STORE_COMPANION_MEMORY,
        STORE_COMPANION_TASKS,
        STORE_COMPANION_PREFERENCES,
      ],
      'readwrite'
    );

    const sessionStore = tx.objectStore(STORE_SESSIONS);
    const messageStore = tx.objectStore(STORE_MESSAGES);
    const knowledgeStore = tx.objectStore(STORE_KNOWLEDGE);
    const documentStore = tx.objectStore(STORE_DOCUMENTS);
    const compMsgStore = tx.objectStore(STORE_COMPANION_MESSAGES);
    const compMemStore = tx.objectStore(STORE_COMPANION_MEMORY);
    const compTaskStore = tx.objectStore(STORE_COMPANION_TASKS);
    const compPrefStore = tx.objectStore(STORE_COMPANION_PREFERENCES);

    let rawSessions: StoredSessionRecord[] = [];
    let rawMessages: ChatMessage[] = [];
    let rawKnowledge: StoredKnowledgeCategoryRecord[] = [];
    let rawDocuments: UploadedDocumentRecord[] = [];
    let rawCompMessages: CompanionMessage[] = [];
    let rawCompMemory: CompanionMemoryRecord[] = [];
    let rawCompTasks: CompanionTaskRecord[] = [];
    let rawCompPreferences: CompanionPreferencesRecord | undefined;

    Promise.all([
      getAllFromStore<StoredSessionRecord>(sessionStore),
      getAllFromStore<ChatMessage>(messageStore),
      getAllFromStore<StoredKnowledgeCategoryRecord>(knowledgeStore),
      getAllFromStore<UploadedDocumentRecord>(documentStore),
      getAllFromStore<CompanionMessage>(compMsgStore),
      getAllFromStore<CompanionMemoryRecord>(compMemStore),
      getAllFromStore<CompanionTaskRecord>(compTaskStore),
      getAllFromStore<CompanionPreferencesRecord>(compPrefStore),
    ])
      .then(
        ([
          sessionsList,
          messagesList,
          knowledgeList,
          documentsList,
          compMsgList,
          compMemList,
          compTaskList,
          compPrefList,
        ]) => {
          rawSessions = sessionsList;
          rawMessages = messagesList;
          rawKnowledge = knowledgeList;
          rawDocuments = documentsList;
          rawCompMessages = compMsgList;
          rawCompMemory = compMemList;
          rawCompTasks = compTaskList;

          if (electronMirroredTasks.length > 0) {
            const byId = new Map<string, CompanionTaskRecord>();
            for (const t of rawCompTasks) {
              if (t && t.id) byId.set(t.id, t);
            }
            for (const diskTask of electronMirroredTasks) {
              if (!diskTask || typeof diskTask.id !== 'string') continue;
              const existing = byId.get(diskTask.id);
              if (!existing) {
                byId.set(diskTask.id, diskTask);
                compTaskStore.put(diskTask);
              }
            }
            rawCompTasks = Array.from(byId.values());
          }

          // Ensure all 8 categories exist in IndexedDB for both schools
          const existingKeys = new Set(rawKnowledge.map((r) => r.id));
          const now = new Date();
          const nowStr = formatDateTimeRu(now);
          const nowMs = now.getTime();

          for (const schoolId of SCHOOL_IDS) {
            for (const cat of KNOWLEDGE_CATEGORIES) {
              const recordId = `${schoolId}:${cat.key}`;
              if (!existingKeys.has(recordId)) {
                const initRecord: StoredKnowledgeCategoryRecord = {
                  id: recordId,
                  schoolId,
                  categoryKey: cat.key,
                  content: '',
                  updatedAt: nowStr,
                  updatedAtMs: nowMs,
                };
                knowledgeStore.put(initRecord);
              }
            }
          }

          // Initialize companion greeting message if companion_messages is empty
          if (rawCompMessages.length === 0) {
            const greeting = createInitialCompanionGreetingMessage();
            rawCompMessages = [greeting];
            compMsgStore.put(greeting);
          }

          // Initialize companion preferences if not yet present
          const existingPref = compPrefList.find((p) => p.id === 'pixel_state');
          if (existingPref) {
            rawCompPreferences = existingPref;
          } else {
            const defaultPref = createDefaultCompanionPreferences();
            rawCompPreferences = defaultPref;
            compPrefStore.put(defaultPref);
          }
        }
      )
      .catch((err) => {
        try {
          tx.abort();
        } catch {
          // ignore abort error
        }
        reject(err);
      });

    tx.oncomplete = () => {
      resolve(
        assembleLoadedWorkspaceData(
          rawSessions,
          rawMessages,
          rawKnowledge,
          rawDocuments,
          rawCompMessages,
          rawCompMemory,
          rawCompTasks,
          rawCompPreferences
        )
      );
    };

    tx.onerror = () => {
      reject(
        tx.error ||
          new Error('Ошибка чтения сохранённых данных из IndexedDB.')
      );
    };
  });
}

/**
 * Saves or updates a chat session's metadata in the `sessions` object store.
 */
export async function saveSessionToDb(session: ChatSession): Promise<void> {
  const db = await openAssistantDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readwrite');
    const sessionStore = tx.objectStore(STORE_SESSIONS);
    sessionStore.put(toStoredSessionRecord(session));

    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        tx.error || new Error('Не удалось сохранить диалог в IndexedDB.')
      );
  });
}

/**
 * Renames a session in IndexedDB without altering its schoolId, mode, or messages.
 */
export async function renameSessionInDb(
  sessionId: string,
  newTitle: string,
  updatedAt: string,
  updatedAtMs: number
): Promise<void> {
  const db = await openAssistantDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readwrite');
    const sessionStore = tx.objectStore(STORE_SESSIONS);
    const getReq = sessionStore.get(sessionId);

    getReq.onsuccess = () => {
      const existing = getReq.result as StoredSessionRecord | undefined;
      if (existing) {
        sessionStore.put({
          ...existing,
          title: newTitle,
          updatedAt,
          updatedAtMs,
        });
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        tx.error || new Error('Не удалось переименовать диалог в IndexedDB.')
      );
  });
}

/**
 * Pins or unpins a session in IndexedDB WITHOUT changing its updatedAt / updatedAtMs timestamps.
 */
export async function togglePinSessionInDb(
  sessionId: string,
  isPinned: boolean
): Promise<void> {
  const db = await openAssistantDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readwrite');
    const sessionStore = tx.objectStore(STORE_SESSIONS);
    const getReq = sessionStore.get(sessionId);

    getReq.onsuccess = () => {
      const existing = getReq.result as StoredSessionRecord | undefined;
      if (existing) {
        sessionStore.put({
          ...existing,
          isPinned: Boolean(isPinned),
        });
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        tx.error ||
          new Error('Не удалось обновить закрепление диалога в IndexedDB.')
      );
  });
}

/**
 * Adds a dialogue attachment to the session record in IndexedDB without touching the school's Knowledge Base documents.
 */
export async function addSessionAttachmentInDb(
  sessionId: string,
  attachment: ChatAttachment,
  updatedAt: string,
  updatedAtMs: number
): Promise<void> {
  const db = await openAssistantDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readwrite');
    const sessionStore = tx.objectStore(STORE_SESSIONS);
    const getReq = sessionStore.get(sessionId);

    getReq.onsuccess = () => {
      const existing = getReq.result as StoredSessionRecord | undefined;
      if (existing) {
        const currentList = existing.attachments || [];
        const filtered = currentList.filter((a) => a.id !== attachment.id);
        sessionStore.put({
          ...existing,
          attachments: [attachment, ...filtered],
          updatedAt,
          updatedAtMs,
        });
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        tx.error ||
          new Error('Не удалось добавить файл в материалы диалога в IndexedDB.')
      );
  });
}

/**
 * Removes a dialogue attachment from the session record and clears its reference on messages of that session.
 */
export async function removeSessionAttachmentInDb(
  sessionId: string,
  attachmentId: string,
  updatedAt: string,
  updatedAtMs: number
): Promise<void> {
  const db = await openAssistantDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_SESSIONS, STORE_MESSAGES], 'readwrite');
    const sessionStore = tx.objectStore(STORE_SESSIONS);
    const messageStore = tx.objectStore(STORE_MESSAGES);
    const sessionIndex = messageStore.index('by_session');

    const getReq = sessionStore.get(sessionId);
    getReq.onsuccess = () => {
      const existing = getReq.result as StoredSessionRecord | undefined;
      if (existing) {
        const nextAttachments = (existing.attachments || []).filter(
          (a) => a.id !== attachmentId
        );
        sessionStore.put({
          ...existing,
          attachments: nextAttachments,
          updatedAt,
          updatedAtMs,
        });
      }
    };

    const cursorReq = sessionIndex.openCursor(IDBKeyRange.only(sessionId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        const msg = cursor.value as ChatMessage;
        if (msg.attachmentMeta?.id === attachmentId) {
          const updatedMsg: ChatMessage = {
            ...msg,
            attachmentName: undefined,
            attachmentMeta: undefined,
          };
          cursor.update(updatedMsg);
        }
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        tx.error ||
          new Error('Не удалось удалить файл из диалога в IndexedDB.')
      );
  });
}

/**
 * Atomically saves/updates a session and appends/updates its messages in IndexedDB.
 */
export async function saveSessionAndMessagesToDb(
  session: ChatSession,
  messagesToSave: ChatMessage[]
): Promise<void> {
  const db = await openAssistantDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_SESSIONS, STORE_MESSAGES], 'readwrite');
    const sessionStore = tx.objectStore(STORE_SESSIONS);
    const messageStore = tx.objectStore(STORE_MESSAGES);

    sessionStore.put(toStoredSessionRecord(session));

    for (const msg of messagesToSave) {
      messageStore.put({
        ...msg,
        sessionId: session.id,
      });
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        tx.error ||
          new Error('Не удалось сохранить сообщения диалога в IndexedDB.')
      );
  });
}

/**
 * Clears all messages belonging ONLY to `sessionId` while keeping the session record itself intact.
 */
export async function clearSessionMessagesInDb(
  sessionId: string,
  updatedAt: string,
  updatedAtMs: number
): Promise<void> {
  const db = await openAssistantDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_SESSIONS, STORE_MESSAGES], 'readwrite');
    const sessionStore = tx.objectStore(STORE_SESSIONS);
    const messageStore = tx.objectStore(STORE_MESSAGES);
    const sessionIndex = messageStore.index('by_session');

    const getSessionReq = sessionStore.get(sessionId);
    getSessionReq.onsuccess = () => {
      const existing = getSessionReq.result as StoredSessionRecord | undefined;
      if (existing) {
        sessionStore.put({
          ...existing,
          attachments: [],
          updatedAt,
          updatedAtMs,
        });
      }
    };

    const cursorReq = sessionIndex.openKeyCursor(IDBKeyRange.only(sessionId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        messageStore.delete(cursor.primaryKey);
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        tx.error ||
          new Error('Не удалось очистить сообщения текущей сессии в IndexedDB.')
      );
  });
}

/**
 * Deletes a session from `sessions` AND cascades deletion to all its messages in `messages`.
 */
export async function deleteSessionCascadeInDb(
  sessionId: string
): Promise<void> {
  const db = await openAssistantDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_SESSIONS, STORE_MESSAGES], 'readwrite');
    const sessionStore = tx.objectStore(STORE_SESSIONS);
    const messageStore = tx.objectStore(STORE_MESSAGES);
    const sessionIndex = messageStore.index('by_session');

    sessionStore.delete(sessionId);

    const cursorReq = sessionIndex.openKeyCursor(IDBKeyRange.only(sessionId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        messageStore.delete(cursor.primaryKey);
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        tx.error ||
          new Error('Не удалось удалить диалог и его сообщения из IndexedDB.')
      );
  });
}

/**
 * Saves a specific school's knowledge base category in the `knowledge_base` object store.
 */
export async function saveKnowledgeCategoryInDb(
  schoolId: SchoolId,
  categoryKey: KnowledgeCategoryKey,
  content: string
): Promise<void> {
  const db = await openAssistantDatabase();
  const now = new Date();
  const record: StoredKnowledgeCategoryRecord = {
    id: `${schoolId}:${categoryKey}`,
    schoolId,
    categoryKey,
    content,
    updatedAt: formatDateTimeRu(now),
    updatedAtMs: now.getTime(),
  };

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_KNOWLEDGE, 'readwrite');
    const knowledgeStore = tx.objectStore(STORE_KNOWLEDGE);
    knowledgeStore.put(record);

    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        tx.error ||
          new Error('Не удалось сохранить раздел базы знаний в IndexedDB.')
      );
  });
}

/**
 * Saves or updates a document metadata/text record in the `documents` object store.
 */
export async function saveDocumentInDb(
  doc: UploadedDocumentRecord
): Promise<void> {
  const db = await openAssistantDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_DOCUMENTS, 'readwrite');
    const docStore = tx.objectStore(STORE_DOCUMENTS);
    docStore.put({
      ...doc,
      createdAtMs: doc.createdAtMs ?? Date.now(),
    });

    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        tx.error ||
          new Error('Не удалось сохранить карточку документа в IndexedDB.')
      );
  });
}

/**
 * Deletes a document record from the `documents` object store without touching other documents or category text.
 */
export async function deleteDocumentInDb(docId: string): Promise<void> {
  const db = await openAssistantDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_DOCUMENTS, 'readwrite');
    const docStore = tx.objectStore(STORE_DOCUMENTS);
    docStore.delete(docId);

    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        tx.error || new Error('Не удалось удалить документ из IndexedDB.')
      );
  });
}

// ============================================================================
// PIXEL COMPANION STORAGE OPERATIONS (Parts 6, 7, 8, 9, 10)
// ============================================================================

export async function saveCompanionMessagesToDb(
  messages: CompanionMessage[]
): Promise<void> {
  const db = await openAssistantDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_COMPANION_MESSAGES, 'readwrite');
    const store = tx.objectStore(STORE_COMPANION_MESSAGES);
    for (const m of messages) {
      store.put(m);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        tx.error ||
          new Error('Не удалось сохранить сообщения Пикселя в IndexedDB.')
      );
  });
}

export async function clearCompanionMessagesInDb(
  seedMessage: CompanionMessage
): Promise<void> {
  const db = await openAssistantDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_COMPANION_MESSAGES, 'readwrite');
    const store = tx.objectStore(STORE_COMPANION_MESSAGES);
    store.clear();
    store.put(seedMessage);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        tx.error ||
          new Error('Не удалось очистить переписку с Пикселем в IndexedDB.')
      );
  });
}

export async function saveCompanionMemoryInDb(
  record: CompanionMemoryRecord
): Promise<void> {
  const db = await openAssistantDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_COMPANION_MEMORY, 'readwrite');
    const store = tx.objectStore(STORE_COMPANION_MEMORY);
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        tx.error ||
          new Error('Не удалось сохранить запись в память Пикселя (IndexedDB).')
      );
  });
}

export async function deleteCompanionMemoryInDb(id: string): Promise<void> {
  const db = await openAssistantDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_COMPANION_MEMORY, 'readwrite');
    const store = tx.objectStore(STORE_COMPANION_MEMORY);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        tx.error ||
          new Error('Не удалось удалить запись из памяти Пикселя (IndexedDB).')
      );
  });
}

export async function clearAllCompanionMemoryInDb(): Promise<void> {
  const db = await openAssistantDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_COMPANION_MEMORY, 'readwrite');
    const store = tx.objectStore(STORE_COMPANION_MEMORY);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        tx.error ||
          new Error('Не удалось очистить память Пикселя в IndexedDB.')
      );
  });
}

export async function getAllCompanionTasksFromDb(): Promise<CompanionTaskRecord[]> {
  const db = await openAssistantDatabase();
  const tx = db.transaction(STORE_COMPANION_TASKS, 'readonly');
  const store = tx.objectStore(STORE_COMPANION_TASKS);
  const tasks = await getAllFromStore<CompanionTaskRecord>(store);
  return tasks.sort((a, b) => {
    const aFinished = a.status === 'done' || a.status === 'cancelled';
    const bFinished = b.status === 'done' || b.status === 'cancelled';
    if (aFinished !== bFinished) return aFinished ? 1 : -1;
    const aDate = (a.dueDate || '').slice(0, 10);
    const bDate = (b.dueDate || '').slice(0, 10);
    if (aDate && bDate && aDate !== bDate) {
      return aDate.localeCompare(bDate);
    }
    if (aDate && !bDate) return -1;
    if (!aDate && bDate) return 1;
    return (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0);
  });
}

export async function saveCompanionTaskInDb(
  task: CompanionTaskRecord
): Promise<void> {
  if (!task || typeof task.id !== 'string' || !task.id.trim()) {
    throw new Error('Некорректный идентификатор задачи при сохранении в хранилище.');
  }
  if (typeof task.title !== 'string' || !task.title.trim()) {
    throw new Error('Не указано название задачи при сохранении в хранилище.');
  }

  const db = await openAssistantDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_COMPANION_TASKS, 'readwrite');
    const store = tx.objectStore(STORE_COMPANION_TASKS);
    let verifiedRecord: CompanionTaskRecord | undefined;

    const putReq = store.put(task);
    putReq.onsuccess = () => {
      const getReq = store.get(task.id);
      getReq.onsuccess = () => {
        verifiedRecord = getReq.result as CompanionTaskRecord | undefined;
      };
    };

    tx.oncomplete = () => {
      if (!verifiedRecord || verifiedRecord.id !== task.id) {
        reject(
          new Error('Запись задачи в IndexedDB не подтверждена при контрольной проверке.')
        );
        return;
      }
      resolve();
    };
    tx.onerror = () =>
      reject(
        tx.error || new Error('Не удалось сохранить задачу Анны в IndexedDB.')
      );
  });

  if (typeof window !== 'undefined' && window.electronAPI?.companionTasks?.save) {
    try {
      await window.electronAPI.companionTasks.save(task);
    } catch {
      // IndexedDB is primary; ignore secondary Electron mirror error
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: { task } }));
  }
}

export async function deleteCompanionTaskInDb(taskId: string): Promise<void> {
  const db = await openAssistantDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_COMPANION_TASKS, 'readwrite');
    const store = tx.objectStore(STORE_COMPANION_TASKS);
    store.delete(taskId);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        tx.error || new Error('Не удалось удалить задачу из IndexedDB.')
      );
  });

  if (typeof window !== 'undefined' && window.electronAPI?.companionTasks?.delete) {
    try {
      await window.electronAPI.companionTasks.delete(taskId);
    } catch {
      // ignore secondary Electron mirror error
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: { taskId } }));
  }
}

export async function saveCompanionPreferencesInDb(
  prefs: CompanionPreferencesRecord
): Promise<void> {
  const db = await openAssistantDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_COMPANION_PREFERENCES, 'readwrite');
    const store = tx.objectStore(STORE_COMPANION_PREFERENCES);
    store.put({
      ...prefs,
      id: 'pixel_state',
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        tx.error ||
          new Error('Не удалось сохранить настройки Пикселя в IndexedDB.')
      );
  });
}

// ============================================================================
// BACKUP EXPORT & ATOMIC TRANSACTIONAL IMPORT (Includes Pixel Companion Data)
// ============================================================================

export async function exportWorkspaceBackupFromDb(
  workspaceSettings: WorkspaceBackupSettings
): Promise<BackupArchiveV1> {
  const db = await openAssistantDatabase();

  return new Promise<BackupArchiveV1>((resolve, reject) => {
    const tx = db.transaction(
      [
        STORE_SESSIONS,
        STORE_MESSAGES,
        STORE_KNOWLEDGE,
        STORE_DOCUMENTS,
        STORE_COMPANION_MESSAGES,
        STORE_COMPANION_MEMORY,
        STORE_COMPANION_TASKS,
        STORE_COMPANION_PREFERENCES,
      ],
      'readonly'
    );

    const sessionStore = tx.objectStore(STORE_SESSIONS);
    const messageStore = tx.objectStore(STORE_MESSAGES);
    const knowledgeStore = tx.objectStore(STORE_KNOWLEDGE);
    const documentStore = tx.objectStore(STORE_DOCUMENTS);
    const compMsgStore = tx.objectStore(STORE_COMPANION_MESSAGES);
    const compMemStore = tx.objectStore(STORE_COMPANION_MEMORY);
    const compTaskStore = tx.objectStore(STORE_COMPANION_TASKS);
    const compPrefStore = tx.objectStore(STORE_COMPANION_PREFERENCES);

    Promise.all([
      getAllFromStore<StoredSessionRecord>(sessionStore),
      getAllFromStore<ChatMessage>(messageStore),
      getAllFromStore<StoredKnowledgeCategoryRecord>(knowledgeStore),
      getAllFromStore<UploadedDocumentRecord>(documentStore),
      getAllFromStore<CompanionMessage>(compMsgStore),
      getAllFromStore<CompanionMemoryRecord>(compMemStore),
      getAllFromStore<CompanionTaskRecord>(compTaskStore),
      getAllFromStore<CompanionPreferencesRecord>(compPrefStore),
    ])
      .then(
        ([
          sessions,
          messages,
          knowledgeBase,
          documents,
          companionMessages,
          companionMemory,
          companionTasks,
          companionPrefsList,
        ]) => {
          const now = new Date();
          const companionPreferences =
            companionPrefsList.find((p) => p.id === 'pixel_state') ||
            createDefaultCompanionPreferences();

          resolve({
            backupFormat: BACKUP_FORMAT_ID,
            backupVersion: BACKUP_FORMAT_VERSION,
            dbVersion: DB_VERSION,
            exportedAt: now.toISOString(),
            exportedAtFormatted: formatDateTimeRu(now),
            workspaceSettings,
            data: {
              sessions,
              messages,
              knowledgeBase,
              documents,
              companionMessages,
              companionMemory,
              companionTasks,
              companionPreferences,
            },
          });
        }
      )
      .catch((err) => {
        reject(
          err instanceof Error
            ? err
            : new Error(
                'Ошибка чтения базы данных при создании резервной копии.'
              )
        );
      });
  });
}

function isObjectRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Strictly validates a backup JSON file BEFORE any changes are made to IndexedDB.
 * Deduplicates records by ID and supports both pre-companion and post-companion backup files.
 */
export function validateBackupArchiveJson(
  rawJsonText: string
): ValidatedBackupSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJsonText);
  } catch {
    throw new Error(
      'Файл не является корректным JSON-документом (ошибка синтаксиса JSON).'
    );
  }

  if (!isObjectRecord(parsed)) {
    throw new Error('Корневая структура резервной копии должна быть объектом.');
  }

  if (parsed.backupFormat !== BACKUP_FORMAT_ID) {
    throw new Error(
      'Неизвестный формат файла резервной копии (поле backupFormat отсутствует или не совпадает).'
    );
  }

  const backupVersion = Number(parsed.backupVersion);
  if (
    !Number.isInteger(backupVersion) ||
    backupVersion !== BACKUP_FORMAT_VERSION
  ) {
    throw new Error(
      `Неподдерживаемая версия формата резервной копии: ${String(parsed.backupVersion)}. Ожидается версия ${BACKUP_FORMAT_VERSION}.`
    );
  }

  if (!isObjectRecord(parsed.data)) {
    throw new Error(
      'В файле резервной копии отсутствует обязательный блок данных (data).'
    );
  }

  const rawData = parsed.data;
  if (
    !Array.isArray(rawData.sessions) ||
    !Array.isArray(rawData.messages) ||
    !Array.isArray(rawData.knowledgeBase) ||
    !Array.isArray(rawData.documents)
  ) {
    throw new Error(
      'Нарушена структура резервной копии: разделы sessions, messages, knowledgeBase и documents должны быть массивами.'
    );
  }

  // Validate and deduplicate sessions
  const sessionsMap = new Map<string, StoredSessionRecord>();
  for (let i = 0; i < rawData.sessions.length; i++) {
    const s = rawData.sessions[i];
    if (!isObjectRecord(s)) {
      throw new Error(`Некорректная запись диалога (индекс ${i}).`);
    }
    if (typeof s.id !== 'string' || !s.id.trim()) {
      throw new Error(`У диалога (индекс ${i}) отсутствует обязательный id.`);
    }
    if (typeof s.title !== 'string') {
      throw new Error(
        `У диалога «${s.id}» отсутствует текстовое название (title).`
      );
    }
    if (s.schoolId !== 'kiberone' && s.schoolId !== 'renderia' && s.schoolId !== 'all') {
      throw new Error(
        `У диалога «${s.id}» указан недопустимый schoolId: ${String(s.schoolId)}.`
      );
    }
    if (!VALID_MODES.has(s.mode as AgentMode)) {
      throw new Error(
        `У диалога «${s.id}» указан недопустимый режим специалиста (mode): ${String(s.mode)}.`
      );
    }

    const attachmentsList: ChatAttachment[] = [];
    if (Array.isArray(s.attachments)) {
      const seenAtt = new Set<string>();
      for (const att of s.attachments) {
        if (
          isObjectRecord(att) &&
          typeof att.id === 'string' &&
          typeof att.name === 'string' &&
          !seenAtt.has(att.id)
        ) {
          seenAtt.add(att.id);
          attachmentsList.push({
            id: att.id,
            name: att.name,
            extension: typeof att.extension === 'string' ? att.extension : '',
            sizeBytes: typeof att.sizeBytes === 'number' ? att.sizeBytes : 0,
            extractedText:
              typeof att.extractedText === 'string' ? att.extractedText : '',
            status: (att.status as DocumentProcessingStatus) || 'processed',
            statusMessage:
              typeof att.statusMessage === 'string'
                ? att.statusMessage
                : undefined,
            warning: typeof att.warning === 'string' ? att.warning : undefined,
            pageCount:
              typeof att.pageCount === 'number' ? att.pageCount : undefined,
            mimeType:
              typeof att.mimeType === 'string' ? att.mimeType : undefined,
            createdAt:
              typeof att.createdAt === 'string' ? att.createdAt : undefined,
            createdAtMs:
              typeof att.createdAtMs === 'number' ? att.createdAtMs : undefined,
            dataUrl: typeof att.dataUrl === 'string' ? att.dataUrl : undefined,
            messageId:
              typeof att.messageId === 'string' ? att.messageId : undefined,
          });
        }
      }
    }

    const nowMs = Date.now();
    sessionsMap.set(s.id, {
      id: s.id,
      title: s.title,
      schoolId: s.schoolId,
      mode: s.mode as AgentMode,
      isPinned: Boolean(s.isPinned),
      createdAt:
        typeof s.createdAt === 'string'
          ? s.createdAt
          : typeof s.updatedAt === 'string'
            ? s.updatedAt
            : '00:00',
      updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : '00:00',
      createdAtMs: typeof s.createdAtMs === 'number' ? s.createdAtMs : nowMs,
      updatedAtMs: typeof s.updatedAtMs === 'number' ? s.updatedAtMs : nowMs,
      attachments: attachmentsList,
      linkedHandoffPacket: isObjectRecord(s.linkedHandoffPacket)
        ? (s.linkedHandoffPacket as unknown as ChatSession['linkedHandoffPacket'])
        : undefined,
      designArtifacts: Array.isArray(s.designArtifacts)
        ? (s.designArtifacts as unknown as ChatSession['designArtifacts'])
        : undefined,
    });
  }

  // Validate and deduplicate messages
  const messagesMap = new Map<string, ChatMessage>();
  for (let i = 0; i < rawData.messages.length; i++) {
    const m = rawData.messages[i];
    if (!isObjectRecord(m)) {
      throw new Error(`Некорректная запись сообщения (индекс ${i}).`);
    }
    if (typeof m.id !== 'string' || !m.id.trim()) {
      throw new Error(`У сообщения (индекс ${i}) отсутствует обязательный id.`);
    }
    if (typeof m.sessionId !== 'string' || !m.sessionId.trim()) {
      throw new Error(`У сообщения «${m.id}» отсутствует sessionId.`);
    }
    if (m.role !== 'user' && m.role !== 'assistant') {
      throw new Error(
        `У сообщения «${m.id}» недопустимая роль: ${String(m.role)}.`
      );
    }
    if (typeof m.content !== 'string') {
      throw new Error(`У сообщения «${m.id}» отсутствует текст (content).`);
    }
    if (m.schoolId !== 'kiberone' && m.schoolId !== 'renderia' && m.schoolId !== 'all') {
      throw new Error(`У сообщения «${m.id}» недопустимый schoolId.`);
    }
    if (!VALID_MODES.has(m.mode as AgentMode)) {
      throw new Error(`У сообщения «${m.id}» недопустимый mode.`);
    }

    messagesMap.set(m.id, {
      id: m.id,
      sessionId: m.sessionId,
      role: m.role,
      content: m.content,
      createdAt: typeof m.createdAt === 'string' ? m.createdAt : '00:00',
      createdAtMs:
        typeof m.createdAtMs === 'number' ? m.createdAtMs : Date.now(),
      schoolId: m.schoolId,
      mode: m.mode as AgentMode,
      attachmentName:
        typeof m.attachmentName === 'string' ? m.attachmentName : undefined,
      attachmentMeta: isObjectRecord(m.attachmentMeta)
        ? {
            id: String(m.attachmentMeta.id || ''),
            name: String(m.attachmentMeta.name || ''),
            extension: String(m.attachmentMeta.extension || ''),
            sizeBytes: Number(m.attachmentMeta.sizeBytes || 0),
          }
        : undefined,
      delegatedByPixel:
        typeof m.delegatedByPixel === 'boolean'
          ? m.delegatedByPixel
          : undefined,
      delegationTaskId:
        typeof m.delegationTaskId === 'string' ? m.delegationTaskId : undefined,
      delegationIteration:
        typeof m.delegationIteration === 'number'
          ? m.delegationIteration
          : undefined,
      senderLabel:
        typeof m.senderLabel === 'string' ? m.senderLabel : undefined,
      handoffPacket: isObjectRecord(m.handoffPacket)
        ? (m.handoffPacket as unknown as ChatMessage['handoffPacket'])
        : undefined,
      handoffResult: isObjectRecord(m.handoffResult)
        ? (m.handoffResult as unknown as ChatMessage['handoffResult'])
        : undefined,
      interactiveDesignerPrompt: isObjectRecord(m.interactiveDesignerPrompt)
        ? (m.interactiveDesignerPrompt as unknown as ChatMessage['interactiveDesignerPrompt'])
        : undefined,
      designArtifact: isObjectRecord(m.designArtifact)
        ? (m.designArtifact as unknown as ChatMessage['designArtifact'])
        : undefined,
    });
  }

  // Validate and deduplicate knowledgeBase records
  const knowledgeMap = new Map<string, StoredKnowledgeCategoryRecord>();
  for (let i = 0; i < rawData.knowledgeBase.length; i++) {
    const k = rawData.knowledgeBase[i];
    if (!isObjectRecord(k)) {
      throw new Error(`Некорректная запись Базы знаний (индекс ${i}).`);
    }
    if (k.schoolId !== 'kiberone' && k.schoolId !== 'renderia') {
      throw new Error(
        `В записи Базы знаний (индекс ${i}) указан недопустимый schoolId.`
      );
    }
    if (!VALID_CATEGORIES.has(k.categoryKey as KnowledgeCategoryKey)) {
      throw new Error(
        `В записи Базы знаний (индекс ${i}) указана неизвестная категория: ${String(k.categoryKey)}.`
      );
    }
    if (typeof k.content !== 'string') {
      throw new Error(
        `В записи Базы знаний «${String(k.schoolId)}:${String(k.categoryKey)}» отсутствует поле content.`
      );
    }

    const recId = `${k.schoolId}:${k.categoryKey}`;
    knowledgeMap.set(recId, {
      id: recId,
      schoolId: k.schoolId,
      categoryKey: k.categoryKey as KnowledgeCategoryKey,
      content: k.content,
      updatedAt:
        typeof k.updatedAt === 'string' ? k.updatedAt : formatDateTimeRu(),
      updatedAtMs:
        typeof k.updatedAtMs === 'number' ? k.updatedAtMs : Date.now(),
    });
  }

  // Validate and deduplicate documents
  const documentsMap = new Map<string, UploadedDocumentRecord>();
  for (let i = 0; i < rawData.documents.length; i++) {
    const d = rawData.documents[i];
    if (!isObjectRecord(d)) {
      throw new Error(`Некорректная запись документа (индекс ${i}).`);
    }
    if (typeof d.id !== 'string' || !d.id.trim()) {
      throw new Error(`У документа (индекс ${i}) отсутствует обязательный id.`);
    }
    if (d.schoolId !== 'kiberone' && d.schoolId !== 'renderia' && d.schoolId !== 'all') {
      throw new Error(`У документа «${d.id}» недопустимый schoolId.`);
    }
    if (!VALID_CATEGORIES.has(d.categoryKey as KnowledgeCategoryKey)) {
      throw new Error(`У документа «${d.id}» недопустимая категория.`);
    }
    if (typeof d.name !== 'string' || !d.name.trim()) {
      throw new Error(`У документа «${d.id}» отсутствует название файла.`);
    }

    documentsMap.set(d.id, {
      id: d.id,
      name: d.name,
      extension: typeof d.extension === 'string' ? d.extension : '',
      sizeBytes: typeof d.sizeBytes === 'number' ? d.sizeBytes : 0,
      schoolId: d.schoolId,
      categoryKey: d.categoryKey as KnowledgeCategoryKey,
      status: (d.status as DocumentProcessingStatus) || 'processed',
      statusMessage:
        typeof d.statusMessage === 'string' ? d.statusMessage : undefined,
      warning: typeof d.warning === 'string' ? d.warning : undefined,
      extractedText:
        typeof d.extractedText === 'string' ? d.extractedText : '',
      createdAt:
        typeof d.createdAt === 'string' ? d.createdAt : formatDateTimeRu(),
      createdAtMs:
        typeof d.createdAtMs === 'number' ? d.createdAtMs : Date.now(),
      verifiedByManager: Boolean(d.verifiedByManager),
      pageCount: typeof d.pageCount === 'number' ? d.pageCount : undefined,
      fileType: typeof d.fileType === 'string' ? (d.fileType as any) : undefined,
      mimeType: typeof d.mimeType === 'string' ? d.mimeType : undefined,
      tags: Array.isArray(d.tags) ? d.tags.filter((t) => typeof t === 'string') : undefined,
      description: typeof d.description === 'string' ? d.description : undefined,
      visualRole: typeof d.visualRole === 'string' ? (d.visualRole as any) : undefined,
      dataUrl: typeof d.dataUrl === 'string' ? d.dataUrl : undefined,
      thumbnailUrl: typeof d.thumbnailUrl === 'string' ? d.thumbnailUrl : undefined,
      slides: Array.isArray(d.slides) ? d.slides : undefined,
      colorPalette: Array.isArray(d.colorPalette) ? d.colorPalette : undefined,
      extractedImages: Array.isArray(d.extractedImages) ? d.extractedImages : undefined,
      durationSec: typeof d.durationSec === 'number' ? d.durationSec : undefined,
      videoWidth: typeof d.videoWidth === 'number' ? d.videoWidth : undefined,
      videoHeight: typeof d.videoHeight === 'number' ? d.videoHeight : undefined,
    });
  }

  // Validate optional Companion Messages
  const companionMessagesMap = new Map<string, CompanionMessage>();
  if (Array.isArray(rawData.companionMessages)) {
    for (let i = 0; i < rawData.companionMessages.length; i++) {
      const cm = rawData.companionMessages[i];
      if (!isObjectRecord(cm)) continue;
      if (typeof cm.id !== 'string' || !cm.id.trim()) continue;
      if (cm.role !== 'user' && cm.role !== 'pixel') continue;
      if (typeof cm.content !== 'string') continue;

      companionMessagesMap.set(cm.id, {
        id: cm.id,
        role: cm.role,
        content: cm.content,
        createdAt:
          typeof cm.createdAt === 'string' ? cm.createdAt : formatTimeShortRu(),
        createdAtMs:
          typeof cm.createdAtMs === 'number' ? cm.createdAtMs : Date.now(),
        usedContextLabels: Array.isArray(cm.usedContextLabels)
          ? cm.usedContextLabels.filter((x): x is string => typeof x === 'string')
          : undefined,
        proposalStatus:
          cm.proposalStatus === 'pending' ||
          cm.proposalStatus === 'confirmed' ||
          cm.proposalStatus === 'dismissed'
            ? cm.proposalStatus
            : undefined,
        delegatedTask: isObjectRecord(cm.delegatedTask)
          ? (cm.delegatedTask as unknown as CompanionMessage['delegatedTask'])
          : undefined,
        pendingDelegationDraft: isObjectRecord(cm.pendingDelegationDraft)
          ? (cm.pendingDelegationDraft as unknown as CompanionMessage['pendingDelegationDraft'])
          : undefined,
        pendingRevisionDraft: isObjectRecord(cm.pendingRevisionDraft)
          ? (cm.pendingRevisionDraft as unknown as CompanionMessage['pendingRevisionDraft'])
          : undefined,
        pendingChatDeletion: isObjectRecord(cm.pendingChatDeletion)
          ? (cm.pendingChatDeletion as unknown as CompanionMessage['pendingChatDeletion'])
          : undefined,
        autoCreatedTask: isObjectRecord(cm.autoCreatedTask)
          ? (cm.autoCreatedTask as unknown as CompanionMessage['autoCreatedTask'])
          : undefined,
      });
    }
  }

  // Validate optional Companion Memory
  const companionMemoryMap = new Map<string, CompanionMemoryRecord>();
  if (Array.isArray(rawData.companionMemory)) {
    for (let i = 0; i < rawData.companionMemory.length; i++) {
      const mem = rawData.companionMemory[i];
      if (!isObjectRecord(mem)) continue;
      if (typeof mem.id !== 'string' || !mem.id.trim()) continue;
      if (
        !VALID_MEMORY_CATEGORIES.has(mem.category as CompanionMemoryCategory)
      ) {
        continue;
      }
      if (typeof mem.title !== 'string' || typeof mem.content !== 'string') {
        continue;
      }

      companionMemoryMap.set(mem.id, {
        id: mem.id,
        category: mem.category as CompanionMemoryCategory,
        title: mem.title,
        content: mem.content,
        schoolId:
          mem.schoolId === 'kiberone' ||
          mem.schoolId === 'renderia' ||
          mem.schoolId === 'both'
            ? mem.schoolId
            : 'both',
        confirmedByAnna: Boolean(mem.confirmedByAnna ?? true),
        createdAt:
          typeof mem.createdAt === 'string'
            ? mem.createdAt
            : formatDateTimeRu(),
        updatedAt:
          typeof mem.updatedAt === 'string'
            ? mem.updatedAt
            : formatDateTimeRu(),
        updatedAtMs:
          typeof mem.updatedAtMs === 'number' ? mem.updatedAtMs : Date.now(),
      });
    }
  }

  // Validate optional Companion Tasks
  const companionTasksMap = new Map<string, CompanionTaskRecord>();
  if (Array.isArray(rawData.companionTasks)) {
    for (let i = 0; i < rawData.companionTasks.length; i++) {
      const t = rawData.companionTasks[i];
      if (!isObjectRecord(t)) continue;
      if (typeof t.id !== 'string' || !t.id.trim()) continue;
      if (typeof t.title !== 'string' || !t.title.trim()) continue;

      const status: CompanionTaskStatus = VALID_TASK_STATUSES.has(
        t.status as CompanionTaskStatus
      )
        ? (t.status as CompanionTaskStatus)
        : 'new';
      const priority: CompanionTaskPriority = VALID_TASK_PRIORITIES.has(
        t.priority as CompanionTaskPriority
      )
        ? (t.priority as CompanionTaskPriority)
        : 'medium';

      companionTasksMap.set(t.id, {
        id: t.id,
        title: t.title,
        description: typeof t.description === 'string' ? t.description : '',
        dueDate: typeof t.dueDate === 'string' ? t.dueDate : '',
        dueTime: typeof t.dueTime === 'string' ? t.dueTime : undefined,
        reminderAt: typeof t.reminderAt === 'string' ? t.reminderAt : undefined,
        reminderRepeat:
          t.reminderRepeat === 'none' ||
          t.reminderRepeat === 'daily' ||
          t.reminderRepeat === 'weekdays' ||
          t.reminderRepeat === 'weekly'
            ? t.reminderRepeat
            : undefined,
        lastReminderFiredAtMs:
          typeof t.lastReminderFiredAtMs === 'number'
            ? t.lastReminderFiredAtMs
            : undefined,
        priority,
        priorityReason:
          typeof t.priorityReason === 'string' ? t.priorityReason : undefined,
        estimatedMinutes:
          typeof t.estimatedMinutes === 'number' ? t.estimatedMinutes : undefined,
        steps: Array.isArray(t.steps) ? t.steps : undefined,
        sourceType:
          t.sourceType === 'manual' ||
          t.sourceType === 'conversation_auto' ||
          t.sourceType === 'voice_command' ||
          t.sourceType === 'delegation' ||
          t.sourceType === 'reminder'
            ? t.sourceType
            : undefined,
        linkedDelegationTaskId:
          typeof t.linkedDelegationTaskId === 'string'
            ? t.linkedDelegationTaskId
            : undefined,
        status,
        schoolId:
          t.schoolId === 'kiberone' ||
          t.schoolId === 'renderia' ||
          t.schoolId === 'both'
            ? t.schoolId
            : 'both',
        createdAt:
          typeof t.createdAt === 'string' ? t.createdAt : formatDateTimeRu(),
        createdAtMs:
          typeof t.createdAtMs === 'number' ? t.createdAtMs : Date.now(),
        completedAt:
          typeof t.completedAt === 'string' ? t.completedAt : undefined,
        completedAtMs:
          typeof t.completedAtMs === 'number' ? t.completedAtMs : undefined,
      });
    }
  }

  // Validate optional Companion Preferences
  const defaultPrefs = createDefaultCompanionPreferences();
  let companionPreferences: CompanionPreferencesRecord = defaultPrefs;
  if (isObjectRecord(rawData.companionPreferences)) {
    const rp = rawData.companionPreferences;
    companionPreferences = {
      id: 'pixel_state',
      quietMode: Boolean(rp.quietMode),
      breakRemindersEnabled:
        typeof rp.breakRemindersEnabled === 'boolean'
          ? rp.breakRemindersEnabled
          : true,
      activeWorkElapsedMs:
        typeof rp.activeWorkElapsedMs === 'number' && rp.activeWorkElapsedMs >= 0
          ? rp.activeWorkElapsedMs
          : 0,
      breakSnoozeUntilMs:
        typeof rp.breakSnoozeUntilMs === 'number' ? rp.breakSnoozeUntilMs : null,
      lastActiveInteractionMs:
        typeof rp.lastActiveInteractionMs === 'number'
          ? rp.lastActiveInteractionMs
          : Date.now(),
      lastAutonomousMessageMs:
        typeof rp.lastAutonomousMessageMs === 'number'
          ? rp.lastAutonomousMessageMs
          : Date.now(),
      mood: (rp.mood as CompanionMoodState) || 'happy',
      housePose: (rp.housePose as CompanionHousePose) || 'outside',
      collapsed: Boolean(rp.collapsed),
      customPosition:
        isObjectRecord(rp.customPosition) &&
        typeof rp.customPosition.x === 'number' &&
        typeof rp.customPosition.y === 'number'
          ? {
              x: rp.customPosition.x,
              y: rp.customPosition.y,
            }
          : null,
    };
  }

  // Validate workspaceSettings with safe defaults
  const rawSettings = isObjectRecord(parsed.workspaceSettings)
    ? parsed.workspaceSettings
    : {};
  const workspaceSettings: WorkspaceBackupSettings = {
    activeSchool:
      rawSettings.activeSchool === 'renderia'
        ? 'renderia'
        : rawSettings.activeSchool === 'all'
          ? 'all'
          : 'kiberone',
    sidebarCollapsed: Boolean(rawSettings.sidebarCollapsed),
    rightPanelCollapsed: Boolean(rawSettings.rightPanelCollapsed),
    rightPanelTab:
      rawSettings.rightPanelTab === 'materials' ||
      rawSettings.rightPanelTab === 'preview' ||
      rawSettings.rightPanelTab === 'search' ||
      rawSettings.rightPanelTab === 'context'
        ? rawSettings.rightPanelTab
        : 'context',
  };

  const sessionsList = Array.from(sessionsMap.values());
  const messagesList = Array.from(messagesMap.values());
  const knowledgeList = Array.from(knowledgeMap.values());
  const documentsList = Array.from(documentsMap.values());
  const companionMessagesList = Array.from(companionMessagesMap.values());
  const companionMemoryList = Array.from(companionMemoryMap.values());
  const companionTasksList = Array.from(companionTasksMap.values());

  const dialogueAttachmentsCount = sessionsList.reduce(
    (acc, s) => acc + (s.attachments?.length || 0),
    0
  );
  const kiberoneCategoriesFilled = knowledgeList.filter(
    (k) => k.schoolId === 'kiberone' && k.content.trim().length > 0
  ).length;
  const renderiaCategoriesFilled = knowledgeList.filter(
    (k) => k.schoolId === 'renderia' && k.content.trim().length > 0
  ).length;

  const validatedArchive: BackupArchiveV1 = {
    backupFormat: BACKUP_FORMAT_ID,
    backupVersion: BACKUP_FORMAT_VERSION,
    dbVersion: DB_VERSION,
    exportedAt:
      typeof parsed.exportedAt === 'string'
        ? parsed.exportedAt
        : new Date().toISOString(),
    exportedAtFormatted:
      typeof parsed.exportedAtFormatted === 'string'
        ? parsed.exportedAtFormatted
        : formatDateTimeRu(),
    workspaceSettings,
    data: {
      sessions: sessionsList,
      messages: messagesList,
      knowledgeBase: knowledgeList,
      documents: documentsList,
      companionMessages: companionMessagesList,
      companionMemory: companionMemoryList,
      companionTasks: companionTasksList,
      companionPreferences,
    },
  };

  return {
    exportedAtFormatted: validatedArchive.exportedAtFormatted,
    backupVersion: validatedArchive.backupVersion,
    sessionsCount: sessionsList.length,
    messagesCount: messagesList.length,
    dialogueAttachmentsCount,
    kiberoneCategoriesFilled,
    renderiaCategoriesFilled,
    documentsCount: documentsList.length,
    companionMessagesCount: companionMessagesList.length,
    companionMemoriesCount: companionMemoryList.length,
    companionTasksCount: companionTasksList.length,
    archive: validatedArchive,
  };
}

/**
 * Atomically restores a validated backup archive in a single IndexedDB readwrite transaction.
 * Either all 8 stores are restored cleanly, or the transaction aborts and leaves existing data untouched.
 */
export async function restoreWorkspaceBackupInDb(
  archive: BackupArchiveV1
): Promise<LoadedWorkspaceData> {
  const db = await openAssistantDatabase();

  return new Promise<LoadedWorkspaceData>((resolve, reject) => {
    const tx = db.transaction(
      [
        STORE_SESSIONS,
        STORE_MESSAGES,
        STORE_KNOWLEDGE,
        STORE_DOCUMENTS,
        STORE_COMPANION_MESSAGES,
        STORE_COMPANION_MEMORY,
        STORE_COMPANION_TASKS,
        STORE_COMPANION_PREFERENCES,
      ],
      'readwrite'
    );

    const sessionStore = tx.objectStore(STORE_SESSIONS);
    const messageStore = tx.objectStore(STORE_MESSAGES);
    const knowledgeStore = tx.objectStore(STORE_KNOWLEDGE);
    const documentStore = tx.objectStore(STORE_DOCUMENTS);
    const compMsgStore = tx.objectStore(STORE_COMPANION_MESSAGES);
    const compMemStore = tx.objectStore(STORE_COMPANION_MEMORY);
    const compTaskStore = tx.objectStore(STORE_COMPANION_TASKS);
    const compPrefStore = tx.objectStore(STORE_COMPANION_PREFERENCES);

    // Clear all 8 stores inside the single atomic transaction
    sessionStore.clear();
    messageStore.clear();
    knowledgeStore.clear();
    documentStore.clear();
    compMsgStore.clear();
    compMemStore.clear();
    compTaskStore.clear();
    compPrefStore.clear();

    for (const s of archive.data.sessions) {
      sessionStore.put(s);
    }

    for (const m of archive.data.messages) {
      messageStore.put(m);
    }

    // Ensure all 16 categories exist for both schools
    const now = new Date();
    const nowStr = formatDateTimeRu(now);
    const nowMs = now.getTime();
    const kbById = new Map<string, StoredKnowledgeCategoryRecord>();

    for (const schoolId of SCHOOL_IDS) {
      for (const cat of KNOWLEDGE_CATEGORIES) {
        const id = `${schoolId}:${cat.key}`;
        kbById.set(id, {
          id,
          schoolId,
          categoryKey: cat.key,
          content: '',
          updatedAt: nowStr,
          updatedAtMs: nowMs,
        });
      }
    }

    for (const k of archive.data.knowledgeBase) {
      const id = `${k.schoolId}:${k.categoryKey}`;
      kbById.set(id, {
        ...k,
        id,
      });
    }

    for (const rec of kbById.values()) {
      knowledgeStore.put(rec);
    }

    for (const d of archive.data.documents) {
      documentStore.put(d);
    }

    const compMessages =
      archive.data.companionMessages && archive.data.companionMessages.length > 0
        ? archive.data.companionMessages
        : [createInitialCompanionGreetingMessage()];
    for (const cm of compMessages) {
      compMsgStore.put(cm);
    }

    const compMemory = archive.data.companionMemory || [];
    for (const mem of compMemory) {
      compMemStore.put(mem);
    }

    const compTasks = archive.data.companionTasks || [];
    for (const task of compTasks) {
      compTaskStore.put(task);
    }

    const compPrefs =
      archive.data.companionPreferences || createDefaultCompanionPreferences();
    compPrefStore.put(compPrefs);

    tx.oncomplete = () => {
      resolve(
        assembleLoadedWorkspaceData(
          archive.data.sessions,
          archive.data.messages,
          Array.from(kbById.values()),
          archive.data.documents,
          compMessages,
          compMemory,
          compTasks,
          compPrefs
        )
      );
    };

    tx.onerror = () => {
      reject(
        tx.error ||
          new Error(
            'Транзакция восстановления прервана. Существующие данные в IndexedDB сохранены без изменений.'
          )
      );
    };

    tx.onabort = () => {
      reject(
        tx.error ||
          new Error(
            'Импорт резервной копии отменён. Существующие данные остались нетронутыми.'
          )
      );
    };
  });
}
