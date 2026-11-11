import {
  AIProviderHealthStatus,
  AIProviderId,
  AIProviderSelectionMode,
  PixelRelevantContextBundle,
  SchoolId,
} from '../types/assistant';
import {
  PreparedApiDocumentItem,
  PreparedKnowledgeContextItem,
} from './documentProvider';
import {
  GeminiChatMessageInput,
  GeminiChatMetrics,
  GeminiEndpointMode,
  GenerationStage,
  PreparedApiImageItem,
} from './geminiProvider';

/**
 * Priority array of free multimodal models for OpenRouter file analysis (text + images).
 * OpenRouter automatically tries the primary model and cascades down the fallback list
 * if rate limits (429) or temporary server errors (503) occur.
 */
export const OPENROUTER_MULTIMODAL_PRIORITY_MODELS = [
  'nvidia/nemotron-3.5-super-vl:free', // Основная
  'qwen/qwen2.5-vl-72b-instruct:free', // Резервная 1
  'google/gemma-4-26b-a4b-it:free',    // Резервная 2
  'stealth/ox-alpha',                  // Резервная 3
] as const;

export type OpenRouterMultimodalModelId =
  (typeof OPENROUTER_MULTIMODAL_PRIORITY_MODELS)[number];

/**
 * Strict Waterfall Fallback chain for Google Gemini models.
 * If primary model gemini-3.8-flash encounters 503, 429, timeout, or server overload,
 * system automatically cascades sequentially down:
 * 1. gemini-3.8-flash (основная)
 * 2. gemini-3.1-flash-lite
 * 3. gemini-flash-latest
 * And only if all of them are unavailable, switches to OpenRouter (nvidia/nemotron-3.5-super-vl:free).
 */
export const GEMINI_WATERFALL_FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
] as const;

export type GeminiWaterfallModelId =
  (typeof GEMINI_WATERFALL_FALLBACK_MODELS)[number];

export function getNextGeminiWaterfallModel(
  currentModel?: string
): GeminiWaterfallModelId | null {
  if (!currentModel) return GEMINI_WATERFALL_FALLBACK_MODELS[1];
  const idx = GEMINI_WATERFALL_FALLBACK_MODELS.indexOf(
    currentModel as GeminiWaterfallModelId
  );
  if (idx >= 0 && idx < GEMINI_WATERFALL_FALLBACK_MODELS.length - 1) {
    return GEMINI_WATERFALL_FALLBACK_MODELS[idx + 1];
  }
  return null;
}

export interface AIProviderStatusDescriptor {
  id: AIProviderId;
  label: string;
  shortLabel: string;
  roleDescription: string;
  status: AIProviderHealthStatus;
  statusLabelRu: string;
  configured: boolean;
  defaultModel: string;
  lastResolvedModel?: string;
  cooldownRemainingSec?: number;
  lastErrorReason?: string;
  lastCheckedAtIso?: string;
  isLocalDesktopAdapter?: boolean;
  availableFreeModels?: string[];
}

export interface AIProvidersSystemState {
  selectionMode: AIProviderSelectionMode;
  priorityOrder: AIProviderId[];
  providers: Record<AIProviderId, AIProviderStatusDescriptor>;
}

export interface AIProviderRequestOptions {
  schoolId: SchoolId;
  mode: GeminiEndpointMode;
  sessionId: string;
  messages: GeminiChatMessageInput[];
  selectedDocuments?: PreparedApiDocumentItem[];
  selectedImages?: PreparedApiImageItem[];
  knowledgeBaseContext?: PreparedKnowledgeContextItem[];
  pixelContext?: PixelRelevantContextBundle;
  externalApiConsentConfirmed?: boolean;
  consentedProviders?: AIProviderId[];
  providerSelection?: AIProviderSelectionMode;
  signal?: AbortSignal;
  timeoutMs?: number;
  onStageChange?: (stage: GenerationStage) => void;
  onSlowWarning?: (isSlow: boolean) => void;
  onDelta?: (deltaText: string, accumulatedText: string) => void;
}

export interface AIProviderGenerationResult {
  text: string;
  providerId: AIProviderId;
  providerLabel: string;
  model: string;
  requestId?: string;
  aborted?: boolean;
  failoverUsed?: boolean;
  failoverFromProvider?: AIProviderId;
  failoverNotice?: string;
  consentRequiredFallbackProvider?: AIProviderId;
  consentRequiredFallbackLabel?: string;
  metrics?: GeminiChatMetrics;
  usageMetadata?: Record<string, unknown> | null;
}

/**
 * Part 3: Universal AIProvider interface.
 * Designed so the entire provider layer can be moved into the Electron Main Process
 * without rewriting UI components or IndexedDB v3 storage.
 */
export interface AIProvider {
  readonly id: AIProviderId;
  readonly label: string;
  checkAvailability(): Promise<AIProviderStatusDescriptor>;
  generate(options: AIProviderRequestOptions): Promise<AIProviderGenerationResult>;
  streamGenerate(
    options: AIProviderRequestOptions
  ): Promise<AIProviderGenerationResult>;
  cancel(sessionId?: string): void;
  getLastModelName(): string;
  getUsageMetadata(): Record<string, unknown> | null;
}

export const PROVIDER_HEALTH_LABELS_RU: Record<AIProviderHealthStatus, string> = {
  connected: 'Подключён',
  available: 'Доступен',
  temporarily_unavailable: 'Временно недоступен',
  quota_exceeded: 'Превышена бесплатная квота',
  not_configured: 'Не настроен',
  key_check_required: 'Требуется проверка ключа',
};

export const PROVIDER_LABELS_RU: Record<AIProviderId, string> = {
  gemini: 'Google Gemini Free',
  openrouter: 'OpenRouter Free',
  ollama: 'Ollama (локально)',
};

export const PROVIDER_SHORT_LABELS_RU: Record<AIProviderId, string> = {
  gemini: 'Gemini Free',
  openrouter: 'OpenRouter Free',
  ollama: 'Ollama Local',
};

export function formatMessageProviderAttribution(
  providerId?: AIProviderId,
  modelName?: string,
  fallbackModel?: string
): string {
  const cleanModel = (modelName || fallbackModel || '').trim();
  if (providerId === 'openrouter') {
    if (!cleanModel || cleanModel === 'openrouter/free') {
      return 'OpenRouter · Auto Free Fallback';
    }
    if (cleanModel.includes('nemotron-3.5-super-vl')) {
      return 'OpenRouter · Nemotron 3.5 Super VL (Мультимодальная)';
    }
    if (cleanModel.includes('qwen2.5-vl-72b')) {
      return 'OpenRouter · Qwen 2.5 VL 72B (Мультимодальная)';
    }
    if (cleanModel.includes('gemma-4-26b')) {
      return 'OpenRouter · Gemma 4 26B (Мультимодальная)';
    }
    if (cleanModel.includes('ox-alpha')) {
      return 'OpenRouter · OX-Alpha (Мультимодальная)';
    }
    return `OpenRouter · ${cleanModel}`;
  }
  if (providerId === 'ollama') {
    return cleanModel ? `Ollama · ${cleanModel}` : 'Ollama · локальная модель';
  }
  // Default / Gemini
  if (!cleanModel) return 'Gemini 3.8 Flash';
  if (cleanModel === 'gemini-3.8-flash') return 'Gemini 3.8 Flash';
  if (cleanModel === 'gemini-3.1-flash-lite') return 'Gemini 3.1 Flash-Lite';
  if (cleanModel === 'gemini-flash-latest') return 'Gemini Flash Latest';
  if (cleanModel.toLowerCase().startsWith('gemini')) {
    return `Gemini · ${cleanModel}`;
  }
  return cleanModel;
}

const PROVIDER_SELECTION_STORAGE_KEY = 'kiber_renderia_ai_provider_selection_v1';

export function readStoredProviderSelection(): AIProviderSelectionMode {
  if (typeof window === 'undefined') return 'auto';
  try {
    const val = window.localStorage.getItem(PROVIDER_SELECTION_STORAGE_KEY);
    if (
      val === 'auto' ||
      val === 'gemini' ||
      val === 'openrouter' ||
      val === 'ollama'
    ) {
      return val;
    }
  } catch {
    // ignore storage errors
  }
  return 'auto';
}

export function writeStoredProviderSelection(mode: AIProviderSelectionMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROVIDER_SELECTION_STORAGE_KEY, mode);
  } catch {
    // ignore storage errors
  }
}

// Electron IPC bridge declaration is unified in src/types/electronBridge.ts

class ServerBackedProviderAdapter implements AIProvider {
  public readonly id: AIProviderId;
  public readonly label: string;
  private lastModelName: string;
  private lastUsageMetadata: Record<string, unknown> | null = null;
  private activeControllers = new Map<string, AbortController>();

  constructor(id: AIProviderId, label: string, defaultModel: string) {
    this.id = id;
    this.label = label;
    this.lastModelName = defaultModel;
  }

  async checkAvailability(): Promise<AIProviderStatusDescriptor> {
    const res = await fetch('/api/ai/providers/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ providerId: this.id }),
    });
    if (!res.ok) {
      throw new Error(`Не удалось проверить статус провайдера ${this.label}.`);
    }
    const data = (await res.json()) as AIProvidersSystemState;
    return data.providers[this.id];
  }

  async generate(
    options: AIProviderRequestOptions
  ): Promise<AIProviderGenerationResult> {
    const { geminiProvider } = await import('./geminiProvider');
    const res = await geminiProvider.streamChat({
      ...options,
      providerSelection: this.id,
      onDelta: options.onDelta || (() => {}),
    });
    this.lastModelName = res.model;
    this.lastUsageMetadata = res.metrics ? { ...res.metrics } : null;
    return {
      text: res.text,
      providerId: res.providerId || this.id,
      providerLabel: res.providerLabel || this.label,
      model: res.model,
      requestId: res.requestId,
      aborted: res.aborted,
      failoverUsed: res.failoverUsed,
      failoverFromProvider: res.failoverFromProvider,
      failoverNotice: res.failoverNotice,
      metrics: res.metrics,
      usageMetadata: this.lastUsageMetadata,
    };
  }

  async streamGenerate(
    options: AIProviderRequestOptions
  ): Promise<AIProviderGenerationResult> {
    return this.generate(options);
  }

  cancel(sessionId?: string): void {
    if (sessionId) {
      const ctrl = this.activeControllers.get(sessionId);
      if (ctrl) {
        ctrl.abort();
        this.activeControllers.delete(sessionId);
      }
      return;
    }
    for (const ctrl of this.activeControllers.values()) {
      ctrl.abort();
    }
    this.activeControllers.clear();
  }

  getLastModelName(): string {
    return this.lastModelName;
  }

  getUsageMetadata(): Record<string, unknown> | null {
    return this.lastUsageMetadata;
  }
}

export const geminiFreeProvider: AIProvider = new ServerBackedProviderAdapter(
  'gemini',
  PROVIDER_LABELS_RU.gemini,
  'gemini-3.8-flash'
);

export const openRouterFreeProvider: AIProvider = new ServerBackedProviderAdapter(
  'openrouter',
  PROVIDER_LABELS_RU.openrouter,
  'openrouter/free'
);

export const ollamaLocalProvider: AIProvider = new ServerBackedProviderAdapter(
  'ollama',
  PROVIDER_LABELS_RU.ollama,
  'llama3.2:latest'
);

export const aiProviderManager = {
  providers: {
    gemini: geminiFreeProvider,
    openrouter: openRouterFreeProvider,
    ollama: ollamaLocalProvider,
  } as Record<AIProviderId, AIProvider>,

  async getProvidersState(): Promise<AIProvidersSystemState> {
    const res = await fetch('/api/ai/providers/status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error('Не удалось получить статус ИИ-провайдеров.');
    }
    return (await res.json()) as AIProvidersSystemState;
  },

  async checkAllProvidersOnDemand(): Promise<AIProvidersSystemState> {
    const res = await fetch('/api/ai/providers/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      throw new Error('Не удалось выполнить проверку подключения ИИ-провайдеров.');
    }
    return (await res.json()) as AIProvidersSystemState;
  },
};
