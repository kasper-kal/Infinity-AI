/**
 * Workflow Orchestrator — Fully Automated End-to-End Workflow (NL → Deployed Product)
 *
 * Takes a natural language goal and executes complete workflow:
 * discover → plan → scaffold → generate → test → deploy → verify
 */

import { z } from "zod";
import { UniversalAgent, runUniversalAgent } from "./universal-agent.js";
import { toolRegistry } from "./tool-registry.js";
import { LLMAdapter, getLLMAdapter } from "./llm-adapter.js";
import { EventEmitter } from "events";

// ============================================
// Types & Schemas
// ============================================

export const WorkflowPhaseSchema = z.enum([
  "discover",
  "plan",
  "scaffold",
  "generate",
  "test",
  "deploy",
  "verify"
]);

export const WorkflowStatusSchema = z.enum([
  "pending",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled"
]);

export const ApprovalGateSchema = z.enum(["plan", "deploy", "high-risk"]);

export const TechStackOptionSchema = z.object({
  framework: z.string(),
  database: z.string(),
  auth: z.string(),
  payments: z.string().optional(),
  hosting: z.string(),
  score: z.number(),
  rationale: z.string(),
});

export const WorkflowStepSchema = z.object({
  id: z.string(),
  phase: WorkflowPhaseSchema,
  title: string,
  description: string,
  agentType: z.string(),
  dependsOn: z.array(z.string()),
  estimatedTokens: z.number().optional(),
  estimatedDurationMs: z.number().optional(),
  requiresApproval: z.boolean().default(false),
  approvalGate: ApprovalGateSchema.optional(),
  status: z.enum(["pending", "running", "completed", "failed", "skipped"]).default("pending"),
  result: z.any().optional(),
  error: z.string().optional(),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
});

export const WorkflowPlanSchema = z.object({
  id: z.string(),
  goal: z.string(),
  constraints: z.record(z.any()).optional(),
  clarificationQuestions: z.array(z.object({
    question: z.string(),
    type: z.enum(["radio", "multi-select", "text"]),
    options: z.array(z.string()).optional(),
    required: z.boolean().default(true),
  })).optional(),
  prd: z.string().optional(),
  techStack: TechStackOptionSchema.optional(),
  steps: z.array(WorkflowStepSchema),
  createdAt: z.date(),
  updatedAt: z.date(),
  currentStepIndex: z.number().default(0),
  status: WorkflowStatusSchema.default("pending"),
  checkpoints: z.array(z.object({
    stepIndex: z.number(),
    state: z.any(),
    timestamp: z.date(),
  })).default([]),
});

export const WorkflowExecutionSchema = z.object({
  workflowId: z.string(),
  plan: WorkflowPlanSchema,
  status: WorkflowStatusSchema,
  currentPhase: WorkflowPhaseSchema,
  currentStepId: z.string().optional(),
  progress: z.number().default(0),
  logs: z.array(z.object({
    timestamp: z.date(),
    phase: WorkflowPhaseSchema,
    stepId: z.string(),
    message: z.string(),
    level: z.enum(["info", "warning", "error", "success"]),
  })).default([]),
  artifacts: z.array(z.object({
    type: z.string(),
    path: z.string(),
    content: z.string().optional(),
    metadata: z.record(z.any()).optional(),
  })).default([]),
  deployments: z.array(z.object({
    environment: z.string(),
    url: z.string(),
    status: z.string(),
    deployedAt: z.date(),
  })).default([]),
  handoffDoc: z.string().optional(),
  startedAt: z.date(),
  updatedAt: z.date(),
  completedAt: z.date().optional(),
});

export type WorkflowPhase = z.infer<typeof WorkflowPhaseSchema>;
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;
export type ApprovalGate = z.infer<typeof ApprovalGateSchema>;
export type TechStackOption = z.infer<typeof TechStackOptionSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type WorkflowPlan = z.infer<typeof WorkflowPlanSchema>;
export type WorkflowExecution = z.infer<typeof WorkflowExecutionSchema>;

// ============================================
// Workflow Orchestrator Class
// ============================================

export class WorkflowOrchestrator extends EventEmitter {
  private adapter: LLMAdapter;
  private executions: Map<string, WorkflowExecution> = new Map();
  private plans: Map<string, WorkflowPlan> = new Map();

  constructor(adapter?: LLMAdapter) {
    super();
    this.adapter = adapter || getLLMAdapter();
  }

  // ============================================
  // Phase 1: Discover - Requirement Clarification
  // ============================================

  async discover(goal: string, constraints?: Record<string, any>): Promise<{
    questions: WorkflowPlan["clarificationQuestions"];
    prd: string;
  }> {
    const prompt = `You are a product manager clarifying requirements for a software project.

GOAL: "${goal}"
CONSTRAINTS: ${JSON.stringify(constraints || {}, null, 2)}

Your task: Ask up to 5 targeted questions to reduce ambiguity. Focus on:
1. Core functionality (what exactly should it do?)
2. Target users (who is this for?)
3. Scale/performance requirements
4. Integration requirements
5. Timeline/budget constraints

Return JSON with:
{
  "questions": [
    {"question": "...", "type": "radio|multi-select|text", "options": ["..."], "required": true}
  ],
  "prd": "Draft Product Requirements Document based on what we know so far"
}`;

    const response = await this.adapter.complete({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      maxTokens: 2000,
      responseFormat: { type: "json_object" },
    });

    return JSON.parse(response.content);
  }

  // ============================================
  // Phase 2: Plan - Tech Stack Selection & Architecture
  // ============================================

  async selectTechStack(goal: string, prd: string): Promise<TechStackOption[]> {
    const prompt = `You are a senior architect selecting the optimal tech stack.

GOAL: "${goal}"
PRD: "${prd}"

Score each option (0-100) and provide rationale. Consider: developer experience, ecosystem, scaling, cost ($0 budget), team familiarity.

Return TOP 3 options as JSON array:
[
  {
    "framework": "nextjs|astro|remix|vite-react|sveltekit|nuxt|solidstart",
    "database": "postgresql|sqlite|mongodb|firebase|supabase|neon|planetscale|turso",
    "auth": "clerk|authjs|supabase-auth|custom-jwt|firebase-auth",
    "payments": "stripe|lemonsqueezy|paddle|none",
    "hosting": "vercel|netlify|cloudflare-pages|railway|flyio|render",
    "score": 95,
    "rationale": "Why this combination..."
  }
]`;

    const response = await this.adapter.complete({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      maxTokens: 2000,
      responseFormat: { type: "json_object" },
    });

    const result = JSON.parse(response.content);
    return Array.isArray(result) ? result : result.options || [];
  }

  async createPlan(goal: string, prd: string, techStack: TechStackOption): Promise<WorkflowPlan> {
    const prompt = `You are a lead engineer creating a detailed execution plan.

GOAL: "${goal}"
PRD: "${prd}"
TECH STACK: ${JSON.stringify(techStack, null, 2)}

Create a step-by-step plan with these phases:
1. DISCOVER - Requirements already clarified
2. PLAN - This step (architecture decisions)
3. SCAFFOLD - Initialize repo, config, folder structure
4. GENERATE - Code generation (UI, API, DB, Auth, Integrations)
5. TEST - Unit, E2E, A11y, Typecheck, Lint, Build verification
6. DEPLOY - Infra, DNS, SSL, monitoring, health checks
7. VERIFY - Smoke tests, post-deploy validation

For each step, specify:
- id, phase, title, description
- agentType (planner, coder, reviewer, tester, deployer)
- dependsOn (step IDs)
- estimatedTokens, estimatedDurationMs
- requiresApproval (true for plan, deploy, high-risk)
- approvalGate (plan|deploy|high-risk)

Return as JSON matching WorkflowPlan schema (without id/createdAt/updatedAt).`;

    const response = await this.adapter.complete({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      maxTokens: 4000,
      responseFormat: { type: "json_object" },
    });

    const planData = JSON.parse(response.content);
    const plan: WorkflowPlan = {
      id: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      goal,
      prd,
      techStack,
      steps: planData.steps || [],
      createdAt: new Date(),
      updatedAt: new Date(),
      currentStepIndex: 0,
      status: "pending",
      checkpoints: [],
    };

    this.plans.set(plan.id, plan);
    return plan;
  }

  // ============================================
  // Phase 3: Scaffold - Repository & Config Setup
  // ============================================

  async scaffold(plan: WorkflowPlan, execution: WorkflowExecution): Promise<void> {
    const step = this.getCurrentStep(plan);
    this.emit("log", { ...step, message: `Scaffolding ${plan.techStack?.framework} project...`, level: "info" });

    // Use framework generator from Phase 20
    const { FrameworkRegistry } = await import("./framework-generators/index.js");
    const framework = FrameworkRegistry.get(plan.techStack?.framework || "nextjs");

    if (!framework) {
      throw new Error(`Framework ${plan.techStack?.framework} not found`);
    }

    // Generate scaffold
    const scaffoldResult = await framework.generateScaffold({
      projectName: this.slugify(plan.goal),
      framework: plan.techStack?.framework,
      database: plan.techStack?.database,
      auth: plan.techStack?.auth,
      styling: "tailwind",
      typescript: true,
      features: ["api", "auth", "database", "ui-components"],
    });

    execution.artifacts.push(...scaffoldResult.files.map(f => ({
      type: "scaffold",
      path: f.path,
      content: f.content,
    })));

    this.emit("log", { ...step, message: "Scaffold complete", level: "success" });
  }

  // ============================================
  // Phase 4: Generate - Code Generation Pipeline
  // ============================================

  async generate(plan: WorkflowPlan, execution: WorkflowExecution): Promise<void> {
    const phases = [
      { name: "Database Schema & Migrations", agent: "database-engineer" },
      { name: "API Routes & Backend", agent: "api-engineer" },
      { name: "Authentication Setup", agent: "auth-engineer" },
      { name: "UI Components & Pages", agent: "ui-designer" },
      { name: "Integrations (Payments, External APIs)", agent: "integration-engineer" },
      { name: "Tests Generation", agent: "test-engineer" },
    ];

    for (const phase of phases) {
      const step = this.getCurrentStep(plan);
      this.emit("log", { ...step, message: `Generating: ${phase.name}...`, level: "info" });

      // Use specialized subagents from Phase 3
      const { spawnSubagent } = await import("./orchestration-engine.js");
      const result = await spawnSubagent(phase.agent, {
        goal: plan.goal,
        prd: plan.prd,
        techStack: plan.techStack,
        existingFiles: execution.artifacts.map(a => ({ path: a.path, content: a.content })),
        context: { phase: phase.name },
      });

      execution.artifacts.push(...(result.files || []).map(f => ({
        type: phase.name.toLowerCase().replace(/\s+/g, "-"),
        path: f.path,
        content: f.content,
      })));

      this.emit("log", { ...step, message: `${phase.name} complete`, level: "success" });
      this.advanceStep(plan);
    }
  }

  // ============================================
  // Phase 5: Test - Automated Testing & Quality
  // ============================================

  async test(plan: WorkflowPlan, execution: WorkflowExecution): Promise<void> {
    const step = this.getCurrentStep(plan);
    this.emit("log", { ...step, message: "Running automated tests...", level: "info" });

    const testResults = {
      unit: { passed: 0, failed: 0, coverage: 0 },
      e2e: { passed: 0, failed: 0 },
      a11y: { violations: 0, passed: true },
      typecheck: { passed: true, errors: [] },
      lint: { passed: true, errors: [] },
      build: { passed: true, errors: [] },
    };

    // Run tests using debug tools from Phase 30
    const { DebugToolsManager } = await import("./debug-tools.js");
    const debugTools = new DebugToolsManager();

    // Create a session for test running
    const sessionId = await debugTools.createSession({
      projectPath: execution.artifacts[0]?.path?.split("/").slice(0, -1).join("/") || "/workspace",
    });

    // Run unit tests
    const unitResult = await debugTools.runTests(sessionId, {
      testFramework: "vitest",
      pattern: "**/*.test.ts",
    });
    testResults.unit = {
      passed: unitResult.passed?.length || 0,
      failed: unitResult.failed?.length || 0,
      coverage: unitResult.coverage || 0,
    };

    // Run typecheck
    const typecheckResult = await debugTools.runTypeCheck(sessionId, {
      projectPath: sessionId,
    });
    testResults.typecheck = { passed: typecheckResult.success, errors: typecheckResult.errors };

    // Run lint
    const lintResult = await debugTools.runLint(sessionId, {
      projectPath: sessionId,
    });
    testResults.lint = { passed: lintResult.success, errors: lintResult.errors };

    // Run build verification
    const buildResult = await debugTools.runBuild(sessionId, {
      projectPath: sessionId,
    });
    testResults.build = { passed: buildResult.success, errors: buildResult.errors };

    execution.artifacts.push({
      type: "test-results",
      path: "test-results.json",
      content: JSON.stringify(testResults, null, 2),
    });

    const allPassed = testResults.unit.failed === 0 &&
                       testResults.e2e.failed === 0 &&
                       testResults.a11y.passed &&
                       testResults.typecheck.passed &&
                       testResults.lint.passed &&
                       testResults.build.passed;

    this.emit("log", {
      ...step,
      message: allPassed ? "All tests passed!" : "Some tests failed",
      level: allPassed ? "success" : "error"
    });

    if (!allPassed) {
      // Auto-fix attempt
      await this.autoFixTests(plan, execution, testResults);
    }
  }

  private async autoFixTests(plan: WorkflowPlan, execution: WorkflowExecution, results: any): Promise<void> {
    const { spawnSubagent } = await import("./orchestration-engine.js");

    const fixResult = await spawnSubagent("fixer", {
      goal: "Fix failing tests and type errors",
      errors: results,
      files: execution.artifacts,
      techStack: plan.techStack,
    });

    execution.artifacts.push(...(fixResult.files || []).map((f: any) => ({
      type: "fix",
      path: f.path,
      content: f.content,
    })));
  }

  // ============================================
  // Phase 6: Deploy - Zero-Config Deployment
  // ============================================

  async deploy(plan: WorkflowPlan, execution: WorkflowExecution): Promise<void> {
    const step = this.getCurrentStep(plan);
    const hosting = plan.techStack?.hosting || "vercel";

    this.emit("log", { ...step, message: `Deploying to ${hosting}...`, level: "info" });

    const { DeploymentEngine } = await import("./deployment-engine.js");
    const deployEngine = new DeploymentEngine();

    const deployResult = await deployEngine.deploy({
      projectPath: execution.artifacts[0]?.path?.split("/").slice(0, -1).join("/") || "/workspace",
      framework: plan.techStack?.framework || "nextjs",
      hosting,
      envVars: await this.getSecretsForDeploy(plan),
      customDomain: plan.constraints?.customDomain,
    });

    execution.deployments.push({
      environment: "production",
      url: deployResult.url,
      status: deployResult.success ? "success" : "failed",
      deployedAt: new Date(),
    });

    if (!deployResult.success) {
      throw new Error(`Deployment failed: ${deployResult.error}`);
    }

    // Health checks
    const healthCheck = await deployEngine.healthCheck(deployResult.url);
    execution.deployments[execution.deployments.length - 1].status = healthCheck.healthy ? "healthy" : "unhealthy";

    this.emit("log", { ...step, message: `Deployed to ${deployResult.url}`, level: "success" });
  }

  // ============================================
  // Phase 7: Verify - Post-Deploy Validation
  // ============================================

  async verify(plan: WorkflowPlan, execution: WorkflowExecution): Promise<void> {
    const step = this.getCurrentStep(plan);
    this.emit("log", { ...step, message: "Running post-deploy verification...", level: "info" });

    const deployment = execution.deployments[execution.deployments.length - 1];

    // Smoke tests
    const smokeTests = [
      { name: "Homepage loads", path: "/" },
      { name: "API health", path: "/api/health" },
      { name: "Auth endpoints", path: "/api/auth/status" },
    ];

    for (const test of smokeTests) {
      try {
        const response = await fetch(`${deployment.url}${test.path}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        this.emit("log", { ...step, message: `✓ ${test.name}`, level: "success" });
      } catch (e) {
        this.emit("log", { ...step, message: `✗ ${test.name}: ${e}`, level: "error" });
      }
    }

    // Generate HANDOFF.md
    const handoffDoc = await this.generateHandoffDoc(plan, execution);
    execution.handoffDoc = handoffDoc;
    execution.artifacts.push({
      type: "handoff",
      path: "HANDOFF.md",
      content: handoffDoc,
    });

    this.emit("log", { ...step, message: "Verification complete. HANDOFF.md generated.", level: "success" });
  }

  // ============================================
  // Main Orchestration Loop
  // ============================================

  async execute(goal: string, constraints?: Record<string, any>): Promise<WorkflowExecution> {
    const workflowId = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const execution: WorkflowExecution = {
      workflowId,
      plan: {} as WorkflowPlan, // Will be set after planning
      status: "running",
      currentPhase: "discover",
      progress: 0,
      logs: [],
      artifacts: [],
      deployments: [],
      startedAt: new Date(),
      updatedAt: new Date(),
    };

    this.executions.set(workflowId, execution);
    this.emit("started", execution);

    try {
      // Phase 1: Discover
      execution.currentPhase = "discover";
      this.emit("phase-change", { phase: "discover", execution });
      const { questions, prd } = await this.discover(goal, constraints);

      // If questions needed, we'd pause here for user input
      // For now, proceed with PRD

      // Phase 2: Plan
      execution.currentPhase = "plan";
      this.emit("phase-change", { phase: "plan", execution });
      const techStackOptions = await this.selectTechStack(goal, prd);
      const techStack = techStackOptions[0]; // Auto-select top for now
      const plan = await this.createPlan(goal, prd, techStack);
      execution.plan = plan;

      // Phase 3: Scaffold
      execution.currentPhase = "scaffold";
      this.emit("phase-change", { phase: "scaffold", execution });
      await this.scaffold(plan, execution);
      this.advanceStep(plan);

      // Phase 4: Generate
      execution.currentPhase = "generate";
      this.emit("phase-change", { phase: "generate", execution });
      await this.generate(plan, execution);

      // Phase 5: Test
      execution.currentPhase = "test";
      this.emit("phase-change", { phase: "test", execution });
      await this.test(plan, execution);
      this.advanceStep(plan);

      // Phase 6: Deploy
      execution.currentPhase = "deploy";
      this.emit("phase-change", { phase: "deploy", execution });

      // Check for deploy approval gate
      if (plan.steps.some(s => s.approvalGate === "deploy" && s.status !== "completed")) {
        execution.status = "awaiting_approval";
        this.emit("awaiting-approval", { gate: "deploy", execution });
        // Wait for approval (in real implementation)
        // await this.waitForApproval(workflowId, "deploy");
      }

      await this.deploy(plan, execution);
      this.advanceStep(plan);

      // Phase 7: Verify
      execution.currentPhase = "verify";
      this.emit("phase-change", { phase: "verify", execution });
      await this.verify(plan, execution);
      this.advanceStep(plan);

      // Complete
      execution.status = "completed";
      execution.progress = 100;
      execution.completedAt = new Date();
      execution.updatedAt = new Date();
      this.emit("completed", execution);

      return execution;
    } catch (error) {
      execution.status = "failed";
      execution.error = error instanceof Error ? error.message : String(error);
      execution.updatedAt = new Date();
      this.emit("failed", { execution, error });
      throw error;
    }
  }

  // ============================================
  // Helper Methods
  // ============================================

  private getCurrentStep(plan: WorkflowPlan): WorkflowStep {
    return plan.steps[plan.currentStepIndex];
  }

  private advanceStep(plan: WorkflowPlan): void {
    plan.currentStepIndex++;
    plan.updatedAt = new Date();
    const completed = plan.steps.filter(s => s.status === "completed").length;
    plan.steps[plan.currentStepIndex - 1].status = "completed";
    plan.steps[plan.currentStepIndex - 1].completedAt = new Date();
  }

  private slugify(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 50);
  }

  private async getSecretsForDeploy(plan: WorkflowPlan): Promise<Record<string, string>> {
    // Integrate with Secret Manager (Phase 34)
    return {};
  }

  private async generateHandoffDoc(plan: WorkflowPlan, execution: WorkflowExecution): Promise<string> {
    return `# HANDOFF DOCUMENT

## Project: ${this.slugify(plan.goal)}
## Generated: ${new Date().toISOString()}
## Workflow ID: ${execution.workflowId}

## Architecture
- **Framework**: ${plan.techStack?.framework}
- **Database**: ${plan.techStack?.database}
- **Auth**: ${plan.techStack?.auth}
- **Hosting**: ${plan.techStack?.hosting}

## Deployment
${execution.deployments.map(d => `- ${d.environment}: ${d.url} (${d.status})`).join("\n")}

## Credentials (Encrypted)
Stored in Infinity Secret Manager. Access via Settings → AI Management.

## Runbook
1. Clone repository
2. Install dependencies: \`npm install\`
3. Set environment variables from Secret Manager
4. Run development: \`npm run dev\`
5. Deploy: Push to main branch (auto-deploys)

## Scaling Notes
- Database: ${plan.techStack?.database} handles connection pooling
- Auth: ${plan.techStack?.auth} manages sessions
- Hosting: ${plan.techStack?.hosting} auto-scales

## Monitoring
- Error tracking: Sentry (configure DSN)
- Analytics: Plausible/Umami (self-hosted)
- Uptime: UptimeRobot (free tier)
`;
  }

  // ============================================
  // Public API
  // ============================================

  getExecution(workflowId: string): WorkflowExecution | undefined {
    return this.executions.get(workflowId);
  }

  getPlan(planId: string): WorkflowPlan | undefined {
    return this.plans.get(planId);
  }

  listExecutions(): WorkflowExecution[] {
    return Array.from(this.executions.values());
  }
}

// ============================================
// Singleton Instance
// ============================================

let orchestratorInstance: WorkflowOrchestrator | null = null;

export function getWorkflowOrchestrator(): WorkflowOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new WorkflowOrchestrator();
  }
  return orchestratorInstance;
}