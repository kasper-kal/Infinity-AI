import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

export const workflows = sqliteTable('workflows', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  accountId: text('account_id').notNull(),
  goal: text('goal').notNull(),
  config: text('config', { mode: 'json' }).notNull(),
  plan: text('plan', { mode: 'json' }),
  status: text('status').notNull().default('pending'),
  currentPhase: text('current_phase').notNull().default('discover'),
  currentStep: text('current_step'),
  totalEstimatedDuration: integer('total_estimated_duration').default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
}, (table) => ({
  projectIdIdx: index('workflows_project_id_idx').on(table.projectId),
  accountIdIdx: index('workflows_account_id_idx').on(table.accountId),
  statusIdx: index('workflows_status_idx').on(table.status),
}));

export const workflowSteps = sqliteTable('workflow_steps', {
  id: text('id').primaryKey(),
  workflowId: text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  phase: text('phase').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  agent: text('agent'),
  dependencies: text('dependencies', { mode: 'json' }).notNull().default('[]'),
  estimatedDuration: integer('estimated_duration').default(0),
  status: text('status').notNull().default('pending'),
  result: text('result', { mode: 'json' }),
  error: text('error'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  requiresApproval: integer('requires_approval', { mode: 'boolean' }).default(false),
  approvalGate: text('approval_gate'),
  worktreeId: text('worktree_id'),
  artifacts: text('artifacts', { mode: 'json' }).notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  workflowIdIdx: index('workflow_steps_workflow_id_idx').on(table.workflowId),
  statusIdx: index('workflow_steps_status_idx').on(table.status),
}));

export const workflowCheckpoints = sqliteTable('workflow_checkpoints', {
  id: text('id').primaryKey(),
  workflowId: text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  phase: text('phase').notNull(),
  stepId: text('step_id').notNull(),
  timestamp: text('timestamp').notNull(),
  state: text('state', { mode: 'json' }),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  workflowIdIdx: index('workflow_checkpoints_workflow_id_idx').on(table.workflowId),
}));

export const workflowApprovals = sqliteTable('workflow_approvals', {
  id: text('id').primaryKey(),
  workflowId: text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  gate: text('gate').notNull(),
  stepId: text('step_id').notNull(),
  status: text('status').notNull().default('pending'),
  requestedAt: text('requested_at').notNull(),
  respondedAt: text('responded_at'),
  feedback: text('feedback'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  workflowIdIdx: index('workflow_approvals_workflow_id_idx').on(table.workflowId),
  statusIdx: index('workflow_approvals_status_idx').on(table.status),
}));

export type Workflow = typeof workflows.$inferSelect;
export type NewWorkflow = typeof workflows.$inferInsert;
export type WorkflowStep = typeof workflowSteps.$inferSelect;
export type NewWorkflowStep = typeof workflowSteps.$inferInsert;
export type WorkflowCheckpoint = typeof workflowCheckpoints.$inferSelect;
export type NewWorkflowCheckpoint = typeof workflowCheckpoints.$inferInsert;
export type WorkflowApproval = typeof workflowApprovals.$inferSelect;
export type NewWorkflowApproval = typeof workflowApprovals.$inferInsert;