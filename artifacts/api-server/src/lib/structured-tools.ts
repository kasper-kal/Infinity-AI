import { execFile, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import * as fsSync from "node:fs";
import path from "node:path";
import { createIsolated, getWorkspaceRoot, getWorkspaceCommandEnvironment } from "./workspace";

/**
 * Phase 2.1 + 2.2 — Structured Tool Results & Diff Preview
 *
 * This module provides:
 * 1. Diff generation (unified diff between old/new content)
 * 2. Structured tool execution with parsed results (tsc, vitest, eslint, build)
 * 3. Verification loop that runs all checks and feeds failures back to the model
 */

export interface StructuredToolResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  parsed: {
    typeErrors: TypeScriptError[];
    testResults: TestResult[];
    lintIssues: LintIssue[];
    buildArtifacts: BuildArtifact[];
    browserLogs: BrowserLogEntry[];
  };
}

export interface TypeScriptError {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface TestResult {
  framework: string;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration: number;
  output: string;
  failures: TestFailure[];
}

export interface TestFailure {
  name: string;
  message: string;
  stack?: string;
  file?: string;
  line?: number;
}

export interface LintIssue {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  rule: string;
  message: string;
}

export interface BuildArtifact {
  path: string;
  size: number;
  type: "js" | "css" | "html" | "map" | "other";
  /** True when this artifact represents a build failure (stderr tail), not a real file. */
  failed?: boolean;
  message?: string;
}

export interface BrowserLogEntry {
  type: "error" | "warning" | "log" | "info";
  message: string;
  source?: string;
  line?: number;
  column?: number;
}

/** Generate a unified diff between two strings. */
export function generateUnifiedDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const diff: string[] = [];

  diff.push(`--- a/${filePath}`);
  diff.push(`+++ b/${filePath}`);

  let i = 0, j = 0;
  const contextLines = 3;

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++; j++;
      continue;
    }

    // Find matching lines ahead to determine context
    let matchFound = false;
    for (let lookahead = 1; lookahead <= 50 && !matchFound; lookahead++) {
      if (i + lookahead < oldLines.length && j + lookahead < newLines.length &&
          oldLines[i + lookahead] === newLines[j + lookahead]) {
        matchFound = true;
      }
    }

    if (!matchFound) {
      // No match found - treat rest as changes
      const startOld = Math.max(0, i - contextLines);
      const startNew = Math.max(0, j - contextLines);
      diff.push(`@@ -${startOld + 1},${oldLines.length - startOld} +${startNew + 1},${newLines.length - startNew} @@`);
      for (let k = startOld; k < oldLines.length; k++) diff.push(`-${oldLines[k]}`);
      for (let k = startNew; k < newLines.length; k++) diff.push(`+${newLines[k]}`);
      break;
    }

    // Output context before change
    const contextStart = Math.max(0, i - contextLines);
    const hunkOldStart = contextStart + 1;
    const hunkOldLines = i - contextStart + contextLines;
    const hunkNewStart = Math.max(0, j - contextLines) + 1;
    const hunkNewLines = j - Math.max(0, j - contextLines) + contextLines;

    diff.push(`@@ -${hunkOldStart},${hunkOldLines} +${hunkNewStart},${hunkNewLines} @@`);

    for (let k = contextStart; k < i; k++) diff.push(` ${oldLines[k]}`);

    // Removed lines
    while (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
      diff.push(`-${oldLines[i]}`);
      i++;
    }

    // Added lines
    while (j < newLines.length && (i >= oldLines.length || oldLines[i] !== newLines[j])) {
      diff.push(`+${newLines[j]}`);
      j++;
    }

    // Context after
    for (let k = 0; k < contextLines && i < oldLines.length && j < newLines.length; k++) {
      diff.push(` ${oldLines[i]}`);
      i++; j++;
    }
  }

  return diff.join("\n");
}

/** Run a command with timeout and capture output. */
function runCommand(
  command: string,
  cwd: string,
  timeoutMs = 60_000,
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const { spawn: spawnCmd } = require("node:child_process");
    const child: ChildProcess = spawnCmd("/bin/bash", ["-lc", command], {
      cwd,
      // timeout: timeoutMs,  // TypeScript issue with spawn timeout - handled manually
      maxBuffer: 1024 * 1024 * 10, // 10MB
      env: getWorkspaceCommandEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ stdout, stderr, exitCode: 124, timedOut: true });
    }, timeoutMs);

    child.on("exit", (code: number | null) => {
      clearTimeout(timeoutHandle);
      resolve({ stdout, stderr, exitCode: code ?? 1, timedOut: false });
    });
    child.on("error", (err: Error) => {
      clearTimeout(timeoutHandle);
      if ((err as NodeJS.ErrnoException).code === "ETIMEDOUT" || (err as any).killed) {
        resolve({ stdout, stderr, exitCode: 124, timedOut: true });
      } else {
        resolve({ stdout, stderr, exitCode: 1, timedOut: false });
      }
    });
  });
}

/** Parse TypeScript compiler output (tsc --noEmit --pretty false). */
function parseTypeScriptOutput(output: string, exitCode?: number): TypeScriptError[] {
  const errors: TypeScriptError[] = [];
  // tsc output format: file.ts(line,col): error TS1234: message
  const regex = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.+)$/gm;
  let match;
  while ((match = regex.exec(output)) !== null) {
    errors.push({
      file: match[1],
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      code: `TS${match[5]}`,
      message: match[6].trim(),
      severity: match[4] === "error" ? "error" : "warning",
    });
  }
  // Fix 0.10: a non-zero tsc exit whose output matched no `error TSxxxx` line
  // (e.g. "Cannot find module" lines, version shim chatter) must surface as a
  // failure, not parse to `[]` → silent pass.
  if (errors.length === 0 && exitCode && exitCode !== 0 && output.trim()) {
    errors.push({
      file: "(tsc)",
      line: 0,
      column: 0,
      code: `TSC-EXIT-${exitCode}`,
      message: output.trim().slice(0, 800),
      severity: "error",
    });
  }
  return errors;
}

/** Parse Vitest JSON output (vitest --reporter=json). */
function parseVitestOutput(output: string): TestResult[] {
  try {
    const data = JSON.parse(output);
    const results: TestResult[] = [];

    if (data.testResults) {
      for (const suite of data.testResults) {
        const failures: TestFailure[] = [];
        for (const assertion of suite.assertionResults ?? []) {
          if (assertion.status === "failed") {
            failures.push({
              name: assertion.fullName,
              message: assertion.failureMessages?.join("\n") ?? "Test failed",
              stack: assertion.stack,
              file: suite.name,
            });
          }
        }
        results.push({
          framework: "vitest",
          passed: suite.numPassedTests ?? 0,
          failed: suite.numFailedTests ?? 0,
          skipped: suite.numPendingTests ?? 0,
          total: suite.numTotalTests ?? 0,
          duration: suite.duration ?? 0,
          output: "",
          failures,
        });
      }
    }
    return results;
  } catch {
    return [{ framework: "vitest", passed: 0, failed: 0, skipped: 0, total: 0, duration: 0, output, failures: [] }];
  }
}

/** Parse ESLint JSON output (eslint -f json). */
function parseESLintOutput(output: string): LintIssue[] {
  try {
    const data = JSON.parse(output);
    const issues: LintIssue[] = [];
    for (const file of data) {
      for (const msg of file.messages ?? []) {
        issues.push({
          file: file.filePath,
          line: msg.line ?? 0,
          column: msg.column ?? 0,
          severity: msg.severity === 2 ? "error" : "warning",
          rule: msg.ruleId ?? "unknown",
          message: msg.message ?? "",
        });
      }
    }
    return issues;
  } catch {
    return [];
  }
}

/** Parse build artifacts from build output. */
function parseBuildArtifacts(workspacePath: string, buildOutput: string, exitCode: number): BuildArtifact[] {
  const artifacts: BuildArtifact[] = [];
  try {
    if (fsSync.existsSync(path.join(workspacePath, "dist"))) {
      // scan the dist directory for real emitted artifacts (js/css/html/maps)
      const files: string[] = [];
      readDirRecursive(path.join(workspacePath, "dist"), files, 200);
      for (const file of files) {
        let size = 0;
        try { size = fsSync.statSync(file).size; } catch { /* ignore */ }
        const rel = file.replace(path.join(workspacePath, "dist"), "dist");
        const ext = path.extname(file).replace(".", "");
        artifacts.push({ path: rel, size, type: (["js", "css", "html", "map"].includes(ext) ? ext : "other") as BuildArtifact["type"] });
      }
    }
    // Fix 0.10: surface a real failed build instead of an empty array.
    if (exitCode !== 0) {
      const tail = buildOutput.trim().split("\n").slice(-25).join("\n");
      artifacts.unshift({ path: "(build)", size: 0, type: "other", failed: true, message: tail || `build exited ${exitCode}` });
    }
  } catch { /* ignore */ }
  return artifacts;
}

function readDirRecursive(dir: string, out: string[], max: number): void {
  let entries: fsSync.Dirent[];
  try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (out.length >= max) return;
    if (e.isDirectory()) readDirRecursive(path.join(dir, e.name), out, max);
    else out.push(path.join(dir, e.name));
  }
}

/**
 * Phase 2.2: Real Verification Loop
 *
 * Runs tsc, vitest, eslint, and build in parallel, returns structured results.
 * If any fail, the results are fed back to the model for fixing.
 */
export async function verifyWorkspace(
  projectId: string,
  workspaceId?: string,
): Promise<StructuredToolResult> {
  const wsId = workspaceId ?? projectId;
  const workspacePath = getWorkspaceRoot(wsId);
  const startTime = Date.now();

  // Fix 0.10 — no `|| true`. Each command's real exit code is honored.
  // Commands that can't run in this workspace (no config, no project) are
  // reported as *skipped*, not as "passed" and not as "failed": the distinction
  // is surfaced honestly so a green verdict is never an accident.
  const [tscResult, testResult, lintResult, buildResult] = await Promise.all([
    runCommand("npx tsc --noEmit --pretty false", workspacePath, 120_000),
    runCommand("npx vitest run --reporter=json", workspacePath, 120_000),
    runCommand("npx eslint -f json .", workspacePath, 60_000),
    runCommand("npm run build", workspacePath, 180_000),
  ]);

  const durationMs = Date.now() - startTime;

  const hasTsConfig = fsSync.existsSync(path.join(workspacePath, "tsconfig.json"));
  const hasPackageJson = fsSync.existsSync(path.join(workspacePath, "package.json"));
  const noTestsFound = /no test files found/i.test(testResult.stdout + testResult.stderr);
  const noLintConfig = /config|couldn't find|with `--no-config-lookup`/i.test(lintResult.stdout + lintResult.stderr) && lintResult.exitCode !== 0;

  const tscSkipped = !hasTsConfig && tscResult.exitCode !== 0;
  const testsSkipped = noTestsFound;
  const lintSkipped = noLintConfig;
  const buildSkipped = !hasPackageJson;

  const parsed = {
    typeErrors: parseTypeScriptOutput(tscResult.stdout + tscResult.stderr, tscResult.exitCode),
    testResults: parseVitestOutput(testResult.stdout),
    lintIssues: parseESLintOutput(lintResult.stdout),
    buildArtifacts: parseBuildArtifacts(workspacePath, buildResult.stdout + buildResult.stderr, buildResult.exitCode),
    browserLogs: [], // Would be populated from preview agent
  };

  const tscOk = tscSkipped || (tscResult.exitCode === 0 && parsed.typeErrors.filter(e => e.severity === "error").length === 0);
  const testsOk = testsSkipped || (testResult.exitCode === 0 && parsed.testResults.every(t => t.failed === 0));
  const lintOk = lintSkipped || (lintResult.exitCode === 0 && parsed.lintIssues.filter(i => i.severity === "error").length === 0);
  const buildOk = buildSkipped || buildResult.exitCode === 0;

  const allPassed = tscOk && testsOk && lintOk && buildOk;

  return {
    ok: allPassed,
    stdout: [tscResult.stdout, testResult.stdout, lintResult.stdout, buildResult.stdout].join("\n"),
    stderr: [tscResult.stderr, testResult.stderr, lintResult.stderr, buildResult.stderr].join("\n"),
    exitCode: allPassed ? 0 : 1,
    durationMs,
    parsed,
    ...(tscSkipped || testsSkipped || lintSkipped || buildSkipped ? {
      skipped: { tsc: tscSkipped, tests: testsSkipped, lint: lintSkipped, build: buildSkipped },
    } : {}),
  };
}

/**
 * Feed verification failures back to the model as a structured observation.
 * Returns a prompt the model can use to fix the issues.
 */
export function formatVerificationFeedback(result: StructuredToolResult): string {
  const parts: string[] = [];

  if (result.parsed.typeErrors.length > 0) {
    const errors = result.parsed.typeErrors.filter(e => e.severity === "error");
    if (errors.length > 0) {
      parts.push("## TypeScript Errors\n");
      for (const err of errors.slice(0, 20)) {
        parts.push(`${err.file}:${err.line}:${err.column} [${err.code}] ${err.message}`);
      }
      if (errors.length > 20) parts.push(`... and ${errors.length - 20} more errors`);
    }
  }

  if (result.parsed.testResults.some(t => t.failed > 0)) {
    parts.push("\n## Test Failures\n");
    for (const suite of result.parsed.testResults) {
      for (const failure of suite.failures.slice(0, 10)) {
        parts.push(`FAIL: ${failure.name}\n${failure.message}`);
        if (failure.stack) parts.push(failure.stack.split("\n").slice(0, 5).join("\n"));
      }
    }
  }

  if (result.parsed.lintIssues.some(i => i.severity === "error")) {
    const errors = result.parsed.lintIssues.filter(i => i.severity === "error");
    parts.push("\n## Lint Errors\n");
    for (const err of errors.slice(0, 20)) {
      parts.push(`${err.file}:${err.line}:${err.column} [${err.rule}] ${err.message}`);
    }
  }

  if (!result.ok && result.parsed.buildArtifacts.length === 0 && result.exitCode !== 0) {
    parts.push("\n## Build Failed\n");
    parts.push(result.stderr.slice(-3000));
  }

  return parts.join("\n") || "All checks passed.";
}

/**
 * Phase 2.3: Parallel Step Fan-out
 * Determines which plan steps can run in parallel based on dependsOn.
 */
export interface PlanStep {
  id: string;
  description: string;
  dependsOn?: string[];
  parallel?: boolean;
}

export function getParallelizableSteps(steps: PlanStep[]): PlanStep[][] {
  const completed = new Set<string>();
  const batches: PlanStep[][] = [];
  const remaining = [...steps];

  while (remaining.length > 0) {
    const batch = remaining.filter(step =>
      !step.dependsOn || step.dependsOn.every(dep => completed.has(dep))
    );
    if (batch.length === 0) {
      // Circular dependency or missing dependency - run sequentially
      batches.push([remaining.shift()!]);
      continue;
    }
    batches.push(batch);
    for (const step of batch) {
      completed.add(step.id);
    }
    // Remove completed from remaining
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (completed.has(remaining[i].id)) remaining.splice(i, 1);
    }
  }

  return batches;
}