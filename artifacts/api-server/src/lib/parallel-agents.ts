/**
 * PARALLEL AGENT RUNNER — True Parallel Execution with Isolated Worktrees
 *
 * Spawns N agents each with their own virtual worktree.
 * Shared context via BroadcastChannel (read-only file map, decisions).
 * Results collected via Promise.allSettled with auto-cleanup.
 */

import type { LLMAdapter } from "./llm-adapter";
import { VirtualWorktreeManager, type WorktreeMeta, type MergeResult, getWorktreeManager } from "./virtual-worktree";
import { runUniversalAgent, type AgentLoopResult, type UniversalAgentConfig } from "./universal-agent";
import type { ToolExecutionContext } from "./tool-types";

/**
 * Configuration for parallel agent execution
 */
export interface ParallelAgentConfig {
  /** Number of parallel agents to spawn */
  agentCount: number;
  /** Base commit/snapshot for all worktrees */
  baseSnapshot: Record<string, string>;
  /** Base commit hash */
  baseCommit: string;
  /** Task prompt for each agent (can be same or different) */
  prompts: string | string[];
  /** LLM adapter to use */
  llm: LLMAdapter;
  /** Universal agent config overrides */
  agentConfig?: Partial<UniversalAgentConfig>;
  /** Tool execution context */
  context: ToolExecutionContext;
  /** Worktree manager (uses default if not provided) */
  worktreeManager?: VirtualWorktreeManager;
  /** Called when an agent completes */
  onAgentComplete?: (agentIndex: number, result: AgentLoopResult, worktreeId: string) => void;
  /** Called when an agent fails */
  onAgentError?: (agentIndex: number, error: Error, worktreeId: string) => void;
  /** Merge results after all agents complete */
  mergeResults?: boolean;
  /** Custom merge strategy */
  mergeStrategy?: "auto" | "manual" | "first-wins" | "last-wins";
  /** Timeout per agent (ms) */
  agentTimeoutMs?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Result from a single agent in parallel execution
 */
export interface ParallelAgentResult {
  agentIndex: number;
  worktreeId: string;
  result: AgentLoopResult | null;
  error: Error | null;
  status: "fulfilled" | "rejected";
  durationMs: number;
}

/**
 * Complete parallel execution result
 */
export interface ParallelExecutionResult {
  results: ParallelAgentResult[];
  mergedWorktreeId: string | null;
  mergeResult: MergeResult | null;
  totalDurationMs: number;
  successful: number;
  failed: number;
}

/**
 * Shared context broadcast channel (browser only)
 */
class SharedContextChannel {
  private channel: BroadcastChannel | null = null;
  private listeners: Map<string, (data: unknown) => void> = new Map();
  private isBrowser = typeof window !== "undefined" && "BroadcastChannel" in window;

  connect(channelName: string): void {
    if (!this.isBrowser) return;
    this.channel = new BroadcastChannel(channelName);
    this.channel.onmessage = (event) => {
      const listener = this.listeners.get(event.data.type);
      if (listener) listener(event.data.payload);
    };
  }

  disconnect(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }

  broadcast(type: string, payload: unknown): void {
    if (this.channel) {
      this.channel.postMessage({ type, payload, timestamp: Date.now() });
    }
  }

  on(type: string, listener: (data: unknown) => void): () => void {
    this.listeners.set(type, listener);
    return () => this.listeners.delete(type);
  }
}

/**
 * Agent execution context with worktree isolation
 */
interface AgentExecutionContext {
  agentIndex: number;
  worktreeId: string;
  worktreeManager: VirtualWorktreeManager;
  sharedContext: SharedContextChannel;
  baseSnapshot: Record<string, string>;
  baseCommit: string;
}

/**
 * Spawn multiple agents in parallel with isolated worktrees
 */
export async function spawnParallelAgents(
  config: ParallelAgentConfig
): Promise<ParallelExecutionResult> {
  const {
    agentCount,
    baseSnapshot,
    baseCommit,
    prompts,
    llm,
    agentConfig = {},
    context,
    worktreeManager = getWorktreeManager(),
    onAgentComplete,
    onAgentError,
    mergeResults = true,
    mergeStrategy = "auto",
    agentTimeoutMs = 300000, // 5 minutes default
    debug = false,
  } = config;

  const log = debug ? (...args: unknown[]) => console.log("[ParallelAgents]", ...args) : () => {};

  const startTime = Date.now();
  const promptArray = Array.isArray(prompts) ? prompts : Array(agentCount).fill(prompts);

  if (promptArray.length !== agentCount) {
    throw new Error(`Prompt array length (${promptArray.length}) must match agentCount (${agentCount})`);
  }

  // Initialize worktree manager
  await worktreeManager.init();

  // Create worktrees for each agent
  log(`Creating ${agentCount} worktrees from base commit ${baseCommit.slice(0, 8)}`);
  const worktreeIds = await Promise.all(
    Array.from({ length: agentCount }, (_, i) =>
      worktreeManager.createWorktreeFromSnapshot(baseCommit, baseSnapshot)
    )
  );

  log(`Created worktrees:`, worktreeIds);

  // Shared context channel for cross-agent communication (browser only)
  const sharedContext = new SharedContextChannel();
  const channelName = `infinity-parallel-${baseCommit.slice(0, 8)}-${Date.now()}`;
  sharedContext.connect(channelName);

  // Broadcast initial file map to all agents
  const fileMap = Object.keys(baseSnapshot).reduce((acc, path) => {
    acc[path] = { size: baseSnapshot[path].length, hash: hashContent(baseSnapshot[path]) };
    return acc;
  }, {} as Record<string, { size: number; hash: string }>);

  sharedContext.broadcast("file-map", fileMap);

  // Spawn agents in parallel
  log(`Spawning ${agentCount} agents in parallel`);
  const agentPromises = worktreeIds.map(async (worktreeId, index): Promise<ParallelAgentResult> => {
    const agentStartTime = Date.now();

    try {
      // Create agent-specific context with worktree isolation
      const agentContext: ToolExecutionContext = {
        ...context,
        worktreeId,
        worktreeManager,
        sharedContext,
        agentIndex: index,
      };

      // Run the universal agent with the prompt
      const result = await Promise.race([
        runUniversalAgent(llm, agentContext, promptArray[index], {
          ...agentConfig,
          enableOrchestration: true,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Agent ${index} timeout after ${agentTimeoutMs}ms`)), agentTimeoutMs)
        ),
      ]);

      const durationMs = Date.now() - agentStartTime;
      log(`Agent ${index} (${worktreeId}) completed in ${durationMs}ms`);

      onAgentComplete?.(index, result, worktreeId);

      return {
        agentIndex: index,
        worktreeId,
        result,
        error: null,
        status: "fulfilled",
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - agentStartTime;
      const error = err as Error;
      log(`Agent ${index} (${worktreeId}) failed after ${durationMs}ms:`, error.message);

      onAgentError?.(index, error, worktreeId);

      return {
        agentIndex: index,
        worktreeId,
        result: null,
        error,
        status: "rejected",
        durationMs,
      };
    }
  });

  // Wait for all agents with Promise.allSettled
  const settledResults = await Promise.allSettled(agentPromises);
  const results: ParallelAgentResult[] = settledResults.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      agentIndex: i,
      worktreeId: worktreeIds[i],
      result: null,
      error: r.reason,
      status: "rejected" as const,
      durationMs: 0,
    };
  });

  const successful = results.filter(r => r.status === "fulfilled").length;
  const failed = results.filter(r => r.status === "rejected").length;
  log(`Parallel execution complete: ${successful} succeeded, ${failed} failed`);

  // Merge results if requested and there are successful agents
  let mergedWorktreeId: string | null = null;
  let mergeResult: MergeResult | null = null;

  if (mergeResults && successful > 0) {
    const successfulWorktrees = results
      .filter(r => r.status === "fulfilled")
      .map(r => r.worktreeId);

    if (successfulWorktrees.length > 1) {
      log(`Merging ${successfulWorktrees.length} worktrees using strategy: ${mergeStrategy}`);

      // Use first successful worktree as merge target
      const targetId = successfulWorktrees[0];
      const sourceIds = successfulWorktrees.slice(1);

      try {
        mergeResult = await worktreeManager.mergeWorktrees(targetId, sourceIds);
        mergedWorktreeId = targetId;
        log(`Merge ${mergeResult.success ? "succeeded" : "had conflicts"}: ${mergeResult.conflicts.length} conflicts`);
      } catch (err) {
        log("Merge failed:", err);
        mergeResult = {
          success: false,
          mergedFiles: new Map(),
          conflicts: [],
          newCommit: "",
        };
      }
    } else if (successfulWorktrees.length === 1) {
      // Only one successful agent, use its worktree
      mergedWorktreeId = successfulWorktrees[0];
      const meta = await worktreeManager.getWorktree(mergedWorktreeId);
      mergeResult = {
        success: true,
        mergedFiles: meta?.files || new Map(),
        conflicts: [],
        newCommit: meta?.baseCommit || baseCommit,
      };
    }
  }

  // Cleanup shared context channel
  sharedContext.disconnect();

  // Optionally clean up failed worktrees (keep successful for inspection)
  // In production, you might want to keep all for debugging
  // await Promise.all(
  //   results
  //     .filter(r => r.status === "rejected")
  //     .map(r => worktreeManager.deleteWorktree(r.worktreeId))
  // );

  const totalDurationMs = Date.now() - startTime;

  return {
    results,
    mergedWorktreeId,
    mergeResult,
    totalDurationMs,
    successful,
    failed,
  };
}

/**
 * Run a group of agents with different prompts but same base (for judge panel, adversarial verify, etc.)
 */
export async function runAgentGroup(
  prompts: string[],
  baseSnapshot: Record<string, string>,
  baseCommit: string,
  llm: LLMAdapter,
  context: ToolExecutionContext,
  config?: Partial<ParallelAgentConfig>
): Promise<ParallelExecutionResult> {
  return spawnParallelAgents({
    agentCount: prompts.length,
    baseSnapshot,
    baseCommit,
    prompts,
    llm,
    context,
    ...config,
  });
}

/**
 * Run adversarial verification with multiple skeptic agents
 */
export async function runAdversarialAgents(
  claim: string,
  contextSnapshot: Record<string, string>,
  baseCommit: string,
  llm: LLMAdapter,
  context: ToolExecutionContext,
  votes = 3,
  agentConfig?: Partial<UniversalAgentConfig>
): Promise<ParallelExecutionResult> {
  const skepticPrompt = `You are a rigorous skeptic. Your job is to REFUTE the following claim.

CLAIM: "${claim}"

CONTEXT: You have access to the codebase. Search, read, and analyze to find evidence.

INSTRUCTIONS:
- Default to REFUTE if you are uncertain.
- Only SUPPORT if you are HIGHLY CONFIDENT the claim is correct.
- Be adversarial: look for edge cases, missing evidence, logical flaws, alternative explanations.
- Output your verdict as JSON: { "verdict": "refute" | "support" | "uncertain", "reasoning": "detailed explanation", "confidence": 0.0-1.0 }`;

  return runAgentGroup(
    Array(votes).fill(skepticPrompt),
    contextSnapshot,
    baseCommit,
    llm,
    context,
    { agentConfig, debug: true }
  );
}

/**
 * Run judge panel with multiple approach agents
 */
export async function runJudgePanelAgents(
  task: string,
  approaches: string[],
  baseSnapshot: Record<string, string>,
  baseCommit: string,
  llm: LLMAdapter,
  context: ToolExecutionContext,
  agentConfig?: Partial<UniversalAgentConfig>
): Promise<ParallelExecutionResult> {
  const approachPrompts = approaches.map((approach, i) =>
    `You are implementing approach ${i + 1} for the following task:

TASK: ${task}

APPROACH: ${approach}

Implement this approach fully. Output your solution as a complete implementation.`
  );

  return runAgentGroup(
    approachPrompts,
    baseSnapshot,
    baseCommit,
    llm,
    context,
    { agentConfig, debug: true }
  );
}

/**
 * Hash content for comparison
 */
function hashContent(content: string): string {
  // Simple hash for browser compatibility
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

/**
 * Utility: Create a snapshot from a directory (Node.js only)
 */
export async function createSnapshotFromDirectory(dirPath: string): Promise<Record<string, string>> {
  if (typeof window !== "undefined") {
    throw new Error("createSnapshotFromDirectory only available in Node.js");
  }

  const fs = require("fs/promises");
  const path = require("path");

  const snapshot: Record<string, string> = {};

  async function walk(currentPath: string, relativePath = "") {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        // Skip node_modules, .git, dist, build
        if (!["node_modules", ".git", "dist", "build", ".infinity"].includes(entry.name)) {
          await walk(fullPath, relPath);
        }
      } else if (entry.isFile()) {
        try {
          const content = await fs.readFile(fullPath, "utf8");
          snapshot[relPath] = content;
        } catch {
          // Skip binary files
        }
      }
    }
  }

  await walk(dirPath);
  return snapshot;
}

/**
 * Utility: Apply snapshot to directory (Node.js only)
 */
export async function applySnapshotToDirectory(snapshot: Record<string, string>, dirPath: string): Promise<void> {
  if (typeof window !== "undefined") {
    throw new Error("applySnapshotToDirectory only available in Node.js");
  }

  const fs = require("fs/promises");
  const path = require("path");

  for (const [relPath, content] of Object.entries(snapshot)) {
    const fullPath = path.join(dirPath, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf8");
  }
}