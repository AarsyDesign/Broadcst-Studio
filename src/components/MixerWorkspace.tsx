import React, { useEffect, useState } from 'react';
import { audioEngine } from '../services/audioEngine';
import { AudioChannelStrip, MixerState } from '../types/audio';
import { controlApi } from '../services/controlApi';

const dbToUnit = (db: number): number => Math.max(0, Math.min(1, (db + 60) / 60));

const formatDb = (db: number): string => (db > 0 ? `+${db}` : `${db}`);

export const MixerWorkspace: React.FC = () => {
  const [mixerState, setMixerState] = useState<MixerState>(audioEngine.getMixerState());
  const [levels, setLevels] = useState<Record<string, { peak: number; rms: number }>>({});

  useEffect(() => {
    const unsubscribe = audioEngine.onMeterUpdate((channelId, peakDb, rmsDb) => {
      setLevels((prev) => ({ ...prev, [channelId]: { peak: peakDb, rms: rmsDb } }));
    });
    return unsubscribe;
  }, []);

  const refresh = () => setMixerState(audioEngine.getMixerState());

  const handleFaderChange = (channelId: string, level: number) => {
    audioEngine.setChannelFader(channelId, level);
    controlApi.execute('audio.set_fader', { channelId, level });
    refresh();
  };

  const handleGainChange = (channelId: string, gainDb: number) => {
    audioEngine.setChannelGainDb(channelId, gainDb);
    controlApi.execute('audio.set_gain', { channelId, gainDb });
    refresh();
  };

  const handleToggleMute = (channelId: string) => {
    const ch = mixerState.channels.find((c) => c.id === channelId);
    const newMuted = ch ? !ch.muted : true;
    audioEngine.toggleMute(channelId);
    controlApi.execute('audio.mute', { channelId, muted: newMuted });
    refresh();
  };

  const handleToggleSolo = (channelId: string) => {
    audioEngine.toggleSolo(channelId);
    refresh();
  };

  const handleMasterFaderChange = (level: number) => {
    audioEngine.setMasterFader(level);
    controlApi.execute('audio.set_fader', { channelId: 'master', level });
    refresh();
  };

  const handleToggleMasterMute = () => {
    const newMuted = !mixerState.masterMuted;
    audioEngine.toggleMasterMute();
    controlApi.execute('audio.mute', { channelId: 'master', muted: newMuted });
    refresh();
  };

  const playCue = (channelId: string) => {
    audioEngine.playTone(channelId === 'mic' ? 1000 : 440, 500, channelId);
  };

  return (
    <section className="ws-workspace ws-mixer">
      <div className="ws-mixer-top">
        <div>
          <div className="ws-kicker">Control / Mixer</div>
          <h1 className="ws-title">Mixing Console</h1>
          <p className="ws-subtitle">Direct channel control with live peak and RMS feedback.</p>
        </div>
        <button type="button" className="ws-secondary-action" onClick={() => playCue('soundboard')}>
          Play Cue
        </button>
      </div>

      <div className="ws-console" aria-label="Audio mixing console">
        {mixerState.channels.map((channel: AudioChannelStrip) => {
          const meter = levels[channel.id] || { peak: channel.peakDb ?? -90, rms: channel.rmsDb ?? -90 };
          const meterLevel = `${dbToUnit(meter.rms) * 100}%`;
          const danger = meter.peak >= -3;

          return (
            <div className="ws-strip" key={channel.id}>
              <div className="ws-strip-head">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="ws-strip-source">{channel.sourceType.replace('_', ' ')}</span>
                  <span className="ws-tag">→ MASTER</span>
                </div>
                <span className="ws-strip-name">{channel.name}</span>
              </div>

              <div className="ws-strip-gain">
                <label htmlFor={`gain-${channel.id}`}>GAIN</label>
                <output>{formatDb(channel.gainDb)} dB</output>
                <input
                  id={`gain-${channel.id}`}
                  className="ws-range"
                  type="range"
                  min="-60"
                  max="12"
                  step="1"
                  value={channel.gainDb}
                  onChange={(event) => handleGainChange(channel.id, Number(event.target.value))}
                  aria-label={`${channel.name} gain`}
                />
              </div>

              <div className="ws-strip-control">
                <div className="ws-strip-meter" aria-label={`${channel.name} level meter`}>
                  <div
                    className="ws-strip-meter-fill"
                    data-danger={danger}
                    style={{ '--meter-level': meterLevel } as React.CSSProperties}
                  />
                </div>
                <div className="ws-strip-fader">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={channel.faderLevel}
                    onChange={(event) => handleFaderChange(channel.id, Number(event.target.value))}
                    aria-label={`${channel.name} volume`}
                  />
                  <span className="ws-strip-level">{Math.round(channel.faderLevel * 100)}%</span>
                </div>
              </div>

              <div className="ws-strip-actions">
                <button
                  type="button"
                  className="ws-mini-action"
                  data-kind="mute"
                  data-active={channel.muted}
                  onClick={() => handleToggleMute(channel.id)}
                >
                  Mute
                </button>
                <button
                  type="button"
                  className="ws-mini-action"
                  data-kind="solo"
                  data-active={channel.solo}
                  onClick={() => handleToggleSolo(channel.id)}
                >
                  Solo
                </button>
              </div>
            </div>
          );
        })}

        <div className="ws-strip ws-strip--master">
          <div className="ws-strip-head">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="ws-strip-source">MAIN BUS</span>
              <span
                className="ws-badge"
                data-variant={mixerState.masterPeakDb >= -0.5 ? 'danger' : mixerState.masterPeakDb >= -3 ? 'warning' : 'live'}
              >
                {mixerState.masterPeakDb >= -0.5 ? 'CLIP' : 'OK'}
              </span>
            </div>
            <span className="ws-strip-name">Master Output</span>
          </div>

          <div className="ws-strip-gain">
            <label>HEADROOM</label>
            <output>{Math.max(0, 0 - mixerState.masterPeakDb).toFixed(1)} dB</output>
          </div>

          <div className="ws-strip-control">
            <div className="ws-strip-meter">
              <div
                className="ws-strip-meter-fill"
                data-danger={mixerState.masterPeakDb >= -3}
                style={{ '--meter-level': `${dbToUnit(mixerState.masterRmsDb) * 100}%` } as React.CSSProperties}
              />
            </div>
            <div className="ws-strip-fader">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={mixerState.masterMuted ? 0 : Math.min(1, Math.max(0, Math.pow(10, mixerState.masterGainDb / 20)))}
                onChange={(event) => handleMasterFaderChange(Number(event.target.value))}
                aria-label="Master volume"
              />
              <span className="ws-strip-level">{mixerState.masterMuted ? 'Muted' : formatDb(mixerState.masterGainDb)} dB</span>
            </div>
          </div>

          <div className="ws-strip-actions">
            <button
              type="button"
              className="ws-mini-action"
              data-kind="mute"
              data-active={mixerState.masterMuted}
              onClick={handleToggleMasterMute}
            >
              Mute
            </button>
            <button type="button" className="ws-mini-action" onClick={() => playCue('soundboard')}>
              Cue
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
