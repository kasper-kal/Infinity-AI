/**
 * ACP Server Entry Point
 */

import { createACPServer } from "./server";

const PORT = parseInt(process.env.ACP_PORT || "3001", 10);

console.log("[ACP] Starting Infinity ACP Server...");
console.log("[ACP] Protocol: Agent Client Protocol (ACP) v1.0");
console.log("[ACP] Transports: HTTP + WebSocket");

createACPServer(PORT).catch((err) => {
  console.error("[ACP] Failed to start:", err);
  process.exit(1);
});