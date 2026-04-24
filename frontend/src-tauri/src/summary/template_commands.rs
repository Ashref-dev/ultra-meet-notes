use crate::summary::templates;
use serde::{Deserialize, Serialize};
use tauri::Runtime;
use tracing::{info, warn};

/// Full section data for template details
#[derive(Debug, Serialize, Deserialize)]
pub struct TemplateSectionInfo {
    pub title: String,
    pub instruction: String,
    pub format: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub example_item_format: Option<String>,
}

/// Template metadata for UI display
#[derive(Debug, Serialize, Deserialize)]
pub struct TemplateInfo {
    /// Template identifier (e.g., "daily_standup", "standard_meeting")
    pub id: String,

    /// Display name for the template
    pub name: String,

    /// Brief description of the template's purpose
    pub description: String,

    /// Whether this is a user-created custom template
    pub is_custom: bool,
}

/// Detailed template structure for preview/editing
#[derive(Debug, Serialize, Deserialize)]
pub struct TemplateDetails {
    /// Template identifier
    pub id: String,

    /// Display name
    pub name: String,

    /// Description
    pub description: String,

    /// Whether this is a user-created custom template
    pub is_custom: bool,

    /// Optional system prompt override for the final summary generation step
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,

    /// Full section data
    pub sections: Vec<TemplateSectionInfo>,
}

/// Lists all available templates
#[tauri::command]
pub async fn api_list_templates<R: Runtime>(
    _app: tauri::AppHandle<R>,
) -> Result<Vec<TemplateInfo>, String> {
    info!("api_list_templates called");

    let templates = templates::list_templates();

    let template_infos: Vec<TemplateInfo> = templates
        .into_iter()
        .map(|(id, name, description, is_custom)| TemplateInfo {
            id,
            name,
            description,
            is_custom,
        })
        .collect();

    info!("Found {} available templates", template_infos.len());

    Ok(template_infos)
}

/// Gets detailed information about a specific template
#[tauri::command]
pub async fn api_get_template_details<R: Runtime>(
    _app: tauri::AppHandle<R>,
    template_id: String,
) -> Result<TemplateDetails, String> {
    info!("api_get_template_details called for template_id: {}", template_id);

    let template = templates::get_template(&template_id)?;
    let is_custom = templates::is_custom_template(&template_id);

    let sections: Vec<TemplateSectionInfo> = template
        .sections
        .iter()
        .map(|section| TemplateSectionInfo {
            title: section.title.clone(),
            instruction: section.instruction.clone(),
            format: section.format.clone(),
            item_format: section.item_format.clone(),
            example_item_format: section.example_item_format.clone(),
        })
        .collect();

    let details = TemplateDetails {
        id: template_id,
        name: template.name,
        description: template.description,
        is_custom,
        system_prompt: template.system_prompt,
        sections,
    };

    info!("Retrieved template details for '{}'", details.name);

    Ok(details)
}

/// Validates a custom template JSON string
#[tauri::command]
pub async fn api_validate_template<R: Runtime>(
    _app: tauri::AppHandle<R>,
    template_json: String,
) -> Result<String, String> {
    info!("api_validate_template called");

    match templates::validate_and_parse_template(&template_json) {
        Ok(template) => {
            info!("Template '{}' validated successfully", template.name);
            Ok(template.name)
        }
        Err(e) => {
            warn!("Template validation failed: {}", e);
            Err(e)
        }
    }
}

/// Sanitize a template ID to only allow safe characters
fn sanitize_template_id(id: &str) -> Result<String, String> {
    let sanitized: String = id.chars()
        .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '_')
        .collect();

    if sanitized.is_empty() {
        return Err("Template ID must contain at least one valid character (a-z, 0-9, _)".to_string());
    }

    if sanitized != id {
        return Err(format!(
            "Template ID contains invalid characters. Only lowercase letters, digits, and underscores are allowed. Suggested: '{}'",
            sanitized
        ));
    }

    Ok(sanitized)
}

/// Save a custom template
#[tauri::command]
pub async fn api_save_template<R: Runtime>(
    _app: tauri::AppHandle<R>,
    template_id: String,
    template_json: String,
) -> Result<(), String> {
    info!("api_save_template called for template_id: {}", template_id);

    // Sanitize the template ID
    let safe_id = sanitize_template_id(&template_id)?;

    // Validate the template JSON
    templates::validate_and_parse_template(&template_json)?;

    // Get custom templates directory
    let custom_dir = templates::get_custom_templates_dir()
        .ok_or_else(|| "Could not determine custom templates directory".to_string())?;

    // Create directory if it doesn't exist
    std::fs::create_dir_all(&custom_dir)
        .map_err(|e| format!("Failed to create custom templates directory: {}", e))?;

    // Write the template file
    let template_path = custom_dir.join(format!("{}.json", safe_id));
    std::fs::write(&template_path, &template_json)
        .map_err(|e| format!("Failed to write template file: {}", e))?;

    info!("Saved custom template '{}' to {:?}", safe_id, template_path);

    Ok(())
}

/// Delete a custom template
#[tauri::command]
pub async fn api_delete_template<R: Runtime>(
    _app: tauri::AppHandle<R>,
    template_id: String,
) -> Result<(), String> {
    info!("api_delete_template called for template_id: {}", template_id);

    // Sanitize the template ID
    let safe_id = sanitize_template_id(&template_id)?;

    // Verify it's a custom template
    if !templates::is_custom_template(&safe_id) {
        return Err(format!("Template '{}' is not a custom template and cannot be deleted", safe_id));
    }

    // Get the file path
    let custom_dir = templates::get_custom_templates_dir()
        .ok_or_else(|| "Could not determine custom templates directory".to_string())?;
    let template_path = custom_dir.join(format!("{}.json", safe_id));

    // Delete the file
    std::fs::remove_file(&template_path)
        .map_err(|e| format!("Failed to delete template file: {}", e))?;

    info!("Deleted custom template '{}' from {:?}", safe_id, template_path);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_template_id_valid() {
        assert_eq!(sanitize_template_id("my_template_1").unwrap(), "my_template_1");
    }

    #[test]
    fn test_sanitize_template_id_invalid_chars() {
        assert!(sanitize_template_id("my-template").is_err());
        assert!(sanitize_template_id("../hack").is_err());
        assert!(sanitize_template_id("My Template").is_err());
    }

    #[test]
    fn test_sanitize_template_id_empty() {
        assert!(sanitize_template_id("").is_err());
        assert!(sanitize_template_id("...").is_err());
    }

    #[tokio::test]
    async fn test_validate_template_valid() {
        let valid_json = r#"
        {
            "name": "Test Template",
            "description": "A test template",
            "sections": [
                {
                    "title": "Summary",
                    "instruction": "Provide a summary",
                    "format": "paragraph"
                }
            ]
        }"#;

        let result = templates::validate_and_parse_template(valid_json);
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_validate_template_invalid() {
        let invalid_json = "invalid json";

        let result = templates::validate_and_parse_template(invalid_json);
        assert!(result.is_err());
    }
}
