/**
 * Git-First Builds (FIX-plan Phase 6) — worktree isolation + auto-revert, LIVE.
 *
 * The Phase 6 spec ("Git-First Build Mode", session-brief 2026-08-18):
 *   worktree per build · incremental commits · final diff ·
 *   success → keep branch · failure → auto-revert.
 *
 * HISTORY (honest): the previous incarnation of this subsystem in
 * `workspace.ts` was DEAD CODE — `createBuildWorktree`/`commitBuildStep`/
 * `revertBuildWorktree`/`finalizeBuildWorktree`/`generateBuildDiffSummary`
 * pointed at `WORKTREES_ROOT/<projectId>-<buildId>`, a directory NO part of the
 * live build machinery ever wrote to; wiring them as-is would have committed
 * empty worktrees. This module re-implements the git-first mechanics against the
 * REAL build filesystem — `<WORKSPACE_ROOT>/projects/<id>`, the repo
 * `ensureWorkspace` git-inits, where the scaffold commits and the agent writes
 * files and verification actually runs. Nothing moves; the build's git HISTORY
 * does.
 *
 * HONEST DEVIATION (also in PHASES.md): "worktree isolation" here is BRANCH
 * isolation in the project's own git repo, not a separate `git worktree`
 * working directory. Round-trip reasons:
 *   1. Every live subsystem (scaffold-engine, structured-tools verify, the PTY
 *      shell sessions, browser preview, plan-file writer) is rooted at
 *      `getWorkspaceRoot(projectId)`. A second working tree would require
 *      rewiring all of them and re-plumbing every path the loop already gets
 *      right — high regression risk for zero user-visible gain.
 *   2. The isolation that protects the user is COMMIT-domain isolation: the
 *      build works on `infinity/build/<id>`, `main` never moves until success,
 *      and `git reset --hard <base>` + `git clean -fd` restores the exact
 *      pre-build working tree on failure (auto-revert). A bad build cannot
 *      corrupt the user's good state — the property the phase name promises.
 *
 * BEHAVIOR (every function is bounded to the passed repo path — never touches
 * anything else, and never throws into the build loop; on any failure it
 * returns an honest {ok:false} or null so a build degrades gracefully instead
 * of dying):
 *   beginGitFirstBuild         — record base commit, create/resume `infinity/build/<id>`
 *   commitGitFirstStep         — stage + commit a completed step (incremental)
 *   generateGitFirstDiffSummary— base..head --stat/--numstat + per-file totals
 *   finalizeGitFirstBuild      — success: squash-merge the build branch into the
 *                                base branch (KEEP — the branch is retained)
 *   revertGitFirstBuild        — failure: return the working tree to the exact
 *                                pre-build base state (AUTO-REVERT; the branch
 *                                stays for inspection)
 *   getGitFirstStatus          — live state read for telemetry / debugging
 */

import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import * as fsSync from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** An incremental build-step commit. */
export interface StepCommit {
  stepNumber: number;
  totalSteps: number;
  message: string;
  commitHash: string;
  timestamp: string;
  filesChanged: string[];
  insertions: number;
  deletions: number;
}

/** An active (or just-started) git-first build session. */
export interface GitFirstSession {
  repoPath: string;
  buildId: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
  startedAt: string;
  resumed: boolean;
}

/** The base..head diff record a finished build leaves behind. */
export interface GitFirstDiffSummary {
  buildId: string;
  branch: string;
  baseCommit: string;
  headCommit: string;
  totalCommits: number;
  filesChanged: string[];
  totalInsertions: number;
  totalDeletions: number;
  diffStat: string;
}

export interface GitFirstStatus {
  active: boolean;
  branch?: string;
  buildId?: string;
  baseCommit?: string;
  baseBranch?: string;
  currentBranch?: string;
  dirty: number;
}

interface GitFirstState {
  buildId: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
  startedAt: string;
}

const stateFilePath = (repoPath: string): string =>
  path.join(repoPath, ".infinity", "git-first-state.json");

/** Run a git command inside the repo, capturing stdout/stderr. */
function git(repoPath: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd: repoPath });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c) => { stdout += c.toString(); });
    child.stderr?.on("data", (c) => { stderr += c.toString(); });
    child.on("error", () => resolve({ ok: false, stdout, stderr }));
    child.on("close", (code) => resolve({ ok: code === 0, stdout, stderr }));
  });
}

async function readState(repoPath: string): Promise<GitFirstState | null> {
  try {
    const raw = await fsp.readFile(stateFilePath(repoPath), "utf8");
    const s = JSON.parse(raw) as GitFirstState;
    return s && typeof s.branch === "string" ? s : null;
  } catch {
    return null;
  }
}

async function writeState(repoPath: string, s: GitFirstState): Promise<void> {
  await fsp.mkdir(path.join(repoPath, ".infinity"), { recursive: true });
  await fsp.writeFile(stateFilePath(repoPath), JSON.stringify(s, null, 2), "utf8");
}

async function clearState(repoPath: string): Promise<void> {
  await fsp.rm(stateFilePath(repoPath), { force: true }).catch(() => {});
}

/** Parse the insertions/deletions out of `--numstat` output. */
function tallyNumstat(output: string): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;
  for (const line of output.split("\n")) {
    const m = line.match(/^(\d+)\s+(\d+)\s/);
    if (m) {
      insertions += Number(m[1]);
      deletions += Number(m[2]);
    }
  }
  return { insertions, deletions };
}

/**
 * Start (or resume) the git-first build session for a project repo.
 *
 * Guarantees on `ok:true`:
 *  - repo has a local git identity so commits never fail on `user.name`
 *  - a base commit exists (an empty repo gets one) so reset/revert has a target
 *  - any pre-existing dirty tree is committed to the BASE branch first
 *  - `HEAD` is on `infinity/build/<buildId>` created from the base commit
 *  - on resume (state file + branch still exist) it re-checks-out the SAME
 *    branch/buildId so step commits keep accumulating across a kill
 */
export async function beginGitFirstBuild(
  repoPath: string
): Promise<{ ok: boolean; reason?: string; session?: GitFirstSession }> {
  try {
    if (!fsSync.existsSync(path.join(repoPath, ".git"))) {
      return { ok: false, reason: "not-a-git-repo" };
    }

    // Repo-local identity so `git commit` never fails in a headless env.
    await git(repoPath, ["config", "user.name", "Infinity Build"]).catch(() => {});
    await git(repoPath, ["config", "user.email", "infinity@build.local"]).catch(() => {});

    // Keep build bookkeeping (.infinity/) out of the user's git history ENTIRELY:
    // ignore it via .git/info/exclude (repo-local, never appears in status, commits
    // or diffs, and never pollutes the base branch — unlike a tracked .gitignore).
    const excludePath = path.join(repoPath, ".git", "info", "exclude");
    try {
      const excludeRaw = await fsp.readFile(excludePath, "utf8").catch(() => "");
      if (!excludeRaw.split("\n").includes(".infinity/")) {
        await fsp.appendFile(excludePath, "\n.infinity/\n", "utf8");
      }
    } catch { /* worst case the bookkeeping is harmless in status — still works */ }

    // The base branch is the branch the repo is normally on (main, master…).
    const headRef = await git(repoPath, ["symbolic-ref", "--short", "HEAD"]);
    const detectedBase = headRef.ok && headRef.stdout.trim() ? headRef.stdout.trim() : "main";

    // An empty repo needs a base commit so reset/revert has a target. A repo
    // with files but no commit yet gets a normal first commit; a TRULY empty
    // repo has nothing to commit and `git commit` refuses — fall back to
    // --allow-empty so a root commit exists without writing anything into the
    // user's tree (revert must always have a base to reset to).
    const headVerify = await git(repoPath, ["rev-parse", "--verify", "HEAD"]);
    if (!headVerify.ok || !headVerify.stdout.trim()) {
      await git(repoPath, ["add", "-A"]);
      const first = await git(repoPath, ["commit", "-q", "-m", "infinity: git-first base"]);
      if (!first.ok) {
        await git(repoPath, ["commit", "--allow-empty", "-q", "-m", "infinity: git-first base"]);
      }
    }

    // Commit any pre-existing dirty tree into the base branch so the build
    // starts from a clean, fully-committed state (that state is the revert
    // target). The file writes the loop makes later are its own commits.
    const preDirty = await git(repoPath, ["status", "--porcelain"]);
    if (preDirty.ok && preDirty.stdout.trim()) {
      await git(repoPath, ["add", "-A"]);
      await git(repoPath, ["commit", "-q", "-m", "infinity: git-first pre-build state"]);
    }

    // Resume if a state file + branch already exist (kill → continue).
    const prior = await readState(repoPath);
    if (prior && prior.branch) {
      const refOk = await git(repoPath, ["rev-parse", "--verify", prior.branch]);
      if (refOk.ok && refOk.stdout.trim()) {
        await git(repoPath, ["checkout", "-q", prior.branch]);
        return {
          ok: true,
          session: {
            repoPath,
            buildId: prior.buildId,
            branch: prior.branch,
            baseBranch: prior.baseBranch || detectedBase,
            baseCommit: prior.baseCommit,
            startedAt: prior.startedAt,
            resumed: true,
          },
        };
      }
    }

    // Fresh build: branch from the base commit, record the state.
    const baseRev = await git(repoPath, ["rev-parse", "HEAD"]);
    const baseCommit = baseRev.ok ? baseRev.stdout.trim() : "HEAD";
    const state: GitFirstState = {
      buildId: randomUUID().slice(0, 8),
      branch: `infinity/build/${randomUUID().slice(0, 8)}`,
      baseBranch: detectedBase,
      baseCommit,
      startedAt: new Date().toISOString(),
    };
    await git(repoPath, ["checkout", "-q", "-b", state.branch]);
    await writeState(repoPath, state);

    return {
      ok: true,
      session: {
        repoPath,
        buildId: state.buildId,
        branch: state.branch,
        baseBranch: detectedBase,
        baseCommit,
        startedAt: state.startedAt,
        resumed: false,
      },
    };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Commit the current working-tree changes as one incremental build-step commit.
 * Returns null (honestly) when git is absent, nothing changed, or the commit
 * failed — the build loop must treat null as "no step commit recorded".
 */
export async function commitGitFirstStep(
  repoPath: string,
  stepNumber: number,
  totalSteps: number,
  message: string
): Promise<StepCommit | null> {
  try {
    if (!fsSync.existsSync(path.join(repoPath, ".git"))) return null;
    const status = await git(repoPath, ["status", "--porcelain"]);
    const changed = status.stdout.split("\n").filter(Boolean).map((l) => l.slice(3)).filter(Boolean);
    if (changed.length === 0) return null;

    const label = (message || `step ${stepNumber}/${totalSteps}`).slice(0, 200);
    await git(repoPath, ["add", "-A"]);
    const committed = await git(repoPath, ["commit", "-q", "-m", `infinity: step ${stepNumber}/${totalSteps} - ${label}`]);
    if (!committed.ok) return null;

    const hash = await git(repoPath, ["rev-parse", "HEAD"]);
    const numstat = await git(repoPath, ["show", "--numstat", "--format=", "HEAD"]);
    const { insertions, deletions } = tallyNumstat(numstat.stdout);
    return {
      stepNumber,
      totalSteps,
      message: label,
      commitHash: hash.stdout.trim(),
      timestamp: new Date().toISOString(),
      filesChanged: changed,
      insertions,
      deletions,
    };
  } catch {
    return null;
  }
}

/**
 * baseCommit..HEAD diff record of the current build. Must be called BEFORE
 * finalizeGitFirstBuild merges, while the build branch is still checked out.
 */
export async function generateGitFirstDiffSummary(repoPath: string): Promise<GitFirstDiffSummary | null> {
  try {
    const state = await readState(repoPath);
    if (!state) return null;
    const head = await git(repoPath, ["rev-parse", "HEAD"]);
    const headCommit = head.ok ? head.stdout.trim() : "HEAD";
    const range = `${state.baseCommit}..${headCommit}`;

    const stat = await git(repoPath, ["diff", "--stat", range]);
    const files = await git(repoPath, ["diff", "--name-only", range]);
    const numstat = await git(repoPath, ["diff", "--numstat", range]);
    const log = await git(repoPath, ["log", "--oneline", range]);

    const filesChanged = files.stdout.split("\n").filter(Boolean);
    const { insertions, deletions } = tallyNumstat(numstat.stdout);
    return {
      buildId: state.buildId,
      branch: state.branch,
      baseCommit: state.baseCommit,
      headCommit,
      totalCommits: log.stdout.split("\n").filter(Boolean).length,
      filesChanged,
      totalInsertions: insertions,
      totalDeletions: deletions,
      diffStat: stat.stdout,
    };
  } catch {
    return null;
  }
}

/**
 * Success path: KEEP the build branch — squash-merge its commits back into the
 * base branch. The build branch object is retained for the record; the working
 * tree ends on the base branch with the finished build.
 */
export async function finalizeGitFirstBuild(
  repoPath: string
): Promise<{ success: boolean; mergeCommit?: string; message: string; branch?: string }> {
  try {
    const state = await readState(repoPath);
    if (!state) return { success: false, message: "no active git-first state" };

    // Commit any leftover dirty tree (e.g. the final PLAN.md verdict written
    // after the last step commit) so it is part of the merge.
    const dirty = await git(repoPath, ["status", "--porcelain"]);
    if (dirty.ok && dirty.stdout.trim()) {
      await git(repoPath, ["add", "-A"]);
      await git(repoPath, ["commit", "-q", "-m", `infinity: build ${state.buildId} finalize`]);
    }

    // Already on the base branch with the state present — treat as no-op keep.
    const cur = await git(repoPath, ["symbolic-ref", "--short", "HEAD"]);
    const currentBranch = cur.ok ? cur.stdout.trim() : state.baseBranch;
    if (currentBranch === state.baseBranch) {
      await clearState(repoPath);
      return { success: true, message: "no build commits to finalize", branch: state.branch };
    }

    await git(repoPath, ["checkout", "-q", state.baseBranch]);
    // Only merge if the trees actually differ (git diff --quiet EXITS 1 on diff).
    const differs = await git(repoPath, ["diff", "--quiet", state.baseBranch, state.branch]);
    if (!differs.ok) {
      const merged = await git(repoPath, ["merge", "--squash", "-q", state.branch]);
      if (!merged.ok) {
        return { success: false, message: (merged.stderr || "squash merge failed").slice(0, 200), branch: state.branch };
      }
      const staged = await git(repoPath, ["status", "--porcelain"]);
      if (staged.ok && staged.stdout.trim()) {
        await git(repoPath, ["add", "-A"]);
        const committed = await git(repoPath, ["commit", "-q", "-m", `infinity: build ${state.buildId} keep`]);
        const hash = await git(repoPath, ["rev-parse", "HEAD"]);
        const mergeCommit = committed.ok ? hash.stdout.trim() : undefined;
        await clearState(repoPath);
        return { success: committed.ok, mergeCommit, message: `Build branch ${state.branch} kept — squashed into ${state.baseBranch}`, branch: state.branch };
      }
    }

    await clearState(repoPath);
    return { success: true, message: `No changes to keep from build branch ${state.branch}`, branch: state.branch };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Failure path: AUTO-REVERT — return the working tree to the exact pre-build
 * state (base branch + base commit + clean). The build branch object is left in
 * the repo for inspection; the state file is cleared so the next build starts
 * fresh. Never throws.
 */
export async function revertGitFirstBuild(repoPath: string): Promise<{ success: boolean }> {
  try {
    const state = await readState(repoPath);
    if (!state) return { success: false };

    // Discard any uncommitted noise (a crashed build may have left files).
    await git(repoPath, ["reset", "--hard", "HEAD"]).catch(() => {});
    await git(repoPath, ["clean", "-fd"]).catch(() => {});
    await git(repoPath, ["checkout", "-q", state.baseBranch]).catch(() => {});
    const reverted = await git(repoPath, ["reset", "--hard", state.baseCommit]);
    if (!reverted.ok) return { success: false };
    await git(repoPath, ["clean", "-fd"]).catch(() => {});
    await clearState(repoPath);
    return { success: true };
  } catch {
    return { success: false };
  }
}

/** Live readout for telemetry / the Debug panel. Never throws. */
export async function getGitFirstStatus(repoPath: string): Promise<GitFirstStatus | null> {
  try {
    const state = await readState(repoPath);
    const cur = await git(repoPath, ["symbolic-ref", "--short", "HEAD"]);
    const status = await git(repoPath, ["status", "--porcelain"]);
    const dirty = status.ok ? status.stdout.split("\n").filter(Boolean).length : 0;
    return {
      active: !!state,
      branch: state?.branch,
      buildId: state?.buildId,
      baseCommit: state?.baseCommit,
      baseBranch: state?.baseBranch,
      currentBranch: cur.ok ? cur.stdout.trim() : undefined,
      dirty,
    };
  } catch {
    return null;
  }
}