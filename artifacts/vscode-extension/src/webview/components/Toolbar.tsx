import React from 'react';

interface ToolbarProps {
  connected: boolean;
  project: any;
  isBuilding: boolean;
  buildGoal: string;
  onBuildGoalChange: (value: string) => void;
  onBuildStart: () => void;
  onBuildStop: () => void;
  onSyncFiles: () => void;
  onCreateTerminal: () => void;
  syncStatus: string;
  vscode: any;
}

export function Toolbar({
  connected,
  project,
  isBuilding,
  buildGoal,
  onBuildGoalChange,
  onBuildStart,
  onBuildStop,
  onSyncFiles,
  onCreateTerminal,
  syncStatus,
  vscode
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <div className="project-selector">
          <span className="project-icon">∞</span>
          <select
            className="project-dropdown"
            value={project?.id || ''}
            onChange={(e) => vscode.postMessage({ type: 'select_project', projectId: e.target.value })}
            disabled={!connected}
          >
            <option value="">Select Project...</option>
            {project ? <option value={project.id}>{project.name}</option> : null}
          </select>
        </div>
        <div className={`connection-indicator ${connected ? 'connected' : 'disconnected'}`}>
          <span className="dot"></span>
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      <div className="toolbar-center">
        {isBuilding && (
          <div className="build-progress">
            <div className="progress-bar">
              <div className="progress-fill indeterminate"></div>
            </div>
            <span>Building...</span>
          </div>
        )}
      </div>

      <div className="toolbar-right">
        <button className="btn-icon" onClick={onSyncFiles} title="Sync Files" disabled={syncStatus === 'syncing'}>
          <span className={syncStatus === 'syncing' ? 'spinning' : ''}>⟳</span>
        </button>
        <button className="btn-icon" onClick={onCreateTerminal} title="New Terminal">
          ⌨
        </button>
        <button className="btn-icon" onClick={() => vscode.postMessage({ type: 'refresh' })} title="Refresh">
          ↻
        </button>
      </div>
    </div>
  );
}