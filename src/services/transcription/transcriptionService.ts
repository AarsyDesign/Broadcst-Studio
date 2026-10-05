import { TranscriptionProvider } from './types';
import { LocalWhisperProvider } from './localWhisperProvider';
import { WebSpeechProvider } from './webSpeechProvider';
import { transcriptStore } from './transcriptStore';
import { TranscriptConfig, TranscriptSegment, TranscriptStatus } from '../../types/transcript';
import { logger } from '../logger';

export class TranscriptionService {
  private providers: Map<string, TranscriptionProvider> = new Map();
  private activeProvider?: TranscriptionProvider;

  private config: TranscriptConfig = {
    provider: 'local_whisper',
    modelName: 'whisper-small-q5',
    language: 'id',
    isLocal: true,
    autoScroll: true,
  };

  private status: TranscriptStatus = {
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

  private statusListeners: Set<(status: TranscriptStatus) => void> = new Set();
  private segmentListeners: Set<(segment: TranscriptSegment) => void> = new Set();

  constructor() {
    this.registerProvider(new LocalWhisperProvider());
    this.registerProvider(new WebSpeechProvider());
    this.setProvider('local_whisper');
  }

  public registerProvider(provider: TranscriptionProvider) {
    this.providers.set(provider.id, provider);
  }

  public getAvailableProviders(): { id: string; name: string; isLocal: boolean }[] {
    return Array.from(this.providers.values()).map((p) => ({
      id: p.id,
      name: p.name,
      isLocal: p.isLocal,
    }));
  }

  public async setProvider(providerId: string): Promise<boolean> {
    const prov = this.providers.get(providerId);
    if (!prov) return false;

    const wasRunning = this.status.state === 'LISTENING';
    if (wasRunning && this.activeProvider) {
      await this.activeProvider.stop();
    }

    this.activeProvider = prov;
    this.config.provider = prov.id as any;
    this.config.isLocal = prov.isLocal;
    this.status.config = { ...this.config };

    await this.activeProvider.initialize(this.config);
    logger.info('TranscriptionService', `Active provider changed to: ${prov.name} (Local: ${prov.isLocal})`);

    if (wasRunning) {
      await this.start();
    } else {
      this.notifyStatus();
    }
    return true;
  }

  public async updateConfig(newConfig: Partial<TranscriptConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.status.config = { ...this.config };
    if (this.activeProvider) {
      await this.activeProvider.initialize(this.config);
    }
    this.notifyStatus();
  }

  public getStatus(): TranscriptStatus {
    this.status.segmentsCount = transcriptStore.getSegments().length;
    return { ...this.status };
  }

  public async start(): Promise<TranscriptStatus> {
    if (!this.activeProvider) {
      this.status.state = 'ERROR';
      this.status.lastErrorMessage = 'No transcription provider configured';
      this.notifyStatus();
      return this.getStatus();
    }

    this.status.state = 'STARTING';
    this.notifyStatus();

    try {
      await this.activeProvider.start((segment: TranscriptSegment) => {
        transcriptStore.addOrUpdateSegment(segment);
        this.status.activeSegmentId = segment.id;
        this.status.segmentsCount = transcriptStore.getSegments().length;
        this.notifySegment(segment);
        this.notifyStatus();
      });

      this.status.state = 'LISTENING';
      this.status.lastErrorMessage = undefined;
      logger.info('TranscriptionService', `Transcription live with provider: ${this.activeProvider.name}`);
    } catch (err) {
      this.status.state = 'ERROR';
      this.status.lastErrorMessage = String(err);
      logger.error('TranscriptionService', 'Failed to start transcription', { error: err });
    }

    this.notifyStatus();
    return this.getStatus();
  }

  public async stop(): Promise<TranscriptStatus> {
    if (this.activeProvider) {
      await this.activeProvider.stop();
    }
    this.status.state = 'IDLE';
    this.status.activeSegmentId = undefined;
    this.notifyStatus();
    return this.getStatus();
  }

  public onStatusChange(callback: (status: TranscriptStatus) => void): () => void {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  public onSegmentCreated(callback: (segment: TranscriptSegment) => void): () => void {
    this.segmentListeners.add(callback);
    return () => this.segmentListeners.delete(callback);
  }

  private notifyStatus() {
    const s = this.getStatus();
    this.statusListeners.forEach((cb) => {
      try {
        cb(s);
      } catch (err) {
        logger.error('TranscriptionService', 'Error in status listener', { error: err });
      }
    });
  }

  private notifySegment(seg: TranscriptSegment) {
    this.segmentListeners.forEach((cb) => {
      try {
        cb(seg);
      } catch (err) {
        logger.error('TranscriptionService', 'Error in segment listener', { error: err });
      }
    });
  }
}

export const transcriptionService = new TranscriptionService();
