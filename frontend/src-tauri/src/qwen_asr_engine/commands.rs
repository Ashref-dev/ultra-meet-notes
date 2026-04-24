use crate::qwen_asr_engine::{ModelInfo, ModelStatus, QwenAsrEngine, DownloadProgress};
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::Arc;
use tauri::{command, Emitter, AppHandle, Manager, Runtime};

// Global Qwen ASR engine
pub static QWEN_ASR_ENGINE: Mutex<Option<Arc<QwenAsrEngine>>> = Mutex::new(None);

// Global models directory path (set during app initialization)
static MODELS_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Initialize the models directory path using app_data_dir.
/// Should be called during app setup before qwen_asr_init.
pub fn set_models_directory<R: Runtime>(app: &AppHandle<R>) {
    let app_data_dir = app.path().app_data_dir()
        .expect("Failed to get app data dir");

    let models_dir = app_data_dir.join("models");

    if !models_dir.exists() {
        if let Err(e) = std::fs::create_dir_all(&models_dir) {
            log::error!("Failed to create models directory: {}", e);
            return;
        }
    }

    log::info!("Qwen ASR models directory set to: {}", models_dir.display());

    let mut guard = MODELS_DIR.lock().unwrap();
    *guard = Some(models_dir);
}

fn get_models_directory() -> Option<PathBuf> {
    MODELS_DIR.lock().unwrap().clone()
}

#[command]
pub async fn qwen_asr_init() -> Result<(), String> {
    log::info!("qwen_asr_init called");
    let mut guard = QWEN_ASR_ENGINE.lock().unwrap();
    if guard.is_some() {
        log::info!("qwen_asr_init: engine already initialized");
        return Ok(());
    }

    let models_dir = get_models_directory();
    log::info!("qwen_asr_init: models_dir={:?}", models_dir);
    let engine = QwenAsrEngine::new_with_models_dir(models_dir)
        .map_err(|e| format!("Failed to initialize Qwen ASR engine: {}", e))?;
    *guard = Some(Arc::new(engine));
    log::info!("qwen_asr_init: engine initialized successfully");
    Ok(())
}

#[command]
pub async fn qwen_asr_get_available_models() -> Result<Vec<ModelInfo>, String> {
    let engine = {
        let guard = QWEN_ASR_ENGINE.lock().unwrap();
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        engine
            .discover_models()
            .await
            .map_err(|e| format!("Failed to discover Qwen ASR models: {}", e))
    } else {
        Err("Qwen ASR engine not initialized".to_string())
    }
}

#[command]
pub async fn qwen_asr_load_model<R: Runtime>(
    app_handle: AppHandle<R>,
    model_name: String,
) -> Result<(), String> {
    let engine = {
        let guard = QWEN_ASR_ENGINE.lock().unwrap();
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        // Emit loading started event
        let _ = app_handle.emit(
            "qwen-asr-model-loading-started",
            serde_json::json!({ "modelName": model_name }),
        );

        let result = engine
            .load_model(&model_name)
            .await
            .map_err(|e| format!("Failed to load Qwen ASR model: {}", e));

        if result.is_ok() {
            let _ = app_handle.emit(
                "qwen-asr-model-loading-completed",
                serde_json::json!({ "modelName": model_name }),
            );
        } else if let Err(ref error) = result {
            let _ = app_handle.emit(
                "qwen-asr-model-loading-failed",
                serde_json::json!({ "modelName": model_name, "error": error }),
            );
        }

        result
    } else {
        Err("Qwen ASR engine not initialized".to_string())
    }
}

#[command]
pub async fn qwen_asr_get_current_model() -> Result<Option<String>, String> {
    let engine = {
        let guard = QWEN_ASR_ENGINE.lock().unwrap();
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        Ok(engine.get_current_model().await)
    } else {
        Err("Qwen ASR engine not initialized".to_string())
    }
}

#[command]
pub async fn qwen_asr_is_model_loaded() -> Result<bool, String> {
    let engine = {
        let guard = QWEN_ASR_ENGINE.lock().unwrap();
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        Ok(engine.is_model_loaded().await)
    } else {
        Err("Qwen ASR engine not initialized".to_string())
    }
}

#[command]
pub async fn qwen_asr_has_available_models() -> Result<bool, String> {
    let engine = {
        let guard = QWEN_ASR_ENGINE.lock().unwrap();
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        let models = engine
            .discover_models()
            .await
            .map_err(|e| format!("Failed to discover models: {}", e))?;

        for model in &models {
            log::info!("qwen_asr_has_available_models: model={}, status={:?}", model.name, model.status);
        }

        let available = models.iter().any(|m| matches!(m.status, ModelStatus::Available));
        log::info!("qwen_asr_has_available_models: returning {}", available);
        Ok(available)
    } else {
        log::warn!("qwen_asr_has_available_models: engine not initialized, returning false");
        Ok(false)
    }
}

#[command]
pub async fn qwen_asr_validate_model_ready() -> Result<String, String> {
    let engine = {
        let guard = QWEN_ASR_ENGINE.lock().unwrap();
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        if engine.is_model_loaded().await {
            if let Some(current) = engine.get_current_model().await {
                return Ok(current);
            }
        }

        let models = engine
            .discover_models()
            .await
            .map_err(|e| format!("Failed to discover models: {}", e))?;

        let available: Vec<_> = models
            .iter()
            .filter(|m| matches!(m.status, ModelStatus::Available))
            .collect();

        if available.is_empty() {
            return Err("No Qwen ASR models available. Please download a model.".to_string());
        }

        // Prefer Q8_0 for speed
        let to_load = available.iter()
            .find(|m| m.quantization == crate::qwen_asr_engine::QuantizationType::Q8_0)
            .or_else(|| available.first())
            .unwrap();

        engine
            .load_model(&to_load.name)
            .await
            .map_err(|e| format!("Failed to load model {}: {}", to_load.name, e))?;

        Ok(to_load.name.clone())
    } else {
        Err("Qwen ASR engine not initialized".to_string())
    }
}

/// Internal validation that respects user's transcript config
pub async fn qwen_asr_validate_model_ready_with_config<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<String, String> {
    let engine = {
        let guard = QWEN_ASR_ENGINE.lock().unwrap();
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        // Check if already loaded
        if engine.is_model_loaded().await {
            if let Some(current) = engine.get_current_model().await {
                log::info!("Qwen ASR model already loaded: {}", current);
                return Ok(current);
            }
        }

        // Try to load user's configured model
        let model_to_load = match crate::api::api::api_get_transcript_config(
            app.clone(),
            app.state(),
            None,
        )
        .await
        {
            Ok(Some(config)) => {
                if config.provider == "qwenAsr" && !config.model.is_empty() {
                    log::info!("Using configured Qwen ASR model: {}", config.model);
                    Some(config.model)
                } else {
                    None
                }
            }
            _ => None,
        };

        let models = engine
            .discover_models()
            .await
            .map_err(|e| format!("Failed to discover models: {}", e))?;

        let available: Vec<_> = models
            .iter()
            .filter(|m| matches!(m.status, ModelStatus::Available))
            .collect();

        if available.is_empty() {
            return Err("No Qwen ASR models available. Please download a model.".to_string());
        }

        let model_name = if let Some(configured) = model_to_load {
            if available.iter().any(|m| m.name == configured) {
                configured
            } else {
                log::warn!("Configured model '{}' not available, using fallback", configured);
                available.iter()
                    .find(|m| m.quantization == crate::qwen_asr_engine::QuantizationType::Q8_0)
                    .or_else(|| available.first())
                    .unwrap()
                    .name
                    .clone()
            }
        } else {
            available.iter()
                .find(|m| m.quantization == crate::qwen_asr_engine::QuantizationType::Q8_0)
                .or_else(|| available.first())
                .unwrap()
                .name
                .clone()
        };

        engine
            .load_model(&model_name)
            .await
            .map_err(|e| format!("Failed to load model {}: {}", model_name, e))?;

        Ok(model_name)
    } else {
        Err("Qwen ASR engine not initialized".to_string())
    }
}

#[command]
pub async fn qwen_asr_transcribe_audio(audio_data: Vec<f32>) -> Result<String, String> {
    let engine = {
        let guard = QWEN_ASR_ENGINE.lock().unwrap();
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        engine
            .transcribe_audio(audio_data)
            .await
            .map_err(|e| format!("Qwen ASR transcription failed: {}", e))
    } else {
        Err("Qwen ASR engine not initialized".to_string())
    }
}

#[command]
pub async fn qwen_asr_get_models_directory() -> Result<String, String> {
    let engine = {
        let guard = QWEN_ASR_ENGINE.lock().unwrap();
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        let path = engine.get_models_directory().await;
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Qwen ASR engine not initialized".to_string())
    }
}

#[command]
pub async fn qwen_asr_download_model<R: Runtime>(
    app_handle: AppHandle<R>,
    model_name: String,
) -> Result<(), String> {
    let engine = {
        let guard = QWEN_ASR_ENGINE.lock().unwrap();
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        let app_clone = app_handle.clone();
        let model_name_clone = model_name.clone();

        let progress_callback = Box::new(move |progress: DownloadProgress| {
            log::info!(
                "Qwen ASR download progress for {}: {:.1} MB / {:.1} MB ({:.1} MB/s) - {}%",
                model_name_clone, progress.downloaded_mb, progress.total_mb,
                progress.speed_mbps, progress.percent
            );

            let _ = app_clone.emit(
                "qwen-asr-model-download-progress",
                serde_json::json!({
                    "modelName": model_name_clone,
                    "progress": progress.percent,
                    "downloaded_bytes": progress.downloaded_bytes,
                    "total_bytes": progress.total_bytes,
                    "downloaded_mb": progress.downloaded_mb,
                    "total_mb": progress.total_mb,
                    "speed_mbps": progress.speed_mbps,
                    "status": if progress.percent == 100 { "completed" } else { "downloading" }
                }),
            );
        });

        // Ensure models are discovered before downloading
        if let Err(e) = engine.discover_models().await {
            log::warn!("Failed to discover models before download: {}", e);
        }

        let result = engine
            .download_model_detailed(&model_name, Some(progress_callback))
            .await;

        match result {
            Ok(()) => {
                let _ = app_handle.emit(
                    "qwen-asr-model-download-complete",
                    serde_json::json!({ "modelName": model_name }),
                );
                crate::tray::update_tray_menu(&app_handle);
                Ok(())
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "qwen-asr-model-download-error",
                    serde_json::json!({
                        "modelName": model_name,
                        "error": e.to_string()
                    }),
                );
                Err(format!("Failed to download Qwen ASR model: {}", e))
            }
        }
    } else {
        Err("Qwen ASR engine not initialized".to_string())
    }
}

#[command]
pub async fn qwen_asr_cancel_download<R: Runtime>(
    app_handle: AppHandle<R>,
    model_name: String,
) -> Result<(), String> {
    let engine = {
        let guard = QWEN_ASR_ENGINE.lock().unwrap();
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        engine
            .cancel_download(&model_name)
            .await
            .map_err(|e| format!("Failed to cancel download: {}", e))?;

        let _ = app_handle.emit(
            "qwen-asr-model-download-progress",
            serde_json::json!({
                "modelName": model_name,
                "progress": 0,
                "status": "cancelled"
            }),
        );

        log::info!("Qwen ASR download cancelled: {}", model_name);
        Ok(())
    } else {
        Err("Qwen ASR engine not initialized".to_string())
    }
}

#[command]
pub async fn qwen_asr_delete_model(model_name: String) -> Result<String, String> {
    let engine = {
        let guard = QWEN_ASR_ENGINE.lock().unwrap();
        guard.as_ref().cloned()
    };

    if let Some(engine) = engine {
        engine
            .delete_model(&model_name)
            .await
            .map_err(|e| format!("Failed to delete model: {}", e))
    } else {
        Err("Qwen ASR engine not initialized".to_string())
    }
}

#[command]
pub async fn qwen_asr_open_models_folder() -> Result<(), String> {
    let models_dir = get_models_directory()
        .ok_or_else(|| "Qwen ASR models directory not initialized".to_string())?
        .join("qwen-asr");

    if !models_dir.exists() {
        std::fs::create_dir_all(&models_dir)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let folder_path = models_dir.to_string_lossy().to_string();

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

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    log::info!("Opened Qwen ASR models folder: {}", folder_path);
    Ok(())
}
