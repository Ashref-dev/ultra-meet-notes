'use client';

import { Suspense, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { Mic, X } from 'lucide-react';
import { toast } from 'sonner';
import Logo from '@/components/Logo';

function BannerContent() {
  const searchParams = useSearchParams();
  const appName = searchParams.get('app') || 'Meeting';
  const [actionError, setActionError] = useState<string | null>(null);

  const handleStart = async () => {
    try {
      setActionError(null);
      await invoke('accept_meeting_banner');
    } catch (e) {
      console.error('Failed to accept banner:', e);
      setActionError('Could not start transcription. Please open Ultra and try again.');
      toast.error('Could not start transcription', {
        description: 'Open Ultra and try again from the banner.',
      });
    }
  };

  const handleDismiss = async () => {
    try {
      setActionError(null);
      await invoke('dismiss_meeting_banner');
    } catch (e) {
      console.error('Failed to dismiss banner:', e);
      setActionError('Could not dismiss the banner. Please retry from Ultra.');
      toast.error('Could not dismiss banner', {
        description: 'Please retry from Ultra.',
      });
    }
  };

  return (
    <div
      className="w-full h-full flex items-center justify-center select-none"
      style={{ background: 'transparent' }}
      data-tauri-drag-region
    >
        <div
          className="flex items-center gap-3 rounded-xl border border-border bg-background py-2 pl-4 pr-2 text-foreground"
          style={{ WebkitAppRegion: 'drag' } as CSSProperties}
        >
        {/* App icon */}
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-muted flex items-center justify-center">
          <Logo size={96} showDialog={false} className="[&_img]:h-6 [&_img]:w-6" />
        </div>

        {/* Text */}
        <div className="mr-1 flex min-w-0 flex-col leading-tight">
          <span className="text-[13px] font-semibold">
            Start AI Meeting Note
          </span>
          <span className="text-[11px] text-muted-foreground">
            {appName} meeting detected
          </span>
          {actionError ? (
            <span className="mt-1 max-w-[18rem] text-[11px] text-destructive">
              {actionError}
            </span>
          ) : null}
        </div>

        {/* Start button */}
        <button
          type="button"
          onClick={handleStart}
          className="cursor-pointer whitespace-nowrap rounded-lg bg-accent px-4 py-1.5 text-[13px] font-medium text-accent-foreground transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-accent/80"
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
        >
          <Mic className="w-3.5 h-3.5" />
          Start transcribing
        </button>

        {/* Dismiss */}
        <button
          type="button"
          onClick={handleDismiss}
          className="flex-shrink-0 cursor-pointer rounded-lg p-1.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

export default function MeetingBannerPage() {
  return (
    <Suspense>
      <BannerContent />
    </Suspense>
  );
}
