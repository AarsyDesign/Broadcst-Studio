import React from 'react';
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

  // Convert dBFS (-60dB to 0dB) to percentage (0% to 100%)
  const dbToPercent = (db: number) => {
    if (db <= -60) return 0;
    if (db >= 0) return 100;
    return Math.round(((db + 60) / 60) * 100);
  };

  const peakPercent = dbToPercent(masterPeakDb);
  const rmsPercent = dbToPercent(masterRmsDb);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        padding: 'var(--space-5)',
        overflowY: 'auto',
        backgroundColor: 'var(--color-bg)',
      }}
    >
      {/* Top Banner: Action Controls & Primary Status */}
      <section
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'var(--color-surface)',
          padding: 'var(--space-4) var(--space-5)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div>
          <h1 style={{ fontSize: 'var(--text-h2)', fontWeight: 700, margin: 0 }}>
            Master Broadcast Console
          </h1>
          <p style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
            Direct engine routing to SHOUTcast v1/v2 server with live transcript buffer.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {status.state === 'ERROR' && (
            <button
              onClick={onReconnect}
              style={{
                padding: 'var(--space-2) var(--space-4)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-warning)',
                color: 'var(--color-warning)',
                fontWeight: 600,
                fontSize: 'var(--text-small)',
              }}
            >
              Reconnect
            </button>
          )}

          {isLive ? (
            <button
              onClick={onStopBroadcast}
              style={{
                padding: 'var(--space-3) var(--space-6)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--color-error)',
                color: '#FFFFFF',
                fontWeight: 700,
                letterSpacing: '0.04em',
                boxShadow: '0 0 12px var(--color-error-glow)',
              }}
            >
              STOP BROADCAST
            </button>
          ) : (
            <button
              onClick={onStartBroadcast}
              style={{
                padding: 'var(--space-3) var(--space-6)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--color-live)',
                color: 'var(--color-live-text)',
                fontWeight: 700,
                letterSpacing: '0.04em',
                boxShadow: '0 0 12px var(--color-live-glow)',
              }}
            >
              START BROADCAST
            </button>
          )}
        </div>
      </section>

      {/* Middle Grid: Master Audio Meter & Output Server Telemetry */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        {/* Card 1: Master Audio Levels */}
        <section
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 600, margin: 0 }}>
              Master Output Audio Meter
            </h2>
            <span className="font-mono" style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)' }}>
              Peak: {masterPeakDb.toFixed(1)} dBFS
            </span>
          </div>

          {/* Level Bars */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)', marginBottom: '2px' }}>
                <span>PEAK</span>
                <span className="font-mono">{peakPercent}%</span>
              </div>
              <div style={{ height: '10px', backgroundColor: 'var(--color-surface-elevated)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${peakPercent}%`,
                    backgroundColor: peakPercent > 90 ? 'var(--color-error)' : 'var(--color-live)',
                    transition: 'width 100ms ease-out',
                  }}
                />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)', marginBottom: '2px' }}>
                <span>RMS</span>
                <span className="font-mono">{rmsPercent}%</span>
              </div>
              <div style={{ height: '10px', backgroundColor: 'var(--color-surface-elevated)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${rmsPercent}%`,
                    backgroundColor: 'var(--color-info)',
                    transition: 'width 100ms ease-out',
                  }}
                />
              </div>
            </div>
          </div>

          <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)' }}>
            Target headroom: -3.0 dBFS. Audio path is unblocked and processed on high-priority thread.
          </div>
        </section>

        {/* Card 2: SHOUTcast Server & Telemetry */}
        <section
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 600, margin: 0 }}>
              SHOUTcast Output Pipeline
            </h2>
            <span
              style={{
                fontSize: 'var(--text-micro)',
                fontWeight: 600,
                color: isLive ? 'var(--color-live)' : 'var(--color-text-muted)',
              }}
            >
              {status.state}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-2)', fontSize: 'var(--text-small)' }}>
            <div>
              <span style={{ color: 'var(--color-text-muted)' }}>Server: </span>
              <span className="font-mono">{status.config.server}:{status.config.port}</span>
            </div>
            <div>
              <span style={{ color: 'var(--color-text-muted)' }}>Stream ID: </span>
              <span className="font-mono">#{status.config.streamId}</span>
            </div>
            <div>
              <span style={{ color: 'var(--color-text-muted)' }}>Upload Rate: </span>
              <span className="font-mono" style={{ color: 'var(--color-text-primary)' }}>
                {metrics.actualUploadKbps.toFixed(1)} kbps
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--color-text-muted)' }}>Buffer Ratio: </span>
              <span className="font-mono">
                {(metrics.bufferHealthRatio * 100).toFixed(0)}%
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--color-text-muted)' }}>Network Latency: </span>
              <span className="font-mono">{metrics.networkLatencyMs} ms</span>
            </div>
            <div>
              <span style={{ color: 'var(--color-text-muted)' }}>Dropped Packets: </span>
              <span className="font-mono">{metrics.droppedFrames}</span>
            </div>
          </div>
        </section>
      </div>

      {/* Bottom Section: Live Transcription Preview */}
      <section
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
          flex: 1,
          minHeight: '200px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 600, margin: 0 }}>
              Live Speech Transcription
            </h2>
            <span
              style={{
                fontSize: 'var(--text-micro)',
                padding: '1px 6px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: transcriptStatus.config.isLocal ? 'rgba(217, 255, 85, 0.1)' : 'rgba(103, 183, 255, 0.1)',
                color: transcriptStatus.config.isLocal ? 'var(--color-live)' : 'var(--color-info)',
                fontWeight: 600,
              }}
            >
              {transcriptStatus.config.isLocal ? 'Local Whisper (Private)' : 'Cloud Adapter'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)' }}>
              Language: {transcriptStatus.config.language.toUpperCase()}
            </span>
            <button
              onClick={() => {}}
              style={{
                fontSize: 'var(--text-micro)',
                padding: '2px 8px',
                backgroundColor: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              Jump to Live
            </button>
          </div>
        </div>

        {/* Segments Display */}
        <div
          style={{
            flex: 1,
            backgroundColor: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-3)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          {transcriptSegments.length === 0 ? (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-small)', fontStyle: 'italic', padding: 'var(--space-2)' }}>
              {isLive ? 'Listening for speech input...' : 'Audio stream is idle. Start broadcast or toggle microphone to begin transcribing.'}
            </div>
          ) : (
            transcriptSegments.map((seg) => (
              <div key={seg.id} style={{ display: 'flex', gap: 'var(--space-3)', fontSize: 'var(--text-small)' }}>
                <span className="font-mono" style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-micro)', flexShrink: 0, marginTop: '2px' }}>
                  {Math.floor(seg.startMs / 1000)}s
                </span>
                <span style={{ color: seg.finalized ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}>
                  {seg.text}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
};
