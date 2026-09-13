/**
 * Phase 3: Local Watchdog — Sidecar monitor for the build agent loop
 *
 * Spawns per build; samples transcript + tool calls every N turns.
 * - Error detection: classify tool results (exit code ≠ 0, stderr patterns, verification failures)
 * - Policy detection: local model scores for illegal/harmful/off-track against user-defined rules in project instructions
 * - Hard stop + all-device push: kill agent loop, iterate user's push subscriptions, notify every device
 * - User-defined watchdog rules (e.g., "never write to /etc", "no eval") from project instructions
 *
 * Acceptance gate: inject deliberate error (infinite loop or policy violation) → watcher stops build within 3 turns → push notification received on phone + desktop.
 */

import { EventEmitter } from "events";
import { createLocalAdapter, isLocalModelAvailable, LocalModelAdapter } from "./adapters/local-adapter";
import { getWebPushService, type PushPayload } from "./web-push-service";
import { logBuildEvent } from "./build-telemetry";
import { MessageBus } from "./build-message-bus";
import { askHelper } from "./build-helper";
import type { ToolCall, ToolResult, ToolExecutionContext } from "./build-tools";

export interface WatchdogConfig {
  projectId: string;
  threadId: string;
  /** Sampling interval: check every N agent turns */
  sampleEveryNTurns: number;
  /** Maximum turns before force-stop (safety backstop) */
  maxTurnsBeforeForceStop: number;
  /** Local model for policy scoring */
  localModel?: LocalModelAdapter;
  /** Enable/disable watchdog */
  enabled: boolean;
  /** User-defined rules from project instructions */
  userRules: WatchdogRule[];
}

export interface WatchdogRule {
  id: string;
  description: string;
  /** Pattern to match in tool calls / results / agent output */
  pattern: string;
  /** Severity when triggered */
  severity: "warning" | "critical" | "emergency";
  /** Action to take */
  action: "notify" | "stop" | "notify_and_stop";
  /** Whether this rule is active */
  enabled: boolean;
}

export interface WatchdogFinding {
  id: string;
  timestamp: Date;
  turn: number;
  ruleId: string | null;
  type: "error" | "policy" | "stall" | "resource";
  severity: "info" | "warning" | "critical" | "emergency";
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  suggestedAction: "continue" | "notify" | "stop" | "notify_and_stop";
}

export interface AgentTurnSample {
  turn: number;
  timestamp: Date;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  agentResponse: string;
  tokenUsage?: { prompt: number; completion: number; total: number };
}

export class BuildWatchdog extends EventEmitter {
  private config: WatchdogConfig;
  private bus: MessageBus;
  private turnBuffer: AgentTurnSample[] = [];
  private currentTurn = 0;
  private isRunning = false;
  private watchInterval: NodeJS.Timeout | null = null;
  private findings: Map<string, WatchdogFinding> = new Map();
  private lastSampledTurn = -1;
  private agentStopped = false;
  private stopReason: string | null = null;
  /** Interval in ms for periodic sampling (default 2000, can be overridden for testing) */
  private sampleIntervalMs: number = 2000;

  constructor(config: Partial<WatchdogConfig> & { projectId: string; threadId: string; sampleIntervalMs?: number }) {
    super();
    // Start with default rules, then add user-provided rules
    const defaultRules = this.getDefaultRules();
    const userRules = config.userRules ?? [];
    const mergedRules = [...defaultRules, ...userRules];

    this.config = {
      sampleEveryNTurns: config.sampleEveryNTurns ?? 1,
      maxTurnsBeforeForceStop: config.maxTurnsBeforeForceStop ?? 50,
      enabled: config.enabled ?? true,
      userRules: mergedRules,
      localModel: config.localModel,
      projectId: config.projectId,
      threadId: config.threadId,
    };
    this.bus = new MessageBus(config.projectId, config.threadId);
    if (config.sampleIntervalMs) {
      this.sampleIntervalMs = config.sampleIntervalMs;
    }
  }

  /**
   * Start the watchdog - begins sampling the agent conversation
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    if (!this.config.enabled) {
      console.log("[BuildWatchdog] Disabled via config");
      return;
    }

    // Initialize local model for policy detection
    if (!this.config.localModel) {
      try {
        const available = await isLocalModelAvailable();
        if (available) {
          this.config.localModel = await createLocalAdapter();
          console.log("[BuildWatchdog] Local model (Ollama) initialized for policy detection");
        } else {
          console.log("[BuildWatchdog] Local model not available — policy detection will use pattern matching only");
        }
      } catch (err) {
        console.warn("[BuildWatchdog] Failed to initialize local model:", err);
      }
    }

    // Load user-defined rules from project instructions if not provided
    if (this.config.userRules.length === 0) {
      await this.loadUserRulesFromProjectInstructions();
    }

    this.isRunning = true;
    this.agentStopped = false;
    this.stopReason = null;

    // Start periodic sampling from the message bus
    this.watchInterval = setInterval(() => this.sampleAndAnalyze(), this.sampleIntervalMs);

    console.log(`[BuildWatchdog] Started monitoring project ${this.config.projectId}, thread ${this.config.threadId} (interval: ${this.sampleIntervalMs}ms)`);
    this.emit("started");
  }

  /**
   * Stop the watchdog
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }

    this.isRunning = false;
    console.log("[BuildWatchdog] Stopped monitoring");
    this.emit("stopped");
  }

  /**
   * Record an agent turn for analysis (called by the build orchestrator/agent)
   */
  recordTurn(sample: AgentTurnSample): void {
    this.turnBuffer.push(sample);
    this.currentTurn = sample.turn;

    // Keep only last 20 turns in memory
    if (this.turnBuffer.length > 20) {
      this.turnBuffer.shift();
    }
  }

  /**
   * Immediately analyze a specific turn (for testing/integration)
   */
  async analyzeImmediate(turnNumber: number): Promise<void> {
    if (!this.isRunning || this.agentStopped) return;

    // Find the turn in the buffer
    const turn = this.turnBuffer.find(t => t.turn === turnNumber);
    if (turn) {
      await this.analyzeTurn(turn);
    }

    // Check for stall (max turns exceeded)
    if (this.currentTurn >= this.config.maxTurnsBeforeForceStop) {
      await this.forceStop(`Agent exceeded maximum turns (${this.config.maxTurnsBeforeForceStop})`);
    }

    // Check for repeated tool calls (infinite loop pattern)
    await this.checkForRepeatedPatterns();
  }

  /**
   * Force stop the agent (called when watchdog triggers a stop)
   */
  async forceStop(reason: string): Promise<void> {
    if (this.agentStopped) return;

    this.agentStopped = true;
    this.stopReason = reason;

    // Post a steering message to the bus to halt the agent
    await this.bus.post({
      projectId: this.config.projectId,
      fromRole: "watchdog",
      toRole: "orchestrator",
      kind: "orchestrator",
      content: `WATCHDOG STOP: ${reason}`,
      payload: { watchdogStop: true, reason, turn: this.currentTurn },
    });

    // Send push notification to all devices
    await this.sendPushNotification(
      "🛑 Build Stopped by Watchdog",
      `${reason} (turn ${this.currentTurn})`,
      "/build"
    );

    // Emit stop event for the orchestrator to react to
    this.emit("force_stop", { reason, turn: this.currentTurn });

    console.error(`[BuildWatchdog] FORCE STOP: ${reason}`);
  }

  /**
   * Get current status
   */
  getStatus(): {
    running: boolean;
    currentTurn: number;
    findingsCount: number;
    agentStopped: boolean;
    stopReason: string | null;
    rulesLoaded: number;
    localModelAvailable: boolean;
  } {
    return {
      running: this.isRunning,
      currentTurn: this.currentTurn,
      findingsCount: this.findings.size,
      agentStopped: this.agentStopped,
      stopReason: this.stopReason,
      rulesLoaded: this.config.userRules.length,
      localModelAvailable: !!this.config.localModel,
    };
  }

  /**
   * Get all findings
   */
  getFindings(): WatchdogFinding[] {
    return Array.from(this.findings.values()).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Load user-defined rules from project instructions
   */
  private async loadUserRulesFromProjectInstructions(): Promise<void> {
    try {
      // Use the helper to search for watchdog-related instructions
      const helperAnswer = await askHelper(this.config.projectId, "What are the watchdog rules or safety rules defined in the project instructions?", {
        context: {
          conversation: [],
          workingContext: { goal: "Find watchdog/safety rules from project instructions" },
        },
      });

      if (helperAnswer.hits.length > 0) {
        // Parse rules from the hits - in a real implementation, we'd parse structured rules
        // For now, we'll use a default set of dangerous patterns
        this.config.userRules = this.getDefaultRules();
      } else {
        this.config.userRules = this.getDefaultRules();
      }
    } catch (err) {
      console.warn("[BuildWatchdog] Failed to load user rules, using defaults:", err);
      this.config.userRules = this.getDefaultRules();
    }
  }

  /**
   * Default watchdog rules for dangerous patterns
   */
  private getDefaultRules(): WatchdogRule[] {
    return [
      {
        id: "no_write_etc",
        description: "Never write to /etc or system directories",
        pattern: "/etc/",
        severity: "emergency",
        action: "notify_and_stop",
        enabled: true,
      },
      {
        id: "no_eval",
        description: "No eval() or dynamic code execution",
        pattern: "eval(",
        severity: "critical",
        action: "notify_and_stop",
        enabled: true,
      },
      {
        id: "no_rm_rf",
        description: "No recursive force delete",
        pattern: "rm -rf",
        severity: "critical",
        action: "notify_and_stop",
        enabled: true,
      },
      {
        id: "no_curl_pipe_sh",
        description: "No piping curl to shell",
        pattern: "curl.*\\|.*sh",
        severity: "critical",
        action: "notify_and_stop",
        enabled: true,
      },
      {
        id: "no_wget_pipe_sh",
        description: "No piping wget to shell",
        pattern: "wget.*\\|.*sh",
        severity: "critical",
        action: "notify_and_stop",
        enabled: true,
      },
      {
        id: "no_chmod_777",
        description: "No world-writable permissions",
        pattern: "chmod 777",
        severity: "warning",
        action: "notify",
        enabled: true,
      },
      {
        id: "no_secrets_in_code",
        description: "No API keys, secrets, passwords in code",
        pattern: "(api[_-]?key|secret|password|token)\\s*[=:]", // generic pattern
        severity: "critical",
        action: "notify_and_stop",
        enabled: true,
      },
      {
        id: "infinite_loop",
        description: "Potential infinite loop detected (same tool calls repeated)",
        pattern: "repeated_tool_calls",
        severity: "warning",
        action: "notify",
        enabled: true,
      },
      {
        id: "off_track",
        description: "Agent going off-track from original goal",
        pattern: "off_track",
        severity: "warning",
        action: "notify",
        enabled: true,
      },
    ];
  }

  /**
   * Main sampling and analysis loop
   */
  private async sampleAndAnalyze(): Promise<void> {
    if (!this.isRunning || this.agentStopped) return;

    try {
      // Get recent messages from the bus (agent conversation)
      const thread = await this.bus.getThread({ includeLive: true, limit: 50 });

      // Find new turns since last sample
      const newTurns = this.extractTurnsFromThread(thread);

      for (const turn of newTurns) {
        if (turn.turn <= this.lastSampledTurn) continue;
        if (turn.turn % this.config.sampleEveryNTurns !== 0) continue;

        this.lastSampledTurn = turn.turn;
        await this.analyzeTurn(turn);
      }

      // Check for stall (max turns exceeded)
      if (this.currentTurn >= this.config.maxTurnsBeforeForceStop) {
        await this.forceStop(`Agent exceeded maximum turns (${this.config.maxTurnsBeforeForceStop})`);
      }

      // Check for repeated tool calls (infinite loop pattern)
      await this.checkForRepeatedPatterns();
    } catch (err) {
      console.error("[BuildWatchdog] Sample/analyze error:", err);
    }
  }

  /**
   * Extract turn samples from message bus thread
   */
  private extractTurnsFromThread(thread: any[]): AgentTurnSample[] {
    const turns: AgentTurnSample[] = [];
    let currentTurn = -1;
    let currentToolCalls: ToolCall[] = [];
    let currentToolResults: ToolResult[] = [];
    let currentAgentResponse = "";

    for (const msg of thread) {
      // Messages from the agent have role info in payload or kind
      if (msg.kind === "handoff" || msg.kind === "message" || msg.kind === "orchestrator") {
        // This could be an agent response
        if (msg.fromRole && ["planner", "coder", "reviewer", "fixer", "orchestrator"].includes(msg.fromRole)) {
          currentTurn++;
          if (currentToolCalls.length > 0 || currentAgentResponse) {
            turns.push({
              turn: currentTurn,
              timestamp: new Date(msg.createdAt),
              toolCalls: [...currentToolCalls],
              toolResults: [...currentToolResults],
              agentResponse: currentAgentResponse,
            });
          }
          currentToolCalls = [];
          currentToolResults = [];
          currentAgentResponse = msg.content || "";
        }
      }

      // Tool calls/results would be in the bus as well
      // In practice, these come from the build-orchestrator calling recordTurn()
    }

    // Also check our local buffer
    for (const sample of this.turnBuffer) {
      if (sample.turn > this.lastSampledTurn) {
        turns.push(sample);
      }
    }

    return turns;
  }

  /**
   * Analyze a single turn for errors and policy violations
   */
  private async analyzeTurn(turn: AgentTurnSample): Promise<void> {
    // 1. Error detection - check tool results for failures
    await this.detectErrors(turn);

    // 2. Policy detection - check tool calls and agent output against rules
    await this.detectPolicyViolations(turn);

    // 3. Local model policy scoring (if available)
    if (this.config.localModel) {
      await this.scoreWithLocalModel(turn);
    }
  }

  /**
   * Detect errors in tool results
   */
  private async detectErrors(turn: AgentTurnSample): Promise<void> {
    for (const result of turn.toolResults) {
      if (!result.success) {
        const errorMsg = result.error || "Unknown error";
        const finding: WatchdogFinding = {
          id: `error-${turn.turn}-${Date.now()}`,
          timestamp: turn.timestamp,
          turn: turn.turn,
          ruleId: null,
          type: "error",
          severity: this.classifyErrorSeverity(errorMsg),
          title: `Tool execution failed: ${turn.toolCalls.find(c => c.id === result.id)?.name || "unknown"}`,
          description: errorMsg,
          evidence: { toolCall: turn.toolCalls.find(c => c.id === result.id), error: errorMsg },
          suggestedAction: "notify",
        };
        this.findings.set(finding.id, finding);
        this.emit("finding", finding);
        await this.logFinding(finding);

        // Critical errors (build failures, test failures) might warrant stopping
        if (finding.severity === "critical" || finding.severity === "emergency") {
          // For now, just notify - the agent's own verification loop should handle fixing
          // But if we see the SAME error repeatedly, that's a different matter
        }
      }
    }
  }

  /**
   * Classify error severity
   */
  private classifyErrorSeverity(error: string): "info" | "warning" | "critical" | "emergency" {
    const lower = error.toLowerCase();

    // Emergency: security, system damage
    if (/permission denied|access denied|not authorized|secret|credential/.test(lower)) {
      return "emergency";
    }

    // Critical: build failures, test failures, type errors
    if (/build failed|type error|compilation error|test failed|assertion failed|exit code [^0]/.test(lower)) {
      return "critical";
    }

    // Warning: lint, deprecation, minor issues
    if (/warning|deprecated|lint|style/.test(lower)) {
      return "warning";
    }

    return "info";
  }

  /**
   * Detect policy violations using pattern matching
   */
  private async detectPolicyViolations(turn: AgentTurnSample): Promise<void> {
    // Check tool calls
    for (const call of turn.toolCalls) {
      const callStr = JSON.stringify(call);

      for (const rule of this.config.userRules) {
        if (!rule.enabled) continue;

        if (this.matchesPattern(callStr, rule.pattern)) {
          await this.triggerRule(rule, turn, `Tool call: ${call.name}`, callStr);
        }
      }

      // Check for repeated identical tool calls (infinite loop indicator)
      if (this.isRepeatedCall(call, turn.toolCalls)) {
        const rule = this.config.userRules.find(r => r.id === "infinite_loop");
        if (rule && rule.enabled) {
          await this.triggerRule(rule, turn, `Repeated tool call: ${call.name}`, callStr);
        }
      }
    }

    // Check agent response
    for (const rule of this.config.userRules) {
      if (!rule.enabled) continue;

      if (this.matchesPattern(turn.agentResponse, rule.pattern)) {
        await this.triggerRule(rule, turn, "Agent response", turn.agentResponse);
      }
    }
  }

  /**
   * Check if a string matches a pattern (supports regex-like patterns)
   */
  private matchesPattern(text: string, pattern: string): boolean {
    if (pattern === "repeated_tool_calls" || pattern === "off_track") {
      // Special patterns handled separately
      return false;
    }

    try {
      // Try as regex first
      const regex = new RegExp(pattern, "i");
      const result = regex.test(text);
      return result;
    } catch (e) {
      // Fallback to simple string contains
      const result = text.toLowerCase().includes(pattern.toLowerCase());
      return result;
    }
  }

  /**
   * Check if a tool call is repeated in the recent history
   */
  private isRepeatedCall(call: ToolCall, recentCalls: ToolCall[]): boolean {
    const sameCalls = recentCalls.filter(c =>
      c.name === call.name &&
      JSON.stringify(c.arguments) === JSON.stringify(call.arguments)
    );
    return sameCalls.length >= 3; // Same call 3+ times in a row
  }

  /**
   * Check for repeated patterns across turns (infinite loop detection)
   */
  private async checkForRepeatedPatterns(): Promise<void> {
    if (this.turnBuffer.length < 6) return;

    // Look at last 6 turns for identical tool call sequences
    const recentTurns = this.turnBuffer.slice(-6);
    const sequences = recentTurns.map(t =>
      t.toolCalls.map(c => `${c.name}:${JSON.stringify(c.arguments)}`).join("|")
    );

    // Check if any sequence appears 3+ times
    const counts = new Map<string, number>();
    for (const seq of sequences) {
      counts.set(seq, (counts.get(seq) || 0) + 1);
    }

    for (const [seq, count] of counts) {
      if (count >= 3 && seq.length > 0) {
        const rule = this.config.userRules.find(r => r.id === "infinite_loop");
        if (rule && rule.enabled) {
          const finding: WatchdogFinding = {
            id: `infinite-loop-${Date.now()}`,
            timestamp: new Date(),
            turn: this.currentTurn,
            ruleId: rule.id,
            type: "error",
            severity: rule.severity as any,
            title: "Potential infinite loop detected",
            description: `Same tool call sequence repeated ${count} times in last 6 turns`,
            evidence: { sequence: seq, count },
            suggestedAction: rule.action === "notify_and_stop" ? "notify_and_stop" : "notify",
          };
          this.findings.set(finding.id, finding);
          this.emit("finding", finding);
          await this.logFinding(finding);

          if (rule.action === "notify_and_stop") {
            await this.forceStop(`Infinite loop detected: ${seq}`);
          }
          break;
        }
      }
    }
  }

  /**
   * Score turn with local model for complex policy detection
   */
  private async scoreWithLocalModel(turn: AgentTurnSample): Promise<void> {
    if (!this.config.localModel) return;

    try {
      const prompt = `You are a safety watchdog monitoring an AI coding agent. Analyze this turn for policy violations.

AGENT TURN ${turn.turn}:
Tool calls: ${JSON.stringify(turn.toolCalls, null, 2)}
Tool results: ${JSON.stringify(turn.toolResults, null, 2)}
Agent response: ${turn.agentResponse.slice(0, 2000)}

USER-DEFINED RULES:
${this.config.userRules.map(r => `- ${r.description}: ${r.pattern}`).join("\n")}

Check for:
1. Violations of user-defined rules
2. Agent going off-track from its goal
3. Attempts to access sensitive paths (/etc, /root, ~/.ssh, etc.)
4. Attempts to execute dangerous commands (rm -rf, eval, curl|sh, etc.)
5. Attempts to exfiltrate data or secrets
6. Malicious code patterns

Return ONLY a JSON object:
{
  "violations": [
    { "rule": "rule description", "severity": "warning|critical|emergency", "evidence": "what triggered it", "action": "notify|stop|notify_and_stop" }
  ],
  "offTrack": boolean,
  "offTrackReason": "string if offTrack else empty"
}`;

      const result = await this.config.localModel.complete([
        { role: "system", content: "You are a safety watchdog. Return only valid JSON." },
        { role: "user", content: prompt },
      ], { temperature: 0.1, maxTokens: 1000, jsonMode: true });

      const parsed = JSON.parse(result.content);
      if (parsed.violations && parsed.violations.length > 0) {
        for (const v of parsed.violations) {
          const finding: WatchdogFinding = {
            id: `policy-llm-${turn.turn}-${Date.now()}`,
            timestamp: turn.timestamp,
            turn: turn.turn,
            ruleId: "llm-detected",
            type: "policy",
            severity: v.severity,
            title: `Policy violation (LLM): ${v.rule}`,
            description: v.evidence,
            evidence: { ...v, detectedBy: "local-model" },
            suggestedAction: v.action === "stop" ? "stop" : v.action === "notify_and_stop" ? "notify_and_stop" : "notify",
          };
          this.findings.set(finding.id, finding);
          this.emit("finding", finding);
          await this.logFinding(finding);

          if (v.action === "stop" || v.action === "notify_and_stop") {
            await this.forceStop(`Policy violation (local model): ${v.rule} - ${v.evidence}`);
          }
        }
      }

      if (parsed.offTrack) {
        const finding: WatchdogFinding = {
          id: `offtrack-${turn.turn}-${Date.now()}`,
          timestamp: turn.timestamp,
          turn: turn.turn,
          ruleId: "off_track",
          type: "policy",
          severity: "warning",
          title: "Agent going off-track",
          description: parsed.offTrackReason,
          evidence: { reason: parsed.offTrackReason, detectedBy: "local-model" },
          suggestedAction: "notify",
        };
        this.findings.set(finding.id, finding);
        this.emit("finding", finding);
        await this.logFinding(finding);
      }
    } catch (err) {
      console.warn("[BuildWatchdog] Local model scoring failed:", err);
    }
  }

  /**
   * Trigger a rule violation
   */
  private async triggerRule(
    rule: WatchdogRule,
    turn: AgentTurnSample,
    source: string,
    evidence: string
  ): Promise<void> {
    const finding: WatchdogFinding = {
      id: `${rule.id}-${turn.turn}-${Date.now()}`,
      timestamp: turn.timestamp,
      turn: turn.turn,
      ruleId: rule.id,
      type: "policy",
      severity: rule.severity,
      title: `Policy violation: ${rule.description}`,
      description: `${source} matched pattern "${rule.pattern}"`,
      evidence: { source, pattern: rule.pattern, matched: evidence.slice(0, 500) },
      suggestedAction: rule.action === "notify_and_stop" ? "notify_and_stop" : rule.action === "stop" ? "stop" : "notify",
    };

    this.findings.set(finding.id, finding);
    this.emit("finding", finding);
    await this.logFinding(finding);

    // Send push notification
    await this.sendPushNotification(
      `⚠️ Watchdog: ${rule.severity.toUpperCase()}`,
      `${rule.description} at turn ${turn.turn}`,
      "/build"
    );

    if (rule.action === "stop" || rule.action === "notify_and_stop") {
      await this.forceStop(`Policy violation: ${rule.description} (${source})`);
    }
  }

  /**
   * Send push notification to all subscribed devices
   */
  private async sendPushNotification(title: string, body: string, url: string): Promise<void> {
    try {
      const pushService = getWebPushService();
      await pushService.initialize(this.config.projectId);
      const payload: PushPayload = {
        projectId: this.config.projectId,
        title,
        body,
        tag: "watchdog-alert",
        requireInteraction: true,
        data: { watchdog: true, turn: this.currentTurn, url },
      };
      await pushService.send(payload);
    } catch (err) {
      console.error("[BuildWatchdog] Failed to send push notification:", err);
    }
  }

  /**
   * Log finding to build telemetry
   */
  private async logFinding(finding: WatchdogFinding): Promise<void> {
    await logBuildEvent(this.config.projectId, "watchdog_finding", finding.title, {
      data: {
        findingId: finding.id,
        turn: finding.turn,
        type: finding.type,
        severity: finding.severity,
        ruleId: finding.ruleId,
        action: finding.suggestedAction,
      },
    });
  }
}

// ============================================================================
// Factory & Integration Helpers
// ============================================================================

let watchdogInstance: BuildWatchdog | null = null;

export function createBuildWatchdog(config: Partial<WatchdogConfig> & { projectId: string; threadId: string }): BuildWatchdog {
  watchdogInstance = new BuildWatchdog(config);
  return watchdogInstance;
}

export function getBuildWatchdog(): BuildWatchdog | null {
  return watchdogInstance;
}

export async function initializeBuildWatchdog(
  projectId: string,
  threadId: string,
  options: Partial<WatchdogConfig> = {}
): Promise<BuildWatchdog> {
  const watchdog = createBuildWatchdog({ projectId, threadId, ...options });
  await watchdog.start();
  return watchdog;
}

export async function shutdownBuildWatchdog(): Promise<void> {
  if (watchdogInstance) {
    await watchdogInstance.stop();
    watchdogInstance = null;
  }
}

/**
 * Integration hook for build-orchestrator to record turns
 */
export async function recordWatchdogTurn(
  projectId: string,
  threadId: string,
  turn: number,
  toolCalls: ToolCall[],
  toolResults: ToolResult[],
  agentResponse: string,
  tokenUsage?: { prompt: number; completion: number; total: number },
  immediate?: boolean
): Promise<void> {
  const watchdog = getBuildWatchdog();
  if (watchdog && watchdog.getStatus().running) {
    watchdog.recordTurn({ turn, timestamp: new Date(), toolCalls, toolResults, agentResponse, tokenUsage });
    if (immediate) {
      await watchdog.analyzeImmediate(turn);
    }
  }
}