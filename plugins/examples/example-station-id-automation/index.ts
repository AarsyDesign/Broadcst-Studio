import {
  AutomationPlugin,
  PluginContext,
  ScheduleTriggeredEvent,
  definePlugin,
} from '../../../packages/plugin-sdk/src';
import manifestJson from './manifest.json';

/**
 * Example Automation Plugin
 *
 * Demonstrates:
 * - Listening to schedule trigger events ('schedule.triggered')
 * - Triggering controlled playback commands ('NEXT_TRACK', 'PLAY_DECK')
 * - Requiring 'automation.read' and 'automation.execute' permissions
 */
export const stationIdAutomationPlugin: AutomationPlugin = definePlugin({
  manifest: manifestJson as AutomationPlugin['manifest'],

  context: null as PluginContext | null,
  unsubSchedule: null as (() => void) | null,

  initialize(context: PluginContext) {
    this.context = context;
    context.logger.info('Station ID Automation initialized');
  },

  start() {
    if (!this.context) return;
    const ctx = this.context;

    ctx.logger.info('Starting station ID schedule watcher');

    this.unsubSchedule = ctx.events.on('schedule.triggered', async (evt: ScheduleTriggeredEvent) => {
      ctx.logger.info(`Received schedule trigger: ${evt.title} (${evt.slotId})`);

      // If scheduled action indicates station ID or time check
      if (evt.action === 'STATION_ID' || evt.title.toLowerCase().includes('station id')) {
        try {
          ctx.logger.info('Injecting station ID rotation...');
          await ctx.commands.execute('control.action.next_track');
        } catch (err) {
          ctx.logger.error('Failed triggering station ID automation command', err);
        }
      }
    });
  },

  async onTrigger(eventName: string, payload?: unknown) {
    this.context?.logger.info(`Custom trigger received: ${eventName}`, payload);
  },

  stop() {
    if (this.unsubSchedule) {
      this.unsubSchedule();
      this.unsubSchedule = null;
    }
    this.context?.logger.info('Stopped station ID schedule watcher');
  },

  dispose() {
    this.stop();
    this.context = null;
  },
});

export default stationIdAutomationPlugin;
