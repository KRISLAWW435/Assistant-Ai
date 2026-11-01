// electron/preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("electronAPI", {
  aiConnections: {
    isElectron: true,
    safeStorageAvailable: true,
    listProfiles: () => import_electron.ipcRenderer.invoke("aiConnections:listProfiles"),
    saveProfile: (input) => import_electron.ipcRenderer.invoke("aiConnections:saveProfile", input),
    deleteProfile: (id) => import_electron.ipcRenderer.invoke("aiConnections:deleteProfile", id),
    testConnection: (id) => import_electron.ipcRenderer.invoke("aiConnections:testConnection", id),
    getSpecialistModels: () => import_electron.ipcRenderer.invoke("aiConnections:getSpecialistModels"),
    saveSpecialistModels: (assignments) => import_electron.ipcRenderer.invoke("aiConnections:saveSpecialistModels", assignments),
    getFailoverSettings: () => import_electron.ipcRenderer.invoke("aiConnections:getFailoverSettings"),
    saveFailoverSettings: (settings) => import_electron.ipcRenderer.invoke("aiConnections:saveFailoverSettings", settings),
    getOllamaStatus: () => import_electron.ipcRenderer.invoke("aiConnections:getOllamaStatus"),
    openExternalUrl: (url) => import_electron.ipcRenderer.invoke("shell:openExternal", url)
  },
  safeStorage: {
    isAvailable: () => true
  },
  shell: {
    openExternal: (url) => import_electron.ipcRenderer.invoke("shell:openExternal", url)
  },
  ollama: {
    checkTags: () => import_electron.ipcRenderer.invoke("ollama:checkTags"),
    chat: (payload) => import_electron.ipcRenderer.invoke("ollama:chat", payload)
  }
});
