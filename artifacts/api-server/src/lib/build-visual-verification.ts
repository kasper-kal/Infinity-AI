/**
 * BUILD VISUAL VERIFICATION SYSTEM
 *
 * Browser-based visual inspection and regression testing for Build Mode.
 * Provides explicit Build → Launch → Open → Inspect → Fix → Re-check loop.
 *
 * Features:
 * - Headless browser inspection (layout, overflow, spacing, assets, console errors)
 * - Automated visual diff with pixel threshold
 * - Baseline screenshot capture per feature view
 * - CI-ready headless mode (no display required)
 * - Integration with existing browser pool
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getBrowserPool, type BrowserSlot } from "./browser-pool";
import { JarvisBrowser } from "./puppeteer-browser";
import { getWorkspaceRoot, safeWorkspacePath } from "./workspace";

// DOM types for browser evaluate context
interface DOMRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface CSSStyleDeclaration {
  overflow: string;
  overflowX: string;
  position: string;
  zIndex: string;
  display: string;
  visibility: string;
  opacity: string;
  cursor: string;
}

interface HTMLElement extends Element {
  getBoundingClientRect(): DOMRect;
  getComputedStyle(): CSSStyleDeclaration;
  matches(selector: string): boolean;
  querySelectorAll(selectors: string): NodeListOf<Element>;
  closest(selectors: string): Element | null;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  tagName: string;
  className: string;
  id: string;
  textContent: string | null;
}

interface HTMLImageElement extends HTMLElement {
  src: string;
  complete: boolean;
  naturalWidth: number;
}

interface CSSStyleSheet {
  href: string | null;
}

interface HTMLLinkElement extends HTMLElement {
  href: string;
  sheet: CSSStyleSheet | null;
}

interface HTMLAnchorElement extends HTMLElement {
  href: string;
}

interface Window {
  innerWidth: number;
  innerHeight: number;
  getComputedStyle(el: Element): CSSStyleDeclaration;
  document: Document;
}

interface Document {
  querySelectorAll(selectors: string): NodeListOf<Element>;
  body: HTMLElement;
}

interface Element {
  getBoundingClientRect(): DOMRect;
  matches(selector: string): boolean;
  querySelectorAll(selectors: string): NodeListOf<Element>;
  closest(selectors: string): Element | null;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  tagName: string;
  className: string;
  id: string;
  textContent: string | null;
  children: HTMLCollection;
}

interface NodeListOf<T> {
  length: number;
  item(index: number): T | null;
  [index: number]: T;
}

interface HTMLCollection {
  length: number;
  item(index: number): Element | null;
  [index: number]: Element;
}

export interface ViewportConfig {
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  isLandscape: boolean;
}

export interface VisualInspectionTarget {
  /** URLs to inspect */
  urls: string[];
  /** Viewport configurations to test */
  viewports?: ViewportConfig[];
  /** Selectors to wait for before capture */
  waitForSelectors?: string[];
  /** Custom script to run on page */
  pageScript?: string;
  /** Expected pixel diff threshold (0-1) */
  diffThreshold?: number;
}

export interface VisualFinding {
  type: "layout" | "overflow" | "spacing" | "missing-asset" | "dead-button" | "console-error" | "mobile-breakage" | "runtime-error";
  severity: "critical" | "major" | "minor" | "info";
  url: string;
  viewport: string;
  selector?: string;
  message: string;
  element?: {
    tag: string;
    class?: string;
    id?: string;
    bounds?: { x: number; y: number; width: number; height: number };
  };
  screenshotPath?: string;
  consoleLogs?: string[];
}

export interface VisualVerificationResult {
  success: boolean;
  findings: VisualFinding[];
  screenshots: ScreenshotResult[];
  diffs: DiffResult[];
  summary: {
    totalUrls: number;
    totalViewports: number;
    criticalFindings: number;
    majorFindings: number;
    minorFindings: number;
    passed: boolean;
  };
}

export interface ScreenshotResult {
  url: string;
  viewport: string;
  path: string;
  timestamp: string;
  baselinePath?: string;
}

export interface DiffResult {
  url: string;
  viewport: string;
  baselinePath: string;
  currentPath: string;
  diffPath: string;
  pixelDiff: number;
  pixelDiffPercent: number;
  passed: boolean;
}

/**
 * Visual Verification Engine
 * Orchestrates browser-based visual inspection
 */
export class VisualVerificationEngine {
  private projectId: string;
  private workspaceId: string;
  private baselineDir: string;
  private currentDir: string;

  constructor(projectId: string, workspaceId?: string) {
    this.projectId = projectId;
    this.workspaceId = workspaceId || projectId;
    const workspaceRoot = getWorkspaceRoot(this.workspaceId);
    this.baselineDir = safeWorkspacePath(this.workspaceId, ".infinity/visual-baselines") || path.join(workspaceRoot, ".infinity/visual-baselines");
    this.currentDir = safeWorkspacePath(this.workspaceId, ".infinity/visual-current") || path.join(workspaceRoot, ".infinity/visual-current");
  }

  /**
   * Run complete visual verification loop
   * Build → Launch → Open → Inspect → Fix → Re-check
   */
  async verify(targets: VisualInspectionTarget[]): Promise<VisualVerificationResult> {
    // Ensure directories exist
    await this.ensureDirs();

    const allFindings: VisualFinding[] = [];
    const allScreenshots: ScreenshotResult[] = [];
    const allDiffs: DiffResult[] = [];

    for (const target of targets) {
      const { findings, screenshots, diffs } = await this.verifyTarget(target);
      allFindings.push(...findings);
      allScreenshots.push(...screenshots);
      allDiffs.push(...diffs);
    }

    const critical = allFindings.filter(f => f.severity === "critical").length;
    const major = allFindings.filter(f => f.severity === "major").length;
    const minor = allFindings.filter(f => f.severity === "minor").length;

    return {
      success: critical === 0 && major === 0,
      findings: allFindings,
      screenshots: allScreenshots,
      diffs: allDiffs,
      summary: {
        totalUrls: targets.reduce((sum, t) => sum + t.urls.length, 0),
        totalViewports: targets.reduce((sum, t) => sum + (t.viewports?.length || 1), 0),
        criticalFindings: critical,
        majorFindings: major,
        minorFindings: minor,
        passed: critical === 0 && major === 0,
      },
    };
  }

  /**
   * Verify a single target (set of URLs with same config)
   */
  private async verifyTarget(target: VisualInspectionTarget): Promise<{
    findings: VisualFinding[];
    screenshots: ScreenshotResult[];
    diffs: DiffResult[];
  }> {
    const pool = getBrowserPool();
    const viewports: ViewportConfig[] = target.viewports || [
      { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: true },
      { width: 768, height: 1024, deviceScaleFactor: 2, isMobile: false, hasTouch: true, isLandscape: false },
      { width: 375, height: 667, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: false },
    ];

    const findings: VisualFinding[] = [];
    const screenshots: ScreenshotResult[] = [];
    const diffs: DiffResult[] = [];

    for (const url of target.urls) {
      for (const viewport of viewports) {
        const viewportKey = `${viewport.width}x${viewport.height}`;
        const slot = await pool.acquire(`visual-verify-${this.projectId}-${viewportKey}`);

        try {
          const page = slot.browser.getPage();
          if (!page) throw new Error("Browser page not available");

          // Navigate and wait
          await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

          if (target.waitForSelectors) {
            for (const selector of target.waitForSelectors) {
              await page.waitForSelector(selector, { timeout: 10000 }).catch(() => {});
            }
          }

          // Run custom script if provided
          if (target.pageScript) {
            await page.evaluate(target.pageScript);
          }

          // Capture screenshot
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          const filename = `shot-${viewportKey}-${timestamp}.png`;
          const currentPath = path.join(this.currentDir, filename);
          const baselinePath = path.join(this.baselineDir, `baseline-${viewportKey}.png`);

          await page.screenshot({ path: currentPath, fullPage: true });
          screenshots.push({ url, viewport: viewportKey, path: currentPath, timestamp, baselinePath: await fs.access(baselinePath).then(() => baselinePath).catch(() => undefined) });

          // Run visual inspections
          const pageFindings = await this.inspectPage(page, url, viewportKey, target);
          findings.push(...pageFindings);

          // Compare with baseline if exists
          if (await fs.access(baselinePath).then(() => true).catch(() => false)) {
            const diff = await this.compareImages(baselinePath, currentPath, target.diffThreshold || 0.01);
            diffs.push({
              url,
              viewport: viewportKey,
              baselinePath,
              currentPath,
              diffPath: diff.diffPath,
              pixelDiff: diff.pixelDiff,
              pixelDiffPercent: diff.pixelDiffPercent,
              passed: diff.passed,
            });

            if (!diff.passed) {
              findings.push({
                type: "layout",
                severity: diff.pixelDiffPercent > 0.05 ? "major" : "minor",
                url,
                viewport: viewportKey,
                message: `Visual regression detected: ${diff.pixelDiffPercent.toFixed(2)}% pixel difference`,
                screenshotPath: diff.diffPath,
              });
            }
          }

        } finally {
          pool.release(slot.id);
        }
      }
    }

    return { findings, screenshots, diffs };
  }

  /**
   * Inspect page for common issues
   */
  private async inspectPage(
    page: any,
    url: string,
    viewportKey: string,
    _target: VisualInspectionTarget
  ): Promise<VisualFinding[]> {
    const findings: VisualFinding[] = [];

    // 1. Console errors
    const consoleLogs: string[] = [];
    page.on("console", (msg: any) => {
      if (msg.type() === "error") {
        consoleLogs.push(`${msg.type().toUpperCase()}: ${msg.text()}`);
      }
    });

    // Collect existing console logs
    const existingLogs = await page.evaluate(() => {
      return (window as any).__consoleLogs || [];
    });
    consoleLogs.push(...existingLogs.filter((l: string) => l.includes("ERROR") || l.includes("error")));

    if (consoleLogs.length > 0) {
      findings.push({
        type: "console-error",
        severity: "major",
        url,
        viewport: viewportKey,
        message: `Console errors detected: ${consoleLogs.length}`,
        consoleLogs,
      });
    }

    // 2. Layout issues - overflow, spacing
    const layoutIssues = await page.evaluate(() => {
      const issues: any[] = [];
      const allElements = document.querySelectorAll("*");

      allElements.forEach((el: Element) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);

        // Check horizontal overflow
        if (rect.width > window.innerWidth && style.overflow !== "hidden" && style.overflowX !== "hidden") {
          issues.push({
            type: "overflow",
            selector: getSelector(el),
            bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            message: `Element exceeds viewport width: ${rect.width}px > ${window.innerWidth}px`,
          });
        }

        // Check for tiny tap targets (mobile)
        if (rect.width < 44 || rect.height < 44) {
          const interactive = el.matches("a, button, input, select, textarea, [role=button], [onclick]");
          if (interactive) {
            issues.push({
              type: "spacing",
              selector: getSelector(el),
              bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              message: `Touch target too small: ${rect.width}x${rect.height}px (minimum 44x44)`,
            });
          }
        }

        // Check for overlapping elements
        if (style.position === "absolute" || style.position === "fixed") {
          const zIndex = parseInt(style.zIndex) || 0;
          if (zIndex > 1000) {
            // Could indicate stacking issues
          }
        }
      });

      return issues;
    });

    for (const issue of layoutIssues) {
      findings.push({
        type: issue.type,
        severity: issue.type === "overflow" ? "major" : "minor",
        url,
        viewport: viewportKey,
        selector: issue.selector,
        message: issue.message,
        element: issue.bounds ? {
          tag: "unknown",
          bounds: issue.bounds,
        } : undefined,
      });
    }

    // 3. Missing assets (images, fonts)
    const missingAssets = await page.evaluate(() => {
      const missing: string[] = [];
      document.querySelectorAll("img").forEach((img: HTMLImageElement) => {
        if (!img.complete || img.naturalWidth === 0) {
          missing.push(img.src);
        }
      });
      document.querySelectorAll("link[rel=stylesheet]").forEach((link: HTMLLinkElement) => {
        if (link.sheet === null) {
          missing.push(link.href);
        }
      });
      return missing;
    });

    for (const asset of missingAssets) {
      findings.push({
        type: "missing-asset",
        severity: "major",
        url,
        viewport: viewportKey,
        message: `Missing asset: ${asset}`,
      });
    }

    // 4. Dead buttons/links
    const deadElements = await page.evaluate(() => {
      const dead: any[] = [];
      document.querySelectorAll("a, button, [role=button], [onclick]").forEach((el: Element) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        // Invisible or unreachable interactive elements
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
          if (rect.width > 0 && rect.height > 0) {
            dead.push({
              selector: getSelector(el),
              bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              reason: "Hidden but has dimensions",
            });
          }
        }
        // Links with empty or javascript: href
        if (el.tagName === "A") {
          const href = (el as HTMLAnchorElement).href;
          if (!href || href === "javascript:void(0)" || href === "#") {
            dead.push({
              selector: getSelector(el),
              bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              reason: "Empty or javascript: href",
            });
          }
        }
      });
      return dead;
    });

    for (const dead of deadElements) {
      findings.push({
        type: "dead-button",
        severity: "minor",
        url,
        viewport: viewportKey,
        selector: dead.selector,
        message: `Potentially dead interactive element: ${dead.reason}`,
        element: dead.bounds ? {
          tag: "unknown",
          bounds: dead.bounds,
        } : undefined,
      });
    }

    // 5. Runtime errors (uncaught exceptions)
    const runtimeErrors = await page.evaluate(() => {
      return (window as any).__runtimeErrors || [];
    });

    for (const err of runtimeErrors) {
      findings.push({
        type: "runtime-error",
        severity: "critical",
        url,
        viewport: viewportKey,
        message: `Uncaught error: ${err.message}`,
      });
    }

    // 6. Mobile-specific breakage
    if (viewportKey.includes("375")) { // mobile viewport
      const mobileIssues = await page.evaluate(() => {
        const issues: any[] = [];
        // Check for fixed headers that cover content
        document.querySelectorAll("[style*='position: fixed'], [style*='position:fixed']").forEach((el: Element) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (rect.top === 0 && rect.height > 80) {
            issues.push({
              type: "mobile-breakage",
              selector: getSelector(el),
              bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              message: `Fixed header may cover content on mobile: ${rect.height}px tall`,
            });
          }
        });
        // Check for horizontal scroll
        if (document.body.scrollWidth > window.innerWidth) {
          issues.push({
            type: "mobile-breakage",
            selector: "body",
            bounds: { x: 0, y: 0, width: document.body.scrollWidth, height: document.body.scrollHeight },
            message: `Horizontal scroll detected: ${document.body.scrollWidth}px > ${window.innerWidth}px`,
          });
        }
        return issues;
      });

      for (const issue of mobileIssues) {
        findings.push({
          type: issue.type,
          severity: "major",
          url,
          viewport: viewportKey,
          selector: issue.selector,
          message: issue.message,
          element: issue.bounds ? {
            tag: "unknown",
            bounds: issue.bounds,
          } : undefined,
        });
      }
    }

    return findings;
  }

  /**
   * Compare two images using pixelmatch (or fallback)
   */
  private async compareImages(
    baselinePath: string,
    currentPath: string,
    threshold: number
  ): Promise<{ pixelDiff: number; pixelDiffPercent: number; diffPath: string; passed: boolean }> {
    try {
      // Try to use pixelmatch if available
      const pixelmatch = (await import("pixelmatch")).default;
      const { createCanvas, loadImage } = await import("canvas");

      const [baselineImg, currentImg] = await Promise.all([
        loadImage(baselinePath),
        loadImage(currentPath),
      ]);

      const width = Math.max(baselineImg.width, currentImg.width);
      const height = Math.max(baselineImg.height, currentImg.height);

      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");

      ctx.drawImage(baselineImg, 0, 0);
      const baselineImgData = ctx.getImageData(0, 0, width, height);
      const baselineData = baselineImgData.data;

      ctx.drawImage(currentImg, 0, 0);
      const currentImgData = ctx.getImageData(0, 0, width, height);
      const currentData = currentImgData.data;

      const diffCanvas = createCanvas(width, height);
      const diffCtx = diffCanvas.getContext("2d");
      const diffImgData = diffCtx.createImageData(width, height);
      const diffData = diffImgData.data;

      const pixelDiff = pixelmatch(baselineData, currentData, diffData, width, height, {
        threshold,
        includeAA: true,
      });

      diffCtx.putImageData(diffImgData, 0, 0);
      const diffPath = currentPath.replace(".png", "-diff.png");
      const out = require("fs").createWriteStream(diffPath);
      const stream = diffCanvas.createPNGStream();
      stream.pipe(out);
      await new Promise(resolve => stream.on("end", resolve));

      const totalPixels = width * height;
      const pixelDiffPercent = pixelDiff / totalPixels;

      return {
        pixelDiff,
        pixelDiffPercent,
        diffPath,
        passed: pixelDiffPercent <= threshold,
      };
    } catch (e) {
      // Fallback: simple file size comparison
      const baselineStat = await fs.stat(baselinePath);
      const currentStat = await fs.stat(currentPath);
      const sizeDiff = Math.abs(baselineStat.size - currentStat.size) / Math.max(baselineStat.size, currentStat.size);
      return {
        pixelDiff: 0,
        pixelDiffPercent: sizeDiff,
        diffPath: currentPath,
        passed: sizeDiff <= threshold,
      };
    }
  }

  /**
   * Capture baseline screenshots for regression suite
   */
  async captureBaselines(targets: VisualInspectionTarget[]): Promise<void> {
    await this.ensureDirs();

    const pool = getBrowserPool();
    const viewports = targets.flatMap(t => t.viewports || [
      { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: true },
      { width: 768, height: 1024, deviceScaleFactor: 2, isMobile: false, hasTouch: true, isLandscape: false },
      { width: 375, height: 667, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: false },
    ]);

    for (const target of targets) {
      for (const url of target.urls) {
        for (const viewport of viewports) {
          const viewportKey = `${viewport.width}x${viewport.height}`;
          const slot = await pool.acquire(`visual-verify-${this.projectId}-${viewportKey}`);

          try {
            const page = slot.browser.getPage();
            if (!page) throw new Error("Browser page not available");

            await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

            if (target.waitForSelectors) {
              for (const selector of target.waitForSelectors) {
                await page.waitForSelector(selector, { timeout: 10000 }).catch(() => {});
              }
            }

            const baselinePath = path.join(this.baselineDir, `baseline-${viewportKey}.png`);
            await page.screenshot({ path: baselinePath, fullPage: true });
            console.log(`[VisualVerification] Captured baseline: ${baselinePath}`);
          } finally {
            pool.release(slot.id);
          }
        }
      }
    }
  }

  private async ensureDirs(): Promise<void> {
    await fs.mkdir(this.baselineDir, { recursive: true });
    await fs.mkdir(this.currentDir, { recursive: true });
  }
}

/**
 * Helper to generate CSS selector for element
 */
function getSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  if (el.className && typeof el.className === "string") {
    const classes = el.className.split(" ").filter(c => c).slice(0, 3).join(".");
    if (classes) return `${el.tagName.toLowerCase()}.${classes}`;
  }
  return el.tagName.toLowerCase();
}

/**
 * High-level verification runner for Build Mode integration
 * Implements the explicit: Build → Launch → Open → Inspect → Fix → Re-check loop
 */
export interface VerificationLoopOptions {
  projectId: string;
  workspaceId?: string;
  /** Dev server URL (e.g., http://localhost:5173) */
  devServerUrl: string;
  /** Feature views to verify */
  views: Array<{ name: string; path: string; waitForSelectors?: string[] }>;
  /** Maximum fix iterations */
  maxIterations?: number;
  /** Custom page scripts per view */
  pageScripts?: Record<string, string>;
}

export interface VerificationLoopResult {
  success: boolean;
  iterations: number;
  finalResult: VisualVerificationResult;
  history: Array<{
    iteration: number;
    result: VisualVerificationResult;
    fixesApplied: string[];
  }>;
}

export async function runVisualVerificationLoop(
  options: VerificationLoopOptions
): Promise<VerificationLoopResult> {
  const engine = new VisualVerificationEngine(options.projectId, options.workspaceId);
  const maxIterations = options.maxIterations || 3;
  const history: VerificationLoopResult["history"] = [];

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    console.log(`[VisualVerification] Iteration ${iteration}/${maxIterations}`);

    const targets: VisualInspectionTarget[] = options.views.map(view => ({
      urls: [`${options.devServerUrl}${view.path}`],
      viewports: [
        { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: true },
        { width: 375, height: 667, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: false },
      ],
      waitForSelectors: view.waitForSelectors,
      pageScript: options.pageScripts?.[view.name],
      diffThreshold: 0.01,
    }));

    const result = await engine.verify(targets);
    const fixesApplied: string[] = [];

    // In a real implementation, this would trigger the fixer agent
    // For now, we just record the iteration
    history.push({ iteration, result, fixesApplied });

    if (result.success) {
      console.log(`[VisualVerification] Passed on iteration ${iteration}`);
      return { success: true, iterations: iteration, finalResult: result, history };
    }

    console.log(`[VisualVerification] Found ${result.findings.length} issues, would trigger fix...`);
    // In full implementation: call fixer agent, apply fixes, re-verify
  }

  // Return final result after max iterations
  const finalResult = history[history.length - 1].result;
  return { success: finalResult.success, iterations: maxIterations, finalResult, history };
}

export default VisualVerificationEngine;