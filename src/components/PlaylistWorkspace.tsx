import React, { useState, useEffect } from 'react';
import { playbackService } from '../services/playbackService';
import { FullPlaybackSnapshot, PlaylistItem } from '../types/ipc';

const formatDuration = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const PlaylistWorkspace: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'queue' | 'library'>('queue');
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [libraryItems, setLibraryItems] = useState<PlaylistItem[]>([]);
  const [snapshot, setSnapshot] = useState<FullPlaybackSnapshot>(playbackService.getSnapshot());
  const [showAddForm, setShowAddForm] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Form states for adding file
  const [filePathInput, setFilePathInput] = useState('');
  const [folderPathInput, setFolderPathInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'title' | 'artist' | 'duration'>('title');
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    // Initial fetch of native playlist and library
    playbackService.getPlaylist().then((loaded) => {
      setItems(loaded);
    });

    playbackService.getLibrary().then((loaded) => {
      setLibraryItems(loaded);
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
  const remainingSeconds = Math.max(0, durationSeconds - currentSeconds);
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

  const handleReplayCurrent = async () => {
    const deckId = snapshot.activeDeck as 'deck_a' | 'deck_b';
    await playbackService.restartDeck(deckId);
    showToast(`Restarted current track on ${activeDeck.name}`);
  };

  const handlePlayIndex = async (index: number, deckId?: 'deck_a' | 'deck_b') => {
    const res = await playbackService.playPlaylistItem(index, deckId);
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

  const handleMoveUp = async (index: number) => {
    if (index === 0) return;
    const ok = await playbackService.reorderQueue(index, index - 1);
    if (ok) {
      const updated = await playbackService.getPlaylist();
      setItems(updated);
    }
  };

  const handleMoveDown = async (index: number) => {
    if (index >= items.length - 1) return;
    const ok = await playbackService.reorderQueue(index, index + 1);
    if (ok) {
      const updated = await playbackService.getPlaylist();
      setItems(updated);
    }
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
        const libUpdated = await playbackService.getLibrary();
        setLibraryItems(libUpdated);
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

  const handleScanFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderPathInput.trim()) return;

    setIsScanning(true);
    try {
      const found = await playbackService.scanFolder(folderPathInput.trim());
      setLibraryItems(found);
      showToast(`Scan complete. Found ${found.length} track(s) in library.`);
    } catch (err: any) {
      showToast(`Error scanning folder: ${err?.message || err}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleRemoveMissing = async () => {
    const count = await playbackService.removeMissingFiles();
    const libUpdated = await playbackService.getLibrary();
    setLibraryItems(libUpdated);
    const queueUpdated = await playbackService.getPlaylist();
    setItems(queueUpdated);
    showToast(`Cleaned up ${count} missing/deleted file(s)`);
  };

  const handleTogglePinned = async (id: string) => {
    const nextPinned = await playbackService.togglePinned(id);
    const libUpdated = await playbackService.getLibrary();
    setLibraryItems(libUpdated);
    showToast(nextPinned ? 'Pinned to favorites' : 'Unpinned from favorites');
  };

  const handleEnqueueFromLibrary = async (filePath: string) => {
    const added = await playbackService.addFileToPlaylist(filePath);
    if (added) {
      const updated = await playbackService.getPlaylist();
      setItems(updated);
      showToast(`Enqueued: ${added.title}`);
    }
  };

  const handleInsertNextFromLibrary = async (filePath: string) => {
    const added = await playbackService.insertNext(filePath);
    if (added) {
      const updated = await playbackService.getPlaylist();
      setItems(updated);
      showToast(`Inserted next: ${added.title}`);
    }
  };

  const handleReturnToCue = async () => {
    const deckId = snapshot.activeDeck as 'deck_a' | 'deck_b';
    await playbackService.returnToCue(deckId);
    showToast(`${activeDeck.name} returned to cue point (${activeDeck.cuePositionMs}ms)`);
  };

  const handleSetCuePosition = async () => {
    const deckId = snapshot.activeDeck as 'deck_a' | 'deck_b';
    await playbackService.setCuePosition(deckId);
    showToast(`${activeDeck.name} cue position set to ${activeDeck.positionMs}ms`);
  };

  const handleStartFromCue = async () => {
    const deckId = snapshot.activeDeck as 'deck_a' | 'deck_b';
    await playbackService.startFromCue(deckId);
    showToast(`${activeDeck.name} started from cue position`);
  };

  const progressPercent = activeTrack
    ? Math.min(100, (currentSeconds / durationSeconds) * 100)
    : 0;

  // Filtered and sorted library items
  const filteredLibrary = libraryItems
    .filter((item) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        item.artist.toLowerCase().includes(q) ||
        (item.album && item.album.toLowerCase().includes(q)) ||
        item.filePath.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (sortBy === 'artist') return a.artist.localeCompare(b.artist);
      if (sortBy === 'duration') return b.durationMs - a.durationMs;
      return a.title.localeCompare(b.title);
    });

  return (
    <section className="ws-workspace ws-playlist-layout" aria-label="Playlist & Sequence Station">
      {/* Command & Title Bar */}
      <div className="ws-command-row">
        <div>
          <div className="ws-kicker">Production / Sequencing</div>
          <h1 className="ws-title">Broadcast Sequence & Library</h1>
          <p className="ws-subtitle">
            Authoritative native timeline queue with recursive library scanning, gapless preloading, and broadcast cue points.
          </p>
        </div>

        <div className="ws-transport">
          <div style={{ display: 'inline-flex', border: '1px solid var(--ws-line)', borderRadius: '6px', overflow: 'hidden' }}>
            <button
              type="button"
              className="ws-mini-action"
              style={{
                borderRadius: 0,
                background: activeTab === 'queue' ? 'var(--ws-panel-3)' : 'transparent',
                color: activeTab === 'queue' ? 'var(--ws-live)' : 'var(--ws-muted)',
                fontWeight: activeTab === 'queue' ? 700 : 500,
                border: 'none',
                padding: '6px 14px',
              }}
              onClick={() => setActiveTab('queue')}
            >
              Active Queue ({items.length})
            </button>
            <button
              type="button"
              className="ws-mini-action"
              style={{
                borderRadius: 0,
                background: activeTab === 'library' ? 'var(--ws-panel-3)' : 'transparent',
                color: activeTab === 'library' ? 'var(--ws-live)' : 'var(--ws-muted)',
                fontWeight: activeTab === 'library' ? 700 : 500,
                border: 'none',
                padding: '6px 14px',
              }}
              onClick={() => setActiveTab('library')}
            >
              Station Library ({libraryItems.length})
            </button>
          </div>

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
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="ws-badge" data-variant={isPlaying ? 'live' : 'neutral'}>
                {isPlaying ? `${activeDeck.name.toUpperCase()} • ACTIVE` : `${activeDeck.name.toUpperCase()} • ${activeDeck.state.toUpperCase()}`}
              </span>
              <span className="ws-tag">Native 48kHz Stereo</span>
              {activeDeck.cue && <span className="ws-tag" style={{ color: 'var(--ws-warning)', borderColor: 'var(--ws-warning)' }}>CUE MONITOR ACTIVE</span>}
            </div>

            {/* Cue Macro Buttons */}
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                className="ws-mini-action"
                onClick={handleSetCuePosition}
                title="Mark current frame as Cue Point"
              >
                Set Cue Pos
              </button>
              <button
                type="button"
                className="ws-mini-action"
                onClick={handleReturnToCue}
                title="Return playhead to Cue Point"
              >
                Return to Cue
              </button>
              <button
                type="button"
                className="ws-mini-action"
                onClick={handleStartFromCue}
                title="Start playback from Cue Point"
              >
                Start from Cue
              </button>
            </div>
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
            <span>Elapsed: {formatDuration(currentSeconds)} ({activeDeck.playbackPercent.toFixed(1)}%)</span>
            <span>Cue: {formatDuration(Math.round(activeDeck.cuePositionMs / 1000))}</span>
            <span>Remaining: -{formatDuration(remainingSeconds)} / {formatDuration(durationSeconds)}</span>
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
              onClick={handleReplayCurrent}
            >
              Replay Current
            </button>
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
              placeholder="e.g. C:\Broadcasting\Audio\Track_01.mp3"
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

      {/* Content depending on Active Tab */}
      {activeTab === 'queue' ? (
        /* QUEUE TAB */
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
                <p>Add local MP3, WAV, FLAC, or OGG broadcast files or enqueue from Station Library.</p>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '12px' }}>
                  <button
                    type="button"
                    className="ws-primary-action"
                    onClick={() => setShowAddForm(true)}
                  >
                    + Add Audio File
                  </button>
                  <button
                    type="button"
                    className="ws-secondary-action"
                    onClick={() => setActiveTab('library')}
                  >
                    Open Library
                  </button>
                </div>
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
                  <th style={{ width: '220px', textAlign: 'right' }}>Actions</th>
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
                        <div style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>{item.artist} {item.album ? `• ${item.album}` : ''}</div>
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
                            onClick={() => handlePlayIndex(idx, 'deck_a')}
                            title="Cue and play on Deck A"
                          >
                            Deck A
                          </button>
                          <button
                            type="button"
                            className="ws-mini-action"
                            onClick={() => handlePlayIndex(idx, 'deck_b')}
                            title="Cue and play on Deck B"
                          >
                            Deck B
                          </button>
                          <button
                            type="button"
                            className="ws-mini-action"
                            onClick={() => handleMoveUp(idx)}
                            disabled={idx === 0}
                            title="Move track up in queue"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            className="ws-mini-action"
                            onClick={() => handleMoveDown(idx)}
                            disabled={idx === items.length - 1}
                            title="Move track down in queue"
                          >
                            ▼
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
      ) : (
        /* LIBRARY TAB */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Library Control Bar: Scan Folder + Search + Sort + Clean Missing */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.2fr 1fr auto auto',
              gap: '10px',
              padding: '10px 14px',
              background: 'var(--ws-panel)',
              border: '1px solid var(--ws-line)',
              borderRadius: '7px',
              alignItems: 'center',
            }}
          >
            <form onSubmit={handleScanFolder} style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                className="ws-input"
                style={{ flex: 1, height: '30px' }}
                placeholder="Enter folder path to scan (e.g. C:\Music\Jingles)..."
                value={folderPathInput}
                onChange={(e) => setFolderPathInput(e.target.value)}
              />
              <button
                type="submit"
                className="ws-secondary-action"
                style={{ height: '30px', whiteSpace: 'nowrap' }}
                disabled={isScanning}
              >
                {isScanning ? 'Scanning...' : 'Scan Folder'}
              </button>
            </form>

            <div>
              <input
                type="text"
                className="ws-input"
                style={{ width: '100%', height: '30px' }}
                placeholder="Search title, artist, album..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '11px', color: 'var(--ws-muted)' }}>Sort:</label>
              <select
                className="ws-input"
                style={{ height: '30px', padding: '0 8px' }}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
              >
                <option value="title">Title</option>
                <option value="artist">Artist</option>
                <option value="duration">Duration</option>
              </select>
            </div>

            <button
              type="button"
              className="ws-secondary-action"
              style={{ height: '30px', fontSize: '11px' }}
              onClick={handleRemoveMissing}
              title="Remove records whose audio files no longer exist on disk"
            >
              Prune Missing
            </button>
          </div>

          {/* Library Table */}
          <div
            style={{
              border: '1px solid var(--ws-line)',
              borderRadius: '7px',
              background: 'var(--ws-panel)',
              overflow: 'auto',
              minHeight: '220px',
            }}
          >
            {filteredLibrary.length === 0 ? (
              <div className="ws-empty">
                <div>
                  <strong>No Library Items Found</strong>
                  <p>Scan a local folder with media files or add files to populate the station library.</p>
                </div>
              </div>
            ) : (
              <table className="ws-table">
                <thead>
                  <tr>
                    <th style={{ width: '32px' }}>★</th>
                    <th>Track Title & Artist</th>
                    <th>Album</th>
                    <th style={{ width: '80px' }}>Format</th>
                    <th style={{ width: '90px' }}>Duration</th>
                    <th style={{ width: '240px', textAlign: 'right' }}>Enqueue Operations</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLibrary.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <button
                          type="button"
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: item.pinned ? 'var(--ws-live)' : 'var(--ws-subtle)',
                            fontSize: '14px',
                            padding: 0,
                          }}
                          onClick={() => handleTogglePinned(item.id)}
                          title={item.pinned ? 'Unpin' : 'Pin to favorites'}
                        >
                          {item.pinned ? '★' : '☆'}
                        </button>
                      </td>
                      <td>
                        <div style={{ fontWeight: 650, color: 'var(--ws-text)' }}>{item.title}</div>
                        <div style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>{item.artist}</div>
                      </td>
                      <td style={{ fontSize: '11px', color: 'var(--ws-muted)' }}>{item.album || '—'}</td>
                      <td>
                        <span className="ws-tag">{item.format ? item.format.toUpperCase() : 'AUDIO'}</span>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>
                        {formatDuration(Math.round(item.durationMs / 1000))}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '4px' }}>
                          <button
                            type="button"
                            className="ws-mini-action"
                            onClick={() => handleEnqueueFromLibrary(item.filePath)}
                            title="Add track to bottom of queue"
                          >
                            + Queue
                          </button>
                          <button
                            type="button"
                            className="ws-mini-action"
                            onClick={() => handleInsertNextFromLibrary(item.filePath)}
                            title="Insert track immediately after current track"
                          >
                            Insert Next
                          </button>
                          <button
                            type="button"
                            className="ws-mini-action"
                            onClick={async () => {
                              await playbackService.loadDeck('deck_a', item.filePath);
                              showToast(`Loaded "${item.title}" into Deck A`);
                            }}
                            title="Load into Deck A directly"
                          >
                            Deck A
                          </button>
                          <button
                            type="button"
                            className="ws-mini-action"
                            onClick={async () => {
                              await playbackService.loadDeck('deck_b', item.filePath);
                              showToast(`Loaded "${item.title}" into Deck B`);
                            }}
                            title="Load into Deck B directly"
                          >
                            Deck B
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {items.length > 0 && activeTab === 'queue' && (
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
