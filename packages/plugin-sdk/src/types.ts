/**
 * Core type declarations for the Broadcst Plugin System.
 */

export type PluginType =
  | 'AUDIO_SOURCE'
  | 'AUDIO_PROCESSOR'
  | 'OUTPUT'
  | 'METADATA'
  | 'AUTOMATION'
  | 'UTILITY';

export const ALL_PLUGIN_TYPES: readonly PluginType[] = [
  'AUDIO_SOURCE',
  'AUDIO_PROCESSOR',
  'OUTPUT',
  'METADATA',
  'AUTOMATION',
  'UTILITY',
] as const;

export type PluginPermission =
  | 'audio.read'
  | 'audio.write'
  | 'output.manage'
  | 'metadata.read'
  | 'metadata.write'
  | 'filesystem.read'
  | 'filesystem.write'
  | 'network'
  | 'automation.read'
  | 'automation.execute'
  | 'ui.contribute';

export const ALL_PLUGIN_PERMISSIONS: readonly PluginPermission[] = [
  'audio.read',
  'audio.write',
  'output.manage',
  'metadata.read',
  'metadata.write',
  'filesystem.read',
  'filesystem.write',
  'network',
  'automation.read',
  'automation.execute',
  'ui.contribute',
] as const;

export type PluginLifecycleState =
  | 'DISCOVERED'
  | 'VALIDATING'
  | 'READY'
  | 'ENABLED'
  | 'DISABLED'
  | 'ERROR'
  | 'UNINSTALLED';

export type PluginCompatibility =
  | 'SUPPORTED'
  | 'UNSUPPORTED'
  | 'DEPRECATED';

/**
 * Capability enforcement states:
 * - DECLARED: Listed in manifest; no dedicated sandbox broker API exposed yet.
 * - AVAILABLE: Scoped broker API exposed by the host.
 * - ENFORCED: Actively gated and verified before execution.
 */
export type CapabilityState = 'DECLARED' | 'AVAILABLE' | 'ENFORCED';

export interface PluginCapabilityDescriptor {
  permission: PluginPermission;
  status: CapabilityState;
  description: string;
  isScopedApiAvailable: boolean;
}

export const PERMISSION_CAPABILITY_MAP: Record<PluginPermission, PluginCapabilityDescriptor> = {
  'audio.read': {
    permission: 'audio.read',
    status: 'ENFORCED',
    description: 'Inspect realtime buffers or read master/channel audio metrics.',
    isScopedApiAvailable: true,
  },
  'audio.write': {
    permission: 'audio.write',
    status: 'ENFORCED',
    description: 'Output audio samples or command fader/gain adjustments.',
    isScopedApiAvailable: true,
  },
  'metadata.read': {
    permission: 'metadata.read',
    status: 'ENFORCED',
    description: 'Receive track metadata and station profile information.',
    isScopedApiAvailable: true,
  },
  'metadata.write': {
    permission: 'metadata.write',
    status: 'ENFORCED',
    description: 'Update on-air now-playing tags and ICY broadcast metadata.',
    isScopedApiAvailable: true,
  },
  'automation.read': {
    permission: 'automation.read',
    status: 'ENFORCED',
    description: 'Receive program clock alerts and schedule slot events.',
    isScopedApiAvailable: true,
  },
  'automation.execute': {
    permission: 'automation.execute',
    status: 'ENFORCED',
    description: 'Trigger playback queue advance, deck play/stop, or recording.',
    isScopedApiAvailable: true,
  },
  'network': {
    permission: 'network',
    status: 'DECLARED',
    description: 'External HTTP/socket syndication. Scoped proxy broker pending; direct network access is prohibited in production sandbox.',
    isScopedApiAvailable: false,
  },
  'output.manage': {
    permission: 'output.manage',
    status: 'ENFORCED',
    description: 'Configure and toggle audio stream syndication outputs (e.g. Telegram Live, RTMP).',
    isScopedApiAvailable: true,
  },
  'ui.contribute': {
    permission: 'ui.contribute',
    status: 'ENFORCED',
    description: 'Register controlled UI extension panels and actions within workstation slots.',
    isScopedApiAvailable: true,
  },
  'filesystem.read': {
    permission: 'filesystem.read',
    status: 'DECLARED',
    description: 'Access local audio assets. Scoped virtual filesystem broker pending.',
    isScopedApiAvailable: false,
  },
  'filesystem.write': {
    permission: 'filesystem.write',
    status: 'DECLARED',
    description: 'Write logs or audio exports. Scoped sandboxed directory broker pending.',
    isScopedApiAvailable: false,
  },
};

/**
 * Output connection lifecycle states.
 */
export type OutputConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR';

/**
 * Output runtime status descriptor.
 */
export interface OutputStatus {
  state: OutputConnectionState;
  uptimeSeconds: number;
  destinationName: string;
  targetEndpoint?: string;
  bitrateKbps?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Generic configuration schema for output plugins.
 */
export interface OutputPluginConfig {
  enabled: boolean;
  destinationUrl?: string;
  credentials?: Record<string, string>;
  audioSettings?: {
    bitrateKbps: number;
    format: 'MP3' | 'AAC' | 'PCM';
    sampleRate: number;
  };
  custom?: Record<string, unknown>;
}

/**
 * Available UI extension slots inside Broadcst Studio workstation shell.
 */
export type UIExtensionSlot =
  | 'OUTPUT_PANEL'
  | 'SETTINGS_PANEL'
  | 'ON_AIR_PANEL'
  | 'INSPECTOR'
  | 'TOOLBAR_ACTION';

/**
 * Host-provided context passed into plugin UI render callbacks.
 */
export interface UIExtensionContext {
  pluginId: string;
  theme: 'dark' | 'light';
  commands: {
    execute<TResult = unknown>(command: string, params?: unknown): Promise<TResult>;
  };
  state: {
    get<T = unknown>(key: string, defaultValue?: T): T | undefined;
    set<T = unknown>(key: string, value: T): void;
  };
  notifyAction: (message: string) => void;
}

/**
 * Controlled UI extension descriptor registered by a plugin.
 */
export interface UIExtensionDescriptor {
  id: string;
  pluginId: string;
  slot: UIExtensionSlot;
  title: string;
  icon?: string;
  description?: string;
  render: (context: UIExtensionContext) => unknown;
}

/**
 * Execution domains:
 * - REALTIME_AUDIO: Low-latency audio callback loop. Zero allocation, no syscalls, no blocking.
 * - NON_REALTIME_ASYNC: Event-driven and background worker execution loop.
 */
export type PluginExecutionDomain = 'REALTIME_AUDIO' | 'NON_REALTIME_ASYNC';

export function getExecutionDomain(type: PluginType): PluginExecutionDomain {
  return type === 'AUDIO_PROCESSOR' ? 'REALTIME_AUDIO' : 'NON_REALTIME_ASYNC';
}

export interface PluginError {
  code: string;
  message: string;
  timestamp: number;
  details?: unknown;
}
