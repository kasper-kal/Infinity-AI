import { Router } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFile, getWorkspaceRoot } from "../../lib/workspace";

const router = Router();

interface SearchMatch {
  file: string;
  line: number;
  column: number;
  preview: string;
  match: string;
}

interface SearchResult {
  query: string;
  matches: SearchMatch[];
  totalMatches: number;
  filesWithMatches: number;
  regex: boolean;
  caseSensitive: boolean;
}

interface ReplaceResult {
  totalReplaced: number;
  filesModified: string[];
  replacements: Array<{ file: string; count: number }>;
}

/**
 * Search for text in workspace files.
 */
async function searchFiles(
  workspaceId: string,
  query: string,
  options: {
    regex?: boolean;
    caseSensitive?: boolean;
    includeHidden?: boolean;
    filePattern?: string;
    maxResults?: number;
  } = {},
): Promise<SearchResult> {
  const {
    regex = false,
    caseSensitive = false,
    includeHidden = false,
    filePattern = "*",
    maxResults = 1000,
  } = options;

  const result: SearchResult = {
    query,
    matches: [],
    totalMatches: 0,
    filesWithMatches: 0,
    regex,
    caseSensitive,
  };

  try {
    const entries = await listWorkspaceFiles(workspaceId);
    const searchRegex = regex ? new RegExp(query, caseSensitive ? "g" : "gi") : null;

    const filesProcessed = new Set<string>();

    for (const entry of entries) {
      if (entry.type !== "file") continue;
      if (!includeHidden && entry.path.split("/").some((p) => p.startsWith("."))) continue;
      if (!entry.path.match(filePattern)) continue;
      if (result.matches.length >= maxResults) break;

      try {
        const content = await readWorkspaceFile(entry.path, 500000, workspaceId);
        if (!content.ok) continue;

        const text = content.content;
        const lines = text.split("\n");
        let fileMatches = 0;

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const line = lines[lineNum];
          let matches: Array<{ index: number; text: string }> = [];

          if (searchRegex) {
            let match;
            searchRegex.lastIndex = 0;
            while ((match = searchRegex.exec(line)) !== null) {
              matches.push({ index: match.index, text: match[0] });
            }
          } else {
            const searchStr = caseSensitive ? query : query.toLowerCase();
            const lineStr = caseSensitive ? line : line.toLowerCase();
            let index = lineStr.indexOf(searchStr);
            while (index !== -1) {
              matches.push({ index, text: line.slice(index, index + query.length) });
              index = lineStr.indexOf(searchStr, index + 1);
            }
          }

          for (const m of matches) {
            if (result.matches.length >= maxResults) break;
            const preview = line.slice(Math.max(0, m.index - 20), Math.min(line.length, m.index + 60));
            result.matches.push({
              file: entry.path,
              line: lineNum + 1,
              column: m.index + 1,
              preview,
              match: m.text,
            });
            fileMatches++;
          }

          if (result.matches.length >= maxResults) break;
        }

        if (fileMatches > 0) {
          filesProcessed.add(entry.path);
          result.totalMatches += fileMatches;
        }
      } catch {
        // Skip files that can't be read
      }
    }

    result.filesWithMatches = filesProcessed.size;
    return result;
  } catch {
    return result;
  }
}

/**
 * Replace text in workspace files.
 */
async function replaceInFiles(
  workspaceId: string,
  query: string,
  replacement: string,
  options: {
    regex?: boolean;
    caseSensitive?: boolean;
    files?: string[];
    maxReplacements?: number;
  } = {},
): Promise<ReplaceResult> {
  const { regex = false, caseSensitive = false, files: targetFiles = [], maxReplacements = 5000 } = options;

  const result: ReplaceResult = {
    totalReplaced: 0,
    filesModified: [],
    replacements: [],
  };

  try {
    const entries = await listWorkspaceFiles(workspaceId);
    const searchRegex = regex ? new RegExp(query, caseSensitive ? "g" : "gi") : null;
    const filesToProcess = targetFiles.length > 0 ? new Set(targetFiles) : null;

    for (const entry of entries) {
      if (entry.type !== "file") continue;
      if (filesToProcess && !filesToProcess.has(entry.path)) continue;

      try {
        const content = await readWorkspaceFile(entry.path, 500000, workspaceId);
        if (!content.ok) continue;

        let text = content.content;
        let replacementCount = 0;

        if (searchRegex) {
          const matches = text.match(searchRegex);
          replacementCount = matches ? matches.length : 0;
          text = text.replace(searchRegex, replacement);
        } else {
          const searchStr = caseSensitive ? query : query.toLowerCase();
          const textStr = caseSensitive ? text : text.toLowerCase();
          let index = textStr.indexOf(searchStr);
          while (index !== -1 && replacementCount < maxReplacements) {
            text = text.slice(0, index) + replacement + text.slice(index + query.length);
            index = textStr.indexOf(searchStr, index + replacement.length);
            replacementCount++;
          }
        }

        if (replacementCount > 0) {
          await writeWorkspaceFile(entry.path, text, workspaceId);
          result.filesModified.push(entry.path);
          result.replacements.push({ file: entry.path, count: replacementCount });
          result.totalReplaced += replacementCount;
        }

        if (result.totalReplaced >= maxReplacements) break;
      } catch {
        // Skip files that can't be processed
      }
    }

    return result;
  } catch {
    return result;
  }
}

/**
 * GET /search - Search for text in files.
 */
router.get("/search", async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : "default";
  const query = typeof req.query.q === "string" ? req.query.q : "";
  const regex = req.query.regex === "true";
  const caseSensitive = req.query.case === "true";
  const includeHidden = req.query.hidden === "true";
  const filePattern = typeof req.query.files === "string" ? req.query.files : "*";
  const maxResults = Math.min(5000, Math.max(10, Number(req.query.max) || 1000));

  if (!query.trim()) {
    res.status(400).json({ error: "Search query is required" });
    return;
  }

  if (regex) {
    try {
      new RegExp(query, caseSensitive ? "" : "i");
    } catch {
      res.status(400).json({ error: "Invalid regex pattern" });
      return;
    }
  }

  try {
    const result = await searchFiles(workspaceId, query.slice(0, 500), {
      regex,
      caseSensitive,
      includeHidden,
      filePattern,
      maxResults,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Search failed" });
  }
});

/**
 * POST /search/replace - Replace text in files.
 */
router.post("/search/replace", async (req, res) => {
  const workspaceId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "default";
  const query = typeof req.body?.query === "string" ? req.body.query : "";
  const replacement = typeof req.body?.replacement === "string" ? req.body.replacement : "";
  const regex = req.body?.regex === true;
  const caseSensitive = req.body?.case === true;
  const files: string[] = Array.isArray(req.body?.files)
    ? req.body.files.filter((f: unknown): f is string => typeof f === "string")
    : [];

  if (!query.trim()) {
    res.status(400).json({ error: "Search query is required" });
    return;
  }

  if (regex) {
    try {
      new RegExp(query, caseSensitive ? "" : "i");
    } catch {
      res.status(400).json({ error: "Invalid regex pattern" });
      return;
    }
  }

  try {
    const result = await replaceInFiles(workspaceId, query.slice(0, 500), replacement.slice(0, 1000), {
      regex,
      caseSensitive,
      files: files.slice(0, 100),
      maxReplacements: 5000,
    });

    res.json({
      ok: true,
      query,
      replacement,
      ...result,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Replace failed" });
  }
});

/**
 * GET /search/files - List files matching a pattern (for quick file lookup).
 */
router.get("/search/files", async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : "default";
  const pattern = typeof req.query.pattern === "string" ? req.query.pattern : "";

  try {
    const entries = await listWorkspaceFiles(workspaceId);
    const filtered = entries
      .filter((e) => e.type === "file")
      .filter((e) => !pattern || e.path.toLowerCase().includes(pattern.toLowerCase()))
      .slice(0, 500);

    res.json({
      pattern,
      files: filtered.map((e) => ({
        path: e.path,
        size: e.size,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list files" });
  }
});

export default router;
export { searchFiles, replaceInFiles };
