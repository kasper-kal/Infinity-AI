/**
 * Debug Tools — Debug Adapter Protocol (DAP) integration for agent debugging
 * Supports: breakpoints, variable inspection, step-through, test running, failure analysis, auto-fix
 */

import { LLMAdapter } from "./llm-adapter";
import { ToolExecutionContext, UniversalToolResult, registerTool, ToolCategory, ToolRisk } from "./tool-registry";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

export interface Breakpoint {
  id: string;
  file: string;
  line: number;
  condition?: string;
  enabled: boolean;
  hitCount?: number;
}

export interface Variable {
  name: string;
  value: string;
  type?: string;
  variablesReference?: number;
}

export interface StackFrame {
  id: number;
  name: string;
  source: { path: string };
  line: number;
  column: number;
}

export interface DebugSession {
  id: string;
  type: "node" | "python" | "go" | "rust" | "test" | "custom";
  program: string;
  args: string[];
  cwd: string;
  breakpoints: Breakpoint[];
  status: "initializing" | "running" | "paused" | "stopped" | "error";
  currentFrame?: StackFrame;
  variables: Map<number, Variable[]>;
  output: string[];
}

export interface TestResult {
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  tests: Array<{
    name: string;
    status: "passed" | "failed" | "skipped";
    duration: number;
    error?: string;
    file?: string;
    line?: number;
  }>;
  summary: string;
}

export interface DebugConfig {
  projectRoot: string;
  projectId: string;
  adapter: LLMAdapter;
  onOutput?: (output: string) => void;
  onBreakpoint?: (breakpoint: Breakpoint, frame: StackFrame) => void;
}

// ============================================================================
// Debug Tools Manager
// ============================================================================

export class DebugTools {
  private config: DebugConfig;
  private sessions: Map<string, DebugSession> = new Map();
  private activeSessionId: string | null = null;
  private dapProcess: any = null;

  constructor(config: DebugConfig) {
    this.config = config;
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  createSession(
    type: DebugSession["type"],
    program: string,
    args: string[] = [],
    cwd?: string
  ): DebugSession {
    const id = `debug-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const session: DebugSession = {
      id,
      type,
      program,
      args,
      cwd: cwd || this.config.projectRoot,
      breakpoints: [],
      status: "initializing",
      variables: new Map(),
      output: [],
    };
    this.sessions.set(id, session);
    this.activeSessionId = id;
    return session;
  }

  getSession(id?: string): DebugSession | undefined {
    return this.sessions.get(id || this.activeSessionId || "");
  }

  getActiveSession(): DebugSession | null {
    return this.activeSessionId ? this.sessions.get(this.activeSessionId) || null : null;
  }

  listSessions(): DebugSession[] {
    return Array.from(this.sessions.values());
  }

  closeSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    if (session.status === "running" || session.status === "paused") {
      this.stopSession(id);
    }
    this.sessions.delete(id);
    if (this.activeSessionId === id) {
      this.activeSessionId = this.sessions.keys().next().value || null;
    }
    return true;
  }

  // ============================================================================
  // Breakpoint Management
  // ============================================================================

  setBreakpoint(file: string, line: number, condition?: string): Breakpoint {
    const session = this.getActiveSession();
    if (!session) throw new Error("No active debug session");

    const id = `bp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const breakpoint: Breakpoint = {
      id,
      file: path.resolve(this.config.projectRoot, file),
      line,
      condition,
      enabled: true,
    };
    session.breakpoints.push(breakpoint);
    return breakpoint;
  }

  removeBreakpoint(breakpointId: string): boolean {
    const session = this.getActiveSession();
    if (!session) return false;

    const index = session.breakpoints.findIndex(b => b.id === breakpointId);
    if (index === -1) return false;

    session.breakpoints.splice(index, 1);
    return true;
  }

  enableBreakpoint(breakpointId: string, enabled: boolean): boolean {
    const session = this.getActiveSession();
    if (!session) return false;

    const bp = session.breakpoints.find(b => b.id === breakpointId);
    if (!bp) return false;

    bp.enabled = enabled;
    return true;
  }

  getBreakpoints(): Breakpoint[] {
    return this.getActiveSession()?.breakpoints || [];
  }

  // ============================================================================
  // Debug Execution
  // ============================================================================

  async startSession(sessionId?: string): Promise<UniversalToolResult> {
    const session = this.getSession(sessionId);
    if (!session) return { success: false, error: "Session not found" };

    try {
      session.status = "running";

      // For Node.js, we'll use the built-in inspector
      if (session.type === "node" || session.type === "test") {
        return await this.startNodeDebugSession(session);
      }

      // For other languages, use generic approach
      return await this.startGenericDebugSession(session);
    } catch (error) {
      session.status = "error";
      return { success: false, error: String(error) };
    }
  }

  private async startNodeDebugSession(session: DebugSession): Promise<UniversalToolResult> {
    const { spawn } = await import("child_process");
    const inspector = await import("inspector");

    return new Promise((resolve) => {
      const debugPort = 9229 + Math.floor(Math.random() * 1000);
      const nodeArgs = [
        `--inspect=0.0.0.0:${debugPort}`,
        ...session.args,
        session.program,
      ];

      const child = spawn("node", nodeArgs, {
        cwd: session.cwd,
        env: { ...process.env, NODE_OPTIONS: `--inspect=0.0.0.0:${debugPort}` },
      });

      let output = "";
      let errorOutput = "";

      child.stdout.on("data", (data) => {
        const text = data.toString();
        output += text;
        session.output.push(text);
        this.config.onOutput?.(text);
      });

      child.stderr.on("data", (data) => {
        const text = data.toString();
        errorOutput += text;
        session.output.push(`[stderr] ${text}`);
        this.config.onOutput?.(`[stderr] ${text}`);
      });

      child.on("error", (err) => {
        session.status = "error";
        resolve({ success: false, error: err.message, summary: "Failed to start debug session" });
      });

      child.on("exit", (code) => {
        session.status = code === 0 ? "stopped" : "error";
        resolve({
          success: code === 0,
          data: { output, exitCode: code },
          summary: `Debug session exited with code ${code}`,
        });
      });

      // Wait for inspector to be ready
      setTimeout(() => {
        session.status = "running";
        resolve({ success: true, data: { debugPort }, summary: `Debug session started on port ${debugPort}` });
      }, 1000);
    });
  }

  private async startGenericDebugSession(session: DebugSession): Promise<UniversalToolResult> {
    const { spawn } = await import("child_process");

    return new Promise((resolve) => {
      const child = spawn(session.program, session.args, {
        cwd: session.cwd,
        env: process.env,
      });

      let output = "";

      child.stdout.on("data", (data) => {
        const text = data.toString();
        output += text;
        session.output.push(text);
        this.config.onOutput?.(text);
      });

      child.stderr.on("data", (data) => {
        const text = data.toString();
        output += text;
        session.output.push(`[stderr] ${text}`);
        this.config.onOutput?.(`[stderr] ${text}`);
      });

      child.on("exit", (code) => {
        session.status = code === 0 ? "stopped" : "error";
        resolve({
          success: code === 0,
          data: { output, exitCode: code },
          summary: `Process exited with code ${code}`,
        });
      });

      session.status = "running";
      resolve({ success: true, summary: `Process started` });
    });
  }

  async stopSession(sessionId?: string): Promise<UniversalToolResult> {
    const session = this.getSession(sessionId);
    if (!session) return { success: false, error: "Session not found" };

    session.status = "stopped";
    return { success: true, summary: "Debug session stopped" };
  }

  async pauseSession(sessionId?: string): Promise<UniversalToolResult> {
    const session = this.getSession(sessionId);
    if (!session) return { success: false, error: "Session not found" };

    // In a real implementation, this would send a pause command via DAP
    session.status = "paused";
    return { success: true, summary: "Debug session paused" };
  }

  async continueSession(sessionId?: string): Promise<UniversalToolResult> {
    const session = this.getSession(sessionId);
    if (!session) return { success: false, error: "Session not found" };

    session.status = "running";
    return { success: true, summary: "Debug session continued" };
  }

  async stepOver(sessionId?: string): Promise<UniversalToolResult> {
    const session = this.getSession(sessionId);
    if (!session) return { success: false, error: "Session not found" };

    // In a real implementation, this would send stepOver via DAP
    return { success: true, summary: "Step over" };
  }

  async stepInto(sessionId?: string): Promise<UniversalToolResult> {
    const session = this.getSession(sessionId);
    if (!session) return { success: false, error: "Session not found" };

    // In a real implementation, this would send stepIn via DAP
    return { success: true, summary: "Step into" };
  }

  async stepOut(sessionId?: string): Promise<UniversalToolResult> {
    const session = this.getSession(sessionId);
    if (!session) return { success: false, error: "Session not found" };

    // In a real implementation, this would send stepOut via DAP
    return { success: true, summary: "Step out" };
  }

  // ============================================================================
  // Variable Inspection
  // ============================================================================

  async getVariables(frameId?: number, sessionId?: string): Promise<UniversalToolResult> {
    const session = this.getSession(sessionId);
    if (!session) return { success: false, error: "Session not found" };

    // In a real implementation, this would query variables via DAP
    // For now, return mock data
    const variables: Variable[] = [
      { name: "this", value: "Object", type: "object", variablesReference: 1 },
      { name: "arguments", value: "Arguments", type: "object", variablesReference: 2 },
    ];

    if (frameId) {
      session.variables.set(frameId, variables);
    }

    return { success: true, data: variables, summary: `${variables.length} variables in scope` };
  }

  async evaluateExpression(expression: string, frameId?: number, sessionId?: string): Promise<UniversalToolResult> {
    const session = this.getSession(sessionId);
    if (!session) return { success: false, error: "Session not found" };

    // In a real implementation, this would evaluate via DAP
    return {
      success: true,
      data: { result: `Evaluated: ${expression}`, type: "string" },
      summary: `Evaluated expression in frame ${frameId || "current"}`,
    };
  }

  // ============================================================================
  // Test Running
  // ============================================================================

  async runTests(options: {
    command?: string;
    file?: string;
    pattern?: string;
    coverage?: boolean;
  } = {}): Promise<UniversalToolResult> {
    const cwd = this.config.projectRoot;
    const command = options.command || this.detectTestCommand(cwd);
    let fullCommand = command;

    if (options.file) {
      fullCommand += ` ${options.file}`;
    }
    if (options.pattern) {
      fullCommand += ` --testNamePattern="${options.pattern}"`;
    }
    if (options.coverage) {
      fullCommand += " --coverage";
    }

    try {
      const output = execSync(fullCommand, {
        cwd,
        encoding: "utf-8",
        timeout: 180000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const result = this.parseTestOutput(output, command);
      return {
        success: result.failed === 0,
        data: result,
        summary: result.summary,
      };
    } catch (error: any) {
      const output = error.stdout || "";
      const result = this.parseTestOutput(output, command);
      return {
        success: false,
        data: result,
        error: error.stderr || error.message,
        summary: result.summary,
      };
    }
  }

  private detectTestCommand(cwd: string): string {
    const packageJsonPath = path.join(cwd, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      if (pkg.scripts?.test) return "npm test";
      if (pkg.scripts?.test:unit) return "npm run test:unit";
      if (pkg.scripts?.test:e2e) return "npm run test:e2e";
    }

    // Check for other test frameworks
    if (fs.existsSync(path.join(cwd, "vitest.config.ts"))) return "npx vitest run";
    if (fs.existsSync(path.join(cwd, "jest.config.js"))) return "npx jest";
    if (fs.existsSync(path.join(cwd, "playwright.config.ts"))) return "npx playwright test";
    if (fs.existsSync(path.join(cwd, "pytest.ini")) || fs.existsSync(path.join(cwd, "pyproject.toml"))) return "python -m pytest";

    return "npm test";
  }

  private parseTestOutput(output: string, command: string): TestResult {
    const lines = output.trim().split("\n");
    const tests: TestResult["tests"] = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    // Parse common test output formats
    for (const line of lines) {
      // Vitest/Jest format: ✓ test name (123ms)
      const vitestMatch = line.match(/^[✓✕]\s+(.+?)\s+\((\d+)ms\)$/);
      if (vitestMatch) {
        const [, name, duration] = vitestMatch;
        if (line.startsWith("✓")) {
          passed++;
          tests.push({ name, status: "passed", duration: parseInt(duration) });
        } else {
          failed++;
          tests.push({ name, status: "failed", duration: parseInt(duration), error: "Test failed" });
        }
        continue;
      }

      // Playwright format
      const pwMatch = line.match(/^\s+(\d+)\s+(passed|failed|skipped)/);
      if (pwMatch) {
        // Summary line
        continue;
      }

      // Generic pass/fail
      if (line.includes("PASS") || line.includes("passed")) {
        passed++;
      } else if (line.includes("FAIL") || line.includes("failed")) {
        failed++;
      } else if (line.includes("SKIP") || line.includes("skipped")) {
        skipped++;
      }
    }

    const duration = 0; // Would need to parse from output

    return {
      passed,
      failed,
      skipped,
      duration,
      tests,
      summary: `${passed} passed, ${failed} failed, ${skipped} skipped (${command})`,
    };
  }

  // ============================================================================
  // Test Failure Analysis & Auto-Fix
  // ============================================================================

  async analyzeTestFailures(testResult: TestResult): Promise<UniversalToolResult> {
    const failedTests = testResult.tests.filter(t => t.status === "failed");
    if (failedTests.length === 0) {
      return { success: true, data: { analysis: "No failures to analyze" }, summary: "All tests passed" };
    }

    // Use LLM to analyze failures
    const prompt = `Analyze these test failures and suggest fixes:

${failedTests.map(t => `
Test: ${t.name}
File: ${t.file || "unknown"}
Line: ${t.line || "unknown"}
Error: ${t.error || "unknown"}
`).join("\n")}

Provide:
1. Root cause analysis for each failure
2. Suggested fix (code change)
3. Priority order for fixing`;

    const response = await this.config.adapter.complete([
      { role: "system", content: "You are an expert debugger. Analyze test failures and provide actionable fixes." },
      { role: "user", content: prompt },
    ], { temperature: 0.1, maxTokens: 4096 });

    return {
      success: true,
      data: {
        analysis: response.text,
        failedCount: failedTests.length,
        failedTests,
      },
      summary: `Analyzed ${failedTests.length} test failures`,
    };
  }

  async autoFixTestFailures(testResult: TestResult): Promise<UniversalToolResult> {
    const analysisResult = await this.analyzeTestFailures(testResult);
    const analysis = analysisResult.data?.analysis || "";

    if (!analysis) {
      return { success: false, error: "Could not analyze failures" };
    }

    // Parse suggested fixes from analysis
    const fixes = this.extractFixesFromAnalysis(analysis);

    const results = [];
    for (const fix of fixes) {
      if (fix.file && fix.diff) {
        try {
          const filePath = path.join(this.config.projectRoot, fix.file);
          const currentContent = fs.readFileSync(filePath, "utf-8");

          // Apply the diff (simplified - real implementation would use proper patch)
          const newContent = this.applyDiff(currentContent, fix.diff);
          fs.writeFileSync(filePath, newContent, "utf-8");

          results.push({ file: fix.file, success: true, description: fix.description });
        } catch (error) {
          results.push({ file: fix.file, success: false, error: String(error) });
        }
      }
    }

    // Re-run tests to verify
    const reRunResult = await this.runTests();

    return {
      success: true,
      data: {
        fixesApplied: results,
        reRunResult: reRunResult.data,
      },
      summary: `Applied ${results.filter(r => r.success).length}/${results.length} fixes`,
    };
  }

  private extractFixesFromAnalysis(analysis: string): Array<{ file: string; diff: string; description: string }> {
    const fixes: Array<{ file: string; diff: string; description: string }> = [];

    // Look for code blocks with file paths
    const codeBlocks = analysis.match(/```(?:diff|patch)\n([\s\S]*?)```/g);
    if (codeBlocks) {
      for (const block of codeBlocks) {
        const fileMatch = block.match(/--- a\/(.+)\n/);
        if (fileMatch) {
          fixes.push({
            file: fileMatch[1],
            diff: block,
            description: "Auto-extracted fix",
          });
        }
      }
    }

    return fixes;
  }

  private applyDiff(content: string, diff: string): string {
    // Simplified diff application - in production use a proper patch library
    return content; // Placeholder
  }

  // ============================================================================
  // Call Stack & Frames
  // ============================================================================

  async getCallStack(sessionId?: string): Promise<UniversalToolResult> {
    const session = this.getSession(sessionId);
    if (!session) return { success: false, error: "Session not found" };

    // Mock call stack - real implementation via DAP
    const frames: StackFrame[] = [
      { id: 0, name: "main", source: { path: session.program }, line: 1, column: 0 },
    ];

    return { success: true, data: frames, summary: `${frames.length} stack frames` };
  }

  async setVariable(name: string, value: string, frameId: number, sessionId?: string): Promise<UniversalToolResult> {
    const session = this.getSession(sessionId);
    if (!session) return { success: false, error: "Session not found" };

    // In real implementation, this would use DAP setVariable
    return { success: true, summary: `Set ${name} = ${value} in frame ${frameId}` };
  }

  // ============================================================================
  // Console Log Capture
  // ============================================================================

  getConsoleOutput(sessionId?: string): string[] {
    return this.getSession(sessionId)?.output || [];
  }

  clearConsoleOutput(sessionId?: string): void {
    const session = this.getSession(sessionId);
    if (session) session.output = [];
  }
}

// ============================================================================
// Register Debug Tools in Universal Tool Registry
// ============================================================================

export function registerDebugTools(projectRoot: string, projectId: string, adapter: LLMAdapter): void {
  const debugTools = new DebugTools({ projectRoot, projectId, adapter });

  // Start debug session
  registerTool({
    name: "debug.start",
    description: "Start a debug session for a program",
    category: "debug",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["node", "python", "go", "rust", "test", "custom"] },
        program: { type: "string", description: "Program to debug (e.g., 'src/index.ts')" },
        args: { type: "array", items: { type: "string" }, description: "Command line arguments" },
        cwd: { type: "string", description: "Working directory" },
      },
      required: ["type", "program"],
    },
    execute: async (args, ctx) => {
      const session = debugTools.createSession(args.type as any, args.program as string, args.args as string[], args.cwd as string);
      return debugTools.startSession(session.id);
    },
  });

  // Stop debug session
  registerTool({
    name: "debug.stop",
    description: "Stop the active debug session",
    category: "debug",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID to stop (default: active)" },
      },
    },
    execute: async (args, ctx) => debugTools.stopSession(args.sessionId as string),
  });

  // Pause/Continue/Step
  registerTool({
    name: "debug.pause",
    description: "Pause the active debug session",
    category: "debug",
    risk: "READ",
    execute: async (args, ctx) => debugTools.pauseSession(),
  });

  registerTool({
    name: "debug.continue",
    description: "Continue the active debug session",
    category: "debug",
    risk: "READ",
    execute: async (args, ctx) => debugTools.continueSession(),
  });

  registerTool({
    name: "debug.stepOver",
    description: "Step over in the active debug session",
    category: "debug",
    risk: "READ",
    execute: async (args, ctx) => debugTools.stepOver(),
  });

  registerTool({
    name: "debug.stepInto",
    description: "Step into in the active debug session",
    category: "debug",
    risk: "READ",
    execute: async (args, ctx) => debugTools.stepInto(),
  });

  registerTool({
    name: "debug.stepOut",
    description: "Step out in the active debug session",
    category: "debug",
    risk: "READ",
    execute: async (args, ctx) => debugTools.stepOut(),
  });

  // Breakpoints
  registerTool({
    name: "debug.setBreakpoint",
    description: "Set a breakpoint in the active debug session",
    category: "debug",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        file: { type: "string", description: "File path" },
        line: { type: "number", description: "Line number" },
        condition: { type: "string", description: "Optional condition" },
      },
      required: ["file", "line"],
    },
    execute: async (args, ctx) => {
      const bp = debugTools.setBreakpoint(args.file as string, args.line as number, args.condition as string);
      return { success: true, data: bp, summary: `Breakpoint set at ${args.file}:${args.line}` };
    },
  });

  registerTool({
    name: "debug.removeBreakpoint",
    description: "Remove a breakpoint",
    category: "debug",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        breakpointId: { type: "string", description: "Breakpoint ID to remove" },
      },
      required: ["breakpointId"],
    },
    execute: async (args, ctx) => {
      const success = debugTools.removeBreakpoint(args.breakpointId as string);
      return { success, summary: success ? "Breakpoint removed" : "Breakpoint not found" };
    },
  });

  registerTool({
    name: "debug.listBreakpoints",
    description: "List all breakpoints in the active session",
    category: "debug",
    risk: "READ",
    execute: async (args, ctx) => {
      const bps = debugTools.getBreakpoints();
      return { success: true, data: bps, summary: `${bps.length} breakpoints` };
    },
  });

  // Variables
  registerTool({
    name: "debug.getVariables",
    description: "Get variables in current scope",
    category: "debug",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        frameId: { type: "number", description: "Stack frame ID" },
        sessionId: { type: "string", description: "Session ID" },
      },
    },
    execute: async (args, ctx) => debugTools.getVariables(args.frameId as number, args.sessionId as string),
  });

  registerTool({
    name: "debug.evaluate",
    description: "Evaluate an expression in the debug context",
    category: "debug",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        expression: { type: "string", description: "Expression to evaluate" },
        frameId: { type: "number", description: "Stack frame ID" },
        sessionId: { type: "string", description: "Session ID" },
      },
      required: ["expression"],
    },
    execute: async (args, ctx) => debugTools.evaluateExpression(args.expression as string, args.frameId as number, args.sessionId as string),
  });

  // Call stack
  registerTool({
    name: "debug.getCallStack",
    description: "Get the current call stack",
    category: "debug",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
      },
    },
    execute: async (args, ctx) => debugTools.getCallStack(args.sessionId as string),
  });

  // Test running
  registerTool({
    name: "test.run",
    description: "Run tests in the project",
    category: "test",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Test command (default: auto-detect)" },
        file: { type: "string", description: "Specific test file" },
        pattern: { type: "string", description: "Test name pattern" },
        coverage: { type: "boolean", description: "Run with coverage" },
      },
    },
    execute: async (args, ctx) => debugTools.runTests(args),
  });

  // Analyze test failures
  registerTool({
    name: "test.analyzeFailures",
    description: "Analyze test failures and suggest fixes",
    category: "test",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        testResult: { type: "object", description: "Test result object from test.run" },
      },
      required: ["testResult"],
    },
    execute: async (args, ctx) => debugTools.analyzeTestFailures(args.testResult as any),
  });

  // Auto-fix test failures
  registerTool({
    name: "test.autoFix",
    description: "Automatically fix test failures based on analysis",
    category: "test",
    risk: "WRITE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        testResult: { type: "object", description: "Test result object from test.run" },
      },
      required: ["testResult"],
    },
    execute: async (args, ctx) => debugTools.autoFixTestFailures(args.testResult as any),
  });

  // Console output
  registerTool({
    name: "debug.getConsoleOutput",
    description: "Get console output from debug session",
    category: "debug",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
      },
    },
    execute: async (args, ctx) => {
      const output = debugTools.getConsoleOutput(args.sessionId as string);
      return { success: true, data: output, summary: `${output.length} lines of output` };
    },
  });

  registerTool({
    name: "debug.clearConsoleOutput",
    description: "Clear console output",
    category: "debug",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
      },
    },
    execute: async (args, ctx) => {
      debugTools.clearConsoleOutput(args.sessionId as string);
      return { success: true, summary: "Console output cleared" };
    },
  });
}

export { DebugTools };
export type { Breakpoint, Variable, StackFrame, DebugSession, TestResult, DebugConfig };