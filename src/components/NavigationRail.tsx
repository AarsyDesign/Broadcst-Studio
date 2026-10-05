import React from 'react';

export type WorkspaceTab =
  | 'on_air'
  | 'sources'
  | 'mixer'
  | 'playlist'
  | 'schedule'
  | 'transcript'
  | 'recordings'
  | 'plugins'
  | 'automation'
  | 'ai'
  | 'settings';

interface NavigationRailProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
}

interface NavItem {
  id: WorkspaceTab;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'on_air', label: 'ON AIR' },
  { id: 'sources', label: 'SOURCES' },
  { id: 'mixer', label: 'MIXER' },
  { id: 'playlist', label: 'PLAYLIST' },
  { id: 'schedule', label: 'SCHEDULE' },
  { id: 'transcript', label: 'TRANSCRIPT' },
  { id: 'recordings', label: 'RECORDINGS' },
  { id: 'plugins', label: 'PLUGINS' },
  { id: 'automation', label: 'AUTOMATION' },
  { id: 'ai', label: 'AI ASSISTANT' },
  { id: 'settings', label: 'SETTINGS' },
];

export const NavigationRail: React.FC<NavigationRailProps> = ({ activeTab, onSelectTab }) => {
  return (
    <nav
      aria-label="Main Navigation"
      style={{
        width: '180px',
        backgroundColor: 'var(--color-surface)',
        borderRight: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--space-3) var(--space-2)',
        gap: 'var(--space-1)',
        flexShrink: 0,
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          padding: 'var(--space-2) var(--space-3)',
          fontSize: 'var(--text-micro)',
          fontWeight: 700,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        Console Navigation
      </div>

      {NAV_ITEMS.map((item) => {
        const isActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onSelectTab(item.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-small)',
              fontWeight: isActive ? 600 : 500,
              color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              backgroundColor: isActive ? 'var(--color-surface-elevated)' : 'transparent',
              borderLeft: isActive ? '3px solid var(--color-live)' : '3px solid transparent',
              textAlign: 'left',
              width: '100%',
              transition: 'all var(--motion-fast)',
            }}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
};
