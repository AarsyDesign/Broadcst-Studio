import { TranscriptionProvider } from './types';
import { TranscriptConfig, TranscriptSegment } from '../../types/transcript';
import { logger } from '../logger';

export class WebSpeechProvider implements TranscriptionProvider {
  public readonly id = 'web_speech';
  public readonly name = 'Browser Speech Recognition';
  public readonly isLocal = false; // Web speech recognition may query browser speech engine

  private recognition: any = null;
  private isRunning = false;
  private onSegmentCallback?: (segment: TranscriptSegment) => void;
  private config?: TranscriptConfig;
  private startTime = 0;

  public async initialize(config: TranscriptConfig): Promise<void> {
    this.config = config;
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      logger.warn('WebSpeechProvider', 'SpeechRecognition API not available in this browser');
      return;
    }

    this.recognition = new SpeechRecognitionClass();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = config.language === 'id' ? 'id-ID' : 'en-US';

    this.recognition.onresult = (event: any) => {
      const now = Date.now();
      const sessionOffsetMs = this.startTime > 0 ? now - this.startTime : 0;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const text = res[0]?.transcript?.trim();
        const confidence = res[0]?.confidence || 0.92;
        const finalized = res.isFinal;

        if (text && this.onSegmentCallback) {
          const segment: TranscriptSegment = {
            id: `speech-${i}-${finalized ? 'fin' : 'interim'}`,
            startMs: Math.max(0, sessionOffsetMs - 2500),
            endMs: sessionOffsetMs,
            text,
            confidence: Math.round(confidence * 100) / 100,
            language: this.config?.language || 'id',
            finalized,
          };
          this.onSegmentCallback(segment);
        }
      }
    };

    this.recognition.onerror = (event: any) => {
      logger.warn('WebSpeechProvider', 'Speech recognition event warning', { error: event.error });
    };

    this.recognition.onend = () => {
      if (this.isRunning && this.recognition) {
        try {
          this.recognition.start();
        } catch {
          // ignore restart errors
        }
      }
    };
  }

  public async start(onSegment: (segment: TranscriptSegment) => void): Promise<void> {
    this.onSegmentCallback = onSegment;
    this.startTime = Date.now();
    this.isRunning = true;

    if (this.recognition) {
      try {
        this.recognition.start();
        logger.info('WebSpeechProvider', `Recognition started in language: ${this.recognition.lang}`);
      } catch (err) {
        logger.warn('WebSpeechProvider', 'Failed to start recognition, might already be active', { error: err });
      }
    }
  }

  public pushAudioChunk(_chunk: Float32Array): void {
    // Web Speech API consumes directly from user audio input stream
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
        logger.info('WebSpeechProvider', 'Recognition stopped');
      } catch {
        // ignore stop errors
      }
    }
  }
}
