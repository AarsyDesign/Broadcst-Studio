import { PluginPermission } from './types';

/**
 * Mapping of controlled application actions to required permissions.
 */
export const COMMAND_PERMISSION_MAP: Record<string, PluginPermission> = {
  // Audio control actions
  'deck.play': 'automation.execute',
  'deck.pause': 'automation.execute',
  'deck.stop': 'automation.execute',
  'deck.seek': 'automation.execute',
  'deck.set_gain': 'audio.write',
  'deck.set_mute': 'audio.write',
  'deck.set_crossfader': 'audio.write',
  'deck.trigger_transition': 'automation.execute',
  'mixer.set_fader': 'audio.write',
  'mixer.set_mute': 'audio.write',
  'mixer.set_solo': 'audio.write',

  // Playlist / automation actions
  'playlist.play_index': 'automation.execute',
  'playlist.next': 'automation.execute',
  'playlist.add_file': 'automation.execute',
  'control.action.next_track': 'automation.execute',
  'control.action.play_deck': 'automation.execute',

  // Metadata actions
  'broadcast.set_metadata': 'metadata.write',
  'shoutcast.update_metadata': 'metadata.write',
  'metadata.push': 'metadata.write',

  // Recording actions
  'recording.start': 'automation.execute',
  'recording.stop': 'automation.execute',

  // Output syndication actions
  'output.start': 'output.manage',
  'output.stop': 'output.manage',
  'output.configure': 'output.manage',
  'output.get_status': 'output.manage',

  // UI contribution actions
  'ui.register': 'ui.contribute',
  'ui.unregister': 'ui.contribute',

  // Direct short action aliases
  PLAY_DECK: 'automation.execute',
  NEXT_TRACK: 'automation.execute',
  SET_METADATA: 'metadata.write',
  START_RECORDING: 'automation.execute',
  STOP_RECORDING: 'automation.execute',
  SET_FADER: 'audio.write',
  SET_MUTE: 'audio.write',
  START_OUTPUT: 'output.manage',
  STOP_OUTPUT: 'output.manage',
};

/**
 * Checks whether a plugin with the given declared permissions possesses
 * the specific capability requested.
 */
export function checkPluginPermission(
  declared: readonly PluginPermission[],
  required: PluginPermission
): boolean {
  return declared.includes(required);
}

export interface CommandPermissionCheck {
  allowed: boolean;
  requiredPermission?: PluginPermission;
  reason?: string;
}

/**
 * Checks whether a command is recognized in the Broadcst Plugin API command allowlist.
 */
export function isCommandKnown(command: string): boolean {
  return Object.prototype.hasOwnProperty.call(COMMAND_PERMISSION_MAP, command.trim());
}

/**
 * Validates if a plugin is authorized to invoke a particular application command.
 * SECURITY MODEL: FAIL-CLOSED (DEFAULT-DENY)
 * 1. Known command + declared permission -> ALLOW
 * 2. Known command + missing permission -> DENY
 * 3. Unknown or unmapped command -> DENY
 */
export function verifyCommandAuthorization(
  pluginId: string,
  declared: readonly PluginPermission[],
  command: string
): CommandPermissionCheck {
  const normalizedCommand = command.trim();
  const required = COMMAND_PERMISSION_MAP[normalizedCommand];

  // FAIL-CLOSED: Any command not in the explicit allowlist is rejected
  if (!required) {
    return {
      allowed: false,
      reason: `Unknown or unsupported command: "${command}". Commands must be explicitly registered in the Broadcst Plugin API allowlist.`,
    };
  }

  if (checkPluginPermission(declared, required)) {
    return {
      allowed: true,
      requiredPermission: required,
    };
  }

  return {
    allowed: false,
    requiredPermission: required,
    reason: `Plugin "${pluginId}" attempted command "${command}" which requires permission "${required}", but only declared [${declared.join(', ')}].`,
  };
}
