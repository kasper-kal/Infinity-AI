/**
 * BUILD WALKTHROUGH — Phase 7 (FIX campaign): the **Visual Verification LOOP**.
 *
 * This is the "walkthrough" half of Phase 7 (vision channel · visual diff ·
 * walkthrough). It drives a rendered app like a user would — enumerate every
 * interactive element, click each one, screenshot EVERY frame, capture the
 * console/error deltas — and turns the result into:
 *
 *   1. a durable PROOF artifact per workspace: `.infinity/walkthrough/index.json`
 *      (the structured walkthrough report) + `frame-NN.png` per visited frame
 *      (the per-frame screenshot evidence) + `WALKTHROUGH.md` (human readout),
 *   2. a VISUAL DIFF verdict: the engine fingerprints every frame and compares
 *      it against the base page, flagging blank pages, lost interactive
 *      elements, horizontal-overflow growth, or a torn-down layout — real
 *      regressions, computed in-page, zero native pixel deps,
 *   3. a MODEL FEEDBACK channel: `walkthroughFeedback()` renders a
 *      `## WALKTHROUGH EVIDENCE` block (drive N elements · N error(s) · per-frame
 *      screenshots · diff issues) and `walkthroughScreenshotParts()` returns the
 *      per-frame screenshots as vision `image_url` parts — so the loop's next
 *      turn REASONS OVER what a user actually sees when clicking the app.
 *
 * Honesty contract (mirrors the other Phase 0–7 primitives):
 *   - the browser interaction is behind a narrow `WalkthroughBrowser` interface
 *     so the ENGINE is provable without a browser; the puppeteer-backed adapter
 *     is only constructed by the caller (no top-level `require("puppeteer")` —
 *     the harness bundle stays clean),
 *   - no reachable browser / no built output  =>  `{status:"not-enforced"}`
 *     with a clear reason — never a forged pass, never a trap,
 *   - screenshots are REAL bytes captured per frame (best-effort; a failed
 *     capture is recorded, it does not kill the walk),
 *   - external navigation (absolute URLs, `mailto:`, `tel:`, `javascript:`)
 *     and destructive inputs (text fields) are never clicked — the walk only
 *     presses safe buttons/links/`#`-hash anchors it can drive without leaving
 *     the app or mutating data.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as http from "node:http";

// ============================================================================
// Types
// ============================================================================

/** The narrow browser surface the engine needs. A puppeteer `Page`'s walkable
 * subset, or a deterministic in-memory stand-in for the harness. */
export interface WalkthroughBrowser {
  /** Navigate to a URL (same-origin/local app). Returns after load+settle. */
  goto(url: string): Promise<void>;
  setViewport(width: number, height: number): Promise<void>;
  /** Current page state captured in-page (deterministic, cheap). */
  readState(): Promise<WalkthroughPageState>;
  /** Elements the user could click. tag is the lower-cased element name. */
  enumerateInteractables(): Promise<Array<WalkthroughTarget>>;
  /** Press one enumerated element (identified by its index). */
  click(index: number): Promise<void>;
  /** Real PNG bytes (base64) of the CURRENT frame, or null on capture failure. */
  screenshot(): Promise<{ base64: string } | null>;
  /** Console errors that fired during this walk hop (drained between hops). */
  drainConsoleErrors(): string[];
  close(): Promise<void>;
}

export interface WalkthroughTarget {
  index: number;
  tag: string;
  text: string;
  href: string;
  disabled: boolean;
  /** reasons this element was NOT driven (dangerous/destructive/disabled) */
  skipped?: string;
}

export interface WalkthroughPageState {
  title: string;
  /** rendered text length — 0 = blank page */
  textLen: number;
  /** count of visible interactive controls on the page */
  visibleInteractive: number;
  /** horizontal overflow (scrollWidth - clientWidth) */
  overflow: number;
  /** deterministic hash of the rendered text — teardown/layout-change detector */
  textHash: string;
}

export interface WalkthroughFrame {
  index: number;
  label: string;
  tag: string;
  text: string;
  href: string;
  /** skipped (never clicked) vs driven vs base */
  kind: "base" | "driven" | "skipped";
  skipReason?: string;
  screenshotBase64: string | null;
  consoleErrors: string[];
  state: WalkthroughPageState;
  url: string;
}

export type DiffSeverity = "info" | "major" | "critical";

export interface VisualDiffIssue {
  severity: DiffSeverity;
  kind: "blank-page" | "element-loss" | "overflow-growth" | "teardown" | "console-errors" | "info";
  message: string;
}

export type WalkthroughVerdict = "passed" | "failed" | "skipped" | "not-enforced";

export interface WalkthroughResult {
  status: WalkthroughVerdict;
  ok: boolean;
  /** drive/labels summary for the `${workspace}` feedback */
  testedElements: number;
  skippedElements: number;
  frames: WalkthroughFrame[];
  issues: VisualDiffIssue[];
  errors: string[];
  reportDir: string | null;
  reportPath: string | null;
  reportRelPath: string | null;
  durationMs: number;
  timestamp: string;
  reason?: string;
  /** capped list of frame screenshot paths (relative to reportDir) */
  screenshotFiles: string[];
}

export interface WalkthroughOptions {
  /** cap on how many interactive elements to drive (default 30) */
  maxElements?: number;
  /** header text for the model-feedback block (default "## WALKTHROUGH EVIDENCE") */
  feedbackTitle?: string;
  /** network quiet window after each click, ms (default 450) */
  settleMs?: number;
  /** initial page the walk starts on */
  url: string;
  /** workspace/label used for the durable report directory */
  label: string;
}

/** Text block fed to the model — the loop's visual evidence channel. */
export interface WalkthroughFeedback {
  title: string;
  text: string;
  /** per-frame screenshots as OpenAI-style image content parts (vision-capable
   * adapters only) — capped so a long walk never floods the completion */
  screenshotParts: Array<{ type: "image_url"; image_url: { url: string } }>;
}

// ============================================================================
// Fingerprinting + visual diff (computed in-page, zero native pixel deps)
// ============================================================================

/** Small deterministic hash (FNV-1a 32-bit) of the rendered text — a cheap but
 * honest teardown/reflow detector: two frames whose text layout differs get
 * different hashes, so a click that blanked the page or dumped a different
 * screen is caught mechanically. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Compare a driven frame against the base page — the VISUAL DIFF. Flags real
 * regression classes mechanically (never "feels different"):
 *   - blank-page:      the page stopped rendering text entirely
 *   - element-loss:    every interactive control vanished (a modal covering the
 *                      app counts, but loss of ALL controls points to a broken
 *                      view — called out, not silently accepted)
 *   - overflow-growth: horizontal overflow grew past the base + a small slack
 *   - teardown:        the rendered text HASH changed wholesale (layout swap)
 *   - console-errors:  new console/page errors appeared after the action
 */
export function visualDiff(
  base: WalkthroughPageState,
  after: WalkthroughPageState,
  afterFrame: WalkthroughFrame
): VisualDiffIssue[] {
  const issues: VisualDiffIssue[] = [];

  if (after.textLen === 0 || after.textLen < base.textLen / 4) {
    issues.push({
      severity: "critical",
      kind: "blank-page",
      message: `Blank/near-blank page after "${afterFrame.label}" (text ${base.textLen} → ${after.textLen} chars)`,
    });
  }

  if (after.visibleInteractive === 0 && base.visibleInteractive > 0) {
    issues.push({
      severity: "major",
      kind: "element-loss",
      message: `All interactive controls disappeared after "${afterFrame.label}" (${base.visibleInteractive} → 0)`,
    });
  }

  if (after.overflow > base.overflow + 2) {
    issues.push({
      severity: "major",
      kind: "overflow-growth",
      message: `Horizontal overflow grew after "${afterFrame.label}" (${base.overflow}px → ${after.overflow}px)`,
    });
  }

  if (afterFrame.consoleErrors.length > 0) {
    issues.push({
      severity: afterFrame.consoleErrors.length > 2 ? "critical" : "major",
      kind: "console-errors",
      message: `${afterFrame.consoleErrors.length} console/page error(s) after "${afterFrame.label}"`,
    });
  }

  // A full text-hash change that isn't already a blank-page is a teardown —
  // the action swapped the whole view (often intended for tabs/links, so it's
  // reported as "info" unless it coincided with a regression above).
  if (after.textHash !== base.textHash && issues.length === 0) {
    issues.push({
      severity: "info",
      kind: "teardown",
      message: `View changed after "${afterFrame.label}" (rendered text hash ${base.textHash} → ${after.textHash})`,
    });
  }

  return issues;
}

// ============================================================================
// Static server for a BUILT output dir (SPA fallback → index.html)
// ============================================================================

export const WALKTHROUGH_OUTPUT_DIRS = ["dist", "build", "out"];

export async function findOutputDir(projectPath: string): Promise<string | null> {
  for (const dir of WALKTHROUGH_OUTPUT_DIRS) {
    const ok = await fs
      .access(path.join(projectPath, dir, "index.html"))
      .then(() => true)
      .catch(() => false);
    if (ok) return path.join(projectPath, dir);
  }
  const rootHtml = await fs
    .access(path.join(projectPath, "index.html"))
    .then(() => true)
    .catch(() => false);
  if (rootHtml) return projectPath;
  return null;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export function serveStaticDir(outputDir: string): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
        let filePath = path.normalize(path.join(outputDir, urlPath));
        if (!filePath.startsWith(outputDir)) filePath = outputDir;
        let candidate = filePath;
        let stat = await fs.stat(candidate).catch(() => null);
        if (stat?.isDirectory()) {
          candidate = path.join(candidate, "index.html");
          stat = await fs.stat(candidate).catch(() => null);
        }
        if (!stat?.isFile()) {
          candidate = path.join(outputDir, "index.html");
          stat = await fs.stat(candidate).catch(() => null);
        }
        if (!stat) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        res.setHeader("Content-Type", MIME[path.extname(candidate).toLowerCase()] || "application/octet-stream");
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
        reject(new Error("Failed to bind walkthrough server"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

// ============================================================================
// Safe-target rules (never click dangerous/destructive things)
// ============================================================================

const UNSAFE_HREF = /^(https?:|mailto:|tel:|javascript:|data:)/i;

/** Is this target safe to DRIVE? External navigation, protocol links, disabled
 * controls and destructive inputs are skipped (never clicked). */
export function isWalkTargetSafe(target: WalkthroughTarget): string | null {
  if (target.disabled) return "disabled element";
  if (UNSAFE_HREF.test(target.href)) return `unsafe href (${target.href.slice(0, 48)})`;
  if (target.tag === "input" || target.tag === "textarea" || target.tag === "select") {
    // Typing into a text field is a data-write (and needs a value) — the
    // walk does not mutate state. Buttons and checkboxes remain drivable.
    return "destructive input (not typed by the walk)";
  }
  if (!target.text && !target.href && target.tag === "button") return "unlabeled button";
  return null;
}

// ============================================================================
// Report writer — durable proof artifact per workspace
// ============================================================================

export interface WrittenReport {
  dir: string;
  reportPath: string;
  reportRelPath: string;
  screenshotFiles: string[];
}

/** Write `.infinity/walkthrough/index.json` + `frame-NN.png` per frame +
 * `WALKTHROUGH.md` human readout. Best-effort: errors become `ok:false` NOT
 * a throw — a proof artifact is a bonus, never a walk-killer. */
export async function writeWalkthroughReport(baseDir: string, result: WalkthroughResult): Promise<WrittenReport | null> {
  try {
    const dir = path.join(baseDir, ".infinity", "walkthrough");
    await fs.mkdir(dir, { recursive: true });

    const screenshotFiles: string[] = [];
    for (const [i, frame] of result.frames.entries()) {
      if (!frame.screenshotBase64) continue;
      // The base frame carries enumerator index -1; a negative segment in the
      // proof filename is noise — clamp to 0 for a stable, sortable name.
      const elementId = String(Math.max(0, frame.index)).padStart(3, "0");
      const name = `frame-${String(i).padStart(2, "0")}-${elementId}.png`;
      await fs.writeFile(path.join(dir, name), Buffer.from(frame.screenshotBase64, "base64"));
      screenshotFiles.push(name);
    }

    const indexJson = {
      status: result.status,
      ok: result.ok,
      testedElements: result.testedElements,
      skippedElements: result.skippedElements,
      issues: result.issues,
      errors: result.errors,
      durationMs: result.durationMs,
      timestamp: result.timestamp,
      frames: result.frames.map((f) => ({
        index: f.index,
        label: f.label,
        kind: f.kind,
        skipReason: f.skipReason,
        tag: f.tag,
        text: f.text,
        href: f.href,
        screenshot: screenshotFiles.find((n) => n.startsWith(`frame-${String(result.frames.indexOf(f)).padStart(2, "0")}-`)) ?? null,
        consoleErrors: f.consoleErrors.length,
        textLen: f.state.textLen,
        overflow: f.state.overflow,
        url: f.url,
      })),
    };
    await fs.writeFile(path.join(dir, "index.json"), JSON.stringify(indexJson, null, 2));

    const mdLines = [
      `# Walkthrough — ${result.timestamp}`,
      "",
      `Status: **${result.status.toUpperCase()}** — ${result.testedElements} element(s) driven, ${result.skippedElements} skipped (${result.durationMs}ms).`,
      "",
      "## Regressions flagged",
      result.issues.length ? result.issues.map((i) => `- [${i.severity}] ${i.message}`) : ["- None."],
      "",
      "## Console errors",
      result.errors.length ? result.errors.map((e) => `- [ERROR] ${e}`) : ["- None."],
      "",
      "## Frames (per-element screenshot proof)",
      ...result.frames.map((f, i) => {
        const shot = screenshotFiles.find((n) => n.startsWith(`frame-${String(i).padStart(2, "0")}-`));
        return `- **${f.kind}** ${f.label} (\`${f.tag}\`)${shot ? ` — proof: \`${shot}\`` : ""}${f.skipReason ? ` — skipped: ${f.skipReason}` : ""}`;
      }),
      "",
    ];
    await fs.writeFile(path.join(dir, "WALKTHROUGH.md"), mdLines.join("\n"), "utf8");

    const rel = path.relative(baseDir, dir);
    return {
      dir,
      reportPath: path.join(dir, "index.json"),
      reportRelPath: rel ? `${rel.replace(/\\/g, "/")}/index.json` : ".infinity/walkthrough/index.json",
      screenshotFiles,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Model feedback — the LOOP channel
// ============================================================================

const MAX_VISION_SCREENSHOTS = 6;

/** Render the walkthrough evidence as a model-consumable text block. Always
 * emitted (cheap, textual); the screenshot parts are the vision upgrade. */
export function walkthroughFeedback(result: WalkthroughResult): WalkthroughFeedback {
  const issues = result.issues.filter((i) => i.severity !== "info").length
    ? `\n${result.issues.filter((i) => i.severity !== "info").map((i) => `  - [${i.severity}] ${i.message}`).join("\n")}`
    : "\n  (no major regressions — visual walkthrough clean)";
  const errors = result.errors.length
    ? `\n${result.errors.map((e) => `  - [ERROR] ${e}`).join("\n")}`
    : "";

  const text = [
    "## WALKTHROUGH EVIDENCE",
    `The built app was driven like a user in a real browser: ${result.testedElements} interactive element(s) clicked (${result.skippedElements} skipped as unsafe/destructive), ${result.frames.filter((f) => f.kind === "driven").length} post-click frame(s) captured with per-frame screenshot proof.`,
    `- Visual diff verdict: ${result.status}`,
    `- Regressions:${issues}`,
    `- Console/page errors:${errors}`,
    result.reportRelPath ? `- Full report (frames + screenshots): ${result.reportRelPath}` : "",
  ].join("\n");

  const screenshotParts = result.frames
    .map((f) => f.screenshotBase64)
    .filter((s): s is string => Boolean(s))
    .slice(0, MAX_VISION_SCREENSHOTS)
    .map((b64) => ({ type: "image_url" as const, image_url: { url: `data:image/png;base64,${b64}` } }));

  return { title: "WALKTHROUGH EVIDENCE", text, screenshotParts };
}

// ============================================================================
// The engine
// ============================================================================

/**
 * Drive one walk over a live, already-navigated browser. `browser.goto(url)` is
 * called FIRST by the engine so the base screenshot is the freshly-loaded app.
 *
 * Returns an honest verdict:
 *   - browser threw / had no page conntacts  → `not-enforced` with reason
 *   - walk completed with no critical/major regressions → `passed`
 *   - any blank-page / console-error / element-loss / overflow-growth → `failed`
 *   - `writeReport=true` (default) persists the proof artifact.
 */
export async function runWalkthrough(
  browser: WalkthroughBrowser,
  opts: WalkthroughOptions
): Promise<WalkthroughResult> {
  const started = Date.now();
  const result: WalkthroughResult = {
    status: "not-enforced",
    ok: false,
    testedElements: 0,
    skippedElements: 0,
    frames: [],
    issues: [],
    errors: [],
    reportDir: null,
    reportPath: null,
    reportRelPath: null,
    durationMs: 0,
    timestamp: new Date().toISOString(),
    screenshotFiles: [],
  };

  const maxElements = opts.maxElements ?? 30;
  const settleMs = opts.settleMs ?? 450;

  try {
    await browser.setViewport(1440, 900);
    await browser.goto(opts.url);

    // Base frame — the pre-action (regression baseline).
    const baseState = await browser.readState();
    const baseShot = await browser.screenshot();
    result.frames.push({
      index: -1,
      label: "base",
      tag: "document",
      text: "",
      href: "",
      kind: "base",
      screenshotBase64: baseShot?.base64 ?? null,
      consoleErrors: [],
      state: baseState,
      url: opts.url,
    });

    const targets = await browser.enumerateInteractables();
    const frames: WalkthroughFrame[] = [];
    let driven = 0;
    let skipped = 0;

    // Base-load console errors (during goto/settle) are real evidence — record
    // them on the base frame instead of dropping them. Per-frame deltas after
    // each click come from the post-click drain.
    const baseErrors = browser.drainConsoleErrors();
    if (baseErrors.length) {
      result.frames[0].consoleErrors = baseErrors;
      result.errors.push(...baseErrors);
    }

    for (const target of targets) {
      if (driven >= maxElements) break;
      const skipReason = isWalkTargetSafe(target);

      if (skipReason) {
        skipped += 1;
        frames.push({
          index: target.index,
          label: target.text || `${target.tag}#${target.index}`,
          tag: target.tag,
          text: target.text,
          href: target.href,
          kind: "skipped",
          skipReason,
          screenshotBase64: null,
          consoleErrors: [],
          state: baseState,
          url: opts.url,
        });
        continue;
      }

      try {
        await browser.click(target.index);
      } catch (err) {
        result.errors.push(
          `Element ${target.index} (${target.tag} ${target.text || "untitled"}) failed: ${err instanceof Error ? err.message : "click failed"}`
        );
        continue;
      }
      await new Promise((r) => setTimeout(r, settleMs));

      const state = await browser.readState().catch(() => baseState);
      const shot = await browser.screenshot();
      const consoleErrors = browser.drainConsoleErrors();
      const label = target.text || (target.tag === "button" ? `button#${target.index}` : `${target.tag}#${target.index}`);
      const frame: WalkthroughFrame = {
        index: target.index,
        label,
        tag: target.tag,
        text: target.text,
        href: target.href,
        kind: "driven",
        screenshotBase64: shot?.base64 ?? null,
        consoleErrors,
        state,
        url: opts.url,
      };
      frames.push(frame);
      driven += 1;

      const issues = visualDiff(baseState, state, frame);
      result.issues.push(...issues);
      result.errors.push(...consoleErrors);
    }

    result.testedElements = driven;
    result.skippedElements = skipped;
    result.frames.push(...frames);

    // Dedupe + cap the error list so the model never drowns in noise.
    result.errors = [...new Set(result.errors)].slice(0, 40);

    const critical = result.issues.filter((i) => i.severity === "critical");
    const major = result.issues.filter((i) => i.severity === "major");
    if (critical.length > 0) {
      result.status = "failed";
      result.ok = false;
      result.reason = `${critical.length} critical regression(s) found by the visual diff`;
    } else if (major.length > 0) {
      result.status = "failed";
      result.ok = false;
      result.reason = `${major.length} major regression(s) found by the visual diff`;
    } else if (result.errors.length > 0) {
      result.status = "failed";
      result.ok = false;
      result.reason = `${result.errors.length} console/page error(s) during the walk`;
    } else {
      result.status = "passed";
      result.ok = true;
      result.reason = `${driven} element(s) driven cleanly — no regressions`;
    }

    result.durationMs = Date.now() - started;
    return result;
  } catch (e) {
    result.status = "not-enforced";
    result.ok = false;
    result.reason = `Walkthrough could not run — NOT enforced (${e instanceof Error ? e.message : String(e)})`;
    result.durationMs = Date.now() - started;
    return result;
  }
}

/**
 * Run the walkthrough against a BUILT output dir (served locally + SPA
 * fallback). This is the completion-hook entry point: at build end the engine
 * drives the real `dist/` and returns the proof + feedback for the checkpoint.
 * Browser/Chrome or built-output unavailable ⇒ honest `not-enforced`.
 */
export async function runWalkthroughOnBuilt(
  projectPath: string,
  opts: Omit<WalkthroughOptions, "url"> & { buildId?: string; getBrowser?: () => Promise<WalkthroughBrowser> }
): Promise<WalkthroughResult> {
  const outputDir = await findOutputDir(projectPath);
  if (!outputDir) {
    return {
      status: "skipped",
      ok: false,
      testedElements: 0,
      skippedElements: 0,
      frames: [],
      issues: [],
      errors: [],
      reportDir: null,
      reportPath: null,
      reportRelPath: null,
      durationMs: 0,
      timestamp: new Date().toISOString(),
      screenshotFiles: [],
      reason: "No built output (dist/build/out with index.html) — walkthrough skipped (no app to drive yet)",
    };
  }

  // The caller hands in a browser factory so puppeteer is only required by the
  // REAL adapter, never by this module's import graph.
  let browser: WalkthroughBrowser;
  try {
    browser = await opts.getBrowser?.();
  } catch {
    browser = null as unknown as WalkthroughBrowser;
  }
  if (!browser) {
    return {
      status: "not-enforced",
      ok: false,
      testedElements: 0,
      skippedElements: 0,
      frames: [],
      issues: [],
      errors: [],
      reportDir: null,
      reportPath: null,
      reportRelPath: null,
      durationMs: 0,
      timestamp: new Date().toISOString(),
      screenshotFiles: [],
      reason: "No browser available — walkthrough NOT enforced (Chrome/puppeteer unreachable in this runtime)",
    };
  }

  const server = await serveStaticDir(outputDir).catch(() => null);
  if (!server) {
    await browser.close().catch(() => undefined);
    return {
      status: "not-enforced",
      ok: false,
      testedElements: 0,
      skippedElements: 0,
      frames: [],
      issues: [],
      errors: [],
      reportDir: null,
      reportPath: null,
      reportRelPath: null,
      durationMs: 0,
      timestamp: new Date().toISOString(),
      screenshotFiles: [],
      reason: "Could not serve the built output for the walkthrough — NOT enforced",
    };
  }

  try {
    const result = await runWalkthrough(browser, { ...opts, url: server.url });
    const written = await writeWalkthroughReport(projectPath, result);
    if (written) {
      result.reportDir = written.dir;
      result.reportPath = written.reportPath;
      result.reportRelPath = written.reportRelPath;
      result.screenshotFiles = written.screenshotFiles;
    }
    return result;
  } finally {
    server.server.close();
    await browser.close().catch(() => undefined);
  }
}

// ============================================================================
// Puppeteer-backed adapter (REAL browser — constructed only by callers that
// have puppeteer + Chrome reachable; importing this file stays clean).
// ============================================================================

/**
 * Build a `WalkthroughBrowser` over a puppeteer `Page`. Console/pageerror hooks
 * are attached here; every hop drains them so the engine sees per-frame deltas.
 * The function takes the page as an argument — the CALLER (route) creates it
 * from its own lazily-acquired browser, keeping puppeteer out of this module.
 */
export function createPuppeteerWalkthroughBrowser(page: {
  setViewport: (o: { width: number; height: number }) => Promise<unknown>;
  goto: (url: string, o?: Record<string, unknown>) => Promise<unknown>;
  evaluate: <T>(fn: (() => T | Promise<T>) | string, ...args: unknown[]) => Promise<T>;
  screenshot: (o?: Record<string, unknown>) => Promise<Buffer>;
  $eval: (sel: string, fn: (el: Element) => unknown) => Promise<unknown>;
  click?: (sel: string) => Promise<unknown>;
  on: (evt: string, fn: (...a: unknown[]) => void) => unknown;
  off: (evt: string, fn: (...a: unknown[]) => void) => unknown;
  close: () => Promise<unknown>;
}): WalkthroughBrowser {
  let consoleErrors: string[] = [];

  const onConsole = (msg: { type?: () => string | undefined; text: () => string }) => {
    if (msg.type?.() !== "error") return;
    const text = msg.text();
    if (/favicon|DevTools .* is not allowed to use/.test(text)) return;
    consoleErrors.push(`[error] ${text.slice(0, 400)}`);
  };
  const onPageError = (err: Error) => {
    consoleErrors.push(`[uncaught] ${err.message.slice(0, 400)}`);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  return {
    async setViewport(width: number, height: number) {
      await page.setViewport({ width, height });
    },
    async goto(url: string) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await new Promise((r) => setTimeout(r, 300));
    },
    async readState() {
      return page.evaluate(() => {
        const doc = document.documentElement;
        const body = document.body;
        const text = (body?.innerText ?? "").replace(/\s+/g, " ").trim();
        const overflow = Math.max(0, (doc?.scrollWidth || 0) - (doc?.clientWidth || 0));
        const visibleInteractive = document.querySelectorAll(
          "button, a, input, textarea, select, [role=button], [role=link]"
        ).length;
        let hash = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) {
          hash ^= text.charCodeAt(i);
          hash = Math.imul(hash, 0x01000193);
        }
        return {
          title: (document.title || "").trim(),
          textLen: text.length,
          visibleInteractive,
          overflow,
          textHash: (hash >>> 0).toString(16),
        };
      });
    },
    async enumerateInteractables() {
      return page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll(
          "button, a, input, textarea, select, [role=button], [role=link]"
        )) as HTMLElement[];
        return nodes.map((element, index) => ({
          index,
          tag: String(element.tagName).toLowerCase(),
          text: String(element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
          href: String(element.tagName).toLowerCase() === "a" ? String(element.getAttribute("href") ?? "") : "",
          disabled: element.getAttribute("disabled") !== null || (element as HTMLInputElement).disabled === true,
        }));
      });
    },
    async click(index: number) {
      const el = await page.evaluate(
        (i) => {
          const nodes = Array.from(document.querySelectorAll(
            "button, a, input, textarea, select, [role=button], [role=link]"
          )) as HTMLElement[];
          const node = nodes[i];
          if (!node) return false;
          (node as HTMLElement).click();
          return true;
        },
        index
      );
      if (!el) throw new Error(`interactive element #${index} not found`);
    },
    async screenshot() {
      try {
        const buf = await page.screenshot({ type: "png" });
        if (!buf || buf.length === 0) return null;
        return { base64: buf.toString("base64") };
      } catch {
        return null;
      }
    },
    drainConsoleErrors() {
      const drained = consoleErrors;
      consoleErrors = [];
      return drained;
    },
    async close() {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      await page.close();
    },
  };
}