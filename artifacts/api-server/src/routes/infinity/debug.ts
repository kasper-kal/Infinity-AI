import { Router } from "express";
import { pooledClient } from "../../lib/llm-client";
import { jarvisConfig } from "../../config/jarvis";
import { cleanText, parseJsonObject } from "../../lib/text-utils";
import { createBestAdapter } from "../../lib/adapter-factory";
import { buildInfinityPrompt, sanitizePrompt } from "../../lib/infinity-prompt";
import { LLMAdapter, LLMAdapterError } from "../../lib/llm-adapter";

const router = Router();

/**
 * Error pattern matcher for multiple languages and frameworks.
 * Detects stack traces, compilation errors, runtime exceptions, etc.
 */
interface ParsedError {
  type: "runtime" | "compilation" | "syntax" | "assertion" | "timeout" | "other";
  language: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  stackTrace: string[];
  context: string; // surrounding lines of code
}

/**
 * Suggested fix for an error.
 */
interface ErrorFix {
  title: string;
  description: string;
  code: string; // suggested replacement code
  confidence: number; // 0-100
}

/**
 * Parse error output from terminal/build logs.
 * Supports: JavaScript/TypeScript, Python, Go, Rust, Ruby, PHP, Java, C/C++, C#, and more.
 */
function parseErrorOutput(output: string): ParsedError | null {
  if (!output || output.length === 0) return null;

  const lines = output.split("\n");
  let errorType: ParsedError["type"] = "other";
  let language = "unknown";
  let message = "";
  let file: string | undefined;
  let line: number | undefined;
  let column: number | undefined;
  const stackTrace: string[] = [];
  let inStackTrace = false;

  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i];

    // JavaScript/TypeScript errors
    if (
      currentLine.includes("SyntaxError") ||
      currentLine.includes("TypeError") ||
      currentLine.includes("ReferenceError") ||
      currentLine.includes("RangeError")
    ) {
      errorType = currentLine.includes("SyntaxError") ? "syntax" : "runtime";
      language = "javascript";
      message = currentLine;
      inStackTrace = true;
      continue;
    }

    // Python errors
    if (currentLine.includes("File ") && currentLine.includes("line ")) {
      errorType = "runtime";
      language = "python";
      const match = currentLine.match(/File "([^"]+)", line (\d+)/);
      if (match) {
        file = match[1];
        line = parseInt(match[2], 10);
      }
      inStackTrace = true;
      continue;
    }

    // Rust errors (error: or warning:)
    if (currentLine.includes("error[") || currentLine.includes("error:")) {
      errorType = currentLine.includes("error[") ? "compilation" : "runtime";
      language = "rust";
      message = currentLine;
      const fileMatch = currentLine.match(/^([^:]+):(\d+):(\d+)/);
      if (fileMatch) {
        file = fileMatch[1];
        line = parseInt(fileMatch[2], 10);
        column = parseInt(fileMatch[3], 10);
      }
      inStackTrace = true;
      continue;
    }

    // Go errors
    if (currentLine.includes("panic:") || currentLine.includes("fatal error:")) {
      errorType = currentLine.includes("panic:") ? "runtime" : "compilation";
      language = "go";
      message = currentLine;
      inStackTrace = true;
      continue;
    }

    // Java stack traces
    if (
      currentLine.includes("Exception") ||
      currentLine.includes("Error") ||
      currentLine.includes("\tat ")
    ) {
      errorType = "runtime";
      language = "java";
      message = currentLine;
      inStackTrace = true;
      if (currentLine.includes("\tat ")) {
        const methodMatch = currentLine.match(/\tat ([^\(]+)\(([^\)]+):(\d+)\)/);
        if (methodMatch) {
          file = methodMatch[2];
          line = parseInt(methodMatch[3], 10);
        }
      }
      continue;
    }

    // C/C++ compiler errors
    if (currentLine.match(/^[^:]+:\d+:\d+: (error|warning):/)) {
      errorType = currentLine.includes("error:") ? "compilation" : "runtime";
      language = currentLine.includes(".rs") ? "rust" : currentLine.includes(".cpp") ? "cpp" : "c";
      message = currentLine;
      const match = currentLine.match(/^([^:]+):(\d+):(\d+):/);
      if (match) {
        file = match[1];
        line = parseInt(match[2], 10);
        column = parseInt(match[3], 10);
      }
      inStackTrace = true;
      continue;
    }

    // PHP errors
    if (currentLine.includes("PHP ") && (currentLine.includes("Error") || currentLine.includes("Warning"))) {
      errorType = "runtime";
      language = "php";
      message = currentLine;
      const match = currentLine.match(/in (.+) on line (\d+)/);
      if (match) {
        file = match[1];
        line = parseInt(match[2], 10);
      }
      inStackTrace = true;
      continue;
    }

    // Timeout detection
    if (
      currentLine.includes("timeout") ||
      currentLine.includes("timed out") ||
      currentLine.includes("TIMEOUT")
    ) {
      errorType = "timeout";
      message = currentLine;
    }

    // Collect stack trace lines
    if (inStackTrace && (currentLine.includes("at ") || currentLine.includes("from ") || currentLine.match(/^\s+/))) {
      stackTrace.push(currentLine);
    }
  }

  if (!message && !file) return null;

  // Try to extract context (surrounding code lines if available)
  const contextLines: string[] = [];
  for (const traceLine of stackTrace.slice(0, 5)) {
    if (traceLine.includes("at ")) {
      contextLines.push(traceLine);
    }
  }

  return {
    type: errorType,
    language,
    message: cleanText(message, 500),
    file,
    line,
    column,
    stackTrace: stackTrace.slice(0, 10),
    context: contextLines.join("\n"),
  };
}

/**
 * POST /debug/parse
 * Parse error output and return structured error information.
 */
router.post("/debug/parse", (req, res) => {
  const output = cleanText(req.body?.output, 10000);
  if (!output) {
    return res.status(400).json({ error: "No output provided" });
  }

  const parsed = parseErrorOutput(output);
  if (!parsed) {
    return res.status(400).json({ error: "Could not parse error from output" });
  }

  return res.json({
    ok: true,
    error: parsed,
  });
});

/**
 * POST /debug/suggest-fixes
 * Use LLM to suggest 3 fixes for a parsed error.
 */
router.post("/debug/suggest-fixes", async (req, res) => {
  const errorObj = req.body?.error;
  const codeContext = cleanText(req.body?.codeContext, 3000);

  if (!errorObj || !errorObj.message) {
    return res.status(400).json({ error: "No error object provided" });
  }

  try {
    const adapter = await createBestAdapter();

    const prompt = `You are a code debugging expert. A developer encountered this error:

Language: ${errorObj.language}
Error Type: ${errorObj.type}
File: ${errorObj.file || "(unknown)"}
Line: ${errorObj.line || "(unknown)"}
Column: ${errorObj.column || "(unknown)"}
Message: ${errorObj.message}

Stack Trace:
${errorObj.stackTrace.join("\n")}

${codeContext ? `Code Context:\n${codeContext}\n` : ""}

Suggest exactly 3 fixes for this error. For each fix, provide:
1. A clear title
2. A detailed explanation of what caused the error
3. The corrected code snippet (just the relevant lines, ready to copy-paste)
4. A confidence score (0-100) for how likely this fix is to work

Return ONLY valid JSON with this exact structure:
{
  "fixes": [
    {
      "title": "Fix Title",
      "description": "Why this error occurred and how to fix it",
      "code": "corrected code here",
      "confidence": 85
    },
    ...
  ]
}

Never explain your reasoning outside the JSON. Return ONLY the JSON object.`;

    const systemPrompt = buildInfinityPrompt({
      role: "fixer",
      extraInstructions: "You are an expert debugger. Respond with ONLY valid JSON, no other text. Always provide exactly 3 fixes.",
    });
    const completion = await adapter.complete([
      { role: "system", content: sanitizePrompt(systemPrompt) },
      {
        role: "user",
        content: prompt,
      },
    ], {
      temperature: 0.7,
      maxTokens: 2000,
      jsonMode: true,
    });

    const responseText = completion.content.trim() ?? "";
    const parsed = parseJsonObject(responseText);

    if (!parsed || !Array.isArray(parsed.fixes)) {
      return res.json({
        ok: true,
        fixes: [
          {
            title: "Review Error Context",
            description: "Unable to generate AI suggestions. Review the error message and stack trace above.",
            code: "// Check the error output above for details",
            confidence: 30,
          },
        ],
      });
    }

    // Ensure we have exactly 3 fixes
    const fixes = parsed.fixes.slice(0, 3).map((fix: Record<string, unknown>) => ({
      title: cleanText(fix.title, 100) || "Unknown Fix",
      description: cleanText(fix.description, 500) || "",
      code: cleanText(fix.code, 1000) || "",
      confidence: Math.min(100, Math.max(0, Number(fix.confidence) || 50)),
    }));

    return res.json({
      ok: true,
      fixes,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to suggest fixes");
    return res.status(500).json({ error: "Failed to generate fix suggestions" });
  }
});

/**
 * POST /debug/apply-fix
 * Apply a suggested fix to a file.
 */
router.post("/debug/apply-fix", async (req, res) => {
  const fixCode = cleanText(req.body?.fixCode, 2000);
  const targetFile = cleanText(req.body?.targetFile, 500);
  const searchText = cleanText(req.body?.searchText, 2000);

  if (!fixCode || !targetFile) {
    return res.status(400).json({ error: "fixCode and targetFile are required" });
  }

  try {
    // Note: Actual file modification would use workspace API
    // For now, return a dry-run showing what would be changed
    return res.json({
      ok: true,
      action: "apply-fix",
      file: targetFile,
      status: "ready",
      message: `Fix is ready to apply. This would replace the error code with: ${fixCode.substring(0, 100)}...`,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to apply fix");
    return res.status(500).json({ error: "Failed to apply fix" });
  }
});

/**
 * POST /debug/explain-error
 * Get a detailed explanation of an error in plain language.
 */
router.post("/debug/explain-error", async (req, res) => {
  const errorObj = req.body?.error;

  if (!errorObj || !errorObj.message) {
    return res.status(400).json({ error: "No error object provided" });
  }

  try {
    const adapter = await createBestAdapter();

    const prompt = `Explain this error in simple, clear language:

Language: ${errorObj.language}
Error Type: ${errorObj.type}
Message: ${errorObj.message}
File: ${errorObj.file || "(unknown)"}
Line: ${errorObj.line || "(unknown)"}

Provide:
1. What this error means
2. Why it might have happened
3. Common causes
4. Quick fix suggestions (2-3 bullet points)

Keep it concise and beginner-friendly.`;

    const systemPrompt = buildInfinityPrompt({
      role: "chat",
      extraInstructions: "You are an expert at explaining programming errors in simple, beginner-friendly language.",
    });
    const completion = await adapter.complete([
      { role: "system", content: sanitizePrompt(systemPrompt) },
      {
        role: "user",
        content: prompt,
      },
    ], {
      temperature: 0.7,
      maxTokens: 800,
    });

    const explanation = cleanText(completion.content.trim() ?? "", 1200);

    return res.json({
      ok: true,
      explanation,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to explain error");
    return res.status(500).json({ error: "Failed to generate explanation" });
  }
});

export default router;
