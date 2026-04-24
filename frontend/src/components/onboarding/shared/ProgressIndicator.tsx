import React from 'react';
import { Check, Lock, Download, CheckCircle2, BrainCircuit } from 'lucide-react';

interface ProgressIndicatorProps {
  current: number;
  total: number;
  onStepClick?: (step: number) => void;
}

const stepIcons = [
  Lock,         // 1. Welcome
  BrainCircuit, // 2. Setup Overview
  Download,     // 3. Download Progress
  // Step 4 (Permissions) doesn't need icon - auto-skipped on non-macOS
];

export function ProgressIndicator({ current, total, onStepClick }: ProgressIndicatorProps) {
  const visibleSteps = Array.from({ length: total }, (_, i) => i + 1);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-center gap-2">
        {visibleSteps.map((step, index) => {
          const isActive = step === current;
          const isCompleted = step < current;
          const isClickable = isCompleted && onStepClick;
          const StepIcon = stepIcons[step - 1] || CheckCircle2;

          return (
            <React.Fragment key={step}>
              {/* Step Circle */}
              <button
                onClick={() => isClickable && onStepClick(step)}
                disabled={!isClickable}
                className={`relative flex items-center justify-center transition-all duration-300 ${
                  isCompleted
                    ? 'h-7 w-7 rounded-full bg-accent'
                    : isActive
                      ? 'h-8 w-8 rounded-full bg-foreground'
                      : 'h-6 w-6 rounded-full bg-border'
                } ${isClickable ? 'cursor-pointer hover:scale-110 hover:shadow-md' : 'cursor-default'}`}
              >
                {isCompleted ? (
                  <Check className="h-4 w-4 text-accent-foreground" />
                ) : (
                  <StepIcon
                    className={`transition-all duration-300 ${
                      isActive ? 'h-4 w-4 text-background' : 'h-3 w-3 text-muted-foreground'
                    }`}
                  />
                )}
              </button>

              {/* Connector Line */}
              {index < visibleSteps.length - 1 && (
                <div
                  className={`h-0.5 w-6 transition-all duration-300 ${
                    isCompleted ? 'bg-accent' : 'bg-border'
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
