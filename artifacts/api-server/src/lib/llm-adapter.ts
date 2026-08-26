/**
 * Model-Agnostic LLM Adapter Interface
 *
 * This module provides a clean abstraction between the Infinity agent runtime
 * and the underlying LLM providers. The agent should NEVER know:
 * - Provider name (OpenRouter, NVIDIA, OpenAI, etc.)
 * - Model name/ID
 * - API endpoints
 * - Provider-specific metadata
 *
 * The agent only knows: "I am Infinity, an autonomous software engineering agent."
 */

import OpenAI from "openai";

/** Type for the OpenAI client's chat.completions.create response */
interface OpenAIChatCompletionResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** Type for streaming chunk */
interface OpenAIStreamChunk {
  choices: Array<{
    delta: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: string | null;
  }>;
}

export interface LLMCapabilities {
  /** Whether the model supports streaming responses */
  streaming: boolean;
  /** Whether the model supports JSON mode / structured outputs */
  jsonMode: boolean;
  /** Whether the model supports function/tool calling */
  toolCalling: boolean;
  /** Whether the model supports vision (image inputs) */
  vision: boolean;
  /** Maximum context window in tokens */
  maxContextTokens: number;
  /** Maximum output tokens */
  maxOutputTokens: number;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | LLMContentPart[];
  /** Optional name for the message (e.g., function name for tool messages) */
  name?: string;
  /** Tool call ID for tool response messages */
  toolCallId?: string;
}

/** Role of a chat message (re-exported via ./llm for legacy callers). */
export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface LLMContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
    detail?: "low" | "high" | "auto";
  };
}

export interface LLMTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMCompletionOptions {
  /** Model-agnostic capabilities hint - the adapter chooses the actual model */
  capabilities?: Partial<LLMCapabilities>;
  /** Temperature for sampling */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Whether to stream the response */
  stream?: boolean;
  /** JSON mode - forces structured output */
  jsonMode?: boolean;
  /** Available tools for function calling */
  tools?: LLMTool[];
  /** Tool choice: "auto", "none", or specific function name */
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  /** Stop sequences */
  stop?: string[];
  /** Top-p sampling */
  topP?: number;
  /** Presence penalty */
  presencePenalty?: number;
  /** Frequency penalty */
  frequencyPenalty?: number;
}

export interface LLMCompletionResult {
  /** The generated text content */
  content: string;
  /** Tool calls if any were made */
  toolCalls?: LLMToolCall[];
  /** Usage statistics */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Finish reason */
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | "error";
}

export interface LLMToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMStreamChunk {
  /** Partial content chunk */
  content: string;
  /** Tool call chunks if streaming tool calls */
  toolCallChunks?: LLMToolCallChunk[];
  /** Whether this is the final chunk */
  done: boolean;
  /** Finish reason if done */
  finishReason?: "stop" | "length" | "tool_calls" | "content_filter" | "error";
}

export interface LLMToolCallChunk {
  index: number;
  id?: string;
  type: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

/**
 * Core LLM Adapter Interface
 *
 * All provider adapters must implement this interface.
 * The Infinity agent communicates exclusively through this interface.
 */
export interface LLMAdapter {
  /**
   * Get the capabilities of this adapter's model
   * This is the ONLY way the agent can learn about model capabilities
   * without knowing the provider/model identity.
   */
  getCapabilities(): LLMCapabilities;

  /**
   * Generate a non-streaming completion
   */
  complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMCompletionResult>;

  /**
   * Generate a streaming completion
   */
  stream(messages: LLMMessage[], options?: LLMCompletionOptions): AsyncIterable<LLMStreamChunk>;

  /**
   * Generate a structured output matching a JSON schema
   */
  generateObject<T extends Record<string, unknown>>(
    messages: LLMMessage[],
    schema: Record<string, unknown>,
    options?: LLMCompletionOptions
  ): Promise<{ object: T }>;

  /**
   * Health check - returns true if the adapter is available
   */
  isHealthy(): Promise<boolean>;
}

/**
 * Adapter Configuration
 *
 * Configuration is provider-agnostic. The factory resolves this to
 * the appropriate provider adapter.
 */
export interface AdapterConfig {
  /** Preferred capabilities (adapter factory chooses best match) */
  preferredCapabilities?: Partial<LLMCapabilities>;
  /** Optional: explicit adapter type to use ("openrouter", "nvidia", "openai-compatible") */
  adapterType?: string;
  /** Optional: model hint for the adapter (NOT passed to the agent) */
  modelHint?: string;
  /** API key (for openai-compatible adapters) */
  apiKey?: string;
  /** Base URL (for openai-compatible adapters) */
  baseUrl?: string;
}

/**
 * Adapter Factory
 *
 * Creates the appropriate adapter based on configuration.
 * This is the ONLY place that knows about specific providers.
 */
export interface AdapterFactory {
  createAdapter(config: AdapterConfig): Promise<LLMAdapter>;
  /** List available adapter types */
  getAvailableTypes(): string[];
}

/**
 * Generic OpenAI-Compatible Adapter
 *
 * Works with any OpenAI-compatible API (OpenRouter, NVIDIA NIM, local vLLM, etc.)
 * This is the primary adapter for most use cases.
 */
export class OpenAICompatibleAdapter implements LLMAdapter {
  private client: OpenAI;
  private capabilities: LLMCapabilities;
  private modelName: string; // Internal only, NOT exposed to agent

  constructor(
    baseUrl: string,
    apiKey: string,
    modelName: string,
    capabilities: Partial<LLMCapabilities> = {}
  ) {
    this.modelName = modelName;
    this.client = new OpenAI({ baseURL: baseUrl, apiKey });
    this.capabilities = {
      streaming: true,
      jsonMode: true,
      toolCalling: true,
      vision: true,
      maxContextTokens: 128000,
      maxOutputTokens: 8192,
      ...capabilities,
    };
  }

  getCapabilities(): LLMCapabilities {
    return { ...this.capabilities };
  }

  async complete(messages: LLMMessage[], options: LLMCompletionOptions = {}): Promise<LLMCompletionResult> {
    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages: messages as any,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
      stream: false,
      response_format: options.jsonMode ? { type: "json_object" } : undefined,
      tools: options.tools as any,
      tool_choice: options.toolChoice as any,
      stop: options.stop,
      top_p: options.topP,
      presence_penalty: options.presencePenalty,
      frequency_penalty: options.frequencyPenalty,
    }) as OpenAIChatCompletionResponse;

    const choice = response.choices[0];
    return {
      content: choice.message.content ?? "",
      toolCalls: choice.message.tool_calls?.map(tc => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
      finishReason: choice.finish_reason as LLMCompletionResult["finishReason"],
    };
  }

  async *stream(messages: LLMMessage[], options: LLMCompletionOptions = {}): AsyncIterable<LLMStreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: this.modelName,
      messages: messages as any,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
      stream: true,
      response_format: options.jsonMode ? { type: "json_object" } : undefined,
      tools: options.tools as any,
      tool_choice: options.toolChoice as any,
      stop: options.stop,
      top_p: options.topP,
      presence_penalty: options.presencePenalty,
      frequency_penalty: options.frequencyPenalty,
    }) as AsyncIterable<OpenAIStreamChunk>;

    let accumulatedContent = "";
    let toolCallChunks: LLMToolCallChunk[] = [];

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const delta = choice.delta;

      if (delta.content) {
        accumulatedContent += delta.content;
        yield {
          content: delta.content,
          done: false,
        };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCallChunks[tc.index];
          if (!existing) {
            toolCallChunks[tc.index] = {
              index: tc.index,
              id: tc.id,
              type: "function",
              function: { name: tc.function?.name, arguments: tc.function?.arguments ?? "" },
            };
          } else {
            if (tc.function?.arguments) {
              existing.function!.arguments += tc.function.arguments;
            }
          }
        }
      }

      if (choice.finish_reason) {
        const toolCalls = toolCallChunks
          .filter(c => c.function?.name)
          .map(c => ({
            index: c.index,
            id: c.id ?? `call_${Date.now()}_${c.index}`,
            type: "function" as const,
            function: { name: c.function!.name!, arguments: c.function!.arguments ?? "" },
          }));

        yield {
          content: "",
          toolCallChunks: toolCalls.length > 0 ? toolCalls : undefined,
          done: true,
          finishReason: choice.finish_reason as LLMStreamChunk["finishReason"],
        };
        return;
      }
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  async generateObject<T extends Record<string, unknown>>(
    messages: LLMMessage[],
    schema: Record<string, unknown>,
    options: LLMCompletionOptions = {}
  ): Promise<{ object: T }> {
    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages: messages as any,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens,
      stream: false,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "structured_output",
          strict: true,
          schema: schema,
        },
      },
    }) as OpenAIChatCompletionResponse;

    const content = response.choices[0]?.message?.content ?? "{}";
    try {
      return { object: JSON.parse(content) as T };
    } catch {
      // Fallback: try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { object: JSON.parse(jsonMatch[0]) as T };
      }
      throw new Error("Failed to parse structured output from LLM");
    }
  }
}
interface OpenAIChatCompletionResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** Type for streaming chunk */
interface OpenAIStreamChunk {
  choices: Array<{
    delta: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: string | null;
  }>;
}

/**
 * Standardized Error for LLM Operations
 *
 * NEVER expose provider-specific errors to the agent.
 * Always wrap and normalize.
 */
export class LLMAdapterError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly originalError?: Error;

  constructor(message: string, code: string, retryable: boolean = false, originalError?: Error) {
    super(message);
    this.name = "LLMAdapterError";
    this.code = code;
    this.retryable = retryable;
    this.originalError = originalError;
  }

  static fromProviderError(err: unknown): LLMAdapterError {
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number })?.status;

    // Normalize common error patterns without exposing provider details
    if (status === 401 || /unauthorized|invalid.*key|authentication/.test(message)) {
      return new LLMAdapterError("Authentication failed", "AUTH_FAILED", false, err instanceof Error ? err : undefined);
    }
    if (status === 403 || /forbidden|permission/.test(message)) {
      return new LLMAdapterError("Access forbidden", "FORBIDDEN", false, err instanceof Error ? err : undefined);
    }
    if (status === 429 || /rate.limit|quota|too.many.requests/.test(message)) {
      return new LLMAdapterError("Rate limit exceeded", "RATE_LIMITED", true, err instanceof Error ? err : undefined);
    }
    if (status === 402 || /insufficient|quota|billing/.test(message)) {
      return new LLMAdapterError("Quota exceeded", "QUOTA_EXCEEDED", false, err instanceof Error ? err : undefined);
    }
    if (status === 400 || /model.*not.*found|bad.*request|invalid.*model/.test(message)) {
      return new LLMAdapterError("Model not available", "MODEL_UNAVAILABLE", false, err instanceof Error ? err : undefined);
    }
    if (status === 502 || status === 503 || status === 504 || /gateway|upstream|timeout/.test(message)) {
      return new LLMAdapterError("Service temporarily unavailable", "SERVICE_UNAVAILABLE", true, err instanceof Error ? err : undefined);
    }
    if (/timeout|ETIMEDOUT|ECONNREFUSED/.test(message)) {
      return new LLMAdapterError("Request timeout", "TIMEOUT", true, err instanceof Error ? err : undefined);
    }

    // Generic fallback - never expose raw provider error
    return new LLMAdapterError("The language model request failed", "UNKNOWN_ERROR", true, err instanceof Error ? err : undefined);
  }
}

/**
 * Adapter Factory Implementation
 * Creates the appropriate LLM adapter based on configuration
 */
export class DefaultAdapterFactory implements AdapterFactory {
  createAdapter(config: AdapterConfig): Promise<LLMAdapter> {
    const baseUrl = config.baseUrl || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
    const apiKey = config.apiKey || process.env.OPENROUTER_API_KEY || '';
    const modelName = config.modelHint || process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet';

    if (!apiKey) {
      throw new LLMAdapterError("API key not configured", "CONFIG_ERROR", false);
    }

    const adapter = new OpenAICompatibleAdapter(baseUrl, apiKey, modelName, config.preferredCapabilities);
    return Promise.resolve(adapter);
  }

  getAvailableTypes(): string[] {
    return ['openrouter', 'nvidia', 'openai-compatible'];
  }
}

/**
 * Get the default LLM adapter instance
 * This is the main entry point for the Infinity agent to access LLM capabilities
 */
let _defaultAdapter: LLMAdapter | null = null;

export async function getLLMAdapter(config?: AdapterConfig): Promise<LLMAdapter> {
  if (_defaultAdapter) {
    return _defaultAdapter;
  }

  const factory = new DefaultAdapterFactory();
  _defaultAdapter = await factory.createAdapter(config || {});
  return _defaultAdapter;
}

/**
 * Reset the default adapter (useful for testing or config changes)
 */
export function resetLLMAdapter(): void {
  _defaultAdapter = null;
}