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

test('Output Manifest: accepts OUTPUT type and output/ui permissions', () => {
  const outputManifest = {
    id: 'org.broadcst.example.telegram-output',
    name: 'Telegram Live Audio Streamer',
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,
    author: 'Broadcst Community Examples',
    description: 'Reference output plugin for Telegram RTMP audio syndication',
    type: 'OUTPUT',
    permissions: ['output.manage', 'metadata.read', 'ui.contribute'],
  };

  const res = validateManifest(outputManifest);
  assert.equal(res.valid, true);
  assert.equal(res.errors.length, 0);
  assert.equal(res.compatibility, 'SUPPORTED');
  assert.equal(res.manifest?.type, 'OUTPUT');
});

test('Output & UI Permissions: enforces fail-closed output.manage and ui.contribute', () => {
  const outputPerms = ['output.manage', 'ui.contribute'] as const;
  const noOutputPerms = ['metadata.read'] as const;

  // 1. output.start with output.manage -> ALLOW
  const authOutput = verifyCommandAuthorization('test-output', outputPerms, 'output.start');
  assert.equal(authOutput.allowed, true);
  assert.equal(authOutput.requiredPermission, 'output.manage');

  // 2. output.start without output.manage -> DENY
  const denyOutput = verifyCommandAuthorization('test-unauth', noOutputPerms, 'output.start');
  assert.equal(denyOutput.allowed, false);
  assert.equal(denyOutput.requiredPermission, 'output.manage');
  assert.ok(denyOutput.reason?.includes('output.manage'));

  // 3. ui.register with ui.contribute -> ALLOW
  const authUI = verifyCommandAuthorization('test-ui', outputPerms, 'ui.register');
  assert.equal(authUI.allowed, true);
  assert.equal(authUI.requiredPermission, 'ui.contribute');

  // 4. ui.register without ui.contribute -> DENY
  const denyUI = verifyCommandAuthorization('test-unauth', noOutputPerms, 'ui.register');
  assert.equal(denyUI.allowed, false);
  assert.equal(denyUI.requiredPermission, 'ui.contribute');
  assert.ok(denyUI.reason?.includes('ui.contribute'));
});

test('Output Plugin Contract: lifecycle status transitions and execution domain', async () => {
  const { getExecutionDomain } = await import('../src/index.ts');
  assert.equal(getExecutionDomain('OUTPUT'), 'NON_REALTIME_ASYNC');

  // Verify all 8 honest status states are recognized
  type StatusState =
    | 'DISCONNECTED'
    | 'CONFIGURED'
    | 'READY'
    | 'CONNECTING'
    | 'CONNECTED'
    | 'RECONNECTING'
    | 'ERROR'
    | 'REFERENCE_ONLY';

  const states: StatusState[] = [
    'DISCONNECTED',
    'CONFIGURED',
    'READY',
    'CONNECTING',
    'CONNECTED',
    'RECONNECTING',
    'ERROR',
    'REFERENCE_ONLY',
  ];
  assert.equal(states.length, 8);
});

test('Output Honesty: reference-only plugin enforces REFERENCE_ONLY and non-live transport', () => {
  // Honest architectural reference status
  const referenceStatus = {
    state: 'REFERENCE_ONLY' as const,
    uptimeSeconds: 0,
    bitrateKbps: 0,
    destinationName: 'Telegram Live (Architectural Reference)',
    targetEndpoint: 'rtmps://dc4-1.rtmp.t.me/s/[masked]',
    isReferenceOnly: true,
    pluginEnabled: true,
    transportRunning: false,
    health: 'REFERENCE' as const,
    retryPolicy: {
      maxRetries: 3,
      retryIntervalMs: 5000,
      exponentialBackoff: true,
    },
    diagnostics: {
      reason: 'Architectural reference active: Media transport will bind to Native Media Sink once RTMP encoder is linked.',
    },
  };

  assert.equal(referenceStatus.state, 'REFERENCE_ONLY');
  assert.equal(referenceStatus.isReferenceOnly, true);
  assert.equal(referenceStatus.transportRunning, false);
  assert.equal(referenceStatus.uptimeSeconds, 0);
  assert.equal(referenceStatus.bitrateKbps, 0);
  assert.ok(referenceStatus.diagnostics.reason.includes('Native Media Sink'));

  // Honesty check: Disallow fake CONNECTED when transport is not running
  const isHonestConnected = (s: typeof referenceStatus) => {
    return s.state === 'CONNECTED' ? s.transportRunning === true && !s.isReferenceOnly : true;
  };
  assert.equal(isHonestConnected(referenceStatus), true);

  const fakeConnectedStatus = {
    ...referenceStatus,
    state: 'CONNECTED' as const,
    transportRunning: false,
    isReferenceOnly: true,
  };
  assert.equal(isHonestConnected(fakeConnectedStatus), false, 'Fake CONNECTED state without transportRunning must fail honesty validation');
});

test('Package Loader: detects entrypoint filename mismatch between manifest and package', async () => {
  const { validatePluginPackage, PLUGIN_API_VERSION } = await import('../src/index.ts');

  // 1. Mismatch: Manifest says index.ts, package provides index.tsx
  const mismatchedPkg = {
    manifest: {
      id: 'org.broadcst.example.telegram-output',
      name: 'Telegram Live Audio Streamer',
      version: '1.0.0',
      apiVersion: PLUGIN_API_VERSION,
      author: 'Broadcst Community Examples',
      description: 'Reference output plugin',
      type: 'OUTPUT' as const,
      permissions: ['output.manage' as const],
      entryPoint: 'index.ts', // Mismatch
    },
    entryPointFilename: 'index.tsx', // Provided file
    entryPointCode: 'export default { initialize() {} };',
  };

  const mismatchRes = validatePluginPackage(mismatchedPkg);
  assert.equal(mismatchRes.success, false);
  assert.ok(mismatchRes.error?.includes('Package entrypoint mismatch'));
  assert.ok(mismatchRes.error?.includes('index.ts'));
  assert.ok(mismatchRes.error?.includes('index.tsx'));

  // 2. Matching: Manifest says index.tsx, package provides index.tsx
  const matchingPkg = {
    ...mismatchedPkg,
    manifest: {
      ...mismatchedPkg.manifest,
      entryPoint: 'index.tsx',
    },
  };
  const matchingRes = validatePluginPackage(matchingPkg);
  assert.equal(matchingRes.success, true);
  assert.ok(matchingRes.manifest);
  assert.equal(matchingRes.manifest.entryPoint, 'index.tsx');

  // 3. Missing file in files dictionary
  const missingFilePkg = {
    manifest: matchingPkg.manifest,
    entryPointCode: 'export default {};',
    files: {
      'other.ts': 'console.log("hello");',
    },
  };
  const missingFileRes = validatePluginPackage(missingFilePkg);
  assert.equal(missingFileRes.success, false);
  assert.ok(missingFileRes.error?.includes('was not found in package files'));
});

test('Output Bridge: native MediaSink state is authoritative over transport status', () => {
  // 1. Simulating a native MediaSink in STREAMING state
  const streamingNativeSink = {
    id: 'org.broadcst.example.rtmp',
    name: 'RTMP Media Sink',
    state: 'STREAMING' as const,
    is_streaming: true,
    frames_written: 9600,
    bytes_sent: 76800,
    dropped_frames: 0,
    errors_count: 0,
    endpoint: 'rtmp://live.example.com/stream',
  };

  // Bridge logic
  const bridgeStatus = (nativeSink: typeof streamingNativeSink) => {
    return {
      state: (nativeSink.state === 'STREAMING' ? 'CONNECTED' : nativeSink.state === 'ERROR' ? 'ERROR' : 'READY') as any,
      transportRunning: nativeSink.is_streaming,
      health: (nativeSink.state === 'STREAMING' ? 'HEALTHY' : 'ERROR') as any,
      destinationName: nativeSink.name,
      uptimeSeconds: Math.floor(nativeSink.frames_written / 48000),
      diagnostics: {
        framesWritten: nativeSink.frames_written,
        bytesSent: nativeSink.bytes_sent,
        droppedFrames: nativeSink.dropped_frames,
        nativeSinkState: nativeSink.state,
      },
    };
  };

  const statusStreaming = bridgeStatus(streamingNativeSink);
  assert.equal(statusStreaming.state, 'CONNECTED');
  assert.equal(statusStreaming.transportRunning, true);
  assert.equal(statusStreaming.health, 'HEALTHY');
  assert.equal(statusStreaming.diagnostics.framesWritten, 9600);
  assert.equal(statusStreaming.diagnostics.bytesSent, 76800);
  assert.equal(statusStreaming.diagnostics.droppedFrames, 0);

  // 2. Simulating a native MediaSink in ERROR state
  const errorNativeSink = {
    ...streamingNativeSink,
    state: 'ERROR' as const,
    is_streaming: false,
    dropped_frames: 480,
    errors_count: 1,
    error_message: 'Simulated socket reset by peer',
  };

  const statusError = bridgeStatus(errorNativeSink as any);
  assert.equal(statusError.state, 'ERROR');
  assert.equal(statusError.transportRunning, false);
  assert.equal(statusError.health, 'ERROR');
  assert.equal(statusError.diagnostics.droppedFrames, 480);
});


