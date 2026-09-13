/**
 * Deployment Engine — Zero-Config Automated Deployment
 *
 * Deploys to Vercel, Netlify, Cloudflare Pages, Railway, Fly.io, Render.
 * Handles: framework detection, config generation, env vars, custom domains, SSL, health checks.
 */

import { z } from "zod";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { LLMAdapter, getLLMAdapter } from "./llm-adapter.js";
import { FrameworkRegistry } from "./framework-generators/index.js";
import { emitDeploymentEvent } from "./safety-watcher";

// ============================================
// Types & Schemas
// ============================================

export const DeployConfigSchema = z.object({
  projectPath: z.string(),
  framework: z.enum(["nextjs", "astro", "remix", "vite-react", "sveltekit", "nuxt", "solidstart"]),
  hosting: z.enum(["vercel", "netlify", "cloudflare-pages", "railway", "flyio", "render", "custom"]),
  envVars: z.record(z.string()).default({}),
  customDomain: z.string().optional(),
  buildCommand: z.string().optional(),
  outputDirectory: z.string().optional(),
  installCommand: z.string().optional(),
  nodeVersion: z.string().optional(),
  regions: z.array(z.string()).optional(),
  githubRepo: z.string().optional(), // owner/repo
  previewDeployments: z.boolean().default(true),
});

export const DeployResultSchema = z.object({
  success: z.boolean(),
  url: z.string().optional(),
  deploymentId: z.string().optional(),
  error: z.string().optional(),
  logs: z.array(z.string()).default([]),
  previewUrl: z.string().optional(),
});

export const HealthCheckResultSchema = z.object({
  healthy: z.boolean(),
  checks: z.array(z.object({
    name: z.string(),
    url: z.string(),
    status: z.number(),
    latencyMs: z.number(),
    passed: z.boolean(),
  })),
  error: z.string().optional(),
});

export type DeployConfig = z.infer<typeof DeployConfigSchema>;
export type DeployResult = z.infer<typeof DeployResultSchema>;
export type HealthCheckResult = z.infer<typeof HealthCheckResultSchema>;

// ============================================
// Deployment Engine Class
// ============================================

export class DeploymentEngine {
  private adapter: LLMAdapter;

  constructor(adapter?: LLMAdapter) {
    this.adapter = adapter || getLLMAdapter();
  }

  // ============================================
  // Main Deploy Method
  // ============================================

  async deploy(config: DeployConfig): Promise<DeployResult> {
    const logs: string[] = [];
    const log = (msg: string) => {
      logs.push(`[${new Date().toISOString()}] ${msg}`);
      console.log(msg);
    };

    // Emit deployment started event
    try {
      await emitDeploymentEvent({
        projectId: config.envVars.PROJECT_ID || "default",
        deploymentId: `deploy-${Date.now()}`,
        status: "started",
        provider: config.hosting,
        url: undefined,
      });
    } catch (e) {
      console.error("Failed to emit deployment safety event:", e);
    }

    try {
      log(`Starting deployment to ${config.hosting} for ${config.framework} project`);

      // 1. Detect/validate framework
      const frameworkAdapter = FrameworkRegistry.get(config.framework);
      if (!frameworkAdapter) {
        throw new Error(`Framework ${config.framework} not supported`);
      }

      // 2. Generate deployment config for the hosting provider
      const deployConfig = await this.generateDeployConfig(config, frameworkAdapter);
      log(`Generated ${config.hosting} config`);

      // 3. Write config files to project
      await this.writeDeployConfig(config.projectPath, config.hosting, deployConfig);
      log(`Wrote deployment config files`);

      // 4. Execute deployment based on provider
      let result: DeployResult;

      switch (config.hosting) {
        case "vercel":
          result = await this.deployToVercel(config, log);
          break;
        case "netlify":
          result = await this.deployToNetlify(config, log);
          break;
        case "cloudflare-pages":
          result = await this.deployToCloudflarePages(config, log);
          break;
        case "railway":
          result = await this.deployToRailway(config, log);
          break;
        case "flyio":
          result = await this.deployToFlyio(config, log);
          break;
        case "render":
          result = await this.deployToRender(config, log);
          break;
        default:
          throw new Error(`Hosting provider ${config.hosting} not implemented`);
      }

      result.logs = logs;

      // Emit deployment completed/failed event
      try {
        await emitDeploymentEvent({
          projectId: config.envVars.PROJECT_ID || "default",
          deploymentId: `deploy-${Date.now()}`,
          status: result.success ? "completed" : "failed",
          provider: config.hosting,
          url: result.url,
          error: result.error,
        });
      } catch (e) {
        console.error("Failed to emit deployment safety event:", e);
      }

      return result;
    } catch (error) {
      log(`Deployment failed: ${error}`);

      // Emit deployment failed event
      try {
        await emitDeploymentEvent({
          projectId: config.envVars.PROJECT_ID || "default",
          deploymentId: `deploy-${Date.now()}`,
          status: "failed",
          provider: config.hosting,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch (e) {
        console.error("Failed to emit deployment safety event:", e);
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        logs,
      };
    }
  }

  // ============================================
  // Generate Provider-Specific Config
  // ============================================

  private async generateDeployConfig(config: DeployConfig, frameworkAdapter: any): Promise<any> {
    const prompt = `Generate deployment configuration for ${config.hosting}.

FRAMEWORK: ${config.framework}
PROJECT PATH: ${config.projectPath}
ENV VARS: ${JSON.stringify(Object.keys(config.envVars), null, 2)}
CUSTOM DOMAIN: ${config.customDomain || "none"}
BUILD COMMAND: ${config.buildCommand || "auto-detect"}
OUTPUT DIRECTORY: ${config.outputDirectory || "auto-detect"}

Generate the appropriate config file(s) for ${config.hosting}:
- vercel: vercel.json
- netlify: netlify.toml
- cloudflare-pages: wrangler.toml / _redirects / _headers
- railway: railway.toml / nixpacks.toml
- flyio: fly.toml / Dockerfile
- render: render.yaml

Return JSON with config files as { "filename": "content" }.`;

    const response = await this.adapter.complete({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      maxTokens: 3000,
      responseFormat: { type: "json_object" },
    });

    return JSON.parse(response.content);
  }

  // ============================================
  // Write Config Files
  // ============================================

  private async writeDeployConfig(projectPath: string, hosting: string, config: Record<string, string>): Promise<void> {
    const fs = await import("fs/promises");
    const path = await import("path");

    for (const [filename, content] of Object.entries(config)) {
      const filePath = path.join(projectPath, filename);
      await fs.writeFile(filePath, content, "utf-8");
    }
  }

  // ============================================
  // Provider-Specific Deployments
  // ============================================

  /**
   * Honest manual handoff (Phase 0 FIX): any deploy path we do NOT automate
   * returns success:false with exact human (or CLI) instructions — it NEVER
   * fabricates success or an invented production URL. The caller surfaces the
   * error text to the user as the handoff.
   */
  private manualHandoff(
    provider: string,
    needs: string,
    instructions: string,
    log: (msg: string) => string
  ): DeployResult {
    const detail = `Deploy to ${provider} requires a manual step: ${needs}. ${instructions}`;
    log(detail);
    return {
      success: false,
      error: detail,
      deploymentId: `manual-${provider}-${Date.now()}`,
      logs: [],
    };
  }

  private async deployToVercel(config: DeployConfig, log: (msg: string) => string): Promise<DeployResult> {
    log("Deploying to Vercel...");

    // Check for Vercel CLI or use API
    const hasVercelToken = process.env.VERCEL_TOKEN || config.envVars.VERCEL_TOKEN;
    const hasVercelOrg = process.env.VERCEL_ORG_ID || config.envVars.VERCEL_ORG_ID;
    const hasVercelProject = process.env.VERCEL_PROJECT_ID || config.envVars.VERCEL_PROJECT_ID;

    if (!hasVercelToken) {
      // Try Vercel CLI
      log("No Vercel token found, attempting Vercel CLI...");
      return this.runVercelCLI(config, log);
    }

    // Use Vercel API — REAL deploy (Phase 0 FIX: was a fabricated success).
    log("Using Vercel API...");
    return this.deployViaVercelAPI(config, log);
  }

  private runVercelCLI(config: DeployConfig, log: (msg: string) => string): Promise<DeployResult> {
    const { spawn } = require("child_process") as typeof import("child_process");

    return new Promise((resolve) => {
      const args = ["--prod", "--yes"];
      if (config.customDomain) {
        args.push("--domain", config.customDomain);
      }
      const cliToken = process.env.VERCEL_TOKEN || config.envVars.VERCEL_TOKEN;
      if (cliToken) args.push("--token", cliToken);

      const child = spawn("npx", ["vercel", ...args], {
        cwd: config.projectPath,
        env: { ...process.env, ...config.envVars },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
        log(`vercel: ${data.toString().trim()}`);
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
        log(`vercel error: ${data.toString().trim()}`);
      });

      // Guard against a headless login prompt hanging the deploy forever.
      const kill = setTimeout(() => {
        child.kill("SIGKILL");
        resolve({ success: false, error: "Vercel CLI timed out (likely a login prompt) — set VERCEL_TOKEN to deploy via CLI in automation, and run `npx vercel login` once locally", logs: [] });
      }, 180_000);

      child.on("close", (code) => {
        clearTimeout(kill);
        if (code === 0) {
          // Extract URL from output — if the CLI printed none, return "" (honest),
          // never an invented .vercel.app URL (Phase 0 FIX).
          const urlMatch = stdout.match(/https:\/\/[^\s]+\.vercel\.app/);
          resolve({
            success: true,
            url: urlMatch?.[0] || "",
            deploymentId: `vercel-${Date.now()}`,
            logs: [],
          });
        } else {
          resolve({
            success: false,
            error: stderr || `Vercel CLI exited with code ${code}`,
            logs: [],
          });
        }
      });

      child.on("error", (err) => {
        clearTimeout(kill);
        resolve({
          success: false,
          error: `Failed to run Vercel CLI: ${err.message}`,
          logs: [],
        });
      });
    });
  }

  /** Map our internal framework ids to Vercel's projectSettings.framework enum. */
  private vercelFramework(config: DeployConfig): string | undefined {
    const map: Record<string, string> = {
      nextjs: "nextjs",
      astro: "astro",
      remix: "remix",
      "vite-react": "vite",
      sveltekit: "sveltekit",
      nuxt: "nuxt",
      solidstart: "solidstart",
    };
    return map[config.framework];
  }

  private async vercelAPIDeploy(config: DeployConfig, log: (msg: string) => string): Promise<DeployResult> {
    const token = process.env.VERCEL_TOKEN || config.envVars.VERCEL_TOKEN;
    const base = "https://api.vercel.com";

    // 1. Walk the project SOURCE tree (Vercel builds remotely; never upload
    //    node_modules / generated output).
    const files: Record<string, { file: string }> = {};
    let payloadBytes = 0;
    const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024; // Vercel API JSON-deploy limit is ~5MB
    const SKIP_DIRS = new Set(["node_modules", ".git", ".infinity", "dist", "build", "out", ".next", ".vercel", ".turbo", ".output", ".cache", "coverage"]);
    const SKIP_FILES = new Set([".DS_Store"]);

    async function walk(dir: string): Promise<void> {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        if (SKIP_DIRS.has(ent.name)) continue;
        if (SKIP_FILES.has(ent.name)) continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          await walk(full);
        } else if (ent.isFile()) {
          const rel = path.relative(config.projectPath, full).split(path.sep).join("/");
          const data = await fs.readFile(full);
          if (data.byteLength > 10 * 1024 * 1024) continue; // skip huge binaries
          const encoded = data.toString("base64");
          payloadBytes += encoded.length;
          files[rel] = { file: encoded };
        }
      }
    }
    await walk(config.projectPath);

    if (Object.keys(files).length === 0) {
      return { success: false, error: "No source files found to deploy", logs: [] };
    }
    if (payloadBytes > MAX_PAYLOAD_BYTES) {
      return this.manualHandoff(
        "Vercel",
        `project is too large for the API upload (~${Math.round(payloadBytes / 1024 / 1024)}MB base64 > 4MB)`,
        "Run locally: `npx vercel --prod --yes` from the project, or push the repo to GitHub and import it into Vercel.",
        log
      );
    }

    // 2. Create the deployment.
    log(`Uploading ${Object.keys(files).length} source files (${Math.round(payloadBytes / 1024)}KB) to Vercel...`);
    const createResp = await fetch(`${base}/v13/deployments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files,
        name: config.projectPath.split("/").pop() || "infinity-app",
        projectSettings: this.vercelFramework(config) ? { framework: this.vercelFramework(config) } : undefined,
        ...(config.envVars.PROJECT_ID && config.envVars.VERCEL_PROJECT_ID
          ? { projectId: config.envVars.VERCEL_PROJECT_ID }
          : {}),
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const createBody: any = await createResp.json().catch(() => ({}));
    if (!createResp.ok) {
      return {
        success: false,
        error: `Vercel API rejected the deployment (HTTP ${createResp.status}): ${JSON.stringify(createBody.error || createBody).slice(0, 400)}`,
        logs: [],
      };
    }
    const deploymentId: string | undefined = createBody.id;
    if (!deploymentId) {
      return { success: false, error: "Vercel API returned no deployment id", logs: [] };
    }
    log(`Vercel deployment ${deploymentId} created, waiting for READY...`);

    // 3. Poll until READY or ERROR.
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      const statusResp = await fetch(`${base}/v13/deployments/${deploymentId}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
      const status: any = await statusResp.json().catch(() => ({}));
      if (!statusResp.ok) {
        return { success: false, error: `Vercel API status check failed (HTTP ${statusResp.status})`, deploymentId, logs: [] };
      }
      const state: string = status.readyState || status.status || "";
      log(`  vercel state: ${state}`);
      if (state === "READY") {
        const url = status.url ? `https://${status.url}` : "";
        return { success: true, url, deploymentId, logs: [] };
      }
      if (state === "ERROR" || state === "CANCELED") {
        return {
          success: false,
          error: `Vercel build failed: ${status.error?.message || JSON.stringify(status).slice(0, 400)}`,
          deploymentId,
          logs: [],
        };
      }
    }
    return { success: false, error: `Vercel deployment ${deploymentId} did not finish within ~2 minutes (still building)`, deploymentId, logs: [] };
  }

  private async deployViaVercelAPI(config: DeployConfig, log: (msg: string) => string): Promise<DeployResult> {
    try {
      return await this.vercelAPIDeploy(config, log);
    } catch (e) {
      return { success: false, error: `Vercel API deploy failed: ${e instanceof Error ? e.message : String(e)}`, logs: [] };
    }
  }

  private async deployToNetlify(config: DeployConfig, log: (msg: string) => string): Promise<DeployResult> {
    log("Deploying to Netlify...");

    const hasNetlifyToken = process.env.NETLIFY_AUTH_TOKEN || config.envVars.NETLIFY_AUTH_TOKEN;

    if (!hasNetlifyToken) {
      log("No Netlify token, attempting Netlify CLI...");
      return this.runNetlifyCLI(config, log);
    }

    log("Using Netlify API...");
    // Phase 0 FIX: the Netlify API upload flow (create deploy → per-file digest
    // PUTs → blob uploads) is not implemented — fabricating success was a lie.
    // Honest handoff back to the real CLI path, which requires local auth.
    return this.manualHandoff(
      "Netlify",
      "the API upload flow is not automated",
      "Run locally from the project: `npx netlify deploy --prod --dir <output-directory>`, or push the repo to GitHub and connect it in netlify.com. An authenticated `NETLIFY_AUTH_TOKEN` alone is not sufficient — the CLI also needs a linked site.",
      log
    );
  }

  private async runNetlifyCLI(config: DeployConfig, log: (msg: string) => string): Promise<DeployResult> {
    const { spawn } = await import("child_process");

    return new Promise((resolve) => {
      const child = spawn("npx", ["netlify", "deploy", "--prod", "--dir", config.outputDirectory || "dist"], {
        cwd: config.projectPath,
        env: { ...process.env, ...config.envVars },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
        log(`netlify: ${data.toString().trim()}`);
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
        log(`netlify error: ${data.toString().trim()}`);
      });

      child.on("close", (code) => {
        if (code === 0) {
          const urlMatch = stdout.match(/https:\/\/[^\s]+\.netlify\.app/);
          resolve({
            success: true,
            url: urlMatch?.[0] || "",
            deploymentId: `netlify-${Date.now()}`,
            logs: [],
          });
        } else {
          resolve({
            success: false,
            error: stderr || `Netlify CLI exited with code ${code}`,
            logs: [],
          });
        }
      });
    });
  }

  private async deployToCloudflarePages(config: DeployConfig, log: (msg: string) => string): Promise<DeployResult> {
    log("Deploying to Cloudflare Pages...");

    const hasCfToken = process.env.CLOUDFLARE_API_TOKEN || config.envVars.CLOUDFLARE_API_TOKEN;
    const hasCfAccount = process.env.CLOUDFLARE_ACCOUNT_ID || config.envVars.CLOUDFLARE_ACCOUNT_ID;

    if (!hasCfToken || !hasCfAccount) {
      log("No Cloudflare credentials, attempting Wrangler CLI...");
      return this.runWranglerCLI(config, log);
    }

    log("Using Cloudflare API...");
    // Phase 0 FIX: Direct-Upload API (multipart + upload tokens) not automated;
    // fabricating success was a lie. Honest handoff to the real Wrangler CLI.
    return this.manualHandoff(
      "Cloudflare Pages",
      "the Direct Upload API flow is not automated",
      "Run locally from the project: `npx wrangler pages deploy <output-directory> --project-name <name>`, then `npx wrangler pages project create --project-name <name> --production-branch main` if needed.",
      log
    );
  }

  private async runWranglerCLI(config: DeployConfig, log: (msg: string) => string): Promise<DeployResult> {
    const { spawn } = await import("child_process");

    return new Promise((resolve) => {
      const args = ["pages", "deploy", config.outputDirectory || "dist", "--project-name", config.projectPath.split("/").pop() || "app"];
      const cfToken = process.env.CLOUDFLARE_API_TOKEN || config.envVars.CLOUDFLARE_API_TOKEN;
      if (cfToken) args.push("--api-token", cfToken);
      const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID || config.envVars.CLOUDFLARE_ACCOUNT_ID;
      if (cfAccount) args.push("--account-id", cfAccount);

      const child = spawn("npx", ["wrangler", ...args], {
        cwd: config.projectPath,
        env: { ...process.env, ...config.envVars },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
        log(`wrangler: ${data.toString().trim()}`);
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
        log(`wrangler error: ${data.toString().trim()}`);
      });

      // Guard against a headless login prompt hanging the deploy forever.
      const kill = setTimeout(() => {
        child.kill("SIGKILL");
        resolve({ success: false, error: "Wrangler CLI timed out (likely a login prompt) — set CLOUDFLARE_API_TOKEN to deploy via CLI in automation, and run `npx wrangler login` once locally", logs: [] });
      }, 180_000);

      child.on("close", (code) => {
        clearTimeout(kill);
        if (code === 0) {
          // Extract URL from output — if the CLI printed none, return "" (honest),
          // never an invented .pages.dev URL (Phase 0 FIX).
          const urlMatch = stdout.match(/https:\/\/[^\s]+\.pages\.dev/);
          resolve({
            success: true,
            url: urlMatch?.[0] || "",
            deploymentId: `cf-pages-${Date.now()}`,
            logs: [],
          });
        } else {
          resolve({
            success: false,
            error: stderr || `Wrangler CLI exited with code ${code}`,
            logs: [],
          });
        }
      });

      child.on("error", (err) => {
        clearTimeout(kill);
        resolve({
          success: false,
          error: `Failed to run Wrangler CLI: ${err.message}`,
          logs: [],
        });
      });
    });
  }

  private async deployToRailway(config: DeployConfig, log: (msg: string) => string): Promise<DeployResult> {
    log("Deploying to Railway...");
    // Phase 0 FIX: no automated Railway path — `railway up` requires an
    // interactive `railway login` + `railway link` first. Fabricated success
    // with an invented *.up.railway.app URL was a lie.
    return this.manualHandoff(
      "Railway",
      "Railway requires interactive setup (login + link to a project)",
      "Run locally from the project: `npx railway login` once, `npx railway link`, then `npx railway up`. Or push the repo to GitHub and create the service at railway.app — Railway builds from the repo.",
      log
    );
  }

  private async deployToFlyio(config: DeployConfig, log: (msg: string) => string): Promise<DeployResult> {
    log("Deploying to Fly.io...");
    // Phase 0 FIX: no automated Fly.io path — `flyctl launch` is interactive
    // (app name, org, region prompts). Fabricated success was a lie.
    return this.manualHandoff(
      "Fly.io",
      "Fly.io requires interactive `flyctl launch` setup",
      "Run locally from the project: `flyctl auth login` once, then `flyctl launch` (answers the interactive prompts), then `flyctl deploy`. fly.toml will be generated.",
      log
    );
  }

  private async deployToRender(config: DeployConfig, log: (msg: string) => string): Promise<DeployResult> {
    log("Deploying to Render...");
    // Phase 0 FIX: Render deploys from a connected GitHub repo; the free tier
    // has no equivalent of a one-shot push-CLI without a linked service.
    // Fabricated *.onrender.com success was a lie.
    return this.manualHandoff(
      "Render",
      "Render deploys from a connected GitHub repo (or uses render.yaml blueprint)",
      "Push the repo to GitHub and create a new Web Service/Blueprint at dashboard.render.com pointing at it (choose the Free instance type). A render.yaml blueprint in the repo enables 'Blueprint' deploys.",
      log
    );
  }

  // ============================================
  // Health Checks
  // ============================================

  async healthCheck(url: string, checks: string[] = ["/", "/api/health"], projectId?: string): Promise<HealthCheckResult> {
    const results: HealthCheckResult["checks"] = [];

    for (const path of checks) {
      const checkUrl = `${url}${path}`;
      const start = Date.now();

      try {
        const response = await fetch(checkUrl, {
          method: "GET",
          headers: { "User-Agent": "Infinity-HealthCheck/1.0" },
          signal: AbortSignal.timeout(10000),
        });

        const latency = Date.now() - start;
        results.push({
          name: path === "/" ? "Homepage" : `API: ${path}`,
          url: checkUrl,
          status: response.status,
          latencyMs: latency,
          passed: response.ok,
        });
      } catch (error) {
        results.push({
          name: path === "/" ? "Homepage" : `API: ${path}`,
          url: checkUrl,
          status: 0,
          latencyMs: Date.now() - start,
          passed: false,
        });
      }
    }

    const healthy = results.every(r => r.passed);

    // Emit health check event if unhealthy
    if (!healthy && projectId) {
      try {
        await emitDeploymentEvent({
          projectId,
          deploymentId: `health-check-${Date.now()}`,
          status: "health_check_failed",
          provider: "unknown",
          url,
          error: "Health check failed",
        });
      } catch (e) {
        console.error("Failed to emit health check safety event:", e);
      }
    }

    return {
      healthy,
      checks: results,
      error: healthy ? undefined : "Some health checks failed",
    };
  }

  // ============================================
  // Custom Domain Setup
  // ============================================

  async setupCustomDomain(config: DeployConfig, domain: string): Promise<{ success: boolean; records: any[]; error?: string }> {
    const prompt = `Generate DNS records for custom domain setup.

DOMAIN: ${domain}
HOSTING: ${config.hosting}
DEPLOYMENT URL: ${config.envVars.DEPLOYMENT_URL || "unknown"}

Return JSON with DNS records needed (type, name, value, ttl) and instructions.`;

    const response = await this.adapter.complete({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      maxTokens: 1500,
      responseFormat: { type: "json_object" },
    });

    return JSON.parse(response.content);
  }

  // ============================================
  // Rollback
  // ============================================

  async rollback(config: DeployConfig, deploymentId: string, projectId?: string): Promise<DeployResult> {
    log(`Rolling back deployment ${deploymentId} on ${config.hosting}...`);

    // Emit rollback started event
    try {
      await emitDeploymentEvent({
        projectId: projectId || config.envVars.PROJECT_ID || "default",
        deploymentId,
        status: "rollback_started",
        provider: config.hosting,
      });
    } catch (e) {
      console.error("Failed to emit rollback safety event:", e);
    }

    let result: DeployResult;

    switch (config.hosting) {
      case "vercel":
        result = await this.rollbackVercel(config, deploymentId);
        break;
      case "netlify":
        result = await this.rollbackNetlify(config, deploymentId);
        break;
      case "cloudflare-pages":
        result = await this.rollbackCloudflarePages(config, deploymentId);
        break;
      default:
        result = { success: false, error: `Rollback not implemented for ${config.hosting}` };
    }

    // Emit rollback completed/failed event
    try {
      await emitDeploymentEvent({
        projectId: projectId || config.envVars.PROJECT_ID || "default",
        deploymentId,
        status: result.success ? "rollback_completed" : "rollback_failed",
        provider: config.hosting,
        error: result.error,
      });
    } catch (e) {
      console.error("Failed to emit rollback safety event:", e);
    }

    return result;
  }

  private async rollbackVercel(config: DeployConfig, deploymentId: string): Promise<DeployResult> {
    // Phase 0 FIX: honest — rollback requires either the Vercel token (API:
    // POST /v13/deployments/{id}/rollback) or local CLI auth. Never fabricate.
    const token = process.env.VERCEL_TOKEN || config.envVars.VERCEL_TOKEN;
    if (!token) {
      return { success: false, error: "Rollback on Vercel requires a token or local CLI auth. Run: `npx vercel rollback <deployment-url>` from the project.", deploymentId, logs: [] };
    }
    try {
      const resp = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}/rollback`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) {
        return { success: false, error: `Vercel rollback failed (HTTP ${resp.status})`, deploymentId, logs: [] };
      }
      return { success: true, deploymentId, logs: [] };
    } catch (e) {
      return { success: false, error: `Vercel rollback failed: ${e instanceof Error ? e.message : String(e)}`, deploymentId, logs: [] };
    }
  }

  private async rollbackNetlify(config: DeployConfig, deploymentId: string): Promise<DeployResult> {
    // Phase 0 FIX: honest. Netlify rollback happens in the dashboard/CLI; the
    // API flow is not automated, so report it truthfully.
    return { success: false, error: "Netlify rollback is not automated. In the Netlify dashboard open Deploys → the deployment → 'Rollback'; or set NETLIFY_AUTH_TOKEN and run `npx netlify deploy --prod --filter <site>` with the previous build.", deploymentId, logs: [] };
  }

  private async rollbackCloudflarePages(config: DeployConfig, deploymentId: string): Promise<DeployResult> {
    // Phase 0 FIX: honest. Cloudflare Pages rollback is dashboard-only
    // (Deployments → ⋯ → 'Rollback to this deployment').
    return { success: false, error: "Cloudflare Pages rollback is not automated. In the Cloudflare dashboard open the Pages project → Deployments → the deployment → `Rollback to this deployment`.", deploymentId, logs: [] };
  }
}

// ============================================
// Helper
// ============================================

function log(msg: string): string {
  console.log(`[${new Date().toISOString()}] ${msg}`);
  return msg;
}

// ============================================
// Singleton Instance
// ============================================

let deploymentEngineInstance: DeploymentEngine | null = null;

export function getDeploymentEngine(): DeploymentEngine {
  if (!deploymentEngineInstance) {
    deploymentEngineInstance = new DeploymentEngine();
  }
  return deploymentEngineInstance;
}