import React, { useMemo, useState, useEffect } from 'react';
import { shoutcastService } from '../services/shoutcastService';
import { playbackService } from '../services/playbackService';
import { recorderService, RecorderState } from '../services/recorderService';
import { stationProfileManager } from '../services/profile/stationProfileManager';
import { BroadcastStatus } from '../types/broadcast';
import { StreamMetrics } from '../types/telemetry';
import { TranscriptSegment, TranscriptStatus } from '../types/transcript';
import { BroadcastPreflightError, FullPlaybackSnapshot, PlaylistItem } from '../types/ipc';
import { outputRouter, PluginOutputTarget } from '../services/plugin/outputRouter';
import { PluginUISlotRenderer } from './PluginUISlotRenderer';

interface OnAirWorkspaceProps {
  status: BroadcastStatus;
  metrics: StreamMetrics;
  transcriptStatus: TranscriptStatus;
  transcriptSegments: TranscriptSegment[];
  masterPeakDb: number;
  masterRmsDb: number;
  onStartBroadcast: () => void;
  onStopBroadcast: () => void;
  onReconnect: () => void;
}

const formatUptime = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const formatDuration = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const dbToUnit = (db: number): number => Math.max(0, Math.min(1, (db + 60) / 60));

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

export const OnAirWorkspace: React.FC<OnAirWorkspaceProps> = ({
  status,
  metrics,
  transcriptStatus,
  transcriptSegments,
  masterPeakDb,
  masterRmsDb,
  onStartBroadcast,
  onStopBroadcast,
  onReconnect,
}) => {
  const isLive = status.state === 'CONNECTED';
  const level = dbToUnit(masterRmsDb);
  const peak = dbToUnit(masterPeakDb);
  const hasAudio = masterPeakDb > -58 || masterRmsDb > -58;
  const recentSegments = useMemo(() => transcriptSegments.slice(-5), [transcriptSegments]);

  const [playbackSnap, setPlaybackSnap] = useState<FullPlaybackSnapshot>(playbackService.getSnapshot());
  const [queueItems, setQueueItems] = useState<PlaylistItem[]>([]);
  const [recorderState, setRecorderState] = useState<RecorderState>(recorderService.getState());
  const [recordDuration, setRecordDuration] = useState<number>(recorderService.getCurrentDuration());
  const [preflightErrors, setPreflightErrors] = useState<BroadcastPreflightError[]>([]);
  const [showPreflightModal, setShowPreflightModal] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [pluginOutputs, setPluginOutputs] = useState<PluginOutputTarget[]>(() => outputRouter.getPluginOutputs());

  useEffect(() => {
    let mounted = true;
    const loadQueue = async () => {
      try {
        const items = await playbackService.getPlaylist();
        if (mounted) setQueueItems(items);
      } catch {
        // Ignored
      }
    };

    loadQueue();

    const unsubSnap = playbackService.onSnapshot((snap) => {
      setPlaybackSnap(snap);
      loadQueue();
    });

    const unsubRec = recorderService.onStateChange((st, dur) => {
      setRecorderState(st);
      setRecordDuration(dur);
    });

    const unsubOutputs = outputRouter.subscribe(() => {
      if (mounted) {
        setPluginOutputs(outputRouter.getPluginOutputs());
      }
    });

    return () => {
      mounted = false;
      unsubSnap();
      unsubRec();
      unsubOutputs();
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const deckA = playbackSnap.deckA;
  const deckB = playbackSnap.deckB;
  const isDeckAPlaying = deckA.state === 'playing';
  const isDeckBPlaying = deckB.state === 'playing';

  const deckAPos = Math.round(deckA.positionMs / 1000);
  const deckADur = Math.max(1, Math.round(deckA.durationMs / 1000));
  const deckAPercent = deckA.track ? Math.min(100, (deckAPos / deckADur) * 100) : 0;
  const deckARem = Math.max(0, deckADur - deckAPos);

  const deckBPos = Math.round(deckB.positionMs / 1000);
  const deckBDur = Math.max(1, Math.round(deckB.durationMs / 1000));
  const deckBPercent = deckB.track ? Math.min(100, (deckBPos / deckBDur) * 100) : 0;
  const deckBRem = Math.max(0, deckBDur - deckBPos);

  const activeTrack = isDeckAPlaying ? deckA.track : isDeckBPlaying ? deckB.track : (deckA.track || deckB.track);
  const nowPlayingTitle = isDeckAPlaying || isDeckBPlaying
    ? (activeTrack?.title || 'Playing Audio')
    : (deckA.track || deckB.track
      ? `Cued: ${activeTrack?.title}`
      : 'Station Idle — Ready for playback');
  const nowPlayingArtist = activeTrack
    ? `${activeTrack.artist || 'Unknown Artist'}${activeTrack.album ? ` • ${activeTrack.album}` : ''}`
    : 'No active media playing on program bus';
  const nowPlayingDeck = isDeckAPlaying
    ? 'Deck A'
    : isDeckBPlaying
    ? 'Deck B'
    : deckA.track
    ? 'Deck A (Cued)'
    : deckB.track
    ? 'Deck B (Cued)'
    : 'None';

  const nextQueueTrack = queueItems.length > 0 ? queueItems[0] : null;
  const activeProfile = stationProfileManager.getActiveProfile();

  const handleStartBroadcastClick = async () => {
    const errors = await shoutcastService.validatePreflight(status.config);
    if (errors && errors.length > 0) {
      setPreflightErrors(errors);
      setShowPreflightModal(true);
      return;
    }
    onStartBroadcast();
  };

  const handleToggleRecord = async () => {
    if (recorderState === 'RECORDING') {
      const session = await recorderService.stopRecording();
      showToast(session ? `Saved master tape: ${session.title}` : 'Master recording stopped');
    } else {
      const ok = await recorderService.startRecording();
      showToast(ok ? 'Master audio capture active' : 'Failed to start recording. Verify audio engine.');
    }
  };

  const handleToggleDeckA = async () => {
    if (isDeckAPlaying) {
      await playbackService.pauseDeck('deck_a');
    } else {
      await playbackService.playDeck('deck_a');
    }
  };

  const handleToggleDeckB = async () => {
    if (isDeckBPlaying) {
      await playbackService.pauseDeck('deck_b');
    } else {
      await playbackService.playDeck('deck_b');
    }
  };

  const handleCrossfaderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    await playbackService.setCrossfader(val);
  };

  const handleTransition = async (targetDeckId: 'deck_a' | 'deck_b', mode: 'hard_cut' | 'linear_crossfade') => {
    const ok = await playbackService.triggerTransition(targetDeckId, mode, 2500);
    if (ok) {
      showToast(`${mode === 'hard_cut' ? 'Hard Cut' : 'Crossfade'} to ${targetDeckId === 'deck_a' ? 'Deck A' : 'Deck B'} triggered`);
    }
  };

  const handleToggleMonitorSource = async () => {
    const nextSource = playbackSnap.monitorSource === 'master' ? 'cue' : 'master';
    await playbackService.setMonitorSource(nextSource as any);
    showToast(`Physical monitor routed to: ${nextSource.toUpperCase()}`);
  };

  return (
    <section className="ws-workspace ws-workspace--air">
      {/* Top Station & Operation Cockpit */}
      <div className="ws-command-row">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="ws-kicker">On Air / Master Console</span>
            {activeProfile?.callsign && (
              <span className="ws-tag" style={{ color: 'var(--ws-live)', borderColor: 'var(--ws-live)' }}>
                {activeProfile.callsign}
              </span>
            )}
          </div>
          <h1 className="ws-title" style={{ margin: '2px 0 4px 0' }}>
            {activeProfile?.name || status.config.stationName}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              className="ws-badge"
              data-variant={isLive ? 'live' : status.state === 'ERROR' ? 'danger' : 'neutral'}
            >
              {isLive ? '● ON AIR' : status.state}
            </span>
            {recorderState === 'RECORDING' && (
              <span className="ws-badge" data-variant="danger" style={{ animation: 'ws-pulse 1.5s infinite' }}>
                ● REC {formatDuration(recordDuration)}
              </span>
            )}
            <span style={{ fontSize: '11px', color: 'var(--ws-muted)' }}>
              Now Playing ({nowPlayingDeck}): <strong style={{ color: 'var(--ws-text)' }}>{nowPlayingTitle}</strong> — {nowPlayingArtist}
            </span>
          </div>
        </div>

        <div className="ws-transport">
          {/* Cue vs Program Monitor Toggle */}
          <button
            type="button"
            className="ws-secondary-action"
            onClick={handleToggleMonitorSource}
            title="Toggle whether physical headphones output hears Master Program or Cue Bus"
            style={{
              borderColor: playbackSnap.monitorSource === 'cue' ? 'var(--ws-warning)' : undefined,
              color: playbackSnap.monitorSource === 'cue' ? 'var(--ws-warning)' : undefined,
            }}
          >
            Monitor: {playbackSnap.monitorSource.toUpperCase()}
          </button>

          {/* Master Output Capture */}
          <button
            type="button"
            className="ws-secondary-action"
            onClick={handleToggleRecord}
            title={recorderState === 'RECORDING' ? 'Stop recording master audio to disk' : 'Record master output to local WAV archive'}
            style={{
              borderColor: recorderState === 'RECORDING' ? 'var(--ws-danger)' : undefined,
              color: recorderState === 'RECORDING' ? 'var(--ws-danger)' : undefined,
              background: recorderState === 'RECORDING' ? 'rgba(255, 95, 112, 0.12)' : undefined,
            }}
          >
            {recorderState === 'RECORDING' ? `Stop REC (${formatDuration(recordDuration)})` : '● Record Master'}
          </button>

          {status.state === 'ERROR' && (
            <button type="button" className="ws-secondary-action" onClick={onReconnect}>
              Reconnect
            </button>
          )}

          <button
            type="button"
            className="ws-primary-action"
            data-live={isLive}
            onClick={isLive ? onStopBroadcast : handleStartBroadcastClick}
          >
            {isLive ? 'Stop Broadcast' : 'Start Broadcast'}
          </button>
        </div>
      </div>

      {/* Dual Deck Broadcast Workstation */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 190px minmax(0, 1fr)',
          gap: '12px',
          padding: '12px 14px',
          background: 'var(--ws-panel)',
          border: '1px solid var(--ws-line)',
          borderRadius: '7px',
          alignItems: 'start',
        }}
      >
        {/* DECK A */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="ws-badge" data-variant={isDeckAPlaying ? 'live' : 'neutral'}>
                DECK A • {deckA.state.toUpperCase()}
              </span>
              {playbackSnap.activeDeck === 'deck_a' && <span className="ws-tag">FOCUSED</span>}
              {deckA.muted && <span className="ws-tag" style={{ color: 'var(--ws-danger)' }}>MUTED</span>}
            </div>

            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                className="ws-mini-action"
                onClick={handleToggleDeckA}
                style={{
                  borderColor: isDeckAPlaying ? 'var(--ws-live)' : undefined,
                  color: isDeckAPlaying ? 'var(--ws-live)' : undefined,
                }}
              >
                {isDeckAPlaying ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                className="ws-mini-action"
                onClick={() => playbackService.stopDeck('deck_a')}
                title="Stop Deck A"
              >
                Stop
              </button>
              <button
                type="button"
                className="ws-mini-action"
                onClick={() => playbackService.restartDeck('deck_a')}
                title="Restart Deck A from beginning"
              >
                Restart
              </button>
            </div>
          </div>

          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ws-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {deckA.track ? deckA.track.title : 'No track loaded'}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--ws-muted)' }}>
              {deckA.track ? `${deckA.track.artist} ${deckA.track.album ? `• ${deckA.track.album}` : ''}` : 'Cue or load track from library'}
            </div>
          </div>

          <div
            className="ws-deck-progress-bar"
            style={{ height: '6px', background: 'var(--ws-panel-3)', borderRadius: '3px', overflow: 'hidden', cursor: 'pointer' }}
            title="Click to seek position on Deck A"
            onClick={async (e) => {
              if (!deckA.track) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              const targetMs = Math.round(ratio * deckA.durationMs);
              await playbackService.seekDeck('deck_a', targetMs);
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${deckAPercent}%`,
                background: 'var(--ws-live)',
                transition: 'width 100ms linear',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--ws-subtle)' }}>
            <span>{formatDuration(deckAPos)} ({deckA.playbackPercent.toFixed(1)}%)</span>
            <span>Cue: {formatDuration(Math.round(deckA.cuePositionMs / 1000))}</span>
            <span>-{formatDuration(deckARem)} / {formatDuration(deckADur)}</span>
          </div>

          {/* Deck A Cue & Operational Bar */}
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', paddingTop: '4px', borderTop: '1px solid var(--ws-line)' }}>
            <button
              type="button"
              className="ws-mini-action"
              style={{
                borderColor: deckA.cue ? 'var(--ws-warning)' : undefined,
                color: deckA.cue ? 'var(--ws-warning)' : undefined,
              }}
              onClick={async () => {
                const nextCue = !deckA.cue;
                await playbackService.setDeckCue('deck_a', nextCue);
                showToast(`Deck A Cue monitor: ${nextCue ? 'ACTIVE' : 'OFF'}`);
              }}
              title="Route Deck A to Cue Monitor"
            >
              Cue {deckA.cue ? '●' : '○'}
            </button>
            <button
              type="button"
              className="ws-mini-action"
              onClick={() => playbackService.setCuePosition('deck_a')}
              title="Set current playhead as Cue Position"
            >
              Set Cue
            </button>
            <button
              type="button"
              className="ws-mini-action"
              onClick={() => playbackService.returnToCue('deck_a')}
              title="Return to Cue Position"
            >
              Return Cue
            </button>
            <button
              type="button"
              className="ws-mini-action"
              onClick={() => playbackService.startFromCue('deck_a')}
              title="Start playback from Cue Position"
            >
              Start Cue
            </button>
            <button
              type="button"
              className="ws-mini-action"
              style={{
                color: deckA.muted ? 'var(--ws-danger)' : undefined,
                borderColor: deckA.muted ? 'var(--ws-danger)' : undefined,
              }}
              onClick={() => playbackService.setDeckMute('deck_a', !deckA.muted)}
              title="Mute Deck A"
            >
              Mute
            </button>
            <button
              type="button"
              className="ws-mini-action"
              onClick={() => playbackService.unloadDeck('deck_a')}
              title="Unload track from Deck A"
            >
              Unload
            </button>
          </div>
        </div>

        {/* CENTER TRANSITION CONSOLE */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '0 4px' }}>
          <div style={{ fontSize: '9.5px', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--ws-muted)' }}>
            BROADCAST TRANSITIONS
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', width: '100%' }}>
            <button
              type="button"
              className="ws-mini-action"
              style={{ fontSize: '9px', padding: '4px 6px' }}
              onClick={() => handleTransition('deck_a', 'hard_cut')}
              title="Instantly cut to Deck A"
            >
              Cut Deck A
            </button>
            <button
              type="button"
              className="ws-mini-action"
              style={{ fontSize: '9px', padding: '4px 6px' }}
              onClick={() => handleTransition('deck_b', 'hard_cut')}
              title="Instantly cut to Deck B"
            >
              Cut Deck B
            </button>
            <button
              type="button"
              className="ws-mini-action"
              style={{ fontSize: '9px', padding: '4px 6px' }}
              onClick={() => handleTransition('deck_a', 'linear_crossfade')}
              title="Smooth linear crossfade to Deck A"
            >
              Fade → A
            </button>
            <button
              type="button"
              className="ws-mini-action"
              style={{ fontSize: '9px', padding: '4px 6px' }}
              onClick={() => handleTransition('deck_b', 'linear_crossfade')}
              title="Smooth linear crossfade to Deck B"
            >
              Fade → B
            </button>
          </div>

          <input
            type="range"
            min="-1"
            max="1"
            step="0.02"
            value={playbackSnap.crossfader}
            onChange={handleCrossfaderChange}
            style={{ width: '100%', accentColor: 'var(--ws-live)' }}
            title="Deck A ← Crossfader → Deck B"
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '8px', color: 'var(--ws-subtle)', fontFamily: 'var(--font-mono)' }}>
            <span>DECK A</span>
            <span>{playbackSnap.crossfader.toFixed(2)}</span>
            <span>DECK B</span>
          </div>
        </div>

        {/* DECK B */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="ws-badge" data-variant={isDeckBPlaying ? 'live' : 'neutral'}>
                DECK B • {deckB.state.toUpperCase()}
              </span>
              {playbackSnap.activeDeck === 'deck_b' && <span className="ws-tag">FOCUSED</span>}
              {deckB.muted && <span className="ws-tag" style={{ color: 'var(--ws-danger)' }}>MUTED</span>}
            </div>

            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                className="ws-mini-action"
                onClick={handleToggleDeckB}
                style={{
                  borderColor: isDeckBPlaying ? 'var(--ws-live)' : undefined,
                  color: isDeckBPlaying ? 'var(--ws-live)' : undefined,
                }}
              >
                {isDeckBPlaying ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                className="ws-mini-action"
                onClick={() => playbackService.stopDeck('deck_b')}
                title="Stop Deck B"
              >
                Stop
              </button>
              <button
                type="button"
                className="ws-mini-action"
                onClick={() => playbackService.restartDeck('deck_b')}
                title="Restart Deck B from beginning"
              >
                Restart
              </button>
            </div>
          </div>

          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ws-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {deckB.track ? deckB.track.title : 'No track loaded'}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--ws-muted)' }}>
              {deckB.track ? `${deckB.track.artist} ${deckB.track.album ? `• ${deckB.track.album}` : ''}` : 'Cue or load track from library'}
            </div>
          </div>

          <div
            className="ws-deck-progress-bar"
            style={{ height: '6px', background: 'var(--ws-panel-3)', borderRadius: '3px', overflow: 'hidden', cursor: 'pointer' }}
            title="Click to seek position on Deck B"
            onClick={async (e) => {
              if (!deckB.track) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              const targetMs = Math.round(ratio * deckB.durationMs);
              await playbackService.seekDeck('deck_b', targetMs);
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${deckBPercent}%`,
                background: 'var(--ws-live)',
                transition: 'width 100ms linear',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--ws-subtle)' }}>
            <span>{formatDuration(deckBPos)} ({deckB.playbackPercent.toFixed(1)}%)</span>
            <span>Cue: {formatDuration(Math.round(deckB.cuePositionMs / 1000))}</span>
            <span>-{formatDuration(deckBRem)} / {formatDuration(deckBDur)}</span>
          </div>

          {/* Deck B Cue & Operational Bar */}
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', paddingTop: '4px', borderTop: '1px solid var(--ws-line)' }}>
            <button
              type="button"
              className="ws-mini-action"
              style={{
                borderColor: deckB.cue ? 'var(--ws-warning)' : undefined,
                color: deckB.cue ? 'var(--ws-warning)' : undefined,
              }}
              onClick={async () => {
                const nextCue = !deckB.cue;
                await playbackService.setDeckCue('deck_b', nextCue);
                showToast(`Deck B Cue monitor: ${nextCue ? 'ACTIVE' : 'OFF'}`);
              }}
              title="Route Deck B to Cue Monitor"
            >
              Cue {deckB.cue ? '●' : '○'}
            </button>
            <button
              type="button"
              className="ws-mini-action"
              onClick={() => playbackService.setCuePosition('deck_b')}
              title="Set current playhead as Cue Position"
            >
              Set Cue
            </button>
            <button
              type="button"
              className="ws-mini-action"
              onClick={() => playbackService.returnToCue('deck_b')}
              title="Return to Cue Position"
            >
              Return Cue
            </button>
            <button
              type="button"
              className="ws-mini-action"
              onClick={() => playbackService.startFromCue('deck_b')}
              title="Start playback from Cue Position"
            >
              Start Cue
            </button>
            <button
              type="button"
              className="ws-mini-action"
              style={{
                color: deckB.muted ? 'var(--ws-danger)' : undefined,
                borderColor: deckB.muted ? 'var(--ws-danger)' : undefined,
              }}
              onClick={() => playbackService.setDeckMute('deck_b', !deckB.muted)}
              title="Mute Deck B"
            >
              Mute
            </button>
            <button
              type="button"
              className="ws-mini-action"
              onClick={() => playbackService.unloadDeck('deck_b')}
              title="Unload track from Deck B"
            >
              Unload
            </button>
          </div>
        </div>
      </div>

      {/* Middle Operational Split: Master VU Meter & Upcoming Program Queue */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(320px, 1fr)', gap: '12px' }}>
        {/* Master Program Signal Console */}
        <section
          style={{
            border: '1px solid var(--ws-line)',
            borderRadius: '7px',
            background: 'var(--ws-panel)',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
          aria-label="Master program signal console"
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="ws-strip-source" style={{ color: 'var(--ws-live)' }}>MASTER PROGRAM BUS</span>
              <span
                className="ws-badge"
                data-variant={masterPeakDb >= -0.5 ? 'danger' : isLive ? 'live' : hasAudio ? 'ready' : 'neutral'}
              >
                {masterPeakDb >= -0.5 ? 'OVERLOAD' : isLive ? 'ON AIR' : hasAudio ? 'SIGNAL PRESENT' : 'IDLE'}
              </span>
            </div>
            <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--ws-muted)' }}>
              {status.config.bitrate} kbps • {status.config.codec} • 48kHz Stereo
            </div>
          </div>

          {/* Calibrated dBFS Stereo Meter Bars */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', padding: '4px 0' }}>
            {/* Scale markings */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--ws-subtle)', padding: '0 2px' }}>
              <span>-60</span>
              <span>-36</span>
              <span>-24</span>
              <span>-18</span>
              <span>-12</span>
              <span>-6</span>
              <span>-3</span>
              <span style={{ color: 'var(--ws-danger)' }}>0 dBFS</span>
            </div>

            {/* Left Channel */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--ws-muted)', width: '12px' }}>L</span>
              <div style={{ flex: 1, height: '8px', background: 'var(--ws-panel-3)', borderRadius: '2px', overflow: 'hidden', position: 'relative' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.max(2, level * 100)}%`,
                    background: peak > 0.95 ? 'var(--ws-danger)' : peak > 0.8 ? 'var(--ws-warning)' : 'var(--ws-live)',
                    transition: 'width 80ms linear',
                  }}
                />
              </div>
            </div>

            {/* Right Channel */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--ws-muted)', width: '12px' }}>R</span>
              <div style={{ flex: 1, height: '8px', background: 'var(--ws-panel-3)', borderRadius: '2px', overflow: 'hidden', position: 'relative' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.max(2, Math.max(0, level - 0.02) * 100)}%`,
                    background: peak > 0.95 ? 'var(--ws-danger)' : peak > 0.8 ? 'var(--ws-warning)' : 'var(--ws-live)',
                    transition: 'width 80ms linear',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Telemetry readouts footer */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--ws-muted)', borderTop: '1px solid var(--ws-line)', paddingTop: '6px' }}>
            <span>RMS: <strong style={{ color: 'var(--ws-text)' }}>{masterRmsDb.toFixed(1)} dBFS</strong></span>
            <span>PEAK: <strong style={{ color: peak > 0.95 ? 'var(--ws-danger)' : 'var(--ws-text)' }}>{masterPeakDb.toFixed(1)} dBFS</strong></span>
            <span>HEADROOM: <strong style={{ color: 'var(--ws-text)' }}>{Math.max(0, 0 - masterPeakDb).toFixed(1)} dB</strong></span>
          </div>
        </section>

        {/* Next in Queue Console */}
        <section
          style={{
            border: '1px solid var(--ws-line)',
            borderRadius: '7px',
            background: 'var(--ws-panel)',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '8px',
          }}
          aria-label="Upcoming broadcast program queue"
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="ws-strip-source">NEXT IN QUEUE</span>
              <span className="ws-tag">{queueItems.length} QUEUED</span>
            </div>
            <span style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>
              Auto-Advance: <strong style={{ color: playbackSnap.autoAdvance ? 'var(--ws-live)' : 'var(--ws-muted)' }}>{playbackSnap.autoAdvance ? 'ACTIVE' : 'OFF'}</strong>
            </span>
          </div>

          {nextQueueTrack ? (
            <div style={{ background: 'var(--ws-panel-2)', padding: '8px 10px', borderRadius: '5px', border: '1px solid var(--ws-line)' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ws-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {nextQueueTrack.title}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--ws-muted)', marginTop: '2px', display: 'flex', justifyContent: 'space-between' }}>
                <span>{nextQueueTrack.artist || 'Unknown Artist'}</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{formatDuration(Math.round(nextQueueTrack.durationMs / 1000))}</span>
              </div>
            </div>
          ) : (
            <div style={{ padding: '8px 10px', borderRadius: '5px', background: 'var(--ws-panel-2)', border: '1px dashed var(--ws-line)', fontSize: '11px', color: 'var(--ws-muted)' }}>
              End of queue reached. Add tracks from the Playlist tab to line up next music.
            </div>
          )}

          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', borderTop: '1px solid var(--ws-line)', paddingTop: '6px' }}>
            {nextQueueTrack && (
              <>
                <button
                  type="button"
                  className="ws-mini-action"
                  onClick={async () => {
                    await playbackService.loadDeck('deck_a', nextQueueTrack.filePath);
                    showToast(`Preloaded "${nextQueueTrack.title}" into Deck A`);
                  }}
                  title="Load this upcoming track directly into Deck A"
                >
                  Load Deck A
                </button>
                <button
                  type="button"
                  className="ws-mini-action"
                  onClick={async () => {
                    await playbackService.loadDeck('deck_b', nextQueueTrack.filePath);
                    showToast(`Preloaded "${nextQueueTrack.title}" into Deck B`);
                  }}
                  title="Load this upcoming track directly into Deck B"
                >
                  Load Deck B
                </button>
              </>
            )}
            <button
              type="button"
              className="ws-mini-action"
              onClick={async () => {
                const res = await playbackService.triggerControlAction('next_track');
                if (res) showToast('Advanced queue to next track');
              }}
              disabled={!nextQueueTrack}
              title="Immediately advance and play next queued track"
            >
              Play Next Now →
            </button>
          </div>
        </section>
      </div>

      {/* Bottom Telemetry & Status Grids */}
      <div className="ws-bottom-grid">
        <section className="ws-transcript-preview" aria-label="Live transcript preview">
          <div className="ws-section-head">
            <h2>Live transcript</h2>
            <span>
              {transcriptStatus.config.isLocal ? 'Local' : 'Cloud'} / {transcriptStatus.config.language.toUpperCase()}
            </span>
          </div>
          <div className="ws-transcript-body">
            {recentSegments.length === 0 ? (
              <div className="ws-empty">
                <div>
                  <strong>{transcriptStatus.state === 'LISTENING' ? 'Waiting for speech' : 'Transcript is idle'}</strong>
                  {isLive
                    ? 'The live speech pipeline is ready for incoming audio.'
                    : 'Start the broadcast to begin the live session.'}
                </div>
              </div>
            ) : (
              recentSegments.map((segment: TranscriptSegment) => (
                <div className="ws-transcript-line" key={segment.id} data-current={!segment.finalized}>
                  <span className="ws-transcript-time">
                    {Math.floor(segment.startMs / 1000)}s
                  </span>
                  <span className="ws-transcript-text" data-interim={!segment.finalized}>
                    {segment.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="ws-stream-panel" aria-label="SHOUTcast stream telemetry">
          <div className="ws-section-head">
            <h2>SHOUTcast Broadcast State</h2>
            <span className="ws-badge" data-variant={isLive ? 'live' : 'neutral'}>{status.state}</span>
          </div>

          <div className="ws-stream-body">
            <div className="ws-stream-main">
              <div className="ws-stream-state">
                <strong>{status.state === 'CONNECTED' ? 'Stream active & transmitting' : 'Stream is offline / ready'}</strong>
                <span>Uptime: {formatUptime(status.uptimeSeconds)}</span>
              </div>

              <div className="ws-meter-pair">
                <div>
                  <div className="ws-meter-label">
                    <span>Audio Master</span>
                    <span>{Math.round(level * 100)}%</span>
                  </div>
                  <div className="ws-meter">
                    <div
                      className="ws-meter-fill"
                      data-danger={peak > 0.95}
                      style={{ transform: `scaleX(${Math.max(0.02, level)})` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="ws-meter-label">
                    <span>Upload Rate</span>
                    <span>{metrics.actualUploadKbps.toFixed(1)} kbps</span>
                  </div>
                  <div className="ws-meter">
                    <div
                      className="ws-meter-fill"
                      data-warning={metrics.actualUploadKbps > 0 && metrics.actualUploadKbps < status.config.bitrate * 0.9}
                      style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, metrics.actualUploadKbps / Math.max(1, status.config.bitrate)))})` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="ws-stream-grid">
              <div className="ws-stream-field">
                <span>Server Endpoint</span>
                <strong>{status.config.server}:{status.config.port}</strong>
              </div>
              <div className="ws-stream-field">
                <span>Stream ID</span>
                <strong>#{status.config.streamId}</strong>
              </div>
              <div className="ws-stream-field">
                <span>Reconnects</span>
                <strong>{status.reconnectCount}</strong>
              </div>
              <div className="ws-stream-field">
                <span>Dropped Frames</span>
                <strong>{metrics.droppedFrames}</strong>
              </div>
              <div className="ws-stream-field">
                <span>Buffer Health</span>
                <strong>{Math.round(metrics.bufferHealthRatio * 100)}%</strong>
              </div>
              <div className="ws-stream-field">
                <span>Total Data Sent</span>
                <strong>{formatBytes(metrics.bytesSent)}</strong>
              </div>
            </div>

            {/* Plugin-Provided Output Syndication Targets */}
            {pluginOutputs.length > 0 && (
              <div style={{ marginTop: '14px', borderTop: '1px solid var(--ws-line)', paddingTop: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className="ws-strip-source">PLUGIN OUTPUTS</span>
                    <span className="ws-tag">{pluginOutputs.length} TARGETS</span>
                  </div>
                  <span style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>
                    Extensible Stream Syndication
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {pluginOutputs.map((out) => {
                    const isRef = Boolean(out.status.isReferenceOnly || out.status.state === 'REFERENCE_ONLY');
                    const isTrulyLive = out.status.state === 'CONNECTED' && Boolean(out.status.transportRunning) && !isRef;

                    return (
                      <div
                        key={out.pluginId}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 10px',
                          background: 'var(--ws-panel-2)',
                          border: '1px solid var(--ws-line)',
                          borderRadius: '4px',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span
                              style={{
                                width: '7px',
                                height: '7px',
                                borderRadius: '50%',
                                background: isTrulyLive
                                  ? 'var(--ws-live)'
                                  : isRef
                                  ? 'var(--ws-accent)'
                                  : out.status.state === 'CONNECTING'
                                  ? 'var(--ws-warning)'
                                  : 'var(--ws-muted)',
                              }}
                            />
                            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ws-text)' }}>
                              {out.name}
                            </span>
                            {isRef && (
                              <span className="ws-tag" style={{ fontSize: '9px', color: 'var(--ws-accent)' }}>
                                ARCHITECTURAL REF
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--ws-muted)', fontFamily: 'var(--font-mono)' }}>
                            Plugin: <strong style={{ color: out.enabled ? 'var(--ws-text)' : 'var(--ws-muted)' }}>{out.enabled ? 'ENABLED' : 'DISABLED'}</strong>
                            {' • '}
                            Transport: <strong style={{ color: isTrulyLive ? 'var(--ws-live)' : 'var(--ws-warning)' }}>
                              {isTrulyLive ? 'RUNNING' : 'NOT RUNNING'}
                            </strong>
                            {' • '}
                            Status: <strong style={{ color: 'var(--ws-text)' }}>{isRef ? 'REFERENCE ONLY' : out.status.state}</strong>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            className="ws-badge"
                            data-variant={isTrulyLive ? 'live' : out.status.state === 'CONNECTING' ? 'warning' : 'neutral'}
                            style={{
                              fontSize: '9px',
                              borderColor: isRef ? 'var(--ws-accent)' : undefined,
                              color: isRef ? 'var(--ws-accent)' : undefined,
                            }}
                          >
                            {isRef ? 'REFERENCE ONLY' : out.status.state}
                          </span>
                          {isTrulyLive && (
                            <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--ws-muted)' }}>
                              {out.status.uptimeSeconds}s
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Plugin Contributed UI Panels for On Air */}
      <PluginUISlotRenderer
        slot="ON_AIR_PANEL"
        onNotify={showToast}
        style={{ marginTop: '14px' }}
      />
      <PluginUISlotRenderer
        slot="OUTPUT_PANEL"
        onNotify={showToast}
        style={{ marginTop: '14px' }}
      />

      {/* Broadcast Preflight Validation Modal */}
      {showPreflightModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: '460px',
              background: 'var(--ws-panel)',
              border: '1px solid var(--ws-danger)',
              borderRadius: '8px',
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="ws-badge" data-variant="danger">PRE-FLIGHT FAILED</span>
              <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>Broadcast Verification Check</h2>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--ws-muted)', margin: 0 }}>
              The native broadcast pre-flight check prevented connection because required parameters are invalid or missing:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
              {preflightErrors.map((err, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '8px 10px',
                    background: 'var(--ws-panel-2)',
                    borderLeft: '3px solid var(--ws-danger)',
                    borderRadius: '4px',
                  }}
                >
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ws-danger)' }}>
                    [{err.code}] {err.field.toUpperCase()}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--ws-text)', marginTop: '2px' }}>
                    {err.message}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button
                type="button"
                className="ws-primary-action"
                onClick={() => setShowPreflightModal(false)}
              >
                Dismiss & Review Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && <div className="ws-toast">{toastMessage}</div>}
    </section>
  );
};
