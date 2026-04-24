import React, { useEffect } from 'react';
import { useOnboarding } from '@/contexts/OnboardingContext';
import {
  WelcomeStep,
  PermissionsStep,
  DownloadProgressStep,
  SetupOverviewStep,
  ModelChoiceStep,
} from './steps';

interface OnboardingFlowProps {
  onComplete: () => void;
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  void onComplete;
  const { currentStep } = useOnboarding();
  const [isMac, setIsMac] = React.useState(false);

  useEffect(() => {
    // Check if running on macOS
    const checkPlatform = async () => {
      try {
        // Dynamic import to avoid SSR issues if any
        const { platform } = await import('@tauri-apps/plugin-os');
        setIsMac(platform() === 'macos');
      } catch (e) {
        console.error('Failed to detect platform:', e);
        // Fallback
        setIsMac(navigator.userAgent.includes('Mac'));
      }
    };
    checkPlatform();
  }, []);

  // 5-Step Onboarding Flow:
  // Step 1: Welcome - Introduce Ultra features
  // Step 2: Setup Overview - Explain downloads and next-step model choice
  // Step 3: Model Choice - Pick Parakeet or Whisper, optionally skip summary model
  // Step 4: Download Progress - Download only the selected models
  // Step 5: Permissions - Request mic + system audio (macOS only)

  return (
    <div className="onboarding-flow">
      {currentStep === 1 && <WelcomeStep />}
      {currentStep === 2 && <SetupOverviewStep />}
      {currentStep === 3 && <ModelChoiceStep />}
      {currentStep === 4 && <DownloadProgressStep />}
      {currentStep === 5 && isMac && <PermissionsStep />}
    </div>
  );
}
