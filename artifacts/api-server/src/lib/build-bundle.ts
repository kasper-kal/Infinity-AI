/**
 * BUILD BUNDLE-SIZE GATE — real measurement, no stubs.
 *
 * Phase 1: previously `bundle-size` returned not-enforced ("not implemented").
 * Now it measures the ACTUAL production bundle of the built app (dist/build/out)
 * and enforces honest byte budgets. Budgets are generous safety nets — they
 * catch a "bundled three frameworks" disaster, not a legitimately large app —
 * and the real numbers are always reported, so the verdict is transparent.
 *
 * Honesty contract:
 *   - no web output (no dist/.../index.html) → report null → gate skips
 *     ("not applicable — no web bundle to measure"), never a forged pass/fail
 *   - budget exceeded → failed with the largest files listed
 *   - within budget → passed with the actual total
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

const OUTPUT_DIRS = ["dist", "build", "out"];

export interface BundleFile {
  path: string; // relative to output dir
  bytes: number;
  kind: "js" | "css";
}

export interface BundleSizeReport {
  /** The output dir measured, or null when this is not a web build. */
  outputDir: string | null;
  totalJsBytes: number;
  totalCssBytes: number;
  files: BundleFile[];
  largestJs: BundleFile | null;
}

/** Byte budgets (safety nets). Values are raw (uncompressed) bytes. */
export const BUNDLE_BUDGETS = {
  /** Total JS across all chunks — 4 MiB catches an absurd bundle. */
  totalJsBytes: 4096 * 1024,
  /** Single largest chunk — 2 MiB catches one pathological file. */
  largestJsBytes: 2048 * 1024,
} as const;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

/** True when the given dir looks like a build output root (has index.html). */
async function isOutputDir(dir: string): Promise<boolean> {
  return fs
    .access(path.join(dir, "index.html"))
    .then(() => true)
    .catch(() => false);
}

async function findOutputDir(projectPath: string): Promise<string | null> {
  for (const dir of OUTPUT_DIRS) {
    const candidate = path.join(projectPath, dir);
    if (await isOutputDir(candidate)) return candidate;
  }
  // Simple static sites keep index.html at the project root.
  if (await isOutputDir(projectPath)) return projectPath;
  return null;
}

async function walk(dir: string, out: BundleFile[], base: string, depth: number): Promise<void> {
  if (depth > 8) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(base, full);
    if (ent.isDirectory()) {
      // Never descend into these — they are not part of the shipped bundle.
      if (["node_modules", ".git", ".cache", "coverage"].includes(ent.name)) continue;
      // Maps are noise; skip "assets/fonts" huge binaries which the JS budget
      // is not about — but still count .css (render-critical for LCP).
      await walk(full, out, base, depth + 1);
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      if (ext === ".js" || ext === ".css") {
        let stat: { size: number };
        try {
          stat = await fs.stat(full);
        } catch {
          continue;
        }
        out.push({ path: rel, bytes: stat.size, kind: ext === ".css" ? "css" : "js" });
      }
    }
  }
}

/**
 * Measure the built web bundle. Returns outputDir: null for non-web projects
 * (CLI/library/no build) so callers can honestly skip.
 */
export async function measureBundleSize(projectPath: string): Promise<BundleSizeReport> {
  const outputDir = await findOutputDir(projectPath);
  if (!outputDir) {
    return { outputDir: null, totalJsBytes: 0, totalCssBytes: 0, files: [], largestJs: null };
  }
  const files: BundleFile[] = [];
  await walk(outputDir, files, outputDir, 0);
  files.sort((a, b) => b.bytes - a.bytes);
  const js = files.filter((f) => f.kind === "js");
  const css = files.filter((f) => f.kind === "css");
  return {
    outputDir,
    totalJsBytes: js.reduce((sum, f) => sum + f.bytes, 0),
    totalCssBytes: css.reduce((sum, f) => sum + f.bytes, 0),
    files,
    largestJs: js[0] ?? null,
  };
}

/**
 * Verdict a bundle-size gate result from a measurement. Structurally matches
 * the done-contract `VerificationGateResult` (type-imported at the call site).
 */
export interface BundleGateVerdict {
  gate: string;
  passed: boolean;
  details: string;
  severity: "minor";
  status: "passed" | "failed" | "skipped";
  evidence?: Record<string, unknown>;
}

export function verdictBundle(report: BundleSizeReport): BundleGateVerdict {
  if (!report.outputDir) {
    return {
      gate: "bundle-size",
      passed: true,
      severity: "minor",
      status: "skipped",
      details: "Skipped (not applicable) — no built web bundle (no dist/build/out with index.html) to measure.",
      evidence: { outputDir: null },
    };
  }
  const overTotal = report.totalJsBytes - BUNDLE_BUDGETS.totalJsBytes;
  const overLargest = report.largestJs ? report.largestJs.bytes - BUNDLE_BUDGETS.largestJsBytes : 0;
  const failures: string[] = [];
  if (overTotal > 0) failures.push(`total JS ${formatBytes(report.totalJsBytes)} exceeds ${formatBytes(BUNDLE_BUDGETS.totalJsBytes)}`);
  if (overLargest > 0 && report.largestJs) {
    failures.push(`${report.largestJs.path} single chunk ${formatBytes(report.largestJs.bytes)} exceeds ${formatBytes(BUNDLE_BUDGETS.largestJsBytes)}`);
  }
  const topFiles = report.files.slice(0, 3).map((f) => `${f.path} (${formatBytes(f.bytes)})`);
  if (failures.length > 0) {
    return {
      gate: "bundle-size",
      passed: false,
      severity: "minor",
      status: "failed",
      details: `Bundle budget exceeded: ${failures.join("; ")}. Largest files: ${topFiles.join(", ")}.`,
      evidence: {
        totalJsBytes: report.totalJsBytes,
        totalCssBytes: report.totalCssBytes,
        fileCount: report.files.length,
        largestJs: report.largestJs ? { path: report.largestJs.path, bytes: report.largestJs.bytes } : null,
      },
    };
  }
  return {
    gate: "bundle-size",
    passed: true,
    severity: "minor",
    status: "passed",
    details: `Bundle within budget: ${report.files.length} asset(s), total JS ${formatBytes(report.totalJsBytes)}, CSS ${formatBytes(report.totalCssBytes)}. Largest: ${report.largestJs ? `${report.largestJs.path} (${formatBytes(report.largestJs.bytes)})` : "none"}.`,
    evidence: {
      totalJsBytes: report.totalJsBytes,
      totalCssBytes: report.totalCssBytes,
      fileCount: report.files.length,
      largestJs: report.largestJs ? { path: report.largestJs.path, bytes: report.largestJs.bytes } : null,
      budgets: BUNDLE_BUDGETS,
    },
  };
}