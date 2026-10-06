import React, { useState, useEffect } from 'react';
import { deviceManager } from '../services/deviceManager';
import { audioEngine } from '../services/audioEngine';
import { AudioDevice } from '../types/audio';

export const SourcesWorkspace: React.FC = () => {
  const [devices, setDevices] = useState<AudioDevice[]>(deviceManager.getDevices());
  const [selectedId, setSelectedId] = useState<string>(deviceManager.getSelectedDeviceId());
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [micPeak, setMicPeak] = useState<number>(-90);
  const [micRms, setMicRms] = useState<number>(-90);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    deviceManager.enumerateDevices().then((devs) => {
      setDevices(devs);
      setSelectedId(deviceManager.getSelectedDeviceId());
    });

    const unsubDevices = deviceManager.onDevicesChanged((devs) => {
      setDevices(devs);
    });

    const unsubMeter = audioEngine.onMeterUpdate((channelId, peakDb, rmsDb) => {
      if (channelId === 'mic') {
        setMicPeak(peakDb);
        setMicRms(rmsDb ?? peakDb - 6);
      }
    });

    return () => {
      unsubDevices();
      unsubMeter();
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleDeviceSelect = async (deviceId: string) => {
    setSelectedId(deviceId);
    deviceManager.setSelectedDeviceId(deviceId);
    if (isCapturing) {
      await audioEngine.startMicrophoneCapture(deviceId);
    }
    const dev = devices.find((d) => d.id === deviceId);
    showToast(`Assigned input device: ${dev?.name || deviceId}`);
  };

  const handleToggleTestCapture = async () => {
    if (isCapturing) {
      audioEngine.stopMicrophoneCapture();
      setIsCapturing(false);
      setMicPeak(-90);
      setMicRms(-90);
      showToast('Capture monitoring stopped');
    } else {
      const ok = await audioEngine.startMicrophoneCapture(selectedId);
      setIsCapturing(ok);
      if (ok) {
        showToast('Live microphone monitoring active');
      } else {
        showToast('Failed to start microphone capture. Check browser permissions.');
      }
    }
  };

  const handleRefreshDevices = async () => {
    const devs = await deviceManager.enumerateDevices();
    setDevices(devs);
    showToast(`Hardware scan complete: ${devs.length} device(s) found`);
  };

  const activeDevice = devices.find((d) => d.id === selectedId) || devices[0];

  const dbToUnit = (db: number) => Math.max(0, Math.min(1, (db + 60) / 60));

  return (
    <section className="ws-workspace" style={{ display: 'grid', gridTemplateRows: 'auto auto minmax(0, 1fr)', gap: '14px', height: '100%' }}>
      {/* Command & Control Bar */}
      <div className="ws-command-row">
        <div>
          <div className="ws-kicker">Control / Input Routing</div>
          <h1 className="ws-title">Hardware Sources & Routing Matrix</h1>
          <p className="ws-subtitle">
            Configure physical soundcards, microphone endpoints, sample rates, and routing assignment to mixer channels.
          </p>
        </div>

        <div className="ws-transport">
          <button type="button" className="ws-secondary-action" onClick={handleRefreshDevices}>
            Rescan Hardware
          </button>
          <button
            type="button"
            className="ws-primary-action"
            onClick={handleToggleTestCapture}
            data-live={isCapturing}
          >
            {isCapturing ? 'Stop Input Monitor' : 'Monitor Live Input'}
          </button>
        </div>
      </div>

      {/* Active Device Primary Strip */}
      <div
        style={{
          border: '1px solid var(--ws-line)',
          borderRadius: '7px',
          background: 'var(--ws-panel)',
          padding: '14px 18px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(300px, 1fr)',
          gap: '20px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="ws-badge" data-variant={isCapturing ? 'live' : 'neutral'}>
              {isCapturing ? 'STREAMING • ROUTED' : 'STANDBY'}
            </span>
            <span className="ws-tag">DESTINATION: MIXER CH 1 (MIC)</span>
            {activeDevice?.isDefault && <span className="ws-tag">OS DEFAULT</span>}
          </div>

          <div>
            <div style={{ fontSize: '18px', fontWeight: 760, color: 'var(--ws-text)', letterSpacing: '-0.02em' }}>
              {activeDevice ? activeDevice.name : 'No input hardware selected'}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--ws-muted)', marginTop: '2px' }}>
              Hardware ID: <span style={{ fontFamily: 'var(--font-mono)' }}>{activeDevice?.id || 'none'}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '16px', marginTop: '6px', fontSize: '11px', color: 'var(--ws-muted)' }}>
            <div>
              SAMPLE RATE: <strong style={{ color: 'var(--ws-text)', fontFamily: 'var(--font-mono)' }}>{activeDevice?.sampleRate || 48000} Hz</strong>
            </div>
            <div>
              CHANNELS: <strong style={{ color: 'var(--ws-text)', fontFamily: 'var(--font-mono)' }}>{activeDevice?.channels || 2} (Stereo)</strong>
            </div>
            <div>
              LATENCY EST: <strong style={{ color: 'var(--ws-text)', fontFamily: 'var(--font-mono)' }}>5.8 ms</strong>
            </div>
          </div>
        </div>

        {/* Real-time Level VU Feedback */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: '8px',
            padding: '12px 14px',
            background: 'var(--ws-panel-2)',
            border: '1px solid var(--ws-line)',
            borderRadius: '6px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--ws-muted)' }}>
            <span style={{ fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Channel Level</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              RMS: <strong>{micRms.toFixed(1)} dBFS</strong> | PEAK: <strong>{micPeak.toFixed(1)} dBFS</strong>
            </span>
          </div>

          <div style={{ height: '14px', background: 'var(--ws-panel-3)', border: '1px solid var(--ws-line)', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
            <div
              style={{
                height: '100%',
                width: `${dbToUnit(micRms) * 100}%`,
                background: micPeak >= -3 ? 'var(--ws-danger)' : 'var(--ws-live)',
                transition: 'width 80ms linear, background var(--ws-fast)',
              }}
            />
            {/* Peak hold indicator */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${dbToUnit(micPeak) * 100}%`,
                width: '2px',
                background: micPeak >= -3 ? 'var(--ws-danger)' : '#ffffff',
                transition: 'left 80ms linear',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '8.5px', color: 'var(--ws-subtle)' }}>
            <span>-60 dB</span>
            <span>-36 dB</span>
            <span>-18 dB</span>
            <span>-12 dB</span>
            <span>-6 dB</span>
            <span style={{ color: 'var(--ws-danger)' }}>0 dBFS</span>
          </div>
        </div>
      </div>

      {/* Hardware Device Routing Matrix Table */}
      <div
        style={{
          border: '1px solid var(--ws-line)',
          borderRadius: '7px',
          background: 'var(--ws-panel)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <div className="ws-section-head">
          <h2>Detected Physical Capture Interfaces ({devices.length})</h2>
          <span>Direct Core Allocation</span>
        </div>

        <div style={{ overflow: 'auto', flex: 1 }}>
          <table className="ws-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}>#</th>
                <th>Device Endpoint</th>
                <th style={{ width: '130px' }}>Channels</th>
                <th style={{ width: '130px' }}>Sample Rate</th>
                <th style={{ width: '140px' }}>Assigned Bus</th>
                <th style={{ width: '120px' }}>State</th>
                <th style={{ width: '160px', textAlign: 'right' }}>Routing Action</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device, index) => {
                const isSelected = selectedId === device.id;
                return (
                  <tr
                    key={device.id}
                    style={{
                      background: isSelected
                        ? 'color-mix(in srgb, var(--ws-live) 4%, transparent)'
                        : undefined,
                    }}
                  >
                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--ws-subtle)' }}>
                      {(index + 1).toString().padStart(2, '0')}
                    </td>
                    <td>
                      <div style={{ fontWeight: 650, color: isSelected ? 'var(--ws-live)' : 'var(--ws-text)' }}>
                        {device.name}
                      </div>
                      <div style={{ fontSize: '9.5px', color: 'var(--ws-subtle)', fontFamily: 'var(--font-mono)' }}>
                        {device.id}
                      </div>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {device.channels} Ch (Stereo)
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {device.sampleRate} Hz
                    </td>
                    <td>
                      <span className="ws-tag">
                        {isSelected ? 'MIXER CH 1 [MIC]' : 'UNMAPPED'}
                      </span>
                    </td>
                    <td>
                      <span
                        className="ws-badge"
                        data-variant={isSelected ? (isCapturing ? 'live' : 'warning') : 'neutral'}
                      >
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
                        onClick={() => handleDeviceSelect(device.id)}
                      >
                        {isSelected ? '✓ Assigned' : 'Route to Mic'}
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
