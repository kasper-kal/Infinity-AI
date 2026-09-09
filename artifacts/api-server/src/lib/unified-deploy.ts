/**
 * Unified Deploy Service (Phase 12 — Multi-Artifact Support)
 *
 * Orchestrates deployment of ALL artifacts of a single project (web + mobile +
 * slides + api + cli + extension) as one coordinated action, aggregating per-
 * artifact status into a single Unified Deployment Dashboard model.
 *
 * Uses the existing `DeploymentEngine` for provider-specific deploys (Vercel,
 * Netlify, Cloudflare Pages, Railway, Fly.io, Render). For artifact types whose
 * primary target falls outside DeploymentEngine's providers (Expo/EAS, Chrome
 * Web Store, npm, Docker), the deployment is recorded as `manual` — deploy
 * config is prepared but the publish step is a manual action — so the dashboard
 * stays honest about per-artifact state.
 */

import { DeploymentEngine } from "./deployment-engine";
import { BUILTIN_ARTIFACT_TYPES, type ArtifactTypeDefinition } from "./artifact-types";

// ============================================================================
// Types
// ============================================================================

export type UnifiedArtifactStatus =
  | "queued"
  | "deploying"
  | "succeeded"
  | "failed"
  | "manual"
  | "skipped";

export interface UnifiedArtifactDeployment {
  artifactId: string;
  type: string;
  name: string;
  target: string;
  status: UnifiedArtifactStatus;
  url?: string;
  deploymentId?: string;
  error?: string;
  message?: string;
  logs: string[];
  startedAt?: string;
  completedAt?: string;
}

export type UnifiedDeploymentStatus = "pending" | "deploying" | "succeeded" | "partial" | "failed";

export interface UnifiedDeployment {
  id: string;
  projectId: string;
  projectPath: string;
  status: UnifiedDeploymentStatus;
  startedAt: string;
  completedAt?: string;
  artifacts: UnifiedArtifactDeployment[];
}

export interface UnifiedDeployRequest {
  projectId: string;
  projectPath: string;
  /** Optional subset; when omitted, deploys every built-in artifact type. */
  artifacts?: Array<{
    id?: string;
    type: string;
    name?: string;
    target?: string;
  }>;
}

// ============================================================================
// Framework / target mapping
// ============================================================================

/** Map DeploymentEngine hosting values to an App-like label for the dashboard. */
const HOSTING_LABELS: Record<string, string> = {
  vercel: "Vercel",
  netlify: "Netlify",
  "cloudflare-pages": "Cloudflare Pages",
  railway: "Railway",
  flyio: "Fly.io",
  render: "Render",
  custom: "Custom host",
};

/**
 * Map an artifact type's target to a DeploymentEngine hosting provider.
 * Returns `undefined` for targets that can't be deployed through the engine.
 */
function resolveHosting(artType: ArtifactTypeDefinition, target: string): string | undefined {
  const kind = artType.id;

  // Web-like artifacts map directly
  if (kind === "slide-deck" || kind === "website" || kind === "web-app" || kind === "api") {
    switch (target) {
      case "vercel": return "vercel";
      case "netlify": return "netlify";
      case "cloudflare": return "cloudflare-pages";
      case "self-hosted": return "custom";
      case "docker": return kind === "api" || kind === "web-app" ? "railway" : "custom";
      case "github-pages": return target === "github-pages" ? "custom" : undefined;
      default: return undefined;
    }
  }

  // Everything else publishes outside DeploymentEngine's providers.
  return undefined;
}

/**
 * Map an artifact type + framework to a DeploymentEngine framework string.
 */
function resolveFramework(artType: ArtifactTypeDefinition): string {
  // DeploymentEngine host frameworks: nextjs, astro, remix, vite-react, sveltekit, nuxt, solidstart
  switch (artType.id) {
    case "web-app": return "nextjs";
    case "website": return "astro";
    case "api": return "fastify" in artType ? (artType as any).framework ?? "hono" : "hono";
    case "slide-deck": return "vite-react";
    case "cli-tool": return "vite-react";
    case "chrome-extension": return "vite-react";
    case "mobile-app": return "vite-react";
    default: return "vite-react";
  }
}

// ============================================================================
// Service
// ============================================================================

const HOSTING_ENUM = ["vercel", "netlify", "cloudflare-pages", "railway", "flyio", "render", "custom"] as const;

class UnifiedDeployService {
  private deployments = new Map<string, UnifiedDeployment>();
  private engine = new DeploymentEngine();

  constructor() {
    // no-op
  }

  private static generateId(): string {
    return `udeploy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Kick off a unified deployment of a project's artifacts.
   * Runs each artifact's deploy concurrently (bounded) and aggregates status.
   */
  async deployProject(req: UnifiedDeployRequest): Promise<UnifiedDeployment> {
    const id = UnifiedDeployService.generateId();
    const startedAt = new Date().toISOString();

    const requested = req.artifacts && req.artifacts.length > 0
      ? req.artifacts
      : BUILTIN_ARTIFACT_TYPES.map((t) => ({ type: t.id, name: t.name, target: t.deployTargets[0] }));

    const artifacts: UnifiedArtifactDeployment[] = requested.map((a) => {
      const def = BUILTIN_ARTIFACT_TYPES.find((t) => t.id === a.type) || BUILTIN_ARTIFACT_TYPES[0];
      const target = a.target || def.deployTargets[0];
      return {
        artifactId: a.id || `artifact-${a.type}`,
        type: a.type,
        name: a.name || def.name,
        target,
        status: "queued",
        logs: [],
      };
    });

    const record: UnifiedDeployment = {
      id,
      projectId: req.projectId,
      projectPath: req.projectPath,
      status: "pending",
      startedAt,
      artifacts,
    };

    this.deployments.set(id, record);

    // Fire-and-forget execution (bounded concurrency = 2)
    void this.run(record);

    return record;
  }

  private async run(record: UnifiedDeployment): Promise<void> {
    record.status = "deploying";
    const queue = [...record.artifacts];
    const workers = Array.from({ length: Math.min(2, queue.length) }, () => this.worker(record, queue));
    await Promise.all(workers);

    const statuses = record.artifacts.map((a) => a.status);
    if (statuses.every((s) => s === "succeeded")) record.status = "succeeded";
    else if (statuses.some((s) => s === "failed")) record.status = record.artifacts.some((a) => a.status === "succeeded") ? "partial" : "failed";
    else if (statuses.some((s) => s === "deploying")) record.status = "deploying";
    else record.status = "partial"; // manual/skipped mix
    record.completedAt = new Date().toISOString();
  }

  private async worker(record: UnifiedDeployment, queue: UnifiedArtifactDeployment[]): Promise<void> {
    let item: UnifiedArtifactDeployment | undefined;
    while ((item = queue.shift())) {
      await this.deployArtifact(record, item);
    }
  }

  private async deployArtifact(record: UnifiedDeployment, item: UnifiedArtifactDeployment): Promise<void> {
    item.status = "deploying";
    item.startedAt = new Date().toISOString();
    const log = (msg: string) => item.logs.push(`[${new Date().toISOString()}] ${msg}`);

    try {
      const def = BUILTIN_ARTIFACT_TYPES.find((t) => t.id === item.type);
      const hosting = def ? resolveHosting(def, item.target) : undefined;

      if (!hosting) {
        // Target outside DeploymentEngine providers (Expo/EAS, Chrome Web Store,
        // npm, GitHub Pages, Docker API): config is prepared, publish is manual.
        item.status = "manual";
        item.message = `Artifact "${item.type}" targets ${item.target}, which publishes through external tooling (${item.target}). Deploy config prepared; complete the publish step manually (see artifact deployCommands).`;
        log(item.message);
      } else {
        const framework = resolveFramework(def!);
        const projectPath = item.type === "web-app"
          ? record.projectPath
          : `${record.projectPath}/artifacts/${item.type}`;

        const result = await this.engine.deploy({
          projectPath,
          framework: (HOSTING_ENUM as readonly string[]).includes(framework) ? framework as any : "vite-react",
          hosting: hosting as any,
          envVars: { PROJECT_ID: record.projectId },
          buildCommand: undefined,
          outputDirectory: undefined,
          installCommand: undefined,
          nodeVersion: undefined,
          githubRepo: undefined,
          previewDeployments: true,
        });

        log(result.logs.join("\n"));
        if (result.success) {
          item.status = "succeeded";
          item.url = result.url || result.previewUrl;
          item.deploymentId = result.deploymentId;
        } else {
          item.status = "failed";
          item.error = result.error || "Deployment failed";
        }
      }
    } catch (err: any) {
      item.status = "failed";
      item.error = err?.message || String(err);
      log(`ERROR: ${item.error}`);
    } finally {
      item.completedAt = new Date().toISOString();
    }
  }

  getDeployment(id: string): UnifiedDeployment | undefined {
    return this.deployments.get(id);
  }

  listDeployments(projectId: string): UnifiedDeployment[] {
    return [...this.deployments.values()]
      .filter((d) => d.projectId === projectId)
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  reset(): void {
    this.deployments.clear();
  }
}

/** Singleton */
let unifiedDeployService: UnifiedDeployService | undefined;
export function getUnifiedDeployService(): UnifiedDeployService {
  if (!unifiedDeployService) unifiedDeployService = new UnifiedDeployService();
  return unifiedDeployService;
}
export { UnifiedDeployService };