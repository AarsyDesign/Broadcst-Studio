import React, { useState, useEffect, useRef } from 'react';
import {
  aiAssistantService,
  type AiChatMessage,
} from '../services/ai/aiAssistantService';
import { mcpServer } from '../services/mcp/mcpServer';
import type { McpToolDefinition } from '../services/mcp/types';
import { controlApi, type AuditLogEntry } from '../services/controlApi';
import { shoutcastService } from '../services/shoutcastService';
import { audioEngine } from '../services/audioEngine';
import { transcriptionService } from '../services/transcription/transcriptionService';
import { logger } from '../services/logger';

export const AIWorkspace: React.FC = () => {
  const [activeView, setActiveView] = useState<'operator' | 'diagnostics'>('operator');
  const [conversation, setConversation] = useState<AiChatMessage[]>(aiAssistantService.getConversation());
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Live broadcast & audio telemetry state
  const [broadcastStatus, setBroadcastStatus] = useState(shoutcastService.getStatus());
  const [masterPeak, setMasterPeak] = useState(-90);

  // Diagnostics & Developer state
  const [mcpTools] = useState<McpToolDefinition[]>(mcpServer.getTools());
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>(controlApi.getAuditHistory());
  const [apiKey, setApiKey] = useState(aiAssistantService.getApiKey());
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubConv = aiAssistantService.onConversationUpdate((history) => {
      setConversation(history);
    });

    const unsubAudit = controlApi.onAudit(() => {
      setAuditLog(controlApi.getAuditHistory());
    });

    const unsubStatus = shoutcastService.onStatusChange(setBroadcastStatus);

    const unsubAudio = audioEngine.onMeterUpdate((channelId, peakDb) => {
      if (channelId === 'master') {
        setMasterPeak(peakDb);
      }
    });

    return () => {
      unsubConv();
      unsubAudit();
      unsubStatus();
      unsubAudio();
    };
  }, []);

  useEffect(() => {
    if (activeView === 'operator') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversation, activeView]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleSendMessage = async (queryText?: string) => {
    const q = (queryText || inputText).trim();
    if (!q || isProcessing) return;

    setInputText('');
    setIsProcessing(true);

    try {
      await aiAssistantService.processOperatorQuery(q);
    } catch (err: any) {
      logger.error('AIWorkspace', 'Failed to process query', { error: err });
      showToast(`Error: ${err?.message || 'Processing failed'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleQuickAction = (prompt: string) => {
    handleSendMessage(prompt);
  };

  const handleDirectReconnect = async () => {
    try {
      await shoutcastService.reconnect();
      showToast('Reconnection command dispatched to SHOUTcast');
    } catch (err: any) {
      showToast(`Reconnect failed: ${err?.message}`);
    }
  };

  const handleDirectGainAdjust = () => {
    audioEngine.setMasterFader(0.75);
    showToast('Normalized master fader to nominal 0.75 level');
  };

  const isLive = broadcastStatus.state === 'CONNECTED';
  const hasClipping = masterPeak >= -0.5;
  const isNearClipping = masterPeak >= -2.0 && masterPeak < -0.5;

  return (
    <section className="ws-workspace" style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', gap: '12px', height: '100%' }}>
      {/* Command & Control Bar */}
      <div className="ws-command-row">
        <div>
          <div className="ws-kicker">System / Operator Intelligence</div>
          <h1 className="ws-title">Broadcast Assistant</h1>
          <p className="ws-subtitle">
            Telemetry copilot and operator assistant connected strictly through the Broadcast Control API.
          </p>
        </div>

        <div className="ws-transport">
          <div className="ws-tabs">
            <button
              type="button"
              className="ws-tab-btn"
              data-active={activeView === 'operator'}
              onClick={() => setActiveView('operator')}
            >
              Operator Console
            </button>
            <button
              type="button"
              className="ws-tab-btn"
              data-active={activeView === 'diagnostics'}
              onClick={() => setActiveView('diagnostics')}
            >
              Developer Diagnostics ({mcpTools.length} MCP Tools)
            </button>
          </div>

          <button
            type="button"
            className="ws-secondary-action"
            onClick={() => setShowKeyModal(true)}
          >
            {apiKey ? 'API Key Configured' : 'Configure Provider'}
          </button>
        </div>
      </div>

      {activeView === 'operator' ? (
        /* Operator Experience Mode (Task 6) */
        <div style={{ display: 'grid', gridTemplateRows: 'auto auto minmax(0, 1fr)', gap: '12px', minHeight: 0 }}>
          {/* Engineering Status Diagnosis Cards */}
          <div className="ws-ai-console-header">
            {/* Stream Status */}
            <div className="ws-ai-status-block">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span className="ws-kicker">Stream Status</span>
                <span className="ws-badge" data-variant={isLive ? 'live' : 'warning'}>
                  {broadcastStatus.state}
                </span>
              </div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ws-text)' }}>
                {isLive ? 'On-Air Stream Connected' : 'Broadcaster Currently Offline'}
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--ws-muted)', marginTop: '3px' }}>
                {broadcastStatus.config.server}:{broadcastStatus.config.port} • {broadcastStatus.config.bitrate} kbps {broadcastStatus.config.codec}
              </div>
            </div>

            {/* Audio Headroom & Clipping Detector */}
            <div className="ws-ai-status-block">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span className="ws-kicker">Headroom & Limiter</span>
                <span
                  className="ws-badge"
                  data-variant={hasClipping ? 'danger' : isNearClipping ? 'warning' : 'live'}
                >
                  {hasClipping ? 'CLIPPING' : isNearClipping ? 'HOT SIGNAL' : 'OPTIMAL'}
                </span>
              </div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ws-text)' }}>
                {hasClipping
                  ? 'Limiter Overload Warning'
                  : `Master Peak: ${masterPeak.toFixed(1)} dBFS`}
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--ws-muted)', marginTop: '3px' }}>
                {hasClipping
                  ? 'Signal is exceeding 0 dBFS ceiling. Attenuate master or mic gain.'
                  : `Headroom: ${Math.max(0, 0 - masterPeak).toFixed(1)} dB. No inter-sample clipping.`}
              </div>
            </div>

            {/* Transcription State */}
            <div className="ws-ai-status-block">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span className="ws-kicker">Speech Engine</span>
                <span className="ws-tag">LOCAL MODEL</span>
              </div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ws-text)' }}>
                {transcriptionService.getStatus().state === 'LISTENING'
                  ? 'Live Speech Transcribing'
                  : 'Transcription Engine Idle'}
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--ws-muted)', marginTop: '3px' }}>
                {transcriptionService.getStatus().segmentsCount} segment(s) indexed for editorial chaptering.
              </div>
            </div>
          </div>

          {/* Quick Operator Actions Toolbar */}
          <div
            style={{
              padding: '10px 14px',
              border: '1px solid var(--ws-line)',
              borderRadius: '7px',
              background: 'var(--ws-panel)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            <span className="ws-kicker" style={{ marginRight: '4px' }}>
              Operator Actions:
            </span>
            <button
              type="button"
              className="ws-ai-action-btn"
              onClick={() => handleQuickAction('Explain current stream state and audio signal health')}
            >
              ⚡ Explain Stream State
            </button>
            <button
              type="button"
              className="ws-ai-action-btn"
              onClick={() => handleQuickAction('Analyze audio levels and check for headroom clipping')}
            >
              ⚡ Check Audio Headroom
            </button>
            <button
              type="button"
              className="ws-ai-action-btn"
              onClick={handleDirectGainAdjust}
            >
              ⚡ Reset Master Fader
            </button>
            <button
              type="button"
              className="ws-ai-action-btn"
              onClick={handleDirectReconnect}
            >
              ⚡ Reconnect Stream
            </button>
            <button
              type="button"
              className="ws-ai-action-btn"
              onClick={() => handleQuickAction('Summarize the recent live speech transcript')}
            >
              ⚡ Summarize Live Speech
            </button>
          </div>

          {/* Chat Stream Surface */}
          <div className="ws-chat-container">
            <div className="ws-chat-stream">
              {conversation.map((msg) => (
                <div key={msg.id} className="ws-chat-bubble" data-sender={msg.role === 'operator' ? 'user' : 'assistant'}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5px', color: 'var(--ws-subtle)', marginBottom: '4px', fontFamily: 'var(--font-mono)' }}>
                    <span>{msg.role === 'operator' ? 'OPERATOR' : 'BROADCAST ASSISTANT'}</span>
                    <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>

                  {msg.actionTaken && (
                    <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid var(--ws-line)', fontSize: '10px', color: 'var(--ws-live)', fontFamily: 'var(--font-mono)' }}>
                      ✓ Executed Control API: {msg.actionTaken.command}
                    </div>
                  )}
                </div>
              ))}
              {isProcessing && (
                <div className="ws-chat-bubble" data-sender="assistant">
                  <span style={{ color: 'var(--ws-muted)', fontStyle: 'italic' }}>
                    Consulting broadcast telemetry and evaluating Control API...
                  </span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              style={{
                display: 'flex',
                gap: '8px',
                padding: '10px 14px',
                borderTop: '1px solid var(--ws-line)',
                background: 'var(--ws-panel-2)',
              }}
            >
              <input
                type="text"
                className="ws-input"
                style={{ flex: 1 }}
                placeholder="Ask assistant to adjust volume, diagnose stream, inspect listener telemetry..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={isProcessing}
              />
              <button
                type="submit"
                className="ws-primary-action"
                style={{ height: '30px' }}
                disabled={isProcessing || !inputText.trim()}
              >
                Send
              </button>
            </form>
          </div>
        </div>
      ) : (
        /* Developer Diagnostics Mode */
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '14px', minHeight: 0, overflow: 'auto' }}>
          {/* MCP Protocol Tools */}
          <div
            style={{
              border: '1px solid var(--ws-line)',
              borderRadius: '7px',
              background: 'var(--ws-panel)',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div className="ws-section-head">
              <h2>MCP Tool Definitions ({mcpTools.length})</h2>
              <span>JSON-RPC 2.0 Stdio Bridge</span>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {mcpTools.map((tool) => (
                <div
                  key={tool.name}
                  style={{
                    padding: '10px 12px',
                    border: '1px solid var(--ws-line)',
                    borderRadius: '6px',
                    background: 'var(--ws-panel-2)',
                    marginBottom: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <code style={{ color: 'var(--ws-live)', fontWeight: 700, fontSize: '11px' }}>
                      {tool.name}
                    </code>
                    <span className="ws-tag">RPC TOOL</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--ws-muted)', marginTop: '4px' }}>
                    {tool.description}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Control API Audit Logs */}
          <div
            style={{
              border: '1px solid var(--ws-line)',
              borderRadius: '7px',
              background: 'var(--ws-panel)',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div className="ws-section-head">
              <h2>Control API Audit History ({auditLog.length})</h2>
              <span>Security Policy Enforced</span>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {auditLog.length === 0 ? (
                <div className="ws-empty" style={{ minHeight: '100px' }}>
                  <div>No audited commands dispatched yet.</div>
                </div>
              ) : (
                auditLog.map((log) => (
                  <div
                    key={log.auditId}
                    style={{
                      padding: '8px 10px',
                      border: '1px solid var(--ws-line)',
                      borderRadius: '5px',
                      background: 'var(--ws-panel-2)',
                      marginBottom: '6px',
                      fontSize: '11px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--ws-subtle)' }}>
                      <span>CALLER: {log.caller}</span>
                      <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div style={{ fontWeight: 650, color: 'var(--ws-text)', marginTop: '2px' }}>
                      {log.command}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Configure Provider Modal */}
      {showKeyModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: 'min(440px, 92vw)',
              background: 'var(--ws-panel)',
              border: '1px solid var(--ws-line)',
              borderRadius: '8px',
              padding: '18px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 760 }}>AI Assistant Provider Key</h3>
              <button
                type="button"
                className="ws-mini-action"
                onClick={() => setShowKeyModal(false)}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '11px', color: 'var(--ws-muted)', margin: '0 0 10px 0' }}>
              Local heuristic mode is enabled by default. Provide an API key for external LLM reasoning.
            </p>

            <input
              type="password"
              className="ws-input"
              style={{ width: '100%', marginBottom: '14px' }}
              placeholder="sk-... or Gemini API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="ws-secondary-action"
                onClick={() => setShowKeyModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ws-primary-action"
                onClick={() => {
                  aiAssistantService.setApiKey(apiKey);
                  setShowKeyModal(false);
                  showToast('AI Provider configuration saved');
                }}
              >
                Save Configuration
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMessage && <div className="ws-toast">{toastMessage}</div>}
    </section>
  );
};
