/**
 * Debug Tools — DAP integration, breakpoints, variable inspection, test running, auto-fix
 * Part of Phase 30: Advanced Agent Capabilities (Cursor Agent Parity)
 */

import { EventEmitter } from 'events';
import { z } from 'zod';
import { UniversalToolRegistry, executeTool } from './tool-registry.js';
import { ToolExecutionContext, UniversalToolResult } from './tool-types.js';

// ============================================================================
// Types & Schemas
// ============================================================================

export const BreakpointSchema = z.object({
  id: z.string(),
  file: z.string(),
  line: z.number(),
  column: z.number().optional(),
  condition: z.string().optional(),
  hitCondition: z.string().optional(),
  logMessage: z.string().optional(),
  enabled: z.boolean().default(true),
  verified: z.boolean().default(false),
});

export const DebugSessionSchema = z.object({
  id: z.string(),
  type: z.enum(['node', 'chrome', 'jest', 'vitest', 'playwright', 'python', 'go']),
  name: z.string(),
  status: z.enum(['starting', 'running', 'paused', 'stopped', 'terminated']).default('starting'),
  config: z.record(z.any()),
  breakpoints: z.array(BreakpointSchema).default([]),
  variables: z.record(z.any()).default({}),
  callStack: z.array(z.object({
    id: z.number(),
    name: z.string(),
    file: z.string(),
    line: z.number(),
    column: z.number(),
  })).default([]),
  createdAt: z.string(),
  pid: z.number().optional(),
  port: z.number().optional(),
});

export const WatchExpressionSchema = z.object({
  expression: z.string(),
  value: z.any(),
  type: z.string().optional(),
  error: z.string().optional(),
});

export const TestResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  file: z.string(),
  status: z.enum(['passed', 'failed', 'skipped', 'running']),
  duration: z.number(),
  error: z.string().optional(),
  stack: z.string().optional(),
  assertions: z.number().default(0),
});

export const TestRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  framework: z.enum(['jest', 'vitest', 'playwright', 'cypress', 'mocha']),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']).default('running'),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  totalTests: z.number().default(0),
  passed: z.number().default(0),
  failed: z.number().default(0),
  skipped: z.number().default(0),
  duration: z.number().default(0),
  results: z.array(TestResultSchema).default([]),
  coverage: z.object({
    lines: z.number().optional(),
    functions: z.number().optional(),
    branches: z.number().optional(),
    statements: z.number().optional(),
  }).optional(),
});

export const AutoFixResultSchema = z.object({
  testId: z.string(),
  originalError: z.string(),
  fixApplied: z.string(),
  fixedCode: z.string(),
  verified: z.boolean(),
  newTestResult: TestResultSchema.optional(),
});

export type Breakpoint = z.infer<typeof BreakpointSchema>;
export type DebugSession = z.infer<typeof DebugSessionSchema>;
export type WatchExpression = z.infer<typeof WatchExpressionSchema>;
export type TestResult = z.infer<typeof TestResultSchema>;
export type TestRun = z.infer<typeof TestRunSchema>;
export type AutoFixResult = z.infer<typeof AutoFixResultSchema>;

// ============================================================================
// Debug Tools Manager
// ============================================================================

export class DebugToolsManager extends EventEmitter {
  private toolRegistry: UniversalToolRegistry;
  private sessions: Map<string, DebugSession> = new Map();
  private testRuns: Map<string, TestRun> = new Map();
  private breakpoints: Map<string, Breakpoint[]> = new Map(); // file -> breakpoints

  constructor(toolRegistry: UniversalToolRegistry) {
    super();
    this.toolRegistry = toolRegistry;
  }

  // =========================================================================
  // Debug Session Management
  // =========================================================================

  /**
   * Start a new debug session
   */
  async startDebugSession(config: {
    type: DebugSession['type'];
    name: string;
    projectId: string;
    workspacePath: string;
    config: Record<string, any>;
  }): Promise<DebugSession> {
    const sessionId = `debug_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const session: DebugSession = {
      id: sessionId,
      type: config.type,
      name: config.name,
      status: 'starting',
      config: config.config,
      breakpoints: [],
      variables: {},
      callStack: [],
      createdAt: new Date().toISOString(),
    };

    // Apply existing breakpoints for this project
    const projectBreakpoints = this.breakpoints.get(config.projectId) || [];
    session.breakpoints = projectBreakpoints;

    this.sessions.set(sessionId, session);
    this.emit('session:created', session);

    // Start the actual debug adapter based on type
    await this.launchDebugAdapter(session, config.workspacePath);

    return session;
  }

  /**
   * Launch the appropriate debug adapter
   */
  private async launchDebugAdapter(session: DebugSession, workspacePath: string): Promise<void> {
    try {
      let command: string;
      let args: string[];

      switch (session.type) {
        case 'node':
          command = 'node';
          args = ['--inspect-brk=0', session.config.entryPoint || 'index.js'];
          break;
        case 'jest':
          command = 'npx';
          args = ['jest', '--runInBand', '--inspect-brk'];
          break;
        case 'vitest':
          command = 'npx';
          args = ['vitest', 'run', '--inspect-brk'];
          break;
        case 'playwright':
          command = 'npx';
          args = ['playwright', 'test', '--debug'];
          break;
        case 'python':
          command = 'python';
          args = ['-m', 'debugpy', '--listen', '0.0.0.0:5678', '--wait-for-client', session.config.module || 'main.py'];
          break;
        case 'go':
          command = 'dlv';
          args = ['debug', '--headless', '--listen=:2345', '--api-version=2', session.config.package || '.'];
          break;
        default:
          throw new Error(`Unsupported debug type: ${session.type}`);
      }

      // In a real implementation, this would spawn the process and connect via DAP
      // For now, we simulate the session
      session.status = 'running';
      session.pid = Math.floor(Math.random() * 10000) + 1000;
      this.emit('session:started', session);
    } catch (error) {
      session.status = 'terminated';
      this.emit('session:error', { session, error });
      throw error;
    }
  }

  /**
   * Stop a debug session
   */
  async stopDebugSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.status = 'terminated';
    this.emit('session:stopped', session);
    this.sessions.delete(sessionId);
  }

  /**
   * Pause execution
   */
  async pauseDebugSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.status = 'paused';
    this.emit('session:paused', session);
  }

  /**
   * Continue execution
   */
  async continueDebugSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.status = 'running';
    this.emit('session:continued', session);
  }

  /**
   * Step over
   */
  async stepOver(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    this.emit('session:step-over', session);
  }

  /**
   * Step into
   */
  async stepInto(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    this.emit('session:step-into', session);
  }

  /**
   * Step out
   */
  async stepOut(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    this.emit('session:step-out', session);
  }

  /**
   * Get session
   */
  getSession(sessionId: string): DebugSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all sessions
   */
  listSessions(): DebugSession[] {
    return Array.from(this.sessions.values());
  }

  // =========================================================================
  // Breakpoint Management
  // =========================================================================

  /**
   * Set a breakpoint
   */
  async setBreakpoint(breakpoint: Omit<Breakpoint, 'id' | 'verified'>): Promise<Breakpoint> {
    const bp: Breakpoint = {
      ...breakpoint,
      id: `bp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      verified: false,
    };

    const fileBreakpoints = this.breakpoints.get(breakpoint.file) || [];
    fileBreakpoints.push(bp);
    this.breakpoints.set(breakpoint.file, fileBreakpoints);

    // Update all active sessions
    for (const session of this.sessions.values()) {
      session.breakpoints = [...session.breakpoints, bp];
    }

    this.emit('breakpoint:set', bp);
    return bp;
  }

  /**
   * Remove a breakpoint
   */
  async removeBreakpoint(breakpointId: string): Promise<void> {
    for (const [file, breakpoints] of this.breakpoints.entries()) {
      const index = breakpoints.findIndex(b => b.id === breakpointId);
      if (index !== -1) {
        breakpoints.splice(index, 1);
        this.breakpoints.set(file, breakpoints);
        break;
      }
    }

    // Update all active sessions
    for (const session of this.sessions.values()) {
      session.breakpoints = session.breakpoints.filter(b => b.id !== breakpointId);
    }

    this.emit('breakpoint:removed', breakpointId);
  }

  /**
   * Toggle breakpoint enabled state
   */
  async toggleBreakpoint(breakpointId: string, enabled: boolean): Promise<void> {
    for (const [file, breakpoints] of this.breakpoints.entries()) {
      const bp = breakpoints.find(b => b.id === breakpointId);
      if (bp) {
        bp.enabled = enabled;
        this.breakpoints.set(file, breakpoints);
        break;
      }
    }

    for (const session of this.sessions.values()) {
      const bp = session.breakpoints.find(b => b.id === breakpointId);
      if (bp) bp.enabled = enabled;
    }

    this.emit('breakpoint:toggled', { breakpointId, enabled });
  }

  /**
   * Get breakpoints for a file
   */
  getBreakpoints(file: string): Breakpoint[] {
    return this.breakpoints.get(file) || [];
  }

  /**
   * Get all breakpoints
   */
  getAllBreakpoints(): Breakpoint[] {
    const all: Breakpoint[] = [];
    for (const bps of this.breakpoints.values()) {
      all.push(...bps);
    }
    return all;
  }

  // =========================================================================
  // Variable Inspection
  // =========================================================================

  /**
   * Get variables for current scope
   */
  async getVariables(sessionId: string, frameId?: number): Promise<Record<string, any>> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // In a real implementation, this would query the debug adapter
    // For now, return mock data
    return session.variables;
  }

  /**
   * Evaluate expression in current context
   */
  async evaluateExpression(sessionId: string, expression: string, frameId?: number): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // In a real implementation, this would evaluate via DAP
    return { result: `Evaluated: ${expression}`, type: 'string' };
  }

  /**
   * Add watch expression
   */
  async addWatchExpression(sessionId: string, expression: string): Promise<WatchExpression> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const watch: WatchExpression = {
      expression,
      value: await this.evaluateExpression(sessionId, expression),
    };

    this.emit('watch:added', { sessionId, watch });
    return watch;
  }

  /**
   * Remove watch expression
   */
  async removeWatchExpression(sessionId: string, expression: string): Promise<void> {
    this.emit('watch:removed', { sessionId, expression });
  }

  // =========================================================================
  // Call Stack
  // =========================================================================

  /**
   * Get current call stack
   */
  async getCallStack(sessionId: string): Promise<DebugSession['callStack']> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.callStack;
  }

  // =========================================================================
  // Test Running
  // =========================================================================

  /**
   * Run tests
   */
  async runTests(config: {
    projectId: string;
    workspacePath: string;
    framework: TestRun['framework'];
    testPath?: string;
    pattern?: string;
    coverage?: boolean;
  }): Promise<TestRun> {
    const runId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const testRun: TestRun = {
      id: runId,
      projectId: config.projectId,
      framework: config.framework,
      status: 'running',
      startedAt: new Date().toISOString(),
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
      results: [],
    };

    this.testRuns.set(runId, testRun);
    this.emit('test-run:started', testRun);

    try {
      // Build test command
      let command = this.buildTestCommand(config);

      // Run tests via terminal
      const result = await executeTool(this.toolRegistry, 'terminal.run', {
        command,
        cwd: config.workspacePath,
        env: { ...process.env, CI: 'true' },
      }, { workspacePath: config.workspacePath } as ToolExecutionContext);

      // Parse test output
      const parsed = this.parseTestOutput(result.output || '', config.framework);

      testRun.status = parsed.failed > 0 ? 'failed' : 'completed';
      testRun.completedAt = new Date().toISOString();
      testRun.totalTests = parsed.total;
      testRun.passed = parsed.passed;
      testRun.failed = parsed.failed;
      testRun.skipped = parsed.skipped;
      testRun.duration = parsed.duration;
      testRun.results = parsed.results;

      if (config.coverage && result.output) {
        testRun.coverage = this.parseCoverage(result.output, config.framework);
      }

      this.emit('test-run:completed', testRun);
      return testRun;
    } catch (error) {
      testRun.status = 'failed';
      testRun.completedAt = new Date().toISOString();
      this.emit('test-run:error', { testRun, error });
      throw error;
    }
  }

  /**
   * Build test command based on framework
   */
  private buildTestCommand(config: { framework: TestRun['framework']; testPath?: string; pattern?: string }): string {
    const baseCommands: Record<TestRun['framework'], string> = {
      jest: 'npx jest',
      vitest: 'npx vitest run',
      playwright: 'npx playwright test',
      cypress: 'npx cypress run',
      mocha: 'npx mocha',
    };

    let cmd = baseCommands[config.framework] || 'npm test';

    if (config.testPath) {
      cmd += ` ${config.testPath}`;
    }

    if (config.pattern) {
      if (config.framework === 'jest') cmd += ` --testNamePattern="${config.pattern}"`;
      if (config.framework === 'vitest') cmd += ` -t "${config.pattern}"`;
    }

    return cmd;
  }

  /**
   * Parse test output
   */
  private parseTestOutput(output: string, framework: TestRun['framework']): {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
    results: TestResult[];
  } {
    const results: TestResult[] = [];
    let total = 0, passed = 0, failed = 0, skipped = 0, duration = 0;

    // Simple parsing for different frameworks
    if (framework === 'jest' || framework === 'vitest') {
      const lines = output.split('\n');
      for (const line of lines) {
        // Match: PASS/FAIL test/file.test.ts > Test name
        const match = line.match(/^(PASS|FAIL)\s+(.+?)\s+>\s+(.+)$/);
        if (match) {
          total++;
          const status = match[1] === 'PASS' ? 'passed' : 'failed';
          if (status === 'passed') passed++; else failed++;
          results.push({
            id: `test_${total}`,
            name: match[3].trim(),
            file: match[2].trim(),
            status: status as TestResult['status'],
            duration: 0,
            error: status === 'failed' ? line : undefined,
          });
        }
        // Match: Test Suites: X passed, Y failed, Z total
        const summaryMatch = line.match(/Test Suites:\s+(\d+)\s+passed,\s+(\d+)\s+failed,\s+(\d+)\s+total/);
        if (summaryMatch) {
          passed = parseInt(summaryMatch[1]);
          failed = parseInt(summaryMatch[2]);
          total = parseInt(summaryMatch[3]);
        }
        // Duration
        const durationMatch = line.match(/(\d+\.?\d*)\s*s/);
        if (durationMatch) duration = parseFloat(durationMatch[1]) * 1000;
      }
    }

    return { total, passed, failed, skipped, duration, results };
  }

  /**
   * Parse coverage output
   */
  private parseCoverage(output: string, framework: TestRun['framework']): TestRun['coverage'] {
    // Simplified coverage parsing
    const coverage: TestRun['coverage'] = {};

    const patterns = {
      lines: /Lines\s*:\s*(\d+\.?\d*)%/,
      functions: /Functions\s*:\s*(\d+\.?\d*)%/,
      branches: /Branches\s*:\s*(\d+\.?\d*)%/,
      statements: /Statements\s*:\s*(\d+\.?\d*)%/,
    };

    for (const [key, pattern] of Object.entries(patterns)) {
      const match = output.match(pattern);
      if (match) {
        coverage[key as keyof TestRun['coverage']] = parseFloat(match[1]);
      }
    }

    return coverage;
  }

  /**
   * Get test run
   */
  getTestRun(runId: string): TestRun | undefined {
    return this.testRuns.get(runId);
  }

  /**
   * List test runs
   */
  listTestRuns(projectId?: string): TestRun[] {
    const runs = Array.from(this.testRuns.values());
    if (projectId) {
      return runs.filter(r => r.projectId === projectId);
    }
    return runs;
  }

  // =========================================================================
  // Auto-Fix Test Failures
  // =========================================================================

  /**
   * Attempt to auto-fix a failed test
   */
  async autoFixTestFailure(testRunId: string, testId: string): Promise<AutoFixResult> {
    const testRun = this.testRuns.get(testRunId);
    if (!testRun) throw new Error(`Test run ${testRunId} not found`);

    const test = testRun.results.find(t => t.id === testId);
    if (!test) throw new Error(`Test ${testId} not found`);

    if (test.status !== 'failed') {
      throw new Error('Test is not failed');
    }

    // Read the test file
    const fileResult = await executeTool(this.toolRegistry, 'files.read', {
      path: test.file,
    }, { workspacePath: process.cwd() } as ToolExecutionContext);

    if (!fileResult.success || !fileResult.content) {
      throw new Error(`Could not read test file: ${test.file}`);
    }

    // Analyze error and generate fix
    const fix = await this.generateFix(test, fileResult.content);

    return {
      testId,
      originalError: test.error || 'Unknown error',
      fixApplied: fix.description,
      fixedCode: fix.code,
      verified: false,
    };
  }

  /**
   * Generate fix for a test failure
   */
  private async generateFix(test: TestResult, testCode: string): Promise<{ description: string; code: string }> {
    // This would use an LLM to analyze the error and generate a fix
    // For now, return a placeholder
    return {
      description: 'Auto-fix generated (placeholder)',
      code: testCode, // Would be modified code
    };
  }

  /**
   * Apply fix and re-run test
   */
  async applyFixAndVerify(testRunId: string, fixResult: AutoFixResult): Promise<TestResult> {
    const testRun = this.testRuns.get(testRunId);
    if (!testRun) throw new Error(`Test run ${testRunId} not found`);

    const test = testRun.results.find(t => t.id === fixResult.testId);
    if (!test) throw new Error(`Test ${fixResult.testId} not found`);

    // Write fixed code
    await executeTool(this.toolRegistry, 'files.write', {
      path: test.file,
      content: fixResult.fixedCode,
    }, { workspacePath: process.cwd() } as ToolExecutionContext);

    // Re-run just this test
    const result = await this.runTests({
      projectId: testRun.projectId,
      workspacePath: process.cwd(),
      framework: testRun.framework,
      testPath: test.file,
    });

    const newTest = result.results.find(t => t.name === test.name);
    if (newTest) {
      fixResult.verified = newTest.status === 'passed';
      fixResult.newTestResult = newTest;
    }

    return newTest || test;
  }

  // =========================================================================
  // Console/REPL
  // =========================================================================

  /**
   * Execute code in debug console
   */
  async debugConsoleExecute(sessionId: string, code: string): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // In a real implementation, this would evaluate in the debug context
    return { result: `Executed: ${code}`, type: 'eval' };
  }
}

// ============================================================================
// Universal Tool Definitions
// ============================================================================

export function registerDebugTools(registry: UniversalToolRegistry): void {
  const manager = new DebugToolsManager(registry);

  // Debug session tools
  registry.registerTool({
    name: 'debug.start',
    description: 'Start a new debug session',
    category: 'debug',
    risk: 'READ',
    inputSchema: z.object({
      type: z.enum(['node', 'chrome', 'jest', 'vitest', 'playwright', 'python', 'go']),
      name: z.string(),
      projectId: z.string(),
      workspacePath: z.string(),
      config: z.record(z.any()).default({}),
    }),
    execute: async (args, ctx) => {
      const session = await manager.startDebugSession(args);
      return { success: true, data: session };
    },
  });

  registry.registerTool({
    name: 'debug.stop',
    description: 'Stop a debug session',
    category: 'debug',
    risk: 'WRITE',
    inputSchema: z.object({
      sessionId: z.string(),
    }),
    execute: async (args, ctx) => {
      await manager.stopDebugSession(args.sessionId);
      return { success: true, data: { stopped: true } };
    },
  });

  registry.registerTool({
    name: 'debug.pause',
    description: 'Pause a debug session',
    category: 'debug',
    risk: 'WRITE',
    inputSchema: z.object({ sessionId: z.string() }),
    execute: async (args, ctx) => {
      await manager.pauseDebugSession(args.sessionId);
      return { success: true, data: { paused: true } };
    },
  });

  registry.registerTool({
    name: 'debug.continue',
    description: 'Continue a paused debug session',
    category: 'debug',
    risk: 'WRITE',
    inputSchema: z.object({ sessionId: z.string() }),
    execute: async (args, ctx) => {
      await manager.continueDebugSession(args.sessionId);
      return { success: true, data: { continued: true } };
    },
  });

  registry.registerTool({
    name: 'debug.step-over',
    description: 'Step over in debug session',
    category: 'debug',
    risk: 'WRITE',
    inputSchema: z.object({ sessionId: z.string() }),
    execute: async (args, ctx) => {
      await manager.stepOver(args.sessionId);
      return { success: true, data: { stepped: true } };
    },
  });

  registry.registerTool({
    name: 'debug.step-into',
    description: 'Step into in debug session',
    category: 'debug',
    risk: 'WRITE',
    inputSchema: z.object({ sessionId: z.string() }),
    execute: async (args, ctx) => {
      await manager.stepInto(args.sessionId);
      return { success: true, data: { stepped: true } };
    },
  });

  registry.registerTool({
    name: 'debug.step-out',
    description: 'Step out in debug session',
    category: 'debug',
    risk: 'WRITE',
    inputSchema: z.object({ sessionId: z.string() }),
    execute: async (args, ctx) => {
      await manager.stepOut(args.sessionId);
      return { success: true, data: { stepped: true } };
    },
  });

  // Breakpoint tools
  registry.registerTool({
    name: 'debug.breakpoint.set',
    description: 'Set a breakpoint',
    category: 'debug',
    risk: 'WRITE',
    inputSchema: z.object({
      file: z.string(),
      line: z.number(),
      column: z.number().optional(),
      condition: z.string().optional(),
      hitCondition: z.string().optional(),
      logMessage: z.string().optional(),
    }),
    execute: async (args, ctx) => {
      const bp = await manager.setBreakpoint(args);
      return { success: true, data: bp };
    },
  });

  registry.registerTool({
    name: 'debug.breakpoint.remove',
    description: 'Remove a breakpoint',
    category: 'debug',
    risk: 'WRITE',
    inputSchema: z.object({ breakpointId: z.string() }),
    execute: async (args, ctx) => {
      await manager.removeBreakpoint(args.breakpointId);
      return { success: true, data: { removed: true } };
    },
  });

  registry.registerTool({
    name: 'debug.breakpoint.toggle',
    description: 'Toggle breakpoint enabled state',
    category: 'debug',
    risk: 'WRITE',
    inputSchema: z.object({ breakpointId: z.string(), enabled: z.boolean() }),
    execute: async (args, ctx) => {
      await manager.toggleBreakpoint(args.breakpointId, args.enabled);
      return { success: true, data: { toggled: true } };
    },
  });

  registry.registerTool({
    name: 'debug.breakpoints.list',
    description: 'List all breakpoints',
    category: 'debug',
    risk: 'READ',
    inputSchema: z.object({ file: z.string().optional() }),
    execute: async (args, ctx) => {
      const bps = args.file ? manager.getBreakpoints(args.file) : manager.getAllBreakpoints();
      return { success: true, data: bps };
    },
  });

  // Variable inspection tools
  registry.registerTool({
    name: 'debug.variables.get',
    description: 'Get variables in current scope',
    category: 'debug',
    risk: 'READ',
    inputSchema: z.object({ sessionId: z.string(), frameId: z.number().optional() }),
    execute: async (args, ctx) => {
      const vars = await manager.getVariables(args.sessionId, args.frameId);
      return { success: true, data: vars };
    },
  });

  registry.registerTool({
    name: 'debug.evaluate',
    description: 'Evaluate expression in debug context',
    category: 'debug',
    risk: 'READ',
    inputSchema: z.object({ sessionId: z.string(), expression: z.string(), frameId: z.number().optional() }),
    execute: async (args, ctx) => {
      const result = await manager.evaluateExpression(args.sessionId, args.expression, args.frameId);
      return { success: true, data: result };
    },
  });

  registry.registerTool({
    name: 'debug.watch.add',
    description: 'Add watch expression',
    category: 'debug',
    risk: 'WRITE',
    inputSchema: z.object({ sessionId: z.string(), expression: z.string() }),
    execute: async (args, ctx) => {
      const watch = await manager.addWatchExpression(args.sessionId, args.expression);
      return { success: true, data: watch };
    },
  });

  registry.registerTool({
    name: 'debug.callstack.get',
    description: 'Get current call stack',
    category: 'debug',
    risk: 'READ',
    inputSchema: z.object({ sessionId: z.string() }),
    execute: async (args, ctx) => {
      const stack = await manager.getCallStack(args.sessionId);
      return { success: true, data: stack };
    },
  });

  // Test running tools
  registry.registerTool({
    name: 'test.run',
    description: 'Run tests for a project',
    category: 'test',
    risk: 'READ',
    inputSchema: z.object({
      projectId: z.string(),
      workspacePath: z.string(),
      framework: z.enum(['jest', 'vitest', 'playwright', 'cypress', 'mocha']),
      testPath: z.string().optional(),
      pattern: z.string().optional(),
      coverage: z.boolean().default(false),
    }),
    execute: async (args, ctx) => {
      const run = await manager.runTests(args);
      return { success: true, data: run };
    },
  });

  registry.registerTool({
    name: 'test.run.get',
    description: 'Get test run results',
    category: 'test',
    risk: 'READ',
    inputSchema: z.object({ runId: z.string() }),
    execute: async (args, ctx) => {
      const run = manager.getTestRun(args.runId);
      if (!run) throw new Error(`Test run ${args.runId} not found`);
      return { success: true, data: run };
    },
  });

  registry.registerTool({
    name: 'test.run.list',
    description: 'List test runs',
    category: 'test',
    risk: 'READ',
    inputSchema: z.object({ projectId: z.string().optional() }),
    execute: async (args, ctx) => {
      const runs = manager.listTestRuns(args.projectId);
      return { success: true, data: runs };
    },
  });

  // Auto-fix tools
  registry.registerTool({
    name: 'test.autofix',
    description: 'Auto-fix a failed test',
    category: 'test',
    risk: 'WRITE',
    inputSchema: z.object({ testRunId: z.string(), testId: z.string() }),
    execute: async (args, ctx) => {
      const fix = await manager.autoFixTestFailure(args.testRunId, args.testId);
      return { success: true, data: fix };
    },
  });

  registry.registerTool({
    name: 'test.autofix.apply',
    description: 'Apply auto-fix and verify',
    category: 'test',
    risk: 'WRITE',
    inputSchema: z.object({ testRunId: z.string(), fix: z.any() }), // AutoFixResult
    execute: async (args, ctx) => {
      const result = await manager.applyFixAndVerify(args.testRunId, args.fix);
      return { success: true, data: result };
    },
  });

  // Debug console
  registry.registerTool({
    name: 'debug.console.execute',
    description: 'Execute code in debug console',
    category: 'debug',
    risk: 'WRITE',
    inputSchema: z.object({ sessionId: z.string(), code: z.string() }),
    execute: async (args, ctx) => {
      const result = await manager.debugConsoleExecute(args.sessionId, args.code);
      return { success: true, data: result };
    },
  });
}

// ============================================================================
// Singleton
// ============================================================================

let debugToolsInstance: DebugToolsManager | null = null;

export function getDebugTools(registry?: UniversalToolRegistry): DebugToolsManager {
  if (!debugToolsInstance && registry) {
    debugToolsInstance = new DebugToolsManager(registry);
  }
  if (!debugToolsInstance) {
    throw new Error('DebugToolsManager not initialized');
  }
  return debugToolsInstance;
}

export function initializeDebugTools(registry: UniversalToolRegistry): DebugToolsManager {
  debugToolsInstance = new DebugToolsManager(registry);
  registerDebugTools(registry);
  return debugToolsInstance;
}