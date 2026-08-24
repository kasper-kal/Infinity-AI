import React from 'react';
import { createRoot } from 'react-dom/client';
import { BuildPanel } from './BuildPanel';
import './styles.css';

// This is the entry point for the webview
// It will be bundled by esbuild

// Receive messages from extension host
interface VSCodeAPI {
  postMessage: (msg: any) => void;
  getState: () => any;
  setState: (state: any) => void;
}

declare global {
  interface Window {
    acquireVsCodeApi: () => VSCodeAPI;
  }
}

const vscode = window.acquireVsCodeApi();

interface WebviewMessage {
  type: string;
  [key: string]: any;
}

interface AppState {
  connected: boolean;
  config: any;
  projectRoot: string;
  project: any;
  buildEvents: BuildEvent[];
  terminalSessions: TerminalSession[];
  activeTerminalId: string | null;
  terminalOutput: Map<string, string>;
  diagnostics: Diagnostic[];
  syncStatus: 'idle' | 'syncing' | 'complete' | 'error';
}

interface BuildEvent {
  id: string;
  type: string;
  timestamp: string;
  data: any;
}

interface TerminalSession {
  id: string;
  name: string;
  cwd: string;
  status: 'running' | 'exited' | 'connecting';
}

interface Diagnostic {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  code?: string;
}

let state: AppState = {
  connected: false,
  config: {},
  projectRoot: '',
  project: null,
  buildEvents: [],
  terminalSessions: [],
  activeTerminalId: null,
  terminalOutput: new Map(),
  diagnostics: [],
  syncStatus: 'idle'
};

function updateState(partial: Partial<AppState>) {
  state = { ...state, ...partial };
  render();
}

function addBuildEvent(event: BuildEvent) {
  state = {
    ...state,
    buildEvents: [...state.buildEvents, event].slice(-500)
  };
  render();
}

function appendTerminalOutput(sessionId: string, data: string) {
  const current = state.terminalOutput.get(sessionId) || '';
  state.terminalOutput.set(sessionId, current + data);
  render();
}

const root = createRoot(document.getElementById('root')!);

function render() {
  root.render(
    <React.StrictMode>
      <BuildPanel
        state={state}
        vscode={vscode}
        onUpdateState={updateState}
        onSendMessage={(msg) => vscode.postMessage(msg)}
      />
    </React.StrictMode>
  );
}

// Listen for messages from extension
window.addEventListener('message', (event) => {
  const message = event.data as WebviewMessage;

  switch (message.type) {
    case 'init':
      updateState({
        config: message.config,
        projectRoot: message.projectRoot,
        terminalSessions: message.terminalSessions || [],
        connected: true
      });
      break;

    case 'connection_status':
      updateState({ connected: message.status === 'connected' });
      break;

    case 'project_info':
      updateState({ project: message.project });
      break;

    case 'build_event':
      addBuildEvent({ ...message.event, id: crypto.randomUUID() });
      break;

    case 'terminal_output':
      appendTerminalOutput(message.sessionId, message.data);
      break;

    case 'terminal_sessions':
      updateState({ terminalSessions: message.sessions });
      break;

    case 'diagnostics':
      updateState({ diagnostics: message.diagnostics });
      break;

    case 'sync_complete':
      updateState({ syncStatus: 'complete' });
      setTimeout(() => updateState({ syncStatus: 'idle' }), 2000);
      break;

    case 'mcp_response':
      // Handle MCP responses
      break;
  }
});

// Initial render
render();