import React, { useMemo } from 'react';
import { shoutcastService } from '../services/shoutcastService';
import { BroadcastStatus } from '../types/broadcast';
import { StreamMetrics } from '../types/telemetry';
import { TranscriptSegment, TranscriptStatus } from '../types/transcript';

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

  const waveformPattern = [
    0.25, 0.42, 0.68, 0.86, 0.55, 0.38, 0.22, 0.48, 0.72, 0.92, 0.63, 0.34,
    0.19, 0.46, 0.79, 0.58, 0.31, 0.23, 0.53, 0.76, 0.9, 0.64, 0.36, 0.2,
    0.32, 0.57, 0.82, 0.71, 0.44, 0.26, 0.41, 0.67, 0.88, 0.58, 0.33, 0.18,
  ];

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
              Now Playing: <strong style={{ color: 'var(--ws-text)' }}>{shoutcastService.getCurrentMetadata().title}</strong> — {shoutcastService.getCurrentMetadata().artist}
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
