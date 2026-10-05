export type TranscriptState =
  | 'IDLE'
  | 'STARTING'
  | 'LISTENING'
  | 'PROCESSING'
  | 'PAUSED'
  | 'ERROR'
  | 'COMPLETED';

export type TranscriptProviderType = 'local_whisper' | 'web_speech' | 'cloud_openai' | 'custom_adapter';

export interface TranscriptConfig {
  provider: TranscriptProviderType;
  modelName: string;
  language: string;
  isLocal: boolean;
  autoScroll: boolean;
}

export interface TranscriptSegment {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
  language?: string;
  speaker?: string;
  finalized: boolean;
}

export interface TranscriptStatus {
  state: TranscriptState;
  activeSegmentId?: string;
  segmentsCount: number;
  config: TranscriptConfig;
  lastErrorMessage?: string;
}
