/**
 * Core type declarations for the Broadcst Plugin System.
 */

export type PluginType =
  | 'AUDIO_SOURCE'
  | 'AUDIO_PROCESSOR'
  | 'METADATA'
  | 'AUTOMATION'
  | 'UTILITY';

export const ALL_PLUGIN_TYPES: readonly PluginType[] = [
  'AUDIO_SOURCE',
  'AUDIO_PROCESSOR',
  'METADATA',
  'AUTOMATION',
  'UTILITY',
] as const;

export type PluginPermission =
  | 'audio.read'
  | 'audio.write'
  | 'metadata.read'
  | 'metadata.write'
  | 'filesystem.read'
  | 'filesystem.write'
  | 'network'
  | 'automation.read'
  | 'automation.execute';

export const ALL_PLUGIN_PERMISSIONS: readonly PluginPermission[] = [
  'audio.read',
  'audio.write',
  'metadata.read',
  'metadata.write',
  'filesystem.read',
  'filesystem.write',
  'network',
  'automation.read',
  'automation.execute',
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

export interface PluginError {
  code: string;
  message: string;
  timestamp: number;
  details?: unknown;
}
