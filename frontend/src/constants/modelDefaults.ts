/**
 * Default model names for transcription engines.
 * IMPORTANT: Keep in sync with Rust constants in src-tauri/src/config.rs
 */

/**
 * Default Whisper model for transcription when no preference is configured.
 * This is the recommended balance of accuracy and speed.
 */
export const DEFAULT_WHISPER_MODEL = 'large-v3-turbo';

/**
 * Default transcription provider when no preference is configured.
 */
export const DEFAULT_TRANSCRIPT_PROVIDER = 'localWhisper' as const;

/**
 * Default Parakeet model for transcription when no preference is configured.
 * This is the quantized version optimized for speed.
 */
export const DEFAULT_PARAKEET_MODEL = 'parakeet-tdt-0.6b-v3-int8';

/**
 * Model defaults by provider type
 */
export const MODEL_DEFAULTS = {
  whisper: DEFAULT_WHISPER_MODEL,
  localWhisper: DEFAULT_WHISPER_MODEL,
  parakeet: DEFAULT_PARAKEET_MODEL,
} as const;

export function getDefaultTranscriptionModel(provider?: string): string {
  if (provider === 'parakeet') {
    return DEFAULT_PARAKEET_MODEL;
  }

  if (provider === 'localWhisper' || provider === 'whisper' || !provider) {
    return DEFAULT_WHISPER_MODEL;
  }

  return '';
}
