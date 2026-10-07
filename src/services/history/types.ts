import { OperatorCaller } from '../operations/types';

export interface PlaybackHistoryItem {
  id: string;
  trackId: string;
  title: string;
  artist: string;
  album?: string;
  filePath: string;
  deckId: string;
  durationMs: number;
  playedDurationMs: number;
  startedAt: string;
  endedAt?: string;
  triggerSource: OperatorCaller | 'AUTO_ADVANCE';
}

export interface BroadcastSessionHistoryItem {
  id: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds: number;
  server: string;
  port: number;
  streamId: number;
  bitrate: number;
  codec: string;
  stationName: string;
  bytesSent: number;
  reconnectCount: number;
  terminationReason: 'OPERATOR_STOP' | 'NETWORK_ERROR' | 'PROFILE_SWITCH' | 'RESTART';
}

export interface OperationAuditLogItem {
  id: string;
  operationId: string;
  action: string;
  caller: OperatorCaller;
  timestamp: string;
  durationMs: number;
  success: boolean;
  params?: any;
  error?: string;
}

export interface HistoryFilter {
  query?: string;
  deckId?: string;
  startDate?: string;
  endDate?: string;
}
