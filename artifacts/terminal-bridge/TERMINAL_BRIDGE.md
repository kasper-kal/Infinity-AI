# Infinity Terminal Bridge

Local terminal bridge for Infinity — WebSocket bridge to node-pty for real terminal in browser.

## Overview

The Infinity Terminal Bridge runs locally on your machine and provides:
- **Full shell access** (bash/zsh/fish/powershell) with inherited environment
- **WebSocket server** for browser frontend communication on `ws://localhost:3001`
- **Session management** — multiple terminal tabs, each with independent pty
- **MCP stdio transport bridge** — connect to MCP servers via stdio
- **Zero-config** — auto-generates secret in `~/.infinity/bridge-secret`
- **Security** — secret verification, origin allowlist, command denylist, session timeouts

## Installation

```bash
# From the terminal-bridge directory
cd /workspaces/Infinity-AI/artifacts/terminal-bridge
npm install
npm run build
```

## Usage

### Start the bridge

```bash
# Basic usage (auto-generates secret)
npx infinity-terminal-bridge

# With custom options
npx infinity-terminal-bridge --port 3001 --secret mysecret

# Environment variables
INFINITY_BRIDGE_PORT=3001 INFINITY_BRIDGE_SECRET=mysecret npx infinity-terminal-bridge
```

### CLI Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--port` | `-p` | Port to listen on | `3001` |
| `--host` | | Host to bind to | `127.0.0.1` |
| `--secret` | | Shared secret (auto-generated if not provided) | Auto-generated |
| `--shell` | | Shell to use | `$SHELL` or `bash` |
| `--max-sessions` | | Maximum concurrent sessions | `10` |
| `--help` | `-h` | Show help | |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `INFINITY_BRIDGE_PORT` | Same as `--port` |
| `INFINITY_BRIDGE_HOST` | Same as `--host` |
| `INFINITY_BRIDGE_SECRET` | Same as `--secret` |
| `INFINITY_BRIDGE_SHELL` | Same as `--shell` |

## WebSocket Protocol

### Connection

Connect to `ws://127.0.0.1:3001?secret=<your-secret>`

The secret is required and verified on connection.

### Client Messages

All messages are JSON with `type` and optional `sessionId` and `payload`.

#### Create Session
```json
{
  "type": "create",
  "sessionId": "optional-session-id",
  "payload": {
    "shell": "bash",
    "cwd": "/home/user",
    "cols": 120,
    "rows": 30,
    "env": { "CUSTOM_VAR": "value" },
    "secret": "your-secret"
  }
}
```

Response:
```json
{
  "type": "created",
  "sessionId": "session_123_abc",
  "payload": { "buffer": "initial output..." },
  "timestamp": 1234567890
}
```

#### Resize Session
```json
{
  "type": "resize",
  "sessionId": "session_123_abc",
  "payload": { "cols": 160, "rows": 40 }
}
```

#### Send Input
```json
{
  "type": "input",
  "sessionId": "session_123_abc",
  "payload": { "data": "ls -la\n" }
}
```

#### Close Session
```json
{
  "type": "close",
  "sessionId": "session_123_abc"
}
```

#### Send Signal
```json
{
  "type": "signal",
  "sessionId": "session_123_abc",
  "payload": { "signal": "SIGTERM" }
}
```

#### Ping
```json
{
  "type": "ping"
}
```

Response:
```json
{
  "type": "pong",
  "timestamp": 1234567890
}
```

#### Connect MCP Server
```json
{
  "type": "mcp_connect",
  "payload": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
    "env": {},
    "secret": "your-secret"
  }
}
```

Response:
```json
{
  "type": "mcp_response",
  "sessionId": "mcp_123_abc",
  "payload": { "connected": true, "mcpId": "mcp_123_abc" },
  "timestamp": 1234567890
}
```

#### Send MCP Request
```json
{
  "type": "mcp_request",
  "payload": {
    "mcpId": "mcp_123_abc",
    "request": { "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }
  }
}
```

### Server Messages

All server messages include `type`, optional `sessionId`, optional `payload`, and `timestamp`.

| Type | Description |
|------|-------------|
| `created` | Session created successfully |
| `output` | Terminal output data |
| `closed` | Session closed |
| `error` | Error occurred |
| `pong` | Ping response |
| `mcp_response` | MCP server response |
| `mcp_error` | MCP connection error |

## Frontend Integration

### useTerminalBridge Hook

```typescript
import { useTerminalBridge } from '@/hooks/useTerminalBridge';

const {
  connected,
  connecting,
  error,
  sessions,
  createSession,
  resizeSession,
  sendInput,
  closeSession,
  sendSignal,
  outputHistory,
  connectMCP,
  sendMCPRequest,
  disconnectMCP,
  mcpConnections,
  ping,
  connect,
  disconnect,
  subscribe,
  config,
} = useTerminalBridge({
  host: '127.0.0.1',
  port: 3001,
  secret: 'your-secret', // Get from bridge output or ~/.infinity/bridge-secret
  autoConnect: true,
  reconnectInterval: 3000,
  maxReconnectAttempts: 10,
});
```

### Creating a Terminal Session

```typescript
const session = await createSession({
  shell: 'bash',
  cwd: '/home/user/project',
  cols: 120,
  rows: 30,
});

// Subscribe to output
const unsubscribe = subscribe((message) => {
  if (message.type === 'output' && message.sessionId === session.id) {
    console.log('Terminal output:', message.payload);
  }
});

// Send input
sendInput(session.id, 'ls -la\n');

// Resize
resizeSession(session.id, 160, 40);

// Close when done
closeSession(session.id);
```

### MCP Integration

```typescript
// Connect to filesystem MCP server
const mcpId = await connectMCP('npx', ['-y', '@modelcontextprotocol/server-filesystem', '/home/user']);

// Send request
sendMCPRequest(mcpId, {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
  params: {}
});

// Listen for responses
const unsubscribe = subscribe((message) => {
  if (message.type === 'mcp_response' && message.sessionId === mcpId) {
    console.log('MCP response:', message.payload);
  }
});
```

## Universal Tool Registry Integration

The bridge provides tools for the Universal Tool Registry:

| Tool | Description |
|------|-------------|
| `terminal.createSession` | Create a new terminal session |
| `terminal.sendInput` | Send input to a session |
| `terminal.resizeSession` | Resize a session |
| `terminal.closeSession` | Close a session |
| `terminal.sendSignal` | Send signal to a session |
| `terminal.connectMCP` | Connect to MCP server via stdio |
| `terminal.mcpRequest` | Send request to MCP server |
| `terminal.listSessions` | List active sessions |
| `terminal.getBridgeStatus` | Get bridge status |

These tools return configuration that the frontend uses to establish WebSocket connections.

## Security

### Secret Authentication
- Secret is auto-generated on first run and stored in `~/.infinity/bridge-secret` (mode 0600)
- All WebSocket connections require the secret as query parameter
- CLI commands and MCP connections also verify the secret

### Origin Allowlist
Default allowed origins:
- `http://localhost:3000`
- `http://localhost:5173`
- `http://127.0.0.1:3000`
- `http://127.0.0.1:5173`

Configure via `allowedOrigins` in config or `INFINITY_BRIDGE_ALLOWED_ORIGINS` env var.

### Command Denylist
Default denylisted commands:
- `rm -rf /`
- `format c:`
- `:(){ :|:& };:` (fork bomb)

Configure via `commandDenylist` in config.

### Session Timeouts
- Default: 30 minutes of inactivity
- Configurable via `sessionTimeoutMs`

### Max Sessions
- Default: 10 concurrent sessions
- Configurable via `maxSessions`

## Architecture

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│   Browser       │ ◄────────────────► │  Terminal Bridge │
│   Frontend      │   (ws://localhost:3001) │  (node-pty)    │
└─────────────────┘                    └────────┬─────────┘
                                                │
                    ┌───────────────────────────┼───────────────────────────┐
                    ▼                           ▼                           ▼
            ┌───────────────┐           ┌───────────────┐           ┌───────────────┐
            │ Terminal      │           │ Terminal      │           │ MCP Server    │
            │ Session 1     │           │ Session 2     │           │ (stdio)       │
            │ (bash)        │           │ (zsh)         │           │ (filesystem,  │
            └───────────────┘           └───────────────┘           │  git, etc.)   │
                                                                    └───────────────┘
```

### Session Structure

Each `TerminalSession` contains:
- `id` — Unique session identifier
- `pty` — node-pty process (ChildProcessWithoutNullStreams)
- `shell` — Shell command (bash, zsh, etc.)
- `cwd` — Working directory
- `env` — Environment variables
- `cols` / `rows` — Terminal dimensions
- `clients` — Set of connected WebSocket clients
- `buffer` — Output buffer (last 10000 chars)
- `createdAt` / `lastActivity` — Timestamps for timeout tracking

### MCP Bridge

The MCP bridge spawns MCP servers as child processes with stdio pipes:
- `stdin` — JSON-RPC requests from browser
- `stdout` — JSON-RPC responses to browser
- `stderr` — Logged to bridge console

Multiple MCP connections supported concurrently.

## Development

### Building

```bash
npm run build
```

Output in `dist/`

### Development Mode

```bash
npm run dev
```

Uses `tsx watch` for hot reload.

### Project Structure

```
terminal-bridge/
├── package.json
├── tsconfig.json
├── TERMINAL_BRIDGE.md
├── src/
│   └── index.ts          # Main bridge server (~700 lines)
└── bin/
    └── bridge.ts         # CLI entry point
```

## Troubleshooting

### Bridge won't start
- Check if port 3001 is already in use: `lsof -i :3001`
- Ensure Node.js >= 18 is installed
- Check secret file permissions: `ls -la ~/.infinity/bridge-secret`

### WebSocket connection fails
- Verify secret matches: check bridge startup output
- Check origin is in allowlist
- Check browser console for CORS/origin errors

### node-pty not working
- On Windows: uses `spawn` fallback (limited functionality)
- On Unix: requires Python and build tools for native compilation
- Install: `npm install node-pty` (should compile automatically)

### MCP connection fails
- Verify MCP server command works standalone
- Check stderr output in bridge console
- Ensure MCP server speaks JSON-RPC over stdio

## License

MIT