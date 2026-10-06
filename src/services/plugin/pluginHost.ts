import type { PluginInstance, PluginManifest } from './types';
import { logger } from '../logger';
import { shoutcastService } from '../shoutcastService';
import { audioEngine } from '../audioEngine';

class PluginHost {
  private plugins: Map<string, PluginInstance> = new Map();
  private listeners: Set<(plugins: PluginInstance[]) => void> = new Set();
  private intervals: Map<string, number> = new Map();

  constructor() {
    this.registerBuiltInPlugins();
  }

  private registerBuiltInPlugins() {
    const builtIns: PluginInstance[] = [
      {
        manifest: {
          id: 'plugin-auto-ducking',
          name: 'Studio Auto-Ducking',
          version: '1.2.0',
          author: 'Broadcast Ecosystem Team',
          description: 'Automatically ducks background music by -12dB when speech activity is detected on mic.',
          category: 'audio_effect',
          permissions: ['audio_process'],
        },
        status: 'STOPPED',
        enabled: false,
        runtimeMode: 'in_process_prototype',
      },
      {
        manifest: {
          id: 'plugin-voice-leveler',
          name: 'Dynamic Voice Leveler',
          version: '2.0.1',
          author: 'Broadcast Audio Labs',
          description: 'Multiband voice broadcast leveling to ensure steady loudness and vocal presence.',
          category: 'audio_effect',
          permissions: ['audio_process'],
        },
        status: 'RUNNING',
        enabled: true,
        runtimeMode: 'in_process_prototype',
      },
      {
        manifest: {
          id: 'plugin-now-playing-poller',
          name: 'Now Playing RSS/JSON Poller',
          version: '1.0.4',
          author: 'StreamTools Community',
          description: 'Periodically polls radio automation software API and updates SHOUTcast ICY metadata.',
          category: 'metadata',
          permissions: ['network_out', 'metadata_write'],
        },
        status: 'RUNNING',
        enabled: true,
        runtimeMode: 'in_process_prototype',
      },
      {
        manifest: {
          id: 'plugin-backup-stream',
          name: 'Redundant Stream Mirror',
          version: '0.9.0',
          author: 'Infrastructure Core',
          description: 'Forks encoder packets to a secondary standby streaming server for high availability.',
          category: 'output',
          permissions: ['network_out'],
        },
        status: 'STOPPED',
        enabled: false,
        runtimeMode: 'in_process_prototype',
      },
    ];

    for (const p of builtIns) {
      this.plugins.set(p.manifest.id, p);
      if (p.enabled) {
        this.startPlugin(p.manifest.id);
      }
    }
  }

  public getPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  public getPlugin(id: string): PluginInstance | undefined {
    return this.plugins.get(id);
  }

  public async enablePlugin(id: string): Promise<boolean> {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;

    plugin.enabled = true;
    plugin.errorMessage = undefined;
    const success = await this.startPlugin(id);
    this.notify();
    return success;
  }

  public async disablePlugin(id: string): Promise<boolean> {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;

    plugin.enabled = false;
    await this.stopPlugin(id);
    this.notify();
    return true;
  }

  private async startPlugin(id: string): Promise<boolean> {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;

    plugin.status = 'STARTING';
    this.notify();

    try {
      // In-process prototype handler execution
      if (id === 'plugin-auto-ducking') {
        this.runAutoDuckingHandler(plugin);
      } else if (id === 'plugin-now-playing-poller') {
        this.runMetadataPollerHandler(plugin);
      } else if (id === 'plugin-voice-leveler') {
        plugin.status = 'RUNNING';
      } else {
        plugin.status = 'RUNNING';
      }

      logger.info('PluginHost', `Plugin successfully started: ${plugin.manifest.name}`);
      this.notify();
      return true;
    } catch (err: any) {
      plugin.status = 'ERROR';
      plugin.errorMessage = err?.message || 'Failed to start plugin in in-process prototype';
      logger.error('PluginHost', `Plugin failure in in-process prototype for ${plugin.manifest.name}: ${plugin.errorMessage}`);
      this.notify();
      return false;
    }
  }

  private async stopPlugin(id: string): Promise<boolean> {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;

    const interval = this.intervals.get(id);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(id);
    }

    plugin.status = 'STOPPED';
    logger.info('PluginHost', `Plugin stopped: ${plugin.manifest.name}`);
    this.notify();
    return true;
  }

  // Diagnostic test hook for error handling path
  public simulateCrash(id: string) {
    const plugin = this.plugins.get(id);
    if (!plugin) return;

    const interval = this.intervals.get(id);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(id);
    }

    plugin.status = 'CRASHED';
    plugin.errorMessage = 'Diagnostic test: InProcessExecutionFault';
    logger.error('PluginHost', `Diagnostic test event on '${plugin.manifest.name}'`);
    this.notify();
  }

  private runAutoDuckingHandler(plugin: PluginInstance) {
    plugin.status = 'RUNNING';

    // Auto-ducking loop monitoring mic channel
    const interval = window.setInterval(() => {
      if (plugin.status !== 'RUNNING') return;

      const mixer = audioEngine.getMixerState();
      const micChannel = mixer.channels.find((c) => c.id === 'mic');
      const musicChannel = mixer.channels.find((c) => c.id === 'music');

      if (micChannel && musicChannel) {
        // If voice peak is above -35 dBFS, duck music to 0.35, otherwise restore to 0.70
        const isSpeaking = micChannel.peakDb > -35;
        const targetFader = isSpeaking ? 0.35 : 0.7;

        if (Math.abs(musicChannel.faderLevel - targetFader) > 0.05) {
          audioEngine.setChannelFader('music', targetFader);
        }
      }
    }, 200);

    this.intervals.set(plugin.manifest.id, interval);
  }

  private runMetadataPollerHandler(plugin: PluginInstance) {
    plugin.status = 'RUNNING';

    const sampleTracks = [
      { title: 'Kajian Tauhid Bagian 1', artist: 'Ustadz Pembicara' },
      { title: 'Tadabbur Al-Quran Juz 30', artist: 'Qari Pilihan' },
      { title: 'Bincang Siang Nusantara', artist: 'Studio Broadcaster' },
      { title: 'Muhasabah dan Doa Bersama', artist: 'Majelis Siaran' },
    ];
    let trackIdx = 0;

    const interval = window.setInterval(() => {
      if (plugin.status !== 'RUNNING') return;

      // Only update metadata if broadcast is ON AIR
      const bStatus = shoutcastService.getStatus();
      if (bStatus.state === 'CONNECTED') {
        const trk = sampleTracks[trackIdx % sampleTracks.length];
        shoutcastService.setMetadata({
          title: trk.title,
          artist: trk.artist,
          stationName: bStatus.config.stationName,
        });
        trackIdx++;
      }
    }, 45000); // every 45s

    this.intervals.set(plugin.manifest.id, interval);
  }

  public async registerPlugin(manifest: PluginManifest): Promise<PluginInstance> {
    const existing = this.plugins.get(manifest.id);
    if (existing) {
      existing.manifest = manifest;
      this.notify();
      return existing;
    }

    const instance: PluginInstance = {
      manifest,
      status: 'STOPPED',
      enabled: false,
      runtimeMode: 'in_process_prototype',
    };
    this.plugins.set(manifest.id, instance);
    this.notify();
    logger.info('PluginHost', `Registered plugin: ${manifest.name} (${manifest.id})`);
    return instance;
  }

  public async unregisterPlugin(id: string): Promise<boolean> {
    if (!this.plugins.has(id)) return false;
    await this.disablePlugin(id);
    this.plugins.delete(id);
    this.notify();
    logger.info('PluginHost', `Unregistered plugin: ${id}`);
    return true;
  }

  public subscribe(listener: (plugins: PluginInstance[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const list = this.getPlugins();
    this.listeners.forEach((listener) => {
      try {
        listener(list);
      } catch (err) {
        logger.error('PluginHost', 'Error in plugin host listener', { error: err });
      }
    });
  }
}

export const pluginHost = new PluginHost();
