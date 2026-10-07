import { controlApi } from './controlApi';
import { FullPlaybackSnapshot, PlaylistItem, AudioDevice, TrackMetadataInfo } from '../types/ipc';
import { historyService } from './history/historyService';
import { eventBus } from './operations/eventBus';
import { logger } from './logger';

export type PlaybackSnapshotCallback = (snapshot: FullPlaybackSnapshot) => void;

class PlaybackService {
  private activePlayingHistory: {
    deck_a?: { historyId: string; trackId: string; lastPositionMs: number };
    deck_b?: { historyId: string; trackId: string; lastPositionMs: number };
  } = {};

  private currentSnapshot: FullPlaybackSnapshot = {
    deckA: {
      id: 'deck_a',
      name: 'Deck A',
      state: 'empty',
      track: null,
      positionMs: 0,
      durationMs: 0,
      remainingMs: 0,
      playbackPercent: 0,
      cuePositionMs: 0,
      volume: 1.0,
      gainDb: 0.0,
      muted: false,
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
      playbackPercent: 0,
      cuePositionMs: 0,
      volume: 1.0,
      gainDb: 0.0,
      muted: false,
      cue: false,
      looping: false,
    },
    activeDeck: 'deck_a',
    crossfader: 0.0,
    autoAdvance: true,
    monitorSource: 'master',
    cueGainDb: 0.0,
    cueMuted: false,
    currentTrack: null,
    nowPlaying: null,
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
    this.trackHistoryTransitions();

    this.listeners.forEach((cb) => {
      try {
        cb(this.currentSnapshot);
      } catch (e) {
        logger.error('PlaybackService', 'Error in snapshot listener', { error: e });
      }
    });
  }

  private trackHistoryTransitions() {
    const decks: ('deck_a' | 'deck_b')[] = ['deck_a', 'deck_b'];

    for (const d of decks) {
      const deckState = d === 'deck_a' ? this.currentSnapshot.deckA : this.currentSnapshot.deckB;
      const active = this.activePlayingHistory[d];

      if (deckState.state === 'playing' && deckState.track) {
        if (!active || active.trackId !== deckState.track.id) {
          // If a previous track was active on this deck, close its history entry
          if (active) {
            historyService.recordPlaybackEnd(active.historyId, active.lastPositionMs);
            eventBus.emit('deck:track_finished', { deckId: d, track: active });
          }

          // Start new playback entry
          const historyId = historyService.recordPlaybackStart(deckState.track, d, 'OPERATOR_UI');
          this.activePlayingHistory[d] = {
            historyId,
            trackId: deckState.track.id,
            lastPositionMs: deckState.positionMs,
          };
          eventBus.emit('deck:track_started', { deckId: d, track: deckState.track });
        } else {
          // Update position
          active.lastPositionMs = deckState.positionMs;
        }
      } else if (deckState.state !== 'playing' && active) {
        // Deck stopped or paused or empty
        historyService.recordPlaybackEnd(active.historyId, active.lastPositionMs);
        eventBus.emit('deck:track_finished', { deckId: d, track: active });
        delete this.activePlayingHistory[d];
      }
    }
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

  public async restartDeck(deckId: 'deck_a' | 'deck_b'): Promise<boolean> {
    const res = await controlApi.execute('deck.restart', { deckId });
    if (res.success) {
      await this.refresh();
      return true;
    }
    return false;
  }

  public async unloadDeck(deckId: 'deck_a' | 'deck_b'): Promise<boolean> {
    const res = await controlApi.execute('deck.unload', { deckId });
    if (res.success) {
      await this.refresh();
      return true;
    }
    return false;
  }

  public async setCuePosition(deckId: 'deck_a' | 'deck_b'): Promise<boolean> {
    const res = await controlApi.execute('deck.set_cue_position', { deckId });
    if (res.success) {
      await this.refresh();
      return true;
    }
    return false;
  }

  public async returnToCue(deckId: 'deck_a' | 'deck_b'): Promise<boolean> {
    const res = await controlApi.execute('deck.return_to_cue', { deckId });
    if (res.success) {
      await this.refresh();
      return true;
    }
    return false;
  }

  public async startFromCue(deckId: 'deck_a' | 'deck_b'): Promise<boolean> {
    const res = await controlApi.execute('deck.start_from_cue', { deckId });
    if (res.success) {
      await this.refresh();
      return true;
    }
    return false;
  }

  public async setDeckCue(deckId: 'deck_a' | 'deck_b', cue: boolean): Promise<boolean> {
    const res = await controlApi.execute('deck.set_cue', { deckId, cue });
    if (res.success) {
      await this.refresh();
      return true;
    }
    return false;
  }

  public async setDeckGain(deckId: 'deck_a' | 'deck_b', gainDb: number): Promise<boolean> {
    const res = await controlApi.execute('deck.set_gain', { deckId, gainDb });
    if (res.success) {
      await this.refresh();
      return true;
    }
    return false;
  }

  public async setDeckMute(deckId: 'deck_a' | 'deck_b', muted: boolean): Promise<boolean> {
    const res = await controlApi.execute('deck.set_mute', { deckId, muted });
    if (res.success) {
      await this.refresh();
      return true;
    }
    return false;
  }

  public async triggerTransition(
    targetDeckId: 'deck_a' | 'deck_b',
    mode: 'hard_cut' | 'linear_crossfade' | 'manual' = 'linear_crossfade',
    durationMs: number = 2000
  ): Promise<boolean> {
    const res = await controlApi.execute('deck.trigger_transition', {
      targetDeckId,
      mode,
      durationMs,
    });
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

  public async setMonitorSource(source: 'master' | 'cue'): Promise<boolean> {
    const res = await controlApi.execute('deck.set_monitor_source', { source });
    if (res.success) {
      this.currentSnapshot.monitorSource = source;
      this.notifyListeners();
      return true;
    }
    return false;
  }

  public async setCueGain(gainDb: number): Promise<boolean> {
    const res = await controlApi.execute('deck.set_cue_gain', { gainDb });
    if (res.success) {
      this.currentSnapshot.cueGainDb = gainDb;
      this.notifyListeners();
      return true;
    }
    return false;
  }

  public async setCueMuted(muted: boolean): Promise<boolean> {
    const res = await controlApi.execute('deck.set_cue_muted', { muted });
    if (res.success) {
      this.currentSnapshot.cueMuted = muted;
      this.notifyListeners();
      return true;
    }
    return false;
  }

  // ==========================================
  // PLAYLIST & LIBRARY OPERATIONS
  // ==========================================

  public async getPlaylist(): Promise<PlaylistItem[]> {
    const res = await controlApi.execute('playlist.get');
    return res.success && res.data ? res.data : [];
  }

  public async getLibrary(): Promise<PlaylistItem[]> {
    const res = await controlApi.execute('playlist.get_library');
    return res.success && res.data ? res.data : [];
  }

  public async scanFolder(folderPath: string): Promise<PlaylistItem[]> {
    const res = await controlApi.execute('playlist.scan_folder', { folderPath });
    return res.success && res.data ? res.data : [];
  }

  public async searchLibrary(query: string): Promise<PlaylistItem[]> {
    const res = await controlApi.execute('playlist.search', { query });
    return res.success && res.data ? res.data : [];
  }

  public async removeMissingFiles(): Promise<number> {
    const res = await controlApi.execute('playlist.remove_missing');
    return res.success && typeof res.data === 'number' ? res.data : 0;
  }

  public async togglePinned(id: string): Promise<boolean> {
    const res = await controlApi.execute('playlist.toggle_pinned', { id });
    return res.success && !!res.data;
  }

  public async addFileToPlaylist(filePath: string): Promise<PlaylistItem | null> {
    const res = await controlApi.execute('playlist.add_file', { filePath });
    return res.success && res.data ? res.data : null;
  }

  public async insertNext(filePath: string): Promise<PlaylistItem | null> {
    const res = await controlApi.execute('playlist.insert_next', { filePath });
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

  public async reorderQueue(from: number, to: number): Promise<boolean> {
    const res = await controlApi.execute('playlist.reorder', { from, to });
    return res.success && !!res.data;
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
