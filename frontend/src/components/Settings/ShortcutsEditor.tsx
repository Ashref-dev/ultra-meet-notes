'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { usePlatform } from '@/hooks/usePlatform';
import {
  DEFAULT_HOTKEYS,
  HOTKEY_ACTIONS,
  findConflict,
  loadOverrides,
  parseAccelerator,
  saveOverride,
  type HotkeyAction,
  validateAccelerator,
} from '@/lib/hotkeys/registry';
import { cn } from '@/lib/utils';

type HotkeyOverrides = Partial<Record<HotkeyAction, string>>;
type HotkeyErrors = Partial<Record<HotkeyAction, string>>;
type EffectiveAccelerators = Record<HotkeyAction, string>;

const MODIFIER_EVENT_KEYS = new Set(['Meta', 'Control', 'Shift', 'Alt']);

function normalizeRecordedKey(key: string): string {
  const normalized = key.toLowerCase();

  if (normalized === ' ') {
    return 'space';
  }

  return normalized;
}

function formatKeyLabel(key: string): string {
  switch (key) {
    case 'space':
      return 'Space';
    case 'escape':
      return 'Esc';
    case 'enter':
      return 'Enter';
    case 'tab':
      return 'Tab';
    case 'arrowup':
      return '↑';
    case 'arrowdown':
      return '↓';
    case 'arrowleft':
      return '←';
    case 'arrowright':
      return '→';
    case 'backspace':
      return 'Backspace';
    case 'delete':
      return 'Delete';
    default:
      return key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
  }
}

function buildAcceleratorFromEvent(event: KeyboardEvent, isMac: boolean): string {
  const parts: string[] = [];

  if (isMac) {
    if (event.metaKey) {
      parts.push('mod');
    }

    if (event.ctrlKey) {
      parts.push('ctrl');
    }
  } else {
    if (event.ctrlKey) {
      parts.push('mod');
    }

    if (event.metaKey) {
      parts.push('meta');
    }
  }

  if (event.altKey) {
    parts.push('alt');
  }

  if (event.shiftKey) {
    parts.push('shift');
  }

  if (!MODIFIER_EVENT_KEYS.has(event.key)) {
    parts.push(normalizeRecordedKey(event.key));
  }

  return parts.join('+');
}

function getEffectiveAccelerators(overrides: HotkeyOverrides): EffectiveAccelerators {
  return HOTKEY_ACTIONS.reduce((acc, action) => {
    acc[action.id] = overrides[action.id] ?? DEFAULT_HOTKEYS[action.id];
    return acc;
  }, {} as EffectiveAccelerators);
}

function getAcceleratorTokenKeys(tokens: string[]): Array<{ key: string; label: string }> {
  const counts = new Map<string, number>();

  return tokens.map((token) => {
    const count = counts.get(token) ?? 0;
    counts.set(token, count + 1);

    return {
      key: `${token}-${count}`,
      label: token,
    };
  });
}

export function ShortcutsEditor() {
  const platform = usePlatform();
  const isMac = platform === 'macos';
  const [overrides, setOverrides] = useState<HotkeyOverrides>({});
  const [recording, setRecording] = useState<HotkeyAction | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<HotkeyErrors>({});

  const syncOverrides = useCallback(() => {
    setOverrides(loadOverrides());
  }, []);

  useEffect(() => {
    syncOverrides();
    window.addEventListener('hotkey-overrides-changed', syncOverrides);

    return () => {
      window.removeEventListener('hotkey-overrides-changed', syncOverrides);
    };
  }, [syncOverrides]);

  const effectiveAccelerators = useMemo(() => getEffectiveAccelerators(overrides), [overrides]);

  const formatAccelerator = useCallback((accel: string): string[] => {
    const parsed = parseAccelerator(accel);
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
      parts.push(formatKeyLabel(parsed.key));
    }

    return parts;
  }, [isMac]);

  const clearError = useCallback((action: HotkeyAction) => {
    setErrors((current) => {
      if (!current[action]) {
        return current;
      }

      const next = { ...current };
      delete next[action];
      return next;
    });
  }, []);

  const setError = useCallback((action: HotkeyAction, message: string) => {
    setErrors((current) => ({
      ...current,
      [action]: message,
    }));
  }, []);

  useEffect(() => {
    if (!recording) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        setRecording(null);
        setPreview(null);
        return;
      }

      const nextAccelerator = buildAcceleratorFromEvent(event, isMac);

      if (!nextAccelerator) {
        return;
      }

      setPreview(nextAccelerator);

      if (MODIFIER_EVENT_KEYS.has(event.key)) {
        return;
      }

      const validation = validateAccelerator(nextAccelerator);

      if (!validation.ok) {
        setError(recording, validation.error || 'This shortcut is not valid.');
        return;
      }

      const nextAccelerators = HOTKEY_ACTIONS.reduce((acc, action) => {
        acc[action.id] = action.id === recording ? nextAccelerator : effectiveAccelerators[action.id];
        return acc;
      }, {} as Record<HotkeyAction, string>);

      const conflict = findConflict(recording, nextAccelerator, nextAccelerators);

      if (conflict) {
        const conflictAction = HOTKEY_ACTIONS.find((action) => action.id === conflict);
        setError(recording, `${conflictAction?.label || 'Another shortcut'} is already using that combination.`);
        return;
      }

      saveOverride(recording, nextAccelerator);
      clearError(recording);
      setRecording(null);
      setPreview(null);
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [clearError, effectiveAccelerators, isMac, recording, setError]);

  if (!HOTKEY_ACTIONS[0]) {
    return (
      <div className="rounded-xl border border-border bg-card/60 p-6 text-sm text-muted-foreground shadow-sm backdrop-blur-sm">
        No shortcuts are available to customize yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card/60 p-4 shadow-sm backdrop-blur-sm">
        <h3 className="text-base font-semibold text-foreground">Keyboard shortcuts</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Record a new shortcut for each action. Changes apply instantly and stay on this device.
        </p>
      </div>

      <div className="space-y-3">
        {HOTKEY_ACTIONS.map((action) => {
          const isRecording = recording === action.id;
          const hasOverride = Boolean(overrides[action.id]);
          const accelerator = isRecording && preview ? preview : effectiveAccelerators[action.id];
          const tokens = accelerator ? getAcceleratorTokenKeys(formatAccelerator(accelerator)) : [];

          return (
            <div
              key={action.id}
              className={cn(
                'rounded-xl border border-border bg-card/60 p-4 shadow-sm backdrop-blur-sm transition-[border-color,background-color] duration-200 motion-reduce:transition-none',
                isRecording ? 'border-foreground/30 bg-card/80' : 'hover:border-foreground/20'
              )}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-foreground">{action.label}</h4>
                    {hasOverride ? (
                      <span className="rounded-lg border border-border bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        Custom
                      </span>
                    ) : (
                      <span className="rounded-lg border border-border bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="max-w-2xl text-sm text-muted-foreground">{action.description}</p>
                </div>

                <div className="flex flex-col items-start gap-3 lg:items-end">
                  <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-lg border border-border bg-background/80 px-3 py-2 shadow-sm">
                    {isRecording && !preview ? (
                        <kbd className="rounded-lg bg-muted px-3 py-1 text-xs font-medium text-foreground">Press keys...</kbd>
                    ) : (
                      tokens.map((token, index) => (
                        <div key={`${action.id}-${accelerator}-${token.key}`} className="flex items-center gap-2">
                          {index > 0 ? <span className="text-xs text-muted-foreground">+</span> : null}
                          <kbd className="rounded-lg border border-border bg-muted/80 px-3 py-1 text-xs font-medium text-foreground shadow-sm">
                            {token.label}
                          </kbd>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setRecording(action.id);
                        setPreview(null);
                      }}
                      className={cn(
                        'min-h-11 rounded-lg border-border bg-background/80 px-4 text-sm shadow-sm transition-[transform,background-color,border-color] duration-200 motion-reduce:transition-none motion-safe:active:scale-[0.98]',
                        isRecording ? 'border-foreground/40 bg-muted' : 'hover:bg-muted'
                      )}
                    >
                      {isRecording ? 'Recording…' : 'Record'}
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      disabled={!hasOverride}
                      onClick={() => {
                        saveOverride(action.id, null);
                        clearError(action.id);

                        if (recording === action.id) {
                          setRecording(null);
                          setPreview(null);
                        }
                      }}
                      className="min-h-11 rounded-lg px-4 text-sm text-muted-foreground transition-[transform,background-color,color] duration-200 hover:bg-muted hover:text-foreground motion-reduce:transition-none motion-safe:active:scale-[0.98]"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Reset
                    </Button>
                  </div>
                </div>
              </div>

              {errors[action.id] ? (
                <p
                  className="mt-3 max-w-xl text-sm text-destructive"
                  style={{
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 2,
                    overflow: 'hidden',
                  }}
                >
                  {errors[action.id]}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
