"use client";

import { Transcript, TranscriptSegmentData } from '@/types';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { TranscriptButtonGroup, TranscriptRetranscribeButton } from './TranscriptButtonGroup';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface TranscriptPanelProps {
  transcripts: Transcript[];
  onCopyTranscript: () => void;
  onCopyTranscriptMarkdown: () => Promise<void>;
  onOpenMeetingFolder: () => Promise<void>;
  isRecording: boolean;
  disableAutoScroll?: boolean;

  // Optional pagination props (when using virtualization)
  usePagination?: boolean;
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;

  // Retranscription props
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
  fullWidth?: boolean;
}

export function TranscriptPanel({
  transcripts,
  onCopyTranscript,
  onCopyTranscriptMarkdown,
  onOpenMeetingFolder,
  isRecording,
  disableAutoScroll = false,
  usePagination = false,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
  fullWidth = false,
}: TranscriptPanelProps) {
  // Convert transcripts to segments if pagination is not used but we want virtualization
  const convertedSegments = useMemo(() => {
    if (usePagination && segments) {
      return segments;
    }
    // Convert transcripts to segments for virtualization
    return transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
    }));
  }, [transcripts, usePagination, segments]);

  const showRetranscribeButton = Boolean(meetingId && meetingFolderPath && !isRecording);

  return (
    <div
      className={cn(
        'min-w-0 flex-col overflow-hidden bg-background relative shrink-0',
        fullWidth
          ? 'flex w-full'
          : 'hidden md:flex md:w-1/4 lg:w-1/3'
      )}
    >
      {/* Title area */}
      <div className="bg-background/80 px-4 pt-4 pb-2 backdrop-blur-sm">
        <TranscriptButtonGroup
          transcriptCount={usePagination ? (totalCount ?? convertedSegments.length) : (transcripts?.length || 0)}
          onCopyTranscript={onCopyTranscript}
          onCopyTranscriptMarkdown={onCopyTranscriptMarkdown}
          onOpenMeetingFolder={onOpenMeetingFolder}
        />
      </div>

      {/* Transcript content - use virtualized view for better performance */}
      <div className="relative flex-1 overflow-hidden pb-4 pt-4">
        <VirtualizedTranscriptView
          segments={convertedSegments}
          isRecording={isRecording}
          isPaused={false}
          isProcessing={false}
          isStopping={false}
          enableStreaming={false}
          showConfidence={true}
          disableAutoScroll={disableAutoScroll}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={totalCount}
          loadedCount={loadedCount}
          onLoadMore={onLoadMore}
          extraBottomPaddingClassName={showRetranscribeButton ? 'pb-20' : ''}
        />

        {showRetranscribeButton && meetingId && meetingFolderPath && (
          <div className="pointer-events-none absolute bottom-6 right-6 z-10">
            <div className="pointer-events-auto">
              <TranscriptRetranscribeButton
                meetingId={meetingId}
                meetingFolderPath={meetingFolderPath}
                onRefetchTranscripts={onRefetchTranscripts}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
