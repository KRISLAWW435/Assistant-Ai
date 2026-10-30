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
  downloadOllamaModel?(modelName: string): Promise<{ success: boolean; message: string }>;
  deleteOllamaModel?(modelName: string): Promise<{ success: boolean }>;
  openExternalUrl(url: string): Promise<void>;
}

export interface ElectronAppApi {
  aiConnections?: ElectronAIConnectionsBridge;
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
