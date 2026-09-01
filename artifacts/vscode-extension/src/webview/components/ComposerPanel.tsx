import React, { useState, useRef, useEffect, useCallback } from 'react';

interface ComposerPanelProps {
  vscode: any;
  onSendMessage: (msg: any) => void;
  projectRoot: string;
  connected: boolean;
}

interface ComposerSession {
  id: string;
  goal: string;
  status: 'planning' | 'running' | 'paused' | 'complete' | 'error';
  steps: ComposerStep[];
  currentStep: number;
  createdAt: string;
  updatedAt: string;
}

interface ComposerStep {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'complete' | 'error' | 'skipped';
  files: ComposerFileChange[];
  toolCalls: any[];
  startTime?: string;
  endTime?: string;
}

interface ComposerFileChange {
  path: string;
  action: 'create' | 'modify' | 'delete';
  diff?: string;
  content?: string;
}

export function ComposerPanel({ vscode, onSendMessage, projectRoot, connected }: ComposerPanelProps) {
  const [sessions, setSessions] = useState<ComposerSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [newGoal, setNewGoal] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [viewMode, setViewMode] = useState<'plan' | 'diff' | 'files'>('plan');

  const activeSession = sessions.find(s => s.id === activeSessionId);

  const handleCreateSession = useCallback(async () => {
    if (!newGoal.trim() || !connected) return;
    setIsCreating(true);

    const sessionId = crypto.randomUUID();
    const newSession: ComposerSession = {
      id: sessionId,
      goal: newGoal,
      status: 'planning',
      steps: [],
      currentStep: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setSessions(prev => [...prev, newSession]);
    setActiveSessionId(sessionId);
    setNewGoal('');
    setIsCreating(false);

    onSendMessage({ type: 'composer_start', sessionId, goal: newGoal });
  }, [newGoal, connected, onSendMessage]);

  const handleSessionMessage = useCallback((message: any) => {
    if (message.type === 'composer_step_start') {
      setSessions(prev => prev.map(s => {
        if (s.id !== message.sessionId) return s;
        const stepIndex = s.steps.findIndex(st => st.id === message.stepId);
        if (stepIndex >= 0) {
          const updatedSteps = [...s.steps];
          updatedSteps[stepIndex] = { ...updatedSteps[stepIndex], status: 'running', startTime: new Date().toISOString() };
          return { ...s, steps: updatedSteps, currentStep: stepIndex, status: 'running', updatedAt: new Date().toISOString() };
        }
        return s;
      }));
    } else if (message.type === 'composer_step_complete') {
      setSessions(prev => prev.map(s => {
        if (s.id !== message.sessionId) return s;
        const stepIndex = s.steps.findIndex(st => st.id === message.stepId);
        if (stepIndex >= 0) {
          const updatedSteps = [...s.steps];
          updatedSteps[stepIndex] = {
            ...updatedSteps[stepIndex],
            status: 'complete',
            endTime: new Date().toISOString(),
            files: message.files || [],
            toolCalls: message.toolCalls || [],
          };
          return { ...s, steps: updatedSteps, updatedAt: new Date().toISOString() };
        }
        return s;
      }));
    } else if (message.type === 'composer_step_error') {
      setSessions(prev => prev.map(s => {
        if (s.id !== message.sessionId) return s;
        const stepIndex = s.steps.findIndex(st => st.id === message.stepId);
        if (stepIndex >= 0) {
          const updatedSteps = [...s.steps];
          updatedSteps[stepIndex] = { ...updatedSteps[stepIndex], status: 'error', endTime: new Date().toISOString() };
          return { ...s, steps: updatedSteps, status: 'error', updatedAt: new Date().toISOString() };
        }
        return s;
      }));
    } else if (message.type === 'composer_plan') {
      setSessions(prev => prev.map(s => {
        if (s.id !== message.sessionId) return s;
        return {
          ...s,
          steps: message.steps.map((step: any, i: number) => ({
            id: step.id || crypto.randomUUID(),
            description: step.description,
            status: i === 0 ? 'running' : 'pending',
            files: [],
            toolCalls: [],
            startTime: i === 0 ? new Date().toISOString() : undefined,
          })),
          status: 'running',
          currentStep: 0,
          updatedAt: new Date().toISOString(),
        };
      }));
    } else if (message.type === 'composer_complete') {
      setSessions(prev => prev.map(s => {
        if (s.id !== message.sessionId) return s;
        return { ...s, status: 'complete', currentStep: s.steps.length - 1, updatedAt: new Date().toISOString() };
      }));
    } else if (message.type === 'composer_session_list') {
      setSessions(message.sessions);
      if (message.sessions.length > 0 && !activeSessionId) {
        setActiveSessionId(message.sessions[0].id);
      }
    }
  }, [activeSessionId]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (message.type && message.type.startsWith('composer_')) {
        handleSessionMessage(message);
      }
    };
    window.addEventListener('message', handler);
    // Request session list on mount
    onSendMessage({ type: 'composer_list_sessions' });
    return () => window.removeEventListener('message', handler);
  }, [handleSessionMessage, onSendMessage]);

  const handlePauseResume = useCallback(() => {
    if (!activeSession) return;
    if (activeSession.status === 'running') {
      onSendMessage({ type: 'composer_pause', sessionId: activeSession.id });
    } else if (activeSession.status === 'paused') {
      onSendMessage({ type: 'composer_resume', sessionId: activeSession.id });
    }
  }, [activeSession, onSendMessage]);

  const handleStop = useCallback(() => {
    if (!activeSession) return;
    onSendMessage({ type: 'composer_stop', sessionId: activeSession.id });
  }, [activeSession, onSendMessage]);

  const handleApplyChanges = useCallback(() => {
    if (!activeSession) return;
    onSendMessage({ type: 'composer_apply', sessionId: activeSession.id });
  }, [activeSession, onSendMessage]);

  const handleOpenFile = useCallback((path: string) => {
    vscode.postMessage({ type: 'open_file', path });
  }, [vscode]);

  return (
    <div className="composer-panel">
      <div className="composer-header">
        <h3>Composer</h3>
        <div className="composer-header-actions">
          {activeSession && (
            <div className="session-status">
              <span className={`status-badge ${activeSession.status}`}>{activeSession.status}</span>
              <span className="step-progress">
                Step {activeSession.currentStep + 1} / {activeSession.steps.length}
              </span>
            </div>
          )}
        </div>
      </div>

      {!activeSession ? (
        <div className="composer-welcome">
          <div className="welcome-content">
            <h4>Start a Composer Session</h4>
            <p>Describe a multi-file task and Infinity will plan and execute it step by step.</p>
            <div className="new-session-form">
              <textarea
                className="composer-goal-input"
                value={newGoal}
                onChange={(e) => setNewGoal(e.target.value)}
                placeholder="e.g., 'Create a user dashboard with authentication, profile page, and settings'"
                rows={3}
                disabled={isCreating || !connected}
              />
              <div className="form-actions">
                <button
                  className="btn primary"
                  onClick={handleCreateSession}
                  disabled={isCreating || !newGoal.trim() || !connected}
                >
                  {isCreating ? 'Starting...' : 'Start Composer Session'}
                </button>
              </div>
            </div>
          </div>

          {sessions.length > 0 && (
            <div className="recent-sessions">
              <h5>Recent Sessions</h5>
              <div className="session-list">
                {sessions.slice(-5).reverse().map(session => (
                  <div
                    key={session.id}
                    className={`session-item ${activeSessionId === session.id ? 'active' : ''}`}
                    onClick={() => setActiveSessionId(session.id)}
                  >
                    <div className="session-info">
                      <div className="session-goal">{session.goal}</div>
                      <div className="session-meta">
                        <span className={`status-badge ${session.status}`}>{session.status}</span>
                        <span>{new Date(session.updatedAt).toLocaleString()}</span>
                        <span>{session.steps.length} steps</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="composer-active-session">
          <div className="composer-toolbar">
            <div className="view-tabs">
              <button
                className={viewMode === 'plan' ? 'active' : ''}
                onClick={() => setViewMode('plan')}
              >
                Plan
              </button>
              <button
                className={viewMode === 'diff' ? 'active' : ''}
                onClick={() => setViewMode('diff')}
              >
                Diffs
              </button>
              <button
                className={viewMode === 'files' ? 'active' : ''}
                onClick={() => setViewMode('files')}
              >
                Files
              </button>
            </div>
            <div className="session-actions">
              <button
                className="btn secondary"
                onClick={handlePauseResume}
                disabled={activeSession.status === 'complete' || activeSession.status === 'error'}
              >
                {activeSession.status === 'running' ? '⏸ Pause' : '▶ Resume'}
              </button>
              <button
                className="btn secondary"
                onClick={handleStop}
                disabled={activeSession.status === 'complete' || activeSession.status === 'error'}
              >
                ■ Stop
              </button>
              {activeSession.status === 'complete' && (
                <button className="btn primary" onClick={handleApplyChanges}>
                  ✓ Apply Changes
                </button>
              )}
            </div>
          </div>

          {viewMode === 'plan' && (
            <ComposerPlanView
              session={activeSession}
              onOpenFile={handleOpenFile}
              projectRoot={projectRoot}
            />
          )}
          {viewMode === 'diff' && (
            <ComposerDiffView
              session={activeSession}
              onOpenFile={handleOpenFile}
            />
          )}
          {viewMode === 'files' && (
            <ComposerFilesView
              session={activeSession}
              onOpenFile={handleOpenFile}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ComposerPlanView({ session, onOpenFile, projectRoot }: { session: ComposerSession; onOpenFile: (path: string) => void; projectRoot: string }) {
  return (
    <div className="composer-plan-view">
      <div className="session-goal-header">
        <h4>{session.goal}</h4>
        <div className="session-meta">
          Created: {new Date(session.createdAt).toLocaleString()} |
          Updated: {new Date(session.updatedAt).toLocaleString()}
        </div>
      </div>
      <div className="steps-list">
        {session.steps.map((step, index) => (
          <div key={step.id} className={`step-item ${step.status} ${index === session.currentStep ? 'current' : ''}`}>
            <div className="step-header">
              <span className="step-number">{index + 1}</span>
              <span className="step-status-indicator">{getStatusIcon(step.status)}</span>
              <span className="step-description">{step.description}</span>
              {step.startTime && (
                <span className="step-time">
                  {step.endTime
                    ? `${Math.round((new Date(step.endTime).getTime() - new Date(step.startTime).getTime()) / 1000)}s`
                    : '...'
                  }
                </span>
              )}
            </div>
            {step.files.length > 0 && (
              <div className="step-files">
                {step.files.map((file, i) => (
                  <div key={i} className="step-file" onClick={() => onOpenFile(file.path)}>
                    <span className="file-action">{getActionIcon(file.action)}</span>
                    <span className="file-path">{file.path}</span>
                  </div>
                ))}
              </div>
            )}
            {step.toolCalls.length > 0 && (
              <details className="step-tools">
                <summary>{step.toolCalls.length} tool calls</summary>
                <pre>{JSON.stringify(step.toolCalls, null, 2)}</pre>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ComposerDiffView({ session, onOpenFile }: { session: ComposerSession; onOpenFile: (path: string) => void }) {
  const allFiles = session.steps.flatMap(step => step.files);

  if (allFiles.length === 0) {
    return (
      <div className="empty-state">
        <p>No file changes yet. Run a step to see diffs.</p>
      </div>
    );
  }

  return (
    <div className="composer-diff-view">
      <div className="file-selector">
        <label>Select file to view diff:</label>
        <select onChange={(e) => {}}>
          {allFiles.map((file, i) => (
            <option key={i} value={file.path}>
              {getActionIcon(file.action)} {file.path}
            </option>
          ))}
        </select>
      </div>
      <div className="diff-preview">
        <pre className="diff-content">
          {allFiles[0].diff || allFiles[0].content || '// No diff available'}
        </pre>
      </div>
    </div>
  );
}

function ComposerFilesView({ session, onOpenFile }: { session: ComposerSession; onOpenFile: (path: string) => void }) {
  const allFiles = session.steps.flatMap(step => step.files);
  const filesByAction = {
    create: allFiles.filter(f => f.action === 'create'),
    modify: allFiles.filter(f => f.action === 'modify'),
    delete: allFiles.filter(f => f.action === 'delete'),
  };

  return (
    <div className="composer-files-view">
      <div className="files-summary">
        <span className="count create">{filesByAction.create.length} new</span>
        <span className="count modify">{filesByAction.modify.length} modified</span>
        <span className="count delete">{filesByAction.delete.length} deleted</span>
      </div>
      <div className="files-tree">
        {['create', 'modify', 'delete'].map(action => {
          const files = filesByAction[action as keyof typeof filesByAction];
          if (files.length === 0) return null;
          return (
            <details key={action} open>
              <summary>{getActionLabel(action)} ({files.length})</summary>
              <ul>
                {files.map((file, i) => (
                  <li key={i} onClick={() => onOpenFile(file.path)}>
                    {file.path}
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </div>
  );
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

function getActionIcon(action: string): string {
  switch (action) {
    case 'create': return '+';
    case 'modify': return '~';
    case 'delete': return '-';
    default: return '?';
  }
}

function getActionLabel(action: string): string {
  switch (action) {
    case 'create': return 'New Files';
    case 'modify': return 'Modified Files';
    case 'delete': return 'Deleted Files';
    default: return action;
  }
}