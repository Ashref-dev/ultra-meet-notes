import React from 'react';
import { Lock, Sparkles, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';

export function WelcomeStep() {
  const { goNext, completeOnboarding } = useOnboarding();

  const handleSkip = async () => {
    await completeOnboarding();
    window.location.reload();
  };

  const features = [
    {
      icon: Lock,
      title: 'Your data never leaves your device',
    },
    {
      icon: Sparkles,
      title: 'Intelligent summaries & insights',
    },
    {
      icon: Cpu,
      title: 'Works offline, no cloud required',
    },
  ];

  return (
    <OnboardingContainer
      title={(
        <>
          <span>Welcome to </span>
          <span className="font-display tracking-[0.08em]">Ultra</span>
        </>
      )}
      description="Record. Transcribe. Summarize. All on your device."
      step={1}
      hideProgress={true}
    >
      <div className="flex flex-col items-center space-y-10">
        {/* Divider */}
        <div className="h-px w-16 bg-border" />

        {/* Features Card */}
        <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted">
                    <Icon className="h-3 w-3 text-muted-foreground" />
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-foreground">{feature.title}</p>
              </div>
            );
          })}
        </div>

        {/* CTA Section */}
        <div className="w-full max-w-xs space-y-3">
          <Button
            onClick={goNext}
            className="h-11 w-full"
          >
            Get Started
          </Button>
          <button
            type="button"
            onClick={() => { void handleSkip(); }}
            className="w-full text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            I'll set up later from Settings
          </button>
          <p className="text-center text-xs text-muted-foreground">Takes less than 3 minutes</p>
        </div>
      </div>
    </OnboardingContainer>
  );
}
