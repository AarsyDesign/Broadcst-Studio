export type PluginCategory =
  | 'audio_effect'
  | 'audio_source'
  | 'output'
  | 'metadata'
  | 'automation'
  | 'transcript'
  | 'utility';

export type PluginPermission =
  | 'audio_process'
  | 'metadata_read'
  | 'metadata_write'
  | 'network_out'
  | 'storage';

export type PluginLifecycleStatus =
  | 'STOPPED'
  | 'STARTING'
  | 'RUNNING'
  | 'ERROR'
  | 'CRASHED';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: PluginCategory;
  permissions: PluginPermission[];
  homepage?: string;
  entryPoint?: string;
}

export interface PluginInstance {
  manifest: PluginManifest;
  status: PluginLifecycleStatus;
  enabled: boolean;
  errorMessage?: string;
  lastExecutionMs?: number;
  /** In-process prototype simulation status vs isolated native worker */
  runtimeMode: 'in_process_prototype' | 'isolated_worker';
}

export interface PluginExecutionContext {
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
  getBroadcastState: () => string;
  getAudioMetrics: () => { peakDb: number; rmsDb: number };
  pushMetadata: (title: string, artist: string) => void;
}
