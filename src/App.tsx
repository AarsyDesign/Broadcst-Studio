import React, { useEffect, useState } from 'react';
import { TopStatusBar } from './components/TopStatusBar';
import { NavigationRail, WorkspaceTab } from './components/NavigationRail';
import { OnAirWorkspace } from './components/OnAirWorkspace';
import { MixerWorkspace } from './components/MixerWorkspace';
import { SourcesWorkspace } from './components/SourcesWorkspace';
import { RecordingsWorkspace } from './components/RecordingsWorkspace';
import { SettingsWorkspace } from './components/SettingsWorkspace';
import { TranscriptWorkspace } from './components/TranscriptWorkspace';
import { PluginsWorkspace } from './components/PluginsWorkspace';
import { AutomationWorkspace } from './components/AutomationWorkspace';
import { AIWorkspace } from './components/AIWorkspace';
import { ScheduleWorkspace } from './components/ScheduleWorkspace';
import { ipc } from './services/ipc';
import { logger } from './services/logger';
import { BroadcastStatus } from './types/broadcast';
import { StreamMetrics } from './types/telemetry';
import { TranscriptSegment, TranscriptStatus } from './types/transcript';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('on_air');
  const [isNative, setIsNative] = useState<boolean>(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('broadcast_theme');
    return saved === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('broadcast_theme', theme);
  }, [theme]);

  const handleToggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const [status, setStatus] = useState<BroadcastStatus>({
    state: 'OFFLINE',
    uptimeSeconds: 0,
    reconnectCount: 0,
    config: {
      server: 'radio.example.org',
      port: 8000,
      streamId: 1,
      bitrate: 128,
      codec: 'MP3',
      stationName: 'Broadcast Radio V1',
      isPublic: true,
    },
  });

  const [metrics, setMetrics] = useState<StreamMetrics>({
    targetBitrateKbps: 128,
    actualUploadKbps: 0,
    bufferHealthRatio: 0,
    droppedFrames: 0,
    bytesSent: 0,
    networkLatencyMs: 0,
  });

  const [transcriptStatus, setTranscriptStatus] = useState<TranscriptStatus>({
    state: 'IDLE',
    segmentsCount: 0,
    config: {
      provider: 'local_whisper',
      modelName: 'whisper-small-q5',
      language: 'id',
      isLocal: true,
      autoScroll: true,
    },
  });

  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [masterPeakDb, setMasterPeakDb] = useState<number>(-90);
  const [masterRmsDb, setMasterRmsDb] = useState<number>(-90);

  useEffect(() => {
    setIsNative(ipc.isNative());
    logger.info('App', 'App initialized, mounting IPC event listeners');

    // Fetch initial status
    ipc.invoke('broadcast.get_status').then((initStatus) => {
      if (initStatus) setStatus(initStatus);
    });

    ipc.invoke('transcript.get_segments').then((segs) => {
      if (segs) setTranscriptSegments(segs);
    });

    // Subscribe to IPC events
    const unsubStatus = ipc.on('broadcast.status.changed', (newStatus) => {
      setStatus(newStatus);
    });

    const unsubMetrics = ipc.on('stream.metrics.changed', (newMetrics) => {
      setMetrics(newMetrics);
    });

    const unsubAudio = ipc.on('audio.level.changed', (audioData) => {
      if (audioData.channelId === 'master') {
        setMasterPeakDb(audioData.peakDb);
        setMasterRmsDb(audioData.rmsDb);
      }
    });

    return () => {
      unsubStatus();
      unsubMetrics();
      unsubAudio();
    };
  }, []);

  const handleStartBroadcast = async () => {
    try {
      const res = await ipc.invoke('broadcast.start');
      setStatus(res);
      await ipc.invoke('transcript.start');
      setTranscriptStatus((prev) => ({ ...prev, state: 'LISTENING' }));
    } catch (err) {
      logger.error('Broadcast', 'Failed to start broadcast', { error: err });
    }
  };

  const handleStopBroadcast = async () => {
    try {
      const res = await ipc.invoke('broadcast.stop');
      setStatus(res);
      await ipc.invoke('transcript.stop');
      setTranscriptStatus((prev) => ({ ...prev, state: 'IDLE' }));
      setMasterPeakDb(-90);
      setMasterRmsDb(-90);
    } catch (err) {
      logger.error('Broadcast', 'Failed to stop broadcast', { error: err });
    }
  };

  const handleReconnect = async () => {
    try {
      const res = await ipc.invoke('broadcast.reconnect');
      setStatus(res);
    } catch (err) {
      logger.error('Broadcast', 'Reconnect failed', { error: err });
    }
  };

  return (
    <div
      data-theme={theme}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: 'var(--color-bg)',
      }}
    >
      <TopStatusBar
        status={status}
        isNative={isNative}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <NavigationRail activeTab={activeTab} onSelectTab={setActiveTab} />

        <main style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {activeTab === 'on_air' && (
            <OnAirWorkspace
              status={status}
              metrics={metrics}
              transcriptStatus={transcriptStatus}
              transcriptSegments={transcriptSegments}
              masterPeakDb={masterPeakDb}
              masterRmsDb={masterRmsDb}
              onStartBroadcast={handleStartBroadcast}
              onStopBroadcast={handleStopBroadcast}
              onReconnect={handleReconnect}
            />
          )}

          {activeTab === 'mixer' && <MixerWorkspace />}

          {activeTab === 'sources' && <SourcesWorkspace />}

          {activeTab === 'transcript' && <TranscriptWorkspace />}

          {activeTab === 'schedule' && <ScheduleWorkspace />}

          {activeTab === 'recordings' && <RecordingsWorkspace />}

          {activeTab === 'plugins' && <PluginsWorkspace />}

          {activeTab === 'automation' && <AutomationWorkspace />}

          {activeTab === 'ai' && <AIWorkspace />}

          {activeTab === 'settings' && (
            <SettingsWorkspace theme={theme} onSetTheme={setTheme} />
          )}

          {activeTab !== 'on_air' &&
            activeTab !== 'mixer' &&
            activeTab !== 'sources' &&
            activeTab !== 'schedule' &&
            activeTab !== 'transcript' &&
            activeTab !== 'recordings' &&
            activeTab !== 'plugins' &&
            activeTab !== 'automation' &&
            activeTab !== 'ai' &&
            activeTab !== 'settings' && (
              <div
                style={{
                  flex: 1,
                  padding: 'var(--space-6)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-4)',
                  backgroundColor: 'var(--color-bg)',
                }}
              >
                <h2 style={{ fontSize: 'var(--text-h2)', textTransform: 'uppercase' }}>
                  {activeTab.replace('_', ' ')}
                </h2>
                <div
                  style={{
                    padding: 'var(--space-4)',
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-text-secondary)',
                    fontSize: 'var(--text-small)',
                  }}
                >
                  Workspace scheduled for subsequent phases. Core audio and broadcast pipelines are actively operational.
                </div>
              </div>
            )}
        </main>
      </div>
    </div>
  );
};

export default App;
