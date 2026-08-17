# MCP Server Integration — Infinity

> **Phase 7 COMPLETE.** Infinity now exposes its tools via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io), so ANY LLM client (Claude Desktop, Cursor, VS Code, Continue.dev, custom agents) can use Infinity's capabilities directly — file ops, git, build agent, research, browser control, project memory.

## What is MCP?

Model Context Protocol is an open standard that lets LLM clients talk to external tools/servers in a uniform way. Infinity's MCP server acts as a **tool provider**: any MCP-compatible client can `list_tools`, then `call_tool` to drive Infinity.

## Tools Exposed

| Tool | Scope | Description |
|------|-------|-------------|
| `list_files` | `build:read` | List workspace files (glob filter) |
| `read_file` | `build:read` | Read a file's content |
| `edit_file` | `build:write` | Create/modify/delete a file |
| `run_command` | `build:write` | Execute shell command in workspace |
| `git_diff` | `build:read` | Show git diff of changes |
| `git_status` | `build:read` | Show git status |
| `git_commit` | `build:write` | Commit changes with message |
| `build_agent_run` | `build:write` | Run autonomous build agent for a goal |
| `build_agent_step` | `build:write` | Run agent for a specific plan step |
| `project_memory_read` | `build:read` | Read project-scoped memory |
| `project_memory_write` | `build:write` | Write project-scoped memory |
| `research_run` | `research:write` | Start deep research job |
| `research_extract` | `research:read` | Get research job results |
| `browser_navigate` | `build:write` | Navigate browser preview |
| `browser_screenshot` | `build:read` | Screenshot browser preview |
| `browser_action` | `build:write` | Click/type/scroll in browser preview |

All tools are **project-scoped** — they only touch the project set in `INFINITY_PROJECT_ID`.

## Authentication

The MCP server authenticates with the Infinity API server using `INFINITY_API_KEY` (same key as CLI / headless mode). The key's scopes are checked on every tool call — a key without `build:write` cannot call `edit_file`, etc.

## Quick Start

### 1. Install & Build
```bash
cd artifacts/mcp-server
npm install
npm run build
```

### 2. Run (stdio — for local clients)
```bash
INFINITY_API_KEY=sk_xxx \
INFINITY_PROJECT_ID=proj_123 \
npx @infinity/mcp-server
```

### 3. Run (HTTP — for remote clients)
```bash
INFINITY_API_KEY=sk_xxx \
INFINITY_PROJECT_ID=proj_123 \
MCP_TRANSPORT=http \
MCP_PORT=3001 \
npx @infinity/mcp-server
```
Health: `GET http://localhost:3001/health` → `{"ok":true}`
MCP: `POST http://localhost:3001/mcp`

## Client Configurations

### Claude Desktop (`claude_desktop_config.json`)

**Stdio:**
```json
{
  "mcpServers": {
    "infinity": {
      "command": "npx",
      "args": ["-y", "@infinity/mcp-server"],
      "env": {
        "INFINITY_API_KEY": "sk_xxx",
        "INFINITY_PROJECT_ID": "proj_123",
        "INFINITY_API_BASE_URL": "http://localhost:8080"
      }
    }
  }
}
```

**HTTP (remote):**
```json
{
  "mcpServers": {
    "infinity": {
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer sk_xxx"
      }
    }
  }
}
```

### Cursor (`.cursor/mcp.json` or Settings → MCP)
```json
{
  "mcpServers": {
    "infinity": {
      "command": "npx",
      "args": ["-y", "@infinity/mcp-server"],
      "env": {
        "INFINITY_API_KEY": "sk_xxx",
        "INFINITY_PROJECT_ID": "proj_123"
      }
    }
  }
}
```

### VS Code (`.vscode/mcp.json`)
```json
{
  "servers": {
    "infinity": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@infinity/mcp-server"],
      "env": {
        "INFINITY_API_KEY": "sk_xxx",
        "INFINITY_PROJECT_ID": "proj_123"
      }
    }
  }
}
```

### Continue.dev (`~/.continue/config.json`)
```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": { "type": "stdio" },
        "command": "npx",
        "args": ["-y", "@infinity/mcp-server"],
        "env": {
          "INFINITY_API_KEY": "sk_xxx",
          "INFINITY_PROJECT_ID": "proj_123"
        }
      }
    ]
  }
}
```

## Architecture

```
┌─────────────┐     MCP (stdio/HTTP)     ┌──────────────────┐     REST API      ┌─────────────────┐
│  LLM Client │ ───────────────────────▶ │  MCP Server      │ ────────────────▶ │  Infinity API   │
│  (Cursor,   │                          │  (this package)  │                   │  Server :8080   │
│   Claude,   │ ◀─────────────────────── │                  │ ◀──────────────── │                 │
│   VS Code)  │     tool results (JSON)  │  - auth (API key)│     JSON          │  - build tools  │
└─────────────┘                          │  - scope check   │                   │  - git, research│
                                          │  - project scope │                   │  - browser pool │
                                          └──────────────────┘                   └─────────────────┘
```

- **`src/server/index.ts`** — MCP server class + transport runners (stdio / HTTP)
- **`src/tools/index.ts`** — 16 tool definitions, each mapping to an API endpoint
- **`src/auth.ts`** — API key validation + scope checking

## End-to-End Test

```bash
# Terminal 1: start Infinity API server (port 8080)
cd artifacts/api-server && npm run dev

# Terminal 2: start MCP server (stdio)
INFINITY_API_KEY=sk_xxx INFINITY_PROJECT_ID=proj_123 npx @infinity/mcp-server

# Terminal 3: test with MCP inspector
npx @modelcontextprotocol/inspector
# → Connect to stdio: npx @infinity/mcp-server
# → List tools → call list_files
```

## Budget

**$0** — `@modelcontextprotocol/sdk`, `zod`, `axios` are all MIT/Apache free. No paid services.

## Next Phase

Phase 8: Multi-Agent Orchestration (planner → coder → reviewer → fixer).
