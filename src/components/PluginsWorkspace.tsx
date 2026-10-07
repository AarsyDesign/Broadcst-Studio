import React, { useState, useEffect } from 'react';
import { pluginHost } from '../services/plugin/pluginHost';
import { pluginRegistry, SamplePluginEntry } from '../services/plugin/pluginRegistry';
import {
  PluginInstance,
  PluginManifest,
  ValidationResult,
  validateManifest,
} from '../services/plugin/types';

export const PluginsWorkspace: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'installed' | 'sideload' | 'samples'>('installed');
  const [plugins, setPlugins] = useState<PluginInstance[]>(pluginHost.getPlugins());
  const [samples, setSamples] = useState<SamplePluginEntry[]>(pluginRegistry.getAvailableSamples());
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Sideload & Validation State
  const [sideloadJson, setSideloadJson] = useState<string>('');
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  // Manifest Inspector Modal
  const [inspectedManifest, setInspectedManifest] = useState<PluginManifest | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubReg = pluginRegistry.subscribe(() => {
      setPlugins(pluginHost.getPlugins());
      setSamples(pluginRegistry.getAvailableSamples());
    });

    return () => {
      unsubReg();
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Live validator on sideload JSON change
  useEffect(() => {
    if (!sideloadJson.trim()) {
      setValidationResult(null);
      return;
    }
    try {
      const parsed = JSON.parse(sideloadJson);
      const res = validateManifest(parsed);
      setValidationResult(res);
    } catch (e: any) {
      setValidationResult({
        valid: false,
        errors: [`JSON Syntax Error: ${e.message}`],
        warnings: [],
        compatibility: 'UNSUPPORTED',
      });
    }
  }, [sideloadJson]);

  const handleTogglePlugin = async (id: string, currentlyEnabled: boolean) => {
    if (currentlyEnabled) {
      const ok = await pluginRegistry.disablePlugin(id);
      showToast(ok ? `Plugin disabled: ${id}` : `Failed disabling plugin: ${id}`);
    } else {
      const ok = await pluginRegistry.enablePlugin(id);
      showToast(ok ? `Plugin enabled: ${id}` : `Failed enabling plugin: ${id}`);
    }
  };

  const handleReloadPlugin = async (id: string) => {
    await pluginRegistry.disablePlugin(id);
    const ok = await pluginRegistry.enablePlugin(id);
    showToast(ok ? `Reloaded plugin: ${id}` : `Failed reloading plugin: ${id}`);
  };

  const handleUninstall = async (id: string, name: string) => {
    const ok = await pluginRegistry.uninstallPlugin(id);
    showToast(ok ? `Uninstalled "${name}"` : `Failed uninstalling "${name}"`);
  };

  const handleInstallSample = async (id: string, name: string) => {
    const ok = await pluginRegistry.installSample(id);
    if (ok) {
      await pluginRegistry.enablePlugin(id);
      showToast(`Installed & enabled sample "${name}"`);
      setActiveSubTab('installed');
    } else {
      showToast(`Failed installing sample "${name}"`);
    }
  };

  const handleCommitSideload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validationResult || !validationResult.valid || !validationResult.manifest) {
      showToast('Cannot sideload: Please fix manifest validation errors first');
      return;
    }

    const res = await pluginRegistry.installFromManifest(validationResult.manifest);
    if (res.success) {
      showToast(`Successfully registered "${validationResult.manifest.name}"`);
      setSideloadJson('');
      setActiveSubTab('installed');
    } else {
      showToast(`Registration failed: ${res.error}`);
    }
  };

  const handleLoadTemplate = (templateType: 'processor' | 'metadata' | 'automation' | 'utility') => {
    let tpl: Partial<PluginManifest>;
    if (templateType === 'processor') {
      tpl = {
        id: 'com.developer.custom-equalizer',
        name: 'Custom Studio Equalizer',
        version: '1.0.0',
        apiVersion: 1,
        author: 'Station Audio Engineer',
        description: 'Realtime 3-band parametric tone equalization stage.',
        type: 'AUDIO_PROCESSOR',
        permissions: ['audio.read', 'audio.write'],
        entryPoint: 'index.js',
      };
    } else if (templateType === 'metadata') {
      tpl = {
        id: 'com.developer.web-now-playing',
        name: 'Station Web Now-Playing Broadcaster',
        version: '1.0.0',
        apiVersion: 1,
        author: 'Webmaster',
        description: 'Dispatches HTTP JSON payloads to station website when track changes.',
        type: 'METADATA',
        permissions: ['metadata.read', 'network'],
        entryPoint: 'index.js',
      };
    } else if (templateType === 'automation') {
      tpl = {
        id: 'com.developer.ad-break-automation',
        name: 'Commercial Pod Rotation Macro',
        version: '1.0.0',
        apiVersion: 1,
        author: 'Traffic Ops',
        description: 'Injects scheduled sponsor spots and advances program deck.',
        type: 'AUTOMATION',
        permissions: ['automation.read', 'automation.execute'],
        entryPoint: 'index.js',
      };
    } else {
      tpl = {
        id: 'com.developer.level-watchdog',
        name: 'Continuous Audio Health Watchdog',
        version: '1.0.0',
        apiVersion: 1,
        author: 'Engineering',
        description: 'Periodic background inspector for channel balance and clipped frames.',
        type: 'UTILITY',
        permissions: ['audio.read'],
        entryPoint: 'index.js',
      };
    }
    setSideloadJson(JSON.stringify(tpl, null, 2));
  };

  const PLUGIN_TYPES: { id: string; label: string }[] = [
    { id: 'all', label: 'All Extension Types' },
    { id: 'AUDIO_PROCESSOR', label: 'Audio Processor (Realtime)' },
    { id: 'AUDIO_SOURCE', label: 'Audio Source' },
    { id: 'METADATA', label: 'Metadata & Syndication' },
    { id: 'AUTOMATION', label: 'Automation & Macros' },
    { id: 'UTILITY', label: 'Utility & Diagnostics' },
  ];

  const STATUS_FILTERS: { id: string; label: string }[] = [
    { id: 'all', label: 'All Statuses' },
    { id: 'ENABLED', label: 'Enabled' },
    { id: 'DISABLED', label: 'Disabled' },
    { id: 'READY', label: 'Ready' },
    { id: 'ERROR', label: 'Error / Crashed' },
  ];

  const filteredInstalled = plugins.filter((p) => {
    if (selectedType !== 'all' && p.manifest.type !== selectedType) {
      return false;
    }
    if (selectedStatus !== 'all' && p.state !== selectedStatus) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = p.manifest.name.toLowerCase().includes(q);
      const matchDesc = p.manifest.description.toLowerCase().includes(q);
      const matchId = p.manifest.id.toLowerCase().includes(q);
      const matchAuthor = p.manifest.author.toLowerCase().includes(q);
      return matchName || matchDesc || matchId || matchAuthor;
    }
    return true;
  });

  return (
    <section
      className="ws-workspace"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        height: '100%',
        minHeight: 0,
        overflowY: 'auto',
      }}
    >
      {/* Command & Control Bar */}
      <div className="ws-command-row">
        <div>
          <div className="ws-kicker">Platform Architecture / Extensibility</div>
          <h1 className="ws-title">Broadcst Plugin Runtime</h1>
          <p className="ws-subtitle">
            Public Plugin API v1 runtime for realtime audio processors, metadata syndication, automation macros, and background utilities.
          </p>
        </div>

        <div className="ws-transport">
          <div className="ws-tabs">
            <button
              type="button"
              className="ws-tab-btn"
              data-active={activeSubTab === 'installed'}
              onClick={() => setActiveSubTab('installed')}
            >
              Installed ({plugins.length})
            </button>
            <button
              type="button"
              className="ws-tab-btn"
              data-active={activeSubTab === 'sideload'}
              onClick={() => setActiveSubTab('sideload')}
            >
              Developer Sideload
            </button>
            <button
              type="button"
              className="ws-tab-btn"
              data-active={activeSubTab === 'samples'}
              onClick={() => setActiveSubTab('samples')}
            >
              SDK Examples ({samples.length})
            </button>
          </div>

          <button
            type="button"
            className="ws-secondary-action"
            onClick={() => setActiveSubTab('sideload')}
            title="Open local plugin manifest validator and sideload wizard"
          >
            + Sideload Local Plugin
          </button>
        </div>
      </div>

      {/* Honest Architecture & Security Banner */}
      <div className="ws-banner" data-type="notice">
        <div>
          <strong style={{ display: 'block', color: 'var(--ws-text)', marginBottom: '2px', fontSize: '12px' }}>
            Current Execution Environment: In-Process Developer Runtime (API v1)
          </strong>
          <span style={{ color: 'var(--ws-muted)', fontSize: '11px', lineHeight: 1.4 }}>
            In-process execution is a developer preview and <strong>not a security sandbox</strong>. Broadcst Studio platform architecture isolates community plugins into dedicated WebAssembly / native subprocess runtimes. Realtime audio processors execute deterministic zero-allocation contracts.
          </span>
        </div>
        <span className="ws-badge" data-variant="warning">IN-PROCESS PREVIEW</span>
      </div>

      {/* SUBTAB 1: INSTALLED PLUGINS */}
      {activeSubTab === 'installed' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Filtering Toolbar */}
          <div className="ws-toolbar">
            <div className="ws-toolbar-group">
              <span className="ws-toolbar-label">Category</span>
              <select
                className="ws-select"
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
              >
                {PLUGIN_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="ws-toolbar-group">
              <span className="ws-toolbar-label">Status</span>
              <select
                className="ws-select"
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
              >
                {STATUS_FILTERS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="ws-toolbar-group" style={{ flex: 1 }}>
              <input
                type="text"
                className="ws-input"
                placeholder="Filter plugins by name, ID, author, or keywords..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {filteredInstalled.length === 0 ? (
            <div className="ws-empty">
              <div>
                <strong>No Installed Plugins Found</strong>
                <p>No extensions match your active filter. Check the SDK Examples tab or sideload a local plugin manifest.</p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              {filteredInstalled.map((p) => {
                const isRunning = p.state === 'ENABLED';
                const isError = p.state === 'ERROR';
                const isReady = p.state === 'READY';

                return (
                  <div
                    key={p.manifest.id}
                    style={{
                      padding: '14px 16px',
                      border: '1px solid var(--ws-line)',
                      borderRadius: '7px',
                      background: 'var(--ws-panel)',
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto',
                      gap: '14px',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      {/* Identity & Status Pill Row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                        <span
                          className="ws-badge"
                          data-variant={isRunning ? 'live' : isError ? 'danger' : isReady ? 'info' : 'neutral'}
                        >
                          {p.state}
                        </span>

                        <span className="ws-tag">
                          {p.manifest.type.replace('_', ' ')}
                        </span>

                        <span className="ws-tag" style={{ color: 'var(--ws-live)', fontFamily: 'var(--font-mono)' }}>
                          API v{p.manifest.apiVersion}
                        </span>

                        <span style={{ fontSize: '10px', color: 'var(--ws-subtle)', fontFamily: 'var(--font-mono)' }}>
                          v{p.manifest.version}
                        </span>

                        <span style={{ fontSize: '11px', color: 'var(--ws-muted)' }}>
                          by {p.manifest.author}
                        </span>

                        <span style={{ fontSize: '10px', color: 'var(--ws-subtle)', fontFamily: 'var(--font-mono)' }}>
                          [{p.manifest.id}]
                        </span>
                      </div>

                      {/* Title & Description */}
                      <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ws-text)' }}>
                        {p.manifest.name}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--ws-muted)', marginTop: '3px', lineHeight: 1.4 }}>
                        {p.manifest.description}
                      </div>

                      {/* Error Banner */}
                      {p.errorMessage && (
                        <div
                          style={{
                            marginTop: '8px',
                            padding: '6px 10px',
                            borderRadius: '4px',
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid var(--ws-danger)',
                            color: 'var(--ws-danger)',
                            fontSize: '11px',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          Runtime Error: {p.errorMessage}
                        </div>
                      )}

                      {/* Declared Permissions & Capabilities */}
                      <div style={{ display: 'flex', gap: '5px', marginTop: '10px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '10px', color: 'var(--ws-subtle)', alignSelf: 'center', marginRight: '4px' }}>
                          Permissions:
                        </span>
                        {p.manifest.permissions.length === 0 ? (
                          <span className="ws-tag">None (Sandboxed)</span>
                        ) : (
                          p.manifest.permissions.map((perm) => (
                            <span key={perm} className="ws-tag" style={{ color: 'var(--ws-text)' }}>
                              {perm}
                            </span>
                          ))
                        )}

                        {p.manifest.type === 'AUDIO_PROCESSOR' && (
                          <span className="ws-tag" style={{ color: 'var(--ws-live)', borderColor: 'var(--ws-live)' }}>
                            Realtime (Zero-Alloc)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Operational Action Buttons */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {isError && (
                          <button
                            type="button"
                            className="ws-secondary-action"
                            style={{ height: '30px', fontSize: '11px' }}
                            onClick={() => handleReloadPlugin(p.manifest.id)}
                            title="Retry plugin initialization"
                          >
                            Retry
                          </button>
                        )}

                        <button
                          type="button"
                          className={isRunning ? 'ws-secondary-action' : 'ws-primary-action'}
                          style={{ height: '30px', fontSize: '11px' }}
                          onClick={() => handleTogglePlugin(p.manifest.id, isRunning)}
                        >
                          {isRunning ? 'Disable' : 'Enable'}
                        </button>
                      </div>

                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="ws-mini-action"
                          onClick={() => setInspectedManifest(p.manifest)}
                          title="Inspect raw manifest JSON and capabilities"
                        >
                          Inspect
                        </button>
                        <button
                          type="button"
                          className="ws-mini-action"
                          style={{ color: 'var(--ws-danger)' }}
                          onClick={() => handleUninstall(p.manifest.id, p.manifest.name)}
                          title="Uninstall extension from runtime"
                        >
                          Uninstall
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 2: DEVELOPER SIDELOAD & DIAGNOSTICS */}
      {activeSubTab === 'sideload' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(280px, 1fr)', gap: '14px' }}>
          {/* Manifest Input Form */}
          <div
            style={{
              background: 'var(--ws-panel)',
              border: '1px solid var(--ws-line)',
              borderRadius: '7px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ws-text)' }}>
                Developer Sideload Console
              </div>
              <p style={{ fontSize: '11px', color: 'var(--ws-muted)', margin: '4px 0 0 0' }}>
                Paste or edit a Broadcst Plugin Manifest JSON. The validator will check API compatibility, permission declarations, and entry points in real-time.
              </p>
            </div>

            {/* Template Buttons */}
            <div>
              <span style={{ fontSize: '10px', color: 'var(--ws-subtle)', display: 'block', marginBottom: '6px' }}>
                Load SDK Manifest Template:
              </span>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="ws-mini-action"
                  onClick={() => handleLoadTemplate('processor')}
                >
                  Audio Processor
                </button>
                <button
                  type="button"
                  className="ws-mini-action"
                  onClick={() => handleLoadTemplate('metadata')}
                >
                  Metadata Bridge
                </button>
                <button
                  type="button"
                  className="ws-mini-action"
                  onClick={() => handleLoadTemplate('automation')}
                >
                  Automation Macro
                </button>
                <button
                  type="button"
                  className="ws-mini-action"
                  onClick={() => handleLoadTemplate('utility')}
                >
                  Silence Watchdog
                </button>
              </div>
            </div>

            <form onSubmit={handleCommitSideload} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <textarea
                className="ws-input"
                style={{
                  width: '100%',
                  height: '240px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  padding: '10px',
                  lineHeight: 1.45,
                }}
                placeholder='Paste manifest.json here...'
                value={sideloadJson}
                onChange={(e) => setSideloadJson(e.target.value)}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="ws-secondary-action"
                  onClick={() => setSideloadJson('')}
                >
                  Clear
                </button>
                <button
                  type="submit"
                  className="ws-primary-action"
                  disabled={!validationResult || !validationResult.valid}
                  title={!validationResult?.valid ? 'Resolve validation issues first' : 'Register and sideload into runtime'}
                >
                  Register & Install Plugin →
                </button>
              </div>
            </form>
          </div>

          {/* Real-time Diagnostics Inspector */}
          <div
            style={{
              background: 'var(--ws-panel)',
              border: '1px solid var(--ws-line)',
              borderRadius: '7px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ws-text)' }}>
                Validation Diagnostics
              </div>
              <p style={{ fontSize: '11px', color: 'var(--ws-muted)', margin: '4px 0 0 0' }}>
                Continuous schema validation per Broadcst Plugin API v1 specifications.
              </p>
            </div>

            {!validationResult ? (
              <div
                style={{
                  padding: '24px 16px',
                  textAlign: 'center',
                  color: 'var(--ws-muted)',
                  fontSize: '11px',
                  background: 'var(--ws-panel-2)',
                  borderRadius: '5px',
                  border: '1px dashed var(--ws-line)',
                }}
              >
                Paste a manifest on the left or select a template to inspect diagnostics.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Result Status Badges */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    className="ws-badge"
                    data-variant={validationResult.valid ? 'live' : 'danger'}
                  >
                    {validationResult.valid ? 'SCHEMA VALID' : 'VALIDATION FAILED'}
                  </span>
                  <span
                    className="ws-badge"
                    data-variant={
                      validationResult.compatibility === 'SUPPORTED'
                        ? 'live'
                        : validationResult.compatibility === 'DEPRECATED'
                        ? 'warning'
                        : 'danger'
                    }
                  >
                    API: {validationResult.compatibility}
                  </span>
                </div>

                {/* Validation Errors */}
                {validationResult.errors.length > 0 && (
                  <div
                    style={{
                      background: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid var(--ws-danger)',
                      borderRadius: '5px',
                      padding: '10px',
                    }}
                  >
                    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ws-danger)', marginBottom: '4px' }}>
                      Errors ({validationResult.errors.length}):
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '10.5px', color: 'var(--ws-text)' }}>
                      {validationResult.errors.map((err, idx) => (
                        <li key={idx} style={{ marginBottom: '2px' }}>
                          {err}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Validation Warnings */}
                {validationResult.warnings.length > 0 && (
                  <div
                    style={{
                      background: 'rgba(245, 158, 11, 0.08)',
                      border: '1px solid var(--ws-warning)',
                      borderRadius: '5px',
                      padding: '10px',
                    }}
                  >
                    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ws-warning)', marginBottom: '4px' }}>
                      Warnings ({validationResult.warnings.length}):
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '10.5px', color: 'var(--ws-text)' }}>
                      {validationResult.warnings.map((warn, idx) => (
                        <li key={idx}>{warn}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Parsed Summary Card if Valid */}
                {validationResult.valid && validationResult.manifest && (
                  <div
                    style={{
                      background: 'var(--ws-panel-2)',
                      border: '1px solid var(--ws-line)',
                      borderRadius: '5px',
                      padding: '10px',
                      fontSize: '11px',
                    }}
                  >
                    <div style={{ fontWeight: 700, color: 'var(--ws-text)', marginBottom: '6px' }}>
                      Parsed Extension Profile
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '4px', color: 'var(--ws-muted)' }}>
                      <span>Identifier:</span>
                      <strong style={{ color: 'var(--ws-text)', fontFamily: 'var(--font-mono)' }}>
                        {validationResult.manifest.id}
                      </strong>
                      <span>Type:</span>
                      <strong style={{ color: 'var(--ws-text)' }}>{validationResult.manifest.type}</strong>
                      <span>API Version:</span>
                      <strong style={{ color: 'var(--ws-live)' }}>v{validationResult.manifest.apiVersion}</strong>
                      <span>Entrypoint:</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>
                        {validationResult.manifest.entryPoint || 'index.js (default)'}
                      </span>
                    </div>

                    <div style={{ marginTop: '8px' }}>
                      <span style={{ color: 'var(--ws-subtle)', display: 'block', marginBottom: '4px' }}>
                        Required Permissions:
                      </span>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {validationResult.manifest.permissions.map((p) => (
                          <span key={p} className="ws-tag">
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUBTAB 3: SDK EXAMPLES */}
      {activeSubTab === 'samples' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '12px' }}>
          {samples.map((sample) => {
            const isInstalled = plugins.some((p) => p.manifest.id === sample.manifest.id);

            return (
              <div
                key={sample.manifest.id}
                style={{
                  padding: '14px 16px',
                  border: '1px solid var(--ws-line)',
                  borderRadius: '7px',
                  background: 'var(--ws-panel)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span className="ws-tag">
                      {sample.manifest.type.replace('_', ' ')}
                    </span>
                    <span className="ws-badge" data-variant="live">
                      OFFICIAL SDK SAMPLE
                    </span>
                  </div>

                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ws-text)' }}>
                    {sample.manifest.name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--ws-muted)', marginTop: '2px' }}>
                    by {sample.manifest.author} • v{sample.manifest.version}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--ws-text)', marginTop: '6px', lineHeight: 1.45 }}>
                    {sample.manifest.description}
                  </div>

                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '10px' }}>
                    {sample.manifest.permissions.map((p) => (
                      <span key={p} className="ws-tag">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', borderTop: '1px solid var(--ws-line)', paddingTop: '10px' }}>
                  {isInstalled ? (
                    <button
                      type="button"
                      className="ws-secondary-action"
                      style={{ height: '28px', fontSize: '10px' }}
                      onClick={() => setActiveSubTab('installed')}
                    >
                      Manage in Installed →
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ws-primary-action"
                      style={{ height: '28px', fontSize: '10px' }}
                      onClick={() => handleInstallSample(sample.manifest.id, sample.manifest.name)}
                    >
                      Install & Activate
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Manifest Inspection Modal */}
      {inspectedManifest && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: 'min(580px, 92vw)',
              background: 'var(--ws-panel)',
              border: '1px solid var(--ws-line)',
              borderRadius: '8px',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>
                  Manifest Inspector: {inspectedManifest.name}
                </h3>
                <span style={{ fontSize: '10px', color: 'var(--ws-muted)', fontFamily: 'var(--font-mono)' }}>
                  ID: {inspectedManifest.id}
                </span>
              </div>
              <button
                type="button"
                className="ws-mini-action"
                onClick={() => setInspectedManifest(null)}
              >
                ✕
              </button>
            </div>

            <pre
              style={{
                margin: 0,
                background: 'var(--ws-panel-2)',
                border: '1px solid var(--ws-line)',
                borderRadius: '5px',
                padding: '12px',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                maxHeight: '360px',
                overflowY: 'auto',
                color: 'var(--ws-text)',
              }}
            >
              {JSON.stringify(inspectedManifest, null, 2)}
            </pre>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="ws-secondary-action"
                onClick={() => setInspectedManifest(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMessage && <div className="ws-toast">{toastMessage}</div>}
    </section>
  );
};
