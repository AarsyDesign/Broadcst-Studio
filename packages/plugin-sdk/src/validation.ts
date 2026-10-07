import { PLUGIN_API_VERSION, SUPPORTED_API_VERSIONS } from './constants';
import { PluginManifest } from './manifest';
import {
  ALL_PLUGIN_PERMISSIONS,
  ALL_PLUGIN_TYPES,
  PluginCompatibility,
  PluginPermission,
  PluginType,
} from './types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  compatibility: PluginCompatibility;
  manifest?: PluginManifest;
}

/**
 * Validates any candidate object as a Broadcst Plugin Manifest.
 * Produces structured diagnostic messages for developer feedback.
 */
export function validateManifest(candidate: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let compatibility: PluginCompatibility = 'UNSUPPORTED';

  if (!candidate || typeof candidate !== 'object') {
    return {
      valid: false,
      errors: ['Manifest must be a non-null JSON object.'],
      warnings,
      compatibility,
    };
  }

  const raw = candidate as Record<string, unknown>;

  // 1. Validate ID
  if (typeof raw.id !== 'string' || !raw.id.trim()) {
    errors.push('Manifest "id" is required and must be a non-empty string.');
  } else {
    const id = raw.id.trim();
    if (!/^[a-zA-Z0-9_.-]{3,80}$/.test(id)) {
      errors.push(
        `Manifest "id" "${id}" contains invalid characters. Use letters, numbers, hyphens, dots, or underscores (3-80 chars).`
      );
    }
  }

  // 2. Validate Name
  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    errors.push('Manifest "name" is required and must be a non-empty string.');
  }

  // 3. Validate Version
  if (typeof raw.version !== 'string' || !raw.version.trim()) {
    errors.push('Manifest "version" is required (e.g. "1.0.0").');
  }

  // 4. Validate API Version
  let parsedApiVersion: number | null = null;
  if (typeof raw.apiVersion === 'number') {
    parsedApiVersion = raw.apiVersion;
  } else if (typeof raw.apiVersion === 'string' && /^\d+$/.test(raw.apiVersion.trim())) {
    parsedApiVersion = parseInt(raw.apiVersion.trim(), 10);
  }

  if (parsedApiVersion === null) {
    errors.push('Manifest "apiVersion" must be an integer (e.g. 1 or "1").');
  } else if (parsedApiVersion === PLUGIN_API_VERSION) {
    compatibility = 'SUPPORTED';
  } else if (SUPPORTED_API_VERSIONS.includes(parsedApiVersion)) {
    compatibility = 'SUPPORTED';
  } else if (parsedApiVersion < PLUGIN_API_VERSION) {
    compatibility = 'DEPRECATED';
    warnings.push(
      `Plugin uses deprecated API version ${parsedApiVersion}. Current host API version is ${PLUGIN_API_VERSION}.`
    );
  } else {
    compatibility = 'UNSUPPORTED';
    errors.push(
      `Plugin requires API version ${parsedApiVersion}, but this host only supports API version ${PLUGIN_API_VERSION}.`
    );
  }

  // 5. Validate Type
  if (typeof raw.type !== 'string') {
    errors.push(`Manifest "type" is required. Must be one of: ${ALL_PLUGIN_TYPES.join(', ')}.`);
  } else {
    const normalizedType = raw.type.toUpperCase() as PluginType;
    if (!ALL_PLUGIN_TYPES.includes(normalizedType)) {
      errors.push(
        `Manifest "type" "${raw.type}" is invalid. Must be one of: ${ALL_PLUGIN_TYPES.join(', ')}.`
      );
    }
  }

  // 6. Validate Permissions
  const validatedPermissions: PluginPermission[] = [];
  if (!Array.isArray(raw.permissions)) {
    errors.push('Manifest "permissions" is required and must be an array of permissions.');
  } else {
    for (const perm of raw.permissions) {
      if (typeof perm !== 'string' || !ALL_PLUGIN_PERMISSIONS.includes(perm as PluginPermission)) {
        errors.push(
          `Manifest contains unrecognized permission "${String(perm)}". Valid permissions are: ${ALL_PLUGIN_PERMISSIONS.join(', ')}.`
        );
      } else {
        validatedPermissions.push(perm as PluginPermission);
      }
    }
  }

  // 7. Validate Author & Description
  if (typeof raw.author !== 'string' || !raw.author.trim()) {
    errors.push('Manifest "author" is required and must be a string.');
  }
  if (typeof raw.description !== 'string' || !raw.description.trim()) {
    errors.push('Manifest "description" is required and must be a string.');
  }

  const valid = errors.length === 0;

  let manifest: PluginManifest | undefined;
  if (valid) {
    manifest = {
      ...(raw as Record<string, unknown>),
      id: String(raw.id).trim(),
      name: String(raw.name).trim(),
      version: String(raw.version).trim(),
      apiVersion: parsedApiVersion ?? PLUGIN_API_VERSION,
      author: String(raw.author).trim(),
      description: String(raw.description).trim(),
      type: String(raw.type).toUpperCase() as PluginType,
      permissions: validatedPermissions,
      entryPoint: typeof raw.entryPoint === 'string' ? raw.entryPoint.trim() : undefined,
      homepage: typeof raw.homepage === 'string' ? raw.homepage.trim() : undefined,
      repository: typeof raw.repository === 'string' ? raw.repository.trim() : undefined,
      license: typeof raw.license === 'string' ? raw.license.trim() : undefined,
      tags: Array.isArray(raw.tags) ? raw.tags.map(String) : undefined,
    };
  }

  return {
    valid,
    errors,
    warnings,
    compatibility,
    manifest,
  };
}
