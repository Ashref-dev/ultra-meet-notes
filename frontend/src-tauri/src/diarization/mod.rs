use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

const SEGMENTATION_URL: &str =
    "https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx";
const EMBEDDING_URL: &str =
    "https://github.com/thewh1teagle/pyannote-rs/releases/download/v0.1.0/wespeaker_en_voxceleb_CAM%2B%2B.onnx";

const SEGMENTATION_BYTES: u64 = 5_992_913;
const EMBEDDING_BYTES: u64 = 29_292_684;

const SEGMENTATION_FILE: &str = "segmentation-3.0.onnx";
const EMBEDDING_FILE: &str = "wespeaker_en_voxceleb_CAM++.onnx";

#[derive(Debug, Clone, Serialize)]
pub struct ModelDownloadProgress {
    pub percent: f32,
    pub stage: String,
    pub bytes_downloaded: u64,
    pub bytes_total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiarizationSegment {
    pub start: f32,
    pub end: f32,
    pub speaker: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiarizationResult {
    pub segments: Vec<DiarizationSegment>,
    pub speaker_count: usize,
    pub duration_seconds: f32,
}

pub fn models_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let dir = base.join("diarization");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create diarization dir: {}", e))?;
    Ok(dir)
}

pub fn segmentation_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(models_dir(app)?.join(SEGMENTATION_FILE))
}

pub fn embedding_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(models_dir(app)?.join(EMBEDDING_FILE))
}

pub fn are_models_ready<R: Runtime>(app: &AppHandle<R>) -> bool {
    let seg = match segmentation_path(app) {
        Ok(p) => p,
        Err(_) => return false,
    };
    let emb = match embedding_path(app) {
        Ok(p) => p,
        Err(_) => return false,
    };
    file_matches_size(&seg, SEGMENTATION_BYTES) && file_matches_size(&emb, EMBEDDING_BYTES)
}

fn file_matches_size(path: &Path, expected: u64) -> bool {
    std::fs::metadata(path)
        .map(|m| m.len() == expected)
        .unwrap_or(false)
}

fn emit_progress<R: Runtime>(app: &AppHandle<R>, progress: ModelDownloadProgress) {
    if let Err(err) = app.emit("diarization-model-download-progress", &progress) {
        warn!("Failed to emit diarization download progress: {}", err);
    }
}

async fn download_with_progress<R: Runtime>(
    app: &AppHandle<R>,
    url: &str,
    dest: &Path,
    label: &str,
    expected_bytes: u64,
    base_percent: f32,
    span_percent: f32,
    cancel: Arc<CancellationToken>,
) -> Result<(), String> {
    if file_matches_size(dest, expected_bytes) {
        info!("Diarization model {} already cached at {}", label, dest.display());
        return Ok(());
    }

    info!("Downloading diarization model {} from {}", label, url);

    let tmp = dest.with_extension("onnx.partial");
    let _ = tokio::fs::remove_file(&tmp).await;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("HTTP client init failed: {}", e))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to reach {}: {}", url, e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed for {}: HTTP {}",
            label,
            response.status()
        ));
    }

    let total = response.content_length().unwrap_or(expected_bytes);
    let mut file = tokio::fs::File::create(&tmp)
        .await
        .map_err(|e| format!("Failed to open temp file: {}", e))?;

    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;

    while let Some(chunk_result) = stream.next().await {
        if cancel.is_cancelled() {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err("Download cancelled".to_string());
        }
        let chunk = chunk_result.map_err(|e| format!("Network error during {}: {}", label, e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Disk write failed: {}", e))?;
        downloaded += chunk.len() as u64;

        let fraction = (downloaded as f32 / total as f32).clamp(0.0, 1.0);
        let percent = base_percent + fraction * span_percent;
        emit_progress(
            app,
            ModelDownloadProgress {
                percent,
                stage: format!("downloading_{}", label),
                bytes_downloaded: downloaded,
                bytes_total: total,
            },
        );
    }

    file.flush()
        .await
        .map_err(|e| format!("Disk flush failed: {}", e))?;
    drop(file);

    if downloaded != expected_bytes {
        warn!(
            "{} download size mismatch: got {} bytes, expected {}",
            label, downloaded, expected_bytes
        );
    }

    tokio::fs::rename(&tmp, dest)
        .await
        .map_err(|e| format!("Failed to finalize model file: {}", e))?;

    info!("Diarization model {} saved at {}", label, dest.display());
    Ok(())
}

pub async fn ensure_models<R: Runtime>(
    app: &AppHandle<R>,
    cancel: Arc<CancellationToken>,
) -> Result<(), String> {
    let seg_path = segmentation_path(app)?;
    let emb_path = embedding_path(app)?;

    emit_progress(
        app,
        ModelDownloadProgress {
            percent: 2.0,
            stage: "checking_cache".to_string(),
            bytes_downloaded: 0,
            bytes_total: SEGMENTATION_BYTES + EMBEDDING_BYTES,
        },
    );

    download_with_progress(
        app,
        SEGMENTATION_URL,
        &seg_path,
        "segmentation",
        SEGMENTATION_BYTES,
        2.0,
        18.0,
        cancel.clone(),
    )
    .await?;

    download_with_progress(
        app,
        EMBEDDING_URL,
        &emb_path,
        "embedding",
        EMBEDDING_BYTES,
        20.0,
        78.0,
        cancel.clone(),
    )
    .await?;

    if let Some(hash) = compute_sha256(&seg_path) {
        info!("Segmentation SHA256: {}", hash);
    }
    if let Some(hash) = compute_sha256(&emb_path) {
        info!("Embedding SHA256: {}", hash);
    }

    emit_progress(
        app,
        ModelDownloadProgress {
            percent: 100.0,
            stage: "completed".to_string(),
            bytes_downloaded: SEGMENTATION_BYTES + EMBEDDING_BYTES,
            bytes_total: SEGMENTATION_BYTES + EMBEDDING_BYTES,
        },
    );

    Ok(())
}

fn compute_sha256(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Some(format!("{:x}", hasher.finalize()))
}

pub fn diarize_audio<R: Runtime>(
    app: &AppHandle<R>,
    audio_path: &Path,
    num_speakers_hint: Option<i32>,
) -> Result<DiarizationResult, String> {
    use crate::audio::decoder::decode_audio_file;
    use std::panic::{catch_unwind, AssertUnwindSafe};

    let seg_model = segmentation_path(app)?;
    let emb_model = embedding_path(app)?;

    if !file_matches_size(&seg_model, SEGMENTATION_BYTES)
        || !file_matches_size(&emb_model, EMBEDDING_BYTES)
    {
        return Err(
            "Diarization models are missing or incomplete. Please download them from Settings → Speaker Diarization."
                .to_string(),
        );
    }

    let audio_meta = std::fs::metadata(audio_path)
        .map_err(|e| format!("Audio file not accessible ({}): {}", audio_path.display(), e))?;
    if audio_meta.len() < 1024 {
        return Err(format!(
            "Audio file too small to diarize ({} bytes): {}",
            audio_meta.len(),
            audio_path.display()
        ));
    }

    info!("Decoding audio for diarization: {}", audio_path.display());
    let decoded = decode_audio_file(audio_path)
        .map_err(|e| format!("Failed to decode audio: {}", e))?;
    let samples = decoded.to_whisper_format();
    let duration = (samples.len() as f32) / 16000.0;

    if samples.len() < 16_000 {
        return Err(format!(
            "Audio too short for diarization ({:.2}s). Skipping.",
            duration
        ));
    }

    info!(
        "Diarizing {} samples ({:.1}s of 16kHz mono audio)",
        samples.len(),
        duration
    );

    let config = sherpa_rs::diarize::DiarizeConfig {
        num_clusters: num_speakers_hint.or(Some(0)),
        threshold: Some(0.5),
        min_duration_on: Some(0.3),
        min_duration_off: Some(0.5),
        provider: Some(default_provider()),
        debug: false,
    };

    let seg_model_clone = seg_model.clone();
    let emb_model_clone = emb_model.clone();
    let init_result = catch_unwind(AssertUnwindSafe(|| {
        sherpa_rs::diarize::Diarize::new(&seg_model_clone, &emb_model_clone, config)
    }))
    .map_err(|_| "Sherpa diarizer init panicked (likely a native ONNX Runtime issue)".to_string())?;

    let mut diarizer = init_result
        .map_err(|e| format!("Failed to init sherpa diarizer: {}", e))?;

    let compute_result = catch_unwind(AssertUnwindSafe(move || diarizer.compute(samples, None)))
        .map_err(|_| "Sherpa diarization inference panicked".to_string())?;

    let segments = compute_result
        .map_err(|e| format!("Diarization inference failed: {}", e))?;

    let mut out = Vec::with_capacity(segments.len());
    let mut max_speaker: i32 = -1;
    for s in segments {
        if s.speaker > max_speaker {
            max_speaker = s.speaker;
        }
        out.push(DiarizationSegment {
            start: s.start,
            end: s.end,
            speaker: s.speaker,
        });
    }

    let speaker_count = if max_speaker < 0 { 0 } else { (max_speaker + 1) as usize };
    info!(
        "Diarization produced {} segments across {} speakers",
        out.len(),
        speaker_count
    );

    Ok(DiarizationResult {
        segments: out,
        speaker_count,
        duration_seconds: duration,
    })
}

fn default_provider() -> String {
    "cpu".to_string()
}

pub mod commands {
    use super::*;
    use once_cell::sync::Lazy;
    use std::sync::Mutex;
    use tokio::task;

    static ACTIVE_DOWNLOAD: Lazy<Mutex<Option<Arc<CancellationToken>>>> =
        Lazy::new(|| Mutex::new(None));

    fn start_download_token() -> Arc<CancellationToken> {
        let mut guard = ACTIVE_DOWNLOAD.lock().expect("download mutex poisoned");
        if let Some(token) = guard.as_ref() {
            token.cancel();
        }
        let token = Arc::new(CancellationToken::new());
        *guard = Some(token.clone());
        token
    }

    fn clear_download_token(token: &Arc<CancellationToken>) {
        let mut guard = ACTIVE_DOWNLOAD.lock().expect("download mutex poisoned");
        if let Some(current) = guard.as_ref() {
            if Arc::ptr_eq(current, token) {
                *guard = None;
            }
        }
    }

    #[tauri::command]
    pub async fn download_diarization_models<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
        let token = start_download_token();
        let result = super::ensure_models(&app, token.clone()).await;
        clear_download_token(&token);
        if let Err(ref err) = result {
            error!("Diarization model download failed: {}", err);
        }
        result
    }

    #[tauri::command]
    pub fn cancel_diarization_download() {
        let mut guard = ACTIVE_DOWNLOAD.lock().expect("download mutex poisoned");
        if let Some(token) = guard.take() {
            token.cancel();
        }
    }

    #[tauri::command]
    pub fn diarization_models_ready<R: Runtime>(app: AppHandle<R>) -> bool {
        super::are_models_ready(&app)
    }

    fn resolve_audio_file(folder: &Path) -> Option<PathBuf> {
        for name in ["audio.mp4", "audio.wav", "audio.m4a", "audio.webm", "audio.mp3"] {
            let candidate = folder.join(name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
        None
    }

    #[tauri::command]
    pub async fn diarize_meeting<R: Runtime>(
        app: AppHandle<R>,
        audio_path: String,
        num_speakers: Option<i32>,
    ) -> Result<DiarizationResult, String> {
        let raw = PathBuf::from(&audio_path);
        let resolved = if raw.is_dir() {
            resolve_audio_file(&raw).ok_or_else(|| {
                format!(
                    "No audio file found in meeting folder: {} (expected audio.mp4 / audio.wav / audio.m4a / audio.webm / audio.mp3)",
                    raw.display()
                )
            })?
        } else if raw.is_file() {
            raw
        } else {
            return Err(format!("Path not found: {}", raw.display()));
        };

        let app_clone = app.clone();
        task::spawn_blocking(move || super::diarize_audio(&app_clone, &resolved, num_speakers))
            .await
            .map_err(|e| format!("Diarization task panicked: {}", e))?
    }

    #[derive(Debug, Serialize)]
    pub struct AutoDiarizeOutcome {
        pub started: bool,
        pub reason: Option<String>,
    }

    #[tauri::command]
    pub async fn auto_diarize_meeting<R: Runtime>(
        app: AppHandle<R>,
        meeting_id: String,
        folder_path: String,
        keep_audio: bool,
    ) -> Result<AutoDiarizeOutcome, String> {
        let folder = PathBuf::from(&folder_path);
        let audio_file = match resolve_audio_file(&folder) {
            Some(p) => p,
            None => {
                warn!("auto_diarize: no audio file in {}", folder.display());
                return Ok(AutoDiarizeOutcome {
                    started: false,
                    reason: Some(format!("No audio file found in {}", folder.display())),
                });
            }
        };

        info!(
            "auto_diarize: queued background task (meeting={}, audio={}, keep_audio={})",
            meeting_id,
            audio_file.display(),
            keep_audio
        );

        let app_clone = app.clone();
        tokio::spawn(async move {
            if let Err(err) = run_auto_diarize(app_clone.clone(), meeting_id.clone(), audio_file.clone(), keep_audio).await {
                error!("auto_diarize background task failed: {}", err);
                let payload = serde_json::json!({
                    "meeting_id": meeting_id,
                    "error": err,
                });
                let _ = app_clone.emit("diarization-failed", &payload);
            }
        });

        Ok(AutoDiarizeOutcome { started: true, reason: None })
    }

    async fn run_auto_diarize<R: Runtime>(
        app: AppHandle<R>,
        meeting_id: String,
        audio_file: PathBuf,
        keep_audio: bool,
    ) -> Result<(), String> {
        use crate::database::repositories::transcript::TranscriptsRepository;
        use crate::state::AppState;
        use tauri::Manager;

        let _ = app.emit(
            "diarization-started",
            serde_json::json!({ "meeting_id": meeting_id }),
        );

        if !super::are_models_ready(&app) {
            info!("Diarization models not ready - auto-downloading");
            let token = start_download_token();
            let download = super::ensure_models(&app, token.clone()).await;
            clear_download_token(&token);
            if let Err(err) = download {
                return Err(format!("Could not download diarization models: {}", err));
            }
        }

        let app_for_diarize = app.clone();
        let audio_for_diarize = audio_file.clone();
        let diar_result = task::spawn_blocking(move || {
            super::diarize_audio(&app_for_diarize, &audio_for_diarize, None)
        })
        .await
        .map_err(|e| format!("Diarization task join error: {}", e))??;

        let state = app.state::<AppState>();
        let pool = state.db_manager.pool().clone();
        let transcripts = TranscriptsRepository::list_by_meeting(&pool, &meeting_id)
            .await
            .map_err(|e| format!("Failed to load transcripts: {}", e))?;

        let mut updates: Vec<(String, Option<String>)> = Vec::new();
        for t in &transcripts {
            let (ts_start, ts_end) = match (t.audio_start_time, t.audio_end_time) {
                (Some(s), Some(e)) => (s as f32, e as f32),
                _ => continue,
            };
            let label = find_dominant_speaker(ts_start, ts_end, &diar_result.segments);
            updates.push((t.id.clone(), label));
        }

        let labeled = if updates.is_empty() {
            0
        } else {
            TranscriptsRepository::update_speaker_for_ids(&pool, &updates)
                .await
                .map_err(|e| format!("Failed to persist speaker labels: {}", e))?
        };

        let audio_deleted = if !keep_audio {
            match std::fs::remove_file(&audio_file) {
                Ok(_) => {
                    info!("Deleted audio file after diarization: {}", audio_file.display());
                    true
                }
                Err(err) => {
                    warn!("Could not delete audio file {}: {}", audio_file.display(), err);
                    false
                }
            }
        } else {
            false
        };

        let _ = app.emit(
            "diarization-applied",
            serde_json::json!({
                "meeting_id": meeting_id,
                "speaker_count": diar_result.speaker_count,
                "transcripts_labeled": labeled,
                "audio_deleted": audio_deleted,
            }),
        );

        Ok(())
    }

    fn find_dominant_speaker(
        ts_start: f32,
        ts_end: f32,
        diar_segments: &[super::DiarizationSegment],
    ) -> Option<String> {
        let mut per_speaker: std::collections::HashMap<i32, f32> = std::collections::HashMap::new();
        for seg in diar_segments {
            let overlap_start = seg.start.max(ts_start);
            let overlap_end = seg.end.min(ts_end);
            let overlap = (overlap_end - overlap_start).max(0.0);
            if overlap > 0.0 {
                *per_speaker.entry(seg.speaker).or_insert(0.0) += overlap;
            }
        }

        per_speaker
            .into_iter()
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(spk, _)| format!("Speaker {}", spk + 1))
    }
}
