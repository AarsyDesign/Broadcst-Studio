import React from 'react';
import { BroadcastStatus } from '../types/broadcast';

interface TopStatusBarProps {
  status: BroadcastStatus;
  isNative: boolean;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export const TopStatusBar: React.FC<TopStatusBarProps> = ({
  status,
  isNative,
  theme,
  onToggleTheme,
}) => {
  const formatUptime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusColor = () => {
    switch (status.state) {
      case 'CONNECTED':
        return 'var(--color-live)';
      case 'RECONNECTING':
      case 'CONNECTING':
      case 'AUTHENTICATING':
        return 'var(--color-warning)';
      case 'ERROR':
        return 'var(--color-error)';
      default:
        return 'var(--color-text-muted)';
    }
  };

  const getStatusLabel = () => {
    switch (status.state) {
      case 'CONNECTED':
        return 'ON AIR';
      case 'CONNECTING':
        return 'CONNECTING';
      case 'AUTHENTICATING':
        return 'AUTHENTICATING';
      case 'RECONNECTING':
        return 'RECONNECTING';
      case 'ERROR':
        return 'ERROR';
      default:
        return 'OFFLINE';
    }
  };

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 var(--space-4)',
        height: '44px',
        backgroundColor: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        fontSize: 'var(--text-small)',
      }}
    >
      {/* Left: Status and Station */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: '2px 8px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border)',
            fontWeight: 700,
            letterSpacing: '0.05em',
            color: getStatusColor(),
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: getStatusColor(),
              boxShadow: status.state === 'CONNECTED' ? '0 0 8px var(--color-live)' : 'none',
              transition: 'background-color var(--motion-state)',
            }}
          />
          <span>{getStatusLabel()}</span>
        </div>

        <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
          {status.config.stationName}
        </span>
      </div>

      {/* Right: Metrics & System Info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-text-secondary)' }}>
          <span>Bitrate:</span>
          <span className="font-mono" style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
            {status.config.bitrate} kbps {status.config.codec}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-text-secondary)' }}>
          <span>Uptime:</span>
          <span className="font-mono" style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
            {formatUptime(status.uptimeSeconds)}
          </span>
        </div>

        {status.reconnectCount > 0 && (
          <div style={{ color: 'var(--color-warning)', fontSize: 'var(--text-micro)' }}>
            Reconnects: {status.reconnectCount}
          </div>
        )}

        <div
          title={isNative ? 'Connected to Rust Tauri Core via IPC' : 'Running with in-memory IPC mock for browser development'}
          style={{
            fontSize: 'var(--text-micro)',
            padding: '2px 6px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--color-surface-elevated)',
            color: isNative ? 'var(--color-live)' : 'var(--color-info)',
            border: '1px solid var(--color-border)',
            fontWeight: 600,
          }}
        >
          {isNative ? 'Native IPC' : 'Dev Mock IPC'}
        </div>

        {/* Theme Toggle Button */}
        <button
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          title={`Active theme: ${theme.toUpperCase()}. Click to switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            padding: '3px 8px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
            fontSize: 'var(--text-micro)',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background-color var(--motion-state), color var(--motion-state)',
          }}
        >
          <span style={{ color: 'var(--color-text-muted)' }}>THEME:</span>
          <span style={{ color: 'var(--color-live)', fontWeight: 700 }}>
            {theme === 'dark' ? 'DARK' : 'LIGHT'}
          </span>
        </button>
      </div>
    </header>
  );
};
