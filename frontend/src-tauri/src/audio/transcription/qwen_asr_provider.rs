// audio/transcription/qwen_asr_provider.rs
//
// Qwen3-ASR transcription provider implementation.

use super::provider::{TranscriptionError, TranscriptionProvider, TranscriptResult};
use async_trait::async_trait;
use regex::Regex;
use std::sync::{Arc, LazyLock};

/// Qwen3-ASR transcription provider (wraps QwenAsrEngine)
pub struct QwenAsrProvider {
    engine: Arc<crate::qwen_asr_engine::QwenAsrEngine>,
}

impl QwenAsrProvider {
    pub fn new(engine: Arc<crate::qwen_asr_engine::QwenAsrEngine>) -> Self {
        Self { engine }
    }
}

fn clean_qwen_asr_output(text: &str) -> String {
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
        )).expect("valid regex")
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
        )).expect("valid regex")
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

#[async_trait]
impl TranscriptionProvider for QwenAsrProvider {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> std::result::Result<TranscriptResult, TranscriptionError> {
        // Qwen3-ASR supports multilingual transcription natively
        if let Some(ref lang) = language {
            log::debug!("Qwen3-ASR transcribing with language hint: {}", lang);
        }

        match self.engine.transcribe_audio(audio).await {
            Ok(text) => Ok(TranscriptResult {
                text: clean_qwen_asr_output(&text),
                confidence: None, // Qwen3-ASR doesn't provide confidence scores
                is_partial: false,
            }),
            Err(e) => Err(TranscriptionError::EngineFailed(e.to_string())),
        }
    }

    async fn is_model_loaded(&self) -> bool {
        self.engine.is_model_loaded().await
    }

    async fn get_current_model(&self) -> Option<String> {
        self.engine.get_current_model().await
    }

    fn provider_name(&self) -> &'static str {
        "QwenASR"
    }
}
