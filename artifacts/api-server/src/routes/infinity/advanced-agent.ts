/**
 * Advanced Agent API Routes — Phase 30: Advanced Agent Capabilities
 * Orchestrates planning, debugging, git, and subagents
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, requireScope, AuthenticatedRequest } from "../../middleware/auth-middleware";
import { planningAgent } from "../../lib/planning-agent";
import { DebugToolsManager } from "../../lib/debug-tools";
import { GitTools } from "../../lib/git-tools";
import { spawnSubagent, getSubagent, SUBAGENTS } from "../../lib/subagents";
import { getLLMAdapter } from "../../lib/llm-adapter";
import { getProjectDesignSystem } from "../../lib/design-canvas";
import { db } from "../../db";
import { projectInstructions, projectMemory } from "../../db/schema";

const router = Router();

// ============================================================================
// Schemas
// ============================================================================

const PlanCreateSchema = z.object({
  goal: z.string().min(1).max(2000),
  projectId: z.string().uuid(),
  context: z.object({
    files: z.array(z.string()).optional(),
    currentPlan: z.string().optional(),
    constraints: z.array(z.string()).optional(),
  }).optional(),
});

const PlanExecuteSchema = z.object({
  planId: z.string().uuid(),
  stepId: z.string().optional(), // if not provided, executes next pending step
  projectId: z.string().uuid(),
});

const DebugSessionSchema = z.object({
  projectId: z.string().uuid(),
  type: z.enum(["node", "browser", "test"]),
  config: z.object({
    program: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    cwd: z.string().optional(),
    testCommand: z.string().optional(),
    testFramework: z.enum(["jest", "vitest", "playwright", "cypress", "mocha"]).optional(),
  }).optional(),
});

const BreakpointSchema = z.object({
  sessionId: z.string(),
  file: z.string(),
  line: z.number().int().positive(),
  condition: z.string().optional(),
  hitCondition: z.string().optional(),
  logMessage: z.string().optional(),
});

const DebugActionSchema = z.object({
  sessionId: z.string(),
  action: z.enum(["continue", "pause", "stepOver", "stepInto", "stepOut", "restart", "stop"]),
});

const GitCommandSchema = z.object({
  projectId: z.string().uuid(),
  command: z.enum([
    "log", "show", "diff", "blame", "status", "branches", "remotes",
    "commit", "stage", "unstage", "push", "pull", "fetch",
    "stash", "stashList", "stashPop", "tags", "createTag",
    "conflicts", "stats", "worktrees", "createWorktree"
  ]),
  args: z.record(z.unknown()).optional(),
});

const SubagentSpawnSchema = z.object({
  projectId: z.string().uuid(),
  subagentId: z.string(),
  prompt: z.string().min(1).max(10000),
  config: z.object({
    modelTier: z.enum(["lite", "high", "max"]).optional(),
    reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().optional(),
  }).optional(),
});

const SubagentParallelSchema = z.object({
  projectId: z.string().uuid(),
  subagentId: z.string(),
  prompts: z.array(z.string().min(1).max(10000)).min(1).max(10),
  config: z.object({
    modelTier: z.enum(["lite", "high", "max"]).optional(),
    reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().optional(),
  }).optional(),
});

const PerspectiveVerifySchema = z.object({
  projectId: z.string().uuid(),
  claim: z.string().min(1).max(2000),
  context: z.string().max(10000),
  lenses: z.array(z.enum(["correctness", "security", "performance", "reproducibility", "maintainability"])).optional(),
});

// ============================================================================
// Helper: Get project root
// ============================================================================

function getProjectRoot(projectId: string): string {
  return `/workspaces/projects/${projectId}`;
}

// ============================================================================
// PLANNING ENDPOINTS
// ============================================================================

// Create a new plan
router.post("/plan", requireAuth, requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { goal, projectId, context } = PlanCreateSchema.parse(req.body);

    // Verify project access
    // TODO: Add project ownership check

    const projectRoot = getProjectRoot(projectId);
    const designSystem = await getProjectDesignSystem(projectId);

    // Build context from project
    const projectContext = await buildProjectContext(projectId, context);

    const plan = await planningAgent.createPlan(goal, {
      projectRoot,
      projectId,
      designSystem,
      existingFiles: projectContext.files,
      constraints: projectContext.constraints,
    });

    // Store plan in database (using project_memory for persistence)
    await db.insert(projectMemory).values({
      projectId,
      key: `plan:${plan.id}`,
      value: JSON.stringify(plan),
      category: "plan",
      pinned: true,
    });

    res.json({ success: true, data: plan, summary: `Created plan with ${plan.steps.length} steps` });
  } catch (error) {
    console.error("[advanced-agent] Plan creation failed:", error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Plan creation failed" });
  }
});

// Get plan by ID
router.get("/plan/:planId", requireAuth, requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { planId } = req.params;
    const { projectId } = req.query;

    if (!projectId) {
      return res.status(400).json({ success: false, error: "projectId required" });
    }

    const result = await db
      .select()
      .from(projectMemory)
      .where(z.tuple([projectMemory.projectId, projectMemory.key]).equals([projectId, `plan:${planId}`]));

    if (result.length === 0) {
      return res.status(404).json({ success: false, error: "Plan not found" });
    }

    const plan = JSON.parse(result[0].value);
    res.json({ success: true, data: plan });
  } catch (error) {
    console.error("[advanced-agent] Get plan failed:", error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Get plan failed" });
  }
});

// Execute plan step
router.post("/plan/execute", requireAuth, requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { planId, stepId, projectId } = PlanExecuteSchema.parse(req.body);

    const projectRoot = getProjectRoot(projectId);

    const result = await planningAgent.executeStep(planId, stepId, {
      projectRoot,
      projectId,
    });

    // Update stored plan
    const plan = await planningAgent.getPlan(planId);
    if (plan) {
      await db.insert(projectMemory).values({
        projectId,
        key: `plan:${planId}`,
        value: JSON.stringify(plan),
        category: "plan",
        pinned: true,
      }).onConflictDoUpdate({
        target: [projectMemory.projectId, projectMemory.key],
        set: { value: JSON.stringify(plan), updatedAt: new Date() },
      });
    }

    res.json({ success: true, data: result, summary: result.success ? "Step executed" : "Step failed" });
  } catch (error) {
    console.error("[advanced-agent] Plan execution failed:", error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Plan execution failed" });
  }
});

// Get all plans for project
router.get("/plans", requireAuth, requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId } = req.query;

    if (!projectId) {
      return res.status(400).json({ success: false, error: "projectId required" });
    }

    const results = await db
      .select()
      .from(projectMemory)
      .where(z.tuple([projectMemory.projectId, projectMemory.category]).equals([projectId as string, "plan"]));

    const plans = results.map(r => JSON.parse(r.value));
    res.json({ success: true, data: plans, summary: `${plans.length} plans` });
  } catch (error) {
    console.error("[advanced-agent] List plans failed:", error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "List plans failed" });
  }
});

// ============================================================================
// DEBUGGING ENDPOINTS
// ============================================================================

// Create debug session
router.post("/debug/session", requireAuth, requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId, type, config } = DebugSessionSchema.parse(req.body);
    const projectRoot = getProjectRoot(projectId);

    const debugManager = new DebugToolsManager({ projectRoot, projectId });
    const session = await debugManager.createDebugSession(type, config);

    res.json({ success: true, data: session, summary: `Debug session created: ${session.id}` });
  } catch (error) {
    console.error("[advanced-agent] Debug session creation failed:", error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Debug session creation failed" });
  }
});

// Get debug session
router.get("/debug/session/:sessionId", requireAuth, requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { projectId } = req.query;

    if (!projectId) {
      return res.status(400).json({ success: false, error: "projectId required" });
    }

    const projectRoot = getProjectRoot(projectId as string);
    const debugManager = new DebugToolsManager({ projectRoot, projectId: projectId as string });
    const session = debugManager.getSession(sessionId);

    if (!session) {
      return res.status(404).json({ success: false, error: "Session not found" });
    }

    res.json({ success: true, data: session });
  } catch (error) {
    console.error("[advanced-agent] Get debug session failed:", error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Get debug session failed" });
  }
});

// Set breakpoint
router.post("/debug/breakpoint", requireAuth, requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId, file, line, condition, hitCondition, logMessage } = BreakpointSchema.parse(req.body);
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ success: false, error: "projectId required" });
    }

    const projectRoot = getProjectRoot(projectId);
    const debugManager = new DebugToolsManager({ projectRoot, projectId });
    const breakpoint = await debugManager.setBreakpoint(sessionId, { file, line, condition, hitCondition, logMessage });

    res.json({ success: true, data: breakpoint, summary: `Breakpoint set at ${file}:${line}` });
  } catch (error) {
    console.error("[advanced-agent] Set breakpoint failed:", error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Set breakpoint failed" });
  }
});

// Remove breakpoint
router.delete("/debug/breakpoint/:breakpointId", requireAuth, requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { breakpointId } = req.params;
    const { projectId, sessionId } = req.query;

    if (!projectId || !sessionId) {
      return res.status(400).json({ success: false, error: "projectId and sessionId required" });
    }

    const projectRoot = getProjectRoot(projectId as string);
    const debugManager = new DebugToolsManager({ projectRoot, projectId: projectId as string });
    await debugManager.removeBreakpoint(sessionId as string, breakpointId);

    res.json({ success: true, summary: "Breakpoint removed" });
  } catch (error) {
    console.error("[advanced-agent] Remove breakpoint failed:", error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Remove breakpoint failed" });
  }
});

// Debug action (continue, step, etc.)
router.post("/debug/action", requireAuth, requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId, action } = DebugActionSchema.parse(req.body);
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ success: false, error: "projectId required" });
    }

    const projectRoot = getProjectRoot(projectId);
    const debugManager = new DebugToolsManager({ projectRoot, projectId });
    const result = await debugManager.sendDebugAction(sessionId, action);

    res.json({ success: true, data: result, summary: `Debug action: ${action}` });
  } catch (error) {
    console.error("[advanced-agent] Debug action failed:", error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Debug action failed" });
  }
});

// Get variables
router.get("/debug/variables/:sessionId", requireAuth, requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { projectId, frameId } = req.query;

    if (!projectId) {
      return res.status(400).json({ success: false, error: "projectId required" });
    }

    const projectRoot = getProjectRoot(projectId as string);
    const debugManager = new DebugToolsManager({ projectRoot, projectId: projectId as string });
    const variables = await debugManager.getVariables(sessionId, frameId as string);

    res.json({ success: true, data: variables, summary: `${variables.length} variables` });
  } catch (error) {
    console.error("[advanced-agent] Get variables failed:", error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Get variables failed" });
  }
});

// Run tests
router.post("/debug/test", requireAuth, requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId, testCommand, testFramework, paths, coverage } = req.body;

    if (!projectId) {
      return res.status(400).json({ success: false, error: "projectId required" });
    }

    const projectRoot = getProjectRoot(projectId);
    const debugManager = new DebugToolsManager({ projectRoot, projectId });
    const result = await debugManager.runTests({
      testCommand: testCommand || "npm test",
      testFramework: testFramework || "jest",
      paths: paths || [],
      coverage: coverage || false,
    });

    res.json({ success: true, data: result, summary: result.passed ? "Tests passed" : "Tests failed" });
  } catch (error) {
    console.error("[advanced-agent] Run tests failed:", error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Run tests failed" });
  }
});

// Auto-fix test failures
router.post("/debug/auto-fix", requireAuth, requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId, testRunId, maxAttempts } = req.body;

    if (!projectId || !testRunId) {
      return res.status(400).json({ success: false, error: "projectId and testRunId required" });
    }

    const projectRoot = getProjectRoot(projectId);
    const debugManager = new DebugToolsManager({ projectRoot, projectId });
    const result = await debugManager.autoFixTestFailures(testRunId, maxAttempts || 3);

    res.json({ success: true, data: result, summary: result.fixed ? "Tests fixed" : "Could not fix all tests" });
  } catch (error) {
    console.error("[advanced-agent] Auto-fix failed:", error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Auto-fix failed" });
  }
});

// List debug sessions
router.get("/debug/sessions", requireAuth, requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId } = req.query;

    if (!projectId) {
      return res.status(400).json({ success: false, error: "projectId required" });
    }

    const projectRoot = getProjectRoot(projectId as string);
    const debugManager = new DebugToolsManager({ projectRoot, projectId: projectId as string });
    const sessions = debugManager.listSessions();

    res.json({ success: true, data: sessions, summary: `${sessions.length} sessions` });
  } catch (error) {
    console.error("[advanced-agent] List sessions failed:", error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "List sessions failed" });
  }
});

// ============================================================================
// GIT ENDPOINTS
// ============================================================================

// Execute git command
router.post("/git", requireAuth, requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId, command, args } = GitCommandSchema.parse(req.body);
    const projectRoot = getProjectRoot(projectId);

    const gitTools = new GitTools({ projectRoot, projectId });
    let result: any;

    switch (command) {
      case "log":
        result = gitTools.getLog(args);
        break;
      case "show":
        result = gitTools.getCommit(args?.hash as string);
        break;
      case "diff":
        result = gitTools.getDiff(args);
        break;
      case "blame":
        result = gitTools.getBlame(args?.file as string, { startLine: args?.startLine as number, endLine: args?.endLine as number });
        break;
      case "status":
        result = gitTools.getStatus();
        break;
      case "branches":
        result = gitTools.getBranches(args);
        break;
      case "remotes":
        result = gitTools.getRemotes();
        break;
      case "commit":
        result = gitTools.commit(args?.message as string, args);
        break;
      case "stage":
        gitTools.stage(args?.paths as string[]);
        result = { success: true };
        break;
      case "unstage":
        gitTools.unstage(args?.paths as string[]);
        result = { success: true };
        break;
      case "push":
        result = gitTools.push(args);
        break;
      case "pull":
        result = gitTools.pull(args);
        break;
      case "fetch":
        result = gitTools.fetch(args);
        break;
      case "stash":
        result = gitTools.stash(args?.message as string);
        break;
      case "stashList":
        result = gitTools.stashList();
        break;
      case "stashPop":
        gitTools.stashPop(args?.index as number);
        result = { success: true };
        break;
      case "tags":
        result = gitTools.getTags();
        break;
      case "createTag":
        gitTools.createTag(args?.name as string, args?.message as string, args?.commit as string);
        result = { success: true };
        break;
      case "conflicts":
        result = gitTools.getConflicts();
        break;
      case "stats":
        result = gitTools.getStats(args);
        break;
      case "worktrees":
        result = gitTools.listWorktrees();
        break;
      case "createWorktree":
        gitTools.createWorktree(args?.path as string, args?.branch as string);
        result = { success: true };
        break;
      default:
        return res.status(400).json({ success: false, error: `Unknown command: ${command}` });
    }

    res.json({ success: true, data: result, summary: `Git ${command} completed` });
  } catch (error) {
    console.error("[advanced-agent] Git command failed:", error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Git command failed" });
  }
});

// ============================================================================
// SUBAGENT ENDPOINTS
// ============================================================================

// List available subagents
router.get("/subagents", requireAuth, requireScope("build:read"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const agents = Object.entries(SUBAGENTS).map(([id, def]) => ({
      id,
      name: def.name,
      description: def.description,
      defaultConfig: def.defaultConfig,
    }));
    res.json({ success: true, data: agents, summary: `${agents.length} subagents available` });
  } catch (error) {
    console.error("[advanced-agent] List subagents failed:", error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "List subagents failed" });
  }
});

// Spawn single subagent
router.post("/subagent/spawn", requireAuth, requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId, subagentId, prompt, config } = SubagentSpawnSchema.parse(req.body);

    const llm = getLLMAdapter();
    const result = await spawnSubagent(subagentId, prompt, llm, config);

    res.json({ success: true, data: result, summary: `Subagent ${subagentId} completed` });
  } catch (error) {
    console.error("[advanced-agent] Subagent spawn failed:", error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Subagent spawn failed" });
  }
});

// Spawn multiple subagents in parallel
router.post("/subagent/spawn-parallel", requireAuth, requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId, subagentId, prompts, config } = SubagentParallelSchema.parse(req.body);

    const llm = getLLMAdapter();
    const results = await spawnSubagentsParallel(subagentId, prompts, llm, config);

    const successful = results.filter(r => r !== null).length;
    res.json({ success: true, data: results, summary: `${successful}/${prompts.length} subagents succeeded` });
  } catch (error) {
    console.error("[advanced-agent] Parallel subagent spawn failed:", error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Parallel subagent spawn failed" });
  }
});

// Perspective-diverse verification
router.post("/subagent/verify", requireAuth, requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId, claim, context, lenses } = PerspectiveVerifySchema.parse(req.body);

    const llm = getLLMAdapter();
    const { perspectiveDiverseVerify } = await import("../../lib/subagents");
    const results = await perspectiveDiverseVerify(claim, context, llm, lenses);

    const verified = Object.entries(results).filter(([, v]) => v?.verdict === "APPROVE").length;
    const total = Object.keys(results).length;

    res.json({ success: true, data: results, summary: `${verified}/${total} lenses approved` });
  } catch (error) {
    console.error("[advanced-agent] Perspective verify failed:", error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Perspective verify failed" });
  }
});

// ============================================================================
// AGENT ORCHESTRATION ENDPOINT
// ============================================================================

// Run advanced agent with full capabilities (planning + debugging + git + subagents)
const AdvancedAgentRunSchema = z.object({
  projectId: z.string().uuid(),
  goal: z.string().min(1).max(5000),
  mode: z.enum(["plan", "debug", "implement", "review", "auto"]).default("auto"),
  options: z.object({
    enablePlanning: z.boolean().default(true),
    enableDebugging: z.boolean().default(true),
    enableGit: z.boolean().default(true),
    enableSubagents: z.boolean().default(true),
    maxSteps: z.number().default(20),
    requireApproval: z.boolean().default(true),
  }).optional(),
});

router.post("/run", requireAuth, requireScope("build:write"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId, goal, mode, options } = AdvancedAgentRunSchema.parse(req.body);
    const projectRoot = getProjectRoot(projectId);
    const designSystem = await getProjectDesignSystem(projectId);
    const projectContext = await buildProjectContext(projectId, {});

    const llm = getLLMAdapter();

    // Step 1: Create plan if planning enabled
    let plan = null;
    if (options?.enablePlanning !== false && mode !== "debug") {
      plan = await planningAgent.createPlan(goal, {
        projectRoot,
        projectId,
        designSystem,
        existingFiles: projectContext.files,
        constraints: projectContext.constraints,
      });

      // Store plan
      await db.insert(projectMemory).values({
        projectId,
        key: `plan:${plan.id}`,
        value: JSON.stringify(plan),
        category: "plan",
        pinned: true,
      });

      if (options?.requireApproval && mode === "plan") {
        return res.json({
          success: true,
          data: { plan, requiresApproval: true },
          summary: `Plan created with ${plan.steps.length} steps. Awaiting approval.`,
        });
      }
    }

    // Step 2: Execute based on mode
    const debugManager = new DebugToolsManager({ projectRoot, projectId });
    const gitTools = new GitTools({ projectRoot, projectId });

    let result: any = { steps: [], subagentResults: [] };

    if (plan && (mode === "implement" || mode === "auto")) {
      // Execute plan steps
      for (const step of plan.steps) {
        if (step.status === "completed") continue;

        // Execute step using appropriate tool/subagent
        const stepResult = await executePlanStep(step, {
          projectRoot,
          projectId,
          debugManager,
          gitTools,
          llm,
          designSystem,
          enableSubagents: options?.enableSubagents !== false,
        });

        result.steps.push({ stepId: step.id, ...stepResult });

        if (!stepResult.success && step.risk === "critical") {
          break; // Stop on critical failure
        }
      }
    }

    // Step 3: Run debugging if enabled and in debug mode
    if (options?.enableDebugging && (mode === "debug" || mode === "auto")) {
      const testResult = await debugManager.runTests({
        testCommand: "npm test",
        testFramework: "jest",
      });
      result.testRun = testResult;

      if (!testResult.passed && options?.enableSubagents) {
        // Try auto-fix
        const fixResult = await debugManager.autoFixTestFailures(testResult.id, 3);
        result.autoFix = fixResult;
      }
    }

    // Step 4: Git status if enabled
    if (options?.enableGit) {
      const status = gitTools.getStatus();
      const diff = gitTools.getDiff({ statOnly: true });
      result.git = { status, diff: diff.summary };
    }

    res.json({ success: true, data: result, summary: `Advanced agent run complete (${result.steps.length} steps)` });
  } catch (error) {
    console.error("[advanced-agent] Advanced agent run failed:", error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Advanced agent run failed" });
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function buildProjectContext(projectId: string, context?: any) {
  // Get project instructions
  const instructions = await db
    .select()
    .from(projectInstructions)
    .where(z.tuple([projectInstructions.projectId, projectInstructions.enabled]).equals([projectId, true]));

  // Get project memory
  const memories = await db
    .select()
    .from(projectMemory)
    .where(z.tuple([projectMemory.projectId, projectMemory.pinned]).equals([projectId, true]));

  const constraints = [
    ...instructions.map(i => i.instruction),
    ...(context?.constraints || []),
  ];

  const files = memories
    .filter(m => m.key.startsWith("file:"))
    .map(m => m.key.replace("file:", ""));

  return { files, constraints };
}

async function executePlanStep(step: any, context: {
  projectRoot: string;
  projectId: string;
  debugManager: DebugToolsManager;
  gitTools: GitTools;
  llm: any;
  designSystem: any;
  enableSubagents: boolean;
}) {
  // Determine which tool/subagent to use based on step.toolHint
  const toolHint = step.toolHint || "files";

  try {
    switch (toolHint) {
      case "debug":
        // Use debugger subagent
        if (context.enableSubagents) {
          const result = await spawnSubagent("debugger", step.description, context.llm);
          return { success: true, output: result, subagent: "debugger" };
        }
        break;

      case "test":
        // Use test-writer subagent or run tests
        if (context.enableSubagents) {
          const result = await spawnSubagent("test-writer", step.description, context.llm);
          return { success: true, output: result, subagent: "test-writer" };
        }
        const testResult = await context.debugManager.runTests({});
        return { success: testResult.passed, output: testResult };

      case "git":
        // Use git tools
        // Parse step description for git command
        return { success: true, output: "Git operation placeholder" };

      case "docs":
        // Use documenter subagent
        if (context.enableSubagents) {
          const result = await spawnSubagent("documenter", step.description, context.llm);
          return { success: true, output: result, subagent: "documenter" };
        }
        break;

      default:
        // Default: use fixer or general implementation
        if (context.enableSubagents) {
          const result = await spawnSubagent("fixer", step.description, context.llm);
          return { success: true, output: result, subagent: "fixer" };
        }
    }

    return { success: false, error: "No executor available for step" };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Step execution failed" };
  }
}

export { router as advancedAgentRouter };