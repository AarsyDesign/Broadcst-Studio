import { BroadcastStatus, ShoutcastConfig, TrackMetadata } from './broadcast';
import { AudioDevice } from './audio';
import { AudioMetrics, StreamMetrics, TelemetrySnapshot } from './telemetry';
import { TranscriptConfig, TranscriptSegment, TranscriptStatus } from './transcript';

export interface CommandMap {
  // Broadcast Controls
  'broadcast.start': { params: { config?: ShoutcastConfig }; result: BroadcastStatus };
  'broadcast.stop': { params: void; result: BroadcastStatus };
  'broadcast.reconnect': { params: void; result: BroadcastStatus };
  'broadcast.get_status': { params: void; result: BroadcastStatus };

  // Audio Controls
  'audio.get_devices': { params: void; result: AudioDevice[] };
  'audio.set_gain': { params: { channelId: string; gainDb: number }; result: void };
  'audio.set_fader': { params: { channelId: string; level: number }; result: void };
  'audio.mute': { params: { channelId: string; muted: boolean }; result: void };
  'audio.get_metrics': { params: void; result: AudioMetrics };

  // Stream & Telemetry
  'stream.get_metrics': { params: void; result: StreamMetrics };
  'telemetry.get_snapshot': { params: void; result: TelemetrySnapshot };

  // Transcription
  'transcript.start': { params: { config?: TranscriptConfig }; result: TranscriptStatus };
  'transcript.stop': { params: void; result: TranscriptStatus };
  'transcript.get_segments': { params: { limit?: number; sinceMs?: number }; result: TranscriptSegment[] };

  // Recording
  'recording.start': { params: void; result: { id: string; startedAt: string } };
  'recording.stop': { params: void; result: { id: string; durationSeconds: number; filePath: string } };

  // Metadata
  'metadata.set': { params: { metadata: TrackMetadata }; result: void };
}

export type CommandName = keyof CommandMap;

export interface EventMap {
  'broadcast.status.changed': BroadcastStatus;
  'audio.level.changed': { channelId: string; peakDb: number; rmsDb: number };
  'audio.device.changed': AudioDevice[];
  'stream.metrics.changed': StreamMetrics;
  'transcript.segment.created': TranscriptSegment;
  'recording.completed': { id: string; durationSeconds: number; filePath: string };
  'plugin.status.changed': { pluginId: string; status: string };
}

export type EventName = keyof EventMap;
