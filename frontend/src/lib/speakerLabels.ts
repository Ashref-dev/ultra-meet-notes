const SPEAKER_COLORS = [
  'border-primary/20 bg-primary/10 text-primary',
  'border-primary/20 bg-primary/10 text-primary',
  'border-teal-500/20 bg-teal-500/10 text-teal-700 dark:text-teal-300',
  'border-pink-500/20 bg-pink-500/10 text-pink-700 dark:text-pink-300',
];

const PLACEHOLDER_SPEAKER_LABELS = new Set(['unknown']);

function extractSpeakerIndex(speaker: string): number | null {
  const normalized = speaker.trim();
  if (!normalized) {
    return null;
  }

  const numeric = normalized.match(/(\d+)/);
  if (!numeric) {
    return null;
  }

  const parsed = Number.parseInt(numeric[1], 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatSpeakerLabel(speaker?: string): string | null {
  if (!speaker) {
    return null;
  }

  const normalized = speaker.trim();
  if (!normalized) {
    return null;
  }

   if (PLACEHOLDER_SPEAKER_LABELS.has(normalized.toLowerCase())) {
    return null;
  }

  if (/^speaker\s+\d+$/i.test(normalized)) {
    return normalized.replace(/^speaker/i, 'Speaker');
  }

  if (/^speaker_\d+$/i.test(normalized)) {
    const index = extractSpeakerIndex(normalized);
    return index == null ? normalized : `Speaker ${index + 1}`;
  }

  if (/^\d+$/.test(normalized)) {
    const index = Number.parseInt(normalized, 10);
    return Number.isNaN(index) ? normalized : `Speaker ${index + 1}`;
  }

  return normalized;
}

export function hasMultipleSpeakers(items: Array<{ speaker?: string | null }>): boolean {
  const labels = new Set<string>();

  for (const item of items) {
    const label = formatSpeakerLabel(item.speaker ?? undefined);
    if (!label) {
      continue;
    }

    labels.add(label);
    if (labels.size >= 2) {
      return true;
    }
  }

  return false;
}

export function speakerColor(label: string): string {
  const index = extractSpeakerIndex(label) ?? 0;
  return SPEAKER_COLORS[index % SPEAKER_COLORS.length];
}
