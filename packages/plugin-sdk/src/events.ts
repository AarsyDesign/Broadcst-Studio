/**
 * Safe application events exposed to plugins.
 * Note: Raw realtime audio buffers are NEVER sent through general events.
 */

export interface TrackChangedEvent {
  deckId: 'deck_a' | 'deck_b';
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
}

export interface BroadcastConnectedEvent {
  mountPoint?: string;
  serverUrl?: string;
  format: string;
  bitrateKbps: number;
  sampleRate: number;
}

export interface BroadcastDisconnectedEvent {
  reason?: string;
  totalDurationSeconds: number;
}

export interface RecordingStartedEvent {
  sessionTitle: string;
  format: string;
  sampleRate: number;
}

export interface RecordingStoppedEvent {
  sessionId: string;
  durationSeconds: number;
  filePath: string;
  fileSizeBytes: number;
}

export interface ScheduleTriggeredEvent {
  slotId: string;
  title: string;
  scheduledTime: string;
  action: string;
}

export interface HostLifecycleEvent {
  pluginId: string;
  timestamp: number;
  state: string;
  details?: unknown;
}

export interface PluginEventMap {
  'track.changed': TrackChangedEvent;
  'broadcast.connected': BroadcastConnectedEvent;
  'broadcast.disconnected': BroadcastDisconnectedEvent;
  'recording.started': RecordingStartedEvent;
  'recording.stopped': RecordingStoppedEvent;
  'schedule.triggered': ScheduleTriggeredEvent;
  'plugin.installed': HostLifecycleEvent;
  'plugin.enabled': HostLifecycleEvent;
  'plugin.disabled': HostLifecycleEvent;
  'plugin.error': HostLifecycleEvent;
}

export type PluginEventName = keyof PluginEventMap;
export type PluginEventListener<E extends PluginEventName> = (payload: PluginEventMap[E]) => void;
