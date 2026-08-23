/**
 * Build an extremely detailed error response object for debugging.
 * This is sent alongside the user-friendly error message so the
 * frontend can display a "Show Details" panel with full diagnostics.
 *
 * The detail object intentionally contains EVERYTHING that could be
 * relevant to the error (sanitized, secrets are booleans/redacted),
 * so the user can copy one blob and paste it into a bug report.
 */

import type { Request } from "express";

export interface ErrorDetail {
  /** Human-readable error message */
  message: string;
  /** Error code (e.g. "LLM_AUTH_FAILED", "DB_CONNECTION_LOST") */
  code: string;
  /** ISO timestamp */
  timestamp: string;
  /** HTTP status code */
  statusCode: number;
  /** Original error name (e.g. "TypeError", "Error") */
  errorName: string;
  /** Original error message (before sanitization) */
  originalMessage: string;
  /** Stack trace (sanitized, internal paths only) */
  stack: string;
  /** Request info */
  request: {
    method: string;
    url: string;
    path: string;
    query: Record<string, unknown>;
    params: Record<string, unknown>;
    bodyKeys: string[];
    bodyPreview: Record<string, unknown>;
    bodySizeBytes: number;
    contentType: string | undefined;
    userAgent: string | undefined;
    origin: string | undefined;
    referer: string | undefined;
    ip: string | undefined;
    /** All request headers, sanitized (auth/cookie/keys redacted) */
    headers: Record<string, string>;
    /** Raw request body (JSON-serializable, secrets redacted, truncated) */
    body: string;
  };
  /** Environment snapshot (safe vars only) */
  environment: {
    nodeEnv: string | undefined;
    port: string | undefined;
    llmModel: string | undefined;
    llmApiKeyConfigured: boolean;
    elevenLabsConfigured: boolean;
    tavilyConfigured: boolean;
    databaseUrlConfigured: boolean;
    uptimeSeconds: number;
    memoryUsageMB: {
      rss: number;
      heapUsed: number;
      heapTotal: number;
      external: number;
    };
  };
  /** Full service configuration matrix, which integrations are live */
  config: {
    openRouterConfigured: boolean;
    openRouterModel: string | undefined;
    openAiConfigured: boolean;
    openAiModel: string | undefined;
    nvidiaConfigured: boolean;
    elevenLabsConfigured: boolean;
    tavilyConfigured: boolean;
    figmaConfigured: boolean;
    weatherConfigured: boolean;
    gmailConfigured: boolean;
    spotifyConfigured: boolean;
    databaseConfigured: boolean;
    browserAutomationConfigured: boolean;
  };
  /** Process / runtime info */
  process: {
    nodeVersion: string;
    platform: string;
    arch: string;
    pid: number;
    cwd: string;
    commandLine: string;
    versions: Record<string, string>;
  };
  /** Request duration in milliseconds (if measurable) */
  durationMs: number | null;
  /** LLM-specific details (if the error came from an LLM call) */
  llm?: {
    model: string;
    endpoint: string;
    apiErrorCode: string | undefined;
    apiErrorMessage: string | undefined;
    apiErrorStatus: number | undefined;
    tokensUsed: number | undefined;
    requestId: string | undefined;
    /** The provider's raw error body (if any) */
    rawError: string | undefined;
    /** The base URL that was being called */
    baseUrl: string | undefined;
  };
}

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "x-api-key",
  "api-key",
  "apikey",
  "x-auth-token",
  "x-access-token",
  "proxy-authorization",
  "set-cookie",
  "x-google-api-key",
  "x-rapidapi-key",
  "x-figma-token",
  "x-openai-api-key",
]);

const SENSITIVE_BODY_KEYS = new Set([
  "fileBase64",
  "password",
  "token",
  "secret",
  "apiKey",
  "api_key",
  "apikey",
  "authorization",
  "auth",
  "key",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "clientSecret",
  "client_secret",
  "OPENROUTER_API_KEY",
  "OPENAI_LLM_API_KEY",
  "ELEVENLABS_API_KEY",
  "TAVILY_API_KEY",
  "FIGMA_ACCESS_TOKEN",
  "DATABASE_URL",
]);

/** Sanitize a stack trace to only include project-internal paths */
function sanitizeStack(stack: string | undefined): string {
  if (!stack) return "No stack trace available";
  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      // Keep lines that reference our project
      return (
        line.includes("/api-server/") ||
        line.includes("/infinity/") ||
        line.includes("node:") ||
        line.includes("at async") ||
        line === line.split("(")[0] // anonymous functions
      );
    })
    .join("\n");
}

/** Redact sensitive header values */
function sanitizeHeader(key: string, value: string): string {
  if (SENSITIVE_HEADERS.has(key.toLowerCase())) return "[REDACTED]";
  if (/key|token|secret|auth|cookie|password/i.test(key)) return "[REDACTED]";
  return value.length > 300 ? value.slice(0, 300) + "..." : value;
}

/** Truncate and redact any value in a body preview */
function sanitizeBodyValue(key: string, value: unknown): unknown {
  if (SENSITIVE_BODY_KEYS.has(key)) return "[REDACTED]";
  if (typeof value === "string") {
    if (value.length > 500) return value.slice(0, 500) + "...";
    // Looks like a base64/secret blob
    if (value.length > 50 && /^[A-Za-z0-9+/=_-]{50,}$/.test(value)) return "[REDACTED blob]";
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, sanitizeBodyValue(k, v)]),
    );
  }
  return value;
}

/** Determine an error code from the error message and type */
function deriveErrorCode(err: Error, msg: string): string {
  const name = err.name.toLowerCase();
  const m = msg.toLowerCase();

  if (m.includes("api key") || m.includes("authentication") || m.includes("401") || m.includes("unauthorized") || m.includes("user not found"))
    return "LLM_AUTH_FAILED";
  if (m.includes("rate limit") || m.includes("429"))
    return "LLM_RATE_LIMITED";
  if (m.includes("timeout") || m.includes("abort"))
    return "REQUEST_TIMEOUT";
  if (m.includes("network") || m.includes("econnrefused") || m.includes("fetch"))
    return "NETWORK_ERROR";
  if (m.includes("database") || m.includes("sqlite") || m.includes("drizzle"))
    return "DATABASE_ERROR";
  if (m.includes("openai") || m.includes("nvidia") || m.includes("llm") || m.includes("openrouter"))
    return "LLM_ERROR";
  if (m.includes("bad gateway") || m.includes("502") || m.includes("upstream"))
    return "UPSTREAM_ERROR";
  if (m.includes("400"))
    return "BAD_REQUEST";
  if (name === "typeerror")
    return "TYPE_ERROR";
  if (name === "referenceerror")
    return "REFERENCE_ERROR";
  if (name === "syntaxerror")
    return "SYNTAX_ERROR";
  if (m.includes("file") || m.includes("pdf") || m.includes("mammoth"))
    return "FILE_PROCESSING_ERROR";
  if (m.includes("browser") || m.includes("puppeteer") || m.includes("websocket"))
    return "BROWSER_ERROR";
  if (m.includes("tts") || m.includes("speech") || m.includes("elevenlabs"))
    return "TTS_ERROR";
  if (m.includes("figma"))
    return "FIGMA_ERROR";

  return "INTERNAL_ERROR";
}

/** Extract LLM-specific error details if present */
function extractLLMDetails(err: Error): ErrorDetail["llm"] {
  const msg = err.message;

  // OpenAI SDK errors carry structured fields, use them when present.
  const errAny = err as unknown as {
    status?: number;
    code?: string;
    request_id?: string;
    headers?: Record<string, string>;
    error?: { message?: string; code?: string; request_id?: string; type?: string };
  };
  const apiStatus = errAny.status;
  const apiCode = errAny.code ?? errAny.error?.code;
  const requestId = errAny.request_id ?? errAny.error?.request_id;

  // Fallback: try to extract HTTP status from error message
  const statusMatch = msg.match(/status[:\\s]*(\\d{3})/i);
  const msgStatus = statusMatch ? parseInt(statusMatch[1], 10) : undefined;

  // Try to extract request ID from message
  const requestIdMatch = msg.match(/request[_-]?id[:\\s]*([a-zA-Z0-9_-]+)/i);

  // Detect the actual endpoint being called
  const openRouter = msg.includes("openrouter") || !!errAny.headers?.["cf-ray"];
  const endpoint = openRouter ? "https://openrouter.ai/api/v1" : "https://integrate.api.nvidia.com/v1";

  return {
    model: process.env["OPENROUTER_MODEL"] ?? process.env["OPENAI_LLM_MODEL"] ?? "unknown",
    endpoint,
    apiErrorCode: apiCode,
    apiErrorMessage: msg.length > 500 ? msg.slice(0, 500) + "..." : msg,
    apiErrorStatus: apiStatus ?? msgStatus,
    tokensUsed: undefined,
    requestId: requestId ?? requestIdMatch?.[1],
    rawError: JSON.stringify(errAny.error ?? {}, null, 2).slice(0, 500) || undefined,
    baseUrl: endpoint,
  };
}

/** Build a complete ErrorDetail object from an error + request */
export function buildErrorDetail(
  err: Error,
  req: Request,
  statusCode: number,
  startMs: number,
): ErrorDetail {
  const now = Date.now();
  const msg = err.message || "Unknown error";

  // Sanitize request body, remove sensitive fields
  const body = req.body as Record<string, unknown> | undefined;
  const bodyKeys = body ? Object.keys(body) : [];

  const sanitizedBody = body ? sanitizeBodyValue("body", body) as Record<string, unknown> : {};
  const bodyPreview = Object.fromEntries(
    Object.entries(sanitizedBody).map(([k, v]) =>
      typeof v === "string" && v.length > 200 ? [k, v.slice(0, 200) + "..."] : [k, v],
    ),
  );
  const bodySizeBytes = body ? JSON.stringify(sanitizedBody).length : 0;

  const mem = process.memoryUsage();
  const pv = process.versions;

  // All request headers, sanitized
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    headers[k] = sanitizeHeader(k, Array.isArray(v) ? v.join(", ") : v);
  }

  const detail: ErrorDetail = {
    message: deriveUserMessage(err, msg),
    code: deriveErrorCode(err, msg),
    timestamp: new Date().toISOString(),
    statusCode,
    errorName: err.name,
    originalMessage: msg,
    stack: sanitizeStack(err.stack),
    request: {
      method: req.method,
      url: req.originalUrl,
      path: req.path,
      query: req.query as Record<string, unknown>,
      params: req.params,
      bodyKeys,
      bodyPreview,
      bodySizeBytes,
      contentType: req.headers["content-type"],
      userAgent: req.headers["user-agent"],
      origin: req.headers["origin"],
      referer: req.headers["referer"],
      ip: req.ip,
      headers,
      body: JSON.stringify(bodyPreview, null, 2).slice(0, 4000),
    },
    environment: {
      nodeEnv: process.env["NODE_ENV"],
      port: process.env["PORT"],
      llmModel: process.env["OPENAI_LLM_MODEL"],
      llmApiKeyConfigured: !!process.env["OPENAI_LLM_API_KEY"],
      elevenLabsConfigured: !!process.env["ELEVENLABS_API_KEY"],
      tavilyConfigured: !!(process.env["TAVILY_API_KEY"] || process.env["WEB_SEARCH_API_KEY"]),
      databaseUrlConfigured: !!process.env["DATABASE_URL"],
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsageMB: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        external: Math.round(mem.external / 1024 / 1024),
      },
    },
    config: {
      openRouterConfigured: !!process.env["OPENROUTER_API_KEY"],
      openRouterModel: process.env["OPENROUTER_MODEL"],
      openAiConfigured: !!process.env["OPENAI_LLM_API_KEY"],
      openAiModel: process.env["OPENAI_LLM_MODEL"],
      nvidiaConfigured: !!process.env["NVIDIA_API_KEY"] || !!process.env["NVIDIA_NIM_API_KEY"] || !!process.env["OPENAI_LLM_API_KEY"],
      elevenLabsConfigured: !!process.env["ELEVENLABS_API_KEY"],
      tavilyConfigured: !!(process.env["TAVILY_API_KEY"] || process.env["WEB_SEARCH_API_KEY"]),
      figmaConfigured: !!process.env["FIGMA_ACCESS_TOKEN"],
      weatherConfigured: true, // Open-Meteo, free, no API key needed
      gmailConfigured: !!process.env["GMAIL_CLIENT_ID"] || !!process.env["GOOGLE_CLIENT_ID"],
      spotifyConfigured: !!process.env["SPOTIFY_CLIENT_ID"],
      databaseConfigured: !!process.env["DATABASE_URL"],
      browserAutomationConfigured: !!(process.env["PUPPETEER_EXECUTABLE_PATH"] || process.env["CHROME_PATH"]),
    },
    process: {
      nodeVersion: process.version,
      platform: `${process.platform}-${process.arch}`,
      arch: process.arch,
      pid: process.pid,
      cwd: process.cwd(),
      commandLine: process.argv.slice(1, 4).join(" ").slice(0, 200),
      versions: {
        node: pv.node ?? "",
        v8: pv.v8 ?? "",
        openssl: pv.openssl ?? "",
        "typescript-ish": "n/a",
      },
    },
    durationMs: now - startMs,
    llm: extractLLMDetails(err),
  };

  return detail;
}

/** Derive a user-friendly message from the error (used in detail.message) */
function deriveUserMessage(err: Error, msg: string): string {
  if (msg.includes("OPENAI_LLM_API_KEY") || msg.includes("OPENROUTER_API_KEY")) return "LLM API key not configured on the server.";
  if (msg.includes("401") || msg.includes("Unauthorized") || msg.includes("User not found")) return "LLM authentication failed, the API key is invalid or expired.";
  if (msg.includes("403")) return "LLM API key denied, verify it has access to this model.";
  if (msg.includes("429") || msg.includes("Rate limit")) return "LLM rate limit exceeded, try again shortly.";
  if (msg.includes("timeout") || msg.includes("abort")) return "Request timed out, check your connection.";
  if (msg.includes("ECONNREFUSED")) return "Backend service unreachable, server may be down.";
  if (msg.includes("502") || msg.includes("Bad Gateway") || msg.includes("upstream")) return "Upstream provider error (502), try again; the free router may pick a different model.";
  if (msg.includes("fetch failed") || msg.includes("network")) return "Network error, unable to reach the server.";
  return msg;
}

/** Lightweight version for routes that don't have a full Express Request */
export function buildSimpleErrorDetail(
  err: Error,
  context: string,
  statusCode: number,
  startMs: number,
): ErrorDetail {
  const now = Date.now();
  const msg = err.message || "Unknown error";
  const mem = process.memoryUsage();
  const pv = process.versions;

  return {
    message: msg,
    code: deriveErrorCode(err, msg),
    timestamp: new Date().toISOString(),
    statusCode,
    errorName: err.name,
    originalMessage: msg,
    stack: sanitizeStack(err.stack),
    request: {
      method: "UNKNOWN",
      url: context,
      path: context,
      query: {},
      params: {},
      bodyKeys: [],
      bodyPreview: {},
      bodySizeBytes: 0,
      contentType: undefined,
      userAgent: undefined,
      origin: undefined,
      referer: undefined,
      ip: undefined,
      headers: {},
      body: "",
    },
    environment: {
      nodeEnv: process.env["NODE_ENV"],
      port: process.env["PORT"],
      llmModel: process.env["OPENAI_LLM_MODEL"],
      llmApiKeyConfigured: !!process.env["OPENAI_LLM_API_KEY"],
      elevenLabsConfigured: !!process.env["ELEVENLABS_API_KEY"],
      tavilyConfigured: !!(process.env["TAVILY_API_KEY"] || process.env["WEB_SEARCH_API_KEY"]),
      databaseUrlConfigured: !!process.env["DATABASE_URL"],
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsageMB: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        external: Math.round(mem.external / 1024 / 1024),
      },
    },
    config: {
      openRouterConfigured: !!process.env["OPENROUTER_API_KEY"],
      openRouterModel: process.env["OPENROUTER_MODEL"],
      openAiConfigured: !!process.env["OPENAI_LLM_API_KEY"],
      openAiModel: process.env["OPENAI_LLM_MODEL"],
      nvidiaConfigured: !!process.env["NVIDIA_API_KEY"] || !!process.env["NVIDIA_NIM_API_KEY"] || !!process.env["OPENAI_LLM_API_KEY"],
      elevenLabsConfigured: !!process.env["ELEVENLABS_API_KEY"],
      tavilyConfigured: !!(process.env["TAVILY_API_KEY"] || process.env["WEB_SEARCH_API_KEY"]),
      figmaConfigured: !!process.env["FIGMA_ACCESS_TOKEN"],
      weatherConfigured: true, // Open-Meteo, free, no API key needed
      gmailConfigured: !!process.env["GMAIL_CLIENT_ID"] || !!process.env["GOOGLE_CLIENT_ID"],
      spotifyConfigured: !!process.env["SPOTIFY_CLIENT_ID"],
      databaseConfigured: !!process.env["DATABASE_URL"],
      browserAutomationConfigured: !!(process.env["PUPPETEER_EXECUTABLE_PATH"] || process.env["CHROME_PATH"]),
    },
    process: {
      nodeVersion: process.version,
      platform: `${process.platform}-${process.arch}`,
      arch: process.arch,
      pid: process.pid,
      cwd: process.cwd(),
      commandLine: process.argv.slice(1, 4).join(" ").slice(0, 200),
      versions: {
        node: pv.node ?? "",
        v8: pv.v8 ?? "",
        openssl: pv.openssl ?? "",
        "typescript-ish": "n/a",
      },
    },
    durationMs: now - startMs,
    llm: extractLLMDetails(err),
  };
}
