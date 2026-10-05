import { AudioChannelStrip, MixerState } from '../types/audio';
import { logger } from './logger';
import { deviceManager } from './deviceManager';

export interface ChannelAudioNodes {
  sourceNode?: AudioNode;
  gainNode: GainNode;
  analyserNode: AnalyserNode;
  pannerNode?: StereoPannerNode;
}

export type MeterCallback = (channelId: string, peakDb: number, rmsDb: number) => void;

class AudioEngine {
  private ctx?: AudioContext;
  private masterGainNode?: GainNode;
  private masterCompressor?: DynamicsCompressorNode;
  private masterAnalyserNode?: AnalyserNode;
  private masterDestination?: MediaStreamAudioDestinationNode;

  private micStream?: MediaStream;
  private channelNodes: Map<string, ChannelAudioNodes> = new Map();
  private meterCallbacks: Set<MeterCallback> = new Set();
  private meterAnimationId?: number;

  private isEngineRunning = false;
  private timeDomainBuffer = new Float32Array(512);

  // Default Initial Mixer State
  private mixerState: MixerState = {
    channels: [
      {
        id: 'mic',
        name: 'Microphone 1',
        sourceType: 'microphone',
        gainDb: 0,
        faderLevel: 0.85,
        muted: false,
        solo: false,
        peakDb: -90,
        rmsDb: -90,
      },
      {
        id: 'soundboard',
        name: 'Jingles & SFX',
        sourceType: 'file',
        gainDb: -3,
        faderLevel: 0.75,
        muted: false,
        solo: false,
        peakDb: -90,
        rmsDb: -90,
      },
      {
        id: 'music',
        name: 'Music Bed',
        sourceType: 'playlist',
        gainDb: -6,
        faderLevel: 0.7,
        muted: false,
        solo: false,
        peakDb: -90,
        rmsDb: -90,
      },
      {
        id: 'aux',
        name: 'Aux / System',
        sourceType: 'system_audio',
        gainDb: 0,
        faderLevel: 0.8,
        muted: false,
        solo: false,
        peakDb: -90,
        rmsDb: -90,
      },
    ],
    masterGainDb: 0,
    masterMuted: false,
    masterPeakDb: -90,
    masterRmsDb: -90,
  };

  public async initialize(): Promise<void> {
    if (this.ctx && this.ctx.state !== 'closed') return;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AudioContextClass({ latencyHint: 'interactive', sampleRate: 48000 });

    logger.info('AudioEngine', `AudioContext initialized with sampleRate: ${this.ctx.sampleRate}Hz`);

    // Master bus chain: Channels -> Master Gain -> Limiter/Compressor -> Master Analyser -> Output Destination
    this.masterGainNode = this.ctx.createGain();
    this.masterGainNode.gain.value = 1.0;

    // Studio brickwall limiter to protect stream from harsh digital clipping
    this.masterCompressor = this.ctx.createDynamicsCompressor();
    this.masterCompressor.threshold.value = -1.5;
    this.masterCompressor.knee.value = 2.0;
    this.masterCompressor.ratio.value = 20.0;
    this.masterCompressor.attack.value = 0.002;
    this.masterCompressor.release.value = 0.08;

    this.masterAnalyserNode = this.ctx.createAnalyser();
    this.masterAnalyserNode.fftSize = 512;
    this.masterAnalyserNode.smoothingTimeConstant = 0.75;

    this.masterDestination = this.ctx.createMediaStreamDestination();

    // Wiring master bus
    this.masterGainNode.connect(this.masterCompressor);
    this.masterCompressor.connect(this.masterAnalyserNode);
    this.masterAnalyserNode.connect(this.masterDestination);

    // Build channel strip nodes
    for (const ch of this.mixerState.channels) {
      this.setupChannelNodes(ch);
    }

    this.isEngineRunning = true;
    this.startMeterLoop();
  }

  private setupChannelNodes(channel: AudioChannelStrip) {
    if (!this.ctx || !this.masterGainNode) return;

    const gainNode = this.ctx.createGain();
    const analyserNode = this.ctx.createAnalyser();
    analyserNode.fftSize = 512;
    analyserNode.smoothingTimeConstant = 0.75;

    // Initial gain value calculated from fader and gainDb
    const linearGain = this.dbToLinear(channel.gainDb) * channel.faderLevel;
    gainNode.gain.value = channel.muted ? 0 : linearGain;

    // Channel routing to master gain
    gainNode.connect(analyserNode);
    analyserNode.connect(this.masterGainNode);

    this.channelNodes.set(channel.id, {
      gainNode,
      analyserNode,
    });
  }

  public async startMicrophoneCapture(deviceId?: string): Promise<boolean> {
    await this.initialize();
    if (!this.ctx) return false;

    // Stop existing mic stream if any
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = undefined;
    }

    try {
      const targetDeviceId = deviceId || deviceManager.getSelectedDeviceId();
      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: targetDeviceId ? { exact: targetDeviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
        },
        video: false,
      };

      this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
      const micSource = this.ctx.createMediaStreamSource(this.micStream);

      const micChannel = this.channelNodes.get('mic');
      if (micChannel) {
        if (micChannel.sourceNode) {
          micChannel.sourceNode.disconnect();
        }
        micChannel.sourceNode = micSource;
        micSource.connect(micChannel.gainNode);
        logger.info('AudioEngine', `Microphone stream connected to channel 'mic' (Device: ${targetDeviceId || 'default'})`);
      }

      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }

      return true;
    } catch (err) {
      logger.error('AudioEngine', 'Failed to capture microphone stream', { error: err });
      return false;
    }
  }

  public stopMicrophoneCapture() {
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = undefined;
      logger.info('AudioEngine', 'Microphone stream stopped');
    }
  }

  public playTone(freq: number = 440, durationMs: number = 600, channelId: string = 'soundboard') {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

    oscGain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + durationMs / 1000);

    const chNodes = this.channelNodes.get(channelId);
    if (chNodes) {
      osc.connect(oscGain);
      oscGain.connect(chNodes.gainNode);
      osc.start();
      osc.stop(this.ctx.currentTime + durationMs / 1000);
      logger.debug('AudioEngine', `Played test cue tone (${freq}Hz) on channel ${channelId}`);
    }
  }

  public setChannelFader(channelId: string, level: number) {
    const ch = this.mixerState.channels.find((c) => c.id === channelId);
    if (!ch) return;

    ch.faderLevel = Math.max(0, Math.min(1, level));
    this.updateChannelAudioGain(ch);
  }

  public setChannelGainDb(channelId: string, gainDb: number) {
    const ch = this.mixerState.channels.find((c) => c.id === channelId);
    if (!ch) return;

    ch.gainDb = Math.max(-60, Math.min(12, gainDb));
    this.updateChannelAudioGain(ch);
  }

  public toggleMute(channelId: string) {
    const ch = this.mixerState.channels.find((c) => c.id === channelId);
    if (!ch) return;

    ch.muted = !ch.muted;
    this.updateChannelAudioGain(ch);
  }

  public toggleSolo(channelId: string) {
    const ch = this.mixerState.channels.find((c) => c.id === channelId);
    if (!ch) return;

    ch.solo = !ch.solo;
    const anySolo = this.mixerState.channels.some((c) => c.solo);

    for (const channel of this.mixerState.channels) {
      this.updateChannelAudioGain(channel, anySolo);
    }
  }

  private updateChannelAudioGain(channel: AudioChannelStrip, anySoloActive?: boolean) {
    const nodes = this.channelNodes.get(channel.id);
    if (!nodes || !this.ctx) return;

    const anySolo = anySoloActive ?? this.mixerState.channels.some((c) => c.solo);
    let effectiveMuted = channel.muted;
    if (anySolo && !channel.solo) {
      effectiveMuted = true;
    }

    const linearGain = effectiveMuted ? 0 : this.dbToLinear(channel.gainDb) * channel.faderLevel;
    nodes.gainNode.gain.setTargetAtTime(linearGain, this.ctx.currentTime, 0.02);
  }

  public setMasterFader(level: number) {
    if (!this.masterGainNode || !this.ctx) return;
    this.mixerState.masterGainDb = level === 0 ? -90 : 20 * Math.log10(level);
    this.masterGainNode.gain.setTargetAtTime(this.mixerState.masterMuted ? 0 : level, this.ctx.currentTime, 0.02);
  }

  public toggleMasterMute() {
    if (!this.masterGainNode || !this.ctx) return;
    this.mixerState.masterMuted = !this.mixerState.masterMuted;
    const targetGain = this.mixerState.masterMuted ? 0 : this.dbToLinear(this.mixerState.masterGainDb);
    this.masterGainNode.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.02);
  }

  private startMeterLoop() {
    const calculateMeter = (analyser: AnalyserNode) => {
      analyser.getFloatTimeDomainData(this.timeDomainBuffer);
      let peak = 0;
      let sumSq = 0;

      for (let i = 0; i < this.timeDomainBuffer.length; i++) {
        const val = Math.abs(this.timeDomainBuffer[i]);
        if (val > peak) peak = val;
        sumSq += val * val;
      }

      const rms = Math.sqrt(sumSq / this.timeDomainBuffer.length);
      const peakDb = peak > 0.00001 ? Math.max(-90, 20 * Math.log10(peak)) : -90;
      const rmsDb = rms > 0.00001 ? Math.max(-90, 20 * Math.log10(rms)) : -90;

      return { peakDb, rmsDb };
    };

    const tick = () => {
      if (!this.isEngineRunning) return;

      // Master meter
      if (this.masterAnalyserNode) {
        const { peakDb, rmsDb } = calculateMeter(this.masterAnalyserNode);
        this.mixerState.masterPeakDb = peakDb;
        this.mixerState.masterRmsDb = rmsDb;
        this.notifyMeters('master', peakDb, rmsDb);
      }

      // Per-channel meters
      for (const [id, nodes] of this.channelNodes.entries()) {
        const { peakDb, rmsDb } = calculateMeter(nodes.analyserNode);
        const ch = this.mixerState.channels.find((c) => c.id === id);
        if (ch) {
          ch.peakDb = peakDb;
          ch.rmsDb = rmsDb;
        }
        this.notifyMeters(id, peakDb, rmsDb);
      }

      this.meterAnimationId = requestAnimationFrame(tick);
    };

    this.meterAnimationId = requestAnimationFrame(tick);
  }

  public onMeterUpdate(callback: MeterCallback): () => void {
    this.meterCallbacks.add(callback);
    return () => this.meterCallbacks.delete(callback);
  }

  private notifyMeters(channelId: string, peakDb: number, rmsDb: number) {
    this.meterCallbacks.forEach((cb) => {
      try {
        cb(channelId, peakDb, rmsDb);
      } catch (err) {
        // silently ignore listener errors in animation loop
      }
    });
  }

  public getMasterMediaStream(): MediaStream | undefined {
    return this.masterDestination?.stream;
  }

  public getMixerState(): MixerState {
    return { ...this.mixerState };
  }

  private dbToLinear(db: number): number {
    return Math.pow(10, db / 20);
  }

  public dispose() {
    this.isEngineRunning = false;
    if (this.meterAnimationId) {
      cancelAnimationFrame(this.meterAnimationId);
    }
    this.stopMicrophoneCapture();
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close();
    }
    this.meterCallbacks.clear();
    this.channelNodes.clear();
  }
}

export const audioEngine = new AudioEngine();
