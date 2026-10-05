export type TriggerType = 'EVENT' | 'INTERVAL';

export interface AutomationTrigger {
  type: TriggerType;
  eventName?: string; // e.g. 'broadcast.status.changed'
  eventCondition?: { key: string; value: any }; // e.g. { state: 'CONNECTED' }
  intervalSeconds?: number;
}

export type ActionType =
  | 'START_BROADCAST'
  | 'STOP_BROADCAST'
  | 'START_RECORD'
  | 'STOP_RECORD'
  | 'PLAY_TONE'
  | 'PUSH_METADATA';

export interface AutomationAction {
  type: ActionType;
  payload?: Record<string, any>;
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  action: AutomationAction;
  lastTriggeredAt?: string;
  triggerCount: number;
}

export interface AutomationExecutionLog {
  id: string;
  ruleId: string;
  ruleName: string;
  timestamp: string;
  status: 'SUCCESS' | 'FAILED';
  details: string;
}
