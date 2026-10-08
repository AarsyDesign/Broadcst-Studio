import { BroadcastState, BroadcastStatus, ShoutcastConfig, TrackMetadata } from '../types/broadcast';
import { BroadcastPreflightError } from '../types/ipc';
import { StreamMetrics } from '../types/telemetry';
import { logger } from './logger';

export type StatusChangeListener = (status: BroadcastStatus) => void;
export type MetricsChangeListener = (metrics: StreamMetrics) => void;

class ShoutcastService {
  private config: ShoutcastConfig = {
    server: 'radio.example.org',
    port: 8000,
    streamId: 1,
    bitrate: 128,
    codec: 'MP3',
    stationName: 'Broadcast Radio V1',
    genre: 'Talk / Live Broadcast',
    isPublic: true,
  };

  private state: BroadcastState = 'OFFLINE';
  private uptimeSeconds = 0;
  private reconnectCount = 0;
  private lastConnectedAt?: string;
  private errorMessage?: string;

  private currentMetadata: TrackMetadata = {
    title: 'Live Transmission',
    artist: 'Broadcaster Host',
    stationName: 'Broadcast Radio V1',
  };

  private metrics: StreamMetrics = {
    targetBitrateKbps: 128,
    actualUploadKbps: 0,
    bufferHealthRatio: 0,
    droppedFrames: 0,
    bytesSent: 0,
    networkLatencyMs: 0,
  };

  private timerInterval?: number;
  private statusListeners: Set<StatusChangeListener> = new Set();
  private metricsListeners: Set<MetricsChangeListener> = new Set();

  public async validatePreflight(config?: ShoutcastConfig): Promise<BroadcastPreflightError[]> {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke('broadcast_preflight_validate', { config: config || this.config });
      } catch (err) {
        logger.error('Shoutcast', 'Preflight validation failed', { error: err });
      }
    }
    const target = config || this.config;
    const errors: BroadcastPreflightError[] = [];
    if (!target.server || target.server.trim() === '') {
      errors.push({ field: 'server', code: 'REQUIRED', message: 'Broadcast server hostname or IP is required.' });
    }
    if (!target.port || target.port === 0) {
      errors.push({ field: 'port', code: 'INVALID', message: 'Broadcast server port is invalid.' });
    }
    return errors;
  }

  public getConfig(): ShoutcastConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<ShoutcastConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.metrics.targetBitrateKbps = this.config.bitrate;
    logger.info('Shoutcast', 'Configuration updated', { config: this.config });
    this.notifyStatus();
  }

  public getStatus(): BroadcastStatus {
    return {
      state: this.state,
      uptimeSeconds: this.uptimeSeconds,
      reconnectCount: this.reconnectCount,
      errorMessage: this.errorMessage,
      lastConnectedAt: this.lastConnectedAt,
      config: { ...this.config },
    };
  }

  public getMetrics(): StreamMetrics {
    return { ...this.metrics };
  }

  public async connect(): Promise<BroadcastStatus> {
    if (this.state === 'CONNECTED' || this.state === 'CONNECTING') {
      return this.getStatus();
    }

    logger.info('Shoutcast', `Connecting to ${this.config.server}:${this.config.port}...`);
    this.state = 'CONNECTING';
    this.errorMessage = undefined;
    this.notifyStatus();

    // Protocol Step 1: TCP Handshake simulation
    await new Promise((res) => setTimeout(res, 250));

    // Protocol Step 2: Authentication
    this.state = 'AUTHENTICATING';
    this.notifyStatus();
    await new Promise((res) => setTimeout(res, 200));

    // Connected: ON AIR
    this.state = 'CONNECTED';
    this.uptimeSeconds = 0;
    this.lastConnectedAt = new Date().toISOString();
    this.notifyStatus();
    logger.info('Shoutcast', `Connected successfully: ON AIR on Stream #${this.config.streamId}`);

    this.startStreamingTelemetryLoop();
    return this.getStatus();
  }

  public async disconnect(): Promise<BroadcastStatus> {
    logger.info('Shoutcast', 'Disconnecting stream...');
    this.state = 'OFFLINE';
    this.stopStreamingTelemetryLoop();
    this.notifyStatus();
    return this.getStatus();
  }

  public async reconnect(): Promise<BroadcastStatus> {
    logger.warn('Shoutcast', 'Initiating reconnect sequence...');
    this.state = 'RECONNECTING';
    this.reconnectCount += 1;
    this.notifyStatus();

    await new Promise((res) => setTimeout(res, 1200));
    this.state = 'CONNECTED';
    this.notifyStatus();
    logger.info('Shoutcast', `Reconnected successfully. Total reconnects: ${this.reconnectCount}`);
    return this.getStatus();
  }

  public setMetadata(metadata: TrackMetadata) {
    this.currentMetadata = { ...metadata };
    logger.info('Shoutcast', `Stream metadata updated: ${metadata.artist} - ${metadata.title}`);
  }

  public getCurrentMetadata(): TrackMetadata {
    return { ...this.currentMetadata };
  }

  private startStreamingTelemetryLoop() {
    this.stopStreamingTelemetryLoop();

    const bytesPerSecond = (this.config.bitrate * 1000) / 8;

    this.timerInterval = window.setInterval(() => {
      if (this.state === 'CONNECTED') {
        this.uptimeSeconds += 1;
        this.metrics.bytesSent += bytesPerSecond;

        this.metrics.actualUploadKbps = this.config.bitrate;
        this.metrics.bufferHealthRatio = 1.0;
        this.metrics.networkLatencyMs = 0; // Unmeasured without ICMP ping probe

        this.notifyStatus();
        this.notifyMetrics();
      }
    }, 1000);
  }

  private stopStreamingTelemetryLoop() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = undefined;
    }
    this.metrics.actualUploadKbps = 0;
    this.metrics.bufferHealthRatio = 0;
    this.notifyMetrics();
  }

  public onStatusChange(callback: StatusChangeListener): () => void {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  public onMetricsChange(callback: MetricsChangeListener): () => void {
    this.metricsListeners.add(callback);
    return () => this.metricsListeners.delete(callback);
  }

  private notifyStatus() {
    const status = this.getStatus();
    this.statusListeners.forEach((cb) => {
      try {
        cb(status);
      } catch (err) {
        logger.error('Shoutcast', 'Error in status listener', { error: err });
      }
    });
  }

  private notifyMetrics() {
    const metrics = this.getMetrics();
    this.metricsListeners.forEach((cb) => {
      try {
        cb(metrics);
      } catch (err) {
        logger.error('Shoutcast', 'Error in metrics listener', { error: err });
      }
    });
  }
}

export const shoutcastService = new ShoutcastService();
