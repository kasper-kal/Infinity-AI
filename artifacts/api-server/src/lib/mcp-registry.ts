/**
 * MCP Registry — Auto-registers MCP tools in Universal Tool Registry
 *
 * Manages multiple MCP server connections, discovers tools/resources/prompts,
 * and registers them as universal tools with `mcp.{serverId}.{toolName}` namespace.
 */

import { EventEmitter } from 'events';
import { pool } from '@workspace/db';
import crypto from 'crypto';
import {
  MCPClient,
  MCPClientManager,
  MCPServerConfig,
  BUILTIN_MCP_SERVERS,
  createBuiltinMCPClient,
} from './mcp-client.js';
import { registerTool, getAllTools, clearRegistry } from './tool-registry.js';
import type { UniversalToolDefinition } from './tool-types.js';

// Re-export for convenience
export {
  MCPClient,
  MCPClientManager,
  createBuiltinMCPClient,
} from './mcp-client.js';
export type {
  MCPServerConfig,
  BUILTIN_MCP_SERVERS,
} from './mcp-client.js';

// ============================================================================
// Types
// ============================================================================

export interface MCPRegistryConfig {
  /** Project ID for project-scoped connections */
  projectId?: string;
  /** Path to store encrypted server configs */
  configPath?: string;
  /** Encryption key for secrets (derived from project/user) */
  encryptionKey?: string;
}

export interface RegisteredMCPServer extends MCPServerConfig {
  connected: boolean;
  lastConnected?: number;
  lastError?: string;
  toolsCount: number;
  resourcesCount: number;
  promptsCount: number;
}

export interface MCPToolRegistration {
  serverId: string;
  toolName: string;
  universalName: string; // mcp.{serverId}.{toolName}
  description: string;
  inputSchema: Record<string, unknown>;
}

// ============================================================================
// Encryption utilities for sensitive config fields
// ============================================================================

function getEncryptionKey(projectId: string): crypto.CipherKey {
  // Derive a project-specific encryption key
  // In production, this should come from a secure key management system
  const baseKey = process.env.MCP_ENCRYPTION_KEY || 'infinity-mcp-default-key-change-in-production';
  return crypto.createHash('sha256').update(baseKey + projectId).digest();
}

function encrypt(value: string, projectId: string): string {
  try {
    const key = getEncryptionKey(projectId);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Store as: iv:authTag:encrypted (all base64)
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  } catch {
    return value; // Fallback: store as-is if encryption fails
  }
}

function decrypt(value: string, projectId: string): string {
  try {
    const parts = value.split(':');
    if (parts.length !== 3) return value; // Not encrypted
    const key = getEncryptionKey(projectId);
    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const encrypted = Buffer.from(parts[2], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return value; // Fallback: return as-is if decryption fails
  }
}

function encryptConfig(config: Record<string, unknown>, projectId: string): Record<string, unknown> {
  const sensitiveKeys = ['token', 'apiKey', 'connectionString', 'password', 'secret', 'key', 'authorization'];
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && sensitiveKeys.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
      result[key] = encrypt(value, projectId);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = encryptConfig(value as Record<string, unknown>, projectId);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function decryptConfig(config: Record<string, unknown>, projectId: string): Record<string, unknown> {
  const sensitiveKeys = ['token', 'apiKey', 'connectionString', 'password', 'secret', 'key', 'authorization'];
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && sensitiveKeys.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
      result[key] = decrypt(value, projectId);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = decryptConfig(value as Record<string, unknown>, projectId);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ============================================================================
// MCP Registry
// ============================================================================

export class MCPRegistry extends EventEmitter {
  private manager: MCPClientManager;
  private config: MCPRegistryConfig;
  private registeredTools = new Map<string, MCPToolRegistration>();
  private serverStatus = new Map<string, RegisteredMCPServer>();

  constructor(config: MCPRegistryConfig = {}) {
    super();
    this.config = {
      projectId: config.projectId,
      configPath: config.configPath || '.infinity/mcp-servers.json',
      encryptionKey: config.encryptionKey,
    };
    this.manager = new MCPClientManager();
    this.setupManagerListeners();
    // Load configs from database on initialization
    this.loadConfigs();
  }

  private setupManagerListeners(): void {
    this.manager.on('serverConnected', (serverId: string) => {
      this.updateServerStatus(serverId, { connected: true, lastConnected: Date.now(), lastError: undefined });
      this.registerServerTools(serverId);
      this.emit('serverConnected', serverId);
    });

    this.manager.on('serverDisconnected', (serverId: string) => {
      this.updateServerStatus(serverId, { connected: false });
      this.unregisterServerTools(serverId);
      this.emit('serverDisconnected', serverId);
    });

    this.manager.on('serverError', (serverId: string, error: Error) => {
      this.updateServerStatus(serverId, { lastError: error.message });
      this.emit('serverError', serverId, error);
    });

    this.manager.on('toolsChanged', (serverId: string) => {
      this.registerServerTools(serverId);
      this.emit('toolsChanged', serverId);
    });

    this.manager.on('resourcesChanged', (serverId: string) => {
      this.emit('resourcesChanged', serverId);
    });
  }

  private updateServerStatus(serverId: string, updates: Partial<RegisteredMCPServer>): void {
    const current = this.serverStatus.get(serverId) || {
      id: serverId,
      name: '',
      transport: { type: 'stdio' as const, command: '', args: [] },
      enabled: false,
      connected: false,
      toolsCount: 0,
      resourcesCount: 0,
      promptsCount: 0,
    };
    this.serverStatus.set(serverId, { ...current, ...updates });
  }

  /**
   * Add an MCP server configuration
   */
  async addServer(config: MCPServerConfig): Promise<void> {
    // Store config
    await this.manager.addServer(config);

    // Update status
    const client = this.manager.getClient(config.id);
    if (client) {
      this.updateServerStatus(config.id, {
        id: config.id,
        name: config.name,
        transport: config.transport,
        enabled: config.enabled,
        connected: client.isConnected(),
        toolsCount: client.getTools().length,
        resourcesCount: client.getResources().length,
        promptsCount: client.getPrompts().length,
      });
    }

    // Persist config
    await this.persistConfigs();

    this.emit('serverAdded', config.id);
  }

  /**
   * Remove an MCP server
   */
  async removeServer(id: string): Promise<void> {
    await this.manager.removeServer(id);
    this.serverStatus.delete(id);
    await this.persistConfigs();
    this.emit('serverRemoved', id);
  }

  /**
   * Connect to a server
   */
  async connectServer(id: string): Promise<void> {
    const config = this.manager.getConfig(id);
    if (config) {
      config.enabled = true;
      await this.manager.connectServer(id);
      await this.persistConfigs();
    }
  }

  /**
   * Disconnect from a server
   */
  async disconnectServer(id: string): Promise<void> {
    const config = this.manager.getConfig(id);
    if (config) {
      config.enabled = false;
      await this.manager.disconnectServer(id);
      await this.persistConfigs();
    }
  }

  /**
   * Register tools from a connected server in the Universal Tool Registry
   */
  private registerServerTools(serverId: string): void {
    const client = this.manager.getClient(serverId);
    if (!client || !client.isConnected()) return;

    // Unregister existing tools for this server first
    this.unregisterServerTools(serverId);

    const tools = client.getTools();
    for (const tool of tools) {
      const universalName = `mcp.${serverId}.${tool.name}`;

      // Create universal tool definition
      const universalTool: UniversalToolDefinition = {
        name: universalName,
        description: `[MCP:${serverId}] ${tool.description || tool.name}`,
        category: 'integration',
        risk: 'EXTERNAL_ACTION',
        parameters: tool.inputSchema,
        execute: async (args, ctx) => {
          try {
            const result = await client.callTool(tool.name, args as Record<string, unknown>);
            if (result.isError) {
              const errorMsg = result.content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n');
              throw new Error(errorMsg || 'MCP tool error');
            }
            const textContent = result.content
              .filter(c => c.type === 'text')
              .map(c => c.text)
              .join('\n');
            return {
              success: true,
              data: textContent,
              metadata: { mcpServer: serverId, mcpTool: tool.name },
            };
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : String(error),
              metadata: { mcpServer: serverId, mcpTool: tool.name },
            };
          }
        },
        timeoutMs: 60000,
      };

      // Register in universal registry
      try {
        registerTool(universalTool);
        this.registeredTools.set(universalName, {
          serverId,
          toolName: tool.name,
          universalName,
          description: tool.description || tool.name,
          inputSchema: tool.inputSchema,
        });
      } catch (err) {
        console.error(`[MCP Registry] Failed to register tool ${universalName}:`, err);
      }
    }

    // Update server status
    this.updateServerStatus(serverId, {
      toolsCount: tools.length,
      resourcesCount: client.getResources().length,
      promptsCount: client.getPrompts().length,
    });

    console.log(`[MCP Registry] Registered ${tools.length} tools from server ${serverId}`);
  }

  /**
   * Unregister tools from a server
   */
  private unregisterServerTools(serverId: string): void {
    const prefix = `mcp.${serverId}.`;
    for (const [universalName] of this.registeredTools) {
      if (universalName.startsWith(prefix)) {
        // Note: tool-registry doesn't have unregister, so we track manually
        // In a full implementation, we'd add unregisterTool to tool-registry
        this.registeredTools.delete(universalName);
      }
    }
    // For now, we can't actually remove from toolRegistry, but we track it
    // A proper implementation would need clearRegistry + re-register all
  }

  /**
   * Get all registered MCP tools
   */
  getRegisteredTools(): MCPToolRegistration[] {
    return Array.from(this.registeredTools.values());
  }

  /**
   * Get server status
   */
  getServerStatus(id: string): RegisteredMCPServer | undefined {
    return this.serverStatus.get(id);
  }

  /**
   * Get all server statuses
   */
  getAllServerStatuses(): RegisteredMCPServer[] {
    return Array.from(this.serverStatus.values());
  }

  /**
   * Get the underlying manager for advanced operations
   */
  getManager(): MCPClientManager {
    return this.manager;
  }

  /**
   * Get client for a specific server
   */
  getClient(serverId: string): MCPClient | undefined {
    return this.manager.getClient(serverId);
  }

  /**
   * Connect to a built-in server with overrides
   */
  async connectBuiltinServer(
    serverKey: keyof typeof BUILTIN_MCP_SERVERS,
    serverId: string,
    overrides: {
      projectPath?: string; // for filesystem server
      env?: Record<string, string>;
      headers?: Record<string, string>;
    } = {}
  ): Promise<MCPClient> {
    const builtin = BUILTIN_MCP_SERVERS[serverKey];
    if (!builtin) {
      throw new Error(`Unknown built-in server: ${serverKey}`);
    }

    // Prepare transport config with overrides
    const transport = { ...builtin.transport } as any;

    // Apply project path for filesystem server
    if (serverKey === 'filesystem' && overrides.projectPath) {
      transport.args = [...transport.args, overrides.projectPath];
    }

    // Apply env overrides
    if (overrides.env && transport.env) {
      transport.env = { ...transport.env, ...overrides.env };
    } else if (overrides.env) {
      transport.env = overrides.env;
    }

    // Apply headers for HTTP servers
    if (overrides.headers && transport.headers) {
      transport.headers = { ...transport.headers, ...overrides.headers };
    } else if (overrides.headers) {
      transport.headers = overrides.headers;
    }

    const config: MCPServerConfig = {
      id: serverId,
      name: builtin.name,
      transport,
      enabled: true,
      projectId: this.config.projectId,
    };

    await this.addServer(config);
    return this.manager.getClient(serverId)!;
  }

  /**
   * Load persisted server configurations from database
   */
  async loadConfigs(): Promise<void> {
    if (!this.config.projectId) {
      console.log('[MCP Registry] No projectId, skipping database load');
      this.emit('configsLoaded');
      return;
    }

    try {
      const result = await pool.query(
        `SELECT * FROM "mcp_servers" WHERE "project_id" = $1`,
        [this.config.projectId]
      );

      for (const row of result.rows) {
        const config = decryptConfig(row.config as Record<string, unknown>, this.config.projectId);

        // Reconstruct transport config
        const transportConfig = row.transport_config as Record<string, unknown>;
        const transport = {
          type: row.transport_type,
          ...transportConfig,
        };

        const serverConfig: MCPServerConfig = {
          id: row.server_id,
          name: row.name,
          transport: transport as any,
          enabled: row.enabled,
          projectId: this.config.projectId,
          config: config,
          // Store builtin_type for reference
          builtinType: row.builtin_type as keyof typeof BUILTIN_MCP_SERVERS | undefined,
        };

        // Add to manager (but don't auto-connect yet)
        await this.manager.addServer(serverConfig);

        // Update status
        const client = this.manager.getClient(row.server_id);
        if (client) {
          this.updateServerStatus(row.server_id, {
            id: row.server_id,
            name: row.name,
            transport: transport as any,
            enabled: row.enabled,
            connected: client.isConnected(),
            toolsCount: client.getTools().length,
            resourcesCount: client.getResources().length,
            promptsCount: client.getPrompts().length,
          });
        }
      }

      console.log(`[MCP Registry] Loaded ${result.rows.length} server configs from database`);
      this.emit('configsLoaded');
    } catch (error) {
      console.error('[MCP Registry] Failed to load configs from database:', error);
      this.emit('configsLoaded'); // Still emit to avoid blocking
    }
  }

  /**
   * Persist server configurations to database with encryption
   */
  private async persistConfigs(): Promise<void> {
    if (!this.config.projectId) {
      console.log('[MCP Registry] No projectId, skipping database persist');
      return;
    }

    try {
      const configs = this.manager.getAllConfigs();

      for (const config of configs) {
        const status = this.serverStatus.get(config.id);
        const encryptedConfig = encryptConfig(config.config || {}, this.config.projectId);

        // Extract transport config (remove type)
        const { type: transportType, ...transportConfig } = config.transport;

        await pool.query(
          `INSERT INTO "mcp_servers"
            ("project_id", "server_id", "name", "transport_type", "transport_config", "builtin_type", "config", "enabled", "updated_at")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT ("project_id", "server_id") DO UPDATE SET
             "name" = EXCLUDED."name",
             "transport_type" = EXCLUDED."transport_type",
             "transport_config" = EXCLUDED."transport_config",
             "builtin_type" = EXCLUDED."builtin_type",
             "config" = EXCLUDED."config",
             "enabled" = EXCLUDED."enabled",
             "updated_at" = NOW()`,
          [
            this.config.projectId,
            config.id,
            config.name,
            transportType,
            JSON.stringify(transportConfig),
            (config as any).builtinType || null,
            JSON.stringify(encryptedConfig),
            config.enabled,
          ]
        );
      }

      console.log(`[MCP Registry] Persisted ${configs.length} server configs to database`);
      this.emit('configsPersisted', configs);
    } catch (error) {
      console.error('[MCP Registry] Failed to persist configs to database:', error);
    }
  }

  /**
   * Discover all tools from all connected servers (for LLM)
   */
  getAllMCPTools(): UniversalToolDefinition[] {
    return this.manager.getAllTools('mcp');
  }

  /**
   * Get summary of all connected servers and their capabilities
   */
  getSummary(): {
    totalServers: number;
    connectedServers: number;
    totalTools: number;
    totalResources: number;
    totalPrompts: number;
    servers: RegisteredMCPServer[];
  } {
    const servers = this.getAllServerStatuses();
    const connected = servers.filter(s => s.connected);
    return {
      totalServers: servers.length,
      connectedServers: connected.length,
      totalTools: servers.reduce((sum, s) => sum + s.toolsCount, 0),
      totalResources: servers.reduce((sum, s) => sum + s.resourcesCount, 0),
      totalPrompts: servers.reduce((sum, s) => sum + s.promptsCount, 0),
      servers,
    };
  }

  /**
   * Shutdown all connections
   */
  async shutdown(): Promise<void> {
    for (const client of this.manager.getAllClients()) {
      await client.disconnect();
    }
    this.manager.removeAllListeners();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton instance (per project)
// ============================================================================

const registryInstances = new Map<string, MCPRegistry>();

export function getMCPRegistry(projectId?: string): MCPRegistry {
  const key = projectId || 'global';
  if (!registryInstances.has(key)) {
    registryInstances.set(key, new MCPRegistry({ projectId: key }));
  }
  return registryInstances.get(key)!;
}

export function clearMCPRegistry(projectId?: string): void {
  const key = projectId || 'global';
  const registry = registryInstances.get(key);
  if (registry) {
    registry.shutdown();
    registryInstances.delete(key);
  }
}

// ============================================================================
// Helper: Register built-in servers for a project
// ============================================================================

export async function setupProjectMCPServers(
  projectId: string,
  projectPath: string,
  servers: Array<{
    type: keyof typeof BUILTIN_MCP_SERVERS;
    id: string;
    config?: Record<string, unknown>;
  }>
): Promise<MCPRegistry> {
  const registry = getMCPRegistry(projectId);

  for (const server of servers) {
    const overrides: { projectPath?: string; env?: Record<string, string>; headers?: Record<string, string> } = {};

    if (server.type === 'filesystem') {
      overrides.projectPath = projectPath;
    }

    if (server.config) {
      // Apply server-specific config
      if (server.type === 'postgres' && server.config.connectionString) {
        overrides.env = { POSTGRES_CONNECTION_STRING: server.config.connectionString as string };
      } else if (server.type === 'sqlite' && server.config.dbPath) {
        overrides.env = { SQLITE_DB_PATH: server.config.dbPath as string };
      } else if (server.type === 'github' && server.config.token) {
        overrides.headers = { Authorization: `Bearer ${server.config.token}` };
      } else if (server.type === 'braveSearch' && server.config.apiKey) {
        overrides.env = { BRAVE_API_KEY: server.config.apiKey as string };
      } else if (server.type === 'slack' && server.config.token) {
        overrides.headers = { Authorization: `Bearer ${server.config.token}` };
      }
    }

    try {
      await registry.connectBuiltinServer(server.type, server.id, overrides);
    } catch (err) {
      console.error(`[MCP Registry] Failed to connect ${server.id} (${server.type}):`, err);
    }
  }

  return registry;
}

export default MCPRegistry;