/**
 * SPECIALIZED SUBAGENTS — Structured Output Agents for Orchestration
 *
 * Each subagent has a Zod schema for validated output, retries on mismatch.
 * Used by orchestration engine for adversarial verification, judge panel, etc.
 */

import { z } from "zod";
import type { LLMAdapter, LLMMessage } from "./llm-adapter";
import { sanitizePrompt } from "./infinity-prompt";

/**
 * Model tier configuration for subagents
 */
export type ModelTier = "lite" | "high" | "max";

export interface SubagentConfig {
  modelTier?: ModelTier;
  reasoningEffort?: "low" | "medium" | "high";
  temperature?: number;
  maxTokens?: number;
}

/**
 * Base subagent definition
 */
export interface SubagentDefinition<TOutput = unknown> {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  outputSchema: z.ZodSchema<TOutput>;
  defaultConfig: SubagentConfig;
}

/**
 * ===== CODE REVIEWER SUBAGENT =====
 * Finds bugs, security issues, performance problems
 * Adversarial: defaults to "broken unless proven correct"
 */
export const CodeReviewerOutput = z.object({
  verdict: z.enum(["APPROVE", "REQUEST_CHANGES", "BLOCK"]),
  summary: z.string().max(500),
  findings: z.array(z.object({
    id: z.string(),
    severity: z.enum(["critical", "high", "medium", "low", "info"]),
    category: z.enum(["correctness", "security", "performance", "maintainability", "style"]),
    file: z.string().optional(),
    line: z.number().optional(),
    title: z.string().max(100),
    description: z.string().max(500),
    suggestion: z.string().max(500).optional(),
    confidence: z.number().min(0).max(1),
  })),
  overallScore: z.number().min(0).max(100),
  mustFixBeforeMerge: z.array(z.string()),
  niceToHave: z.array(z.string()),
});

export type CodeReviewerOutput = z.infer<typeof CodeReviewerOutput>;

export const codeReviewer: SubagentDefinition<CodeReviewerOutput> = {
  id: "code-reviewer",
  name: "Code Reviewer",
  description: "Adversarial code review — defaults to 'broken unless proven correct'. Finds bugs, security, perf issues.",
  systemPrompt: `You are an EXPERT CODE REVIEWER. Your job is to find problems — you default to SKEPTICAL.

RULES:
1. Assume code has issues until proven otherwise
2. Be specific: file, line, exact problem
3. Every finding needs: severity, category, confidence (0-1)
4. Critical/High findings block merge
5. Output ONLY valid JSON matching the schema

CATEGORIES:
- correctness: logic errors, bugs, incorrect assumptions, edge cases missed
- security: vulnerabilities, secrets exposure, injection, auth bypass
- performance: unnecessary complexity, memory leaks, scaling issues, N+1
- maintainability: coupling, duplication, unclear naming, missing tests
- style: formatting, conventions, dead code

SEVERITY:
- critical: data loss, security breach, crash in production
- high: significant bug, major perf regression, auth issue
- medium: noticeable issue, technical debt
- low: minor improvement, style
- info: observation, suggestion

Be thorough but concise. Max 500 chars per description.`,
  outputSchema: CodeReviewerOutput,
  defaultConfig: {
    modelTier: "high",
    reasoningEffort: "high",
    temperature: 0.1,
    maxTokens: 4000,
  },
};

/**
 * ===== PLANNER SUBAGENT =====
 * Decomposes tasks into minimal verifiable steps + risk identification
 */
export const PlannerOutput = z.object({
  goal: z.string().max(200),
  steps: z.array(z.object({
    id: z.string(),
    description: z.string().max(200),
    toolHint: z.string().optional(), // suggested tool namespace
    dependsOn: z.array(z.string()), // step IDs this depends on
    verification: z.string().max(200), // how to verify this step works
    risk: z.enum(["low", "medium", "high", "critical"]),
    estimatedTokens: z.number().optional(),
  })),
  risks: z.array(z.object({
    id: z.string(),
    description: z.string().max(300),
    likelihood: z.enum(["low", "medium", "high"]),
    impact: z.enum(["low", "medium", "high", "critical"]),
    mitigation: z.string().max(300),
  })),
  successCriteria: z.array(z.string().max(200)),
  estimatedTotalTokens: z.number().optional(),
});

export type PlannerOutput = z.infer<typeof PlannerOutput>;

export const planner: SubagentDefinition<PlannerOutput> = {
  id: "planner",
  name: "Planner",
  description: "Decomposes complex tasks into minimal verifiable steps with dependencies and risk analysis",
  systemPrompt: `You are a TASK PLANNER. Break down the user's goal into SMALL, VERIFIABLE steps.

RULES:
1. Each step must be independently verifiable
2. Include explicit dependencies between steps
3. Identify risks for each step and overall
4. Suggest which tool namespace might help (web, browser, files, build, etc.)
5. Output ONLY valid JSON matching the schema

STEP STRUCTURE:
- id: unique step identifier
- description: what this step accomplishes (one sentence)
- toolHint: "web" | "browser" | "files" | "build" | "data" | "memory" | "research" | "integration" | null
- dependsOn: array of step IDs that must complete first
- verification: how to confirm this step succeeded
- risk: low/medium/high/critical

RISKS:
- Overall risks that could derail the entire task
- Each with likelihood, impact, mitigation

SUCCESS CRITERIA:
- Measurable outcomes that define "done"

Think in terms of: what could go wrong? what needs to happen first? how do I prove it works?`,
  outputSchema: PlannerOutput,
  defaultConfig: {
    modelTier: "high",
    reasoningEffort: "high",
    temperature: 0.2,
    maxTokens: 4000,
  },
};

/**
 * ===== RESEARCHER SUBAGENT =====
 * Browse → extract → cite — every claim needs source URL
 */
export const ResearcherOutput = z.object({
  query: z.string().max(300),
  findings: z.array(z.object({
    claim: z.string().max(500),
    evidence: z.string().max(1000),
    sourceUrl: z.string().url(),
    sourceTitle: z.string().max(200),
    confidence: z.number().min(0).max(1),
    relevance: z.enum(["critical", "high", "medium", "low"]),
  })),
  synthesis: z.string().max(2000),
  gaps: z.array(z.object({
    question: z.string().max(300),
    whyItMatters: z.string().max(300),
    suggestedSearch: z.string().max(200),
  })),
  sources: z.array(z.object({
    url: z.string().url(),
    title: z.string().max(200),
    snippet: z.string().max(300),
  })),
});

export type ResearcherOutput = z.infer<typeof ResearcherOutput>;

export const researcher: SubagentDefinition<ResearcherOutput> = {
  id: "researcher",
  name: "Researcher",
  description: "Browse, extract, cite — every claim backed by source URL. Structured research output.",
  systemPrompt: `You are a RESEARCHER. Your output must be VERIFIABLE — every claim needs a source URL.

RULES:
1. Browse multiple sources, extract key information
2. Every finding MUST have: claim, evidence, sourceUrl, confidence
3. Synthesize findings into coherent answer
4. Identify gaps — what's still unknown?
5. Output ONLY valid JSON matching the schema

FINDING STRUCTURE:
- claim: what you learned (one sentence)
- evidence: direct quote or paraphrase from source
- sourceUrl: exact URL where evidence comes from
- sourceTitle: page title
- confidence: 0-1 how certain you are
- relevance: critical/high/medium/low to the query

GAPS:
- What questions remain unanswered?
- Why does each matter?
- What search would fill it?

SOURCES:
- List all unique sources consulted

No hallucination. If unsure, lower confidence and note in gaps.`,
  outputSchema: ResearcherOutput,
  defaultConfig: {
    modelTier: "high",
    reasoningEffort: "high",
    temperature: 0.2,
    maxTokens: 6000,
  },
};

/**
 * ===== FIXER SUBAGENT =====
 * Targeted repairs with verification
 */
export const FixerOutput = z.object({
  analysis: z.object({
    rootCause: z.string().max(500),
    affectedFiles: z.array(z.string()),
    affectedFunctions: z.array(z.string()).optional(),
  }),
  fix: z.object({
    description: z.string().max(300),
    changes: z.array(z.object({
      file: z.string(),
      changeType: z.enum(["modify", "add", "delete"]),
      diff: z.string(), // unified diff format
      explanation: z.string().max(200),
    })),
    verificationSteps: z.array(z.string().max(200)),
  }),
  risks: z.array(z.object({
    description: z.string().max(200),
    likelihood: z.enum(["low", "medium", "high"]),
    mitigation: z.string().max(200),
  })),
  confidence: z.number().min(0).max(1),
});

export type FixerOutput = z.infer<typeof FixerOutput>;

export const fixer: SubagentDefinition<FixerOutput> = {
  id: "fixer",
  name: "Fixer",
  description: "Targeted repairs with unified diffs and verification steps",
  systemPrompt: `You are a TARGETED FIXER. Produce minimal, verified fixes.

RULES:
1. Analyze root cause first
2. Produce unified diffs for each file change
3. Every change needs explanation and verification step
4. Identify risks of the fix itself
5. Output ONLY valid JSON matching the schema

FIX STRUCTURE:
- rootCause: why the bug occurs (one sentence)
- affectedFiles: list of files to change
- changes: array of {file, changeType, diff, explanation}
  - diff: unified diff format (--- a/file +++ b/file @@ -1,3 +1,4 @@)
- verificationSteps: how to confirm fix works
- risks: what could break from this fix
- confidence: 0-1

Be surgical. Minimal changes. Testable.`,
  outputSchema: FixerOutput,
  defaultConfig: {
    modelTier: "high",
    reasoningEffort: "high",
    temperature: 0.1,
    maxTokens: 6000,
  },
};

/**
 * ===== SYNTHESIZER SUBAGENT =====
 * Merges multiple perspectives into coherent output
 */
export const SynthesizerOutput = z.object({
  synthesis: z.string().max(3000),
  sources: z.array(z.object({
    id: z.string(),
    perspective: z.string().max(100),
    keyPoints: z.array(z.string().max(200)),
    weight: z.number().min(0).max(1),
  })),
  conflicts: z.array(z.object({
    topic: z.string().max(200),
    perspectives: z.array(z.object({
      sourceId: z.string(),
      stance: z.string().max(200),
    })),
    resolution: z.string().max(500),
  })),
  confidence: z.number().min(0).max(1),
  recommendations: z.array(z.object({
    action: z.string().max(200),
    rationale: z.string().max(300),
    priority: z.enum(["critical", "high", "medium", "low"]),
  })),
});

export type SynthesizerOutput = z.infer<typeof SynthesizerOutput>;

export const synthesizer: SubagentDefinition<SynthesizerOutput> = {
  id: "synthesizer",
  name: "Synthesizer",
  description: "Merges multiple perspectives/approaches into coherent output with conflict resolution",
  systemPrompt: `You are a SYNTHESIZER. Merge multiple perspectives into one coherent output.

RULES:
1. Input: multiple approaches/perspectives on same problem
2. Identify key points from each, weighted by credibility
3. Find conflicts and resolve them explicitly
4. Produce actionable recommendations with priorities
5. Output ONLY valid JSON matching the schema

SYNTHESIS:
- Coherent merged answer (not just concatenation)
- Sources: each input perspective with weight (0-1)
- Conflicts: where perspectives disagree + your resolution
- Recommendations: prioritized actions with rationale
- Confidence: 0-1 overall

Think: what's the best path forward given ALL perspectives?`,
  outputSchema: SynthesizerOutput,
  defaultConfig: {
    modelTier: "max",
    reasoningEffort: "high",
    temperature: 0.2,
    maxTokens: 4000,
  },
};

/**
 * Registry of all subagents
 */
export const SUBAGENTS: Record<string, SubagentDefinition> = {
  "code-reviewer": codeReviewer,
  "planner": planner,
  "researcher": researcher,
  "fixer": fixer,
  "synthesizer": synthesizer,
};

/**
 * Get subagent by ID
 */
export function getSubagent<T>(id: string): SubagentDefinition<T> | undefined {
  return SUBAGENTS[id] as SubagentDefinition<T> | undefined;
}

/**
 * Spawn a subagent with schema-validated output
 * Retries on schema mismatch (max 2 retries)
 */
export async function spawnSubagent<T>(
  subagentId: string,
  prompt: string,
  llm: LLMAdapter,
  config?: SubagentConfig
): Promise<T> {
  const subagent = getSubagent<T>(subagentId);
  if (!subagent) {
    throw new Error(`Unknown subagent: ${subagentId}`);
  }

  const finalConfig = { ...subagent.defaultConfig, ...config };
  const sanitizedPrompt = sanitizePrompt(prompt);

  const messages: LLMMessage[] = [
    { role: "system", content: subagent.systemPrompt },
    { role: "user", content: sanitizedPrompt },
  ];

  const options = {
    temperature: finalConfig.temperature ?? 0.2,
    maxTokens: finalConfig.maxTokens ?? 4000,
    responseFormat: { type: "json_object" as const },
  };

  let lastError: Error | null = null;
  let lastResponse: string = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await llm.complete(messages, options);
      lastResponse = result.content;
      const parsed = JSON.parse(result.content);
      const validated = subagent.outputSchema.parse(parsed);
      return validated;
    } catch (err) {
      lastError = err as Error;
      // Add feedback for retry
      if (attempt < 2) {
        messages.push({
          role: "assistant" as const,
          content: lastResponse,
        });
        messages.push({
          role: "user" as const,
          content: `The previous output failed validation: ${lastError.message}. Please fix and output ONLY valid JSON matching the schema.`,
        });
      }
    }
  }

  throw new Error(`Subagent ${subagentId} failed after 3 attempts: ${lastError?.message}`);
}

/**
 * Spawn multiple subagents in parallel (for adversarial verify, judge panel)
 */
export async function spawnSubagentsParallel<T>(
  subagentId: string,
  prompts: string[],
  llm: LLMAdapter,
  config?: SubagentConfig
): Promise<Array<T | null>> {
  const promises = prompts.map(p =>
    spawnSubagent<T>(subagentId, p, llm, config).catch(err => {
      console.error(`[subagents] Parallel spawn failed for ${subagentId}:`, err);
      return null;
    })
  );
  return Promise.all(promises);
}

/**
 * Lenses for perspective-diverse verification
 */
export const VERIFICATION_LENSES = {
  correctness: {
    id: "correctness",
    name: "Correctness",
    prompt: "Does this correctly solve the problem? Are there logical errors, bugs, or incorrect assumptions?",
  },
  security: {
    id: "security",
    name: "Security",
    prompt: "Does this introduce security vulnerabilities? Are secrets handled safely? Is input validated?",
  },
  performance: {
    id: "performance",
    name: "Performance",
    prompt: "Is this efficient? Are there unnecessary computations, memory leaks, or scaling issues?",
  },
  reproducibility: {
    id: "reproducibility",
    name: "Reproducibility",
    prompt: "Can this be reproduced? Are there non-deterministic behaviors, flaky tests, or environment dependencies?",
  },
  maintainability: {
    id: "maintainability",
    name: "Maintainability",
    prompt: "Is this maintainable? Is there coupling, duplication, unclear naming, or missing tests?",
  },
} as const;

export type VerificationLens = keyof typeof VERIFICATION_LENSES;

/**
 * Spawn perspective-diverse verification — same claim judged by multiple lenses
 */
export async function perspectiveDiverseVerify(
  claim: string,
  context: string,
  llm: LLMAdapter,
  lenses: VerificationLens[] = ["correctness", "security", "performance", "reproducibility"],
  config?: SubagentConfig
): Promise<Record<VerificationLens, CodeReviewerOutput | null>> {
  const results: Record<string, CodeReviewerOutput | null> = {};

  await Promise.all(
    lenses.map(async (lens) => {
      const lensConfig = VERIFICATION_LENSES[lens];
      const prompt = `${lensConfig.prompt}\n\nCONTEXT:\n${context}\n\nCLAIM TO VERIFY:\n${claim}\n\nOutput a code review finding for this specific lens.`;

      try {
        const result = await spawnSubagent<CodeReviewerOutput>("code-reviewer", prompt, llm, config);
        results[lens] = result;
      } catch (err) {
        console.error(`[perspectiveDiverseVerify] Lens ${lens} failed:`, err);
        results[lens] = null;
      }
    })
  );

  return results as Record<VerificationLens, CodeReviewerOutput | null>;
}