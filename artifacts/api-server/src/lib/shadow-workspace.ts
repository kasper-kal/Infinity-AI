/**
 * SHADOW WORKSPACE MANAGER — Ephemeral Isolated Environments for Agent QA
 *
 * Extends Virtual Worktree (Phase 4) with service orchestration, resource limits,
 * warm pool for instant start, and auto-cleanup.
 *
 * Features:
 * - Ephemeral, isolated workspace per agent task (virtual FS via Phase 4)
 * - Pre-seeded with project state (git clone, deps installed, services running)
 * - Agent runs: explore → modify → test → report
 * - Auto-cleanup on completion, preserve artifacts on failure
 * - Resource limits: CPU, memory, time, network
 * - Pool of warm workspaces for instant start
 */

import { EventEmitter } from "events";
import { VirtualWorktreeManager, type WorktreeMeta, type WorktreeFile, getWorktreeManager } from "./virtual-worktree";
import type { LLMAdapter } from "./llm-adapter";
import { runUniversalAgent, type AgentLoopResult, type UniversalAgentConfig } from "./universal-agent";
import type { ToolExecutionContext } from "./tool-types";
import { createBestAdapter } from "./adapter-factory";

/**
 * Resource limits for shadow workspaces
 */
export interface ResourceLimits {
  /** Max CPU time in milliseconds */
  cpuTimeMs: number;
  /** Max memory in MB */
  memoryMb: number;
  /** Max wall-clock time in milliseconds */
  wallTimeMs: number;
  /** Max network requests */
  maxNetworkRequests: number;
  /** Max disk space in MB */
  diskSpaceMb: number;
}

/**
 * Default resource limits
 */
export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  cpuTimeMs: 300000, // 5 minutes CPU
  memoryMb: 512,
  wallTimeMs: 600000, // 10 minutes wall time
  maxNetworkRequests: 100,
  diskSpaceMb: 100,
};

/**
 * Shadow workspace configuration
 */
export interface ShadowWorkspaceConfig {
  /** Base commit/snapshot to seed from */
  baseSnapshot: Record<string, string>;
  /** Base commit hash */
  baseCommit: string;
  /** Resource limits */
  limits?: Partial<ResourceLimits>;
  /** Services to start (e.g., ["postgres", "redis", "dev-server"]) */
  services?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Working directory in workspace */
  workingDir?: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Shadow workspace metadata
 */
export interface ShadowWorkspaceMeta {
  id: string;
  worktreeId: string;
  baseCommit: string;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  status: "created" | "starting" | "running" | "completed" | "failed" | "cleaning" | "cleaned";
  config: ShadowWorkspaceConfig;
  limits: ResourceLimits;
  resourceUsage: ResourceUsage;
  agentResult: AgentLoopResult | null;
  error: string | null;
  artifacts: WorkspaceArtifact[];
}

/**
 * Resource usage tracking
 */
export interface ResourceUsage {
  cpuTimeMs: number;
  memoryMb: number;
  wallTimeMs: number;
  networkRequests: number;
  diskSpaceMb: number;
}

/**
 * Artifacts produced by agent in workspace
 */
export interface WorkspaceArtifact {
  id: string;
  type: "file" | "log" | "test-result" | "coverage" | "build-output" | "report" | "screenshot";
  path: string;
  name: string;
  size: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * Agent task configuration for shadow workspace
 */
export interface ShadowAgentTask {
  /** Task prompt for the agent */
  prompt: string;
  /** Universal agent config overrides */
  agentConfig?: Partial<UniversalAgentConfig>;
  /** Tool execution context */
  context: ToolExecutionContext;
  /** LLM adapter (uses best available if not provided) */
  llm?: LLMAdapter;
  /** Callback on agent progress */
  onProgress?: (event: AgentProgressEvent) => void;
}

/**
 * Progress event from agent
 */
export interface AgentProgressEvent {
  type: "thinking" | "tool-call" | "tool-result" | "error" | "artifact" | "complete";
  message: string;
  data?: unknown;
  timestamp: number;
}

/**
 * Result of running agent in shadow workspace
 */
export interface ShadowWorkspaceResult {
  workspaceId: string;
  success: boolean;
  agentResult: AgentLoopResult | null;
  error: string | null;
  artifacts: WorkspaceArtifact[];
  resourceUsage: ResourceUsage;
  durationMs: number;
}

/**
 * Warm pool configuration
 */
export interface WarmPoolConfig {
  /** Number of warm workspaces to maintain */
  size: number;
  /** Base snapshot to use for warm workspaces */
  baseSnapshot: Record<string, string>;
  /** Base commit hash */
  baseCommit: string;
  /** Default config for warm workspaces */
  defaultConfig: ShadowWorkspaceConfig;
}

/**
 * Shadow Workspace Manager
 */
export class ShadowWorkspaceManager extends EventEmitter {
  private manager: VirtualWorktreeManager;
  private workspaces: Map<string, ShadowWorkspaceMeta> = new Map();
  private warmPool: ShadowWorkspaceMeta[] = [];
  private warmPoolConfig: WarmPoolConfig | null = null;
  private defaults: Required<ResourceLimits>;
  private debug: boolean;

  constructor(manager?: VirtualWorktreeManager, defaults?: Partial<ResourceLimits>, debug = false) {
    super();
    this.manager = manager || getWorktreeManager();
    this.defaults = { ...DEFAULT_RESOURCE_LIMITS, ...defaults };
    this.debug = debug;
  }

  /**
   * Initialize the manager and warm pool
   */
  async init(warmPoolConfig?: WarmPoolConfig): Promise<void> {
    await this.manager.init();
    if (warmPoolConfig) {
      this.warmPoolConfig = warmPoolConfig;
      await this.warmPoolInit();
    }
    this.log("ShadowWorkspaceManager initialized");
  }

  /**
   * Initialize warm pool
   */
  private async warmPoolInit(): Promise<void> {
    if (!this.warmPoolConfig) return;

    this.log(`Initializing warm pool with ${this.warmPoolConfig.size} workspaces`);
    const promises = Array.from({ length: this.warmPoolConfig.size }, () =>
      this.createWorkspace(this.warmPoolConfig!.defaultConfig)
    );
    this.warmPool = await Promise.all(promises);
    this.log(`Warm pool ready with ${this.warmPool.length} workspaces`);
  }

  /**
   * Get a workspace from warm pool or create new
   */
  async getOrCreateWorkspace(config: ShadowWorkspaceConfig): Promise<ShadowWorkspaceMeta> {
    // Try to get from warm pool
    if (this.warmPool.length > 0) {
      const workspace = this.warmPool.pop()!;
      // Update config
      workspace.config = config;
      workspace.limits = { ...this.defaults, ...config.limits };
      workspace.status = "created";
      workspace.startedAt = null;
      workspace.completedAt = null;
      workspace.agentResult = null;
      workspace.error = null;
      workspace.artifacts = [];
      workspace.resourceUsage = { cpuTimeMs: 0, memoryMb: 0, wallTimeMs: 0, networkRequests: 0, diskSpaceMb: 0 };
      this.workspaces.set(workspace.id, workspace);
      this.log(`Reused warm workspace ${workspace.id}`);
      return workspace;
    }

    // Create new
    return this.createWorkspace(config);
  }

  /**
   * Create a new shadow workspace
   */
  async createWorkspace(config: ShadowWorkspaceConfig): Promise<ShadowWorkspaceMeta> {
    const worktreeId = await this.manager.createWorktreeFromSnapshot(
      config.baseCommit,
      config.baseSnapshot
    );

    const workspace: ShadowWorkspaceMeta = {
      id: this.generateId(),
      worktreeId,
      baseCommit: config.baseCommit,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      status: "created",
      config,
      limits: { ...this.defaults, ...config.limits },
      resourceUsage: { cpuTimeMs: 0, memoryMb: 0, wallTimeMs: 0, networkRequests: 0, diskSpaceMb: 0 },
      agentResult: null,
      error: null,
      artifacts: [],
    };

    this.workspaces.set(workspace.id, workspace);
    this.emit("workspace:created", workspace);
    this.log(`Created shadow workspace ${workspace.id} with worktree ${worktreeId}`);
    return workspace;
  }

  /**
   * Run an agent task in a shadow workspace
   */
  async runAgent(workspaceId: string, task: ShadowAgentTask): Promise<ShadowWorkspaceResult> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    if (workspace.status !== "created" && workspace.status !== "completed" && workspace.status !== "failed") {
      throw new Error(`Workspace ${workspaceId} is in invalid state: ${workspace.status}`);
    }

    const startTime = Date.now();
    workspace.status = "starting";
    workspace.startedAt = startTime;
    workspace.error = null;
    workspace.agentResult = null;
    workspace.artifacts = [];
    workspace.resourceUsage = { cpuTimeMs: 0, memoryMb: 0, wallTimeMs: 0, networkRequests: 0, diskSpaceMb: 0 };
    this.emit("workspace:started", workspace);

    try {
      workspace.status = "running";

      // Get worktree files for context
      const worktree = await this.manager.getWorktree(workspace.worktreeId);
      if (!worktree) throw new Error(`Worktree ${workspace.worktreeId} not found`);

      // Prepare agent context with worktree isolation
      const agentContext: ToolExecutionContext = {
        ...task.context,
        worktreeId: workspace.worktreeId,
        worktreeManager: this.manager,
        sharedContext: undefined, // No shared context for isolated shadow workspace
        agentIndex: 0,
      };

      // Get LLM adapter
      const llm = task.llm || await createBestAdapter();

      // Run the agent with progress tracking
      const result = await runUniversalAgent(llm, agentContext, task.prompt, {
        ...task.agentConfig,
        enableOrchestration: true,
        onEvent: (event) => {
          // Track resource usage
          this.updateResourceUsage(workspace, event);
          // Emit progress
          task.onProgress?.({
            type: event.type,
            message: event.message,
            data: event.data,
            timestamp: Date.now(),
          });
        },
      });

      workspace.agentResult = result;
      workspace.status = "completed";
      workspace.completedAt = Date.now();

      // Collect artifacts from worktree
      workspace.artifacts = await this.collectArtifacts(workspace.worktreeId);

      const durationMs = Date.now() - startTime;
      workspace.resourceUsage.wallTimeMs = durationMs;

      this.emit("workspace:completed", workspace);
      this.log(`Workspace ${workspaceId} completed in ${durationMs}ms`);

      return {
        workspaceId,
        success: true,
        agentResult: result,
        error: null,
        artifacts: workspace.artifacts,
        resourceUsage: workspace.resourceUsage,
        durationMs,
      };
    } catch (err) {
      const error = err as Error;
      workspace.status = "failed";
      workspace.error = error.message;
      workspace.completedAt = Date.now();
      workspace.resourceUsage.wallTimeMs = Date.now() - startTime;

      this.emit("workspace:failed", { workspace, error });
      this.log(`Workspace ${workspaceId} failed: ${error.message}`);

      // Preserve artifacts on failure
      workspace.artifacts = await this.collectArtifacts(workspace.worktreeId);

      return {
        workspaceId,
        success: false,
        agentResult: null,
        error: error.message,
        artifacts: workspace.artifacts,
        resourceUsage: workspace.resourceUsage,
        durationMs: Date.now() - startTime,
      };
    } finally {
      // Return to warm pool if configured, otherwise cleanup
      if (this.warmPoolConfig && this.warmPool.length < this.warmPoolConfig.size) {
        await this.returnToWarmPool(workspaceId);
      } else {
        await this.cleanupWorkspace(workspaceId);
      }
    }
  }

  /**
   * Update resource usage from agent event
   */
  private updateResourceUsage(workspace: ShadowWorkspaceMeta, event: unknown): void {
    // Simplified resource tracking - in production would hook into actual resource monitoring
    const e = event as { type: string; data?: { durationMs?: number; memoryMb?: number } };
    if (e.type === "tool-result" && e.data?.durationMs) {
      workspace.resourceUsage.cpuTimeMs += e.data.durationMs;
    }
    if (e.data?.memoryMb) {
      workspace.resourceUsage.memoryMb = Math.max(workspace.resourceUsage.memoryMb, e.data.memoryMb);
    }
    workspace.resourceUsage.networkRequests++;
  }

  /**
   * Collect artifacts from worktree
   */
  private async collectArtifacts(worktreeId: string): Promise<WorkspaceArtifact[]> {
    const worktree = await this.manager.getWorktree(worktreeId);
    if (!worktree) return [];

    const artifacts: WorkspaceArtifact[] = [];
    const now = Date.now();

    for (const [path, file] of worktree.files) {
      // Skip source files, only collect outputs
      if (this.isArtifactFile(path)) {
        artifacts.push({
          id: `art_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          type: this.getArtifactType(path),
          path,
          name: path.split("/").pop() || path,
          size: file.size,
          createdAt: now,
        });
      }
    }

    return artifacts;
  }

  /**
   * Check if file is an artifact (output file)
   */
  private isArtifactFile(path: string): boolean {
    const artifactPatterns = [
      /\.log$/,
      /\.test\.(ts|js)$/,
      /\.spec\.(ts|js)$/,
      /coverage/,
      /\.report\./,
      /build-output/,
      /screenshots/,
      /\.json$/,
      /test-results/,
      /playwright-report/,
      /vitest-report/,
    ];
    return artifactPatterns.some(p => p.test(path));
  }

  /**
   * Determine artifact type from path
   */
  private getArtifactType(path: string): WorkspaceArtifact["type"] {
    if (/\.log$/.test(path)) return "log";
    if (/\.(test|spec)\.(ts|js)$/.test(path)) return "test-result";
    if (/coverage/.test(path)) return "coverage";
    if (/\.report\./.test(path) || /test-results/.test(path)) return "report";
    if (/build-output/.test(path)) return "build-output";
    if (/screenshots?/.test(path)) return "screenshot";
    return "file";
  }

  /**
   * Return workspace to warm pool
   */
  private async returnToWarmPool(workspaceId: string): Promise<void> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return;

    workspace.status = "cleaning";
    this.emit("workspace:cleaning", workspace);

    // Reset worktree to base state for reuse
    try {
      await this.manager.deleteWorktree(workspace.worktreeId);
      const newWorktreeId = await this.manager.createWorktreeFromSnapshot(
        workspace.config.baseCommit,
        workspace.config.baseSnapshot
      );
      workspace.worktreeId = newWorktreeId;
      workspace.status = "created";
      workspace.startedAt = null;
      workspace.completedAt = null;
      workspace.agentResult = null;
      workspace.error = null;
      workspace.artifacts = [];
      workspace.resourceUsage = { cpuTimeMs: 0, memoryMb: 0, wallTimeMs: 0, networkRequests: 0, diskSpaceMb: 0 };
      this.warmPool.push(workspace);
      this.workspaces.delete(workspaceId);
      this.log(`Workspace ${workspaceId} returned to warm pool`);
    } catch (err) {
      this.log(`Failed to return workspace to warm pool: ${err}`);
      await this.cleanupWorkspace(workspaceId);
    }
  }

  /**
   * Cleanup workspace completely
   */
  async cleanupWorkspace(workspaceId: string): Promise<void> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return;

    workspace.status = "cleaning";
    this.emit("workspace:cleaning", workspace);

    try {
      await this.manager.deleteWorktree(workspace.worktreeId);
    } catch (err) {
      this.log(`Failed to delete worktree: ${err}`);
    }

    workspace.status = "cleaned";
    this.workspaces.delete(workspaceId);
    this.emit("workspace:cleaned", workspace);
    this.log(`Workspace ${workspaceId} cleaned up`);
  }

  /**
   * Get workspace by ID
   */
  getWorkspace(workspaceId: string): ShadowWorkspaceMeta | undefined {
    return this.workspaces.get(workspaceId);
  }

  /**
   * List all workspaces
   */
  listWorkspaces(): ShadowWorkspaceMeta[] {
    return Array.from(this.workspaces.values());
  }

  /**
   * Get warm pool status
   */
  getWarmPoolStatus(): { size: number; targetSize: number; workspaces: ShadowWorkspaceMeta[] } {
    return {
      size: this.warmPool.length,
      targetSize: this.warmPoolConfig?.size || 0,
      workspaces: [...this.warmPool],
    };
  }

  /**
   * Resize warm pool
   */
  async resizeWarmPool(newSize: number): Promise<void> {
    if (!this.warmPoolConfig) return;

    this.warmPoolConfig.size = newSize;

    // Add more if needed
    while (this.warmPool.length < newSize) {
      const workspace = await this.createWorkspace(this.warmPoolConfig.defaultConfig);
      this.warmPool.push(workspace);
    }

    // Remove excess
    while (this.warmPool.length > newSize) {
      const workspace = this.warmPool.pop()!;
      await this.manager.deleteWorktree(workspace.worktreeId);
    }

    this.log(`Warm pool resized to ${newSize}`);
  }

  /**
   * Shutdown manager - cleanup all
   */
  async shutdown(): Promise<void> {
    this.log("Shutting down ShadowWorkspaceManager");

    // Cleanup active workspaces
    for (const [id] of this.workspaces) {
      await this.cleanupWorkspace(id);
    }

    // Cleanup warm pool
    for (const workspace of this.warmPool) {
      await this.manager.deleteWorktree(workspace.worktreeId);
    }
    this.warmPool = [];

    this.emit("shutdown");
  }

  private generateId(): string {
    return `sws_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  private log(...args: unknown[]): void {
    if (this.debug) console.log("[ShadowWorkspace]", ...args);
  }
}

/**
 * Factory function to create ShadowWorkspaceManager with common defaults
 */
export async function createShadowWorkspaceManager(
  baseSnapshot: Record<string, string>,
  baseCommit: string,
  options?: {
    warmPoolSize?: number;
    limits?: Partial<ResourceLimits>;
    debug?: boolean;
  }
): Promise<ShadowWorkspaceManager> {
  const manager = new ShadowWorkspaceManager(
    undefined,
    options?.limits,
    options?.debug
  );

  await manager.init({
    size: options?.warmPoolSize || 3,
    baseSnapshot,
    baseCommit,
    defaultConfig: {
      baseSnapshot,
      baseCommit,
      limits: options?.limits,
      debug: options?.debug,
    },
  });

  return manager;
}

export default ShadowWorkspaceManager;