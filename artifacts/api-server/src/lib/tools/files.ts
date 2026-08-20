/**
 * Phase 22: Universal Tool Layer — Files Capability Integration
 *
 * Registers file search, replace, read, write, and list tools.
 * Wraps existing implementations from search.ts and workspace.ts.
 */

import { registerTool } from "../tool-registry";
import { listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFile, getWorkspaceRoot } from "../workspace";
import { logger } from "../logger";
import type { UniversalToolDefinition, ToolExecutionContext, UniversalToolResult } from "../tool-types";

export function registerFilesTools(): void {
  const search: UniversalToolDefinition = {
    name: "files.search",
    description: "Search for text across workspace files. Supports regex, case sensitivity, and file patterns.",
    category: "files",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (string or regex)" },
        workspaceId: { type: "string", description: "Workspace ID (default: 'default')" },
        regex: { type: "boolean", description: "Treat query as regex (default: false)" },
        caseSensitive: { type: "boolean", description: "Case sensitive search (default: false)" },
        includeHidden: { type: "boolean", description: "Include hidden files (default: false)" },
        filePattern: { type: "string", description: "Glob pattern for files (default: '*')" },
        maxResults: { type: "number", description: "Max results (default: 100, max: 5000)" },
      },
      required: ["query"],
    },
    timeoutMs: 30000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const query = String(args["query"] ?? "").trim();
      if (!query) return { success: false, error: "query is required" };
      try {
        const workspaceId = String(args["workspaceId"] ?? "default");
        const regex = args["regex"] === true;
        const caseSensitive = args["caseSensitive"] === true;
        const includeHidden = args["includeHidden"] === true;
        const filePattern = String(args["filePattern"] ?? "*");
        const maxResults = Math.min(5000, Math.max(10, Number(args["maxResults"] ?? 100)));

        const entries = await listWorkspaceFiles(workspaceId);
        const searchRegex = regex ? new RegExp(query, caseSensitive ? "g" : "gi") : null;

        const result: any = { query, matches: [], totalMatches: 0, filesWithMatches: 0, regex, caseSensitive };
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
        return {
          success: true,
          data: result,
          summary: `Found ${result.totalMatches} matches in ${result.filesWithMatches} files`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Search failed" };
      }
    },
  };

  const replace: UniversalToolDefinition = {
    name: "files.replace",
    description: "Replace text in workspace files. Supports regex, case sensitivity, and targeting specific files.",
    category: "files",
    risk: "WRITE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (string or regex)" },
        replacement: { type: "string", description: "Replacement text" },
        workspaceId: { type: "string", description: "Workspace ID (default: 'default')" },
        regex: { type: "boolean", description: "Treat query as regex (default: false)" },
        caseSensitive: { type: "boolean", description: "Case sensitive (default: false)" },
        files: { type: "array", items: { type: "string" }, description: "Specific files to process (default: all)" },
        maxReplacements: { type: "number", description: "Max total replacements (default: 5000)" },
      },
      required: ["query", "replacement"],
    },
    timeoutMs: 30000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const query = String(args["query"] ?? "").trim();
      const replacement = String(args["replacement"] ?? "");
      if (!query) return { success: false, error: "query is required" };
      if (replacement === undefined) return { success: false, error: "replacement is required" };

      try {
        const workspaceId = String(args["workspaceId"] ?? "default");
        const regex = args["regex"] === true;
        const caseSensitive = args["caseSensitive"] === true;
        const targetFiles: string[] = Array.isArray(args["files"])
          ? args["files"].filter((f): f is string => typeof f === "string")
          : [];
        const maxReplacements = Math.min(5000, Math.max(1, Number(args["maxReplacements"] ?? 5000)));

        const entries = await listWorkspaceFiles(workspaceId);
        const searchRegex = regex ? new RegExp(query, caseSensitive ? "g" : "gi") : null;
        const filesToProcess = targetFiles.length > 0 ? new Set(targetFiles) : null;

        const result: any = { totalReplaced: 0, filesModified: [], replacements: [] };

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

        return {
          success: true,
          data: result,
          summary: `Replaced ${result.totalReplaced} occurrences in ${result.filesModified.length} files`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Replace failed" };
      }
    },
  };

  const list: UniversalToolDefinition = {
    name: "files.list",
    description: "List files in the workspace matching a pattern. Returns paths and sizes.",
    category: "files",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "Workspace ID (default: 'default')" },
        pattern: { type: "string", description: "Substring pattern to filter paths (default: '')" },
      },
    },
    timeoutMs: 10000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      try {
        const workspaceId = String(args["workspaceId"] ?? "default");
        const pattern = String(args["pattern"] ?? "");
        const entries = await listWorkspaceFiles(workspaceId);
        const filtered = entries
          .filter((e) => e.type === "file")
          .filter((e) => !pattern || e.path.toLowerCase().includes(pattern.toLowerCase()))
          .slice(0, 500);

        return {
          success: true,
          data: { pattern, files: filtered.map((e) => ({ path: e.path, size: e.size })) },
          summary: `Listed ${filtered.length} files`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "List failed" };
      }
    },
  };

  const read: UniversalToolDefinition = {
    name: "files.read",
    description: "Read the content of a file in the workspace. Returns full text.",
    category: "files",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root" },
        workspaceId: { type: "string", description: "Workspace ID (default: 'default')" },
        maxBytes: { type: "number", description: "Max bytes to read (default: 500KB, max: 5MB)" },
      },
      required: ["path"],
    },
    timeoutMs: 10000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const path = String(args["path"] ?? "").trim();
      if (!path) return { success: false, error: "path is required" };
      try {
        const workspaceId = String(args["workspaceId"] ?? "default");
        const maxBytes = Math.min(5_000_000, Math.max(1, Number(args["maxBytes"] ?? 500_000)));
        const content = await readWorkspaceFile(path, maxBytes, workspaceId);
        if (!content.ok) return { success: false, error: content.error ?? "File not found or unreadable" };
        return { success: true, data: { path, content: content.content, size: content.content.length }, summary: `Read ${path} (${content.content.length} chars)` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Read failed" };
      }
    },
  };

  const write: UniversalToolDefinition = {
    name: "files.write",
    description: "Write content to a file in the workspace. Creates directories as needed.",
    category: "files",
    risk: "WRITE",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root" },
        content: { type: "string", description: "Content to write" },
        workspaceId: { type: "string", description: "Workspace ID (default: 'default')" },
      },
      required: ["path", "content"],
    },
    timeoutMs: 10000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const path = String(args["path"] ?? "").trim();
      if (!path) return { success: false, error: "path is required" };
      if (typeof args["content"] !== "string") return { success: false, error: "content must be a string" };
      try {
        const workspaceId = String(args["workspaceId"] ?? "default");
        await writeWorkspaceFile(path, args["content"], workspaceId);
        return { success: true, data: { path, size: args["content"].length }, summary: `Wrote ${path} (${args["content"].length} chars)` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Write failed" };
      }
    },
  };

  registerTool(search);
  registerTool(replace);
  registerTool(list);
  registerTool(read);
  registerTool(write);
  logger.info("[tools/files] Registered files.search, files.replace, files.list, files.read, files.write");
}