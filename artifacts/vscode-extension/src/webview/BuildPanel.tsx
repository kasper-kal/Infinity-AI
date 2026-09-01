import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Terminal } from './components/Terminal';
import { BuildEvents } from './components/BuildEvents';
import { ProjectInfo } from './components/ProjectInfo';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { Toolbar } from './components/Toolbar';
import { TabBar, Tab } from './components/TabBar';
import { ChatSidebar } from './components/ChatSidebar';
import { ComposerPanel } from './components/ComposerPanel';
import { AgentView } from './components/AgentView';
import { TabAutocomplete } from './components/TabAutocomplete';
import { RulesNotepadsPanel } from './components/RulesNotepadsPanel';

interface BuildPanelProps {
  state: any;
  vscode: any;
  onUpdateState: (partial: any) => void;
  onSendMessage: (msg: any) => void;
}

export function BuildPanel({ state, vscode, onUpdateState, onSendMessage }: BuildPanelProps) {
  const [activeTab, setActiveTab] = useState<'build' | 'terminal' | 'diagnostics' | 'settings' | 'chat' | 'composer' | 'agent' | 'tab-autocomplete' | 'rules-notepads'>('build');
  const [buildGoal, setBuildGoal] = useState('');
  const [isBuilding, setIsBuilding] = useState(false);
  const terminalRef = useRef<any>(null);

  const handleBuildStart = useCallback(async () => {
    if (!buildGoal.trim()) return;
    setIsBuilding(true);
    onSendMessage({ type: 'build_start', payload: { goal: buildGoal } });
  }, [buildGoal, onSendMessage]);

  const handleBuildStop = useCallback(() => {
    setIsBuilding(false);
    onSendMessage({ type: 'build_stop', payload: {} });
  }, [onSendMessage]);

  const handleSendToInfinity = useCallback(async (message: string, files?: any[]) => {
    onSendMessage({ type: 'send_to_infinity', message, files });
  }, [onSendMessage]);

  const handleSyncFiles = useCallback(() => {
    onUpdateState({ syncStatus: 'syncing' });
    onSendMessage({ type: 'sync_files' });
  }, [onUpdateState, onSendMessage]);

  const handleCreateTerminal = useCallback(() => {
    onSendMessage({ type: 'terminal_create', payload: { name: `terminal-${Date.now()}`, cwd: state.projectRoot } });
  }, [onSendMessage, state.projectRoot]);

  const handleTerminalInput = useCallback((sessionId: string, data: string) => {
    onSendMessage({ type: 'terminal_input', sessionId, data });
  }, [onSendMessage]);

  const handleTerminalResize = useCallback((sessionId: string, cols: number, rows: number) => {
    onSendMessage({ type: 'terminal_resize', sessionId, cols, rows });
  }, [onSendMessage]);

  const handleCloseTerminal = useCallback((sessionId: string) => {
    onSendMessage({ type: 'terminal_close', sessionId });
  }, [onSendMessage]);

  const handleRunCommand = useCallback((sessionId: string, command: string) => {
    onSendMessage({ type: 'run_terminal_command', sessionId, command });
  }, [onSendMessage]);

  const handleOpenFile = useCallback((path: string) => {
    onSendMessage({ type: 'open_file', path });
  }, [onSendMessage]);

  const connected = state.connected;
  const project = state.project;

  return (
    <div className="infinity-build-panel">
      <Toolbar
        connected={connected}
        project={project}
        isBuilding={isBuilding}
        buildGoal={buildGoal}
        onBuildGoalChange={setBuildGoal}
        onBuildStart={handleBuildStart}
        onBuildStop={handleBuildStop}
        onSyncFiles={handleSyncFiles}
        onCreateTerminal={handleCreateTerminal}
        syncStatus={state.syncStatus}
        vscode={vscode}
      />

      <TabBar activeTab={activeTab} onTabChange={(tab: string) => setActiveTab(tab as 'build' | 'terminal' | 'diagnostics' | 'settings' | 'chat' | 'composer' | 'agent' | 'tab-autocomplete' | 'rules-notepads')}>
        <Tab id="build" label="Build" icon="▦">
          <div className="tab-content build-tab">
            <ProjectInfo project={project} projectRoot={state.projectRoot} />
            <div className="build-section">
              <h3>Build Goal</h3>
              <textarea
                className="build-goal-input"
                value={buildGoal}
                onChange={(e) => setBuildGoal(e.target.value)}
                placeholder="Describe what you want to build..."
                rows={4}
                disabled={isBuilding}
              />
              <div className="build-actions">
                <button className="btn primary" onClick={handleBuildStart} disabled={isBuilding || !buildGoal.trim()}>
                  {isBuilding ? 'Building...' : 'Start Build'}
                </button>
                <button className="btn secondary" onClick={handleBuildStop} disabled={!isBuilding}>
                  Stop Build
                </button>
              </div>
            </div>
            <BuildEvents events={state.buildEvents} onOpenFile={handleOpenFile} vscode={vscode} />
          </div>
        </Tab>

        <Tab id="terminal" label="Terminal" icon="⌨">
          <div className="tab-content terminal-tab">
            <Terminal
              sessions={state.terminalSessions}
              activeSessionId={state.activeTerminalId}
              terminalOutput={state.terminalOutput}
              onSessionChange={(id) => onUpdateState({ activeTerminalId: id })}
              onInput={handleTerminalInput}
              onResize={handleTerminalResize}
              onClose={handleCloseTerminal}
              onRunCommand={handleRunCommand}
              onCreateSession={handleCreateTerminal}
            />
          </div>
        </Tab>

        <Tab id="diagnostics" label="Diagnostics" icon="⚠">
          <div className="tab-content diagnostics-tab">
            <DiagnosticsPanel
              diagnostics={state.diagnostics}
              onOpenFile={handleOpenFile}
            />
          </div>
        </Tab>

        <Tab id="settings" label="Settings" icon="⚙">
          <div className="tab-content settings-tab">
            <SettingsPanel
              config={state.config}
              onConfigChange={(cfg) => {
                onUpdateState({ config: { ...state.config, ...cfg } });
                vscode.postMessage({ type: 'update_config', config: cfg });
              }}
              vscode={vscode}
            />
          </div>
        </Tab>

        <Tab id="chat" label="Chat" icon="💬">
          <div className="tab-content chat-tab">
            <ChatSidebar
              vscode={vscode}
              onSendMessage={onSendMessage}
              projectRoot={state.projectRoot}
              connected={state.connected}
            />
          </div>
        </Tab>

        <Tab id="composer" label="Composer" icon="🎼">
          <div className="tab-content composer-tab">
            <ComposerPanel
              vscode={vscode}
              onSendMessage={onSendMessage}
              projectRoot={state.projectRoot}
              connected={state.connected}
            />
          </div>
        </Tab>

        <Tab id="agent" label="Agent" icon="🤖">
          <div className="tab-content agent-tab">
            <AgentView
              vscode={vscode}
              onSendMessage={onSendMessage}
              projectRoot={state.projectRoot}
              connected={state.connected}
            />
          </div>
        </Tab>

        <Tab id="tab-autocomplete" label="Tab" icon="⇥">
          <div className="tab-content tab-autocomplete-tab">
            <TabAutocomplete
              vscode={vscode}
              onSendMessage={onSendMessage}
              projectRoot={state.projectRoot}
              connected={state.connected}
            />
          </div>
        </Tab>

        <Tab id="rules-notepads" label="Rules" icon="📋">
          <div className="tab-content rules-notepads-tab">
            <RulesNotepadsPanel
              vscode={vscode}
              onSendMessage={onSendMessage}
              projectRoot={state.projectRoot}
              connected={state.connected}
            />
          </div>
        </Tab>
      </TabBar>

      <div className="status-bar">
        <span className={connected ? 'status-connected' : 'status-disconnected'}>
          {connected ? '● Connected' : '○ Disconnected'}
        </span>
        <span className="divider">|</span>
        <span>Project: {project?.name || 'Not selected'}</span>
        <span className="divider">|</span>
        <span>{state.buildEvents.length} events</span>
        {state.syncStatus !== 'idle' && (
          <>
            <span className="divider">|</span>
            <span className="sync-status">{state.syncStatus}</span>
          </>
        )}
      </div>
    </div>
  );
}

function SettingsPanel({ config, onConfigChange, vscode }: { config: any; onConfigChange: (cfg: any) => void; vscode: any }) {
  return (
    <div className="settings-panel">
      <h3>Infinity Build Settings</h3>
      <div className="setting-group">
        <label>API Server URL</label>
        <input
          type="text"
          value={config.apiUrl || 'http://localhost:3000'}
          onChange={(e) => onConfigChange({ apiUrl: e.target.value })}
          placeholder="http://localhost:3000"
        />
      </div>
      <div className="setting-group">
        <label>Project ID</label>
        <input
          type="text"
          value={config.projectId || ''}
          onChange={(e) => onConfigChange({ projectId: e.target.value })}
          placeholder="Auto-detected if empty"
        />
      </div>
      <div className="setting-group">
        <label>Terminal Bridge URL</label>
        <input
          type="text"
          value={config.terminalBridgeUrl || 'ws://localhost:3001'}
          onChange={(e) => onConfigChange({ terminalBridgeUrl: e.target.value })}
          placeholder="ws://localhost:3001"
        />
      </div>
      <div className="setting-group checkbox">
        <label>
          <input
            type="checkbox"
            checked={config.enableFileSync !== false}
            onChange={(e) => onConfigChange({ enableFileSync: e.target.checked })}
          />
          Enable File Sync
        </label>
      </div>
      <div className="setting-group checkbox">
        <label>
          <input
            type="checkbox"
            checked={config.showDiagnostics !== false}
            onChange={(e) => onConfigChange({ showDiagnostics: e.target.checked })}
          />
          Show Diagnostics in Problems Panel
        </label>
      </div>
      <div className="setting-actions">
        <button className="btn secondary" onClick={() => vscode.postMessage({ type: 'refresh' })}>
          Refresh Connection
        </button>
      </div>
    </div>
  );
}

// Need to access vscode in SettingsPanel - will fix with context or prop
const vscode = window.acquireVsCodeApi ? window.acquireVsCodeApi() : { postMessage: () => {} };