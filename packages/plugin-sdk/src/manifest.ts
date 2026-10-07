import { PluginPermission, PluginType } from './types';

/**
 * Manifest format for Broadcst Studio plugins.
 * Forward-compatible: unknown additional properties are preserved.
 */
export interface PluginManifest {
  /** Unique plugin identifier (reverse-domain or kebab-case, e.g. "com.example.processor") */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Semantic version string (e.g. "1.0.0") */
  version: string;
  /** Target Broadcst Plugin API version (e.g. 1 or "1") */
  apiVersion: number | string;
  /** Author or development team */
  author: string;
  /** Purpose and description of the plugin */
  description: string;
  /** Primary plugin category / architectural domain */
  type: PluginType;
  /** Declared permission capabilities requested by this plugin */
  permissions: PluginPermission[];
  /** Optional entrypoint file path relative to plugin root (e.g. "index.js") */
  entryPoint?: string;
  /** Optional project website */
  homepage?: string;
  /** Optional source code repository */
  repository?: string;
  /** Optional license (e.g. "MIT", "Apache-2.0") */
  license?: string;
  /** Optional search and categorisation tags */
  tags?: string[];
  /** Optional minimum host application version required */
  minHostVersion?: string;
  /** Optional JSON-schema or configuration fields declaration */
  configSchema?: Record<string, unknown>;
  /** Forward compatibility for future host extensions */
  [key: string]: unknown;
}
