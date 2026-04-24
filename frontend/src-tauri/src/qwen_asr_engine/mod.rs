//! Qwen3-ASR speech recognition engine module.
//!
//! This module provides multilingual speech-to-text transcription using the
//! Qwen3-ASR models (1.7B / 0.6B) via GGML (qwen3-asr.cpp). It supports both
//! batch and streaming inference modes.
//!
//! # Features
//!
//! - **Multilingual**: Supports 15+ languages natively
//! - **GGUF Format**: Single-file models, easy to manage
//! - **GPU Acceleration**: Metal (macOS), CUDA (NVIDIA)
//! - **Streaming**: Token-by-token output during decoding
//!
//! # Module Structure
//!
//! - `qwen_asr_engine`: Main engine implementation (model management, download, transcription)
//! - `model`: Safe FFI wrapper around qwen3-asr-sys
//! - `commands`: Tauri command interface for frontend integration

pub mod qwen_asr_engine;
pub mod model;
pub mod commands;

pub use qwen_asr_engine::{QwenAsrEngine, QwenAsrEngineError, ModelInfo, ModelStatus, QuantizationType, DownloadProgress};
pub use model::QwenAsrModel;
pub use commands::*;
