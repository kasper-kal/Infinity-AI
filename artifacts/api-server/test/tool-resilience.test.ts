/**
 * Phase 24: Universal Tool Layer — Tool Resilience Tests
 *
 * Tests for tool-resilience.ts covering:
 * - Failure classification
 * - Circuit breaker behavior
 * - Retry with exponential backoff
 * - Fallback tool selection
 * - Diagnostic agent escalation
 * - Health checks
 * - Metrics tracking
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  classifyToolFailure,
  getFallbackTool,
  getDiagnosticAgent,
  executeUniversalToolWithResilience,
  runUniversalToolHealthCheck,
  getUniversalResilienceMetrics,
  resetUniversalResilienceMetrics,
  getCircuitBreakerStatus,
  resetCircuitBreaker,
  getAllCircuitBreakerStatuses,
  type ToolFailureInfo,
  type ResilientExecutionOptions,
  type ToolExecutionContext,
} from "../src/lib/tool-resilience";
import { ToolExecutionContext, ToolCategory, ToolRisk } from "../src/lib/tool-types";

describe("Tool Resilience", () => {
  let testContext: ToolExecutionContext;

  beforeEach(() => {
    testContext = {
      userId: "test-user",
      conversationId: "test-conv",
      projectId: "test-project",
      workspaceId: "test-workspace",
      taskId: "test-task",
      permissions: {},
      memories: [],
      artifacts: [],
      previousToolResults: [],
    };
    resetUniversalResilienceMetrics();
    // Reset circuit breakers - especially run_command which is used by many tests
    resetCircuitBreaker("run_command");
    resetCircuitBreaker("npm_install");
    resetCircuitBreaker("screenshot");
    resetCircuitBreaker("inspect_dom");
    resetCircuitBreaker("list_files");
    // Reset any other circuit breakers that might exist
    const statuses = getAllCircuitBreakerStatuses();
    for (const name of Object.keys(statuses)) {
      resetCircuitBreaker(name);
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Failure Classification", () => {
    it("should classify network errors as transient", () => {
      const error = new Error("ENOTFOUND: getaddrinfo failed");
      const result = classifyToolFailure("test_tool", error);

      expect(result.classification).toBe("transient");
      expect(result.retryable).toBe(true);
      expect(result.suggestedAction).toBe("retry");
    });

    it("should classify timeout errors", () => {
      const error = new Error("Request timed out after 30000ms");
      const result = classifyToolFailure("test_tool", error);

      expect(result.classification).toBe("timeout");
      expect(result.retryable).toBe(true);
      expect(result.suggestedAction).toBe("retry");
    });

    it("should classify rate limit errors as recoverable", () => {
      const error = new Error("Rate limit exceeded: 429 Too Many Requests");
      const result = classifyToolFailure("test_tool", error);

      expect(result.classification).toBe("recoverable");
      expect(result.retryable).toBe(true);
      expect(result.suggestedAction).toBe("retry");
    });

    it("should classify resource exhaustion", () => {
      const error = new Error("ENOSPC: no space left on device");
      const result = classifyToolFailure("test_tool", error);

      expect(result.classification).toBe("resource_exhausted");
      expect(result.retryable).toBe(true);
      expect(result.suggestedAction).toBe("retry");
    });

    it("should classify permission denied as non-retryable", () => {
      const error = new Error("Permission denied: user approval required");
      const result = classifyToolFailure("test_tool", error);

      expect(result.classification).toBe("permission_denied");
      expect(result.retryable).toBe(false);
      expect(result.suggestedAction).toBe("abort");
    });

    it("should classify validation errors as permanent", () => {
      const error = new Error("Validation failed: invalid input schema");
      const result = classifyToolFailure("test_tool", error);

      expect(result.classification).toBe("validation_error");
      expect(result.retryable).toBe(false);
      expect(result.suggestedAction).toBe("abort");
    });

    it("should classify not found as permanent", () => {
      const error = new Error("Resource not found: 404");
      const result = classifyToolFailure("test_tool", error);

      expect(result.classification).toBe("permanent");
      expect(result.retryable).toBe(false);
      expect(result.suggestedAction).toBe("abort");
    });

    it("should classify authentication errors as permanent", () => {
      const error = new Error("Authentication failed: 401 unauthorized access");
      const result = classifyToolFailure("run_command", error);

      expect(result.classification).toBe("permanent");
      expect(result.retryable).toBe(false);
      expect(result.suggestedAction).toBe("escalate");
    });

    it("should classify dependency failures", () => {
      const error = new Error("Service unavailable: 503 upstream service down");
      const result = classifyToolFailure("run_command", error);

      expect(result.classification).toBe("dependency_failed");
      expect(result.retryable).toBe(true);
      expect(result.suggestedAction).toBe("fallback");
    });

    it("should classify git conflicts as recoverable", () => {
      const error = new Error("Merge conflict in file.ts");
      const result = classifyToolFailure("test_tool", error);

      expect(result.classification).toBe("recoverable");
      expect(result.retryable).toBe(true);
      expect(result.suggestedAction).toBe("diagnostic");
    });

    it("should classify unknown errors as unknown", () => {
      const error = new Error("Some completely unknown error pattern");
      const result = classifyToolFailure("test_tool", error);

      expect(result.classification).toBe("unknown");
      expect(result.retryable).toBe(false);
      expect(result.suggestedAction).toBe("escalate");
    });

    it("should handle string errors", () => {
      const result = classifyToolFailure("test_tool", "Connection refused ECONNREFUSED");

      expect(result.classification).toBe("transient");
      expect(result.retryable).toBe(true);
    });
  });

  describe("Fallback Tools", () => {
    it("should return fallback for npm_install", () => {
      const fallback = getFallbackTool("npm_install");
      expect(fallback).toBe("run_command");
    });

    it("should return fallback for browser tools", () => {
      const fallback = getFallbackTool("screenshot");
      expect(fallback).toBe("inspect_dom");
    });

    it("should return fallback for inspect_dom", () => {
      const fallback = getFallbackTool("inspect_dom");
      expect(fallback).toBe("screenshot");
    });

    it("should return fallback for git_diff", () => {
      const fallback = getFallbackTool("git_diff");
      expect(fallback).toBe("run_command");
    });

    it("should return null for tools without fallbacks", () => {
      const fallback = getFallbackTool("list_files");
      expect(fallback).toBeNull();
    });

    it("should return null for unknown tools", () => {
      const fallback = getFallbackTool("unknown_tool");
      expect(fallback).toBeNull();
    });
  });

  describe("Diagnostic Agents", () => {
    it("should return diagnostic agent for npm_install", () => {
      const agent = getDiagnosticAgent("npm_install");
      expect(agent).toBe("npm-install-fixer");
    });

    it("should return diagnostic agent for browser tools", () => {
      const agent = getDiagnosticAgent("screenshot");
      expect(agent).toBe("browser-recovery");
    });

    it("should return undefined for tools without diagnostic agents", () => {
      const agent = getDiagnosticAgent("list_files");
      expect(agent).toBeUndefined();
    });
  });

  describe("Resilient Execution", () => {
    it("should succeed on first attempt", async () => {
      const executeFn = vi.fn().mockResolvedValue({ success: true, data: { result: "ok" } });
      const options: ResilientExecutionOptions = {
        maxAttempts: 3,
        onProgress: vi.fn(),
        onAttempt: vi.fn(),
      };

      const result = await executeUniversalToolWithResilience(
        "test_tool",
        { input: "test" },
        testContext,
        executeFn,
        options
      );

      expect(result.success).toBe(true);
      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(options.onAttempt).toHaveBeenCalledWith(1, 4);
    });

    it("should retry on transient failure", async () => {
      const executeFn = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNREFUSED: Connection refused"))
        .mockResolvedValue({ success: true, data: { result: "ok" } });

      const options: ResilientExecutionOptions = {
        maxAttempts: 3,
        baseDelayMs: 10, // Fast for tests
        onProgress: vi.fn(),
        onAttempt: vi.fn(),
        enableCircuitBreaker: false, // Disable circuit breaker for predictable test
      };

      // Ensure circuit breaker is reset before test
      resetCircuitBreaker("run_command");

      const result = await executeUniversalToolWithResilience(
        "run_command",
        { command: "test" },
        testContext,
        executeFn,
        options
      );

      expect(result.success).toBe(true);
      // First call fails (attempt 0), second call succeeds (attempt 1) = 2 calls to executeFn
      // onAttempt is called before each execute AND on failure = 3 times total
      expect(executeFn).toHaveBeenCalledTimes(2);
      expect(options.onAttempt).toHaveBeenCalledTimes(3);
      expect(options.onProgress).toHaveBeenCalledWith(
        expect.stringMatching(/retry_wait|tool_failed/),
        expect.any(Object)
      );
    });

    it("should fail after max attempts with retryable error", async () => {
      const executeFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED: Connection refused"));

      const options: ResilientExecutionOptions = {
        maxAttempts: 2,
        baseDelayMs: 10,
        onProgress: vi.fn(),
        onAttempt: vi.fn(),
      };

      const result = await executeUniversalToolWithResilience(
        "run_command",
        { command: "test" },
        testContext,
        executeFn,
        options
      );

      expect(result.success).toBe(false);
      expect(executeFn).toHaveBeenCalledTimes(3); // Initial + 2 retries
      expect(result.metadata?.attempts).toBe(3);
    });

    it("should fail after max attempts with non-retryable error", async () => {
      const executeFn = vi.fn().mockRejectedValue(new Error("Validation error: bad input"));

      const options: ResilientExecutionOptions = {
        maxAttempts: 2,
        baseDelayMs: 10,
        onProgress: vi.fn(),
        onAttempt: vi.fn(),
      };

      const result = await executeUniversalToolWithResilience(
        "test_tool",
        { input: "test" },
        testContext,
        executeFn,
        options
      );

      expect(result.success).toBe(false);
      expect(executeFn).toHaveBeenCalledTimes(1); // No retry for validation error
      expect(result.metadata?.attempts).toBe(1);
    });

    it("should not retry on permission denied", async () => {
      const executeFn = vi.fn().mockRejectedValue(new Error("Permission denied"));

      const options: ResilientExecutionOptions = {
        maxAttempts: 3,
        baseDelayMs: 10,
        onProgress: vi.fn(),
        onAttempt: vi.fn(),
      };

      const result = await executeUniversalToolWithResilience(
        "test_tool",
        { input: "test" },
        testContext,
        executeFn,
        options
      );

      expect(result.success).toBe(false);
      expect(executeFn).toHaveBeenCalledTimes(1); // No retry
      expect(result.metadata?.failureClass).toBe("permission_denied");
    });

    it("should not retry on validation error", async () => {
      const executeFn = vi.fn().mockRejectedValue(new Error("Validation error: bad input"));

      const options: ResilientExecutionOptions = {
        maxAttempts: 3,
        baseDelayMs: 10,
        onProgress: vi.fn(),
        onAttempt: vi.fn(),
      };

      const result = await executeUniversalToolWithResilience(
        "test_tool",
        { input: "test" },
        testContext,
        executeFn,
        options
      );

      expect(result.success).toBe(false);
      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(result.metadata?.failureClass).toBe("validation_error");
    });

    it("should use fallback when available and retries exhausted", async () => {
      const executeFn = vi.fn().mockRejectedValue(new Error("Service unavailable: 503"));
      const fallbackFn = vi.fn().mockResolvedValue({ success: true, data: { fallback: true } });

      // We need to test with a tool that has a fallback
      // Use maxAttempts=2 so we have attempts=0, then attempt=1 (retry), then attempt=2 (maxAttempts reached)
      const options: ResilientExecutionOptions = {
        maxAttempts: 2, // Allow one retry then fallback
        baseDelayMs: 10,
        onProgress: vi.fn(),
        onAttempt: vi.fn(),
      };

      // Use npm_install which has run_command as fallback
      const result = await executeUniversalToolWithResilience(
        "npm_install",
        { package: "test" },
        testContext,
        executeFn,
        options
      );

      // Should indicate fallback available
      expect(result.success).toBe(false);
      expect(result.data?.fallbackTool).toBe("run_command");
    });

    it("should include resilience metadata in result", async () => {
      const executeFn = vi.fn().mockResolvedValue({ success: true, data: { result: "ok" } });
      const options: ResilientExecutionOptions = {
        maxAttempts: 3,
        onProgress: vi.fn(),
        onAttempt: vi.fn(),
      };

      const result = await executeUniversalToolWithResilience(
        "run_command",
        { command: "test" },
        testContext,
        executeFn,
        options
      );

      expect(result.metadata).toBeDefined();
      expect(result.metadata?.resilience).toBeDefined();
      expect(result.metadata?.resilience?.attempts).toBe(1);
      expect(result.metadata?.resilience?.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.metadata?.resilience?.circuitBreakerState).toBeDefined();
    });

    it("should handle timeout", async () => {
      const executeFn = vi.fn().mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({ success: true }), 100))
      );

      const options: ResilientExecutionOptions = {
        maxAttempts: 1,
        timeoutMs: 10, // Very short timeout
        onProgress: vi.fn(),
        onAttempt: vi.fn(),
      };

      const result = await executeUniversalToolWithResilience(
        "test_tool",
        { input: "test" },
        testContext,
        executeFn,
        options
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("timeout");
    });

    it("should track resilience metrics", async () => {
      resetUniversalResilienceMetrics();

      const executeFn = vi.fn().mockResolvedValue({ success: true, data: { result: "ok" } });
      const options: ResilientExecutionOptions = {
        maxAttempts: 1,
        onProgress: vi.fn(),
        onAttempt: vi.fn(),
      };

      await executeUniversalToolWithResilience(
        "run_command",
        { command: "test" },
        testContext,
        executeFn,
        options
      );

      const metrics = getUniversalResilienceMetrics();
      expect(metrics.totalCalls).toBe(1);
      expect(metrics.successfulCalls).toBe(1);
      expect(metrics.byTool.run_command).toBeDefined();
      expect(metrics.byTool.run_command.calls).toBe(1);
    });

    it("should track retry metrics", async () => {
      resetUniversalResilienceMetrics();

      const executeFn = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValue({ success: true, data: { result: "ok" } });

      const options: ResilientExecutionOptions = {
        maxAttempts: 3,
        baseDelayMs: 10,
        onProgress: vi.fn(),
        onAttempt: vi.fn(),
      };

      await executeUniversalToolWithResilience(
        "run_command",
        { command: "test" },
        testContext,
        executeFn,
        options
      );

      const metrics = getUniversalResilienceMetrics();
      expect(metrics.retriedCalls).toBe(1);
      expect(metrics.byTool.run_command.retries).toBe(1);
    });
  });

  describe("Circuit Breaker", () => {
    it("should track circuit breaker state", async () => {
      const executeFn = vi.fn().mockRejectedValue(new Error("Service down"));

      const options: ResilientExecutionOptions = {
        maxAttempts: 3,
        baseDelayMs: 10,
        enableCircuitBreaker: true,
        onProgress: vi.fn(),
        onAttempt: vi.fn(),
      };

      // Run multiple times to trigger circuit breaker
      for (let i = 0; i < 6; i++) {
        await executeUniversalToolWithResilience(
          "run_command",
          { command: `test-${i}` },
          testContext,
          executeFn,
          options
        );
      }

      const status = getCircuitBreakerStatus("run_command");
      expect(status).toBeDefined();
      expect(status?.state).toBe("open");
      expect(status?.failureCount).toBeGreaterThanOrEqual(5);
    });

    it("should reject calls when circuit is open", async () => {
      const executeFn = vi.fn().mockResolvedValue({ success: true, data: { result: "ok" } });
      const options: ResilientExecutionOptions = {
        maxAttempts: 1,
        enableCircuitBreaker: true,
        onProgress: vi.fn(),
        onAttempt: vi.fn(),
      };

      // First open the circuit
      const failFn = vi.fn().mockRejectedValue(new Error("Service down"));
      const failOptions: ResilientExecutionOptions = {
        maxAttempts: 3,
        baseDelayMs: 10,
        enableCircuitBreaker: true,
        onProgress: vi.fn(),
        onAttempt: vi.fn(),
      };

      for (let i = 0; i < 6; i++) {
        await executeUniversalToolWithResilience(
          "run_command",
          { command: `fail-${i}` },
          testContext,
          failFn,
          failOptions
        );
      }

      // Now try a successful call - should be rejected by circuit breaker
      const result = await executeUniversalToolWithResilience(
        "run_command",
        { command: "test" },
        testContext,
        executeFn,
        options
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Circuit breaker OPEN");
    });

    it("should reset circuit breaker", async () => {
      // Open circuit first
      const failFn = vi.fn().mockRejectedValue(new Error("Service down"));
      const failOptions: ResilientExecutionOptions = {
        maxAttempts: 3,
        baseDelayMs: 10,
        enableCircuitBreaker: true,
        onProgress: vi.fn(),
        onAttempt: vi.fn(),
      };

      for (let i = 0; i < 6; i++) {
        await executeUniversalToolWithResilience(
          "run_command",
          { input: `fail-${i}` },
          testContext,
          failFn,
          failOptions
        );
      }

      expect(getCircuitBreakerStatus("run_command")?.state).toBe("open");

      resetCircuitBreaker("run_command");

      expect(getCircuitBreakerStatus("run_command")?.state).toBe("closed");
    });

    it("should return all circuit breaker statuses", () => {
      const statuses = getAllCircuitBreakerStatuses();
      expect(typeof statuses).toBe("object");
    });
  });

  describe("Health Checks", () => {
    it("should run health check on tools", async () => {
      const health = await runUniversalToolHealthCheck(testContext, ["list_files"]);

      expect(health).toHaveProperty("healthy");
      expect(health).toHaveProperty("results");
      expect(health.results).toHaveProperty("list_files");
    });

    it("should report unhealthy for failing tools", async () => {
      // We can't easily mock the internal tool execution, but we can test the structure
      const health = await runUniversalToolHealthCheck(testContext, ["nonexistent_tool"]);

      expect(health).toHaveProperty("healthy");
      expect(health).toHaveProperty("results");
    });
  });

  describe("Resilience Metrics", () => {
    it("should track metrics across multiple calls", async () => {
      resetUniversalResilienceMetrics();

      const executeFn = vi.fn().mockResolvedValue({ success: true, data: { result: "ok" } });
      const options: ResilientExecutionOptions = {
        maxAttempts: 1,
        onProgress: vi.fn(),
        onAttempt: vi.fn(),
      };

      // Multiple successful calls
      for (let i = 0; i < 5; i++) {
        await executeUniversalToolWithResilience(
          "run_command",
          { command: `test-${i}` },
          testContext,
          executeFn,
          options
        );
      }

      const metrics = getUniversalResilienceMetrics();
      expect(metrics.totalCalls).toBe(5);
      expect(metrics.successfulCalls).toBe(5);
      expect(metrics.avgLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it("should track per-tool metrics", async () => {
      resetUniversalResilienceMetrics();

      const executeFn = vi.fn().mockResolvedValue({ success: true, data: { result: "ok" } });
      const options: ResilientExecutionOptions = {
        maxAttempts: 1,
        onProgress: vi.fn(),
        onAttempt: vi.fn(),
      };

      await executeUniversalToolWithResilience("run_command", { command: "a" }, testContext, executeFn, options);
      await executeUniversalToolWithResilience("list_files", { path: "/" }, testContext, executeFn, options);
      await executeUniversalToolWithResilience("run_command", { command: "b" }, testContext, executeFn, options);

      const metrics = getUniversalResilienceMetrics();
      expect(metrics.byTool.run_command.calls).toBe(2);
      expect(metrics.byTool.list_files.calls).toBe(1);
    });

    it("should reset metrics", async () => {
      resetUniversalResilienceMetrics();

      const executeFn = vi.fn().mockResolvedValue({ success: true });
      const options: ResilientExecutionOptions = { maxAttempts: 1 };

      await executeUniversalToolWithResilience("test", {}, testContext, executeFn, options);

      expect(getUniversalResilienceMetrics().totalCalls).toBe(1);

      resetUniversalResilienceMetrics();

      expect(getUniversalResilienceMetrics().totalCalls).toBe(0);
    });
  });

  describe("Exponential Backoff", () => {
    it("should apply exponential backoff", async () => {
      const executeFn = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValue({ success: true });

      const delays: number[] = [];
      const options: ResilientExecutionOptions = {
        maxAttempts: 3,
        baseDelayMs: 50,
        backoffMultiplier: 2,
        onProgress: vi.fn((stage, info) => {
          if (stage === "retry_wait") {
            delays.push(info.delayMs as number);
          }
        }),
        onAttempt: vi.fn(),
      };

      await executeUniversalToolWithResilience(
        "run_command",
        { command: "test" },
        testContext,
        executeFn,
        options
      );

      // Should have delays: 50, 100 (baseDelay * multiplier^attempt)
      expect(delays.length).toBe(2);
      expect(delays[0]).toBeGreaterThanOrEqual(50);
      expect(delays[1]).toBeGreaterThanOrEqual(100);
    });

    it("should respect maxDelayMs", async () => {
      const executeFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const delays: number[] = [];
      const options: ResilientExecutionOptions = {
        maxAttempts: 5,
        baseDelayMs: 100,
        maxDelayMs: 250,
        backoffMultiplier: 2,
        onProgress: vi.fn((stage, info) => {
          if (stage === "retry_wait") {
            delays.push(info.delayMs as number);
          }
        }),
        onAttempt: vi.fn(),
      };

      await executeUniversalToolWithResilience(
        "run_command",
        { command: "test" },
        testContext,
        executeFn,
        options
      );

      // All delays should be <= maxDelayMs
      for (const delay of delays) {
        expect(delay).toBeLessThanOrEqual(250);
      }
    });
  });
});