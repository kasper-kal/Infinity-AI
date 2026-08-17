/**
 * SWE-Bench Test Analyzer
 * Parses test output, identifies failing tests, extracts error details
 */

import { logger } from "../logger";

export interface TestFailure {
  name: string;
  file?: string;
  line?: number;
  error: string;
  stackTrace?: string;
  framework: "pytest" | "jest" | "vitest" | "mocha" | "googletest" | "junit" | "unknown";
}

export interface AnalysisResult {
  framework: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration?: number;
  failures: TestFailure[];
  summary: string;
}

/**
 * Detect test framework from output
 */
export function detectFramework(output: string): TestFailure["framework"] {
  if (output.includes("pytest") || output.includes("FAILED") && output.includes("::")) return "pytest";
  if (output.includes("PASS") && output.includes("FAIL") && output.includes("Test Suites")) return "jest";
  if (output.includes("vitest") || output.includes("Vitest")) return "vitest";
  if (output.includes("mocha") || output.includes("Mocha")) return "mocha";
  if (output.includes("googletest") || output.includes("Google Test")) return "googletest";
  if (output.includes("JUnit") || output.includes("TestNG")) return "junit";
  return "unknown";
}

/**
 * Parse pytest output
 */
function parsePytest(output: string): TestFailure[] {
  const failures: TestFailure[] = [];

  // Pattern: FAILED tests/test_file.py::TestClass::test_method - AssertionError: message
  const failedMatches = output.matchAll(/FAILED\s+([^\s]+)\s*-\s*([^\n]+)/g);
  for (const match of failedMatches) {
    const fullName = match[1];
    const error = match[2].trim();

    // Extract file and test name
    const parts = fullName.split("::");
    const file = parts[0];
    const name = parts.slice(1).join("::");

    // Try to find stack trace
    const stackStart = output.indexOf(fullName);
    let stackTrace = "";
    if (stackStart !== -1) {
      const nextFailure = output.indexOf("FAILED", stackStart + 1);
      const nextSection = output.indexOf("\n=== ", stackStart + 1);
      const end = Math.min(
        nextFailure !== -1 ? nextFailure : Infinity,
        nextSection !== -1 ? nextSection : Infinity
      );
      if (end !== Infinity) {
        stackTrace = output.slice(stackStart, end).trim();
      } else {
        stackTrace = output.slice(stackStart, stackStart + 2000).trim();
      }
    }

    failures.push({ name, file, error, stackTrace, framework: "pytest" });
  }

  // Also look for ERROR
  const errorMatches = output.matchAll(/ERROR\s+([^\s]+)\s*-\s*([^\n]+)/g);
  for (const match of errorMatches) {
    const fullName = match[1];
    const error = match[2].trim();
    const parts = fullName.split("::");
    const file = parts[0];
    const name = parts.slice(1).join("::");
    failures.push({ name, file, error, framework: "pytest" });
  }

  return failures;
}

/**
 * Parse Jest/Vitest output
 */
function parseJest(output: string): TestFailure[] {
  const failures: TestFailure[] = [];

  // Pattern: ● Test name
  const testBlocks = output.split("\n● ");
  for (let i = 1; i < testBlocks.length; i++) {
    const block = testBlocks[i];
    const lines = block.split("\n");
    const name = lines[0].trim();

    // Find error message
    const errorLines = lines.slice(1).filter(l =>
      l.includes("expect") || l.includes("Error:") || l.includes("AssertionError") || l.includes("TypeError")
    );
    const error = errorLines[0]?.trim() || "Test failed";

    // Find file
    const fileMatch = block.match(/(\S+\.test\.\w+)|(\S+\.spec\.\w+)/);
    const file = fileMatch?.[0];

    failures.push({ name, file, error, framework: "jest" });
  }

  return failures;
}

/**
 * Parse generic test output
 */
function parseGeneric(output: string): TestFailure[] {
  const failures: TestFailure[] = [];

  // Look for common failure patterns
  const patterns = [
    /(FAIL|FAILED|Error|ERROR|FAILURE)[:\s]+([^\n]+)/gi,
    /AssertionError[:\s]+([^\n]+)/gi,
    /Test\s+failed[:\s]+([^\n]+)/gi,
  ];

  for (const pattern of patterns) {
    const matches = output.matchAll(pattern);
    for (const match of matches) {
      failures.push({
        name: match[2]?.trim() || "Unknown test",
        error: match[0].trim(),
        framework: "unknown",
      });
    }
  }

  return failures;
}

/**
 * Main analysis function
 */
export function analyzeTestOutput(output: string): AnalysisResult {
  const framework = detectFramework(output);
  let failures: TestFailure[] = [];

  switch (framework) {
    case "pytest":
      failures = parsePytest(output);
      break;
    case "jest":
    case "vitest":
      failures = parseJest(output);
      break;
    default:
      failures = parseGeneric(output);
  }

  // Count totals (rough estimates from output)
  const passedMatch = output.match(/(?:passed|PASS)[=\s]*(\d+)/i);
  const failedMatch = output.match(/(?:failed|FAIL)[=\s]*(\d+)/i);
  const skippedMatch = output.match(/(?:skipped|SKIP)[=\s]*(\d+)/i);
  const totalMatch = output.match(/(?:tests?|Tests?)[=\s]*(\d+)/i);

  const passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
  const failed = failedMatch ? parseInt(failedMatch[1], 10) : failures.length;
  const skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;
  const total = totalMatch ? parseInt(totalMatch[1], 10) : passed + failed + skipped;

  // Extract duration
  const durationMatch = output.match(/(?:in|took)\s+([\d.]+)\s*(s|ms|seconds?)/i);
  const duration = durationMatch ? parseFloat(durationMatch[1]) * (durationMatch[2].startsWith("m") ? 1 : 1000) : undefined;

  return {
    framework,
    totalTests: total,
    passed,
    failed,
    skipped,
    duration,
    failures,
    summary: `${framework}: ${passed} passed, ${failed} failed, ${skipped} skipped`,
  };
}

/**
 * Get the most relevant failure for fixing
 */
export function getPrimaryFailure(analysis: AnalysisResult): TestFailure | null {
  if (analysis.failures.length === 0) return null;

  // Prioritize: first failure, or one with stack trace
  const withStack = analysis.failures.find(f => f.stackTrace);
  return withStack || analysis.failures[0];
}

/**
 * Extract relevant code context for a failure
 */
export function extractErrorContext(failure: TestFailure, repoPath: string): string {
  if (!failure.file) return "";

  // This would read the test file and find the relevant test
  // For now, return the failure info
  return `
Test: ${failure.name}
File: ${failure.file}
Error: ${failure.error}
${failure.stackTrace ? `\nStack:\n${failure.stackTrace}` : ""}
`;
}