# Broadcast Ecosystem — Architecture

## Runtime

```text
Tauri Desktop
├── React / TypeScript UI
├── Tauri IPC
└── Rust Core
    ├── audio-engine
    ├── stream-engine
    ├── transcription
    ├── recording
    ├── metadata
    ├── automation
    ├── plugin-host
    ├── telemetry
    └── control-api
```

## Critical rule

The real-time audio path must never wait for:
- UI rendering
- AI requests
- cloud transcription
- disk-heavy operations
- plugin discovery
- metadata API calls

## Audio path

```text
Input Device
    ↓
Capture
    ↓
Audio Buffer
    ↓
Internal Processing
    ↓
Mixer / Routing
    ├──────────────→ Recorder
    ├──────────────→ Transcription Queue
    └──────────────→ Encoder
                         ↓
                    SHOUTcast
```

## Control path

```text
React UI ──┐
           ├── Control API ── Rust Core
AI / MCP ──┘
```

## Event examples

```text
broadcast.status.changed
audio.level.changed
audio.device.changed
stream.metrics.changed
transcript.segment.created
recording.completed
plugin.status.changed
```

## Failure isolation

A failure in:
- transcription
- AI provider
- plugin
- metadata service

must not automatically stop the broadcast.

Broadcast failure must surface immediately and explicitly.
