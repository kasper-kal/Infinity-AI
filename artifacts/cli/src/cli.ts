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

// Chat command handler
async function runChat(options: GlobalOptions & {
  prompt?: string;
  workspaceId?: string;
  noCodebase?: boolean;
  model?: string;
  stream?: boolean
}): Promise<unknown> {
  try {
    const projectId = options.projectId || options.workspaceId || "default";
    const prompt = options.prompt;

    if (!prompt) {
      // Interactive mode - read from stdin
      return await runInteractiveChat(projectId, options);
    }

    // Single message mode
    const response = await apiClient.post("/api/infinity-ai/chat", {
      message: prompt,
      projectId,
      useCodebase: !options.noCodebase,
      model: options.model || "auto",
      stream: options.stream ?? true,
    });

    const result = response.data;
    outputJson(result);

    if (!globalOptions.json) {
      logSuccess("✅ Chat response received");
      log(result.response || JSON.stringify(result, null, 2));
    }

    return result;
  } catch (error) {
    throw error;
  }
}

async function runInteractiveChat(projectId: string, options: GlobalOptions & { model?: string; stream?: boolean }): Promise<unknown> {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let conversationId: string | undefined;

  log("💬 Infinity Chat (type 'exit' or 'quit' to leave)");
  log("   Use @codebase for codebase context");
  log("");

  while (true) {
    const input = await rl.question("You: ");
    if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit") {
      break;
    }

    try {
      const response = await apiClient.post("/api/infinity-ai/chat", {
        message: input,
        projectId,
        conversationId,
        useCodebase: !options.noCodebase,
        model: options.model || "auto",
        stream: false,
      });

      const result = response.data;
      conversationId = result.conversationId;

      if (!globalOptions.json) {
        log(`Infinity: ${result.response || "No response"}`);
        log("");
      }
    } catch (error) {
      logError(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  rl.close();
  return { success: true };
}

// Compose command handler
async function runCompose(options: GlobalOptions & {
  prompt?: string;
  workspaceId?: string;
  plan?: string;
  maxSteps?: number;
  autoApply?: boolean;
  dryRun?: boolean
}): Promise<unknown> {
  try {
    const projectId = options.projectId || options.workspaceId || "default";
    const prompt = options.prompt;

    if (!prompt) {
      throw new Error("Prompt is required (--prompt or -p)");
    }

    const response = await apiClient.post("/api/infinity-ai/composer", {
      goal: prompt,
      projectId,
      plan: options.plan,
      maxSteps: options.maxSteps || 10,
      autoApply: options.autoApply ?? false,
      dryRun: options.dryRun ?? false,
    });

    const result = response.data;
    outputJson(result);

    if (!globalOptions.json) {
      logSuccess("✅ Composer task completed");
      if (result.plan) {
        log(`Plan: ${result.plan.steps.length} steps`);
        result.plan.steps.forEach((step: any, i: number) => {
          log(`  ${i + 1}. ${step.description} (${step.action}: ${step.file})`);
        });
      }
      if (result.appliedFiles) {
        log(`Applied ${result.appliedFiles.length} files`);
      }
    }

    return result;
  } catch (error) {
    throw error;
  }
}

// Agent command handler
async function runAgent(options: GlobalOptions & {
  goal?: string;
  workspaceId?: string;
  mode?: string;
  maxSteps?: number;
  autoApprove?: boolean
}): Promise<unknown> {
  try {
    const projectId = options.projectId || options.workspaceId || "default";
    const goal = options.goal;

    if (!goal) {
      throw new Error("Goal is required (--goal or -g)");
    }

    const response = await apiClient.post("/api/infinity-ai/agent", {
      goal,
      projectId,
      mode: options.mode || "autonomous",
      maxSteps: options.maxSteps || 20,
      autoApprove: options.autoApprove ?? false,
    });

    const result = response.data;
    outputJson(result);

    if (!globalOptions.json) {
      logSuccess("✅ Agent run completed");
      log(`Status: ${result.status}`);
      log(`Steps: ${result.steps?.length || 0}`);
      if (result.summary) {
        log(`Summary: ${result.summary}`);
      }
    }

    return result;
  } catch (error) {
    throw error;
  }
}

// Review command handler
async function runReview(options: GlobalOptions & {
  diff?: string;
  pr?: string;
  base?: string;
  dimensions?: string;
  format?: string;
  output?: string
}): Promise<unknown> {
  try {
    const projectId = options.projectId || "default";
    let diffContent = options.diff;

    // If no diff file provided, get git diff
    if (!diffContent && !options.pr) {
      const { spawn } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFile = promisify(spawn);

      const baseBranch = options.base || "main";
      const { stdout } = await execFile("git", ["diff", `${baseBranch}...HEAD`], { encoding: "utf8" });
      diffContent = stdout.trim();
    }

    if (!diffContent && !options.pr) {
      throw new Error("No diff provided. Use --diff <file> or --pr <number>, or run in a git repo");
    }

    const response = await apiClient.post("/api/infinity-ai/review", {
      projectId,
      diff: diffContent,
      pr: options.pr ? parseInt(options.pr) : undefined,
      baseBranch: options.base || "main",
      dimensions: options.dimensions?.split(",").map(d => d.trim()) || [
        "correctness", "security", "performance", "style", "tests", "breaking-changes", "documentation", "dependencies"
      ],
      format: options.format || "text",
    });

    const result = response.data;
    outputJson(result);

    if (!globalOptions.json) {
      logSuccess("✅ Code review completed");
      log(result.review || JSON.stringify(result, null, 2));
    }

    // Write to output file if specified
    if (options.output) {
      await import("node:fs/promises").then((fs) => fs.writeFile(options.output!, result.review || JSON.stringify(result, null, 2)));
      if (!globalOptions.json) log(`📄 Review written to ${options.output}`);
    }

    return result;
  } catch (error) {
    throw error;
  }
}

// Index command handler
async function runIndex(options: GlobalOptions & {
  projectId?: string;
  force?: boolean;
  watch?: boolean
}): Promise<unknown> {
  try {
    const projectId = options.projectId || "default";

    if (options.watch) {
      log("👀 Watching for changes... (Press Ctrl+C to stop)");
      // TODO: Implement watch mode with file watcher
      logWarn("Watch mode not yet implemented");
      return { success: false, message: "Watch mode not implemented" };
    }

    const response = await apiClient.post("/api/infinity-ai/codebase-index", {
      projectId,
      force: options.force ?? false,
    });

    const result = response.data;
    outputJson(result);

    if (!globalOptions.json) {
      logSuccess("✅ Codebase indexing triggered");
      log(`Status: ${result.status}`);
      if (result.stats) {
        log(`Files: ${result.stats.files}, Chunks: ${result.stats.chunks}`);
      }
    }

    return result;
  } catch (error) {
    throw error;
  }
}

// Completion command handler
async function runCompletion(shell: string): Promise<unknown> {
  const completions = {
    bash: generateBashCompletion(),
    zsh: generateZshCompletion(),
    fish: generateFishCompletion(),
    powershell: generatePowerShellCompletion(),
  };

  const completion = completions[shell as keyof typeof completions];
  if (!completion) {
    throw new Error(`Unsupported shell: ${shell}. Supported: bash, zsh, fish, powershell`);
  }

  console.log(completion);
  return { success: true };
}

function generateBashCompletion(): string {
  return `
# Infinity CLI Bash Completion
_infinity_completion() {
  local cur prev opts
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"

  opts="build plan ask status checkpoint budget snapshot config chat compose agent review index completion open"

  case "${prev}" in
    build)
      COMPREPLY=( $(compgen -W "--prompt --plan --workspace-id --max-iterations --temperature --preview-port --skip-preflight --dry-run --extra-system-prompt --output --no-exit-on-failure" -- ${cur}) )
      return 0
      ;;
    plan)
      COMPREPLY=( $(compgen -W "--prompt --workspace-id --extra-system-prompt" -- ${cur}) )
      return 0
      ;;
    ask)
      COMPREPLY=( $(compgen -W "--prompt" -- ${cur}) )
      return 0
      ;;
    checkpoint)
      COMPREPLY=( $(compgen -W "list create restore delete" -- ${cur}) )
      return 0
      ;;
    budget)
      COMPREPLY=( $(compgen -W "status set" -- ${cur}) )
      return 0
      ;;
    snapshot)
      COMPREPLY=( $(compgen -W "list create restore delete" -- ${cur}) )
      return 0
      ;;
    chat)
      COMPREPLY=( $(compgen -W "--prompt --workspace-id --no-codebase --model --stream --no-stream" -- ${cur}) )
      return 0
      ;;
    compose)
      COMPREPLY=( $(compgen -W "--prompt --workspace-id --plan --max-steps --auto-apply --dry-run" -- ${cur}) )
      return 0
      ;;
    agent)
      COMPREPLY=( $(compgen -W "--goal --workspace-id --mode --max-steps --auto-approve" -- ${cur}) )
      return 0
      ;;
    review)
      COMPREPLY=( $(compgen -W "--diff --pr --base --dimensions --format --output" -- ${cur}) )
      return 0
      ;;
    index)
      COMPREPLY=( $(compgen -W "--project-id --force --watch" -- ${cur}) )
      return 0
      ;;
    completion)
      COMPREPLY=( $(compgen -W "bash zsh fish powershell" -- ${cur}) )
      return 0
      ;;
    open)
      # File completion
      COMPREPLY=( $(compgen -f -- ${cur}) )
      return 0
      ;;
    *)
      COMPREPLY=( $(compgen -W "${opts}" -- ${cur}) )
      return 0
      ;;
  esac
}

complete -F _infinity_completion infinity
`;
}

function generateZshCompletion(): string {
  return `
# Infinity CLI Zsh Completion
#compdef infinity

_infinity() {
  local -a commands
  local -a build_opts
  local -a plan_opts
  local -a ask_opts
  local -a checkpoint_opts
  local -a budget_opts
  local -a snapshot_opts
  local -a chat_opts
  local -a compose_opts
  local -a agent_opts
  local -a review_opts
  local -a index_opts
  local -a completion_opts
  local -a open_opts

  commands=(
    'build:Run a headless build'
    'plan:Create a build plan without executing'
    'ask:Analyze a build request'
    'status:Get build status and saved apps'
    'checkpoint:Manage build checkpoints'
    'budget:Manage build budgets'
    'snapshot:Manage workspace snapshots'
    'config:Show current configuration'
    'chat:Interactive chat with Infinity'
    'compose:Multi-file generation from terminal'
    'agent:Autonomous agent run'
    'review:Agent code review on current diff or PR'
    'index:Trigger codebase re-index'
    'completion:Generate shell completion script'
    'open:Open file in Infinity web UI'
  )

  build_opts=(
    '--prompt[Build prompt/goal]'
    '--plan[JSON plan string]'
    '--workspace-id[Workspace ID]'
    '--max-iterations[Max iterations]'
    '--temperature[Temperature 0-1]'
    '--preview-port[Preview server port]'
    '--skip-preflight[Skip pre-flight checks]'
    '--dry-run[Dry run (plan only)]'
    '--extra-system-prompt[Extra system prompt]'
    '--output[Write JSON output to file]'
    '--no-exit-on-failure[Don\\'t exit with error code on build failure]'
  )

  plan_opts=(
    '--prompt[Build prompt/goal]'
    '--workspace-id[Workspace ID]'
    '--extra-system-prompt[Extra system prompt]'
  )

  ask_opts=(
    '--prompt[Build prompt/goal]'
  )

  checkpoint_opts=(
    'list:List checkpoints'
    'create:Create a checkpoint'
    'restore:Restore a checkpoint'
    'delete:Delete a checkpoint'
  )

  budget_opts=(
    'status:Get budget status'
    'set:Set budget limits (JSON string)'
  )

  snapshot_opts=(
    'list:List snapshots'
    'create:Create a snapshot'
    'restore:Restore a snapshot'
    'delete:Delete a snapshot'
  )

  chat_opts=(
    '--prompt[Initial prompt]'
    '--workspace-id[Workspace ID]'
    '--no-codebase[Disable @codebase context]'
    '--model[Model to use]'
    '--stream/--no-stream[Stream responses]'
  )

  compose_opts=(
    '--prompt[Task/goal description]'
    '--workspace-id[Workspace ID]'
    '--plan[JSON plan string]'
    '--max-steps[Max steps]'
    '--auto-apply[Auto-apply changes without confirmation]'
    '--dry-run[Show plan only, don\\'t execute]'
  )

  agent_opts=(
    '--goal[High-level goal for the agent]'
    '--workspace-id[Workspace ID]'
    '--mode[Mode: autonomous|guided|debug]'
    '--max-steps[Max steps]'
    '--auto-approve[Auto-approve safe actions]'
  )

  review_opts=(
    '--diff[Diff file to review]'
    '--pr[PR number to review]'
    '--base[Base branch for diff]'
    '--dimensions[Comma-separated dimensions]'
    '--format[Output format: text|json|markdown]'
    '--output[Write review to file]'
  )

  index_opts=(
    '--project-id[Project ID]'
    '--force[Force full re-index]'
    '--watch[Watch for changes]'
  )

  completion_opts=(
    'bash:Bash completion'
    'zsh:Zsh completion'
    'fish:Fish completion'
    'powershell:PowerShell completion'
  )

  open_opts=(
    '--line[Line number to open at]: :_files'
  )

  _arguments -C \\
    '(-k --api-key)'{-k,--api-key}'[API key]: :' \\
    '(-u --base-url)'{-u,--base-url}'[API base URL]: :' \\
    '(-p --project-id)'{-p,--project-id}'[Project ID]: :' \\
    '--headless[Run in headless mode]' \\
    '--json[Output JSON only]' \\
    '(-v --verbose)'{-v,--verbose}'[Verbose output]' \\
    ': :_command_names -e' \\
    '*::arg:->args'

  case $state in
    (args)
      curcontext="${curcontext}%${words[1]}"
      case $words[1] in
        build) _arguments -C ${build_opts[@]} ;;
        plan) _arguments -C ${plan_opts[@]} ;;
        ask) _arguments -C ${ask_opts[@]} ;;
        checkpoint) _arguments -C ${checkpoint_opts[@]} ;;
        budget) _arguments -C ${budget_opts[@]} ;;
        snapshot) _arguments -C ${snapshot_opts[@]} ;;
        chat) _arguments -C ${chat_opts[@]} ;;
        compose) _arguments -C ${compose_opts[@]} ;;
        agent) _arguments -C ${agent_opts[@]} ;;
        review) _arguments -C ${review_opts[@]} ;;
        index) _arguments -C ${index_opts[@]} ;;
        completion) _arguments -C ${completion_opts[@]} ;;
        open) _arguments -C ${open_opts[@]} ;;
      esac
      ;;
  esac
}

_infinity "$@"
`;
}

function generateFishCompletion(): string {
  return `
# Infinity CLI Fish Completion
# Save as ~/.config/fish/completions/infinity.fish

complete -c infinity -f -n '__fish_use_subcommand' -a 'build plan ask status checkpoint budget snapshot config chat compose agent review index completion open'

# Global options
complete -c infinity -s k -l api-key -d "API key"
complete -c infinity -s u -l base-url -d "API base URL"
complete -c infinity -s p -l project-id -d "Project ID"
complete -c infinity -l headless -d "Run in headless mode"
complete -c infinity -l json -d "Output JSON only"
complete -c infinity -s v -l verbose -d "Verbose output"

# build command
complete -c infinity -n '__fish_seen_subcommand_from build' -l prompt -d "Build prompt/goal"
complete -c infinity -n '__fish_seen_subcommand_from build' -l plan -d "JSON plan string"
complete -c infinity -n '__fish_seen_subcommand_from build' -l workspace-id -d "Workspace ID"
complete -c infinity -n '__fish_seen_subcommand_from build' -l max-iterations -d "Max iterations"
complete -c infinity -n '__fish_seen_subcommand_from build' -l temperature -d "Temperature 0-1"
complete -c infinity -n '__fish_seen_subcommand_from build' -l preview-port -d "Preview server port"
complete -c infinity -n '__fish_seen_subcommand_from build' -l skip-preflight -d "Skip pre-flight checks"
complete -c infinity -n '__fish_seen_subcommand_from build' -l dry-run -d "Dry run (plan only)"
complete -c infinity -n '__fish_seen_subcommand_from build' -l extra-system-prompt -d "Extra system prompt"
complete -c infinity -n '__fish_seen_subcommand_from build' -l output -d "Write JSON output to file"
complete -c infinity -n '__fish_seen_subcommand_from build' -l no-exit-on-failure -d "Don't exit with error code on build failure"

# plan command
complete -c infinity -n '__fish_seen_subcommand_from plan' -l prompt -d "Build prompt/goal"
complete -c infinity -n '__fish_seen_subcommand_from plan' -l workspace-id -d "Workspace ID"
complete -c infinity -n '__fish_seen_subcommand_from plan' -l extra-system-prompt -d "Extra system prompt"

# ask command
complete -c infinity -n '__fish_seen_subcommand_from ask' -l prompt -d "Build prompt/goal"

# checkpoint command
complete -c infinity -n '__fish_seen_subcommand_from checkpoint' -a 'list create restore delete'

# budget command
complete -c infinity -n '__fish_seen_subcommand_from budget' -a 'status set'

# snapshot command
complete -c infinity -n '__fish_seen_subcommand_from snapshot' -a 'list create restore delete'

# chat command
complete -c infinity -n '__fish_seen_subcommand_from chat' -l prompt -d "Initial prompt"
complete -c infinity -n '__fish_seen_subcommand_from chat' -l workspace-id -d "Workspace ID"
complete -c infinity -n '__fish_seen_subcommand_from chat' -l no-codebase -d "Disable @codebase context"
complete -c infinity -n '__fish_seen_subcommand_from chat' -l model -d "Model to use"
complete -c infinity -n '__fish_seen_subcommand_from chat' -l stream -d "Stream responses"
complete -c infinity -n '__fish_seen_subcommand_from chat' -l no-stream -d "Don't stream responses"

# compose command
complete -c infinity -n '__fish_seen_subcommand_from compose' -l prompt -d "Task/goal description"
complete -c infinity -n '__fish_seen_subcommand_from compose' -l workspace-id -d "Workspace ID"
complete -c infinity -n '__fish_seen_subcommand_from compose' -l plan -d "JSON plan string"
complete -c infinity -n '__fish_seen_subcommand_from compose' -l max-steps -d "Max steps"
complete -c infinity -n '__fish_seen_subcommand_from compose' -l auto-apply -d "Auto-apply changes without confirmation"
complete -c infinity -n '__fish_seen_subcommand_from compose' -l dry-run -d "Show plan only, don't execute"

# agent command
complete -c infinity -n '__fish_seen_subcommand_from agent' -l goal -d "High-level goal for the agent"
complete -c infinity -n '__fish_seen_subcommand_from agent' -l workspace-id -d "Workspace ID"
complete -c infinity -n '__fish_seen_subcommand_from agent' -l mode -d "Mode: autonomous|guided|debug" -xa 'autonomous guided debug'
complete -c infinity -n '__fish_seen_subcommand_from agent' -l max-steps -d "Max steps"
complete -c infinity -n '__fish_seen_subcommand_from agent' -l auto-approve -d "Auto-approve safe actions"

# review command
complete -c infinity -n '__fish_seen_subcommand_from review' -l diff -d "Diff file to review"
complete -c infinity -n '__fish_seen_subcommand_from review' -l pr -d "PR number to review"
complete -c infinity -n '__fish_seen_subcommand_from review' -l base -d "Base branch for diff"
complete -c infinity -n '__fish_seen_subcommand_from review' -l dimensions -d "Comma-separated dimensions"
complete -c infinity -n '__fish_seen_subcommand_from review' -l format -d "Output format" -xa 'text json markdown'
complete -c infinity -n '__fish_seen_subcommand_from review' -l output -d "Write review to file"

# index command
complete -c infinity -n '__fish_seen_subcommand_from index' -l project-id -d "Project ID"
complete -c infinity -n '__fish_seen_subcommand_from index' -l force -d "Force full re-index"
complete -c infinity -n '__fish_seen_subcommand_from index' -l watch -d "Watch for changes"

# completion command
complete -c infinity -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish powershell'

# open command
complete -c infinity -n '__fish_seen_subcommand_from open' -f -l line -d "Line number to open at"
`;
}

function generatePowerShellCompletion(): string {
  return `
# Infinity CLI PowerShell Completion
# Save as ~/.config/powershell/completions/infinity.ps1 or add to profile

Register-ArgumentCompleter -Native -CommandName infinity -ScriptBlock {
  param($commandName, $wordToComplete, $cursorPosition)

  $commands = @(
    'build','plan','ask','status','checkpoint','budget','snapshot','config',
    'chat','compose','agent','review','index','completion','open'
  )

  $globalOptions = @('-k','--api-key','-u','--base-url','-p','--project-id','--headless','--json','-v','--verbose')

  $buildOptions = @('--prompt','--plan','--workspace-id','--max-iterations','--temperature','--preview-port','--skip-preflight','--dry-run','--extra-system-prompt','--output','--no-exit-on-failure')
  $planOptions = @('--prompt','--workspace-id','--extra-system-prompt')
  $askOptions = @('--prompt')
  $checkpointSubcommands = @('list','create','restore','delete')
  $budgetSubcommands = @('status','set')
  $snapshotSubcommands = @('list','create','restore','delete')
  $chatOptions = @('--prompt','--workspace-id','--no-codebase','--model','--stream','--no-stream')
  $composeOptions = @('--prompt','--workspace-id','--plan','--max-steps','--auto-apply','--dry-run')
  $agentOptions = @('--goal','--workspace-id','--mode','--max-steps','--auto-approve')
  $reviewOptions = @('--diff','--pr','--base','--dimensions','--format','--output')
  $indexOptions = @('--project-id','--force','--watch')
  $completionOptions = @('bash','zsh','fish','powershell')
  $openOptions = @('--line')

  $words = $commandName -split ' '
  $wordCount = $words.Count

  if ($wordCount -eq 1) {
    return $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_) }
  }

  $subcommand = $words[1]
  $lastWord = $words[-1]

  switch ($subcommand) {
    'build' {
      return $buildOptions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_) }
    }
    'plan' {
      return $planOptions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_) }
    }
    'ask' {
      return $askOptions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_) }
    }
    'checkpoint' {
      return $checkpointSubcommands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_) }
    }
    'budget' {
      return $budgetSubcommands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_) }
    }
    'snapshot' {
      return $snapshotSubcommands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_) }
    }
    'chat' {
      return $chatOptions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_) }
    }
    'compose' {
      return $composeOptions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_) }
    }
    'agent' {
      return $agentOptions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_) }
    }
    'review' {
      return $reviewOptions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_) }
    }
    'index' {
      return $indexOptions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_) }
    }
    'completion' {
      return $completionOptions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_) }
    }
    'open' {
      return $openOptions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_) }
    }
    default {
      return $globalOptions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_) }
    }
  }
}
`;
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

// Chat command
program
  .command("chat")
  .description("Interactive chat with Infinity (codebase context)")
  .option("--prompt <prompt>", "Initial prompt (starts interactive if omitted)")
  .option("-w, --workspace-id <id>", "Workspace ID (default: projectId)")
  .option("--no-codebase", "Disable @codebase context")
  .option("--model <model>", "Model to use (default: auto)")
  .option("--stream/--no-stream", "Stream responses (default: true)", true)
  .action(async (options) => {
    await runChat({ ...globalOptions, ...options });
  });

// Compose command
program
  .command("compose")
  .description("Multi-file generation from terminal (Composer mode)")
  .option("--prompt <prompt>", "Task/goal description")
  .option("-w, --workspace-id <id>", "Workspace ID (default: projectId)")
  .option("--plan <plan>", "JSON plan string (optional)")
  .option("--max-steps <n>", "Max steps (default: 10)", "10")
  .option("--auto-apply", "Auto-apply changes without confirmation")
  .option("--dry-run", "Show plan only, don't execute")
  .action(async (options) => {
    await runCompose({ ...globalOptions, ...options });
  });

// Agent command
program
  .command("agent")
  .description("Autonomous agent run (Agent mode)")
  .option("--goal <goal>", "High-level goal for the agent")
  .option("-w, --workspace-id <id>", "Workspace ID (default: projectId)")
  .option("--mode <mode>", "Mode: autonomous | guided | debug (default: autonomous)", "autonomous")
  .option("--max-steps <n>", "Max steps (default: 20)", "20")
  .option("--auto-approve", "Auto-approve safe actions")
  .action(async (options) => {
    await runAgent({ ...globalOptions, ...options });
  });

// Review command
program
  .command("review")
  .description("Agent code review on current diff or PR")
  .option("--diff <file>", "Diff file to review (default: git diff)")
  .option("--pr <number>", "PR number to review")
  .option("--base <branch>", "Base branch for diff (default: main)")
  .option("--dimensions <list>", "Comma-separated: correctness,security,performance,style,tests,breaking,docs,deps")
  .option("--format <format>", "Output format: text | json | markdown (default: text)", "text")
  .option("--output <file>", "Write review to file")
  .action(async (options) => {
    await runReview({ ...globalOptions, ...options });
  });

// Index command
program
  .command("index")
  .description("Trigger codebase re-index")
  .option("--project-id <id>", "Project ID (default: current)")
  .option("--force", "Force full re-index")
  .option("--watch", "Watch for changes and re-index incrementally")
  .action(async (options) => {
    await runIndex({ ...globalOptions, ...options });
  });

// Completion command (for shell completions)
program
  .command("completion")
  .description("Generate shell completion script")
  .argument("<shell>", "Shell type: bash | zsh | fish | powershell")
  .action(async (shell) => {
    await runCompletion(shell);
  });

// Open command (shell integration)
program
  .command("open <file>")
  .description("Open file in Infinity web UI")
  .option("--line <n>", "Line number to open at")
  .action(async (file, options) => {
    await runOpen(file, { ...globalOptions, ...options });
  });

// Parse and handle errors
program.parseAsync(process.argv).catch((error) => {
  handleError(error, "CLI execution");
});

// Export for testing
export { program, runHeadlessBuild, runPlan, runAsk, runStatus, runCheckpoint, runBudget, runSnapshot };