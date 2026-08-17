/**
 * ACP (Agent Client Protocol) Types
 * Based on the ACP specification for standardized agent-client communication.
 */

export interface ACPInitializeParams {
  protocolVersion: string;
  clientInfo: {
    name: string;
    version: string;
  };
  capabilities?: Record<string, unknown>;
  auth?: {
    type: "apiKey";
    apiKey: string;
  };
}

export interface ACPInitializeResult {
  protocolVersion: string;
  serverInfo: {
    name: string;
    version: string;
  };
  capabilities: {
    tools: { listChanged: boolean };
    resources: { listChanged: boolean };
    prompts: { listChanged: boolean };
  };
}

export interface ACPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ACPToolsListParams {
  cursor?: string;
}

export interface ACPToolsListResult {
  tools: ACPTool[];
  nextCursor?: string;
}

export interface ACPToolCallParams {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ACPToolCallResult {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
    resource?: {
      uri: string;
      mimeType: string;
    };
  }>;
  isError?: boolean;
}

export interface ACPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ACPResourcesListParams {
  cursor?: string;
}

export interface ACPResourcesListResult {
  resources: ACPResource[];
  nextCursor?: string;
}

export interface ACPResourcesReadParams {
  uri: string;
}

export interface ACPResourcesReadResult {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  }>;
}

export interface ACPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface ACPPromptsListParams {
  cursor?: string;
}

export interface ACPPromptsListResult {
  prompts: ACPPrompt[];
  nextCursor?: string;
}

export interface ACPPromptsGetParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface ACPPromptsGetResult {
  description?: string;
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: {
      type: "text" | "image" | "resource";
      text?: string;
      data?: string;
      mimeType?: string;
      resource?: { uri: string; mimeType: string };
    };
  }>;
}

export interface ACPError {
  code: number;
  message: string;
  data?: unknown;
}

export interface ACPRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

export interface ACPResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: ACPError;
}

export interface ACPNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

// Method names
export const ACPMethods = {
  INITIALIZE: "initialize",
  INITIALIZED: "initialized",
  TOOLS_LIST: "tools/list",
  TOOLS_CALL: "tools/call",
  RESOURCES_LIST: "resources/list",
  RESOURCES_READ: "resources/read",
  PROMPTS_LIST: "prompts/list",
  PROMPTS_GET: "prompts/get",
  NOTIFICATIONS_MESSAGE: "notifications/message",
  PING: "ping",
} as const;

// Error codes
export const ACPErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // ACP specific
  UNAUTHORIZED: -32001,
  FORBIDDEN: -32002,
  NOT_FOUND: -32003,
  TOOL_ERROR: -32010,
  RESOURCE_ERROR: -32011,
} as const;