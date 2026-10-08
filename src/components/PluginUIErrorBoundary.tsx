import { Component, ErrorInfo, ReactNode } from 'react';
import { pluginRegistry } from '../services/plugin/pluginRegistry';

interface Props {
  pluginId: string;
  title: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Isolated React Error Boundary for plugin-contributed UI extensions.
 * Guarantees that a crash in a plugin's panel never breaks the workstation.
 */
export class PluginUIErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[PluginUIErrorBoundary] Caught error in plugin UI "${this.props.pluginId}" (${this.props.title}):`, error, errorInfo);
  }

  private handleReload = async () => {
    this.setState({ hasError: false, error: undefined });
    await pluginRegistry.reloadPlugin(this.props.pluginId);
  };

  private handleDisable = async () => {
    await pluginRegistry.disablePlugin(this.props.pluginId);
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: '12px 14px',
            background: 'var(--ws-panel)',
            border: '1px solid var(--ws-danger)',
            borderRadius: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            fontFamily: 'var(--font-sans)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="ws-badge" data-variant="danger" style={{ fontSize: '10px' }}>
                PLUGIN UI ERROR
              </span>
              <strong style={{ fontSize: '12px', color: 'var(--ws-text)' }}>
                {this.props.title}
              </strong>
            </div>
            <span style={{ fontSize: '10px', color: 'var(--ws-muted)', fontFamily: 'var(--font-mono)' }}>
              {this.props.pluginId}
            </span>
          </div>

          <p style={{ margin: 0, fontSize: '11px', color: 'var(--ws-danger)', fontFamily: 'var(--font-mono)' }}>
            {this.state.error?.message || 'Unknown runtime error occurred in plugin UI extension.'}
          </p>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
            <button
              type="button"
              className="ws-mini-action"
              onClick={this.handleReload}
              title="Reload this plugin"
            >
              Reload Plugin
            </button>
            <button
              type="button"
              className="ws-mini-action"
              style={{ borderColor: 'var(--ws-danger)', color: 'var(--ws-danger)' }}
              onClick={this.handleDisable}
              title="Disable this plugin"
            >
              Disable Plugin
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
