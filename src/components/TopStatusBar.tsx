import React from 'react';
import { BroadcastStatus } from '../types/broadcast';

interface TopStatusBarProps {
  status: BroadcastStatus;
  isNative: boolean;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

const formatUptime = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const statusLabel: Record<BroadcastStatus['state'], string> = {
  OFFLINE: 'OFFLINE',
  CONNECTING: 'CONNECTING',
  AUTHENTICATING: 'AUTHENTICATING',
  CONNECTED: 'ON AIR',
  RECONNECTING: 'RECONNECTING',
  ERROR: 'ERROR',
};

export const TopStatusBar: React.FC<TopStatusBarProps> = ({
  status,
  isNative,
  theme,
  onToggleTheme,
}) => {
  return (
    <header className="ws-topbar">
      <div className="ws-brand">
        <span className="ws-brand-name">Broadcst Studio</span>
        <span className="ws-brand-meta">{status.config.stationName}</span>
      </div>

      <div className="ws-live-state" data-state={status.state} aria-live="polite">
        <span className="ws-live-dot" aria-hidden="true" />
        <span>{statusLabel[status.state]}</span>
      </div>

      <div className="ws-top-metrics">
        <span className="ws-top-metric">
          Bitrate <strong className="font-mono">{status.config.bitrate} kbps</strong>
        </span>
        <span className="ws-top-metric">
          Codec <strong>{status.config.codec}</strong>
        </span>
        <span className="ws-top-metric">
          Uptime <strong className="font-mono">{formatUptime(status.uptimeSeconds)}</strong>
        </span>
        {status.reconnectCount > 0 && (
          <span className="ws-top-metric">
            Reconnects <strong className="font-mono">{status.reconnectCount}</strong>
          </span>
        )}
        <span
          className="ws-top-metric"
          title={isNative ? 'Tauri IPC is active.' : 'Browser development transport is active.'}
        >
          Runtime <strong>{isNative ? 'Native' : 'Web Dev'}</strong>
        </span>
        <button
          type="button"
          className="ws-top-action"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>
    </header>
  );
};
