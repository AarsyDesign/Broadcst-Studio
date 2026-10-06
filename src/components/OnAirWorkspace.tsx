import React, { useMemo, useState, useEffect } from 'react';
import { shoutcastService } from '../services/shoutcastService';
import { playbackService } from '../services/playbackService';
import { BroadcastStatus } from '../types/broadcast';
import { StreamMetrics } from '../types/telemetry';
import { TranscriptSegment, TranscriptStatus } from '../types/transcript';
import { FullPlaybackSnapshot } from '../types/ipc';

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

  useEffect(() => {
    const unsub = playbackService.onSnapshot((snap) => {
      setPlaybackSnap(snap);
    });
    return unsub;
  }, []);

  const waveformPattern = [
    0.25, 0.42, 0.68, 0.86, 0.55, 0.38, 0.22, 0.48, 0.72, 0.92, 0.63, 0.34,
    0.19, 0.46, 0.79, 0.58, 0.31, 0.23, 0.53, 0.76, 0.9, 0.64, 0.36, 0.2,
    0.32, 0.57, 0.82, 0.71, 0.44, 0.26, 0.41, 0.67, 0.88, 0.58, 0.33, 0.18,
  ];

  const nowPlayingTitle =
    playbackSnap.currentTrack?.title || shoutcastService.getCurrentMetadata().title;
  const nowPlayingArtist =
    playbackSnap.currentTrack?.artist || shoutcastService.getCurrentMetadata().artist;

  const deckA = playbackSnap.deckA;
  const deckB = playbackSnap.deckB;
  const isDeckAPlaying = deckA.state === 'playing';
  const isDeckBPlaying = deckB.state === 'playing';

  const deckAPos = Math.round(deckA.positionMs / 1000);
  const deckADur = Math.max(1, Math.round(deckA.durationMs / 1000));
  const deckAPercent = deckA.track ? Math.min(100, (deckAPos / deckADur) * 100) : 0;

  const deckBPos = Math.round(deckB.positionMs / 1000);
  const deckBDur = Math.max(1, Math.round(deckB.durationMs / 1000));
  const deckBPercent = deckB.track ? Math.min(100, (deckBPos / deckBDur) * 100) : 0;

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

  return (
    <section className="ws-workspace ws-workspace--air">
      <div className="ws-command-row">
        <div>
          <div className="ws-kicker">On Air / Master</div>
          <h1 className="ws-title">{status.config.stationName}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
            <span className="ws-badge" data-variant={isLive ? 'live' : 'neutral'}>
              {isLive ? '● ON AIR' : 'OFFLINE'}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--ws-muted)' }}>
              Now Playing: <strong style={{ color: 'var(--ws-text)' }}>{nowPlayingTitle}</strong> — {nowPlayingArtist}
            </span>
          </div>
        </div>

        <div className="ws-transport">
          {status.state === 'ERROR' && (
            <button type="button" className="ws-secondary-action" onClick={onReconnect}>
              Reconnect
            </button>
          )}
          <button
            type="button"
            className="ws-primary-action"
            data-live={isLive}
            onClick={isLive ? onStopBroadcast : onStartBroadcast}
          >
            {isLive ? 'Stop Broadcast' : 'Start Broadcast'}
          </button>
        </div>
      </div>

      {/* Dual Deck Broadcast Console */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 140px minmax(0, 1fr)',
          gap: '12px',
          padding: '12px 14px',
          background: 'var(--ws-panel)',
          border: '1px solid var(--ws-line)',
          borderRadius: '7px',
          alignItems: 'center',
        }}
      >
        {/* Deck A Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="ws-badge" data-variant={isDeckAPlaying ? 'live' : 'neutral'}>
                DECK A • {deckA.state.toUpperCase()}
              </span>
              {playbackSnap.activeDeck === 'deck_a' && <span className="ws-tag">FOCUSED</span>}
            </div>
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
          </div>

          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ws-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {deckA.track ? deckA.track.title : 'No track loaded'}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>
            {deckA.track ? `${deckA.track.artist}` : 'Cue from playlist'}
          </div>

          <div
            className="ws-deck-progress-bar"
            style={{ height: '4px', background: 'var(--ws-panel-3)', borderRadius: '2px', overflow: 'hidden' }}
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

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--ws-subtle)' }}>
            <span>{formatDuration(deckAPos)}</span>
            <span>{formatDuration(deckADur)}</span>
          </div>
        </div>

        {/* Center Crossfader */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
          <div style={{ fontSize: '9.5px', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--ws-muted)' }}>
            CROSSFADER
          </div>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.02"
            value={playbackSnap.crossfader}
            onChange={handleCrossfaderChange}
            style={{ width: '100%', accentColor: 'var(--ws-live)' }}
            title="Deck A ← Crossfade → Deck B"
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '8px', color: 'var(--ws-subtle)', fontFamily: 'var(--font-mono)' }}>
            <span>DECK A</span>
            <span>DECK B</span>
          </div>
        </div>

        {/* Deck B Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="ws-badge" data-variant={isDeckBPlaying ? 'live' : 'neutral'}>
                DECK B • {deckB.state.toUpperCase()}
              </span>
              {playbackSnap.activeDeck === 'deck_b' && <span className="ws-tag">FOCUSED</span>}
            </div>
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
          </div>

          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ws-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {deckB.track ? deckB.track.title : 'No track loaded'}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>
            {deckB.track ? `${deckB.track.artist}` : 'Cue from playlist'}
          </div>

          <div
            className="ws-deck-progress-bar"
            style={{ height: '4px', background: 'var(--ws-panel-3)', borderRadius: '2px', overflow: 'hidden' }}
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

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--ws-subtle)' }}>
            <span>{formatDuration(deckBPos)}</span>
            <span>{formatDuration(deckBDur)}</span>
          </div>
        </div>
      </div>

      <section className="ws-signal-board" aria-label="Master signal visualization">
        <div className="ws-signal-header">
          <div className="ws-signal-title">
            <span>Master signal</span>
            <span className="ws-kicker">
              {isLive ? 'broadcasting' : (hasAudio ? 'monitoring signal' : 'idle')}
            </span>
          </div>
          <div className="ws-signal-caption">
            {status.config.bitrate} kbps / {status.config.codec}
          </div>
        </div>

        <div className="ws-signal-stage">
          <div className="ws-signal-scale" aria-hidden="true">
            <span>-60</span>
            <span>-36</span>
            <span>-18</span>
            <span>-12</span>
            <span>-6</span>
            <span>-3</span>
            <span>0 dBFS</span>
          </div>

          <div className="ws-wave" data-live={isLive} aria-label={`Master RMS ${masterRmsDb.toFixed(1)} dBFS`}>
            {waveformPattern.map((shape, index) => {
              const barHeight = hasAudio ? Math.max(3, level * shape * 100) : 2;
              return (
                <span
                  key={index}
                  className="ws-wave-bar"
                  style={{
                    height: `${barHeight}%`,
                    opacity: hasAudio ? (isLive ? 0.9 : 0.55) : 0.22,
                  }}
                />
              );
            })}
          </div>

          <div className="ws-playhead" data-live={isLive || hasAudio} aria-hidden="true" />

          <div className="ws-signal-footer">
            <span>RMS <strong>{masterRmsDb.toFixed(1)} dBFS</strong></span>
            <span>PEAK <strong>{masterPeakDb.toFixed(1)} dBFS</strong></span>
            <span>Headroom <strong>{Math.max(0, 0 - masterPeakDb).toFixed(1)} dB</strong></span>
          </div>
        </div>
      </section>

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
            <h2>SHOUTcast</h2>
            <span>{status.state}</span>
          </div>

          <div className="ws-stream-body">
            <div className="ws-stream-main">
              <div className="ws-stream-state">
                <strong>{status.state === 'CONNECTED' ? 'Signal is live' : 'Stream is idle'}</strong>
                <span>{formatUptime(status.uptimeSeconds)}</span>
              </div>

              <div className="ws-meter-pair">
                <div>
                  <div className="ws-meter-label">
                    <span>Audio</span>
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
                    <span>Upload</span>
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
                <span>Server</span>
                <strong>{status.config.server}:{status.config.port}</strong>
              </div>
              <div className="ws-stream-field">
                <span>Stream</span>
                <strong>#{status.config.streamId}</strong>
              </div>
              <div className="ws-stream-field">
                <span>Latency</span>
                <strong>{metrics.networkLatencyMs > 0 ? `${metrics.networkLatencyMs} ms` : '—'}</strong>
              </div>
              <div className="ws-stream-field">
                <span>Dropped</span>
                <strong>{metrics.droppedFrames}</strong>
              </div>
              <div className="ws-stream-field">
                <span>Buffer</span>
                <strong>{Math.round(metrics.bufferHealthRatio * 100)}%</strong>
              </div>
              <div className="ws-stream-field">
                <span>Sent</span>
                <strong>{formatBytes(metrics.bytesSent)}</strong>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
};
