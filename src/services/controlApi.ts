import { CommandMap, CommandName } from '../types/ipc';
import { ipc } from './ipc';
import { logger } from './logger';

export type CommandSeverity = 'READ_ONLY' | 'OPERATIONAL' | 'CRITICAL';
export type CallerType = 'UI' | 'AI_ASSISTANT' | 'MCP_SERVER' | 'AUTOMATION';

export interface AuditLogEntry {
  auditId: string;
  command: string;
  caller: CallerType;
  severity: CommandSeverity;
  timestamp: string;
  success: boolean;
  params?: any;
  error?: string;
}

export interface ControlActionResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  auditId: string;
  executedAt: string;
  severity: CommandSeverity;
}

export interface ControlApiPolicy {
  allowAiCriticalCommands: boolean;
  allowMcpCriticalCommands: boolean;
  maxCallsPerSecond: number;
}

class ControlAPI {
  private auditLog: AuditLogEntry[] = [];
  private listeners: ((entry: AuditLogEntry) => void)[] = [];
  private callTimestamps: number[] = [];
  private policy: ControlApiPolicy = {
    allowAiCriticalCommands: true,
    allowMcpCriticalCommands: true,
    maxCallsPerSecond: 40,
  };

  public getSeverity(command: CommandName): CommandSeverity {
    switch (command) {
      case 'broadcast.stop':
      case 'broadcast.start':
        return 'CRITICAL';
      case 'broadcast.reconnect':
      case 'audio.set_gain':
      case 'audio.set_fader':
      case 'audio.mute':
      case 'transcript.start':
      case 'transcript.stop':
      case 'recording.start':
      case 'recording.stop':
      case 'metadata.set':
        return 'OPERATIONAL';
      case 'broadcast.get_status':
      case 'audio.get_devices':
      case 'audio.get_metrics':
      case 'stream.get_metrics':
      case 'telemetry.get_snapshot':
      case 'transcript.get_segments':
      default:
        return 'READ_ONLY';
    }
  }

  public setPolicy(newPolicy: Partial<ControlApiPolicy>) {
    this.policy = { ...this.policy, ...newPolicy };
    logger.info('ControlAPI', 'Security policy updated', this.policy as any);
  }

  public getPolicy(): ControlApiPolicy {
    return { ...this.policy };
  }

  public onAudit(callback: (entry: AuditLogEntry) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  public async execute<K extends CommandName>(
    command: K,
    params?: CommandMap[K]['params'],
    caller: CallerType = 'UI'
  ): Promise<ControlActionResult<CommandMap[K]['result']>> {
    const auditId = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const timestamp = new Date().toISOString();
    const severity = this.getSeverity(command);

    // Rate limiting check
    const now = Date.now();
    this.callTimestamps = this.callTimestamps.filter((t) => now - t < 1000);
    if (this.callTimestamps.length >= this.policy.maxCallsPerSecond) {
      const errorMsg = `Rate limit exceeded (${this.policy.maxCallsPerSecond} calls/sec cap)`;
      logger.warn('ControlAPI', `[${caller}] ${errorMsg}`, { command, auditId });
      const rejectedEntry: AuditLogEntry = {
        auditId,
        command,
        caller,
        severity,
        timestamp,
        success: false,
        params,
        error: errorMsg,
      };
      this.recordAudit(rejectedEntry);
      return {
        success: false,
        error: errorMsg,
        auditId,
        executedAt: timestamp,
        severity,
      };
    }
    this.callTimestamps.push(now);

    // Permission and safety policy check
    if (severity === 'CRITICAL') {
      if (caller === 'AI_ASSISTANT' && !this.policy.allowAiCriticalCommands) {
        const errorMsg = 'AI Assistant is blocked from executing CRITICAL commands by current policy';
        logger.warn('ControlAPI', errorMsg, { command, auditId });
        const rejectedEntry: AuditLogEntry = {
          auditId,
          command,
          caller,
          severity,
          timestamp,
          success: false,
          params,
          error: errorMsg,
        };
        this.recordAudit(rejectedEntry);
        return {
          success: false,
          error: errorMsg,
          auditId,
          executedAt: timestamp,
          severity,
        };
      }

      if (caller === 'MCP_SERVER' && !this.policy.allowMcpCriticalCommands) {
        const errorMsg = 'MCP Server is blocked from executing CRITICAL commands by current policy';
        logger.warn('ControlAPI', errorMsg, { command, auditId });
        const rejectedEntry: AuditLogEntry = {
          auditId,
          command,
          caller,
          severity,
          timestamp,
          success: false,
          params,
          error: errorMsg,
        };
        this.recordAudit(rejectedEntry);
        return {
          success: false,
          error: errorMsg,
          auditId,
          executedAt: timestamp,
          severity,
        };
      }
    }

    logger.info('ControlAPI', `[${caller}] [${severity}] Executing hardened command '${command}'`, {
      auditId,
      params,
    });

    try {
      // Hardened parameter validation
      this.validateCommandParams(command, params);

      const result = await ipc.invoke(command, params);
      const auditEntry: AuditLogEntry = {
        auditId,
        command,
        caller,
        severity,
        timestamp,
        success: true,
        params,
      };
      this.recordAudit(auditEntry);

      return {
        success: true,
        data: result,
        auditId,
        executedAt: timestamp,
        severity,
      };
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      logger.error('ControlAPI', `Command '${command}' execution rejected or failed: ${errorMsg}`, { auditId });
      const auditEntry: AuditLogEntry = {
        auditId,
        command,
        caller,
        severity,
        timestamp,
        success: false,
        params,
        error: errorMsg,
      };
      this.recordAudit(auditEntry);

      return {
        success: false,
        error: errorMsg,
        auditId,
        executedAt: timestamp,
        severity,
      };
    }
  }

  private validateCommandParams<K extends CommandName>(command: K, params?: any) {
    if (command === 'audio.set_gain') {
      if (!params?.channelId || typeof params.channelId !== 'string') {
        throw new Error('Invalid channelId: must be a non-empty string');
      }
      if (typeof params?.gainDb !== 'number' || params.gainDb < -60 || params.gainDb > 12) {
        throw new Error('Invalid gainDb: must be a number between -60 and +12 dB');
      }
    }

    if (command === 'audio.set_fader') {
      if (!params?.channelId || typeof params.channelId !== 'string') {
        throw new Error('Invalid channelId: must be a non-empty string');
      }
      if (typeof params?.level !== 'number' || params.level < 0 || params.level > 1) {
        throw new Error('Invalid fader level: must be a number between 0.0 and 1.0');
      }
    }

    if (command === 'audio.mute') {
      if (!params?.channelId || typeof params.channelId !== 'string') {
        throw new Error('Invalid channelId: must be a non-empty string');
      }
      if (typeof params?.muted !== 'boolean') {
        throw new Error('Invalid muted state: must be boolean');
      }
    }

    if (command === 'metadata.set') {
      if (!params?.metadata || typeof params.metadata !== 'object') {
        throw new Error('Invalid metadata object');
      }
      if (!params.metadata.title || typeof params.metadata.title !== 'string') {
        throw new Error('Invalid metadata: title field is mandatory and must be a string');
      }
      if (!params.metadata.artist || typeof params.metadata.artist !== 'string') {
        throw new Error('Invalid metadata: artist field is mandatory and must be a string');
      }
    }

    if (command === 'broadcast.start' && params?.config) {
      const cfg = params.config;
      if (cfg.port && (typeof cfg.port !== 'number' || cfg.port < 1 || cfg.port > 65535)) {
        throw new Error('Invalid broadcast port: must be between 1 and 65535');
      }
      if (cfg.bitrate && (typeof cfg.bitrate !== 'number' || cfg.bitrate < 32 || cfg.bitrate > 320)) {
        throw new Error('Invalid bitrate: must be between 32 and 320 kbps');
      }
    }

    if (command === 'transcript.get_segments' && params) {
      if (params.limit !== undefined && (typeof params.limit !== 'number' || params.limit <= 0 || params.limit > 1000)) {
        throw new Error('Invalid limit: must be a positive number up to 1000');
      }
      if (params.sinceMs !== undefined && (typeof params.sinceMs !== 'number' || params.sinceMs < 0)) {
        throw new Error('Invalid sinceMs: must be a non-negative number');
      }
    }
  }

  private recordAudit(entry: AuditLogEntry) {
    this.auditLog.unshift(entry);
    if (this.auditLog.length > 250) {
      this.auditLog.pop();
    }
    this.listeners.forEach((listener) => {
      try {
        listener(entry);
      } catch (err) {
        logger.error('ControlAPI', 'Audit listener threw an error', { error: err });
      }
    });
  }

  public getAuditHistory(): AuditLogEntry[] {
    return [...this.auditLog];
  }

  public clearAuditHistory() {
    this.auditLog = [];
  }
}

export const controlApi = new ControlAPI();
