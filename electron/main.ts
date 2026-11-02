import {
  app,
  BrowserWindow,
  ipcMain,
  Notification,
  safeStorage,
  session,
  shell,
} from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  startServer,
  setServerGeminiKey,
  setServerOpenRouterKey,
  RunningAssistantServer,
} from '../server';
import type {
  AIConnectionProfile,
  AIConnectionStatus,
  FailoverSequenceSettings,
  OllamaLocalInfo,
  SpecialistModelAssignments,
} from '../src/types/assistant';
import type {
  ConnectionTestResult,
  SaveProfileInput,
} from '../src/types/electronBridge';
import {
  AnnaInterest,
  AnnaMemoryBundle,
  AnnaMemoryItem,
  AnnaPreference,
  AnnaProfile,
  AnnaProjectContext,
  INITIAL_ANNA_INTERESTS,
  INITIAL_ANNA_MEMORIES,
  INITIAL_ANNA_PREFERENCES,
  INITIAL_ANNA_PROFILE,
} from '../src/types/annaMemory';

const _mainDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

// 1. Enforce single application instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let runningServer: RunningAssistantServer | null = null;
let actualServerPort = 3000;

// Persistent User Data Directory: %APPDATA%/kiberone-renderia-assistant
const userDataDir = path.join(app.getPath('appData'), 'kiberone-renderia-assistant');
if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}
app.setPath('userData', userDataDir);

// Dedicated Long-Term Storage Directory for Anna: %APPDATA%/kiberone-renderia-assistant/PixelData/Anna/
const pixelAnnaDir = path.join(userDataDir, 'PixelData', 'Anna');
const pixelConversationsDir = path.join(pixelAnnaDir, 'conversations');
if (!fs.existsSync(pixelConversationsDir)) {
  fs.mkdirSync(pixelConversationsDir, { recursive: true });
}

function safeWriteJson(filePath: string, data: unknown): void {
  const tmpPath = `${filePath}.tmp`;
  const bakPath = `${filePath}.bak`;
  try {
    const serialized = JSON.stringify(data, null, 2);
    fs.writeFileSync(tmpPath, serialized, 'utf-8');
    if (fs.existsSync(filePath)) {
      try {
        fs.copyFileSync(filePath, bakPath);
      } catch {
        // ignore backup copy failure
      }
    }
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error(`[AnnaMemory] Safe write failed for ${filePath}:`, err);
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // ignore
    }
  }
}

function readJsonOrDefault<T>(filePath: string, defaultVal: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      safeWriteJson(filePath, defaultVal);
      return defaultVal;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[AnnaMemory] Read error for ${filePath}, attempting .bak:`, err);
    const bakPath = `${filePath}.bak`;
    if (fs.existsSync(bakPath)) {
      try {
        const bakRaw = fs.readFileSync(bakPath, 'utf-8');
        return JSON.parse(bakRaw) as T;
      } catch {
        // ignore
      }
    }
    return defaultVal;
  }
}

function initAnnaMemoryStorage(): AnnaMemoryBundle {
  const profilePath = path.join(pixelAnnaDir, 'profile.json');
  const interestsPath = path.join(pixelAnnaDir, 'interests.json');
  const preferencesPath = path.join(pixelAnnaDir, 'preferences.json');
  const projectsPath = path.join(pixelAnnaDir, 'projects.json');
  const memoriesPath = path.join(pixelAnnaDir, 'memories.json');

  const profile = readJsonOrDefault<AnnaProfile>(profilePath, INITIAL_ANNA_PROFILE);
  const interests = readJsonOrDefault<AnnaInterest[]>(interestsPath, INITIAL_ANNA_INTERESTS);
  const preferences = readJsonOrDefault<AnnaPreference[]>(preferencesPath, INITIAL_ANNA_PREFERENCES);
  const projects = readJsonOrDefault<AnnaProjectContext[]>(projectsPath, [
    {
      id: 'proj-kiberone-start',
      schoolId: 'kiberone',
      name: 'Учебный год KIBERone',
      description: 'Сопровождение групп, открытые уроки, контроль посещаемости и работы с родителями',
      status: 'active',
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'proj-renderia-start',
      schoolId: 'renderia',
      name: 'Развитие направлений Renderia',
      description: 'Курсы 3D-графики, анимации и цифрового творчества, мастер-классы',
      status: 'active',
      updatedAt: new Date().toISOString(),
    },
  ]);
  const memories = readJsonOrDefault<AnnaMemoryItem[]>(memoriesPath, INITIAL_ANNA_MEMORIES);

  return {
    profile,
    interests,
    preferences,
    projects,
    memories,
    storageInfo: {
      isElectron: true,
      storagePath: pixelAnnaDir,
      autoSaveEnabled: true,
      lastSavedAt: new Date().toISOString(),
      version: '1.0.0',
    },
  };
}

interface StoredVaultItem {
  id: string;
  providerId: 'gemini' | 'openrouter' | 'ollama';
  userDefinedName: string;
  encryptedKeyBase64?: string;
  selectedModel: string;
  isDefault?: boolean;
  createdAt: string;
}

interface VaultData {
  profiles: StoredVaultItem[];
  specialistAssignments?: SpecialistModelAssignments;
  failoverSettings?: FailoverSequenceSettings;
}

const VAULT_FILE_PATH = path.join(userDataDir, 'ai-connections-vault.json');

function maskApiKey(key: string): string {
  const trimmed = (key || '').trim();
  if (!trimmed) return 'Не настроен';
  if (trimmed.length <= 8) return '••••••••';
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••${suffix}`;
}

function encryptSecret(plainText: string): string {
  if (!plainText) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encryptedBuffer = safeStorage.encryptString(plainText);
      return encryptedBuffer.toString('base64');
    }
  } catch (err) {
    console.warn('[SafeStorage] Windows DPAPI encryption error:', err);
  }
  // Base64 fallback if DPAPI unavailable
  return Buffer.from(plainText, 'utf-8').toString('base64');
}

function decryptSecret(encryptedBase64: string): string {
  if (!encryptedBase64) return '';
  try {
    const buf = Buffer.from(encryptedBase64, 'base64');
    if (safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(buf);
      } catch {
        // May have been plain base64 fallback
      }
    }
    return buf.toString('utf-8');
  } catch (err) {
    console.warn('[SafeStorage] Decryption error:', err);
    return '';
  }
}

function readVault(): VaultData {
  try {
    if (fs.existsSync(VAULT_FILE_PATH)) {
      const raw = fs.readFileSync(VAULT_FILE_PATH, 'utf-8');
      return JSON.parse(raw) as VaultData;
    }
  } catch (err) {
    console.warn('[Vault] Failed to read vault file:', err);
  }
  return { profiles: [] };
}

function writeVault(data: VaultData): void {
  try {
    fs.writeFileSync(VAULT_FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Vault] Failed to write vault file:', err);
  }
}

function syncVaultKeysToServer(): void {
  const vault = readVault();
  for (const item of vault.profiles) {
    if (item.encryptedKeyBase64) {
      const rawKey = decryptSecret(item.encryptedKeyBase64);
      if (rawKey) {
        if (item.providerId === 'gemini') {
          setServerGeminiKey(rawKey);
        } else if (item.providerId === 'openrouter') {
          setServerOpenRouterKey(rawKey);
        }
      }
    }
  }
}

function getAppIconPath(): string {
  const candidates = [
    path.join(_mainDir, '../build/icon.ico'),
    path.join(_mainDir, '../public/icon.ico'),
    path.join(process.resourcesPath, 'build/icon.ico'),
    path.join(process.resourcesPath, 'app/build/icon.ico'),
    path.join(_mainDir, '../build/icon.png'),
    path.join(_mainDir, '../public/icon.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return '';
}

async function startEmbeddedServer(): Promise<number> {
  const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;
  const distDir = isDev
    ? path.join(_mainDir, '../dist')
    : path.join(app.getAppPath(), 'dist');

  // Try port 3000 first, fallback to dynamic port if occupied
  try {
    const srv = await startServer({
      port: 3000,
      host: '127.0.0.1',
      distPath: distDir,
      isElectronProduction: !isDev,
    });
    runningServer = srv;
    actualServerPort = srv.port;
    return srv.port;
  } catch (portErr: unknown) {
    console.warn('[Server] Port 3000 unavailable, assigning dynamic port:', portErr);
    const srv = await startServer({
      port: 0,
      host: '127.0.0.1',
      distPath: distDir,
      isElectronProduction: !isDev,
    });
    runningServer = srv;
    actualServerPort = srv.port;
    return srv.port;
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('aiConnections:listProfiles', async (): Promise<AIConnectionProfile[]> => {
    const vault = readVault();
    return vault.profiles.map((p) => {
      const hasKey = Boolean(p.encryptedKeyBase64);
      const rawKey = hasKey ? decryptSecret(p.encryptedKeyBase64!) : '';
      return {
        id: p.id,
        providerId: p.providerId,
        userDefinedName: p.userDefinedName,
        maskedKey:
          p.providerId === 'ollama'
            ? 'Локальный API (без ключа)'
            : maskApiKey(rawKey),
        encryptedCredentialReference: `vault:${p.id}`,
        selectedModel: p.selectedModel,
        connectionStatus: (p.providerId === 'ollama' || hasKey ? 'connected' : 'not_configured') as AIConnectionStatus,
        isDefault: p.isDefault,
        createdAt: p.createdAt,
      };
    });
  });

  ipcMain.handle(
    'aiConnections:saveProfile',
    async (_event, input: SaveProfileInput): Promise<AIConnectionProfile> => {
      const vault = readVault();
      const cleanKey = (input.rawApiKey || '').trim();
      const existingIdx = input.id
        ? vault.profiles.findIndex((p) => p.id === input.id)
        : -1;
      const profileId = input.id || `profile-${Date.now()}`;

      let encryptedKeyBase64 = '';
      if (cleanKey) {
        encryptedKeyBase64 = encryptSecret(cleanKey);
      } else if (existingIdx >= 0) {
        encryptedKeyBase64 = vault.profiles[existingIdx].encryptedKeyBase64 || '';
      }

      if (input.isDefault) {
        vault.profiles.forEach((p) => {
          if (p.providerId === input.providerId) p.isDefault = false;
        });
      }

      const item: StoredVaultItem = {
        id: profileId,
        providerId: input.providerId,
        userDefinedName: input.userDefinedName,
        encryptedKeyBase64,
        selectedModel: input.selectedModel,
        isDefault: input.isDefault ?? false,
        createdAt:
          existingIdx >= 0
            ? vault.profiles[existingIdx].createdAt
            : new Date().toISOString(),
      };

      if (existingIdx >= 0) {
        vault.profiles[existingIdx] = item;
      } else {
        vault.profiles.push(item);
      }

      writeVault(vault);

      // Pass updated secret directly to server memory
      if (cleanKey) {
        if (input.providerId === 'gemini') {
          setServerGeminiKey(cleanKey);
        } else if (input.providerId === 'openrouter') {
          setServerOpenRouterKey(cleanKey);
        }
      }

      const currentRawKey = cleanKey || (encryptedKeyBase64 ? decryptSecret(encryptedKeyBase64) : '');
      return {
        id: item.id,
        providerId: item.providerId,
        userDefinedName: item.userDefinedName,
        maskedKey:
          item.providerId === 'ollama'
            ? 'Локальный API (без ключа)'
            : maskApiKey(currentRawKey),
        encryptedCredentialReference: `vault:${item.id}`,
        selectedModel: item.selectedModel,
        connectionStatus: (item.providerId === 'ollama' || currentRawKey ? 'connected' : 'not_configured') as AIConnectionStatus,
        isDefault: item.isDefault,
        createdAt: item.createdAt,
      };
    }
  );

  ipcMain.handle('aiConnections:deleteProfile', async (_event, id: string): Promise<boolean> => {
    const vault = readVault();
    vault.profiles = vault.profiles.filter((p) => p.id !== id);
    writeVault(vault);
    return true;
  });

  ipcMain.handle(
    'aiConnections:testConnection',
    async (_event, id: string): Promise<ConnectionTestResult> => {
      const vault = readVault();
      const profile = vault.profiles.find((p) => p.id === id);
      if (!profile) {
        return {
          ok: false,
          status: 'error',
          model: 'unknown',
          error: 'Профиль подключения не найден',
          testedAt: new Date().toISOString(),
        };
      }

      const rawKey = profile.encryptedKeyBase64
        ? decryptSecret(profile.encryptedKeyBase64)
        : '';

      if (profile.providerId === 'ollama') {
        try {
          const res = await fetch('http://127.0.0.1:11434/api/tags');
          if (res.ok) {
            return {
              ok: true,
              status: 'connected',
              model: profile.selectedModel,
              testedAt: new Date().toISOString(),
            };
          }
        } catch {
          // offline
        }
        return {
          ok: false,
          status: 'not_configured',
          model: profile.selectedModel,
          error: 'Сервер Ollama (127.0.0.1:11434) не отвечает',
          testedAt: new Date().toISOString(),
        };
      }

      if (!rawKey) {
        return {
          ok: false,
          status: 'not_configured',
          model: profile.selectedModel,
          error: 'Ключ API не задан в профиле',
          testedAt: new Date().toISOString(),
        };
      }

      return {
        ok: true,
        status: 'connected',
        model: profile.selectedModel,
        testedAt: new Date().toISOString(),
      };
    }
  );

  ipcMain.handle('aiConnections:getSpecialistModels', async () => {
    const vault = readVault();
    return vault.specialistAssignments || {};
  });

  ipcMain.handle(
    'aiConnections:saveSpecialistModels',
    async (_event, assignments: SpecialistModelAssignments) => {
      const vault = readVault();
      vault.specialistAssignments = assignments;
      writeVault(vault);
      return assignments;
    }
  );

  ipcMain.handle('aiConnections:getFailoverSettings', async () => {
    const vault = readVault();
    return (
      vault.failoverSettings || {
        order: ['gemini', 'openrouter', 'ollama'],
        allowCloudFailoverForDocs: false,
        requireExplicitDocConsent: true,
      }
    );
  });

  ipcMain.handle(
    'aiConnections:saveFailoverSettings',
    async (_event, settings: FailoverSequenceSettings) => {
      const vault = readVault();
      vault.failoverSettings = settings;
      writeVault(vault);
      return settings;
    }
  );

  ipcMain.handle('aiConnections:getOllamaStatus', async (): Promise<OllamaLocalInfo> => {
    try {
      const res = await fetch('http://127.0.0.1:11434/api/tags');
      if (res.ok) {
        const json = (await res.json()) as { models?: Array<{ name: string; size?: number }> };
        const models = (json.models || []).map((m) => ({
          name: m.name,
          sizeBytes: m.size,
        }));
        return {
          installed: true,
          running: true,
          version: '0.5.0+',
          models,
          apiUrl: 'http://127.0.0.1:11434',
          lastCheckedAt: new Date().toISOString(),
        };
      }
    } catch {
      // offline
    }
    return {
      installed: false,
      running: false,
      models: [],
      apiUrl: 'http://127.0.0.1:11434',
      lastCheckedAt: new Date().toISOString(),
    };
  });

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      await shell.openExternal(url);
    }
  });

  ipcMain.handle('ollama:checkTags', async () => {
    const res = await fetch('http://127.0.0.1:11434/api/tags');
    if (!res.ok) throw new Error('Ollama offline');
    return (await res.json()) as { models: Array<{ name: string }> };
  });

  ipcMain.handle('ollama:chat', async (_event, payload: Record<string, unknown>) => {
    const res = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Ollama chat error ${res.status}`);
    return (await res.json()) as {
      model: string;
      message?: { content?: string };
    };
  });

  // --- Anna Personal Long-Term Memory IPC Handlers ---
  ipcMain.handle('annaMemory:loadAll', async () => {
    return initAnnaMemoryStorage();
  });

  ipcMain.handle(
    'annaMemory:saveSection',
    async (_event, section: string, data: unknown) => {
      const allowed = ['profile', 'interests', 'preferences', 'projects', 'memories'];
      if (!allowed.includes(section)) {
        throw new Error(`Unauthorized section: ${section}`);
      }
      const filePath = path.join(pixelAnnaDir, `${section}.json`);
      safeWriteJson(filePath, data);
      return true;
    }
  );

  ipcMain.handle(
    'annaMemory:addMemory',
    async (_event, item: AnnaMemoryItem) => {
      const filePath = path.join(pixelAnnaDir, 'memories.json');
      const current = readJsonOrDefault<AnnaMemoryItem[]>(filePath, INITIAL_ANNA_MEMORIES);
      const existingIdx = current.findIndex((m) => m.id === item.id);
      let updated: AnnaMemoryItem[];
      if (existingIdx >= 0) {
        updated = [...current];
        updated[existingIdx] = { ...item, updatedAt: new Date().toISOString() };
      } else {
        updated = [item, ...current];
      }
      safeWriteJson(filePath, updated);
      return true;
    }
  );

  ipcMain.handle(
    'annaMemory:updateMemory',
    async (_event, item: AnnaMemoryItem) => {
      const filePath = path.join(pixelAnnaDir, 'memories.json');
      const current = readJsonOrDefault<AnnaMemoryItem[]>(filePath, INITIAL_ANNA_MEMORIES);
      const updated = current.map((m) => (m.id === item.id ? { ...item, updatedAt: new Date().toISOString() } : m));
      safeWriteJson(filePath, updated);
      return true;
    }
  );

  ipcMain.handle('annaMemory:deleteMemory', async (_event, id: string) => {
    const filePath = path.join(pixelAnnaDir, 'memories.json');
    const current = readJsonOrDefault<AnnaMemoryItem[]>(filePath, INITIAL_ANNA_MEMORIES);
    const updated = current.filter((m) => m.id !== id);
    safeWriteJson(filePath, updated);
    return true;
  });

  ipcMain.handle('annaMemory:clearAll', async () => {
    const timestamp = Date.now();
    const backupDir = path.join(pixelAnnaDir, `backup_${timestamp}`);
    try {
      fs.mkdirSync(backupDir, { recursive: true });
      for (const file of ['profile.json', 'interests.json', 'preferences.json', 'projects.json', 'memories.json']) {
        const src = path.join(pixelAnnaDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(backupDir, file));
        }
      }
    } catch {
      // ignore
    }
    safeWriteJson(path.join(pixelAnnaDir, 'profile.json'), INITIAL_ANNA_PROFILE);
    safeWriteJson(path.join(pixelAnnaDir, 'interests.json'), INITIAL_ANNA_INTERESTS);
    safeWriteJson(path.join(pixelAnnaDir, 'preferences.json'), INITIAL_ANNA_PREFERENCES);
    safeWriteJson(path.join(pixelAnnaDir, 'projects.json'), []);
    safeWriteJson(path.join(pixelAnnaDir, 'memories.json'), []);
    return true;
  });

  ipcMain.handle('annaMemory:getStorageInfo', async () => {
    const memoriesPath = path.join(pixelAnnaDir, 'memories.json');
    const current = readJsonOrDefault<AnnaMemoryItem[]>(memoriesPath, []);
    return {
      isElectron: true,
      storagePath: pixelAnnaDir,
      autoSaveEnabled: true,
      itemCount: current.length,
      lastSavedAt: new Date().toISOString(),
    };
  });

  ipcMain.handle('annaMemory:exportBackup', async () => {
    const bundle = initAnnaMemoryStorage();
    return JSON.stringify(bundle, null, 2);
  });

    ipcMain.handle('annaMemory:importBackup', async (_event, jsonString: string) => {
    const parsed = JSON.parse(jsonString) as Partial<AnnaMemoryBundle>;
    if (parsed.profile) safeWriteJson(path.join(pixelAnnaDir, 'profile.json'), parsed.profile);
    if (parsed.interests) safeWriteJson(path.join(pixelAnnaDir, 'interests.json'), parsed.interests);
    if (parsed.preferences) safeWriteJson(path.join(pixelAnnaDir, 'preferences.json'), parsed.preferences);
    if (parsed.projects) safeWriteJson(path.join(pixelAnnaDir, 'projects.json'), parsed.projects);
    if (parsed.memories) safeWriteJson(path.join(pixelAnnaDir, 'memories.json'), parsed.memories);
    return true;
  });

  // Companion Tasks disk mirror (ensures tasks & reminders survive port changes & restarts)
  const companionTasksPath = path.join(pixelAnnaDir, 'tasks.json');

  ipcMain.handle('companionTasks:loadAll', async () => {
    return readJsonOrDefault<any[]>(companionTasksPath, []);
  });

  ipcMain.handle('companionTasks:save', async (_event, task: any) => {
    if (!task || typeof task.id !== 'string') return false;
    const current = readJsonOrDefault<any[]>(companionTasksPath, []);
    const idx = current.findIndex((t) => t && t.id === task.id);
    if (idx >= 0) {
      current[idx] = task;
    } else {
      current.unshift(task);
    }
    safeWriteJson(companionTasksPath, current);
    return true;
  });

  ipcMain.handle('companionTasks:delete', async (_event, taskId: string) => {
    if (!taskId) return false;
    const current = readJsonOrDefault<any[]>(companionTasksPath, []);
    const next = current.filter((t) => t && t.id !== taskId);
    safeWriteJson(companionTasksPath, next);
    return true;
  });

  // Native OS notifications (works even when window is minimized)
  ipcMain.handle(
    'notifications:show',
    async (_event, payload: { title: string; body: string; silent?: boolean }) => {
      try {
        if (!Notification.isSupported()) {
          return false;
        }
        const iconPath = getAppIconPath();
        const notification = new Notification({
          title: payload?.title || 'Пиксель — напоминание',
          body: payload?.body || '',
          icon: iconPath || undefined,
          silent: Boolean(payload?.silent),
        });
        notification.on('click', () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          }
        });
        notification.show();
        return true;
      } catch (err) {
        console.warn('[Electron Notification] Failed to show notification:', err);
        return false;
      }
    }
  );
}

async function createMainWindow(port: number): Promise<void> {
  const iconPath = getAppIconPath();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'KIBERone & RENDERIA Business Assistant',
    icon: iconPath || undefined,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(_mainDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  // Handle external links safely in OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Grant microphone, speech recognition & notifications permissions for Pixel Voice, Live API & Reminders
  const allowedVoicePermissions = new Set([
    'media',
    'microphone',
    'audio-capture',
    'speech-recognition',
    'notifications',
  ]);

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      if (allowedVoicePermissions.has(permission)) {
        callback(true);
      } else {
        callback(false);
      }
    }
  );

  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => {
      return allowedVoicePermissions.has(permission);
    }
  );

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const appUrl = `http://127.0.0.1:${port}`;
  console.log(`[Electron] Loading application URL: ${appUrl}`);
  await mainWindow.loadURL(appUrl);
}

// App lifecycle
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  try {
    // 1. Sync saved encrypted keys to server memory
    syncVaultKeysToServer();

    // 2. Register IPC handlers
    registerIpcHandlers();

    // 3. Start local embedded Express + WebSocket server
    const port = await startEmbeddedServer();

    // 4. Create and load main window
    await createMainWindow(port);
  } catch (err) {
    console.error('[Electron Startup Fatal Error]', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (runningServer) {
    try {
      await runningServer.close();
    } catch {
      // ignore server close error
    }
    runningServer = null;
  }
});
