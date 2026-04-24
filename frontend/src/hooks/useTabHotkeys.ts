import { useCallback, useEffect, useState } from 'react';
import { getEffectiveAccelerator, type HotkeyAction, matchesEvent } from '@/lib/hotkeys/registry';

type TabId = 'notes' | 'transcript';

type ResolveHotkey = (action: HotkeyAction) => string;
type HotkeyBindings = Record<HotkeyAction, string>;

const defaultResolveHotkey: ResolveHotkey = (action) => getEffectiveAccelerator(action);

function getBindings(resolveHotkey: ResolveHotkey): HotkeyBindings {
  return {
    tabNotes: resolveHotkey('tabNotes'),
    tabTranscript: resolveHotkey('tabTranscript'),
  };
}

function isEditableElement(element: Element | null): boolean {
  if (!element) {
    return false;
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return true;
  }

  return element instanceof HTMLElement && element.isContentEditable;
}

export function useTabHotkeys(
  setActiveTab: (tab: TabId) => void,
  resolveHotkey: ResolveHotkey = defaultResolveHotkey,
): void {
  const [bindings, setBindings] = useState<HotkeyBindings>(() => getBindings(resolveHotkey));

  useEffect(() => {
    setBindings(getBindings(resolveHotkey));
  }, [resolveHotkey]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (isEditableElement(document.activeElement)) {
      return;
    }

    const hotkeyToTab: Array<[HotkeyAction, TabId]> = [
      ['tabNotes', 'notes'],
      ['tabTranscript', 'transcript'],
    ];

    for (const [action, tab] of hotkeyToTab) {
      const accelerator = bindings[action];

      if (matchesEvent(accelerator, event)) {
        event.preventDefault();
        setActiveTab(tab);
        return;
      }
    }
  }, [bindings, setActiveTab]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  useEffect(() => {
    const handleHotkeyOverridesChanged = () => {
      setBindings(getBindings(resolveHotkey));
    };

    window.addEventListener('hotkey-overrides-changed', handleHotkeyOverridesChanged);

    return () => {
      window.removeEventListener('hotkey-overrides-changed', handleHotkeyOverridesChanged);
    };
  }, [resolveHotkey]);
}
