import React, { useState, useEffect, useRef } from 'react';
import {
  aiAssistantService,
  type AiChatMessage,
  type TelemetryDiagnosis,
  type SuggestedMetadata,
} from '../services/ai/aiAssistantService';
import { mcpServer } from '../services/mcp/mcpServer';
import type { McpCallLog, McpToolDefinition } from '../services/mcp/types';
import { controlApi, type AuditLogEntry } from '../services/controlApi';
import { logger } from '../services/logger';

type ActiveAiTab = 'console' | 'telemetry' | 'mcp' | 'audit';

export const AIWorkspace: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveAiTab>('console');
  const [conversation, setConversation] = useState<AiChatMessage[]>(aiAssistantService.getConversation());
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Telemetry state
  const [diagnosis, setDiagnosis] = useState<TelemetryDiagnosis | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);

  // MCP state
  const [mcpStats, setMcpStats] = useState(mcpServer.getStats());
  const [mcpTools] = useState<McpToolDefinition[]>(mcpServer.getTools());
  const [mcpLogs, setMcpLogs] = useState<McpCallLog[]>(mcpServer.getCallLogs());
  const [selectedTool, setSelectedTool] = useState<string>('broadcast_get_status');
  const [toolArgsInput, setToolArgsInput] = useState<string>('{}');
  const [testResponse, setTestResponse] = useState<string>('');
  const [isTestingTool, setIsTestingTool] = useState(false);

  // Audit state
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>(controlApi.getAuditHistory());
  const [allowAiCritical, setAllowAiCritical] = useState<boolean>(controlApi.getPolicy().allowAiCriticalCommands);
  const [allowMcpCritical, setAllowMcpCritical] = useState<boolean>(controlApi.getPolicy().allowMcpCriticalCommands);

  // API Key state
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(aiAssistantService.getApiKey());
  const [notification, setNotification] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Subscriptions
  useEffect(() => {
    const unsubConv = aiAssistantService.onConversationUpdate((history) => {
      setConversation(history);
    });

    const unsubMcp = mcpServer.onLog(() => {
      setMcpLogs(mcpServer.getCallLogs());
      setMcpStats(mcpServer.getStats());
    });

    const unsubAudit = controlApi.onAudit(() => {
      setAuditLog(controlApi.getAuditHistory());
    });

    // Initial diagnosis run
    handleRunDiagnosis();

    return () => {
      unsubConv();
      unsubMcp();
      unsubAudit();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation]);

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleSendMessage = async (textToSend?: string) => {
    const q = (textToSend || inputText).trim();
    if (!q || isProcessing) return;

    setInputText('');
    setIsProcessing(true);

    try {
      await aiAssistantService.processOperatorQuery(q);
    } catch (err: any) {
      logger.error('AIWorkspace', 'Failed to process query', { error: err });
      showToast('Error processing query: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRunDiagnosis = async () => {
    setIsDiagnosing(true);
    try {
      const result = await aiAssistantService.analyzeTelemetry();
      setDiagnosis(result);
    } catch (err) {
      logger.error('AIWorkspace', 'Diagnosis failed', { error: err });
    } finally {
      setIsDiagnosing(false);
    }
  };

  const handleApplyMetadata = async (meta: SuggestedMetadata) => {
    try {
      const res = await controlApi.execute(
        'metadata.set',
        { metadata: { title: meta.title, artist: meta.artist, album: meta.category } },
        'AI_ASSISTANT'
      );
      if (res.success) {
        showToast(`Metadata applied: "${meta.title}" by "${meta.artist}"`);
      } else {
        showToast(`Failed to apply metadata: ${res.error}`);
      }
    } catch (err: any) {
      showToast('Error: ' + err?.message);
    }
  };

  const handleCopyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`${label} copied to clipboard`);
  };

  const handleToggleMcpServer = () => {
    if (mcpServer.isRunning()) {
      mcpServer.stop();
      showToast('MCP Server stopped');
    } else {
      mcpServer.start();
      showToast('MCP Server started');
    }
    setMcpStats(mcpServer.getStats());
  };

  const handleExecuteMcpTest = async () => {
    setIsTestingTool(true);
    setTestResponse('Executing tool call...');
    try {
      let parsedArgs = {};
      if (toolArgsInput.trim()) {
        parsedArgs = JSON.parse(toolArgsInput);
      }
      const req = {
        jsonrpc: '2.0' as const,
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: selectedTool,
          arguments: parsedArgs,
        },
      };
      const res = await mcpServer.handleMessage(req);
      setTestResponse(JSON.stringify(res, null, 2));
      setMcpStats(mcpServer.getStats());
      setMcpLogs(mcpServer.getCallLogs());
    } catch (err: any) {
      setTestResponse(`Error: ${err.message}`);
    } finally {
      setIsTestingTool(false);
    }
  };

  const handleSaveApiKey = () => {
    aiAssistantService.setApiKey(apiKeyInput);
    setShowKeyModal(false);
    showToast(apiKeyInput ? 'Gemini API key saved' : 'Using Local Heuristics Engine');
  };

  const handleToggleAiCritical = () => {
    const newVal = !allowAiCritical;
    setAllowAiCritical(newVal);
    controlApi.setPolicy({ allowAiCriticalCommands: newVal });
    showToast(`AI Critical Commands: ${newVal ? 'Allowed' : 'Blocked'}`);
  };

  const handleToggleMcpCritical = () => {
    const newVal = !allowMcpCritical;
    setAllowMcpCritical(newVal);
    controlApi.setPolicy({ allowMcpCriticalCommands: newVal });
    showToast(`MCP Critical Commands: ${newVal ? 'Allowed' : 'Blocked'}`);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--color-bg)',
        overflow: 'hidden',
      }}
    >
      {/* Top Header / Mode Strip */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-3) var(--space-6)',
          backgroundColor: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: isProcessing ? 'var(--color-warning)' : 'var(--color-live)',
                boxShadow: isProcessing ? '0 0 6px var(--color-warning)' : '0 0 6px var(--color-live)',
              }}
            />
            <span style={{ fontSize: 'var(--text-small)', fontWeight: 600, letterSpacing: '0.05em' }}>
              AI OPERATOR {isProcessing ? 'PROCESSING' : 'ONLINE'}
            </span>
          </div>

          <div
            style={{
              padding: '2px var(--space-2)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border)',
              fontSize: 'var(--text-micro)',
              color: 'var(--color-text-secondary)',
            }}
          >
            Engine: {aiAssistantService.hasApiKey() ? 'Gemini 2.0 Flash + Local Rules' : 'Deterministic Local Heuristics'}
          </div>

          {diagnosis && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: '2px var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor:
                  diagnosis.overallStatus === 'OPTIMAL'
                    ? 'rgba(217, 255, 85, 0.1)'
                    : diagnosis.overallStatus === 'WARNING'
                    ? 'rgba(255, 184, 77, 0.1)'
                    : 'rgba(255, 92, 108, 0.1)',
                border: `1px solid ${
                  diagnosis.overallStatus === 'OPTIMAL'
                    ? 'var(--color-live)'
                    : diagnosis.overallStatus === 'WARNING'
                    ? 'var(--color-warning)'
                    : 'var(--color-error)'
                }`,
                fontSize: 'var(--text-micro)',
                color:
                  diagnosis.overallStatus === 'OPTIMAL'
                    ? 'var(--color-live)'
                    : diagnosis.overallStatus === 'WARNING'
                    ? 'var(--color-warning)'
                    : 'var(--color-error)',
              }}
            >
              Stream Health: {diagnosis.healthScore}/100 ({diagnosis.overallStatus})
            </div>
          )}
        </div>

        {/* Tab Controls & Settings */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <div
            style={{
              display: 'flex',
              backgroundColor: 'var(--color-bg)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px',
              border: '1px solid var(--color-border)',
            }}
          >
            {(['console', 'telemetry', 'mcp', 'audit'] as ActiveAiTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: 'var(--space-1) var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  backgroundColor: activeTab === tab ? 'var(--color-surface-elevated)' : 'transparent',
                  color: activeTab === tab ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                  fontSize: 'var(--text-small)',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  fontWeight: activeTab === tab ? 600 : 400,
                }}
              >
                {tab === 'console' && 'Console'}
                {tab === 'telemetry' && 'Health & Telemetry'}
                {tab === 'mcp' && `MCP Server (${mcpTools.length})`}
                {tab === 'audit' && `Audit Log (${auditLog.length})`}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowKeyModal(true)}
            style={{
              padding: 'var(--space-1) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-surface-elevated)',
              color: 'var(--color-text-primary)',
              fontSize: 'var(--text-small)',
              cursor: 'pointer',
            }}
          >
            API Key
          </button>
        </div>
      </header>

      {/* Notification Toast */}
      {notification && (
        <div
          style={{
            position: 'absolute',
            top: 50,
            right: 24,
            padding: 'var(--space-2) var(--space-4)',
            backgroundColor: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-live)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-primary)',
            fontSize: 'var(--text-small)',
            zIndex: 100,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
        >
          {notification}
        </div>
      )}

      {/* Main Workspace Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* SUB-TAB 1: CONSOLE */}
        {activeTab === 'console' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            {/* Operator Quick Macro Toolbar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-6)',
                backgroundColor: 'var(--color-surface)',
                borderBottom: '1px solid var(--color-border)',
                overflowX: 'auto',
              }}
            >
              <span style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                Quick Macros:
              </span>
              <button
                onClick={() => handleSendMessage('Diagnose live stream and audio health')}
                style={{
                  padding: 'var(--space-1) var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-surface-elevated)',
                  color: 'var(--color-text-primary)',
                  fontSize: 'var(--text-small)',
                  cursor: 'pointer',
                }}
              >
                Diagnose Health
              </button>
              <button
                onClick={() => handleSendMessage('Summarize show notes from live spoken transcript')}
                style={{
                  padding: 'var(--space-1) var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-surface-elevated)',
                  color: 'var(--color-text-primary)',
                  fontSize: 'var(--text-small)',
                  cursor: 'pointer',
                }}
              >
                Generate Show Notes
              </button>
              <button
                onClick={() => handleSendMessage('Generate timestamped chapters from transcript')}
                style={{
                  padding: 'var(--space-1) var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-surface-elevated)',
                  color: 'var(--color-text-primary)',
                  fontSize: 'var(--text-small)',
                  cursor: 'pointer',
                }}
              >
                Create Chapters
              </button>
              <button
                onClick={() => handleSendMessage('Suggest metadata from spoken context')}
                style={{
                  padding: 'var(--space-1) var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-surface-elevated)',
                  color: 'var(--color-text-primary)',
                  fontSize: 'var(--text-small)',
                  cursor: 'pointer',
                }}
              >
                Suggest Metadata
              </button>
              <button
                onClick={() => aiAssistantService.clearConversation()}
                style={{
                  marginLeft: 'auto',
                  padding: 'var(--space-1) var(--space-2)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-text-muted)',
                  fontSize: 'var(--text-micro)',
                  cursor: 'pointer',
                }}
              >
                Clear Feed
              </button>
            </div>

            {/* Conversation / Production Feed */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 'var(--space-6)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-4)',
              }}
            >
              {conversation.length === 0 && (
                <div
                  style={{
                    margin: 'auto',
                    textAlign: 'center',
                    maxWidth: 520,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  <div style={{ fontSize: 'var(--text-h2)', color: 'var(--color-text-primary)', marginBottom: 'var(--space-2)' }}>
                    AI Broadcast Assistant
                  </div>
                  <p style={{ fontSize: 'var(--text-small)', lineHeight: 1.6, marginBottom: 'var(--space-4)' }}>
                    The AI operator runs alongside your broadcast. It evaluates audio headroom, summarizes spoken speech from the
                    transcription pipeline, detects show topics, and triggers safe Control API commands.
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 'var(--space-2)',
                      justifyContent: 'center',
                    }}
                  >
                    {[
                      'Diagnose live stream and audio health',
                      'Summarize show notes from live spoken transcript',
                      'Suggest metadata from spoken context',
                      'Mute channel 1',
                    ].map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => handleSendMessage(prompt)}
                        style={{
                          padding: 'var(--space-2) var(--space-3)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--color-border)',
                          backgroundColor: 'var(--color-surface)',
                          color: 'var(--color-text-primary)',
                          fontSize: 'var(--text-small)',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {conversation.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignSelf: msg.role === 'operator' ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    backgroundColor: msg.role === 'operator' ? 'var(--color-surface-elevated)' : 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-4)',
                  }}
                >
                  {/* Message Meta Header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 'var(--space-2)',
                      gap: 'var(--space-4)',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 'var(--text-micro)',
                        fontWeight: 600,
                        color: msg.role === 'operator' ? 'var(--color-info)' : 'var(--color-live)',
                        textTransform: 'uppercase',
                      }}
                    >
                      {msg.role === 'operator' ? 'Broadcast Operator' : 'AI Assistant'}
                    </span>
                    <span style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)' }}>
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  {/* Message Text Content */}
                  <div
                    style={{
                      fontSize: 'var(--text-body)',
                      color: 'var(--color-text-primary)',
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {msg.content}
                  </div>

                  {/* Action Audit Badge if executed */}
                  {msg.actionTaken && (
                    <div
                      style={{
                        marginTop: 'var(--space-3)',
                        padding: 'var(--space-2) var(--space-3)',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--color-bg)',
                        border: '1px solid var(--color-border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: 'var(--text-micro)',
                      }}
                    >
                      <span style={{ color: msg.actionTaken.success ? 'var(--color-live)' : 'var(--color-error)' }}>
                        Action: {msg.actionTaken.command} ({msg.actionTaken.success ? 'Executed' : 'Failed'})
                      </span>
                      <span style={{ color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
                        {msg.actionTaken.auditId}
                      </span>
                    </div>
                  )}

                  {/* Attachment: Suggested Metadata Card */}
                  {msg.attachments?.metadata && (
                    <div
                      style={{
                        marginTop: 'var(--space-3)',
                        padding: 'var(--space-3)',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--color-surface-elevated)',
                        border: '1px solid var(--color-live)',
                      }}
                    >
                      <div style={{ fontSize: 'var(--text-small)', fontWeight: 600, color: 'var(--color-live)', marginBottom: 'var(--space-2)' }}>
                        Proposed Broadcast Metadata
                      </div>
                      <div style={{ fontSize: 'var(--text-body)', fontWeight: 600, marginBottom: '2px' }}>
                        {msg.attachments.metadata.title}
                      </div>
                      <div style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
                        Artist: {msg.attachments.metadata.artist} | Category: {msg.attachments.metadata.category}
                      </div>
                      <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
                        {msg.attachments.metadata.reasoning}
                      </div>
                      <button
                        onClick={() => handleApplyMetadata(msg.attachments!.metadata!)}
                        style={{
                          padding: 'var(--space-1) var(--space-3)',
                          borderRadius: 'var(--radius-sm)',
                          border: 'none',
                          backgroundColor: 'var(--color-live)',
                          color: 'var(--color-live-text)',
                          fontWeight: 600,
                          fontSize: 'var(--text-small)',
                          cursor: 'pointer',
                        }}
                      >
                        Apply to Live Stream
                      </button>
                    </div>
                  )}

                  {/* Attachment: Show Notes Card */}
                  {msg.attachments?.showNotes && (
                    <div
                      style={{
                        marginTop: 'var(--space-3)',
                        padding: 'var(--space-3)',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--color-surface-elevated)',
                        border: '1px solid var(--color-border)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: 'var(--space-2)',
                        }}
                      >
                        <span style={{ fontSize: 'var(--text-small)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                          Show Notes: {msg.attachments.showNotes.title}
                        </span>
                        <button
                          onClick={() => {
                            const n = msg.attachments!.showNotes!;
                            const text = `${n.title}\nDuration: ${n.durationFormatted}\n\nSummary:\n${n.executiveSummary.join('\n')}\n\nTopics:\n` +
                              n.keyTopics.map((t) => `[${t.timestamp}] ${t.topic}: ${t.summary}`).join('\n');
                            handleCopyText(text, 'Show notes');
                          }}
                          style={{
                            padding: '2px var(--space-2)',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'transparent',
                            color: 'var(--color-text-secondary)',
                            fontSize: 'var(--text-micro)',
                            cursor: 'pointer',
                          }}
                        >
                          Copy Text
                        </button>
                      </div>

                      <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
                        Duration: {msg.attachments.showNotes.durationFormatted}
                      </div>

                      <div style={{ marginBottom: 'var(--space-3)' }}>
                        <div style={{ fontSize: 'var(--text-small)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                          Executive Summary:
                        </div>
                        <ul style={{ paddingLeft: 'var(--space-4)', margin: 0, fontSize: 'var(--text-small)', lineHeight: 1.5 }}>
                          {msg.attachments.showNotes.executiveSummary.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>

                      {msg.attachments.showNotes.keyTopics.length > 0 && (
                        <div>
                          <div style={{ fontSize: 'var(--text-small)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                            Discussion Topics:
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {msg.attachments.showNotes.keyTopics.map((t, idx) => (
                              <div key={idx} style={{ fontSize: 'var(--text-small)' }}>
                                <span style={{ color: 'var(--color-live)', fontFamily: 'monospace', marginRight: 'var(--space-2)' }}>
                                  [{t.timestamp}]
                                </span>
                                <span style={{ fontWeight: 600 }}>{t.topic}:</span> {t.summary}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Attachment: Chapters Card */}
                  {msg.attachments?.chapters && (
                    <div
                      style={{
                        marginTop: 'var(--space-3)',
                        padding: 'var(--space-3)',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--color-surface-elevated)',
                        border: '1px solid var(--color-border)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: 'var(--space-2)',
                        }}
                      >
                        <span style={{ fontSize: 'var(--text-small)', fontWeight: 600 }}>
                          Timestamped Chapters ({msg.attachments.chapters.length})
                        </span>
                        <button
                          onClick={() => {
                            const lines = msg.attachments!.chapters!.map((c) => `${c.timestamp} - ${c.title}`).join('\n');
                            handleCopyText(lines, 'Chapters');
                          }}
                          style={{
                            padding: '2px var(--space-2)',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'transparent',
                            color: 'var(--color-text-secondary)',
                            fontSize: 'var(--text-micro)',
                            cursor: 'pointer',
                          }}
                        >
                          Copy List
                        </button>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        {msg.attachments.chapters.map((chap) => (
                          <div
                            key={chap.id}
                            style={{
                              padding: 'var(--space-2)',
                              backgroundColor: 'var(--color-bg)',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--color-border)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                            }}
                          >
                            <div>
                              <span style={{ color: 'var(--color-live)', fontFamily: 'monospace', fontWeight: 600, marginRight: 'var(--space-2)' }}>
                                {chap.timestamp}
                              </span>
                              <span style={{ fontSize: 'var(--text-small)', fontWeight: 600 }}>{chap.title}</span>
                              <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                                {chap.summary}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Bottom Command Input Bar */}
            <div
              style={{
                padding: 'var(--space-4) var(--space-6)',
                backgroundColor: 'var(--color-surface)',
                borderTop: '1px solid var(--color-border)',
                display: 'flex',
                gap: 'var(--space-3)',
                alignItems: 'center',
              }}
            >
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSendMessage();
                }}
                placeholder="Ask operator assistant or give broadcast commands (e.g. 'Diagnose health', 'Mute channel 1', 'Summarize')..."
                style={{
                  flex: 1,
                  padding: 'var(--space-2) var(--space-4)',
                  backgroundColor: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-primary)',
                  fontSize: 'var(--text-body)',
                  outline: 'none',
                }}
              />
              <button
                onClick={() => handleSendMessage()}
                disabled={isProcessing || !inputText.trim()}
                style={{
                  padding: 'var(--space-2) var(--space-5)',
                  backgroundColor: isProcessing || !inputText.trim() ? 'var(--color-surface-elevated)' : 'var(--color-live)',
                  color: isProcessing || !inputText.trim() ? 'var(--color-text-muted)' : 'var(--color-live-text)',
                  fontWeight: 600,
                  fontSize: 'var(--text-small)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: isProcessing || !inputText.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                Send
              </button>
            </div>
          </div>
        )}

        {/* SUB-TAB 2: HEALTH & TELEMETRY */}
        {activeTab === 'telemetry' && (
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 'var(--space-6)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ fontSize: 'var(--text-h2)', textTransform: 'uppercase', marginBottom: 'var(--space-1)' }}>
                  Stream & Audio Health Diagnostics
                </h2>
                <p style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', margin: 0 }}>
                  Evaluates True Peak headroom (-1.0 dBFS ceiling), RMS dynamic range, socket buffer health, and frame drop metrics.
                </p>
              </div>
              <button
                onClick={handleRunDiagnosis}
                disabled={isDiagnosing}
                style={{
                  padding: 'var(--space-2) var(--space-4)',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  backgroundColor: 'var(--color-live)',
                  color: 'var(--color-live-text)',
                  fontWeight: 600,
                  fontSize: 'var(--text-small)',
                  cursor: isDiagnosing ? 'wait' : 'pointer',
                }}
              >
                {isDiagnosing ? 'Evaluating...' : 'Run Full Diagnostic Sweep'}
              </button>
            </div>

            {diagnosis && (
              <>
                {/* Health Score Banner */}
                <div
                  style={{
                    padding: 'var(--space-4)',
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                      Overall Transmission Status
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--text-display)',
                        fontWeight: 700,
                        color:
                          diagnosis.overallStatus === 'OPTIMAL'
                            ? 'var(--color-live)'
                            : diagnosis.overallStatus === 'WARNING'
                            ? 'var(--color-warning)'
                            : 'var(--color-error)',
                      }}
                    >
                      {diagnosis.overallStatus} ({diagnosis.healthScore}/100)
                    </div>
                    <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                      Evaluated at {new Date(diagnosis.timestamp).toLocaleTimeString()}
                    </div>
                  </div>

                  <div style={{ maxWidth: 450 }}>
                    <div style={{ fontSize: 'var(--text-small)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                      Operator Recommendations:
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                      {diagnosis.recommendations.map((rec, i) => (
                        <li key={i}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Findings List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <div style={{ fontSize: 'var(--text-small)', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                    Diagnostic Findings ({diagnosis.findings.length})
                  </div>

                  {diagnosis.findings.map((f) => (
                    <div
                      key={f.id}
                      style={{
                        padding: 'var(--space-4)',
                        backgroundColor: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 'var(--space-4)',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '4px' }}>
                          <span
                            style={{
                              padding: '2px var(--space-2)',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: 'var(--text-micro)',
                              fontWeight: 600,
                              backgroundColor:
                                f.severity === 'NORMAL'
                                  ? 'rgba(217, 255, 85, 0.1)'
                                  : f.severity === 'WARNING'
                                  ? 'rgba(255, 184, 77, 0.1)'
                                  : 'rgba(255, 92, 108, 0.1)',
                              color:
                                f.severity === 'NORMAL'
                                  ? 'var(--color-live)'
                                  : f.severity === 'WARNING'
                                  ? 'var(--color-warning)'
                                  : 'var(--color-error)',
                            }}
                          >
                            {f.severity}
                          </span>
                          <span style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)' }}>
                            [{f.category}]
                          </span>
                          <span style={{ fontSize: 'var(--text-body)', fontWeight: 600 }}>{f.title}</span>
                        </div>
                        <div style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                          {f.description}
                        </div>
                        <div style={{ fontSize: 'var(--text-small)', color: 'var(--color-info)' }}>
                          Recommendation: {f.recommendation}
                        </div>
                      </div>

                      {f.metricValue && (
                        <div
                          style={{
                            padding: 'var(--space-2) var(--space-3)',
                            backgroundColor: 'var(--color-bg)',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--color-border)',
                            fontFamily: 'monospace',
                            fontSize: 'var(--text-small)',
                            color: 'var(--color-text-primary)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {f.metricValue}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* SUB-TAB 3: MCP SERVER */}
        {activeTab === 'mcp' && (
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 'var(--space-6)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ fontSize: 'var(--text-h2)', textTransform: 'uppercase', marginBottom: 'var(--space-1)' }}>
                  Model Context Protocol (MCP) Server
                </h2>
                <p style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', margin: 0 }}>
                  Exposes broadcast controls, audio metrics, telemetry, and live transcript to external AI clients (Claude, Cursor, Antigravity) via JSON-RPC.
                </p>
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button
                  onClick={handleToggleMcpServer}
                  style={{
                    padding: 'var(--space-2) var(--space-4)',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    backgroundColor: mcpServer.isRunning() ? 'var(--color-error)' : 'var(--color-live)',
                    color: mcpServer.isRunning() ? '#FFFFFF' : 'var(--color-live-text)',
                    fontWeight: 600,
                    fontSize: 'var(--text-small)',
                    cursor: 'pointer',
                  }}
                >
                  {mcpServer.isRunning() ? 'Stop MCP Server' : 'Start MCP Server'}
                </button>
              </div>
            </div>

            {/* MCP Stats Row */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 'var(--space-3)',
              }}
            >
              <div style={{ padding: 'var(--space-3)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)' }}>SERVER STATUS</div>
                <div style={{ fontSize: 'var(--text-h2)', fontWeight: 700, color: mcpStats.running ? 'var(--color-live)' : 'var(--color-error)' }}>
                  {mcpStats.running ? 'ONLINE' : 'STOPPED'}
                </div>
              </div>
              <div style={{ padding: 'var(--space-3)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)' }}>TOTAL INVOCATIONS</div>
                <div style={{ fontSize: 'var(--text-h2)', fontWeight: 700 }}>{mcpStats.totalCalls}</div>
              </div>
              <div style={{ padding: 'var(--space-3)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)' }}>SUCCESSFUL CALLS</div>
                <div style={{ fontSize: 'var(--text-h2)', fontWeight: 700, color: 'var(--color-live)' }}>{mcpStats.successfulCalls}</div>
              </div>
              <div style={{ padding: 'var(--space-3)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)' }}>ACTIVE CLIENTS</div>
                <div style={{ fontSize: 'var(--text-h2)', fontWeight: 700 }}>{mcpStats.activeClients}</div>
              </div>
            </div>

            {/* MCP Test Harness */}
            <div
              style={{
                padding: 'var(--space-4)',
                backgroundColor: 'var(--color-surface)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
              }}
            >
              <div style={{ fontSize: 'var(--text-small)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
                JSON-RPC 2.0 Tool Execution Inspector
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                {/* Left: Tool Selection & Args Input */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <div>
                    <label style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
                      SELECT TOOL
                    </label>
                    <select
                      value={selectedTool}
                      onChange={(e) => setSelectedTool(e.target.value)}
                      style={{
                        width: '100%',
                        padding: 'var(--space-2)',
                        backgroundColor: 'var(--color-bg)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--color-text-primary)',
                        fontSize: 'var(--text-small)',
                      }}
                    >
                      {mcpTools.map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
                      TOOL ARGUMENTS (JSON)
                    </label>
                    <textarea
                      rows={5}
                      value={toolArgsInput}
                      onChange={(e) => setToolArgsInput(e.target.value)}
                      placeholder='{ "channelId": "ch-1", "gainDb": 2.0 }'
                      style={{
                        width: '100%',
                        padding: 'var(--space-2)',
                        backgroundColor: 'var(--color-bg)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--color-text-primary)',
                        fontFamily: 'monospace',
                        fontSize: 'var(--text-small)',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  <button
                    onClick={handleExecuteMcpTest}
                    disabled={isTestingTool}
                    style={{
                      padding: 'var(--space-2) var(--space-4)',
                      borderRadius: 'var(--radius-sm)',
                      border: 'none',
                      backgroundColor: 'var(--color-live)',
                      color: 'var(--color-live-text)',
                      fontWeight: 600,
                      fontSize: 'var(--text-small)',
                      cursor: isTestingTool ? 'wait' : 'pointer',
                    }}
                  >
                    {isTestingTool ? 'Executing...' : 'Invoke Tool via MCP'}
                  </button>
                </div>

                {/* Right: Response Output */}
                <div>
                  <label style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
                    JSON-RPC RESPONSE
                  </label>
                  <pre
                    style={{
                      margin: 0,
                      height: 180,
                      overflowY: 'auto',
                      padding: 'var(--space-3)',
                      backgroundColor: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 'var(--text-micro)',
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    {testResponse || '// Tool response will appear here...'}
                  </pre>
                </div>
              </div>
            </div>

            {/* MCP Call Logs Table */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--text-small)', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                  MCP Invocations History ({mcpLogs.length})
                </span>
                <button
                  onClick={() => mcpServer.clearCallLogs()}
                  style={{
                    padding: '2px var(--space-2)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'transparent',
                    color: 'var(--color-text-muted)',
                    fontSize: 'var(--text-micro)',
                    cursor: 'pointer',
                  }}
                >
                  Clear Logs
                </button>
              </div>

              <div
                style={{
                  maxHeight: 240,
                  overflowY: 'auto',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--color-surface)',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-small)', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                      <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Time</th>
                      <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Method</th>
                      <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Tool / Target</th>
                      <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Status</th>
                      <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mcpLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                          No MCP invocations recorded yet.
                        </td>
                      </tr>
                    ) : (
                      mcpLogs.map((log) => (
                        <tr key={log.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <td style={{ padding: 'var(--space-2) var(--space-3)', fontFamily: 'monospace', fontSize: 'var(--text-micro)' }}>
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </td>
                          <td style={{ padding: 'var(--space-2) var(--space-3)' }}>{log.method}</td>
                          <td style={{ padding: 'var(--space-2) var(--space-3)', fontFamily: 'monospace' }}>
                            {log.toolName || '-'}
                          </td>
                          <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                            <span
                              style={{
                                color: log.success ? 'var(--color-live)' : 'var(--color-error)',
                                fontWeight: 600,
                              }}
                            >
                              {log.success ? 'OK' : 'ERROR'}
                            </span>
                          </td>
                          <td style={{ padding: 'var(--space-2) var(--space-3)', fontFamily: 'monospace' }}>
                            {log.durationMs}ms
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* SUB-TAB 4: AUDIT LOG */}
        {activeTab === 'audit' && (
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 'var(--space-6)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ fontSize: 'var(--text-h2)', textTransform: 'uppercase', marginBottom: 'var(--space-1)' }}>
                  Hardened Control API Audit Log
                </h2>
                <p style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', margin: 0 }}>
                  Every command invoked by the UI, AI Assistant, MCP Server, or Automation engine is parameter-validated, rate-limited, and recorded here.
                </p>
              </div>

              <button
                onClick={() => controlApi.clearAuditHistory()}
                style={{
                  padding: 'var(--space-2) var(--space-4)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-surface-elevated)',
                  color: 'var(--color-text-secondary)',
                  fontSize: 'var(--text-small)',
                  cursor: 'pointer',
                }}
              >
                Clear Audit Trail
              </button>
            </div>

            {/* Security Policy Strip */}
            <div
              style={{
                padding: 'var(--space-4)',
                backgroundColor: 'var(--color-surface)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: 'var(--text-small)', fontWeight: 600 }}>Command Execution Safety Policies</div>
                <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)' }}>
                  Critical commands include broadcast.stop and broadcast.start. Protect on-air integrity by restricting caller permissions.
                </div>
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-small)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={allowAiCritical}
                    onChange={handleToggleAiCritical}
                  />
                  Allow AI Critical Actions
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-small)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={allowMcpCritical}
                    onChange={handleToggleMcpCritical}
                  />
                  Allow MCP Critical Actions
                </label>
              </div>
            </div>

            {/* Audit Table */}
            <div
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--color-surface)',
                overflowY: 'auto',
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-small)', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                    <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Audit ID</th>
                    <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Timestamp</th>
                    <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Caller</th>
                    <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Command</th>
                    <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Severity</th>
                    <th style={{ padding: 'var(--space-2) var(--space-3)' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        No audit events recorded yet.
                      </td>
                    </tr>
                  ) : (
                    auditLog.map((entry) => (
                      <tr key={entry.auditId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={{ padding: 'var(--space-2) var(--space-3)', fontFamily: 'monospace', fontSize: 'var(--text-micro)' }}>
                          {entry.auditId}
                        </td>
                        <td style={{ padding: 'var(--space-2) var(--space-3)', fontFamily: 'monospace', fontSize: 'var(--text-micro)' }}>
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </td>
                        <td style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 600 }}>
                          {entry.caller}
                        </td>
                        <td style={{ padding: 'var(--space-2) var(--space-3)', fontFamily: 'monospace' }}>
                          {entry.command}
                        </td>
                        <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: 'var(--text-micro)',
                              fontWeight: 600,
                              backgroundColor:
                                entry.severity === 'CRITICAL'
                                  ? 'rgba(255, 92, 108, 0.15)'
                                  : entry.severity === 'OPERATIONAL'
                                  ? 'rgba(255, 184, 77, 0.15)'
                                  : 'rgba(103, 183, 255, 0.15)',
                              color:
                                entry.severity === 'CRITICAL'
                                  ? 'var(--color-error)'
                                  : entry.severity === 'OPERATIONAL'
                                  ? 'var(--color-warning)'
                                  : 'var(--color-info)',
                            }}
                          >
                            {entry.severity}
                          </span>
                        </td>
                        <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                          <span style={{ color: entry.success ? 'var(--color-live)' : 'var(--color-error)', fontWeight: 600 }}>
                            {entry.success ? 'PASSED' : 'REJECTED'}
                          </span>
                          {entry.error && (
                            <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-error)', marginTop: '2px' }}>
                              {entry.error}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* API Key Modal */}
      {showKeyModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: 480,
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-6)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: 'var(--text-h2)' }}>AI Engine Configuration</h3>
              <p style={{ margin: 'var(--space-1) 0 0 0', fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)' }}>
                The broadcaster operates locally by default using deterministic rules and local heuristics. Provide a Google Gemini API key to activate enhanced LLM show note summarization.
              </p>
            </div>

            <div>
              <label style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: 'var(--space-1)' }}>
                GOOGLE GEMINI API KEY (OPTIONAL)
              </label>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="AIzaSy..."
                style={{
                  width: '100%',
                  padding: 'var(--space-2) var(--space-3)',
                  backgroundColor: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-primary)',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              <button
                onClick={() => setShowKeyModal(false)}
                style={{
                  padding: 'var(--space-2) var(--space-4)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-text-primary)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveApiKey}
                style={{
                  padding: 'var(--space-2) var(--space-4)',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  backgroundColor: 'var(--color-live)',
                  color: 'var(--color-live-text)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Save Configuration
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
