// audio/transcription/openai_provider.rs
//
// OpenAI Speech-to-Text provider implementation using /v1/audio/transcriptions.

use super::provider::{TranscriptResult, TranscriptionError, TranscriptionProvider};
use async_trait::async_trait;
use reqwest::multipart::{Form, Part};
use serde::Deserialize;
use std::time::Duration;

const OPENAI_TRANSCRIPT_ENDPOINT: &str = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_REQUEST_TIMEOUT_SECS: u64 = 30;
const SAMPLE_RATE_HZ: u32 = 16_000;
const CHANNELS: u16 = 1;

#[derive(Debug, Deserialize)]
struct OpenAITranscriptionResponse {
    text: String,
}

pub struct OpenAIProvider {
    client: reqwest::Client,
    api_key: String,
    model: String,
}

impl OpenAIProvider {
    pub fn new(api_key: String, model: String) -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(OPENAI_REQUEST_TIMEOUT_SECS))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            api_key,
            model,
        }
    }

    fn normalize_language(language: Option<String>) -> Option<String> {
        let lang = language?.trim().to_string();
        if lang.is_empty() {
            return None;
        }

        // Internal app values for local providers should be omitted for OpenAI.
        match lang.to_lowercase().as_str() {
            "auto" | "auto-translate" | "auto_detect" | "auto-detect" => None,
            _ => Some(lang),
        }
    }

    fn to_wav_bytes(audio: &[f32]) -> Vec<u8> {
        // Convert float samples to PCM16.
        let mut pcm = Vec::with_capacity(audio.len() * 2);
        for &sample in audio {
            let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            pcm.extend_from_slice(&value.to_le_bytes());
        }

        // Build RIFF/WAV header for PCM16 mono 16kHz.
        let data_size = pcm.len() as u32;
        let file_size = 36 + data_size;
        let bits_per_sample = 16u16;
        let block_align = CHANNELS * (bits_per_sample / 8);
        let byte_rate = SAMPLE_RATE_HZ * block_align as u32;

        let mut wav = Vec::with_capacity(44 + pcm.len());
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&file_size.to_le_bytes());
        wav.extend_from_slice(b"WAVE");
        wav.extend_from_slice(b"fmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
        wav.extend_from_slice(&CHANNELS.to_le_bytes());
        wav.extend_from_slice(&SAMPLE_RATE_HZ.to_le_bytes());
        wav.extend_from_slice(&byte_rate.to_le_bytes());
        wav.extend_from_slice(&block_align.to_le_bytes());
        wav.extend_from_slice(&bits_per_sample.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data_size.to_le_bytes());
        wav.extend_from_slice(&pcm);
        wav
    }

    fn truncate_error_text(s: &str, max_chars: usize) -> String {
        s.chars().take(max_chars).collect::<String>()
    }
}

#[async_trait]
impl TranscriptionProvider for OpenAIProvider {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> std::result::Result<TranscriptResult, TranscriptionError> {
        if self.api_key.trim().is_empty() {
            return Err(TranscriptionError::EngineFailed(
                "OpenAI API key is missing".to_string(),
            ));
        }

        if audio.len() < 1600 {
            return Err(TranscriptionError::AudioTooShort {
                samples: audio.len(),
                minimum: 1600, // 100ms at 16kHz
            });
        }

        let wav = Self::to_wav_bytes(&audio);
        let audio_part = Part::bytes(wav)
            .file_name("chunk.wav")
            .mime_str("audio/wav")
            .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;

        let mut form = Form::new()
            .part("file", audio_part)
            .text("model", self.model.clone());

        if let Some(lang) = Self::normalize_language(language) {
            form = form.text("language", lang);
        }

        let response = self
            .client
            .post(OPENAI_TRANSCRIPT_ENDPOINT)
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let response_text = response.text().await.unwrap_or_default();
            let preview = Self::truncate_error_text(&response_text, 240);
            return Err(TranscriptionError::EngineFailed(format!(
                "OpenAI transcription failed ({}): {}",
                status, preview
            )));
        }

        let result = response
            .json::<OpenAITranscriptionResponse>()
            .await
            .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;

        Ok(TranscriptResult {
            text: result.text.trim().to_string(),
            confidence: None,
            is_partial: false,
        })
    }

    async fn is_model_loaded(&self) -> bool {
        !self.api_key.trim().is_empty() && !self.model.trim().is_empty()
    }

    async fn get_current_model(&self) -> Option<String> {
        if self.model.trim().is_empty() {
            None
        } else {
            Some(self.model.clone())
        }
    }

    fn provider_name(&self) -> &'static str {
        "OpenAI"
    }
}
