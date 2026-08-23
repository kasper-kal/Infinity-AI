/**
 * MCP Servers Routes — Project-scoped MCP server management
 *
 * Handles CRUD for MCP server configurations, connection management,
 * tool discovery, and testing.
 */

import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../../middleware/auth-middleware.js';
import {
  getMCPRegistry,
  setupProjectMCPServers,
  type MCPServerConfig,
  type MCPRegistry,
} from '../../lib/mcp-registry.js';
import { BUILTIN_MCP_SERVERS } from '../../lib/mcp-client.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

function getProjectId(req: AuthenticatedRequest): string {
  const pid = req.params.projectId;
  return Array.isArray(pid) ? pid[0] : pid;
}

function getServerId(req: AuthenticatedRequest): string {
  const sid = req.params.serverId;
  return Array.isArray(sid) ? sid[0] : sid;
}

/**
 * GET /api/jarvis/mcp-servers/:projectId
 * List all MCP servers for a project
 */
router.get('/:projectId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID required' });
    }

    const registry: MCPRegistry = getMCPRegistry(projectId);
    const summary = registry.getSummary();

    return res.json({
      projectId,
      ...summary,
      builtinServers: Object.entries(BUILTIN_MCP_SERVERS).map(([key, value]) => ({
        type: key,
        name: value.name,
        description: getBuiltinDescription(key),
      })),
    });
  } catch (error) {
    console.error('[MCP Servers] List error:', error);
    return res.status(500).json({ error: 'Failed to list MCP servers' });
  }
});

/**
 * GET /api/jarvis/mcp-servers/:projectId/builtin
 * List available built-in MCP server templates
 */
router.get('/:projectId/builtin', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID required' });
    }

    return res.json({
      builtinServers: Object.entries(BUILTIN_MCP_SERVERS).map(([key, value]) => ({
        type: key,
        name: value.name,
        description: getBuiltinDescription(key),
        transportType: value.transport.type,
        requiredConfig: getBuiltinRequiredConfig(key),
      })),
    });
  } catch (error) {
    console.error('[MCP Servers] Builtin list error:', error);
    return res.status(500).json({ error: 'Failed to list built-in MCP servers' });
  }
});

/**
 * POST /api/jarvis/mcp-servers/:projectId
 * Add a new MCP server configuration
 */
router.post('/:projectId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const {
      id,
      name,
      type, // built-in type or 'custom'
      transport,
      config, // server-specific config (API keys, paths, etc.)
      enabled = true,
    } = req.body;

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID required' });
    }

    if (!id || !name || !transport) {
      return res.status(400).json({ error: 'Missing required fields: id, name, transport' });
    }

    const registry: MCPRegistry = getMCPRegistry(projectId);

    if (type && BUILTIN_MCP_SERVERS[type as keyof typeof BUILTIN_MCP_SERVERS]) {
      // Built-in server - apply config overrides
      const overrides: any = {};
      if (type === 'filesystem' && config?.projectPath) {
        overrides.projectPath = config.projectPath;
      } else if (type === 'filesystem') {
        overrides.projectPath = process.cwd();
      }

      if (config) {
        if (type === 'postgres' && config.connectionString) {
          overrides.env = { POSTGRES_CONNECTION_STRING: config.connectionString };
        } else if (type === 'sqlite' && config.dbPath) {
          overrides.env = { SQLITE_DB_PATH: config.dbPath };
        } else if (type === 'github' && config.token) {
          overrides.headers = { Authorization: `Bearer ${config.token}` };
        } else if (type === 'braveSearch' && config.apiKey) {
          overrides.env = { BRAVE_API_KEY: config.apiKey };
        } else if (type === 'slack' && config.token) {
          overrides.headers = { Authorization: `Bearer ${config.token}` };
        }
      }

      await registry.connectBuiltinServer(type as keyof typeof BUILTIN_MCP_SERVERS, id, overrides);
    } else {
      // Custom server
      const serverConfig: MCPServerConfig = {
        id,
        name,
        transport,
        enabled,
        projectId,
      };
      await registry.addServer(serverConfig);
    }

    return res.json({ success: true, serverId: id });
  } catch (error) {
    console.error('[MCP Servers] Add error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to add MCP server' });
  }
});

/**
 * PUT /api/jarvis/mcp-servers/:projectId/:serverId
 * Update an MCP server configuration
 */
router.put('/:projectId/:serverId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const serverId = getServerId(req);
    const { name, transport, config, enabled } = req.body;

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID required' });
    }

    const registry: MCPRegistry = getMCPRegistry(projectId);
    const manager = registry.getManager();
    const existingConfig = manager.getConfig(serverId);

    if (!existingConfig) {
      return res.status(404).json({ error: 'MCP server not found' });
    }

    // Update config in manager
    manager.updateConfig(serverId, { name, transport, enabled });

    // If transport changed or enabled changed, need to reconnect
    if (transport && enabled !== false) {
      await registry.disconnectServer(serverId);
      const newConfig: MCPServerConfig = {
        ...existingConfig,
        name: name || existingConfig.name,
        transport,
        enabled: enabled ?? true,
      };
      await registry.addServer(newConfig);
    } else if (enabled === false) {
      await registry.disconnectServer(serverId);
    } else if (enabled === true) {
      await registry.connectServer(serverId);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('[MCP Servers] Update error:', error);
    return res.status(500).json({ error: 'Failed to update MCP server' });
  }
});

/**
 * DELETE /api/jarvis/mcp-servers/:projectId/:serverId
 * Remove an MCP server
 */
router.delete('/:projectId/:serverId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const serverId = getServerId(req);

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID required' });
    }

    const registry: MCPRegistry = getMCPRegistry(projectId);
    await registry.removeServer(serverId);

    return res.json({ success: true });
  } catch (error) {
    console.error('[MCP Servers] Delete error:', error);
    return res.status(500).json({ error: 'Failed to delete MCP server' });
  }
});

/**
 * POST /api/jarvis/mcp-servers/:projectId/:serverId/connect
 * Connect to an MCP server
 */
router.post('/:projectId/:serverId/connect', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const serverId = getServerId(req);

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID required' });
    }

    const registry: MCPRegistry = getMCPRegistry(projectId);
    await registry.connectServer(serverId);

    const status = registry.getServerStatus(serverId);
    return res.json({ success: true, status });
  } catch (error) {
    console.error('[MCP Servers] Connect error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to connect' });
  }
});

/**
 * POST /api/jarvis/mcp-servers/:projectId/:serverId/disconnect
 * Disconnect from an MCP server
 */
router.post('/:projectId/:serverId/disconnect', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const serverId = getServerId(req);

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID required' });
    }

    const registry: MCPRegistry = getMCPRegistry(projectId);
    await registry.disconnectServer(serverId);

    const status = registry.getServerStatus(serverId);
    return res.json({ success: true, status });
  } catch (error) {
    console.error('[MCP Servers] Disconnect error:', error);
    return res.status(500).json({ error: 'Failed to disconnect' });
  }
});

/**
 * GET /api/jarvis/mcp-servers/:projectId/:serverId/tools
 * List tools from a connected MCP server
 */
router.get('/:projectId/:serverId/tools', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const serverId = getServerId(req);

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID required' });
    }

    const registry: MCPRegistry = getMCPRegistry(projectId);
    const client = registry.getClient(serverId);

    if (!client) {
      return res.status(404).json({ error: 'MCP server not found' });
    }

    if (!client.isConnected()) {
      return res.status(400).json({ error: 'MCP server not connected' });
    }

    const tools = client.getTools();
    return res.json({ tools });
  } catch (error) {
    console.error('[MCP Servers] List tools error:', error);
    return res.status(500).json({ error: 'Failed to list tools' });
  }
});

/**
 * GET /api/jarvis/mcp-servers/:projectId/:serverId/resources
 * List resources from a connected MCP server
 */
router.get('/:projectId/:serverId/resources', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const serverId = getServerId(req);

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID required' });
    }

    const registry: MCPRegistry = getMCPRegistry(projectId);
    const client = registry.getClient(serverId);

    if (!client) {
      return res.status(404).json({ error: 'MCP server not found' });
    }

    if (!client.isConnected()) {
      return res.status(400).json({ error: 'MCP server not connected' });
    }

    const resources = client.getResources();
    return res.json({ resources });
  } catch (error) {
    console.error('[MCP Servers] List resources error:', error);
    return res.status(500).json({ error: 'Failed to list resources' });
  }
});

/**
 * GET /api/jarvis/mcp-servers/:projectId/:serverId/prompts
 * List prompts from a connected MCP server
 */
router.get('/:projectId/:serverId/prompts', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const serverId = getServerId(req);

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID required' });
    }

    const registry: MCPRegistry = getMCPRegistry(projectId);
    const client = registry.getClient(serverId);

    if (!client) {
      return res.status(404).json({ error: 'MCP server not found' });
    }

    if (!client.isConnected()) {
      return res.status(400).json({ error: 'MCP server not connected' });
    }

    const prompts = client.getPrompts();
    return res.json({ prompts });
  } catch (error) {
    console.error('[MCP Servers] List prompts error:', error);
    return res.status(500).json({ error: 'Failed to list prompts' });
  }
});

/**
 * POST /api/jarvis/mcp-servers/:projectId/:serverId/test
 * Test an MCP server connection
 */
router.post('/:projectId/:serverId/test', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const serverId = getServerId(req);

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID required' });
    }

    const registry: MCPRegistry = getMCPRegistry(projectId);
    const client = registry.getClient(serverId);

    if (!client) {
      return res.status(404).json({ error: 'MCP server not found' });
    }

    // Try to connect if not connected
    if (!client.isConnected()) {
      try {
        await client.connect();
      } catch (err) {
        return res.json({
          success: false,
          connected: false,
          error: err instanceof Error ? err.message : 'Connection failed',
        });
      }
    }

    // Try to list tools as a connectivity test
    try {
      const tools = await client.listTools();
      return res.json({
        success: true,
        connected: true,
        toolsCount: tools.length,
        serverInfo: client.getServerInfo(),
      });
    } catch (err) {
      return res.json({
        success: false,
        connected: client.isConnected(),
        error: err instanceof Error ? err.message : 'Test failed',
      });
    }
  } catch (error) {
    console.error('[MCP Servers] Test error:', error);
    return res.status(500).json({ error: 'Failed to test connection' });
  }
});

/**
 * POST /api/jarvis/mcp-servers/:projectId/:serverId/call-tool
 * Call a tool on an MCP server (for testing)
 */
router.post('/:projectId/:serverId/call-tool', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);
    const serverId = getServerId(req);
    const { toolName, args } = req.body;

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID required' });
    }

    if (!toolName) {
      return res.status(400).json({ error: 'Missing toolName' });
    }

    const registry: MCPRegistry = getMCPRegistry(projectId);
    const client = registry.getClient(serverId);

    if (!client) {
      return res.status(404).json({ error: 'MCP server not found' });
    }

    if (!client.isConnected()) {
      return res.status(400).json({ error: 'MCP server not connected' });
    }

    const result = await client.callTool(toolName, args || {});
    return res.json({ success: true, result });
  } catch (error) {
    console.error('[MCP Servers] Call tool error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to call tool' });
  }
});

/**
 * GET /api/jarvis/mcp-servers/:projectId/status
 * Get overall MCP registry status for a project
 */
router.get('/:projectId/status', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = getProjectId(req);

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID required' });
    }

    const registry: MCPRegistry = getMCPRegistry(projectId);
    const summary = registry.getSummary();

    return res.json(summary);
  } catch (error) {
    console.error('[MCP Servers] Status error:', error);
    return res.status(500).json({ error: 'Failed to get status' });
  }
});

// ============================================================================
// Helpers
// ============================================================================

function getBuiltinDescription(type: string): string {
  const descriptions: Record<string, string> = {
    filesystem: 'Access local filesystem (read, write, list files)',
    github: 'GitHub API integration (repos, issues, PRs, actions)',
    postgres: 'PostgreSQL database queries and management',
    sqlite: 'SQLite database queries and management',
    slack: 'Slack workspace integration (channels, messages, users)',
    braveSearch: 'Web search via Brave Search API',
    fetch: 'HTTP fetch capabilities for web content',
    puppeteer: 'Browser automation via Puppeteer',
  };
  return descriptions[type] || 'MCP server';
}

function getBuiltinRequiredConfig(type: string): string[] {
  const configs: Record<string, string[]> = {
    filesystem: ['projectPath'],
    github: ['token'],
    postgres: ['connectionString'],
    sqlite: ['dbPath'],
    slack: ['token'],
    braveSearch: ['apiKey'],
    fetch: [],
    puppeteer: [],
  };
  return configs[type] || [];
}

export default router;