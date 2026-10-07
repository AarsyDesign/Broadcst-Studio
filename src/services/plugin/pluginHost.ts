import {
  AudioMetricsReadout,
  getExecutionDomain,
  Plugin,
  PluginContext,
  PluginEventMap,
  PluginEventName,
  PluginInstance,
  PluginManifest,
  PluginRegistrationSource,
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
 * ARCHITECTURAL INTEGRITY & RUNTIME HARDENING:
 * 1. Default-Deny Permission Boundary: Unknown or unpermitted commands are rejected.
 * 2. Deterministic Lifecycle: Failed initialize/start transitions to ERROR and enabled=false.
 * 3. Error Isolation: A crashing plugin is isolated to state=ERROR; unrelated plugins continue.
 * 4. Listener & Timer Lifecycle: Disabled plugins do not receive events; listeners are purged on disable/uninstall.
 * 5. Architectural Honesty: Distinguishes Realtime Audio (Domain A: contract/native target) from Non-Realtime (Domain B).
 */
class PluginHost {
  private instances: Map<string, PluginInstance> = new Map();
  private storage: Map<string, Map<string, unknown>> = new Map();
  private utilityTimerId: number | null = null;
  private listeners: Set<(plugins: PluginInstance[]) => void> = new Set();
  private busUnsubscribers: (() => void)[] = [];

  /**
   * Per-plugin scoped event listeners: pluginId -> (event -> Set<listener>)
   * Enables complete listener teardown when a plugin is disabled or errors.
   */
  private pluginListeners: Map<string, Map<PluginEventName, Set<(payload: any) => void>>> = new Map();

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

  /**
   * Broadcasts a typed application event to registered, ENABLED plugin listeners.
   * Isolates exceptions so a failure in Plugin A does not crash Plugin B.
   */
  private broadcastPluginEvent<E extends PluginEventName>(event: E, payload: PluginEventMap[E]) {
    this.pluginListeners.forEach((eventMap, pluginId) => {
      const instance = this.instances.get(pluginId);
      // Only dispatch to active and enabled plugins
      if (!instance || !instance.enabled || instance.state !== 'ENABLED') {
        return;
      }

      const listeners = eventMap.get(event);
      if (!listeners || listeners.size === 0) return;

      listeners.forEach((fn) => {
        try {
          fn(payload);
        } catch (err: any) {
          logger.error('PluginHost', `Plugin "${pluginId}" crashed in event handler for "${event}"`, {
            error: err,
          });

          // Isolate error strictly to this plugin
          instance.state = 'ERROR';
          instance.enabled = false;
          instance.errorMessage = `Unhandled error in event handler "${event}": ${err?.message || String(err)}`;

          // Purge this plugin's listeners immediately
          this.cleanupPluginListeners(pluginId);

          this.broadcastPluginEvent('plugin.error', {
            pluginId,
            timestamp: Date.now(),
            state: 'ERROR',
            details: instance.errorMessage,
          });
          this.notify();
        }
      });
    });
  }

  /**
   * Cleans up all event listeners registered by a specific plugin.
   */
  private cleanupPluginListeners(pluginId: string) {
    this.pluginListeners.delete(pluginId);
  }

  /**
   * Periodic background ticker for domain B UTILITY plugins.
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
              instance.enabled = false;
              instance.errorMessage = `Utility tick exception: ${err?.message || String(err)}`;
              this.cleanupPluginListeners(instance.manifest.id);
              this.notify();
            }
          }
        }
      });
    }, 1000);
  }

  /**
   * Creates an isolated execution context for a plugin instance.
   * Gated by default-deny permissions and scoped logging/state.
   */
  public createPluginContext(manifest: PluginManifest): PluginContext {
    const pluginId = manifest.id;

    // Scoped session in-memory state store
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

    // Scoped event bus (isolated per plugin)
    const scopedEvents = {
      on: <E extends PluginEventName>(event: E, listener: (payload: PluginEventMap[E]) => void): (() => void) => {
        let pluginMap = this.pluginListeners.get(pluginId);
        if (!pluginMap) {
          pluginMap = new Map();
          this.pluginListeners.set(pluginId, pluginMap);
        }
        if (!pluginMap.has(event)) {
          pluginMap.set(event, new Set());
        }
        pluginMap.get(event)!.add(listener);

        return () => {
          pluginMap?.get(event)?.delete(listener);
        };
      },
      emit: <E extends PluginEventName>(event: E, payload: PluginEventMap[E]) => {
        this.broadcastPluginEvent(event, payload);
      },
    };

    // Scoped command executor (FAIL-CLOSED: Default-Deny)
    const scopedCommands = {
      execute: async <TResult = unknown>(command: string, params?: unknown): Promise<TResult> => {
        const auth = permissionManager.verifyCommand(pluginId, manifest.permissions, command);
        if (!auth.allowed) {
          throw new Error(
            auth.reason || `Permission Denied: Plugin "${pluginId}" is not authorized to execute command "${command}".`
          );
        }

        // Map short command aliases to controlApi actions
        let cmdToRun = command;
        if (command === 'NEXT_TRACK') cmdToRun = 'control.action.next_track';
        if (command === 'PLAY_DECK') cmdToRun = 'deck.play';
        if (command === 'START_RECORDING') cmdToRun = 'recording.start';
        if (command === 'STOP_RECORDING') cmdToRun = 'recording.stop';

        try {
          const res = await controlApi.execute(cmdToRun as any, params, 'AUTOMATION');
          if (!res.success) {
            throw new Error(res.error || `Command "${command}" execution failed.`);
          }
          return res.data as TResult;
        } catch (err: any) {
          throw new Error(`Command execution error: ${err?.message || String(err)}`);
        }
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
   * Registers a new plugin instance in the host.
   */
  public async registerPlugin(
    manifestCandidate: unknown,
    pluginImpl?: Plugin,
    registrationSource: PluginRegistrationSource = 'DEV_DIRECT_REGISTRATION'
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
      registrationSource,
      executionDomain: getExecutionDomain(manifest.type),
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

    this.cleanupPluginListeners(pluginId);

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

  /**
   * Enables a plugin with strict entrypoint validation and deterministic error state.
   */
  public async enablePlugin(pluginId: string): Promise<boolean> {
    const instance = this.instances.get(pluginId);
    if (!instance) return false;

    // Entrypoint validation: require a concrete runtime implementation
    if (!instance.plugin) {
      instance.state = 'ERROR';
      instance.enabled = false;
      instance.errorMessage = 'Manifest valid, plugin runtime entrypoint unavailable.';
      this.notify();
      logger.warn('PluginHost', `Cannot enable plugin "${pluginId}": runtime entrypoint unavailable.`);
      return false;
    }

    try {
      instance.state = 'VALIDATING';
      this.notify();

      const context = this.createPluginContext(instance.manifest);

      if (typeof instance.plugin.initialize === 'function') {
        await instance.plugin.initialize(context);
      }
      if (typeof instance.plugin.start === 'function') {
        await instance.plugin.start();
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
      // Deterministic failure: state = ERROR, enabled = false, purge listeners
      instance.state = 'ERROR';
      instance.enabled = false;
      instance.errorMessage = err?.message || String(err);
      this.cleanupPluginListeners(pluginId);

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

  /**
   * Disables a plugin, stops background workers, and tears down all event listeners.
   */
  public async disablePlugin(pluginId: string): Promise<boolean> {
    const instance = this.instances.get(pluginId);
    if (!instance) return false;

    try {
      if (instance.plugin && typeof instance.plugin.stop === 'function') {
        await instance.plugin.stop();
      }

      instance.enabled = false;
      instance.state = 'DISABLED';
      this.cleanupPluginListeners(pluginId);

      this.broadcastPluginEvent('plugin.disabled', {
        pluginId,
        timestamp: Date.now(),
        state: 'DISABLED',
      });
      this.notify();
      logger.info('PluginHost', `Plugin disabled: ${instance.manifest.name} (${pluginId})`);
      return true;
    } catch (err: any) {
      // Failure to disable cleanly moves to ERROR
      instance.state = 'ERROR';
      instance.enabled = false;
      instance.errorMessage = `Disable error: ${err?.message || String(err)}`;
      this.cleanupPluginListeners(pluginId);
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
    this.pluginListeners.clear();
    this.busUnsubscribers.forEach((unsub) => unsub());
    this.busUnsubscribers = [];
  }
}

export const pluginHost = new PluginHost();
