/**
 * Broadcst Studio Plugin API Specifications & Constants
 */

export const PLUGIN_API_VERSION = 1;
export const SUPPORTED_API_VERSIONS: readonly number[] = [1];

/**
 * Standard realtime audio specifications for Broadcst Studio
 */
export const AUDIO_SPECS = {
  CANONICAL_SAMPLE_RATE: 48000,
  CANONICAL_CHANNELS: 2,
  CANONICAL_BUFFER_SIZE: 512,
  BIT_DEPTH: 32, // Float32
} as const;
