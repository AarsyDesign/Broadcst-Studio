import React, { useState, useEffect, useRef } from 'react';
import { recorderService, RecordedSession, RecorderState } from '../services/recorderService';

export const RecordingsWorkspace: React.FC = () => {
  const [recorderState, setRecorderState] = useState<RecorderState>(recorderService.getState());
  const [duration, setDuration] = useState<number>(recorderService.getCurrentDuration());
  const [sessions, setSessions] = useState<RecordedSession[]>(recorderService.getSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const unsubState = recorderService.onStateChange((state, dur) => {
      setRecorderState(state);
      setDuration(dur);
    });

    const unsubSessions = recorderService.onSessionsChange((sess) => {
      setSessions(sess);
    });

    return () => {
      unsubState();
      unsubSessions();
    };
  }, []);

  const handleToggleRecord = async () => {
    if (recorderState === 'RECORDING') {
      await recorderService.stopRecording();
    } else {
      await recorderService.startRecording();
    }
  };

  const handlePlaySession = (session: RecordedSession) => {
    if (activeSessionId === session.id && isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
      return;
    }

    setActiveSessionId(session.id);
    if (audioRef.current) {
      audioRef.current.src = session.blobUrl;
      audioRef.current.play().then(() => setIsPlaying(true));
    }
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--space-5)',
        gap: 'var(--space-4)',
        backgroundColor: 'var(--color-bg)',
        overflowY: 'auto',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--color-surface)',
          padding: 'var(--space-3) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div>
          <h1 style={{ fontSize: 'var(--text-h2)', fontWeight: 700, margin: 0 }}>
            Broadcast Session Recordings
          </h1>
          <p style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
            Capture master output to disk with timestamped audio segments.
          </p>
        </div>

        {/* Record Action */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {recorderState === 'RECORDING' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--color-error)',
                  boxShadow: '0 0 8px var(--color-error)',
                }}
              />
              <span className="font-mono" style={{ color: 'var(--color-text-primary)', fontWeight: 700 }}>
                {formatDuration(duration)}
              </span>
            </div>
          )}

          <button
            onClick={handleToggleRecord}
            style={{
              padding: 'var(--space-2) var(--space-5)',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 700,
              fontSize: 'var(--text-small)',
              backgroundColor: recorderState === 'RECORDING' ? 'var(--color-error)' : 'var(--color-surface-elevated)',
              color: recorderState === 'RECORDING' ? '#FFFFFF' : 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
            }}
          >
            {recorderState === 'RECORDING' ? 'STOP RECORDING' : 'START RECORD'}
          </button>
        </div>
      </header>

      {/* Hidden Audio Element for Playback */}
      <audio
        ref={audioRef}
        onEnded={() => setIsPlaying(false)}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
      />

      {/* Sessions List */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 600, margin: 0 }}>
          Recorded Archives ({sessions.length})
        </h2>

        {sessions.length === 0 ? (
          <div
            style={{
              padding: 'var(--space-8)',
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              textAlign: 'center',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-small)',
            }}
          >
            No recorded broadcast archives found. Click "START RECORD" to begin capturing live output.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {sessions.map((session) => {
              const isCurrent = activeSessionId === session.id;

              return (
                <div
                  key={session.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 'var(--space-3) var(--space-4)',
                    backgroundColor: isCurrent ? 'var(--color-surface-elevated)' : 'var(--color-surface)',
                    border: `1px solid ${isCurrent ? 'var(--color-live)' : 'var(--color-border)'}`,
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: 'var(--text-small)' }}>
                      {session.title}
                    </span>
                    <span style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)' }}>
                      Captured on {new Date(session.startedAt).toLocaleString('id-ID')}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
                    <span className="font-mono" style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)' }}>
                      {formatDuration(session.durationSeconds)}
                    </span>

                    <span className="font-mono" style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)' }}>
                      {formatFileSize(session.fileSizeBytes)}
                    </span>

                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <button
                        onClick={() => handlePlaySession(session)}
                        style={{
                          padding: 'var(--space-1) var(--space-3)',
                          backgroundColor: 'var(--color-surface-elevated)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: 'var(--text-micro)',
                          fontWeight: 600,
                          color: isCurrent && isPlaying ? 'var(--color-live)' : 'var(--color-text-primary)',
                        }}
                      >
                        {isCurrent && isPlaying ? 'PAUSE' : 'PLAY'}
                      </button>

                      <a
                        href={session.blobUrl}
                        download={`${session.title.replace(/\s+/g, '_')}.webm`}
                        style={{
                          textDecoration: 'none',
                          padding: 'var(--space-1) var(--space-3)',
                          backgroundColor: 'var(--color-surface-elevated)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: 'var(--text-micro)',
                          fontWeight: 600,
                          color: 'var(--color-info)',
                          display: 'inline-flex',
                          alignItems: 'center',
                        }}
                      >
                        DOWNLOAD
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
