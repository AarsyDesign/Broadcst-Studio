import { BroadcastStatus, ShoutcastConfig, TrackMetadata } from './broadcast';
import { AudioDevice } from './audio';
export type { AudioDevice } from './audio';
import { AudioMetrics, StreamMetrics, TelemetrySnapshot } from './telemetry';
import { TranscriptConfig, TranscriptSegment, TranscriptStatus } from './transcript';

export interface TrackMetadataInfo {
  id: string;
  filePath: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
}

export interface DeckSnapshot {
  id: string;
  name: string;
  state: 'empty' | 'loaded' | 'playing' | 'paused' | 'stopped';
  track: TrackMetadataInfo | null;
  positionMs: number;
  durationMs: number;
  remainingMs: number;
  playbackPercent: number;
  cuePositionMs: number;
  volume: number;
  gainDb: number;
  muted: boolean;
  cue: boolean;
  looping: boolean;
}

export interface NowPlayingSnapshot {
  deckId: string;
  track: TrackMetadataInfo | null;
  positionMs: number;
  durationMs: number;
  playbackState: string;
  startedAt?: string;
}

export interface FullPlaybackSnapshot {
  deckA: DeckSnapshot;
  deckB: DeckSnapshot;
  activeDeck: string;
  crossfader: number;
  autoAdvance: boolean;
  monitorSource: string;
  cueGainDb: number;
  cueMuted: boolean;
  currentTrack: TrackMetadataInfo | null;
  nowPlaying?: NowPlayingSnapshot | null;
  isMonitoring: boolean;
  monitorDevice: string | null;
  broadcastState: string;
  isRecording: boolean;
}

export interface PlaylistItem {
  id: string;
  filePath: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  format?: string;
  pinned?: boolean;
  addedAt?: string;
}

export interface RecordingHistoryItem {
  id: string;
  filePath: string;
  fileName: string;
  durationSeconds: number;
  fileSizeBytes: number;
  startedAt: string;
  stoppedAt: string;
  status: string;
}

export interface BroadcastPreflightError {
  field: string;
  code: string;
  message: string;
}

export interface StationProfile {
  id: string;
  name: string;
  callsign?: string;
  slogan?: string;
  genre: string;
  serverType: string;
  shoutcastConfig: ShoutcastConfig;
  isActive: boolean;
}

export interface CommandMap {
  // Broadcast Controls
  'broadcast.start': { params: { config?: ShoutcastConfig } | void; result: BroadcastStatus };
  'broadcast.stop': { params: void; result: BroadcastStatus };
  'broadcast.reconnect': { params: void; result: BroadcastStatus };
  'broadcast.get_status': { params: void; result: BroadcastStatus };
  'broadcast.preflight_validate': { params: { config?: ShoutcastConfig } | void; result: BroadcastPreflightError[] };

  // Audio Controls
  'audio.get_devices': { params: void; result: AudioDevice[] };
  'audio.get_output_devices': { params: void; result: AudioDevice[] };
  'audio.start_monitor': { params: { deviceId?: string }; result: string };
  'audio.stop_monitor': { params: void; result: void };
  'audio.set_gain': { params: { channelId: string; gainDb: number }; result: void };
  'audio.set_fader': { params: { channelId: string; level: number }; result: void };
  'audio.mute': { params: { channelId: string; muted: boolean }; result: void };
  'audio.get_metrics': { params: void; result: AudioMetrics };

  // Deck Controls
  'deck.load': { params: { deckId: string; filePath: string }; result: TrackMetadataInfo };
  'deck.play': { params: { deckId: string }; result: void };
  'deck.pause': { params: { deckId: string }; result: void };
  'deck.stop': { params: { deckId: string }; result: void };
  'deck.restart': { params: { deckId: string }; result: void };
  'deck.unload': { params: { deckId: string }; result: void };
  'deck.seek': { params: { deckId: string; positionMs: number }; result: void };
  'deck.set_cue_position': { params: { deckId: string }; result: void };
  'deck.return_to_cue': { params: { deckId: string }; result: void };
  'deck.start_from_cue': { params: { deckId: string }; result: void };
  'deck.set_cue': { params: { deckId: string; cue: boolean }; result: void };
  'deck.set_gain': { params: { deckId: string; gainDb: number }; result: void };
  'deck.set_mute': { params: { deckId: string; muted: boolean }; result: void };
  'deck.trigger_transition': { params: { targetDeckId: string; mode?: string; durationMs?: number }; result: void };
  'deck.set_crossfader': { params: { value: number }; result: void };
  'deck.set_auto_advance': { params: { enabled: boolean }; result: void };
  'deck.set_monitor_source': { params: { source: string }; result: void };
  'deck.set_cue_gain': { params: { gainDb: number }; result: void };
  'deck.set_cue_muted': { params: { muted: boolean }; result: void };

  // Playback Snapshot
  'playback.get_snapshot': { params: void; result: FullPlaybackSnapshot };

  // Playlist & Library Controls
  'playlist.get': { params: void; result: PlaylistItem[] };
  'playlist.get_library': { params: void; result: PlaylistItem[] };
  'playlist.scan_folder': { params: { folderPath: string }; result: PlaylistItem[] };
  'playlist.search': { params: { query: string }; result: PlaylistItem[] };
  'playlist.remove_missing': { params: void; result: number };
  'playlist.toggle_pinned': { params: { id: string }; result: boolean };
  'playlist.add_file': { params: { filePath: string }; result: PlaylistItem };
  'playlist.insert_next': { params: { filePath: string }; result: PlaylistItem };
  'playlist.remove': { params: { index: number }; result: PlaylistItem | null };
  'playlist.clear': { params: void; result: void };
  'playlist.reorder': { params: { from: number; to: number }; result: boolean };
  'playlist.play_index': { params: { index: number; deckId?: string }; result: TrackMetadataInfo };

  // Stream & Telemetry
  'stream.get_metrics': { params: void; result: StreamMetrics };
  'telemetry.get_snapshot': { params: void; result: TelemetrySnapshot };

  // Automation / Control Action Bridge
  'control.action': { params: { action: string; params?: any }; result: any };

  // Transcription (Phase C Blocked)
  'transcript.start': { params: { config?: TranscriptConfig }; result: TranscriptStatus };
  'transcript.stop': { params: void; result: TranscriptStatus };
  'transcript.get_segments': { params: { limit?: number; sinceMs?: number }; result: TranscriptSegment[] };

  // Recording
  'recording.start': { params: { prefix?: string } | void; result: { id: string; startedAt: string; filePath?: string } };
  'recording.stop': { params: void; result: { id: string; durationSeconds: number; filePath: string } };
  'recording.get_history': { params: void; result: RecordingHistoryItem[] };
  'recording.open_folder': { params: { path?: string } | void; result: void };

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
