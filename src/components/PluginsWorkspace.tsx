import React, { useState, useEffect } from 'react';
import { pluginHost } from '../services/plugin/pluginHost';
import { pluginRegistry, RegistryPluginItem } from '../services/plugin/pluginRegistry';
import type { PluginInstance, PluginManifest } from '../services/plugin/types';

export const PluginsWorkspace: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'installed' | 'registry'>('installed');
  const [plugins, setPlugins] = useState<PluginInstance[]>(pluginHost.getPlugins());
  const [catalog, setCatalog] = useState<RegistryPluginItem[]>(pluginRegistry.getCatalog());
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Import / Sideload Modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubHost = pluginHost.subscribe((list) => {
      setPlugins(list);
    });

    const unsubReg = pluginRegistry.subscribe(() => {
      setCatalog(pluginRegistry.getCatalog());
    });

    return () => {
      unsubHost();
      unsubReg();
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleTogglePlugin = async (id: string, currentlyEnabled: boolean) => {
    if (currentlyEnabled) {
      await pluginHost.disablePlugin(id);
      showToast(`Plugin disabled: ${id}`);
    } else {
      await pluginHost.enablePlugin(id);
      showToast(`Plugin enabled: ${id}`);
    }
  };

  const handleRestartPlugin = async (id: string) => {
    await pluginHost.enablePlugin(id);
    showToast(`Restarted plugin: ${id}`);
  };

  const handleInstallFromRegistry = async (pluginId: string, name: string) => {
    const success = await pluginRegistry.installPlugin(pluginId);
    if (success) {
      showToast(`Installed & activated "${name}"`);
    } else {
      showToast(`Failed to install "${name}"`);
    }
  };

  const handleUninstall = async (pluginId: string, name: string) => {
    const success = await pluginRegistry.uninstallPlugin(pluginId);
    if (success) {
      showToast(`Uninstalled "${name}"`);
    } else {
      showToast(`Failed to uninstall "${name}"`);
    }
  };

  const handleImportCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const manifest: PluginManifest = JSON.parse(importJson);
      if (!manifest.id || !manifest.name) {
        showToast('Invalid manifest: "id" and "name" are required');
        return;
      }
      await pluginHost.registerPlugin(manifest);
      await pluginHost.enablePlugin(manifest.id);
      setShowImportModal(false);
      setImportJson('');
      showToast(`Custom plugin "${manifest.name}" registered and activated`);
    } catch (err: any) {
      showToast(`Import error: ${err.message}`);
    }
  };

  const CATEGORIES: { id: string; label: string }[] = [
    { id: 'all', label: 'All Categories' },
    { id: 'audio_effect', label: 'Audio Effects' },
    { id: 'audio_source', label: 'Audio Sources' },
    { id: 'output', label: 'Outputs' },
    { id: 'metadata', label: 'Metadata' },
    { id: 'automation', label: 'Automation' },
    { id: 'transcript', label: 'Transcripts' },
    { id: 'utility', label: 'Utilities' },
  ];

  const filteredInstalled = plugins.filter((p) => {
    if (selectedCategory !== 'all' && p.manifest.category.toLowerCase() !== selectedCategory.toLowerCase()) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return p.manifest.name.toLowerCase().includes(q) || p.manifest.description.toLowerCase().includes(q);
    }
    return true;
  });

  const filteredCatalog = catalog.filter((item) => {
    if (selectedCategory !== 'all' && item.manifest.category.toLowerCase() !== selectedCategory.toLowerCase()) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.manifest.name.toLowerCase().includes(q) ||
        item.manifest.description.toLowerCase().includes(q) ||
        item.author.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <section className="ws-workspace" style={{ display: 'grid', gridTemplateRows: 'auto auto auto minmax(0, 1fr)', gap: '12px', height: '100%' }}>
      {/* Command & Control Bar */}
      <div className="ws-command-row">
        <div>
          <div className="ws-kicker">System / Extensibility</div>
          <h1 className="ws-title">Broadcst Plugin API</h1>
          <p className="ws-subtitle">
            Modular broadcast extensions for real-time audio processing, stream mirroring, automation macros, and speech processing.
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
              data-active={activeSubTab === 'registry'}
              onClick={() => setActiveSubTab('registry')}
            >
              Catalog ({catalog.length})
            </button>
          </div>

          <button
            type="button"
            className="ws-secondary-action"
            onClick={() => setShowImportModal(true)}
          >
            + Sideload Manifest
          </button>
        </div>
      </div>

      {/* Architecture Honesty Banner */}
      <div className="ws-banner" data-type="notice">
        <div>
          <strong style={{ display: 'block', color: 'var(--ws-text)', marginBottom: '2px' }}>
            Current Runtime: In-Process Prototype
          </strong>
          <span style={{ color: 'var(--ws-muted)' }}>
            Plugins are executed within the application thread. Target architecture: isolated native plugin process.
          </span>
        </div>
        <span className="ws-badge" data-variant="warning">IN-PROCESS PROTOTYPE</span>
      </div>

      {/* Category & Search Toolbar */}
      <div className="ws-toolbar">
        <div className="ws-toolbar-group">
          <span className="ws-toolbar-label">Category</span>
          <select
            className="ws-select"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            {CATEGORIES.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>

        <div className="ws-toolbar-group" style={{ flex: 1 }}>
          <input
            type="text"
            className="ws-input"
            placeholder="Search plugins by name, tag, or author..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Content Area */}
      <div style={{ overflowY: 'auto', minHeight: 0 }}>
        {activeSubTab === 'installed' ? (
          <div>
            {filteredInstalled.length === 0 ? (
              <div className="ws-empty">
                <div>
                  <strong>No Installed Plugins Matching Filter</strong>
                  <p>Switch categories or browse the Ecosystem Catalog to install plugins.</p>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '10px' }}>
                {filteredInstalled.map((p) => {
                  const isRunning = p.status === 'RUNNING';
                  const isCrashed = p.status === 'CRASHED' || p.status === 'ERROR';

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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span
                            className="ws-badge"
                            data-variant={isRunning ? 'live' : isCrashed ? 'danger' : 'neutral'}
                          >
                            {p.status}
                          </span>
                          <span className="ws-tag">
                            {p.manifest.category.replace('_', ' ').toUpperCase()}
                          </span>
                          <span style={{ fontSize: '10px', color: 'var(--ws-subtle)', fontFamily: 'var(--font-mono)' }}>
                            v{p.manifest.version}
                          </span>
                          <span style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>
                            by {p.manifest.author}
                          </span>
                        </div>

                        <div style={{ fontSize: '14px', fontWeight: 720, color: 'var(--ws-text)' }}>
                          {p.manifest.name}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--ws-muted)', marginTop: '3px' }}>
                          {p.manifest.description}
                        </div>

                        {p.errorMessage && (
                          <div style={{ marginTop: '6px', fontSize: '10.5px', color: 'var(--ws-danger)', fontFamily: 'var(--font-mono)' }}>
                            Last Exception: {p.errorMessage}
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: '5px', marginTop: '8px' }}>
                          {p.manifest.permissions.map((perm) => (
                            <span key={perm} className="ws-tag">
                              {perm}
                            </span>
                          ))}
                          <span className="ws-tag" style={{ color: 'var(--ws-warning)' }}>
                            In-Process Simulation
                          </span>
                        </div>
                      </div>

                      {/* Controls */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {isCrashed && (
                          <button
                            type="button"
                            className="ws-secondary-action"
                            style={{ height: '30px', fontSize: '10px' }}
                            onClick={() => handleRestartPlugin(p.manifest.id)}
                          >
                            Restart
                          </button>
                        )}

                        <button
                          type="button"
                          className={p.enabled ? 'ws-secondary-action' : 'ws-primary-action'}
                          style={{ height: '30px', fontSize: '10px' }}
                          onClick={() => handleTogglePlugin(p.manifest.id, p.enabled)}
                        >
                          {p.enabled ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div>
            {filteredCatalog.length === 0 ? (
              <div className="ws-empty">
                <div>
                  <strong>No Catalog Items Found</strong>
                  <p>Try clearing search or selecting a different plugin category.</p>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '12px' }}>
                {filteredCatalog.map((item) => {
                  const isInstalled = plugins.some((p) => p.manifest.id === item.manifest.id);

                  return (
                    <div
                      key={item.manifest.id}
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
                            {item.manifest.category.replace('_', ' ').toUpperCase()}
                          </span>
                          <span
                            className="ws-badge"
                            data-variant={
                              item.sourceStatus === 'Official'
                                ? 'live'
                                : item.sourceStatus === 'Verified Local'
                                ? 'info'
                                : 'neutral'
                            }
                          >
                            {item.sourceStatus}
                          </span>
                        </div>

                        <div style={{ fontSize: '13.5px', fontWeight: 720, color: 'var(--ws-text)' }}>
                          {item.manifest.name}
                        </div>
                        <div style={{ fontSize: '10.5px', color: 'var(--ws-muted)', marginTop: '2px' }}>
                          by {item.author} • v{item.manifest.version}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--ws-text)', marginTop: '6px', lineHeight: 1.45 }}>
                          {item.manifest.description}
                        </div>

                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '10px' }}>
                          {item.tags.map((t) => (
                            <span key={t} className="ws-tag">
                              #{t}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', borderTop: '1px solid var(--ws-line)', paddingTop: '10px' }}>
                        {isInstalled ? (
                          <button
                            type="button"
                            className="ws-secondary-action"
                            style={{ height: '28px', fontSize: '10px', color: 'var(--ws-danger)' }}
                            onClick={() => handleUninstall(item.manifest.id, item.manifest.name)}
                          >
                            Uninstall
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="ws-primary-action"
                            style={{ height: '28px', fontSize: '10px' }}
                            onClick={() => handleInstallFromRegistry(item.manifest.id, item.manifest.name)}
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
          </div>
        )}
      </div>

      {/* Sideload Modal Form */}
      {showImportModal && (
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
              width: 'min(520px, 92vw)',
              background: 'var(--ws-panel)',
              border: '1px solid var(--ws-line)',
              borderRadius: '8px',
              padding: '18px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 760 }}>Sideload Custom Plugin Manifest</h3>
              <button
                type="button"
                className="ws-mini-action"
                onClick={() => setShowImportModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleImportCustom}>
              <p style={{ fontSize: '11px', color: 'var(--ws-muted)', margin: '0 0 10px 0' }}>
                Paste JSON manifest definition compliant with Broadcst Plugin API.
              </p>
              <textarea
                className="ws-input"
                style={{ width: '100%', height: '140px', fontFamily: 'var(--font-mono)', fontSize: '10px', padding: '8px' }}
                placeholder='{ "id": "my-tool", "name": "My Custom Tool", "version": "1.0.0", "author": "Developer", "description": "Custom utility", "category": "utility", "permissions": [] }'
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                required
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                <button
                  type="button"
                  className="ws-secondary-action"
                  onClick={() => setShowImportModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="ws-primary-action">
                  Register Plugin
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toastMessage && <div className="ws-toast">{toastMessage}</div>}
    </section>
  );
};
