/**
 * MCP Config Panel — Manage MCP servers in Settings
 *
 * Allows adding, removing, configuring, and testing MCP server connections.
 * Supports built-in server templates and custom configurations.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Button, IconButton, ButtonGroup } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Dialog, AlertDialog } from "@/components/ui/Dialog";
import { Badge } from "@/components/ui/badge";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";

export interface MCPConfigPanelProps {
  /** Project ID for project-scoped MCP servers */
  projectId: string;
  /** Callback when server list changes */
  onServersChange?: () => void;
}

type TransportType = 'stdio' | 'http' | 'websocket';

interface BuiltinServerTemplate {
  type: string;
  name: string;
  description: string;
  transportType: TransportType;
  requiredConfig: string[];
}

interface MCPServerConfig {
  id: string;
  name: string;
  transport: {
    type: TransportType;
    command?: string;
    args?: string[];
    url?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
  };
  enabled: boolean;
  projectId: string;
  builtinType?: string;
}

interface MCPServerStatus {
  id: string;
  name: string;
  connected: boolean;
  toolsCount: number;
  resourcesCount: number;
  promptsCount: number;
  lastError?: string;
  transportType: TransportType;
}

const BUILTIN_TEMPLATES: BuiltinServerTemplate[] = [
  {
    type: 'filesystem',
    name: 'Filesystem',
    description: 'Access local filesystem (read, write, list files)',
    transportType: 'stdio',
    requiredConfig: ['projectPath'],
  },
  {
    type: 'github',
    name: 'GitHub',
    description: 'GitHub API integration (repos, issues, PRs, actions)',
    transportType: 'http',
    requiredConfig: ['token'],
  },
  {
    type: 'postgres',
    name: 'PostgreSQL',
    description: 'PostgreSQL database queries and management',
    transportType: 'stdio',
    requiredConfig: ['connectionString'],
  },
  {
    type: 'sqlite',
    name: 'SQLite',
    description: 'SQLite database queries and management',
    transportType: 'stdio',
    requiredConfig: ['dbPath'],
  },
  {
    type: 'slack',
    name: 'Slack',
    description: 'Slack workspace integration (channels, messages, users)',
    transportType: 'http',
    requiredConfig: ['token'],
  },
  {
    type: 'braveSearch',
    name: 'Brave Search',
    description: 'Web search via Brave Search API',
    transportType: 'http',
    requiredConfig: ['apiKey'],
  },
  {
    type: 'fetch',
    name: 'Fetch',
    description: 'HTTP fetch capabilities for web content',
    transportType: 'stdio',
    requiredConfig: [],
  },
  {
    type: 'puppeteer',
    name: 'Puppeteer',
    description: 'Browser automation via Puppeteer',
    transportType: 'stdio',
    requiredConfig: [],
  },
];

export const MCPConfigPanel: React.FC<MCPConfigPanelProps> = ({
  projectId,
  onServersChange,
}) => {
  const { t } = useI18n();
  const [servers, setServers] = useState<MCPServerStatus[]>([]);
  const [builtinTemplates, setBuiltinTemplates] = useState<BuiltinServerTemplate[]>(BUILTIN_TEMPLATES);
  const [loading, setLoading] = useState(true);
  const [addingServer, setAddingServer] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [testingServerId, setTestingServerId] = useState<string | null>(null);
  const [connectingServerId, setConnectingServerId] = useState<string | null>(null);

  // Dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<string | null>(null);
  const [serverToTest, setServerToTest] = useState<MCPServerStatus | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    type: 'custom' as string,
    transportType: 'stdio' as TransportType,
    command: '',
    args: '',
    url: '',
    headers: '',
    env: '',
    projectPath: '',
    token: '',
    connectionString: '',
    dbPath: '',
    apiKey: '',
    enabled: true,
  });

  // Fetch servers on mount
  useEffect(() => {
    fetchServers();
    fetchBuiltinTemplates();
  }, [projectId]);

  const fetchServers = async () => {
    try {
      const response = await fetch(`/api/infinity/mcp-servers/${projectId}`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        // Merge with connection status
        const statusData = data.servers || [];
        setServers(statusData);
      }
    } catch (error) {
      console.error('[MCP Config] Failed to fetch servers:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchBuiltinTemplates = async () => {
    try {
      const response = await fetch(`/api/infinity/mcp-servers/${projectId}/builtin`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setBuiltinTemplates(data.builtinServers || BUILTIN_TEMPLATES);
      }
    } catch (error) {
      console.error('[MCP Config] Failed to fetch builtin templates:', error);
    }
  };

  const handleAddServer = async () => {
    try {
      setAddingServer(true);
      const transport = buildTransportConfig();
      const response = await fetch(`/api/infinity/mcp-servers/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: formData.id,
          name: formData.name,
          type: formData.type === 'custom' ? undefined : formData.type,
          transport,
          config: buildServerConfig(),
          enabled: formData.enabled,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add server');
      }

      setAddDialogOpen(false);
      resetForm();
      await fetchServers();
      onServersChange?.();
      haptics.success();
    } catch (error) {
      console.error('[MCP Config] Add server error:', error);
      alert(error instanceof Error ? error.message : 'Failed to add server');
    } finally {
      setAddingServer(false);
    }
  };

  const handleUpdateServer = async (serverId: string) => {
    try {
      const transport = buildTransportConfig();
      const response = await fetch(`/api/infinity/mcp-servers/${projectId}/${serverId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: formData.name,
          transport,
          config: buildServerConfig(),
          enabled: formData.enabled,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update server');
      }

      setEditDialogOpen(false);
      setEditingServerId(null);
      resetForm();
      await fetchServers();
      onServersChange?.();
      haptics.success();
    } catch (error) {
      console.error('[MCP Config] Update server error:', error);
      alert(error instanceof Error ? error.message : 'Failed to update server');
    }
  };

  const handleDeleteServer = async (serverId: string) => {
    try {
      const response = await fetch(`/api/infinity/mcp-servers/${projectId}/${serverId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete server');
      }

      setDeleteDialogOpen(false);
      setServerToDelete(null);
      await fetchServers();
      onServersChange?.();
      haptics.success();
    } catch (error) {
      console.error('[MCP Config] Delete server error:', error);
      alert(error instanceof Error ? error.message : 'Failed to delete server');
    }
  };

  const handleConnect = async (serverId: string) => {
    try {
      setConnectingServerId(serverId);
      const response = await fetch(`/api/infinity/mcp-servers/${projectId}/${serverId}/connect`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to connect');
      }

      await fetchServers();
      haptics.success();
    } catch (error) {
      console.error('[MCP Config] Connect error:', error);
      alert(error instanceof Error ? error.message : 'Failed to connect');
    } finally {
      setConnectingServerId(null);
    }
  };

  const handleDisconnect = async (serverId: string) => {
    try {
      const response = await fetch(`/api/infinity/mcp-servers/${projectId}/${serverId}/disconnect`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to disconnect');
      }

      await fetchServers();
      haptics.success();
    } catch (error) {
      console.error('[MCP Config] Disconnect error:', error);
      alert(error instanceof Error ? error.message : 'Failed to disconnect');
    }
  };

  const handleTestServer = async (serverId: string) => {
    try {
      setTestingServerId(serverId);
      const server = servers.find(s => s.id === serverId);
      setServerToTest(server || null);
      setTestDialogOpen(true);

      const response = await fetch(`/api/infinity/mcp-servers/${projectId}/${serverId}/test`, {
        method: 'POST',
        credentials: 'include',
      });

      const result = await response.json();
      if (result.success) {
        setServerToTest({ ...server!, connected: true, toolsCount: result.toolsCount });
      } else {
        setServerToTest({ ...server!, connected: false, lastError: result.error });
      }
    } catch (error) {
      console.error('[MCP Config] Test error:', error);
      const server = servers.find(s => s.id === serverId);
      setServerToTest({ ...server!, connected: false, lastError: error instanceof Error ? error.message : 'Test failed' });
    } finally {
      setTestingServerId(null);
    }
  };

  const handleEditClick = (server: MCPServerStatus) => {
    // Fetch full config for editing
    fetch(`/api/infinity/mcp-servers/${projectId}/${server.id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(config => {
        setFormData({
          id: config.id,
          name: config.name,
          type: config.builtinType || 'custom',
          transportType: config.transport?.type || 'stdio',
          command: config.transport?.command || '',
          args: config.transport?.args?.join(' ') || '',
          url: config.transport?.url || '',
          headers: JSON.stringify(config.transport?.headers || {}, null, 2),
          env: JSON.stringify(config.transport?.env || {}, null, 2),
          projectPath: config.config?.projectPath || '',
          token: config.config?.token || '',
          connectionString: config.config?.connectionString || '',
          dbPath: config.config?.dbPath || '',
          apiKey: config.config?.apiKey || '',
          enabled: config.enabled,
        });
        setEditingServerId(server.id);
        setEditDialogOpen(true);
      })
      .catch(err => console.error('[MCP Config] Fetch config error:', err));
  };

  const handleAddClick = () => {
    resetForm();
    setFormData(prev => ({ ...prev, id: `mcp-${Date.now()}`, name: 'New MCP Server' }));
    setAddDialogOpen(true);
  };

  const handleTemplateSelect = (template: BuiltinServerTemplate) => {
    setFormData(prev => ({
      ...prev,
      type: template.type,
      name: template.name,
      transportType: template.transportType,
      id: `mcp-${template.type}-${Date.now()}`,
    }));
  };

  const buildTransportConfig = () => {
    switch (formData.transportType) {
      case 'stdio':
        return {
          type: 'stdio',
          command: formData.command,
          args: formData.args.split(' ').filter(Boolean),
          env: formData.env ? JSON.parse(formData.env) : undefined,
        };
      case 'http':
        return {
          type: 'http',
          url: formData.url,
          headers: formData.headers ? JSON.parse(formData.headers) : undefined,
        };
      case 'websocket':
        return {
          type: 'websocket',
          url: formData.url,
          headers: formData.headers ? JSON.parse(formData.headers) : undefined,
        };
    }
  };

  const buildServerConfig = () => {
    const config: Record<string, string> = {};
    if (formData.projectPath) config.projectPath = formData.projectPath;
    if (formData.token) config.token = formData.token;
    if (formData.connectionString) config.connectionString = formData.connectionString;
    if (formData.dbPath) config.dbPath = formData.dbPath;
    if (formData.apiKey) config.apiKey = formData.apiKey;
    return config;
  };

  const resetForm = () => {
    setFormData({
      id: '',
      name: '',
      type: 'custom',
      transportType: 'stdio',
      command: '',
      args: '',
      url: '',
      headers: '{}',
      env: '{}',
      projectPath: '',
      token: '',
      connectionString: '',
      dbPath: '',
      apiKey: '',
      enabled: true,
    });
  };

  const renderTransportFields = () => {
    switch (formData.transportType) {
      case 'stdio':
        return (
          <div className="space-y-3">
            <Input
              label="Command"
              value={formData.command}
              onChange={(e) => setFormData(prev => ({ ...prev, command: e.target.value }))}
              placeholder="npx, python, node, etc."
              required
            />
            <Input
              label="Arguments (space-separated)"
              value={formData.args}
              onChange={(e) => setFormData(prev => ({ ...prev, args: e.target.value }))}
              placeholder="-y @modelcontextprotocol/server-filesystem /path"
            />
            <Textarea
              label="Environment Variables (JSON)"
              value={formData.env}
              onChange={(e) => setFormData(prev => ({ ...prev, env: e.target.value }))}
              placeholder='{"KEY": "value"}'
              rows={3}
            />
          </div>
        );
      case 'http':
      case 'websocket':
        return (
          <div className="space-y-3">
            <Input
              label="Server URL"
              value={formData.url}
              onChange={(e) => setFormData(prev => ({ ...prev, url: e.target.value }))}
              placeholder="https://api.example.com/mcp"
              required
            />
            <Textarea
              label="Headers (JSON)"
              value={formData.headers}
              onChange={(e) => setFormData(prev => ({ ...prev, headers: e.target.value }))}
              placeholder='{"Authorization": "Bearer token"}'
              rows={3}
            />
          </div>
        );
    }
  };

  const renderBuiltinConfigFields = () => {
    switch (formData.type) {
      case 'filesystem':
        return (
          <Input
            label="Project Path"
            value={formData.projectPath}
            onChange={(e) => setFormData(prev => ({ ...prev, projectPath: e.target.value }))}
            placeholder="/path/to/project"
            required
          />
        );
      case 'github':
        return (
          <Input
            label="GitHub Token"
            value={formData.token}
            onChange={(e) => setFormData(prev => ({ ...prev, token: e.target.value }))}
            placeholder="ghp_xxxxxxxxxxxx"
            type="password"
            required
          />
        );
      case 'postgres':
        return (
          <Input
            label="PostgreSQL Connection String"
            value={formData.connectionString}
            onChange={(e) => setFormData(prev => ({ ...prev, connectionString: e.target.value }))}
            placeholder="postgresql://user:pass@host:5432/db"
            type="password"
            required
          />
        );
      case 'sqlite':
        return (
          <Input
            label="SQLite Database Path"
            value={formData.dbPath}
            onChange={(e) => setFormData(prev => ({ ...prev, dbPath: e.target.value }))}
            placeholder="/path/to/database.db"
            required
          />
        );
      case 'slack':
        return (
          <Input
            label="Slack Bot Token"
            value={formData.token}
            onChange={(e) => setFormData(prev => ({ ...prev, token: e.target.value }))}
            placeholder="xoxb-xxxxxxxxxxxx"
            type="password"
            required
          />
        );
      case 'braveSearch':
        return (
          <Input
            label="Brave Search API Key"
            value={formData.apiKey}
            onChange={(e) => setFormData(prev => ({ ...prev, apiKey: e.target.value }))}
            placeholder="BSA-xxxxxxxxxxxx"
            type="password"
            required
          />
        );
      default:
        return null;
    }
  };

  const getStatusBadge = (server: MCPServerStatus) => {
    if (server.connected) {
      return <Badge variant="default">Connected</Badge>;
    }
    if (server.lastError) {
      return <Badge variant="destructive">Error</Badge>;
    }
    return <Badge variant="secondary">Disconnected</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">MCP Servers</h2>
        <Button onClick={handleAddClick} icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
          Add Server
        </Button>
      </div>

      {/* Built-in Templates */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">Built-in Templates</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {builtinTemplates.map((template) => (
            <Button
              key={template.type}
              variant="outline"
              className="justify-start text-left p-3 h-auto gap-2"
              onClick={() => handleTemplateSelect(template)}
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{template.name}</div>
                <div className="text-xs text-muted-foreground truncate">{template.description}</div>
              </div>
              <Badge variant="secondary">{template.transportType}</Badge>
            </Button>
          ))}
        </div>
      </div>

      {/* Custom Server Form Fields */}
      {(addDialogOpen || editDialogOpen) && formData.type === 'custom' && (
        <Dialog
          open={addDialogOpen || editDialogOpen}
          onClose={() => { setAddDialogOpen(false); setEditDialogOpen(false); }}
          title={addDialogOpen ? 'Add Custom MCP Server' : 'Edit MCP Server'}
          description={addDialogOpen ? 'Configure a custom MCP server connection' : 'Update server configuration'}
        >
          <div className="space-y-4 max-w-md">
            <Input
              label="Server ID"
              value={formData.id}
              onChange={(e) => setFormData(prev => ({ ...prev, id: e.target.value }))}
              placeholder="my-mcp-server"
              required
              disabled={editDialogOpen}
            />
            <Input
              label="Display Name"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="My MCP Server"
              required
            />
            <Select
              label="Transport Type"
              value={formData.transportType}
              onChange={(e) => setFormData(prev => ({ ...prev, transportType: e.target.value as TransportType }))}
              options={[
                { value: 'stdio', label: 'stdio (local process)' },
                { value: 'http', label: 'HTTP + SSE' },
                { value: 'websocket', label: 'WebSocket' },
              ]}
            />
            {renderTransportFields()}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.enabled}
                onChange={(e) => setFormData(prev => ({ ...prev, enabled: e.target.checked }))}
                className="w-4 h-4"
              />
              <span>Enabled</span>
            </label>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={() => { setAddDialogOpen(false); setEditDialogOpen(false); }}>
              Cancel
            </Button>
            <Button
              onClick={addDialogOpen ? handleAddServer : () => handleUpdateServer(editingServerId!)}
              loading={addingServer}
            >
              {addDialogOpen ? 'Add Server' : 'Save Changes'}
            </Button>
          </div>
        </Dialog>
      )}

      {(addDialogOpen || editDialogOpen) && formData.type !== 'custom' && (
        <Dialog
          open={addDialogOpen || editDialogOpen}
          onClose={() => { setAddDialogOpen(false); setEditDialogOpen(false); }}
          title={addDialogOpen ? `Add ${formData.name} Server` : `Edit ${formData.name} Server`}
          description={`Configure ${formData.name} MCP server`}
        >
          <div className="space-y-4 max-w-md">
            <Input
              label="Server ID"
              value={formData.id}
              onChange={(e) => setFormData(prev => ({ ...prev, id: e.target.value }))}
              placeholder={`my-${formData.type.toLowerCase()}-server`}
              required
              disabled={editDialogOpen}
            />
            <Input
              label="Display Name"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder={formData.name}
              required
            />
            {renderBuiltinConfigFields()}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.enabled}
                onChange={(e) => setFormData(prev => ({ ...prev, enabled: e.target.checked }))}
                className="w-4 h-4"
              />
              <span>Enabled</span>
            </label>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={() => { setAddDialogOpen(false); setEditDialogOpen(false); }}>
              Cancel
            </Button>
            <Button
              onClick={addDialogOpen ? handleAddServer : () => handleUpdateServer(editingServerId!)}
              loading={addingServer}
            >
              {addDialogOpen ? 'Add Server' : 'Save Changes'}
            </Button>
          </div>
        </Dialog>
      )}

      {/* Servers List */}
      <div className="space-y-3">
        {servers.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-4 opacity-50">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
            <p className="text-lg">No MCP servers configured</p>
            <p className="text-sm">Add a server to extend agent capabilities with external tools</p>
          </div>
        ) : (
          servers.map((server) => (
            <div key={server.id} className="p-4 rounded-lg border border-border-primary/50 bg-bg-elevated/30">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium truncate">{server.name}</h3>
                    {getStatusBadge(server)}
                    <Badge variant="outline">{server.transportType}</Badge>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                    <span>🔧 {server.toolsCount} tools</span>
                    <span>📄 {server.resourcesCount} resources</span>
                    <span>💬 {server.promptsCount} prompts</span>
                  </div>
                  {server.lastError && (
                    <div className="mt-2 text-sm text-red-500">Error: {server.lastError}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {server.connected ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleDisconnect(server.id)}
                      disabled={connectingServerId === server.id}
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleConnect(server.id)}
                      disabled={connectingServerId === server.id}
                    >
                      Connect
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleTestServer(server.id)}
                    disabled={testingServerId === server.id}
                  >
                    Test
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEditClick(server)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:bg-red-500/10"
                    onClick={() => { setServerToDelete(server.id); setDeleteDialogOpen(true); }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Delete Confirmation */}
      <AlertDialog
        open={deleteDialogOpen}
        onClose={() => { setDeleteDialogOpen(false); setServerToDelete(null); }}
        title="Delete MCP Server"
        description="Are you sure? This cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={() => serverToDelete && handleDeleteServer(serverToDelete)}
        variant="danger"
      />

      {/* Test Results Dialog */}
      <Dialog
        open={testDialogOpen}
        onClose={() => { setTestDialogOpen(false); setServerToTest(null); }}
        title="Connection Test"
        description={serverToTest?.connected ? 'Server connected successfully!' : 'Connection test failed'}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="font-medium">Status:</span>
            {serverToTest?.connected ? (
              <Badge variant="default">Connected</Badge>
            ) : (
              <Badge variant="destructive">Failed</Badge>
            )}
          </div>
          {serverToTest && (
            <>
              <div className="flex items-center gap-2">
                <span className="font-medium">Tools:</span>
                <span>{serverToTest.toolsCount}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium">Resources:</span>
                <span>{serverToTest.resourcesCount}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium">Prompts:</span>
                <span>{serverToTest.promptsCount}</span>
              </div>
              {serverToTest.lastError && (
                <div className="text-sm text-red-500 p-2 bg-red-500/10 rounded">
                  Error: {serverToTest.lastError}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button onClick={() => { setTestDialogOpen(false); setServerToTest(null); }}>Close</Button>
        </div>
      </Dialog>
    </div>
  );
};

export default MCPConfigPanel;