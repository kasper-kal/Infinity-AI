/**
 * BUILD HUMAN INTERFACE SYSTEM
 *
 * Human takeover/steering for Build Mode:
 * - Interruptible execution (pause at step boundaries)
 * - Steering commands injection
 * - Resume with instruction injection
 * - Approval gates for risky changes
 * - Real-time chat via SSE
 */

import { EventEmitter } from "node:events";
import { v4 as uuidv4 } from "uuid";

/**
 * Human steering command
 */
export interface SteeringCommand {
  id: string;
  type: "pause" | "resume" | "inject" | "approve" | "reject" | "redirect" | "skip" | "abort";
  timestamp: string;
  /** Human-readable description */
  description: string;
  /** Optional instruction to inject into agent context */
  instruction?: string;
  /** Target step ID (for step-specific commands) */
  stepId?: string;
  /** Approval gate ID (for approve/reject) */
  gateId?: string;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Approval gate for risky operations
 */
export interface ApprovalGate {
  id: string;
  type: "schema-change" | "auth-change" | "deploy" | "destructive" | "self-modification" | "custom";
  title: string;
  description: string;
  details: Record<string, unknown>;
  /** Required approvers (roles or user IDs) */
  requiredApprovers: string[];
  /** Current approvals */
  approvals: Array<{ approver: string; decision: "approve" | "reject"; timestamp: string; reason?: string }>;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
  expiresAt?: string;
  /** Callback when resolved */
  onResolve?: (approved: boolean) => Promise<void>;
}

/**
 * Human-AI chat message
 */
export interface ChatMessage {
  id: string;
  role: "human" | "ai" | "system";
  content: string;
  timestamp: string;
  /** Related step ID */
  stepId?: string;
  /** Message type for UI */
  type?: "text" | "code" | "command" | "approval" | "status";
}

/**
 * Build session state for human interface
 */
export interface BuildSessionState {
  buildId: string;
  projectId: string;
  status: "running" | "paused" | "waiting-approval" | "completed" | "failed" | "aborted";
  currentStep?: string;
  currentStepIndex: number;
  totalSteps: number;
  /** Queue of pending steering commands */
  commandQueue: SteeringCommand[];
  /** Active approval gates */
  approvalGates: Map<string, ApprovalGate>;
  /** Chat history */
  chatHistory: ChatMessage[];
  /** Whether human is currently connected */
  humanConnected: boolean;
  /** Last human activity timestamp */
  lastHumanActivity?: string;
  /** Injected instructions for next step */
  pendingInjections: string[];
}

/**
 * Events emitted by the human interface
 */
export interface HumanInterfaceEvents {
  command: [command: SteeringCommand];
  pause: [stepId?: string];
  resume: [];
  inject: [instruction: string, stepId?: string];
  "approval-requested": [gate: ApprovalGate];
  "approval-resolved": [gate: ApprovalGate, approved: boolean];
  "chat-message": [message: ChatMessage];
  "status-change": [status: BuildSessionState["status"]];
  "human-connected": [];
  "human-disconnected": [];
}

/**
 * Human Interface Engine
 * Manages human-AI interaction during build
 */
export class HumanInterfaceEngine extends EventEmitter<HumanInterfaceEvents> {
  private sessions: Map<string, BuildSessionState> = new Map();
  private sseConnections: Map<string, Set<any>> = new Map();

  /**
   * Create or get a build session
   */
  getSession(buildId: string): BuildSessionState | undefined {
    return this.sessions.get(buildId);
  }

  /**
   * Initialize a new build session
   */
  initSession(buildId: string, projectId: string, totalSteps: number): BuildSessionState {
    const session: BuildSessionState = {
      buildId,
      projectId,
      status: "running",
      currentStepIndex: 0,
      totalSteps,
      commandQueue: [],
      approvalGates: new Map(),
      chatHistory: [],
      humanConnected: false,
      pendingInjections: [],
    };
    this.sessions.set(buildId, session);
    return session;
  }

  /**
   * Update session status
   */
  setStatus(buildId: string, status: BuildSessionState["status"]): void {
    const session = this.sessions.get(buildId);
    if (!session) return;
    const oldStatus = session.status;
    session.status = status;
    if (oldStatus !== status) {
      this.emit("status-change", status);
    }
  }

  /**
   * Update current step
   */
  setCurrentStep(buildId: string, stepId: string, stepIndex: number): void {
    const session = this.sessions.get(buildId);
    if (!session) return;
    session.currentStep = stepId;
    session.currentStepIndex = stepIndex;
  }

  /**
   * ============================================================
   * STEERING COMMANDS
   * ============================================================
   */

  /**
   * Queue a steering command from human
   */
  queueCommand(buildId: string, command: Omit<SteeringCommand, "id" | "timestamp">): SteeringCommand {
    const session = this.sessions.get(buildId);
    if (!session) throw new Error(`Session not found: ${buildId}`);

    const fullCommand: SteeringCommand = {
      ...command,
      id: uuidv4(),
      timestamp: new Date().toISOString(),
    };

    session.commandQueue.push(fullCommand);
    session.lastHumanActivity = new Date().toISOString();

    this.emit("command", fullCommand);

    // Handle immediate commands
    switch (command.type) {
      case "pause":
        this.pauseBuild(buildId, command.stepId);
        break;
      case "resume":
        this.resumeBuild(buildId);
        break;
      case "inject":
        if (command.instruction) {
          this.injectInstruction(buildId, command.instruction, command.stepId);
        }
        break;
      case "approve":
      case "reject":
        if (command.gateId) {
          this.resolveApproval(buildId, command.gateId, command.type === "approve");
        }
        break;
      case "abort":
        this.abortBuild(buildId);
        break;
    }

    return fullCommand;
  }

  /**
   * Pause build execution
   */
  pauseBuild(buildId: string, stepId?: string): void {
    const session = this.sessions.get(buildId);
    if (!session) return;
    session.status = "paused";
    this.emit("pause", stepId);
  }

  /**
   * Resume build execution
   */
  resumeBuild(buildId: string): void {
    const session = this.sessions.get(buildId);
    if (!session) return;
    session.status = "running";
    this.emit("resume");
  }

  /**
   * Inject instruction into agent context
   */
  injectInstruction(buildId: string, instruction: string, stepId?: string): void {
    const session = this.sessions.get(buildId);
    if (!session) return;
    session.pendingInjections.push(instruction);
    this.emit("inject", instruction, stepId);

    // Add to chat history
    this.addChatMessage(buildId, {
      role: "human",
      content: `💉 Injected: ${instruction}`,
      type: "command",
      stepId,
    });
  }

  /**
   * Get pending injections for next step
   */
  getPendingInjections(buildId: string): string[] {
    const session = this.sessions.get(buildId);
    if (!session) return [];
    const injections = [...session.pendingInjections];
    session.pendingInjections = [];
    return injections;
  }

  /**
   * ============================================================
   * APPROVAL GATES
   * ============================================================
   */

  /**
   * Request approval for a risky operation
   */
  async requestApproval(
    buildId: string,
    gate: Omit<ApprovalGate, "id" | "approvals" | "status" | "createdAt">
  ): Promise<boolean> {
    const session = this.sessions.get(buildId);
    if (!session) throw new Error(`Session not found: ${buildId}`);

    const approvalGate: ApprovalGate = {
      ...gate,
      id: uuidv4(),
      approvals: [],
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    session.approvalGates.set(approvalGate.id, approvalGate);
    session.status = "waiting-approval";

    this.emit("approval-requested", approvalGate);

    // Add to chat
    this.addChatMessage(buildId, {
      role: "system",
      content: `⚠️ Approval required: ${gate.title}\n${gate.description}`,
      type: "approval",
    });

    // Wait for resolution (with timeout)
    return new Promise((resolve) => {
      const timeout = gate.expiresAt
        ? new Date(gate.expiresAt).getTime() - Date.now()
        : 5 * 60 * 1000; // 5 min default

      const timer = setTimeout(() => {
        approvalGate.status = "expired";
        this.emit("approval-resolved", approvalGate, false);
        this.addChatMessage(buildId, {
          role: "system",
          content: `⏰ Approval expired: ${gate.title}`,
          type: "approval",
        });
        session.status = "running";
        resolve(false);
      }, timeout);

      approvalGate.onResolve = async (approved: boolean) => {
        clearTimeout(timer);
        approvalGate.status = approved ? "approved" : "rejected";
        this.emit("approval-resolved", approvalGate, approved);
        session.status = "running";
        resolve(approved);
      };
    });
  }

  /**
   * Resolve an approval gate
   */
  resolveApproval(buildId: string, gateId: string, approved: boolean, approver: string = "human", reason?: string): boolean {
    const session = this.sessions.get(buildId);
    if (!session) return false;

    const gate = session.approvalGates.get(gateId);
    if (!gate) return false;

    gate.approvals.push({
      approver,
      decision: approved ? "approve" : "reject",
      timestamp: new Date().toISOString(),
      reason,
    });

    // Check if we have enough approvals
    const approveCount = gate.approvals.filter(a => a.decision === "approve").length;
    const required = gate.requiredApprovers.length || 1;

    if (approveCount >= required) {
      gate.onResolve?.(true);
      return true;
    }

    // Check if rejected
    const rejectCount = gate.approvals.filter(a => a.decision === "reject").length;
    if (rejectCount > 0) {
      gate.onResolve?.(false);
      return false;
    }

    return approved;
  }

  /**
   * Get pending approval gates
   */
  getPendingApprovals(buildId: string): ApprovalGate[] {
    const session = this.sessions.get(buildId);
    if (!session) return [];
    return Array.from(session.approvalGates.values()).filter(g => g.status === "pending");
  }

  /**
   * ============================================================
   * REAL-TIME CHAT (SSE)
   * ============================================================
   */

  /**
   * Add a chat message
   */
  addChatMessage(buildId: string, message: Omit<ChatMessage, "id" | "timestamp">): ChatMessage {
    const session = this.sessions.get(buildId);
    if (!session) throw new Error(`Session not found: ${buildId}`);

    const fullMessage: ChatMessage = {
      ...message,
      id: uuidv4(),
      timestamp: new Date().toISOString(),
    };

    session.chatHistory.push(fullMessage);
    session.lastHumanActivity = new Date().toISOString();

    // Keep history bounded
    if (session.chatHistory.length > 500) {
      session.chatHistory = session.chatHistory.slice(-500);
    }

    this.emit("chat-message", fullMessage);
    this.broadcastSSE(buildId, { type: "chat", data: fullMessage });

    return fullMessage;
  }

  /**
   * Get chat history
   */
  getChatHistory(buildId: string, limit?: number): ChatMessage[] {
    const session = this.sessions.get(buildId);
    if (!session) return [];
    return limit ? session.chatHistory.slice(-limit) : session.chatHistory;
  }

  /**
   * Register SSE connection for real-time updates
   */
  registerSSE(buildId: string, controller: any): () => void {
    if (!this.sseConnections.has(buildId)) {
      this.sseConnections.set(buildId, new Set());
    }
    this.sseConnections.get(buildId)!.add(controller);

    // Send current state
    this.sendSSE(buildId, controller, { type: "state", data: this.getSession(buildId) });

    // Mark human as connected
    const session = this.sessions.get(buildId);
    if (session && !session.humanConnected) {
      session.humanConnected = true;
      this.emit("human-connected");
    }

    // Return cleanup function
    return () => {
      this.sseConnections.get(buildId)?.delete(controller);
      if (this.sseConnections.get(buildId)?.size === 0) {
        const s = this.sessions.get(buildId);
        if (s) {
          s.humanConnected = false;
          this.emit("human-disconnected");
        }
      }
    };
  }

  /**
   * Broadcast SSE event to all connections
   */
  private broadcastSSE(buildId: string, event: { type: string; data: any }): void {
    const connections = this.sseConnections.get(buildId);
    if (!connections) return;

    const message = `data: ${JSON.stringify(event)}\n\n`;
    for (const controller of connections) {
      try {
        controller.enqueue(new TextEncoder().encode(message));
      } catch {
        // Connection closed, will be cleaned up
      }
    }
  }

  /**
   * Send SSE to specific controller
   */
  private sendSSE(buildId: string, controller: any, event: { type: string; data: any }): void {
    try {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      // ignore
    }
  }

  /**
   * ============================================================
   * BUILD LIFECYCLE
   * ============================================================
   */

  /**
   * Mark build as completed
   */
  completeBuild(buildId: string, success: boolean): void {
    const session = this.sessions.get(buildId);
    if (!session) return;
    session.status = success ? "completed" : "failed";
    this.emit("status-change", session.status);

    this.addChatMessage(buildId, {
      role: "system",
      content: success ? "✅ Build completed successfully" : "❌ Build failed",
      type: "status",
    });
  }

  /**
   * Abort build
   */
  abortBuild(buildId: string): void {
    const session = this.sessions.get(buildId);
    if (!session) return;
    session.status = "aborted";
    this.emit("status-change", "aborted");

    this.addChatMessage(buildId, {
      role: "system",
      content: "🛑 Build aborted by user",
      type: "status",
    });
  }

  /**
   * Skip current step
   */
  skipStep(buildId: string): void {
    const session = this.sessions.get(buildId);
    if (!session) return;
    session.currentStepIndex += 1;
    this.addChatMessage(buildId, {
      role: "system",
      content: "⏭️ Step skipped by user",
      type: "command",
    });
  }

  /**
   * Redirect to different approach
   */
  redirectBuild(buildId: string, newInstruction: string): void {
    const session = this.sessions.get(buildId);
    if (!session) return;
    session.pendingInjections.push(`REDIRECT: ${newInstruction}`);
    session.status = "running";

    this.addChatMessage(buildId, {
      role: "human",
      content: `🔀 Redirect: ${newInstruction}`,
      type: "command",
    });
  }

  /**
   * ============================================================
   * UTILITY
   * ============================================================
   */

  /**
   * Get session summary for UI
   */
  getSessionSummary(buildId: string): {
    buildId: string;
    projectId: string;
    status: BuildSessionState["status"];
    progress: { current: number; total: number; percent: number };
    pendingCommands: number;
    pendingApprovals: number;
    humanConnected: boolean;
    lastActivity?: string;
  } | null {
    const session = this.sessions.get(buildId);
    if (!session) return null;

    return {
      buildId: session.buildId,
      projectId: session.projectId,
      status: session.status,
      progress: {
        current: session.currentStepIndex,
        total: session.totalSteps,
        percent: session.totalSteps > 0 ? Math.round((session.currentStepIndex / session.totalSteps) * 100) : 0,
      },
      pendingCommands: session.commandQueue.length,
      pendingApprovals: session.approvalGates.size,
      humanConnected: session.humanConnected,
      lastActivity: session.lastHumanActivity,
    };
  }

  /**
   * Clean up session
   */
  cleanupSession(buildId: string): void {
    const session = this.sessions.get(buildId);
    if (session) {
      // Close SSE connections
      const connections = this.sseConnections.get(buildId);
      if (connections) {
        for (const controller of connections) {
          try {
            controller.close();
          } catch { }
        }
        connections.clear();
      }
      this.sseConnections.delete(buildId);
      this.sessions.delete(buildId);
    }
  }
}

/**
 * ============================================================
 * HIGH-LEVEL API
 * ============================================================
 */

// Global instance
let humanInterfaceEngine: HumanInterfaceEngine | null = null;

/**
 * Get or create the global human interface engine
 */
export function getHumanInterface(): HumanInterfaceEngine {
  if (!humanInterfaceEngine) {
    humanInterfaceEngine = new HumanInterfaceEngine();
  }
  return humanInterfaceEngine;
}

/**
 * Create a steering command helper
 */
export function createSteeringCommand(
  type: SteeringCommand["type"],
  description: string,
  options?: Partial<SteeringCommand>
): Omit<SteeringCommand, "id" | "timestamp"> {
  return { type, description, ...options };
}

/**
 * Common steering command creators
 */
export const SteeringCommands = {
  pause: (stepId?: string) => createSteeringCommand("pause", "Pause build execution", { stepId }),
  resume: () => createSteeringCommand("resume", "Resume build execution"),
  inject: (instruction: string, stepId?: string) => createSteeringCommand("inject", `Inject instruction: ${instruction.slice(0, 50)}`, { instruction, stepId }),
  approve: (gateId: string) => createSteeringCommand("approve", `Approve gate ${gateId}`, { gateId }),
  reject: (gateId: string) => createSteeringCommand("reject", `Reject gate ${gateId}`, { gateId }),
  skip: (stepId?: string) => createSteeringCommand("skip", "Skip current step", { stepId }),
  abort: () => createSteeringCommand("abort", "Abort build"),
  redirect: (instruction: string) => createSteeringCommand("redirect", `Redirect: ${instruction.slice(0, 50)}`, { instruction }),
};

/**
 * Create approval gate helpers
 */
export function createApprovalGate(
  type: ApprovalGate["type"],
  title: string,
  description: string,
  details: Record<string, unknown> = {},
  requiredApprovers: string[] = ["human"],
  expiresInMs: number = 5 * 60 * 1000
): Omit<ApprovalGate, "id" | "approvals" | "status" | "createdAt"> {
  return {
    type,
    title,
    description,
    details,
    requiredApprovers,
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  };
}

/**
 * Predefined approval gates
 */
export const ApprovalGates = {
  schemaChange: (details: Record<string, unknown>) => createApprovalGate(
    "schema-change",
    "Database Schema Change",
    "This operation will modify the database schema",
    details
  ),
  authChange: (details: Record<string, unknown>) => createApprovalGate(
    "auth-change",
    "Authentication/Authorization Change",
    "This operation modifies auth configuration",
    details
  ),
  deploy: (details: Record<string, unknown>) => createApprovalGate(
    "deploy",
    "Deploy to Production",
    "This will deploy changes to production environment",
    details
  ),
  destructive: (details: Record<string, unknown>) => createApprovalGate(
    "destructive",
    "Destructive Operation",
    "This operation cannot be easily undone (rm -rf, git push --force, etc.)",
    details
  ),
  selfModification: (details: Record<string, unknown>) => createApprovalGate(
    "self-modification",
    "Self-Modification",
    "This will modify Infinity's own codebase",
    details,
    ["human", "admin"]
  ),
};

export default HumanInterfaceEngine;