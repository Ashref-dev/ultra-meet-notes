use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::command;
use reqwest::blocking::Client;

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenRouterModel {
    pub id: String,
    pub name: String,
    pub context_length: Option<u32>,
    pub prompt_price: Option<String>,
    pub completion_price: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterApiModel {
    id: String,
    name: Option<String>,
    context_length: Option<u32>,
    #[serde(default)]
    top_provider: Option<TopProvider>,
    #[serde(default)]
    pricing: Option<Pricing>,
}

#[derive(Debug, Deserialize, Default)]
struct TopProvider {
    context_length: Option<u32>,
}

#[derive(Debug, Deserialize, Default)]
struct Pricing {
    prompt: Option<String>,
    completion: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterResponse {
    data: Vec<OpenRouterApiModel>,
}

#[command]
pub fn get_openrouter_models() -> Result<Vec<OpenRouterModel>, String> {
    let client = Client::new();
    let response = client
        .get("https://openrouter.ai/api/v1/models")
        .send()
        .map_err(|e| format!("Failed to make HTTP request: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP request failed with status: {}", response.status()));
    }

    let api_response: OpenRouterResponse = response
        .json()
        .map_err(|e| format!("Failed to parse JSON response: {}", e))?;

    let models = api_response
        .data
        .into_iter()
        .map(|m| OpenRouterModel {
            id: m.id,
            name: m.name.unwrap_or_else(|| "Unknown".to_string()),
            context_length: m.top_provider
                .as_ref()
                .and_then(|tp| tp.context_length)
                .or(m.context_length),
            prompt_price: m.pricing.as_ref().and_then(|p| p.prompt.clone()),
            completion_price: m.pricing.as_ref().and_then(|p| p.completion.clone()),
        })
        .collect();

    Ok(models)
}

#[command]
pub async fn test_openrouter_connection(api_key: String) -> Result<(), String> {
    let trimmed_api_key = api_key.trim();

    if trimmed_api_key.is_empty() {
        return Err("Please enter your OpenRouter API key first".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Connection failed: {}", e))?;

    let response = client
        .get("https://openrouter.ai/api/v1/models")
        .header("Authorization", format!("Bearer {}", trimmed_api_key))
        .header("HTTP-Referer", "https://ultra-meet.app")
        .header("X-Title", "Ultra Meet")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "Connection failed: request timed out after 10 seconds".to_string()
            } else {
                format!("Connection failed: {}", e)
            }
        })?;

    match response.status().as_u16() {
        200 => Ok(()),
        401 => Err("Invalid API key — authentication failed".to_string()),
        429 => Err("Rate limited — try again later".to_string()),
        status => Err(format!("Connection failed: HTTP {}", status)),
    }
}
