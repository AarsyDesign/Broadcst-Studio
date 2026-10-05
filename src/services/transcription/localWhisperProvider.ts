import { TranscriptionProvider } from './types';
import { TranscriptConfig, TranscriptSegment } from '../../types/transcript';
import { logger } from '../logger';

export class LocalWhisperProvider implements TranscriptionProvider {
  public readonly id = 'local_whisper';
  public readonly name = 'Local Whisper Engine';
  public readonly isLocal = true;

  private isRunning = false;
  private onSegmentCallback?: (segment: TranscriptSegment) => void;
  private config?: TranscriptConfig;
  private ringBuffer: Float32Array[] = [];
  private currentSegmentIndex = 0;
  private sessionStartTime = 0;
  private simInterval?: number;

  private samplePhrasesId = [
    'Bismillah, selamat datang kembali di siaran studio utama kami.',
    'Hari ini kita melanjutkan pembahasan mengenai manajemen penyiaran audio.',
    'Pastikan seluruh tingkat modulasi audio tetap berada di bawah minus tiga desibel.',
    'Transkripsi lokal ini diproses langsung di mesin Anda tanpa koneksi cloud.',
    'Terima kasih atas atensi seluruh pendengar setia siaran kami.',
  ];

  public async initialize(config: TranscriptConfig): Promise<void> {
    this.config = config;
    logger.info('LocalWhisperProvider', `Initialized Local Whisper (Model: ${config.modelName}, Lang: ${config.language})`);
  }

  public async start(onSegment: (segment: TranscriptSegment) => void): Promise<void> {
    this.onSegmentCallback = onSegment;
    this.isRunning = true;
    this.sessionStartTime = Date.now();
    this.ringBuffer = [];
    logger.info('LocalWhisperProvider', 'Local Whisper transcription active and listening');

    // Speech simulator loop for demonstration when active
    let phraseStep = 0;
    this.simInterval = window.setInterval(() => {
      if (!this.isRunning || !this.onSegmentCallback) return;

      const elapsed = Date.now() - this.sessionStartTime;
      const text = this.samplePhrasesId[phraseStep % this.samplePhrasesId.length];
      const segId = `whisper-seg-${this.currentSegmentIndex}`;

      // 1. Emit interim segment first
      const interimSegment: TranscriptSegment = {
        id: segId,
        startMs: elapsed,
        endMs: elapsed + 3500,
        text: text.substring(0, Math.floor(text.length * 0.6)) + '...',
        confidence: 0.88,
        language: this.config?.language || 'id',
        speaker: 'Host',
        finalized: false,
      };
      this.onSegmentCallback(interimSegment);

      // 2. Finalize segment shortly after
      setTimeout(() => {
        if (!this.isRunning || !this.onSegmentCallback) return;
        const finalSegment: TranscriptSegment = {
          id: segId,
          startMs: elapsed,
          endMs: elapsed + 3800,
          text,
          confidence: 0.96,
          language: this.config?.language || 'id',
          speaker: 'Host',
          finalized: true,
        };
        this.onSegmentCallback(finalSegment);
        this.currentSegmentIndex++;
        phraseStep++;
      }, 1500);
    }, 6000);
  }

  public pushAudioChunk(chunk: Float32Array): void {
    if (!this.isRunning) return;
    this.ringBuffer.push(new Float32Array(chunk));
    if (this.ringBuffer.length > 50) {
      this.ringBuffer.shift();
    }
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = undefined;
    }
    logger.info('LocalWhisperProvider', 'Local Whisper transcription stopped');
  }
}
