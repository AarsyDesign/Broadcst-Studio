import {
  MetadataPlugin,
  PluginContext,
  TrackChangedEvent,
  definePlugin,
} from '../../../packages/plugin-sdk/src';
import manifestJson from './manifest.json';

/**
 * Example Metadata Plugin
 *
 * Demonstrates:
 * - Subscribing to safe application events ('track.changed')
 * - Modifying or enriching now-playing information
 * - Permission-gated command execution ('metadata.push')
 */
export const metadataSyncPlugin: MetadataPlugin = definePlugin({
  manifest: manifestJson as MetadataPlugin['manifest'],

  context: null as PluginContext | null,
  unsubscribeEvent: null as (() => void) | null,

  initialize(context: PluginContext) {
    this.context = context;
    context.logger.info('Metadata Bridge initialized with state storage');
  },

  start() {
    if (!this.context) return;
    const ctx = this.context;

    ctx.logger.info('Starting Metadata Sync event listener');

    // Subscribe to safe application track changed event
    this.unsubscribeEvent = ctx.events.on('track.changed', async (event: TrackChangedEvent) => {
      ctx.logger.info(`Track changed: ${event.artist} - ${event.title} [Deck: ${event.deckId}]`);

      // Save last synced track to plugin local storage
      ctx.state.set('last_synced_title', event.title);
      ctx.state.set('last_synced_artist', event.artist);

      // Example: Push sanitized radio display string via controlled command
      try {
        await ctx.commands.execute('broadcast.set_metadata', {
          title: event.title.toUpperCase(),
          artist: event.artist.toUpperCase(),
        });
      } catch (err) {
        ctx.logger.warn('Failed executing metadata update command', err);
      }
    });
  },

  stop() {
    if (this.unsubscribeEvent) {
      this.unsubscribeEvent();
      this.unsubscribeEvent = null;
    }
    this.context?.logger.info('Stopped Metadata Sync event listener');
  },

  dispose() {
    this.stop();
    this.context = null;
  },
});

export default metadataSyncPlugin;
