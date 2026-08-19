import { db } from "@workspace/db";
import { buildCheckpoints } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getWorkspaceRoot, safeWorkspacePath } from "./workspace";

/**
 * Phase 1.2 — Checkpoint persistence & resume.
 *
 * - saveCheckpoint: writes a full checkpoint row (upserts by projectId + iteration)
 * - getLatestCheckpoint: fetches the most recent for a project (for resume on boot)
 * - listCheckpoints: history UI
 * - deleteCheckpoint: cleanup
 *
 * On server boot: the build route calls getLatestCheckpoint(projectId); if it
 * exists and completed=0, it emits a "resume?" prompt to the UI with the
 * stored plan/completedSteps/workingContext.
 */

/**
 * Checkpoint phases for granular recovery
 */
export type CheckpointPhase =
  | "planning"
  | "step-group-1"
  | "step-group-2"
  | "step-group-3"
  | "step-group-4"
  | "step-group-5"
  | "pre-verification"
  | "verification"
  | "done-contract"
  | "completed";

/**
 * Failure classification for targeted recovery
 */
export type FailureClass =
  | "bad-package-install"
  | "broken-migration"
  | "massive-rewrite"
  | "corrupted-files"
  | "dev-server-stuck"
  | "dependency-conflict"
  | "compilation-error"
  | "test-failure"
  | "visual-regression"
  | "timeout"
  | "network-error"
  | "disk-space"
  | "permission-denied"
  | "unknown";

/**
 * Recovery action types
 */
export type RecoveryActionType =
  | "retry-step"
  | "retry-with-pnpm"
  | "git-reset-hard"
  | "workspace-repair"
  | "clear-node-modules"
  | "fix-lockfile"
  | "reinstall-deps"
  | "restart-dev-server"
  | "skip-step"
  | "abort"
  | "manual-intervention";

/**
 * Checkpoint data with phase tracking
 */
export interface CheckpointData {
  projectId: string;
  iteration: number;
  completed: 0 | 1;
  phase: CheckpointPhase;
  plan: Record<string, unknown>;
  completedSteps: Array<Record<string, unknown>>;
  workingContext: Record<string, unknown>;
  fileSnapshots?: Record<string, string>;
  tokenUsage?: Record<string, unknown>;
  /** Git commit hash at checkpoint */
  gitCommit?: string;
  /** Worktree path for git-first builds */
  worktreePath?: string;
  /** Step group index for multi-group builds */
  stepGroupIndex?: number;
  /** Project path for git operations */
  projectPath?: string;
}

/**
 * Failure classification result
 */
export interface FailureClassification {
  class: FailureClass;
  confidence: number;
  indicators: string[];
  suggestedActions: RecoveryActionType[];
  description: string;
}

/**
 * Recovery action definition
 */
export interface RecoveryAction {
  type: RecoveryActionType;
  label: string;
  description: string;
  /** Whether this action can be automated */
  automated: boolean;
  /** Execute the recovery action */
  execute: (context: RecoveryContext) => Promise<RecoveryResult>;
}

/**
 * Context for recovery execution
 */
export interface RecoveryContext {
  projectId: string;
  workspaceId: string;
  projectPath: string;
  checkpoint: CheckpointData;
  failure: FailureClassification;
  buildId: string;
}

/**
 * Recovery action result
 */
export interface RecoveryResult {
  success: boolean;
  message: string;
  nextPhase?: CheckpointPhase;
  newCheckpointId?: string;
  error?: string;
}

/**
 * Resume options presented to user
 */
export interface ResumeOptions {
  checkpoint: CheckpointData;
  failure?: FailureClassification;
  options: Array<{
    id: string;
    label: string;
    description: string;
    action: RecoveryActionType;
    automated: boolean;
    risk: "low" | "medium" | "high";
  }>;
}

export async function saveCheckpoint(data: CheckpointData): Promise<string> {
  const existing = await db
    .select({ id: buildCheckpoints.id })
    .from(buildCheckpoints)
    .where(eq(buildCheckpoints.projectId, data.projectId))
    .orderBy(desc(buildCheckpoints.iteration))
    .limit(1);

  if (existing.length > 0 && existing[0].id) {
    // Update existing latest checkpoint
    await db
      .update(buildCheckpoints)
      .set({
        iteration: data.iteration,
        completed: data.completed,
        plan: data.plan,
        completedSteps: data.completedSteps,
        workingContext: data.workingContext,
        fileSnapshots: data.fileSnapshots ?? null,
        tokenUsage: data.tokenUsage ?? {},
        updatedAt: new Date(),
      })
      .where(eq(buildCheckpoints.id, existing[0].id));
    return existing[0].id;
  }

  // Insert new
  const [row] = await db
    .insert(buildCheckpoints)
    .values({
      projectId: data.projectId,
      iteration: data.iteration,
      completed: data.completed,
      plan: data.plan,
      completedSteps: data.completedSteps,
      workingContext: data.workingContext,
      fileSnapshots: data.fileSnapshots ?? null,
      tokenUsage: data.tokenUsage ?? {},
    })
    .returning({ id: buildCheckpoints.id });
  return row.id;
}

export async function getLatestCheckpoint(projectId: string) {
  const rows = await db
    .select()
    .from(buildCheckpoints)
    .where(eq(buildCheckpoints.projectId, projectId))
    .orderBy(desc(buildCheckpoints.iteration))
    .limit(1);
  return rows[0] ?? null;
}

export async function listCheckpoints(projectId: string, limit = 20) {
  return db
    .select()
    .from(buildCheckpoints)
    .where(eq(buildCheckpoints.projectId, projectId))
    .orderBy(desc(buildCheckpoints.iteration))
    .limit(limit);
}

export async function deleteCheckpoint(id: string): Promise<boolean> {
  const result = await db.delete(buildCheckpoints).where(eq(buildCheckpoints.id, id));
  return (result.rowCount ?? 0) > 0;
}

export async function markCheckpointComplete(id: string): Promise<boolean> {
  const result = await db
    .update(buildCheckpoints)
    .set({ completed: 1, updatedAt: new Date() })
    .where(eq(buildCheckpoints.id, id));
  return (result.rowCount ?? 0) > 0;
}

/**
 * ============================================================
 * CHECKPOINT CREATION (Phase-based)
 * ============================================================
 */

/**
 * Save checkpoint at a specific phase
 */
export async function savePhaseCheckpoint(
  projectId: string,
  phase: CheckpointPhase,
  data: Omit<CheckpointData, "projectId" | "phase">,
  workspaceId?: string
): Promise<string> {
  const iteration = data.iteration;

  // Get git commit hash
  let gitCommit: string | undefined;
  try {
    const { execa } = await import("execa");
    const result = await execa("git", ["rev-parse", "HEAD"], {
      cwd: data.projectPath || getWorkspaceRoot(workspaceId || projectId),
      reject: false,
    });
    if (result.exitCode === 0) {
      gitCommit = result.stdout.trim();
    }
  } catch {
    // ignore
  }

  const checkpointData: CheckpointData = {
    ...data,
    projectId,
    phase,
    gitCommit,
  };

  return saveCheckpoint(checkpointData);
}

/**
 * Create checkpoint after planning phase
 */
export async function createPlanningCheckpoint(
  projectId: string,
  plan: Record<string, unknown>,
  iteration: number,
  projectPath: string,
  workspaceId?: string
): Promise<string> {
  return savePhaseCheckpoint(projectId, "planning", {
    iteration,
    completed: 0,
    plan,
    completedSteps: [],
    workingContext: { phase: "planning" },
    projectPath,
  }, workspaceId);
}

/**
 * Create checkpoint after each step group
 */
export async function createStepGroupCheckpoint(
  projectId: string,
  stepGroupIndex: number,
  plan: Record<string, unknown>,
  completedSteps: Array<Record<string, unknown>>,
  workingContext: Record<string, unknown>,
  iteration: number,
  projectPath: string,
  workspaceId?: string
): Promise<string> {
  const phase = `step-group-${stepGroupIndex + 1}` as CheckpointPhase;
  return savePhaseCheckpoint(projectId, phase, {
    iteration,
    completed: 0,
    plan,
    completedSteps,
    workingContext,
    projectPath,
    stepGroupIndex,
  }, workspaceId);
}

/**
 * Create checkpoint before verification
 */
export async function createPreVerificationCheckpoint(
  projectId: string,
  plan: Record<string, unknown>,
  completedSteps: Array<Record<string, unknown>>,
  workingContext: Record<string, unknown>,
  iteration: number,
  projectPath: string,
  workspaceId?: string
): Promise<string> {
  return savePhaseCheckpoint(projectId, "pre-verification", {
    iteration,
    completed: 0,
    plan,
    completedSteps,
    workingContext,
    projectPath,
  }, workspaceId);
}

/**
 * Create final completion checkpoint
 */
export async function createCompletionCheckpoint(
  projectId: string,
  plan: Record<string, unknown>,
  completedSteps: Array<Record<string, unknown>>,
  workingContext: Record<string, unknown>,
  iteration: number,
  projectPath: string,
  workspaceId?: string
): Promise<string> {
  return savePhaseCheckpoint(projectId, "completed", {
    iteration,
    completed: 1,
    plan,
    completedSteps,
    workingContext,
    projectPath,
  }, workspaceId);
}

/**
 * ============================================================
 * FAILURE CLASSIFICATION
 * ============================================================
 */

/**
 * Classify a failure based on error output and context
 */
export async function classifyFailure(
  error: Error | string,
  context: { projectPath: string; phase: CheckpointPhase; recentOutput?: string }
): Promise<FailureClassification> {
  const errorStr = error instanceof Error ? error.message : error;
  const output = context.recentOutput || errorStr;

  // Bad package install
  if (output.includes("npm ERR!") || output.includes("pnpm ERR!") ||
      output.includes("EACCES") || output.includes("EPERM") ||
      output.includes("EEXIST") || output.includes("ENOENT")) {
    return {
      class: "bad-package-install",
      confidence: 0.9,
      indicators: ["npm ERR!", "pnpm ERR!", "permission denied", "file exists"],
      suggestedActions: ["retry-with-pnpm", "clear-node-modules", "fix-lockfile", "reinstall-deps"],
      description: "Package manager installation failed",
    };
  }

  // Broken migration
  if (output.includes("migration") && (output.includes("failed") || output.includes("error"))) {
    return {
      class: "broken-migration",
      confidence: 0.85,
      indicators: ["migration failed", "migration error", "schema mismatch"],
      suggestedActions: ["git-reset-hard", "workspace-repair", "manual-intervention"],
      description: "Database migration failed",
    };
  }

  // Massive rewrite
  if (output.includes("rewrite") && output.includes("massive") ||
      output.includes("complete rewrite") || output.includes("rewriting entire")) {
    return {
      class: "massive-rewrite",
      confidence: 0.8,
      indicators: ["massive rewrite", "complete rewrite", "rewriting entire"],
      suggestedActions: ["git-reset-hard", "skip-step", "abort"],
      description: "Agent attempted massive rewrite",
    };
  }

  // Corrupted files
  if (output.includes("corrupt") || output.includes("invalid") ||
      output.includes("unexpected token") || output.includes("syntax error")) {
    return {
      class: "corrupted-files",
      confidence: 0.85,
      indicators: ["corrupt", "invalid", "unexpected token", "syntax error"],
      suggestedActions: ["git-reset-hard", "workspace-repair", "clear-node-modules"],
      description: "Files appear corrupted or have syntax errors",
    };
  }

  // Dev server stuck
  if (output.includes("dev server") && (output.includes("stuck") || output.includes("timeout") ||
      output.includes("hanging") || output.includes("not responding"))) {
    return {
      class: "dev-server-stuck",
      confidence: 0.9,
      indicators: ["dev server stuck", "dev server timeout", "not responding"],
      suggestedActions: ["restart-dev-server", "skip-step", "retry-step"],
      description: "Development server is not responding",
    };
  }

  // Dependency conflict
  if (output.includes("peer dependency") || output.includes("conflict") ||
      output.includes("ERESOLVE") || output.includes("version conflict")) {
    return {
      class: "dependency-conflict",
      confidence: 0.9,
      indicators: ["peer dependency", "conflict", "ERESOLVE", "version conflict"],
      suggestedActions: ["fix-lockfile", "reinstall-deps", "clear-node-modules"],
      description: "Dependency version conflicts detected",
    };
  }

  // Compilation error
  if (output.includes("TypeScript") && output.includes("error") ||
      output.includes("TS2") || output.includes("compilation failed") ||
      output.includes("Build failed")) {
    return {
      class: "compilation-error",
      confidence: 0.95,
      indicators: ["TypeScript error", "TS2", "compilation failed", "Build failed"],
      suggestedActions: ["retry-step", "git-reset-hard", "skip-step"],
      description: "TypeScript compilation failed",
    };
  }

  // Test failure
  if (output.includes("test") && (output.includes("failed") || output.includes("FAIL"))) {
    return {
      class: "test-failure",
      confidence: 0.9,
      indicators: ["test failed", "FAIL", "assertion failed"],
      suggestedActions: ["retry-step", "skip-step", "manual-intervention"],
      description: "Test suite has failing tests",
    };
  }

  // Visual regression
  if (output.includes("visual") && (output.includes("regression") || output.includes("diff") ||
      output.includes("pixel difference") || output.includes("screenshot"))) {
    return {
      class: "visual-regression",
      confidence: 0.9,
      indicators: ["visual regression", "pixel difference", "screenshot diff"],
      suggestedActions: ["retry-step", "skip-step", "manual-intervention"],
      description: "Visual regression detected",
    };
  }

  // Timeout
  if (output.includes("timeout") || output.includes("ETIMEDOUT") ||
      output.includes("timed out") || output.includes("exceeded")) {
    return {
      class: "timeout",
      confidence: 0.95,
      indicators: ["timeout", "ETIMEDOUT", "timed out", "exceeded"],
      suggestedActions: ["retry-step", "restart-dev-server", "skip-step"],
      description: "Operation timed out",
    };
  }

  // Network error
  if (output.includes("ECONNREFUSED") || output.includes("ENOTFOUND") ||
      output.includes("network") || output.includes("fetch failed")) {
    return {
      class: "network-error",
      confidence: 0.9,
      indicators: ["ECONNREFUSED", "ENOTFOUND", "network error", "fetch failed"],
      suggestedActions: ["retry-step", "skip-step"],
      description: "Network connectivity issue",
    };
  }

  // Disk space
  if (output.includes("ENOSPC") || output.includes("disk space") ||
      output.includes("no space left")) {
    return {
      class: "disk-space",
      confidence: 0.95,
      indicators: ["ENOSPC", "disk space", "no space left"],
      suggestedActions: ["clear-node-modules", "workspace-repair", "manual-intervention"],
      description: "Insufficient disk space",
    };
  }

  // Permission denied
  if (output.includes("EACCES") || output.includes("EPERM") ||
      output.includes("permission denied")) {
    return {
      class: "permission-denied",
      confidence: 0.9,
      indicators: ["EACCES", "EPERM", "permission denied"],
      suggestedActions: ["workspace-repair", "manual-intervention"],
      description: "File system permission denied",
    };
  }

  // Unknown
  return {
    class: "unknown",
    confidence: 0.3,
    indicators: ["unclassified error"],
    suggestedActions: ["retry-step", "git-reset-hard", "manual-intervention"],
    description: "Unknown failure type",
  };
}

/**
 * ============================================================
 * RECOVERY ACTIONS
 * ============================================================
 */

/**
 * Get recovery actions for a failure class
 */
export function getRecoveryActions(failureClass: FailureClass): RecoveryAction[] {
  const actionMap: Record<FailureClass, RecoveryAction[]> = {
    "bad-package-install": [
      createRetryWithPnpmAction(),
      createClearNodeModulesAction(),
      createFixLockfileAction(),
      createReinstallDepsAction(),
    ],
    "broken-migration": [
      createGitResetHardAction(),
      createWorkspaceRepairAction(),
      createManualInterventionAction(),
    ],
    "massive-rewrite": [
      createGitResetHardAction(),
      createSkipStepAction(),
      createAbortAction(),
    ],
    "corrupted-files": [
      createGitResetHardAction(),
      createWorkspaceRepairAction(),
      createClearNodeModulesAction(),
    ],
    "dev-server-stuck": [
      createRestartDevServerAction(),
      createSkipStepAction(),
      createRetryStepAction(),
    ],
    "dependency-conflict": [
      createFixLockfileAction(),
      createReinstallDepsAction(),
      createClearNodeModulesAction(),
    ],
    "compilation-error": [
      createRetryStepAction(),
      createGitResetHardAction(),
      createSkipStepAction(),
    ],
    "test-failure": [
      createRetryStepAction(),
      createSkipStepAction(),
      createManualInterventionAction(),
    ],
    "visual-regression": [
      createRetryStepAction(),
      createSkipStepAction(),
      createManualInterventionAction(),
    ],
    "timeout": [
      createRetryStepAction(),
      createRestartDevServerAction(),
      createSkipStepAction(),
    ],
    "network-error": [
      createRetryStepAction(),
      createSkipStepAction(),
    ],
    "disk-space": [
      createClearNodeModulesAction(),
      createWorkspaceRepairAction(),
      createManualInterventionAction(),
    ],
    "permission-denied": [
      createWorkspaceRepairAction(),
      createManualInterventionAction(),
    ],
    "unknown": [
      createRetryStepAction(),
      createGitResetHardAction(),
      createManualInterventionAction(),
    ],
  };

  return actionMap[failureClass] || actionMap.unknown;
}

/**
 * Execute a recovery action
 */
export async function executeRecovery(
  actionType: RecoveryActionType,
  context: RecoveryContext
): Promise<RecoveryResult> {
  const actions = getRecoveryActions(context.failure.class);
  const action = actions.find(a => a.type === actionType);

  if (!action) {
    return {
      success: false,
      message: `Unknown recovery action: ${actionType}`,
      error: "Action not found",
    };
  }

  try {
    return await action.execute(context);
  } catch (error) {
    return {
      success: false,
      message: `Recovery action failed: ${error instanceof Error ? error.message : String(error)}`,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Generate resume options for user
 */
export async function generateResumeOptions(
  projectId: string,
  buildId: string,
  workspaceId?: string
): Promise<ResumeOptions | null> {
  const checkpoint = await getLatestCheckpoint(projectId);
  if (!checkpoint || checkpoint.completed === 1) {
    return null;
  }

  // Parse checkpoint data
  const checkpointData: CheckpointData = {
    projectId: checkpoint.projectId,
    iteration: checkpoint.iteration,
    completed: checkpoint.completed as 0 | 1,
    phase: (checkpoint.plan as any)?.phase || "planning",
    plan: checkpoint.plan as Record<string, unknown>,
    completedSteps: checkpoint.completedSteps as Array<Record<string, unknown>>,
    workingContext: checkpoint.workingContext as Record<string, unknown>,
    fileSnapshots: checkpoint.fileSnapshots as Record<string, string> | undefined,
    tokenUsage: checkpoint.tokenUsage as Record<string, unknown> | undefined,
    gitCommit: (checkpoint.plan as any)?.gitCommit,
    worktreePath: (checkpoint.plan as any)?.worktreePath,
    stepGroupIndex: (checkpoint.plan as any)?.stepGroupIndex,
  };

  // Check if there was a recent failure (would need to be stored)
  // For now, return generic options based on phase
  const phase = checkpointData.phase;
  const options = getPhaseResumeOptions(phase);

  return {
    checkpoint: checkpointData,
    options,
  };
}

/**
 * Get resume options for a specific phase
 */
function getPhaseResumeOptions(phase: CheckpointPhase): ResumeOptions["options"] {
  const baseOptions = [
    {
      id: "resume-from-checkpoint",
      label: "Resume from checkpoint",
      description: "Continue from the last saved checkpoint",
      action: "retry-step" as RecoveryActionType,
      automated: true,
      risk: "low" as const,
    },
    {
      id: "git-reset",
      label: "Git reset to checkpoint",
      description: "Hard reset to the git commit at checkpoint",
      action: "git-reset-hard" as RecoveryActionType,
      automated: true,
      risk: "medium" as const,
    },
    {
      id: "skip-step",
      label: "Skip failed step",
      description: "Skip the failing step and continue",
      action: "skip-step" as RecoveryActionType,
      automated: true,
      risk: "medium" as const,
    },
    {
      id: "abort",
      label: "Abort build",
      description: "Stop the build entirely",
      action: "abort" as RecoveryActionType,
      automated: true,
      risk: "low" as const,
    },
  ];

  // Phase-specific additions
  if (phase === "planning") {
    return baseOptions;
  }

  if (phase.startsWith("step-group")) {
    return [
      {
        id: "retry-step-group",
        label: "Retry step group",
        description: "Re-run the entire step group from the beginning",
        action: "retry-step" as RecoveryActionType,
        automated: true,
        risk: "low" as const,
      },
      ...baseOptions,
    ];
  }

  if (phase === "pre-verification" || phase === "verification") {
    return [
      {
        id: "retry-verification",
        label: "Retry verification",
        description: "Re-run verification gates",
        action: "retry-step" as RecoveryActionType,
        automated: true,
        risk: "low" as const,
      },
      {
        id: "skip-verification",
        label: "Skip verification (not recommended)",
        description: "Bypass verification and mark complete",
        action: "skip-step" as RecoveryActionType,
        automated: true,
        risk: "high" as const,
      },
      ...baseOptions,
    ];
  }

  return baseOptions;
}

/**
 * ============================================================
 * RECOVERY ACTION IMPLEMENTATIONS
 * ============================================================
 */

function createRetryStepAction(): RecoveryAction {
  return {
    type: "retry-step",
    label: "Retry Step",
    description: "Re-run the failed step with the same parameters",
    automated: true,
    async execute(context) {
      return {
        success: true,
        message: "Step will be retried on next build iteration",
        nextPhase: context.checkpoint.phase,
      };
    },
  };
}

function createRetryWithPnpmAction(): RecoveryAction {
  return {
    type: "retry-with-pnpm",
    label: "Retry with pnpm",
    description: "Clear node_modules and reinstall using pnpm",
    automated: true,
    async execute(context) {
      const { execa } = await import("execa");
      try {
        await execa("rm", ["-rf", "node_modules", "pnpm-lock.yaml"], {
          cwd: context.projectPath,
          reject: false,
        });
        await execa("pnpm", ["install"], {
          cwd: context.projectPath,
          reject: false,
          timeout: 300000,
        });
        return {
          success: true,
          message: "Reinstalled dependencies with pnpm",
          nextPhase: context.checkpoint.phase,
        };
      } catch (error) {
        return {
          success: false,
          message: `pnpm reinstall failed: ${error instanceof Error ? error.message : String(error)}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function createGitResetHardAction(): RecoveryAction {
  return {
    type: "git-reset-hard",
    label: "Git Reset Hard",
    description: "Hard reset to the checkpoint commit",
    automated: true,
    async execute(context) {
      const { execa } = await import("execa");
      const commit = context.checkpoint.gitCommit;

      if (!commit) {
        return {
          success: false,
          message: "No git commit recorded at checkpoint",
          error: "Missing git commit",
        };
      }

      try {
        await execa("git", ["reset", "--hard", commit], {
          cwd: context.projectPath,
          reject: false,
        });
        // Also clean untracked files
        await execa("git", ["clean", "-fd"], {
          cwd: context.projectPath,
          reject: false,
        });
        return {
          success: true,
          message: `Hard reset to commit ${commit.slice(0, 8)}`,
          nextPhase: context.checkpoint.phase,
        };
      } catch (error) {
        return {
          success: false,
          message: `Git reset failed: ${error instanceof Error ? error.message : String(error)}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function createWorkspaceRepairAction(): RecoveryAction {
  return {
    type: "workspace-repair",
    label: "Workspace Repair",
    description: "Run workspace repair: clean, reinstall, rebuild",
    automated: true,
    async execute(context) {
      const { execa } = await import("execa");
      try {
        // Clean
        await execa("git", ["clean", "-fd"], { cwd: context.projectPath, reject: false });
        await execa("rm", ["-rf", "node_modules", "dist", ".turbo"], { cwd: context.projectPath, reject: false });
        // Reinstall
        await execa("pnpm", ["install"], { cwd: context.projectPath, reject: false, timeout: 300000 });
        // Build
        await execa("pnpm", ["run", "build"], { cwd: context.projectPath, reject: false, timeout: 300000 });
        return {
          success: true,
          message: "Workspace repaired and rebuilt",
          nextPhase: context.checkpoint.phase,
        };
      } catch (error) {
        return {
          success: false,
          message: `Workspace repair failed: ${error instanceof Error ? error.message : String(error)}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function createClearNodeModulesAction(): RecoveryAction {
  return {
    type: "clear-node-modules",
    label: "Clear node_modules",
    description: "Remove node_modules and lockfiles, then reinstall",
    automated: true,
    async execute(context) {
      const { execa } = await import("execa");
      try {
        await execa("rm", ["-rf", "node_modules", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"], {
          cwd: context.projectPath,
          reject: false,
        });
        await execa("pnpm", ["install"], {
          cwd: context.projectPath,
          reject: false,
          timeout: 300000,
        });
        return {
          success: true,
          message: "Cleared node_modules and reinstalled",
          nextPhase: context.checkpoint.phase,
        };
      } catch (error) {
        return {
          success: false,
          message: `Clear node_modules failed: ${error instanceof Error ? error.message : String(error)}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function createFixLockfileAction(): RecoveryAction {
  return {
    type: "fix-lockfile",
    label: "Fix Lockfile",
    description: "Regenerate pnpm-lock.yaml from package.json",
    automated: true,
    async execute(context) {
      const { execa } = await import("execa");
      try {
        await execa("rm", ["-f", "pnpm-lock.yaml"], { cwd: context.projectPath, reject: false });
        await execa("pnpm", ["install"], {
          cwd: context.projectPath,
          reject: false,
          timeout: 300000,
        });
        return {
          success: true,
          message: "Regenerated lockfile",
          nextPhase: context.checkpoint.phase,
        };
      } catch (error) {
        return {
          success: false,
          message: `Fix lockfile failed: ${error instanceof Error ? error.message : String(error)}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function createReinstallDepsAction(): RecoveryAction {
  return {
    type: "reinstall-deps",
    label: "Reinstall Dependencies",
    description: "Full dependency reinstall with cache clear",
    automated: true,
    async execute(context) {
      const { execa } = await import("execa");
      try {
        await execa("pnpm", ["store", "prune"], { cwd: context.projectPath, reject: false });
        await execa("rm", ["-rf", "node_modules"], { cwd: context.projectPath, reject: false });
        await execa("pnpm", ["install"], {
          cwd: context.projectPath,
          reject: false,
          timeout: 300000,
        });
        return {
          success: true,
          message: "Dependencies reinstalled with clean cache",
          nextPhase: context.checkpoint.phase,
        };
      } catch (error) {
        return {
          success: false,
          message: `Reinstall failed: ${error instanceof Error ? error.message : String(error)}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function createRestartDevServerAction(): RecoveryAction {
  return {
    type: "restart-dev-server",
    label: "Restart Dev Server",
    description: "Kill and restart the development server",
    automated: true,
    async execute(context) {
      const { execa } = await import("execa");
      try {
        // Kill existing dev servers
        await execa("pkill", ["-f", "vite"], { reject: false });
        await execa("pkill", ["-f", "next"], { reject: false });
        await execa("pkill", ["-f", "webpack"], { reject: false });
        // Wait a moment
        await new Promise(r => setTimeout(r, 2000));
        return {
          success: true,
          message: "Dev server processes killed, will restart on next step",
          nextPhase: context.checkpoint.phase,
        };
      } catch (error) {
        return {
          success: false,
          message: `Restart dev server failed: ${error instanceof Error ? error.message : String(error)}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function createSkipStepAction(): RecoveryAction {
  return {
    type: "skip-step",
    label: "Skip Step",
    description: "Mark the failed step as skipped and continue",
    automated: true,
    async execute(context) {
      return {
        success: true,
        message: "Step marked as skipped, continuing to next phase",
        nextPhase: getNextPhase(context.checkpoint.phase),
      };
    },
  };
}

function createAbortAction(): RecoveryAction {
  return {
    type: "abort",
    label: "Abort Build",
    description: "Stop the build and mark as failed",
    automated: true,
    async execute(context) {
      return {
        success: true,
        message: "Build aborted by user",
        nextPhase: "completed",
      };
    },
  };
}

function createManualInterventionAction(): RecoveryAction {
  return {
    type: "manual-intervention",
    label: "Manual Intervention Required",
    description: "Pause build for human review",
    automated: false,
    async execute(context) {
      return {
        success: true,
        message: "Build paused for manual intervention",
        nextPhase: context.checkpoint.phase,
      };
    },
  };
}

/**
 * Get next phase after skipping
 */
function getNextPhase(currentPhase: CheckpointPhase): CheckpointPhase {
  const phaseOrder: CheckpointPhase[] = [
    "planning",
    "step-group-1",
    "step-group-2",
    "step-group-3",
    "step-group-4",
    "step-group-5",
    "pre-verification",
    "verification",
    "done-contract",
    "completed",
  ];

  const index = phaseOrder.indexOf(currentPhase);
  if (index >= 0 && index < phaseOrder.length - 1) {
    return phaseOrder[index + 1];
  }
  return "completed";
}

/**
 * ============================================================
 * WORKTREE SNAPSHOT (for git-first builds)
 * ============================================================
 */

/**
 * Save file snapshots for workspace recovery
 */
export async function saveFileSnapshots(
  projectId: string,
  projectPath: string,
  patterns: string[] = ["**/*", "!node_modules/**", "!dist/**", "!.git/**"]
): Promise<Record<string, string>> {
  const snapshots: Record<string, string> = {};

  // This is a simplified version - in production would use glob
  // For now, just return empty
  return snapshots;
}

/**
 * Restore file snapshots
 */
export async function restoreFileSnapshots(
  projectPath: string,
  snapshots: Record<string, string>
): Promise<void> {
  for (const [file, content] of Object.entries(snapshots)) {
    const filePath = path.join(projectPath, file);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }
}

export default {
  saveCheckpoint,
  getLatestCheckpoint,
  listCheckpoints,
  deleteCheckpoint,
  markCheckpointComplete,
  savePhaseCheckpoint,
  createPlanningCheckpoint,
  createStepGroupCheckpoint,
  createPreVerificationCheckpoint,
  createCompletionCheckpoint,
  classifyFailure,
  getRecoveryActions,
  executeRecovery,
  generateResumeOptions,
};