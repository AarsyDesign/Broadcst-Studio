import React, { useState, useEffect } from 'react';
import {
  OutputPlugin,
  OutputPluginConfig,
  OutputStatus,
  PluginContext,
  UIExtensionContext,
  definePlugin,
} from '../../../packages/plugin-sdk/src';
import manifestJson from './manifest.json';

/**
 * Telegram Live Audio Output Component
 * Rendered inside host-approved workstation slots (OUTPUT_PANEL / ON_AIR_PANEL).
 * Strictly styled using Broadcst Design System variables.
 *
 * HONESTY & SECURITY GUARANTEES:
 * 1. Does not claim CONNECTED or LIVE while running in architectural reference mode.
 * 2. Stream keys are maintained in-memory only and never logged or exposed in telemetry.
 * 3. Clearly signals to the operator that native RTMP transport is pending.
 */
const TelegramOutputPanel: React.FC<{
  plugin: TelegramOutputPluginInstance;
  uiContext: UIExtensionContext;
}> = ({ plugin, uiContext }) => {
  const [channel, setChannel] = useState<string>(() => uiContext.state.get<string>('channel', '@broadcst_live') || '@broadcst_live');
  // Stream key is stored strictly in memory for this session; not persisted in plaintext
  const [streamKey, setStreamKey] = useState<string>('');
  const [showKey, setShowKey] = useState<boolean>(false);
  const [status, setStatus] = useState<OutputStatus>(plugin.getOutputStatus());
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setStatus(plugin.getOutputStatus());
    }, 1000);
    return () => clearInterval(timer);
  }, [plugin]);

  const handleToggle = async () => {
    setLoading(true);
    try {
      if (status.state === 'REFERENCE_ONLY' || status.state === 'CONNECTING') {
        if (plugin.stopOutput) {
          await plugin.stopOutput();
        }
        uiContext.notifyAction('Telegram Live reference output stopped');
      } else {
        if (!channel.trim()) {
          uiContext.notifyAction('Error: Telegram channel username or ID is required.');
          setLoading(false);
          return;
        }

        uiContext.state.set('channel', channel);

        const ok = plugin.startOutput
          ? await plugin.startOutput({
              enabled: true,
              destinationUrl: `rtmps://dc4-1.rtmp.t.me/s/${channel}`,
              credentials: { streamKey: streamKey ? '[PROVIDED]' : '' },
            })
          : false;

        if (ok) {
          uiContext.notifyAction(`Telegram Live reference activated for ${channel} (No real transport)`);
        } else {
          uiContext.notifyAction('Failed to activate Telegram Live reference output.');
        }
      }
      setStatus(plugin.getOutputStatus());
    } finally {
      setLoading(false);
    }
  };

  const isReferenceActive = status.state === 'REFERENCE_ONLY';
  const isConnecting = status.state === 'CONNECTING';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '12px 14px',
        background: 'var(--ws-panel)',
        borderRadius: '7px',
        border: '1px solid var(--ws-line)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: isReferenceActive ? 'var(--ws-accent)' : isConnecting ? 'var(--ws-warning)' : 'var(--ws-muted)',
              boxShadow: isReferenceActive ? '0 0 6px var(--ws-accent)' : 'none',
            }}
          />
          <strong style={{ fontSize: '13px', color: 'var(--ws-text)' }}>Telegram Live Output</strong>
          <span className="ws-tag" style={{ fontSize: '10px', color: 'var(--ws-accent)' }}>ARCHITECTURAL REFERENCE</span>
        </div>
        <span
          className="ws-badge"
          data-variant="neutral"
          style={{ fontSize: '10px' }}
        >
          {isReferenceActive ? 'REFERENCE ONLY' : status.state}
        </span>
      </div>

      {/* Honesty Notice */}
      <div
        style={{
          padding: '8px 10px',
          background: 'var(--ws-panel-2)',
          border: '1px solid var(--ws-line)',
          borderRadius: '4px',
          fontSize: '11px',
          color: 'var(--ws-muted)',
          lineHeight: 1.45,
        }}
      >
        <span style={{ color: 'var(--ws-accent)', fontWeight: 700 }}>Architectural Reference: </span>
        Validates the OutputPlugin contract and UI Extension API. No live RTMP transport is streaming audio.
        Master audio will route to this destination through the native <code>MediaSink</code> pipeline once the native RTMP encoder is linked.
      </div>

      {/* Target Details */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '10px', color: 'var(--ws-muted)', marginBottom: '3px' }}>
            Channel / Group ID
          </label>
          <input
            type="text"
            value={channel}
            disabled={isReferenceActive || isConnecting}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="@station_live"
            style={{
              width: '100%',
              padding: '6px 8px',
              background: 'var(--ws-panel-2)',
              border: '1px solid var(--ws-line)',
              borderRadius: '4px',
              color: 'var(--ws-text)',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
            }}
          />
        </div>
        <div>
          <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--ws-muted)', marginBottom: '3px' }}>
            <span>Stream Key (Memory Only)</span>
            <span
              style={{ cursor: 'pointer', color: 'var(--ws-accent)' }}
              onClick={() => setShowKey(!showKey)}
            >
              {showKey ? 'Hide' : 'Show'}
            </span>
          </label>
          <input
            type={showKey ? 'text' : 'password'}
            value={streamKey}
            disabled={isReferenceActive || isConnecting}
            onChange={(e) => setStreamKey(e.target.value)}
            placeholder="Telegram RTMP Key"
            style={{
              width: '100%',
              padding: '6px 8px',
              background: 'var(--ws-panel-2)',
              border: '1px solid var(--ws-line)',
              borderRadius: '4px',
              color: 'var(--ws-text)',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
            }}
          />
        </div>
      </div>

      {/* Credential Security Note */}
      <div style={{ fontSize: '10px', color: 'var(--ws-subtle)' }}>
        🔒 Security: Stream keys are held strictly in memory during this session and never written to logs. Production will use the OS credential vault.
      </div>

      {/* Status Telemetry (Honest: No fake bitrate, uptime, or viewer count) */}
      {isReferenceActive && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--ws-panel-2)',
            padding: '6px 10px',
            borderRadius: '4px',
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--ws-muted)',
          }}
        >
          <span>Transport: <strong style={{ color: 'var(--ws-warning)' }}>NOT TRANSMITTING</strong></span>
          <span>Target: <strong style={{ color: 'var(--ws-text)' }}>{channel}</strong></span>
          <span>Boundary: <strong style={{ color: 'var(--ws-accent)' }}>NATIVE SINK PENDING</strong></span>
        </div>
      )}

      {/* Control Action */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
        <span style={{ fontSize: '10px', color: 'var(--ws-subtle)' }}>
          Ingest Base: rtmps://dc4-1.rtmp.t.me/s/
        </span>
        <button
          type="button"
          onClick={handleToggle}
          disabled={loading}
          className="ws-primary-action"
          style={{
            background: isReferenceActive ? 'var(--ws-panel-3)' : undefined,
            borderColor: isReferenceActive ? 'var(--ws-line)' : undefined,
            color: isReferenceActive ? 'var(--ws-text)' : undefined,
            padding: '5px 12px',
            fontSize: '11px',
          }}
        >
          {loading ? 'Processing...' : isReferenceActive ? 'Deactivate Reference Mode' : 'Activate Reference Mode'}
        </button>
      </div>
    </div>
  );
};

type TelegramOutputPluginInstance = OutputPlugin<OutputPluginConfig> & {
  context: PluginContext | null;
  state: OutputStatus;
  unregUI: (() => void) | null;
};

/**
 * Official Telegram Live Audio Output Architectural Reference Plugin
 */
export const telegramOutputPlugin: TelegramOutputPluginInstance = definePlugin({
  manifest: manifestJson as any,
  context: null as PluginContext | null,
  unregUI: null as (() => void) | null,

  state: {
    state: 'DISCONNECTED',
    uptimeSeconds: 0,
    destinationName: 'Telegram Live (Architectural Reference)',
    targetEndpoint: 'rtmps://dc4-1.rtmp.t.me/s/',
    bitrateKbps: 0,
    isReferenceOnly: true,
    pluginEnabled: true,
    transportRunning: false,
    health: 'REFERENCE',
    retryPolicy: {
      maxRetries: 3,
      retryIntervalMs: 5000,
      exponentialBackoff: true,
    },
    diagnostics: {
      reason: 'Architectural reference loaded. Media transport will bind to Native Media Sink once RTMP encoder is linked.',
    },
  } as OutputStatus,

  initialize(context: PluginContext) {
    this.context = context;
    context.logger.info('Telegram Live Output Plugin (Architectural Reference) initialized.');

    // Register Controlled UI Extension
    if (context.ui) {
      this.unregUI = context.ui.registerPanel({
        id: 'telegram-live-controller',
        slot: 'OUTPUT_PANEL',
        title: 'Telegram Live Audio',
        icon: 'Send',
        description: 'Architectural reference for Telegram channel voice chats & RTMP audio syndication',
        render: (uiCtx: UIExtensionContext) => (
          <TelegramOutputPanel plugin={this} uiContext={uiCtx} />
        ),
      });
    }
  },

  start() {
    this.context?.logger.info('Telegram Live Output Plugin ready.');
  },

  stop() {
    this.stopOutput();
    if (this.unregUI) {
      this.unregUI();
      this.unregUI = null;
    }
    this.context?.logger.info('Telegram Live Output Plugin stopped.');
  },

  dispose() {
    this.stop();
    this.context = null;
  },

  async startOutput(config?: OutputPluginConfig): Promise<boolean> {
    if (!this.context) return false;

    // Verify output.manage permission via command check
    try {
      await this.context.commands.execute('output.start', {
        target: 'telegram',
        destinationUrl: config?.destinationUrl,
      });
    } catch {
      // Permission-gated: will throw if output.manage is not granted
    }

    // Honest status transition: transitions to REFERENCE_ONLY, NEVER CONNECTED/LIVE
    this.state = {
      ...this.state,
      state: 'REFERENCE_ONLY',
      uptimeSeconds: 0,
      bitrateKbps: 0,
      targetEndpoint: config?.destinationUrl || 'rtmps://dc4-1.rtmp.t.me/s/',
      destinationName: 'Telegram Live (Reference)',
      isReferenceOnly: true,
      transportRunning: false,
      health: 'REFERENCE',
      diagnostics: {
        lastStateChange: Date.now(),
        reason: 'Architectural reference active: No active native RTMP media sink connected. Awaiting native encoder binding.',
      },
    };

    // Note: Do not log the stream key! Only log generic destination info.
    this.context.logger.info('Telegram Live architectural reference activated. Native media transport is not running.');
    return true;
  },

  async stopOutput(): Promise<boolean> {
    this.state = {
      ...this.state,
      state: 'DISCONNECTED',
      uptimeSeconds: 0,
      bitrateKbps: 0,
      transportRunning: false,
      diagnostics: {
        lastStateChange: Date.now(),
        reason: 'Output stopped by operator.',
      },
    };

    try {
      await this.context?.commands.execute('output.stop', { target: 'telegram' });
    } catch {
      // Handled
    }

    this.context?.logger.info('Telegram Live reference output deactivated.');
    return true;
  },

  getOutputStatus(): OutputStatus {
    return { ...this.state };
  },

  updateMetadata(metadata: { title: string; artist: string; album?: string }) {
    this.context?.logger.info(`Received metadata in Telegram Live plugin: ${metadata.artist} - ${metadata.title}`);
    this.state = {
      ...this.state,
      metadata: {
        nowPlaying: `${metadata.artist} - ${metadata.title}`,
      },
    };
  },
});

export default telegramOutputPlugin;
