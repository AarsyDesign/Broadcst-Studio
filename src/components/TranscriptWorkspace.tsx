import React, { useState, useEffect, useRef } from 'react';
import { transcriptionService } from '../services/transcription/transcriptionService';
import { transcriptStore } from '../services/transcription/transcriptStore';
import { recorderService, RecordedSession } from '../services/recorderService';
import { TranscriptSegment, TranscriptStatus } from '../types/transcript';

export const TranscriptWorkspace: React.FC = () => {
  const [status, setStatus] = useState<TranscriptStatus>(transcriptionService.getStatus());
  const [segments, setSegments] = useState<TranscriptSegment[]>(transcriptStore.getSegments());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [userHasScrolledUp, setUserHasScrolledUp] = useState<boolean>(false);
  const [recordingSessions, setRecordingSessions] = useState<RecordedSession[]>(recorderService.getSessions());
  const [selectedSession, setSelectedSession] = useState<RecordedSession | null>(
    recorderService.getSessions()[0] || null
  );

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const [playbackTimeMs, setPlaybackTimeMs] = useState<number>(0);

  useEffect(() => {
    const unsubStatus = transcriptionService.onStatusChange((s) => {
      setStatus(s);
    });

    const unsubStore = transcriptStore.subscribe((segs) => {
      setSegments(segs);
    });

    const unsubRecorder = recorderService.onSessionsChange((sessions) => {
      setRecordingSessions(sessions);
      if (!selectedSession && sessions.length > 0) {
        setSelectedSession(sessions[0]);
      }
    });

    return () => {
      unsubStatus();
      unsubStore();
      unsubRecorder();
    };
  }, [selectedSession]);

  // Auto-scroll logic following live speech
  useEffect(() => {
    if (autoScroll && !userHasScrolledUp && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [segments, autoScroll, userHasScrolledUp]);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;

    if (!isAtBottom) {
      setUserHasScrolledUp(true);
    } else {
      setUserHasScrolledUp(false);
    }
  };

  const handleJumpToLive = () => {
    setUserHasScrolledUp(false);
    setAutoScroll(true);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  };

  const handleToggleTranscription = async () => {
    if (status.state === 'LISTENING') {
      await transcriptionService.stop();
    } else {
      await transcriptionService.start();
    }
  };

  const handleProviderChange = async (providerId: string) => {
    await transcriptionService.setProvider(providerId);
    setStatus(transcriptionService.getStatus());
  };

  const handleLanguageChange = async (lang: string) => {
    await transcriptionService.updateConfig({ language: lang });
    setStatus(transcriptionService.getStatus());
  };

  const handleExportTxt = (withTimestamps: boolean) => {
    const text = transcriptStore.exportAsText(withTimestamps);
    transcriptStore.downloadFile(text, `transcript-${Date.now()}.txt`, 'text/plain');
  };

  const handleExportJson = () => {
    const json = transcriptStore.exportAsJson();
    transcriptStore.downloadFile(json, `transcript-${Date.now()}.json`, 'application/json');
  };

  const handleExportSrt = () => {
    const srt = transcriptStore.exportAsSrt();
    transcriptStore.downloadFile(srt, `transcript-${Date.now()}.srt`, 'application/x-subrip');
  };

  const handleClear = () => {
    if (window.confirm('Clear all transcript segments from memory and storage?')) {
      transcriptStore.clear();
      setSegments([]);
    }
  };

  // Recording ↔ Transcript Timeline Sync
  const handleSeekToSegment = (startMs: number) => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.currentTime = startMs / 1000;
      audioPlayerRef.current.play().catch(() => {});
    }
  };

  const filteredSegments = transcriptStore.search(searchQuery);

  const formatTimestamp = (ms: number): string => {
    const totalSecs = Math.floor(ms / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const providers = transcriptionService.getAvailableProviders();

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--space-5)',
        gap: 'var(--space-4)',
        backgroundColor: 'var(--color-bg)',
        overflow: 'hidden',
      }}
    >
      {/* Header Bar */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--color-surface)',
          padding: 'var(--space-3) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <h1 style={{ fontSize: 'var(--text-h2)', fontWeight: 700, margin: 0 }}>
            Live Speech Transcription
          </h1>

          {/* Privacy Badge */}
          <span
            style={{
              fontSize: 'var(--text-micro)',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 700,
              backgroundColor: status.config.isLocal ? 'rgba(217, 255, 85, 0.12)' : 'rgba(103, 183, 255, 0.12)',
              color: status.config.isLocal ? 'var(--color-live)' : 'var(--color-info)',
              border: `1px solid ${status.config.isLocal ? 'rgba(217, 255, 85, 0.25)' : 'rgba(103, 183, 255, 0.25)'}`,
            }}
          >
            {status.config.isLocal ? 'LOCAL PRIVACY (On Device)' : 'BROWSER / CLOUD'}
          </span>
        </div>

        {/* Primary Action Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <button
            onClick={handleToggleTranscription}
            style={{
              padding: 'var(--space-2) var(--space-5)',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 700,
              fontSize: 'var(--text-small)',
              backgroundColor: status.state === 'LISTENING' ? 'var(--color-live)' : 'var(--color-surface-elevated)',
              color: status.state === 'LISTENING' ? '#0B0D0F' : 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
            }}
          >
            {status.state === 'LISTENING' ? 'PAUSE TRANSCRIPTION' : 'START TRANSCRIPTION'}
          </button>
        </div>
      </header>

      {/* Control Bar: Providers, Language, Search, and Exports */}
      <section
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
          backgroundColor: 'var(--color-surface)',
          padding: 'var(--space-3) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div>
            <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '2px' }}>
              PROVIDER
            </label>
            <select
              value={status.config.provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              style={{ fontSize: 'var(--text-small)', padding: '4px 8px' }}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.isLocal ? '(Local)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '2px' }}>
              LANGUAGE
            </label>
            <select
              value={status.config.language}
              onChange={(e) => handleLanguageChange(e.target.value)}
              style={{ fontSize: 'var(--text-small)', padding: '4px 8px' }}
            >
              <option value="id">Indonesian (id-ID)</option>
              <option value="en">English (en-US)</option>
              <option value="ar">Arabic (ar-SA)</option>
            </select>
          </div>
        </div>

        {/* Search Input */}
        <div style={{ flex: 1, maxWidth: '340px' }}>
          <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '2px' }}>
            SEARCH TRANSCRIPT
          </label>
          <input
            type="text"
            placeholder="Search keywords in speech..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', fontSize: 'var(--text-small)', padding: '4px 8px' }}
          />
        </div>

        {/* Exports and Clear */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-2)' }}>
          <button
            onClick={() => handleExportTxt(true)}
            style={{
              padding: '6px 12px',
              backgroundColor: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-small)',
              fontWeight: 600,
            }}
          >
            Export TXT
          </button>

          <button
            onClick={handleExportJson}
            style={{
              padding: '6px 12px',
              backgroundColor: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-small)',
              fontWeight: 600,
            }}
          >
            Export JSON
          </button>

          <button
            onClick={handleExportSrt}
            style={{
              padding: '6px 12px',
              backgroundColor: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-small)',
              fontWeight: 600,
            }}
          >
            Export SRT
          </button>

          <button
            onClick={handleClear}
            style={{
              padding: '6px 12px',
              backgroundColor: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-error)',
              color: 'var(--color-error)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-small)',
              fontWeight: 600,
            }}
          >
            Clear
          </button>
        </div>
      </section>

      {/* Recording ↔ Transcript Synchronization Bar (when recordings exist) */}
      {recordingSessions.length > 0 && (
        <section
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--space-2) var(--space-4)',
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            flexShrink: 0,
            gap: 'var(--space-4)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--text-micro)', fontWeight: 700, color: 'var(--color-info)' }}>
              AUDIO SYNC:
            </span>
            <select
              value={selectedSession?.id || ''}
              onChange={(e) => {
                const s = recordingSessions.find((x) => x.id === e.target.value);
                if (s) setSelectedSession(s);
              }}
              style={{ fontSize: 'var(--text-small)', padding: '2px 8px' }}
            >
              {recordingSessions.map((rec) => (
                <option key={rec.id} value={rec.id}>
                  {rec.title} ({Math.round(rec.durationSeconds)}s)
                </option>
              ))}
            </select>
          </div>

          {selectedSession && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flex: 1, justifyContent: 'flex-end' }}>
              <audio
                ref={audioPlayerRef}
                src={selectedSession.blobUrl}
                controls
                onTimeUpdate={(e) => setPlaybackTimeMs((e.target as HTMLAudioElement).currentTime * 1000)}
                style={{ height: '28px', maxWidth: '360px' }}
              />
              <span style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)' }}>
                Click any segment timestamp below to seek audio playback
              </span>
            </div>
          )}
        </section>
      )}

      {/* Main Transcript Segments Container */}
      <section
        style={{
          flex: 1,
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
            paddingRight: 'var(--space-2)',
          }}
        >
          {filteredSegments.length === 0 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
                color: 'var(--color-text-muted)',
                fontSize: 'var(--text-body)',
                fontStyle: 'italic',
              }}
            >
              {status.state === 'LISTENING'
                ? 'Listening for speech input... Speak into microphone to generate live transcription.'
                : 'Transcription engine is idle. Click "START TRANSCRIPTION" to begin live speech recognition.'}
            </div>
          ) : (
            filteredSegments.map((segment) => {
              const isMatch = searchQuery && segment.text.toLowerCase().includes(searchQuery.toLowerCase());
              const isCurrentPlaying =
                selectedSession &&
                playbackTimeMs >= segment.startMs &&
                playbackTimeMs <= (segment.endMs || segment.startMs + 4000);

              return (
                <div
                  key={segment.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-2) var(--space-3)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: isCurrentPlaying
                      ? 'rgba(217, 255, 85, 0.08)'
                      : isMatch
                      ? 'rgba(103, 183, 255, 0.08)'
                      : 'transparent',
                    borderLeft: isCurrentPlaying
                      ? '3px solid var(--color-live)'
                      : segment.finalized
                      ? '3px solid transparent'
                      : '3px solid var(--color-warning)',
                    transition: 'background-color var(--motion-fast)',
                  }}
                >
                  {/* Timestamp Button: Seeks audio player */}
                  <button
                    onClick={() => handleSeekToSegment(segment.startMs)}
                    title="Click to seek audio playback to this point"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-micro)',
                      color: 'var(--color-info)',
                      backgroundColor: 'var(--color-surface-elevated)',
                      padding: '2px 6px',
                      borderRadius: 'var(--radius-sm)',
                      flexShrink: 0,
                      marginTop: '2px',
                    }}
                  >
                    {formatTimestamp(segment.startMs)}
                  </button>

                  {/* Speaker Label */}
                  {segment.speaker && (
                    <span
                      style={{
                        fontSize: 'var(--text-micro)',
                        fontWeight: 700,
                        color: 'var(--color-text-secondary)',
                        marginTop: '3px',
                        flexShrink: 0,
                      }}
                    >
                      {segment.speaker}:
                    </span>
                  )}

                  {/* Segment Text */}
                  <div style={{ flex: 1 }}>
                    <span
                      style={{
                        fontSize: 'var(--text-body)',
                        lineHeight: 1.6,
                        color: segment.finalized ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                        fontStyle: segment.finalized ? 'normal' : 'italic',
                        opacity: segment.finalized ? 1 : 0.8,
                      }}
                    >
                      {segment.text}
                    </span>

                    {!segment.finalized && (
                      <span
                        style={{
                          display: 'inline-block',
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor: 'var(--color-warning)',
                          marginLeft: '6px',
                        }}
                      />
                    )}
                  </div>

                  {/* Confidence Pill */}
                  {segment.confidence && (
                    <span
                      className="font-mono"
                      style={{
                        fontSize: 'var(--text-micro)',
                        color: 'var(--color-text-muted)',
                        flexShrink: 0,
                        marginTop: '3px',
                      }}
                    >
                      {Math.round(segment.confidence * 100)}%
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Floating "Jump to Live" button when user has scrolled up */}
        {userHasScrolledUp && (
          <button
            onClick={handleJumpToLive}
            style={{
              position: 'absolute',
              bottom: 'var(--space-4)',
              right: 'var(--space-6)',
              backgroundColor: 'var(--color-live)',
              color: '#0B0D0F',
              padding: 'var(--space-2) var(--space-4)',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 700,
              fontSize: 'var(--text-small)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            <span>Jump to Live</span>
          </button>
        )}
      </section>
    </div>
  );
};
