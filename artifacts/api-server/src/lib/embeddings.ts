/**
 * Embedding Pipeline — Local-first embeddings with remote fallback
 *
 * Features:
 * - Local WASM embeddings via @xenova/transformers (no external API)
 * - Remote fallback (OpenAI-compatible, Ollama, custom endpoints)
 * - Batch processing with configurable concurrency
 * - Caching for repeated embeddings
 * - Multiple model support with automatic dimension detection
 * - Token counting and truncation
 */

import { pipeline, env, Pipeline } from "@xenova/transformers";
import { createHash } from "crypto";

// Configure transformers
env.allowLocalModels = true;
env.useBrowserCache = false;
env.backends = ["wasm", "webgl", "webgpu"]; // Prefer WASM for Node.js

export interface EmbeddingConfig {
  // Local model settings
  localModel: string;           // e.g., "Xenova/all-MiniLM-L6-v2", "Xenova/bge-small-en-v1.5"
  localQuantized: boolean;      // Use quantized (int8) models for speed
  maxLocalBatchSize: number;    // Max texts per batch for local inference

  // Remote fallback settings
  enableRemoteFallback: boolean;
  remoteProvider: "openai" | "ollama" | "custom";
  remoteApiUrl: string;         // e.g., "https://api.openai.com/v1/embeddings" or "http://localhost:11434/api/embeddings"
  remoteApiKey?: string;
  remoteModel: string;          // e.g., "text-embedding-3-small", "nomic-embed-text"
  remoteDimensions?: number;    // Override auto-detected dimensions
  remoteMaxBatchSize: number;
  remoteTimeout: number;        // ms

  // General settings
  defaultDimensions: number;    // Expected dimensions (for validation)
  normalizeEmbeddings: boolean; // L2 normalize output
  cacheEnabled: boolean;        // Enable embedding cache
  cacheMaxSize: number;         // Max cache entries
  cacheTtl: number;             // Cache TTL in ms

  // Processing
  maxConcurrency: number;       // Max concurrent embedding requests
  retryAttempts: number;
  retryDelay: number;
}

export interface EmbeddingResult {
  embeddings: Float32Array[];
  dimensions: number;
  model: string;
  provider: "local" | "remote";
  tokensUsed: number;
  durationMs: number;
}

export interface EmbeddingCacheEntry {
  hash: string;
  embedding: Float32Array;
  model: string;
  createdAt: number;
  hits: number;
}

export interface ModelInfo {
  name: string;
  dimensions: number;
  maxTokens: number;
  description: string;
  recommended: boolean;
}

// Recommended models with known dimensions
export const RECOMMENDED_MODELS: Record<string, ModelInfo> = {
  // Local models (Transformers.js)
  "Xenova/all-MiniLM-L6-v2": {
    name: "all-MiniLM-L6-v2",
    dimensions: 384,
    maxTokens: 256,
    description: "Fast, general-purpose, 384-dim (recommended default)",
    recommended: true,
  },
  "Xenova/all-MiniLM-L12-v2": {
    name: "all-MiniLM-L12-v2",
    dimensions: 384,
    maxTokens: 256,
    description: "Better quality than L6, still fast",
    recommended: true,
  },
  "Xenova/bge-small-en-v1.5": {
    name: "BGE Small EN v1.5",
    dimensions: 384,
    maxTokens: 512,
    description: "Strong retrieval performance, 512 token context",
    recommended: true,
  },
  "Xenova/bge-base-en-v1.5": {
    name: "BGE Base EN v1.5",
    dimensions: 768,
    maxTokens: 512,
    description: "Higher quality, 768-dim, slower",
    recommended: false,
  },
  "Xenova/e5-small-v2": {
    name: "E5 Small v2",
    dimensions: 384,
    maxTokens: 512,
    description: "Microsoft E5, strong for code/search",
    recommended: true,
  },
  "Xenova/gte-small": {
    name: "GTE Small",
    dimensions: 384,
    maxTokens: 512,
    description: "Alibaba GTE, good for code similarity",
    recommended: true,
  },
  "Xenova/nomic-embed-text-v1": {
    name: "Nomic Embed Text v1",
    dimensions: 768,
    maxTokens: 2048,
    description: "Long context (2048), 768-dim, slower",
    recommended: false,
  },

  // Remote models (OpenAI-compatible)
  "text-embedding-3-small": {
    name: "text-embedding-3-small (OpenAI)",
    dimensions: 1536,
    maxTokens: 8191,
    description: "OpenAI latest small, 1536-dim, high quality",
    recommended: true,
  },
  "text-embedding-3-large": {
    name: "text-embedding-3-large (OpenAI)",
    dimensions: 3072,
    maxTokens: 8191,
    description: "OpenAI latest large, 3072-dim, best quality",
    recommended: false,
  },
  "text-embedding-ada-002": {
    name: "text-embedding-ada-002 (OpenAI)",
    dimensions: 1536,
    maxTokens: 8191,
    description: "OpenAI legacy, 1536-dim",
    recommended: false,
  },
  "nomic-embed-text": {
    name: "nomic-embed-text (Ollama)",
    dimensions: 768,
    maxTokens: 8192,
    description: "Ollama local, 768-dim, long context",
    recommended: true,
  },
  "mxbai-embed-large": {
    name: "mxbai-embed-large (Ollama)",
    dimensions: 1024,
    maxTokens: 512,
    description: "Ollama, 1024-dim, fast",
    recommended: true,
  },
  "bge-m3": {
    name: "BGE-M3 (Ollama)",
    dimensions: 1024,
    maxTokens: 8192,
    description: "Ollama, multi-lingual, 1024-dim",
    recommended: true,
  },
};

class EmbeddingCache {
  private cache: Map<string, EmbeddingCacheEntry> = new Map();
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number = 10000, ttl: number = 7 * 24 * 60 * 60 * 1000) { // 7 days default
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  private getKey(text: string, model: string): string {
    return createHash("sha256").update(`${model}:${text}`).digest("hex");
  }

  get(text: string, model: string): Float32Array | null {
    const key = this.getKey(text, model);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.createdAt > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    entry.hits++;
    return entry.embedding;
  }

  set(text: string, model: string, embedding: Float32Array): void {
    const key = this.getKey(text, model);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of this.cache) {
        if (v.createdAt < oldestTime) {
          oldestTime = v.createdAt;
          oldestKey = k;
        }
      }
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      hash: key,
      embedding,
      model,
      createdAt: Date.now(),
      hits: 1,
    });
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): { size: number; hitRate: number } {
    let totalHits = 0;
    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
    }
    return {
      size: this.cache.size,
      hitRate: this.cache.size > 0 ? totalHits / this.cache.size : 0,
    };
  }
}

export class EmbeddingGenerator {
  private config: EmbeddingConfig;
  private localPipeline: Pipeline | null = null;
  private cache: EmbeddingCache;
  private modelDimensions: number | null = null;
  private modelMaxTokens: number | null = null;
  private isLocalInitialized = false;

  constructor(config: Partial<EmbeddingConfig> = {}) {
    this.config = {
      localModel: "Xenova/all-MiniLM-L6-v2",
      localQuantized: true,
      maxLocalBatchSize: 32,
      enableRemoteFallback: true,
      remoteProvider: "openai",
      remoteApiUrl: "https://api.openai.com/v1/embeddings",
      remoteModel: "text-embedding-3-small",
      remoteMaxBatchSize: 100,
      remoteTimeout: 30000,
      defaultDimensions: 384,
      normalizeEmbeddings: true,
      cacheEnabled: true,
      cacheMaxSize: 10000,
      cacheTtl: 7 * 24 * 60 * 60 * 1000,
      maxConcurrency: 4,
      retryAttempts: 3,
      retryDelay: 1000,
      ...config,
    };

    this.cache = new EmbeddingCache(this.config.cacheMaxSize, this.config.cacheTtl);
  }

  async initialize(): Promise<void> {
    await this.initializeLocal();
    this.validateDimensions();
  }

  private async initializeLocal(): Promise<void> {
    try {
      console.log(`[EmbeddingGenerator] Loading local model: ${this.config.localModel}`);
      this.localPipeline = await pipeline(
        "feature-extraction",
        this.config.localModel,
        { quantized: this.config.localQuantized }
      );

      // Get model info
      const modelInfo = RECOMMENDED_MODELS[this.config.localModel];
      if (modelInfo) {
        this.modelDimensions = modelInfo.dimensions;
        this.modelMaxTokens = modelInfo.maxTokens;
      }

      this.isLocalInitialized = true;
      console.log(`[EmbeddingGenerator] Local model loaded (${this.modelDimensions} dims)`);
    } catch (error) {
      console.error("[EmbeddingGenerator] Failed to load local model:", error);
      this.isLocalInitialized = false;
      throw error;
    }
  }

  private validateDimensions(): void {
    if (this.modelDimensions && this.modelDimensions !== this.config.defaultDimensions) {
      console.warn(
        `[EmbeddingGenerator] Model dimensions (${this.modelDimensions}) ` +
        `differ from config default (${this.config.defaultDimensions}). ` +
        `Using model dimensions.`
      );
      this.config.defaultDimensions = this.modelDimensions;
    }
  }

  getDimensions(): number {
    return this.modelDimensions ?? this.config.defaultDimensions;
  }

  getMaxTokens(): number {
    return this.modelMaxTokens ?? 256;
  }

  // Token estimation (rough: ~4 chars per token for English)
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  // Truncate text to max tokens
  truncateToTokens(text: string, maxTokens: number): string {
    const estimatedTokens = this.estimateTokens(text);
    if (estimatedTokens <= maxTokens) return text;

    // Truncate proportionally
    const ratio = maxTokens / estimatedTokens;
    const targetLength = Math.floor(text.length * ratio * 0.95); // Safety margin
    return text.slice(0, targetLength);
  }

  async generate(text: string): Promise<Float32Array> {
    const results = await this.generateBatch([text]);
    return results[0];
  }

  async generateBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    const startTime = Date.now();

    // Check cache first
    const uncached: { index: number; text: string }[] = [];
    const results: (Float32Array | null)[] = new Array(texts.length).fill(null);

    if (this.config.cacheEnabled) {
      for (let i = 0; i < texts.length; i++) {
        const cached = this.cache.get(texts[i], this.config.localModel);
        if (cached) {
          results[i] = cached;
        } else {
          uncached.push({ index: i, text: texts[i] });
        }
      }
    } else {
      uncached.push(...texts.map((text, index) => ({ index, text })));
    }

    // Process uncached texts
    if (uncached.length > 0) {
      const embeddings = await this.generateUncached(uncached.map(u => u.text));

      for (let i = 0; i < uncached.length; i++) {
        const { index } = uncached[i];
        results[index] = embeddings[i];

        // Cache the result
        if (this.config.cacheEnabled) {
          this.cache.set(uncached[i].text, this.config.localModel, embeddings[i]);
        }
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`[EmbeddingGenerator] Generated ${texts.length} embeddings in ${durationMs}ms ` +
      `(${uncached.length} computed, ${texts.length - uncached.length} cached)`);

    return results as Float32Array[];
  }

  private async generateUncached(texts: string[]): Promise<Float32Array[]> {
    // Try local first
    if (this.isLocalInitialized && this.localPipeline) {
      try {
        return await this.generateLocal(texts);
      } catch (error) {
        console.warn("[EmbeddingGenerator] Local generation failed, trying remote:", error);
      }
    }

    // Fallback to remote
    if (this.config.enableRemoteFallback) {
      return await this.generateRemote(texts);
    }

    throw new Error("No embedding provider available");
  }

  private async generateLocal(texts: string[]): Promise<Float32Array[]> {
    if (!this.localPipeline) throw new Error("Local pipeline not initialized");

    const maxTokens = this.getMaxTokens();
    const processedTexts = texts.map(t => this.truncateToTokens(t, maxTokens));

    // Process in batches
    const batches: string[][] = [];
    for (let i = 0; i < processedTexts.length; i += this.config.maxLocalBatchSize) {
      batches.push(processedTexts.slice(i, i + this.config.maxLocalBatchSize));
    }

    const allEmbeddings: Float32Array[] = [];

    for (const batch of batches) {
      const outputs = await Promise.all(
        batch.map(text => this.localPipeline!(text, { pooling: "mean", normalize: this.config.normalizeEmbeddings }))
      );

      for (const output of outputs) {
        // Output is a Tensor, extract Float32Array
        const embedding = output.data as Float32Array;
        allEmbeddings.push(new Float32Array(embedding)); // Copy to detach
      }
    }

    return allEmbeddings;
  }

  private async generateRemote(texts: string[]): Promise<Float32Array[]> {
    const maxTokens = this.config.remoteProvider === "ollama" ? 8192 : 8191;
    const processedTexts = texts.map(t => this.truncateToTokens(t, maxTokens));

    const batches: string[][] = [];
    for (let i = 0; i < processedTexts.length; i += this.config.remoteMaxBatchSize) {
      batches.push(processedTexts.slice(i, i + this.config.remoteMaxBatchSize));
    }

    const allEmbeddings: Float32Array[] = [];

    for (const batch of batches) {
      const embeddings = await this.callRemoteApi(batch);
      allEmbeddings.push(...embeddings);
    }

    return allEmbeddings;
  }

  private async callRemoteApi(texts: string[]): Promise<Float32Array[]> {
    let url: string;
    let headers: Record<string, string>;
    let body: any;

    switch (this.config.remoteProvider) {
      case "openai":
        url = this.config.remoteApiUrl;
        headers = {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.remoteApiKey}`,
        };
        body = {
          model: this.config.remoteModel,
          input: texts,
          encoding_format: "float",
        };
        break;

      case "ollama":
        url = this.config.remoteApiUrl;
        headers = { "Content-Type": "application/json" };
        body = {
          model: this.config.remoteModel,
          prompt: texts.join("\n"), // Ollama takes single prompt, we'll need to handle differently
        };
        // Note: Ollama's /api/embeddings takes single prompt, not batch
        // We'll process one by one for Ollama
        return await this.callOllamaEmbeddings(texts);

      case "custom":
        url = this.config.remoteApiUrl;
        headers = {
          "Content-Type": "application/json",
          ...(this.config.remoteApiKey ? { "Authorization": `Bearer ${this.config.remoteApiKey}` } : {}),
        };
        body = { texts, model: this.config.remoteModel };
        break;

      default:
        throw new Error(`Unknown remote provider: ${this.config.remoteProvider}`);
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.remoteTimeout);

        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Remote API error ${response.status}: ${errorText}`);
        }

        const data = await response.json();

        // Parse response based on provider
        let embeddingsData: number[][];

        if (this.config.remoteProvider === "openai") {
          embeddingsData = data.data.map((d: any) => d.embedding);
        } else if (this.config.remoteProvider === "custom") {
          embeddingsData = data.embeddings || data.data;
        } else {
          embeddingsData = data.embeddings || [data.embedding];
        }

        return embeddingsData.map(arr => {
          const float32 = new Float32Array(arr);
          if (this.config.normalizeEmbeddings) {
            return this.normalize(float32);
          }
          return float32;
        });
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.config.retryAttempts) {
          await new Promise(r => setTimeout(r, this.config.retryDelay * (attempt + 1)));
        }
      }
    }

    throw lastError || new Error("Remote embedding failed after retries");
  }

  private async callOllamaEmbeddings(texts: string[]): Promise<Float32Array[]> {
    const embeddings: Float32Array[] = [];

    for (const text of texts) {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), this.config.remoteTimeout);

          const response = await fetch(this.config.remoteApiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: this.config.remoteModel,
              prompt: text,
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(`Ollama error ${response.status}`);
          }

          const data = await response.json();
          const embedding = new Float32Array(data.embedding);
          embeddings.push(this.config.normalizeEmbeddings ? this.normalize(embedding) : embedding);
          break;
        } catch (error) {
          lastError = error as Error;
          if (attempt < this.config.retryAttempts) {
            await new Promise(r => setTimeout(r, this.config.retryDelay * (attempt + 1)));
          }
        }
      }
      if (lastError) throw lastError;
    }

    return embeddings;
  }

  private normalize(vec: Float32Array): Float32Array {
    let norm = 0;
    for (let i = 0; i < vec.length; i++) {
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);
    if (norm === 0) return vec;
    const result = new Float32Array(vec.length);
    for (let i = 0; i < vec.length; i++) {
      result[i] = vec[i] / norm;
    }
    return result;
  }

  // Cosine similarity between two embeddings
  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error("Embedding dimension mismatch");
    }
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // Find top-k similar embeddings
  findSimilar(
    queryEmbedding: Float32Array,
    candidateEmbeddings: Float32Array[],
    topK: number = 10,
    threshold: number = 0.0
  ): { index: number; score: number }[] {
    const scores = candidateEmbeddings.map((emb, index) => ({
      index,
      score: this.cosineSimilarity(queryEmbedding, emb),
    }));

    return scores
      .filter(s => s.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  getCacheStats(): { size: number; hitRate: number } {
    return this.cache.getStats();
  }

  clearCache(): void {
    this.cache.clear();
  }

  async dispose(): Promise<void> {
    if (this.localPipeline) {
      try {
        // Transformers.js pipelines don't have explicit dispose, but we can nullify
        this.localPipeline = null;
      } catch {}
    }
    this.isLocalInitialized = false;
    this.cache.clear();
  }
}

// Factory for creating embedding generator with sensible defaults
export function createEmbeddingGenerator(options: Partial<EmbeddingConfig> = {}): EmbeddingGenerator {
  return new EmbeddingGenerator(options);
}

// Default configurations for different use cases
export const EMBEDDING_PRESETS = {
  // Fast, local-only, good for code search
  fastLocal: {
    localModel: "Xenova/all-MiniLM-L6-v2",
    localQuantized: true,
    enableRemoteFallback: false,
    maxLocalBatchSize: 64,
    cacheEnabled: true,
  } as Partial<EmbeddingConfig>,

  // High quality local, good for semantic search
  qualityLocal: {
    localModel: "Xenova/bge-small-en-v1.5",
    localQuantized: true,
    enableRemoteFallback: false,
    maxLocalBatchSize: 16,
    cacheEnabled: true,
  } as Partial<EmbeddingConfig>,

  // Local with OpenAI fallback
  localWithOpenAIFallback: {
    localModel: "Xenova/all-MiniLM-L6-v2",
    localQuantized: true,
    enableRemoteFallback: true,
    remoteProvider: "openai",
    remoteApiUrl: "https://api.openai.com/v1/embeddings",
    remoteModel: "text-embedding-3-small",
    remoteMaxBatchSize: 100,
  } as Partial<EmbeddingConfig>,

  // Local with Ollama fallback
  localWithOllamaFallback: {
    localModel: "Xenova/all-MiniLM-L6-v2",
    localQuantized: true,
    enableRemoteFallback: true,
    remoteProvider: "ollama",
    remoteApiUrl: "http://localhost:11434/api/embeddings",
    remoteModel: "nomic-embed-text",
    remoteMaxBatchSize: 1,
  } as Partial<EmbeddingConfig>,

  // Remote only (OpenAI)
  remoteOpenAI: {
    localModel: "Xenova/all-MiniLM-L6-v2", // Still needed for init but won't be used
    enableRemoteFallback: true,
    remoteProvider: "openai",
    remoteApiUrl: "https://api.openai.com/v1/embeddings",
    remoteModel: "text-embedding-3-small",
  } as Partial<EmbeddingConfig>,
};