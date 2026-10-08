# Broadcst Studio Plugin Developer Guide (Plugin API v1)

Welcome to the **Broadcst Studio Plugin Ecosystem**. Broadcst Studio is an open-source, engineering-grade radio and streaming broadcast platform.

The core philosophy of the ecosystem is:
> **The CORE engine remains rock-solid and stable. PLUGINS extend the platform.**

This guide explains how external developers can build, test, and distribute custom broadcast extensions without modifying internal core engine code.

---

## 1. What is a Broadcst Plugin?

A **Broadcst Plugin** is a self-contained extension packaged with a manifest declaration (`manifest.json`), an entrypoint script, optional configuration schemas, and assets. 

Plugins interact with Broadcst Studio through the public, versioned **`@broadcst/plugin-sdk`**. Rather than granting plugins direct access to internal application state or Rust audio pointers, the host exposes:
- **Controlled commands** (permission-gated)
- **Safe application events** (`track.changed`, `broadcast.connected`, `recording.started`, etc.)
- **A deterministic realtime audio processing contract**
- **Scoped logging and state persistence**

---

## 2. Plugin Types

Broadcst Studio organizes plugins into 6 architectural domains:

| Plugin Type | Domain | Execution Model | Example Use Cases |
| :--- | :--- | :--- | :--- |
| **`AUDIO_PROCESSOR`** | Realtime DSP | Audio callback / worker | Dynamic voice levelers, parametric EQs, soft limiters, multiband compressors. |
| **`OUTPUT`** | Stream Syndication | Async connection lifecycle | Telegram Live audio streams, RTMP relays, YouTube Live, Twitch, Discord voice bots. |
| **`AUDIO_SOURCE`** | Audio Feed | Async provider | Podcast syndication feeds, remote Iceberg/HLS stream relays, rotation buckets. |
| **`METADATA`** | Metadata & RDS | Event-driven | Webhook syndicators, Twitter/Discord now-playing announcers, AzuraCast bridges. |
| **`AUTOMATION`** | Scheduling & Macros | Event-driven | Top-of-hour station ID injectors, sponsor pods, automatic playlist rotation. |
| **`UTILITY`** | Background Tools | Periodic background worker | Silence detectors, loudness radar, channel phase analyzers, health watchdogs. |

---

## 3. Plugin Manifest Specification (`manifest.json`)

Every plugin must declare a `manifest.json` at its root. The schema is forward-compatible.

```json
{
  "$schema": "https://broadcst.org/schemas/plugin-manifest-v1.json",
  "id": "com.example.voice-leveler",
  "name": "Broadcast Voice Leveler",
  "version": "1.0.0",
  "apiVersion": 1,
  "author": "Example Audio Labs",
  "description": "3-band speech leveling and peak control for studio microphones.",
  "type": "AUDIO_PROCESSOR",
  "permissions": [
    "audio.read",
    "audio.write"
  ],
  "entryPoint": "index.js",
  "homepage": "https://example.com/voice-leveler",
  "license": "MIT",
  "tags": ["audio", "voice", "leveler", "realtime"]
}
```

### Required Fields
- **`id`**: Unique string using reverse-domain or kebab-case (e.g. `com.station.processor`).
- **`name`**: Operator-facing display title.
- **`version`**: Semantic version string (e.g. `1.0.0`).
- **`apiVersion`**: Target host API version integer (Current: `1`).
- **`author`**: Developer or organization name.
- **`description`**: Concise explanation of what the extension does.
- **`type`**: One of `AUDIO_PROCESSOR`, `AUDIO_SOURCE`, `METADATA`, `AUTOMATION`, `UTILITY`.
- **`permissions`**: Array of requested capabilities.

---

## 4. Permission Model & Capability Enforcement

Plugins operate under a strict **Fail-Closed (Default-Deny)** security model.

### Permission Status Model
Permissions fall into three explicit architectural states:

| State | Definition | Current Status |
| :--- | :--- | :--- |
| **`ENFORCED`** | Verified and gated at runtime before any action executes. | `audio.read`, `audio.write`, `metadata.read`, `metadata.write`, `automation.read`, `automation.execute` |
| **`DECLARED`** | Declared in manifest for future capability negotiation; scoped host broker API is pending. | `network`, `filesystem.read`, `filesystem.write` |
| **`AVAILABLE`** | Exposes a dedicated scoped host capability API. | Session state store, scoped logger, scoped event bus, command executor. |

> [!CAUTION]
> **No Unrestricted Access:**
> A plugin declaring `network` or `filesystem.write` does NOT automatically gain unmonitored host access. In the production architecture, unsanctioned direct global browser/Node access is prohibited.

### Default-Deny Command Enforcement
When a plugin invokes `context.commands.execute(command, params)`:
1. **Allowlist Verification**: The command must exist in the Broadcst Plugin API allowlist. Any unknown or unmapped command is immediately **DENIED**.
2. **Permission Verification**: The plugin must have declared the required permission. If missing, it is **DENIED**.
3. **Audit Logging**: Every invocation attempt (allowed or denied) is permanently recorded in the host command audit trace.

```
Incoming Plugin Command
       │
       ▼
Is Command Known? ─── NO ───► DENY & AUDIT (Unknown Command)
       │ YES
       ▼
Permission Declared? ─── NO ──► DENY & AUDIT (Permission Denied)
       │ YES
       ▼
ALLOW & EXECUTE via Control API
```

---

## 5. Plugin Lifecycle

Plugins transition through 7 deterministic states:

```
[ DISCOVERED ]
      ↓
[ VALIDATING ]  (Checks schema, API version, and permissions)
      ↓
   [ READY ]
      ↓  (Operator enables plugin)
  [ ENABLED ]   (initialize() → start())
      ↓  (Operator disables plugin)
 [ DISABLED ]   (stop())
      ↓  (Operator removes plugin)
[ UNINSTALLED ] (dispose())
```

If an unhandled exception occurs during runtime, the state transitions to `ERROR`.

### Lifecycle Hooks
```typescript
export interface Plugin {
  readonly manifest: PluginManifest;
  initialize?(context: PluginContext): Promise<void> | void;
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
  dispose?(): Promise<void> | void;
}
```

---

## 6. The Realtime Audio Processor Contract

Realtime audio processors (`AUDIO_PROCESSOR`) execute directly in the low-latency audio processing loop.

### Strict Realtime Constraints
1. **Zero Heap Allocation**: Never instantiate objects, arrays, or closures inside `process()`. Preallocate all buffers in `initialize()`.
2. **Zero Syscalls / Blocking**: Never perform file I/O, network requests, thread sleeps, or acquire blocking locks.
3. **Deterministic Deadline**: Must finish processing within the audio period deadline (e.g., < 5.3ms for 256 samples @ 48kHz).
4. **No AI/UI Invocations**: Never invoke UI or heavy generative AI APIs inside `process()`.

### Interface Signature
```typescript
export interface AudioProcessorPlugin extends Plugin {
  process(
    inputBuffer: Float32Array[],
    outputBuffer: Float32Array[],
    sampleRate: number,
    channels: number,
    frameCount: number
  ): void;
}
```

---

## 7. Output Plugins & Master Audio Syndication (`OutputPlugin`)

Broadcst Studio introduces the **Output Plugin API** for syndicating master broadcast audio to external platforms (Telegram Live, RTMP relays, YouTube Live, Discord voice bots, Twitch) without hardcoding platform logic into the application core.

### Strict Media Boundary: Control Domain vs. Realtime Media Transport
```text
MASTER AUDIO (Domain A - Rust Realtime AudioEngine)
       ↓
NATIVE OUTPUT ROUTER (Rust Native Media Sinks)
  ├── Native SHOUTcast Stream (First-class MP3 DNAS pipeline)
  ├── Native Master Recorder (Lossless WAV Capture)
  └── Plugin-Backed Native Media Sinks (Extensible Realtime Boundary)

PLUGIN CONTROL DOMAIN (Domain B - TypeScript / Non-Realtime Async)
       ↓
OutputPlugin Contract
  ├── Destination Configuration & Endpoint Negotiation
  ├── Lifecycle Commands (output.start / output.stop)
  ├── Live Metadata Synchronization (Track title & artist ICY sync)
  ├── Status & Diagnostics Telemetry
  └── Controlled Workstation UI Panels (OUTPUT_PANEL / ON_AIR_PANEL)
```

- **Zero PCM in JavaScript**: Raw audio frames are **never** copied or routed through JavaScript, React, or browser event buses. Realtime processing executes strictly within the Rust audio engine.
- **Native `MediaSink` Contract**: Downstream destinations interface with the native engine via `MediaSink` (`src-tauri/src/audio/sink.rs`):
  - `open(config: MediaSinkConfig) -> Result<(), MediaSinkError>`
  - `start() -> Result<(), MediaSinkError>`
  - `write_block(pcm_interleaved: &[f32]) -> Result<usize, MediaSinkError>` (Canonical: 48kHz, 2 channels, 480 frames = 960 samples per block)
  - `flush() -> Result<(), MediaSinkError>`
  - `stop() -> Result<(), MediaSinkError>`
  - `close() -> Result<(), MediaSinkError>`
  - `state() -> MediaSinkState`
  - `metrics() -> MediaSinkMetrics`

### Output Plugin Contract (TypeScript SDK)
```typescript
export interface OutputPlugin<TConfig = OutputPluginConfig> extends Plugin {
  readonly manifest: PluginManifest & { type: 'OUTPUT' };
  startOutput?(config?: TConfig): Promise<boolean> | boolean;
  stopOutput?(): Promise<boolean> | boolean;
  getOutputStatus(): OutputStatus;
  updateMetadata?(metadata: { title: string; artist: string; album?: string }): Promise<void> | void;
}
```

### Honest Output Status Semantics
Broadcst Studio enforces strict status honesty:
- **`DISCONNECTED`**: Output target is inactive.
- **`CONFIGURED`**: Endpoint parameters provided; awaiting activation.
- **`READY`**: Target initialized and ready to initiate streaming.
- **`CONNECTING`**: Establishing network transport handshake.
- **`CONNECTED`**: Real audio transport actively streaming to endpoint. (Never reported unless `transportRunning: true`).
- **`RECONNECTING`**: Transport recovering from connection loss.
- **`ERROR`**: Operational or network failure with diagnostics.
- **`REFERENCE_ONLY`**: Architectural reference / simulation. Explicitly communicates that no real RTMP/network audio transport is transmitting.

> [!IMPORTANT]
> **Status Honesty Principle:**
> "Plugin enabled" (host lifecycle) is **NOT** equal to "Output connected" (active audio stream). An architectural reference plugin must never claim `CONNECTED` or fake uptime, bitrate, or listener counts.

### Credential & Stream Key Security
- **In-Memory Retention**: Secrets and stream keys are held strictly in memory during the runtime session.
- **No Secret Logging**: Stream keys are never passed to `context.logger` or exposed in unmasked telemetry endpoints.
- **Future Vault Integration**: Future production releases will bind credential storage directly to the OS secure key vault (Tauri Keyring).

---

## 8. UI Extension API

Plugins can contribute controlled UI panels into the workstation without gaining arbitrary DOM access or destroying the workstation design system.

### Approved Extension Slots
- **`OUTPUT_PANEL`**: Renders output target controls (e.g. Telegram Live streamer card).
- **`SETTINGS_PANEL`**: Renders plugin-owned configuration surfaces.
- **`ON_AIR_PANEL`**: Mounted alongside the on-air workstation broadcast telemetry.
- **`INSPECTOR`**: Mounted in detail/metadata inspection sidebars.
- **`TOOLBAR_ACTION`**: Compact workstation header actions.

### Controlled UI Registration
```typescript
initialize(context: PluginContext) {
  if (context.ui) {
    this.unregisterUI = context.ui.registerPanel({
      id: 'my-custom-output-panel',
      slot: 'OUTPUT_PANEL',
      title: 'Telegram Live Audio',
      icon: 'Send',
      description: 'Stream syndication to Telegram channel voice chat',
      render: (uiContext) => (
        <TelegramOutputPanel plugin={this} uiContext={uiContext} />
      ),
    });
  }
}
```

### Host Isolation & Design System Protection
- **No Direct DOM**: Plugins do not receive `document.querySelector` or raw ReactDOM access.
- **Workstation Design Tokens**: UI components are styled using `--ws-panel`, `--ws-live`, `--ws-text`, and standard `.ws-badge`, `.ws-tag`, `.ws-mini-action` classes.
- **Error Boundary Isolation**: Each plugin UI extension is wrapped inside `<PluginUIErrorBoundary>`. If a plugin UI component throws, it displays a local error card without crashing On Air, Mixer, Decks, or navigation.
- **Clean Lifecycle**: When a plugin is disabled or uninstalled, all its UI panels unmount immediately.

---

## 9. Non-Realtime Plugins (Metadata, Automation, Utility)

Non-realtime plugins run outside the audio thread:
- **`METADATA` & `AUTOMATION`**: Driven by safe events via `context.events.on('track.changed', ...)` or `context.events.on('schedule.triggered', ...)`.
- **`UTILITY`**: Implements `tick(context)` called periodically by the host on a low-priority background timer (e.g. 1 Hz) for health monitoring.

---

## 10. Developer SDK (`@broadcst/plugin-sdk`)

Developers install or reference the SDK:
```bash
npm install @broadcst/plugin-sdk
```

---

## 11. Official Example Plugins

The repository contains 5 reference implementations in `plugins/examples/`:
1. **`example-telegram-output`**: **Official Reference Output Plugin** demonstrating RTMP stream destination configuration, connection lifecycle, and controlled workstation UI contribution.
2. **`example-audio-processor`**: Realtime soft limiter and gain trim demonstrating zero-allocation processing.
3. **`example-metadata-sync`**: Event-driven track listener syndicating titles and storing persistent state.
4. **`example-station-id-automation`**: Automated station identification macro triggered by program clocks.
5. **`example-silence-detector`**: Utility background watchdog detecting dead air and firing emergency failovers.

---

## 10. Local Development & Sideload Workflow

1. Open Broadcst Studio and navigate to the **Plugins** workspace.
2. Click the **Developer Sideload** tab.
3. Paste your `manifest.json` or click one of the pre-filled SDK templates.
4. The **Validation Diagnostics** pane continuously checks:
   - Schema correctness
   - API version compatibility
   - Permission syntax
   - Entrypoint definitions
5. Click **Register & Install Plugin** to sideload it into your local runtime.

---

## 11. Security Architecture: In-Process vs. Process Isolation

> [!IMPORTANT]
> **Honest Security Note:**
> In the current developer preview, plugins run **in-process**. In-process execution is convenient for local development but is **NOT a secure sandbox**.
>
> The target production architecture will isolate community extensions into:
> - **WebAssembly Workers** for lightweight sandboxed compute.
> - **Isolated Native Subprocesses** communicating with Broadcst Core via shared memory for realtime audio and IPC for commands.

---

## 12. Contribution Workflow

External developers are welcome to contribute plugins or SDK enhancements!
- Place new reference plugins in `plugins/examples/<your-plugin-name>/`.
- Submit PRs without touching core audio mixer or CPAL threading files.
- Ensure all manifests pass `validateManifest()` tests.
