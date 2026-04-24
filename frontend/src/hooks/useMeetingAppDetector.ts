'use client';

import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { toast } from 'sonner';

type MeetingAppDetectedPayload = {
  appName: string;
  bundleId: string;
  detectedAt: string;
};

type RecordingPreferences = {
  meeting_app_detection_enabled?: boolean;
};

const FRONTEND_DEDUP_WINDOW_MS = 5_000;

async function showNativeMeetingDetectionNotification(message: string): Promise<void> {
  try {
    let granted = await isPermissionGranted();

    if (!granted) {
      granted = (await requestPermission()) === 'granted';
    }

    if (!granted) {
      return;
    }

    sendNotification({
      title: 'Ultra',
      body: message,
    });
  } catch (error) {
    console.error('[MeetingAppDetector] Failed to show native notification:', error);
  }
}

export function useMeetingAppDetector({ disabled = false }: { disabled?: boolean } = {}): void {
  const lastToastByBundleRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (disabled) {
      return;
    }

    let isCancelled = false;
    let unlisten: (() => void) | undefined;

    const setupDetector = async () => {
      try {
        unlisten = await listen<MeetingAppDetectedPayload>('meeting-app-detected', async (event) => {
          const { appName, bundleId } = event.payload;
          const now = Date.now();
          const lastToastAt = lastToastByBundleRef.current.get(bundleId) ?? 0;

          if (now - lastToastAt < FRONTEND_DEDUP_WINDOW_MS) {
            return;
          }

          lastToastByBundleRef.current.set(bundleId, now);

          const message = `Meeting app detected: ${appName} — open Ultra to record`;
          toast.info(message, {
            duration: 8000,
          });

          await showNativeMeetingDetectionNotification(message);
        });
      } catch (error) {
        console.error('[MeetingAppDetector] Failed to subscribe to meeting-app-detected:', error);
        return;
      }

      try {
        const preferences = await invoke<RecordingPreferences>('get_recording_preferences');

        if (isCancelled) {
          return;
        }

        if (preferences.meeting_app_detection_enabled === false) {
          await invoke('disable_meeting_app_detection');
          return;
        }

        await invoke('enable_meeting_app_detection');
      } catch (error) {
        console.error('[MeetingAppDetector] Failed to sync meeting detection state:', error);
      }
    };

    void setupDetector();

    return () => {
      isCancelled = true;

      if (unlisten) {
        unlisten();
      }
    };
  }, [disabled]);
}
