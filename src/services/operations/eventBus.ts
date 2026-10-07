import { logger } from '../logger';
import { DeviceRecoveryResult } from '../../types/ipc';
import { TrackMetadata } from '../../types/broadcast';
import { OperationRequest, OperationResult } from './types';

export interface BroadcstEventMap {
  // Audio
  'audio:clipped': { channelId: string; peakDb: number };
  'audio:device_changed': { devices: any[] };
  'audio:device_recovered': DeviceRecoveryResult;
  'audio:fader_changed': { channelId: string; level: number };
  'audio:monitor_changed': { enabled: boolean; deviceName?: string | null };

  // Decks & Playback
  'deck:state_changed': { deckId: string; state: string; track?: any };
  'deck:track_started': { deckId: string; track: any };
  'deck:track_finished': { deckId: string; track: any };
  'deck:cue_triggered': { deckId: string; cuePositionMs: number };
  'deck:transition_triggered': { targetDeckId: string; mode: string };

  // Broadcast
  'broadcast:state_changed': { state: string; server?: string; streamId?: number };
  'broadcast:connected': { server: string; streamId: number; bitrate: number };
  'broadcast:disconnected': { durationSeconds: number; bytesSent: number };
  'broadcast:metadata_updated': TrackMetadata;
  'broadcast:error': { message: string };

  // Recording
  'recording:started': { id: string; startedAt: string; filePath?: string };
  'recording:stopped': { id: string; durationSeconds: number; filePath: string };
  'recording:error': { message: string };

  // Schedule
  'schedule:event_started': { event: any };
  'schedule:event_ended': { event: any };
  'schedule:countdown_alert': { upcomingEvent: any; secondsRemaining: number };
  'schedule:updated': { eventsCount: number };

  // Automation
  'automation:rule_triggered': { ruleId: string; ruleName: string; triggerContext: string };
  'automation:rule_executed': { ruleId: string; ruleName: string; success: boolean; details: string };

  // Station Profile
  'profile:switched': { previousProfileId?: string; activeProfile: any };
  'profile:updated': { profileId: string };

  // Operations
  'operation:dispatched': OperationRequest;
  'operation:completed': OperationResult;

  // Recovery
  'recovery:initiated': { reason: string };
  'recovery:completed': DeviceRecoveryResult;
}

export type EventKey = keyof BroadcstEventMap;
export type EventHandler<K extends EventKey> = (payload: BroadcstEventMap[K]) => void;

class EventBus {
  private handlers: Map<EventKey, Set<EventHandler<any>>> = new Map();
  private wildcardHandlers: Set<(event: EventKey, payload: any) => void> = new Set();
  private recentEvents: { event: EventKey; payload: any; timestamp: string }[] = [];

  public on<K extends EventKey>(event: K, handler: EventHandler<K>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);

    return () => {
      this.off(event, handler);
    };
  }

  public off<K extends EventKey>(event: K, handler: EventHandler<K>): void {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(event);
      }
    }
  }

  public onAny(handler: (event: EventKey, payload: any) => void): () => void {
    this.wildcardHandlers.add(handler);
    return () => {
      this.wildcardHandlers.delete(handler);
    };
  }

  public emit<K extends EventKey>(event: K, payload: BroadcstEventMap[K]): void {
    this.recentEvents.unshift({
      event,
      payload,
      timestamp: new Date().toISOString(),
    });
    if (this.recentEvents.length > 50) {
      this.recentEvents.pop();
    }

    const set = this.handlers.get(event);
    if (set) {
      set.forEach((fn) => {
        try {
          fn(payload);
        } catch (err) {
          logger.error('EventBus', `Error in handler for event '${event}'`, { error: err });
        }
      });
    }

    this.wildcardHandlers.forEach((fn) => {
      try {
        fn(event, payload);
      } catch (err) {
        logger.error('EventBus', `Error in wildcard handler for '${event}'`, { error: err });
      }
    });
  }

  public getRecentEvents() {
    return [...this.recentEvents];
  }
}

export const eventBus = new EventBus();
