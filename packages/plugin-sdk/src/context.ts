import { PluginEventListener, PluginEventMap, PluginEventName } from './events';
import { PluginManifest } from './manifest';

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
 * All operations are scoped and subject to permission verification.
 */
export interface PluginContext {
  /** Manifest declaring this plugin's identity and capabilities */
  readonly manifest: Readonly<PluginManifest>;
  /** Scoped logging facility */
  readonly logger: PluginLogger;
  /** Safe application event subscription */
  readonly events: PluginEventBus;
  /** Controlled command execution (gated by declared permissions) */
  readonly commands: PluginCommandExecutor;
  /** Local persistent state store */
  readonly state: PluginStateStore;
  /** Current station audio metrics (available if 'audio.read' permission granted) */
  getAudioMetrics?(): AudioMetricsReadout;
}
