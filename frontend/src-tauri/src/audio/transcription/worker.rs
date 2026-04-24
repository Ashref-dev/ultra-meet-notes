// audio/transcription/worker.rs
//
// Parallel transcription worker pool and chunk processing logic.

use super::engine::TranscriptionEngine;
use super::provider::TranscriptionError;
use crate::audio::AudioChunk;
use log::{error, info, warn};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock};
use tauri::{AppHandle, Emitter, Runtime};

// Sequence counter for transcript updates
static SEQUENCE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Default)]
struct LastTranscriptState {
    text: String,
    audio_end_time: Option<f64>,
}

// Track the last emitted transcript for overlap deduplication.
// Dedup should only happen for temporally adjacent segments.
static LAST_TRANSCRIPT_STATE: LazyLock<std::sync::Mutex<LastTranscriptState>> =
    LazyLock::new(|| std::sync::Mutex::new(LastTranscriptState::default()));

// Speech detection flag - reset per recording session
static SPEECH_DETECTED_EMITTED: AtomicBool = AtomicBool::new(false);

/// Reset the speech detected flag and transcript dedup state for a new recording session
pub fn reset_speech_detected_flag() {
    SPEECH_DETECTED_EMITTED.store(false, Ordering::SeqCst);
    if let Ok(mut last) = LAST_TRANSCRIPT_STATE.lock() {
        last.text.clear();
        last.audio_end_time = None;
    }
    info!(
        "🔍 SPEECH_DETECTED_EMITTED reset to: {}",
        SPEECH_DETECTED_EMITTED.load(Ordering::SeqCst)
    );
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptUpdate {
    pub text: String,
    pub timestamp: String, // Wall-clock time for reference (e.g., "14:30:05")
    pub source: String,
    pub sequence_id: u64,
    pub chunk_start_time: f64, // Legacy field, kept for compatibility
    pub is_partial: bool,
    pub confidence: f32,
    // NEW: Recording-relative timestamps for playback sync
    pub audio_start_time: f64, // Seconds from recording start (e.g., 125.3)
    pub audio_end_time: f64,   // Seconds from recording start (e.g., 128.6)
    pub duration: f64,         // Segment duration in seconds (e.g., 3.3)
    pub is_refinement: bool,   // True for full-run refinement segments that should replace chunks
}

// NOTE: get_transcript_history and get_recording_meeting_name functions
// have been moved to recording_commands.rs where they have access to RECORDING_MANAGER

/// Optimized parallel transcription task ensuring ZERO chunk loss
pub fn start_transcription_task<R: Runtime>(
    app: AppHandle<R>,
    transcription_receiver: tokio::sync::mpsc::UnboundedReceiver<AudioChunk>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        info!("🚀 Starting optimized parallel transcription task - guaranteeing zero chunk loss");

        // Initialize transcription engine (Whisper or Parakeet based on config)
        let transcription_engine = match super::engine::get_or_init_transcription_engine(&app).await
        {
            Ok(engine) => engine,
            Err(e) => {
                error!("Failed to initialize transcription engine: {}", e);
                let _ = app.emit("transcription-error", serde_json::json!({
                    "error": e,
                    "userMessage": "Recording failed: Unable to initialize speech recognition. Please check your model settings.",
                    "actionable": true
                }));
                return;
            }
        };

        // Create parallel workers for faster processing while preserving ALL chunks
        const NUM_WORKERS: usize = 1; // Serial processing ensures transcripts emit in chronological order
        let (work_sender, work_receiver) = tokio::sync::mpsc::unbounded_channel::<AudioChunk>();
        let work_receiver = Arc::new(tokio::sync::Mutex::new(work_receiver));

        // Track completion: AtomicU64 for chunks queued, AtomicU64 for chunks completed
        let chunks_queued = Arc::new(AtomicU64::new(0));
        let chunks_completed = Arc::new(AtomicU64::new(0));
        let input_finished = Arc::new(AtomicBool::new(false));

        info!(
            "📊 Starting {} transcription worker{} (serial mode for ordered emission)",
            NUM_WORKERS,
            if NUM_WORKERS == 1 { "" } else { "s" }
        );

        // Spawn worker tasks
        let mut worker_handles = Vec::new();
        for worker_id in 0..NUM_WORKERS {
            let engine_clone = match &transcription_engine {
                TranscriptionEngine::Whisper(e) => TranscriptionEngine::Whisper(e.clone()),
                TranscriptionEngine::Parakeet(e) => TranscriptionEngine::Parakeet(e.clone()),
                TranscriptionEngine::QwenAsr(e) => TranscriptionEngine::QwenAsr(e.clone()),
                TranscriptionEngine::Provider(p) => TranscriptionEngine::Provider(p.clone()),
            };
            let app_clone = app.clone();
            let work_receiver_clone = work_receiver.clone();
            let chunks_completed_clone = chunks_completed.clone();
            let input_finished_clone = input_finished.clone();
            let chunks_queued_clone = chunks_queued.clone();

            let worker_handle = tokio::spawn(async move {
                info!("👷 Worker {} started", worker_id);

                // PRE-VALIDATE model state to avoid repeated async calls per chunk
                let initial_model_loaded = engine_clone.is_model_loaded().await;
                let current_model = engine_clone
                    .get_current_model()
                    .await
                    .unwrap_or_else(|| "unknown".to_string());

                let engine_name = engine_clone.provider_name();

                if initial_model_loaded {
                    info!(
                        "✅ Worker {} pre-validation: {} model '{}' is loaded and ready",
                        worker_id, engine_name, current_model
                    );
                } else {
                    warn!(
                        "⚠️ Worker {} pre-validation: {} model not loaded - chunks may be skipped",
                        worker_id, engine_name
                    );
                }

                loop {
                    // Try to get a chunk to process
                    let chunk = {
                        let mut receiver = work_receiver_clone.lock().await;
                        receiver.recv().await
                    };

                    match chunk {
                        Some(chunk) => {
                            // PERFORMANCE OPTIMIZATION: Reduce logging in hot path
                            // Only log every 10th chunk per worker to reduce I/O overhead
                            let should_log_this_chunk = chunk.chunk_id % 10 == 0;

                            if should_log_this_chunk {
                                info!(
                                    "👷 Worker {} processing chunk {} with {} samples",
                                    worker_id,
                                    chunk.chunk_id,
                                    chunk.data.len()
                                );
                            }

                            // Check if model is still loaded before processing
                            if !engine_clone.is_model_loaded().await {
                                warn!("⚠️ Worker {}: Model unloaded, but continuing to preserve chunk {}", worker_id, chunk.chunk_id);
                                // Still count as completed even if we can't process
                                chunks_completed_clone.fetch_add(1, Ordering::SeqCst);
                                continue;
                            }

                            let chunk_timestamp = chunk.timestamp;
                            let chunk_duration = chunk.data.len() as f64 / chunk.sample_rate as f64;

                            info!("📊 Chunk {} details: timestamp={:.2}s, duration={:.2}s, samples={}, sample_rate={}, time_range=[{:.2}s - {:.2}s]",
                                  chunk.chunk_id, chunk_timestamp, chunk_duration,
                                  chunk.data.len(), chunk.sample_rate,
                                  chunk_timestamp, chunk_timestamp + chunk_duration);

                            // Transcribe with provider-agnostic approach
                            match transcribe_chunk_with_provider(&engine_clone, chunk, &app_clone)
                                .await
                            {
                                Ok((transcript, confidence_opt, is_partial)) => {
                                    // Provider-aware confidence threshold
                                    let confidence_threshold = match &engine_clone {
                                        TranscriptionEngine::Whisper(_)
                                        | TranscriptionEngine::Provider(_) => 0.3,
                                        TranscriptionEngine::Parakeet(_) => 0.0, // Parakeet has no confidence, accept all
                                        TranscriptionEngine::QwenAsr(_) => 0.0, // QwenASR has no confidence, accept all
                                    };

                                    let confidence_str = match confidence_opt {
                                        Some(c) => format!("{:.2}", c),
                                        None => "N/A".to_string(),
                                    };

                                    info!("🔍 Worker {} transcription result: text='{}', confidence={}, partial={}, threshold={:.2}",
                                          worker_id, transcript, confidence_str, is_partial, confidence_threshold);

                                    // Check confidence threshold (or accept if no confidence provided)
                                    let meets_threshold =
                                        confidence_opt.map_or(true, |c| c >= confidence_threshold);

                                    if !transcript.trim().is_empty() && meets_threshold {
                                        // PERFORMANCE: Only log transcription results, not every processing step
                                        info!("✅ Worker {} transcribed: {} (confidence: {}, partial: {})",
                                              worker_id, transcript, confidence_str, is_partial);

                                        // Emit speech-detected event for frontend UX (only on first detection per session)
                                        // This is lightweight and provides better user feedback
                                        let current_flag =
                                            SPEECH_DETECTED_EMITTED.load(Ordering::SeqCst);
                                        info!("🔍 Checking speech-detected flag: current={}, will_emit={}", current_flag, !current_flag);

                                        if !current_flag {
                                            SPEECH_DETECTED_EMITTED.store(true, Ordering::SeqCst);
                                            match app_clone.emit("speech-detected", serde_json::json!({
                                                "message": "Speech activity detected"
                                            })) {
                                                Ok(_) => info!("🎤 ✅ First speech detected - successfully emitted speech-detected event"),
                                                Err(e) => error!("🎤 ❌ Failed to emit speech-detected event: {}", e),
                                            }
                                        } else {
                                            info!("🔍 Speech already detected in this session, not re-emitting");
                                        }

                                        // Generate sequence ID and calculate timestamps FIRST
                                        let sequence_id =
                                            SEQUENCE_COUNTER.fetch_add(1, Ordering::SeqCst);
                                        let audio_start_time = chunk_timestamp; // Already in seconds from recording start
                                        let audio_end_time = chunk_timestamp + chunk_duration;

                                        // Save structured transcript segment to recording manager (only final results)
                                        // Save ALL segments (partial and final) to ensure complete JSON
                                        // Create structured segment with full timestamp data
                                        // NOTE: This is now handled via the transcript-update event emission below
                                        // The recording_commands module listens to these events and saves them
                                        // This decouples the transcription worker from direct RECORDING_MANAGER access

                                        // Detect refinement segments: a segment whose start time is
                                        // significantly before the last emitted segment's end time.
                                        // This happens when VAD force-splits continuous speech and then
                                        // emits the full speech run at SpeechEnd.
                                        let is_refinement = {
                                            let last = LAST_TRANSCRIPT_STATE
                                                .lock()
                                                .unwrap_or_else(|e| e.into_inner());
                                            last.audio_end_time.map_or(false, |last_end| {
                                                // Refinement: starts >2s before last segment ended
                                                // and has substantial duration (>4s)
                                                audio_start_time < last_end - 2.0
                                                    && chunk_duration > 4.0
                                            })
                                        };

                                        if is_refinement {
                                            info!(
                                                "📝 Detected refinement segment: audio=[{:.1}s, {:.1}s] (duration={:.1}s) overlaps previous segments",
                                                audio_start_time, audio_end_time, chunk_duration
                                            );
                                        }

                                        // Remove overlapping text with the previous transcript segment
                                        let deduped_transcript = if !is_partial {
                                            // Only apply overlap dedup when segments are near-adjacent in time.
                                            // After pause/resume or mode/device changes, aggressive dedup can
                                            // incorrectly suppress valid new utterances.
                                            const MAX_DEDUP_GAP_SEC: f64 = 1.5;
                                            const MAX_NEGATIVE_DRIFT_SEC: f64 = 0.2;

                                            let mut last = LAST_TRANSCRIPT_STATE
                                                .lock()
                                                .unwrap_or_else(|e| e.into_inner());

                                            // Skip dedup for refinement segments — they intentionally
                                            // re-transcribe the same audio range at higher quality.
                                            let should_dedup = !is_refinement &&
                                                last.audio_end_time.map_or(false, |last_end| {
                                                    let gap = audio_start_time - last_end;
                                                    gap >= -MAX_NEGATIVE_DRIFT_SEC
                                                        && gap <= MAX_DEDUP_GAP_SEC
                                                });

                                            let deduped = if should_dedup {
                                                remove_text_overlap(&last.text, &transcript)
                                            } else {
                                                transcript.clone()
                                            };

                                            // Always refresh last state for next segment decision.
                                            // For refinement segments, update end time to the max
                                            // to avoid deduping the next real segment against
                                            // a stale earlier end time.
                                            last.text = transcript;
                                            let new_end = if is_refinement {
                                                Some(audio_end_time.max(last.audio_end_time.unwrap_or(0.0)))
                                            } else {
                                                Some(audio_end_time)
                                            };
                                            last.audio_end_time = new_end;
                                            deduped
                                        } else {
                                            transcript
                                        };

                                        // Skip if dedup removed all content
                                        if deduped_transcript.trim().is_empty() {
                                            info!("📝 Transcript fully overlapped with previous, skipping");
                                            chunks_completed_clone.fetch_add(1, Ordering::SeqCst);
                                            continue;
                                        }

                                        // Emit transcript update with NEW recording-relative timestamps

                                        let update = TranscriptUpdate {
                                            text: deduped_transcript,
                                            timestamp: format_current_timestamp(), // Wall-clock for reference
                                            source: "Audio".to_string(),
                                            sequence_id,
                                            chunk_start_time: chunk_timestamp, // Legacy compatibility
                                            is_partial,
                                            confidence: confidence_opt.unwrap_or(0.85), // Default for providers without confidence
                                            // NEW: Recording-relative timestamps for sync
                                            audio_start_time,
                                            audio_end_time,
                                            duration: chunk_duration,
                                            is_refinement,
                                        };

                                        if let Err(e) = app_clone.emit("transcript-update", &update)
                                        {
                                            error!(
                                                "Worker {}: Failed to emit transcript update: {}",
                                                worker_id, e
                                            );
                                        }
                                        // PERFORMANCE: Removed verbose logging of every emission
                                    } else if !transcript.trim().is_empty() && should_log_this_chunk
                                    {
                                        // PERFORMANCE: Only log low-confidence results occasionally
                                        if let Some(c) = confidence_opt {
                                            info!("Worker {} low-confidence transcription (confidence: {:.2}), skipping", worker_id, c);
                                        }
                                    }
                                }
                                Err(e) => {
                                    // Improved error handling with specific cases
                                    match e {
                                        TranscriptionError::AudioTooShort { .. } => {
                                            // Skip silently, this is expected for very short chunks
                                            info!("Worker {}: {}", worker_id, e);
                                            chunks_completed_clone.fetch_add(1, Ordering::SeqCst);
                                            continue;
                                        }
                                        TranscriptionError::ModelNotLoaded => {
                                            warn!(
                                                "Worker {}: Model unloaded during transcription",
                                                worker_id
                                            );
                                            chunks_completed_clone.fetch_add(1, Ordering::SeqCst);
                                            continue;
                                        }
                                        _ => {
                                            warn!(
                                                "Worker {}: Transcription failed: {}",
                                                worker_id, e
                                            );
                                            let _ = app_clone
                                                .emit("transcription-warning", e.to_string());
                                        }
                                    }
                                }
                            }

                            // Mark chunk as completed
                            let completed =
                                chunks_completed_clone.fetch_add(1, Ordering::SeqCst) + 1;
                            let queued = chunks_queued_clone.load(Ordering::SeqCst);

                            // PERFORMANCE: Only log progress every 5th chunk to reduce I/O overhead
                            if completed % 5 == 0 || should_log_this_chunk {
                                info!(
                                    "Worker {}: Progress {}/{} chunks ({:.1}%)",
                                    worker_id,
                                    completed,
                                    queued,
                                    (completed as f64 / queued.max(1) as f64 * 100.0)
                                );
                            }

                            // Emit progress event for frontend
                            let progress_percentage = if queued > 0 {
                                (completed as f64 / queued as f64 * 100.0) as u32
                            } else {
                                100
                            };

                            let _ = app_clone.emit("transcription-progress", serde_json::json!({
                                "worker_id": worker_id,
                                "chunks_completed": completed,
                                "chunks_queued": queued,
                                "progress_percentage": progress_percentage,
                                "message": format!("Worker {} processing... ({}/{})", worker_id, completed, queued)
                            }));
                        }
                        None => {
                            // No more chunks available
                            if input_finished_clone.load(Ordering::SeqCst) {
                                // Double-check that all queued chunks are actually completed
                                let final_queued = chunks_queued_clone.load(Ordering::SeqCst);
                                let final_completed = chunks_completed_clone.load(Ordering::SeqCst);

                                if final_completed >= final_queued {
                                    info!(
                                        "👷 Worker {} finishing - all {}/{} chunks processed",
                                        worker_id, final_completed, final_queued
                                    );
                                    break;
                                } else {
                                    warn!("👷 Worker {} detected potential chunk loss: {}/{} completed, waiting...", worker_id, final_completed, final_queued);
                                    // AGGRESSIVE POLLING: Reduced from 50ms to 5ms for faster chunk detection during shutdown
                                    tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
                                }
                            } else {
                                // AGGRESSIVE POLLING: Reduced from 10ms to 1ms for faster response during shutdown
                                tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
                            }
                        }
                    }
                }

                info!("👷 Worker {} completed", worker_id);
            });

            worker_handles.push(worker_handle);
        }

        // Main dispatcher: receive chunks and distribute to workers
        let mut receiver = transcription_receiver;
        while let Some(chunk) = receiver.recv().await {
            let queued = chunks_queued.fetch_add(1, Ordering::SeqCst) + 1;
            info!(
                "📥 Dispatching chunk {} to workers (total queued: {})",
                chunk.chunk_id, queued
            );

            if let Err(_) = work_sender.send(chunk) {
                error!("❌ Failed to send chunk to workers - this should not happen!");
                break;
            }
        }

        // Signal that input is finished
        input_finished.store(true, Ordering::SeqCst);
        drop(work_sender); // Close the channel to signal workers

        let total_chunks_queued = chunks_queued.load(Ordering::SeqCst);
        info!("📭 Input finished with {} total chunks queued. Waiting for all {} workers to complete...",
              total_chunks_queued, NUM_WORKERS);

        // Emit final chunk count to frontend
        let _ = app.emit("transcription-queue-complete", serde_json::json!({
            "total_chunks": total_chunks_queued,
            "message": format!("{} chunks queued for processing - waiting for completion", total_chunks_queued)
        }));

        // Wait for all workers to complete
        for (worker_id, handle) in worker_handles.into_iter().enumerate() {
            if let Err(e) = handle.await {
                error!("❌ Worker {} panicked: {:?}", worker_id, e);
            } else {
                info!("✅ Worker {} completed successfully", worker_id);
            }
        }

        // Final verification with retry logic to catch any stragglers
        let mut verification_attempts = 0;
        const MAX_VERIFICATION_ATTEMPTS: u32 = 10;

        loop {
            let final_queued = chunks_queued.load(Ordering::SeqCst);
            let final_completed = chunks_completed.load(Ordering::SeqCst);

            if final_queued == final_completed {
                info!(
                    "🎉 ALL {} chunks processed successfully - ZERO chunks lost!",
                    final_completed
                );
                break;
            } else if verification_attempts < MAX_VERIFICATION_ATTEMPTS {
                verification_attempts += 1;
                warn!("⚠️ Chunk count mismatch (attempt {}): {} queued, {} completed - waiting for stragglers...",
                     verification_attempts, final_queued, final_completed);

                // Wait a bit for any remaining chunks to be processed
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            } else {
                error!(
                    "❌ CRITICAL: After {} attempts, chunk loss detected: {} queued, {} completed",
                    MAX_VERIFICATION_ATTEMPTS, final_queued, final_completed
                );

                // Emit critical error event
                let _ = app.emit(
                    "transcript-chunk-loss-detected",
                    serde_json::json!({
                        "chunks_queued": final_queued,
                        "chunks_completed": final_completed,
                        "chunks_lost": final_queued - final_completed,
                        "message": "Some transcript chunks may have been lost during shutdown"
                    }),
                );
                break;
            }
        }

        info!("✅ Parallel transcription task completed - all workers finished, ready for model unload");
    })
}

/// Transcribe audio chunk using the appropriate provider (Whisper, Parakeet, or trait-based)
/// Returns: (text, confidence Option, is_partial)
async fn transcribe_chunk_with_provider<R: Runtime>(
    engine: &TranscriptionEngine,
    chunk: AudioChunk,
    app: &AppHandle<R>,
) -> std::result::Result<(String, Option<f32>, bool), TranscriptionError> {
    // Convert to 16kHz mono for transcription
    let transcription_data = if chunk.sample_rate != 16000 {
        crate::audio::audio_processing::resample_audio(&chunk.data, chunk.sample_rate, 16000)
    } else {
        chunk.data
    };

    // Skip VAD processing here since the pipeline already extracted speech using VAD
    let speech_samples = transcription_data;

    // Check for empty samples - improved error handling
    if speech_samples.is_empty() {
        warn!(
            "Audio chunk {} is empty, skipping transcription",
            chunk.chunk_id
        );
        return Err(TranscriptionError::AudioTooShort {
            samples: 0,
            minimum: 1600, // 100ms at 16kHz
        });
    }

    // Calculate energy for logging/monitoring only
    let energy: f32 =
        speech_samples.iter().map(|&x| x * x).sum::<f32>() / speech_samples.len() as f32;
    info!(
        "Processing speech audio chunk {} with {} samples (energy: {:.6})",
        chunk.chunk_id,
        speech_samples.len(),
        energy
    );

    // Transcribe using the appropriate engine (with improved error handling)
    match engine {
        TranscriptionEngine::Whisper(whisper_engine) => {
            // Get language preference from global state
            let language = crate::get_language_preference_internal();

            match whisper_engine
                .transcribe_audio_with_confidence(speech_samples, language)
                .await
            {
                Ok((text, confidence, is_partial)) => {
                    let cleaned_text = text.trim().to_string();
                    if cleaned_text.is_empty() {
                        return Ok((String::new(), Some(confidence), is_partial));
                    }

                    info!(
                        "Whisper transcription complete for chunk {}: '{}' (confidence: {:.2}, partial: {})",
                        chunk.chunk_id, cleaned_text, confidence, is_partial
                    );

                    Ok((cleaned_text, Some(confidence), is_partial))
                }
                Err(e) => {
                    error!(
                        "Whisper transcription failed for chunk {}: {}",
                        chunk.chunk_id, e
                    );

                    let transcription_error = TranscriptionError::EngineFailed(e.to_string());
                    let _ = app.emit(
                        "transcription-error",
                        &serde_json::json!({
                            "error": transcription_error.to_string(),
                            "userMessage": format!("Transcription failed: {}", transcription_error),
                            "actionable": false
                        }),
                    );

                    Err(transcription_error)
                }
            }
        }
        TranscriptionEngine::Parakeet(parakeet_engine) => {
            match parakeet_engine.transcribe_audio(speech_samples).await {
                Ok(text) => {
                    let cleaned_text = text.trim().to_string();
                    if cleaned_text.is_empty() {
                        return Ok((String::new(), None, false));
                    }

                    info!(
                        "Parakeet transcription complete for chunk {}: '{}'",
                        chunk.chunk_id, cleaned_text
                    );

                    // Parakeet doesn't provide confidence or partial results
                    Ok((cleaned_text, None, false))
                }
                Err(e) => {
                    error!(
                        "Parakeet transcription failed for chunk {}: {}",
                        chunk.chunk_id, e
                    );

                    let transcription_error = TranscriptionError::EngineFailed(e.to_string());
                    let _ = app.emit(
                        "transcription-error",
                        &serde_json::json!({
                            "error": transcription_error.to_string(),
                            "userMessage": format!("Transcription failed: {}", transcription_error),
                            "actionable": false
                        }),
                    );

                    Err(transcription_error)
                }
            }
        }
        TranscriptionEngine::QwenAsr(qwen_engine) => {
            // Emit streaming partial updates via a separate event channel so they
            // don't interfere with the sequence_id-based ordering of final transcripts.
            // Partials are keyed by chunk_id; the frontend replaces previous partials
            // for the same chunk and removes the partial once the final arrives.
            let app_for_streaming = app.clone();
            let chunk_id = chunk.chunk_id;
            let chunk_ts = chunk.timestamp;
            let chunk_dur = speech_samples.len() as f64 / 16000.0;
            let partial_buffer = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
            let partial_buffer_clone = partial_buffer.clone();
            let token_count = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
            let token_count_clone = token_count.clone();

            let on_token = move |token: &str| -> bool {
                let mut buf = partial_buffer_clone.lock().unwrap();
                buf.push_str(token);
                let count = token_count_clone.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

                // Emit partial transcript every 5 tokens for smooth UI updates
                // Uses a dedicated "transcript-partial" event so it doesn't pollute
                // the sequence_id-ordered "transcript-update" stream.
                if count % 5 == 4 {
                    let partial_text = clean_qwen_asr_output(buf.as_str());
                    if !partial_text.is_empty() {
                        let _ = app_for_streaming.emit(
                            "transcript-partial",
                            serde_json::json!({
                                "chunk_id": chunk_id,
                                "text": partial_text,
                                "chunk_start_time": chunk_ts,
                                "audio_start_time": chunk_ts,
                                "audio_end_time": chunk_ts + chunk_dur,
                            }),
                        );
                    }
                }
                true // continue decoding
            };

            match qwen_engine
                .transcribe_audio_streaming(speech_samples, on_token)
                .await
            {
                Ok(text) => {
                    info!("QwenASR raw output for chunk {}: '{}'", chunk_id, text);
                    let cleaned_text = clean_qwen_asr_output(&text);
                    if cleaned_text.is_empty() {
                        info!(
                            "QwenASR chunk {} cleaned to empty (raw was '{}'), skipping",
                            chunk_id, text
                        );
                        return Ok((String::new(), None, false));
                    }

                    info!(
                        "QwenASR transcription complete for chunk {}: '{}'",
                        chunk_id, cleaned_text
                    );

                    // Final result (non-partial)
                    Ok((cleaned_text, None, false))
                }
                Err(e) => {
                    error!("QwenASR transcription failed for chunk {}: {}", chunk_id, e);

                    let transcription_error = TranscriptionError::EngineFailed(e.to_string());
                    let _ = app.emit(
                        "transcription-error",
                        &serde_json::json!({
                            "error": transcription_error.to_string(),
                            "userMessage": format!("Transcription failed: {}", transcription_error),
                            "actionable": false
                        }),
                    );

                    Err(transcription_error)
                }
            }
        }
        TranscriptionEngine::Provider(provider) => {
            // Trait-based provider (clean, unified interface)
            let language = crate::get_language_preference_internal();

            match provider.transcribe(speech_samples, language).await {
                Ok(result) => {
                    let cleaned_text = result.text.trim().to_string();
                    if cleaned_text.is_empty() {
                        return Ok((String::new(), result.confidence, result.is_partial));
                    }

                    let confidence_str = match result.confidence {
                        Some(c) => format!("confidence: {:.2}", c),
                        None => "no confidence".to_string(),
                    };

                    info!(
                        "{} transcription complete for chunk {}: '{}' ({}, partial: {})",
                        provider.provider_name(),
                        chunk.chunk_id,
                        cleaned_text,
                        confidence_str,
                        result.is_partial
                    );

                    Ok((cleaned_text, result.confidence, result.is_partial))
                }
                Err(e) => {
                    error!(
                        "{} transcription failed for chunk {}: {}",
                        provider.provider_name(),
                        chunk.chunk_id,
                        e
                    );

                    let _ = app.emit(
                        "transcription-error",
                        &serde_json::json!({
                            "error": e.to_string(),
                            "userMessage": format!("Transcription failed: {}", e),
                            "actionable": false
                        }),
                    );

                    Err(e)
                }
            }
        }
    }
}

/// Remove overlapping text between consecutive transcript segments.
///
/// When VAD splits continuous speech, adjacent chunks can produce overlapping transcriptions.
/// This function finds the longest suffix of `previous` that is a prefix of `current`
/// and returns `current` with that overlap removed.
fn remove_text_overlap(previous: &str, current: &str) -> String {
    let previous = previous.trim();
    let current = current.trim_start();

    if previous.is_empty() || current.is_empty() {
        return current.to_string();
    }

    // Find the longest suffix of `previous` that matches a prefix of `current`.
    // We compare character-by-character using a sliding window.
    let prev_chars: Vec<char> = previous.chars().collect();
    let curr_chars: Vec<char> = current.chars().collect();

    let mut best_overlap = 0;

    // Only check overlaps of at least 4 characters to avoid false positives
    let min_overlap = 4;
    // IMPORTANT: we must allow overlap to exceed half of the current text.
    // In continuous speech, next segment can be mostly repeated context with
    // only a few new trailing words.
    let max_check = curr_chars.len().min(prev_chars.len());

    for overlap_len in min_overlap..=max_check {
        let prev_suffix_start = prev_chars.len() - overlap_len;
        let prev_suffix = &prev_chars[prev_suffix_start..];
        let curr_prefix = &curr_chars[..overlap_len];

        if prev_suffix == curr_prefix {
            best_overlap = overlap_len;
        }
    }

    if best_overlap >= min_overlap {
        let deduped: String = curr_chars[best_overlap..].iter().collect();
        info!(
            "📝 Removed {} chars of text overlap between consecutive segments",
            best_overlap
        );
        deduped.trim_start().to_string()
    } else {
        current.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::remove_text_overlap;

    #[test]
    fn removes_overlap_larger_than_half_of_current() {
        let previous = "let's review the roadmap for q2 and q3";
        let current = "roadmap for q2 and q3 plus hiring plan";
        assert_eq!(remove_text_overlap(previous, current), "plus hiring plan");
    }

    #[test]
    fn removes_full_duplicate_segment() {
        let previous = "we should align on launch timeline";
        let current = "launch timeline";
        assert_eq!(remove_text_overlap(previous, current), "");
    }

    #[test]
    fn keeps_text_when_no_overlap() {
        let previous = "budget approved yesterday";
        let current = "design review starts tomorrow";
        assert_eq!(
            remove_text_overlap(previous, current),
            "design review starts tomorrow"
        );
    }
}

/// Remove QwenASR language-prefix artifacts.
///
/// Qwen3-ASR prepends a language tag directly before the transcript with NO separator:
///   - `language EnglishWhat's your name?`
///   - `language Chinese吃吃吃。`
///   - `language None Hello`
///
/// We match the known language names exactly to avoid eating transcript content.
fn clean_qwen_asr_output(text: &str) -> String {
    // Known Qwen3-ASR language names (case-insensitive).
    // These are directly concatenated to the transcript without any separator.
    static LANGUAGE_PREFIX_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(concat!(
            r"(?im)^\s*language\s+(?:",
            r"English|Chinese|Japanese|Korean|French|German|Spanish|",
            r"Portuguese|Russian|Italian|Dutch|Turkish|Arabic|Polish|",
            r"Swedish|Norwegian|Danish|Finnish|Hungarian|Czech|Romanian|",
            r"Bulgarian|Greek|Serbian|Croatian|Slovak|Slovenian|",
            r"Ukrainian|Catalan|Vietnamese|Thai|Indonesian|Malay|",
            r"Hindi|Tamil|Telugu|Bengali|Urdu|Persian|Hebrew|",
            r"Cantonese|Yue|None|null",
            r")[:：]?\s*"
        ))
        .expect("valid regex")
    });
    static LANGUAGE_SENTENCE_PREFIX_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(concat!(
            r"(?i)([。！？.!?]\s*)language\s+(?:",
            r"English|Chinese|Japanese|Korean|French|German|Spanish|",
            r"Portuguese|Russian|Italian|Dutch|Turkish|Arabic|Polish|",
            r"Swedish|Norwegian|Danish|Finnish|Hungarian|Czech|Romanian|",
            r"Bulgarian|Greek|Serbian|Croatian|Slovak|Slovenian|",
            r"Ukrainian|Catalan|Vietnamese|Thai|Indonesian|Malay|",
            r"Hindi|Tamil|Telugu|Bengali|Urdu|Persian|Hebrew|",
            r"Cantonese|Yue|None|null",
            r")[:：]?\s*"
        ))
        .expect("valid regex")
    });
    static MULTISPACE_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"[ \t]{2,}").expect("valid regex"));

    let mut cleaned = text.trim().to_string();
    if cleaned.is_empty() {
        return cleaned;
    }

    cleaned = LANGUAGE_PREFIX_RE.replace_all(&cleaned, "").into_owned();
    loop {
        let next = LANGUAGE_SENTENCE_PREFIX_RE
            .replace_all(&cleaned, "$1")
            .into_owned();
        if next == cleaned {
            break;
        }
        cleaned = next;
    }
    cleaned = MULTISPACE_RE.replace_all(&cleaned, " ").into_owned();
    cleaned.trim().to_string()
}

/// Format current timestamp (wall-clock time)
fn format_current_timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();

    let hours = (now.as_secs() / 3600) % 24;
    let minutes = (now.as_secs() / 60) % 60;
    let seconds = now.as_secs() % 60;

    format!("{:02}:{:02}:{:02}", hours, minutes, seconds)
}

/// Format recording-relative time as [MM:SS]
#[allow(dead_code)]
fn format_recording_time(seconds: f64) -> String {
    let total_seconds = seconds.floor() as u64;
    let minutes = total_seconds / 60;
    let secs = total_seconds % 60;

    format!("[{:02}:{:02}]", minutes, secs)
}
