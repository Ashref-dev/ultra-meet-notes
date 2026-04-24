import { useState, useEffect, useCallback } from 'react';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { toast } from 'sonner';

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  is_custom: boolean;
}

export interface TemplateSectionInfo {
  title: string;
  instruction: string;
  format: string;
  item_format?: string;
  example_item_format?: string;
}

export interface TemplateDetails {
  id: string;
  name: string;
  description: string;
  is_custom: boolean;
  system_prompt?: string | null;
  sections: TemplateSectionInfo[];
}

export interface TemplatePayload {
  name: string;
  description: string;
  system_prompt?: string | null;
  sections: TemplateSectionInfo[];
}

export function useTemplates() {
  const [availableTemplates, setAvailableTemplates] = useState<TemplateInfo[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('standard_meeting');

  const fetchTemplates = useCallback(async () => {
    try {
      const templates = await invokeTauri('api_list_templates') as TemplateInfo[];
      console.log('Available templates:', templates);
      setAvailableTemplates(templates);
    } catch (error) {
      console.error('Failed to fetch templates:', error);
      toast.error('Failed to load templates');
    }
  }, []);

  // Fetch available templates on mount
  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // Handle template selection
  const handleTemplateSelection = useCallback((templateId: string, templateName: string) => {
    setSelectedTemplate(templateId);
    toast.success('Template selected', {
      description: `Using "${templateName}" template for summary generation`,
    });
  }, []);

  // Fetch full template details
  const fetchTemplateDetails = useCallback(async (templateId: string): Promise<TemplateDetails> => {
    const details = await invokeTauri('api_get_template_details', { templateId }) as TemplateDetails;
    return details;
  }, []);

  // Save a custom template
  const saveTemplate = useCallback(async (templateId: string, templateData: TemplatePayload) => {
    const templateJson = JSON.stringify(templateData);
    await invokeTauri('api_save_template', { templateId, templateJson });
    await fetchTemplates();
    toast.success('Template saved', {
      description: `"${templateData.name}" has been saved`,
    });
  }, [fetchTemplates]);

  // Delete a custom template
  const deleteTemplate = useCallback(async (templateId: string) => {
    await invokeTauri('api_delete_template', { templateId });
    // Reset selection if the deleted template was selected
    if (selectedTemplate === templateId) {
      setSelectedTemplate('standard_meeting');
    }
    await fetchTemplates();
    toast.success('Template deleted');
  }, [fetchTemplates, selectedTemplate]);

  return {
    availableTemplates,
    selectedTemplate,
    handleTemplateSelection,
    fetchTemplateDetails,
    saveTemplate,
    deleteTemplate,
    refreshTemplates: fetchTemplates,
  };
}
