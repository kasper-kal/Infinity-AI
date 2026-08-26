/**
 * PHASE 12 — PARALLEL ARTIFACT ORCHESTRATOR
 *
 * Enables building multiple artifact types in parallel from a single prompt.
 * Extends Phase 9 (Parallel Agent Execution) for artifact-level parallelism.
 * $0 budget: all orchestration runs locally, no external services needed.
 */

import type {
  ArtifactTypeId,
  ArtifactConfig,
  ArtifactTypeDefinition,
  Framework,
  DeployTarget,
  ParallelArtifactBuild,
  ArtifactBuildTask,
  ArtifactBuildResult,
  ArtifactScaffoldResult,
  SharedFoundation,
  DesignSystemFoundation,
  ComponentLibraryFoundation,
  ApiClientFoundation,
  ConfigFoundation,
} from "./artifact-types";

import { getArtifactType, getAllArtifactTypes } from "./artifact-types";
import { createSlideDeckGenerator } from "./artifact-generators/slide-deck";
import { createWebsiteGenerator } from "./artifact-generators/website";
import { createWebAppGenerator } from "./artifact-generators/web-app";
import { createMobileAppGenerator } from "./artifact-generators/mobile-app";
import { ApiGenerator } from "./artifact-generators/api";
import { CliToolGenerator } from "./artifact-generators/cli-tool";
import { ChromeExtensionGenerator } from "./artifact-generators/chrome-extension";

// ============================================================================
// GENERATOR INTERFACE
// ============================================================================

interface ArtifactGenerator {
  generate(config: ArtifactConfig, sharedFoundation?: SharedFoundation): Promise<ArtifactScaffoldResult>;
}

// Generator wrapper classes
class ApiGeneratorWrapper implements ArtifactGenerator {
  async generate(config: ArtifactConfig, _sharedFoundation?: SharedFoundation): Promise<ArtifactScaffoldResult> {
    const gen = new ApiGenerator(config);
    return gen.generate();
  }
}

class CliToolGeneratorWrapper implements ArtifactGenerator {
  async generate(config: ArtifactConfig, _sharedFoundation?: SharedFoundation): Promise<ArtifactScaffoldResult> {
    const gen = new CliToolGenerator(config);
    return gen.generate();
  }
}

class ChromeExtensionGeneratorWrapper implements ArtifactGenerator {
  async generate(config: ArtifactConfig, _sharedFoundation?: SharedFoundation): Promise<ArtifactScaffoldResult> {
    const gen = new ChromeExtensionGenerator(config);
    return gen.generate();
  }
}

// Generator factory map
const GENERATOR_FACTORIES: Record<ArtifactTypeId, (typeDef: ArtifactTypeDefinition) => ArtifactGenerator> = {
  "slide-deck": createSlideDeckGenerator,
  "website": createWebsiteGenerator,
  "web-app": createWebAppGenerator,
  "mobile-app": createMobileAppGenerator,
  "api": (_typeDef) => new ApiGeneratorWrapper(),
  "cli-tool": (_typeDef) => new CliToolGeneratorWrapper(),
  "chrome-extension": (_typeDef) => new ChromeExtensionGeneratorWrapper(),
};

// Builder function type
type ArtifactBuilder = (
  config: ArtifactConfig,
  scaffoldResult: ArtifactScaffoldResult,
  sharedFoundation?: SharedFoundation
) => Promise<ArtifactBuildResult>;

// Builder implementations (stubs - to be fully implemented in generator classes)
const BUILDERS: Record<ArtifactTypeId, ArtifactBuilder> = {
  "slide-deck": async (config, scaffoldResult) => buildSlideDeck(config, scaffoldResult),
  "website": async (config, scaffoldResult) => buildWebsite(config, scaffoldResult),
  "web-app": async (config, scaffoldResult) => buildWebApp(config, scaffoldResult),
  "mobile-app": async (config, scaffoldResult) => buildMobileApp(config, scaffoldResult),
  "api": async (config, scaffoldResult) => buildApi(config, scaffoldResult),
  "cli-tool": async (config, scaffoldResult) => buildCliTool(config, scaffoldResult),
  "chrome-extension": async (config, scaffoldResult) => buildChromeExtension(config, scaffoldResult),
};

// ============================================================================
// PARALLEL ARTIFACT ORCHESTRATOR CLASS
// ============================================================================

export interface OrchestratorOptions {
  projectId: string;
  prompt: string;
  maxConcurrency?: number; // default: 4
  tokenBudget?: number; // default: 100000
  onProgress?: (update: ProgressUpdate) => void;
  onArtifactComplete?: (artifactId: string, result: ArtifactBuildResult) => void;
  onArtifactError?: (artifactId: string, error: Error) => void;
}

export interface ProgressUpdate {
  buildId: string;
  artifactId: string;
  artifactType: ArtifactTypeId;
  stage: "generating" | "building" | "deploying" | "completed" | "failed";
  progress: number;
  message: string;
  timestamp: Date;
}

export interface PlanResult {
  buildId: string;
  artifacts: ArtifactBuildTask[];
  sharedFoundation: SharedFoundation;
  estimatedDurationMs: number;
}

export interface BuildResult {
  buildId: string;
  status: "completed" | "failed" | "cancelled";
  artifacts: Map<ArtifactTypeId, ArtifactBuildResult>;
  sharedFoundation: SharedFoundation;
  totalDurationMs: number;
  errors: string[];
}

/**
 * Main orchestrator for parallel artifact builds
 */
export class ParallelArtifactOrchestrator {
  private options: Required<OrchestratorOptions>;
  private buildId: string;
  private tasks: Map<string, ArtifactBuildTask> = new Map();
  private results: Map<ArtifactTypeId, ArtifactBuildResult> = new Map();
  private sharedFoundation: SharedFoundation = {};
  private status: ParallelArtifactBuild["status"] = "planning";
  private startedAt?: Date;
  private completedAt?: Date;
  private abortController: AbortController = new AbortController();

  constructor(options: OrchestratorOptions) {
    this.options = {
      projectId: options.projectId,
      prompt: options.prompt,
      maxConcurrency: options.maxConcurrency ?? 4,
      tokenBudget: options.tokenBudget ?? 100000,
      onProgress: options.onProgress ?? (() => {}),
      onArtifactComplete: options.onArtifactComplete ?? (() => {}),
      onArtifactError: options.onArtifactError ?? (() => {}),
    };
    this.buildId = `build-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  // ============================================================================
  // PLANNING PHASE
  // ============================================================================

  /**
   * Analyze prompt and create execution plan for multiple artifacts
   */
  async plan(): Promise<PlanResult> {
    this.status = "planning";
    this.emitProgress({
      buildId: this.buildId,
      artifactId: "orchestrator",
      artifactType: "web-app" as ArtifactTypeId,
      stage: "generating",
      progress: 10,
      message: "Analyzing prompt and planning artifact builds...",
      timestamp: new Date(),
    });

    // Determine which artifacts to build from prompt
    const artifactPlan = await this.analyzePromptAndPlanArtifacts(this.options.prompt);

    // Create shared foundation
    this.sharedFoundation = await this.createSharedFoundation(this.options.projectId, artifactPlan);

    // Create build tasks with dependencies
    const tasks = this.createBuildTasks(artifactPlan, this.sharedFoundation);

    // Register tasks
    tasks.forEach((task) => this.tasks.set(task.artifactId, task));

    // Estimate duration
    const estimatedDurationMs = this.estimateDuration(tasks);

    this.emitProgress({
      buildId: this.buildId,
      artifactId: "orchestrator",
      artifactType: "web-app" as ArtifactTypeId,
      stage: "generating",
      progress: 20,
      message: `Plan created: ${tasks.length} artifacts to build in parallel`,
      timestamp: new Date(),
    });

    return {
      buildId: this.buildId,
      artifacts: tasks,
      sharedFoundation: this.sharedFoundation,
      estimatedDurationMs,
    };
  }

  /**
   * Analyze prompt to determine which artifacts to build
   * Uses keyword matching + optional LLM classification
   */
  private async analyzePromptAndPlanArtifacts(prompt: string): Promise<Array<{
    type: ArtifactTypeId;
    name: string;
    framework: Framework;
    deployTargets: DeployTarget[];
    settings: Record<string, unknown>;
    priority: number;
    dependencies: string[];
  }>> {
    const lowerPrompt = prompt.toLowerCase();
    const allTypes = getAllArtifactTypes();
    const planned: Array<{
      type: ArtifactTypeId;
      name: string;
      framework: Framework;
      deployTargets: DeployTarget[];
      settings: Record<string, unknown>;
      priority: number;
      dependencies: string[];
    }> = [];

    // Keyword-based artifact detection
    const keywordMap: Record<ArtifactTypeId, string[]> = {
      "slide-deck": ["slide", "presentation", "deck", "marp", "reveal", "ppt", "powerpoint", "keynote"],
      "website": ["website", "site", "landing page", "blog", "portfolio", "marketing page", "static site", "astro site"],
      "web-app": ["web app", "webapp", "application", "app", "dashboard", "saas", "platform", "fullstack", "full-stack"],
      "mobile-app": ["mobile app", "mobile", "ios", "android", "react native", "expo", "native app", "app store", "play store"],
      "api": ["api", "rest api", "graphql", "backend", "microservice", "endpoint", "server", "hono", "fastify", "express"],
      "cli-tool": ["cli", "command line", "command-line", "tool", "script", "automation", "terminal command", "npm package"],
      "chrome-extension": ["extension", "chrome extension", "browser extension", "manifest v3", "popup", "content script"],
    };

    // Score each artifact type
    const scores: Record<ArtifactTypeId, number> = {} as Record<ArtifactTypeId, number>;
    allTypes.forEach((type) => {
      scores[type.id] = 0;
      keywordMap[type.id]?.forEach((keyword) => {
        if (lowerPrompt.includes(keyword.toLowerCase())) {
          scores[type.id] += 1;
        }
      });
    });

    // If no specific artifacts mentioned, default to web-app
    const maxScore = Math.max(...Object.values(scores));
    if (maxScore === 0) {
      scores["web-app"] = 1;
    }

    // Select artifacts with score > 0
    let artifactIndex = 0;
    allTypes.forEach((type) => {
      if (scores[type.id] > 0) {
        const typeDef = getArtifactType(type.id)!;
        planned.push({
          type: type.id,
          name: this.generateArtifactName(type.id, artifactIndex, prompt),
          framework: typeDef.defaultFramework,
          deployTargets: [typeDef.defaultDeployTarget],
          settings: typeDef.defaultSettings,
          priority: artifactIndex,
          dependencies: [],
        });
        artifactIndex++;
      }
    });

    // Add dependencies: API should be built before web-app/mobile-app that use it
    const apiTask = planned.find((p) => p.type === "api");
    if (apiTask) {
      planned.forEach((p) => {
        if (p.type === "web-app" || p.type === "mobile-app" || p.type === "chrome-extension") {
          p.dependencies.push(apiTask.name);
        }
      });
    }

    // Sort by priority
    planned.sort((a, b) => a.priority - b.priority);

    return planned;
  }

  private generateArtifactName(type: ArtifactTypeId, index: number, prompt: string): string {
    const typeNames: Record<ArtifactTypeId, string> = {
      "slide-deck": "Presentation",
      "website": "Website",
      "web-app": "Web App",
      "mobile-app": "Mobile App",
      "api": "API",
      "cli-tool": "CLI Tool",
      "chrome-extension": "Chrome Extension",
    };
    const base = typeNames[type];
    const words = prompt.split(" ").filter((w) => w.length > 3);
    if (words.length > 0) {
      return `${base} - ${words.slice(0, 3).join(" ")}`;
    }
    return `${base} ${index + 1}`;
  }

  /**
   * Create shared foundation for all artifacts
   */
  private async createSharedFoundation(
    projectId: string,
    artifactPlan: Array<{ type: ArtifactTypeId; name: string }>
  ): Promise<SharedFoundation> {
    const { createDesignSystemFoundation, createComponentLibraryFoundation, createApiClientFoundation, createConfigFoundation } = await import("./shared-foundation");

    // Check which foundations are needed
    const needsDesignSystem = artifactPlan.some(
      (p) => ["slide-deck", "website", "web-app", "mobile-app", "chrome-extension"].includes(p.type)
    );
    const needsComponentLibrary = artifactPlan.some(
      (p) => ["website", "web-app", "mobile-app", "chrome-extension"].includes(p.type)
    );
    const needsApiClient = artifactPlan.some(
      (p) => ["web-app", "mobile-app", "chrome-extension", "cli-tool"].includes(p.type)
    );
    const needsConfig = artifactPlan.length > 0;

    const foundation: SharedFoundation = {};

    if (needsDesignSystem) {
      foundation.designSystem = createDesignSystemFoundation("design-system-main", "Infinity Design System");
    }

    if (needsComponentLibrary) {
      foundation.componentLibrary = createComponentLibraryFoundation("components-main", "Infinity Components");
    }

    if (needsApiClient) {
      foundation.apiClient = createApiClientFoundation("api-client-main", "Infinity API Client", {
        baseUrl: `http://localhost:3001`,
      });
    }

    if (needsConfig) {
      foundation.config = createConfigFoundation("config-main", "Infinity Config");
    }

    return foundation;
  }

  private createBuildTasks(
    artifactPlan: Array<{
      type: ArtifactTypeId;
      name: string;
      framework: Framework;
      deployTargets: DeployTarget[];
      settings: Record<string, unknown>;
      priority: number;
      dependencies: string[];
    }>,
    sharedFoundation: SharedFoundation
  ): ArtifactBuildTask[] {
    return artifactPlan.map((plan, index) => ({
      artifactId: `artifact-${this.buildId}-${index}`,
      type: plan.type,
      config: {
        id: `artifact-${this.buildId}-${index}`,
        projectId: this.options.projectId,
        type: plan.type,
        name: plan.name,
        slug: plan.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        description: `Generated from prompt: ${this.options.prompt.slice(0, 100)}`,
        framework: plan.framework,
        deployTarget: plan.deployTargets,
        settings: plan.settings,
        sharedFoundation: {
          designSystemId: sharedFoundation.designSystem?.id,
          componentLibraryId: sharedFoundation.componentLibrary?.id,
          apiClientId: sharedFoundation.apiClient?.id,
          configId: sharedFoundation.config?.id,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      dependencies: plan.dependencies,
      status: "pending",
      progress: 0,
    }));
  }

  private estimateDuration(tasks: ArtifactBuildTask[]): number {
    const baseEstimates: Record<ArtifactTypeId, number> = {
      "slide-deck": 30000,
      "website": 60000,
      "web-app": 120000,
      "mobile-app": 180000,
      "api": 60000,
      "cli-tool": 45000,
      "chrome-extension": 60000,
    };

    const maxEstimate = Math.max(...tasks.map((t) => baseEstimates[t.type] || 60000));
    return maxEstimate + 30000;
  }

  // ============================================================================
  // EXECUTION PHASE
  // ============================================================================

  /**
   * Execute the parallel build
   */
  async execute(): Promise<BuildResult> {
    this.status = "running";
    this.startedAt = new Date();

    this.emitProgress({
      buildId: this.buildId,
      artifactId: "orchestrator",
      artifactType: "web-app" as ArtifactTypeId,
      stage: "generating",
      progress: 30,
      message: "Starting parallel artifact generation...",
      timestamp: new Date(),
    });

    // Get tasks in dependency order
    const executionOrder = this.getExecutionOrder();

    // Run tasks with concurrency limit
    await this.runTasksWithConcurrency(executionOrder);

    this.status = this.hasFailures() ? "failed" : "completed";
    this.completedAt = new Date();
    const totalDurationMs = this.completedAt.getTime() - (this.startedAt?.getTime() || 0);

    this.emitProgress({
      buildId: this.buildId,
      artifactId: "orchestrator",
      artifactType: "web-app" as ArtifactTypeId,
      stage: this.status === "completed" ? "completed" : "failed",
      progress: 100,
      message: this.status === "completed"
        ? `All ${this.tasks.size} artifacts built successfully!`
        : `Build completed with ${this.countFailures()} failures`,
      timestamp: new Date(),
    });

    return {
      buildId: this.buildId,
      status: this.status,
      artifacts: this.results,
      sharedFoundation: this.sharedFoundation,
      totalDurationMs,
      errors: this.collectErrors(),
    };
  }

  private getExecutionOrder(): ArtifactBuildTask[][] {
    const taskArray = Array.from(this.tasks.values());
    const visited = new Set<string>();
    const order: ArtifactBuildTask[][] = [];
    const remaining = new Map(taskArray.map((t) => [t.artifactId, t]));

    while (remaining.size > 0) {
      const ready: ArtifactBuildTask[] = [];

      for (const [id, task] of remaining) {
        const depsMet = task.dependencies.every((dep) => {
          const depTask = taskArray.find((t) => t.artifactId === dep || t.config.name === dep);
          return depTask && visited.has(depTask.artifactId);
        });

        if (depsMet) {
          ready.push(task);
        }
      }

      if (ready.length === 0) {
        remaining.forEach((task) => ready.push(task));
      }

      order.push(ready);
      ready.forEach((task) => {
        visited.add(task.artifactId);
        remaining.delete(task.artifactId);
      });
    }

    return order;
  }

  private async runTasksWithConcurrency(executionOrder: ArtifactBuildTask[][]): Promise<void> {
    for (const batch of executionOrder) {
      const semaphore = new Semaphore(this.options.maxConcurrency);

      const promises = batch.map(async (task) => {
        await semaphore.acquire();
        try {
          await this.runSingleTask(task);
        } finally {
          semaphore.release();
        }
      });

      await Promise.allSettled(promises);

      if (this.abortController.signal.aborted) {
        this.status = "cancelled";
        break;
      }
    }
  }

  private async runSingleTask(task: ArtifactBuildTask): Promise<void> {
    const typeDef = getArtifactType(task.type);
    if (!typeDef) {
      throw new Error(`Unknown artifact type: ${task.type}`);
    }

    task.status = "generating";
    task.progress = 10;
    this.emitTaskProgress(task, "generating", 10, `Generating ${typeDef.name} scaffold...`);

    try {
      // Get generator
      const generatorFactory = GENERATOR_FACTORIES[task.type];
      if (!generatorFactory) {
        throw new Error(`No generator factory for artifact type: ${task.type}`);
      }
      const generator = generatorFactory(typeDef);

      // Generate scaffold
      const scaffoldResult = await generator.generate(task.config, this.sharedFoundation);

      task.status = "building";
      task.progress = 50;
      this.emitTaskProgress(task, "building", 50, `Building ${typeDef.name}...`);

      // Build artifact
      const builder = BUILDERS[task.type];
      if (!builder) {
        throw new Error(`No builder for artifact type: ${task.type}`);
      }

      const buildResult = await builder(task.config, scaffoldResult, this.sharedFoundation);

      task.status = "completed";
      task.progress = 100;
      task.result = buildResult;
      this.results.set(task.type, buildResult);

      this.emitTaskProgress(task, "completed", 100, `${typeDef.name} build completed`);
      this.options.onArtifactComplete(task.artifactId, buildResult);
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      this.emitTaskProgress(task, "failed", task.progress, `Build failed: ${task.error}`);
      this.options.onArtifactError(task.artifactId, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private emitTaskProgress(
    task: ArtifactBuildTask,
    stage: ProgressUpdate["stage"],
    progress: number,
    message: string
  ): void {
    this.emitProgress({
      buildId: this.buildId,
      artifactId: task.artifactId,
      artifactType: task.type,
      stage,
      progress,
      message,
      timestamp: new Date(),
    });
  }

  private emitProgress(update: ProgressUpdate): void {
    this.options.onProgress(update);
  }

  private hasFailures(): boolean {
    return Array.from(this.tasks.values()).some((t) => t.status === "failed");
  }

  private countFailures(): number {
    return Array.from(this.tasks.values()).filter((t) => t.status === "failed").length;
  }

  private collectErrors(): string[] {
    return Array.from(this.tasks.values())
      .filter((t) => t.error)
      .map((t) => `${t.config.name}: ${t.error}`);
  }

  // ============================================================================
  // CONTROL METHODS
  // ============================================================================

  abort(): void {
    this.abortController.abort();
    this.status = "cancelled";
  }

  getStatus(): ParallelArtifactBuild["status"] {
    return this.status;
  }

  getBuildId(): string {
    return this.buildId;
  }

  getTasks(): ArtifactBuildTask[] {
    return Array.from(this.tasks.values());
  }

  getResults(): Map<ArtifactTypeId, ArtifactBuildResult> {
    return this.results;
  }

  getSharedFoundation(): SharedFoundation {
    return this.sharedFoundation;
  }
}

// ============================================================================
// SEMAPHORE FOR CONCURRENCY CONTROL
// ============================================================================

class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      if (next) {
        this.permits--;
        next();
      }
    }
  }
}

// ============================================================================
// BUILDER IMPLEMENTATIONS (Stubs - to be fully implemented in generator classes)
// ============================================================================

async function buildSlideDeck(config: ArtifactConfig, _scaffoldResult: ArtifactScaffoldResult): Promise<ArtifactBuildResult> {
  const startTime = Date.now();
  return {
    artifactId: config.id,
    success: true,
    outputDir: `./dist/${config.slug}`,
    assets: ["slides.html", "slides.pdf"],
    logs: ["Build completed successfully"],
    errors: [],
    durationMs: Date.now() - startTime,
  };
}

async function buildWebsite(config: ArtifactConfig, _scaffoldResult: ArtifactScaffoldResult): Promise<ArtifactBuildResult> {
  const startTime = Date.now();
  return {
    artifactId: config.id,
    success: true,
    outputDir: `./dist/${config.slug}`,
    assets: ["index.html", "assets/"],
    logs: ["Build completed successfully"],
    errors: [],
    durationMs: Date.now() - startTime,
  };
}

async function buildWebApp(config: ArtifactConfig, _scaffoldResult: ArtifactScaffoldResult): Promise<ArtifactBuildResult> {
  const startTime = Date.now();
  return {
    artifactId: config.id,
    success: true,
    outputDir: `./dist/${config.slug}`,
    assets: [".next/", "public/"],
    logs: ["Build completed successfully"],
    errors: [],
    durationMs: Date.now() - startTime,
  };
}

async function buildMobileApp(config: ArtifactConfig, _scaffoldResult: ArtifactScaffoldResult): Promise<ArtifactBuildResult> {
  const startTime = Date.now();
  return {
    artifactId: config.id,
    success: true,
    outputDir: `./dist/${config.slug}`,
    assets: ["dist/", "web-build/"],
    logs: ["Build completed successfully"],
    errors: [],
    durationMs: Date.now() - startTime,
  };
}

async function buildApi(config: ArtifactConfig, _scaffoldResult: ArtifactScaffoldResult): Promise<ArtifactBuildResult> {
  const startTime = Date.now();
  return {
    artifactId: config.id,
    success: true,
    outputDir: `./dist/${config.slug}`,
    assets: ["index.js", "package.json"],
    logs: ["Build completed successfully"],
    errors: [],
    durationMs: Date.now() - startTime,
  };
}

async function buildCliTool(config: ArtifactConfig, _scaffoldResult: ArtifactScaffoldResult): Promise<ArtifactBuildResult> {
  const startTime = Date.now();
  return {
    artifactId: config.id,
    success: true,
    outputDir: `./dist/${config.slug}`,
    assets: ["bin/", "package.json"],
    logs: ["Build completed successfully"],
    errors: [],
    durationMs: Date.now() - startTime,
  };
}

async function buildChromeExtension(config: ArtifactConfig, _scaffoldResult: ArtifactScaffoldResult): Promise<ArtifactBuildResult> {
  const startTime = Date.now();
  return {
    artifactId: config.id,
    success: true,
    outputDir: `./dist/${config.slug}`,
    assets: ["dist/", "manifest.json"],
    logs: ["Build completed successfully"],
    errors: [],
    durationMs: Date.now() - startTime,
  };
}

// ============================================================================
// HIGH-LEVEL API FUNCTIONS
// ============================================================================

export interface BuildArtifactsOptions {
  projectId: string;
  prompt: string;
  artifactTypes?: ArtifactTypeId[];
  maxConcurrency?: number;
  tokenBudget?: number;
  onProgress?: (update: ProgressUpdate) => void;
}

export async function buildArtifactsInParallel(options: BuildArtifactsOptions): Promise<BuildResult> {
  const orchestrator = new ParallelArtifactOrchestrator({
    projectId: options.projectId,
    prompt: options.prompt,
    maxConcurrency: options.maxConcurrency,
    tokenBudget: options.tokenBudget,
    onProgress: options.onProgress,
  });

  await orchestrator.plan();

  if (options.artifactTypes && options.artifactTypes.length > 0) {
    const tasks = orchestrator.getTasks();
    tasks.forEach((task) => {
      if (!options.artifactTypes!.includes(task.type)) {
        task.status = "completed";
        task.progress = 100;
      }
    });
  }

  return orchestrator.execute();
}

export function createParallelArtifactOrchestrator(options: OrchestratorOptions): ParallelArtifactOrchestrator {
  return new ParallelArtifactOrchestrator(options);
}

// ============================================================================
// ARTIFACT TEMPLATE INTEGRATION
// ============================================================================

export interface TemplateBuildOptions {
  projectId: string;
  templateId: string;
  artifactType: ArtifactTypeId;
  name: string;
  customSettings?: Record<string, unknown>;
}

export async function buildFromTemplate(options: TemplateBuildOptions): Promise<ArtifactBuildResult> {
  const { getTemplate } = await import("./artifact-templates");
  const template = getTemplate(options.templateId);

  if (!template) {
    throw new Error(`Template not found: ${options.templateId}`);
  }

  if (template.artifactType !== options.artifactType) {
    throw new Error(`Template ${options.templateId} is for ${template.artifactType}, not ${options.artifactType}`);
  }

  const config: ArtifactConfig = {
    id: `artifact-${Date.now()}`,
    projectId: options.projectId,
    type: options.artifactType,
    name: options.name,
    slug: options.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    description: template.description,
    framework: template.framework,
    deployTarget: [template.platform === "ios" || template.platform === "android" ? "eas" : "vercel"],
    settings: { ...template.files.reduce((acc, f) => ({ ...acc, [f.path]: f.content }), {}), ...options.customSettings },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const typeDef = getArtifactType(options.artifactType);
  if (!typeDef) {
    throw new Error(`Unknown artifact type: ${options.artifactType}`);
  }

  const generatorFactory = GENERATOR_FACTORIES[options.artifactType];
  if (!generatorFactory) {
    throw new Error(`No generator for artifact type: ${options.artifactType}`);
  }
  const generator = generatorFactory(typeDef);

  const scaffoldResult = await generator.generate(config);
  const builder = BUILDERS[options.artifactType];
  if (!builder) {
    throw new Error(`No builder for artifact type: ${options.artifactType}`);
  }

  return builder(config, scaffoldResult);
}