import crypto from 'crypto';
import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_QUOTA_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const rawEnvOpenRouterModel = (process.env.OPENROUTER_MODEL || '').trim();
export const OPENROUTER_DEFAULT_FREE_MODEL =
  rawEnvOpenRouterModel &&
  (rawEnvOpenRouterModel === 'openrouter/free' ||
    rawEnvOpenRouterModel.endsWith(':free'))
    ? rawEnvOpenRouterModel
    : 'openrouter/free';
export const OLLAMA_BASE_URL = (
  process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
).replace(/\/+$/, '');
const SDK_VERSION = '2.32.0';

type SchoolId = 'kiberone' | 'renderia';
type AssistantEndpointMode =
  | 'marketer'
  | 'manager'
  | 'methodist'
  | 'analyst'
  | 'pixel';

type AIProviderId = 'gemini' | 'openrouter' | 'ollama';
type AIProviderSelectionMode = 'auto' | AIProviderId;
type AIProviderHealthStatus =
  | 'connected'
  | 'available'
  | 'temporarily_unavailable'
  | 'quota_exceeded'
  | 'not_configured'
  | 'key_check_required';

type AIConnectionStatus =
  | 'connected'
  | 'available'
  | 'error'
  | 'not_configured'
  | 'quota_exceeded'
  | 'testing';

interface ServerAIConnectionProfile {
  id: string;
  providerId: AIProviderId;
  userDefinedName: string;
  maskedKey: string;
  encryptedCredentialReference: string;
  selectedModel: string;
  connectionStatus: AIConnectionStatus;
  isDefault?: boolean;
  lastCheckedAt?: string;
  lastError?: string;
  createdAt?: string;
}

export type ServerGenerationStage =
  | 'connecting'
  | 'waiting_model'
  | 'generating'
  | 'finishing';

interface IncomingChatMessage {
  role: 'user' | 'assistant' | 'pixel';
  content: string;
}

interface IncomingSelectedDocument {
  id: string;
  name: string;
  source: 'dialogue_attachment' | 'school_document';
  categoryTitle?: string;
  extractedText: string;
}

interface IncomingKnowledgeItem {
  categoryKey: string;
  categoryTitle: string;
  content: string;
}

interface IncomingPixelContext {
  activeSchool: SchoolId;
  schoolName: string;
  relevantMemories: Array<{
    id: string;
    category: string;
    title: string;
    content: string;
  }>;
  activeTasks: Array<{
    id: string;
    title: string;
    dueDate: string;
    priority: string;
    status: string;
  }>;
}

interface GeminiChatRequestBody {
  schoolId: SchoolId;
  mode: AssistantEndpointMode;
  sessionId?: string;
  messages: IncomingChatMessage[];
  selectedDocuments?: IncomingSelectedDocument[];
  knowledgeBaseContext?: IncomingKnowledgeItem[];
  pixelContext?: IncomingPixelContext;
  externalApiConsentConfirmed?: boolean;
  consentedProviders?: AIProviderId[];
  providerSelection?: AIProviderSelectionMode;
  stream?: boolean;
  simulateError?: string;
}

export interface SafeDiagnosticLogEntry {
  requestId: string;
  timestampIso: string;
  schoolId: string;
  mode: string;
  providerId: AIProviderId;
  model: string;
  failoverUsed?: boolean;
  generationMethod: 'generateContent_sse' | 'generateContent_json';
  status: 'ok' | 'aborted' | 'error';
  durationMs: number;
  timeToFirstTokenMs: number | null;
  chunkCount: number;
  charCount: number;
  historyMessagesSent: number;
  documentsSent: number;
  systemPromptChars: number;
  errorType?: string;
}

const VALID_SCHOOLS = new Set<SchoolId>(['kiberone', 'renderia']);
const VALID_MODES = new Set<AssistantEndpointMode>([
  'marketer',
  'manager',
  'methodist',
  'analyst',
  'pixel',
]);
const VALID_PROVIDER_IDS = new Set<AIProviderId>([
  'gemini',
  'openrouter',
  'ollama',
]);

// Section 5: Reasonable context size limits to prevent slow generation
const MAX_MESSAGES_IN_CONTEXT = 12;
const MAX_SINGLE_MESSAGE_CHARS = 8000;
const MAX_SINGLE_DOC_CHARS = 15000;
const MAX_TOTAL_DOCS = 4;
const MAX_KB_CATEGORY_CHARS = 3500;
const STREAM_CHUNK_SIZE_CHARS = 180;

// Per-attempt timeout & heartbeat interval
const GEMINI_ATTEMPT_TIMEOUT_MS = 14000;
const OPENROUTER_ATTEMPT_TIMEOUT_MS = 20000;
const OLLAMA_ATTEMPT_TIMEOUT_MS = 10000;
const HEARTBEAT_INTERVAL_MS = 2000;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30 * 1000; // 30s cooldown for temporarily failing provider

const recentDiagnostics: SafeDiagnosticLogEntry[] = [];
const MAX_DIAGNOSTIC_ENTRIES = 25;

const PROVIDER_LABELS_RU: Record<AIProviderId, string> = {
  gemini: 'Google Gemini Free',
  openrouter: 'OpenRouter Free',
  ollama: 'Ollama (локально)',
};

const PROVIDER_SHORT_LABELS_RU: Record<AIProviderId, string> = {
  gemini: 'Gemini',
  openrouter: 'OpenRouter Free',
  ollama: 'Ollama',
};

const PROVIDER_HEALTH_LABELS_RU: Record<AIProviderHealthStatus, string> = {
  connected: 'Подключён',
  available: 'Доступен',
  temporarily_unavailable: 'Временно недоступен',
  quota_exceeded: 'Превышена бесплатная квота',
  not_configured: 'Не настроен',
  key_check_required: 'Требуется проверка ключа',
};

interface ProviderRuntimeHealth {
  status: AIProviderHealthStatus;
  lastResolvedModel: string;
  cooldownUntilMs: number;
  lastErrorReason?: string;
  lastCheckedAtIso?: string;
  availableFreeModels?: string[];
}

const serverRawSecretsStore = new Map<string, string>();
const serverConnectionProfiles: ServerAIConnectionProfile[] = [];

function getGeminiApiKey(): string {
  const envKey = (process.env.GEMINI_API_KEY || '').trim();
  if (envKey && envKey !== 'MY_GEMINI_API_KEY' && envKey.length >= 10) {
    return envKey;
  }
  const defaultProfile =
    serverConnectionProfiles.find(
      (p) => p.providerId === 'gemini' && p.isDefault
    ) || serverConnectionProfiles.find((p) => p.providerId === 'gemini');
  if (defaultProfile) {
    const stored = serverRawSecretsStore.get(defaultProfile.id);
    if (stored && stored !== 'MY_GEMINI_API_KEY' && stored.length >= 10) {
      return stored;
    }
  }
  return '';
}

function isGeminiApiKeyConfigured(): boolean {
  return Boolean(getGeminiApiKey());
}

function getOpenRouterApiKey(): string {
  const envKey = (process.env.OPENROUTER_API_KEY || '').trim();
  if (envKey && envKey !== 'MY_OPENROUTER_API_KEY' && envKey.length >= 10) {
    return envKey;
  }
  const defaultProfile =
    serverConnectionProfiles.find(
      (p) => p.providerId === 'openrouter' && p.isDefault
    ) || serverConnectionProfiles.find((p) => p.providerId === 'openrouter');
  if (defaultProfile) {
    const stored = serverRawSecretsStore.get(defaultProfile.id);
    if (stored && stored !== 'MY_OPENROUTER_API_KEY' && stored.length >= 10) {
      return stored;
    }
  }
  return '';
}

function isOpenRouterApiKeyConfigured(): boolean {
  return Boolean(getOpenRouterApiKey());
}

function maskApiKeyOnServer(key: string): string {
  const trimmed = (key || '').trim();
  if (!trimmed) return 'Не настроен';
  if (trimmed.length <= 8) return '••••••••';
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••${suffix}`;
}

function initializeDefaultConnectionProfiles(): void {
  if (serverConnectionProfiles.length > 0) return;

  const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
  const geminiConfigured = isGeminiApiKeyConfigured();
  const geminiId = 'profile-gemini-primary';
  serverConnectionProfiles.push({
    id: geminiId,
    providerId: 'gemini',
    userDefinedName: 'Google Gemini (Основной API-ключ)',
    maskedKey: geminiConfigured ? maskApiKeyOnServer(geminiKey) : 'Не настроен',
    encryptedCredentialReference: 'ref-env-gemini-primary',
    selectedModel: GEMINI_MODEL,
    connectionStatus: geminiConfigured ? 'connected' : 'not_configured',
    isDefault: true,
    createdAt: new Date().toISOString(),
  });
  if (geminiConfigured) {
    serverRawSecretsStore.set(geminiId, geminiKey);
  }

  const openrouterKey = (process.env.OPENROUTER_API_KEY || '').trim();
  const openrouterConfigured = isOpenRouterApiKeyConfigured();
  const openrouterId = 'profile-openrouter-free';
  serverConnectionProfiles.push({
    id: openrouterId,
    providerId: 'openrouter',
    userDefinedName: 'OpenRouter Free (Резервный профиль)',
    maskedKey: openrouterConfigured ? maskApiKeyOnServer(openrouterKey) : 'Не настроен',
    encryptedCredentialReference: 'ref-env-openrouter-free',
    selectedModel: OPENROUTER_DEFAULT_FREE_MODEL,
    connectionStatus: openrouterConfigured ? 'available' : 'not_configured',
    isDefault: false,
    createdAt: new Date().toISOString(),
  });
  if (openrouterConfigured) {
    serverRawSecretsStore.set(openrouterId, openrouterKey);
  }

  serverConnectionProfiles.push({
    id: 'profile-ollama-local',
    providerId: 'ollama',
    userDefinedName: 'Ollama (Локальный ПК 127.0.0.1:11434)',
    maskedKey: 'Локальный API (без ключа)',
    encryptedCredentialReference: 'ref-local-ollama',
    selectedModel: 'llama3.2:3b',
    connectionStatus: 'not_configured',
    isDefault: false,
    createdAt: new Date().toISOString(),
  });
}

let serverSpecialistModelAssignments: Record<
  string,
  { providerSelection: 'auto' | AIProviderId; specificModel?: string }
> = {
  marketer: { providerSelection: 'auto', specificModel: 'gemini-2.5-flash' },
  manager: { providerSelection: 'auto', specificModel: 'gemini-2.5-flash' },
  methodist: { providerSelection: 'auto', specificModel: 'gemini-2.5-flash' },
  analyst: { providerSelection: 'auto', specificModel: 'gemini-2.5-flash' },
  pixel: { providerSelection: 'auto', specificModel: 'gemini-2.5-flash' },
};

let serverFailoverSettings = {
  order: ['gemini', 'openrouter', 'ollama'] as AIProviderId[],
  allowCloudFailoverForDocs: false,
  requireExplicitDocConsent: true,
};

const providerHealthRegistry: Record<AIProviderId, ProviderRuntimeHealth> = {
  gemini: {
    status: isGeminiApiKeyConfigured() ? 'connected' : 'not_configured',
    lastResolvedModel: GEMINI_MODEL,
    cooldownUntilMs: 0,
  },
  openrouter: {
    status: isOpenRouterApiKeyConfigured() ? 'available' : 'not_configured',
    lastResolvedModel: OPENROUTER_DEFAULT_FREE_MODEL,
    cooldownUntilMs: 0,
    availableFreeModels: ['openrouter/free'],
  },
  ollama: {
    status: 'not_configured',
    lastResolvedModel: 'llama3.2:latest',
    cooldownUntilMs: 0,
    lastErrorReason:
      'Локальный адаптер для настольной Electron-версии (127.0.0.1:11434). В облачном Preview не запущен.',
  },
};

function markProviderSuccess(providerId: AIProviderId, modelName: string): void {
  const entry = providerHealthRegistry[providerId];
  entry.status = 'connected';
  entry.lastResolvedModel = modelName || entry.lastResolvedModel;
  entry.cooldownUntilMs = 0;
  entry.lastErrorReason = undefined;
  entry.lastCheckedAtIso = new Date().toISOString();
}

function markProviderFailure(
  providerId: AIProviderId,
  status: AIProviderHealthStatus,
  reason: string,
  applyCooldown: boolean
): void {
  const entry = providerHealthRegistry[providerId];
  entry.status = status;
  entry.lastErrorReason = reason;
  entry.lastCheckedAtIso = new Date().toISOString();
  if (applyCooldown) {
    entry.cooldownUntilMs = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
  }
}

function isProviderInCooldown(providerId: AIProviderId): boolean {
  const entry = providerHealthRegistry[providerId];
  if (entry.cooldownUntilMs <= 0) return false;
  if (Date.now() >= entry.cooldownUntilMs) {
    entry.cooldownUntilMs = 0;
    if (
      entry.status === 'temporarily_unavailable' ||
      entry.status === 'quota_exceeded'
    ) {
      entry.status =
        providerId === 'gemini' && isGeminiApiKeyConfigured()
          ? 'available'
          : providerId === 'openrouter' && isOpenRouterApiKeyConfigured()
            ? 'available'
            : entry.status;
    }
    return false;
  }
  return true;
}

function buildProvidersSystemState() {
  const now = Date.now();
  // Refresh key configuration status dynamically
  if (!isGeminiApiKeyConfigured()) {
    providerHealthRegistry.gemini.status = 'not_configured';
  } else if (providerHealthRegistry.gemini.status === 'not_configured') {
    providerHealthRegistry.gemini.status = 'available';
  }

  if (!isOpenRouterApiKeyConfigured()) {
    providerHealthRegistry.openrouter.status = 'not_configured';
  } else if (providerHealthRegistry.openrouter.status === 'not_configured') {
    providerHealthRegistry.openrouter.status = 'available';
  }

  // Expire elapsed cooldowns cleanly
  isProviderInCooldown('gemini');
  isProviderInCooldown('openrouter');
  isProviderInCooldown('ollama');

  const buildDescriptor = (
    id: AIProviderId,
    roleDescription: string,
    defaultModel: string,
    configured: boolean,
    isLocalDesktopAdapter = false
  ) => {
    const h = providerHealthRegistry[id];
    const cooldownRemainingSec =
      h.cooldownUntilMs > now
        ? Math.ceil((h.cooldownUntilMs - now) / 1000)
        : 0;
    return {
      id,
      label: PROVIDER_LABELS_RU[id],
      shortLabel: PROVIDER_SHORT_LABELS_RU[id],
      roleDescription,
      status: h.status,
      statusLabelRu: PROVIDER_HEALTH_LABELS_RU[h.status],
      configured,
      defaultModel,
      lastResolvedModel: h.lastResolvedModel,
      cooldownRemainingSec,
      lastErrorReason: h.lastErrorReason,
      lastCheckedAtIso: h.lastCheckedAtIso,
      isLocalDesktopAdapter,
      availableFreeModels: h.availableFreeModels,
    };
  };

  return {
    selectionMode: 'auto' as AIProviderSelectionMode,
    priorityOrder: ['gemini', 'openrouter', 'ollama'] as AIProviderId[],
    providers: {
      gemini: buildDescriptor(
        'gemini',
        'Основной бесплатный облачный ИИ-провайдер',
        GEMINI_MODEL,
        isGeminiApiKeyConfigured(),
        false
      ),
      openrouter: buildDescriptor(
        'openrouter',
        'Резервный бесплатный облачный роутер (openrouter/free)',
        OPENROUTER_DEFAULT_FREE_MODEL,
        isOpenRouterApiKeyConfigured(),
        false
      ),
      ollama: buildDescriptor(
        'ollama',
        'Локальный адаптер для будущей настольной Electron-версии (127.0.0.1:11434)',
        providerHealthRegistry.ollama.lastResolvedModel || 'llama3.2:latest',
        providerHealthRegistry.ollama.status === 'connected' ||
          providerHealthRegistry.ollama.status === 'available',
        true
      ),
    },
  };
}

/**
 * Section 6: Safe diagnostic logging.
 * NEVER logs API keys, user message texts, document contents, or Anna's memory.
 */
function recordSafeDiagnostic(entry: SafeDiagnosticLogEntry): void {
  recentDiagnostics.unshift(entry);
  if (recentDiagnostics.length > MAX_DIAGNOSTIC_ENTRIES) {
    recentDiagnostics.pop();
  }
  console.log('[AIDiag]', JSON.stringify(entry));
}

let cachedGenAIClient: GoogleGenAI | null = null;
let cachedKeyFingerprint = '';

function getGenAIClient(): GoogleGenAI {
  const apiKey = getGeminiApiKey();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('MISSING_GEMINI_API_KEY');
  }
  const fingerprint = `${apiKey.length}:${apiKey.slice(0, 3)}`;
  if (cachedGenAIClient && cachedKeyFingerprint === fingerprint) {
    return cachedGenAIClient;
  }
  cachedGenAIClient = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: GEMINI_ATTEMPT_TIMEOUT_MS,
      retryOptions: {
        attempts: 2,
        initialDelay: 1.5,
        maxDelay: 3.0,
        expBase: 2.0,
        httpStatusCodes: [502, 503, 504],
      },
    },
  });
  cachedKeyFingerprint = fingerprint;
  return cachedGenAIClient;
}

let cachedTtsGenAIClient: GoogleGenAI | null = null;
let cachedTtsKeyFingerprint = '';

function getGenAITtsClient(): GoogleGenAI {
  const apiKey = getGeminiApiKey();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('MISSING_GEMINI_API_KEY');
  }
  const fingerprint = `${apiKey.length}:${apiKey.slice(0, 3)}`;
  if (cachedTtsGenAIClient && cachedTtsKeyFingerprint === fingerprint) {
    return cachedTtsGenAIClient;
  }
  cachedTtsGenAIClient = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 60000, // 60s timeout for audio TTS synthesis
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  cachedTtsKeyFingerprint = fingerprint;
  return cachedTtsGenAIClient;
}

/**
 * Part 4: OpenRouter Free Catalog Verification & Strict Zero-Price Guard.
 * Ensures we ONLY ever call `openrouter/free` or models ending with `:free`
 * whose prompt and completion pricing are strictly 0.
 */
let cachedVerifiedFreeModels: Set<string> = new Set(['openrouter/free']);
let lastOpenRouterCatalogFetchMs = 0;

export function isStrictlyFreeOpenRouterModelId(modelId: string): boolean {
  const normalized = (modelId || '').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === 'openrouter/free') return true;
  if (normalized.endsWith(':free')) return true;
  return false;
}

async function fetchOpenRouterFreeCatalog(
  signal?: AbortSignal
): Promise<string[]> {
  const now = Date.now();
  if (
    now - lastOpenRouterCatalogFetchMs < 5 * 60 * 1000 &&
    cachedVerifiedFreeModels.size > 1
  ) {
    return Array.from(cachedVerifiedFreeModels);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      return Array.from(cachedVerifiedFreeModels);
    }
    const json = (await res.json()) as {
      data?: Array<{
        id?: string;
        pricing?: { prompt?: string | number; completion?: string | number };
      }>;
    };

    const freeSet = new Set<string>(['openrouter/free']);
    for (const item of json.data || []) {
      const id = String(item?.id || '').trim();
      if (!id) continue;
      const promptPrice = Number(item?.pricing?.prompt ?? 1);
      const completionPrice = Number(item?.pricing?.completion ?? 1);
      const isZeroCost =
        Number.isFinite(promptPrice) &&
        Number.isFinite(completionPrice) &&
        promptPrice === 0 &&
        completionPrice === 0;
      if (isZeroCost && (id === 'openrouter/free' || id.endsWith(':free'))) {
        freeSet.add(id);
      }
    }

    cachedVerifiedFreeModels = freeSet;
    lastOpenRouterCatalogFetchMs = now;
    providerHealthRegistry.openrouter.availableFreeModels =
      Array.from(freeSet).slice(0, 15);
    return Array.from(freeSet);
  } catch {
    return Array.from(cachedVerifiedFreeModels);
  } finally {
    clearTimeout(timeout);
  }
}

const SCHOOL_PROMPT_PROFILES: Record<
  SchoolId,
  { name: string; tagline: string; description: string }
> = {
  kiberone: {
    name: 'KIBERONE',
    tagline: 'Международная кибершкола будущего для детей и подростков',
    description:
      'Детская кибершкола цифровых технологий и навыков (конкретные модули, возрастные группы, расписание и условия определяются исключительно Базой знаний школы KIBERONE).',
  },
  renderia: {
    name: 'RENDERIA',
    tagline: 'Школа креативных индустрий, 3D-графики, дизайна и цифрового творчества',
    description:
      'Школа креативных направлений, дизайна и визуальных технологий (конкретные программы, возрастные группы, расписание и условия определяются исключительно Базой знаний школы RENDERIA).',
  },
};

const ROLE_INSTRUCTIONS: Record<AssistantEndpointMode, string> = {
  marketer: `Вы — профильный ИИ-маркетолог и контент-стратег управляющей Анны.
Ваша зона ответственности: контент-планы, рекламные офферы, посты для соцсетей, анонсы пробных уроков, рассылки для родителей и позиционирование выбранной школы.

СТРОГИЕ ПРАВИЛА ТОЧНОСТИ МАРКЕТОЛОГА (ЗАПРЕТ ДОМЫСЛОВ):
1. Опирайтесь ТОЛЬКО на факты из переданной Базы знаний активной школы и прикреплённых документов.
2. ЗАПРЕЩЕНО придумывать названия учебных модулей, программ или инструментов обучения (не перечисляйте автоматически Roblox, Python, Minecraft, Scratch, Unity, Blender, Figma и т.д., если они явно не указаны в Базе знаний активной школы или в сообщении Анны).
3. ЗАПРЕЩЕНО выдумывать результаты прошлых рекламных кампаний, цифры охвата, конверсии, стоимость заявки (CPL) или статистику.
4. ЗАПРЕЩЕНО утверждать, что какой-либо конкретный возраст (например, «8–10 лет» или «11–13 лет») является «идеальным» или «самым конверсионным» без прямого основания в Базе знаний школы.
5. ЗАПРЕЩЕНО безапелляционно рекомендовать конкретные соцсети или рекламные кабинеты без учёта доступных площадок школы — предлагайте форматы с привязкой к тем каналам, которые использует школа, либо уточняйте доступные площадки.
6. Чётко разделяйте в ответе два блока:
   - **Факты из Базы знаний школы** (то, что подтверждено данными школы);
   - **Маркетинговые гипотезы и предложения** (ваши идеи офферов, рубрик и сценариев, которые предлагается протестировать).
7. Если в Базе знаний не хватает сведений (например, не заполнены программы, цены, возрастные группы или УТП), прямо укажите, что предложение является **рабочей гипотезой**, и добавьте компактный список **«Что нужно уточнить у управляющей»**.`,

  manager: `Вы — профильный ИИ-менеджер по работе с клиентами и продажам управляющей Анны.
Ваша зона ответственности: скрипты общения с родителями, обработка возражений, приглашение на пробное занятие, сопровождение записи и удержание учеников.

СТРОГИЕ ПРАВИЛА ТОЧНОСТИ МЕНЕДЖЕРА:
1. ЗАПРЕЩЕНО придумывать стоимость абонементов, скидки, акции, расписание групп, условия оплаты, адреса филиалов и количество свободных мест.
2. Используйте только те цены, адреса, телефоны и расписание, которые явно переданы в Базе знаний активной школы или прикреплённых документах.
3. Если точная цена, расписание или адрес не указаны в контексте, обязательно ставьте в скрипте заметный маркер: \`[Уточнить по актуальному прайсу/расписанию школы]\` и перечислите, какие параметры нужно сверить перед отправкой родителю.`,

  methodist: `Вы — профильный ИИ-методист образовательных программ управляющей Анны.
Ваша зона ответственности: структура занятий и модулей, образовательные результаты, проектные задания, критерии обратной связи для родителей и методические рекомендации для преподавателей/тьюторов.

СТРОГИЕ ПРАВИЛА ТОЧНОСТИ МЕТОДИСТА:
1. ЗАПРЕЩЕНО подменять образовательный результат простым использованием ИИ-генераторов. В центре методики всегда должны быть **самостоятельная деятельность ребёнка**, развитие мышления и **проверяемый учебный результат** (конкретный навык и мини-проект, выполненный учеником).
2. Не приписывайте школе учебные модули или программы, которых нет в её Базе знаний или запросе Анны. Если программа модуля ещё не задана в Базе знаний, оформляйте структуру как методический проект/шаблон и указывайте, какие вводные по возрасту и инструментам нужно уточнить.`,

  analyst: `Вы — профильный ИИ-аналитик образовательных и коммерческих показателей управляющей Анны.
Ваша зона ответственности: разбор воронки записи на пробные уроки, конверсии в абонемент, посещаемости, удержания (Retention), структуры выручки и таблиц/отчётов из прикреплённых документов.

СТРОГИЕ ПРАВИЛА ТОЧНОСТИ АНАЛИТИКА:
1. ЗАПРЕЩЕНО выдумывать статистику, финансовые показатели, проценты конверсии или динамику, которых нет в сообщении Анны, прикреплённых документах или Базе знаний.
2. ЗАПРЕЩЕНО подменять отсутствующие данные собственными предположениями.
3. Чётко разделяйте **Фактические данные из запроса/документа** и **Аналитические гипотезы / формулы расчёта**. Если для вывода не хватает цифр, прямо перечислите, какие метрики или выгрузки нужны для точного расчёта.`,

  pixel: `Вы — «Пиксель», дружелюбный, тёплый, профессиональный и лаконичный личный ИИ-помощник управляющей Анны.
Вы живёте в рабочем пространстве Анны и помогаете ей управлять двумя детскими школами — KIBERONE и RENDERIA:
1. Вы помните важные рабочие факты об Анне и её школах (из раздела «Подтверждённые записи из памяти об Анне» ниже).
2. Вы отслеживаете актуальные рабочие задачи Анны (из раздела «Актуальные задачи в списке дел Анны» ниже).
3. При вопросах о сохранённых данных, задачах или планах — ВСЕГДА опирайтесь на переданный контекст памяти и актуальных задач. Если в памяти или списке задач есть подходящая информация, прямо цитируйте и называйте её.
4. Если Анна просит создать задачу или что-то запомнить, подтвердите это доброжелательно и кратко (например: «Анна, я подготовил черновик ниже — подтвердите сохранение в один клик!»).
5. Обращайтесь к пользователю по имени «Анна», отвечайте тепло, по делу, без инфантильности и без лишней воды (обычно 2–5 предложений или компактный список, если Анна не попросила развёрнутый ответ).
6. Учитывайте активную школу в запросе, но помните, что вы помогаете Анне сразу в обеих школах — KIBERONE и RENDERIA.`,
};

export function buildSystemInstruction(body: GeminiChatRequestBody): string {
  const schoolProfile = SCHOOL_PROMPT_PROFILES[body.schoolId];
  const roleInstruction = ROLE_INSTRUCTIONS[body.mode];
  const otherSchoolName =
    body.schoolId === 'kiberone' ? 'RENDERIA' : 'KIBERONE';

  const sections: string[] = [
    roleInstruction,
    `АКТИВНАЯ ШКОЛА В ЭТОМ ЗАПРОСЕ: ${schoolProfile.name} (${schoolProfile.tagline}).
Описание: ${schoolProfile.description}
СТРОГОЕ ПРАВИЛО ИЗОЛЯЦИИ ШКОЛ: Вы работаете исключительно в контексте школы ${schoolProfile.name}. Категорически запрещено смешивать программы, расписание, цены или документы со второй школой (${otherSchoolName}).`,
    `ПРАВИЛА ЧЕСТНОСТИ И ОФОРМЛЕНИЯ ОТВЕТА (MARKDOWN):
- Отвечайте на русском языке профессионально, структурно и доброжелательно для управляющей Анны.
- Оформляйте ответ в чистом стандарте Markdown:
  • НЕ экранируйте символы форматирования обратными слэшами (никогда не пишите \\*\\*текст\\*\\* или \\#\\#\\# — пишите **текст** и ###).
  • Используйте заголовки (##, ###), маркированные/нумерованные списки и таблицы только тогда, когда они действительно улучшают читаемость.
  • Не добавляйте крупные заголовки к коротким ответам из 1–3 предложений.
  • Не выделяйте жирным шрифтом целые предложения — выделяйте только ключевые термины, дни недели, метрики или акценты.
- Опирайтесь ТОЛЬКО на факты, переданные ниже в разделах Базы знаний школы ${schoolProfile.name}, выбранных документах и истории текущего диалога.
- Никогда не выдумывайте цены, расписание, адреса, названия модулей, результаты кампаний или статистику, если их нет в переданном контексте.`,
  ];

  // Selective Knowledge Base Context (only for the active school)
  const kbItems = (body.knowledgeBaseContext || [])
    .filter((item) => item && item.content && item.content.trim().length > 0)
    .slice(0, 8);

  if (kbItems.length > 0) {
    const formattedKb = kbItems
      .map(
        (item) =>
          `### ${item.categoryTitle}\n${item.content
            .trim()
            .slice(0, MAX_KB_CATEGORY_CHARS)}`
      )
      .join('\n\n');
    sections.push(
      `ДАННЫЕ ИЗ БАЗЫ ЗНАНИЙ ШКОЛЫ ${schoolProfile.name} (подтверждённые факты):\n${formattedKb}`
    );
  } else {
    sections.push(
      `ПРИМЕЧАНИЕ О БАЗЕ ЗНАНИЙ: Разделы Базы знаний школы ${schoolProfile.name} для этого запроса пусты или не выбраны. Не придумывайте фактические цены, адреса, расписание или список учебных модулей — явно разделяйте рабочие гипотезы и список вопросов для уточнения.`
    );
  }

  // Selective Document Context (only explicitly chosen by manager with consent)
  const docs = (body.selectedDocuments || [])
    .filter(
      (doc) =>
        doc &&
        typeof doc.extractedText === 'string' &&
        doc.extractedText.trim().length > 0
    )
    .slice(0, MAX_TOTAL_DOCS);

  if (docs.length > 0) {
    const formattedDocs = docs
      .map((doc, idx) => {
        const sourceLabel =
          doc.source === 'dialogue_attachment'
            ? 'Файл текущего диалога'
            : `Документ Базы знаний (${doc.categoryTitle || 'Материалы школы'})`;
        return `--- ДОКУМЕНТ #${idx + 1}: «${doc.name}» [${sourceLabel}] ---\n${doc.extractedText
          .trim()
          .slice(0, MAX_SINGLE_DOC_CHARS)}`;
      })
      .join('\n\n');
    sections.push(
      `ВЫБРАННЫЕ УПРАВЛЯЮЩЕЙ ДОКУМЕНТЫ ДЛЯ АНАЛИЗА В ЭТОМ ЗАПРОСЕ:\n${formattedDocs}`
    );
  }

  // Selective Pixel Context (only when mode === 'pixel')
  if (body.mode === 'pixel' && body.pixelContext) {
    const memories = (body.pixelContext.relevantMemories || []).slice(0, 8);
    const tasks = (body.pixelContext.activeTasks || []).slice(0, 10);

    const pixelParts: string[] = [];
    if (memories.length > 0) {
      pixelParts.push(
        'Подтверждённые записи из памяти об Анне:\n' +
          memories
            .map(
              (m) =>
                `- [${m.category}] ${m.title}: ${m.content.slice(0, 400)}`
            )
            .join('\n')
      );
    }
    if (tasks.length > 0) {
      pixelParts.push(
        'Актуальные задачи в списке дел Анны:\n' +
          tasks
            .map(
              (t) =>
                `- ${t.title} (срок: ${t.dueDate || 'без даты'}, приоритет: ${t.priority}, статус: ${t.status})`
            )
            .join('\n')
      );
    }
    if (pixelParts.length > 0) {
      sections.push(
        `РАБОЧИЙ КОНТЕКСТ ПОМОЩНИКА «ПИКСЕЛЬ»:\n${pixelParts.join('\n\n')}`
      );
    }
  }

  return sections.join('\n\n');
}

interface ClassifiedProviderError {
  status: number;
  code: string;
  message: string;
  shouldFailover: boolean;
  healthStatus: AIProviderHealthStatus;
  applyCooldown: boolean;
}

function classifyProviderError(
  providerId: AIProviderId,
  err: unknown
): ClassifiedProviderError {
  const providerName = PROVIDER_SHORT_LABELS_RU[providerId];
  const rawMessage = err instanceof Error ? err.message : String(err || '');
  const lower = rawMessage.toLowerCase();

  if (rawMessage === 'SIMULATED_GEMINI_ERROR') {
    return {
      status: 502,
      code: 'SIMULATED_ERROR',
      message: `Тестовая ошибка генерации ${providerName} (проверка резервного переключения).`,
      shouldFailover: true,
      healthStatus: 'temporarily_unavailable',
      applyCooldown: false,
    };
  }

  if (rawMessage === 'PAID_MODEL_FORBIDDEN') {
    return {
      status: 400,
      code: 'PAID_MODEL_FORBIDDEN',
      message:
        'Защита от платных списаний: в OpenRouter разрешены только бесплатные модели (openrouter/free или :free с нулевой стоимостью).',
      shouldFailover: true,
      healthStatus: 'key_check_required',
      applyCooldown: false,
    };
  }

  if (
    rawMessage === 'MISSING_GEMINI_API_KEY' ||
    rawMessage === 'MISSING_OPENROUTER_API_KEY'
  ) {
    const keyVar =
      providerId === 'openrouter' ? 'OPENROUTER_API_KEY' : 'GEMINI_API_KEY';
    return {
      status: 503,
      code: 'MISSING_API_KEY',
      message: `Провайдер ${providerName} не настроен: на сервере не задан ключ ${keyVar}.`,
      shouldFailover: true,
      healthStatus: 'not_configured',
      applyCooldown: false,
    };
  }

  if (rawMessage === 'OLLAMA_NOT_AVAILABLE') {
    return {
      status: 503,
      code: 'OLLAMA_NOT_AVAILABLE',
      message:
        'Локальный сервер Ollama (127.0.0.1:11434) недоступен. Адаптер Ollama предназначен для локального запуска или настольной Electron-версии.',
      shouldFailover: true,
      healthStatus: 'not_configured',
      applyCooldown: false,
    };
  }

  if (rawMessage === 'EMPTY_MODEL_RESPONSE') {
    return {
      status: 502,
      code: 'EMPTY_RESPONSE',
      message: `Модель ${providerName} вернула пустой ответ.`,
      shouldFailover: true,
      healthStatus: 'temporarily_unavailable',
      applyCooldown: false,
    };
  }

  if (
    (err instanceof Error && err.name === 'AbortError') ||
    lower.includes('aborterror') ||
    lower.includes('operation was aborted') ||
    lower.includes('timed out') ||
    lower.includes('timeout')
  ) {
    return {
      status: 408,
      code: 'REQUEST_TIMEOUT',
      message: `Превышено время ожидания ответа от ${providerName} (таймаут соединения).`,
      shouldFailover: true,
      healthStatus: 'temporarily_unavailable',
      applyCooldown: true,
    };
  }

  if (
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('unauthenticated') ||
    lower.includes('invalid api key') ||
    lower.includes('401')
  ) {
    return {
      status: 401,
      code: 'INVALID_API_KEY',
      message: `Ключ доступа для ${providerName} отклонён (401). Проверьте корректность ключа на сервере.`,
      shouldFailover: true,
      healthStatus: 'key_check_required',
      applyCooldown: true,
    };
  }

  if (
    lower.includes('permission_denied') ||
    lower.includes('user location is not supported') ||
    lower.includes('region') ||
    lower.includes('403')
  ) {
    return {
      status: 403,
      code: 'PERMISSION_OR_REGION_DENIED',
      message: `Доступ к ${providerName} ограничен (403 / региональное ограничение или права ключа).`,
      shouldFailover: true,
      healthStatus: 'temporarily_unavailable',
      applyCooldown: true,
    };
  }

  if (
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('429')
  ) {
    return {
      status: 429,
      code: 'RATE_LIMIT',
      message: `Превышен бесплатный лимит запросов ${providerName} (429).`,
      shouldFailover: true,
      healthStatus: 'quota_exceeded',
      applyCooldown: true,
    };
  }

  if (
    lower.includes('500') ||
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('504') ||
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('overloaded') ||
    lower.includes('fetch failed') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound')
  ) {
    return {
      status: 503,
      code: 'PROVIDER_UNAVAILABLE',
      message: `Сервер ${providerName} временно перегружен или недоступен (503).`,
      shouldFailover: true,
      healthStatus: 'temporarily_unavailable',
      applyCooldown: true,
    };
  }

  return {
    status: 500,
    code: 'PROVIDER_SERVER_ERROR',
    message: `Ошибка при обращении к провайдеру ${providerName}.`,
    shouldFailover: true,
    healthStatus: 'temporarily_unavailable',
    applyCooldown: false,
  };
}

function getThinkingConfigForGeminiModel(modelName: string): Record<string, unknown> | undefined {
  const norm = (modelName || '').toLowerCase();
  // Gemini 2.5 generation models support thinkingBudget (0 turns off thinking latency)
  if (norm.startsWith('gemini-2.5')) {
    return { thinkingBudget: 0 };
  }
  // Gemini 3.1 flash-lite supports thinkingBudget: 0 for fast responses
  if (norm.includes('3.1-flash-lite')) {
    return { thinkingBudget: 0 };
  }
  // Gemini 3.8 and Gemini 3 full models support thinkingLevel
  if (norm.startsWith('gemini-3')) {
    return { thinkingLevel: ThinkingLevel.LOW };
  }
  return undefined;
}

/**
 * Provider 1: Google Gemini Free execution
 */
async function executeGeminiGeneration(params: {
  systemInstruction: string;
  messages: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
  signal: AbortSignal;
  simulateError?: string;
}): Promise<{ text: string; model: string }> {
  if (params.simulateError === 'force_error' || params.simulateError === 'force_gemini_error') {
    throw new Error('SIMULATED_GEMINI_ERROR');
  }

  const ai = getGenAIClient();
  let usedModel = GEMINI_MODEL;
  let response;

  const primaryThinking = getThinkingConfigForGeminiModel(usedModel);
  const primaryConfig: Record<string, unknown> = {
    systemInstruction: params.systemInstruction,
    abortSignal: params.signal,
  };
  if (primaryThinking) {
    primaryConfig.thinkingConfig = primaryThinking;
  }

  try {
    response = await ai.models.generateContent({
      model: usedModel,
      contents: params.messages,
      config: primaryConfig,
    });
  } catch (primaryErr) {
    const errText =
      primaryErr instanceof Error
        ? primaryErr.message.toLowerCase()
        : String(primaryErr || '').toLowerCase();
    const isQuotaOrOverload =
      errText.includes('429') ||
      errText.includes('resource_exhausted') ||
      errText.includes('quota') ||
      errText.includes('503') ||
      errText.includes('unavailable') ||
      errText.includes('overloaded');

    if (!params.signal.aborted && isQuotaOrOverload) {
      usedModel = GEMINI_QUOTA_FALLBACK_MODEL;
      const fallbackThinking = getThinkingConfigForGeminiModel(usedModel);
      const fallbackConfig: Record<string, unknown> = {
        systemInstruction: params.systemInstruction,
        abortSignal: params.signal,
      };
      if (fallbackThinking) {
        fallbackConfig.thinkingConfig = fallbackThinking;
      }

      response = await ai.models.generateContent({
        model: usedModel,
        contents: params.messages,
        config: fallbackConfig,
      });
    } else {
      throw primaryErr;
    }
  }

  const fullText = (response.text || '').trim();
  if (!fullText) {
    throw new Error('EMPTY_MODEL_RESPONSE');
  }
  return { text: fullText, model: usedModel };
}

/**
 * Provider 2: OpenRouter Free execution (`openrouter/free` or verified `:free` model with 0 cost).
 * Strictly enforces zero-cost rules: never allows paid models or paid fallback.
 */
async function executeOpenRouterFreeGeneration(params: {
  systemInstruction: string;
  messages: IncomingChatMessage[];
  signal: AbortSignal;
}): Promise<{ text: string; model: string }> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey || apiKey === 'MY_OPENROUTER_API_KEY') {
    throw new Error('MISSING_OPENROUTER_API_KEY');
  }

  let requestedModel = (
    process.env.OPENROUTER_MODEL || 'openrouter/free'
  ).trim();

  // Strict Zero-Cost Guard (Part 4): block any model ID that is not `openrouter/free` or `:free`
  if (!isStrictlyFreeOpenRouterModelId(requestedModel)) {
    requestedModel = 'openrouter/free';
  }

  // If a specific `:free` model is configured, verify against live catalog that pricing is 0/0
  if (requestedModel !== 'openrouter/free') {
    const freeCatalog = await fetchOpenRouterFreeCatalog(params.signal);
    if (freeCatalog.length > 1 && !freeCatalog.includes(requestedModel)) {
      requestedModel = 'openrouter/free';
    }
  }

  const openAiMessages = [
    { role: 'system', content: params.systemInstruction },
    ...params.messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content.trim().slice(0, MAX_SINGLE_MESSAGE_CHARS),
    })),
  ];

  const timeoutController = new AbortController();
  const timer = setTimeout(
    () => timeoutController.abort(),
    OPENROUTER_ATTEMPT_TIMEOUT_MS
  );
  const onAbort = () => timeoutController.abort();
  params.signal.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
        'X-Title': 'KIBERONE & RENDERIA Business Assistant',
      },
      body: JSON.stringify({
        model: requestedModel,
        messages: openAiMessages,
      }),
      signal: timeoutController.signal,
    });

    if (!res.ok) {
      let errDetail = `${res.status}`;
      try {
        const errJson = (await res.json()) as {
          error?: { message?: string; code?: number };
        };
        if (errJson?.error?.message) {
          errDetail = `${res.status}: ${errJson.error.message}`;
        }
      } catch {
        // ignore parse error
      }
      throw new Error(`OpenRouter HTTP ${errDetail}`);
    }

    const data = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (data?.error?.message) {
      throw new Error(`OpenRouter Error: ${data.error.message}`);
    }

    const rawContent = data?.choices?.[0]?.message?.content;
    const text = typeof rawContent === 'string' ? rawContent.trim() : '';
    // Strict requirement: Never substitute internal model reasoning for user content.
    // If content is empty, trigger the standard controlled failover via EMPTY_MODEL_RESPONSE.
    if (!text) {
      throw new Error('EMPTY_MODEL_RESPONSE');
    }

    const actualModel = String(data?.model || requestedModel).trim();
    return {
      text,
      model: actualModel,
    };
  } finally {
    clearTimeout(timer);
    params.signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Provider 3: Ollama Local Adapter (`http://127.0.0.1:11434`) for local / Electron mode.
 * Never auto-downloads models; checks `/api/tags` and calls `/api/chat`.
 */
async function executeOllamaLocalGeneration(params: {
  systemInstruction: string;
  messages: IncomingChatMessage[];
  signal: AbortSignal;
}): Promise<{ text: string; model: string }> {
  const timeoutController = new AbortController();
  const timer = setTimeout(
    () => timeoutController.abort(),
    OLLAMA_ATTEMPT_TIMEOUT_MS
  );
  const onAbort = () => timeoutController.abort();
  params.signal.addEventListener('abort', onAbort, { once: true });

  try {
    // 1. Check installed local models via GET /api/tags (short 2.5s connection check)
    const tagsCtrl = new AbortController();
    const tagsTimer = setTimeout(() => tagsCtrl.abort(), 2500);
    let installedModel = providerHealthRegistry.ollama.lastResolvedModel || '';

    try {
      const tagsRes = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: tagsCtrl.signal,
      });
      if (!tagsRes.ok) {
        throw new Error('OLLAMA_NOT_AVAILABLE');
      }
      const tagsJson = (await tagsRes.json()) as {
        models?: Array<{ name?: string }>;
      };
      const modelsList = (tagsJson.models || [])
        .map((m) => String(m?.name || '').trim())
        .filter(Boolean);
      if (modelsList.length === 0) {
        throw new Error('OLLAMA_NOT_AVAILABLE');
      }
      installedModel = modelsList[0];
    } catch {
      throw new Error('OLLAMA_NOT_AVAILABLE');
    } finally {
      clearTimeout(tagsTimer);
    }

    // 2. Call POST /api/chat with stream: false
    const chatRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: installedModel,
        stream: false,
        messages: [
          { role: 'system', content: params.systemInstruction },
          ...params.messages.map((m) => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content.trim().slice(0, MAX_SINGLE_MESSAGE_CHARS),
          })),
        ],
      }),
      signal: timeoutController.signal,
    });

    if (!chatRes.ok) {
      throw new Error(`Ollama HTTP ${chatRes.status}`);
    }

    const chatJson = (await chatRes.json()) as {
      model?: string;
      message?: { content?: string };
    };
    const text = String(chatJson?.message?.content || '').trim();
    if (!text) {
      throw new Error('EMPTY_MODEL_RESPONSE');
    }
    return {
      text,
      model: String(chatJson?.model || installedModel),
    };
  } finally {
    clearTimeout(timer);
    params.signal.removeEventListener('abort', onAbort);
  }
}

function splitTextIntoChunks(text: string, chunkSize: number): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

function writeSseEvent(
  res: Response,
  payload: Record<string, unknown>
): boolean {
  if (res.writableEnded || res.destroyed) return false;
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

async function startServer() {
  const app = express();

  // Strict payload size limit to protect the server
  app.use(express.json({ limit: '2mb' }));

  initializeDefaultConnectionProfiles();

  // 1. Health & Safe Diagnostics Status Endpoint (Never exposes API keys or user content)
  app.get('/api/gemini/status', (_req: Request, res: Response) => {
    res.json({
      configured: isGeminiApiKeyConfigured(),
      model: GEMINI_MODEL,
      sdkVersion: SDK_VERSION,
      endpoint: '/api/gemini/chat',
      providersState: buildProvidersSystemState(),
      recentDiagnostics: recentDiagnostics.slice(0, 10),
    });
  });

  // 1b. Multi-Provider Status Endpoint (Zero Quota Usage)
  app.get('/api/ai/providers/status', (_req: Request, res: Response) => {
    res.json(buildProvidersSystemState());
  });

  // 1c. On-Demand Provider Connectivity & Free Catalog Check (Triggered by User Button)
  app.post('/api/ai/providers/check', async (req: Request, res: Response) => {
    const requestedProvider = req.body?.providerId as AIProviderId | undefined;
    const nowIso = new Date().toISOString();

    const checkGemini = !requestedProvider || requestedProvider === 'gemini';
    const checkOpenRouter =
      !requestedProvider || requestedProvider === 'openrouter';
    const checkOllama = !requestedProvider || requestedProvider === 'ollama';

    if (checkGemini) {
      providerHealthRegistry.gemini.lastCheckedAtIso = nowIso;
      if (!isGeminiApiKeyConfigured()) {
        providerHealthRegistry.gemini.status = 'not_configured';
        providerHealthRegistry.gemini.lastErrorReason =
          'Ключ GEMINI_API_KEY не задан на сервере.';
      } else if (!isProviderInCooldown('gemini')) {
        providerHealthRegistry.gemini.status = 'connected';
        providerHealthRegistry.gemini.lastErrorReason = undefined;
      }
    }

    if (checkOpenRouter) {
      providerHealthRegistry.openrouter.lastCheckedAtIso = nowIso;
      const freeModels = await fetchOpenRouterFreeCatalog();
      if (!isOpenRouterApiKeyConfigured()) {
        providerHealthRegistry.openrouter.status = 'not_configured';
        providerHealthRegistry.openrouter.lastErrorReason = `Бесплатный каталог OpenRouter доступен (${freeModels.length} мод.), но серверный ключ OPENROUTER_API_KEY ещё не добавлен в Secrets.`;
      } else if (!isProviderInCooldown('openrouter')) {
        providerHealthRegistry.openrouter.status = 'available';
        providerHealthRegistry.openrouter.lastErrorReason = undefined;
      }
    }

    if (checkOllama) {
      providerHealthRegistry.ollama.lastCheckedAtIso = nowIso;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2000);
      try {
        const tagsRes = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: ctrl.signal,
        });
        if (tagsRes.ok) {
          const tagsJson = (await tagsRes.json()) as {
            models?: Array<{ name?: string }>;
          };
          const models = (tagsJson.models || [])
            .map((m) => String(m?.name || '').trim())
            .filter(Boolean);
          if (models.length > 0) {
            providerHealthRegistry.ollama.status = 'connected';
            providerHealthRegistry.ollama.lastResolvedModel = models[0];
            providerHealthRegistry.ollama.lastErrorReason = undefined;
          } else {
            providerHealthRegistry.ollama.status = 'not_configured';
            providerHealthRegistry.ollama.lastErrorReason =
              'Сервер Ollama запущен, но локальные модели ещё не установлены.';
          }
        } else {
          providerHealthRegistry.ollama.status = 'not_configured';
          providerHealthRegistry.ollama.lastErrorReason =
            'Локальный сервер Ollama (127.0.0.1:11434) не обнаружен (доступен в настольной Electron-версии).';
        }
      } catch {
        providerHealthRegistry.ollama.status = 'not_configured';
        providerHealthRegistry.ollama.lastErrorReason =
          'Локальный адаптер для настольной Electron-версии (127.0.0.1:11434). В облачном Preview локальный демон не запущен.';
      } finally {
        clearTimeout(t);
      }
    }

    res.json(buildProvidersSystemState());
  });

  // 1d. AI Connection Profiles Management Endpoints
  app.get('/api/ai/connections', (_req: Request, res: Response) => {
    initializeDefaultConnectionProfiles();
    // Return profiles WITHOUT exposing any secrets (maskedKey and public metadata only)
    res.json(serverConnectionProfiles);
  });

  app.post('/api/ai/connections', (req: Request, res: Response) => {
    initializeDefaultConnectionProfiles();
    const { id, providerId, userDefinedName, rawApiKey, selectedModel, isDefault } =
      req.body || {};

    if (!providerId || !userDefinedName) {
      return res.status(400).json({
        error: { message: 'Укажите провайдера и понятное название подключения.' },
      });
    }

    if (providerId === 'openrouter' && selectedModel) {
      if (!isStrictlyFreeOpenRouterModelId(selectedModel)) {
        return res.status(400).json({
          error: {
            message:
              'Защита от списаний: для OpenRouter разрешены исключительно бесплатные модели (openrouter/free или :free).',
          },
        });
      }
    }

    const existingIndex = id
      ? serverConnectionProfiles.findIndex((p) => p.id === id)
      : -1;
    const profileId =
      existingIndex >= 0
        ? id
        : `profile-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const cleanKey = typeof rawApiKey === 'string' ? rawApiKey.trim() : '';

    if (cleanKey) {
      serverRawSecretsStore.set(profileId, cleanKey);
    }

    if (isDefault) {
      serverConnectionProfiles.forEach((p) => {
        if (p.providerId === providerId) p.isDefault = false;
      });
    }

    const currentKey =
      serverRawSecretsStore.get(profileId) ||
      (providerId === 'gemini'
        ? (process.env.GEMINI_API_KEY || '').trim()
        : providerId === 'openrouter'
          ? (process.env.OPENROUTER_API_KEY || '').trim()
          : '');
    const maskedKey =
      providerId === 'ollama'
        ? 'Локальный API (без ключа)'
        : maskApiKeyOnServer(currentKey);
    const hasKey =
      providerId === 'ollama'
        ? true
        : Boolean(currentKey && currentKey.length >= 8);

    const updatedProfile: ServerAIConnectionProfile = {
      id: profileId,
      providerId,
      userDefinedName: String(userDefinedName).trim().slice(0, 60),
      maskedKey,
      encryptedCredentialReference: `ref-srv-${profileId}`,
      selectedModel: String(
        selectedModel ||
          (providerId === 'gemini'
            ? GEMINI_MODEL
            : providerId === 'openrouter'
              ? OPENROUTER_DEFAULT_FREE_MODEL
              : 'llama3.2:3b')
      ).trim(),
      connectionStatus: hasKey
        ? providerId === 'ollama'
          ? 'not_configured'
          : 'available'
        : 'not_configured',
      isDefault: Boolean(isDefault),
      createdAt:
        existingIndex >= 0
          ? serverConnectionProfiles[existingIndex].createdAt
          : new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      serverConnectionProfiles[existingIndex] = updatedProfile;
    } else {
      serverConnectionProfiles.push(updatedProfile);
    }

    res.json(updatedProfile);
  });

  app.delete('/api/ai/connections/:id', (req: Request, res: Response) => {
    initializeDefaultConnectionProfiles();
    const id = req.params.id;
    const index = serverConnectionProfiles.findIndex((p) => p.id === id);
    if (index >= 0) {
      serverConnectionProfiles.splice(index, 1);
      serverRawSecretsStore.delete(id);
      return res.json({ ok: true });
    }
    res.status(404).json({ error: { message: 'Профиль подключения не найден.' } });
  });

  app.post('/api/ai/connections/:id/test', async (req: Request, res: Response) => {
    initializeDefaultConnectionProfiles();
    const profileId = req.params.id;
    const profile = serverConnectionProfiles.find((p) => p.id === profileId);
    if (!profile) {
      return res
        .status(404)
        .json({ error: { message: 'Профиль подключения не найден.' } });
    }

    const startMs = Date.now();
    const testedAt = new Date().toISOString();

    if (profile.providerId === 'gemini') {
      const rawKey =
        serverRawSecretsStore.get(profileId) ||
        (process.env.GEMINI_API_KEY || '').trim();
      if (!rawKey) {
        profile.connectionStatus = 'not_configured';
        profile.lastCheckedAt = testedAt;
        profile.lastError = 'API-ключ не настроен на сервере.';
        return res.json({
          ok: false,
          status: 'not_configured',
          model: profile.selectedModel,
          error: profile.lastError,
          testedAt,
        });
      }
      try {
        const testClient = new GoogleGenAI({ apiKey: rawKey });
        await testClient.models.generateContent({
          model: profile.selectedModel || GEMINI_MODEL,
          contents: 'ping',
        });
        profile.connectionStatus = 'connected';
        profile.lastCheckedAt = testedAt;
        profile.lastError = undefined;
        return res.json({
          ok: true,
          status: 'connected',
          model: profile.selectedModel,
          testedAt,
          latencyMs: Date.now() - startMs,
        });
      } catch (err) {
        const classified = classifyProviderError('gemini', err);
        profile.connectionStatus =
          classified.healthStatus === 'connected'
            ? 'connected'
            : classified.healthStatus === 'quota_exceeded'
              ? 'quota_exceeded'
              : 'error';
        profile.lastCheckedAt = testedAt;
        profile.lastError = classified.message;
        return res.json({
          ok: false,
          status: profile.connectionStatus,
          model: profile.selectedModel,
          error: classified.message,
          testedAt,
          latencyMs: Date.now() - startMs,
        });
      }
    }

    if (profile.providerId === 'openrouter') {
      const rawKey =
        serverRawSecretsStore.get(profileId) ||
        (process.env.OPENROUTER_API_KEY || '').trim();
      if (!rawKey) {
        profile.connectionStatus = 'not_configured';
        profile.lastCheckedAt = testedAt;
        profile.lastError = 'API-ключ OpenRouter не настроен.';
        return res.json({
          ok: false,
          status: 'not_configured',
          model: profile.selectedModel,
          error: profile.lastError,
          testedAt,
        });
      }
      if (!isStrictlyFreeOpenRouterModelId(profile.selectedModel)) {
        profile.connectionStatus = 'error';
        profile.lastCheckedAt = testedAt;
        profile.lastError =
          'Защита от списаний: в OpenRouter разрешены только бесплатные модели.';
        return res.json({
          ok: false,
          status: 'error',
          model: profile.selectedModel,
          error: profile.lastError,
          testedAt,
        });
      }
      try {
        const authRes = await fetch('https://openrouter.ai/api/v1/auth/key', {
          headers: { Authorization: `Bearer ${rawKey}` },
        });
        if (!authRes.ok) {
          throw new Error(
            `OpenRouter HTTP ${authRes.status}: Неверный ключ или ошибка авторизации`
          );
        }
        profile.connectionStatus = 'available';
        profile.lastCheckedAt = testedAt;
        profile.lastError = undefined;
        return res.json({
          ok: true,
          status: 'available',
          model: profile.selectedModel,
          testedAt,
          latencyMs: Date.now() - startMs,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        profile.connectionStatus = 'error';
        profile.lastCheckedAt = testedAt;
        profile.lastError = msg;
        return res.json({
          ok: false,
          status: 'error',
          model: profile.selectedModel,
          error: msg,
          testedAt,
          latencyMs: Date.now() - startMs,
        });
      }
    }

    if (profile.providerId === 'ollama') {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 2000);
        const resTags = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
          signal: ctrl.signal,
        });
        clearTimeout(t);
        if (resTags.ok) {
          const json = (await resTags.json()) as {
            models?: Array<{ name?: string }>;
          };
          const modelNames = (json.models || []).map((m) => m?.name || '');
          const hasModel = modelNames.some((m) =>
            m
              .toLowerCase()
              .includes((profile.selectedModel || '').toLowerCase())
          );
          profile.connectionStatus = 'connected';
          profile.lastCheckedAt = testedAt;
          profile.lastError = hasModel
            ? undefined
            : `Модель ${profile.selectedModel} пока не загружена в локальную Ollama.`;
          return res.json({
            ok: true,
            status: 'connected',
            model: profile.selectedModel,
            testedAt,
            latencyMs: Date.now() - startMs,
            error: profile.lastError,
          });
        }
        throw new Error('Локальный API Ollama (127.0.0.1:11434) недоступен.');
      } catch {
        profile.connectionStatus = 'not_configured';
        profile.lastCheckedAt = testedAt;
        profile.lastError =
          'Сервер Ollama не запущен (доступен в настольной версии или после локального запуска).';
        return res.json({
          ok: false,
          status: 'not_configured',
          model: profile.selectedModel,
          error: profile.lastError,
          testedAt,
        });
      }
    }

    return res
      .status(400)
      .json({ error: { message: 'Неизвестный провайдер.' } });
  });

  // 1e. Specialist Model Assignment Endpoints
  app.get('/api/ai/specialist-models', (_req: Request, res: Response) => {
    res.json(serverSpecialistModelAssignments);
  });

  app.post('/api/ai/specialist-models', (req: Request, res: Response) => {
    const assignments = req.body;
    if (assignments && typeof assignments === 'object') {
      serverSpecialistModelAssignments = {
        ...serverSpecialistModelAssignments,
        ...assignments,
      };
    }
    res.json(serverSpecialistModelAssignments);
  });

  // 1f. Failover Settings Endpoints
  app.get('/api/ai/failover-settings', (_req: Request, res: Response) => {
    res.json(serverFailoverSettings);
  });

  app.post('/api/ai/failover-settings', (req: Request, res: Response) => {
    const settings = req.body;
    if (settings && typeof settings === 'object') {
      if (Array.isArray(settings.order) && settings.order.length > 0) {
        serverFailoverSettings.order = settings.order.filter((p: string) =>
          VALID_PROVIDER_IDS.has(p as AIProviderId)
        );
      }
      if (typeof settings.allowCloudFailoverForDocs === 'boolean') {
        serverFailoverSettings.allowCloudFailoverForDocs =
          settings.allowCloudFailoverForDocs;
      }
      if (typeof settings.requireExplicitDocConsent === 'boolean') {
        serverFailoverSettings.requireExplicitDocConsent =
          settings.requireExplicitDocConsent;
      }
    }
    res.json(serverFailoverSettings);
  });

  // 1g. Ollama Status & Catalog Endpoint
  app.get('/api/ai/ollama/status', async (_req: Request, res: Response) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    try {
      const tagsRes = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: ctrl.signal,
      });
      if (tagsRes.ok) {
        const tagsJson = (await tagsRes.json()) as {
          models?: Array<{
            name?: string;
            size?: number;
            modified_at?: string;
            details?: {
              parameter_size?: string;
              format?: string;
              family?: string;
            };
          }>;
        };
        const models = (tagsJson.models || []).map((m) => ({
          name: String(m.name || ''),
          sizeBytes: typeof m.size === 'number' ? m.size : undefined,
          modifiedAt: m.modified_at,
          parameterSize: m.details?.parameter_size,
          format: m.details?.format,
          family: m.details?.family,
        }));
        return res.json({
          installed: true,
          running: true,
          apiUrl: OLLAMA_BASE_URL,
          models,
          lastCheckedAt: new Date().toISOString(),
        });
      }
      return res.json({
        installed: false,
        running: false,
        apiUrl: OLLAMA_BASE_URL,
        models: [],
        error: 'Локальный порт 11434 не отвечает.',
      });
    } catch {
      return res.json({
        installed: false,
        running: false,
        apiUrl: OLLAMA_BASE_URL,
        models: [],
        error:
          'Локальный демон Ollama не обнаружен (доступен на ПК после запуска Ollama).',
      });
    } finally {
      clearTimeout(t);
    }
  });

  // 2. Universal Server Endpoint for the 4 Specialists & Pixel Companion with Free Provider Failover
  const handleAiChatRequest = async (req: Request, res: Response) => {
    const startMs = Date.now();
    const requestId = `req-${startMs.toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const body = req.body as GeminiChatRequestBody | undefined;

    if (!body || typeof body !== 'object') {
      res.status(400).json({
        error: {
          code: 'INVALID_BODY',
          message: 'Некорректный формат тела запроса.',
        },
      });
      return;
    }

    if (!VALID_SCHOOLS.has(body.schoolId)) {
      res.status(400).json({
        error: {
          code: 'INVALID_SCHOOL',
          message:
            'Не указана или некорректна активная школа (kiberone | renderia).',
        },
      });
      return;
    }

    if (!VALID_MODES.has(body.mode)) {
      res.status(400).json({
        error: {
          code: 'INVALID_MODE',
          message:
            'Некорректный режим специалиста (marketer | manager | methodist | analyst | pixel).',
        },
      });
      return;
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      res.status(400).json({
        error: {
          code: 'EMPTY_MESSAGES',
          message: 'Список сообщений диалога не может быть пустым.',
        },
      });
      return;
    }

    const hasDocumentsWithText =
      Array.isArray(body.selectedDocuments) &&
      body.selectedDocuments.some(
        (d) =>
          d &&
          typeof d.extractedText === 'string' &&
          d.extractedText.trim().length > 0
      );

    // Build set of providers that have explicit document transmission consent for this request (Part 7)
    const consentedProvidersSet = new Set<AIProviderId>();
    if (Array.isArray(body.consentedProviders)) {
      for (const p of body.consentedProviders) {
        if (VALID_PROVIDER_IDS.has(p)) {
          consentedProvidersSet.add(p);
        }
      }
    } else if (body.externalApiConsentConfirmed === true) {
      // Backward-compatible default: externalApiConsentConfirmed=true grants consent for primary Gemini API
      consentedProvidersSet.add('gemini');
    }

    let requestedSelection: AIProviderSelectionMode =
      body.providerSelection === 'gemini' ||
      body.providerSelection === 'openrouter' ||
      body.providerSelection === 'ollama'
        ? body.providerSelection
        : 'auto';

    if (requestedSelection === 'auto') {
      const specialistAssignment = serverSpecialistModelAssignments[body.mode];
      if (
        specialistAssignment &&
        specialistAssignment.providerSelection &&
        specialistAssignment.providerSelection !== 'auto'
      ) {
        requestedSelection = specialistAssignment.providerSelection;
      }
    }

    // Validate initial document consent before starting any generation
    if (hasDocumentsWithText) {
      const initialTargetProvider: AIProviderId =
        requestedSelection === 'auto' ? 'gemini' : requestedSelection;

      if (!consentedProvidersSet.has(initialTargetProvider)) {
        res.status(400).json({
          error: {
            code: 'DOCUMENT_CONSENT_REQUIRED',
            targetProvider: initialTargetProvider,
            targetProviderLabel: PROVIDER_LABELS_RU[initialTargetProvider],
            message:
              initialTargetProvider === 'ollama'
                ? 'Подтвердите обработку извлечённого текста документа локальной моделью Ollama на вашем компьютере.'
                : `Отправка извлечённого текста документов во внешний сервис ${PROVIDER_LABELS_RU[initialTargetProvider]} требует отдельного явного подтверждения управляющей.`,
          },
        });
        return;
      }
    }

    const normalizedRawMessages = body.messages
      .filter(
        (m) =>
          m &&
          typeof m.content === 'string' &&
          m.content.trim().length > 0
      )
      .slice(-MAX_MESSAGES_IN_CONTEXT);

    const trimmedGeminiMessages = normalizedRawMessages.map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('model' as const),
      parts: [{ text: m.content.trim().slice(0, MAX_SINGLE_MESSAGE_CHARS) }],
    }));

    if (trimmedGeminiMessages.length === 0) {
      res.status(400).json({
        error: {
          code: 'EMPTY_MESSAGE_CONTENT',
          message: 'Текст сообщения пуст.',
        },
      });
      return;
    }

    const systemInstruction = buildSystemInstruction(body);
    const wantsStream = body.stream !== false;
    const docsCount = Array.isArray(body.selectedDocuments)
      ? Math.min(body.selectedDocuments.length, MAX_TOTAL_DOCS)
      : 0;

    // Determine candidate provider sequence (failover order always preserved)
    const configuredOrder = serverFailoverSettings.order || [
      'gemini',
      'openrouter',
      'ollama',
    ];

    let candidateProviders: AIProviderId[];
    if (requestedSelection !== 'auto') {
      // Put requested provider first, followed by the remaining configured providers in failover order
      candidateProviders = [
        requestedSelection,
        ...configuredOrder.filter((p) => p !== requestedSelection),
      ];
    } else {
      const baseOrder: AIProviderId[] = configuredOrder.filter((p) => {
        if (p === 'ollama') {
          return (
            providerHealthRegistry.ollama.status === 'connected' ||
            providerHealthRegistry.ollama.status === 'available'
          );
        }
        return true;
      });
      if (baseOrder.length === 0) {
        baseOrder.push('gemini', 'openrouter');
      }
      // Put non-cooldown configured providers first, keeping fallback order intact
      const ready = baseOrder.filter((p) => !isProviderInCooldown(p));
      const cooling = baseOrder.filter((p) => isProviderInCooldown(p));
      candidateProviders = [...ready, ...cooling];
    }

    // Track actual client disconnect via res.on('close') before res.writableEnded
    const abortController = new AbortController();
    let clientDisconnected = false;

    res.on('close', () => {
      if (!res.writableEnded) {
        clientDisconnected = true;
        abortController.abort();
      }
    });

    let heartbeatTimer: NodeJS.Timeout | null = null;
    let timeToFirstTokenMs: number | null = null;
    let chunkCount = 0;
    let charCount = 0;

    try {
      if (wantsStream) {
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        const firstUsableProvider =
          candidateProviders.find((p) =>
            p === 'gemini'
              ? isGeminiApiKeyConfigured()
              : p === 'openrouter'
                ? isOpenRouterApiKeyConfigured()
                : providerHealthRegistry.ollama.status === 'connected' ||
                  providerHealthRegistry.ollama.status === 'available'
          ) ||
          candidateProviders[0] ||
          'gemini';

        writeSseEvent(res, {
          type: 'stage',
          stage: 'waiting_model',
          requestId,
          providerId: firstUsableProvider,
          model: GEMINI_MODEL,
        });

        heartbeatTimer = setInterval(() => {
          if (!clientDisconnected && !res.writableEnded) {
            try {
              res.write(`: ping ${Date.now() - startMs}ms\n\n`);
            } catch {
              // ignore write error on closing socket
            }
          }
        }, HEARTBEAT_INTERVAL_MS);
      }

      let finalResult: {
        text: string;
        model: string;
        providerId: AIProviderId;
        failoverUsed: boolean;
        failoverFromProvider?: AIProviderId;
        failoverNotice?: string;
      } | null = null;

      let firstFailedProvider: AIProviderId | undefined;
      let lastClassifiedError: ClassifiedProviderError | null = null;

      for (let i = 0; i < candidateProviders.length; i++) {
        const providerId = candidateProviders[i];
        if (clientDisconnected) break;

        // Skip unconfigured providers if there are other candidate providers to try
        if (providerId === 'openrouter' && !isOpenRouterApiKeyConfigured()) {
          if (!firstFailedProvider) {
            firstFailedProvider = 'openrouter';
          }
          lastClassifiedError = {
            status: 503,
            code: 'OPENROUTER_NOT_CONFIGURED',
            message:
              'Провайдер OpenRouter Free ещё не настроен: не задан ключ API в настройках подключений или на сервере.',
            shouldFailover: true,
            healthStatus: 'not_configured',
            applyCooldown: false,
          };
          if (i < candidateProviders.length - 1) {
            continue;
          }
        }

        if (providerId === 'gemini' && !isGeminiApiKeyConfigured()) {
          if (!firstFailedProvider) {
            firstFailedProvider = 'gemini';
          }
          lastClassifiedError = {
            status: 503,
            code: 'GEMINI_NOT_CONFIGURED',
            message:
              'Провайдер Google Gemini не настроен: не задан GEMINI_API_KEY на сервере.',
            shouldFailover: true,
            healthStatus: 'not_configured',
            applyCooldown: false,
          };
          if (i < candidateProviders.length - 1) {
            continue;
          }
        }

        if (
          providerId === 'ollama' &&
          !(
            providerHealthRegistry.ollama.status === 'connected' ||
            providerHealthRegistry.ollama.status === 'available'
          )
        ) {
          if (!firstFailedProvider) {
            firstFailedProvider = 'ollama';
          }
          lastClassifiedError = {
            status: 503,
            code: 'OLLAMA_NOT_AVAILABLE',
            message:
              'Локальный сервер Ollama не запущен на порту 11434 (доступен в настольной версии или после запуска Ollama на ПК).',
            shouldFailover: true,
            healthStatus: 'not_configured',
            applyCooldown: false,
          };
          if (i < candidateProviders.length - 1) {
            continue;
          }
        }

        // Part 7: Per-provider document consent check before failing over with documents!
        if (hasDocumentsWithText && !consentedProvidersSet.has(providerId)) {
          const consentErrorPayload = {
            status: 400,
            code: 'DOCUMENT_CONSENT_REQUIRED_FOR_PROVIDER',
            targetProvider: providerId,
            targetProviderLabel: PROVIDER_LABELS_RU[providerId],
            failedProvider: firstFailedProvider || 'gemini',
            failedReason: lastClassifiedError?.message,
            message: `${
              firstFailedProvider
                ? `${PROVIDER_SHORT_LABELS_RU[firstFailedProvider]} временно недоступен. `
                : ''
            }Для автоматического переключения на ${PROVIDER_LABELS_RU[providerId]} требуется ваше отдельное согласие на передачу извлечённого текста выбранных документов этому провайдеру.`,
          };

          if (wantsStream && res.headersSent) {
            writeSseEvent(res, {
              type: 'error',
              requestId,
              message: consentErrorPayload.message,
              error: consentErrorPayload,
            });
            return;
          }
          res.status(400).json({
            requestId,
            error: consentErrorPayload,
          });
          return;
        }

        try {
          let attemptResult: { text: string; model: string };
          if (providerId === 'gemini') {
            attemptResult = await executeGeminiGeneration({
              systemInstruction,
              messages: trimmedGeminiMessages,
              signal: abortController.signal,
              simulateError: body.simulateError,
            });
          } else if (providerId === 'openrouter') {
            attemptResult = await executeOpenRouterFreeGeneration({
              systemInstruction,
              messages: normalizedRawMessages,
              signal: abortController.signal,
            });
          } else {
            attemptResult = await executeOllamaLocalGeneration({
              systemInstruction,
              messages: normalizedRawMessages,
              signal: abortController.signal,
            });
          }

          markProviderSuccess(providerId, attemptResult.model);

          const failoverUsed = Boolean(
            firstFailedProvider && firstFailedProvider !== providerId
          );
          const failoverNotice = failoverUsed
            ? `${PROVIDER_SHORT_LABELS_RU[firstFailedProvider!]} недоступен или не настроен. Переключились на ${PROVIDER_SHORT_LABELS_RU[providerId]}`
            : undefined;

          finalResult = {
            text: attemptResult.text,
            model: attemptResult.model,
            providerId,
            failoverUsed,
            failoverFromProvider: failoverUsed
              ? firstFailedProvider
              : undefined,
            failoverNotice,
          };
          break;
        } catch (providerErr) {
          if (clientDisconnected) break;
          const classified = classifyProviderError(providerId, providerErr);
          markProviderFailure(
            providerId,
            classified.healthStatus,
            classified.message,
            classified.applyCooldown
          );
          if (!firstFailedProvider) {
            firstFailedProvider = providerId;
          }
          lastClassifiedError = classified;

          if (!classified.shouldFailover) {
            break;
          }
        }
      }

      if (clientDisconnected) {
        recordSafeDiagnostic({
          requestId,
          timestampIso: new Date().toISOString(),
          schoolId: body.schoolId,
          mode: body.mode,
          providerId: candidateProviders[0] || 'gemini',
          model: GEMINI_MODEL,
          generationMethod: wantsStream
            ? 'generateContent_sse'
            : 'generateContent_json',
          status: 'aborted',
          durationMs: Date.now() - startMs,
          timeToFirstTokenMs,
          chunkCount,
          charCount,
          historyMessagesSent: trimmedGeminiMessages.length,
          documentsSent: docsCount,
          systemPromptChars: systemInstruction.length,
          errorType: 'CLIENT_ABORTED',
        });
        return;
      }

      if (!finalResult) {
        const errToReport = lastClassifiedError || {
          status: 503,
          code: 'ALL_PROVIDERS_UNAVAILABLE',
          message:
            'Все настроенные бесплатные ИИ-провайдеры сейчас временно недоступны. Пожалуйста, попробуйте повторить отправку через несколько секунд.',
        };

        recordSafeDiagnostic({
          requestId,
          timestampIso: new Date().toISOString(),
          schoolId: body.schoolId,
          mode: body.mode,
          providerId: firstFailedProvider || 'gemini',
          model: GEMINI_MODEL,
          generationMethod: wantsStream
            ? 'generateContent_sse'
            : 'generateContent_json',
          status: 'error',
          durationMs: Date.now() - startMs,
          timeToFirstTokenMs,
          chunkCount,
          charCount,
          historyMessagesSent: trimmedGeminiMessages.length,
          documentsSent: docsCount,
          systemPromptChars: systemInstruction.length,
          errorType: errToReport.code,
        });

        if (wantsStream && res.headersSent) {
          writeSseEvent(res, {
            type: 'error',
            requestId,
            message: errToReport.message,
            error: errToReport,
          });
          return;
        }

        res.status(errToReport.status).json({
          requestId,
          error: errToReport,
        });
        return;
      }

      const {
        text: fullText,
        model: usedModel,
        providerId: usedProviderId,
        failoverUsed,
        failoverFromProvider,
        failoverNotice,
      } = finalResult;

      timeToFirstTokenMs = Date.now() - startMs;
      charCount = fullText.length;

      if (wantsStream) {
        writeSseEvent(res, {
          type: 'stage',
          stage: 'generating',
          requestId,
          providerId: usedProviderId,
          providerLabel: PROVIDER_LABELS_RU[usedProviderId],
          model: usedModel,
          failoverUsed,
          failoverFromProvider,
          failoverNotice,
        });

        const chunks = splitTextIntoChunks(fullText, STREAM_CHUNK_SIZE_CHARS);
        chunkCount = chunks.length;

        for (const chunkText of chunks) {
          if (clientDisconnected) break;
          writeSseEvent(res, {
            type: 'delta',
            text: chunkText,
          });
        }

        if (!clientDisconnected) {
          writeSseEvent(res, {
            type: 'stage',
            stage: 'finishing',
            requestId,
            providerId: usedProviderId,
            providerLabel: PROVIDER_LABELS_RU[usedProviderId],
            model: usedModel,
            failoverUsed,
            failoverFromProvider,
            failoverNotice,
          });

          const totalDurationMs = Date.now() - startMs;
          writeSseEvent(res, {
            type: 'done',
            requestId,
            providerId: usedProviderId,
            providerLabel: PROVIDER_LABELS_RU[usedProviderId],
            model: usedModel,
            failoverUsed,
            failoverFromProvider,
            failoverNotice,
            metrics: {
              requestId,
              durationMs: totalDurationMs,
              timeToFirstTokenMs,
              chunkCount,
              charCount,
            },
          });
        }

        recordSafeDiagnostic({
          requestId,
          timestampIso: new Date().toISOString(),
          schoolId: body.schoolId,
          mode: body.mode,
          providerId: usedProviderId,
          model: usedModel,
          failoverUsed,
          generationMethod: 'generateContent_sse',
          status: clientDisconnected ? 'aborted' : 'ok',
          durationMs: Date.now() - startMs,
          timeToFirstTokenMs,
          chunkCount,
          charCount,
          historyMessagesSent: trimmedGeminiMessages.length,
          documentsSent: docsCount,
          systemPromptChars: systemInstruction.length,
        });
        return;
      }

      // Non-streaming JSON mode
      chunkCount = 1;
      const totalDurationMs = Date.now() - startMs;
      recordSafeDiagnostic({
        requestId,
        timestampIso: new Date().toISOString(),
        schoolId: body.schoolId,
        mode: body.mode,
        providerId: usedProviderId,
        model: usedModel,
        failoverUsed,
        generationMethod: 'generateContent_json',
        status: 'ok',
        durationMs: totalDurationMs,
        timeToFirstTokenMs,
        chunkCount: 1,
        charCount,
        historyMessagesSent: trimmedGeminiMessages.length,
        documentsSent: docsCount,
        systemPromptChars: systemInstruction.length,
      });

      res.json({
        requestId,
        text: fullText,
        providerId: usedProviderId,
        providerLabel: PROVIDER_LABELS_RU[usedProviderId],
        model: usedModel,
        failoverUsed,
        failoverFromProvider,
        failoverNotice,
        metrics: {
          requestId,
          durationMs: totalDurationMs,
          timeToFirstTokenMs,
          chunkCount: 1,
          charCount,
        },
      });
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      if (wantsStream && res.headersSent && !res.writableEnded) {
        try {
          res.end();
        } catch {
          // ignore close errors
        }
      }
    }
  };

  app.post('/api/gemini/chat', handleAiChatRequest);
  app.post('/api/ai/chat', handleAiChatRequest);

  // Gemini TTS Speech Generation & Model Status endpoints
  app.get('/api/voice/models', (_req: Request, res: Response) => {
    const isConfigured = isGeminiApiKeyConfigured();
    res.json({
      configured: isConfigured,
      models: [
        {
          id: 'gemini-3.8-flash-lite-tts',
          name: 'Gemini 3.8 Flash-Lite TTS (Основная скоростная модель)',
          tier: 'standard',
          paidTierRequired: false,
        },
        {
          id: 'gemini-3.8-flash-tts',
          name: 'Gemini 3.8 Flash TTS (Флагманская модель Voice Design)',
          tier: 'standard',
          paidTierRequired: false,
        },
      ],
      defaultModel: 'gemini-3.8-flash-lite-tts',
      paidTierRequired: false,
      samplePhrase:
        'Здравствуйте! Я Пиксель. Я помогу вам разобраться с задачами, найти нужные документы и освободить время для действительно важных дел.',
      sampleStyle:
        'Естественная русская разговорная речь. Спокойный, доброжелательный, уверенный голос. Мягкая интонация, умеренный темп, чёткая дикция, естественные паузы. Без роботизированной подачи, чрезмерной эмоциональности и рекламной интонации.',
      voices: [
        {
          id: 'Achernar',
          name: 'Achernar',
          description: 'Мягкая подача',
          sampleUrl: '/assets/audio/pixel_sample_achernar.wav',
        },
        {
          id: 'Sulafat',
          name: 'Sulafat',
          description: 'Тёплая подача',
          sampleUrl: '/assets/audio/pixel_sample_sulafat.wav',
        },
        {
          id: 'Vindemiatrix',
          name: 'Vindemiatrix',
          description: 'Деликатная подача',
          sampleUrl: '/assets/audio/pixel_sample_vindemiatrix.wav',
        },
        {
          id: 'Aoede',
          name: 'Aoede',
          description: 'Лёгкая, непринуждённая подача',
          sampleUrl: '/assets/audio/pixel_sample_aoede.wav',
        },
      ],
    });
  });

  interface TtsCacheItem {
    audioBase64: string;
    mimeType: string;
    model: string;
    voice: string;
    serviceTier: string;
    createdAt: number;
  }

  const ttsAudioCache = new Map<string, TtsCacheItem>();
  const MAX_TTS_CACHE_ITEMS = 150;
  const TTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  app.post('/api/voice/tts', async (req: Request, res: Response) => {
    try {
      const { text, voice, style, model } = req.body || {};
      const cleanText = typeof text === 'string' ? text.trim() : '';
      if (!cleanText) {
        return res.status(400).json({ error: 'Текст для синтеза речи пуст' });
      }

      if (!isGeminiApiKeyConfigured()) {
        return res.status(503).json({
          error: 'Серверный ключ GEMINI_API_KEY не настроен',
        });
      }

      const requestedVoice =
        typeof voice === 'string' && voice.trim() ? voice.trim() : 'Aoede';
      const requestedModel =
        typeof model === 'string' && model.trim()
          ? model.trim()
          : 'gemini-3.8-flash-lite-tts';
      const requestedStyle =
        typeof style === 'string' && style.trim()
          ? style.trim()
          : 'Естественная русская разговорная речь. Чуть более высокий, светлый, лёгкий и мягкий регистр. Приветливый, открытый, воодушевляющий тон, без искусственности и без писклявости.';

      // Generate robust SHA-256 cache key including text, model, voice and style
      const cacheKey = crypto
        .createHash('sha256')
        .update(
          `${cleanText}::${requestedModel}::${requestedVoice}::${requestedStyle}::audio/wav`
        )
        .digest('hex');

      // Check cache first (saves quota, eliminates latency, zero quota burn)
      const cached = ttsAudioCache.get(cacheKey);
      const now = Date.now();
      if (cached) {
        if (now - cached.createdAt < TTS_CACHE_TTL_MS) {
          return res.json({
            success: true,
            audioBase64: cached.audioBase64,
            mimeType: cached.mimeType,
            model: cached.model,
            voice: cached.voice,
            serviceTier: cached.serviceTier,
            fromCache: true,
          });
        }
        ttsAudioCache.delete(cacheKey);
      }

      const ai = getGenAITtsClient();
      const inputItem: {
        type: 'text';
        text: string;
        annotations?: Array<{ type: 'speech_metadata'; style: string }>;
      } = {
        type: 'text',
        text: cleanText,
      };
      if (requestedStyle) {
        inputItem.annotations = [
          { type: 'speech_metadata', style: requestedStyle },
        ];
      }

      const interaction = await ai.interactions.create(
        {
          model: requestedModel,
          input: [inputItem],
          response_format: { type: 'audio' },
          generation_config: {
            speech_config: [
              {
                language: 'ru-RU',
                voice: requestedVoice,
              },
            ],
          },
        },
        { timeout: 50000 }
      );

      const audio = interaction.output_audio;
      if (!audio?.data) {
        return res.status(502).json({
          error: 'Модель Gemini TTS вернула пустой аудио-ответ',
        });
      }

      const payload: TtsCacheItem = {
        audioBase64: audio.data,
        mimeType: audio.mime_type || 'audio/wav',
        model: interaction.model || requestedModel,
        voice: requestedVoice,
        serviceTier: interaction.service_tier || 'standard',
        createdAt: now,
      };

      // Evict expired or oldest items if exceeding bound
      if (ttsAudioCache.size >= MAX_TTS_CACHE_ITEMS) {
        let evicted = false;
        for (const [key, item] of ttsAudioCache.entries()) {
          if (now - item.createdAt >= TTS_CACHE_TTL_MS) {
            ttsAudioCache.delete(key);
            evicted = true;
          }
        }
        if (!evicted) {
          const oldestKey = ttsAudioCache.keys().next().value;
          if (oldestKey) ttsAudioCache.delete(oldestKey);
        }
      }
      ttsAudioCache.set(cacheKey, payload);

      res.json({
        success: true,
        ...payload,
      });
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err || '');
      const lower = rawMsg.toLowerCase();

      if (
        lower.includes('429') ||
        lower.includes('resource_exhausted') ||
        lower.includes('rate limit') ||
        lower.includes('too_many_requests') ||
        lower.includes('quota')
      ) {
        console.warn(
          `[TTS Rate Limit] Gemini TTS quota reached: ${rawMsg}`
        );
        return res.status(429).json({
          error: rawMsg || 'Лимит запросов к Gemini TTS API исчерпан. Используется встроенный синтез браузера.',
          code: 'RATE_LIMIT',
        });
      }

      if (
        lower.includes('abort') ||
        lower.includes('timeout') ||
        lower.includes('timed out')
      ) {
        console.warn(
          `[TTS Timeout] Gemini TTS generation timed out: ${rawMsg}`
        );
        return res.status(504).json({
          error: 'Превышено время ожидания ответа Gemini TTS API. Используется встроенный синтез браузера.',
          code: 'TIMEOUT',
        });
      }

      console.warn('[TTS Error]', rawMsg);
      res.status(500).json({
        error: `Сбой синтеза речи Gemini TTS: ${rawMsg}`,
        code: 'TTS_ERROR',
      });
    }
  });

  // Mount Vite middleware in development or static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[Server] KIBERONE & RENDERIA Business Assistant running on http://0.0.0.0:${PORT} (Primary Model: ${GEMINI_MODEL})`
    );
  });
}

startServer();
