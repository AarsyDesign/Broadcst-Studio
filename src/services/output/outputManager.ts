import { BroadcastOutputTarget } from './types';
import { logger } from '../logger';
import { shoutcastService } from '../shoutcastService';
import { icecastService } from '../icecast/icecastService';

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
      server: 'icecast.example.org',
      port: 8000,
      mountPoint: '/live',
      bitrate: 128,
      codec: 'MP3',
      enabled: false,
      status: 'OFFLINE',
      bytesSent: 0,
      uptimeSeconds: 0,
    },
    {
      id: 'target-opus-mobile',
      name: 'Mobile High-Efficiency Feed',
      type: 'icecast',
      server: 'mobile.example.org',
      port: 8000,
      mountPoint: '/mobile.opus',
      bitrate: 64,
      codec: 'OPUS',
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

    icecastService.subscribe((status) => {
      const icecastTarget = this.targets.find((t) => t.id === 'target-icecast-backup');
      if (icecastTarget) {
        icecastTarget.status = status.state === 'CONNECTED' ? 'CONNECTED' : status.state === 'CONNECTING' ? 'CONNECTING' : 'OFFLINE';
        icecastTarget.uptimeSeconds = status.uptimeSeconds;
        icecastTarget.bytesSent = status.bytesSent;
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

  public async connectTarget(id: string): Promise<boolean> {
    const target = this.targets.find((t) => t.id === id);
    if (!target) return false;

    if (target.type === 'shoutcast_v1' || target.type === 'shoutcast_v2') {
      await shoutcastService.connect();
      return true;
    } else if (target.type === 'icecast') {
      return await icecastService.connect({
        server: target.server,
        port: target.port,
        mountPoint: target.mountPoint || '/live',
        bitrate: target.bitrate,
        codec: (target.codec as any) || 'MP3',
      });
    }
    return false;
  }

  public async disconnectTarget(id: string): Promise<void> {
    const target = this.targets.find((t) => t.id === id);
    if (!target) return;

    if (target.type === 'shoutcast_v1' || target.type === 'shoutcast_v2') {
      await shoutcastService.disconnect();
    } else if (target.type === 'icecast') {
      await icecastService.disconnect();
    }
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

  public removeTarget(id: string): boolean {
    const initialLen = this.targets.length;
    this.targets = this.targets.filter((t) => t.id !== id);
    if (this.targets.length !== initialLen) {
      this.notify();
      return true;
    }
    return false;
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
