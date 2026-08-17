# ACP (Agent Client Protocol) Integration

Infinity implements the **Agent Client Protocol (ACP)** — a standardized protocol for LLM clients to communicate with agent servers. This allows any ACP-compatible client (Zed, custom IDEs, CLI tools) to use Infinity's capabilities.

## Quick Start

```bash
# Start ACP server
cd artifacts/acp-server
npm install
npm run dev  # or npm run build && npm start
```

Server runs on:
- **HTTP**: `http://localhost:3001/acp` (JSON-RPC)
- **WebSocket**: `ws://localhost:3001` (real-time)

## Authentication

All requests require an API key via the `Authorization` header or `auth` parameter in `initialize`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "1.0",
    "clientInfo": { "name": "MyClient", "version": "1.0" },
    "auth": { "type": "apiKey", "apiKey": "inf_..." }
  }
}
```

## Client Configurations

### Zed Editor
Add to `~/.config/zed/settings.json`:

```json
{
  "agent": {
    "servers": {
      "infinity": {
        "url": "http://localhost:3001/acp",
        "auth": { "type": "apiKey", "apiKey": "inf_..." }
      }
    }
  }
}
```

### VS Code (ACP Extension)
Install ACP extension, then configure:

```json
{
  "acp.servers": {
    "infinity": {
      "transport": "http",
      "url": "http://localhost:3001/acp",
      "apiKey": "inf_..."
    }
  }
}
```

### Custom Client (TypeScript)

```typescript
import { createACPClient } from "@modelcontextprotocol/sdk/client/acp";

const client = createACPClient({
  transport: "http",
  url: "http://localhost:3001/acp",
  auth: { type: "apiKey", apiKey: "inf_..." }
});

await client.initialize();

// List tools
const tools = await client.tools.list();

// Call a tool
const result = await client.tools.call({
  name: "list_files",
  arguments: { projectId: "your-project-id" }
});
```

## Available Tools

| Tool | Description | Scope Required |
|------|-------------|----------------|
| `list_files` | List files in workspace | `build:read` |
| `read_file` | Read file content | `build:read` |
| `edit_file` | Create/modify file | `build:write` |
| `delete_file` | Delete file | `build:write` |
| `run_command` | Execute shell command | `build:write` |
| `git_status` | Get git status | `build:read` |
| `git_diff` | Get git diff | `build:read` |
| `git_commit` | Commit changes | `build:write` |
| `build_agent_run` | Start multi-agent build | `build:write` |
| `build_agent_step` | Run single build step | `build:write` |
| `project_memory_read` | Read project memory | `project:read` |
| `project_memory_write` | Write project memory | `project:write` |
| `research_run` | Run research query | `build:write` |
| `research_extract` | Extract from research | `build:read` |
| `browser_navigate` | Navigate browser | `build:write` |
| `browser_screenshot` | Take screenshot | `build:read` |
| `browser_action` | Browser action (click, type) | `build:write` |

## Available Resources

| URI | Description |
|-----|-------------|
| `infinity://project/{id}` | Project info |
| `infinity://project/{id}/builds` | Build history |
| `infinity://project/{id}/builds/latest` | Latest build |
| `infinity://project/{id}/memory` | Project memory |
| `infinity://project/{id}/activity` | Activity feed |

## Example Session

```bash
# 1. Initialize
curl -X POST http://localhost:3001/acp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "1.0",
      "clientInfo": { "name": "test", "version": "1.0" },
      "auth": { "type": "apiKey", "apiKey": "inf_xxx" }
    }
  }'

# 2. List tools
curl -X POST http://localhost:3001/acp \
  -H "Content-Type: application/json" \
  -H "X-ACP-Session: <session-id-from-init>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list"
  }'

# 3. Call a tool
curl -X POST http://localhost:3001/acp \
  -H "Content-Type: application/json" \
  -H "X-ACP-Session: <session-id>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "list_files",
      "arguments": { "projectId": "your-project-id" }
    }
  }'
```

## WebSocket Usage

```javascript
const ws = new WebSocket("ws://localhost:3001");

ws.onopen = () => {
  ws.send(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "1.0",
      clientInfo: { name: "test", version: "1.0" },
      auth: { type: "apiKey", apiKey: "inf_xxx" }
    }
  }));
};

ws.onmessage = (event) => {
  console.log("Response:", JSON.parse(event.data));
};
```

## Project Scoping

All tools and resources are scoped to the `projectId` from the authenticated API key. Clients cannot access resources from other projects.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ACP_PORT` | `3001` | Server port |
| `INFINITY_API_URL` | `http://localhost:3000` | Backend API URL |

## Integration with Infinity Backend

The ACP server connects to the same database and uses the same tool implementations as the main API server (`artifacts/api-server/src/lib/`). Tools are executed in the context of the authenticated project.

## Development

```bash
# Type check
npm run typecheck

# Build
npm run build

# Run built version
npm start
```

## Troubleshooting

- **Connection refused**: Ensure server is running on port 3001
- **Authentication failed**: Verify API key exists in database with `source: "user-api"` and `enabled: true`
- **Scope errors**: Ensure API key has required scopes (`build:read`, `build:write`, `project:read`, `project:write`)
- **Project not found**: Verify the API key's `projectId` matches the project you're accessing