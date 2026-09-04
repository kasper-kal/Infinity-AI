/**
 * Workflow Orchestrator — Phase 37
 *
 * Fully automated end-to-end workflow: Natural Language → Deployed Product
 * Handles: discover → plan → scaffold → generate → test → deploy → verify
 */

import { z } from "zod";
import { EventEmitter } from "events";
import { UniversalAgent, runUniversalAgent, AgentConfig } from "./universal-agent.js";
import { BuildOrchestrator } from "./build-orchestrator.js";
import { BuildMapManager, BuildMapAgent } from "./build-map-agent.js";
import { getLLMAdapter } from "./llm-adapter.js";
import { DESIGN_MODEL_CONFIGS } from "./adapter-factory.js";

// ============================================================================
// Types & Schemas
// ============================================================================

export const WorkflowPhaseSchema = z.enum([
  "discover",
  "plan",
  "scaffold",
  "generate",
  "test",
  "deploy",
  "verify",
  "complete"
]);

export type WorkflowPhase = z.infer<typeof WorkflowPhaseSchema>;

export const WorkflowStatusSchema = z.enum([
  "pending",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "rolled_back"
]);

export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const WorkflowStepSchema = z.object({
  id: z.string(),
  phase: WorkflowPhaseSchema,
  title: z.string(),
  description: z.string(),
  agentType: z.enum(["planner", "coder", "reviewer", "tester", "deployer", "architect"]),
  dependencies: z.array(z.string()).default([]),
  estimatedTokens: z.number().default(50000),
  estimatedDurationMs: z.number().default(60000),
  requiresApproval: z.boolean().default(false),
  status: WorkflowStatusSchema.default("pending"),
  result: z.any().optional(),
  error: z.string().optional(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
});

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowPlanSchema = z.object({
  id: z.string(),
  goal: z.string(),
  constraints: z.object({
    framework: z.string().optional(),
    database: z.string().optional(),
    auth: z.string().optional(),
    payments: z.string().optional(),
    hosting: z.string().optional(),
    budget: z.number().optional(),
    timeline: z.string().optional(),
  }).optional(),
  phases: z.array(z.object({
    phase: WorkflowPhaseSchema,
    steps: z.array(WorkflowStepSchema),
    approvalGate: z.boolean().default(false),
  })),
  createdAt: z.number(),
  updatedAt: z.number(),
  status: WorkflowStatusSchema.default("pending"),
  currentPhase: WorkflowPhaseSchema.optional(),
  checkpoints: z.array(z.object({
    phase: WorkflowPhaseSchema,
    state: z.any(),
    timestamp: z.number(),
  })).default([]),
});

export type WorkflowPlan = z.infer<typeof WorkflowPlanSchema>;

export const RequirementQuestionSchema = z.object({
  id: z.string(),
  type: z.enum(["radio", "multi_select", "text", "number", "boolean"]),
  question: z.string(),
  options: z.array(z.object({
    value: z.string(),
    label: z.string(),
    description: z.string().optional(),
  })).optional(),
  required: z.boolean().default(true),
  dependsOn: z.string().optional(), // question id this depends on
});

export type RequirementQuestion = z.infer<typeof RequirementQuestionSchema>;

export const PRDSchema = z.object({
  id: z.string(),
  goal: z.string(),
  answers: z.record(z.any()),
  requirements: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    priority: z.enum(["must", "should", "could", "wont"]),
    category: z.enum(["functional", "non-functional", "technical", "ui", "security", "performance"]),
    acceptanceCriteria: z.array(z.string()),
  })),
  techStack: z.object({
    framework: z.string(),
    database: z.string(),
    auth: z.string(),
    payments: z.string().optional(),
    hosting: z.string(),
    language: z.string().default("typescript"),
    styling: z.string().default("tailwind"),
    testing: z.string().default("vitest"),
  }).optional(),
  createdAt: z.number(),
  approved: z.boolean().default(false),
});

export type PRD = z.infer<typeof PRDSchema>;

export const TechStackOptionSchema = z.object({
  category: z.string(),
  option: z.string(),
  score: z.number(),
  rationale: z.string(),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  estimatedCost: z.number().optional(),
  complexity: z.enum(["low", "medium", "high"]),
});

export type TechStackOption = z.infer<typeof TechStackOptionSchema>;

export const DeploymentConfigSchema = z.object({
  provider: z.enum(["vercel", "netlify", "cloudflare", "railway", "fly", "render", "custom"]),
  projectName: z.string(),
  customDomain: z.string().optional(),
  environmentVariables: z.record(z.string()),
  buildCommand: z.string(),
  outputDirectory: z.string(),
  framework: z.string(),
  region: z.string().optional(),
  autoDeploy: z.boolean().default(true),
  previewDeployments: z.boolean().default(true),
});

export type DeploymentConfig = z.infer<typeof DeploymentConfigSchema>;

export const WorkflowEventSchema = z.object({
  type: z.enum([
    "phase_started",
    "phase_completed",
    "step_started",
    "step_completed",
    "step_failed",
    "approval_required",
    "approval_received",
    "checkpoint_created",
    "rollback_initiated",
    "workflow_completed",
    "workflow_failed"
  ]),
  workflowId: z.string(),
  phase: WorkflowPhaseSchema.optional(),
  stepId: z.string().optional(),
  data: z.any().optional(),
  timestamp: z.number().default(() => Date.now()),
});

export type WorkflowEvent = z.infer<typeof WorkflowEventSchema>;

// ============================================================================
// Workflow Orchestrator Class
// ============================================================================

export class WorkflowOrchestrator extends EventEmitter {
  private plans: Map<string, WorkflowPlan> = new Map();
  private runningWorkflows: Map<string, { abortController: AbortController; currentStep: string }> = new Map();
  private buildOrchestrator: BuildOrchestrator;
  private buildMapManager: BuildMapManager;
  private buildMapAgent: BuildMapAgent;

  constructor() {
    super();
    this.buildOrchestrator = new BuildOrchestrator();
    this.buildMapManager = new BuildMapManager();
    this.buildMapAgent = new BuildMapAgent(this.buildMapManager);
  }

  // ---------------------------------------------------------------------------
  // Phase 1: Discover - Requirement Clarification
  // ---------------------------------------------------------------------------

  async discoverRequirements(goal: string, projectId: string): Promise<RequirementQuestion[]> {
    const adapter = getLLMAdapter();

    const prompt = `You are an expert product manager. The user wants to build: "${goal}"

Analyze this goal and generate 3-5 targeted clarification questions to reduce ambiguity.
Focus on: core features, user flows, technical constraints, integrations, success criteria.

Return ONLY a JSON array of questions with this schema:
{
  "questions": [
    {
      "id": "q1",
      "type": "radio|multi_select|text|number|boolean",
      "question": "Specific question",
      "options": [{"value": "opt1", "label": "Option 1", "description": "..."}],
      "required": true,
      "dependsOn": "q1"
    }
  ]
}

Guidelines:
- Max 5 questions
- Each question must significantly reduce ambiguity
- Use radio for single choice, multi_select for multiple
- Include sensible defaults in options
- Order from most to least critical`;

    const response = await adapter.chat([
      { role: "system", content: "You are an expert product manager. Output ONLY valid JSON." },
      { role: "user", content: prompt }
    ], { responseFormat: "json_object" });

    const parsed = JSON.parse(response.content);
    return parsed.questions.map((q: any, i: number) => ({
      ...q,
      id: q.id || `q${i + 1}`,
    }));
  }

  async generatePRD(goal: string, answers: Record<string, any>, projectId: string): Promise<PRD> {
    const adapter = getLLMAdapter();

    const prompt = `You are an expert product manager. Create a comprehensive PRD (Product Requirements Document).

GOAL: "${goal}"
USER ANSWERS: ${JSON.stringify(answers, null, 2)}

Generate a PRD with:
1. Structured requirements (functional, non-functional, technical, UI, security, performance)
2. Priority levels (must/should/could/wont)
3. Acceptance criteria for each requirement
4. Recommended tech stack with rationale

Return ONLY valid JSON matching this schema:
{
  "id": "prd_...",
  "goal": "...",
  "answers": {...},
  "requirements": [
    {
      "id": "req_1",
      "title": "...",
      "description": "...",
      "priority": "must|should|could|wont",
      "category": "functional|non-functional|technical|ui|security|performance",
      "acceptanceCriteria": ["..."]
    }
  ],
  "techStack": {
    "framework": "nextjs|astro|remix|vite-react|sveltekit|nuxt|solidstart",
    "database": "postgresql|sqlite|mongodb|firebase|none",
    "auth": "clerk|authjs|supabase|firebase|custom",
    "payments": "stripe|lemonsqueezy|paddle|none",
    "hosting": "vercel|netlify|cloudflare|railway|fly|custom",
    "language": "typescript",
    "styling": "tailwind",
    "testing": "vitest"
  },
  "createdAt": ${Date.now()},
  "approved": false
}`;

    const response = await adapter.chat([
      { role: "system", content: "You are an expert product manager. Output ONLY valid JSON." },
      { role: "user", content: prompt }
    ], { responseFormat: "json_object" });

    const prd = JSON.parse(response.content);
    return {
      ...prd,
      id: prd.id || `prd_${Date.now()}`,
      createdAt: prd.createdAt || Date.now(),
    };
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Plan - Tech Stack Selection & Architecture
  // ---------------------------------------------------------------------------

  async selectTechStack(prd: PRD, constraints?: WorkflowPlan["constraints"]): Promise<TechStackOption[]> {
    const adapter = getLLMAdapter();

    const prompt = `You are a principal architect. Recommend the optimal tech stack for this PRD.

PRD: ${JSON.stringify(prd, null, 2)}
CONSTRAINTS: ${JSON.stringify(constraints || {}, null, 2)}

For EACH category (framework, database, auth, payments, hosting), provide 3 ranked options with scores (0-100).

Consider:
- Project requirements from PRD
- Team expertise (assume full-stack TypeScript)
- Cost (prefer free tiers)
- Performance & scalability
- Developer experience
- Ecosystem maturity

Return ONLY valid JSON:
{
  "recommendations": [
    {
      "category": "framework",
      "option": "nextjs",
      "score": 95,
      "rationale": "Best for SaaS with App Router, Server Components, built-in auth integration",
      "pros": ["App Router", "Server Components", "Vercel native", "Great DX"],
      "cons": ["Vendor lock-in to Vercel", "Learning curve"],
      "estimatedCost": 0,
      "complexity": "medium"
    }
  ]
}`;

    const response = await adapter.chat([
      { role: "system", content: "You are a principal architect. Output ONLY valid JSON." },
      { role: "user", content: prompt }
    ], { responseFormat: "json_object" });

    const parsed = JSON.parse(response.content);
    return parsed.recommendations || [];
  }

  async createExecutionPlan(prd: PRD, techStack: TechStackOption[], projectId: string): Promise<WorkflowPlan> {
    const adapter = getLLMAdapter();

    const selectedStack = {
      framework: techStack.find(t => t.category === "framework")?.option || "nextjs",
      database: techStack.find(t => t.category === "database")?.option || "postgresql",
      auth: techStack.find(t => t.category === "auth")?.option || "clerk",
      payments: techStack.find(t => t.category === "payments")?.option || "none",
      hosting: techStack.find(t => t.category === "hosting")?.option || "vercel",
    };

    const prompt = `You are a principal engineer. Create a detailed execution plan for this PRD.

PRD: ${JSON.stringify(prd, null, 2)}
TECH STACK: ${JSON.stringify(selectedStack, null, 2)}

Create a phased plan with these phases in order:
1. discover - requirements clarification (DONE)
2. plan - architecture & tech stack (DONE)
3. scaffold - repo init, config, CI/CD, base project structure
4. generate - code generation (database, auth, API, UI components, pages, integrations)
5. test - unit, integration, e2e, a11y, typecheck, lint, build verification
6. deploy - infrastructure, environment vars, DNS, SSL, monitoring
7. verify - smoke tests, health checks, rollback readiness

For each phase, create specific steps with:
- Agent type (planner, coder, reviewer, tester, deployer, architect)
- Dependencies between steps
- Estimated tokens and duration
- Approval gates at: plan, deploy, and high-risk steps

Return ONLY valid JSON matching WorkflowPlan schema.`;

    const response = await adapter.chat([
      { role: "system", content: "You are a principal engineer. Output ONLY valid JSON matching the WorkflowPlan schema." },
      { role: "user", content: prompt }
    ], { responseFormat: "json_object" });

    const plan = JSON.parse(response.content);

    const workflowPlan: WorkflowPlan = {
      ...plan,
      id: plan.id || `workflow_${Date.now()}`,
      goal: prd.goal,
      constraints: prd.techStack ? {} : undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "pending",
      currentPhase: "scaffold",
      checkpoints: [],
    };

    this.plans.set(workflowPlan.id, workflowPlan);
    return workflowPlan;
  }

  // ---------------------------------------------------------------------------
  // Phase 3: Scaffold - Project Initialization
  // ---------------------------------------------------------------------------

  async runScaffoldPhase(plan: WorkflowPlan, projectId: string): Promise<any> {
    const scaffoldSteps = plan.phases.find(p => p.phase === "scaffold")?.steps || [];
    const results: any = {};

    for (const step of scaffoldSteps) {
      if (step.status !== "pending") continue;

      this.emit("step_started", { workflowId: plan.id, stepId: step.id, phase: "scaffold" });
      step.status = "running";
      step.startedAt = Date.now();

      try {
        const result = await this.executeStep(step, plan, projectId, results);
        step.result = result;
        step.status = "completed";
        step.completedAt = Date.now();
        results[step.id] = result;
        this.emit("step_completed", { workflowId: plan.id, stepId: step.id, result });
      } catch (error: any) {
        step.status = "failed";
        step.error = error.message;
        this.emit("step_failed", { workflowId: plan.id, stepId: step.id, error });
        throw error;
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Phase 4: Generate - Code Generation
  // ---------------------------------------------------------------------------

  async runGeneratePhase(plan: WorkflowPlan, projectId: string, scaffoldResults: any): Promise<any> {
    const generateSteps = plan.phases.find(p => p.phase === "generate")?.steps || [];
    const results: any = { ...scaffoldResults };

    for (const step of generateSteps) {
      if (step.status !== "pending") continue;

      this.emit("step_started", { workflowId: plan.id, stepId: step.id, phase: "generate" });
      step.status = "running";
      step.startedAt = Date.now();

      try {
        const result = await this.executeStep(step, plan, projectId, results);
        step.result = result;
        step.status = "completed";
        step.completedAt = Date.now();
        results[step.id] = result;
        this.emit("step_completed", { workflowId: plan.id, stepId: step.id, result });
      } catch (error: any) {
        step.status = "failed";
        step.error = error.message;
        this.emit("step_failed", { workflowId: plan.id, stepId: step.id, error });
        throw error;
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Phase 5: Test - Automated Testing
  // ---------------------------------------------------------------------------

  async runTestPhase(plan: WorkflowPlan, projectId: string, generateResults: any): Promise<any> {
    const testSteps = plan.phases.find(p => p.phase === "test")?.steps || [];
    const results: any = { ...generateResults };

    for (const step of testSteps) {
      if (step.status !== "pending") continue;

      this.emit("step_started", { workflowId: plan.id, stepId: step.id, phase: "test" });
      step.status = "running";
      step.startedAt = Date.now();

      try {
        const result = await this.executeStep(step, plan, projectId, results);
        step.result = result;
        step.status = "completed";
        step.completedAt = Date.now();
        results[step.id] = result;
        this.emit("step_completed", { workflowId: plan.id, stepId: step.id, result });
      } catch (error: any) {
        step.status = "failed";
        step.error = error.message;
        this.emit("step_failed", { workflowId: plan.id, stepId: step.id, error });
        throw error;
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Phase 6: Deploy - Deployment Automation
  // ---------------------------------------------------------------------------

  async runDeployPhase(plan: WorkflowPlan, projectId: string, testResults: any): Promise<any> {
    const deploySteps = plan.phases.find(p => p.phase === "deploy")?.steps || [];
    const results: any = { ...testResults };

    for (const step of deploySteps) {
      if (step.status !== "pending") continue;

      // Check for approval gate
      if (step.requiresApproval) {
        this.emit("approval_required", { workflowId: plan.id, stepId: step.id, phase: "deploy" });
        step.status = "awaiting_approval";
        // In real implementation, wait for approval via event
        await this.waitForApproval(plan.id, step.id);
      }

      this.emit("step_started", { workflowId: plan.id, stepId: step.id, phase: "deploy" });
      step.status = "running";
      step.startedAt = Date.now();

      try {
        const result = await this.executeStep(step, plan, projectId, results);
        step.result = result;
        step.status = "completed";
        step.completedAt = Date.now();
        results[step.id] = result;
        this.emit("step_completed", { workflowId: plan.id, stepId: step.id, result });
      } catch (error: any) {
        step.status = "failed";
        step.error = error.message;
        this.emit("step_failed", { workflowId: plan.id, stepId: step.id, error });
        throw error;
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Phase 7: Verify - Post-Deploy Verification
  // ---------------------------------------------------------------------------

  async runVerifyPhase(plan: WorkflowPlan, projectId: string, deployResults: any): Promise<any> {
    const verifySteps = plan.phases.find(p => p.phase === "verify")?.steps || [];
    const results: any = { ...deployResults };

    for (const step of verifySteps) {
      if (step.status !== "pending") continue;

      this.emit("step_started", { workflowId: plan.id, stepId: step.id, phase: "verify" });
      step.status = "running";
      step.startedAt = Date.now();

      try {
        const result = await this.executeStep(step, plan, projectId, results);
        step.result = result;
        step.status = "completed";
        step.completedAt = Date.now();
        results[step.id] = result;
        this.emit("step_completed", { workflowId: plan.id, stepId: step.id, result });
      } catch (error: any) {
        step.status = "failed";
        step.error = error.message;
        this.emit("step_failed", { workflowId: plan.id, stepId: step.id, error });
        throw error;
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Core Execution Engine
  // ---------------------------------------------------------------------------

  private async executeStep(step: WorkflowStep, plan: WorkflowPlan, projectId: string, context: any): Promise<any> {
    const agentConfig: AgentConfig = this.getAgentConfigForStep(step);
    const prompt = this.buildStepPrompt(step, plan, context);

    const result = await runUniversalAgent({
      ...agentConfig,
      prompt,
      projectId,
      maxIterations: 10,
      tokenBudget: step.estimatedTokens,
      onToolCall: (toolCall) => {
        this.emit("tool_call", { workflowId: plan.id, stepId: step.id, toolCall });
      },
    });

    return result;
  }

  private getAgentConfigForStep(step: WorkflowStep): AgentConfig {
    const baseConfig: AgentConfig = {
      model: "claude-3-5-sonnet-20241022",
      temperature: 0.3,
      maxTokens: 8192,
      enableOrchestration: true,
      enableResilience: true,
      autoCheckpoint: true,
    };

    switch (step.agentType) {
      case "planner":
        return { ...baseConfig, temperature: 0.2, systemPrompt: "You are a principal architect. Create detailed, actionable plans." };
      case "coder":
        return { ...baseConfig, temperature: 0.3, systemPrompt: "You are a senior full-stack engineer. Write production-ready code." };
      case "reviewer":
        return { ...baseConfig, temperature: 0.1, systemPrompt: "You are a code reviewer. Find bugs, security issues, performance problems." };
      case "tester":
        return { ...baseConfig, temperature: 0.2, systemPrompt: "You are a QA engineer. Write comprehensive tests." };
      case "deployer":
        return { ...baseConfig, temperature: 0.1, systemPrompt: "You are a DevOps engineer. Deploy reliably with zero-downtime." };
      case "architect":
        return { ...baseConfig, temperature: 0.2, systemPrompt: "You are a system architect. Design scalable, maintainable systems." };
      default:
        return baseConfig;
    }
  }

  private buildStepPrompt(step: WorkflowStep, plan: WorkflowPlan, context: any): string {
    return `WORKFLOW: ${plan.goal}
PHASE: ${step.phase}
STEP: ${step.title}
DESCRIPTION: ${step.description}
CONTEXT: ${JSON.stringify(context, null, 2).slice(0, 5000)}

Execute this step and return the result. Use available tools as needed.`;
  }

  private async waitForApproval(workflowId: string, stepId: string): Promise<void> {
    return new Promise((resolve) => {
      const handler = (event: any) => {
        if (event.workflowId === workflowId && event.stepId === stepId && event.approved) {
          this.off("approval_received", handler);
          resolve();
        }
      };
      this.on("approval_received", handler);
    });
  }

  // ---------------------------------------------------------------------------
  // Checkpointing & Rollback
  // ---------------------------------------------------------------------------

  async createCheckpoint(plan: WorkflowPlan, phase: WorkflowPhase, state: any): Promise<void> {
    plan.checkpoints.push({
      phase,
      state: JSON.parse(JSON.stringify(state)), // Deep clone
      timestamp: Date.now(),
    });
    plan.updatedAt = Date.now();
    this.emit("checkpoint_created", { workflowId: plan.id, phase, timestamp: Date.now() });
  }

  async rollbackToCheckpoint(plan: WorkflowPlan, checkpointIndex: number): Promise<any> {
    if (checkpointIndex < 0 || checkpointIndex >= plan.checkpoints.length) {
      throw new Error("Invalid checkpoint index");
    }

    const checkpoint = plan.checkpoints[checkpointIndex];
    this.emit("rollback_initiated", { workflowId: plan.id, checkpointIndex, phase: checkpoint.phase });

    // Reset steps after checkpoint
    for (const phaseObj of plan.phases) {
      if (phaseObj.phase === checkpoint.phase) {
        for (const step of phaseObj.steps) {
          if (step.startedAt && step.startedAt > checkpoint.timestamp) {
            step.status = "pending";
            step.result = undefined;
            step.error = undefined;
            step.startedAt = undefined;
            step.completedAt = undefined;
          }
        }
      } else if (plan.phases.indexOf(phaseObj) > plan.phases.findIndex(p => p.phase === checkpoint.phase)) {
        for (const step of phaseObj.steps) {
          step.status = "pending";
          step.result = undefined;
          step.error = undefined;
          step.startedAt = undefined;
          step.completedAt = undefined;
        }
      }
    }

    plan.status = "running";
    plan.currentPhase = checkpoint.phase;
    plan.updatedAt = Date.now();

    return checkpoint.state;
  }

  // ---------------------------------------------------------------------------
  // Main Workflow Execution
  // ---------------------------------------------------------------------------

  async executeWorkflow(plan: WorkflowPlan, projectId: string): Promise<WorkflowPlan> {
    const abortController = new AbortController();
    this.runningWorkflows.set(plan.id, { abortController, currentStep: "" });

    plan.status = "running";
    plan.updatedAt = Date.now();
    this.emit("workflow_started", { workflowId: plan.id });

    try {
      // Phase 3: Scaffold
      plan.currentPhase = "scaffold";
      this.emit("phase_started", { workflowId: plan.id, phase: "scaffold" });
      const scaffoldResults = await this.runScaffoldPhase(plan, projectId);
      await this.createCheckpoint(plan, "scaffold", scaffoldResults);
      this.emit("phase_completed", { workflowId: plan.id, phase: "scaffold" });

      // Phase 4: Generate
      plan.currentPhase = "generate";
      this.emit("phase_started", { workflowId: plan.id, phase: "generate" });
      const generateResults = await this.runGeneratePhase(plan, projectId, scaffoldResults);
      await this.createCheckpoint(plan, "generate", generateResults);
      this.emit("phase_completed", { workflowId: plan.id, phase: "generate" });

      // Phase 5: Test
      plan.currentPhase = "test";
      this.emit("phase_started", { workflowId: plan.id, phase: "test" });
      const testResults = await this.runTestPhase(plan, projectId, generateResults);
      await this.createCheckpoint(plan, "test", testResults);
      this.emit("phase_completed", { workflowId: plan.id, phase: "test" });

      // Phase 6: Deploy (with approval gate)
      plan.currentPhase = "deploy";
      this.emit("phase_started", { workflowId: plan.id, phase: "deploy" });
      const deployResults = await this.runDeployPhase(plan, projectId, testResults);
      await this.createCheckpoint(plan, "deploy", deployResults);
      this.emit("phase_completed", { workflowId: plan.id, phase: "deploy" });

      // Phase 7: Verify
      plan.currentPhase = "verify";
      this.emit("phase_started", { workflowId: plan.id, phase: "verify" });
      const verifyResults = await this.runVerifyPhase(plan, projectId, deployResults);
      await this.createCheckpoint(plan, "verify", verifyResults);
      this.emit("phase_completed", { workflowId: plan.id, phase: "verify" });

      plan.status = "completed";
      plan.currentPhase = "complete";
      plan.updatedAt = Date.now();
      this.emit("workflow_completed", { workflowId: plan.id, results: verifyResults });

    } catch (error: any) {
      plan.status = "failed";
      plan.updatedAt = Date.now();
      this.emit("workflow_failed", { workflowId: plan.id, error: error.message });
      throw error;
    } finally {
      this.runningWorkflows.delete(plan.id);
    }

    return plan;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  getPlan(workflowId: string): WorkflowPlan | undefined {
    return this.plans.get(workflowId);
  }

  getAllPlans(): WorkflowPlan[] {
    return Array.from(this.plans.values());
  }

  async approveStep(workflowId: string, stepId: string, approved: boolean): Promise<void> {
    const plan = this.plans.get(workflowId);
    if (!plan) throw new Error("Workflow not found");

    const step = plan.phases.flatMap(p => p.steps).find(s => s.id === stepId);
    if (!step) throw new Error("Step not found");

    if (approved) {
      step.status = "pending"; // Will be picked up by execution loop
    } else {
      step.status = "failed";
      step.error = "User rejected approval";
    }

    this.emit("approval_received", { workflowId: plan.id, stepId, approved });
  }

  async cancelWorkflow(workflowId: string): Promise<void> {
    const running = this.runningWorkflows.get(workflowId);
    if (running) {
      running.abortController.abort();
    }

    const plan = this.plans.get(workflowId);
    if (plan) {
      plan.status = "failed";
      plan.updatedAt = Date.now();
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let workflowOrchestratorInstance: WorkflowOrchestrator | null = null;

export function getWorkflowOrchestrator(): WorkflowOrchestrator {
  if (!workflowOrchestratorInstance) {
    workflowOrchestratorInstance = new WorkflowOrchestrator();
  }
  return workflowOrchestratorInstance;
}

export function resetWorkflowOrchestrator(): void {
  workflowOrchestratorInstance = null;
}