import { AudioDevice } from '../types/audio';
import { eventBus } from './operations/eventBus';
import { logger } from './logger';

export class DeviceManager {
  private devices: AudioDevice[] = [];
  private selectedDeviceId: string = '';
  private listeners: Set<(devices: AudioDevice[]) => void> = new Set();

  constructor() {
    this.initDeviceListener();
  }

  private initDeviceListener() {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', () => {
        logger.info('DeviceManager', 'Audio hardware change detected, refreshing device list');
        this.enumerateDevices();
      });
    }
  }

  public async enumerateDevices(): Promise<AudioDevice[]> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      logger.warn('DeviceManager', 'MediaDevices API not supported in this runtime environment, using fallback devices');
      return this.getFallbackDevices();
    }

    try {
      // Enumerate system audio devices
      const mediaDeviceInfos = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = mediaDeviceInfos.filter((d) => d.kind === 'audioinput');

      if (audioInputs.length === 0) {
        return this.getFallbackDevices();
      }

      this.devices = audioInputs.map((d, index) => ({
        id: d.deviceId || `device-${index}`,
        name: d.label || (index === 0 ? 'Primary System Microphone' : `Audio Input ${index + 1}`),
        isDefault: d.deviceId === 'default' || index === 0,
        channels: 2,
        sampleRate: 48000,
      }));

      if (!this.selectedDeviceId && this.devices.length > 0) {
        this.selectedDeviceId = this.devices[0].id;
      }

      logger.info('DeviceManager', `Enumerated ${this.devices.length} audio input device(s)`);
      this.notifyListeners();
      return this.devices;
    } catch (err) {
      logger.error('DeviceManager', 'Failed to enumerate audio devices', { error: err });
      return this.getFallbackDevices();
    }
  }

  public getFallbackDevices(): AudioDevice[] {
    this.devices = [
      { id: 'default', name: 'Default Audio Capture Device', isDefault: true, channels: 2, sampleRate: 48000 },
      { id: 'usb-mic-1', name: 'USB Broadcast Microphone (Live)', isDefault: false, channels: 2, sampleRate: 48000 },
      { id: 'line-in-1', name: 'Aux Line In (Console Stereo)', isDefault: false, channels: 2, sampleRate: 48000 },
    ];
    if (!this.selectedDeviceId) {
      this.selectedDeviceId = this.devices[0].id;
    }
    return this.devices;
  }

  public getDevices(): AudioDevice[] {
    return this.devices.length > 0 ? this.devices : this.getFallbackDevices();
  }

  public getSelectedDeviceId(): string {
    return this.selectedDeviceId;
  }

  public setSelectedDeviceId(id: string) {
    this.selectedDeviceId = id;
    logger.info('DeviceManager', `Active input device set to: ${id}`);
  }

  public onDevicesChanged(callback: (devices: AudioDevice[]) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners() {
    eventBus.emit('audio:device_changed', { devices: this.devices });
    this.listeners.forEach((listener) => {
      try {
        listener(this.devices);
      } catch (err) {
        logger.error('DeviceManager', 'Error notifying device listener', { error: err });
      }
    });
  }
}

export const deviceManager = new DeviceManager();
