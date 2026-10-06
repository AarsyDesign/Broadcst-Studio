import React, { useState, useEffect, useRef } from 'react';
import { recorderService, RecordedSession, RecorderState } from '../services/recorderService';
import { transcriptStore } from '../services/transcription/transcriptStore';

export const RecordingsWorkspace: React.FC = () => {
  const [recorderState, setRecorderState] = useState<RecorderState>(recorderService.getState());
  const [duration, setDuration] = useState<number>(recorderService.getCurrentDuration());
  const [sessions, setSessions] = useState<RecordedSession[]>(recorderService.getSessions());
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const unsubState = recorderService.onStateChange((state, dur) => {
      setRecorderState(state);
      setDuration(dur);
    });

    const unsubSessions = recorderService.onSessionsChange((sess) => {
      setSessions(sess);
      if (!selectedSessionId && sess.length > 0) {
        setSelectedSessionId(sess[0].id);
      }
    });

    // Auto-select first session if available
    const existing = recorderService.getSessions();
    if (existing.length > 0 && !selectedSessionId) {
      setSelectedSessionId(existing[0].id);
    }

    return () => {
      unsubState();
      unsubSessions();
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleToggleRecord = async () => {
    if (recorderState === 'RECORDING') {
      const session = await recorderService.stopRecording();
      if (session) {
        setSelectedSessionId(session.id);
        showToast(`Saved session recording: ${session.title}`);
      }
    } else {
      const started = await recorderService.startRecording();
      if (started) {
        showToast('Master audio recording started');
      } else {
        showToast('Unable to start recording. Verify audio engine destination.');
      }
    }
  };

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) || sessions[0] || null;

  const handleSelectSession = (session: RecordedSession) => {
    setSelectedSessionId(session.id);
    setIsPlaying(false);
    setCurrentTimeSec(0);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.src = session.blobUrl;
    }
  };

  const handleTogglePlay = () => {
    if (!audioRef.current || !selectedSession) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => {
          showToast(`Playback error: ${err.message}`);
        });
    }
  };

  const handleSeek = (timeSec: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = timeSec;
    setCurrentTimeSec(timeSec);
  };

  const handleSeekToSegment = (startMs: number) => {
    const timeSec = startMs / 1000;
    handleSeek(timeSec);
    if (audioRef.current && !isPlaying) {
      audioRef.current.play().then(() => setIsPlaying(true));
    }
  };

  const handleExportAudio = () => {
    if (!selectedSession) return;
    const a = document.createElement('a');
    a.href = selectedSession.blobUrl;
    a.download = `${selectedSession.title.replace(/\s+/g, '_')}_${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`Downloading master audio file`);
  };

  const handleExportTranscript = (format: 'txt' | 'srt' | 'json') => {
    if (!selectedSession) return;
    const segments = transcriptStore.getSegments();
    if (segments.length === 0) {
      showToast('No transcript segments recorded for this session');
      return;
    }

    if (format === 'txt') {
      const text = transcriptStore.exportAsText(true);
      transcriptStore.downloadFile(text, `${selectedSession.title}_transcript.txt`, 'text/plain');
    } else if (format === 'srt') {
      const srt = transcriptStore.exportAsSrt();
      transcriptStore.downloadFile(srt, `${selectedSession.title}_transcript.srt`, 'application/x-subrip');
    } else {
      const json = transcriptStore.exportAsJson();
      transcriptStore.downloadFile(json, `${selectedSession.title}_transcript.json`, 'application/json');
    }
    showToast(`Exported transcript (${format.toUpperCase()})`);
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Associated transcript segments for the session timeline
  const allTranscriptSegments = transcriptStore.getSegments();

  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(searchFilter.trim().toLowerCase())
  );

  return (
    <section className="ws-workspace" style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', gap: '14px', height: '100%' }}>
      {/* Hidden native audio element */}
      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTimeSec(audioRef.current.currentTime);
          }
        }}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTimeSec(0);
        }}
      />

      {/* Command & Control Bar */}
      <div className="ws-command-row">
        <div>
          <div className="ws-kicker">Production / Archive</div>
          <h1 className="ws-title">Broadcast Recordings & Transcripts</h1>
          <p className="ws-subtitle">
            Master output capture archive with timeline synchronization between recorded audio and live speech transcripts.
          </p>
        </div>

        <div className="ws-transport">
          {recorderState === 'RECORDING' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '6px' }}>
              <span className="ws-badge" data-variant="live">
                ● REC {formatDuration(duration)}
              </span>
            </div>
          )}

          <button
            type="button"
            className={recorderState === 'RECORDING' ? 'ws-secondary-action' : 'ws-primary-action'}
            onClick={handleToggleRecord}
            style={{
              borderColor: recorderState === 'RECORDING' ? 'var(--ws-danger)' : undefined,
              color: recorderState === 'RECORDING' ? 'var(--ws-danger)' : undefined,
            }}
          >
            {recorderState === 'RECORDING' ? 'Stop Recording' : '● Capture Master Output'}
          </button>
        </div>
      </div>

      {/* Main Archive Workstation Split */}
      <div className="ws-recordings-layout">
        {/* Left Column: Archive Browser */}
        <div
          style={{
            border: '1px solid var(--ws-line)',
            borderRadius: '7px',
            background: 'var(--ws-panel)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div className="ws-section-head">
            <h2>Session Archives ({sessions.length})</h2>
            <span>Newest First</span>
          </div>

          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--ws-line)' }}>
            <input
              type="text"
              className="ws-input"
              style={{ width: '100%', height: '28px' }}
              placeholder="Search archive titles..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
          </div>

          <div style={{ padding: '8px 10px', overflowY: 'auto', flex: 1 }}>
            {filteredSessions.length === 0 ? (
              <div className="ws-empty" style={{ minHeight: '140px' }}>
                <div>
                  <strong>No Session Recordings</strong>
                  <p>Click "Capture Master Output" to record live broadcast sessions to disk.</p>
                </div>
              </div>
            ) : (
              filteredSessions.map((session) => {
                const isSelected = selectedSession?.id === session.id;
                return (
                  <div
                    key={session.id}
                    className="ws-session-row"
                    data-active={isSelected}
                    onClick={() => handleSelectSession(session)}
                  >
                    <div>
                      <div style={{ fontWeight: 650, fontSize: '12px', color: isSelected ? 'var(--ws-live)' : 'var(--ws-text)' }}>
                        {session.title}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--ws-muted)', marginTop: '2px' }}>
                        {new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {formatDuration(session.durationSeconds)} • {formatFileSize(session.fileSizeBytes)}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <span className="ws-tag">SYNCED</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Player & Synced Transcript Timeline */}
        <div
          style={{
            border: '1px solid var(--ws-line)',
            borderRadius: '7px',
            background: 'var(--ws-panel)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {selectedSession ? (
            <>
              {/* Header & Meta */}
              <div
                style={{
                  padding: '14px 16px',
                  borderBottom: '1px solid var(--ws-line)',
                  background: 'var(--ws-panel-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="ws-badge" data-variant="live">MASTER TAPE</span>
                    <span className="ws-tag">{selectedSession.mimeType || 'audio/webm'}</span>
                  </div>
                  <h3 style={{ margin: '6px 0 2px 0', fontSize: '16px', fontWeight: 760 }}>
                    {selectedSession.title}
                  </h3>
                  <div style={{ fontSize: '11px', color: 'var(--ws-muted)' }}>
                    Recorded on {new Date(selectedSession.startedAt).toLocaleString()} • Duration: {formatDuration(selectedSession.durationSeconds)}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <button type="button" className="ws-secondary-action" style={{ height: '30px', fontSize: '10px' }} onClick={handleExportAudio}>
                    Download Audio
                  </button>
                  <button
                    type="button"
                    className="ws-secondary-action"
                    style={{ height: '30px', fontSize: '10px' }}
                    onClick={() => handleExportTranscript('srt')}
                  >
                    Export SRT
                  </button>
                </div>
              </div>

              {/* Interactive Player Console */}
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--ws-line)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <button
                    type="button"
                    className="ws-primary-action"
                    style={{ height: '32px', padding: '0 12px' }}
                    onClick={handleTogglePlay}
                  >
                    {isPlaying ? 'Pause Tape' : '▶ Play Recording'}
                  </button>

                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--ws-muted)' }}>
                    <strong style={{ color: 'var(--ws-text)' }}>{formatDuration(currentTimeSec)}</strong> / {formatDuration(selectedSession.durationSeconds)}
                  </div>
                </div>

                {/* Seeker scrub bar */}
                <input
                  type="range"
                  min="0"
                  max={selectedSession.durationSeconds || 1}
                  step="0.1"
                  value={currentTimeSec}
                  onChange={(e) => handleSeek(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--ws-live)' }}
                  aria-label="Seek recorded audio timeline"
                />
              </div>

              {/* Synchronized Transcript Timeline */}
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <div className="ws-section-head">
                  <h2>Synchronized Transcript Timeline</h2>
                  <span>Click segment to seek audio</span>
                </div>

                <div style={{ padding: '10px 14px', overflowY: 'auto', flex: 1 }}>
                  {allTranscriptSegments.length === 0 ? (
                    <div className="ws-empty" style={{ minHeight: '120px' }}>
                      <div>
                        <strong>No Speech Transcripts Linked</strong>
                        <p>Start live speech transcription while recording to create timestamped editorial markers.</p>
                      </div>
                    </div>
                  ) : (
                    allTranscriptSegments.map((seg) => {
                      const segStartSec = seg.startMs / 1000;
                      const segEndSec = seg.endMs / 1000;
                      const isCurrent = currentTimeSec >= segStartSec && currentTimeSec <= segEndSec;

                      return (
                        <div
                          key={seg.id}
                          className="ws-segment"
                          data-current={isCurrent}
                          onClick={() => handleSeekToSegment(seg.startMs)}
                          style={{
                            cursor: 'pointer',
                            background: isCurrent ? 'color-mix(in srgb, var(--ws-live) 8%, transparent)' : undefined,
                            borderRadius: '5px',
                            padding: '6px 8px',
                          }}
                        >
                          <span className="ws-segment-time">
                            {formatDuration(segStartSec)}
                          </span>
                          <span
                            className="ws-segment-text"
                            style={{ color: isCurrent ? 'var(--ws-live)' : undefined }}
                          >
                            {seg.text}
                          </span>
                          <span className="ws-confidence">
                            {seg.confidence ? `${Math.round(seg.confidence * 100)}%` : 'ok'}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="ws-empty">
              <div>
                <strong>No Recording Selected</strong>
                <p>Select a session recording from the archive list on the left to inspect audio and speech transcript timeline.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {toastMessage && <div className="ws-toast">{toastMessage}</div>}
    </section>
  );
};
