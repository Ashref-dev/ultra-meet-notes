"use client";

import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { GradientPillButton } from '@/components/ui/gradient-pill-button';
import { cn } from '@/lib/utils';
import { Copy, FolderOpen, Loader2, RefreshCcw, Users } from 'lucide-react';
import { RetranscribeDialog } from './RetranscribeDialog';

const ghostPillButtonClassName = cn(
  'h-10 rounded-lg bg-transparent px-4 text-sm text-foreground shadow-none',
  'transition-[background-color,color,transform] duration-200 hover:bg-muted/80 hover:text-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  'disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-safe:active:scale-[0.98]'
);

interface TranscriptButtonGroupProps {
  transcriptCount: number;
  onCopyTranscript: () => void;
  onCopyTranscriptMarkdown: () => Promise<void>;
  onOpenMeetingFolder: () => Promise<void>;
  meetingFolderPath?: string | null;
}

interface DiarizationSegment {
  start: number;
  end: number;
  speaker: number;
}

interface DiarizationResultPayload {
  segments: DiarizationSegment[];
  speaker_count: number;
  duration_seconds: number;
}

export function TranscriptButtonGroup({
  transcriptCount,
  onCopyTranscript,
  onCopyTranscriptMarkdown,
  onOpenMeetingFolder,
  meetingFolderPath,
}: TranscriptButtonGroupProps) {
  const [isOpeningMeetingFolder, setIsOpeningMeetingFolder] = useState(false);
  const [isAnalyzingSpeakers, setIsAnalyzingSpeakers] = useState(false);
  void onCopyTranscriptMarkdown;

  const handleOpenMeetingFolder = useCallback(async () => {
    setIsOpeningMeetingFolder(true);
    try {
      await onOpenMeetingFolder();
    } finally {
      setIsOpeningMeetingFolder(false);
    }
  }, [onOpenMeetingFolder]);

  const handleAnalyzeSpeakers = useCallback(async () => {
    if (!meetingFolderPath) {
      toast.error('No recording available', {
        description: 'Speaker analysis requires a saved audio recording.',
      });
      return;
    }

    setIsAnalyzingSpeakers(true);
    try {
      const ready = await invoke<boolean>('diarization_models_ready');
      if (!ready) {
        toast.error('Diarization models not downloaded', {
          description: 'Open Settings → Speaker Diarization and download the models first.',
        });
        return;
      }

      toast.info('Analyzing speakers...', {
        description: 'This runs fully locally and may take a few minutes for long recordings.',
      });

      const result = await invoke<DiarizationResultPayload>('diarize_meeting', {
        audioPath: meetingFolderPath,
        numSpeakers: null,
      });

      const speakerLabel = result.speaker_count === 1 ? 'speaker' : 'speakers';
      toast.success(`Detected ${result.speaker_count} ${speakerLabel}`, {
        description: `${result.segments.length} speech segments across ${Math.round(result.duration_seconds)}s of audio.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error('Speaker analysis failed', { description: message });
    } finally {
      setIsAnalyzingSpeakers(false);
    }
  }, [meetingFolderPath]);

  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-3">
      <div className="inline-flex items-center gap-1 rounded-xl bg-card/60 p-1 shadow-sm backdrop-blur-sm">
        {meetingFolderPath ? (
          <Button
            variant="secondary"
            className={ghostPillButtonClassName}
            onClick={() => {
              void handleAnalyzeSpeakers();
            }}
            disabled={isAnalyzingSpeakers || transcriptCount === 0}
            title="Analyze speakers (Pyannote)"
          >
            {isAnalyzingSpeakers ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Users className="h-4 w-4" />
            )}
            <span className="hidden lg:inline">{isAnalyzingSpeakers ? 'Analyzing…' : 'Analyze Speakers'}</span>
          </Button>
        ) : null}

        <Button
          variant="secondary"
          className={ghostPillButtonClassName}
          onClick={() => {
            onCopyTranscript();
          }}
          disabled={transcriptCount === 0}
          title={transcriptCount === 0 ? 'No transcript available' : 'Copy Transcript'}
        >
          <Copy className="h-4 w-4" />
          <span className="hidden lg:inline">Copy</span>
        </Button>

        <Button
          type="button"
          variant="secondary"
          className={ghostPillButtonClassName}
          onClick={() => {
            void handleOpenMeetingFolder();
          }}
          disabled={isOpeningMeetingFolder}
          title="Open Recording Folder"
        >
          {isOpeningMeetingFolder ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FolderOpen className="h-4 w-4" />
          )}
          <span className="hidden lg:inline">{isOpeningMeetingFolder ? 'Opening…' : 'Recording'}</span>
        </Button>
      </div>
    </div>
  );
}

interface TranscriptRetranscribeButtonProps {
  meetingId: string;
  meetingFolderPath: string;
  onRefetchTranscripts?: () => Promise<void>;
}

export function TranscriptRetranscribeButton({
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
}: TranscriptRetranscribeButtonProps) {
  const [showRetranscribeDialog, setShowRetranscribeDialog] = useState(false);

  const handleRetranscribeComplete = useCallback(async () => {
    if (onRefetchTranscripts) {
      await onRefetchTranscripts();
    }
  }, [onRefetchTranscripts]);

  return (
    <>
      <GradientPillButton
        variant="square"
        onClick={() => {
          setShowRetranscribeDialog(true);
        }}
        title="Retranscribe"
        aria-label="Retranscribe this recording"
      >
        <RefreshCcw className="h-4 w-4" />
        <span className="sr-only">Retranscribe</span>
      </GradientPillButton>

      <RetranscribeDialog
        open={showRetranscribeDialog}
        onOpenChange={setShowRetranscribeDialog}
        meetingId={meetingId}
        meetingFolderPath={meetingFolderPath}
        onComplete={handleRetranscribeComplete}
      />
    </>
  );
}
