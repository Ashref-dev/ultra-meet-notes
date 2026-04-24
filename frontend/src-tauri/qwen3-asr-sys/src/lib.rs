//! FFI bindings for qwen3-asr.cpp
//!
//! This crate provides raw C FFI bindings to the qwen3-asr.cpp library,
//! which implements Qwen3-ASR-1.7B inference using GGML.
//!
//! # Safety
//!
//! All functions in this crate are `unsafe` extern "C" functions. Callers must
//! ensure proper lifetime management of contexts, valid pointer parameters,
//! and freeing allocated memory via the provided free functions.

#![allow(non_camel_case_types)]

use std::os::raw::{c_char, c_float, c_int, c_void};

/// Opaque context handle for the ASR engine.
#[repr(C)]
pub struct qwen3_asr_context {
    _private: [u8; 0],
}

/// Transcription parameters.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct qwen3_asr_params {
    /// Number of threads (0 = auto-detect)
    pub n_threads: i32,
    /// Enable GPU acceleration
    pub use_gpu: bool,
    /// GPU device index
    pub gpu_device: i32,
    /// Sampling temperature (0.0 = greedy decoding)
    pub temperature: c_float,
}

/// Transcription result.
#[repr(C)]
pub struct qwen3_asr_result {
    /// Transcribed text. Caller must free with `qwen3_asr_free_text`.
    pub text: *mut c_char,
    /// Number of tokens generated
    pub n_tokens: i32,
    /// Processing time in milliseconds
    pub duration_ms: c_float,
    /// Whether transcription succeeded
    pub success: bool,
}

/// Streaming token callback type.
///
/// Called for each decoded token during streaming transcription.
/// - `token`: null-terminated token text (valid only during callback)
/// - `user_data`: opaque pointer passed through from `qwen3_asr_transcribe_streaming`
///
/// Return `true` to continue decoding, `false` to abort.
pub type qwen3_asr_token_callback =
    Option<unsafe extern "C" fn(token: *const c_char, user_data: *mut c_void) -> bool>;

extern "C" {
    /// Get default transcription parameters.
    pub fn qwen3_asr_default_params() -> qwen3_asr_params;

    /// Create a new ASR context.
    pub fn qwen3_asr_init() -> *mut qwen3_asr_context;

    /// Load a GGUF model file. Returns `true` on success.
    pub fn qwen3_asr_load_model(
        ctx: *mut qwen3_asr_context,
        model_path: *const c_char,
    ) -> bool;

    /// Transcribe audio samples (batch mode).
    ///
    /// - `samples`: pointer to f32 PCM audio at 16kHz mono
    /// - `n_samples`: number of samples
    pub fn qwen3_asr_transcribe(
        ctx: *mut qwen3_asr_context,
        samples: *const c_float,
        n_samples: c_int,
        params: qwen3_asr_params,
    ) -> qwen3_asr_result;

    /// Transcribe audio samples with streaming token output.
    ///
    /// The callback is invoked for each decoded token.
    pub fn qwen3_asr_transcribe_streaming(
        ctx: *mut qwen3_asr_context,
        samples: *const c_float,
        n_samples: c_int,
        params: qwen3_asr_params,
        callback: qwen3_asr_token_callback,
        user_data: *mut c_void,
    ) -> qwen3_asr_result;

    /// Check if a model is currently loaded.
    pub fn qwen3_asr_is_model_loaded(ctx: *const qwen3_asr_context) -> bool;

    /// Free the ASR context and all associated resources.
    pub fn qwen3_asr_free(ctx: *mut qwen3_asr_context);

    /// Free text allocated by qwen3_asr_result.
    pub fn qwen3_asr_free_text(text: *mut c_char);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_params() {
        unsafe {
            let params = qwen3_asr_default_params();
            assert_eq!(params.n_threads, 0);
            assert!(params.use_gpu);
            assert_eq!(params.gpu_device, 0);
            assert_eq!(params.temperature, 0.0);
        }
    }

    #[test]
    fn test_init_and_free() {
        unsafe {
            let ctx = qwen3_asr_init();
            assert!(!ctx.is_null());
            assert!(!qwen3_asr_is_model_loaded(ctx));
            qwen3_asr_free(ctx);
        }
    }
}
