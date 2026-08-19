/**
 * Jarvis's Personal Browser, Puppeteer-based visible browser.
 * The user can see exactly what Jarvis is browsing, and can take control at any time.
 *
 * Architecture:
 * - Backend: Puppeteer browser instance, screenshot streaming via WebSocket
 * - Frontend: Browser viewer component showing live screenshots
 * - User can: watch Jarvis browse, see clicks/cursor, take over control
 */

import puppeteer, { Browser, Page } from "puppeteer";
import { WebSocketServer, WebSocket } from "ws";
import { createServer, Server as HttpServer } from "http";
import { EventEmitter } from "events";
import type { Dirent } from "fs";

export interface BrowserState {
  url: string;
  title: string;
  loading: boolean;
  cursorX: number;
  cursorY: number;
  viewportWidth: number;
  viewportHeight: number;
}

/** A numbered interactive element the agent can click/type into by index. */
export interface InteractiveElement {
  index: number;
  tag: string;
  text: string;
  hint: string;
}

// ── Always-on content guardrails ──────────────────────────────────────────
// These are enforced inside the browser itself (request interception +
// navigation refusal), so the agent cannot disable them, uninstall them, or
// navigate around them. chrome:// URLs are refused so the agent can never
// reach extension/settings management pages.

const ADULT_DOMAINS: string[] = [
  // Major porn tube/streaming sites
  "pornhub.com", "xvideos.com", "xhamster.com", "xnxx.com", "redtube.com",
  "youporn.com", "tube8.com", "spankbang.com", "beeg.com", "porntrex.com",
  "tnaflix.com", "youjizz.com", "motherless.com", "sxyprn.com", "xozilla.com",
  // Live cams
  "chaturbate.com", "stripchat.com", "livejasmin.com", "cam4.com", "myfreecams.com",
  "camgirls.com", "camster.com", "xmodels.com",
  // Premium studios
  "brazzers.com", "bangbros.com", "realitykings.com", "naughtyamerica.com",
  "evilangel.com", "vixen.com", "blacked.com", "vixenplus.com",
  // Community / fan content
  "onlyfans.com", "fansly.com", "manyvids.com", "erome.com", "porn.com", "sex.com",
  "fetlife.com", "adultfriendfinder.com", "adultfriendfinder.ru",
  // Hentai / anime adult
  "nhentai.net", "hentaihaven.org", "hitomi.la", "xbooru.com", "rule34.xxx",
  "gelbooru.com", "e621.net",
];

const ADULT_HOST_KEYWORD_RE =
  /\b(porn|porno|sexcam|sexcams|hentai|milf|nude|nudes|escorts?|camgirl|camgirllive|blowjob|threesome|bigtits|barelylegal)\b/i;

function isBlockedUrl(raw: string, forNavigation = false): { blocked: boolean; reason: string } {
  // chrome:// (settings/extensions management) is never a legitimate web target.
  if (raw.startsWith("chrome://")) {
    return { blocked: true, reason: "browser-internal page" };
  }
  // For navigation, also refuse chrome-extension:// (extension dashboards). In
  // the request layer those must stay ALLOWED, loaded extensions fetch their
  // own resources over chrome-extension:// (blocking would break uBlock).
  if (forNavigation && raw.startsWith("chrome-extension://")) {
    return { blocked: true, reason: "browser-internal page" };
  }
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (ADULT_DOMAINS.some((d) => host === d || host.endsWith("." + d))) {
      return { blocked: true, reason: "adult content" };
    }
    if (host.split(".").some((label) => ADULT_HOST_KEYWORD_RE.test(label))) {
      return { blocked: true, reason: "adult content (keyword)" };
    }
    return { blocked: false, reason: "" };
  } catch {
    return { blocked: false, reason: "" };
  }
}

/**
 * Find a usable Chrome/Chromium binary across the common Puppeteer cache
 * locations. The server may run under a different user (e.g. root) than the
 * user that downloaded the browser, so we scan known cache roots.
 */
async function resolveChromeExecutable(): Promise<string | undefined> {
  const fs = await import("fs");
  const os = await import("os");
  const path = await import("path");

  // 1. Explicit override wins.
  const override = process.env["PUPPETEER_EXECUTABLE_PATH"];
  if (override && fs.existsSync(override)) return override;

  // 2. Puppeteer's own resolution (respects PUPPETEER_CACHE_DIR).
  try {
    const p = await puppeteer.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch {
    // Not found on the default cache, fall through to manual scan.
  }

  // 3. Depth-limited scan for a chrome/chrome-headless-shell binary.
  const roots = [
    process.env["PUPPETEER_CACHE_DIR"],
    path.join(os.homedir(), ".cache", "puppeteer"),
    "/home/daytona/.cache/puppeteer",
    "/root/.cache/puppeteer",
    "/home/kasperkal1970/.cache/puppeteer",
  ].filter(Boolean) as string[];

  const findBinary = (dir: string, name: string, depth: number): string | undefined => {
    if (depth > 5) return undefined;
    let entries: Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findBinary(full, name, depth + 1);
        if (found) return found;
      } else if (entry.isFile() && entry.name === name) {
        return full;
      }
    }
    return undefined;
  };

  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    const full = findBinary(root, "chrome", 0);
    if (full) return full;
  }
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    const shell = findBinary(root, "chrome-headless-shell", 0);
    if (shell) return shell;
  }
  return undefined;
}

export interface BrowseAction {
  action: "navigate" | "click" | "type" | "enter" | "scroll" | "screenshot" | "back" | "forward" | "close";
  payload?: string | { selector?: string; x?: number; y?: number; text?: string; dx?: number; dy?: number };
}

export class JarvisBrowser extends EventEmitter {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private wss: WebSocketServer | null = null;
  private screenshotInterval: ReturnType<typeof setInterval> | null = null;
  private state: BrowserState = {
    url: "",
    title: "",
    loading: false,
    cursorX: 0,
    cursorY: 0,
    viewportWidth: 1280,
    viewportHeight: 720,
  };
  private wsClients: Set<WebSocket> = new Set();
  private httpServer: HttpServer | null = null;

  /**
   * Serialises screenshot capture. The live 4fps broadcast loop and the
   * agent's grid screenshots can otherwise fire concurrent CDP capture
   * commands on the same page, which causes "detached Frame" errors.
   */
  private screenshotChain: Promise<unknown> = Promise.resolve();

  private withScreenshotLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.screenshotChain.then(fn, fn);
    this.screenshotChain = run.catch(() => {});
    return run;
  }

  constructor(private wsPort: number = 3002) {
    super();
  }

  /** Launch the browser and WebSocket server */
  async launch(): Promise<void> {
    const path = await import("path");
    const os = await import("os");
    // Persistent profile, an ephemeral profile makes every session a brand-new
    // "first visit" (no cookies/localStorage), which is the #1 captcha magnet.
    // Falls back to ephemeral if the profile can't be opened (corrupt/locked).
    // Set JARVIS_BROWSER_PROFILE_DIR to override the location, or
    // JARVIS_BROWSER_HEADLESS=false to open a visible window on the host display
    // (much less likely to be flagged as a bot).
    const profileDir =
      process.env.JARVIS_BROWSER_PROFILE_DIR ||
      path.join(os.homedir(), ".jarvis-browser-profile");
    const headless = process.env.JARVIS_BROWSER_HEADLESS !== "false";
    // Optional unpacked Chrome extensions. Explicit paths win; otherwise any
    // subfolders of ~/.jarvis-browser-extensions are loaded (that's where
    // scripts/install-extensions.sh puts them). Loading extensions requires
    // dropping --single-process (extensions run in their own processes/service
    // workers), so the two are mutually exclusive.
    let extensionPaths = (process.env.JARVIS_BROWSER_EXTENSIONS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (extensionPaths.length === 0) {
      const extDir = path.join(os.homedir(), ".jarvis-browser-extensions");
      try {
        const fsMod = await import("fs");
        extensionPaths = fsMod
          .readdirSync(extDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => path.join(extDir, e.name));
      } catch {
        // No default extension directory, run without extensions.
      }
    }
    const args = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
    ];
    if (extensionPaths.length > 0) {
      args.push(`--disable-extensions-except=${extensionPaths.join(",")}`);
      args.push(`--load-extension=${extensionPaths.join(",")}`);
    } else {
      args.push("--single-process");
    }
    const launchOpts = {
      headless,
      executablePath: await resolveChromeExecutable(),
      args,
      defaultViewport: {
        width: this.state.viewportWidth,
        height: this.state.viewportHeight,
      },
      userDataDir: profileDir,
    };
    try {
      this.browser = await puppeteer.launch(launchOpts);
    } catch (err) {
      console.warn(`[Jarvis Browser] persistent profile failed, using ephemeral: ${(err as Error).message}`);
      this.browser = await puppeteer.launch({ ...launchOpts, userDataDir: undefined });
    }

    this.page = await this.browser.newPage();

    // Always-on guardrails: abort requests to adult / browser-internal URLs so
    // the agent can't fetch them even indirectly. The agent has no way to turn
    // this off, it's enforced at the network layer inside the browser.
    await this.page.setRequestInterception(true);
    this.page.on("request", (req) => {
      const check = isBlockedUrl(req.url());
      if (check.blocked) void req.abort();
      else void req.continue();
    });

    // Navigate to default page
    await this.page.goto("about:blank");

    // Set up page event listeners
    this.page.on("load", () => {
      this.state.loading = false;
      this.updateState();
    });

    this.page.on("framenavigated", () => {
      this.state.url = this.page?.url() ?? "";
      this.updateState();
    });

    // Start WebSocket server for screenshot streaming
    this.startWebSocketServer();

    // Start screenshot capture loop
    this.startScreenshotLoop();

    this.emit("ready");
  }

  /** Start WebSocket server for streaming screenshots to the frontend */
  private startWebSocketServer(): void {
    this.httpServer = createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on("connection", (ws) => {
      this.wsClients.add(ws);
      this.emit("client-connected", this.wsClients.size);

      ws.on("close", () => {
        this.wsClients.delete(ws);
        this.emit("client-disconnected", this.wsClients.size);
      });

      // Send current state immediately on connect
      this.sendState(ws);
    });

    this.httpServer.listen(this.wsPort, () => {
      console.log(`[Jarvis Browser] WebSocket server on ws://localhost:${this.wsPort}`);
    });
  }

  /** Send current browser state to a specific client */
  private sendState(ws: WebSocket): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "state", data: this.state }));
    }
  }

  /** Broadcast browser state to all connected clients */
  private broadcastState(): void {
    const msg = JSON.stringify({ type: "state", data: this.state });
    for (const ws of this.wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  /** Broadcast a screenshot to all connected clients */
  private broadcastScreenshot(): Promise<void> {
    return this.withScreenshotLock(async () => {
      if (!this.page || this.wsClients.size === 0) return;
      try {
        const screenshot = await this.page.screenshot({
          type: "jpeg",
          quality: 70,
          encoding: "base64",
        });
        const msg = JSON.stringify({ type: "screenshot", data: screenshot });
        for (const ws of this.wsClients) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(msg);
          }
        }
      } catch {
        // Page might be navigating, skip this frame
      }
    });
  }

  /** Start periodic screenshot capture */
  private startScreenshotLoop(): void {
    // Capture screenshots at ~4 fps
    this.screenshotInterval = setInterval(() => {
      this.broadcastScreenshot().catch(() => {});
    }, 250);
  }

  /** Update browser state and notify clients */
  private updateState(): void {
    this.broadcastState();
    this.emit("state-changed", this.state);
  }

  /** Simulate a real cursor moving to a position */
  async moveCursor(x: number, y: number): Promise<void> {
    if (!this.page) return;
    this.state.cursorX = x;
    this.state.cursorY = y;
    await this.page.mouse.move(x, y);
    this.updateState();
  }

  // ── Actions that Jarvis (or the user) can perform ──

  /** Navigate to a URL */
  async navigate(url: string): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");
    const check = isBlockedUrl(url, true);
    if (check.blocked) {
      throw new Error(`Blocked: ${url} is ${check.reason}`);
    }
    this.state.loading = true;
    this.updateState();
    await this.page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    this.state.title = await this.page.title();
    this.state.url = this.page.url();
    this.state.loading = false;
    this.updateState();
  }

  /** Click at coordinates or on a selector */
  async click(target: { selector?: string; x?: number; y?: number }): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");

    if (target.selector) {
      const el = await this.page.$(target.selector);
      if (!el) throw new Error(`Element not found: ${target.selector}`);
      const box = await el.boundingBox();
      if (box) {
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        await this.moveCursor(cx, cy);
        await this.page.mouse.click(cx, cy);
      }
    } else if (target.x !== undefined && target.y !== undefined) {
      await this.moveCursor(target.x, target.y);
      await this.page.mouse.click(target.x, target.y);
    }
    this.updateState();
  }

  /** Type text into the currently focused element */
  async type(text: string): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");
    await this.page.keyboard.type(text, { delay: 30 }); // Type like a human
    this.updateState();
  }

  /** Press the Enter key (submit forms, search boxes, dialogs) */
  async pressEnter(): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");
    await this.page.keyboard.press("Enter");
    this.updateState();
  }

  /**
   * Take a screenshot with a fine-grained grid overlay (tiny cubes) drawn
   * on top, so the vision agent can reference exact pixel cells when
   * clicking. Columns run along the top edge, rows along the left edge,
   * each labelled. The overlay is injected as a DOM layer and removed
   * right after capture, so the user's live view is never affected.
   *
   * Cell sizes are intentionally small (default 24px, ~53×30 cells on a
   * 1280×720 viewport) so even tiny buttons can be hit precisely.
   */
  async takeGridScreenshot(
    cellSize = 24,
  ): Promise<{ image: string; cellSize: number; cols: number; rows: number }> {
    if (!this.page) throw new Error("Browser not launched");
    const vp = this.page.viewport();
    const width = vp?.width ?? this.state.viewportWidth;
    const height = vp?.height ?? this.state.viewportHeight;
    const cols = Math.ceil(width / cellSize);
    const rows = Math.ceil(height / cellSize);

    // Inject the grid overlay as a browser-side DOM layer. We use a STRING
    // evaluate (like getContent above) so the Node-side tsconfig does not
    // need the DOM lib, the code runs inside the page, not in Node.
    const injectScript = `
      (() => {
        const size = ${cellSize};
        const cols = ${cols};
        const rows = ${rows};
        document.getElementById("jarvis-grid-overlay")?.remove();
        const overlay = document.createElement("div");
        overlay.id = "jarvis-grid-overlay";
        overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
        const grid = document.createElement("div");
        grid.style.cssText = "position:absolute;inset:0;background-image:" +
          "repeating-linear-gradient(to right, rgba(255,90,150,0.6) 0px, rgba(255,90,150,0.6) 1px, transparent 1px, transparent " + size + "px)," +
          "repeating-linear-gradient(to bottom, rgba(90,220,255,0.6) 0px, rgba(90,220,255,0.6) 1px, transparent 1px, transparent " + size + "px);";
        overlay.appendChild(grid);
        const colRow = document.createElement("div");
        colRow.style.cssText = "position:absolute;top:0;left:0;display:flex;z-index:2;";
        for (let col = 1; col <= cols; col++) {
          const lbl = document.createElement("span");
          lbl.textContent = String(col);
          lbl.style.cssText = "width:" + size + "px;height:14px;font:600 8px/14px monospace;color:#ff8fb5;background:rgba(0,0,0,0.5);text-align:center;overflow:hidden;";
          colRow.appendChild(lbl);
        }
        overlay.appendChild(colRow);
        const rowCol = document.createElement("div");
        rowCol.style.cssText = "position:absolute;top:0;left:0;display:flex;flex-direction:column;z-index:2;";
        for (let row = 1; row <= rows; row++) {
          const lbl = document.createElement("span");
          lbl.textContent = String(row);
          lbl.style.cssText = "height:" + size + "px;width:22px;font:600 8px/1 monospace;color:#9fe8ff;background:rgba(0,0,0,0.5);text-align:center;display:flex;align-items:center;justify-content:center;overflow:hidden;";
          rowCol.appendChild(lbl);
        }
        overlay.appendChild(rowCol);
        document.documentElement.appendChild(overlay);
      })();
    `;

    // Capture under the screenshot mutex, with retries for transient
    // navigation races ("detached Frame" errors mid-load).
    return this.withScreenshotLock(async () => {
      let image = "";
      let lastErr: Error | null = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await this.page!.evaluate(injectScript);
          image = await this.page!.screenshot({
            type: "jpeg",
            quality: 75,
            encoding: "base64",
          });
          await this.page!
            .evaluate('document.getElementById("jarvis-grid-overlay")?.remove();')
            .catch(() => {});
          return { image, cellSize, cols, rows };
        } catch (err) {
          lastErr = err as Error;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      // Clean up the overlay on failure too.
      this.page
        ?.evaluate('document.getElementById("jarvis-grid-overlay")?.remove();')
        .catch(() => {});
      throw lastErr ?? new Error("Failed to capture grid screenshot");
    });
  }

  /** Scroll the page */
  async scroll(dx: number, dy: number): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");
    await this.page.evaluate(`window.scrollBy(${dx}, ${dy})`);
    this.updateState();
  }

  /** Go back in history */
  async goBack(): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");
    await this.page.goBack({ waitUntil: "networkidle2" });
    this.state.title = await this.page.title();
    this.state.url = this.page.url();
    this.updateState();
  }

  /** Go forward in history */
  async goForward(): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");
    await this.page.goForward({ waitUntil: "networkidle2" });
    this.state.title = await this.page.title();
    this.state.url = this.page.url();
    this.updateState();
  }

  /** Get the current page content as text */
  async getContent(maxLength = 8000): Promise<string> {
    if (!this.page) return "";
    const text = (await this.page.evaluate("document.body?.innerText ?? ''")) as string;
    return text.slice(0, maxLength);
  }

  /**
   * Extract a numbered list of interactive elements from the current page.
   * Each element is tagged with `data-jarvis-idx` so the agent can click/type
   * into it by stable selector (`[data-jarvis-idx="N"]`) on its next action —
   * far more reliable than guessing pixel cells. Tags attach to the live DOM
   * and disappear automatically on navigation (new document).
   *
   * Clickability is detected with multiple signals, because markup alone
   * misses most modern apps:
   *   1. Structural tags + roles + tabindex + inline handlers.
   *   2. Computed `cursor: pointer`, the reliable signal for React/Vue apps,
   *      which attach click handlers via event delegation (no `[onclick]`
   *      attribute ever exists in the DOM).
   * Skips invisible/zero-size elements, elements nested inside a bigger
   * interactive element (keep the outer target), and giant containers styled
   * with `cursor: pointer` that aren't discrete controls.
   */
  async getInteractiveElements(maxItems = 30): Promise<InteractiveElement[]> {
    if (!this.page) return [];
    return (await this.page.evaluate(
      (max: number) => {
        // Runs in the browser context, the server tsconfig has no DOM lib, so
        // type everything as any here instead of referencing DOM globals.
        const doc: any = (globalThis as any).document;
        const out: { index: number; tag: string; text: string; hint: string }[] = [];
        const seen = new Set<any>();

        const isVisible = (el: any): boolean => {
          const rect = el.getBoundingClientRect();
          return rect && rect.width >= 4 && rect.height >= 4;
        };

        const describe = (el: any): { tag: string; text: string; hint: string } | null => {
          const tag = (el.tagName || "").toLowerCase();
          const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
          let hint = "";
          if (tag === "input" || tag === "textarea" || tag === "select") {
            const parts: string[] = [];
            const ph = (el.placeholder ?? "").trim();
            const val = (el.value ?? "").trim().slice(0, 30);
            const type = (el.type ?? "").toLowerCase();
            if (ph) parts.push(`placeholder "${ph}"`);
            if (val) parts.push(`value "${val}"`);
            if (type && type !== "text") parts.push(type);
            hint = parts.join(", ");
          } else {
            const aria = el.getAttribute && el.getAttribute("aria-label");
            if (aria) hint = `aria "${aria}"`;
          }
          if (!text && !hint && tag !== "input" && tag !== "textarea") return null;
          return { tag, text, hint };
        };

        // skipNested=false: also drop elements inside an already-tagged ancestor
        // (a tagged parent makes the descendant redundant as a click target).
        const tryAdd = (el: any, skipNested = false): void => {
          if (out.length >= max || seen.has(el)) return;
          if (!isVisible(el)) return;
          if (!skipNested) {
            const anc = el.closest && el.closest("[data-jarvis-idx]");
            if (anc && anc !== el) return;
          }
          const d = describe(el);
          if (!d) return;
          el.setAttribute("data-jarvis-idx", String(out.length));
          seen.add(el);
          out.push({ index: out.length, tag: d.tag, text: d.text, hint: d.hint });
        };

        // Pass 1, structural signals (tags + ANY role + tabindex + inline handlers).
        const STRUCTURAL =
          "a, button, input, textarea, select, summary, label, " +
          "[role], [onclick], [onmousedown], [onpointerdown], [onkeydown], [tabindex]";
        const nodes = Array.from(doc.querySelectorAll(STRUCTURAL));
        for (const n of nodes) {
          if (out.length >= max) break;
          tryAdd(n, true);
        }

        // Pass 2, computed cursor:pointer catches clickable divs/spans/lis that
        // have no markup signal (React/Vue event delegation). Capped walk so
        // getComputedStyle cost stays bounded on huge pages.
        if (out.length < max) {
          const all: any[] = Array.from(doc.querySelectorAll("*"));
          const budget = Math.min(all.length, 2500);
          for (let i = 0; i < budget && out.length < max; i++) {
            const el: any = all[i];
            const tag = (el.tagName || "").toLowerCase();
            if (tag === "script" || tag === "style" || tag === "link" || tag === "meta" || tag === "head" || tag === "html") continue;
            // Cheap pre-filter before the expensive getComputedStyle: must have
            // some identifying content, and not already be covered.
            if (el.closest && el.closest("[data-jarvis-idx]")) continue;
            if (!el.textContent && !(el.getAttribute && el.getAttribute("aria-label"))) continue;
            let cursor = "";
            try {
              cursor = (globalThis as any).getComputedStyle(el).cursor;
            } catch {
              continue;
            }
            if (cursor !== "pointer") continue;
            // Skip giant containers (whole-page wrappers styled cursor:pointer).
            if ((el.children ? el.children.length : 0) > 12 && (el.textContent || "").trim().length > 300) continue;
            tryAdd(el);
          }
        }
        return out;
      },
      maxItems,
    )) as InteractiveElement[];
  }

  /**
   * Detect whether the current page is showing an anti-bot challenge
   * (reCAPTCHA, hCaptcha, Cloudflare Turnstile, geetest, …). The agent loop
   * uses this to auto-pause so the human can solve it in the PiP viewer's
   * manual controls, then resume, the agent can't (and shouldn't) solve it.
   */
  async hasCaptcha(): Promise<boolean> {
    if (!this.page) return false;
    try {
      return (await this.page.evaluate(() => {
        const w: any = globalThis;
        const doc: any = w.document;
        const bodyText = (doc.body?.innerText || "").toLowerCase();
        const iframes: string[] = Array.from(doc.querySelectorAll("iframe[src]")).map((f: any) => String(f.src || "").toLowerCase());
        const providers = ["recaptcha", "hcaptcha", "turnstile", "geetest", "cf-challenge", "cloudflare", "akamai"];
        // Known captcha iframe hosts / widget markup.
        if (iframes.some((s) => providers.some((p) => s.includes(p)))) return true;
        if (doc.querySelector('[data-sitekey], .g-recaptcha, .h-captcha, #captcha, .captcha, [class*="cf-challenge"], [class*="turnstile"]')) return true;
        // Body text signals (provider names + common challenge phrases).
        if (providers.slice(0, 4).some((p) => bodyText.includes(p))) return true;
        return /\b(verify you are human|prove you.?re human|i.?m not a robot|are you a robot|security check|checking your browser|press and hold|select all .*images|unusual traffic)\b/.test(bodyText);
      })) as boolean;
    } catch {
      return false;
    }
  }

  /** Get current state */
  getState(): BrowserState {
    return { ...this.state };
  }

  /** Get the underlying Puppeteer page for advanced operations */
  getPage(): Page | null {
    return this.page;
  }

  /** Execute an action and return the result */
  async executeAction(action: BrowseAction): Promise<{ success: boolean; error?: string; data?: any }> {
    try {
      switch (action.action) {
        case "navigate":
          await this.navigate(action.payload as string);
          return { success: true, data: { url: this.state.url, title: this.state.title } };
        case "click":
          await this.click(action.payload as any);
          return { success: true };
        case "type":
          await this.type((action.payload as any)?.text ?? "");
          return { success: true };
        case "enter":
          await this.pressEnter();
          return { success: true };
        case "scroll":
          await this.scroll((action.payload as any)?.dx ?? 0, (action.payload as any)?.dy ?? 200);
          return { success: true };
        case "back":
          await this.goBack();
          return { success: true, data: { url: this.state.url } };
        case "forward":
          await this.goForward();
          return { success: true, data: { url: this.state.url } };
        case "screenshot":
          return { success: true };
        case "close":
          await this.close();
          return { success: true };
        default:
          return { success: false, error: `Unknown action: ${(action as any).action}` };
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /** Close the browser and clean up */
  async close(): Promise<void> {
    if (this.screenshotInterval) {
      clearInterval(this.screenshotInterval);
      this.screenshotInterval = null;
    }
    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
    this.wsClients.clear();
    this.emit("closed");
  }
}
