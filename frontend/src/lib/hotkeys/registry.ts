export const HOTKEY_ACTIONS = [
  {
    id: 'tabNotes',
    label: 'Open notes tab',
    description: 'Jump to the Notes tab from meeting and editor screens.',
  },
  {
    id: 'tabTranscript',
    label: 'Open transcript tab',
    description: 'Jump to the Transcript tab without reaching for the mouse.',
  },
] as const;

export type HotkeyAction = (typeof HOTKEY_ACTIONS)[number]['id'];

export const HOTKEY_OVERRIDES_STORAGE_KEY = 'ultra-meet.hotkey-overrides';

export const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = {
  tabNotes: 'mod+shift+1',
  tabTranscript: 'mod+shift+2',
};

const VALID_ACTION_IDS = new Set<HotkeyAction>(HOTKEY_ACTIONS.map((action) => action.id));
const RESERVED_PRIMARY_KEYS = new Set(['a', 'c', 'q', 'v', 'w', 'z']);
const MODIFIER_KEYS = new Set(['mod', 'meta', 'cmd', 'command', 'ctrl', 'control', 'shift', 'alt', 'option']);

export interface ParsedAccelerator {
  mod: boolean;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('mac');
}

function splitAccelerator(accel: string): string[] {
  return accel
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeEventKey(key: string): string {
  const normalizedKey = key.toLowerCase();

  if (normalizedKey === ' ') {
    return 'space';
  }

  return normalizedKey;
}

function normalizeAccelerator(accel: string): string {
  const parsed = parseAccelerator(accel);
  const parts: string[] = [];

  if (parsed.mod) {
    parts.push('mod');
  }

  if (parsed.ctrl) {
    parts.push('ctrl');
  }

  if (parsed.alt) {
    parts.push('alt');
  }

  if (parsed.shift) {
    parts.push('shift');
  }

  if (parsed.meta) {
    parts.push('meta');
  }

  if (parsed.key) {
    parts.push(parsed.key);
  }

  return parts.join('+');
}

export function parseAccelerator(accel: string): ParsedAccelerator {
  const normalizedParts = splitAccelerator(accel);

  const parsed: ParsedAccelerator = {
    mod: false,
    meta: false,
    ctrl: false,
    shift: false,
    alt: false,
    key: '',
  };

  normalizedParts.forEach((part) => {
    switch (part) {
      case 'mod':
        parsed.mod = true;
        break;
      case 'meta':
      case 'cmd':
      case 'command':
        parsed.meta = true;
        break;
      case 'ctrl':
      case 'control':
        parsed.ctrl = true;
        break;
      case 'shift':
        parsed.shift = true;
        break;
      case 'alt':
      case 'option':
        parsed.alt = true;
        break;
      default:
        parsed.key = normalizeEventKey(part);
        break;
    }
  });

  return parsed;
}

export function loadOverrides(): Partial<Record<HotkeyAction, string>> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const rawOverrides = window.localStorage.getItem(HOTKEY_OVERRIDES_STORAGE_KEY);

    if (!rawOverrides) {
      return {};
    }

    const parsedOverrides = JSON.parse(rawOverrides);

    if (!parsedOverrides || typeof parsedOverrides !== 'object') {
      return {};
    }

    const overrides: Partial<Record<HotkeyAction, string>> = {};

    for (const [action, value] of Object.entries(parsedOverrides)) {
      if (!VALID_ACTION_IDS.has(action as HotkeyAction) || typeof value !== 'string') {
        continue;
      }

      const normalizedValue = normalizeAccelerator(value);

      if (normalizedValue) {
        overrides[action as HotkeyAction] = normalizedValue;
      }
    }

    return overrides;
  } catch {
    return {};
  }
}

export function saveOverride(action: HotkeyAction, accelerator: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  const overrides = loadOverrides();

  if (accelerator) {
    overrides[action] = normalizeAccelerator(accelerator);
  } else {
    delete overrides[action];
  }

  window.localStorage.setItem(HOTKEY_OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
  window.dispatchEvent(new CustomEvent('hotkey-overrides-changed'));
}

export function getEffectiveAccelerator(action: HotkeyAction): string {
  const overrides = loadOverrides();
  return overrides[action] ?? DEFAULT_HOTKEYS[action];
}

export function validateAccelerator(accel: string): { ok: boolean; error?: string } {
  const parts = splitAccelerator(accel);
  const normalizedAccelerator = normalizeAccelerator(accel);

  if (!normalizedAccelerator) {
    return {
      ok: false,
      error: 'Press at least one modifier and one key to create a shortcut.',
    };
  }

  const keyParts = parts.filter((part) => !MODIFIER_KEYS.has(part));
  const modifierCount = parts.length - keyParts.length;

  if (modifierCount === 0) {
    return {
      ok: false,
      error: 'Shortcuts need a modifier key like ⌘, Ctrl, Alt, or Shift.',
    };
  }

  if (keyParts.length !== 1) {
    return {
      ok: false,
      error: 'Shortcuts must include exactly one non-modifier key.',
    };
  }

  const parsed = parseAccelerator(normalizedAccelerator);
  const usesPrimaryModifier = parsed.mod || parsed.meta || parsed.ctrl;
  const usesOnlyPrimaryModifier = usesPrimaryModifier && !parsed.alt && !parsed.shift;

  if (usesOnlyPrimaryModifier && RESERVED_PRIMARY_KEYS.has(parsed.key)) {
    return {
      ok: false,
      error: 'That shortcut is reserved by your system or standard editing actions. Try a different combination.',
    };
  }

  return { ok: true };
}

export function findConflict(
  action: HotkeyAction,
  accelerator: string,
  allOverrides: Record<HotkeyAction, string>
): HotkeyAction | null {
  const normalizedTarget = normalizeAccelerator(accelerator);

  for (const [candidateAction, candidateAccelerator] of Object.entries(allOverrides) as Array<[HotkeyAction, string]>) {
    if (candidateAction === action) {
      continue;
    }

    if (normalizeAccelerator(candidateAccelerator) === normalizedTarget) {
      return candidateAction;
    }
  }

  return null;
}

export function matchesEvent(accel: string, event: KeyboardEvent): boolean {
  const { mod, meta, ctrl, shift, alt, key } = parseAccelerator(accel);

  if (!key) {
    return false;
  }

  const isMac = isMacPlatform();
  const expectedMeta = meta || (mod && isMac);
  const expectedCtrl = ctrl || (mod && !isMac);

  return (
    event.metaKey === expectedMeta &&
    event.ctrlKey === expectedCtrl &&
    event.shiftKey === shift &&
    event.altKey === alt &&
    normalizeEventKey(event.key) === key
  );
}
