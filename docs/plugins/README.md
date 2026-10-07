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

Broadcst Studio organizes plugins into 5 architectural domains:

| Plugin Type | Domain | Execution Model | Example Use Cases |
| :--- | :--- | :--- | :--- |
| **`AUDIO_PROCESSOR`** | Realtime DSP | Audio callback / worker | Dynamic voice levelers, parametric EQs, soft limiters, multiband compressors. |
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

## 7. Non-Realtime Plugins (Metadata, Automation, Utility)

Non-realtime plugins run outside the audio thread:
- **`METADATA` & `AUTOMATION`**: Driven by safe events via `context.events.on('track.changed', ...)` or `context.events.on('schedule.triggered', ...)`.
- **`UTILITY`**: Implements `tick(context)` called periodically by the host on a low-priority background timer (e.g. 1 Hz) for health monitoring.

---

## 8. Developer SDK (`@broadcst/plugin-sdk`)

Developers install or reference the SDK:
```bash
npm install @broadcst/plugin-sdk
```

### Writing a Plugin
```typescript
import {
  definePlugin,
  MetadataPlugin,
  PluginContext,
  TrackChangedEvent,
} from '@broadcst/plugin-sdk';
import manifest from './manifest.json';

export const myPlugin: MetadataPlugin = definePlugin({
  manifest,

  initialize(context: PluginContext) {
    context.logger.info('Initialized metadata plugin');
  },

  start() {
    this.context.events.on('track.changed', (evt: TrackChangedEvent) => {
      this.context.logger.info(`Now playing: ${evt.artist} - ${evt.title}`);
    });
  },

  stop() {
    // Teardown listeners
  },
});

export default myPlugin;
```

---

## 9. Official Example Plugins

The repository contains 4 reference implementations in `plugins/examples/`:
1. **`example-audio-processor`**: Realtime soft limiter and gain trim demonstrating zero-allocation processing.
2. **`example-metadata-sync`**: Event-driven track listener syndicating titles and storing persistent state.
3. **`example-station-id-automation`**: Automated station identification macro triggered by program clocks.
4. **`example-silence-detector`**: Utility background watchdog detecting dead air and firing emergency failovers.

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
