import {
  AudioProcessorPlugin,
  PluginContext,
  definePlugin,
} from '../../../packages/plugin-sdk/src';
import manifestJson from './manifest.json';

/**
 * Example Realtime Audio Processor
 *
 * Implements a dual-channel soft clipper and gain trim.
 * NOTE: Strict adherence to realtime restrictions:
 * - No memory allocations in process()
 * - No async calls, no fs, no net, no locks
 */
export const voiceProcessorPlugin: AudioProcessorPlugin = definePlugin({
  manifest: manifestJson as AudioProcessorPlugin['manifest'],

  // Internal state preallocated during initialize()
  gainLinear: 1.0,
  ceilingLinear: 0.95, // -0.45 dBFS ceiling

  initialize(context: PluginContext) {
    context.logger.info('Initializing Voice Leveler & Soft Limiter');
    // Preallocate any lookup tables or coefficients here
    this.gainLinear = 1.12; // +1 dB boost
  },

  start() {
    // Enable processing stage
  },

  stop() {
    // Bypass processing stage
  },

  /**
   * Deterministic realtime processing callback.
   * Executed on audio thread / low-latency worker.
   */
  process(
    inputBuffer: Float32Array[],
    outputBuffer: Float32Array[],
    _sampleRate: number,
    channels: number,
    frameCount: number
  ): void {
    const gain = this.gainLinear;
    const ceiling = this.ceilingLinear;

    for (let ch = 0; ch < channels; ch++) {
      const inCh = inputBuffer[ch];
      const outCh = outputBuffer[ch];
      if (!inCh || !outCh) continue;

      for (let i = 0; i < frameCount; i++) {
        let sample = inCh[i] * gain;

        // Cubic soft-knee saturation / clipping
        if (sample > ceiling) {
          sample = ceiling + (sample - ceiling) / (1.0 + Math.pow(sample - ceiling, 2));
        } else if (sample < -ceiling) {
          sample = -ceiling + (sample + ceiling) / (1.0 + Math.pow(sample + ceiling, 2));
        }

        outCh[i] = sample;
      }
    }
  },

  dispose() {
    // Release any native handles
  },
});

export default voiceProcessorPlugin;
