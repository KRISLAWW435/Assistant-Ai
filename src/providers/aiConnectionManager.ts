import {
  AIConnectionProfile,
  AIConnectionStatus,
  AIProviderId,
  FailoverSequenceSettings,
  OllamaLocalInfo,
  SpecialistModelAssignments,
  SpecialistRoleKey,
} from '../types/assistant';
import {
  ConnectionTestResult,
  SaveProfileInput,
} from '../types/electronBridge';

export function maskApiKey(key: string): string {
  const trimmed = (key || '').trim();
  if (!trimmed) return 'Не настроен';
  if (trimmed.length <= 8) return '••••••••';
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••${suffix}`;
}

export function getDefaultSpecialistAssignments(): SpecialistModelAssignments {
  return {
    marketer: {
      providerSelection: 'auto',
      specificModel: 'gemini-3.8-flash',
    },
    manager: {
      providerSelection: 'auto',
      specificModel: 'gemini-3.8-flash',
    },
    methodist: {
      providerSelection: 'auto',
      specificModel: 'gemini-3.8-flash',
    },
    analyst: {
      providerSelection: 'auto',
      specificModel: 'gemini-3.8-flash',
    },
    pixel: {
      providerSelection: 'auto',
      specificModel: 'gemini-3.8-flash',
    },
  };
}

export function getDefaultFailoverSettings(): FailoverSequenceSettings {
  return {
    order: ['gemini', 'openrouter', 'ollama'],
    allowCloudFailoverForDocs: false,
    requireExplicitDocConsent: true,
  };
}

export interface RecommendedOllamaModel {
  name: string;
  tagline: string;
  sizeGb: string;
  ramRequirement: string;
  recommendedFor: string;
  isDefaultRecommended?: boolean;
}

export const RECOMMENDED_OLLAMA_MODELS: RecommendedOllamaModel[] = [
  {
    name: 'llama3.2:3b',
    tagline: 'Meta Llama 3.2 3B',
    sizeGb: '2.0 ГБ',
    ramRequirement: 'от 8 ГБ RAM',
    recommendedFor: 'Оптимально для большинства ПК: быстрая работа с текстом, заметки Анны, черновики постов.',
    isDefaultRecommended: true,
  },
  {
    name: 'qwen2.5:3b',
    tagline: 'Qwen 2.5 3B Instruct',
    sizeGb: '1.9 ГБ',
    ramRequirement: 'от 8 ГБ RAM',
    recommendedFor: 'Прекрасно справляется с русским языком, вежливыми скриптами для родителей и структурированием.',
  },
  {
    name: 'mistral:7b',
    tagline: 'Mistral 7B Instruct v0.3',
    sizeGb: '4.1 ГБ',
    ramRequirement: 'от 16 ГБ RAM',
    recommendedFor: 'Глубокий методический анализ программ и разбор сложных отчётов при наличии достаточного объёма памяти.',
  },
];

export const GEMINI_AVAILABLE_MODELS = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Рекомендована)', description: 'Быстрая, актуальная модель по умолчанию' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Стабильная рабочая модель Google' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Для сложных аналитических разборов' },
  { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash-Lite (Резервная)', description: 'Экономичная резервная модель при исчерпании квоты' },
];

class AIConnectionManager {
  private isElectronEnvironment(): boolean {
    return Boolean(
      typeof window !== 'undefined' &&
        window.electronAPI &&
        window.electronAPI.aiConnections
    );
  }

  isSafeStorageActive(): boolean {
    if (typeof window === 'undefined') return false;
    return Boolean(
      window.electronAPI?.safeStorage?.isAvailable() ||
        window.electronAPI?.aiConnections?.safeStorageAvailable
    );
  }

  isElectron(): boolean {
    return this.isElectronEnvironment();
  }

  async listProfiles(): Promise<AIConnectionProfile[]> {
    if (this.isElectronEnvironment()) {
      return window.electronAPI!.aiConnections!.listProfiles();
    }
    const res = await fetch('/api/ai/connections', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error('Не удалось получить список подключений ИИ с сервера.');
    }
    return (await res.json()) as AIConnectionProfile[];
  }

  async saveProfile(input: SaveProfileInput): Promise<AIConnectionProfile> {
    if (this.isElectronEnvironment()) {
      return window.electronAPI!.aiConnections!.saveProfile(input);
    }
    const res = await fetch('/api/ai/connections', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        err?.error?.message || 'Не удалось сохранить профиль подключения.'
      );
    }
    return (await res.json()) as AIConnectionProfile;
  }

  async deleteProfile(id: string): Promise<boolean> {
    if (this.isElectronEnvironment()) {
      return window.electronAPI!.aiConnections!.deleteProfile(id);
    }
    const res = await fetch(`/api/ai/connections/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error('Не удалось удалить профиль подключения.');
    }
    return true;
  }

  async testConnection(id: string): Promise<ConnectionTestResult> {
    if (this.isElectronEnvironment()) {
      return window.electronAPI!.aiConnections!.testConnection(id);
    }
    const res = await fetch(
      `/api/ai/connections/${encodeURIComponent(id)}/test`,
      {
        method: 'POST',
        headers: { Accept: 'application/json' },
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        ok: false,
        status: 'error',
        model: 'unknown',
        error:
          err?.error?.message ||
          'Ошибка проверки подключения (код ' + res.status + ')',
        testedAt: new Date().toISOString(),
      };
    }
    return (await res.json()) as ConnectionTestResult;
  }

  async testAllConnections(): Promise<Record<string, ConnectionTestResult>> {
    const profiles = await this.listProfiles();
    const results: Record<string, ConnectionTestResult> = {};
    for (const p of profiles) {
      try {
        results[p.id] = await this.testConnection(p.id);
      } catch (err) {
        results[p.id] = {
          ok: false,
          status: 'error',
          model: p.selectedModel,
          error: err instanceof Error ? err.message : String(err),
          testedAt: new Date().toISOString(),
        };
      }
    }
    return results;
  }

  async getSpecialistModels(): Promise<SpecialistModelAssignments> {
    if (this.isElectronEnvironment()) {
      return window.electronAPI!.aiConnections!.getSpecialistModels();
    }
    const res = await fetch('/api/ai/specialist-models', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return getDefaultSpecialistAssignments();
    }
    return (await res.json()) as SpecialistModelAssignments;
  }

  async saveSpecialistModels(
    assignments: SpecialistModelAssignments
  ): Promise<SpecialistModelAssignments> {
    if (this.isElectronEnvironment()) {
      return window.electronAPI!.aiConnections!.saveSpecialistModels(assignments);
    }
    const res = await fetch('/api/ai/specialist-models', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(assignments),
    });
    if (!res.ok) {
      throw new Error('Не удалось сохранить настройки моделей специалистов.');
    }
    return (await res.json()) as SpecialistModelAssignments;
  }

  async getFailoverSettings(): Promise<FailoverSequenceSettings> {
    if (this.isElectronEnvironment()) {
      return window.electronAPI!.aiConnections!.getFailoverSettings();
    }
    const res = await fetch('/api/ai/failover-settings', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return getDefaultFailoverSettings();
    }
    return (await res.json()) as FailoverSequenceSettings;
  }

  async saveFailoverSettings(
    settings: FailoverSequenceSettings
  ): Promise<FailoverSequenceSettings> {
    if (this.isElectronEnvironment()) {
      return window.electronAPI!.aiConnections!.saveFailoverSettings(settings);
    }
    const res = await fetch('/api/ai/failover-settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(settings),
    });
    if (!res.ok) {
      throw new Error('Не удалось сохранить настройки очереди переключения.');
    }
    return (await res.json()) as FailoverSequenceSettings;
  }

  async getOllamaStatus(): Promise<OllamaLocalInfo> {
    if (this.isElectronEnvironment()) {
      return window.electronAPI!.aiConnections!.getOllamaStatus();
    }
    const res = await fetch('/api/ai/ollama/status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return {
        installed: false,
        running: false,
        apiUrl: 'http://127.0.0.1:11434',
        models: [],
        error: 'Не удалось опросить локальный сервис Ollama.',
      };
    }
    return (await res.json()) as OllamaLocalInfo;
  }

  openOllamaOfficialWebsite(): void {
    const url = 'https://ollama.com/download/windows';
    if (
      typeof window !== 'undefined' &&
      window.electronAPI?.shell?.openExternal
    ) {
      window.electronAPI.shell.openExternal(url);
    } else if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }
}

export const aiConnectionManager = new AIConnectionManager();
