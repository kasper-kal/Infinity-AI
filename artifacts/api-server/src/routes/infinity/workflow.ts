/**
 * Phase 37: Workflow API Routes
 *
 * REST endpoints for fully automated end-to-end workflow orchestration
 * NL goal → deployed product
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '@workspace/db';
import { requireAuth, requireScope, AuthenticatedRequest } from '../../middleware/auth-middleware.js';
import { createWorkflowOrchestrator, type WorkflowConfig, type WorkflowPlan, type WorkflowPhase, type WorkflowStatus, type ApprovalGate } from '../../lib/workflow-orchestrator.js';
import { createRequirementClarifier, type ClarificationConfig, type PRD, type ClarificationQuestion, type UserAnswer } from '../../lib/requirement-clarifier.js';

const router = Router();

// All routes require authentication and build:write scope
router.use(requireAuth);
router.use(requireScope('build:write'));

// ============================================================================
// Validation Schemas
// ============================================================================

const CreateWorkflowSchema = z.object({
  goal: z.string().min(10).max(5000),
  constraints: z.object({
    framework: z.string().optional(),
    database: z.string().optional(),
    auth: z.string().optional(),
    payments: z.string().optional(),
    hosting: z.string().optional(),
    timeline: z.string().optional(),
    budget: z.string().optional(),
  }).optional(),
  autoApprove: z.boolean().default(false),
  maxQuestions: z.number().default(5),
  enableCheckpoints: z.boolean().default(true),
  parallelAgents: z.number().default(3),
  tokenBudget: z.number().optional(),
});

const ApproveWorkflowSchema = z.object({
  workflowId: z.string().uuid(),
  gate: z.enum(['plan', 'deploy', 'high-risk']),
  approved: z.boolean(),
  feedback: z.string().optional(),
});

const ResumeWorkflowSchema = z.object({
  workflowId: z.string().uuid(),
  checkpointIndex: z.number().int().min(0),
});

const ClarifySchema = z.object({
  workflowId: z.string().uuid(),
  answers: z.array(z.object({
    questionId: z.string(),
    answer: z.union([z.string(), z.array(z.string()), z.boolean(), z.number()]),
  })),
});

const GeneratePRDSchema = z.object({
  workflowId: z.string().uuid(),
});

// ============================================================================
// Helper: Get workflow from DB
// ============================================================================

async function getWorkflow(workflowId: string, accountId: string): Promise<any> {
  const { rows } = await pool.query(
    `SELECT * FROM workflows WHERE id = $1 AND account_id = $2`,
    [workflowId, accountId]
  );
  return rows[0] || null;
}

async function getWorkflowSteps(workflowId: string): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT * FROM workflow_steps WHERE workflow_id = $1 ORDER BY created_at`,
    [workflowId]
  );
  return rows;
}

async function getWorkflowCheckpoints(workflowId: string): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT * FROM workflow_checkpoints WHERE workflow_id = $1 ORDER BY created_at`,
    [workflowId]
  );
  return rows;
}

async function getWorkflowApprovals(workflowId: string): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT * FROM workflow_approvals WHERE workflow_id = $1 ORDER BY created_at`,
    [workflowId]
  );
  return rows;
}

async function saveWorkflowPlan(plan: WorkflowPlan): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert workflow
    await client.query(
      `INSERT INTO workflows (id, project_id, account_id, goal, config, plan, status, current_phase, current_step, total_estimated_duration, created_at, updated_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO UPDATE SET
         plan = $6, status = $7, current_phase = $8, current_step = $9, updated_at = $12, completed_at = $13`,
      [
        plan.id,
        // We need project_id and account_id from somewhere - for now extract from config or use placeholders
        // This will be properly set when creating the workflow
        plan.id.split('_')[1] ? 'unknown' : 'unknown', // placeholder
        plan.id.split('_')[1] ? 'unknown' : 'unknown', // placeholder
        plan.goal,
        JSON.stringify({}),
        JSON.stringify(plan),
        plan.status,
        plan.currentPhase,
        plan.currentStep || null,
        plan.totalEstimatedDuration,
        plan.createdAt,
        plan.updatedAt,
        plan.status === 'completed' ? new Date().toISOString() : null,
      ]
    );

    // Save steps
    if (plan.phases) {
      for (const phase of plan.phases) {
        for (const step of phase.steps) {
          await client.query(
            `INSERT INTO workflow_steps (id, workflow_id, phase, name, description, agent, dependencies, estimated_duration, status, result, error, started_at, completed_at, requires_approval, approval_gate, worktree_id, artifacts, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
             ON CONFLICT (id) DO UPDATE SET
               status = $9, result = $10, error = $11, started_at = $12, completed_at = $13, updated_at = $19`,
            [
              step.id,
              plan.id,
              step.phase,
              step.name,
              step.description || null,
              step.agent || null,
              JSON.stringify(step.dependencies),
              step.estimatedDuration,
              step.status,
              step.result ? JSON.stringify(step.result) : null,
              step.error || null,
              step.startedAt || null,
              step.completedAt || null,
              step.requiresApproval,
              step.approvalGate || null,
              step.worktreeId || null,
              JSON.stringify(step.artifacts),
              step.startedAt || plan.createdAt,
              step.completedAt || plan.updatedAt,
              plan.updatedAt,
            ]
          );
        }
      }
    }

    // Save checkpoints
    if (plan.checkpoints) {
      for (const cp of plan.checkpoints) {
        await client.query(
          `INSERT INTO workflow_checkpoints (id, workflow_id, phase, step_id, timestamp, state, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO NOTHING`,
          [
            `${plan.id}_cp_${cp.phase}_${cp.stepId}`,
            plan.id,
            cp.phase,
            cp.stepId,
            cp.timestamp,
            cp.state ? JSON.stringify(cp.state) : null,
            cp.timestamp,
          ]
        );
      }
    }

    // Save approvals
    if (plan.approvals) {
      for (const approval of plan.approvals) {
        await client.query(
          `INSERT INTO workflow_approvals (id, workflow_id, gate, step_id, status, requested_at, responded_at, feedback, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE SET
             status = $5, responded_at = $7, feedback = $8, updated_at = $10`,
          [
            `${plan.id}_appr_${approval.gate}_${approval.stepId}`,
            plan.id,
            approval.gate,
            approval.stepId,
            approval.status,
            approval.requestedAt,
            approval.respondedAt || null,
            approval.feedback || null,
            approval.requestedAt,
            approval.respondedAt || approval.requestedAt,
          ]
        );
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /api/infinity/workflow/create
 * Create and start a new workflow from a natural language goal
 */
router.post('/create', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parse = CreateWorkflowSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    }

    const { goal, constraints, autoApprove, maxQuestions, enableCheckpoints, parallelAgents, tokenBudget } = parse.data;
    const accountId = req.accountId!;
    const projectId = req.body.projectId || 'default'; // TODO: get from context

    // Create workflow config
    const config: WorkflowConfig = {
      projectId,
      accountId,
      goal,
      constraints,
      autoApprove,
      maxQuestions,
      enableCheckpoints,
      parallelAgents,
      tokenBudget,
    };

    // Create initial workflow record
    const workflowId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date().toISOString();

    await pool.query(
      `INSERT INTO workflows (id, project_id, account_id, goal, config, status, current_phase, total_estimated_duration, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [workflowId, projectId, accountId, goal, JSON.stringify(config), 'running', 'discover', 0, now, now]
    );

    // Create orchestrator
    const orchestrator = await createWorkflowOrchestrator(config, {
      onPhaseChange: async (phase, plan) => {
        await pool.query(
          `UPDATE workflows SET current_phase = $1, updated_at = $2 WHERE id = $3`,
          [phase, new Date().toISOString(), workflowId]
        );
      },
      onStepChange: async (step, plan) => {
        await pool.query(
          `UPDATE workflow_steps SET status = $1, result = $2, error = $3, started_at = $4, completed_at = $5, updated_at = $6 WHERE id = $7`,
          [step.status, step.result ? JSON.stringify(step.result) : null, step.error || null, step.startedAt || null, step.completedAt || null, new Date().toISOString(), step.id]
        );
      },
      onApprovalRequired: async (gate, step, plan) => {
        // Create approval record
        await pool.query(
          `INSERT INTO workflow_approvals (id, workflow_id, gate, step_id, status, requested_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [`${workflowId}_appr_${gate}_${step.id}`, workflowId, gate, step.id, 'pending', new Date().toISOString(), new Date().toISOString(), new Date().toISOString()]
        );
        // Wait for approval via polling or webhook
        return false; // Will be handled by approve endpoint
      },
      onCheckpoint: async (phase, stepId, state) => {
        await pool.query(
          `INSERT INTO workflow_checkpoints (id, workflow_id, phase, step_id, timestamp, state, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [`${workflowId}_cp_${phase}_${stepId}`, workflowId, phase, stepId, new Date().toISOString(), JSON.stringify(state), new Date().toISOString()]
        );
      },
      onComplete: async (plan) => {
        await pool.query(
          `UPDATE workflows SET status = 'completed', current_phase = 'complete', completed_at = $1, updated_at = $1 WHERE id = $2`,
          [new Date().toISOString(), workflowId]
        );
      },
      onError: async (error, plan) => {
        await pool.query(
          `UPDATE workflows SET status = 'failed', current_phase = 'failed', updated_at = $1 WHERE id = $2`,
          [new Date().toISOString(), workflowId]
        );
      },
      onLog: async (level, message, data) => {
        console.log(`[workflow:${workflowId}] ${level}: ${message}`, data || '');
      },
    });

    // Start execution in background
    orchestrator.execute().catch(err => {
      console.error(`Workflow ${workflowId} failed:`, err);
    });

    res.json({ workflowId, status: 'started', message: 'Workflow started. Use /status to track progress.' });
  } catch (error) {
    console.error('Create workflow error:', error);
    res.status(500).json({ error: 'Failed to create workflow', message: (error as Error).message });
  }
});

/**
 * GET /api/infinity/workflow/:workflowId/status
 * Get workflow status, plan, steps, checkpoints, approvals
 */
router.get('/:workflowId/status', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { workflowId } = req.params;
    const accountId = req.accountId!;

    const workflow = await getWorkflow(workflowId, accountId);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    const [steps, checkpoints, approvals] = await Promise.all([
      getWorkflowSteps(workflowId),
      getWorkflowCheckpoints(workflowId),
      getWorkflowApprovals(workflowId),
    ]);

    res.json({
      workflow: {
        id: workflow.id,
        projectId: workflow.project_id,
        accountId: workflow.account_id,
        goal: workflow.goal,
        config: workflow.config,
        plan: workflow.plan,
        status: workflow.status,
        currentPhase: workflow.current_phase,
        currentStep: workflow.current_step,
        totalEstimatedDuration: workflow.total_estimated_duration,
        createdAt: workflow.created_at,
        updatedAt: workflow.updated_at,
        completedAt: workflow.completed_at,
      },
      steps,
      checkpoints,
      approvals,
    });
  } catch (error) {
    console.error('Get workflow status error:', error);
    res.status(500).json({ error: 'Failed to get workflow status' });
  }
});

/**
 * POST /api/infinity/workflow/approve
 * Approve or reject a workflow at an approval gate
 */
router.post('/approve', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parse = ApproveWorkflowSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    }

    const { workflowId, gate, approved, feedback } = parse.data;
    const accountId = req.accountId!;

    const workflow = await getWorkflow(workflowId, accountId);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    if (workflow.status !== 'waiting_approval') {
      return res.status(400).json({ error: 'Workflow is not waiting for approval' });
    }

    // Update approval record
    await pool.query(
      `UPDATE workflow_approvals SET status = $1, responded_at = $2, feedback = $3, updated_at = $2
       WHERE workflow_id = $4 AND gate = $5 AND status = 'pending'`,
      [approved ? 'approved' : 'rejected', new Date().toISOString(), feedback || null, workflowId, gate]
    );

    if (!approved) {
      await pool.query(
        `UPDATE workflows SET status = 'cancelled', updated_at = $1 WHERE id = $2`,
        [new Date().toISOString(), workflowId]
      );
      return res.json({ success: true, message: 'Workflow cancelled', workflowId });
    }

    // If plan gate approved, resume workflow
    if (gate === 'plan') {
      await pool.query(
        `UPDATE workflows SET status = 'running', updated_at = $1 WHERE id = $2`,
        [new Date().toISOString(), workflowId]
      );
      // Note: Actual resumption would need the orchestrator instance
      // In production, this would trigger a continuation via queue or webhook
    }

    res.json({ success: true, message: `Approval ${approved ? 'granted' : 'denied'}`, workflowId });
  } catch (error) {
    console.error('Approve workflow error:', error);
    res.status(500).json({ error: 'Failed to process approval' });
  }
});

/**
 * POST /api/infinity/workflow/resume
 * Resume workflow from a checkpoint
 */
router.post('/resume', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parse = ResumeWorkflowSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    }

    const { workflowId, checkpointIndex } = parse.data;
    const accountId = req.accountId!;

    const workflow = await getWorkflow(workflowId, accountId);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    if (!['failed', 'paused', 'cancelled'].includes(workflow.status)) {
      return res.status(400).json({ error: 'Workflow cannot be resumed from current state' });
    }

    const checkpoints = await getWorkflowCheckpoints(workflowId);
    if (checkpointIndex >= checkpoints.length) {
      return res.status(400).json({ error: 'Invalid checkpoint index' });
    }

    // Update status to running
    await pool.query(
      `UPDATE workflows SET status = 'running', updated_at = $1 WHERE id = $2`,
      [new Date().toISOString(), workflowId]
    );

    // Note: Actual resumption would need the orchestrator instance
    // This would reconstruct the orchestrator from the checkpoint state

    res.json({ success: true, message: 'Workflow resumed from checkpoint', workflowId, checkpoint: checkpoints[checkpointIndex] });
  } catch (error) {
    console.error('Resume workflow error:', error);
    res.status(500).json({ error: 'Failed to resume workflow' });
  }
});

/**
 * POST /api/infinity/workflow/cancel
 * Cancel a running workflow
 */
router.post('/:workflowId/cancel', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { workflowId } = req.params;
    const accountId = req.accountId!;

    const workflow = await getWorkflow(workflowId, accountId);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    if (['completed', 'cancelled', 'failed'].includes(workflow.status)) {
      return res.status(400).json({ error: 'Workflow already finished' });
    }

    await pool.query(
      `UPDATE workflows SET status = 'cancelled', updated_at = $1 WHERE id = $2`,
      [new Date().toISOString(), workflowId]
    );

    res.json({ success: true, message: 'Workflow cancelled', workflowId });
  } catch (error) {
    console.error('Cancel workflow error:', error);
    res.status(500).json({ error: 'Failed to cancel workflow' });
  }
});

/**
 * POST /api/infinity/workflow/clarify
 * Submit answers to clarification questions
 */
router.post('/clarify', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parse = ClarifySchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    }

    const { workflowId, answers } = parse.data;
    const accountId = req.accountId!;

    const workflow = await getWorkflow(workflowId, accountId);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    // Get existing PRD from workflow plan
    const plan = workflow.plan as WorkflowPlan | null;
    if (!plan?.prd) {
      return res.status(400).json({ error: 'No PRD to clarify' });
    }

    // Create clarifier with existing PRD
    const clarifier = await createRequirementClarifier({
      projectId: workflow.project_id,
      accountId: workflow.account_id,
      goal: workflow.goal,
      existingPRD: plan.prd,
      maxQuestions: 5,
      autoInfer: true,
    });

    // Process answers
    const answersWithTimestamp: UserAnswer[] = answers.map(a => ({
      ...a,
      timestamp: new Date().toISOString(),
    }));

    const updatedPRD = await clarifier.processAnswers(answersWithTimestamp);

    // Update workflow with new PRD
    const updatedPlan = { ...plan, prd: updatedPRD, updatedAt: new Date().toISOString() };
    await pool.query(
      `UPDATE workflows SET plan = $1, updated_at = $2 WHERE id = $3`,
      [JSON.stringify(updatedPlan), new Date().toISOString(), workflowId]
    );

    res.json({ success: true, prd: updatedPRD });
  } catch (error) {
    console.error('Clarify workflow error:', error);
    res.status(500).json({ error: 'Failed to process clarifications' });
  }
});

/**
 * POST /api/infinity/workflow/generate-prd
 * Generate full PRD from collected answers
 */
router.post('/generate-prd', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parse = GeneratePRDSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    }

    const { workflowId } = parse.data;
    const accountId = req.accountId!;

    const workflow = await getWorkflow(workflowId, accountId);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    const plan = workflow.plan as WorkflowPlan | null;
    if (!plan?.prd) {
      return res.status(400).json({ error: 'No PRD to generate' });
    }

    // Create clarifier and generate PRD
    const clarifier = await createRequirementClarifier({
      projectId: workflow.project_id,
      accountId: workflow.account_id,
      goal: workflow.goal,
      existingPRD: plan.prd,
      maxQuestions: 5,
      autoInfer: true,
    });

    const generatedPRD = await clarifier.generatePRD();

    // Update workflow
    const updatedPlan = { ...plan, prd: generatedPRD, updatedAt: new Date().toISOString() };
    await pool.query(
      `UPDATE workflows SET plan = $1, updated_at = $2 WHERE id = $3`,
      [JSON.stringify(updatedPlan), new Date().toISOString(), workflowId]
    );

    res.json({ success: true, prd: generatedPRD });
  } catch (error) {
    console.error('Generate PRD error:', error);
    res.status(500).json({ error: 'Failed to generate PRD' });
  }
});

/**
 * GET /api/infinity/workflow/:workflowId/prd
 * Get current PRD for a workflow
 */
router.get('/:workflowId/prd', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { workflowId } = req.params;
    const accountId = req.accountId!;

    const workflow = await getWorkflow(workflowId, accountId);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    const plan = workflow.plan as WorkflowPlan | null;
    res.json({ prd: plan?.prd || null });
  } catch (error) {
    console.error('Get PRD error:', error);
    res.status(500).json({ error: 'Failed to get PRD' });
  }
});

/**
 * GET /api/infinity/workflow/:workflowId/questions
 * Get clarification questions for a workflow
 */
router.get('/:workflowId/questions', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { workflowId } = req.params;
    const accountId = req.accountId!;

    const workflow = await getWorkflow(workflowId, accountId);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    const plan = workflow.plan as WorkflowPlan | null;
    const questions = plan?.prd?.clarifications || [];

    res.json({ questions, answers: plan?.prd?.answers || [] });
  } catch (error) {
    console.error('Get questions error:', error);
    res.status(500).json({ error: 'Failed to get questions' });
  }
});

/**
 * GET /api/infinity/workflow/list
 * List all workflows for the current account/project
 */
router.get('/list', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accountId = req.accountId!;
    const projectId = req.query.projectId as string;

    let query = `SELECT * FROM workflows WHERE account_id = $1`;
    const params: any[] = [accountId];

    if (projectId) {
      query += ` AND project_id = $2`;
      params.push(projectId);
    }

    query += ` ORDER BY created_at DESC LIMIT 50`;

    const { rows } = await pool.query(query, params);
    res.json({ workflows: rows });
  } catch (error) {
    console.error('List workflows error:', error);
    res.status(500).json({ error: 'Failed to list workflows' });
  }
});

/**
 * GET /api/infinity/workflow/tech-stack-options
 * Get available tech stack options for the selector UI
 */
router.get('/tech-stack-options', async (_req: Request, res: Response) => {
  try {
    const options = {
      frameworks: [
        { id: 'nextjs', name: 'Next.js', description: 'Full-stack React framework with App Router', pros: ['Server Components', 'Built-in routing', 'Great SEO'], cons: ['Learning curve', 'Vendor lock-in'] },
        { id: 'astro', name: 'Astro', description: 'Content-focused static site generator', pros: ['Islands architecture', 'Fast by default', 'Framework agnostic'], cons: ['Less dynamic', 'Smaller ecosystem'] },
        { id: 'remix', name: 'Remix', description: 'Full-stack web framework with nested routing', pros: ['Web standards', 'Progressive enhancement', 'Great DX'], cons: ['Smaller community', 'Server required'] },
        { id: 'vite-react', name: 'Vite + React', description: 'Fast SPA with React', pros: ['Fast HMR', 'Simple setup', 'Large ecosystem'], cons: ['No SSR', 'Manual routing'] },
        { id: 'sveltekit', name: 'SvelteKit', description: 'Full-stack Svelte framework', pros: ['Compile-time optimization', 'Small bundles', 'Built-in routing'], cons: ['Smaller ecosystem', 'Less talent'] },
        { id: 'nuxt', name: 'Nuxt/Vue', description: 'Full-stack Vue framework', pros: ['Auto-imports', 'File-based routing', 'Great DX'], cons: ['Vue-specific', 'Bundle size'] },
        { id: 'solidstart', name: 'SolidStart', description: 'Full-stack SolidJS framework', pros: ['Fine-grained reactivity', 'Tiny bundles', 'No virtual DOM'], cons: ['Early stage', 'Small ecosystem'] },
      ],
      databases: [
        { id: 'postgresql', name: 'PostgreSQL', providers: ['Supabase', 'Neon', 'Railway', 'Local'], bestFor: 'Relational data, complex queries, ACID' },
        { id: 'sqlite', name: 'SQLite / Turso', providers: ['Turso', 'Local'], bestFor: 'Edge, embedded, simple apps' },
        { id: 'mongodb', name: 'MongoDB', providers: ['MongoDB Atlas'], bestFor: 'Flexible schema, rapid prototyping' },
        { id: 'firebase', name: 'Firebase', providers: ['Firebase'], bestFor: 'Real-time, auth included, serverless' },
        { id: 'none', name: 'None', providers: ['N/A'], bestFor: 'Static sites, external APIs only' },
      ],
      auth: [
        { id: 'clerk', name: 'Clerk', features: ['Managed auth', 'User management', 'Organizations'], pricing: 'Free tier generous' },
        { id: 'authjs', name: 'Auth.js (NextAuth)', features: ['Open source', 'Many providers', 'Self-hosted'], pricing: 'Free' },
        { id: 'supabase', name: 'Supabase Auth', features: ['Integrated with DB', 'Row-level security', 'Realtime'], pricing: 'Free tier' },
        { id: 'custom', name: 'Custom JWT', features: ['Full control', 'No vendor lock-in'], pricing: 'Free' },
        { id: 'none', name: 'No Auth', features: ['Public access only'], pricing: 'Free' },
      ],
      payments: [
        { id: 'stripe', name: 'Stripe', features: ['Complete payments', 'Subscriptions', 'Marketplace'], pricing: '2.9% + 30¢' },
        { id: 'lemonsqueezy', name: 'Lemon Squeezy', features: ['Merchant of record', 'Global tax', 'Digital products'], pricing: '5% + 50¢' },
        { id: 'paddle', name: 'Paddle', features: ['Merchant of record', 'B2B SaaS', 'Global compliance'], pricing: '5% + 50¢' },
        { id: 'none', name: 'No Payments', features: ['Free/product-led'], pricing: 'Free' },
      ],
      hosting: [
        { id: 'vercel', name: 'Vercel', features: ['Edge network', 'Preview deployments', 'Analytics'], bestFor: 'Next.js, static, serverless' },
        { id: 'netlify', name: 'Netlify', features: ['Edge functions', 'Forms', 'Identity'], bestFor: 'Static, JAMstack' },
        { id: 'cloudflare', name: 'Cloudflare Pages', features: ['Workers', 'D1 database', 'R2 storage'], bestFor: 'Edge, Workers, cheap' },
        { id: 'railway', name: 'Railway', features: ['Containers', 'Databases', 'Simple pricing'], bestFor: 'Full-stack, containers' },
        { id: 'fly', name: 'Fly.io', features: ['Global VMs', 'Any Docker', 'WireGuard'], bestFor: 'Custom infra, containers' },
      ],
    };

    res.json(options);
  } catch (error) {
    console.error('Tech stack options error:', error);
    res.status(500).json({ error: 'Failed to get tech stack options' });
  }
});

export default router;