import { Router } from "express";
import { Router } from "express";
import { db, mobileApps, mobilePreviewSessions, mobileStoreSubmissions, designKitSyncLog, mobileAppComponents, buildApps, files } from "@workspace/db";
import { eq, desc, asc, and, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  initDesignTokenBridge,
  syncBridge,
  getUnifiedDesignTokens,
  generatePlatformComponent,
  generateAllPlatformComponents,
  generateMobileAppScaffold,
  generateUnifiedDesignContext,
  fetchCustomDesignTokens,
  shutdownDesignTokenBridge,
} from "../../lib/design-token-bridge.js";
import { generateEasConfig, createStoreSubmissionJob, generateSubmissionGuide, generateEasCommands, writeEasConfig } from "../../lib/store-submission.js";
import { getExpoPreviewManager, ExpoPreviewManager } from "../../lib/expo-preview.js";
import { generateMobileApp, MobileAppTemplate } from "../../lib/mobile-app-generator.js";

const router = Router();

// Initialize design token bridge on first request
let bridgeInitialized = false;
async function ensureBridge() {
  if (!bridgeInitialized) {
    await initDesignTokenBridge(30_000);
    bridgeInitialized = true;
  }
}

/**
 * GET /api/infinity/mobile-apps
 * List all mobile apps
 */
router.get("/mobile-apps", async (req, res) => {
  try {
    const apps = await db.select().from(mobileApps).orderBy(desc(mobileApps.createdAt));
    res.json(apps);
  } catch (err) {
    console.error("[mobile-apps] list error:", err);
    res.status(500).json({ error: "Failed to list mobile apps" });
  }
});

/**
 * GET /api/infinity/mobile-apps/:id
 * Get a single mobile app
 */
router.get("/mobile-apps/:id", async (req, res) => {
  try {
    const [app] = await db.select().from(mobileApps).where(eq(mobileApps.id, req.params.id));
    if (!app) {
      res.status(404).json({ error: "Mobile app not found" });
      return;
    }
    res.json(app);
  } catch (err) {
    console.error("[mobile-apps] get error:", err);
    res.status(500).json({ error: "Failed to get mobile app" });
  }
});

/**
 * POST /api/infinity/mobile-apps
 * Create a new mobile app (scaffold)
 * Body: { name, description, platform, designKit, bundleIdentifier, packageName, appName, template, capabilities }
 */
router.post("/mobile-apps", async (req, res) => {
  try {
    await ensureBridge();

    const {
      name,
      description = "",
      platform = "both",
      designKit = "ios-27",
      customFigmaUrl,
      bundleIdentifier,
      packageName,
      appName,
      template = "blank",
      capabilities = {},
    } = req.body;

    if (!name || !bundleIdentifier || !packageName || !appName) {
      res.status(400).json({ error: "Missing required fields: name, bundleIdentifier, packageName, appName" });
      return;
    }

    // Create build_app first
    const [buildApp] = await db.insert(buildApps).values({
      name,
      description,
      metadata: { type: "mobile", platform, template },
    }).returning();

    // Create mobile_app entry
    const [mobileApp] = await db.insert(mobileApps).values({
      buildAppId: buildApp.id,
      platform,
      designKit,
      customFigmaUrl,
      bundleIdentifier,
      packageName,
      appName,
      template,
      capabilities,
      status: "scaffolded",
    }).returning();

    // Generate scaffold files
    const scaffold = generateMobileApp({
      projectName: appName,
      bundleId: bundleIdentifier,
      packageName: packageName,
      template: template as MobileAppTemplate,
      platform: platform as "ios" | "android" | "both",
      nativeFeatures: Object.keys(capabilities).filter(k => capabilities[k]),
      designSystem: designKit,
      expoConfig: { slug: bundleIdentifier.split(".").pop()!, name: appName },
    });

    // Update build_app with file bundle
    await db.update(buildApps).set({
      fileId: scaffold.zipFileId,
      metadata: { ...scaffold, mobileAppId: mobileApp.id },
    }).where(eq(buildApps.id, buildApp.id));

    // Sync design tokens if custom URL provided
    if (customFigmaUrl) {
      const customResult = await fetchCustomDesignTokens(customFigmaUrl);
      if (customResult.ok) {
        await db.update(mobileApps).set({ metadata: { customTokens: customResult.tokens } }).where(eq(mobileApps.id, mobileApp.id));
      }
    }

    res.status(201).json({ ...mobileApp, scaffold });
  } catch (err) {
    console.error("[mobile-apps] create error:", err);
    res.status(500).json({ error: "Failed to create mobile app" });
  }
});

/**
 * PATCH /api/infinity/mobile-apps/:id
 * Update mobile app
 */
router.patch("/mobile-apps/:id", async (req, res) => {
  try {
    const updates = req.body;
    delete updates.id;
    delete updates.createdAt;
    delete updates.updatedAt;

    const [app] = await db.update(mobileApps)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(mobileApps.id, req.params.id))
      .returning();

    if (!app) {
      res.status(404).json({ error: "Mobile app not found" });
      return;
    }
    res.json(app);
  } catch (err) {
    console.error("[mobile-apps] update error:", err);
    res.status(500).json({ error: "Failed to update mobile app" });
  }
});

/**
 * DELETE /api/infinity/mobile-apps/:id
 * Delete mobile app
 */
router.delete("/mobile-apps/:id", async (req, res) => {
  try {
    await db.delete(mobileApps).where(eq(mobileApps.id, req.params.id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[mobile-apps] delete error:", err);
    res.status(500).json({ error: "Failed to delete mobile app" });
  }
});

/**
 * GET /api/infinity/mobile-apps/:id/design-context
 * Get unified design context for LLM prompting
 */
router.get("/mobile-apps/:id/design-context", async (req, res) => {
  try {
    await ensureBridge();
    const context = generateUnifiedDesignContext();
    res.json({ context });
  } catch (err) {
    console.error("[mobile-apps] design-context error:", err);
    res.status(500).json({ error: "Failed to get design context" });
  }
});

/**
 * POST /api/infinity/mobile-apps/:id/sync-design-kits
 * Force sync both design kits
 */
router.post("/mobile-apps/:id/sync-design-kits", async (req, res) => {
  try {
    await ensureBridge();
    const result = await syncBridge(true);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[mobile-apps] sync-design-kits error:", err);
    res.status(500).json({ error: "Failed to sync design kits" });
  }
});

/**
 * GET /api/infinity/mobile-apps/:id/components
 * Get all generated components for a platform
 */
router.get("/mobile-apps/:id/components", async (req, res) => {
  try {
    const platform = String(req.query.platform ?? "ios") as "ios" | "android";
    await ensureBridge();
    const components = generateAllPlatformComponents(platform);
    res.json({ platform, components });
  } catch (err) {
    console.error("[mobile-apps] components error:", err);
    res.status(500).json({ error: "Failed to get components" });
  }
});

/**
 * GET /api/infinity/mobile-apps/:id/component/:componentType
 * Get a specific component
 */
router.get("/mobile-apps/:id/component/:componentType", async (req, res) => {
  try {
    const platform = String(req.query.platform ?? "ios") as "ios" | "android";
    const { componentType } = req.params;
    await ensureBridge();
    const code = generatePlatformComponent(platform, componentType);
    res.json({ platform, componentType, code });
  } catch (err) {
    console.error("[mobile-apps] component error:", err);
    res.status(500).json({ error: "Failed to get component" });
  }
});

/**
 * POST /api/infinity/mobile-apps/:id/scaffold
 * Generate full scaffold with all components + EAS config
 */
router.post("/mobile-apps/:id/scaffold", async (req, res) => {
  try {
    await ensureBridge();
    const [app] = await db.select().from(mobileApps).where(eq(mobileApps.id, req.params.id));
    if (!app) {
      res.status(404).json({ error: "Mobile app not found" });
      return;
    }

    const scaffold = generateMobileAppScaffold({
      appName: app.appName,
      platform: app.platform as "ios" | "android" | "both",
      bundleIdentifier: app.bundleIdentifier,
      packageName: app.packageName,
    });

    // Store generated components in DB
    for (const [type, code] of Object.entries(scaffold.iosComponents)) {
      await db.insert(mobileAppComponents).values({
        mobileAppId: app.id,
        platform: "ios",
        componentType: type,
        componentCode: code,
        kitVersionId: (await getUnifiedDesignTokens())?.ios.versionId ?? null,
        kitVersionLabel: (await getUnifiedDesignTokens())?.ios.versionLabel ?? null,
      });
    }
    for (const [type, code] of Object.entries(scaffold.androidComponents)) {
      await db.insert(mobileAppComponents).values({
        mobileAppId: app.id,
        platform: "android",
        componentType: type,
        componentCode: code,
        kitVersionId: (await getUnifiedDesignTokens())?.android.versionId ?? null,
        kitVersionLabel: (await getUnifiedDesignTokens())?.android.versionLabel ?? null,
      });
    }
    for (const [type, code] of Object.entries(scaffold.sharedComponents)) {
      await db.insert(mobileAppComponents).values({
        mobileAppId: app.id,
        platform: "shared",
        componentType: type,
        componentCode: code,
      });
    }

    await db.update(mobileApps).set({ status: "building", updatedAt: new Date() }).where(eq(mobileApps.id, app.id));

    res.json({ ok: true, scaffold });
  } catch (err) {
    console.error("[mobile-apps] scaffold error:", err);
    res.status(500).json({ error: "Failed to generate scaffold" });
  }
});

// ========== PREVIEW SESSIONS ==========

/**
 * POST /api/infinity/mobile-apps/:id/preview/start
 * Start Expo preview session
 */
router.post("/mobile-apps/:id/preview/start", async (req, res) => {
  try {
    const [app] = await db.select().from(mobileApps).where(eq(mobileApps.id, req.params.id));
    if (!app) {
      res.status(404).json({ error: "Mobile app not found" });
      return;
    }

    // Get project path from build_app
    const [buildApp] = await db.select().from(buildApps).where(eq(buildApps.id, app.buildAppId));
    if (!buildApp || !buildApp.fileId) {
      res.status(400).json({ error: "App not scaffolded yet" });
      return;
    }

    // Get project path from files DB
    // Get filesDb
const { filesDb } = await import("@workspace/db");
const { files: filesTable } = await import("@workspace/db");
    const [file] = await filesDb.select().from(files).where(eq(files.id, buildApp.fileId));
    if (!file) {
      res.status(404).json({ error: "Project files not found" });
      return;
    }

    // Assume project is extracted to a temp directory
    const projectPath = `/tmp/infinity-mobile-${app.id}`;

    const manager = getExpoPreviewManager(3001);
    const session = await manager.startPreview(projectPath, app.appName);

    // Persist session
    const [previewSession] = await db.insert(mobilePreviewSessions).values({
      mobileAppId: app.id,
      status: session.status,
      metroPort: session.metroPort,
      expoPort: session.expoPort,
      qrCodeData: session.qrCodeData,
      qrCodeImage: session.qrCodeImage,
      deviceConnections: session.deviceConnections,
      logs: session.logs,
      startedAt: new Date(session.startTime),
    }).returning();

    await db.update(mobileApps).set({ status: "previewing", updatedAt: new Date() }).where(eq(mobileApps.id, app.id));

    res.json({ session: previewSession, qrCodeData: session.qrCodeData, qrCodeImage: session.qrCodeImage });
  } catch (err) {
    console.error("[mobile-apps] preview start error:", err);
    res.status(500).json({ error: "Failed to start preview" });
  }
});

/**
 * GET /api/infinity/mobile-apps/:id/preview/:sessionId
 * Get preview session status
 */
router.get("/mobile-apps/:id/preview/:sessionId", async (req, res) => {
  try {
    const [session] = await db.select().from(mobilePreviewSessions)
      .where(and(eq(mobilePreviewSessions.id, req.params.sessionId), eq(mobilePreviewSessions.mobileAppId, req.params.id)));
    if (!session) {
      res.status(404).json({ error: "Preview session not found" });
      return;
    }

    const manager = getExpoPreviewManager(3001);
    const liveSession = manager.getSession(session.id);

    res.json({ ...session, live: liveSession });
  } catch (err) {
    console.error("[mobile-apps] preview get error:", err);
    res.status(500).json({ error: "Failed to get preview session" });
  }
});

/**
 * POST /api/infinity/mobile-apps/:id/preview/:sessionId/stop
 * Stop preview session
 */
router.post("/mobile-apps/:id/preview/:sessionId/stop", async (req, res) => {
  try {
    const [session] = await db.select().from(mobilePreviewSessions)
      .where(and(eq(mobilePreviewSessions.id, req.params.sessionId), eq(mobilePreviewSessions.mobileAppId, req.params.id)));
    if (!session) {
      res.status(404).json({ error: "Preview session not found" });
      return;
    }

    const manager = getExpoPreviewManager(3001);
    await manager.stopPreview(session.id);

    await db.update(mobilePreviewSessions)
      .set({ status: "stopped", endedAt: new Date(), updatedAt: new Date() })
      .where(eq(mobilePreviewSessions.id, session.id));

    await db.update(mobileApps).set({ status: "scaffolded", updatedAt: new Date() }).where(eq(mobileApps.id, req.params.id));

    res.json({ ok: true });
  } catch (err) {
    console.error("[mobile-apps] preview stop error:", err);
    res.status(500).json({ error: "Failed to stop preview" });
  }
});

/**
 * GET /api/infinity/mobile-apps/:id/preview/:sessionId/logs
 * Get preview logs
 */
router.get("/mobile-apps/:id/preview/:sessionId/logs", async (req, res) => {
  try {
    const [session] = await db.select().from(mobilePreviewSessions)
      .where(and(eq(mobilePreviewSessions.id, req.params.sessionId), eq(mobilePreviewSessions.mobileAppId, req.params.id)));
    if (!session) {
      res.status(404).json({ error: "Preview session not found" });
      return;
    }

    const manager = getExpoPreviewManager(3001);
    const logs = manager.getLogs(session.id);

    res.json({ logs });
  } catch (err) {
    console.error("[mobile-apps] preview logs error:", err);
    res.status(500).json({ error: "Failed to get preview logs" });
  }
});

// ========== STORE SUBMISSION ==========

/**
 * POST /api/infinity/mobile-apps/:id/submit
 * Create store submission job
 */
router.post("/mobile-apps/:id/submit", async (req, res) => {
  try {
    const [app] = await db.select().from(mobileApps).where(eq(mobileApps.id, req.params.id));
    if (!app) {
      res.status(404).json({ error: "Mobile app not found" });
      return;
    }

    const { platform = "both", buildProfile = "production", credentials = {} } = req.body;

    // Generate EAS config
    const easConfig = generateEasConfig({
      projectId: app.expoProjectId ?? randomUUID(),
      projectName: app.appName,
      bundleIdentifier: app.bundleIdentifier,
      packageName: app.packageName,
      platform: platform as "ios" | "android" | "both",
      buildProfile: buildProfile as "development" | "preview" | "production",
      credentials,
    });

    // Create submission job
    const job = createStoreSubmissionJob({
      projectId: app.id,
      projectName: app.appName,
      platform: platform as "ios" | "android" | "both",
      buildProfile: buildProfile as "development" | "preview" | "production",
      credentials,
      easConfig: JSON.parse(easConfig),
    });

    const [submission] = await db.insert(mobileStoreSubmissions).values({
      mobileAppId: app.id,
      platform: platform as "ios" | "android" | "both",
      stage: job.stage,
      status: job.status,
      progress: job.progress,
      buildProfile: buildProfile as "development" | "preview" | "production",
      credentials,
      easConfig: JSON.parse(easConfig),
      buildUrls: job.buildUrls,
      logs: job.logs,
    }).returning();

    await db.update(mobileApps).set({ status: "submitting", updatedAt: new Date() }).where(eq(mobileApps.id, app.id));

    // Generate guide
    const guide = generateSubmissionGuide(job);
    const commands = generateEasCommands(job);

    res.status(201).json({ submission, guide, commands });
  } catch (err) {
    console.error("[mobile-apps] submit error:", err);
    res.status(500).json({ error: "Failed to create submission" });
  }
});

/**
 * GET /api/infinity/mobile-apps/:id/submissions
 * List submissions for app
 */
router.get("/mobile-apps/:id/submissions", async (req, res) => {
  try {
    const submissions = await db.select().from(mobileStoreSubmissions)
      .where(eq(mobileStoreSubmissions.mobileAppId, req.params.id))
      .orderBy(desc(mobileStoreSubmissions.createdAt));
    res.json(submissions);
  } catch (err) {
    console.error("[mobile-apps] submissions list error:", err);
    res.status(500).json({ error: "Failed to list submissions" });
  }
});

/**
 * GET /api/infinity/mobile-apps/:id/submissions/:submissionId
 * Get submission details
 */
router.get("/mobile-apps/:id/submissions/:submissionId", async (req, res) => {
  try {
    const [submission] = await db.select().from(mobileStoreSubmissions)
      .where(and(eq(mobileStoreSubmissions.id, req.params.submissionId), eq(mobileStoreSubmissions.mobileAppId, req.params.id)));
    if (!submission) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }
    res.json(submission);
  } catch (err) {
    console.error("[mobile-apps] submission get error:", err);
    res.status(500).json({ error: "Failed to get submission" });
  }
});

/**
 * GET /api/infinity/mobile-apps/:id/submissions/:submissionId/guide
 * Get submission guide markdown
 */
router.get("/mobile-apps/:id/submissions/:submissionId/guide", async (req, res) => {
  try {
    const [submission] = await db.select().from(mobileStoreSubmissions)
      .where(and(eq(mobileStoreSubmissions.id, req.params.submissionId), eq(mobileStoreSubmissions.mobileAppId, req.params.id)));
    if (!submission) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }

    const job = {
      ...submission,
      easConfig: submission.easConfig as any,
      credentials: submission.credentials as any,
      buildUrls: submission.buildUrls as any,
      logs: submission.logs as any,
    };

    const guide = generateSubmissionGuide(job);
    const commands = generateEasCommands(job);

    res.json({ guide, commands });
  } catch (err) {
    console.error("[mobile-apps] submission guide error:", err);
    res.status(500).json({ error: "Failed to get guide" });
  }
});

/**
 * POST /api/infinity/mobile-apps/:id/submissions/:submissionId/eas-config
 * Write eas.json to project
 */
router.post("/mobile-apps/:id/submissions/:submissionId/eas-config", async (req, res) => {
  try {
    const [submission] = await db.select().from(mobileStoreSubmissions)
      .where(and(eq(mobileStoreSubmissions.id, req.params.submissionId), eq(mobileStoreSubmissions.mobileAppId, req.params.id)));
    if (!submission) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }

    const [app] = await db.select().from(mobileApps).where(eq(mobileApps.id, req.params.id));
    const [buildApp] = await db.select().from(buildApps).where(eq(buildApps.id, app!.buildAppId));
    // Get filesDb
const { filesDb } = await import("@workspace/db");
const { files: filesTable } = await import("@workspace/db");
    const [file] = await filesDb.select().from(files).where(eq(files.id, buildApp!.fileId));
    const projectPath = `/tmp/infinity-mobile-${app!.id}`;

    await writeEasConfig(projectPath, {
      projectId: submission.easConfig.projectId as string,
      projectName: app!.appName,
      bundleIdentifier: app!.bundleIdentifier,
      packageName: app!.packageName,
      platform: submission.platform as "ios" | "android" | "both",
      buildProfile: submission.buildProfile as "development" | "preview" | "production",
      credentials: submission.credentials as any,
    });

    res.json({ ok: true, path: `${projectPath}/eas.json` });
  } catch (err) {
    console.error("[mobile-apps] eas-config error:", err);
    res.status(500).json({ error: "Failed to write eas.json" });
  }
});

// ========== DESIGN KIT SYNC LOG ==========

/**
 * GET /api/infinity/design-kits/sync-log
 * Get design kit sync history
 */
router.get("/design-kits/sync-log", async (req, res) => {
  try {
    const logs = await db.select().from(designKitSyncLog).orderBy(desc(designKitSyncLog.syncedAt)).limit(50);
    res.json(logs);
  } catch (err) {
    console.error("[design-kits] sync-log error:", err);
    res.status(500).json({ error: "Failed to get sync log" });
  }
});

/**
 * POST /api/infinity/design-kits/sync
 * Force sync both kits
 */
router.post("/design-kits/sync", async (req, res) => {
  try {
    await ensureBridge();
    const result = await syncBridge(true);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[design-kits] sync error:", err);
    res.status(500).json({ error: "Failed to sync design kits" });
  }
});

/**
 * GET /api/infinity/design-kits/status
 * Get current kit versions
 */
router.get("/design-kits/status", async (req, res) => {
  try {
    await ensureBridge();
    const cache = getUnifiedDesignTokens();
    res.json(cache);
  } catch (err) {
    console.error("[design-kits] status error:", err);
    res.status(500).json({ error: "Failed to get kit status" });
  }
});

export default router;