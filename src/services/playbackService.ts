import { controlApi } from './controlApi';
import { FullPlaybackSnapshot, PlaylistItem, AudioDevice, TrackMetadataInfo } from '../types/ipc';
import { logger } from './logger';

export type PlaybackSnapshotCallback = (snapshot: FullPlaybackSnapshot) => void;

class PlaybackService {
  private currentSnapshot: FullPlaybackSnapshot = {
    deckA: {
      id: 'deck_a',
      name: 'Deck A',
      state: 'empty',
      track: null,
      positionMs: 0,
      durationMs: 0,
      remainingMs: 0,
      volume: 1.0,
      cue: false,
      looping: false,
    },
    deckB: {
      id: 'deck_b',
      name: 'Deck B',
      state: 'empty',
      track: null,
      positionMs: 0,
      durationMs: 0,
      remainingMs: 0,
      volume: 1.0,
      cue: false,
      looping: false,
    },
    activeDeck: 'deck_a',
    crossfader: 0.0,
    autoAdvance: true,
    currentTrack: null,
    isMonitoring: false,
    monitorDevice: null,
    broadcastState: 'OFFLINE',
    isRecording: false,
  };

  private listeners: Set<PlaybackSnapshotCallback> = new Set();
  private pollIntervalId?: number;

  constructor() {
    this.startPolling();
  }

  public getSnapshot(): FullPlaybackSnapshot {
    return this.currentSnapshot;
  }

  public onSnapshot(callback: PlaybackSnapshotCallback): () => void {
    this.listeners.add(callback);
    callback(this.currentSnapshot);
    return () => this.listeners.delete(callback);
  }

  private startPolling() {
    if (typeof window === 'undefined') return;

    this.pollIntervalId = window.setInterval(async () => {
      try {
        const res = await controlApi.execute('playback.get_snapshot');
        if (res.success && res.data) {
          this.currentSnapshot = res.data;
          this.notifyListeners();
        }
      } catch (err) {
        // Silently skip failed poll tick
      }
    }, 200);
  }

  private notifyListeners() {
    this.listeners.forEach((cb) => {
      try {
        cb(this.currentSnapshot);
      } catch (e) {
        logger.error('PlaybackService', 'Error in snapshot listener', { error: e });
      }
    });
  }

  // ==========================================
  // DECK OPERATIONS
  // ==========================================

  public async loadDeck(deckId: 'deck_a' | 'deck_b', filePath: string): Promise<TrackMetadataInfo | null> {
    const res = await controlApi.execute('deck.load', { deckId, filePath });
    if (res.success && res.data) {
      await this.refresh();
      return res.data;
    }
    return null;
  }

  public async playDeck(deckId: 'deck_a' | 'deck_b'): Promise<boolean> {
    const res = await controlApi.execute('deck.play', { deckId });
    if (res.success) {
      await this.refresh();
      return true;
    }
    return false;
  }

  public async pauseDeck(deckId: 'deck_a' | 'deck_b'): Promise<boolean> {
    const res = await controlApi.execute('deck.pause', { deckId });
    if (res.success) {
      await this.refresh();
      return true;
    }
    return false;
  }

  public async stopDeck(deckId: 'deck_a' | 'deck_b'): Promise<boolean> {
    const res = await controlApi.execute('deck.stop', { deckId });
    if (res.success) {
      await this.refresh();
      return true;
    }
    return false;
  }

  public async seekDeck(deckId: 'deck_a' | 'deck_b', positionMs: number): Promise<boolean> {
    const res = await controlApi.execute('deck.seek', { deckId, positionMs });
    if (res.success) {
      await this.refresh();
      return true;
    }
    return false;
  }

  public async setCrossfader(value: number): Promise<boolean> {
    const res = await controlApi.execute('deck.set_crossfader', { value });
    if (res.success) {
      this.currentSnapshot.crossfader = value;
      this.notifyListeners();
      return true;
    }
    return false;
  }

  public async setAutoAdvance(enabled: boolean): Promise<boolean> {
    const res = await controlApi.execute('deck.set_auto_advance', { enabled });
    if (res.success) {
      this.currentSnapshot.autoAdvance = enabled;
      this.notifyListeners();
      return true;
    }
    return false;
  }

  // ==========================================
  // PLAYLIST OPERATIONS
  // ==========================================

  public async getPlaylist(): Promise<PlaylistItem[]> {
    const res = await controlApi.execute('playlist.get');
    return res.success && res.data ? res.data : [];
  }

  public async addFileToPlaylist(filePath: string): Promise<PlaylistItem | null> {
    const res = await controlApi.execute('playlist.add_file', { filePath });
    return res.success && res.data ? res.data : null;
  }

  public async removePlaylistItem(index: number): Promise<PlaylistItem | null> {
    const res = await controlApi.execute('playlist.remove', { index });
    return res.success && res.data ? res.data : null;
  }

  public async clearPlaylist(): Promise<boolean> {
    const res = await controlApi.execute('playlist.clear');
    return res.success;
  }

  public async playPlaylistItem(index: number, deckId?: string): Promise<TrackMetadataInfo | null> {
    const res = await controlApi.execute('playlist.play_index', { index, deckId });
    if (res.success && res.data) {
      await this.refresh();
      return res.data;
    }
    return null;
  }

  // ==========================================
  // OUTPUT MONITORING OPERATIONS
  // ==========================================

  public async getOutputDevices(): Promise<AudioDevice[]> {
    const res = await controlApi.execute('audio.get_output_devices');
    return res.success && res.data ? res.data : [];
  }

  public async startMonitor(deviceId?: string): Promise<string | null> {
    const res = await controlApi.execute('audio.start_monitor', { deviceId });
    if (res.success && res.data) {
      await this.refresh();
      return res.data;
    }
    return null;
  }

  public async stopMonitor(): Promise<boolean> {
    const res = await controlApi.execute('audio.stop_monitor');
    if (res.success) {
      await this.refresh();
      return true;
    }
    return false;
  }

  public async triggerControlAction(action: string, params?: any): Promise<any> {
    const res = await controlApi.execute('control.action', { action, params });
    await this.refresh();
    return res.data;
  }

  public async refresh() {
    try {
      const res = await controlApi.execute('playback.get_snapshot');
      if (res.success && res.data) {
        this.currentSnapshot = res.data;
        this.notifyListeners();
      }
    } catch (e) {
      // Ignored
    }
  }

  public dispose() {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
    }
    this.listeners.clear();
  }
}

export const playbackService = new PlaybackService();
