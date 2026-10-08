# Broadcast Ecosystem — Architecture & Technical Specification

> **Phase B Status**: NATIVE CORE IMPLEMENTED  
> **External Acceptance**: PENDING / BLOCKED (external SHOUTcast DNAS server unavailable in offline sandbox)

---

## 1. System Runtime Overview

Broadcst Studio operates with a strict separation between the React UI presentation layer and the native Rust audio/streaming engine:

```text
Tauri Desktop Host
├── React / TypeScript Workstation UI (Presentation & Monitoring only)
├── Tauri IPC (Typed asynchronous command & event bridge)
└── Native Rust Core (Real-time audio processing & networking)
    ├── audio::capture    (CPAL / WASAPI low-latency hardware input)
    ├── audio::buffer     (Wait-free bounded SPSC ring buffer via rtrb)
    ├── audio::mixer      (Atomic channel strips, master summing & limiter)
    ├── audio::engine     (10ms processing engine thread & Master PCM Tap)
    ├── encoder           (Off-thread MP3 CBR encoding via pure-Rust rusty_mp3)
    ├── shoutcast         (Tokio async TCP transport worker & DNAS protocol)
    ├── recording         (Off-thread WAV writer worker via hound)
    └── telemetry         (Honest, measured metrics; zero fabricated telemetry)
```

---

## 2. Canonical Internal Audio Contract

All internal processing, mixing, and tap distribution enforces an explicit, uncompromised canonical audio contract:

- **Sample Format**: `f32` (normalized `[-1.0, 1.0]`)
- **Sample Rate**: `48,000 Hz` (`48 kHz`)
- **Channel Configuration**: Stereo (`2 channels`)
- **Interleaving**: Interleaved (`L, R, L, R, ...`)
- **Processing Block**: `480 frames` per tick = `960 samples` (`10.0 ms`)

### Input Format Conversion & Resampling
If physical WASAPI hardware defaults to a different format:
- **Format Normalization**: `f32` pass-through, `i16` normalized by `1.0 / 32768.0`, `u16` centered and normalized.
- **Channel Normalization**: Mono sources duplicate across L/R channels.
- **Real-Time Resampling**: Zero-allocation `RealtimeResampler` utilizing linear fractional-delay interpolation with stack-allocated buffers. Converts any hardware rate (e.g., 44.1 kHz, 96 kHz, 16 kHz) directly to canonical 48 kHz within the CPAL callback without heap allocations or locks.

---

## 3. Thread Model & Real-Time Safety Guarantee

```text
[ Physical Microphone ]
          │ (WASAPI Callback)
          ▼
   Real-Time Producer (Zero-Allocation, Zero-Lock)
          │ Wait-Free SPSC Ring Buffer (rtrb, 96000 samples / 1.0s)
          ▼
   Audio Engine Thread (Paced 10ms / 480 frames)
   ├── Mic Channel Strip (Gain, Fader, Mute, Peak/RMS Metering)
   ├── Placeholder Channels (Music, Aux, SFX — Silence until Phase D)
   ├── Master Summing: master_sum[i] = Σ channel_buffers[i]
   ├── Master Bus Limiter (Ceiling -0.5 dBFS soft-knee curve)
   └── Master PCM Tap Distribution (Bounded crossbeam channels)
          ├──────────────────────────────┐
          ▼                              ▼
   Encoder Worker Thread          Recorder Worker Thread
   (rusty_mp3 CBR)                (hound WAV writer)
          │ Bounded Network Queue        │
          ▼                              ▼
   SHOUTcast Transport Task       Local WAV File on Disk
   (Tokio TCP Worker)
          │
          ▼
   [ SHOUTcast DNAS Server ]
```

### Real-Time Invariants (Audio Callback & Engine Path)
The capture and engine paths strictly forbid:
- Heap allocations (`Vec::new()`, `String`, etc.)
- Mutex / RwLock blocking operations
- Disk filesystem I/O
- Network socket I/O
- Async/await runtimes or task polling
- Calling Tauri IPC or logging frameworks
- Calling transcription or AI/MCP APIs

---

## 4. SHOUTcast Protocol Specification

Broadcst Studio targets the authoritative **SHOUTcast Source Protocol (DNAS v1 / ICY wire protocol)** supported universally by Nullsoft SHOUTcast DNAS 1.x and 2.x:

1. **Transport**: Dedicated persistent TCP connection to the DNAS server port.
2. **Authentication Handshake**:
   - Single-stream DNAS 1: `<PASSWORD>\r\n`
   - Multi-stream DNAS 2: `<PASSWORD>:#<STREAM_ID>\r\n`
   *(Icecast `SOURCE /mount HTTP/1.0` and `Authorization: Basic` are explicitly rejected to avoid protocol confusion).*
3. **Server Acceptance**: Server must respond with `OK2\r\n` (and optional `icy-caps`). Only upon receiving `OK2` does the client transition to `CONNECTED`. Rejections (such as `invalid password`) immediately transition the client to `ERROR`.
4. **ICY Stream Headers**: Client immediately emits:
   ```text
   icy-name:<station_name>\r\n
   icy-genre:<genre>\r\n
   icy-url:http://<server>\r\n
   icy-pub:<0 or 1>\r\n
   icy-br:<bitrate>\r\n
   \r\n
   ```
5. **Continuous Audio Stream**: Following double CRLF, client streams continuous raw MP3 audio frames.
6. **Dynamic Metadata Transport**: Dispatched off the audio thread via HTTP to the DNAS administration interface:
   `GET /admin.cgi?mode=updinfo&pass=<PASSWORD>&song=<ENCODED_SONG>&sid=<STREAM_ID> HTTP/1.0\r\n\r\n`
   Passwords are never logged or surfaced in error messages. Delivery is confirmed by reading the HTTP response.
7. **Connection State Machine**:
   `OFFLINE` → `CONNECTING` → `AUTHENTICATING` → `CONNECTED` → `RECONNECTING` → `ERROR`
   - Manual `STOP` immediately aborts transport tasks and permanently terminates reconnect loops.
   - Network socket timeouts (5s handshake, 5s write) trigger exponential backoff reconnects (1s, 2s, 4s, 8s, up to 30s) unless manually stopped.

---

## 5. MP3 Encoder Selection & Licensing

- **Library**: `rusty_mp3` (v1.0.0)
- **License**: Apache-2.0
- **Architectural Rationale**: Pure-Rust implementation of MPEG-1 Audio Layer III encoding with no C/FFI dependencies, zero dynamic link dependencies, and full open-source licensing compliance. Validated via automated unit round-trip tests using `rusty_mp3::Mp3Decoder`.

---

## 6. Telemetry Honesty Principle

Telemetry values in Broadcst Studio represent genuinely measured physical or logical state:
- **Audio Meters**: True dBFS computed from actual sample amplitudes (`20 * log10(peak)` and `20 * log10(RMS)`). Silence reads `-90.0 dBFS`.
- **Stream Throughput**: Rolling 1-second byte accumulator divided by elapsed time (`kbps`).
- **Buffer Health**: Actual remaining capacity ratio of the bounded network queue.
- **Network Latency**: Reported as unmeasured (`—` or `0`) when no active ICMP ping probe is available. Never fabricated with artificial numbers (e.g. 18ms or 0.98).
- **System Telemetry**: CPU and memory usage remain unmeasured (`0.0`) unless instrumented via OS performance counters.

---

## 7. Scope Boundaries & Implementation Status

| Subsystem | Current Scope | Implementation Status | Verification Level |
| :--- | :--- | :--- | :--- |
| **Physical Mic Input** | CPAL / WASAPI capture | Implemented with Resampler | INTEGRATION-VERIFIED |
| **Wait-free SPSC** | `rtrb` 96000 samples | Implemented & Tested | UNIT-VERIFIED |
| **Channel Strips** | Mic (Hardware), Music/Aux/SFX (Simulated) | Implemented & Tested | UNIT-VERIFIED |
| **Master Summing** | True accumulator buffer summation | Implemented & Tested | UNIT-VERIFIED |
| **Limiter & Meters** | Soft-knee curve, Peak/RMS dBFS | Implemented & Tested | UNIT-VERIFIED |
| **MP3 Encoder** | `rusty_mp3` 128/192/320 CBR | Implemented & Round-trip Tested | UNIT-VERIFIED |
| **WAV Recorder** | `hound` 16-bit 48kHz stereo worker | Implemented & File-validated | INTEGRATION-VERIFIED |
| **SHOUTcast Protocol** | DNAS 1/2 wire protocol & `/admin.cgi` | Implemented & Parser-tested | UNIT-VERIFIED |
| **Live DNAS Stream** | Real network stream to physical server | Implemented | **BLOCKED** (no external server) |
| **Phase C Whisper** | Speech-to-text live transcription | Not Started | **BLOCKED** by Phase B Gate |
