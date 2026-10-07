export type OperatorCaller =
  | 'OPERATOR_UI'
  | 'HOTKEY'
  | 'SCHEDULE'
  | 'AUTOMATION'
  | 'SYSTEM_RECOVERY'
  | 'REMOTE_API';

export type OperationActionType =
  | 'START_BROADCAST'
  | 'STOP_BROADCAST'
  | 'RECONNECT_BROADCAST'
  | 'UPDATE_CONFIG'
  | 'PLAY_DECK'
  | 'PAUSE_DECK'
  | 'STOP_DECK'
  | 'RESTART_DECK'
  | 'UNLOAD_DECK'
  | 'CUE_DECK'
  | 'RETURN_TO_CUE'
  | 'START_FROM_CUE'
  | 'TRANSITION'
  | 'SET_CROSSFADER'
  | 'NEXT_TRACK'
  | 'LOAD_TRACK'
  | 'SET_FADER'
  | 'SET_MUTE'
  | 'START_RECORDING'
  | 'STOP_RECORDING'
  | 'PUSH_METADATA'
  | 'SWITCH_STATION_PROFILE'
  | 'RECOVER_HARDWARE';

export interface OperationRequest {
  id?: string;
  action: OperationActionType;
  caller: OperatorCaller;
  payload?: Record<string, any>;
  reason?: string;
}

export interface OperationResult<T = any> {
  operationId: string;
  action: OperationActionType;
  caller: OperatorCaller;
  success: boolean;
  executedAt: string;
  durationMs: number;
  data?: T;
  error?: string;
}
