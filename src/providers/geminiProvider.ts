import {
  AgentMode,
  AIProviderId,
  AIProviderSelectionMode,
  DesignAspectRatio,
  DesignerInteractivePrompt,
  DesignImageModelId,
  DesignOverlayLayer,
  DesignQualityMode,
  DesignSelectionBox,
  DesignTemplatePresetId,
  FreeDesignImageModelId,
  ImageProviderId,
  ImageProviderQuotaState,
  ImageProvidersRegistryState,
  PixelRelevantContextBundle,
  SchoolId,
} from '../types/assistant';
import {
  PreparedApiDocumentItem,
  PreparedKnowledgeContextItem,
} from './documentProvider';
import { AIProvidersSystemState } from './aiProviderManager';

export type GeminiEndpointMode = AgentMode | 'pixel';

export type GenerationStage =
  | 'connecting'
  | 'waiting_model'
  | 'generating'
  | 'finishing';

export const GENERATION_STAGE_LABELS_RU: Record<GenerationStage, string> = {
  connecting: 'Подключаюсь к помощнику…',
  waiting_model: 'Ожидаю ответ модели…',
  generating: 'Формирую ответ…',
  finishing: 'Завершаю ответ…',
};

export function getGenerationStageLabelRu(
  stage?: GenerationStage | null
): string {
  if (!stage) return GENERATION_STAGE_LABELS_RU.connecting;
  return (
    GENERATION_STAGE_LABELS_RU[stage] || GENERATION_STAGE_LABELS_RU.connecting
  );
}

export interface GeminiServerStatus {
  configured: boolean;
  model: string;
  sdkVersion: string;
  endpoint: string;
  providersState?: AIProvidersSystemState;
}

export interface GeminiChatMessageInput {
  role: 'user' | 'assistant' | 'pixel';
  content: string;
}

export interface PreparedApiImageItem {
  id: string;
  name: string;
  mimeType: string;
  base64Data: string;
}

export interface GeminiStreamRequestOptions {
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
  onDelta: (deltaText: string, accumulatedText: string) => void;
}

export interface GeminiChatMetrics {
  requestId: string;
  durationMs: number;
  timeToFirstTokenMs: number | null;
  chunkCount: number;
  charCount: number;
}

export interface GeminiChatResult {
  text: string;
  model: string;
  providerId?: AIProviderId;
  providerLabel?: string;
  failoverUsed?: boolean;
  failoverFromProvider?: AIProviderId;
  failoverNotice?: string;
  requestId?: string;
  aborted?: boolean;
  metrics?: GeminiChatMetrics;
}

export class ProviderDocumentConsentRequiredError extends Error {
  public readonly code = 'DOCUMENT_CONSENT_REQUIRED_FOR_PROVIDER';
  public readonly targetProvider: AIProviderId;
  public readonly targetProviderLabel: string;
  public readonly failedProvider?: AIProviderId;
  public readonly failedReason?: string;

  constructor(params: {
    message: string;
    targetProvider: AIProviderId;
    targetProviderLabel: string;
    failedProvider?: AIProviderId;
    failedReason?: string;
  }) {
    super(params.message);
    this.name = 'ProviderDocumentConsentRequiredError';
    this.targetProvider = params.targetProvider;
    this.targetProviderLabel = params.targetProviderLabel;
    this.failedProvider = params.failedProvider;
    this.failedReason = params.failedReason;
  }
}

export interface IGeminiProvider {
  getStatus(): Promise<GeminiServerStatus>;
  getDesignImageProviders(): Promise<ImageProvidersRegistryState>;
  checkDesignImageProviders(
    providerId?: ImageProviderId
  ): Promise<ImageProvidersRegistryState>;
  streamChat(options: GeminiStreamRequestOptions): Promise<GeminiChatResult>;
  generateDesignImage(params: {
    schoolId: SchoolId;
    providerId?: ImageProviderId;
    modelId?: FreeDesignImageModelId;
    prompt: string;
    aspectRatio: DesignAspectRatio;
    qualityMode: DesignQualityMode;
    templatePreset: DesignTemplatePresetId;
    suggestedHeadline?: string;
    suggestedOffer?: string;
    suggestedCta?: string;
    sourceImageBase64?: string;
    sourceImageMimeType?: string;
    selectionBox?: DesignSelectionBox;
    editInstruction?: string;
    referenceImageBase64?: string;
    referenceImageMimeType?: string;
  }): Promise<{
    providerId: ImageProviderId;
    modelUsed: DesignImageModelId;
    aspectRatio: DesignAspectRatio;
    qualityMode: DesignQualityMode;
    backgroundImageDataUrl: string;
    defaultLayers?: DesignOverlayLayer[];
    estimatedNeuronsUsed?: number;
    quotaSnapshot?: ImageProviderQuotaState;
    registryState?: ImageProvidersRegistryState;
    modelComment?: string;
  }>;
}

const activeRequestLocks = new Set<string>();

export const SLOW_RESPONSE_THRESHOLD_MS = 20000; // 20 seconds before showing slow-response hint
export const DEFAULT_CLIENT_TIMEOUT_MS = 75000; // 75 seconds hard client safety timeout

export const geminiProvider: IGeminiProvider = {
  async getStatus(): Promise<GeminiServerStatus> {
    const res = await fetch('/api/gemini/status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(
        'Не удалось проверить статус серверного маршрута ИИ-провайдеров.'
      );
    }
    return (await res.json()) as GeminiServerStatus;
  },

  async getDesignImageProviders(): Promise<ImageProvidersRegistryState> {
    const res = await fetch('/api/design/providers', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(
        'Не удалось получить статус бесплатных генераторов изображений.'
      );
    }
    return (await res.json()) as ImageProvidersRegistryState;
  },

  async checkDesignImageProviders(
    providerId?: ImageProviderId
  ): Promise<ImageProvidersRegistryState> {
    const res = await fetch('/api/design/providers/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(providerId ? { providerId } : {}),
    });
    if (!res.ok) {
      throw new Error(
        'Не удалось выполнить проверку подключения к генератору изображений.'
      );
    }
    return (await res.json()) as ImageProvidersRegistryState;
  },

  async streamChat(
    options: GeminiStreamRequestOptions
  ): Promise<GeminiChatResult> {
    const lockKey = `${options.mode}:${options.sessionId}`;
    if (activeRequestLocks.has(lockKey)) {
      throw new Error(
        'Запрос в этом диалоге уже выполняется. Дождитесь завершения текущего ответа или нажмите «Остановить».'
      );
    }

    activeRequestLocks.add(lockKey);
    const requestStartMs = Date.now();
    let accumulated = '';
    let resolvedModel = 'gemini-3.8-flash';
    let resolvedProviderId: AIProviderId = 'gemini';
    let resolvedProviderLabel = 'Google Gemini Free';
    let resolvedFailoverUsed = false;
    let resolvedFailoverFromProvider: AIProviderId | undefined;
    let resolvedFailoverNotice: string | undefined;
    let resolvedRequestId = `client-${requestStartMs.toString(36)}`;
    let timeToFirstTokenMs: number | null = null;
    let chunkCount = 0;
    let receivedDoneEvent = false;
    let timedOutByClient = false;

    const internalController = new AbortController();
    const onCallerAbort = () => {
      internalController.abort();
    };

    if (options.signal) {
      if (options.signal.aborted) {
        internalController.abort();
      } else {
        options.signal.addEventListener('abort', onCallerAbort);
      }
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_CLIENT_TIMEOUT_MS;
    const timeoutTimer = window.setTimeout(() => {
      timedOutByClient = true;
      internalController.abort();
    }, timeoutMs);

    const slowWarningTimer = window.setTimeout(() => {
      if (timeToFirstTokenMs === null && !internalController.signal.aborted) {
        options.onSlowWarning?.(true);
      }
    }, SLOW_RESPONSE_THRESHOLD_MS);

    const processRawEventBlock = (rawBlock: string) => {
      const lines = rawBlock.split('\n');
      for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith(':')) {
          continue;
        }
        if (!trimmed.startsWith('data:')) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr) continue;

        let parsed: {
          type?: 'stage' | 'delta' | 'done' | 'error';
          stage?: GenerationStage;
          requestId?: string;
          text?: string;
          model?: string;
          providerId?: AIProviderId;
          providerLabel?: string;
          failoverUsed?: boolean;
          failoverFromProvider?: AIProviderId;
          failoverNotice?: string;
          metrics?: GeminiChatMetrics;
          error?: {
            code?: string;
            message?: string;
            targetProvider?: AIProviderId;
            targetProviderLabel?: string;
            failedProvider?: AIProviderId;
            failedReason?: string;
          };
        };
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        if (parsed.requestId) {
          resolvedRequestId = parsed.requestId;
        }
        if (parsed.model) {
          resolvedModel = parsed.model;
        }
        if (parsed.providerId) {
          resolvedProviderId = parsed.providerId;
        }
        if (parsed.providerLabel) {
          resolvedProviderLabel = parsed.providerLabel;
        }
        if (typeof parsed.failoverUsed === 'boolean') {
          resolvedFailoverUsed = parsed.failoverUsed;
        }
        if (parsed.failoverFromProvider) {
          resolvedFailoverFromProvider = parsed.failoverFromProvider;
        }
        if (parsed.failoverNotice) {
          resolvedFailoverNotice = parsed.failoverNotice;
        }

        if (parsed.type === 'stage' && parsed.stage) {
          options.onStageChange?.(parsed.stage);
        } else if (parsed.type === 'delta' && typeof parsed.text === 'string') {
          if (parsed.text.length > 0) {
            if (timeToFirstTokenMs === null) {
              timeToFirstTokenMs = Date.now() - requestStartMs;
              window.clearTimeout(slowWarningTimer);
              options.onSlowWarning?.(false);
              options.onStageChange?.('generating');
            }
            chunkCount += 1;
            accumulated += parsed.text;
            options.onDelta(parsed.text, accumulated);
          }
        } else if (parsed.type === 'done') {
          receivedDoneEvent = true;
          options.onStageChange?.('finishing');
        } else if (parsed.type === 'error') {
          if (
            parsed.error?.code === 'DOCUMENT_CONSENT_REQUIRED_FOR_PROVIDER' &&
            parsed.error?.targetProvider
          ) {
            throw new ProviderDocumentConsentRequiredError({
              message:
                parsed.error.message ||
                `Для переключения на ${parsed.error.targetProviderLabel || parsed.error.targetProvider} требуется отдельное согласие на отправку текста документа.`,
              targetProvider: parsed.error.targetProvider,
              targetProviderLabel:
                parsed.error.targetProviderLabel || parsed.error.targetProvider,
              failedProvider: parsed.error.failedProvider,
              failedReason: parsed.error.failedReason,
            });
          }
          throw new Error(
            parsed.error?.message ||
              'Ошибка при генерации ответа на стороне сервера ИИ-провайдера.'
          );
        }
      }
    };

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    try {
      options.onStageChange?.('connecting');
      options.onSlowWarning?.(false);

      const response = await fetch('/api/gemini/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream, application/json',
        },
        body: JSON.stringify({
          schoolId: options.schoolId,
          mode: options.mode,
          sessionId: options.sessionId,
          messages: options.messages,
          selectedDocuments: options.selectedDocuments || [],
          selectedImages: options.selectedImages || [],
          knowledgeBaseContext: options.knowledgeBaseContext || [],
          pixelContext: options.pixelContext,
          externalApiConsentConfirmed: Boolean(
            options.externalApiConsentConfirmed
          ),
          consentedProviders: options.consentedProviders,
          providerSelection: options.providerSelection || 'auto',
          stream: true,
        }),
        signal: internalController.signal,
      });

      if (!response.ok) {
        let errorMessage = `Ошибка сервера (${response.status}).`;
        try {
          const errJson = await response.json();
          if (
            errJson?.error?.code === 'DOCUMENT_CONSENT_REQUIRED_FOR_PROVIDER' &&
            errJson?.error?.targetProvider
          ) {
            throw new ProviderDocumentConsentRequiredError({
              message:
                errJson.error.message ||
                `Для отправки документа в ${errJson.error.targetProviderLabel || errJson.error.targetProvider} требуется отдельное подтверждение.`,
              targetProvider: errJson.error.targetProvider,
              targetProviderLabel:
                errJson.error.targetProviderLabel ||
                errJson.error.targetProvider,
              failedProvider: errJson.error.failedProvider,
              failedReason: errJson.error.failedReason,
            });
          }
          if (errJson?.error?.message) {
            errorMessage = errJson.error.message;
          }
        } catch (parseOrCustomErr) {
          if (
            parseOrCustomErr instanceof ProviderDocumentConsentRequiredError
          ) {
            throw parseOrCustomErr;
          }
        }
        throw new Error(errorMessage);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!response.body || contentType.includes('application/json')) {
        const fallbackJson = await response.json();
        if (fallbackJson?.error?.message) {
          throw new Error(fallbackJson.error.message);
        }
        const text = String(fallbackJson?.text || '').trim();
        if (!text) {
          throw new Error(
            'Модель вернула пустой ответ. Вы можете нажать «Повторить отправку».'
          );
        }
        timeToFirstTokenMs = Date.now() - requestStartMs;
        chunkCount = 1;
        accumulated = text;
        options.onStageChange?.('generating');
        options.onDelta(text, accumulated);
        options.onStageChange?.('finishing');

        const durationMs = Date.now() - requestStartMs;
        return {
          text: accumulated,
          model: String(fallbackJson?.model || resolvedModel),
          providerId:
            (fallbackJson?.providerId as AIProviderId) || resolvedProviderId,
          providerLabel:
            String(fallbackJson?.providerLabel || '') || resolvedProviderLabel,
          failoverUsed: Boolean(
            fallbackJson?.failoverUsed ?? resolvedFailoverUsed
          ),
          failoverFromProvider:
            (fallbackJson?.failoverFromProvider as AIProviderId) ||
            resolvedFailoverFromProvider,
          failoverNotice:
            fallbackJson?.failoverNotice || resolvedFailoverNotice,
          requestId: fallbackJson?.requestId || resolvedRequestId,
          metrics: {
            requestId: fallbackJson?.requestId || resolvedRequestId,
            durationMs,
            timeToFirstTokenMs,
            chunkCount,
            charCount: accumulated.length,
          },
        };
      }

      options.onStageChange?.('waiting_model');

      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          if (buffer.trim().length > 0) {
            const normalizedTail = buffer.replace(/\r\n/g, '\n');
            const tailEvents = normalizedTail.split('\n\n');
            for (const ev of tailEvents) {
              if (ev.trim()) {
                processRawEventBlock(ev);
              }
            }
            buffer = '';
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const rawEvent of events) {
          if (rawEvent.trim()) {
            processRawEventBlock(rawEvent);
          }
        }
      }

      if (!accumulated.trim()) {
        throw new Error(
          receivedDoneEvent
            ? 'Модель вернула пустой ответ. Пожалуйста, нажмите «Повторить отправку».'
            : 'Соединение с сервером прервалось до получения текста ответа. Пожалуйста, нажмите «Повторить отправку».'
        );
      }

      const durationMs = Date.now() - requestStartMs;
      console.info('[AIClientDiag]', {
        requestId: resolvedRequestId,
        schoolId: options.schoolId,
        mode: options.mode,
        providerId: resolvedProviderId,
        model: resolvedModel,
        failoverUsed: resolvedFailoverUsed,
        status: 'ok',
        durationMs,
        timeToFirstTokenMs,
        chunkCount,
        charCount: accumulated.length,
      });

      return {
        text: accumulated,
        model: resolvedModel,
        providerId: resolvedProviderId,
        providerLabel: resolvedProviderLabel,
        failoverUsed: resolvedFailoverUsed,
        failoverFromProvider: resolvedFailoverFromProvider,
        failoverNotice: resolvedFailoverNotice,
        requestId: resolvedRequestId,
        metrics: {
          requestId: resolvedRequestId,
          durationMs,
          timeToFirstTokenMs,
          chunkCount,
          charCount: accumulated.length,
        },
      };
    } catch (err) {
      const durationMs = Date.now() - requestStartMs;
      const isAbort =
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && err.name === 'AbortError') ||
        Boolean(options.signal?.aborted);

      if (isAbort && !timedOutByClient) {
        return {
          text: accumulated,
          model: resolvedModel,
          providerId: resolvedProviderId,
          providerLabel: resolvedProviderLabel,
          failoverUsed: resolvedFailoverUsed,
          failoverFromProvider: resolvedFailoverFromProvider,
          failoverNotice: resolvedFailoverNotice,
          requestId: resolvedRequestId,
          aborted: true,
        };
      }

      if (err instanceof ProviderDocumentConsentRequiredError) {
        throw err;
      }

      const finalError = timedOutByClient
        ? new Error(
            'Превышено время ожидания ответа от модели (таймаут). Вы можете нажать «Повторить отправку».'
          )
        : err instanceof Error
          ? err
          : new Error('Произошла ошибка при получении ответа от ИИ-провайдера.');

      console.info('[AIClientDiag]', {
        requestId: resolvedRequestId,
        schoolId: options.schoolId,
        mode: options.mode,
        providerId: resolvedProviderId,
        model: resolvedModel,
        status: 'error',
        durationMs,
        timeToFirstTokenMs,
        chunkCount,
        charCount: accumulated.length,
        errorType: finalError.message.slice(0, 80),
      });

      throw finalError;
    } finally {
      window.clearTimeout(timeoutTimer);
      window.clearTimeout(slowWarningTimer);
      options.onSlowWarning?.(false);
      if (options.signal) {
        options.signal.removeEventListener('abort', onCallerAbort);
      }
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          // ignore cancel errors
        }
      }
      activeRequestLocks.delete(lockKey);
    }
  },

  async generateDesignImage(params: {
    schoolId: SchoolId;
    providerId?: ImageProviderId;
    modelId?: FreeDesignImageModelId;
    prompt: string;
    aspectRatio: DesignAspectRatio;
    qualityMode: DesignQualityMode;
    templatePreset: DesignTemplatePresetId;
    suggestedHeadline?: string;
    suggestedOffer?: string;
    suggestedCta?: string;
    sourceImageBase64?: string;
    sourceImageMimeType?: string;
    selectionBox?: DesignSelectionBox;
    editInstruction?: string;
    referenceImageBase64?: string;
    referenceImageMimeType?: string;
  }): Promise<{
    providerId: ImageProviderId;
    modelUsed: DesignImageModelId;
    aspectRatio: DesignAspectRatio;
    qualityMode: DesignQualityMode;
    backgroundImageDataUrl: string;
    defaultLayers?: DesignOverlayLayer[];
    estimatedNeuronsUsed?: number;
    quotaSnapshot?: ImageProviderQuotaState;
    registryState?: ImageProvidersRegistryState;
    modelComment?: string;
  }> {
    const res = await fetch('/api/gemini/design/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok || !data?.backgroundImageDataUrl) {
      throw new Error(
        data?.error || 'Не удалось сгенерировать визуальный макет.'
      );
    }
    return {
      providerId: data.providerId || 'cloudflare',
      modelUsed: data.modelUsed,
      aspectRatio: data.aspectRatio,
      qualityMode: data.qualityMode,
      backgroundImageDataUrl: data.backgroundImageDataUrl,
      defaultLayers: Array.isArray(data.defaultLayers)
        ? data.defaultLayers
        : undefined,
      estimatedNeuronsUsed: data.estimatedNeuronsUsed,
      quotaSnapshot: data.quotaSnapshot,
      registryState: data.registryState,
      modelComment: data.modelComment,
    };
  },
};

/**
 * Extracts structured `designer-concepts` JSON block from Designer's markdown response
 * and returns clean markdown + parsed DesignerInteractivePrompt.
 */
export function parseDesignerConceptsFromMarkdown(rawText: string): {
  cleanText: string;
  interactivePrompt?: DesignerInteractivePrompt;
} {
  if (!rawText) return { cleanText: '' };
  const fenceRegex = /```designer-concepts\s*([\s\S]*?)```/i;
  const match = rawText.match(fenceRegex);
  if (!match || !match[1]) {
    return { cleanText: rawText };
  }

  try {
    const parsed = JSON.parse(match[1].trim());
    const validRatios = new Set<DesignAspectRatio>([
      '3:4',
      '9:16',
      '1:1',
      '16:9',
      '4:3',
    ]);
    const concepts = Array.isArray(parsed?.concepts)
      ? parsed.concepts
          .filter((c: Record<string, unknown>) => c && typeof c.title === 'string')
          .map((c: Record<string, unknown>, idx: number) => ({
            id: typeof c.id === 'string' && c.id ? c.id : `concept-${idx + 1}`,
            title: String(c.title || `Концепция ${idx + 1}`),
            visualDirection: String(c.visualDirection || ''),
            compositionAndStyle: String(c.compositionAndStyle || ''),
            suggestedHeadline: String(c.suggestedHeadline || ''),
            suggestedOffer: String(c.suggestedOffer || ''),
            suggestedCta: String(c.suggestedCta || 'Записаться на пробный урок'),
            recommendedAspectRatio: validRatios.has(
              c.recommendedAspectRatio as DesignAspectRatio
            )
              ? (c.recommendedAspectRatio as DesignAspectRatio)
              : '3:4',
            imageGenerationPrompt: String(
              c.imageGenerationPrompt || c.visualDirection || c.title || ''
            ),
          }))
      : [];

    const questions = Array.isArray(parsed?.questions)
      ? parsed.questions
          .filter(
            (q: Record<string, unknown>) =>
              q && typeof q.question === 'string' && Array.isArray(q.options)
          )
          .map((q: Record<string, unknown>, idx: number) => ({
            id: typeof q.id === 'string' && q.id ? q.id : `q-${idx + 1}`,
            question: String(q.question),
            options: (q.options as unknown[]).map((o) => String(o)),
          }))
      : [];

    if (concepts.length === 0 && questions.length === 0) {
      return { cleanText: rawText };
    }

    const cleanText = rawText.replace(fenceRegex, '').trim();
    return {
      cleanText: cleanText || 'Я подготовил визуальные концепции по вашей задаче:',
      interactivePrompt: {
        concepts,
        selectedConceptId: concepts[0]?.id,
        questions,
      },
    };
  } catch {
    return { cleanText: rawText };
  }
}
