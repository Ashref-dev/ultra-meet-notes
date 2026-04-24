import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { recordingService } from '@/services/recordingService';
import { showRecordingNotification } from '@/lib/recordingNotification';
import { toast } from 'sonner';
import { DEFAULT_TRANSCRIPT_PROVIDER } from '@/constants/modelDefaults';

interface UseRecordingStartReturn {
  handleRecordingStart: () => Promise<void>;
  isAutoStarting: boolean;
}

/**
 * Custom hook for managing recording start lifecycle.
 * Handles both manual start (button click) and auto-start (from sidebar navigation).
 *
 * Features:
 * - Meeting title generation (format: Meeting DD_MM_YY_HH_MM_SS)
 * - Transcript clearing on start
 * - Recording notification display
 * - Auto-start from sidebar via sessionStorage flag
 */
export function useRecordingStart(
  isRecording: boolean,
  setIsRecording: (value: boolean) => void,
  showModal?: (name: 'modelSelector', message?: string) => void
): UseRecordingStartReturn {
  const [isAutoStarting, setIsAutoStarting] = useState(false);

  const { clearTranscripts, setMeetingTitle } = useTranscripts();
  const { setIsMeetingActive } = useSidebar();
  const { selectedDevices } = useConfig();
  const { setStatus } = useRecordingState();

  // Generate meeting title with timestamp
  const generateMeetingTitle = useCallback(() => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `Meeting ${day}_${month}_${year}_${hours}_${minutes}_${seconds}`;
  }, []);

  // Get the user's configured transcription provider
  const getTranscriptProvider = useCallback(async (): Promise<string> => {
    try {
      const config = await invoke<{ provider: string; model: string }>('api_get_transcript_config');
      console.log('[RecordingStart] api_get_transcript_config returned:', JSON.stringify(config));
      return config?.provider || DEFAULT_TRANSCRIPT_PROVIDER;
    } catch (error) {
      console.error('[RecordingStart] Failed to get transcript config:', error);
      return DEFAULT_TRANSCRIPT_PROVIDER;
    }
  }, []);

  // Check if the configured transcription model is ready
  const checkTranscriptionReady = useCallback(async (): Promise<boolean> => {
    const provider = await getTranscriptProvider();
    console.log('[RecordingStart] checkTranscriptionReady - provider:', provider);
    try {
      switch (provider) {
        case 'parakeet': {
          console.log('[RecordingStart] Checking parakeet...');
          await invoke('parakeet_init');
          const result = await invoke<boolean>('parakeet_has_available_models');
          console.log('[RecordingStart] parakeet_has_available_models:', result);
          return result;
        }
        case 'qwenAsr': {
          console.log('[RecordingStart] Checking qwenAsr...');
          await invoke('qwen_asr_init');
          console.log('[RecordingStart] qwen_asr_init succeeded');
          const result = await invoke<boolean>('qwen_asr_has_available_models');
          console.log('[RecordingStart] qwen_asr_has_available_models:', result);
          return result;
        }
        case 'localWhisper': {
          console.log('[RecordingStart] Checking localWhisper...');
          return await invoke<boolean>('whisper_has_available_models');
        }
        default:
          console.log('[RecordingStart] Cloud provider, skipping model check');
          // Cloud providers don't need local model checks
          return true;
      }
    } catch (error) {
      console.error(`[RecordingStart] Failed to check ${provider} status:`, error);
      return false;
    }
  }, [getTranscriptProvider]);

  // Check if any model is currently downloading for the configured provider
  const checkIfModelDownloading = useCallback(async (): Promise<boolean> => {
    const provider = await getTranscriptProvider();
    try {
      let models: any[];
      switch (provider) {
        case 'parakeet':
          models = await invoke<any[]>('parakeet_get_available_models');
          break;
        case 'qwenAsr':
          models = await invoke<any[]>('qwen_asr_get_available_models');
          break;
        case 'localWhisper':
          models = await invoke<any[]>('whisper_get_available_models');
          break;
        default:
          return false;
      }
      const isDownloading = models.some(m =>
        m.status && (
          typeof m.status === 'object'
            ? 'Downloading' in m.status
            : m.status === 'Downloading'
        )
      );
      return isDownloading;
    } catch (error) {
      console.error('Failed to check model download status:', error);
      return false;
    }
  }, [getTranscriptProvider]);

  // Handle manual recording start (from button click)
  const handleRecordingStart = useCallback(async () => {
    try {
      console.log('handleRecordingStart called - checking transcription model status');

      // Check if transcription model is ready before starting
      const modelReady = await checkTranscriptionReady();
        if (!modelReady) {
          const isDownloading = await checkIfModelDownloading();
          if (isDownloading) {
            toast.info('Model download in progress', {
              description: 'Please wait for the transcription model to finish downloading before recording.',
              duration: 5000,
            });
        } else {
          toast.error('Transcription model is still loading', {
            description: 'Please wait a moment and try again',
            duration: 5000,
          });
          showModal?.('modelSelector', 'Transcription model setup required');
        }
        setStatus(RecordingStatus.IDLE);
        return;
      }

      console.log('Transcription model ready - setting up meeting title and state');

      const randomTitle = generateMeetingTitle();
      setMeetingTitle(randomTitle);

      // Set STARTING status before initiating backend recording
      setStatus(RecordingStatus.STARTING, 'Initializing recording...');

      // Start the actual backend recording
      console.log('Starting backend recording with meeting:', randomTitle);
      await recordingService.startRecordingWithDevices(
        selectedDevices?.micDevice || null,
        selectedDevices?.systemDevice || null,
        randomTitle
      );
      console.log('Backend recording started successfully');

      // Update state after successful backend start
      // Note: RECORDING status will be set by RecordingStateContext event listener
      console.log('Setting isRecordingState to true');
      setIsRecording(true); // This will also update the sidebar via the useEffect
      clearTranscripts(); // Clear previous transcripts when starting new recording
      setIsMeetingActive(true);

      // Show recording notification if enabled
      await showRecordingNotification();
    } catch (error) {
      console.error('Failed to start recording:', error);
      setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Failed to start recording');
      setIsRecording(false); // Reset state on error
      // Re-throw so RecordingControls can handle device-specific errors
      throw error;
    }
  }, [generateMeetingTitle, setMeetingTitle, setIsRecording, clearTranscripts, setIsMeetingActive, checkTranscriptionReady, checkIfModelDownloading, selectedDevices, showModal, setStatus]);

  // Check for autoStartRecording flag and start recording automatically
  useEffect(() => {
    const checkAutoStartRecording = async () => {
      if (typeof window !== 'undefined') {
        const shouldAutoStart = sessionStorage.getItem('autoStartRecording');
        if (shouldAutoStart === 'true' && !isRecording && !isAutoStarting) {
          console.log('Auto-starting recording from navigation...');
          setIsAutoStarting(true);
          sessionStorage.removeItem('autoStartRecording'); // Clear the flag

          // Check if transcription model is ready before starting
          const modelReady = await checkTranscriptionReady();
          if (!modelReady) {
            const isDownloading = await checkIfModelDownloading();
            if (isDownloading) {
              toast.info('Model download in progress', {
                description: 'Please wait for the transcription model to finish downloading before recording.',
                duration: 5000,
              });
            } else {
              toast.error('Transcription model is still loading', {
                description: 'Please wait a moment and try again',
                duration: 5000,
              });
              showModal?.('modelSelector', 'Transcription model setup required');
            }
            setStatus(RecordingStatus.IDLE);
            setIsAutoStarting(false);
            return;
          }

          // Start the actual backend recording
          try {
            // Generate meeting title
            const generatedMeetingTitle = generateMeetingTitle();

            // Set STARTING status before initiating backend recording
            setStatus(RecordingStatus.STARTING, 'Initializing recording...');

            console.log('Auto-starting backend recording with meeting:', generatedMeetingTitle);
            const result = await recordingService.startRecordingWithDevices(
              selectedDevices?.micDevice || null,
              selectedDevices?.systemDevice || null,
              generatedMeetingTitle
            );
            console.log('Auto-start backend recording result:', result);

            // Update UI state after successful backend start
            // Note: RECORDING status will be set by RecordingStateContext event listener
            setMeetingTitle(generatedMeetingTitle);
            setIsRecording(true);
            clearTranscripts();
            setIsMeetingActive(true);

            // Show recording notification if enabled
            await showRecordingNotification();
          } catch (error) {
            console.error('Failed to auto-start recording:', error);
            setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Failed to auto-start recording');
            toast.error('Recording failed to start', { description: 'Check your microphone permissions in System Settings' });
          } finally {
            setIsAutoStarting(false);
          }
        }
      }
    };

    checkAutoStartRecording();
  }, [
    isRecording,
    isAutoStarting,
    selectedDevices,
    generateMeetingTitle,
    setMeetingTitle,
    setIsRecording,
    clearTranscripts,
    setIsMeetingActive,
    checkTranscriptionReady,
    checkIfModelDownloading,
    showModal,
    setStatus,
  ]);

  // Listen for direct recording trigger from sidebar when already on home page
  useEffect(() => {
    const handleDirectStart = async () => {
      if (isRecording || isAutoStarting) {
        console.log('Recording already in progress, ignoring direct start event');
        return;
      }

      console.log('Direct start from sidebar - checking transcription model status');
      setIsAutoStarting(true);

      // Check if transcription model is ready before starting
      const modelReady = await checkTranscriptionReady();
      if (!modelReady) {
        const isDownloading = await checkIfModelDownloading();
        if (isDownloading) {
          toast.info('Model download in progress', {
            description: 'Please wait for the transcription model to finish downloading before recording.',
            duration: 5000,
          });
        } else {
          toast.error('Transcription model is still loading', {
            description: 'Please wait a moment and try again',
            duration: 5000,
          });
          showModal?.('modelSelector', 'Transcription model setup required');
        }
        setStatus(RecordingStatus.IDLE);
        setIsAutoStarting(false);
        return;
      }

      try {
        // Generate meeting title
        const generatedMeetingTitle = generateMeetingTitle();

        // Set STARTING status before initiating backend recording
        setStatus(RecordingStatus.STARTING, 'Initializing recording...');

        console.log('Starting backend recording with meeting:', generatedMeetingTitle);
        const result = await recordingService.startRecordingWithDevices(
          selectedDevices?.micDevice || null,
          selectedDevices?.systemDevice || null,
          generatedMeetingTitle
        );
        console.log('Backend recording result:', result);

        // Update UI state after successful backend start
        // Note: RECORDING status will be set by RecordingStateContext event listener
        setMeetingTitle(generatedMeetingTitle);
        setIsRecording(true);
        clearTranscripts();
        setIsMeetingActive(true);

        // Show recording notification if enabled
        await showRecordingNotification();
      } catch (error) {
        console.error('Failed to start recording from sidebar:', error);
        setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Failed to start recording from sidebar');
        toast.error('Recording failed to start', { description: 'Check your microphone permissions in System Settings' });
      } finally {
        setIsAutoStarting(false);
      }
    };

    window.addEventListener('start-recording-from-sidebar', handleDirectStart);

    return () => {
      window.removeEventListener('start-recording-from-sidebar', handleDirectStart);
    };
  }, [
    isRecording,
    isAutoStarting,
    selectedDevices,
    generateMeetingTitle,
    setMeetingTitle,
    setIsRecording,
    clearTranscripts,
    setIsMeetingActive,
    checkTranscriptionReady,
    checkIfModelDownloading,
    showModal,
    setStatus,
  ]);

  return {
    handleRecordingStart,
    isAutoStarting,
  };
}
