/**
 * BUILD ORCHESTRATOR — Multi-Agent Pipeline State Machine
 *
 * Manages: Planner → Coder(s) → Reviewer → Fixer (max 3 iterations)
 * Shared context store persists across all agents.
 *
 * The orchestrator coordinates specialized agents. Coder/Fixer steps reuse the
 * proven tool-use loop from build-agent.ts (runAgentForStep). Planner/Reviewer
 * use dedicated prompts + the model-agnostic LLM adapter. All tool execution
 * goes through build-tools.ts (executeTool), so file/command access is
 * consistently scoped and sandboxed.
 */

import { z } from "zod";
import { adapterFactory, createBestAdapter, createCrewRoleAdapter } from "./adapter-factory";
import { buildInfinityPrompt, sanitizePrompt, getRoleRuleBlock } from "./infinity-prompt";
import { MessageBus } from "./build-message-bus";
import { askHelper } from "./build-helper";
import type { LLMAdapter, LLMCapabilities } from "./llm-adapter";
import { executeTool, formatToolResults, type ToolCall, type ToolExecutionContext, type ToolResult, TOOL_DEFINITIONS } from "./build-tools";
import { runAgentForStep, type PlanStep as AgentPlanStep, type AgentConfig } from "./build-agent";
import { buildPlannerPrompt } from "./agent-prompts/planner";
import { buildCoderPrompt } from "./agent-prompts/coder";
import { buildReviewerPrompt } from "./agent-prompts/reviewer";
import { buildFixerPrompt } from "./agent-prompts/fixer";
import { getWorkingContext, serializeContext, setProjectGoal, refreshFileMap, recordStep } from "./build-context";
import { readWorkspaceFileText } from "./workspace";
import { buildProjectContextForBuild } from "./build-project-context";
import {
  buildProjectMap,
  getProjectMap,
  updateProjectMapForFile,
  analyzeImpact,
  selectContextForGoal,
  saveProjectMap,
  loadProjectMap,
  type ProjectMap,
  type ImpactAnalysis,
  type SmartContextSelection,
} from "./build-project-map";
import { logBuildEvent } from "./build-telemetry";
import { emitBuildPhaseEvent } from "./safety-watcher";
import { withRetry } from "./build-edge-cases";
import { initializeBuildWatchdog, shutdownBuildWatchdog, recordWatchdogTurn, BuildWatchdog } from "./build-watchdog";
import type { ToolCall, ToolResult } from "./build-tools";
import {
  adversarialVerify,
  pipelineConcurrent,
  parallel,
  type AdversarialVerifyResult,
} from "./orchestration-engine";
import {
  autoCompactContext,
  shouldCompact,
  createTokenBudget,
  TokenBudget,
  PreservationRules,
  createPreservationRules,
  extractPreservationRules,
  COMPACTION_LEVELS,
  countMessageTokens,
} from "./context-compactor";
import { BuildMapAgent, type BuildStepContext } from "./build-map-agent";

// ============================================================================
// SCHEMAS
// ============================================================================

export const PlanStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  type: z.enum(["create", "modify", "delete", "refactor", "test", "research"]),
  targetFiles: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  dependencies: z.array(z.string()),
  riskLevel: z.enum(["low", "medium", "high"]),
  estimatedComplexity: z.enum(["trivial", "simple", "moderate", "complex"]),
});

export const PlanSchema = z.object({
  goal: z.string(),
  steps: z.array(PlanStepSchema),
  summary: z.string(),
  estimatedTotalSteps: z.number(),
  parallelizableGroups: z.array(z.array(z.string())),
});

export const CoderHandoffSchema = z.object({
  stepId: z.string(),
  status: z.enum(["completed", "failed", "blocked"]),
  changes: z.array(z.object({
    file: z.string(),
    operation: z.enum(["create", "modify", "delete"]),
    summary: z.string(),
  })),
  verification: z.object({
    typecheck: z.boolean(),
    lint: z.boolean(),
    tests: z.boolean(),
    notes: z.string(),
  }),
  blockers: z.array(z.string()),
  notesForReviewer: z.string(),
});

export const ReviewFindingSchema = z.object({
  severity: z.enum(["critical", "major", "minor", "nit"]),
  category: z.enum(["correctness", "types", "style", "security", "performance", "accessibility", "tests"]),
  file: z.string(),
  line: z.number(),
  message: z.string(),
  suggestion: z.string(),
});

export const ReviewSchema = z.object({
  stepId: z.string(),
  verdict: z.enum(["pass", "fail", "needs-fixes"]),
  acceptanceCriteria: z.array(z.object({
    criterion: z.string(),
    status: z.enum(["pass", "fail"]),
    evidence: z.string(),
  })),
  findings: z.array(ReviewFindingSchema),
  verification: z.object({
    typecheck: z.boolean(),
    lint: z.boolean(),
    tests: z.boolean(),
    ranByReviewer: z.boolean(),
  }),
  summary: z.string(),
  blockerForFixer: z.boolean(),
});

export const FixerHandoffSchema = z.object({
  stepId: z.string(),
  iteration: z.number(),
  fixesApplied: z.array(z.object({
    findingIndex: z.number(),
    file: z.string(),
    change: z.string(),
    verified: z.boolean(),
  })),
  remainingFindings: z.array(z.number()), // indices of unfixed findings
  verification: z.object({
    typecheck: z.boolean(),
    lint: z.boolean(),
    tests: z.boolean(),
    notes: z.string(),
  }),
  status: z.enum(["all-fixed", "partial", "blocked"]),
});

// ============================================================================
// SHARED CONTEXT STORE
// ============================================================================

export interface BuildContext {
  fileMap: string;
  projectInstructions: string;
  projectMemory: string;
  recentActivity: string;
  gitStatus: string;
  // Runtime state
  completedSteps: Map<string, { summary: string; files: string[] }>;
  modifiedFiles: Map<string, string>; // path -> current content
  stepOutputs: Map<string, unknown>; // stepId -> handoff/review/fixer output
}

export function createEmptyContext(): BuildContext {
  return {
    fileMap: "",
    projectInstructions: "",
    projectMemory: "",
    recentActivity: "",
    gitStatus: "",
    completedSteps: new Map(),
    modifiedFiles: new Map(),
    stepOutputs: new Map(),
  };
}

// ============================================================================
// ORCHESTRATOR CLASS
// ============================================================================

export interface OrchestratorResult {
  success: boolean;
  plan: z.infer<typeof PlanSchema>;
  results: Map<string, unknown>;
  events: OrchestratorEvent[];
  error?: string;
}

export interface OrchestratorEvent {
  phase: "planner" | "coder" | "reviewer" | "fixer" | "orchestrator";
  stepId: string;
  message: string;
  timestamp: string;
}

type ProgressCallback = (event: OrchestratorEvent) => void;

export class BuildOrchestrator {
  private llm!: LLMAdapter;

  /** Phase 2 — per-project crew message bus (durable conversation log + steering). */
  private bus!: MessageBus;
  /** Phase 2 — per-role adapter cache (planner/reviewer=max tier, coder/fixer=high). */
  private adapters = new Map<string, LLMAdapter>();
  /** Phase 2 — steering cursor: only instructions newer than this are injected. */
  private lastSteeringSeq = 0;
  private context: BuildContext;
  private projectId: string;
  private workspaceId: string;
  private apiBaseUrl: string;
  private apiKey: string;
  private maxFixIterations = 3;
  private toolContext: ToolExecutionContext;
  private onProgress?: ProgressCallback;
  private events: OrchestratorEvent[] = [];

  // Token budget and compaction
  private tokenBudget: TokenBudget;
  private preservationRules: PreservationRules;
  private enableAutoCompact = true;
  private onContextCompacted?: (result: { level: number; tokensSaved: number; description: string; phase: string }) => void;

  // Build Map Agent for autonomous roadmap updates
  private buildMapAgent: BuildMapAgent | null = null;

  // Phase 3 — Local Watchdog sidecar
  private watchdog: BuildWatchdog | null = null;

  private constructor(params: {
    projectId: string;
    workspaceId?: string;
    apiBaseUrl?: string;
    apiKey?: string;
    model?: string;
    toolContext: ToolExecutionContext;
    onProgress?: ProgressCallback;
    tokenBudget?: TokenBudget;
    preservationRules?: Partial<PreservationRules>;
    enableAutoCompact?: boolean;
    onContextCompacted?: (result: { level: number; tokensSaved: number; description: string; phase: string }) => void;
  }) {
    this.projectId = params.projectId;
    this.workspaceId = params.workspaceId || params.projectId;
    // Phase 2 — each build gets its own crew conversation channel.
    this.bus = new MessageBus(params.projectId);
    this.apiBaseUrl = params.apiBaseUrl || "";
    this.apiKey = params.apiKey || "";
    this.onProgress = params.onProgress;
    this.toolContext = params.toolContext;
    this.enableAutoCompact = params.enableAutoCompact ?? true;
    this.onContextCompacted = params.onContextCompacted;
    // llm will be initialized via init()
    this.context = createEmptyContext();

    // Initialize token budget and preservation rules after llm is available (in init)
    this.tokenBudget = params.tokenBudget || { maxContextTokens: 128000, maxOutputTokens: 8192, usedTokens: 0, reservedOutputTokens: 8192, warningThreshold: 89600, compactThreshold: 108800, emergencyThreshold: 121600, model: "default" };
    this.preservationRules = createPreservationRules();
    if (params.preservationRules) {
      this.preservationRules = { ...this.preservationRules, ...params.preservationRules };
    }
  }

  static async create(params: {
    projectId: string;
    workspaceId?: string;
    apiBaseUrl?: string;
    apiKey?: string;
    model?: string;
    toolContext: ToolExecutionContext;
    onProgress?: ProgressCallback;
    tokenBudget?: TokenBudget;
    preservationRules?: Partial<PreservationRules>;
    enableAutoCompact?: boolean;
    onContextCompacted?: (result: { level: number; tokensSaved: number; description: string; phase: string }) => void;
  }): Promise<BuildOrchestrator> {
    const orch = new BuildOrchestrator(params);
    orch.llm = params.model
      ? await adapterFactory.createAdapter({ adapterType: "auto", modelHint: params.model })
      : await createBestAdapter();

    // Initialize token budget with actual model capabilities
    if (!params.tokenBudget) {
      const capabilities = orch.llm.getCapabilities();
      orch.tokenBudget = createTokenBudget(
        "build-orchestrator",
        capabilities.maxContextTokens,
        capabilities.maxOutputTokens
      );
    }

    // Initialize Build Map Agent for autonomous roadmap updates
    orch.buildMapAgent = new BuildMapAgent(params.projectId, orch.llm);

    return orch;
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  async orchestrate(goal: string): Promise<OrchestratorResult> {
    this.emitProgress("planner", "start", `Planning: ${goal}`);

    // Emit build phase event - planning started
    try {
      await emitBuildPhaseEvent({
        projectId: this.projectId,
        phase: "planning",
        status: "started",
        stepsTotal: 0,
        stepsCompleted: 0,
        currentStep: "planning",
      });
    } catch (e) {
      console.error("Failed to emit build phase safety event:", e);
    }

    // 1. Load project context
    await this.loadContext(goal);

    // Phase 3 — Initialize Local Watchdog sidecar
    // The watchdog monitors the agent loop for errors, policy violations, and stalls
    try {
      this.watchdog = await initializeBuildWatchdog(this.projectId, this.bus.getThreadId(), {
        sampleEveryNTurns: 1,  // Check every turn for tight monitoring
        maxTurnsBeforeForceStop: 50,
        enabled: true,
      });
      this.emitProgress("orchestrator", "watchdog", "Local watchdog started");
    } catch (err) {
      console.error("[BuildOrchestrator] Failed to initialize watchdog:", err);
    }

    // 2. PLANNER — create execution plan
    const plan = await this.runPlanner(goal);
    this.emitProgress("planner", "done", `Plan created: ${plan.steps.length} steps`);

    // Phase 2 — the planner broadcasts the plan onto the crew bus so every role
    // shares the same intent (the "what are we building" anchoring message).
    await this.safePost({
      fromRole: "planner",
      kind: "handoff",
      content: `Plan created: ${plan.steps.length} steps — ${plan.summary}`,
      payload: { stepIds: plan.steps.map((s) => s.id), titles: plan.steps.map((s) => s.title) },
    });

    // Emit build phase event - planning completed
    try {
      await emitBuildPhaseEvent({
        projectId: this.projectId,
        phase: "planning",
        status: "completed",
        stepsTotal: plan.steps.length,
        stepsCompleted: 0,
        currentStep: "planning",
      });
    } catch (e) {
      console.error("Failed to emit build phase safety event:", e);
    }

    // 3. Execute steps in dependency order with parallel groups
    const results = await this.executePlan(plan);

    // 4. Final Build Map update - mark features as done
    if (this.buildMapAgent) {
      try {
        const allFilesChanged = Array.from(this.context.modifiedFiles.keys());
        const finalContext: BuildStepContext = {
          projectId: this.projectId,
          stepId: "complete",
          stepName: "complete",
          goal: this.context.projectInstructions || "",
          filesChanged: allFilesChanged,
          diffSummary: "Build completed",
          timestamp: new Date().toISOString(),
        };
        await this.buildMapAgent.onBuildStepComplete(finalContext);
        this.emitProgress("orchestrator", "done", "Final Build Map update complete");
      } catch (err) {
        this.emitProgress("orchestrator", "done", `Final Build Map update failed (non-critical): ${err}`);
      }
    }

    // 5. Final summary
    const success = Array.from(results.values()).every(r => {
      if (typeof r === "object" && r && "status" in r) {
        return (r as any).status === "completed" || (r as any).status === "all-fixed";
      }
      return true;
    });

    // Emit build phase event - build completed/failed
    try {
      await emitBuildPhaseEvent({
        projectId: this.projectId,
        phase: "build",
        status: success ? "completed" : "failed",
        stepsTotal: plan.steps.length,
        stepsCompleted: Array.from(results.values()).filter(r => {
          if (typeof r === "object" && r && "status" in r) {
            return (r as any).status === "completed" || (r as any).status === "all-fixed";
          }
          return true;
        }).length,
        currentStep: "complete",
      });
    } catch (e) {
      console.error("Failed to emit build phase safety event:", e);
    }

    // Phase 3 — Shutdown watchdog
    try {
      if (this.watchdog) {
        await shutdownBuildWatchdog();
        this.watchdog = null;
        this.emitProgress("orchestrator", "watchdog", "Local watchdog stopped");
      }
    } catch (err) {
      console.error("[BuildOrchestrator] Failed to shutdown watchdog:", err);
    }

    this.emitProgress("orchestrator", "done", success ? "All steps completed successfully" : "Some steps failed");
    return { success, plan, results, events: this.events };
  }

  // ---------------------------------------------------------------------------
  // CONTEXT LOADING
  // ---------------------------------------------------------------------------

  private async loadContext(goal: string): Promise<void> {
    setProjectGoal(this.projectId, goal);
    await refreshFileMap(this.projectId, this.workspaceId);

    // 1. Build/load the project map (pre-build analysis)
    this.emitProgress("orchestrator", "project-map", "Building project map...");
    let projectMap: ProjectMap;
    try {
      // Try to load existing map first
      const loadedMap = await loadProjectMap(this.projectId);
      if (!loadedMap) {
        projectMap = await buildProjectMap(this.projectId, this.workspaceId);
      } else {
        projectMap = loadedMap;
      }
      // Save updated map
      await saveProjectMap(this.projectId);
    } catch (err) {
      this.emitProgress("orchestrator", "project-map", `Project map build failed: ${err}`);
      projectMap = await buildProjectMap(this.projectId, this.workspaceId);
    }

    // 2. Use smart context selection for the goal
    const smartContext = await selectContextForGoal(this.projectId, goal, this.workspaceId, 50000);
    this.emitProgress("orchestrator", "project-map", `Selected ${smartContext.relevantFiles.length} relevant files for goal`);

    this.context.fileMap = serializeContext(this.projectId);
    try {
      const projectCtx = await buildProjectContextForBuild(this.projectId, goal, {
        includeActivity: true,
        includeFiles: true,
        activityLimit: 20,
        fileLimit: 50,
      });
      this.context.projectInstructions = projectCtx || "";
    } catch {
      // Project context is optional; continue with fileMap only
    }
    this.context.gitStatus = await this.callTool("git_diff", {}) as string;

    // Store project map reference for use in steps
    (this.context as any).projectMap = projectMap;
    (this.context as any).smartContext = smartContext;

    // ===== PRE-BUILD COMPACTION CHECK =====
    if (this.enableAutoCompact) {
      await this.checkAndCompactContext("pre-build");
    }
    // ===== END PRE-BUILD COMPACTION =====
  }

  /**
   * Check token budget and compact context if needed
   */
  private async checkAndCompactContext(phase: string): Promise<void> {
    if (!this.enableAutoCompact) return;

    // Estimate current token usage from context
    const estimatedTokens = await countMessageTokens([
      { role: "system", content: this.context.fileMap },
      { role: "system", content: this.context.projectInstructions },
      { role: "system", content: this.context.projectMemory },
      { role: "system", content: this.context.gitStatus },
    ] as any, "default");

    const capabilities = this.llm.getCapabilities();
    const compactCheck = shouldCompact(
      { inputTokens: estimatedTokens, outputTokens: 0, totalTokens: estimatedTokens },
      capabilities
    );

    if (compactCheck.shouldCompact) {
      this.emitProgress("orchestrator", phase, `Auto-compacting context (level ${compactCheck.level}): ${compactCheck.reason}`);

      // Update preservation rules from current context
      this.preservationRules = extractPreservationRules([], {
        fileMap: this.context.fileMap,
        keyDecisions: Array.from(this.context.completedSteps.entries()).map(([id, data]) => ({ topic: id, decision: data.summary, rationale: "", timestamp: Date.now() })),
        errorPatterns: [],
        currentPlan: null,
        originalGoal: this.context.projectInstructions,
        projectInstructions: [this.context.projectInstructions],
        userInstructions: [],
      });

      const compactResult = await autoCompactContext({
        messages: [
          { role: "system", content: this.context.fileMap },
          { role: "system", content: this.context.projectInstructions },
          { role: "system", content: this.context.projectMemory },
          { role: "system", content: this.context.gitStatus },
        ],
        workingContext: {
          fileMap: this.context.fileMap,
          keyDecisions: Array.from(this.context.completedSteps.entries()).map(([id, data]) => ({ topic: id, decision: data.summary })),
          errorPatterns: [],
          tokenBudget: this.tokenBudget,
          currentPlan: null,
          originalGoal: this.context.projectInstructions,
          projectInstructions: [this.context.projectInstructions],
        },
        tokenBudget: this.tokenBudget,
        modelCapabilities: capabilities,
        preserveRules: this.preservationRules,
        llmAdapter: this.llm,
      });

      if (compactResult.compactionResults.length > 0) {
        // Update context with compacted versions
        const compactedMessages = compactResult.messages || [];
        for (const msg of compactedMessages) {
          if (msg.role === "system" && msg.content && typeof msg.content === "string") {
            if (msg.content.includes("FILE MAP") || msg.content.includes("fileMap")) {
              this.context.fileMap = msg.content;
            } else if (msg.content.includes("PROJECT INSTRUCTIONS")) {
              this.context.projectInstructions = msg.content;
            } else if (msg.content.includes("PROJECT MEMORY")) {
              this.context.projectMemory = msg.content;
            }
          }
        }
        this.tokenBudget = { ...this.tokenBudget, usedTokens: Math.max(0, this.tokenBudget.usedTokens - compactResult.totalTokensSaved) };

        // Emit compaction event
        this.emitProgress("orchestrator", phase, `Context compacted: saved ${compactResult.totalTokensSaved} tokens (level ${compactResult.finalLevel})`);

        // Call callback if provided
        this.onContextCompacted?.({
          level: compactResult.finalLevel,
          tokensSaved: compactResult.totalTokensSaved,
          description: compactResult.compactionResults.map(r => r.description).join("; "),
          phase,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // PLANNER PHASE
  // ---------------------------------------------------------------------------

  private async runPlanner(goal: string): Promise<z.infer<typeof PlanSchema>> {
    const prompt = buildPlannerPrompt(goal, {
      fileMap: this.context.fileMap,
      projectInstructions: this.context.projectInstructions,
      projectMemory: this.context.projectMemory,
      recentActivity: this.context.recentActivity,
      gitStatus: this.context.gitStatus,
    });

    const response = await withRetry(
      async () => (await this.adapterFor("planner")).complete([
        { role: "system", content: sanitizePrompt(`${getRoleRuleBlock("planner")}\n\n${prompt}`) },
        { role: "user", content: "Generate the plan JSON." },
      ], { temperature: 0.2, maxTokens: 2000, jsonMode: true } as any),
      { maxAttempts: 3, baseDelayMs: 1000, backoffMultiplier: 2 },
      { projectId: this.projectId, operation: "orchestrate-planner" }
    );

    const plan = PlanSchema.parse(JSON.parse(this.extractJson(response.content)));
    return plan;
  }

  // ---------------------------------------------------------------------------
  // PLAN EXECUTION
  // ---------------------------------------------------------------------------

  private async executePlan(plan: z.infer<typeof PlanSchema>): Promise<Map<string, unknown>> {
    const results = new Map<string, unknown>();
    const completed = new Set<string>();

    // Topological sort based on dependencies
    const executionOrder = this.topologicalSort(plan.steps);

    // Group by parallelizable sets (fall back to topo order)
    const parallelGroups = this.buildParallelGroups(plan, executionOrder);

    // Phase 3 — Listen for watchdog force_stop event
    let watchdogForceStopped = false;
    if (this.watchdog) {
      this.watchdog.on("force_stop", (data) => {
        watchdogForceStopped = true;
        this.emitProgress("orchestrator", "force_stop", `Watchdog forced stop: ${data.reason}`);
      });
    }

    for (const group of parallelGroups) {
      // Check if watchdog forced a stop
      if (watchdogForceStopped) {
        this.emitProgress("orchestrator", "force_stop", "Stopping plan execution due to watchdog force stop");
        break;
      }

      // Execute all steps in this group in parallel
      const promises = group.map(step => this.executeStep(step, plan, results));
      const stepResults = await Promise.allSettled(promises);

      stepResults.forEach((result, i) => {
        const step = group[i];
        if (result.status === "fulfilled") {
          results.set(step.id, result.value);
          completed.add(step.id);
          this.context.completedSteps.set(step.id, {
            summary: (result.value as any).summary || "Completed",
            files: (result.value as any).filesChanged || [],
          });
          // Save checkpoint with compacted context after each step
          if (this.enableAutoCompact) {
            this.saveCheckpointWithCompactedContext(step.id).catch(e =>
              this.emitProgress("orchestrator", step.id, `Checkpoint save failed: ${e}`)
            );
          }
        } else {
          results.set(step.id, { status: "failed", error: result.reason });
          this.emitProgress("coder", step.id, `Failed: ${result.reason}`);
        }
      });

      // Record turn for watchdog after each group completes
      if (this.watchdog) {
        // Note: Individual agent turns are recorded via recordWatchdogTurn in runCoder/runReviewer/runFixer
        // This is just a safety checkpoint
      }
    }

    return results;
  }

  private topologicalSort(steps: z.infer<typeof PlanStepSchema>[]): z.infer<typeof PlanStepSchema>[] {
    const sorted: z.infer<typeof PlanStepSchema>[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const stepMap = new Map(steps.map(s => [s.id, s]));

    function visit(stepId: string) {
      if (visited.has(stepId)) return;
      if (visiting.has(stepId)) throw new Error(`Circular dependency detected: ${stepId}`);
      visiting.add(stepId);
      const step = stepMap.get(stepId);
      if (step) {
        for (const dep of step.dependencies) visit(dep);
      }
      visiting.delete(stepId);
      visited.add(stepId);
      const stepObj = stepMap.get(stepId);
      if (stepObj) sorted.push(stepObj);
    }

    for (const step of steps) visit(step.id);
    return sorted;
  }

  private buildParallelGroups(plan: z.infer<typeof PlanSchema>, executionOrder: z.infer<typeof PlanStepSchema>[]): z.infer<typeof PlanStepSchema>[][] {
    // Use the plan's parallelizableGroups if provided, otherwise each step is its own group
    if (plan.parallelizableGroups.length > 0) {
      return plan.parallelizableGroups.map(groupIds =>
        groupIds.map(id => plan.steps.find(s => s.id === id)!).filter(Boolean)
      );
    }
    // Fallback: each step in its own group (sequential)
    return executionOrder.map(s => [s]);
  }

  // ---------------------------------------------------------------------------
  // STEP EXECUTION (Coder → Reviewer → Fixer loop)
  // ---------------------------------------------------------------------------

  private async executeStep(
    step: z.infer<typeof PlanStepSchema>,
    plan: z.infer<typeof PlanSchema>,
    results: Map<string, unknown>
  ): Promise<unknown> {
    // ===== PRE-STEP COMPACTION CHECK =====
    if (this.enableAutoCompact) {
      await this.checkAndCompactContext(`pre-step-${step.id}`);
    }
    // ===== END PRE-STEP COMPACTION =====

    this.emitProgress("coder", step.id, `Starting: ${step.title}`);

    // Emit build phase event - coder started
    try {
      await emitBuildPhaseEvent({
        projectId: this.projectId,
        phase: "coder",
        status: "started",
        stepsTotal: plan.steps.length,
        stepsCompleted: this.context.completedSteps.size,
        currentStep: step.id,
      });
    } catch (e) {
      console.error("Failed to emit build phase safety event:", e);
    }

    // Gather context for this step
    const stepContext = this.gatherStepContext(step, plan);

    // Run Coder (delegates to proven tool-use loop)
    const coderHandoff = await this.runCoder(step, stepContext);
    if (coderHandoff.status === "failed" || coderHandoff.status === "blocked") {
      // Emit build phase event - coder failed
      try {
        await emitBuildPhaseEvent({
          projectId: this.projectId,
          phase: "coder",
          status: "failed",
          stepsTotal: plan.steps.length,
          stepsCompleted: this.context.completedSteps.size,
          currentStep: step.id,
          error: coderHandoff.blockers?.join(", ") || "Coder failed",
        });
      } catch (e) {
        console.error("Failed to emit build phase safety event:", e);
      }
      return coderHandoff;
    }

    // Emit build phase event - coder completed
    try {
      await emitBuildPhaseEvent({
        projectId: this.projectId,
        phase: "coder",
        status: "completed",
        stepsTotal: plan.steps.length,
        stepsCompleted: this.context.completedSteps.size + 1,
        currentStep: step.id,
      });
    } catch (e) {
      console.error("Failed to emit build phase safety event:", e);
    }

    // Update context with Coder's changes
    this.applyCoderChanges(coderHandoff);

    // Run Reviewer
    const review = await this.runReviewer(step, coderHandoff, stepContext);

    // Emit build phase event - reviewer completed
    try {
      await emitBuildPhaseEvent({
        projectId: this.projectId,
        phase: "reviewer",
        status: review.verdict === "pass" ? "completed" : "needs-fixes",
        stepsTotal: plan.steps.length,
        stepsCompleted: this.context.completedSteps.size + 1,
        currentStep: step.id,
        error: review.verdict !== "pass" ? `Found ${review.findings.length} issues` : undefined,
      });
    } catch (e) {
      console.error("Failed to emit build phase safety event:", e);
    }

    // If pass, we're done
    if (review.verdict === "pass") {
      this.emitProgress("reviewer", step.id, "Passed");
      return { status: "completed", review };
    }

    // Adversarial verification of review findings
    // If reviewer found issues, verify them with independent skeptics
    if (review.findings.length > 0) {
      this.emitProgress("reviewer", step.id, `Adversarial verification of ${review.findings.length} findings...`);
      const claims = review.findings.map(f => `${f.file}:${f.line} — ${f.message} (${f.severity})`);

      const verifyResults = await parallel(
        claims.map(claim => () => adversarialVerify(claim, { votes: 3 }))
      );

      const verifiedFindings = review.findings.filter((f, i) => {
        const result = verifyResults[i] as AdversarialVerifyResult;
        if (!result) return true; // Keep if verification failed
        if (!result.survives) {
          this.emitProgress("reviewer", step.id, `Finding REFUTED by skeptics: ${f.message}`);
          return false; // Drop refuted finding
        }
        return true; // Keep verified finding
      });

      if (verifiedFindings.length !== review.findings.length) {
        this.emitProgress("reviewer", step.id, `${review.findings.length - verifiedFindings.length} findings refuted, ${verifiedFindings.length} verified`);
        // Update review with verified findings only
        (review as any).findings = verifiedFindings;
        // If all findings refuted, treat as pass
        if (verifiedFindings.length === 0) {
          this.emitProgress("reviewer", step.id, "All findings refuted — treating as PASS");
          return { status: "completed", review: { ...review, verdict: "pass", findings: [] } };
        }
      }
    }

    // If needs fixes, run Fixer loop (max 3 iterations)
    let currentReview = review;
    let coderChanges = coderHandoff.changes;

    for (let iteration = 1; iteration <= this.maxFixIterations; iteration++) {
      if (currentReview.verdict === "pass") break;

      this.emitProgress("fixer", step.id, `Fix iteration ${iteration}/${this.maxFixIterations}`);

      const fixerHandoff = await this.runFixer(step.id, currentReview, coderChanges, stepContext, iteration);

      if (fixerHandoff.status === "all-fixed") {
        // Re-review
        const reReview = await this.runReviewer(step, {
          ...coderHandoff,
          changes: [...coderChanges, ...fixerHandoff.fixesApplied.map(f => ({ file: f.file, operation: "modify" as const, summary: f.change }))],
          verification: fixerHandoff.verification,
        }, stepContext);
        currentReview = reReview;
        coderChanges = [...coderChanges, ...fixerHandoff.fixesApplied.map(f => ({ file: f.file, operation: "modify" as const, summary: f.change }))];

        if (currentReview.verdict === "pass") {
          this.emitProgress("reviewer", step.id, "Passed after fixes");
          return { status: "completed", review: currentReview, fixIterations: iteration };
        }
      } else if (fixerHandoff.status === "blocked") {
        this.emitProgress("fixer", step.id, "Blocked");
        return { status: "failed", review: currentReview, fixerHandoff };
      }
      // partial -> continue loop
    }

    // Max iterations reached
    this.emitProgress("reviewer", step.id, `Failed after ${this.maxFixIterations} fix iterations`);
    return { status: "failed", review: currentReview, error: "Max fix iterations exceeded" };
  }

  /**
   * Save checkpoint with compacted context for resume capability
   */
  private async saveCheckpointWithCompactedContext(stepId: string): Promise<void> {
    if (!this.enableAutoCompact) return;

    // Compact working context for checkpoint
    const compactResult = compactWorkingContext({
      fileMap: this.context.fileMap,
      keyDecisions: Array.from(this.context.completedSteps.entries()).map(([id, data]) => ({ topic: id, decision: data.summary })),
      errorPatterns: [],
      tokenBudget: this.tokenBudget,
      currentPlan: { step: stepId, criteria: [] },
      originalGoal: this.context.projectInstructions,
      projectInstructions: [this.context.projectInstructions],
    }, COMPACTION_LEVELS.COMPRESS_WORKING, this.preservationRules);

    // Store compacted context for resume
    this.context.stepOutputs.set(`${stepId}-compacted-checkpoint`, {
      compactedContext: compactResult.compacted,
      timestamp: Date.now(),
      tokensSaved: compactResult.tokensSaved,
      level: compactResult.level,
    });

    this.emitProgress("orchestrator", stepId, `Checkpoint saved with compacted context (saved ${compactResult.tokensSaved} tokens)`);
  }

  // Expose checkpoint for external resume
  getCheckpoint(stepId: string): any {
    return this.context.stepOutputs.get(`${stepId}-compacted-checkpoint`);
  }

  // ---------------------------------------------------------------------------
  // AGENT RUNNERS
  // ---------------------------------------------------------------------------

  private async runCoder(step: z.infer<typeof PlanStepSchema>, context: any): Promise<z.infer<typeof CoderHandoffSchema>> {
    const prompt = buildCoderPrompt(step, context);

    // Use the proven tool-use loop. The coder agent runs autonomously and
    // returns a structured handoff. We parse the final handoff JSON from its
    // last message / a dedicated summary tool result.
    // Phase 2 — the step description carries human steering + Helper notes
    // (injected at this step boundary by prepareStepGoal).
    const baseDescription = `${getRoleRuleBlock("coder")}\n\n${step.title}\n\n${step.description}\n\nTarget files: ${step.targetFiles.join(", ")}\n\nAcceptance criteria:\n${step.acceptanceCriteria.map(c => `- ${c}`).join("\n")}`;
    const agentStep: AgentPlanStep = {
      id: step.id,
      description: await this.prepareStepGoal(baseDescription, context),
      dependsOn: step.dependencies,
      parallel: false,
      status: "pending",
    };

    const config: Partial<AgentConfig> = {
      maxIterations: 12,
      temperature: 0.2,
      verifyAfterSteps: true,
    };

    const result = await runAgentForStep(agentStep, context.goal || "", this.toolContext, config);

    // Phase 3 — Record turn for watchdog
    await recordWatchdogTurn(
      this.projectId,
      this.bus.getThreadId(),
      this.context.completedSteps.size + 1, // Use completed steps count as turn number
      [], // toolCalls - not directly accessible here
      [], // toolResults - not directly accessible here
      result.summary || `Coder completed step ${step.id}`,
      result.tokenUsage
    );

    // Construct a handoff from the agent result. The agent loop already verified.
    const handoff: z.infer<typeof CoderHandoffSchema> = {
      stepId: step.id,
      status: result.success ? "completed" : "failed",
      changes: result.filesChanged.map(f => ({ file: f, operation: "modify" as const, summary: "Modified by coder agent" })),
      verification: { typecheck: result.success, lint: result.success, tests: result.success, notes: result.summary },
      blockers: result.success ? [] : [result.summary],
      notesForReviewer: result.summary,
    };

    // Phase 2 — the coder @mentions the reviewer on the bus with its handoff.
    await this.safePost({
      fromRole: "coder",
      toRole: "reviewer",
      kind: "handoff",
      content: `Step ${step.id} ${result.success ? "completed" : "failed"}: ${result.summary.slice(0, 400)}`,
      payload: {
        stepId: step.id,
        status: handoff.status,
        filesChanged: handoff.changes.map((c) => c.file),
        verification: handoff.verification,
      },
    });

    return CoderHandoffSchema.parse(handoff);
  }

  private async runReviewer(step: z.infer<typeof PlanStepSchema>, coderHandoff: z.infer<typeof CoderHandoffSchema>, context: any): Promise<z.infer<typeof ReviewSchema>> {
    const prompt = buildReviewerPrompt(coderHandoff, step, {
      fileMap: this.context.fileMap,
      modifiedFiles: Object.fromEntries(this.context.modifiedFiles),
      projectInstructions: this.context.projectInstructions,
      projectMemory: this.context.projectMemory,
    });

    const response = await withRetry(
      async () =>
        (await this.adapterFor("reviewer")).complete([
          { role: "system", content: sanitizePrompt(`${getRoleRuleBlock("reviewer")}\n\n${prompt}`) },
          { role: "user", content: "Review this work. Output ONLY the review JSON." },
        ], { temperature: 0.1, maxTokens: 2000, jsonMode: true } as any),
      { maxAttempts: 3, baseDelayMs: 1000, backoffMultiplier: 2 },
      { projectId: this.projectId, operation: `orchestrate-reviewer-${step.id}` }
    );

    const review = ReviewSchema.parse(JSON.parse(this.extractJson(response.content)));

    // Phase 3 — Record turn for watchdog
    await recordWatchdogTurn(
      this.projectId,
      this.bus.getThreadId(),
      this.context.completedSteps.size + 1,
      [],
      [],
      `Reviewer: ${review.verdict} — ${review.findings.length} finding(s)`,
      { prompt: response.usage?.promptTokens || 0, completion: response.usage?.completionTokens || 0, total: response.usage?.totalTokens || 0 }
    );

    // Phase 2 — the reviewer posts STRUCTURED findings (file/line/severity/
    // suggestion) onto the bus, not a boolean verdict.
    await this.safePost({
      fromRole: "reviewer",
      toRole: "fixer",
      kind: "review",
      content: `Review of step ${step.id}: verdict ${review.verdict} — ${review.findings.length} finding(s)`,
      payload: {
        stepId: step.id,
        verdict: review.verdict,
        findings: review.findings.map((f) => ({
          file: f.file,
          line: f.line,
          severity: f.severity,
          message: f.message,
          suggestion: f.suggestion,
        })),
        verification: review.verification,
      },
    });

    return review;
  }

  private async runFixer(
    stepId: string,
    review: z.infer<typeof ReviewSchema>,
    coderChanges: any[],
    context: any,
    iteration: number
  ): Promise<z.infer<typeof FixerHandoffSchema>> {
    const prompt = buildFixerPrompt(review.findings, coderChanges, {
      fileMap: this.context.fileMap,
      relevantFiles: Object.fromEntries(this.context.modifiedFiles),
      projectInstructions: this.context.projectInstructions,
      projectMemory: this.context.projectMemory,
    }, iteration);

    // The fixer agent runs autonomously via the tool-use loop, then we parse
    // its final handoff JSON from the last tool result / message.
    const agentStep: AgentPlanStep = {
      id: `${stepId}-fix-${iteration}`,
      description: `${getRoleRuleBlock("fixer")}\n\nFix the following review findings for step ${stepId}:\n\n${review.findings.map((f, i) => `${i}. [${f.severity}] ${f.file}:${f.line} — ${f.message}\n   Suggestion: ${f.suggestion}`).join("\n\n")}`,
      dependsOn: [stepId],
      parallel: false,
      status: "pending",
    };

    const config: Partial<AgentConfig> = {
      maxIterations: 8,
      temperature: 0.2,
      verifyAfterSteps: true,
    };

    const result = await runAgentForStep(agentStep, (context as any).goal || "", this.toolContext, config);

    // Phase 3 — Record turn for watchdog
    await recordWatchdogTurn(
      this.projectId,
      this.bus.getThreadId(),
      this.context.completedSteps.size + 1,
      [],
      [],
      `Fixer iteration ${iteration}: ${result.summary}`,
      result.tokenUsage
    );

    const handoff: z.infer<typeof FixerHandoffSchema> = {
      stepId,
      iteration,
      fixesApplied: review.findings.map((f, i) => ({ findingIndex: i, file: f.file, change: "Fixed by fixer agent", verified: result.success })),
      remainingFindings: result.success ? [] : review.findings.map((_, i) => i),
      verification: { typecheck: result.success, lint: result.success, tests: result.success, notes: result.summary },
      status: result.success ? "all-fixed" : (result.filesChanged.length > 0 ? "partial" : "blocked"),
    };

    // Phase 2 — the fixer reports back to the reviewer with the applied patches.
    await this.safePost({
      fromRole: "fixer",
      toRole: "reviewer",
      kind: "handoff",
      content: `Fix pass ${iteration} on step ${stepId}: ${handoff.status} — ${result.summary.slice(0, 300)}`,
      payload: { stepId, iteration, status: handoff.status, fixesApplied: handoff.fixesApplied, remainingFindings: handoff.remainingFindings },
    });

    return FixerHandoffSchema.parse(handoff);
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Phase 2 — per-role adapter (per-agent key assignment): planner/reviewer get
   * the max healthy key, coder/fixer the high tier. Falls back to this.llm (the
   * default adapter) when role routing finds no keys, so an already-running build
   * never dies because the tier lookup came up empty.
   */
  private async adapterFor(role: "planner" | "reviewer" | "coder" | "fixer"): Promise<LLMAdapter> {
    const cached = this.adapters.get(role);
    if (cached) return cached;
    try {
      const adapter = await createCrewRoleAdapter(role);
      this.adapters.set(role, adapter);
      return adapter;
    } catch {
      return this.llm;
    }
  }

  /** Post to the crew bus — never fatal. The build proceeds even if the log is down. */
  private async safePost(input: Omit<Parameters<MessageBus["post"]>[0], "projectId">): Promise<void> {
    try {
      await this.bus.post({ ...input, projectId: this.projectId });
    } catch {
      // bus is optional glue; a post failure must never break a build
    }
  }

  /**
   * Phase 2 — step-boundary injection (interactive steering + Helper consult).
   * Drains human steering (@orchestrator) posted since the last step and injects
   * it into this step's description, then asks the Helper (build history + working
   * context) for style/constraint answers and injects the cited reply. This is the
   * mechanism that lets a human steer the crew at a step boundary and lets agent
   * ask "what style did the user ask for?".
   */
  private async prepareStepGoal(baseDescription: string, context: any): Promise<string> {
    let desc = baseDescription;

    // 1) Interactive steering — honour the most recent human instructions.
    try {
      const steers = await this.bus.drainSteering(this.lastSteeringSeq);
      if (steers.length > 0) {
        for (const s of steers) this.lastSteeringSeq = Math.max(this.lastSteeringSeq, s.seq);
        desc += `\n\n## OPERATOR STEERING (inject at step boundary — honor it)\n${steers
          .map((s) => `- ${s.content}`)
          .join("\n")}`;
      }
    } catch {
      /* steering never breaks a build */
    }

    // 2) Helper consult — the crew's memory answers from cited evidence.
    try {
      const question = "What style and constraints did the user ask for, and has an established pattern already been set in this workspace?";
      const answer = await askHelper(this.projectId, question, {
        context: {
          conversation: await this.bus.getThread({ includeLive: false }),
          workingContext: {
            goal: context?.goal ?? "",
            recentActivity: [...this.context.completedSteps.entries()]
              .slice(-5)
              .map(([id, r]) => `${id}: ${(r as any)?.description ?? ""}`)
              .join(" | "),
            fileMap: [...this.context.modifiedFiles.entries()]
              .slice(-12)
              .map(([path, f]) => ({ path, purpose: (f as any)?.purpose ?? (f as any)?.type ?? "" })),
          },
        },
      });
      if (answer.hits.length > 0) {
        await this.safePost({
          fromRole: "helper",
          toRole: "coder",
          kind: "helper",
          content: answer.answer,
          payload: { question, citations: answer.hits.map((h) => h.doc.id) },
        });
        desc += `\n\n## HELPER NOTES (from build history — honor cited sources)\n${answer.answer}`;
      }
    } catch {
      /* helper never breaks a build */
    }

    return desc;
  }

  private gatherStepContext(step: z.infer<typeof PlanStepSchema>, plan: z.infer<typeof PlanSchema>) {
    // Get file contents for target files and dependencies
    const relevantFiles: Record<string, string> = {};

    for (const file of step.targetFiles) {
      const content = this.context.modifiedFiles.get(file) || "";
      if (content) relevantFiles[file] = content;
    }

    // Also include files from completed dependency steps
    for (const depId of step.dependencies) {
      const depOutput = this.context.stepOutputs.get(depId);
      if (depOutput && typeof depOutput === "object" && "changes" in depOutput) {
        for (const change of (depOutput as any).changes) {
          const content = this.context.modifiedFiles.get(change.file);
          if (content) relevantFiles[change.file] = content;
        }
      }
    }

    return {
      fileMap: this.context.fileMap,
      relevantFiles,
      goal: plan.goal,
      projectInstructions: this.context.projectInstructions,
      projectMemory: this.context.projectMemory,
      completedSteps: Array.from(this.context.completedSteps.entries()).map(([id, data]) => ({ id, summary: data.summary })),
    };
  }

  private async applyCoderChanges(handoff: z.infer<typeof CoderHandoffSchema>): Promise<void> {
    for (const change of handoff.changes) {
      // Phase D 4.5: the reviewer must judge REAL code, not a label. Read the
      // actual file bytes from the workspace; fall back to the placeholder only
      // when the file is gone (deleted) or unreadable (e.g. binary).
      let contentForReview = `[Modified by ${handoff.stepId}: ${change.summary}]`;
      try {
        const real = await readWorkspaceFileText(change.file, this.workspaceId);
        if (real) contentForReview = real;
      } catch {
        // unreadable — keep the placeholder
      }
      this.context.modifiedFiles.set(change.file, contentForReview);

      // Update project map for changed file (incremental update)
      try {
        await updateProjectMapForFile(this.projectId, change.file, this.workspaceId);

        // Analyze impact of this change
        const impact = await analyzeImpact(this.projectId, change.file, this.workspaceId);
        if (impact.riskLevel === "high") {
          this.emitProgress("orchestrator", handoff.stepId, `HIGH IMPACT change to ${change.file}: affects ${impact.directDependents.length} files, ${impact.affectedRoutes.length} routes`);
        }
      } catch (err) {
        // Non-critical, continue
      }
    }

    // Save updated project map
    await saveProjectMap(this.projectId);

    // Update Build Map with changes from this step
    await this.updateBuildMap(handoff.stepId, handoff);
  }

  /**
   * Update the Visual Build Map after a build step completes
   */
  private async updateBuildMap(stepId: string, handoff: z.infer<typeof CoderHandoffSchema>): Promise<void> {
    if (!this.buildMapAgent) return;

    try {
      const buildStepContext: BuildStepContext = {
        projectId: this.projectId,
        stepId,
        stepName: stepId,
        goal: this.context.projectInstructions || "",
        filesChanged: handoff.changes.map(c => c.file),
        diffSummary: handoff.notesForReviewer,
        timestamp: new Date().toISOString(),
      };

      const result = await this.buildMapAgent.onBuildStepComplete(buildStepContext);

      this.emitProgress("orchestrator", stepId, `Build Map updated: ${result.updates.nodes.length} nodes, ${result.updates.edges.length} edges, ${result.analysis.suggestions.length} suggestions`);
    } catch (err) {
      // Non-critical - don't fail the build if Build Map update fails
      this.emitProgress("orchestrator", stepId, `Build Map update failed (non-critical): ${err}`);
    }
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const toolCall: ToolCall = { name: name as any, arguments: args };
    const result: ToolResult = await executeTool(toolCall, this.toolContext);
    if (!result.success) {
      return `Tool ${name} failed: ${result.error}`;
    }
    return typeof result.result === "string" ? result.result : JSON.stringify(result.result);
  }

  private extractJson(text: string): string {
    // Extract JSON from markdown code blocks or plain text
    const match = text.match(/```(?:json)?\n([\s\S]*?)\n```/);
    if (match) return match[1].trim();
    // Try to find JSON object
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return text.slice(start, end + 1);
    return text.trim();
  }

  private emitProgress(phase: OrchestratorEvent["phase"], stepId: string, message: string): void {
    const event: OrchestratorEvent = { phase, stepId, message, timestamp: new Date().toISOString() };
    this.events.push(event);
    if (this.onProgress) this.onProgress(event);
    void logBuildEvent(this.projectId, "orchestrator", message, { data: { phase, stepId } }).catch(() => {});
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export async function runMultiAgentBuild(params: {
  goal: string;
  projectId: string;
  workspaceId?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  model?: string;
  toolContext: ToolExecutionContext;
  onProgress?: ProgressCallback;
}): Promise<OrchestratorResult> {
  const orchestrator = await BuildOrchestrator.create(params);
  return orchestrator.orchestrate(params.goal);
}
