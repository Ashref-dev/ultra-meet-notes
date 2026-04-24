use log::{info, warn};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_store::StoreExt;

use anyhow::Result;
#[cfg(target_os = "macos")]
use log::error;

#[cfg(target_os = "macos")]
use crate::audio::capture::AudioCaptureBackend;

const LEGACY_FOLDER_NAMES: &[&str] = &[
    "meetily-recordings",
    "hyper-meet-recordings",
    "alacrity-recordings",
];
const NEW_FOLDER_NAME: &str = "ultra-meet-recordings";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecordingPreferences {
    pub save_folder: PathBuf,
    #[serde(default = "default_notes_folder")]
    pub notes_folder: PathBuf,
    #[serde(default = "default_sync_folders")]
    pub sync_folders: bool,
    pub auto_save: bool,
    pub file_format: String,
    #[serde(default)]
    pub preferred_mic_device: Option<String>,
    #[serde(default)]
    pub preferred_system_device: Option<String>,
    #[serde(default = "default_true")]
    pub meeting_app_detection_enabled: bool,
    #[serde(default)]
    pub hf_token: Option<String>,
    #[cfg(target_os = "macos")]
    #[serde(default)]
    pub system_audio_backend: Option<String>,
}

impl Default for RecordingPreferences {
    fn default() -> Self {
        Self {
            save_folder: get_default_recordings_folder(),
            notes_folder: default_notes_folder(),
            sync_folders: default_sync_folders(),
            auto_save: true,
            file_format: "mp4".to_string(),
            preferred_mic_device: None,
            preferred_system_device: None,
            meeting_app_detection_enabled: default_true(),
            hf_token: None,
            #[cfg(target_os = "macos")]
            system_audio_backend: Some("coreaudio".to_string()),
        }
    }
}

pub fn default_true() -> bool {
    true
}

fn default_notes_folder() -> PathBuf {
    get_default_recordings_folder()
}

fn default_sync_folders() -> bool {
    true
}

#[derive(Debug, Serialize, Clone)]
pub struct SaveLocations {
    pub recordings_folder: String,
    pub notes_folder: String,
    pub sync_folders: bool,
}

/// Get the default recordings folder based on platform
pub fn get_default_recordings_folder() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        // Windows: %USERPROFILE%\Music\ultra-meet-recordings
        if let Some(music_dir) = dirs::audio_dir() {
            music_dir.join(NEW_FOLDER_NAME)
        } else {
            // Fallback to Documents if Music folder is not available
            dirs::document_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(NEW_FOLDER_NAME)
        }
    }

    #[cfg(target_os = "macos")]
    {
        // macOS: ~/Movies/ultra-meet-recordings
        if let Some(movies_dir) = dirs::video_dir() {
            movies_dir.join(NEW_FOLDER_NAME)
        } else {
            // Fallback to Documents if Movies folder is not available
            dirs::document_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(NEW_FOLDER_NAME)
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        // Linux/Others: ~/Documents/ultra-meet-recordings
        dirs::document_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(NEW_FOLDER_NAME)
    }
}

fn is_legacy_folder_path(path: &PathBuf) -> bool {
    let file_name_match = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| LEGACY_FOLDER_NAMES.contains(&name))
        .unwrap_or(false);
    if file_name_match {
        return true;
    }
    let path_str = path.to_string_lossy();
    LEGACY_FOLDER_NAMES.iter().any(|legacy| path_str.ends_with(legacy))
}

fn migrate_folder_name_if_needed(path: &mut PathBuf) -> Result<bool> {
    if !is_legacy_folder_path(path) {
        return Ok(false);
    }

    let old_path = path.clone();
    let new_path = old_path.with_file_name(NEW_FOLDER_NAME);
    let old_exists = old_path.exists();
    let new_exists = new_path.exists();

    if old_exists && new_exists {
        warn!(
            "Both legacy and new recording folders exist, keeping existing preference on old path: old={:?}, new={:?}",
            old_path, new_path
        );
        return Ok(false);
    }

    if old_exists && !new_exists {
        match std::fs::rename(&old_path, &new_path) {
            Ok(()) => {
                *path = new_path;
                return Ok(true);
            }
            Err(error) => {
                warn!(
                    "Failed to rename legacy recording folder from {:?} to {:?}: {}. Leaving existing path unchanged to avoid data loss",
                    old_path, new_path, error
                );
                return Ok(false);
            }
        }
    }

    if new_exists && !old_exists {
        *path = new_path;
        return Ok(true);
    }

    *path = new_path;
    Ok(true)
}

/// Ensure the recordings directory exists
pub fn ensure_recordings_directory(path: &PathBuf) -> Result<()> {
    if !path.exists() {
        std::fs::create_dir_all(path)?;
        info!("Created recordings directory: {:?}", path);
    }
    Ok(())
}

/// Generate a unique filename for a recording
pub fn generate_recording_filename(format: &str) -> String {
    let now = chrono::Utc::now();
    let timestamp = now.format("%Y%m%d_%H%M%S");
    format!("recording_{}.{}", timestamp, format)
}

fn is_empty_path(path: &PathBuf) -> bool {
    path.as_os_str().is_empty()
}

fn normalize_recording_preferences(
    mut preferences: RecordingPreferences,
    raw_value: Option<&Value>,
) -> (RecordingPreferences, bool) {
    let notes_missing = raw_value
        .map(|value| value.get("notes_folder").is_none())
        .unwrap_or(false);
    let sync_missing = raw_value
        .map(|value| value.get("sync_folders").is_none())
        .unwrap_or(false);
    let meeting_detection_missing = raw_value
        .map(|value| value.get("meeting_app_detection_enabled").is_none())
        .unwrap_or(false);

    let mut changed = false;

    if notes_missing || is_empty_path(&preferences.notes_folder) {
        preferences.notes_folder = preferences.save_folder.clone();
        changed = true;
    }

    if preferences.sync_folders && preferences.notes_folder != preferences.save_folder {
        preferences.notes_folder = preferences.save_folder.clone();
        changed = true;
    }

    if notes_missing || sync_missing {
        preferences.sync_folders = true;
        preferences.notes_folder = preferences.save_folder.clone();
        changed = true;
    }

    if meeting_detection_missing {
        preferences.meeting_app_detection_enabled = true;
        changed = true;
    }

    (preferences, changed)
}

pub async fn update_meeting_app_detection_preference<R: Runtime>(
    app: &AppHandle<R>,
    enabled: bool,
) -> Result<RecordingPreferences> {
    let mut preferences = load_recording_preferences(app).await?;
    preferences.meeting_app_detection_enabled = enabled;
    save_recording_preferences(app, &preferences)?;
    Ok(preferences)
}

fn save_locations_from_preferences(preferences: &RecordingPreferences) -> SaveLocations {
    let effective_notes_folder = if preferences.sync_folders {
        preferences.save_folder.clone()
    } else {
        preferences.notes_folder.clone()
    };

    SaveLocations {
        recordings_folder: preferences.save_folder.to_string_lossy().to_string(),
        notes_folder: effective_notes_folder.to_string_lossy().to_string(),
        sync_folders: preferences.sync_folders,
    }
}

fn ensure_folder_exists(path: &PathBuf) -> Result<()> {
    if !path.exists() {
        std::fs::create_dir_all(path)?;
        info!("Created directory: {:?}", path);
    }

    Ok(())
}

/// Load recording preferences from store
pub async fn load_recording_preferences<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<RecordingPreferences> {
    // Try to load from Tauri store
    let store = match app.store("recording_preferences.json") {
        Ok(store) => store,
        Err(e) => {
            warn!("Failed to access store: {}, using defaults", e);
            return Ok(RecordingPreferences::default());
        }
    };

    // Try to get the preferences from store
    let (mut prefs, mut needs_persist) = if let Some(value) = store.get("preferences") {
        match serde_json::from_value::<RecordingPreferences>(value.clone()) {
            Ok(mut p) => {
                info!("Loaded recording preferences from store");
                // Update macOS backend to current value if needed
                #[cfg(target_os = "macos")]
                {
                    let backend = crate::audio::capture::get_current_backend();
                    p.system_audio_backend = Some(backend.to_string());
                }
                normalize_recording_preferences(p, Some(&value))
            }
            Err(e) => {
                warn!("Failed to deserialize preferences: {}, using defaults", e);
                (RecordingPreferences::default(), false)
            }
        }
    } else {
        info!("No stored preferences found, using defaults");
        (RecordingPreferences::default(), false)
    };

    let previous_save_folder = prefs.save_folder.clone();
    if migrate_folder_name_if_needed(&mut prefs.save_folder)? {
        tracing::info!(
            "Migrated recordings folder from {} to {}",
            previous_save_folder.display(),
            prefs.save_folder.display()
        );
        needs_persist = true;
    }

    let previous_notes_folder = prefs.notes_folder.clone();
    if migrate_folder_name_if_needed(&mut prefs.notes_folder)? {
        tracing::info!(
            "Migrated notes folder from {} to {}",
            previous_notes_folder.display(),
            prefs.notes_folder.display()
        );
        needs_persist = true;
    }

    let (normalized_prefs, normalized_changed) = normalize_recording_preferences(prefs, None);
    let prefs = normalized_prefs;
    needs_persist |= normalized_changed;

    if needs_persist {
        info!(
            "Persisting migrated recording preferences: save_folder={:?}, notes_folder={:?}, sync_folders={}",
            prefs.save_folder, prefs.notes_folder, prefs.sync_folders
        );
        save_recording_preferences(app, &prefs)?;
    }

    info!("Loaded recording preferences: save_folder={:?}, notes_folder={:?}, sync_folders={}, auto_save={}, format={}, mic={:?}, system={:?}",
          prefs.save_folder, prefs.notes_folder, prefs.sync_folders, prefs.auto_save, prefs.file_format,
          prefs.preferred_mic_device, prefs.preferred_system_device);
    Ok(prefs)
}

/// Save recording preferences to store
pub fn save_recording_preferences<R: Runtime>(
    app: &AppHandle<R>,
    preferences: &RecordingPreferences,
) -> Result<()> {
    let (preferences, _) = normalize_recording_preferences(preferences.clone(), None);

    info!("Saving recording preferences: save_folder={:?}, notes_folder={:?}, sync_folders={}, auto_save={}, format={}, mic={:?}, system={:?}",
          preferences.save_folder, preferences.notes_folder, preferences.sync_folders, preferences.auto_save, preferences.file_format,
          preferences.preferred_mic_device, preferences.preferred_system_device);

    // Get or create store
    let store = app
        .store("recording_preferences.json")
        .map_err(|e| anyhow::anyhow!("Failed to access store: {}", e))?;

    // Serialize preferences to JSON value
    let prefs_value = serde_json::to_value(&preferences)
        .map_err(|e| anyhow::anyhow!("Failed to serialize preferences: {}", e))?;

    // Save to store
    store.set("preferences", prefs_value);

    // Persist to disk
    store
        .save()
        .map_err(|e| anyhow::anyhow!("Failed to save store to disk: {}", e))?;

    info!("Successfully persisted recording preferences to disk");

    // Save backend preference to global config
    #[cfg(target_os = "macos")]
    if let Some(backend_str) = &preferences.system_audio_backend {
        if let Some(backend) = AudioCaptureBackend::from_string(backend_str) {
            info!("Setting audio capture backend to: {:?}", backend);
            crate::audio::capture::set_current_backend(backend);
        }
    }

    // Ensure the directory exists
    ensure_folder_exists(&preferences.save_folder)?;

    if preferences.notes_folder != preferences.save_folder {
        ensure_folder_exists(&preferences.notes_folder)?;
    }

    Ok(())
}

/// Tauri commands for recording preferences
#[tauri::command]
pub async fn get_recording_preferences<R: Runtime>(
    app: AppHandle<R>,
) -> Result<RecordingPreferences, String> {
    load_recording_preferences(&app)
        .await
        .map_err(|e| format!("Failed to load recording preferences: {}", e))
}

#[tauri::command]
pub async fn set_recording_preferences<R: Runtime>(
    app: AppHandle<R>,
    preferences: RecordingPreferences,
) -> Result<(), String> {
    save_recording_preferences(&app, &preferences)
        .map_err(|e| format!("Failed to save recording preferences: {}", e))
}

#[tauri::command]
pub async fn get_save_locations<R: Runtime>(app: AppHandle<R>) -> Result<SaveLocations, String> {
    let preferences = load_recording_preferences(&app)
        .await
        .map_err(|e| format!("Failed to load recording preferences: {}", e))?;

    Ok(save_locations_from_preferences(&preferences))
}

#[tauri::command]
pub async fn set_recordings_folder<R: Runtime>(
    app: AppHandle<R>,
    folder: PathBuf,
) -> Result<SaveLocations, String> {
    let mut preferences = load_recording_preferences(&app)
        .await
        .map_err(|e| format!("Failed to load recording preferences: {}", e))?;

    preferences.save_folder = folder;
    if preferences.sync_folders {
        preferences.notes_folder = preferences.save_folder.clone();
    }

    save_recording_preferences(&app, &preferences)
        .map_err(|e| format!("Failed to save recording preferences: {}", e))?;

    Ok(save_locations_from_preferences(&preferences))
}

#[tauri::command]
pub async fn set_notes_folder<R: Runtime>(
    app: AppHandle<R>,
    folder: PathBuf,
) -> Result<SaveLocations, String> {
    let mut preferences = load_recording_preferences(&app)
        .await
        .map_err(|e| format!("Failed to load recording preferences: {}", e))?;

    preferences.sync_folders = false;
    preferences.notes_folder = folder;

    save_recording_preferences(&app, &preferences)
        .map_err(|e| format!("Failed to save recording preferences: {}", e))?;

    Ok(save_locations_from_preferences(&preferences))
}

#[tauri::command]
pub async fn set_sync_folders<R: Runtime>(
    app: AppHandle<R>,
    value: bool,
) -> Result<SaveLocations, String> {
    let mut preferences = load_recording_preferences(&app)
        .await
        .map_err(|e| format!("Failed to load recording preferences: {}", e))?;

    preferences.sync_folders = value;
    if value {
        preferences.notes_folder = preferences.save_folder.clone();
    }

    save_recording_preferences(&app, &preferences)
        .map_err(|e| format!("Failed to save recording preferences: {}", e))?;

    Ok(save_locations_from_preferences(&preferences))
}

#[tauri::command]
pub async fn get_default_recordings_folder_path() -> Result<String, String> {
    let path = get_default_recordings_folder();
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn open_recordings_folder<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let preferences = load_recording_preferences(&app)
        .await
        .map_err(|e| format!("Failed to load preferences: {}", e))?;

    // Ensure directory exists before trying to open it
    ensure_recordings_directory(&preferences.save_folder)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    let folder_path = preferences.save_folder.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    info!("Opened recordings folder: {}", folder_path);
    Ok(())
}

#[tauri::command]
pub async fn open_notes_folder<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let preferences = load_recording_preferences(&app)
        .await
        .map_err(|e| format!("Failed to load preferences: {}", e))?;

    let notes_folder = if preferences.sync_folders {
        preferences.save_folder
    } else {
        preferences.notes_folder
    };

    ensure_folder_exists(&notes_folder).map_err(|e| format!("Failed to create directory: {}", e))?;

    let folder_path = notes_folder.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    info!("Opened notes folder: {}", folder_path);
    Ok(())
}

#[tauri::command]
pub async fn select_recording_folder<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<String>, String> {
    info!("Opening dialog to select recording folder");

    let current_folder = load_recording_preferences(&app)
        .await
        .ok()
        .map(|preferences| preferences.save_folder);

    let mut dialog = app.dialog().file().set_title("Select recording folder");

    if let Some(path) = current_folder {
        dialog = dialog.set_directory(path);
    }

    if let Some(path) = dialog.blocking_pick_folder() {
        let path_str = path.to_string();
        info!("User selected recording folder: {}", path_str);
        Ok(Some(path_str))
    } else {
        info!("User cancelled recording folder selection");
        Ok(None)
    }
}

#[tauri::command]
pub async fn select_notes_folder<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    info!("Opening dialog to select notes folder");

    let current_folder = load_recording_preferences(&app)
        .await
        .ok()
        .map(|preferences| {
            if preferences.sync_folders {
                preferences.save_folder
            } else {
                preferences.notes_folder
            }
        });

    let mut dialog = app.dialog().file().set_title("Select notes and transcripts folder");

    if let Some(path) = current_folder {
        dialog = dialog.set_directory(path);
    }

    if let Some(path) = dialog.blocking_pick_folder() {
        let path_str = path.to_string();
        info!("User selected notes folder: {}", path_str);
        Ok(Some(path_str))
    } else {
        info!("User cancelled notes folder selection");
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::{migrate_folder_name_if_needed, normalize_recording_preferences, RecordingPreferences};
    use serde_json::json;
    use std::{fs, path::PathBuf};
    use tempfile::tempdir;

    fn build_preferences(save_folder: &str, notes_folder: &str, sync_folders: bool) -> RecordingPreferences {
        RecordingPreferences {
            save_folder: PathBuf::from(save_folder),
            notes_folder: PathBuf::from(notes_folder),
            sync_folders,
            auto_save: true,
            file_format: "mp4".to_string(),
            preferred_mic_device: None,
            preferred_system_device: None,
            meeting_app_detection_enabled: true,
            hf_token: None,
            #[cfg(target_os = "macos")]
            system_audio_backend: Some("coreaudio".to_string()),
        }
    }

    #[test]
    fn migrates_legacy_preferences_without_notes_folder() {
        let raw = json!({
            "save_folder": "/tmp/ultra-meet-recordings/custom",
            "auto_save": true,
            "file_format": "mp4",
            "preferred_mic_device": null,
            "preferred_system_device": null
        });

        let preferences: RecordingPreferences = serde_json::from_value(raw.clone())
            .expect("legacy preferences should deserialize with defaults");
        let (normalized, changed) = normalize_recording_preferences(preferences, Some(&raw));

        assert!(changed);
        assert_eq!(normalized.notes_folder, normalized.save_folder);
        assert!(normalized.sync_folders);
        assert!(normalized.meeting_app_detection_enabled);
    }

    #[test]
    fn enabling_sync_resets_notes_folder_to_recordings_folder() {
        let preferences = build_preferences(
            "/tmp/ultra-meet-recordings/recordings",
            "/tmp/ultra-meet-notes/notes",
            true,
        );

        let (normalized, changed) = normalize_recording_preferences(preferences, None);

        assert!(changed);
        assert_eq!(normalized.notes_folder, normalized.save_folder);
        assert!(normalized.sync_folders);
    }

    #[test]
    fn migrates_legacy_folder_name_and_preserves_files() {
        let temp_dir = tempdir().expect("temp dir should be created");
        let old_folder = temp_dir.path().join("meetily-recordings");
        let new_folder = temp_dir.path().join("ultra-meet-recordings");
        let sample_file = old_folder.join("sample.txt");

        fs::create_dir_all(&old_folder).expect("old folder should be created");
        fs::write(&sample_file, "test payload").expect("sample file should be created");

        let mut preference_path = old_folder.clone();
        let migrated = migrate_folder_name_if_needed(&mut preference_path)
            .expect("migration should succeed");

        assert!(migrated);
        assert_eq!(preference_path, new_folder);
        assert!(!old_folder.exists());
        assert!(new_folder.exists());
        assert_eq!(
            fs::read_to_string(new_folder.join("sample.txt")).expect("sample file should move"),
            "test payload"
        );
    }
}

// Backend selection commands

/// Get available audio capture backends for the current platform
#[tauri::command]
pub async fn get_available_audio_backends() -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let backends = crate::audio::capture::get_available_backends();
        Ok(backends.iter().map(|b| b.to_string()).collect())
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Only ScreenCaptureKit available on non-macOS
        Ok(vec!["screencapturekit".to_string()])
    }
}

/// Get current audio capture backend
#[tauri::command]
pub async fn get_current_audio_backend() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let backend = crate::audio::capture::get_current_backend();
        Ok(backend.to_string())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok("screencapturekit".to_string())
    }
}

/// Set audio capture backend
#[tauri::command]
pub async fn set_audio_backend(backend: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use crate::audio::capture::AudioCaptureBackend;
        use crate::audio::permissions::{
            check_screen_recording_permission, request_screen_recording_permission,
        };

        let backend_enum = AudioCaptureBackend::from_string(&backend)
            .ok_or_else(|| format!("Invalid backend: {}", backend))?;

        // If switching to Core Audio, log information about Audio Capture permission
        if backend_enum == AudioCaptureBackend::CoreAudio {
            info!("🔐 Core Audio backend requires Audio Capture permission (macOS 14.4+)");
            info!("📍 Permission dialog will appear automatically when recording starts");

            // Check if permission is already granted (this is informational only)
            if !check_screen_recording_permission() {
                warn!("⚠️  Audio Capture permission may not be granted");

                // Attempt to open System Settings (opens System Settings)
                if let Err(e) = request_screen_recording_permission() {
                    error!("Failed to open System Settings: {}", e);
                }

                return Err(
                    "Core Audio requires Audio Capture permission. \
                    The permission dialog will appear when you start recording. \
                    If already denied, enable it in System Settings → Privacy & Security → Audio Capture, \
                    then restart the app.".to_string()
                );
            }

            info!(
                "✅ Core Audio backend selected - permission check will occur at recording start"
            );
        }

        info!("Setting audio backend to: {:?}", backend_enum);
        crate::audio::capture::set_current_backend(backend_enum);
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        if backend != "screencapturekit" {
            return Err(format!(
                "Backend {} not available on this platform",
                backend
            ));
        }
        Ok(())
    }
}

/// Get backend information (name and description)
#[derive(Serialize)]
pub struct BackendInfo {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[tauri::command]
pub async fn get_audio_backend_info() -> Result<Vec<BackendInfo>, String> {
    #[cfg(target_os = "macos")]
    {
        use crate::audio::capture::AudioCaptureBackend;

        let backends = vec![
            BackendInfo {
                id: AudioCaptureBackend::ScreenCaptureKit.to_string(),
                name: AudioCaptureBackend::ScreenCaptureKit.name().to_string(),
                description: AudioCaptureBackend::ScreenCaptureKit
                    .description()
                    .to_string(),
            },
            BackendInfo {
                id: AudioCaptureBackend::CoreAudio.to_string(),
                name: AudioCaptureBackend::CoreAudio.name().to_string(),
                description: AudioCaptureBackend::CoreAudio.description().to_string(),
            },
        ];
        Ok(backends)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(vec![BackendInfo {
            id: "screencapturekit".to_string(),
            name: "ScreenCaptureKit".to_string(),
            description: "Default system audio capture".to_string(),
        }])
    }
}
