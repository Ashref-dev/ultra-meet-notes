'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { FileQuestion, Sparkles } from 'lucide-react';
import { GradientPillButton } from '@/components/ui/gradient-pill-button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface EmptyStateSummaryProps {
  onGenerate: () => void;
  hasModel: boolean;
  isGenerating?: boolean;
  promptValue?: string;
  onPromptChange?: (value: string) => void;
}

export function EmptyStateSummary({
  onGenerate,
  hasModel,
  isGenerating = false,
  promptValue = '',
  onPromptChange,
}: EmptyStateSummaryProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.95 }}
      animate={prefersReducedMotion ? false : { opacity: 1, scale: 1 }}
      transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col items-center justify-center h-full p-8 text-center"
    >
      <FileQuestion className="mb-4 h-16 w-16 text-muted-foreground/40" />
      {onPromptChange && (
        <div className="mb-6 flex w-full max-w-md flex-col items-start gap-2 text-left">
          <label htmlFor="ai-summary-context" className="text-sm font-medium text-foreground">
            Add context for AI summary
          </label>
          <textarea
            id="ai-summary-context"
            placeholder="Add context for AI summary. For example people involved, meeting overview, objective etc..."
            className="min-h-[96px] max-h-[240px] w-full resize-y rounded-xl bg-card/60 p-4 text-sm text-foreground shadow-sm backdrop-blur-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={promptValue}
            onChange={(event) => onPromptChange(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Optional. Example: people involved, meeting overview, objective, etc.
          </p>
        </div>
      )}
      <h3 className="mb-2 text-lg font-semibold text-foreground">
        No Summary Generated Yet
      </h3>
      <p className="mb-6 max-w-md text-sm text-muted-foreground">
        Generate an AI-powered summary of your meeting transcript to get key points, action items, and decisions.
      </p>

      <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <GradientPillButton
                  variant="pill"
                  onClick={onGenerate}
                  loading={isGenerating}
                  disabled={!hasModel || isGenerating}
                  icon={<Sparkles className="h-4 w-4" />}
                >
                  Generate Summary
                </GradientPillButton>
              </div>
            </TooltipTrigger>
            {!hasModel && (
            <TooltipContent>
              <p>Please select a model in Settings first</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>

      {!hasModel && (
        <p className="mt-3 text-xs text-muted-foreground">
          Please select a model in Settings first
        </p>
      )}
    </motion.div>
  );
}
