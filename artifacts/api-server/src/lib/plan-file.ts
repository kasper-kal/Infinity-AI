/**
 * Plan-to-repo — the build plan is a REAL FILE in the workspace git repo
 * (`PLAN.md`), not a memory object the loop can lose.
 *
 * Workflow (user-directed):
 *   all questions are asked BEFORE the build → a plan is prepared → the plan is
 *   saved as a file in the git repo → the build agent re-reads that plan anytime
 *   it wants. No mid-build questions, ever.
 *
 * Writing is best-effort everywhere: a plan file must never be the reason a
 * build fails. Every caller wraps this in the knowledge that `ok:false` means
 * "the repo couldn't be updated (no git, no write perm), but the build goes on."
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getWorkspaceRoot, runGit } from "./workspace";

export interface PlanFileStep {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  files?: string[];
  verifyOk?: boolean;
}

export interface PlanFileDecision {
  stepId: string;
  decision: string;
  files: string[];
}

export interface PlanFileGate {
  gate: string;
  ok: boolean;
  atIteration?: number;
  feedback?: string;
}

export interface PlanFileDoc {
  goal: string;
  answers: Record<string, string>;
  plan: { title: string; summary: string; files?: string[]; risks?: string[] };
  steps: PlanFileStep[];
  decisions?: PlanFileDecision[];
  gates?: PlanFileGate[];
  outcome: "running" | "done" | "failed" | "stopped";
  iterations?: number;
  tokenUsage?: { prompt: number; completion: number; total: number };
}

/** Render the markdown kept in the repo. Sections change as the build advances. */
export function renderPlanFile(doc: PlanFileDoc): string {
  const lines: string[] = [];
  lines.push(`# Build Plan — ${doc.plan.title}`);
  lines.push("");
  lines.push(`**Goal:** ${doc.goal}`);
  lines.push(`**Status:** ${doc.outcome}${doc.iterations != null ? ` · ${doc.iterations} iterations` : ""}`);
  lines.push("");
  lines.push(`_This file lives in the repo and is updated live as the build runs. The build agent reads it as ground truth._`);
  lines.push("");

  const answers = Object.entries(doc.answers);
  if (answers.length > 0) {
    lines.push("## Clarified up front (locked — no further questions are asked)");
    for (const [key, value] of answers) lines.push(`- **${key}:** ${value}`);
    lines.push("");
  }

  lines.push("## Plan");
  if (doc.plan.summary) lines.push(doc.plan.summary);
  lines.push("");

  lines.push("## Steps");
  for (const s of doc.steps) {
    const mark = s.status === "completed" ? "x" : s.status === "failed" ? "!" : s.status === "in_progress" ? "*" : s.status === "skipped" ? "-" : " ";
    const verify = s.verifyOk === undefined ? "" : s.verifyOk ? " ✓" : " ✗";
    const files = s.files && s.files.length > 0 ? ` — files: ${s.files.join(", ")}` : "";
    lines.push(`- [${mark}] ${s.id} — ${s.description}${verify}${files}`);
  }
  lines.push("");

  if (doc.plan.files && doc.plan.files.length > 0) {
    lines.push("## Files the plan may touch");
    for (const f of doc.plan.files) lines.push(`- ${f}`);
    lines.push("");
  }
  if (doc.plan.risks && doc.plan.risks.length > 0) {
    lines.push("## Risks called out at planning");
    for (const r of doc.plan.risks) lines.push(`- ${r}`);
    lines.push("");
  }

  if (doc.decisions && doc.decisions.length > 0) {
    lines.push("## Decisions made while building (audit trail)");
    for (const d of doc.decisions) {
      lines.push(`- **${d.stepId}:** ${d.decision || "(no recorded decision)"}${d.files.length ? ` — ${d.files.join(", ")}` : ""}`);
    }
    lines.push("");
  }

  if (doc.gates && doc.gates.length > 0) {
    lines.push("## Gates the build ran");
    for (const g of doc.gates) {
      const pre = g.atIteration != null ? ` (iter ${g.atIteration})` : "";
      lines.push(`- [${g.ok ? "x" : " "}] ${g.gate}${pre}${g.feedback ? ` — ${g.feedback.slice(0, 200)}` : ""}`);
    }
    lines.push("");
  }

  if (doc.tokenUsage && doc.tokenUsage.total > 0) {
    lines.push(`## Runtimes\n- tracked usage this run: ${doc.tokenUsage.total}`);
    lines.push("");
  }

  if (doc.outcome !== "running") {
    lines.push("## Verdict");
    lines.push(doc.outcome === "done"
      ? "Done — autonomously, no questions mid-build. Run it with the commands above the plan (see the README / manifest)."
      : doc.outcome === "failed"
        ? "Stopped — a step failed real verification. See the ✗ step(s) above."
        : "Stopped before completion.");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Write (or update) PLAN.md in the workspace and commit it. Best-effort:
 * a missing git repo or write error returns `ok:false` but never throws.
 */
export async function writePlanFile(
  workspaceId: string,
  doc: PlanFileDoc,
): Promise<{ ok: boolean; path: string; reason?: string }> {
  const root = getWorkspaceRoot(workspaceId);
  const rel = "PLAN.md";
  try {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, rel), renderPlanFile(doc), "utf8");
    await runGit(root, ["add", rel]);
    await runGit(root, ["commit", "-q", "-m", `plan: ${doc.outcome} — ${(doc.plan.title || "").slice(0, 60)}`]);
    return { ok: true, path: rel };
  } catch (err) {
    return { ok: false, path: rel, reason: err instanceof Error ? err.message : String(err) };
  }
}