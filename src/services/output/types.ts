export type OutputServerType = 'shoutcast_v1' | 'shoutcast_v2' | 'icecast' | 'raw_tcp';

export type OutputConnectionStatus = 'OFFLINE' | 'CONNECTING' | 'CONNECTED' | 'ERROR';

export interface BroadcastOutputTarget {
  id: string;
  name: string;
  type: OutputServerType;
  server: string;
  port: number;
  mountPoint?: string;
  bitrate: number;
  codec: string;
  enabled: boolean;
  status: OutputConnectionStatus;
  bytesSent: number;
  uptimeSeconds: number;
}
