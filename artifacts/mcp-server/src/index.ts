/**
 * Infinity MCP Server - Main Entry Point
 *
 * Exports the server class and runs CLI if executed directly.
 */

export { InfinityMcpServer, type McpServerConfig } from "./server/index.js";
export { validateApiKey, hasScope, requireScope, type AuthResult, type AuthConfig } from "./auth.js";
export { MCP_TOOLS, getTool, type McpTool, type McpToolContext } from "./tools/index.js";

// CLI entry point - only runs when this file is executed directly
import { InfinityMcpServer, parseArgs } from "./server/index.js";

const config = parseArgs();
const server = new InfinityMcpServer(config);

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