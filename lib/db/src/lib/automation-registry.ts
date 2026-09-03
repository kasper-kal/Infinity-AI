import { db } from "../index";
import {
  automations,
  automationRuns,
  automationLogs,
  automationSchedules,
  automationWebhooks,
  type Automation,
  type NewAutomation,
  type AutomationRun,
  type NewAutomationRun,
  type AutomationLog,
  type NewAutomationLog,
  type AutomationSchedule,
  type NewAutomationSchedule,
  type AutomationWebhook,
  type NewAutomationWebhook,
} from "../schema/automations";
import { eq, and, desc, asc, sql, inArray, lt, gte, isNull } from "drizzle-orm";
import { AutomationParser, type AutomationSpec, type AutomationTrigger, AutomationTriggerType } from "../../automation-parser";
import { generateId, generateIdempotencyKeyTemplate } from "../../automation-parser";

/**
 * Automation Registry — Database operations for automations.
 * Provides CRUD, scheduling, webhook management, and run/log tracking.
 */

export class AutomationRegistry {
  /**
   * Create a new automation
   */
  static async create(data: {
    projectId: string;
    name: string;
    description?: string;
    trigger: AutomationTrigger;
    conditions?: any[];
    actions: any[];
    settings?: any;
    createdBy?: string;
    tags?: string[];
  }): Promise<Automation> {
    const id = generateId(data.name);
    const idempotencyKeyTemplate = generateIdempotencyKeyTemplate(data.trigger);

    const settings = {
      name: data.name,
      description: data.description,
      enabled: true,
      projectId: data.projectId,
      maxConcurrentRuns: 1,
      timeoutMs: 300000,
      retryOnFailure: false,
      maxRetries: 3,
      retryDelayMs: 5000,
      logLevel: "info",
      logRetentionDays: 30,
      idempotencyKey: idempotencyKeyTemplate,
      tags: data.tags || [],
      ...data.settings,
    };

    const spec: any = {
      settings,
      trigger: data.trigger,
      conditions: data.conditions || [],
      actions: data.actions,
      version: 1,
      createdBy: data.createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const [automation] = await db
      .insert(automations)
      .values({
        id,
        projectId: data.projectId,
        name: data.name,
        description: data.description,
        enabled: true,
        trigger: data.trigger,
        conditions: data.conditions || [],
        actions: data.actions,
        settings: spec.settings,
        version: 1,
        createdBy: data.createdBy,
        idempotencyKeyTemplate,
        tags: data.tags || [],
      })
      .returning();

    // If cron trigger, create schedule entry
    if (data.trigger.type === AutomationTriggerType.CRON && data.trigger.cronExpression) {
      await this.createOrUpdateSchedule(automation.id, data.projectId, data.trigger);
    }

    // If webhook trigger, create webhook entry
    if (data.trigger.type === AutomationTriggerType.WEBHOOK && data.trigger.webhookPath) {
      await this.createWebhook(automation.id, data.projectId, data.trigger);
    }

    return automation;
  }

  /**
   * Get automation by ID
   */
  static async getById(id: string): Promise<Automation | null> {
    const [automation] = await db
      .select()
      .from(automations)
      .where(eq(automations.id, id))
      .limit(1);
    return automation || null;
  }

  /**
   * Get automation by ID with full spec
   */
  static async getSpecById(id: string): Promise<AutomationSpec | null> {
    const automation = await this.getById(id);
    if (!automation) return null;

    return {
      settings: automation.settings as any,
      trigger: automation.trigger as any,
      conditions: automation.conditions as any,
      actions: automation.actions as any,
      version: automation.version,
      createdBy: automation.createdBy || undefined,
      createdAt: automation.createdAt?.toISOString(),
      updatedAt: automation.updatedAt?.toISOString(),
    };
  }

  /**
   * List automations for a project
   */
  static async listByProject(projectId: string, options?: {
    enabled?: boolean;
    limit?: number;
    offset?: number;
    tags?: string[];
  }): Promise<Automation[]> {
    const conditions = [eq(automations.projectId, projectId)];

    if (options?.enabled !== undefined) {
      conditions.push(eq(automations.enabled, options.enabled));
    }

    if (options?.tags && options.tags.length > 0) {
      // Filter by tags (array overlap)
      conditions.push(sql`${automations.tags} && ${options.tags}`);
    }

    return db
      .select()
      .from(automations)
      .where(and(...conditions))
      .orderBy(desc(automations.updatedAt))
      .limit(options?.limit || 50)
      .offset(options?.offset || 0);
  }

  /**
   * Update an automation
   */
  static async update(id: string, data: Partial<{
    name: string;
    description: string;
    enabled: boolean;
    trigger: AutomationTrigger;
    conditions: any[];
    actions: any[];
    settings: any;
    tags: string[];
  }>): Promise<Automation | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const updates: any = {
      updatedAt: new Date(),
      version: existing.version + 1,
    };

    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.enabled !== undefined) updates.enabled = data.enabled;
    if (data.trigger !== undefined) updates.trigger = data.trigger;
    if (data.conditions !== undefined) updates.conditions = data.conditions;
    if (data.actions !== undefined) updates.actions = data.actions;
    if (data.tags !== undefined) updates.tags = data.tags;

    if (data.settings !== undefined) {
      updates.settings = {
        ...(existing.settings as any),
        ...data.settings,
        updatedAt: new Date().toISOString(),
      };
    }

    const [updated] = await db
      .update(automations)
      .set(updates)
      .where(eq(automations.id, id))
      .returning();

    // Update schedule if trigger changed
    if (data.trigger) {
      if (data.trigger.type === AutomationTriggerType.CRON && data.trigger.cronExpression) {
        await this.createOrUpdateSchedule(id, existing.projectId, data.trigger);
      } else {
        await this.deactivateSchedule(id);
      }

      if (data.trigger.type === AutomationTriggerType.WEBHOOK && data.trigger.webhookPath) {
        await this.createWebhook(id, existing.projectId, data.trigger);
      } else {
        await this.deactivateWebhook(id);
      }
    }

    return updated;
  }

  /**
   * Delete an automation
   */
  static async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(automations)
      .where(eq(automations.id, id));
    return (result.rowCount || 0) > 0;
  }

  /**
   * Enable/disable automation
   */
  static async setEnabled(id: string, enabled: boolean): Promise<Automation | null> {
    const [updated] = await db
      .update(automations)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(automations.id, id))
      .returning();

    if (updated) {
      if (enabled) {
        const automation = await this.getById(id);
        if (automation?.trigger.type === AutomationTriggerType.CRON) {
          await this.createOrUpdateSchedule(id, automation.projectId, automation.trigger as any);
        }
        if (automation?.trigger.type === AutomationTriggerType.WEBHOOK) {
          await this.createWebhook(id, automation.projectId, automation.trigger as any);
        }
      } else {
        await this.deactivateSchedule(id);
        await this.deactivateWebhook(id);
      }
    }

    return updated;
  }

  // ============ Schedule Management ============

  /**
   * Create or update schedule for cron automation
   */
  static async createOrUpdateSchedule(
    automationId: string,
    projectId: string,
    trigger: AutomationTrigger
  ): Promise<AutomationSchedule> {
    const nextRunAt = this.calculateNextCronRun(trigger.cronExpression!, trigger.timezone);

    const [schedule] = await db
      .insert(automationSchedules)
      .values({
        automationId,
        projectId,
        cronExpression: trigger.cronExpression!,
        timezone: trigger.timezone || "UTC",
        nextRunAt,
        active: true,
      })
      .onConflictDoUpdate({
        target: automationSchedules.automationId,
        set: {
          cronExpression: trigger.cronExpression!,
          timezone: trigger.timezone || "UTC",
          nextRunAt,
          active: true,
          updatedAt: new Date(),
        },
      })
      .returning();

    return schedule;
  }

  /**
   * Deactivate schedule
   */
  static async deactivateSchedule(automationId: string): Promise<void> {
    await db
      .update(automationSchedules)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(automationSchedules.automationId, automationId));
  }

  /**
   * Get due cron automations (for scheduler)
   */
  static async getDueAutomations(limit = 100): Promise<AutomationSchedule[]> {
    const now = new Date();
    return db
      .select()
      .from(automationSchedules)
      .where(
        and(
          eq(automationSchedules.active, true),
          lt(automationSchedules.nextRunAt, now)
        )
      )
      .orderBy(asc(automationSchedules.nextRunAt))
      .limit(limit);
  }

  /**
   * Update schedule after run
   */
  static async updateScheduleAfterRun(automationId: string): Promise<void> {
    const [schedule] = await db
      .select()
      .from(automationSchedules)
      .where(eq(automationSchedules.automationId, automationId))
      .limit(1);

    if (!schedule) return;

    const nextRunAt = this.calculateNextCronRun(schedule.cronExpression, schedule.timezone);

    await db
      .update(automationSchedules)
      .set({
        lastRunAt: new Date(),
        nextRunAt,
        updatedAt: new Date(),
      })
      .where(eq(automationSchedules.automationId, automationId));
  }

  /**
   * Calculate next cron run time (simplified - in production use a proper cron library)
   */
  private static calculateNextCronRun(cronExpression: string, timezone: string): Date {
    // This is a simplified implementation
    // In production, use node-cron or similar library
    const now = new Date();
    // Add ~1 minute for now - real implementation would parse cron
    return new Date(now.getTime() + 60000);
  }

  // ============ Webhook Management ============

  /**
   * Create webhook for automation
   */
  static async createWebhook(
    automationId: string,
    projectId: string,
    trigger: AutomationTrigger
  ): Promise<AutomationWebhook> {
    const [webhook] = await db
      .insert(automationWebhooks)
      .values({
        automationId,
        projectId,
        path: trigger.webhookPath!,
        secret: trigger.webhookSecret,
        active: true,
      })
      .onConflictDoUpdate({
        target: automationWebhooks.automationId,
        set: {
          path: trigger.webhookPath!,
          secret: trigger.webhookSecret,
          active: true,
          updatedAt: new Date(),
        },
      })
      .returning();

    return webhook;
  }

  /**
   * Deactivate webhook
   */
  static async deactivateWebhook(automationId: string): Promise<void> {
    await db
      .update(automationWebhooks)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(automationWebhooks.automationId, automationId));
  }

  /**
   * Get webhook by path
   */
  static async getWebhookByPath(path: string): Promise<AutomationWebhook | null> {
    const [webhook] = await db
      .select()
      .from(automationWebhooks)
      .where(and(eq(automationWebhooks.path, path), eq(automationWebhooks.active, true)))
      .limit(1);
    return webhook || null;
  }

  // ============ Run Management ============

  /**
   * Create a new automation run
   */
  static async createRun(data: {
    automationId: string;
    projectId: string;
    triggerType: string;
    triggerPayload?: any;
    idempotencyKey?: string;
    parentRunId?: string;
  }): Promise<AutomationRun> {
    const [run] = await db
      .insert(automationRuns)
      .values({
        automationId: data.automationId,
        projectId: data.projectId,
        triggerType: data.triggerType as any,
        triggerPayload: data.triggerPayload,
        idempotencyKey: data.idempotencyKey,
        status: "pending",
        startedAt: new Date(),
        parentRunId: data.parentRunId,
      })
      .returning();

    return run;
  }

  /**
   * Check idempotency key
   */
  static async checkIdempotency(idempotencyKey: string): Promise<AutomationRun | null> {
    if (!idempotencyKey) return null;
    const [run] = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.idempotencyKey, idempotencyKey))
      .limit(1);
    return run || null;
  }

  /**
   * Update run status
   */
  static async updateRunStatus(
    runId: string,
    status: "running" | "completed" | "failed" | "cancelled" | "partial",
    error?: string,
    output?: any
  ): Promise<AutomationRun | null> {
    const updates: any = {
      status,
      updatedAt: new Date(),
    };

    if (status === "running") {
      updates.startedAt = new Date();
    } else if (["completed", "failed", "cancelled", "partial"].includes(status)) {
      updates.completedAt = new Date();
      // Calculate duration
      const [run] = await db
        .select({ startedAt: automationRuns.startedAt })
        .from(automationRuns)
        .where(eq(automationRuns.id, runId))
        .limit(1);
      if (run?.startedAt) {
        updates.durationMs = new Date().getTime() - new Date(run.startedAt).getTime();
      }
    }

    if (error) updates.error = error;
    if (output !== undefined) updates.output = output;

    const [updated] = await db
      .update(automationRuns)
      .set(updates)
      .where(eq(automationRuns.id, runId))
      .returning();

    // If completed, update schedule
    if (status === "completed" && updated) {
      const automation = await this.getById(updated.automationId);
      if (automation?.trigger.type === AutomationTriggerType.CRON) {
        await this.updateScheduleAfterRun(updated.automationId);
      }
    }

    return updated;
  }

  /**
   * Get run by ID
   */
  static async getRun(runId: string): Promise<AutomationRun | null> {
    const [run] = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.id, runId))
      .limit(1);
    return run || null;
  }

  /**
   * List runs for an automation
   */
  static async listRuns(automationId: string, options?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<AutomationRun[]> {
    const conditions = [eq(automationRuns.automationId, automationId)];

    if (options?.status) {
      conditions.push(eq(automationRuns.status, options.status as any));
    }

    return db
      .select()
      .from(automationRuns)
      .where(and(...conditions))
      .orderBy(desc(automationRuns.createdAt))
      .limit(options?.limit || 50)
      .offset(options?.offset || 0);
  }

  // ============ Log Management ============

  /**
   * Create automation log entry
   */
  static async createLog(data: {
    runId: string;
    automationId: string;
    projectId: string;
    actionId: string;
    actionType: string;
    actionName?: string;
    level?: "debug" | "info" | "warn" | "error";
    message: string;
    input?: any;
    output?: any;
    error?: string;
    durationMs?: number;
    attempt?: number;
    parentActionId?: string;
    sequence: number;
  }): Promise<AutomationLog> {
    const [log] = await db
      .insert(automationLogs)
      .values({
        runId: data.runId,
        automationId: data.automationId,
        projectId: data.projectId,
        actionId: data.actionId,
        actionType: data.actionType as any,
        actionName: data.actionName,
        level: data.level || "info",
        message: data.message,
        input: data.input,
        output: data.output,
        error: data.error,
        durationMs: data.durationMs,
        attempt: data.attempt || 0,
        parentActionId: data.parentActionId,
        sequence: data.sequence,
      })
      .returning();

    return log;
  }

  /**
   * Get logs for a run
   */
  static async getLogsForRun(runId: string): Promise<AutomationLog[]> {
    return db
      .select()
      .from(automationLogs)
      .where(eq(automationLogs.runId, runId))
      .orderBy(asc(automationLogs.sequence));
  }

  /**
   * Get recent logs for an automation
   */
  static async getRecentLogs(automationId: string, limit = 100): Promise<AutomationLog[]> {
    return db
      .select()
      .from(automationLogs)
      .where(eq(automationLogs.automationId, automationId))
      .orderBy(desc(automationLogs.createdAt))
      .limit(limit);
  }

  // ============ Statistics ============

  /**
   * Get automation statistics
   */
  static async getStats(projectId: string): Promise<{
    total: number;
    enabled: number;
    disabled: number;
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    avgDurationMs: number;
  }> {
    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(automations)
      .where(eq(automations.projectId, projectId));

    const [enabledResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(automations)
      .where(and(eq(automations.projectId, projectId), eq(automations.enabled, true)));

    const [runsResult] = await db
      .select({
        total: sql<number>`count(*)`,
        successful: sql<number>`count(*) filter (where ${automationRuns.status} = 'completed')`,
        failed: sql<number>`count(*) filter (where ${automationRuns.status} = 'failed')`,
        avgDuration: sql<number>`avg(${automationRuns.durationMs})`,
      })
      .from(automationRuns)
      .where(eq(automationRuns.projectId, projectId));

    return {
      total: totalResult?.count || 0,
      enabled: enabledResult?.count || 0,
      disabled: (totalResult?.count || 0) - (enabledResult?.count || 0),
      totalRuns: runsResult?.total || 0,
      successfulRuns: runsResult?.successful || 0,
      failedRuns: runsResult?.failed || 0,
      avgDurationMs: runsResult?.avgDuration || 0,
    };
  }

  /**
   * Validate automation spec using parser
   */
  static validateSpec(spec: any): { valid: boolean; errors: string[] } {
    return AutomationParser.validateSpec(spec);
  }

  /**
   * Parse natural language to automation spec
   */
  static async parseNaturalLanguage(
    prompt: string,
    context?: {
      projectId?: string;
      existingAutomations?: AutomationSpec[];
      availableConnectors?: Array<{ id: string; platform: string; actions: string[] }>;
    }
  ) {
    const parser = new AutomationParser();
    return parser.parse(prompt, context);
  }
}

export const automationRegistry = AutomationRegistry;