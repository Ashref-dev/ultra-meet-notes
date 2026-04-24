import type { DiarizationSegment } from '@/types';

const BACKEND_URL = 'http://localhost:5167';

export interface DiarizeOptions {
  hfToken: string;
  numSpeakers?: number;
  minSpeakers?: number;
  maxSpeakers?: number;
}

export interface DiarizeResult {
  status: 'success' | 'error';
  segments: DiarizationSegment[];
  num_speakers: number;
}

export async function diarizeAudioFile(
  audioFilePath: string,
  options: DiarizeOptions,
): Promise<DiarizeResult> {
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const fileBytes = await readFile(audioFilePath);

  const formData = new FormData();
  const blob = new Blob([fileBytes], { type: 'audio/mp4' });
  formData.append('file', blob, 'audio.mp4');
  formData.append('hf_token', options.hfToken);

  if (options.numSpeakers != null) {
    formData.append('num_speakers', String(options.numSpeakers));
  }
  if (options.minSpeakers != null) {
    formData.append('min_speakers', String(options.minSpeakers));
  }
  if (options.maxSpeakers != null) {
    formData.append('max_speakers', String(options.maxSpeakers));
  }

  const response = await fetch(`${BACKEND_URL}/diarize`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Diarization request failed' }));
    throw new Error(error.detail || `Diarization failed with status ${response.status}`);
  }

  return response.json();
}

export function mergeDiarizationWithTranscripts<
  T extends { audio_start_time?: number; audio_end_time?: number },
>(transcripts: T[], segments: DiarizationSegment[]): (T & { speaker?: string })[] {
  if (!segments.length) return transcripts;

  return transcripts.map((t) => {
    if (t.audio_start_time == null) return t;

    const midpoint = t.audio_start_time + ((t.audio_end_time ?? t.audio_start_time) - t.audio_start_time) / 2;

    let bestSegment: DiarizationSegment | null = null;
    let bestOverlap = 0;

    for (const seg of segments) {
      const overlapStart = Math.max(t.audio_start_time, seg.start);
      const overlapEnd = Math.min(t.audio_end_time ?? t.audio_start_time, seg.end);
      const overlap = Math.max(0, overlapEnd - overlapStart);

      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSegment = seg;
      }
    }

    if (!bestSegment) {
      for (const seg of segments) {
        if (midpoint >= seg.start && midpoint <= seg.end) {
          bestSegment = seg;
          break;
        }
      }
    }

    return {
      ...t,
      speaker: bestSegment?.speaker
        ? bestSegment.speaker.replace('SPEAKER_', 'Speaker ')
        : undefined,
    };
  });
}
