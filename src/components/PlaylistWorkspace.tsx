import React, { useState, useEffect } from 'react';
import { playbackService } from '../services/playbackService';
import { FullPlaybackSnapshot, PlaylistItem } from '../types/ipc';

const formatDuration = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const PlaylistWorkspace: React.FC = () => {
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [snapshot, setSnapshot] = useState<FullPlaybackSnapshot>(playbackService.getSnapshot());
  const [showAddForm, setShowAddForm] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Form states for adding file
  const [filePathInput, setFilePathInput] = useState('');
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  useEffect(() => {
    // Initial fetch of native playlist
    playbackService.getPlaylist().then((loaded) => {
      setItems(loaded);
    });

    // Subscribe to authoritative native playback snapshot
    const unsubscribe = playbackService.onSnapshot((snap) => {
      setSnapshot(snap);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const activeDeck = snapshot.activeDeck === 'deck_a' ? snapshot.deckA : snapshot.deckB;
  const isPlaying = activeDeck.state === 'playing';
  const currentSeconds = Math.round(activeDeck.positionMs / 1000);
  const durationSeconds = Math.max(1, Math.round(activeDeck.durationMs / 1000));
  const activeTrack = activeDeck.track;

  // Next track preview in queue
  const currentIdx = items.findIndex((it) => it.filePath === activeTrack?.filePath);
  const nextTrack = currentIdx >= 0 && currentIdx + 1 < items.length ? items[currentIdx + 1] : items[0] || null;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleTogglePlay = async () => {
    const deckId = snapshot.activeDeck as 'deck_a' | 'deck_b';
    if (isPlaying) {
      await playbackService.pauseDeck(deckId);
      showToast(`${activeDeck.name} paused`);
    } else {
      if (activeDeck.track) {
        await playbackService.playDeck(deckId);
        showToast(`${activeDeck.name} playing: ${activeDeck.track.title}`);
      } else if (items.length > 0) {
        await playbackService.playPlaylistItem(0, deckId);
        showToast(`Started queue from track 1 on ${activeDeck.name}`);
      } else {
        showToast('Please add an audio file to the playlist queue first');
      }
    }
  };

  const handleSkipNext = async () => {
    const res = await playbackService.triggerControlAction('next_track');
    if (res?.track) {
      showToast(`Next track: ${res.track.artist} - ${res.track.title}`);
    } else {
      showToast('Advancing to next track in queue...');
    }
  };

  const handlePlayIndex = async (index: number) => {
    const res = await playbackService.playPlaylistItem(index);
    if (res) {
      showToast(`Cued & playing: ${res.title}`);
    }
  };

  const handleDeleteItem = async (index: number) => {
    await playbackService.removePlaylistItem(index);
    const updated = await playbackService.getPlaylist();
    setItems(updated);
    showToast('Removed item from queue');
  };

  const handleClearPlaylist = async () => {
    await playbackService.clearPlaylist();
    setItems([]);
    showToast('Cleared playlist queue');
  };

  const handleAutoAdvanceToggle = async () => {
    const nextVal = !snapshot.autoAdvance;
    await playbackService.setAutoAdvance(nextVal);
    showToast(`Auto-advance ${nextVal ? 'ENABLED' : 'DISABLED'}`);
  };

  const handleAddFileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!filePathInput.trim()) return;

    setIsLoadingFile(true);
    try {
      const added = await playbackService.addFileToPlaylist(filePathInput.trim());
      if (added) {
        const updated = await playbackService.getPlaylist();
        setItems(updated);
        setFilePathInput('');
        setShowAddForm(false);
        showToast(`Added track: ${added.artist} - ${added.title}`);
      } else {
        showToast('Failed to decode file. Verify format is MP3/WAV/FLAC/OGG.');
      }
    } catch (err: any) {
      showToast(`Error adding file: ${err?.message || err}`);
    } finally {
      setIsLoadingFile(false);
    }
  };

  const progressPercent = activeTrack
    ? Math.min(100, (currentSeconds / durationSeconds) * 100)
    : 0;

  return (
    <section className="ws-workspace ws-playlist-layout" aria-label="Playlist & Sequence Station">
      {/* Command & Title Bar */}
      <div className="ws-command-row">
        <div>
          <div className="ws-kicker">Production / Sequencing</div>
          <h1 className="ws-title">Broadcast Sequence Deck</h1>
          <p className="ws-subtitle">
            Native dual-deck timeline queue manager with live cue transport, crossfade transitions, and automatic SHOUTcast metadata synchronization.
          </p>
        </div>

        <div className="ws-transport">
          <button
            type="button"
            className="ws-secondary-action"
            onClick={handleAutoAdvanceToggle}
            title="Automatically advance to the next queued item"
          >
            Auto-Advance: {snapshot.autoAdvance ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            className="ws-secondary-action"
            onClick={() => setShowAddForm((v) => !v)}
          >
            {showAddForm ? 'Close Form' : '+ Add Audio File'}
          </button>
          <button
            type="button"
            className="ws-primary-action"
            onClick={handleTogglePlay}
            data-live={isPlaying}
          >
            {isPlaying ? `Pause ${activeDeck.name}` : `Play ${activeDeck.name}`}
          </button>
        </div>
      </div>

      {/* Now Playing Hero Deck */}
      <div className="ws-deck">
        <div className="ws-deck-now">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="ws-badge" data-variant={isPlaying ? 'live' : 'neutral'}>
              {isPlaying ? `${activeDeck.name.toUpperCase()} • ACTIVE` : `${activeDeck.name.toUpperCase()} • ${activeDeck.state.toUpperCase()}`}
            </span>
            <span className="ws-tag">Native 48kHz Stereo</span>
          </div>

          <div>
            <div className="ws-deck-track-title">
              {activeTrack ? activeTrack.title : 'No track loaded on active deck'}
            </div>
            <div className="ws-deck-track-artist">
              {activeTrack ? `${activeTrack.artist} • ${activeTrack.album || 'Broadcast Studio'}` : 'Add local audio files to queue below'}
            </div>
          </div>

          <div
            className="ws-deck-progress-bar"
            style={{ cursor: 'pointer' }}
            title="Click to seek native playback position"
            onClick={async (e) => {
              if (!activeTrack) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              const targetMs = Math.round(ratio * activeDeck.durationMs);
              await playbackService.seekDeck(snapshot.activeDeck as any, targetMs);
            }}
          >
            <div className="ws-deck-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>

          <div className="ws-deck-times">
            <span>{formatDuration(currentSeconds)}</span>
            <span>{formatDuration(durationSeconds)}</span>
          </div>
        </div>

        {/* Next Up Strip */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '12px 14px',
            background: 'var(--ws-panel-2)',
            border: '1px solid var(--ws-line)',
            borderRadius: '6px',
          }}
        >
          <div>
            <div className="ws-kicker" style={{ marginBottom: '4px' }}>
              Next In Native Queue
            </div>
            {nextTrack ? (
              <>
                <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--ws-text)' }}>
                  {nextTrack.title}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--ws-muted)' }}>
                  {nextTrack.artist} • {formatDuration(Math.round(nextTrack.durationMs / 1000))}
                </div>
                <div style={{ marginTop: '8px' }}>
                  <span className="ws-tag">{nextTrack.filePath ? nextTrack.filePath.split(/[\\/]/).pop() : 'Local File'}</span>
                </div>
              </>
            ) : (
              <div style={{ fontSize: '11px', color: 'var(--ws-muted)' }}>
                End of queue reached. No subsequent tracks.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <button
              type="button"
              className="ws-secondary-action"
              style={{ height: '30px', flex: 1, fontSize: '10px' }}
              onClick={handleSkipNext}
              disabled={!nextTrack}
            >
              Skip to Next
            </button>
          </div>
        </div>
      </div>

      {/* Add Track Drawer Form */}
      {showAddForm && (
        <form
          onSubmit={handleAddFileSubmit}
          style={{
            padding: '14px 16px',
            background: 'var(--ws-panel)',
            border: '1px solid var(--ws-line)',
            borderRadius: '7px',
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: '12px',
            alignItems: 'end',
          }}
        >
          <div>
            <label className="ws-form-label">Local Audio File Path (MP3, WAV, FLAC, OGG)</label>
            <input
              type="text"
              className="ws-input"
              style={{ width: '100%' }}
              placeholder="e.g. C:\Music\Broadcast_Episode_01.mp3"
              value={filePathInput}
              onChange={(e) => setFilePathInput(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="ws-primary-action"
            style={{ height: '32px' }}
            disabled={isLoadingFile}
          >
            {isLoadingFile ? 'Decoding...' : 'Load & Enqueue'}
          </button>
        </form>
      )}

      {/* Queue Table */}
      <div
        style={{
          border: '1px solid var(--ws-line)',
          borderRadius: '7px',
          background: 'var(--ws-panel)',
          overflow: 'auto',
          minHeight: '220px',
        }}
      >
        {items.length === 0 ? (
          <div className="ws-empty">
            <div>
              <strong>Native Playlist Queue is Empty</strong>
              <p>Add local MP3, WAV, FLAC, or OGG broadcast files to begin playback through Deck A & Deck B.</p>
              <button
                type="button"
                className="ws-primary-action"
                style={{ marginTop: '12px' }}
                onClick={() => setShowAddForm(true)}
              >
                + Add Audio File
              </button>
            </div>
          </div>
        ) : (
          <table className="ws-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}>#</th>
                <th>Track Title & Artist</th>
                <th style={{ width: '180px' }}>File Path</th>
                <th style={{ width: '90px' }}>Duration</th>
                <th style={{ width: '100px' }}>Status</th>
                <th style={{ width: '140px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const isItemPlaying = activeTrack?.filePath === item.filePath && isPlaying;
                return (
                  <tr
                    key={item.id}
                    style={{
                      background: isItemPlaying
                        ? 'color-mix(in srgb, var(--ws-live) 5%, transparent)'
                        : undefined,
                    }}
                  >
                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--ws-subtle)' }}>
                      {(idx + 1).toString().padStart(2, '0')}
                    </td>
                    <td>
                      <div style={{ fontWeight: 650, color: isItemPlaying ? 'var(--ws-live)' : 'var(--ws-text)' }}>
                        {item.title}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>{item.artist}</div>
                    </td>
                    <td>
                      <span className="ws-tag" title={item.filePath}>
                        {item.filePath.split(/[\\/]/).pop() || item.filePath}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {formatDuration(Math.round(item.durationMs / 1000))}
                    </td>
                    <td>
                      <span
                        className="ws-badge"
                        data-variant={isItemPlaying ? 'live' : 'neutral'}
                      >
                        {isItemPlaying ? 'PLAYING' : 'QUEUED'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '4px' }}>
                        <button
                          type="button"
                          className="ws-mini-action"
                          onClick={() => handlePlayIndex(idx)}
                          title="Cue and play track immediately"
                        >
                          Cue & Play
                        </button>
                        <button
                          type="button"
                          className="ws-mini-action"
                          onClick={() => handleDeleteItem(idx)}
                          title="Remove from queue"
                          style={{ color: 'var(--ws-danger)' }}
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {items.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
          <button
            type="button"
            className="ws-secondary-action"
            style={{ fontSize: '11px', height: '28px' }}
            onClick={handleClearPlaylist}
          >
            Clear Entire Queue
          </button>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && <div className="ws-toast">{toastMessage}</div>}
    </section>
  );
};
