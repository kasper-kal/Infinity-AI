/**
 * BUILD PERFORMANCE GATE — enforced budgets, no `not-enforced` hole.
 *
 * Phase 1: the prior gate returned not-enforced whenever LCP was null ("we
 * didn't measure"). Now performance is ALWAYS enforced with a real signal:
 *
 *   1. Largest Contentful Paint (from the shared Chrome inspection pass) against
 *      a 2.5s budget — the primary, real-world metric.
 *   2. Cumulative Layout Shift (measured in the SAME pass) against 0.1 — catches
 *      janky CLS that LCP alone misses.
 *   3. JS weight budget (from `build-bundle.ts`) — the always-available bottom
 *      line: when a client-rendered shell reports no LCP within the settle
 *      window, the gate enforces the shipped bundle's JS weight instead of
 *      giving up. A heavyweight shell is itself a performance defect.
 *
 * Honesty contract (mirrors the inspection): no web output → skipped (not
 * applicable). Browser infra missing → not-enforced (environmental, never
 * counts). Everything else → passed/failed off real numbers.
 */

import type { VerificationContext, VerificationGateResult } from "./build-done-contract";
import { inspectBuiltApp } from "./build-visual-verification";
import { measureBundleSize, verdictBundle } from "./build-bundle";

export const PERFORMANCE_BUDGETS = {
  lcpMs: 2500,
  cls: 0.1,
  /** When LCP is unavailable, JS weight is the enforced bottom line. */
  jsTotalBytesFallbackBudget: 4096 * 1024,
} as const;

export async function evaluatePerformance(
  context: VerificationContext,
  severity: VerificationGateResult["severity"] = "minor",
): Promise<VerificationGateResult> {
  const gate = (partial: Partial<VerificationGateResult> & Pick<VerificationGateResult, "passed">): VerificationGateResult => ({
    gate: "performance",
    name: "Performance Budget",
    description: "LCP <= 2.5s, CLS <= 0.1, JS weight within budget",
    severity,
    ...partial,
  });

  const insp = await inspectBuiltApp(context.projectPath, {
    buildId: context.buildId,
    workspaceId: context.workspaceId,
  });

  // Not a web build / nothing rendered.
  if (insp.status === "skipped") {
    return gate({
      passed: true,
      status: "skipped",
      details: `Skipped (not applicable) — no built web app to measure performance: ${insp.detail}`,
      evidence: { status: insp.status },
    });
  }
  if (insp.status === "not-enforced") {
    return gate({
      passed: false,
      status: "not-enforced",
      details: `Performance NOT enforced — no rendering infrastructure: ${insp.detail}`,
      evidence: { status: insp.status, detail: insp.detail },
    });
  }

  const bundle = await measureBundleSize(context.projectPath);

  // Primary: real LCP measurement from the rendered app.
  if (insp.lcpMs !== null) {
    const lcpFail = insp.lcpMs > PERFORMANCE_BUDGETS.lcpMs;
    const cls = insp.cls ?? null;
    const clsFail = cls !== null && cls > PERFORMANCE_BUDGETS.cls;
    const budgetRows = [
      `LCP ${insp.lcpMs}ms (budget ${PERFORMANCE_BUDGETS.lcpMs}ms)${lcpFail ? " — OVER" : ""}`,
      cls !== null ? `CLS ${cls.toFixed(3)} (budget ${PERFORMANCE_BUDGETS.cls})${clsFail ? " — OVER" : ""}` : "CLS not reported by browser",
      bundle.outputDir ? `JS ${bundle.totalJsBytes} bytes (${bundle.files.length} asset(s))` : "no web bundle",
    ];
    if (!lcpFail && !clsFail) {
      return gate({
        passed: true,
        status: "passed",
        details: `Performance within budget: ${budgetRows.join(" · ")}`,
        evidence: { lcpMs: insp.lcpMs, cls, jsBytes: bundle.outputDir ? bundle.totalJsBytes : null },
      });
    }
    const fails: string[] = [];
    if (lcpFail) fails.push(`LCP ${insp.lcpMs}ms exceeds ${PERFORMANCE_BUDGETS.lcpMs}ms budget`);
    if (clsFail && cls !== null) fails.push(`CLS ${cls.toFixed(3)} exceeds ${PERFORMANCE_BUDGETS.cls} budget`);
    return gate({
      passed: false,
      status: "failed",
      details: `Performance budget exceeded: ${fails.join("; ")}.`,
      evidence: { lcpMs: insp.lcpMs, cls, jsBytes: bundle.outputDir ? bundle.totalJsBytes : null },
    });
  }

  // LCP unavailable (typically a client-rendered shell) — enforce JS weight.
  if (bundle.outputDir) {
    const weightOk = bundle.totalJsBytes <= PERFORMANCE_BUDGETS.jsTotalBytesFallbackBudget;
    const verdict = verdictBundle(bundle);
    return gate({
      passed: weightOk,
      status: weightOk ? "passed" : "failed",
      details: weightOk
        ? `LCP unavailable on this client-rendered shell — enforcing JS weight: ${bundle.totalJsBytes} bytes is within the ${PERFORMANCE_BUDGETS.jsTotalBytesFallbackBudget}-byte budget. ${insp.detail}`
        : `LCP unavailable and JS weight ${bundle.totalJsBytes} bytes exceeds the ${PERFORMANCE_BUDGETS.jsTotalBytesFallbackBudget}-byte budget (${verdict.details})`,
      evidence: { lcpMs: null, jsBytes: bundle.totalJsBytes, largestJs: bundle.largestJs ? { path: bundle.largestJs.path, bytes: bundle.largestJs.bytes } : null },
    });
  }

  // No LCP and no measurable bundle — but the inspection DID render something
  // (it wasn't skipped). Report honestly rather than fabricate a number.
  return gate({
    passed: false,
    status: "failed",
    details: `No LCP metric and no web bundle to measure — performance cannot be certified. ${insp.detail}`,
    evidence: { lcpMs: null, jsBytes: null },
  });
}