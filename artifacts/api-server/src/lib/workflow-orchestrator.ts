import { z } from "zod";
import { eventEmitter } from "./event-emitter.js";
import { virtualWorktreeManager } from "./virtual-worktree.js";
import { parallelAgentRunner } from "./parallel-agents.js";
import { buildMapAgent } from "./build-map-agent.js";
import { buildOrchestrator } from "./build-orchestrator.js";
import { universalAgent } from "./universal-agent.js";
import { subagents } from "./subagents.js";
import { toolRegistry } from "./tool-registry.js";

// ============================================================================
// SCHEMAS
// ============================================================================

export const WorkflowGoalSchema = z.object({
  goal: z.string().min(10).max(5000),
  constraints: z.object({
    framework: z.enum(["nextjs", "astro", "remix", "vite-react", "sveltekit", "nuxt", "solidstart"]).optional(),
    database: z.enum(["postgresql", "sqlite", "mongodb", "firebase", "none"]).optional(),
    auth: z.enum(["clerk", "authjs", "supabase", "custom", "none"]).optional(),
    payments: z.enum(["stripe", "lemonsqueezy", "paddle", "none"]).optional(),
    hosting: z.enum(["vercel", "netlify", "cloudflare", "railway", "fly", "none"]).optional(),
    budget: z.number().positive().optional(), // USD
    timeline: z.enum(["asap", "day", "week", "month"]).optional(),
    teamSize: z.number().int().positive().optional(),
  }).optional(),
  context: z.object({
    projectId: z.string().optional(),
    existingRepo: z.string().optional(),
    designFiles: z.array(z.string()).optional(),
    apiSpecs: z.array(z.string()).optional(),
  }).optional(),
});

export const WorkflowPhaseSchema = z.enum([
  "discover",
  "plan",
  "scaffold",
  "generate",
  "test",
  "deploy",
  "verify",
]);

export const PhaseStatusSchema = z.enum(["pending", "running", "complete", "error", "paused", "needs_approval"]);

export const WorkflowStepSchema = z.object({
  id: z.string(),
  phase: WorkflowPhaseSchema,
  title: z.string(),
  description: z.string(),
  agentType: z.enum(["planner", "coder", "reviewer", "tester", "deployer", "architect"]),
  dependencies: z.array(z.string()).default([]),
  estimatedDuration: z.number().default(300), // seconds
  maxRetries: z.number().default(2),
  qualityGates: z.array(z.string()).default([]),
  checkpoint: z.boolean().default(true),
  requiresApproval: z.boolean().default(false),
  metadata: z.record(z.unknown()).default({}),
});

export const WorkflowPlanSchema = z.object({
  id: z.string(),
  goal: WorkflowGoalSchema,
  phases: z.array(z.object({
    phase: WorkflowPhaseSchema,
    title: z.string(),
    description: z.string(),
    steps: z.array(WorkflowStepSchema),
    estimatedDuration: z.number(),
    requiresApproval: z.boolean().default(false),
  })),
  techStack: z.object({
    framework: z.string(),
    database: z.string(),
    auth: z.string(),
    payments: z.string(),
    hosting: z.string(),
    rationale: z.string(),
  }).optional(),
  prd: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  status: PhaseStatusSchema.default("pending"),
  currentPhase: WorkflowPhaseSchema.optional(),
  currentStep: z.string().optional(),
  checkpoints: z.array(z.object({
    phase: WorkflowPhaseSchema,
    step: z.string(),
    timestamp: z.date(),
    state: z.record(z.unknown()),
  })).default([]),
  approvals: z.array(z.object({
    phase: WorkflowPhaseSchema,
    step: z.string(),
    approved: z.boolean(),
    timestamp: z.date(),
    feedback: z.string().optional(),
  })).default([]),
});

export const WorkflowExecutionSchema = z.object({
  planId: z.string(),
  status: PhaseStatusSchema.default("pending"),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
  currentPhase: WorkflowPhaseSchema.optional(),
  currentStep: z.string().optional(),
  progress: z.number().default(0), // 0-100
  logs: z.array(z.object({
    timestamp: z.date(),
    phase: WorkflowPhaseSchema,
    step: z.string(),
    level: z.enum(["info", "warn", "error", "debug"]),
    message: z.string(),
    data: z.record(z.unknown()).optional(),
  })).default([]),
  artifacts: z.array(z.object({
    phase: WorkflowPhaseSchema,
    step: z.string(),
    type: z.string(),
    path: z.string(),
    metadata: z.record(z.unknown()),
  })).default([]),
  errors: z.array(z.object({
    phase: WorkflowPhaseSchema,
    step: z.string(),
    error: z.string(),
    recovered: z.boolean().default(false),
    retryCount: z.number().default(0),
  })).default([]),
});

// ============================================================================
// TYPES
// ============================================================================

export type WorkflowGoal = z.infer<typeof WorkflowGoalSchema>;
export type WorkflowPhase = z.infer<typeof WorkflowPhaseSchema>;
export type PhaseStatus = z.infer<typeof PhaseStatusSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type WorkflowPlan = z.infer<typeof WorkflowPlanSchema>;
export type WorkflowExecution = z.infer<typeof WorkflowExecutionSchema>;

// ============================================================================
// WORKFLOW ORCHESTRATOR CLASS
// ============================================================================

export class WorkflowOrchestrator {
  private plans = new Map<string, WorkflowPlan>();
  private executions = new Map<string, WorkflowExecution>();
  private activeWorktrees = new Map<string, string>(); // executionId -> worktreeId

  // Phase definitions with default steps
  private readonly PHASE_DEFINITIONS: Record<WorkflowPhase, {
    title: string;
    description: string;
    defaultSteps: Omit<WorkflowStep, "id" | "dependencies">[];
    estimatedDuration: number;
    requiresApproval: boolean;
  }> = {
    discover: {
      title: "Requirement Discovery",
      description: "Clarify requirements through targeted questions, generate PRD",
      defaultSteps: [
        {
          phase: "discover",
          title: "Analyze Goal",
          description: "Parse natural language goal, extract key entities and constraints",
          agentType: "architect",
          estimatedDuration: 60,
          qualityGates: ["goal_parsed", "entities_extracted"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
        {
          phase: "discover",
          title: "Generate Clarifying Questions",
          description: "Create up to 5 targeted questions to reduce ambiguity",
          agentType: "architect",
          estimatedDuration: 60,
          qualityGates: ["questions_generated", "max_5_questions"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
        {
          phase: "discover",
          title: "Present Questions & Collect Answers",
          description: "Interactive Q&A with user, store responses",
          agentType: "architect",
          estimatedDuration: 300,
          qualityGates: ["all_answered"],
          checkpoint: true,
          requiresApproval: true, // Human approval needed
          metadata: {},
        },
        {
          phase: "discover",
          title: "Generate PRD",
          description: "Synthesize Product Requirements Document from answers",
          agentType: "architect",
          estimatedDuration: 120,
          qualityGates: ["prd_complete", "prd_validated"],
          checkpoint: true,
          requiresApproval: true, // Human approval needed
          metadata: {},
        },
      ],
      estimatedDuration: 540,
      requiresApproval: true,
    },
    plan: {
      title: "Architecture & Tech Stack Planning",
      description: "Design system architecture, select tech stack, create detailed plan",
      defaultSteps: [
        {
          phase: "plan",
          title: "Recommend Tech Stack",
          description: "Score and recommend framework, database, auth, payments, hosting",
          agentType: "architect",
          estimatedDuration: 60,
          qualityGates: ["stack_scored", "top3_presented"],
          checkpoint: true,
          requiresApproval: true, // Human approval needed
          metadata: {},
        },
        {
          phase: "plan",
          title: "Design Architecture",
          description: "Create system architecture: data models, API design, component hierarchy",
          agentType: "architect",
          estimatedDuration: 180,
          qualityGates: ["architecture_documented", "data_models_defined", "api_contracts_defined"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
        {
          phase: "plan",
          title: "Create Execution Plan",
          description: "Break down into phases, steps, dependencies, estimates",
          agentType: "planner",
          estimatedDuration: 120,
          qualityGates: ["plan_complete", "dependencies_resolved", "estimates_realistic"],
          checkpoint: true,
          requiresApproval: true, // Human approval needed
          metadata: {},
        },
      ],
      estimatedDuration: 360,
      requiresApproval: true,
    },
    scaffold: {
      title: "Project Scaffolding",
      description: "Initialize repository, configuration, base project structure",
      defaultSteps: [
        {
          phase: "scaffold",
          title: "Initialize Repository",
          description: "Create git repo, package.json, tsconfig, framework config",
          agentType: "coder",
          estimatedDuration: 120,
          qualityGates: ["repo_initialized", "config_valid", "build_passes"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
        {
          phase: "scaffold",
          title: "Setup Database & Migrations",
          description: "Configure ORM, create initial schema, run migrations",
          agentType: "coder",
          estimatedDuration: 120,
          qualityGates: ["db_connected", "schema_created", "migrations_run"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
        {
          phase: "scaffold",
          title: "Configure Auth & Environment",
          description: "Setup auth provider, environment variables, secrets",
          agentType: "coder",
          estimatedDuration: 120,
          qualityGates: ["auth_configured", "env_validated", "secrets_stored"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
        {
          phase: "scaffold",
          title: "Setup CI/CD & Deployment Config",
          description: "Generate deployment configs (vercel.json, netlify.toml, etc.)",
          agentType: "deployer",
          estimatedDuration: 60,
          qualityGates: ["deploy_config_valid", "ci_configured"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
      ],
      estimatedDuration: 420,
      requiresApproval: false,
    },
    generate: {
      title: "Code Generation",
      description: "Generate all application code: frontend, backend, database, integrations",
      defaultSteps: [
        {
          phase: "generate",
          title: "Generate Database Layer",
          description: "Create models, repositories, migrations, seed data",
          agentType: "coder",
          estimatedDuration: 300,
          qualityGates: ["models_created", "repositories_typed", "migrations_valid"],
          checkpoint: true,
          requiresApproval: false,
          metadata: { parallel: true },
        },
        {
          phase: "generate",
          title: "Generate API Routes",
          description: "Create REST/GraphQL endpoints, validation, error handling",
          agentType: "coder",
          estimatedDuration: 300,
          qualityGates: ["routes_created", "validation_added", "error_handling"],
          checkpoint: true,
          requiresApproval: false,
          metadata: { parallel: true },
        },
        {
          phase: "generate",
          title: "Generate Auth Integration",
          description: "Implement login, register, session, protected routes, middleware",
          agentType: "coder",
          estimatedDuration: 240,
          qualityGates: ["auth_flows_work", "middleware_added", "protected_routes"],
          checkpoint: true,
          requiresApproval: false,
          metadata: { parallel: true },
        },
        {
          phase: "generate",
          title: "Generate Payment Integration",
          description: "Setup Stripe/LemonSqueezy/Paddle: products, webhooks, checkout",
          agentType: "coder",
          estimatedDuration: 240,
          qualityGates: ["payments_configured", "webhooks_working", "checkout_flow"],
          checkpoint: true,
          requiresApproval: false,
          metadata: { parallel: true },
        },
        {
          phase: "generate",
          title: "Generate Frontend Pages & Components",
          description: "Build all UI pages, components, forms, dashboards using design system",
          agentType: "coder",
          estimatedDuration: 600,
          qualityGates: ["pages_created", "components_reusable", "design_system_synced"],
          checkpoint: true,
          requiresApproval: false,
          metadata: { parallel: true },
        },
        {
          phase: "generate",
          title: "Generate State Management & Data Fetching",
          description: "Setup TanStack Query/SWR, global state, optimistic updates",
          agentType: "coder",
          estimatedDuration: 180,
          qualityGates: ["queries_typed", "mutations_work", "cache_configured"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
        {
          phase: "generate",
          title: "Integrate External Services",
          description: "Connect Linear, Slack, Notion, Sheets, Email, etc.",
          agentType: "coder",
          estimatedDuration: 180,
          qualityGates: ["connectors_configured", "sync_working", "webhooks_registered"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
      ],
      estimatedDuration: 2040,
      requiresApproval: false,
    },
    test: {
      title: "Testing & Quality Assurance",
      description: "Generate and run tests, perform quality checks",
      defaultSteps: [
        {
          phase: "test",
          title: "Generate Unit Tests",
          description: "Create Vitest/Jest tests for all business logic, utilities, hooks",
          agentType: "tester",
          estimatedDuration: 300,
          qualityGates: ["tests_generated", "coverage_above_70", "tests_pass"],
          checkpoint: true,
          requiresApproval: false,
          metadata: { parallel: true },
        },
        {
          phase: "test",
          title: "Generate E2E Tests",
          description: "Create Playwright tests for critical user flows",
          agentType: "tester",
          estimatedDuration: 300,
          qualityGates: ["e2e_created", "critical_flows_covered", "e2e_pass"],
          checkpoint: true,
          requiresApproval: false,
          metadata: { parallel: true },
        },
        {
          phase: "test",
          title: "Run Accessibility Audit",
          description: "axe-core scan, fix WCAG AA violations",
          agentType: "reviewer",
          estimatedDuration: 120,
          qualityGates: ["axe_clean", "wcag_aa_pass"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
        {
          phase: "test",
          title: "TypeScript Strict Check",
          description: "Run tsc --noEmit, fix all type errors",
          agentType: "reviewer",
          estimatedDuration: 120,
          qualityGates: ["typecheck_clean"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
        {
          phase: "test",
          title: "Lint & Format",
          description: "Run ESLint + Prettier, auto-fix violations",
          agentType: "reviewer",
          estimatedDuration: 60,
          qualityGates: ["lint_clean", "format_clean"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
        {
          phase: "test",
          title: "Build Verification",
          description: "Run production build, verify no errors, check bundle size",
          agentType: "reviewer",
          estimatedDuration: 180,
          qualityGates: ["build_passes", "bundle_size_ok", "no_warnings"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
        {
          phase: "test",
          title: "Security Scan",
          description: "Semgrep scan, secret detection, dependency audit",
          agentType: "reviewer",
          estimatedDuration: 120,
          qualityGates: ["no_critical_vulns", "no_secrets", "deps_clean"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
      ],
      estimatedDuration: 1200,
      requiresApproval: false,
    },
    deploy: {
      title: "Deployment",
      description: "Deploy to hosting provider, configure domain, SSL, environment",
      defaultSteps: [
        {
          phase: "deploy",
          title: "Pre-Deployment Validation",
          description: "Final checks: env vars, secrets, build artifacts, health endpoints",
          agentType: "deployer",
          estimatedDuration: 60,
          qualityGates: ["env_complete", "secrets_synced", "health_endpoints_exist"],
          checkpoint: true,
          requiresApproval: true, // Human approval needed
          metadata: {},
        },
        {
          phase: "deploy",
          title: "Deploy to Hosting",
          description: "Execute deployment (Vercel/Netlify/Cloudflare/Railway/Fly)",
          agentType: "deployer",
          estimatedDuration: 180,
          qualityGates: ["deploy_succeeded", "url_accessible"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
        {
          phase: "deploy",
          title: "Configure Custom Domain & SSL",
          description: "Setup custom domain, DNS, SSL certificate",
          agentType: "deployer",
          estimatedDuration: 120,
          qualityGates: ["domain_configured", "ssl_valid", "dns_propagated"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
        {
          phase: "deploy",
          title: "Setup Preview Deployments",
          description: "Configure PR preview deployments, branch previews",
          agentType: "deployer",
          estimatedDuration: 60,
          qualityGates: ["previews_work", "branch_previews"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
        {
          phase: "deploy",
          title: "Configure Environment Variables",
          description: "Sync all secrets and config to production environment",
          agentType: "deployer",
          estimatedDuration: 60,
          qualityGates: ["env_synced", "secrets_injected"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
      ],
      estimatedDuration: 480,
      requiresApproval: true,
    },
    verify: {
      title: "Post-Deploy Verification & Handoff",
      description: "Smoke tests, monitoring setup, generate handoff documentation",
      defaultSteps: [
        {
          phase: "verify",
          title: "Run Smoke Tests",
          description: "Verify critical endpoints, health checks, key user flows",
          agentType: "tester",
          estimatedDuration: 120,
          qualityGates: ["smoke_tests_pass", "health_checks_pass", "critical_flows_work"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
        {
          phase: "verify",
          title: "Setup Error Tracking",
          description: "Configure Sentry (free tier), error boundaries, alerting",
          agentType: "deployer",
          estimatedDuration: 60,
          qualityGates: ["sentry_configured", "errors_captured", "alerts_work"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
        {
          phase: "verify",
          title: "Setup Analytics",
          description: "Configure Plausible/Umami (self-hosted), event tracking",
          agentType: "deployer",
          estimatedDuration: 60,
          qualityGates: ["analytics_configured", "events_tracking"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
        {
          phase: "verify",
          title: "Setup Uptime Monitoring",
          description: "Configure UptimeRobot (free), alerting on downtime",
          agentType: "deployer",
          estimatedDuration: 30,
          qualityGates: ["monitoring_active", "alerts_configured"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
        {
          phase: "verify",
          title: "Generate HANDOFF.md",
          description: "Create architecture doc, credentials (encrypted), runbook, scaling notes",
          agentType: "architect",
          estimatedDuration: 120,
          qualityGates: ["handoff_complete", "credentials_encrypted", "runbook_clear"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
        {
          phase: "verify",
          title: "Create GitHub Repo & CI/CD",
          description: "Initialize GitHub repo, push code, setup CI/CD pipeline",
          agentType: "deployer",
          estimatedDuration: 120,
          qualityGates: ["repo_created", "ci_pipeline_working", "code_pushed"],
          checkpoint: true,
          requiresApproval: false,
          metadata: {},
        },
      ],
      estimatedDuration: 510,
      requiresApproval: false,
    },
  };

  // ============================================================================
  // PUBLIC METHODS
  // ============================================================================

  /**
   * Create a new workflow from a natural language goal
   */
  async createWorkflow(goal: WorkflowGoal): Promise<WorkflowPlan> {
    const planId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Phase 1: Discover - analyze goal and generate clarifying questions
    const discoverResult = await this.runDiscoverPhase(goal);

    // For now, we'll create a plan with placeholder tech stack
    // In reality, this would wait for human answers to clarifying questions
    const techStack = await this.selectTechStack(goal, discoverResult.prd);

    const plan: WorkflowPlan = {
      id: planId,
      goal,
      phases: Object.entries(this.PHASE_DEFINITIONS).map(([phaseKey, def]) => ({
        phase: phaseKey as WorkflowPhase,
        title: def.title,
        description: def.description,
        steps: def.defaultSteps.map((step, i) => ({
          ...step,
          id: `${planId}_${phaseKey}_${i}`,
          dependencies: i > 0 ? [`${planId}_${phaseKey}_${i - 1}`] : [],
        })),
        estimatedDuration: def.estimatedDuration,
        requiresApproval: def.requiresApproval,
      })),
      techStack,
      prd: discoverResult.prd,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: "pending",
      currentPhase: "discover",
      currentStep: undefined,
      checkpoints: [],
      approvals: [],
    };

    this.plans.set(planId, plan);
    this.emitPlanUpdate(planId);

    return plan;
  }

  /**
   * Execute a workflow plan
   */
  async executeWorkflow(planId: string): Promise<WorkflowExecution> {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

    const executionId = `exec_${planId}_${Date.now()}`;
    const execution: WorkflowExecution = {
      planId,
      status: "running",
      startedAt: new Date(),
      currentPhase: plan.phases[0].phase,
      currentStep: undefined,
      progress: 0,
      logs: [],
      artifacts: [],
      errors: [],
    };

    this.executions.set(executionId, execution);

    // Create virtual worktree for this execution
    const worktree = await virtualWorktreeManager.createWorktree("HEAD");
    this.activeWorktrees.set(executionId, worktree.id);

    try {
      // Execute each phase in order
      for (const phase of plan.phases) {
        execution.currentPhase = phase.phase;
        this.log(executionId, phase.phase, "info", `Starting phase: ${phase.title}`);
        this.emitExecutionUpdate(executionId);

        // Check if phase requires approval
        if (phase.requiresApproval) {
          execution.status = "needs_approval";
          this.emitExecutionUpdate(executionId);

          // Wait for approval (in reality, this would be async with webhook/callback)
          const approved = await this.waitForApproval(executionId, phase.phase);
          if (!approved) {
            execution.status = "paused";
            this.log(executionId, phase.phase, "info", "Phase paused awaiting approval");
            return execution;
          }
        }

        // Execute steps in phase (respecting dependencies)
        await this.executePhase(planId, executionId, phase);

        // Save checkpoint after phase
        if (phase.steps.some(s => s.checkpoint)) {
          await this.saveCheckpoint(executionId, phase.phase);
        }
      }

      execution.status = "complete";
      execution.completedAt = new Date();
      execution.progress = 100;
      this.log(executionId, "verify", "info", "Workflow completed successfully!");
      this.emitExecutionUpdate(executionId);

      // Update build map
      await buildMapAgent.analyzeProject(plan.goal.context?.projectId || "");

    } catch (error) {
      execution.status = "error";
      execution.completedAt = new Date();
      this.log(executionId, execution.currentPhase || "unknown", "error", `Workflow failed: ${error}`);
      this.emitExecutionUpdate(executionId);
      throw error;
    } finally {
      // Cleanup worktree
      const worktreeId = this.activeWorktrees.get(executionId);
      if (worktreeId) {
        await virtualWorktreeManager.deleteWorktree(worktreeId);
        this.activeWorktrees.delete(executionId);
      }
    }

    return execution;
  }

  /**
   * Resume workflow from a checkpoint
   */
  async resumeWorkflow(executionId: string, checkpointPhase: WorkflowPhase): Promise<WorkflowExecution> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const plan = this.plans.get(execution.planId);
    if (!plan) {
      throw new Error(`Plan ${execution.planId} not found`);
    }

    // Find checkpoint
    const checkpoint = plan.checkpoints.find(c => c.phase === checkpointPhase);
    if (!checkpoint) {
      throw new Error(`No checkpoint found for phase ${checkpointPhase}`);
    }

    // Restore worktree
    const worktree = await virtualWorktreeManager.createWorktreeFromSnapshot(checkpoint.state);
    this.activeWorktrees.set(executionId, worktree.id);

    execution.status = "running";
    execution.currentPhase = checkpointPhase;
    this.emitExecutionUpdate(executionId);

    // Resume from next phase
    const phaseIndex = plan.phases.findIndex(p => p.phase === checkpointPhase);
    for (let i = phaseIndex + 1; i < plan.phases.length; i++) {
      const phase = plan.phases[i];
      execution.currentPhase = phase.phase;
      this.log(executionId, phase.phase, "info", `Resuming phase: ${phase.title}`);
      this.emitExecutionUpdate(executionId);

      if (phase.requiresApproval) {
        execution.status = "needs_approval";
        this.emitExecutionUpdate(executionId);
        const approved = await this.waitForApproval(executionId, phase.phase);
        if (!approved) {
          execution.status = "paused";
          return execution;
        }
      }

      await this.executePhase(execution.planId, executionId, phase);

      if (phase.steps.some(s => s.checkpoint)) {
        await this.saveCheckpoint(executionId, phase.phase);
      }
    }

    execution.status = "complete";
    execution.completedAt = new Date();
    execution.progress = 100;
    this.emitExecutionUpdate(executionId);

    return execution;
  }

  /**
   * Approve or reject a pending approval
   */
  async handleApproval(executionId: string, phase: WorkflowPhase, approved: boolean, feedback?: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) throw new Error(`Execution ${executionId} not found`);

    const plan = this.plans.get(execution.planId);
    if (!plan) throw new Error(`Plan ${execution.planId} not found`);

    plan.approvals.push({
      phase,
      step: execution.currentStep || "",
      approved,
      timestamp: new Date(),
      feedback,
    });
    plan.updatedAt = new Date();

    if (approved) {
      execution.status = "running";
    } else {
      execution.status = "paused";
    }

    this.emitPlanUpdate(execution.planId);
    this.emitExecutionUpdate(executionId);
  }

  /**
   * Get workflow plan by ID
   */
  getPlan(planId: string): WorkflowPlan | undefined {
    return this.plans.get(planId);
  }

  /**
   * Get workflow execution by ID
   */
  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.executions.get(executionId);
  }

  /**
   * List all workflow plans
   */
  listPlans(): WorkflowPlan[] {
    return Array.from(this.plans.values());
  }

  /**
   * List all workflow executions
   */
  listExecutions(): WorkflowExecution[] {
    return Array.from(this.executions.values());
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async runDiscoverPhase(goal: WorkflowGoal): Promise<{ prd: string; questions: string[] }> {
    // Use the planner subagent to analyze the goal and generate questions
    const planner = subagents.getSubagent("planner");
    if (!planner) throw new Error("Planner subagent not available");

    const analysisPrompt = `
Analyze this project goal and:
1. Extract key entities, features, and constraints
2. Generate up to 5 clarifying questions to reduce ambiguity
3. Draft a preliminary Product Requirements Document (PRD)

Goal: ${goal.goal}
Constraints: ${JSON.stringify(goal.constraints || {})}
Context: ${JSON.stringify(goal.context || {})}

Return JSON with:
{
  "entities": string[],
  "features": string[],
  "constraints": Record<string, unknown>,
  "questions": string[],
  "prd": string
}
`;

    const result = await planner.spawn({ prompt: analysisPrompt, schema: z.object({
      entities: z.array(z.string()),
      features: z.array(z.string()),
      constraints: z.record(z.unknown()),
      questions: z.array(z.string()).max(5),
      prd: z.string(),
    }) });

    return {
      prd: result.prd,
      questions: result.questions,
    };
  }

  private async selectTechStack(goal: WorkflowGoal, prd: string): Promise<WorkflowPlan["techStack"]> {
    // Use architect subagent to recommend tech stack
    const architect = subagents.getSubagent("architect") || subagents.getSubagent("planner");
    if (!architect) throw new Error("Architect subagent not available");

    const prompt = `
Based on this PRD and goal, recommend the optimal tech stack.
Score each option and present top 3 with rationale.

PRD: ${prd}
Goal: ${goal.goal}
User Preferences: ${JSON.stringify(goal.constraints || {})}

Categories to decide:
1. Framework: nextjs, astro, remix, vite-react, sveltekit, nuxt, solidstart
2. Database: postgresql, sqlite, mongodb, firebase, none
3. Auth: clerk, authjs, supabase, custom, none
4. Payments: stripe, lemonsqueezy, paddle, none
5. Hosting: vercel, netlify, cloudflare, railway, fly, none

Return JSON with:
{
  "framework": { "choice": string, "rationale": string, "score": number },
  "database": { "choice": string, "rationale": string, "score": number },
  "auth": { "choice": string, "rationale": string, "score": number },
  "payments": { "choice": string, "rationale": string, "score": number },
  "hosting": { "choice": string, "rationale": string, "score": number },
  "overallRationale": string
}
`;

    const result = await architect.spawn({ prompt, schema: z.object({
      framework: z.object({ choice: z.string(), rationale: z.string(), score: z.number() }),
      database: z.object({ choice: z.string(), rationale: z.string(), score: z.number() }),
      auth: z.object({ choice: z.string(), rationale: z.string(), score: z.number() }),
      payments: z.object({ choice: z.string(), rationale: z.string(), score: z.number() }),
      hosting: z.object({ choice: z.string(), rationale: z.string(), score: z.number() }),
      overallRationale: z.string(),
    }) });

    return {
      framework: result.framework.choice,
      database: result.database.choice,
      auth: result.auth.choice,
      payments: result.payments.choice,
      hosting: result.hosting.choice,
      rationale: result.overallRationale,
    };
  }

  private async executePhase(planId: string, executionId: string, phase: WorkflowPlan["phases"][0]): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) throw new Error(`Execution ${executionId} not found`);

    // Topological sort steps by dependencies
    const sortedSteps = this.topologicalSort(phase.steps);

    // Group parallelizable steps
    const parallelGroups = this.groupParallelSteps(sortedSteps);

    for (const group of parallelGroups) {
      // Execute group in parallel
      await Promise.all(group.map(step => this.executeStep(planId, executionId, step)));
    }
  }

  private async executeStep(planId: string, executionId: string, step: WorkflowStep): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) throw new Error(`Execution ${executionId} not found`);

    execution.currentStep = step.id;
    this.log(executionId, step.phase, "info", `Starting step: ${step.title}`);
    this.emitExecutionUpdate(executionId);

    let retries = 0;
    while (retries <= step.maxRetries) {
      try {
        const worktreeId = this.activeWorktrees.get(executionId);
        if (!worktreeId) throw new Error("No worktree for execution");

        // Spawn appropriate agent for this step
        const result = await this.runAgentForStep(step, worktreeId, planId, executionId);

        // Run quality gates
        await this.runQualityGates(step, worktreeId, result);

        // Record artifact if any
        if (result.artifacts) {
          for (const artifact of result.artifacts) {
            execution.artifacts.push({
              phase: step.phase,
              step: step.id,
              type: artifact.type,
              path: artifact.path,
              metadata: artifact.metadata,
            });
          }
        }

        this.log(executionId, step.phase, "info", `Completed step: ${step.title}`);
        this.updateProgress(executionId);
        this.emitExecutionUpdate(executionId);
        return;

      } catch (error) {
        retries++;
        this.log(executionId, step.phase, "warn", `Step failed (attempt ${retries}/${step.maxRetries}): ${error}`);

        if (retries > step.maxRetries) {
          execution.errors.push({
            phase: step.phase,
            step: step.id,
            error: String(error),
            recovered: false,
            retryCount: retries - 1,
          });
          throw error;
        }

        // Wait before retry
        await new Promise(r => setTimeout(r, 5000 * retries));
      }
    }
  }

  private async runAgentForStep(
    step: WorkflowStep,
    worktreeId: string,
    planId: string,
    executionId: string
  ): Promise<{ artifacts?: Array<{ type: string; path: string; metadata: Record<string, unknown> }> }> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    // Build context for the agent
    const context = {
      plan: plan.goal,
      techStack: plan.techStack,
      prd: plan.prd,
      currentPhase: step.phase,
      currentStep: step,
      worktreeId,
    };

    // Use appropriate agent based on step type
    let agentPrompt = "";
    let agentType = step.agentType;

    switch (step.agentType) {
      case "architect":
        agentPrompt = `You are a software architect. ${step.description}
Context: ${JSON.stringify(context, null, 2)}
Execute this step and return any artifacts created.`;
        break;
      case "planner":
        agentPrompt = `You are a task planner. ${step.description}
Context: ${JSON.stringify(context, null, 2)}
Create detailed sub-tasks and execution order.`;
        break;
      case "coder":
        agentPrompt = `You are a senior developer. ${step.description}
Context: ${JSON.stringify(context, null, 2)}
Tech Stack: ${JSON.stringify(plan.techStack, null, 2)}
Write production-quality code. Return file paths created.`;
        break;
      case "reviewer":
        agentPrompt = `You are a code reviewer. ${step.description}
Context: ${JSON.stringify(context, null, 2)}
Review the code for quality, security, performance. Return findings.`;
        break;
      case "tester":
        agentPrompt = `You are a QA engineer. ${step.description}
Context: ${JSON.stringify(context, null, 2)}
Write and run tests. Return test results.`;
        break;
      case "deployer":
        agentPrompt = `You are a DevOps engineer. ${step.description}
Context: ${JSON.stringify(context, null, 2)}
Execute deployment steps. Return deployment status.`;
        break;
    }

    // Use universal agent with orchestration for complex steps
    const agent = universalAgent;
    const result = await agent.run({
      prompt: agentPrompt,
      context: { worktreeId, planId, executionId },
      enableOrchestration: true,
      maxIterations: 10,
      tokenBudget: 100000,
    });

    // Parse result for artifacts
    const artifacts = this.extractArtifacts(result);

    return { artifacts };
  }

  private async runQualityGates(step: WorkflowStep, worktreeId: string, result: any): Promise<void> {
    for (const gate of step.qualityGates) {
      // Run specific quality gate checks
      switch (gate) {
        case "build_passes":
          // Run build command in worktree
          break;
        case "typecheck_clean":
          // Run tsc --noEmit
          break;
        case "tests_pass":
          // Run test suite
          break;
        case "lint_clean":
          // Run eslint
          break;
        case "axe_clean":
          // Run accessibility audit
          break;
        // ... more gates
      }
    }
  }

  private topologicalSort(steps: WorkflowStep[]): WorkflowStep[] {
    const visited = new Set<string>();
    const result: WorkflowStep[] = [];
    const stepMap = new Map(steps.map(s => [s.id, s]));

    const visit = (stepId: string) => {
      if (visited.has(stepId)) return;
      const step = stepMap.get(stepId);
      if (!step) return;

      for (const dep of step.dependencies) {
        visit(dep);
      }
      visited.add(stepId);
      result.push(step);
    };

    for (const step of steps) {
      visit(step.id);
    }

    return result;
  }

  private groupParallelSteps(steps: WorkflowStep[]): WorkflowStep[][] {
    const groups: WorkflowStep[][] = [];
    const remaining = new Set(steps.map(s => s.id));
    const stepMap = new Map(steps.map(s => [s.id, s]));

    while (remaining.size > 0) {
      const group: WorkflowStep[] = [];
      for (const stepId of remaining) {
        const step = stepMap.get(stepId)!;
        const depsMet = step.dependencies.every(d => !remaining.has(d));
        const isParallel = step.metadata.parallel === true;

        if (depsMet && (isParallel || step.dependencies.length === 0)) {
          group.push(step);
        }
      }

      if (group.length === 0) {
        // No parallel steps available, take the first one with met deps
        for (const stepId of remaining) {
          const step = stepMap.get(stepId)!;
          if (step.dependencies.every(d => !remaining.has(d))) {
            group.push(step);
            break;
          }
        }
      }

      for (const step of group) {
        remaining.delete(step.id);
      }
      groups.push(group);
    }

    return groups;
  }

  private async saveCheckpoint(executionId: string, phase: WorkflowPhase): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) return;

    const worktreeId = this.activeWorktrees.get(executionId);
    if (!worktreeId) return;

    const snapshot = await virtualWorktreeManager.getSnapshot(worktreeId);

    const plan = this.plans.get(execution.planId);
    if (plan) {
      plan.checkpoints.push({
        phase,
        step: execution.currentStep || "",
        timestamp: new Date(),
        state: snapshot,
      });
      plan.updatedAt = new Date();
      this.emitPlanUpdate(execution.planId);
    }
  }

  private async waitForApproval(executionId: string, phase: WorkflowPhase): Promise<boolean> {
    // In real implementation, this would wait for a webhook/callback
    // For now, we'll simulate with a timeout and event
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 300000); // 5 min timeout

      const handler = (event: any) => {
        if (event.executionId === executionId && event.phase === phase) {
          clearTimeout(timeout);
          eventEmitter.off("workflow:approval", handler);
          resolve(event.approved);
        }
      };

      eventEmitter.on("workflow:approval", handler);
    });
  }

  private extractArtifacts(result: any): Array<{ type: string; path: string; metadata: Record<string, unknown> }> {
    // Extract file paths and artifacts from agent result
    const artifacts: Array<{ type: string; path: string; metadata: Record<string, unknown> }> = [];

    if (result.files) {
      for (const file of result.files) {
        artifacts.push({
          type: "file",
          path: file.path,
          metadata: { content: file.content, language: file.language },
        });
      }
    }

    return artifacts;
  }

  private updateProgress(executionId: string): void {
    const execution = this.executions.get(executionId);
    const plan = this.plans.get(execution?.planId || "");
    if (!execution || !plan) return;

    let totalSteps = 0;
    let completedSteps = 0;

    for (const phase of plan.phases) {
      for (const step of phase.steps) {
        totalSteps++;
        // Check if step is completed (simplified)
        if (execution.artifacts.some(a => a.step === step.id)) {
          completedSteps++;
        }
      }
    }

    execution.progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  }

  private log(
    executionId: string,
    phase: WorkflowPhase,
    level: "info" | "warn" | "error" | "debug",
    message: string,
    data?: Record<string, unknown>
  ): void {
    const execution = this.executions.get(executionId);
    if (!execution) return;

    execution.logs.push({
      timestamp: new Date(),
      phase,
      step: execution.currentStep || "unknown",
      level,
      message,
      data,
    });
  }

  private emitPlanUpdate(planId: string): void {
    const plan = this.plans.get(planId);
    if (plan) {
      eventEmitter.emit("workflow:plan_update", { planId, plan });
    }
  }

  private emitExecutionUpdate(executionId: string): void {
    const execution = this.executions.get(executionId);
    if (execution) {
      eventEmitter.emit("workflow:execution_update", { executionId, execution });
    }
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const workflowOrchestrator = new WorkflowOrchestrator();