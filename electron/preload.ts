import { contextBridge, ipcRenderer } from 'electron';
import type {
  AIConnectionProfile,
  FailoverSequenceSettings,
  OllamaLocalInfo,
  SpecialistModelAssignments,
} from '../src/types/assistant';
import type {
  CloudflareImageConnectionConfig,
  ConnectionTestResult,
  SaveCloudflareImageConfigInput,
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
    getCloudflareImageConfig: (): Promise<CloudflareImageConnectionConfig> =>
      ipcRenderer.invoke('aiConnections:getCloudflareImageConfig'),
    saveCloudflareImageConfig: (
      input: SaveCloudflareImageConfigInput
    ): Promise<CloudflareImageConnectionConfig> =>
      ipcRenderer.invoke('aiConnections:saveCloudflareImageConfig', input),
    openExternalUrl: (url: string): Promise<void> =>
      ipcRenderer.invoke('shell:openExternal', url),
  },
  annaMemory: {
    loadAll: () => ipcRenderer.invoke('annaMemory:loadAll'),
    saveSection: (section: string, data: any) =>
      ipcRenderer.invoke('annaMemory:saveSection', section, data),
    addMemory: (item: any) => ipcRenderer.invoke('annaMemory:addMemory', item),
    updateMemory: (item: any) => ipcRenderer.invoke('annaMemory:updateMemory', item),
    deleteMemory: (id: string) => ipcRenderer.invoke('annaMemory:deleteMemory', id),
    clearAll: () => ipcRenderer.invoke('annaMemory:clearAll'),
    getStorageInfo: () => ipcRenderer.invoke('annaMemory:getStorageInfo'),
    exportBackup: () => ipcRenderer.invoke('annaMemory:exportBackup'),
    importBackup: (jsonString: string) =>
      ipcRenderer.invoke('annaMemory:importBackup', jsonString),
  },
  notifications: {
    show: (payload: { title: string; body: string; silent?: boolean }): Promise<boolean> =>
      ipcRenderer.invoke('notifications:show', payload),
  },
  companionTasks: {
    loadAll: () => ipcRenderer.invoke('companionTasks:loadAll'),
    save: (task: any) => ipcRenderer.invoke('companionTasks:save', task),
    delete: (id: string) => ipcRenderer.invoke('companionTasks:delete', id),
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
  flow: {
    isAvailable: true,
    show: (bounds: { x: number; y: number; width: number; height: number }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('flow:show', bounds),
    hide: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('flow:hide'),
    updateBounds: (bounds: { x: number; y: number; width: number; height: number }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('flow:updateBounds', bounds),
    getState: (): Promise<{ isVisible: boolean; isLoading: boolean; currentUrl?: string; error?: string | null }> =>
      ipcRenderer.invoke('flow:getState'),
    reload: (): Promise<void> =>
      ipcRenderer.invoke('flow:reload'),
    onStateChange: (callback: (state: any) => void) => {
      const listener = (_event: any, state: any) => callback(state);
      ipcRenderer.on('flow:stateChange', listener);
      return () => {
        ipcRenderer.removeListener('flow:stateChange', listener);
      };
    },
  },
});

