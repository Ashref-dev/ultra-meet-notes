/**
 * Markdown export utilities for meetings
 */
import type { Transcript } from '@/types';

/** Convert transcript array to markdown with timestamps */
export function transcriptToMarkdown(transcripts: Transcript[], meetingTitle?: string): string {
  const lines: string[] = [];

  if (meetingTitle) {
    lines.push(`# ${meetingTitle}`, '');
  }

  lines.push('## Transcript', '');

  for (const t of transcripts) {
    const timestamp = t.timestamp || '';
    const text = t.text?.trim() || '';

    if (!text) continue;

    lines.push(`> ${timestamp ? `[${timestamp}] ` : ''}${text}`);
  }

  return lines.join('\n');
}

/** Convert summary markdown or object to clean markdown string */
export function summaryToMarkdown(
  summary: string | Record<string, unknown>,
  meetingTitle?: string
): string {
  const lines: string[] = [];

  if (meetingTitle) {
    lines.push(`# ${meetingTitle} — Meeting Notes`, '');
  }

  if (typeof summary === 'string') {
    lines.push(summary);
  } else if (summary && typeof summary === 'object') {
    // Handle structured summary object
    for (const [key, value] of Object.entries(summary)) {
      if (key.startsWith('_')) continue;
      lines.push(`## ${key}`, '');
      if (typeof value === 'string') {
        lines.push(value, '');
      } else if (value && typeof value === 'object' && 'blocks' in (value as Record<string, unknown>)) {
        const section = value as { title?: string; blocks?: Array<{ content?: string }> };
        if (section.blocks) {
          for (const block of section.blocks) {
            if (block.content) lines.push(block.content);
          }
          lines.push('');
        }
      }
    }
  }

  return lines.join('\n');
}

/** Copy text to clipboard with fallback */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textArea);
    return success;
  }
}
