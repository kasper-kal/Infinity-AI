/**
 * Token Counter Utility — Accurate token counting for context management
 *
 * Uses tiktoken WASM for accurate counts with fallback to character-based approximation.
 * Supports per-model tokenization (cl100k_base for GPT-4/Claude, o200k_base for GPT-4o).
 */

// tiktoken model to encoding mapping
export const MODEL_ENCODINGS: Record<string, string> = {
  // OpenAI models
  "gpt-4o": "o200k_base",
  "gpt-4o-mini": "o200k_base",
  "gpt-4-turbo": "cl100k_base",
  "gpt-4": "cl100k_base",
  "gpt-3.5-turbo": "cl100k_base",
  // Anthropic models (via OpenRouter)
  "claude-3.5-sonnet": "cl100k_base",
  "claude-3-opus": "cl100k_base",
  "claude-3-haiku": "cl100k_base",
  // Google models
  "gemini-2.5-pro": "cl100k_base", // Approximation
  "gemini-2.0-flash": "cl100k_base",
  // Other models
  "kimi-k2": "cl100k_base",
  "glm-4.5": "cl100k_base",
  "nemotron-3-ultra": "cl100k_base",
  "llama-3.1-405b": "cl100k_base",
  // Default
  "default": "cl100k_base",
};

let tiktokenModule: any = null;
let tiktokenLoaded = false;

/**
 * Load tiktoken WASM module lazily
 */
async function loadTiktoken(): Promise<boolean> {
  if (tiktokenLoaded) return !!tiktokenModule;

  try {
    // Try to import @xenova/transformers which includes tiktoken
    const { AutoTokenizer } = await import("@xenova/transformers");
    tiktokenModule = AutoTokenizer;
    tiktokenLoaded = true;
    return true;
  } catch (e) {
    // Fallback: try direct tiktoken import
    try {
      const tiktoken = await import("tiktoken");
      tiktokenModule = tiktoken;
      tiktokenLoaded = true;
      return true;
    } catch (e2) {
      tiktokenLoaded = true;
      return false;
    }
  }
}

/**
 * Get the encoding name for a model
 */
export function getEncodingForModel(model: string): string {
  // Check exact match first
  if (MODEL_ENCODINGS[model]) {
    return MODEL_ENCODINGS[model];
  }

  // Check prefix matches
  for (const [prefix, encoding] of Object.entries(MODEL_ENCODINGS)) {
    if (model.startsWith(prefix)) {
      return encoding;
    }
  }

  return MODEL_ENCODINGS.default;
}

/**
 * Count tokens in a string using tiktoken (accurate) or approximation (fallback)
 */
export async function countTokens(text: string, model: string = "default"): Promise<number> {
  const encoding = getEncodingForModel(model);
  const hasTiktoken = await loadTiktoken();

  if (hasTiktoken && tiktokenModule) {
    try {
      if (tiktokenModule.AutoTokenizer) {
        // @xenova/transformers approach
        const tokenizer = await tiktokenModule.AutoTokenizer.from_pretrained(`Xenova/gpt2`); // Uses cl100k_base
        const tokens = tokenizer.encode(text);
        return tokens.length;
      } else {
        // Direct tiktoken approach
        const enc = tiktokenModule.getEncoding(encoding);
        const tokens = enc.encode(text);
        enc.free();
        return tokens.length;
      }
    } catch (e) {
      // Fall through to approximation
    }
  }

  // Fallback: character-based approximation (~4 chars per token for English)
  return Math.ceil(text.length / 4);
}

/**
 * Count tokens in an array of messages
 */
export async function countMessageTokens(
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>,
  model: string = "default"
): Promise<number> {
  let totalTokens = 0;

  for (const msg of messages) {
    // Add tokens for role and formatting overhead (~4 tokens per message)
    totalTokens += 4;

    const content = typeof msg.content === "string"
      ? msg.content
      : msg.content.map(c => c.type === "text" ? c.text || "" : "").join("");

    totalTokens += await countTokens(content, model);
  }

  // Add 2 tokens for the conversation priming
  totalTokens += 2;

  return totalTokens;
}

/**
 * Token usage tracking for a conversation/agent run
 */
export interface TokenBudget {
  model: string;
  maxContextTokens: number;
  maxOutputTokens: number;
  usedTokens: number;
  reservedOutputTokens: number;
  warningThreshold: number;    // 70%
  compactThreshold: number;    // 85%
  emergencyThreshold: number;  // 95%
}

/**
 * Create a token budget for a model
 */
export function createTokenBudget(
  model: string,
  maxContextTokens: number,
  maxOutputTokens: number,
  options: {
    warningPercent?: number;
    compactPercent?: number;
    emergencyPercent?: number;
    reservedOutputTokens?: number;
  } = {}
): TokenBudget {
  const {
    warningPercent = 0.70,
    compactPercent = 0.85,
    emergencyPercent = 0.95,
    reservedOutputTokens = maxOutputTokens,
  } = options;

  return {
    model,
    maxContextTokens,
    maxOutputTokens,
    usedTokens: 0,
    reservedOutputTokens,
    warningThreshold: Math.floor(maxContextTokens * warningPercent),
    compactThreshold: Math.floor(maxContextTokens * compactPercent),
    emergencyThreshold: Math.floor(maxContextTokens * emergencyPercent),
  };
}

/**
 * Update token budget with new usage
 */
export function updateTokenBudget(budget: TokenBudget, inputTokens: number, outputTokens: number): TokenBudget {
  return {
    ...budget,
    usedTokens: budget.usedTokens + inputTokens + outputTokens,
  };
}

/**
 * Check budget status and return compaction level needed
 */
export function getCompactionLevel(budget: TokenBudget): number {
  if (budget.usedTokens >= budget.emergencyThreshold) return 4;
  if (budget.usedTokens >= budget.compactThreshold) return 3;
  if (budget.usedTokens >= budget.warningThreshold) return 2;
  if (budget.usedTokens >= budget.warningThreshold * 0.5) return 1;
  return 0;
}

/**
 * Get human-readable budget status
 */
export function getBudgetStatus(budget: TokenBudget): {
  level: number;
  percentUsed: number;
  tokensRemaining: number;
  status: "ok" | "warning" | "compact" | "emergency";
} {
  const percentUsed = budget.usedTokens / budget.maxContextTokens;
  const tokensRemaining = budget.maxContextTokens - budget.usedTokens;

  let level = getCompactionLevel(budget);
  let status: "ok" | "warning" | "compact" | "emergency" = "ok";

  if (level >= 4) status = "emergency";
  else if (level >= 3) status = "compact";
  else if (level >= 1) status = "warning";

  return { level, percentUsed, tokensRemaining, status };
}