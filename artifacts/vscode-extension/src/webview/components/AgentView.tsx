import React, { useState, useEffect, useCallback, useRef } from 'react';

interface AgentViewProps {
  vscode: any;
  onSendMessage: (msg: any) => void;
  projectRoot: string;
  connected: boolean;
}

interface AgentTask {
  id: string;
  goal: string;
  status: 'planning' | 'running' | 'paused' | 'complete' | 'error' | 'waiting_approval';
  mode: 'autonomous' | 'guided' | 'debug';
  steps: AgentStep[];
  currentStep: number;
  context: AgentContext;
  createdAt: string;
  updatedAt: string;
  approvals: AgentApproval[];
}

interface AgentStep {
  id: string;
  description: string;
  type: 'explore' | 'edit' | 'run' | 'test' | 'verify' | 'plan' | 'summarize';
  status: 'pending' | 'running' | 'complete' | 'error' | 'skipped';
  tool: string;
  args: any;
  result?: any;
  startTime?: string;
  endTime?: string;
  reasoning?: string;
}

interface AgentContext {
  files: string[];
  symbols: string[];
  diagnostics: any[];
  gitStatus: string;
  testResults: any;
}

interface AgentApproval {
  id: string;
  stepId: string;
  type: 'file_edit' | 'command_run' | 'git_commit' | 'deploy' | 'custom';
  description: string;
  details: any;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  resolvedAt?: string;
}

export function AgentView({ vscode, onSendMessage, projectRoot, connected }: AgentViewProps) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [newGoal, setNewGoal] = useState('');
  const [selectedMode, setSelectedMode] = useState<'autonomous' | 'guided' | 'debug'>('autonomous');
  const [isCreating, setIsCreating] = useState(false);
  const [viewTab, setViewTab] = useState<'timeline' | 'context' | 'approvals' | 'settings'>('timeline');
  const [autoApprove, setAutoApprove] = useState(false);
  const [showReasoning, setShowReasoning] = useState(true);

  const activeTask = tasks.find(t => t.id === activeTaskId);
  const pendingApprovals = activeTask?.approvals.filter(a => a.status === 'pending') || [];

  const handleCreateTask = useCallback(async () => {
    if (!newGoal.trim() || !connected) return;
    setIsCreating(true);

    const taskId = crypto.randomUUID();
    const newTask: AgentTask = {
      id: taskId,
      goal: newGoal,
      status: 'planning',
      mode: selectedMode,
      steps: [],
      currentStep: 0,
      context: {
        files: [],
        symbols: [],
        diagnostics: [],
        gitStatus: '',
        testResults: null,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvals: [],
    };

    setTasks(prev => [...prev, newTask]);
    setActiveTaskId(taskId);
    setNewGoal('');
    setIsCreating(false);

    onSendMessage({ type: 'agent_start', taskId, goal: newGoal, mode: selectedMode });
  }, [newGoal, selectedMode, connected, onSendMessage]);

  const handleTaskMessage = useCallback((message: any) => {
    if (message.type === 'agent_step_start') {
      setTasks(prev => prev.map(t => {
        if (t.id !== message.taskId) return t;
        const stepIndex = t.steps.findIndex(s => s.id === message.stepId);
        if (stepIndex >= 0) {
          const updatedSteps = [...t.steps];
          updatedSteps[stepIndex] = { ...updatedSteps[stepIndex], status: 'running', startTime: new Date().toISOString() };
          return { ...t, steps: updatedSteps, currentStep: stepIndex, status: 'running', updatedAt: new Date().toISOString() };
        }
        return t;
      }));
    } else if (message.type === 'agent_step_complete') {
      setTasks(prev => prev.map(t => {
        if (t.id !== message.taskId) return t;
        const stepIndex = t.steps.findIndex(s => s.id === message.stepId);
        if (stepIndex >= 0) {
          const updatedSteps = [...t.steps];
          updatedSteps[stepIndex] = {
            ...updatedSteps[stepIndex],
            status: 'complete',
            endTime: new Date().toISOString(),
            result: message.result,
          };
          return { ...t, steps: updatedSteps, context: message.context || t.context, updatedAt: new Date().toISOString() };
        }
        return t;
      }));
    } else if (message.type === 'agent_step_error') {
      setTasks(prev => prev.map(t => {
        if (t.id !== message.taskId) return t;
        const stepIndex = t.steps.findIndex(s => s.id === message.stepId);
        if (stepIndex >= 0) {
          const updatedSteps = [...t.steps];
          updatedSteps[stepIndex] = { ...updatedSteps[stepIndex], status: 'error', endTime: new Date().toISOString(), result: message.error };
          return { ...t, steps: updatedSteps, status: 'error', updatedAt: new Date().toISOString() };
        }
        return t;
      }));
    } else if (message.type === 'agent_plan') {
      setTasks(prev => prev.map(t => {
        if (t.id !== message.taskId) return t;
        return {
          ...t,
          steps: message.steps.map((step: any, i: number) => ({
            id: step.id || crypto.randomUUID(),
            description: step.description,
            type: step.type || 'edit',
            status: i === 0 ? 'running' : 'pending',
            tool: step.tool || 'unknown',
            args: step.args || {},
            reasoning: step.reasoning,
            startTime: i === 0 ? new Date().toISOString() : undefined,
          })),
          status: 'running',
          currentStep: 0,
          updatedAt: new Date().toISOString(),
        };
      }));
    } else if (message.type === 'agent_approval_request') {
      setTasks(prev => prev.map(t => {
        if (t.id !== message.taskId) return t;
        return {
          ...t,
          status: 'waiting_approval',
          approvals: [...t.approvals, {
            id: message.approvalId,
            stepId: message.stepId,
            type: message.approvalType,
            description: message.description,
            details: message.details,
            status: 'pending',
            createdAt: new Date().toISOString(),
          }],
          updatedAt: new Date().toISOString(),
        };
      }));
    } else if (message.type === 'agent_complete') {
      setTasks(prev => prev.map(t => {
        if (t.id !== message.taskId) return t;
        return { ...t, status: 'complete', currentStep: t.steps.length - 1, updatedAt: new Date().toISOString() };
      }));
    } else if (message.type === 'agent_context_update') {
      setTasks(prev => prev.map(t => {
        if (t.id !== message.taskId) return t;
        return { ...t, context: { ...t.context, ...message.context }, updatedAt: new Date().toISOString() };
      }));
    } else if (message.type === 'agent_task_list') {
      setTasks(message.tasks);
      if (message.tasks.length > 0 && !activeTaskId) {
        setActiveTaskId(message.tasks[0].id);
      }
    }
  }, [activeTaskId]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (message.type && message.type.startsWith('agent_')) {
        handleTaskMessage(message);
      }
    };
    window.addEventListener('message', handler);
    onSendMessage({ type: 'agent_list_tasks' });
    return () => window.removeEventListener('message', handler);
  }, [handleTaskMessage, onSendMessage]);

  const handleApprove = useCallback((approvalId: string) => {
    if (!activeTask) return;
    onSendMessage({ type: 'agent_approve', taskId: activeTask.id, approvalId });
  }, [activeTask, onSendMessage]);

  const handleReject = useCallback((approvalId: string) => {
    if (!activeTask) return;
    onSendMessage({ type: 'agent_reject', taskId: activeTask.id, approvalId });
  }, [activeTask, onSendMessage]);

  const handlePauseResume = useCallback(() => {
    if (!activeTask) return;
    if (activeTask.status === 'running') {
      onSendMessage({ type: 'agent_pause', taskId: activeTask.id });
    } else if (activeTask.status === 'paused') {
      onSendMessage({ type: 'agent_resume', taskId: activeTask.id });
    }
  }, [activeTask, onSendMessage]);

  const handleStop = useCallback(() => {
    if (!activeTask) return;
    onSendMessage({ type: 'agent_stop', taskId: activeTask.id });
  }, [activeTask, onSendMessage]);

  const handleOpenFile = useCallback((path: string) => {
    vscode.postMessage({ type: 'open_file', path });
  }, [vscode]);

  return (
    <div className="agent-view">
      <div className="agent-header">
        <h3>Agent</h3>
        <div className="agent-header-actions">
          {activeTask && (
            <div className="task-status">
              <span className={`status-badge ${activeTask.status}`}>{activeTask.status}</span>
              <span className="mode-badge">{activeTask.mode}</span>
              <span className="step-progress">Step {activeTask.currentStep + 1} / {activeTask.steps.length}</span>
            </div>
          )}
        </div>
      </div>

      {!activeTask ? (
        <div className="agent-welcome">
          <div className="welcome-content">
            <h4>Start an Agent Task</h4>
            <p>Give the agent a high-level goal and it will autonomously explore, plan, and execute.</p>
            <div className="new-task-form">
              <div className="mode-selector">
                <label>
                  <input
                    type="radio"
                    name="mode"
                    value="autonomous"
                    checked={selectedMode === 'autonomous'}
                    onChange={(e) => setSelectedMode('autonomous')}
                  />
                  <span>🤖 Autonomous</span>
                  <small>Full autonomy with approval gates</small>
                </label>
                <label>
                  <input
                    type="radio"
                    name="mode"
                    value="guided"
                    checked={selectedMode === 'guided'}
                    onChange={(e) => setSelectedMode('guided')}
                  />
                  <span>🧭 Guided</span>
                  <small>Step-by-step with confirmation</small>
                </label>
                <label>
                  <input
                    type="radio"
                    name="mode"
                    value="debug"
                    checked={selectedMode === 'debug'}
                    onChange={(e) => setSelectedMode('debug')}
                  />
                  <span>🐛 Debug</span>
                  <small>Focus on fixing failures</small>
                </label>
              </div>
              <textarea
                className="agent-goal-input"
                value={newGoal}
                onChange={(e) => setNewGoal(e.target.value)}
                placeholder="e.g., 'Fix the authentication bug in the login flow and add tests'"
                rows={3}
                disabled={isCreating || !connected}
              />
              <div className="form-options">
                <label className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={autoApprove}
                    onChange={(e) => setAutoApprove(e.target.checked)}
                  />
                  Auto-approve safe actions
                </label>
              </div>
              <div className="form-actions">
                <button
                  className="btn primary"
                  onClick={handleCreateTask}
                  disabled={isCreating || !newGoal.trim() || !connected}
                >
                  {isCreating ? 'Starting...' : 'Start Agent Task'}
                </button>
              </div>
            </div>
          </div>

          {tasks.length > 0 && (
            <div className="recent-tasks">
              <h5>Recent Tasks</h5>
              <div className="task-list">
                {tasks.slice(-5).reverse().map(task => (
                  <div
                    key={task.id}
                    className={`task-item ${activeTaskId === task.id ? 'active' : ''}`}
                    onClick={() => setActiveTaskId(task.id)}
                  >
                    <div className="task-info">
                      <div className="task-goal">{task.goal}</div>
                      <div className="task-meta">
                        <span className={`status-badge ${task.status}`}>{task.status}</span>
                        <span className="mode-badge">{task.mode}</span>
                        <span>{new Date(task.updatedAt).toLocaleString()}</span>
                        <span>{task.steps.length} steps</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="agent-active-task">
          {/* Pending approvals banner */}
          {pendingApprovals.length > 0 && (
            <div className="approvals-banner">
              <div className="approval-alert">
                ⚠️ {pendingApprovals.length} action{pendingApprovals.length > 1 ? 's' : ''} waiting for approval
              </div>
              <div className="approval-actions">
                <button className="btn secondary" onClick={() => setViewTab('approvals')}>
                  Review Approvals
                </button>
                {autoApprove && (
                  <button className="btn primary" onClick={() => pendingApprovals.forEach(a => handleApprove(a.id))}>
                    Approve All
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="agent-toolbar">
            <div className="view-tabs">
              <button className={viewTab === 'timeline' ? 'active' : ''} onClick={() => setViewTab('timeline')}>
                📋 Timeline
              </button>
              <button className={viewTab === 'context' ? 'active' : ''} onClick={() => setViewTab('context')}>
                🧠 Context
              </button>
              <button className={viewTab === 'approvals' ? 'active' : ''} onClick={() => setViewTab('approvals')}>
                ✋ Approvals {pendingApprovals.length > 0 && <span className="badge">{pendingApprovals.length}</span>}
              </button>
              <button className={viewTab === 'settings' ? 'active' : ''} onClick={() => setViewTab('settings')}>
                ⚙ Settings
              </button>
            </div>
            <div className="task-actions">
              <button
                className="btn secondary"
                onClick={handlePauseResume}
                disabled={activeTask.status === 'complete' || activeTask.status === 'error'}
              >
                {activeTask.status === 'running' ? '⏸ Pause' : '▶ Resume'}
              </button>
              <button
                className="btn secondary"
                onClick={handleStop}
                disabled={activeTask.status === 'complete' || activeTask.status === 'error'}
              >
                ■ Stop
              </button>
            </div>
          </div>

          {viewTab === 'timeline' && (
            <AgentTimelineView
              task={activeTask}
              onOpenFile={handleOpenFile}
              showReasoning={showReasoning}
            />
          )}
          {viewTab === 'context' && (
            <AgentContextView
              task={activeTask}
              onOpenFile={handleOpenFile}
            />
          )}
          {viewTab === 'approvals' && (
            <AgentApprovalsView
              task={activeTask}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          )}
          {viewTab === 'settings' && (
            <AgentSettingsView
              task={activeTask}
              autoApprove={autoApprove}
              onAutoApproveChange={setAutoApprove}
              showReasoning={showReasoning}
              onShowReasoningChange={setShowReasoning}
            />
          )}
        </div>
      )}
    </div>
  );
}

function AgentTimelineView({ task, onOpenFile, showReasoning }: { task: AgentTask; onOpenFile: (path: string) => void; showReasoning: boolean }) {
  return (
    <div className="agent-timeline">
      <div className="task-goal-header">
        <h4>{task.goal}</h4>
        <div className="task-meta">
          Mode: {task.mode} | Created: {new Date(task.createdAt).toLocaleString()}
        </div>
      </div>
      <div className="steps-timeline">
        {task.steps.map((step, index) => (
          <div key={step.id} className={`timeline-step ${step.status} ${index === task.currentStep ? 'current' : ''}`}>
            <div className="step-marker">
              <span className="step-dot">{getStatusDot(step.status)}</span>
              <span className="step-line" />
            </div>
            <div className="step-content">
              <div className="step-header">
                <span className="step-number">{index + 1}</span>
                <span className="step-type">{step.type}</span>
                <span className="step-tool">{step.tool}</span>
                <span className="step-status">{getStatusIcon(step.status)}</span>
                {step.startTime && step.endTime && (
                  <span className="step-duration">
                    {Math.round((new Date(step.endTime).getTime() - new Date(step.startTime).getTime()) / 1000)}s
                  </span>
                )}
              </div>
              <div className="step-description">{step.description}</div>
              {showReasoning && step.reasoning && (
                <div className="step-reasoning">
                  <strong>Reasoning:</strong> {step.reasoning}
                </div>
              )}
              {step.args && Object.keys(step.args).length > 0 && (
                <details className="step-args">
                  <summary>Arguments</summary>
                  <pre>{JSON.stringify(step.args, null, 2)}</pre>
                </details>
              )}
              {step.result && (
                <details className="step-result">
                  <summary>Result</summary>
                  <pre>{JSON.stringify(step.result, null, 2)}</pre>
                </details>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentContextView({ task, onOpenFile }: { task: AgentTask; onOpenFile: (path: string) => void }) {
  return (
    <div className="agent-context">
      <div className="context-section">
        <h4>📁 Files in Context ({task.context.files.length})</h4>
        <ul className="file-list">
          {task.context.files.map((file, i) => (
            <li key={i} onClick={() => onOpenFile(file)}>
              {file}
            </li>
          ))}
          {task.context.files.length === 0 && <li className="empty">No files loaded</li>}
        </ul>
      </div>
      <div className="context-section">
        <h4>🔍 Symbols ({task.context.symbols.length})</h4>
        <ul className="symbol-list">
          {task.context.symbols.map((sym, i) => (
            <li key={i}>{sym}</li>
          ))}
          {task.context.symbols.length === 0 && <li className="empty">No symbols indexed</li>}
        </ul>
      </div>
      <div className="context-section">
        <h4>⚠ Diagnostics ({task.context.diagnostics.length})</h4>
        <ul className="diagnostic-list">
          {task.context.diagnostics.map((diag, i) => (
            <li key={i} className={diag.severity}>
              <span className="diag-file">{diag.file}</span>
              <span className="diag-message">{diag.message}</span>
            </li>
          ))}
          {task.context.diagnostics.length === 0 && <li className="empty">No diagnostics</li>}
        </ul>
      </div>
      <div className="context-section">
        <h4>📊 Git Status</h4>
        <pre className="git-status">{task.context.gitStatus || 'No changes'}</pre>
      </div>
      <div className="context-section">
        <h4>🧪 Test Results</h4>
        <pre className="test-results">{task.context.testResults ? JSON.stringify(task.context.testResults, null, 2) : 'No test runs'}</pre>
      </div>
    </div>
  );
}

function AgentApprovalsView({ task, onApprove, onReject }: { task: AgentTask; onApprove: (id: string) => void; onReject: (id: string) => void }) {
  const pending = task.approvals.filter(a => a.status === 'pending');
  const resolved = task.approvals.filter(a => a.status !== 'pending');

  return (
    <div className="agent-approvals">
      {pending.length === 0 && resolved.length === 0 && (
        <div className="empty-state">No approval requests</div>
      )}

      {pending.length > 0 && (
        <div className="approvals-section">
          <h4>⏳ Pending Approvals</h4>
          {pending.map(approval => (
            <div key={approval.id} className="approval-card pending">
              <div className="approval-header">
                <span className="approval-type">{approval.type}</span>
                <span className="approval-time">{new Date(approval.createdAt).toLocaleTimeString()}</span>
              </div>
              <div className="approval-description">{approval.description}</div>
              <details className="approval-details">
                <summary>Details</summary>
                <pre>{JSON.stringify(approval.details, null, 2)}</pre>
              </details>
              <div className="approval-buttons">
                <button className="btn primary" onClick={() => onApprove(approval.id)}>Approve</button>
                <button className="btn danger" onClick={() => onReject(approval.id)}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <details className="approvals-section">
          <summary>✅ Resolved Approvals ({resolved.length})</summary>
          {resolved.map(approval => (
            <div key={approval.id} className={`approval-card ${approval.status}`}>
              <div className="approval-header">
                <span className="approval-type">{approval.type}</span>
                <span className={`approval-status ${approval.status}`}>{approval.status}</span>
              </div>
              <div className="approval-description">{approval.description}</div>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function AgentSettingsView({ task, autoApprove, onAutoApproveChange, showReasoning, onShowReasoningChange }: {
  task: AgentTask;
  autoApprove: boolean;
  onAutoApproveChange: (v: boolean) => void;
  showReasoning: boolean;
  onShowReasoningChange: (v: boolean) => void;
}) {
  return (
    <div className="agent-settings">
      <h4>Agent Settings</h4>
      <div className="setting-group">
        <label>
          <input
            type="checkbox"
            checked={autoApprove}
            onChange={(e) => onAutoApproveChange(e.target.checked)}
          />
          Auto-approve safe actions (file reads, searches, non-destructive edits)
        </label>
      </div>
      <div className="setting-group">
        <label>
          <input
            type="checkbox"
            checked={showReasoning}
            onChange={(e) => onShowReasoningChange(e.target.checked)}
          />
          Show agent reasoning in timeline
        </label>
      </div>
      <div className="setting-group">
        <label>Max steps per task:</label>
        <input type="number" min="1" max="100" defaultValue="20" />
      </div>
      <div className="setting-group">
        <label>Approval threshold:</label>
        <select>
          <option>All actions</option>
          <option>Destructive only</option>
          <option>Custom (configure below)</option>
        </select>
      </div>
      <div className="setting-group">
        <h5>Allowed tools without approval:</h5>
        <div className="tool-checkboxes">
          {['read', 'grep', 'glob', 'list', 'search', 'web_search'].map(tool => (
            <label key={tool} className="checkbox-inline">
              <input type="checkbox" defaultChecked />
              {tool}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function getStatusDot(status: string): string {
  switch (status) {
    case 'pending': return '○';
    case 'running': return '●';
    case 'complete': return '✓';
    case 'error': return '✗';
    case 'skipped': return '⊘';
    default: return '?';
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'pending': return '○';
    case 'running': return '◐';
    case 'complete': return '✓';
    case 'error': return '✗';
    case 'skipped': return '⊘';
    default: return '?';
  }
}