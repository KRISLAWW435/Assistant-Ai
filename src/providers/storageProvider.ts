import {
  ChatAttachment,
  ChatMessage,
  ChatSession,
  CompanionMemoryRecord,
  CompanionMessage,
  CompanionPreferencesRecord,
  CompanionTaskRecord,
  KnowledgeCategoryKey,
  SchoolId,
  UploadedDocumentRecord,
  WorkspaceBackupSettings,
} from '../types/assistant';
import {
  addSessionAttachmentInDb,
  BackupArchiveV1,
  clearAllCompanionMemoryInDb,
  clearCompanionMessagesInDb,
  clearSessionMessagesInDb,
  createDefaultCompanionPreferences,
  createInitialCompanionGreetingMessage,
  deleteCompanionMemoryInDb,
  deleteCompanionTaskInDb,
  deleteDocumentInDb,
  deleteSessionCascadeInDb,
  exportWorkspaceBackupFromDb,
  getAllCompanionTasksFromDb,
  initAndLoadWorkspaceData,
  LoadedWorkspaceData,
  removeSessionAttachmentInDb,
  renameSessionInDb,
  restoreWorkspaceBackupInDb,
  saveCompanionMemoryInDb,
  saveCompanionMessagesToDb,
  saveCompanionPreferencesInDb,
  saveCompanionTaskInDb,
  saveDocumentInDb,
  saveKnowledgeCategoryInDb,
  saveSessionAndMessagesToDb,
  saveSessionToDb,
  sortSessionsPinnedAndUpdatedDesc,
  togglePinSessionInDb,
  validateBackupArchiveJson,
  ValidatedBackupSummary,
} from '../storage/indexedDb';

/**
 * Minimal portable storage provider interface (Stage 3.1 Section 7).
 * Decouples UI/application logic from the underlying storage engine (currently IndexedDB v3),
 * enabling future migration to another persistence backend without rewriting components.
 */
export interface IStorageProvider {
  initAndLoadWorkspace(): Promise<LoadedWorkspaceData>;
  saveSession(session: ChatSession): Promise<void>;
  saveSessionAndMessages(
    session: ChatSession,
    messagesToUpsert: ChatMessage[]
  ): Promise<void>;
  renameSession(
    sessionId: string,
    newTitle: string,
    updatedAt: string,
    updatedAtMs: number
  ): Promise<void>;
  togglePinSession(sessionId: string, isPinned: boolean): Promise<void>;
  clearSessionMessages(
    sessionId: string,
    updatedAt: string,
    updatedAtMs: number
  ): Promise<void>;
  deleteSessionCascade(sessionId: string): Promise<void>;
  addSessionAttachment(
    sessionId: string,
    attachment: ChatAttachment,
    updatedAt: string,
    updatedAtMs: number
  ): Promise<void>;
  removeSessionAttachment(
    sessionId: string,
    attachmentId: string,
    updatedAt: string,
    updatedAtMs: number
  ): Promise<void>;
  saveKnowledgeCategory(
    schoolId: SchoolId,
    categoryKey: KnowledgeCategoryKey,
    content: string
  ): Promise<void>;
  saveDocument(doc: UploadedDocumentRecord): Promise<void>;
  deleteDocument(docId: string): Promise<void>;
  saveCompanionMessages(messages: CompanionMessage[]): Promise<void>;
  clearCompanionMessages(seedMessage?: CompanionMessage): Promise<void>;
  saveCompanionMemory(record: CompanionMemoryRecord): Promise<void>;
  deleteCompanionMemory(id: string): Promise<void>;
  clearAllCompanionMemory(): Promise<void>;
  saveCompanionTask(task: CompanionTaskRecord): Promise<void>;
  deleteCompanionTask(id: string): Promise<void>;
  getAllCompanionTasks(): Promise<CompanionTaskRecord[]>;
  saveCompanionPreferences(prefs: CompanionPreferencesRecord): Promise<void>;
  exportBackup(settings: WorkspaceBackupSettings): Promise<BackupArchiveV1>;
  validateBackupJson(rawJson: string): ValidatedBackupSummary;
  restoreBackup(archive: BackupArchiveV1): Promise<LoadedWorkspaceData>;
}

export const storageProvider: IStorageProvider = {
  initAndLoadWorkspace: () => initAndLoadWorkspaceData(),
  saveSession: (session) => saveSessionToDb(session),
  saveSessionAndMessages: (session, messages) =>
    saveSessionAndMessagesToDb(session, messages),
  renameSession: (sessionId, newTitle, updatedAt, updatedAtMs) =>
    renameSessionInDb(sessionId, newTitle, updatedAt, updatedAtMs),
  togglePinSession: (sessionId, isPinned) =>
    togglePinSessionInDb(sessionId, isPinned),
  clearSessionMessages: (sessionId, updatedAt, updatedAtMs) =>
    clearSessionMessagesInDb(sessionId, updatedAt, updatedAtMs),
  deleteSessionCascade: (sessionId) => deleteSessionCascadeInDb(sessionId),
  addSessionAttachment: (sessionId, attachment, updatedAt, updatedAtMs) =>
    addSessionAttachmentInDb(sessionId, attachment, updatedAt, updatedAtMs),
  removeSessionAttachment: (sessionId, attachmentId, updatedAt, updatedAtMs) =>
    removeSessionAttachmentInDb(
      sessionId,
      attachmentId,
      updatedAt,
      updatedAtMs
    ),
  saveKnowledgeCategory: (schoolId, categoryKey, content) =>
    saveKnowledgeCategoryInDb(schoolId, categoryKey, content),
  saveDocument: (doc) => saveDocumentInDb(doc),
  deleteDocument: (docId) => deleteDocumentInDb(docId),
  saveCompanionMessages: (messages) => saveCompanionMessagesToDb(messages),
  clearCompanionMessages: (seedMessage) =>
    clearCompanionMessagesInDb(
      seedMessage || createInitialCompanionGreetingMessage()
    ),
  saveCompanionMemory: (record) => saveCompanionMemoryInDb(record),
  deleteCompanionMemory: (id) => deleteCompanionMemoryInDb(id),
  clearAllCompanionMemory: () => clearAllCompanionMemoryInDb(),
  saveCompanionTask: (task) => saveCompanionTaskInDb(task),
  deleteCompanionTask: (id) => deleteCompanionTaskInDb(id),
  getAllCompanionTasks: () => getAllCompanionTasksFromDb(),
  saveCompanionPreferences: (prefs) => saveCompanionPreferencesInDb(prefs),
  exportBackup: (settings) => exportWorkspaceBackupFromDb(settings),
  validateBackupJson: (rawJson) => validateBackupArchiveJson(rawJson),
  restoreBackup: (archive) => restoreWorkspaceBackupInDb(archive),
};

export {
  createDefaultCompanionPreferences,
  createInitialCompanionGreetingMessage,
  sortSessionsPinnedAndUpdatedDesc,
};
export type { ValidatedBackupSummary };
