/**
 * ACP Server - HTTP + WebSocket transports for Agent Client Protocol
 */

import { WebSocketServer, WebSocket } from "ws";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { URL } from "url";
import {
  ACPRequest,
  ACPResponse,
  ACPNotification,
  ACPError,
  ACPInitializeParams,
  ACPInitializeResult,
  ACPMethods,
  ACPErrorCodes,
  ACPToolCallParams,
  ACPToolCallResult,
  ACPToolsListParams,
  ACPToolsListResult,
  ACPResourcesListParams,
  ACPResourcesListResult,
  ACPResourcesReadParams,
  ACPResourcesReadResult,
} from "./types";
import { validateACPApiKey, hasScope, type ACPAuthInfo } from "./auth";
import { getACPTools, getACPTool } from "./tools";
import { listResources, readResource } from "./resources";

export interface ACPSession {
  id: string;
  authInfo: ACPAuthInfo;
  initialized: boolean;
  clientInfo?: ACPInitializeParams["clientInfo"];
}

const sessions = new Map<string, ACPSession>();
const wsConnections = new Map<WebSocket, string>(); // ws -> sessionId

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function createErrorResponse(id: string | number, code: number, message: string, data?: unknown): ACPResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, data },
  };
}

function createSuccessResponse(id: string | number, result: unknown): ACPResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function createNotification(method: string, params?: unknown): ACPNotification {
  return {
    jsonrpc: "2.0",
    method,
    params,
  };
}

async function handleInitialize(sessionId: string, params: ACPInitializeParams): Promise<ACPResponse> {
  const { auth } = params;
  if (!auth || auth.type !== "apiKey" || !auth.apiKey) {
    return createErrorResponse(params.id as string | number, ACPErrorCodes.UNAUTHORIZED, "API key required");
  }

  const authInfo = await validateACPApiKey(auth.apiKey);
  if (!authInfo) {
    return createErrorResponse(params.id as string | number, ACPErrorCodes.UNAUTHORIZED, "Invalid API key");
  }

  const session: ACPSession = {
    id: sessionId,
    authInfo,
    initialized: true,
    clientInfo: params.clientInfo,
  };

  sessions.set(sessionId, session);

  const result: ACPInitializeResult = {
    protocolVersion: params.protocolVersion,
    serverInfo: {
      name: "Infinity ACP Server",
      version: "1.0.0",
    },
    capabilities: {
      tools: { listChanged: true },
      resources: { listChanged: true },
      prompts: { listChanged: true },
    },
  };

  return createSuccessResponse(params.id as string | number, result);
}

async function handleToolsList(sessionId: string, params: ACPToolsListParams): Promise<ACPResponse> {
  const session = sessions.get(sessionId);
  if (!session || !session.initialized) {
    return createErrorResponse(params.id as string | number, ACPErrorCodes.UNAUTHORIZED, "Not initialized");
  }

  if (!hasScope(session.authInfo, "build:read")) {
    return createErrorResponse(params.id as string | number, ACPErrorCodes.FORBIDDEN, "Insufficient scope: build:read required");
  }

  const tools = getACPTools();
  const result: ACPToolsListResult = { tools };
  return createSuccessResponse(params.id as string | number, result);
}

async function handleToolCall(sessionId: string, params: ACPToolCallParams): Promise<ACPResponse> {
  const session = sessions.get(sessionId);
  if (!session || !session.initialized) {
    return createErrorResponse(params.id as string | number, ACPErrorCodes.UNAUTHORIZED, "Not initialized");
  }

  if (!hasScope(session.authInfo, "build:write")) {
    return createErrorResponse(params.id as string | number, ACPErrorCodes.FORBIDDEN, "Insufficient scope: build:write required");
  }

  const tool = getACPTool(params.name);
  if (!tool) {
    return createErrorResponse(params.id as string | number, ACPErrorCodes.METHOD_NOT_FOUND, `Tool not found: ${params.name}`);
  }

  try {
    // Execute the tool based on name
    let result: unknown;
    const { projectId, ...args } = params.arguments as Record<string, unknown>;

    // Ensure projectId matches auth
    if (projectId !== session.authInfo.projectId && session.authInfo.projectId !== "default") {
      return createErrorResponse(params.id as string | number, ACPErrorCodes.FORBIDDEN, "Project ID mismatch");
    }

    switch (params.name) {
      case "list_files": {
        const { listFiles } = await import("./lib/build-tools");
        result = await listFiles({ projectId: projectId as string, path: args.path as string });
        break;
      }
      case "read_file": {
        const { readFile } = await import("./lib/build-tools");
        result = await readFile({ projectId: projectId as string, path: args.path as string });
        break;
      }
      case "edit_file": {
        const { editFile } = await import("./lib/build-tools");
        result = await editFile({ projectId: projectId as string, path: args.path as string, content: args.content as string });
        break;
      }
      case "delete_file": {
        const { deleteFile } = await import("./lib/build-tools");
        result = await deleteFile({ projectId: projectId as string, path: args.path as string });
        break;
      }
      case "run_command": {
        const { runCommand } = await import("./lib/build-tools");
        result = await runCommand({
          projectId: projectId as string,
          command: args.command as string,
          cwd: args.cwd as string,
          timeout: args.timeout as number,
        });
        break;
      }
      case "git_status": {
        const { gitStatus } = await import("./lib/build-tools");
        result = await gitStatus({ projectId: projectId as string });
        break;
      }
      case "git_diff": {
        const { gitDiff } = await import("./lib/build-tools");
        result = await gitDiff({ projectId: projectId as string, staged: args.staged as boolean });
        break;
      }
      case "git_commit": {
        const { gitCommit } = await import("./lib/build-tools");
        result = await gitCommit({ projectId: projectId as string, message: args.message as string, addAll: args.addAll as boolean });
        break;
      }
      case "build_agent_run": {
        const { runMultiAgentBuild } = await import("./lib/build-orchestrator");
        const { ensureWorkspace } = await import("./lib/workspace");
        const { setProjectGoal, refreshFileMap } = await import("./lib/build-context");

        await ensureWorkspace(projectId as string);
        setProjectGoal(projectId as string, args.goal as string);
        await refreshFileMap(projectId as string, projectId as string);

        const orchResult = await runMultiAgentBuild({
          goal: args.goal as string,
          projectId: projectId as string,
          workspaceId: projectId as string,
          model: args.model as string,
          toolContext: { projectId: projectId as string, workspaceId: projectId as string },
        });
        result = orchResult;
        break;
      }
      case "build_agent_step": {
        const { runAgentForStep } = await import("./lib/build-orchestrator");
        result = await runAgentForStep({
          projectId: projectId as string,
          workspaceId: projectId as string,
          step: args.step as any,
          toolContext: { projectId: projectId as string, workspaceId: projectId as string },
        });
        break;
      }
      case "project_memory_read": {
        const { readProjectMemory } = await import("./lib/project-memory");
        result = await readProjectMemory(projectId as string, args.key as string);
        break;
      }
      case "project_memory_write": {
        const { writeProjectMemory } = await import("./lib/project-memory");
        result = await writeProjectMemory(projectId as string, args.key as string, args.value as string);
        break;
      }
      case "research_run": {
        const { runResearch } = await import("./lib/research-engine");
        const researchResult = await runResearch(
          args.query as string,
          (args.depth as "standard" | "deep" | "quantum" | "omni") || "deep",
          args.sources as string[] | undefined
        );
        result = researchResult;
        break;
      }
      case "research_extract": {
        // Would need research-extract implementation
        result = { error: "Not yet implemented" };
        break;
      }
      case "browser_navigate": {
        // Would need browser implementation
        result = { error: "Not yet implemented" };
        break;
      }
      case "browser_screenshot": {
        // Would need browser implementation
        result = { error: "Not yet implemented" };
        break;
      }
      case "browser_action": {
        // Would need browser implementation
        result = { error: "Not yet implemented" };
        break;
      }
      default:
        return createErrorResponse(params.id as string | number, ACPErrorCodes.METHOD_NOT_FOUND, `Tool not implemented: ${params.name}`);
    }

    const toolResult: ACPToolCallResult = {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };

    return createSuccessResponse(params.id as string | number, toolResult);
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    const toolResult: ACPToolCallResult = {
      content: [{ type: "text", text: `Error: ${error}` }],
      isError: true,
    };
    return createSuccessResponse(params.id as string | number, toolResult);
  }
}

async function handleResourcesList(sessionId: string, params: ACPResourcesListParams): Promise<ACPResponse> {
  const session = sessions.get(sessionId);
  if (!session || !session.initialized) {
    return createErrorResponse(params.id as string | number, ACPErrorCodes.UNAUTHORIZED, "Not initialized");
  }

  if (!hasScope(session.authInfo, "project:read")) {
    return createErrorResponse(params.id as string | number, ACPErrorCodes.FORBIDDEN, "Insufficient scope: project:read required");
  }

  const resources = await listResources(session.authInfo.projectId);
  const result: ACPResourcesListResult = { resources };
  return createSuccessResponse(params.id as string | number, result);
}

async function handleResourcesRead(sessionId: string, params: ACPResourcesReadParams): Promise<ACPResponse> {
  const session = sessions.get(sessionId);
  if (!session || !session.initialized) {
    return createErrorResponse(params.id as string | number, ACPErrorCodes.UNAUTHORIZED, "Not initialized");
  }

  if (!hasScope(session.authInfo, "project:read")) {
    return createErrorResponse(params.id as string | number, ACPErrorCodes.FORBIDDEN, "Insufficient scope: project:read required");
  }

  try {
    // Ensure the resource belongs to the authenticated project
    if (!params.uri.startsWith(`infinity://project/${session.authInfo.projectId}/`) &&
        params.uri !== `infinity://project/${session.authInfo.projectId}`) {
      return createErrorResponse(params.id as string | number, ACPErrorCodes.FORBIDDEN, "Project ID mismatch");
    }

    const result = await readResource(params.uri);
    return createSuccessResponse(params.id as string | number, result);
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    return createErrorResponse(params.id as string | number, ACPErrorCodes.RESOURCE_ERROR, error);
  }
}

async function handleRequest(sessionId: string, request: ACPRequest): Promise<ACPResponse | null> {
  const { method, params, id } = request;

  // Handle notifications (no response)
  if (id === undefined) {
    if (method === ACPMethods.INITIALIZED) {
      // Client confirmed initialization
      const session = sessions.get(sessionId);
      if (session) {
        session.initialized = true;
      }
    }
    return null;
  }

  switch (method) {
    case ACPMethods.INITIALIZE:
      return handleInitialize(sessionId, params as ACPInitializeParams);
    case ACPMethods.TOOLS_LIST:
      return handleToolsList(sessionId, params as ACPToolsListParams);
    case ACPMethods.TOOLS_CALL:
      return handleToolCall(sessionId, params as ACPToolCallParams);
    case ACPMethods.RESOURCES_LIST:
      return handleResourcesList(sessionId, params as ACPResourcesListParams);
    case ACPMethods.RESOURCES_READ:
      return handleResourcesRead(sessionId, params as ACPResourcesReadParams);
    case ACPMethods.PING:
      return createSuccessResponse(id, { pong: true });
    default:
      return createErrorResponse(id, ACPErrorCodes.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

async function handleHTTPRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  if (url.pathname === "/acp") {
    // JSON-RPC over HTTP
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    try {
      const request = JSON.parse(body) as ACPRequest;

      // Get or create session from header
      const sessionId = (req.headers["x-acp-session"] as string) || generateId();
      const response = await handleRequest(sessionId, request);

      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-ACP-Session", sessionId);

      if (response) {
        res.writeHead(200);
        res.end(JSON.stringify(response));
      } else {
        res.writeHead(202); // Accepted (notification)
        res.end();
      }
    } catch (err) {
      res.writeHead(400);
      res.end(JSON.stringify(createErrorResponse("parse", ACPErrorCodes.PARSE_ERROR, "Invalid JSON")));
    }
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
}

function handleWSConnection(ws: WebSocket, req: IncomingMessage): void {
  const sessionId = generateId();
  wsConnections.set(ws, sessionId);

  ws.on("message", async (data) => {
    try {
      const request = JSON.parse(data.toString()) as ACPRequest;
      const response = await handleRequest(sessionId, request);

      if (ws.readyState === WebSocket.OPEN) {
        if (response) {
          ws.send(JSON.stringify(response));
        }
        // Notifications don't get a response
      }
    } catch (err) {
      const errorResponse = createErrorResponse("parse", ACPErrorCodes.PARSE_ERROR, "Invalid JSON");
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(errorResponse));
      }
    }
  });

  ws.on("close", () => {
    wsConnections.delete(ws);
    sessions.delete(sessionId);
  });

  ws.on("error", (err) => {
    console.error("[ACP WS] Error:", err);
    wsConnections.delete(ws);
    sessions.delete(sessionId);
  });

  // Send welcome message
  ws.send(JSON.stringify(createNotification("connected", { sessionId })));
}

export function createACPServer(port: number = 3001): Promise<void> {
  return new Promise((resolve) => {
    const server = createServer(handleHTTPRequest);
    const wss = new WebSocketServer({ server });

    wss.on("connection", handleWSConnection);

    server.listen(port, () => {
      console.log(`[ACP] Server running on http://localhost:${port}`);
      console.log(`[ACP] WebSocket: ws://localhost:${port}`);
      console.log(`[ACP] HTTP endpoint: http://localhost:${port}/acp`);
      resolve();
    });
  });
}

// If run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.ACP_PORT || "3001", 10);
  createACPServer(port).catch(console.error);
}