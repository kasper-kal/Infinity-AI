/**
 * Codebase Index API Routes
 *
 * Endpoints:
 * - POST /api/infinity/codebase/index - Start full index
 * - POST /api/infinity/codebase/index/incremental - Incremental index
 * - GET /api/infinity/codebase/index/status - Index status
 * - POST /api/infinity/codebase/search - Semantic search
 * - POST /api/infinity/codebase/search/symbol - Symbol search
 * - GET /api/infinity/codebase/stats - Index statistics
 * - DELETE /api/infinity/codebase/index - Clear index
 * - WS /api/infinity/codebase/watch - File watch events
 */

import { Router, Request, Response } from "express";
import { createCodebaseIndexer, CodebaseIndexer, IndexConfig, SearchResult, expandQuery } from "../../lib/codebase-indexer.js";
import { getTreeSitterManager, ParsedFile } from "../../lib/tree-sitter-parsers.js";
import { createEmbeddingGenerator, EmbeddingGenerator, EMBEDDING_PRESETS } from "../../lib/embeddings.js";
import { z } from "zod";

const router = Router();

// In-memory store for indexers (in production, use a proper manager)
const indexers: Map<string, CodebaseIndexer> = new Map();
const indexStatus: Map<string, { status: "idle" | "indexing" | "error"; progress: number; message: string; error?: string }> = new Map();

// Validation schemas
const indexConfigSchema = z.object({
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  excludePatterns: z.array(z.string()).optional(),
  includePatterns: z.array(z.string()).optional(),
  maxFileSize: z.number().positive().optional(),
  chunkSize: z.number().positive().optional(),
  overlap: z.number().nonnegative().optional(),
  embeddingModel: z.string().optional(),
  enableIncremental: z.boolean().optional(),
  useRemoteEmbeddings: z.boolean().optional(),
  remoteEmbeddingUrl: z.string().url().optional(),
  remoteEmbeddingKey: z.string().optional(),
});

const searchSchema = z.object({
  projectId: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().positive().max(100).optional(),
  types: z.array(z.enum(["function", "class", "interface", "type", "import", "export", "comment", "block"])).optional(),
  languages: z.array(z.string()).optional(),
  hybrid: z.boolean().optional(),
  expandQuery: z.boolean().optional(),
});

const symbolSearchSchema = z.object({
  projectId: z.string().min(1),
  symbol: z.string().min(1),
  limit: z.number().positive().max(100).optional(),
});

const fileIndexSchema = z.object({
  projectId: z.string().min(1),
  filePath: z.string().min(1),
});

// Get or create indexer for a project
function getOrCreateIndexer(config: IndexConfig): CodebaseIndexer {
  let indexer = indexers.get(config.projectId);
  if (!indexer) {
    indexer = createCodebaseIndexer(config.projectId, config.projectRoot, config);
    indexers.set(config.projectId, indexer);
  }
  return indexer;
}

// Update index status
function updateStatus(projectId: string, status: "idle" | "indexing" | "error", progress: number, message: string, error?: string) {
  indexStatus.set(projectId, { status, progress, message, error });
}

// GET /api/infinity/codebase/index/status - Get index status
router.get("/index/status", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query;
    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }

    const status = indexStatus.get(projectId) || { status: "idle", progress: 0, message: "Not started" };
    const indexer = indexers.get(projectId);

    let stats = null;
    if (indexer) {
      try {
        stats = indexer.getStats();
      } catch {}
    }

    res.json({ projectId, ...status, stats });
  } catch (error) {
    console.error("[CodebaseIndex] Status error:", error);
    res.status(500).json({ error: "Failed to get index status" });
  }
});

// POST /api/infinity/codebase/index - Start full indexing
router.post("/index", async (req: Request, res: Response) => {
  try {
    const config = indexConfigSchema.parse(req.body);
    const { projectId, projectRoot, ...options } = config;

    // Validate project root exists
    const fs = await import("fs");
    if (!fs.existsSync(projectRoot)) {
      return res.status(400).json({ error: "Project root does not exist" });
    }

    updateStatus(projectId, "indexing", 0, "Initializing indexer...");

    const indexer = getOrCreateIndexer({ projectId, projectRoot, ...options } as IndexConfig);

    try {
      await indexer.initialize();
      updateStatus(projectId, "indexing", 10, "Indexer initialized, starting full index...");

      const stats = await indexer.indexProject(true);

      updateStatus(projectId, "idle", 100, "Indexing complete", undefined);
      res.json({ success: true, projectId, stats });
    } catch (error) {
      const err = error as Error;
      updateStatus(projectId, "error", 0, "Indexing failed", err.message);
      res.status(500).json({ error: "Indexing failed", message: err.message });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid config", details: error.errors });
    }
    console.error("[CodebaseIndex] Index error:", error);
    res.status(500).json({ error: "Failed to start indexing" });
  }
});

// POST /api/infinity/codebase/index/incremental - Incremental index
router.post("/index/incremental", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.body;
    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }

    const indexer = indexers.get(projectId);
    if (!indexer) {
      return res.status(404).json({ error: "Indexer not found. Run full index first." });
    }

    const status = indexStatus.get(projectId);
    if (status?.status === "indexing") {
      return res.status(409).json({ error: "Indexing already in progress" });
    }

    updateStatus(projectId, "indexing", 0, "Starting incremental index...");

    try {
      const stats = await indexer.indexProject(false);
      updateStatus(projectId, "idle", 100, "Incremental indexing complete");
      res.json({ success: true, projectId, stats });
    } catch (error) {
      const err = error as Error;
      updateStatus(projectId, "error", 0, "Incremental indexing failed", err.message);
      res.status(500).json({ error: "Incremental indexing failed", message: err.message });
    }
  } catch (error) {
    console.error("[CodebaseIndex] Incremental index error:", error);
    res.status(500).json({ error: "Failed to start incremental indexing" });
  }
});

// POST /api/infinity/codebase/index/file - Index single file
router.post("/index/file", async (req: Request, res: Response) => {
  try {
    const { projectId, filePath } = fileIndexSchema.parse(req.body);

    const indexer = indexers.get(projectId);
    if (!indexer) {
      return res.status(404).json({ error: "Indexer not found" });
    }

    const fs = await import("fs");
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    await indexer.reindexFile(filePath);
    const stats = indexer.getStats();

    res.json({ success: true, projectId, filePath, stats });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[CodebaseIndex] File index error:", error);
    res.status(500).json({ error: "Failed to index file" });
  }
});

// DELETE /api/infinity/codebase/index/file - Remove file from index
router.delete("/index/file", async (req: Request, res: Response) => {
  try {
    const { projectId, filePath } = fileIndexSchema.parse(req.body);

    const indexer = indexers.get(projectId);
    if (!indexer) {
      return res.status(404).json({ error: "Indexer not found" });
    }

    await indexer.removeFile(filePath);
    const stats = indexer.getStats();

    res.json({ success: true, projectId, filePath, stats });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[CodebaseIndex] File remove error:", error);
    res.status(500).json({ error: "Failed to remove file from index" });
  }
});

// DELETE /api/infinity/codebase/index - Clear entire index
router.delete("/index", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query;
    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }

    const indexer = indexers.get(projectId);
    if (indexer) {
      indexer.close();
      indexers.delete(projectId);
    }
    indexStatus.delete(projectId);

    res.json({ success: true, projectId, message: "Index cleared" });
  } catch (error) {
    console.error("[CodebaseIndex] Clear index error:", error);
    res.status(500).json({ error: "Failed to clear index" });
  }
});

// GET /api/infinity/codebase/stats - Get index statistics
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query;
    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }

    const indexer = indexers.get(projectId);
    if (!indexer) {
      return res.status(404).json({ error: "Indexer not found" });
    }

    const stats = indexer.getStats();
    res.json({ projectId, ...stats });
  } catch (error) {
    console.error("[CodebaseIndex] Stats error:", error);
    res.status(500).json({ error: "Failed to get stats" });
  }
});

// POST /api/infinity/codebase/search - Semantic search
router.post("/search", async (req: Request, res: Response) => {
  try {
    const { projectId, query, limit, types, languages, hybrid, expandQuery: shouldExpand } = searchSchema.parse(req.body);

    const indexer = indexers.get(projectId);
    if (!indexer) {
      return res.status(404).json({ error: "Indexer not found. Run index first." });
    }

    let searchQuery = query;
    let expandedTerms: string[] = [];

    if (shouldExpand) {
      expandedTerms = expandQuery(query);
      searchQuery = expandedTerms.join(" ");
    }

    const results = await indexer.search(searchQuery, { limit, types, languages, hybrid });

    // Format results for @codebase context
    const formattedResults = results.map(r => ({
      file: r.chunk.relativePath,
      filePath: r.chunk.filePath,
      language: r.chunk.language,
      type: r.chunk.chunkType,
      name: r.chunk.name,
      signature: r.chunk.signature,
      content: r.chunk.content,
      startLine: r.chunk.startLine,
      endLine: r.chunk.endLine,
      score: r.score,
      matchType: r.matchType,
    }));

    res.json({
      projectId,
      query,
      expandedQuery: shouldExpand ? expandedTerms : undefined,
      results: formattedResults,
      totalResults: formattedResults.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid search request", details: error.errors });
    }
    console.error("[CodebaseIndex] Search error:", error);
    res.status(500).json({ error: "Search failed" });
  }
});

// POST /api/infinity/codebase/search/symbol - Exact symbol search
router.post("/search/symbol", async (req: Request, res: Response) => {
  try {
    const { projectId, symbol, limit } = symbolSearchSchema.parse(req.body);

    const indexer = indexers.get(projectId);
    if (!indexer) {
      return res.status(404).json({ error: "Indexer not found" });
    }

    const results = await indexer.searchBySymbol(symbol, limit);

    const formattedResults = results.map(r => ({
      file: r.chunk.relativePath,
      filePath: r.chunk.filePath,
      language: r.chunk.language,
      type: r.chunk.chunkType,
      name: r.chunk.name,
      signature: r.chunk.signature,
      content: r.chunk.content,
      startLine: r.chunk.startLine,
      endLine: r.chunk.endLine,
      score: r.score,
      matchType: r.matchType,
    }));

    res.json({ projectId, symbol, results: formattedResults });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    console.error("[CodebaseIndex] Symbol search error:", error);
    res.status(500).json({ error: "Symbol search failed" });
  }
});

// POST /api/infinity/codebase/parse - Parse single file (for testing/debugging)
router.post("/parse", async (req: Request, res: Response) => {
  try {
    const { filePath } = z.object({ filePath: z.string().min(1) }).parse(req.body);

    const fs = await import("fs");
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const manager = getTreeSitterManager();
    await manager.initialize();

    const parsed = await manager.parseFile(filePath, content);

    if (!parsed) {
      return res.status(400).json({ error: "Unsupported language or parse failed" });
    }

    res.json({
      filePath: parsed.filePath,
      language: parsed.language,
      totalLines: parsed.totalLines,
      chunks: parsed.chunks.map(c => ({
        id: c.id,
        type: c.type,
        name: c.name,
        signature: c.signature,
        startLine: c.startLine,
        endLine: c.endLine,
        content: c.content.slice(0, 500), // Truncate for response
      })),
      imports: parsed.imports,
      exports: parsed.exports,
    });
  } catch (error) {
    console.error("[CodebaseIndex] Parse error:", error);
    res.status(500).json({ error: "Parse failed" });
  }
});

// GET /api/infinity/codebase/languages - Get supported languages
router.get("/languages", async (req: Request, res: Response) => {
  const manager = getTreeSitterManager();
  const languages = manager.getSupportedLanguages();
  const { SUPPORTED_LANGUAGES } = await import("../../lib/tree-sitter-parsers.js");

  const languageDetails = languages.map(lang => {
    const config = SUPPORTED_LANGUAGES[lang];
    return {
      id: lang,
      name: config.name,
      extensions: config.extensions,
      aliases: config.aliases,
      mimeTypes: config.mimeTypes,
    };
  });

  res.json({ languages: languageDetails });
});

// GET /api/infinity/codebase/embedding-models - Get recommended embedding models
router.get("/embedding-models", async (req: Request, res: Response) => {
  const { RECOMMENDED_MODELS, EMBEDDING_PRESETS } = await import("../../lib/embeddings.js");

  res.json({
    models: RECOMMENDED_MODELS,
    presets: Object.keys(EMBEDDING_PRESETS),
  });
});

// WebSocket for file watching (if needed)
// This would be handled by a separate WebSocket server in production

export default router;

// Export for programmatic use
export { indexers, indexStatus, getOrCreateIndexer, updateStatus };