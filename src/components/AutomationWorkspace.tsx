import React, { useState, useEffect } from 'react';
import { automationEngine } from '../services/automation/automationEngine';
import { AutomationExecutionLog, AutomationRule } from '../services/automation/types';

export const AutomationWorkspace: React.FC = () => {
  const [rules, setRules] = useState<AutomationRule[]>(automationEngine.getRules());
  const [logs, setLogs] = useState<AutomationExecutionLog[]>(automationEngine.getLogs());

  // Simple form state for adding a custom rule
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newRuleName, setNewRuleName] = useState<string>('');
  const [newRuleDesc, setNewRuleDesc] = useState<string>('');
  const [newRuleAction, setNewRuleAction] = useState<string>('PLAY_TONE');

  useEffect(() => {
    const unsubRules = automationEngine.onRulesChanged((r) => setRules(r));
    const unsubLogs = automationEngine.onLogsChanged((l) => setLogs(l));

    return () => {
      unsubRules();
      unsubLogs();
    };
  }, []);

  const handleToggleRule = (id: string) => {
    automationEngine.toggleRule(id);
  };

  const handleRunNow = async (rule: AutomationRule) => {
    await automationEngine.executeRule(rule, 'Manual operator trigger via console');
  };

  const handleDeleteRule = (id: string) => {
    automationEngine.deleteRule(id);
  };

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleName.trim()) return;

    automationEngine.addRule({
      name: newRuleName.trim(),
      description: newRuleDesc.trim() || 'Custom operator automation macro.',
      enabled: true,
      trigger: {
        type: 'EVENT',
        eventName: 'broadcast.status.changed',
      },
      action: {
        type: newRuleAction as any,
      },
    });

    setNewRuleName('');
    setNewRuleDesc('');
    setShowAddModal(false);
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--space-5)',
        gap: 'var(--space-4)',
        backgroundColor: 'var(--color-bg)',
        overflowY: 'auto',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--color-surface)',
          padding: 'var(--space-3) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div>
          <h1 style={{ fontSize: 'var(--text-h2)', fontWeight: 700, margin: 0 }}>
            Broadcast Automation Rules
          </h1>
          <p style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
            Event-driven triggers and scheduled macros executed via the safe Control API.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          style={{
            padding: 'var(--space-2) var(--space-4)',
            backgroundColor: 'var(--color-live)',
            color: '#0B0D0F',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 700,
            fontSize: 'var(--text-small)',
          }}
        >
          Add Custom Rule
        </button>
      </header>

      {/* Modal / Panel for Adding Custom Rule */}
      {showAddModal && (
        <section
          style={{
            backgroundColor: 'var(--color-surface-elevated)',
            border: '2px solid var(--color-live)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 700, margin: 0 }}>
              Create New Automation Rule
            </h2>
            <button
              onClick={() => setShowAddModal(false)}
              style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-muted)' }}
            >
              Cancel
            </button>
          </div>

          <form onSubmit={handleCreateRule} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                RULE NAME
              </label>
              <input
                type="text"
                placeholder="e.g. Play ID tone on connect"
                value={newRuleName}
                onChange={(e) => setNewRuleName(e.target.value)}
                style={{ width: '100%' }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                DESCRIPTION
              </label>
              <input
                type="text"
                placeholder="Purpose of this automation"
                value={newRuleDesc}
                onChange={(e) => setNewRuleDesc(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                TARGET ACTION
              </label>
              <select
                value={newRuleAction}
                onChange={(e) => setNewRuleAction(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="PLAY_TONE">Play Audio Cue / Chime Tone</option>
                <option value="START_RECORD">Start Master Audio Recording</option>
                <option value="STOP_RECORD">Stop Master Audio Recording</option>
                <option value="START_BROADCAST">Connect Broadcast Stream</option>
                <option value="STOP_BROADCAST">Disconnect Broadcast Stream</option>
              </select>
            </div>

            <button
              type="submit"
              style={{
                marginTop: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-4)',
                backgroundColor: 'var(--color-live)',
                color: '#0B0D0F',
                fontWeight: 700,
                borderRadius: 'var(--radius-sm)',
              }}
            >
              SAVE AUTOMATION RULE
            </button>
          </form>
        </section>
      )}

      {/* Rules Grid */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 600, margin: 0 }}>
          Configured Rules ({rules.length})
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {rules.map((rule) => (
            <div
              key={rule.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-4)',
                backgroundColor: 'var(--color-surface)',
                border: `1px solid ${rule.enabled ? 'var(--color-border)' : 'var(--color-border-subtle)'}`,
                borderRadius: 'var(--radius-md)',
                opacity: rule.enabled ? 1 : 0.65,
                gap: 'var(--space-4)',
              }}
            >
              {/* Left Details */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    {rule.name}
                  </span>
                  <span
                    style={{
                      fontSize: 'var(--text-micro)',
                      padding: '1px 6px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--color-surface-elevated)',
                      color: 'var(--color-info)',
                      fontWeight: 600,
                    }}
                  >
                    {rule.trigger.type === 'EVENT' ? `EVENT: ${rule.trigger.eventName}` : `INTERVAL: ${rule.trigger.intervalSeconds}s`}
                  </span>
                  <span
                    style={{
                      fontSize: 'var(--text-micro)',
                      padding: '1px 6px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--color-surface-elevated)',
                      color: 'var(--color-live)',
                      fontWeight: 600,
                    }}
                  >
                    ACTION: {rule.action.type}
                  </span>
                </div>

                <span style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)' }}>
                  {rule.description}
                </span>

                <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)' }}>
                  <span>Triggers: {rule.triggerCount} time(s)</span>
                  {rule.lastTriggeredAt && (
                    <span>Last run: {new Date(rule.lastTriggeredAt).toLocaleTimeString('id-ID')}</span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <button
                  onClick={() => handleRunNow(rule)}
                  title="Test run this automation rule now"
                  style={{
                    padding: 'var(--space-2) var(--space-3)',
                    backgroundColor: 'var(--color-surface-elevated)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--text-micro)',
                    fontWeight: 600,
                  }}
                >
                  Run Now
                </button>

                <button
                  onClick={() => handleToggleRule(rule.id)}
                  style={{
                    padding: 'var(--space-2) var(--space-4)',
                    backgroundColor: rule.enabled ? 'var(--color-live)' : 'var(--color-surface-elevated)',
                    color: rule.enabled ? '#0B0D0F' : 'var(--color-text-primary)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--text-small)',
                    fontWeight: 700,
                    border: '1px solid var(--color-border)',
                  }}
                >
                  {rule.enabled ? 'ENABLED' : 'DISABLED'}
                </button>

                <button
                  onClick={() => handleDeleteRule(rule.id)}
                  style={{
                    padding: 'var(--space-2)',
                    color: 'var(--color-text-muted)',
                    fontSize: 'var(--text-small)',
                  }}
                  title="Delete Rule"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Execution History Log */}
      <section
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 600, margin: 0 }}>
            Automation Execution History
          </h2>
          <span style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)' }}>
            Showing recent triggers
          </span>
        </div>

        {logs.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-small)', fontStyle: 'italic', padding: 'var(--space-2)' }}>
            No automation events recorded yet. Click "Run Now" on any rule to execute an action.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: '200px', overflowY: 'auto' }}>
            {logs.map((log) => (
              <div
                key={log.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 'var(--space-2) var(--space-3)',
                  backgroundColor: 'var(--color-surface-elevated)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--text-small)',
                }}
              >
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: log.status === 'SUCCESS' ? 'var(--color-live)' : 'var(--color-error)',
                    }}
                  />
                  <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{log.ruleName}</span>
                  <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-micro)' }}>{log.details}</span>
                </div>

                <span className="font-mono" style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-micro)' }}>
                  {new Date(log.timestamp).toLocaleTimeString('id-ID')}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
