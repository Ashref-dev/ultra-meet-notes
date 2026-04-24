'use client';

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { appDataDir } from '@tauri-apps/api/path';
import { AlertCircle, Mic, Pause, Play, Square, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { RecordingStatus, useRecordingState } from '@/contexts/RecordingStateContext';
import { formatRecordingTimer } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';

interface RecordingControlsProps {
  isRecording: boolean;
  onRecordingStop: (callApi?: boolean) => void;
  onRecordingStart: () => Promise<void>;
  onTranscriptionError?: (message: string) => void;
  onStopInitiated?: () => void;
  isRecordingDisabled: boolean;
  isParentProcessing: boolean;
}

const waveformBars = [
  { id: 'bar-1', height: 8 },
  { id: 'bar-2', height: 14 },
  { id: 'bar-3', height: 20 },
  { id: 'bar-4', height: 12 },
  { id: 'bar-5', height: 18 },
  { id: 'bar-6', height: 10 },
  { id: 'bar-7', height: 16 },
  { id: 'bar-8', height: 12 },
  { id: 'bar-9', height: 8 },
];
const pauseResumeDebounceMs = 300;

function AudioWaveform({
  isActive,
  isPaused,
}: {
  isActive: boolean;
  isPaused: boolean;
}) {
  return (
    <div className="flex h-6 items-end gap-[3px]" aria-hidden="true">
      {waveformBars.map(({ id, height }, index) => (
        <div
          key={id}
          className={cn(
  'w-[3px] shrink-0 rounded-lg transition-[height,opacity,background-color] duration-200',
            isActive && !isPaused ? 'animate-waveform bg-foreground' : 'bg-muted-foreground/60'
          )}
          style={
            isActive && !isPaused
              ? { animationDelay: `${index * 0.08}s` }
              : { height: `${height}px` }
          }
        />
      ))}
    </div>
  );
}

export const RecordingControls: React.FC<RecordingControlsProps> = ({
  isRecording,
  onRecordingStop,
  onRecordingStart,
  onTranscriptionError,
  onStopInitiated,
  isRecordingDisabled,
  isParentProcessing,
}) => {
  const recordingState = useRecordingState();
  const { isPaused, recordingDuration, status, isStopping: isContextStopping, isProcessing: isContextProcessing } = recordingState;

  const [displayDuration, setDisplayDuration] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [isPauseResumeCoolingDown, setIsPauseResumeCoolingDown] = useState(false);
  const [speechDetected, setSpeechDetected] = useState(false);
  const [deviceError, setDeviceError] = useState<{ title: string; message: string } | null>(null);

  const pauseResumeDebounceTimeoutRef = useRef<number | null>(null);

  const isStartPending = isStarting || status === RecordingStatus.STARTING;
  const isStopFlowActive = isStopping || isProcessing || isContextStopping || isContextProcessing || isParentProcessing;
  const showRecordingBar = isRecording || isStopFlowActive;
  const isPauseResumeDisabled = isPausing || isResuming || isPauseResumeCoolingDown || isStopFlowActive;
  const recordingTimer = formatRecordingTimer(displayDuration);

  useEffect(() => {
    if (recordingDuration !== null) {
      setDisplayDuration(Math.floor(recordingDuration));
      return;
    }

    if (!showRecordingBar) {
      setDisplayDuration(0);
    }
  }, [recordingDuration, showRecordingBar]);

  useEffect(() => {
    if (!showRecordingBar) {
      setSpeechDetected(false);
    }
  }, [showRecordingBar]);

  useEffect(() => {
    const checkTauri = async () => {
      try {
        const result = await invoke('is_recording');
        console.log('Tauri is initialized and ready, is_recording result:', result);
      } catch (error) {
        console.error('Tauri initialization error:', error);
        toast.error('Recording failed to start', { description: 'Try restarting the app' });
      }
    };

    checkTauri();
  }, []);

  useEffect(() => {
    return () => {
      if (pauseResumeDebounceTimeoutRef.current !== null) {
        window.clearTimeout(pauseResumeDebounceTimeoutRef.current);
      }
    };
  }, []);

  const startPauseResumeDebounce = useCallback(() => {
    setIsPauseResumeCoolingDown(true);

    if (pauseResumeDebounceTimeoutRef.current !== null) {
      window.clearTimeout(pauseResumeDebounceTimeoutRef.current);
    }

    pauseResumeDebounceTimeoutRef.current = window.setTimeout(() => {
      setIsPauseResumeCoolingDown(false);
      pauseResumeDebounceTimeoutRef.current = null;
    }, pauseResumeDebounceMs);
  }, []);

  const handleStartRecording = useCallback(async () => {
    if (isStartPending || isStopFlowActive || isRecordingDisabled) {
      return;
    }

    setIsStarting(true);
    setDeviceError(null);
    setSpeechDetected(false);

    try {
      await onRecordingStart();
    } catch (error) {
      console.error('Failed to start recording:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined,
      });

      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('microphone') || errorMessage.includes('mic') || errorMessage.includes('input')) {
        setDeviceError({
          title: 'Microphone Not Available',
          message:
            'Unable to access your microphone. Please check that:\n• Your microphone is connected\n• The app has microphone permissions\n• No other app is using the microphone',
        });
      } else if (errorMessage.includes('system audio') || errorMessage.includes('speaker') || errorMessage.includes('output')) {
        setDeviceError({
          title: 'System Audio Not Available',
          message:
            'Unable to capture system audio. Please check that:\n• A virtual audio device (like BlackHole) is installed\n• The app has screen recording permissions (macOS)\n• System audio is properly configured',
        });
      } else if (errorMessage.includes('permission')) {
        setDeviceError({
          title: 'Permission Required',
          message:
            'Recording permissions are required. Please:\n• Grant microphone access in System Settings\n• Grant screen recording access for system audio (macOS)\n• Restart the app after granting permissions',
        });
      } else {
        setDeviceError({
          title: 'Recording Failed',
          message: 'Unable to start recording. Please check your audio device settings and try again.',
        });
      }
    } finally {
      setIsStarting(false);
    }
  }, [isRecordingDisabled, isStartPending, isStopFlowActive, onRecordingStart]);

  const stopRecordingAction = useCallback(async () => {
    console.log('Executing stop recording...');

    try {
      setIsProcessing(true);
      const dataDir = await appDataDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const savePath = `${dataDir}/recording-${timestamp}.wav`;

      console.log('Saving recording to:', savePath);
      console.log('About to call stop_recording command');

      const result = await invoke('stop_recording', {
        args: {
          save_path: savePath,
        },
      });

      console.log('stop_recording command completed successfully:', result);
      setIsProcessing(false);
      onRecordingStop(true);
    } catch (error) {
      console.error('Failed to stop recording:', error);

      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          name: error.name,
          stack: error.stack,
        });

        if (error.message.includes('No recording in progress')) {
          return;
        }
      } else if (typeof error === 'string' && error.includes('No recording in progress')) {
        return;
      } else if (error && typeof error === 'object' && 'toString' in error) {
        if (error.toString().includes('No recording in progress')) {
          return;
        }
      }

      setIsProcessing(false);
      onRecordingStop(false);
    } finally {
      setIsStopping(false);
    }
  }, [onRecordingStop]);

  const handleStopRecording = useCallback(async () => {
    console.log('handleStopRecording called - isRecording:', isRecording, 'isStarting:', isStartPending, 'isStopping:', isStopping);

    if (!isRecording || isStartPending || isStopping || isProcessing || isContextStopping) {
      console.log('Early return from handleStopRecording due to state check');
      return;
    }

    console.log('Stopping recording...');
    onStopInitiated?.();
    setIsStopping(true);

    await stopRecordingAction();
  }, [isContextStopping, isProcessing, isRecording, isStartPending, isStopping, onStopInitiated, stopRecordingAction]);

  const handlePauseRecording = useCallback(async () => {
    if (!isRecording || isPaused || isPausing || isPauseResumeCoolingDown || isStopFlowActive) {
      return;
    }

    console.log('Pausing recording...');
    setIsPausing(true);
    startPauseResumeDebounce();

    try {
      await invoke('pause_recording');
      console.log('Recording paused successfully');
    } catch (error) {
      console.error('Failed to pause recording:', error);
      toast.error('Couldn\'t pause recording', { description: 'Try again' });
    } finally {
      setIsPausing(false);
    }
  }, [isPauseResumeCoolingDown, isPaused, isPausing, isRecording, isStopFlowActive, startPauseResumeDebounce]);

  const handleResumeRecording = useCallback(async () => {
    if (!isRecording || !isPaused || isResuming || isPauseResumeCoolingDown || isStopFlowActive) {
      return;
    }

    console.log('Resuming recording...');
    setIsResuming(true);
    startPauseResumeDebounce();

    try {
      await invoke('resume_recording');
      console.log('Recording resumed successfully');
    } catch (error) {
      console.error('Failed to resume recording:', error);
      toast.error('Couldn\'t resume recording', { description: 'Try again' });
    } finally {
      setIsResuming(false);
    }
  }, [isPauseResumeCoolingDown, isPaused, isRecording, isResuming, isStopFlowActive, startPauseResumeDebounce]);

  useEffect(() => {
    console.log('Setting up recording event listeners');
    let unsubscribes: (() => void)[] = [];

    const setupListeners = async () => {
      try {
        const transcriptErrorUnsubscribe = await listen('transcript-error', (event) => {
          console.log('transcript-error event received:', event);
          console.error('Transcription error received:', event.payload);
          const errorMessage = event.payload as string;

          setIsProcessing(false);
          console.log('Calling onRecordingStop(false) due to transcript error');
          onRecordingStop(false);

          if (onTranscriptionError) {
            onTranscriptionError(errorMessage);
          }
        });

        const transcriptionErrorUnsubscribe = await listen('transcription-error', (event) => {
          console.log('transcription-error event received:', event);
          console.error('Transcription error received:', event.payload);

          let errorMessage: string;

          if (typeof event.payload === 'object' && event.payload !== null) {
            const payload = event.payload as { error: string; userMessage: string; actionable: boolean };
            errorMessage = payload.userMessage || payload.error;
          } else {
            errorMessage = String(event.payload);
          }

          setIsProcessing(false);
          console.log('Calling onRecordingStop(false) due to transcription error');
          onRecordingStop(false);
        });

        const speechDetectedUnsubscribe = await listen('speech-detected', (event) => {
          console.log('speech-detected event received:', event);
          setSpeechDetected(true);
        });

        unsubscribes = [
          transcriptErrorUnsubscribe,
          transcriptionErrorUnsubscribe,
          speechDetectedUnsubscribe,
        ];
        console.log('Recording event listeners set up successfully');
      } catch (error) {
        console.error('Failed to set up recording event listeners:', error);
      }
    };

    setupListeners();

    return () => {
      console.log('Cleaning up recording event listeners');
      unsubscribes.forEach((unsubscribe) => {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      });
    };
  }, [onRecordingStop, onTranscriptionError]);

  return (
    <div className="flex w-full flex-col items-center gap-3">
      {showRecordingBar ? (
        <div className="w-full max-w-[560px]">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-3 shadow-lg sm:gap-4 sm:px-4">
            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
              <div className="flex min-w-[52px] justify-start">
                <AudioWaveform isActive={isRecording && !isStopFlowActive} isPaused={isPaused || isStopFlowActive} />
              </div>

              <div className="min-w-[60px]">
                <span className="font-mono text-sm font-medium tabular-nums text-foreground sm:text-base" aria-live="polite">
                  {recordingTimer}
                </span>
                <span className="sr-only">
                  {isStopFlowActive
                    ? 'Stopping recording'
                    : isPaused
                      ? 'Recording paused'
                      : speechDetected
                        ? 'Recording in progress, audio detected'
                        : 'Recording in progress'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (isPaused) {
                    void handleResumeRecording();
                    return;
                  }

                  void handlePauseRecording();
                }}
                disabled={isPauseResumeDisabled}
                className="rounded-lg px-4 h-10 gap-1.5 text-sm"
              >
                {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                <span>{isPaused ? 'Resume' : 'Pause'}</span>
              </Button>

              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  void handleStopRecording();
                }}
                disabled={isStopFlowActive}
                className="rounded-lg px-4 h-10 gap-1.5 text-sm"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>{isStopFlowActive ? 'Stopping...' : 'Stop'}</span>
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Button
          variant="brand"
          onClick={() => {
            void handleStartRecording();
          }}
          disabled={isStartPending || isRecordingDisabled || isParentProcessing}
          className="h-12 min-w-[220px] rounded-lg px-5 text-white shadow-lg gap-1.5"
        >
          {isStartPending ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
          <span>{isStartPending ? 'Starting...' : 'Start Recording'}</span>
        </Button>
      )}

      {deviceError ? (
        <Alert variant="destructive" className="relative w-full max-w-[560px] border-destructive/30 bg-destructive/10 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <button
            type="button"
            onClick={() => setDeviceError(null)}
            className="absolute right-3 top-3 rounded-md p-1 text-destructive/80 transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close recording error"
          >
            <X className="h-4 w-4" />
          </button>
          <AlertTitle className="mb-2">{deviceError.title}</AlertTitle>
          <AlertDescription>
            {deviceError.message.split('\n').map((line, index) => (
              <div key={line} className={index > 0 ? 'ml-2' : ''}>
                {line}
              </div>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
};
