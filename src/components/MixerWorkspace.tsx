import React, { useState, useEffect } from 'react';
import { audioEngine } from '../services/audioEngine';
import { AudioChannelStrip, MixerState } from '../types/audio';

export const MixerWorkspace: React.FC = () => {
  const [mixerState, setMixerState] = useState<MixerState>(audioEngine.getMixerState());
  const [levels, setLevels] = useState<Record<string, { peak: number; rms: number }>>({});

  useEffect(() => {
    const unsub = audioEngine.onMeterUpdate((channelId, peakDb, rmsDb) => {
      setLevels((prev) => ({
        ...prev,
        [channelId]: { peak: peakDb, rms: rmsDb },
      }));
    });

    return () => unsub();
  }, []);

  const handleFaderChange = (channelId: string, level: number) => {
    audioEngine.setChannelFader(channelId, level);
    setMixerState(audioEngine.getMixerState());
  };

  const handleGainChange = (channelId: string, gainDb: number) => {
    audioEngine.setChannelGainDb(channelId, gainDb);
    setMixerState(audioEngine.getMixerState());
  };

  const handleToggleMute = (channelId: string) => {
    audioEngine.toggleMute(channelId);
    setMixerState(audioEngine.getMixerState());
  };

  const handleToggleSolo = (channelId: string) => {
    audioEngine.toggleSolo(channelId);
    setMixerState(audioEngine.getMixerState());
  };

  const handleMasterFaderChange = (level: number) => {
    audioEngine.setMasterFader(level);
    setMixerState(audioEngine.getMixerState());
  };

  const handleToggleMasterMute = () => {
    audioEngine.toggleMasterMute();
    setMixerState(audioEngine.getMixerState());
  };

  const handlePlayCueTone = (channelId: string) => {
    audioEngine.playTone(channelId === 'mic' ? 1000 : 440, 500, channelId);
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
            Broadcast Audio Mixer
          </h1>
          <p style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
            Multi-channel console strips with direct faders, gain trims, and stereo VU metering.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            onClick={() => handlePlayCueTone('soundboard')}
            style={{
              padding: 'var(--space-2) var(--space-3)',
              backgroundColor: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-small)',
              fontWeight: 600,
            }}
          >
            Play Cue Test Tone
          </button>
        </div>
      </header>

      {/* Mixer Console Surface */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          gap: 'var(--space-4)',
          overflowX: 'auto',
          paddingBottom: 'var(--space-2)',
        }}
      >
        {/* Input Channel Strips */}
        {mixerState.channels.map((channel: AudioChannelStrip) => {
          const chLevel = levels[channel.id] || { peak: -90, rms: -90 };
          const peakPct = dbToPercent(chLevel.peak);
          const rmsPct = dbToPercent(chLevel.rms);

          return (
            <div
              key={channel.id}
              style={{
                width: '160px',
                flexShrink: 0,
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                flexDirection: 'column',
                padding: 'var(--space-3)',
                gap: 'var(--space-3)',
              }}
            >
              {/* Channel Header */}
              <div style={{ textAlign: 'center', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-2)' }}>
                <span
                  style={{
                    fontSize: 'var(--text-micro)',
                    fontWeight: 700,
                    color: 'var(--color-text-muted)',
                    textTransform: 'uppercase',
                    display: 'block',
                  }}
                >
                  {channel.sourceType.replace('_', ' ')}
                </span>
                <span style={{ fontSize: 'var(--text-small)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  {channel.name}
                </span>
              </div>

              {/* Gain Trim Knob/Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)' }}>
                  <span>GAIN</span>
                  <span className="font-mono">{channel.gainDb > 0 ? `+${channel.gainDb}` : channel.gainDb} dB</span>
                </div>
                <input
                  type="range"
                  min="-60"
                  max="12"
                  step="1"
                  value={channel.gainDb}
                  onChange={(e) => handleGainChange(channel.id, parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--color-live)' }}
                  aria-label={`${channel.name} Gain Trim`}
                />
              </div>

              {/* VU Meter & Fader Section */}
              <div style={{ display: 'flex', flex: 1, gap: 'var(--space-3)', alignItems: 'stretch', minHeight: '220px' }}>
                {/* Vertical VU Level Bar */}
                <div
                  style={{
                    width: '24px',
                    backgroundColor: 'var(--color-surface-elevated)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-end',
                    overflow: 'hidden',
                    padding: '2px',
                  }}
                >
                  {/* RMS Bar */}
                  <div
                    style={{
                      width: '100%',
                      height: `${rmsPct}%`,
                      backgroundColor: 'var(--color-info)',
                      borderRadius: '2px',
                      transition: 'height 80ms ease-out',
                    }}
                  />
                  {/* Peak Marker Line */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: `${peakPct}%`,
                      left: 0,
                      right: 0,
                      height: '2px',
                      backgroundColor: peakPct > 90 ? 'var(--color-error)' : 'var(--color-live)',
                    }}
                  />
                </div>

                {/* Vertical Fader Slider */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, position: 'relative' }}>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={channel.faderLevel}
                    onChange={(e) => handleFaderChange(channel.id, parseFloat(e.target.value))}
                    style={{
                      writingMode: 'vertical-lr',
                      direction: 'rtl',
                      width: '36px',
                      height: '100%',
                      cursor: 'pointer',
                      accentColor: 'var(--color-live)',
                    } as any}
                    aria-label={`${channel.name} Volume Fader`}
                  />
                  <span className="font-mono" style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                    {Math.round(channel.faderLevel * 100)}%
                  </span>
                </div>
              </div>

              {/* Action Buttons: Mute & Solo */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                <button
                  onClick={() => handleToggleMute(channel.id)}
                  style={{
                    padding: 'var(--space-2) 0',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--text-micro)',
                    fontWeight: 700,
                    backgroundColor: channel.muted ? 'var(--color-error)' : 'var(--color-surface-elevated)',
                    color: channel.muted ? '#FFFFFF' : 'var(--color-text-secondary)',
                    border: `1px solid ${channel.muted ? 'var(--color-error)' : 'var(--color-border)'}`,
                  }}
                >
                  MUTE
                </button>

                <button
                  onClick={() => handleToggleSolo(channel.id)}
                  style={{
                    padding: 'var(--space-2) 0',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--text-micro)',
                    fontWeight: 700,
                    backgroundColor: channel.solo ? 'var(--color-warning)' : 'var(--color-surface-elevated)',
                    color: channel.solo ? '#0B0D0F' : 'var(--color-text-secondary)',
                    border: `1px solid ${channel.solo ? 'var(--color-warning)' : 'var(--color-border)'}`,
                  }}
                >
                  SOLO
                </button>
              </div>
            </div>
          );
        })}

        {/* Master Output Channel Strip */}
        <div
          style={{
            width: '180px',
            flexShrink: 0,
            backgroundColor: 'var(--color-surface-elevated)',
            border: '2px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            padding: 'var(--space-3)',
            gap: 'var(--space-3)',
          }}
        >
          {/* Master Header */}
          <div style={{ textAlign: 'center', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-2)' }}>
            <span
              style={{
                fontSize: 'var(--text-micro)',
                fontWeight: 700,
                color: 'var(--color-live)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                display: 'block',
              }}
            >
              MAIN BUS
            </span>
            <span style={{ fontSize: 'var(--text-small)', fontWeight: 700, color: 'var(--color-text-primary)' }}>
              MASTER OUTPUT
            </span>
          </div>

          {/* Master Meter & Fader Section */}
          <div style={{ display: 'flex', flex: 1, gap: 'var(--space-3)', alignItems: 'stretch', minHeight: '220px' }}>
            {/* Dual Stereo VU Level Bar */}
            <div
              style={{
                width: '32px',
                backgroundColor: 'var(--color-bg)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                overflow: 'hidden',
                padding: '2px',
              }}
            >
              {/* RMS fill */}
              <div
                style={{
                  width: '100%',
                  height: `${dbToPercent(levels['master']?.rms ?? -90)}%`,
                  backgroundColor: 'var(--color-info)',
                  borderRadius: '2px',
                  transition: 'height 80ms ease-out',
                }}
              />
              {/* Peak line */}
              <div
                style={{
                  position: 'absolute',
                  bottom: `${dbToPercent(levels['master']?.peak ?? -90)}%`,
                  left: 0,
                  right: 0,
                  height: '3px',
                  backgroundColor: (levels['master']?.peak ?? -90) > -1 ? 'var(--color-error)' : 'var(--color-live)',
                }}
              />
            </div>

            {/* Master Fader */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, position: 'relative' }}>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                defaultValue="1.0"
                onChange={(e) => handleMasterFaderChange(parseFloat(e.target.value))}
                style={{
                  writingMode: 'vertical-lr',
                  direction: 'rtl',
                  width: '40px',
                  height: '100%',
                  cursor: 'pointer',
                  accentColor: 'var(--color-live)',
                } as any}
                aria-label="Master Output Volume Fader"
              />
              <span className="font-mono" style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                {(levels['master']?.peak ?? -90).toFixed(1)} dB
              </span>
            </div>
          </div>

          {/* Master Mute */}
          <button
            onClick={handleToggleMasterMute}
            style={{
              padding: 'var(--space-2) 0',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-small)',
              fontWeight: 700,
              backgroundColor: mixerState.masterMuted ? 'var(--color-error)' : 'var(--color-surface)',
              color: mixerState.masterMuted ? '#FFFFFF' : 'var(--color-text-primary)',
              border: `1px solid ${mixerState.masterMuted ? 'var(--color-error)' : 'var(--color-border)'}`,
            }}
          >
            {mixerState.masterMuted ? 'MASTER MUTED' : 'MUTE MASTER'}
          </button>
        </div>
      </div>
    </div>
  );
};
