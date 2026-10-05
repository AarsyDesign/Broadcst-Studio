import { CommandMap, CommandName, EventMap, EventName } from '../types/ipc';
import { BroadcastStatus } from '../types/broadcast';
import { AudioDevice } from '../types/audio';
import { AudioMetrics, StreamMetrics, TelemetrySnapshot } from '../types/telemetry';
import { TranscriptSegment, TranscriptStatus } from '../types/transcript';
import { logger } from './logger';

type EventHandler<T> = (payload: T) => void;

class IPCService {
  private isTauriAvailable = false;
  private eventListeners: Map<string, Set<EventHandler<any>>> = new Map();
  private mockInterval?: number;

  // Mock State for Browser Dev Mode
  private mockBroadcastStatus: BroadcastStatus = {
    state: 'OFFLINE',
    uptimeSeconds: 0,
    reconnectCount: 0,
    config: {
      server: 'radio.example.org',
      port: 8000,
      streamId: 1,
      bitrate: 128,
      codec: 'MP3',
      stationName: 'Broadcast Radio V1',
      isPublic: true,
    },
  };

  private mockTranscriptStatus: TranscriptStatus = {
    state: 'IDLE',
    segmentsCount: 0,
    config: {
      provider: 'local_whisper',
      modelName: 'whisper-small-q5',
      language: 'id',
      isLocal: true,
      autoScroll: true,
    },
  };

  private mockDevices: AudioDevice[] = [
    { id: 'dev-mic-1', name: 'Microphone (USB Audio Device)', isDefault: true, channels: 2, sampleRate: 48000 },
    { id: 'dev-aux-1', name: 'Line In (Realtek High Definition)', isDefault: false, channels: 2, sampleRate: 48000 },
    { id: 'dev-sys-1', name: 'System Loopback (Stereo Mix)', isDefault: false, channels: 2, sampleRate: 48000 },
  ];

  constructor() {
    this.checkTauriAvailability();
    this.setupMockTelemetryTimer();
  }

  private checkTauriAvailability() {
    this.isTauriAvailable = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    logger.info('IPC', `IPC service initialized. Backend mode: ${this.isTauriAvailable ? 'Tauri Native IPC' : 'Browser Mock IPC'}`);
  }

  public isNative(): boolean {
    return this.isTauriAvailable;
  }

  public async invoke<K extends CommandName>(
    command: K,
    params?: CommandMap[K]['params']
  ): Promise<CommandMap[K]['result']> {
    logger.debug('IPC', `Invoking command: ${command}`, { params });

    if (this.isTauriAvailable) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke(command, params as any);
      } catch (err) {
        logger.error('IPC', `Tauri invoke failed for ${command}:`, { error: err });
        throw err;
      }
    }

    // Browser Mock Implementation
    return this.handleMockCommand(command, params);
  }

  public on<K extends EventName>(event: K, handler: EventHandler<EventMap[K]>): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);

    // If Tauri is available, also register with Tauri event listener
    let unlistenTauri: (() => void) | undefined;
    if (this.isTauriAvailable) {
      import('@tauri-apps/api/event').then(({ listen }) => {
        listen(event, (tauriEvent) => handler(tauriEvent.payload as EventMap[K])).then((unlisten) => {
          unlistenTauri = unlisten;
        });
      });
    }

    return () => {
      this.eventListeners.get(event)?.delete(handler);
      if (unlistenTauri) unlistenTauri();
    };
  }

  private emit<K extends EventName>(event: K, payload: EventMap[K]) {
    const handlers = this.eventListeners.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(payload);
        } catch (err) {
          logger.error('IPC', `Error in event handler for ${event}`, { error: err });
        }
      });
    }
  }

  private handleMockCommand<K extends CommandName>(command: K, params?: any): any {
    switch (command) {
      case 'broadcast.start': {
        this.mockBroadcastStatus = {
          ...this.mockBroadcastStatus,
          state: 'CONNECTED',
          lastConnectedAt: new Date().toISOString(),
          uptimeSeconds: 0,
        };
        this.emit('broadcast.status.changed', this.mockBroadcastStatus);
        logger.info('Broadcast', 'Mock broadcast started: ON AIR');
        return this.mockBroadcastStatus;
      }

      case 'broadcast.stop': {
        this.mockBroadcastStatus = {
          ...this.mockBroadcastStatus,
          state: 'OFFLINE',
        };
        this.emit('broadcast.status.changed', this.mockBroadcastStatus);
        logger.info('Broadcast', 'Mock broadcast stopped: OFFLINE');
        return this.mockBroadcastStatus;
      }

      case 'broadcast.reconnect': {
        this.mockBroadcastStatus = {
          ...this.mockBroadcastStatus,
          state: 'RECONNECTING',
          reconnectCount: this.mockBroadcastStatus.reconnectCount + 1,
        };
        this.emit('broadcast.status.changed', this.mockBroadcastStatus);
        setTimeout(() => {
          this.mockBroadcastStatus.state = 'CONNECTED';
          this.emit('broadcast.status.changed', this.mockBroadcastStatus);
        }, 1200);
        return this.mockBroadcastStatus;
      }

      case 'broadcast.get_status': {
        return this.mockBroadcastStatus;
      }

      case 'audio.get_devices': {
        return this.mockDevices;
      }

      case 'audio.set_gain':
      case 'audio.set_fader':
      case 'audio.mute': {
        return undefined;
      }

      case 'audio.get_metrics': {
        const metrics: AudioMetrics = {
          inputPeakDb: this.mockBroadcastStatus.state === 'CONNECTED' ? -6.5 : -90,
          inputRmsDb: this.mockBroadcastStatus.state === 'CONNECTED' ? -18.2 : -90,
          masterPeakDb: this.mockBroadcastStatus.state === 'CONNECTED' ? -3.1 : -90,
          masterRmsDb: this.mockBroadcastStatus.state === 'CONNECTED' ? -14.4 : -90,
          bufferUnderruns: 0,
          latencyMs: 12.5,
        };
        return metrics;
      }

      case 'stream.get_metrics': {
        const metrics: StreamMetrics = {
          targetBitrateKbps: 128,
          actualUploadKbps: this.mockBroadcastStatus.state === 'CONNECTED' ? 128.4 : 0,
          bufferHealthRatio: this.mockBroadcastStatus.state === 'CONNECTED' ? 0.98 : 0,
          droppedFrames: 0,
          bytesSent: this.mockBroadcastStatus.uptimeSeconds * 16000,
          networkLatencyMs: 24,
        };
        return metrics;
      }

      case 'telemetry.get_snapshot': {
        const snapshot: TelemetrySnapshot = {
          timestampMs: Date.now(),
          stream: this.handleMockCommand('stream.get_metrics'),
          audio: this.handleMockCommand('audio.get_metrics'),
          system: {
            cpuUsagePercent: 3.2,
            memoryUsageMb: 84.5,
            audioThreadTimeMs: 1.1,
          },
        };
        return snapshot;
      }

      case 'transcript.start': {
        this.mockTranscriptStatus = {
          ...this.mockTranscriptStatus,
          state: 'LISTENING',
        };
        return this.mockTranscriptStatus;
      }

      case 'transcript.stop': {
        this.mockTranscriptStatus = {
          ...this.mockTranscriptStatus,
          state: 'IDLE',
        };
        return this.mockTranscriptStatus;
      }

      case 'transcript.get_segments': {
        const segments: TranscriptSegment[] = [
          {
            id: 'seg-1',
            startMs: 0,
            endMs: 4200,
            text: 'Assalamu alaikum warahmatullahi wabarakatuh.',
            confidence: 0.98,
            language: 'id',
            finalized: true,
          },
          {
            id: 'seg-2',
            startMs: 4300,
            endMs: 9100,
            text: 'Selamat bergabung kembali di sesi siaran kita hari ini.',
            confidence: 0.95,
            language: 'id',
            finalized: true,
          },
        ];
        return segments;
      }

      case 'recording.start': {
        return { id: `rec-${Date.now()}`, startedAt: new Date().toISOString() };
      }

      case 'recording.stop': {
        return { id: `rec-${Date.now()}`, durationSeconds: 120, filePath: 'recordings/broadcast-sample.mp3' };
      }

      case 'metadata.set': {
        logger.info('Metadata', 'Metadata updated', params?.metadata);
        return undefined;
      }

      default:
        logger.warn('IPC', `Unhandled mock command: ${command}`);
        return null;
    }
  }

  private setupMockTelemetryTimer() {
    if (typeof window === 'undefined') return;

    // Tick every second to update uptime and metrics
    this.mockInterval = window.setInterval(() => {
      if (this.mockBroadcastStatus.state === 'CONNECTED') {
        this.mockBroadcastStatus.uptimeSeconds += 1;
        this.emit('broadcast.status.changed', { ...this.mockBroadcastStatus });

        // Emit dynamic stream metrics
        const metrics: StreamMetrics = {
          targetBitrateKbps: 128,
          actualUploadKbps: 127.8 + Math.sin(Date.now() / 1000) * 1.5,
          bufferHealthRatio: 0.96 + Math.cos(Date.now() / 2000) * 0.03,
          droppedFrames: 0,
          bytesSent: this.mockBroadcastStatus.uptimeSeconds * 16000,
          networkLatencyMs: 22 + Math.floor(Math.random() * 5),
        };
        this.emit('stream.metrics.changed', metrics);

        // Emit dynamic audio levels
        const baseLevel = -12;
        const jitter = Math.sin(Date.now() / 200) * 6;
        this.emit('audio.level.changed', {
          channelId: 'master',
          peakDb: Math.min(-0.5, baseLevel + jitter),
          rmsDb: Math.min(-3.0, baseLevel + jitter - 8),
        });
      }
    }, 1000);
  }

  public dispose() {
    if (this.mockInterval) {
      clearInterval(this.mockInterval);
    }
    this.eventListeners.clear();
  }
}

export const ipc = new IPCService();
