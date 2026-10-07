import {
  AudioMetricsReadout,
  Plugin,
  PluginContext,
  PluginEventMap,
  PluginEventName,
  PluginInstance,
  PluginManifest,
  PluginStateStore,
  validateManifest,
} from './types';
import { permissionManager } from './permissionManager';
import { controlApi } from '../controlApi';
import { eventBus } from '../operations/eventBus';
import { logger } from '../logger';
import { audioEngine } from '../audioEngine';

/**
 * Broadcst Studio Plugin Host
 *
 * ARCHITECTURAL HONESTY:
 * Current runtime executes plugins in-process within the developer environment.
 * In-process execution is NOT an isolated security sandbox.
 * The production target architecture isolates community plugins inside
 * separate WebAssembly workers / child processes with bounded memory and capabilities.
 */
class PluginHost {
  private instances: Map<string, PluginInstance> = new Map();
  private storage: Map<string, Map<string, unknown>> = new Map();
  private utilityTimerId: number | null = null;
  private listeners: Set<(plugins: PluginInstance[]) => void> = new Set();
  private busUnsubscribers: (() => void)[] = [];

  constructor() {
    this.setupApplicationEventBridging();
    this.startUtilityTicker();
  }

  /**
   * Bridges internal workstation events to the public Plugin Event API.
   */
  private setupApplicationEventBridging() {
    // 1. Deck track started -> track.changed
    const unsubTrack = eventBus.on('deck:track_started', (payload: any) => {
      this.broadcastPluginEvent('track.changed', {
        deckId: payload.deckId as 'deck_a' | 'deck_b',
        title: payload.track?.title || 'Unknown Title',
        artist: payload.track?.artist || 'Unknown Artist',
        album: payload.track?.album,
        durationMs: payload.track?.durationMs || 0,
      });
    });

    // 2. Broadcast connected -> broadcast.connected
    const unsubBcastOn = eventBus.on('broadcast:connected', (payload: any) => {
      this.broadcastPluginEvent('broadcast.connected', {
        serverUrl: payload.server,
        format: 'MP3',
        bitrateKbps: payload.bitrate || 128,
        sampleRate: 48000,
      });
    });

    // 3. Broadcast disconnected -> broadcast.disconnected
    const unsubBcastOff = eventBus.on('broadcast:disconnected', (payload: any) => {
      this.broadcastPluginEvent('broadcast.disconnected', {
        totalDurationSeconds: payload.durationSeconds || 0,
      });
    });

    // 4. Recording started -> recording.started
    const unsubRecOn = eventBus.on('recording:started', (payload: any) => {
      this.broadcastPluginEvent('recording.started', {
        sessionTitle: payload.id,
        format: 'WAV',
        sampleRate: 48000,
      });
    });

    // 5. Recording stopped -> recording.stopped
    const unsubRecOff = eventBus.on('recording:stopped', (payload: any) => {
      this.broadcastPluginEvent('recording.stopped', {
        sessionId: payload.id,
        durationSeconds: payload.durationSeconds || 0,
        filePath: payload.filePath,
        fileSizeBytes: 0,
      });
    });

    // 6. Schedule slot triggered -> schedule.triggered
    const unsubSched = eventBus.on('schedule:event_started', (payload: any) => {
      this.broadcastPluginEvent('schedule.triggered', {
        slotId: payload.event?.id || 'slot',
        title: payload.event?.title || 'Scheduled Event',
        scheduledTime: payload.event?.startTime || new Date().toISOString(),
        action: payload.event?.action || 'PLAY_SHOW',
      });
    });

    this.busUnsubscribers = [
      unsubTrack,
      unsubBcastOn,
      unsubBcastOff,
      unsubRecOn,
      unsubRecOff,
      unsubSched,
    ];
  }

  private pluginEventListeners: Map<PluginEventName, Set<(payload: any) => void>> = new Map();

  private broadcastPluginEvent<E extends PluginEventName>(event: E, payload: PluginEventMap[E]) {
    const listeners = this.pluginEventListeners.get(event);
    if (listeners) {
      listeners.forEach((fn) => {
        try {
          fn(payload);
        } catch (err) {
          logger.error('PluginHost', `Error in plugin event listener for "${event}"`, { error: err });
        }
      });
    }
  }

  /**
   * Registers a 1-second interval for background UTILITY plugins.
   */
  private startUtilityTicker() {
    if (typeof window === 'undefined') return;
    this.utilityTimerId = window.setInterval(() => {
      this.instances.forEach((instance) => {
        if (instance.enabled && instance.state === 'ENABLED' && instance.manifest.type === 'UTILITY') {
          const utility = instance.plugin as any;
          if (utility && typeof utility.tick === 'function') {
            try {
              const ctx = this.createPluginContext(instance.manifest);
              utility.tick(ctx);
              instance.lastExecutionMs = Date.now();
            } catch (err: any) {
              logger.error('PluginHost', `Utility plugin "${instance.manifest.id}" tick exception`, {
                error: err,
              });
              instance.state = 'ERROR';
              instance.errorMessage = err?.message || String(err);
              this.notify();
            }
          }
        }
      });
    }, 1000);
  }

  /**
   * Creates an isolated execution context for a plugin instance.
   */
  public createPluginContext(manifest: PluginManifest): PluginContext {
    const pluginId = manifest.id;

    // Scoped persistent state store
    let storeMap = this.storage.get(pluginId);
    if (!storeMap) {
      storeMap = new Map();
      this.storage.set(pluginId, storeMap);
    }

    const stateStore: PluginStateStore = {
      get: <T = unknown>(key: string, defaultValue?: T): T | undefined => {
        return (storeMap!.get(key) as T) ?? defaultValue;
      },
      set: <T = unknown>(key: string, value: T): void => {
        storeMap!.set(key, value);
      },
      delete: (key: string): void => {
        storeMap!.delete(key);
      },
      clear: (): void => {
        storeMap!.clear();
      },
    };

    // Scoped logger
    const scopedLogger = {
      debug: (msg: string, meta?: unknown) =>
        logger.debug(`Plugin[${pluginId}]`, msg, meta as Record<string, unknown> | undefined),
      info: (msg: string, meta?: unknown) =>
        logger.info(`Plugin[${pluginId}]`, msg, meta as Record<string, unknown> | undefined),
      warn: (msg: string, meta?: unknown) =>
        logger.warn(`Plugin[${pluginId}]`, msg, meta as Record<string, unknown> | undefined),
      error: (msg: string, meta?: unknown) =>
        logger.error(`Plugin[${pluginId}]`, msg, meta as Record<string, unknown> | undefined),
    };

    // Scoped event bus
    const scopedEvents = {
      on: <E extends PluginEventName>(event: E, listener: (payload: PluginEventMap[E]) => void): (() => void) => {
        if (!this.pluginEventListeners.has(event)) {
          this.pluginEventListeners.set(event, new Set());
        }
        this.pluginEventListeners.get(event)!.add(listener);
        return () => {
          this.pluginEventListeners.get(event)?.delete(listener);
        };
      },
      emit: <E extends PluginEventName>(event: E, payload: PluginEventMap[E]) => {
        this.broadcastPluginEvent(event, payload);
      },
    };

    // Scoped command executor (Permission-Gated)
    const scopedCommands = {
      execute: async <TResult = unknown>(command: string, params?: unknown): Promise<TResult> => {
        const allowed = permissionManager.verifyCommand(pluginId, manifest.permissions, command);
        if (!allowed) {
          throw new Error(
            `Permission Denied: Plugin "${pluginId}" is not authorized to execute command "${command}".`
          );
        }

        // Map short command aliases to controlApi actions
        let cmdToRun = command;
        if (command === 'NEXT_TRACK') cmdToRun = 'control.action.next_track';
        if (command === 'PLAY_DECK') cmdToRun = 'deck.play';
        if (command === 'START_RECORDING') cmdToRun = 'recording.start';
        if (command === 'STOP_RECORDING') cmdToRun = 'recording.stop';

        const res = await controlApi.execute(cmdToRun as any, params, 'AUTOMATION');
        if (!res.success) {
          throw new Error(res.error || `Command "${command}" execution failed.`);
        }
        return res.data as TResult;
      },
    };

    // Metrics readout (if audio.read permission is granted)
    const getAudioMetrics = (): AudioMetricsReadout => {
      const hasPermission = permissionManager.hasPermission(manifest.permissions, 'audio.read');
      if (!hasPermission) {
        throw new Error(`Permission Denied: Plugin "${pluginId}" requires "audio.read" to access audio metrics.`);
      }
      const mixerState = audioEngine.getMixerState();
      const peak = mixerState.masterPeakDb || -90;
      const rms = mixerState.masterRmsDb || -90;
      return {
        peakDb: peak,
        rmsDb: rms,
        isClipping: peak >= 0,
      };
    };

    return {
      manifest,
      logger: scopedLogger,
      events: scopedEvents,
      commands: scopedCommands,
      state: stateStore,
      getAudioMetrics,
    };
  }

  /**
   * Registers a new or sideloaded plugin into the host.
   */
  public async registerPlugin(
    manifestCandidate: unknown,
    pluginImpl?: Plugin
  ): Promise<{ success: boolean; instance?: PluginInstance; error?: string }> {
    const valResult = validateManifest(manifestCandidate);
    if (!valResult.valid || !valResult.manifest) {
      return {
        success: false,
        error: `Manifest Validation Failed: ${valResult.errors.join('; ')}`,
      };
    }

    const manifest = valResult.manifest;
    const existing = this.instances.get(manifest.id);
    if (existing) {
      logger.info('PluginHost', `Overwriting existing plugin registration: ${manifest.id}`);
      await this.disablePlugin(manifest.id);
    }

    const instance: PluginInstance = {
      manifest,
      state: 'READY',
      compatibility: valResult.compatibility,
      enabled: false,
      plugin: pluginImpl,
      installedAt: Date.now(),
      validationWarnings: valResult.warnings,
      runtimeMode: 'in_process_prototype',
    };

    this.instances.set(manifest.id, instance);
    this.broadcastPluginEvent('plugin.installed', {
      pluginId: manifest.id,
      timestamp: Date.now(),
      state: 'READY',
    });
    this.notify();

    return { success: true, instance };
  }

  public async unregisterPlugin(pluginId: string): Promise<boolean> {
    const instance = this.instances.get(pluginId);
    if (!instance) return false;

    if (instance.enabled) {
      await this.disablePlugin(pluginId);
    }

    if (instance.plugin && typeof instance.plugin.dispose === 'function') {
      try {
        await instance.plugin.dispose();
      } catch (e) {
        logger.warn('PluginHost', `Plugin dispose error: ${pluginId}`, { error: e });
      }
    }

    instance.state = 'UNINSTALLED';
    this.instances.delete(pluginId);
    this.storage.delete(pluginId);
    this.notify();
    return true;
  }

  public async enablePlugin(pluginId: string): Promise<boolean> {
    const instance = this.instances.get(pluginId);
    if (!instance) return false;

    try {
      instance.state = 'VALIDATING';
      this.notify();

      const context = this.createPluginContext(instance.manifest);

      if (instance.plugin) {
        if (typeof instance.plugin.initialize === 'function') {
          await instance.plugin.initialize(context);
        }
        if (typeof instance.plugin.start === 'function') {
          await instance.plugin.start();
        }
      }

      instance.enabled = true;
      instance.state = 'ENABLED';
      instance.errorMessage = undefined;
      instance.lastExecutionMs = Date.now();

      this.broadcastPluginEvent('plugin.enabled', {
        pluginId,
        timestamp: Date.now(),
        state: 'ENABLED',
      });
      this.notify();
      logger.info('PluginHost', `Plugin enabled: ${instance.manifest.name} (${pluginId})`);
      return true;
    } catch (err: any) {
      instance.state = 'ERROR';
      instance.errorMessage = err?.message || String(err);
      this.broadcastPluginEvent('plugin.error', {
        pluginId,
        timestamp: Date.now(),
        state: 'ERROR',
        details: instance.errorMessage,
      });
      this.notify();
      logger.error('PluginHost', `Failed enabling plugin "${pluginId}"`, { error: err });
      return false;
    }
  }

  public async disablePlugin(pluginId: string): Promise<boolean> {
    const instance = this.instances.get(pluginId);
    if (!instance) return false;

    try {
      if (instance.plugin && typeof instance.plugin.stop === 'function') {
        await instance.plugin.stop();
      }

      instance.enabled = false;
      instance.state = 'DISABLED';
      this.broadcastPluginEvent('plugin.disabled', {
        pluginId,
        timestamp: Date.now(),
        state: 'DISABLED',
      });
      this.notify();
      logger.info('PluginHost', `Plugin disabled: ${instance.manifest.name} (${pluginId})`);
      return true;
    } catch (err: any) {
      instance.state = 'ERROR';
      instance.errorMessage = err?.message || String(err);
      this.notify();
      logger.error('PluginHost', `Failed disabling plugin "${pluginId}"`, { error: err });
      return false;
    }
  }

  public getPlugins(): PluginInstance[] {
    return Array.from(this.instances.values());
  }

  public getPlugin(id: string): PluginInstance | undefined {
    return this.instances.get(id);
  }

  public subscribe(listener: (plugins: PluginInstance[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.getPlugins());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const list = this.getPlugins();
    this.listeners.forEach((l) => {
      try {
        l(list);
      } catch (err) {
        logger.error('PluginHost', 'Error in plugin listener callback', { error: err });
      }
    });
  }

  public dispose() {
    if (this.utilityTimerId !== null) {
      clearInterval(this.utilityTimerId);
      this.utilityTimerId = null;
    }
    this.busUnsubscribers.forEach((unsub) => unsub());
    this.busUnsubscribers = [];
  }
}

export const pluginHost = new PluginHost();
