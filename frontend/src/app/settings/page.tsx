'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  Mic,
  Settings2,
  Sparkles,
  Keyboard,
  Database as DatabaseIcon,
  Info,
  RefreshCw,
  Users,
  Eye,
  EyeOff,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Download,
  Loader2,
} from 'lucide-react';
import { useConfig } from '@/contexts/ConfigContext';
import { PreferenceSettings } from '@/components/PreferenceSettings';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { TranscriptModelProps, TranscriptSettingsProps } from '@/components/TranscriptSettings';
import { DEFAULT_TRANSCRIPT_PROVIDER, getDefaultTranscriptionModel } from '@/constants/modelDefaults';
import { toast } from 'sonner';

type TabValue = 'general' | 'recording' | 'transcription' | 'summary' | 'shortcuts' | 'about';
type ThemeChoice = 'light' | 'dark' | 'system';
type ScaleOption = 80 | 90 | 100 | 110 | 120;

type SavedTranscriptConfig = {
  provider?: TranscriptModelProps['provider'];
  model?: string;
  apiKey?: string | null;
};

type RecordingPreferences = {
  save_folder: string;
  notes_folder: string;
  sync_folders: boolean;
  auto_save: boolean;
  file_format: string;
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
  meeting_app_detection_enabled: boolean;
  hf_token?: string | null;
  system_audio_backend?: string | null;
};

type DiarizationDownloadProgress = {
  percent: number;
  stage: string;
};

function formatDownloadStage(stage: string): string {
  switch (stage) {
    case 'checking_cache':
      return 'Checking local cache';
    case 'requesting_download':
      return 'Contacting HuggingFace';
    case 'finalizing':
      return 'Finalizing model';
    case 'already_downloaded':
      return 'Already downloaded';
    case 'completed':
      return 'Model ready';
    default:
      return stage.replace(/_/g, ' ');
  }
}

const UI_SCALE_STORAGE_KEY = 'ui-scale';
const UI_SCALE_OPTIONS: readonly ScaleOption[] = [80, 90, 100, 110, 120] as const;

const RecordingSettingsPanel = dynamic(
  () => import('@/components/RecordingSettings').then((mod) => mod.RecordingSettings),
  {
    ssr: false,
    loading: () => <SettingsTabSkeleton />,
  }
);

const SummarySettingsPanel = dynamic(
  () => import('@/components/SummaryModelSettings').then((mod) => mod.SummaryModelSettings),
  {
    ssr: false,
    loading: () => <SettingsTabSkeleton />,
  }
);

const AboutPanel = dynamic(
  () => import('@/components/About').then((mod) => mod.About),
  {
    ssr: false,
    loading: () => <SettingsTabSkeleton />,
  }
);

const TranscriptSettingsPanel = dynamic<TranscriptSettingsProps>(
  () => import('@/components/TranscriptSettings').then((mod) => mod.TranscriptSettings),
  {
    ssr: false,
    loading: () => <SettingsTabSkeleton />,
  }
);

const ShortcutsEditorPanel = dynamic(
  () => import('@/components/Settings/ShortcutsEditor').then((mod) => mod.ShortcutsEditor),
  {
    ssr: false,
    loading: () => <SettingsTabSkeleton />,
  }
);

const TABS: ReadonlyArray<{ value: TabValue; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: 'general', label: 'General', icon: Settings2 },
  { value: 'recording', label: 'Recordings', icon: Mic },
  { value: 'transcription', label: 'Transcription', icon: DatabaseIcon },
  { value: 'summary', label: 'Summary', icon: Sparkles },
  { value: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { value: 'about', label: 'About', icon: Info },
];

class SettingsErrorBoundary extends React.Component<
  {
    boundaryKey: number;
    tabLabel: string;
    onRetry: () => void;
    children: React.ReactNode;
  },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: Readonly<{ boundaryKey: number }>) {
    if (prevProps.boundaryKey !== this.props.boundaryKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error: Error) {
    console.error(`[SettingsPage] ${this.props.tabLabel} tab crashed:`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <SettingsErrorState
          title={`${this.props.tabLabel} couldn’t be displayed`}
          description="Something went wrong while rendering this settings panel. Try reloading it."
          onRetry={this.props.onRetry}
        />
      );
    }

    return this.props.children;
  }
}

function SettingsPanelCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-border bg-card/95 p-6 shadow-sm shadow-black/5 backdrop-blur-sm ${className}`.trim()}
    >
      {children}
    </div>
  );
}

function SettingsSection({
  label,
  description,
  control,
}: {
  label: string;
  description: string;
  control: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-sm font-medium text-foreground">{label}</h3>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="mt-2">{control}</div>
    </div>
  );
}

function SettingsTabSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((item) => (
        <SettingsPanelCard key={item} className="animate-pulse space-y-4">
          <div className="h-4 w-28 rounded-lg bg-muted" />
          <div className="h-3 w-2/3 rounded-lg bg-muted" />
          <div className="h-10 w-full rounded-xl bg-muted" />
        </SettingsPanelCard>
      ))}
    </div>
  );
}

function SettingsErrorState({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry: () => void;
}) {
  return (
    <SettingsPanelCard>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="min-h-11 gap-2 rounded-xl text-foreground"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    </SettingsPanelCard>
  );
}

function GhostModeToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span
        className={`relative inline-flex h-6 w-11 items-center rounded-lg transition-colors ${
          checked ? 'bg-accent' : 'bg-border'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-background shadow-sm transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </span>
      <span>{checked ? 'Enabled' : 'Disabled'}</span>
    </button>
  );
}

function GeneralSettingsContent() {
  const { theme, setTheme } = useTheme();
  const selectedTheme = (theme ?? 'system') as ThemeChoice;
  const [ghostMode, setGhostMode] = useState(false);
  const [ghostModeLoading, setGhostModeLoading] = useState(true);
  const [ghostModeSaving, setGhostModeSaving] = useState(false);
  const [ghostModeError, setGhostModeError] = useState<string | null>(null);
  const [uiScale, setUiScale] = useState<ScaleOption>(100);

  type DiarizationProvider = 'local' | 'huggingface';
  const [diarizationProvider, setDiarizationProvider] = useState<DiarizationProvider>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('diarization-provider') as DiarizationProvider) || 'local';
    }
    return 'local';
  });
  const [hfToken, setHfToken] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('hf-token') || '';
    }
    return '';
  });
  const [showHfToken, setShowHfToken] = useState(false);
  const [hfTokenSaved, setHfTokenSaved] = useState(false);
  const [savedHfToken, setSavedHfToken] = useState('');
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [downloadStage, setDownloadStage] = useState('idle');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isDownloadingModel, setIsDownloadingModel] = useState(false);
  const [isModelReady, setIsModelReady] = useState(false);

  const canSaveHfToken = hfToken.startsWith('hf_');
  const isHfTokenPersisted = canSaveHfToken && hfToken.trim() === savedHfToken;

  const persistHfToken = useCallback(async (token: string) => {
    const preferences = await invoke<RecordingPreferences>('get_recording_preferences');
    await invoke('set_recording_preferences', {
      preferences: {
        ...preferences,
        hf_token: token.trim(),
      },
    });
  }, []);

  const loadGhostMode = useCallback(async () => {
    setGhostModeLoading(true);
    setGhostModeError(null);

    try {
      const enabled = await invoke<boolean>('get_ghost_mode');
      setGhostMode(enabled);
    } catch (error) {
      console.error('[SettingsPage] Failed to load ghost mode state:', error);
      setGhostModeError('Ghost mode couldn’t be loaded.');
    } finally {
      setGhostModeLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGhostMode();
  }, [loadGhostMode]);

  useEffect(() => {
    let isMounted = true;

    const loadSavedHfToken = async () => {
      try {
        const preferences = await invoke<RecordingPreferences>('get_recording_preferences');
        const persistedToken = preferences.hf_token?.trim() ?? '';
        const localToken = typeof window !== 'undefined' ? window.localStorage.getItem('hf-token')?.trim() ?? '' : '';
        const resolvedToken = localToken || persistedToken;

        if (!isMounted) {
          return;
        }

        setSavedHfToken(persistedToken || resolvedToken);

        if (!hfToken && resolvedToken) {
          setHfToken(resolvedToken);
        }

        if (persistedToken !== localToken && resolvedToken && typeof window !== 'undefined') {
          window.localStorage.setItem('hf-token', resolvedToken);
        }
      } catch (error) {
        console.error('[SettingsPage] Failed to load saved HF token:', error);
      }
    };

    void loadSavedHfToken();

    return () => {
      isMounted = false;
    };
  }, [hfToken]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setupListener = async () => {
      unlisten = await listen<DiarizationDownloadProgress>('diarization-model-download-progress', (event) => {
        const nextPercent = event.payload.percent ?? 0;
        const nextStage = event.payload.stage ?? 'idle';

        setDownloadPercent(nextPercent);
        setDownloadStage(nextStage);

        if (nextStage === 'already_downloaded' || nextStage === 'completed') {
          setIsDownloadingModel(false);
          setIsModelReady(true);
          setDownloadError(null);
        }
      });
    };

    void setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const savedScale = window.localStorage.getItem(UI_SCALE_STORAGE_KEY);
    const parsedScale = Number(savedScale);

    if (UI_SCALE_OPTIONS.includes(parsedScale as ScaleOption)) {
      setUiScale(parsedScale as ScaleOption);
    } else {
      setUiScale(90);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    document.documentElement.style.fontSize = `${uiScale}%`;
    window.localStorage.setItem(UI_SCALE_STORAGE_KEY, String(uiScale));
  }, [uiScale]);

  const handleGhostModeChange = useCallback(async (nextValue: boolean) => {
    setGhostMode(nextValue);
    setGhostModeSaving(true);
    setGhostModeError(null);

    try {
      const result = await invoke<boolean | void>('toggle_ghost_mode');
      if (typeof result === 'boolean') {
        setGhostMode(result);
      }
    } catch (error) {
      console.error('[SettingsPage] Failed to toggle ghost mode:', error);
      setGhostMode(!nextValue);
      setGhostModeError('Ghost mode could not be updated. Please try again.');
    } finally {
      setGhostModeSaving(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      <SettingsPanelCard className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">General preferences</h2>
          <p className="text-sm text-muted-foreground">
            Fine-tune how Ultra looks and behaves before you dive into recording and AI settings.
          </p>
        </div>

        <SettingsSection
          label="Appearance"
          description="Choose the app theme for your workspace. System follows your device appearance automatically."
          control={
            <div className="inline-flex min-h-11 flex-wrap gap-1 rounded-xl bg-muted p-1">
              {(['light', 'dark', 'system'] as const).map((themeOption) => {
                const isActive = selectedTheme === themeOption;

                return (
                  <button
                    key={themeOption}
                    type="button"
                    onClick={() => setTheme(themeOption)}
                    className={`rounded-lg px-3 py-1.5 text-sm capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      isActive
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {themeOption}
                  </button>
                );
              })}
            </div>
          }
        />

        <div className="border-t border-border" />

        <SettingsSection
          label="Ghost Mode"
          description="Hide app from dock. Only accessible from menu bar. Tray icon turns red when recording."
          control={
            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <GhostModeToggle
                  checked={ghostMode}
                  disabled={ghostModeLoading || ghostModeSaving}
                  onChange={handleGhostModeChange}
                />
                <span
                  className={`inline-flex w-fit items-center gap-2 rounded-lg border px-3 py-1 text-xs font-medium ${
                    ghostMode
                      ? 'border-accent/30 bg-accent/10 text-accent'
                      : 'border-border bg-muted text-muted-foreground'
                  }`}
                >
                  <span className="h-2 w-2 rounded-full bg-current" />
                  {ghostModeLoading ? 'Checking status…' : ghostMode ? 'Ghost mode is active' : 'Ghost mode is off'}
                </span>
              </div>

              {ghostModeError ? (
                <div className="flex flex-col gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-destructive">{ghostModeError}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadGhostMode()}
                    className="min-h-11 gap-2 rounded-xl text-foreground"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Retry
                  </Button>
                </div>
              ) : null}
            </div>
          }
        />

        <div className="border-t border-border" />

        <SettingsSection
          label="Interface Scale"
          description="Adjust the size of the user interface"
          control={
            <div className="space-y-3">
              <div className="inline-flex flex-wrap gap-2">
                {UI_SCALE_OPTIONS.map((option) => {
                  const isActive = uiScale === option;

                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setUiScale(option)}
                      className={`inline-flex min-h-11 items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                        isActive
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted'
                      }`}
                    >
                      {option}%
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Current interface scale: <span className="font-medium text-foreground">{uiScale}%</span>
              </p>
            </div>
          }
        />
      </SettingsPanelCard>

      <SettingsPanelCard className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">Speaker Diarization</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Identify who said what in your meetings. Runs fully on-device.
          </p>
        </div>

        <SettingsSection
          label="Diarization Engine"
          description="Select how speaker identification is performed after recording."
          control={
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setDiarizationProvider('local');
                    localStorage.setItem('diarization-provider', 'local');
                  }}
                  className={`flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-colors ${
                    diarizationProvider === 'local'
                      ? 'border-foreground bg-foreground/5'
                      : 'border-border hover:border-foreground/30 hover:bg-muted'
                  }`}
                >
                  <span className="text-sm font-medium text-foreground">Local (Built-in)</span>
                  <span className="text-xs text-muted-foreground">
                    Uses whisper.cpp tinydiarize. Basic accuracy, runs during transcription. No setup needed.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDiarizationProvider('huggingface');
                    localStorage.setItem('diarization-provider', 'huggingface');
                  }}
                  className={`flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-colors ${
                    diarizationProvider === 'huggingface'
                      ? 'border-foreground bg-foreground/5'
                      : 'border-border hover:border-foreground/30 hover:bg-muted'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    Enhanced (Pyannote)
                    <span className="rounded-lg bg-gradient-to-r from-[#5B4DCC]/20 to-[#FFD166]/20 px-2 py-0.5 text-[10px] font-semibold text-foreground">
                      Recommended
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    State-of-the-art accuracy via pyannote + WeSpeaker ONNX. Runs fully locally after recording. ~35 MB one-time download.
                  </span>
                </button>
              </div>
            </div>
          }
        />

        {diarizationProvider === 'huggingface' && (
          <>
            <div className="border-t border-border" />

            <SettingsSection
              label="Diarization Models"
              description="Downloads the pyannote segmentation + WeSpeaker embedding ONNX models (~35 MB). Fully offline after download. No account required."
              control={
                <div className="space-y-3">
                  <div className="space-y-3 rounded-xl border border-border bg-background/70 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <Button
                        variant="brand"
                        disabled={isDownloadingModel || isModelReady}
                        onClick={async () => {
                          setIsDownloadingModel(true);
                          setIsModelReady(false);
                          setDownloadError(null);
                          setDownloadPercent(8);
                          setDownloadStage('checking_cache');

                          try {
                            await invoke('download_diarization_model');
                            setIsDownloadingModel(false);
                            setIsModelReady(true);
                            toast.success('Speaker diarization model is ready', {
                              description: 'The pyannote model has been downloaded and cached locally.',
                            });
                          } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            setIsDownloadingModel(false);
                            setIsModelReady(false);
                            setDownloadError(message);
                            toast.error('Failed to download diarization model', {
                              description: message,
                            });
                          }
                        }}
                        className={`h-11 gap-2 rounded-lg px-6 transition-all ${
                          isModelReady
                            ? 'bg-success text-success-foreground disabled:opacity-100'
                            : 'bg-gradient-to-r from-[#5B4DCC] via-[#F06A8B] to-[#FFD166] text-white hover:from-[#6A5ACF] hover:via-[#F47AAC] hover:to-[#FFE08A]'
                        }`}
                      >
                        {isDownloadingModel ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : isModelReady ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        <span>
                          {isDownloadingModel ? 'Downloading...' : isModelReady ? 'Model Ready' : 'Download Model'}
                        </span>
                      </Button>

                      {isModelReady && (
                        <span className="inline-flex items-center gap-2 rounded-lg border border-success/20 bg-success/10 px-3 py-1 text-xs font-medium text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Ready for diarization
                        </span>
                      )}
                    </div>

                    {(isDownloadingModel || isModelReady) && (
                      <div className="space-y-1.5">
                        <div className="h-2 overflow-hidden rounded-lg bg-muted">
                          <div
                            className="h-full rounded-lg bg-gradient-to-r from-[#5B4DCC] via-[#F06A8B] to-[#FFD166] transition-all duration-300"
                            style={{ width: `${Math.max(0, Math.min(downloadPercent, 100))}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{formatDownloadStage(downloadStage)}</span>
                          <span>{Math.round(downloadPercent)}%</span>
                        </div>
                      </div>
                    )}

                    {downloadError && (
                      <div className="text-sm text-destructive">
                        {downloadError}{' '}
                        <Button
                          variant="link"
                          onClick={() => {
                            setDownloadError(null);
                            setIsModelReady(false);
                          }}
                          className="font-medium h-auto p-0"
                        >
                          Retry
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-border bg-muted/50 p-3 space-y-2">
                    <p className="text-xs font-medium text-foreground">How it works:</p>
                    <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground">
                      <li>Click <span className="font-medium text-foreground">Download Model</span> — fetches ~35 MB of ONNX models from GitHub</li>
                      <li>Open a saved meeting and click <span className="font-medium text-foreground">Analyze Speakers</span> to label segments</li>
                    </ol>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Runs entirely on-device after download. No account, no HuggingFace token, no network required at analysis time.
                    </p>
                  </div>
                </div>
              }
            />
          </>
        )}
      </SettingsPanelCard>

      <PreferenceSettings />
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const { transcriptModelConfig, setTranscriptModelConfig } = useConfig();
  const [activeTab, setActiveTab] = useState<TabValue>('general');
  const [transcriptConfigStatus, setTranscriptConfigStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [transcriptConfigError, setTranscriptConfigError] = useState<string | null>(null);
  const [boundaryKeys, setBoundaryKeys] = useState<Record<TabValue, number>>({
    general: 0,
    recording: 0,
    transcription: 0,
    summary: 0,
    shortcuts: 0,
    about: 0,
  });

  const loadTranscriptConfig = useCallback(async () => {
    setTranscriptConfigStatus('loading');
    setTranscriptConfigError(null);

    try {
      const config = await invoke<SavedTranscriptConfig>('api_get_transcript_config');
      const provider = config.provider || DEFAULT_TRANSCRIPT_PROVIDER;
      setTranscriptModelConfig({
        provider,
        model: config.model || getDefaultTranscriptionModel(provider),
        apiKey: config.apiKey || null,
      });
      setTranscriptConfigStatus('ready');
    } catch (error) {
      console.error('[SettingsPage] Failed to load transcript config:', error);
      setTranscriptConfigStatus('error');
      setTranscriptConfigError('Transcription settings could not be loaded.');
    }
  }, [setTranscriptModelConfig]);

  useEffect(() => {
    void loadTranscriptConfig();
  }, [loadTranscriptConfig]);

  const tabDescriptions = useMemo(
    () => ({
      general: 'Appearance, privacy, storage, and day-to-day app preferences.',
      recording: 'Audio capture, folders, devices, and recording behavior.',
      transcription: 'Speech-to-text provider selection, model downloads, and API credentials.',
      summary: 'Configure post-meeting summaries and automatic AI generation.',
      shortcuts: 'View and customize the keyboard shortcuts used across the app.',
      about: 'Version details, updates, and product information.',
    }),
    []
  );

  const retryTab = useCallback(
    (tab: TabValue) => {
      setBoundaryKeys((current) => ({
        ...current,
        [tab]: current[tab] + 1,
      }));

      if (tab === 'transcription') {
        void loadTranscriptConfig();
      }
    },
    [loadTranscriptConfig]
  );

  return (
    <div className="flex h-screen flex-col bg-background overflow-hidden">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5 sm:px-8">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              onClick={() => router.back()}
              className="min-h-11 gap-2 rounded-xl text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>

            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Settings</h1>
              <p className="text-sm text-muted-foreground">
                Update the app theme, privacy controls, recording defaults, and AI configuration.
              </p>
            </div>
          </div>

          <div />

        </div>
      </header>

      <main className="custom-scrollbar flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-6 sm:px-8">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabValue)} className="space-y-6">
                <TabsList className="h-auto w-full flex-wrap justify-start gap-2 rounded-xl border border-border bg-muted/70 p-1.5 text-muted-foreground">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.value;

                return (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="relative min-h-11 rounded-lg px-4 py-2.5 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                  >
                    {isActive ? (
                      <motion.span
                        layoutId="settings-tab-indicator"
                        className="absolute inset-0 rounded-lg border border-border bg-background shadow-sm"
                        initial={prefersReducedMotion ? false : undefined}
                        animate={prefersReducedMotion ? false : undefined}
                        transition={prefersReducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 360, damping: 32 }}
                      />
                    ) : null}
                    <span className="relative z-10 flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      {tab.label}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {TABS.map((tab) => (
              <TabsContent key={tab.value} value={tab.value} className="mt-0">
                <div className="mb-4 space-y-1">
                  <h2 className="text-lg font-semibold text-foreground">{tab.label}</h2>
                  <p className="text-sm text-muted-foreground">{tabDescriptions[tab.value]}</p>
                </div>

                <SettingsErrorBoundary
                  boundaryKey={boundaryKeys[tab.value]}
                  tabLabel={tab.label}
                  onRetry={() => retryTab(tab.value)}
                >
                  {tab.value === 'general' ? <GeneralSettingsContent /> : null}

                  {tab.value === 'recording' ? <RecordingSettingsPanel /> : null}

                  {tab.value === 'transcription' ? (
                    transcriptConfigStatus === 'loading' || transcriptConfigStatus === 'idle' ? (
                      <SettingsTabSkeleton />
                    ) : transcriptConfigStatus === 'error' ? (
                      <SettingsErrorState
                        title="Transcription settings couldn’t be loaded"
                        description={transcriptConfigError || 'Try loading this tab again.'}
                        onRetry={() => retryTab('transcription')}
                      />
                    ) : (
                      <TranscriptSettingsPanel
                        transcriptModelConfig={transcriptModelConfig}
                        setTranscriptModelConfig={setTranscriptModelConfig}
                      />
                    )
                  ) : null}

                  {tab.value === 'summary' ? <SummarySettingsPanel /> : null}
                  {tab.value === 'shortcuts' ? <ShortcutsEditorPanel /> : null}
                  {tab.value === 'about' ? <AboutPanel /> : null}
                </SettingsErrorBoundary>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </main>
    </div>
  );
}
