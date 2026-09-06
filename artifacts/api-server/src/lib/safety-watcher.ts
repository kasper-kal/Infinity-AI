/**
 * Phase 38: Local AI Safety Watcher — Core Backend Library
 *
 * Background AI monitor that watches for safety issues and errors across all
 * Infinity activity: agent loops, builds, deployments, automations, browser actions.
 *
 * Detection rules (configurable, extensible):
 * - Runaway Loop: Agent > 50 iterations without progress, token budget > 80%
 * - Token Burn: Single operation > $5 estimated cost (based on token counts)
 * - Security Violation: Browser accessing sensitive domain, secret in code, PII in logs
 * - Deployment Failure: Deploy fails, health check fails, rollback triggered
 * - Error Pattern: Same error > 3 times in 10 minutes across any subsystem
 * - Policy Violation: Agent attempts denied action, accesses forbidden path
 * - Resource Exhaustion: Memory > 90%, disk > 90%, CPU sustained > 80%
 * - Stalled Task: Task no progress > 10 minutes (build, research, automation)
 *
 * Severity levels: info, warning, critical, emergency
 * Actions: notify, pause agent, rollback, request human intervention
 *
 * $0 budget: Local models (Ollama, llama.cpp) or Transformers.js (WASM) fallback
 */

import { EventEmitter } from "events";
import { getTaskRegistry, Task, TaskType, TaskStatus } from "./task-registry";
import { dispatchNotification } from "./notification-dispatch";
import { notifyAll as sendWebPush } from "./web-push";
import { logger } from "./logger";

// ============================================================================
// Types & Interfaces
// ============================================================================

export type SafetySeverity = "info" | "warning" | "critical" | "emergency";

export type SafetyAction =
  | "notify"
  | "pause_agent"
  | "rollback"
  | "request_human"
  | "throttle";

export interface SafetyRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  severity: SafetySeverity;
  actions: SafetyAction[];
  threshold?: Record<string, number | string>;
  cooldownMs: number; // Minimum time between triggers
}

export interface SafetyEvent {
  id: string;
  timestamp: Date;
  source: string;
  type: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface SafetyFinding {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: SafetySeverity;
  title: string;
  description: string;
  source: string;
  sourceType: string;
  evidence: Record<string, unknown>;
  suggestedActions: SafetyAction[];
  timestamp: Date;
  acknowledged: boolean;
  snoozedUntil?: Date;
}

export interface WatcherConfig {
  enabled: boolean;
  rules: SafetyRule[];
  localModel: {
    provider: "ollama" | "transformers" | "free-api" | "disabled";
    endpoint?: string; // Ollama endpoint (default: http://localhost:11434)
    model?: string; // Model name (default: llama3.2:1b or qwen2.5:0.5b)
    timeoutMs: number;
  };
  notifications: {
    webPush: boolean;
    email: boolean;
    slack: boolean;
    discord: boolean;
    inApp: boolean;
    webhookUrl?: string;
  };
  quietHours: {
    enabled: boolean;
    start: string; // HH:MM 24-hour format
    end: string;
    timezone: string; // IANA timezone
  };
  batchWindowMs: number; // Group similar notifications
  projectId?: string; // Scope to project, undefined = global
}

export interface EventSubscription {
  eventType: string;
  handler: (event: SafetyEvent) => void | Promise<void>;
}

// ============================================================================
// Default Rules Configuration
// ============================================================================

const DEFAULT_RULES: SafetyRule[] = [
  {
    id: "runaway_loop",
    name: "Runaway Agent Loop",
    description: "Agent exceeds iteration limit without meaningful progress",
    enabled: true,
    severity: "critical",
    actions: ["notify", "pause_agent", "request_human"],
    threshold: { maxIterations: 50, tokenBudgetPercent: 80 },
    cooldownMs: 5 * 60 * 1000, // 5 minutes
  },
  {
    id: "token_burn",
    name: "Excessive Token Usage",
    description: "Single operation estimated cost exceeds threshold",
    enabled: true,
    severity: "warning",
    actions: ["notify", "throttle"],
    threshold: { maxCostUsd: 5, maxTokens: 100000 },
    cooldownMs: 10 * 60 * 1000, // 10 minutes
  },
  {
    id: "security_violation",
    name: "Security Violation",
    description: "Sensitive domain access, secrets in code, or PII exposure",
    enabled: true,
    severity: "emergency",
    actions: ["notify", "pause_agent", "request_human"],
    threshold: {},
    cooldownMs: 60 * 1000, // 1 minute
  },
  {
    id: "deployment_failure",
    name: "Deployment Failure",
    description: "Deploy fails, health check fails, or rollback triggered",
    enabled: true,
    severity: "critical",
    actions: ["notify", "request_human"],
    threshold: {},
    cooldownMs: 2 * 60 * 1000, // 2 minutes
  },
  {
    id: "error_pattern",
    name: "Recurring Error Pattern",
    description: "Same error occurs more than threshold times in time window",
    enabled: true,
    severity: "warning",
    actions: ["notify"],
    threshold: { maxOccurrences: 3, windowMinutes: 10 },
    cooldownMs: 15 * 60 * 1000, // 15 minutes
  },
  {
    id: "policy_violation",
    name: "Policy Violation",
    description: "Agent attempts denied action or accesses forbidden resource",
    enabled: true,
    severity: "critical",
    actions: ["notify", "pause_agent", "request_human"],
    threshold: {},
    cooldownMs: 1 * 60 * 1000, // 1 minute
  },
  {
    id: "resource_exhaustion",
    name: "Resource Exhaustion",
    description: "System resources critically low (memory, disk, CPU)",
    enabled: true,
    severity: "critical",
    actions: ["notify", "throttle", "request_human"],
    threshold: { memoryPercent: 90, diskPercent: 90, cpuPercent: 80 },
    cooldownMs: 5 * 60 * 1000, // 5 minutes
  },
  {
    id: "stalled_task",
    name: "Stalled Task",
    description: "Task shows no progress for extended period",
    enabled: true,
    severity: "warning",
    actions: ["notify", "request_human"],
    threshold: { stallMinutes: 10 },
    cooldownMs: 10 * 60 * 1000, // 10 minutes
  },
];

// ============================================================================
// Safety Watcher Core Class
// ============================================================================

export class SafetyWatcher extends EventEmitter {
  private config: WatcherConfig;
  private rules: Map<string, SafetyRule> = new Map();
  private findings: Map<string, SafetyFinding> = new Map();
  private eventSubscriptions: Map<string, EventSubscription[]> = new Map();
  private lastTriggered: Map<string, number> = new Map(); // ruleId -> timestamp
  private errorCounts: Map<string, { count: number; firstSeen: number }> = new Map(); // errorKey -> {count, firstSeen}
  private isRunning = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds
  private taskRegistry = getTaskRegistry();
  private ollamaAvailable = false;

  constructor(config: Partial<WatcherConfig> = {}) {
    super();
    this.config = this.mergeConfig(config);
    this.initializeRules();
  }

  private mergeConfig(config: Partial<WatcherConfig>): WatcherConfig {
    return {
      enabled: config.enabled ?? true,
      rules: config.rules ?? DEFAULT_RULES,
      localModel: {
        provider: config.localModel?.provider ?? "ollama",
        endpoint: config.localModel?.endpoint ?? "http://localhost:11434",
        model: config.localModel?.model ?? "llama3.2:1b",
        timeoutMs: config.localModel?.timeoutMs ?? 10000,
      },
      notifications: {
        webPush: config.notifications?.webPush ?? true,
        email: config.notifications?.email ?? false,
        slack: config.notifications?.slack ?? false,
        discord: config.notifications?.discord ?? false,
        inApp: config.notifications?.inApp ?? true,
        webhookUrl: config.notifications?.webhookUrl,
      },
      quietHours: {
        enabled: config.quietHours?.enabled ?? true,
        start: config.quietHours?.start ?? "22:00",
        end: config.quietHours?.end ?? "08:00",
        timezone: config.quietHours?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      batchWindowMs: config.batchWindowMs ?? 5 * 60 * 1000, // 5 minutes
      projectId: config.projectId,
    };
  }

  private initializeRules(): void {
    for (const rule of this.config.rules) {
      this.rules.set(rule.id, rule);
    }
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async start(): Promise<void> {
    if (this.isRunning) return;

    // Initialize task registry
    await this.taskRegistry.initialize();

    // Check Ollama availability
    await this.checkOllamaAvailability();

    // Subscribe to system events
    this.subscribeToEvents();

    // Start periodic checks
    this.checkInterval = setInterval(() => this.runPeriodicChecks(), this.CHECK_INTERVAL_MS);

    this.isRunning = true;
    logger.info("[SafetyWatcher] Started monitoring");
    this.emit("started");
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.isRunning = false;
    logger.info("[SafetyWatcher] Stopped monitoring");
    this.emit("stopped");
  }

  // ============================================================================
  // Event Subscription System
  // ============================================================================

  private subscribeToEvents(): void {
    // Task Registry events
    this.taskRegistry.on("task:created", (event) => this.handleTaskEvent(event));
    this.taskRegistry.on("task:updated", (event) => this.handleTaskEvent(event));
    this.taskRegistry.on("task:completed", (event) => this.handleTaskEvent(event));

    // Universal Agent events (emitted via task-registry as agent-loop tasks)
    // Build Orchestrator events
    // Deployment Engine events
    // Browser Pool events
    // Automation Runtime events
    // These would be integrated via their respective event emitters
  }

  private handleTaskEvent(event: { type: string; task: Task; timestamp: Date }): void {
    const safetyEvent: SafetyEvent = {
      id: `${event.task.id}-${Date.now()}`,
      timestamp: event.timestamp,
      source: "task-registry",
      type: `task:${event.type.replace("task:", "")}`,
      payload: {
        taskId: event.task.id,
        taskType: event.task.type,
        title: event.task.title,
        description: event.task.description,
        progress: event.task.progress,
        status: event.task.status,
        metadata: event.task.metadata,
      },
    };

    this.processEvent(safetyEvent);
  }

  /**
   * Subscribe to external event sources
   */
  subscribe(eventType: string, handler: (event: SafetyEvent) => void | Promise<void>): () => void {
    const subscription: EventSubscription = { eventType, handler };
    const subs = this.eventSubscriptions.get(eventType) || [];
    subs.push(subscription);
    this.eventSubscriptions.set(eventType, subs);

    // Return unsubscribe function
    return () => {
      const current = this.eventSubscriptions.get(eventType) || [];
      this.eventSubscriptions.set(eventType, current.filter((s) => s !== subscription));
    };
  }

  /**
   * Emit event to all subscribers
   */
  async emitEvent(event: SafetyEvent): Promise<void> {
    const subs = this.eventSubscriptions.get(event.type) || [];
    await Promise.all(subs.map((s) => s.handler(event)));
  }

  // ============================================================================
  // Event Processing & Rule Engine
  // ============================================================================

  private async processEvent(event: SafetyEvent): Promise<void> {
    if (!this.config.enabled) return;

    // Run all enabled rules against this event
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      // Check cooldown
      const lastTriggered = this.lastTriggered.get(rule.id) || 0;
      if (Date.now() - lastTriggered < rule.cooldownMs) continue;

      try {
        const finding = await this.evaluateRule(rule, event);
        if (finding) {
          await this.handleFinding(finding, rule);
        }
      } catch (error) {
        logger.error({ err: error, ruleId: rule.id }, "[SafetyWatcher] Rule evaluation failed");
      }
    }
  }

  private async evaluateRule(rule: SafetyRule, event: SafetyEvent): Promise<SafetyFinding | null> {
    switch (rule.id) {
      case "runaway_loop":
        return this.checkRunawayLoop(rule, event);
      case "token_burn":
        return this.checkTokenBurn(rule, event);
      case "security_violation":
        return this.checkSecurityViolation(rule, event);
      case "deployment_failure":
        return this.checkDeploymentFailure(rule, event);
      case "error_pattern":
        return this.checkErrorPattern(rule, event);
      case "policy_violation":
        return this.checkPolicyViolation(rule, event);
      case "resource_exhaustion":
        return this.checkResourceExhaustion(rule, event);
      case "stalled_task":
        return this.checkStalledTask(rule, event);
      default:
        return null;
    }
  }

  // ============================================================================
  // Individual Rule Checks
  // ============================================================================

  private checkRunawayLoop(rule: SafetyRule, event: SafetyEvent): SafetyFinding | null {
    if (event.source !== "task-registry") return null;
    if (event.payload.taskType !== "agent-loop") return null;

    const metadata = event.payload.metadata as Record<string, unknown> | undefined;
    const iteration = (metadata?.iteration as number) || 0;
    const tokenBudgetPercent = (metadata?.tokenBudgetPercent as number) || 0;
    const maxIterations = (rule.threshold?.maxIterations as number) || 50;
    const maxTokenBudget = (rule.threshold?.tokenBudgetPercent as number) || 80;

    if (iteration >= maxIterations || tokenBudgetPercent >= maxTokenBudget) {
      return {
        id: `finding-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        title: `Agent runaway loop detected: ${event.payload.title}`,
        description: `Agent has run ${iteration} iterations (limit: ${maxIterations}) with ${tokenBudgetPercent}% token budget used (limit: ${maxTokenBudget}%)`,
        source: event.source,
        sourceType: "agent-loop",
        evidence: { iteration, tokenBudgetPercent, taskId: event.payload.taskId },
        suggestedActions: rule.actions,
        timestamp: new Date(),
        acknowledged: false,
      };
    }
    return null;
  }

  private checkTokenBurn(rule: SafetyRule, event: SafetyEvent): SafetyFinding | null {
    if (event.source !== "task-registry") return null;

    const metadata = event.payload.metadata as Record<string, unknown> | undefined;
    const tokens = (metadata?.tokens as number) || 0;
    const estimatedCost = (metadata?.estimatedCostUsd as number) || 0;
    const maxTokens = (rule.threshold?.maxTokens as number) || 100000;
    const maxCost = (rule.threshold?.maxCostUsd as number) || 5;

    if (tokens >= maxTokens || estimatedCost >= maxCost) {
      return {
        id: `finding-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        title: `High token usage detected: ${event.payload.title}`,
        description: `Operation used ${tokens.toLocaleString()} tokens (estimated $${estimatedCost.toFixed(4)})`,
        source: event.source,
        sourceType: event.payload.taskType as string,
        evidence: { tokens, estimatedCost, taskId: event.payload.taskId },
        suggestedActions: rule.actions,
        timestamp: new Date(),
        acknowledged: false,
      };
    }
    return null;
  }

  private checkSecurityViolation(rule: SafetyRule, event: SafetyEvent): SafetyFinding | null {
    const payload = event.payload;
    let violation: string | null = null;
    let evidence: Record<string, unknown> = {};

    // Check for sensitive domain access (browser events)
    if (event.type === "browser:navigate" || event.type === "browser:action") {
      const url = (payload.url as string) || "";
      // This would integrate with browser-policy.ts sensitive domain registry
      // For now, check common patterns
      const sensitivePatterns = [
        /bank/i,
        /paypal/i,
        /stripe/i,
        /aws\.amazon\.com/i,
        /console\.cloud\.google\.com/i,
        /portal\.azure\.com/i,
        /github\.com\/settings\/tokens/i,
        /1password/i,
        /lastpass/i,
        /bitwarden/i,
      ];
      if (sensitivePatterns.some((p) => p.test(url))) {
        violation = `Browser accessed sensitive domain: ${url}`;
        evidence = { url, domain: new URL(url).hostname };
      }
    }

    // Check for secrets in code (build events)
    if (event.type === "build:phase-complete" || event.type === "task:updated") {
      const files = (payload.filesGenerated as string[]) || [];
      const secretPatterns = [
        /api[_-]?key/i,
        /secret/i,
        /password/i,
        /token/i,
        /private[_-]?key/i,
        /access[_-]?token/i,
      ];
      // This would need actual file content scanning
    }

    // Check for PII in logs
    if (event.type === "log" || event.type === "task:updated") {
      const message = (payload.message as string) || "";
      const piiPatterns = [
        /\b\d{3}-\d{2}-\d{4}\b/, // SSN
        /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Credit card
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, // Email
      ];
      if (piiPatterns.some((p) => p.test(message))) {
        violation = `PII detected in logs`;
        evidence = { message: message.slice(0, 200) };
      }
    }

    if (violation) {
      return {
        id: `finding-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        title: `Security violation: ${violation}`,
        description: violation,
        source: event.source,
        sourceType: event.type,
        evidence,
        suggestedActions: rule.actions,
        timestamp: new Date(),
        acknowledged: false,
      };
    }
    return null;
  }

  private checkDeploymentFailure(rule: SafetyRule, event: SafetyEvent): SafetyFinding | null {
    if (event.source !== "task-registry") return null;
    if (event.payload.taskType !== "deploy") return null;

    const status = event.payload.status as TaskStatus;
    if (status === "error") {
      return {
        id: `finding-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        title: `Deployment failed: ${event.payload.title}`,
        description: `Deployment task failed: ${event.payload.description}`,
        source: event.source,
        sourceType: "deployment",
        evidence: { taskId: event.payload.taskId, metadata: event.payload.metadata },
        suggestedActions: rule.actions,
        timestamp: new Date(),
        acknowledged: false,
      };
    }
    return null;
  }

  private checkErrorPattern(rule: SafetyRule, event: SafetyEvent): SafetyFinding | null {
    // Track errors across all events
    if (event.type.includes("error") || event.payload.status === "error") {
      const errorKey = `${event.source}:${event.payload.taskType}:${event.payload.description}`.slice(0, 200);
      const now = Date.now();
      const windowMs = ((rule.threshold?.windowMinutes as number) || 10) * 60 * 1000;
      const maxOccurrences = (rule.threshold?.maxOccurrences as number) || 3;

      const existing = this.errorCounts.get(errorKey) || { count: 0, firstSeen: now };

      if (now - existing.firstSeen > windowMs) {
        // Reset window
        this.errorCounts.set(errorKey, { count: 1, firstSeen: now });
      } else {
        existing.count++;
        this.errorCounts.set(errorKey, existing);

        if (existing.count >= maxOccurrences) {
          // Trigger finding
          this.errorCounts.delete(errorKey); // Reset after triggering

          return {
            id: `finding-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            title: `Recurring error pattern detected`,
            description: `Error "${errorKey}" occurred ${existing.count} times in ${rule.threshold?.windowMinutes} minutes`,
            source: event.source,
            sourceType: "error-pattern",
            evidence: { errorKey, count: existing.count, windowMinutes: rule.threshold?.windowMinutes },
            suggestedActions: rule.actions,
            timestamp: new Date(),
            acknowledged: false,
          };
        }
      }
    }
    return null;
  }

  private checkPolicyViolation(rule: SafetyRule, event: SafetyEvent): SafetyFinding | null {
    // Check for policy violations from browser pool, agent actions, etc.
    if (event.type === "policy:violation" || event.type === "browser:policy-violation") {
      return {
        id: `finding-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        title: `Policy violation: ${event.payload.violationType || "Unknown"}`,
        description: `${event.payload.description || "Agent attempted forbidden action"}`,
        source: event.source,
        sourceType: "policy",
        evidence: event.payload,
        suggestedActions: rule.actions,
        timestamp: new Date(),
        acknowledged: false,
      };
    }
    return null;
  }

  private checkResourceExhaustion(rule: SafetyRule, event: SafetyEvent): SafetyFinding | null {
    // This would typically come from system monitoring events
    if (event.type === "system:metrics") {
      const memoryPercent = (event.payload.memoryPercent as number) || 0;
      const diskPercent = (event.payload.diskPercent as number) || 0;
      const cpuPercent = (event.payload.cpuPercent as number) || 0;

      const thresholds = {
        memory: (rule.threshold?.memoryPercent as number) || 90,
        disk: (rule.threshold?.diskPercent as number) || 90,
        cpu: (rule.threshold?.cpuPercent as number) || 80,
      };

      const violations: string[] = [];
      if (memoryPercent >= thresholds.memory) violations.push(`Memory: ${memoryPercent}%`);
      if (diskPercent >= thresholds.disk) violations.push(`Disk: ${diskPercent}%`);
      if (cpuPercent >= thresholds.cpu) violations.push(`CPU: ${cpuPercent}%`);

      if (violations.length > 0) {
        return {
          id: `finding-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          title: `Resource exhaustion detected`,
          description: violations.join(", "),
          source: event.source,
          sourceType: "system",
          evidence: { memoryPercent, diskPercent, cpuPercent, thresholds },
          suggestedActions: rule.actions,
          timestamp: new Date(),
          acknowledged: false,
        };
      }
    }
    return null;
  }

  private checkStalledTask(rule: SafetyRule, event: SafetyEvent): SafetyFinding | null {
    if (event.source !== "task-registry") return null;

    const status = event.payload.status as TaskStatus;
    const progress = (event.payload.progress as number) || 0;

    // Check running tasks that haven't progressed
    if (status === "running" && progress > 0 && progress < 100) {
      const taskId = event.payload.taskId as string;
      const task = this.taskRegistry.getTask(taskId);
      if (task) {
        const stallMinutes = (rule.threshold?.stallMinutes as number) || 10;
        const stallMs = stallMinutes * 60 * 1000;
        const timeSinceUpdate = Date.now() - task.updatedAt.getTime();

        if (timeSinceUpdate > stallMs) {
          return {
            id: `finding-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            title: `Task stalled: ${task.title}`,
            description: `Task ${task.id} (${task.type}) has not progressed for ${stallMinutes} minutes (progress: ${progress}%)`,
            source: event.source,
            sourceType: "task",
            evidence: { taskId, taskType: task.type, progress, stallMinutes, lastUpdate: task.updatedAt },
            suggestedActions: rule.actions,
            timestamp: new Date(),
            acknowledged: false,
          };
        }
      }
    }
    return null;
  }

  // ============================================================================
  // Finding Handling & Notifications
  // ============================================================================

  private async handleFinding(finding: SafetyFinding, rule: SafetyRule): Promise<void> {
    // Store finding
    this.findings.set(finding.id, finding);
    this.lastTriggered.set(rule.id, Date.now());

    // Emit finding event
    this.emit("finding", finding);

    // Determine if we should notify (quiet hours check)
    if (this.shouldNotify(finding.severity)) {
      await this.sendNotifications(finding);
    }

    // Execute actions
    await this.executeActions(finding, rule.actions);

    logger.warn(
      { findingId: finding.id, ruleId: rule.id, severity: finding.severity, title: finding.title },
      "[SafetyWatcher] Safety finding triggered"
    );
  }

  private shouldNotify(severity: SafetySeverity): boolean {
    if (!this.config.quietHours.enabled) return true;

    const now = new Date();
    const tz = this.config.quietHours.timezone;
    const currentHour = now.toLocaleString("en-US", { timeZone: tz, hour: "2-digit", hour12: false });
    const currentMinute = now.toLocaleString("en-US", { timeZone: tz, minute: "2-digit" });
    const currentTime = `${currentHour}:${currentMinute}`;

    const start = this.config.quietHours.start;
    const end = this.config.quietHours.end;

    // Handle overnight quiet hours (e.g., 22:00 - 08:00)
    if (start > end) {
      return !(currentTime >= start || currentTime <= end);
    } else {
      return !(currentTime >= start && currentTime <= end);
    }
  }

  private async sendNotifications(finding: SafetyFinding): Promise<void> {
    const { webPush, email, slack, discord, inApp, webhookUrl } = this.config.notifications;
    const projectId = this.config.projectId || "global";

    const title = `[${finding.severity.toUpperCase()}] ${finding.title}`;
    const body = `${finding.description}\n\nSource: ${finding.source} (${finding.sourceType})`;

    // Web Push
    if (webPush) {
      try {
        await sendWebPush(title, body, "/safety");
      } catch (error) {
        logger.error({ err: error }, "[SafetyWatcher] Web Push failed");
      }
    }

    // Connectors (Slack, Discord, Email via notification-dispatch)
    if (email || slack || discord) {
      try {
        await dispatchNotification(projectId, "safety_finding", title, body, {
          metadata: { findingId: finding.id, severity: finding.severity, ruleId: finding.ruleId },
        });
      } catch (error) {
        logger.error({ err: error }, "[SafetyWatcher] Connector notification failed");
      }
    }

    // Custom webhook
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            finding,
            timestamp: new Date().toISOString(),
          }),
        });
      } catch (error) {
        logger.error({ err: error }, "[SafetyWatcher] Webhook notification failed");
      }
    }

    // In-app notification would be handled via SSE to frontend
    if (inApp) {
      this.emit("in-app-notification", finding);
    }
  }

  private async executeActions(finding: SafetyFinding, actions: SafetyAction[]): Promise<void> {
    for (const action of actions) {
      switch (action) {
        case "pause_agent":
          await this.pauseAgent(finding);
          break;
        case "rollback":
          await this.requestRollback(finding);
          break;
        case "throttle":
          await this.throttleOperations(finding);
          break;
        case "request_human":
          // Already handled via notification
          break;
        case "notify":
          // Already handled
          break;
      }
    }
  }

  private async pauseAgent(finding: SafetyFinding): Promise<void> {
    const taskId = finding.evidence.taskId as string | undefined;
    if (taskId) {
      const task = this.taskRegistry.getTask(taskId);
      if (task && task.type === "agent-loop") {
        await this.taskRegistry.updateTask(taskId, { status: "paused" });
        logger.info({ taskId }, "[SafetyWatcher] Paused agent task");
      }
    }
  }

  private async requestRollback(finding: SafetyFinding): Promise<void> {
    // Would integrate with deployment engine to trigger rollback
    logger.info({ findingId: finding.id }, "[SafetyWatcher] Rollback requested");
    this.emit("rollback-requested", finding);
  }

  private async throttleOperations(finding: SafetyFinding): Promise<void> {
    // Would integrate with orchestration to reduce parallelism
    logger.info({ findingId: finding.id }, "[SafetyWatcher] Throttle requested");
    this.emit("throttle-requested", finding);
  }

  // ============================================================================
  // Periodic Checks
  // ============================================================================

  private async runPeriodicChecks(): Promise<void> {
    if (!this.isRunning) return;

    // Check for stalled tasks
    await this.checkAllStalledTasks();

    // Check resource usage (if system metrics available)
    await this.checkSystemResources();

    // Clean up old error counts
    this.cleanupErrorCounts();
  }

  private async checkAllStalledTasks(): Promise<void> {
    const activeTasks = this.taskRegistry.getActiveTasks();
    const stallRule = this.rules.get("stalled_task");
    if (!stallRule || !stallRule.enabled) return;

    const stallMinutes = (stallRule.threshold?.stallMinutes as number) || 10;
    const stallMs = stallMinutes * 60 * 1000;
    const now = Date.now();

    for (const task of activeTasks) {
      if (task.status === "running" && task.progress > 0 && task.progress < 100) {
        const timeSinceUpdate = now - task.updatedAt.getTime();
        if (timeSinceUpdate > stallMs) {
          // Create a synthetic event to trigger the rule
          const event: SafetyEvent = {
            id: `stall-check-${task.id}-${now}`,
            timestamp: new Date(),
            source: "task-registry",
            type: "task:stalled",
            payload: {
              taskId: task.id,
              taskType: task.type,
              title: task.title,
              description: task.description,
              progress: task.progress,
              status: task.status,
              metadata: task.metadata,
            },
          };
          await this.processEvent(event);
        }
      }
    }
  }

  private async checkSystemResources(): Promise<void> {
    // This would integrate with actual system monitoring
    // For now, we'll skip unless a metrics event is emitted
  }

  private cleanupErrorCounts(): void {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes

    for (const [key, value] of this.errorCounts) {
      if (now - value.firstSeen > maxAge) {
        this.errorCounts.delete(key);
      }
    }
  }

  // ============================================================================
  // Local Model Integration
  // ============================================================================

  private async checkOllamaAvailability(): Promise<void> {
    if (this.config.localModel.provider !== "ollama") return;

    try {
      const response = await fetch(`${this.config.localModel.endpoint}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(this.config.localModel.timeoutMs),
      });
      if (response.ok) {
        const data = await response.json();
        const models = data.models?.map((m: { name: string }) => m.name) || [];
        const targetModel = this.config.localModel.model || "llama3.2:1b";
        this.ollamaAvailable = models.some((m: string) => m.includes(targetModel.split(":")[0]));
        logger.info({ available: this.ollamaAvailable, models }, "[SafetyWatcher] Ollama status");
      }
    } catch {
      this.ollamaAvailable = false;
      logger.info("[SafetyWatcher] Ollama not available, will use fallback");
    }
  }

  /**
   * Analyze event with local LLM for complex pattern detection
   */
  async analyzeWithLocalModel(event: SafetyEvent, prompt: string): Promise<string | null> {
    if (this.config.localModel.provider === "disabled") return null;

    switch (this.config.localModel.provider) {
      case "ollama":
        return this.callOllama(prompt);
      case "transformers":
        return this.callTransformers(prompt);
      case "free-api":
        return this.callFreeApi(prompt);
      default:
        return null;
    }
  }

  private async callOllama(prompt: string): Promise<string | null> {
    if (!this.ollamaAvailable) return null;

    try {
      const response = await fetch(`${this.config.localModel.endpoint}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.localModel.model,
          prompt,
          stream: false,
          options: { temperature: 0.1, num_predict: 500 },
        }),
        signal: AbortSignal.timeout(this.config.localModel.timeoutMs),
      });

      if (response.ok) {
        const data = await response.json();
        return data.response?.trim() || null;
      }
    } catch (error) {
      logger.warn({ err: error }, "[SafetyWatcher] Ollama call failed");
    }
    return null;
  }

  private async callTransformers(prompt: string): Promise<string | null> {
    // Would use Transformers.js (WASM) in browser or Node
    // For server-side, we'd need @xenova/transformers with ONNX runtime
    logger.info("[SafetyWatcher] Transformers.js fallback not yet implemented");
    return null;
  }

  private async callFreeApi(prompt: string): Promise<string | null> {
    // Free tier APIs like Groq, Together AI
    logger.info("[SafetyWatcher] Free API fallback not yet implemented");
    return null;
  }

  // ============================================================================
  // Public API
  // ============================================================================

  getConfig(): WatcherConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<WatcherConfig>): void {
    this.config = this.mergeConfig(config);
    this.rules.clear();
    this.initializeRules();
    logger.info("[SafetyWatcher] Configuration updated");
  }

  getRule(ruleId: string): SafetyRule | undefined {
    return this.rules.get(ruleId);
  }

  getAllRules(): SafetyRule[] {
    return Array.from(this.rules.values());
  }

  updateRule(ruleId: string, updates: Partial<SafetyRule>): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule) return false;

    this.rules.set(ruleId, { ...rule, ...updates });
    return true;
  }

  getFindings(filter?: { severity?: SafetySeverity; acknowledged?: boolean; since?: Date }): SafetyFinding[] {
    let result = Array.from(this.findings.values());

    if (filter?.severity) {
      result = result.filter((f) => f.severity === filter.severity);
    }
    if (filter?.acknowledged !== undefined) {
      result = result.filter((f) => f.acknowledged === filter.acknowledged);
    }
    if (filter?.since) {
      result = result.filter((f) => f.timestamp >= filter.since!);
    }

    return result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  acknowledgeFinding(findingId: string): boolean {
    const finding = this.findings.get(findingId);
    if (!finding) return false;
    finding.acknowledged = true;
    return true;
  }

  snoozeFinding(findingId: string, durationMs: number): boolean {
    const finding = this.findings.get(findingId);
    if (!finding) return false;
    finding.snoozedUntil = new Date(Date.now() + durationMs);
    return true;
  }

  getStatus(): { running: boolean; rulesEnabled: number; findingsCount: number; ollamaAvailable: boolean } {
    return {
      running: this.isRunning,
      rulesEnabled: Array.from(this.rules.values()).filter((r) => r.enabled).length,
      findingsCount: this.findings.size,
      ollamaAvailable: this.ollamaAvailable,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let watcherInstance: SafetyWatcher | null = null;

export function getSafetyWatcher(config?: Partial<WatcherConfig>): SafetyWatcher {
  if (!watcherInstance) {
    watcherInstance = new SafetyWatcher(config);
  }
  return watcherInstance;
}

export async function initializeSafetyWatcher(config?: Partial<WatcherConfig>): Promise<SafetyWatcher> {
  const watcher = getSafetyWatcher(config);
  await watcher.start();
  return watcher;
}

export async function shutdownSafetyWatcher(): Promise<void> {
  if (watcherInstance) {
    await watcherInstance.stop();
    watcherInstance = null;
  }
}

// ============================================================================
// Integration Helpers
// ============================================================================

/**
 * Call this from Universal Agent to emit agent iteration events
 */
export async function emitAgentIterationEvent(
  agentId: string,
  iteration: number,
  goal: string,
  tokensUsed: number,
  tokenBudgetPercent: number,
  toolsUsed: string[]
): Promise<void> {
  const watcher = getSafetyWatcher();
  const event: SafetyEvent = {
    id: `agent-${agentId}-iter-${iteration}-${Date.now()}`,
    timestamp: new Date(),
    source: "universal-agent",
    type: "agent:iteration",
    payload: {
      agentId,
      iteration,
      goal,
      tokensUsed,
      tokenBudgetPercent,
      toolsUsed,
    },
  };
  await watcher.emitEvent(event);
}

/**
 * Call this from Build Orchestrator to emit build phase events
 */
export async function emitBuildPhaseEvent(
  projectId: string,
  buildId: string,
  phase: string,
  status: "started" | "complete" | "error",
  details: Record<string, unknown>
): Promise<void> {
  const watcher = getSafetyWatcher();
  const event: SafetyEvent = {
    id: `build-${buildId}-${phase}-${status}-${Date.now()}`,
    timestamp: new Date(),
    source: "build-orchestrator",
    type: `build:phase-${status}`,
    payload: {
      projectId,
      buildId,
      phase,
      status,
      ...details,
    },
  };
  await watcher.emitEvent(event);
}

/**
 * Call this from Deployment Engine to emit deployment events
 */
export async function emitDeploymentEvent(
  projectId: string,
  deploymentId: string,
  provider: string,
  environment: string,
  status: "started" | "complete" | "failed" | "rollback",
  details: Record<string, unknown>
): Promise<void> {
  const watcher = getSafetyWatcher();
  const event: SafetyEvent = {
    id: `deploy-${deploymentId}-${status}-${Date.now()}`,
    timestamp: new Date(),
    source: "deployment-engine",
    type: `deploy:${status}`,
    payload: {
      projectId,
      deploymentId,
      provider,
      environment,
      status,
      ...details,
    },
  };
  await watcher.emitEvent(event);
}

/**
 * Call this from Browser Pool to emit browser policy events
 */
export async function emitBrowserPolicyEvent(
  action: string,
  url: string,
  violationType: string,
  details: Record<string, unknown>
): Promise<void> {
  const watcher = getSafetyWatcher();
  const event: SafetyEvent = {
    id: `browser-${violationType}-${Date.now()}`,
    timestamp: new Date(),
    source: "browser-pool",
    type: "browser:policy-violation",
    payload: {
      action,
      url,
      violationType,
      ...details,
    },
  };
  await watcher.emitEvent(event);
}

/**
 * Call this from Automation Runtime to emit automation events
 */
export async function emitAutomationEvent(
  automationId: string,
  runId: string,
  triggerType: string,
  status: "started" | "complete" | "error",
  details: Record<string, unknown>
): Promise<void> {
  const watcher = getSafetyWatcher();
  const event: SafetyEvent = {
    id: `automation-${automationId}-${runId}-${status}-${Date.now()}`,
    timestamp: new Date(),
    source: "automation-runtime",
    type: `automation:${status}`,
    payload: {
      automationId,
      runId,
      triggerType,
      status,
      ...details,
    },
  };
  await watcher.emitEvent(event);
}

/**
 * Call this to emit system resource metrics
 */
export async function emitSystemMetrics(
  memoryPercent: number,
  diskPercent: number,
  cpuPercent: number
): Promise<void> {
  const watcher = getSafetyWatcher();
  const event: SafetyEvent = {
    id: `system-metrics-${Date.now()}`,
    timestamp: new Date(),
    source: "system-monitor",
    type: "system:metrics",
    payload: {
      memoryPercent,
      diskPercent,
      cpuPercent,
    },
  };
  await watcher.emitEvent(event);
}