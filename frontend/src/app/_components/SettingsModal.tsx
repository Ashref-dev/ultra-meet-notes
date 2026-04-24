import { ModelConfig } from "@/components/ModelSettingsModal";
import { PreferenceSettings } from "@/components/PreferenceSettings";
import { DeviceSelection } from "@/components/DeviceSelection";
import { LanguageSelection } from "@/components/LanguageSelection";
import { TranscriptSettings } from "@/components/TranscriptSettings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useConfig } from "@/contexts/ConfigContext";
import { useRecordingState } from "@/contexts/RecordingStateContext";

type modalType = "modelSettings" | "deviceSettings" | "languageSettings" | "modelSelector" | "errorAlert" | "chunkDropWarning";

/**
 * SettingsModals Component
 *
 * All settings modals consolidated into a single component.
 * Uses ConfigContext and RecordingStateContext internally - no prop drilling needed!
 */

interface SettingsModalsProps {
  modals: {
    modelSettings: boolean;
    deviceSettings: boolean;
    languageSettings: boolean;
    modelSelector: boolean;
    errorAlert: boolean;
    chunkDropWarning: boolean;
  };
  messages: {
    errorAlert: string;
    chunkDropWarning: string;
    modelSelector: string;
  };
  onClose: (name: modalType) => void;
}

export function SettingsModals({
  modals,
  messages,
  onClose,
}: SettingsModalsProps) {
  // Contexts
  const {
    modelConfig,
    setModelConfig,
    models,
    modelOptions,
    error,
    selectedDevices,
    setSelectedDevices,
    selectedLanguage,
    setSelectedLanguage,
    transcriptModelConfig,
    setTranscriptModelConfig,
    showConfidenceIndicator,
    toggleConfidenceIndicator,
  } = useConfig();

  const { isRecording } = useRecordingState();

  return <>
    {/* Legacy Settings Modal */}
    {modals.modelSettings && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
        <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          {/* Header */}
          <div className="flex justify-between items-center p-6 border-b">
            <h3 className="text-xl font-semibold text-foreground">Preferences</h3>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close preferences"
              onClick={() => onClose("modelSettings")}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Content - Scrollable */}
          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            {/* General Preferences Section */}
            <PreferenceSettings />

            {/* Divider */}
            <div className="border-t pt-8">
              <h4 className="mb-4 text-lg font-semibold text-foreground">AI Model Configuration</h4>
              <div className="space-y-4">
                <div>
                  <label htmlFor="summarization-provider" className="mb-1 block text-sm font-medium text-foreground">
                    Summarization Model
                  </label>
                  <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <select
                      id="summarization-provider"
                      className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring sm:w-[180px] sm:shrink-0"
                      value={modelConfig.provider}
                      onChange={(e) => {
                        const provider = e.target.value as ModelConfig['provider'];
                        setModelConfig({
                          ...modelConfig,
                          provider,
                          model: modelOptions[provider][0]
                        });
                      }}
                    >
                      <option value="builtin-ai">Built-in AI</option>
                      <option value="claude">Claude</option>
                      <option value="groq">Groq</option>
                      <option value="ollama">Ollama</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="openai">OpenAI</option>
                    </select>

                    <select
                      aria-label="Summarization model"
                      className="w-full min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                      value={modelConfig.model}
                      onChange={(e) => setModelConfig((prev: ModelConfig) => ({ ...prev, model: e.target.value }))}
                    >
                      {modelOptions[modelConfig.provider].map((model: string) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {modelConfig.provider === 'ollama' && (
                  <div>
                    <h4 className="text-lg font-bold mb-4">Available Ollama Models</h4>
                    {error && (
                      <div className="mb-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-destructive">
                        {error}
                      </div>
                    )}
                    <div className="grid gap-4 max-h-[400px] overflow-y-auto pr-2">
                      {models.map((model) => (
                        <button
                          key={model.id}
                          type="button"
                          className={`cursor-pointer rounded-xl border border-border bg-card p-4 text-left shadow transition-colors ${modelConfig.model === model.name ? 'bg-accent/10 ring-2 ring-ring' : 'hover:bg-muted/70'
                            }`}
                          onClick={() => setModelConfig((prev: ModelConfig) => ({ ...prev, model: model.name }))}
                        >
                          <h3 className="font-bold">{model.name}</h3>
                          <p className="text-muted-foreground">Size: {model.size}</p>
                          <p className="text-muted-foreground">Modified: {model.modified}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t p-6 flex justify-end">
            <Button
              variant="brand"
              onClick={() => onClose('modelSettings')}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              Done
            </Button>
          </div>
        </div>
      </div>
    )}

    {/* Device Settings Modal */}
    {modals.deviceSettings && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
        <div className="mx-4 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-foreground">Audio Device Settings</h3>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close audio device settings"
              onClick={() => onClose('deviceSettings')}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <DeviceSelection
            selectedDevices={selectedDevices}
            onDeviceChange={setSelectedDevices}
            disabled={isRecording}
          />

          <div className="mt-6 flex justify-end">
            <Button
              variant="brand"
              onClick={() => {
                const micDevice = selectedDevices.micDevice || 'Default';
                const systemDevice = selectedDevices.systemDevice || 'Default';
                toast.success("Devices selected", {
                  description: `Microphone: ${micDevice}, System Audio: ${systemDevice}`
                });
                onClose('deviceSettings');
              }}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              Done
            </Button>
          </div>
        </div>
      </div>
    )}

    {/* Language Settings Modal */}
    <Dialog
      open={modals.languageSettings}
      onOpenChange={(open) => {
        if (!open) {
          onClose('languageSettings');
        }
      }}
    >
      <DialogContent className="sm:max-w-md [&>button]:hidden">
        <div className="flex items-center justify-between gap-4">
          <DialogTitle>Language Settings</DialogTitle>
          <DialogClose
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <X className="size-4" />
            <VisuallyHidden>Close language settings</VisuallyHidden>
          </DialogClose>
        </div>

        <LanguageSelection
          selectedLanguage={selectedLanguage}
          onLanguageChange={setSelectedLanguage}
          disabled={isRecording}
          provider={transcriptModelConfig.provider}
        />

        <div className="flex justify-end pt-2">
          <Button variant="brand" onClick={() => onClose('languageSettings')}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* Model Selection Modal */}
    {modals.modelSelector && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
        <div className="mx-4 flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-card shadow-xl">
          {/* Fixed Header */}
          <div className="flex items-center justify-between border-b border-border p-6 pb-4">
            <h3 className="text-lg font-semibold text-foreground">
              {messages.modelSelector ? 'Speech Recognition Setup Required' : 'Transcription Model Settings'}
            </h3>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close transcription model settings"
              onClick={() => onClose('modelSelector')}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-6 pt-4">
            <TranscriptSettings
              transcriptModelConfig={transcriptModelConfig}
              setTranscriptModelConfig={setTranscriptModelConfig}
              onModelSelect={() => onClose('modelSelector')}
            />
          </div>

          {/* Fixed Footer */}
          <div className="flex items-center justify-between border-t border-border p-6 pt-4">
            {/* Confidence Indicator Toggle */}
            <div className="flex items-center gap-3">
              <Switch
                checked={showConfidenceIndicator}
                onCheckedChange={toggleConfidenceIndicator}
              />
              <div>
                <p className="text-sm font-medium text-foreground">Show Confidence Indicators</p>
                <p className="text-xs text-muted-foreground">Display colored dots showing transcription confidence quality</p>
              </div>
            </div>

              <Button
                variant={messages.modelSelector ? 'outline' : 'brand'}
                onClick={() => onClose('modelSelector')}
                className="rounded-md bg-muted px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                {messages.modelSelector ? 'Cancel' : 'Done'}
              </Button>
          </div>
        </div>
      </div>
    )}

    {/* Error Alert Modal */}
    {modals.errorAlert && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
        <Alert className="mx-4 max-w-md rounded-xl border border-destructive/20 bg-card shadow-xl">
          <AlertTitle className="text-destructive">Recording Stopped</AlertTitle>
          <AlertDescription className="text-foreground">
            {messages.errorAlert}
            <Button
              variant="link"
              onClick={() => onClose('errorAlert')}
              className="ml-2 text-destructive underline transition-colors hover:text-destructive/80 p-0 h-auto font-normal"
            >
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )}

    {/* Chunk Drop Warning Modal */}
    {modals.chunkDropWarning && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
        <Alert className="mx-4 max-w-lg rounded-xl border border-border bg-card shadow-xl">
          <AlertTitle className="text-foreground">Transcription Performance Warning</AlertTitle>
          <AlertDescription className="text-foreground">
            {messages.chunkDropWarning}
            <Button
              variant="link"
              onClick={() => onClose('chunkDropWarning')}
              className="ml-2 text-foreground underline transition-colors hover:text-muted-foreground p-0 h-auto font-normal"
            >
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )}
  </>
}
