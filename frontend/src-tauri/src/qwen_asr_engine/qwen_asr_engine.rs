use crate::qwen_asr_engine::model::QwenAsrModel;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::fs;
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::sync::RwLock;
use tokio::time::timeout;

/// Quantization type for Qwen ASR models (GGUF)
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum QuantizationType {
    F16,  // Half precision
    Q8_0, // 8-bit quantization (recommended)
}

impl Default for QuantizationType {
    fn default() -> Self {
        QuantizationType::Q8_0
    }
}

/// Model status for Qwen ASR models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ModelStatus {
    Available,
    Missing,
    Downloading { progress: u8 },
    Error(String),
    Corrupted { file_size: u64, expected_min_size: u64 },
}

/// Detailed download progress info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub downloaded_mb: f64,
    pub total_mb: f64,
    pub speed_mbps: f64,
    pub percent: u8,
}

impl DownloadProgress {
    pub fn new(downloaded: u64, total: u64, speed_mbps: f64) -> Self {
        let percent = if total > 0 {
            ((downloaded as f64 / total as f64) * 100.0).min(100.0) as u8
        } else {
            0
        };
        Self {
            downloaded_bytes: downloaded,
            total_bytes: total,
            downloaded_mb: downloaded as f64 / (1024.0 * 1024.0),
            total_mb: total as f64 / (1024.0 * 1024.0),
            speed_mbps,
            percent,
        }
    }
}

/// Information about a Qwen ASR model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub path: PathBuf,
    pub size_mb: u32,
    pub quantization: QuantizationType,
    pub speed: String,
    pub status: ModelStatus,
    pub description: String,
}

#[derive(Debug)]
pub enum QwenAsrEngineError {
    ModelNotLoaded,
    ModelNotFound(String),
    TranscriptionFailed(String),
    DownloadFailed(String),
    IoError(std::io::Error),
    Other(String),
}

impl std::fmt::Display for QwenAsrEngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            QwenAsrEngineError::ModelNotLoaded => write!(f, "No Qwen ASR model loaded"),
            QwenAsrEngineError::ModelNotFound(name) => write!(f, "Model '{}' not found", name),
            QwenAsrEngineError::TranscriptionFailed(err) => write!(f, "Transcription failed: {}", err),
            QwenAsrEngineError::DownloadFailed(err) => write!(f, "Download failed: {}", err),
            QwenAsrEngineError::IoError(err) => write!(f, "IO error: {}", err),
            QwenAsrEngineError::Other(err) => write!(f, "Error: {}", err),
        }
    }
}

impl std::error::Error for QwenAsrEngineError {}

impl From<std::io::Error> for QwenAsrEngineError {
    fn from(err: std::io::Error) -> Self {
        QwenAsrEngineError::IoError(err)
    }
}

#[derive(Debug, Clone, Copy)]
struct ModelConfig {
    name: &'static str,
    filename: &'static str,
    size_mb: u32,
    quantization: QuantizationType,
    speed: &'static str,
    description: &'static str,
    huggingface_repo: &'static str,
}

const MODEL_CONFIGS: [ModelConfig; 4] = [
    ModelConfig {
        name: "qwen3-asr-1.7b-q8_0",
        filename: "qwen3-asr-1.7b-q8_0.gguf",
        size_mb: 3000,
        quantization: QuantizationType::Q8_0,
        speed: "Recommended (Q8)",
        description: "1.7B multilingual model, best quality/speed balance",
        huggingface_repo: "FlippyDora/qwen3-asr-1.7b-GGUF",
    },
    ModelConfig {
        name: "qwen3-asr-1.7b-f16",
        filename: "qwen3-asr-1.7b-f16.gguf",
        size_mb: 4200,
        quantization: QuantizationType::F16,
        speed: "Best Quality (F16)",
        description: "1.7B multilingual model, highest accuracy",
        huggingface_repo: "FlippyDora/qwen3-asr-1.7b-GGUF",
    },
    ModelConfig {
        name: "qwen3-asr-0.6b-q8_0",
        filename: "qwen3-asr-0.6b-q8_0.gguf",
        size_mb: 1350,
        quantization: QuantizationType::Q8_0,
        speed: "Fast (Q8)",
        description: "0.6B multilingual model, best speed/quality balance",
        huggingface_repo: "FlippyDora/qwen3-asr-0.6b-GGUF",
    },
    ModelConfig {
        name: "qwen3-asr-0.6b-f16",
        filename: "qwen3-asr-0.6b-f16.gguf",
        size_mb: 1880,
        quantization: QuantizationType::F16,
        speed: "Accurate (F16)",
        description: "0.6B multilingual model, higher accuracy",
        huggingface_repo: "FlippyDora/qwen3-asr-0.6b-GGUF",
    },
];

pub struct QwenAsrEngine {
    models_dir: PathBuf,
    current_model: Arc<RwLock<Option<QwenAsrModel>>>,
    current_model_name: Arc<RwLock<Option<String>>>,
    pub(crate) available_models: Arc<RwLock<HashMap<String, ModelInfo>>>,
    cancel_download_flag: Arc<RwLock<Option<String>>>,
    pub(crate) active_downloads: Arc<RwLock<HashSet<String>>>,
}

impl QwenAsrEngine {
    fn model_configs() -> &'static [ModelConfig] {
        &MODEL_CONFIGS
    }

    fn get_model_config(model_name: &str) -> Option<&'static ModelConfig> {
        Self::model_configs()
            .iter()
            .find(|config| config.name == model_name)
    }

    /// Create a new Qwen ASR engine with optional custom models directory
    pub fn new_with_models_dir(models_dir: Option<PathBuf>) -> Result<Self> {
        let models_dir = if let Some(dir) = models_dir {
            dir.join("qwen-asr")
        } else {
            let current_dir = std::env::current_dir()
                .map_err(|e| anyhow!("Failed to get current directory: {}", e))?;

            if cfg!(debug_assertions) {
                current_dir.join("models").join("qwen-asr")
            } else {
                dirs::data_dir()
                    .or_else(|| dirs::home_dir())
                    .ok_or_else(|| anyhow!("Could not find system data directory"))?
                    .join("tn.ashref.ultrameet")
                    .join("models")
                    .join("qwen-asr")
            }
        };

        log::info!("QwenAsrEngine using models directory: {}", models_dir.display());

        if !models_dir.exists() {
            std::fs::create_dir_all(&models_dir)?;
        }

        Ok(Self {
            models_dir,
            current_model: Arc::new(RwLock::new(None)),
            current_model_name: Arc::new(RwLock::new(None)),
            available_models: Arc::new(RwLock::new(HashMap::new())),
            cancel_download_flag: Arc::new(RwLock::new(None)),
            active_downloads: Arc::new(RwLock::new(HashSet::new())),
        })
    }

    /// Discover available Qwen ASR models (single GGUF files)
    pub async fn discover_models(&self) -> Result<Vec<ModelInfo>> {
        let models_dir = &self.models_dir;
        let mut models = Vec::new();

        let active_downloads = self.active_downloads.read().await;

        for config in Self::model_configs() {
            let model_path = models_dir.join(config.filename);

            let status = if active_downloads.contains(config.name) {
                ModelStatus::Downloading { progress: 0 }
            } else if model_path.exists() {
                match self.validate_gguf_file(&model_path).await {
                    Ok(_) => ModelStatus::Available,
                    Err(_) => {
                        log::warn!("GGUF file {} appears corrupted", config.filename);
                        let file_size = std::fs::metadata(&model_path)
                            .map(|m| m.len())
                            .unwrap_or(0);
                        ModelStatus::Corrupted {
                            file_size,
                            expected_min_size: (config.size_mb as u64) * 1024 * 1024,
                        }
                    }
                }
            } else {
                ModelStatus::Missing
            };

            let model_info = ModelInfo {
                name: config.name.to_string(),
                path: model_path,
                size_mb: config.size_mb,
                quantization: config.quantization,
                speed: config.speed.to_string(),
                status,
                description: config.description.to_string(),
            };

            models.push(model_info);
        }

        // Update internal cache
        let mut available_models = self.available_models.write().await;
        available_models.clear();
        for model in &models {
            available_models.insert(model.name.clone(), model.clone());
        }

        Ok(models)
    }

    /// Validate GGUF file by checking magic header and minimum size
    async fn validate_gguf_file(&self, file_path: &PathBuf) -> Result<()> {
        use std::io::Read;

        let metadata = std::fs::metadata(file_path)
            .map_err(|e| anyhow!("Failed to read file metadata: {}", e))?;

        // GGUF files must be at least a few KB (header + metadata)
        if metadata.len() < 1024 {
            return Err(anyhow!("File too small to be a valid GGUF: {} bytes", metadata.len()));
        }

        // Check GGUF magic header: "GGUF" = bytes [0x47, 0x47, 0x55, 0x46]
        // As little-endian u32: 0x46554747
        let mut file = std::fs::File::open(file_path)
            .map_err(|e| anyhow!("Failed to open file: {}", e))?;
        let mut magic_bytes = [0u8; 4];
        file.read_exact(&mut magic_bytes)
            .map_err(|e| anyhow!("Failed to read GGUF header: {}", e))?;

        let magic = u32::from_le_bytes(magic_bytes);
        if magic != 0x46554747 {
            return Err(anyhow!("Invalid GGUF magic header: 0x{:08X} (expected 0x46554747)", magic));
        }

        Ok(())
    }

    /// Load a Qwen ASR model
    pub async fn load_model(&self, model_name: &str) -> Result<()> {
        let model_info = {
            let models = self.available_models.read().await;
            models.get(model_name).cloned()
        };

        let model_info = model_info.ok_or_else(|| anyhow!("Model {} not found", model_name))?;

        match model_info.status {
            ModelStatus::Available => {
                // Check if already loaded
                if let Some(current_model) = self.current_model_name.read().await.as_ref() {
                    if current_model == model_name {
                        log::info!("Qwen ASR model {} is already loaded, skipping reload", model_name);
                        return Ok(());
                    }
                    log::info!("Unloading current Qwen ASR model '{}' before loading '{}'", current_model, model_name);
                    self.unload_model().await;
                }

                log::info!("Loading Qwen ASR model: {} from {}", model_name, model_info.path.display());

                let model = QwenAsrModel::new(&model_info.path)
                    .map_err(|e| anyhow!("Failed to load Qwen ASR model {}: {}", model_name, e))?;

                *self.current_model.write().await = Some(model);
                *self.current_model_name.write().await = Some(model_name.to_string());

                log::info!("Successfully loaded Qwen ASR model: {} ({:?})", model_name, model_info.quantization);
                Ok(())
            }
            ModelStatus::Missing => Err(anyhow!("Qwen ASR model {} is not downloaded", model_name)),
            ModelStatus::Downloading { .. } => Err(anyhow!("Qwen ASR model {} is currently downloading", model_name)),
            ModelStatus::Error(ref err) => Err(anyhow!("Qwen ASR model {} has error: {}", model_name, err)),
            ModelStatus::Corrupted { .. } => Err(anyhow!("Qwen ASR model {} is corrupted", model_name)),
        }
    }

    /// Unload the current model
    pub async fn unload_model(&self) -> bool {
        let mut model_guard = self.current_model.write().await;
        let unloaded = model_guard.take().is_some();
        if unloaded {
            log::info!("Qwen ASR model unloaded");
        }
        let mut model_name_guard = self.current_model_name.write().await;
        model_name_guard.take();
        unloaded
    }

    /// Get the currently loaded model name
    pub async fn get_current_model(&self) -> Option<String> {
        self.current_model_name.read().await.clone()
    }

    /// Check if a model is loaded
    pub async fn is_model_loaded(&self) -> bool {
        self.current_model.read().await.is_some()
    }

    /// Transcribe audio samples using the loaded model (batch mode)
    pub async fn transcribe_audio(&self, audio_data: Vec<f32>) -> Result<String> {
        let mut model_guard = self.current_model.write().await;
        let model = model_guard
            .as_mut()
            .ok_or_else(|| anyhow!("No Qwen ASR model loaded. Please load a model first."))?;

        let duration_seconds = audio_data.len() as f64 / 16000.0;
        log::debug!(
            "Qwen ASR transcribing {} samples ({:.1}s duration)",
            audio_data.len(),
            duration_seconds
        );

        let result = model
            .transcribe(&audio_data)
            .map_err(|e| anyhow!("Qwen ASR transcription failed: {}", e))?;

        log::debug!("Qwen ASR transcription result: '{}'", result);
        Ok(result)
    }

    /// Transcribe audio with streaming token output
    pub async fn transcribe_audio_streaming<F>(
        &self,
        audio_data: Vec<f32>,
        on_token: F,
    ) -> Result<String>
    where
        F: FnMut(&str) -> bool + Send,
    {
        let mut model_guard = self.current_model.write().await;
        let model = model_guard
            .as_mut()
            .ok_or_else(|| anyhow!("No Qwen ASR model loaded."))?;

        let result = model
            .transcribe_streaming(&audio_data, on_token)
            .map_err(|e| anyhow!("Qwen ASR streaming transcription failed: {}", e))?;

        Ok(result)
    }

    /// Get the models directory path
    pub async fn get_models_directory(&self) -> PathBuf {
        self.models_dir.clone()
    }

    /// Delete a model file
    pub async fn delete_model(&self, model_name: &str) -> Result<String> {
        log::info!("Attempting to delete Qwen ASR model: {}", model_name);

        let model_info = {
            let models = self.available_models.read().await;
            models.get(model_name).cloned()
        };

        let model_info = model_info.ok_or_else(|| anyhow!("Model '{}' not found", model_name))?;

        match &model_info.status {
            ModelStatus::Corrupted { .. } | ModelStatus::Available => {
                if model_info.path.exists() {
                    fs::remove_file(&model_info.path).await
                        .map_err(|e| anyhow!("Failed to delete '{}': {}", model_info.path.display(), e))?;
                    log::info!("Successfully deleted Qwen ASR model file: {}", model_info.path.display());
                }

                {
                    let mut models = self.available_models.write().await;
                    if let Some(model) = models.get_mut(model_name) {
                        model.status = ModelStatus::Missing;
                    }
                }

                Ok(format!("Successfully deleted Qwen ASR model '{}'", model_name))
            }
            _ => Err(anyhow!(
                "Can only delete corrupted or available models. Model '{}' has status: {:?}",
                model_name, model_info.status
            )),
        }
    }

    /// Download a Qwen ASR model with detailed progress
    pub async fn download_model_detailed(
        &self,
        model_name: &str,
        progress_callback: Option<Box<dyn Fn(DownloadProgress) + Send>>,
    ) -> Result<()> {
        log::info!("Starting download for Qwen ASR model: {}", model_name);

        // Check for concurrent downloads
        {
            let active = self.active_downloads.read().await;
            if active.contains(model_name) {
                return Err(anyhow!("Download already in progress for: {}", model_name));
            }
        }

        // Mark as active
        {
            let mut active = self.active_downloads.write().await;
            active.insert(model_name.to_string());
        }

        // Clear previous cancellation flag
        {
            let mut cancel_flag = self.cancel_download_flag.write().await;
            *cancel_flag = None;
        }

        let model_info = {
            let models = self.available_models.read().await;
            match models.get(model_name).cloned() {
                Some(info) => info,
                None => {
                    let mut active = self.active_downloads.write().await;
                    active.remove(model_name);
                    return Err(anyhow!("Model {} not found", model_name));
                }
            }
        };

        // Update status to downloading
        {
            let mut models = self.available_models.write().await;
            if let Some(model) = models.get_mut(model_name) {
                model.status = ModelStatus::Downloading { progress: 0 };
            }
        }

        let model_config = match Self::get_model_config(model_name) {
            Some(config) => config,
            None => {
                let mut active = self.active_downloads.write().await;
                active.remove(model_name);
                return Err(anyhow!("Unsupported model: {}", model_name));
            }
        };

        // HuggingFace URL for Qwen3-ASR GGUF models
        let download_url = format!(
            "https://huggingface.co/{}/resolve/main/{}",
            model_config.huggingface_repo,
            model_config.filename
        );

        let file_path = self.models_dir.join(model_config.filename);

        // Create models directory if needed
        if !self.models_dir.exists() {
            fs::create_dir_all(&self.models_dir).await
                .map_err(|e| {
                    let mut active_guard = self.active_downloads.try_write();
                    if let Ok(ref mut active) = active_guard {
                        active.remove(model_name);
                    }
                    anyhow!("Failed to create models directory: {}", e)
                })?;
        }

        // Check for existing partial file
        let existing_size: u64 = if file_path.exists() {
            fs::metadata(&file_path).await.map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };

        let expected_size = (model_info.size_mb as u64) * 1024 * 1024;

        // Skip if already downloaded (within 1% tolerance)
        if existing_size > 0 && existing_size >= (expected_size as f64 * 0.99) as u64 {
            // Validate the file
            if self.validate_gguf_file(&file_path).await.is_ok() {
                log::info!("Model {} already downloaded and valid", model_name);
                {
                    let mut models = self.available_models.write().await;
                    if let Some(model) = models.get_mut(model_name) {
                        model.status = ModelStatus::Available;
                    }
                }
                {
                    let mut active = self.active_downloads.write().await;
                    active.remove(model_name);
                }
                return Ok(());
            }
        }

        // HTTP client for download
        let client = reqwest::Client::builder()
            .tcp_nodelay(true)
            .pool_max_idle_per_host(1)
            .timeout(Duration::from_secs(3600))
            .connect_timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| anyhow!("Failed to create HTTP client: {}", e))?;

        // Build request with optional Range header for resume
        let mut request = client.get(&download_url);
        if existing_size > 0 {
            request = request.header("Range", format!("bytes={}-", existing_size));
            log::info!("Resuming download from byte {}", existing_size);
        }

        let response = request.send().await
            .map_err(|e| {
                let mut active = self.active_downloads.try_write();
                if let Ok(ref mut active) = active {
                    active.remove(model_name);
                }
                anyhow!("Failed to start download: {}", e)
            })?;

        let (total_size, resuming) = if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
            let remaining = response.content_length().unwrap_or(0);
            (existing_size + remaining, true)
        } else if response.status().is_success() {
            (response.content_length().unwrap_or(expected_size), false)
        } else {
            let mut active = self.active_downloads.write().await;
            active.remove(model_name);
            return Err(anyhow!("Download failed with status: {}", response.status()));
        };

        // Open file
        let file = if resuming {
            fs::OpenOptions::new()
                .append(true)
                .open(&file_path)
                .await
                .map_err(|e| anyhow!("Failed to open file for resume: {}", e))?
        } else {
            fs::File::create(&file_path)
                .await
                .map_err(|e| anyhow!("Failed to create file: {}", e))?
        };

        let mut writer = BufWriter::with_capacity(8 * 1024 * 1024, file);

        // Stream download
        use futures_util::StreamExt;
        let mut stream = response.bytes_stream();
        let mut downloaded = if resuming { existing_size } else { 0u64 };
        let download_start = Instant::now();
        let mut last_report_time = Instant::now();
        let mut bytes_since_last_report: u64 = 0;
        let mut last_reported_progress: u8 = 0;

        loop {
            // Check cancellation
            {
                let cancel_flag = self.cancel_download_flag.read().await;
                if cancel_flag.as_ref() == Some(&model_name.to_string()) {
                    log::info!("Download cancelled for {}", model_name);
                    let _ = writer.flush().await;
                    let mut active = self.active_downloads.write().await;
                    active.remove(model_name);
                    return Err(anyhow!("Download cancelled by user"));
                }
            }

            let next_result = timeout(Duration::from_secs(30), stream.next()).await;

            let chunk = match next_result {
                Err(_) => {
                    let _ = writer.flush().await;
                    {
                        let mut active = self.active_downloads.write().await;
                        active.remove(model_name);
                    }
                    {
                        let mut models = self.available_models.write().await;
                        if let Some(model) = models.get_mut(model_name) {
                            model.status = ModelStatus::Missing;
                        }
                    }
                    return Err(anyhow!("Download timeout - no data for 30 seconds"));
                }
                Ok(None) => break,
                Ok(Some(chunk_result)) => {
                    match chunk_result {
                        Ok(c) => c,
                        Err(e) => {
                            let _ = writer.flush().await;
                            {
                                let mut active = self.active_downloads.write().await;
                                active.remove(model_name);
                            }
                            {
                                let mut models = self.available_models.write().await;
                                if let Some(model) = models.get_mut(model_name) {
                                    model.status = ModelStatus::Missing;
                                }
                            }
                            return Err(anyhow!("Download error: {}", e));
                        }
                    }
                }
            };

            if let Err(e) = writer.write_all(&chunk).await {
                {
                    let mut active = self.active_downloads.write().await;
                    active.remove(model_name);
                }
                return Err(anyhow!("Failed to write chunk: {}", e));
            }

            let chunk_len = chunk.len() as u64;
            downloaded += chunk_len;
            bytes_since_last_report += chunk_len;

            let overall_progress = if total_size > 0 {
                ((downloaded as f64 / total_size as f64) * 100.0).min(99.0) as u8
            } else {
                0
            };

            let elapsed_since_report = last_report_time.elapsed();
            let progress_changed = overall_progress > last_reported_progress;
            let time_threshold = elapsed_since_report >= Duration::from_millis(500);

            if progress_changed || time_threshold {
                let speed_mbps = if elapsed_since_report.as_secs_f64() >= 0.1 {
                    (bytes_since_last_report as f64 / (1024.0 * 1024.0)) / elapsed_since_report.as_secs_f64()
                } else {
                    let total_elapsed = download_start.elapsed().as_secs_f64();
                    if total_elapsed > 0.0 {
                        (downloaded as f64 / (1024.0 * 1024.0)) / total_elapsed
                    } else {
                        0.0
                    }
                };

                last_reported_progress = overall_progress;
                last_report_time = Instant::now();
                bytes_since_last_report = 0;

                let progress = DownloadProgress::new(downloaded, total_size, speed_mbps);
                if let Some(ref callback) = progress_callback {
                    callback(progress);
                }

                {
                    let mut models = self.available_models.write().await;
                    if let Some(model) = models.get_mut(model_name) {
                        model.status = ModelStatus::Downloading { progress: overall_progress };
                    }
                }
            }
        }

        // Flush
        if let Err(e) = writer.flush().await {
            {
                let mut active = self.active_downloads.write().await;
                active.remove(model_name);
            }
            return Err(anyhow!("Failed to flush file: {}", e));
        }

        // Report 100%
        let total_elapsed = download_start.elapsed().as_secs_f64();
        let final_speed = if total_elapsed > 0.0 {
            (downloaded as f64 / (1024.0 * 1024.0)) / total_elapsed
        } else {
            0.0
        };
        let final_progress = DownloadProgress::new(total_size, total_size, final_speed);
        if let Some(ref callback) = progress_callback {
            callback(final_progress);
        }

        // Update status
        {
            let mut models = self.available_models.write().await;
            if let Some(model) = models.get_mut(model_name) {
                model.status = ModelStatus::Available;
                model.path = file_path;
            }
        }

        {
            let mut active = self.active_downloads.write().await;
            active.remove(model_name);
        }

        {
            let mut cancel_flag = self.cancel_download_flag.write().await;
            if cancel_flag.as_ref() == Some(&model_name.to_string()) {
                *cancel_flag = None;
            }
        }

        log::info!("Download completed for Qwen ASR model: {}", model_name);
        Ok(())
    }

    /// Cancel an ongoing model download
    pub async fn cancel_download(&self, model_name: &str) -> Result<()> {
        log::info!("Cancelling download for Qwen ASR model: {}", model_name);

        {
            let mut cancel_flag = self.cancel_download_flag.write().await;
            *cancel_flag = Some(model_name.to_string());
        }

        {
            let mut active = self.active_downloads.write().await;
            active.remove(model_name);
        }

        {
            let mut models = self.available_models.write().await;
            if let Some(model) = models.get_mut(model_name) {
                model.status = ModelStatus::Missing;
            }
        }

        // Brief delay for download loop to exit
        tokio::time::sleep(Duration::from_millis(100)).await;

        // Clean up partial file
        let model_info = {
            let models = self.available_models.read().await;
            models.get(model_name).cloned()
        };

        if let Some(info) = model_info {
            if info.path.exists() {
                if let Err(e) = fs::remove_file(&info.path).await {
                    log::warn!("Failed to clean up cancelled download: {}", e);
                } else {
                    log::info!("Cleaned up cancelled download: {}", info.path.display());
                }
            }
        }

        Ok(())
    }
}
