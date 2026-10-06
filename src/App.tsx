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
import { PlaylistWorkspace } from './components/PlaylistWorkspace';
import { ipc } from './services/ipc';
import { logger } from './services/logger';
import { playbackService } from './services/playbackService';
import { recorderService } from './services/recorderService';
import { BroadcastStatus } from './types/broadcast';
import { StreamMetrics } from './types/telemetry';
import { TranscriptSegment, TranscriptStatus } from './types/transcript';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('on_air');
  const [isNative, setIsNative] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('broadcast_theme');
    return saved === 'light' ? 'light' : 'dark';
  });

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
  const [masterPeakDb, setMasterPeakDb] = useState(-90);
  const [masterRmsDb, setMasterRmsDb] = useState(-90);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('broadcast_theme', theme);
  }, [theme]);

  useEffect(() => {
    setIsNative(ipc.isNative());
    logger.info('App', 'Broadcast workstation mounted');

    ipc.invoke('broadcast.get_status').then((value) => {
      if (value) setStatus(value);
    });

    ipc.invoke('transcript.get_segments').then((value) => {
      if (value) setTranscriptSegments(value);
    });

    const unsubStatus = ipc.on('broadcast.status.changed', setStatus);
    const unsubMetrics = ipc.on('stream.metrics.changed', setMetrics);
    const unsubAudio = ipc.on('audio.level.changed', (data) => {
      if (data.channelId === 'master') {
        setMasterPeakDb(data.peakDb);
        setMasterRmsDb(data.rmsDb);
      }
    });
    const unsubTranscript = ipc.on('transcript.segment.created', (segment) => {
      setTranscriptSegments((prev) => {
        const next = prev.filter((item) => item.id !== segment.id);
        return [...next, segment];
      });
    });

    return () => {
      unsubStatus();
      unsubMetrics();
      unsubAudio();
      unsubTranscript();
    };
  }, []);

  const handleStartBroadcast = async () => {
    try {
      const next = await ipc.invoke('broadcast.start');
      setStatus(next);
      const transcript = await ipc.invoke('transcript.start');
      setTranscriptStatus(transcript);
    } catch (err) {
      logger.error('Broadcast', 'Failed to start broadcast', { error: err });
    }
  };

  const handleStopBroadcast = async () => {
    try {
      const next = await ipc.invoke('broadcast.stop');
      setStatus(next);
      const transcript = await ipc.invoke('transcript.stop');
      setTranscriptStatus(transcript);
      setMasterPeakDb(-90);
      setMasterRmsDb(-90);
    } catch (err) {
      logger.error('Broadcast', 'Failed to stop broadcast', { error: err });
    }
  };

  const handleReconnect = async () => {
    try {
      const next = await ipc.invoke('broadcast.reconnect');
      setStatus(next);
    } catch (err) {
      logger.error('Broadcast', 'Reconnect failed', { error: err });
    }
  };

  // ==========================================
  // OPERATOR HOTKEY CONTROLS
  // ==========================================
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Guard against typing in form inputs
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      // Space -> Toggle Play/Pause active deck
      if (e.code === 'Space') {
        e.preventDefault();
        playbackService.triggerControlAction('toggle_play_pause');
      }
      // M -> Toggle mic mute
      else if (e.key === 'm' || e.key === 'M') {
        playbackService.triggerControlAction('toggle_mic_mute');
      }
      // R -> Toggle recording
      else if (e.key === 'r' || e.key === 'R') {
        if (recorderService.getState() === 'RECORDING') {
          recorderService.stopRecording();
        } else {
          recorderService.startRecording();
        }
      }
      // B -> Toggle broadcast
      else if (e.key === 'b' || e.key === 'B') {
        if (status.state === 'CONNECTED') {
          handleStopBroadcast();
        } else {
          handleStartBroadcast();
        }
      }
      // N -> Next track
      else if (e.key === 'n' || e.key === 'N') {
        playbackService.triggerControlAction('next_track');
      }
      // 1 -> Deck A
      else if (e.key === '1') {
        playbackService.triggerControlAction('select_deck', { deckId: 'deck_a' });
      }
      // 2 -> Deck B
      else if (e.key === '2') {
        playbackService.triggerControlAction('select_deck', { deckId: 'deck_b' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [status.state]);

  const activeWorkspace = (() => {
    switch (activeTab) {
      case 'on_air':
        return (
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
        );
      case 'mixer':
        return <MixerWorkspace />;
      case 'sources':
        return <SourcesWorkspace />;
      case 'transcript':
        return <TranscriptWorkspace />;
      case 'schedule':
        return <ScheduleWorkspace />;
      case 'recordings':
        return <RecordingsWorkspace />;
      case 'plugins':
        return <PluginsWorkspace />;
      case 'automation':
        return <AutomationWorkspace />;
      case 'ai':
        return <AIWorkspace />;
      case 'settings':
        return <SettingsWorkspace theme={theme} onSetTheme={setTheme} />;
      case 'playlist':
        return <PlaylistWorkspace />;
    }
  })();

  return (
    <div className="ws-shell" data-theme={theme} style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopStatusBar
        status={status}
        isNative={isNative}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
      />
      <div className="ws-app-grid">
        <NavigationRail activeTab={activeTab} onSelectTab={setActiveTab} />
        <main className="ws-main">{activeWorkspace}</main>
      </div>
    </div>
  );
};

export default App;
