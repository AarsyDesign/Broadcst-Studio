import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateManifest,
  verifyCommandAuthorization,
  checkPluginPermission,
  PLUGIN_API_VERSION,
} from '../src/index.ts';

test('Manifest Validation: valid official manifest passes', () => {
  const sample = {
    id: 'org.broadcst.example.voice-processor',
    name: 'Broadcast Voice Leveler',
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,
    author: 'Broadcst Community Examples',
    description: 'Test voice processor',
    type: 'AUDIO_PROCESSOR',
    permissions: ['audio.read', 'audio.write'],
  };

  const res = validateManifest(sample);
  assert.equal(res.valid, true);
  assert.equal(res.errors.length, 0);
  assert.equal(res.compatibility, 'SUPPORTED');
  assert.ok(res.manifest);
  assert.equal(res.manifest.id, sample.id);
});

test('Manifest Validation: rejects missing or invalid fields', () => {
  const badManifest = {
    // Missing id
    name: 'Missing ID Plugin',
    version: '1.0.0',
    apiVersion: 1,
    author: 'Author',
    description: 'Desc',
    type: 'INVALID_TYPE',
    permissions: ['invalid.permission'],
  };

  const res = validateManifest(badManifest);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes('id')));
  assert.ok(res.errors.some((e) => e.includes('type')));
  assert.ok(res.errors.some((e) => e.includes('permission')));
});

test('Manifest Validation: detects unsupported API version', () => {
  const futureManifest = {
    id: 'com.example.future-plugin',
    name: 'Future Plugin',
    version: '1.0.0',
    apiVersion: 99,
    author: 'Author',
    description: 'Desc',
    type: 'METADATA',
    permissions: ['metadata.read'],
  };

  const res = validateManifest(futureManifest);
  assert.equal(res.valid, false);
  assert.equal(res.compatibility, 'UNSUPPORTED');
  assert.ok(res.errors.some((e) => e.includes('API version')));
});

test('Permissions: enforces fail-closed default-deny authorization policy', () => {
  const metadataPluginPermissions = ['metadata.read', 'metadata.write'] as const;

  // 1. Allowed known command (known command + permission present -> ALLOW)
  const authRes = verifyCommandAuthorization('test-plugin', metadataPluginPermissions, 'broadcast.set_metadata');
  assert.equal(authRes.allowed, true);

  // 2. Denied known command (known command + permission missing -> DENY)
  const deniedKnown = verifyCommandAuthorization('test-plugin', metadataPluginPermissions, 'deck.play');
  assert.equal(deniedKnown.allowed, false);
  assert.equal(deniedKnown.requiredPermission, 'automation.execute');
  assert.ok(deniedKnown.reason?.includes('automation.execute'));

  // 3. Denied unknown command (unknown command -> DENY fail-closed)
  const deniedUnknown = verifyCommandAuthorization('test-plugin', metadataPluginPermissions, 'raw_system.exec_root');
  assert.equal(deniedUnknown.allowed, false);
  assert.equal(deniedUnknown.requiredPermission, undefined);
  assert.ok(deniedUnknown.reason?.includes('Unknown or unsupported command'));

  // 4. Direct check helper
  assert.equal(checkPluginPermission(metadataPluginPermissions, 'metadata.write'), true);
  assert.equal(checkPluginPermission(metadataPluginPermissions, 'audio.write'), false);
});

test('Execution Domain: distinguishes Domain A realtime from Domain B non-realtime', async () => {
  const { getExecutionDomain } = await import('../src/index.ts');
  assert.equal(getExecutionDomain('AUDIO_PROCESSOR'), 'REALTIME_AUDIO');
  assert.equal(getExecutionDomain('METADATA'), 'NON_REALTIME_ASYNC');
  assert.equal(getExecutionDomain('AUDIO_SOURCE'), 'NON_REALTIME_ASYNC');
  assert.equal(getExecutionDomain('AUTOMATION'), 'NON_REALTIME_ASYNC');
  assert.equal(getExecutionDomain('UTILITY'), 'NON_REALTIME_ASYNC');
});

test('Package Loader: validates plugin package boundary', async () => {
  const { validatePluginPackage, PLUGIN_API_VERSION } = await import('../src/index.ts');

  // Valid package
  const validPkg = {
    manifest: {
      id: 'org.example.pkg',
      name: 'Valid Package',
      version: '1.0.0',
      apiVersion: PLUGIN_API_VERSION,
      author: 'Tester',
      description: 'Desc',
      type: 'METADATA' as const,
      permissions: ['metadata.read' as const],
      entryPoint: 'index.js',
    },
    entryPointCode: 'export default { initialize() {} };',
  };
  const validRes = validatePluginPackage(validPkg);
  assert.equal(validRes.success, true);
  assert.ok(validRes.manifest);

  // Missing entrypoint code when entryPoint declared
  const invalidPkg = {
    manifest: validPkg.manifest,
    entryPointCode: '   ',
  };
  const invalidRes = validatePluginPackage(invalidPkg);
  assert.equal(invalidRes.success, false);
  assert.ok(invalidRes.error?.includes('entrypoint implementation code'));
});

