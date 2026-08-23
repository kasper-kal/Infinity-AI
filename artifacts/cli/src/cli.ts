import { program } from "commander";
import chalk from "chalk";
import ora from "ora";
import axios from "axios";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const pkg = JSON.parse(readFileSync(resolve(__dirname, "..", "package.json"), "utf8"));

interface GlobalOptions {
  apiKey?: string;
  baseUrl?: string;
  projectId?: string;
  headless?: boolean;
  json?: boolean;
  verbose?: boolean;
}

interface BuildOptions extends GlobalOptions {
  prompt?: string;
  plan?: string;
  workspaceId?: string;
  maxIterations?: number;
  temperature?: number;
  previewPort?: number;
  skipPreflight?: boolean;
  dryRun?: boolean;
  extraSystemPrompt?: string;
}

interface HeadlessBuildOptions extends BuildOptions {
  // Additional headless-specific options
  output?: string; // File to write JSON output
  exitOnFailure?: boolean;
}

// Exit codes for CI/CD
export enum ExitCode {
  SUCCESS = 0,
  BUILD_FAILED = 1,
  VALIDATION_ERROR = 2,
  BUDGET_EXCEEDED = 3,
  TIMEOUT = 4,
}

// Global state
let globalOptions: GlobalOptions = {};
const apiClient = axios.create({
  timeout: 300000, // 5 minutes for long builds
});

function setupApiClient() {
  const baseUrl = globalOptions.baseUrl || process.env.INFINITY_API_URL || "http://localhost:8080";
  const apiKey = globalOptions.apiKey || process.env.INFINITY_API_KEY;

  apiClient.defaults.baseURL = baseUrl;
  if (apiKey) {
    apiClient.defaults.headers.common["Authorization"] = `Bearer ${apiKey}`;
  }
  apiClient.defaults.headers.common["Content-Type"] = "application/json";
}

function log(...args: unknown[]) {
  if (!globalOptions.json) {
    console.log(...args);
  }
}

function logError(...args: unknown[]) {
  if (!globalOptions.json) {
    console.error(chalk.red(...args));
  }
}

function logSuccess(...args: unknown[]) {
  if (!globalOptions.json) {
    console.log(chalk.green(...args));
  }
}

function logWarn(...args: unknown[]) {
  if (!globalOptions.json) {
    console.log(chalk.yellow(...args));
  }
}

function outputJson(data: unknown) {
  if (globalOptions.json) {
    console.log(JSON.stringify(data, null, 2));
  }
}

function outputJsonLine(data: unknown) {
  if (globalOptions.json || globalOptions.headless) {
    console.log(JSON.stringify(data));
  }
}

function handleError(error: unknown, context: string): never {
  const message = error instanceof Error ? error.message : String(error);
  const response = error && typeof error === "object" && "response" in error
    ? (error as { response?: { data?: unknown; status?: number } }).response
    : undefined;

  const errorData = {
    success: false,
    error: message,
    context,
    status: response?.status,
    details: response?.data,
    timestamp: new Date().toISOString(),
  };

  outputJsonLine(errorData);

  if (!globalOptions.json) {
    logError(`❌ ${context}: ${message}`);
    if (response?.data) {
      logError("Response:", JSON.stringify(response.data, null, 2));
    }
  }

  const exitCode = response?.status === 400 ? ExitCode.VALIDATION_ERROR
    : response?.status === 429 ? ExitCode.BUDGET_EXCEEDED
    : response?.status === 409 ? ExitCode.TIMEOUT
    : ExitCode.BUILD_FAILED;
  process.exit(exitCode);
}

function exitWithCode(code: ExitCode, message?: string) {
  if (message) {
    outputJsonLine({ success: code === ExitCode.SUCCESS, message, exitCode: code, timestamp: new Date().toISOString() });
  }
  process.exit(code);
}

async function runHeadlessBuild(options: HeadlessBuildOptions): Promise<unknown> {
  const spinner = globalOptions.json ? null : ora("Starting headless build...").start();

  try {
    const projectId = options.projectId || options.workspaceId || "default";
    const prompt = options.prompt;

    if (!prompt) {
      throw new Error("Build prompt is required (--prompt or -p)");
    }

    // Build the request payload
    const payload: Record<string, unknown> = {
      projectId,
      workspaceId: options.workspaceId || projectId,
      prompt,
      maxIterations: options.maxIterations || 20,
      temperature: options.temperature ?? 0.2,
      skipPreflight: options.skipPreflight ?? false,
      dryRun: options.dryRun ?? false,
    };

    if (options.extraSystemPrompt) {
      payload.extraSystemPrompt = options.extraSystemPrompt;
    }
    if (options.previewPort) {
      payload.previewPort = options.previewPort;
    }
    if (options.plan) {
      payload.plan = options.plan;
    }

    if (spinner) spinner.text = "Sending build request...";

    // Use the scaffold endpoint for new builds, iterate for existing
    const endpoint = options.plan ? "/api/infinity-ai/build/scaffold" : "/api/infinity-ai/build/iterate";

    const response = await apiClient.post(endpoint, payload);

    if (spinner) spinner.text = "Build in progress...";

    const result = response.data;

    if (spinner) spinner.succeed("Build completed");

    // Output result
    const outputData = {
      success: result.ok === true,
      projectId,
      summary: result.summary,
      iterations: result.iterations,
      toolCalls: result.toolCalls,
      toolResults: result.toolResults,
      timestamp: new Date().toISOString(),
    };

    outputJsonLine(outputData);

    if (!globalOptions.json) {
      if (result.ok) {
        logSuccess(`✅ Build succeeded: ${result.summary}`);
        log(`Iterations: ${result.iterations}, Tool calls: ${result.toolCalls}`);
      } else {
        logError(`❌ Build failed: ${result.summary}`);
      }
    }

    // Write to output file if specified
    if (options.output) {
      await import("node:fs/promises").then((fs) => fs.writeFile(options.output!, JSON.stringify(outputData, null, 2)));
      if (!globalOptions.json) log(`📄 Output written to ${options.output}`);
    }

    // Exit with appropriate code
    if (!result.ok && options.exitOnFailure !== false) {
      exitWithCode(ExitCode.BUILD_FAILED, `Build failed: ${result.summary}`);
    }

    exitWithCode(ExitCode.SUCCESS);

    return outputData;
  } catch (error) {
    if (spinner) spinner.fail("Build failed");
    throw error;
  }
}

async function runPlan(options: BuildOptions): Promise<unknown> {
  const spinner = globalOptions.json ? null : ora("Creating build plan...").start();

  try {
    const workspaceId = options.workspaceId || "default";
    const prompt = options.prompt;

    if (!prompt) {
      throw new Error("Build prompt is required (--prompt or -p)");
    }

    const payload: Record<string, unknown> = {
      workspaceId,
      prompt,
    };

    if (options.extraSystemPrompt) {
      payload.extraSystemPrompt = options.extraSystemPrompt;
    }
    if (options.plan) {
      payload.plan = options.plan;
    }

    const response = await apiClient.post("/api/infinity-ai/build/plan", payload);

    if (spinner) spinner.succeed("Plan created");

    const result = response.data;
    outputJson(result);

    if (!globalOptions.json) {
      logSuccess("✅ Build plan created");
      log(JSON.stringify(result.plan, null, 2));
    }

    return result;
  } catch (error) {
    if (spinner) spinner.fail("Plan creation failed");
    throw error;
  }
}

async function runAsk(options: BuildOptions): Promise<unknown> {
  const spinner = globalOptions.json ? null : ora("Analyzing build request...").start();

  try {
    const prompt = options.prompt;

    if (!prompt) {
      throw new Error("Build prompt is required (--prompt or -p)");
    }

    const response = await apiClient.post("/api/infinity-ai/build/ask", { prompt });

    if (spinner) spinner.succeed("Analysis complete");

    const result = response.data;
    outputJson(result);

    if (!globalOptions.json) {
      logSuccess("✅ Build analysis complete");
      log(JSON.stringify(result, null, 2));
    }

    return result;
  } catch (error) {
    if (spinner) spinner.fail("Analysis failed");
    throw error;
  }
}

async function runStatus(options: GlobalOptions): Promise<unknown> {
  try {
    const projectId = options.projectId || "default";

    const response = await apiClient.get(`/api/infinity-ai/build/apps`, {
      params: { projectId },
    });

    const result = response.data;
    outputJson(result);

    if (!globalOptions.json) {
      logSuccess("✅ Build status retrieved");
      log(JSON.stringify(result, null, 2));
    }

    return result;
  } catch (error) {
    throw error;
  }
}

async function runCheckpoint(options: GlobalOptions & { action: "list" | "create" | "restore" | "delete"; id?: string }): Promise<unknown> {
  try {
    const projectId = options.projectId || "default";

    switch (options.action) {
      case "list": {
        const response = await apiClient.get(`/api/infinity-ai/build/checkpoints`, {
          params: { projectId },
        });
        outputJson(response.data);
        return response.data;
      }
      case "create": {
        const response = await apiClient.post(`/api/infinity-ai/build/checkpoints`, { projectId });
        outputJson(response.data);
        return response.data;
      }
      case "restore": {
        if (!options.id) throw new Error("Checkpoint ID required for restore");
        const response = await apiClient.post(`/api/infinity-ai/build/checkpoints/${options.id}/restore`, { projectId });
        outputJson(response.data);
        return response.data;
      }
      case "delete": {
        if (!options.id) throw new Error("Checkpoint ID required for delete");
        const response = await apiClient.delete(`/api/infinity-ai/build/checkpoints/${options.id}`, {
          params: { projectId },
        });
        outputJson(response.data);
        return response.data;
      }
    }
  } catch (error) {
    throw error;
  }
}

async function runBudget(options: GlobalOptions & { action: "status" | "set"; limits?: string }): Promise<unknown> {
  try {
    const projectId = options.projectId || "default";

    switch (options.action) {
      case "status": {
        const response = await apiClient.get(`/api/infinity-ai/build/budget/status`, {
          params: { projectId },
        });
        outputJson(response.data);
        return response.data;
      }
      case "set": {
        if (!options.limits) throw new Error("Budget limits required (JSON string)");
        const limits = JSON.parse(options.limits);
        const response = await apiClient.post(`/api/infinity-ai/build/budget/set`, { projectId, ...limits });
        outputJson(response.data);
        return response.data;
      }
    }
  } catch (error) {
    throw error;
  }
}

async function runSnapshot(options: GlobalOptions & { action: "list" | "create" | "restore" | "delete"; id?: string }): Promise<unknown> {
  try {
    const projectId = options.projectId || "default";

    switch (options.action) {
      case "list": {
        const response = await apiClient.get(`/api/infinity-ai/build/snapshots`, {
          params: { projectId },
        });
        outputJson(response.data);
        return response.data;
      }
      case "create": {
        const response = await apiClient.post(`/api/infinity-ai/build/snapshots`, { projectId });
        outputJson(response.data);
        return response.data;
      }
      case "restore": {
        if (!options.id) throw new Error("Snapshot ID required for restore");
        const response = await apiClient.post(`/api/infinity-ai/build/snapshots/${options.id}/restore`, { projectId });
        outputJson(response.data);
        return response.data;
      }
      case "delete": {
        if (!options.id) throw new Error("Snapshot ID required for delete");
        const response = await apiClient.delete(`/api/infinity-ai/build/snapshots/${options.id}`, {
          params: { projectId },
        });
        outputJson(response.data);
        return response.data;
      }
    }
  } catch (error) {
    throw error;
  }
}

// Main command setup
program
  .name("infinity")
  .description("Infinity AI CLI - Headless build automation for CI/CD")
  .version(pkg.version)
  .option("-k, --api-key <key>", "API key (or set INFINITY_API_KEY env var)")
  .option("-u, --base-url <url>", "API base URL (default: http://localhost:8080)")
  .option("-p, --project-id <id>", "Project ID (default: default)")
  .option("--headless", "Run in headless mode (JSON output, exit codes)")
  .option("--json", "Output JSON only")
  .option("-v, --verbose", "Verbose output")
  .hook("preAction", (thisCommand) => {
    globalOptions = thisCommand.opts();
    setupApiClient();
  });

// Build command
const buildCmd = program
  .command("build")
  .description("Run a headless build (scaffold or iterate)")
  .option("--prompt <prompt>", "Build prompt/goal")
  .option("--plan <plan>", "JSON plan string (for scaffold)")
  .option("-w, --workspace-id <id>", "Workspace ID (default: projectId)")
  .option("--max-iterations <n>", "Max iterations (default: 20)", "20")
  .option("--temperature <n>", "Temperature 0-1 (default: 0.2)", "0.2")
  .option("--preview-port <port>", "Preview server port")
  .option("--skip-preflight", "Skip pre-flight checks")
  .option("--dry-run", "Dry run (plan only)")
  .option("--extra-system-prompt <prompt>", "Extra system prompt")
  .option("-o, --output <file>", "Write JSON output to file")
  .option("--no-exit-on-failure", "Don't exit with error code on build failure")
  .action(async (options) => {
    await runHeadlessBuild({ ...globalOptions, ...options });
  });

// Plan command
program
  .command("plan")
  .description("Create a build plan without executing")
  .option("--prompt <prompt>", "Build prompt/goal")
  .option("-w, --workspace-id <id>", "Workspace ID (default: default)")
  .option("--extra-system-prompt <prompt>", "Extra system prompt")
  .action(async (options) => {
    await runPlan({ ...globalOptions, ...options });
  });

// Ask command
program
  .command("ask")
  .description("Analyze a build request (inventory + questions)")
  .option("--prompt <prompt>", "Build prompt/goal")
  .action(async (options) => {
    await runAsk({ ...globalOptions, ...options });
  });

// Status command
program
  .command("status")
  .description("Get build status and saved apps")
  .action(async (options) => {
    await runStatus({ ...globalOptions, ...options });
  });

// Checkpoint command
const checkpointCmd = program
  .command("checkpoint")
  .description("Manage build checkpoints")
  .option("--project-id <id>", "Project ID");

checkpointCmd
  .command("list")
  .description("List checkpoints")
  .action(async () => {
    await runCheckpoint({ ...globalOptions, action: "list" });
  });

checkpointCmd
  .command("create")
  .description("Create a checkpoint")
  .action(async () => {
    await runCheckpoint({ ...globalOptions, action: "create" });
  });

checkpointCmd
  .command("restore <id>")
  .description("Restore a checkpoint")
  .action(async (id) => {
    await runCheckpoint({ ...globalOptions, action: "restore", id });
  });

checkpointCmd
  .command("delete <id>")
  .description("Delete a checkpoint")
  .action(async (id) => {
    await runCheckpoint({ ...globalOptions, action: "delete", id });
  });

// Budget command
const budgetCmd = program
  .command("budget")
  .description("Manage build budgets")
  .option("--project-id <id>", "Project ID");

budgetCmd
  .command("status")
  .description("Get budget status")
  .action(async () => {
    await runBudget({ ...globalOptions, action: "status" });
  });

budgetCmd
  .command("set <limits>")
  .description("Set budget limits (JSON string)")
  .action(async (limits) => {
    await runBudget({ ...globalOptions, action: "set", limits });
  });

// Snapshot command
const snapshotCmd = program
  .command("snapshot")
  .description("Manage workspace snapshots")
  .option("--project-id <id>", "Project ID");

snapshotCmd
  .command("list")
  .description("List snapshots")
  .action(async () => {
    await runSnapshot({ ...globalOptions, action: "list" });
  });

snapshotCmd
  .command("create")
  .description("Create a snapshot")
  .action(async () => {
    await runSnapshot({ ...globalOptions, action: "create" });
  });

snapshotCmd
  .command("restore <id>")
  .description("Restore a snapshot")
  .action(async (id) => {
    await runSnapshot({ ...globalOptions, action: "restore", id });
  });

snapshotCmd
  .command("delete <id>")
  .description("Delete a snapshot")
  .action(async (id) => {
    await runSnapshot({ ...globalOptions, action: "delete", id });
  });

// Config command
program
  .command("config")
  .description("Show current configuration")
  .action(() => {
    const config = {
      baseUrl: globalOptions.baseUrl || process.env.INFINITY_API_URL || "http://localhost:8080",
      projectId: globalOptions.projectId || "default",
      hasApiKey: !!(globalOptions.apiKey || process.env.INFINITY_API_KEY),
      headless: globalOptions.headless,
      json: globalOptions.json,
    };
    outputJson(config);
    if (!globalOptions.json) {
      log("Configuration:");
      log(JSON.stringify(config, null, 2));
    }
  });

// Parse and handle errors
program.parseAsync(process.argv).catch((error) => {
  handleError(error, "CLI execution");
});

// Export for testing
export { program, runHeadlessBuild, runPlan, runAsk, runStatus, runCheckpoint, runBudget, runSnapshot };