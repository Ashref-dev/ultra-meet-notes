"use client";

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { GradientPillButton } from '@/components/ui/gradient-pill-button';
import { cn } from '@/lib/utils';
import { Copy, FolderOpen, Loader2, RefreshCcw } from 'lucide-react';
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
}

export function TranscriptButtonGroup({
  transcriptCount,
  onCopyTranscript,
  onCopyTranscriptMarkdown,
  onOpenMeetingFolder,
}: TranscriptButtonGroupProps) {
  const [isOpeningMeetingFolder, setIsOpeningMeetingFolder] = useState(false);
  void onCopyTranscriptMarkdown;

  const handleOpenMeetingFolder = useCallback(async () => {
    setIsOpeningMeetingFolder(true);
    try {
      await onOpenMeetingFolder();
    } finally {
      setIsOpeningMeetingFolder(false);
    }
  }, [onOpenMeetingFolder]);

  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-3">
      <div className="inline-flex items-center gap-1 rounded-xl bg-card/60 p-1 shadow-sm backdrop-blur-sm">
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
