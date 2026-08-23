import { Router, type Request, type Response } from "express";
import { WebSocketServer, WebSocket } from "ws";

const router = Router();

// Store active extension connections
const extensionConnections = new Map<string, WebSocket>();

// Track connected extensions
const connectedExtensions = new Map<string, {
  ws: WebSocket;
  connectedAt: number;
  lastPing: number;
}>();

// Handle WebSocket upgrade for extension connections
router.get("/extension/ws", (req: Request, res: Response) => {
  // This endpoint will be handled by the HTTP server's upgrade event
  // The actual WebSocket handling is in the server.ts where we attach the upgrade handler
  res.status(400).json({ error: "WebSocket upgrade required" });
});

// REST endpoint to get connected extensions status
router.get("/extension/status", (req: Request, res: Response) => {
  const extensions = Array.from(connectedExtensions.entries()).map(([id, data]) => ({
    extensionId: id,
    connectedAt: data.connectedAt,
    lastPing: data.lastPing,
    isAlive: data.ws.readyState === WebSocket.OPEN
  }));

  res.json({
    success: true,
    count: extensions.length,
    extensions
  });
});

// REST endpoint to send message to an extension
router.post("/extension/send", (req: Request, res: Response) => {
  const { extensionId, message } = req.body;

  if (!extensionId || !message) {
    return res.status(400).json({ success: false, error: "extensionId and message are required" });
  }

  const sent = sendToExtension(extensionId, message);
  if (sent) {
    return res.json({ success: true });
  } else {
    return res.status(404).json({ success: false, error: "Extension not found or not connected" });
  }
});

// REST endpoint to broadcast message to all extensions
router.post("/extension/broadcast", (req: Request, res: Response) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ success: false, error: "message is required" });
  }

  broadcastToExtensions(message);
  return res.json({ success: true });
});

// Function to broadcast message to all connected extensions
export function broadcastToExtensions(message: object) {
  const data = JSON.stringify(message);
  for (const [id, conn] of connectedExtensions.entries()) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(data);
    } else {
      // Clean up dead connections
      connectedExtensions.delete(id);
    }
  }
}

// Function to send message to specific extension
export function sendToExtension(extensionId: string, message: object): boolean {
  const conn = connectedExtensions.get(extensionId);
  if (conn && conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

// Function to handle WebSocket upgrade - to be called from server.ts
export function handleExtensionUpgrade(ws: WebSocket, req: Request) {
  console.log('[Extension] New WebSocket connection attempt');

  // Extract extension ID from query params or generate one
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const extensionId = url.searchParams.get('extensionId') || `ext_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  console.log(`[Extension] Registering extension: ${extensionId}`);

  // Store connection
  connectedExtensions.set(extensionId, {
    ws,
    connectedAt: Date.now(),
    lastPing: Date.now()
  });

  // Handle incoming messages from extension
  ws.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      handleExtensionMessage(extensionId, message);
    } catch (err) {
      console.error('[Extension] Failed to parse message:', err);
    }
  });

  // Handle extension disconnect
  ws.on('close', (code, reason) => {
    console.log(`[Extension] Extension disconnected: ${extensionId} (code: ${code}, reason: ${reason.toString()})`);
    connectedExtensions.delete(extensionId);
  });

  ws.on('error', (err) => {
    console.error(`[Extension] WebSocket error for ${extensionId}:`, err);
    connectedExtensions.delete(extensionId);
  });

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    extensionId,
    timestamp: Date.now(),
    message: 'Connected to Infinity API server'
  }));
}

// Handle messages from extension
async function handleExtensionMessage(extensionId: string, message: any) {
  console.log(`[Extension] Received from ${extensionId}:`, message.type);

  const conn = connectedExtensions.get(extensionId);
  if (!conn) return;

  switch (message.type) {
    case 'register':
      // Extension registering itself
      console.log(`[Extension] Registered: ${message.extensionId || extensionId}`);
      conn.lastPing = Date.now();
      break;

    case 'pong':
      // Heartbeat response
      conn.lastPing = Date.now();
      break;

    case 'action_result':
      // Result of an action execution - forward to any waiting request
      // Could be handled by a request/response correlation system
      console.log(`[Extension] Action result for ${message.actionId}:`, message.success);
      // Emit event for any waiting handlers
      break;

    case 'tabs_list':
      // Extension sending tabs list in response to get_tabs
      console.log(`[Extension] Tabs list received: ${message.tabs?.length || 0} tabs`);
      break;

    case 'tab_content':
      console.log(`[Extension] Tab content received`);
      break;

    case 'interactive_elements':
      console.log(`[Extension] Interactive elements received: ${message.elements?.length || 0} elements`);
      break;

    case 'evaluate':
      console.log(`[Extension] Script evaluation result`);
      break;

    case 'screenshot':
      console.log(`[Extension] Screenshot received`);
      break;

    default:
      console.warn(`[Extension] Unknown message type: ${message.type}`);
  }
}

// Heartbeat interval to detect dead connections
setInterval(() => {
  const now = Date.now();
  for (const [id, conn] of connectedExtensions.entries()) {
    if (conn.ws.readyState !== WebSocket.OPEN) {
      connectedExtensions.delete(id);
      continue;
    }

    // Send ping every 30 seconds
    if (now - conn.lastPing > 30000) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(JSON.stringify({ type: 'ping', timestamp: now }));
      } else {
        connectedExtensions.delete(id);
      }
    }
  }
}, 10000);

export default router;