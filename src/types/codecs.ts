export type AudioCodecType =
  | 'MP3'
  | 'AAC_LC'
  | 'HE_AAC'
  | 'OPUS'
  | 'OGG_VORBIS'
  | 'FLAC';

export interface CodecProfile {
  type: AudioCodecType;
  displayName: string;
  mimeType: string;
  defaultBitrateKbps: number;
  supportedBitrates: number[];
  supportedSampleRates: number[];
  container: 'mp3' | 'adts' | 'ogg' | 'flac';
  description: string;
}

export const CODEC_PROFILES: Record<AudioCodecType, CodecProfile> = {
  MP3: {
    type: 'MP3',
    displayName: 'MPEG Layer-3 (MP3)',
    mimeType: 'audio/mpeg',
    defaultBitrateKbps: 128,
    supportedBitrates: [64, 96, 128, 160, 192, 256, 320],
    supportedSampleRates: [44100, 48000],
    container: 'mp3',
    description: 'Universal compatibility across all desktop, web, mobile, and hardware radio receivers.',
  },
  AAC_LC: {
    type: 'AAC_LC',
    displayName: 'Advanced Audio Coding (AAC-LC)',
    mimeType: 'audio/aac',
    defaultBitrateKbps: 96,
    supportedBitrates: [48, 64, 96, 128, 160, 192, 256],
    supportedSampleRates: [44100, 48000],
    container: 'adts',
    description: 'High audio fidelity at lower bitrates, ideal for modern streaming apps and iOS devices.',
  },
  HE_AAC: {
    type: 'HE_AAC',
    displayName: 'High-Efficiency AAC (aacPlus v2)',
    mimeType: 'audio/aacp',
    defaultBitrateKbps: 48,
    supportedBitrates: [32, 48, 64],
    supportedSampleRates: [44100, 48000],
    container: 'adts',
    description: 'Optimized for low-bandwidth cellular mobile listeners with spectral band replication.',
  },
  OPUS: {
    type: 'OPUS',
    displayName: 'Opus Audio (Ogg Opus)',
    mimeType: 'audio/ogg; codecs=opus',
    defaultBitrateKbps: 96,
    supportedBitrates: [24, 32, 48, 64, 96, 128, 160, 192],
    supportedSampleRates: [48000],
    container: 'ogg',
    description: 'State of the art open codec with ultra low latency and crystal voice clarity.',
  },
  OGG_VORBIS: {
    type: 'OGG_VORBIS',
    displayName: 'Ogg Vorbis',
    mimeType: 'audio/ogg',
    defaultBitrateKbps: 128,
    supportedBitrates: [64, 96, 128, 160, 192, 256],
    supportedSampleRates: [44100, 48000],
    container: 'ogg',
    description: 'Patent-free open source standard codec widely supported on Icecast servers.',
  },
  FLAC: {
    type: 'FLAC',
    displayName: 'Free Lossless Audio Codec (FLAC)',
    mimeType: 'audio/flac',
    defaultBitrateKbps: 1411,
    supportedBitrates: [1411],
    supportedSampleRates: [44100, 48000, 96000],
    container: 'flac',
    description: 'Bit-perfect studio master transmission for audiophile radio streams.',
  },
};
