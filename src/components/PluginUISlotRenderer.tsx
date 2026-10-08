import React, { useState, useEffect } from 'react';
import {
  UIExtensionContext,
  UIExtensionDescriptor,
  UIExtensionSlot,
} from '../services/plugin/types';
import { uiExtensionManager } from '../services/plugin/uiExtensionManager';
import { pluginHost } from '../services/plugin/pluginHost';
import { PluginUIErrorBoundary } from './PluginUIErrorBoundary';

interface PluginUISlotRendererProps {
  slot: UIExtensionSlot;
  theme?: 'dark' | 'light';
  onNotify?: (message: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Host container for rendering plugin-contributed UI extensions in approved workstation slots.
 * Isolates each plugin extension with an ErrorBoundary and provides controlled context.
 */
export const PluginUISlotRenderer: React.FC<PluginUISlotRendererProps> = ({
  slot,
  theme = 'dark',
  onNotify,
  className,
  style,
}) => {
  const [extensions, setExtensions] = useState<UIExtensionDescriptor[]>(() =>
    uiExtensionManager.getExtensionsForSlot(slot)
  );

  useEffect(() => {
    const unsub = uiExtensionManager.subscribe(() => {
      setExtensions(uiExtensionManager.getExtensionsForSlot(slot));
    });
    return unsub;
  }, [slot]);

  if (extensions.length === 0) {
    return null;
  }

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        ...style,
      }}
    >
      {extensions.map((desc) => {
        const inst = pluginHost.getPlugin(desc.pluginId);
        // Only render if plugin is currently enabled
        if (!inst || !inst.enabled || inst.state !== 'ENABLED') {
          return null;
        }

        const pluginContext = pluginHost.createPluginContext(inst.manifest);

        const uiContext: UIExtensionContext = {
          pluginId: desc.pluginId,
          theme,
          commands: pluginContext.commands,
          state: pluginContext.state,
          notifyAction: (msg: string) => {
            if (onNotify) {
              onNotify(msg);
            }
          },
        };

        return (
          <PluginUIErrorBoundary
            key={`${desc.pluginId}-${desc.id}`}
            pluginId={desc.pluginId}
            title={desc.title}
          >
            {React.isValidElement(desc.render(uiContext)) ? (
              (desc.render(uiContext) as React.ReactElement)
            ) : (
              <div>{String(desc.render(uiContext))}</div>
            )}
          </PluginUIErrorBoundary>
        );
      })}
    </div>
  );
};
