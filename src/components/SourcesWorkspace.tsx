import React, { useState, useEffect } from 'react';
import { deviceManager } from '../services/deviceManager';
import { audioEngine } from '../services/audioEngine';
import { playbackService } from '../services/playbackService';
import { AudioDevice } from '../types/audio';

export const SourcesWorkspace: React.FC = () => {
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>(deviceManager.getDevices());
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string>(deviceManager.getSelectedDeviceId());
  const [selectedOutputId, setSelectedOutputId] = useState<string>('');
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [isMonitoring, setIsMonitoring] = useState<boolean>(false);
  const [activeMonitorDevice, setActiveMonitorDevice] = useState<string | null>(null);
  const [micPeak, setMicPeak] = useState<number>(-90);
  const [micRms, setMicRms] = useState<number>(-90);
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

    // 3. Listen to playback snapshots for monitor status
    const unsubSnap = playbackService.onSnapshot((snap) => {
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

    return () => {
      unsubSnap();
      unsubDevices();
      unsubMeter();
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
          padding: '14px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div className="ws-section-head" style={{ padding: 0 }}>
          <h2>Program Path Signal Matrix</h2>
          <span>Deterministic Signal Flow: Hardware & Playback → Mixer → Master → Endpoints</span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '10px',
            alignItems: 'center',
          }}
        >
          {/* Node 1: MIC */}
          <div style={{ padding: '10px', background: 'var(--ws-panel-2)', borderRadius: '6px', border: '1px solid var(--ws-line)' }}>
            <div style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>INPUT 1</div>
            <div style={{ fontWeight: 700, fontSize: '12px', color: 'var(--ws-text)' }}>MIC</div>
            <div style={{ marginTop: '6px' }}>
              <span className="ws-badge" data-variant={isCapturing ? 'live' : 'neutral'} style={{ fontSize: '9px', padding: '1px 5px' }}>
                {isCapturing ? 'ACTIVE' : 'STANDBY'}
              </span>
            </div>
          </div>

          {/* Node 2: DECK A */}
          <div style={{ padding: '10px', background: 'var(--ws-panel-2)', borderRadius: '6px', border: '1px solid var(--ws-line)' }}>
            <div style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>PLAYBACK</div>
            <div style={{ fontWeight: 700, fontSize: '12px', color: 'var(--ws-text)' }}>DECK A</div>
            <div style={{ marginTop: '6px' }}>
              <span className="ws-badge" data-variant={playbackService.getSnapshot().deckA.state === 'playing' ? 'live' : 'neutral'} style={{ fontSize: '9px', padding: '1px 5px' }}>
                {playbackService.getSnapshot().deckA.state.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Node 3: DECK B */}
          <div style={{ padding: '10px', background: 'var(--ws-panel-2)', borderRadius: '6px', border: '1px solid var(--ws-line)' }}>
            <div style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>PLAYBACK</div>
            <div style={{ fontWeight: 700, fontSize: '12px', color: 'var(--ws-text)' }}>DECK B</div>
            <div style={{ marginTop: '6px' }}>
              <span className="ws-badge" data-variant={playbackService.getSnapshot().deckB.state === 'playing' ? 'live' : 'neutral'} style={{ fontSize: '9px', padding: '1px 5px' }}>
                {playbackService.getSnapshot().deckB.state.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Node 4: MIXER & MASTER */}
          <div style={{ padding: '10px', background: 'var(--ws-panel-3)', borderRadius: '6px', border: '1px solid var(--ws-line)' }}>
            <div style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>BUS SUM</div>
            <div style={{ fontWeight: 700, fontSize: '12px', color: 'var(--ws-text)' }}>MASTER</div>
            <div style={{ marginTop: '6px' }}>
              <span className="ws-badge" data-variant="live" style={{ fontSize: '9px', padding: '1px 5px' }}>
                48kHz PCM
              </span>
            </div>
          </div>

          {/* Node 5: MONITOR */}
          <div style={{ padding: '10px', background: 'var(--ws-panel-2)', borderRadius: '6px', border: '1px solid var(--ws-line)' }}>
            <div style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>ENDPOINT</div>
            <div style={{ fontWeight: 700, fontSize: '12px', color: 'var(--ws-text)' }}>MONITOR</div>
            <div style={{ marginTop: '6px' }}>
              <span className="ws-badge" data-variant={isMonitoring ? 'live' : 'neutral'} style={{ fontSize: '9px', padding: '1px 5px' }}>
                {isMonitoring ? 'OUTPUT ON' : 'MUTED'}
              </span>
            </div>
          </div>

          {/* Node 6: RECORDER */}
          <div style={{ padding: '10px', background: 'var(--ws-panel-2)', borderRadius: '6px', border: '1px solid var(--ws-line)' }}>
            <div style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>ARCHIVE</div>
            <div style={{ fontWeight: 700, fontSize: '12px', color: 'var(--ws-text)' }}>RECORDER</div>
            <div style={{ marginTop: '6px' }}>
              <span className="ws-badge" data-variant={playbackService.getSnapshot().isRecording ? 'danger' : 'neutral'} style={{ fontSize: '9px', padding: '1px 5px' }}>
                {playbackService.getSnapshot().isRecording ? '● WRITING' : 'IDLE'}
              </span>
            </div>
          </div>

          {/* Node 7: SHOUTCAST STREAM */}
          <div style={{ padding: '10px', background: 'var(--ws-panel-2)', borderRadius: '6px', border: '1px solid var(--ws-line)' }}>
            <div style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>TRANSMISSION</div>
            <div style={{ fontWeight: 700, fontSize: '12px', color: 'var(--ws-text)' }}>STREAM</div>
            <div style={{ marginTop: '6px' }}>
              <span className="ws-badge" data-variant={playbackService.getSnapshot().broadcastState === 'Connected' ? 'live' : 'neutral'} style={{ fontSize: '9px', padding: '1px 5px' }}>
                {playbackService.getSnapshot().broadcastState.toUpperCase()}
              </span>
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
