import { PluginContext } from './context';
import { TrackChangedEvent } from './events';
import { PluginManifest } from './manifest';
import { OutputPluginConfig, OutputStatus } from './types';

/**
 * Base lifecycle contract for all Broadcst Studio plugins.
 */
export interface Plugin<_TConfig = Record<string, unknown>> {
  /** The plugin manifest declaration */
  readonly manifest: PluginManifest;

  /**
   * Called once when the plugin is loaded and verified by the host.
   * Plugin should store the context, read initial configuration, and bind event handlers.
   */
  initialize?(context: PluginContext): Promise<void> | void;

  /**
   * Called when the plugin is enabled / started by the operator or host.
   */
  start?(): Promise<void> | void;

  /**
   * Called when the plugin is disabled / stopped.
   * Must stop any background timers or intervals.
   */
  stop?(): Promise<void> | void;

  /**
   * Called before the plugin is uninstalled or disposed.
   * Free all allocated resources and close connections.
   */
  dispose?(): Promise<void> | void;
}

/**
 * REALTIME AUDIO PROCESSOR CONTRACT (DOMAIN A: REALTIME)
 *
 * ARCHITECTURAL STATUS: CONTRACT / PROTOTYPE SPECIFICATION ONLY.
 * In Broadcst Studio, realtime audio processing is NOT routed through the React/UI thread.
 * This TypeScript interface defines the formal API contract for plugin authors.
 * In the target architecture, realtime audio plugins compile to WebAssembly or native
 * shared libraries executing directly within the low-latency CPAL summing pipeline.
 *
 * CRITICAL REALTIME RESTRICTIONS:
 * 1. Must execute deterministically within the audio callback deadline (e.g. < 5.3ms for 256 samples @ 48kHz).
 * 2. NEVER perform blocking syscalls, thread sleeps, or lock contention.
 * 3. NEVER perform filesystem I/O (no fs read/write).
 * 4. NEVER perform network requests (no fetch/http/socket).
 * 5. NEVER allocate heap memory during process() (no 'new Float32Array', preallocate buffers in initialize()).
 * 6. NEVER invoke UI threads or AI APIs inside process().
 */
export interface AudioProcessorPlugin extends Plugin {
  readonly manifest: PluginManifest & { type: 'AUDIO_PROCESSOR' };

  /**
   * Process incoming planar/channelized audio frames.
   *
   * @param inputBuffer Array of Float32Array channel buffers (e.g. inputBuffer[0] = Left, inputBuffer[1] = Right)
   * @param outputBuffer Array of Float32Array channel buffers to populate
   * @param sampleRate Sampling rate in Hz (canonical: 48000)
   * @param channels Channel count (canonical: 2)
   * @param frameCount Number of samples per channel in this frame
   */
  process(
    inputBuffer: Float32Array[],
    outputBuffer: Float32Array[],
    sampleRate: number,
    channels: number,
    frameCount: number
  ): void;
}

/**
 * AUDIO SOURCE PLUGIN CONTRACT
 * Provides dynamic audio files, podcast downloads, or streaming source URIs.
 */
export interface AudioSourcePlugin extends Plugin {
  readonly manifest: PluginManifest & { type: 'AUDIO_SOURCE' };

  /** Request the next rotated or fetched audio track */
  getNextTrack?(): Promise<{ filePath: string; title: string; artist: string; durationMs?: number } | null>;

  /** Obtain active streaming relay or network source URI */
  getStreamUri?(): Promise<string | null>;
}

/**
 * OUTPUT PLUGIN CONTRACT (DOMAIN B: NON-REALTIME ASYNC HOST BOUNDARY)
 *
 * Provides external audio syndication destinations (Telegram Live, RTMP, YouTube, Discord, Twitch).
 *
 * ARCHITECTURAL BOUNDARY:
 * Native SHOUTcast remains the primary C/Rust low-latency output.
 * Output plugins handle connection lifecycle, metadata updates, status reporting,
 * and user-facing controls.
 * Future native target: Rust master audio -> native-safe ringbuffer -> output plugin streaming pipeline.
 */
export interface OutputPlugin<TConfig = OutputPluginConfig> extends Plugin {
  readonly manifest: PluginManifest & { type: 'OUTPUT' };

  /**
   * Starts output stream transmission to destination with given configuration.
   */
  startOutput?(config?: TConfig): Promise<boolean> | boolean;

  /**
   * Stops active stream transmission.
   */
  stopOutput?(): Promise<boolean> | boolean;

  /**
   * Returns current honest runtime connection status and telemetry.
   */
  getOutputStatus(): OutputStatus;

  /**
   * Updates stream metadata (e.g. now playing track title/artist).
   */
  updateMetadata?(metadata: { title: string; artist: string; album?: string }): Promise<void> | void;
}


/**
 * METADATA PLUGIN CONTRACT
 * Handles external now-playing syndication, RDS encoders, website widgets, and server updates.
 */
export interface MetadataPlugin extends Plugin {
  readonly manifest: PluginManifest & { type: 'METADATA' };

  /** Triggered on track change event */
  onTrackChanged?(event: TrackChangedEvent): Promise<void> | void;

  /** Polled or requested by station profile for external track info */
  fetchExternalMetadata?(): Promise<{ title: string; artist: string; album?: string } | null>;
}

/**
 * AUTOMATION PLUGIN CONTRACT
 * Executes programmatic rules, station ID jingles, time checks, and rotation macros.
 */
export interface AutomationPlugin extends Plugin {
  readonly manifest: PluginManifest & { type: 'AUTOMATION' };

  /** Handles an arbitrary trigger event or macro action */
  onTrigger?(eventName: string, payload?: unknown): Promise<void> | void;

  /** Triggered when a scheduled program slot begins */
  onScheduleSlot?(slotId: string, slotTitle: string): Promise<void> | void;
}

/**
 * UTILITY PLUGIN CONTRACT
 * Background diagnostic tools, silence monitors, compliance radar, and health checkers.
 */
export interface UtilityPlugin extends Plugin {
  readonly manifest: PluginManifest & { type: 'UTILITY' };

  /** Periodic execution tick called by host timer (e.g. every 1-5 seconds) */
  tick?(context: PluginContext): Promise<void> | void;
}

/**
 * Type-safe helper to define a Broadcst Studio plugin with full autocomplete.
 */
export function definePlugin<T extends Plugin>(plugin: T): T {
  return plugin;
}
