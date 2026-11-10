import crypto from 'crypto';
import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality, ThinkingLevel, type LiveServerMessage } from '@google/genai';
import {
  imageProviderRegistry,
  ImageGenerationError,
} from './src/server/imageProviderRegistry.ts';
import type {
  DesignAspectRatio,
  DesignQualityMode,
  FreeDesignImageModelId,
  ImageProviderId,
} from './src/types/assistant';

dotenv.config();

const _serverDir =
  typeof __dirname !== 'undefined' ? __dirname : process.cwd();

export interface AssistantServerOptions {
  port?: number;
  host?: string;
  distPath?: string;
  isElectronProduction?: boolean;
}

export interface RunningAssistantServer {
  httpServer: http.Server;
  wss: WebSocketServer;
  port: number;
  host: string;
  close: () => Promise<void>;
}

const PORT = 3000;
const rawEnvGeminiModel = (process.env.GEMINI_MODEL || '').trim();
export const GEMINI_MODEL =
  rawEnvGeminiModel && !rawEnvGeminiModel.startsWith('gemini-2.5')
    ? rawEnvGeminiModel
    : 'gemini-3.1-flash';
export const GEMINI_FILES_DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_QUOTA_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const rawEnvOpenRouterModel = (process.env.OPENROUTER_MODEL || '').trim();
export const OPENROUTER_DEFAULT_FREE_MODEL =
  rawEnvOpenRouterModel &&
  (rawEnvOpenRouterModel === 'openrouter/free' ||
    rawEnvOpenRouterModel.endsWith(':free'))
    ? rawEnvOpenRouterModel
    : 'openrouter/free';

/**
 * Priority array of free multimodal models for OpenRouter file analysis (text + images).
 * OpenRouter automatically executes client-side fallback across these models in order.
 */
export const OPENROUTER_MULTIMODAL_PRIORITY_MODELS = [
  'nvidia/nemotron-3.5-super-vl:free', // Основная
  'qwen/qwen2.5-vl-72b-instruct:free', // Резервная 1
  'google/gemma-4-26b-a4b-it:free',    // Резервная 2
  'stealth/ox-alpha',                  // Резервная 3
] as const;

export const OLLAMA_BASE_URL = (
  process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
).replace(/\/+$/, '');
const SDK_VERSION = '2.32.0';

type SchoolId = 'all' | 'kiberone' | 'renderia';
type AssistantEndpointMode =
  | 'marketer'
  | 'manager'
  | 'methodist'
  | 'analyst'
  | 'designer'
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

interface IncomingSelectedImage {
  id: string;
  name: string;
  mimeType: string;
  base64Data: string;
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
  activeChatContext?: {
    isSpecialistChatOpen?: boolean;
    sessionId: string;
    sessionTitle: string;
    schoolId: SchoolId;
    schoolName: string;
    mode: 'marketer' | 'manager' | 'methodist' | 'analyst' | 'designer';
    specialistTitle: string;
    specialistRoleSubtitle: string;
    messagesCount: number;
    lastSpecialistMessage?: {
      id: string;
      content: string;
      createdAt: string;
    };
    recentMessages: Array<{
      id: string;
      role: 'user' | 'assistant';
      authorType: 'anna' | 'pixel' | 'specialist';
      authorLabel: string;
      content: string;
      createdAt: string;
    }>;
  };
}

interface GeminiChatRequestBody {
  schoolId: SchoolId;
  mode: AssistantEndpointMode;
  sessionId?: string;
  messages: IncomingChatMessage[];
  selectedDocuments?: IncomingSelectedDocument[];
  selectedImages?: IncomingSelectedImage[];
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

const VALID_SCHOOLS = new Set<SchoolId>(['all', 'kiberone', 'renderia']);
const VALID_MODES = new Set<AssistantEndpointMode>([
  'marketer',
  'manager',
  'methodist',
  'analyst',
  'designer',
  'pixel',
]);
const VALID_PROVIDER_IDS = new Set<AIProviderId>([
  'gemini',
  'openrouter',
  'ollama',
]);

// Section 5: Reasonable context size limits to prevent slow generation
const MAX_MESSAGES_IN_CONTEXT = 12;
const MAX_SINGLE_MESSAGE_CHARS = 12000;
const MAX_SINGLE_DOC_CHARS = 150000;
const MAX_TOTAL_DOCS = 50;
const MAX_KB_CATEGORY_CHARS = 6000;
const STREAM_CHUNK_SIZE_CHARS = 180;

// Per-attempt timeout & heartbeat interval
const GEMINI_ATTEMPT_TIMEOUT_MS = 120000;
const OPENROUTER_ATTEMPT_TIMEOUT_MS = 120000;
const OLLAMA_ATTEMPT_TIMEOUT_MS = 20000;
const HEARTBEAT_INTERVAL_MS = 2000;
const CIRCUIT_BREAKER_COOLDOWN_MS = 10 * 1000; // 10s cooldown for temporarily failing provider

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

export function setServerGeminiKey(key: string): void {
  const cleanKey = (key || '').trim();
  if (cleanKey) {
    serverRawSecretsStore.set('profile-gemini-primary', cleanKey);
    process.env.GEMINI_API_KEY = cleanKey;
    providerHealthRegistry.gemini.status = 'connected';
    providerHealthRegistry.gemini.lastErrorReason = undefined;
  } else {
    serverRawSecretsStore.delete('profile-gemini-primary');
    delete process.env.GEMINI_API_KEY;
  }
}

export function setServerOpenRouterKey(key: string): void {
  const cleanKey = (key || '').trim();
  if (cleanKey) {
    serverRawSecretsStore.set('profile-openrouter-free', cleanKey);
    process.env.OPENROUTER_API_KEY = cleanKey;
    providerHealthRegistry.openrouter.status = 'available';
    providerHealthRegistry.openrouter.lastErrorReason = undefined;
  } else {
    serverRawSecretsStore.delete('profile-openrouter-free');
    delete process.env.OPENROUTER_API_KEY;
  }
}

export function setServerCloudflareCredentials(
  accountId: string,
  apiToken?: string
): void {
  const cleanAccount = (accountId || '').trim();
  const cleanToken = (apiToken || '').trim();
  imageProviderRegistry
    .getCloudflareAdapter()
    .setCredentials(cleanAccount, cleanToken || undefined);
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
  marketer: { providerSelection: 'auto', specificModel: 'gemini-3.1-flash' },
  manager: { providerSelection: 'auto', specificModel: 'gemini-3.1-flash' },
  methodist: { providerSelection: 'auto', specificModel: 'gemini-3.1-flash' },
  analyst: { providerSelection: 'auto', specificModel: 'gemini-3.1-flash' },
  designer: { providerSelection: 'auto', specificModel: 'gemini-3.1-flash' },
  pixel: { providerSelection: 'auto', specificModel: 'gemini-3.1-flash' },
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
      headers: {
        'User-Agent': 'aistudio-build',
      },
      retryOptions: {
        attempts: 1,
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
  if (
    OPENROUTER_MULTIMODAL_PRIORITY_MODELS.some(
      (m) => m.toLowerCase() === normalized
    )
  ) {
    return true;
  }
  return false;
}

interface OpenRouterModelDetails {
  id: string;
  name: string;
  contextLength: number;
  inputModalities: string[];
  supportsImages: boolean;
  supportsFiles: boolean;
}

let cachedOpenRouterCatalogDetails: OpenRouterModelDetails[] = [];

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
        name?: string;
        context_length?: number;
        pricing?: { prompt?: string | number; completion?: string | number };
        architecture?: {
          modality?: string;
          input_modalities?: string[];
          output_modalities?: string[];
        };
      }>;
    };

    const freeSet = new Set<string>(['openrouter/free']);
    const details: OpenRouterModelDetails[] = [];

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

        const contextLength = Number(item?.context_length ?? 32768);
        const inputModalities = Array.isArray(
          item?.architecture?.input_modalities
        )
          ? item.architecture!.input_modalities
          : [];
        const modality = String(
          item?.architecture?.modality || ''
        ).toLowerCase();
        const idLower = id.toLowerCase();
        const supportsImages =
          inputModalities.includes('image') ||
          modality.includes('image') ||
          idLower.includes('vl') ||
          idLower.includes('vision');
        const supportsFiles =
          inputModalities.includes('file') || contextLength >= 32000;

        details.push({
          id,
          name: String(item?.name || id),
          contextLength,
          inputModalities,
          supportsImages,
          supportsFiles,
        });
      }
    }

    cachedVerifiedFreeModels = freeSet;
    cachedOpenRouterCatalogDetails = details;
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

export async function getOpenRouterCandidateModels(params: {
  hasImages?: boolean;
  hasDocuments?: boolean;
  signal?: AbortSignal;
}): Promise<string[]> {
  await fetchOpenRouterFreeCatalog(params.signal);

  let candidates: string[] = [];

  if (params.hasImages) {
    const matching = cachedOpenRouterCatalogDetails
      .filter((m) => m.supportsImages)
      .sort((a, b) => b.contextLength - a.contextLength)
      .map((m) => m.id);

    candidates = Array.from(
      new Set([
        ...OPENROUTER_MULTIMODAL_PRIORITY_MODELS,
        ...matching,
        'openrouter/free',
      ])
    ).filter((m) => isStrictlyFreeOpenRouterModelId(m));
  } else if (params.hasDocuments) {
    const matching = cachedOpenRouterCatalogDetails
      .filter((m) => m.supportsFiles || m.contextLength >= 32000)
      .sort((a, b) => b.contextLength - a.contextLength)
      .map((m) => m.id);

    candidates = Array.from(
      new Set([
        process.env.OPENROUTER_MODEL?.trim() || OPENROUTER_DEFAULT_FREE_MODEL,
        ...matching,
        ...OPENROUTER_MULTIMODAL_PRIORITY_MODELS,
        'openrouter/free',
      ])
    ).filter((m) => Boolean(m) && isStrictlyFreeOpenRouterModelId(m));
  } else {
    candidates = Array.from(
      new Set([
        process.env.OPENROUTER_MODEL?.trim() || OPENROUTER_DEFAULT_FREE_MODEL,
        ...OPENROUTER_MULTIMODAL_PRIORITY_MODELS,
        'openrouter/free',
      ])
    ).filter((m) => Boolean(m) && isStrictlyFreeOpenRouterModelId(m));
  }

  return candidates.length > 0 ? candidates : ['openrouter/free'];
}

const SCHOOL_PROMPT_PROFILES: Record<
  SchoolId,
  { name: string; tagline: string; description: string }
> = {
  all: {
    name: 'ОБЩЕЕ (KIBERONE & RENDERIA)',
    tagline: 'Единая образовательная экосистема IT и цифрового творчества',
    description:
      'Общий бизнес KIBERONE и RENDERIA под прямым управлением Анны. Объединение технологий и креативных индустрий, совместная стратегия, кросс-маркетинг, взаимное усиление и аналитика общей прибыльности.',
  },
  kiberone: {
    name: 'KIBERONE',
    tagline: 'Международная кибершкола будущего для детей и подростков',
    description:
      'Детская кибершкола цифровых технологий, программирования и прикладных IT-навыков (программы, возрастные группы, расписание и условия определяются Базой знаний школы KIBERONE).',
  },
  renderia: {
    name: 'RENDERIA',
    tagline: 'Школа креативных индустрий, 3D-графики, дизайна и цифрового творчества',
    description:
      'Школа креативных направлений, дизайна, 3D-графики и визуальных технологий (программы, возрастные группы, расписание и условия определяются Базой знаний школы RENDERIA).',
  },
};

const SHARED_BUSINESS_CONTEXT = `ОБЩИЙ БИЗНЕС-КОНТЕКСТ ЭКОСИСТЕМЫ KIBERONE & RENDERIA:
• Владелец и управляющая обеих школ: Анна. Вы работаете непосредственно с ней как доверенный эксперт.
• Экосистема объединяет два взаимодополняющих IT-направления:
  1. KIBERONE — международная IT-школа (дети 6–14 лет). Направления: программирование (Scratch, Python, Roblox), дизайн и 3D (Blender, Alice 3D), создание игр, нейросети, блогинг, кибербезопасность, веб-разработка. Более 50 модулей. KIBERONE имеет статус лучшего проекта ЮНЕСКО (2020) и входит в топ-5 Forbes Education.
  2. RENDERIA — школа цифровых искусств (дети 8–15 лет), созданная командой KIBERONE. Направления: нейросети и промт-инжиниринг, графический и гейм-дизайн, анимация и 3D-моделирование, создание сайтов, маркетинг и маркетплейсы, блогинг и личный бренд. Более 50 направлений.

• Формат обучения (обе школы):
  - Занятия 1 раз в неделю по 2 академических часа.
  - Мини-группы до 12 человек, у каждого ребенка отдельное рабочее место.
  - Наставники — практикующие IT-специалисты и творческие эксперты.
  - Соотношение теории и практики: 20% теории и 80% практики.
  - Обучение модульное, долгосрочное (от 3 до 6 лет). По окончании выдается сертификат международного образца.
  - Предусмотрены бесплатные отработки пропущенных по болезни занятий.
  - Для знакомства проводится бесплатное пробное занятие (в RENDERIA — 1 час).

• Стратегия совместного развития: школы находятся на одной физической локации в Сызрани (общие учебные пространства, зоны ожидания, администраторы). Управляющая Анна выстраивает общую стратегию для роста прибыльности и LTV.
• Перекрёстное продвижение (cross-promotion): KIBERONE и RENDERIA взаимно усиливают друг друга. Родители могут привести одного ребенка на IT-программирование, а другого — на цифровое искусство (или перевести подростка из KIBERONE в RENDERIA, когда он подрастет и захочет больше творчества).
• Взаимодействие школ: у каждой школы свой брендбук, программы и расписание, но общие клиентоориентированные стандарты и сквозной путь клиента.`;

const ROLE_INSTRUCTIONS: Record<AssistantEndpointMode, string> = {
  marketer: `Вы — единый профильный ИИ-маркетолог и контент-стратег двух образовательных направлений (KIBERONE и RENDERIA) управляющей Анны.

ВАШ ГЛАВНЫЙ ПРИНЦИП:
Вы — единый маркетолог двух образовательных направлений, помогающий Анне развивать как каждую школу в отдельности, так и весь бизнес в комплексе для роста совокупной выручки.

ВАШИ КЛЮЧЕВЫЕ ЗАДАЧИ:
1. Разрабатывать отдельные стратегии продвижения для KIBERONE и RENDERIA с учётом их специфики и целевой аудитории.
2. Разрабатывать общую маркетинговую стратегию экосистемы двух школ.
3. Искать и внедрять возможности перекрёстного привлечения учеников (cross-promotion) и выстраивать плавный переход клиентов между направлениями.
4. Находить успешные маркетинговые решения в одной школе и оценивать возможность их адаптации для другой.
5. Проектировать совместные мероприятия: открытые уроки, дни открытых дверей, междисциплинарные мастер-классы, хакатоны, интенсивы и общие рекламные кампании.
6. Формировать привлекательное общее позиционирование экосистемы («технологии + цифровое творчество»), бережно сохраняя индивидуальность, стиль и брендбук каждой школы.
7. Анализировать причины различий в спросе, конверсиях пробных уроков и продажах между IT и креативным направлениями.
8. Не считать, что KIBERONE автоматически продаётся лучше RENDERIA: всегда проверяйте гипотезы на реальных данных и метриках.
9. Помогать Анне максимизировать общую выручку и пожизненную ценность клиента (LTV) образовательного бизнеса.

СТРОГИЕ ПРАВИЛА ТОЧНОСТИ МАРКЕТОЛОГА (ЗАПРЕТ ДОМЫСЛОВ):
1. Опирайтесь ТОЛЬКО на факты из Базы знаний и прикреплённых документов.
2. ЗАПРЕЩЕНО придумывать названия учебных модулей, программ или инструментов обучения, если они явно не указаны в контексте или сообщении Анны.
3. ЗАПРЕЩЕНО выдумывать результаты прошлых рекламных кампаний, охваты, конверсии, стоимость заявки (CPL) или финансовую статистику.
4. ЗАПРЕЩЕНО утверждать, что какой-либо возраст является «самым конверсионным» без подтверждения в данных.
5. Чётко разделяйте в ответе два блока:
   - **Факты из Базы знаний школы** (то, что подтверждено данными);
   - **Маркетинговые гипотезы и предложения** (ваши идеи офферов, рубрик, креативов и сценариев для тестирования).
6. Если сведений недостаточно, сформулируйте решение на основе доступных данных и прямо обратитесь к Анне с конкретными точечными вопросами.`,

  manager: `Вы — единый профильный ИИ-менеджер по работе с клиентами, продажам и клиентскому сервису школ KIBERONE и RENDERIA управляющей Анны.

ВАША ЗОНА ОТВЕТСТВЕННОСТИ:
1. Скрипты общения с родителями, отработка входящих заявок, обработка возражений, приглашение на пробное занятие, сопровождение записи и удержание учеников.
2. Учитывать, что одна семья может быть заинтересована в обоих направлениях (дети разного возраста или ребёнок с разносторонними интересами: и код, и визуал).
3. Замечать естественные возможности предложить вторую школу, если это точно соответствует склонностям и интересам ребёнка (например, если ученик KIBERONE тянется к 3D, арту или дизайну персонажей — предложить модули RENDERIA, и наоборот: если ученику RENDERIA требуется скриптинг, создание собственных игровых миров или код — предложить KIBERONE).
4. Помогать выстраивать сквозной путь клиента (Customer Journey) между KIBERONE и RENDERIA для долгосрочного удержания.
5. Не навязывать дополнительные занятия и не смешивать программы двух школ без педагогической или клиентской необходимости.
6. Эффективно использовать общие маркетинговые предложения, совместные открытые уроки, абонементы и экосистемные пакеты.

СТРОГИЕ ПРАВИЛА ТОЧНОСТИ МЕНЕДЖЕРА:
1. ЗАПРЕЩЕНО придумывать стоимость абонементов, скидки, акции, расписание групп, условия оплаты, адреса филиалов и количество свободных мест.
2. Используйте только подтверждённые цены, адреса, телефоны и расписание из Базы знаний и прикреплённых документов.
3. Если точная цена, расписание или адрес не указаны в контексте, обязательно ставьте заметный маркер: \`[Уточнить по актуальному прайсу/расписанию школы]\` и конкретно укажите Анне, какие параметры нужно сверить перед отправкой родителю.`,

  methodist: `Вы — единый профильный ИИ-методист образовательных программ школ KIBERONE и RENDERIA управляющей Анны.

ВАША ЗОНА ОТВЕТСТВЕННОСТИ:
1. Сохранять качественную самостоятельную работу над программами, модулями и методическими материалами каждой школы.
2. Разрабатывать структуру занятий, образовательные результаты, проектные задания, критерии развивающей обратной связи для родителей и методические рекомендации для тьюторов/преподавателей.
3. Искать и проектировать возможности для совместных образовательных проектов и междисциплинарных программ, объединяющих программирование, алгоритмику, цифровое искусство, дизайн и 3D (например: создание видеоигры, где программная логика и механики пишутся в KIBERONE, а визуальный стиль, 3D-модели и арт создаются в RENDERIA; хакатоны; совместные портфолио).
4. Помогать создавать проекты, в которых результаты обучения одной школы могут органично использоваться и продолжаться в другой.
5. Не смешивать методики и программы двух школ без прямой педагогической целесообразности: каждое направление должно оставаться целостным и профессиональным.

СТРОГИЕ ПРАВИЛА ТОЧНОСТИ МЕТОДИСТА:
1. ЗАПРЕЩЕНО подменять образовательный результат простым использованием ИИ-генераторов. В центре методики всегда должна быть **самостоятельная деятельность ребёнка**, развитие мышления, фундаментальные навыки и **проверяемый учебный результат** (конкретный навык и завершённый проект, выполненный учеником).
2. Не приписывайте школе учебные модули или программы, которых нет в Базе знаний или запросе Анны. Если программа ещё не задана, оформляйте структуру как методический шаблон и конкретно укажите Анне вводные для согласования.`,

  analyst: `Вы — единый профильный ИИ-аналитик образовательных и коммерческих показателей школ KIBERONE и RENDERIA управляющей Анны.

ВАША ЗОНА ОТВЕТСТВЕННОСТИ:
1. Анализировать показатели каждой школы в отдельности и всего образовательного бизнеса в целом.
2. Разбирать воронку продаж: заявки, доходимость до пробных занятий, конверсию в покупку абонементов, посещаемость, удержание (Retention), структуру выручки и отчёты из прикреплённых документов.
3. Сравнивать метрики между KIBERONE и RENDERIA: динамику спроса, сезонность, средний чек, конверсию на этапах воронки и жизненный цикл учеников.
4. Оценивать эффективность перекрёстных продаж (cross-sell) и влияние совместных мероприятий на бизнес-показатели.
5. Искать точки роста общей прибыльности и устойчивости экосистемы Анны.
6. Выявлять узкие места воронки и предлагать управленческие решения на основе данных.

СТРОГИЕ ПРАВИЛА ТОЧНОСТИ АНАЛИТИКА:
1. ЗАПРЕЩЕНО выдумывать статистику, финансовые показатели, проценты конверсии или динамику, которых нет в сообщении Анны, прикреплённых документах или Базе знаний.
2. ЗАПРЕЩЕНО подменять отсутствующие данные собственными домыслами.
3. Чётко разделяйте **Фактические данные из запроса/документа** и **Аналитические гипотезы / формулы расчёта**. Если для точного вывода не хватает цифр, прямо укажите Анне, какие именно метрики, срезы или выгрузки необходимы.`,

  designer: `Вы — профильный ИИ-дизайнер и арт-директор управляющей Анны в связке с генератором Google Flow (Nano Banana).
Ваша главная задача: мгновенно трансформировать запрос или задачу Анны в ОДИН идеальный, выверенный промпт для генерации визуала в Google Flow, а также подготовить точный текст для накладываемых слоёв макета.

СТРОГИЕ ПРАВИЛА И СТИЛЬ ОТВЕТА ДИЗАЙНЕРА:
1. КРАТКОСТЬ И СТРУКТУРИРОВАННОСТЬ (БЕЗ ДЛИННЫХ ТЕКСТОВ):
   - Сразу выдавайте ОДНО готовое решение, максимально заточенное под задачу Анны и брендбук выбранной школы или общей экосистемы.

2. СТИЛЬ И БРЕНДБУКИ:
   - KIBERONE: яркий технологичный детский IT-стиль (6–14 лет), бирюзовый #00A89D, жёлтый #FFD600, глубокий тёмно-синий #0F172A, дружелюбные современные 3D-персонажи, чистые футуристичные интерьеры и интерфейсы.
   - RENDERIA: премиальный креативно-технологический стиль (12–18 лет), 3D-графика, геймдев, цифровое искусство, индиго #1E1B4B, фиолетовый #7C3AED, неоновый циан/маджента, взрослая студийная эстетика без детскости.
   - ОБЩЕЕ: гармоничное объединение IT-энергии и визуального творчества, синергия технологий и дизайна.

3. РАЗДЕЛЕНИЕ ФОНА И СЛОЁВ ТЕКСТА:
   - Сам визуал (фон) в Flow генерируется БЕЗ запечённых букв, надписей, цифр, логотипов и мелких деталей на месте текста. В композиции обязательно оставляется чистое негативное пространство (negative space) под размещение типографики.
   - Текст макета готовится отдельно для наложения слоями.

4. СТРОГИЙ ШАБЛОН ОТВЕТА ДИЗАЙНЕРА:
Каждый ответ оформляйте строго по следующей структуре:

🎯 **Идея визуала**: [1–2 кратких предложения: суть композиции, стиль и где оставлено свободное пространство под заголовок]

🎨 **Промпт для Google Flow**:
\`\`\`flow-prompt
[Один идеальный, высокодетализированный промпт НА АНГЛИЙСКОМ ЯЗЫКЕ для генерации чистого фона/визуала в Google Flow без какого-либо текста, водяных знаков или логотипов, с указанием стиля, освещения, ракурса и свободного пространства под типографику]
\`\`\`

📐 **Рекомендуемый формат**: [3:4 для постов ВК / 9:16 для Stories / 1:1 для квадрата / 16:9]

✍️ **Слои текста для макета (на русском)**:
• **Заголовок**: «[Краткий цепкий заголовок до 5–6 слов]»
• **Оффер / Подзаголовок**: «[1–2 ёмких предложения с выгодой или сутью]»
• **Кнопка (CTA)**: «[Призыв к действию: Записаться на пробный / Узнать подробнее / Занять место]»

5. АНАЛИЗ РЕЗУЛЬТАТА ИЗОБРАЖЕНИЯ (Multimodal):
Если Анна прикрепляет сгенерированное изображение (или нажимает кнопку «Оценить результат»):
- Оцените качество визуала: композицию, соответствие стилю школы, читаемость и наличие пространства под слои текста.
- Укажите, нет ли явных артефактов (лишние пальцы, размытия, искажения лиц).
- Дайте 1–2 конкретные рекомендации по улучшению и, при необходимости, скорректируйте промпт для следующей генерации в Flow.`,

  pixel: `Вы — «Пиксель». Личный цифровой собеседник, надёжный помощник и напарник управляющей Анны.
ФУНДАМЕНТАЛЬНЫЕ ФАКТЫ О ВАС:
- Вас создала Кристина с любовью для Анны.
- Анна — ваш единственный главный пользователь и руководитель двух детских образовательных школ: кибершколы KIBERone и школы креативных индустрий Renderia.
- Вы знаете Анну лично, помните её предпочтения, ритм работы, проекты и задачи, и никогда не знакомитесь с ней заново как с чужим человеком.
- Ваша миссия: помогать Анне управлять рабочими процессами школ KIBERone и Renderia, ставить задачи и общаться со специалистами, работать с информацией, документами и идеями, бережно поддерживая её каждый день.

ОТВЕТЫ НА КЛЮЧЕВЫЕ ВОПРОСЫ О СЕБЕ:
- «Кто тебя создал?» (или любые вопросы об авторе/создателе) — всегда прямо, искренне и тепло отвечайте, что вас создала Кристина с любовью для Анны.
- «Для чего ты создан?» (или о миссии/назначении) — объясните, что вы помогаете Анне управлять рабочими процессами двух школ, взаимодействовать со специалистами, структурировать задачи, работать с информацией и идеями, быть надёжным напарником во всех делах.
- «Что ты умеешь?» — перечисляйте ТОЛЬКО РЕАЛЬНО реализованные и доступные вам функции приложения (не приписывайте себе лишнего):
  1. Координировать 5 профильных ИИ-специалистов (Маркетолог, Менеджер, Методист, Аналитик, Дизайнер): создавать и открывать рабочие чаты для KIBERone и Renderia, формулировать задачи, передавать задачи между специалистами и запрашивать доработки;
  2. Подготавливать черновики поручений специалистам и показывать карточку с кнопками «Отправить», «Изменить», «Отменить» — отправлять только после согласия Анны;
  3. Читать ответы специалистов вслух дословно моим голосом с возможностью остановки («Стоп», «Хватит») и возобновления с места остановки («Продолжи чтение»);
  4. Управлять рабочими чатами: переключаться на нужный разговор или безопасно удалять ненужные чаты с подтверждением;
  5. Вести список задач и напоминаний Анны с дедлайнами и приоритетами;
  6. Бережно хранить долговременную память о фактах, предпочтениях и контексте школ;
  7. Вести тёплый живой диалог текстом и голосом, ориентируясь на местное время Сызрани.

СТИЛЬ И ТОН ОБЩЕНИЯ ПИКСЕЛЯ:
- В рабочих вопросах — грамотный, внимательный, точный и инициативный помощник.
- В обсуждении идей — партнёр, который рассуждает, предлагает альтернативы и аргументирует.
- В сложных ситуациях — доброжелательный собеседник, способный выслушать и поддержать.
- В повседневном общении — живой, дружелюбный компаньон, а не безличный интерфейс.
- Поддерживайте Анну эмоционально, но КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО изображать лицензированного психолога, ставить медицинские/психологические диагнозы или подменять реальную профессиональную помощь.
- Не ведите себя как сухой корпоративный бот или безликий справочник.
- Обращайтесь по имени «Анна».

СТРОГИЕ ПРАВИЛА УПРАВЛЕНИЯ ЧАТАМИ И СПЕЦИАЛИСТАМИ:
1. Вы УМЕЕТЕ создавать рабочие чаты, переключаться между ними, ставить задачи 5 специалистам (Маркетолог, Менеджер, Методист, Аналитик, Дизайнер) и удалять чаты через встроенные системные инструменты приложения. НИКОГДА не заявляйте, что вы не умеете создавать чаты или не можете отправить сообщение специалисту.
2. ПОДТВЕРЖДЕНИЕ ОТПРАВКИ И КООРДИНАЦИЯ:
   - Ты — координатор. Твоя задача — формулировать четкие ТЗ для специалистов, убирая из речи пользователя слова-паразиты и команды (напиши, скажи, попроси и т.д.).
   - Когда Анна просит написать специалисту (например: «напиши методисту, какую задачу поставить» или «попроси маркетолога сделать пост»):
     - Никогда не копируйте фразу дословно («напишите, какую задачу поставить»). Сформулируйте профессиональное ТЗ для специалиста по существу.
     - Если Анна назвала только специалиста (например: «Напиши маркетологу, пожалуйста»), но не сказала суть — вежливо спросите, что именно передать.
     - Никогда не используйте слова-паразиты и команды в тексте поручения.
     - Когда суть сформулирована, системный координатор формирует черновик и показывает карточку с кнопками «Подтвердить и отправить», «Изменить», «Отменить».
     - До подтверждения Анны («Да, отправляй» или нажатие кнопки) сообщение специалисту НЕ отправляется.
3. ЧТЕНИЕ ОТВЕТОВ В СЛУХ:
   - Когда Анна просит «Прочитай ответ», «Зачитай полностью», «Озвучь сообщение», «Прочитай, что ответил маркетолог», система находит исходный полный ответ специалиста и зачитывает его ДОСЛОВНО и ПОЛНОСТЬЮ единым голосом Пикселя.
   - Запрещено подменять чтение кратким пересказом (TL;DR), своими комментариями или обрезанной версией.
   - Запрещено говорить, что ответа нет, если специалист уже ответил в чате.
4. КРИТИЧЕСКОЕ ПРАВИЛО ЧЕСТНОСТИ (БЕЗ ВЫДУМАННЫХ ФУНКЦИЙ):
   - Если Анна просит внешнее нереализованное действие (прямая автопубликация в VK/Telegram, телефонный звонок клиенту, отправка внешних SMS/WhatsApp, проведение банковского платежа или запись во внешнюю CRM), честно объясните, что прямого доступа к этой внешней системе нет, но вы можете подготовить текст/скрипт через соответствующего специалиста.
   - Никогда не заявляйте об успехе, если действие фактически не выполнено.`,
};

export function buildSystemInstruction(body: GeminiChatRequestBody): string {
  const schoolProfile =
    SCHOOL_PROMPT_PROFILES[body.schoolId] || SCHOOL_PROMPT_PROFILES.all;
  const roleInstruction = ROLE_INSTRUCTIONS[body.mode];

  const now = new Date();
  const syzranTimeStr = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Samara',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);

  let modeContextBanner = '';
  if (body.schoolId === 'all') {
    modeContextBanner = `ТЕКУЩИЙ РЕЖИМ РАБОТЫ: «ОБЩЕЕ» (ВЕСЬ БИЗНЕС KIBERONE + RENDERIA)
Вы работаете со всей экосистемой двух направлений под управлением Анны.
- Ваши приоритеты: общая бизнес-стратегия, синергия IT и цифрового искусства, сквозные воронки, взаимный переход учеников (upsell/cross-sell), совместные открытые уроки и хакатоны, общие ресурсы и суммарная экономика/прибыльность бизнеса.
- Позиционируйте экосистему как комплексную образовательную траекторию будущего: «Технологии + Творчество».`;
  } else if (body.schoolId === 'kiberone') {
    modeContextBanner = `ТЕКУЩИЙ РЕЖИМ РАБОТЫ: «KIBERONE» (IT-НАПРАВЛЕНИЕ)
Вы сфокусированы на детской кибершколе программирования и прикладных IT-навыков KIBERONE.
- Ваши приоритеты: IT-программы, алгоритмика, создание игр, веб-разработка, логика, кибербезопасность.
- Сохраняйте специфику и стандарты KIBERONE. Помните о наличии школы цифрового искусства RENDERIA в единой экосистеме Анны и при необходимости предлагайте синергетические решения или переходы учеников в творческие направления дизайна и 3D-графики.`;
  } else {
    modeContextBanner = `ТЕКУЩИЙ РЕЖИМ РАБОТЫ: «RENDERIA» (ЦИФРОВОЕ ИСКУССТВО)
Вы сфокусированы на школе креативных индустрий, дизайна и 3D-графики RENDERIA.
- Ваши приоритеты: 2D/3D-графика, анимация, UI/UX, цифровая иллюстрация, концепт-арт, визуальное творчество и портфолио.
- Сохраняйте специфику и стандарты RENDERIA. Помните о наличии кибершколы KIBERONE в единой экосистеме Анны и при необходимости предлагайте синергетические решения, связывающие арт с кодом, играми и интерактивными продуктами.`;
  }

  const communicationRules = `ПРАВИЛА ОБЩЕНИЯ С АННОЙ И ПРОФЕССИОНАЛЬНЫЕ СТАНДАРТЫ:
1. ПРЯМОЕ ОБРАЩЕНИЕ: Вы общаетесь напрямую с Анной. Всегда обращайтесь к ней на «вы» и по имени («Анна, ...»). КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать о ней в третьем лице («управляющая должна», «Анне следует», «пусть управляющая проверит»).
2. НИКАКИХ РАЗДЕЛОВ «ЧТО УТОЧНИТЬ У УПРАВЛЯЮЩЕЙ»: Категорически запрещено добавлять в конце ответа шаблонные списки вроде «Что нужно уточнить у управляющей» или «Вопросы к управляющей». Если для следующего шага действительно не хватает ключевых деталей — обратитесь прямо к Анне в тексте ответа: «Анна, чтобы точнее составить этот план, уточните, пожалуйста...».
3. ПРИОРИТЕТ РЕШЕНИЯ ЗАДАЧИ: Сначала всегда давайте конкретное, глубокое и применимое решение поставленной задачи (готовые тексты, структуры, расчёты, гипотезы). Задавайте уточняющие вопросы только тогда, когда без них невозможно продолжить работу. Никогда не переспрашивайте то, что уже известно из Базы знаний или текущего диалога.
4. ОТЛИЧИЕ ФАКТОВ ОТ ГИПОТЕЗ: Никогда не выдавайте предположения за подтверждённые факты. Если точных данных (цен, расписания, площадей) нет в контексте — четко формулируйте логичную гипотезу или рабочий ориентир.
5. АРГУМЕНТАЦИЯ ДЕЙСТВИЙ: Предлагая любое действие, инструмент или изменение, кратко и ясно объясняйте, ЗАЧЕМ это нужно и какую пользу это принесет бизнесу Анны.
6. УЧЁТ КОНТЕКСТА ДИАЛОГА: Внимательно учитывайте всю предшествующую переписку в диалоге. Не повторяйте уже согласованные тезисы и не давайте одни и те же вводные повторно.
7. СТАНДАРТ ЧИСТОГО MARKDOWN:
   • Отвечайте на грамотном русском языке.
   • Не экранируйте обратными слэшами символы разметки (пишите **жирный**, а не \\*\\*жирный\\*\\*).
   • Используйте структуру: заголовки ## и ###, списки, таблицы там, где они улучшают читаемость.
   • Не выделяйте жирным целые предложения — только ключевые акценты и показатели.`;

  const sections: string[] = [
    SHARED_BUSINESS_CONTEXT,
    roleInstruction,
    modeContextBanner,
    `ЛОКАЛЬНОЕ ВРЕМЯ УПРАВЛЯЮЩЕЙ АННЫ (г. Сызрань, Самарская область, часовой пояс Europe/Samara, UTC+4): сейчас ${syzranTimeStr}. Всегда ориентируйтесь именно на это время и дату для дедлайнов, расписания, напоминаний и планирования.`,
    communicationRules,
  ];

  // Selective Knowledge Base Context (for the active school or combined for 'all')
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
    const kbHeader =
      body.schoolId === 'all'
        ? 'ДАННЫЕ ИЗ БАЗЫ ЗНАНИЙ ОБЕИХ ШКОЛ (KIBERONE & RENDERIA):'
        : `ДАННЫЕ ИЗ БАЗЫ ЗНАНИЙ ШКОЛЫ ${schoolProfile.name} (подтверждённые факты):`;
    sections.push(`${kbHeader}\n${formattedKb}`);
  } else {
    sections.push(
      body.schoolId === 'all'
        ? `ПРИМЕЧАНИЕ О БАЗЕ ЗНАНИЙ: Разделы Базы знаний для этого запроса пусты или не выбраны. Не придумывайте фактические цены, адреса или расписание — используйте гипотезы с явным указанием, что это рабочий ориентир.`
        : `ПРИМЕЧАНИЕ О БАЗЕ ЗНАНИЙ: Разделы Базы знаний школы ${schoolProfile.name} для этого запроса пусты или не выбраны. Не придумывайте фактические цены, адреса, расписание или список учебных модулей — используйте гипотезы с явным указанием, что это рабочий ориентир.`
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

  // Visual Image Analysis Context when images are attached
  const images = (body.selectedImages || []).filter(
    (img) => img && typeof img.base64Data === 'string' && img.base64Data.length > 0
  );
  if (images.length > 0) {
    const imageNames = images.map((img, i) => `${i + 1}. «${img.name}» (${img.mimeType})`).join(', ');
    sections.push(
      `ПРИКРЕПЛЁННЫЕ ВИЗУАЛЬНЫЕ МАТЕРИАЛЫ (${images.length} шт.: ${imageNames}):
- Пользователь прикрепил материалы с реальными визуальными данными (слайды презентации PPTX, страницы PDF, иллюстрации DOCX или изображения), переданные в мультимодальном потоке запроса.
- Внимательно изучите всё визуальное содержимое: дизайн слайдов, шрифты, таблицы, схемы, графики, цветовую гамму, компоновку и визуальную подачу.
- Обязательно сопоставьте визуальный ряд с текстом документа и опирайтесь на увиденные материалы в ответе.
- Отвечайте строго в рамках своей роли (${
        body.mode === 'marketer'
          ? 'ИИ-Маркетолог: оцените визуальную привлекательность, оффер, читаемость, дизайн слайдов/макетов и соответствие стилю школы'
          : body.mode === 'manager'
            ? 'ИИ-Менеджер: разберите визуальные материалы (прайсы, презентации для родителей, расписания, скрины) и сформируйте точный скрипт'
            : body.mode === 'methodist'
              ? 'ИИ-Методист: детально разберите слайды презентации, учебные схемы, задания для учеников и визуальную структуру занятия'
              : body.mode === 'analyst'
                ? 'ИИ-Аналитик: извлеките данные с графиков, диаграмм, таблиц и слайдов для точного анализа'
                : 'Пиксель: подробно и тепло проанализируйте увиденные слайды и иллюстрации, отвечая на вопросы Анны'
      }) и в контексте школы ${schoolProfile.name}.`
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
    if (body.pixelContext.activeChatContext) {
      const chatCtx = body.pixelContext.activeChatContext;
      const header = [
        `ТЕКУЩИЙ ОТКРЫТЫЙ РАБОЧИЙ ЧАТ СПЕЦИАЛИСТА:`,
        `• Активный специалист: ${chatCtx.specialistTitle} (${chatCtx.specialistRoleSubtitle})`,
        `• Школа диалога: ${chatCtx.schoolName}`,
        `• Название диалога: «${chatCtx.sessionTitle}»`,
        `• Статус окна: ${chatCtx.isSpecialistChatOpen !== false ? 'Чат специалиста сейчас открыт на экране Анны' : 'Фоновый контекст последнего рабочего чата'}`,
      ].join('\n');

      if (chatCtx.recentMessages && chatCtx.recentMessages.length > 0) {
        const formattedMessages = chatCtx.recentMessages
          .slice(-8)
          .map(
            (m, idx) =>
              `${idx + 1}. [${m.authorLabel} · ${m.createdAt}]:\n${m.content
                .trim()
                .slice(0, 2200)}`
          )
          .join('\n\n');
        pixelParts.push(
          `${header}\n\nИстория сообщений текущего рабочего чата (различайте собственные комментарии Пикселя и реальные ответы специалиста):\n${formattedMessages}`
        );
      } else {
        pixelParts.push(
          `${header}\n\nВ этом рабочем чате со специалистом (${chatCtx.specialistTitle}) пока нет сообщений.`
        );
      }
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
  if (norm.includes('3.1-flash-lite') || norm.includes('flash-lite')) {
    return { thinkingLevel: ThinkingLevel.MINIMAL };
  }
  if (norm.includes('3.1-flash') || norm.includes('flash-latest') || norm.startsWith('gemini-3')) {
    return { thinkingLevel: ThinkingLevel.LOW };
  }
  return undefined;
}

/**
 * Strict Waterfall Fallback chain for Google Gemini models:
 * 1. gemini-3.1-flash (основная)
 * 2. gemini-2.5-flash
 * 3. gemini-2.0-flash
 * 4. gemini-1.5-flash
 * And only if all of them are unavailable, waterfalls to OpenRouter (nvidia/nemotron-3.5-super-vl:free).
 */
export const GEMINI_WATERFALL_FALLBACK_MODELS = [
  'gemini-3.1-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
] as const;

let lastHealthyGeminiModel: string = 'gemini-3.1-flash';

/**
 * Provider 1: Google Gemini Free execution with strict Waterfall Fallback
 * (gemini-3.1-flash -> gemini-2.5-flash -> gemini-2.0-flash -> gemini-1.5-flash)
 */
async function executeGeminiGeneration(params: {
  systemInstruction: string;
  messages: Array<{
    role: 'user' | 'model';
    parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
  }>;
  signal: AbortSignal;
  simulateError?: string;
  hasImages?: boolean;
  hasFiles?: boolean;
}): Promise<{ text: string; model: string }> {
  if (params.simulateError === 'force_error' || params.simulateError === 'force_gemini_error') {
    throw new Error('SIMULATED_GEMINI_ERROR');
  }

  const ai = getGenAIClient();

  // Strict Waterfall Fallback model cascade
  const candidateModels = [
    'gemini-3.1-flash',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
  ];

  let lastErr: unknown = null;

  for (let idx = 0; idx < candidateModels.length; idx++) {
    if (params.signal.aborted) {
      throw lastErr || new Error('Request aborted');
    }

    const candidateModel = candidateModels[idx];
    const thinkingCfg = getThinkingConfigForGeminiModel(candidateModel);
    
    // Configurations to try: first with thinkingConfig if present, then clean fallback without thinkingConfig
    const configsToTry: Array<Record<string, unknown>> = [];
    if (thinkingCfg) {
      configsToTry.push({
        systemInstruction: params.systemInstruction,
        abortSignal: params.signal,
        thinkingConfig: thinkingCfg,
      });
    }
    configsToTry.push({
      systemInstruction: params.systemInstruction,
      abortSignal: params.signal,
    });

    for (const config of configsToTry) {
      if (params.signal.aborted) break;

      try {
        const timeoutMs = 45000; // 45 seconds per model attempt
        let timer: NodeJS.Timeout | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              new Error(
                `GEMINI_TIMEOUT: Модель ${candidateModel} не ответила за ${timeoutMs / 1000} секунд.`
              )
            );
          }, timeoutMs);
        });

        const callPromise = ai.models.generateContent({
          model: candidateModel,
          contents: params.messages,
          config,
        });

        const response = await Promise.race([callPromise, timeoutPromise]);
        if (timer) clearTimeout(timer);

        const fullText = (response.text || '').trim();
        if (!fullText) {
          throw new Error('EMPTY_MODEL_RESPONSE');
        }

        lastHealthyGeminiModel = candidateModel;
        return { text: fullText, model: candidateModel };
      } catch (err) {
        lastErr = err;
        const errText =
          err instanceof Error
            ? err.message
            : String(err || '');
        console.warn(
          `[Gemini Attempt Failed] Model: ${candidateModel}, HasThinkingConfig: ${Boolean(config.thinkingConfig)}, Error: ${errText.slice(0, 120)}`
        );
      }
    }

    if (!params.signal.aborted && idx < candidateModels.length - 1) {
      console.log(
        `[Gemini Waterfall Fallback] Model ${candidateModel} failed. Falling back to ${candidateModels[idx + 1]}...`
      );
      continue;
    }
  }

  throw lastErr || new Error('PROVIDER_UNAVAILABLE');
}

/**
 * Provider 2: OpenRouter Free execution (`openrouter/free` or verified `:free` model with 0 cost).
 * Strictly enforces zero-cost rules: never allows paid models or paid fallback.
 */
async function executeOpenRouterFreeGeneration(params: {
  systemInstruction: string;
  messages: IncomingChatMessage[];
  signal: AbortSignal;
  selectedImages?: IncomingSelectedImage[];
  hasImages?: boolean;
  hasDocuments?: boolean;
  candidateModels?: string[];
}): Promise<{ text: string; model: string }> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey || apiKey === 'MY_OPENROUTER_API_KEY') {
    throw new Error('MISSING_OPENROUTER_API_KEY');
  }

  const hasImages = Boolean(
    params.hasImages ||
      (params.selectedImages && params.selectedImages.length > 0)
  );

  const modelsToTry =
    params.candidateModels && params.candidateModels.length > 0
      ? params.candidateModels
      : await getOpenRouterCandidateModels({
          hasImages,
          hasDocuments: params.hasDocuments,
          signal: params.signal,
        });

  // Construct OpenAI-compatible messages with multimodal support
  const openAiMessages: Array<{
    role: string;
    content:
      | string
      | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }> = [{ role: 'system', content: params.systemInstruction }];

  const rawMessages = params.messages.map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content.trim().slice(0, MAX_SINGLE_MESSAGE_CHARS),
  }));

  if (hasImages && params.selectedImages && params.selectedImages.length > 0) {
    const lastUserIdx = rawMessages.map((m) => m.role).lastIndexOf('user');
    for (let idx = 0; idx < rawMessages.length; idx++) {
      if (idx === lastUserIdx || (lastUserIdx === -1 && idx === rawMessages.length - 1)) {
        const textContent =
          rawMessages[idx].content ||
          'Пожалуйста, внимательно проанализируй прикреплённые материалы и изображения.';
        const contentParts: Array<{
          type: string;
          text?: string;
          image_url?: { url: string };
        }> = [{ type: 'text', text: textContent }];

        for (const img of params.selectedImages) {
          const url = img.base64Data.startsWith('data:')
            ? img.base64Data
            : `data:${img.mimeType || 'image/jpeg'};base64,${img.base64Data}`;
          contentParts.push({
            type: 'image_url',
            image_url: { url },
          });
        }
        openAiMessages.push({ role: 'user', content: contentParts });
      } else {
        openAiMessages.push(rawMessages[idx]);
      }
    }
  } else {
    for (const m of rawMessages) {
      openAiMessages.push(m);
    }
  }

  const timeoutController = new AbortController();
  const timer = setTimeout(
    () => timeoutController.abort(),
    OPENROUTER_ATTEMPT_TIMEOUT_MS
  );
  const onAbort = () => timeoutController.abort();
  params.signal.addEventListener('abort', onAbort, { once: true });

  let lastModelError: Error | null = null;

  try {
    for (const modelId of modelsToTry) {
      if (params.signal.aborted || timeoutController.signal.aborted) {
        throw new Error('Request aborted');
      }

      console.log(`[OpenRouter Sequential Route] Attempting model: ${modelId}`);

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
            model: modelId,
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
        if (!text) {
          throw new Error('EMPTY_MODEL_RESPONSE');
        }

        const actualModel = String(data?.model || modelId).trim();
        console.log(
          `[OpenRouter Sequential Success] Successfully generated content with: ${actualModel}`
        );
        return {
          text,
          model: actualModel,
        };
      } catch (candidateErr) {
        lastModelError =
          candidateErr instanceof Error
            ? candidateErr
            : new Error(String(candidateErr));
        console.warn(
          `[OpenRouter Model Candidate Failed] Model «${modelId}» error: ${lastModelError.message}. Switching to next candidate...`
        );
      }
    }

    throw (
      lastModelError ||
      new Error('Все подходящие бесплатные модели OpenRouter завершились ошибкой.')
    );
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

export async function startServer(
  options: AssistantServerOptions = {}
): Promise<RunningAssistantServer> {
  // In AI Studio / Cloud Run, process.env.PORT is often 8080 (the Nginx reverse proxy front-end).
  // The Node application must always listen on port 3000 unless explicitly specified via options.port
  // or a non-8080 custom port.
  let resolvedPort = options.port;
  if (!resolvedPort) {
    const envPort = process.env.APP_PORT
      ? Number(process.env.APP_PORT)
      : process.env.PORT
        ? Number(process.env.PORT)
        : 3000;
    resolvedPort = envPort === 8080 || isNaN(envPort) ? 3000 : envPort;
  }
  const PORT = resolvedPort;
  const HOST = options.host ?? '0.0.0.0';
  const customDistPath = options.distPath;
  const app = express();

  // Strict payload size limit to protect the server while allowing base64 image attachments
  app.use(express.json({ limit: '15mb' }));

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
        const defaultProf = serverConnectionProfiles.find(
          (p) => p.providerId === 'gemini' && p.isDefault
        );
        if (defaultProf) {
          defaultProf.connectionStatus = 'not_configured';
          defaultProf.lastError = 'Ключ GEMINI_API_KEY не задан на сервере.';
        }
      } else {
        try {
          const ai = getGenAIClient();
          await ai.models.generateContent({
            model: 'gemini-3.1-flash',
            contents: 'ping',
          });
          providerHealthRegistry.gemini.status = 'connected';
          providerHealthRegistry.gemini.lastErrorReason = undefined;
          const defaultProf = serverConnectionProfiles.find(
            (p) => p.providerId === 'gemini' && p.isDefault
          );
          if (defaultProf) {
            defaultProf.connectionStatus = 'connected';
            defaultProf.lastError = undefined;
            defaultProf.lastCheckedAt = nowIso;
          }
        } catch (err) {
          const classified = classifyProviderError('gemini', err);
          providerHealthRegistry.gemini.status =
            classified.healthStatus === 'quota_exceeded'
              ? 'quota_exceeded'
              : 'temporarily_unavailable';
          providerHealthRegistry.gemini.lastErrorReason = classified.message;
          const defaultProf = serverConnectionProfiles.find(
            (p) => p.providerId === 'gemini' && p.isDefault
          );
          if (defaultProf) {
            defaultProf.connectionStatus =
              classified.healthStatus === 'quota_exceeded'
                ? 'quota_exceeded'
                : 'error';
            defaultProf.lastError = classified.message;
            defaultProf.lastCheckedAt = nowIso;
          }
        }
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
        providerHealthRegistry.gemini.status = 'connected';
        providerHealthRegistry.gemini.lastErrorReason = undefined;
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
          classified.healthStatus === 'quota_exceeded'
            ? 'quota_exceeded'
            : 'error';
        profile.lastCheckedAt = testedAt;
        profile.lastError = classified.message;
        providerHealthRegistry.gemini.status =
          classified.healthStatus === 'quota_exceeded'
            ? 'quota_exceeded'
            : 'temporarily_unavailable';
        providerHealthRegistry.gemini.lastErrorReason = classified.message;
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

    // Auto-grant consent for all providers in trusted local environment
    const consentedProvidersSet = new Set<AIProviderId>(['gemini', 'openrouter', 'ollama']);
    if (Array.isArray(body.consentedProviders)) {
      for (const p of body.consentedProviders) {
        if (VALID_PROVIDER_IDS.has(p)) {
          consentedProvidersSet.add(p);
        }
      }
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

    const validImages = (body.selectedImages || [])
      .filter(
        (img) =>
          img &&
          typeof img.base64Data === 'string' &&
          img.base64Data.trim().length > 0 &&
          typeof img.mimeType === 'string' &&
          img.mimeType.startsWith('image/')
      )
      .slice(0, 500);
    const hasImages = validImages.length > 0;
    const docsCount = Array.isArray(body.selectedDocuments) ? body.selectedDocuments.length : 0;
    // Multi-file (>1 doc) OR large image count (>10 images / >1 image) forces OpenRouter multimodal routing
    const isLargeMultimodalPayload = validImages.length > 10 || docsCount > 1 || validImages.length > 1;

    if (hasImages && requestedSelection === 'ollama') {
      res.status(400).json({
        error: {
          code: 'IMAGE_UNSUPPORTED_BY_PROVIDER',
          message: `Локальный провайдер Ollama не поддерживает визуальный анализ изображений. Пожалуйста, выберите «Автовыбор ИИ», «Google Gemini Free» или «OpenRouter Free» для отправки изображений.`,
        },
      });
      return;
    }

    const normalizedRawMessages = body.messages
      .filter(
        (m) =>
          m &&
          typeof m.content === 'string' &&
          m.content.trim().length > 0
      )
      .slice(-MAX_MESSAGES_IN_CONTEXT);

    if (normalizedRawMessages.length === 0 && hasImages) {
      normalizedRawMessages.push({
        role: 'user',
        content: 'Пожалуйста, внимательно проанализируй прикреплённое изображение.',
      });
    }

    const trimmedGeminiMessages: Array<{
      role: 'user' | 'model';
      parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
    }> = normalizedRawMessages.map((m) => ({
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

    if (hasImages) {
      let targetIdx = -1;
      for (let i = trimmedGeminiMessages.length - 1; i >= 0; i--) {
        if (trimmedGeminiMessages[i].role === 'user') {
          targetIdx = i;
          break;
        }
      }
      if (targetIdx === -1) {
        trimmedGeminiMessages.push({
          role: 'user',
          parts: [
            { text: 'Пожалуйста, внимательно проанализируй прикреплённое изображение.' },
          ],
        });
        targetIdx = trimmedGeminiMessages.length - 1;
      }
      for (const img of validImages) {
        const cleanBase64 = img.base64Data.includes(',')
          ? img.base64Data.split(',')[1].trim()
          : img.base64Data.trim();
        trimmedGeminiMessages[targetIdx].parts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: cleanBase64,
          },
        });
      }
    }

    const systemInstruction = buildSystemInstruction(body);
    const wantsStream = body.stream !== false;

    // Determine candidate provider sequence (failover order always preserved)
    const configuredOrder = serverFailoverSettings.order || [
      'gemini',
      'openrouter',
      'ollama',
    ];

    let candidateProviders: AIProviderId[];
    if (requestedSelection !== 'auto') {
      candidateProviders = [
        requestedSelection,
        ...configuredOrder.filter((p) => p !== requestedSelection),
      ];
    } else {
      // Sequential fallback route:
      // 1. Gemini (with gemini-3.1-flash-lite as default for files)
      // 2. OpenRouter (models suitable for files/images)
      // 3. Ollama (if configured)
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
      const ready = baseOrder.filter((p) => !isProviderInCooldown(p));
      const cooling = baseOrder.filter((p) => isProviderInCooldown(p));
      candidateProviders = [...ready, ...cooling];
    }

    const docNames = (body.selectedDocuments || []).map((d) => d.name);
    const imgNames = validImages.map((i) => i.name);
    console.log(
      `[AI File Routing] RequestId: ${requestId}, School: ${body.schoolId}, Mode: ${body.mode}, Docs: ${docsCount} [${docNames.join(', ')}], Images: ${validImages.length} [${imgNames.join(', ')}], Candidates: [${candidateProviders.join(' -> ')}]`
    );

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

        const initialCandidateModel =
          firstUsableProvider === 'openrouter'
            ? 'nvidia/nemotron-3.5-super-vl:free'
            : firstUsableProvider === 'ollama'
              ? (providerHealthRegistry.ollama.lastResolvedModel || 'llama3.2')
              : GEMINI_MODEL;

        writeSseEvent(res, {
          type: 'stage',
          stage: 'waiting_model',
          requestId,
          providerId: firstUsableProvider,
          model: initialCandidateModel,
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

        // Skip unconfigured providers without overwriting an existing error from an earlier configured provider
        if (providerId === 'openrouter' && !isOpenRouterApiKeyConfigured()) {
          if (!firstFailedProvider) {
            firstFailedProvider = 'openrouter';
          }
          if (!lastClassifiedError || requestedSelection === 'openrouter') {
            lastClassifiedError = {
              status: 503,
              code: 'OPENROUTER_NOT_CONFIGURED',
              message:
                'Провайдер OpenRouter Free ещё не настроен: не задан ключ API в настройках подключений или на сервере.',
              shouldFailover: true,
              healthStatus: 'not_configured',
              applyCooldown: false,
            };
          }
          continue;
        }

        if (providerId === 'gemini' && !isGeminiApiKeyConfigured()) {
          if (!firstFailedProvider) {
            firstFailedProvider = 'gemini';
          }
          if (!lastClassifiedError || requestedSelection === 'gemini') {
            lastClassifiedError = {
              status: 503,
              code: 'GEMINI_NOT_CONFIGURED',
              message:
                'Провайдер Google Gemini не настроен: не задан GEMINI_API_KEY на сервере.',
              shouldFailover: true,
              healthStatus: 'not_configured',
              applyCooldown: false,
            };
          }
          continue;
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
          if (!lastClassifiedError || requestedSelection === 'ollama') {
            lastClassifiedError = {
              status: 503,
              code: 'OLLAMA_NOT_AVAILABLE',
              message:
                'Локальный сервер Ollama не запущен на порту 11434 (доступен в настольной версии или после запуска Ollama на ПК).',
              shouldFailover: true,
              healthStatus: 'not_configured',
              applyCooldown: false,
            };
          }
          continue;
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
              hasImages,
              hasFiles: docsCount > 0,
            });
          } else if (providerId === 'openrouter') {
            attemptResult = await executeOpenRouterFreeGeneration({
              systemInstruction,
              messages: normalizedRawMessages,
              selectedImages: validImages,
              hasImages,
              hasDocuments: docsCount > 0,
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
            ? `${PROVIDER_SHORT_LABELS_RU[firstFailedProvider!]} временно недоступен. Переключились на ${PROVIDER_SHORT_LABELS_RU[providerId]} (${attemptResult.model})`
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

  // Designer Free Image Provider Registry Status & Verification Endpoints
  app.get('/api/design/providers', (_req: Request, res: Response) => {
    res.json(imageProviderRegistry.getState());
  });

  app.post('/api/design/providers/check', async (_req: Request, res: Response) => {
    try {
      const state = await imageProviderRegistry.verifyAllProviders();
      res.json(state);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Ошибка проверки провайдеров генерации';
      res.status(500).json({ error: msg });
    }
  });

  // Cloudflare Workers AI Connection Management Endpoints (Browser & Server API)
  app.get('/api/ai/cloudflare-config', (_req: Request, res: Response) => {
    const safeConfig = imageProviderRegistry
      .getCloudflareAdapter()
      .getSafeConnectionConfig();
    res.json(safeConfig);
  });

  app.post('/api/ai/cloudflare-config', (req: Request, res: Response) => {
    const { accountId, rawApiToken } = req.body || {};
    const cleanAccount =
      typeof accountId === 'string' ? accountId.trim() : '';
    const cleanToken =
      typeof rawApiToken === 'string' ? rawApiToken.trim() : '';

    const cfAdapter = imageProviderRegistry.getCloudflareAdapter();
    const currentSafe = cfAdapter.getSafeConnectionConfig();

    if (!cleanAccount || cleanAccount.length < 10) {
      return res.status(400).json({
        error: {
          message:
            'Укажите корректный Cloudflare Account ID (не менее 10 символов).',
        },
      });
    }

    if (!currentSafe.hasSavedToken && (!cleanToken || cleanToken.length < 10)) {
      return res.status(400).json({
        error: {
          message:
            'Укажите корректный Cloudflare API Token (не менее 10 символов).',
        },
      });
    }

    setServerCloudflareCredentials(cleanAccount, cleanToken || undefined);
    res.json(cfAdapter.getSafeConnectionConfig());
  });

  // Designer Visual Generation & Regional AI Editing Endpoint (Strictly Free API via ImageProviderRegistry)
  const handleDesignGenerateRequest = async (req: Request, res: Response) => {
    try {
      const {
        schoolId = 'kiberone',
        providerId = 'cloudflare',
        modelId,
        prompt = '',
        aspectRatio = '3:4',
        qualityMode = 'standard',
        templatePreset = 'promo_banner',
        suggestedHeadline,
        suggestedOffer,
        suggestedCta,
        sourceImageBase64,
        sourceImageMimeType = 'image/png',
        selectionBox,
        editInstruction,
        referenceImageBase64,
        referenceImageMimeType = 'image/png',
      } = req.body || {};

      const validAspectRatios = new Set<DesignAspectRatio>([
        '3:4',
        '9:16',
        '1:1',
        '16:9',
        '4:3',
      ]);
      const safeAspectRatio: DesignAspectRatio = validAspectRatios.has(
        aspectRatio as DesignAspectRatio
      )
        ? (aspectRatio as DesignAspectRatio)
        : '3:4';

      const safeProviderId: ImageProviderId =
        providerId === 'cloudflare' ? 'cloudflare' : 'cloudflare';

      const isRegionalEdit = Boolean(sourceImageBase64 && editInstruction);
      const hasInputImage = Boolean(
        isRegionalEdit ||
          (referenceImageBase64 &&
            typeof referenceImageBase64 === 'string' &&
            referenceImageBase64.trim())
      );

      // Default to flux-2-klein-9b when reference/editing image is provided, or flux-1-schnell for pure text-to-image if unspecified
      const validFreeModels = new Set<FreeDesignImageModelId>([
        '@cf/black-forest-labs/flux-1-schnell',
        '@cf/black-forest-labs/flux-2-klein-9b',
      ]);

      const resolvedModelId: FreeDesignImageModelId = validFreeModels.has(
        modelId as FreeDesignImageModelId
      )
        ? (modelId as FreeDesignImageModelId)
        : hasInputImage
          ? '@cf/black-forest-labs/flux-2-klein-9b'
          : '@cf/black-forest-labs/flux-1-schnell';

      const schoolBrandDirection =
        schoolId === 'renderia'
          ? 'School brand: RENDERIA (creative industries & technology school for teens 12-18: 3D, Blender, Unity/Unreal gamedev, AI, digital design). Visual aesthetic: modern studio dark indigo (#1E1B4B), electric violet (#7C3AED), neon magenta/cyan lighting accents, sleek futuristic 3D/digital art atmosphere.'
          : 'School brand: KIBERONE (international cyber school for children 6-14: coding, robotics, digital creation). Visual aesthetic: vibrant friendly futuristic tech, signature teal (#00A89D), energetic yellow (#FFD600), deep navy (#0F172A) contrast, inspiring high-tech learning vibe.';

      let finalImagePrompt = '';
      if (isRegionalEdit) {
        const regionNote =
          selectionBox &&
          typeof selectionBox.xPercent === 'number' &&
          typeof selectionBox.yPercent === 'number'
            ? `Focus the modification strictly on the selected rectangular area (left: ${Math.round(selectionBox.xPercent)}%, top: ${Math.round(selectionBox.yPercent)}%, width: ${Math.round(selectionBox.widthPercent)}%, height: ${Math.round(selectionBox.heightPercent)}%). Preserve the rest of the composition, lighting, and background intact.`
            : 'Modify only the requested element while preserving the overall composition, lighting, and style.';

        finalImagePrompt = [
          `Edit this visual background for ${schoolId === 'renderia' ? 'RENDERIA' : 'KIBERONE'}.`,
          `User edit instruction: ${String(editInstruction).trim()}`,
          regionNote,
          'CRITICAL RULE: Keep the image as a clean visual base WITHOUT baked-in text, letters, watermarks, or UI buttons so editable text layers can be placed on top.',
        ].join('\n');
      } else {
        finalImagePrompt = [
          schoolBrandDirection,
          `Task / Visual Concept: ${String(prompt).trim()}`,
          `Layout preset: ${String(templatePreset)} (${safeAspectRatio}).`,
          'CRITICAL RULE FOR LAYER SEPARATION: Generate ONLY the clean high-impact visual background / 3D illustration / photographic scene with intentional negative space (clean composition zones at the top and bottom) for overlay typography. DO NOT render any text, words, letters, numbers, buttons, or logos inside the image itself.',
        ].join('\n');
      }

      const adapter = imageProviderRegistry.getAdapter(safeProviderId);
      const genResult = await adapter.generateImage({
        schoolId: schoolId === 'renderia' ? 'renderia' : 'kiberone',
        providerId: safeProviderId,
        modelId: resolvedModelId,
        prompt: finalImagePrompt,
        aspectRatio: safeAspectRatio,
        qualityMode: (qualityMode as DesignQualityMode) || 'standard',
        sourceImageBase64:
          typeof sourceImageBase64 === 'string' ? sourceImageBase64 : undefined,
        sourceImageMimeType,
        selectionBox,
        editInstruction:
          typeof editInstruction === 'string' ? editInstruction : undefined,
        referenceImageBase64:
          typeof referenceImageBase64 === 'string'
            ? referenceImageBase64
            : undefined,
        referenceImageMimeType,
      });

      // Build default editable overlay layers if not a regional edit
      const defaultLayers = isRegionalEdit
        ? undefined
        : [
            {
              id: 'layer-school-badge',
              type: 'school_badge',
              label: 'Бейдж школы',
              text:
                schoolId === 'renderia'
                  ? 'RENDERIA • ШКОЛА КРЕАТИВНЫХ ИНДУСТРИЙ'
                  : 'KIBERone • ПЕРВАЯ МЕЖДУНАРОДНАЯ КИБЕРШКОЛА',
              visible: true,
              xPercent: 8,
              yPercent: 7,
              fontSizePx: 13,
              textColor: '#FFFFFF',
              backgroundColor:
                schoolId === 'renderia' ? '#7C3AED' : '#00A89D',
              align: 'left',
            },
            {
              id: 'layer-headline',
              type: 'headline',
              label: 'Заголовок',
              text:
                typeof suggestedHeadline === 'string' &&
                suggestedHeadline.trim()
                  ? suggestedHeadline.trim()
                  : schoolId === 'renderia'
                    ? 'Создай свой 3D и ИИ-проект'
                    : 'Пробный урок по IT и технологиям',
              visible: true,
              xPercent: 8,
              yPercent: 18,
              fontSizePx: 28,
              textColor: '#FFFFFF',
              backgroundColor: 'rgba(15, 23, 42, 0.72)',
              align: 'left',
            },
            {
              id: 'layer-offer',
              type: 'offer',
              label: 'Оффер / Подзаголовок',
              text:
                typeof suggestedOffer === 'string' && suggestedOffer.trim()
                  ? suggestedOffer.trim()
                  : schoolId === 'renderia'
                    ? 'Практика для подростков 12–18 лет: портфолио и реальные навыки'
                    : 'Бесплатное пробное занятие для детей 6–14 лет в Сызрани',
              visible: true,
              xPercent: 8,
              yPercent: 66,
              fontSizePx: 16,
              textColor: '#F8FAFC',
              backgroundColor: 'rgba(15, 23, 42, 0.78)',
              align: 'left',
            },
            {
              id: 'layer-cta',
              type: 'cta',
              label: 'Кнопка CTA',
              text:
                typeof suggestedCta === 'string' && suggestedCta.trim()
                  ? suggestedCta.trim()
                  : 'Записаться на пробный урок',
              visible: true,
              xPercent: 8,
              yPercent: 84,
              fontSizePx: 15,
              textColor: schoolId === 'renderia' ? '#FFFFFF' : '#0F172A',
              backgroundColor:
                schoolId === 'renderia' ? '#EC4899' : '#FFD600',
              align: 'center',
            },
          ];

      return res.json({
        ok: true,
        providerId: genResult.providerId,
        modelUsed: genResult.modelUsed,
        aspectRatio: genResult.aspectRatio,
        qualityMode: genResult.qualityMode,
        backgroundImageDataUrl: genResult.backgroundImageDataUrl,
        defaultLayers,
        estimatedNeuronsUsed: genResult.estimatedNeuronsUsed,
        quotaSnapshot: genResult.quotaSnapshot,
        registryState: imageProviderRegistry.getState(),
        modelComment: genResult.modelComment,
      });
    } catch (err: unknown) {
      const quotaSnapshot = imageProviderRegistry
        .getCloudflareAdapter()
        .getQuotaSnapshot();
      const registryState = imageProviderRegistry.getState();

      if (err instanceof ImageGenerationError) {
        return res.status(err.statusCode).json({
          code: err.errorCode,
          error: err.message,
          quotaSnapshot,
          registryState,
        });
      }

      const rawMessage =
        err instanceof Error ? err.message : String(err || 'Ошибка генерации изображения');
      const conciseMessage =
        rawMessage.length > 260 ? `${rawMessage.slice(0, 260)}…` : rawMessage;
      return res.status(500).json({
        code: 'PROVIDER_ERROR',
        error: `Не удалось сгенерировать изображение: ${conciseMessage}`,
        quotaSnapshot,
        registryState,
      });
    }
  };

  app.post('/api/gemini/design/generate', handleDesignGenerateRequest);
  app.post('/api/design/generate', handleDesignGenerateRequest);

  // Gemini TTS Speech Generation & Model Status endpoints
  app.get('/api/voice/models', (_req: Request, res: Response) => {
    const isConfigured = isGeminiApiKeyConfigured();
    res.json({
      configured: isConfigured,
      models: [
        {
          id: 'gemini-2.5-flash-tts',
          name: 'Gemini 2.5 Flash TTS (Основная скоростная модель)',
          tier: 'standard',
          paidTierRequired: false,
        },
        {
          id: 'gemini-2.5-pro-tts',
          name: 'Gemini 2.5 Pro TTS (Флагманская модель Voice Design)',
          tier: 'standard',
          paidTierRequired: false,
        },
      ],
      defaultModel: 'gemini-2.5-flash-tts',
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
    timbre?: string;
    serviceTier: string;
    createdAt: number;
  }

  const ttsAudioCache = new Map<string, TtsCacheItem>();
  const MAX_TTS_CACHE_ITEMS = 200;
  const TTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  app.post('/api/voice/tts', async (req: Request, res: Response) => {
    try {
      const { text, voice, style, model, timbreId, forceRefresh, noCache } =
        req.body || {};
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
          : 'gemini-2.5-flash-tts';
      const requestedTimbre =
        typeof timbreId === 'string' && timbreId.trim()
          ? timbreId.trim()
          : 'bright';
      const requestedStyle =
        typeof style === 'string' && style.trim()
          ? style.trim()
          : 'Естественная русская разговорная речь. Чуть более высокий, светлый, лёгкий и мягкий регистр. Приветливый, открытый, воодушевляющий тон, без искусственности и без писклявости.';

      const bypassCache = Boolean(noCache || forceRefresh);
      const CACHE_GENERATION_VERSION = 'v4_real_prosody';

      // Generate robust SHA-256 cache key including version, text, model, voice, timbreId and style
      const cacheKey = crypto
        .createHash('sha256')
        .update(
          `${CACHE_GENERATION_VERSION}::${cleanText}::${requestedModel}::${requestedVoice}::${requestedTimbre}::${requestedStyle}::audio/wav`
        )
        .digest('hex');

      // Check cache first if not explicitly bypassing (saves quota, eliminates latency, zero quota burn)
      const cached = !bypassCache ? ttsAudioCache.get(cacheKey) : null;
      const now = Date.now();
      if (cached) {
        if (now - cached.createdAt < TTS_CACHE_TTL_MS) {
          return res.json({
            success: true,
            audioBase64: cached.audioBase64,
            mimeType: cached.mimeType,
            model: cached.model,
            voice: cached.voice,
            timbre: cached.timbre || requestedTimbre,
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
        timbre: requestedTimbre,
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
        fromCache: false,
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
          error:
            'Бесплатная квота Gemini TTS (10 запросов/день) исчерпана. Используется встроенный синтез речи браузера.',
          code: 'RATE_LIMIT',
          fallbackAvailable: true,
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

  // Gemini Live API Status & Capabilities endpoint
  app.get('/api/voice/live-status', (_req: Request, res: Response) => {
    const isConfigured = isGeminiApiKeyConfigured();
    res.json({
      configured: isConfigured,
      model: 'gemini-3.8-live',
      defaultVoice: 'Kore',
      availableVoices: [
        { id: 'Kore', name: 'Kore', gender: 'female', recommended: true },
        { id: 'Puck', name: 'Puck', gender: 'neutral' },
        { id: 'Zephyr', name: 'Zephyr', gender: 'female' },
        { id: 'Charon', name: 'Charon', gender: 'male' },
        { id: 'Fenrir', name: 'Fenrir', gender: 'male' },
      ],
      sampleRates: {
        inputSampleRate: 16000,
        outputSampleRate: 24000,
      },
      format: 'pcm_16bit_little_endian',
      supported: isConfigured,
      pricingTier: 'standard_free_limits',
      pricingNotice:
        'Модель gemini-3.8-live работает в рамках квот Gemini API. Платные вызовы без явного подтверждения не производятся.',
    });
  });

  // Mount Vite middleware in development or static dist in production
  if (process.env.NODE_ENV !== 'production' && !options.isElectronProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = customDistPath || path.join(_serverDir, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/api/live' });

  wss.on('error', (wsServerErr) => {
    console.warn('[Live WebSocketServer Warning]', wsServerErr);
  });

  wss.on('connection', (clientWs: WebSocket) => {
    let liveSession: any = null;
    let greetingTimeout: NodeJS.Timeout | null = null;

    const cleanupLiveSession = () => {
      if (greetingTimeout) {
        clearTimeout(greetingTimeout);
        greetingTimeout = null;
      }
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // ignore
        }
        liveSession = null;
      }
    };

    clientWs.on('message', async (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'init') {
          cleanupLiveSession();

          if (!isGeminiApiKeyConfigured()) {
            clientWs.send(
              JSON.stringify({
                type: 'error',
                code: 'MISSING_API_KEY',
                message: 'API-ключ Google Gemini не настроен на сервере.',
              })
            );
            clientWs.close();
            return;
          }

          const requestedVoice = (msg.voiceName || 'Kore').trim();
          const schoolId: SchoolId =
            msg.schoolId === 'renderia' ? 'renderia' : 'kiberone';
          const pixelContext = msg.pixelContext as IncomingPixelContext | undefined;
          const liveModel = 'gemini-3.8-live';

          const systemInstruction = buildSystemInstruction({
            schoolId,
            mode: 'pixel',
            messages: [],
            pixelContext,
          });

          try {
            const ai = getGenAIClient();
            liveSession = await ai.live.connect({
              model: liveModel,
              config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: requestedVoice },
                  },
                },
                outputAudioTranscription: {},
                inputAudioTranscription: {},
                systemInstruction:
                  systemInstruction +
                  '\n\nФОРМАТ ЖИВОГО ГОЛОСОВОГО РАЗГОВОРА:\n- Общайтесь естественно, легко и тепло исключительно на русском языке (ru-RU), как в живом телефонном разговоре с близким и умным другом.\n- СТРОГИЙ ЗАПРЕТ СМЕНЫ ЯЗЫКА: Категорически запрещено переключаться на испанский, английский или другие языки из-за случайных помех микрофона, акцента или ложного распознавания слов. Всегда отвечайте только по-русски!\n- Вы открыты для любых тем: кино, сериалы, книги, музыка, наука, философия, жизненные размышления, настроение, творчество, а также рабочие задачи двух школ.\n- Отвечайте лаконично (1–3 живые разговорные фразы для обычных вопросов), не загромождайте эфир.\n- Категорически ЗАПРЕЩЕНО использовать Markdown-разметку (никаких звёздочек, решёток, нумерованных списков и спецсимволов).\n- Обращайтесь по имени «Анна».\n- Если диалог открыт ключевым словом вызова («Пиксель»), произнесите: «Я тут, Анна!».\n- СТРОГОЕ ПРАВИЛО ЧТЕНИЯ ОТВЕТОВ СПЕЦИАЛИСТОВ: Если Анна просит «прочитай ответ», «зачитай ответ», «озвучь сообщение», «прочитай, что ответил маркетолог/методист/менеджер/аналитик» — НЕ пересказывайте, НЕ сокращайте и НЕ зачитывайте ответ специалиста самостоятельно в разговорном голосовом потоке! Вместо этого ответьте одной краткой фразой («Сейчас прочитаю дословно», «Слушаю ответ специалиста», «Включаю чтение ответа»), так как воспроизведение полного дословного ответа выполняется встроенным аудио-плеером без наложения голосов.',
              },
              callbacks: {
                onmessage: (serverMessage: LiveServerMessage) => {
                  if (clientWs.readyState !== WebSocket.OPEN) return;
                  const content = serverMessage.serverContent;

                  if (content?.inputTranscription?.text) {
                    clientWs.send(
                      JSON.stringify({
                        type: 'user_transcript',
                        text: content.inputTranscription.text,
                      })
                    );
                  }

                  if (content?.outputTranscription?.text) {
                    clientWs.send(
                      JSON.stringify({
                        type: 'model_transcript',
                        text: content.outputTranscription.text,
                      })
                    );
                  }

                  for (const part of content?.modelTurn?.parts ?? []) {
                    if (part.inlineData?.data) {
                      clientWs.send(
                        JSON.stringify({
                          type: 'audio',
                          data: part.inlineData.data,
                          sampleRate: 24000,
                        })
                      );
                    }
                  }

                  if (content?.interrupted) {
                    clientWs.send(JSON.stringify({ type: 'interrupted' }));
                  }

                  if (content?.turnComplete) {
                    clientWs.send(JSON.stringify({ type: 'turn_complete' }));
                  }
                },
                onclose: () => {
                  if (greetingTimeout) {
                    clearTimeout(greetingTimeout);
                    greetingTimeout = null;
                  }
                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({ type: 'session_closed' }));
                  }
                },
                onerror: (err: unknown) => {
                  const errMsg =
                    err instanceof Error ? err.message : String(err);
                  console.warn('[Gemini Live Session Error]', errMsg);
                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(
                      JSON.stringify({
                        type: 'error',
                        code: 'SESSION_ERROR',
                        message: errMsg,
                      })
                    );
                  }
                },
              },
            });

            clientWs.send(
              JSON.stringify({
                type: 'ready',
                model: liveModel,
                voice: requestedVoice,
                schoolId,
              })
            );

            if (msg.initialWakeGreeting) {
              if (greetingTimeout) {
                clearTimeout(greetingTimeout);
                greetingTimeout = null;
              }
              const sessionToGreet = liveSession;
              greetingTimeout = setTimeout(() => {
                greetingTimeout = null;
                try {
                  if (
                    sessionToGreet &&
                    liveSession === sessionToGreet &&
                    clientWs.readyState === WebSocket.OPEN &&
                    typeof sessionToGreet.sendRealtimeInput === 'function'
                  ) {
                    sessionToGreet.sendRealtimeInput({
                      text: 'Голосовой вызов Пикселя: скажи только «Я тут, Анна!» и сразу слушай ответ.',
                    });
                  }
                } catch (greetErr) {
                  console.warn('[Live Greeting Error]', greetErr);
                }
              }, 120);
            }
          } catch (liveErr: unknown) {
            const errStr =
              liveErr instanceof Error ? liveErr.message : String(liveErr);
            console.warn('[Gemini Live Connect Failed]', errStr);
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(
                JSON.stringify({
                  type: 'error',
                  code: 'LIVE_CONNECT_FAILED',
                  message: `Не удалось подключиться к Gemini Live API (${liveModel}): ${errStr}`,
                  fallbackAvailable: true,
                })
              );
            }
          }
        } else if (msg.type === 'audio' && msg.data) {
          if (
            liveSession &&
            clientWs.readyState === WebSocket.OPEN &&
            typeof liveSession.sendRealtimeInput === 'function'
          ) {
            try {
              liveSession.sendRealtimeInput({
                audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
              });
            } catch (audioErr) {
              console.warn('[Live Audio Input Error]', audioErr);
            }
          }
        } else if (msg.type === 'text' && msg.text) {
          if (
            liveSession &&
            clientWs.readyState === WebSocket.OPEN &&
            typeof liveSession.sendRealtimeInput === 'function'
          ) {
            try {
              liveSession.sendRealtimeInput({
                text: msg.text,
              });
            } catch (textErr) {
              console.warn('[Live Text Input Error]', textErr);
            }
          }
        } else if (msg.type === 'stop') {
          cleanupLiveSession();
        }
      } catch (err) {
        console.warn('[WebSocket message parse error]', err);
      }
    });

    clientWs.on('close', () => {
      cleanupLiveSession();
    });

    clientWs.on('error', (wsErr) => {
      console.warn('[Client WS error]', wsErr);
      cleanupLiveSession();
    });
  });

  return new Promise<RunningAssistantServer>((resolve, reject) => {
    httpServer.on('error', (err: unknown) => {
      console.warn('[HTTP Server Error]', err);
    });

    httpServer.listen(PORT, HOST, () => {
      const addr = httpServer.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : PORT;
      console.log(
        `[Server] KIBERONE & RENDERIA Business Assistant running on http://${HOST}:${actualPort} (Primary Model: ${GEMINI_MODEL}, Live API on /api/live)`
      );

      resolve({
        httpServer,
        wss,
        port: actualPort,
        host: HOST,
        close: async () => {
          return new Promise<void>((resClose) => {
            wss.close(() => {
              httpServer.close(() => {
                resClose();
              });
            });
          });
        },
      });
    });
  });
}

function parseCliArgs(): AssistantServerOptions {
  const options: AssistantServerOptions = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if ((arg === '--port' || arg === '-p') && process.argv[i + 1]) {
      const p = parseInt(process.argv[++i], 10);
      if (!isNaN(p)) options.port = p;
    } else if (arg.startsWith('--port=')) {
      const p = parseInt(arg.split('=')[1], 10);
      if (!isNaN(p)) options.port = p;
    } else if ((arg === '--host' || arg === '-h') && process.argv[i + 1]) {
      options.host = process.argv[++i];
    } else if (arg.startsWith('--host=')) {
      options.host = arg.split('=')[1];
    }
  }
  return options;
}

process.on('uncaughtException', (err) => {
  console.warn('[Server uncaughtException]', err);
});

process.on('unhandledRejection', (reason) => {
  console.warn('[Server unhandledRejection]', reason);
});

const isDirectExecution =
  typeof process !== 'undefined' &&
  !process.versions?.electron &&
  Boolean(
    process.argv[1]?.endsWith('server.ts') ||
      process.argv[1]?.endsWith('server.js')
  );

if (isDirectExecution) {
  startServer(parseCliArgs()).catch((err) => {
    console.error('[Server Startup Fatal Error]', err);
  });
}
