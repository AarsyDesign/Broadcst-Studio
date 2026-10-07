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

test('Permissions: enforces command authorization policy', () => {
  const metadataPluginPermissions = ['metadata.read', 'metadata.write'] as const;

  // 1. Authorized command
  const authRes = verifyCommandAuthorization('test-plugin', metadataPluginPermissions, 'broadcast.set_metadata');
  assert.equal(authRes.allowed, true);

  // 2. Unauthorized command (requires automation.execute)
  const unauthRes = verifyCommandAuthorization('test-plugin', metadataPluginPermissions, 'deck.play');
  assert.equal(unauthRes.allowed, false);
  assert.equal(unauthRes.requiredPermission, 'automation.execute');
  assert.ok(unauthRes.reason?.includes('automation.execute'));

  // 3. Direct check helper
  assert.equal(checkPluginPermission(metadataPluginPermissions, 'metadata.write'), true);
  assert.equal(checkPluginPermission(metadataPluginPermissions, 'audio.write'), false);
});
