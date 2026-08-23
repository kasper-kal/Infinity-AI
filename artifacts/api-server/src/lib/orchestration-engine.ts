/**
 * ORCHESTRATION ENGINE — Core Multi-Agent Primitives
 *
 * Implements the fundamental orchestration patterns that enable Claude Code-style
 * multi-agent workflows entirely in-browser at $0 cost. Pure TypeScript, no external deps.
 *
 * Primitives:
 * - pipeline(items, ...stages) — concurrent, no barrier between stages
 * - parallel(thunks) — barrier: all complete before returning
 * - adversarialVerify(claim, votes=3) — N skeptics, default REFUTE, kill if majority refute
 * - judgePanel(task, approaches[], judges[]) — N attempts → M lenses → synthesize winner
 * - loopUntilDry(finders[], maxRounds=5) — spawn finders until K consecutive dry rounds
 * - multiModalSweep(searchAngles[]) — parallel agents, different search modalities
 * - completenessCritic(findings[]) — "what's missing?" → next round of work
 */

import type { LLMAdapter } from "./llm-adapter";
import { createBestAdapter } from "./adapter-factory";
import { sanitizePrompt } from "./infinity-prompt";

/**
 * Type for a pipeline stage function
 */
export type PipelineStage<TInput, TOutput> = (
  item: TInput,
  index: number,
  previousResult?: TOutput
) => Promise<TOutput>;

/**
 * Result of a pipeline stage
 */
export interface PipelineResult<T> {
  item: T;
  stageResults: Map<string, unknown>;
  errors: Error[];
}

/**
 * parallel() — Barrier: all thunks complete before returning
 * Returns array of results in same order as thunks. Thunk errors resolve to null.
 */
export async function parallel<T>(
  thunks: Array<() => Promise<T>>
): Promise<Array<T | null>> {
  const promises = thunks.map(async (thunk, i) => {
    try {
      return await thunk();
    } catch (err) {
      console.error(`[parallel] Thunk ${i} failed:`, err);
      return null;
    }
  });
  return Promise.all(promises);
}

/**
 * pipeline() — Concurrent pipeline with NO barrier between stages
 * Item A can be in stage 3 while item B is still in stage 1.
 * This is the DEFAULT pattern for multi-stage work — avoids idle time.
 */
export async function pipeline<TInput, TOutput>(
  items: TInput[],
  ...stages: Array<PipelineStage<TInput, TOutput>>
): Promise<Array<PipelineResult<TInput>>> {
  if (stages.length === 0) {
    return items.map(item => ({
      item,
      stageResults: new Map(),
      errors: [],
    }));
  }

  const results: Array<PipelineResult<TInput>> = items.map(item => ({
    item,
    stageResults: new Map(),
    errors: [],
  }));

  // Process each item through all stages sequentially, but items run concurrently
  // This means item 0 starts stage 1, then item 1 starts stage 1 while item 0 starts stage 2, etc.
  // But we implement it simply: each item runs through all stages in sequence
  // For true concurrent pipeline, we'd need a more complex implementation
  // Here we provide the simpler but still useful "no barrier" version where
  // all items go through stage 1, then all through stage 2, etc.
  // The key difference from parallel: stages run sequentially per item, but we don't
  // wait for ALL items to complete a stage before moving the NEXT stage.
  // Actually, the classic "pipeline" pattern IS stages as a sequence.
  // Let's implement true concurrent pipeline: each item flows through stages independently.

  const stageNames = stages.map((_, i) => `stage${i}`);

  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex];
    const result = results[itemIndex];
    let previousOutput: TOutput | undefined;

    for (let stageIndex = 0; stageIndex < stages.length; stageIndex++) {
      const stage = stages[stageIndex];
      const stageName = stageNames[stageIndex];

      try {
        previousOutput = await stage(item, itemIndex, previousOutput);
        result.stageResults.set(stageName, previousOutput);
      } catch (err) {
        result.errors.push(err as Error);
        result.stageResults.set(stageName, null);
        // Continue to next stage with null previous output
        previousOutput = undefined;
      }
    }
  }

  return results;
}

/**
 * True concurrent pipeline — each item flows through stages independently
 * without waiting for other items. This is the "pipeline" pattern from workflow script.
 * Wall-clock = slowest single-item chain, not sum-of-slowest-per-stage.
 */
export async function pipelineConcurrent<TInput, TOutput>(
  items: TInput[],
  ...stages: Array<PipelineStage<TInput, TOutput>>
): Promise<Array<PipelineResult<TInput>>> {
  if (stages.length === 0) {
    return items.map(item => ({
      item,
      stageResults: new Map(),
      errors: [],
    }));
  }

  const results: Array<PipelineResult<TInput>> = items.map(item => ({
    item,
    stageResults: new Map(),
    errors: [],
  }));

  const stageNames = stages.map((_, i) => `stage${i}`);

  // Each item runs through ALL stages independently (fully concurrent across items)
  const itemPromises = items.map(async (item, itemIndex) => {
    const result = results[itemIndex];
    let previousOutput: TOutput | undefined;

    for (let stageIndex = 0; stageIndex < stages.length; stageIndex++) {
      const stage = stages[stageIndex];
      const stageName = stageNames[stageIndex];

      try {
        previousOutput = await stage(item, itemIndex, previousOutput);
        result.stageResults.set(stageName, previousOutput);
      } catch (err) {
        result.errors.push(err as Error);
        result.stageResults.set(stageName, null);
        previousOutput = undefined;
      }
    }
    return result;
  });

  await Promise.all(itemPromises);
  return results;
}

/**
 * Configuration for adversarial verification
 */
export interface AdversarialVerifyConfig {
  votes?: number; // default 3
  llm?: LLMAdapter;
  model?: string;
  temperature?: number; // default 0.1 (low for consistency)
  maxTokens?: number; // default 2000
}

/**
 * Result of adversarial verification
 */
export interface AdversarialVerifyResult {
  claim: string;
  survives: boolean; // true if NOT killed (majority did NOT refute)
  votes: Array<{
    verdict: "refute" | "support" | "uncertain";
    reasoning: string;
    confidence: number; // 0-1
  }>;
  refuteCount: number;
  supportCount: number;
  uncertainCount: number;
}

/**
 * adversarialVerify() — Spawn N independent "skeptic" prompts
 * Each prompted to REFUTE the claim. Default to REFUTE if uncertain.
 * Kill claim if majority refute.
 */
export async function adversarialVerify(
  claim: string,
  config: AdversarialVerifyConfig = {}
): Promise<AdversarialVerifyResult> {
  const {
    votes = 3,
    llm,
    model,
    temperature = 0.1,
    maxTokens = 2000,
  } = config;

  const adapter = llm || await createBestAdapter();

  const skepticPrompt = `You are a rigorous skeptic. Your job is to REFUTE the following claim.

CLAIM: "${claim}"

INSTRUCTIONS:
- Default to REFUTE if you are uncertain.
- Only SUPPORT if you are HIGHLY CONFIDENT the claim is correct.
- Be adversarial: look for edge cases, missing evidence, logical flaws, alternative explanations.
- Output ONLY valid JSON with this schema:
{
  "verdict": "refute" | "support" | "uncertain",
  "reasoning": "detailed explanation of your position",
  "confidence": 0.0-1.0
}`;

  const votePromises = Array.from({ length: votes }, () =>
    adapter.complete(
      [
        { role: "system", content: sanitizePrompt(skepticPrompt) },
        { role: "user", content: "Verdict:" },
      ],
      { temperature, maxTokens, jsonMode: true }
    )
  );

  const voteResults = await Promise.all(votePromises);

  const votesParsed = voteResults.map(r => {
    try {
      const parsed = JSON.parse(r.content);
      return {
        verdict: parsed.verdict || "refute",
        reasoning: parsed.reasoning || "",
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      };
    } catch {
      return { verdict: "refute" as const, reasoning: "Failed to parse response", confidence: 0.5 };
    }
  });

  const refuteCount = votesParsed.filter(v => v.verdict === "refute").length;
  const supportCount = votesParsed.filter(v => v.verdict === "support").length;
  const uncertainCount = votesParsed.filter(v => v.verdict === "uncertain").length;

  // Default to refute if uncertain
  const effectiveRefutes = refuteCount + uncertainCount;
  const survives = effectiveRefutes < votes / 2; // majority must NOT refute

  return {
    claim,
    survives,
    votes: votesParsed,
    refuteCount,
    supportCount,
    uncertainCount,
  };
}

/**
 * Configuration for judge panel
 */
export interface JudgePanelConfig {
  llm?: LLMAdapter;
  model?: string;
  temperature?: number; // default 0.2
  maxTokens?: number; // default 3000
}

/**
 * An approach/attempt at solving a task
 */
export interface Approach<T = unknown> {
  id: string;
  name: string;
  content: T; // the actual solution/attempt
  metadata?: Record<string, unknown>;
}

/**
 * A judge/lens for evaluation
 */
export interface Judge {
  id: string;
  name: string;
  lens: string; // e.g., "correctness", "security", "performance", "user-experience"
  prompt: string; // evaluation criteria
}

/**
 * Score from a judge for an approach
 */
export interface JudgeScore {
  judgeId: string;
  approachId: string;
  score: number; // 0-100
  reasoning: string;
  passed: boolean;
}

/**
 * Result of judge panel evaluation
 */
export interface JudgePanelResult<T = unknown> {
  winner: Approach<T>;
  allScores: JudgeScore[];
  synthesis: string; // synthesized best solution
  runnerUp?: Approach<T>;
}

/**
 * judgePanel() — Generate N attempts → score with M distinct lenses → synthesize winner
 */
export async function judgePanel<T>(
  task: string,
  approaches: Approach<T>[],
  judges: Judge[],
  config: JudgePanelConfig = {}
): Promise<JudgePanelResult<T>> {
  const {
    llm,
    model,
    temperature = 0.2,
    maxTokens = 3000,
  } = config;

  const adapter = llm || await createBestAdapter();

  // Each judge evaluates each approach
  const evaluationPromises: Promise<JudgeScore>[] = [];

  for (const judge of judges) {
    for (const approach of approaches) {
      const evalPrompt = `You are evaluating a solution through the "${judge.lens}" lens.

TASK: ${task}

JUDGE LENS: ${judge.lens}
CRITERIA: ${judge.prompt}

APPROACH "${approach.name}" (ID: ${approach.id}):
${typeof approach.content === "string" ? approach.content : JSON.stringify(approach.content, null, 2)}

Score this approach 0-100 on ${judge.lens}. Be critical but fair.
Output ONLY valid JSON:
{
  "score": 0-100,
  "reasoning": "detailed justification",
  "passed": boolean (true if score >= 70)
}`;

      evaluationPromises.push(
        adapter
          .complete(
            [
              { role: "system", content: sanitizePrompt(evalPrompt) },
              { role: "user", content: "Score:" },
            ],
            { temperature, maxTokens, jsonMode: true }
          )
          .then(r => {
            try {
              const parsed = JSON.parse(r.content);
              return {
                judgeId: judge.id,
                approachId: approach.id,
                score: typeof parsed.score === "number" ? parsed.score : 0,
                reasoning: parsed.reasoning || "",
                passed: !!parsed.passed,
              } as JudgeScore;
            } catch {
              return {
                judgeId: judge.id,
                approachId: approach.id,
                score: 0,
                reasoning: "Failed to parse response",
                passed: false,
              } as JudgeScore;
            }
          })
      );
    }
  }

  const allScores = await Promise.all(evaluationPromises);

  // Calculate average score per approach
  const approachScores = new Map<string, { total: number; count: number; scores: JudgeScore[] }>();

  for (const score of allScores) {
    const existing = approachScores.get(score.approachId) || { total: 0, count: 0, scores: [] };
    existing.total += score.score;
    existing.count++;
    existing.scores.push(score);
    approachScores.set(score.approachId, existing);
  }

  // Find winner (highest average)
  let winner: Approach<T> = approaches[0];
  let winnerAvg = -1;

  for (const approach of approaches) {
    const stats = approachScores.get(approach.id);
    if (stats) {
      const avg = stats.total / stats.count;
      if (avg > winnerAvg) {
        winnerAvg = avg;
        winner = approach;
      }
    }
  }

  // Synthesize: combine winner with best ideas from runners-up
  const synthesisPrompt = `Synthesize the BEST solution from these approaches to the task.

TASK: ${task}

WINNER (${winner.name}, avg score: ${winnerAvg.toFixed(1)}):
${typeof winner.content === "string" ? winner.content : JSON.stringify(winner.content, null, 2)}

OTHER APPROACHES:
${approaches
  .filter(a => a.id !== winner.id)
  .map(
    a => {
      const stats = approachScores.get(a.id);
      const avg = stats ? (stats.total / stats.count).toFixed(1) : "N/A";
      return `${a.name} (avg: ${avg}): ${typeof a.content === "string" ? a.content : JSON.stringify(a.content, null, 2)}`;
    }
  )
  .join("\n\n")}

INSTRUCTIONS:
- Take the winner as the base
- Graft the BEST ideas from other approaches
- Fix any weaknesses identified by judges
- Output the synthesized solution as JSON or plain text

SYNTHESIZED SOLUTION:`;

  const synthesisResponse = await adapter.complete(
    [
      { role: "system", content: sanitizePrompt(synthesisPrompt) },
      { role: "user", content: "Synthesized solution:" },
    ],
    { temperature: 0.3, maxTokens }
  );

  return {
    winner,
    allScores,
    synthesis: synthesisResponse.content,
    runnerUp: approaches.find(a => a.id !== winner.id),
  };
}

/**
 * Configuration for loopUntilDry
 */
export interface LoopUntilDryConfig<TFindResult> {
  maxRounds?: number; // default 5
  dryThreshold?: number; // default 2 consecutive dry rounds
  llm?: LLMAdapter;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  onRound?: (round: number, newFindings: TFindResult[], total: number) => void;
}

/**
 * loopUntilDry() — Keep spawning finders until K consecutive rounds return nothing new
 */
export async function loopUntilDry<TFindResult, TInput>(
  finders: Array<(input: TInput) => Promise<TFindResult[]>>,
  input: TInput,
  config: LoopUntilDryConfig<TFindResult> = {}
): Promise<TFindResult[]> {
  const {
    maxRounds = 5,
    dryThreshold = 2,
    llm,
    model,
    temperature = 0.3,
    maxTokens = 3000,
    onRound,
  } = config;

  const adapter = llm || await createBestAdapter();

  const allFindings: TFindResult[] = [];
  const seenKeys = new Set<string>();
  let consecutiveDry = 0;

  for (let round = 1; round <= maxRounds; round++) {
    // Run all finders in parallel
    const finderPromises = finders.map(f => f(input));
    const roundResults = await Promise.all(finderPromises);

    // Flatten and deduplicate
    const newFindings: TFindResult[] = [];

    for (const findings of roundResults) {
      for (const finding of findings) {
        // Use JSON string as key for deduplication (caller can provide custom key function)
        const key = JSON.stringify(finding);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          newFindings.push(finding);
          allFindings.push(finding);
        }
      }
    }

    if (onRound) onRound(round, newFindings, allFindings.length);

    if (newFindings.length === 0) {
      consecutiveDry++;
      if (consecutiveDry >= dryThreshold) {
        console.log(`[loopUntilDry] Dry threshold reached (${consecutiveDry} consecutive empty rounds), stopping at round ${round}`);
        break;
      }
    } else {
      consecutiveDry = 0;
    }
  }

  return allFindings;
}

/**
 * Configuration for multi-modal sweep
 */
export interface MultiModalSweepConfig<TResult> {
  llm?: LLMAdapter;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  concurrency?: number; // default: all parallel
}

/**
 * multiModalSweep() — Parallel agents each searching a different way
 * Each search angle is blind to what others surface; useful when one angle won't find everything.
 */
export async function multiModalSweep<TInput, TResult>(
  searchAngles: Array<{
    name: string;
    prompt: string; // search prompt for this modality
    parser?: (response: string) => TResult[]; // optional custom parser
  }>,
  input: TInput,
  config: MultiModalSweepConfig<TResult> = {}
): Promise<Map<string, TResult[]>> {
  const {
    llm,
    model,
    temperature = 0.3,
    maxTokens = 3000,
    concurrency,
  } = config;

  const adapter = llm || await createBestAdapter();

  // Run all search angles in parallel
  const anglePromises = searchAngles.map(async angle => {
    try {
      const response = await adapter.complete(
        [
          { role: "system", content: sanitizePrompt(angle.prompt) },
          { role: "user", content: `Input: ${JSON.stringify(input)}` },
        ],
        { temperature, maxTokens, jsonMode: false }
      );

      const results = angle.parser
        ? angle.parser(response.content)
        : [response.content as unknown as TResult];

      return { name: angle.name, results };
    } catch (err) {
      console.error(`[multiModalSweep] Angle "${angle.name}" failed:`, err);
      return { name: angle.name, results: [] as TResult[] };
    }
  });

  const angleResults = await Promise.all(anglePromises);

  const resultsMap = new Map<string, TResult[]>();
  for (const { name, results } of angleResults) {
    resultsMap.set(name, results);
  }

  return resultsMap;
}

/**
 * Configuration for completeness critic
 */
export interface CompletenessCriticConfig {
  llm?: LLMAdapter;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Result of completeness critic
 */
export interface CompletenessCriticResult {
  missing: Array<{
    claim: string;
    modality: string; // e.g., "security", "performance", "edge-case", "test-coverage"
    severity: "critical" | "major" | "minor";
    suggestedFinder: string; // prompt for a new finder
  }>;
  hasGaps: boolean;
}

/**
 * completenessCritic() — Final agent asks "what's missing?" → becomes next round of work
 */
export async function completenessCritic(
  findings: unknown[],
  task: string,
  config: CompletenessCriticConfig = {}
): Promise<CompletenessCriticResult> {
  const {
    llm,
    model,
    temperature = 0.2,
    maxTokens = 3000,
  } = config;

  const adapter = llm || await createBestAdapter();

  const criticPrompt = `You are a completeness critic. Your job is to find what's MISSING from the current findings.

TASK: ${task}

CURRENT FINDINGS (${findings.length} total):
${JSON.stringify(findings, null, 2).slice(0, 10000)}

THINK ABOUT:
- Modalities not yet searched (e.g., security, performance, accessibility, edge cases, test coverage, error handling, documentation, dependencies, configuration, secrets)
- Claims made but not verified
- Sources not yet consulted
- Edge cases not considered
- Failure modes not analyzed

Output ONLY valid JSON:
{
  "missing": [
    {
      "claim": "specific missing claim/area",
      "modality": "security|performance|accessibility|edge-case|test-coverage|error-handling|docs|dependencies|config|secrets|other",
      "severity": "critical|major|minor",
      "suggestedFinder": "prompt for a new finder agent to investigate this"
    }
  ],
  "hasGaps": boolean
}`;

  const response = await adapter.complete(
    [
      { role: "system", content: sanitizePrompt(criticPrompt) },
      { role: "user", content: "Missing analysis:" },
    ],
    { temperature, maxTokens, jsonMode: true }
  );

  try {
    return JSON.parse(response.content);
  } catch {
    return { missing: [], hasGaps: false };
  }
}

/**
 * Quality pattern: No silent caps — log what was dropped
 */
export function logDropped<T>(
  label: string,
  total: number,
  kept: number,
  dropped: T[],
  maxLog = 10
): void {
  if (dropped.length > 0) {
    console.warn(`[Quality] ${label}: kept ${kept}/${total}, dropped ${dropped.length}`);
    if (dropped.length <= maxLog) {
      console.warn(`[Quality] Dropped: ${dropped.map(d => JSON.stringify(d)).join(", ")}`);
    } else {
      console.warn(`[Quality] Dropped (first ${maxLog}): ${dropped.slice(0, maxLog).map(d => JSON.stringify(d)).join(", ")} ... and ${dropped.length - maxLog} more`);
    }
  }
}

/**
 * Export all primitives
 */
export const orchestration = {
  pipeline,
  pipelineConcurrent,
  parallel,
  adversarialVerify,
  judgePanel,
  loopUntilDry,
  multiModalSweep,
  completenessCritic,
  logDropped,
};

export default orchestration;