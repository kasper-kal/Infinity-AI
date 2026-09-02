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
import {
  PerformanceCache,
  createPerformanceCache,
  ConnectionPoolManager,
  getConnectionPoolManager,
  measureLatency,
  DebouncedExecutor,
  createDebouncedExecutor,
  MemoryPressureMonitor,
  getMemoryPressureMonitor
} from "../../lib/performance";
import { join } from "path";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";

// ============================================================================
// Zero-Config Setup: Auto-detection and Auto-indexing
// ============================================================================

interface ProjectType {
  name: string;
  language: string;
  framework?: string;
  packageManager?: string;
  buildTool?: string;
  hasConfig: boolean;
  configFiles: string[];
}

function detectProjectType(projectRoot: string): ProjectType {
  const files = readdirSync(projectRoot, { withFileTypes: true });
  const fileNames = files.map(f => f.name);

  // Check for package.json (Node.js)
  if (fileNames.includes("package.json")) {
    const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf-8"));
    let framework: string | undefined;
    if (pkg.dependencies?.next || pkg.devDependencies?.next) framework = "Next.js";
    else if (pkg.dependencies?.react || pkg.devDependencies?.react) framework = "React";
    else if (pkg.dependencies?.vue || pkg.devDependencies?.vue) framework = "Vue";
    else if (pkg.dependencies?.svelte || pkg.devDependencies?.svelte) framework = "Svelte";
    else if (pkg.dependencies?.["@angular/core"] || pkg.devDependencies?.["@angular/core"]) framework = "Angular";
    else if (pkg.dependencies?.express || pkg.devDependencies?.express) framework = "Express";
    else if (pkg.dependencies?.fastify || pkg.devDependencies?.fastify) framework = "Fastify";
    else if (pkg.dependencies?.nestjs || pkg.devDependencies?.["@nestjs/core"]) framework = "NestJS";

    let packageManager = "npm";
    if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) packageManager = "pnpm";
    else if (existsSync(join(projectRoot, "yarn.lock"))) packageManager = "yarn";
    else if (existsSync(join(projectRoot, "bun.lockb"))) packageManager = "bun";

    let buildTool: string | undefined;
    if (pkg.scripts?.build?.includes("vite") || pkg.devDependencies?.vite) buildTool = "Vite";
    else if (pkg.scripts?.build?.includes("webpack") || pkg.devDependencies?.webpack) buildTool = "Webpack";
    else if (pkg.scripts?.build?.includes("turbo") || pkg.devDependencies?.turbo) buildTool = "Turbopack";
    else if (pkg.scripts?.build?.includes("esbuild") || pkg.devDependencies?.esbuild) buildTool = "esbuild";

    return {
      name: pkg.name || "Node.js Project",
      language: "typescript",
      framework,
      packageManager,
      buildTool,
      hasConfig: true,
      configFiles: ["package.json"],
    };
  }

  // Check for Cargo.toml (Rust)
  if (fileNames.includes("Cargo.toml")) {
    return {
      name: "Rust Project",
      language: "rust",
      packageManager: "cargo",
      buildTool: "cargo",
      hasConfig: true,
      configFiles: ["Cargo.toml"],
    };
  }

  // Check for pyproject.toml or requirements.txt (Python)
  if (fileNames.includes("pyproject.toml") || fileNames.includes("requirements.txt")) {
    let packageManager = "pip";
    if (existsSync(join(projectRoot, "poetry.lock"))) packageManager = "poetry";
    else if (existsSync(join(projectRoot, "uv.lock"))) packageManager = "uv";

    let framework: string | undefined;
    if (fileNames.includes("manage.py")) framework = "Django";
    else if (fileNames.includes("fastapi") || fileNames.includes("main.py")) framework = "FastAPI";
    else if (fileNames.includes("flask") || fileNames.includes("app.py")) framework = "Flask";

    return {
      name: "Python Project",
      language: "python",
      framework,
      packageManager,
      hasConfig: true,
      configFiles: fileNames.includes("pyproject.toml") ? ["pyproject.toml"] : ["requirements.txt"],
    };
  }

  // Check for go.mod (Go)
  if (fileNames.includes("go.mod")) {
    return {
      name: "Go Project",
      language: "go",
      packageManager: "go modules",
      buildTool: "go build",
      hasConfig: true,
      configFiles: ["go.mod"],
    };
  }

  // Check for Cargo.toml (Rust)
  if (fileNames.includes("Cargo.toml")) {
    return {
      name: "Rust Project",
      language: "rust",
      packageManager: "cargo",
      buildTool: "cargo",
      hasConfig: true,
      configFiles: ["Cargo.toml"],
    };
  }

  // Check for composer.json (PHP)
  if (fileNames.includes("composer.json")) {
    return {
      name: "PHP Project",
      language: "php",
      packageManager: "composer",
      buildTool: "composer",
      hasConfig: true,
      configFiles: ["composer.json"],
    };
  }

  // Check for pom.xml or build.gradle (Java)
  if (fileNames.includes("pom.xml")) {
    return {
      name: "Java Project",
      language: "java",
      packageManager: "maven",
      buildTool: "maven",
      hasConfig: true,
      configFiles: ["pom.xml"],
    };
  }
  if (fileNames.includes("build.gradle") || fileNames.includes("build.gradle.kts")) {
    return {
      name: "Java/Kotlin Project",
      language: "java",
      packageManager: "gradle",
      buildTool: "gradle",
      hasConfig: true,
      configFiles: ["build.gradle", "build.gradle.kts"],
    };
  }

  // Check for .csproj (C#)
  const csprojFiles = fileNames.filter(f => f.endsWith(".csproj"));
  if (csprojFiles.length > 0) {
    return {
      name: "C# Project",
      language: "csharp",
      packageManager: "nuget",
      buildTool: "dotnet",
      hasConfig: true,
      configFiles: csprojFiles,
    };
  }

  // Default fallback
  return {
    name: "Unknown Project",
    language: "unknown",
    hasConfig: false,
    configFiles: [],
  };
}

function getDefaultIndexConfig(projectType: ProjectType): Partial<IndexConfig> {
  const baseConfig: Partial<IndexConfig> = {
    useEmbeddings: true,
    includePatterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.rs", "**/*.go", "**/*.java", "**/*.cs", "**/*.php", "**/*.rb", "**/*.cpp", "**/*.cc", "**/*.c", "**/*.h", "**/*.hpp"],
    excludePatterns: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**", "**/target/**", "**/__pycache__/**", "**/.venv/**", "**/venv/**", "**/vendor/**", "**/bin/**", "**/obj/**", "**/out/**"],
    maxFileSize: 500000,
  };

  // Language-specific patterns
  switch (projectType.language) {
    case "typescript":
    case "javascript":
      baseConfig.includePatterns = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.json", "**/*.css", "**/*.scss"];
      break;
    case "python":
      baseConfig.includePatterns = ["**/*.py", "**/*.pyi", "**/*.toml", "**/*.txt"];
      break;
    case "rust":
      baseConfig.includePatterns = ["**/*.rs", "**/*.toml"];
      break;
    case "go":
      baseConfig.includePatterns = ["**/*.go", "**/*.mod", "**/*.sum"];
      break;
    case "java":
      baseConfig.includePatterns = ["**/*.java", "**/*.kt", "**/*.xml", "**/*.gradle"];
      break;
    case "csharp":
      baseConfig.includePatterns = ["**/*.cs", "**/*.csproj", "**/*.sln"];
      break;
    case "php":
      baseConfig.includePatterns = ["**/*.php", "**/*.json"];
      break;
    case "ruby":
      baseConfig.includePatterns = ["**/*.rb", "**/*.gemspec", "**/Gemfile*"];
      break;
  }

  return baseConfig;
}

const router = Router();

// In-memory stores (in production, use Redis or database)
const agents: Map<string, CursorAgent> = new Map();
const agentResults: Map<string, CursorAgentResult> = new Map();
const composers: Map<string, CursorComposer> = new Map();
const indexers: Map<string, CodebaseIndexer> = new Map();

// Performance infrastructure
const tabCache = createPerformanceCache<string>({
  maxSize: 1000,
  ttlMs: 300000, // 5 minutes
  evictionPolicy: "lru",
  onEvict: (key, value) => console.log(`[Tab Cache] Evicted: ${key}`),
});

const connectionPool = getConnectionPoolManager();
const memoryMonitor = getMemoryPressureMonitor();

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
// Tab Autocomplete Endpoint (Optimized for <100ms latency)
// ============================================================================

/**
 * POST /api/infinity/cursor/tab
 * Multi-line, context-aware tab autocomplete with multi-tier caching
 * Target: <100ms p99 latency
 */
router.post("/tab", async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  try {
    const config = tabSchema.parse(req.body);

    // Generate cache key from prefix + suffix + language + filePath
    const cacheKey = `tab:${config.projectId}:${config.language}:${config.filePath}:${config.prefix.slice(-200)}:${config.suffix.slice(0, 200)}`;

    // Tier 1: Check in-memory cache (sub-ms)
    const cached = tabCache.get(cacheKey);
    if (cached) {
      const latency = Date.now() - startTime;
      res.setHeader("X-Cache", "HIT");
      res.setHeader("X-Latency-Ms", String(latency));
      res.setHeader("X-Request-Id", requestId);
      return res.json({
        success: true,
        completion: cached,
        tokensUsed: 0,
        cached: true,
        latencyMs: latency,
        source: "cache",
      });
    }

    // Tier 2: Check if we can use a local pattern-based completion (for common patterns)
    // This would be a lightweight local model or rule-based completion
    const localCompletion = await tryLocalCompletion(config);
    if (localCompletion) {
      const latency = Date.now() - startTime;
      // Store in cache for next time
      tabCache.set(cacheKey, localCompletion);
      res.setHeader("X-Cache", "MISS");
      res.setHeader("X-Latency-Ms", String(latency));
      res.setHeader("X-Request-Id", requestId);
      return res.json({
        success: true,
        completion: localCompletion,
        tokensUsed: 0,
        cached: false,
        latencyMs: latency,
        source: "local",
      });
    }

    // Tier 3: Remote LLM with connection pooling and optimized settings
    const adapter = await getAdapter();

    // Get relevant context from codebase (with timeout)
    let context = "";
    const indexer = indexers.get(config.projectId);
    if (indexer) {
      const results = await Promise.race([
        indexer.search({
          projectId: config.projectId,
          query: `code completion for ${config.language} file`,
          limit: 3, // Reduced from 5 for speed
          hybrid: true,
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Index timeout")), 50)),
      ]).catch(() => []);
      context = results.map(r => `${r.chunk.relativePath}:${r.chunk.startLine}-${r.chunk.endLine}\n${r.chunk.content.slice(0, 150)}`).join("\n\n");
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
${fileContent.slice(-1500)}

PREFIX (code before cursor):
${config.prefix.slice(-800)}

SUFFIX (code after cursor):
${config.suffix.slice(0, 800)}

Generate a natural continuation. Return ONLY the completion text, no explanations, no markdown.
Max ${config.maxTokens || 150} tokens.`; // Reduced from 200 for speed

    const response = await measureLatency(async () => {
      return adapter.complete([
        { role: "system", content: "You are a fast code completion model. Output only the completion." },
        { role: "user", content: prompt },
      ], {
        temperature: 0.1,
        maxTokens: config.maxTokens || 150,
        toolChoice: "none",
      });
    });

    const completion = response.result.text || "";
    const latency = Date.now() - startTime;

    // Store in cache for future requests
    if (completion) {
      tabCache.set(cacheKey, completion);
    }

    res.setHeader("X-Cache", "MISS");
    res.setHeader("X-Latency-Ms", String(latency));
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("X-Model-Latency-Ms", String(response.latencyMs));

    // Warn if latency target missed
    if (latency > 100) {
      console.warn(`[Tab] Latency target missed: ${latency}ms (target: <100ms)`);
    }

    res.json({
      success: true,
      completion,
      tokensUsed: response.result.usage?.total_tokens || 0,
      cached: false,
      latencyMs: latency,
      source: "remote",
    });
  } catch (error) {
    const latency = Date.now() - startTime;
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Cursor Tab] Error:", error);
    res.status(500).json({ error: "Tab completion failed", message: String(error), latencyMs: latency });
  }
});

/**
 * Try local pattern-based completion for common coding patterns
 * Returns completion string or null if no pattern matches
 */
async function tryLocalCompletion(config: z.infer<typeof tabSchema>): Promise<string | null> {
  const { prefix, suffix, language } = config;

  // Common patterns by language
  const patterns: Record<string, Array<{ trigger: string; completion: string }>> = {
    typescript: [
      { trigger: "const ", completion: " = () => {\n  \n}" },
      { trigger: "function ", completion: "() {\n  \n}" },
      { trigger: "if (", completion: ") {\n  \n}" },
      { trigger: "for (", completion: ") {\n  \n}" },
      { trigger: "while (", completion: ") {\n  \n}" },
      { trigger: "try {", completion: "\n} catch (error) {\n  \n}" },
      { trigger: "async ", completion: "function() {\n  \n}" },
      { trigger: ".map(", completion: "(item => {\n  \n}))" },
      { trigger: ".filter(", completion: "(item => {\n  \n}))" },
      { trigger: ".reduce(", completion: "((acc, item) => {\n  \n}, initial))" },
      { trigger: "interface ", completion: " {\n  \n}" },
      { trigger: "type ", completion: " = {\n  \n}" },
      { trigger: "export ", completion: "default " },
      { trigger: "import ", completion: " from ''" },
      { trigger: "console.log(", completion: ")" },
      { trigger: "return ", completion: "" },
      { trigger: "await ", completion: "" },
    ],
    javascript: [
      { trigger: "const ", completion: " = () => {\n  \n}" },
      { trigger: "function ", completion: "() {\n  \n}" },
      { trigger: "if (", completion: ") {\n  \n}" },
      { trigger: "for (", completion: ") {\n  \n}" },
      { trigger: "while (", completion: ") {\n  \n}" },
      { trigger: "try {", completion: "\n} catch (error) {\n  \n}" },
      { trigger: "async ", completion: "function() {\n  \n}" },
      { trigger: ".map(", completion: "(item => {\n  \n}))" },
      { trigger: ".filter(", completion: "(item => {\n  \n}))" },
      { trigger: "console.log(", completion: ")" },
    ],
    python: [
      { trigger: "def ", completion: "():\n    \n" },
      { trigger: "class ", completion: ":\n    \n" },
      { trigger: "if ", completion: ":\n    \n" },
      { trigger: "for ", completion: " in :\n    \n" },
      { trigger: "while ", completion: ":\n    \n" },
      { trigger: "try:", completion: "\n    \nexcept:\n    \n" },
      { trigger: "async def ", completion: "():\n    \n" },
      { trigger: "with ", completion: " as :\n    \n" },
      { trigger: "print(", completion: ")" },
      { trigger: "return ", completion: "" },
      { trigger: "await ", completion: "" },
      { trigger: "import ", completion: "" },
      { trigger: "from ", completion: " import " },
    ],
    rust: [
      { trigger: "fn ", completion: "() {\n    \n}" },
      { trigger: "let ", completion: " = ;" },
      { trigger: "if ", completion: " {\n    \n}" },
      { trigger: "for ", completion: " in  {\n    \n}" },
      { trigger: "while ", completion: " {\n    \n}" },
      { trigger: "match ", completion: " {\n    \n}" },
      { trigger: "impl ", completion: " {\n    \n}" },
      { trigger: "struct ", completion: " {\n    \n}" },
      { trigger: "enum ", completion: " {\n    \n}" },
      { trigger: "println!(", completion: ")" },
      { trigger: "return ", completion: "" },
    ],
    go: [
      { trigger: "func ", completion: "() {\n    \n}" },
      { trigger: "if ", completion: " {\n    \n}" },
      { trigger: "for ", completion: " {\n    \n}" },
      { trigger: "switch ", completion: " {\n    \n}" },
      { trigger: "type ", completion: " struct {\n    \n}" },
      { trigger: "var ", completion: " = " },
      { trigger: "fmt.Println(", completion: ")" },
      { trigger: "return ", completion: "" },
    ],
  };

  const langPatterns = patterns[language.toLowerCase()] || [];
  const recentPrefix = prefix.slice(-50);

  for (const pattern of langPatterns) {
    if (recentPrefix.endsWith(pattern.trigger)) {
      // Check if suffix doesn't already have the completion
      if (!suffix.startsWith(pattern.completion.trimStart().split("\n")[0])) {
        return pattern.completion;
      }
    }
  }

  return null;
}

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

// ============================================================================
// Performance Monitoring Endpoints
// ============================================================================

/**
 * GET /api/infinity/cursor/performance/tab
 * Get tab autocomplete performance statistics
 */
router.get("/performance/tab", async (req: Request, res: Response) => {
  try {
    const stats = tabCache.getStats();
    const memoryStats = memoryMonitor.getStats();
    const poolStats = connectionPool.getStats();

    res.json({
      success: true,
      cache: stats,
      memory: memoryStats,
      connectionPool: poolStats,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("[Performance Tab] Error:", error);
    res.status(500).json({ error: "Performance stats failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cursor/performance/tab/clear
 * Clear tab autocomplete cache
 */
router.post("/performance/tab/clear", async (req: Request, res: Response) => {
  try {
    tabCache.clear();
    res.json({ success: true, message: "Tab cache cleared" });
  } catch (error) {
    console.error("[Performance Tab Clear] Error:", error);
    res.status(500).json({ error: "Clear failed", message: String(error) });
  }
});

/**
 * GET /api/infinity/cursor/performance/memory
 * Get memory pressure statistics
 */
router.get("/performance/memory", async (req: Request, res: Response) => {
  try {
    const stats = memoryMonitor.getStats();
    res.json({ success: true, memory: stats, timestamp: Date.now() });
  } catch (error) {
    console.error("[Performance Memory] Error:", error);
    res.status(500).json({ error: "Memory stats failed", message: String(error) });
  }
});

/**
 * GET /api/infinity/cursor/performance/connection-pool
 * Get connection pool statistics
 */
router.get("/performance/connection-pool", async (req: Request, res: Response) => {
  try {
    const stats = connectionPool.getStats();
    res.json({ success: true, connectionPool: stats, timestamp: Date.now() });
  } catch (error) {
    console.error("[Performance Connection Pool] Error:", error);
    res.status(500).json({ error: "Connection pool stats failed", message: String(error) });
  }
});

// ============================================================================
// Zero-Config Setup Endpoints
// ============================================================================

/**
 * GET /api/infinity/cursor/zero-config/detect
 * Auto-detect project type and configuration
 */
router.get("/zero-config/detect", async (req: Request, res: Response) => {
  try {
    const { projectRoot } = req.query;
    if (!projectRoot || typeof projectRoot !== "string") {
      return res.status(400).json({ error: "projectRoot is required" });
    }

    const projectType = detectProjectType(projectRoot);
    const defaultIndexConfig = getDefaultIndexConfig(projectType);

    res.json({
      success: true,
      projectType,
      recommendedIndexConfig: defaultIndexConfig,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("[Zero-Config Detect] Error:", error);
    res.status(500).json({ error: "Detection failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cursor/zero-config/auto-index
 * Auto-initialize and index project with zero config
 */
router.post("/zero-config/auto-index", async (req: Request, res: Response) => {
  try {
    const { projectId, projectRoot } = req.body;
    if (!projectId || !projectRoot) {
      return res.status(400).json({ error: "projectId and projectRoot are required" });
    }

    // Detect project type
    const projectType = detectProjectType(projectRoot);
    const defaultIndexConfig = getDefaultIndexConfig(projectType);

    // Create indexer with detected config
    const indexer = createCodebaseIndexer(projectId, projectRoot, {
      ...defaultIndexConfig,
      projectId,
      projectRoot,
    } as IndexConfig);

    indexers.set(projectId, indexer);

    // Initialize and index
    await indexer.initialize();
    const stats = await indexer.indexProject(true);

    res.json({
      success: true,
      projectId,
      projectType,
      stats,
      message: "Project auto-indexed successfully",
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("[Zero-Config Auto-Index] Error:", error);
    res.status(500).json({ error: "Auto-index failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/cursor/zero-config/auto-setup
 * Full zero-config setup: detect + index + prepare agent
 */
router.post("/zero-config/auto-setup", async (req: Request, res: Response) => {
  try {
    const { projectId, projectRoot } = req.body;
    if (!projectId || !projectRoot) {
      return res.status(400).json({ error: "projectId and projectRoot are required" });
    }

    // 1. Detect project type
    const projectType = detectProjectType(projectRoot);
    const defaultIndexConfig = getDefaultIndexConfig(projectType);

    // 2. Initialize indexer
    const indexer = createCodebaseIndexer(projectId, projectRoot, {
      ...defaultIndexConfig,
      projectId,
      projectRoot,
    } as IndexConfig);

    indexers.set(projectId, indexer);
    await indexer.initialize();
    const indexStats = await indexer.indexProject(true);

    // 3. Initialize agent with project-aware config
    const agent = createCursorAgent(projectId, projectRoot, {
      maxIterations: 20,
      maxToolCalls: 50,
      useCodebase: true,
      model: "claude-3.5-sonnet",
    });
    agents.set(projectId, agent);

    res.json({
      success: true,
      projectId,
      projectType,
      indexStats,
      agentReady: true,
      message: "Zero-config setup complete - ready for Cursor-level AI coding",
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("[Zero-Config Auto-Setup] Error:", error);
    res.status(500).json({ error: "Auto-setup failed", message: String(error) });
  }
});

export default router;