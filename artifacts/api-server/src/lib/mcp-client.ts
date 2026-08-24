/**
 * MCP Client Library — Browser-native MCP client for Infinity
 *
 * Connects to any MCP server (local via terminal bridge, remote via HTTP/SSE, WebSocket).
 * Implements the Model Context Protocol specification for tool discovery, resource access, and prompt management.
 */

import { EventEmitter } from 'events';
import { UniversalToolDefinition, ToolExecutionContext } from './tool-types.js';

// ============================================================================
// Types (based on MCP spec: https://spec.modelcontextprotocol.io/)
// ============================================================================

export type MCPTransportType = 'stdio' | 'stdio-direct' | 'http' | 'sse' | 'websocket';

export interface MCPTransportConfig {
  type: MCPTransportType;
  // stdio (via terminal bridge)
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  bridgeSecret?: string;
  bridgeHost?: string;
  bridgePort?: number;
  // HTTP/SSE
  url?: string;
  headers?: Record<string, string>;
  // WebSocket
  wsUrl?: string;
  // Common
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export interface MCPServerInfo {
  name: string;
  version: string;
  protocolVersion: string;
  capabilities: MCPCapabilities;
}

export interface MCPCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: {};
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  outputSchema?: {
    type: 'object';
    properties: Record<string, unknown>;
  };
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
    resource?: { uri: string; mimeType?: string };
  }>;
  isError?: boolean;
}

export interface MCPResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string; // base64
}

export interface MCPPromptResult {
  description?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: {
      type: 'text' | 'image' | 'resource';
      text?: string;
      data?: string;
      mimeType?: string;
      resource?: { uri: string; mimeType?: string };
    };
  }>;
}

// JSON-RPC 2.0 types
interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

// ============================================================================
// Transport Interface
// ============================================================================

interface MCPTransport extends EventEmitter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: JSONRPCRequest): Promise<JSONRPCResponse>;
  notify(message: JSONRPCNotification): void;
  isConnected(): boolean;
}

// ============================================================================
// HTTP+SSE Transport
// ============================================================================

class HTTPTransport extends EventEmitter implements MCPTransport {
  private config: Required<MCPTransportConfig>;
  private connected = false;
  private eventSource: EventSource | null = null;
  private pendingRequests = new Map<string | number, {
    resolve: (value: JSONRPCResponse) => void;
    reject: (reason: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private requestId = 0;

  constructor(config: MCPTransportConfig) {
    super();
    this.config = {
      type: 'http',
      url: config.url || '',
      headers: config.headers || {},
      timeout: config.timeout ?? 30000,
      retryAttempts: config.retryAttempts ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      command: '',
      args: [],
      env: {},
      bridgeSecret: '',
      bridgeHost: '',
      bridgePort: 0,
      wsUrl: '',
    };
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    // Initialize SSE connection for server-to-client messages
    // Note: EventSource doesn't support custom headers, so we use fetch with ReadableStream for headers
    const sseUrl = this.config.url.replace(/\/$/, '') + '/sse';

    // For SSE with headers, we need to use fetch + ReadableStream
    const response = await fetch(sseUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        ...this.config.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`SSE connection failed: ${response.status}`);
    }

    this.eventSource = new EventSource(sseUrl);

    this.eventSource.onopen = () => {
      this.connected = true;
      this.emit('connected');
    };

    this.eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as JSONRPCMessage;
        this.handleMessage(message);
      } catch (err) {
        console.error('[MCP HTTP] Failed to parse SSE message:', err);
      }
    };

    this.eventSource.onerror = (err) => {
      console.error('[MCP HTTP] SSE error:', err);
      this.connected = false;
      this.emit('error', err);
      this.reconnect();
    };

    // Wait for connection or timeout
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('HTTP transport connection timeout'));
      }, this.config.timeout);

      this.once('connected', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private async reconnect(): Promise<void> {
    for (let i = 0; i < this.config.retryAttempts; i++) {
      await new Promise(r => setTimeout(r, this.config.retryDelay * (i + 1)));
      try {
        await this.connect();
        return;
      } catch {
        // Continue retrying
      }
    }
    this.emit('error', new Error('Max reconnection attempts reached'));
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Transport disconnected'));
    }
    this.pendingRequests.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async send(message: JSONRPCRequest): Promise<JSONRPCResponse> {
    if (!this.connected) {
      throw new Error('Transport not connected');
    }

    return new Promise((resolve, reject) => {
      const id = message.id;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, this.config.timeout);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify(message),
      }).catch(err => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(err);
      });
    });
  }

  notify(message: JSONRPCNotification): void {
    if (!this.connected) return;
    fetch(this.config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      body: JSON.stringify(message),
    }).catch(err => console.error('[MCP HTTP] Notify failed:', err));
  }

  private handleMessage(message: JSONRPCMessage): void {
    if ('id' in message && message.id !== undefined) {
      // Response to our request
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);
        if ('error' in message && message.error) {
          pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
        } else {
          pending.resolve(message as JSONRPCResponse);
        }
      }
    } else if ('method' in message) {
      // Notification from server
      this.emit('notification', message);
    }
  }
}

// ============================================================================
// WebSocket Transport
// ============================================================================

class WebSocketTransport extends EventEmitter implements MCPTransport {
  private config: Required<MCPTransportConfig>;
  private ws: WebSocket | null = null;
  private connected = false;
  private pendingRequests = new Map<string | number, {
    resolve: (value: JSONRPCResponse) => void;
    reject: (reason: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private requestId = 0;
  private reconnectAttempts = 0;

  constructor(config: MCPTransportConfig) {
    super();
    this.config = {
      type: 'websocket',
      wsUrl: config.wsUrl || '',
      headers: config.headers || {},
      timeout: config.timeout ?? 30000,
      retryAttempts: config.retryAttempts ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      command: '',
      args: [],
      env: {},
      bridgeSecret: '',
      bridgeHost: '',
      bridgePort: 0,
      url: '',
    };
  }

  async connect(): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) return;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.wsUrl);

        this.ws.onopen = () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          this.emit('connected');
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as JSONRPCMessage;
            this.handleMessage(message);
          } catch (err) {
            console.error('[MCP WS] Failed to parse message:', err);
          }
        };

        this.ws.onclose = (event) => {
          this.connected = false;
          this.emit('disconnected', event.code, event.reason);
          if (event.code !== 1000) { // Not intentional close
            this.reconnect();
          }
        };

        this.ws.onerror = (err) => {
          console.error('[MCP WS] WebSocket error:', err);
          this.emit('error', err);
          if (!this.connected) {
            reject(err);
          }
        };

        // Connection timeout
        setTimeout(() => {
          if (!this.connected) {
            this.ws?.close();
            reject(new Error('WebSocket connection timeout'));
          }
        }, this.config.timeout);
      } catch (err) {
        reject(err);
      }
    });
  }

  private async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.config.retryAttempts) {
      this.emit('error', new Error('Max reconnection attempts reached'));
      return;
    }
    this.reconnectAttempts++;
    await new Promise(r => setTimeout(r, this.config.retryDelay * this.reconnectAttempts));
    try {
      await this.connect();
    } catch {
      // Retry handled by reconnect logic
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Transport disconnected'));
    }
    this.pendingRequests.clear();
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  async send(message: JSONRPCRequest): Promise<JSONRPCResponse> {
    if (!this.isConnected()) {
      throw new Error('WebSocket not connected');
    }

    return new Promise((resolve, reject) => {
      const id = message.id;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, this.config.timeout);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.ws!.send(JSON.stringify(message));
    });
  }

  notify(message: JSONRPCNotification): void {
    if (this.isConnected()) {
      this.ws!.send(JSON.stringify(message));
    }
  }

  private handleMessage(message: JSONRPCMessage): void {
    if ('id' in message && message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);
        if ('error' in message && message.error) {
          pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
        } else {
          pending.resolve(message as JSONRPCResponse);
        }
      }
    } else if ('method' in message) {
      this.emit('notification', message);
    }
  }
}

// ============================================================================
// Stdio Transport (via Terminal Bridge)
// ============================================================================

class StdioTransport extends EventEmitter implements MCPTransport {
  private config: Required<MCPTransportConfig>;
  private connected = false;
  private sessionId: string | null = null;
  private pendingRequests = new Map<string | number, {
    resolve: (value: JSONRPCResponse) => void;
    reject: (reason: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private requestId = 0;
  private bridgeWs: WebSocket | null = null;

  constructor(config: MCPTransportConfig) {
    super();
    this.config = {
      type: 'stdio-direct',
      command: config.command || '',
      args: config.args || [],
      env: config.env || {},
      bridgeSecret: config.bridgeSecret || '',
      bridgeHost: config.bridgeHost || '127.0.0.1',
      bridgePort: config.bridgePort || 3001,
      timeout: config.timeout ?? 30000,
      retryAttempts: config.retryAttempts ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      url: '',
      headers: {},
      wsUrl: '',
    };
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    // Connect to terminal bridge WebSocket
    const wsUrl = `ws://${this.config.bridgeHost}:${this.config.bridgePort}?secret=${encodeURIComponent(this.config.bridgeSecret)}`;
    this.bridgeWs = new WebSocket(wsUrl);

    return new Promise((resolve, reject) => {
      const connectTimeout = setTimeout(() => {
        reject(new Error('Terminal bridge connection timeout'));
      }, this.config.timeout);

      this.bridgeWs!.onopen = () => {
        clearTimeout(connectTimeout);
        console.log('[MCP Stdio] Connected to terminal bridge');

        // Send mcp_connect to spawn the MCP server process
        const connectMsg = {
          type: 'mcp_connect',
          payload: {
            command: this.config.command,
            args: this.config.args,
            env: this.config.env,
            secret: this.config.bridgeSecret,
          },
        };

        this.bridgeWs!.send(JSON.stringify(connectMsg));
      };

      this.bridgeWs!.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleBridgeMessage(message);
        } catch (err) {
          console.error('[MCP Stdio] Failed to parse bridge message:', err);
        }
      };

      this.bridgeWs!.onclose = () => {
        this.connected = false;
        this.sessionId = null;
        this.emit('disconnected');
      };

      this.bridgeWs!.onerror = (err) => {
        clearTimeout(connectTimeout);
        console.error('[MCP Stdio] Bridge WebSocket error:', err);
        reject(err);
      };
    });
  }

  private handleBridgeMessage(message: {
    type: string;
    sessionId?: string;
    payload?: unknown;
  }): void {
    switch (message.type) {
      case 'mcp_response': {
        const payload = message.payload as { connected?: boolean; mcpId?: string } | string;
        if (typeof payload === 'object' && payload?.connected && payload.mcpId) {
          this.sessionId = payload.mcpId;
          this.connected = true;
          this.emit('connected');
        }
        break;
      }
      case 'mcp_error': {
        console.error('[MCP Stdio] MCP connection error:', message.payload);
        this.emit('error', new Error(typeof message.payload === 'string' ? message.payload : 'MCP connection failed'));
        break;
      }
      default:
        // Check if it's a JSON-RPC response from the MCP server
        if (message.sessionId === this.sessionId && message.payload) {
          try {
            const rpcMessage = message.payload as JSONRPCMessage;
            this.handleRPCMessage(rpcMessage);
          } catch {
            // Not a JSON-RPC message, ignore
          }
        }
    }
  }

  private handleRPCMessage(message: JSONRPCMessage): void {
    if ('id' in message && message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);
        if ('error' in message && message.error) {
          pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
        } else {
          pending.resolve(message as JSONRPCResponse);
        }
      }
    } else if ('method' in message) {
      this.emit('notification', message);
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.bridgeWs && this.sessionId) {
      this.bridgeWs.send(JSON.stringify({
        type: 'close',
        sessionId: this.sessionId,
      }));
    }
    if (this.bridgeWs) {
      this.bridgeWs.close(1000, 'Client disconnect');
      this.bridgeWs = null;
    }
    this.sessionId = null;
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Transport disconnected'));
    }
    this.pendingRequests.clear();
  }

  isConnected(): boolean {
    return this.connected && this.bridgeWs?.readyState === WebSocket.OPEN;
  }

  async send(message: JSONRPCRequest): Promise<JSONRPCResponse> {
    if (!this.isConnected() || !this.sessionId) {
      throw new Error('Stdio transport not connected');
    }

    return new Promise((resolve, reject) => {
      const id = message.id;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, this.config.timeout);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.bridgeWs!.send(JSON.stringify({
        type: 'mcp_request',
        payload: {
          mcpId: this.sessionId,
          request: message,
        },
      }));
    });
  }

  notify(message: JSONRPCNotification): void {
    if (this.isConnected() && this.sessionId) {
      this.bridgeWs!.send(JSON.stringify({
        type: 'mcp_request',
        payload: {
          mcpId: this.sessionId,
          request: message,
        },
      }));
    }
  }
}

// ============================================================================
// Direct Stdio Transport (spawns process directly, no terminal bridge needed)
// ============================================================================

class DirectStdioTransport extends EventEmitter implements MCPTransport {
  private config: Required<MCPTransportConfig>;
  private connected = false;
  private process: ReturnType<typeof import('child_process').spawn> | null = null;
  private buffer = '';
  private pendingRequests = new Map<string | number, {
    resolve: (value: JSONRPCResponse) => void;
    reject: (reason: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private requestId = 0;

  constructor(config: MCPTransportConfig) {
    super();
    this.config = {
      type: 'stdio-direct',
      command: config.command || '',
      args: config.args || [],
      env: config.env || {},
      bridgeSecret: '',
      bridgeHost: '',
      bridgePort: 0,
      timeout: config.timeout ?? 30000,
      retryAttempts: config.retryAttempts ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      url: '',
      headers: {},
      wsUrl: '',
    };
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const proc = spawn(this.config.command, this.config.args, {
        env: { ...process.env, ...this.config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.process = proc;

      proc.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        console.error('[MCP Direct Stdio stderr]:', data.toString());
      });

      proc.on('error', (err: Error) => {
        console.error('[MCP Direct Stdio process error]:', err);
        this.emit('error', err);
        if (!this.connected) reject(err);
      });

      proc.on('close', (code: number) => {
        this.connected = false;
        this.emit('disconnected', code);
      });

      // Wait a bit for process to start, then send initialize
      setTimeout(() => {
        this.connected = true;
        this.emit('connected');
        resolve();
      }, 500);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line) as JSONRPCResponse;
          this.handleMessage(message);
        } catch (err) {
          console.error('[MCP Direct Stdio] Failed to parse:', line, err);
        }
      }
    }
  }

  private handleMessage(message: JSONRPCResponse): void {
    if ('id' in message && message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
        } else {
          pending.resolve(message);
        }
      }
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Transport disconnected'));
    }
    this.pendingRequests.clear();
  }

  isConnected(): boolean {
    return this.connected && this.process !== null;
  }

  async send(message: JSONRPCRequest): Promise<JSONRPCResponse> {
    if (!this.isConnected() || !this.process?.stdin) {
      throw new Error('Direct stdio transport not connected');
    }

    return new Promise((resolve, reject) => {
      const id = message.id;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, this.config.timeout);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.process!.stdin!.write(JSON.stringify(message) + '\n');
    });
  }

  notify(message: JSONRPCNotification): void {
    if (this.isConnected() && this.process?.stdin) {
      this.process.stdin.write(JSON.stringify({ ...message, jsonrpc: '2.0' }) + '\n');
    }
  }
}

// ============================================================================
// MCP Client
// ============================================================================

export interface MCPClientConfig {
  transport: MCPTransportConfig;
  name?: string;
  version?: string;
}

export class MCPClient extends EventEmitter {
  private config: MCPClientConfig;
  private transport: MCPTransport;
  private serverInfo: MCPServerInfo | null = null;
  private tools: MCPTool[] = [];
  private resources: MCPResource[] = [];
  private prompts: MCPPrompt[] = [];
  private requestId = 0;

  constructor(config: MCPClientConfig) {
    super();
    this.config = {
      name: config.name || 'infinity-mcp-client',
      version: config.version || '1.0.0',
      transport: config.transport,
    };
    this.transport = this.createTransport(config.transport);
    this.setupTransportListeners();
  }

  private createTransport(config: MCPTransportConfig): MCPTransport {
    switch (config.type) {
      case 'http':
      case 'sse':
        return new HTTPTransport(config);
      case 'websocket':
        return new WebSocketTransport(config);
      case 'stdio':
        return new StdioTransport(config);
      case 'stdio-direct':
        return new DirectStdioTransport(config);
      default:
        throw new Error(`Unknown transport type: ${config.type}`);
    }
  }

  private setupTransportListeners(): void {
    this.transport.on('connected', () => {
      this.emit('connected');
    });
    this.transport.on('disconnected', (...args) => {
      this.emit('disconnected', ...args);
    });
    this.transport.on('error', (err) => {
      this.emit('error', err);
    });
    this.transport.on('notification', (notification: JSONRPCNotification) => {
      this.handleNotification(notification);
    });
  }

  private handleNotification(notification: JSONRPCNotification): void {
    switch (notification.method) {
      case 'notifications/tools/list_changed':
        this.emit('toolsChanged');
        break;
      case 'notifications/resources/list_changed':
        this.emit('resourcesChanged');
        break;
      case 'notifications/resources/updated':
        this.emit('resourceUpdated', notification.params);
        break;
      case 'notifications/prompts/list_changed':
        this.emit('promptsChanged');
        break;
      case 'notifications/message':
        this.emit('logMessage', notification.params);
        break;
      default:
        this.emit('notification', notification);
    }
  }

  private nextRequestId(): string | number {
    return ++this.requestId;
  }

  async connect(): Promise<MCPServerInfo> {
    await this.transport.connect();

    // Initialize
    const initResult = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      clientInfo: {
        name: this.config.name,
        version: this.config.version,
      },
    });

    this.serverInfo = initResult as MCPServerInfo;

    // Send initialized notification
    this.transport.notify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    // Discover capabilities
    await this.discoverCapabilities();

    return this.serverInfo;
  }

  private async discoverCapabilities(): Promise<void> {
    if (this.serverInfo?.capabilities.tools) {
      await this.listTools();
      this.emit('toolsChanged');
    }
    if (this.serverInfo?.capabilities.resources) {
      await this.listResources();
      this.emit('resourcesChanged');
    }
    if (this.serverInfo?.capabilities.prompts) {
      await this.listPrompts();
      this.emit('promptsChanged');
    }
  }

  async disconnect(): Promise<void> {
    await this.transport.disconnect();
    this.serverInfo = null;
    this.tools = [];
    this.resources = [];
    this.prompts = [];
  }

  isConnected(): boolean {
    return this.transport.isConnected();
  }

  getServerInfo(): MCPServerInfo | null {
    return this.serverInfo;
  }

  getTools(): MCPTool[] {
    return [...this.tools];
  }

  getResources(): MCPResource[] {
    return [...this.resources];
  }

  getPrompts(): MCPPrompt[] {
    return [...this.prompts];
  }

  // Tools
  async listTools(): Promise<MCPTool[]> {
    const result = await this.sendRequest('tools/list');
    this.tools = (result as { tools: MCPTool[] }).tools || [];
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    });
    return result as MCPToolResult;
  }

  // Resources
  async listResources(): Promise<MCPResource[]> {
    const result = await this.sendRequest('resources/list');
    this.resources = (result as { resources: MCPResource[] }).resources || [];
    return this.resources;
  }

  async readResource(uri: string): Promise<MCPResourceContent[]> {
    const result = await this.sendRequest('resources/read', { uri });
    return (result as { contents: MCPResourceContent[] }).contents || [];
  }

  async subscribeResource(uri: string): Promise<void> {
    await this.sendRequest('resources/subscribe', { uri });
  }

  async unsubscribeResource(uri: string): Promise<void> {
    await this.sendRequest('resources/unsubscribe', { uri });
  }

  // Prompts
  async listPrompts(): Promise<MCPPrompt[]> {
    const result = await this.sendRequest('prompts/list');
    this.prompts = (result as { prompts: MCPPrompt[] }).prompts || [];
    return this.prompts;
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<MCPPromptResult> {
    const result = await this.sendRequest('prompts/get', { name, arguments: args });
    return result as MCPPromptResult;
  }

  // Low-level request
  private async sendRequest(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextRequestId();
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };
    const response = await this.transport.send(request);
    if (response.error) {
      throw new Error(`MCP Error ${response.error.code}: ${response.error.message}`);
    }
    return response.result;
  }

  // Convert to Universal Tool Definition for tool registry
  toUniversalTools(prefix = 'mcp'): UniversalToolDefinition[] {
    return this.tools.map(tool => ({
      name: `${prefix}.${tool.name}`,
      description: tool.description || `MCP tool: ${tool.name}`,
      category: 'integration' as const,
      risk: 'EXTERNAL_ACTION' as const,
      parameters: tool.inputSchema,
      execute: async (args: Record<string, unknown>, _ctx: ToolExecutionContext) => {
        const result = await this.callTool(tool.name, args);
        if (result.isError) {
          throw new Error(result.content.map(c => c.text || '').join('\n'));
        }
        return {
          success: true,
          data: result.content.map(c => c.text || c.data || '').join('\n'),
          metadata: { tool: tool.name },
        };
      },
    }));
  }
}

// ============================================================================
// MCP Client Manager (for managing multiple connections)
// ============================================================================

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: MCPTransportConfig;
  enabled: boolean;
  projectId?: string;
  /** Server-specific configuration (API keys, connection strings, etc.) */
  config?: Record<string, unknown>;
  /** Built-in server type for reference */
  builtinType?: string;
}

export class MCPClientManager extends EventEmitter {
  private clients = new Map<string, MCPClient>();
  private configs = new Map<string, MCPServerConfig>();

  async addServer(config: MCPServerConfig): Promise<MCPClient> {
    if (this.clients.has(config.id)) {
      throw new Error(`MCP server ${config.id} already exists`);
    }

    const client = new MCPClient({
      transport: config.transport,
      name: config.name,
    });

    client.on('connected', () => {
      this.emit('serverConnected', config.id);
    });
    client.on('disconnected', () => {
      this.emit('serverDisconnected', config.id);
    });
    client.on('error', (err) => {
      this.emit('serverError', config.id, err);
    });
    client.on('toolsChanged', () => {
      this.emit('toolsChanged', config.id);
    });
    client.on('resourcesChanged', () => {
      this.emit('resourcesChanged', config.id);
    });

    this.clients.set(config.id, client);
    this.configs.set(config.id, config);

    if (config.enabled) {
      try {
        await client.connect();
      } catch (err) {
        console.error(`[MCP Manager] Failed to connect to ${config.id}:`, err);
        this.emit('serverError', config.id, err);
      }
    }

    return client;
  }

  async removeServer(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      await client.disconnect();
      this.clients.delete(id);
      this.configs.delete(id);
      this.emit('serverRemoved', id);
    }
  }

  async connectServer(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      await client.connect();
    }
  }

  async disconnectServer(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      await client.disconnect();
    }
  }

  getClient(id: string): MCPClient | undefined {
    return this.clients.get(id);
  }

  getAllClients(): MCPClient[] {
    return Array.from(this.clients.values());
  }

  getAllTools(prefix = 'mcp'): UniversalToolDefinition[] {
    const tools: UniversalToolDefinition[] = [];
    for (const [serverId, client] of this.clients) {
      if (client.isConnected()) {
        tools.push(...client.toUniversalTools(`${prefix}.${serverId}`));
      }
    }
    return tools;
  }

  getConfig(id: string): MCPServerConfig | undefined {
    return this.configs.get(id);
  }

  getAllConfigs(): MCPServerConfig[] {
    return Array.from(this.configs.values());
  }

  updateConfig(id: string, updates: Partial<MCPServerConfig>): void {
    const config = this.configs.get(id);
    if (config) {
      this.configs.set(id, { ...config, ...updates });
    }
  }
}

// ============================================================================
// Built-in Server Configurations
// ============================================================================

export const BUILTIN_MCP_SERVERS: Record<string, Omit<MCPServerConfig, 'id' | 'enabled' | 'projectId'>> = {
  filesystem: {
    name: 'Filesystem',
    transport: {
      type: 'stdio-direct',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      // args will be updated with the project path at runtime
    },
  },
  github: {
    name: 'GitHub',
    transport: {
      type: 'http',
      url: 'https://api.github.com/mcp',
      headers: {
        // Authorization header will be set at runtime from stored PAT
      },
    },
  },
  postgres: {
    name: 'PostgreSQL',
    transport: {
      type: 'stdio-direct',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres'],
      env: {
        // POSTGRES_CONNECTION_STRING will be set at runtime
      },
    },
  },
  sqlite: {
    name: 'SQLite',
    transport: {
      type: 'stdio-direct',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sqlite'],
      env: {
        // SQLITE_DB_PATH will be set at runtime
      },
    },
  },
  slack: {
    name: 'Slack',
    transport: {
      type: 'http',
      url: 'https://slack.com/api/mcp',
      headers: {
        // Authorization header will be set at runtime
      },
    },
  },
  braveSearch: {
    name: 'Brave Search',
    transport: {
      type: 'stdio-direct',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: {
        // BRAVE_API_KEY will be set at runtime
      },
    },
  },
  fetch: {
    name: 'Fetch',
    transport: {
      type: 'stdio-direct',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-fetch'],
    },
  },
  puppeteer: {
    name: 'Puppeteer',
    transport: {
      type: 'stdio-direct',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    },
  },
};

// ============================================================================
// Helper: Create client from built-in config
// ============================================================================

export async function createBuiltinMCPClient(
  serverKey: keyof typeof BUILTIN_MCP_SERVERS,
  overrides: Partial<MCPTransportConfig> = {}
): Promise<MCPClient> {
  const builtin = BUILTIN_MCP_SERVERS[serverKey];
  if (!builtin) {
    throw new Error(`Unknown built-in MCP server: ${serverKey}`);
  }

  const transport = {
    ...builtin.transport,
    ...overrides,
  } as MCPTransportConfig;

  const client = new MCPClient({ transport, name: builtin.name });
  await client.connect();
  return client;
}

export default MCPClient;