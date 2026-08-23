/**
 * MCP Server Authentication
 *
 * Validates the Infinity API key provided during MCP initialization.
 * The API key is the same `INFINITY_API_KEY` used by the CLI and headless mode.
 */

import axios from "axios";

export interface AuthConfig {
  /** Base URL of the Infinity API server (e.g. http://localhost:8080) */
  apiBaseUrl: string;
  /** The Infinity API key to authenticate with */
  apiKey: string;
}

export interface AuthResult {
  valid: boolean;
  scopes: string[];
  projectId?: string;
  userId?: string;
  error?: string;
}

/**
 * Validate an Infinity API key against the API server.
 * Returns the key's scopes and default project if valid.
 */
export async function validateApiKey(config: AuthConfig): Promise<AuthResult> {
  try {
    const response = await axios.get(`${config.apiBaseUrl}/api/infinity-ai/auth/me`, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "X-API-Key": config.apiKey,
      },
      timeout: 10000,
    });

    if (response.status === 200 && response.data) {
      return {
        valid: true,
        scopes: response.data.scopes || ["build:read", "build:write", "research:read", "research:write"],
        userId: response.data.userId,
        projectId: response.data.defaultProjectId,
      };
    }

    return { valid: false, scopes: [], error: "Invalid API key" };
  } catch (error) {
    const message = axios.isAxiosError(error)
      ? error.response?.data?.error || error.message
      : String(error);
    return { valid: false, scopes: [], error: message };
  }
}

/**
 * Check if a scope is present in the granted scopes list.
 * Supports wildcard `*` and prefix matching (e.g. `build:*`).
 */
export function hasScope(scopes: string[], required: string): boolean {
  if (scopes.includes("*")) return true;
  if (scopes.includes(required)) return true;
  const [domain] = required.split(":");
  return scopes.includes(`${domain}:*`);
}

/**
 * Require a scope or throw an MCP error.
 */
export function requireScope(scopes: string[], required: string): void {
  if (!hasScope(scopes, required)) {
    throw new Error(`Insufficient scope: required '${required}', have [${scopes.join(", ")}]`);
  }
}
