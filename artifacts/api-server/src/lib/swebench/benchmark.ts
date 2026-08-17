/**
 * SWE-Bench Benchmark Runner
 * Orchestrates full SWE-Bench evaluation across dataset
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { logger } from "../logger";
import { type SWEBenchIssue, reproduceIssue } from "./reproduce";
import { runFixAgent, type FixResult } from "./fix";

export interface BenchmarkConfig {
  datasetPath: string;
  workspaceRoot: string;
  outputDir: string;
  maxAttemptsPerIssue: number;
  maxIssues?: number;
  filter?: (issue: SWEBenchIssue) => boolean;
}

export interface BenchmarkResult {
  instanceId: string;
  resolved: boolean;
  attempts: number;
  patch: string;
  testOutput: string;
  error?: string;
  timestamp: string;
}

export interface BenchmarkSummary {
  total: number;
  resolved: number;
  failed: number;
  errors: number;
  resolveRate: number;
  avgAttempts: number;
  results: BenchmarkResult[];
}

/**
 * Load SWE-Bench dataset (JSONL format)
 */
export function loadDataset(path: string): SWEBenchIssue[] {
  const content = readFileSync(path, "utf-8");
  return content.trim().split("\n").map(line => JSON.parse(line));
}

/**
 * Save benchmark results
 */
export function saveResults(outputDir: string, results: BenchmarkResult[]): void {
  mkdirSync(outputDir, { recursive: true });

  // Save individual results
  for (const result of results) {
    writeFileSync(
      join(outputDir, `${result.instanceId}.json`),
      JSON.stringify(result, null, 2)
    );
  }

  // Save summary
  const summary = generateSummary(results);
  writeFileSync(
    join(outputDir, "summary.json"),
    JSON.stringify(summary, null, 2)
  );

  // Save CSV for easy analysis
  const csv = [
    "instance_id,resolved,attempts,error,timestamp",
    ...results.map(r => `${r.instanceId},${r.resolved},${r.attempts},${r.error || ""},${r.timestamp}`),
  ].join("\n");
  writeFileSync(join(outputDir, "results.csv"), csv);
}

/**
 * Generate summary statistics
 */
export function generateSummary(results: BenchmarkResult[]): BenchmarkSummary {
  const resolved = results.filter(r => r.resolved).length;
  const failed = results.filter(r => !r.resolved && !r.error).length;
  const errors = results.filter(r => r.error).length;
  const avgAttempts = results.reduce((sum, r) => sum + r.attempts, 0) / results.length || 0;

  return {
    total: results.length,
    resolved,
    failed,
    errors,
    resolveRate: results.length > 0 ? resolved / results.length : 0,
    avgAttempts,
    results,
  };
}

/**
 * Run benchmark on a dataset
 */
export async function runBenchmark(config: BenchmarkConfig): Promise<BenchmarkSummary> {
  const issues = loadDataset(config.datasetPath);
  const filteredIssues = config.filter ? issues.filter(config.filter) : issues;
  const targetIssues = config.maxIssues ? filteredIssues.slice(0, config.maxIssues) : filteredIssues;

  logger.info({ total: issues.length, filtered: filteredIssues.length, running: targetIssues.length }, "[SWE-Bench] Starting benchmark");

  const results: BenchmarkResult[] = [];

  for (let i = 0; i < targetIssues.length; i++) {
    const issue = targetIssues[i];
    logger.info({ instanceId: issue.instance_id, progress: `${i + 1}/${targetIssues.length}` }, "[SWE-Bench] Processing issue");

    try {
      // Reproduce the issue
      const repro = await reproduceIssue(issue, config.workspaceRoot);

      if (!repro.success) {
        results.push({
          instanceId: issue.instance_id,
          resolved: false,
          attempts: 0,
          patch: "",
          testOutput: repro.testOutput,
          error: repro.error || "Reproduction failed",
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      // Run fix agent
      const fixResult = await runFixAgent(
        {
          instanceId: issue.instance_id,
          problemStatement: issue.problem_statement,
          hints: issue.hints_text,
          repo: issue.repo,
          baseCommit: issue.base_commit,
        },
        repro.repoPath,
        repro.testCommand,
        config.maxAttemptsPerIssue
      );

      results.push({
        instanceId: issue.instance_id,
        resolved: fixResult.success,
        attempts: fixResult.totalAttempts,
        patch: fixResult.finalPatch,
        testOutput: fixResult.attempts[fixResult.attempts.length - 1]?.testResult.output || "",
        timestamp: new Date().toISOString(),
      });

      // Save progress incrementally
      saveResults(config.outputDir, results);
    } catch (err) {
      logger.error({ err, instanceId: issue.instance_id }, "[SWE-Bench] Issue failed");
      results.push({
        instanceId: issue.instance_id,
        resolved: false,
        attempts: 0,
        patch: "",
        testOutput: "",
        error: err instanceof Error ? err.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  }

  const summary = generateSummary(results);
  saveResults(config.outputDir, results);

  logger.info({ summary: { total: summary.total, resolved: summary.resolved, rate: summary.resolveRate } }, "[SWE-Bench] Benchmark complete");

  return summary;
}

/**
 * Run a single issue (for testing/debugging)
 */
export async function runSingleIssue(
  issue: SWEBenchIssue,
  workspaceRoot: string,
  maxAttempts: number = 3
): Promise<FixResult> {
  const repro = await reproduceIssue(issue, workspaceRoot);

  if (!repro.success) {
    throw new Error(`Reproduction failed: ${repro.error}`);
  }

  return runFixAgent(
    {
      instanceId: issue.instance_id,
      problemStatement: issue.problem_statement,
      hints: issue.hints_text,
      repo: issue.repo,
      baseCommit: issue.base_commit,
    },
    repro.repoPath,
    repro.testCommand,
    maxAttempts
  );
}