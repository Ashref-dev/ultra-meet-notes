'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Mic, Sparkles } from 'lucide-react';
import { formatRecordingTimer } from '@/lib/dateUtils';

interface NotesRecordingStateProps {
  recordingDuration: number;
  isPaused: boolean;
}

export function NotesRecordingState({ recordingDuration, isPaused }: NotesRecordingStateProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="flex h-full items-center justify-center px-6">
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.4, ease: 'easeOut' }}
        className="flex max-w-md flex-col items-center gap-4 rounded-xl bg-card/60 p-8 text-center shadow-sm backdrop-blur-sm"
      >
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[#5B4DCC]/10 to-[#FFD166]/10">
          <Mic className="h-8 w-8 text-primary" />
          {!isPaused && !prefersReducedMotion && (
            <motion.span
              className="absolute inset-0 rounded-full bg-gradient-to-r from-[#5B4DCC]/20 to-[#FFD166]/20"
              animate={{ scale: [1, 1.25, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <h2 className="flex items-center justify-center gap-2 text-lg font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Live transcription in progress
          </h2>
          <p className="text-sm text-muted-foreground">
            Your AI summary, action items, and decisions will appear here once you stop the recording.
          </p>
          <p className="pt-1 font-mono text-xs text-muted-foreground">
            {isPaused ? 'Paused' : 'Recording'} • {formatRecordingTimer(recordingDuration)}
          </p>
        </div>
      </motion.div>
    </div>
  );
}
