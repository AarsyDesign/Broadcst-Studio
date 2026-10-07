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

  // Direct short action aliases
  PLAY_DECK: 'automation.execute',
  NEXT_TRACK: 'automation.execute',
  SET_METADATA: 'metadata.write',
  START_RECORDING: 'automation.execute',
  STOP_RECORDING: 'automation.execute',
  SET_FADER: 'audio.write',
  SET_MUTE: 'audio.write',
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
 * Validates if a plugin is authorized to invoke a particular application command.
 */
export function verifyCommandAuthorization(
  pluginId: string,
  declared: readonly PluginPermission[],
  command: string
): CommandPermissionCheck {
  const normalizedCommand = command.trim();
  const required = COMMAND_PERMISSION_MAP[normalizedCommand];

  // If command requires no special permission or is unrecognized, check general policy
  if (!required) {
    return {
      allowed: true,
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
