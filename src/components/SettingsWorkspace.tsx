import React, { useState, useEffect } from 'react';
import { shoutcastService } from '../services/shoutcastService';
import { icecastService, IcecastConfig } from '../services/icecast/icecastService';
import { stationProfileManager } from '../services/profile/stationProfileManager';
import { StationProfile } from '../services/profile/types';
import { AudioCodecType, CODEC_PROFILES } from '../types/codecs';
import { ShoutcastConfig, TrackMetadata } from '../types/broadcast';
import { transcriptionService } from '../services/transcription/transcriptionService';
import { controlApi } from '../services/controlApi';
import { recoveryManager, SystemHealthStatus } from '../services/recovery/recoveryManager';
import { historyService } from '../services/history/historyService';
import { OperationAuditLogItem } from '../services/history/types';

type SettingsSection =
  | 'station'
  | 'shoutcast'
  | 'audio'
  | 'recording'
  | 'transcript'
  | 'plugins'
  | 'ai'
  | 'appearance'
  | 'audit'
  | 'developer';

interface SettingsWorkspaceProps {
  theme?: 'dark' | 'light';
  onSetTheme?: (theme: 'dark' | 'light') => void;
}

export const SettingsWorkspace: React.FC<SettingsWorkspaceProps> = ({
  theme = 'dark',
  onSetTheme,
}) => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('station');
  const [profiles, setProfiles] = useState<StationProfile[]>(stationProfileManager.getProfiles());
  const [activeProfile, setActiveProfile] = useState<StationProfile>(stationProfileManager.getActiveProfile());

  const [shoutcastCfg, setShoutcastCfg] = useState<ShoutcastConfig>(shoutcastService.getConfig());
  const [icecastCfg, setIcecastCfg] = useState<IcecastConfig>(icecastService.getConfig());
  const [metadata, setMetadata] = useState<TrackMetadata>(shoutcastService.getCurrentMetadata());

  const [serverProtocol, setServerProtocol] = useState<'shoutcast' | 'icecast'>(activeProfile.primaryServerType);
  const [selectedCodec, setSelectedCodec] = useState<AudioCodecType>(activeProfile.defaultCodec || 'MP3');
  const [selectedBitrate, setSelectedBitrate] = useState<number>(activeProfile.defaultBitrate || 128);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showCreateProfileModal, setShowCreateProfileModal] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileCallsign, setNewProfileCallsign] = useState('');
  const [newProfileGenre, setNewProfileGenre] = useState('Talk & Music');

  const [auditLogs, setAuditLogs] = useState<OperationAuditLogItem[]>(historyService.getAuditLogs());
  const [auditSearch, setAuditSearch] = useState('');
  const [recoveryStatus, setRecoveryStatus] = useState<SystemHealthStatus>(recoveryManager.getStatus());
  const [lastRecoveryMsg, setLastRecoveryMsg] = useState(recoveryManager.getLastResult()?.message || '');
  const [recoveryCount, setRecoveryCount] = useState(recoveryManager.getRecoveryCount());
  const [isRecovering, setIsRecovering] = useState(false);

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

    const unsubHistory = historyService.subscribe(() => {
      setAuditLogs(historyService.getAuditLogs());
    });

    const unsubRecovery = recoveryManager.subscribe((st, res) => {
      setRecoveryStatus(st);
      if (res?.message) setLastRecoveryMsg(res.message);
      setRecoveryCount(recoveryManager.getRecoveryCount());
    });

    return () => {
      unsub();
      unsubHistory();
      unsubRecovery();
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleSwitchProfile = async (id: string) => {
    const success = await stationProfileManager.switchProfile(id);
    if (success) {
      showToast(`Switched active station: ${stationProfileManager.getActiveProfile().name}`);
    }
  };

  const handleSaveStation = (e: React.FormEvent) => {
    e.preventDefault();

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

    shoutcastService.updateConfig({
      ...shoutcastCfg,
      bitrate: selectedBitrate,
    });
    icecastService.updateConfig({
      ...icecastCfg,
      codec: selectedCodec,
      bitrate: selectedBitrate,
    });

    showToast('Configuration parameters applied.');
  };

  const handlePushMetadata = (e: React.FormEvent) => {
    e.preventDefault();
    shoutcastService.setMetadata(metadata);
    icecastService.setMetadata(metadata);
    showToast(`Metadata updated: "${metadata.title}" by "${metadata.artist}"`);
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

    setNewProfileName('');
    setNewProfileCallsign('');
    setShowCreateProfileModal(false);
    showToast(`Created station profile: ${created.name}`);
  };

  const SECTIONS: { id: SettingsSection; label: string; kicker: string }[] = [
    { id: 'station', label: 'Station Profile', kicker: 'Identity' },
    { id: 'shoutcast', label: 'SHOUTcast & Icecast', kicker: 'Transmission' },
    { id: 'audio', label: 'Audio Engine & Processing', kicker: 'Core Audio' },
    { id: 'recording', label: 'Recording & Archives', kicker: 'Storage' },
    { id: 'transcript', label: 'Speech Transcription', kicker: 'Editorial' },
    { id: 'plugins', label: 'Plugin Environment', kicker: 'Extensibility' },
    { id: 'ai', label: 'AI & Control API', kicker: 'Security' },
    { id: 'appearance', label: 'Appearance & Motion', kicker: 'Interface' },
    { id: 'audit', label: 'Operations & Audit Log', kicker: 'Traceability' },
    { id: 'developer', label: 'Developer & System', kicker: 'Diagnostics' },
  ];

  const handleExportProfiles = () => {
    const json = stationProfileManager.exportProfilesJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `station_profiles_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Station profiles exported');
  };

  const handleImportProfiles = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (re) => {
          const content = re.target?.result as string;
          if (content && stationProfileManager.importProfilesJson(content)) {
            showToast('Profiles imported successfully');
          } else {
            showToast('Failed to import profile JSON');
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const handleDuplicateProfile = () => {
    const copy = stationProfileManager.duplicateProfile(activeProfile.id);
    if (copy) {
      showToast(`Duplicated profile: ${copy.name}`);
    }
  };

  const handleTriggerRecovery = async () => {
    setIsRecovering(true);
    showToast('Initiating hardware recovery...');
    const res = await recoveryManager.recoverAudioHardware(undefined, undefined, 'SETTINGS_MANUAL_TRIGGER');
    setIsRecovering(false);
    showToast(res.message);
  };

  const handleExportAuditCsv = () => {
    const csv = historyService.exportAuditCsv();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `operations_audit_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Audit log exported to CSV');
  };

  return (
    <section className="ws-workspace" style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', gap: '14px', height: '100%' }}>
      {/* Command & Control Bar */}
      <div className="ws-command-row">
        <div>
          <div className="ws-kicker">System / Preferences</div>
          <h1 className="ws-title">Station Configuration & Preferences</h1>
          <p className="ws-subtitle">
            Dense utility workspace for server protocols, audio bus headroom, codecs, security policies, and themes.
          </p>
        </div>

        <div className="ws-transport">
          <button type="button" className="ws-primary-action" onClick={handleSaveStation}>
            Save All Preferences
          </button>
        </div>
      </div>

      {/* Main Settings Two-Column Layout */}
      <div className="ws-settings-layout">
        {/* Left Navigator */}
        <nav className="ws-settings-nav" aria-label="Settings categories">
          {SECTIONS.map((sec) => (
            <button
              key={sec.id}
              type="button"
              className="ws-settings-nav-btn"
              data-active={activeSection === sec.id}
              onClick={() => setActiveSection(sec.id)}
            >
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '8px', color: 'var(--ws-subtle)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {sec.kicker}
                </span>
                <span>{sec.label}</span>
              </div>
            </button>
          ))}
        </nav>

        {/* Right Settings Form Body */}
        <div className="ws-settings-body">
          {/* 1. STATION PROFILE */}
          {activeSection === 'station' && (
            <form onSubmit={handleSaveStation} style={{ maxWidth: '640px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '15px', fontWeight: 760, margin: 0 }}>Station Profiles & Identity</h2>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    className="ws-secondary-action"
                    style={{ height: '28px', fontSize: '10px' }}
                    onClick={handleDuplicateProfile}
                    title="Duplicate active profile"
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="ws-secondary-action"
                    style={{ height: '28px', fontSize: '10px' }}
                    onClick={handleExportProfiles}
                    title="Export profiles JSON"
                  >
                    Export JSON
                  </button>
                  <button
                    type="button"
                    className="ws-secondary-action"
                    style={{ height: '28px', fontSize: '10px' }}
                    onClick={handleImportProfiles}
                    title="Import profiles JSON"
                  >
                    Import JSON
                  </button>
                  <button
                    type="button"
                    className="ws-secondary-action"
                    style={{ height: '28px', fontSize: '10px' }}
                    onClick={() => setShowCreateProfileModal(true)}
                  >
                    + New Profile
                  </button>
                </div>
              </div>

              <div className="ws-form-group">
                <label className="ws-form-label">Active Station Profile</label>
                <select
                  className="ws-select"
                  style={{ width: '100%' }}
                  value={activeProfile.id}
                  onChange={(e) => handleSwitchProfile(e.target.value)}
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.callsign})
                    </option>
                  ))}
                </select>
                <div className="ws-form-help">Switching profile switches transmission server addresses and default metadata.</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '12px' }}>
                <div className="ws-form-group">
                  <label className="ws-form-label">Station Name</label>
                  <input
                    type="text"
                    className="ws-input"
                    style={{ width: '100%' }}
                    value={activeProfile.name}
                    onChange={(e) => setActiveProfile({ ...activeProfile, name: e.target.value })}
                    required
                  />
                </div>

                <div className="ws-form-group">
                  <label className="ws-form-label">Callsign</label>
                  <input
                    type="text"
                    className="ws-input"
                    style={{ width: '100%' }}
                    value={activeProfile.callsign}
                    onChange={(e) => setActiveProfile({ ...activeProfile, callsign: e.target.value })}
                  />
                </div>
              </div>

              <div className="ws-form-group">
                <label className="ws-form-label">Slogan / Tagline</label>
                <input
                  type="text"
                  className="ws-input"
                  style={{ width: '100%' }}
                  value={activeProfile.slogan}
                  onChange={(e) => setActiveProfile({ ...activeProfile, slogan: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="ws-form-group">
                  <label className="ws-form-label">Genre</label>
                  <input
                    type="text"
                    className="ws-input"
                    style={{ width: '100%' }}
                    value={activeProfile.genre}
                    onChange={(e) => setActiveProfile({ ...activeProfile, genre: e.target.value })}
                  />
                </div>

                <div className="ws-form-group">
                  <label className="ws-form-label">Website URL</label>
                  <input
                    type="text"
                    className="ws-input"
                    style={{ width: '100%' }}
                    value={activeProfile.website}
                    onChange={(e) => setActiveProfile({ ...activeProfile, website: e.target.value })}
                  />
                </div>
              </div>
            </form>
          )}

          {/* 2. TRANSMISSION (SHOUTCAST & ICECAST) */}
          {activeSection === 'shoutcast' && (
            <form onSubmit={handleSaveStation} style={{ maxWidth: '640px' }}>
              <h2 style={{ fontSize: '15px', fontWeight: 760, marginBottom: '16px' }}>Streaming Transmission Protocols</h2>

              <div className="ws-form-group">
                <label className="ws-form-label">Primary Stream Protocol</label>
                <div className="ws-tabs">
                  <button
                    type="button"
                    className="ws-tab-btn"
                    data-active={serverProtocol === 'shoutcast'}
                    onClick={() => setServerProtocol('shoutcast')}
                  >
                    SHOUTcast v1 / v2 DNAS
                  </button>
                  <button
                    type="button"
                    className="ws-tab-btn"
                    data-active={serverProtocol === 'icecast'}
                    onClick={() => setServerProtocol('icecast')}
                  >
                    Icecast v2.4+ / KH Mount
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                <div className="ws-form-group">
                  <label className="ws-form-label">Server Host / IP</label>
                  <input
                    type="text"
                    className="ws-input"
                    style={{ width: '100%' }}
                    value={serverProtocol === 'shoutcast' ? shoutcastCfg.server : icecastCfg.server}
                    onChange={(e) => {
                      if (serverProtocol === 'shoutcast') {
                        setShoutcastCfg({ ...shoutcastCfg, server: e.target.value });
                      } else {
                        setIcecastCfg({ ...icecastCfg, server: e.target.value });
                      }
                    }}
                    required
                  />
                </div>

                <div className="ws-form-group">
                  <label className="ws-form-label">Port</label>
                  <input
                    type="number"
                    className="ws-input"
                    style={{ width: '100%' }}
                    value={serverProtocol === 'shoutcast' ? shoutcastCfg.port : icecastCfg.port}
                    onChange={(e) => {
                      const p = parseInt(e.target.value, 10) || 8000;
                      if (serverProtocol === 'shoutcast') {
                        setShoutcastCfg({ ...shoutcastCfg, port: p });
                      } else {
                        setIcecastCfg({ ...icecastCfg, port: p });
                      }
                    }}
                    required
                  />
                </div>
              </div>

              {serverProtocol === 'shoutcast' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="ws-form-group">
                    <label className="ws-form-label">Stream ID / Mount Number</label>
                    <input
                      type="number"
                      className="ws-input"
                      style={{ width: '100%' }}
                      value={shoutcastCfg.streamId}
                      onChange={(e) => setShoutcastCfg({ ...shoutcastCfg, streamId: parseInt(e.target.value, 10) || 1 })}
                    />
                  </div>

                  <div className="ws-form-group">
                    <label className="ws-form-label">Source Password</label>
                    <input
                      type="password"
                      className="ws-input"
                      style={{ width: '100%' }}
                      placeholder="••••••••"
                      value={shoutcastCfg.password || ''}
                      onChange={(e) => setShoutcastCfg({ ...shoutcastCfg, password: e.target.value })}
                    />
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '12px' }}>
                  <div className="ws-form-group">
                    <label className="ws-form-label">Mount Point</label>
                    <input
                      type="text"
                      className="ws-input"
                      style={{ width: '100%' }}
                      value={icecastCfg.mountPoint}
                      onChange={(e) => setIcecastCfg({ ...icecastCfg, mountPoint: e.target.value })}
                    />
                  </div>

                  <div className="ws-form-group">
                    <label className="ws-form-label">Username</label>
                    <input
                      type="text"
                      className="ws-input"
                      style={{ width: '100%' }}
                      value={icecastCfg.username}
                      onChange={(e) => setIcecastCfg({ ...icecastCfg, username: e.target.value })}
                    />
                  </div>

                  <div className="ws-form-group">
                    <label className="ws-form-label">Password</label>
                    <input
                      type="password"
                      className="ws-input"
                      style={{ width: '100%' }}
                      placeholder="••••••••"
                      value={icecastCfg.password}
                      onChange={(e) => setIcecastCfg({ ...icecastCfg, password: e.target.value })}
                    />
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="ws-form-group">
                  <label className="ws-form-label">Audio Codec</label>
                  <select
                    className="ws-select"
                    style={{ width: '100%' }}
                    value={selectedCodec}
                    onChange={(e) => setSelectedCodec(e.target.value as AudioCodecType)}
                  >
                    {Object.keys(CODEC_PROFILES).map((c) => (
                      <option key={c} value={c}>
                        {c} ({CODEC_PROFILES[c as AudioCodecType].description})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="ws-form-group">
                  <label className="ws-form-label">Encoding Bitrate (kbps)</label>
                  <select
                    className="ws-select"
                    style={{ width: '100%' }}
                    value={selectedBitrate}
                    onChange={(e) => setSelectedBitrate(parseInt(e.target.value, 10))}
                  >
                    {[64, 96, 128, 160, 192, 256, 320].map((b) => (
                      <option key={b} value={b}>
                        {b} kbps
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Manual ICY metadata tester */}
              <div style={{ borderTop: '1px solid var(--ws-line)', paddingTop: '16px', marginTop: '16px' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 700, margin: '0 0 10px 0' }}>Manual ICY Now-Playing Override</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr auto', gap: '8px', alignItems: 'end' }}>
                  <div>
                    <label className="ws-form-label">Track Title</label>
                    <input
                      type="text"
                      className="ws-input"
                      style={{ width: '100%' }}
                      value={metadata.title}
                      onChange={(e) => setMetadata({ ...metadata, title: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="ws-form-label">Artist / Speaker</label>
                    <input
                      type="text"
                      className="ws-input"
                      style={{ width: '100%' }}
                      value={metadata.artist}
                      onChange={(e) => setMetadata({ ...metadata, artist: e.target.value })}
                    />
                  </div>
                  <button type="button" className="ws-secondary-action" style={{ height: '30px' }} onClick={handlePushMetadata}>
                    Push
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* 3. AUDIO ENGINE */}
          {activeSection === 'audio' && (
            <div style={{ maxWidth: '640px' }}>
              <h2 style={{ fontSize: '15px', fontWeight: 760, marginBottom: '16px' }}>Audio Engine Architecture</h2>

              <div className="ws-banner" data-type="notice" style={{ marginBottom: '16px' }}>
                <div>
                  <strong style={{ display: 'block', color: 'var(--ws-text)' }}>Runtime Audio Pipeline</strong>
                  <span>Web Audio API active in browser mode. Low-latency WASAPI / Rust engine active in Tauri native build.</span>
                </div>
              </div>

              <div className="ws-form-group">
                <label className="ws-form-label">Master True-Peak Limiter Ceiling</label>
                <select className="ws-select" style={{ width: '100%' }} defaultValue="-0.5">
                  <option value="-0.1">-0.1 dBFS (Hot / Peak Safe)</option>
                  <option value="-0.5">-0.5 dBFS (Recommended Broadcast)</option>
                  <option value="-1.0">-1.0 dBFS (EBU R128 Compliant)</option>
                </select>
              </div>

              <div className="ws-form-group">
                <label className="ws-form-label">Nominal Loudness Target</label>
                <select className="ws-select" style={{ width: '100%' }} defaultValue="-14">
                  <option value="-14">-14 LUFS (Online Streaming / Podcast)</option>
                  <option value="-18">-18 LUFS (Digital Radio)</option>
                  <option value="-23">-23 LUFS (EBU R128 Broadcast Standard)</option>
                </select>
              </div>

              <div className="ws-form-group">
                <label className="ws-form-label">Buffer Latency Mode</label>
                <select className="ws-select" style={{ width: '100%' }} defaultValue="low">
                  <option value="ultra">Ultra-Low Latency (5ms - Studio Monitoring)</option>
                  <option value="low">Balanced Low-Latency (20ms - Standard)</option>
                  <option value="safe">Conservative Buffer (100ms - Anti-Underrun)</option>
                </select>
              </div>

              {/* Hardware Disaster Recovery Panel */}
              <div style={{ borderTop: '1px solid var(--ws-line)', paddingTop: '16px', marginTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h3 style={{ fontSize: '13px', fontWeight: 700, margin: 0 }}>Hardware Disaster Recovery</h3>
                  <span className="ws-badge" data-variant={recoveryStatus === 'HEALTHY' ? 'live' : 'offline'}>
                    {recoveryStatus === 'HEALTHY' ? 'HEALTHY' : recoveryStatus === 'RECOVERING' ? 'RECOVERING...' : 'DEGRADED'}
                  </span>
                </div>
                <p style={{ fontSize: '11px', color: 'var(--ws-muted)', margin: '0 0 10px 0' }}>
                  Automatic driver recovery re-attaches audio streams if a USB microphone or monitor speaker disconnects or stalls.
                </p>
                {lastRecoveryMsg && (
                  <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--ws-subtle)', background: 'var(--ws-panel-2)', padding: '6px 10px', borderRadius: '4px', marginBottom: '10px' }}>
                    Status: {lastRecoveryMsg} ({recoveryCount} recovery cycles)
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="ws-secondary-action"
                    onClick={handleTriggerRecovery}
                    disabled={isRecovering}
                  >
                    {isRecovering ? 'Recovering...' : '⟳ Trigger Hardware Recovery'}
                  </button>
                  <button
                    type="button"
                    className="ws-secondary-action"
                    onClick={() => {
                      recoveryManager.restoreWorkstationState();
                      showToast('Workstation state re-synchronized');
                    }}
                  >
                    Restore Startup State
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 4. RECORDING */}
          {activeSection === 'recording' && (
            <div style={{ maxWidth: '640px' }}>
              <h2 style={{ fontSize: '15px', fontWeight: 760, marginBottom: '16px' }}>Broadcast Recording & Archive Parameters</h2>

              <div className="ws-form-group">
                <label className="ws-form-label">Archive Container & Encoding</label>
                <select className="ws-select" style={{ width: '100%' }} defaultValue="opus">
                  <option value="opus">WebM / Opus 192 kbps (Standard Compressed Archive)</option>
                  <option value="wav">WAV Linear PCM 16-bit 48kHz (Lossless Studio Master)</option>
                </select>
              </div>

              <div className="ws-form-group">
                <label className="ws-form-label">Auto-Record Policy</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--ws-text)' }}>
                  <input type="checkbox" defaultChecked style={{ accentColor: 'var(--ws-live)' }} />
                  Automatically start recording when broadcast state transitions to ON AIR
                </label>
              </div>
            </div>
          )}

          {/* 5. TRANSCRIPT */}
          {activeSection === 'transcript' && (
            <div style={{ maxWidth: '640px' }}>
              <h2 style={{ fontSize: '15px', fontWeight: 760, marginBottom: '16px' }}>Speech Transcription Engine</h2>

              <div className="ws-form-group">
                <label className="ws-form-label">Transcription Provider Adapter</label>
                <select
                  className="ws-select"
                  style={{ width: '100%' }}
                  value={transcriptionService.getStatus().config.provider}
                  onChange={(e) => transcriptionService.setProvider(e.target.value)}
                >
                  <option value="local_whisper">Local Whisper (In-Browser Emulated Model)</option>
                  <option value="openai_whisper">OpenAI Whisper Cloud Adapter</option>
                </select>
              </div>

              <div className="ws-form-group">
                <label className="ws-form-label">Spoken Language Recognition</label>
                <select
                  className="ws-select"
                  style={{ width: '100%' }}
                  value={transcriptionService.getStatus().config.language}
                  onChange={(e) => transcriptionService.updateConfig({ language: e.target.value })}
                >
                  <option value="id">Indonesian (Bahasa Indonesia)</option>
                  <option value="en">English (US/UK)</option>
                  <option value="ar">Arabic (العربية)</option>
                </select>
              </div>
            </div>
          )}

          {/* 6. PLUGINS */}
          {activeSection === 'plugins' && (
            <div style={{ maxWidth: '640px' }}>
              <h2 style={{ fontSize: '15px', fontWeight: 760, marginBottom: '16px' }}>Broadcst Plugin Execution Rules</h2>

              <div className="ws-banner" data-type="notice" style={{ marginBottom: '16px' }}>
                <div>
                  <strong style={{ display: 'block', color: 'var(--ws-text)' }}>Current Runtime: In-Process Prototype</strong>
                  <span>Plugin instances currently run in-process within the local application thread. Target architecture: isolated native plugin process.</span>
                </div>
              </div>

              <div className="ws-form-group">
                <label className="ws-form-label">Sideloading Permissions</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--ws-text)', marginBottom: '8px' }}>
                  <input type="checkbox" defaultChecked style={{ accentColor: 'var(--ws-live)' }} />
                  Allow metadata modification plugins
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--ws-text)' }}>
                  <input type="checkbox" defaultChecked style={{ accentColor: 'var(--ws-live)' }} />
                  Allow outbound webhooks and telemetry push
                </label>
              </div>
            </div>
          )}

          {/* 7. AI & CONTROL API */}
          {activeSection === 'ai' && (
            <div style={{ maxWidth: '640px' }}>
              <h2 style={{ fontSize: '15px', fontWeight: 760, marginBottom: '16px' }}>AI Assistant & Control API Policies</h2>

              <div className="ws-form-group">
                <label className="ws-form-label">Control API Security Policy</label>
                <div style={{ fontSize: '11px', color: 'var(--ws-muted)', marginBottom: '10px' }}>
                  All actions taken by the AI Assistant or MCP external agents are dispatched through the same Control API used by human operators.
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--ws-text)', marginBottom: '8px' }}>
                  <input
                    type="checkbox"
                    checked={controlApi.getPolicy().allowAiCriticalCommands}
                    onChange={(e) => {
                      controlApi.setPolicy({ allowAiCriticalCommands: e.target.checked });
                      showToast(`AI critical command policy: ${e.target.checked ? 'Allowed' : 'Blocked'}`);
                    }}
                    style={{ accentColor: 'var(--ws-live)' }}
                  />
                  Allow AI Assistant to execute critical actions (Start/Stop Broadcast) without human confirmation
                </label>
              </div>
            </div>
          )}

          {/* 8. APPEARANCE & MOTION */}
          {activeSection === 'appearance' && (
            <div style={{ maxWidth: '640px' }}>
              <h2 style={{ fontSize: '15px', fontWeight: 760, marginBottom: '16px' }}>Interface Theme & Motion System</h2>

              <div className="ws-form-group">
                <label className="ws-form-label">Color Theme</label>
                <div className="ws-tabs">
                  <button
                    type="button"
                    className="ws-tab-btn"
                    data-active={theme === 'dark'}
                    onClick={() => onSetTheme?.('dark')}
                  >
                    Studio Dark (Primary)
                  </button>
                  <button
                    type="button"
                    className="ws-tab-btn"
                    data-active={theme === 'light'}
                    onClick={() => onSetTheme?.('light')}
                  >
                    Studio Light (WCAG AA Compliant)
                  </button>
                </div>
              </div>

              <div className="ws-form-group" style={{ marginTop: '16px' }}>
                <label className="ws-form-label">Motion System Mode</label>
                <div style={{ fontSize: '11px', color: 'var(--ws-muted)', lineHeight: 1.5 }}>
                  Broadcst Studio uses Motion 3 (real-time data-driven meters and waveform animation). When system <code>prefers-reduced-motion</code> is active, all continuous animations are automatically disabled.
                </div>
              </div>
            </div>
          )}

          {/* 9. OPERATIONS AUDIT LOG */}
          {activeSection === 'audit' && (
            <div style={{ maxWidth: '800px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <h2 style={{ fontSize: '15px', fontWeight: 760, margin: 0 }}>Operations & Audit History</h2>
                  <div style={{ fontSize: '11px', color: 'var(--ws-muted)' }}>
                    Authoritative execution trace for operator macros, hotkeys, schedules, and automation triggers.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button type="button" className="ws-secondary-action" onClick={handleExportAuditCsv}>
                    Export CSV
                  </button>
                  <button
                    type="button"
                    className="ws-secondary-action"
                    style={{ color: 'var(--ws-danger)' }}
                    onClick={() => {
                      historyService.clear('AUDIT');
                      showToast('Audit log cleared');
                    }}
                  >
                    Clear Log
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <input
                  type="text"
                  className="ws-input"
                  style={{ width: '100%' }}
                  placeholder="Filter audit logs by action or caller..."
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                />
              </div>

              <div
                style={{
                  border: '1px solid var(--ws-line)',
                  borderRadius: '6px',
                  background: 'var(--ws-panel-2)',
                  maxHeight: '380px',
                  overflowY: 'auto',
                }}
              >
                {auditLogs.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--ws-muted)', fontSize: '12px' }}>
                    No operations recorded yet. Dispatched actions from UI, hotkeys, schedule, or automation will appear here.
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--ws-line)', textAlign: 'left', color: 'var(--ws-subtle)' }}>
                        <th style={{ padding: '8px 10px' }}>Time</th>
                        <th style={{ padding: '8px 10px' }}>Action</th>
                        <th style={{ padding: '8px 10px' }}>Caller</th>
                        <th style={{ padding: '8px 10px' }}>Duration</th>
                        <th style={{ padding: '8px 10px' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs
                        .filter((l) => {
                          if (!auditSearch) return true;
                          const q = auditSearch.toLowerCase();
                          return l.action.toLowerCase().includes(q) || l.caller.toLowerCase().includes(q);
                        })
                        .map((entry) => (
                          <tr key={entry.id} style={{ borderBottom: '1px solid var(--ws-line)' }}>
                            <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)' }}>
                              {new Date(entry.timestamp).toLocaleTimeString()}
                            </td>
                            <td style={{ padding: '6px 10px', fontWeight: 600 }}>{entry.action}</td>
                            <td style={{ padding: '6px 10px', color: 'var(--ws-muted)' }}>{entry.caller}</td>
                            <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)' }}>{entry.durationMs}ms</td>
                            <td style={{ padding: '6px 10px' }}>
                              <span
                                style={{
                                  fontSize: '9px',
                                  fontWeight: 700,
                                  padding: '2px 6px',
                                  borderRadius: '3px',
                                  background: entry.success ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                  color: entry.success ? 'var(--ws-live)' : 'var(--ws-danger)',
                                }}
                              >
                                {entry.success ? 'SUCCESS' : 'FAILED'}
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* 9. DEVELOPER & SYSTEM */}
          {activeSection === 'developer' && (
            <div style={{ maxWidth: '640px' }}>
              <h2 style={{ fontSize: '15px', fontWeight: 760, marginBottom: '16px' }}>Developer Diagnostics & Environment</h2>

              <div className="ws-form-group">
                <label className="ws-form-label">Log Verbosity Level</label>
                <select className="ws-select" style={{ width: '100%' }} defaultValue="info">
                  <option value="debug">DEBUG (Verbose IPC + VU Meter events)</option>
                  <option value="info">INFO (Operational broadcast state changes)</option>
                  <option value="warn">WARN (Errors and stream reconnects only)</option>
                </select>
              </div>

              <div style={{ marginTop: '20px', borderTop: '1px solid var(--ws-line)', paddingTop: '16px' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 700, margin: '0 0 8px 0', color: 'var(--ws-danger)' }}>
                  Reset Station Storage
                </h3>
                <p style={{ fontSize: '11px', color: 'var(--ws-muted)', margin: '0 0 10px 0' }}>
                  Clear all local station profiles, stored transcripts, and playlists from browser storage.
                </p>
                <button
                  type="button"
                  className="ws-secondary-action"
                  style={{ color: 'var(--ws-danger)', borderColor: 'var(--ws-danger)' }}
                  onClick={() => {
                    if (window.confirm('Reset local cache?')) {
                      localStorage.clear();
                      window.location.reload();
                    }
                  }}
                >
                  Reset Local Storage & Reload
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Station Profile Modal */}
      {showCreateProfileModal && (
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
              width: 'min(460px, 92vw)',
              background: 'var(--ws-panel)',
              border: '1px solid var(--ws-line)',
              borderRadius: '8px',
              padding: '18px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 760 }}>Create Station Profile</h3>
              <button
                type="button"
                className="ws-mini-action"
                onClick={() => setShowCreateProfileModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateProfile} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label className="ws-form-label">Station Name</label>
                <input
                  type="text"
                  className="ws-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. Radio Suara Hidayah"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="ws-form-label">Callsign</label>
                <input
                  type="text"
                  className="ws-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. RSH-FM"
                  value={newProfileCallsign}
                  onChange={(e) => setNewProfileCallsign(e.target.value)}
                />
              </div>

              <div>
                <label className="ws-form-label">Genre</label>
                <input
                  type="text"
                  className="ws-input"
                  style={{ width: '100%' }}
                  value={newProfileGenre}
                  onChange={(e) => setNewProfileGenre(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                <button
                  type="button"
                  className="ws-secondary-action"
                  onClick={() => setShowCreateProfileModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="ws-primary-action">
                  Create Station
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
