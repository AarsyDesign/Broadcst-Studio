# Development Roadmap

## Phase 0 — Foundation & Design System
- [x] Repository initialized & clean Git history
- [x] Tauri 2 + React workstation shell
- [x] Modular design system & CSS design tokens (`design-tokens.md`)
- [x] Workstation layout & motion system (`design.md`, `motion-spec.md`)
- [x] Type-safe IPC command contract (`src/types/ipc.ts`)

---

## Phase B — Native Audio Core
**Current Status: NATIVE CORE IMPLEMENTED — EXTERNAL ACCEPTANCE PENDING**

- [x] Enumerate physical audio input devices via CPAL / WASAPI
- [x] Physical microphone capture stream with device lifecycle management
- [x] Real-time safe linear resampler (stack-allocated, zero-allocation, 44.1kHz/96kHz → 48kHz)
- [x] Wait-free bounded SPSC audio ring buffer (`rtrb`, 96k samples)
- [x] Real-time audio channel strip (atomic gain, fader, mute, solo, peak/RMS metering)
- [x] True master bus summation accumulator (Σ active channel buffers)
- [x] Master bus soft-knee limiter (-0.5 dBFS ceiling)
- [x] Master PCM Tap distribution with bounded non-blocking queues & dropped frame counters
- [x] Pure-Rust MP3 CBR streaming encoder (`rusty_mp3`, Apache-2.0, zero C/FFI)
- [x] Automated MP3 bitstream round-trip verification via `rusty_mp3::Mp3Decoder`
- [x] Master WAV recorder worker (`hound`, 16-bit 48kHz stereo, duration tracking, clean finalize)
- [x] Authoritative SHOUTcast DNAS v1/v2 source protocol (`password` → `OK2` → `icy-*` headers)
- [x] SHOUTcast connection state machine (`OFFLINE`, `CONNECTING`, `AUTHENTICATING`, `CONNECTED`, `RECONNECTING`, `ERROR`)
- [x] Exponential backoff reconnect with immediate cancellation on manual `STOP`
- [x] Dynamic metadata updates via `/admin.cgi?mode=updinfo` with response verification
- [x] Strict telemetry honesty (no fabricated 0.98 buffer health, 18ms latency, or fake CPU%)
- [ ] **Physical Hardware Verification Gate** (Live speech into physical mic under studio conditions) — *Pending manual hardware test*
- [ ] **External DNAS Verification Gate** (End-to-end stream to physical SHOUTcast server) — *BLOCKED (external server unavailable)*

---

## Phase C — Live Transcription (BLOCKED)
*Gate Condition: Phase C remains BLOCKED until physical microphone and external DNAS streaming acceptance are satisfied.*

- [ ] Native audio tap for transcription worker
- [ ] Whisper engine abstraction & model downloader
- [ ] Live interim audio chunking & VAD (Voice Activity Detection)
- [ ] Segment streaming & UI transcript timeline synchronization
- [ ] Transcript persistence & search

---

## Phase D — Ecosystem & Automation (FUTURE)
- [ ] Independent plugin process sandbox
- [ ] Broadcst Plugin API & manifest
- [ ] Scheduling & automation engine
- [ ] Multi-station profile management
- [ ] Icecast source protocol adapter

---

## Phase E — AI & Control Layer (FUTURE)
- [ ] Control API exposure for AI agents & MCP servers
- [ ] Live telemetry analysis
- [ ] Autonomous show assistant
- [ ] Automatic show notes & metadata generation
