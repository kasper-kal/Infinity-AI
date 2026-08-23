import { Router, Request, Response } from "express";
import {
  detectPlatform,
  getAllKeybindings,
  getKeybindingHelp,
  createKeybindingConfig,
  parseKeyboardEvent,
  updateCustomKeybinding,
  type Platform,
  type Action,
  type KeybindingConfig,
} from "../../lib/keybindings";

const router = Router();

// Store keybinding configs per user/session
const keybindingConfigs = new Map<string, KeybindingConfig>();

/**
 * Get platform from request
 */
function getPlatformFromRequest(req: Request): Platform {
  const userAgent = req.headers["user-agent"] || "";
  return detectPlatform(userAgent);
}

/**
 * Get user config ID
 */
function getConfigId(req: Request): string {
  return req.headers["x-user-id"]?.toString() || "default";
}

/**
 * Ensure config exists for user
 */
function ensureConfig(configId: string, platform: Platform): KeybindingConfig {
  if (!keybindingConfigs.has(configId)) {
    keybindingConfigs.set(configId, createKeybindingConfig(platform));
  }
  return keybindingConfigs.get(configId)!;
}

/**
 * GET /shortcuts - Get all keybindings for platform
 */
router.get("/shortcuts", (req: Request, res: Response) => {
  try {
    const platform = getPlatformFromRequest(req);
    const keybindings = getAllKeybindings(platform);
    res.json({ ok: true, platform, keybindings });
  } catch (err) {
    req.log.error({ err }, "Failed to get keybindings");
    res.status(500).json({ error: "Failed to get keybindings" });
  }
});

/**
 * GET /shortcuts/help - Get keybinding help overlay
 */
router.get("/shortcuts/help", (req: Request, res: Response) => {
  try {
    const platform = getPlatformFromRequest(req);
    const help = getKeybindingHelp(platform);
    res.json({ ok: true, platform, help });
  } catch (err) {
    req.log.error({ err }, "Failed to get keybinding help");
    res.status(500).json({ error: "Failed to get keybinding help" });
  }
});

/**
 * POST /shortcuts/parse - Parse keyboard event
 */
router.post("/shortcuts/parse", (req: Request, res: Response) => {
  try {
    const platform = getPlatformFromRequest(req);
    const { key, ctrlKey, metaKey, shiftKey } = req.body;

    if (!key) {
      return res.status(400).json({ error: "Missing key" });
    }

    const action = parseKeyboardEvent(key, ctrlKey || false, metaKey || false, shiftKey || false, platform);

    return res.json({ ok: true, action, platform });
  } catch (err) {
    req.log.error({ err }, "Failed to parse keyboard event");
    return res.status(500).json({ error: "Failed to parse keyboard event" });
  }
});

/**
 * POST /shortcuts/custom - Set custom keybinding
 */
router.post("/shortcuts/custom", (req: Request, res: Response) => {
  try {
    const platform = getPlatformFromRequest(req);
    const configId = getConfigId(req);
    const { shortcut, action } = req.body;

    if (!shortcut || !action) {
      return res.status(400).json({ error: "Missing shortcut or action" });
    }

    const config = ensureConfig(configId, platform);
    updateCustomKeybinding(config, shortcut, action as Action);

    return res.json({ ok: true, message: "Custom keybinding updated", config: config.customBindings });
  } catch (err) {
    req.log.error({ err }, "Failed to set custom keybinding");
    return res.status(500).json({ error: "Failed to set custom keybinding" });
  }
});

/**
 * GET /shortcuts/custom - Get custom keybindings for user
 */
router.get("/shortcuts/custom", (req: Request, res: Response) => {
  try {
    const platform = getPlatformFromRequest(req);
    const configId = getConfigId(req);
    const config = ensureConfig(configId, platform);

    res.json({ ok: true, customBindings: config.customBindings });
  } catch (err) {
    req.log.error({ err }, "Failed to get custom keybindings");
    res.status(500).json({ error: "Failed to get custom keybindings" });
  }
});

/**
 * POST /shortcuts/reset - Reset to default keybindings
 */
router.post("/shortcuts/reset", (req: Request, res: Response) => {
  try {
    const platform = getPlatformFromRequest(req);
    const configId = getConfigId(req);

    // Remove custom config and recreate with defaults
    keybindingConfigs.delete(configId);
    const config = ensureConfig(configId, platform);

    res.json({ ok: true, message: "Keybindings reset to default", keybindings: getAllKeybindings(platform) });
  } catch (err) {
    req.log.error({ err }, "Failed to reset keybindings");
    res.status(500).json({ error: "Failed to reset keybindings" });
  }
});

/**
 * POST /shortcuts/export - Export keybindings as JSON
 */
router.post("/shortcuts/export", (req: Request, res: Response) => {
  try {
    const platform = getPlatformFromRequest(req);
    const configId = getConfigId(req);
    const config = ensureConfig(configId, platform);
    const allBindings = getAllKeybindings(platform);

    const exportData = {
      platform,
      timestamp: new Date().toISOString(),
      defaultBindings: allBindings,
      customBindings: config.customBindings,
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", "attachment; filename=keybindings.json");
    res.send(JSON.stringify(exportData, null, 2));
  } catch (err) {
    req.log.error({ err }, "Failed to export keybindings");
    res.status(500).json({ error: "Failed to export keybindings" });
  }
});

/**
 * POST /shortcuts/import - Import keybindings from JSON
 */
router.post("/shortcuts/import", (req: Request, res: Response) => {
  try {
    const platform = getPlatformFromRequest(req);
    const configId = getConfigId(req);
    const { customBindings } = req.body;

    if (!customBindings || typeof customBindings !== "object") {
      return res.status(400).json({ error: "Invalid import format" });
    }

    const config = ensureConfig(configId, platform);

    // Import custom bindings
    for (const [shortcut, action] of Object.entries(customBindings)) {
      updateCustomKeybinding(config, shortcut, action as Action);
    }

    return res.json({ ok: true, message: "Keybindings imported", customBindings: config.customBindings });
  } catch (err) {
    req.log.error({ err }, "Failed to import keybindings");
    return res.status(500).json({ error: "Failed to import keybindings" });
  }
});

export default router;
