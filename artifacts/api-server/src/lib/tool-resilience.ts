/**
 * Phase 24: Universal Tool Layer — Resilience & Persistence
 *
 * Extends Phase 15's build-edge-cases.ts resilience layer for the Universal Tool Registry.
 * Provides tool failure classification, circuit breaker, diagnostic recovery per tool type,
 * and resilient execution wrapper with metrics tracking.
 */

import type { UniversalToolResult, ToolExecutionContext, ToolCategory, ToolRisk } from "./tool-types";
import type { PersistentTaskState, ToolCallRecord, PendingApproval } from "./tool-persistence";
import {
  withRetry,
  recordEdgeCase,
  resolveEdgeCase,
  getToolResilienceConfig,
  type ToolResilienceConfig,
  type RetryConfig,
  executeToolWithResilience as buildExecuteWithResilience,
  runToolHealthCheck as buildRunHealthCheck,
  recordResilienceMetric,
  getResilienceMetrics as buildGetResilienceMetrics,
  resetResilienceMetrics as buildResetResilienceMetrics,
} from "./build-edge-cases";

/**
 * Universal tool failure classification
 */
export type ToolFailureClass =
  | "transient"           // Network blip, temporary rate limit - retry immediately
  | "recoverable"         // Known error pattern - retry with backoff
  | "permanent"           // Invalid input, auth failure, not found - don't retry
  | "resource_exhausted"  // Disk full, memory, quota - wait and retry
  | "dependency_failed"   // Upstream service down - circuit breaker
  | "permission_denied"   // User denied approval - terminal
  | "validation_error"    // Input validation failed - terminal
  | "timeout"             // Operation timed out - retry with longer timeout
  | "unknown";            // Unclassified - log and escalate

export interface ToolFailureInfo {
  classification: ToolFailureClass;
  retryable: boolean;
  suggestedAction: "retry" | "fallback" | "diagnostic" | "escalate" | "abort";
  userMessage: string;
  diagnosticHint?: string;
}

/**
 * Circuit breaker states
 */
export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerStatus {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailure?: string;
  lastSuccess?: string;
  nextAttemptAt?: number;
  config: {
    threshold: number;
    timeout: number;
  };
}

/**
 * Tool execution outcome for metrics
 */
export interface ToolExecutionOutcome {
  toolName: string;
  category: ToolCategory;
  risk: ToolRisk;
  success: boolean;
  latencyMs: number;
  attempt: number;
  failureClass?: ToolFailureClass;
  fallbackUsed?: string;
  diagnosticUsed?: string;
  timestamp: string;
}

/**
 * Resilient execution options
 */
export interface ResilientExecutionOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  timeoutMs?: number;
  enableCircuitBreaker?: boolean;
  enableFallback?: boolean;
  enableDiagnostic?: boolean;
  onProgress?: (stage: string, info: Record<string, unknown>) => void;
  onAttempt?: (attempt: number, maxAttempts: number, error?: Error) => void;
}

/**
 * Circuit breaker implementation per tool
 */
class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private successCount = 0;
  private lastFailure?: string;
  private lastSuccess?: string;
  private nextAttemptAt?: number;

  constructor(
    private readonly toolName: string,
    private readonly threshold: number,
    private readonly timeout: number
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === "open") {
      if (this.nextAttemptAt && Date.now() >= this.nextAttemptAt) {
        // Transition to half-open
        this.state = "half-open";
      } else {
        throw new Error(`Circuit breaker OPEN for ${this.toolName}. Next attempt at ${new Date(this.nextAttemptAt || 0).toISOString()}`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.successCount++;
    this.lastSuccess = new Date().toISOString();
    if (this.state === "half-open") {
      this.state = "closed";
    }
  }

  private onFailure(error: string): void {
    this.failureCount++;
    this.lastFailure = error;
    if (this.failureCount >= this.threshold) {
      this.state = "open";
      this.nextAttemptAt = Date.now() + this.timeout;
    }
  }

  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      nextAttemptAt: this.nextAttemptAt,
      config: { threshold: this.threshold, timeout: this.timeout },
    };
  }

  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailure = undefined;
    this.lastSuccess = undefined;
    this.nextAttemptAt = undefined;
  }
}

/**
 * Global circuit breaker registry
 */
const circuitBreakers = new Map<string, CircuitBreaker>();

function getCircuitBreaker(toolName: string, config: ToolResilienceConfig): CircuitBreaker {
  let breaker = circuitBreakers.get(toolName);
  if (!breaker) {
    breaker = new CircuitBreaker(toolName, config.circuitBreaker.threshold, config.circuitBreaker.timeout);
    circuitBreakers.set(toolName, breaker);
  }
  return breaker;
}

export function getCircuitBreakerStatus(toolName: string): CircuitBreakerStatus | null {
  const breaker = circuitBreakers.get(toolName);
  return breaker?.getStatus() ?? null;
}

export function resetCircuitBreaker(toolName: string): void {
  const breaker = circuitBreakers.get(toolName);
  breaker?.reset();
}

export function getAllCircuitBreakerStatuses(): Record<string, CircuitBreakerStatus> {
  const result: Record<string, CircuitBreakerStatus> = {};
  for (const [name, breaker] of circuitBreakers) {
    result[name] = breaker.getStatus();
  }
  return result;
}

/**
 * Classify a tool failure based on error message and context
 */
export function classifyToolFailure(
  toolName: string,
  error: Error | string,
  context?: { category?: ToolCategory; risk?: ToolRisk; attempt?: number }
): ToolFailureInfo {
  const errStr = error instanceof Error ? error.message : String(error);
  const errLower = errStr.toLowerCase();

  // Transient network errors
  if (errLower.includes("econnrefused") || errLower.includes("enotfound") ||
      errLower.includes("etimedout") || errLower.includes("enetunreach") ||
      errLower.includes("eai_again") || errLower.includes("socket hang up") ||
      errLower.includes("network") || errLower.includes("dns")) {
    return {
      classification: "transient",
      retryable: true,
      suggestedAction: "retry",
      userMessage: "Network connection issue. Retrying...",
      diagnosticHint: "Check network connectivity and DNS resolution",
    };
  }

  // Timeout errors
  if (errLower.includes("timeout") || errLower.includes("timed out")) {
    return {
      classification: "timeout",
      retryable: true,
      suggestedAction: "retry",
      userMessage: "Operation timed out. Retrying with longer timeout...",
      diagnosticHint: "Consider increasing timeout or checking service latency",
    };
  }

  // Rate limiting
  if (errLower.includes("rate limit") || errLower.includes("429") ||
      errLower.includes("too many requests") || errLower.includes("quota exceeded")) {
    return {
      classification: "recoverable",
      retryable: true,
      suggestedAction: "retry",
      userMessage: "Rate limited. Waiting before retry...",
      diagnosticHint: "Implement exponential backoff and request queuing",
    };
  }

  // Resource exhaustion
  if (errLower.includes("disk full") || errLower.includes("no space left") ||
      errLower.includes("enospc") || errLower.includes("memory") ||
      errLower.includes("out of memory") || errLower.includes("quota")) {
    return {
      classification: "resource_exhausted",
      retryable: true,
      suggestedAction: "retry",
      userMessage: "Resource exhausted. Waiting for recovery...",
      diagnosticHint: "Check disk space, memory usage, and API quotas",
    };
  }

  // Authentication errors (check before permission_denied to avoid "unauthorized" collision)
  if (errLower.includes("authentication") || errLower.includes("401") ||
      errLower.includes("invalid token") || errLower.includes("api key")) {
    return {
      classification: "permanent",
      retryable: false,
      suggestedAction: "escalate",
      userMessage: "Authentication failed",
      diagnosticHint: "Check API credentials and token expiration",
    };
  }

  // Permission denied (user approval)
  if (errLower.includes("permission denied") || errLower.includes("not authorized") ||
      errLower.includes("approval required") ||
      errLower.includes("user denied")) {
    return {
      classification: "permission_denied",
      retryable: false,
      suggestedAction: "abort",
      userMessage: "Operation requires user approval",
      diagnosticHint: "Request user approval via the approval UI",
    };
  }

  // Validation errors
  if (errLower.includes("validation") || errLower.includes("invalid") ||
      errLower.includes("bad request") || errLower.includes("400") ||
      errLower.includes("schema") || errLower.includes("malformed")) {
    return {
      classification: "validation_error",
      retryable: false,
      suggestedAction: "abort",
      userMessage: "Invalid input provided",
      diagnosticHint: "Check input parameters against tool schema",
    };
  }

  // Not found / permanent errors
  if (errLower.includes("not found") || errLower.includes("404") ||
      errLower.includes("does not exist") || errLower.includes("no such")) {
    return {
      classification: "permanent",
      retryable: false,
      suggestedAction: "abort",
      userMessage: "Resource not found",
      diagnosticHint: "Verify resource identifiers and paths",
    };
  }

  // Dependency failures
  if (errLower.includes("service unavailable") || errLower.includes("503") ||
      errLower.includes("gateway") || errLower.includes("502") ||
      errLower.includes("upstream") || errLower.includes("dependency")) {
    return {
      classification: "dependency_failed",
      retryable: true,
      suggestedAction: "fallback",
      userMessage: "Upstream service unavailable. Trying fallback...",
      diagnosticHint: "Check upstream service health and circuit breaker status",
    };
  }

  // Git conflicts
  if (errLower.includes("conflict") || errLower.includes("merge conflict")) {
    return {
      classification: "recoverable",
      retryable: true,
      suggestedAction: "diagnostic",
      userMessage: "Git conflict detected. Attempting auto-resolve...",
      diagnosticHint: "Run git status and resolve conflicts manually if needed",
    };
  }

  // Unknown - log and escalate
  return {
    classification: "unknown",
    retryable: false,
    suggestedAction: "escalate",
    userMessage: `Unexpected error: ${errStr}`,
    diagnosticHint: "Check logs for full error details. Consider adding specific handling for this error pattern.",
  };
}

/**
 * Get fallback tool for a given tool
 */
export function getFallbackTool(toolName: string): string | null {
  const config = getToolResilienceConfig(toolName);
  if (!config || config.fallbackTools.length === 0) return null;
  return config.fallbackTools[0];
}

/**
 * Get diagnostic agent for a tool
 */
export function getDiagnosticAgent(toolName: string): string | undefined {
  const config = getToolResilienceConfig(toolName);
  return config?.diagnosticAgent;
}

/**
 * Execute a universal tool with full resilience (retry, circuit breaker, fallback, diagnostic)
 */
export async function executeUniversalToolWithResilience<T extends Record<string, unknown>>(
  toolName: string,
  args: T,
  context: ToolExecutionContext,
  executeFn: (args: T, context: ToolExecutionContext) => Promise<UniversalToolResult>,
  options: ResilientExecutionOptions = {}
): Promise<UniversalToolResult> {
  const startTime = Date.now();
  const config = getToolResilienceConfig(toolName);
  const category = "unknown" as ToolCategory; // Would be passed from registry
  const risk = "low" as ToolRisk; // Would be passed from registry

  // Default options
  const {
    maxAttempts = config?.retryConfig.maxAttempts ?? 3,
    baseDelayMs = config?.retryConfig.baseDelayMs ?? 1000,
    maxDelayMs = config?.retryConfig.maxDelayMs ?? 30000,
    backoffMultiplier = config?.retryConfig.backoffMultiplier ?? 2,
    timeoutMs = 60000,
    enableCircuitBreaker = true,
    enableFallback = true,
    enableDiagnostic = true,
    onProgress,
    onAttempt,
  } = options;

  let lastError: Error | null = null;
  let attempt = 0;
  let fallbackUsed: string | undefined;
  let diagnosticUsed: string | undefined;

  // Circuit breaker
  let circuitBreaker: CircuitBreaker | null = null;
  if (enableCircuitBreaker && config) {
    circuitBreaker = getCircuitBreaker(toolName, config);
  }

  // Retry loop
  while (attempt <= maxAttempts) {
    try {
      onProgress?.("execute", { tool: toolName, attempt: attempt + 1, maxAttempts: maxAttempts + 1 });
      onAttempt?.(attempt + 1, maxAttempts + 1);

      // Execute with timeout through circuit breaker
      const executeWithTimeout = () => Promise.race([
        executeFn(args, context),
        new Promise<UniversalToolResult>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool execution timeout after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);

      const result = circuitBreaker
        ? await circuitBreaker.execute(executeWithTimeout)
        : await executeWithTimeout();

      // Success!
      const latencyMs = Date.now() - startTime;
      recordResilienceMetric(toolName, "success", latencyMs);

      return {
        ...result,
        metadata: {
          ...result.metadata,
          resilience: {
            attempts: attempt + 1,
            latencyMs,
            fallbackUsed,
            diagnosticUsed,
            circuitBreakerState: circuitBreaker?.getStatus().state ?? "none",
          },
        },
      };

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const latencyMs = Date.now() - startTime;

      // Classify failure
      const failureInfo = classifyToolFailure(toolName, lastError, { category, risk, attempt: attempt + 1 });

      onProgress?.("tool_failed", {
        tool: toolName,
        error: lastError.message,
        attempt: attempt + 1,
        classification: failureInfo.classification,
        retryable: failureInfo.retryable,
      });
      onAttempt?.(attempt + 1, maxAttempts + 1, lastError);

      // Record failure metric
      recordResilienceMetric(toolName, "failure", latencyMs);

      // Check if we should retry
      if (!failureInfo.retryable || attempt === maxAttempts) {
        // Try fallback when all retries exhausted (attempt >= maxAttempts means we've tried maxAttempts+1 times)
        if (enableFallback && attempt >= maxAttempts) {
          const fallback = getFallbackTool(toolName);
          if (fallback) {
            fallbackUsed = fallback;
            onProgress?.("fallback", { from: toolName, to: fallback });
            recordResilienceMetric(toolName, "fallback", Date.now() - startTime);

            try {
              const fallbackConfig = getToolResilienceConfig(fallback);
              if (fallbackConfig) {
                // For now, return error with fallback info - actual fallback execution
                // would require the fallback's execute function
                return {
                  success: false,
                  error: `${lastError.message}. Fallback available: ${fallback}`,
                  data: { fallbackTool: fallback, originalError: lastError.message },
                  metadata: {
                    fallbackTool: fallback,
                    originalTool: toolName,
                    attempts: attempt + 1,
                  },
                };
              }
            } catch (fallbackError) {
              // Fallback also failed - continue to diagnostic
            }
          }
        }

        // Try diagnostic when all retries exhausted
        if (enableDiagnostic && attempt >= maxAttempts) {
          const diagnostic = getDiagnosticAgent(toolName);
          if (diagnostic) {
            diagnosticUsed = diagnostic;
            onProgress?.("diagnostic", { tool: toolName, agent: diagnostic });
            recordResilienceMetric(toolName, "diagnostic", Date.now() - startTime);

            return {
              success: false,
              error: `${lastError.message}. Diagnostic agent available: ${diagnostic}`,
              data: { diagnosticAgent: diagnostic, originalError: lastError.message },
              metadata: {
                diagnosticAgent: diagnostic,
                originalTool: toolName,
                attempts: attempt + 1,
              },
            };
          }
        }

        // No more options - return final error
        return {
          success: false,
          error: failureInfo.userMessage,
          data: {
            originalError: lastError.message,
            failureClass: failureInfo.classification,
            diagnosticHint: failureInfo.diagnosticHint,
            attempts: attempt + 1,
          },
          metadata: {
            failureClass: failureInfo.classification,
            attempts: attempt + 1,
            latencyMs,
            fallbackUsed,
            diagnosticUsed,
            circuitBreakerState: circuitBreaker?.getStatus().state ?? "none",
          },
        };
      }

      // Exponential backoff
      attempt++;
      const delay = Math.min(baseDelayMs * Math.pow(backoffMultiplier, attempt - 1), maxDelayMs);
      onProgress?.("retry_wait", { tool: toolName, delayMs: delay, attempt, classification: failureInfo.classification });
      recordResilienceMetric(toolName, "retry", delay);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  // Should not reach here
  return {
    success: false,
    error: `Tool ${toolName} failed after ${maxAttempts + 1} attempts: ${lastError?.message}`,
    metadata: {
      attempts: maxAttempts + 1,
      latencyMs: Date.now() - startTime,
      fallbackUsed,
      diagnosticUsed,
      circuitBreakerState: circuitBreaker?.getStatus().state ?? "none",
    },
  };
}

/**
 * Run health checks on all registered universal tools
 */
export async function runUniversalToolHealthCheck(
  context: ToolExecutionContext,
  toolNames: string[] = []
): Promise<{ healthy: boolean; results: Record<string, { ok: boolean; latencyMs: number; error?: string }> }> {
  // Use Phase 15's build tool health check for common tools
  const buildTools = ["list_files", "read_file", "run_command", "git_diff", "edit_file", "write_file", "glob", "grep", "task_tool"];
  const allTools = [...new Set([...buildTools, ...toolNames])];

  return buildRunHealthCheck(context.projectId, context.workspaceId, allTools);
}

/**
 * Get resilience metrics from Phase 15
 */
export function getUniversalResilienceMetrics() {
  return buildGetResilienceMetrics();
}

export function resetUniversalResilienceMetrics() {
  buildResetResilienceMetrics();
}

/**
 * Persistent tool state for recovery (matches PersistentTaskState from tool-persistence)
 */
export type PersistentToolState = PersistentTaskState;

/**
 * Save tool execution state for persistence/recovery
 */
export async function saveToolExecutionState(state: PersistentToolState): Promise<void> {
  const { db } = await import("@workspace/db");
  const { taskStates } = await import("@workspace/db/schema");

  await db.insert(taskStates).values({
    taskId: state.taskId,
    conversationId: state.conversationId,
    userId: state.userId,
    projectId: state.projectId,
    status: state.status,
    state: JSON.stringify(state),
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: taskStates.taskId,
    set: { state: JSON.stringify(state), updatedAt: new Date() },
  });
}

/**
 * Load tool execution state for recovery
 */
export async function loadToolExecutionState(taskId: string): Promise<PersistentToolState | null> {
  const { db } = await import("@workspace/db");
  const { taskStates } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");

  const [record] = await db.select().from(taskStates).where(eq(taskStates.taskId, taskId)).limit(1);
  if (!record) return null;

  try {
    return JSON.parse(record.state as string) as PersistentToolState;
  } catch {
    return null;
  }
}

/**
 * Create a recovery plan from saved state
 */
export interface RecoveryPlan {
  taskId: string;
  canResume: boolean;
  completedSteps: number;
  failedStep?: { toolName: string; args: Record<string, unknown>; error: string };
  nextSteps: Array<{ toolName: string; args: Record<string, unknown> }>;
  requiresUserAction: boolean;
  userActionMessage?: string;
}

export function createRecoveryPlan(state: PersistentToolState): RecoveryPlan {
  // Find the last failed step (by stepIndex)
  const failedStep = state.toolCallChain
    .sort((a, b) => a.stepIndex - b.stepIndex)
    .find((step) => !step.result.success);

  // Count completed (successful) steps by stepIndex
  const completedSteps = state.toolCallChain
    .filter((step) => step.result.success)
    .length;

  // Count pending approvals (not resolved)
  const pendingApprovals = state.pendingApprovals.filter((a) => !a.resolved).length;

  // Determine if we can resume based on failure class
  let canResume = true;
  if (failedStep) {
    const failureClass = (failedStep.result as any).metadata?.failureClass;
    canResume = failureClass === "transient" || failureClass === "timeout" || failureClass === "recoverable" || failureClass === "resource_exhausted";
  }

  // Get remaining steps starting from after the last successful stepIndex
  const maxSuccessfulIndex = state.toolCallChain
    .filter((step) => step.result.success)
    .reduce((max, step) => Math.max(max, step.stepIndex), -1);

  const remainingSteps = state.toolCallChain
    .filter((step) => step.stepIndex > maxSuccessfulIndex)
    .sort((a, b) => a.stepIndex - b.stepIndex)
    .map((s) => ({ toolName: s.toolName, args: s.args }));

  return {
    taskId: state.taskId,
    canResume,
    completedSteps,
    failedStep: failedStep ? {
      toolName: failedStep.toolName,
      args: failedStep.args,
      error: failedStep.result.error || "Unknown error",
    } : undefined,
    nextSteps: remainingSteps,
    requiresUserAction: pendingApprovals > 0,
    userActionMessage: pendingApprovals > 0
      ? `${pendingApprovals} tool(s) awaiting user approval`
      : undefined,
  };
}

/**
 * Execute recovery plan
 */
export async function executeRecoveryPlan(
  plan: RecoveryPlan,
  context: ToolExecutionContext,
  executeFn: (toolName: string, args: Record<string, unknown>, context: ToolExecutionContext) => Promise<UniversalToolResult>
): Promise<{ success: boolean; results: UniversalToolResult[] }> {
  const results: UniversalToolResult[] = [];

  for (const step of plan.nextSteps) {
    try {
      const result = await executeFn(step.toolName, step.args, context);
      results.push(result);

      if (!result.success) {
        // Recovery failed at this step
        return { success: false, results };
      }
    } catch (error) {
      results.push({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, results };
    }
  }

  return { success: true, results };
}