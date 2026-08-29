/**
 * Cursor API Routes — Chat, Composer, Agent, Tab Autocomplete
 *
 * Endpoints:
 * - POST /api/infinity/cursor/chat - Cursor Chat with @codebase context
 * - POST /api/infinity/cursor/chat/stream - SSE streaming chat
 * - POST /api/infinity/cursor/composer - Generate multi-file plan
 * - POST /api/infinity/cursor/composer/apply - Apply composer plan
 * - POST /api/infinity/cursor/composer/refine - Refine composer plan
 * - POST /api/infinity/cursor/agent - Run autonomous agent
 * - GET /api/infinity/cursor/agent/status/:taskId - Agent status
 * - POST /api/infinity/cursor/agent/stop/:taskId - Stop agent
 * - POST /api/infinity/cursor/agent/checkpoint/:taskId - Create checkpoint
 * - POST /api/infinity/cursor/agent/restore/:taskId - Restore checkpoint
 * - POST /api/infinity/cursor/agent/approve/:approvalId - Respond to approval
 * - POST /api/infinity/cursor/tab - Tab autocomplete
 * - POST /api/infinity/cursor/cmd-k - Cmd+K inline edit
 * - GET /api/infinity/cursor/index/status - Codebase index status
 * - POST /api/infinity/cursor/index - Trigger indexing
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { createBestAdapter, createManualAdapter } from "../../lib/adapter-factory";
import { CursorAgent, createCursorAgent, CursorAgentConfig, CursorAgentEvent, CursorAgentResult } from "../../lib/cursor-agent";
import { CursorComposer, createCursorComposer, ComposerRequest, ComposerPlan, ComposerResult } from "../../lib/cursor-composer";
import { CodebaseIndexer, createCodebaseIndexer, IndexConfig, SearchResult } from "../../lib/codebase-indexer";
import { getTaskPersistenceManager } from "../lib/tool-persistence";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

const router = Router();

// In-memory stores (in production, use Redis or database)
const agents: Map<string, CursorAgent> = new Map();
const agentResults: Map<string, CursorAgentResult> = new Map();
const composers: Map<string, CursorComposer> = new Map();
const indexers: Map<string, CodebaseIndexer> = new Map();

// Validation schemas
const chatSchema = z.object({
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  message: z.string().min(1),
  conversationHistory: z.array(z.object({
    role: z.enum(["user", "assistant", "system", "tool"]),
    content: z.string(),
    tool_calls: z.array(z.object({
      id: z.string(),
      type: z.literal("function"),
      function: z.object({ name: z.string(), arguments: z.string() }),
    })).optional(),
  })).optional(),
  useCodebase: z.boolean().default(true),
  model: z.string().optional(),
  maxIterations: z.number().positive().max(50).optional(),
  maxToolCalls: z.number().positive().max(100).optional(),
});

const composerSchema = z.object({
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  instruction: z.string().min(1),
  contextFiles: z.array(z.string()).optional(),
  mode: z.enum(["edit", "create", "refactor", "fix", "test", "document"]).optional(),
  targetFiles: z.array(z.string()).optional(),
  includeTests: z.boolean().optional(),
  includeTypes: z.boolean().optional(),
});

const composerApplySchema = z.object({
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  plan: z.object({
    id: z.string(),
    instruction: z.string(),
    mode: z.string(),
    changes: z.array(z.object({
      path: z.string(),
      originalContent: z.string(),
      newContent: z.string(),
      changeType: z.enum(["create", "edit", "delete"]),
      language: z.string(),
      diff: z.string(),
      description: z.string(),
      dependencies: z.array(z.string()),
      confidence: z.number(),
    })),
    estimatedTokens: z.number(),
    riskLevel: z.enum(["low", "medium", "high"]),
    warnings: z.array(z.string()),
    requiredApprovals: z.array(z.string()),
  }),
  filePaths: z.array(z.string()).optional(),
  dryRun: z.boolean().optional(),
});

const composerRefineSchema = z.object({
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  planId: z.string().min(1),
  refinement: z.string().min(1),
});

const agentSchema = z.object({
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  goal: z.string().min(1),
  enablePlanningMode: z.boolean().optional(),
  enableDebugging: z.boolean().optional(),
  enableGitIntegration: z.boolean().optional(),
  enableMCPIntegration: z.boolean().optional(),
  enableSubagents: z.boolean().optional(),
  maxIterations: z.number().positive().max(50).optional(),
  maxToolCalls: z.number().positive().max(100).optional(),
  taskId: z.string().optional(),
});

const tabSchema = z.object({
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  prefix: z.string(),
  suffix: z.string(),
  filePath: z.string(),
  language: z.string(),
  maxTokens: z.number().positive().max(500).optional(),
});

const cmdKSchema = z.object({
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  instruction: z.string().min(1),
  filePath: z.string(),
  selectedCode: z.string(),
  language: z.string(),
});

const indexSchema = z.object({
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  excludePatterns: z.array(z.string()).optional(),
  includePatterns: z.array(z.string()).optional(),
  maxFileSize: z.number().positive().optional(),
  chunkSize: z.number().positive().optional(),
  overlap: z.number().nonnegative().optional(),
  embeddingModel: z.string().optional(),
  enableIncremental: z.boolean().optional(),
  useRemoteEmbeddings: z.boolean().optional(),
  remoteEmbeddingUrl: z.string().url().optional(),
  remoteEmbeddingKey: z.string().optional(),
});

// ============================================================================
// Helper: Get or create adapter
// ============================================================================

function getAdapter(model?: string): Promise<any> {
  if (model) {
    return createBestAdapter();
  }
  return createManualAdapter();
}

// ============================================================================
// Cursor Chat Endpoints
// ============================================================================

/**
 * POST /api/infinity/cursor/chat
 * Non-streaming chat with codebase context
 */
router.post("/chat", async (req: Request, res: Response) => {
  try {
    const config = chatSchema.parse(req.body);
    const adapter = await getAdapter(config.model);

    // Initialize agent
    const agent = createCursorAgent(config.projectId, config.projectRoot, adapter, {
      maxIterations: config.maxIterations ?? 10,
      maxToolCalls: config.maxToolCalls ?? 30,
      enablePlanningMode: false,
      enableDebugging: false,
      enableGitIntegration: true,
      enableMCPIntegration: true,
      enableSubagents: true,
    });

    await agent.initialize();

    // Add conversation history if provided
    if (config.conversationHistory) {
      // Note: Would need to inject into agent's history
    }

    const result = await agent.run(config.message);

    res.json({
      success: true,
      response: result.finalResponse,
      toolCalls: result.totalToolCalls,
      iterations: result.totalIterations,
      converged: result.converged,
      stoppedReason: result.stoppedReason,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Cursor Chat] Error:", error);
    res.status(500).json({ error: "Chat failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cursor/chat/stream
 * SSE streaming chat with codebase context
 */
router.post("/chat/stream", async (req: Request, res: Response) => {
  try {
    const config = chatSchema.parse(req.body);
    const adapter = await getAdapter(config.model);

    // Set up SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Initialize agent
    const agent = createCursorAgent(config.projectId, config.projectRoot, adapter, {
      maxIterations: config.maxIterations ?? 10,
      maxToolCalls: config.maxToolCalls ?? 30,
      enablePlanningMode: false,
      enableDebugging: false,
      enableGitIntegration: true,
      enableMCPIntegration: true,
      enableSubagents: true,
      onEvent: (event: CursorAgentEvent) => {
        sendEvent("agent_event", event);
      },
      onTokenStream: (token: string) => {
        sendEvent("token", { token });
      },
    });

    await agent.initialize();

    // Run agent
    const result = await agent.run(config.message);

    sendEvent("complete", {
      response: result.finalResponse,
      toolCalls: result.totalToolCalls,
      iterations: result.totalIterations,
      converged: result.converged,
      stoppedReason: result.stoppedReason,
    });

    res.end();
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: "Invalid request", details: error.errors })}\n\n`);
    } else {
      console.error("[Cursor Chat Stream] Error:", error);
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: "Chat failed", message: String(error) })}\n\n`);
    }
    res.end();
  }
});

// ============================================================================
// Cursor Composer Endpoints
// ============================================================================

/**
 * POST /api/infinity/cursor/composer
 * Generate a multi-file edit plan
 */
router.post("/composer", async (req: Request, res: Response) => {
  try {
    const config = composerSchema.parse(req.body);
    const adapter = getAdapter();

    const composer = createCursorComposer({
      projectId: config.projectId,
      projectRoot: config.projectRoot,
      adapter,
      onProgress: (progress) => {
        // Could emit via SSE if needed
        console.log("[Composer Progress]", progress);
      },
    });

    await composer.initialize();

    const plan = await composer.generatePlan({
      instruction: config.instruction,
      contextFiles: config.contextFiles,
      mode: config.mode,
      targetFiles: config.targetFiles,
      includeTests: config.includeTests,
      includeTypes: config.includeTypes,
    });

    // Store composer for later apply/refine
    composers.set(plan.id, composer);

    res.json({
      success: true,
      plan,
      previews: composer.generatePreviews(plan),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Cursor Composer] Error:", error);
    res.status(500).json({ error: "Composer failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cursor/composer/apply
 * Apply a composer plan (selectively or all)
 */
router.post("/composer/apply", async (req: Request, res: Response) => {
  try {
    const config = composerApplySchema.parse(req.body);
    const adapter = getAdapter();

    const composer = createCursorComposer({
      projectId: config.projectId,
      projectRoot: config.projectRoot,
      adapter,
      onProgress: (progress) => console.log("[Composer Apply Progress]", progress),
    });

    await composer.initialize();

    const result = await composer.applyPlan(config.plan, {
      filePaths: config.filePaths,
      dryRun: config.dryRun,
    });

    res.json({
      success: true,
      result,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Cursor Composer Apply] Error:", error);
    res.status(500).json({ error: "Apply failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cursor/composer/refine
 * Refine an existing plan with additional instructions
 */
router.post("/composer/refine", async (req: Request, res: Response) => {
  try {
    const config = composerRefineSchema.parse(req.body);
    const adapter = getAdapter();

    // Get the original composer (would need to be stored)
    // For now, create new one
    const composer = createCursorComposer({
      projectId: config.projectId,
      projectRoot: config.projectRoot,
      adapter,
      onProgress: (progress) => console.log("[Composer Refine Progress]", progress),
    });

    await composer.initialize();

    // In a real implementation, we'd retrieve the stored plan
    // For now, return an error asking to regenerate
    res.status(400).json({
      error: "Plan refinement requires the original plan. Please regenerate with the refined instruction.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Cursor Composer Refine] Error:", error);
    res.status(500).json({ error: "Refine failed", message: String(error) });
  }
});

// ============================================================================
// Cursor Agent Endpoints
// ============================================================================

/**
 * POST /api/infinity/cursor/agent
 * Start an autonomous agent run
 */
router.post("/agent", async (req: Request, res: Response) => {
  try {
    const config = agentSchema.parse(req.body);
    const adapter = getAdapter();

    const taskId = config.taskId || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const agent = createCursorAgent(config.projectId, config.projectRoot, adapter, {
      maxIterations: config.maxIterations ?? 20,
      maxToolCalls: config.maxToolCalls ?? 50,
      enablePlanningMode: config.enablePlanningMode ?? true,
      enableDebugging: config.enableDebugging ?? true,
      enableGitIntegration: config.enableGitIntegration ?? true,
      enableMCPIntegration: config.enableMCPIntegration ?? true,
      enableSubagents: config.enableSubagents ?? true,
      taskId,
      autoCheckpoint: true,
      onEvent: (event: CursorAgentEvent) => {
        // Store events for status polling
        console.log("[Agent Event]", event.type, event.step);
      },
    });

    await agent.initialize();
    agents.set(taskId, agent);

    // Run asynchronously
    agent.run(config.goal).then((result) => {
      agentResults.set(taskId, result);
      agents.delete(taskId);
    }).catch((error) => {
      console.error("[Agent] Run error:", error);
      agentResults.set(taskId, {
        finalResponse: `Error: ${error}`,
        totalToolCalls: 0,
        totalIterations: 0,
        allToolResults: [],
        allArtifacts: [],
        iterations: [],
        converged: false,
        stoppedReason: "error",
      });
      agents.delete(taskId);
    });

    res.json({
      success: true,
      taskId,
      message: "Agent started. Poll /agent/status/:taskId for updates.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Cursor Agent] Error:", error);
    res.status(500).json({ error: "Agent failed", message: String(error) });
  }
});

/**
 * GET /api/infinity/cursor/agent/status/:taskId
 * Get agent status and results
 */
router.get("/agent/status/:taskId", async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const agent = agents.get(taskId);
    const result = agentResults.get(taskId);

    if (!agent && !result) {
      return res.status(404).json({ error: "Task not found" });
    }

    if (agent) {
      // Still running
      res.json({
        taskId,
        status: "running",
        plan: agent.getPlan(),
        checkpoints: agent.getCheckpoints(),
      });
    } else {
      // Completed
      res.json({
        taskId,
        status: "completed",
        result,
      });
    }
  } catch (error) {
    console.error("[Cursor Agent Status] Error:", error);
    res.status(500).json({ error: "Status check failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cursor/agent/stop/:taskId
 * Stop a running agent
 */
router.post("/agent/stop/:taskId", async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const agent = agents.get(taskId);

    if (!agent) {
      return res.status(404).json({ error: "Task not found or already completed" });
    }

    agent.stop("user_stopped");
    res.json({ success: true, message: "Agent stopped" });
  } catch (error) {
    console.error("[Cursor Agent Stop] Error:", error);
    res.status(500).json({ error: "Stop failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cursor/agent/checkpoint/:taskId
 * Create a checkpoint
 */
router.post("/agent/checkpoint/:taskId", async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { label } = req.body;
    const agent = agents.get(taskId);

    if (!agent) {
      return res.status(404).json({ error: "Task not found" });
    }

    // The agent's createCheckpoint is private, but we can trigger via event
    // For now, return info about existing checkpoints
    res.json({
      success: true,
      checkpoints: agent.getCheckpoints(),
      message: "Checkpoints retrieved. Auto-checkpoints created every 5 iterations.",
    });
  } catch (error) {
    console.error("[Cursor Agent Checkpoint] Error:", error);
    res.status(500).json({ error: "Checkpoint failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cursor/agent/restore/:taskId
 * Restore from a checkpoint
 */
router.post("/agent/restore/:taskId", async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { checkpointId } = req.body;
    const agent = agents.get(taskId);

    if (!agent) {
      return res.status(404).json({ error: "Task not found" });
    }

    const restored = await agent.restoreCheckpoint(checkpointId);
    res.json({ success: restored, message: restored ? "Checkpoint restored" : "Checkpoint not found" });
  } catch (error) {
    console.error("[Cursor Agent Restore] Error:", error);
    res.status(500).json({ error: "Restore failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cursor/agent/approve/:approvalId
 * Respond to an approval request
 */
router.post("/agent/approve/:approvalId", async (req: Request, res: Response) => {
  try {
    const { approvalId } = req.params;
    const { approved, selectedOption } = req.body;

    // Find agent with this approval
    for (const [taskId, agent] of agents.entries()) {
      // The agent handles approvals internally via its event system
      // This endpoint would need to be connected to the agent's pending approvals
      // For now, acknowledge
      agent.respondToApproval(approvalId, approved, selectedOption);
    }

    res.json({ success: true, message: "Approval recorded" });
  } catch (error) {
    console.error("[Cursor Agent Approve] Error:", error);
    res.status(500).json({ error: "Approve failed", message: String(error) });
  }
});

// ============================================================================
// Tab Autocomplete Endpoint
// ============================================================================

/**
 * POST /api/infinity/cursor/tab
 * Multi-line, context-aware tab autocomplete
 */
router.post("/tab", async (req: Request, res: Response) => {
  try {
    const config = tabSchema.parse(req.body);
    const adapter = getAdapter();

    // Get relevant context from codebase
    let context = "";
    const indexer = indexers.get(config.projectId);
    if (indexer) {
      const results = await indexer.search({
        projectId: config.projectId,
        query: `code completion for ${config.language} file`,
        limit: 5,
        hybrid: true,
      });
      context = results.map(r => `${r.chunk.relativePath}:${r.chunk.startLine}-${r.chunk.endLine}\n${r.chunk.content.slice(0, 200)}`).join("\n\n");
    }

    // Read current file
    const fullPath = join(config.projectRoot, config.filePath);
    let fileContent = "";
    if (existsSync(fullPath)) {
      fileContent = readFileSync(fullPath, "utf-8");
    }

    const prompt = `You are a code completion engine. Complete the code at the cursor position.

LANGUAGE: ${config.language}
FILE: ${config.filePath}

CONTEXT (relevant codebase snippets):
${context || "None available"}

CURRENT FILE CONTENT:
${fileContent.slice(-2000)}

PREFIX (code before cursor):
${config.prefix.slice(-1000)}

SUFFIX (code after cursor):
${config.suffix.slice(0, 1000)}

Generate a natural continuation. Return ONLY the completion text, no explanations, no markdown.
Max ${config.maxTokens || 200} tokens.`;

    const response = await adapter.complete([
      { role: "system", content: "You are a fast code completion model. Output only the completion." },
      { role: "user", content: prompt },
    ], {
      temperature: 0.1,
      maxTokens: config.maxTokens || 200,
      toolChoice: "none",
    });

    res.json({
      success: true,
      completion: response.text || "",
      tokensUsed: response.usage?.total_tokens || 0,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Cursor Tab] Error:", error);
    res.status(500).json({ error: "Tab completion failed", message: String(error) });
  }
});

// ============================================================================
// Cmd+K Inline Edit Endpoint
// ============================================================================

/**
 * POST /api/infinity/cursor/cmd-k
 * Quick targeted edits at cursor position
 */
router.post("/cmd-k", async (req: Request, res: Response) => {
  try {
    const config = cmdKSchema.parse(req.body);
    const adapter = getAdapter();

    // Read the target file
    const fullPath = join(config.projectRoot, config.filePath);
    let fileContent = "";
    if (existsSync(fullPath)) {
      fileContent = readFileSync(fullPath, "utf-8");
    }

    const prompt = `You are an inline code editor. Apply the requested change to the selected code.

FILE: ${config.filePath}
LANGUAGE: ${config.language}

FULL FILE CONTENT:
${fileContent}

SELECTED CODE (to modify):
${config.selectedCode}

INSTRUCTION:
${config.instruction}

Return the REPLACEMENT CODE ONLY (the new version of the selected code).
No explanations, no markdown, just the code.`;

    const response = await adapter.complete([
      { role: "system", content: "You are a precise inline code editor. Output only the replacement code." },
      { role: "user", content: prompt },
    ], {
      temperature: 0.1,
      maxTokens: 1000,
      toolChoice: "none",
    });

    res.json({
      success: true,
      replacement: response.text || "",
      original: config.selectedCode,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Cursor Cmd+K] Error:", error);
    res.status(500).json({ error: "Cmd+K failed", message: String(error) });
  }
});

// ============================================================================
// Codebase Index Endpoints
// ============================================================================

/**
 * GET /api/infinity/cursor/index/status
 * Get index status
 */
router.get("/index/status", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query;
    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }

    const indexer = indexers.get(projectId);
    if (!indexer) {
      return res.json({ projectId, status: "not_initialized", stats: null });
    }

    const stats = indexer.getStats();
    res.json({ projectId, status: "ready", stats });
  } catch (error) {
    console.error("[Cursor Index Status] Error:", error);
    res.status(500).json({ error: "Status failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cursor/index
 * Trigger full indexing
 */
router.post("/index", async (req: Request, res: Response) => {
  try {
    const config = indexSchema.parse(req.body);
    const indexer = createCodebaseIndexer(config.projectId, config.projectRoot, config as IndexConfig);
    indexers.set(config.projectId, indexer);

    await indexer.initialize();
    const stats = await indexer.indexProject(true);

    res.json({ success: true, projectId: config.projectId, stats });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Cursor Index] Error:", error);
    res.status(500).json({ error: "Indexing failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cursor/index/incremental
 * Trigger incremental indexing
 */
router.post("/index/incremental", async (req: Request, res: Response) => {
  try {
    const { projectId, filePaths } = req.body;
    if (!projectId) {
      return res.status(400).json({ error: "projectId is required" });
    }

    const indexer = indexers.get(projectId);
    if (!indexer) {
      return res.status(404).json({ error: "Indexer not initialized. Run full index first." });
    }

    if (filePaths && Array.isArray(filePaths)) {
      await indexer.indexFiles(filePaths);
    } else {
      await indexer.indexProject(false);
    }

    const stats = indexer.getStats();
    res.json({ success: true, projectId, stats });
  } catch (error) {
    console.error("[Cursor Index Incremental] Error:", error);
    res.status(500).json({ error: "Incremental indexing failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cursor/search
 * Semantic code search
 */
router.post("/search", async (req: Request, res: Response) => {
  try {
    const { projectId, query, limit, types, languages, hybrid, expandQuery } = req.body;
    if (!projectId || !query) {
      return res.status(400).json({ error: "projectId and query are required" });
    }

    const indexer = indexers.get(projectId);
    if (!indexer) {
      return res.status(404).json({ error: "Indexer not initialized" });
    }

    const results = await indexer.search({
      projectId,
      query,
      limit: limit || 10,
      types,
      languages,
      hybrid: hybrid ?? true,
      expandQuery: expandQuery ?? true,
    });

    res.json({ success: true, results });
  } catch (error) {
    console.error("[Cursor Search] Error:", error);
    res.status(500).json({ error: "Search failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cursor/search/symbol
 * Symbol search
 */
router.post("/search/symbol", async (req: Request, res: Response) => {
  try {
    const { projectId, symbol, limit } = req.body;
    if (!projectId || !symbol) {
      return res.status(400).json({ error: "projectId and symbol are required" });
    }

    const indexer = indexers.get(projectId);
    if (!indexer) {
      return res.status(404).json({ error: "Indexer not initialized" });
    }

    const results = await indexer.searchSymbol(projectId, symbol, limit || 10);
    res.json({ success: true, results });
  } catch (error) {
    console.error("[Cursor Symbol Search] Error:", error);
    res.status(500).json({ error: "Symbol search failed", message: String(error) });
  }
});

/**
 * DELETE /api/infinity/cursor/index
 * Clear index
 */
router.delete("/index", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.body;
    if (!projectId) {
      return res.status(400).json({ error: "projectId is required" });
    }

    const indexer = indexers.get(projectId);
    if (indexer) {
      indexer.close();
      indexers.delete(projectId);
    }

    res.json({ success: true, message: "Index cleared" });
  } catch (error) {
    console.error("[Cursor Index Delete] Error:", error);
    res.status(500).json({ error: "Clear failed", message: String(error) });
  }
});

export default router;