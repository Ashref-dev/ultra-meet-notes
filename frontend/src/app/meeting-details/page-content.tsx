"use client";
import { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { motion, useReducedMotion } from 'framer-motion';
import { Summary, SummaryResponse, Transcript, TranscriptSegmentData } from '@/types';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { TranscriptPanel } from '@/components/MeetingDetails/TranscriptPanel';
import { SummaryPanel } from '@/components/MeetingDetails/SummaryPanel';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { TopBar } from '@/components/TopBar';
import {
  copyToClipboard,
  summaryToMarkdown,
  transcriptToMarkdown,
} from '@/lib/markdownExport';

// Custom hooks
import { useMeetingData } from '@/hooks/meeting-details/useMeetingData';
import { useSummaryGeneration } from '@/hooks/meeting-details/useSummaryGeneration';
import { useTemplates } from '@/hooks/meeting-details/useTemplates';
import { useCopyOperations } from '@/hooks/meeting-details/useCopyOperations';
import { useMeetingOperations } from '@/hooks/meeting-details/useMeetingOperations';
import { useConfig } from '@/contexts/ConfigContext';
import { useTabHotkeys } from '@/hooks/useTabHotkeys';

interface PageContentMeeting {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  transcripts: Transcript[];
  folder_path?: string;
}

export default function PageContent({
  meeting,
  summaryData,
  shouldAutoGenerate = false,
  onAutoGenerateComplete,
  onMeetingUpdated,
  onRefetchTranscripts,
  // Pagination props for efficient transcript loading
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
}: {
  meeting: PageContentMeeting;
  summaryData: Summary | null;
  shouldAutoGenerate?: boolean;
  onAutoGenerateComplete?: () => void;
  onMeetingUpdated?: () => Promise<void>;
  onRefetchTranscripts?: () => Promise<void>;
  // Pagination props
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();

  console.log('📄 PAGE CONTENT: Initializing with data:', {
    meetingId: meeting.id,
    summaryDataKeys: summaryData ? Object.keys(summaryData) : null,
    transcriptsCount: meeting.transcripts?.length
  });

  // State
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [isRecording] = useState(false);
  const [summaryResponse] = useState<SummaryResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'notes' | 'transcript'>(summaryData ? 'notes' : 'transcript');
  const [isDiarizingForMeeting, setIsDiarizingForMeeting] = useState(false);

  useTabHotkeys(setActiveTab);

  // Ref to store the modal open function from SummaryGeneratorButtonGroup
  const openModelSettingsRef = useRef<(() => void) | null>(null);

  // Get model config from ConfigContext
  const { modelConfig, setModelConfig } = useConfig();

  // Custom hooks
  const meetingData = useMeetingData({ meeting, summaryData, onMeetingUpdated });
  const templates = useTemplates();

  // Callback to register the modal open function
  const handleRegisterModalOpen = (openFn: () => void) => {
    console.log('📝 Registering modal open function in PageContent');
    openModelSettingsRef.current = openFn;
  };

  // Callback to trigger modal open (called from error handler)
  const handleOpenModelSettings = () => {
    console.log('🔔 Opening model settings from PageContent');
    if (openModelSettingsRef.current) {
      openModelSettingsRef.current();
    } else {
      console.warn('⚠️ Modal open function not yet registered');
    }
  };

  // Save model config to backend database and sync via event
  const handleSaveModelConfig = async (config?: ModelConfig) => {
    if (!config) return;
    try {
      await invoke('api_save_model_config', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey ?? null,
        ollamaEndpoint: config.ollamaEndpoint ?? null,
      });

      // Emit event so ConfigContext and other listeners stay in sync
      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', config);

      toast.success('Model settings saved successfully');
    } catch (error) {
      console.error('Failed to save model config:', error);
      toast.error('Failed to save model settings');
    }
  };

  const summaryGeneration = useSummaryGeneration({
    meeting,
    transcripts: meetingData.transcripts,
    modelConfig: modelConfig,
    isModelConfigLoading: false, // ConfigContext loads on mount
    selectedTemplate: templates.selectedTemplate,
    onMeetingUpdated,
    updateMeetingTitle: meetingData.updateMeetingTitle,
    setAiSummary: meetingData.setAiSummary,
    onOpenModelSettings: handleOpenModelSettings,
  });
  const { handleGenerateSummary } = summaryGeneration;

  const copyOperations = useCopyOperations({
    meeting,
    transcripts: meetingData.transcripts,
    meetingTitle: meetingData.meetingTitle,
    aiSummary: meetingData.aiSummary,
    blockNoteSummaryRef: meetingData.blockNoteSummaryRef,
  });

  const meetingOperations = useMeetingOperations({
    meeting,
  });
  const transcriptCount = meetingData.transcripts.length;
  const summaryModelLabel = `${modelConfig.provider}/${modelConfig.model}`;

  const handleCopyTranscriptMarkdown = async () => {
    const md = transcriptToMarkdown(meetingData.transcripts, meetingData.meetingTitle);
    const success = await copyToClipboard(md);

    if (success) {
      toast.success('Transcript copied as Markdown');
    } else {
      toast.error('Failed to copy');
    }
  };

  const handleCopySummaryMarkdown = async () => {
    if (!meetingData.aiSummary) {
      toast.error('Failed to copy');
      return;
    }

    const md = summaryToMarkdown(meetingData.aiSummary, meetingData.meetingTitle);
    const success = await copyToClipboard(md);

    if (success) {
      toast.success('Summary copied as Markdown');
    } else {
      toast.error('Failed to copy');
    }
  };

  const autoGenerateStartedRef = useRef(false);

  useEffect(() => {
    let unlistenStarted: (() => void) | undefined;
    let unlistenApplied: (() => void) | undefined;
    let unlistenFailed: (() => void) | undefined;

    const setup = async () => {
      unlistenStarted = await listen<{ meeting_id: string }>('diarization-started', (event) => {
        if (event.payload.meeting_id === meeting.id) {
          setIsDiarizingForMeeting(true);
        }
      });

      unlistenApplied = await listen<{ meeting_id: string; speaker_count: number; transcripts_labeled: number; audio_deleted: boolean }>(
        'diarization-applied',
        async (event) => {
          if (event.payload.meeting_id === meeting.id) {
            setIsDiarizingForMeeting(false);
            if (onRefetchTranscripts) {
              await onRefetchTranscripts();
            }
          }
        }
      );

      unlistenFailed = await listen<{ meeting_id: string; error: string }>('diarization-failed', (event) => {
        if (event.payload.meeting_id === meeting.id) {
          setIsDiarizingForMeeting(false);
        }
      });
    };

    void setup();

    return () => {
      unlistenStarted?.();
      unlistenApplied?.();
      unlistenFailed?.();
    };
  }, [meeting.id, onRefetchTranscripts]);

  useEffect(() => {
    if (!shouldAutoGenerate) {
      autoGenerateStartedRef.current = false;
      return;
    }

    if (transcriptCount === 0) return;
    if (autoGenerateStartedRef.current) return;

    autoGenerateStartedRef.current = true;

    let cancelled = false;

    void (async () => {
      await handleGenerateSummary('');
      if (!cancelled && onAutoGenerateComplete) {
        onAutoGenerateComplete();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    handleGenerateSummary,
    onAutoGenerateComplete,
    shouldAutoGenerate,
    transcriptCount,
  ]);

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
      animate={prefersReducedMotion ? false : { opacity: 1, y: 0 }}
      transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.3, ease: 'easeOut' }}
      className="flex h-screen flex-col bg-background"
    >
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        meetingTitle={meetingData.meetingTitle}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden bg-background px-4 pb-4">
        {activeTab === 'transcript' ? (
          <ErrorBoundary fallbackMessage="Transcript panel encountered an error">
            <TranscriptPanel
              transcripts={meetingData.transcripts}
              onCopyTranscript={copyOperations.handleCopyTranscript}
              onCopyTranscriptMarkdown={handleCopyTranscriptMarkdown}
              onOpenMeetingFolder={meetingOperations.handleOpenMeetingFolder}
              isRecording={isRecording}
              disableAutoScroll={true}
              usePagination={true}
              segments={segments}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              totalCount={totalCount}
              loadedCount={loadedCount}
              onLoadMore={onLoadMore}
              meetingId={meeting.id}
              meetingFolderPath={meeting.folder_path}
              onRefetchTranscripts={onRefetchTranscripts}
              fullWidth={true}
              isDiarizingForMeeting={isDiarizingForMeeting}
            />
          </ErrorBoundary>
        ) : (
          <ErrorBoundary fallbackMessage="Summary panel encountered an error">
            <SummaryPanel
              meeting={meeting}
              meetingTitle={meetingData.meetingTitle}
              isTitleDirty={meetingData.isTitleDirty}
              summaryRef={meetingData.blockNoteSummaryRef}
              isSaving={meetingData.isSaving}
              onSaveAll={meetingData.saveAllChanges}
              onCopySummary={copyOperations.handleCopySummary}
              onCopySummaryMarkdown={handleCopySummaryMarkdown}
              aiSummary={meetingData.aiSummary}
              summaryStatus={summaryGeneration.summaryStatus}
              transcripts={meetingData.transcripts}
              modelConfig={modelConfig}
              setModelConfig={setModelConfig}
              onSaveModelConfig={handleSaveModelConfig}
              onGenerateSummary={summaryGeneration.handleGenerateSummary}
              onStopGeneration={summaryGeneration.handleStopGeneration}
              customPrompt={customPrompt}
              onPromptChange={setCustomPrompt}
              summaryResponse={summaryResponse}
              onSaveSummary={meetingData.handleSaveSummary}
              onSummaryChange={meetingData.handleSummaryChange}
              onDirtyChange={meetingData.setIsSummaryDirty}
              summaryError={summaryGeneration.summaryError}
              onRegenerateSummary={summaryGeneration.handleRegenerateSummary}
              getSummaryStatusMessage={summaryGeneration.getSummaryStatusMessage}
              availableTemplates={templates.availableTemplates}
              selectedTemplate={templates.selectedTemplate}
              onTemplateSelect={templates.handleTemplateSelection}
              onFetchTemplateDetails={templates.fetchTemplateDetails}
              onSaveTemplate={templates.saveTemplate}
              onDeleteTemplate={templates.deleteTemplate}
              isModelConfigLoading={false}
              onOpenModelSettings={handleRegisterModalOpen}
            />
          </ErrorBoundary>
        )}
      </div>
    </motion.div>
  );
}
