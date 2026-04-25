import React, { useState, useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Check, Download, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  ParakeetModelInfo,
  ModelStatus,
  ParakeetAPI,
  getModelDisplayInfo,
  getModelDisplayName,
  formatFileSize
} from '../lib/parakeet';
import { Button } from '@/components/ui/button';
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog';
import { cn } from '@/lib/utils';

const DOWNLOAD_BUTTON_CLASSNAME =
  'h-11 rounded-lg bg-brand-purple px-6 text-white shadow-md transition-all hover:bg-brand-purple/90 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-brand-purple/40 disabled:cursor-not-allowed disabled:opacity-60';
const DOWNLOAD_PROGRESS_CLASSNAME = 'bg-brand-purple';

interface ParakeetModelManagerProps {
  selectedModel?: string;
  onModelSelect?: (modelName: string) => void;
  className?: string;
  autoSave?: boolean;
}

export function ParakeetModelManager({
  selectedModel,
  onModelSelect,
  className = '',
  autoSave = false
}: ParakeetModelManagerProps) {
  const [models, setModels] = useState<ParakeetModelInfo[]>([]);
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

  const saveModelSelection = useCallback(async (modelName: string) => {
    try {
      await invoke('api_save_transcript_config', {
        provider: 'parakeet',
        model: modelName,
        apiKey: null
      });
    } catch (error) {
      console.error('Failed to save model selection:', error);
    }
  }, []);

  const downloadModel = useCallback(async (modelName: string) => {
    if (downloadingModels.has(modelName)) return;

    const displayInfo = getModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;

    try {
      setDownloadingModels(prev => new Set([...prev, modelName]));

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

      await ParakeetAPI.downloadModel(modelName);
    } catch (err) {
      console.error('Download failed:', err);
      setDownloadingModels(prev => {
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
  }, [downloadingModels]);

  // Initialize and load models
  useEffect(() => {
    if (initialized) return;

    const initializeModels = async () => {
      try {
        setLoading(true);
        await ParakeetAPI.init();
        const modelList = await ParakeetAPI.getAvailableModels();
        setModels(modelList);

        setInitialized(true);
      } catch (err) {
        console.error('Failed to initialize Parakeet:', err);
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
  }, [initialized]);

  // Set up event listeners for download progress
  useEffect(() => {
    let unlistenProgress: (() => void) | null = null;
    let unlistenComplete: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;

    const setupListeners = async () => {
      console.log('[ParakeetModelManager] Setting up event listeners...');

      // Download progress with throttling
      unlistenProgress = await listen<{ modelName: string; progress: number }>(
        'parakeet-model-download-progress',
        (event) => {
          const { modelName, progress } = event.payload;
          const now = Date.now();
          const throttleData = progressThrottleRef.current.get(modelName);

          // Throttle: only update if 300ms passed OR progress jumped by 5%+
          const shouldUpdate = !throttleData ||
            now - throttleData.timestamp > 300 ||
            Math.abs(progress - throttleData.progress) >= 5;

          if (shouldUpdate) {
            console.log(`[ParakeetModelManager] Progress update for ${modelName}: ${progress}%`);
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
        'parakeet-model-download-complete',
        (event) => {
          const { modelName } = event.payload;
          const displayInfo = getModelDisplayInfo(modelName);
          const displayName = displayInfo?.friendlyName || modelName;

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
        'parakeet-model-download-error',
        (event) => {
          const { modelName, error } = event.payload;
          const displayInfo = getModelDisplayInfo(modelName);
          const displayName = displayInfo?.friendlyName || modelName;

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
      console.log('[ParakeetModelManager] Cleaning up event listeners...');
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
      if (unlistenError) unlistenError();
    };
  }, [downloadModel, saveModelSelection]); // Empty dependency array - listeners use refs for stable callbacks

  const cancelDownload = async (modelName: string) => {
    const displayInfo = getModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;

    try {
      await ParakeetAPI.cancelDownload(modelName);

      setDownloadingModels(prev => {
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

    const displayInfo = getModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;
    toast.success(`Switched to ${displayName}`, {
      duration: 3000
    });
  };

  const deleteModel = async (modelName: string) => {
    const displayInfo = getModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;

    try {
      await ParakeetAPI.deleteCorruptedModel(modelName);

      // Refresh models list
      const modelList = await ParakeetAPI.getAvailableModels();
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

  const recommendedModel = models.find(m =>
    m.name === 'parakeet-tdt-0.6b-v3-int8'
  );
  const otherModels = models.filter(m =>
    m.name !== 'parakeet-tdt-0.6b-v3-int8'
  );

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Recommended Model */}
      {recommendedModel && (
        <ModelCard
          model={recommendedModel}
          isSelected={selectedModel === recommendedModel.name}
          isRecommended={true}
          onSelect={() => {
            if (recommendedModel.status === 'Available') {
              selectModel(recommendedModel.name);
            }
          }}
           onDownload={() => downloadModel(recommendedModel.name)}
            onCancel={() => cancelDownload(recommendedModel.name)}
            onDelete={() => setDeleteConfirm({ open: true, modelId: recommendedModel.name })}
          />
        )}

      {/* Other Models */}
      {otherModels.length > 0 && (
        <div className="space-y-3">
          {otherModels.map(model => (
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
              />
            ))}
        </div>
      )}

      {/* Helper text */}
      {selectedModel && (
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: -5 }}
          animate={prefersReducedMotion ? false : { opacity: 1, y: 0 }}
          transition={prefersReducedMotion ? { duration: 0 } : undefined}
          className="pt-2 text-center text-xs text-muted-foreground"
        >
          Using {getModelDisplayName(selectedModel)} for transcription
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
  model: ParakeetModelInfo;
  isSelected: boolean;
  isRecommended: boolean;
  onSelect: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

function ModelCard({
  model,
  isSelected,
  isRecommended,
  onSelect,
  onDownload,
  onCancel,
  onDelete
}: ModelCardProps) {
  const displayInfo = getModelDisplayInfo(model.name);
  const prefersReducedMotion = useReducedMotion();
  const displayName = displayInfo?.friendlyName || model.name;
  const tagline = displayInfo?.tagline || model.description || '';
  const sizeLabel = formatFileSize(model.size_mb);

  const isAvailable = model.status === 'Available';
  const isMissing = model.status === 'Missing';
  const isError = typeof model.status === 'object' && 'Error' in model.status;
  const isCorrupted = typeof model.status === 'object' && 'Corrupted' in model.status;
  const downloadProgress =
    typeof model.status === 'object' && 'Downloading' in model.status
      ? model.status.Downloading
      : null;
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
              <span className="text-[11px] font-medium uppercase tracking-wide text-accent">Recommended</span>
            )}
            {isSelected && isAvailable && (
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground">
                <Check className="h-3 w-3" />
                Selected
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{tagline}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>{model.quantization}</span>
            <span>{model.speed}</span>
            {statusMessage && <span className="text-destructive">{statusMessage}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <span className="rounded-md border border-border/30 bg-muted px-2 py-1 text-xs font-medium text-foreground">
            {sizeLabel}
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
