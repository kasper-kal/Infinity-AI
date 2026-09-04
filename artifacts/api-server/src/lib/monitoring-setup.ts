/**
 * Monitoring Setup — Post-Deploy Observability
 *
 * Configures free-tier monitoring: Sentry (errors), Plausible/Umami (analytics), UptimeRobot (uptime).
 * Generates HANDOFF.md with all credentials and runbooks.
 */

import { z } from "zod";
import { LLMAdapter, getLLMAdapter } from "./llm-adapter.js";

// ============================================
// Types & Schemas
// ============================================

export const MonitoringConfigSchema = z.object({
  projectName: z.string(),
  deploymentUrl: z.string(),
  framework: z.string(),
  errorTracking: z.enum(["sentry", "none"]).default("sentry"),
  analytics: z.enum(["plausible", "umami", "none"]).default("plausible"),
  uptime: z.enum(["uptimerobot", "none"]).default("uptimerobot"),
  sentryDsn: z.string().optional(),
  plausibleDomain: z.string().optional(),
  umamiUrl: z.string().optional(),
  uptimerobotApiKey: z.string().optional(),
  alertEmail: z.string().optional(),
  alertSlackWebhook: z.string().optional(),
});

export const MonitoringResultSchema = z.object({
  sentry: z.object({
    configured: z.boolean(),
    dsn: z.string().optional(),
    projectSlug: z.string().optional(),
    instructions: z.string().optional(),
  }),
  analytics: z.object({
    configured: z.boolean(),
    type: z.enum(["plausible", "umami", "none"]),
    domain: z.string().optional(),
    scriptUrl: z.string().optional(),
    instructions: z.string().optional(),
  }),
  uptime: z.object({
    configured: z.boolean(),
    monitorId: z.string().optional(),
    url: z.string().optional(),
    instructions: z.string().optional(),
  }),
  handoffDoc: z.string(),
});

export type MonitoringConfig = z.infer<typeof MonitoringConfigSchema>;
export type MonitoringResult = z.infer<typeof MonitoringResultSchema>;

// ============================================
// Monitoring Setup Class
// ============================================

export class MonitoringSetup {
  private adapter: LLMAdapter;

  constructor(adapter?: LLMAdapter) {
    this.adapter = adapter || getLLMAdapter();
  }

  // ============================================
  // Main Setup Method
  // ============================================

  async setup(config: MonitoringConfig): Promise<MonitoringResult> {
    const results: Partial<MonitoringResult> = {};

    // 1. Sentry Error Tracking
    if (config.errorTracking === "sentry") {
      results.sentry = await this.setupSentry(config);
    }

    // 2. Analytics
    if (config.analytics !== "none") {
      results.analytics = await this.setupAnalytics(config);
    }

    // 3. Uptime Monitoring
    if (config.uptime !== "none") {
      results.uptime = await this.setupUptime(config);
    }

    // 4. Generate Handoff Document
    const handoffDoc = await this.generateHandoffDoc(config, results as MonitoringResult);
    results.handoffDoc = handoffDoc;

    return results as MonitoringResult;
  }

  // ============================================
  // Sentry Setup
  // ============================================

  private async setupSentry(config: MonitoringConfig): Promise<MonitoringResult["sentry"]> {
    const hasSentryDsn = config.sentryDsn || process.env.SENTRY_DSN;
    const hasSentryAuth = process.env.SENTRY_AUTH_TOKEN || process.env.SENTRY_ORG;

    if (hasSentryDsn) {
      return {
        configured: true,
        dsn: hasSentryDsn,
        projectSlug: config.projectName.toLowerCase().replace(/\s+/g, "-"),
        instructions: "Sentry DSN configured. Add to your app:\n```js\nimport * as Sentry from '@sentry/nextjs';\nSentry.init({ dsn: process.env.SENTRY_DSN });\n```",
      };
    }

    if (hasSentryAuth) {
      // Could create Sentry project via API
      return {
        configured: false,
        instructions: `Sentry auth token available. Create project at https://sentry.io/settings/${process.env.SENTRY_ORG}/projects/new/
Then add DSN to environment variables.`,
      };
    }

    return {
      configured: false,
      instructions: `Sentry (Free tier: 5k errors/month, 10k transactions/month)
1. Sign up at https://sentry.io (free developer account)
2. Create project: ${config.projectName} (${config.framework})
3. Copy DSN to environment variable: SENTRY_DSN
4. Install SDK: npm install @sentry/nextjs (or framework equivalent)
5. Initialize in your app entry point
6. Deploy - errors will appear in Sentry dashboard`,
    };
  }

  // ============================================
  // Analytics Setup
  // ============================================

  private async setupAnalytics(config: MonitoringConfig): Promise<MonitoringResult["analytics"]> {
    if (config.analytics === "plausible") {
      const hasPlausibleDomain = config.plausibleDomain || process.env.PLAUSIBLE_DOMAIN;
      const hasPlausibleApi = process.env.PLAUSIBLE_API_KEY;

      if (hasPlausibleDomain && hasPlausibleApi) {
        return {
          configured: true,
          type: "plausible",
          domain: hasPlausibleDomain,
          scriptUrl: `https://plausible.io/js/script.js`,
          instructions: `Plausible configured for ${hasPlausibleDomain}.
Add to your app:
\`<script defer data-domain="${hasPlausibleDomain}" src="https://plausible.io/js/script.js"></script>\`
For SPA: use plausible-tracker package`,
        };
      }

      return {
        configured: false,
        type: "plausible",
        instructions: `Plausible (Free tier: self-hosted unlimited, Cloud: $9/mo for 10k pageviews)
Option A - Self-hosted (recommended for $0):
1. Deploy Plausible via Docker: https://plausible.io/self-hosting
2. Add domain: ${config.deploymentUrl}
3. Copy script URL to environment

Option B - Cloud (free trial, then paid):
1. Sign up at https://plausible.io
2. Add site: ${config.projectName}
3. Copy domain to PLAUSIBLE_DOMAIN env var
4. Add script tag to your layout`,
      };
    }

    if (config.analytics === "umami") {
      const hasUmamiUrl = config.umamiUrl || process.env.UMAMI_URL;
      const hasUmamiId = process.env.UMAMI_WEBSITE_ID;

      if (hasUmamiUrl && hasUmamiId) {
        return {
          configured: true,
          type: "umami",
          scriptUrl: `${hasUmamiUrl}/script.js`,
          instructions: `Umami configured.
Add to your app:
\`<script defer src="${hasUmamiUrl}/script.js" data-website-id="${hasUmamiId}"></script>\``,
        };
      }

      return {
        configured: false,
        type: "umami",
        instructions: `Umami (Free: self-hosted only)
1. Self-host: https://umami.is/docs/self-host
   - Docker: docker run -d --name umami -p 3000:3000 ghcr.io/umami-software/umami:postgresql-latest
2. Or use Umami Cloud (paid)
3. Add website in Umami dashboard
4. Copy website ID and script URL to env vars`,
      };
    }

    return { configured: false, type: "none", instructions: "No analytics configured" };
  }

  // ============================================
  // Uptime Monitoring Setup
  // ============================================

  private async setupUptime(config: MonitoringConfig): Promise<MonitoringResult["uptime"]> {
    const hasUptimeRobotKey = config.uptimerobotApiKey || process.env.UPTIMEROBOT_API_KEY;

    if (hasUptimeRobotKey) {
      // Could create monitor via API
      return {
        configured: false,
        instructions: `UptimeRobot API key available. Create monitor at https://uptimerobot.com/dashboard#mainMonitor
Or use API: POST https://api.uptimerobot.com/v2/newMonitor with api_key, friendly_name, url, type=1`,
      };
    }

    return {
      configured: false,
      instructions: `UptimeRobot (Free tier: 50 monitors, 5-min intervals)
1. Sign up at https://uptimerobot.com (free)
2. Add Monitor:
   - Type: HTTP(s)
   - URL: ${config.deploymentUrl}
   - Friendly Name: ${config.projectName}
   - Interval: 5 minutes (free tier)
3. Alert Contacts:
   - Email: ${config.alertEmail || "your-email@example.com"}
   - Slack: Add webhook integration
   - Pushover/Telegram: Available
4. Optional: Add keyword monitor for /api/health endpoint`,
    };
  }

  // ============================================
  // Generate Handoff Document
  // ============================================

  private async generateHandoffDoc(
    config: MonitoringConfig,
    results: MonitoringResult
  ): Promise<string> {
    const prompt = `Generate a comprehensive HANDOFF.md document for a deployed project.

PROJECT: ${config.projectName}
DEPLOYMENT URL: ${config.deploymentUrl}
FRAMEWORK: ${config.framework}

MONITORING SETUP:
${JSON.stringify(results, null, 2)}

Create a markdown document with:
1. Project overview
2. Architecture summary
3. Deployment info (URL, provider, custom domain)
4. Credentials (all encrypted - reference Secret Manager)
5. Monitoring setup (Sentry, Analytics, Uptime) with links
6. Runbook: common operations (deploy, rollback, scale, debug)
7. Scaling notes
8. Cost breakdown (all free tier)
9. Emergency contacts
10. Next steps for team

Make it production-ready and actionable.`;

    const response = await this.adapter.complete({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      maxTokens: 3000,
    });

    return response.content;
  }

  // ============================================
  // Inject Monitoring into Project
  // ============================================

  async injectMonitoringCode(
    projectPath: string,
    config: MonitoringConfig,
    results: MonitoringResult
  ): Promise<{ files: Array<{ path: string; content: string }> }> {
    const files: Array<{ path: string; content: string }> = [];

    // Sentry initialization
    if (results.sentry?.configured && results.sentry.dsn) {
      const sentryInit = this.generateSentryInit(config.framework, results.sentry.dsn);
      files.push({ path: "sentry.client.config.ts", content: sentryInit });
    }

    // Analytics script
    if (results.analytics?.configured) {
      const analyticsScript = this.generateAnalyticsScript(results.analytics);
      files.push({ path: "components/Analytics.tsx", content: analyticsScript });
    }

    // Health check endpoint
    const healthEndpoint = this.generateHealthEndpoint(config.framework);
    files.push({ path: "app/api/health/route.ts", content: healthEndpoint });

    return { files };
  }

  private generateSentryInit(framework: string, dsn: string): string {
    if (framework === "nextjs") {
      return `import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN || '${dsn}',
  tracesSampleRate: 1.0,
  debug: process.env.NODE_ENV === 'development',
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
});`;
    }
    return `// Sentry initialization for ${framework}
import * as Sentry from '@sentry/${framework}';

Sentry.init({
  dsn: process.env.SENTRY_DSN || '${dsn}',
  environment: process.env.NODE_ENV,
});`;
  }

  private generateAnalyticsScript(analytics: MonitoringResult["analytics"]): string {
    if (analytics.type === "plausible") {
      return `"use client";

import Script from 'next/script';

export default function PlausibleAnalytics() {
  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN || '${analytics.domain}';

  if (!domain) return null;

  return (
    <Script
      strategy="lazyOnload"
      data-domain={domain}
      src="https://plausible.io/js/script.js"
    />
  );
}`;
    }

    if (analytics.type === "umami") {
      return `"use client";

import Script from 'next/script';

export default function UmamiAnalytics() {
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  const scriptUrl = process.env.NEXT_PUBLIC_UMAMI_URL || '${analytics.scriptUrl}';

  if (!websiteId || !scriptUrl) return null;

  return (
    <Script
      strategy="lazyOnload"
      data-website-id={websiteId}
      src={\`\${scriptUrl}/script.js\`}
    />
  );
}`;
    }

    return "// No analytics configured";
  }

  private generateHealthEndpoint(framework: string): string {
    if (framework === "nextjs") {
      return `import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
}`;
    }

    return `// Health check endpoint for ${framework}
export default function handler(req, res) {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}`;
  }
}

// ============================================
// Singleton Instance
// ============================================

let monitoringSetupInstance: MonitoringSetup | null = null;

export function getMonitoringSetup(): MonitoringSetup {
  if (!monitoringSetupInstance) {
    monitoringSetupInstance = new MonitoringSetup();
  }
  return monitoringSetupInstance;
}