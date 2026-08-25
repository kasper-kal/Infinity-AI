/**
 * Agent Panel — Parallel Agent Execution Status Display
 * Replit Agent 4 style: shows all active agents, their tasks, progress, logs
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/use-theme";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { Tooltip } from "@/components/ui/Tooltip";

export interface AgentProgressEvent {
  type: "progress" | "checkpoint" | "complete" | "error" | "log";
  taskId: string;
  workstreamId: string;
  agentId: string;
  timestamp: Date;
  data: {
    progress?: number;
    message?: string;
    checkpointId?: string;
    result?: unknown;
    error?: string;
    logLevel?: "debug" | "info" | "warn" | "error";
  };
}

export interface Workstream {
  id: string;
  name: string;
  description: string;
  agentType: string;
  prompt: string;
  dependencies: string[];
  priority: number;
  estimatedTokens: number;
  assignedAgentId?: string;
  status: "pending" | "running" | "completed" | "failed" | "blocked";
  progress: number;
  result?: unknown;
  error?: string;
  checkpointId?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ParallelTask {
  id: string;
  goal: string;
  workstreams: Workstream[];
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  status: "planning" | "running" | "completed" | "failed" | "cancelled";
  globalProgress: number;
  sharedContext: Record<string, unknown>;
  checkpoints: Checkpoint[];
  mergeResult?: MergeResult;
}

export interface Checkpoint {
  id: string;
  taskId: string;
  workstreamId: string;
  timestamp: Date;
  state: unknown;
  description: string;
}

export interface MergeResult {
  success: boolean;
  mergedFiles: string[];
  conflicts: MergeConflict[];
  summary: string;
}

export interface MergeConflict {
  file: string;
  type: "code" | "design" | "config";
  baseContent: string;
  currentContent: string;
  incomingContent: string;
  resolution?: "base" | "current" | "incoming" | "manual";
  resolvedContent?: string;
}

interface AgentPanelProps {
  /** Active parallel task */
  task: ParallelTask | null;
  /** Real-time progress events */
  onProgressEvent?: (event: AgentProgressEvent) => void;
  /** Callback to cancel task */
  onCancel?: () => void;
  /** Callback to create checkpoint */
  onCreateCheckpoint?: (workstreamId: string, description: string) => void;
  /** Callback to rollback to checkpoint */
  onRollback?: (checkpointId: string) => void;
  /** Whether panel is in compact mode (sidebar) */
  compact?: boolean;
}

const STATUS_COLORS = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-500/20 text-blue-400",
  completed: "bg-green-500/20 text-green-400",
  failed: "bg-red-500/20 text-red-400",
  blocked: "bg-yellow-500/20 text-yellow-400",
};

const STATUS_LABELS = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  blocked: "Blocked",
};

const LOG_LEVEL_COLORS = {
  debug: "text-muted-foreground",
  info: "text-blue-400",
  warn: "text-yellow-400",
  error: "text-red-400",
};

export const AgentPanel: React.FC<AgentPanelProps> = ({
  task,
  onProgressEvent,
  onCancel,
  onCreateCheckpoint,
  onRollback,
  compact = false,
}) => {
  const { t } = useI18n();
  const { resolved: theme } = useTheme();
  const [selectedWorkstreamId, setSelectedWorkstreamId] = useState<string | null>(null);
  const [logs, setLogs] = useState<Array<AgentProgressEvent & { workstreamName: string }>>([]);
  const [showLogs, setShowLogs] = useState(!compact);
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = React.useRef<HTMLDivElement>(null);

  // Process progress events
  useEffect(() => {
    if (!onProgressEvent) return;
    // Events are handled by parent subscribing to orchestrator
  }, [onProgressEvent]);

  // Auto-scroll to bottom of logs
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const getWorkstream = useCallback(
    (id: string) => task?.workstreams.find((ws) => ws.id === id),
    [task]
  );

  const selectedWorkstream = selectedWorkstreamId ? getWorkstream(selectedWorkstreamId) : null;

  const workstreamLogs = useMemo(
    () => logs.filter((l) => l.workstreamId === selectedWorkstreamId),
    [logs, selectedWorkstreamId]
  );

  if (!task) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader>
          <CardTitle className="text-lg">{t("build.agentPanel.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground space-y-2">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="mx-auto opacity-50"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <p>{t("build.agentPanel.noTask")}</p>
            <p className="text-sm">
              {t("build.agentPanel.startBuildToSeeAgents")}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const runningWorkstreams = task.workstreams.filter(
    (ws) => ws.status === "running"
  ).length;
  const completedWorkstreams = task.workstreams.filter(
    (ws) => ws.status === "completed"
  ).length;
  const failedWorkstreams = task.workstreams.filter(
    (ws) => ws.status === "failed"
  ).length;

  if (compact) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{t("build.agentPanel.title")}</CardTitle>
            <Badge variant={task.status === "running" ? "default" : "secondary"}>
              {task.status.toUpperCase()}
            </Badge>
          </div>
          <div className="flex items-center justify-between mt-2">
            <Progress
              value={task.globalProgress}
              className="h-1.5 flex-1"
            />
            <span className="text-xs text-muted-foreground">{task.globalProgress}%</span>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-2">
              {task.workstreams.map((ws) => (
                <WorkstreamRow
                  key={ws.id}
                  workstream={ws}
                  selected={selectedWorkstreamId === ws.id}
                  onClick={() => setSelectedWorkstreamId(ws.id)}
                  compact
                />
              ))}
            </div>
          </ScrollArea>
        </CardContent>
        {task.status === "running" && onCancel && (
          <CardFooter className="pt-0">
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={onCancel}
            >
              {t("build.agentPanel.cancelTask")}
            </Button>
          </CardFooter>
        )}
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{t("build.agentPanel.title")}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={task.status === "running" ? "default" : "secondary"}>
                {task.status.toUpperCase()}
              </Badge>
              <Tooltip content={t("build.agentPanel.autoScroll")}>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={autoScroll ? "text-primary" : ""}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5m-4 0h4" />
                  </svg>
                </Button>
              </Tooltip>
            </div>
          </div>

          {/* Global progress */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Progress
                value={task.globalProgress}
                className="h-2 flex-1"
              />
              <span className="text-xs text-muted-foreground ml-2">
                {task.globalProgress}%
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                {runningWorkstreams} {t("build.agentPanel.running")}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                {completedWorkstreams} {t("build.agentPanel.completed")}
              </span>
              {failedWorkstreams > 0 && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  {failedWorkstreams} {t("build.agentPanel.failed")}
                </span>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex overflow-hidden">
        {/* Workstream list */}
        <div className="w-64 min-w-[220px] max-w-[300px] border-r border-border flex flex-col">
          <div className="p-3 border-b border-border">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t("build.agentPanel.workstreams")}
              <span className="ml-2 px-1.5 py-0.5 text-xs bg-muted rounded">
                {task.workstreams.length}
              </span>
            </h3>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {task.workstreams.map((ws) => (
                <WorkstreamRow
                  key={ws.id}
                  workstream={ws}
                  selected={selectedWorkstreamId === ws.id}
                  onClick={() => setSelectedWorkstreamId(ws.id)}
                />
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Detail view or logs */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedWorkstream ? (
            <WorkstreamDetail
              workstream={selectedWorkstream}
              task={task}
              onCreateCheckpoint={onCreateCheckpoint}
              onRollback={onRollback}
              logs={workstreamLogs}
              showLogs={showLogs}
              onToggleLogs={setShowLogs}
              logsEndRef={logsEndRef}
              autoScroll={autoScroll}
              onAutoScrollChange={setAutoScroll}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <p>{t("build.agentPanel.selectWorkstream")}</p>
            </div>
          )}
        </div>
      </CardContent>

      {task.status === "running" && onCancel && (
        <CardFooter className="pt-0 border-t border-border">
          <Button
            variant="danger"
            size="sm"
            className="w-full"
            onClick={onCancel}
          >
            {t("build.agentPanel.cancelTask")}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
};

/* ── Workstream Row Component ── */
interface WorkstreamRowProps {
  workstream: Workstream;
  selected: boolean;
  onClick: () => void;
  compact?: boolean;
}

function WorkstreamRow({ workstream, selected, onClick, compact }: WorkstreamRowProps) {
  const { t } = useI18n();

  const status = workstream.status as keyof typeof STATUS_COLORS;
  const statusColor = STATUS_COLORS[status];
  const statusLabel = STATUS_LABELS[status as keyof typeof STATUS_LABELS];

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-2 rounded-lg transition-colors ${
        selected
          ? "bg-primary/10 border border-primary/30"
          : "hover:bg-muted/50"
      } ${compact ? "py-1.5" : ""}`}
    >
      <div className="flex items-start gap-2">
        <div
          className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${statusColor}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className={`text-sm font-medium truncate ${compact ? "text-xs" : ""}`}>
              {workstream.name}
            </span>
            <Badge
              variant="secondary"
              className={statusColor + (compact ? " text-xs" : "")}
            >
              {statusLabel}
            </Badge>
          </div>
          {!compact && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {workstream.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1">
            <div className="flex items-center gap-1 flex-1">
              <Progress value={workstream.progress} className="flex-1 h-1" />
              <span className="text-xs text-muted-foreground font-mono shrink-0">
                {workstream.progress}%
              </span>
            </div>
          </div>
          {workstream.dependencies.length > 0 && !compact && (
            <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M19 12H5" />
              </svg>
              <span>{workstream.dependencies.length} deps</span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

/* ── Workstream Detail Component ── */
interface WorkstreamDetailProps {
  workstream: Workstream;
  task: ParallelTask;
  onCreateCheckpoint?: (workstreamId: string, description: string) => void;
  onRollback?: (checkpointId: string) => void;
  logs: Array<AgentProgressEvent & { workstreamName: string }>;
  showLogs: boolean;
  onToggleLogs: (show: boolean) => void;
  logsEndRef: React.RefObject<HTMLDivElement | null>;
  autoScroll: boolean;
  onAutoScrollChange: (auto: boolean) => void;
}

function WorkstreamDetail({
  workstream,
  task,
  onCreateCheckpoint,
  onRollback,
  logs,
  showLogs,
  onToggleLogs,
  logsEndRef,
  autoScroll,
  onAutoScrollChange,
}: WorkstreamDetailProps) {
  const { t } = useI18n();
  const { resolved: theme } = useTheme();
  const [activeTab, setActiveTab] = useState<"overview" | "logs" | "checkpoints">("overview");

  const workstreamCheckpoints = task.checkpoints.filter(
    (cp) => cp.workstreamId === workstream.id
  );

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Tab bar */}
      <div className="flex border-b border-border">
        <Tabs
          controlledTab={activeTab}
          onChange={(tabId) => setActiveTab(tabId as "overview" | "logs" | "checkpoints")}
          tabs={[
            { id: "overview", label: t("build.agentPanel.overview"), content: null },
            { id: "logs", label: t("build.agentPanel.logs"), content: null, badge: logs.length },
            { id: "checkpoints", label: t("build.agentPanel.checkpoints"), content: null, badge: workstreamCheckpoints.length },
          ]}
          variant="line"
          className="flex-1"
        />
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {activeTab === "overview" && (
          <WorkstreamOverview
            workstream={workstream}
            task={task}
            onCreateCheckpoint={onCreateCheckpoint}
          />
        )}
        {activeTab === "logs" && (
          <WorkstreamLogs
            logs={logs}
            showLogs={showLogs}
            onToggleLogs={onToggleLogs}
            logsEndRef={logsEndRef}
            autoScroll={autoScroll}
            onAutoScrollChange={onAutoScrollChange}
          />
        )}
        {activeTab === "checkpoints" && (
          <WorkstreamCheckpoints
            checkpoints={workstreamCheckpoints}
            workstreamId={workstream.id}
            onRollback={onRollback}
          />
        )}
      </div>
    </div>
  );
}

/* ── Dependencies List Component ── */
function DependenciesList({
  depWorkstreams,
  t,
}: {
  depWorkstreams: Workstream[];
  t: (key: string, params?: Record<string, string | number>) => string;
}): React.ReactElement {
  return (
    <div className="space-y-2">
      {depWorkstreams.map((ws: Workstream) => {
        const status = ws.status as keyof typeof STATUS_COLORS;
        const statusColor = STATUS_COLORS[status];
        const statusLabel = STATUS_LABELS[status as keyof typeof STATUS_LABELS];
        return (
          <div
            key={ws.id}
            className="flex items-center gap-2 p-2 rounded bg-muted/30"
          >
            <div className={`w-2 h-2 rounded-full ${statusColor}`} />
            <span className="text-sm font-medium">{ws.name}</span>
            <Badge variant="secondary" className={statusColor}>
              {statusLabel}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}

/* ── Workstream Overview ── */
function WorkstreamOverview({
  workstream,
  task,
  onCreateCheckpoint,
}: {
  workstream: Workstream;
  task: ParallelTask;
  onCreateCheckpoint?: (workstreamId: string, description: string) => void;
}): React.ReactNode {
  const { t } = useI18n();
  const depWorkstreams: Workstream[] = workstream.dependencies
    .map((id) => task.workstreams.find((ws) => ws.id === id))
    .filter((ws): ws is Workstream => ws !== undefined);

  const dependenciesSection = depWorkstreams.length > 0 ? (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("build.agentPanel.dependencies")}</CardTitle>
      </CardHeader>
      <CardContent>
        <DependenciesList depWorkstreams={depWorkstreams} t={t} />
      </CardContent>
    </Card>
  ) : undefined;

  const resultSection = workstream.result ? (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("build.agentPanel.result")}</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="text-xs overflow-auto max-h-64 bg-black/20 rounded p-3 text-green-300 whitespace-pre-wrap">
          {JSON.stringify(workstream.result, null, 2)}
        </pre>
      </CardContent>
    </Card>
  ) : undefined;

  const checkpointSection = onCreateCheckpoint && workstream.status === "running" ? (
    <Card className="border-primary/30">
      <CardContent className="pt-0">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => onCreateCheckpoint(workstream.id, t("build.agentPanel.checkpointCreated"))}
        >
          {t("build.agentPanel.createCheckpoint")}
        </Button>
      </CardContent>
    </Card>
  ) : undefined;

  return (
    <div className="space-y-4">
      {/* Basic info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("build.agentPanel.overview")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <InfoRow label={t("build.agentPanel.name")} value={workstream.name} />
          <InfoRow label={t("build.agentPanel.description")} value={workstream.description} />
          <InfoRow label={t("build.agentPanel.agentType")} value={workstream.agentType} />
          <InfoRow label={t("build.agentPanel.priority")} value={workstream.priority.toString()} />
          <InfoRow
            label={t("build.agentPanel.estimatedTokens")}
            value={`${workstream.estimatedTokens.toLocaleString()}`}
          />
          <InfoRow
            label={t("build.agentPanel.status")}
            value={
              <Badge variant="secondary" className={STATUS_COLORS[workstream.status as keyof typeof STATUS_COLORS]}>
                {STATUS_LABELS[workstream.status as keyof typeof STATUS_LABELS]}
              </Badge>
            }
          />
          {workstream.startedAt && (
            <InfoRow
              label={t("build.agentPanel.startedAt")}
              value={workstream.startedAt.toLocaleTimeString()}
            />
          )}
          {workstream.completedAt && (
            <InfoRow
              label={t("build.agentPanel.completedAt")}
              value={workstream.completedAt.toLocaleTimeString()}
            />
          )}
          {workstream.error && (
            <InfoRow
              label={t("build.agentPanel.error")}
              value={<span className="text-red-400 text-sm">{String(workstream.error)}</span>}
            />
          )}
        </CardContent>
      </Card>

      {/* Dependencies */}
      {dependenciesSection}

      {/* Result */}
      {resultSection}

      {/* Checkpoint action */}
      {checkpointSection}
    </div>
  );

/* ── Workstream Logs ── */
function WorkstreamLogs({
  logs,
  showLogs,
  onToggleLogs,
  logsEndRef,
  autoScroll,
  onAutoScrollChange,
}: {
  logs: Array<AgentProgressEvent & { workstreamName: string }>;
  showLogs: boolean;
  onToggleLogs: (show: boolean) => void;
  logsEndRef: React.RefObject<HTMLDivElement | null>;
  autoScroll: boolean;
  onAutoScrollChange: (auto: boolean) => void;
}) {
  const { t } = useI18n();

  if (!showLogs) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-muted-foreground">
        <p className="mb-4">{t("build.agentPanel.logsHidden")}</p>
        <Button variant="outline" size="sm" onClick={() => onToggleLogs(true)}>
          {t("build.agentPanel.showLogs")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">
          {logs.length} {t("build.agentPanel.events")}
        </span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => onAutoScrollChange(e.target.checked)}
              className="w-3 h-3"
            />
            {t("build.agentPanel.autoScroll")}
          </label>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onToggleLogs(false)}
            className="h-6 w-6"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-1 font-mono text-xs" ref={logsEndRef}>
          {logs.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {t("build.agentPanel.noLogs")}
            </p>
          ) : (
            logs.map((log, i) => (
              <div
                key={`${log.timestamp.getTime()}-${i}`}
                className={`flex gap-2 p-1.5 rounded ${
                  LOG_LEVEL_COLORS[log.data.logLevel ?? "info"]
                } hover:bg-muted/30`}
              >
                <span className="text-muted-foreground shrink-0">
                  {log.timestamp.toLocaleTimeString()}
                </span>
                <Badge
                  variant="secondary"
                  className={`text-[10px] ${STATUS_COLORS[log.type as keyof typeof STATUS_COLORS] ?? "bg-muted text-muted-foreground"}`}
                >
                  {log.type.toUpperCase()}
                </Badge>
                <span className="flex-1 truncate">{log.data.message ?? "—"}</span>
                {log.data.progress !== undefined && (
                  <span className="text-muted-foreground shrink-0">
                    {log.data.progress}%
                  </span>
                )}
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </ScrollArea>
    </div>
  );
}

/* ── Workstream Checkpoints ── */
function WorkstreamCheckpoints({
  checkpoints,
  workstreamId,
  onRollback,
}: {
  checkpoints: Checkpoint[];
  workstreamId: string;
  onRollback?: (checkpointId: string) => void;
}) {
  const { t } = useI18n();

  if (checkpoints.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        <p>{t("build.agentPanel.noCheckpoints")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {checkpoints
        .slice()
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .map((cp) => (
          <Card key={cp.id} className="bg-muted/30">
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{cp.description}</span>
                    <Badge variant="secondary" className="text-xs">
                      {cp.timestamp.toLocaleTimeString()}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {cp.id}
                  </p>
                </div>
                {onRollback && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRollback(cp.id)}
                  >
                    {t("build.agentPanel.rollback")}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
    </div>
  );
}

/* ── Info Row Helper ── */
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="text-muted-foreground shrink-0 w-32">{label}</span>
      <span className="text-foreground break-all">{value}</span>
    </div>
  );
}
}
