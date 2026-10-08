import React, { useState, useEffect } from 'react';
import { automationEngine } from '../services/automation/automationEngine';
import { AutomationExecutionLog, AutomationRule } from '../services/automation/types';

export const AutomationWorkspace: React.FC = () => {
  const [rules, setRules] = useState<AutomationRule[]>(automationEngine.getRules());
  const [logs, setLogs] = useState<AutomationExecutionLog[]>(automationEngine.getLogs());

  // Add rule modal state
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newRuleName, setNewRuleName] = useState<string>('');
  const [newRuleDesc, setNewRuleDesc] = useState<string>('');
  const [newEventName, setNewEventName] = useState<string>('broadcast.status.changed');
  const [newConditionKey, setNewConditionKey] = useState<string>('state');
  const [newConditionValue, setNewConditionValue] = useState<string>('CONNECTED');
  const [newActionType, setNewActionType] = useState<string>('START_RECORD');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubRules = automationEngine.onRulesChanged((r) => setRules(r));
    const unsubLogs = automationEngine.onLogsChanged((l) => setLogs(l));

    return () => {
      unsubRules();
      unsubLogs();
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleToggleRule = (id: string) => {
    automationEngine.toggleRule(id);
    const r = rules.find((item) => item.id === id);
    showToast(`Rule ${r?.name} is now ${!r?.enabled ? 'enabled' : 'disabled'}`);
  };

  const handleRunNow = async (rule: AutomationRule) => {
    await automationEngine.executeRule(rule, 'Manual operator test trigger');
    showToast(`Executed pipeline: "${rule.name}"`);
  };

  const handleDeleteRule = (id: string) => {
    automationEngine.deleteRule(id);
    showToast('Rule removed from automation engine');
  };

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleName.trim()) return;

    automationEngine.addRule({
      name: newRuleName.trim(),
      description: newRuleDesc.trim() || 'Custom studio event automation pipeline.',
      enabled: true,
      trigger: {
        type: 'EVENT',
        eventName: newEventName,
        eventCondition: { key: newConditionKey, value: newConditionValue },
      },
      action: {
        type: newActionType as any,
      },
    });

    setNewRuleName('');
    setNewRuleDesc('');
    setShowAddModal(false);
    showToast('New automation pipeline saved');
  };

  return (
    <section className="ws-workspace" style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1.3fr) minmax(180px, 0.9fr)', gap: '14px', height: '100%' }}>
      {/* Command & Control Bar */}
      <div className="ws-command-row">
        <div>
          <div className="ws-kicker">System / Orchestration</div>
          <h1 className="ws-title">Automation & Event Rule Engine</h1>
          <p className="ws-subtitle">
            Deterministic state triggers executing scheduled macros, stream redundancy failovers, and auto-archiving.
          </p>
        </div>

        <div className="ws-transport">
          <button
            type="button"
            className="ws-primary-action"
            onClick={() => setShowAddModal(true)}
          >
            + Create Pipeline Rule
          </button>
        </div>
      </div>

      {/* Pipeline Flow Rules List */}
      <div
        style={{
          border: '1px solid var(--ws-line)',
          borderRadius: '7px',
          background: 'var(--ws-panel)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        <div className="ws-section-head">
          <h2>Active Automation Pipelines ({rules.length})</h2>
          <span>Visual Event Flow (EVENT → CONDITION → ACTION → RESULT)</span>
        </div>

        <div style={{ padding: '14px', overflowY: 'auto', flex: 1 }}>
          {rules.length === 0 ? (
            <div className="ws-empty">
              <div>
                <strong>No Automation Pipelines Configured</strong>
                <p>Click "Create Pipeline Rule" to automate broadcast start/stop, recordings, or silence failover.</p>
              </div>
            </div>
          ) : (
            rules.map((rule) => {
              const triggerEvent =
                rule.trigger.type === 'EVENT'
                  ? rule.trigger.eventName || 'event.received'
                  : `INTERVAL (${rule.trigger.intervalSeconds || 60}s)`;

              const conditionText = rule.trigger.eventCondition
                ? `${rule.trigger.eventCondition.key} == "${rule.trigger.eventCondition.value}"`
                : 'True (Any payload)';

              const actionName = rule.action.type;
              const resultTarget = 'Broadcast Control API';

              return (
                <div key={rule.id} className="ws-flow-card">
                  {/* Top Meta */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="ws-badge" data-variant={rule.enabled ? 'live' : 'neutral'}>
                        {rule.enabled ? 'PIPELINE ACTIVE' : 'DISABLED'}
                      </span>
                      <strong style={{ fontSize: '13px', color: 'var(--ws-text)' }}>
                        {rule.name}
                      </strong>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '10px', color: 'var(--ws-subtle)', fontFamily: 'var(--font-mono)', marginRight: '6px' }}>
                        Fired {rule.triggerCount} time(s)
                      </span>
                      <button
                        type="button"
                        className="ws-mini-action"
                        onClick={() => handleRunNow(rule)}
                        title="Simulate immediate pipeline trigger"
                      >
                        Run Now
                      </button>
                      <button
                        type="button"
                        className="ws-mini-action"
                        style={{
                          borderColor: rule.enabled ? 'var(--ws-line)' : 'var(--ws-live)',
                          color: rule.enabled ? 'var(--ws-muted)' : 'var(--ws-live)',
                        }}
                        onClick={() => handleToggleRule(rule.id)}
                      >
                        {rule.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        className="ws-mini-action"
                        style={{ color: 'var(--ws-danger)' }}
                        onClick={() => handleDeleteRule(rule.id)}
                        title="Delete rule"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: 'var(--ws-muted)' }}>
                    {rule.description}
                  </p>

                  {/* Visual Node Pipeline (Task 14) */}
                  <div className="ws-flow-pipeline">
                    <div className="ws-flow-node">
                      <span className="ws-flow-node-type">1. EVENT</span>
                      <span className="ws-flow-node-val">{triggerEvent}</span>
                    </div>

                    <span className="ws-flow-arrow">→</span>

                    <div className="ws-flow-node">
                      <span className="ws-flow-node-type">2. CONDITION</span>
                      <span className="ws-flow-node-val">{conditionText}</span>
                    </div>

                    <span className="ws-flow-arrow">→</span>

                    <div className="ws-flow-node" style={{ borderColor: 'color-mix(in srgb, var(--ws-live) 40%, var(--ws-line))' }}>
                      <span className="ws-flow-node-type" style={{ color: 'var(--ws-live)' }}>3. ACTION</span>
                      <span className="ws-flow-node-val" style={{ color: 'var(--ws-live)' }}>{actionName}</span>
                    </div>

                    <span className="ws-flow-arrow">→</span>

                    <div className="ws-flow-node">
                      <span className="ws-flow-node-type">4. RESULT</span>
                      <span className="ws-flow-node-val">{resultTarget}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Execution Audit Log Stream */}
      <div
        style={{
          border: '1px solid var(--ws-line)',
          borderRadius: '7px',
          background: 'var(--ws-panel)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        <div className="ws-section-head">
          <h2>Automation Execution Audit Logs ({logs.length})</h2>
          <span>Deterministic Dispatch History</span>
        </div>

        <div style={{ overflow: 'auto', flex: 1 }}>
          {logs.length === 0 ? (
            <div className="ws-empty" style={{ minHeight: '80px' }}>
              <div>
                <strong>No Automation Triggers Logged Yet</strong>
                <p>Logs will automatically append here when automation events execute.</p>
              </div>
            </div>
          ) : (
            <table className="ws-table">
              <thead>
                <tr>
                  <th style={{ width: '130px' }}>Timestamp</th>
                  <th style={{ width: '200px' }}>Pipeline Rule</th>
                  <th style={{ width: '100px' }}>Status</th>
                  <th>Execution Trace / Payload Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.slice(0, 30).map((log) => (
                  <tr key={log.id}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--ws-subtle)' }}>
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </td>
                    <td style={{ fontWeight: 650 }}>{log.ruleName}</td>
                    <td>
                      <span
                        className="ws-badge"
                        data-variant={log.status === 'SUCCESS' ? 'live' : 'danger'}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--ws-muted)' }}>
                      {log.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add Custom Rule Modal */}
      {showAddModal && (
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
              width: 'min(500px, 92vw)',
              background: 'var(--ws-panel)',
              border: '1px solid var(--ws-line)',
              borderRadius: '8px',
              padding: '18px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 760 }}>Create Automation Rule</h3>
              <button
                type="button"
                className="ws-mini-action"
                onClick={() => setShowAddModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateRule} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label className="ws-form-label">Rule Name</label>
                <input
                  type="text"
                  className="ws-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. Silence Auto-Failover"
                  value={newRuleName}
                  onChange={(e) => setNewRuleName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="ws-form-label">Description</label>
                <input
                  type="text"
                  className="ws-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. Automatically start standby playlist when silence exceeds threshold"
                  value={newRuleDesc}
                  onChange={(e) => setNewRuleDesc(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label className="ws-form-label">1. Event Trigger</label>
                  <select
                    className="ws-select"
                    style={{ width: '100%' }}
                    value={newEventName}
                    onChange={(e) => setNewEventName(e.target.value)}
                  >
                    <option value="broadcast.status.changed">broadcast.status.changed</option>
                    <option value="audio.level.changed">audio.level.changed</option>
                    <option value="audio.device.changed">audio.device.changed</option>
                    <option value="transcript.segment.created">transcript.segment.created</option>
                  </select>
                </div>

                <div>
                  <label className="ws-form-label">2. Condition Match</label>
                  <input
                    type="text"
                    className="ws-input"
                    style={{ width: '100%' }}
                    placeholder="state=CONNECTED"
                    value={`${newConditionKey}=${newConditionValue}`}
                    onChange={(e) => {
                      const [k, v] = e.target.value.split('=');
                      setNewConditionKey(k || 'state');
                      setNewConditionValue(v || 'CONNECTED');
                    }}
                  />
                </div>
              </div>

              <div>
                <label className="ws-form-label">3. Target Action</label>
                <select
                  className="ws-select"
                  style={{ width: '100%' }}
                  value={newActionType}
                  onChange={(e) => setNewActionType(e.target.value)}
                >
                  <option value="START_RECORD">START_RECORD (Capture to archive)</option>
                  <option value="STOP_RECORD">STOP_RECORD (End recording)</option>
                  <option value="START_BROADCAST">START_BROADCAST (Go on air)</option>
                  <option value="STOP_BROADCAST">STOP_BROADCAST (Disconnect stream)</option>
                  <option value="PLAY_DECK">PLAY_DECK (Start playback)</option>
                  <option value="PAUSE_DECK">PAUSE_DECK (Pause playback)</option>
                  <option value="STOP_DECK">STOP_DECK (Stop playback)</option>
                  <option value="NEXT_TRACK">NEXT_TRACK (Advance queue)</option>
                  <option value="TRANSITION_DECK">TRANSITION_DECK (Crossfade transition)</option>
                  <option value="SET_MUTE">SET_MUTE (Toggle mute channel)</option>
                  <option value="PLAY_TONE">PLAY_TONE (Trigger cue chime)</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
                <button
                  type="button"
                  className="ws-secondary-action"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="ws-primary-action">
                  Deploy Pipeline
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toastMessage && <div className="ws-toast">{toastMessage}</div>}
    </section>
  );
};
