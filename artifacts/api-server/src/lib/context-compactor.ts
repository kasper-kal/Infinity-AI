/**
 * Context Compactor — Intelligent context management with 4-level auto-compaction pipeline
 *
 * Features:
 * - Level 1 (70%): Summarize Old History — LLM summarizes messages older than N turns
 * - Level 2 (80%): Compress Working Context — Keep fileMap, keyDecisions, errorPatterns; drop raw files
 * - Level 3 (90%): Goal + State Only — Retain only: goal, current plan step, fileMap, critical decisions, active errors
 * - Level 4 (95%): Emergency Minimal — Goal + current step + one-sentence status only
 *
 * Preservation Rules — Never compact/lose:
 * - Explicit user instructions ("don't forget X")
 * - Project instructions (from project_instructions table)
 * - Active file map + key symbols
 * - Error patterns + fixes applied
 * - Decisions made (architecture, library choices)
 * - Current plan step + verification criteria
 */

import { LLMAdapter, LLMMessage, LLMCapabilities } from "./llm-adapter";
import { countTokens, countMessageTokens, TokenBudget, getCompactionLevel, createTokenBudget, getBudgetStatus } from "./token-counter";

/**
 * Compaction levels (1-4, 0 = no compaction needed)
 */
export const COMPACTION_LEVELS = {
  NONE: 0,
  SUMMARIZE_HISTORY: 1,      // 70% - Summarize old conversation history
  COMPRESS_WORKING: 2,       // 80% - Compress working context (build-context.ts aware)
  GOAL_STATE_ONLY: 3,        // 90% - Retain only goal, state, critical info
  EMERGENCY_MINIMAL: 4,      // 95% - Absolute minimum
} as const;

export type CompactionLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Rules for what must never be compacted
 */
export interface PreservationRules {
  /** Explicit user instructions to preserve (e.g., "don't forget to use TypeScript") */
  userInstructions: string[];
  /** Project instructions from database */
  projectInstructions: string[];
  /** Active file map - keep all file paths and key symbols */
  fileMap: Map<string, { symbols: string[]; summary: string }>;
  /** Error patterns and their fixes */
  errorPatterns: Array<{ error: string; fix: string; timestamp: number }>;
  /** Decisions made during the session */
  decisions: Array<{ topic: string; decision: string; rationale: string; timestamp: number }>;
  /** Current plan step and verification criteria */
  currentPlan: { step: string; criteria: string[] } | null;
  /** Original user goal */
  originalGoal: string | null;
}

/**
 * Default preservation rules (empty)
 */
export function createPreservationRules(): PreservationRules {
  return {
    userInstructions: [],
    projectInstructions: [],
    fileMap: new Map(),
    errorPatterns: [],
    decisions: [],
    currentPlan: null,
    originalGoal: null,
  };
}

/**
 * Result of a compaction operation
 */
export interface CompactionResult {
  /** The compacted messages/context */
  compacted: LLMMessage[] | any;
  /** Number of tokens saved */
  tokensSaved: number;
  /** Compaction level applied */
  level: CompactionLevel;
  /** Summary of what was preserved */
  preservedSummary: string;
  /** Human-readable description of what was compacted */
  description: string;
  /** Whether compaction actually occurred */
  compacted: boolean;
}

/**
 * Summarization prompt for Level 1 (history summarization)
 */
const SUMMARIZATION_PROMPT = `You are a context compaction system. Summarize the following conversation history into concise bullet points.

PRESERVATION RULES - THESE MUST BE INCLUDED IN YOUR SUMMARY:
1. Explicit user instructions (anything prefixed with "don't forget", "remember", "always", "never")
2. Decisions made (architecture choices, library selections, approach changes)
3. Error patterns and fixes applied
4. File paths and key symbols referenced
5. Current plan/goal state

FORMAT YOUR RESPONSE AS JSON:
{
  "summary": "Concise bullet-point summary (max 500 words)",
  "preservedItems": [
    {"type": "instruction", "content": "..."},
    {"type": "decision", "content": "..."},
    {"type": "error_fix", "content": "..."},
    {"type": "file_ref", "content": "..."},
    {"type": "plan_state", "content": "..."}
  ],
  "tokensEstimated": 0
}

CONVERSATION TO SUMMARIZE:`;

/**
 * Working context compression prompt for Level 2
 */
const WORKING_CONTEXT_PROMPT = `You are compressing a working context for an AI agent. Reduce the context while preserving critical information.

PRESERVE (do not remove or summarize):
- File map with paths and key symbols
- Key decisions with rationale
- Active error patterns and fixes
- Current plan step and verification criteria
- Original user goal
- Project instructions

COMPRESS (can be summarized or removed):
- Raw file contents (keep only summaries)
- Verbose tool execution logs
- Old reasoning chains
- Redundant context

Return JSON with:
{
  "compressedContext": { ... },  // The compressed context object
  "preservedKeys": ["fileMap", "keyDecisions", "errorPatterns", "tokenBudget", "currentPlan", "originalGoal"],
  "removedKeys": ["rawFileContents", "verboseLogs", "oldReasoning"],
  "tokensSaved": 0
}`;

/**
 * Goal+State only prompt for Level 3
 */
const GOAL_STATE_PROMPT = `Extract ONLY the absolute essentials for continuing the task:

REQUIRED:
1. Original user goal (one sentence)
2. Current plan step (what are we doing right now)
3. Active file map (paths only, no contents)
4. Critical decisions (max 3, architecture/library choices only)
5. Active errors blocking progress (max 3)

Return JSON:
{
  "goal": "...",
  "currentStep": "...",
  "fileMap": {"path": "symbols..."},
  "criticalDecisions": [{"topic": "...", "decision": "..."}],
  "activeErrors": [{"error": "...", "fix": "..."}],
  "tokensEstimated": 0
}`;

/**
 * Emergency minimal prompt for Level 4
 */
const EMERGENCY_PROMPT = `Emergency compaction - return ONLY:
{
  "goal": "One sentence original goal",
  "currentStep": "What we're doing right now",
  "status": "One sentence status",
  "tokensEstimated": 0
}`;

/**
 * Check if compaction should trigger based on token budget
 */
export function shouldCompact(
  tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number },
  modelCapabilities: LLMCapabilities,
  options: {
    warningPercent?: number;
    compactPercent?: number;
    emergencyPercent?: number;
  } = {}
): { shouldCompact: boolean; level: CompactionLevel; reason: string } {
  const budget = createTokenBudget(
    "current",
    modelCapabilities.maxContextTokens,
    modelCapabilities.maxOutputTokens,
    options
  );

  // Update budget with current usage
  const updatedBudget = updateTokenBudget(budget, tokenUsage.inputTokens, tokenUsage.outputTokens);
  const status = getBudgetStatus(updatedBudget);

  return {
    shouldCompact: status.level > 0,
    level: status.level as CompactionLevel,
    reason: `Token usage at ${Math.round(status.percentUsed * 100)}% (${status.status})`,
  };
}

/**
 * Update token budget with new usage (helper)
 */
function updateTokenBudget(budget: TokenBudget, inputTokens: number, outputTokens: number): TokenBudget {
  return {
    ...budget,
    usedTokens: budget.usedTokens + inputTokens + outputTokens,
  };
}

/**
 * Compact conversation history using LLM-based summarization (Level 1)
 */
export async function compactHistory(
  messages: LLMMessage[],
  level: CompactionLevel,
  preserveRules: PreservationRules,
  llmAdapter: LLMAdapter,
  options: {
    maxHistoryMessages?: number;  // Messages to keep unsummarized (recent)
    preserveSystemMessages?: boolean;
  } = {}
): Promise<CompactionResult> {
  const {
    maxHistoryMessages = 10,
    preserveSystemMessages = true,
  } = options;

  if (level < COMPACTION_LEVELS.SUMMARIZE_HISTORY) {
    return {
      compacted: messages,
      tokensSaved: 0,
      level: COMPACTION_LEVELS.NONE,
      preservedSummary: "No compaction needed",
      description: "Token usage below threshold",
      compacted: false,
    };
  }

  // Separate system messages, recent messages, and old messages
  const systemMessages = messages.filter(m => m.role === "system");
  const nonSystemMessages = messages.filter(m => m.role !== "system");

  // Keep recent messages unsummarized
  const recentMessages = nonSystemMessages.slice(-maxHistoryMessages);
  const oldMessages = nonSystemMessages.slice(0, -maxHistoryMessages);

  if (oldMessages.length === 0) {
    return {
      compacted: messages,
      tokensSaved: 0,
      level: COMPACTION_LEVELS.NONE,
      preservedSummary: "Not enough history to compact",
      description: "No old messages to summarize",
      compacted: false,
    };
  }

  // Build preservation context
  const preservationContext = buildPreservationContext(preserveRules);

  // Count tokens before
  const oldTokens = await countMessageTokens(oldMessages as any, "default");

  // Create summarization prompt
  const conversationText = oldMessages.map(m => `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n\n");

  const summaryPrompt = `${SUMMARIZATION_PROMPT}

${preservationContext}

${conversationText}`;

  try {
    // Use LLM to summarize with structured output
    const result = await llmAdapter.generateObject(
      [{ role: "user", content: summaryPrompt }],
      {
        type: "object",
        properties: {
          summary: { type: "string" },
          preservedItems: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["instruction", "decision", "error_fix", "file_ref", "plan_state"] },
                content: { type: "string" },
              },
              required: ["type", "content"],
            },
          },
          tokensEstimated: { type: "number" },
        },
        required: ["summary", "preservedItems", "tokensEstimated"],
      },
      { temperature: 0.1, maxTokens: 2000 }
    );

    const summary = result.object.summary;
    const preservedItems = result.object.preservedItems;

    // Create summary message
    const summaryMessage: LLMMessage = {
      role: "system",
      content: `[COMPACTED HISTORY - Level ${level}]\n${summary}\n\n[Preserved Items: ${preservedItems.map((p: any) => `${p.type}: ${p.content}`).join("; ")}]`,
    };

    const newTokens = await countTokens(summaryMessage.content as string, "default");
    const tokensSaved = oldTokens - newTokens;

    const compactedMessages = [
      ...(preserveSystemMessages ? systemMessages : []),
      summaryMessage,
      ...recentMessages,
    ];

    return {
      compacted: compactedMessages,
      tokensSaved: Math.max(0, tokensSaved),
      level,
      preservedSummary: `Preserved ${preservedItems.length} critical items`,
      description: `Summarized ${oldMessages.length} old messages into 1 summary message`,
      compacted: true,
    };
  } catch (e) {
    // Fallback: simple truncation with preservation notice
    const fallbackSummary = `[HISTORY COMPACTED - ${oldMessages.length} messages truncated due to token limit. Preserved: ${formatPreservationRules(preserveRules)}]`;
    const summaryMessage: LLMMessage = { role: "system", content: fallbackSummary };

    const compactedMessages = [
      ...(preserveSystemMessages ? systemMessages : []),
      summaryMessage,
      ...recentMessages,
    ];

    return {
      compacted: compactedMessages,
      tokensSaved: oldTokens - await countTokens(fallbackSummary, "default"),
      level,
      preservedSummary: formatPreservationRules(preserveRules),
      description: `Fallback: truncated ${oldMessages.length} old messages`,
      compacted: true,
    };
  }
}

/**
 * Compact working context (Level 2) - build-context.ts aware
 */
export function compactWorkingContext(
  context: any,
  level: CompactionLevel,
  preserveRules: PreservationRules
): CompactionResult {
  if (level < COMPACTION_LEVELS.COMPRESS_WORKING) {
    return {
      compacted: context,
      tokensSaved: 0,
      level: COMPACTION_LEVELS.NONE,
      preservedSummary: "No compaction needed",
      description: "Token usage below threshold",
      compacted: false,
    };
  }

  const originalSize = JSON.stringify(context).length;
  const compressed = { ...context };

  // Level 2: Compress working context - keep structure, drop raw contents
  if (level >= COMPACTION_LEVELS.COMPRESS_WORKING) {
    // Replace raw file contents with summaries
    if (compressed.fileContents) {
      compressed.fileSummaries = compressed.fileSummaries || {};
      for (const [path, content] of Object.entries(compressed.fileContents)) {
        if (typeof content === "string") {
          compressed.fileSummaries[path] = content.slice(0, 500) + (content.length > 500 ? "..." : "");
        }
      }
      delete compressed.fileContents;
    }

    // Truncate verbose logs
    if (compressed.toolLogs && compressed.toolLogs.length > 20) {
      compressed.toolLogs = compressed.toolLogs.slice(-20);
    }

    // Truncate reasoning history
    if (compressed.reasoningHistory && compressed.reasoningHistory.length > 10) {
      compressed.reasoningHistory = compressed.reasoningHistory.slice(-10);
    }
  }

  // Level 3: Goal + State only
  if (level >= COMPACTION_LEVELS.GOAL_STATE_ONLY) {
    const minimal: any = {
      // Preserved critical info
      fileMap: context.fileMap || {},
      keyDecisions: context.keyDecisions || [],
      errorPatterns: context.errorPatterns || [],
      tokenBudget: context.tokenBudget || {},
      currentPlan: context.currentPlan || preserveRules.currentPlan,
      originalGoal: context.originalGoal || preserveRules.originalGoal,
      projectInstructions: preserveRules.projectInstructions,
      userInstructions: preserveRules.userInstructions,
    };

    // Add file map from preservation rules if not in context
    if (preserveRules.fileMap.size > 0 && (!minimal.fileMap || Object.keys(minimal.fileMap).length === 0)) {
      minimal.fileMap = Object.fromEntries(
        Array.from(preserveRules.fileMap.entries()).map(([path, info]) => [path, info.symbols.join(", ")])
      );
    }

    compressed = minimal;
  }

  // Level 4: Emergency minimal
  if (level >= COMPACTION_LEVELS.EMERGENCY_MINIMAL) {
    compressed = {
      goal: preserveRules.originalGoal || context.originalGoal || "Unknown goal",
      currentStep: preserveRules.currentPlan?.step || context.currentPlan?.step || "Unknown step",
      status: context.lastStatus || "In progress",
    };
  }

  const newSize = JSON.stringify(compressed).length;
  const tokensSaved = Math.floor((originalSize - newSize) / 4);

  return {
    compacted: compressed,
    tokensSaved: Math.max(0, tokensSaved),
    level,
    preservedSummary: formatPreservationRules(preserveRules),
    description: `Compressed working context from ${originalSize} to ${newSize} chars`,
    compacted: true,
  };
}

/**
 * Build preservation context string for prompts
 */
function buildPreservationContext(rules: PreservationRules): string {
  const parts: string[] = [];

  if (rules.userInstructions.length > 0) {
    parts.push(`USER INSTRUCTIONS: ${rules.userInstructions.join("; ")}`);
  }
  if (rules.projectInstructions.length > 0) {
    parts.push(`PROJECT INSTRUCTIONS: ${rules.projectInstructions.join("; ")}`);
  }
  if (rules.fileMap.size > 0) {
    parts.push(`FILE MAP: ${Array.from(rules.fileMap.entries()).map(([p, i]) => `${p}: ${i.symbols.join(", ")}`).join("; ")}`);
  }
  if (rules.errorPatterns.length > 0) {
    parts.push(`ERROR PATTERNS: ${rules.errorPatterns.map(e => `${e.error} -> ${e.fix}`).join("; ")}`);
  }
  if (rules.decisions.length > 0) {
    parts.push(`DECISIONS: ${rules.decisions.map(d => `${d.topic}: ${d.decision}`).join("; ")}`);
  }
  if (rules.currentPlan) {
    parts.push(`CURRENT PLAN: ${rules.currentPlan.step} (${rules.currentPlan.criteria.join(", ")})`);
  }
  if (rules.originalGoal) {
    parts.push(`ORIGINAL GOAL: ${rules.originalGoal}`);
  }

  return parts.length > 0 ? `\n\nCRITICAL PRESERVATION CONTEXT:\n${parts.join("\n")}\n` : "";
}

/**
 * Format preservation rules for summary
 */
function formatPreservationRules(rules: PreservationRules): string {
  const counts = [
    rules.userInstructions.length > 0 ? `${rules.userInstructions.length} instructions` : null,
    rules.projectInstructions.length > 0 ? `${rules.projectInstructions.length} project rules` : null,
    rules.fileMap.size > 0 ? `${rules.fileMap.size} files` : null,
    rules.errorPatterns.length > 0 ? `${rules.errorPatterns.length} error patterns` : null,
    rules.decisions.length > 0 ? `${rules.decisions.length} decisions` : null,
    rules.currentPlan ? "current plan" : null,
    rules.originalGoal ? "original goal" : null,
  ].filter(Boolean);

  return counts.join(", ") || "none";
}

/**
 * Main auto-compaction function - orchestrates the 4-level pipeline
 */
export async function autoCompactContext(
  context: {
    messages?: LLMMessage[];
    workingContext?: any;
    tokenBudget?: TokenBudget;
    modelCapabilities?: LLMCapabilities;
    preserveRules?: PreservationRules;
    llmAdapter?: LLMAdapter;
  }
): Promise<{
  messages?: LLMMessage[];
  workingContext?: any;
  compactionResults: CompactionResult[];
  totalTokensSaved: number;
  finalLevel: CompactionLevel;
}> {
  const {
    messages = [],
    workingContext = {},
    tokenBudget,
    modelCapabilities,
    preserveRules = createPreservationRules(),
    llmAdapter,
  } = context;

  const results: CompactionResult[] = [];
  let totalTokensSaved = 0;
  let finalLevel = COMPACTION_LEVELS.NONE;
  let currentMessages = messages;
  let currentWorkingContext = workingContext;

  // Determine compaction level from budget or model capabilities
  let targetLevel = COMPACTION_LEVELS.NONE;

  if (tokenBudget) {
    const status = getBudgetStatus(tokenBudget);
    targetLevel = status.level as CompactionLevel;
  } else if (modelCapabilities) {
    // Estimate based on message count (rough heuristic)
    const estimatedTokens = await countMessageTokens(messages as any, "default");
    const budget = createTokenBudget("current", modelCapabilities.maxContextTokens, modelCapabilities.maxOutputTokens);
    budget.usedTokens = estimatedTokens;
    const status = getBudgetStatus(budget);
    targetLevel = status.level as CompactionLevel;
  }

  // Apply compaction pipeline progressively
  for (let level = 1; level <= targetLevel; level++) {
    if (level === COMPACTION_LEVELS.SUMMARIZE_HISTORY && currentMessages.length > 0 && llmAdapter) {
      const result = await compactHistory(currentMessages, level, preserveRules, llmAdapter);
      if (result.compacted) {
        currentMessages = result.compacted as LLMMessage[];
        results.push(result);
        totalTokensSaved += result.tokensSaved;
        finalLevel = level;
      }
    }

    if (level >= COMPACTION_LEVELS.COMPRESS_WORKING) {
      const result = compactWorkingContext(currentWorkingContext, level, preserveRules);
      if (result.compacted) {
        currentWorkingContext = result.compacted;
        results.push(result);
        totalTokensSaved += result.tokensSaved;
        finalLevel = level;
      }
    }
  }

  return {
    messages: currentMessages,
    workingContext: currentWorkingContext,
    compactionResults: results,
    totalTokensSaved,
    finalLevel,
  };
}

/**
 * Extract preservation rules from conversation context
 */
export function extractPreservationRules(
  messages: LLMMessage[],
  workingContext: any
): PreservationRules {
  const rules = createPreservationRules();

  // Extract user instructions from messages
  for (const msg of messages) {
    if (msg.role === "user" && typeof msg.content === "string") {
      const content = msg.content.toLowerCase();
      if (content.includes("don't forget") || content.includes("remember") ||
          content.includes("always") || content.includes("never") ||
          content.includes("must") || content.includes("important")) {
        rules.userInstructions.push(msg.content);
      }
    }
  }

  // Extract from working context
  if (workingContext) {
    if (workingContext.fileMap) {
      for (const [path, info] of Object.entries(workingContext.fileMap)) {
        rules.fileMap.set(path, {
          symbols: Array.isArray(info) ? info : (info as any).symbols || [],
          summary: (info as any).summary || "",
        });
      }
    }
    if (workingContext.keyDecisions) {
      rules.decisions.push(...workingContext.keyDecisions);
    }
    if (workingContext.errorPatterns) {
      rules.errorPatterns.push(...workingContext.errorPatterns);
    }
    if (workingContext.currentPlan) {
      rules.currentPlan = workingContext.currentPlan;
    }
    if (workingContext.originalGoal) {
      rules.originalGoal = workingContext.originalGoal;
    }
    if (workingContext.projectInstructions) {
      rules.projectInstructions.push(...workingContext.projectInstructions);
    }
  }

  return rules;
}

export {
  countTokens,
  countMessageTokens,
  TokenBudget,
  createTokenBudget,
  getCompactionLevel,
  getBudgetStatus,
  COMPACTION_LEVELS,
};
export type { CompactionLevel, PreservationRules, CompactionResult };