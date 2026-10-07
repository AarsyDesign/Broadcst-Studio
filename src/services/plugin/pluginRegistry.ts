import {
  Plugin,
  PluginInstance,
  PluginManifest,
  ValidationResult,
  validateManifest,
  validatePluginPackage,
} from './types';
import { pluginHost } from './pluginHost';
import { logger } from '../logger';

// Import official example plugins for local development testing
import { voiceProcessorPlugin } from '../../../plugins/examples/example-audio-processor';
import { metadataSyncPlugin } from '../../../plugins/examples/example-metadata-sync';
import { stationIdAutomationPlugin } from '../../../plugins/examples/example-station-id-automation';
import { silenceDetectorPlugin } from '../../../plugins/examples/example-silence-detector';

export interface SamplePluginEntry {
  manifest: PluginManifest;
  plugin: Plugin;
  isOfficialExample: boolean;
}

const LOCAL_SAMPLE_PLUGINS: SamplePluginEntry[] = [
  {
    manifest: voiceProcessorPlugin.manifest,
    plugin: voiceProcessorPlugin,
    isOfficialExample: true,
  },
  {
    manifest: metadataSyncPlugin.manifest,
    plugin: metadataSyncPlugin,
    isOfficialExample: true,
  },
  {
    manifest: stationIdAutomationPlugin.manifest,
    plugin: stationIdAutomationPlugin,
    isOfficialExample: true,
  },
  {
    manifest: silenceDetectorPlugin.manifest,
    plugin: silenceDetectorPlugin,
    isOfficialExample: true,
  },
];

/**
 * Local-First Plugin Registry
 *
 * Separates Developer Direct In-Memory Registration from Structured Package Loading.
 * No online marketplace or cloud telemetry.
 */
class PluginRegistry {
  private listeners: (() => void)[] = [];

  constructor() {
    this.initializeDefaultPlugins();
  }

  private async initializeDefaultPlugins() {
    // Automatically register the sample plugins into the host in ready/disabled state
    for (const sample of LOCAL_SAMPLE_PLUGINS) {
      await pluginHost.registerPlugin(sample.manifest, sample.plugin, 'DEV_DIRECT_REGISTRATION');
    }
  }

  public getInstalled(): PluginInstance[] {
    return pluginHost.getPlugins();
  }

  public getAvailableSamples(): SamplePluginEntry[] {
    return [...LOCAL_SAMPLE_PLUGINS];
  }

  public isInstalled(id: string): boolean {
    return !!pluginHost.getPlugin(id);
  }

  public validate(candidate: unknown): ValidationResult {
    return validateManifest(candidate);
  }

  /**
   * DEV DIRECT REGISTRATION:
   * Sideloads a manifest with an optional in-memory developer implementation.
   * If customPluginImpl is omitted, the plugin will register but fail enable
   * until a runtime entrypoint is provided.
   */
  public async installFromManifest(
    manifestCandidate: unknown,
    customPluginImpl?: Plugin
  ): Promise<{ success: boolean; error?: string; validation?: ValidationResult }> {
    const valResult = this.validate(manifestCandidate);
    if (!valResult.valid || !valResult.manifest) {
      return {
        success: false,
        error: `Invalid manifest: ${valResult.errors.join('; ')}`,
        validation: valResult,
      };
    }

    const regResult = await pluginHost.registerPlugin(
      valResult.manifest,
      customPluginImpl,
      'DEV_DIRECT_REGISTRATION'
    );
    if (!regResult.success) {
      return {
        success: false,
        error: regResult.error,
        validation: valResult,
      };
    }

    logger.info('PluginRegistry', `Directly registered: ${valResult.manifest.name} (${valResult.manifest.id})`);
    this.notify();
    return { success: true, validation: valResult };
  }

  /**
   * PLUGIN PACKAGE LOADING:
   * Loads a structured package object or unpacked archive.
   */
  public async installFromPackage(
    packageCandidate: unknown,
    runtimeImpl?: Plugin
  ): Promise<{ success: boolean; error?: string; validation?: ValidationResult }> {
    const pkgResult = validatePluginPackage(packageCandidate);
    if (!pkgResult.success || !pkgResult.manifest) {
      return {
        success: false,
        error: pkgResult.error || 'Invalid package archive structure',
        validation: pkgResult.validation,
      };
    }

    const regResult = await pluginHost.registerPlugin(
      pkgResult.manifest,
      runtimeImpl,
      'PLUGIN_PACKAGE'
    );
    if (!regResult.success) {
      return {
        success: false,
        error: regResult.error,
        validation: pkgResult.validation,
      };
    }

    logger.info('PluginRegistry', `Loaded package: ${pkgResult.manifest.name} (${pkgResult.manifest.id})`);
    this.notify();
    return { success: true, validation: pkgResult.validation };
  }

  public async installSample(pluginId: string): Promise<boolean> {
    const found = LOCAL_SAMPLE_PLUGINS.find((s) => s.manifest.id === pluginId);
    if (!found) return false;

    const res = await pluginHost.registerPlugin(found.manifest, found.plugin, 'DEV_DIRECT_REGISTRATION');
    if (res.success) {
      this.notify();
      return true;
    }
    return false;
  }

  public async enablePlugin(pluginId: string): Promise<boolean> {
    const ok = await pluginHost.enablePlugin(pluginId);
    this.notify();
    return ok;
  }

  public async disablePlugin(pluginId: string): Promise<boolean> {
    const ok = await pluginHost.disablePlugin(pluginId);
    this.notify();
    return ok;
  }

  public async uninstallPlugin(pluginId: string): Promise<boolean> {
    const ok = await pluginHost.unregisterPlugin(pluginId);
    this.notify();
    return ok;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    const hostUnsub = pluginHost.subscribe(() => listener());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
      hostUnsub();
    };
  }

  private notify() {
    this.listeners.forEach((l) => {
      try {
        l();
      } catch (err) {
        logger.error('PluginRegistry', 'Notification error', { error: err });
      }
    });
  }
}

export const pluginRegistry = new PluginRegistry();
