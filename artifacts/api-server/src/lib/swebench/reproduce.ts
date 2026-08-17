/**
 * SWE-Bench Reproduction Engine
 * Clones repos, installs dependencies, runs tests, confirms failures
 */

import { execSync, spawn } from "child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { logger } from "../logger";

export interface SWEBenchIssue {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  hints_text?: string;
  created_at: string;
  version?: string;
  environment_setup_commit?: string;
}

export interface ReproductionResult {
  success: boolean;
  instanceId: string;
  repoPath: string;
  testCommand: string;
  testOutput: string;
  failedTests: string[];
  error?: string;
}

/**
 * Clone a repository at a specific commit
 */
export async function cloneRepo(repo: string, commit: string, targetDir: string): Promise<void> {
  const repoUrl = `https://github.com/${repo}.git`;

  logger.info({ repo, commit, targetDir }, "[SWE-Bench] Cloning repository");

  try {
    // Clone shallow to save time/space
    execSync(`git clone --depth 1 --branch ${commit} ${repoUrl} ${targetDir}`, {
      stdio: "pipe",
      timeout: 120000,
    });
  } catch (err) {
    // If shallow clone fails (commit not in recent history), do full clone
    logger.warn({ repo, commit }, "[SWE-Bench] Shallow clone failed, trying full clone");
    try {
      execSync(`git clone ${repoUrl} ${targetDir}`, { stdio: "pipe", timeout: 300000 });
      execSync(`git checkout ${commit}`, { cwd: targetDir, stdio: "pipe", timeout: 60000 });
    } catch (err2) {
      throw new Error(`Failed to clone ${repo} at ${commit}: ${err2 instanceof Error ? err2.message : "Unknown"}`);
    }
  }
}

/**
 * Detect test framework and get test command
 */
export function detectTestCommand(repoPath: string): string | null {
  const packageJsonPath = join(repoPath, "package.json");
  if (existsSync(packageJsonPath)) {
    const pkg = JSON.parse(require("fs").readFileSync(packageJsonPath, "utf-8"));
    if (pkg.scripts?.test) {
      return "npm test";
    }
    if (pkg.scripts?.pytest) {
      return "python -m pytest";
    }
  }

  // Check for pytest
  if (existsSync(join(repoPath, "pytest.ini")) || existsSync(join(repoPath, "pyproject.toml"))) {
    return "python -m pytest";
  }

  // Check for Makefile
  if (existsSync(join(repoPath, "Makefile"))) {
    return "make test";
  }

  // Check for tox
  if (existsSync(join(repoPath, "tox.ini"))) {
    return "tox";
  }

  return null;
}

/**
 * Install dependencies based on project type
 */
export async function installDependencies(repoPath: string): Promise<void> {
  const packageJsonPath = join(repoPath, "package.json");
  const requirementsPath = join(repoPath, "requirements.txt");
  const pyprojectPath = join(repoPath, "pyproject.toml");
  const setupPyPath = join(repoPath, "setup.py");

  if (existsSync(packageJsonPath)) {
    logger.info({ repoPath }, "[SWE-Bench] Installing npm dependencies");
    execSync("npm ci || npm install", { cwd: repoPath, stdio: "pipe", timeout: 300000 });
  } else if (existsSync(requirementsPath) || existsSync(pyprojectPath) || existsSync(setupPyPath)) {
    logger.info({ repoPath }, "[SWE-Bench] Installing Python dependencies");
    // Try pip install -e . first (editable install)
    try {
      execSync("pip install -e .", { cwd: repoPath, stdio: "pipe", timeout: 300000 });
    } catch {
      // Fallback to requirements.txt
      if (existsSync(requirementsPath)) {
        execSync(`pip install -r ${requirementsPath}`, { cwd: repoPath, stdio: "pipe", timeout: 300000 });
      }
    }
  }
}

/**
 * Run tests and capture output
 */
export async function runTests(repoPath: string, testCommand: string): Promise<{ output: string; failedTests: string[]; success: boolean }> {
  logger.info({ repoPath, testCommand }, "[SWE-Bench] Running tests");

  return new Promise((resolve) => {
    let output = "";
    let errorOutput = "";

    const child = spawn(testCommand, {
      cwd: repoPath,
      shell: true,
      timeout: 300000,
    });

    child.stdout?.on("data", (data) => {
      output += data.toString();
    });

    child.stderr?.on("data", (data) => {
      errorOutput += data.toString();
    });

    child.on("close", (code) => {
      const fullOutput = output + errorOutput;
      const failedTests = extractFailedTests(fullOutput);
      resolve({
        output: fullOutput,
        failedTests,
        success: code === 0 && failedTests.length === 0,
      });
    });

    child.on("error", (err) => {
      resolve({
        output: `Error: ${err.message}`,
        failedTests: [],
        success: false,
      });
    });
  });
}

/**
 * Extract failed test names from test output
 */
function extractFailedTests(output: string): string[] {
  const failed: string[] = [];

  // Pytest pattern
  const pytestFailures = output.match(/FAILED\s+([^\s:]+::[^\s:]+)/g);
  if (pytestFailures) {
    failed.push(...pytestFailures.map(f => f.replace("FAILED ", "").trim()));
  }

  // Jest/Vitest pattern
  const jestFailures = output.match(/●\s+([^\n]+)/g);
  if (jestFailures) {
    failed.push(...jestFailures.map(f => f.replace("● ", "").trim()));
  }

  // Generic assertion failures
  const assertionFailures = output.match(/(AssertionError|Test failed|FAIL):\s*([^\n]+)/g);
  if (assertionFailures) {
    failed.push(...assertionFailures.map(f => f.trim()));
  }

  return [...new Set(failed)]; // deduplicate
}

/**
 * Main reproduction function
 */
export async function reproduceIssue(issue: SWEBenchIssue, workspaceRoot: string): Promise<ReproductionResult> {
  const repoName = issue.repo.replace("/", "_");
  const repoPath = join(workspaceRoot, `swebench_${repoName}_${issue.instance_id}`);

  // Clean up any existing directory
  if (existsSync(repoPath)) {
    rmSync(repoPath, { recursive: true, force: true });
  }
  mkdirSync(repoPath, { recursive: true });

  try {
    // 1. Clone repository
    await cloneRepo(issue.repo, issue.base_commit, repoPath);

    // 2. Install dependencies
    await installDependencies(repoPath);

    // 3. Detect test command
    const testCommand = detectTestCommand(repoPath);
    if (!testCommand) {
      return {
        success: false,
        instanceId: issue.instance_id,
        repoPath,
        testCommand: "unknown",
        testOutput: "",
        failedTests: [],
        error: "Could not detect test command",
      };
    }

    // 4. Run tests (before fix - should fail)
    const testResult = await runTests(repoPath, testCommand);

    return {
      success: !testResult.success, // We expect failure for reproduction
      instanceId: issue.instance_id,
      repoPath,
      testCommand,
      testOutput: testResult.output,
      failedTests: testResult.failedTests,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, instanceId: issue.instance_id }, "[SWE-Bench] Reproduction failed");
    return {
      success: false,
      instanceId: issue.instance_id,
      repoPath,
      testCommand: "unknown",
      testOutput: "",
      failedTests: [],
      error,
    };
  }
}

/**
 * Verify a fix by running tests again
 */
export async function verifyFix(repoPath: string, testCommand: string): Promise<ReproductionResult> {
  const testResult = await runTests(repoPath, testCommand);

  return {
    success: testResult.success,
    instanceId: "verify",
    repoPath,
    testCommand,
    testOutput: testResult.output,
    failedTests: testResult.failedTests,
  };
}

/**
 * Generate a patch from git diff
 */
export function generatePatch(repoPath: string): string {
  try {
    const diff = execSync("git diff", { cwd: repoPath, encoding: "utf-8", timeout: 30000 });
    return diff;
  } catch {
    return "";
  }
}

/**
 * Apply a patch to the repository
 */
export function applyPatch(repoPath: string, patch: string): boolean {
  try {
    writeFileSync(join(repoPath, "fix.patch"), patch);
    execSync("git apply fix.patch", { cwd: repoPath, stdio: "pipe", timeout: 30000 });
    return true;
  } catch (err) {
    logger.error({ err }, "[SWE-Bench] Failed to apply patch");
    return false;
  }
}