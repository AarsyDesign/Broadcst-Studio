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

  // Import Modal
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

  const handleSimulateCrash = (id: string) => {
    pluginHost.simulateCrash(id);
    showToast(`Simulated crash on ${id}. Audio engine remains unaffected.`);
  };

  const handleRestartPlugin = async (id: string) => {
    await pluginHost.enablePlugin(id);
    showToast(`Restarted plugin: ${id}`);
  };

  const handleInstallFromRegistry = async (pluginId: string, name: string) => {
    const success = await pluginRegistry.installPlugin(pluginId);
    if (success) {
      showToast(`Installed and enabled "${name}"`);
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
      showToast(`Custom plugin "${manifest.name}" imported and running`);
    } catch (err: any) {
      showToast(`Import error: ${err.message}`);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'RUNNING':
        return 'var(--color-live)';
      case 'STARTING':
        return 'var(--color-warning)';
      case 'ERROR':
      case 'CRASHED':
        return 'var(--color-error)';
      default:
        return 'var(--color-text-muted)';
    }
  };

  const categories = [
    { id: 'all', label: 'ALL CATEGORIES' },
    { id: 'AudioEffect', label: 'AUDIO EFFECTS' },
    { id: 'Utility', label: 'UTILITIES' },
    { id: 'Metadata', label: 'METADATA' },
    { id: 'Automation', label: 'AUTOMATION' },
    { id: 'Output', label: 'OUTPUTS' },
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

  const filteredRegistry = catalog.filter((item) => {
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--color-bg)',
        overflow: 'hidden',
      }}
    >
      {/* Top Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-3) var(--space-6)',
          backgroundColor: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div>
          <h1 style={{ fontSize: 'var(--text-h2)', margin: 0, fontWeight: 700, textTransform: 'uppercase' }}>
            Ecosystem Plugins & Extensions
          </h1>
          <p style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', margin: '2px 0 0 0' }}>
            Isolated worker execution ensures plugin crashes never interrupt the on-air audio transmission.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {/* Sub-tab switcher */}
          <div
            style={{
              display: 'flex',
              backgroundColor: 'var(--color-bg)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px',
              border: '1px solid var(--color-border)',
            }}
          >
            <button
              onClick={() => setActiveSubTab('installed')}
              style={{
                padding: 'var(--space-1) var(--space-3)',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                backgroundColor: activeSubTab === 'installed' ? 'var(--color-surface-elevated)' : 'transparent',
                color: activeSubTab === 'installed' ? 'var(--color-live)' : 'var(--color-text-secondary)',
                fontWeight: activeSubTab === 'installed' ? 700 : 400,
                fontSize: 'var(--text-small)',
                cursor: 'pointer',
              }}
            >
              Installed ({plugins.length})
            </button>
            <button
              onClick={() => setActiveSubTab('registry')}
              style={{
                padding: 'var(--space-1) var(--space-3)',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                backgroundColor: activeSubTab === 'registry' ? 'var(--color-surface-elevated)' : 'transparent',
                color: activeSubTab === 'registry' ? 'var(--color-live)' : 'var(--color-text-secondary)',
                fontWeight: activeSubTab === 'registry' ? 700 : 400,
                fontSize: 'var(--text-small)',
                cursor: 'pointer',
              }}
            >
              Plugin Registry ({catalog.length})
            </button>
          </div>

          <button
            onClick={() => setShowImportModal(true)}
            style={{
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-surface-elevated)',
              color: 'var(--color-text-primary)',
              fontSize: 'var(--text-small)',
              cursor: 'pointer',
            }}
          >
            + Sideload Plugin
          </button>
        </div>
      </header>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'absolute',
            top: 50,
            right: 24,
            padding: 'var(--space-2) var(--space-4)',
            backgroundColor: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-live)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-primary)',
            fontSize: 'var(--text-small)',
            zIndex: 100,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
        >
          {toastMessage}
        </div>
      )}

      {/* Search & Filter Strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-3) var(--space-6)',
          backgroundColor: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
          gap: 'var(--space-4)',
        }}
      >
        <div style={{ display: 'flex', gap: 'var(--space-1)', overflowX: 'auto' }}>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedCategory(c.id)}
              style={{
                padding: 'var(--space-1) var(--space-3)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
                backgroundColor: selectedCategory === c.id ? 'var(--color-surface-elevated)' : 'transparent',
                color: selectedCategory === c.id ? 'var(--color-live)' : 'var(--color-text-secondary)',
                fontSize: 'var(--text-micro)',
                fontWeight: selectedCategory === c.id ? 700 : 400,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter plugins by name, keywords, or author..."
          style={{
            minWidth: 280,
            padding: 'var(--space-1) var(--space-3)',
            backgroundColor: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-primary)',
            fontSize: 'var(--text-small)',
            outline: 'none',
          }}
        />
      </div>

      {/* Main Content Area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--space-6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
        }}
      >
        {/* SUBTAB 1: INSTALLED PLUGINS */}
        {activeSubTab === 'installed' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {filteredInstalled.length === 0 ? (
              <div
                style={{
                  padding: 'var(--space-6)',
                  textAlign: 'center',
                  backgroundColor: 'var(--color-surface)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                No installed plugins match the filter. Browse the Plugin Registry tab to install new tools.
              </div>
            ) : (
              filteredInstalled.map((p) => (
                <div
                  key={p.manifest.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 'var(--space-4)',
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                    {/* Status Pill */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                        minWidth: 100,
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          backgroundColor: getStatusColor(p.status),
                          boxShadow: p.status === 'RUNNING' ? '0 0 6px var(--color-live)' : 'none',
                        }}
                      />
                      <span
                        style={{
                          fontSize: 'var(--text-micro)',
                          fontWeight: 700,
                          color: getStatusColor(p.status),
                        }}
                      >
                        {p.status}
                      </span>
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <span style={{ fontSize: 'var(--text-body)', fontWeight: 700 }}>{p.manifest.name}</span>
                        <span style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)' }}>
                          v{p.manifest.version}
                        </span>
                        <span
                          style={{
                            padding: '1px 6px',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 'var(--text-micro)',
                            backgroundColor: 'var(--color-surface-elevated)',
                            color: 'var(--color-text-secondary)',
                            border: '1px solid var(--color-border)',
                          }}
                        >
                          {p.manifest.category}
                        </span>
                      </div>

                      <div style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                        {p.manifest.description}
                      </div>

                      {p.errorMessage && (
                        <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-error)', marginTop: '4px' }}>
                          Error: {p.errorMessage}
                        </div>
                      )}

                      <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                        Author: {p.manifest.author} | Memory: ~{p.memoryEstimateKb} KB | Permissions: {p.manifest.permissions.join(', ')}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    {p.status === 'CRASHED' || p.status === 'ERROR' ? (
                      <button
                        onClick={() => handleRestartPlugin(p.manifest.id)}
                        style={{
                          padding: 'var(--space-1) var(--space-3)',
                          borderRadius: 'var(--radius-sm)',
                          border: 'none',
                          backgroundColor: 'var(--color-live)',
                          color: 'var(--color-live-text)',
                          fontWeight: 600,
                          fontSize: 'var(--text-small)',
                          cursor: 'pointer',
                        }}
                      >
                        Restart
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => handleTogglePlugin(p.manifest.id, p.enabled)}
                          style={{
                            padding: 'var(--space-1) var(--space-3)',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--color-border)',
                            backgroundColor: p.enabled ? 'var(--color-surface-elevated)' : 'transparent',
                            color: p.enabled ? 'var(--color-live)' : 'var(--color-text-muted)',
                            fontSize: 'var(--text-small)',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {p.enabled ? 'Enabled' : 'Disabled'}
                        </button>

                        {p.enabled && (
                          <button
                            onClick={() => handleSimulateCrash(p.manifest.id)}
                            style={{
                              padding: 'var(--space-1) var(--space-2)',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--color-border)',
                              backgroundColor: 'transparent',
                              color: 'var(--color-warning)',
                              fontSize: 'var(--text-micro)',
                              cursor: 'pointer',
                            }}
                          >
                            Test Crash
                          </button>
                        )}
                      </>
                    )}

                    <button
                      onClick={() => handleUninstall(p.manifest.id, p.manifest.name)}
                      style={{
                        padding: 'var(--space-1) var(--space-2)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border)',
                        backgroundColor: 'transparent',
                        color: 'var(--color-error)',
                        fontSize: 'var(--text-small)',
                        cursor: 'pointer',
                      }}
                    >
                      Uninstall
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* SUBTAB 2: PLUGIN REGISTRY & STORE */}
        {activeSubTab === 'registry' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
              gap: 'var(--space-4)',
            }}
          >
            {filteredRegistry.map((item) => {
              const installed = pluginHost.getPlugins().some((p) => p.manifest.id === item.manifest.id);

              return (
                <div
                  key={item.manifest.id}
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-4)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
                      <span
                        style={{
                          padding: '1px 6px',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: 'var(--text-micro)',
                          backgroundColor: 'var(--color-surface-elevated)',
                          color: 'var(--color-info)',
                          border: '1px solid var(--color-border)',
                        }}
                      >
                        {item.manifest.category}
                      </span>
                      <span style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)' }}>
                        ★ {item.rating} ({item.downloadsCount} installs)
                      </span>
                    </div>

                    <div style={{ fontSize: 'var(--text-body)', fontWeight: 700, marginBottom: '2px' }}>
                      {item.manifest.name}
                    </div>

                    <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
                      by {item.author} | v{item.manifest.version}
                    </div>

                    <p style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', lineHeight: 1.5, margin: 0, marginBottom: 'var(--space-3)' }}>
                      {item.manifest.description}
                    </p>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: 'var(--space-3)' }}>
                      {item.tags.map((t) => (
                        <span
                          key={t}
                          style={{
                            padding: '1px 4px',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 'var(--text-micro)',
                            backgroundColor: 'var(--color-bg)',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)' }}>
                      Permissions: {item.manifest.permissions.join(', ')}
                    </div>

                    {installed ? (
                      <button
                        onClick={() => handleUninstall(item.manifest.id, item.manifest.name)}
                        style={{
                          padding: 'var(--space-1) var(--space-3)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--color-border)',
                          backgroundColor: 'var(--color-surface-elevated)',
                          color: 'var(--color-error)',
                          fontSize: 'var(--text-small)',
                          cursor: 'pointer',
                        }}
                      >
                        Uninstall
                      </button>
                    ) : (
                      <button
                        onClick={() => handleInstallFromRegistry(item.manifest.id, item.manifest.name)}
                        style={{
                          padding: 'var(--space-1) var(--space-3)',
                          borderRadius: 'var(--radius-sm)',
                          border: 'none',
                          backgroundColor: 'var(--color-live)',
                          color: 'var(--color-live-text)',
                          fontWeight: 600,
                          fontSize: 'var(--text-small)',
                          cursor: 'pointer',
                        }}
                      >
                        Install
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sideload Plugin Modal */}
      {showImportModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: 500,
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-6)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: 'var(--text-h2)' }}>Sideload Custom Plugin Manifest</h3>
              <p style={{ margin: 'var(--space-1) 0 0 0', fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)' }}>
                Paste the JSON manifest of your custom plugin to register and run it inside the failure-isolated host sandbox.
              </p>
            </div>

            <form onSubmit={handleImportCustom} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <textarea
                rows={8}
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                placeholder='{ "id": "my-custom-plugin", "name": "My Plugin", "version": "1.0.0", "category": "Utility", "permissions": ["audio:read"], "author": "Studio Dev" }'
                style={{
                  width: '100%',
                  padding: 'var(--space-2)',
                  backgroundColor: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-primary)',
                  fontFamily: 'monospace',
                  fontSize: 'var(--text-small)',
                  boxSizing: 'border-box',
                }}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  style={{
                    padding: 'var(--space-2) var(--space-4)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'transparent',
                    color: 'var(--color-text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: 'var(--space-2) var(--space-4)',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    backgroundColor: 'var(--color-live)',
                    color: 'var(--color-live-text)',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Register & Enable
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
