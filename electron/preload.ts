import { contextBridge, ipcRenderer } from 'electron';
import type {
  AIConnectionProfile,
  FailoverSequenceSettings,
  OllamaLocalInfo,
  SpecialistModelAssignments,
} from '../src/types/assistant';
import type {
  ConnectionTestResult,
  SaveProfileInput,
} from '../src/types/electronBridge';

// Expose safe, isolated Electron API to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  aiConnections: {
    isElectron: true,
    safeStorageAvailable: true,
    listProfiles: (): Promise<AIConnectionProfile[]> =>
      ipcRenderer.invoke('aiConnections:listProfiles'),
    saveProfile: (input: SaveProfileInput): Promise<AIConnectionProfile> =>
      ipcRenderer.invoke('aiConnections:saveProfile', input),
    deleteProfile: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('aiConnections:deleteProfile', id),
    testConnection: (id: string): Promise<ConnectionTestResult> =>
      ipcRenderer.invoke('aiConnections:testConnection', id),
    getSpecialistModels: (): Promise<SpecialistModelAssignments> =>
      ipcRenderer.invoke('aiConnections:getSpecialistModels'),
    saveSpecialistModels: (
      assignments: SpecialistModelAssignments
    ): Promise<SpecialistModelAssignments> =>
      ipcRenderer.invoke('aiConnections:saveSpecialistModels', assignments),
    getFailoverSettings: (): Promise<FailoverSequenceSettings> =>
      ipcRenderer.invoke('aiConnections:getFailoverSettings'),
    saveFailoverSettings: (
      settings: FailoverSequenceSettings
    ): Promise<FailoverSequenceSettings> =>
      ipcRenderer.invoke('aiConnections:saveFailoverSettings', settings),
    getOllamaStatus: (): Promise<OllamaLocalInfo> =>
      ipcRenderer.invoke('aiConnections:getOllamaStatus'),
    openExternalUrl: (url: string): Promise<void> =>
      ipcRenderer.invoke('shell:openExternal', url),
  },
  safeStorage: {
    isAvailable: (): boolean => true,
  },
  shell: {
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke('shell:openExternal', url),
  },
  ollama: {
    checkTags: (): Promise<{ models: Array<{ name: string }> }> =>
      ipcRenderer.invoke('ollama:checkTags'),
    chat: (payload: Record<string, unknown>): Promise<{
      model: string;
      message?: { content?: string };
    }> => ipcRenderer.invoke('ollama:chat', payload),
  },
});
