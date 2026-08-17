/**
 * SWE-Bench Fix Agent
 * Specialized agent for test-driven fixing: reproduce → write failing test → fix → verify
 */

import { logger } from "../logger";
import { type TestFailure, type AnalysisResult, analyzeTestOutput, getPrimaryFailure, extractErrorContext } from "./analyze";
import { verifyFix, generatePatch } from "./reproduce";

export interface FixAttempt {
  attempt: number;
  patch: string;
  testResult: {
    success: boolean;
    output: string;
    failedTests: string[];
  };
  reasoning: string;
}

export interface FixResult {
  success: boolean;
  instanceId: string;
  finalPatch: string;
  attempts: FixAttempt[];
  totalAttempts: number;
}

/**
 * Build the fix prompt for the LLM
 */
export function buildFixPrompt(
  issue: { problemStatement: string; hints?: string },
  failure: TestFailure,
  repoContext: { fileMap: Record<string, string>; relevantFiles: string[] }
): string {
  const errorContext = extractErrorContext(failure, "");

  return `You are an expert software engineer fixing a real GitHub issue. Use test-driven development.

## Issue
${issue.problemStatement}
${issue.hints ? `\nHints: ${issue.hints}` : ""}

## Failing Test
${errorContext}

## Relevant Files
${repoContext.relevantFiles.map(f => `- ${f}`).join("\n")}

## Instructions
1. First, understand the failing test - what does it expect?
2. Find the relevant source code that needs to be fixed
3. Write a minimal fix that makes the test pass
4. Do NOT modify the test file - only fix the implementation
5. Return a unified diff patch

## Output Format
Return ONLY a unified diff patch starting with \`\`\`diff
\`\`\`diff
--- a/path/to/file.ts
+++ b/path/to/file.ts
@@ -line,count +line,count @@
 context
-old code
+new code
\`\`\`
`;
}

/**
 * Build the verification prompt
 */
export function buildVerifyPrompt(
  issue: { problemStatement: string },
  patch: string,
  testOutput: string
): string {
  return `Verify that this fix resolves the issue.

## Original Issue
${issue.problemStatement}

## Applied Patch
\`\`\`diff
${patch}
\`\`\`

## Test Output After Fix
${testOutput}

## Question
Does this fix properly resolve the issue? Are there any regressions or remaining failures?
Answer YES or NO with brief reasoning.`;
}

/**
 * Run the fix agent loop
 */
export async function runFixAgent(
  issue: { instanceId: string; problemStatement: string; hints?: string; repo: string; baseCommit: string },
  repoPath: string,
  testCommand: string,
  maxAttempts: number = 3
): Promise<FixResult> {
  const attempts: FixAttempt[] = [];

  // Initial analysis
  const initialResult = await verifyFix(repoPath, testCommand);
  const analysis = analyzeTestOutput(initialResult.testOutput);
  let primaryFailure = getPrimaryFailure(analysis);

  if (!primaryFailure) {
    return {
      success: true,
      instanceId: issue.instanceId,
      finalPatch: "",
      attempts: [],
      totalAttempts: 0,
    };
  }

  logger.info({ instanceId: issue.instanceId, failure: primaryFailure.name }, "[SWE-Bench] Starting fix loop");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Build file map for context
    const { buildFileMap } = await import("../build-context");
    const fileMap = await buildFileMap(issue.instanceId, repoPath);

    // Get relevant files (simplified - in practice would use semantic search)
    const relevantFiles = Object.keys(fileMap).filter(f =>
      f.includes(primaryFailure.file?.replace(".py", "").replace(".ts", "").replace(".js", "") || "") ||
      primaryFailure.error.toLowerCase().split(" ").some(w => f.toLowerCase().includes(w))
    ).slice(0, 10);

    // Build prompt and get fix from LLM
    const prompt = buildFixPrompt(
      { problemStatement: issue.problemStatement, hints: issue.hints },
      primaryFailure,
      { fileMap, relevantFiles }
    );

    // Call LLM to get patch (using existing LLM adapter)
    const { createBestAdapter, buildInfinityPrompt } = await import("../llm");
    const adapter = createBestAdapter();
    const systemPrompt = "You are a senior software engineer. Output ONLY unified diff patches.";
    const fullPrompt = buildInfinityPrompt(systemPrompt, prompt, []);

    let patch = "";
    try {
      const response = await adapter(fullPrompt, { temperature: 0.1, maxTokens: 4000 });
      // Extract diff from response
      const diffMatch = response.match(/```diff\n([\s\S]*?)```/);
      patch = diffMatch ? diffMatch[1].trim() : response.trim();
    } catch (err) {
      logger.error({ err, attempt }, "[SWE-Bench] LLM call failed");
      attempts.push({
        attempt,
        patch: "",
        testResult: { success: false, output: "LLM error", failedTests: [] },
        reasoning: `LLM error: ${err instanceof Error ? err.message : "Unknown"}`,
      });
      continue;
    }

    if (!patch) {
      attempts.push({
        attempt,
        patch: "",
        testResult: { success: false, output: "Empty patch", failedTests: [] },
        reasoning: "LLM returned empty patch",
      });
      continue;
    }

    // Apply patch
    const { applyPatch } = await import("./reproduce");
    const applied = applyPatch(repoPath, patch);

    if (!applied) {
      attempts.push({
        attempt,
        patch,
        testResult: { success: false, output: "Patch apply failed", failedTests: [] },
        reasoning: "Failed to apply patch",
      });
      continue;
    }

    // Verify fix
    const verifyResult = await verifyFix(repoPath, testCommand);
    const verifyAnalysis = analyzeTestOutput(verifyResult.testOutput);

    attempts.push({
      attempt,
      patch,
      testResult: {
        success: verifyResult.success,
        output: verifyResult.testOutput,
        failedTests: verifyResult.failedTests,
      },
      reasoning: verifyAnalysis.summary,
    });

    if (verifyResult.success) {
      logger.info({ instanceId: issue.instanceId, attempt }, "[SWE-Bench] Fix verified!");
      const finalPatch = generatePatch(repoPath);
      return {
        success: true,
        instanceId: issue.instanceId,
        finalPatch,
        attempts,
        totalAttempts: attempt,
      };
    }

    // Update primary failure for next iteration
    primaryFailure = getPrimaryFailure(verifyAnalysis);
    if (!primaryFailure) {
      const finalPatch = generatePatch(repoPath);
      return {
        success: true,
        instanceId: issue.instanceId,
        finalPatch,
        attempts,
        totalAttempts: attempt,
      };
    }

    logger.warn({ instanceId: issue.instanceId, attempt, remaining: primaryFailure.name }, "[SWE-Bench] Fix attempt failed, retrying");
  }

  // All attempts failed
  const finalPatch = generatePatch(repoPath);
  return {
    success: false,
    instanceId: issue.instanceId,
    finalPatch,
    attempts,
    totalAttempts: maxAttempts,
  };
}