/**
 * Planning Agent — Creates execution plans before running agents
 * Part of Phase 30: Advanced Agent Capabilities (Cursor Agent Parity)
 */

import { EventEmitter } from 'events';
import { z } from 'zod';
import { UniversalToolRegistry, getToolDefinitionsForLLM, executeTool } from './tool-registry.js';
import { UniversalToolDefinition, ToolExecutionContext, UniversalToolResult } from './tool-types.js';

// ============================================================================
// Types & Schemas
// ============================================================================

export const PlanStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  type: z.enum(['explore', 'read', 'write', 'edit', 'terminal', 'test', 'verify', 'commit', 'custom']),
  files: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]), // step IDs that must complete first
  risk: z.enum(['low', 'medium', 'high']).default('low'),
  estimatedTokens: z.number().optional(),
  verification: z.string().optional(), // how to verify this step succeeded
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'skipped']).default('pending'),
  result: z.any().optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export const PlanSchema = z.object({
  id: z.string(),
  goal: z.string(),
  projectId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(['draft', 'approved', 'executing', 'completed', 'failed', 'paused']).default('draft'),
  steps: z.array(PlanStepSchema),
  metadata: z.object({
    totalEstimatedTokens: z.number().default(0),
    estimatedDuration: z.number().default(0), // minutes
    riskLevel: z.enum(['low', 'medium', 'high']).default('low'),
    requiredApprovals: z.array(z.string()).default([]), // step IDs requiring human approval
    contextFiles: z.array(z.string()).default([]),
  }).default({}),
  currentStepIndex: z.number().default(0),
  completedSteps: z.number().default(0),
  failedSteps: z.number().default(0),
});

export const PlanningContextSchema = z.object({
  goal: z.string(),
  projectId: z.string(),
  workspacePath: z.string(),
  existingFiles: z.array(z.string()).optional(),
  codebaseIndex: z.any().optional(), // from codebase-indexer
  projectMap: z.any().optional(), // from build-project-map
  constraints: z.array(z.string()).default([]),
  preferences: z.record(z.any()).default({}),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type PlanningContext = z.infer<typeof PlanningContextSchema>;

// ============================================================================
// Planning Agent
// ============================================================================

export class PlanningAgent extends EventEmitter {
  private toolRegistry: UniversalToolRegistry;
  private plans: Map<string, Plan> = new Map();
  private llmAdapter: any; // will be injected

  constructor(toolRegistry: UniversalToolRegistry) {
    super();
    this.toolRegistry = toolRegistry;
  }

  setLLMAdapter(adapter: any) {
    this.llmAdapter = adapter;
  }

  /**
   * Create a plan from a natural language goal
   */
  async createPlan(context: PlanningContext): Promise<Plan> {
    const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Phase 1: Explore codebase to understand the project
    const exploration = await this.exploreCodebase(context);

    // Phase 2: Generate plan using LLM
    const plan = await this.generatePlan(context, exploration);

    // Phase 3: Validate and enrich plan
    const validatedPlan = await this.validatePlan(plan, context);

    // Store plan
    this.plans.set(validatedPlan.id, validatedPlan);
    this.emit('plan:created', validatedPlan);

    return validatedPlan;
  }

  /**
   * Explore the codebase to gather context for planning
   */
  private async exploreCodebase(context: PlanningContext): Promise<any> {
    const exploration: any = {
      framework: null,
      packageManager: null,
      entryPoints: [],
      keyFiles: [],
      architecture: null,
      dependencies: [],
      testSetup: null,
      existingPatterns: [],
    };

    try {
      // Read package.json
      const pkgResult = await this.readFile(context.workspacePath, 'package.json');
      if (pkgResult.success && pkgResult.content) {
        const pkg = JSON.parse(pkgResult.content);
        exploration.framework = this.detectFramework(pkg);
        exploration.packageManager = this.detectPackageManager(pkg);
        exploration.dependencies = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
        exploration.scripts = pkg.scripts || {};
      }

      // Read key config files
      const configFiles = [
        'tsconfig.json', 'vite.config.ts', 'next.config.js', 'astro.config.mjs',
        'tailwind.config.ts', 'eslint.config.js', 'prettier.config.js',
        '.github/workflows', '.gitignore', 'README.md'
      ];

      for (const file of configFiles) {
        const result = await this.readFile(context.workspacePath, file);
        if (result.success) {
          exploration.keyFiles.push({ path: file, content: result.content });
        }
      }

      // Use codebase index if available
      if (context.codebaseIndex) {
        exploration.symbols = context.codebaseIndex.symbols?.slice(0, 100) || [];
        exploration.fileMap = context.codebaseIndex.fileMap || {};
      }

      // Use project map if available
      if (context.projectMap) {
        exploration.architecture = context.projectMap.architecture;
        exploration.entryPoints = context.projectMap.entryPoints || [];
      }

    } catch (error) {
      console.error('Exploration error:', error);
    }

    return exploration;
  }

  /**
   * Detect framework from package.json
   */
  private detectFramework(pkg: any): string {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.next) return 'nextjs';
    if (deps.astro) return 'astro';
    if (deps.remix) return 'remix';
    if (deps['@remix-run/react']) return 'remix';
    if (deps.svelte || deps['@sveltejs/kit']) return 'sveltekit';
    if (deps.nuxt) return 'nuxt';
    if (deps.vue) return 'vue';
    if (deps['solid-js'] || deps['@solidjs/start']) return 'solidstart';
    if (deps.react && deps.vite) return 'vite-react';
    if (deps.react) return 'react';
    return 'unknown';
  }

  /**
   * Detect package manager
   */
  private detectPackageManager(pkg: any): string {
    if (pkg.packageManager) return pkg.packageManager;
    // Check for lockfiles in workspace (would need fs access)
    return 'npm';
  }

  /**
   * Generate plan using LLM
   */
  private async generatePlan(context: PlanningContext, exploration: any): Promise<Plan> {
    const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const systemPrompt = `You are an expert software architect and planner. Create a detailed, step-by-step execution plan for the given goal.

CONTEXT:
- Goal: ${context.goal}
- Project ID: ${context.projectId}
- Framework: ${exploration.framework}
- Package Manager: ${exploration.packageManager}
- Architecture: ${exploration.architecture || 'unknown'}
- Entry Points: ${exploration.entryPoints.join(', ') || 'unknown'}
- Key Dependencies: ${exploration.dependencies.slice(0, 20).join(', ')}
- Scripts: ${JSON.stringify(exploration.scripts)}
- Constraints: ${context.constraints.join(', ') || 'none'}

AVAILABLE TOOLS:
${getToolDefinitionsForLLM(this.toolRegistry).map(t => `- ${t.name}: ${t.description}`).join('\n')}

REQUIREMENTS:
1. Break down the goal into minimal, verifiable steps
2. Each step must have: id, title, description, type, files, tools, dependencies, risk, verification
3. Steps should be ordered by dependencies (topological sort)
4. Identify risks and required approvals
5. Estimate tokens and duration per step
6. Include verification criteria for each step
7. Mark steps requiring human approval (high risk, destructive actions, external changes)

OUTPUT FORMAT: JSON matching the Plan schema exactly.`;

    const userPrompt = `Create a comprehensive execution plan for: "${context.goal}"

Return ONLY the JSON plan object.`;

    try {
      if (!this.llmAdapter) {
        throw new Error('LLM adapter not set');
      }

      const response = await this.llmAdapter.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], {
        temperature: 0.3,
        maxTokens: 8000,
        responseFormat: { type: 'json_object' }
      });

      const planData = JSON.parse(response.content);

      const plan: Plan = {
        id: planId,
        goal: context.goal,
        projectId: context.projectId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'draft',
        steps: planData.steps || [],
        metadata: {
          totalEstimatedTokens: planData.steps?.reduce((sum: number, s: any) => sum + (s.estimatedTokens || 1000), 0) || 0,
          estimatedDuration: planData.steps?.reduce((sum: number, s: any) => sum + (s.estimatedDuration || 5), 0) || 0,
          riskLevel: this.calculateRiskLevel(planData.steps || []),
          requiredApprovals: this.identifyRequiredApprovals(planData.steps || []),
          contextFiles: exploration.keyFiles.map((f: any) => f.path),
        },
        currentStepIndex: 0,
        completedSteps: 0,
        failedSteps: 0,
      };

      return plan;
    } catch (error) {
      console.error('Plan generation error:', error);
      // Fallback: create a basic plan
      return this.createFallbackPlan(planId, context, exploration);
    }
  }

  /**
   * Create a basic fallback plan when LLM fails
   */
  private createFallbackPlan(planId: string, context: PlanningContext, exploration: any): Plan {
    const steps: PlanStep[] = [
      {
        id: 'step_1',
        title: 'Explore codebase structure',
        description: 'Analyze the project structure, entry points, and key files',
        type: 'explore',
        files: [],
        tools: ['files.list', 'codebase.search'],
        dependencies: [],
        risk: 'low',
        estimatedTokens: 2000,
        verification: 'Project structure documented',
        status: 'pending',
      },
      {
        id: 'step_2',
        title: 'Implement core functionality',
        description: `Implement the main feature: ${context.goal}`,
        type: 'write',
        files: [],
        tools: ['files.write', 'files.edit'],
        dependencies: ['step_1'],
        risk: 'medium',
        estimatedTokens: 10000,
        verification: 'Code compiles and tests pass',
        status: 'pending',
      },
      {
        id: 'step_3',
        title: 'Write tests',
        description: 'Create unit and integration tests for the new functionality',
        type: 'test',
        files: [],
        tools: ['files.write', 'terminal.run'],
        dependencies: ['step_2'],
        risk: 'low',
        estimatedTokens: 5000,
        verification: 'All tests pass',
        status: 'pending',
      },
      {
        id: 'step_4',
        title: 'Verify and commit',
        description: 'Run full test suite, typecheck, and commit changes',
        type: 'verify',
        files: [],
        tools: ['terminal.run', 'git.commit'],
        dependencies: ['step_3'],
        risk: 'low',
        estimatedTokens: 3000,
        verification: 'Build passes, tests pass, changes committed',
        status: 'pending',
      },
    ];

    return {
      id: planId,
      goal: context.goal,
      projectId: context.projectId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'draft',
      steps,
      metadata: {
        totalEstimatedTokens: 20000,
        estimatedDuration: 30,
        riskLevel: 'medium',
        requiredApprovals: [],
        contextFiles: exploration.keyFiles.map((f: any) => f.path),
      },
      currentStepIndex: 0,
      completedSteps: 0,
      failedSteps: 0,
    };
  }

  /**
   * Calculate overall risk level from steps
   */
  private calculateRiskLevel(steps: PlanStep[]): 'low' | 'medium' | 'high' {
    const highRisk = steps.filter(s => s.risk === 'high').length;
    const mediumRisk = steps.filter(s => s.risk === 'medium').length;

    if (highRisk > 0) return 'high';
    if (mediumRisk > 2) return 'high';
    if (mediumRisk > 0) return 'medium';
    return 'low';
  }

  /**
   * Identify steps requiring human approval
   */
  private identifyRequiredApprovals(steps: PlanStep[]): string[] {
    return steps
      .filter(s => s.risk === 'high' || s.type === 'commit' || s.type === 'terminal')
      .map(s => s.id);
  }

  /**
   * Validate and enrich the plan
   */
  private async validatePlan(plan: Plan, context: PlanningContext): Promise<Plan> {
    // Verify all tool names exist
    const availableTools = new Set(getToolDefinitionsForLLM(this.toolRegistry).map(t => t.name));

    for (const step of plan.steps) {
      for (const tool of step.tools) {
        if (!availableTools.has(tool)) {
          console.warn(`Plan step ${step.id} references unknown tool: ${tool}`);
        }
      }
    }

    // Topological sort by dependencies
    plan.steps = this.topologicalSort(plan.steps);

    // Recalculate metadata
    plan.metadata.totalEstimatedTokens = plan.steps.reduce((sum, s) => sum + (s.estimatedTokens || 1000), 0);
    plan.metadata.estimatedDuration = plan.steps.reduce((sum, s) => sum + (s.estimatedDuration || 5), 0);
    plan.metadata.riskLevel = this.calculateRiskLevel(plan.steps);
    plan.metadata.requiredApprovals = this.identifyRequiredApprovals(plan.steps);

    return plan;
  }

  /**
   * Topological sort steps by dependencies
   */
  private topologicalSort(steps: PlanStep[]): PlanStep[] {
    const graph = new Map<string, PlanStep>();
    const inDegree = new Map<string, number>();

    for (const step of steps) {
      graph.set(step.id, step);
      inDegree.set(step.id, 0);
    }

    for (const step of steps) {
      for (const dep of step.dependencies) {
        if (inDegree.has(dep)) {
          inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
        }
      }
    }

    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    const sorted: PlanStep[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const step = graph.get(id)!;
      sorted.push(step);

      for (const otherStep of steps) {
        if (otherStep.dependencies.includes(id)) {
          const newDegree = (inDegree.get(otherStep.id) || 0) - 1;
          inDegree.set(otherStep.id, newDegree);
          if (newDegree === 0) {
            queue.push(otherStep.id);
          }
        }
      }
    }

    // If there are cycles, append remaining steps
    if (sorted.length < steps.length) {
      const remaining = steps.filter(s => !sorted.includes(s));
      sorted.push(...remaining);
    }

    return sorted;
  }

  /**
   * Get a plan by ID
   */
  getPlan(planId: string): Plan | undefined {
    return this.plans.get(planId);
  }

  /**
   * Update plan status
   */
  updatePlanStatus(planId: string, status: Plan['status']): Plan | undefined {
    const plan = this.plans.get(planId);
    if (plan) {
      plan.status = status;
      plan.updatedAt = new Date().toISOString();
      this.emit('plan:updated', plan);
    }
    return plan;
  }

  /**
   * Update step status
   */
  updateStepStatus(planId: string, stepId: string, status: PlanStep['status'], result?: any, error?: string): Plan | undefined {
    const plan = this.plans.get(planId);
    if (!plan) return undefined;

    const step = plan.steps.find(s => s.id === stepId);
    if (!step) return undefined;

    step.status = status;
    if (result !== undefined) step.result = result;
    if (error !== undefined) step.error = error;
    if (status === 'in_progress') step.startedAt = new Date().toISOString();
    if (status === 'completed' || status === 'failed') step.completedAt = new Date().toISOString();

    plan.completedSteps = plan.steps.filter(s => s.status === 'completed').length;
    plan.failedSteps = plan.steps.filter(s => s.status === 'failed').length;
    plan.currentStepIndex = plan.steps.findIndex(s => s.status === 'in_progress' || s.status === 'pending');
    if (plan.currentStepIndex === -1) plan.currentStepIndex = plan.steps.length;
    plan.updatedAt = new Date().toISOString();

    this.emit('plan:step-updated', { plan, step });

    // Check if plan is complete
    if (plan.completedSteps === plan.steps.length) {
      plan.status = 'completed';
      this.emit('plan:completed', plan);
    } else if (plan.failedSteps > 0 && plan.steps.every(s => s.status !== 'pending' && s.status !== 'in_progress')) {
      plan.status = 'failed';
      this.emit('plan:failed', plan);
    }

    return plan;
  }

  /**
   * Get next pending step
   */
  getNextStep(planId: string): PlanStep | undefined {
    const plan = this.plans.get(planId);
    if (!plan) return undefined;

    // Find first pending step whose dependencies are met
    for (const step of plan.steps) {
      if (step.status === 'pending') {
        const depsMet = step.dependencies.every(depId => {
          const depStep = plan.steps.find(s => s.id === depId);
          return depStep?.status === 'completed';
        });
        if (depsMet) return step;
      }
    }

    return undefined;
  }

  /**
   * Execute a single step
   */
  async executeStep(planId: string, stepId: string, toolContext: ToolExecutionContext): Promise<UniversalToolResult> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    const step = plan.steps.find(s => s.id === stepId);
    if (!step) throw new Error(`Step ${stepId} not found`);

    this.updateStepStatus(planId, stepId, 'in_progress');

    try {
      // Execute the step based on type
      let result: UniversalToolResult;

      switch (step.type) {
        case 'explore':
        case 'read':
          result = await this.executeExploreStep(step, toolContext);
          break;
        case 'write':
        case 'edit':
          result = await this.executeWriteStep(step, toolContext);
          break;
        case 'terminal':
          result = await this.executeTerminalStep(step, toolContext);
          break;
        case 'test':
          result = await this.executeTestStep(step, toolContext);
          break;
        case 'verify':
          result = await this.executeVerifyStep(step, toolContext);
          break;
        case 'commit':
          result = await this.executeCommitStep(step, toolContext);
          break;
        default:
          result = await this.executeCustomStep(step, toolContext);
      }

      this.updateStepStatus(planId, stepId, 'completed', result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateStepStatus(planId, stepId, 'failed', undefined, errorMessage);
      throw error;
    }
  }

  /**
   * Execute explore/read step
   */
  private async executeExploreStep(step: PlanStep, context: ToolExecutionContext): Promise<UniversalToolResult> {
    // Use codebase search or file listing
    if (step.tools.includes('codebase.search')) {
      return executeTool(this.toolRegistry, 'codebase.search', {
        query: step.description,
        mode: 'hybrid',
        limit: 20,
      }, context);
    }

    return executeTool(this.toolRegistry, 'files.list', {
      path: context.workspacePath,
      recursive: true,
    }, context);
  }

  /**
   * Execute write/edit step
   */
  private async executeWriteStep(step: PlanStep, context: ToolExecutionContext): Promise<UniversalToolResult> {
    // This would be implemented with actual file operations
    // For now, return a placeholder
    return {
      success: true,
      data: { message: `Step ${step.id} executed (placeholder)` },
      metadata: { toolName: 'files.write', duration: 0 },
    };
  }

  /**
   * Execute terminal step
   */
  private async executeTerminalStep(step: PlanStep, context: ToolExecutionContext): Promise<UniversalToolResult> {
    return executeTool(this.toolRegistry, 'terminal.run', {
      command: step.description, // Would need actual command
      cwd: context.workspacePath,
    }, context);
  }

  /**
   * Execute test step
   */
  private async executeTestStep(step: PlanStep, context: ToolExecutionContext): Promise<UniversalToolResult> {
    const pkgResult = await executeTool(this.toolRegistry, 'files.read', {
      path: 'package.json',
    }, context);

    if (pkgResult.success && pkgResult.content) {
      const pkg = JSON.parse(pkgResult.content);
      const testCmd = pkg.scripts?.test || 'npm test';

      return executeTool(this.toolRegistry, 'terminal.run', {
        command: testCmd,
        cwd: context.workspacePath,
      }, context);
    }

    return executeTool(this.toolRegistry, 'terminal.run', {
      command: 'npm test',
      cwd: context.workspacePath,
    }, context);
  }

  /**
   * Execute verify step
   */
  private async executeVerifyStep(step: PlanStep, context: ToolExecutionContext): Promise<UniversalToolResult> {
    // Run typecheck, lint, build
    const commands = ['npm run typecheck', 'npm run lint', 'npm run build'];
    const results = [];

    for (const cmd of commands) {
      const result = await executeTool(this.toolRegistry, 'terminal.run', {
        command: cmd,
        cwd: context.workspacePath,
      }, context);
      results.push({ command: cmd, ...result });
    }

    return {
      success: results.every(r => r.success),
      data: { results },
      metadata: { toolName: 'verify', duration: 0 },
    };
  }

  /**
   * Execute commit step
   */
  private async executeCommitStep(step: PlanStep, context: ToolExecutionContext): Promise<UniversalToolResult> {
    return executeTool(this.toolRegistry, 'git.commit', {
      message: `Implement: ${step.description}`,
      addAll: true,
    }, context);
  }

  /**
   * Execute custom step
   */
  private async executeCustomStep(step: PlanStep, context: ToolExecutionContext): Promise<UniversalToolResult> {
    return {
      success: true,
      data: { message: `Custom step ${step.id} executed` },
      metadata: { toolName: 'custom', duration: 0 },
    };
  }

  /**
   * Read a file from workspace
   */
  private async readFile(workspacePath: string, filePath: string): Promise<UniversalToolResult> {
    return executeTool(this.toolRegistry, 'files.read', {
      path: filePath,
    }, { workspacePath } as ToolExecutionContext);
  }

  /**
   * List all plans
   */
  listPlans(): Plan[] {
    return Array.from(this.plans.values()).sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * Delete a plan
   */
  deletePlan(planId: string): boolean {
    const deleted = this.plans.delete(planId);
    if (deleted) {
      this.emit('plan:deleted', planId);
    }
    return deleted;
  }

  /**
   * Export plan to JSON
   */
  exportPlan(planId: string): string | null {
    const plan = this.plans.get(planId);
    if (!plan) return null;
    return JSON.stringify(plan, null, 2);
  }

  /**
   * Import plan from JSON
   */
  importPlan(json: string): Plan {
    const plan = PlanSchema.parse(JSON.parse(json));
    this.plans.set(plan.id, plan);
    this.emit('plan:imported', plan);
    return plan;
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

let planningAgentInstance: PlanningAgent | null = null;

export function getPlanningAgent(toolRegistry?: UniversalToolRegistry): PlanningAgent {
  if (!planningAgentInstance && toolRegistry) {
    planningAgentInstance = new PlanningAgent(toolRegistry);
  }
  if (!planningAgentInstance) {
    throw new Error('PlanningAgent not initialized. Call with toolRegistry first.');
  }
  return planningAgentInstance;
}

export function initializePlanningAgent(toolRegistry: UniversalToolRegistry): PlanningAgent {
  planningAgentInstance = new PlanningAgent(toolRegistry);
  return planningAgentInstance;
}