/**
 * Phase 22: Universal Tool Layer — Research Capability Integration
 *
 * Registers research tools for both v1 (deep-research) and v2 (DeepResearch v2) engines.
 * Wraps existing implementations from research-engine.ts and deep-research-v2.ts.
 */

import { registerTool } from "../tool-registry";
import { startResearchJob, estimateJob, type JobDepth, recoverStuckJobs } from "../research-engine";
import { startDeepResearchV2, createExpertFromResearch, recoverStuckDeepResearchJobs } from "../deep-research-v2";
import { db, researchJobs, researchJobsV2 } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "../logger";
import type { UniversalToolDefinition, ToolExecutionContext, UniversalToolResult } from "../tool-types";

export function registerResearchTools(): void {
  const researchRun: UniversalToolDefinition = {
    name: "research.run",
    description: "Start a deep research job (v1 engine). Runs asynchronously, poll with research.status. Returns job ID immediately.",
    category: "research",
    risk: "EXTERNAL_ACTION",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Research question or topic (max 8000 chars)" },
        title: { type: "string", description: "Optional custom title (default: first 60 chars of prompt)" },
        mode: { type: "string", enum: ["agent", "normal", "both"], description: "Mode: agent=autonomous, normal=summarize, both (default: agent)" },
        depth: { type: "string", enum: ["standard", "deep", "quantum", "omni"], description: "Depth level (default: deep)" },
      },
      required: ["prompt"],
    },
    timeoutMs: 10000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const prompt = String(args["prompt"] ?? "").trim();
      if (!prompt) return { success: false, error: "prompt is required" };
      if (prompt.length > 8000) return { success: false, error: "prompt too long (max 8000 chars)" };

      const title = String(args["title"] ?? "").trim() || prompt.slice(0, 60);
      const modeValue = String(args["mode"] ?? "").trim();
      const mode = ["agent", "normal", "both"].includes(modeValue)
        ? (modeValue as "agent" | "normal" | "both")
        : "agent";
      const depth = ["standard", "deep", "quantum", "omni"].includes(String(args["depth"] ?? ""))
        ? (String(args["depth"]) as JobDepth)
        : "deep";

      try {
        const [job] = await db
          .insert(researchJobs)
          .values({ title, prompt, mode, depth })
          .returning();

        // Start the job in background
        void startResearchJob(job.id);

        return {
          success: true,
          data: { jobId: job.id, title: job.title, mode, depth },
          summary: `Started deep research v1 job: ${job.id}`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Failed to start research job" };
      }
    },
  };

  const researchRunV2: UniversalToolDefinition = {
    name: "research.run_v2",
    description: "Start a Deep Research v2 job (ChatGPT/Gemini style, 3-7 min). Iterative plan→search→browse→extract→synthesize→gap loop. Returns job ID immediately, poll with research.status_v2.",
    category: "research",
    risk: "EXTERNAL_ACTION",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Research topic/question (max 500 chars)" },
        maxIterations: { type: "number", description: "Max iterations 1-5 (default: 3)" },
      },
      required: ["topic"],
    },
    timeoutMs: 10000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const topic = String(args["topic"] ?? "").trim();
      if (!topic) return { success: false, error: "topic is required" };
      if (topic.length > 500) return { success: false, error: "topic too long (max 500 chars)" };
      const maxIterations = Math.min(5, Math.max(1, Number(args["maxIterations"] ?? 3)));

      try {
        const [job] = await db
          .insert(researchJobsV2)
          .values({ topic, status: "queued", phase: "planning", progress: 0, maxIterations })
          .returning();

        // Start the job in background
        void startDeepResearchV2(job.id);

        return {
          success: true,
          data: { jobId: job.id, topic, maxIterations },
          summary: `Started Deep Research v2 job: ${job.id}`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Failed to start v2 research job" };
      }
    },
  };

  const researchStatus: UniversalToolDefinition = {
    name: "research.status",
    description: "Get status of a v1 deep research job.",
    category: "research",
    risk: "READ",
    parameters: {
      type: "object",
      properties: { jobId: { type: "string", description: "Research job ID" } },
      required: ["jobId"],
    },
    timeoutMs: 5000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const jobId = String(args["jobId"] ?? "").trim();
      if (!jobId) return { success: false, error: "jobId is required" };
      try {
        const [job] = await db.select().from(researchJobs).where(eq(researchJobs.id, jobId));
        if (!job) return { success: false, error: "Job not found" };
        return { success: true, data: job, summary: `Job ${jobId}: ${job.status} (${job.progress ?? 0}%)` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Status failed" };
      }
    },
  };

  const researchStatusV2: UniversalToolDefinition = {
    name: "research.status_v2",
    description: "Get detailed status of a Deep Research v2 job including phase, progress, sources found, and partial report.",
    category: "research",
    risk: "READ",
    parameters: {
      type: "object",
      properties: { jobId: { type: "string", description: "Research job V2 ID" } },
      required: ["jobId"],
    },
    timeoutMs: 5000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const jobId = String(args["jobId"] ?? "").trim();
      if (!jobId) return { success: false, error: "jobId is required" };
      try {
        const [job] = await db.select().from(researchJobsV2).where(eq(researchJobsV2.id, jobId));
        if (!job) return { success: false, error: "Job not found" };
        return {
          success: true,
          data: job,
          summary: `Job ${jobId}: ${job.status} / ${job.phase} (${job.progress}%) - ${job.sourcesFound} sources, ${job.pagesRead} pages`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Status failed" };
      }
    },
  };

  const researchList: UniversalToolDefinition = {
    name: "research.list",
    description: "List all research jobs (v1 and v2), newest first.",
    category: "research",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        includeV1: { type: "boolean", description: "Include v1 jobs (default: true)" },
        includeV2: { type: "boolean", description: "Include v2 jobs (default: true)" },
        limit: { type: "number", description: "Max results (default: 50)" },
      },
    },
    timeoutMs: 5000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const includeV1 = args["includeV1"] !== false;
      const includeV2 = args["includeV2"] !== false;
      const limit = Math.min(200, Math.max(1, Number(args["limit"] ?? 50)));

      const result: any = { v1: [], v2: [] };
      if (includeV1) {
        result.v1 = await db.select().from(researchJobs).orderBy(desc(researchJobs.createdAt)).limit(limit);
      }
      if (includeV2) {
        result.v2 = await db.select().from(researchJobsV2).orderBy(desc(researchJobsV2.createdAt)).limit(limit);
      }
      return { success: true, data: result, summary: `Listed ${result.v1.length} v1 + ${result.v2.length} v2 jobs` };
    },
  };

  const researchEstimate: UniversalToolDefinition = {
    name: "research.estimate",
    description: "Get cost/duration estimate for a v1 research depth level before launching.",
    category: "research",
    risk: "READ",
    parameters: {
      type: "object",
      properties: { depth: { type: "string", enum: ["standard", "deep", "quantum", "omni"], description: "Depth level" } },
      required: ["depth"],
    },
    timeoutMs: 3000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const depth = String(args["depth"] ?? "").trim();
      if (!["standard", "deep", "quantum", "omni"].includes(depth)) {
        return { success: false, error: "depth must be one of: standard, deep, quantum, omni" };
      }
      try {
        const estimate = estimateJob(depth as JobDepth);
        return { success: true, data: estimate, summary: `Estimate for ${depth}: ${estimate.totalHours.min}-${estimate.totalHours.max}h, ${estimate.searches.min}-${estimate.searches.max} searches` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Estimate failed" };
      }
    },
  };

  const researchCancel: UniversalToolDefinition = {
    name: "research.cancel",
    description: "Cancel a running v1 research job.",
    category: "research",
    risk: "WRITE",
    parameters: {
      type: "object",
      properties: { jobId: { type: "string", description: "Research job ID" } },
      required: ["jobId"],
    },
    timeoutMs: 5000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const jobId = String(args["jobId"] ?? "").trim();
      if (!jobId) return { success: false, error: "jobId is required" };
      try {
        const [job] = await db.select().from(researchJobs).where(eq(researchJobs.id, jobId));
        if (!job) return { success: false, error: "Job not found" };
        if (["completed", "failed", "cancelled"].includes(job.status)) {
          return { success: true, data: { ok: true, status: job.status }, summary: `Job already ${job.status}` };
        }
        await db.update(researchJobs).set({ status: "cancelled" }).where(eq(researchJobs.id, jobId));
        return { success: true, data: { ok: true, status: "cancelled" }, summary: `Job ${jobId} cancelled` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Cancel failed" };
      }
    },
  };

  const researchExpert: UniversalToolDefinition = {
    name: "research.create_expert",
    description: "Create an Expert persona from a completed v2 research job. Returns expert name and system prompt.",
    category: "research",
    risk: "WRITE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: { jobId: { type: "string", description: "Completed v2 research job ID" } },
      required: ["jobId"],
    },
    timeoutMs: 30000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const jobId = String(args["jobId"] ?? "").trim();
      if (!jobId) return { success: false, error: "jobId is required" };
      try {
        const result = await createExpertFromResearch(jobId);
        if (!result) return { success: false, error: "Job not found, not completed, or no report available" };
        return { success: true, data: result, summary: `Created expert: ${result.expertName}` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Expert creation failed" };
      }
    },
  };

  const researchRecover: UniversalToolDefinition = {
    name: "research.recover_stuck",
    description: "Manually trigger recovery of stuck research jobs (v1 and v2). Useful after server restart.",
    category: "research",
    risk: "WRITE",
    parameters: {
      type: "object",
      properties: { version: { type: "string", enum: ["v1", "v2", "both"], description: "Which engine to recover (default: both)" } },
    },
    timeoutMs: 10000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const version = String(args["version"] ?? "both");
      try {
        if (version === "v1" || version === "both") {
          await recoverStuckJobs();
        }
        if (version === "v2" || version === "both") {
          await recoverStuckDeepResearchJobs();
        }
        return { success: true, data: { ok: true, version }, summary: `Recovery triggered for ${version}` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Recovery failed" };
      }
    },
  };

  registerTool(researchRun);
  registerTool(researchRunV2);
  registerTool(researchStatus);
  registerTool(researchStatusV2);
  registerTool(researchList);
  registerTool(researchEstimate);
  registerTool(researchCancel);
  registerTool(researchExpert);
  registerTool(researchRecover);
  logger.info("[tools/research] Registered 8 research tools (run, run_v2, status, status_v2, list, estimate, cancel, create_expert, recover_stuck)");
}