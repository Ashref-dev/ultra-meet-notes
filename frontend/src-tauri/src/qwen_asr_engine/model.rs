//! Safe Rust wrapper around the qwen3-asr-sys FFI bindings.
//!
//! Provides `QwenAsrModel` which manages the C context lifetime and
//! exposes safe methods for model loading and transcription.

use std::ffi::{CStr, CString};
use std::path::Path;
use std::os::raw::{c_char, c_void};

/// Safe wrapper around the qwen3-asr C context.
pub struct QwenAsrModel {
    ctx: *mut qwen3_asr_sys::qwen3_asr_context,
}

// SAFETY: The C library is designed for single-threaded access per context.
// We protect with Mutex/RwLock at the engine level, ensuring only one thread
// accesses the context at a time.
unsafe impl Send for QwenAsrModel {}
unsafe impl Sync for QwenAsrModel {}

impl QwenAsrModel {
    /// Create a new QwenAsrModel and load a GGUF model file.
    pub fn new(model_path: &Path) -> Result<Self, String> {
        unsafe {
            let ctx = qwen3_asr_sys::qwen3_asr_init();
            if ctx.is_null() {
                return Err("Failed to initialize Qwen3-ASR context".to_string());
            }

            let path_str = model_path
                .to_str()
                .ok_or_else(|| "Invalid model path encoding".to_string())?;
            let c_path = CString::new(path_str)
                .map_err(|e| format!("Invalid path string: {}", e))?;

            let success = qwen3_asr_sys::qwen3_asr_load_model(ctx, c_path.as_ptr());
            if !success {
                qwen3_asr_sys::qwen3_asr_free(ctx);
                return Err(format!(
                    "Failed to load Qwen3-ASR model from: {}",
                    model_path.display()
                ));
            }

            log::info!(
                "Successfully loaded Qwen3-ASR model from: {}",
                model_path.display()
            );

            Ok(Self { ctx })
        }
    }

    /// Check if a model is loaded.
    pub fn is_model_loaded(&self) -> bool {
        unsafe { qwen3_asr_sys::qwen3_asr_is_model_loaded(self.ctx) }
    }

    /// Transcribe audio samples (batch mode).
    ///
    /// Expects 16kHz mono f32 PCM audio.
    pub fn transcribe(&self, samples: &[f32]) -> Result<String, String> {
        unsafe {
            let params = qwen3_asr_sys::qwen3_asr_default_params();

            let result = qwen3_asr_sys::qwen3_asr_transcribe(
                self.ctx,
                samples.as_ptr(),
                samples.len() as i32,
                params,
            );

            if !result.success || result.text.is_null() {
                return Err("Qwen3-ASR transcription failed".to_string());
            }

            let text = CStr::from_ptr(result.text)
                .to_string_lossy()
                .into_owned();

            log::debug!(
                "Qwen3-ASR transcribed {} samples in {:.1}ms ({} tokens): '{}'",
                samples.len(),
                result.duration_ms,
                result.n_tokens,
                text
            );

            qwen3_asr_sys::qwen3_asr_free_text(result.text);

            Ok(text)
        }
    }

    /// Transcribe audio samples with streaming token callback.
    ///
    /// The `on_token` closure is called for each decoded token.
    /// Return `true` to continue, `false` to abort.
    pub fn transcribe_streaming<F>(
        &self,
        samples: &[f32],
        on_token: F,
    ) -> Result<String, String>
    where
        F: FnMut(&str) -> bool,
    {
        unsafe {
            let params = qwen3_asr_sys::qwen3_asr_default_params();

            // Box the closure so we can pass a raw pointer to C
            let mut callback_box: Box<dyn FnMut(&str) -> bool> = Box::new(on_token);
            let user_data = &mut callback_box as *mut Box<dyn FnMut(&str) -> bool> as *mut c_void;

            let result = qwen3_asr_sys::qwen3_asr_transcribe_streaming(
                self.ctx,
                samples.as_ptr(),
                samples.len() as i32,
                params,
                Some(streaming_trampoline),
                user_data,
            );

            if !result.success || result.text.is_null() {
                return Err("Qwen3-ASR streaming transcription failed".to_string());
            }

            let text = CStr::from_ptr(result.text)
                .to_string_lossy()
                .into_owned();

            qwen3_asr_sys::qwen3_asr_free_text(result.text);

            Ok(text)
        }
    }
}

/// Trampoline function that bridges the C callback to the Rust closure.
///
/// # Safety
/// - `user_data` must be a valid pointer to `Box<dyn FnMut(&str) -> bool>`
/// - `token` must be a valid null-terminated C string
unsafe extern "C" fn streaming_trampoline(
    token: *const c_char,
    user_data: *mut c_void,
) -> bool {
    if token.is_null() || user_data.is_null() {
        return false;
    }

    let callback = &mut *(user_data as *mut Box<dyn FnMut(&str) -> bool>);
    let token_str = CStr::from_ptr(token).to_string_lossy();
    callback(&token_str)
}

impl Drop for QwenAsrModel {
    fn drop(&mut self) {
        if !self.ctx.is_null() {
            unsafe {
                qwen3_asr_sys::qwen3_asr_free(self.ctx);
            }
            log::debug!("Qwen3-ASR context freed");
        }
    }
}
