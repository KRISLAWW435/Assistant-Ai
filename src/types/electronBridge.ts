import {
  AIConnectionProfile,
  AIConnectionStatus,
  AIProviderId,
  FailoverSequenceSettings,
  OllamaLocalInfo,
  SpecialistModelAssignments,
} from './assistant';

export interface SaveProfileInput {
  id?: string;
  providerId: AIProviderId;
  userDefinedName: string;
  rawApiKey?: string;
  selectedModel: string;
  isDefault?: boolean;
}

export interface ConnectionTestResult {
  ok: boolean;
  status: AIConnectionStatus;
  model: string;
  error?: string;
  testedAt: string;
  latencyMs?: number;
}

export interface CloudflareImageConnectionConfig {
  configured: boolean;
  accountId: string;
  maskedApiToken: string;
  hasSavedToken: boolean;
  tokenStatusLabel?: string;
  storageMode?:
    | 'electron_safe_storage'
    | 'server_encrypted_file'
    | 'server_encrypted_memory';
  persistentEncryptedAvailable?: boolean;
  storageDescriptionRu?: string;
}

export interface SaveCloudflareImageConfigInput {
  accountId: string;
  rawApiToken?: string;
}

export interface ElectronAIConnectionsBridge {
  isElectron: boolean;
  safeStorageAvailable: boolean;
  listProfiles(): Promise<AIConnectionProfile[]>;
  saveProfile(input: SaveProfileInput): Promise<AIConnectionProfile>;
  deleteProfile(id: string): Promise<boolean>;
  testConnection(id: string): Promise<ConnectionTestResult>;
  getSpecialistModels(): Promise<SpecialistModelAssignments>;
  saveSpecialistModels(assignments: SpecialistModelAssignments): Promise<SpecialistModelAssignments>;
  getFailoverSettings(): Promise<FailoverSequenceSettings>;
  saveFailoverSettings(settings: FailoverSequenceSettings): Promise<FailoverSequenceSettings>;
  getOllamaStatus(): Promise<OllamaLocalInfo>;
  getCloudflareImageConfig?(): Promise<CloudflareImageConnectionConfig>;
  saveCloudflareImageConfig?(
    input: SaveCloudflareImageConfigInput
  ): Promise<CloudflareImageConnectionConfig>;
  downloadOllamaModel?(modelName: string): Promise<{ success: boolean; message: string }>;
  deleteOllamaModel?(modelName: string): Promise<{ success: boolean }>;
  openExternalUrl(url: string): Promise<void>;
}

export interface ElectronAnnaMemoryBridge {
  loadAll(): Promise<import('./annaMemory').AnnaMemoryBundle>;
  saveSection<K extends 'profile' | 'interests' | 'preferences' | 'projects' | 'memories'>(
    section: K,
    data: import('./annaMemory').AnnaMemoryBundle[K]
  ): Promise<boolean>;
  addMemory(item: import('./annaMemory').AnnaMemoryItem): Promise<boolean>;
  updateMemory(item: import('./annaMemory').AnnaMemoryItem): Promise<boolean>;
  deleteMemory(id: string): Promise<boolean>;
  clearAll(): Promise<boolean>;
  getStorageInfo(): Promise<{
    isElectron: boolean;
    storagePath: string;
    autoSaveEnabled: boolean;
    itemCount: number;
    lastSavedAt: string;
  }>;
  exportBackup(): Promise<string>;
  importBackup(jsonString: string): Promise<boolean>;
}

export interface ElectronNotificationsBridge {
  show(payload: { title: string; body: string; silent?: boolean }): Promise<boolean>;
}

export interface ElectronCompanionTasksBridge {
  loadAll(): Promise<import('./assistant').CompanionTaskRecord[]>;
  save(task: import('./assistant').CompanionTaskRecord): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}

export interface FlowViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlowViewState {
  isVisible: boolean;
  isLoading: boolean;
  currentUrl?: string;
  error?: string | null;
}

export interface ElectronFlowBridge {
  isAvailable: boolean;
  show(bounds: FlowViewBounds): Promise<{ success: boolean; error?: string }>;
  hide(): Promise<{ success: boolean }>;
  updateBounds(bounds: FlowViewBounds): Promise<{ success: boolean }>;
  getState(): Promise<FlowViewState>;
  reload(): Promise<void>;
  insertPrompt(promptText: string): Promise<{ success: boolean; error?: string }>;
  onStateChange?(callback: (state: FlowViewState) => void): () => void;
}

export interface ElectronFilesBridge {
  saveToDisk(payload: {
    fileName: string;
    buffer?: ArrayBuffer | Uint8Array;
    filePath?: string;
    school?: string;
    category?: string;
    chatId?: string;
  }): Promise<{
    success: boolean;
    absolutePath: string;
    fileName: string;
    sizeBytes: number;
    folderPath: string;
  }>;
  openFolder(params?: {
    school?: string;
    category?: string;
    folderPath?: string;
    chatId?: string;
  }): Promise<{ success: boolean; path: string; error?: string }>;
  showInFolder(absolutePath: string): Promise<boolean>;
  getBasePath(): Promise<string>;
  saveCopy(sourcePath: string, suggestedName?: string): Promise<{ success: boolean; destinationPath?: string }>;
  readFile(sourcePath: string): Promise<ArrayBuffer>;
  deleteFile?(filePath: string): Promise<{ success: boolean; error?: string }>;
  deleteChatFiles?(chatId: string, school?: string): Promise<{ success: boolean; error?: string }>;
  extractMultimodalContent?(
    filePath: string,
    fileType?: string
  ): Promise<{ text: string; images: string[] }>;
}

export interface ElectronAppApi {
  aiConnections?: ElectronAIConnectionsBridge;
  annaMemory?: ElectronAnnaMemoryBridge;
  notifications?: ElectronNotificationsBridge;
  companionTasks?: ElectronCompanionTasksBridge;
  flow?: ElectronFlowBridge;
  files?: ElectronFilesBridge;
  safeStorage?: {
    isAvailable(): boolean;
  };
  shell?: {
    openExternal(url: string): Promise<void>;
  };
  ollama?: {
    checkTags?: () => Promise<{ models: Array<{ name: string }> }>;
    chat?: (payload: Record<string, unknown>) => Promise<{
      model: string;
      message?: { content?: string };
    }>;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAppApi;
  }
}

