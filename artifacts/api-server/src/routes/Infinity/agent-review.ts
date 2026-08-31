/**
 * Agent Review API Routes — Automated PR Review with Code Understanding
 *
 * Endpoints:
 * - POST /api/infinity/agent-review/review - Run agent review on PR/diff
 * - GET /api/infinity/agent-review/status/:reviewId - Get review status
 * - GET /api/infinity/agent-review/result/:reviewId - Get review result
 * - POST /api/infinity/agent-review/quick - Quick review (real-time feedback)
 * - POST /api/infinity/agent-review/rules - Configure review rules
 * - GET /api/infinity/agent-review/rules - Get review rules
 * - POST /api/infinity/agent-review/trigger - Configure review triggers
 * - GET /api/infinity/agent-review/history - Get review history
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { runAgentReview, AgentReviewEngine, type AgentReviewConfig, type ReviewResult, DEFAULT_REVIEW_RULES } from "../../lib/agent-review";
import { createBestAdapter } from "../../lib/adapter-factory";
import { createCodebaseIndexer } from "../../lib/codebase-indexer";

const router = Router();

// In-memory stores (in production, use Redis or database)
const reviewEngines: Map<string, AgentReviewEngine> = new Map();
const reviewResults: Map<string, ReviewResult> = new Map();
const reviewConfigs: Map<string, AgentReviewConfig> = new Map();

// Validation schemas
const reviewSchema = z.object({
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  prNumber: z.number().int().positive().optional(),
  prUrl: z.string().url().optional(),
  baseCommit: z.string().optional(),
  headCommit: z.string().optional(),
  diff: z.string().optional(),
  config: z.object({
    dimensions: z.array(z.enum([
      "correctness", "security", "performance", "style",
      "tests", "breaking-changes", "documentation", "dependencies"
    ])).optional(),
    severityThreshold: z.enum(["low", "medium", "high", "critical"]).optional(),
    maxFiles: z.number().positive().max(100).optional(),
    includePatterns: z.array(z.string()).optional(),
    excludePatterns: z.array(z.string()).optional(),
    requireApproval: z.boolean().optional(),
    autoMergeOnApprove: z.boolean().optional(),
    customRules: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      dimension: z.enum([
        "correctness", "security", "performance", "style",
        "tests", "breaking-changes", "documentation", "dependencies"
      ]),
      severity: z.enum(["low", "medium", "high", "critical"]),
      pattern: z.string(),
      message: z.string(),
      fix: z.string().optional(),
      enabled: z.boolean(),
    })).optional(),
    learningEnabled: z.boolean().optional(),
  }).optional(),
  onProgress: z.function().optional(), // Not serializable, handled separately
});

const quickReviewSchema = z.object({
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  filePath: z.string().min(1),
  content: z.string(),
  language: z.string().optional(),
});

const rulesSchema = z.object({
  projectId: z.string().min(1),
  rules: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    dimension: z.enum([
      "correctness", "security", "performance", "style",
      "tests", "breaking-changes", "documentation", "dependencies"
    ]),
    severity: z.enum(["low", "medium", "high", "critical"]),
    pattern: z.string(),
    message: z.string(),
    fix: z.string().optional(),
    enabled: z.boolean(),
  })),
});

const triggerSchema = z.object({
  projectId: z.string().min(1),
  triggers: z.array(z.object({
    type: z.enum(["pr_created", "pr_updated", "push", "schedule", "manual", "webhook"]),
    config: z.object({
      cron: z.string().optional(),
      webhookUrl: z.string().url().optional(),
      webhookSecret: z.string().optional(),
      branches: z.array(z.string()).optional(),
    }).optional(),
    enabled: z.boolean(),
  })),
});

/**
 * POST /api/infinity/agent-review/review
 * Run a full agent review on a PR or diff
 */
router.post("/review", async (req: Request, res: Response) => {
  try {
    const config = reviewSchema.parse(req.body);

    // Validate that we have either PR info or diff
    if (!config.prNumber && !config.prUrl && !config.diff) {
      return res.status(400).json({
        error: "Must provide either prNumber, prUrl, or diff",
      });
    }

    const adapter = await createBestAdapter();

    // Create or get indexer for codebase context
    let indexer = reviewEngines.get(config.projectId)?.indexer;
    if (!indexer) {
      indexer = createCodebaseIndexer(config.projectId, config.projectRoot, {
        enableIncremental: true,
      });
      await indexer.initialize();
    }

    // Create review engine
    const reviewEngine = new AgentReviewEngine(adapter, indexer, config.config);
    reviewEngines.set(config.projectId, reviewEngine);

    // Generate review ID
    const reviewId = `review-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Set up progress tracking
    const progressEvents: any[] = [];
    const onProgress = (event: any) => {
      progressEvents.push({ ...event, timestamp: Date.now() });
    };

    // Run review asynchronously
    const reviewPromise = runAgentReview(
      config.projectId,
      config.projectRoot,
      {
        prNumber: config.prNumber,
        prUrl: config.prUrl,
        baseCommit: config.baseCommit,
        headCommit: config.headCommit,
        diff: config.diff,
      },
      config.config,
      onProgress
    ).then((result) => {
      reviewResults.set(reviewId, result);
      return result;
    }).catch((error) => {
      const errorResult: ReviewResult = {
        id: reviewId,
        projectId: config.projectId,
        prNumber: config.prNumber,
        prUrl: config.prUrl,
        baseCommit: config.baseCommit || "",
        headCommit: config.headCommit || "",
        status: "failed",
        findings: [],
        summary: { total: 0, byDimension: {}, bySeverity: {}, approved: false },
        metadata: {
          reviewedAt: new Date().toISOString(),
          durationMs: 0,
          filesReviewed: 0,
          linesReviewed: 0,
          rulesEvaluated: 0,
        },
      };
      reviewResults.set(reviewId, errorResult);
      throw error;
    });

    // Return immediately with review ID
    res.json({
      success: true,
      reviewId,
      message: "Review started. Poll /status/:reviewId for updates.",
    });

    // Wait for completion in background
    await reviewPromise;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Agent Review] Error:", error);
    res.status(500).json({ error: "Review failed", message: String(error) });
  }
});

/**
 * GET /api/infinity/agent-review/status/:reviewId
 * Get review status
 */
router.get("/status/:reviewId", async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const result = reviewResults.get(reviewId);

    if (!result) {
      // Check if still running
      const engine = Array.from(reviewEngines.values()).find(e => e.getReviewStatus?.() === "running");
      if (engine) {
        return res.json({ reviewId, status: "running" });
      }
      return res.status(404).json({ error: "Review not found" });
    }

    res.json({
      reviewId,
      status: result.status,
      progress: result.metadata,
    });
  } catch (error) {
    console.error("[Agent Review Status] Error:", error);
    res.status(500).json({ error: "Status check failed", message: String(error) });
  }
});

/**
 * GET /api/infinity/agent-review/result/:reviewId
 * Get full review result
 */
router.get("/result/:reviewId", async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const result = reviewResults.get(reviewId);

    if (!result) {
      return res.status(404).json({ error: "Review not found" });
    }

    res.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error("[Agent Review Result] Error:", error);
    res.status(500).json({ error: "Result retrieval failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/agent-review/quick
 * Quick review for real-time feedback on a file
 */
router.post("/quick", async (req: Request, res: Response) => {
  try {
    const config = quickReviewSchema.parse(req.body);
    const adapter = await createBestAdapter();

    // Create a minimal indexer if needed
    let indexer = reviewEngines.get(config.projectId)?.indexer;
    if (!indexer) {
      indexer = createCodebaseIndexer(config.projectId, config.projectRoot, {
        enableIncremental: true,
      });
      await indexer.initialize();
    }

    const reviewEngine = new AgentReviewEngine(adapter, indexer);
    reviewEngines.set(config.projectId, reviewEngine);

    // Run quick review
    const findings = await reviewEngine.quickReview({
      filePath: config.filePath,
      content: config.content,
      language: config.language,
    });

    res.json({
      success: true,
      findings,
      filePath: config.filePath,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Agent Quick Review] Error:", error);
    res.status(500).json({ error: "Quick review failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/agent-review/rules
 * Configure review rules for a project
 */
router.post("/rules", async (req: Request, res: Response) => {
  try {
    const config = rulesSchema.parse(req.body);

    const projectRules = config.rules.map(rule => ({
      ...rule,
      projectId: config.projectId,
    }));

    reviewConfigs.set(config.projectId, {
      customRules: projectRules,
    } as any);

    res.json({
      success: true,
      message: `Configured ${projectRules.length} review rules for project ${config.projectId}`,
      rules: projectRules,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Agent Review Rules] Error:", error);
    res.status(500).json({ error: "Rules configuration failed", message: String(error) });
  }
});

/**
 * GET /api/infinity/agent-review/rules
 * Get review rules for a project
 */
router.get("/rules", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query;
    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }

    const config = reviewConfigs.get(projectId);
    const rules = config?.customRules || DEFAULT_REVIEW_RULES.filter(r => r.enabled);

    res.json({
      success: true,
      projectId,
      rules,
      defaultRulesCount: DEFAULT_REVIEW_RULES.length,
    });
  } catch (error) {
    console.error("[Agent Review Get Rules] Error:", error);
    res.status(500).json({ error: "Rules retrieval failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/agent-review/trigger
 * Configure review triggers
 */
router.post("/trigger", async (req: Request, res: Response) => {
  try {
    const config = triggerSchema.parse(req.body);

    // Store trigger config (in production, persist to database)
    const existing = reviewConfigs.get(config.projectId) || {};
    existing.triggers = config.triggers;
    reviewConfigs.set(config.projectId, existing as any);

    res.json({
      success: true,
      message: `Configured ${config.triggers.length} triggers for project ${config.projectId}`,
      triggers: config.triggers,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[Agent Review Trigger] Error:", error);
    res.status(500).json({ error: "Trigger configuration failed", message: String(error) });
  }
});

/**
 * GET /api/infinity/agent-review/history
 * Get review history for a project
 */
router.get("/history", async (req: Request, res: Response) => {
  try {
    const { projectId, limit = 50, offset = 0 } = req.query;
    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }

    // Filter results by project
    const projectResults = Array.from(reviewResults.values())
      .filter(r => r.projectId === projectId)
      .sort((a, b) => new Date(b.metadata.reviewedAt).getTime() - new Date(a.metadata.reviewedAt).getTime())
      .slice(Number(offset), Number(offset) + Number(limit));

    res.json({
      success: true,
      projectId,
      reviews: projectResults.map(r => ({
        id: r.id,
        prNumber: r.prNumber,
        prUrl: r.prUrl,
        status: r.status,
        summary: r.summary,
        metadata: r.metadata,
      })),
      total: projectResults.length,
    });
  } catch (error) {
    console.error("[Agent Review History] Error:", error);
    res.status(500).json({ error: "History retrieval failed", message: String(error) });
  }
});

/**
 * GET /api/infinity/agent-review/default-rules
 * Get default review rules
 */
router.get("/default-rules", async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      rules: DEFAULT_REVIEW_RULES,
      count: DEFAULT_REVIEW_RULES.length,
    });
  } catch (error) {
    console.error("[Agent Review Default Rules] Error:", error);
    res.status(500).json({ error: "Default rules retrieval failed", message: String(error) });
  }
});

/**
 * POST /api/infinity/agent-review/learning/feedback
 * Submit feedback on review findings (for learning system)
 */
router.post("/learning/feedback", async (req: Request, res: Response) => {
  try {
    const { projectId, findingId, isFalsePositive, correctSeverity, notes } = req.body;

    if (!projectId || !findingId) {
      return res.status(400).json({ error: "projectId and findingId are required" });
    }

    const engine = reviewEngines.get(projectId);
    if (engine) {
      engine.recordFeedback(findingId, {
        isFalsePositive: isFalsePositive ?? false,
        correctSeverity,
        notes,
      });
    }

    res.json({
      success: true,
      message: "Feedback recorded for learning system",
    });
  } catch (error) {
    console.error("[Agent Review Learning] Error:", error);
    res.status(500).json({ error: "Learning feedback failed", message: String(error) });
  }
});

/**
 * GET /api/infinity/agent-review/learning/stats
 * Get learning system statistics
 */
router.get("/learning/stats", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query;
    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }

    const engine = reviewEngines.get(projectId);
    if (!engine) {
      return res.json({
        success: true,
        projectId,
        stats: { totalFeedback: 0, falsePositiveRate: 0, rulesImproved: 0 },
      });
    }

    const stats = engine.getLearningStats();
    res.json({ success: true, projectId, stats });
  } catch (error) {
    console.error("[Agent Review Learning Stats] Error:", error);
    res.status(500).json({ error: "Learning stats failed", message: String(error) });
  }
});

export default router;