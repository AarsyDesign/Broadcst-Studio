import React, { useState, useEffect } from 'react';
import { shoutcastService } from '../services/shoutcastService';
import { icecastService, IcecastConfig } from '../services/icecast/icecastService';
import { stationProfileManager } from '../services/profile/stationProfileManager';
import { StationProfile } from '../services/profile/types';
import { AudioCodecType, CODEC_PROFILES } from '../types/codecs';
import { ShoutcastConfig, TrackMetadata } from '../types/broadcast';

interface SettingsWorkspaceProps {
  theme?: 'dark' | 'light';
  onSetTheme?: (theme: 'dark' | 'light') => void;
}

export const SettingsWorkspace: React.FC<SettingsWorkspaceProps> = ({
  theme = 'dark',
  onSetTheme,
}) => {
  const [profiles, setProfiles] = useState<StationProfile[]>(stationProfileManager.getProfiles());
  const [activeProfile, setActiveProfile] = useState<StationProfile>(stationProfileManager.getActiveProfile());

  const [shoutcastCfg, setShoutcastCfg] = useState<ShoutcastConfig>(shoutcastService.getConfig());
  const [icecastCfg, setIcecastCfg] = useState<IcecastConfig>(icecastService.getConfig());
  const [metadata, setMetadata] = useState<TrackMetadata>(shoutcastService.getCurrentMetadata());

  const [serverProtocol, setServerProtocol] = useState<'shoutcast' | 'icecast'>(activeProfile.primaryServerType);
  const [selectedCodec, setSelectedCodec] = useState<AudioCodecType>(activeProfile.defaultCodec || 'MP3');
  const [selectedBitrate, setSelectedBitrate] = useState<number>(activeProfile.defaultBitrate || 128);

  const [saveStatus, setSaveStatus] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileCallsign, setNewProfileCallsign] = useState('');
  const [newProfileGenre, setNewProfileGenre] = useState('Talk & Music');

  useEffect(() => {
    const unsub = stationProfileManager.subscribe((list, active) => {
      setProfiles(list);
      setActiveProfile(active);
      setShoutcastCfg(active.shoutcastConfig);
      setIcecastCfg(active.icecastConfig);
      setServerProtocol(active.primaryServerType);
      setSelectedCodec(active.defaultCodec);
      setSelectedBitrate(active.defaultBitrate);
    });

    return () => unsub();
  }, []);

  const showToast = (msg: string) => {
    setSaveStatus(msg);
    setTimeout(() => setSaveStatus(''), 3000);
  };

  const handleSwitchProfile = async (id: string) => {
    const success = await stationProfileManager.switchProfile(id);
    if (success) {
      showToast(`Switched active station to: ${stationProfileManager.getActiveProfile().name}`);
    }
  };

  const handleSaveActiveSettings = (e: React.FormEvent) => {
    e.preventDefault();

    // 1. Update active profile in manager
    const updatedProfile: Partial<StationProfile> = {
      name: activeProfile.name,
      callsign: activeProfile.callsign,
      slogan: activeProfile.slogan,
      genre: activeProfile.genre,
      website: activeProfile.website,
      primaryServerType: serverProtocol,
      defaultCodec: selectedCodec,
      defaultBitrate: selectedBitrate,
      shoutcastConfig: {
        ...shoutcastCfg,
        bitrate: selectedBitrate,
      },
      icecastConfig: {
        ...icecastCfg,
        codec: selectedCodec,
        bitrate: selectedBitrate,
      },
    };

    stationProfileManager.updateProfile(activeProfile.id, updatedProfile);

    // 2. Update live engines
    shoutcastService.updateConfig({
      ...shoutcastCfg,
      bitrate: selectedBitrate,
    });
    icecastService.updateConfig({
      ...icecastCfg,
      codec: selectedCodec,
      bitrate: selectedBitrate,
    });

    showToast('All station settings and server parameters saved.');
  };

  const handlePushMetadata = (e: React.FormEvent) => {
    e.preventDefault();
    shoutcastService.setMetadata(metadata);
    icecastService.setMetadata(metadata);
    showToast(`Metadata pushed to all active streams: "${metadata.title}" by "${metadata.artist}"`);
  };

  const handleCreateProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim()) return;

    const created = stationProfileManager.createProfile({
      name: newProfileName.trim(),
      callsign: newProfileCallsign.trim() || 'STN-01',
      genre: newProfileGenre.trim(),
      primaryServerType: 'shoutcast',
      defaultCodec: 'MP3',
      defaultBitrate: 128,
    });

    stationProfileManager.switchProfile(created.id);
    setShowCreateModal(false);
    setNewProfileName('');
    setNewProfileCallsign('');
    showToast(`Created and switched to station: ${created.name}`);
  };

  const handleExportProfiles = () => {
    const json = stationProfileManager.exportProfilesJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `station-profiles-backup-${new Date().toISOString().substring(0, 10)}.json`;
    a.click();
    showToast('Station profiles exported to JSON');
  };

  const handleImportProfiles = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target?.result as string;
          if (content) {
            const success = stationProfileManager.importProfilesJson(content);
            if (success) {
              showToast('Station profiles imported successfully');
            } else {
              showToast('Failed to parse profile JSON');
            }
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const codecProfile = CODEC_PROFILES[selectedCodec] || CODEC_PROFILES.MP3;

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--space-6)',
        gap: 'var(--space-4)',
        backgroundColor: 'var(--color-bg)',
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--color-surface)',
          padding: 'var(--space-4)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div>
          <h1 style={{ fontSize: 'var(--text-h2)', fontWeight: 700, margin: 0, textTransform: 'uppercase' }}>
            Station Profiles & Transmission Settings
          </h1>
          <p style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
            Manage multi-station configurations, SHOUTcast / Icecast servers, high-efficiency audio codecs, and stream metadata.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            onClick={handleExportProfiles}
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
            Export Profiles
          </button>
          <button
            onClick={handleImportProfiles}
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
            Import Profiles
          </button>
        </div>
      </header>

      {/* Toast Alert */}
      {saveStatus && (
        <div
          style={{
            padding: 'var(--space-2) var(--space-4)',
            backgroundColor: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-live)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-live)',
            fontWeight: 600,
            fontSize: 'var(--text-small)',
          }}
        >
          {saveStatus}
        </div>
      )}

      {/* Multi-Station Profile Bar */}
      <section
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <div>
            <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
              ACTIVE STATION PROFILE
            </div>
            <div style={{ fontSize: 'var(--text-h2)', fontWeight: 700, color: 'var(--color-live)' }}>
              {activeProfile.name} ({activeProfile.callsign})
            </div>
            <div style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)' }}>
              {activeProfile.slogan} | Genre: {activeProfile.genre}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <select
            value={activeProfile.id}
            onChange={(e) => handleSwitchProfile(e.target.value)}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              backgroundColor: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-primary)',
              fontSize: 'var(--text-body)',
              fontWeight: 600,
            }}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.callsign})
              </option>
            ))}
          </select>

          <button
            onClick={() => setShowCreateModal(true)}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              backgroundColor: 'var(--color-live)',
              color: 'var(--color-live-text)',
              fontWeight: 600,
              fontSize: 'var(--text-small)',
              cursor: 'pointer',
            }}
          >
            + New Station
          </button>
        </div>
      </section>

      {/* Two Column Settings Body */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        {/* Left Column: Server Transmission Parameters */}
        <section
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 700, margin: 0, textTransform: 'uppercase' }}>
              Streaming Server Protocol
            </h2>

            {/* Protocol Switcher */}
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
                type="button"
                onClick={() => setServerProtocol('shoutcast')}
                style={{
                  padding: 'var(--space-1) var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  backgroundColor: serverProtocol === 'shoutcast' ? 'var(--color-surface-elevated)' : 'transparent',
                  color: serverProtocol === 'shoutcast' ? 'var(--color-live)' : 'var(--color-text-secondary)',
                  fontWeight: serverProtocol === 'shoutcast' ? 700 : 400,
                  fontSize: 'var(--text-small)',
                  cursor: 'pointer',
                }}
              >
                SHOUTcast v1/v2
              </button>
              <button
                type="button"
                onClick={() => setServerProtocol('icecast')}
                style={{
                  padding: 'var(--space-1) var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  backgroundColor: serverProtocol === 'icecast' ? 'var(--color-surface-elevated)' : 'transparent',
                  color: serverProtocol === 'icecast' ? 'var(--color-live)' : 'var(--color-text-secondary)',
                  fontWeight: serverProtocol === 'icecast' ? 700 : 400,
                  fontSize: 'var(--text-small)',
                  cursor: 'pointer',
                }}
              >
                Icecast 2.x (HTTP SOURCE)
              </button>
            </div>
          </div>

          <form onSubmit={handleSaveActiveSettings} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {serverProtocol === 'shoutcast' ? (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                    SHOUTCAST SERVER HOST / IP
                  </label>
                  <input
                    type="text"
                    value={shoutcastCfg.server}
                    onChange={(e) => setShoutcastCfg({ ...shoutcastCfg, server: e.target.value })}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                      PORT
                    </label>
                    <input
                      type="number"
                      value={shoutcastCfg.port}
                      onChange={(e) => setShoutcastCfg({ ...shoutcastCfg, port: Number(e.target.value) })}
                      style={{ width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                      STREAM ID
                    </label>
                    <input
                      type="number"
                      value={shoutcastCfg.streamId}
                      onChange={(e) => setShoutcastCfg({ ...shoutcastCfg, streamId: Number(e.target.value) })}
                      style={{ width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                    SOURCE PASSWORD
                  </label>
                  <input
                    type="password"
                    value={shoutcastCfg.password || ''}
                    onChange={(e) => setShoutcastCfg({ ...shoutcastCfg, password: e.target.value })}
                    placeholder="Enter encoder password..."
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                    ICECAST SERVER HOST / IP
                  </label>
                  <input
                    type="text"
                    value={icecastCfg.server}
                    onChange={(e) => setIcecastCfg({ ...icecastCfg, server: e.target.value })}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                      PORT
                    </label>
                    <input
                      type="number"
                      value={icecastCfg.port}
                      onChange={(e) => setIcecastCfg({ ...icecastCfg, port: Number(e.target.value) })}
                      style={{ width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                      MOUNT POINT
                    </label>
                    <input
                      type="text"
                      value={icecastCfg.mountPoint}
                      onChange={(e) => setIcecastCfg({ ...icecastCfg, mountPoint: e.target.value })}
                      placeholder="/live"
                      style={{ width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                      SOURCE USERNAME
                    </label>
                    <input
                      type="text"
                      value={icecastCfg.username}
                      onChange={(e) => setIcecastCfg({ ...icecastCfg, username: e.target.value })}
                      style={{ width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                      SOURCE PASSWORD
                    </label>
                    <input
                      type="password"
                      value={icecastCfg.password}
                      onChange={(e) => setIcecastCfg({ ...icecastCfg, password: e.target.value })}
                      style={{ width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
              </>
            )}

            {/* Audio Codec & Bitrate Section */}
            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
              <div style={{ fontSize: 'var(--text-small)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
                Audio Encoding Format & Codec
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 'var(--space-3)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                    CODEC ENGINE
                  </label>
                  <select
                    value={selectedCodec}
                    onChange={(e) => {
                      const c = e.target.value as AudioCodecType;
                      setSelectedCodec(c);
                      setSelectedBitrate(CODEC_PROFILES[c].defaultBitrateKbps);
                    }}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  >
                    <option value="MP3">MPEG Layer-3 (MP3)</option>
                    <option value="AAC_LC">Advanced Audio Coding (AAC-LC)</option>
                    <option value="HE_AAC">High-Efficiency AAC (aacPlus v2)</option>
                    <option value="OPUS">Opus Audio (Ogg Opus - Low Latency)</option>
                    <option value="OGG_VORBIS">Ogg Vorbis</option>
                    <option value="FLAC">FLAC (Lossless Studio Master)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                    TARGET BITRATE
                  </label>
                  <select
                    value={selectedBitrate}
                    onChange={(e) => setSelectedBitrate(Number(e.target.value))}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  >
                    {codecProfile.supportedBitrates.map((b) => (
                      <option key={b} value={b}>
                        {b === 1411 ? 'Lossless (1411 kbps)' : `${b} kbps`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <p style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)', marginTop: '6px' }}>
                {codecProfile.description} (MIME: {codecProfile.mimeType})
              </p>
            </div>

            <button
              type="submit"
              style={{
                marginTop: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-4)',
                backgroundColor: 'var(--color-live)',
                color: 'var(--color-live-text)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 600,
                fontSize: 'var(--text-small)',
                cursor: 'pointer',
              }}
            >
              Save Transmission Settings
            </button>
          </form>
        </section>

        {/* Right Column: Station Identity & Live Metadata */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* Station Identity Section */}
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
            <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 700, margin: 0, textTransform: 'uppercase' }}>
              Station Branding & Identity
            </h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                  STATION NAME
                </label>
                <input
                  type="text"
                  value={activeProfile.name}
                  onChange={(e) => stationProfileManager.updateProfile(activeProfile.id, { name: e.target.value })}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                  CALLSIGN / FREQUENCY
                </label>
                <input
                  type="text"
                  value={activeProfile.callsign}
                  onChange={(e) => stationProfileManager.updateProfile(activeProfile.id, { callsign: e.target.value })}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                STATION SLOGAN / MOTTO
              </label>
              <input
                type="text"
                value={activeProfile.slogan}
                onChange={(e) => stationProfileManager.updateProfile(activeProfile.id, { slogan: e.target.value })}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                  PRIMARY GENRE
                </label>
                <input
                  type="text"
                  value={activeProfile.genre}
                  onChange={(e) => stationProfileManager.updateProfile(activeProfile.id, { genre: e.target.value })}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                  STATION WEBSITE URL
                </label>
                <input
                  type="text"
                  value={activeProfile.website}
                  onChange={(e) => stationProfileManager.updateProfile(activeProfile.id, { website: e.target.value })}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
            </div>
          </section>

          {/* Real-time Metadata Section */}
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
            <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 700, margin: 0, textTransform: 'uppercase' }}>
              Live On-Air Metadata Injection
            </h2>

            <form onSubmit={handlePushMetadata} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                  NOW PLAYING TRACK / PROGRAM TITLE
                </label>
                <input
                  type="text"
                  value={metadata.title}
                  onChange={(e) => setMetadata({ ...metadata, title: e.target.value })}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                    ARTIST / PRESENTER
                  </label>
                  <input
                    type="text"
                    value={metadata.artist}
                    onChange={(e) => setMetadata({ ...metadata, artist: e.target.value })}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                    ALBUM / CATEGORY
                  </label>
                  <input
                    type="text"
                    value={metadata.album || ''}
                    onChange={(e) => setMetadata({ ...metadata, album: e.target.value })}
                    placeholder="e.g. Live Broadcast"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <button
                type="submit"
                style={{
                  marginTop: 'var(--space-1)',
                  padding: 'var(--space-2) var(--space-4)',
                  backgroundColor: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                  borderRadius: 'var(--radius-sm)',
                  fontWeight: 600,
                  fontSize: 'var(--text-small)',
                  cursor: 'pointer',
                }}
              >
                Push Metadata to Live Stream
              </button>
            </form>
          </section>
        </div>
      </div>

      {/* Console Display & Theme Preferences */}
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 700, margin: 0, textTransform: 'uppercase' }}>
              Console Display and Theme
            </h2>
            <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)' }}>
              Switch between Studio Dark console for low-light broadcast environments and Studio Light mode for daytime studio operations.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type="button"
              onClick={() => onSetTheme?.('dark')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-4)',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${theme === 'dark' ? 'var(--color-live)' : 'var(--color-border)'}`,
                backgroundColor: theme === 'dark' ? 'var(--color-surface-elevated)' : 'transparent',
                color: theme === 'dark' ? 'var(--color-live)' : 'var(--color-text-secondary)',
                fontWeight: 600,
                fontSize: 'var(--text-small)',
                cursor: 'pointer',
                transition: 'all var(--motion-state)',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: theme === 'dark' ? 'var(--color-live)' : 'var(--color-text-muted)',
                }}
              />
              Dark Console
            </button>
            <button
              type="button"
              onClick={() => onSetTheme?.('light')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-4)',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${theme === 'light' ? 'var(--color-live)' : 'var(--color-border)'}`,
                backgroundColor: theme === 'light' ? 'var(--color-surface-elevated)' : 'transparent',
                color: theme === 'light' ? 'var(--color-live)' : 'var(--color-text-secondary)',
                fontWeight: 600,
                fontSize: 'var(--text-small)',
                cursor: 'pointer',
                transition: 'all var(--motion-state)',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: theme === 'light' ? 'var(--color-live)' : 'var(--color-text-muted)',
                }}
              />
              Light Broadcast
            </button>
          </div>
        </div>
      </section>

      {/* Create New Station Modal */}
      {showCreateModal && (
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
              width: 450,
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-6)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
            }}
          >
            <h3 style={{ margin: 0, fontSize: 'var(--text-h2)' }}>Create Station Profile</h3>

            <form onSubmit={handleCreateProfile} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div>
                <label style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
                  STATION NAME
                </label>
                <input
                  type="text"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="e.g. Classical Radio 102 FM"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
                  CALLSIGN / IDENTIFIER
                </label>
                <input
                  type="text"
                  value={newProfileCallsign}
                  onChange={(e) => setNewProfileCallsign(e.target.value)}
                  placeholder="e.g. CR-102"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
                  GENRE
                </label>
                <input
                  type="text"
                  value={newProfileGenre}
                  onChange={(e) => setNewProfileGenre(e.target.value)}
                  placeholder="e.g. Classical & Acoustic"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
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
                  Create & Activate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
