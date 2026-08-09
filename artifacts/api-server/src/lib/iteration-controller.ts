/**
 * Iteration Controller: Manages unlimited iteration cycles for Jarvis Build.
 * Replaces the old 2-pass limit with full AI-assisted development loop.
 *
 * Supports:
 * - Unlimited generation passes
 * - Error detection and auto-fix
 * - User feedback loop
 * - Terminal error parsing
 * - Change tracking
 */

export interface IterationContext {
  workspaceId: string;
  currentPass: number;
  totalPasses: number;
  lastError: string | null;
  lastFeedback: string | null;
  filesChanged: Set<string>;
  commandsRun: string[];
  terminalErrors: TerminalError[];
}

export interface TerminalError {
  command: string;
  exitCode: number;
  output: string;
  extractedError: string;
}

export interface IterationResult {
  pass: number;
  success: boolean;
  filesGenerated: string[];
  filesModified: string[];
  error?: string;
  suggestion?: string;
  nextAction?: "continue" | "iterate" | "complete";
}

/**
 * Parse terminal output to extract meaningful error messages.
 */
export function parseTerminalError(command: string, output: string, exitCode: number): TerminalError {
  // Extract common error patterns
  const patterns = [
    /error[:\s]+([^\n]+)/i,
    /failed[:\s]+([^\n]+)/i,
    /exception[:\s]+([^\n]+)/i,
    /syntax error[:\s]+([^\n]+)/i,
    /cannot find[:\s]+([^\n]+)/i,
    /module not found[:\s]+([^\n]+)/i,
    /([A-Z][a-zA-Z]*Error[^:\n]*:[^\n]+)/,
  ];

  let extractedError = "Exit code: " + exitCode;

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      extractedError = match[1] || match[0];
      break;
    }
  }

  return {
    command,
    exitCode,
    output,
    extractedError,
  };
}

/**
 * Detect whether the error is auto-fixable vs requires user input.
 */
export function isAutoFixable(error: TerminalError): boolean {
  const autoFixPatterns = [
    /missing (import|require|dependency)/i,
    /cannot find module/i,
    /no such file or directory/i,
    /syntax error/i,
    /undefined is not/i,
    /typeerror/i,
    /referenceerror/i,
  ];

  return autoFixPatterns.some((pattern) => pattern.test(error.extractedError));
}

/**
 * Generate a fix suggestion based on error type.
 */
export function suggestFix(error: TerminalError, filePath: string): string {
  if (/missing (import|require|dependency)/i.test(error.extractedError)) {
    const match = error.extractedError.match(/['"]([^'"]+)['"]/);
    const module = match?.[1] || "module";
    return `Install missing dependency: npm install ${module}`;
  }

  if (/cannot find module/i.test(error.extractedError)) {
    const match = error.extractedError.match(/['"]([^'"]+)['"]/);
    const module = match?.[1] || "module";
    return `Install missing dependency: npm install ${module}`;
  }

  if (/syntax error/i.test(error.extractedError)) {
    const lineMatch = error.extractedError.match(/line (\d+)/i);
    const line = lineMatch?.[1] || "?";
    return `Fix syntax error in ${filePath} around line ${line}`;
  }

  if (/no such file or directory/i.test(error.extractedError)) {
    const match = error.extractedError.match(/['"]?([^'"]+)['"]?$/);
    const file = match?.[1] || "file";
    return `Create missing file: ${file}`;
  }

  return "Review and fix the error shown above";
}

/**
 * Calculate iteration statistics for reporting.
 */
export function getIterationStats(context: IterationContext): {
  currentPass: number;
  filesModified: number;
  errorsFixed: number;
  timeSpent: string;
} {
  return {
    currentPass: context.currentPass,
    filesModified: context.filesChanged.size,
    errorsFixed: context.terminalErrors.filter((e) => e.exitCode === 0).length,
    timeSpent: `${context.commandsRun.length} commands`,
  };
}

/**
 * Determine next action after each iteration pass.
 */
export function determineNextAction(
  lastResult: IterationResult,
  userFeedback: string | null,
  errorCount: number,
): "continue" | "iterate" | "complete" {
  // If user provided feedback, iterate
  if (userFeedback && userFeedback.trim().length > 0) {
    return "iterate";
  }

  // If last result was successful and no errors, complete
  if (lastResult.success && errorCount === 0) {
    return "complete";
  }

  // If error was auto-fixable, continue with auto-fix
  if (lastResult.success === false && errorCount > 0) {
    return "iterate";
  }

  // Default: ask user
  return "complete";
}

/**
 * Track changes across iterations.
 */
export class IterationTracker {
  private context: IterationContext;

  constructor(workspaceId: string) {
    this.context = {
      workspaceId,
      currentPass: 0,
      totalPasses: 0,
      lastError: null,
      lastFeedback: null,
      filesChanged: new Set(),
      commandsRun: [],
      terminalErrors: [],
    };
  }

  recordPass(pass: number): void {
    this.context.currentPass = pass;
    this.context.totalPasses = Math.max(this.context.totalPasses, pass + 1);
  }

  recordCommand(command: string): void {
    this.context.commandsRun.push(command);
  }

  recordError(error: TerminalError): void {
    this.context.terminalErrors.push(error);
    this.context.lastError = error.extractedError;
  }

  recordFeedback(feedback: string): void {
    this.context.lastFeedback = feedback;
  }

  recordFileChange(filePath: string): void {
    this.context.filesChanged.add(filePath);
  }

  getContext(): IterationContext {
    return this.context;
  }

  getStats() {
    return getIterationStats(this.context);
  }

  reset(): void {
    this.context.currentPass = 0;
    this.context.filesChanged.clear();
    this.context.commandsRun = [];
    this.context.terminalErrors = [];
    this.context.lastError = null;
    this.context.lastFeedback = null;
  }
}
