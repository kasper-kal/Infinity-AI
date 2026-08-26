import { Router, Request, Response } from "express";
import { db, projects, connectors, connectorNotifications } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { apiKeyAuth, requireScope } from "../../middlewares/api-key-auth";
import { createConnector } from "../../lib/connectors/base";
import { logActivity } from "./project-activity";
import { logger } from "../../lib/logger";

const router = Router();

/** All connector routes require authentication */
router.use(apiKeyAuth);
router.use(requireScope("build:write", "project:write"));

/** GET /api/infinity/connectors — List all connectors for a project */
router.get("/", async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId as string;
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    // Verify project access
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const items = await db
      .select()
      .from(connectors)
      .where(eq(connectors.projectId, projectId))
      .orderBy(desc(connectors.createdAt));

    // Don't return sensitive config values
    const sanitized = items.map(c => ({
      ...c,
      config: sanitizeConfig(c.config),
      installation: c.installation ? { ...c.installation, accessToken: "[REDACTED]" } : null,
    }));

    res.json(sanitized);
  } catch (err) {
    logger.error({ err }, "Failed to list connectors");
    res.status(500).json({ error: "Failed to list connectors" });
  }
});

/** POST /api/infinity/connectors — Create a new connector */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { projectId, platform, name, config, notifyOn, enabled = true } = req.body;

    if (!projectId || !platform || !name) {
      res.status(400).json({ error: "projectId, platform, and name are required" });
      return;
    }

    const validPlatforms = ["slack", "discord", "telegram", "linear", "notion", "google-sheets"];
    if (!validPlatforms.includes(platform)) {
      res.status(400).json({ error: `platform must be one of: ${validPlatforms.join(", ")}` });
      return;
    }

    // Verify project access
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    // Validate config by creating connector instance
    const connector = await createConnector(platform, config || {}, projectId, "temp");
    const validation = await connector.validateConfig();
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const [connectorRecord] = await db.insert(connectors).values({
      projectId,
      platform,
      name,
      config: config || {},
      enabled,
      notifyOn: notifyOn || ["build_completed", "build_failed", "research_completed", "scheduled_job_failed"],
    }).returning();

    await logActivity(projectId, "agent_ran", `Created ${platform} connector: ${name}`);

    res.status(201).json({
      ...connectorRecord,
      config: sanitizeConfig(connectorRecord.config),
    });
  } catch (err) {
    logger.error({ err }, "Failed to create connector");
    res.status(500).json({ error: "Failed to create connector" });
  }
});

/** GET /api/infinity/connectors/:id — Get a connector with recent notifications */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const [connectorRecord] = await db.select().from(connectors).where(eq(connectors.id, id)).limit(1);
    if (!connectorRecord) {
      res.status(404).json({ error: "Connector not found" });
      return;
    }

    const notifications = await db
      .select()
      .from(connectorNotifications)
      .where(eq(connectorNotifications.connectorId, id))
      .orderBy(desc(connectorNotifications.createdAt))
      .limit(50);

    res.json({
      ...connectorRecord,
      config: sanitizeConfig(connectorRecord.config),
      installation: connectorRecord.installation ? { ...connectorRecord.installation, accessToken: "[REDACTED]" } : null,
      recentNotifications: notifications,
    });
  } catch (err) {
    logger.error({ err }, "Failed to get connector");
    res.status(500).json({ error: "Failed to get connector" });
  }
});

/** PUT /api/infinity/connectors/:id — Update a connector */
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { name, config, enabled, notifyOn } = req.body;

    const id = req.params.id as string;
    const [existing] = await db.select().from(connectors).where(eq(connectors.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Connector not found" });
      return;
    }

    // If config is being updated, validate it
    if (config) {
      const connector = await createConnector(existing.platform, config, existing.projectId, id);
      const validation = await connector.validateConfig();
      if (!validation.valid) {
        res.status(400).json({ error: validation.error });
        return;
      }
    }

    const [updated] = await db.update(connectors)
      .set({
        ...(name && { name }),
        ...(config && { config }),
        ...(enabled !== undefined && { enabled }),
        ...(notifyOn && { notifyOn }),
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Connector not found" });
      return;
    }

    await logActivity(existing.projectId, "agent_ran", `Updated ${existing.platform} connector: ${updated.name}`);

    res.json({
      ...updated,
      config: sanitizeConfig(updated.config),
      installation: updated.installation ? { ...updated.installation, accessToken: "[REDACTED]" } : null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to update connector");
    res.status(500).json({ error: "Failed to update connector" });
  }
});

/** DELETE /api/infinity/connectors/:id — Delete a connector */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const [existing] = await db.select().from(connectors).where(eq(connectors.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Connector not found" });
      return;
    }

    await db.delete(connectors).where(eq(connectors.id, id));
    await logActivity(existing.projectId, "agent_ran", `Deleted ${existing.platform} connector: ${existing.name}`);

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to delete connector");
    res.status(500).json({ error: "Failed to delete connector" });
  }
});

/** POST /api/infinity/connectors/:id/test — Send a test notification */
router.post("/connectors/:id/test", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const [connectorRecord] = await db.select().from(connectors).where(eq(connectors.id, id)).limit(1);
    if (!connectorRecord) {
      res.status(404).json({ error: "Connector not found" });
      return;
    }

    const connector = await createConnector(
      connectorRecord.platform,
      connectorRecord.config as Record<string, any>,
      connectorRecord.projectId,
      connectorRecord.id
    );

    const result = await connector.sendNotification({
      eventType: "test_notification",
      title: "Test Notification",
      body: `This is a test notification from Infinity for project ${connectorRecord.projectId}`,
      metadata: {
        projectId: connectorRecord.projectId,
        connectorName: connectorRecord.name,
        platform: connectorRecord.platform,
      },
    });

    if (result.success) {
      await logActivity(connectorRecord.projectId, "agent_ran", `Test notification sent via ${connectorRecord.platform} connector`);
    }

    res.json({ success: result.success, error: result.error, messageId: result.messageId });
  } catch (err) {
    logger.error({ err }, "Failed to send test notification");
    res.status(500).json({ error: "Failed to send test notification" });
  }
});

/** Webhook endpoint for Slack events */
router.post("/connectors/slack/events", async (req: Request, res: Response) => {
  try {
    const { type, challenge, event } = req.body;

    // URL verification challenge
    if (type === "url_verification") {
      res.json({ challenge });
      return;
    }

    // Event callback
    if (type === "event_callback" && event) {
      // Handle app_mention or message events for /infinity commands
      if (event.type === "app_mention" || (event.type === "message" && event.text?.includes("/infinity"))) {
        // Process asynchronously
        processSlackCommand(event).catch(err => logger.error({ err }, "Slack command processing failed"));
      }
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Slack events webhook error");
    res.status(500).json({ error: "Webhook error" });
  }
});

/** Webhook endpoint for Discord interactions */
router.post("/connectors/discord/interactions", async (req: Request, res: Response) => {
  try {
    const { type, data, channel_id, member, user } = req.body;

    // PING (type 1) - verify URL
    if (type === 1) {
      res.json({ type: 1 }); // PONG
      return;
    }

    // APPLICATION_COMMAND (type 2) - slash command
    if (type === 2 && data?.name === "infinity") {
      const subcommand = data.options?.[0]?.name || "help";
      const args = data.options?.[0]?.options?.map((o: any) => o.value).filter(Boolean) || [];

      // Process asynchronously
      processDiscordCommand({
        command: subcommand,
        args,
        channelId: channel_id,
        userId: user?.id || member?.user?.id,
        userName: user?.username || member?.user?.username || "Unknown",
        projectId: req.query.projectId as string,
        connectorId: req.query.connectorId as string,
      }).catch(err => logger.error({ err }, "Discord command processing failed"));

      // Respond with deferred update (we'll edit later)
      res.json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Discord interactions webhook error");
    res.status(500).json({ error: "Webhook error" });
  }
});

/** Webhook endpoint for Telegram updates */
router.post("/connectors/telegram/webhook", async (req: Request, res: Response) => {
  try {
    const { message, edited_message } = req.body;
    const msg = message || edited_message;

    if (msg?.text?.startsWith("/infinity")) {
      const parts = msg.text.split(" ");
      const command = parts[0].replace("/infinity", "").replace("@", "").trim() || "help";
      const args = parts.slice(1);

      await processTelegramCommand({
        command,
        args,
        chatId: String(msg.chat.id),
        userId: String(msg.from?.id),
        userName: msg.from?.username || msg.from?.first_name || "Unknown",
        projectId: req.query.projectId as string,
        connectorId: req.query.connectorId as string,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Telegram webhook error");
    res.status(500).json({ error: "Webhook error" });
  }
});

/** Webhook endpoint for Linear events */
router.post("/connectors/linear/webhook", async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    const signature = req.headers["linear-signature"] as string;

    // Verify webhook signature if secret is configured
    // In production, verify signature against connector's webhookSecret

    // Find connector for this webhook
    // In production, would use a mapping from webhook URL to connector
    logger.info({ action: payload.action, type: payload.type, projectId: req.query.projectId }, "Linear webhook received");

    // Process asynchronously
    // processLinearWebhook(payload).catch(err => logger.error({ err }, "Linear webhook processing failed"));

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Linear webhook error");
    res.status(500).json({ error: "Webhook error" });
  }
});

/** Webhook endpoint for Notion events */
router.post("/connectors/notion/webhook", async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    const signature = req.headers["notion-signature"] as string;

    // Verify webhook signature if secret is configured
    // In production, verify signature against connector's webhookSecret

    logger.info({ type: payload.type, projectId: req.query.projectId }, "Notion webhook received");

    // Process asynchronously
    // processNotionWebhook(payload).catch(err => logger.error({ err }, "Notion webhook processing failed"));

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Notion webhook error");
    res.status(500).json({ error: "Webhook error" });
  }
});

/** Webhook endpoint for Google Sheets/Drive push notifications */
router.post("/connectors/google-sheets/webhook", async (req: Request, res: Response) => {
  try {
    const payload = req.body;

    // Google Drive push notifications don't use signatures
    // They send a channel resource with id and resourceId

    logger.info({ resourceId: payload.resourceId, projectId: req.query.projectId }, "Google Sheets webhook received");

    // Process asynchronously
    // processGoogleSheetsWebhook(payload).catch(err => logger.error({ err }, "Google Sheets webhook processing failed"));

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Google Sheets webhook error");
    res.status(500).json({ error: "Webhook error" });
  }
});

/** OAuth callback for Slack */
router.get("/connectors/slack/oauth/callback", async (req: Request, res: Response) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      res.status(400).send(`OAuth error: ${oauthError}`);
      return;
    }

    if (!code) {
      res.status(400).send("Missing authorization code");
      return;
    }

    // Exchange code for access token
    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      res.status(500).send("Slack OAuth not configured on server");
      return;
    }

    const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code as string,
      }),
    });

    const tokenData = await tokenResponse.json() as Record<string, any>;

    if (!tokenData.ok) {
      res.status(400).send(`Token exchange failed: ${tokenData.error}`);
      return;
    }

    // state should contain projectId|connectorId
    const [projectId, connectorId] = (state as string).split("|");

    // Update connector with installation info
    await db.update(connectors)
      .set({
        config: {
          botToken: tokenData.access_token,
          teamId: tokenData.team?.id,
          teamName: tokenData.team?.name,
          botUserId: tokenData.bot_user_id,
        },
        installation: {
          accessToken: tokenData.access_token,
          tokenType: tokenData.token_type,
          scope: tokenData.scope,
          teamId: tokenData.team?.id,
          teamName: tokenData.team?.name,
          botUserId: tokenData.bot_user_id,
          installedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, connectorId as string));

    await logActivity(projectId as string, "agent_ran", `Slack OAuth completed for connector`);

    res.send(`
      <html>
        <body style="font-family: system-ui; text-align: center; padding: 50px;">
          <h1>✅ Slack Connected</h1>
          <p>Your Slack workspace has been connected to Infinity.</p>
          <p>You can close this window.</p>
        </body>
      </html>
    `);
  } catch (err) {
    logger.error({ err }, "Slack OAuth callback error");
    res.status(500).send("OAuth callback failed");
  }
});

/** OAuth callback for Discord */
router.get("/connectors/discord/oauth/callback", async (req: Request, res: Response) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      res.status(400).send(`OAuth error: ${oauthError}`);
      return;
    }

    if (!code) {
      res.status(400).send("Missing authorization code");
      return;
    }

    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      res.status(500).send("Discord OAuth not configured on server");
      return;
    }

    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code: code as string,
        redirect_uri: `${process.env.API_BASE_URL || "http://localhost:3000"}/api/infinity/connectors/discord/oauth/callback`,
      }),
    });

    const tokenData = await tokenResponse.json() as Record<string, any>;

    if (!tokenResponse.ok) {
      res.status(400).send(`Token exchange failed: ${JSON.stringify(tokenData)}`);
      return;
    }

    // Get user info to verify
    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userResponse.json() as Record<string, any>;

    const [projectId, connectorId] = (state as string).split("|");

    await db.update(connectors)
      .set({
        config: {
          botToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          userId: userData.id,
          username: userData.username,
        },
        installation: {
          accessToken: tokenData.access_token,
          tokenType: tokenData.token_type,
          scope: tokenData.scope,
          userId: userData.id,
          username: userData.username,
          installedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, connectorId as string));

    await logActivity(projectId as string, "agent_ran", `Discord OAuth completed for connector`);

    res.send(`
      <html>
        <body style="font-family: system-ui; text-align: center; padding: 50px;">
          <h1>✅ Discord Connected</h1>
          <p>Your Discord account has been connected to Infinity.</p>
          <p>You can close this window.</p>
        </body>
      </html>
    `);
  } catch (err) {
    logger.error({ err }, "Discord OAuth callback error");
    res.status(500).send("OAuth callback failed");
  }
});

/** OAuth callback for Linear */
router.get("/connectors/linear/oauth/callback", async (req: Request, res: Response) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      res.status(400).send(`OAuth error: ${oauthError}`);
      return;
    }

    if (!code) {
      res.status(400).send("Missing authorization code");
      return;
    }

    const clientId = process.env.LINEAR_CLIENT_ID;
    const clientSecret = process.env.LINEAR_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      res.status(500).send("Linear OAuth not configured on server");
      return;
    }

    const tokenResponse = await fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code: code as string,
        redirect_uri: `${process.env.API_BASE_URL || "http://localhost:3000"}/api/infinity/connectors/linear/oauth/callback`,
      }),
    });

    const tokenData = await tokenResponse.json() as Record<string, any>;

    if (!tokenResponse.ok) {
      res.status(400).send(`Token exchange failed: ${JSON.stringify(tokenData)}`);
      return;
    }

    // Get user info
    const userResponse = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": tokenData.access_token,
      },
      body: JSON.stringify({
        query: `query { viewer { id name email } }`,
      }),
    });
    const userData = await userResponse.json() as Record<string, any>;

    const [projectId, connectorId] = (state as string).split("|");

    await db.update(connectors)
      .set({
        config: {
          apiKey: tokenData.access_token,
          teamId: userData.data?.viewer?.id,
          userName: userData.data?.viewer?.name,
          email: userData.data?.viewer?.email,
        },
        installation: {
          accessToken: tokenData.access_token,
          tokenType: tokenData.token_type,
          scope: tokenData.scope,
          userId: userData.data?.viewer?.id,
          userName: userData.data?.viewer?.name,
          email: userData.data?.viewer?.email,
          installedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, connectorId as string));

    await logActivity(projectId as string, "agent_ran", `Linear OAuth completed for connector`);

    res.send(`
      <html>
        <body style="font-family: system-ui; text-align: center; padding: 50px;">
          <h1>✅ Linear Connected</h1>
          <p>Your Linear account has been connected to Infinity.</p>
          <p>You can close this window.</p>
        </body>
      </html>
    `);
  } catch (err) {
    logger.error({ err }, "Linear OAuth callback error");
    res.status(500).send("OAuth callback failed");
  }
});

/** OAuth callback for Notion */
router.get("/connectors/notion/oauth/callback", async (req: Request, res: Response) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      res.status(400).send(`OAuth error: ${oauthError}`);
      return;
    }

    if (!code) {
      res.status(400).send("Missing authorization code");
      return;
    }

    const clientId = process.env.NOTION_CLIENT_ID;
    const clientSecret = process.env.NOTION_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      res.status(500).send("Notion OAuth not configured on server");
      return;
    }

    const tokenResponse = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: code as string,
        redirect_uri: `${process.env.API_BASE_URL || "http://localhost:3000"}/api/infinity/connectors/notion/oauth/callback`,
      }),
    });

    const tokenData = await tokenResponse.json() as Record<string, any>;

    if (!tokenResponse.ok) {
      res.status(400).send(`Token exchange failed: ${JSON.stringify(tokenData)}`);
      return;
    }

    // Get bot info
    const botResponse = await fetch("https://api.notion.com/v1/users/me", {
      headers: {
        "Authorization": `Bearer ${tokenData.access_token}`,
        "Notion-Version": "2022-06-28",
      },
    });
    const botData = await botResponse.json() as Record<string, any>;

    const [projectId, connectorId] = (state as string).split("|");

    await db.update(connectors)
      .set({
        config: {
          apiKey: tokenData.access_token,
          botId: botData.bot_id,
          workspaceId: tokenData.workspace_id,
          workspaceName: tokenData.workspace_name,
          owner: botData.owner,
        },
        installation: {
          accessToken: tokenData.access_token,
          tokenType: tokenData.token_type,
          workspaceId: tokenData.workspace_id,
          workspaceName: tokenData.workspace_name,
          botId: botData.bot_id,
          installedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, connectorId as string));

    await logActivity(projectId as string, "agent_ran", `Notion OAuth completed for connector`);

    res.send(`
      <html>
        <body style="font-family: system-ui; text-align: center; padding: 50px;">
          <h1>✅ Notion Connected</h1>
          <p>Your Notion workspace has been connected to Infinity.</p>
          <p>You can close this window.</p>
        </body>
      </html>
    `);
  } catch (err) {
    logger.error({ err }, "Notion OAuth callback error");
    res.status(500).send("OAuth callback failed");
  }
});

/** OAuth callback for Google Sheets */
router.get("/connectors/google-sheets/oauth/callback", async (req: Request, res: Response) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      res.status(400).send(`OAuth error: ${oauthError}`);
      return;
    }

    if (!code) {
      res.status(400).send("Missing authorization code");
      return;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      res.status(500).send("Google OAuth not configured on server");
      return;
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code: code as string,
        redirect_uri: `${process.env.API_BASE_URL || "http://localhost:3000"}/api/infinity/connectors/google-sheets/oauth/callback`,
      }),
    });

    const tokenData = await tokenResponse.json() as Record<string, any>;

    if (!tokenResponse.ok) {
      res.status(400).send(`Token exchange failed: ${JSON.stringify(tokenData)}`);
      return;
    }

    // Get user info
    const userResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userResponse.json() as Record<string, any>;

    const [projectId, connectorId] = (state as string).split("|");

    await db.update(connectors)
      .set({
        config: {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          clientId: clientId,
          clientSecret: clientSecret,
          email: userData.email,
          name: userData.name,
        },
        installation: {
          accessToken: tokenData.access_token,
          tokenType: tokenData.token_type,
          scope: tokenData.scope,
          refreshToken: tokenData.refresh_token,
          email: userData.email,
          name: userData.name,
          installedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, connectorId as string));

    await logActivity(projectId as string, "agent_ran", `Google Sheets OAuth completed for connector`);

    res.send(`
      <html>
        <body style="font-family: system-ui; text-align: center; padding: 50px;">
          <h1>✅ Google Sheets Connected</h1>
          <p>Your Google account has been connected to Infinity.</p>
          <p>You can close this window.</p>
        </body>
      </html>
    `);
  } catch (err) {
    logger.error({ err }, "Google Sheets OAuth callback error");
    res.status(500).send("OAuth callback failed");
  }
});

/** Helper: Sanitize config for API responses */
function sanitizeConfig(config: any): any {
  if (!config || typeof config !== "object") return config;

  const sanitized = { ...config };
  const sensitiveKeys = ["botToken", "webhookUrl", "accessToken", "refreshToken", "secretToken", "signingSecret", "clientSecret"];

  for (const key of sensitiveKeys) {
    if (key in sanitized) {
      sanitized[key] = "[REDACTED]";
    }
  }

  return sanitized;
}

/** Process Slack command from event */
async function processSlackCommand(event: any): Promise<void> {
  const text = event.text || "";
  const match = text.match(/\/infinity\s+(\w+)(?:\s+(.*))?/);
  if (!match) return;

  const command = match[1];
  const args = match[2] ? match[2].split(" ").filter(Boolean) : [];

  // Find connector for this team/channel
  // This would need a mapping from team_id to connector
  logger.info({ command, args, teamId: event.team_id }, "Slack command received");
}

/** Process Discord command from interaction */
async function processDiscordCommand(context: any): Promise<void> {
  // Find connector and execute
  // This would need projectId/connectorId mapping
  logger.info({ command: context.command, args: context.args }, "Discord command received");
}

/** Process Telegram command from webhook */
async function processTelegramCommand(context: any): Promise<void> {
  const [connectorRecord] = await db.select().from(connectors).where(eq(connectors.id, context.connectorId)).limit(1);
  if (!connectorRecord) return;

  const connector = await createConnector(
    connectorRecord.platform,
    connectorRecord.config as Record<string, any>,
    connectorRecord.projectId,
    connectorRecord.id
  );

  await connector.handleCommand(context);
}

/** Send notification to all enabled connectors for a project/event */
export async function dispatchNotification(
  projectId: string,
  eventType: string,
  title: string,
  body: string,
  options?: { url?: string; metadata?: Record<string, unknown> }
): Promise<void> {
  try {
    const projectConnectors = await db
      .select()
      .from(connectors)
      .where(and(eq(connectors.projectId, projectId), eq(connectors.enabled, true)));

    const notifyOn = ["build_completed", "build_failed", "research_completed", "scheduled_job_failed", "deployment_completed", "deployment_failed"];

    for (const connectorRecord of projectConnectors) {
      const notifyEvents = connectorRecord.notifyOn as string[] | undefined;
      const shouldNotify = notifyEvents?.includes(eventType) || notifyEvents?.includes("*");
      if (!shouldNotify) continue;

      try {
        const connector = await createConnector(
          connectorRecord.platform,
          connectorRecord.config as Record<string, any>,
          connectorRecord.projectId,
          connectorRecord.id
        );

        await connector.sendNotification({
          eventType,
          title,
          body,
          url: options?.url,
          metadata: { ...options?.metadata, projectId },
        });
      } catch (err) {
        logger.error({ err, connectorId: connectorRecord.id }, "Failed to send notification via connector");
      }
    }
  } catch (err) {
    logger.error({ err, projectId, eventType }, "Failed to dispatch notifications");
  }
}

export default router;