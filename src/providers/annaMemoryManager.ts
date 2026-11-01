/**
 * Anna's Personal Long-Term Memory Manager for Pixel Companion.
 *
 * Transparently supports:
 * - Windows Electron runtime with dedicated local files in %APPDATA%/.../PixelData/Anna/
 * - Browser web preview via persistent IndexedDB / localStorage
 * - Automatic gradual memory extraction without artificial interviews
 * - Strict safeguards against saving sensitive credentials or API keys
 */

import {
  AnnaInterest,
  AnnaMemoryBundle,
  AnnaMemoryCategory,
  AnnaMemoryItem,
  AnnaMemoryStatus,
  AnnaPreference,
  AnnaProfile,
  AnnaProjectContext,
  INITIAL_ANNA_INTERESTS,
  INITIAL_ANNA_MEMORIES,
  INITIAL_ANNA_PREFERENCES,
  INITIAL_ANNA_PROFILE,
} from '../types/annaMemory';

const WEB_STORAGE_KEY = 'kiber_anna_long_term_memory_v1';
const AUTO_MEMORY_FLAG_KEY = 'kiber_anna_auto_memory_enabled';

export interface AnnaStorageInfo {
  isElectron: boolean;
  basePath: string;
  storagePath: string;
  isAutoSaveEnabled: boolean;
  autoSaveEnabled: boolean;
  itemCount: number;
  lastSavedAt: string;
}

class AnnaMemoryManager {
  private bundle: AnnaMemoryBundle | null = null;
  private listeners = new Set<(bundle: AnnaMemoryBundle) => void>();
  private autoSaveEnabled = true;

  constructor() {
    if (typeof window !== 'undefined') {
      const storedFlag = localStorage.getItem(AUTO_MEMORY_FLAG_KEY);
      this.autoSaveEnabled = storedFlag !== 'false';
    }
  }

  public isElectron(): boolean {
    if (typeof window === 'undefined') return false;
    return Boolean(window.electronAPI?.annaMemory);
  }

  public getAll(): AnnaMemoryBundle {
    if (this.bundle) return this.bundle;
    return this.loadBundleSync();
  }

  public loadBundleSync(): AnnaMemoryBundle {
    if (this.bundle) return this.bundle;
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(WEB_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as AnnaMemoryBundle;
          this.bundle = parsed;
          return parsed;
        }
      } catch {
        // ignore parse error
      }
    }

    const initialBundle: AnnaMemoryBundle = {
      profile: { ...INITIAL_ANNA_PROFILE },
      interests: [...INITIAL_ANNA_INTERESTS],
      preferences: [...INITIAL_ANNA_PREFERENCES],
      projects: [
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
      ],
      memories: [...INITIAL_ANNA_MEMORIES],
      storageInfo: {
        isElectron: false,
        storagePath: 'Локальное изолированное хранилище браузера (IndexedDB / Web Storage)',
        autoSaveEnabled: this.autoSaveEnabled,
        lastSavedAt: new Date().toISOString(),
        version: '1.0.0',
      },
    };

    this.bundle = initialBundle;
    this.persistWebBundle(initialBundle);
    return initialBundle;
  }

  public getStorageInfoSync(): AnnaStorageInfo {
    const isElec = this.isElectron();
    const bundle = this.getAll();
    const pathStr = isElec
      ? 'AppData/Roaming/kiberone-renderia-assistant/PixelData/Anna/'
      : 'Локальное изолированное хранилище браузера (IndexedDB / Web Storage)';
    return {
      isElectron: isElec,
      basePath: pathStr,
      storagePath: pathStr,
      isAutoSaveEnabled: this.autoSaveEnabled,
      autoSaveEnabled: this.autoSaveEnabled,
      itemCount: bundle.memories.length,
      lastSavedAt: bundle.storageInfo?.lastSavedAt || new Date().toISOString(),
    };
  }

  public async getStorageInfo(): Promise<AnnaStorageInfo> {
    if (this.isElectron() && window.electronAPI?.annaMemory) {
      const elecInfo = await window.electronAPI.annaMemory.getStorageInfo();
      return {
        isElectron: true,
        basePath: elecInfo.storagePath,
        storagePath: elecInfo.storagePath,
        isAutoSaveEnabled: elecInfo.autoSaveEnabled,
        autoSaveEnabled: elecInfo.autoSaveEnabled,
        itemCount: elecInfo.itemCount,
        lastSavedAt: elecInfo.lastSavedAt,
      };
    }
    return this.getStorageInfoSync();
  }

  public isAutoSaveEnabled(): boolean {
    return this.autoSaveEnabled;
  }

  public setAutoSaveEnabled(enabled: boolean): void {
    this.autoSaveEnabled = enabled;
    if (typeof window !== 'undefined') {
      localStorage.setItem(AUTO_MEMORY_FLAG_KEY, enabled ? 'true' : 'false');
    }
    if (this.bundle) {
      this.bundle.storageInfo.autoSaveEnabled = enabled;
      this.notify();
    }
  }

  public async loadBundle(): Promise<AnnaMemoryBundle> {
    if (this.bundle) return this.bundle;

    if (this.isElectron() && window.electronAPI?.annaMemory) {
      try {
        const loaded = await window.electronAPI.annaMemory.loadAll();
        this.bundle = loaded;
        return loaded;
      } catch (err) {
        console.warn('[AnnaMemory] Electron bridge read error, falling back:', err);
      }
    }

    // Web fallback
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(WEB_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as AnnaMemoryBundle;
          this.bundle = parsed;
          return parsed;
        }
      } catch {
        // ignore parse error
      }
    }

    const initialBundle: AnnaMemoryBundle = {
      profile: { ...INITIAL_ANNA_PROFILE },
      interests: [...INITIAL_ANNA_INTERESTS],
      preferences: [...INITIAL_ANNA_PREFERENCES],
      projects: [
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
      ],
      memories: [...INITIAL_ANNA_MEMORIES],
      storageInfo: {
        isElectron: false,
        storagePath: 'Локальное изолированное хранилище браузера (IndexedDB / Web Storage)',
        autoSaveEnabled: this.autoSaveEnabled,
        lastSavedAt: new Date().toISOString(),
        version: '1.0.0',
      },
    };

    this.bundle = initialBundle;
    this.persistWebBundle(initialBundle);
    return initialBundle;
  }

  private persistWebBundle(bundle: AnnaMemoryBundle): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(WEB_STORAGE_KEY, JSON.stringify(bundle));
    } catch {
      // ignore
    }
  }

  public onBundleChange(callback: (bundle: AnnaMemoryBundle) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notify(): void {
    if (!this.bundle) return;
    for (const listener of this.listeners) {
      try {
        listener(this.bundle);
      } catch {
        // ignore
      }
    }
  }

  public async addMemory(item: Omit<AnnaMemoryItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<AnnaMemoryItem> {
    const bundle = await this.loadBundle();
    const now = new Date().toISOString();
    const id = item.id || `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const fullItem: AnnaMemoryItem = {
      ...item,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const existingIdx = bundle.memories.findIndex((m) => m.id === id);
    if (existingIdx >= 0) {
      bundle.memories[existingIdx] = fullItem;
    } else {
      bundle.memories = [fullItem, ...bundle.memories];
    }

    bundle.storageInfo.lastSavedAt = now;

    if (this.isElectron() && window.electronAPI?.annaMemory) {
      await window.electronAPI.annaMemory.addMemory(fullItem);
    } else {
      this.persistWebBundle(bundle);
    }

    this.notify();
    return fullItem;
  }

  public async updateMemoryStatus(id: string, status: AnnaMemoryItem['status']): Promise<void> {
    const bundle = await this.loadBundle();
    const target = bundle.memories.find((m) => m.id === id);
    if (!target) return;

    target.status = status;
    target.updatedAt = new Date().toISOString();
    target.lastVerifiedAt = new Date().toISOString();

    if (this.isElectron() && window.electronAPI?.annaMemory) {
      await window.electronAPI.annaMemory.updateMemory(target);
    } else {
      this.persistWebBundle(bundle);
    }
    this.notify();
  }

  public async deleteMemory(id: string): Promise<void> {
    const bundle = await this.loadBundle();
    bundle.memories = bundle.memories.filter((m) => m.id !== id);
    bundle.storageInfo.lastSavedAt = new Date().toISOString();

    if (this.isElectron() && window.electronAPI?.annaMemory) {
      await window.electronAPI.annaMemory.deleteMemory(id);
    } else {
      this.persistWebBundle(bundle);
    }
    this.notify();
  }

  public async clearAll(): Promise<void> {
    if (this.isElectron() && window.electronAPI?.annaMemory) {
      await window.electronAPI.annaMemory.clearAll();
    }
    this.bundle = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem(WEB_STORAGE_KEY);
    }
    await this.loadBundle();
    this.notify();
  }

  public async exportBackupJson(): Promise<string> {
    if (this.isElectron() && window.electronAPI?.annaMemory) {
      return await window.electronAPI.annaMemory.exportBackup();
    }
    const bundle = await this.loadBundle();
    return JSON.stringify(bundle, null, 2);
  }

  public async exportBackup(): Promise<string> {
    return this.exportBackupJson();
  }

  public async importBackupJson(jsonString: string): Promise<boolean> {
    try {
      const parsed = JSON.parse(jsonString) as AnnaMemoryBundle;
      if (!parsed.profile || !Array.isArray(parsed.memories)) {
        throw new Error('Invalid format');
      }

      if (this.isElectron() && window.electronAPI?.annaMemory) {
        await window.electronAPI.annaMemory.importBackup(jsonString);
      } else {
        this.bundle = parsed;
        this.persistWebBundle(parsed);
      }
      this.bundle = parsed;
      this.notify();
      return true;
    } catch {
      return false;
    }
  }

  public async importBackup(jsonString: string): Promise<boolean> {
    return this.importBackupJson(jsonString);
  }

  public subscribe(callback: (bundle: AnnaMemoryBundle) => void): () => void {
    return this.onBundleChange(callback);
  }

  public async addItem(item: {
    category: AnnaMemoryCategory;
    status: AnnaMemoryStatus;
    title?: string;
    content: string;
    confidence?: number;
    source?: string;
  }): Promise<AnnaMemoryItem> {
    return this.addMemory({
      category: item.category,
      status: item.status,
      title: item.title,
      content: item.content,
      confidence: item.confidence ?? 1.0,
      sourceContext: item.source || 'manual',
    });
  }

  public async updateItem(id: string, updates: Partial<AnnaMemoryItem>): Promise<void> {
    const bundle = await this.loadBundle();
    const target = bundle.memories.find((m) => m.id === id);
    if (!target) return;

    Object.assign(target, updates);
    target.updatedAt = new Date().toISOString();
    if (updates.status) {
      target.lastVerifiedAt = new Date().toISOString();
    }

    if (this.isElectron() && window.electronAPI?.annaMemory) {
      await window.electronAPI.annaMemory.updateMemory(target);
    } else {
      this.persistWebBundle(bundle);
    }
    this.notify();
  }

  public async deleteItem(id: string): Promise<void> {
    return this.deleteMemory(id);
  }

  /**
   * Intelligently builds prompt context for Pixel from Anna's memory.
   * Only includes verified facts, preferences, and relevant hypotheses marked with caution.
   */
  public async buildMemoryPromptContext(): Promise<string> {
    const bundle = await this.loadBundle();
    const confirmedFacts = bundle.memories.filter(
      (m) => m.category === 'confirmed_fact' && m.status === 'confirmed'
    );
    const preferences = bundle.memories.filter(
      (m) => m.category === 'preference' || m.status === 'confirmed'
    );
    const workContext = bundle.memories.filter(
      (m) => m.category === 'work_context'
    );
    const hypotheses = bundle.memories.filter(
      (m) => m.category === 'observation' || m.status === 'hypothesis' || m.status === 'needs_verification'
    );

    const parts: string[] = [];

    parts.push(`ПЕРСОНАЛЬНЫЙ ПРОФИЛЬ АННЫ:
- Имя: ${bundle.profile.name}
- Роль: ${bundle.profile.role}
- Профиль: ${bundle.profile.backgroundSummary}
- Психологический контекст: ${bundle.profile.psychologicalBackground}
- Стиль общения: ${bundle.profile.communicationStyle}`);

    if (preferences.length > 0) {
      parts.push(`ПРЕДПОЧТЕНИЯ АННЫ (учитывайте естественно, без пересказа):
${preferences.map((p) => `• ${p.content}`).join('\n')}`);
    }

    if (workContext.length > 0) {
      parts.push(`РАБОЧИЙ КОНТЕКСТ И ПРОЕКТЫ:
${workContext.map((w) => `• ${w.content}`).join('\n')}`);
    }

    if (confirmedFacts.length > 0) {
      parts.push(`ПОДТВЕРЖДЁННЫЕ ФАКТЫ:
${confirmedFacts.map((f) => `• ${f.content}`).join('\n')}`);
    }

    if (hypotheses.length > 0) {
      parts.push(`ГИПОТЕЗЫ И НАБЛЮДЕНИЯ (не утверждайте как 100% факт, можно деликатно уточнить при уместном случае):
${hypotheses.map((h) => `• ${h.content}`).join('\n')}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Analyzes an ongoing conversation between Anna and Pixel to gradually discover
   * new facts, preferences, and work context WITHOUT intrusive interview questions.
   */
  public async extractMemoriesFromConversation(
    userText: string,
    assistantText: string
  ): Promise<AnnaMemoryItem | null> {
    if (!this.autoSaveEnabled) return null;
    const text = userText.trim();
    if (text.length < 10) return null;

    // Strict security check: NEVER save passwords, API keys, tokens, or credit cards
    const sensitiveRegex = /password|парол|api[_-]?key|secret|токен|cvv|cvc|номер\s*карты/i;
    if (sensitiveRegex.test(text) || sensitiveRegex.test(assistantText)) {
      return null;
    }

    const lower = text.toLowerCase();

    // 1. Color / Visual preference detection
    const colorMatch = lower.match(/(?:мне\s+нрав[яи]тся|люблю|предпочитаю|мой\s+любимый\s+цвет)\s+([^.!?,\n]{4,50})/i);
    if (colorMatch && (lower.includes('цвет') || lower.includes('оттен') || lower.includes('стиль') || lower.includes('розов') || lower.includes('голуб') || lower.includes('пастель'))) {
      const detected = colorMatch[1].trim();
      const content = `Анне нравится: ${detected}`;
      return await this.addMemory({
        category: 'preference',
        content,
        status: 'confirmed',
        confidence: 0.95,
        sourceContext: `Диалог: «${text.slice(0, 80)}...»`,
      });
    }

    // 2. Work habit or rest habit
    const restMatch = lower.match(/(?:когда\s+я\s+уста[юе]т?|после\s+работы|для\s+отдыха|люблю\s+отдыхать)\s+([^.!?\n]{5,60})/i);
    if (restMatch) {
      const content = `Способ отдыха и восстановления: ${restMatch[1].trim()}`;
      return await this.addMemory({
        category: 'preference',
        content,
        status: 'confirmed',
        confidence: 0.9,
        sourceContext: `Диалог: «${text.slice(0, 80)}...»`,
      });
    }

    // 3. Project / Work context detection
    const projectMatch = lower.match(/(?:мы\s+запускаем|наш\s+проект|планируем\s+открыть|работаем\s+над)\s+([^.!?\n]{5,80})/i);
    if (projectMatch) {
      const content = `Проектный контекст: ${projectMatch[1].trim()}`;
      return await this.addMemory({
        category: 'work_context',
        content,
        status: 'confirmed',
        confidence: 0.92,
        sourceContext: `Диалог: «${text.slice(0, 80)}...»`,
      });
    }

    // 4. Subtle observation / hypothesis
    if (lower.includes('устала') || lower.includes('тяжёлый день') || lower.includes('много работы')) {
      return await this.addMemory({
        category: 'temporary_note',
        content: `Период повышенной рабочей нагрузки и усталости (зафиксировано ${new Date().toLocaleDateString('ru-RU')})`,
        status: 'confirmed',
        confidence: 0.85,
        sourceContext: `Реплика Анны об усталости`,
      });
    }

    return null;
  }
}

export const annaMemoryManager = new AnnaMemoryManager();
