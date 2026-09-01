/**
 * Planning Agent — Creates execution plans before acting, with persistence and resume support
 * Part of Phase 30: Advanced Agent Capabilities (Cursor Agent Parity)
 */

import { LLMAdapter, LLMMessage } from "./llm-adapter";
import { sanitizePrompt } from "./infinity-prompt";
import { planner, PlannerOutput, spawnSubagent } from "./subagents";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

export interface PlanStep {
  id: string;
  description: string;
  toolHint?: string;
  dependsOn: string[];
  verification: string;
  risk: "low" | "medium" | "high" | "critical";
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PlanRisk {
  id: string;
  description: string;
  likelihood: "low" | "medium" | "high";
  impact: "low" | "medium" | "high" | "critical";
  mitigation: string;
}

export interface ExecutionPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  risks: PlanRisk[];
  successCriteria: string[];
  createdAt: string;
  updatedAt: string;
  status: "draft" | "approved" | "executing" | "completed" | "failed" | "paused";
  currentStepIndex: number;
  metadata: Record<string, unknown>;
}

export interface PlanningConfig {
  projectRoot: string;
  projectId: string;
  adapter: LLMAdapter;
  plansDir?: string;
  autoApprove?: boolean;
  onStepUpdate?: (step: PlanStep, plan: ExecutionPlan) => void;
  onPlanComplete?: (plan: ExecutionPlan) => void;
}

// ============================================================================
// Planning Agent
// ============================================================================

export class PlanningAgent {
  private config: PlanningConfig;
  private activePlan: ExecutionPlan | null = null;
  private plansDir: string;

  constructor(config: PlanningConfig) {
    this.config = config;
    this.plansDir = config.plansDir || path.join(config.projectRoot, ".infinity", "plans");
    this.ensurePlansDir();
  }

  private ensurePlansDir(): void {
    if (!fs.existsSync(this.plansDir)) {
      fs.mkdirSync(this.plansDir, { recursive: true });
    }
  }

  // ============================================================================
  // Plan Creation
  // ============================================================================

  async createPlan(goal: string, context?: string): Promise<ExecutionPlan> {
    const prompt = this.buildPlanningPrompt(goal, context);

    const plannerOutput = await spawnSubagent<PlannerOutput>(
      "planner",
      prompt,
      this.config.adapter,
      { modelTier: "high", reasoningEffort: "high", temperature: 0.2 }
    );

    const plan: ExecutionPlan = {
      id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      goal,
      steps: plannerOutput.steps.map(s => ({
        ...s,
        status: "pending" as const,
      })),
      risks: plannerOutput.risks,
      successCriteria: plannerOutput.successCriteria,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "draft",
      currentStepIndex: 0,
      metadata: {
        estimatedTokens: plannerOutput.estimatedTotalTokens,
      },
    };

    return plan;
  }

  private buildPlanningPrompt(goal: string, context?: string): string {
    let prompt = `Create a detailed execution plan for this goal:\n\nGOAL:\n${goal}\n`;

    if (context) {
      prompt += `\nCONTEXT:\n${context}\n`;
    }

    prompt += `\nRequirements:
1. Break into SMALL, VERIFIABLE steps
2. Each step must have explicit dependencies
3. Include tool hints (web, browser, files, build, data, memory, research, integration)
4. Define verification criteria for each step
5. Identify risks with likelihood, impact, and mitigation
6. Define measurable success criteria for the overall goal`;

    return prompt;
  }

  // ============================================================================
  // Plan Persistence
  // ============================================================================

  savePlan(plan: ExecutionPlan): void {
    const filePath = path.join(this.plansDir, `${plan.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(plan, null, 2), "utf-8");
  }

  loadPlan(planId: string): ExecutionPlan | null {
    const filePath = path.join(this.plansDir, `${planId}.json`);
    if (!fs.existsSync(filePath)) return null;

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content) as ExecutionPlan;
    } catch {
      return null;
    }
  }

  listPlans(): ExecutionPlan[] {
    if (!fs.existsSync(this.plansDir)) return [];

    return fs.readdirSync(this.plansDir)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        try {
          const content = fs.readFileSync(path.join(this.plansDir, f), "utf-8");
          return JSON.parse(content) as ExecutionPlan;
        } catch {
          return null;
        }
      })
      .filter((p): p is ExecutionPlan => p !== null)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  deletePlan(planId: string): boolean {
    const filePath = path.join(this.plansDir, `${planId}.json`);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  // ============================================================================
  // Plan Execution
  // ============================================================================

  async executePlan(planId: string, options?: { autoApprove?: boolean }): Promise<ExecutionPlan> {
    const plan = this.loadPlan(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);

    if (plan.status === "draft" && !options?.autoApprove && !this.config.autoApprove) {
      throw new Error("Plan requires approval before execution. Set autoApprove or approve first.");
    }

    plan.status = "executing";
    plan.updatedAt = new Date().toISOString();
    this.activePlan = plan;
    this.savePlan(plan);

    try {
      // Execute steps in dependency order
      const executionOrder = this.getExecutionOrder(plan.steps);

      for (let i = 0; i < executionOrder.length; i++) {
        const stepId = executionOrder[i];
        const stepIndex = plan.steps.findIndex(s => s.id === stepId);
        if (stepIndex === -1) continue;

        plan.currentStepIndex = stepIndex;
        const step = plan.steps[stepIndex];

        // Check dependencies
        const depsMet = step.dependsOn.every(depId => {
          const depStep = plan.steps.find(s => s.id === depId);
          return depStep?.status === "completed";
        });

        if (!depsMet) {
          step.status = "skipped";
          step.error = "Dependencies not met";
          continue;
        }

        step.status = "in_progress";
        step.startedAt = new Date().toISOString();
        plan.updatedAt = new Date().toISOString();
        this.savePlan(plan);
        this.config.onStepUpdate?.(step, plan);

        try {
          // Execute the step using the universal agent
          const result = await this.executeStep(step, plan);
          step.result = result;
          step.status = "completed";
          step.completedAt = new Date().toISOString();
        } catch (error) {
          step.status = "failed";
          step.error = String(error);
          step.completedAt = new Date().toISOString();

          // Check if we should continue or fail the plan
          if (step.risk === "critical" || step.risk === "high") {
            plan.status = "failed";
            plan.updatedAt = new Date().toISOString();
            this.savePlan(plan);
            throw error;
          }
        }

        plan.updatedAt = new Date().toISOString();
        this.savePlan(plan);
        this.config.onStepUpdate?.(step, plan);
      }

      // Check if all steps completed
      const allCompleted = plan.steps.every(s => s.status === "completed" || s.status === "skipped");
      plan.status = allCompleted ? "completed" : "failed";
      plan.updatedAt = new Date().toISOString();
      this.savePlan(plan);

      this.config.onPlanComplete?.(plan);
      this.activePlan = null;

      return plan;
    } catch (error) {
      plan.status = "failed";
      plan.updatedAt = new Date().toISOString();
      this.savePlan(plan);
      this.activePlan = null;
      throw error;
    }
  }

  private getExecutionOrder(steps: PlanStep[]): string[] {
    // Topological sort based on dependencies
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (stepId: string) => {
      if (visited.has(stepId)) return;
      const step = steps.find(s => s.id === stepId);
      if (!step) return;

      for (const dep of step.dependsOn) {
        visit(dep);
      }
      visited.add(stepId);
      order.push(stepId);
    };

    for (const step of steps) {
      visit(step.id);
    }

    return order;
  }

  private async executeStep(step: PlanStep, plan: ExecutionPlan): Promise<unknown> {
    // This would integrate with the universal agent to execute the step
    // For now, return a placeholder - the actual implementation would call
    // the universal agent with the step description and context

    // The tool hint tells us which tool namespace to use
    // We would call the appropriate tool through the universal agent

    return {
      stepId: step.id,
      description: step.description,
      executed: true,
      timestamp: new Date().toISOString(),
    };
  }

  // ============================================================================
  // Plan Control
  // ============================================================================

  pausePlan(planId: string): ExecutionPlan | null {
    const plan = this.loadPlan(planId);
    if (!plan || plan.status !== "executing") return null;

    plan.status = "paused";
    plan.updatedAt = new Date().toISOString();
    this.savePlan(plan);
    this.activePlan = null;
    return plan;
  }

  resumePlan(planId: string): ExecutionPlan | null {
    const plan = this.loadPlan(planId);
    if (!plan || plan.status !== "paused") return null;

    plan.status = "executing";
    plan.updatedAt = new Date().toISOString();
    this.savePlan(plan);
    this.activePlan = plan;
    return plan;
  }

  approvePlan(planId: string): ExecutionPlan | null {
    const plan = this.loadPlan(planId);
    if (!plan || plan.status !== "draft") return null;

    plan.status = "approved";
    plan.updatedAt = new Date().toISOString();
    this.savePlan(plan);
    return plan;
  }

  rejectPlan(planId: string): ExecutionPlan | null {
    const plan = this.loadPlan(planId);
    if (!plan || plan.status !== "draft") return null;

    plan.status = "failed";
    plan.updatedAt = new Date().toISOString();
    this.savePlan(plan);
    return plan;
  }

  getActivePlan(): ExecutionPlan | null {
    return this.activePlan;
  }

  // ============================================================================
  // Plan Modification
  // ============================================================================

  updateStep(planId: string, stepId: string, updates: Partial<PlanStep>): ExecutionPlan | null {
    const plan = this.loadPlan(planId);
    if (!plan) return null;

    const stepIndex = plan.steps.findIndex(s => s.id === stepId);
    if (stepIndex === -1) return null;

    plan.steps[stepIndex] = { ...plan.steps[stepIndex], ...updates };
    plan.updatedAt = new Date().toISOString();
    this.savePlan(plan);
    return plan;
  }

  addStep(planId: string, step: Omit<PlanStep, "id" | "status">, afterStepId?: string): ExecutionPlan | null {
    const plan = this.loadPlan(planId);
    if (!plan) return null;

    const newStep: PlanStep = {
      ...step,
      id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      status: "pending",
    };

    if (afterStepId) {
      const afterIndex = plan.steps.findIndex(s => s.id === afterStepId);
      if (afterIndex !== -1) {
        plan.steps.splice(afterIndex + 1, 0, newStep);
      } else {
        plan.steps.push(newStep);
      }
    } else {
      plan.steps.push(newStep);
    }

    plan.updatedAt = new Date().toISOString();
    this.savePlan(plan);
    return plan;
  }

  removeStep(planId: string, stepId: string): ExecutionPlan | null {
    const plan = this.loadPlan(planId);
    if (!plan) return null;

    plan.steps = plan.steps.filter(s => s.id !== stepId);
    plan.updatedAt = new Date().toISOString();
    this.savePlan(plan);
    return plan;
  }
}

// ============================================================================
// Register Planning Tools in Universal Tool Registry
// ============================================================================

import { registerTool, ToolExecutionContext, UniversalToolResult } from "./tool-registry";

export function registerPlanningTools(projectRoot: string, projectId: string, adapter: LLMAdapter): void {
  const planningAgent = new PlanningAgent({ projectRoot, projectId, adapter });

  // Create plan
  registerTool({
    name: "planning.create",
    description: "Create an execution plan for a goal",
    category: "planning",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "The goal to plan for" },
        context: { type: "string", description: "Additional context for planning" },
      },
      required: ["goal"],
    },
    execute: async (args, ctx) => {
      const plan = await planningAgent.createPlan(args.goal as string, args.context as string);
      planningAgent.savePlan(plan);
      return { success: true, data: plan, summary: `Created plan ${plan.id} with ${plan.steps.length} steps` };
    },
  });

  // Get plan
  registerTool({
    name: "planning.get",
    description: "Get a plan by ID",
    category: "planning",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        planId: { type: "string", description: "Plan ID" },
      },
      required: ["planId"],
    },
    execute: async (args, ctx) => {
      const plan = planningAgent.loadPlan(args.planId as string);
      return plan
        ? { success: true, data: plan, summary: `Plan ${plan.id}: ${plan.goal}` }
        : { success: false, error: "Plan not found" };
    },
  });

  // List plans
  registerTool({
    name: "planning.list",
    description: "List all saved plans",
    category: "planning",
    risk: "READ",
    execute: async (args, ctx) => {
      const plans = planningAgent.listPlans();
      return { success: true, data: plans, summary: `${plans.length} plans` };
    },
  });

  // Approve plan
  registerTool({
    name: "planning.approve",
    description: "Approve a draft plan for execution",
    category: "planning",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        planId: { type: "string", description: "Plan ID" },
      },
      required: ["planId"],
    },
    execute: async (args, ctx) => {
      const plan = planningAgent.approvePlan(args.planId as string);
      return plan
        ? { success: true, data: plan, summary: `Plan ${plan.id} approved` }
        : { success: false, error: "Plan not found or not in draft status" };
    },
  });

  // Execute plan
  registerTool({
    name: "planning.execute",
    description: "Execute an approved plan",
    category: "planning",
    risk: "WRITE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        planId: { type: "string", description: "Plan ID" },
        autoApprove: { type: "boolean", description: "Auto-approve if in draft" },
      },
      required: ["planId"],
    },
    execute: async (args, ctx) => {
      const plan = await planningAgent.executePlan(args.planId as string, { autoApprove: args.autoApprove as boolean });
      return { success: true, data: plan, summary: `Plan ${plan.id} ${plan.status}` };
    },
  });

  // Pause plan
  registerTool({
    name: "planning.pause",
    description: "Pause an executing plan",
    category: "planning",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        planId: { type: "string", description: "Plan ID" },
      },
      required: ["planId"],
    },
    execute: async (args, ctx) => {
      const plan = planningAgent.pausePlan(args.planId as string);
      return plan
        ? { success: true, data: plan, summary: `Plan ${plan.id} paused` }
        : { success: false, error: "Plan not found or not executing" };
    },
  });

  // Resume plan
  registerTool({
    name: "planning.resume",
    description: "Resume a paused plan",
    category: "planning",
    risk: "WRITE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        planId: { type: "string", description: "Plan ID" },
      },
      required: ["planId"],
    },
    execute: async (args, ctx) => {
      const plan = planningAgent.resumePlan(args.planId as string);
      return plan
        ? { success: true, data: plan, summary: `Plan ${plan.id} resumed` }
        : { success: false, error: "Plan not found or not paused" };
    },
  });

  // Update step
  registerTool({
    name: "planning.updateStep",
    description: "Update a step in a plan",
    category: "planning",
    risk: "WRITE",
    parameters: {
      type: "object",
      properties: {
        planId: { type: "string", description: "Plan ID" },
        stepId: { type: "string", description: "Step ID" },
        updates: { type: "object", description: "Partial step updates" },
      },
      required: ["planId", "stepId"],
    },
    execute: async (args, ctx) => {
      const plan = planningAgent.updateStep(
        args.planId as string,
        args.stepId as string,
        args.updates as Partial<PlanStep>
      );
      return plan
        ? { success: true, data: plan, summary: `Step ${args.stepId} updated` }
        : { success: false, error: "Plan or step not found" };
    },
  });

  // Add step
  registerTool({
    name: "planning.addStep",
    description: "Add a step to a plan",
    category: "planning",
    risk: "WRITE",
    parameters: {
      type: "object",
      properties: {
        planId: { type: "string", description: "Plan ID" },
        step: { type: "object", description: "Step definition (without id/status)" },
        afterStepId: { type: "string", description: "Insert after this step ID" },
      },
      required: ["planId", "step"],
    },
    execute: async (args, ctx) => {
      const plan = planningAgent.addStep(
        args.planId as string,
        args.step as Omit<PlanStep, "id" | "status">,
        args.afterStepId as string
      );
      return plan
        ? { success: true, data: plan, summary: `Step added to plan ${plan.id}` }
        : { success: false, error: "Plan not found" };
    },
  });

  // Delete plan
  registerTool({
    name: "planning.delete",
    description: "Delete a plan",
    category: "planning",
    risk: "DESTRUCTIVE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        planId: { type: "string", description: "Plan ID" },
      },
      required: ["planId"],
    },
    execute: async (args, ctx) => {
      const success = planningAgent.deletePlan(args.planId as string);
      return success
        ? { success: true, summary: `Plan ${args.planId} deleted` }
        : { success: false, error: "Plan not found" };
    },
  });
}

export { PlanningAgent, ExecutionPlan, PlanStep, PlanRisk };
export type { PlanningConfig };