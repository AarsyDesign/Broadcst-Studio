import { PluginManifest } from './manifest';
import { validateManifest, ValidationResult } from './validation';

/**
 * Registration source distinction:
 * - DEV_DIRECT_REGISTRATION: Direct developer in-memory injection of manifest + code object.
 * - PLUGIN_PACKAGE: Structured .bcsplugin package containing verified manifest, entrypoint, and assets.
 */
export type PluginRegistrationSource =
  | 'DEV_DIRECT_REGISTRATION'
  | 'PLUGIN_PACKAGE';

/**
 * Structure of a Broadcst Studio plugin package (.bcsplugin or directory).
 */
export interface PluginPackage {
  /** Package format specification version */
  readonly formatVersion: number;
  /** Verified manifest declaration */
  readonly manifest: PluginManifest;
  /** Compiled/bundled entrypoint runtime source code */
  readonly entryPointCode?: string;
  /** Actual filename of the entrypoint file in the package (e.g. index.tsx) */
  readonly entryPointFilename?: string;
  /** Package file hierarchy mapping relative path to source content */
  readonly files?: Record<string, string>;
  /** Optional packaged assets (icons, stylesheets, models) */
  readonly assets?: Record<string, string>;
  /** Optional documentation markdown */
  readonly readme?: string;
}

export interface PackageLoadResult {
  success: boolean;
  source: PluginRegistrationSource;
  manifest?: PluginManifest;
  validation?: ValidationResult;
  error?: string;
}

/**
 * Interface for loading and preparing plugin packages for the host runtime.
 */
export interface PluginPackageLoader {
  /**
   * Validates and loads a plugin package candidate.
   */
  loadPackage(candidate: unknown): Promise<PackageLoadResult>;

  /**
   * Registers a direct developer in-memory instance without package archive unpacking.
   */
  loadDevDirect(manifestCandidate: unknown): Promise<PackageLoadResult>;
}

export const CURRENT_PACKAGE_FORMAT_VERSION = 1;

/**
 * Validates a plugin package structure and its embedded manifest.
 */
export function validatePluginPackage(candidate: unknown): PackageLoadResult {
  if (!candidate || typeof candidate !== 'object') {
    return {
      success: false,
      source: 'PLUGIN_PACKAGE',
      error: 'Package candidate must be a non-null object.',
    };
  }

  const raw = candidate as Record<string, unknown>;
  const manifestCandidate = raw.manifest;

  if (!manifestCandidate) {
    return {
      success: false,
      source: 'PLUGIN_PACKAGE',
      error: 'Package is missing required "manifest" declaration.',
    };
  }

  const val = validateManifest(manifestCandidate);
  if (!val.valid || !val.manifest) {
    return {
      success: false,
      source: 'PLUGIN_PACKAGE',
      validation: val,
      error: `Package manifest validation failed: ${val.errors.join('; ')}`,
    };
  }

  // If manifest declares an entrypoint, verify code payload is present
  if (val.manifest.entryPoint) {
    const code = raw.entryPointCode;
    if (typeof code !== 'string' || code.trim().length === 0) {
      return {
        success: false,
        source: 'PLUGIN_PACKAGE',
        manifest: val.manifest,
        validation: val,
        error: 'Package declares entryPoint but provides no valid entrypoint implementation code.',
      };
    }

    // Verify declared entryPoint matches package entryPointFilename if provided
    if (typeof raw.entryPointFilename === 'string') {
      const filename = raw.entryPointFilename.trim();
      if (filename && filename !== val.manifest.entryPoint) {
        return {
          success: false,
          source: 'PLUGIN_PACKAGE',
          manifest: val.manifest,
          validation: val,
          error: `Package entrypoint mismatch: manifest declares "${val.manifest.entryPoint}" but package entrypoint file is "${filename}".`,
        };
      }
    }

    // Verify declared entryPoint exists in files dictionary if provided
    if (raw.files && typeof raw.files === 'object') {
      const filesMap = raw.files as Record<string, unknown>;
      if (!filesMap[val.manifest.entryPoint]) {
        return {
          success: false,
          source: 'PLUGIN_PACKAGE',
          manifest: val.manifest,
          validation: val,
          error: `Package entrypoint file "${val.manifest.entryPoint}" was not found in package files.`,
        };
      }
    }
  }

  return {
    success: true,
    source: 'PLUGIN_PACKAGE',
    manifest: val.manifest,
    validation: val,
  };
}
