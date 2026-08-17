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
import { adapterFactory, createBestAdapter } from "./adapter-factory";
import { buildInfinityPrompt, sanitizePrompt } from "./infinity-prompt";
import type { LLMAdapter } from "./llm-adapter";
import { executeTool, formatToolResults, type ToolCall, type ToolExecutionContext, type ToolResult, TOOL_DEFINITIONS } from "./build-tools";
import { runAgentForStep, type PlanStep as AgentPlanStep, type AgentConfig } from "./build-agent";
import { buildPlannerPrompt } from "./agent-prompts/planner";
import { buildCoderPrompt } from "./agent-prompts/coder";
import { buildReviewerPrompt } from "./agent-prompts/reviewer";
import { buildFixerPrompt } from "./agent-prompts/fixer";
import { getWorkingContext, serializeContext, setProjectGoal, refreshFileMap, recordStep } from "./build-context";
import { buildProjectContextForBuild } from "./build-project-context";
import { logBuildEvent } from "./build-telemetry";
import { withRetry } from "./build-edge-cases";

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
  private context: BuildContext;
  private projectId: string;
  private workspaceId: string;
  private apiBaseUrl: string;
  private apiKey: string;
  private maxFixIterations = 3;
  private toolContext: ToolExecutionContext;
  private onProgress?: ProgressCallback;
  private events: OrchestratorEvent[] = [];

  private constructor(params: {
    projectId: string;
    workspaceId?: string;
    apiBaseUrl?: string;
    apiKey?: string;
    model?: string;
    toolContext: ToolExecutionContext;
    onProgress?: ProgressCallback;
  }) {
    this.projectId = params.projectId;
    this.workspaceId = params.workspaceId || params.projectId;
    this.apiBaseUrl = params.apiBaseUrl || "";
    this.apiKey = params.apiKey || "";
    this.onProgress = params.onProgress;
    this.toolContext = params.toolContext;
    // llm will be initialized via init()
    this.context = createEmptyContext();
  }

  static async create(params: {
    projectId: string;
    workspaceId?: string;
    apiBaseUrl?: string;
    apiKey?: string;
    model?: string;
    toolContext: ToolExecutionContext;
    onProgress?: ProgressCallback;
  }): Promise<BuildOrchestrator> {
    const orch = new BuildOrchestrator(params);
    orch.llm = params.model
      ? await adapterFactory.createAdapter({ adapterType: "auto", modelHint: params.model })
      : await createBestAdapter();
    return orch;
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  async orchestrate(goal: string): Promise<OrchestratorResult> {
    this.emitProgress("planner", "start", `Planning: ${goal}`);

    // 1. Load project context
    await this.loadContext(goal);

    // 2. PLANNER — create execution plan
    const plan = await this.runPlanner(goal);
    this.emitProgress("planner", "done", `Plan created: ${plan.steps.length} steps`);

    // 3. Execute steps in dependency order with parallel groups
    const results = await this.executePlan(plan);

    // 4. Final summary
    const success = Array.from(results.values()).every(r => {
      if (typeof r === "object" && r && "status" in r) {
        return (r as any).status === "completed" || (r as any).status === "all-fixed";
      }
      return true;
    });

    this.emitProgress("orchestrator", "done", success ? "All steps completed successfully" : "Some steps failed");
    return { success, plan, results, events: this.events };
  }

  // ---------------------------------------------------------------------------
  // CONTEXT LOADING
  // ---------------------------------------------------------------------------

  private async loadContext(goal: string): Promise<void> {
    setProjectGoal(this.projectId, goal);
    await refreshFileMap(this.projectId, this.workspaceId);

    this.context.fileMap = serializeContext(this.projectId);
    try {
      const projectCtx = await buildProjectContextForBuild(this.projectId, goal, {
        includeActivity: true,
        includeFiles: true,
        activityLimit: 20,
        fileLimit: 50,
      });
      // projectCtx is a combined string; store as instructions context
      this.context.projectInstructions = projectCtx || "";
    } catch {
      // Project context is optional; continue with fileMap only
    }
    this.context.gitStatus = await this.callTool("git_diff", {}) as string;
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
      () => this.llm.complete([
        { role: "system", content: sanitizePrompt(prompt) },
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

    for (const group of parallelGroups) {
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
        } else {
          results.set(step.id, { status: "failed", error: result.reason });
          this.emitProgress("coder", step.id, `Failed: ${result.reason}`);
        }
      });
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
    this.emitProgress("coder", step.id, `Starting: ${step.title}`);

    // Gather context for this step
    const stepContext = this.gatherStepContext(step, plan);

    // Run Coder (delegates to proven tool-use loop)
    const coderHandoff = await this.runCoder(step, stepContext);
    if (coderHandoff.status === "failed" || coderHandoff.status === "blocked") {
      return coderHandoff;
    }

    // Update context with Coder's changes
    this.applyCoderChanges(coderHandoff);

    // Run Reviewer
    const review = await this.runReviewer(step, coderHandoff, stepContext);

    // If pass, we're done
    if (review.verdict === "pass") {
      this.emitProgress("reviewer", step.id, "Passed");
      return { status: "completed", review };
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

  // ---------------------------------------------------------------------------
  // AGENT RUNNERS
  // ---------------------------------------------------------------------------

  private async runCoder(step: z.infer<typeof PlanStepSchema>, context: any): Promise<z.infer<typeof CoderHandoffSchema>> {
    const prompt = buildCoderPrompt(step, context);

    // Use the proven tool-use loop. The coder agent runs autonomously and
    // returns a structured handoff. We parse the final handoff JSON from its
    // last message / a dedicated summary tool result.
    const agentStep: AgentPlanStep = {
      id: step.id,
      description: `${step.title}\n\n${step.description}\n\nTarget files: ${step.targetFiles.join(", ")}\n\nAcceptance criteria:\n${step.acceptanceCriteria.map(c => `- ${c}`).join("\n")}`,
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

    // Construct a handoff from the agent result. The agent loop already verified.
    const handoff: z.infer<typeof CoderHandoffSchema> = {
      stepId: step.id,
      status: result.success ? "completed" : "failed",
      changes: result.filesChanged.map(f => ({ file: f, operation: "modify" as const, summary: "Modified by coder agent" })),
      verification: { typecheck: result.success, lint: result.success, tests: result.success, notes: result.summary },
      blockers: result.success ? [] : [result.summary],
      notesForReviewer: result.summary,
    };
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
      () => this.llm.complete([
        { role: "system", content: sanitizePrompt(prompt) },
        { role: "user", content: "Review this work. Output ONLY the review JSON." },
      ], { temperature: 0.1, maxTokens: 2000, jsonMode: true } as any),
      { maxAttempts: 3, baseDelayMs: 1000, backoffMultiplier: 2 },
      { projectId: this.projectId, operation: `orchestrate-reviewer-${step.id}` }
    );

    const review = ReviewSchema.parse(JSON.parse(this.extractJson(response.content)));
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
      description: `Fix the following review findings for step ${stepId}:\n\n${review.findings.map((f, i) => `${i}. [${f.severity}] ${f.file}:${f.line} — ${f.message}\n   Suggestion: ${f.suggestion}`).join("\n\n")}`,
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

    const handoff: z.infer<typeof FixerHandoffSchema> = {
      stepId,
      iteration,
      fixesApplied: review.findings.map((f, i) => ({ findingIndex: i, file: f.file, change: "Fixed by fixer agent", verified: result.success })),
      remainingFindings: result.success ? [] : review.findings.map((_, i) => i),
      verification: { typecheck: result.success, lint: result.success, tests: result.success, notes: result.summary },
      status: result.success ? "all-fixed" : (result.filesChanged.length > 0 ? "partial" : "blocked"),
    };
    return FixerHandoffSchema.parse(handoff);
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

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

  private applyCoderChanges(handoff: z.infer<typeof CoderHandoffSchema>): void {
    for (const change of handoff.changes) {
      // Track that the file was modified. Real content is read from workspace.
      this.context.modifiedFiles.set(change.file, `[Modified by ${handoff.stepId}: ${change.summary}]`);
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
