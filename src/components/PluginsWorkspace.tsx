import React, { useState, useEffect } from 'react';
import { pluginHost } from '../services/plugin/pluginHost';
import type { PluginInstance } from '../services/plugin/types';

export const PluginsWorkspace: React.FC = () => {
  const [plugins, setPlugins] = useState<PluginInstance[]>(pluginHost.getPlugins());
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  useEffect(() => {
    const unsub = pluginHost.subscribe((list) => {
      setPlugins(list);
    });
    return () => unsub();
  }, []);

  const handleTogglePlugin = async (id: string, currentlyEnabled: boolean) => {
    if (currentlyEnabled) {
      await pluginHost.disablePlugin(id);
    } else {
      await pluginHost.enablePlugin(id);
    }
  };

  const handleSimulateCrash = (id: string) => {
    pluginHost.simulateCrash(id);
  };

  const handleRestartPlugin = async (id: string) => {
    await pluginHost.enablePlugin(id);
  };

  const categories: { id: string; label: string }[] = [
    { id: 'all', label: 'ALL PLUGINS' },
    { id: 'audio_effect', label: 'AUDIO EFFECTS' },
    { id: 'metadata', label: 'METADATA' },
    { id: 'output', label: 'OUTPUTS' },
  ];

  const filteredPlugins = plugins.filter((p) => {
    if (selectedCategory === 'all') return true;
    return p.manifest.category === selectedCategory;
  });

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

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--space-5)',
        gap: 'var(--space-4)',
        backgroundColor: 'var(--color-bg)',
        overflowY: 'auto',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--color-surface)',
          padding: 'var(--space-3) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div>
          <h1 style={{ fontSize: 'var(--text-h2)', fontWeight: 700, margin: 0 }}>
            Broadcast Plugin Host
          </h1>
          <p style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
            Isolated worker sandboxes for real-time DSP, metadata scrapers, and external connectors.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span
            style={{
              fontSize: 'var(--text-micro)',
              padding: '2px 8px',
              backgroundColor: 'rgba(217, 255, 85, 0.1)',
              color: 'var(--color-live)',
              border: '1px solid rgba(217, 255, 85, 0.25)',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 700,
            }}
          >
            FAILURE ISOLATION ACTIVE
          </span>
        </div>
      </header>

      {/* Category Filter Tabs */}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            style={{
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-small)',
              fontWeight: selectedCategory === cat.id ? 700 : 500,
              backgroundColor: selectedCategory === cat.id ? 'var(--color-surface-elevated)' : 'var(--color-surface)',
              border: selectedCategory === cat.id ? '1px solid var(--color-live)' : '1px solid var(--color-border)',
              color: selectedCategory === cat.id ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Plugins Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 'var(--space-4)' }}>
        {filteredPlugins.map((plugin) => {
          const isCrashed = plugin.status === 'CRASHED' || plugin.status === 'ERROR';

          return (
            <div
              key={plugin.manifest.id}
              style={{
                backgroundColor: 'var(--color-surface)',
                border: `1px solid ${isCrashed ? 'var(--color-error)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-4)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-3)',
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span
                    style={{
                      fontSize: 'var(--text-micro)',
                      fontWeight: 700,
                      color: 'var(--color-text-muted)',
                      textTransform: 'uppercase',
                    }}
                  >
                    {plugin.manifest.category.replace('_', ' ')}
                  </span>
                  <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 600, margin: '2px 0 0 0' }}>
                    {plugin.manifest.name}
                  </h2>
                  <span style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)' }}>
                    v{plugin.manifest.version} by {plugin.manifest.author}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: getStatusColor(plugin.status),
                    }}
                  />
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 'var(--text-micro)',
                      fontWeight: 700,
                      color: getStatusColor(plugin.status),
                    }}
                  >
                    {plugin.status}
                  </span>
                </div>
              </div>

              {/* Description */}
              <p style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', margin: 0, minHeight: '40px' }}>
                {plugin.manifest.description}
              </p>

              {/* Error Callout if Crashed */}
              {isCrashed && plugin.errorMessage && (
                <div
                  style={{
                    backgroundColor: 'rgba(255, 92, 108, 0.1)',
                    border: '1px solid var(--color-error)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-2)',
                    fontSize: 'var(--text-micro)',
                    color: 'var(--color-error)',
                  }}
                >
                  Isolated Error: {plugin.errorMessage}
                </div>
              )}

              {/* Permissions & Memory Footer */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)' }}>
                <span>Memory: ~{plugin.memoryEstimateKb} KB</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {plugin.manifest.permissions.map((perm) => (
                    <span
                      key={perm}
                      style={{
                        padding: '1px 4px',
                        backgroundColor: 'var(--color-surface-elevated)',
                        borderRadius: '2px',
                        fontSize: '9px',
                      }}
                    >
                      {perm}
                    </span>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'auto', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--color-border)' }}>
                {isCrashed ? (
                  <button
                    onClick={() => handleRestartPlugin(plugin.manifest.id)}
                    style={{
                      flex: 1,
                      padding: 'var(--space-2) 0',
                      backgroundColor: 'var(--color-live)',
                      color: '#0B0D0F',
                      fontWeight: 700,
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 'var(--text-small)',
                    }}
                  >
                    RECOVER & RESTART
                  </button>
                ) : (
                  <button
                    onClick={() => handleTogglePlugin(plugin.manifest.id, plugin.enabled)}
                    style={{
                      flex: 1,
                      padding: 'var(--space-2) 0',
                      backgroundColor: plugin.enabled ? 'var(--color-surface-elevated)' : 'var(--color-live)',
                      color: plugin.enabled ? 'var(--color-text-primary)' : '#0B0D0F',
                      fontWeight: 700,
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 'var(--text-small)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {plugin.enabled ? 'DISABLE' : 'ENABLE'}
                  </button>
                )}

                {plugin.status === 'RUNNING' && (
                  <button
                    onClick={() => handleSimulateCrash(plugin.manifest.id)}
                    title="Simulate crash to verify failure isolation"
                    style={{
                      padding: 'var(--space-2) var(--space-3)',
                      backgroundColor: 'var(--color-surface-elevated)',
                      color: 'var(--color-error)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 'var(--text-micro)',
                      fontWeight: 600,
                    }}
                  >
                    Test Crash
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
