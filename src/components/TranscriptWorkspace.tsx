import React, { useEffect, useRef, useState } from 'react';
import { transcriptionService } from '../services/transcription/transcriptionService';
import { transcriptStore } from '../services/transcription/transcriptStore';
import { recorderService, RecordedSession } from '../services/recorderService';
import { TranscriptSegment, TranscriptStatus } from '../types/transcript';

const formatTimestamp = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export const TranscriptWorkspace: React.FC = () => {
  const [status, setStatus] = useState<TranscriptStatus>(transcriptionService.getStatus());
  const [segments, setSegments] = useState<TranscriptSegment[]>(transcriptStore.getSegments());
  const [searchQuery, setSearchQuery] = useState('');
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false);
  const [recordingSessions, setRecordingSessions] = useState<RecordedSession[]>(recorderService.getSessions());
  const [selectedSession, setSelectedSession] = useState<RecordedSession | null>(recorderService.getSessions()[0] || null);
  const [playbackTimeMs, setPlaybackTimeMs] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const unsubscribeStatus = transcriptionService.onStatusChange(setStatus);
    const unsubscribeSegments = transcriptStore.subscribe(setSegments);
    const unsubscribeSessions = recorderService.onSessionsChange((sessions) => {
      setRecordingSessions(sessions);
      setSelectedSession((current) => current || sessions[0] || null);
    });

    return () => {
      unsubscribeStatus();
      unsubscribeSegments();
      unsubscribeSessions();
    };
  }, []);

  useEffect(() => {
    if (!userHasScrolledUp && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [segments, userHasScrolledUp]);

  const filteredSegments = searchQuery.trim()
    ? segments.filter((segment) => segment.text.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : segments;

  const toggleTranscription = async () => {
    if (status.state === 'LISTENING' || status.state === 'STARTING') {
      const next = await transcriptionService.stop();
      setStatus(next);
    } else {
      const next = await transcriptionService.start();
      setStatus(next);
    }
  };

  const selectProvider = async (providerId: string) => {
    await transcriptionService.setProvider(providerId);
    setStatus(transcriptionService.getStatus());
  };

  const selectLanguage = async (language: string) => {
    await transcriptionService.updateConfig({ language });
    setStatus(transcriptionService.getStatus());
  };

  const jumpToLive = () => {
    setUserHasScrolledUp(false);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  const seek = (startMs: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = startMs / 1000;
    void audioRef.current.play();
  };

  const exportText = () => {
    transcriptStore.downloadFile(
      transcriptStore.exportAsText(true),
      `transcript-${Date.now()}.txt`,
      'text/plain'
    );
  };

  const exportJson = () => {
    transcriptStore.downloadFile(
      transcriptStore.exportAsJson(),
      `transcript-${Date.now()}.json`,
      'application/json'
    );
  };

  const exportSrt = () => {
    transcriptStore.downloadFile(
      transcriptStore.exportAsSrt(),
      `transcript-${Date.now()}.srt`,
      'application/x-subrip'
    );
  };

  const clearTranscript = () => {
    if (window.confirm('Clear the stored transcript?')) {
      transcriptStore.clear();
      setSegments([]);
    }
  };

  const providers = transcriptionService.getAvailableProviders();
  const activeSegmentId = status.activeSegmentId;

  return (
    <section className="ws-workspace ws-transcript">
      <div className="ws-command-row">
        <div>
          <div className="ws-kicker">Production / Transcript</div>
          <h1 className="ws-title">Live Transcript</h1>
          <p className="ws-subtitle">
            Follow speech as it happens, then use the same timeline against a recording.
          </p>
        </div>
        <div className="ws-transport">
          <button
            type="button"
            className={status.state === 'LISTENING' ? 'ws-secondary-action' : 'ws-primary-action'}
            onClick={toggleTranscription}
          >
            {status.state === 'LISTENING' ? 'Pause Transcription' : 'Start Transcription'}
          </button>
        </div>
      </div>

      <div className="ws-toolbar">
        <div className="ws-toolbar-group">
          <span className="ws-toolbar-label">Provider</span>
          <select
            className="ws-select"
            value={status.config.provider}
            onChange={(event) => void selectProvider(event.target.value)}
            aria-label="Transcription provider"
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}{provider.isLocal ? ' (Local)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="ws-toolbar-group">
          <span className="ws-toolbar-label">Language</span>
          <select
            className="ws-select"
            value={status.config.language}
            onChange={(event) => void selectLanguage(event.target.value)}
            aria-label="Transcript language"
          >
            <option value="id">Indonesian</option>
            <option value="en">English</option>
            <option value="ar">Arabic</option>
          </select>
        </div>

        <input
          className="ws-input"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search the current transcript"
          aria-label="Search transcript"
        />

        <div className="ws-toolbar-spacer" />

        {userHasScrolledUp && (
          <button type="button" className="ws-top-action" onClick={jumpToLive}>
            Jump to Live
          </button>
        )}

        <button type="button" className="ws-top-action" onClick={exportText}>TXT</button>
        <button type="button" className="ws-top-action" onClick={exportJson}>JSON</button>
        <button type="button" className="ws-top-action" onClick={exportSrt}>SRT</button>
        <button type="button" className="ws-top-action" onClick={clearTranscript}>Clear</button>
      </div>

      {recordingSessions.length > 0 && selectedSession && (
        <div className="ws-record-bar">
          <span className="ws-toolbar-label">Recording</span>
          <select
            className="ws-select"
            value={selectedSession.id}
            onChange={(event) => {
              const session = recordingSessions.find((item) => item.id === event.target.value);
              if (session) setSelectedSession(session);
            }}
            aria-label="Transcript recording"
          >
            {recordingSessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title}
              </option>
            ))}
          </select>
          <audio
            ref={audioRef}
            controls
            src={selectedSession.blobUrl}
            onTimeUpdate={(event) => setPlaybackTimeMs(event.currentTarget.currentTime * 1000)}
          />
          <span className="ws-record-meta">
            {formatTimestamp(playbackTimeMs)} / {formatTimestamp(selectedSession.durationSeconds * 1000)}
          </span>
        </div>
      )}

      <div
        className="ws-transcript-list"
        ref={scrollRef}
        onScroll={() => {
          if (!scrollRef.current) return;
          const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
          setUserHasScrolledUp(scrollHeight - scrollTop - clientHeight > 40);
        }}
      >
        {filteredSegments.length === 0 ? (
          <div className="ws-empty">
            <div>
              <strong>
                {searchQuery.trim()
                  ? 'No matching speech'
                  : status.state === 'LISTENING'
                    ? 'Waiting for speech'
                    : 'Transcript is idle'}
              </strong>
              {searchQuery.trim()
                ? 'Try a different keyword or clear the search.'
                : status.state === 'LISTENING'
                  ? 'Finalized speech will appear here as the provider produces segments.'
                  : 'Start transcription to create a live speech timeline.'}
            </div>
          </div>
        ) : (
          filteredSegments.map((segment) => {
            const currentPlayback = selectedSession
              ? playbackTimeMs >= segment.startMs && playbackTimeMs <= (segment.endMs || segment.startMs + 3000)
              : false;
            const active = segment.id === activeSegmentId;

            return (
              <div
                className="ws-segment"
                key={segment.id}
                data-interim={!segment.finalized}
                data-current={active || currentPlayback}
              >
                <button
                  type="button"
                  className="ws-top-action ws-segment-time"
                  onClick={() => seek(segment.startMs)}
                  aria-label={`Seek recording to ${formatTimestamp(segment.startMs)}`}
                  disabled={!selectedSession}
                >
                  {formatTimestamp(segment.startMs)}
                </button>

                <span className="ws-segment-text">
                  {segment.speaker ? `${segment.speaker}: ` : ''}
                  {segment.text}
                </span>

                <span className="ws-confidence">
                  {segment.confidence !== undefined ? `${Math.round(segment.confidence * 100)}%` : ''}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
