import { OutputPlugin, OutputStatus, PluginInstance } from './types';
import { pluginHost } from './pluginHost';
import { eventBus } from '../operations/eventBus';
import { logger } from '../logger';
import { ipc } from '../ipc';
import { NativeMediaSinkStatus } from '../../types/ipc';

export interface PluginOutputTarget {
  pluginId: string;
  name: string;
  enabled: boolean;
  status: OutputStatus;
  plugin: OutputPlugin;
  nativeSink?: NativeMediaSinkStatus;
}

/**
 * Broadcst Studio Master Audio Output Router
 *
 * CONCEPTUAL ARCHITECTURE:
 * MASTER AUDIO (Domain A - Rust Realtime AudioEngine)
 *     ↓
 * NATIVE OUTPUT ROUTER (Rust Native Media Sinks)
 *     ├── Native SHOUTcast Stream (MP3 Direct TCP via EncoderWorker)
 *     ├── Native Master Recorder (WAV Capture via MasterRecorder)
 *     └── Native Media Sinks (ReferenceMediaSink / RtmpMediaSink / Plugin Sinks)
 *
 * CONTROL & METADATA DOMAIN (Domain B - TypeScript / Non-Realtime Async):
 *     ↓
 * PLUGIN OUTPUT ROUTER (This Service)
 *     ├── Target Discovery & Capability Inspection
 *     ├── Lifecycle & Command Routing (output.start / output.stop)
 *     ├── Metadata Forwarding (Track title & artist ICY sync)
 *     ├── Native Media Sink State Bridge (Authoritative for transport)
 *     └── Status & Telemetry Aggregation
 *
 * STRICT REALTIME BOUNDARY:
 * - Raw PCM frames are NEVER copied or routed through JavaScript, React, or event buses.
 * - Master PCM blocks (48kHz, stereo, f32) are dispatched exclusively in native Rust.
 * - "Plugin enabled" (host lifecycle) != "Output connected" (media streaming).
 * - Realtime audio callback is lock-free and bounded; never blocks on sinks or I/O.
 */
class OutputRouter {
  private subscribers: Set<() => void> = new Set();
  private busUnsub: (() => void) | null = null;
  private nativeSinks: Map<string, NativeMediaSinkStatus> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.setupMetadataForwarding();
    this.startNativeSinkPolling();
  }

  /**
   * Starts periodic polling of native media sink metrics from Rust backend.
   */
  private startNativeSinkPolling() {
    this.refreshNativeSinks().catch(() => {});
    this.pollTimer = setInterval(() => {
      this.refreshNativeSinks().catch(() => {});
    }, 1500);
  }

  /**
   * Polls authoritative live native media sink statuses from Tauri IPC.
   */
  public async refreshNativeSinks(): Promise<NativeMediaSinkStatus[]> {
    try {
      const sinks = await ipc.invoke('native_output.get_sinks');
      if (Array.isArray(sinks)) {
        this.nativeSinks.clear();
        for (const s of sinks) {
          this.nativeSinks.set(s.id, s);
        }
        this.notify();
        return sinks;
      }
    } catch (err) {
      logger.debug('OutputRouter', 'Native sink query skipped or failed', { error: err });
    }
    return Array.from(this.nativeSinks.values());
  }

  /**
   * Returns current snapshot of all active native media sinks.
   */
  public getNativeSinks(): NativeMediaSinkStatus[] {
    return Array.from(this.nativeSinks.values());
  }

  /**
   * Registers a native ReferenceMediaSink developer diagnostic tap.
   * Consumes real master PCM directly from AudioEngine without external network transport.
   */
  public async registerReferenceMediaSink(
    id: string = 'ref-diagnostic-sink',
    name: string = 'Master Audio Reference Tap'
  ): Promise<boolean> {
    try {
      await ipc.invoke('native_output.register_reference_sink', { id, name });
      await this.refreshNativeSinks();
      logger.info('OutputRouter', `Registered native reference diagnostic sink: ${id}`);
      return true;
    } catch (err) {
      logger.error('OutputRouter', `Failed to register reference sink "${id}"`, { error: err });
      return false;
    }
  }

  /**
   * Registers a native RTMP media sink with target endpoint.
   */
  public async registerRtmpSink(id: string, name: string, endpoint: string): Promise<boolean> {
    try {
      await ipc.invoke('native_output.register_rtmp_sink', { id, name, endpoint });
      await this.refreshNativeSinks();
      logger.info('OutputRouter', `Registered native RTMP sink: ${id} -> ${endpoint}`);
      return true;
    } catch (err) {
      logger.error('OutputRouter', `Failed to register native RTMP sink "${id}"`, { error: err });
      return false;
    }
  }

  /**
   * Unregisters and terminates an active native media sink.
   */
  public async unregisterNativeSink(id: string): Promise<boolean> {
    try {
      const ok = await ipc.invoke('native_output.unregister_sink', { id });
      await this.refreshNativeSinks();
      logger.info('OutputRouter', `Unregistered native sink: ${id}`);
      return Boolean(ok);
    } catch (err) {
      logger.error('OutputRouter', `Failed to unregister native sink "${id}"`, { error: err });
      return false;
    }
  }

  /**
   * Automatically forwards on-air track changes to all active output targets.
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
   * Retrieves all registered plugins categorized as type 'OUTPUT',
   * bridged with authoritative native media sink status if available.
   */
  public getPluginOutputs(): PluginOutputTarget[] {
    const plugins = pluginHost.getPlugins();
    const targets: PluginOutputTarget[] = [];

    plugins.forEach((inst: PluginInstance) => {
      if (inst.manifest.type === 'OUTPUT' && inst.plugin) {
        const outPlugin = inst.plugin as unknown as OutputPlugin;
        const rawStatus: OutputStatus =
          typeof outPlugin.getOutputStatus === 'function'
            ? outPlugin.getOutputStatus()
            : {
                state: inst.enabled ? 'READY' : 'DISCONNECTED',
                uptimeSeconds: 0,
                destinationName: inst.manifest.name,
                isReferenceOnly: false,
                transportRunning: false,
              };

        const status: OutputStatus = {
          ...rawStatus,
          pluginEnabled: inst.enabled,
        };

        // Bridge to native media sink if one is registered for this plugin
        const nativeSink = this.nativeSinks.get(inst.manifest.id);
        if (nativeSink) {
          // Native media sink state is AUTHORITATIVE for real media transport
          if (nativeSink.state === 'STREAMING') {
            status.state = 'CONNECTED';
            status.transportRunning = true;
            status.health = 'HEALTHY';
          } else if (nativeSink.state === 'ERROR') {
            status.state = 'ERROR';
            status.transportRunning = false;
            status.health = 'ERROR';
            status.error = nativeSink.error_message || 'Native sink transport failure';
          } else if (nativeSink.state === 'OPENED' || nativeSink.state === 'FLUSHING') {
            status.state = 'READY';
            status.transportRunning = false;
          } else if (nativeSink.state === 'STOPPED' || nativeSink.state === 'CLOSED') {
            status.state = 'DISCONNECTED';
            status.transportRunning = false;
          }

          status.diagnostics = {
            ...status.diagnostics,
            bytesSent: nativeSink.bytes_sent,
            droppedFrames: nativeSink.dropped_frames,
            framesWritten: nativeSink.frames_written,
            nativeSinkState: nativeSink.state,
            errorsCount: nativeSink.errors_count,
            reason: nativeSink.error_message || status.diagnostics?.reason,
          };
        }

        targets.push({
          pluginId: inst.manifest.id,
          name: inst.manifest.name,
          enabled: inst.enabled,
          status,
          plugin: outPlugin,
          nativeSink,
        });
      }
    });

    return targets;
  }

  /**
   * Returns only active output plugins capable of receiving metadata.
   * Includes both connected live outputs and active reference outputs.
   */
  public getActivePluginOutputs(): PluginOutputTarget[] {
    return this.getPluginOutputs().filter(
      (t) =>
        t.enabled &&
        (t.status.state === 'CONNECTED' || t.status.state === 'REFERENCE_ONLY')
    );
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
        await this.refreshNativeSinks();
        this.notify();
        return Boolean(success);
      } catch (err: any) {
        logger.error('OutputRouter', `Failed to start output for plugin "${pluginId}"`, { error: err });
        return false;
      }
    }

    await this.refreshNativeSinks();
    this.notify();
    return true;
  }

  /**
   * Stops a plugin output target.
   */
  public async stopOutput(pluginId: string): Promise<boolean> {
    const inst = pluginHost.getPlugin(pluginId);
    if (!inst || !inst.plugin) return false;

    // If an associated native sink is active, unregister it
    if (this.nativeSinks.has(pluginId)) {
      await this.unregisterNativeSink(pluginId);
    }

    const outPlugin = inst.plugin as unknown as OutputPlugin;
    if (outPlugin && typeof outPlugin.stopOutput === 'function') {
      try {
        const success = await outPlugin.stopOutput();
        await this.refreshNativeSinks();
        this.notify();
        return Boolean(success);
      } catch (err: any) {
        logger.error('OutputRouter', `Failed to stop output for plugin "${pluginId}"`, { error: err });
        return false;
      }
    }

    await this.refreshNativeSinks();
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
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.busUnsub) {
      this.busUnsub();
      this.busUnsub = null;
    }
    this.subscribers.clear();
  }
}

export const outputRouter = new OutputRouter();
