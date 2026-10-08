import { OperationActionType, OperationRequest, OperationResult, OperatorCaller } from './types';
import { eventBus } from './eventBus';
import { historyService } from '../history/historyService';
import { shoutcastService } from '../shoutcastService';
import { recorderService } from '../recorderService';
import { audioEngine } from '../audioEngine';
import { recoveryManager } from '../recovery/recoveryManager';
import { logger } from '../logger';
import { ipc } from '../ipc';

class OperationsManager {
  public async dispatch<T = any>(request: OperationRequest): Promise<OperationResult<T>> {
    const operationId = request.id || `op-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const startTime = Date.now();
    const executedAt = new Date().toISOString();

    logger.info('OperationsManager', `Dispatching action '${request.action}' from caller '${request.caller}'`, {
      operationId,
      payload: request.payload,
    });

    eventBus.emit('operation:dispatched', {
      ...request,
      id: operationId,
    });

    let success = false;
    let data: any = undefined;
    let error: string | undefined = undefined;

    try {
      data = await this.executeAction(request.action, request.payload, request.caller);
      success = true;
    } catch (err: any) {
      success = false;
      error = err?.message || String(err);
      logger.error('OperationsManager', `Operation '${request.action}' failed`, { operationId, error: err });
    }

    const durationMs = Date.now() - startTime;
    const result: OperationResult<T> = {
      operationId,
      action: request.action,
      caller: request.caller,
      success,
      executedAt,
      durationMs,
      data,
      error,
    };

    // Log to authoritative audit history
    historyService.recordAuditLog({
      operationId,
      action: request.action,
      caller: request.caller,
      timestamp: executedAt,
      durationMs,
      success,
      params: request.payload,
      error,
    });

    eventBus.emit('operation:completed', result);
    return result;
  }

  private async executeAction(action: OperationActionType, payload?: Record<string, any>, caller: OperatorCaller = 'OPERATOR_UI'): Promise<any> {
    switch (action) {
      case 'START_BROADCAST': {
        if (payload?.config) {
          shoutcastService.updateConfig(payload.config);
        }
        const status = await shoutcastService.connect();
        const config = shoutcastService.getConfig();
        historyService.recordSessionStart({
          server: config.server,
          port: config.port,
          streamId: config.streamId,
          bitrate: config.bitrate,
          codec: config.codec,
          stationName: config.stationName,
        });
        eventBus.emit('broadcast:connected', {
          server: config.server,
          streamId: config.streamId,
          bitrate: config.bitrate,
        });
        return status;
      }

      case 'STOP_BROADCAST': {
        const stats = shoutcastService.getStatus();
        const status = await shoutcastService.disconnect();
        eventBus.emit('broadcast:disconnected', {
          durationSeconds: stats.uptimeSeconds,
          bytesSent: 0,
        });
        return status;
      }

      case 'RECONNECT_BROADCAST': {
        if (ipc.isNative()) {
          return await ipc.invoke('broadcast.reconnect');
        } else {
          return await shoutcastService.reconnect();
        }
      }

      case 'UPDATE_CONFIG': {
        if (payload?.config) {
          shoutcastService.updateConfig(payload.config);
          if (ipc.isNative()) {
            await ipc.invoke('broadcast.update_config', { config: payload.config });
          }
          return shoutcastService.getConfig();
        }
        return null;
      }

      case 'PLAY_DECK': {
        const deckId = payload?.deckId || 'deck_a';
        const { playbackService } = await import('../playbackService');
        await playbackService.playDeck(deckId);
        eventBus.emit('deck:state_changed', { deckId, state: 'playing' });
        return { deckId, state: 'playing' };
      }

      case 'PAUSE_DECK': {
        const deckId = payload?.deckId || 'deck_a';
        const { playbackService } = await import('../playbackService');
        await playbackService.pauseDeck(deckId);
        eventBus.emit('deck:state_changed', { deckId, state: 'paused' });
        return { deckId, state: 'paused' };
      }

      case 'STOP_DECK': {
        const deckId = payload?.deckId || 'deck_a';
        const { playbackService } = await import('../playbackService');
        await playbackService.stopDeck(deckId);
        eventBus.emit('deck:state_changed', { deckId, state: 'stopped' });
        return { deckId, state: 'stopped' };
      }

      case 'RESTART_DECK': {
        const deckId = payload?.deckId || 'deck_a';
        const { playbackService } = await import('../playbackService');
        return await playbackService.triggerControlAction('restart_deck', { deckId });
      }

      case 'UNLOAD_DECK': {
        const deckId = payload?.deckId || 'deck_a';
        const { playbackService } = await import('../playbackService');
        return await playbackService.triggerControlAction('unload_deck', { deckId });
      }

      case 'CUE_DECK': {
        const deckId = payload?.deckId || 'deck_a';
        const { playbackService } = await import('../playbackService');
        return await playbackService.triggerControlAction('toggle_deck_cue', { deckId });
      }

      case 'RETURN_TO_CUE': {
        const deckId = payload?.deckId || 'deck_a';
        const { playbackService } = await import('../playbackService');
        return await playbackService.triggerControlAction('return_to_cue', { deckId });
      }

      case 'START_FROM_CUE': {
        const deckId = payload?.deckId || 'deck_a';
        const { playbackService } = await import('../playbackService');
        return await playbackService.triggerControlAction('start_from_cue', { deckId });
      }

      case 'TRANSITION': {
        const targetDeckId = payload?.targetDeckId || 'deck_b';
        const mode = payload?.mode || 'linear_crossfade';
        const durationMs = payload?.durationMs || 2000;
        const { playbackService } = await import('../playbackService');
        await playbackService.triggerTransition(targetDeckId, mode, durationMs);
        eventBus.emit('deck:transition_triggered', { targetDeckId, mode });
        return { targetDeckId, mode, durationMs };
      }

      case 'SET_CROSSFADER': {
        const value = typeof payload?.value === 'number' ? payload.value : 0;
        const { playbackService } = await import('../playbackService');
        await playbackService.setCrossfader(value);
        return { crossfader: value };
      }

      case 'NEXT_TRACK': {
        const { playbackService } = await import('../playbackService');
        return await playbackService.triggerControlAction('next_track');
      }

      case 'LOAD_TRACK': {
        const deckId = (payload?.deckId || 'deck_a') as 'deck_a' | 'deck_b';
        const filePath = payload?.filePath;
        if (!filePath) throw new Error('File path required for LOAD_TRACK');
        const { playbackService } = await import('../playbackService');
        return await playbackService.loadDeck(deckId, filePath);
      }

      case 'SET_FADER': {
        const ch = payload?.channelId || 'master';
        const level = typeof payload?.level === 'number' ? payload.level : 0.85;
        audioEngine.setChannelFader(ch, level);
        eventBus.emit('audio:fader_changed', { channelId: ch, level });
        return { channelId: ch, level };
      }

      case 'SET_MUTE': {
        const ch = payload?.channelId || 'mic';
        audioEngine.toggleMute(ch);
        return { channelId: ch };
      }

      case 'START_RECORDING': {
        const prefix = payload?.prefix || payload?.title;
        const res = await recorderService.startRecording(prefix);
        eventBus.emit('recording:started', { id: `rec-${Date.now()}`, startedAt: new Date().toISOString() });
        return res;
      }

      case 'STOP_RECORDING': {
        const res = await recorderService.stopRecording();
        eventBus.emit('recording:stopped', {
          id: `rec-${Date.now()}`,
          durationSeconds: res?.durationSeconds || 0,
          filePath: res?.blobUrl || '',
        });
        return res;
      }

      case 'PUSH_METADATA': {
        const meta = {
          title: payload?.title || 'Live Transmission',
          artist: payload?.artist || 'Broadcst Studio',
          stationName: shoutcastService.getConfig().stationName,
        };
        shoutcastService.setMetadata(meta);
        eventBus.emit('broadcast:metadata_updated', meta);
        return meta;
      }

      case 'SWITCH_STATION_PROFILE': {
        const profileId = payload?.profileId;
        if (!profileId) throw new Error('profileId required for SWITCH_STATION_PROFILE');
        const { stationProfileManager } = await import('../profile/stationProfileManager');
        const success = await stationProfileManager.switchProfile(profileId);
        const active = stationProfileManager.getActiveProfile();
        eventBus.emit('profile:switched', { activeProfile: active });
        return { profileId, success };
      }

      case 'RECOVER_HARDWARE': {
        const inDev = payload?.preferredInput;
        const outDev = payload?.preferredOutput;
        const reason = payload?.reason || caller;
        return await recoveryManager.recoverAudioHardware(inDev, outDev, reason);
      }

      default:
        throw new Error(`Unknown operation action: '${action}'`);
    }
  }

  // --- Convenience Macro Helpers for UI & Hotkeys ---
  public execute(action: OperationActionType, payload?: Record<string, any>, caller: OperatorCaller = 'OPERATOR_UI') {
    return this.dispatch({ action, payload, caller });
  }
}

export const operationsManager = new OperationsManager();
