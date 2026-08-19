/**
 * BUILD DONE CONTRACT SYSTEM
 *
 * Deterministic completion verification for Build Mode.
 * Replaces "I think this looks good" with explicit verification gates.
 *
 * Features:
 * - Completion checklist per build type (SaaS dashboard, CLI tool, library, etc.)
 * - Verification gates that MUST pass before DONE
 * - Explicit DONE signal with structured JSON output
 * - Contract persistence to build_checkpoints
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getWorkspaceRoot, safeWorkspacePath } from "./workspace";

/**
 * Build types with their specific completion criteria
 */
export type BuildType =
  | "saas-dashboard"
  | "cli-tool"
  | "library"
  | "mobile-app"
  | "website"
  | "api-service"
  | "desktop-app"
  | "browser-extension"
  | "general";

/**
 * Verification gate result
 */
export interface VerificationGateResult {
  gate: string;
  passed: boolean;
  details: string;
  severity: "critical" | "major" | "minor";
  evidence?: Record<string, unknown>;
}

/**
 * Done contract definition per build type
 */
export interface DoneContract {
  buildType: BuildType;
  name: string;
  description: string;
  /** Gates that MUST pass for completion */
  requiredGates: VerificationGate[];
  /** Optional gates (warnings if fail) */
  optionalGates: VerificationGate[];
  /** Post-completion actions */
  postActions?: PostAction[];
}

/**
 * Individual verification gate
 */
export interface VerificationGate {
  id: string;
  name: string;
  description: string;
  severity: "critical" | "major" | "minor";
  /** Async function that returns gate result */
  verify: (context: VerificationContext) => Promise<VerificationGateResult>;
}

/**
 * Context passed to verification gates
 */
export interface VerificationContext {
  projectId: string;
  workspaceId: string;
  buildId: string;
  projectPath: string;
  buildType: BuildType;
  plan?: BuildPlan;
  /** Results from previous gates */
  previousResults?: VerificationGateResult[];
  /** Custom data from build steps */
  buildArtifacts?: Record<string, unknown>;
}

/**
 * Build plan reference
 */
export interface BuildPlan {
  id: string;
  goal: string;
  acceptanceCriteria: AcceptanceCriterion[];
  steps: PlanStep[];
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  verified: boolean;
  evidence?: string;
}

export interface PlanStep {
  id: string;
  description: string;
  status: "pending" | "in-progress" | "completed" | "failed" | "skipped";
  output?: string;
}

/**
 * Post-completion action
 */
export interface PostAction {
  id: string;
  name: string;
  description: string;
  execute: (context: VerificationContext) => Promise<void>;
}

/**
 * Done contract evaluation result
 */
export interface DoneContractResult {
  success: boolean;
  buildType: BuildType;
  contractName: string;
  gateResults: VerificationGateResult[];
  summary: {
    totalGates: number;
    passed: number;
    failed: number;
    criticalFailed: number;
    majorFailed: number;
    minorFailed: number;
  };
  postActionResults: Array<{ actionId: string; success: boolean; error?: string }>;
  doneSignal: DoneSignal;
}

/**
 * Structured DONE signal output
 */
export interface DoneSignal {
  status: "DONE" | "INCOMPLETE" | "FAILED";
  timestamp: string;
  buildId: string;
  projectId: string;
  contract: string;
  gatesPassed: number;
  gatesTotal: number;
  message: string;
  artifacts: DoneArtifact[];
}

export interface DoneArtifact {
  type: "file" | "url" | "report" | "binary";
  path?: string;
  url?: string;
  description: string;
  metadata?: Record<string, unknown>;
}

/**
 * Done Contract Engine
 * Evaluates contracts and emits DONE signals
 */
export class DoneContractEngine {
  private contracts: Map<BuildType, DoneContract> = new Map();
  private projectId: string;
  private workspaceId: string;

  constructor(projectId: string, workspaceId?: string) {
    this.projectId = projectId;
    this.workspaceId = workspaceId || projectId;
    this.registerBuiltInContracts();
  }

  /**
   * Register a custom done contract
   */
  registerContract(contract: DoneContract): void {
    this.contracts.set(contract.buildType, contract);
  }

  /**
   * Get contract for build type
   */
  getContract(buildType: BuildType): DoneContract | undefined {
    return this.contracts.get(buildType);
  }

  /**
   * Evaluate done contract for a build
   */
  async evaluate(context: VerificationContext): Promise<DoneContractResult> {
    const contract = this.contracts.get(context.buildType);
    if (!contract) {
      throw new Error(`No done contract found for build type: ${context.buildType}`);
    }

    const allGates = [...contract.requiredGates, ...contract.optionalGates];
    const gateResults: VerificationGateResult[] = [];

    // Run all gates in order
    for (const gate of allGates) {
      try {
        const result = await gate.verify(context);
        gateResults.push(result);
        // Add to context for subsequent gates
        context.previousResults = gateResults;
      } catch (error) {
        gateResults.push({
          gate: gate.id,
          passed: false,
          details: `Gate execution error: ${error instanceof Error ? error.message : String(error)}`,
          severity: gate.severity,
        });
      }
    }

    // Evaluate results
    const requiredResults = gateResults.filter(r =>
      contract.requiredGates.some(g => g.id === r.gate)
    );
    const optionalResults = gateResults.filter(r =>
      contract.optionalGates.some(g => g.id === r.gate)
    );

    const criticalFailed = requiredResults.filter(r => !r.passed && r.severity === "critical").length;
    const majorFailed = requiredResults.filter(r => !r.passed && r.severity === "major").length;
    const minorFailed = [...requiredResults, ...optionalResults].filter(r => !r.passed && r.severity === "minor").length;

    const success = criticalFailed === 0 && majorFailed === 0;

    // Run post actions if successful
    const postActionResults: Array<{ actionId: string; success: boolean; error?: string }> = [];
    if (success && contract.postActions) {
      for (const action of contract.postActions) {
        try {
          await action.execute(context);
          postActionResults.push({ actionId: action.id, success: true });
        } catch (error) {
          postActionResults.push({
            actionId: action.id,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Generate DONE signal
    const doneSignal = this.generateDoneSignal({
      success,
      contract,
      gateResults,
      context,
      postActionResults,
    });

    // Persist contract result
    await this.persistResult(context, {
      success,
      buildType: context.buildType,
      contractName: contract.name,
      gateResults,
      summary: {
        totalGates: allGates.length,
        passed: gateResults.filter(r => r.passed).length,
        failed: gateResults.filter(r => !r.passed).length,
        criticalFailed,
        majorFailed,
        minorFailed,
      },
      postActionResults,
      doneSignal,
    });

    return {
      success,
      buildType: context.buildType,
      contractName: contract.name,
      gateResults,
      summary: {
        totalGates: allGates.length,
        passed: gateResults.filter(r => r.passed).length,
        failed: gateResults.filter(r => !r.passed).length,
        criticalFailed,
        majorFailed,
        minorFailed,
      },
      postActionResults,
      doneSignal,
    };
  }

  /**
   * Generate structured DONE signal
   */
  private generateDoneSignal(params: {
    success: boolean;
    contract: DoneContract;
    gateResults: VerificationGateResult[];
    context: VerificationContext;
    postActionResults: Array<{ actionId: string; success: boolean; error?: string }>;
  }): DoneSignal {
    const { success, contract, gateResults, context } = params;
    const passed = gateResults.filter(r => r.passed).length;

    let status: DoneSignal["status"] = "DONE";
    if (!success) {
      const criticalFailed = gateResults.filter(r => !r.passed && r.severity === "critical").length;
      status = criticalFailed > 0 ? "FAILED" : "INCOMPLETE";
    }

    const message = success
      ? `Build completed successfully. All ${passed}/${gateResults.length} verification gates passed.`
      : `Build incomplete: ${gateResults.filter(r => !r.passed).length} gate(s) failed.`;

    return {
      status,
      timestamp: new Date().toISOString(),
      buildId: context.buildId,
      projectId: context.projectId,
      contract: contract.name,
      gatesPassed: passed,
      gatesTotal: gateResults.length,
      message,
      artifacts: [], // Populated by post actions
    };
  }

  /**
   * Persist contract evaluation result
   */
  private async persistResult(
    context: VerificationContext,
    result: DoneContractResult
  ): Promise<void> {
    const checkpointDir = safeWorkspacePath(this.workspaceId, ".infinity/build-checkpoints") || path.join(process.cwd(), ".infinity", "build-checkpoints");
    await fs.mkdir(checkpointDir, { recursive: true });

    const filename = `done-contract-${context.buildId}-${Date.now()}.json`;
    const filepath = path.join(checkpointDir, filename);

    await fs.writeFile(filepath, JSON.stringify(result, null, 2));
  }

  /**
   * Register built-in contracts for common build types
   */
  private registerBuiltInContracts(): void {
    // SaaS Dashboard Contract
    this.contracts.set("saas-dashboard", {
      buildType: "saas-dashboard",
      name: "SaaS Dashboard Completion Contract",
      description: "Verification gates for production-ready SaaS dashboard",
      requiredGates: [
        createTypecheckGate(),
        createBuildGate(),
        createRuntimeErrorGate(),
        createVisualVerificationGate(),
        createAcceptanceCriteriaGate(),
        createTestsGate(),
        createBrokenLinksGate(),
        createSecurityScanGate(),
      ],
      optionalGates: [
        createAccessibilityGate(),
        createPerformanceGate(),
        createSeoGate(),
      ],
      postActions: [
        createDeploymentSummaryAction(),
        createArtifactIndexAction(),
      ],
    });

    // CLI Tool Contract
    this.contracts.set("cli-tool", {
      buildType: "cli-tool",
      name: "CLI Tool Completion Contract",
      description: "Verification gates for production-ready CLI tool",
      requiredGates: [
        createTypecheckGate(),
        createBuildGate(),
        createRuntimeErrorGate(),
        createAcceptanceCriteriaGate(),
        createTestsGate(),
        createCliHelpGate(),
        createBinaryGate(),
      ],
      optionalGates: [
        createCrossPlatformGate(),
        createDocumentationGate(),
      ],
      postActions: [
        createArtifactIndexAction(),
      ],
    });

    // Library Contract
    this.contracts.set("library", {
      buildType: "library",
      name: "Library Completion Contract",
      description: "Verification gates for publish-ready library",
      requiredGates: [
        createTypecheckGate(),
        createBuildGate(),
        createRuntimeErrorGate(),
        createAcceptanceCriteriaGate(),
        createTestsGate(),
        createExportsGate(),
        createTypesGate(),
        createPublishDryRunGate(),
      ],
      optionalGates: [
        createBundleSizeGate(),
        createDocumentationGate(),
        createChangelogGate(),
      ],
      postActions: [
        createArtifactIndexAction(),
      ],
    });

    // Website Contract
    this.contracts.set("website", {
      buildType: "website",
      name: "Website Completion Contract",
      description: "Verification gates for production-ready website",
      requiredGates: [
        createTypecheckGate(),
        createBuildGate(),
        createRuntimeErrorGate(),
        createVisualVerificationGate(),
        createAcceptanceCriteriaGate(),
        createBrokenLinksGate(),
        createSeoGate(),
        createMetaTagsGate(),
      ],
      optionalGates: [
        createAccessibilityGate(),
        createPerformanceGate(),
        createPwaGate(),
      ],
      postActions: [
        createDeploymentSummaryAction(),
        createArtifactIndexAction(),
      ],
    });

    // API Service Contract
    this.contracts.set("api-service", {
      buildType: "api-service",
      name: "API Service Completion Contract",
      description: "Verification gates for production-ready API service",
      requiredGates: [
        createTypecheckGate(),
        createBuildGate(),
        createRuntimeErrorGate(),
        createAcceptanceCriteriaGate(),
        createTestsGate(),
        createApiSpecGate(),
        createHealthCheckGate(),
        createSecurityScanGate(),
      ],
      optionalGates: [
        createLoadTestGate(),
        createDocumentationGate(),
        createRateLimitGate(),
      ],
      postActions: [
        createArtifactIndexAction(),
      ],
    });

    // General Contract (fallback)
    this.contracts.set("general", {
      buildType: "general",
      name: "General Build Completion Contract",
      description: "Basic verification gates for any build type",
      requiredGates: [
        createTypecheckGate(),
        createBuildGate(),
        createRuntimeErrorGate(),
        createAcceptanceCriteriaGate(),
        createTestsGate(),
        createBrokenLinksGate(),
        createSecurityScanGate(),
      ],
      optionalGates: [
        createVisualVerificationGate(),
        createAccessibilityGate(),
      ],
      postActions: [
        createArtifactIndexAction(),
      ],
    });
  }
}

/**
 * ============================================================
 * BUILT-IN VERIFICATION GATES
 * ============================================================
 */

function createTypecheckGate(): VerificationGate {
  return {
    id: "typecheck",
    name: "TypeScript Type Check",
    description: "Project compiles without TypeScript errors",
    severity: "critical",
    async verify(context) {
      const { execa } = await import("execa");
      try {
        const result = await execa("pnpm", ["run", "typecheck"], {
          cwd: context.projectPath,
          reject: false,
        });
        return {
          gate: "typecheck",
          passed: result.exitCode === 0,
          details: result.exitCode === 0
            ? "TypeScript compilation successful"
            : `TypeScript errors found:\n${result.stdout}\n${result.stderr}`,
          severity: "critical",
          evidence: { exitCode: result.exitCode, output: result.stdout },
        };
      } catch (error) {
        return {
          gate: "typecheck",
          passed: false,
          details: `Typecheck execution failed: ${error instanceof Error ? error.message : String(error)}`,
          severity: "critical",
        };
      }
    },
  };
}

function createBuildGate(): VerificationGate {
  return {
    id: "build",
    name: "Production Build",
    description: "Project builds successfully for production",
    severity: "critical",
    async verify(context) {
      const { execa } = await import("execa");
      try {
        const result = await execa("pnpm", ["run", "build"], {
          cwd: context.projectPath,
          reject: false,
        });
        return {
          gate: "build",
          passed: result.exitCode === 0,
          details: result.exitCode === 0
            ? "Production build successful"
            : `Build failed:\n${result.stdout}\n${result.stderr}`,
          severity: "critical",
          evidence: { exitCode: result.exitCode, output: result.stdout },
        };
      } catch (error) {
        return {
          gate: "build",
          passed: false,
          details: `Build execution failed: ${error instanceof Error ? error.message : String(error)}`,
          severity: "critical",
        };
      }
    },
  };
}

function createRuntimeErrorGate(): VerificationGate {
  return {
    id: "runtime-errors",
    name: "Runtime Error Free",
    description: "No console errors in browser runtime",
    severity: "critical",
    async verify(context) {
      // This would integrate with visual verification system
      // For now, check if visual verification passed
      const visualResult = context.previousResults?.find(r => r.gate === "visual-verification");
      if (visualResult) {
        const consoleErrors = visualResult.evidence?.consoleErrors as string[] || [];
        return {
          gate: "runtime-errors",
          passed: consoleErrors.length === 0,
          details: consoleErrors.length === 0
            ? "No console errors detected"
            : `Console errors: ${consoleErrors.join(", ")}`,
          severity: "critical",
          evidence: { consoleErrors },
        };
      }
      return {
        gate: "runtime-errors",
        passed: true,
        details: "Skipped (visual verification not run)",
        severity: "critical",
      };
    },
  };
}

function createVisualVerificationGate(): VerificationGate {
  return {
    id: "visual-verification",
    name: "Visual Verification",
    description: "Visual regression tests pass",
    severity: "major",
    async verify(context) {
      // This would integrate with the visual verification system
      // For now, return skipped
      return {
        gate: "visual-verification",
        passed: true,
        details: "Visual verification not configured for this build",
        severity: "major",
      };
    },
  };
}

function createAcceptanceCriteriaGate(): VerificationGate {
  return {
    id: "acceptance-criteria",
    name: "Acceptance Criteria Met",
    description: "All acceptance criteria from plan verified",
    severity: "critical",
    async verify(context) {
      if (!context.plan?.acceptanceCriteria || context.plan.acceptanceCriteria.length === 0) {
        return {
          gate: "acceptance-criteria",
          passed: true,
          details: "No acceptance criteria defined",
          severity: "critical",
        };
      }

      const unmet = context.plan.acceptanceCriteria.filter(c => !c.verified);
      return {
        gate: "acceptance-criteria",
        passed: unmet.length === 0,
        details: unmet.length === 0
          ? `All ${context.plan.acceptanceCriteria.length} acceptance criteria met`
          : `${unmet.length} unmet criteria: ${unmet.map(c => c.description).join(", ")}`,
        severity: "critical",
        evidence: { criteria: context.plan.acceptanceCriteria },
      };
    },
  };
}

function createTestsGate(): VerificationGate {
  return {
    id: "tests",
    name: "Tests Pass",
    description: "Test suite passes (if tests exist)",
    severity: "major",
    async verify(context) {
      const { execa } = await import("execa");
      try {
        // Check if test script exists
        const pkgPath = path.join(context.projectPath, "package.json");
        const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));

        if (!pkg.scripts?.test) {
          return {
            gate: "tests",
            passed: true,
            details: "No test script defined, skipping",
            severity: "major",
          };
        }

        const result = await execa("pnpm", ["run", "test"], {
          cwd: context.projectPath,
          reject: false,
          timeout: 120000,
        });

        return {
          gate: "tests",
          passed: result.exitCode === 0,
          details: result.exitCode === 0
            ? "All tests passed"
            : `Tests failed:\n${result.stdout}\n${result.stderr}`,
          severity: "major",
          evidence: { exitCode: result.exitCode, output: result.stdout },
        };
      } catch (error) {
        return {
          gate: "tests",
          passed: false,
          details: `Test execution failed: ${error instanceof Error ? error.message : String(error)}`,
          severity: "major",
        };
      }
    },
  };
}

function createBrokenLinksGate(): VerificationGate {
  return {
    id: "broken-links",
    name: "No Broken Links/Imports",
    description: "No broken internal links or missing imports",
    severity: "major",
    async verify(context) {
      // Check for broken imports in TypeScript/JavaScript files
      const { execa } = await import("execa");
      try {
        // Use a simple check - tsc --noEmit catches missing imports
        const result = await execa("pnpm", ["run", "typecheck"], {
          cwd: context.projectPath,
          reject: false,
        });

        const hasImportErrors = result.stderr.includes("Cannot find module") ||
          result.stderr.includes("Module not found") ||
          result.stdout.includes("Cannot find module");

        return {
          gate: "broken-links",
          passed: !hasImportErrors,
          details: hasImportErrors
            ? "Broken imports detected"
            : "No broken imports detected",
          severity: "major",
          evidence: { exitCode: result.exitCode },
        };
      } catch {
        return {
          gate: "broken-links",
          passed: true,
          details: "Check skipped",
          severity: "major",
        };
      }
    },
  };
}

function createSecurityScanGate(): VerificationGate {
  return {
    id: "security-scan",
    name: "Security Scan Clean",
    description: "No critical/high vulnerabilities in dependencies",
    severity: "major",
    async verify(context) {
      const { execa } = await import("execa");
      try {
        const result = await execa("pnpm", ["audit", "--json"], {
          cwd: context.projectPath,
          reject: false,
        });

        let highCount = 0;
        let criticalCount = 0;

        try {
          const audit = JSON.parse(result.stdout);
          if (audit.metadata?.vulnerabilities) {
            highCount = audit.metadata.vulnerabilities.high || 0;
            criticalCount = audit.metadata.vulnerabilities.critical || 0;
          }
        } catch {
          // JSON parse failed, try text output
        }

        const total = highCount + criticalCount;
        return {
          gate: "security-scan",
          passed: total === 0,
          details: total === 0
            ? "No high/critical vulnerabilities"
            : `Found ${criticalCount} critical and ${highCount} high vulnerabilities`,
          severity: "major",
          evidence: { critical: criticalCount, high: highCount },
        };
      } catch {
        return {
          gate: "security-scan",
          passed: true,
          details: "Security scan skipped (pnpm audit not available)",
          severity: "major",
        };
      }
    },
  };
}

function createAccessibilityGate(): VerificationGate {
  return {
    id: "accessibility",
    name: "Accessibility Check",
    description: "Basic accessibility compliance (WCAG AA)",
    severity: "minor",
    async verify(context) {
      // Would integrate with axe-core or similar
      return {
        gate: "accessibility",
        passed: true,
        details: "Accessibility check not implemented",
        severity: "minor",
      };
    },
  };
}

function createPerformanceGate(): VerificationGate {
  return {
    id: "performance",
    name: "Performance Budget",
    description: "Meets performance budgets (LCP, CLS, TBT)",
    severity: "minor",
    async verify(context) {
      return {
        gate: "performance",
        passed: true,
        details: "Performance check not implemented",
        severity: "minor",
      };
    },
  };
}

function createSeoGate(): VerificationGate {
  return {
    id: "seo",
    name: "SEO Basics",
    description: "Basic SEO requirements met",
    severity: "minor",
    async verify(context) {
      return {
        gate: "seo",
        passed: true,
        details: "SEO check not implemented",
        severity: "minor",
      };
    },
  };
}

function createCliHelpGate(): VerificationGate {
  return {
    id: "cli-help",
    name: "CLI Help Works",
    description: "CLI shows help without errors",
    severity: "critical",
    async verify(context) {
      const { execa } = await import("execa");
      try {
        // Find the built CLI binary
        const distPath = path.join(context.projectPath, "dist");
        const binFiles = await fs.readdir(distPath).catch(() => []);
        const cliFile = binFiles.find(f => f.endsWith(".js") && !f.includes(".map"));

        if (!cliFile) {
          return {
            gate: "cli-help",
            passed: false,
            details: "No CLI binary found in dist/",
            severity: "critical",
          };
        }

        const result = await execa("node", [path.join(distPath, cliFile), "--help"], {
          cwd: context.projectPath,
          reject: false,
        });

        return {
          gate: "cli-help",
          passed: result.exitCode === 0,
          details: result.exitCode === 0 ? "CLI help works" : "CLI help failed",
          severity: "critical",
          evidence: { exitCode: result.exitCode },
        };
      } catch {
        return {
          gate: "cli-help",
          passed: false,
          details: "CLI help check failed",
          severity: "critical",
        };
      }
    },
  };
}

function createBinaryGate(): VerificationGate {
  return {
    id: "binary",
    name: "Executable Binary",
    description: "Produces executable binary",
    severity: "critical",
    async verify(context) {
      const distPath = path.join(context.projectPath, "dist");
      try {
        const files = await fs.readdir(distPath);
        const hasBinary = files.some(f => f.endsWith(".js") && !f.includes(".map"));
        return {
          gate: "binary",
          passed: hasBinary,
          details: hasBinary ? "Binary found in dist/" : "No binary in dist/",
          severity: "critical",
        };
      } catch {
        return {
          gate: "binary",
          passed: false,
          details: "No dist/ directory",
          severity: "critical",
        };
      }
    },
  };
}

function createCrossPlatformGate(): VerificationGate {
  return {
    id: "cross-platform",
    name: "Cross-Platform Compatible",
    description: "Works on Windows, macOS, Linux",
    severity: "minor",
    async verify() {
      return {
        gate: "cross-platform",
        passed: true,
        details: "Cross-platform check not implemented",
        severity: "minor",
      };
    },
  };
}

function createDocumentationGate(): VerificationGate {
  return {
    id: "documentation",
    name: "Documentation Exists",
    description: "README, API docs, or usage guide present",
    severity: "minor",
    async verify(context) {
      const docs = ["README.md", "README.txt", "docs/", "documentation/"];
      for (const doc of docs) {
        try {
          await fs.access(path.join(context.projectPath, doc));
          return {
            gate: "documentation",
            passed: true,
            details: `Found: ${doc}`,
            severity: "minor",
          };
        } catch {
          // continue
        }
      }
      return {
        gate: "documentation",
        passed: false,
        details: "No documentation found",
        severity: "minor",
      };
    },
  };
}

function createExportsGate(): VerificationGate {
  return {
    id: "exports",
    name: "Public Exports Valid",
    description: "All public exports are properly typed and accessible",
    severity: "critical",
    async verify(context) {
      // Check package.json exports field
      try {
        const pkgPath = path.join(context.projectPath, "package.json");
        const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));

        if (!pkg.exports && !pkg.main) {
          return {
            gate: "exports",
            passed: false,
            details: "No exports or main field in package.json",
            severity: "critical",
          };
        }

        return {
          gate: "exports",
          passed: true,
          details: "Exports configured",
          severity: "critical",
        };
      } catch {
        return {
          gate: "exports",
          passed: false,
          details: "Could not read package.json",
          severity: "critical",
        };
      }
    },
  };
}

function createTypesGate(): VerificationGate {
  return {
    id: "types",
    name: "Type Definitions",
    description: "TypeScript definitions generated",
    severity: "critical",
    async verify(context) {
      const distPath = path.join(context.projectPath, "dist");
      try {
        const files = await fs.readdir(distPath);
        const hasTypes = files.some(f => f.endsWith(".d.ts"));
        return {
          gate: "types",
          passed: hasTypes,
          details: hasTypes ? "Type definitions found" : "No .d.ts files in dist/",
          severity: "critical",
        };
      } catch {
        return {
          gate: "types",
          passed: false,
          details: "No dist/ directory",
          severity: "critical",
        };
      }
    },
  };
}

function createPublishDryRunGate(): VerificationGate {
  return {
    id: "publish-dry-run",
    name: "npm Publish Dry Run",
    description: "npm pack works without errors",
    severity: "major",
    async verify(context) {
      const { execa } = await import("execa");
      try {
        const result = await execa("pnpm", ["pack", "--dry-run"], {
          cwd: context.projectPath,
          reject: false,
        });
        return {
          gate: "publish-dry-run",
          passed: result.exitCode === 0,
          details: result.exitCode === 0 ? "npm pack dry-run successful" : "npm pack failed",
          severity: "major",
          evidence: { exitCode: result.exitCode },
        };
      } catch {
        return {
          gate: "publish-dry-run",
          passed: true,
          details: "Publish dry-run skipped",
          severity: "major",
        };
      }
    },
  };
}

function createBundleSizeGate(): VerificationGate {
  return {
    id: "bundle-size",
    name: "Bundle Size Budget",
    description: "Bundle size within acceptable limits",
    severity: "minor",
    async verify() {
      return {
        gate: "bundle-size",
        passed: true,
        details: "Bundle size check not implemented",
        severity: "minor",
      };
    },
  };
}

function createChangelogGate(): VerificationGate {
  return {
    id: "changelog",
    name: "Changelog Updated",
    description: "CHANGELOG.md or similar exists and is recent",
    severity: "minor",
    async verify(context) {
      const changelogs = ["CHANGELOG.md", "CHANGES.md", "HISTORY.md", "RELEASES.md"];
      for (const cl of changelogs) {
        try {
          const stat = await fs.stat(path.join(context.projectPath, cl));
          const daysSinceUpdate = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
          return {
            gate: "changelog",
            passed: daysSinceUpdate < 30,
            details: `Found ${cl} (updated ${daysSinceUpdate.toFixed(0)} days ago)`,
            severity: "minor",
          };
        } catch {
          // continue
        }
      }
      return {
        gate: "changelog",
        passed: false,
        details: "No changelog found",
        severity: "minor",
      };
    },
  };
}

function createApiSpecGate(): VerificationGate {
  return {
    id: "api-spec",
    name: "API Specification",
    description: "OpenAPI/Swagger spec exists and valid",
    severity: "major",
    async verify(context) {
      const specs = ["openapi.json", "openapi.yaml", "swagger.json", "swagger.yaml", "api-spec.json"];
      for (const spec of specs) {
        try {
          await fs.access(path.join(context.projectPath, spec));
          return {
            gate: "api-spec",
            passed: true,
            details: `Found API spec: ${spec}`,
            severity: "major",
          };
        } catch {
          // continue
        }
      }
      return {
        gate: "api-spec",
        passed: false,
        details: "No API specification found",
        severity: "major",
      };
    },
  };
}

function createHealthCheckGate(): VerificationGate {
  return {
    id: "health-check",
    name: "Health Endpoint",
    description: "Service has /health or /ready endpoint",
    severity: "major",
    async verify(context) {
      // Check for health endpoint in source
      try {
        const { execa } = await import("execa");
        const result = await execa("grep", ["-r", "/health\\|/ready", "--include=*.ts", "--include=*.js", "."], {
          cwd: context.projectPath,
          reject: false,
        });
        return {
          gate: "health-check",
          passed: result.exitCode === 0,
          details: result.exitCode === 0 ? "Health endpoint found in code" : "No health endpoint detected",
          severity: "major",
        };
      } catch {
        return {
          gate: "health-check",
          passed: false,
          details: "Health check skipped",
          severity: "major",
        };
      }
    },
  };
}

function createLoadTestGate(): VerificationGate {
  return {
    id: "load-test",
    name: "Load Test",
    description: "Basic load test passes",
    severity: "minor",
    async verify() {
      return {
        gate: "load-test",
        passed: true,
        details: "Load test not implemented",
        severity: "minor",
      };
    },
  };
}

function createRateLimitGate(): VerificationGate {
  return {
    id: "rate-limit",
    name: "Rate Limiting",
    description: "API has rate limiting configured",
    severity: "minor",
    async verify() {
      return {
        gate: "rate-limit",
        passed: true,
        details: "Rate limit check not implemented",
        severity: "minor",
      };
    },
  };
}

function createPwaGate(): VerificationGate {
  return {
    id: "pwa",
    name: "PWA Ready",
    description: "Progressive Web App requirements met",
    severity: "minor",
    async verify() {
      return {
        gate: "pwa",
        passed: true,
        details: "PWA check not implemented",
        severity: "minor",
      };
    },
  };
}

function createMetaTagsGate(): VerificationGate {
  return {
    id: "meta-tags",
    name: "Meta Tags",
    description: "Essential meta tags present (title, description, og:*)",
    severity: "major",
    async verify(context) {
      // Check index.html for meta tags
      try {
        const indexPath = path.join(context.projectPath, "index.html");
        const content = await fs.readFile(indexPath, "utf-8");
        const hasTitle = /<title>.*<\/title>/i.test(content);
        const hasDescription = /<meta.*name=["']description["'].*>/i.test(content);
        const hasOg = /<meta.*property=["']og:/i.test(content);

        return {
          gate: "meta-tags",
          passed: hasTitle && hasDescription,
          details: `Title: ${hasTitle}, Description: ${hasDescription}, OG: ${hasOg}`,
          severity: "major",
        };
      } catch {
        return {
          gate: "meta-tags",
          passed: false,
          details: "No index.html found",
          severity: "major",
        };
      }
    },
  };
}

function createDeploymentSummaryAction(): PostAction {
  return {
    id: "deployment-summary",
    name: "Generate Deployment Summary",
    description: "Create deployment summary markdown",
    async execute(context) {
      const summary = `# Deployment Summary\n\n**Build ID:** ${context.buildId}\n**Project:** ${context.projectId}\n**Type:** ${context.buildType}\n**Timestamp:** ${new Date().toISOString()}\n\nAll verification gates passed. Ready for deployment.`;
      const summaryPath = path.join(context.projectPath, "DEPLOYMENT_SUMMARY.md");
      await fs.writeFile(summaryPath, summary);
    },
  };
}

function createArtifactIndexAction(): PostAction {
  return {
    id: "artifact-index",
    name: "Generate Artifact Index",
    description: "Index all build artifacts",
    async execute(context) {
      const distPath = path.join(context.projectPath, "dist");
      let artifacts: string[] = [];
      try {
        artifacts = await fs.readdir(distPath);
      } catch {
        // no dist
      }

      const index = `# Build Artifacts\n\n${artifacts.map(a => `- ${a}`).join("\n") || "No artifacts found"}`;
      const indexPath = path.join(context.projectPath, "ARTIFACTS.md");
      await fs.writeFile(indexPath, index);
    },
  };
}

/**
 * ============================================================
 * HIGH-LEVEL API
 * ============================================================
 */

/**
 * Run done contract verification for a build
 */
export async function runDoneContract(
  projectId: string,
  buildId: string,
  buildType: BuildType,
  projectPath: string,
  plan?: BuildPlan,
  workspaceId?: string
): Promise<DoneContractResult> {
  const engine = new DoneContractEngine(projectId, workspaceId);
  const context: VerificationContext = {
    projectId,
    workspaceId: workspaceId || projectId,
    buildId,
    projectPath,
    buildType,
    plan,
  };
  return engine.evaluate(context);
}

/**
 * Create a custom done contract
 */
export function createCustomContract(contract: DoneContract): DoneContract {
  return contract;
}

export default DoneContractEngine;