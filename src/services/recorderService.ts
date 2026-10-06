import { audioEngine } from './audioEngine';
import { logger } from './logger';

export interface RecordedSession {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  fileSizeBytes: number;
  blobUrl: string;
  mimeType: string;
}

export type RecorderState = 'IDLE' | 'RECORDING' | 'PAUSED';

class RecorderService {
  private mediaRecorder?: MediaRecorder;
  private recordedChunks: Blob[] = [];
  private state: RecorderState = 'IDLE';

  private currentSessionId?: string;
  private recordingStartTime?: number;
  private durationInterval?: number;
  private currentDurationSeconds = 0;

  private sessions: RecordedSession[] = [];
  private stateListeners: Set<(state: RecorderState, duration: number) => void> = new Set();
  private sessionsListeners: Set<(sessions: RecordedSession[]) => void> = new Set();

  public getState(): RecorderState {
    return this.state;
  }

  public getCurrentDuration(): number {
    return this.currentDurationSeconds;
  }

  public getSessions(): RecordedSession[] {
    return [...this.sessions];
  }

  public async startRecording(customTitle?: string): Promise<boolean> {
    if (this.state === 'RECORDING') return true;

    // Native Tauri recording branch
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const res: any = await invoke('recording_start');
        this.currentSessionId = res.id;
        this.recordingStartTime = Date.now();
        this.currentDurationSeconds = 0;
        this.state = 'RECORDING';

        this.durationInterval = window.setInterval(() => {
          if (this.state === 'RECORDING') {
            this.currentDurationSeconds += 1;
            this.notifyState();
          }
        }, 1000);

        this.notifyState();
        logger.info('Recorder', `Native master recording started: ${res.filePath}`);
        return true;
      } catch (err) {
        logger.error('Recorder', 'Failed to start native recording', { error: err });
        return false;
      }
    }

    const stream = audioEngine.getMasterMediaStream();
    if (!stream) {
      logger.error('Recorder', 'Cannot start recording: master audio stream destination is not available');
      return false;
    }

    try {
      this.recordedChunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      this.mediaRecorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 192000 });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.currentSessionId = `rec-${Date.now()}`;
      const sessionTitle = customTitle || `Live Broadcast Session ${new Date().toLocaleDateString('id-ID')}`;
      this.recordingStartTime = Date.now();
      this.currentDurationSeconds = 0;

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);
        const endedAt = new Date().toISOString();

        const session: RecordedSession = {
          id: this.currentSessionId || `rec-${Date.now()}`,
          title: sessionTitle,
          startedAt: new Date(this.recordingStartTime || Date.now()).toISOString(),
          endedAt,
          durationSeconds: this.currentDurationSeconds,
          fileSizeBytes: blob.size,
          blobUrl,
          mimeType,
        };

        this.sessions.unshift(session);
        logger.info('Recorder', `Recording saved: ${session.title} (${session.durationSeconds}s, ${(blob.size / 1024).toFixed(1)} KB)`);
        this.notifySessions();
      };

      this.mediaRecorder.start(1000); // 1s slice
      this.state = 'RECORDING';
      logger.info('Recorder', `Recording started: ${sessionTitle}`);

      this.durationInterval = window.setInterval(() => {
        if (this.state === 'RECORDING') {
          this.currentDurationSeconds += 1;
          this.notifyState();
        }
      }, 1000);

      this.notifyState();
      return true;
    } catch (err) {
      logger.error('Recorder', 'Failed to initialize MediaRecorder', { error: err });
      return false;
    }
  }

  public async stopRecording(): Promise<RecordedSession | null> {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      if (this.durationInterval) {
        clearInterval(this.durationInterval);
        this.durationInterval = undefined;
      }
      this.state = 'IDLE';
      this.notifyState();
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const res: any = await invoke('recording_stop');
        const session: RecordedSession = {
          id: res.id,
          title: `Broadcast Master ${new Date().toLocaleDateString('id-ID')}`,
          startedAt: new Date(this.recordingStartTime || Date.now()).toISOString(),
          endedAt: new Date().toISOString(),
          durationSeconds: res.durationSeconds || this.currentDurationSeconds,
          fileSizeBytes: 0,
          blobUrl: res.filePath,
          mimeType: 'audio/wav',
        };
        this.sessions.unshift(session);
        this.notifySessions();
        return session;
      } catch (err) {
        logger.error('Recorder', 'Failed to stop native recording', { error: err });
        return null;
      }
    }

    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.state === 'IDLE') {
        resolve(null);
        return;
      }

      if (this.durationInterval) {
        clearInterval(this.durationInterval);
        this.durationInterval = undefined;
      }

      this.state = 'IDLE';
      this.notifyState();

      const prevCount = this.sessions.length;
      this.mediaRecorder.stop();

      // Poll until session is added
      const check = setInterval(() => {
        if (this.sessions.length > prevCount) {
          clearInterval(check);
          resolve(this.sessions[0]);
        }
      }, 50);
    });
  }

  public async fetchHistory(): Promise<RecordedSession[]> {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const history: any[] = await invoke('recording_get_history');
        if (Array.isArray(history)) {
          this.sessions = history.map((item) => ({
            id: item.id,
            title: item.fileName,
            startedAt: item.startedAt,
            endedAt: item.stoppedAt,
            durationSeconds: item.durationSeconds,
            fileSizeBytes: item.fileSizeBytes,
            blobUrl: item.filePath,
            mimeType: 'audio/wav',
          }));
          this.notifySessions();
        }
      } catch (e) {
        logger.warn('Recorder', 'Could not fetch native history', { error: e });
      }
    }
    return this.sessions;
  }

  public async openRecordingFolder(path?: string): Promise<void> {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('recording_open_folder', { path });
    }
  }

  public onStateChange(callback: (state: RecorderState, duration: number) => void): () => void {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }

  public onSessionsChange(callback: (sessions: RecordedSession[]) => void): () => void {
    this.sessionsListeners.add(callback);
    return () => this.sessionsListeners.delete(callback);
  }

  private notifyState() {
    this.stateListeners.forEach((cb) => {
      try {
        cb(this.state, this.currentDurationSeconds);
      } catch (err) {
        logger.error('Recorder', 'Error notifying state listener', { error: err });
      }
    });
  }

  private notifySessions() {
    this.sessionsListeners.forEach((cb) => {
      try {
        cb([...this.sessions]);
      } catch (err) {
        logger.error('Recorder', 'Error notifying session listener', { error: err });
      }
    });
  }
}

export const recorderService = new RecorderService();
