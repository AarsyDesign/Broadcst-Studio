export type BroadcastState =
  | 'OFFLINE'
  | 'CONNECTING'
  | 'AUTHENTICATING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR';

export interface ShoutcastConfig {
  server: string;
  port: number;
  mountPoint?: string;
  streamId: number;
  password?: string;
  bitrate: number;
  codec: 'MP3' | 'AAC';
  stationName: string;
  genre?: string;
  isPublic: boolean;
}

export interface BroadcastStatus {
  state: BroadcastState;
  uptimeSeconds: number;
  reconnectCount: number;
  errorMessage?: string;
  lastConnectedAt?: string;
  config: ShoutcastConfig;
}

export interface TrackMetadata {
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  stationName?: string;
}
