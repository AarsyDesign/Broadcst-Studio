import {
  BroadcastSessionHistoryItem,
  HistoryFilter,
  OperationAuditLogItem,
  PlaybackHistoryItem,
} from './types';
import { OperatorCaller } from '../operations/types';
import { logger } from '../logger';

const MAX_HISTORY_ITEMS = 200;

class HistoryService {
  private playbackHistory: PlaybackHistoryItem[] = [];
  private sessionHistory: BroadcastSessionHistoryItem[] = [];
  private auditLogs: OperationAuditLogItem[] = [];
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.loadPersisted();
  }

  private loadPersisted() {
    try {
      const pbRaw = localStorage.getItem('broadcast_playback_history');
      if (pbRaw) this.playbackHistory = JSON.parse(pbRaw);

      const sessRaw = localStorage.getItem('broadcast_session_history');
      if (sessRaw) this.sessionHistory = JSON.parse(sessRaw);

      const auditRaw = localStorage.getItem('broadcast_audit_history');
      if (auditRaw) this.auditLogs = JSON.parse(auditRaw);
    } catch (err) {
      logger.error('HistoryService', 'Failed to load persisted history', { error: err });
    }
  }

  private persist() {
    try {
      localStorage.setItem('broadcast_playback_history', JSON.stringify(this.playbackHistory.slice(0, MAX_HISTORY_ITEMS)));
      localStorage.setItem('broadcast_session_history', JSON.stringify(this.sessionHistory.slice(0, MAX_HISTORY_ITEMS)));
      localStorage.setItem('broadcast_audit_history', JSON.stringify(this.auditLogs.slice(0, MAX_HISTORY_ITEMS)));
    } catch (err) {
      logger.error('HistoryService', 'Failed to persist history', { error: err });
    }
  }

  // --- Playback History ---
  public recordPlaybackStart(
    track: { id?: string; title: string; artist: string; album?: string; filePath?: string; durationMs?: number },
    deckId: string,
    source: OperatorCaller | 'AUTO_ADVANCE' = 'OPERATOR_UI'
  ): string {
    const id = `pb-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const item: PlaybackHistoryItem = {
      id,
      trackId: track.id || id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      filePath: track.filePath || '',
      deckId,
      durationMs: track.durationMs || 0,
      playedDurationMs: 0,
      startedAt: new Date().toISOString(),
      triggerSource: source,
    };

    this.playbackHistory.unshift(item);
    if (this.playbackHistory.length > MAX_HISTORY_ITEMS) {
      this.playbackHistory.pop();
    }
    this.persist();
    this.notify();
    return id;
  }

  public recordPlaybackEnd(historyId: string, playedDurationMs: number) {
    const item = this.playbackHistory.find((p) => p.id === historyId);
    if (item) {
      item.endedAt = new Date().toISOString();
      item.playedDurationMs = playedDurationMs;
      this.persist();
      this.notify();
    }
  }

  public getPlaybackHistory(filter?: HistoryFilter): PlaybackHistoryItem[] {
    let result = [...this.playbackHistory];
    if (filter) {
      if (filter.query) {
        const q = filter.query.toLowerCase();
        result = result.filter((p) => p.title.toLowerCase().includes(q) || p.artist.toLowerCase().includes(q));
      }
      if (filter.deckId) {
        result = result.filter((p) => p.deckId === filter.deckId);
      }
    }
    return result;
  }

  // --- Session History ---
  public recordSessionStart(params: {
    server: string;
    port: number;
    streamId: number;
    bitrate: number;
    codec: string;
    stationName: string;
  }): string {
    const id = `sess-${Date.now()}`;
    const item: BroadcastSessionHistoryItem = {
      id,
      startedAt: new Date().toISOString(),
      durationSeconds: 0,
      server: params.server,
      port: params.port,
      streamId: params.streamId,
      bitrate: params.bitrate,
      codec: params.codec,
      stationName: params.stationName,
      bytesSent: 0,
      reconnectCount: 0,
      terminationReason: 'OPERATOR_STOP',
    };

    this.sessionHistory.unshift(item);
    if (this.sessionHistory.length > MAX_HISTORY_ITEMS) {
      this.sessionHistory.pop();
    }
    this.persist();
    this.notify();
    return id;
  }

  public recordSessionEnd(
    sessionId: string,
    stats: { durationSeconds: number; bytesSent: number; reconnectCount: number },
    reason: BroadcastSessionHistoryItem['terminationReason'] = 'OPERATOR_STOP'
  ) {
    const item = this.sessionHistory.find((s) => s.id === sessionId);
    if (item) {
      item.endedAt = new Date().toISOString();
      item.durationSeconds = stats.durationSeconds;
      item.bytesSent = stats.bytesSent;
      item.reconnectCount = stats.reconnectCount;
      item.terminationReason = reason;
      this.persist();
      this.notify();
    }
  }

  public getSessionHistory(): BroadcastSessionHistoryItem[] {
    return [...this.sessionHistory];
  }

  // --- Audit History ---
  public recordAuditLog(entry: Omit<OperationAuditLogItem, 'id'>) {
    const item: OperationAuditLogItem = {
      ...entry,
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    };
    this.auditLogs.unshift(item);
    if (this.auditLogs.length > MAX_HISTORY_ITEMS) {
      this.auditLogs.pop();
    }
    this.persist();
    this.notify();
  }

  public getAuditLogs(): OperationAuditLogItem[] {
    return [...this.auditLogs];
  }

  // --- Export Helpers ---
  public exportPlaybackCsv(): string {
    const headers = ['StartedAt', 'Deck', 'Artist', 'Title', 'Album', 'DurationMs', 'PlayedMs', 'Source'];
    const rows = this.playbackHistory.map((p) => [
      `"${p.startedAt}"`,
      `"${p.deckId}"`,
      `"${p.artist.replace(/"/g, '""')}"`,
      `"${p.title.replace(/"/g, '""')}"`,
      `"${(p.album || '').replace(/"/g, '""')}"`,
      p.durationMs,
      p.playedDurationMs,
      `"${p.triggerSource}"`,
    ]);
    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  public exportSessionsCsv(): string {
    const headers = ['StartedAt', 'EndedAt', 'DurationSec', 'Server', 'Port', 'StreamId', 'Bitrate', 'Codec', 'BytesSent', 'Reconnects', 'Reason'];
    const rows = this.sessionHistory.map((s) => [
      `"${s.startedAt}"`,
      `"${s.endedAt || ''}"`,
      s.durationSeconds,
      `"${s.server}"`,
      s.port,
      s.streamId,
      s.bitrate,
      `"${s.codec}"`,
      s.bytesSent,
      s.reconnectCount,
      `"${s.terminationReason}"`,
    ]);
    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  public exportAuditCsv(): string {
    const headers = ['Timestamp', 'OperationId', 'Action', 'Caller', 'Success', 'DurationMs', 'Error'];
    const rows = this.auditLogs.map((a) => [
      `"${a.timestamp}"`,
      `"${a.operationId}"`,
      `"${a.action}"`,
      `"${a.caller}"`,
      a.success,
      a.durationMs,
      `"${(a.error || '').replace(/"/g, '""')}"`,
    ]);
    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  public clear(type: 'PLAYBACK' | 'SESSIONS' | 'AUDIT' | 'ALL') {
    if (type === 'PLAYBACK' || type === 'ALL') this.playbackHistory = [];
    if (type === 'SESSIONS' || type === 'ALL') this.sessionHistory = [];
    if (type === 'AUDIT' || type === 'ALL') this.auditLogs = [];
    this.persist();
    this.notify();
  }

  public subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notify() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        logger.error('HistoryService', 'Error in history listener', { error: err });
      }
    });
  }
}

export const historyService = new HistoryService();
