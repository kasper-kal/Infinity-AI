/**
 * MCP Server for Infinity
 *
 * Exposes Infinity tools via Model Context Protocol (MCP) so any LLM client
 * (Claude Desktop, Cursor, VS Code, Continue.dev, etc.) can use Infinity's capabilities.
 *
 * Supports both stdio transport (for local clients) and HTTP transport (for remote clients).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, InitializeRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "http";
import { URL } from "url";
import { MCP_TOOLS, McpToolContext, getTool } from "../tools/index.js";
import { validateApiKey, requireScope, AuthResult } from "../auth.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface McpServerConfig {
  /** Base URL of the Infinity API server */
  apiBaseUrl: string;
  /** The Infinity API key */
  apiKey: string;
  /** Default project ID to scope all tools to */
  projectId: string;
  /** Transport: 'stdio' or 'http' */
  transport: "stdio" | "http";
  /** HTTP server port (if transport is http) */
  port?: number;
  /** HTTP server host (if transport is http) */
  host?: string;
}

// ---------------------------------------------------------------------------
// MCP Server Class
// ---------------------------------------------------------------------------

export class InfinityMcpServer {
  private server: Server;
  private config: McpServerConfig;
  private authResult: AuthResult | null = null;
  private httpServer: ReturnType<typeof createServer> | null = null;

  private validateAuth(): Promise<AuthResult> {
    return validateApiKey({
      apiBaseUrl: this.config.apiBaseUrl,
      apiKey: this.config.apiKey,
    });
  }

  constructor(config: McpServerConfig) {
    this.config = config;

    this.server = new Server(
      {
        name: "infinity-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Initialize handler - validates API key and sets up project context
    this.server.setRequestHandler(InitializeRequestSchema, async (request) => {
      const clientInfo = request.params.clientInfo;
      console.error(`[MCP] Initialize from ${clientInfo?.name || "unknown client"}`);

      // Validate API key
      this.authResult = await this.validateAuth();

      if (!this.authResult.valid) {
        console.error(`[MCP] Auth failed: ${this.authResult.error}`);
        throw new Error(`Authentication failed: ${this.authResult.error}`);
      }

      console.error(`[MCP] Auth OK - user: ${this.authResult.userId}, project: ${this.config.projectId}, scopes: [${this.authResult.scopes.join(", ")}]`);

      return {
        protocolVersion: "2025-06-18",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "infinity-mcp",
          version: "1.0.0",
        },
      };
    });

    // List available tools (filtered by scope)
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      if (!this.authResult?.valid) {
        throw new Error("Not authenticated");
      }

      const tools = MCP_TOOLS.filter((t) => {
        // Include tool if user has any of its required scopes
        return t.scopes.some((s) => this.authResult!.scopes.includes(s) || this.authResult!.scopes.includes("*"));
      });

      return {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };
    });

    // Execute tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (!this.authResult?.valid) {
        throw new Error("Not authenticated");
      }

      const { name, arguments: args } = request.params;
      const tool = getTool(name);

      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }

      // Check scope
      try {
        for (const scope of tool.scopes) {
          requireScope(this.authResult.scopes, scope);
        }
      } catch (e) {
        throw new Error(`Scope check failed: ${e instanceof Error ? e.message : String(e)}`);
      }

      console.error(`[MCP] Tool call: ${name}`);

      const ctx: McpToolContext = {
        apiBaseUrl: this.config.apiBaseUrl,
        apiKey: this.config.apiKey,
        projectId: this.config.projectId,
        auth: this.authResult,
      };

      try {
        const result = await tool.handler(args, ctx);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[MCP] Tool error: ${message}`);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    });
  }

  // -------------------------------------------------------------------------
  // Transport runners
  // -------------------------------------------------------------------------

  /** Run with stdio transport (for CLI clients like Claude Desktop) */
  async runStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("[MCP] Server running on stdio");
  }

  /** Run with HTTP transport (for remote clients) */
  async runHttp(): Promise<void> {
    const port = this.config.port || 3001;
    const host = this.config.host || "0.0.0.0";

    this.httpServer = createServer(async (req, res) => {
      // CORS
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || "/", `http://${host}:${port}`);

      // Health check
      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, server: "infinity-mcp" }));
        return;
      }

      // MCP endpoint
      if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        });

        await this.server.connect(transport);

        // Handle the request
        await transport.handleRequest(req, res);
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(port, host, (err?: Error) => {
        if (err) reject(err);
        else {
          console.error(`[MCP] HTTP server listening on ${host}:${port} (MCP at /mcp)`);
          resolve();
        }
      });
    });
  }

  /** Start the server based on configured transport */
  async start(): Promise<void> {
    if (this.config.transport === "stdio") {
      await this.runStdio();
    } else {
      await this.runHttp();
    }
  }

  /** Stop the server */
  async stop(): Promise<void> {
    if (this.httpServer) {
      await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
    }
    await this.server.close();
  }
}

// ---------------------------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------------------------

export function parseArgs(): McpServerConfig {
  const args = process.argv.slice(2);
  const config: McpServerConfig = {
    apiBaseUrl: process.env.INFINITY_API_BASE_URL || "http://localhost:8080",
    apiKey: process.env.INFINITY_API_KEY || "",
    projectId: process.env.INFINITY_PROJECT_ID || "",
    transport: (process.env.MCP_TRANSPORT as "stdio" | "http") || "stdio",
    port: parseInt(process.env.MCP_PORT || "3001"),
    host: process.env.MCP_HOST || "0.0.0.0",
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--api-url":
        config.apiBaseUrl = args[++i];
        break;
      case "--api-key":
        config.apiKey = args[++i];
        break;
      case "--project-id":
        config.projectId = args[++i];
        break;
      case "--transport":
        config.transport = args[++i] as "stdio" | "http";
        break;
      case "--port":
        config.port = parseInt(args[++i]);
        break;
      case "--host":
        config.host = args[++i];
        break;
      case "--help":
        printHelp();
        process.exit(0);
    }
  }

  if (!config.apiKey) {
    console.error("ERROR: INFINITY_API_KEY is required (env var or --api-key)");
    process.exit(1);
  }

  if (!config.projectId) {
    console.error("ERROR: INFINITY_PROJECT_ID is required (env var or --project-id)");
    process.exit(1);
  }

  return config;
}

function printHelp(): void {
  console.log(`
Infinity MCP Server - expose Infinity tools via Model Context Protocol

Usage:
  npx @infinity/mcp-server [options]

Options:
  --api-url <url>       Infinity API base URL (default: http://localhost:8080)
  --api-key <key>       Infinity API key (required)
  --project-id <id>     Project ID to scope tools to (required)
  --transport <type>    Transport: stdio | http (default: stdio)
  --port <port>         HTTP port (default: 3001)
  --host <host>         HTTP host (default: 0.0.0.0)
  --help                Show this help

Environment Variables:
  INFINITY_API_BASE_URL  API base URL
  INFINITY_API_KEY       API key (required)
  INFINITY_PROJECT_ID    Project ID (required)
  MCP_TRANSPORT          stdio | http
  MCP_PORT               HTTP port
  MCP_HOST               HTTP host

Examples:
  # Stdio for Claude Desktop
  INFINITY_API_KEY=sk_xxx INFINITY_PROJECT_ID=proj_123 npx @infinity/mcp-server

  # HTTP for remote clients
  INFINITY_API_KEY=sk_xxx INFINITY_PROJECT_ID=proj_123 MCP_TRANSPORT=http npx @infinity/mcp-server
`);
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = parseArgs();
  const server = new InfinityMcpServer(config);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.error("\n[MCP] Shutting down...");
    await server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.error("\n[MCP] Shutting down...");
    await server.stop();
    process.exit(0);
  });

  server.start().catch((err) => {
    console.error("[MCP] Fatal error:", err);
    process.exit(1);
  });
}