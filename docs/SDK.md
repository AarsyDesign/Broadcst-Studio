# Broadcast Ecosystem: Plugin & Automation SDK

> Version: 1.0.0  
> Target: Desktop Broadcaster (Tauri + Web Audio + Rust Core)  
> Core Rule: Audio thread must never block on plugin discovery or execution.

---

## 1. Architectural Philosophy

The Broadcast Ecosystem does not rely on outdated, crash-prone legacy DSP systems like Winamp DSP. Instead, it owns a modular, type-safe plugin and automation contract with built-in failure isolation.

### The Failure Isolation Guarantee
Any failure or uncaught exception inside a plugin, automation macro, AI agent, or metadata service is isolated immediately. The master audio engine and SHOUTcast stream continue broadcasting without interruption.

---

## 2. Plugin API

### Plugin Categories

Plugins belong to one of the following distinct categories:

1. `audio_effect`: DSP nodes modifying or monitoring audio samples (e.g. compressors, duckers, voice levelers).
2. `audio_source`: Generators or players feeding samples into mixer channels (e.g. soundboard, file players).
3. `output`: Broadcast stream transmitters (e.g. SHOUTcast v1/v2, Icecast, WebRTC).
4. `metadata`: Track title, artist, and chapter injectors.
5. `automation`: Event listeners and scheduled broadcast actions.
6. `utility`: Telemetry analyzers, stream loggers, and diagnostics.

### Plugin Manifest

Every plugin exports a manifest conforming to this contract:

```ts
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: PluginCategory;
  permissions: PluginPermission[];
  homepage?: string;
}
```

### Lifecycle Interface

A plugin implements the following lifecycle hooks:

```ts
export interface BroadcastPlugin {
  manifest: PluginManifest;
  
  // Called once when the plugin is loaded into the host
  initialize(context: PluginExecutionContext): Promise<void>;
  
  // Called when enabled by the operator or auto-start
  start(): Promise<void>;
  
  // Audio frame processing hook (runs inside isolated worklet context)
  processAudio?(samples: Float32Array): Float32Array;
  
  // Called when disabled or during application shutdown
  stop(): Promise<void>;
}
```

---

## 3. Automation API

The Automation Engine executes actions in response to IPC events or recurring timer intervals.

### Trigger Kinds

- `EVENT`: Triggers when an internal broadcast event occurs (e.g. `broadcast.status.changed`, `recording.completed`).
- `INTERVAL`: Recurring timer specified in seconds (e.g. every 1800s for top-of-hour station ID).

### Safe Action Dispatch

All automation actions route through the same hardened Control API used by the React UI and AI assistants:

```ts
type ActionType =
  | 'START_BROADCAST'
  | 'STOP_BROADCAST'
  | 'START_RECORD'
  | 'STOP_RECORD'
  | 'PLAY_TONE'
  | 'PUSH_METADATA';
```

---

## 4. Output Abstraction Layer

The broadcast output pipeline is abstracted through `BroadcastOutputTarget`:

```ts
export interface BroadcastOutputTarget {
  id: string;
  name: string;
  type: 'shoutcast_v1' | 'shoutcast_v2' | 'icecast' | 'raw_tcp';
  server: string;
  port: number;
  mountPoint?: string;
  bitrate: number;
  codec: string;
  enabled: boolean;
}
```

This abstraction allows simultaneous multi-destination broadcasting (e.g. transmitting to a primary SHOUTcast server and a secondary Icecast backup standby stream in parallel).

---

## 5. Best Practices & Guidelines

1. **Never block the audio thread**: Offload heavy computation, network requests, or disk I/O to background workers.
2. **Explicit permissions**: Only request permissions your plugin strictly requires (`audio_process`, `metadata_write`, `network_out`).
3. **Graceful degradation**: Handle network disconnects internally without throwing unhandled exceptions.
