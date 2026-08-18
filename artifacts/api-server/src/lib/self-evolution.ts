/**
 * Self-Evolution Engine
 * Allows Infinity to safely modify its own codebase with checkpoints, testing, and rollback
 */

import { execSync } from "child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { logger } from "./logger";
import { logActivity } from "./project-activity";

export interface EvolutionProposal {
  id: string;
  projectId: string;
  title: string;
  description: string;
  files: Array<{
    path: string;
    oldContent: string;
    newContent: string;
  }>;
  rationale: string;
  riskLevel: "low" | "medium" | "high";
  requiresApproval: boolean;
  createdAt: Date;
  status: "proposed" | "approved" | "rejected" | "applied" | "rolled_back";
  appliedAt?: Date;
  rollbackReason?: string;
  testResults?: {
    passed: boolean;
    output: string;
  };
}

export interface EvolutionConfig {
  allowedPaths: string[]; // Paths the agent can modify
  blockedPaths: string[]; // Paths the agent can NEVER modify
  requireTests: boolean;
  requireApproval: boolean;
  maxFileSize: number;
  checkpointDir: string;
}

const DEFAULT_CONFIG: EvolutionConfig = {
  allowedPaths: [
    "artifacts/api-server/src/lib/",
    "artifacts/api-server/src/routes/",
    "artifacts/jarvis/src/components/",
    "artifacts/jarvis/src/hooks/",
    "artifacts/jarvis/src/utils/",
  ],
  blockedPaths: [
    "artifacts/api-server/src/middlewares/auth.ts",
    "artifacts/api-server/src/lib/secrets.ts",
    "artifacts/api-server/src/lib/llm-keys.ts",
    "lib/db/src/schema/",
    ".env",
    "package.json",
    "tsconfig.json",
    "docker-compose.yml",
  ],
  requireTests: true,
  requireApproval: true,
  maxFileSize: 100000, // 100KB
  checkpointDir: ".infinity/checkpoints",
};

let config: EvolutionConfig = DEFAULT_CONFIG;

export function setEvolutionConfig(newConfig: Partial<EvolutionConfig>): void {
  config = { ...config, ...newConfig };
}

export function getEvolutionConfig(): EvolutionConfig {
  return { ...config };
}

/**
 * Check if a path is allowed for self-modification
 */
export function isPathAllowed(path: string): boolean {
  // Check blocked paths first
  for (const blocked of config.blockedPaths) {
    if (path.startsWith(blocked) || path.includes(blocked)) {
      return false;
    }
  }

  // Check allowed paths
  for (const allowed of config.allowedPaths) {
    if (path.startsWith(allowed)) {
      return true;
    }
  }

  return false;
}

/**
 * Create a checkpoint (git commit + file backup)
 */
export async function createCheckpoint(projectId: string, description: string): Promise<string> {
  const checkpointDir = join(process.cwd(), config.checkpointDir, projectId);
  mkdirSync(checkpointDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const checkpointId = `checkpoint_${timestamp}`;

  try {
    // Git commit as checkpoint
    execSync("git add -A", { stdio: "pipe" });
    execSync(`git commit -m "checkpoint: ${description}" --no-verify`, { stdio: "pipe" });

    const commitHash = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();

    // Also save file manifest
    const manifest = {
      id: checkpointId,
      commitHash,
      description,
      timestamp: new Date().toISOString(),
      projectId,
    };

    writeFileSync(join(checkpointDir, `${checkpointId}.json`), JSON.stringify(manifest, null, 2));

    logger.info({ checkpointId, commitHash }, "[Self-Evolution] Checkpoint created");
    return checkpointId;
  } catch (err) {
    logger.error({ err }, "[Self-Evolution] Failed to create checkpoint");
    throw new Error(`Checkpoint failed: ${err instanceof Error ? err.message : "Unknown"}`);
  }
}

/**
 * Rollback to a checkpoint
 */
export async function rollbackToCheckpoint(projectId: string, checkpointId: string): Promise<boolean> {
  const checkpointDir = join(process.cwd(), config.checkpointDir, projectId);
  const manifestPath = join(checkpointDir, `${checkpointId}.json`);

  if (!existsSync(manifestPath)) {
    throw new Error(`Checkpoint not found: ${checkpointId}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

  try {
    execSync(`git reset --hard ${manifest.commitHash}`, { stdio: "pipe" });
    logger.info({ checkpointId }, "[Self-Evolution] Rollback complete");
    return true;
  } catch (err) {
    logger.error({ err, checkpointId }, "[Self-Evolution] Rollback failed");
    return false;
  }
}

/**
 * List available checkpoints
 */
export function listCheckpoints(projectId: string): Array<{ id: string; description: string; timestamp: string; commitHash: string }> {
  const checkpointDir = join(process.cwd(), config.checkpointDir, projectId);
  if (!existsSync(checkpointDir)) return [];

  const files = require("fs").readdirSync(checkpointDir).filter((f: string) => f.endsWith(".json"));
  return files.map((f: string) => {
    const data = JSON.parse(readFileSync(join(checkpointDir, f), "utf-8")) as {
      id: string;
      description: string;
      timestamp: string;
      commitHash: string;
    };
    return {
      id: data.id,
      description: data.description,
      timestamp: data.timestamp,
      commitHash: data.commitHash,
    };
  }).sort((a: { timestamp: string }, b: { timestamp: string }) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * Apply an evolution proposal
 */
export async function applyEvolution(proposal: EvolutionProposal): Promise<{ success: boolean; error?: string }> {
  // Validate all paths
  for (const file of proposal.files) {
    if (!isPathAllowed(file.path)) {
      return { success: false, error: `Path not allowed: ${file.path}` };
    }
    if (file.newContent.length > config.maxFileSize) {
      return { success: false, error: `File too large: ${file.path} (${file.newContent.length} bytes)` };
    }
  }

  // Create checkpoint before applying
  const checkpointId = await createCheckpoint(proposal.projectId, `pre-evolution: ${proposal.title}`);

  try {
    // Apply all file changes
    for (const file of proposal.files) {
      const fullPath = join(process.cwd(), file.path);
      mkdirSync(require("path").dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, file.newContent);
    }

    // Run tests if required
    let testPassed = true;
    let testOutput = "";

    if (config.requireTests) {
      try {
        testOutput = execSync("npm run typecheck && npm run build", { encoding: "utf-8", timeout: 180000, stdio: "pipe" });
      } catch (err) {
        testPassed = false;
        testOutput = err instanceof Error ? err.message : String(err);
      }
    }

    if (!testPassed) {
      // Rollback on test failure
      await rollbackToCheckpoint(proposal.projectId, checkpointId);
      return { success: false, error: `Tests failed: ${testOutput}` };
    }

    // Commit the changes
    execSync("git add -A", { stdio: "pipe" });
    execSync(`git commit -m "evolution: ${proposal.title}" --no-verify`, { stdio: "pipe" });

    proposal.status = "applied";
    proposal.appliedAt = new Date();
    proposal.testResults = { passed: true, output: testOutput };

    await logActivity(proposal.projectId, "agent_ran", `Self-evolution applied: ${proposal.title}`);

    return { success: true };
  } catch (err) {
    // Rollback on any error
    await rollbackToCheckpoint(proposal.projectId, checkpointId);
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Create an evolution proposal (for review/approval)
 */
export function createProposal(
  projectId: string,
  title: string,
  description: string,
  files: EvolutionProposal["files"],
  rationale: string
): EvolutionProposal {
  const riskLevel = assessRisk(files);

  return {
    id: `evo_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    projectId,
    title,
    description,
    files,
    rationale,
    riskLevel,
    requiresApproval: config.requireApproval && riskLevel !== "low",
    createdAt: new Date(),
    status: "proposed",
  };
}

/**
 * Assess risk level of proposed changes
 */
function assessRisk(files: EvolutionProposal["files"]): "low" | "medium" | "high" {
  let maxRisk: "low" | "medium" | "high" = "low";

  for (const file of files) {
    let risk: "low" | "medium" | "high" = "low";

    // High risk: auth, config, schema, database
    if (file.path.includes("auth") || file.path.includes("config") ||
        file.path.includes("schema") || file.path.includes("secrets") ||
        file.path.includes("middleware")) {
      risk = "high";
    }
    // Medium risk: core logic, routes, tools
    else if (file.path.includes("orchestrator") || file.path.includes("build-") ||
             file.path.includes("workspace") || file.path.includes("llm")) {
      risk = "medium";
    }

    // Elevated risk for large changes
    const changeSize = Math.abs(file.newContent.length - file.oldContent.length);
    if (changeSize > 5000) risk = "high";
    else if (changeSize > 1000) risk = risk === "low" ? "medium" : risk;

    if (risk === "high") maxRisk = "high";
    else if (risk === "medium" && maxRisk === "low") maxRisk = "medium";
  }

  return maxRisk;
}

/**
 * Get evolution history for a project
 */
export async function getEvolutionHistory(projectId: string): Promise<EvolutionProposal[]> {
  // This would read from a database table in production
  // For now, return from checkpoints
  const checkpoints = listCheckpoints(projectId);
  return checkpoints.filter(c => c.description.startsWith("evolution:")).map(c => ({
    id: c.id,
    projectId,
    title: c.description.replace("evolution: ", ""),
    description: "",
    files: [],
    rationale: "",
    riskLevel: "low" as const,
    requiresApproval: false,
    createdAt: new Date(c.timestamp),
    status: "applied" as const,
    appliedAt: new Date(c.timestamp),
  }));
}

/**
 * Run self-evolution cycle: analyze → propose → test → apply
 */
export async function runSelfEvolutionCycle(
  projectId: string,
  goal: string,
  maxProposals: number = 3
): Promise<{ proposals: EvolutionProposal[]; applied: number }> {
  const proposals: EvolutionProposal[] = [];
  let applied = 0;

  // Get current codebase context
  const { buildFileMap } = await import("./build-context");
  const fileMap = await buildFileMap(projectId, projectId);

  // Build prompt for LLM to generate proposals
  const { createBestAdapter, buildInfinityPrompt } = await import("./llm");
  const adapter = await createBestAdapter();
  type MessageRole = "system" | "user" | "assistant" | "tool";

  const prompt = `You are Infinity, a self-evolving AI coding agent. Analyze the codebase and propose improvements.

Goal: ${goal}

Current Codebase (file map):
${JSON.stringify(Object.keys(fileMap).slice(0, 50), null, 2)}

Propose up to ${maxProposals} specific, safe improvements. Each proposal must:
1. Have a clear title and rationale
2. Specify exact file paths and changes (old → new content)
3. Be low/medium risk only (no auth, config, schema changes)
4. Follow existing code patterns

Return as JSON array of proposals:
[
  {
    "title": "...",
    "description": "...",
    "files": [{"path": "...", "oldContent": "...", "newContent": "..."}],
    "rationale": "..."
  }
]`;

  const systemPrompt = "You are a senior software engineer. Output ONLY valid JSON array of proposals.";
  const fullPrompt = buildInfinityPrompt({ role: "chat", extraInstructions: systemPrompt, workingContext: prompt });

  let response = "";
  try {
    const result = await adapter.complete(
      [
        { role: "system" as MessageRole, content: fullPrompt },
        { role: "user" as MessageRole, content: prompt },
      ],
      { temperature: 0.3, maxTokens: 8000 }
    );
    response = result.content;
  } catch (err) {
    logger.error({ err }, "[Self-Evolution] LLM proposal generation failed");
    return { proposals: [], applied: 0 };
  }

  // Parse proposals
  let parsedProposals: any[] = [];
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    parsedProposals = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch {
    logger.warn("[Self-Evolution] Failed to parse proposals");
    return { proposals: [], applied: 0 };
  }

  // Create and apply proposals
  for (const p of parsedProposals.slice(0, maxProposals)) {
    const proposal = createProposal(projectId, p.title, p.description, p.files, p.rationale);

    if (!proposal.requiresApproval || proposal.riskLevel === "low") {
      const result = await applyEvolution(proposal);
      if (result.success) {
        applied++;
        proposal.status = "applied";
      } else {
        proposal.status = "rejected";
        proposal.rollbackReason = result.error;
      }
    } else {
      proposal.status = "proposed"; // Requires manual approval
    }

    proposals.push(proposal);
  }

  return { proposals, applied };
}