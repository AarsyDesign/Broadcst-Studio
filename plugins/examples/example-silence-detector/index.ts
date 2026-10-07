import {
  PluginContext,
  UtilityPlugin,
  definePlugin,
} from '../../../packages/plugin-sdk/src';
import manifestJson from './manifest.json';

/**
 * Example Utility Plugin: Silence Guard
 *
 * Demonstrates:
 * - Periodic background worker execution (tick)
 * - Safe reading of audio metrics (audio.read permission)
 * - Emergency failover command dispatch (automation.execute permission)
 */
export const silenceDetectorPlugin: UtilityPlugin = definePlugin({
  manifest: manifestJson as UtilityPlugin['manifest'],

  context: null as PluginContext | null,
  silenceSeconds: 0,
  silenceThresholdDb: -50.0,
  failoverTriggerSeconds: 10,

  initialize(context: PluginContext) {
    this.context = context;
    this.silenceSeconds = 0;
    context.logger.info('Silence Guard & Emergency Failover initialized');
  },

  start() {
    this.silenceSeconds = 0;
    this.context?.logger.info('Silence Guard watchdog started');
  },

  /**
   * Called periodically by the host (e.g. every 1 second).
   */
  async tick(context: PluginContext) {
    if (!context.getAudioMetrics) return;

    const metrics = context.getAudioMetrics();

    // Check if both RMS and Peak levels indicate dead air / silence
    if (metrics.rmsDb <= this.silenceThresholdDb && metrics.peakDb <= this.silenceThresholdDb) {
      this.silenceSeconds += 1;
      context.logger.warn(`Dead air detected: ${this.silenceSeconds}s below ${this.silenceThresholdDb} dBFS`);

      if (this.silenceSeconds >= this.failoverTriggerSeconds) {
        context.logger.error('CRITICAL: Dead air threshold exceeded! Firing emergency queue failover.');
        this.silenceSeconds = 0;

        try {
          // Command emergency failover advance
          await context.commands.execute('control.action.next_track');
        } catch (err) {
          context.logger.error('Failed executing emergency failover command', err);
        }
      }
    } else {
      if (this.silenceSeconds > 0) {
        context.logger.info('Audio restored to normal broadcast level');
      }
      this.silenceSeconds = 0;
    }
  },

  stop() {
    this.silenceSeconds = 0;
    this.context?.logger.info('Silence Guard watchdog stopped');
  },

  dispose() {
    this.stop();
    this.context = null;
  },
});

export default silenceDetectorPlugin;
