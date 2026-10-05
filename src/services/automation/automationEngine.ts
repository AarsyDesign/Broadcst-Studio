import { AutomationAction, AutomationExecutionLog, AutomationRule } from './types';
import { logger } from '../logger';
import { shoutcastService } from '../shoutcastService';
import { recorderService } from '../recorderService';
import { audioEngine } from '../audioEngine';

class AutomationEngine {
  private rules: AutomationRule[] = [];
  private logs: AutomationExecutionLog[] = [];
  private listeners: Set<(rules: AutomationRule[]) => void> = new Set();
  private logListeners: Set<(logs: AutomationExecutionLog[]) => void> = new Set();
  private intervalHandles: Map<string, number> = new Map();

  constructor() {
    this.initDefaultRules();
    this.setupEventListeners();
  }

  private initDefaultRules() {
    this.rules = [
      {
        id: 'rule-auto-record',
        name: 'Auto-record on ON AIR',
        description: 'Automatically starts master session recording whenever the broadcast connects.',
        enabled: true,
        trigger: {
          type: 'EVENT',
          eventName: 'broadcast.status.changed',
          eventCondition: { key: 'state', value: 'CONNECTED' },
        },
        action: {
          type: 'START_RECORD',
          payload: { title: 'Auto-recorded On-Air Session' },
        },
        triggerCount: 0,
      },
      {
        id: 'rule-stop-record',
        name: 'Stop recording on OFFLINE',
        description: 'Stops audio recording session when broadcast goes offline.',
        enabled: true,
        trigger: {
          type: 'EVENT',
          eventName: 'broadcast.status.changed',
          eventCondition: { key: 'state', value: 'OFFLINE' },
        },
        action: {
          type: 'STOP_RECORD',
        },
        triggerCount: 0,
      },
      {
        id: 'rule-hourly-chime',
        name: 'Station Identification Chime',
        description: 'Plays a cue chime tone every 30 minutes on the jingle channel.',
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
        description: 'Updates default station metadata at morning sign-on.',
        enabled: true,
        trigger: {
          type: 'EVENT',
          eventName: 'broadcast.status.changed',
          eventCondition: { key: 'state', value: 'CONNECTED' },
        },
        action: {
          type: 'PUSH_METADATA',
          payload: { title: 'Program Siaran Pagi', artist: 'Penyiar Bertugas' },
        },
        triggerCount: 0,
      },
    ];

    this.refreshIntervalTriggers();
  }

  private setupEventListeners() {
    shoutcastService.onStatusChange((status) => {
      this.evaluateEventRules('broadcast.status.changed', status);
    });
  }

  private evaluateEventRules(eventName: string, payload: any) {
    for (const rule of this.rules) {
      if (!rule.enabled || rule.trigger.type !== 'EVENT') continue;
      if (rule.trigger.eventName !== eventName) continue;

      if (rule.trigger.eventCondition) {
        const { key, value } = rule.trigger.eventCondition;
        if (payload[key] !== value) continue;
      }

      this.executeRule(rule, `Event triggered: ${eventName} (${JSON.stringify(payload.state || '')})`);
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
    let success = false;
    let detailMsg = '';

    try {
      await this.runAction(rule.action);
      success = true;
      detailMsg = `Action ${rule.action.type} completed successfully`;
      rule.triggerCount++;
      rule.lastTriggeredAt = new Date().toISOString();
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

    this.notifyRules();
    this.notifyLogs();
    return success;
  }

  private async runAction(action: AutomationAction) {
    switch (action.type) {
      case 'START_BROADCAST':
        await shoutcastService.connect();
        break;
      case 'STOP_BROADCAST':
        await shoutcastService.disconnect();
        break;
      case 'START_RECORD':
        await recorderService.startRecording(action.payload?.title);
        break;
      case 'STOP_RECORD':
        await recorderService.stopRecording();
        break;
      case 'PLAY_TONE':
        audioEngine.playTone(action.payload?.freq || 440, action.payload?.durationMs || 500, 'soundboard');
        break;
      case 'PUSH_METADATA':
        if (action.payload) {
          shoutcastService.setMetadata({
            title: action.payload.title || 'Broadcast Title',
            artist: action.payload.artist || 'Station Host',
            stationName: shoutcastService.getConfig().stationName,
          });
        }
        break;
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
    this.refreshIntervalTriggers();
    this.notifyRules();
    return newRule;
  }

  public deleteRule(ruleId: string) {
    this.rules = this.rules.filter((r) => r.id !== ruleId);
    this.refreshIntervalTriggers();
    this.notifyRules();
  }

  public onRulesChanged(callback: (rules: AutomationRule[]) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  public onLogsChanged(callback: (logs: AutomationExecutionLog[]) => void): () => void {
    this.logListeners.add(callback);
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
