"use client"

import { useEffect, useState } from "react"
import { Switch } from "./ui/switch"
import { FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { invoke } from "@tauri-apps/api/core"
import { useConfig, NotificationSettings } from "@/contexts/ConfigContext"

type MeetingDetectionPreferences = {
  meeting_app_detection_enabled?: boolean
}

export function PreferenceSettings() {
  const {
    notificationSettings,
    storageLocations,
    isLoadingPreferences,
    loadPreferences,
    updateNotificationSettings
  } = useConfig();

  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean | null>(null);
  const [meetingDetectionEnabled, setMeetingDetectionEnabled] = useState<boolean>(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [previousNotificationsEnabled, setPreviousNotificationsEnabled] = useState<boolean | null>(null);

  // Lazy load preferences on mount (only loads if not already cached)
  useEffect(() => {
    loadPreferences();

    // Load meeting detection state
    invoke<MeetingDetectionPreferences>('get_recording_preferences')
      .then((preferences) => setMeetingDetectionEnabled(preferences.meeting_app_detection_enabled === true))
      .catch(() => setMeetingDetectionEnabled(false));
  }, [loadPreferences]);

  // Update notificationsEnabled when notificationSettings are loaded from global state
  useEffect(() => {
    if (notificationSettings) {
      // Notification enabled means both started and stopped notifications are enabled
      const enabled =
        notificationSettings.notification_preferences.show_recording_started &&
        notificationSettings.notification_preferences.show_recording_stopped;
      setNotificationsEnabled(enabled);
      if (isInitialLoad) {
        setPreviousNotificationsEnabled(enabled);
        setIsInitialLoad(false);
      }
    } else if (!isLoadingPreferences) {
      // If not loading and no settings, use default
      setNotificationsEnabled(false);
      if (isInitialLoad) {
        setPreviousNotificationsEnabled(false);
        setIsInitialLoad(false);
      }
    }
  }, [notificationSettings, isLoadingPreferences, isInitialLoad])

  useEffect(() => {
    // Skip update on initial load or if value hasn't actually changed
    if (isInitialLoad || notificationsEnabled === null || notificationsEnabled === previousNotificationsEnabled) return;
    if (!notificationSettings) return;

    const handleUpdateNotificationSettings = async () => {
      console.log("Updating notification settings to:", notificationsEnabled);

      try {
        // Update the notification preferences
        const updatedSettings: NotificationSettings = {
          ...notificationSettings,
          notification_preferences: {
            ...notificationSettings.notification_preferences,
            show_recording_started: notificationsEnabled,
            show_recording_stopped: notificationsEnabled,
          }
        };

        console.log("Calling updateNotificationSettings with:", updatedSettings);
        await updateNotificationSettings(updatedSettings);
        setPreviousNotificationsEnabled(notificationsEnabled);
        console.log("Successfully updated notification settings to:", notificationsEnabled);

      } catch (error) {
        console.error('Failed to update notification settings:', error);
      }
    };

    handleUpdateNotificationSettings();
  }, [notificationsEnabled, notificationSettings, isInitialLoad, previousNotificationsEnabled, updateNotificationSettings])

  const handleMeetingDetectionChange = async (enabled: boolean) => {
    const previousValue = meetingDetectionEnabled;
    setMeetingDetectionEnabled(enabled);

    try {
      await invoke(enabled ? 'enable_meeting_app_detection' : 'disable_meeting_app_detection');
    } catch (error) {
      console.error('Failed to update meeting detection setting:', error);
      setMeetingDetectionEnabled(previousValue);
    }
  };

  const handleOpenRecordingsFolder = async () => {
    try {
      await invoke('open_recordings_folder');
    } catch (error) {
      console.error('Failed to open recordings folder:', error);
    }
  };

  // Show loading only if we're actually loading and don't have cached data
  if (isLoadingPreferences && !notificationSettings && !storageLocations) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((item) => (
          <div key={item} className="animate-pulse rounded-xl border border-border bg-card p-6 shadow-sm">
            <div className="mb-3 h-4 w-32 rounded-lg bg-muted" />
            <div className="mb-4 h-3 w-2/3 rounded-lg bg-muted" />
            <div className="h-10 w-full rounded-xl bg-muted" />
          </div>
        ))}
      </div>
    )
  }

  // Show loading if notificationsEnabled hasn't been determined yet
  if (notificationsEnabled === null && !isLoadingPreferences) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">
        Loading preferences…
      </div>
    )
  }

  // Ensure we have a boolean value for the Switch component
  const notificationsEnabledValue = notificationsEnabled ?? false;

  return (
    <div className="space-y-6">
      {/* Notifications Section */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm shadow-black/5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="mb-2 text-lg font-semibold text-foreground">Notifications</h3>
            <p className="text-sm text-muted-foreground">Enable or disable notifications of start and end of meeting</p>
          </div>
          <Switch checked={notificationsEnabledValue} onCheckedChange={setNotificationsEnabled} />
        </div>
      </div>

      {/* Meeting App Detection Section */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm shadow-black/5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="mb-2 text-lg font-semibold text-foreground">Auto-detect Meeting Apps</h3>
            <p className="text-sm text-muted-foreground">Show a reminder when Zoom, Teams, Slack, Discord, Webex, or a supported browser launches</p>
          </div>
          <Switch checked={meetingDetectionEnabled} onCheckedChange={handleMeetingDetectionChange} />
        </div>
      </div>

      {/* Data Storage Locations Section */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm shadow-black/5">
        <h3 className="mb-4 text-lg font-semibold text-foreground">Data Storage Locations</h3>
        <p className="mb-6 text-sm text-muted-foreground">
          View where Ultra saves meeting recordings. You can change this folder from the Recordings tab.
        </p>

        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card/60 p-4 backdrop-blur-sm shadow-sm">
            <div className="mb-2 font-medium text-foreground">Recordings folder</div>
            <div className="mb-3 break-all font-mono text-xs text-muted-foreground">
              {storageLocations?.recordings || 'Loading...'}
            </div>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={handleOpenRecordingsFolder}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <FolderOpen className="w-4 h-4" />
              Open Folder
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-card/60 p-4 backdrop-blur-sm shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="font-medium text-foreground">Notes &amp; transcripts folder</div>
              {storageLocations?.syncFolders ? (
                <span className="rounded-lg border border-border bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                  Same as recordings
                </span>
              ) : null}
            </div>
            <div className="mb-3 break-all font-mono text-xs text-muted-foreground">
              {storageLocations?.notes || 'Loading...'}
            </div>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={async () => {
                try {
                  await invoke('open_notes_folder');
                } catch (error) {
                  console.error('Failed to open notes folder:', error);
                }
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <FolderOpen className="w-4 h-4" />
              Open Folder
            </Button>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-muted/70 p-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Note:</span>{' '}
            Audio recordings stay in the recordings folder. Transcripts and AI notes follow the notes folder, or mirror recordings when sync is enabled.
          </p>
        </div>
      </div>
    </div>
  )
}
