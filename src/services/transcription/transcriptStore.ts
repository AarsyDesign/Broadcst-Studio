import { TranscriptSegment } from '../../types/transcript';
import { logger } from '../logger';

const STORAGE_KEY = 'broadcast_transcript_segments_v1';

class TranscriptStore {
  private segments: TranscriptSegment[] = [];
  private listeners: Set<(segments: TranscriptSegment[]) => void> = new Set();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        this.segments = JSON.parse(saved);
      }
    } catch (err) {
      logger.warn('TranscriptStore', 'Could not read transcript from localStorage', { error: err });
      this.segments = [];
    }
  }

  private saveToStorage() {
    try {
      // Keep at most 2000 recent finalized segments in storage
      const toSave = this.segments.filter((s) => s.finalized).slice(-2000);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (err) {
      logger.warn('TranscriptStore', 'Could not write transcript to localStorage', { error: err });
    }
  }

  public getSegments(): TranscriptSegment[] {
    return [...this.segments];
  }

  public addOrUpdateSegment(segment: TranscriptSegment) {
    const index = this.segments.findIndex((s) => s.id === segment.id);
    if (index >= 0) {
      this.segments[index] = segment;
    } else {
      this.segments.push(segment);
    }

    if (segment.finalized) {
      this.saveToStorage();
    }
    this.notify();
  }

  public clear() {
    this.segments = [];
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    this.notify();
    logger.info('TranscriptStore', 'Transcript segments cleared');
  }

  public search(query: string): TranscriptSegment[] {
    if (!query || query.trim() === '') return this.segments;
    const q = query.toLowerCase().trim();
    return this.segments.filter((s) => s.text.toLowerCase().includes(q));
  }

  public exportAsText(includeTimestamps: boolean = true): string {
    return this.segments
      .map((s) => {
        if (!includeTimestamps) return s.text;
        const time = this.formatTime(s.startMs);
        const speaker = s.speaker ? ` [${s.speaker}]` : '';
        return `[${time}]${speaker} ${s.text}`;
      })
      .join('\n');
  }

  public exportAsJson(): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        totalSegments: this.segments.length,
        segments: this.segments,
      },
      null,
      2
    );
  }

  public exportAsSrt(): string {
    return this.segments
      .map((s, idx) => {
        const start = this.formatSrtTime(s.startMs);
        const end = this.formatSrtTime(s.endMs || s.startMs + 3000);
        return `${idx + 1}\n${start} --> ${end}\n${s.text}\n`;
      })
      .join('\n');
  }

  public downloadFile(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    logger.info('TranscriptStore', `Exported transcript as ${filename}`);
  }

  private formatTime(ms: number): string {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  private formatSrtTime(ms: number): string {
    const totalSecs = Math.floor(ms / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    const millis = ms % 1000;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`;
  }

  public subscribe(callback: (segments: TranscriptSegment[]) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notify() {
    this.listeners.forEach((cb) => {
      try {
        cb([...this.segments]);
      } catch (err) {
        logger.error('TranscriptStore', 'Error notifying listener', { error: err });
      }
    });
  }
}

export const transcriptStore = new TranscriptStore();
