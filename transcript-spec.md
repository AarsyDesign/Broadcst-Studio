# Live Transcript Specification

## Goal

Provide near-real-time speech transcription while broadcasting or recording without affecting audio continuity.

## Pipeline

```text
Audio Engine
    ↓
Transcript Ring Buffer
    ↓
VAD / Chunker
    ↓
Transcription Provider
    ↓
Interim Segment
    ↓
Final Segment
    ↓
Transcript Store
```

## Segment lifecycle

```text
CAPTURED
  ↓
PROCESSING
  ↓
INTERIM
  ↓
FINAL
```

## UI rules

- Interim text may change.
- Final text must remain stable.
- Current segment receives subtle live emphasis.
- Scrolling follows the current segment until the user manually scrolls.
- Manual scrolling suspends auto-follow but does not stop transcription.
- A "Jump to Live" action restores auto-follow.

## Export formats

V0.1:
- TXT
- JSON

Future:
- SRT
- VTT
- Markdown
- timestamped show notes

## Privacy

The UI must clearly show:
- provider
- local/cloud status
- recording status
- whether audio is leaving the machine

Cloud transcription must never be visually indistinguishable from local transcription.
