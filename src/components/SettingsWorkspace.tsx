import React, { useState, useEffect } from 'react';
import { shoutcastService } from '../services/shoutcastService';
import { icecastService, IcecastConfig } from '../services/icecast/icecastService';
import { stationProfileManager } from '../services/profile/stationProfileManager';
import { StationProfile } from '../services/profile/types';
import { AudioCodecType, CODEC_PROFILES } from '../types/codecs';
import { ShoutcastConfig, TrackMetadata } from '../types/broadcast';
import { transcriptionService } from '../services/transcription/transcriptionService';
import { controlApi } from '../services/controlApi';

type SettingsSection =
  | 'station'
  | 'shoutcast'
  | 'audio'
  | 'recording'
  | 'transcript'
  | 'plugins'
  | 'ai'
  | 'appearance'
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
    { id: 'developer', label: 'Developer & System', kicker: 'Diagnostics' },
  ];

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
                <button
                  type="button"
                  className="ws-secondary-action"
                  style={{ height: '28px', fontSize: '10px' }}
                  onClick={() => setShowCreateProfileModal(true)}
                >
                  + New Profile
                </button>
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
