'use client';

import React, { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useRecordingStop } from '@/hooks/useRecordingStop';

/**
 * RecordingPostProcessingProvider
 *
 * This provider handles post-processing when recording stops from any source:
 * - Tray menu stop
 * - Global keyboard shortcut
 * - Overlay stop button
 * - Main UI stop button
 *
 * It listens for the 'recording-stop-complete' event from Rust backend
 * and triggers the full post-processing flow (save to database and navigate)
 * regardless of which page the user is currently on.
 */
export function RecordingPostProcessingProvider({ children }: { children: React.ReactNode }) {
  // No-op functions since the global RecordingStateContext already handles state updates
  // These are only needed for the hook's local component state management
  const setIsRecording = () => { };
  const setIsRecordingDisabled = () => { };

  const {
    handleRecordingStop,
  } = useRecordingStop(setIsRecording, setIsRecordingDisabled);

  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    const setupListener = async () => {
      try {
        // Listen for recording-stop-complete event from Rust
        unlistenFn = await listen<boolean>('recording-stop-complete', (event) => {
          console.log('[RecordingPostProcessing] Received recording-stop-complete event:', event.payload);

          // Call the post-processing handler
          // event.payload is the callApi boolean (true for normal stops)
          handleRecordingStop(event.payload);
        });

        console.log('[RecordingPostProcessing] Event listener set up successfully');
      } catch (error) {
        console.error('[RecordingPostProcessing] Failed to set up event listener:', error);
      }
    };

    setupListener();

    return () => {
      if (unlistenFn) {
        console.log('[RecordingPostProcessing] Cleaning up event listener');
        unlistenFn();
      }
    };
  }, [handleRecordingStop]);

  useEffect(() => {
    let unlistenApplied: (() => void) | undefined;
    let unlistenFailed: (() => void) | undefined;
    let unlistenStarted: (() => void) | undefined;

    const setup = async () => {
      unlistenStarted = await listen('diarization-started', () => {
        toast.info('Detecting speakers', {
          description: 'Speaker labels will be added to your transcript automatically.',
          duration: 4000,
        });
      });

      unlistenApplied = await listen<{
        meeting_id: string;
        speaker_count: number;
        transcripts_labeled: number;
        audio_deleted: boolean;
      }>('diarization-applied', (event) => {
        const { speaker_count, transcripts_labeled, audio_deleted } = event.payload;
        const speakerLabel = speaker_count === 1 ? 'speaker' : 'speakers';
        toast.success(`Detected ${speaker_count} ${speakerLabel}`, {
          description: `${transcripts_labeled} transcript segments labeled.${audio_deleted ? ' Audio deleted per your preference.' : ''}`,
          duration: 6000,
        });
      });

      unlistenFailed = await listen<{ meeting_id: string; error: string }>(
        'diarization-failed',
        (event) => {
          console.warn('[diarization] failed:', event.payload.error);
          toast.error('Speaker analysis failed', {
            description: event.payload.error,
            duration: 6000,
          });
        }
      );
    };

    setup();

    return () => {
      unlistenStarted?.();
      unlistenApplied?.();
      unlistenFailed?.();
    };
  }, []);

  return <>{children}</>;
}
