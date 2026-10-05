import React, { useState, useEffect } from 'react';
import { deviceManager } from '../services/deviceManager';
import { audioEngine } from '../services/audioEngine';
import { AudioDevice } from '../types/audio';

export const SourcesWorkspace: React.FC = () => {
  const [devices, setDevices] = useState<AudioDevice[]>(deviceManager.getDevices());
  const [selectedId, setSelectedId] = useState<string>(deviceManager.getSelectedDeviceId());
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [micPeak, setMicPeak] = useState<number>(-90);

  useEffect(() => {
    deviceManager.enumerateDevices().then((devs) => {
      setDevices(devs);
      setSelectedId(deviceManager.getSelectedDeviceId());
    });

    const unsubDevices = deviceManager.onDevicesChanged((devs) => {
      setDevices(devs);
    });

    const unsubMeter = audioEngine.onMeterUpdate((channelId, peakDb) => {
      if (channelId === 'mic') {
        setMicPeak(peakDb);
      }
    });

    return () => {
      unsubDevices();
      unsubMeter();
    };
  }, []);

  const handleDeviceSelect = async (deviceId: string) => {
    setSelectedId(deviceId);
    deviceManager.setSelectedDeviceId(deviceId);
    if (isCapturing) {
      await audioEngine.startMicrophoneCapture(deviceId);
    }
  };

  const handleToggleTestCapture = async () => {
    if (isCapturing) {
      audioEngine.stopMicrophoneCapture();
      setIsCapturing(false);
      setMicPeak(-90);
    } else {
      const ok = await audioEngine.startMicrophoneCapture(selectedId);
      setIsCapturing(ok);
    }
  };

  const handleRefreshDevices = async () => {
    const devs = await deviceManager.enumerateDevices();
    setDevices(devs);
  };

  const dbToPercent = (db: number) => {
    if (db <= -60) return 0;
    if (db >= 0) return 100;
    return Math.round(((db + 60) / 60) * 100);
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
            Audio Input Sources
          </h1>
          <p style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
            Select physical capture hardware, soundcards, and configure broadcast inputs.
          </p>
        </div>

        <button
          onClick={handleRefreshDevices}
          style={{
            padding: 'var(--space-2) var(--space-4)',
            backgroundColor: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-small)',
            fontWeight: 600,
          }}
        >
          Scan Devices
        </button>
      </header>

      {/* Selected Active Input Card */}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: 'var(--text-micro)', fontWeight: 700, color: 'var(--color-live)', textTransform: 'uppercase' }}>
              PRIMARY MICROPHONE
            </span>
            <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 600, margin: '2px 0 0 0' }}>
              Live Capture Device
            </h2>
          </div>

          <button
            onClick={handleToggleTestCapture}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 700,
              fontSize: 'var(--text-small)',
              backgroundColor: isCapturing ? 'var(--color-live)' : 'var(--color-surface-elevated)',
              color: isCapturing ? 'var(--color-live-text)' : 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
            }}
          >
            {isCapturing ? 'STOP TEST CAPTURE' : 'TEST LIVE MIC INPUT'}
          </button>
        </div>

        {/* Live Test Meter */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)' }}>
            <span>INPUT LEVEL</span>
            <span className="font-mono">{micPeak.toFixed(1)} dBFS</span>
          </div>
          <div style={{ height: '12px', backgroundColor: 'var(--color-surface-elevated)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${dbToPercent(micPeak)}%`,
                backgroundColor: micPeak > -3 ? 'var(--color-error)' : 'var(--color-live)',
                transition: 'width 80ms ease-out',
              }}
            />
          </div>
        </div>
      </section>

      {/* Available Physical Devices Grid */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 600, margin: 0 }}>
          Available Audio Interfaces and Microphones ({devices.length})
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--space-3)' }}>
          {devices.map((device) => {
            const isSelected = selectedId === device.id;

            return (
              <div
                key={device.id}
                onClick={() => handleDeviceSelect(device.id)}
                style={{
                  backgroundColor: isSelected ? 'var(--color-surface-elevated)' : 'var(--color-surface)',
                  border: isSelected ? '2px solid var(--color-live)' : '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-4)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-2)',
                  transition: 'all var(--motion-fast)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    {device.name}
                  </span>
                  {isSelected && (
                    <span
                      style={{
                        fontSize: 'var(--text-micro)',
                        backgroundColor: 'var(--color-live)',
                        color: 'var(--color-live-text)',
                        padding: '1px 6px',
                        borderRadius: 'var(--radius-sm)',
                        fontWeight: 700,
                      }}
                    >
                      ACTIVE
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)' }}>
                  <span>Channels: {device.channels} (Stereo)</span>
                  <span>Sample Rate: {device.sampleRate} Hz</span>
                  {device.isDefault && <span style={{ color: 'var(--color-info)' }}>System Default</span>}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
