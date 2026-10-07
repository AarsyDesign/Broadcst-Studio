import { AutomationAction, AutomationExecutionLog, AutomationRule } from './types';
import { logger } from '../logger';
import { eventBus } from '../operations/eventBus';
import { operationsManager } from '../operations/operationsManager';
import { audioEngine } from '../audioEngine';

const DEFAULT_AUTOMATION_RULES: AutomationRule[] = [
  {
    id: 'rule-auto-record',
    name: 'Auto-record on ON AIR',
    description: 'Automatically starts master session recording whenever the broadcast connects.',
    enabled: true,
    trigger: {
      type: 'EVENT',
      eventName: 'broadcast:connected',
    },
    action: {
      type: 'START_RECORD',
      payload: { title: 'Auto-recorded On-Air Session' },
    },
    triggerCount: 0,
  },
  {
    id: 'rule-stop-record',
    name: 'Stop recording on Broadcast Disconnect',
    description: 'Stops audio recording session when broadcast goes offline.',
    enabled: true,
    trigger: {
      type: 'EVENT',
      eventName: 'broadcast:disconnected',
    },
    action: {
      type: 'STOP_RECORD',
    },
    triggerCount: 0,
  },
  {
    id: 'rule-hardware-auto-recover',
    name: 'Auto-recover on Audio Hardware Disconnect',
    description: 'Automatically re-initializes audio stream if a hardware device topology change occurs.',
    enabled: true,
    trigger: {
      type: 'EVENT',
      eventName: 'audio:device_changed',
    },
    action: {
      type: 'RECOVER_HARDWARE',
      payload: { reason: 'Automation Topology Watcher' },
    },
    triggerCount: 0,
  },
  {
    id: 'rule-hourly-chime',
    name: 'Station Identification Chime',
    description: 'Plays a cue chime tone every 30 minutes on the soundboard channel.',
    enabled: false,
    trigger: {
      type: 'INTERVAL',
      intervalSeconds: 1800,
    },
    action: {
      type: 'PLAY_TONE',
      payload: { freq: 880, durationMs: 400 },
    },
    triggerCount: 0,
  },
  {
    id: 'rule-daily-sign-on',
    name: 'Morning Broadcast Metadata Setup',
    description: 'Updates default station metadata at sign-on.',
    enabled: true,
    trigger: {
      type: 'EVENT',
      eventName: 'broadcast:connected',
    },
    action: {
      type: 'PUSH_METADATA',
      payload: { title: 'Program Siaran Live', artist: 'Penyiar Bertugas' },
    },
    triggerCount: 0,
  },
];

class AutomationEngine {
  private rules: AutomationRule[] = [];
  private logs: AutomationExecutionLog[] = [];
  private listeners: Set<(rules: AutomationRule[]) => void> = new Set();
  private logListeners: Set<(logs: AutomationExecutionLog[]) => void> = new Set();
  private intervalHandles: Map<string, number> = new Map();
  private ruleCooldowns: Map<string, number> = new Map();

  constructor() {
    this.loadPersisted();
    this.setupEventListeners();
  }

  private loadPersisted() {
    try {
      const raw = localStorage.getItem('broadcast_automation_rules');
      if (raw) {
        this.rules = JSON.parse(raw);
      } else {
        this.rules = [...DEFAULT_AUTOMATION_RULES];
      }
    } catch (err) {
      logger.error('AutomationEngine', 'Failed loading rules, using defaults', { error: err });
      this.rules = [...DEFAULT_AUTOMATION_RULES];
    }
    this.refreshIntervalTriggers();
  }

  private persist() {
    try {
      localStorage.setItem('broadcast_automation_rules', JSON.stringify(this.rules));
    } catch (err) {
      logger.error('AutomationEngine', 'Failed persisting rules', { error: err });
    }
  }

  private setupEventListeners() {
    // Listen to all central EventBus events
    eventBus.onAny((event, payload) => {
      this.evaluateEventRules(event, payload);
    });
  }

  private evaluateEventRules(eventName: string, payload: any) {
    for (const rule of this.rules) {
      if (!rule.enabled || rule.trigger.type !== 'EVENT') continue;
      if (rule.trigger.eventName !== eventName) continue;

      if (rule.trigger.eventCondition) {
        const { key, value } = rule.trigger.eventCondition;
        if (payload && payload[key] !== value) continue;
      }

      // Safeguard: 2-second debounce per rule to avoid infinite feedback loops
      const now = Date.now();
      const lastRan = this.ruleCooldowns.get(rule.id) || 0;
      if (now - lastRan < 2000) {
        logger.warn('AutomationEngine', `Throttling rule '${rule.name}' trigger loop`);
        continue;
      }
      this.ruleCooldowns.set(rule.id, now);

      this.executeRule(rule, `Event triggered: ${eventName}`);
    }
  }

  private refreshIntervalTriggers() {
    this.intervalHandles.forEach((handle) => clearInterval(handle));
    this.intervalHandles.clear();

    for (const rule of this.rules) {
      if (rule.enabled && rule.trigger.type === 'INTERVAL' && rule.trigger.intervalSeconds) {
        const handle = window.setInterval(() => {
          this.executeRule(rule, `Timer interval elapsed: ${rule.trigger.intervalSeconds}s`);
        }, rule.trigger.intervalSeconds * 1000);
        this.intervalHandles.set(rule.id, handle);
      }
    }
  }

  public async executeRule(rule: AutomationRule, triggerContext: string): Promise<boolean> {
    logger.info('AutomationEngine', `Executing rule '${rule.name}' - ${triggerContext}`);
    eventBus.emit('automation:rule_triggered', {
      ruleId: rule.id,
      ruleName: rule.name,
      triggerContext,
    });

    let success = false;
    let detailMsg = '';

    try {
      await this.runAction(rule.action);
      success = true;
      detailMsg = `Action ${rule.action.type} completed successfully`;
      rule.triggerCount++;
      rule.lastTriggeredAt = new Date().toISOString();
      this.persist();
    } catch (err: any) {
      success = false;
      detailMsg = `Action failed: ${err?.message || String(err)}`;
      logger.error('AutomationEngine', `Rule execution failed for '${rule.name}'`, { error: err });
    }

    const logEntry: AutomationExecutionLog = {
      id: `log-${Date.now()}`,
      ruleId: rule.id,
      ruleName: rule.name,
      timestamp: new Date().toISOString(),
      status: success ? 'SUCCESS' : 'FAILED',
      details: `${triggerContext} -> ${detailMsg}`,
    };

    this.logs.unshift(logEntry);
    if (this.logs.length > 100) this.logs.pop();

    eventBus.emit('automation:rule_executed', {
      ruleId: rule.id,
      ruleName: rule.name,
      success,
      details: detailMsg,
    });

    this.notifyRules();
    this.notifyLogs();
    return success;
  }

  private async runAction(action: AutomationAction) {
    if (action.type === 'PLAY_TONE') {
      audioEngine.playTone(action.payload?.freq || 440, action.payload?.durationMs || 500, 'soundboard');
      return;
    }

    // Map all other actions directly through OperationsManager
    let opAction: any;
    switch (action.type) {
      case 'START_BROADCAST':
        opAction = 'START_BROADCAST';
        break;
      case 'STOP_BROADCAST':
        opAction = 'STOP_BROADCAST';
        break;
      case 'START_RECORD':
        opAction = 'START_RECORDING';
        break;
      case 'STOP_RECORD':
        opAction = 'STOP_RECORDING';
        break;
      case 'PUSH_METADATA':
        opAction = 'PUSH_METADATA';
        break;
      case 'PLAY_DECK':
        opAction = 'PLAY_DECK';
        break;
      case 'PAUSE_DECK':
        opAction = 'PAUSE_DECK';
        break;
      case 'STOP_DECK':
        opAction = 'STOP_DECK';
        break;
      case 'NEXT_TRACK':
        opAction = 'NEXT_TRACK';
        break;
      case 'TRANSITION_DECK':
        opAction = 'TRANSITION';
        break;
      case 'SET_FADER':
        opAction = 'SET_FADER';
        break;
      case 'SET_MUTE':
        opAction = 'SET_MUTE';
        break;
      case 'RECOVER_HARDWARE':
        opAction = 'RECOVER_HARDWARE';
        break;
      case 'SWITCH_STATION_PROFILE':
        opAction = 'SWITCH_STATION_PROFILE';
        break;
      default:
        throw new Error(`Unhandled action type in automation runner: ${action.type}`);
    }

    const res = await operationsManager.dispatch({
      action: opAction,
      caller: 'AUTOMATION',
      payload: action.payload,
    });

    if (!res.success) {
      throw new Error(res.error || 'Operation failed');
    }
  }

  public getRules(): AutomationRule[] {
    return [...this.rules];
  }

  public getLogs(): AutomationExecutionLog[] {
    return [...this.logs];
  }

  public toggleRule(ruleId: string): boolean {
    const rule = this.rules.find((r) => r.id === ruleId);
    if (!rule) return false;

    rule.enabled = !rule.enabled;
    this.persist();
    this.refreshIntervalTriggers();
    this.notifyRules();
    logger.info('AutomationEngine', `Rule '${rule.name}' enabled state: ${rule.enabled}`);
    return rule.enabled;
  }

  public addRule(rule: Omit<AutomationRule, 'id' | 'triggerCount'>): AutomationRule {
    const newRule: AutomationRule = {
      ...rule,
      id: `rule-${Date.now()}`,
      triggerCount: 0,
    };
    this.rules.push(newRule);
    this.persist();
    this.refreshIntervalTriggers();
    this.notifyRules();
    return newRule;
  }

  public updateRule(ruleId: string, updates: Partial<AutomationRule>): boolean {
    const idx = this.rules.findIndex((r) => r.id === ruleId);
    if (idx === -1) return false;

    this.rules[idx] = { ...this.rules[idx], ...updates };
    this.persist();
    this.refreshIntervalTriggers();
    this.notifyRules();
    return true;
  }

  public deleteRule(ruleId: string) {
    this.rules = this.rules.filter((r) => r.id !== ruleId);
    this.persist();
    this.refreshIntervalTriggers();
    this.notifyRules();
  }

  public resetToDefaults() {
    this.rules = [...DEFAULT_AUTOMATION_RULES];
    this.persist();
    this.refreshIntervalTriggers();
    this.notifyRules();
  }

  public onRulesChanged(callback: (rules: AutomationRule[]) => void): () => void {
    this.listeners.add(callback);
    callback(this.getRules());
    return () => this.listeners.delete(callback);
  }

  public onLogsChanged(callback: (logs: AutomationExecutionLog[]) => void): () => void {
    this.logListeners.add(callback);
    callback(this.getLogs());
    return () => this.logListeners.delete(callback);
  }

  private notifyRules() {
    const r = this.getRules();
    this.listeners.forEach((cb) => {
      try {
        cb(r);
      } catch (err) {
        logger.error('AutomationEngine', 'Error notifying rules listener', { error: err });
      }
    });
  }

  private notifyLogs() {
    const l = this.getLogs();
    this.logListeners.forEach((cb) => {
      try {
        cb(l);
      } catch (err) {
        logger.error('AutomationEngine', 'Error notifying logs listener', { error: err });
      }
    });
  }
}

export const automationEngine = new AutomationEngine();
