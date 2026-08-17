import { PlanStep } from "./build-agent";
import { ToolExecutionContext } from "./build-tools";

export interface TaskNode {
  step: PlanStep;
  agentRole: "coder" | "reviewer" | "fixer";
  status: "pending" | "running" | "completed" | "failed";
  result?: AgentOutput;
  error?: string;
  dependencies: string[];
  dependents: string[];
  parallelGroup: number;
}

export interface AgentOutput {
  stepId: string;
  agentRole: "coder" | "reviewer" | "fixer";
  agentId: string;
  timestamp: string;
  summary: string;
  filesChanged: string[];
  toolCalls: any[];
  toolResults: any[];
  error?: string;
  reviewResult?: {
    done: boolean;
    fixRequest?: { files: string[]; issues: string[] };
    deferred?: string[];
  };
}

export interface TaskQueueOptions {
  maxParallel: number;
  onStepStart?: (stepId: string, agentRole: string) => void;
  onStepComplete?: (stepId: string, output: AgentOutput) => void;
  onStepError?: (stepId: string, error: string) => void;
}

/**
 * Build a DAG from plan steps and assign parallel groups
 */
export function buildTaskDAG(steps: PlanStep[]): TaskNode[] {
  const stepMap = new Map<string, PlanStep>();
  steps.forEach((s) => stepMap.set(s.id, s));

  const nodes: TaskNode[] = steps.map((step) => ({
    step,
    agentRole: "coder" as const,
    status: "pending" as const,
    dependencies: step.dependsOn || [],
    dependents: [],
    parallelGroup: -1,
  }));

  // Build dependents list
  nodes.forEach((node) => {
    node.dependencies.forEach((depId) => {
      const depNode = nodes.find((n) => n.step.id === depId);
      if (depNode) {
        depNode.dependents.push(node.step.id);
      }
    });
  });

  // Assign parallel groups using topological sort (Kahn's algorithm)
  const inDegree = new Map<string, number>();
  nodes.forEach((n) => inDegree.set(n.step.id, n.dependencies.length));

  let group = 0;
  const queue: TaskNode[] = nodes.filter((n) => inDegree.get(n.step.id) === 0);

  while (queue.length > 0) {
    const nextQueue: TaskNode[] = [];
    queue.forEach((node) => {
      node.parallelGroup = group;
      node.dependents.forEach((depId) => {
        const depNode = nodes.find((n) => n.step.id === depId);
        if (depNode) {
          const newDegree = (inDegree.get(depId) || 1) - 1;
          inDegree.set(depId, newDegree);
          if (newDegree === 0) {
            nextQueue.push(depNode);
          }
        }
      });
    });
    group++;
    queue.push(...nextQueue);
  }

  // Verify no cycles
  const hasCycle = nodes.some((n) => (inDegree.get(n.step.id) || 0) > 0);
  if (hasCycle) {
    throw new Error("Plan contains circular dependencies");
  }

  return nodes;
}

/**
 * Get steps that can run in parallel (same parallelGroup, all dependencies met)
 */
export function getReadySteps(nodes: TaskNode[], completedSteps: Set<string>): TaskNode[] {
  return nodes.filter(
    (node) =>
      node.status === "pending" &&
      node.dependencies.every((dep) => completedSteps.has(dep))
  );
}

/**
 * Execute a parallel group of steps
 */
export async function executeParallelGroup(
  nodes: TaskNode[],
  executeStep: (node: TaskNode, context: ToolExecutionContext) => Promise<AgentOutput>,
  context: ToolExecutionContext,
  maxParallel: number,
  options: TaskQueueOptions
): Promise<AgentOutput[]> {
  const ready = getReadySteps(nodes, new Set(nodes.filter((n) => n.status === "completed").map((n) => n.step.id)));

  if (ready.length === 0) return [];

  // Limit parallelism
  const toExecute = ready.slice(0, maxParallel);

  // Mark as running
  toExecute.forEach((node) => {
    node.status = "running";
    options.onStepStart?.(node.step.id, node.agentRole);
  });

  // Execute in parallel with Promise.allSettled
  const results = await Promise.allSettled(
    toExecute.map((node) => executeStep(node, context))
  );

  const outputs: AgentOutput[] = [];

  results.forEach((result, index) => {
    const node = toExecute[index];
    if (result.status === "fulfilled") {
      node.status = "completed";
      node.result = result.value;
      outputs.push(result.value);
      options.onStepComplete?.(node.step.id, result.value);
    } else {
      node.status = "failed";
      node.error = result.reason?.message || "Unknown error";
      outputs.push({
        stepId: node.step.id,
        agentRole: node.agentRole,
        agentId: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        timestamp: new Date().toISOString(),
        summary: `Step failed: ${node.error}`,
        filesChanged: [],
        toolCalls: [],
        toolResults: [],
        error: node.error,
      });
      options.onStepError?.(node.step.id, node.error || "Unknown error");
    }
  });

  return outputs;
}

/**
 * Execute the full DAG
 */
export async function executeTaskDAG(
  steps: PlanStep[],
  executeStep: (node: TaskNode, context: ToolExecutionContext) => Promise<AgentOutput>,
  context: ToolExecutionContext,
  options: TaskQueueOptions
): Promise<AgentOutput[]> {
  const nodes = buildTaskDAG(steps);
  const allOutputs: AgentOutput[] = [];
  const completedSteps = new Set<string>();

  let maxGroups = Math.max(...nodes.map((n) => n.parallelGroup), 0);

  for (let group = 0; group <= maxGroups; group++) {
    const groupNodes = nodes.filter((n) => n.parallelGroup === group);
    const pendingInGroup = groupNodes.filter((n) => n.status === "pending");

    if (pendingInGroup.length === 0) continue;

    // Execute this parallel group (may take multiple rounds if maxParallel < group size)
    while (true) {
      const readyInGroup = pendingInGroup.filter(
        (n) => n.dependencies.every((dep) => completedSteps.has(dep))
      );

      if (readyInGroup.length === 0) break;

      const outputs = await executeParallelGroup(
        nodes,
        executeStep,
        context,
        options.maxParallel,
        options
      );

      outputs.forEach((output) => {
        allOutputs.push(output);
        completedSteps.add(output.stepId);
      });

      // Update pending list
      pendingInGroup.forEach((n) => {
        if (completedSteps.has(n.step.id)) {
          // Remove from pendingInGroup by filtering later
        }
      });
    }
  }

  return allOutputs;
}

/**
 * Simple sequential executor for non-parallel steps (reviewer/fixer)
 */
export async function executeSequential(
  steps: PlanStep[],
  executeStep: (node: TaskNode, context: ToolExecutionContext) => Promise<AgentOutput>,
  context: ToolExecutionContext,
  options: TaskQueueOptions
): Promise<AgentOutput[]> {
  const outputs: AgentOutput[] = [];

  for (const step of steps) {
    const node: TaskNode = {
      step,
      agentRole: "coder",
      status: "running",
      dependencies: [],
      dependents: [],
      parallelGroup: 0,
    };

    options.onStepStart?.(step.id, node.agentRole);

    try {
      const output = await executeStep(node, context);
      node.status = "completed";
      node.result = output;
      outputs.push(output);
      options.onStepComplete?.(step.id, output);
    } catch (err) {
      node.status = "failed";
      node.error = err instanceof Error ? err.message : "Unknown error";
      const errorOutput: AgentOutput = {
        stepId: step.id,
        agentRole: node.agentRole,
        agentId: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        timestamp: new Date().toISOString(),
        summary: `Step failed: ${node.error}`,
        filesChanged: [],
        toolCalls: [],
        toolResults: [],
        error: node.error,
      };
      outputs.push(errorOutput);
      options.onStepError?.(step.id, node.error || "Unknown error");
    }
  }

  return outputs;
}