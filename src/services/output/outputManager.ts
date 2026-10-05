import { BroadcastOutputTarget } from './types';
import { logger } from '../logger';
import { shoutcastService } from '../shoutcastService';

class OutputManager {
  private targets: BroadcastOutputTarget[] = [
    {
      id: 'target-primary-shoutcast',
      name: 'Primary SHOUTcast Server',
      type: 'shoutcast_v1',
      server: 'radio.example.org',
      port: 8000,
      bitrate: 128,
      codec: 'MP3',
      enabled: true,
      status: 'OFFLINE',
      bytesSent: 0,
      uptimeSeconds: 0,
    },
    {
      id: 'target-icecast-backup',
      name: 'Secondary Icecast Standby',
      type: 'icecast',
      server: 'backup.example.org',
      port: 8000,
      mountPoint: '/live.mp3',
      bitrate: 128,
      codec: 'MP3',
      enabled: false,
      status: 'OFFLINE',
      bytesSent: 0,
      uptimeSeconds: 0,
    },
  ];

  private listeners: Set<(targets: BroadcastOutputTarget[]) => void> = new Set();

  constructor() {
    shoutcastService.onStatusChange((status) => {
      const primary = this.targets.find((t) => t.id === 'target-primary-shoutcast');
      if (primary) {
        primary.status = status.state === 'CONNECTED' ? 'CONNECTED' : status.state === 'CONNECTING' ? 'CONNECTING' : 'OFFLINE';
        primary.uptimeSeconds = status.uptimeSeconds;
        this.notify();
      }
    });

    shoutcastService.onMetricsChange((metrics) => {
      const primary = this.targets.find((t) => t.id === 'target-primary-shoutcast');
      if (primary) {
        primary.bytesSent = metrics.bytesSent;
        this.notify();
      }
    });
  }

  public getTargets(): BroadcastOutputTarget[] {
    return [...this.targets];
  }

  public toggleTarget(id: string): boolean {
    const target = this.targets.find((t) => t.id === id);
    if (!target) return false;

    target.enabled = !target.enabled;
    logger.info('OutputManager', `Target '${target.name}' enabled state: ${target.enabled}`);
    this.notify();
    return target.enabled;
  }

  public addTarget(target: Omit<BroadcastOutputTarget, 'id' | 'bytesSent' | 'uptimeSeconds' | 'status'>): BroadcastOutputTarget {
    const newTarget: BroadcastOutputTarget = {
      ...target,
      id: `target-${Date.now()}`,
      bytesSent: 0,
      uptimeSeconds: 0,
      status: 'OFFLINE',
    };
    this.targets.push(newTarget);
    this.notify();
    return newTarget;
  }

  public subscribe(callback: (targets: BroadcastOutputTarget[]) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notify() {
    const list = this.getTargets();
    this.listeners.forEach((cb) => {
      try {
        cb(list);
      } catch (err) {
        logger.error('OutputManager', 'Error in output listener', { error: err });
      }
    });
  }
}

export const outputManager = new OutputManager();
