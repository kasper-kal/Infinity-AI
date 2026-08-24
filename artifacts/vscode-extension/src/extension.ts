import * as vscode from 'vscode';
import { WebSocket } from 'ws';
import { dirname, join } from 'path';
import { promises as fs } from 'fs';

const __dirname = dirname(require.main?.filename || process.argv[1]);

interface InfinityConfig {
  apiUrl: string;
  projectId: string;
  terminalBridgeUrl: string;
  enableFileSync: boolean;
  showDiagnostics: boolean;
}

interface BuildEvent {
  type: 'build_start' | 'build_step' | 'build_complete' | 'build_error' | 'terminal_output' | 'file_change' | 'diagnostic';
  timestamp: string;
  data: any;
}

interface TerminalSession {
  id: string;
  name: string;
  cwd: string;
  status: 'running' | 'exited' | 'connecting';
}

interface FileChangeEvent {
  path: string;
  type: 'created' | 'modified' | 'deleted';
  content?: string;
  hash?: string;
}

class InfinityBuildProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'infinity-build-view';
  private _view?: vscode.WebviewView;
  private _config: InfinityConfig;
  private _ws?: WebSocket;
  private _terminalWs?: WebSocket;
  private _fileWatcher?: vscode.FileSystemWatcher;
  private _diagnostics: vscode.DiagnosticCollection;
  private _context: vscode.ExtensionContext;
  private _projectRoot: string;
  private _terminalSessions: Map<string, TerminalSession> = new Map();
  private _pendingMessages: Map<string, (data: any) => void> = new Map();
  private _messageId = 0;

  constructor(context: vscode.ExtensionContext, projectRoot: string) {
    this._context = context;
    this._projectRoot = projectRoot;
    this._diagnostics = vscode.languages.createDiagnosticCollection('infinity');
    context.subscriptions.push(this._diagnostics);

    const config = vscode.workspace.getConfiguration('infinity');
    this._config = {
      apiUrl: config.get('apiUrl') || 'http://localhost:3000',
      projectId: config.get('projectId') || '',
      terminalBridgeUrl: config.get('terminalBridgeUrl') || 'ws://localhost:3001',
      enableFileSync: config.get('enableFileSync') ?? true,
      showDiagnostics: config.get('showDiagnostics') ?? true
    };

    this._setupConfigListener();
    this._setupFileWatcher();
    this._connectToApi();
    this._connectTerminalBridge();
  }

  private _setupConfigListener() {
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('infinity')) {
        const config = vscode.workspace.getConfiguration('infinity');
        this._config = {
          apiUrl: config.get('apiUrl') || 'http://localhost:3000',
          projectId: config.get('projectId') || '',
          terminalBridgeUrl: config.get('terminalBridgeUrl') || 'ws://localhost:3001',
          enableFileSync: config.get('enableFileSync') ?? true,
          showDiagnostics: config.get('showDiagnostics') ?? true
        };
        this._reconnect();
      }
    });
  }

  private _setupFileWatcher() {
    if (!this._config.enableFileSync) return;

    this._fileWatcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
    this._fileWatcher.onDidCreate(uri => this._sendFileChange(uri, 'created'));
    this._fileWatcher.onDidChange(uri => this._sendFileChange(uri, 'modified'));
    this._fileWatcher.onDidDelete(uri => this._sendFileChange(uri, 'deleted'));
    this._context.subscriptions.push(this._fileWatcher);
  }

  private async _sendFileChange(uri: vscode.Uri, type: 'created' | 'modified' | 'deleted') {
    try {
      const relativePath = vscode.workspace.asRelativePath(uri);
      let content: string | undefined;
      let hash: string | undefined;

      if (type !== 'deleted') {
        const fileContent = await fs.readFile(uri.fsPath, 'utf-8');
        content = fileContent;
        hash = await this._hashContent(fileContent);
      }

      const event: FileChangeEvent = { path: relativePath, type, content, hash };
      this._sendToApi('file_change', event);
    } catch (err) {
      console.error('Failed to send file change:', err);
    }
  }

  private async _hashContent(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private _connectToApi() {
    const wsUrl = this._config.apiUrl.replace('http', 'ws') + '/api/infinity-ai/extension/ws';
    this._ws = new WebSocket(wsUrl);

    this._ws.on('open', () => {
      console.log('[Infinity] Connected to API server');
      this._sendToApi('init', {
        projectId: this._config.projectId,
        workspaceRoot: this._projectRoot,
        clientVersion: '0.1.0'
      });
      this._updateWebview({ type: 'connection_status', status: 'connected' });
    });

    this._ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this._handleApiMessage(message);
      } catch (err) {
        console.error('[Infinity] Failed to parse API message:', err);
      }
    });

    this._ws.on('error', (err) => {
      console.error('[Infinity] API WebSocket error:', err);
      this._updateWebview({ type: 'connection_status', status: 'error', error: err.message });
    });

    this._ws.on('close', () => {
      console.log('[Infinity] API WebSocket closed');
      this._updateWebview({ type: 'connection_status', status: 'disconnected' });
      setTimeout(() => this._connectToApi(), 5000);
    });
  }

  private _connectTerminalBridge() {
    const wsUrl = this._config.terminalBridgeUrl + '?client=vscode-extension';
    this._terminalWs = new WebSocket(wsUrl);

    this._terminalWs.on('open', () => {
      console.log('[Infinity] Connected to terminal bridge');
    });

    this._terminalWs.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this._handleTerminalMessage(message);
      } catch (err) {
        console.error('[Infinity] Failed to parse terminal message:', err);
      }
    });

    this._terminalWs.on('error', (err) => {
      console.error('[Infinity] Terminal bridge error:', err);
    });

    this._terminalWs.on('close', () => {
      console.log('[Infinity] Terminal bridge closed');
      setTimeout(() => this._connectTerminalBridge(), 5000);
    });
  }

  private _handleApiMessage(message: any) {
    switch (message.type) {
      case 'init_response':
        if (message.projectId && !this._config.projectId) {
          this._config.projectId = message.projectId;
          vscode.workspace.getConfiguration('infinity').update('projectId', message.projectId, true);
        }
        this._updateWebview({ type: 'project_info', project: message.project });
        break;

      case 'build_event':
        this._handleBuildEvent(message.event);
        break;

      case 'terminal_output':
        this._updateWebview({ type: 'terminal_output', sessionId: message.sessionId, data: message.data });
        break;

      case 'terminal_session_created':
        this._terminalSessions.set(message.session.id, message.session);
        this._updateWebview({ type: 'terminal_sessions', sessions: Array.from(this._terminalSessions.values()) });
        break;

      case 'terminal_session_closed':
        this._terminalSessions.delete(message.sessionId);
        this._updateWebview({ type: 'terminal_sessions', sessions: Array.from(this._terminalSessions.values()) });
        break;

      case 'diagnostics':
        if (this._config.showDiagnostics) {
          this._updateDiagnostics(message.diagnostics);
        }
        break;

      case 'file_sync':
        this._handleFileSync(message.files);
        break;

      case 'pong':
        break;

      default:
        console.log('[Infinity] Unknown message type:', message.type);
    }

    // Check for pending request responses
    if (message.id && this._pendingMessages.has(message.id)) {
      const resolve = this._pendingMessages.get(message.id)!;
      this._pendingMessages.delete(message.id);
      resolve(message);
    }
  }

  private _handleTerminalMessage(message: any) {
    switch (message.type) {
      case 'output':
        this._updateWebview({ type: 'terminal_output', sessionId: message.sessionId, data: message.data });
        break;
      case 'session_created':
        this._terminalSessions.set(message.session.id, message.session);
        this._updateWebview({ type: 'terminal_sessions', sessions: Array.from(this._terminalSessions.values()) });
        break;
      case 'session_closed':
        this._terminalSessions.delete(message.sessionId);
        this._updateWebview({ type: 'terminal_sessions', sessions: Array.from(this._terminalSessions.values()) });
        break;
      case 'mcp_response':
        this._updateWebview({ type: 'mcp_response', requestId: message.requestId, result: message.result });
        break;
    }
  }

  private _handleBuildEvent(event: BuildEvent) {
    this._updateWebview({ type: 'build_event', event });

    if (event.type === 'diagnostic' && this._config.showDiagnostics) {
      this._updateDiagnostics([event.data]);
    }
  }

  private _updateDiagnostics(diagnostics: any[]) {
    const diagnosticMap = new Map<string, vscode.Diagnostic[]>();

    for (const d of diagnostics) {
      const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, d.file);
      const range = new vscode.Range(
        d.line - 1, d.column || 0,
        d.endLine ? d.endLine - 1 : d.line - 1,
        d.endColumn || 0
      );

      const diagnostic = new vscode.Diagnostic(
        range,
        d.message,
        this._mapSeverity(d.severity)
      );
      diagnostic.source = 'Infinity';
      diagnostic.code = d.code;

      const existing = diagnosticMap.get(uri.fsPath) || [];
      existing.push(diagnostic);
      diagnosticMap.set(uri.fsPath, existing);
    }

    for (const [file, diags] of diagnosticMap) {
      this._diagnostics.set(vscode.Uri.file(file), diags);
    }
  }

  private _mapSeverity(severity: string): vscode.DiagnosticSeverity {
    switch (severity) {
      case 'error': return vscode.DiagnosticSeverity.Error;
      case 'warning': return vscode.DiagnosticSeverity.Warning;
      case 'info': return vscode.DiagnosticSeverity.Information;
      case 'hint': return vscode.DiagnosticSeverity.Hint;
      default: return vscode.DiagnosticSeverity.Information;
    }
  }

  private async _handleFileSync(files: any[]) {
    for (const file of files) {
      const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, file.path);

      if (file.type === 'deleted') {
        try {
          await vscode.workspace.fs.delete(uri);
        } catch {}
      } else {
        const content = Buffer.from(file.content, 'utf-8');
        await vscode.workspace.fs.writeFile(uri, content);
      }
    }

    this._updateWebview({ type: 'file_sync_complete', count: files.length });
  }

  private _sendToApi(type: string, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected to API'));
        return;
      }

      const id = String(++this._messageId);
      this._pendingMessages.set(id, resolve);

      this._ws.send(JSON.stringify({ id, type, data }));

      setTimeout(() => {
        if (this._pendingMessages.has(id)) {
          this._pendingMessages.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  private _sendToTerminal(type: string, data: any) {
    if (this._terminalWs && this._terminalWs.readyState === WebSocket.OPEN) {
      this._terminalWs.send(JSON.stringify({ type, data }));
    }
  }

  private _reconnect() {
    if (this._ws) {
      this._ws.close();
    }
    if (this._terminalWs) {
      this._terminalWs.close();
    }
    this._connectToApi();
    this._connectTerminalBridge();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._context.extensionUri, 'media'),
        vscode.Uri.joinPath(this._context.extensionUri, 'dist')
      ]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this._handleWebviewMessage(message);
    });

    // Send initial state
    this._updateWebview({
      type: 'init',
      config: this._config,
      projectRoot: this._projectRoot,
      terminalSessions: Array.from(this._terminalSessions.values())
    });
  }

  private async _handleWebviewMessage(message: any) {
    switch (message.type) {
      case 'build_start':
        await this._sendToApi('build_start', message.payload);
        break;

      case 'build_stop':
        await this._sendToApi('build_stop', message.payload);
        break;

      case 'terminal_create':
        this._sendToTerminal('create_session', message.payload);
        break;

      case 'terminal_input':
        this._sendToTerminal('input', { sessionId: message.sessionId, data: message.data });
        break;

      case 'terminal_resize':
        this._sendToTerminal('resize', { sessionId: message.sessionId, cols: message.cols, rows: message.rows });
        break;

      case 'terminal_close':
        this._sendToTerminal('close', { sessionId: message.sessionId });
        break;

      case 'send_to_infinity':
        await this._sendToApi('chat', { message: message.message, files: message.files });
        break;

      case 'sync_files':
        await this._syncWorkspaceFiles();
        break;

      case 'open_file':
        await this._openFile(message.path);
        break;

      case 'reveal_in_explorer':
        await this._revealInExplorer(message.path);
        break;

      case 'run_terminal_command':
        this._sendToTerminal('run_command', {
          sessionId: message.sessionId,
          command: message.command
        });
        break;
    }
  }

  private async _syncWorkspaceFiles() {
    if (!vscode.workspace.workspaceFolders) return;

    const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
    const fileData = [];

    for (const file of files.slice(0, 100)) { // Limit to 100 files
      try {
        const content = await fs.readFile(file.fsPath, 'utf-8');
        const relativePath = vscode.workspace.asRelativePath(file);
        fileData.push({ path: relativePath, content, hash: await this._hashContent(content) });
      } catch {}
    }

    await this._sendToApi('sync_files', { files: fileData });
    this._updateWebview({ type: 'sync_complete', count: fileData.length });
  }

  private async _openFile(path: string) {
    const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, path);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  }

  private async _revealInExplorer(path: string) {
    const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, path);
    await vscode.commands.executeCommand('revealInExplorer', uri);
  }

  private _updateWebview(message: any) {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'dist', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'dist', 'webview.css'));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">
  <link href="${styleUri}" rel="stylesheet">
  <title>Infinity Build</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  public dispose() {
    if (this._ws) this._ws.close();
    if (this._terminalWs) this._terminalWs.close();
    if (this._fileWatcher) this._fileWatcher.dispose();
    this._diagnostics.dispose();
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function activate(context: vscode.ExtensionContext) {
  console.log('[Infinity] Extension activating...');

  if (!vscode.workspace.workspaceFolders) {
    vscode.window.showWarningMessage('Infinity Build requires a workspace folder to be open.');
    return;
  }

  const projectRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const provider = new InfinityBuildProvider(context, projectRoot);

  // Register webview view provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(InfinityBuildProvider.viewType, provider)
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('infinity.build.open', () => {
      vscode.commands.executeCommand('workbench.view.extension.infinity');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('infinity.build.sendToInfinity', async (uri?: vscode.Uri) => {
      const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
      if (!targetUri) {
        vscode.window.showWarningMessage('No file selected to send to Infinity');
        return;
      }

      const content = await fs.readFile(targetUri.fsPath, 'utf-8');
      const relativePath = vscode.workspace.asRelativePath(targetUri);

      provider['_sendToApi']('chat', {
        message: `Please review this file: ${relativePath}`,
        files: [{ path: relativePath, content }]
      }).then(() => {
        vscode.window.showInformationMessage(`Sent ${relativePath} to Infinity Build`);
      }).catch(err => {
        vscode.window.showErrorMessage(`Failed to send to Infinity: ${err.message}`);
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('infinity.build.openTerminal', () => {
      provider['_sendToTerminal']('create_session', { name: 'vscode-terminal', cwd: projectRoot });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('infinity.build.syncFiles', () => {
      provider['_syncWorkspaceFiles']();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('infinity.build.refresh', () => {
      provider['_reconnect']();
      vscode.window.showInformationMessage('Infinity Build refreshed');
    })
  );

  // Set context for keybindings
  vscode.commands.executeCommand('setContext', 'inBuildPanel', false);

  context.subscriptions.push({
    dispose: () => provider.dispose()
  });

  console.log('[Infinity] Extension activated successfully');
}

export function deactivate() {
  console.log('[Infinity] Extension deactivating...');
}