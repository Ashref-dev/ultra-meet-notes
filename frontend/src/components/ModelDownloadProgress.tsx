import React from 'react';
import { ModelStatus } from '../lib/whisper';

interface ModelDownloadProgressProps {
  status: ModelStatus;
  modelName: string;
  onCancel?: () => void;
}

export function ModelDownloadProgress({ status, modelName, onCancel }: ModelDownloadProgressProps) {
  if (typeof status !== 'object' || !('Downloading' in status)) {
    return null;
  }

  const progress = status.Downloading;
  const isCompleted = progress >= 100;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-foreground"></div>
          <span className="text-sm font-medium text-foreground">
            {isCompleted ? 'Finalizing...' : `Downloading ${modelName}`}
          </span>
        </div>
      </div>
      
      <div className="relative">
        <div className="h-2 w-full rounded-lg bg-muted">
          <div 
            className="h-2 rounded-lg bg-accent transition-all duration-300 ease-out"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>{Math.round(progress)}% complete</span>
          {!isCompleted && (
            <span className="animate-pulse">Downloading...</span>
          )}
        </div>
      </div>
      
      {isCompleted && (
        <div className="mt-2 text-xs text-foreground">
          Download completed, loading model...
        </div>
      )}
    </div>
  );
}

interface ProgressRingProps {
  progress: number;
  size?: number;
  strokeWidth?: number;
}

export function ProgressRing({ progress, size = 40, strokeWidth = 3 }: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDasharray = circumference;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transform -rotate-90"
        aria-hidden="true"
        focusable="false"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          fill="transparent"
          style={{ stroke: 'hsl(var(--border))' }}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="transparent"
          className="transition-all duration-300 ease-in-out"
          style={{ stroke: 'hsl(var(--accent))' }}
        />
      </svg>
      <span className="absolute text-xs font-medium text-foreground">
        {Math.round(progress)}%
      </span>
    </div>
  );
}

interface DownloadSummaryProps {
  totalModels: number;
  downloadedModels: number;
  totalSizeMb: number;
}

export function DownloadSummary({ totalModels, downloadedModels, totalSizeMb }: DownloadSummaryProps) {
  const formatSize = (mb: number) => {
    if (mb >= 1000) return `${(mb / 1000).toFixed(1)}GB`;
    return `${mb}MB`;
  };

  return (
    <div className="rounded-xl border border-border bg-card p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-foreground">
          {downloadedModels} of {totalModels} models available
        </span>
        <span className="text-muted-foreground">
          {formatSize(totalSizeMb)} total
        </span>
      </div>
      {downloadedModels > 0 && (
        <div className="mt-1 text-xs text-muted-foreground">
          Models run locally with no internet required for transcription
        </div>
      )}
    </div>
  );
}
