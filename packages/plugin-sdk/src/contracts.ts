import { PluginContext } from './context';
import { TrackChangedEvent } from './events';
import { PluginManifest } from './manifest';

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
 * REALTIME AUDIO PROCESSOR CONTRACT
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
