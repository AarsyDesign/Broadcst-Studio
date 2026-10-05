import { TranscriptConfig, TranscriptSegment } from '../../types/transcript';

export interface TranscriptionProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;

  initialize(config: TranscriptConfig): Promise<void>;
  start(onSegment: (segment: TranscriptSegment) => void): Promise<void>;
  pushAudioChunk(chunk: Float32Array): void;
  stop(): Promise<void>;
}
