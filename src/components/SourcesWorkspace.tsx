import React, { useState, useEffect } from 'react';
import { deviceManager } from '../services/deviceManager';
import { audioEngine } from '../services/audioEngine';
import { playbackService } from '../services/playbackService';
import { recoveryManager, SystemHealthStatus } from '../services/recovery/recoveryManager';
import { AudioDevice } from '../types/audio';
import { FullPlaybackSnapshot } from '../types/ipc';

export const SourcesWorkspace: React.FC = () => {
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>(deviceManager.getDevices());
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string>(deviceManager.getSelectedDeviceId());
  const [selectedOutputId, setSelectedOutputId] = useState<string>('');
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [isMonitoring, setIsMonitoring] = useState<boolean>(false);
  const [activeMonitorDevice, setActiveMonitorDevice] = useState<string | null>(null);
  const [playbackSnap, setPlaybackSnap] = useState<FullPlaybackSnapshot>(playbackService.getSnapshot());
  const [micPeak, setMicPeak] = useState<number>(-90);
  const [micRms, setMicRms] = useState<number>(-90);
  const [recoveryStatus, setRecoveryStatus] = useState<SystemHealthStatus>(recoveryManager.getStatus());
  const [lastRecoveryMsg, setLastRecoveryMsg] = useState<string>(recoveryManager.getLastResult()?.message || '');
  const [isRecovering, setIsRecovering] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    // 1. Enumerate input devices
    deviceManager.enumerateDevices().then((devs) => {
      setInputDevices(devs);
      setSelectedInputId(deviceManager.getSelectedDeviceId());
    });

    // 2. Enumerate output devices via native monitor manager
    playbackService.getOutputDevices().then((outDevs) => {
      setOutputDevices(outDevs);
      const defOut = outDevs.find((d) => d.isDefault) || outDevs[0];
      if (defOut) {
        setSelectedOutputId(defOut.id);
      }
    });

    // 3. Listen to playback snapshots for monitor status and deck states
    const unsubSnap = playbackService.onSnapshot((snap) => {
      setPlaybackSnap(snap);
      setIsMonitoring(snap.isMonitoring);
      setActiveMonitorDevice(snap.monitorDevice);
    });

    const unsubDevices = deviceManager.onDevicesChanged((devs) => {
      setInputDevices(devs);
    });

    const unsubMeter = audioEngine.onMeterUpdate((channelId, peakDb, rmsDb) => {
      if (channelId === 'mic') {
        setMicPeak(peakDb);
        setMicRms(rmsDb ?? peakDb - 6);
      }
    });

    const unsubRecovery = recoveryManager.subscribe((st, res) => {
      setRecoveryStatus(st);
      if (res?.message) setLastRecoveryMsg(res.message);
    });

    return () => {
      unsubSnap();
      unsubDevices();
      unsubMeter();
      unsubRecovery();
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleInputSelect = async (deviceId: string) => {
    setSelectedInputId(deviceId);
    deviceManager.setSelectedDeviceId(deviceId);
    if (isCapturing) {
      await audioEngine.startMicrophoneCapture(deviceId);
    }
    const dev = inputDevices.find((d) => d.id === deviceId);
    showToast(`Assigned input hardware: ${dev?.name || deviceId}`);
  };

  const handleToggleInputCapture = async () => {
    if (isCapturing) {
      audioEngine.stopMicrophoneCapture();
      setIsCapturing(false);
      setMicPeak(-90);
      setMicRms(-90);
      showToast('Capture monitoring stopped');
    } else {
      const ok = await audioEngine.startMicrophoneCapture(selectedInputId);
      setIsCapturing(ok);
      if (ok) {
        showToast('Live microphone hardware capture active');
      } else {
        showToast('Failed to start microphone capture. Verify device status.');
      }
    }
  };

  const handleOutputSelect = (deviceId: string) => {
    setSelectedOutputId(deviceId);
    const dev = outputDevices.find((d) => d.id === deviceId);
    showToast(`Selected monitor endpoint: ${dev?.name || deviceId}`);
  };

  const handleToggleProgramMonitor = async () => {
    if (isMonitoring) {
      await playbackService.stopMonitor();
      setIsMonitoring(false);
      showToast('Hardware monitor output stopped');
    } else {
      const devName = await playbackService.startMonitor(selectedOutputId || undefined);
      if (devName) {
        setIsMonitoring(true);
        setActiveMonitorDevice(devName);
        showToast(`Program Master monitoring active on: ${devName}`);
      } else {
        showToast('Failed to start hardware monitor. Verify output device.');
      }
    }
  };

  const handleRefreshAll = async () => {
    const [inDevs, outDevs] = await Promise.all([
      deviceManager.enumerateDevices(),
      playbackService.getOutputDevices(),
    ]);
    setInputDevices(inDevs);
    setOutputDevices(outDevs);
    showToast(`Scanned: ${inDevs.length} input(s), ${outDevs.length} output(s)`);
  };

  const activeInput = inputDevices.find((d) => d.id === selectedInputId) || inputDevices[0];
  const activeOutput = outputDevices.find((d) => d.id === selectedOutputId) || outputDevices[0];

  const dbToUnit = (db: number) => Math.max(0, Math.min(1, (db + 60) / 60));

  return (
    <section className="ws-workspace" style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', overflow: 'auto' }}>
      {/* Command & Control Bar */}
      <div className="ws-command-row">
        <div>
          <div className="ws-kicker">Hardware / Routing Matrix</div>
          <h1 className="ws-title">Physical Audio Endpoints</h1>
          <p className="ws-subtitle">
            Direct WASAPI/CPAL endpoint configuration for hardware microphones, broadcast decks, and physical headphones/speakers monitoring.
          </p>
        </div>

        <div className="ws-transport">
          <button
            type="button"
            className="ws-secondary-action"
            onClick={async () => {
              setIsRecovering(true);
              showToast('Attempting hardware recovery...');
              const res = await recoveryManager.recoverAudioHardware(selectedInputId, selectedOutputId, 'MANUAL_SOURCES_UI');
              setIsRecovering(false);
              showToast(res.message);
            }}
            disabled={isRecovering}
            style={{
              borderColor: recoveryStatus === 'HEALTHY' ? 'var(--ws-line)' : 'var(--ws-live)',
              color: recoveryStatus === 'HEALTHY' ? 'var(--ws-text)' : 'var(--ws-live)',
            }}
            title={lastRecoveryMsg || "Re-synchronize physical WASAPI audio drivers and restore capture stream"}
          >
            {isRecovering ? 'Recovering...' : '⟳ Recover Hardware'}
          </button>
          <button type="button" className="ws-secondary-action" onClick={handleRefreshAll}>
            Rescan Hardware
          </button>
          <button
            type="button"
            className="ws-secondary-action"
            onClick={handleToggleInputCapture}
            data-live={isCapturing}
          >
            {isCapturing ? 'Stop Input Mic' : 'Start Input Mic'}
          </button>
          <button
            type="button"
            className="ws-primary-action"
            onClick={handleToggleProgramMonitor}
            data-live={isMonitoring}
          >
            {isMonitoring ? 'Stop Monitor Speaker' : 'Monitor Program Master'}
          </button>
        </div>
      </div>

      {/* Active Device Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>
        {/* Active Input Card */}
        <div
          style={{
            border: '1px solid var(--ws-line)',
            borderRadius: '7px',
            background: 'var(--ws-panel)',
            padding: '14px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="ws-badge" data-variant={isCapturing ? 'live' : 'neutral'}>
              {isCapturing ? 'INPUT LIVE' : 'INPUT STANDBY'}
            </span>
            <span className="ws-tag">MIC CHANNEL 1</span>
          </div>

          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ws-text)' }}>
              {activeInput ? activeInput.name : 'No microphone selected'}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--ws-muted)', marginTop: '2px' }}>
              ID: {activeInput?.id || 'none'} • {activeInput?.channels || 2} Ch @ {activeInput?.sampleRate || 48000} Hz
            </div>
          </div>

          {/* Level Meter */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--ws-muted)', marginBottom: '4px' }}>
              <span>MIC SIGNAL</span>
              <span>RMS: {micRms.toFixed(1)} dBFS</span>
            </div>
            <div style={{ height: '10px', background: 'var(--ws-panel-3)', border: '1px solid var(--ws-line)', borderRadius: '3px', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${dbToUnit(micRms) * 100}%`,
                  background: micPeak >= -3 ? 'var(--ws-danger)' : 'var(--ws-live)',
                  transition: 'width 80ms linear',
                }}
              />
            </div>
          </div>
        </div>

        {/* Active Monitor Output Card */}
        <div
          style={{
            border: '1px solid var(--ws-line)',
            borderRadius: '7px',
            background: 'var(--ws-panel)',
            padding: '14px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="ws-badge" data-variant={isMonitoring ? 'live' : 'neutral'}>
              {isMonitoring ? 'MONITORING ACTIVE' : 'MONITOR IDLE'}
            </span>
            <span className="ws-tag">PROGRAM MASTER BUS</span>
          </div>

          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ws-text)' }}>
              {activeMonitorDevice || (activeOutput ? activeOutput.name : 'No output speaker selected')}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--ws-muted)', marginTop: '2px' }}>
              ID: {activeOutput?.id || 'none'} • {activeOutput?.channels || 2} Ch @ {activeOutput?.sampleRate || 48000} Hz
            </div>
          </div>

          <div style={{ fontSize: '11px', color: 'var(--ws-muted)', background: 'var(--ws-panel-2)', padding: '8px 10px', borderRadius: '4px' }}>
            Taps Master program post-summing and feeds real CPAL physical output stream with zero blocking.
          </div>
        </div>
      </div>

      {/* Program Path Routing Console */}
      <div
        style={{
          border: '1px solid var(--ws-line)',
          borderRadius: '7px',
          background: 'var(--ws-panel)',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div className="ws-section-head" style={{ padding: 0 }}>
          <h2>Program Path Signal Matrix</h2>
          <span>Deterministic Signal Flow: Hardware &amp; Playback Sources → Mixer → Master → Endpoints</span>
        </div>

        {/* Layer 1: Sources (MIC, DECK A, DECK B) */}
        <div>
          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--ws-muted)', marginBottom: '8px' }}>
            LAYER 1: AUDIO SOURCES (MIC + PLAYBACK DECKS)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            {/* MIC */}
            <div style={{ padding: '12px', background: 'var(--ws-panel-2)', borderRadius: '6px', border: '1px solid var(--ws-line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>INPUT 1 (HARDWARE)</span>
                <span className="ws-badge" data-variant={isCapturing ? 'live' : 'neutral'} style={{ fontSize: '9px', padding: '1px 5px' }}>
                  {isCapturing ? 'CAPTURING' : 'STANDBY'}
                </span>
              </div>
              <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--ws-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {activeInput ? activeInput.name : 'No Mic Connected'}
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--ws-subtle)', fontFamily: 'var(--font-mono)', marginTop: '3px' }}>
                {activeInput?.channels || 2} Ch • {activeInput?.sampleRate || 48000} Hz
              </div>
            </div>

            {/* DECK A */}
            <div style={{ padding: '12px', background: 'var(--ws-panel-2)', borderRadius: '6px', border: '1px solid var(--ws-line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>PLAYBACK DECK A</span>
                <span className="ws-badge" data-variant={playbackSnap.deckA.state === 'playing' ? 'live' : 'neutral'} style={{ fontSize: '9px', padding: '1px 5px' }}>
                  {playbackSnap.deckA.state.toUpperCase()}
                </span>
              </div>
              <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--ws-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {playbackSnap.deckA.track ? playbackSnap.deckA.track.title : 'No Track Loaded'}
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--ws-subtle)', fontFamily: 'var(--font-mono)', marginTop: '3px' }}>
                {playbackSnap.deckA.muted ? 'MUTED' : `Gain: ${playbackSnap.deckA.gainDb.toFixed(1)} dB`} {playbackSnap.deckA.cue ? '• CUE ON' : ''}
              </div>
            </div>

            {/* DECK B */}
            <div style={{ padding: '12px', background: 'var(--ws-panel-2)', borderRadius: '6px', border: '1px solid var(--ws-line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>PLAYBACK DECK B</span>
                <span className="ws-badge" data-variant={playbackSnap.deckB.state === 'playing' ? 'live' : 'neutral'} style={{ fontSize: '9px', padding: '1px 5px' }}>
                  {playbackSnap.deckB.state.toUpperCase()}
                </span>
              </div>
              <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--ws-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {playbackSnap.deckB.track ? playbackSnap.deckB.track.title : 'No Track Loaded'}
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--ws-subtle)', fontFamily: 'var(--font-mono)', marginTop: '3px' }}>
                {playbackSnap.deckB.muted ? 'MUTED' : `Gain: ${playbackSnap.deckB.gainDb.toFixed(1)} dB`} {playbackSnap.deckB.cue ? '• CUE ON' : ''}
              </div>
            </div>
          </div>
        </div>

        {/* Bus Direction Arrow */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ws-subtle)', fontSize: '12px', gap: '8px' }}>
          <span>↓</span>
          <span style={{ fontSize: '10px', letterSpacing: '0.06em' }}>SUMMING BUS (CROSSFADER: {playbackSnap.crossfader.toFixed(2)})</span>
          <span>↓</span>
        </div>

        {/* Layer 2: Mixer & Master */}
        <div style={{ padding: '14px', background: 'var(--ws-panel-3)', borderRadius: '6px', border: '1px solid var(--ws-line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--ws-text)' }}>PROGRAM MASTER CONSOLE</span>
              <span className="ws-badge" data-variant="live" style={{ fontSize: '9px', padding: '1px 6px' }}>
                48,000 Hz STEREO PCM
              </span>
            </div>
            <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--ws-muted)' }}>
              CPAL Deterministic Lock-Free Summing
            </span>
          </div>
          <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: 'var(--ws-subtle)' }}>
            <span>Input Routing: Mic (Ch 1) + Deck A + Deck B</span>
            <span>•</span>
            <span>Master Processing: Peak Limiter + Headroom Protection</span>
            <span>•</span>
            <span>Monitoring Tap: Post-Master Bus</span>
          </div>
        </div>

        {/* Bus Direction Arrow */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ws-subtle)', fontSize: '12px', gap: '8px' }}>
          <span>↓</span>
          <span style={{ fontSize: '10px', letterSpacing: '0.06em' }}>DISTRIBUTION ROUTING</span>
          <span>↓</span>
        </div>

        {/* Layer 3: Endpoints (MONITOR, RECORD, STREAM) */}
        <div>
          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--ws-muted)', marginBottom: '8px' }}>
            LAYER 3: DISTRIBUTION ENDPOINTS (HARDWARE MONITOR + ARCHIVE RECORDER + BROADCAST STREAM)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            {/* MONITOR */}
            <div style={{ padding: '12px', background: 'var(--ws-panel-2)', borderRadius: '6px', border: '1px solid var(--ws-line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>PHYSICAL MONITOR</span>
                <span className="ws-badge" data-variant={isMonitoring ? 'live' : 'neutral'} style={{ fontSize: '9px', padding: '1px 5px' }}>
                  {isMonitoring ? 'MONITORING' : 'IDLE'}
                </span>
              </div>
              <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--ws-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {activeMonitorDevice || (activeOutput ? activeOutput.name : 'No Output Endpoint')}
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--ws-subtle)', fontFamily: 'var(--font-mono)', marginTop: '3px' }}>
                {activeOutput?.channels || 2} Ch • {activeOutput?.sampleRate || 48000} Hz
              </div>
            </div>

            {/* RECORDER */}
            <div style={{ padding: '12px', background: 'var(--ws-panel-2)', borderRadius: '6px', border: '1px solid var(--ws-line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>PROGRAM RECORDER</span>
                <span className="ws-badge" data-variant={playbackSnap.isRecording ? 'danger' : 'neutral'} style={{ fontSize: '9px', padding: '1px 5px' }}>
                  {playbackSnap.isRecording ? '● WRITING' : 'STANDBY'}
                </span>
              </div>
              <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--ws-text)' }}>
                {playbackSnap.isRecording ? 'Session Master Recording' : 'WAV Broadcast Archive'}
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--ws-subtle)', fontFamily: 'var(--font-mono)', marginTop: '3px' }}>
                Post-Master PCM • Lossless 16/24-bit
              </div>
            </div>

            {/* STREAM */}
            <div style={{ padding: '12px', background: 'var(--ws-panel-2)', borderRadius: '6px', border: '1px solid var(--ws-line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>SHOUTCAST STREAM</span>
                <span className="ws-badge" data-variant={playbackSnap.broadcastState === 'Connected' ? 'live' : 'neutral'} style={{ fontSize: '9px', padding: '1px 5px' }}>
                  {playbackSnap.broadcastState.toUpperCase()}
                </span>
              </div>
              <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--ws-text)' }}>
                {playbackSnap.broadcastState === 'Connected' ? 'Live Transmitting' : 'SHOUTcast v1 / v2'}
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--ws-subtle)', fontFamily: 'var(--font-mono)', marginTop: '3px' }}>
                MP3/AAC Stream • Metadata Sync
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Input Interfaces Table */}
      <div
        style={{
          border: '1px solid var(--ws-line)',
          borderRadius: '7px',
          background: 'var(--ws-panel)',
          overflow: 'hidden',
        }}
      >
        <div className="ws-section-head">
          <h2>Physical Audio Inputs ({inputDevices.length})</h2>
          <span>Microphone & Line Sources</span>
        </div>

        <div style={{ overflow: 'auto', maxHeight: '180px' }}>
          <table className="ws-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}>#</th>
                <th>Device Endpoint</th>
                <th style={{ width: '110px' }}>Channels</th>
                <th style={{ width: '110px' }}>Sample Rate</th>
                <th style={{ width: '110px' }}>State</th>
                <th style={{ width: '140px', textAlign: 'right' }}>Route</th>
              </tr>
            </thead>
            <tbody>
              {inputDevices.map((device, index) => {
                const isSelected = selectedInputId === device.id;
                return (
                  <tr key={device.id} style={{ background: isSelected ? 'color-mix(in srgb, var(--ws-live) 4%, transparent)' : undefined }}>
                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--ws-subtle)' }}>
                      {(index + 1).toString().padStart(2, '0')}
                    </td>
                    <td>
                      <div style={{ fontWeight: 650, color: isSelected ? 'var(--ws-live)' : 'var(--ws-text)' }}>
                        {device.name}
                      </div>
                      <div style={{ fontSize: '9.5px', color: 'var(--ws-subtle)', fontFamily: 'var(--font-mono)' }}>
                        {device.id} {device.isDefault ? '• (Default)' : ''}
                      </div>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{device.channels} Ch</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{device.sampleRate} Hz</td>
                    <td>
                      <span className="ws-badge" data-variant={isSelected ? (isCapturing ? 'live' : 'warning') : 'neutral'}>
                        {isSelected ? (isCapturing ? 'ACTIVE' : 'READY') : 'IDLE'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="ws-mini-action"
                        style={{
                          borderColor: isSelected ? 'var(--ws-live)' : undefined,
                          color: isSelected ? 'var(--ws-live)' : undefined,
                        }}
                        onClick={() => handleInputSelect(device.id)}
                      >
                        {isSelected ? '✓ Assigned' : 'Select'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Output Interfaces Table */}
      <div
        style={{
          border: '1px solid var(--ws-line)',
          borderRadius: '7px',
          background: 'var(--ws-panel)',
          overflow: 'hidden',
        }}
      >
        <div className="ws-section-head">
          <h2>Physical Audio Outputs ({outputDevices.length})</h2>
          <span>Headphones & Speaker Monitoring</span>
        </div>

        <div style={{ overflow: 'auto', maxHeight: '180px' }}>
          <table className="ws-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}>#</th>
                <th>Output Endpoint</th>
                <th style={{ width: '110px' }}>Channels</th>
                <th style={{ width: '110px' }}>Sample Rate</th>
                <th style={{ width: '110px' }}>Status</th>
                <th style={{ width: '140px', textAlign: 'right' }}>Route Monitor</th>
              </tr>
            </thead>
            <tbody>
              {outputDevices.map((device, index) => {
                const isSelected = selectedOutputId === device.id;
                return (
                  <tr key={device.id} style={{ background: isSelected ? 'color-mix(in srgb, var(--ws-live) 4%, transparent)' : undefined }}>
                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--ws-subtle)' }}>
                      {(index + 1).toString().padStart(2, '0')}
                    </td>
                    <td>
                      <div style={{ fontWeight: 650, color: isSelected ? 'var(--ws-live)' : 'var(--ws-text)' }}>
                        {device.name}
                      </div>
                      <div style={{ fontSize: '9.5px', color: 'var(--ws-subtle)', fontFamily: 'var(--font-mono)' }}>
                        {device.id} {device.isDefault ? '• (Default Output)' : ''}
                      </div>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{device.channels} Ch</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{device.sampleRate} Hz</td>
                    <td>
                      <span className="ws-badge" data-variant={isSelected ? (isMonitoring ? 'live' : 'warning') : 'neutral'}>
                        {isSelected ? (isMonitoring ? 'MONITORING' : 'READY') : 'IDLE'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="ws-mini-action"
                        style={{
                          borderColor: isSelected ? 'var(--ws-live)' : undefined,
                          color: isSelected ? 'var(--ws-live)' : undefined,
                        }}
                        onClick={() => handleOutputSelect(device.id)}
                      >
                        {isSelected ? '✓ Assigned' : 'Select'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {toastMessage && <div className="ws-toast">{toastMessage}</div>}
    </section>
  );
};
