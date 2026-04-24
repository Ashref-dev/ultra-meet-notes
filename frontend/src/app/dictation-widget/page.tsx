'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Mic, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

type WidgetState = 'idle' | 'recording' | 'processing' | 'success' | 'error';

interface WidgetPayload {
  state: WidgetState;
  message: string;
  transcript?: string;
  hotkey: string;
}

const DEFAULT_PAYLOAD: WidgetPayload = {
  state: 'idle',
  message: 'Press hotkey to start dictation',
  hotkey: 'fn+space',
};

const DRAG_REGION_STYLE = { WebkitAppRegion: 'drag' } as CSSProperties;

function StateIcon({ state }: { state: WidgetState }) {
  if (state === 'recording') {
    return <Mic className="w-4 h-4 text-destructive" />;
  }
  if (state === 'processing') {
    return <Loader2 className="w-4 h-4 text-accent animate-spin" />;
  }
  if (state === 'success') {
    return <CheckCircle2 className="w-4 h-4 text-success" />;
  }
  if (state === 'error') {
    return <AlertCircle className="w-4 h-4 text-warning" />;
  }
  return <Mic className="w-4 h-4 text-muted-foreground" />;
}

export default function DictationWidgetPage() {
  const [payload, setPayload] = useState<WidgetPayload>(DEFAULT_PAYLOAD);

  useEffect(() => {
    let mounted = true;

    invoke<string>('dictation_get_hotkey')
      .then((hotkey) => {
        if (!mounted) return;
        setPayload((prev) => ({ ...prev, hotkey }));
      })
      .catch(() => {
        // Ignore bootstrap read failures.
      });

    const unlistenPromise = listen<WidgetPayload>('dictation-widget-update', (event) => {
      if (!mounted) return;
      setPayload((prev) => ({
        ...prev,
        ...event.payload,
      }));
    });

    return () => {
      mounted = false;
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{ background: 'transparent' }}
      data-tauri-drag-region
    >
      <div
        className="w-[392px] rounded-xl border border-border bg-card/90 backdrop-blur-xl shadow-lg px-4 py-3.5"
        style={DRAG_REGION_STYLE}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <StateIcon state={payload.state} />
            <div className="min-w-0">
               <p className="text-[13px] font-semibold text-foreground truncate">{payload.message}</p>
               <p className="text-[11px] text-muted-foreground mt-0.5">
                 Hold <span className="font-medium text-foreground">{payload.hotkey}</span>
              </p>
            </div>
          </div>

          <span className="text-[10px] px-2 py-1 rounded-lg bg-muted text-muted-foreground uppercase tracking-wide">
            Dictation
          </span>
        </div>

        {payload.transcript && (
          <p className="mt-2 text-[12px] leading-5 text-foreground bg-muted rounded-lg px-2.5 py-2 min-h-0 line-clamp-2 break-words">
            {payload.transcript}
          </p>
        )}
      </div>
    </div>
  );
}
