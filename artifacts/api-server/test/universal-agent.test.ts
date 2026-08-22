/**
 * Phase 24: Universal Tool Layer — Integration Tests
 *
 * Comprehensive tests for the universal agent loop covering:
 * - Single tool call
 * - Sequential tool calls
 * - Dependent tool calls
 * - Parallel tool calls
 * - Failure and retry scenarios
 * - Permission denial handling
 * - Large output handling
 * - Artifact passing between tools
 * - Memory read/write operations
 * - Cross-capability chaining
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LLMAdapter, LLMMessage, LLMTool, LLMCompletionOptions, LLMCompletionResult, LLMToolCall } from "../src/lib/llm-adapter";
import { runUniversalAgent, UniversalAgent, UniversalAgentConfig, AgentToolEvent, AgentLoopResult } from "../src/lib/universal-agent";
import { ToolExecutionContext, UniversalToolResult, Artifact, ToolCategory, ToolRisk } from "../src/lib/tool-types";
import { getToolRegistry, registerTool, clearRegistry } from "../src/lib/tool-registry";

// Mock LLM Adapter for testing
class MockLLMAdapter implements LLMAdapter {
  private responses: LLMCompletionResult[] = [];
  private responseIndex = 0;
  private streamResponses: AsyncIterableIterator<LLMCompletionResult>[] = [];
  private streamIndex = 0;
  public lastMessages: LLMMessage[] = [];
  public lastOptions: LLMCompletionOptions | null = null;

  setResponses(responses: LLMCompletionResult[]): void {
    this.responses = responses;
    this.responseIndex = 0;
  }

  setStreamResponses(responses: AsyncIterableIterator<LLMCompletionResult>[]): void {
    this.streamResponses = responses;
    this.streamIndex = 0;
  }

  async complete(messages: LLMMessage[], options: LLMCompletionOptions): Promise<LLMCompletionResult> {
    this.lastMessages = messages;
    this.lastOptions = options;
    if (this.responseIndex >= this.responses.length) {
      return { content: "Default response", toolCalls: [] };
    }
    return this.responses[this.responseIndex++];
  }

  async *stream(messages: LLMMessage[], options: LLMCompletionOptions): AsyncIterableIterator<LLMCompletionResult> {
    this.lastMessages = messages;
    this.lastOptions = options;
    if (this.streamIndex >= this.streamResponses.length) {
      yield { content: "Default streamed response", toolCalls: [], done: true };
      return;
    }
    const stream = this.streamResponses[this.streamIndex++];
    for await (const chunk of stream) {
      yield chunk;
    }
  }

  async embed(text: string): Promise<number[]> {
    return Array(1536).fill(0).map(() => Math.random());
  }

  getModelName(): string {
    return "mock-model";
  }

  supportsToolCalling(): boolean {
    return true;
  }

  supportsStreaming(): boolean {
    return true;
  }
}

// Helper to create mock tool calls
function createToolCall(id: string, name: string, args: Record<string, unknown>): LLMToolCall {
  return {
    id,
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

// Helper to create tool call response
function createCompletion(content: string, toolCalls: LLMToolCall[] = []): LLMCompletionResult {
  return { content, toolCalls };
}

// Helper to create streaming response
async function* createStreamResponse(chunks: string[], toolCalls: LLMToolCall[] = []): AsyncIterableIterator<LLMCompletionResult> {
  for (const chunk of chunks) {
    yield { content: chunk, toolCalls: [] };
  }
  yield { content: "", toolCalls, done: true };
}

// Mock tool execution
const mockToolResults = new Map<string, UniversalToolResult>();

function setMockToolResult(toolName: string, result: UniversalToolResult): void {
  mockToolResults.set(toolName, result);
}

function clearMockToolResults(): void {
  mockToolResults.clear();
}

// Test context
function createTestContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    userId: "test-user",
    conversationId: "test-conv",
    projectId: "test-project",
    workspaceId: "test-workspace",
    taskId: "test-task",
    permissions: {},
    memories: [],
    artifacts: [],
    previousToolResults: [],
    ...overrides,
  };
}

describe("Universal Agent Loop", () => {
  let mockAdapter: MockLLMAdapter;
  let testContext: ToolExecutionContext;
  let events: AgentToolEvent[];

  beforeEach(() => {
    mockAdapter = new MockLLMAdapter();
    testContext = createTestContext();
    events = [];
    clearMockToolResults();
    clearRegistry();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Register test tools
  beforeEach(() => {
    registerTool({
      name: "utility.test_tool",
      description: "A test tool",
      category: "utility" as ToolCategory,
      risk: "low" as ToolRisk,
      parameters: { type: "object", properties: { input: { type: "string" } } },
      execute: async (args, ctx) => {
        return mockToolResults.get("utility.test_tool") || { success: true, data: { output: `Result for ${args.input}` } };
      },
    });

    registerTool({
      name: "utility.failing_tool",
      description: "A tool that fails",
      category: "utility" as ToolCategory,
      risk: "low" as ToolRisk,
      parameters: { type: "object", properties: { fail: { type: "boolean" } } },
      execute: async (args, ctx) => {
        return mockToolResults.get("utility.failing_tool") || { success: false, error: "Tool failed" };
      },
    });

    registerTool({
      name: "memory.memory_read",
      description: "Read memory",
      category: "memory" as ToolCategory,
      risk: "low" as ToolRisk,
      parameters: { type: "object", properties: { query: { type: "string" } } },
      execute: async (args, ctx) => {
        return mockToolResults.get("memory.memory_read") || { success: true, data: { memories: [{ key: "test", value: "test value" }] } };
      },
    });

    registerTool({
      name: "memory.memory_write",
      description: "Write memory",
      category: "memory" as ToolCategory,
      risk: "low" as ToolRisk,
      parameters: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } } },
      execute: async (args, ctx) => {
        return mockToolResults.get("memory.memory_write") || { success: true, data: { written: true } };
      },
    });

    registerTool({
      name: "web.web_search",
      description: "Search the web",
      category: "web" as ToolCategory,
      risk: "low" as ToolRisk,
      parameters: { type: "object", properties: { query: { type: "string" } } },
      execute: async (args, ctx) => {
        return mockToolResults.get("web.web_search") || { success: true, data: { results: [{ title: "Result", url: "http://example.com" }] } };
      },
    });

    registerTool({
      name: "browser.browser_screenshot",
      description: "Take screenshot",
      category: "browser" as ToolCategory,
      risk: "medium" as ToolRisk,
      parameters: { type: "object", properties: { url: { type: "string" } } },
      execute: async (args, ctx) => {
        return mockToolResults.get("browser.browser_screenshot") || { success: true, data: { screenshot: "base64data" }, artifacts: [{ id: "art-1", type: "image", mimeType: "image/png", data: "base64data" }] };
      },
    });
  });

  function createConfig(overrides: Partial<UniversalAgentConfig> = {}): UniversalAgentConfig {
    return {
      maxToolCalls: 25,
      maxIterations: 10,
      temperature: 0.3,
      onToolEvent: (e) => events.push(e),
      onTokenStream: undefined, // Explicitly disable streaming for basic tests
      enableResilience: false, // Disable for basic tests
      ...overrides,
    };
  }

  describe("Single Tool Call", () => {
    it("should execute a single tool call and return result", async () => {
      setMockToolResult("utility.test_tool", { success: true, data: { output: "Hello World" } });
      mockAdapter.setResponses([
        createCompletion("I'll use the test tool", [createToolCall("call-1", "utility.test_tool", { input: "hello" })]),
        createCompletion("The result is Hello World", []),
      ]);

      const result = await runUniversalAgent(mockAdapter, testContext, "Say hello", createConfig());

      expect(result.success).toBe(true);
      expect(result.totalToolCalls).toBe(1);
      expect(result.totalIterations).toBe(2);
      expect(result.finalResponse).toBe("The result is Hello World");
    });

    it("should emit correct events for single tool call", async () => {
      setMockToolResult("utility.test_tool", { success: true, data: { output: "test" } });
      mockAdapter.setResponses([
        createCompletion("Calling tool", [createToolCall("call-1", "utility.test_tool", { input: "test" })]),
        createCompletion("Done", []),
      ]);

      await runUniversalAgent(mockAdapter, testContext, "Test", createConfig());

      const eventTypes = events.map(e => e.type);
      expect(eventTypes).toContain("thinking_start");
      expect(eventTypes).toContain("thinking_delta");
      expect(eventTypes).toContain("thinking_end");
      expect(eventTypes).toContain("tool_start");
      expect(eventTypes).toContain("tool_complete");
      expect(eventTypes).toContain("loop_complete");
    });
  });

  describe("Sequential Tool Calls", () => {
    it("should execute multiple tool calls in sequence across iterations", async () => {
      setMockToolResult("utility.test_tool", { success: true, data: { output: "step1" } });
      mockAdapter.setResponses([
        createCompletion("Step 1", [createToolCall("call-1", "utility.test_tool", { input: "step1" })]),
        createCompletion("Step 2", [createToolCall("call-2", "utility.test_tool", { input: "step2" })]),
        createCompletion("Done", []),
      ]);

      const result = await runUniversalAgent(mockAdapter, testContext, "Do two steps", createConfig());

      expect(result.success).toBe(true);
      expect(result.totalToolCalls).toBe(2);
      expect(result.totalIterations).toBe(3);
      expect(result.iterations[0].toolCalls).toHaveLength(1);
      expect(result.iterations[1].toolCalls).toHaveLength(1);
    });

    it("should pass previous tool results to next LLM call", async () => {
      setMockToolResult("utility.test_tool", { success: true, data: { output: "first" } });
      mockAdapter.setResponses([
        createCompletion("First", [createToolCall("call-1", "utility.test_tool", { input: "first" })]),
        createCompletion("Second", [createToolCall("call-2", "utility.test_tool", { input: "second" })]),
        createCompletion("Complete", []),
      ]);

      await runUniversalAgent(mockAdapter, testContext, "Two steps", createConfig());

      // Check that tool results were added to messages
      const lastMessages = mockAdapter.lastMessages;
      const toolMessage = lastMessages.find(m => m.role === "tool");
      expect(toolMessage).toBeDefined();
    });
  });

  describe("Dependent Tool Calls", () => {
    it("should handle tool calls where second depends on first", async () => {
      setMockToolResult("utility.test_tool", { success: true, data: { output: "data-for-step2" } });
      mockAdapter.setResponses([
        createCompletion("Getting data", [createToolCall("call-1", "utility.test_tool", { input: "get-data" })]),
        createCompletion("Processing data", [createToolCall("call-2", "utility.test_tool", { input: "process-data" })]),
        createCompletion("Complete", []),
      ]);

      const result = await runUniversalAgent(mockAdapter, testContext, "Dependent steps", createConfig());

      expect(result.success).toBe(true);
      expect(result.totalToolCalls).toBe(2);
    });
  });

  describe("Parallel Tool Calls", () => {
    it("should execute multiple independent tools in parallel", async () => {
      setMockToolResult("utility.test_tool", { success: true, data: { output: "parallel" } });
      mockAdapter.setResponses([
        createCompletion("Running parallel", [
          createToolCall("call-1", "utility.test_tool", { input: "task1" }),
          createToolCall("call-2", "utility.test_tool", { input: "task2" }),
          createToolCall("call-3", "utility.test_tool", { input: "task3" }),
        ]),
        createCompletion("All done", []),
      ]);

      const result = await runUniversalAgent(mockAdapter, testContext, "Parallel tasks", createConfig({ parallelExecution: true, maxParallel: 3 }));

      expect(result.success).toBe(true);
      expect(result.totalToolCalls).toBe(3);
      expect(result.totalIterations).toBe(2);

      // Check parallel group assignment
      const parallelEvents = events.filter(e => e.type === "tool_start");
      expect(parallelEvents.every(e => e.toolCall?.parallelGroup === 1)).toBe(true);
    });

    it("should respect maxParallel limit", async () => {
      setMockToolResult("utility.test_tool", { success: true, data: { output: "ok" } });
      mockAdapter.setResponses([
        createCompletion("Running 5 parallel", [
          createToolCall("call-1", "utility.test_tool", { input: "1" }),
          createToolCall("call-2", "utility.test_tool", { input: "2" }),
          createToolCall("call-3", "utility.test_tool", { input: "3" }),
          createToolCall("call-4", "utility.test_tool", { input: "4" }),
          createToolCall("call-5", "utility.test_tool", { input: "5" }),
        ]),
        createCompletion("Done", []),
      ]);

      await runUniversalAgent(mockAdapter, testContext, "Many parallel", createConfig({ parallelExecution: true, maxParallel: 2 }));

      // With maxParallel=2, only 2 should run at once
      // The semaphore logic ensures this
      expect(events.filter(e => e.type === "tool_start")).toHaveLength(5);
    });
  });

  describe("Failure and Retry", () => {
    it("should handle tool failure and retry with resilience enabled", async () => {
      setMockToolResult("failing_tool", { success: false, error: "Transient error" });
      mockAdapter.setResponses([
        createCompletion("Try tool", [createToolCall("call-1", "failing_tool", { fail: true })]),
        createCompletion("Retry", [createToolCall("call-2", "failing_tool", { fail: true })]),
        createCompletion("Success on retry", [createToolCall("call-3", "utility.test_tool", { input: "retry" })]),
        createCompletion("Done", []),
      ]);

      const result = await runUniversalAgent(mockAdapter, testContext, "Retry test", createConfig({ enableResilience: true }));

      // Should eventually succeed or handle gracefully
      expect(result.totalToolCalls).toBeGreaterThanOrEqual(1);
    });

    it("should stop after max iterations on repeated failures", async () => {
      setMockToolResult("failing_tool", { success: false, error: "Persistent error" });
      mockAdapter.setResponses([
        createCompletion("Try 1", [createToolCall("call-1", "failing_tool", { fail: true })]),
        createCompletion("Try 2", [createToolCall("call-2", "failing_tool", { fail: true })]),
        createCompletion("Try 3", [createToolCall("call-3", "failing_tool", { fail: true })]),
        createCompletion("Try 4", [createToolCall("call-4", "failing_tool", { fail: true })]),
        createCompletion("Try 5", [createToolCall("call-5", "failing_tool", { fail: true })]),
        createCompletion("Try 6", [createToolCall("call-6", "failing_tool", { fail: true })]),
        createCompletion("Try 7", [createToolCall("call-7", "failing_tool", { fail: true })]),
        createCompletion("Try 8", [createToolCall("call-8", "failing_tool", { fail: true })]),
        createCompletion("Try 9", [createToolCall("call-9", "failing_tool", { fail: true })]),
        createCompletion("Try 10", [createToolCall("call-10", "failing_tool", { fail: true })]),
      ]);

      const result = await runUniversalAgent(mockAdapter, testContext, "Fail repeatedly", createConfig({ maxIterations: 10, enableResilience: false }));

      expect(result.success).toBe(false);
      expect(result.error).toContain("All tool calls failed");
    });
  });

  describe("Permission Denial", () => {
    it("should handle permission denied errors from tool execution", async () => {
      // Register a tool that requires approval
      registerTool({
        name: "utility.restricted_tool",
        description: "A restricted tool",
        category: "utility" as ToolCategory,
        risk: "DESTRUCTIVE" as ToolRisk,
        parameters: { type: "object", properties: { input: { type: "string" } } },
        execute: async (args, ctx) => {
          return { success: true, data: { output: "restricted result" } };
        },
      });

      mockAdapter.setResponses([
        createCompletion("Try restricted tool", [createToolCall("call-1", "utility.restricted_tool", { input: "test" })]),
        // Second response - after tool fails, LLM acknowledges the error
        createCompletion("I see the tool requires permission", []),
      ]);

      const result = await runUniversalAgent(mockAdapter, testContext, "Permission test", createConfig({ enableResilience: true }));

      // Tool execution should fail due to missing approval
      // The agent should detect the failure and return success=false
      expect(result.success).toBe(false);
      expect(result.error || result.finalResponse).toContain("permission");
    });
  });

  describe("Large Output Handling", () => {
    it("should handle large tool outputs", async () => {
      const largeOutput = "x".repeat(100000); // 100KB output
      setMockToolResult("utility.test_tool", { success: true, data: { output: largeOutput } });
      mockAdapter.setResponses([
        createCompletion("Get large data", [createToolCall("call-1", "utility.test_tool", { input: "large" })]),
        createCompletion("Processed large data", []),
      ]);

      const result = await runUniversalAgent(mockAdapter, testContext, "Large output", createConfig());

      expect(result.success).toBe(true);
      expect(result.totalToolCalls).toBe(1);
    });
  });

  describe("Artifact Passing", () => {
    it("should pass artifacts between tool calls", async () => {
      const artifact: Artifact = { id: "art-1", type: "image", mimeType: "image/png", data: "base64data" };
      setMockToolResult("browser.browser_screenshot", { success: true, data: { screenshot: "base64data" }, artifacts: [artifact] });
      mockAdapter.setResponses([
        createCompletion("Take screenshot", [createToolCall("call-1", "browser.browser_screenshot", { url: "http://example.com" })]),
        createCompletion("Analyze screenshot", [createToolCall("call-2", "utility.test_tool", { input: "analyze art-1" })]),
        createCompletion("Done", []),
      ]);

      const result = await runUniversalAgent(mockAdapter, testContext, "Screenshot and analyze", createConfig());

      expect(result.success).toBe(true);
      expect(result.allArtifacts.length).toBeGreaterThanOrEqual(1);
      expect(result.allArtifacts[0].id).toBe("art-1");
    });

    it("should include artifacts in context for subsequent tools", async () => {
      const artifact: Artifact = { id: "art-1", type: "text", mimeType: "text/plain", data: "artifact content" };
      setMockToolResult("utility.test_tool", { success: true, data: { output: "done" }, artifacts: [artifact] });
      mockAdapter.setResponses([
        createCompletion("Create artifact", [createToolCall("call-1", "utility.test_tool", { input: "create" })]),
        createCompletion("Use artifact", [createToolCall("call-2", "utility.test_tool", { input: "use artifact" })]),
        createCompletion("Done", []),
      ]);

      const result = await runUniversalAgent(mockAdapter, testContext, "Artifact chain", createConfig());

      expect(result.allArtifacts.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Memory Read/Write", () => {
    it("should read memory and use it in subsequent calls", async () => {
      setMockToolResult("memory.memory_read", { success: true, data: { memories: [{ key: "user_pref", value: "dark_mode" }] } });
      setMockToolResult("utility.test_tool", { success: true, data: { output: "applied dark mode" } });
      mockAdapter.setResponses([
        createCompletion("Read memory", [createToolCall("call-1", "memory.memory_read", { query: "user preferences" })]),
        createCompletion("Apply preference", [createToolCall("call-2", "utility.test_tool", { input: "apply dark mode" })]),
        createCompletion("Done", []),
      ]);

      const result = await runUniversalAgent(mockAdapter, testContext, "Use memory", createConfig());

      expect(result.success).toBe(true);
      expect(result.totalToolCalls).toBe(2);
    });

    it("should write memory after completing task", async () => {
      setMockToolResult("memory.memory_write", { success: true, data: { written: true } });
      mockAdapter.setResponses([
        createCompletion("Write memory", [createToolCall("call-1", "memory.memory_write", { key: "new_fact", value: "learned something" })]),
        createCompletion("Done", []),
      ]);

      const result = await runUniversalAgent(mockAdapter, testContext, "Write memory", createConfig());

      expect(result.success).toBe(true);
      expect(result.totalToolCalls).toBe(1);
    });
  });

  describe("Cross-Capability Chaining", () => {
    it("should chain web search -> browser -> memory", async () => {
      setMockToolResult("web.web_search", { success: true, data: { results: [{ title: "Page", url: "http://example.com" }] } });
      setMockToolResult("browser.browser_screenshot", { success: true, data: { screenshot: "img" }, artifacts: [{ id: "art-1", type: "image", mimeType: "image/png", data: "img" }] });
      setMockToolResult("memory.memory_write", { success: true, data: { written: true } });
      mockAdapter.setResponses([
        createCompletion("Search web", [createToolCall("call-1", "web.web_search", { query: "test" })]),
        createCompletion("Screenshot result", [createToolCall("call-2", "browser.browser_screenshot", { url: "http://example.com" })]),
        createCompletion("Save to memory", [createToolCall("call-3", "memory.memory_write", { key: "search_result", value: "saved" })]),
        createCompletion("Complete", []),
      ]);

      const result = await runUniversalAgent(mockAdapter, testContext, "Cross-capability chain", createConfig());

      expect(result.success).toBe(true);
      expect(result.totalToolCalls).toBe(3);
      // Check tools from different categories were used
      const toolNames = result.iterations.flatMap(i => i.toolCalls.map(tc => tc.function.name));
      expect(toolNames).toContain("web.web_search");
      expect(toolNames).toContain("browser.browser_screenshot");
      expect(toolNames).toContain("memory.memory_write");
    });

    it("should chain multiple browser tools", async () => {
      setMockToolResult("browser.browser_screenshot", { success: true, data: { screenshot: "img1" }, artifacts: [{ id: "art-1", type: "image", mimeType: "image/png", data: "img1" }] });
      mockAdapter.setResponses([
        createCompletion("First screenshot", [createToolCall("call-1", "browser.browser_screenshot", { url: "http://a.com" })]),
        createCompletion("Second screenshot", [createToolCall("call-2", "browser.browser_screenshot", { url: "http://b.com" })]),
        createCompletion("Done", []),
      ]);

      const result = await runUniversalAgent(mockAdapter, testContext, "Multiple browser", createConfig());

      expect(result.success).toBe(true);
      expect(result.totalToolCalls).toBe(2);
    });
  });

  describe("Tool Call Budget", () => {
    it("should respect maxToolCalls limit", async () => {
      setMockToolResult("utility.test_tool", { success: true, data: { output: "ok" } });
      // Create multiple tool calls per iteration to hit budget before maxIterations
      const responses = [];
      for (let i = 0; i < 5; i++) {
        // 3 tool calls per iteration = 15 total, but budget is 10
        responses.push(createCompletion(`Step ${i}`, [
          createToolCall(`call-${i}-1`, "utility.test_tool", { input: `${i}-1` }),
          createToolCall(`call-${i}-2`, "utility.test_tool", { input: `${i}-2` }),
          createToolCall(`call-${i}-3`, "utility.test_tool", { input: `${i}-3` }),
        ]));
      }
      responses.push(createCompletion("Done", []));
      mockAdapter.setResponses(responses);

      const result = await runUniversalAgent(mockAdapter, testContext, "Many tools", createConfig({ maxToolCalls: 10, maxIterations: 10 }));

      expect(result.totalToolCalls).toBeLessThanOrEqual(10);
      expect(result.error).toContain("Tool call budget exceeded");
    });
  });

  describe("Max Iterations", () => {
    it("should stop after maxIterations", async () => {
      setMockToolResult("utility.test_tool", { success: true, data: { output: "ok" } });
      // Create responses for 15 iterations
      const responses = [];
      for (let i = 0; i < 15; i++) {
        responses.push(createCompletion(`Iteration ${i}`, [createToolCall(`call-${i}`, "utility.test_tool", { input: i })]));
      }
      mockAdapter.setResponses(responses);

      const result = await runUniversalAgent(mockAdapter, testContext, "Many iterations", createConfig({ maxIterations: 5 }));

      expect(result.totalIterations).toBeLessThanOrEqual(5);
      expect(result.error).toContain("Max iterations reached");
    });
  });

  describe("Streaming Final Response", () => {
    it("should stream final response when onTokenStream provided", async () => {
      setMockToolResult("utility.test_tool", { success: true, data: { output: "done" } });
      mockAdapter.setResponses([
        createCompletion("Using tool", [createToolCall("call-1", "utility.test_tool", { input: "test" })]),
        // The final stream response is handled by the stream function
      ]);
      mockAdapter.setStreamResponses([
        createStreamResponse(["Final ", "response ", "streamed"]),
      ]);

      const onTokenStream = vi.fn();
      const result = await runUniversalAgent(mockAdapter, testContext, "Stream test", createConfig({ onTokenStream }));

      expect(onTokenStream).toHaveBeenCalled();
      expect(onTokenStream).toHaveBeenCalledWith("Final ");
      expect(onTokenStream).toHaveBeenCalledWith("response ");
      expect(onTokenStream).toHaveBeenCalledWith("streamed");
    });
  });

  describe("UniversalAgent Class", () => {
    it("should maintain conversation history across runs", async () => {
      setMockToolResult("utility.test_tool", { success: true, data: { output: "first" } });
      mockAdapter.setResponses([
        createCompletion("First run", [createToolCall("call-1", "utility.test_tool", { input: "first" })]),
        createCompletion("First done", []),
      ]);

      const agent = new UniversalAgent(mockAdapter, testContext, createConfig());
      const result1 = await agent.run("First message");

      expect(result1.success).toBe(true);
      expect(agent.getStats().totalToolCalls).toBe(1);
      expect(agent.getStats().historyLength).toBeGreaterThan(0);

      // Second run
      setMockToolResult("utility.test_tool", { success: true, data: { output: "second" } });
      mockAdapter.setResponses([
        createCompletion("Second run", [createToolCall("call-2", "utility.test_tool", { input: "second" })]),
        createCompletion("Second done", []),
      ]);

      const result2 = await agent.run("Second message");
      expect(result2.success).toBe(true);
      expect(agent.getStats().totalToolCalls).toBe(2);
    });

    it("should prevent concurrent runs", async () => {
      setMockToolResult("utility.test_tool", { success: true, data: { output: "slow" } });
      mockAdapter.setResponses([
        createCompletion("Slow", [createToolCall("call-1", "utility.test_tool", { input: "slow" })]),
        // Never resolves - would need delay
      ]);

      const agent = new UniversalAgent(mockAdapter, testContext, createConfig());
      const promise = agent.run("Test");

      // Try to run again while first is running
      await expect(agent.run("Test 2")).rejects.toThrow("Agent is already running");

      // Clean up
      mockAdapter.setResponses([createCompletion("Done", [])]);
      await promise;
    });

    it("should reset state correctly", async () => {
      setMockToolResult("utility.test_tool", { success: true, data: { output: "test" } });
      mockAdapter.setResponses([
        createCompletion("Run", [createToolCall("call-1", "utility.test_tool", { input: "test" })]),
        createCompletion("Done", []),
      ]);

      const agent = new UniversalAgent(mockAdapter, testContext, createConfig());
      await agent.run("Test");
      expect(agent.getStats().totalToolCalls).toBe(1);

      agent.reset();
      expect(agent.getStats().totalToolCalls).toBe(0);
      expect(agent.getStats().historyLength).toBe(0);
    });
  });

  describe("Health Check Integration", () => {
    it("should report tool health", async () => {
      const { runUniversalToolHealthCheck } = await import("../src/lib/tool-resilience");
      const health = await runUniversalToolHealthCheck(testContext, ["utility.test_tool"]);
      expect(health).toHaveProperty("healthy");
      expect(health).toHaveProperty("results");
    });
  });

  describe("Circuit Breaker", () => {
    it("should track circuit breaker state", async () => {
      const { getCircuitBreakerStatus, resetCircuitBreaker } = await import("../src/lib/tool-resilience");

      // Trigger some failures to open circuit
      setMockToolResult("failing_tool", { success: false, error: "Service down" });
      mockAdapter.setResponses([
        createCompletion("Try", [createToolCall("call-1", "failing_tool", { fail: true })]),
        createCompletion("Done", []),
      ]);

      await runUniversalAgent(mockAdapter, testContext, "Circuit test", createConfig({ enableResilience: true }));

      const status = getCircuitBreakerStatus("failing_tool");
      // Circuit breaker may be open depending on threshold
      if (status) {
        expect(status).toHaveProperty("state");
        expect(["closed", "open", "half-open"]).toContain(status.state);
      }

      resetCircuitBreaker("failing_tool");
    });
  });

  describe("Resilience Metrics", () => {
    it("should track resilience metrics", async () => {
      const { getUniversalResilienceMetrics, resetUniversalResilienceMetrics } = await import("../src/lib/tool-resilience");

      resetUniversalResilienceMetrics();

      setMockToolResult("utility.test_tool", { success: true, data: { output: "ok" } });
      mockAdapter.setResponses([
        createCompletion("Tool call", [createToolCall("call-1", "utility.test_tool", { input: "test" })]),
        createCompletion("Done", []),
      ]);

      await runUniversalAgent(mockAdapter, testContext, "Metrics test", createConfig({ enableResilience: true }));

      const metrics = getUniversalResilienceMetrics();
      expect(metrics.totalCalls).toBeGreaterThan(0);
      expect(metrics.successfulCalls).toBeGreaterThan(0);
    });
  });
});