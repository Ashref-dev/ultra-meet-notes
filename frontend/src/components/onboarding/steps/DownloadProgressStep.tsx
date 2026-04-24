import React, { useCallback, useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Mic, Sparkles, Check, Loader2, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { toast } from 'sonner';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { DEFAULT_WHISPER_MODEL } from '@/constants/modelDefaults';

const PARAKEET_MODEL = 'parakeet-tdt-0.6b-v3-int8';
const WHISPER_MODEL = DEFAULT_WHISPER_MODEL;

type DownloadStatus = 'waiting' | 'downloading' | 'completed' | 'error';

interface DownloadState {
  status: DownloadStatus;
  progress: number;
  downloadedMb: number;
  totalMb: number;
  speedMbps: number;
  error?: string;
}

export function DownloadProgressStep() {
  const {
    goNext,
    selectedTranscriptionProvider,
    includeSummaryModel,
    includeTranscriptionModel,
    selectedSummaryModel,
    setSelectedSummaryModel,
    parakeetDownloaded,
    setParakeetDownloaded,
    summaryModelDownloaded,
    setSummaryModelDownloaded,
    startBackgroundDownloads,
    completeOnboarding,
  } = useOnboarding();

  const [recommendedModel, setRecommendedModel] = useState<string>('gemma3:1b');
  const [isMac, setIsMac] = useState(false);

  const [parakeetState, setParakeetState] = useState<DownloadState>({
    status: parakeetDownloaded ? 'completed' : 'waiting',
    progress: parakeetDownloaded ? 100 : 0,
    downloadedMb: 0,
    totalMb: selectedTranscriptionProvider === 'whisper' ? 1549 : 670,
    speedMbps: 0,
  });

  const [gemmaState, setGemmaState] = useState<DownloadState>({
    status: !includeSummaryModel ? 'completed' : summaryModelDownloaded ? 'completed' : 'waiting',
    progress: !includeSummaryModel ? 100 : summaryModelDownloaded ? 100 : 0,
    downloadedMb: 0,
    totalMb: 806, // 1b model size
    speedMbps: 0,
  });

  const [isCompleting, setIsCompleting] = useState(false);
  const downloadStartedRef = useRef(false);
  const retryingRef = useRef(false);
  const retryingSummaryRef = useRef(false);
  const prefersReducedMotion = useReducedMotion();

  // Retry download handler
  const handleRetryDownload = async () => {
    // Prevent multiple simultaneous retries
    if (retryingRef.current) {
      console.log('[DownloadProgressStep] Retry already in progress, ignoring');
      return;
    }

    console.log('[DownloadProgressStep] Retrying Parakeet download');
    retryingRef.current = true;

    // Reset error state
    setParakeetState((prev) => ({
      ...prev,
      status: 'waiting',
      error: undefined,
      progress: 0,
      downloadedMb: 0,
      speedMbps: 0,
    }));

    try {
      await invoke('parakeet_retry_download', { modelName: PARAKEET_MODEL });
      // Progress events will update state
    } catch (error) {
      console.error('[DownloadProgressStep] Retry failed:', error);
      setParakeetState((prev) => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : 'Retry failed',
      }));

      toast.error('Download retry failed', {
        description: 'Please check your connection and try again.',
      });
    } finally {
      // Allow retry again after 2 seconds
      setTimeout(() => {
        retryingRef.current = false;
      }, 2000);
    }
  };

  // Retry summary download handler
  const handleRetrySummaryDownload = async () => {
    // Prevent multiple simultaneous retries
    if (retryingSummaryRef.current) {
      console.log('[DownloadProgressStep] Summary retry already in progress, ignoring');
      return;
    }

    console.log('[DownloadProgressStep] Retrying summary model download');
    retryingSummaryRef.current = true;

    // Reset error state
    setGemmaState((prev) => ({
      ...prev,
      status: 'downloading',
      error: undefined,
      progress: 0,
      downloadedMb: 0,
      speedMbps: 0,
    }));

    try {
      // Call download command directly (no retry command exists for built-in AI)
      await invoke('builtin_ai_download_model', { modelName: selectedSummaryModel || recommendedModel });
    } catch (error) {
      console.error('[DownloadProgressStep] Summary retry failed:', error);
      setGemmaState((prev) => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : 'Retry failed',
      }));

      toast.error('Summary model download retry failed', {
        description: 'Please check your connection and try again.',
      });
    } finally {
      // Allow retry again after 2 seconds
      setTimeout(() => {
        retryingSummaryRef.current = false;
      }, 2000);
    }
  };

  const startDownloads = useCallback(async () => {
    if ((includeTranscriptionModel && !parakeetDownloaded) || (includeSummaryModel && !summaryModelDownloaded)) {
      try {
        if (includeTranscriptionModel && !parakeetDownloaded) {
          setParakeetState((prev) => ({ ...prev, status: 'downloading' }));
        }
        if (includeSummaryModel && !summaryModelDownloaded) {
          setGemmaState((prev) => ({ ...prev, status: 'downloading' }));
        }
        await startBackgroundDownloads();
      } catch (error) {
        console.error('Failed to start downloads:', error);
        if (includeTranscriptionModel && !parakeetDownloaded) {
          setParakeetState((prev) => ({ ...prev, status: 'error', error: String(error) }));
        }
      }
    }
  }, [includeSummaryModel, includeTranscriptionModel, parakeetDownloaded, startBackgroundDownloads, summaryModelDownloaded]);

  // Fetch recommended model and detect platform on mount
  useEffect(() => {
    const fetchRecommendation = async () => {
      try {
        const model = await invoke<string>('builtin_ai_get_recommended_model');
        setRecommendedModel(model);
        setSelectedSummaryModel(model);  // Update context
      } catch (error) {
        console.error('Failed to get recommended model:', error);
        // Keep default gemma3:1b
      }
    };

    const checkPlatform = async () => {
      try {
        const { platform } = await import('@tauri-apps/plugin-os');
        setIsMac(platform() === 'macos');
      } catch (e) {
        setIsMac(navigator.userAgent.includes('Mac'));
      }
    };

    fetchRecommendation();
    checkPlatform();
  }, [setSelectedSummaryModel]);

  useEffect(() => {
    setParakeetState((prev) => ({
      ...prev,
      totalMb: selectedTranscriptionProvider === 'whisper' ? 1549 : 670,
    }));
  }, [selectedTranscriptionProvider]);

  useEffect(() => {
    if (!includeSummaryModel) {
      setGemmaState((prev) => ({
        ...prev,
        status: 'completed',
        progress: 100,
        error: undefined,
      }));
      return;
    }

    setGemmaState((prev) => {
      if (summaryModelDownloaded) {
        return {
          ...prev,
          status: 'completed',
          progress: 100,
          error: undefined,
        };
      }

      return prev.status === 'completed' && prev.progress === 100
        ? {
            ...prev,
            status: 'waiting',
            progress: 0,
            error: undefined,
          }
        : prev;
    });
  }, [includeSummaryModel, summaryModelDownloaded]);

  // Start downloads on mount
  useEffect(() => {
    if (downloadStartedRef.current) return;
    downloadStartedRef.current = true;

    startDownloads();
  }, [startDownloads]);

  // Listen to Parakeet download progress
  useEffect(() => {
    const unlistenProgress = listen<{
      modelName: string;
      progress: number;
      downloaded_mb?: number;
      total_mb?: number;
      speed_mbps?: number;
      status?: string;
    }>('parakeet-model-download-progress', (event) => {
      const { modelName, progress, downloaded_mb, total_mb, speed_mbps, status } = event.payload;
      if (modelName === PARAKEET_MODEL) {
        setParakeetState((prev) => ({
          ...prev,
          status: status === 'completed' ? 'completed' : 'downloading',
          progress,
          downloadedMb: downloaded_mb ?? prev.downloadedMb,
          totalMb: total_mb ?? prev.totalMb,
          speedMbps: speed_mbps ?? prev.speedMbps,
        }));

        if (status === 'completed' || progress >= 100) {
          setParakeetDownloaded(true);
        }
      }
    });

    const unlistenComplete = listen<{ modelName: string }>(
      'parakeet-model-download-complete',
      (event) => {
        if (event.payload.modelName === PARAKEET_MODEL) {
          setParakeetState((prev) => ({ ...prev, status: 'completed', progress: 100 }));
          setParakeetDownloaded(true);
        }
      }
    );

    const unlistenError = listen<{ modelName: string; error: string }>(
      'parakeet-model-download-error',
      (event) => {
        if (event.payload.modelName === PARAKEET_MODEL) {
          setParakeetState((prev) => ({
            ...prev,
            status: 'error',
            error: event.payload.error,
          }));
        }
      }
    );

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, [setParakeetDownloaded]);

  useEffect(() => {
    const unlistenProgress = listen<{
      modelName: string;
      progress: number;
    }>('model-download-progress', (event) => {
      const { modelName, progress } = event.payload;
      if (modelName === WHISPER_MODEL) {
        setParakeetState((prev) => ({
          ...prev,
          status: 'downloading',
          progress,
          downloadedMb: prev.totalMb > 0 ? (prev.totalMb * progress) / 100 : prev.downloadedMb,
        }));
      }
    });

    const unlistenComplete = listen<{ modelName: string }>('model-download-complete', (event) => {
      if (event.payload.modelName === WHISPER_MODEL) {
        setParakeetState((prev) => ({ ...prev, status: 'completed', progress: 100 }));
        setParakeetDownloaded(true);
      }
    });

    const unlistenError = listen<{ modelName: string; error: string }>('model-download-error', (event) => {
      if (event.payload.modelName === WHISPER_MODEL) {
        setParakeetState((prev) => ({
          ...prev,
          status: 'error',
          error: event.payload.error,
        }));
      }
    });

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, [setParakeetDownloaded]);

  // Listen to Gemma download progress (always downloading for builtin-ai)
  useEffect(() => {
    const unlisten = listen<{
      model: string;
      progress: number;
      downloaded_mb?: number;
      total_mb?: number;
      speed_mbps?: number;
      status: string;
      error?: string;
    }>('builtin-ai-download-progress', (event) => {
      const { model, progress, downloaded_mb, total_mb, speed_mbps, status, error } = event.payload;
      if (model === selectedSummaryModel || model === 'gemma3:1b' || model === 'gemma3:4b') {
        setGemmaState((prev) => ({
          ...prev,
          status: status === 'completed'
            ? 'completed'
            : status === 'error'
            ? 'error'
            : 'downloading',
          progress,
          downloadedMb: downloaded_mb ?? prev.downloadedMb,
          totalMb: total_mb ?? prev.totalMb,
          speedMbps: speed_mbps ?? prev.speedMbps,
          error: status === 'error' ? error : undefined,
        }));

        if (status === 'completed' || progress >= 100) {
          setSummaryModelDownloaded(true);
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [selectedSummaryModel, setSummaryModelDownloaded]);

  const handleContinue = async () => {
    // Verify actual model availability (catches state drift)
    try {
      const actuallyAvailable = selectedTranscriptionProvider === 'whisper'
        ? await (async () => {
            await invoke('whisper_init');
            return invoke<boolean>('whisper_has_available_models');
          })()
        : await (async () => {
            await invoke('parakeet_init');
            return invoke<boolean>('parakeet_has_available_models');
          })();

      if (actuallyAvailable && !parakeetDownloaded) {
        console.log('[DownloadProgressStep] Transcription model available but state not updated');
        setParakeetDownloaded(true);
        setParakeetState((prev) => ({
          ...prev,
          status: 'completed',
          progress: 100,
        }));
      }
    } catch (error) {
      console.warn('[DownloadProgressStep] Failed to verify model:', error);
    }

    // Check if downloads are complete for toast notification
    const downloadsComplete = (!includeTranscriptionModel || parakeetState.status === 'completed') &&
      (!includeSummaryModel || gemmaState.status === 'completed');

    // Show toast if downloads still in progress or skipped
    if (!downloadsComplete) {
      toast.info('You can configure transcription models in Settings', {
        description: 'Go to Settings > Transcription to download and select your preferred model.',
        duration: 5000,
      });
    }

    if (isMac) {
      // macOS: Go to Permissions step (will complete after permissions granted)
      goNext();
    } else {
      // Non-macOS: Complete onboarding immediately (downloads continue in background)
      setIsCompleting(true);
      try {
        await completeOnboarding();

        // Small delay to ensure state is saved before reload
        await new Promise(resolve => setTimeout(resolve, 100));

        window.location.reload();
      } catch (error) {
        console.error('Failed to complete onboarding:', error);
        toast.error('Failed to complete setup', {
          description: 'Please try again.',
        });
        setIsCompleting(false);
      }
    }
  };

  const renderDownloadCard = (
    title: string,
    icon: React.ReactNode,
    state: DownloadState,
    modelSize: string
  ) => (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            {icon}
          </div>
          <div>
            <h3 className="font-medium text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground">{modelSize}</p>
          </div>
        </div>
        <div>
          {state.status === 'waiting' && (
            <span className="text-sm text-muted-foreground">Waiting...</span>
          )}
          {state.status === 'downloading' && (
            <Loader2 className="h-5 w-5 animate-spin text-foreground" />
          )}
          {state.status === 'completed' && (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
              <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
            </div>
          )}
          {state.status === 'error' && (
            <span className="text-sm text-destructive">Failed</span>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      {(state.status === 'downloading' || state.status === 'completed') && (
        <div className="space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-lg bg-muted">
            <div
              className="h-full rounded-lg bg-accent transition-all duration-300"
              style={{ width: `${state.progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {state.downloadedMb.toFixed(1)} MB / {state.totalMb.toFixed(1)} MB
            </span>
            <div className="flex items-center gap-2">
              {state.speedMbps > 0 && (
                <span className="text-muted-foreground">
                  {state.speedMbps.toFixed(1)} MB/s
                </span>
              )}
              <span className="font-semibold text-foreground">
                {Math.round(state.progress)}%
              </span>
            </div>
          </div>
        </div>
      )}

      {state.status === 'error' && state.error && (
        <div className="mt-2 rounded-md border border-destructive/20 bg-destructive/10 p-3">
          <p className="text-sm font-medium text-destructive">Download Error</p>
          <p className="mt-1 text-xs text-destructive">{state.error}</p>
          {(title.includes('Transcription Engine') || title === 'Summary Engine') && (
            <Button
              variant="destructive"
              size="sm"
              onClick={title.includes('Transcription Engine') ? handleRetryDownload : handleRetrySummaryDownload}
              className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </Button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <OnboardingContainer
      title="Getting things ready"
      description={
        <>
          <span>You can start using </span>
          <span className="font-display tracking-[0.08em]">Ultra</span>
          <span> after downloading your selected transcription engine.</span>
        </>
      }
      step={4}
      totalSteps={isMac ? 5 : 4}
    >
      <div className="flex flex-col items-center space-y-6">
        {/* Download Cards */}
        <div className="w-full max-w-lg space-y-4">
          {includeTranscriptionModel && renderDownloadCard(
            selectedTranscriptionProvider === 'whisper' ? 'Whisper Transcription Engine' : 'Parakeet Transcription Engine',
            <Mic className="h-5 w-5 text-muted-foreground" />,
            parakeetState,
            selectedTranscriptionProvider === 'whisper' ? '~1.5 GB' : '~200 MB'
          )}

          {includeSummaryModel && renderDownloadCard(
            'Summary Engine',
            <Sparkles className="h-5 w-5 text-muted-foreground" />,
            gemmaState,
            recommendedModel === 'gemma3:4b' ? '~2.5 GB' : '~806 MB'
          )}
        </div>

        {!includeTranscriptionModel && !includeSummaryModel && (
          <div className="w-full max-w-lg rounded-lg bg-muted p-4 text-sm text-muted-foreground text-center">
            No models selected. You can download models anytime from Settings.
          </div>
        )}

        {/* Info Message - Only show when transcription is ready and summary is still downloading */}
        <AnimatePresence>
          {parakeetDownloaded && includeSummaryModel && !summaryModelDownloaded && (
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: -10 }}
              animate={prefersReducedMotion ? false : { opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.3, ease: 'easeOut' }}
              className="w-full max-w-lg rounded-lg bg-muted p-4 text-sm text-foreground"
            >
              <div className="flex items-start gap-3">
                <Download className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground" />
                <div>
                  <p className="font-medium">You can continue while this finishes</p>
                  <p className="mt-1 text-muted-foreground">
                    Download will continue in the background.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Continue Button */}
        <div className="w-full max-w-xs space-y-2">
          <Button
            onClick={handleContinue}
            disabled={(includeTranscriptionModel && !parakeetDownloaded) || isCompleting}
            className="h-11 w-full disabled:cursor-not-allowed disabled:opacity-50"
          >
            {(isCompleting || (includeTranscriptionModel && !parakeetDownloaded)) ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              'Continue'
            )}
          </Button>
          {(includeTranscriptionModel && !parakeetDownloaded) && (
            <button
              type="button"
              onClick={handleContinue}
              disabled={isCompleting}
              className="w-full text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              I'll set up models later from Settings
            </button>
          )}
        </div>
      </div>
    </OnboardingContainer>
  );
}
