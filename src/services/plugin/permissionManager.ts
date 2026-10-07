import {
  PluginPermission,
  verifyCommandAuthorization,
} from '../../../packages/plugin-sdk/src';
import { logger } from '../logger';

export class PermissionManager {
  /**
   * Evaluates if a plugin is authorized to invoke an application command.
   * If unauthorized, logs a security warning and returns false.
   */
  public verifyCommand(
    pluginId: string,
    declaredPermissions: readonly PluginPermission[],
    command: string
  ): boolean {
    const result = verifyCommandAuthorization(pluginId, declaredPermissions, command);
    if (!result.allowed) {
      logger.warn('PermissionManager', `Security policy violation: ${result.reason}`, {
        pluginId,
        command,
        requiredPermission: result.requiredPermission,
      });
      return false;
    }
    return true;
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
}

export const permissionManager = new PermissionManager();
