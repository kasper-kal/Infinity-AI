/**
 * Local Model Endpoints — Explain Error & Fix Code
 *
 * Uses Qwen2.5-1.5B-Instruct via Ollama for in-app error fixing and explanation.
 * Runs locally (~1GB RAM, fast inference, no API calls).
 */

import { Router, Request, Response } from "express";
import { createLocalAdapter, isLocalModelAvailable, LocalModelAdapter } from "../../lib/adapters/local-adapter";
import { LLMAdapter, LLMMessage } from "../../lib/llm-adapter";

const router = Router();

/**
 * POST /api/jarvis/local-model/explain
 * Explain a TypeScript/build error in plain English with fix suggestions
 */
router.post("/explain", async (req: Request, res: Response) => {
  try {
    // Check if local model is available
    const available = await isLocalModelAvailable();
    if (!available) {
      return res.status(503).json({
        error: "Local model not available. Ensure Ollama is running and qwen2.5:1.5b-instruct is pulled.",
        code: "LOCAL_MODEL_UNAVAILABLE",
      });
    }

    const { error, file, language, context } = req.body as {
      error: string;
      file?: string;
      language?: string;
      context?: string;
    };

    if (!error || typeof error !== "string") {
      return res.status(400).json({ error: "error field is required" });
    }

    const adapter = await createLocalAdapter();

    // Build prompt for error explanation
    const systemPrompt = `You are an expert software engineer helping a developer understand and fix a build/error message.

RULES:
- Explain the error in PLAIN ENGLISH (non-technical where possible)
- Identify the ROOT CAUSE
- Provide 1-3 concrete FIX SUGGESTIONS with code examples
- Be concise but thorough
- Return as JSON with fields: explanation, rootCause, fixes[]`;

    const userPrompt = `Error to explain:
\`\`\`${language ?? "typescript"}
${error}
\`\`\`

${file ? `File: ${file}` : ""}
${context ? `Context:\n\`\`\`\n${context}\n\`\`\`` : ""}

Return JSON with: explanation, rootCause, fixes (array of {title, description, code})`;

    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const result = await adapter.complete(messages, {
      temperature: 0.3,
      maxTokens: 2048,
      jsonMode: true,
    });

    // Parse JSON response
    let parsed: { explanation: string; rootCause: string; fixes: Array<{ title: string; description: string; code?: string }> } | null = null;
    try {
      const match = result.content.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      }
    } catch {
      // If JSON parsing fails, return raw content
    }

    if (!parsed) {
      return res.json({
        explanation: result.content,
        rootCause: "Could not parse structured response",
        fixes: [],
      });
    }

    return res.json(parsed);
  } catch (err) {
    console.error("[local-model/explain] Error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message, code: "EXPLAIN_FAILED" });
  }
});

/**
 * POST /api/jarvis/local-model/fix
 * Propose a fix for a build error with code changes
 */
router.post("/fix", async (req: Request, res: Response) => {
  try {
    // Check if local model is available
    const available = await isLocalModelAvailable();
    if (!available) {
      return res.status(503).json({
        error: "Local model not available. Ensure Ollama is running and qwen2.5:1.5b-instruct is pulled.",
        code: "LOCAL_MODEL_UNAVAILABLE",
      });
    }

    const { error, file, language, fileContent, context, workspaceFiles } = req.body as {
      error: string;
      file?: string;
      language?: string;
      fileContent?: string;
      context?: string;
      workspaceFiles?: Array<{ path: string; content: string }>;
    };

    if (!error || typeof error !== "string") {
      return res.status(400).json({ error: "error field is required" });
    }

    const adapter = await createLocalAdapter();

    // Build prompt for fix proposal
    const systemPrompt = `You are an expert software engineer proposing a FIX for a build/compilation error.

RULES:
- Analyze the error and the provided file content
- Propose a MINIMAL, targeted fix
- Return ONLY the fixed file content (not the whole file if only a small change)
- If multiple files need changes, provide each as a separate fix
- Explain WHY this fix works
- Be precise - the fix will be applied automatically
- Return as JSON with fields: fixes[] (each has file, oldCode, newCode, explanation, confidence)`;

    let workspaceContext = "";
    if (workspaceFiles && workspaceFiles.length > 0) {
      workspaceContext = "\n\nRelated workspace files:\n";
      for (const wf of workspaceFiles.slice(0, 5)) {
        workspaceContext += `\n--- ${wf.path} ---\n${wf.content.slice(0, 2000)}\n`;
      }
    }

    const userPrompt = `Error to fix:
\`\`\`${language ?? "typescript"}
${error}
\`\`\`

${file ? `File: ${file}` : ""}
${fileContent ? `Current file content:\n\`\`\`${language ?? "typescript"}\n${fileContent}\n\`\`\`` : ""}
${context ? `Additional context:\n${context}` : ""}
${workspaceContext}

Return JSON with fixes array: [{ file, oldCode, newCode, explanation, confidence }]`;

    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const result = await adapter.complete(messages, {
      temperature: 0.2,
      maxTokens: 4096,
      jsonMode: true,
    });

    // Parse JSON response
    let parsed: { fixes: Array<{ file: string; oldCode: string; newCode: string; explanation: string; confidence: number }> } | null = null;
    try {
      const match = result.content.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      }
    } catch {
      // If JSON parsing fails
    }

    if (!parsed || !parsed.fixes || parsed.fixes.length === 0) {
      return res.json({
        fixes: [],
        rawResponse: result.content,
      });
    }

    return res.json(parsed);
  } catch (err) {
    console.error("[local-model/fix] Error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message, code: "FIX_FAILED" });
  }
});

/**
 * GET /api/jarvis/local-model/status
 * Check local model health and availability
 */
router.get("/status", async (_req: Request, res: Response) => {
  try {
    const adapter = await createLocalAdapter();
    const healthy = await adapter.isHealthy();
    const info = adapter.getModelInfo();

    return res.json({
      available: healthy,
      ...info,
    });
  } catch (err) {
    console.error("[local-model/status] Error:", err);
    return res.json({
      available: false,
      baseUrl: "http://localhost:11434",
      modelName: "qwen2.5:1.5b-instruct",
      loaded: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * POST /api/jarvis/local-model/pull
 * Trigger model pull (background)
 */
router.post("/pull", async (req: Request, res: Response) => {
  try {
    const { model } = req.body as { model?: string };
    const modelName = model ?? "qwen2.5:1.5b-instruct";

    const adapter = new LocalModelAdapter(
      process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      modelName
    );

    // Start pull in background
    const pullPromise = adapter.ensureModel();

    // Return immediately with status
    res.json({
      status: "pulling",
      model: modelName,
      message: "Model pull started in background. Check /status for completion.",
    });

    // Wait for completion (fire and forget for logging)
    return;
    pullPromise.then((success) => {
      console.log(`[local-model/pull] Model ${modelName} pull ${success ? "succeeded" : "failed"}`);
    }).catch((err) => {
      console.error(`[local-model/pull] Model ${modelName} pull error:`, err);
    });
  } catch (err) {
    console.error("[local-model/pull] Error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message, code: "PULL_FAILED" });
  }
});

export default router;