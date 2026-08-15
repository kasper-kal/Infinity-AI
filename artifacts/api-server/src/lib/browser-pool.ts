import { JarvisBrowser, type BrowserState, type InteractiveElement, type BrowseAction } from "./puppeteer-browser";
import { EventEmitter } from "events";

/**
 * Phase 4.2 — Browser Pool.
 *
 * Manages 3-5 pre-warmed Chromium instances with session persistence,
 * screenshot diffing, and CDP accessibility. Browser instances are
 * reused across build steps to avoid cold-start overhead.
 */

export interface PoolConfig {
  minSize: number;        // default 3
  maxSize: number;        // default 5
  idleTimeoutMs: number;  // default 5 min - close idle browsers after this
  wsPortStart: number;    // default 3002
  headless: boolean;      // default true
}

export interface BrowserSlot {
  id: string;
  browser: JarvisBrowser;
  wsPort: number;
  state: "idle" | "busy" | "starting" | "stopping";
  currentTask: string | null;
  acquiredAt: number | null;
  lastActivity: number;
  sessionData: Record<string, unknown>; // session persistence (cookies, localStorage refs)
}

const DEFAULT_CONFIG: PoolConfig = {
  minSize: 3,
  maxSize: 5,
  idleTimeoutMs: 5 * 60 * 1000,
  wsPortStart: 3002,
  headless: true,
};

/** Screenshot diff result for visual regression. */
export interface ScreenshotDiff {
  identical: boolean;
  diffPercent: number;
  diffImage?: string; // base64 PNG of diff
}

/** Accessibility snapshot from CDP. */
export interface AccessibilitySnapshot {
  tree: Record<string, unknown>;
  timestamp: string;
  url: string;
}

export class BrowserPool extends EventEmitter {
  private slots: BrowserSlot[] = [];
  private config: PoolConfig;
  private maintenanceInterval: ReturnType<typeof setInterval> | null = null;
  private startingCount = 0;

  constructor(config: Partial<PoolConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Get the pool configuration (read-only). */
  getConfig(): Readonly<PoolConfig> {
    return { ...this.config };
  }

  /** Initialize the pool with minimum browsers. */
  async initialize(): Promise<void> {
    for (let i = 0; i < this.config.minSize; i++) {
      await this.startBrowser(i);
    }
    this.startMaintenance();
    this.emit("ready");
  }

  /** Start a new browser instance in a slot. */
  private async startBrowser(index: number): Promise<void> {
    const wsPort = this.config.wsPortStart + this.slots.length + this.startingCount;
    const id = `browser-${wsPort}`;
    this.startingCount++;

    const slot: BrowserSlot = {
      id,
      browser: new JarvisBrowser(wsPort),
      wsPort,
      state: "starting",
      currentTask: null,
      acquiredAt: null,
      lastActivity: Date.now(),
      sessionData: {},
    };
    this.slots.push(slot);

    try {
      await slot.browser.launch();
      slot.state = "idle";
      this.startingCount--;

      slot.browser.on("state-changed", () => {
        slot.lastActivity = Date.now();
        this.emit("state-changed", { browserId: id, state: slot.browser.getState() });
      });

      slot.browser.on("client-connected", (count) => {
        this.emit("client-connected", { browserId: id, clients: count });
      });

      slot.browser.on("client-disconnected", (count) => {
        this.emit("client-disconnected", { browserId: id, clients: count });
      });

      slot.browser.on("closed", () => {
        this.onBrowserClosed(id);
      });

      this.emit("browser-started", { browserId: id, wsPort, index: this.slots.indexOf(slot) });
    } catch (err) {
      this.startingCount--;
      console.error({ err, id }, "Failed to start browser");
      this.slots = this.slots.filter((s) => s.id !== id);
      this.emit("browser-failed", { browserId: id, error: (err as Error).message });
    }
  }

  /** Handle browser process exit. */
  private onBrowserClosed(browserId: string): void {
    const slot = this.slots.find((s) => s.id === browserId);
    if (slot) {
      slot.state = "stopping";
      this.slots = this.slots.filter((s) => s.id !== browserId);
      this.emit("browser-closed", { browserId });
      // If we're below minimum, start a replacement
      if (this.slots.length + this.startingCount < this.config.minSize) {
        this.startBrowser(this.slots.length);
      }
    }
  }

  /** Acquire an idle browser for a task. */
  async acquire(taskId: string): Promise<BrowserSlot> {
    // Find idle browser
    let slot = this.slots.find((s) => s.state === "idle");

    if (!slot) {
      // No idle browsers - start a new one if under max
      if (this.slots.length + this.startingCount < this.config.maxSize) {
        await this.startBrowser(this.slots.length);
        slot = this.slots.find((s) => s.state === "idle");
      }
    }

    // Wait for one to become idle (with timeout)
    const waitStart = Date.now();
    const timeout = 30000; // 30s max wait
    while (!slot && Date.now() - waitStart < timeout) {
      await new Promise((r) => setTimeout(r, 500));
      slot = this.slots.find((s) => s.state === "idle");
    }

    if (!slot) {
      throw new Error("No available browser in pool (max size reached or all busy)");
    }

    slot.state = "busy";
    slot.currentTask = taskId;
    slot.acquiredAt = Date.now();
    slot.lastActivity = Date.now();
    this.emit("browser-acquired", { browserId: slot.id, taskId, wsPort: slot.wsPort });
    return slot;
  }

  /** Release a browser back to idle. */
  release(browserId: string): boolean {
    const slot = this.slots.find((s) => s.id === browserId);
    if (!slot) return false;
    slot.state = "idle";
    slot.currentTask = null;
    slot.acquiredAt = null;
    slot.lastActivity = Date.now();
    this.emit("browser-released", { browserId });
    return true;
  }

  /** Get a browser slot by ID (for direct access). */
  getSlot(browserId: string): BrowserSlot | undefined {
    return this.slots.find((s) => s.id === browserId);
  }

  /** Get all slots status. */
  getStatus(): Array<{
    id: string;
    wsPort: number;
    state: BrowserSlot["state"];
    currentTask: string | null;
    uptimeMs: number;
    lastActivity: number;
  }> {
    const now = Date.now();
    return this.slots.map((s) => ({
      id: s.id,
      wsPort: s.wsPort,
      state: s.state,
      currentTask: s.currentTask,
      uptimeMs: s.acquiredAt ? now - s.acquiredAt : 0,
      lastActivity: s.lastActivity,
    }));
  }

  /** Execute an action on a specific browser. */
  async executeAction(browserId: string, action: BrowseAction): Promise<{ success: boolean; error?: string; data?: any }> {
    const slot = this.slots.find((s) => s.id === browserId);
    if (!slot) return { success: false, error: "Browser not found" };
    slot.lastActivity = Date.now();
    return slot.browser.executeAction(action);
  }

  /** Navigate a browser to a URL. */
  async navigate(browserId: string, url: string): Promise<{ success: boolean; error?: string; data?: any }> {
    const slot = this.slots.find((s) => s.id === browserId);
    if (!slot) return { success: false, error: "Browser not found" };
    slot.lastActivity = Date.now();
    try {
      await slot.browser.navigate(url);
      return { success: true, data: { url: slot.browser.getState().url, title: slot.browser.getState().title } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /** Take a grid screenshot on a specific browser. */
  async takeGridScreenshot(browserId: string, cellSize = 24): Promise<{ success: boolean; error?: string; data?: any }> {
    const slot = this.slots.find((s) => s.id === browserId);
    if (!slot) return { success: false, error: "Browser not found" };
    slot.lastActivity = Date.now();
    try {
      const result = await slot.browser.takeGridScreenshot(cellSize);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /** Get interactive elements on a specific browser. */
  async getInteractiveElements(browserId: string, maxItems = 30): Promise<{ success: boolean; error?: string; data?: InteractiveElement[] }> {
    const slot = this.slots.find((s) => s.id === browserId);
    if (!slot) return { success: false, error: "Browser not found" };
    slot.lastActivity = Date.now();
    try {
      const elements = await slot.browser.getInteractiveElements(maxItems);
      return { success: true, data: elements };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /** Check for captcha on a specific browser. */
  async hasCaptcha(browserId: string): Promise<{ success: boolean; error?: string; data?: boolean }> {
    const slot = this.slots.find((s) => s.id === browserId);
    if (!slot) return { success: false, error: "Browser not found" };
    try {
      const has = await slot.browser.hasCaptcha();
      return { success: true, data: has };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /** Get current state of a browser. */
  getState(browserId: string): BrowserState | null {
    const slot = this.slots.find((s) => s.id === browserId);
    return slot ? slot.browser.getState() : null;
  }

  /** Capture full-page screenshot as base64 PNG. */
  async captureScreenshot(browserId: string): Promise<{ success: boolean; error?: string; data?: string }> {
    const slot = this.slots.find((s) => s.id === browserId);
    if (!slot) return { success: false, error: "Browser not found" };
    slot.lastActivity = Date.now();
    try {
      const screenshot = await slot.browser.takeGridScreenshot(100); // Large cells = no grid
      return { success: true, data: screenshot.image };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /** Compare two screenshots (simple pixel diff). */
  async diffScreenshots(base64A: string, base64B: string): Promise<ScreenshotDiff> {
    // For now, return a simple comparison - in production, use pixelmatch or similar
    const identical = base64A === base64B;
    return {
      identical,
      diffPercent: identical ? 0 : 100,
    };
  }

  /** Capture accessibility tree via CDP. */
  async captureAccessibility(browserId: string): Promise<AccessibilitySnapshot | null> {
    const slot = this.slots.find((s) => s.id === browserId);
    if (!slot) return null;
    try {
      const page = (slot.browser as any).page;
      if (!page) return null;
      const client = await page.target().createCDPSession();
      const { nodes } = await client.send("Accessibility.getFullAXTree", {});
      await client.detach();
      return {
        tree: nodes,
        timestamp: new Date().toISOString(),
        url: slot.browser.getState().url,
      };
    } catch {
      return null;
    }
  }

  /** Get session data (cookies, localStorage refs) for persistence. */
  getSessionData(browserId: string): Record<string, unknown> {
    const slot = this.slots.find((s) => s.id === browserId);
    return slot?.sessionData ?? {};
  }

  /** Set session data for persistence across tasks. */
  setSessionData(browserId: string, data: Record<string, unknown>): void {
    const slot = this.slots.find((s) => s.id === browserId);
    if (slot) slot.sessionData = data;
  }

  /** Maintenance: close idle browsers over the minimum. */
  private startMaintenance(): void {
    this.maintenanceInterval = setInterval(async () => {
      const now = Date.now();
      const idleSlots = this.slots.filter(
        (s) => s.state === "idle" && now - s.lastActivity > this.config.idleTimeoutMs
      );

      // Keep at least minSize browsers
      const toClose = idleSlots.slice(this.config.minSize);
      for (const slot of toClose) {
        if (this.slots.length > this.config.minSize) {
          slot.state = "stopping";
          await slot.browser.close().catch(() => {});
          this.slots = this.slots.filter((s) => s.id !== slot.id);
          this.emit("browser-closed", { browserId: slot.id, reason: "idle-timeout" });
        }
      }
    }, 60000); // Check every minute
  }

  /** Scale pool up/down. */
  async setSize(min: number, max: number): Promise<void> {
    this.config.minSize = Math.max(1, Math.min(min, 10));
    this.config.maxSize = Math.max(this.config.minSize, Math.min(max, 10));

    // Scale up if needed
    while (this.slots.length + this.startingCount < this.config.minSize) {
      await this.startBrowser(this.slots.length);
    }

    // Scale down (close idle excess)
    const idleSlots = this.slots.filter((s) => s.state === "idle");
    const toClose = idleSlots.slice(this.config.maxSize);
    for (const slot of toClose) {
      if (this.slots.length > this.config.minSize) {
        slot.state = "stopping";
        await slot.browser.close().catch(() => {});
        this.slots = this.slots.filter((s) => s.id !== slot.id);
      }
    }
  }

  /** Shutdown all browsers. */
  async shutdown(): Promise<void> {
    if (this.maintenanceInterval) {
      clearInterval(this.maintenanceInterval);
      this.maintenanceInterval = null;
    }
    for (const slot of this.slots) {
      slot.state = "stopping";
      await slot.browser.close().catch(() => {});
    }
    this.slots = [];
    this.emit("shutdown");
  }
}

// Singleton instance for the app
let browserPoolInstance: BrowserPool | null = null;

/** Get or create the global browser pool. */
export function getBrowserPool(config?: Partial<PoolConfig>): BrowserPool {
  if (!browserPoolInstance) {
    browserPoolInstance = new BrowserPool(config);
  }
  return browserPoolInstance;
}

/** Set a custom pool instance (for testing). */
export function setBrowserPool(pool: BrowserPool | null): void {
  browserPoolInstance = pool;
}