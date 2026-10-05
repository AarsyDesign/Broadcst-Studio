import { PluginManifest } from './types';
import { pluginHost } from './pluginHost';
import { logger } from '../logger';

export interface RegistryPluginItem {
  manifest: PluginManifest;
  author: string;
  downloadsCount: number;
  rating: number;
  featured: boolean;
  tags: string[];
}

const REGISTRY_CATALOG: RegistryPluginItem[] = [
  {
    manifest: {
      id: 'dsp-voice-processor',
      name: 'Broadcast Master Voice Processor',
      version: '1.2.0',
      description: '3-band dynamics compressor, expander/gate, and automatic gain leveler designed for broadcast microphone signals.',
      category: 'audio_effect',
      author: 'AcousticDSP Labs',
      permissions: ['audio_process'],
      entryPoint: 'dsp_voice.js',
    },
    author: 'AcousticDSP Labs',
    downloadsCount: 1420,
    rating: 4.9,
    featured: true,
    tags: ['voice', 'compressor', 'dynamics', 'eq'],
  },
  {
    manifest: {
      id: 'ebu-r128-loudness-meter',
      name: 'EBU R128 LUFS Loudness Radar',
      version: '1.1.0',
      description: 'Real-time integrated, momentary, and short-term LUFS loudness monitor compliant with ITU-R BS.1770-4 standards.',
      category: 'utility',
      author: 'Broadcast Norm Group',
      permissions: ['audio_process'],
      entryPoint: 'lufs_radar.js',
    },
    author: 'Broadcast Norm Group',
    downloadsCount: 980,
    rating: 4.8,
    featured: true,
    tags: ['loudness', 'lufs', 'meter', 'broadcast-standard'],
  },
  {
    manifest: {
      id: 'azuracast-metadata-bridge',
      name: 'AzuraCast & LibreTime Metadata Bridge',
      version: '2.0.1',
      description: 'Bidirectional sync of track titles, album art, and real-time listener counts with AzuraCast radio servers.',
      category: 'metadata',
      author: 'OpenRadio Project',
      permissions: ['metadata_read', 'metadata_write', 'network_out'],
      entryPoint: 'azuracast.js',
    },
    author: 'OpenRadio Project',
    downloadsCount: 2150,
    rating: 4.9,
    featured: true,
    tags: ['azuracast', 'libretime', 'metadata', 'listeners'],
  },
  {
    manifest: {
      id: 'silence-detector-failover',
      name: 'Emergency Silence Detector & Auto-Failover',
      version: '1.3.0',
      description: 'Monitors master audio bus and automatically fires emergency backup music if silence drops below -48 dBFS for more than 10s.',
      category: 'automation',
      author: 'Reliability Audio',
      permissions: ['audio_process', 'network_out'],
      entryPoint: 'silence_guard.js',
    },
    author: 'Reliability Audio',
    downloadsCount: 1650,
    rating: 4.7,
    featured: false,
    tags: ['silence', 'failover', 'backup', 'automation'],
  },
  {
    manifest: {
      id: 'discord-broadcast-bot',
      name: 'Discord On-Air Live Webhook',
      version: '1.0.4',
      description: 'Automatically posts rich Discord embeds with now-playing titles and direct stream listen links when broadcast goes on air.',
      category: 'automation',
      author: 'Community Bots',
      permissions: ['metadata_read', 'network_out'],
      entryPoint: 'discord_webhook.js',
    },
    author: 'Community Bots',
    downloadsCount: 820,
    rating: 4.6,
    featured: false,
    tags: ['discord', 'webhook', 'social', 'notifications'],
  },
  {
    manifest: {
      id: 'parametric-5band-eq',
      name: 'Parametric 5-Band Studio Equalizer',
      version: '1.0.0',
      description: 'High-precision parametric tone shaping with low-cut rumble filter, bell mid filters, and air band high shelf.',
      category: 'audio_effect',
      author: 'Studio Audio Tools',
      permissions: ['audio_process'],
      entryPoint: 'eq_5band.js',
    },
    author: 'Studio Audio Tools',
    downloadsCount: 1110,
    rating: 4.8,
    featured: false,
    tags: ['eq', 'parametric', 'filter', 'studio'],
  },
  {
    manifest: {
      id: 'icecast-standby-switcher',
      name: 'Icecast Standby Redundancy Switcher',
      version: '1.1.2',
      description: 'High-availability stream failover controller that switches connection to standby Icecast mount if primary socket drops.',
      category: 'output',
      author: 'StreamEngine Systems',
      permissions: ['network_out'],
      entryPoint: 'icecast_standby.js',
    },
    author: 'StreamEngine Systems',
    downloadsCount: 740,
    rating: 4.7,
    featured: false,
    tags: ['icecast', 'redundancy', 'failover', 'output'],
  },
];

class PluginRegistry {
  private catalog: RegistryPluginItem[] = [...REGISTRY_CATALOG];
  private listeners: (() => void)[] = [];

  public getCatalog(): RegistryPluginItem[] {
    return [...this.catalog];
  }

  public isInstalled(pluginId: string): boolean {
    const installed = pluginHost.getPlugins();
    return installed.some((p) => p.manifest.id === pluginId);
  }

  public async installPlugin(pluginId: string): Promise<boolean> {
    const item = this.catalog.find((c) => c.manifest.id === pluginId);
    if (!item) {
      logger.warn('PluginRegistry', `Plugin ID '${pluginId}' not found in registry`);
      return false;
    }

    try {
      await pluginHost.registerPlugin(item.manifest);
      await pluginHost.enablePlugin(item.manifest.id);
      logger.info('PluginRegistry', `Successfully installed and enabled plugin: ${item.manifest.name}`);
      this.notify();
      return true;
    } catch (err) {
      logger.error('PluginRegistry', `Failed installing plugin '${pluginId}'`, { error: err });
      return false;
    }
  }

  public async uninstallPlugin(pluginId: string): Promise<boolean> {
    try {
      await pluginHost.disablePlugin(pluginId);
      await pluginHost.unregisterPlugin(pluginId);
      logger.info('PluginRegistry', `Uninstalled plugin: ${pluginId}`);
      this.notify();
      return true;
    } catch (err) {
      logger.error('PluginRegistry', `Failed uninstalling plugin '${pluginId}'`, { error: err });
      return false;
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
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
