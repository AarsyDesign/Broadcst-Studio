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

interface NavGroup {
  label: string;
  items: { id: WorkspaceTab; label: string }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Control',
    items: [
      { id: 'on_air', label: 'On Air' },
      { id: 'sources', label: 'Sources' },
      { id: 'mixer', label: 'Mixer' },
      { id: 'playlist', label: 'Playlist' },
    ],
  },
  {
    label: 'Production',
    items: [
      { id: 'schedule', label: 'Schedule' },
      { id: 'transcript', label: 'Transcript' },
      { id: 'recordings', label: 'Recordings' },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'plugins', label: 'Plugins' },
      { id: 'automation', label: 'Automation' },
      { id: 'ai', label: 'AI' },
      { id: 'settings', label: 'Settings' },
    ],
  },
];

export const NavigationRail: React.FC<NavigationRailProps> = ({ activeTab, onSelectTab }) => {
  return (
    <nav className="ws-nav" aria-label="Broadcst workspace navigation">
      {NAV_GROUPS.map((group) => (
        <div className="ws-nav-group" key={group.label}>
          <div className="ws-nav-label">{group.label}</div>
          {group.items.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                className="ws-nav-button"
                data-active={active}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => onSelectTab(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
};
