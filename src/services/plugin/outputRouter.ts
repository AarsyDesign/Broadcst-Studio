import { OutputPlugin, OutputStatus, PluginInstance } from './types';
import { pluginHost } from './pluginHost';
import { eventBus } from '../operations/eventBus';
import { logger } from '../logger';

export interface PluginOutputTarget {
  pluginId: string;
  name: string;
  enabled: boolean;
  status: OutputStatus;
  plugin: OutputPlugin;
}

/**
 * Broadcst Studio Master Audio Output Router
 *
 * CONCEPTUAL ARCHITECTURE:
 * MASTER AUDIO
 *     ↓
 * OUTPUT ROUTER
 *     ├── Native SHOUTcast (First-class Rust native pipeline)
 *     └── Plugin Outputs (Telegram Live, RTMP, YouTube, community streams)
 *
 * REALTIME BOUNDARY:
 * Native SHOUTcast runs in the high-performance Rust core (lib.rs / shoutcast/).
 * Output plugins implement the OutputPlugin contract for lifecycle, endpoint configuration,
 * metadata updates, and status.
 * Raw PCM is NOT routed across the React DOM/event thread.
 */
class OutputRouter {
  private subscribers: Set<() => void> = new Set();
  private busUnsub: (() => void) | null = null;

  constructor() {
    this.setupMetadataForwarding();
  }

  /**
   * Automatically forwards on-air track changes to all active output plugins.
   */
  private setupMetadataForwarding() {
    this.busUnsub = eventBus.on('deck:track_started', (payload: any) => {
      const meta = {
        title: payload.track?.title || 'Unknown Title',
        artist: payload.track?.artist || 'Unknown Artist',
        album: payload.track?.album,
      };

      const outputs = this.getActivePluginOutputs();
      outputs.forEach(({ plugin, name, pluginId }) => {
        if (typeof plugin.updateMetadata === 'function') {
          try {
            plugin.updateMetadata(meta);
            logger.debug('OutputRouter', `Forwarded metadata to output "${name}" (${pluginId})`, meta);
          } catch (err) {
            logger.warn('OutputRouter', `Failed updating metadata for output "${name}"`, { error: err });
          }
        }
      });
    });
  }

  /**
   * Retrieves all registered plugins categorized as type 'OUTPUT'.
   */
  public getPluginOutputs(): PluginOutputTarget[] {
    const plugins = pluginHost.getPlugins();
    const targets: PluginOutputTarget[] = [];

    plugins.forEach((inst: PluginInstance) => {
      if (inst.manifest.type === 'OUTPUT' && inst.plugin) {
        const outPlugin = inst.plugin as unknown as OutputPlugin;
        const status: OutputStatus =
          typeof outPlugin.getOutputStatus === 'function'
            ? outPlugin.getOutputStatus()
            : {
                state: inst.enabled ? 'CONNECTED' : 'DISCONNECTED',
                uptimeSeconds: 0,
                destinationName: inst.manifest.name,
              };

        targets.push({
          pluginId: inst.manifest.id,
          name: inst.manifest.name,
          enabled: inst.enabled,
          status,
          plugin: outPlugin,
        });
      }
    });

    return targets;
  }

  /**
   * Returns only active and connected output plugins.
   */
  public getActivePluginOutputs(): PluginOutputTarget[] {
    return this.getPluginOutputs().filter((t) => t.enabled && t.status.state === 'CONNECTED');
  }

  /**
   * Starts a plugin output target.
   */
  public async startOutput(pluginId: string, config?: unknown): Promise<boolean> {
    const inst = pluginHost.getPlugin(pluginId);
    if (!inst) {
      logger.warn('OutputRouter', `Plugin "${pluginId}" not found.`);
      return false;
    }

    if (!inst.enabled) {
      const enabled = await pluginHost.enablePlugin(pluginId);
      if (!enabled) return false;
    }

    const outPlugin = inst.plugin as unknown as OutputPlugin;
    if (outPlugin && typeof outPlugin.startOutput === 'function') {
      try {
        const success = await outPlugin.startOutput(config as any);
        this.notify();
        return Boolean(success);
      } catch (err: any) {
        logger.error('OutputRouter', `Failed to start output for plugin "${pluginId}"`, { error: err });
        return false;
      }
    }

    this.notify();
    return true;
  }

  /**
   * Stops a plugin output target.
   */
  public async stopOutput(pluginId: string): Promise<boolean> {
    const inst = pluginHost.getPlugin(pluginId);
    if (!inst || !inst.plugin) return false;

    const outPlugin = inst.plugin as unknown as OutputPlugin;
    if (outPlugin && typeof outPlugin.stopOutput === 'function') {
      try {
        const success = await outPlugin.stopOutput();
        this.notify();
        return Boolean(success);
      } catch (err: any) {
        logger.error('OutputRouter', `Failed to stop output for plugin "${pluginId}"`, { error: err });
        return false;
      }
    }

    this.notify();
    return true;
  }

  /**
   * Subscribes to output target state updates.
   */
  public subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    const hostUnsub = pluginHost.subscribe(() => listener());
    return () => {
      this.subscribers.delete(listener);
      hostUnsub();
    };
  }

  private notify() {
    this.subscribers.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        logger.error('OutputRouter', 'Subscriber callback error', { error: err });
      }
    });
  }

  public dispose() {
    if (this.busUnsub) {
      this.busUnsub();
      this.busUnsub = null;
    }
    this.subscribers.clear();
  }
}

export const outputRouter = new OutputRouter();
