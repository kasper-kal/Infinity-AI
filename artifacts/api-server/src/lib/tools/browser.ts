/**
 * Phase 22: Universal Tool Layer — Browser Capability Integration
 *
 * Registers browser navigation, screenshot, and content-extraction tools.
 * Uses the existing JarvisBrowser (Puppeteer) instance management.
 */

import { registerTool } from "../tool-registry";
import { JarvisBrowser } from "../puppeteer-browser";
import { logger } from "../logger";
import type { UniversalToolDefinition, ToolExecutionContext, UniversalToolResult } from "../tool-types";

/** Shared browser instance for universal tools. */
let browser: JarvisBrowser | null = null;
let initializing = false;

async function getBrowser(): Promise<JarvisBrowser> {
  if (browser && !initializing) return browser;
  if (initializing) {
    await new Promise<void>((resolve) => {
      const check = () => {
        if (browser && !initializing) resolve();
        else setTimeout(check, 200);
      };
      check();
    });
    return browser!;
  }
  initializing = true;
  try {
    browser = new JarvisBrowser();
    await browser.launch();
  } catch (err) {
    browser = null;
    initializing = false;
    throw err;
  } finally {
    initializing = false;
  }
  return browser;
}

export function registerBrowserTools(): void {
  const navigate: UniversalToolDefinition = {
    name: "browser.navigate",
    description: "Navigate the shared Puppeteer browser to a URL. Returns the page title and final URL.",
    category: "browser",
    risk: "EXTERNAL_ACTION",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "Full URL to navigate to" } },
      required: ["url"],
    },
    timeoutMs: 35000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const url = String(args["url"] ?? "").trim();
      if (!url) return { success: false, error: "url is required" };
      try {
        const b = await getBrowser();
        await b.navigate(url);
        const state = b.getState();
        return { success: true, data: { title: state.title, url: state.url }, summary: `Navigated to ${state.url}` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Navigation failed" };
      }
    },
  };

  const screenshot: UniversalToolDefinition = {
    name: "browser.screenshot",
    description: "Capture a grid-annotated screenshot of the current browser page. Returns base64 JPEG + grid dimensions for vision agents.",
    category: "browser",
    risk: "READ",
    parameters: {
      type: "object",
      properties: { cellSize: { type: "number", description: "Grid cell size in px (default 24)" } },
    },
    timeoutMs: 15000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      try {
        const b = await getBrowser();
        const cellSize = typeof args["cellSize"] === "number" ? args["cellSize"] : 24;
        const shot = await b.takeGridScreenshot(cellSize);
        return {
          success: true,
          data: { image: shot.image, cellSize: shot.cellSize, cols: shot.cols, rows: shot.rows },
          summary: `Screenshot captured (${shot.cols}×${shot.rows} grid)`,
          artifacts: [{ type: "screenshot", title: "Browser screenshot", data: { image: shot.image, cols: shot.cols, rows: shot.rows } }],
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Screenshot failed" };
      }
    },
  };

  const extract: UniversalToolDefinition = {
    name: "browser.extract",
    description: "Extract text content and interactive elements (links, buttons, inputs) from the current page. Use after navigation.",
    category: "browser",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        maxTextLength: { type: "number", description: "Max text chars (default 8000)" },
        maxElements: { type: "number", description: "Max interactive elements (default 30)" },
      },
    },
    timeoutMs: 15000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      try {
        const b = await getBrowser();
        const maxText = typeof args["maxTextLength"] === "number" ? args["maxTextLength"] : 8000;
        const maxElems = typeof args["maxElements"] === "number" ? args["maxElements"] : 30;
        const text = await b.getContent(maxText);
        const elements = await b.getInteractiveElements(maxElems);
        return {
          success: true,
          data: {
            text,
            elements: elements.map((e) => ({ index: e.index, tag: e.tag, text: e.text, hint: e.hint })),
          },
          summary: `Extracted ${elements.length} interactive elements`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Extraction failed" };
      }
    },
  };

  const click: UniversalToolDefinition = {
    name: "browser.click",
    description: "Click an interactive element on the current page by its index (from browser.extract) or a CSS selector.",
    category: "browser",
    risk: "EXTERNAL_ACTION",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        index: { type: "number", description: "Element index from browser.extract" },
        selector: { type: "string", description: "CSS selector of element to click" },
      },
    },
    timeoutMs: 15000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      try {
        const b = await getBrowser();
        if (typeof args["index"] === "number") {
          await b.click({ selector: `[data-jarvis-idx="${args["index"]}"]` });
        } else if (typeof args["selector"] === "string") {
          await b.click({ selector: args["selector"] });
        } else {
          return { success: false, error: "Provide index or selector" };
        }
        return { success: true, data: { ok: true }, summary: "Clicked element" };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Click failed" };
      }
    },
  };

  const type: UniversalToolDefinition = {
    name: "browser.type",
    description: "Type text into the focused element on the current page.",
    category: "browser",
    risk: "EXTERNAL_ACTION",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "Text to type" } },
      required: ["text"],
    },
    timeoutMs: 15000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const text = String(args["text"] ?? "");
      if (!text) return { success: false, error: "text is required" };
      try {
        const b = await getBrowser();
        await b.type(text);
        return { success: true, data: { ok: true }, summary: "Typed text" };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Type failed" };
      }
    },
  };

  registerTool(navigate);
  registerTool(screenshot);
  registerTool(extract);
  registerTool(click);
  registerTool(type);
  logger.info("[tools/browser] Registered browser.navigate, screenshot, extract, click, type");
}
