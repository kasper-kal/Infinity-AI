/**
 * Phase 5 — Catastrophic Failure Recovery orchestrator.
 *
 * `lib/build-checkpoints.ts` already carried the rich (but previously UNWIRED)
 * recovery machinery — failure classifiers, recovery actions, executeRecovery,
 * phase-based checkpoints — with ZERO callers anywhere in the codebase. This
 * file is the orchestration layer the FIX plan called separately for
 * (`build-recovery.ts`). It:
 *
 *   1. classifies a real failure (error text / recent output)
 *   2. picks the FIRST automated, workspace-bounded recovery action
 *   3. EXECUTES it for real (the actions run real shell commands in the project)
 *   4. emits an honest `recovery` telemetry event
 *   5. answers whether the loop may safely retry the failed step
 *
 * It also adds the two pure detectors the Phase 5 gate table named explicitly:
 *   - detectMassiveRewrite        — git tree >50% changed → flag rollback-worthy
 *   - recoverCorruptedWorkspace   — .git gone → git re-init; marker gone → recreate
 *
 * Honest automation guard: recovery actions that touch host state OUTSIDE the
 * project (restart-dev-server runs `pkill -f vite|next|webpack` host-wide) are
 * never auto-executed — they are surfaced to the operator, never fired behind
 * their back. Everything else runs only inside `projectPath`.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  classifyFailure,
  getRecoveryActions,
  executeRecovery,
  type CheckpointData,
  type CheckpointPhase,
  type FailureClassification,
  type RecoveryActionType,
  type RecoveryResult,
} from "./build-checkpoints";
import { logBuildEvent } from "./build-telemetry";

/** Recovery actions that touch host-wide state (not just the project dir). */
const HOST_WIDE_ACTIONS = new Set<RecoveryActionType>(["restart-dev-server"]);

/** Whether an action is safe to automate without asking the operator. */
export function isAutomationSafe(action: RecoveryActionType): boolean {
  return !HOST_WIDE_ACTIONS.has(action);
}

export interface MassiveRewriteInfo {
  isMassive: boolean;
  totalFiles: number;
  changedFiles: number;
  ratio: number;
  reason?: string;
}

/**
 * Phase 5 gate: "Massive rewrite → diff shows >50% files changed → offer
 * rollback." Counts uncommitted changed files vs total tracked files.
 */
export async function detectMassiveRewrite(
  projectPath: string,
  threshold = 0.5,
): Promise<MassiveRewriteInfo> {
  try {
    const { execa } = await import("execa");
    const ls = await execa("git", ["ls-files"], { cwd: projectPath, reject: false });
    const total = ls.stdout ? ls.stdout.trim().split("\n").filter(Boolean).length : 0;
    if (total === 0) {
      return { isMassive: false, totalFiles: 0, changedFiles: 0, ratio: 0, reason: "no tracked files" };
    }
    const st = await execa("git", ["status", "--porcelain", "-uno"], { cwd: projectPath, reject: false });
    const changed = st.stdout ? st.stdout.trim().split("\n").filter((l) => l.trim().length > 0).length : 0;
    const ratio = changed / total;
    return {
      isMassive: ratio > threshold,
      totalFiles: total,
      changedFiles: changed,
      ratio,
      reason: `${changed}/${total} files changed`,
    };
  } catch (err) {
    return {
      isMassive: false,
      totalFiles: 0,
      changedFiles: 0,
      ratio: 0,
      reason: `git unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Phase 5 gate: "Corrupted files → git status + .infinity marker check →
 * git re-init + marker recreate." Re-creates a broken workspace shell: a git
 * repo (if .git vanished) + the .infinity/workspace.json marker (if gone).
 */
export async function recoverCorruptedWorkspace(
  projectPath: string,
  workspaceId: string,
): Promise<{ success: boolean; repairs: string[] }> {
  const repairs: string[] = [];
  try {
    const { execa } = await import("execa");

    const gitExists = await fs.stat(path.join(projectPath, ".git")).then(() => true).catch(() => false);
    if (!gitExists) {
      await execa("git", ["init", "-q", "."], { cwd: projectPath, reject: false });
      repairs.push("git re-init (.git was missing)");
    }

    const markerDir = path.join(projectPath, ".infinity");
    const markerPath = path.join(markerDir, "workspace.json");
    const markerExists = await fs.readFile(markerPath, "utf8").then(() => true).catch(() => false);
    if (!markerExists) {
      await fs.mkdir(markerDir, { recursive: true });
      await fs.writeFile(markerPath, JSON.stringify({
        workspaceId,
        createdAt: new Date().toISOString(),
        version: 1,
      }, null, 2), "utf8");
      repairs.push(".infinity/workspace.json marker recreated");
    }

    return { success: true, repairs };
  } catch (err) {
    return {
      success: false,
      repairs,
      ...(err instanceof Error ? { error: err.message } : {}),
    } as { success: boolean; repairs: string[] } & Record<string, unknown>;
  }
}

export interface RecoveryAttemptOptions {
  projectId: string;
  workspaceId: string;
  /** Absolute project path — ALL recovery commands are bounded to this dir. */
  projectPath: string;
  error: Error | string;
  /** Verification feedback / recent output — richer signals than the error alone. */
  recentOutput?: string;
  phase?: CheckpointPhase;
  checkpoint?: CheckpointData | null;
  /** Only the workspace-bounded, automated actions run; host-wide ones never do. */
  maxAutoActions?: number;
  /** Recovery actions actually executed, for callers that want to log them. */
}

export interface RecoveryAttemptResult {
  recovered: boolean;
  classification: FailureClassification;
  action: RecoveryActionType | null;
  result: RecoveryResult | null;
  /** Whether the build loop may safely retry the failed step. */
  retry: boolean;
  /** Host-wide actions that were classified but NOT auto-executed. */
  deferred: RecoveryActionType[];
}

/**
 * Recover from a build failure: classify → auto-execute the first automated,
 * workspace-bounded action → emit `recovery` telemetry → answer "retry?".
 *
 * Bounded by design: at most `maxAutoActions` (default 1) recovery commands run,
 * all confined to `projectPath`, and host-wide actions are always deferred.
 */
export async function recoverFromFailure(
  opts: RecoveryAttemptOptions,
): Promise<RecoveryAttemptResult> {
  const { projectId, workspaceId, projectPath, error, recentOutput, phase } = opts;
  const classification = await classifyFailure(error, {
    projectPath,
    phase: phase || "planning",
    recentOutput: recentOutput || (error instanceof Error ? error.message : error),
  });

  const deferred: RecoveryActionType[] = [];
  const maxAuto = opts.maxAutoActions ?? 1;
  let executed = 0;

  // getRecoveryActions returns the ordered actions for this class; walk them so
  // the FIRST actionable one wins (same priority the classifier suggested).
  const actions = getRecoveryActions(classification.class);
  for (const action of actions) {
    if (executed >= maxAuto) break;
    if (!action.automated) continue;
    if (!isAutomationSafe(action.type)) {
      deferred.push(action.type);
      continue;
    }
    executed += 1;
    const start = Date.now();
    const result = await executeRecovery(action.type, {
      projectId,
      workspaceId,
      projectPath,
      checkpoint: opts.checkpoint || {
        projectId,
        iteration: 1,
        completed: 0,
        phase: phase || "planning",
        plan: {},
        completedSteps: [],
        workingContext: {},
      },
      failure: classification,
      buildId: `${projectId}:${Date.now()}`,
    });
    await logBuildEvent(projectId, "recovery", `${action.label}: ${result.success ? "OK" : "failed"}`, {
      data: {
        failureClass: classification.class,
        confidence: classification.confidence,
        action: action.type,
        success: result.success,
        message: result.message,
        indicators: classification.indicators,
      },
      durationMs: Date.now() - start,
    });

    if (result.success) {
      return {
        recovered: true,
        classification,
        action: action.type,
        result,
        retry: true,
        deferred,
      };
    }
  }

  return {
    recovered: false,
    classification,
    action: null,
    result: null,
    retry: false,
    deferred,
  };
}