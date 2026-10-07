import { ipc } from '../ipc';
import { deviceManager } from '../deviceManager';
import { eventBus } from '../operations/eventBus';
import { historyService } from '../history/historyService';
import { logger } from '../logger';
import { DeviceRecoveryResult } from '../../types/ipc';

export type SystemHealthStatus = 'HEALTHY' | 'RECOVERING' | 'DEGRADED';

class RecoveryManager {
  private status: SystemHealthStatus = 'HEALTHY';
  private lastRecoveryResult: DeviceRecoveryResult | null = null;
  private recoveryCount: number = 0;
  private listeners: Set<(status: SystemHealthStatus, result: DeviceRecoveryResult | null) => void> = new Set();

  constructor() {
    this.initDeviceWatcher();
  }

  private initDeviceWatcher() {
    // Listen for device change events from browser/OS
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', async () => {
        logger.warn('RecoveryManager', 'Hardware topology change detected via MediaDevices event');
        await this.handleHardwareTopologyChange();
      });
    }
  }

  private async handleHardwareTopologyChange() {
    try {
      const devices = await deviceManager.enumerateDevices();
      eventBus.emit('audio:device_changed', { devices });
      
      const currentSelected = deviceManager.getSelectedDeviceId();
      const stillExists = devices.some((d) => d.id === currentSelected);

      if (!stillExists && currentSelected && currentSelected !== 'default') {
        logger.warn('RecoveryManager', `Active input device '${currentSelected}' was unplugged. Initiating auto-recovery.`);
        await this.recoverAudioHardware(undefined, undefined, 'AUTOMATIC_DEVICE_DISCONNECT');
      }
    } catch (err) {
      logger.error('RecoveryManager', 'Error checking devices during topology change', { error: err });
    }
  }

  public async recoverAudioHardware(
    preferredInput?: string,
    preferredOutput?: string,
    reason: string = 'MANUAL_TRIGGER'
  ): Promise<DeviceRecoveryResult> {
    this.status = 'RECOVERING';
    this.notify();
    eventBus.emit('recovery:initiated', { reason });

    const startTime = Date.now();
    let result: DeviceRecoveryResult;

    try {
      if (ipc.isNative()) {
        result = await ipc.invoke('audio.recover_devices', {
          preferredInput,
          preferredOutput,
        });
      } else {
        // Fallback for non-Tauri / Web preview environment
        const devices = await deviceManager.enumerateDevices();
        const activeIn = devices[0]?.name || 'Default System Microphone';
        result = {
          captureStatus: 'ACTIVE',
          activeInputDevice: activeIn,
          monitorStatus: 'ACTIVE',
          activeOutputDevice: 'Default System Speaker',
          recovered: true,
          message: `Web environment hardware enumerated: active input '${activeIn}'`,
        };
      }

      this.lastRecoveryResult = result;
      this.recoveryCount++;
      this.status = result.recovered ? 'HEALTHY' : 'DEGRADED';

      logger.info('RecoveryManager', `Audio hardware recovery finished: ${result.message}`);
      eventBus.emit('recovery:completed', result);
      eventBus.emit('audio:device_recovered', result);

      historyService.recordAuditLog({
        operationId: `rec-${Date.now()}`,
        action: 'RECOVER_HARDWARE',
        caller: 'SYSTEM_RECOVERY',
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        success: result.recovered,
        params: { preferredInput, preferredOutput, reason },
        error: result.recovered ? undefined : result.message,
      });

      this.notify();
      return result;
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      result = {
        captureStatus: 'ERROR',
        activeInputDevice: null,
        monitorStatus: 'ERROR',
        activeOutputDevice: null,
        recovered: false,
        message: `Recovery failed: ${errorMsg}`,
      };

      this.lastRecoveryResult = result;
      this.status = 'DEGRADED';
      logger.error('RecoveryManager', 'Audio hardware recovery encountered error', { error: err });
      
      this.notify();
      return result;
    }
  }

  public async restoreWorkstationState() {
    logger.info('RecoveryManager', 'Restoring workstation state on startup...');
    try {
      // 1. Enumerate and verify devices
      await deviceManager.enumerateDevices();

      // 2. Load active station profile
      const { stationProfileManager } = await import('../profile/stationProfileManager');
      const activeProfile = stationProfileManager.getActiveProfile();
      if (activeProfile) {
        logger.info('RecoveryManager', `Restored active profile: ${activeProfile.name} (${activeProfile.callsign})`);
      }

      this.status = 'HEALTHY';
      this.notify();
    } catch (err) {
      logger.error('RecoveryManager', 'Failed restoring workstation state', { error: err });
      this.status = 'DEGRADED';
      this.notify();
    }
  }

  public getStatus(): SystemHealthStatus {
    return this.status;
  }

  public getLastResult(): DeviceRecoveryResult | null {
    return this.lastRecoveryResult;
  }

  public getRecoveryCount(): number {
    return this.recoveryCount;
  }

  public subscribe(listener: (status: SystemHealthStatus, result: DeviceRecoveryResult | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.status, this.lastRecoveryResult);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => {
      try {
        l(this.status, this.lastRecoveryResult);
      } catch (err) {
        logger.error('RecoveryManager', 'Listener error', { error: err });
      }
    });
  }
}

export const recoveryManager = new RecoveryManager();
