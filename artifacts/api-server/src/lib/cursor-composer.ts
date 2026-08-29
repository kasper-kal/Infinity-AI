/**
 * Cursor Composer — Multi-File Editor
 *
 * Natural language → multi-file diff generation with preview/apply workflow.
 * Like Cursor's Composer: describe what you want, get a preview of all changes,
 * then apply selectively or all at once.
 *
 * Features:
 * - Multi-file diff generation from natural language
 * - Side-by-side diff preview before apply
 * - Selective or bulk apply
 * - Iterative refinement ("also update tests", "fix types")
 * - Context-aware: reads related files automatically
 * - Supports new file creation + edits + deletions
 * - Dependency tracking between files
 */

import { LLMAdapter, LLMMessage, LLMCompletionOptions, LLMCompletionResult, LLMToolCall } from "./llm-adapter";
import { CodebaseIndexer, SearchResult, createCodebaseIndexer, IndexConfig } from "./codebase-indexer";
import { createBestAdapter } from "./adapter-factory";
import { SUBAGENTS, spawnSubagent, type SubagentDefinition } from "./subagents";
import { executeTool, getToolDefinitionsForLLM, type ToolDiscoveryFilter } from "./tool-registry";
import { ToolExecutionContext } from "./tool-types";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

// ============================================================================
// Types
// ============================================================================

export interface ComposerConfig {
  projectId: string;
  projectRoot: string;
  adapter: LLMAdapter;
  maxFilesPerRun?: number;
  maxTokens?: number;
  temperature?: number;
  onProgress?: (progress: ComposerProgress) => void;
}

export interface ComposerProgress {
  stage: "analyzing" | "planning" | "generating" | "validating" | "complete" | "error";
  message: string;
  filesAnalyzed?: number;
  filesPlanned?: number;
  filesGenerated?: number;
  currentFile?: string;
  error?: string;
}

export interface ComposerRequest {
  instruction: string;
  contextFiles?: string[]; // Files user explicitly referenced
  mode?: "edit" | "create" | "refactor" | "fix" | "test" | "document";
  targetFiles?: string[]; // Specific files to modify (optional)
  includeTests?: boolean;
  includeTypes?: boolean;
}

export interface FileChange {
  path: string;
  originalContent: string;
  newContent: string;
  changeType: "create" | "edit" | "delete";
  language: string;
  diff: string; // Unified diff
  description: string;
  dependencies: string[]; // Other files this change depends on
  confidence: number; // 0-1
}

export interface ComposerPlan {
  id: string;
  instruction: string;
  mode: ComposerRequest["mode"];
  changes: FileChange[];
  estimatedTokens: number;
  riskLevel: "low" | "medium" | "high";
  warnings: string[];
  requiredApprovals: string[]; // File paths requiring approval
}

export interface ComposerResult {
  plan: ComposerPlan;
  appliedChanges: FileChange[];
  failedChanges: Array<{ change: FileChange; error: string }>;
  summary: string;
  tokensUsed: number;
  durationMs: number;
}

export interface DiffPreview {
  filePath: string;
  originalContent: string;
  newContent: string;
  diff: string;
  changeType: "create" | "edit" | "delete";
}

// ============================================================================
// Composer Class
// ============================================================================

export class CursorComposer {
  private config: Required<ComposerConfig>;
  private indexer: CodebaseIndexer | null = null;
  private adapter: LLMAdapter;

  constructor(config: ComposerConfig) {
    this.adapter = config.adapter;
    this.config = {
      projectId: config.projectId,
      projectRoot: config.projectRoot,
      adapter: config.adapter,
      maxFilesPerRun: config.maxFilesPerRun ?? 20,
      maxTokens: config.maxTokens ?? 8192,
      temperature: config.temperature ?? 0.1,
      onProgress: config.onProgress ?? (() => {}),
    };
  }

  async initialize(): Promise<void> {
    const indexConfig: IndexConfig = {
      projectId: this.config.projectId,
      projectRoot: this.config.projectRoot,
      excludePatterns: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/*.lock"],
      includePatterns: ["**/*.{ts,tsx,js,jsx,py,rs,go,java,cpp,c,h,cs,rb,php,swift,kt,json,md,css,scss,html}"],
      maxFileSize: 1024 * 1024,
      chunkSize: 500,
      overlap: 50,
      embeddingModel: "Xenova/all-MiniLM-L6-v2",
      enableIncremental: true,
      useRemoteEmbeddings: false,
    };
    this.indexer = createCodebaseIndexer(this.config.projectId, this.config.projectRoot, indexConfig);
    await this.indexer.initialize();
  }

  /**
   * Generate a plan (diff preview) from natural language instruction
   */
  async generatePlan(request: ComposerRequest): Promise<ComposerPlan> {
    this.emitProgress({ stage: "analyzing", message: "Analyzing codebase context..." });

    // 1. Gather context from codebase
    const context = await this.gatherContext(request);

    this.emitProgress({ stage: "planning", message: "Planning changes...", filesAnalyzed: context.relevantFiles.length });

    // 2. Generate plan using LLM
    const plan = await this.createPlan(request, context);

    this.emitProgress({ stage: "validating", message: "Validating plan...", filesPlanned: plan.changes.length });

    // 3. Validate each change
    const validatedChanges = await this.validateChanges(plan.changes);

    return {
      ...plan,
      changes: validatedChanges,
    };
  }

  /**
   * Apply a plan (with optional selective file application)
   */
  async applyPlan(plan: ComposerPlan, options?: { filePaths?: string[]; dryRun?: boolean }): Promise<ComposerResult> {
    const startTime = Date.now();
    let tokensUsed = 0;
    const appliedChanges: FileChange[] = [];
    const failedChanges: Array<{ change: FileChange; error: string }> = [];

    const changesToApply = options?.filePaths
      ? plan.changes.filter(c => options.filePaths!.includes(c.path))
      : plan.changes;

    this.emitProgress({ stage: "generating", message: `Applying ${changesToApply.length} changes...`, filesGenerated: 0 });

    for (let i = 0; i < changesToApply.length; i++) {
      const change = changesToApply[i];
      this.emitProgress({
        stage: "generating",
        message: `Applying ${change.path}...`,
        filesGenerated: i,
        currentFile: change.path,
      });

      try {
        if (!options?.dryRun) {
          await this.applyChange(change);
        }
        appliedChanges.push(change);
      } catch (error) {
        failedChanges.push({ change, error: String(error) });
      }
    }

    const durationMs = Date.now() - startTime;

    this.emitProgress({ stage: "complete", message: `Applied ${appliedChanges.length} changes`, filesGenerated: appliedChanges.length });

    return {
      plan,
      appliedChanges,
      failedChanges,
      summary: this.generateSummary(appliedChanges, failedChanges),
      tokensUsed,
      durationMs,
    };
  }

  /**
   * Generate diff previews for all changes in a plan
   */
  generatePreviews(plan: ComposerPlan): DiffPreview[] {
    return plan.changes.map(change => ({
      filePath: change.path,
      originalContent: change.originalContent,
      newContent: change.newContent,
      diff: change.diff,
      changeType: change.changeType,
    }));
  }

  /**
   * Refine an existing plan with additional instructions
   */
  async refinePlan(plan: ComposerPlan, refinement: string): Promise<ComposerPlan> {
    this.emitProgress({ stage: "planning", message: "Refining plan..." });

    const refinementPrompt = `Original instruction: ${plan.instruction}
Current plan has ${plan.changes.length} changes.

Refinement request: ${refinement}

Update the plan accordingly. Return the full updated plan as JSON.`;

    const response = await this.adapter.complete([
      { role: "system", content: this.getPlanningSystemPrompt() },
      { role: "user", content: refinementPrompt },
    ], {
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    });

    try {
      const jsonMatch = response.text?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const refined = JSON.parse(jsonMatch[0]);
        return {
          ...plan,
          id: `plan-${Date.now()}`,
          changes: refined.changes || plan.changes,
          warnings: [...plan.warnings, `Refined: ${refinement}`],
        };
      }
    } catch (e) {
      console.error("Failed to parse refined plan:", e);
    }

    return plan;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async gatherContext(request: ComposerRequest): Promise<{
    relevantFiles: SearchResult[];
    contextFiles: Map<string, string>;
    projectStructure: string;
  }> {
    const contextFiles = new Map<string, string>();

    // Read explicitly referenced files
    if (request.contextFiles) {
      for (const file of request.contextFiles) {
        const fullPath = join(this.config.projectRoot, file);
        if (existsSync(fullPath)) {
          contextFiles.set(file, readFileSync(fullPath, "utf-8"));
        }
      }
    }

    // Search for relevant files if no explicit context
    let relevantFiles: SearchResult[] = [];
    if (this.indexer && (!request.contextFiles || request.contextFiles.length === 0)) {
      relevantFiles = await this.indexer.search({
        projectId: this.config.projectId,
        query: request.instruction,
        limit: 30,
        hybrid: true,
        expandQuery: true,
      });

      // Read top relevant files
      for (const result of relevantFiles.slice(0, 15)) {
        if (!contextFiles.has(result.chunk.relativePath)) {
          const fullPath = join(this.config.projectRoot, result.chunk.relativePath);
          if (existsSync(fullPath)) {
            contextFiles.set(result.chunk.relativePath, readFileSync(fullPath, "utf-8"));
          }
        }
      }
    }

    // Get project structure
    const projectStructure = this.getProjectStructure();

    return { relevantFiles, contextFiles, projectStructure };
  }

  private getProjectStructure(): string {
    // Simple directory listing
    const { execSync } = require("child_process");
    try {
      const output = execSync("find . -type f -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.py' -o -name '*.rs' -o -name '*.go' | head -100", {
        cwd: this.config.projectRoot,
        encoding: "utf-8",
      });
      return output.trim();
    } catch {
      return "Unable to list project structure";
    }
  }

  private async createPlan(request: ComposerRequest, context: {
    relevantFiles: SearchResult[];
    contextFiles: Map<string, string>;
    projectStructure: string;
  }): Promise<ComposerPlan> {
    // Build context string for LLM
    const contextStr = Array.from(context.contextFiles.entries())
      .map(([path, content]) => `=== ${path} ===\n${content.slice(0, 3000)}`)
      .join("\n\n");

    const relevantStr = context.relevantFiles
      .slice(0, 10)
      .map(r => `${r.chunk.relativePath}:${r.chunk.startLine}-${r.chunk.endLine} (${r.chunk.chunkType}: ${r.chunk.name})`)
      .join("\n");

    const modeGuidance = this.getModeGuidance(request.mode || "edit");

    const prompt = `You are Cursor Composer, an expert multi-file code editor.

TASK: ${request.instruction}
MODE: ${request.mode || "edit"}
${modeGuidance}

PROJECT STRUCTURE:
${context.projectStructure}

RELEVANT CODE LOCATIONS:
${relevantStr || "None found"}

EXPLICIT CONTEXT FILES:
${contextStr || "None provided"}

Generate a comprehensive plan with file changes. Each change must include:
- path: relative path from project root
- originalContent: current file content (empty for new files)
- newContent: complete new file content
- changeType: "create" | "edit" | "delete"
- language: file language
- diff: unified diff format
- description: what this change does
- dependencies: other file paths this depends on
- confidence: 0-1

Consider:
1. Read existing files before editing
2. Maintain consistency with existing code style
3. Update related files (types, tests, exports)
4. Follow project conventions
5. Handle imports/exports correctly

OUTPUT FORMAT (JSON):
{
  "id": "plan-xxx",
  "instruction": "...",
  "mode": "...",
  "changes": [...],
  "estimatedTokens": 5000,
  "riskLevel": "low|medium|high",
  "warnings": [],
  "requiredApprovals": []
}`;

    const response = await this.adapter.complete([
      { role: "system", content: this.getComposerSystemPrompt() },
      { role: "user", content: prompt },
    ], {
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    });

    try {
      const jsonMatch = response.text?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          id: parsed.id || `plan-${Date.now()}`,
          instruction: request.instruction,
          mode: request.mode || "edit",
          changes: parsed.changes || [],
          estimatedTokens: parsed.estimatedTokens || 5000,
          riskLevel: parsed.riskLevel || "medium",
          warnings: parsed.warnings || [],
          requiredApprovals: parsed.requiredApprovals || [],
        };
      }
    } catch (e) {
      console.error("Failed to parse composer plan:", e);
    }

    // Fallback: create minimal plan
    return {
      id: `plan-${Date.now()}`,
      instruction: request.instruction,
      mode: request.mode || "edit",
      changes: [],
      estimatedTokens: 0,
      riskLevel: "low",
      warnings: ["Failed to generate plan - manual intervention needed"],
      requiredApprovals: [],
    };
  }

  private getComposerSystemPrompt(): string {
    return `You are Cursor Composer, generating multi-file diffs from natural language.

EXPERTISE:
- Full-stack development (TypeScript, React, Node.js, Python, Go, Rust, etc.)
- Modern patterns: hooks, context, suspense, server components
- Testing: Vitest, Jest, Playwright, unit/integration/e2e
- Type safety: strict TypeScript, generics, inference
- Architecture: clean code, SOLID, domain-driven design

OUTPUT RULES:
1. ALWAYS output valid JSON matching the exact schema
2. Provide COMPLETE file contents for newContent (not partial)
3. Generate ACCURATE unified diffs
4. Include ALL necessary changes (imports, exports, types, tests)
4. Confidence scores: 0.9+ for straightforward, 0.7-0.9 for complex, <0.7 for uncertain
5. Mark risky changes (deletions, major refactors) in requiredApprovals
6. Track dependencies between file changes`;
  }

  private getPlanningSystemPrompt(): string {
    return `You are a senior software architect creating precise multi-file edit plans.`;
  }

  private getModeGuidance(mode: ComposerRequest["mode"]): string {
    switch (mode) {
      case "create":
        return "Create new files with proper structure, exports, and tests.";
      case "edit":
        return "Modify existing files. Read them first to understand current implementation.";
      case "refactor":
        return "Restructure code without changing behavior. Extract, rename, reorganize.";
      case "fix":
        return "Fix a bug. Identify root cause, make minimal targeted fix, add test.";
      case "test":
        return "Add tests for existing code. Cover happy path, edge cases, errors.";
      case "document":
        return "Add documentation: JSDoc, README, comments, type docs.";
      default:
        return "Make appropriate changes for the task.";
    }
  }

  private async validateChanges(changes: FileChange[]): Promise<FileChange[]> {
    const validated: FileChange[] = [];

    for (const change of changes) {
      try {
        // Verify original content matches current file (for edits)
        if (change.changeType === "edit") {
          const fullPath = join(this.config.projectRoot, change.path);
          if (existsSync(fullPath)) {
            const currentContent = readFileSync(fullPath, "utf-8");
            if (currentContent !== change.originalContent) {
              // Content has drifted - re-read and regenerate diff
              change.originalContent = currentContent;
              change.diff = this.generateDiff(change.path, change.originalContent, change.newContent);
              change.confidence = Math.max(0.5, change.confidence - 0.2);
              this.emitProgress({ stage: "validating", message: `Content drift detected in ${change.path}, regenerated diff` });
            }
          }
        }

        // Validate diff applies cleanly
        if (change.changeType !== "delete") {
          const testResult = this.applyDiffInMemory(change.originalContent, change.diff);
          if (!testResult.success) {
            change.confidence = Math.max(0.3, change.confidence - 0.3);
            this.emitProgress({ stage: "validating", message: `Diff validation failed for ${change.path}: ${testResult.error}` });
          }
        }

        validated.push(change);
      } catch (error) {
        console.error(`Validation error for ${change.path}:`, error);
        change.confidence = 0.1;
        validated.push(change);
      }
    }

    return validated;
  }

  private async applyChange(change: FileChange): Promise<void> {
    const fullPath = join(this.config.projectRoot, change.path);

    switch (change.changeType) {
      case "create":
        mkdirSync(require("path").dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, change.newContent, "utf-8");
        break;
      case "edit":
        if (!existsSync(fullPath)) throw new Error(`File not found: ${change.path}`);
        writeFileSync(fullPath, change.newContent, "utf-8");
        break;
      case "delete":
        if (existsSync(fullPath)) {
          require("fs").unlinkSync(fullPath);
        }
        break;
    }
  }

  private generateDiff(filePath: string, original: string, updated: string): string {
    // Simple unified diff generation
    const originalLines = original.split("\n");
    const updatedLines = updated.split("\n");
    const diff = this.computeUnifiedDiff(originalLines, updatedLines, filePath);
    return diff;
  }

  private computeUnifiedDiff(original: string[], updated: string[], filePath: string): string {
    // Simple LCS-based diff (in production, use a proper diff library)
    const diffLines: string[] = [];
    diffLines.push(`--- a/${filePath}`);
    diffLines.push(`+++ b/${filePath}`);

    // Very basic diff - in production use 'diff' npm package
    let i = 0, j = 0;
    while (i < original.length || j < updated.length) {
      if (i < original.length && j < updated.length && original[i] === updated[j]) {
        diffLines.push(` ${original[i]}`);
        i++; j++;
      } else if (j < updated.length && (i >= original.length || original[i] !== updated[j])) {
        diffLines.push(`+${updated[j]}`);
        j++;
      } else if (i < original.length) {
        diffLines.push(`-${original[i]}`);
        i++;
      }
    }

    return diffLines.join("\n");
  }

  private applyDiffInMemory(original: string, diff: string): { success: boolean; error?: string } {
    // Simplified validation - in production, use a proper patch library
    try {
      // Just verify it's a valid-looking diff
      if (!diff.includes("---") || !diff.includes("+++")) {
        return { success: false, error: "Invalid diff format" };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  private generateSummary(applied: FileChange[], failed: Array<{ change: FileChange; error: string }>): string {
    let summary = `Applied ${applied.length} change(s)`;
    if (failed.length > 0) {
      summary += `, ${failed.length} failed`;
    }
    const byType = applied.reduce((acc, c) => {
      acc[c.changeType] = (acc[c.changeType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    summary += ` (${Object.entries(byType).map(([k, v]) => `${v} ${k}`).join(", ")})`;
    return summary;
  }

  private emitProgress(progress: ComposerProgress): void {
    this.config.onProgress(progress);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createCursorComposer(config: ComposerConfig): CursorComposer {
  return new CursorComposer(config);
}