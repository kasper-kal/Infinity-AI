// Test script for MCP Client - tests filesystem MCP server directly via stdio
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// Simple stdio transport that spawns the process directly
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

class DirectStdioTransport extends EventEmitter {
  private process: ReturnType<typeof spawn> | null = null;
  private connected = false;
  private buffer = '';
  private pendingRequests = new Map<string | number, {
    resolve: (value: JSONRPCResponse) => void;
    reject: (reason: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private requestId = 0;

  constructor(private command: string, private args: string[], private env: Record<string, string> = {}) {
    super();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.command, this.args, {
        env: { ...process.env, ...this.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        console.error('[MCP Server stderr]:', data.toString());
      });

      this.process.on('error', (err) => {
        console.error('[MCP Server process error]:', err);
        this.emit('error', err);
        if (!this.connected) reject(err);
      });

      this.process.on('close', (code) => {
        this.connected = false;
        this.emit('disconnected', code);
      });

      // Wait a bit for process to start, then send initialize
      setTimeout(async () => {
        try {
          this.connected = true;
          this.emit('connected');
          resolve();
        } catch (err) {
          reject(err);
        }
      }, 1000);
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
          console.error('[MCP] Failed to parse:', line, err);
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

  async send(message: JSONRPCRequest): Promise<JSONRPCResponse> {
    if (!this.connected || !this.process?.stdin) {
      throw new Error('Transport not connected');
    }

    return new Promise((resolve, reject) => {
      const id = message.id;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, 30000);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.process!.stdin!.write(JSON.stringify(message) + '\n');
    });
  }

  notify(message: Omit<JSONRPCRequest, 'id'>): void {
    if (this.connected && this.process?.stdin) {
      this.process.stdin.write(JSON.stringify({ ...message, jsonrpc: '2.0' }) + '\n');
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
}

async function testFilesystemServer() {
  console.log('Testing Filesystem MCP Server (direct stdio)...');

  try {
    // Spawn the MCP filesystem server directly
    const transport = new DirectStdioTransport('npx', ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()]);

    await transport.connect();
    console.log('✓ Connected to filesystem MCP server');

    // Initialize
    const initResult = await transport.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {}, prompts: {} },
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    console.log('Server info:', JSON.stringify(initResult.result, null, 2));

    // Send initialized notification
    transport.notify({
      method: 'notifications/initialized',
    });

    // List tools
    const toolsResult = await transport.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });

    const tools = (toolsResult.result as { tools: any[] }).tools || [];
    console.log('\nAvailable tools:');
    for (const tool of tools) {
      console.log(`  - ${tool.name}: ${tool.description}`);
    }

    // Test list_files
    console.log('\nTesting list_files tool...');
    const listResult = await transport.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_files', arguments: { path: '.' } },
    });
    console.log('List result:', JSON.stringify(listResult.result, null, 2));

    // Test read_file
    console.log('\nTesting read_file tool...');
    const readResult = await transport.send({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: 'CLAUDE.md' } },
    });
    console.log('Read result (first 500 chars):', JSON.stringify(readResult.result).substring(0, 500));

    // Disconnect
    await transport.disconnect();
    console.log('\n✓ Disconnected successfully');

  } catch (error) {
    console.error('Error:', error);
  }
}

async function main() {
  console.log('=== MCP Direct Stdio Test ===\n');
  await testFilesystemServer();
  console.log('\n=== Test Complete ===');
}

main().catch(console.error);