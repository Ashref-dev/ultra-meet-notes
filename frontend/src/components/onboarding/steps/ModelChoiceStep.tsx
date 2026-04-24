import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { cn } from '@/lib/utils';

const transcriptionOptions = [
  {
    value: 'parakeet' as const,
    title: 'Parakeet',
    badge: 'Recommended',
    description: 'Fast, accurate English transcription. ~200MB download.',
  },
  {
    value: 'whisper' as const,
    title: 'Whisper',
    description: 'Multi-language support with translation. Various model sizes.',
  },
];

export function ModelChoiceStep() {
  const {
    goNext,
    completeOnboarding,
    selectedTranscriptionProvider,
    setSelectedTranscriptionProvider,
    includeSummaryModel,
    setIncludeSummaryModel,
    includeTranscriptionModel,
    setIncludeTranscriptionModel,
  } = useOnboarding();
  const [isMac, setIsMac] = useState(false);

  const handleSkip = async () => {
    await completeOnboarding();
    window.location.reload();
  };

  useEffect(() => {
    const checkPlatform = async () => {
      try {
        const { platform } = await import('@tauri-apps/plugin-os');
        setIsMac(platform() === 'macos');
      } catch {
        setIsMac(navigator.userAgent.includes('Mac'));
      }
    };

    checkPlatform();
  }, []);

  return (
    <OnboardingContainer
      title="Choose your transcription model"
      description="Pick the transcription engine that best fits your meetings. You can change this later in Settings."
      step={3}
      totalSteps={isMac ? 5 : 4}
    >
      <div className="flex flex-col items-center space-y-8">
        <div className="w-full max-w-xl space-y-4">
          {/* Transcription model section */}
          <div className="rounded-lg border border-border bg-card p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <h3 className="text-base font-medium text-foreground">
                  Download transcription model
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Required for recording. ~200 MB–1.5 GB depending on model.
                </p>
              </div>
              <Switch
                checked={includeTranscriptionModel}
                onCheckedChange={setIncludeTranscriptionModel}
                aria-label="Download transcription model"
              />
            </div>

            {includeTranscriptionModel && (
              <div role="radiogroup" aria-label="Transcription model" className="space-y-3 pt-1">
                {transcriptionOptions.map((option) => {
                  const isSelected = selectedTranscriptionProvider === option.value;
                  const inputId = `transcription-model-${option.value}`;

                  return (
                    <label
                      key={option.value}
                      htmlFor={inputId}
                      className={cn(
                        'block w-full cursor-pointer rounded-lg border border-border bg-background p-4 text-left transition hover:bg-muted focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
                        isSelected && 'border-accent bg-accent/5 hover:bg-accent/5'
                      )}
                    >
                      <input
                        id={inputId}
                        type="radio"
                        name="transcription-model"
                        value={option.value}
                        checked={isSelected}
                        onChange={() => setSelectedTranscriptionProvider(option.value)}
                        className="sr-only"
                      />
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-medium text-foreground">{option.title}</h3>
                            {option.badge && (
                              <span className="text-xs font-medium text-accent">{option.badge}</span>
                            )}
                          </div>
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {option.description}
                          </p>
                        </div>

                        <div
                          className={cn(
                            'mt-0.5 h-4 w-4 flex-shrink-0 rounded-full border border-border transition-colors',
                            isSelected && 'border-accent bg-accent'
                          )}
                          aria-hidden="true"
                        />
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <h3 className="text-base font-medium text-foreground">
                  Download AI summary model (~1GB)
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Enables local meeting summaries without cloud APIs
                </p>
              </div>

              <Switch
                checked={includeSummaryModel}
                onCheckedChange={setIncludeSummaryModel}
                aria-label="Download AI summary model"
              />
            </div>
          </div>
        </div>

        <div className="w-full max-w-xs space-y-3">
          <Button onClick={goNext} className="h-11 w-full">
            Continue
          </Button>
          <button
            type="button"
            onClick={() => { void handleSkip(); }}
            className="w-full text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            I'll set up later from Settings
          </button>
        </div>
      </div>
    </OnboardingContainer>
  );
}
