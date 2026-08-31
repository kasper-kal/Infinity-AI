/**
 * AGENT REVIEW ENGINE — Automated PR Reviews with Code Understanding
 *
 * Runs agents to review pull requests across multiple dimensions:
 * - Correctness
 * - Security
 * - Performance
 * - Style
 * - Tests
 * - Breaking changes
 *
 * Integrates with codebase indexer for context-aware reviews.
 */

import { EventEmitter } from "events";
import type { LLMAdapter } from "./llm-adapter";
import { createBestAdapter } from "./adapter-factory";
import { runUniversalAgent, type AgentLoopResult, type UniversalAgentConfig } from "./universal-agent";
import { spawnSubagent, type CodeReviewerOutput, type SubagentConfig } from "./subagents";
import { perspectiveDiverseVerify, type VerificationLens } from "./orchestration-engine";
import type { ToolExecutionContext } from "./tool-types";
import { codebaseIndexer, type CodebaseSearchResult } from "./codebase-indexer";

/**
 * Review trigger types
 */
export type ReviewTrigger = "pr_created" | "push" | "manual" | "scheduled";

/**
 * Review dimensions
 */
export type ReviewDimension =
  | "correctness"
  | "security"
  | "performance"
  | "style"
  | "tests"
  | "breaking-changes"
  | "accessibility"
  | "documentation";

/**
 * Review severity levels
 */
export type ReviewSeverity = "critical" | "high" | "medium" | "low" | "info";

/**
 * Individual review comment
 */
export interface ReviewComment {
  id: string;
  dimension: ReviewDimension;
  severity: ReviewSeverity;
  file: string;
  line: number | null; // null = file-level comment
  endLine: number | null; // for range comments
  message: string;
  suggestion: string | null; // code suggestion if applicable
  confidence: number; // 0-1
  ruleId: string | null; // reference to rule that triggered this
}

/**
 * Review summary
 */
export interface ReviewSummary {
  totalComments: number;
  bySeverity: Record<ReviewSeverity, number>;
  byDimension: Record<ReviewDimension, number>;
  approved: boolean; // overall approve/request-changes
  blockMerge: boolean; // true if critical/high findings that must be fixed
  overallScore: number; // 0-100
  keyFindings: string[]; // top 3-5 most important findings
}

/**
 * Configuration for agent review
 */
export interface AgentReviewConfig {
  /** Repository identifier */
  repoId: string;
  /** PR number or branch name */
  prRef: string;
  /** Base branch for comparison */
  baseBranch: string;
  /** Head branch/commit */
  headBranch: string;
  /** Review dimensions to run (default: all) */
  dimensions?: ReviewDimension[];
  /** Custom rules per dimension */
  rules?: Record<ReviewDimension, ReviewRule[]>;
  /** Ignore patterns (files/directories) */
  ignorePatterns?: string[];
  /** Minimum severity to report */
  minSeverity?: ReviewSeverity;
  /** Max comments per dimension */
  maxCommentsPerDimension?: number;
  /** Enable learning (track false positives) */
  learningEnabled?: boolean;
  /** Review trigger */
  trigger: ReviewTrigger;
  /** LLM adapter */
  llm?: LLMAdapter;
  /** Tool execution context */
  context: ToolExecutionContext;
  /** Callback on progress */
  onProgress?: (event: ReviewProgressEvent) => void;
}

/**
 * Review rule configuration
 */
export interface ReviewRule {
  id: string;
  name: string;
  description: string;
  dimension: ReviewDimension;
  severity: ReviewSeverity;
  pattern?: string; // regex pattern to match
  prompt: string; // custom prompt for this rule
  enabled: boolean;
}

/**
 * Progress event during review
 */
export interface ReviewProgressEvent {
  stage: "fetching-diff" | "indexing" | "analyzing" | "reviewing" | "synthesizing" | "complete" | "error";
  dimension: ReviewDimension | null;
  message: string;
  progress: number; // 0-100
  data?: unknown;
  timestamp: number;
}

/**
 * Complete review result
 */
export interface AgentReviewResult {
  reviewId: string;
  repoId: string;
  prRef: string;
  trigger: ReviewTrigger;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  comments: ReviewComment[];
  summary: ReviewSummary;
  diff: string;
  filesChanged: string[];
  agentResult: AgentLoopResult | null;
  error: string | null;
}

/**
 * Review learning data (for improving over time)
 */
export interface ReviewLearningData {
  reviewId: string;
  commentId: string;
  wasFalsePositive: boolean;
  userFeedback: "confirm" | "dismiss" | "fix-applied";
  timestamp: number;
}

/**
 * Default review rules
 */
export const DEFAULT_REVIEW_RULES: ReviewRule[] = [
  // Correctness rules
  {
    id: "correctness-null-check",
    name: "Missing Null Checks",
    description: "Check for potential null/undefined access",
    dimension: "correctness",
    severity: "high",
    prompt: "Look for code that accesses properties or methods on potentially null/undefined values without proper checks.",
    enabled: true,
  },
  {
    id: "correctness-type-safety",
    name: "Type Safety Issues",
    description: "Check for TypeScript any, unsafe casts, missing types",
    dimension: "correctness",
    severity: "medium",
    prompt: "Identify use of 'any' type, unsafe type assertions, missing type annotations, or type mismatches.",
    enabled: true,
  },
  {
    id: "correctness-logic-errors",
    name: "Logic Errors",
    description: "Check for incorrect conditions, off-by-one, wrong operators",
    dimension: "correctness",
    severity: "high",
    prompt: "Look for logical errors: incorrect comparison operators, off-by-one errors, wrong boolean logic, incorrect loop bounds.",
    enabled: true,
  },
  {
    id: "correctness-edge-cases",
    name: "Missing Edge Case Handling",
    description: "Check for unhandled edge cases",
    dimension: "correctness",
    severity: "medium",
    prompt: "Identify missing handling for empty arrays, zero values, network failures, timeouts, race conditions.",
    enabled: true,
  },

  // Security rules
  {
    id: "security-secrets",
    name: "Secrets Exposure",
    description: "Detect hardcoded secrets, API keys, passwords",
    dimension: "security",
    severity: "critical",
    prompt: "Scan for hardcoded secrets: API keys, passwords, tokens, private keys, connection strings. Check for secrets in code, comments, config files.",
    enabled: true,
  },
  {
    id: "security-sql-injection",
    name: "SQL Injection Risk",
    description: "Check for raw SQL with user input",
    dimension: "security",
    severity: "critical",
    prompt: "Look for string concatenation in SQL queries, raw SQL with user input, missing parameterized queries.",
    enabled: true,
  },
  {
    id: "security-xss",
    name: "XSS Vulnerabilities",
    description: "Check for unsafe HTML/JS rendering",
    dimension: "security",
    severity: "high",
    prompt: "Identify unsafe innerHTML, dangerouslySetInnerHTML, eval(), unescaped user input in HTML output.",
    enabled: true,
  },
  {
    id: "security-auth-bypass",
    name: "Auth Bypass Risks",
    description: "Check for missing auth checks, weak permissions",
    dimension: "security",
    severity: "critical",
    prompt: "Look for missing authentication/authorization checks, weak permission logic, exposed admin endpoints.",
    enabled: true,
  },
  {
    id: "security-crypto",
    name: "Weak Cryptography",
    description: "Check for weak hashing, encryption, random",
    dimension: "security",
    severity: "high",
    prompt: "Identify use of MD5, SHA1, DES, ECB mode, Math.random() for crypto, hardcoded IVs/salts.",
    enabled: true,
  },

  // Performance rules
  {
    id: "perf-n-plus-one",
    name: "N+1 Query Problem",
    description: "Detect database queries in loops",
    dimension: "performance",
    severity: "high",
    prompt: "Look for database queries inside loops, missing eager loading, repeated fetches of same data.",
    enabled: true,
  },
  {
    id: "perf-memory-leaks",
    name: "Memory Leaks",
    description: "Check for event listeners, subscriptions not cleaned up",
    dimension: "performance",
    severity: "high",
    prompt: "Identify missing cleanup: event listeners, subscriptions, intervals, timeouts, WebSocket connections.",
    enabled: true,
  },
  {
    id: "perf-unnecessary-renders",
    name: "Unnecessary Re-renders",
    description: "Check React/Vue/Svelte for missing memoization",
    dimension: "performance",
    severity: "medium",
    prompt: "Look for missing React.memo, useMemo, useCallback, Vue computed, Svelte $: optimizations in hot paths.",
    enabled: true,
  },
  {
    id: "perf-bundle-size",
    name: "Bundle Size Impact",
    description: "Check for heavy imports, missing tree-shaking",
    dimension: "performance",
    severity: "low",
    prompt: "Identify large dependency imports, missing dynamic imports for heavy components, missing tree-shaking.",
    enabled: true,
  },

  // Style rules
  {
    id: "style-naming",
    name: "Naming Conventions",
    description: "Check for consistent naming",
    dimension: "style",
    severity: "low",
    prompt: "Verify consistent naming: camelCase for variables/functions, PascalCase for components/types, UPPER_SNAKE for constants.",
    enabled: true,
  },
  {
    id: "style-formatting",
    name: "Code Formatting",
    description: "Check for formatting inconsistencies",
    dimension: "style",
    severity: "low",
    prompt: "Look for inconsistent indentation, line length, trailing whitespace, missing semicolons, quote style.",
    enabled: true,
  },
  {
    id: "style-dead-code",
    name: "Dead Code",
    description: "Identify unused imports, variables, functions",
    dimension: "style",
    severity: "low",
    prompt: "Find unused imports, variables, functions, types, exports. Dead code that can be removed.",
    enabled: true,
  },

  // Tests rules
  {
    id: "tests-missing",
    name: "Missing Tests",
    description: "Check for untested new/changed code",
    dimension: "tests",
    severity: "medium",
    prompt: "Identify new functions, components, API endpoints, or logic changes without corresponding tests.",
    enabled: true,
  },
  {
    id: "tests-flaky",
    name: "Flaky Test Patterns",
    description: "Check for async timing issues, shared state",
    dimension: "tests",
    severity: "medium",
    prompt: "Look for tests with sleep/wait, shared mutable state, random data without seeds, time-dependent assertions.",
    enabled: true,
  },
  {
    id: "tests-coverage",
    name: "Coverage Gaps",
    description: "Check for untested branches, error paths",
    dimension: "tests",
    severity: "low",
    prompt: "Identify missing test coverage for error handling, edge cases, boundary conditions, failure paths.",
    enabled: true,
  },

  // Breaking changes rules
  {
    id: "breaking-api",
    name: "Public API Changes",
    description: "Detect breaking changes to exported APIs",
    dimension: "breaking-changes",
    severity: "critical",
    prompt: "Look for removed/renamed exports, changed function signatures, removed types, modified public interfaces.",
    enabled: true,
  },
  {
    id: "breaking-config",
    name: "Config Schema Changes",
    description: "Check for breaking config changes",
    dimension: "breaking-changes",
    severity: "high",
    prompt: "Identify removed/renamed config keys, changed default values, new required config without defaults.",
    enabled: true,
  },
  {
    id: "breaking-db",
    name: "Database Migration Issues",
    description: "Check for unsafe DB migrations",
    dimension: "breaking-changes",
    severity: "critical",
    prompt: "Look for DROP COLUMN, ALTER COLUMN TYPE without migration, missing NOT NULL with default, index locks.",
    enabled: true,
  },

  // Accessibility rules
  {
    id: "a11y-semantic",
    name: "Semantic HTML",
    description: "Check for proper semantic elements",
    dimension: "accessibility",
    severity: "medium",
    prompt: "Verify proper heading hierarchy, landmark roles, semantic elements (nav, main, article), button vs link usage.",
    enabled: true,
  },
  {
    id: "a11y-contrast",
    name: "Color Contrast",
    description: "Check for sufficient color contrast",
    dimension: "accessibility",
    severity: "medium",
    prompt: "Identify potential contrast issues: low contrast text, missing focus indicators, color-only information.",
    enabled: true,
  },

  // Documentation rules
  {
    id: "docs-missing",
    name: "Missing Documentation",
    description: "Check for undocumented public APIs",
    dimension: "documentation",
    severity: "low",
    prompt: "Identify exported functions, components, types, APIs without JSDoc/TSDoc comments or README updates.",
    enabled: true,
  },
];

/**
 * Agent Review Engine
 */
export class AgentReviewEngine extends EventEmitter {
  private config: AgentReviewConfig;
  private rules: ReviewRule[];
  private learningData: ReviewLearningData[] = [];
  private debug: boolean;

  constructor(config: AgentReviewConfig) {
    super();
    this.config = config;
    this.rules = DEFAULT_REVIEW_RULES.filter(r => r.enabled);
    // Merge custom rules
    if (config.rules) {
      for (const [dimension, customRules] of Object.entries(config.rules)) {
        this.rules = this.rules.filter(r => r.dimension !== dimension);
        this.rules.push(...customRules.filter(r => r.enabled));
      }
    }
    this.debug = config.llm ? false : true; // debug if using default adapter
  }

  /**
   * Run a complete review
   */
  async runReview(): Promise<AgentReviewResult> {
    const reviewId = this.generateReviewId();
    const startedAt = Date.now();

    this.emit("review:started", { reviewId, config: this.config });

    try {
      // Stage 1: Fetch diff
      this.emitProgress("fetching-diff", null, "Fetching PR diff...", 5);
      const diff = await this.fetchDiff();
      const filesChanged = this.extractFilesFromDiff(diff);

      this.emitProgress("indexing", null, "Indexing changed files...", 10);

      // Stage 2: Get relevant codebase context
      const context = await this.getCodebaseContext(filesChanged);

      // Stage 3: Run review per dimension
      const allComments: ReviewComment[] = [];
      const dimensions = this.config.dimensions || this.getUniqueDimensions();

      for (let i = 0; i < dimensions.length; i++) {
        const dimension = dimensions[i];
        this.emitProgress(
          "reviewing",
          dimension,
          `Reviewing ${dimension}...`,
          20 + (i / dimensions.length) * 60
        );

        const comments = await this.reviewDimension(dimension, diff, context, filesChanged);
        allComments.push(...comments);
      }

      // Stage 4: Synthesize
      this.emitProgress("synthesizing", null, "Synthesizing review...", 85);
      const summary = this.synthesizeReview(allComments);

      const completedAt = Date.now();

      const result: AgentReviewResult = {
        reviewId,
        repoId: this.config.repoId,
        prRef: this.config.prRef,
        trigger: this.config.trigger,
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        comments: allComments,
        summary,
        diff,
        filesChanged,
        agentResult: null, // would be set if using universal agent
        error: null,
      };

      this.emit("review:completed", result);
      this.log(`Review ${reviewId} completed in ${result.durationMs}ms: ${summary.totalComments} comments`);

      return result;
    } catch (err) {
      const error = err as Error;
      const completedAt = Date.now();

      const result: AgentReviewResult = {
        reviewId,
        repoId: this.config.repoId,
        prRef: this.config.prRef,
        trigger: this.config.trigger,
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        comments: [],
        summary: this.emptySummary(),
        diff: "",
        filesChanged: [],
        agentResult: null,
        error: error.message,
      };

      this.emit("review:failed", { reviewId, error });
      this.log(`Review ${reviewId} failed: ${error.message}`);

      return result;
    }
  }

  /**
   * Fetch PR diff from git
   */
  private async fetchDiff(): Promise<string> {
    // In production, this would call GitHub/GitLab/Bitbucket API
    // For now, return mock diff - actual implementation in API route
    return `diff --git a/src/example.ts b/src/example.ts
index 1234567..abcdefg 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,5 +1,6 @@
 export function example() {
+  const x = null;
   console.log(x.length); // Potential null access
   return "hello";
 }
`;
  }

  /**
   * Extract file paths from diff
   */
  private extractFilesFromDiff(diff: string): string[] {
    const files: string[] = [];
    const filePattern = /^diff --git a\/(.+?) b\//gm;
    let match;
    while ((match = filePattern.exec(diff)) !== null) {
      files.push(match[1]);
    }
    return [...new Set(files)];
  }

  /**
   * Get codebase context for changed files using indexer
   */
  private async getCodebaseContext(filesChanged: string[]): Promise<string> {
    const contexts: string[] = [];

    for (const file of filesChanged) {
      try {
        // Search for related symbols in the codebase
        const results = await codebaseIndexer.search({
          query: `file:${file}`,
          limit: 10,
          hybrid: true,
        });

        if (results.length > 0) {
          contexts.push(`=== ${file} ===`);
          for (const result of results.slice(0, 5)) {
            contexts.push(`${result.file}:${result.line} - ${result.symbol || "code"}`);
            contexts.push(result.snippet);
            contexts.push("");
          }
        }
      } catch (err) {
        this.log(`Failed to get context for ${file}:`, err);
      }
    }

    return contexts.join("\n");
  }

  /**
   * Review a specific dimension
   */
  private async reviewDimension(
    dimension: ReviewDimension,
    diff: string,
    context: string,
    filesChanged: string[]
  ): Promise<ReviewComment[]> {
    const dimensionRules = this.rules.filter(r => r.dimension === dimension);
    if (dimensionRules.length === 0) return [];

    const comments: ReviewComment[] = [];

    // Use perspective-diverse verification for deeper analysis
    const llm = this.config.llm || await createBestAdapter();

    // Build review prompt
    const prompt = this.buildReviewPrompt(dimension, diff, context, filesChanged, dimensionRules);

    // Run code-reviewer subagent
    try {
      const result = await spawnSubagent<CodeReviewerOutput>(
        "code-reviewer",
        prompt,
        llm,
        { temperature: 0.1, maxTokens: 6000 } as SubagentConfig
      );

      // Convert findings to review comments
      for (const finding of result.findings) {
        if (this.shouldIncludeFinding(finding)) {
          comments.push(this.findingToComment(finding, dimension));
        }
      }

      // Also run perspective-diverse verification for critical dimensions
      if (["security", "correctness", "breaking-changes"].includes(dimension)) {
        const perspectiveResults = await perspectiveDiverseVerify(
          `Code changes in PR ${this.config.prRef} are correct and secure`,
          `DIFF:\n${diff}\n\nCONTEXT:\n${context}`,
          llm,
          [dimension as VerificationLens, "security", "performance", "reproducibility"]
        );

        for (const [lens, lensResult] of Object.entries(perspectiveResults)) {
          if (lensResult) {
            for (const finding of lensResult.findings) {
              if (this.shouldIncludeFinding(finding)) {
                comments.push(this.findingToComment(finding, dimension, `perspective-${lens}`));
              }
            }
          }
        }
      }
    } catch (err) {
      this.log(`Review failed for dimension ${dimension}:`, err);
    }

    // Limit comments per dimension
    const maxComments = this.config.maxCommentsPerDimension || 20;
    return comments.slice(0, maxComments);
  }

  /**
   * Build review prompt for a dimension
   */
  private buildReviewPrompt(
    dimension: ReviewDimension,
    diff: string,
    context: string,
    filesChanged: string[],
    rules: ReviewRule[]
  ): string {
    const ruleDescriptions = rules.map(r => `- ${r.name}: ${r.description} (severity: ${r.severity})`).join("\n");

    return `You are reviewing a pull request for the "${dimension}" dimension.

PR: ${this.config.prRef}
Base: ${this.config.baseBranch}
Head: ${this.config.headBranch}
Files changed: ${filesChanged.join(", ")}

DIFF:
${diff}

CODEBASE CONTEXT:
${context || "No additional context available."}

REVIEW RULES FOR ${dimension.toUpperCase()}:
${ruleDescriptions}

INSTRUCTIONS:
1. Analyze the diff for issues related to ${dimension}
2. Consider the codebase context for related patterns
3. Apply the rules above
4. Output findings with: file, line, severity, confidence, specific suggestion
5. Be thorough but concise - max 500 chars per description

Focus on: ${dimension} issues that could cause bugs, security issues, performance problems, or maintenance burden.`;
  }

  /**
   * Check if finding should be included based on severity threshold
   */
  private shouldIncludeFinding(finding: CodeReviewerOutput["findings"][0]): boolean {
    const minSeverity = this.config.minSeverity || "info";
    const severityOrder: ReviewSeverity[] = ["info", "low", "medium", "high", "critical"];
    const minIndex = severityOrder.indexOf(minSeverity);
    const findingIndex = severityOrder.indexOf(finding.severity);
    return findingIndex >= minIndex;
  }

  /**
   * Convert code reviewer finding to review comment
   */
  private findingToComment(
    finding: CodeReviewerOutput["findings"][0],
    dimension: ReviewDimension,
    ruleId?: string
  ): ReviewComment {
    return {
      id: `comment_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      dimension,
      severity: finding.severity,
      file: finding.file || "unknown",
      line: finding.line || null,
      endLine: null,
      message: finding.description,
      suggestion: finding.suggestion || null,
      confidence: finding.confidence,
      ruleId: ruleId || finding.id,
    };
  }

  /**
   * Synthesize overall review summary
   */
  private synthesizeReview(comments: ReviewComment[]): ReviewSummary {
    const bySeverity: Record<ReviewSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };

    const byDimension: Record<ReviewDimension, number> = {
      correctness: 0,
      security: 0,
      performance: 0,
      style: 0,
      tests: 0,
      "breaking-changes": 0,
      accessibility: 0,
      documentation: 0,
    };

    for (const comment of comments) {
      bySeverity[comment.severity]++;
      byDimension[comment.dimension]++;
    }

    // Calculate overall score (100 - penalties)
    let score = 100;
    score -= bySeverity.critical * 20;
    score -= bySeverity.high * 10;
    score -= bySeverity.medium * 5;
    score -= bySeverity.low * 2;
    score -= bySeverity.info * 1;
    score = Math.max(0, Math.min(100, score));

    // Determine overall verdict
    const blockMerge = bySeverity.critical > 0 || bySeverity.high > 0;
    const approved = !blockMerge && score >= 70;

    // Key findings (top by severity)
    const sortedComments = [...comments].sort((a, b) => {
      const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return sevOrder[a.severity] - sevOrder[b.severity];
    });

    const keyFindings = sortedComments.slice(0, 5).map(c =>
      `[${c.severity.toUpperCase()}] ${c.file}${c.line ? `:${c.line}` : ""} - ${c.message}`
    );

    return {
      totalComments: comments.length,
      bySeverity,
      byDimension,
      approved,
      blockMerge,
      overallScore: score,
      keyFindings,
    };
  }

  /**
   * Empty summary for error cases
   */
  private emptySummary(): ReviewSummary {
    return {
      totalComments: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      byDimension: {
        correctness: 0,
        security: 0,
        performance: 0,
        style: 0,
        tests: 0,
        "breaking-changes": 0,
        accessibility: 0,
        documentation: 0,
      },
      approved: false,
      blockMerge: true,
      overallScore: 0,
      keyFindings: [],
    };
  }

  /**
   * Get unique dimensions from rules
   */
  private getUniqueDimensions(): ReviewDimension[] {
    const dims = new Set<ReviewDimension>();
    for (const rule of this.rules) {
      dims.add(rule.dimension);
    }
    return Array.from(dims);
  }

  /**
   * Record learning feedback
   */
  recordFeedback(data: ReviewLearningData): void {
    this.learningData.push(data);
    this.emit("learning:recorded", data);
    this.log(`Learning recorded for comment ${data.commentId}: ${data.userFeedback}`);
  }

  /**
   * Get learning statistics
   */
  getLearningStats(): { total: number; falsePositiveRate: number; byDimension: Record<string, number> } {
    const total = this.learningData.length;
    const falsePositives = this.learningData.filter(d => d.wasFalsePositive).length;
    const byDimension: Record<string, number> = {};

    for (const data of this.learningData) {
      // Would need comment lookup for dimension
    }

    return {
      total,
      falsePositiveRate: total > 0 ? falsePositives / total : 0,
      byDimension,
    };
  }

  /**
   * Emit progress event
   */
  private emitProgress(
    stage: ReviewProgressEvent["stage"],
    dimension: ReviewProgressEvent["dimension"],
    message: string,
    progress: number
  ): void {
    const event: ReviewProgressEvent = {
      stage,
      dimension,
      message,
      progress,
      timestamp: Date.now(),
    };
    this.emit("progress", event);
    this.config.onProgress?.(event);
  }

  private generateReviewId(): string {
    return `rev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  private log(...args: unknown[]): void {
    if (this.debug) console.log("[AgentReview]", ...args);
  }
}

/**
 * Factory function to create and run a review
 */
export async function runAgentReview(config: AgentReviewConfig): Promise<AgentReviewResult> {
  const engine = new AgentReviewEngine(config);
  return engine.runReview();
}

/**
 * Quick review for a single dimension (for real-time feedback)
 */
export async function quickReview(
  diff: string,
  dimension: ReviewDimension,
  context: ToolExecutionContext,
  llm?: LLMAdapter
): Promise<ReviewComment[]> {
  const adapter = llm || await createBestAdapter();
  const prompt = `Quick review for ${dimension}:

DIFF:
${diff}

Focus only on ${dimension} issues. Be concise. Output as code-reviewer findings.`;

  try {
    const result = await spawnSubagent<CodeReviewerOutput>(
      "code-reviewer",
      prompt,
      adapter,
      { temperature: 0.1, maxTokens: 3000 } as SubagentConfig
    );

    return result.findings
      .filter(f => f.severity !== "info")
      .map(f => ({
        id: `quick_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        dimension,
        severity: f.severity,
        file: f.file || "unknown",
        line: f.line || null,
        endLine: null,
        message: f.description,
        suggestion: f.suggestion || null,
        confidence: f.confidence,
        ruleId: f.id,
      }));
  } catch {
    return [];
  }
}

export default AgentReviewEngine;