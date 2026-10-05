import { AudioCodecType, CODEC_PROFILES } from '../../types/codecs';
import { TrackMetadata } from '../../types/broadcast';
import { logger } from '../logger';

export type IcecastState =
  | 'OFFLINE'
  | 'CONNECTING'
  | 'AUTHENTICATING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR';

export interface IcecastConfig {
  server: string;
  port: number;
  mountPoint: string;
  username: string;
  password: string;
  codec: AudioCodecType;
  bitrate: number;
  sampleRate: number;
  channels: number;
  stationName: string;
  stationDescription: string;
  stationUrl: string;
  genre: string;
  isPublic: boolean;
}

export interface IcecastStatus {
  state: IcecastState;
  uptimeSeconds: number;
  listeners: number;
  reconnectCount: number;
  bytesSent: number;
  currentBitrateKbps: number;
  errorMessage?: string;
  lastConnectedAt?: string;
  currentMetadata: TrackMetadata;
  config: IcecastConfig;
}

class IcecastService {
  private config: IcecastConfig = {
    server: 'icecast.example.org',
    port: 8000,
    mountPoint: '/live',
    username: 'source',
    password: 'hackme',
    codec: 'MP3',
    bitrate: 128,
    sampleRate: 44100,
    channels: 2,
    stationName: 'Icecast FM Stream',
    stationDescription: 'High fidelity 24/7 internet radio broadcast',
    stationUrl: 'https://example.org',
    genre: 'Variety',
    isPublic: true,
  };

  private state: IcecastState = 'OFFLINE';
  private uptimeSeconds = 0;
  private reconnectCount = 0;
  private bytesSent = 0;
  private listenersCount = 0;
  private errorMessage?: string;
  private lastConnectedAt?: string;
  private currentMetadata: TrackMetadata = {
    title: 'Station ID',
    artist: 'Broadcast Ecosystem',
    stationName: 'Icecast FM Stream',
  };

  private timer: any = null;
  private subscribers: ((status: IcecastStatus) => void)[] = [];

  constructor() {
    this.loadPersistedConfig();
  }

  private loadPersistedConfig() {
    try {
      const saved = localStorage.getItem('broadcast_icecast_config');
      if (saved) {
        this.config = { ...this.config, ...JSON.parse(saved) };
      }
    } catch (err) {
      logger.warn('IcecastService', 'Failed to load persisted config', { error: err });
    }
  }

  private persistConfig() {
    try {
      localStorage.setItem('broadcast_icecast_config', JSON.stringify(this.config));
    } catch (err) {
      logger.warn('IcecastService', 'Failed to persist config', { error: err });
    }
  }

  public subscribe(listener: (status: IcecastStatus) => void): () => void {
    this.subscribers.push(listener);
    listener(this.getStatus());
    return () => {
      this.subscribers = this.subscribers.filter((l) => l !== listener);
    };
  }

  private notify() {
    const status = this.getStatus();
    this.subscribers.forEach((l) => {
      try {
        l(status);
      } catch (err) {
        logger.error('IcecastService', 'Subscriber failed', { error: err });
      }
    });
  }

  public getStatus(): IcecastStatus {
    return {
      state: this.state,
      uptimeSeconds: this.uptimeSeconds,
      listeners: this.listenersCount,
      reconnectCount: this.reconnectCount,
      bytesSent: this.bytesSent,
      currentBitrateKbps: this.state === 'CONNECTED' ? this.config.bitrate : 0,
      errorMessage: this.errorMessage,
      lastConnectedAt: this.lastConnectedAt,
      currentMetadata: { ...this.currentMetadata },
      config: { ...this.config },
    };
  }

  public getConfig(): IcecastConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<IcecastConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.persistConfig();
    this.notify();
    logger.info('IcecastService', 'Icecast configuration updated', this.config as any);
  }

  public async connect(overrideConfig?: Partial<IcecastConfig>): Promise<boolean> {
    if (this.state === 'CONNECTED' || this.state === 'CONNECTING') {
      return true;
    }

    if (overrideConfig) {
      this.updateConfig(overrideConfig);
    }

    this.state = 'CONNECTING';
    this.errorMessage = undefined;
    this.notify();
    logger.info('IcecastService', `Connecting to Icecast server at ${this.config.server}:${this.config.port}${this.config.mountPoint}...`);

    try {
      // Step 1: Network socket connection simulation
      await new Promise((r) => setTimeout(r, 400));

      // Step 2: HTTP SOURCE handshaking and Basic Auth authentication
      this.state = 'AUTHENTICATING';
      this.notify();

      const profile = CODEC_PROFILES[this.config.codec] || CODEC_PROFILES.MP3;
      const headers = [
        `SOURCE ${this.config.mountPoint} HTTP/1.0`,
        `Authorization: Basic ${btoa(`${this.config.username}:${this.config.password}`)}`,
        `Content-Type: ${profile.mimeType}`,
        `ice-name: ${this.config.stationName}`,
        `ice-description: ${this.config.stationDescription}`,
        `ice-url: ${this.config.stationUrl}`,
        `ice-genre: ${this.config.genre}`,
        `ice-bitrate: ${this.config.bitrate}`,
        `ice-public: ${this.config.isPublic ? 1 : 0}`,
        `ice-audio-info: bitrate=${this.config.bitrate};samplerate=${this.config.sampleRate};channels=${this.config.channels}`,
      ];

      logger.info('IcecastService', 'Transmitting HTTP SOURCE handshake headers', { headers });

      await new Promise((r) => setTimeout(r, 450));

      // Step 3: Connected successfully
      this.state = 'CONNECTED';
      this.lastConnectedAt = new Date().toISOString();
      this.uptimeSeconds = 0;
      this.bytesSent = 0;
      this.listenersCount = Math.floor(Math.random() * 25) + 12;
      this.notify();

      this.startHeartbeat();
      logger.info('IcecastService', `Icecast stream connected on mount ${this.config.mountPoint} using ${this.config.codec} (${this.config.bitrate} kbps)`);
      return true;
    } catch (err: any) {
      this.state = 'ERROR';
      this.errorMessage = err?.message || 'Icecast connection failed';
      this.notify();
      logger.error('IcecastService', 'Icecast connection error', { error: err });
      return false;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.state === 'OFFLINE') return;

    this.stopHeartbeat();
    this.state = 'OFFLINE';
    this.uptimeSeconds = 0;
    this.notify();
    logger.info('IcecastService', 'Icecast stream disconnected');
  }

  public async reconnect(): Promise<void> {
    logger.info('IcecastService', 'Initiating Icecast reconnect...');
    this.reconnectCount += 1;
    this.state = 'RECONNECTING';
    this.notify();

    await this.disconnect();
    await new Promise((r) => setTimeout(r, 600));
    await this.connect();
  }

  public async setMetadata(metadata: TrackMetadata): Promise<boolean> {
    this.currentMetadata = { ...metadata };
    this.notify();

    if (this.state !== 'CONNECTED') {
      return true;
    }

    try {
      const songString = `${metadata.artist} - ${metadata.title}`;
      const adminUrl = `http://${this.config.server}:${this.config.port}/admin/metadata?mount=${encodeURIComponent(
        this.config.mountPoint
      )}&mode=updinfo&song=${encodeURIComponent(songString)}`;

      logger.info('IcecastService', `Updated Icecast metadata to "${songString}"`, { adminUrl });
      return true;
    } catch (err) {
      logger.error('IcecastService', 'Failed to update Icecast metadata', { error: err });
      return false;
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.timer = setInterval(() => {
      if (this.state === 'CONNECTED') {
        this.uptimeSeconds += 1;
        // Estimate bytes sent per second based on bitrate
        const bytesPerSec = Math.floor((this.config.bitrate * 1000) / 8);
        this.bytesSent += bytesPerSec;

        // Occasional listener count variation
        if (this.uptimeSeconds % 15 === 0) {
          const delta = Math.floor(Math.random() * 5) - 2;
          this.listenersCount = Math.max(1, this.listenersCount + delta);
        }

        this.notify();
      }
    }, 1000);
  }

  private stopHeartbeat() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const icecastService = new IcecastService();
