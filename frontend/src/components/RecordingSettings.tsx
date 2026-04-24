import React, { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { invoke } from '@tauri-apps/api/core';
import { DeviceSelection, SelectedDevices } from '@/components/DeviceSelection';
import { toast } from 'sonner';
import { SaveLocations } from '@/services/configService';

const RECORDING_LOCATION_UPDATED_EVENT = 'recording-location-updated';

export interface RecordingPreferences {
  save_folder: string;
  notes_folder: string;
  sync_folders: boolean;
  auto_save: boolean;
  file_format: string;
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
  meeting_app_detection_enabled: boolean;
}

interface RecordingSettingsProps {
  onSave?: (preferences: RecordingPreferences) => void;
}

export function RecordingSettings({ onSave }: RecordingSettingsProps) {
  const [preferences, setPreferences] = useState<RecordingPreferences>({
    save_folder: '',
    notes_folder: '',
    sync_folders: true,
    auto_save: true,
    file_format: 'mp4',
    preferred_mic_device: null,
    preferred_system_device: null,
    meeting_app_detection_enabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectingRecordingFolder, setSelectingRecordingFolder] = useState(false);
  const [selectingNotesFolder, setSelectingNotesFolder] = useState(false);
  const [showRecordingNotification, setShowRecordingNotification] = useState(true);

  const effectiveNotesFolder = preferences.sync_folders
    ? preferences.save_folder
    : preferences.notes_folder;

  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await invoke<RecordingPreferences>('get_recording_preferences');
        setPreferences(prefs);
      } catch (error) {
        console.error('Failed to load recording preferences:', error);
        try {
          const defaultPath = await invoke<string>('get_default_recordings_folder_path');
          setPreferences((prev) => ({
            ...prev,
            save_folder: defaultPath,
            notes_folder: defaultPath,
            sync_folders: true,
          }));
        } catch (defaultError) {
          console.error('Failed to get default folder path:', defaultError);
        }
      } finally {
        setLoading(false);
      }
    };

    void loadPreferences();
  }, []);

  useEffect(() => {
    const loadNotificationPref = async () => {
      try {
        const { Store } = await import('@tauri-apps/plugin-store');
        const store = await Store.load('preferences.json');
        const show = (await store.get<boolean>('show_recording_notification')) ?? true;
        setShowRecordingNotification(show);
      } catch (error) {
        console.error('Failed to load notification preference:', error);
      }
    };

    void loadNotificationPref();
  }, []);

  const dispatchStorageLocationUpdate = (locations: SaveLocations) => {
    window.dispatchEvent(
      new CustomEvent(RECORDING_LOCATION_UPDATED_EVENT, {
        detail: {
          recordingsPath: locations.recordings_folder,
          notesPath: locations.notes_folder,
          syncFolders: locations.sync_folders,
        },
      })
    );
  };

  const savePreferences = async (
    prefs: RecordingPreferences,
    options?: {
      successTitle?: string;
      successDescription?: string;
      errorTitle?: string;
    }
  ) => {
    setSaving(true);
    try {
      await invoke('set_recording_preferences', { preferences: prefs });
      onSave?.(prefs);

      if (options?.successTitle) {
        toast.success(options.successTitle, {
          description: options.successDescription,
        });
      }

      return true;
    } catch (error) {
      console.error('Failed to save recording preferences:', error);
      toast.error(options?.errorTitle || 'Failed to save recording preferences', {
        description: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleAutoSaveToggle = async (enabled: boolean) => {
    const previousPreferences = preferences;
    const nextPreferences = { ...preferences, auto_save: enabled };
    setPreferences(nextPreferences);

    const saved = await savePreferences(nextPreferences, {
      errorTitle: 'Failed to update recording preference',
    });

    if (!saved) {
      setPreferences(previousPreferences);
    }
  };

  const handleDeviceChange = async (devices: SelectedDevices) => {
    const previousPreferences = preferences;
    const nextPreferences = {
      ...preferences,
      preferred_mic_device: devices.micDevice,
      preferred_system_device: devices.systemDevice,
    };
    setPreferences(nextPreferences);

    const saved = await savePreferences(nextPreferences, {
      successTitle: 'Default audio devices saved',
      successDescription: `Microphone: ${nextPreferences.preferred_mic_device || 'Default'}, System Audio: ${nextPreferences.preferred_system_device || 'Default'}`,
      errorTitle: 'Failed to save device preferences',
    });

    if (!saved) {
      setPreferences(previousPreferences);
    }
  };

  const handleOpenRecordingsFolder = async () => {
    try {
      await invoke('open_recordings_folder');
    } catch (error) {
      console.error('Failed to open recordings folder:', error);
    }
  };

  const handleOpenNotesFolder = async () => {
    try {
      await invoke('open_notes_folder');
    } catch (error) {
      console.error('Failed to open notes folder:', error);
    }
  };

  const handleSelectRecordingFolder = async () => {
    const previousPreferences = preferences;
    setSelectingRecordingFolder(true);

    try {
      const selectedFolder = await invoke<string | null>('select_recording_folder');

      if (!selectedFolder) {
        return;
      }

      const locations = await invoke<SaveLocations>('set_recordings_folder', { folder: selectedFolder });

      setPreferences((current) => ({
        ...current,
        save_folder: locations.recordings_folder,
        notes_folder: locations.notes_folder,
        sync_folders: locations.sync_folders,
      }));
      dispatchStorageLocationUpdate(locations);

      toast.success('Recording location updated', {
        description: selectedFolder,
      });
    } catch (error) {
      console.error('Failed to change recording location:', error);
      setPreferences(previousPreferences);
      toast.error('Failed to update recording location', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSelectingRecordingFolder(false);
    }
  };

  const handleSelectNotesFolder = async () => {
    const previousPreferences = preferences;
    setSelectingNotesFolder(true);

    try {
      const selectedFolder = await invoke<string | null>('select_notes_folder');

      if (!selectedFolder) {
        return;
      }

      const locations = await invoke<SaveLocations>('set_notes_folder', { folder: selectedFolder });

      setPreferences((current) => ({
        ...current,
        notes_folder: locations.notes_folder,
        sync_folders: locations.sync_folders,
      }));
      dispatchStorageLocationUpdate(locations);

      toast.success('Notes location updated', {
        description: selectedFolder,
      });
    } catch (error) {
      console.error('Failed to change notes location:', error);
      setPreferences(previousPreferences);
      toast.error('Failed to update notes location', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSelectingNotesFolder(false);
    }
  };

  const handleSyncFoldersChange = async (enabled: boolean) => {
    const previousPreferences = preferences;
    setPreferences((current) => ({
      ...current,
      sync_folders: enabled,
      notes_folder: enabled ? current.save_folder : current.notes_folder,
    }));

    setSaving(true);
    try {
      const locations = await invoke<SaveLocations>('set_sync_folders', { value: enabled });
      setPreferences((current) => ({
        ...current,
        save_folder: locations.recordings_folder,
        notes_folder: locations.notes_folder,
        sync_folders: locations.sync_folders,
      }));
      dispatchStorageLocationUpdate(locations);
    } catch (error) {
      console.error('Failed to update folder sync preference:', error);
      setPreferences(previousPreferences);
      toast.error('Failed to update folder sync preference', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleNotificationToggle = async (enabled: boolean) => {
    try {
      setShowRecordingNotification(enabled);
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('preferences.json');
      await store.set('show_recording_notification', enabled);
      await store.save();
      toast.success('Preference saved');
    } catch (error) {
      console.error('Failed to save notification preference:', error);
      toast.error('Failed to save preference');
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="mb-4 h-4 w-1/4 rounded bg-muted" />
        <div className="mb-4 h-8 rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-4 text-lg font-semibold text-foreground">Recording Settings</h3>
        <p className="mb-6 text-sm text-muted-foreground">
          Configure how your audio recordings are saved during meetings.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4 shadow-sm shadow-black/5">
        <div className="flex-1">
          <div className="font-medium text-foreground">Keep Audio Recordings</div>
          <div className="text-sm text-muted-foreground">
            Audio is always captured temporarily so speaker diarization can run. When enabled, the final audio file is kept in your recordings folder. When disabled, the audio is deleted automatically after speaker analysis completes.
          </div>
        </div>
        <Switch
          checked={preferences.auto_save}
          onCheckedChange={handleAutoSaveToggle}
          disabled={saving}
        />
      </div>

      {preferences.auto_save && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card/60 p-5 backdrop-blur-sm shadow-sm shadow-black/5">
            <div className="mb-5">
              <div className="mb-2 text-base font-semibold text-foreground">Save Locations</div>
              <p className="text-sm text-muted-foreground">
                Keep audio in your recordings folder, and optionally store transcripts and AI notes in a separate location.
              </p>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-background/70 p-4">
                <div className="mb-2 font-medium text-foreground">Recordings folder</div>
                <div className="mb-3 break-all text-sm text-muted-foreground">
                  {preferences.save_folder || 'Default folder'}
                </div>
                <div className="flex flex-wrap gap-2">
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

                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={handleSelectRecordingFolder}
                    disabled={saving || selectingRecordingFolder}
                    className="inline-flex min-h-11 items-center rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {selectingRecordingFolder ? 'Choosing folder…' : 'Change Folder'}
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background/70 p-4">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="mb-2 font-medium text-foreground">Keep notes in the same folder as recordings</div>
                    <p className="text-sm text-muted-foreground">
                      Turn off to save transcripts and AI notes to a separate folder.
                    </p>
                  </div>
                  <Switch
                    checked={preferences.sync_folders}
                    onCheckedChange={handleSyncFoldersChange}
                    disabled={saving}
                  />
                </div>

                <div className={`rounded-xl border border-border bg-muted/40 p-4 transition-opacity ${preferences.sync_folders ? 'cursor-not-allowed opacity-50' : ''}`}>
                  <div className="mb-2 font-medium text-foreground">Notes & transcripts folder</div>
                  <div className="mb-1 break-all text-sm text-muted-foreground">
                    {effectiveNotesFolder || 'Default folder'}
                  </div>
                  {preferences.sync_folders && (
                    <p className="mb-3 text-xs text-muted-foreground">
                      Sync is on, so transcripts and AI notes will be saved in the recordings folder shown above.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={handleOpenNotesFolder}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <FolderOpen className="w-4 h-4" />
                      Open Folder
                    </Button>

                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      onClick={handleSelectNotesFolder}
                      disabled={saving || selectingNotesFolder || preferences.sync_folders}
                      className="inline-flex min-h-11 items-center rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {selectingNotesFolder ? 'Choosing folder…' : 'Change Folder'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm shadow-black/5">
            <div className="text-sm text-foreground">
              <strong>File Format:</strong> {preferences.file_format.toUpperCase()} files
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Recordings are saved with timestamp: recording_YYYYMMDD_HHMMSS.{preferences.file_format}
            </div>
          </div>
        </div>
      )}

      {!preferences.auto_save && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm shadow-black/5">
          <div className="text-sm text-muted-foreground">
            Audio will be deleted automatically after speaker analysis completes. Enable &quot;Keep Audio Recordings&quot; to retain it in your recordings folder.
          </div>
        </div>
      )}

      <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4 shadow-sm shadow-black/5">
        <div className="flex-1">
          <div className="font-medium text-foreground">Recording Start Notification</div>
          <div className="text-sm text-muted-foreground">
            Show reminder to inform participants when recording starts
          </div>
        </div>
        <Switch
          checked={showRecordingNotification}
          onCheckedChange={handleNotificationToggle}
        />
      </div>

      <div className="space-y-4">
        <div className="border-t pt-6">
          <h4 className="mb-4 text-base font-medium text-foreground">Default Audio Devices</h4>
          <p className="mb-4 text-sm text-muted-foreground">
            Set your preferred microphone and system audio devices for recording. These will be automatically selected when starting new recordings.
          </p>

          <div className="rounded-xl border border-border bg-muted/50 p-4">
            <DeviceSelection
              selectedDevices={{
                micDevice: preferences.preferred_mic_device,
                systemDevice: preferences.preferred_system_device,
              }}
              onDeviceChange={handleDeviceChange}
              disabled={saving}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
