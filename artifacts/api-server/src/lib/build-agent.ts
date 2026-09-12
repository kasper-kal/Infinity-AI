/**
 * Phase 1: Autonomous Coding Agent with Tool-Use Loop
 *
 * Implements the agent state machine that progressively uses tools to
 * explore, modify, and verify the workspace - replacing single-shot
 * JSON-map generation.
 *
 * PHASE C (The Loop Is One Mind) rewrite:
 * - No phase machine (exploring/planning/implementing/verifying/fixing/done)
 * - Single growing conversation (append assistant + tool results each turn)
 * - Native completion.tool_calls (regex parseToolCalls is fallback only)
 * - Quality-gate stop: while (!done && iteration < maxBudget && !stallDetected)
 * - Deterministic verify-after-edit: run verifyWorkspace after every edit_file
 * - Real state return: {finalPhase, lastDecision, editedFiles, toolCalls, toolResults}
 */

import { createBestAdapter } from "./adapter-factory";
import { buildInfinityPrompt, sanitizePrompt } from "./infinity-prompt";
import { LLMAdapter, LLMCompletionOptions, LLMContentPart, LLMMessage, LLMTool, LLMToolCall } from "./llm-adapter";
import {
  executeTool,
  executeToolSequence,
  formatToolResults,
  ToolCall,
  ToolExecutionContext,
  ToolResult,
  TOOL_DEFINITIONS,
} from "./build-tools";
import { getWorkingContext, serializeContext, recordStep, recordErrorPattern } from "./build-context";
import { verifyWorkspace, formatVerificationFeedback } from "./structured-tools";
import { combineBuildMemory, buildProjectContextForBuild } from "./build-project-context";
import { withRetry } from "./build-edge-cases";
import { logBuildEvent } from "./build-telemetry";
import { routeAndExecute, AgentRole, TaskCategory } from "./model-router";
import { createLocalAdapter, isLocalModelAvailable } from "./adapters/local-adapter";
import { LLMMessage as LLMMessageType } from "./llm-adapter";

/**
 * Agent configuration
 */
export interface AgentConfig {
  maxIterations: number;
  maxToolCallsPerIteration: number;
  temperature: number;
  verifyAfterSteps: boolean;
  failFast: boolean;
  stallDetectionTurns: number; // Stop if no file changes in N turns
}

const DEFAULT_CONFIG: AgentConfig = {
  maxIterations: 20,
  maxToolCallsPerIteration: 10,
  temperature: 0.2,
  verifyAfterSteps: true,
  failFast: false,
  stallDetectionTurns: 3,
};

/**
 * Agent state - replaces the old phase machine with a flat structure
 */
export interface AgentState {
  goal: string;
  iterations: number;
  maxIterations: number;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  errors: string[];
  context: ToolExecutionContext;
  // Growing conversation history
  conversation: LLMMessage[];
  // Files edited in this run (for stall detection + return value)
  editedFiles: string[];
  // Turns since last file edit (stall detection)
  turnsSinceEdit: number;
  // Whether the agent called the `done` tool
  done: boolean;
  // Phase E: real token usage accumulated across completions (5.5)
  tokenUsage: { prompt: number; completion: number; total: number };
  // Phase E: real gate results backing the success verdict (5.1/5.2/5.4)
  gates: AgentGateResult[];
  doneSummary?: string;
  // Phase G 3: rolling fingerprints for oscillation detection (last 6)
  fingerprints: string[];
  // Fingerprint that already triggered an oscillation warning (dedupe)
  lastWarnedFingerprint: string;
  // Phase H 1: latest screenshot data URL to attach to the next turn as a vision
  // content part. Held OUTSIDE the conversation so the raw base64 never becomes
  // prompt text; attached once, then cleared.
  latestScreenshot: { dataUrl: string } | null;
  // Phase H 1: set after the provider rejects an image input (a text-only model)
  // — the rest of the run proceeds text-only instead of erroring.
  visionDisabled: boolean;
  // Phase H 6: file tree persisted from the first list_files call so the model
  // never has to re-discover the project structure across a long run.
  fileTree: string[];
  // Phase H 2: screenshots the CALLER captured (e.g. iterate's preview readout)
  // to hand the model on the first turn.
  pendingVision: Array<{ dataUrl: string; note?: string }>;
}

/**
 * Phase E 5.1/5.2/5.4 — One real gate evaluation that backed the verdict.
 * `ok` is earned: files written AND a verification gate that passed at that moment.
 */
export interface AgentGateResult {
  gate: string;
  ok: boolean;
  atIteration: number;
  filesWritten: number;
  feedback?: string;
}

/**
 * Phase G 3 — Oscillation detection. A fingerprint = the set of files edited so
 * far (sorted) + this turn's tool-call signatures. If the same fingerprint shows
 * up ≥2 times in the rolling 6-iteration window, the agent is repeating the same
 * failing actions without progress.
 */
function computeWorkspaceFingerprint(state: AgentState, turnCalls: ToolCall[]): string {
  const files = [...new Set(state.editedFiles)].sort().join("\n");
  const calls = turnCalls.map((c) => `${c.name}:${(c.arguments as { path?: string } | undefined)?.path ?? ""}`).join("\n");
  return `${files}\n---\n${calls}`;
}

/**
 * Convert tool definitions to LLMTool format
 */
function getToolSchemas(): LLMTool[] {
  return TOOL_DEFINITIONS.map((td) => ({
    type: "function",
    function: {
      name: td.name,
      description: td.description,
      parameters: td.parameters,
    },
  }));
}

/**
 * Build the system prompt for the autonomous agent
 */
async function buildAgentSystemPrompt(workspaceId?: string): Promise<string> {
  const toolDescriptions = TOOL_DEFINITIONS.map(
    (t) => `- ${t.name}: ${t.description}`
  ).join("\n");

  // Fix 6.4a/6.4b — the scaffold rule + corpus are part of the system prompt so
  // the model knows it assembles known-good parts and never invents versions.
  const { scaffoldRulePrompt, listCorpusComponents } = await import("./scaffold-engine");
  const corpusNames = await listCorpusComponents().catch(() => []);
  const corpusBlock = corpusNames.length > 0
    ? `AVAILABLE SHADCN/UI CORPUS (${
        corpusNames.length
      } components — use generate_component to write one, do not author from scratch):\n${corpusNames.map(n => `- ${n}`).join("\n")}`
    : "";

  // Phase 6.2 + H.4 — honor project conventions AND feed the real workspace
  // content (git file tree, package.json scripts/deps, README/CLAUDE head, real
  // file bytes) into the SYSTEM prompt so every call of this run reasons over
  // the same files the user sees. Both best-effort; empty when nothing exists.
  let conventionsBlock = "";
  let workspaceBlock = "";
  if (workspaceId) {
    const { buildProjectConventionsContext, buildWorkspaceContentContext } = await import("./build-project-context");
    const conventions = await buildProjectConventionsContext(workspaceId).catch(() => null);
    if (conventions) conventionsBlock = `\n## PROJECT CONVENTIONS (from this workspace — honor them)\n${conventions}\n`;
    const workspaceContent = await buildWorkspaceContentContext(workspaceId).catch(() => "");
    if (workspaceContent) workspaceBlock = `\n## WORKSPACE CONTENT (the real files in this workspace — read before deciding)\n${workspaceContent}\n`;
  }

  return `You are Infinity, an autonomous software engineering agent. You work inside a local workspace and have access to tools to explore, modify, and verify code.

AVAILABLE TOOLS:
${toolDescriptions}

WORKFLOW:
1. EXPLORE: Use list_files, read_file to understand the workspace
2. PLAN: Break down the goal into concrete steps (if not already planned)
3. IMPLEMENT: Use edit_file, run_command to make changes
4. VERIFY: Use screenshot, inspect_console, inspect_dom, run_command (tests/build), git_diff to verify
5. FIX: If verification fails, analyze errors and apply fixes
6. REPEAT until done

RULES:
- Always start by exploring the workspace before making changes
- Make small, focused changes - one logical change per tool call sequence
- After each change, verify it works before moving on
- Use run_command for tests, builds, typechecks
- Use git_diff to review your changes before considering a step done
- Never assume - always verify with tools
- Return tool calls using the native tool_calls mechanism
- When done with a goal, call the "done" tool with summary

${workspaceBlock}
${conventionsBlock}
${corpusBlock}

${await scaffoldRulePrompt()}`;
}

/**
 * Phase E 5.4 + 5.1 — The done GATE. `done` is no longer a self-report:
 * it is accepted only when at least one real file was written AND a real
 * verification gate passes right now. Otherwise the rejection reason is
 * returned as feedback the agent can act on (the loop continues).
 */
async function evaluateDoneGate(
  state: AgentState,
  projectId: string,
): Promise<{ accept: boolean; feedback?: string }> {
  const filesWritten = state.editedFiles.length;
  if (filesWritten === 0) {
    return {
      accept: false,
      feedback: "The done gate rejected your 'done' call: no files were written to the workspace in this run (0 file edits). A green verdict requires a real artifact. Keep working — create or modify actual project files (edit_file / write_file / apply_fix / generate_component), then call done again.",
    };
  }
  const verification = await runVerification(state.context, projectId);
  if (!verification.ok) {
    return {
      accept: false,
      feedback: `The done gate ran a real build+typecheck+test verification and it FAILED. A red build cannot be marked done. Fix the failures below, then call done again.\n\n${verification.feedback}`,
    };
  }
  return { accept: true };
}

/**
 * Check if the agent should stop (done tool called)
 */
function checkDone(toolCalls: ToolCall[]): { done: boolean; summary?: string; filesChanged?: string[] } {
  for (const call of toolCalls) {
    if (call.name === "done") {
      return {
        done: true,
        summary: (call.arguments.summary as string) || "Task completed",
        filesChanged: (call.arguments.filesChanged as string[]) || [],
      };
    }
  }
  return { done: false };
}

/**
 * Parse tool calls - now a FALLBACK for when native tool_calls isn't available
 */
function parseToolCallsFallback(content: string): ToolCall[] {
  const calls: ToolCall[] = [];

  // Try to parse as JSON array
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === "object" && item.name && typeof item.name === "string") {
          calls.push({
            name: item.name,
            arguments: item.arguments || {},
            id: item.id,
          });
        }
      }
      return calls;
    }
  } catch {
    // Not a JSON array, try to extract JSON objects
  }

  // Try to extract individual JSON objects
  const jsonRegex = /\{[\s\S]*?\}/g;
  let match;
  while ((match = jsonRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed && typeof parsed === "object" && parsed.name && typeof parsed.name === "string") {
        calls.push({
          name: parsed.name,
          arguments: parsed.arguments || {},
          id: parsed.id,
        });
      }
    } catch {
      // Ignore invalid JSON
    }
  }

  return calls;
}

/**
 * Convert native LLMToolCall to internal ToolCall
 */
function convertNativeToolCalls(nativeCalls: LLMToolCall[] | undefined): ToolCall[] {
  if (!nativeCalls || nativeCalls.length === 0) return [];
  return nativeCalls.map((tc) => ({
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments || "{}"),
    id: tc.id,
  }));
}

/**
 * Phase H 1 — detect a provider rejecting an image content part. Free models
 * sometimes advertise vision in capabilities but still 400 on image_url inputs
 * (not a real multimodal endpoint, or "detail" not honored). We only trigger the
 * text-only failover on a 400 or an explicit image/vision/URL rejection — any
 * other error keeps the existing propagate path.
 */
function isVisionRejection(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return status === 400 || status === 415 || /image|vision|multimodal|content type|invalid .*url|unsupported.*(media|input)/.test(message);
}

/**
 * Run verification after implementation steps
 */
async function runVerification(
  context: ToolExecutionContext,
  projectId: string,
): Promise<{ ok: boolean; feedback: string }> {
  await logBuildEvent(projectId, "verify_start", "Verification after edit", { data: { workspaceId: context.workspaceId } });
  try {
    const result = await verifyWorkspace(projectId, context.workspaceId);
    const feedback = formatVerificationFeedback(result);
    await logBuildEvent(projectId, "verify_result", `Verification ${result.ok ? "passed" : "failed"}: ${result.durationMs}ms`, {
      data: { ok: result.ok, durationMs: result.durationMs, skipped: result.skipped ?? null },
    });
    return { ok: result.ok, feedback };
  } catch (error) {
    await logBuildEvent(projectId, "error", `Verification errored: ${error instanceof Error ? error.message : String(error)}`, { data: { workspaceId: context.workspaceId } });
    return { ok: false, feedback: `Verification failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Try to get a fix from the local model for a verification failure
 */
async function tryLocalModelFix(
  error: string,
  context: { file?: string; context?: string } = {}
): Promise<{ fixes: Array<{ file: string; oldCode: string; newCode: string; explanation: string; confidence: number }>; success: boolean }> {
  try {
    const available = await isLocalModelAvailable();
    if (!available) {
      return { fixes: [], success: false };
    }

    const adapter = await createLocalAdapter();

    const systemPrompt = `You are an expert software engineer proposing a FIX for a build/compilation error.

RULES:
- Analyze the error and the provided file content
- Propose a MINIMAL, targeted fix
- Return ONLY the fixed file content (not the whole file if only a small change)
- If multiple files need changes, provide each as a separate fix
- Explain WHY this fix works
- Be precise - the fix will be applied automatically
- Return as JSON with fields: fixes[] (each has file, oldCode, newCode, explanation, confidence)`;

    const userPrompt = `Error to fix:
\`\`\`typescript
${error}
\`\`\`

${context.file ? `File: ${context.file}` : ""}
${context.context ? `Additional context:\n${context.context}` : ""}

Return JSON with fixes array: [{ file, oldCode, newCode, explanation, confidence }]`;

    const messages: LLMMessageType[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const result = await adapter.complete(messages, {
      temperature: 0.2,
      maxTokens: 4096,
      jsonMode: true,
    });

    let parsed: { fixes: Array<{ file: string; oldCode: string; newCode: string; explanation: string; confidence: number }> } | null = null;
    try {
      const match = result.content.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      }
    } catch {
      // Ignore parse errors
    }

    if (parsed && parsed.fixes && parsed.fixes.length > 0) {
      return { fixes: parsed.fixes, success: true };
    }

    return { fixes: [], success: false };
  } catch (err) {
    console.error("[build-agent] Local model fix failed:", err);
    return { fixes: [], success: false };
  }
}

/**
 * Main autonomous agent entry point - PHASE C: The Loop Is One Mind
 *
 * Key changes from old implementation:
 * 1. Growing conversation - we append to `state.conversation` each turn
 * 2. Native tool_calls - we use completion.toolCalls directly
 * 3. Verify-after-edit - after ANY edit_file, run verification
 * 4. Stall detection - stop if no file changes in N turns
 * 5. Real state return - actual final state, not self-reported phase
 */
export async function runAutonomousAgent(
  goal: string,
  context: ToolExecutionContext,
  config: Partial<AgentConfig> = {},
  opts: { initialScreenshots?: Array<{ dataUrl: string; note?: string }> } = {},
): Promise<{
  success: boolean;
  summary: string;
  iterations: number;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  // Phase C additions:
  finalPhase: string;
  lastDecision: string;
  editedFiles: string[];
  conversation: LLMMessage[];
  // Phase E additions: real evidence behind the verdict
  tokenUsage: { prompt: number; completion: number; total: number };
  gates: AgentGateResult[];
}> {
  const projectId = context.projectId;
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  await logBuildEvent(projectId, "agent_start", `Autonomous agent started: ${goal.slice(0, 100)}`, {
    data: { goal, workspaceId: context.workspaceId },
  });

  // Use model router to get appropriate adapter
  const routingResult = await routeAndExecute(
    "coder",
    goal,
    async (adapter: LLMAdapter) => adapter,
    { filesChanged: [], errorOutput: "" },
    undefined,
    context.projectId,
    context.workspaceId
  );
  const adapter = routingResult.decision.selectedAdapter;

  // Build system prompt ONCE — Phase 6.2 conventions are injected here so every
  // iteration of this run inherits the project's own rules.
  const systemPrompt = sanitizePrompt(await buildAgentSystemPrompt(context.workspaceId));

  // Initialize growing conversation with system prompt
  const conversation: LLMMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  // Initial state - FLAT, no phase machine
  let state: AgentState = {
    goal,
    iterations: 0,
    maxIterations: mergedConfig.maxIterations,
    toolCalls: [],
    toolResults: [],
    errors: [],
    context,
    conversation,
    editedFiles: [],
    turnsSinceEdit: 0,
    done: false,
    tokenUsage: { prompt: 0, completion: 0, total: 0 },
    gates: [],
    fingerprints: [],
    lastWarnedFingerprint: "",
    latestScreenshot: null,
    visionDisabled: false,
    fileTree: [],
    pendingVision: opts.initialScreenshots ?? [],
  };

  // Build initial user message
  const initialUserMessage = buildUserMessage(state, mergedConfig, "");
  state.conversation.push({ role: "user", content: initialUserMessage });

  // Main agent loop - NO phase machine, quality-gate stop
  while (
    state.iterations < state.maxIterations &&
    !state.done &&
    state.turnsSinceEdit < mergedConfig.stallDetectionTurns
  ) {
    try {
      state.iterations++;

      // Build messages for this turn (growing conversation)
      const messages: LLMMessage[] = [...state.conversation];

      // Phase H 1/2 — attach screenshots as real vision content parts. The images
      // live outside the conversation (state.latestScreenshot / state.pendingVision)
      // so raw base64 never becomes prompt text; they are attached once, then
      // cleared. Only vision-capable adapters get them.
      const visionParts: LLMContentPart[] = [];
      if (!state.visionDisabled && adapter.getCapabilities().vision) {
        const items = [...state.pendingVision, ...(state.latestScreenshot ? [{ dataUrl: state.latestScreenshot.dataUrl, note: "Screenshot captured by the screenshot tool last turn." }] : [])];
        for (const item of items) {
          visionParts.push({ type: "text", text: item.note ?? "Screenshot of the preview." });
          visionParts.push({ type: "image_url", image_url: { url: item.dataUrl, detail: "low" } });
        }
        state.pendingVision = [];
        state.latestScreenshot = null;
      }
      if (visionParts.length > 0) {
        messages.push({ role: "user", content: visionParts });
      }

      const options: LLMCompletionOptions = {
        temperature: mergedConfig.temperature,
        maxTokens: 4000,
        tools: getToolSchemas(),
        toolChoice: "auto",
      };

      const retryOpts = { maxAttempts: 3, baseDelayMs: 1000, backoffMultiplier: 2 };
      const logCtx = { projectId: context.projectId, operation: `agent-iteration-${state.iterations}` };
      let completion: Awaited<ReturnType<typeof adapter.complete>>;
      try {
        completion = await withRetry(() => adapter.complete(messages, options), retryOpts, logCtx);
      } catch (error) {
        // A 400 with an image part usually means the free model is text-only
        // despite advertising vision. Fail over to text-only ONCE for this run
        // instead of letting the whole agent loop die on an image.
        if (visionParts.length > 0 && isVisionRejection(error)) {
          state.visionDisabled = true;
          await logBuildEvent(projectId, "vision_disabled", "Provider rejected image input — continuing text-only", {
            data: { iteration: state.iterations },
          });
          completion = await withRetry(() => adapter.complete([...state.conversation], options), retryOpts, logCtx);
        } else {
          throw error;
        }
      }

      // Phase E 5.5: accumulate real token usage into the checkpoint source-of-truth
      if (completion.usage) {
        state.tokenUsage.prompt += completion.usage.promptTokens;
        state.tokenUsage.completion += completion.usage.completionTokens;
        state.tokenUsage.total += completion.usage.totalTokens;
      }

      // Phase C: Use native tool_calls FIRST, fallback to regex parsing
      let toolCalls: ToolCall[] = [];
      if (completion.toolCalls && completion.toolCalls.length > 0) {
        toolCalls = convertNativeToolCalls(completion.toolCalls);
      } else {
        // Fallback: parse from content (legacy behavior)
        toolCalls = parseToolCallsFallback(completion.content);
        if (toolCalls.length > 0) {
          await logBuildEvent(projectId, "tool_parse_fallback", "Used regex fallback for tool calls", {
            data: { iteration: state.iterations, callCount: toolCalls.length },
          });
        }
      }

      // Add assistant message to conversation (with tool calls if native)
      const assistantMessage: LLMMessage = {
        role: "assistant",
        content: completion.content,
        ...(completion.toolCalls && completion.toolCalls.length > 0 ? {
          // Note: Some providers include tool_calls in the message, some don't
          // We'll rely on the native completion.toolCalls array
        } : {}),
      };
      state.conversation.push(assistantMessage);

      // Execute tool calls
      const rawResults = await executeToolSequence(toolCalls, context);
      state.toolCalls.push(...toolCalls);

      // Phase H 1/6 — sanitize tool results for the conversation: strip the raw
      // screenshot base64 out of anything the model reads as text (it is stashed
      // separately and attached as a vision part next turn), and persist the
      // file tree from the first list_files so the structure needs no revisit.
      const results = rawResults.map((r) => {
        const res = r.result as Record<string, unknown> | null | undefined;
        if (r.success && res && typeof res === "object" && typeof res.imageDataUrl === "string") {
          const { imageDataUrl: _image, ...rest } = res;
          return { ...r, result: { ...rest, visual: true, note: "screenshot captured; image attached to the model next turn when vision is supported" } };
        }
        return r;
      });
      state.toolResults.push(...results);
      for (let i = 0; i < toolCalls.length; i++) {
        const raw = rawResults[i];
        if (toolCalls[i].name === "screenshot" && raw?.success && typeof (raw.result as Record<string, unknown> | null)?.imageDataUrl === "string") {
          state.latestScreenshot = { dataUrl: (raw.result as { imageDataUrl: string }).imageDataUrl };
        }
        if (toolCalls[i].name === "list_files" && raw?.success) {
          const files = (raw.result as { files?: Array<{ path: string }> } | undefined)?.files;
          if (Array.isArray(files)) {
            state.fileTree = [...new Set(files.map((f) => f.path).filter(Boolean))].slice(0, 300);
          }
        }
      }

      // Add tool results to conversation
      for (let i = 0; i < toolCalls.length; i++) {
        const call = toolCalls[i];
        const result = results[i];
        state.conversation.push({
          role: "tool",
          content: JSON.stringify(result.result || { error: result.error }),
          name: call.name,
          toolCallId: call.id || `call-${Date.now()}-${i}`,
        });
      }

      // Check for done tool — Phase E 5.1/5.4: `done` must EARN success through
      // the real gate (files written + live verification passing); a rejection
      // is fed back as a tool result so the next iteration can act on it.
      const doneCheck = checkDone(toolCalls);
      if (doneCheck.done) {
        const gate = await evaluateDoneGate(state, projectId);
        state.gates.push({ gate: "done", ok: gate.accept, atIteration: state.iterations, filesWritten: state.editedFiles.length, feedback: gate.feedback });
        if (gate.accept) {
          state.done = true;
          state.doneSummary = doneCheck.summary;
          await logBuildEvent(projectId, "done_gate", "Done accepted by gate", {
            data: { filesWritten: state.editedFiles.length, iterations: state.iterations },
          });
          break;
        }
        state.errors.push(gate.feedback ?? "done gate rejected the done call");
        state.conversation.push({
          role: "tool",
          content: JSON.stringify({ type: "done_gate_rejected", feedback: gate.feedback }),
          name: "done_gate",
          toolCallId: `done-gate-${Date.now()}`,
        });
        await logBuildEvent(projectId, "done_gate", gate.feedback?.slice(0, 200) ?? "Done rejected", {
          data: { accepted: false, filesWritten: state.editedFiles.length, atIteration: state.iterations },
        });
        // A rejection is not progress toward completion — count it toward stall.
        state.turnsSinceEdit++;
      }

      // Check for errors
      const errors = results.filter((r) => !r.success).map((r) => r.error || "Unknown error");
      if (errors.length > 0) {
        state.errors.push(...errors);
        for (const error of errors) {
          recordErrorPattern(context.projectId, `Tool execution failed`, error);
        }
      }

      // Track file edits for stall detection + return value. A file is "written"
      // by any tool that produces a real file on disk — this list also powers the
      // done gate's files-written requirement (5.4), so every writing tool must
      // be counted here or a legitimately-built app could be falsely rejected.
      const filesEditedThisTurn = toolCalls
        .filter((c) => c.name === "edit_file" || c.name === "write_file" || c.name === "apply_fix" || c.name === "generate_component")
        .map((c) => c.arguments.path as string)
        .filter(Boolean);

      if (filesEditedThisTurn.length > 0) {
        state.editedFiles.push(...filesEditedThisTurn);
        state.turnsSinceEdit = 0;
      } else {
        state.turnsSinceEdit++;
      }

      // Phase G 3 — oscillation detection: rolling fingerprint across the last 6
      // iterations; ≥2 identical ⇒ the agent is repeating itself. Inject a
      // strategy change as a first-class error (also lands in ## ERRORS SO FAR).
      state.fingerprints.push(computeWorkspaceFingerprint(state, toolCalls));
      if (state.fingerprints.length > 6) state.fingerprints.shift();
      const latest = state.fingerprints[state.fingerprints.length - 1];
      let sameCount = 0;
      for (const fp of state.fingerprints) if (fp === latest) sameCount++;
      if (sameCount >= 2 && state.lastWarnedFingerprint !== latest) {
        state.lastWarnedFingerprint = latest;
        const oscillationMsg = "No progress detected — stop repeating and pick a different approach";
        state.errors.push(`Oscillation detected: ${oscillationMsg}`);
        state.conversation.push({
          role: "tool",
          content: JSON.stringify({ type: "oscillation_detected", feedback: oscillationMsg }),
          name: "oscillation",
          toolCallId: `oscillation-${Date.now()}-${state.iterations}`,
        });
        await logBuildEvent(projectId, "oscillation_detected", oscillationMsg, {
          data: { iteration: state.iterations, sameCount, window: state.fingerprints.length },
        });
      }

      // Phase C + Phase E: Deterministic verify-after-edit (5.2 per-step gate).
      // Run verification immediately after ANY file-writing tool; the result is
      // recorded as a real gate (5.1) so the success verdict cites evidence.
      if (mergedConfig.verifyAfterSteps && filesEditedThisTurn.length > 0) {
        const verification = await runVerification(context, projectId);
        state.gates.push({ gate: "verify-after-edit", ok: verification.ok, atIteration: state.iterations, filesWritten: state.editedFiles.length, feedback: verification.ok ? undefined : verification.feedback.slice(0, 400) });
        if (!verification.ok) {
          state.errors.push(`Verification failed: ${verification.feedback}`);

          // Try local model fix before next iteration
          await logBuildEvent(projectId, "local_model_attempt", "Attempting local model fix for verification failure", {
            data: { feedback: verification.feedback.slice(0, 500) },
          });

          const localFix = await tryLocalModelFix(verification.feedback, {
            context: state.toolResults.length > 0 ? JSON.stringify(state.toolResults.slice(-3)) : undefined,
          });

          if (localFix.success && localFix.fixes.length > 0) {
            await logBuildEvent(projectId, "local_model_proposed", `Local model proposed ${localFix.fixes.length} fix(es)`, {
              data: { fixes: localFix.fixes.map(f => ({ file: f.file, confidence: f.confidence, explanation: f.explanation.slice(0, 200) })) },
            });

            // Apply fixes via tool calls
            for (const fix of localFix.fixes.slice(0, 3)) {
              if (fix.file && fix.oldCode && fix.newCode) {
                try {
                  const toolResult = await executeTool({
                    name: "apply_fix",
                    arguments: { file: fix.file, oldCode: fix.oldCode, newCode: fix.newCode, explanation: fix.explanation },
                  }, context);
                  state.toolResults.push(toolResult);
                  if (toolResult.success && fix.file) {
                    state.editedFiles.push(fix.file);
                  }
                  if (!toolResult.success && "error" in toolResult) {
                    console.warn(`[build-agent] Failed to apply local fix to ${fix.file}:`, toolResult.error);
                  }
                } catch (fixError) {
                  console.warn(`[build-agent] Exception applying local fix:`, fixError);
                }
              }
            }
          }

          // Phase G 2 — re-verify AFTER the fix: the model must see whether its
          // repair actually worked. Push the post-fix verification result into
          // toolResults + conversation so the next iteration reasons over it.
          const postFix = await runVerification(context, projectId);
          state.toolResults.push({ success: postFix.ok, result: { type: "verification_after_fix", ok: postFix.ok, feedback: postFix.feedback } });
          state.conversation.push({
            role: "tool",
            content: JSON.stringify({ type: "verification_after_fix", ok: postFix.ok, feedback: postFix.feedback.slice(0, 2000) }),
            name: "verification",
            toolCallId: `verification-after-fix-${Date.now()}-${state.iterations}`,
          });
          await logBuildEvent(projectId, "verify_after_fix", `Post-fix verification ${postFix.ok ? "passed" : "still failing"}`, {
            data: { ok: postFix.ok, iterations: state.iterations, appliedFixes: localFix.fixes.length },
          });
          if (!postFix.ok) {
            state.errors.push(`Verification still failing after fix: ${postFix.feedback.slice(0, 400)}`);
          }

          // Add verification feedback as a tool result for the next iteration
          state.conversation.push({
            role: "tool",
            content: JSON.stringify({ type: "verification_failure", feedback: verification.feedback }),
            name: "verification",
            toolCallId: `verification-${Date.now()}`,
          });
        }
      }

      // Record step in working context
      if (toolCalls.length > 0) {
        recordStep(projectId, {
          stepId: `iteration-${state.iterations}`,
          description: `Agent iteration ${state.iterations}: ${toolCalls.map((c) => c.name).join(", ")}`,
          ok: state.toolResults.slice(-toolCalls.length).every((r) => r.success),
          filesChanged: filesEditedThisTurn,
          notes: state.errors.slice(-3).join("; "),
        });
      }

      // Build next user message (appended to conversation)
      const nextUserMessage = buildUserMessage(state, mergedConfig, "");
      state.conversation.push({ role: "user", content: nextUserMessage });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      state.errors.push(errorMsg);
      await logBuildEvent(projectId, "agent_error", errorMsg, { step: `iteration-${state.iterations}` });
      break;
    }
  }

  // Determine final outcome
  const success = state.done;
  const finalPhase = state.done ? "done" :
    state.turnsSinceEdit >= mergedConfig.stallDetectionTurns ? "stalled" :
    state.iterations >= state.maxIterations ? "max_iterations" : "error";

  const lastDecision = state.conversation
    .filter(m => m.role === "assistant")
    .slice(-1)[0]?.content?.slice(0, 200) || "(no assistant messages)";

  const summary = success
    ? state.doneSummary || `Agent completed goal in ${state.iterations} iterations`
    : state.phase === "error" || state.errors.length > 0
      ? `Agent failed: ${state.errors.slice(-1)[0]}`
      : state.turnsSinceEdit >= mergedConfig.stallDetectionTurns
        ? `Agent stalled after ${state.turnsSinceEdit} turns without file changes`
        : `Agent stopped after ${state.iterations} iterations (max reached)`;

  await logBuildEvent(projectId, "agent_end", summary, {
    data: {
      success,
      iterations: state.iterations,
      finalPhase,
      turnsSinceEdit: state.turnsSinceEdit,
      editedFiles: state.editedFiles.length,
    },
  });

  return {
    success,
    summary,
    iterations: state.iterations,
    toolCalls: state.toolCalls,
    toolResults: state.toolResults,
    finalPhase,
    lastDecision,
    editedFiles: [...new Set(state.editedFiles)],
    conversation: state.conversation,
    tokenUsage: state.tokenUsage,
    gates: state.gates,
  };
}

/**
 * Build user message for the current iteration
 */
function buildUserMessage(state: AgentState, config: AgentConfig, extraContext: string): string {
  const { goal, iterations, toolResults, errors, context, fileTree } = state;

  // Get working context for this project
  const workingContext = getWorkingContext(context.projectId);
  const contextPrompt = combineBuildMemory(
    serializeContext(context.projectId),
    // Note: buildProjectContextForBuild is async, but we're in sync function
    // We'll rely on the serialized context which includes file map, memory, activity
    ""
  );

  const parts = [
    `GOAL: ${goal}`,
    `ITERATION: ${iterations + 1}/${config.maxIterations}`,
    ``,
    `## WORKSPACE CONTEXT:`,
    contextPrompt || "(no context yet)",
    ``,
    // Phase H 6 — the file tree is persisted from the first list_files call, so
    // the model never needs to re-discover the project structure even after a
    // long context. Cheap (paths only, capped) and always present once known.
    `## WORKSPACE FILE TREE (persisted — from the first list_files call):`,
    fileTree && fileTree.length > 0
      ? fileTree.map((p) => `- ${p}`).join("\n")
      : "(not yet listed — run list_files once to map the workspace)",
    ``,
    `## PREVIOUS TOOL RESULTS (last 5):`,
    toolResults.length > 0
      ? formatToolResults(toolResults.slice(-5))
      : "(none)",
    ``,
    `## ERRORS SO FAR (verification failures · oscillation warnings · tool errors):`,
    errors.length > 0 ? errors.join("\n") : "(none)",
    ``,
    `What should you do next? Return tool calls using the native tool calling mechanism.`,
    `Example: call edit_file, read_file, run_command, generate_component, etc.`,
    `When the goal is fully achieved, call the "done" tool with a summary. IMPORTANT: "done" is not a self-report — it is REQUESTED completion. The harness only accepts it if real files were written this run and a verification pass succeeded. If you call done without that, it will be rejected and you must keep working.`,
  ];

  if (extraContext) {
    parts.splice(parts.length - 3, 0, extraContext, "");
  }

  return parts.join("\n");
}

/**
 * Run agent for a specific plan step (used by execute-plan rewrite)
 */
export async function runAgentForStep(
  step: { id: string; description: string },
  goal: string,
  context: ToolExecutionContext,
  config: Partial<AgentConfig> = {},
): Promise<{
  success: boolean;
  summary: string;
  filesChanged: string[];
  // Phase E 5.5: carry the real evidence through so step checkpoints persist it
  tokenUsage: { prompt: number; completion: number; total: number };
  gates: AgentGateResult[];
  finalPhase: string;
  lastDecision: string;
}> {
  const stepGoal = `${goal}\n\nCURRENT STEP: ${step.id} - ${step.description}`;

  const result = await runAutonomousAgent(stepGoal, context, {
    ...config,
    maxIterations: Math.min(config.maxIterations || 10, 10),
  });

  return {
    success: result.success,
    summary: result.summary,
    filesChanged: result.editedFiles,
    tokenUsage: result.tokenUsage,
    gates: result.gates,
    finalPhase: result.finalPhase,
    lastDecision: result.lastDecision,
  };
}