import React, { useState, useEffect, useRef } from 'react';
import { shoutcastService } from '../services/shoutcastService';
import { audioEngine } from '../services/audioEngine';

export interface PlaylistItem {
  id: string;
  title: string;
  artist: string;
  durationSeconds: number;
  source: 'Local File' | 'Station ID' | 'Kajian' | 'Live Pass';
  transition: 'CUT' | 'XFADE_3S' | 'XFADE_5S';
  status: 'QUEUED' | 'PLAYING' | 'PLAYED';
}

const DEFAULT_PLAYLIST: PlaylistItem[] = [
  {
    id: 'pl-1',
    title: 'Pembukaan Studio & Warta Siaran',
    artist: 'Announcer On-Duty',
    durationSeconds: 180,
    source: 'Station ID',
    transition: 'CUT',
    status: 'PLAYING',
  },
  {
    id: 'pl-2',
    title: 'Kajian Tematik: Penuntut Ilmu Sejati',
    artist: 'Ustadz Pemateri',
    durationSeconds: 2700,
    source: 'Kajian',
    transition: 'XFADE_3S',
    status: 'QUEUED',
  },
  {
    id: 'pl-3',
    title: 'Station Jingle & Identitas Frekuensi',
    artist: 'Broadcst Sound Lab',
    durationSeconds: 25,
    source: 'Station ID',
    transition: 'CUT',
    status: 'QUEUED',
  },
  {
    id: 'pl-4',
    title: 'Tadabbur Ayat Pilihan & Makna',
    artist: 'Qari Syaikh',
    durationSeconds: 900,
    source: 'Local File',
    transition: 'XFADE_5S',
    status: 'QUEUED',
  },
];

const formatDuration = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const PlaylistWorkspace: React.FC = () => {
  const [items, setItems] = useState<PlaylistItem[]>(() => {
    const saved = localStorage.getItem('broadcst_playlist');
    return saved ? JSON.parse(saved) : DEFAULT_PLAYLIST;
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSeconds, setCurrentSeconds] = useState(42);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Form states
  const [newTitle, setNewTitle] = useState('');
  const [newArtist, setNewArtist] = useState('');
  const [newDuration, setNewDuration] = useState('240');
  const [newSource, setNewSource] = useState<PlaylistItem['source']>('Local File');
  const [newTransition, setNewTransition] = useState<PlaylistItem['transition']>('XFADE_3S');

  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    localStorage.setItem('broadcst_playlist', JSON.stringify(items));
  }, [items]);

  const activeIndex = items.findIndex((item) => item.status === 'PLAYING');
  const activeTrack = activeIndex >= 0 ? items[activeIndex] : null;
  const nextTrack = activeIndex >= 0 && activeIndex + 1 < items.length ? items[activeIndex + 1] : null;

  // Sync active track to broadcast metadata
  useEffect(() => {
    if (activeTrack) {
      shoutcastService.setMetadata({
        title: activeTrack.title,
        artist: activeTrack.artist,
        stationName: shoutcastService.getConfig().stationName,
      });
    }
  }, [activeTrack?.id]);

  // Simulation timer for playhead
  useEffect(() => {
    if (isPlaying && activeTrack) {
      timerRef.current = window.setInterval(() => {
        setCurrentSeconds((prev) => {
          if (prev >= activeTrack.durationSeconds) {
            if (autoAdvance) {
              handleSkipNext();
            } else {
              setIsPlaying(false);
            }
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, activeTrack?.id, autoAdvance, items]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleTogglePlay = () => {
    if (!activeTrack && items.length > 0) {
      setItems((prev) =>
        prev.map((it, idx) => ({
          ...it,
          status: idx === 0 ? 'PLAYING' : 'QUEUED',
        }))
      );
      setCurrentSeconds(0);
      setIsPlaying(true);
      audioEngine.playTone(880, 200, 'music');
      return;
    }

    const nextState = !isPlaying;
    setIsPlaying(nextState);
    if (nextState) {
      audioEngine.playTone(880, 200, 'music');
      showToast(`Playback started: ${activeTrack?.title}`);
    } else {
      showToast('Playback paused');
    }
  };

  const handleSkipNext = () => {
    if (activeIndex === -1 || activeIndex + 1 >= items.length) {
      showToast('Reached end of playlist queue');
      setIsPlaying(false);
      return;
    }

    setItems((prev) =>
      prev.map((it, idx) => {
        if (idx === activeIndex) return { ...it, status: 'PLAYED' };
        if (idx === activeIndex + 1) return { ...it, status: 'PLAYING' };
        return it;
      })
    );
    setCurrentSeconds(0);
    audioEngine.playTone(660, 250, 'music');
    showToast(`Now playing: ${items[activeIndex + 1].title}`);
  };

  const handleMove = (index: number, direction: 'UP' | 'DOWN') => {
    const targetIndex = direction === 'UP' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    setItems((prev) => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy;
    });
  };

  const handlePlayNow = (id: string) => {
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        status: it.id === id ? 'PLAYING' : it.status === 'PLAYING' ? 'QUEUED' : it.status,
      }))
    );
    setCurrentSeconds(0);
    setIsPlaying(true);
    audioEngine.playTone(880, 200, 'music');
  };

  const handleDeleteItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleResetDefaults = () => {
    setItems(DEFAULT_PLAYLIST);
    setCurrentSeconds(0);
    setIsPlaying(false);
    showToast('Loaded default sequence');
  };

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const newItem: PlaylistItem = {
      id: `pl-${Date.now()}`,
      title: newTitle.trim(),
      artist: newArtist.trim() || 'Studio Broadcaster',
      durationSeconds: Math.max(10, parseInt(newDuration, 10) || 180),
      source: newSource,
      transition: newTransition,
      status: items.length === 0 ? 'PLAYING' : 'QUEUED',
    };

    setItems((prev) => [...prev, newItem]);
    setNewTitle('');
    setNewArtist('');
    setShowAddForm(false);
    showToast(`Enqueued: ${newItem.title}`);
  };

  const progressPercent = activeTrack
    ? Math.min(100, (currentSeconds / activeTrack.durationSeconds) * 100)
    : 0;

  return (
    <section className="ws-workspace ws-playlist-layout" aria-label="Playlist & Sequence Station">
      {/* Command & Title Bar */}
      <div className="ws-command-row">
        <div>
          <div className="ws-kicker">Production / Sequencing</div>
          <h1 className="ws-title">Broadcast Sequence Deck</h1>
          <p className="ws-subtitle">
            Timeline queue manager with live cue transport, crossfade transitions, and ICY metadata synchronization.
          </p>
        </div>

        <div className="ws-transport">
          <button
            type="button"
            className="ws-secondary-action"
            onClick={() => setAutoAdvance((v) => !v)}
            title="Automatically advance to the next queued item"
          >
            Auto-Advance: {autoAdvance ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            className="ws-secondary-action"
            onClick={() => setShowAddForm((v) => !v)}
          >
            {showAddForm ? 'Close Form' : '+ Add Item'}
          </button>
          <button
            type="button"
            className="ws-primary-action"
            onClick={handleTogglePlay}
            data-live={isPlaying}
          >
            {isPlaying ? 'Pause Deck' : 'Start Playback'}
          </button>
        </div>
      </div>

      {/* Now Playing Hero Deck */}
      <div className="ws-deck">
        <div className="ws-deck-now">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="ws-badge" data-variant={isPlaying ? 'live' : 'neutral'}>
              {isPlaying ? 'ON DECK • ACTIVE' : 'DECK IDLE'}
            </span>
            <span className="ws-tag">{activeTrack?.source || 'No Source'}</span>
          </div>

          <div>
            <div className="ws-deck-track-title">
              {activeTrack ? activeTrack.title : 'No track loaded in queue'}
            </div>
            <div className="ws-deck-track-artist">
              {activeTrack ? activeTrack.artist : 'Add or select a track below'}
            </div>
          </div>

          <div className="ws-deck-progress-bar">
            <div className="ws-deck-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>

          <div className="ws-deck-times">
            <span>{formatDuration(currentSeconds)}</span>
            <span>{formatDuration(activeTrack ? activeTrack.durationSeconds : 0)}</span>
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
              Next In Queue
            </div>
            {nextTrack ? (
              <>
                <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--ws-text)' }}>
                  {nextTrack.title}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--ws-muted)' }}>
                  {nextTrack.artist} • {formatDuration(nextTrack.durationSeconds)}
                </div>
                <div style={{ marginTop: '8px' }}>
                  <span className="ws-tag">Transition: {nextTrack.transition}</span>
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

      {/* Add Track Drawer / Modal Form */}
      {showAddForm && (
        <form
          onSubmit={handleAddItem}
          style={{
            padding: '14px 16px',
            background: 'var(--ws-panel)',
            border: '1px solid var(--ws-line)',
            borderRadius: '7px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr)) auto',
            gap: '12px',
            alignItems: 'end',
          }}
        >
          <div>
            <label className="ws-form-label">Track Title</label>
            <input
              type="text"
              className="ws-input"
              style={{ width: '100%' }}
              placeholder="e.g. Kajian Tauhid Bagian 2"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="ws-form-label">Artist / Speaker</label>
            <input
              type="text"
              className="ws-input"
              style={{ width: '100%' }}
              placeholder="e.g. Ustadz Fulan"
              value={newArtist}
              onChange={(e) => setNewArtist(e.target.value)}
            />
          </div>

          <div>
            <label className="ws-form-label">Duration (Seconds)</label>
            <input
              type="number"
              className="ws-input"
              style={{ width: '100%' }}
              value={newDuration}
              onChange={(e) => setNewDuration(e.target.value)}
              min="5"
            />
          </div>

          <div>
            <label className="ws-form-label">Category Source</label>
            <select
              className="ws-select"
              style={{ width: '100%' }}
              value={newSource}
              onChange={(e) => setNewSource(e.target.value as any)}
            >
              <option value="Local File">Local File</option>
              <option value="Station ID">Station ID / Jingle</option>
              <option value="Kajian">Kajian / Audio Lecture</option>
              <option value="Live Pass">Live Pass</option>
            </select>
          </div>

          <div>
            <label className="ws-form-label">Transition</label>
            <select
              className="ws-select"
              style={{ width: '100%' }}
              value={newTransition}
              onChange={(e) => setNewTransition(e.target.value as any)}
            >
              <option value="CUT">Instant Cut</option>
              <option value="XFADE_3S">3s Crossfade</option>
              <option value="XFADE_5S">5s Smooth</option>
            </select>
          </div>

          <button type="submit" className="ws-primary-action" style={{ height: '32px' }}>
            Enqueue
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
              <strong>Playlist Queue is Empty</strong>
              <p>No audio tracks scheduled in the queue. Add items or reset defaults to begin broadcasting.</p>
              <button
                type="button"
                className="ws-primary-action"
                style={{ marginTop: '12px' }}
                onClick={handleResetDefaults}
              >
                Load Default Sequence
              </button>
            </div>
          </div>
        ) : (
          <table className="ws-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}>#</th>
                <th>Track Title & Artist</th>
                <th style={{ width: '120px' }}>Source</th>
                <th style={{ width: '90px' }}>Duration</th>
                <th style={{ width: '110px' }}>Transition</th>
                <th style={{ width: '100px' }}>Status</th>
                <th style={{ width: '160px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const isItemPlaying = item.status === 'PLAYING';
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
                      <span className="ws-tag">{item.source}</span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {formatDuration(item.durationSeconds)}
                    </td>
                    <td>
                      <span className="ws-badge" data-variant="neutral">
                        {item.transition}
                      </span>
                    </td>
                    <td>
                      <span
                        className="ws-badge"
                        data-variant={
                          item.status === 'PLAYING'
                            ? 'live'
                            : item.status === 'PLAYED'
                            ? 'neutral'
                            : 'warning'
                        }
                      >
                        {item.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '4px' }}>
                        <button
                          type="button"
                          className="ws-mini-action"
                          onClick={() => handlePlayNow(item.id)}
                          title="Cue and play track immediately"
                        >
                          Cue
                        </button>
                        <button
                          type="button"
                          className="ws-mini-action"
                          onClick={() => handleMove(idx, 'UP')}
                          disabled={idx === 0}
                          title="Move up"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          className="ws-mini-action"
                          onClick={() => handleMove(idx, 'DOWN')}
                          disabled={idx === items.length - 1}
                          title="Move down"
                        >
                          ▼
                        </button>
                        <button
                          type="button"
                          className="ws-mini-action"
                          onClick={() => handleDeleteItem(item.id)}
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

      {/* Toast Notification */}
      {toastMessage && <div className="ws-toast">{toastMessage}</div>}
    </section>
  );
};
