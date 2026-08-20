/**
 * Local Model Adapter — Qwen2.5-1.5B-Instruct via Ollama
 *
 * Lightweight local model for in-app error fixing and explanation.
 * Runs via Ollama (~1GB RAM, fast inference, no API calls).
 */

import { LLMAdapter, LLMCapabilities, LLMMessage, LLMCompletionOptions, LLMCompletionResult, LLMStreamChunk, LLMTool, LLMAdapterError, LLMContentPart } from "../llm-adapter";

/**
 * Local model capabilities for Qwen2.5-1.5B-Instruct
 */
export const LOCAL_MODEL_CAPABILITIES: LLMCapabilities = {
  streaming: true,
  jsonMode: true,
  toolCalling: false, // Qwen2.5-1.5B doesn't support tool calling well
  vision: false,
  maxContextTokens: 32768,
  maxOutputTokens: 4096,
};

/**
 * Ollama API response types
 */
interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaTagsResponse {
  models: Array<{
    name: string;
    model: string;
    modified_at: string;
    size: number;
    digest: string;
    details: {
      format: string;
      family: string;
      families: string[];
      parameter_size: string;
      quantization_level: string;
    };
  }>;
}

/**
 * Local Model Adapter for Ollama
 *
 * Uses Qwen2.5-1.5B-Instruct (or qwen2.5-coder:1.5b when available)
 * Auto-detects Ollama at http://localhost:11434
 * Pulls model if missing (background)
 */
export class LocalModelAdapter implements LLMAdapter {
  private baseUrl: string;
  private modelName: string;
  private capabilities: LLMCapabilities;
  private modelLoaded: boolean = false;

  constructor(
    baseUrl: string = "http://localhost:11434",
    modelName: string = "qwen2.5:1.5b-instruct",
    capabilities: Partial<LLMCapabilities> = {}
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.modelName = modelName;
    this.capabilities = {
      ...LOCAL_MODEL_CAPABILITIES,
      ...capabilities,
    };
  }

  getCapabilities(): LLMCapabilities {
    return { ...this.capabilities };
  }

  /**
   * Check if Ollama is running and model is available
   */
  async isHealthy(): Promise<boolean> {
    try {
      // Check if Ollama is running
      const tagsResponse = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!tagsResponse.ok) {
        return false;
      }

      const data = await tagsResponse.json() as OllamaTagsResponse;

      // Check if our model is loaded
      const modelExists = data.models.some(
        (m) => m.name === this.modelName || m.name.startsWith(this.modelName.split(":")[0])
      );

      this.modelLoaded = modelExists;
      return modelExists;
    } catch {
      return false;
    }
  }

  /**
   * Ensure model is pulled (call before first use)
   */
  async ensureModel(): Promise<boolean> {
    if (this.modelLoaded) return true;

    try {
      // Check if model exists first
      const tagsResponse = await fetch(`${this.baseUrl}/api/tags`);
      if (tagsResponse.ok) {
        const data = await tagsResponse.json() as OllamaTagsResponse;
        const modelExists = data.models.some(
          (m) => m.name === this.modelName || m.name.startsWith(this.modelName.split(":")[0])
        );
        if (modelExists) {
          this.modelLoaded = true;
          return true;
        }
      }

      // Pull model
      console.log(`[LocalModelAdapter] Pulling model ${this.modelName}...`);
      const pullResponse = await fetch(`${this.baseUrl}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: this.modelName, stream: false }),
      });

      if (!pullResponse.ok) {
        const error = await pullResponse.text();
        console.error(`[LocalModelAdapter] Failed to pull model: ${error}`);
        return false;
      }

      this.modelLoaded = true;
      console.log(`[LocalModelAdapter] Model ${this.modelName} pulled successfully`);
      return true;
    } catch (error) {
      console.error(`[LocalModelAdapter] Error ensuring model:`, error);
      return false;
    }
  }

  /**
   * Generate a non-streaming completion
   */
  async complete(messages: LLMMessage[], options: LLMCompletionOptions = {}): Promise<LLMCompletionResult> {
    // Ensure model is available
    await this.ensureModel();

    const requestBody = {
      model: this.modelName,
      messages: this.convertMessages(messages),
      stream: false,
      options: this.convertOptions(options),
    };

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new LLMAdapterError(
          `Ollama request failed: ${response.status} ${error}`,
          "OLLAMA_ERROR",
          true,
          new Error(error)
        );
      }

      const data = await response.json() as OllamaChatResponse;

      return {
        content: data.message.content,
        toolCalls: undefined, // Local model doesn't support tool calling
        usage: data.prompt_eval_count && data.eval_count ? {
          promptTokens: data.prompt_eval_count,
          completionTokens: data.eval_count,
          totalTokens: data.prompt_eval_count + data.eval_count,
        } : undefined,
        finishReason: data.done ? "stop" : "length",
      };
    } catch (error) {
      if (error instanceof LLMAdapterError) throw error;
      throw LLMAdapterError.fromProviderError(error);
    }
  }

  /**
   * Generate a streaming completion
   */
  async *stream(messages: LLMMessage[], options: LLMCompletionOptions = {}): AsyncIterable<LLMStreamChunk> {
    // Ensure model is available
    await this.ensureModel();

    const requestBody = {
      model: this.modelName,
      messages: this.convertMessages(messages),
      stream: true,
      options: this.convertOptions(options),
    };

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new LLMAdapterError(
          `Ollama stream failed: ${response.status} ${error}`,
          "OLLAMA_ERROR",
          true,
          new Error(error)
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new LLMAdapterError("No response body from Ollama", "OLLAMA_ERROR", true);
      }

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Split by newlines (Ollama streams JSONL)
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              const chunk: OllamaStreamChunk = JSON.parse(line);

              if (chunk.message.content) {
                yield {
                  content: chunk.message.content,
                  done: chunk.done,
                  finishReason: chunk.done ? "stop" : undefined,
                };
              }

              if (chunk.done) {
                return;
              }
            } catch (parseError) {
              // Ignore parse errors for incomplete JSON
              console.warn("[LocalModelAdapter] Failed to parse stream chunk:", parseError);
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (error instanceof LLMAdapterError) throw error;
      throw LLMAdapterError.fromProviderError(error);
    }
  }

  /**
   * Convert LLMMessage[] to Ollama format
   */
  private convertMessages(messages: LLMMessage[]): Array<{ role: string; content: string }> {
    return messages.map((msg) => ({
      role: msg.role,
      content: typeof msg.content === "string" ? msg.content : this.extractTextContent(msg.content),
    }));
  }

  /**
   * Extract text content from LLMContentPart[]
   */
  private extractTextContent(parts: LLMContentPart[]): string {
    return parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n");
  }

  /**
   * Convert LLMCompletionOptions to Ollama options
   */
  private convertOptions(options: LLMCompletionOptions): Record<string, unknown> {
    const ollamaOptions: Record<string, unknown> = {};

    if (options.temperature !== undefined) ollamaOptions.temperature = options.temperature;
    if (options.maxTokens !== undefined) ollamaOptions.num_predict = options.maxTokens;
    if (options.topP !== undefined) ollamaOptions.top_p = options.topP;
    if (options.stop !== undefined && options.stop.length > 0) ollamaOptions.stop = options.stop;

    // Note: Ollama doesn't support jsonMode or toolCalling in the same way
    // These are handled at the application level

    return ollamaOptions;
  }

  /**
   * Get model info for debugging
   */
  getModelInfo(): { baseUrl: string; modelName: string; loaded: boolean } {
    return {
      baseUrl: this.baseUrl,
      modelName: this.modelName,
      loaded: this.modelLoaded,
    };
  }
}

/**
 * Create a LocalModelAdapter with default settings
 */
export async function createLocalAdapter(
  baseUrl?: string,
  modelName?: string
): Promise<LocalModelAdapter> {
  const adapter = new LocalModelAdapter(
    baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    modelName ?? process.env.OLLAMA_MODEL ?? "qwen2.5:1.5b-instruct"
  );

  // Verify health
  const healthy = await adapter.isHealthy();
  if (!healthy) {
    console.warn("[LocalModelAdapter] Ollama not healthy, model may need to be pulled");
  }

  return adapter;
}

/**
 * Check if local model is available (for router decision)
 */
export async function isLocalModelAvailable(): Promise<boolean> {
  try {
    const adapter = await createLocalAdapter();
    return await adapter.isHealthy();
  } catch {
    return false;
  }
}