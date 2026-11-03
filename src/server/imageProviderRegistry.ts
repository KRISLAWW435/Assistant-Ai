import type {
  DesignAspectRatio,
  DesignQualityMode,
  DesignSelectionBox,
  FreeDesignImageModelId,
  ImageModelDescriptor,
  ImageProviderAvailabilityStatus,
  ImageProviderDescriptor,
  ImageProviderId,
  ImageProviderQuotaState,
  ImageProvidersRegistryState,
  SchoolId,
} from '../types/assistant';

export interface ImageGenerationAdapterRequest {
  schoolId: SchoolId;
  providerId: ImageProviderId;
  modelId: FreeDesignImageModelId;
  prompt: string;
  aspectRatio: DesignAspectRatio;
  qualityMode: DesignQualityMode;
  sourceImageBase64?: string;
  sourceImageMimeType?: string;
  selectionBox?: DesignSelectionBox;
  editInstruction?: string;
  referenceImageBase64?: string;
  referenceImageMimeType?: string;
}

export interface ImageGenerationAdapterResult {
  providerId: ImageProviderId;
  modelUsed: FreeDesignImageModelId;
  aspectRatio: DesignAspectRatio;
  qualityMode: DesignQualityMode;
  backgroundImageDataUrl: string;
  estimatedNeuronsUsed: number;
  modelComment?: string;
  quotaSnapshot: ImageProviderQuotaState;
}

export interface IImageGenerationProviderAdapter {
  readonly id: ImageProviderId;
  readonly label: string;
  readonly shortLabel: string;
  getDescriptor(): ImageProviderDescriptor;
  verifyAvailability(): Promise<ImageProviderDescriptor>;
  generateImage(
    req: ImageGenerationAdapterRequest
  ): Promise<ImageGenerationAdapterResult>;
}

export class ImageGenerationError extends Error {
  public readonly statusCode: number;
  public readonly errorCode:
    | 'NOT_CONFIGURED'
    | 'QUOTA_EXCEEDED'
    | 'UNSUPPORTED_FEATURE'
    | 'PROVIDER_ERROR';

  constructor(
    message: string,
    statusCode: number,
    errorCode:
      | 'NOT_CONFIGURED'
      | 'QUOTA_EXCEEDED'
      | 'UNSUPPORTED_FEATURE'
      | 'PROVIDER_ERROR'
  ) {
    super(message);
    this.name = 'ImageGenerationError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

const DAILY_FREE_NEURON_LIMIT = 10000;

function getUtcDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getAspectDimensions(aspectRatio: DesignAspectRatio): {
  width: number;
  height: number;
} {
  switch (aspectRatio) {
    case '3:4':
      return { width: 768, height: 1024 };
    case '9:16':
      return { width: 576, height: 1024 };
    case '16:9':
      return { width: 1024, height: 576 };
    case '4:3':
      return { width: 1024, height: 768 };
    case '1:1':
    default:
      return { width: 1024, height: 1024 };
  }
}

function detectImageMimeFromBase64(base64: string, fallback = 'image/png'): string {
  const trimmed = base64.trim();
  if (trimmed.startsWith('/9j/')) return 'image/jpeg';
  if (trimmed.startsWith('iVBOR')) return 'image/png';
  if (trimmed.startsWith('UklGR')) return 'image/webp';
  return fallback;
}

function maskSecretToken(token: string): string {
  const trimmed = (token || '').trim();
  if (!trimmed) return 'Не настроен';
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

const STATUS_LABELS_RU: Record<ImageProviderAvailabilityStatus, string> = {
  available: 'Доступен (Бесплатный тариф)',
  not_configured: 'Не настроен (требуются Account ID и API Token)',
  quota_exceeded: 'Бесплатная квота исчерпана (ожидание сброса в 00:00 UTC)',
  error: 'Ошибка подключения к API',
};

export class CloudflareWorkersAiImageAdapter
  implements IImageGenerationProviderAdapter
{
  public readonly id: ImageProviderId = 'cloudflare';
  public readonly label = 'Cloudflare Workers AI (Бесплатный тариф)';
  public readonly shortLabel = 'Cloudflare Free';

  private accountIdOverride = '';
  private apiTokenOverride = '';

  private utcDateKey = getUtcDateKey();
  private requestsTodayCount = 0;
  private estimatedNeuronsUsedToday = 0;
  private isQuotaExhausted = false;
  private lastError: string | undefined;
  private lastVerifiedStatus: ImageProviderAvailabilityStatus | null = null;
  private lastCheckedAtIso: string | undefined;

  public setCredentials(accountId: string, apiToken: string): void {
    this.accountIdOverride = (accountId || '').trim();
    this.apiTokenOverride = (apiToken || '').trim();
    this.lastError = undefined;
    this.isQuotaExhausted = false;
    this.lastVerifiedStatus = null;
  }

  private resolveCredentials(): { accountId: string; apiToken: string } {
    const accountId = (
      this.accountIdOverride ||
      process.env.CLOUDFLARE_ACCOUNT_ID ||
      ''
    ).trim();
    const apiToken = (
      this.apiTokenOverride ||
      process.env.CLOUDFLARE_API_TOKEN ||
      ''
    ).trim();
    return { accountId, apiToken };
  }

  public isConfigured(): boolean {
    const { accountId, apiToken } = this.resolveCredentials();
    return accountId.length >= 10 && apiToken.length >= 10;
  }

  private ensureFreshUtcDay(): void {
    const today = getUtcDateKey();
    if (this.utcDateKey !== today) {
      this.utcDateKey = today;
      this.requestsTodayCount = 0;
      this.estimatedNeuronsUsedToday = 0;
      this.isQuotaExhausted = false;
      this.lastError = undefined;
    }
  }

  private resolveCurrentStatus(): ImageProviderAvailabilityStatus {
    this.ensureFreshUtcDay();
    if (!this.isConfigured()) {
      return 'not_configured';
    }
    if (this.isQuotaExhausted) {
      return 'quota_exceeded';
    }
    if (this.lastVerifiedStatus === 'error') {
      return 'error';
    }
    return 'available';
  }

  public getQuotaSnapshot(): ImageProviderQuotaState {
    this.ensureFreshUtcDay();
    return {
      dailyLimitLabel: '10 000 Neurons / сутки (бесплатный тариф Workers Free)',
      resetScheduleLabel: 'Ежедневно в 00:00 UTC',
      requestsTodayCount: this.requestsTodayCount,
      estimatedNeuronsUsedToday: this.estimatedNeuronsUsedToday,
      dailyFreeNeuronLimit: DAILY_FREE_NEURON_LIMIT,
      remainingQuotaStatus: 'unknown',
      remainingQuotaLabelRu:
        'Неизвестен (Cloudflare REST API не возвращает точный остаток квоты в заголовках ответа)',
      isExhausted: this.isQuotaExhausted,
      lastError: this.lastError,
      utcDateKey: this.utcDateKey,
    };
  }

  public getModels(): ImageModelDescriptor[] {
    const providerStatus = this.resolveCurrentStatus();
    const statusLabel = STATUS_LABELS_RU[providerStatus];

    return [
      {
        id: '@cf/black-forest-labs/flux-1-schnell',
        providerId: 'cloudflare',
        label: 'FLUX.1 Schnell (Быстрая генерация фона)',
        shortLabel: 'FLUX.1 Schnell',
        descriptionRu:
          'Быстрая бесплатная генерация чистой визуальной основы по текстовому промпту за 4 шага.',
        isFreeTier: true,
        status: providerStatus,
        statusLabelRu: statusLabel,
        supportsReferenceImage: false,
        supportsImageEditing: false,
        supportedAspectRatios: ['1:1', '3:4', '9:16', '16:9', '4:3'],
        maxResolutionLabel: 'До 1024×1024 px',
        inputImageLimitLabel: 'Не поддерживает входные изображения (только текстовый промпт)',
        estimatedNeuronsPerRun: 55,
        limitationsRu: [
          'Только генерация по тексту (Text-to-Image), 4–8 шагов (по умолчанию 4 шага).',
          'Не поддерживает референс-изображения и точечное редактирование.',
          'Расходует ~50–110 Neurons из бесплатного лимита 10 000 Neurons/день.',
        ],
      },
      {
        id: '@cf/black-forest-labs/flux-2-klein-9b',
        providerId: 'cloudflare',
        label: 'FLUX.2 Klein 9B (Детализация + Референсы и правки)',
        shortLabel: 'FLUX.2 Klein 9B',
        descriptionRu:
          'Современная дистиллированная модель FLUX.2 (9B): поддерживает генерацию по тексту, референс-изображения и доработку макета.',
        isFreeTier: true,
        status: providerStatus,
        statusLabelRu: statusLabel,
        supportsReferenceImage: true,
        supportsImageEditing: true,
        supportedAspectRatios: ['3:4', '9:16', '1:1', '16:9', '4:3'],
        maxResolutionLabel: 'До 1024×1024 px (пропорции 3:4, 9:16, 1:1, 16:9, 4:3)',
        inputImageLimitLabel: 'До 4 входных изображений (рекомендуемо до 512×512 px)',
        estimatedNeuronsPerRun: 160,
        limitationsRu: [
          'Фиксированные 4 шага инференса, формат запроса multipart/form-data.',
          'Принимает референсы и исходник для редактирования по инструкции.',
          'Расходует ~140–220 Neurons из бесплатного лимита 10 000 Neurons/день.',
        ],
      },
    ];
  }

  public getDescriptor(): ImageProviderDescriptor {
    const status = this.resolveCurrentStatus();
    const { accountId, apiToken } = this.resolveCredentials();
    const hasSavedToken = apiToken.length >= 10;
    return {
      id: this.id,
      label: this.label,
      shortLabel: this.shortLabel,
      isFreeTierOnly: true,
      configured: this.isConfigured(),
      configuredAccountId: accountId || '',
      maskedApiToken: hasSavedToken ? maskSecretToken(apiToken) : 'Не настроен',
      hasSavedToken,
      status,
      statusLabelRu: STATUS_LABELS_RU[status],
      lastCheckedAtIso: this.lastCheckedAtIso,
      quota: this.getQuotaSnapshot(),
      models: this.getModels(),
    };
  }

  public async verifyAvailability(): Promise<ImageProviderDescriptor> {
    this.ensureFreshUtcDay();
    this.lastCheckedAtIso = new Date().toISOString();

    if (!this.isConfigured()) {
      this.lastVerifiedStatus = 'not_configured';
      this.lastError =
        'Не заданы Account ID и API Token для Cloudflare Workers AI.';
      return this.getDescriptor();
    }

    const { accountId, apiToken } = this.resolveCredentials();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);

    try {
      const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/models/search?per_page=5`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Accept: 'application/json',
        },
        signal: ctrl.signal,
      });

      if (res.status === 429) {
        this.isQuotaExhausted = true;
        this.lastVerifiedStatus = 'quota_exceeded';
        this.lastError =
          'Достигнут лимит запросов или исчерпана бесплатная дневная квота Cloudflare Workers AI (HTTP 429).';
        return this.getDescriptor();
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        const apiErrMsg =
          errJson?.errors?.[0]?.message ||
          `HTTP ${res.status}: не удалось подтвердить доступ к Cloudflare Workers AI.`;
        this.lastVerifiedStatus = 'error';
        this.lastError = apiErrMsg;
        return this.getDescriptor();
      }

      this.lastVerifiedStatus = this.isQuotaExhausted
        ? 'quota_exceeded'
        : 'available';
      this.lastError = undefined;
      return this.getDescriptor();
    } catch (err) {
      this.lastVerifiedStatus = 'error';
      this.lastError =
        err instanceof Error
          ? `Ошибка соединения с Cloudflare API: ${err.message}`
          : 'Ошибка соединения с Cloudflare API.';
      return this.getDescriptor();
    } finally {
      clearTimeout(timer);
    }
  }

  public async generateImage(
    req: ImageGenerationAdapterRequest
  ): Promise<ImageGenerationAdapterResult> {
    this.ensureFreshUtcDay();

    if (!this.isConfigured()) {
      throw new ImageGenerationError(
        'Генератор изображений не подключён. Обратитесь к администратору.',
        400,
        'NOT_CONFIGURED'
      );
    }

    if (this.isQuotaExhausted) {
      throw new ImageGenerationError(
        'Бесплатная дневная квота Cloudflare Workers AI (10 000 Neurons/сутки) исчерпана. Генерация остановлена без платных запросов. Дождитесь сброса квоты в 00:00 UTC.',
        429,
        'QUOTA_EXCEEDED'
      );
    }

    const models = this.getModels();
    const modelMeta = models.find((m) => m.id === req.modelId) || models[0];
    const hasInputImage = Boolean(
      (req.sourceImageBase64 && req.sourceImageBase64.trim()) ||
        (req.referenceImageBase64 && req.referenceImageBase64.trim())
    );
    const hasEditInstruction = Boolean(
      req.editInstruction && req.editInstruction.trim()
    );

    if (
      modelMeta.id === '@cf/black-forest-labs/flux-1-schnell' &&
      (hasInputImage || hasEditInstruction)
    ) {
      throw new ImageGenerationError(
        'Модель FLUX.1 Schnell поддерживает только генерацию по тексту (Text-to-Image) без входных изображений и точечных правок. Выберите бесплатную модель FLUX.2 Klein 9B для работы с референсами и редактирования.',
        400,
        'UNSUPPORTED_FEATURE'
      );
    }

    const { accountId, apiToken } = this.resolveCredentials();
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${modelMeta.id}`;
    const { width, height } = getAspectDimensions(req.aspectRatio);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 55000);

    try {
      let fetchResponse: globalThis.Response;

      if (modelMeta.id === '@cf/black-forest-labs/flux-2-klein-9b') {
        const formData = new FormData();
        formData.append('prompt', req.prompt);
        formData.append('width', String(width));
        formData.append('height', String(height));

        const rawImageBase64 =
          req.sourceImageBase64 || req.referenceImageBase64 || '';
        const rawMime =
          req.sourceImageMimeType || req.referenceImageMimeType || 'image/png';

        if (rawImageBase64.trim()) {
          const cleanBase64 = rawImageBase64.replace(
            /^data:image\/[a-zA-Z0-9+.-]+;base64,/,
            ''
          );
          const binaryBuffer = Buffer.from(cleanBase64, 'base64');
          const imageBlob = new Blob([binaryBuffer], { type: rawMime });
          formData.append('image', imageBlob, 'input.png');
        }

        fetchResponse = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
          },
          body: formData,
          signal: ctrl.signal,
        });
      } else {
        // @cf/black-forest-labs/flux-1-schnell uses JSON body
        fetchResponse = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: req.prompt,
            steps: 4,
          }),
          signal: ctrl.signal,
        });
      }

      const contentType = (
        fetchResponse.headers.get('content-type') || ''
      ).toLowerCase();

      if (!fetchResponse.ok) {
        let errorDetail = `HTTP ${fetchResponse.status}`;
        if (contentType.includes('application/json')) {
          const errJson = await fetchResponse.json().catch(() => null);
          const msg =
            errJson?.errors?.[0]?.message ||
            errJson?.error ||
            JSON.stringify(errJson || {});
          errorDetail = String(msg);
        } else {
          const errText = await fetchResponse.text().catch(() => '');
          if (errText) errorDetail = errText.slice(0, 240);
        }

        const lowerErr = errorDetail.toLowerCase();
        const isQuotaErr =
          fetchResponse.status === 429 ||
          lowerErr.includes('neuron') ||
          lowerErr.includes('quota') ||
          lowerErr.includes('allocation') ||
          lowerErr.includes('rate limit') ||
          lowerErr.includes('3036') ||
          lowerErr.includes('4006');

        if (isQuotaErr) {
          this.isQuotaExhausted = true;
          this.lastVerifiedStatus = 'quota_exceeded';
          this.lastError =
            'Бесплатная дневная квота Cloudflare Workers AI (10 000 Neurons/сутки) исчерпана или превышен лимит запросов (HTTP 429).';
          throw new ImageGenerationError(
            `${this.lastError} Генерация остановлена без платных вызовов. Вы можете дождаться сброса бесплатной квоты в 00:00 UTC.`,
            429,
            'QUOTA_EXCEEDED'
          );
        }

        this.lastVerifiedStatus = 'error';
        this.lastError = errorDetail;
        throw new ImageGenerationError(
          `Ошибка генерации Cloudflare Workers AI (${modelMeta.shortLabel}): ${errorDetail}`,
          fetchResponse.status >= 400 && fetchResponse.status < 600
            ? fetchResponse.status
            : 502,
          'PROVIDER_ERROR'
        );
      }

      let base64Image = '';
      let resolvedMimeType = 'image/png';

      if (contentType.includes('application/json')) {
        const json = (await fetchResponse.json()) as {
          success?: boolean;
          result?: { image?: string } | string;
          errors?: Array<{ message?: string }>;
        };
        if (json.success === false) {
          const errMsg =
            json.errors?.[0]?.message ||
            'Cloudflare Workers AI вернул неуспешный ответ.';
          throw new ImageGenerationError(errMsg, 502, 'PROVIDER_ERROR');
        }
        if (typeof json.result === 'string') {
          base64Image = json.result;
        } else if (json.result && typeof json.result.image === 'string') {
          base64Image = json.result.image;
        }
        resolvedMimeType = detectImageMimeFromBase64(base64Image, 'image/jpeg');
      } else {
        const arrayBuf = await fetchResponse.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        base64Image = buf.toString('base64');
        resolvedMimeType = contentType.startsWith('image/')
          ? contentType.split(';')[0].trim()
          : detectImageMimeFromBase64(base64Image, 'image/png');
      }

      if (!base64Image) {
        throw new ImageGenerationError(
          `Модель ${modelMeta.shortLabel} не вернула данные изображения.`,
          502,
          'PROVIDER_ERROR'
        );
      }

      // Record usage in local daily counter
      this.requestsTodayCount += 1;
      this.estimatedNeuronsUsedToday += modelMeta.estimatedNeuronsPerRun;
      this.lastVerifiedStatus = 'available';
      this.lastError = undefined;

      if (this.estimatedNeuronsUsedToday >= DAILY_FREE_NEURON_LIMIT) {
        this.isQuotaExhausted = true;
      }

      const cleanBase64 = base64Image.replace(
        /^data:image\/[a-zA-Z0-9+.-]+;base64,/,
        ''
      );
      const backgroundImageDataUrl = `data:${resolvedMimeType};base64,${cleanBase64}`;

      return {
        providerId: 'cloudflare',
        modelUsed: modelMeta.id,
        aspectRatio: req.aspectRatio,
        qualityMode: 'standard',
        backgroundImageDataUrl,
        estimatedNeuronsUsed: modelMeta.estimatedNeuronsPerRun,
        quotaSnapshot: this.getQuotaSnapshot(),
      };
    } catch (err) {
      if (err instanceof ImageGenerationError) {
        throw err;
      }
      const msg =
        err instanceof Error ? err.message : 'Неизвестная ошибка сети';
      this.lastError = msg;
      throw new ImageGenerationError(
        `Не удалось выполнить бесплатный запрос к Cloudflare Workers AI: ${msg}`,
        502,
        'PROVIDER_ERROR'
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export class ImageProviderRegistry {
  private adapters = new Map<ImageProviderId, IImageGenerationProviderAdapter>();
  public readonly defaultProviderId: ImageProviderId = 'cloudflare';
  public readonly defaultModelId: FreeDesignImageModelId =
    '@cf/black-forest-labs/flux-1-schnell';

  constructor() {
    const cfAdapter = new CloudflareWorkersAiImageAdapter();
    this.adapters.set(cfAdapter.id, cfAdapter);
  }

  public getCloudflareAdapter(): CloudflareWorkersAiImageAdapter {
    return this.adapters.get('cloudflare') as CloudflareWorkersAiImageAdapter;
  }

  public getAdapter(
    providerId: ImageProviderId = this.defaultProviderId
  ): IImageGenerationProviderAdapter {
    const found = this.adapters.get(providerId);
    if (!found) {
      throw new ImageGenerationError(
        `Провайдер генерации изображений «${providerId}» не зарегистрирован в списке бесплатных провайдеров.`,
        400,
        'UNSUPPORTED_FEATURE'
      );
    }
    return found;
  }

  public getState(): ImageProvidersRegistryState {
    const providers = Array.from(this.adapters.values()).map((a) =>
      a.getDescriptor()
    );
    return {
      defaultProviderId: this.defaultProviderId,
      defaultModelId: this.defaultModelId,
      providers,
    };
  }

  public async verifyAllProviders(): Promise<ImageProvidersRegistryState> {
    const providers: ImageProviderDescriptor[] = [];
    for (const adapter of this.adapters.values()) {
      providers.push(await adapter.verifyAvailability());
    }
    return {
      defaultProviderId: this.defaultProviderId,
      defaultModelId: this.defaultModelId,
      providers,
    };
  }
}

export const imageProviderRegistry = new ImageProviderRegistry();
