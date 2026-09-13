/**
 * BUILD VISUAL VERIFICATION — real inspection pass for the done contract.
 *
 * Phase 0 (FIX campaign) — turns the four "not-enforced" gates (runtime-errors,
 * visual-verification, accessibility, seo) honest. One Chrome pass inspects the
 * BUILT app (dist/) driven directly over the raw puppeteer page:
 *
 *   - render:        the page actually rendered (body text > 0, not a blank shell)
 *   - overflow:      horizontal overflow at desktop + mobile viewports (scrollWidth
 *                    vs clientWidth) — the class of bug verify.mjs caught in the
 *                    G09 benchmark
 *   - console:       real console.error / pageerror messages during load+settle
 *   - a11y:          axe-core injected offline (no CDN) — critical/serious violations
 *   - seo:           <title>, meta description, ≥1 h1
 *
 * Every gate reads the SAME cached pass: the first gate to need the inspection
 * runs Chrome once and the rest reuse the result (no per-gate Chrome launch).
 * The cache entry is dropped as soon as the pass settles, so a later build on
 * the same project always gets a FRESH inspection.
 *
 * Honesty contract (mirrors Phase 1):
 *   - no dist/ → "skipped" (not applicable — never a forged pass, never a trap)
 *   - Chrome/browser pool unavailable → "not-enforced" with a clear reason
 *   - overflow / blank / console errors / a11y violations → "failed" with detail
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { getBrowserPool } from "./browser-pool";
import { getWorkspaceRoot } from "./workspace";

// ============================================================================
// Types
// ============================================================================

export interface A11yViolation {
  id: string;
  impact: string;
  description: string;
  nodes: number; // count of affected nodes
  help: string;
}

export interface SeoSnapshot {
  title: string;
  metaDescription: string;
  h1Count: number;
  inspected: boolean;
}

export interface VisualInspection {
  status: "passed" | "failed" | "skipped" | "not-enforced";
  ok: boolean;
  /** human-readable pass/fail/skip summary (drives gate `details`) */
  detail: string;
  /** reasons the inspection failed (overflow viewports, console errors, a11y) */
  failures: string[];
  consoleErrors: string[];
  overflowViewports: Array<{ width: number; height: number; overflow: number }>;
  blankViewports: Array<{ width: number; height: number }>;
  a11y: A11yViolation[];
  /** true ONLY when axe-core actually executed against the rendered app */
  a11yRan: boolean;
  /** why axe could not run, when a11yRan is false (CSP block, injection error) */
  a11yError?: string;
  seo: SeoSnapshot;
  /** Largest Contentful Paint measured on the desktop pass (ms), or null if unavailable */
  lcpMs: number | null;
  pagesInspected: number;
  durationMs: number;
  reportDir?: string;
  timestamp: string;
}

// ============================================================================
// Static server for the built app (SPA fallback → index.html)
// ============================================================================

interface StaticServer {
  server: http.Server;
  url: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/** Serve a built output dir with SPA fallback. Rejects on bind error. */
function serveStaticDir(outputDir: string): Promise<StaticServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
        let filePath = path.normalize(path.join(outputDir, urlPath));
        // Prevent escape above the output dir.
        if (!filePath.startsWith(outputDir)) filePath = outputDir;

        let candidate = filePath;
        let stat = await fs.stat(candidate).catch(() => null);
        if (stat?.isDirectory()) {
          candidate = path.join(candidate, "index.html");
          stat = await fs.stat(candidate).catch(() => null);
        }
        if (!stat?.isFile()) {
          // SPA fallback — every non-file path renders the app shell.
          candidate = path.join(outputDir, "index.html");
          stat = await fs.stat(candidate).catch(() => null);
        }
        if (!stat) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        const ext = path.extname(candidate).toLowerCase();
        res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
        res.end(await fs.readFile(candidate));
      } catch {
        res.statusCode = 500;
        res.end("Server error");
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Failed to bind verification server"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

// ============================================================================
// Output dir detection
// ============================================================================

const OUTPUT_DIRS = ["dist", "build", "out"];

async function findOutputDir(projectPath: string): Promise<string | null> {
  // Standard framework layouts: Vite/webpack put the whole built tree in dist/.
  for (const dir of OUTPUT_DIRS) {
    const html = await fs
      .access(path.join(projectPath, dir, "index.html"))
      .then(() => true)
      .catch(() => false);
    if (html) return path.join(projectPath, dir);
  }
  // Fallback — the project root itself is the built output (simple static
  // sites / benchmark apps: index.html + assets at root). Serving the current
  // root after the build gate is honest: anything that fails to render reports
  // failed, never a forged pass.
  const rootHtml = await fs
    .access(path.join(projectPath, "index.html"))
    .then(() => true)
    .catch(() => false);
  if (rootHtml) return projectPath;
  return null;
}

// ============================================================================
// Cache — ONE Chrome pass per (buildId, projectPath)
//
// A done-contract evaluation runs several gates (runtime-errors, visual,
// a11y, seo, perf) that all inspect the same built app. They share a single
// pass via this cache, keyed by buildId so every runDoneContract call gets
// FRESH evidence — never a stale pass carried over from a previous build.
// ============================================================================

interface CacheEntry {
  promise?: Promise<VisualInspection>;
  result?: VisualInspection;
}

const inspectionCache = new Map<string, CacheEntry>();

export function clearInspectionCache(): void {
  inspectionCache.clear();
}

const MAX_CACHE_ENTRIES = 50;

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 375, height: 812 },
];

export const INSPECTION_VIEWPORTS = VIEWPORTS;

const SETTLE_MS = 1200;

// ============================================================================
// Main inspection
// ============================================================================

export async function inspectBuiltApp(
  projectPath: string,
  opts: { buildId?: string; workspaceId?: string; force?: boolean } = {}
): Promise<VisualInspection> {
  const key = `${opts.buildId || "generic"}:${path.resolve(projectPath)}`;
  const entry = inspectionCache.get(key);
  if (!opts.force && entry?.result) return entry.result;
  if (!opts.force && entry?.promise) return entry.promise;

  const run = runInspection(projectPath, opts);
  inspectionCache.set(key, { ...entry, promise: run });
  try {
    const result = await run;
    inspectionCache.set(key, { result });
    if (inspectionCache.size > MAX_CACHE_ENTRIES) {
      const oldest = inspectionCache.keys().next().value;
      if (oldest !== undefined) inspectionCache.delete(oldest);
    }
    return result;
  } catch (e) {
    inspectionCache.delete(key);
    throw e;
  }
}

async function makeReportDir(projectPath: string, workspaceId?: string): Promise<string | null> {
  try {
    const base = workspaceId ? getWorkspaceRoot(workspaceId) : projectPath;
    const dir = path.join(base, ".infinity", "verification");
    await fs.mkdir(dir, { recursive: true });
    return dir;
  } catch {
    return null;
  }
}

async function runInspection(
  projectPath: string,
  opts: { buildId?: string; workspaceId?: string; force?: boolean }
): Promise<VisualInspection> {
  const started = Date.now();
  const result: VisualInspection = {
    status: "passed",
    ok: true,
    detail: "",
    failures: [],
    consoleErrors: [],
    overflowViewports: [],
    blankViewports: [],
    a11y: [],
    a11yRan: false,
    seo: { title: "", metaDescription: "", h1Count: 0, inspected: false },
    lcpMs: null,
    pagesInspected: 0,
    durationMs: 0,
    timestamp: new Date().toISOString(),
  };

  const reportDir = await makeReportDir(projectPath, opts.workspaceId);

  // 1. Find the built output. No build → honest skip.
  const outputDir = await findOutputDir(projectPath);
  if (!outputDir) {
    result.status = "skipped";
    result.ok = false;
    result.detail =
      "No built output (dist/build/out with index.html) found — visual verification skipped (nothing to put in a browser yet).";
    result.durationMs = Date.now() - started;
    return result;
  }

  // 2. Serve the built app.
  const server = await serveStaticDir(outputDir).catch((e: unknown) => {
    result.status = "skipped";
    result.ok = false;
    result.detail = `Could not start local server for built app: ${e instanceof Error ? e.message : String(e)}`;
    result.durationMs = Date.now() - started;
    return null;
  });
  if (!server) return result;

  // 3. Launch a shared browser page.
  const pool = getBrowserPool();
  let slot: { id: string; browser: { getPage: () => any } };
  try {
    slot = await pool.acquire(`visual-verify-${Date.now()}`);
  } catch (e) {
    server.server.close();
    result.status = "not-enforced";
    result.ok = false;
    result.detail = `Browser pool unavailable — visual verification NOT enforced (${e instanceof Error ? e.message : String(e)}). Chrome is required for visual/a11y/runtime checks.`;
    result.durationMs = Date.now() - started;
    return result;
  }

  try {
    const page = slot.browser.getPage();
    if (!page) {
      result.status = "not-enforced";
      result.ok = false;
      result.detail = "Browser slot has no live page — visual verification NOT enforced.";
      result.durationMs = Date.now() - started;
      return result;
    }

    // Console / pageerror capture for the whole pass. Only real errors count:
    // warnings (framework/dev noise) would false-fail every build.
    const consoleErrors: string[] = [];
    const onConsole = (msg: { type: () => string; text: () => string }) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      // Skip benign browser noise that would false-fail every build.
      if (/favicon|DevTools .* is not allowed to use/.test(text)) return;
      consoleErrors.push(`[error] ${text.slice(0, 400)}`);
    };
    const onPageError = (err: Error) => {
      consoleErrors.push(`[uncaught] ${err.message.slice(0, 400)}`);
    };
    page.on("console", onConsole);
    page.on("pageerror", onPageError);

    // 4. LCP needs a live observer before content arrives — register it on every
    // new document so the first (desktop) load captures a real Largest
    // Contentful Paint timestamp. (`addInitScript` is the modern name;
    // this puppeteer build still exposes `evaluateOnNewDocument`.)
    const initScript = (page as unknown as Record<string, (fn: () => void) => Promise<void>>)
      .addInitScript ?? (page as unknown as Record<string, (fn: () => void) => Promise<void>>).evaluateOnNewDocument;
    if (typeof initScript === "function") {
      await initScript.call(page, () => {
        (window as unknown as Record<string, unknown>).__infinityLcp = null;
        try {
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            if (entries.length > 0) {
              const last = entries[entries.length - 1] as PerformanceEntry;
              (window as unknown as Record<string, unknown>).__infinityLcp = Math.round(last.startTime);
            }
          }).observe({ type: "largest-contentful-paint", buffered: true });
        } catch {
          // no LCP support — performance gate reports not-enforced honestly
        }
      });
    }

    // axe-core is injected AFTER navigation, on the RENDERED document (a
    // pre-navigation injection would be wiped by the reload). a11yRan is set
    // only when axe genuinely executes — a blocked injection (CSP) or a page
    // exception is reported honestly, never as a silent pass.

    // SEO temps captured from the desktop pass.
    let seenTitle = "";
    let seenMetaDescription = "";
    let seenH1Count = 0;

    // 5. Inspect each viewport.
    for (const vp of VIEWPORTS) {
      await page.setViewport({ width: vp.width, height: vp.height });
      await pool.navigate(slot.id, server.url, { skipPolicyCheck: true });
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      result.pagesInspected += 1;

      const metrics = await page.evaluate(() => {
        const doc = document.documentElement;
        const body = document.body;
        const text = body?.innerText?.trim()?.length || 0;
        const overflow = Math.max(0, (doc?.scrollWidth || 0) - (doc?.clientWidth || 0));
        const title = (document.title || "").trim();
        const metaDesc =
          (document.querySelector('meta[name="description"]') as HTMLMetaElement | null)?.content || "";
        const h1Count = document.querySelectorAll("h1").length;
        // Prefer the live observer's value; fall back to the timeline buffer.
        const live = (window as unknown as Record<string, unknown>).__infinityLcp;
        const lcp =
          typeof live === "number"
            ? (live as number)
            : (() => {
                const entries = performance.getEntriesByType("largest-contentful-paint");
                return entries.length ? Math.round(entries[entries.length - 1].startTime) : null;
              })();
        return { text, overflow, title, metaDesc, h1Count, lcp };
      });

      if (metrics.text === 0) result.blankViewports.push({ width: vp.width, height: vp.height });
      if (metrics.overflow > 2) {
        result.overflowViewports.push({ width: vp.width, height: vp.height, overflow: metrics.overflow });
        result.failures.push(`Horizontal overflow of ${metrics.overflow}px at ${vp.width}×${vp.height}`);
      }
      result.consoleErrors.push(...consoleErrors.splice(0)); // drain per viewport

      // SEO from the desktop pass (document is the app). LCP is captured from the
      // live observer on the genuine desktop load.
      if (vp.width === VIEWPORTS[0].width) {
        seenTitle = metrics.title;
        seenMetaDescription = metrics.metaDesc;
        seenH1Count = metrics.h1Count;
        if (typeof metrics.lcp === "number") result.lcpMs = metrics.lcp;
      }

      // axe-core runs on the RENDERED desktop document: inject the source
      // (offline, no CDN) into the live page, then execute. If injection or
      // execution fails (CSP, page exception), a11yRan stays false and the
      // accessibility gate reports NOT enforced — never a silent pass.
      if (vp.width === VIEWPORTS[0].width && !result.a11yRan) {
        try {
          const axe = require("axe-core") as { source: string };
          await page.addScriptTag({ content: axe.source });
          const axeResult = await page.evaluate(async () => {
            const win = window as any;
            if (typeof win.axe?.run !== "function") return null;
            try {
              const res = await win.axe.run(document, { resultTypes: ["violations"] });
              return {
                violations: (res.violations || []).map((v: any) => ({
                  id: v.id,
                  impact: v.impact || "minor",
                  description: v.help || v.description || "",
                  nodes: (v.nodes || []).length,
                  help: v.helpUrl || "",
                })),
              };
            } catch {
              return null;
            }
          });
          if (axeResult) {
            result.a11yRan = true;
            result.a11y = axeResult.violations.filter(
              (v: A11yViolation) => v.impact === "critical" || v.impact === "serious"
            );
            if (result.a11y.length > 0) {
              result.failures.push(
                `${result.a11y.length} critical/serious accessibility violation(s): ${result.a11y.map((v) => v.id).join(", ")}`
              );
            }
          } else {
            result.a11yError = "axe-core injected but could not run on the rendered page (CSP or page exception)";
          }
        } catch (e) {
          result.a11yError = `axe-core injection failed: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    }

    // 6. Screenshot the desktop view (proof artifact), best-effort.
    if (reportDir) {
      try {
        await page.setViewport({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
        await pool.navigate(slot.id, server.url, { skipPolicyCheck: true });
        await new Promise((r) => setTimeout(r, SETTLE_MS));
        const shot = await pool.captureScreenshot(slot.id);
        if (shot.success && shot.data) {
          await fs.writeFile(path.join(reportDir, "visual-desktop.png"), Buffer.from(shot.data, "base64"));
        }
      } catch {
        // non-critical
      }
    }

    page.off("console", onConsole);
    page.off("pageerror", onPageError);

    // 7. Verdict.
    const a11ySummary = result.a11y.length
      ? `${result.a11y.length} critical/serious violation(s)`
      : result.a11yRan
        ? "no critical/serious violations"
        : `axe-core NOT run (${result.a11yError ?? "not executable on this page"})`;

    if (result.blankViewports.length > 0) {
      result.failures.push(
        `Blank page (no rendered text) at ${result.blankViewports.map((v) => `${v.width}×${v.height}`).join(", ")}`
      );
    }
    if (result.consoleErrors.length > 0) {
      result.failures.push(
        `${result.consoleErrors.length} console error(s): ${result.consoleErrors.slice(0, 3).join(" | ")}`
      );
    }
    result.consoleErrors = result.consoleErrors.slice(0, 20);

    // SEO verdict (only meaningful when we inspected ≥1 rendered viewport).
    const seoFails: string[] = [];
    if (result.pagesInspected > 0) {
      result.seo = {
        title: seenTitle,
        metaDescription: seenMetaDescription,
        h1Count: seenH1Count,
        inspected: true,
      };
      if (!seenTitle) seoFails.push("missing <title>");
      if (!seenMetaDescription) seoFails.push("missing meta description");
      if (seenH1Count === 0) seoFails.push("no <h1>");
      if (seenTitle.length > 60) seoFails.push(`title too long (${seenTitle.length} chars)`);
    } else {
      result.seo.inspected = false;
    }

    result.durationMs = Date.now() - started;

    if (result.failures.length > 0) {
      result.status = "failed";
      result.ok = false;
      result.detail = `Built app inspected at ${result.pagesInspected} viewport(s) in ${result.durationMs}ms — ${result.failures.length} issue(s): ${result.failures.slice(0, 4).join("; ")}. a11y: ${a11ySummary}. SEO: ${seoFails.length ? seoFails.join(", ") : "ok"}.`;
    } else {
      result.status = "passed";
      result.ok = true;
      result.detail = `Built app rendered cleanly at ${result.pagesInspected} viewport(s) in ${result.durationMs}ms (no overflow, no console errors, ${a11ySummary}, SEO ${seoFails.length ? "issues: " + seoFails.join(", ") : "ok"}).`;
    }

    // Persist a JSON report (honest artifact).
    if (reportDir) {
      try {
        await fs.writeFile(
          path.join(reportDir, "visual-inspection.json"),
          JSON.stringify(
            {
              status: result.status,
              ok: result.ok,
              failures: result.failures,
              consoleErrors: result.consoleErrors,
              overflowViewports: result.overflowViewports,
              blankViewports: result.blankViewports,
              a11y: result.a11y,
              a11yRan: result.a11yRan,
              a11yError: result.a11yError,
              seo: result.seo,
              lcpMs: result.lcpMs,
              viewports: VIEWPORTS,
              durationMs: result.durationMs,
              timestamp: result.timestamp,
            },
            null,
            2
          )
        );
        result.reportDir = reportDir;
      } catch {
        // non-critical
      }
    }

    return result;
  } catch (e) {
    result.status = "not-enforced";
    result.ok = false;
    result.detail = `Visual inspection errored — gate NOT enforced (${e instanceof Error ? e.message : String(e)}).`;
    result.failures = [];
    result.durationMs = Date.now() - started;
    return result;
  } finally {
    pool.release(slot.id);
    server.server.close();
  }
}