/**
 * Broadcst Studio Host Plugin Types
 * Re-exports public SDK types and defines internal host runtime interfaces.
 */

export * from '../../../packages/plugin-sdk/src';

import {
  Plugin,
  PluginCompatibility,
  PluginLifecycleState,
  PluginManifest,
} from '../../../packages/plugin-sdk/src';

/**
 * Host-managed runtime instance for an installed plugin.
 */
export interface PluginInstance {
  manifest: PluginManifest;
  state: PluginLifecycleState;
  compatibility: PluginCompatibility;
  enabled: boolean;
  plugin?: Plugin;
  errorMessage?: string;
  lastExecutionMs?: number;
  installedAt: number;
  validationWarnings?: string[];
  /** Honest architecture flag: current in-process execution vs future isolated worker */
  runtimeMode: 'in_process_prototype' | 'isolated_worker';
}

/**
 * Package metadata for a local .bcsplugin archive or directory.
 */
export interface PluginPackageMetadata {
  manifest: PluginManifest;
  packageFormatVersion: number;
  entryPointCode?: string;
  sourceDirectory?: string;
}
