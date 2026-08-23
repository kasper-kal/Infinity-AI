#!/usr/bin/env node
/**
 * Infinity Terminal Bridge — CLI entry point
 */
import { startBridge, stopBridge } from "../src/index.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Infinity Terminal Bridge — Local terminal bridge for Infinity

Usage: infinity-terminal-bridge [options]

Options:
  --port, -p <number>     Port to listen on (default: 3001)
  --host <string>         Host to bind to (default: 127.0.0.1)
  --secret <string>       Shared secret (auto-generated if not provided)
  --shell <string>        Shell to use (default: \$SHELL or bash)
  --max-sessions <number> Maximum concurrent sessions (default: 10)
  --help, -h              Show this help

Environment:
  INFINITY_BRIDGE_PORT     Same as --port
  INFINITY_BRIDGE_HOST     Same as --host
  INFINITY_BRIDGE_SECRET   Same as --secret
  INFINITY_BRIDGE_SHELL    Same as --shell

Examples:
  infinity-terminal-bridge
  infinity-terminal-bridge --port 3001 --secret mysecret
  INFINITY_BRIDGE_PORT=3001 infinity-terminal-bridge
`);
  process.exit(0);
}

// Parse CLI args
const cliConfig: Record<string, unknown> = {};
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--port":
    case "-p":
      cliConfig.port = parseInt(args[++i], 10);
      break;
    case "--host":
      cliConfig.host = args[++i];
      break;
    case "--secret":
      cliConfig.secret = args[++i];
      break;
    case "--shell":
      cliConfig.shell = args[++i];
      break;
    case "--max-sessions":
      cliConfig.maxSessions = parseInt(args[++i], 10);
      break;
  }
}

// Environment variable overrides
if (process.env.INFINITY_BRIDGE_PORT) cliConfig.port = parseInt(process.env.INFINITY_BRIDGE_PORT, 10);
if (process.env.INFINITY_BRIDGE_HOST) cliConfig.host = process.env.INFINITY_BRIDGE_HOST;
if (process.env.INFINITY_BRIDGE_SECRET) cliConfig.secret = process.env.INFINITY_BRIDGE_SECRET;
if (process.env.INFINITY_BRIDGE_SHELL) cliConfig.shell = process.env.INFINITY_BRIDGE_SHELL;

// Start bridge
startBridge(cliConfig as Parameters<typeof startBridge>[0]).catch((err) => {
  console.error("[Bridge] Failed to start:", err);
  process.exit(1);
});

// Handle shutdown
process.on("SIGINT", async () => {
  console.log("\n[Bridge] Shutting down...");
  await stopBridge();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await stopBridge();
  process.exit(0);
});