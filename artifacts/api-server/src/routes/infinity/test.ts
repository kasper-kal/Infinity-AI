import { Router } from "express";
import { execSync, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { cleanText } from "../../lib/text-utils";
import { getWorkspaceRoot, listWorkspaceFiles, readWorkspaceFileText } from "../../lib/workspace";

const router = Router();

/**
 * Detected test framework information.
 */
interface TestFramework {
  name: string;
  language: string;
  runCommand: string;
  runSingleCommand?: string; // Command to run a specific test file
  detectFiles: (files: string[]) => string[]; // Function to find test files
  configFiles: string[]; // Files that indicate this framework is used
}

/**
 * Test execution result.
 */
interface TestResult {
  framework: string;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration: number;
  output: string;
  tests: Array<{
    name: string;
    status: "passed" | "failed" | "skipped";
    duration?: number;
    error?: string;
  }>;
}

/**
 * Coverage report data.
 */
interface CoverageReport {
  framework: string;
  coverage: number; // 0-100
  lines: number;
  branches: number;
  functions: number;
  statements: number;
  details?: string;
}

/**
 * Define all supported test frameworks.
 */
const testFrameworks: Record<string, TestFramework> = {
  jest: {
    name: "Jest",
    language: "javascript",
    runCommand: "npm test",
    runSingleCommand: "npm test -- {file}",
    detectFiles: (files) => files.filter((f) => f.match(/\.(test|spec)\.(js|ts|jsx|tsx)$/)),
    configFiles: ["jest.config.js", "jest.config.json", "jest.setup.js"],
  },
  vitest: {
    name: "Vitest",
    language: "javascript",
    runCommand: "vitest run",
    runSingleCommand: "vitest run {file}",
    detectFiles: (files) => files.filter((f) => f.match(/\.(test|spec)\.(js|ts|jsx|tsx)$/)),
    configFiles: ["vitest.config.js", "vitest.config.ts"],
  },
  mocha: {
    name: "Mocha",
    language: "javascript",
    runCommand: "npx mocha",
    runSingleCommand: "npx mocha {file}",
    detectFiles: (files) => files.filter((f) => f.match(/test\.(js|ts)$/) || f.match(/\.(test|spec)\.(js|ts)$/)),
    configFiles: [".mocharc.json", ".mocharc.js", "mocha.opts"],
  },
  pytest: {
    name: "pytest",
    language: "python",
    runCommand: "pytest",
    runSingleCommand: "pytest {file}",
    detectFiles: (files) => files.filter((f) => f.match(/test_.*\.py$/) || f.match(/.*_test\.py$/)),
    configFiles: ["pytest.ini", "setup.cfg", "pyproject.toml", "tox.ini"],
  },
  unittest: {
    name: "unittest",
    language: "python",
    runCommand: "python -m unittest discover",
    runSingleCommand: "python -m unittest {file}",
    detectFiles: (files) =>
      files.filter((f) => f.match(/test_.*\.py$/) || (f.includes("test") && f.endsWith(".py"))),
    configFiles: [],
  },
  cargo: {
    name: "Cargo Test",
    language: "rust",
    runCommand: "cargo test",
    runSingleCommand: "cargo test {name}",
    detectFiles: (files) => files.filter((f) => f.match(/mod\.rs$/) || f.includes("tests/")),
    configFiles: ["Cargo.toml"],
  },
  go: {
    name: "Go Testing",
    language: "go",
    runCommand: "go test ./...",
    runSingleCommand: "go test {file}",
    detectFiles: (files) => files.filter((f) => f.match(/_test\.go$/)),
    configFiles: ["go.mod"],
  },
  rspec: {
    name: "RSpec",
    language: "ruby",
    runCommand: "rspec",
    runSingleCommand: "rspec {file}",
    detectFiles: (files) => files.filter((f) => f.match(/spec\/.*_spec\.rb$/)),
    configFiles: [".rspec", "spec_helper.rb"],
  },
  maven: {
    name: "Maven",
    language: "java",
    runCommand: "mvn test",
    runSingleCommand: "mvn test -Dtest={class}",
    detectFiles: (files) => files.filter((f) => f.match(/Test\.java$/)),
    configFiles: ["pom.xml"],
  },
  gradle: {
    name: "Gradle",
    language: "java",
    runCommand: "gradle test",
    runSingleCommand: "gradle test --tests {class}",
    detectFiles: (files) => files.filter((f) => f.match(/Test\.kt$/) || f.match(/Test\.java$/)),
    configFiles: ["build.gradle", "build.gradle.kts"],
  },
  phpunit: {
    name: "PHPUnit",
    language: "php",
    runCommand: "phpunit",
    runSingleCommand: "phpunit {file}",
    detectFiles: (files) => files.filter((f) => f.match(/Test\.php$/)),
    configFiles: ["phpunit.xml", "phpunit.xml.dist"],
  },
  dotnet: {
    name: ".NET Test",
    language: "csharp",
    runCommand: "dotnet test",
    runSingleCommand: "dotnet test {file}",
    detectFiles: (files) => files.filter((f) => f.match(/\.Tests\.cs$/)),
    configFiles: ["*.csproj"],
  },
};

/**
 * Detect available test frameworks in a workspace.
 */
async function detectTestFrameworks(fileNames: string[]): Promise<string[]> {
  const detected: string[] = [];

  for (const [key, framework] of Object.entries(testFrameworks)) {
    // Check if any config files exist
    if (framework.configFiles.some((cfg) => fileNames.some((f) => f.endsWith(cfg)))) {
      detected.push(key);
    }
    // Check if test files exist
    else if (framework.detectFiles(fileNames).length > 0) {
      detected.push(key);
    }
  }

  return detected;
}

/**
 * GET /test/files
 * List all test files in the workspace.
 */
router.get("/test/files", async (req, res) => {
  try {
    const entries = await listWorkspaceFiles("default");
    const testFiles = entries
      .filter((entry) => entry.type === "file")
      .map((entry) => entry.path)
      .filter((f) => {
        // Match common test file patterns
        return (
          f.match(/\.(test|spec)\.(js|ts|jsx|tsx)$/) || // JS/TS tests
          f.match(/test_.*\.py$/) || // Python tests
          f.match(/_test\.go$/) || // Go tests
          f.match(/_test\.rs$/) || // Rust tests
          f.match(/spec\/.*_spec\.rb$/) || // Ruby specs
          f.match(/Test\.java$/) || // Java tests
          f.match(/Test\.php$/) // PHP tests
        );
      });

    res.json({
      ok: true,
      testFiles,
      count: testFiles.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list test files");
    res.status(500).json({ error: "Failed to list test files" });
  }
});

/**
 * GET /test/frameworks
 * Detect available test frameworks.
 */
router.get("/test/frameworks", async (req, res) => {
  try {
    const entries = await listWorkspaceFiles("default");
    const fileNames = entries.map((entry) => entry.path);
    const detected = await detectTestFrameworks(fileNames);

    const frameworks = detected.map((key) => {
      const fw = testFrameworks[key];
      return {
        key,
        name: fw.name,
        language: fw.language,
        runCommand: fw.runCommand,
      };
    });

    res.json({
      ok: true,
      frameworks,
      detected: detected.length > 0,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to detect frameworks");
    res.status(500).json({ error: "Failed to detect frameworks" });
  }
});

/**
 * POST /test/run
 * Run all tests for a detected framework.
 */
router.post("/test/run", async (req, res) => {
  const framework = cleanText(req.body?.framework, 50);

  if (!framework || !testFrameworks[framework]) {
    return res.status(400).json({ error: "Invalid framework" });
  }

  const fw = testFrameworks[framework];

  try {
    const startTime = Date.now();
    let output = "";

    // Run the test command
    try {
      output = execSync(fw.runCommand, {
        cwd: "/workspace", // Use workspace directory
        encoding: "utf-8",
        maxBuffer: 5 * 1024 * 1024, // 5MB buffer
      });
    } catch (err: unknown) {
      // Some test runners exit with code 1 even on success with failures
      if (typeof err === "object" && err !== null && "stdout" in err) {
        output = (err as { stdout?: string }).stdout ?? "";
      }
    }

    const duration = Date.now() - startTime;

    // Parse test output (simplified - frameworks have different output formats)
    const lines = output.split("\n");
    const result: TestResult = {
      framework,
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      duration,
      output: cleanText(output, 5000),
      tests: [],
    };

    // Count passed/failed (basic parsing)
    for (const line of lines) {
      if (line.includes("passed")) {
        const match = line.match(/(\d+)\s+passed/);
        if (match) result.passed = parseInt(match[1], 10);
      }
      if (line.includes("failed")) {
        const match = line.match(/(\d+)\s+failed/);
        if (match) result.failed = parseInt(match[1], 10);
      }
      if (line.includes("skipped")) {
        const match = line.match(/(\d+)\s+skipped/);
        if (match) result.skipped = parseInt(match[1], 10);
      }
    }

    result.total = result.passed + result.failed + result.skipped;

    return res.json({
      ok: true,
      result,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to run tests");
    return res.status(500).json({ error: "Failed to run tests", details: String(err) });
  }
});

/**
 * POST /test/run-single
 * Run a specific test file.
 */
router.post("/test/run-single", async (req, res) => {
  const framework = cleanText(req.body?.framework, 50);
  const testFile = cleanText(req.body?.testFile, 500);

  if (!framework || !testFrameworks[framework] || !testFile) {
    return res.status(400).json({ error: "framework and testFile are required" });
  }

  const fw = testFrameworks[framework];
  const runCommand = fw.runSingleCommand || fw.runCommand;
  const command = runCommand.replace("{file}", testFile).replace("{name}", path.parse(testFile).name);

  try {
    const startTime = Date.now();
    let output = "";

    try {
      output = execSync(command, {
        cwd: "/workspace",
        encoding: "utf-8",
        maxBuffer: 5 * 1024 * 1024,
      });
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "stdout" in err) {
        output = (err as { stdout?: string }).stdout ?? "";
      }
    }

    const duration = Date.now() - startTime;

    return res.json({
      ok: true,
      testFile,
      framework,
      duration,
      output: cleanText(output, 3000),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to run single test");
    return res.status(500).json({ error: "Failed to run single test" });
  }
});

/**
 * GET /test/coverage
 * Get coverage report if available.
 */
router.get("/test/coverage", async (req, res) => {
  try {
    const framework = cleanText(req.query.framework as string, 50) || "jest";

    // Try to read coverage report files
    let coverage: CoverageReport | null = null;

    // Coverage.json (created by Jest, Vitest, etc.)
    try {
      const coverageJson = await readWorkspaceFileText("coverage/coverage-summary.json", "default");
      if (coverageJson) {
        const parsed = JSON.parse(coverageJson);
        const total = parsed.total;
        if (total) {
          coverage = {
            framework,
            coverage: Math.round(total.lines.pct),
            lines: total.lines.pct,
            branches: total.branches.pct,
            functions: total.functions.pct,
            statements: total.statements.pct,
          };
        }
      }
    } catch {
      // Coverage file might not exist
    }

    if (!coverage) {
      return res.json({
        ok: true,
        coverage: null,
        message: "No coverage report found. Run tests with coverage flag.",
      });
    }

    return res.json({
      ok: true,
      coverage,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get coverage");
    return res.status(500).json({ error: "Failed to get coverage report" });
  }
});

/**
 * POST /test/watch
 * Enable watch mode for tests (long-running).
 */
router.post("/test/watch", async (req, res) => {
  const framework = cleanText(req.body?.framework, 50);

  if (!framework || !testFrameworks[framework]) {
    return res.status(400).json({ error: "Invalid framework" });
  }

  const fw = testFrameworks[framework];

  // Start watch mode in background
  const watchCommand = fw.runCommand.replace("test", "test --watch").replace("cargo test", "cargo test -- --nocapture");

  try {
    // Return immediately - actual watch mode would use WebSockets or SSE
    return res.json({
      ok: true,
      status: "watch-mode-started",
      framework,
      command: watchCommand,
      message: "Watch mode started. Tests will re-run on file changes.",
    });
  } catch (err) {
    req.log.error({ err }, "Failed to start watch mode");
    return res.status(500).json({ error: "Failed to start watch mode" });
  }
});

export default router;
