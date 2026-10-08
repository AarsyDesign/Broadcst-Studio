import {
  PluginPermission,
  verifyCommandAuthorization,
} from '../../../packages/plugin-sdk/src';
import { logger } from '../logger';

export interface PluginCommandAuditEntry {
  auditId: string;
  pluginId: string;
  command: string;
  allowed: boolean;
  requiredPermission?: PluginPermission;
  reason?: string;
  timestamp: string;
}

export class PermissionManager {
  private auditLog: PluginCommandAuditEntry[] = [];
  private readonly maxAuditEntries = 100;

  /**
   * Evaluates if a plugin is authorized to invoke an application command.
   * Model: FAIL-CLOSED (Default Deny).
   * Automatically records each invocation attempt in the audit log.
   */
  public verifyCommand(
    pluginId: string,
    declaredPermissions: readonly PluginPermission[],
    command: string
  ): { allowed: boolean; reason?: string; requiredPermission?: PluginPermission } {
    const result = verifyCommandAuthorization(pluginId, declaredPermissions, command);

    const auditEntry: PluginCommandAuditEntry = {
      auditId: `pca_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      pluginId,
      command,
      allowed: result.allowed,
      requiredPermission: result.requiredPermission,
      reason: result.reason,
      timestamp: new Date().toISOString(),
    };

    this.auditLog.unshift(auditEntry);
    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog.pop();
    }

    if (!result.allowed) {
      logger.warn('PermissionManager', `Security policy violation: ${result.reason}`, {
        pluginId,
        command,
        requiredPermission: result.requiredPermission,
      });
    }

    return result;
  }

  /**
   * Checks whether a specific permission is granted.
   */
  public hasPermission(
    declaredPermissions: readonly PluginPermission[],
    permission: PluginPermission
  ): boolean {
    return declaredPermissions.includes(permission);
  }

  /**
   * Retrieves recorded plugin command audit entries for diagnostics.
   */
  public getAuditLog(): PluginCommandAuditEntry[] {
    return [...this.auditLog];
  }

  public clearAuditLog(): void {
    this.auditLog = [];
  }
}

export const permissionManager = new PermissionManager();
