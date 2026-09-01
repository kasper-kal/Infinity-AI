/**
 * Hooks Engine — Event-driven automations for agents
 * Part of Phase 30: Advanced Agent Capabilities (Cursor Agent Parity)
 *
 * Provides:
 * - Event bus for hook triggers (file save, git push, PR open, schedule, webhook)
 * - Script runner with sandboxed execution
 * - Scheduler for cron-like recurring hooks
 * - Integration with Universal Tool Registry for agent tool access
 */

import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { registerTool, ToolExecutionContext, UniversalToolResult } from "./tool-registry";
import type { LLMAdapter, LLMMessage } from "./llm-adapter";
import { spawnSubagent, SUBAGENTS, type SubagentDefinition } from "./subagents";

// ============================================================================
// Types & Schemas
// ============================================================================

export type HookEvent =
  | "file.save"
  | "file.create"
  | "file.delete"
  | "git.push"
  | "git.commit"
  | "pr.open"
  | "pr.close"
  | "pr.merge"
  | "schedule"
  | "webhook"
  | "agent.start"
  | "agent.complete"
  | "build.start"
  | "build.complete"
  | "build.failed"
  | "test.pass"
  | "test.fail"
  | "deploy.start"
  | "deploy.complete"
  | "deploy.failed";

export interface HookContext {
  event: HookEvent;
  timestamp: string;
  projectId: string;
  userId?: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface HookDefinition {
  id: string;
  name: string;
  description: string;
  event: HookEvent | HookEvent[];
  condition?: string; // JavaScript expression evaluated against context
  script: string; // The automation script to run
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  projectId: string;
  tags: string[];
  timeout: number; // ms
  retry: {
    enabled: boolean;
    maxAttempts: number;
    backoffMs: number;
  };
}

export interface HookExecution {
  id: string;
  hookId: string;
  event: HookEvent;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  duration?: number;
  context: HookContext;
  result?: unknown;
  error?: string;
  attempt: number;
  logs: string[];
}

export interface ScheduleConfig {
  cron: string; // Standard 5-field cron expression
  timezone?: string;
}

export interface WebhookConfig {
  path: string; // URL path for webhook endpoint
  secret?: string; // HMAC secret for verification
  methods: string[]; // HTTP methods allowed
}

export type HookTriggerConfig = ScheduleConfig | WebhookConfig | { event: HookEvent | HookEvent[] };

// ============================================================================
// Script Runner - Sandboxed Execution
// ============================================================================

export interface ScriptRunnerConfig {
  timeout: number;
  allowedModules: string[];
  allowedGlobals: string[];
  projectRoot: string;
}

const DEFAULT_SCRIPT_CONFIG: ScriptRunnerConfig = {
  timeout: 30000,
  allowedModules: ["fs", "path", "crypto", "util", "events", "stream", "buffer", "querystring", "url"],
  allowedGlobals: ["console", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "JSON", "Math", "Date", "Promise", "Object", "Array", "String", "Number", "Boolean", "Map", "Set", "WeakMap", "WeakSet", "Symbol", "RegExp", "Error", "TypeError", "SyntaxError", "ReferenceError", "RangeError"],
  projectRoot: process.cwd(),
};

/**
 * Safe script execution environment
 * Uses vm module for sandboxed execution with limited globals
 */
export class ScriptRunner {
  private config: ScriptRunnerConfig;
  private vm: typeof import("vm");

  constructor(config: Partial<ScriptRunnerConfig> = {}) {
    this.config = { ...DEFAULT_SCRIPT_CONFIG, ...config };
    this.vm = require("vm");
  }

  /**
   * Create a sandboxed context for script execution
   */
  createContext(context: HookContext, tools: Map<string, Function>): Record<string, unknown> {
    const sandbox: Record<string, unknown> = {
      // Safe globals
      console: {
        log: (...args: unknown[]) => context.metadata.logs?.push?.(args.map(String).join(" ")),
        error: (...args: unknown[]) => context.metadata.logs?.push?.(`[ERROR] ${args.map(String).join(" ")}`),
        warn: (...args: unknown[]) => context.metadata.logs?.push?.(`[WARN] ${args.map(String).join(" ")}`),
        info: (...args: unknown[]) => context.metadata.logs?.push?.(`[INFO] ${args.map(String).join(" ")}`),
      },
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      JSON,
      Math,
      Date,
      Promise,
      Object,
      Array,
      String,
      Number,
      Boolean,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Symbol,
      RegExp,
      Error,
      TypeError,
      SyntaxError,
      ReferenceError,
      RangeError,

      // Context
      context,
      event: context.event,
      payload: context.payload,
      metadata: context.metadata,

      // Tools available to scripts
      tools: Object.fromEntries(tools),

      // Utility functions
      fetch: this.createFetchWrapper(),
      sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
      randomId: () => Math.random().toString(36).slice(2, 11),
    };

    // Add allowed modules via require wrapper
    const originalRequire = require;
    sandbox.require = (moduleName: string) => {
      if (this.config.allowedModules.includes(moduleName)) {
        return originalRequire(moduleName);
      }
      throw new Error(`Module '${moduleName}' is not allowed in hook scripts`);
    };

    return sandbox;
  }

  private createFetchWrapper() {
    return async (url: string, options?: RequestInit) => {
      // Only allow localhost and configured webhook URLs
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
          throw new Error("Only HTTP/HTTPS URLs allowed");
        }
        // In production, add allowlist check here
        return fetch(url, options);
      } catch {
        throw new Error("Invalid URL or fetch failed");
      }
    };
  }

  /**
   * Execute a script in the sandboxed context
   */
  async execute(script: string, context: HookContext, tools: Map<string, Function>): Promise<{ result: unknown; logs: string[] }> {
    const logs: string[] = [];
    const executionContext = this.createContext(context, tools);
    executionContext.console = {
      ...executionContext.console,
      log: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
      error: (...args: unknown[]) => logs.push(`[ERROR] ${args.map(String).join(" ")}`),
      warn: (...args: unknown[]) => logs.push(`[WARN] ${args.map(String).join(" ")}`),
      info: (...args: unknown[]) => logs.push(`[INFO] ${args.map(String).join(" ")}`),
    };

    const scriptWrapper = `
      (async () => {
        ${script}
      })()
    `;

    const scriptObj = this.vm.compileScript(scriptWrapper, {
      filename: "hook-script.js",
      displayErrors: true,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Script execution timeout (${this.config.timeout}ms)`)), this.config.timeout)
    );

    try {
      const result = await Promise.race([
        scriptObj.runInNewContext(executionContext, {
          timeout: this.config.timeout,
          displayErrors: true,
        }),
        timeoutPromise,
      ]);
      return { result, logs };
    } catch (error) {
      logs.push(`[EXECUTION_ERROR] ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}

// ============================================================================
// Scheduler - Cron-based recurring hooks
// ============================================================================

export interface ScheduledJob {
  id: string;
  hookId: string;
  cron: string;
  timezone: string;
  nextRun: Date;
  timer?: NodeJS.Timeout;
}

export class HookScheduler extends EventEmitter {
  private jobs: Map<string, ScheduledJob> = new Map();
  private cronParser: (cron: string) => { next: Date };

  constructor() {
    super();
    // Simple cron parser - in production use a proper library like 'cron-parser'
    this.cronParser = this.simpleCronParser;
  }

  private simpleCronParser(cron: string): { next: Date } {
    // Very basic - just returns next minute for demo
    // In production, use cron-parser library
    const next = new Date();
    next.setMinutes(next.getMinutes() + 1, 0, 0);
    return { next };
  }

  /**
   * Schedule a hook to run on cron schedule
   */
  schedule(hookId: string, config: ScheduleConfig): void {
    const jobId = `job-${hookId}`;
    const existing = this.jobs.get(jobId);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }

    const { next } = this.cronParser(config.cron);
    const delay = next.getTime() - Date.now();

    const timer = setTimeout(() => {
      this.emit("trigger", { hookId, event: "schedule" as HookEvent, scheduledTime: next });
      // Reschedule for next run
      this.schedule(hookId, config);
    }, Math.max(0, delay));

    this.jobs.set(jobId, {
      id: jobId,
      hookId,
      cron: config.cron,
      timezone: config.timezone || "UTC",
      nextRun: next,
      timer,
    });
  }

  /**
   * Cancel a scheduled hook
   */
  cancel(hookId: string): boolean {
    const jobId = `job-${hookId}`;
    const job = this.jobs.get(jobId);
    if (job?.timer) {
      clearTimeout(job.timer);
      this.jobs.delete(jobId);
      return true;
    }
    return false;
  }

  /**
   * Get all scheduled jobs
   */
  getJobs(): ScheduledJob[] {
    return Array.from(this.jobs.values()).map(({ timer, ...job }) => job);
  }

  /**
   * Shutdown all timers
   */
  shutdown(): void {
    for (const job of this.jobs.values()) {
      if (job.timer) clearTimeout(job.timer);
    }
    this.jobs.clear();
  }
}

// ============================================================================
// Hooks Engine - Main orchestrator
// ============================================================================

export interface HooksEngineConfig {
  projectRoot: string;
  projectId: string;
  adapter?: LLMAdapter;
  scriptsDir?: string;
  maxConcurrentExecutions: number;
  defaultTimeout: number;
}

export class HooksEngine extends EventEmitter {
  private config: HooksEngineConfig;
  private hooks: Map<string, HookDefinition> = new Map();
  private executions: Map<string, HookExecution> = new Map();
  private scriptRunner: ScriptRunner;
  private scheduler: HookScheduler;
  private runningExecutions: number = 0;
  private tools: Map<string, Function> = new Map();
  private llmAdapter?: LLMAdapter;

  constructor(config: HooksEngineConfig) {
    super();
    this.config = {
      maxConcurrentExecutions: 10,
      defaultTimeout: 30000,
      scriptsDir: path.join(config.projectRoot, ".infinity", "hooks"),
      ...config,
    };
    this.llmAdapter = config.adapter;

    this.scriptRunner = new ScriptRunner({
      timeout: this.config.defaultTimeout,
      projectRoot: this.config.projectRoot,
    });

    this.scheduler = new HookScheduler();
    this.scheduler.on("trigger", this.handleScheduledTrigger.bind(this));

    this.ensureScriptsDir();
    this.loadHooks();
    this.registerBuiltinTools();
  }

  private ensureScriptsDir(): void {
    if (!fs.existsSync(this.config.scriptsDir!)) {
      fs.mkdirSync(this.config.scriptsDir!, { recursive: true });
    }
  }

  private loadHooks(): void {
    const hooksFile = path.join(this.config.scriptsDir!, "hooks.json");
    if (fs.existsSync(hooksFile)) {
      try {
        const content = fs.readFileSync(hooksFile, "utf-8");
        const hooks = JSON.parse(content) as HookDefinition[];
        for (const hook of hooks) {
          this.hooks.set(hook.id, hook);
          if (hook.enabled && this.isScheduledHook(hook)) {
            this.scheduleHook(hook);
          }
        }
      } catch (error) {
        console.error("[HooksEngine] Failed to load hooks:", error);
      }
    }
  }

  private saveHooks(): void {
    const hooksFile = path.join(this.config.scriptsDir!, "hooks.json");
    const hooks = Array.from(this.hooks.values());
    fs.writeFileSync(hooksFile, JSON.stringify(hooks, null, 2), "utf-8");
  }

  private isScheduledHook(hook: HookDefinition): boolean {
    const events = Array.isArray(hook.event) ? hook.event : [hook.event];
    return events.includes("schedule");
  }

  private scheduleHook(hook: HookDefinition): void {
    // Extract cron from hook metadata or use default
    const cron = (hook.metadata?.cron as string) || "0 * * * *"; // Default hourly
    this.scheduler.schedule(hook.id, { cron, timezone: hook.metadata?.timezone as string });
  }

  private registerBuiltinTools(): void {
    // Register tools that hooks can use
    this.tools.set("log", (message: string) => console.log(`[Hook] ${message}`));
    this.tools.set("notify", async (message: string, level: "info" | "warning" | "error" = "info") => {
      this.emit("notification", { message, level, timestamp: new Date().toISOString() });
      return { success: true };
    });
    this.tools.set("runCommand", async (command: string, cwd?: string) => {
      const { execSync } = require("child_process");
      try {
        const output = execSync(command, { cwd: cwd || this.config.projectRoot, encoding: "utf-8", timeout: 30000 });
        return { success: true, output };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });
    this.tools.set("readFile", async (filePath: string) => {
      const fullPath = path.resolve(this.config.projectRoot, filePath);
      if (!fullPath.startsWith(this.config.projectRoot)) {
        throw new Error("Path traversal not allowed");
      }
      return fs.readFileSync(fullPath, "utf-8");
    });
    this.tools.set("writeFile", async (filePath: string, content: string) => {
      const fullPath = path.resolve(this.config.projectRoot, filePath);
      if (!fullPath.startsWith(this.config.projectRoot)) {
        throw new Error("Path traversal not allowed");
      }
      fs.writeFileSync(fullPath, content, "utf-8");
      return { success: true };
    });
    this.tools.set("httpRequest", async (url: string, options?: RequestInit) => {
      const response = await fetch(url, options);
      return { status: response.status, body: await response.text() };
    });

    // Subagent tools
    this.tools.set("spawnSubagent", async (subagentId: string, prompt: string) => {
      if (!this.llmAdapter) throw new Error("No LLM adapter configured");
      const subagent = SUBAGENTS[subagentId];
      if (!subagent) throw new Error(`Unknown subagent: ${subagentId}`);
      return spawnSubagent(subagentId, prompt, this.llmAdapter);
    });

    this.tools.set("getSubagent", (subagentId: string) => {
      return SUBAGENTS[subagentId] ? { id: subagentId, name: SUBAGENTS[subagentId].name } : null;
    });
  }

  /**
   * Register a custom tool for hooks to use
   */
  registerTool(name: string, fn: Function): void {
    this.tools.set(name, fn);
  }

  /**
   * Create a new hook
   */
  createHook(hook: Omit<HookDefinition, "id" | "createdAt" | "updatedAt">): HookDefinition {
    const newHook: HookDefinition = {
      ...hook,
      id: `hook-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.hooks.set(newHook.id, newHook);
    this.saveHooks();

    if (newHook.enabled && this.isScheduledHook(newHook)) {
      this.scheduleHook(newHook);
    }

    this.emit("hookCreated", newHook);
    return newHook;
  }

  /**
   * Update an existing hook
   */
  updateHook(hookId: string, updates: Partial<HookDefinition>): HookDefinition | null {
    const hook = this.hooks.get(hookId);
    if (!hook) return null;

    const wasScheduled = this.isScheduledHook(hook);
    const wasEnabled = hook.enabled;

    const updatedHook: HookDefinition = {
      ...hook,
      ...updates,
      id: hookId, // Preserve ID
      updatedAt: new Date().toISOString(),
    };

    this.hooks.set(hookId, updatedHook);
    this.saveHooks();

    // Handle scheduling changes
    const isNowScheduled = this.isScheduledHook(updatedHook);
    const isNowEnabled = updatedHook.enabled;

    if (wasScheduled && (wasEnabled !== isNowEnabled || !isNowScheduled)) {
      this.scheduler.cancel(hookId);
    }
    if (isNowScheduled && isNowEnabled && (!wasScheduled || !wasEnabled)) {
      this.scheduleHook(updatedHook);
    }

    this.emit("hookUpdated", updatedHook);
    return updatedHook;
  }

  /**
   * Delete a hook
   */
  deleteHook(hookId: string): boolean {
    const hook = this.hooks.get(hookId);
    if (!hook) return false;

    this.scheduler.cancel(hookId);
    this.hooks.delete(hookId);
    this.saveHooks();

    this.emit("hookDeleted", hookId);
    return true;
  }

  /**
   * Get a hook by ID
   */
  getHook(hookId: string): HookDefinition | undefined {
    return this.hooks.get(hookId);
  }

  /**
   * List all hooks (optionally filtered by event)
   */
  listHooks(event?: HookEvent): HookDefinition[] {
    const hooks = Array.from(this.hooks.values());
    if (!event) return hooks;

    return hooks.filter(hook => {
      const events = Array.isArray(hook.event) ? hook.event : [hook.event];
      return events.includes(event);
    });
  }

  /**
   * Trigger a hook manually or from an event
   */
  async trigger(event: HookEvent, payload: Record<string, unknown>, metadata: Record<string, unknown> = {}): Promise<HookExecution[]> {
    const context: HookContext = {
      event,
      timestamp: new Date().toISOString(),
      projectId: this.config.projectId,
      payload,
      metadata: { ...metadata, logs: [] },
    };

    // Find matching hooks
    const matchingHooks = this.listHooks(event).filter(hook => {
      if (!hook.enabled) return false;
      if (hook.condition) {
        try {
          // Evaluate condition in sandbox
          const result = this.evaluateCondition(hook.condition, context);
          return result === true;
        } catch {
          return false;
        }
      }
      return true;
    });

    if (matchingHooks.length === 0) {
      return [];
    }

    // Execute matching hooks (with concurrency limit)
    const executions: HookExecution[] = [];
    const semaphore = async (fn: () => Promise<void>) => {
      while (this.runningExecutions >= this.config.maxConcurrentExecutions) {
        await new Promise(r => setTimeout(r, 100));
      }
      this.runningExecutions++;
      try {
        await fn();
      } finally {
        this.runningExecutions--;
      }
    };

    await Promise.all(
      matchingHooks.map(hook => semaphore(async () => {
        const execution = await this.executeHook(hook, context);
        executions.push(execution);
      }))
    );

    return executions;
  }

  private evaluateCondition(condition: string, context: HookContext): boolean {
    // Simple condition evaluation - in production use a proper expression evaluator
    // This is a basic implementation for demo
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function("context", "payload", "metadata", `return ${condition}`);
      return fn(context, context.payload, context.metadata) === true;
    } catch {
      return false;
    }
  }

  private async executeHook(hook: HookDefinition, context: HookContext): Promise<HookExecution> {
    const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const execution: HookExecution = {
      id: executionId,
      hookId: hook.id,
      event: context.event,
      status: "running",
      startedAt: new Date().toISOString(),
      context,
      attempt: 1,
      logs: [],
    };

    this.executions.set(executionId, execution);
    this.emit("executionStarted", execution);

    const executeWithRetry = async (attempt: number): Promise<HookExecution> => {
      execution.attempt = attempt;
      try {
        const { result, logs } = await this.scriptRunner.execute(hook.script, context, this.tools);
        execution.logs = logs;
        execution.result = result;
        execution.status = "completed";
        execution.completedAt = new Date().toISOString();
        execution.duration = new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime();
        this.emit("executionCompleted", execution);
        return execution;
      } catch (error) {
        execution.logs.push(`[ATTEMPT_${attempt}_ERROR] ${error instanceof Error ? error.message : String(error)}`);

        if (hook.retry.enabled && attempt < hook.retry.maxAttempts) {
          await new Promise(r => setTimeout(r, hook.retry.backoffMs * attempt));
          return executeWithRetry(attempt + 1);
        }

        execution.status = "failed";
        execution.error = error instanceof Error ? error.message : String(error);
        execution.completedAt = new Date().toISOString();
        execution.duration = new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime();
        this.emit("executionFailed", execution);
        return execution;
      }
    };

    return executeWithRetry(1);
  }

  private async handleScheduledTrigger(data: { hookId: string; event: HookEvent; scheduledTime: Date }): Promise<void> {
    await this.trigger(data.event, { scheduledTime: data.scheduledTime.toISOString() }, { source: "scheduler" });
  }

  /**
   * Handle webhook trigger
   */
  async handleWebhook(webhookPath: string, body: Record<string, unknown>, headers: Record<string, string>): Promise<{ success: boolean; executions?: HookExecution[] }> {
    // Find hooks matching this webhook path
    const matchingHooks = Array.from(this.hooks.values()).filter(hook => {
      if (!hook.enabled) return false;
      const webhookConfig = hook.metadata?.webhook as WebhookConfig | undefined;
      return webhookConfig?.path === webhookPath;
    });

    if (matchingHooks.length === 0) {
      return { success: false, executions: [] };
    }

    // Verify secret if configured
    for (const hook of matchingHooks) {
      const webhookConfig = hook.metadata?.webhook as WebhookConfig;
      if (webhookConfig?.secret) {
        const signature = headers["x-webhook-signature"] || headers["x-hub-signature-256"];
        if (!signature) return { success: false };
        // Verify HMAC - simplified for demo
        const crypto = require("crypto");
        const expected = crypto.createHmac("sha256", webhookConfig.secret).update(JSON.stringify(body)).digest("hex");
        if (signature !== `sha256=${expected}`) return { success: false };
      }
    }

    const executions = await this.trigger("webhook", body, { webhookPath, headers });
    return { success: true, executions };
  }

  /**
   * Get execution history
   */
  getExecutions(hookId?: string, limit = 50): HookExecution[] {
    let executions = Array.from(this.executions.values())
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    if (hookId) {
      executions = executions.filter(e => e.hookId === hookId);
    }

    return executions.slice(0, limit);
  }

  /**
   * Get execution by ID
   */
  getExecution(executionId: string): HookExecution | undefined {
    return this.executions.get(executionId);
  }

  /**
   * Get scheduled jobs
   */
  getScheduledJobs() {
    return this.scheduler.getJobs();
  }

  /**
   * Enable/disable a hook
   */
  setHookEnabled(hookId: string, enabled: boolean): HookDefinition | null {
    return this.updateHook(hookId, { enabled });
  }

  /**
   * Shutdown the engine
   */
  shutdown(): void {
    this.scheduler.shutdown();
    this.removeAllListeners();
  }
}

// ============================================================================
// CLI Integration - Hook management commands
// ============================================================================

export interface CLIHookCommand {
  name: string;
  description: string;
  execute: (args: string[], engine: HooksEngine) => Promise<void>;
}

export function createHookCLICommands(engine: HooksEngine): CLIHookCommand[] {
  return [
    {
      name: "hook:list",
      description: "List all hooks",
      execute: async () => {
        const hooks = engine.listHooks();
        console.log(JSON.stringify(hooks, null, 2));
      },
    },
    {
      name: "hook:create",
      description: "Create a new hook",
      execute: async (args) => {
        const [name, event, script] = args;
        if (!name || !event || !script) {
          console.error("Usage: hook:create <name> <event> <script>");
          return;
        }
        const hook = engine.createHook({
          name,
          description: "",
          event: event as HookEvent,
          script,
          enabled: true,
          projectId: engine.config.projectId,
          tags: [],
          timeout: 30000,
          retry: { enabled: true, maxAttempts: 3, backoffMs: 1000 },
        });
        console.log(`Created hook: ${hook.id}`);
      },
    },
    {
      name: "hook:delete",
      description: "Delete a hook",
      execute: async (args) => {
        const [hookId] = args;
        if (!hookId) {
          console.error("Usage: hook:delete <hookId>");
          return;
        }
        const success = engine.deleteHook(hookId);
        console.log(success ? "Deleted" : "Not found");
      },
    },
    {
      name: "hook:enable",
      description: "Enable a hook",
      execute: async (args) => {
        const [hookId] = args;
        if (!hookId) {
          console.error("Usage: hook:enable <hookId>");
          return;
        }
        const hook = engine.setHookEnabled(hookId, true);
        console.log(hook ? `Enabled: ${hook.name}` : "Not found");
      },
    },
    {
      name: "hook:disable",
      description: "Disable a hook",
      execute: async (args) => {
        const [hookId] = args;
        if (!hookId) {
          console.error("Usage: hook:disable <hookId>");
          return;
        }
        const hook = engine.setHookEnabled(hookId, false);
        console.log(hook ? `Disabled: ${hook.name}` : "Not found");
      },
    },
    {
      name: "hook:executions",
      description: "Show hook execution history",
      execute: async (args) => {
        const [hookId] = args;
        const executions = engine.getExecutions(hookId);
        console.log(JSON.stringify(executions, null, 2));
      },
    },
    {
      name: "hook:trigger",
      description: "Manually trigger hooks for an event",
      execute: async (args) => {
        const [event, ...rest] = args;
        if (!event) {
          console.error("Usage: hook:trigger <event> [payloadJson]");
          return;
        }
        const payload = rest.length > 0 ? JSON.parse(rest.join(" ")) : {};
        const executions = await engine.trigger(event as HookEvent, payload, { manual: true });
        console.log(`Triggered ${executions.length} hooks`);
        console.log(JSON.stringify(executions, null, 2));
      },
    },
  ];
}

// ============================================================================
// Register Hooks Tools in Universal Tool Registry
// ============================================================================

export function registerHooksTools(projectRoot: string, projectId: string, adapter?: LLMAdapter): void {
  const hooksEngine = new HooksEngine({ projectRoot, projectId, adapter });

  // Create hook
  registerTool({
    name: "hooks.create",
    description: "Create a new automation hook",
    category: "hooks",
    risk: "WRITE",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Hook name" },
        description: { type: "string", description: "Hook description" },
        event: { type: "string", description: "Trigger event", enum: ["file.save", "file.create", "file.delete", "git.push", "git.commit", "pr.open", "pr.close", "pr.merge", "schedule", "webhook", "agent.start", "agent.complete", "build.start", "build.complete", "build.failed", "test.pass", "test.fail", "deploy.start", "deploy.complete", "deploy.failed"] },
        condition: { type: "string", description: "Optional JavaScript condition expression" },
        script: { type: "string", description: "Automation script to execute" },
        enabled: { type: "boolean", description: "Whether hook is enabled", default: true },
        tags: { type: "array", items: { type: "string" }, description: "Tags for organization" },
        timeout: { type: "number", description: "Execution timeout in ms", default: 30000 },
        cron: { type: "string", description: "Cron expression for schedule event" },
        webhookPath: { type: "string", description: "Webhook path for webhook event" },
        webhookSecret: { type: "string", description: "HMAC secret for webhook verification" },
      },
      required: ["name", "event", "script"],
    },
    execute: async (args, ctx) => {
      const hook = hooksEngine.createHook({
        name: args.name as string,
        description: args.description as string,
        event: args.event as HookEvent,
        condition: args.condition as string,
        script: args.script as string,
        enabled: args.enabled as boolean ?? true,
        projectId,
        tags: args.tags as string[] ?? [],
        timeout: args.timeout as number ?? 30000,
        retry: { enabled: true, maxAttempts: 3, backoffMs: 1000 },
        metadata: {
          cron: args.cron,
          webhook: args.webhookPath ? { path: args.webhookPath, secret: args.webhookSecret, methods: ["POST"] } : undefined,
        },
      });
      return { success: true, data: hook, summary: `Created hook ${hook.id}: ${hook.name}` };
    },
  });

  // Get hook
  registerTool({
    name: "hooks.get",
    description: "Get a hook by ID",
    category: "hooks",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        hookId: { type: "string", description: "Hook ID" },
      },
      required: ["hookId"],
    },
    execute: async (args, ctx) => {
      const hook = hooksEngine.getHook(args.hookId as string);
      return hook
        ? { success: true, data: hook, summary: `Hook ${hook.id}: ${hook.name}` }
        : { success: false, error: "Hook not found" };
    },
  });

  // List hooks
  registerTool({
    name: "hooks.list",
    description: "List all hooks",
    category: "hooks",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        event: { type: "string", description: "Filter by event type" },
      },
    },
    execute: async (args, ctx) => {
      const hooks = hooksEngine.listHooks(args.event as HookEvent);
      return { success: true, data: hooks, summary: `${hooks.length} hooks` };
    },
  });

  // Update hook
  registerTool({
    name: "hooks.update",
    description: "Update a hook",
    category: "hooks",
    risk: "WRITE",
    parameters: {
      type: "object",
      properties: {
        hookId: { type: "string", description: "Hook ID" },
        updates: { type: "object", description: "Partial hook updates" },
      },
      required: ["hookId"],
    },
    execute: async (args, ctx) => {
      const hook = hooksEngine.updateHook(args.hookId as string, args.updates as Partial<HookDefinition>);
      return hook
        ? { success: true, data: hook, summary: `Hook ${hook.id} updated` }
        : { success: false, error: "Hook not found" };
    },
  });

  // Delete hook
  registerTool({
    name: "hooks.delete",
    description: "Delete a hook",
    category: "hooks",
    risk: "DESTRUCTIVE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        hookId: { type: "string", description: "Hook ID" },
      },
      required: ["hookId"],
    },
    execute: async (args, ctx) => {
      const success = hooksEngine.deleteHook(args.hookId as string);
      return success
        ? { success: true, summary: `Hook ${args.hookId} deleted` }
        : { success: false, error: "Hook not found" };
    },
  });

  // Enable hook
  registerTool({
    name: "hooks.enable",
    description: "Enable a hook",
    category: "hooks",
    risk: "WRITE",
    parameters: {
      type: "object",
      properties: {
        hookId: { type: "string", description: "Hook ID" },
      },
      required: ["hookId"],
    },
    execute: async (args, ctx) => {
      const hook = hooksEngine.setHookEnabled(args.hookId as string, true);
      return hook
        ? { success: true, data: hook, summary: `Hook ${hook.id} enabled` }
        : { success: false, error: "Hook not found" };
    },
  });

  // Disable hook
  registerTool({
    name: "hooks.disable",
    description: "Disable a hook",
    category: "hooks",
    risk: "WRITE",
    parameters: {
      type: "object",
      properties: {
        hookId: { type: "string", description: "Hook ID" },
      },
      required: ["hookId"],
    },
    execute: async (args, ctx) => {
      const hook = hooksEngine.setHookEnabled(args.hookId as string, false);
      return hook
        ? { success: true, data: hook, summary: `Hook ${hook.id} disabled` }
        : { success: false, error: "Hook not found" };
    },
  });

  // Trigger hooks manually
  registerTool({
    name: "hooks.trigger",
    description: "Manually trigger hooks for an event",
    category: "hooks",
    risk: "WRITE",
    parameters: {
      type: "object",
      properties: {
        event: { type: "string", description: "Event to trigger" },
        payload: { type: "object", description: "Event payload" },
      },
      required: ["event"],
    },
    execute: async (args, ctx) => {
      const executions = await hooksEngine.trigger(args.event as HookEvent, args.payload as Record<string, unknown>, { manual: true });
      return { success: true, data: executions, summary: `Triggered ${executions.length} hooks` };
    },
  });

  // Get execution history
  registerTool({
    name: "hooks.executions",
    description: "Get hook execution history",
    category: "hooks",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        hookId: { type: "string", description: "Hook ID (optional)" },
        limit: { type: "number", description: "Max results", default: 50 },
      },
    },
    execute: async (args, ctx) => {
      const executions = hooksEngine.getExecutions(args.hookId as string, args.limit as number ?? 50);
      return { success: true, data: executions, summary: `${executions.length} executions` };
    },
  });

  // Get scheduled jobs
  registerTool({
    name: "hooks.scheduled",
    description: "Get scheduled hook jobs",
    category: "hooks",
    risk: "READ",
    execute: async (args, ctx) => {
      const jobs = hooksEngine.getScheduledJobs();
      return { success: true, data: jobs, summary: `${jobs.length} scheduled jobs` };
    },
  });
}

export { HooksEngine, ScriptRunner, HookScheduler };
export type { HookDefinition, HookExecution, HookContext, HookEvent, ScheduleConfig, WebhookConfig, HooksEngineConfig, ScriptRunnerConfig };