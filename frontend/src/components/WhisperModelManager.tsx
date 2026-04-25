import React, { useState, useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Check, Download, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  ModelInfo,
  ModelStatus,
  formatFileSize,
  getModelPerformanceBadge,
  isQuantizedModel,
  getModelTagline,
  WhisperAPI
} from '../lib/whisper';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog';
import { cn } from '@/lib/utils';

const DOWNLOAD_BUTTON_CLASSNAME =
  'h-11 rounded-lg bg-brand-purple px-6 text-white shadow-md transition-all hover:bg-brand-purple/90 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-brand-purple/40 disabled:cursor-not-allowed disabled:opacity-60';
const DOWNLOAD_PROGRESS_CLASSNAME = 'bg-brand-purple';

const BASIC_MODEL_NAMES = ['small', 'medium-q5_0', 'large-v3-q5_0', 'large-v3-turbo', 'large-v3'];

const WHISPER_MODEL_NAME_MAPPING: Record<string, string> = {
  small: 'Small',
  'medium-q5_0': 'Medium',
  'large-v3-q5_0': 'Large V3 Compressed',
  'large-v3-turbo': 'Large V3 Turbo',
  'large-v3': 'Large V3',
};

function getPersistedDownloadingModelNames(): Set<string> {
  try {
    const saved = localStorage.getItem('downloading-models');
    return saved ? new Set<string>(JSON.parse(saved) as string[]) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function getDisplayName(modelName: string): string {
  if (BASIC_MODEL_NAMES.includes(modelName)) {
    return WHISPER_MODEL_NAME_MAPPING[modelName] || modelName;
  }

  return `Whisper ${modelName}`;
}

async function saveWhisperModelSelection(modelName: string): Promise<void> {
  await invoke('api_save_transcript_config', {
    provider: 'localWhisper',
    model: modelName,
    apiKey: null,
  });
}

interface ModelManagerProps {
  selectedModel?: string;
  onModelSelect?: (modelName: string) => void;
  className?: string;
  autoSave?: boolean;
}

export function ModelManager({
  selectedModel,
  onModelSelect,
  className = '',
  autoSave = false
}: ModelManagerProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; modelId: string | null }>({
    open: false,
    modelId: null,
  });
  const prefersReducedMotion = useReducedMotion();

  // Refs for stable callbacks
  const onModelSelectRef = useRef(onModelSelect);
  const autoSaveRef = useRef(autoSave);

  // Progress throttle map to prevent rapid updates
  const progressThrottleRef = useRef<Map<string, { progress: number; timestamp: number }>>(new Map());

  // Update refs when props change
  useEffect(() => {
    onModelSelectRef.current = onModelSelect;
    autoSaveRef.current = autoSave;
  }, [onModelSelect, autoSave]);

  // Persist downloading state to localStorage
  const updateDownloadingModels = useCallback((updater: (prev: Set<string>) => Set<string>) => {
    setDownloadingModels(prev => {
      const newSet = updater(prev);
      localStorage.setItem('downloading-models', JSON.stringify(Array.from(newSet)));
      return newSet;
    });
  }, []);

  const saveModelSelection = useCallback(async (modelName: string) => {
    try {
      await saveWhisperModelSelection(modelName);
    } catch (error) {
      console.error('Failed to save model selection:', error);
    }
  }, []);

  const downloadModel = useCallback(async (modelName: string) => {
    if (downloadingModels.has(modelName)) return;

    const displayName = getDisplayName(modelName);

    try {
      updateDownloadingModels(prev => new Set([...prev, modelName]));

      setModels(prevModels =>
        prevModels.map(model =>
          model.name === modelName
            ? { ...model, status: { Downloading: 0 } as ModelStatus }
            : model
        )
      );

      toast.info(`Downloading ${displayName}...`, {
        description: 'This may take a few minutes',
        duration: 5000
      });

      await WhisperAPI.downloadModel(modelName);
    } catch (err) {
      console.error('Download failed:', err);
      updateDownloadingModels(prev => {
        const newSet = new Set(prev);
        newSet.delete(modelName);
        return newSet;
      });

      const errorMessage = err instanceof Error ? err.message : 'Download failed';
      setModels(prev =>
        prev.map(model =>
          model.name === modelName ? { ...model, status: { Error: errorMessage } } : model
        )
      );
    }
  }, [downloadingModels, updateDownloadingModels]);

  // Initialize models
  useEffect(() => {
    if (initialized) return;

    const initializeModels = async () => {
      try {
        setLoading(true);
        await WhisperAPI.init();
        const modelList = await WhisperAPI.getAvailableModels();

        // Apply persisted downloading states
        const persistedDownloading = getPersistedDownloadingModelNames();
        const modelsWithDownloadState = modelList.map(model => {
          if (persistedDownloading.has(model.name) && model.status !== 'Available') {
            if (typeof model.status === 'object' && 'Corrupted' in model.status) {
              updateDownloadingModels(prev => {
                const newSet = new Set(prev);
                newSet.delete(model.name);
                return newSet;
              });
              return model;
            } else if (model.status === 'Missing') {
              updateDownloadingModels(prev => {
                const newSet = new Set(prev);
                newSet.delete(model.name);
                return newSet;
              });
              return model;
            } else {
              return { ...model, status: { Downloading: 0 } as ModelStatus };
            }
          }
          return model;
        });

        setModels(modelsWithDownloadState);
        setInitialized(true);
      } catch (err) {
        console.error('Failed to initialize Whisper:', err);
        setError(err instanceof Error ? err.message : 'Failed to load models');
        toast.error('Failed to load transcription models', {
          description: err instanceof Error ? err.message : 'Unknown error',
          duration: 5000
        });
      } finally {
        setLoading(false);
      }
    };

    initializeModels();
  }, [initialized, updateDownloadingModels]);

  // Set up event listeners for download progress
  useEffect(() => {
    let unlistenProgress: (() => void) | null = null;
    let unlistenComplete: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;

    const setupListeners = async () => {
      console.log('[ModelManager] Setting up event listeners...');

      // Download progress with throttling
      unlistenProgress = await listen<{ modelName: string; progress: number }>(
        'model-download-progress',
        (event) => {
          const { modelName, progress } = event.payload;
          const now = Date.now();
          const throttleData = progressThrottleRef.current.get(modelName);

          // Throttle: only update if 300ms passed OR progress jumped by 5%+
          const shouldUpdate = !throttleData ||
            now - throttleData.timestamp > 300 ||
            Math.abs(progress - throttleData.progress) >= 5;

          if (shouldUpdate) {
            console.log(`[ModelManager] Progress update for ${modelName}: ${progress}%`);
            progressThrottleRef.current.set(modelName, { progress, timestamp: now });

            setModels(prevModels =>
              prevModels.map(model =>
                model.name === modelName
                  ? { ...model, status: { Downloading: progress } as ModelStatus }
                  : model
              )
            );
          }
        }
      );

      // Download complete
      unlistenComplete = await listen<{ modelName: string }>(
        'model-download-complete',
        (event) => {
          const { modelName } = event.payload;
          const displayName = getDisplayName(modelName);

          setModels(prevModels =>
            prevModels.map(model =>
              model.name === modelName
                ? { ...model, status: 'Available' as ModelStatus }
                : model
            )
          );

          setDownloadingModels(prev => {
            const newSet = new Set(prev);
            newSet.delete(modelName);
            return newSet;
          });

          // Clean up throttle data
          progressThrottleRef.current.delete(modelName);

          toast.success(`${displayName} ready!`, {
            description: 'Model downloaded and ready to use',
            duration: 4000
          });

          // Auto-select after download using stable refs
          if (onModelSelectRef.current) {
            onModelSelectRef.current(modelName);
            if (autoSaveRef.current) {
              saveModelSelection(modelName);
            }
          }
        }
      );

      // Download error
      unlistenError = await listen<{ modelName: string; error: string }>(
        'model-download-error',
        (event) => {
          const { modelName, error } = event.payload;
          const displayName = getDisplayName(modelName);

          setModels(prevModels =>
            prevModels.map(model =>
              model.name === modelName
                ? { ...model, status: { Error: error } as ModelStatus }
                : model
            )
          );

          setDownloadingModels(prev => {
            const newSet = new Set(prev);
            newSet.delete(modelName);
            return newSet;
          });

          // Clean up throttle data
          progressThrottleRef.current.delete(modelName);

          toast.error(`Failed to download ${displayName}`, {
            description: error,
            duration: 6000,
            action: {
              label: 'Retry',
              onClick: () => downloadModel(modelName)
            }
          });
        }
      );
    };

    setupListeners();

    return () => {
      console.log('[ModelManager] Cleaning up event listeners...');
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
      if (unlistenError) unlistenError();
    };
  }, [downloadModel, saveModelSelection]); // listeners use refs for stable callbacks

  const cancelDownload = async (modelName: string) => {
    const displayName = getDisplayName(modelName);

    try {
      await WhisperAPI.cancelDownload(modelName);

      updateDownloadingModels(prev => {
        const newSet = new Set(prev);
        newSet.delete(modelName);
        return newSet;
      });

      setModels(prevModels =>
        prevModels.map(model =>
          model.name === modelName
            ? { ...model, status: 'Missing' as ModelStatus }
            : model
        )
      );

      // Clean up throttle data
      progressThrottleRef.current.delete(modelName);

      toast.info(`${displayName} download cancelled`, {
        duration: 3000
      });
    } catch (err) {
      console.error('Failed to cancel download:', err);
      toast.error('Failed to cancel download', {
        description: err instanceof Error ? err.message : 'Unknown error',
        duration: 4000
      });
    }
  };

  const selectModel = async (modelName: string) => {
    if (onModelSelect) {
      onModelSelect(modelName);
    }

    if (autoSave) {
      await saveModelSelection(modelName);
    }

    const displayName = getDisplayName(modelName);
    toast.success(`Switched to ${displayName}`, {
      duration: 3000
    });
  };

  const deleteModel = async (modelName: string) => {
    const displayName = getDisplayName(modelName);

    try {
      await WhisperAPI.deleteCorruptedModel(modelName);

      // Refresh models list
      const modelList = await WhisperAPI.getAvailableModels();
      setModels(modelList);

      toast.success(`${displayName} deleted`, {
        description: 'Model removed to free up space',
        duration: 3000
      });

      // If deleted model was selected, clear selection
      if (selectedModel === modelName && onModelSelect) {
        onModelSelect('');
      }
    } catch (err) {
      console.error('Failed to delete model:', err);
      toast.error(`Failed to delete ${displayName}`, {
        description: err instanceof Error ? err.message : 'Delete failed',
        duration: 4000
      });
    }
  };

  if (loading) {
    return (
      <div className={`space-y-3 ${className}`}>
        <div className="animate-pulse space-y-3">
          <div className="h-16 rounded-xl bg-muted"></div>
          <div className="h-16 rounded-xl bg-muted"></div>
          <div className="h-16 rounded-xl bg-muted"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-xl border border-destructive/30 bg-destructive/10 p-4 ${className}`}>
        <p className="text-sm text-destructive">Failed to load models</p>
        <p className="mt-1 text-xs text-destructive/80">{error}</p>
      </div>
    );
  }

  const basicModels = models.filter(m => BASIC_MODEL_NAMES.includes(m.name))
    .sort((a, b) => BASIC_MODEL_NAMES.indexOf(a.name) - BASIC_MODEL_NAMES.indexOf(b.name));
  const selectedModelIsReady = models.some((m) => m.name === selectedModel && m.status === 'Available');
  const advancedModels = models.filter(m => !BASIC_MODEL_NAMES.includes(m.name));

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Basic Models */}
        <div className="space-y-3">
          {basicModels.map((model) => {
          const isRecommended = model.name === 'medium-q5_0';
          return (
            <ModelCard
              key={model.name}
              model={model}
              isSelected={selectedModel === model.name}
              isRecommended={isRecommended}
              onSelect={() => {
                if (model.status === 'Available') {
                  selectModel(model.name);
                }
              }}
               onDownload={() => downloadModel(model.name)}
               onCancel={() => cancelDownload(model.name)}
               onDelete={() => setDeleteConfirm({ open: true, modelId: model.name })}
               displayName={getDisplayName(model.name)}
             />
          );
        })}
      </div>

      {/* Advanced Models */}
      {advancedModels.length > 0 && (
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="advanced-models">
            <AccordionTrigger>
              <span className="text-sm font-medium text-foreground">Advanced Models</span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 pt-4">
                {advancedModels.map((model) => (
                  <ModelCard
                    key={model.name}
                    model={model}
                    isSelected={selectedModel === model.name}
                    isRecommended={false}
                    onSelect={() => {
                      if (model.status === 'Available') {
                        selectModel(model.name);
                      }
                    }}
                    onDownload={() => downloadModel(model.name)}
                    onCancel={() => cancelDownload(model.name)}
                    onDelete={() => setDeleteConfirm({ open: true, modelId: model.name })}
                    displayName={getDisplayName(model.name)}
                  />
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {/* Helper text */}
      {selectedModelIsReady && (
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: -5 }}
          animate={prefersReducedMotion ? false : { opacity: 1, y: 0 }}
          transition={prefersReducedMotion ? { duration: 0 } : undefined}
          className="pt-2 text-center text-xs text-muted-foreground"
        >
          Using {getDisplayName(selectedModel ?? '')} for transcription
        </motion.div>
      )}

      <ConfirmDeleteDialog
        open={deleteConfirm.open}
        onOpenChange={(open) =>
          setDeleteConfirm({
            open,
            modelId: open ? deleteConfirm.modelId : null,
          })
        }
        title="Delete model"
        description="This model will need to be re-downloaded if you need it again."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleteConfirm.modelId) {
            return;
          }

          await deleteModel(deleteConfirm.modelId);
          setDeleteConfirm({ open: false, modelId: null });
        }}
      />
    </div>
  );
}

// Model Card Component
interface ModelCardProps {
  model: ModelInfo;
  isSelected: boolean;
  isRecommended: boolean;
  onSelect: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
  displayName: string;
}

function ModelCard({
  model,
  isSelected,
  isRecommended,
  onSelect,
  onDownload,
  onCancel,
  onDelete,
  displayName
}: ModelCardProps) {
  const prefersReducedMotion = useReducedMotion();
  const isAvailable = model.status === 'Available';
  const isMissing = model.status === 'Missing';
  const isError = typeof model.status === 'object' && 'Error' in model.status;
  const isCorrupted = typeof model.status === 'object' && 'Corrupted' in model.status;
  const downloadProgress =
    typeof model.status === 'object' && 'Downloading' in model.status
      ? model.status.Downloading
      : null;
  const performanceBadge = getModelPerformanceBadge(model.name);
  const statusMessage =
    isError && typeof model.status === 'object' && 'Error' in model.status
      ? model.status.Error
      : isCorrupted
        ? 'File is corrupted. Delete it or download again.'
        : null;

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 5 }}
      animate={prefersReducedMotion ? false : { opacity: 1, y: 0 }}
      transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.2 }}
      className={cn(
        'relative rounded-xl border border-border/30 bg-card p-3 transition-colors duration-200',
        isAvailable && 'cursor-pointer hover:border-foreground/20 hover:bg-muted/30',
        !isAvailable && 'bg-muted/30',
        isSelected && isAvailable && 'border-ring bg-muted/60 ring-1 ring-ring/30'
      )}
      onClick={() => {
        if (isAvailable) onSelect();
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold text-foreground">{displayName}</h3>
            {isRecommended && (
              <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-purple dark:text-brand-lavender">Recommended</span>
            )}
            {isSelected && isAvailable && (
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground">
                <Check className="h-3 w-3" />
                Selected
              </span>
            )}
            {(isQuantizedModel(model.name) || performanceBadge.label === 'Full Precision') && (
              <span className="rounded-md border border-border/30 bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {performanceBadge.label}
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {getModelTagline(model.name, model.speed, model.accuracy)}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>{model.accuracy} accuracy</span>
            <span>{model.speed} processing</span>
            {statusMessage && <span className="text-destructive">{statusMessage}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <span className="rounded-md border border-border/30 bg-muted px-2 py-1 text-xs font-medium text-foreground">
            {formatFileSize(model.size_mb)}
          </span>

          {isAvailable && !isSelected && (
            <Button
              variant="blue"
              size="sm"
              className={DOWNLOAD_BUTTON_CLASSNAME}
              onClick={(e) => {
                e.stopPropagation();
                onSelect();
              }}
            >
              Use model
            </Button>
          )}

          {isAvailable && isSelected && (
            <span className="text-xs font-medium text-muted-foreground">Ready</span>
          )}

          {isMissing && (
            <Button
              variant="blue"
              size="sm"
              className={DOWNLOAD_BUTTON_CLASSNAME}
              onClick={(e) => {
                e.stopPropagation();
                onDownload();
              }}
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
          )}

          {downloadProgress !== null && (
            <Button
              variant="gray"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
            >
              Cancel
            </Button>
          )}

          {downloadProgress === null && isError && (
            <Button
              variant="blue"
              size="sm"
              className={DOWNLOAD_BUTTON_CLASSNAME}
              onClick={(e) => {
                e.stopPropagation();
                onDownload();
              }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
            </Button>
          )}

          {isCorrupted && (
            <>
              <Button
                variant="destructive"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                Delete
              </Button>
              <Button
                variant="blue"
                size="sm"
                className={DOWNLOAD_BUTTON_CLASSNAME}
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload();
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Re-download
              </Button>
            </>
          )}

          {isAvailable && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title={`Delete ${displayName}`}
              aria-label={`Delete ${displayName}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {downloadProgress !== null && (
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
            animate={prefersReducedMotion ? false : { opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={prefersReducedMotion ? { duration: 0 } : undefined}
            className="mt-3 border-t border-border/30 pt-3"
          >
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">Downloading</span>
              <span className="font-medium text-muted-foreground">{Math.round(downloadProgress)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-lg bg-muted">
              <motion.div
                className={cn('h-full rounded-lg', DOWNLOAD_PROGRESS_CLASSNAME)}
                initial={prefersReducedMotion ? false : { width: 0 }}
                animate={prefersReducedMotion ? false : { width: `${downloadProgress}%` }}
                transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.3, ease: 'easeOut' }}
                style={prefersReducedMotion ? { width: `${downloadProgress}%` } : undefined}
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {model.size_mb ? `${formatFileSize((model.size_mb * downloadProgress) / 100)} / ${formatFileSize(model.size_mb)}` : 'Downloading'}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
