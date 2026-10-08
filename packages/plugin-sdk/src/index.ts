/**
 * Broadcst Studio Plugin SDK
 *
 * Official TypeScript SDK for developing external extensions and plugins for Broadcst Studio.
 *
 * Architecture:
 * - CORE stays stable.
 * - PLUGINS extend the platform via versioned contracts.
 */

export * from './constants';
export * from './types';
export * from './manifest';
export * from './validation';
export * from './permissions';
export * from './events';
export * from './context';
export * from './contracts';
export * from './packageLoader';
