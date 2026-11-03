import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  GraduationCap,
  HardDrive,
  Headphones,
  Info,
  KeyRound,
  Layers,
  Loader2,
  Megaphone,
  MessageSquareHeart,
  Mic,
  Palette,
  Play,
  Edit3,
  FolderOpen,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  X,
  Zap,
} from 'lucide-react';
import {
  AIConnectionProfile,
  AIConnectionStatus,
  AIProviderId,
  FailoverSequenceSettings,
  NavSection,
  OllamaLocalInfo,
  SchoolId,
  SpecialistModelAssignments,
  SpecialistRoleKey,
} from '../types/assistant';
import {
  aiConnectionManager,
  GEMINI_AVAILABLE_MODELS,
  getDefaultFailoverSettings,
  getDefaultSpecialistAssignments,
  maskApiKey,
  RECOMMENDED_OLLAMA_MODELS,
} from '../providers/aiConnectionManager';
import { ConnectionTestResult } from '../types/electronBridge';
import { SCHOOLS } from '../config/schoolsAndModes';
import {
  DEFAULT_PIXEL_VOICE_SETTINGS,
  GEMINI_TTS_STANDARD_STYLE,
  GEMINI_TTS_VOICES,
  GeminiVoiceSampleOption,
  PIXEL_COMPARISON_PHRASE,
  PixelVoiceSettings,
  WAKE_WORD_STATE_META,
} from '../types/voice';
import {
  resolveBrowserPitchForTimbre,
  voiceManager,
} from '../providers/voice/voiceManager';
import {
  voiceDiagnosticManager,
  VoiceDiagnosticEntry,
  MicrophoneDiagnosticReport,
} from '../providers/voice/voiceDiagnosticManager';
import { wakeWordManager } from '../providers/voice/wakeWordManager';
import { pixelVoiceCoordinator } from '../providers/voice/pixelVoiceCoordinator';
import { annaMemoryManager } from '../providers/annaMemoryManager';
import {
  AnnaMemoryBundle,
  AnnaMemoryCategory,
  AnnaMemoryItem,
  AnnaMemoryStatus,
} from '../types/annaMemory';

interface ConnectionsViewProps {
  activeSchool: SchoolId;
  onNavigate: (section: NavSection) => void;
  onRefreshProviders?: () => Promise<void>;
}

type ConnectionsSubTab =
  | 'providers'
  | 'specialists'
  | 'failover'
  | 'ollama'
  | 'voice'
  | 'diagnostics'
  | 'memory';

interface ModalFormState {
  isOpen: boolean;
  isEditing: boolean;
  profileId?: string;
  providerId: AIProviderId;
  userDefinedName: string;
  rawApiKey: string;
  selectedModel: string;
  isDefault: boolean;
  showRawKey: boolean;
}

const INITIAL_MODAL_STATE: ModalFormState = {
  isOpen: false,
  isEditing: false,
  providerId: 'gemini',
  userDefinedName: '',
  rawApiKey: '',
  selectedModel: 'gemini-3.8-flash',
  isDefault: false,
  showRawKey: false,
};

const SPECIALIST_CONFIGS: Array<{
  key: SpecialistRoleKey;
  label: string;
  tagline: string;
  icon: React.ComponentType<{ className?: string }>;
  defaultModel: string;
}> = [
  {
    key: 'marketer',
    label: 'Маркетолог',
    tagline: 'Контент-планы, рекламные посты VK, офферы и рассылки',
    icon: Megaphone,
    defaultModel: 'gemini-3.8-flash',
  },
  {
    key: 'manager',
    label: 'Менеджер по родителям',
    tagline: 'Скрипты диалогов, обработка возражений, запись на пробные уроки',
    icon: MessageSquareHeart,
    defaultModel: 'gemini-3.8-flash',
  },
  {
    key: 'methodist',
    label: 'Методист',
    tagline: 'Структура модулей, практические задания и результаты учеников',
    icon: GraduationCap,
    defaultModel: 'gemini-3.8-flash',
  },
  {
    key: 'analyst',
    label: 'Бизнес-аналитик',
    tagline: 'Воронка заявок, конверсии, удержание и разбор отчётов',
    icon: BarChart3,
    defaultModel: 'gemini-3.8-flash',
  },
  {
    key: 'designer',
    label: 'Дизайнер',
    tagline: 'Визуальные концепции, баннеры, креативы и макеты по брендбуку',
    icon: Palette,
    defaultModel: 'gemini-3.8-flash',
  },
  {
    key: 'pixel',
    label: 'Помощник Пиксель',
    tagline: 'Личный компаньон Анны: задачи, память, быстрые заметки',
    icon: Sparkles,
    defaultModel: 'gemini-3.8-flash',
  },
];

export const ConnectionsView: React.FC<ConnectionsViewProps> = ({
  activeSchool,
  onNavigate,
  onRefreshProviders,
}) => {
  const [activeTab, setActiveTab] = useState<ConnectionsSubTab>('providers');

  // Core Data
  const [profiles, setProfiles] = useState<AIConnectionProfile[]>([]);
  const [specialists, setSpecialists] = useState<SpecialistModelAssignments>(
    getDefaultSpecialistAssignments()
  );
  const [failover, setFailover] = useState<FailoverSequenceSettings>(
    getDefaultFailoverSettings()
  );
  const [ollamaInfo, setOllamaInfo] = useState<OllamaLocalInfo>({
    installed: false,
    running: false,
    apiUrl: 'http://127.0.0.1:11434',
    models: [],
  });

  // UI States
  const [isLoading, setIsLoading] = useState(true);
  const [isTestingAll, setIsTestingAll] = useState(false);
  const [testingProfileId, setTestingProfileId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, ConnectionTestResult>
  >({});
  const [bannerNotice, setBannerNotice] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Modal Form
  const [modalState, setModalState] =
    useState<ModalFormState>(INITIAL_MODAL_STATE);
  const [isSubmittingModal, setIsSubmittingModal] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Delete Confirmation Modal
  const [pendingDeleteProfile, setPendingDeleteProfile] =
    useState<AIConnectionProfile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Copied helper
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const isElectron = aiConnectionManager.isElectron();
  const isSafeStorage = aiConnectionManager.isSafeStorageActive();

  // Voice Settings State
  const [voiceSettings, setVoiceSettings] = useState<PixelVoiceSettings>(() =>
    voiceManager.getSettings()
  );
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [isGeneratingLiveTTS, setIsGeneratingLiveTTS] = useState(false);
  const [liveTestError, setLiveTestError] = useState<string | null>(null);
  const [liveTestResult, setLiveTestResult] = useState<{
    provider: 'gemini' | 'browser_fallback';
    voice: string;
    fromCache?: boolean;
    model?: string;
    notice?: string;
  } | null>(null);
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);

  // Voice Diagnostics State
  const [diagEntries, setDiagEntries] = useState<VoiceDiagnosticEntry[]>(() =>
    voiceDiagnosticManager.getEntries()
  );
  const [diagFilter, setDiagFilter] = useState<'all' | 'errors' | 'speech' | 'matches'>('all');
  const [isTestingHardware, setIsTestingHardware] = useState(false);
  const [hardwareReport, setHardwareReport] = useState<MicrophoneDiagnosticReport | null>(null);
  const [copyDiagSuccess, setCopyDiagSuccess] = useState(false);
  const [coordinatorSnapshot, setCoordinatorSnapshot] = useState(() =>
    pixelVoiceCoordinator.getSnapshot()
  );

  useEffect(() => {
    const unsubEntries = voiceDiagnosticManager.onEntriesChange((updated) => {
      setDiagEntries(updated);
    });
    const unsubCoord = pixelVoiceCoordinator.onStateChange((snap) => {
      setCoordinatorSnapshot(snap);
    });

    voiceDiagnosticManager
      .runHardwareAndPermissionTest(false)
      .then((rep) => setHardwareReport(rep))
      .catch(() => {});

    return () => {
      unsubEntries();
      unsubCoord();
      if (sampleAudioRef.current) {
        try {
          sampleAudioRef.current.pause();
          sampleAudioRef.current.currentTime = 0;
        } catch {
          // ignore
        }
        sampleAudioRef.current = null;
      }
      voiceManager.stopSpeaking();
    };
  }, []);

  const stopAnySample = () => {
    if (sampleAudioRef.current) {
      try {
        sampleAudioRef.current.pause();
        sampleAudioRef.current.currentTime = 0;
      } catch {
        // ignore
      }
      sampleAudioRef.current = null;
    }
    setPlayingVoiceId(null);
  };

  const handleVoiceSettingsUpdate = (partial: Partial<PixelVoiceSettings>) => {
    const next = voiceManager.updateSettings({
      ...partial,
      ttsProviderId: 'gemini',
      selectedTimbreId: 'bright',
      autoSpeakNewReplies: false,
    });
    setVoiceSettings(next);
  };

  const handlePlayStaticAudio = (audioId: string, audioUrl: string) => {
    if (playingVoiceId === audioId) {
      stopAnySample();
      return;
    }

    stopAnySample();
    voiceManager.stopSpeaking();

    const audio = new Audio(audioUrl);
    sampleAudioRef.current = audio;
    audio.volume = voiceSettings.volume;
    setPlayingVoiceId(audioId);

    audio.onended = () => {
      setPlayingVoiceId(null);
      sampleAudioRef.current = null;
    };
    audio.onerror = () => {
      setPlayingVoiceId(null);
      sampleAudioRef.current = null;
    };
    audio.play().catch(() => {
      setPlayingVoiceId(null);
      sampleAudioRef.current = null;
    });
  };

  const handlePlayVoiceSample = (voice: GeminiVoiceSampleOption) => {
    handlePlayStaticAudio(`voice_${voice.id}`, voice.sampleUrl);
  };

  const handleGenerateLiveTest = async () => {
    if (playingVoiceId === 'live_test') {
      stopAnySample();
      voiceManager.stopSpeaking();
      return;
    }

    stopAnySample();
    voiceManager.stopSpeaking();
    setIsGeneratingLiveTTS(true);
    setLiveTestError(null);
    setLiveTestResult(null);

    try {
      const response = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: PIXEL_COMPARISON_PHRASE,
          voice: voiceSettings.selectedGeminiVoice || 'Aoede',
          style: GEMINI_TTS_STANDARD_STYLE,
          timbreId: 'bright',
          model: 'gemini-3.8-flash-lite-tts',
          forceRefresh: true,
        }),
      });

      if (!response.ok) {
        let errMessage = `Сбой API (${response.status})`;
        try {
          const errData = await response.json();
          if (errData?.error) errMessage = errData.error;
        } catch {
          // ignore
        }

        if (
          voiceSettings.allowBrowserFallback &&
          voiceManager.getBrowserOutputProvider().isSupported()
        ) {
          const adaptedPitch = resolveBrowserPitchForTimbre(
            'bright',
            voiceSettings.pitch
          );
          setPlayingVoiceId('live_test');
          setLiveTestResult({
            provider: 'browser_fallback',
            voice: voiceSettings.selectedGeminiVoice || 'Aoede',
            notice:
              response.status === 429
                ? 'Лимит Gemini TTS временно исчерпан. Сработал резервный синтез речи браузера.'
                : `Сервер вернул статус ${response.status}. Воспроизведён резервный синтез.`,
          });

          await voiceManager
            .getBrowserOutputProvider()
            .speak(PIXEL_COMPARISON_PHRASE, {
              voiceURI: voiceSettings.voiceURI,
              rate: voiceSettings.rate,
              pitch: adaptedPitch,
              volume: voiceSettings.volume,
              onEnd: () => setPlayingVoiceId(null),
              onError: () => setPlayingVoiceId(null),
            });
          return;
        }

        throw new Error(errMessage);
      }

      const data = await response.json();
      if (!data?.audioBase64) {
        throw new Error('Пустой аудио-ответ от сервера');
      }

      setLiveTestResult({
        provider: 'gemini',
        voice: data.voice || voiceSettings.selectedGeminiVoice || 'Aoede',
        fromCache: Boolean(data.fromCache),
        model: data.model || 'gemini-3.8-flash-lite-tts',
      });

      const audioUrl = `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`;
      const audio = new Audio(audioUrl);
      sampleAudioRef.current = audio;
      audio.volume = voiceSettings.volume;
      setPlayingVoiceId('live_test');

      audio.onended = () => {
        setPlayingVoiceId(null);
        sampleAudioRef.current = null;
      };

      audio.onerror = () => {
        setPlayingVoiceId(null);
        sampleAudioRef.current = null;
        setLiveTestError('Ошибка воспроизведения аудиофайла');
      };

      await audio.play();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLiveTestError(msg);
    } finally {
      setIsGeneratingLiveTTS(false);
    }
  };

  const handleResetVoiceDefaults = () => {
    stopAnySample();
    voiceManager.stopSpeaking();
    const reset = voiceManager.updateSettings({
      ...DEFAULT_PIXEL_VOICE_SETTINGS,
      autoSpeakNewReplies: false,
      selectedTimbreId: 'bright',
    });
    setVoiceSettings(reset);
    setLiveTestError(null);
    setLiveTestResult(null);
  };

  const handleRunHardwareTest = async () => {
    setIsTestingHardware(true);
    try {
      const rep = await voiceDiagnosticManager.runHardwareAndPermissionTest(true);
      setHardwareReport(rep);
      if (rep.permissionState === 'granted') {
        wakeWordManager.startListening();
      }
    } finally {
      setIsTestingHardware(false);
    }
  };

  const handleRestartStandby = () => {
    wakeWordManager.requestStandbyRestart('Ручной перезапуск из панели настроек');
  };

  const handleCopyDiagLog = async () => {
    const text = voiceDiagnosticManager.exportLogAsText();
    try {
      await navigator.clipboard.writeText(text);
      setCopyDiagSuccess(true);
      setTimeout(() => setCopyDiagSuccess(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleDownloadDiagLog = () => {
    const text = voiceDiagnosticManager.exportLogAsText();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pixel-voice-diag-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleClearDiagLog = () => {
    voiceDiagnosticManager.clear();
    setDiagEntries([]);
  };

  const filteredDiagEntries = diagEntries.filter((e) => {
    if (diagFilter === 'errors') {
      return e.level === 'error' || e.level === 'warn';
    }
    if (diagFilter === 'speech') {
      return e.category === 'speech' || e.category === 'engine';
    }
    if (diagFilter === 'matches') {
      return e.category === 'match';
    }
    return true;
  });

  // =========================================================================
  // ANNA LONG-TERM MEMORY STATE & ACTIONS
  // =========================================================================
  const [annaMemoryBundle, setAnnaMemoryBundle] = useState<AnnaMemoryBundle>(
    () => annaMemoryManager.getAll()
  );
  const [annaStorageInfo, setAnnaStorageInfo] = useState(() =>
    annaMemoryManager.getStorageInfoSync()
  );
  const [selectedMemoryFilterCat, setSelectedMemoryFilterCat] = useState<
    AnnaMemoryCategory | 'all'
  >('all');
  const [isNewMemoryModalOpen, setIsNewMemoryModalOpen] = useState(false);
  const [editingMemoryItem, setEditingMemoryItem] =
    useState<AnnaMemoryItem | null>(null);
  const [confirmClearAllMemory, setConfirmClearAllMemory] = useState(false);
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null);

  // Form fields for new / edit memory
  const [memFormCategory, setMemFormCategory] =
    useState<AnnaMemoryCategory>('confirmed_fact');
  const [memFormStatus, setMemFormStatus] =
    useState<AnnaMemoryStatus>('confirmed_fact');
  const [memFormTitle, setMemFormTitle] = useState('');
  const [memFormContent, setMemFormContent] = useState('');
  const [memFormConfidence, setMemFormConfidence] = useState(1.0);

  useEffect(() => {
    const unsub = annaMemoryManager.subscribe((bundle) => {
      setAnnaMemoryBundle(bundle);
      setAnnaStorageInfo(annaMemoryManager.getStorageInfoSync());
    });
    return unsub;
  }, []);

  const handleToggleAutoSaveMemory = () => {
    const nextVal = !annaStorageInfo.isAutoSaveEnabled;
    annaMemoryManager.setAutoSaveEnabled(nextVal);
    setAnnaStorageInfo(annaMemoryManager.getStorageInfoSync());
    setMemoryNotice(
      nextVal
        ? 'Автоматическое запоминание включено'
        : 'Автоматическое запоминание приостановлено'
    );
    setTimeout(() => setMemoryNotice(null), 3000);
  };

  const handleOpenAddMemoryModal = () => {
    setMemFormCategory('confirmed_fact');
    setMemFormStatus('confirmed_fact');
    setMemFormTitle('');
    setMemFormContent('');
    setMemFormConfidence(1.0);
    setEditingMemoryItem(null);
    setIsNewMemoryModalOpen(true);
  };

  const handleOpenEditMemoryModal = (item: AnnaMemoryItem) => {
    setEditingMemoryItem(item);
    setMemFormCategory(item.category);
    setMemFormStatus(item.status);
    setMemFormTitle(item.title || '');
    setMemFormContent(item.content);
    setMemFormConfidence(item.confidence ?? 0.95);
    setIsNewMemoryModalOpen(true);
  };

  const handleSaveMemoryItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memFormTitle.trim() || !memFormContent.trim()) return;

    if (editingMemoryItem) {
      await annaMemoryManager.updateItem(editingMemoryItem.id, {
        category: memFormCategory,
        status: memFormStatus,
        title: memFormTitle.trim(),
        content: memFormContent.trim(),
        confidence: memFormConfidence,
      });
      setMemoryNotice(`Запись «${memFormTitle}» обновлена`);
    } else {
      await annaMemoryManager.addItem({
        category: memFormCategory,
        status: memFormStatus,
        title: memFormTitle.trim(),
        content: memFormContent.trim(),
        confidence: memFormConfidence,
        source: 'manual',
      });
      setMemoryNotice(`Запись «${memFormTitle}» добавлена в память об Анне`);
    }
    setIsNewMemoryModalOpen(false);
    setEditingMemoryItem(null);
    setTimeout(() => setMemoryNotice(null), 3500);
  };

  const handleDeleteMemoryItem = async (id: string, title?: string) => {
    await annaMemoryManager.deleteItem(id);
    setMemoryNotice(`Запись «${title || 'Фрагмент памяти'}» удалена`);
    setTimeout(() => setMemoryNotice(null), 3000);
  };

  const handlePromoteToConfirmed = async (item: AnnaMemoryItem) => {
    await annaMemoryManager.updateItem(item.id, {
      category: 'confirmed_fact',
      status: 'confirmed_fact',
      confidence: 1.0,
    });
    setMemoryNotice(`Запись «${item.title || item.content.slice(0, 30)}» подтверждена как проверенный факт`);
    setTimeout(() => setMemoryNotice(null), 3000);
  };

  const handleClearAllMemory = async () => {
    await annaMemoryManager.clearAll();
    setConfirmClearAllMemory(false);
    setMemoryNotice('Все данные долговременной памяти очищены');
    setTimeout(() => setMemoryNotice(null), 3500);
  };

  const handleExportMemoryBackup = async () => {
    const jsonStr = await annaMemoryManager.exportBackup();
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pixel-anna-memory-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setMemoryNotice('Резервная копия памяти экспортирована');
    setTimeout(() => setMemoryNotice(null), 3000);
  };

  const handleImportMemoryBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const success = await annaMemoryManager.importBackup(text);
      if (success) {
        setMemoryNotice('Память успешно восстановлена из резервной копии');
      } else {
        setMemoryNotice('Ошибка при импорте резервной копии');
      }
    } catch {
      setMemoryNotice('Не удалось прочитать файл резервной копии');
    }
    e.target.value = '';
    setTimeout(() => setMemoryNotice(null), 4000);
  };

  const filteredAnnaMemories = annaMemoryBundle.memories.filter((m) => {
    if (selectedMemoryFilterCat === 'all') return true;
    return m.category === selectedMemoryFilterCat;
  });

  // Load all data on mount
  const loadAllData = async () => {
    setIsLoading(true);
    try {
      const [loadedProfiles, loadedSpecialists, loadedFailover, loadedOllama] =
        await Promise.all([
          aiConnectionManager.listProfiles().catch(() => []),
          aiConnectionManager
            .getSpecialistModels()
            .catch(() => getDefaultSpecialistAssignments()),
          aiConnectionManager
            .getFailoverSettings()
            .catch(() => getDefaultFailoverSettings()),
          aiConnectionManager.getOllamaStatus().catch(() => ({
            installed: false,
            running: false,
            apiUrl: 'http://127.0.0.1:11434',
            models: [],
          })),
        ]);

      setProfiles(loadedProfiles);
      setSpecialists(loadedSpecialists);
      setFailover(loadedFailover);
      setOllamaInfo(loadedOllama);
    } catch {
      setBannerNotice({
        type: 'error',
        text: 'Не удалось загрузить параметры подключений. Проверьте соединение с сервером.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  // Filter profiles by provider
  const geminiProfiles = useMemo(
    () => profiles.filter((p) => p.providerId === 'gemini'),
    [profiles]
  );
  const openRouterProfiles = useMemo(
    () => profiles.filter((p) => p.providerId === 'openrouter'),
    [profiles]
  );
  const ollamaProfiles = useMemo(
    () => profiles.filter((p) => p.providerId === 'ollama'),
    [profiles]
  );

  const isGeminiReady = useMemo(
    () =>
      geminiProfiles.some(
        (p) =>
          p.connectionStatus === 'connected' || p.connectionStatus === 'available'
      ),
    [geminiProfiles]
  );

  const isOpenRouterReady = useMemo(
    () =>
      openRouterProfiles.some(
        (p) =>
          p.connectionStatus === 'connected' || p.connectionStatus === 'available'
      ),
    [openRouterProfiles]
  );

  const isOllamaReady = Boolean(ollamaInfo.running);

  // Test single connection
  const handleTestConnection = async (profileId: string) => {
    setTestingProfileId(profileId);
    try {
      const res = await aiConnectionManager.testConnection(profileId);
      setTestResults((prev) => ({ ...prev, [profileId]: res }));
      setProfiles((prev) =>
        prev.map((p) =>
          p.id === profileId
            ? {
                ...p,
                connectionStatus: res.status,
                lastCheckedAt: res.testedAt,
                lastError: res.error,
              }
            : p
        )
      );
      if (res.ok) {
        setBannerNotice({
          type: 'success',
          text: `Соединение успешно проверено. Модель ответила штатно (${res.latencyMs ? `${res.latencyMs} мс` : 'ОК'}).`,
        });
      } else {
        setBannerNotice({
          type: 'error',
          text: res.error || 'Ошибка проверки подключения.',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBannerNotice({
        type: 'error',
        text: `Ошибка при проверке: ${msg}`,
      });
    } finally {
      setTestingProfileId(null);
    }
  };

  // Test all connections on demand
  const handleTestAllConnections = async () => {
    setIsTestingAll(true);
    setBannerNotice(null);
    try {
      const results = await aiConnectionManager.testAllConnections();
      setTestResults(results);
      // Reload fresh statuses
      const updated = await aiConnectionManager.listProfiles();
      setProfiles(updated);
      if (onRefreshProviders) {
        await onRefreshProviders();
      }
      setBannerNotice({
        type: 'success',
        text: 'Проверка всех подключений завершена. Результаты обновлены в карточках.',
      });
    } catch {
      setBannerNotice({
        type: 'error',
        text: 'Ошибка при массовой проверке подключений.',
      });
    } finally {
      setIsTestingAll(false);
    }
  };

  // Open modal for new profile
  const handleOpenAddModal = (providerId: AIProviderId) => {
    setModalError(null);
    setModalState({
      isOpen: true,
      isEditing: false,
      providerId,
      userDefinedName:
        providerId === 'gemini'
          ? `Gemini API-ключ #${geminiProfiles.length + 1}`
          : providerId === 'openrouter'
            ? `OpenRouter Free #${openRouterProfiles.length + 1}`
            : 'Ollama Локальный профиль',
      rawApiKey: '',
      selectedModel:
        providerId === 'gemini'
          ? 'gemini-3.8-flash'
          : providerId === 'openrouter'
            ? 'openrouter/free'
            : 'llama3.2:3b',
      isDefault:
        providerId === 'gemini'
          ? geminiProfiles.length === 0
          : openRouterProfiles.length === 0,
      showRawKey: false,
    });
  };

  // Open modal for editing existing profile
  const handleOpenEditModal = (profile: AIConnectionProfile) => {
    setModalError(null);
    setModalState({
      isOpen: true,
      isEditing: true,
      profileId: profile.id,
      providerId: profile.providerId,
      userDefinedName: profile.userDefinedName,
      rawApiKey: '', // Kept empty for security; user types only if replacing
      selectedModel: profile.selectedModel,
      isDefault: Boolean(profile.isDefault),
      showRawKey: false,
    });
  };

  // Submit modal
  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    const name = modalState.userDefinedName.trim();
    if (!name) {
      setModalError('Укажите понятное название подключения.');
      return;
    }

    if (
      !modalState.isEditing &&
      modalState.providerId !== 'ollama' &&
      !modalState.rawApiKey.trim()
    ) {
      setModalError('Введите API-ключ для нового подключения.');
      return;
    }

    setIsSubmittingModal(true);
    try {
      const saved = await aiConnectionManager.saveProfile({
        id: modalState.profileId,
        providerId: modalState.providerId,
        userDefinedName: name,
        rawApiKey: modalState.rawApiKey.trim() || undefined,
        selectedModel: modalState.selectedModel,
        isDefault: modalState.isDefault,
      });

      setProfiles((prev) => {
        const idx = prev.findIndex((p) => p.id === saved.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = saved;
          return next;
        }
        return [...prev, saved];
      });

      setModalState(INITIAL_MODAL_STATE);
      setBannerNotice({
        type: 'success',
        text: `Подключение «${saved.userDefinedName}» успешно сохранено.`,
      });

      // Quick background test of the newly saved profile
      handleTestConnection(saved.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setModalError(msg);
    } finally {
      setIsSubmittingModal(false);
    }
  };

  // Delete profile
  const handleConfirmDelete = async () => {
    if (!pendingDeleteProfile) return;
    setIsDeleting(true);
    try {
      await aiConnectionManager.deleteProfile(pendingDeleteProfile.id);
      setProfiles((prev) =>
        prev.filter((p) => p.id !== pendingDeleteProfile.id)
      );
      setBannerNotice({
        type: 'info',
        text: `Подключение «${pendingDeleteProfile.userDefinedName}» удалено.`,
      });
      setPendingDeleteProfile(null);
    } catch {
      setBannerNotice({
        type: 'error',
        text: 'Не удалось удалить подключение.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // Set profile as default
  const handleSetDefaultProfile = async (profile: AIConnectionProfile) => {
    try {
      const updated = await aiConnectionManager.saveProfile({
        id: profile.id,
        providerId: profile.providerId,
        userDefinedName: profile.userDefinedName,
        selectedModel: profile.selectedModel,
        isDefault: true,
      });
      setProfiles((prev) =>
        prev.map((p) => {
          if (p.providerId === profile.providerId) {
            return { ...p, isDefault: p.id === profile.id };
          }
          return p;
        })
      );
      setBannerNotice({
        type: 'success',
        text: `Подключение «${updated.userDefinedName}» назначено основным для ${profile.providerId === 'gemini' ? 'Gemini' : 'OpenRouter'}.`,
      });
    } catch {
      setBannerNotice({
        type: 'error',
        text: 'Не удалось обновить статус основного подключения.',
      });
    }
  };

  // Update Specialist assignment
  const handleSpecialistChange = async (
    role: SpecialistRoleKey,
    providerSelection: 'auto' | AIProviderId,
    specificModel?: string
  ) => {
    let resolvedModel = specificModel;
    if (!resolvedModel) {
      if (providerSelection === 'openrouter') {
        resolvedModel = 'openrouter/free';
      } else if (providerSelection === 'ollama') {
        resolvedModel = 'llama3.2:3b';
      } else {
        resolvedModel = 'gemini-3.8-flash';
      }
    }

    const updated: SpecialistModelAssignments = {
      ...specialists,
      [role]: {
        providerSelection,
        specificModel: resolvedModel,
      },
    };
    setSpecialists(updated);
    try {
      await aiConnectionManager.saveSpecialistModels(updated);
    } catch {
      setBannerNotice({
        type: 'error',
        text: 'Не удалось сохранить выбор модели специалиста.',
      });
    }
  };

  // Reset specialists to default
  const handleResetSpecialists = async () => {
    const defaults = getDefaultSpecialistAssignments();
    setSpecialists(defaults);
    try {
      await aiConnectionManager.saveSpecialistModels(defaults);
      setBannerNotice({
        type: 'success',
        text: 'Настройки моделей для всех специалистов возвращены к рекомендованным.',
      });
    } catch {
      // ignore
    }
  };

  // Move failover sequence
  const handleMoveFailover = async (index: number, direction: 'up' | 'down') => {
    const newOrder = [...failover.order];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= newOrder.length) return;
    const temp = newOrder[index];
    newOrder[index] = newOrder[targetIdx];
    newOrder[targetIdx] = temp;

    const updated: FailoverSequenceSettings = {
      ...failover,
      order: newOrder,
    };
    setFailover(updated);
    try {
      await aiConnectionManager.saveFailoverSettings(updated);
    } catch {
      setBannerNotice({
        type: 'error',
        text: 'Не удалось сохранить очерёдность переключения.',
      });
    }
  };

  // Toggle failover doc consent
  const handleToggleDocConsent = async (
    key: 'allowCloudFailoverForDocs' | 'requireExplicitDocConsent',
    val: boolean
  ) => {
    const updated: FailoverSequenceSettings = {
      ...failover,
      [key]: val,
    };
    setFailover(updated);
    try {
      await aiConnectionManager.saveFailoverSettings(updated);
    } catch {
      setBannerNotice({
        type: 'error',
        text: 'Не удалось сохранить параметры согласия на передачу документов.',
      });
    }
  };

  // Refresh Ollama status
  const handleRefreshOllama = async () => {
    try {
      const info = await aiConnectionManager.getOllamaStatus();
      setOllamaInfo(info);
      setBannerNotice({
        type: 'info',
        text: info.running
          ? `Ollama активна (обнаружено моделей: ${info.models.length}).`
          : 'Ollama не запущена на локальном порту 11434.',
      });
    } catch {
      setBannerNotice({
        type: 'error',
        text: 'Не удалось связаться с локальным сервисом Ollama.',
      });
    }
  };

  // Status Badge Helper
  const renderStatusBadge = (status: AIConnectionStatus) => {
    switch (status) {
      case 'connected':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Подключён
          </span>
        );
      case 'available':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-50 text-cyan-700 border border-cyan-200">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
            Доступен
          </span>
        );
      case 'quota_exceeded':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            Превышена квота
          </span>
        );
      case 'testing':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
            Проверка...
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
            Ошибка
          </span>
        );
      case 'not_configured':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            Требуется настройка
          </span>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#F6F8FB] overflow-y-auto">
      {/* 1. Header & Summary Stats */}
      <div className="bg-white border-b border-slate-200/80 px-4 sm:px-8 py-5">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-teal-50 text-teal-600 border border-teal-200">
                  <KeyRound className="w-4 h-4" />
                </span>
                <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight font-display">
                  Подключения ИИ и управление моделями
                </h1>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 max-w-2xl">
                Настройка API-ключей, выбор моделей для специалистов,
                автоматическое переключение и локальная установка Ollama.
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={handleTestAllConnections}
                disabled={isTestingAll || isLoading}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60 transition shadow-sm"
              >
                {isTestingAll ? (
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <RefreshCw className="w-4 h-4 text-teal-300" />
                )}
                <span>Проверить доступность всех</span>
              </button>
            </div>
          </div>

          {/* Security & Architecture Context Banner */}
          <div className="mt-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start gap-3 text-xs text-slate-600">
            <ShieldCheck className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
            <div className="flex-1 leading-relaxed">
              <span className="font-semibold text-slate-800">
                Безопасность API-ключей:
              </span>{' '}
              {isElectron ? (
                <span>
                  Настольная версия Electron активна. Ваши секреты аппаратно
                  зашифрованы с помощью{' '}
                  <strong className="text-slate-900">
                    Windows safeStorage
                  </strong>
                  . Ключи никогда не попадают в браузерный рендерер, IndexedDB
                  или бэкап.
                </span>
              ) : (
                <span>
                  Режим защищённого сервера AI Studio. Ваши ключи хранятся
                  исключительно в изолированной серверной памяти и защищённых
                  Secrets. В интерфейсе и JSON-бэкапах отображаются только маски
                  ключей без риска утечки.
                </span>
              )}
            </div>
          </div>

          {/* Navigation Sub-Tabs */}
          <div className="flex items-center gap-1 sm:gap-2 mt-5 border-b border-slate-200/80 -mb-5 overflow-x-auto pb-px">
            <button
              type="button"
              onClick={() => setActiveTab('providers')}
              className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'providers'
                  ? 'border-teal-600 text-teal-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <Cpu className="w-4 h-4" />
              <span>Провайдеры и ключи</span>
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-slate-100 text-slate-600">
                {profiles.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('specialists')}
              className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'specialists'
                  ? 'border-teal-600 text-teal-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Модели для специалистов</span>
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-teal-50 text-teal-700">
                5 ролей
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('failover')}
              className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'failover'
                  ? 'border-teal-600 text-teal-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <Zap className="w-4 h-4" />
              <span>Очередь переключения</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('ollama')}
              className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'ollama'
                  ? 'border-teal-600 text-teal-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <HardDrive className="w-4 h-4" />
              <span>Локальный ИИ (Ollama)</span>
              {ollamaInfo.running && (
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('voice')}
              className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'voice'
                  ? 'border-pink-500 text-pink-600'
                  : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <Volume2 className="w-4 h-4" />
              <span>Голос Пикселя</span>
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-pink-50 text-pink-600 border border-pink-100">
                {voiceSettings.selectedGeminiVoice}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('diagnostics')}
              className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'diagnostics'
                  ? 'border-teal-600 text-teal-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>Диагностика и микрофон</span>
              {coordinatorSnapshot.wakeWordState === 'standby_listening' || coordinatorSnapshot.wakeWordState === 'hearing_speech' ? (
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              ) : coordinatorSnapshot.wakeWordState === 'permission_denied' ? (
                <span className="w-2 h-2 rounded-full bg-rose-500" />
              ) : null}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('memory')}
              className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'memory'
                  ? 'border-pink-500 text-pink-600'
                  : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <MessageSquareHeart className="w-4 h-4" />
              <span>Память об Анне</span>
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-pink-50 text-pink-600 border border-pink-100">
                {annaMemoryBundle.memories.length} зап.
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Main Content Body */}
      <div className="flex-1 p-4 sm:p-8">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Notification Banner */}
          {bannerNotice && (
            <div
              className={`p-3.5 rounded-xl border flex items-start justify-between gap-3 text-xs sm:text-sm transition ${
                bannerNotice.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : bannerNotice.type === 'error'
                    ? 'bg-rose-50 text-rose-800 border-rose-200'
                    : 'bg-cyan-50 text-cyan-800 border-cyan-200'
              }`}
            >
              <div className="flex items-center gap-2">
                {bannerNotice.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : bannerNotice.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                ) : (
                  <Info className="w-4 h-4 text-cyan-600 shrink-0" />
                )}
                <span>{bannerNotice.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setBannerNotice(null)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* TAB 1: PROVIDERS & KEYS */}
          {activeTab === 'providers' && (
            <div className="space-y-6">
              {/* SECTION A: GOOGLE GEMINI */}
              <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-lg border border-blue-100">
                      G
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base sm:text-lg font-bold text-slate-900">
                          Google Gemini
                        </h2>
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                          Основной облачный ИИ
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">
                        Официальный API Google для образовательных задач,
                        анализа текстов и расписания.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleOpenAddModal('gemini')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-teal-50 text-teal-700 hover:bg-teal-100 transition border border-teal-200 self-start sm:self-auto"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Добавить ключ Gemini</span>
                  </button>
                </div>

                {/* Profiles List */}
                <div className="mt-4 space-y-3">
                  {geminiProfiles.length === 0 ? (
                    <div className="p-4 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center text-xs text-slate-500">
                      Ключи Gemini пока не добавлены. Нажмите «Добавить ключ
                      Gemini» для начала работы.
                    </div>
                  ) : (
                    geminiProfiles.map((p) => (
                      <div
                        key={p.id}
                        className="p-4 rounded-xl bg-slate-50/70 border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-slate-900">
                              {p.userDefinedName}
                            </span>
                            {p.isDefault && (
                              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                                Основное подключение
                              </span>
                            )}
                            {renderStatusBadge(
                              testingProfileId === p.id
                                ? 'testing'
                                : p.connectionStatus
                            )}
                          </div>

                          <div className="flex items-center gap-4 text-xs text-slate-600 flex-wrap">
                            <span className="font-mono bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-700">
                              Ключ: {p.maskedKey}
                            </span>
                            <span>
                              Модель: <strong>{p.selectedModel}</strong>
                            </span>
                            {p.lastCheckedAt && (
                              <span className="text-slate-400">
                                Проверен:{' '}
                                {new Date(p.lastCheckedAt).toLocaleTimeString(
                                  'ru-RU',
                                  { hour: '2-digit', minute: '2-digit' }
                                )}
                              </span>
                            )}
                          </div>

                          {p.lastError && (
                            <p className="text-xs text-rose-600 bg-rose-50 p-2 rounded-lg border border-rose-200 mt-1">
                              {p.lastError}
                            </p>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
                          <button
                            type="button"
                            onClick={() => handleTestConnection(p.id)}
                            disabled={testingProfileId === p.id}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1.5 shadow-sm"
                            title="Проверить соединение с сервером Gemini"
                          >
                            {testingProfileId === p.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-600" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" />
                            )}
                            <span>Проверить</span>
                          </button>

                          {!p.isDefault && (
                            <button
                              type="button"
                              onClick={() => handleSetDefaultProfile(p)}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 transition shadow-sm"
                            >
                              Сделать основным
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(p)}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 transition shadow-sm"
                          >
                            Изменить
                          </button>

                          <button
                            type="button"
                            onClick={() => setPendingDeleteProfile(p)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                            title="Удалить подключение"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* SECTION B: OPENROUTER FREE (WITH STRICT ZERO-PRICE GUARD) */}
              <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold text-lg border border-purple-100">
                      OR
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base sm:text-lg font-bold text-slate-900">
                          OpenRouter Free
                        </h2>
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-purple-50 text-purple-700 border border-purple-200">
                          Резервный облачный роутер
                        </span>
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                          100% Free · Защита от списаний
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">
                        Резервное облако на случай перегрузки или исчерпания
                        квоты Gemini.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleOpenAddModal('openrouter')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-purple-50 text-purple-700 hover:bg-purple-100 transition border border-purple-200 self-start sm:self-auto"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Добавить ключ OpenRouter</span>
                  </button>
                </div>

                {/* Zero-Cost Strict Notice */}
                <div className="mt-3 p-3 rounded-xl bg-amber-50/60 border border-amber-200/80 text-xs text-amber-800 flex items-start gap-2.5">
                  <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong>Строгая защита от платных моделей:</strong> В
                    кабинете разрешены только маршрут{' '}
                    <code>openrouter/free</code> или бесплатные модели с
                    суффиксом <code>:free</code> и строго нулевой ценой (0 ₽).
                    Любые платные списания заблокированы на уровне сервера.
                  </div>
                </div>

                {/* OpenRouter Profiles List */}
                <div className="mt-4 space-y-3">
                  {openRouterProfiles.length === 0 ? (
                    <div className="p-4 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center text-xs text-slate-500">
                      Подключения OpenRouter пока не настроены.
                    </div>
                  ) : (
                    openRouterProfiles.map((p) => (
                      <div
                        key={p.id}
                        className="p-4 rounded-xl bg-slate-50/70 border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-slate-900">
                              {p.userDefinedName}
                            </span>
                            {p.isDefault && (
                              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-purple-100 text-purple-800 border border-purple-200">
                                Основной OpenRouter
                              </span>
                            )}
                            {renderStatusBadge(
                              testingProfileId === p.id
                                ? 'testing'
                                : p.connectionStatus
                            )}
                          </div>

                          <div className="flex items-center gap-4 text-xs text-slate-600 flex-wrap">
                            <span className="font-mono bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-700">
                              Ключ: {p.maskedKey}
                            </span>
                            <span>
                              Модель: <strong>{p.selectedModel}</strong>
                            </span>
                            <span className="text-emerald-600 font-semibold">
                              (0 ₽ / free)
                            </span>
                            {p.lastCheckedAt && (
                              <span className="text-slate-400">
                                Проверен:{' '}
                                {new Date(p.lastCheckedAt).toLocaleTimeString(
                                  'ru-RU',
                                  { hour: '2-digit', minute: '2-digit' }
                                )}
                              </span>
                            )}
                          </div>

                          {p.lastError && (
                            <p className="text-xs text-rose-600 bg-rose-50 p-2 rounded-lg border border-rose-200 mt-1">
                              {p.lastError}
                            </p>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
                          <button
                            type="button"
                            onClick={() => handleTestConnection(p.id)}
                            disabled={testingProfileId === p.id}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1.5 shadow-sm"
                            title="Проверить ключ и доступность моделей"
                          >
                            {testingProfileId === p.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-600" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5 text-purple-600" />
                            )}
                            <span>Проверить</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(p)}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 transition shadow-sm"
                          >
                            Изменить
                          </button>

                          <button
                            type="button"
                            onClick={() => setPendingDeleteProfile(p)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                            title="Удалить подключение"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* SECTION C: LOCAL OLLAMA QUICK OVERVIEW */}
              <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-lg border border-emerald-100">
                      🦙
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base sm:text-lg font-bold text-slate-900">
                          Локальный ИИ (Ollama)
                        </h2>
                        {ollamaInfo.running ? (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Активна на 127.0.0.1:11434
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                            Не запущена
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        Работает без интернета прямо на вашем ПК. Полная
                        конфиденциальность.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab('ollama')}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition"
                    >
                      Открыть центр настройки Ollama
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SPECIALIST MODEL ASSIGNMENT */}
          {activeTab === 'specialists' && (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900">
                    Назначение моделей для специалистов
                  </h2>
                  <p className="text-xs text-slate-500">
                    Вы можете индивидуально настроить, какой ИИ отвечает за
                    маркетинг, продажи родителям, методику или аналитику.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleResetSpecialists}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition self-start sm:self-auto"
                >
                  Сбросить к рекомендованным
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {SPECIALIST_CONFIGS.map((spec) => {
                  const Icon = spec.icon;
                  const currentSetting =
                    specialists[spec.key] || {
                      providerSelection: 'auto',
                      specificModel: spec.defaultModel,
                    };

                  return (
                    <div
                      key={spec.key}
                      className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between gap-4"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center gap-2.5">
                          <span className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-teal-600 shadow-xs">
                            <Icon className="w-4 h-4" />
                          </span>
                          <div>
                            <h3 className="font-bold text-sm text-slate-900">
                              {spec.label}
                            </h3>
                            <p className="text-[11px] text-slate-500 leading-tight">
                              {spec.tagline}
                            </p>
                          </div>
                        </div>

                        {/* Provider selection dropdown */}
                        <div className="pt-2 space-y-1.5">
                          <label className="text-[11px] font-semibold text-slate-600 block">
                            Провайдер для роли:
                          </label>
                          <select
                            value={currentSetting.providerSelection}
                            onChange={(e) => {
                              const newProvider = e.target.value as
                                | 'auto'
                                | AIProviderId;
                              let defModel = 'gemini-3.8-flash';
                              if (newProvider === 'openrouter') {
                                defModel = 'openrouter/free';
                              } else if (newProvider === 'ollama') {
                                defModel = 'llama3.2:3b';
                              }
                              handleSpecialistChange(
                                spec.key,
                                newProvider,
                                defModel
                              );
                            }}
                            className="w-full text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                          >
                            <option value="auto">
                              ✨ Автовыбор (рекомендовано • Gemini)
                            </option>
                            <option value="gemini">
                              Google Gemini {isGeminiReady ? '• Подключён' : '(на сервере)'}
                            </option>
                            <option value="openrouter">
                              OpenRouter Free {isOpenRouterReady ? '• Доступен' : '(требуется ключ)'}
                            </option>
                            <option value="ollama">
                              Ollama Local {isOllamaReady ? '• Активна' : '(не запущена)'}
                            </option>
                          </select>

                          {/* Notice if provider is unconfigured */}
                          {currentSetting.providerSelection === 'openrouter' && !isOpenRouterReady && (
                            <div className="flex items-start gap-1.5 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] leading-snug">
                              <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                              <span>
                                Ключ OpenRouter не настроен. Запросы будут автоматически перенаправляться на Google Gemini с резервным уведомлением.
                              </span>
                            </div>
                          )}

                          {currentSetting.providerSelection === 'ollama' && !isOllamaReady && (
                            <div className="flex items-start gap-1.5 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] leading-snug">
                              <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                              <span>
                                Ollama не запущена на 127.0.0.1:11434. Запросы будут автоматически перенаправляться на Google Gemini.
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Model selector for selected provider */}
                        {currentSetting.providerSelection === 'gemini' && (
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-600 block">
                              Модель Gemini:
                            </label>
                            <select
                              value={
                                currentSetting.specificModel || 'gemini-3.8-flash'
                              }
                              onChange={(e) =>
                                handleSpecialistChange(
                                  spec.key,
                                  'gemini',
                                  e.target.value
                                )
                              }
                              className="w-full text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                            >
                              {GEMINI_AVAILABLE_MODELS.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {currentSetting.providerSelection === 'openrouter' && (
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-600 block">
                              Модель OpenRouter:
                            </label>
                            <select
                              value={
                                currentSetting.specificModel || 'openrouter/free'
                              }
                              onChange={(e) =>
                                handleSpecialistChange(
                                  spec.key,
                                  'openrouter',
                                  e.target.value
                                )
                              }
                              className="w-full text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                            >
                              <option value="openrouter/free">
                                openrouter/free (Автовыбор бесплатной)
                              </option>
                            </select>
                          </div>
                        )}

                        {currentSetting.providerSelection === 'ollama' && (
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-600 block">
                              Локальная модель Ollama:
                            </label>
                            <select
                              value={
                                currentSetting.specificModel || 'llama3.2:3b'
                              }
                              onChange={(e) =>
                                handleSpecialistChange(
                                  spec.key,
                                  'ollama',
                                  e.target.value
                                )
                              }
                              className="w-full text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                            >
                              {ollamaInfo.models.length > 0 ? (
                                ollamaInfo.models.map((m) => (
                                  <option key={m.name} value={m.name}>
                                    {m.name}
                                  </option>
                                ))
                              ) : (
                                <option value="llama3.2:3b">
                                  llama3.2:3b (Рекомендована)
                                </option>
                              )}
                            </select>
                          </div>
                        )}
                      </div>

                      <div className="pt-2 border-t border-slate-200/60 text-[11px] text-slate-500 flex items-center justify-between">
                        <span>
                          {currentSetting.providerSelection === 'auto'
                            ? 'Отказоустойчивый режим'
                            : 'Фиксированный выбор'}
                        </span>
                        <span className="font-semibold text-teal-700">
                          {currentSetting.providerSelection === 'auto'
                            ? 'Gemini 3.8'
                            : currentSetting.specificModel || 'По умолчанию'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: FAILOVER SEQUENCE */}
          {activeTab === 'failover' && (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-sm space-y-6">
              <div className="pb-4 border-b border-slate-100">
                <h2 className="text-base sm:text-lg font-bold text-slate-900">
                  Очередь автоматического переключения (Failover)
                </h2>
                <p className="text-xs text-slate-500">
                  Если основной провайдер временно перегружен или исчерпал
                  лимит, запрос мгновенно передаётся следующему по списку.
                </p>
              </div>

              {/* Order Visualizer */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  Последовательность проверки:
                </label>

                <div className="space-y-2">
                  {failover.order.map((providerId, idx) => {
                    const isGemini = providerId === 'gemini';
                    const isOpenRouter = providerId === 'openrouter';
                    const isOllama = providerId === 'ollama';

                    return (
                      <div
                        key={providerId}
                        className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-7 h-7 rounded-lg bg-white border border-slate-200 font-extrabold text-xs text-slate-800 flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-slate-900">
                                {isGemini
                                  ? 'Google Gemini Free'
                                  : isOpenRouter
                                    ? 'OpenRouter Free'
                                    : 'Ollama Local (ПК)'}
                              </span>
                              {idx === 0 && (
                                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-teal-100 text-teal-800 border border-teal-200">
                                  Первичный выбор
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500">
                              {isGemini
                                ? 'Основной рабочий ИИ с быстрым откликом и бесплатной квотой'
                                : isOpenRouter
                                  ? 'Резервный облачный роутер с бесплатными моделями (:free)'
                                  : 'Локальная модель на компьютере (работает автономно)'}
                            </p>
                          </div>
                        </div>

                        {/* Move Up/Down Controls */}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleMoveFailover(idx, 'up')}
                            disabled={idx === 0}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 disabled:opacity-30 disabled:hover:bg-transparent"
                            title="Поднять в приоритете"
                          >
                            <ArrowUp className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveFailover(idx, 'down')}
                            disabled={idx === failover.order.length - 1}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 disabled:opacity-30 disabled:hover:bg-transparent"
                            title="Опустить в приоритете"
                          >
                            <ArrowDown className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Safeguards on Document Transfer */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <h3 className="font-bold text-xs uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-teal-600" />
                  Защита документов при смене провайдера:
                </h3>

                <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={failover.requireExplicitDocConsent}
                    onChange={(e) =>
                      handleToggleDocConsent(
                        'requireExplicitDocConsent',
                        e.target.checked
                      )
                    }
                    className="mt-0.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span>
                    <strong>
                      Всегда запрашивать отдельное подтверждение
                    </strong>{' '}
                    перед передачей извлечённого текста документов резервному
                    провайдеру (защита персональных данных и прайс-листов).
                  </span>
                </label>

                <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={failover.allowCloudFailoverForDocs}
                    onChange={(e) =>
                      handleToggleDocConsent(
                        'allowCloudFailoverForDocs',
                        e.target.checked
                      )
                    }
                    className="mt-0.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span>
                    Разрешить переключение на OpenRouter при анализе файлов
                    только если пользователь подтвердил согласие в диалоге.
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* TAB 4: OLLAMA COMPLETE CENTER */}
          {activeTab === 'ollama' && (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <span className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center text-2xl border border-emerald-100">
                    🦙
                  </span>
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-slate-900">
                      Центр управления локальным ИИ (Ollama)
                    </h2>
                    <p className="text-xs text-slate-500">
                      Запуск нейросетей непосредственно на вашем компьютере без
                      интернета и без передачи данных во внешние облака.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleRefreshOllama}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 transition shadow-sm self-start sm:self-auto"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-teal-600" />
                  <span>Проверить локальный API (11434)</span>
                </button>
              </div>

              {/* THREE STATES OF OLLAMA (Sections 9 & 10) */}

              {/* STATE 1: OLLAMA NOT INSTALLED / NOT RUNNING */}
              {!ollamaInfo.running && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 text-xs sm:text-sm text-amber-900 flex items-start gap-3">
                    <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-bold">
                        Локальный сервер Ollama не обнаружен на порту 11434
                      </p>
                      <p className="text-xs text-amber-800 leading-relaxed">
                        Для запуска локального ИИ требуется установить программу
                        Ollama для Windows. Это официальное бесплатное ПО с
                        открытым исходным кодом.
                      </p>
                    </div>
                  </div>

                  <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-4">
                    <h3 className="font-bold text-sm text-slate-900">
                      Инструкция по установке Ollama на Windows:
                    </h3>

                    <ol className="list-decimal list-inside space-y-2 text-xs sm:text-sm text-slate-700 leading-relaxed">
                      <li>
                        Скачайте официальный установщик{' '}
                        <code>OllamaSetup.exe</code> с официального сайта.
                      </li>
                      <li>
                        Запустите установку с обычными системными разрешениями
                        Windows.
                      </li>
                      <li>
                        После завершения установки в трее Windows появится значок
                        ламы.
                      </li>
                      <li>
                        Вернитесь в этот раздел и нажмите кнопку «Проверить
                        локальный API (11434)».
                      </li>
                    </ol>

                    <div className="pt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          aiConnectionManager.openOllamaOfficialWebsite()
                        }
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm"
                      >
                        <Download className="w-4 h-4" />
                        <span>Скачать официальный установщик для Windows</span>
                        <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* STATE 2 & 3: INSTALLED / MODELS STATUS */}
              {ollamaInfo.running && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs sm:text-sm text-emerald-900 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      <div>
                        <span className="font-bold">
                          Ollama успешно подключена!
                        </span>{' '}
                        Адрес: <code>127.0.0.1:11434</code>
                      </div>
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">
                      Установлено моделей: {ollamaInfo.models.length}
                    </span>
                  </div>

                  {/* Installed models list */}
                  {ollamaInfo.models.length > 0 ? (
                    <div className="space-y-2">
                      <h3 className="font-bold text-xs uppercase tracking-wider text-slate-700">
                        Установленные модели на компьютере:
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {ollamaInfo.models.map((m) => (
                          <div
                            key={m.name}
                            className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <p className="font-bold text-xs sm:text-sm text-slate-900 truncate">
                                {m.name}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {m.sizeBytes
                                  ? `${(m.sizeBytes / 1024 / 1024 / 1024).toFixed(1)} ГБ`
                                  : 'Локальная модель'}{' '}
                                {m.parameterSize ? `· ${m.parameterSize}` : ''}
                              </p>
                            </div>
                            <span className="px-2 py-1 text-[10px] font-bold rounded-md bg-white border border-slate-200 text-slate-700">
                              Готова
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center text-xs text-slate-600">
                      Ollama запущена, но ни одна модель ещё не загружена в память
                      ПК. Выберите рекомендованную модель ниже.
                    </div>
                  )}

                  {/* Recommended models catalog (Section 9 & 10) */}
                  <div className="pt-2 space-y-3">
                    <h3 className="font-bold text-xs uppercase tracking-wider text-slate-700">
                      Рекомендованные модели для управляющей Анны:
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {RECOMMENDED_OLLAMA_MODELS.map((rec) => (
                        <div
                          key={rec.name}
                          className="p-4 rounded-xl border border-slate-200 bg-white flex flex-col justify-between gap-3 shadow-xs"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-xs sm:text-sm text-slate-900">
                                {rec.tagline}
                              </span>
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                                {rec.sizeGb}
                              </span>
                            </div>

                            <p className="text-[11px] text-slate-500">
                              {rec.recommendedFor}
                            </p>

                            <div className="text-[10px] text-slate-400 font-medium">
                              Требования: {rec.ramRequirement}
                            </div>
                          </div>

                          <div className="pt-2 border-t border-slate-100">
                            <div className="flex items-center justify-between gap-1 text-[11px] font-mono bg-slate-50 p-1.5 rounded border border-slate-200 text-slate-700">
                              <span className="truncate">
                                ollama run {rec.name}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(
                                    `ollama run ${rec.name}`
                                  );
                                  setCopiedKey(rec.name);
                                  setTimeout(() => setCopiedKey(null), 2000);
                                }}
                                className="p-1 hover:text-slate-900"
                                title="Скопировать команду"
                              >
                                {copiedKey === rec.name ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: PIXEL VOICE SETTINGS */}
          {activeTab === 'voice' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Header Card */}
              <div className="bg-gradient-to-r from-pink-50/80 via-white to-sky-50/80 rounded-2xl border border-pink-200/80 p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-pink-400 to-sky-400 text-white flex items-center justify-center shadow-xs text-xl">
                    ✨
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 font-display">
                      Голос и тембр Пикселя
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Синтез речи через нейросеть Gemini TTS, скорость, громкость и фраза пробуждения.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleResetVoiceDefaults}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 transition shadow-2xs self-start md:self-auto cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Сбросить к рекомендованным</span>
                </button>
              </div>

              {/* Voice Options Grid */}
              <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs space-y-5">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Headphones className="w-4 h-4 text-pink-500" />
                      Персонажи голоса Gemini TTS (Google Cloud)
                    </h3>
                    <span className="text-xs text-slate-400">
                      Нажмите на динамик для прослушивания образца
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                    {GEMINI_TTS_VOICES.map((v) => {
                      const isSelected = voiceSettings.selectedGeminiVoice === v.id;
                      const isPlayingThis = playingVoiceId === `voice_${v.id}`;

                      return (
                        <div
                          key={v.id}
                          onClick={() => handleVoiceSettingsUpdate({ selectedGeminiVoice: v.id })}
                          className={`relative p-4 rounded-xl border transition-all cursor-pointer flex items-start justify-between gap-3 ${
                            isSelected
                              ? 'border-pink-500/80 bg-pink-50/40 shadow-xs ring-1 ring-pink-500/30'
                              : 'border-slate-200/80 bg-slate-50/40 hover:bg-slate-50 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            <div
                              className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 transition ${
                                isSelected
                                  ? 'border-pink-500 bg-pink-500 text-white'
                                  : 'border-slate-300 bg-white'
                              }`}
                            >
                              {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>

                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-slate-900">
                                  {v.id}
                                </span>
                                {v.id === 'Aoede' && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-pink-100 text-pink-700">
                                    Основной голос
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 mt-1">
                                {v.description}
                              </p>
                              <span className="text-[11px] text-slate-400 mt-0.5 block">
                                {v.styleTitle}
                              </span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlayVoiceSample(v);
                            }}
                            className={`p-2 rounded-lg border transition shrink-0 ${
                              isPlayingThis
                                ? 'bg-pink-500 text-white border-pink-500 shadow-xs'
                                : 'bg-white text-slate-600 border-slate-200 hover:text-pink-600 hover:border-pink-300'
                            }`}
                            title={isPlayingThis ? 'Остановить' : 'Прослушать сэмпл'}
                          >
                            {isPlayingThis ? (
                              <Square className="w-3.5 h-3.5 fill-current" />
                            ) : (
                              <Play className="w-3.5 h-3.5 fill-current" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Sliders: Rate & Volume */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                  <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700">Скорость речи</span>
                      <span className="text-xs font-mono font-semibold text-pink-600">
                        {voiceSettings.rate.toFixed(2)}x
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.75}
                      max={1.5}
                      step={0.05}
                      value={voiceSettings.rate}
                      onChange={(e) =>
                        handleVoiceSettingsUpdate({ rate: parseFloat(e.target.value) })
                      }
                      className="w-full accent-pink-500 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Спокойнее (0.75x)</span>
                      <span>1.0x</span>
                      <span>Быстрее (1.5x)</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700">Громкость озвучки</span>
                      <span className="text-xs font-mono font-semibold text-pink-600">
                        {Math.round(voiceSettings.volume * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={1.0}
                      step={0.05}
                      value={voiceSettings.volume}
                      onChange={(e) =>
                        handleVoiceSettingsUpdate({ volume: parseFloat(e.target.value) })
                      }
                      className="w-full accent-pink-500 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Тихо (10%)</span>
                      <span>50%</span>
                      <span>Максимум (100%)</span>
                    </div>
                  </div>
                </div>

                {/* Toggles */}
                <div className="space-y-3 pt-2">
                  <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition cursor-pointer">
                    <input
                      type="checkbox"
                      checked={voiceSettings.wakeWordEnabled}
                      onChange={(e) =>
                        handleVoiceSettingsUpdate({ wakeWordEnabled: e.target.checked })
                      }
                      className="mt-0.5 rounded border-slate-300 text-pink-500 focus:ring-pink-400"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-800">
                        Фоновое распознавание фразы «Пиксель»
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Пиксель слушает кодовое слово в микрофоне и мягко просыпается при обращении.
                      </div>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition cursor-pointer">
                    <input
                      type="checkbox"
                      checked={voiceSettings.allowBrowserFallback}
                      onChange={(e) =>
                        handleVoiceSettingsUpdate({ allowBrowserFallback: e.target.checked })
                      }
                      className="mt-0.5 rounded border-slate-300 text-pink-500 focus:ring-pink-400"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-800">
                        Резервный синтез речи браузера (Web Speech API)
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Если лимит Gemini TTS временно исчерпан (429), воспроизводится голос браузера без сбоя.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Live Test Synthesis Card */}
              <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-pink-500" />
                      Тестовый синтез фразы Пикселя
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Сгенерирует живую речь через Gemini TTS с текущими настройками тембра и скорости.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleGenerateLiveTest}
                    disabled={isGeneratingLiveTTS}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-gradient-to-r from-pink-500 to-sky-500 text-white hover:opacity-95 disabled:opacity-50 transition shadow-xs cursor-pointer shrink-0"
                  >
                    {isGeneratingLiveTTS ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : playingVoiceId === 'live_test' ? (
                      <Square className="w-4 h-4 fill-current" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                    <span>
                      {isGeneratingLiveTTS
                        ? 'Генерация звука...'
                        : playingVoiceId === 'live_test'
                          ? 'Остановить воспроизведение'
                          : 'Сгенерировать и прослушать'}
                    </span>
                  </button>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-700 italic">
                  «{PIXEL_COMPARISON_PHRASE}»
                </div>

                {liveTestResult && (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      Успешно озвучено голосом <strong>{liveTestResult.voice}</strong>{' '}
                      ({liveTestResult.provider === 'gemini' ? 'Gemini TTS' : 'Web Speech Fallback'}).
                      {liveTestResult.notice && ` ${liveTestResult.notice}`}
                    </span>
                  </div>
                )}

                {liveTestError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{liveTestError}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 6: DIAGNOSTICS & HARDWARE */}
          {activeTab === 'diagnostics' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Header Card */}
              <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-slate-900 text-teal-400 flex items-center justify-center shadow-xs">
                    <Activity className="w-6 h-6 text-[#FFD700]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base sm:text-lg font-bold text-slate-900 font-display">
                        Диагностика голосовой системы
                      </h2>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          isElectron
                            ? 'bg-purple-100 text-purple-800 border border-purple-200'
                            : 'bg-blue-100 text-blue-800 border border-blue-200'
                        }`}
                      >
                        {isElectron ? 'Electron Runtime' : 'Browser Preview'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Мониторинг Web Speech API, ключевого слова «Пиксель», микрофона и Gemini Live.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleRunHardwareTest}
                    disabled={isTestingHardware}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition shadow-xs cursor-pointer"
                  >
                    {isTestingHardware ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Mic className="w-3.5 h-3.5" />
                    )}
                    <span>{isTestingHardware ? 'Тестирование...' : 'Проверить микрофон'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleRestartStandby}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition shadow-2xs cursor-pointer"
                    title="Перезапустить модуль ожидания фразы «Пиксель»"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                    <span>Перезапустить ожидание</span>
                  </button>
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5">
                {/* 1. Mic Permission */}
                <div className="p-4 rounded-xl border border-slate-200/80 bg-white shadow-2xs flex flex-col justify-between">
                  <span className="text-[11px] font-medium text-slate-500">
                    Разрешение микрофона
                  </span>
                  <div className="flex items-center gap-2 mt-2">
                    {hardwareReport?.permissionState === 'granted' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : hardwareReport?.permissionState === 'denied' ? (
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                    )}
                    <span className="text-xs font-bold text-slate-900">
                      {hardwareReport?.permissionState === 'granted'
                        ? 'Разрешён'
                        : hardwareReport?.permissionState === 'denied'
                          ? 'Запрещён'
                          : 'Ожидает запроса'}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 truncate">
                    {hardwareReport?.audioDeviceCount
                      ? `Аудиоустройств: ${hardwareReport.audioDeviceCount}`
                      : 'Поиск устройств...'}
                  </span>
                </div>

                {/* 2. Web Speech Recognition */}
                <div className="p-4 rounded-xl border border-slate-200/80 bg-white shadow-2xs flex flex-col justify-between">
                  <span className="text-[11px] font-medium text-slate-500">
                    Web Speech API (STT)
                  </span>
                  <div className="flex items-center gap-2 mt-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        hardwareReport?.isWebSpeechSupported
                          ? 'bg-emerald-500 animate-pulse'
                          : 'bg-rose-500'
                      }`}
                    />
                    <span className="text-xs font-bold text-slate-900">
                      {hardwareReport?.isWebSpeechSupported
                        ? 'Поддерживается'
                        : 'Не поддерживается'}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 truncate">
                    Локаль: ru-RU, непрерывный захват
                  </span>
                </div>

                {/* 3. Gemini Live */}
                <div className="p-4 rounded-xl border border-slate-200/80 bg-white shadow-2xs flex flex-col justify-between">
                  <span className="text-[11px] font-medium text-slate-500">
                    Gemini Live WebSocket
                  </span>
                  <div className="flex items-center gap-2 mt-2">
                    <Radio
                      className={`w-4 h-4 ${
                        coordinatorSnapshot.mode === 'LIVE'
                          ? 'text-emerald-600 animate-pulse'
                          : 'text-slate-400'
                      }`}
                    />
                    <span className="text-xs font-bold text-slate-900">
                      {coordinatorSnapshot.mode === 'LIVE' ? 'В эфире (Live)' : 'В режиме ожидания'}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 truncate">
                    Модель: gemini-2.5-flash-native
                  </span>
                </div>

                {/* 4. Standby Wake Word State */}
                <div className="p-4 rounded-xl border border-slate-200/80 bg-white shadow-2xs flex flex-col justify-between">
                  <span className="text-[11px] font-medium text-slate-500">
                    Ключевое слово «Пиксель»
                  </span>
                  <div className="flex items-center gap-2 mt-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        coordinatorSnapshot.wakeWordState === 'standby_listening' || coordinatorSnapshot.wakeWordState === 'hearing_speech'
                          ? 'bg-emerald-500 animate-pulse'
                          : coordinatorSnapshot.wakeWordState === 'wake_word_triggered'
                            ? 'bg-[#FFD700] animate-bounce'
                            : 'bg-slate-400'
                      }`}
                    />
                    <span className="text-xs font-bold text-slate-900 truncate">
                      {WAKE_WORD_STATE_META[coordinatorSnapshot.wakeWordState]?.labelRu || 'Ожидание'}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 truncate">
                    {coordinatorSnapshot.errorDetail || 'Система в норме'}
                  </span>
                </div>
              </div>

              {/* Hardware Test Details Card if performed */}
              {hardwareReport && hardwareReport.audioDeviceLabels && hardwareReport.audioDeviceLabels.length > 0 && (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1">
                  <div className="font-bold text-slate-800 flex items-center gap-2">
                    <Mic className="w-3.5 h-3.5 text-teal-600" />
                    <span>Обнаруженные микрофоны: {hardwareReport.audioDeviceLabels.join(', ')}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Устройств ввода: {hardwareReport.audioDeviceCount} • Разрешение: {hardwareReport.permissionState}
                  </div>
                </div>
              )}

              {/* Logs Table Card */}
              <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">
                      Журнал событий и диагностических логов
                    </h3>
                    <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold">
                      {filteredDiagEntries.length} записей
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center bg-slate-100 rounded-lg p-0.5 text-xs font-medium">
                      {(['all', 'errors', 'speech', 'matches'] as const).map((filter) => (
                        <button
                          key={filter}
                          type="button"
                          onClick={() => setDiagFilter(filter)}
                          className={`px-2.5 py-1 rounded-md transition ${
                            diagFilter === filter
                              ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {filter === 'all'
                            ? 'Все'
                            : filter === 'errors'
                              ? 'Ошибки'
                              : filter === 'speech'
                                ? 'Речь'
                                : 'Срабатывания'}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={handleCopyDiagLog}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition cursor-pointer"
                      title="Скопировать лог в буфер обмена"
                    >
                      {copyDiagSuccess ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copyDiagSuccess ? 'Скопировано' : 'Копировать'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadDiagLog}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition cursor-pointer"
                      title="Скачать лог файлом"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Скачать</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleClearDiagLog}
                      className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                      title="Очистить лог"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200/80 bg-slate-900 text-slate-200 font-mono text-[11px] p-3 space-y-1.5">
                  {filteredDiagEntries.length === 0 ? (
                    <div className="text-slate-500 py-6 text-center italic">
                      Диагностических записей пока нет.
                    </div>
                  ) : (
                    filteredDiagEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className={`flex items-start gap-2 py-0.5 border-b border-slate-800/60 last:border-0 ${
                          entry.level === 'error'
                            ? 'text-rose-300'
                            : entry.level === 'warn'
                              ? 'text-amber-300'
                              : entry.category === 'match'
                                ? 'text-[#FFD700]'
                                : 'text-slate-300'
                        }`}
                      >
                        <span className="text-slate-500 shrink-0 select-none">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                        <span
                          className={`px-1.5 py-0.2 rounded text-[9px] uppercase font-bold shrink-0 ${
                            entry.level === 'error'
                              ? 'bg-rose-950/80 text-rose-300 border border-rose-800'
                              : entry.level === 'warn'
                                ? 'bg-amber-950/80 text-amber-300 border border-amber-800'
                                : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {entry.category}
                        </span>
                        <span className="break-all flex-1">{entry.message}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              SUBTAB 7: ПАМЯТЬ ОБ АННЕ (Долговременная память, профиль, предпочтения)
             ================================================================ */}
          {activeTab === 'memory' && (
            <div className="space-y-6">
              {/* Notification banner if action performed */}
              {memoryNotice && (
                <div className="p-3.5 rounded-xl bg-pink-50 border border-pink-200 text-xs text-pink-900 font-medium flex items-center justify-between animate-in fade-in">
                  <span>{memoryNotice}</span>
                  <button
                    type="button"
                    onClick={() => setMemoryNotice(null)}
                    className="p-1 text-pink-400 hover:text-pink-700 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Memory Storage & Auto-save Status Card */}
              <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-5 h-5 text-pink-500" />
                      <h2 className="text-base font-bold text-slate-900">
                        Хранилище долговременной памяти Пикселя
                      </h2>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-pink-50 text-pink-700 border border-pink-200/60">
                        {annaStorageInfo.isElectron ? 'Локальные JSON файлы' : 'IndexedDB (Веб)'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Путь к файлам данных:{' '}
                      <code className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[11px] text-slate-800">
                        {annaStorageInfo.basePath}
                      </code>
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={handleOpenAddMemoryModal}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-pink-600 hover:bg-pink-700 text-white text-xs font-semibold shadow-xs transition cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Добавить запись</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleExportMemoryBackup}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer"
                      title="Экспорт резервной копии всех данных памяти"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Экспорт JSON</span>
                    </button>
                    <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer">
                      <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                      <span>Импорт…</span>
                      <input
                        type="file"
                        accept=".json"
                        onChange={handleImportMemoryBackup}
                        className="hidden"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setConfirmClearAllMemory(true)}
                      className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 text-xs font-medium transition cursor-pointer"
                      title="Очистить память об Анне"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Auto-save Switch & Integrity details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-slate-800">
                        Автосохранение из диалогов
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Пиксель деликатно фиксирует важные факты и предпочтения из речи Анны
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={annaStorageInfo.isAutoSaveEnabled}
                        onChange={handleToggleAutoSaveMemory}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-pink-500"></div>
                    </label>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center gap-3">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div className="text-[11px] text-slate-600 leading-snug">
                      <strong className="text-slate-800">Безопасность и целостность:</strong> Атомарная запись через временные файлы (.tmp) с автоматическими резервными копиями (.bak). Исключены повреждения при сбоях.
                    </div>
                  </div>
                </div>
              </div>

              {/* Profile & Preferences Highlights Card */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Profile card */}
                <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-3">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                    <span className="w-2 h-2 rounded-full bg-pink-400" />
                    <h3 className="text-sm font-bold text-slate-900">
                      Профиль управляющей Анны
                    </h3>
                  </div>
                  <div className="text-xs space-y-1.5 text-slate-600">
                    <div>
                      <span className="text-slate-400">Роль: </span>
                      <strong className="text-slate-800">{annaMemoryBundle.profile.role}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400">Школы: </span>
                      <strong className="text-slate-800">{(annaMemoryBundle.profile.schools || ['KIBERone', 'Renderia']).join(' & ')}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400">Бэкграунд: </span>
                      <span className="text-slate-800 font-medium">{annaMemoryBundle.profile.background || annaMemoryBundle.profile.psychologicalBackground}</span>
                      <span className="ml-2 px-1.5 py-0.2 rounded text-[10px] bg-amber-50 text-amber-800 border border-amber-200">
                        {annaMemoryBundle.profile.backgroundVerification || 'Подтверждено в диалоге'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Стиль общения: </span>
                      <span className="text-slate-800">{annaMemoryBundle.profile.communicationTone || annaMemoryBundle.profile.communicationStyle}</span>
                    </div>
                  </div>
                </div>

                {/* Preferences card */}
                <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-3">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                    <span className="w-2 h-2 rounded-full bg-sky-400" />
                    <h3 className="text-sm font-bold text-slate-900">
                      Эстетические предпочтения
                    </h3>
                  </div>
                  <div className="text-xs space-y-2 text-slate-600">
                    <div>
                      <span className="text-slate-400">Любимая палитра: </span>
                      <div className="inline-flex items-center gap-1.5 ml-1 align-middle">
                        {['#FFD1DC', '#BAE6FD', '#FFF7ED', '#E9D5FF'].map((color) => (
                          <span
                            key={color}
                            style={{ backgroundColor: color }}
                            title={color}
                            className="w-4 h-4 rounded-full border border-slate-300 shadow-2xs inline-block"
                          />
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-400">Свет и стиль: </span>
                      <span className="text-slate-800">
                        {annaMemoryBundle.preferences.find((p) => p.category === 'visual')?.description || 'Мягкий, эстетичный, воздушный стиль без агрессивных неоновых цветов'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Тон диалога: </span>
                      <span className="text-slate-800">
                        {annaMemoryBundle.preferences.find((p) => p.category === 'speech' || p.category === 'work')?.description || 'Спокойный, уважительный, тёплый диалог'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Memory Items List */}
              <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">
                      Сохранённые записи памяти ({filteredAnnaMemories.length})
                    </h3>
                  </div>

                  {/* Category Filter Pills */}
                  <div className="flex items-center gap-1 flex-wrap text-xs">
                    {(
                      [
                        { id: 'all', label: 'Все' },
                        { id: 'confirmed_fact', label: 'Факты' },
                        { id: 'preference', label: 'Предпочтения' },
                        { id: 'work_context', label: 'Работа' },
                        { id: 'observation', label: 'Наблюдения' },
                        { id: 'temporary_note', label: 'Заметки' },
                      ] as const
                    ).map((filter) => (
                      <button
                        key={filter.id}
                        type="button"
                        onClick={() => setSelectedMemoryFilterCat(filter.id)}
                        className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                          selectedMemoryFilterCat === filter.id
                            ? 'bg-pink-100 text-pink-800 font-semibold'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredAnnaMemories.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 text-xs italic">
                    Записей в этой категории пока нет.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {filteredAnnaMemories.map((mem) => {
                      const isConfirmed = mem.status === 'confirmed' || mem.status === 'confirmed_fact';
                      return (
                        <div
                          key={mem.id}
                          className="p-4 rounded-xl border border-slate-200/80 bg-slate-50/70 hover:bg-slate-50 flex flex-col justify-between gap-3 transition"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-bold text-xs text-slate-900 leading-snug">
                                {mem.title || mem.content.slice(0, 45)}
                              </span>
                              <div className="flex items-center gap-1 shrink-0">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    isConfirmed
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : mem.status === 'observation' || mem.status === 'hypothesis' || mem.status === 'needs_verification'
                                        ? 'bg-purple-100 text-purple-800'
                                        : 'bg-sky-100 text-sky-800'
                                  }`}
                                >
                                  {isConfirmed
                                    ? 'Проверено'
                                    : mem.status === 'observation' || mem.status === 'hypothesis' || mem.status === 'needs_verification'
                                      ? 'Наблюдение'
                                      : 'Заметка'}
                                </span>
                                {typeof mem.confidence === 'number' && (
                                  <span className="text-[10px] font-mono text-slate-400 font-semibold">
                                    {Math.round(mem.confidence * 100)}%
                                  </span>
                                )}
                              </div>
                            </div>
                            <p className="text-xs text-slate-600 leading-relaxed break-words">
                              {mem.content}
                            </p>
                          </div>

                          <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-400">
                            <span>{new Date(mem.updatedAt).toLocaleDateString('ru-RU')}</span>
                            <div className="flex items-center gap-1.5">
                              {!isConfirmed && (
                                <button
                                  type="button"
                                  onClick={() => handlePromoteToConfirmed(mem)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-[10px] font-semibold transition cursor-pointer"
                                  title="Подтвердить как проверенный факт"
                                >
                                  <Check className="w-2.5 h-2.5" />
                                  <span>Подтвердить</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleOpenEditMemoryModal(mem)}
                                className="p-1 text-slate-400 hover:text-slate-800 hover:bg-slate-200 rounded transition cursor-pointer"
                                title="Редактировать"
                              >
                                <Edit3 className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteMemoryItem(mem.id, mem.title || mem.content.slice(0, 30))}
                                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition cursor-pointer"
                                title="Удалить"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Add / Edit Memory Item */}
      {isNewMemoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-pink-50 text-pink-600 flex items-center justify-center">
                  <MessageSquareHeart className="w-4 h-4" />
                </span>
                <h3 className="font-bold text-base text-slate-900">
                  {editingMemoryItem ? 'Редактировать факт' : 'Добавить факт об Анне'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsNewMemoryModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveMemoryItem} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Заголовок факта:
                </label>
                <input
                  type="text"
                  required
                  placeholder="Например: Любимая пастельная гамма"
                  value={memFormTitle}
                  onChange={(e) => setMemFormTitle(e.target.value)}
                  className="w-full text-xs sm:text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-pink-500/20 focus:border-pink-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Категория:
                  </label>
                  <select
                    value={memFormCategory}
                    onChange={(e) => setMemFormCategory(e.target.value as AnnaMemoryCategory)}
                    className="w-full text-xs bg-white border border-slate-200 rounded-xl px-2.5 py-2 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-pink-500/20 focus:border-pink-500"
                  >
                    <option value="confirmed_fact">Подтверждённый факт</option>
                    <option value="preference">Предпочтение</option>
                    <option value="work_context">Рабочий контекст</option>
                    <option value="observation">Наблюдение</option>
                    <option value="temporary_note">Временная заметка</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Статус проверки:
                  </label>
                  <select
                    value={memFormStatus}
                    onChange={(e) => setMemFormStatus(e.target.value as AnnaMemoryStatus)}
                    className="w-full text-xs bg-white border border-slate-200 rounded-xl px-2.5 py-2 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-pink-500/20 focus:border-pink-500"
                  >
                    <option value="confirmed_fact">Проверено (confirmed)</option>
                    <option value="observation">Наблюдение (требует проверки)</option>
                    <option value="temporary_note">Черновик (temporary)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Содержание:
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Опишите факт, предпочтение или деталь рабочего контекста..."
                  value={memFormContent}
                  onChange={(e) => setMemFormContent(e.target.value)}
                  className="w-full text-xs sm:text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-normal focus:outline-none focus:ring-2 focus:ring-pink-500/20 focus:border-pink-500 leading-relaxed"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsNewMemoryModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-slate-600 hover:bg-slate-100 transition"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-pink-600 text-white hover:bg-pink-700 transition shadow-sm cursor-pointer"
                >
                  <span>{editingMemoryItem ? 'Сохранить изменения' : 'Добавить факт'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirm Clear All Memory */}
      {confirmClearAllMemory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2.5 text-rose-600">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="font-bold text-base text-slate-900">
                Очистить всю память об Анне?
              </h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Это действие удалит все сохранённые заметки, наблюдения и историю предпочтений из локального хранилища PixelData/Anna/. Вы сможете начать сбор памяти заново.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmClearAllMemory(false)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleClearAllMemory}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 transition shadow-sm cursor-pointer"
              >
                Да, очистить память
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Modal: Add / Edit Connection */}
      {modalState.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center">
                  <KeyRound className="w-4 h-4" />
                </span>
                <h3 className="font-bold text-base text-slate-900">
                  {modalState.isEditing
                    ? 'Изменить подключение'
                    : 'Новое подключение ИИ'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalState(INITIAL_MODAL_STATE)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveModal} className="space-y-4">
              {modalError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              {/* Provider Selector (disabled on edit) */}
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Провайдер:
                </label>
                <select
                  disabled={modalState.isEditing}
                  value={modalState.providerId}
                  onChange={(e) =>
                    setModalState((prev) => ({
                      ...prev,
                      providerId: e.target.value as AIProviderId,
                      selectedModel:
                        e.target.value === 'gemini'
                          ? 'gemini-3.8-flash'
                          : e.target.value === 'openrouter'
                            ? 'openrouter/free'
                            : 'llama3.2:3b',
                    }))
                  }
                  className="w-full text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 disabled:opacity-60"
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="openrouter">OpenRouter Free</option>
                </select>
              </div>

              {/* Name input */}
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Название подключения (для Анны):
                </label>
                <input
                  type="text"
                  required
                  placeholder="Например: Основной Gemini ключ Анны"
                  value={modalState.userDefinedName}
                  onChange={(e) =>
                    setModalState((prev) => ({
                      ...prev,
                      userDefinedName: e.target.value,
                    }))
                  }
                  className="w-full text-xs sm:text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                />
              </div>

              {/* API Key input */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700 block">
                    {modalState.isEditing
                      ? 'Заменить API-ключ (оставьте пустым, если не меняется):'
                      : 'API-ключ:'}
                  </label>
                  {modalState.providerId === 'gemini' ? (
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-teal-600 hover:underline flex items-center gap-1"
                    >
                      <span>Получить ключ Gemini</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <a
                      href="https://openrouter.ai/keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-purple-600 hover:underline flex items-center gap-1"
                    >
                      <span>Получить ключ OpenRouter</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                <div className="relative">
                  <input
                    type={modalState.showRawKey ? 'text' : 'password'}
                    placeholder={
                      modalState.isEditing
                        ? '•••••••••••••••• (не изменяется)'
                        : modalState.providerId === 'gemini'
                          ? 'AIzaSy...'
                          : 'sk-or-v1-...'
                    }
                    value={modalState.rawApiKey}
                    onChange={(e) =>
                      setModalState((prev) => ({
                        ...prev,
                        rawApiKey: e.target.value,
                      }))
                    }
                    className="w-full text-xs sm:text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 pr-10 text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setModalState((prev) => ({
                        ...prev,
                        showRawKey: !prev.showRawKey,
                      }))
                    }
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {modalState.showRawKey ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Model selection */}
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Модель по умолчанию:
                </label>
                {modalState.providerId === 'gemini' ? (
                  <select
                    value={modalState.selectedModel}
                    onChange={(e) =>
                      setModalState((prev) => ({
                        ...prev,
                        selectedModel: e.target.value,
                      }))
                    }
                    className="w-full text-xs sm:text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                  >
                    {GEMINI_AVAILABLE_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={modalState.selectedModel}
                    onChange={(e) =>
                      setModalState((prev) => ({
                        ...prev,
                        selectedModel: e.target.value,
                      }))
                    }
                    className="w-full text-xs sm:text-sm bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                  >
                    <option value="openrouter/free">
                      openrouter/free (Автовыбор бесплатной)
                    </option>
                  </select>
                )}
              </div>

              {/* Is Default Checkbox */}
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={modalState.isDefault}
                  onChange={(e) =>
                    setModalState((prev) => ({
                      ...prev,
                      isDefault: e.target.checked,
                    }))
                  }
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <span>
                  Сделать основным подключением для этого провайдера
                </span>
              </label>

              {/* Modal Buttons */}
              <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalState(INITIAL_MODAL_STATE)}
                  disabled={isSubmittingModal}
                  className="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-slate-600 hover:bg-slate-100 transition"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingModal}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-60 transition shadow-sm"
                >
                  {isSubmittingModal && (
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                  )}
                  <span>Сохранить подключение</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Delete Confirmation Modal */}
      {pendingDeleteProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2.5 text-rose-600">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="font-bold text-base text-slate-900">
                Удалить подключение?
              </h3>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Вы действительно хотите удалить подключение «
              <strong>{pendingDeleteProfile.userDefinedName}</strong>»?
              Соответствующий API-ключ будет удалён из защищённого хранилища.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingDeleteProfile(null)}
                disabled={isDeleting}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60 transition shadow-sm"
              >
                {isDeleting ? 'Удаление...' : 'Да, удалить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
