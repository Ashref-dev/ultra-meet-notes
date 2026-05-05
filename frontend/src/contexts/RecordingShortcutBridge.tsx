'use client';

import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

import { useTranscripts } from '@/contexts/TranscriptContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { recordingService } from '@/services/recordingService';
import { showRecordingNotification } from '@/lib/recordingNotification';
import { DEFAULT_TRANSCRIPT_PROVIDER } from '@/constants/modelDefaults';

/**
 * RecordingShortcutBridge
 *
 * Mirrors RecordingPostProcessingProvider for the START path.
 *
 * Mounted at the root of the layout providers so the start flow works from ANY
 * page (settings, meeting-details, home, …) — required for tray "Start" and the
 * customizable global recording hotkey to operate silently in the background
 * without revealing or focusing the main window (stealth mode).
 *
 * Listens for the `request-recording-start` Tauri event emitted by Rust and
 * runs the same start flow as `useRecordingStart.handleRecordingStart`, but
 * without relying on the home page being mounted.
 */
function generateMeetingTitle(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `Meeting ${day}_${month}_${year}_${hours}_${minutes}_${seconds}`;
}

async function getTranscriptProvider(): Promise<string> {
  try {
    const config = await invoke<{ provider: string; model: string }>('api_get_transcript_config');
    return config?.provider || DEFAULT_TRANSCRIPT_PROVIDER;
  } catch {
    return DEFAULT_TRANSCRIPT_PROVIDER;
  }
}

async function checkTranscriptionReady(): Promise<boolean> {
  const provider = await getTranscriptProvider();
  try {
    switch (provider) {
      case 'parakeet': {
        await invoke('parakeet_init');
        return await invoke<boolean>('parakeet_has_available_models');
      }
      case 'qwenAsr': {
        await invoke('qwen_asr_init');
        return await invoke<boolean>('qwen_asr_has_available_models');
      }
      case 'localWhisper': {
        return await invoke<boolean>('whisper_has_available_models');
      }
      default:
        return true;
    }
  } catch (error) {
    console.error(`[RecordingShortcutBridge] Failed to check ${provider} status:`, error);
    return false;
  }
}

export function RecordingShortcutBridge() {
  const { clearTranscripts, setMeetingTitle } = useTranscripts();
  const { setIsMeetingActive } = useSidebar();
  const { selectedDevices } = useConfig();
  const { isRecording, status, setStatus } = useRecordingState();

  const inFlightRef = useRef(false);
  const stateRef = useRef({ isRecording, status });
  stateRef.current = { isRecording, status };

  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    const handleStart = async () => {
      const current = stateRef.current;
      try {
        const onboardingStatus = await invoke<{ completed: boolean } | null>(
          'get_onboarding_status',
        );
        if (!onboardingStatus?.completed) {
          console.log('[RecordingShortcutBridge] Start ignored — onboarding not complete');
          return;
        }
      } catch (error) {
        console.warn('[RecordingShortcutBridge] Could not verify onboarding status:', error);
      }

      if (current.isRecording || inFlightRef.current) {
        console.log('[RecordingShortcutBridge] Start ignored — already recording or in-flight');
        return;
      }
      if (
        current.status === RecordingStatus.STARTING ||
        current.status === RecordingStatus.STOPPING ||
        current.status === RecordingStatus.PROCESSING_TRANSCRIPTS ||
        current.status === RecordingStatus.SAVING
      ) {
        console.log('[RecordingShortcutBridge] Start ignored — busy in status', current.status);
        return;
      }

      inFlightRef.current = true;
      try {
        const ready = await checkTranscriptionReady();
        if (!ready) {
          toast.error('Transcription model not ready', {
            description: 'Open Ultra to finish setting up the transcription model, then try again.',
          });
          setStatus(RecordingStatus.IDLE);
          return;
        }

        const meetingTitle = generateMeetingTitle();
        setMeetingTitle(meetingTitle);
        setStatus(RecordingStatus.STARTING, 'Initializing recording...');

        await recordingService.startRecordingWithDevices(
          selectedDevices?.micDevice || null,
          selectedDevices?.systemDevice || null,
          meetingTitle,
        );

        clearTranscripts();
        setIsMeetingActive(true);
        await showRecordingNotification();
      } catch (error) {
        console.error('[RecordingShortcutBridge] Failed to start recording:', error);
        setStatus(
          RecordingStatus.ERROR,
          error instanceof Error ? error.message : 'Failed to start recording',
        );
        toast.error('Recording failed to start', {
          description: 'Check your microphone permissions in System Settings',
        });
      } finally {
        inFlightRef.current = false;
      }
    };

    const setupListener = async () => {
      try {
        unlistenFn = await listen('request-recording-start', () => {
          console.log('[RecordingShortcutBridge] Received request-recording-start');
          void handleStart();
        });
      } catch (error) {
        console.error('[RecordingShortcutBridge] Failed to set up listener:', error);
      }
    };

    void setupListener();

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, [
    selectedDevices,
    clearTranscripts,
    setIsMeetingActive,
    setMeetingTitle,
    setStatus,
  ]);

  return null;
}
