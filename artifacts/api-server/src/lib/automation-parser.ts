/**
 * Phase 33: AI Automation System — Automation Parser
 *
 * Natural language → structured automation spec parser using LLM with structured output.
 * Supports triggers, conditions, actions, chaining, and error handling.
 */

import { z } from "zod";
import type { LLMAdapter, LLMMessage } from "./llm-adapter";
import { sanitizePrompt } from "./infinity-prompt";

/**
 * Automation Trigger Types
 */
export enum AutomationTriggerType {
  CRON = "cron",
  WEBHOOK = "webhook",
  MANUAL = "manual",
  API_CALL = "api_call",
  CONNECTOR_EVENT = "connector_event",
}

/**
 * Connector Event Triggers (from Phase 13 connectors)
 */
export const CONNECTOR_EVENTS = {
  linear: [
    "issue.created",
    "issue.updated",
    "issue.deleted",
    "comment.created",
    "comment.updated",
    "cycle.changed",
    "project.updated",
    "team.updated",
  ],
  slack: [
    "message.posted",
    "message.updated",
    "message.deleted",
    "reaction.added",
    "reaction.removed",
    "channel.created",
    "channel.updated",
    "channel.deleted",
    "member.joined",
    "member.left",
  ],
  notion: [
    "page.created",
    "page.updated",
    "page.deleted",
    "database.row_added",
    "database.row_updated",
    "database.row_deleted",
    "comment.created",
    "comment.updated",
  ],
  "google-sheets": [
    "row.added",
    "row.updated",
    "row.deleted",
    "cell.changed",
    "sheet.created",
    "sheet.updated",
    "sheet.deleted",
  ],
  github: [
    "push",
    "pr.opened",
    "pr.updated",
    "pr.closed",
    "pr.merged",
    "pr.review_requested",
    "issue.created",
    "issue.updated",
    "issue.closed",
    "issue.reopened",
    "release.published",
    "workflow_run.completed",
  ],
  custom: [
    "webhook.received",
  ],
} as const;

/**
 * Condition Operators
 */
export enum ConditionOperator {
  EQUALS = "equals",
  NOT_EQUALS = "not_equals",
  CONTAINS = "contains",
  NOT_CONTAINS = "not_contains",
  STARTS_WITH = "starts_with",
  ENDS_WITH = "ends_with",
  REGEX_MATCH = "regex_match",
  GREATER_THAN = "gt",
  GREATER_THAN_OR_EQUAL = "gte",
  LESS_THAN = "lt",
  LESS_THAN_OR_EQUAL = "lte",
  IS_EMPTY = "is_empty",
  IS_NOT_EMPTY = "is_not_empty",
  IN_LIST = "in_list",
  NOT_IN_LIST = "not_in_list",
  CUSTOM_JS = "custom_js",
}

/**
 * Action Types
 */
export enum AutomationActionType {
  CONNECTOR_ACTION = "connector_action",
  NOTIFICATION = "notification",
  CODE_EXECUTION = "code_execution",
  LLM_CALL = "llm_call",
  DATA_TRANSFORM = "data_transform",
  HTTP_REQUEST = "http_request",
  DELAY = "delay",
  CONDITIONAL = "conditional",
  LOOP = "loop",
  PARALLEL = "parallel",
}

/**
 * Notification Channels
 */
export enum NotificationChannel {
  EMAIL = "email",
  PUSH = "push",
  SLACK = "slack",
  DISCORD = "discord",
  WEBHOOK = "webhook",
  IN_APP = "in_app",
}

/**
 * Automation Trigger Schema
 */
export const AutomationTriggerSchema = z.object({
  type: z.nativeEnum(AutomationTriggerType),
  // Cron trigger
  cronExpression: z.string().optional(),
  timezone: z.string().optional().default("UTC"),
  // Webhook trigger
  webhookPath: z.string().optional(),
  webhookSecret: z.string().optional(),
  // Connector event trigger
  connectorId: z.string().optional(),
  connectorEvent: z.string().optional(),
  // API call trigger
  apiPath: z.string().optional(),
  // Manual trigger (no extra config)
}).refine((data) => {
  // Validate required fields per trigger type
  switch (data.type) {
    case AutomationTriggerType.CRON:
      return !!data.cronExpression;
    case AutomationTriggerType.WEBHOOK:
      return !!data.webhookPath;
    case AutomationTriggerType.CONNECTOR_EVENT:
      return !!data.connectorId && !!data.connectorEvent;
    case AutomationTriggerType.API_CALL:
      return !!data.apiPath;
    case AutomationTriggerType.MANUAL:
      return true;
    default:
      return false;
  }
}, {
  message: "Missing required fields for trigger type",
});

export type AutomationTrigger = z.infer<typeof AutomationTriggerSchema>;

/**
 * Automation Condition Schema
 */
export const AutomationConditionSchema = z.object({
  id: z.string(),
  field: z.string(), // JSON path to field in context (e.g., "payload.price", "data.status")
  operator: z.nativeEnum(ConditionOperator),
  value: z.unknown().optional(), // Comparison value (type depends on operator)
  // For custom JS conditions
  customExpression: z.string().optional(), // JavaScript expression returning boolean
  // Logical grouping
  logicalOperator: z.enum(["AND", "OR"]).optional().default("AND"),
});

export type AutomationCondition = z.infer<typeof AutomationConditionSchema>;

/**
 * Automation Action Schema
 */
export const AutomationActionSchema = z.object({
  id: z.string(),
  type: z.nativeEnum(AutomationActionType),
  name: z.string().max(100),
  description: z.string().max(500).optional(),
  // Connector action
  connectorId: z.string().optional(),
  connectorAction: z.string().optional(),
  connectorParams: z.record(z.unknown()).optional(),
  // Notification
  notificationChannel: z.nativeEnum(NotificationChannel).optional(),
  notificationTemplate: z.string().optional(), // Template with {{variables}}
  notificationRecipients: z.array(z.string()).optional(),
  // Code execution (sandboxed)
  code: z.string().optional(), // JavaScript code to execute
  codeLanguage: z.enum(["javascript", "typescript"]).optional().default("javascript"),
  codeTimeoutMs: z.number().optional().default(30000),
  // LLM call
  llmPrompt: z.string().optional(),
  llmModel: z.string().optional(),
  llmTemperature: z.number().optional().default(0.3),
  llmMaxTokens: z.number().optional().default(2000),
  llmOutputSchema: z.record(z.unknown()).optional(), // JSON schema for structured output
  // Data transformation
  transformType: z.enum(["map", "filter", "reduce", "group", "sort", "custom"]).optional(),
  transformExpression: z.string().optional(), // JS expression or custom function
  // HTTP request
  httpMethod: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).optional(),
  httpUrl: z.string().url().optional(),
  httpHeaders: z.record(z.string()).optional(),
  httpBody: z.unknown().optional(),
  // Delay
  delayMs: z.number().optional(),
  // Conditional branching
  condition: AutomationConditionSchema.optional(),
  thenActions: z.array(z.lazy(() => AutomationActionSchema)).optional(),
  elseActions: z.array(z.lazy(() => AutomationActionSchema)).optional(),
  // Loop
  loopType: z.enum(["for_each", "while", "repeat"]).optional(),
  loopCollection: z.string().optional(), // JSON path to array
  loopVariable: z.string().optional(),
  loopCondition: z.string().optional(), // for while loops
  loopCount: z.number().optional(), // for repeat loops
  loopActions: z.array(z.lazy(() => AutomationActionSchema)).optional(),
  // Parallel execution
  parallelActions: z.array(z.lazy(() => AutomationActionSchema)).optional(),
  // Error handling
  onError: z.enum(["continue", "retry", "stop", "compensate"]).optional().default("stop"),
  retryConfig: z.object({
    maxRetries: z.number().default(3),
    retryDelayMs: z.number().default(1000),
    backoffMultiplier: z.number().default(2),
  }).optional(),
  // Compensation action for rollback
  compensateAction: z.lazy(() => AutomationActionSchema).optional(),
  // Dependencies on other action outputs
  dependsOn: z.array(z.string()).optional(), // Action IDs this depends on
});

export type AutomationAction = z.infer<typeof AutomationActionSchema>;

/**
 * Automation Settings
 */
export const AutomationSettingsSchema = z.object({
  name: z.string().max(100),
  description: z.string().max(500).optional(),
  enabled: z.boolean().default(true),
  projectId: z.string(),
  // Execution settings
  maxConcurrentRuns: z.number().default(1),
  timeoutMs: z.number().default(300000), // 5 minutes default
  // Retry settings
  retryOnFailure: z.boolean().default(false),
  maxRetries: z.number().default(3),
  retryDelayMs: z.number().default(5000),
  // Logging
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  logRetentionDays: z.number().default(30),
  // Idempotency
  idempotencyKey: z.string().optional(), // Template for generating idempotency keys
  // Tags for organization
  tags: z.array(z.string()).optional(),
});

export type AutomationSettings = z.infer<typeof AutomationSettingsSchema>;

/**
 * Complete Automation Specification
 */
export const AutomationSpecSchema = z.object({
  settings: AutomationSettingsSchema,
  trigger: AutomationTriggerSchema,
  conditions: z.array(AutomationConditionSchema).optional().default([]),
  actions: z.array(AutomationActionSchema).min(1, "At least one action required"),
  // Version for updates
  version: z.number().int().positive().default(1),
  // Metadata
  createdBy: z.string().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type AutomationSpec = z.infer<typeof AutomationSpecSchema>;

/**
 * Parser Output Schema (with additional metadata)
 */
export const ParserOutputSchema = z.object({
  spec: AutomationSpecSchema,
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()).optional(),
  suggestions: z.array(z.string()).optional(),
  // For interactive clarification
  clarifications: z.array(z.object({
    question: z.string(),
    field: z.string(), // Which field this clarifies
    options: z.array(z.string()).optional(),
    required: z.boolean().default(true),
  })).optional(),
});

export type ParserOutput = z.infer<typeof ParserOutputSchema>;

/**
 * Automation Parser Class
 */
export class AutomationParser {
  private llm: LLMAdapter;

  constructor(llm?: LLMAdapter) {
    this.llm = llm || (await import("./adapter-factory")).createBestAdapter();
  }

  /**
   * Parse natural language into automation spec
   */
  async parse(prompt: string, context?: {
    projectId?: string;
    existingAutomations?: AutomationSpec[];
    availableConnectors?: Array<{ id: string; platform: string; actions: string[] }>;
  }): Promise<ParserOutput> {
    const systemPrompt = this.buildSystemPrompt(context);
    const userPrompt = this.buildUserPrompt(prompt, context);

    const messages: LLMMessage[] = [
      { role: "system", content: sanitizePrompt(systemPrompt) },
      { role: "user", content: sanitizePrompt(userPrompt) },
    ];

    const options = {
      temperature: 0.1,
      maxTokens: 8000,
      responseFormat: { type: "json_object" as const },
    };

    let lastError: Error | null = null;
    let lastResponse = "";

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await this.llm.complete(messages, options);
        lastResponse = result.content;
        const parsed = JSON.parse(result.content);
        const validated = ParserOutputSchema.parse(parsed);
        return validated;
      } catch (err) {
        lastError = err as Error;
        if (attempt < 2) {
          messages.push(
            { role: "assistant" as const, content: lastResponse },
            { role: "user" as const, content: `The previous output failed validation: ${lastError.message}. Please fix and output ONLY valid JSON matching the schema.` }
          );
        }
      }
    }

    throw new Error(`Automation parser failed after 3 attempts: ${lastError?.message}`);
  }

  /**
   * Build system prompt with schema documentation
   */
  private buildSystemPrompt(context?: {
    availableConnectors?: Array<{ id: string; platform: string; actions: string[] }>;
  }): string {
    const connectorInfo = context?.availableConnectors?.map(c =>
      `- ${c.platform} (${c.id}): ${c.actions.join(", ")}`
    ).join("\n") || "No connectors configured";

    return `You are an AUTOMATION PARSER. Convert natural language descriptions into structured automation specifications.

AVAILABLE CONNECTORS:
${connectorInfo}

SUPPORTED TRIGGERS:
1. CRON - Scheduled execution (cron expression + timezone)
2. WEBHOOK - HTTP webhook endpoint (path + optional secret)
3. CONNECTOR_EVENT - Events from connected services (Linear, Slack, Notion, Sheets, GitHub, Custom)
4. MANUAL - Manual trigger via API/UI
5. API_CALL - Custom API endpoint

SUPPORTED CONDITIONS:
- Comparison: equals, not_equals, contains, not_contains, starts_with, ends_with, regex_match
- Numeric: gt, gte, lt, lte
- Existence: is_empty, is_not_empty
- Lists: in_list, not_in_list
- Custom: custom_js (JavaScript expression returning boolean)

SUPPORTED ACTIONS:
1. CONNECTOR_ACTION - Execute action on connected service
2. NOTIFICATION - Send notification (email, push, Slack, Discord, webhook, in-app)
3. CODE_EXECUTION - Run sandboxed JavaScript/TypeScript
4. LLM_CALL - Call LLM with prompt, get structured output
5. DATA_TRANSFORM - Transform data (map, filter, reduce, group, sort, custom)
6. HTTP_REQUEST - Make HTTP request
7. DELAY - Wait for specified milliseconds
8. CONDITIONAL - If/then/else branching
9. LOOP - for_each, while, repeat loops
10. PARALLEL - Execute multiple actions concurrently

CHAINING & CONTROL FLOW:
- Actions can depend on other actions (dependsOn)
- Conditional branches with thenActions/elseActions
- Loops with loopActions
- Parallel execution with parallelActions
- Error handling: continue, retry, stop, compensate
- Compensation actions for rollback

OUTPUT REQUIREMENTS:
- Output ONLY valid JSON matching the ParserOutput schema
- Include confidence score (0-1)
- Include warnings for ambiguous or incomplete specs
- Include suggestions for improvements
- Include clarifications if user input is ambiguous

PRESERVATION RULES:
- Always include projectId in settings
- Use JSON path notation for field references (e.g., "payload.price", "data.items[0].name")
- For connector events, use exact event names from available connectors
- For cron, use standard 5-field format with optional 6th for seconds
- All IDs should be descriptive (kebab-case)`;
  }

  /**
   * Build user prompt with the natural language input
   */
  private buildUserPrompt(prompt: string, context?: {
    projectId?: string;
    existingAutomations?: AutomationSpec[];
    availableConnectors?: Array<{ id: string; platform: string; actions: string[] }>;
  }): string {
    const existing = context?.existingAutomations?.map(a =>
      `- ${a.settings.name} (${a.trigger.type}): ${a.settings.description}`
    ).join("\n") || "None";

    return `Parse this natural language into an automation specification:

USER REQUEST:
"${prompt}"

${context?.projectId ? `PROJECT ID: ${context.projectId}` : ""}

EXISTING AUTOMATIONS:
${existing}

Return the complete automation spec with all required fields. If anything is ambiguous, include clarifications in the output.`;
  }

  /**
   * Validate an automation spec (can be used standalone)
   */
  validateSpec(spec: unknown): { valid: boolean; errors: string[] } {
    try {
      AutomationSpecSchema.parse(spec);
      return { valid: true, errors: [] };
    } catch (err) {
      if (err instanceof z.ZodError) {
        return {
          valid: false,
          errors: err.errors.map(e => `${e.path.join(".")}: ${e.message}`),
        };
      }
      return { valid: false, errors: [String(err)] };
    }
  }

  /**
   * Generate a unique automation ID from name
   */
  static generateId(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .substring(0, 50);
  }

  /**
   * Generate idempotency key template
   */
  static generateIdempotencyKeyTemplate(trigger: AutomationTrigger): string {
    switch (trigger.type) {
      case AutomationTriggerType.CRON:
        return `cron-${trigger.cronExpression?.replace(/[^a-z0-9]/g, "-")}-{{timestamp}}`;
      case AutomationTriggerType.WEBHOOK:
        return `webhook-${trigger.webhookPath?.replace(/[^a-z0-9]/g, "-")}-{{requestId}}`;
      case AutomationTriggerType.CONNECTOR_EVENT:
        return `${trigger.connectorId}-${trigger.connectorEvent}-{{eventId}}`;
      case AutomationTriggerType.API_CALL:
        return `api-${trigger.apiPath?.replace(/[^a-z0-9]/g, "-")}-{{requestId}}`;
      case AutomationTriggerType.MANUAL:
        return `manual-{{timestamp}}-{{random}}`;
      default:
        return `auto-{{timestamp}}-{{random}}`;
    }
  }
}

/**
 * Parse natural language to automation spec (convenience function)
 */
export async function parseAutomation(
  prompt: string,
  context?: {
    projectId?: string;
    existingAutomations?: AutomationSpec[];
    availableConnectors?: Array<{ id: string; platform: string; actions: string[] }>;
  }
): Promise<ParserOutput> {
  const parser = new AutomationParser();
  return parser.parse(prompt, context);
}

/**
 * Example prompts for testing/documentation
 */
export const EXAMPLE_PROMPTS = [
  "Every morning at 8:00 AM, check for new Linear issues assigned to me and send me a Slack summary",
  "When a new row is added to the Google Sheet 'Sales Data', if the amount is greater than 10000, create a Linear issue and notify the sales team on Slack",
  "On GitHub PR merged to main, run tests and if they pass, deploy to Vercel and post a message to #deployments channel",
  "Every Monday at 9:00, fetch data from the Notion database 'Content Calendar', filter for this week's posts, and generate social media copy using AI",
  "When a Slack message in #support contains 'urgent', create a Linear issue with high priority and notify the on-call engineer via push notification",
  "Daily at midnight, sync all GitHub issues with label 'bug' to Linear, create corresponding issues, and update a Google Sheet tracker",
  "When a new customer signs up (webhook), create a Notion page from template, add to CRM spreadsheet, and send welcome email sequence",
];