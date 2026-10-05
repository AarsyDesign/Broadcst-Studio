import React, { useState } from 'react';
import { shoutcastService } from '../services/shoutcastService';
import { ShoutcastConfig, TrackMetadata } from '../types/broadcast';

export const SettingsWorkspace: React.FC = () => {
  const [config, setConfig] = useState<ShoutcastConfig>(shoutcastService.getConfig());
  const [metadata, setMetadata] = useState<TrackMetadata>(shoutcastService.getCurrentMetadata());
  const [saveStatus, setSaveStatus] = useState<string>('');

  const handleConfigChange = (field: keyof ShoutcastConfig, value: any) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    shoutcastService.updateConfig(config);
    setSaveStatus('Configuration saved successfully.');
    setTimeout(() => setSaveStatus(''), 3000);
  };

  const handlePushMetadata = (e: React.FormEvent) => {
    e.preventDefault();
    shoutcastService.setMetadata(metadata);
    setSaveStatus('Metadata pushed to stream.');
    setTimeout(() => setSaveStatus(''), 3000);
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
            Broadcast Configuration
          </h1>
          <p style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
            Setup SHOUTcast output parameters, audio buffer targets, and live stream metadata.
          </p>
        </div>

        {saveStatus && (
          <span style={{ fontSize: 'var(--text-small)', color: 'var(--color-live)', fontWeight: 600 }}>
            {saveStatus}
          </span>
        )}
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        {/* SHOUTcast Server Settings */}
        <section
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 600, margin: 0 }}>
            SHOUTcast Server Parameters
          </h2>

          <form onSubmit={handleSaveConfig} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                SERVER ADDRESS / HOST
              </label>
              <input
                type="text"
                value={config.server}
                onChange={(e) => handleConfigChange('server', e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                  PORT
                </label>
                <input
                  type="number"
                  value={config.port}
                  onChange={(e) => handleConfigChange('port', parseInt(e.target.value, 10))}
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                  STREAM ID
                </label>
                <input
                  type="number"
                  value={config.streamId}
                  onChange={(e) => handleConfigChange('streamId', parseInt(e.target.value, 10))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                  BITRATE
                </label>
                <select
                  value={config.bitrate}
                  onChange={(e) => handleConfigChange('bitrate', parseInt(e.target.value, 10))}
                  style={{ width: '100%' }}
                >
                  <option value={64}>64 kbps</option>
                  <option value={96}>96 kbps</option>
                  <option value={128}>128 kbps (Standard)</option>
                  <option value={192}>192 kbps (Studio)</option>
                  <option value={320}>320 kbps (High Fidelity)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                  CODEC
                </label>
                <select
                  value={config.codec}
                  onChange={(e) => handleConfigChange('codec', e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="MP3">MP3 (MPEG-1 Layer 3)</option>
                  <option value="AAC">AAC (Advanced Audio Coding)</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                STATION NAME
              </label>
              <input
                type="text"
                value={config.stationName}
                onChange={(e) => handleConfigChange('stationName', e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                GENRE / FORMAT
              </label>
              <input
                type="text"
                value={config.genre || ''}
                onChange={(e) => handleConfigChange('genre', e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <button
              type="submit"
              style={{
                marginTop: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-4)',
                backgroundColor: 'var(--color-live)',
                color: '#0B0D0F',
                fontWeight: 700,
                borderRadius: 'var(--radius-sm)',
              }}
            >
              SAVE SERVER SETTINGS
            </button>
          </form>
        </section>

        {/* Live Track Metadata Injector */}
        <section
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 600, margin: 0 }}>
            Live Stream Metadata Injector
          </h2>
          <p style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)' }}>
            Broadcast real-time title and artist information embedded inside the ICY audio chunks.
          </p>

          <form onSubmit={handlePushMetadata} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                TRACK / PROGRAM TITLE
              </label>
              <input
                type="text"
                value={metadata.title}
                onChange={(e) => setMetadata((prev) => ({ ...prev, title: e.target.value }))}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                ARTIST / SPEAKER / HOST
              </label>
              <input
                type="text"
                value={metadata.artist}
                onChange={(e) => setMetadata((prev) => ({ ...prev, artist: e.target.value }))}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                ALBUM / SPECIAL NOTE
              </label>
              <input
                type="text"
                value={metadata.album || ''}
                onChange={(e) => setMetadata((prev) => ({ ...prev, album: e.target.value }))}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ padding: 'var(--space-3)', backgroundColor: 'var(--color-surface-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
              <span style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)', display: 'block' }}>ICY STREAM TITLE PREVIEW</span>
              <span className="font-mono" style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-primary)' }}>
                {metadata.artist} - {metadata.title}
              </span>
            </div>

            <button
              type="submit"
              style={{
                marginTop: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-4)',
                backgroundColor: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
                fontWeight: 700,
                borderRadius: 'var(--radius-sm)',
              }}
            >
              PUSH METADATA TO STREAM
            </button>
          </form>
        </section>
      </div>
    </div>
  );
};
