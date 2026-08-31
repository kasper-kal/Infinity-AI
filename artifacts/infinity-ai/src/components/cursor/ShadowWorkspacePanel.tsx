/**
 * ShadowWorkspacePanel — UI for managing shadow workspaces
 * Displays active workspaces, warm pool status, and allows creating/running agents
 */

import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Plus,
  Play,
  Stop,
  RefreshCw,
  Trash2,
  Terminal,
  FileText,
  Settings,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  Zap,
  Database,
  Server,
  Activity,
} from "lucide-react";

interface ShadowWorkspace {
  id: string;
  worktreeId: string;
  baseCommit: string;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  status: "created" | "starting" | "running" | "completed" | "failed" | "cleaning" | "cleaned";
  config: {
    baseSnapshot: Record<string, string>;
    baseCommit: string;
    limits?: {
      cpuTimeMs: number;
      memoryMb: number;
      wallTimeMs: number;
      maxNetworkRequests: number;
      diskSpaceMb: number;
    };
    services?: string[];
    env?: Record<string, string>;
    workingDir?: string;
    debug?: boolean;
  };
  limits: {
    cpuTimeMs: number;
    memoryMb: number;
    wallTimeMs: number;
    maxNetworkRequests: number;
    diskSpaceMb: number;
  };
  resourceUsage: {
    cpuTimeMs: number;
    memoryMb: number;
    wallTimeMs: number;
    networkRequests: number;
    diskSpaceMb: number;
  };
  agentResult: {
    finalResponse: string;
    totalToolCalls: number;
    totalIterations: number;
    converged: boolean;
    stoppedReason: string;
  } | null;
  error: string | null;
  artifacts: Array<{
    id: string;
    type: string;
    path: string;
    name: string;
    size: number;
    createdAt: number;
    metadata?: Record<string, unknown>;
  }>;
}

interface WarmPoolStatus {
  size: number;
  targetSize: number;
  workspaces: ShadowWorkspace[];
}

interface AgentTask {
  prompt: string;
  agentConfig?: {
    maxIterations?: number;
    maxToolCalls?: number;
    enableOrchestration?: boolean;
  };
}

const STATUS_COLORS: Record<string, string> = {
  created: "bg-gray-500",
  starting: "bg-blue-500",
  running: "bg-green-500",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  cleaning: "bg-yellow-500",
  cleaned: "bg-gray-400",
};

const STATUS_LABELS: Record<string, string> = {
  created: "Created",
  starting: "Starting",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cleaning: "Cleaning",
  cleaned: "Cleaned",
};

export function ShadowWorkspacePanel({ projectId, projectRoot }: { projectId: string; projectRoot: string }) {
  const { t } = useTranslation();
  const [workspaces, setWorkspaces] = useState<ShadowWorkspace[]>([]);
  const [warmPool, setWarmPool] = useState<WarmPoolStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"workspaces" | "pool" | "create">("workspaces");
  const [taskPrompt, setTaskPrompt] = useState("");
  const [taskConfig, setTaskConfig] = useState<AgentTask>({
    prompt: "",
    agentConfig: {
      maxIterations: 10,
      maxToolCalls: 30,
      enableOrchestration: true,
    },
  });
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState<ShadowWorkspace | null>(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [warmPoolSize, setWarmPoolSize] = useState(3);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const response = await fetch(`/api/infinity/shadow-workspaces?projectId=${projectId}`);
      if (response.ok) {
        const data = await response.json();
        setWorkspaces(data.workspaces || []);
        setWarmPool(data.warmPool || null);
      }
    } catch (error) {
      console.error("Failed to fetch workspaces:", error);
    }
  }, [projectId]);

  const fetchWarmPool = useCallback(async () => {
    try {
      const response = await fetch(`/api/infinity/shadow-workspaces/pool?projectId=${projectId}`);
      if (response.ok) {
        const data = await response.json();
        setWarmPool(data);
      }
    } catch (error) {
      console.error("Failed to fetch warm pool:", error);
    }
  }, [projectId]);

  useEffect(() => {
    fetchWorkspaces();
    fetchWarmPool();
    const interval = setInterval(() => {
      fetchWorkspaces();
      fetchWarmPool();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchWorkspaces, fetchWarmPool]);

  const handleCreateWorkspace = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/infinity/shadow-workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectRoot,
          baseCommit: "HEAD",
          baseSnapshot: {}, // Would be populated from git
          warmPoolSize: warmPoolSize,
        }),
      });
      if (response.ok) {
        await fetchWorkspaces();
        await fetchWarmPool();
      }
    } catch (error) {
      console.error("Failed to create workspace:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRunAgent = async (workspaceId: string) => {
    if (!taskPrompt.trim()) return;
    setRunningTaskId(workspaceId);
    setShowTaskModal(false);

    try {
      const response = await fetch(`/api/infinity/shadow-workspaces/${workspaceId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectRoot,
          prompt: taskPrompt,
          agentConfig: taskConfig.agentConfig,
        }),
      });

      if (response.ok) {
        await fetchWorkspaces();
      }
    } catch (error) {
      console.error("Failed to run agent:", error);
    } finally {
      setRunningTaskId(null);
      setTaskPrompt("");
    }
  };

  const handleStopWorkspace = async (workspaceId: string) => {
    try {
      await fetch(`/api/infinity/shadow-workspaces/${workspaceId}/stop`, { method: "POST" });
      await fetchWorkspaces();
    } catch (error) {
      console.error("Failed to stop workspace:", error);
    }
  };

  const handleCleanupWorkspace = async (workspaceId: string) => {
    try {
      await fetch(`/api/infinity/shadow-workspaces/${workspaceId}/cleanup`, { method: "POST" });
      await fetchWorkspaces();
    } catch (error) {
      console.error("Failed to cleanup workspace:", error);
    }
  };

  const handleResizeWarmPool = async () => {
    try {
      await fetch(`/api/infinity/shadow-workspaces/pool/resize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, size: warmPoolSize }),
      });
      await fetchWarmPool();
    } catch (error) {
      console.error("Failed to resize warm pool:", error);
    }
  };

  const formatTime = (timestamp: number | null) => {
    if (!timestamp) return "—";
    return new Date(timestamp).toLocaleTimeString();
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle className="w-4 h-4 text-emerald-500" />;
      case "failed": return <XCircle className="w-4 h-4 text-red-500" />;
      case "running": return <Activity className="w-4 h-4 text-green-500 animate-pulse" />;
      case "starting": return <Zap className="w-4 h-4 text-blue-500 animate-pulse" />;
      case "cleaning": return <Server className="w-4 h-4 text-yellow-500 animate-spin" />;
      default: return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            {t("shadowWorkspace.title") || "Shadow Workspaces"}
          </CardTitle>
          <Badge variant="outline" className="ml-2">
            {workspaces.length} active
          </Badge>
        </div>
        <CardDescription>
          {t("shadowWorkspace.description") || "Ephemeral isolated environments for agent QA tasks"}
        </CardDescription>
      </CardHeader>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="flex-shrink-0 border-b">
          <TabsTrigger value="workspaces">
            <Terminal className="w-4 h-4 mr-2" />
            {t("shadowWorkspace.tabs.workspaces") || "Workspaces"}
            <Badge variant="secondary" className="ml-1">{workspaces.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="pool">
            <Server className="w-4 h-4 mr-2" />
            {t("shadowWorkspace.tabs.warmPool") || "Warm Pool"}
            <Badge variant="secondary" className="ml-1">{warmPool?.size || 0}/{warmPool?.targetSize || 0}</Badge>
          </TabsTrigger>
          <TabsTrigger value="create">
            <Plus className="w-4 h-4 mr-2" />
            {t("shadowWorkspace.tabs.create") || "Create Task"}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="workspaces" className="flex-1 overflow-hidden">
          {workspaces.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Terminal className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>{t("shadowWorkspace.empty") || "No active workspaces. Create one to get started."}</p>
              </div>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="space-y-4 p-4">
                {workspaces.map((ws) => (
                  <Card key={ws.id} className="overflow-hidden">
                    <CardHeader className="p-4 pb-2">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(ws.status)}
                            <div>
                              <p className="font-mono text-sm font-medium truncate">{ws.id}</p>
                              <p className="text-xs text-muted-foreground">{ws.worktreeId.slice(0, 12)}</p>
                            </div>
                          </div>
                          <Badge
                            className={`${STATUS_COLORS[ws.status]} text-white whitespace-nowrap shrink-0`}
                          >
                            {STATUS_LABELS[ws.status]}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {ws.status === "running" && runningTaskId === ws.id && (
                            <Button variant="ghost" size="icon" onClick={() => handleStopWorkspace(ws.id)}>
                              <Stop className="w-4 h-4" />
                            </Button>
                          )}
                          {ws.status === "running" && runningTaskId !== ws.id && (
                            <Button variant="ghost" size="icon" onClick={() => {
                              setSelectedWorkspace(ws);
                              setShowTaskModal(true);
                            }}>
                              <Play className="w-4 h-4" />
                            </Button>
                          )}
                          {(ws.status === "completed" || ws.status === "failed") && (
                            <Button variant="ghost" size="icon" onClick={() => handleCleanupWorkspace(ws.id)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 space-y-3">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">{t("shadowWorkspace.created") || "Created"}</p>
                          <p className="font-mono">{formatTime(ws.createdAt)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t("shadowWorkspace.started") || "Started"}</p>
                          <p className="font-mono">{formatTime(ws.startedAt)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t("shadowWorkspace.completed") || "Completed"}</p>
                          <p className="font-mono">{formatTime(ws.completedAt)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t("shadowWorkspace.duration") || "Duration"}</p>
                          <p className="font-mono">
                            {ws.startedAt && ws.completedAt
                              ? formatDuration(ws.completedAt - ws.startedAt)
                              : ws.startedAt
                              ? formatDuration(Date.now() - ws.startedAt)
                              : "—"}
                          </p>
                        </div>
                      </div>

                      <Separator />

                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">{t("shadowWorkspace.cpuTime") || "CPU Time"}</p>
                          <p className="font-mono">{formatDuration(ws.resourceUsage.cpuTimeMs)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t("shadowWorkspace.memory") || "Memory"}</p>
                          <p className="font-mono">{ws.resourceUsage.memoryMb} MB</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t("shadowWorkspace.networkRequests") || "Network"}</p>
                          <p className="font-mono">{ws.resourceUsage.networkRequests}</p>
                        </div>
                      </div>

                      {ws.artifacts.length > 0 && (
                        <>
                          <Separator />
                          <div>
                            <p className="text-sm font-medium mb-2">{t("shadowWorkspace.artifacts") || "Artifacts"}</p>
                            <div className="flex flex-wrap gap-2">
                              {ws.artifacts.map((artifact) => (
                                <Badge key={artifact.id} variant="outline" className="gap-1">
                                  <FileText className="w-3 h-3" />
                                  {artifact.name} ({artifact.type})
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </>
                      )}

                      {ws.agentResult && (
                        <>
                          <Separator />
                          <div className="text-sm">
                            <p className="text-muted-foreground mb-1">{t("shadowWorkspace.agentResult") || "Agent Result"}</p>
                            <p className="text-sm max-h-24 overflow-auto text-muted-foreground">
                              {ws.agentResult.finalResponse.slice(0, 500)}
                              {ws.agentResult.finalResponse.length > 500 && "..."}
                            </p>
                            <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                              <span>Iterations: {ws.agentResult.totalIterations}</span>
                              <span>Tool Calls: {ws.agentResult.totalToolCalls}</span>
                              <span>{ws.agentResult.converged ? "Converged" : "Stopped"}</span>
                            </div>
                          </div>
                        </>
                      )}

                      {ws.error && (
                        <>
                          <Separator />
                          <Alert variant="destructive" className="text-sm">
                            <AlertDescription>{ws.error}</AlertDescription>
                          </Alert>
                        </>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="pool" className="flex-1 overflow-hidden">
          <div className="flex-1 p-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="w-5 h-5" />
                  {t("shadowWorkspace.pool.title") || "Warm Pool Configuration"}
                </CardTitle>
                <CardDescription>
                  {t("shadowWorkspace.pool.description") || "Pre-warmed workspaces for instant agent startup"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-3xl font-bold">{warmPool?.size || 0}</p>
                    <p className="text-sm text-muted-foreground">{t("shadowWorkspace.pool.current") || "Current"}</p>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-3xl font-bold">{warmPool?.targetSize || 0}</p>
                    <p className="text-sm text-muted-foreground">{t("shadowWorkspace.pool.target") || "Target"}</p>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-3xl font-bold">
                      {warmPool && warmPool.targetSize > 0
                        ? Math.round((warmPool.size / warmPool.targetSize) * 100)
                        : 0}%
                    </p>
                    <p className="text-sm text-muted-foreground">{t("shadowWorkspace.pool.utilization") || "Utilization"}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("shadowWorkspace.pool.targetSize") || "Target Pool Size"}</label>
                  <div className="flex items-center gap-4">
                    <Input
                      type="number"
                      min="0"
                      max="20"
                      value={warmPoolSize}
                      onChange={(e) => setWarmPoolSize(Number(e.target.value))}
                      className="w-24"
                    />
                    <Button onClick={handleResizeWarmPool} disabled={loading}>
                      {t("shadowWorkspace.pool.resize") || "Resize Pool"}
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("shadowWorkspace.pool.resizeHint") || "Adjust the number of pre-warmed workspaces. Larger pool = faster startup but more resources."}
                  </p>
                </div>
              </CardContent>
            </Card>

            {warmPool && warmPool.workspaces.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>{t("shadowWorkspace.pool.warmedWorkspaces") || "Warmed Workspaces"}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="max-h-64">
                    <div className="space-y-2">
                      {warmPool.workspaces.map((ws) => (
                        <div key={ws.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-green-500" />
                            <div>
                              <p className="font-mono text-sm">{ws.id}</p>
                              <p className="text-xs text-muted-foreground">Ready for reuse</p>
                            </div>
                          </div>
                          <Badge variant="outline">Warmed</Badge>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="create" className="flex-1 overflow-hidden">
          <ScrollArea className="flex-1 p-4 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  {t("shadowWorkspace.create.title") || "Create Agent Task"}
                </CardTitle>
                <CardDescription>
                  {t("shadowWorkspace.create.description") || "Define a task for an agent to run in a shadow workspace"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    {t("shadowWorkspace.create.prompt") || "Task Prompt"}
                  </label>
                  <Textarea
                    value={taskPrompt}
                    onChange={(e) => setTaskPrompt(e.target.value)}
                    placeholder={t("shadowWorkspace.create.promptPlaceholder") || "Describe what the agent should do..."}
                    rows={6}
                    className="font-mono text-sm"
                  />
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      {t("shadowWorkspace.create.maxIterations") || "Max Iterations"}
                    </label>
                    <Input
                      type="number"
                      min="1"
                      max="50"
                      value={taskConfig.agentConfig?.maxIterations || 10}
                      onChange={(e) => setTaskConfig({ ...taskConfig, agentConfig: { ...taskConfig.agentConfig, maxIterations: Number(e.target.value) } })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      {t("shadowWorkspace.create.maxToolCalls") || "Max Tool Calls"}
                    </label>
                    <Input
                      type="number"
                      min="1"
                      max="200"
                      value={taskConfig.agentConfig?.maxToolCalls || 30}
                      onChange={(e) => setTaskConfig({ ...taskConfig, agentConfig: { ...taskConfig.agentConfig, maxToolCalls: Number(e.target.value) } })}
                    />
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={taskConfig.agentConfig?.enableOrchestration ?? true}
                      onChange={(e) => setTaskConfig({ ...taskConfig, agentConfig: { ...taskConfig.agentConfig, enableOrchestration: e.target.checked } })}
                      className="rounded"
                    />
                    <span className="text-sm">
                      {t("shadowWorkspace.create.enableOrchestration") || "Enable multi-agent orchestration"}
                    </span>
                  </label>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={() => setActiveTab("workspaces")}>
                    {t("common.cancel") || "Cancel"}
                  </Button>
                  <Button
                    onClick={() => {
                      if (workspaces.length > 0) {
                        setSelectedWorkspace(workspaces[0]);
                        setShowTaskModal(true);
                      } else {
                        handleCreateWorkspace();
                      }
                    }}
                    disabled={loading || !taskPrompt.trim()}
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        {t("common.creating") || "Creating..."}
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        {t("shadowWorkspace.create.runTask") || "Run Task"}
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("shadowWorkspace.create.resourceLimits") || "Resource Limits"}</CardTitle>
                <CardDescription>
                  {t("shadowWorkspace.create.resourceLimitsDesc") || "Configure limits for the shadow workspace"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">CPU Time (ms)</label>
                    <Input defaultValue="300000" readOnly />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Memory (MB)</label>
                    <Input defaultValue="512" readOnly />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Wall Time (ms)</label>
                    <Input defaultValue="600000" readOnly />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Disk Space (MB)</label>
                    <Input defaultValue="100" readOnly />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {t("shadowWorkspace.create.limitsNote") || "Limits are enforced per workspace. Adjust via API for custom configurations."}
                </p>
              </CardContent>
            </Card>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </Card>
  );
}

export default ShadowWorkspacePanel;