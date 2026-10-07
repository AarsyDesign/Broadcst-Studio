import { PluginEventListener, PluginEventMap, PluginEventName } from './events';
import { PluginManifest } from './manifest';
import { UIExtensionDescriptor } from './types';

export interface PluginLogger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export interface PluginEventBus {
  on<E extends PluginEventName>(event: E, listener: PluginEventListener<E>): () => void;
  emit?<E extends PluginEventName>(event: E, payload: PluginEventMap[E]): void;
}

export interface PluginCommandExecutor {
  execute<TResult = unknown>(command: string, params?: unknown): Promise<TResult>;
}

/**
 * Controlled UI registration interface for plugins.
 * Plugins contribute UI descriptors without direct DOM or React tree access.
 */
export interface PluginUIController {
  registerPanel(descriptor: Omit<UIExtensionDescriptor, 'pluginId'>): () => void;
  getRegistrations(): UIExtensionDescriptor[];
}

/**
 * Plugin state store interface.
 * CURRENT RUNTIME: Session in-memory store (volatile; resets upon process restart).
 * FUTURE RUNTIME: Replaceable interface backed by durable isolated SQLite/IndexedDB partitions.
 */
export interface PluginStateStore {
  get<T = unknown>(key: string, defaultValue?: T): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  delete(key: string): void;
  clear(): void;
}

export interface AudioMetricsReadout {
  peakDb: number;
  rmsDb: number;
  isClipping: boolean;
}

/**
 * Public execution context provided to plugins by the host.
 * All operations are scoped, strictly isolated, and subject to fail-closed permission verification.
 * Plugins NEVER receive raw access to AppState, audioEngine, or direct Tauri IPC.
 */
export interface PluginContext {
  /** Manifest declaring this plugin's identity and capabilities */
  readonly manifest: Readonly<PluginManifest>;
  /** Scoped logging facility */
  readonly logger: PluginLogger;
  /** Safe application event subscription (automatically isolated and torn down on disable) */
  readonly events: PluginEventBus;
  /** Controlled command execution (gated by default-deny permission policy) */
  readonly commands: PluginCommandExecutor;
  /**
   * Scoped session state store.
   * NOTE: Current host implementation provides in-memory session state.
   */
  readonly state: PluginStateStore;
  /** Controlled UI extension registrar (requires 'ui.contribute' permission) */
  readonly ui?: PluginUIController;
  /** Current station audio metrics (available if 'audio.read' permission granted) */
  getAudioMetrics?(): AudioMetricsReadout;
}
