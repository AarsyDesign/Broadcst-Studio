export type AudioSourceType =
  | 'microphone'
  | 'line_in'
  | 'system_audio'
  | 'audio_interface'
  | 'file'
  | 'playlist';

export interface AudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
  channels: number;
  sampleRate: number;
}

export interface AudioChannelStrip {
  id: string;
  name: string;
  sourceType: AudioSourceType;
  deviceId?: string;
  gainDb: number; // -60dB to +12dB
  faderLevel: number; // 0.0 to 1.0 (linear presentation)
  muted: boolean;
  solo: boolean;
  peakDb: number;
  rmsDb: number;
}

export interface MixerState {
  channels: AudioChannelStrip[];
  masterGainDb: number;
  masterMuted: boolean;
  masterPeakDb: number;
  masterRmsDb: number;
}
