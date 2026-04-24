import { useEffect, useState } from 'react';
import { FileText, Globe, MessageSquare, SlidersHorizontal } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { usePlatform } from '@/hooks/usePlatform';
import { formatRecordingTimer, formatTimeOfDay } from '@/lib/dateUtils';
import { getEffectiveAccelerator, parseAccelerator } from '@/lib/hotkeys/registry';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface TopBarProps {
  activeTab: 'notes' | 'transcript';
  onTabChange: (tab: 'notes' | 'transcript') => void;
  meetingTitle?: string;
  showTabs?: boolean;
  onLanguageClick?: () => void;
}

const tabs = [
  { id: 'notes' as const, label: 'Notes', icon: FileText },
  { id: 'transcript' as const, label: 'Transcript', icon: MessageSquare },
];

function formatHotkeyLabel(accelerator: string, isMac: boolean): string {
  const parsed = parseAccelerator(accelerator);
  const parts: string[] = [];

  if (parsed.mod) {
    parts.push(isMac ? '⌘' : 'Ctrl');
  }

  if (parsed.ctrl) {
    parts.push(isMac ? '⌃' : 'Ctrl');
  }

  if (parsed.alt) {
    parts.push(isMac ? '⌥' : 'Alt');
  }

  if (parsed.shift) {
    parts.push(isMac ? '⇧' : 'Shift');
  }

  if (parsed.meta) {
    parts.push(isMac ? '⌘' : 'Meta');
  }

  if (parsed.key) {
    parts.push(parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);
  }

  return parts.join(isMac ? '' : '+');
}

export function TopBar({ activeTab, onTabChange, meetingTitle, showTabs = true, onLanguageClick }: TopBarProps) {
  const { isRecording, recordingDuration, isPaused } = useRecordingState();
  const prefersReducedMotion = useReducedMotion();
  const platform = usePlatform();
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [tabHotkeys, setTabHotkeys] = useState(() => ({
    notes: getEffectiveAccelerator('tabNotes'),
    transcript: getEffectiveAccelerator('tabTranscript'),
  }));
  const hasMeetingTitle = Boolean(meetingTitle?.trim());
  const isMac = platform === 'macos';

  useEffect(() => {
    if (!isRecording) {
      return;
    }

    setCurrentTime(new Date());

    const intervalId = window.setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isRecording]);

  useEffect(() => {
    const syncHotkeys = () => {
      setTabHotkeys({
        notes: getEffectiveAccelerator('tabNotes'),
        transcript: getEffectiveAccelerator('tabTranscript'),
      });
    };

    syncHotkeys();
    window.addEventListener('hotkey-overrides-changed', syncHotkeys);

    return () => {
      window.removeEventListener('hotkey-overrides-changed', syncHotkeys);
    };
  }, []);

  return (
    <div className="sticky top-0 z-10 bg-background/80 px-4 py-3 backdrop-blur-sm">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex items-center">
          {showTabs ? null : (
            <Button
              variant="ghost"
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label="Open view controls"
            >
              <SlidersHorizontal className="h-5 w-5" />
            </Button>
          )}
        </div>

        <div className="min-w-0 justify-self-center">
          {showTabs ? (
            <div className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card/70 p-1 shadow-sm backdrop-blur-sm">
              {tabs.map(({ id, label, icon: Icon }) => {
                const isActive = activeTab === id;
                const hotkey = formatHotkeyLabel(tabHotkeys[id], isMac);

                return (
                  <Button
                    variant="ghost"
                    key={id}
                    onClick={() => onTabChange(id)}
                    aria-pressed={isActive}
                    className={cn(
                      'relative inline-flex min-h-11 items-center rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                      isActive ? 'text-white' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="topbar-tab-indicator"
                        className="absolute inset-0 rounded-lg bg-gradient-to-r from-[#5B4DCC] via-[#F06A8B] to-[#FFD166] shadow-[0_0_20px_rgba(91,77,204,0.35)]"
                        transition={
                          prefersReducedMotion
                            ? { duration: 0 }
                            : { type: 'spring', bounce: 0.15, duration: 0.3 }
                        }
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-1.5">
                      <Icon className="h-4 w-4" />
                      <span>{label}</span>
                      <kbd className={cn(
                        'ml-1.5 text-[10px] font-mono tabular-nums opacity-70',
                        isActive ? 'text-white/80' : 'text-muted-foreground'
                      )}>
                        {hotkey}
                      </kbd>
                    </span>
                  </Button>
                );
              })}
            </div>
          ) : null}

          {!isRecording && hasMeetingTitle ? (
            <p
              title={meetingTitle}
              className="mx-auto mt-2 max-w-full break-words px-4 text-center text-sm text-muted-foreground [overflow-wrap:anywhere]"
            >
              {meetingTitle}
            </p>
          ) : null}
        </div>

        <div className="flex min-w-0 items-center justify-self-end gap-3 text-sm">
          {isRecording ? (
            <div className="flex items-center gap-2 text-foreground">
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  isPaused ? 'bg-muted-foreground' : 'bg-destructive animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                )}
                aria-hidden="true"
              />
              <span className="font-mono font-medium tabular-nums">
                {formatRecordingTimer(recordingDuration ?? 0)}
              </span>
              <span className="text-muted-foreground">•</span>
              <span className="text-muted-foreground">{formatTimeOfDay(currentTime)}</span>
            </div>
          ) : null}

          {onLanguageClick ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open language settings"
              onClick={onLanguageClick}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-card/60 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Globe className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
