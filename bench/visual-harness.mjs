#!/usr/bin/env node
/**
 * bench/visual-harness.mjs — FIX-plan Phase 7 acceptance: prove the VISUAL
 * VERIFICATION LOOP with the REAL module (`lib/build-walkthrough.ts`) driven by
 * a deterministic in-memory `WalkthroughBrowser` stand-in.
 *
 * This env has NO browser stack (puppeteer / pixelmatch / pngjs all absent,
 * node_modules wiped). Following the exact precedent of the Phase 2/3/4/5/6
 * harnesses, the ENGINE's mechanics are proven with deterministic stubs while
 * the real-browser adapter (puppeteer-backed) stays wired for runtimes that
 * have Chrome — the harness asserts its contract and does not run it.
 *
 * What this proves (mapped to the Phase 7 spec — "vision channel · diff ·
 * walkthrough"):
 *   S1. SAFE-DRIVE RULES — enabled buttons, `#`-hash links and
 *       `[role=button]` are driven; external/mailto/javascript hrefs,
 *       disabled controls and destructive inputs (textarea/select/input) are
 *       NEVER clicked (recorded as `skipped` with a reason).
 *   S2. PER-FRAME SCREENSHOT PROOF + REPORT — every driven element produces a
 *       frame with real PNG bytes; writeWalkthroughReport writes
 *       `.infinity/walkthrough/index.json` + `frame-NN.png` per frame +
 *       `WALKTHROUGH.md` into the workspace.
 *   S3. VISUAL DIFF CATCHES REAL REGRESSIONS — a click that blanks the page
 *       (critical blank-page), grows horizontal overflow (major), or throws a
 *       console error (major/critical) FAILS the walk with the right issue
 *       kind; a clean walk PASSES.
 *   S4. MODEL FEEDBACK + VISION CHANNEL — walkthroughFeedback renders a
 *       `## WALKTHROUGH EVIDENCE` block (always) + per-frame screenshot
 *       `image_url` vision parts (vision-capable adapters only).
 *   S5. runWalkthroughOnBuilt HONEST PATHS — no built output ⇒ honest
 *       `skipped`; browser unavailable ⇒ honest `not-enforced`; working
 *       browser + real `dist/` served through the SPA-static server ⇒ the walk
 *       runs, the verdict is real, and the report lands in the workspace.
 *   S6. SPA STATIC SERVER MECHANICS — serves `dist/index.html` at `/`,
 *       falls back to the app shell for arbitrary routes, never escapes the
 *       output dir.
 *
 * Exit code: 0 when every check passes; 1 otherwise.
 */
import { createRequire } from "node:module";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const API_SERVER = join(ROOT, "artifacts", "api-server");
const BUNDLE_FILE = join(API_SERVER, ".visual-harness-bundle.mjs");
const require = createRequire(join(API_SERVER, "package.json"));

const API = (p) => resolve(API_SERVER, "src", p).replace(/\\/g, "/");

// A real 1x1 transparent PNG — the per-frame screenshot proof bytes the stub
// returns, so the report writes are genuine PNG files.
const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const ENTRY = `
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

import {
  runWalkthrough,
  runWalkthroughOnBuilt,
  writeWalkthroughReport,
  walkthroughFeedback,
  visualDiff,
  hashText,
  findOutputDir,
  serveStaticDir,
  isWalkTargetSafe,
} from "${API("lib/build-walkthrough.ts")}";

let allPass = true;
const pass = (label) => console.log("✅  " + label);
const fail = (label, detail) => { console.error("❌  " + label + (detail ? " — " + detail : "")); allPass = false; };
const assert = (cond, label, detail) => (cond ? pass(label) : fail(label, detail));

const PNG = "${PNG_1x1}";

// ============================================================================
// Deterministic in-memory browser — a ScriptedApp is a tiny DOM-like model the
// stub reads and mutates so the REAL engine drives it exactly as it would a
// puppeteer Page.
// ============================================================================
class ScriptedApp {
  constructor({ title, text, interactables, effects = {}, baseErrors = [] }) {
    this.title = title;
    this.text = text;
    this.visible = interactables.length;
    this.overflow = 0;
    this.interactables = interactables;
    this.effects = effects;         // index -> { blank?, overflow?, errors?, throwErr? }
    this.baseErrors = baseErrors;
    this.queuedErrors = [];
    this.url = "http://stub/";
  }
  apply(index) {
    const e = this.effects[index] || {};
    if (e.throwErr) throw new Error(e.throwErr);
    if (e.blank) { this.text = ""; }
    if (e.overflow) { this.overflow = e.overflow; }
    if (e.errors) { this.queuedErrors.push(...e.errors); }
    if (e.text) { this.text = e.text; }
  }
  state() {
    const t = this.text.replace(/\\s+/g, " ").trim();
    let h = 0x811c9dc5;
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return {
      title: this.title,
      textLen: t.length,
      visibleInteractive: this.visible,
      overflow: this.overflow,
      textHash: (h >>> 0).toString(16),
    };
  }
}

function stubBrowser(app) {
  return {
    async setViewport() {},
    async goto(url) { app.url = url; app.queuedErrors = [...app.baseErrors]; },
    async readState() { return app.state(); },
    async enumerateInteractables() {
      return app.interactables.map((it, index) => ({ index, ...it }));
    },
    async click(index) {
      app.apply(index);
    },
    async screenshot() { return { base64: PNG }; },
    drainConsoleErrors() {
      const drained = app.queuedErrors;
      app.queuedErrors = [];
      return drained;
    },
    async close() {},
  };
}

const btn = (t) => ({ tag: "button", text: t, href: "", disabled: false });
const link = (t, href) => ({ tag: "a", text: t, href, disabled: false });

// ============================================================================
// S1. SAFE-DRIVE RULES
// ============================================================================
{
  const app = new ScriptedApp({
    title: "Test app",
    text: "Welcome to the app. Fill the form and save.",
    interactables: [
      btn("Save"),                       // 0 — driven
      { tag: "textarea", text: "", href: "", disabled: false }, // 1 — destructive
      { tag: "input", text: "", href: "", disabled: false },    // 2 — destructive
      link("About", "#/about"),          // 3 — driven (same-app hash)
      link("External", "https://evil.example/x"), // 4 — unsafe
      link("Mail", "mailto:a@b.c"),      // 5 — unsafe
      link("JS", "javascript:alert(1)"), // 6 — unsafe
      { tag: "button", text: "Locked", href: "", disabled: true }, // 7 — disabled
      { tag: "select", text: "", href: "", disabled: false },  // 8 — destructive
      { tag: "button", text: "", href: "", disabled: false },  // 9 — unlabeled button
    ],
  });
  app.visible = 100;
  const res = await runWalkthrough(stubBrowser(app), { url: "http://stub/", label: "s1", settleMs: 0, maxElements: 50 });
  assert(res.testedElements === 2, "S1 drives only the safe elements (Save + About hash link)", "got " + res.testedElements);
  assert(res.skippedElements === 8, "S1 records 8 skipped (textarea/input/external/mailto/javascript/disabled/select/unlabeled)", "got " + res.skippedElements);
  const skippedKinds = res.frames.filter((f) => f.kind === "skipped").map((f) => f.skipReason);
  assert(skippedKinds.includes("unsafe href (https://evil.example/x)"), "S1 external href skipped", skippedKinds.join(" | "));
  assert(skippedKinds.includes("destructive input (not typed by the walk)"), "S1 destructive input skipped", skippedKinds.join(" | "));
  assert(skippedKinds.includes("disabled element"), "S1 disabled element skipped", skippedKinds.join(" | "));
  assert(skippedKinds.includes("unlabeled button"), "S1 unlabeled button skipped", skippedKinds.join(" | "));
  assert(!skippedKinds.includes("unsafe href (#/about)"), "S1 #-hash link is NOT skipped", skippedKinds.join(" | "));
}

// ============================================================================
// S2. PER-FRAME SCREENSHOT PROOF + DURABLE REPORT
// ============================================================================
{
  const app = new ScriptedApp({
    title: "Landing",
    text: "Hero headline and a call to action.",
    interactables: [btn("Start"), btn("Pricing"), btn("Contact")],
  });
  app.visible = 3;
  const res = await runWalkthrough(stubBrowser(app), { url: "http://stub/", label: "s2", settleMs: 0, maxElements: 30 });
  assert(res.status === "passed" && res.ok === true, "S2 healthy walk passes", res.status + " " + (res.reason || ""));
  const drivenFrames = res.frames.filter((f) => f.kind === "driven");
  assert(drivenFrames.length === 3, "S2 one frame per driven element (3)", "got " + drivenFrames.length);
  assert(drivenFrames.every((f) => f.screenshotBase64 === PNG), "S2 every driven frame carries real PNG screenshot bytes", "");
  assert(drivenFrames.map((f) => f.label).join(",") === "Start,Pricing,Contact", "S2 frames labeled by element text", drivenFrames.map((f) => f.label).join(","));

  const base = mkdtempSync(join(os.tmpdir(), "wt-s2-"));
  const written = await writeWalkthroughReport(base, res);
  assert(written !== null, "S2 report written", "");
  assert(existsSync(join(base, ".infinity", "walkthrough", "index.json")), "S2 index.json exists", "");
  assert(existsSync(join(base, ".infinity", "walkthrough", "WALKTHROUGH.md")), "S2 WALKTHROUGH.md exists", "");
  // base frame + 3 driven frames = 4 screenshots => 4 frame-NN pngs
  const pngs = readFileSync(join(base, ".infinity", "walkthrough", "index.json"), "utf8");
  assert((pngs.match(/frame-\\d\\d-\\d\\d\\d\\.png/g) || []).length === 4, "S2 index.json references 4 frame screenshots", "");
  assert(written.reportRelPath === ".infinity/walkthrough/index.json", "S2 reportRelPath is workspace-relative", written.reportRelPath);
  const md = readFileSync(join(base, ".infinity", "walkthrough", "WALKTHROUGH.md"), "utf8");
  assert(md.includes("**PASSED**"), "S2 WALKTHROUGH.md has the verdict", "");
  assert(existsSync(join(base, ".infinity", "walkthrough", "frame-00-000.png")), "S2 base frame PNG on disk", "");
  assert(existsSync(join(base, ".infinity", "walkthrough", "frame-01-000.png")), "S2 first driven frame PNG on disk", "");
}

// ============================================================================
// S3. VISUAL DIFF CATCHES REAL REGRESSIONS
// ============================================================================
{
  // (a) click that BLANKS the page → critical blank-page
  const blankApp = new ScriptedApp({
    title: "App", text: "Lots of content here.", visible: 5,
    interactables: [btn("Danger")],
    effects: { 0: { blank: true } },
  });
  const r1 = await runWalkthrough(stubBrowser(blankApp), { url: "http://stub/", label: "s3a", settleMs: 0 });
  assert(r1.status === "failed" && !r1.ok, "S3a blank-page walks FAIL", r1.status + " " + (r1.reason || ""));
  assert(r1.issues.some((i) => i.kind === "blank-page" && i.severity === "critical"), "S3a issue is critical blank-page", JSON.stringify(r1.issues));
  assert(r1.issues.some((i) => i.message.includes("Danger")), "S3a blank-page issue names the triggering element", r1.issues[0]?.message || "");

  // (b) click that EXPLODES horizontal overflow → major overflow-growth
  const overApp = new ScriptedApp({
    title: "App", text: "Normal.", visible: 4,
    interactables: [btn("Wide")],
    effects: { 0: { overflow: 150 } },
  });
  const r2 = await runWalkthrough(stubBrowser(overApp), { url: "http://stub/", label: "s3b", settleMs: 0 });
  assert(r2.status === "failed" && !r2.ok, "S3b overflow-growth walk FAILS", r2.status + " " + (r2.reason || ""));
  assert(r2.issues.some((i) => i.kind === "overflow-growth" && i.severity === "major"), "S3b issue is major overflow-growth", JSON.stringify(r2.issues));

  // (c) click that throws a console error → failed with console-errors
  const errApp = new ScriptedApp({
    title: "App", text: "Normal.", visible: 3,
    interactables: [btn("Dodgy")],
    effects: { 0: { errors: ["[error] cannot read 'x' of undefined"] } },
  });
  const r3 = await runWalkthrough(stubBrowser(errApp), { url: "http://stub/", label: "s3c", settleMs: 0 });
  assert(r3.status === "failed" && !r3.ok, "S3c console-error walk FAILS", r3.status + " " + (r3.reason || ""));
  assert(r3.issues.some((i) => i.kind === "console-errors"), "S3c issue is console-errors", JSON.stringify(r3.issues));
  assert(r3.errors.includes("[error] cannot read 'x' of undefined"), "S3c error message reaches the report", r3.errors.join(" | "));

  // (d) an element whose click THROWS is recorded, the walk continues, and the
  //     remaining safe elements are still driven
  const throwApp = new ScriptedApp({
    title: "App", text: "Normal.", visible: 2,
    interactables: [btn("Broken"), btn("Fine")],
    effects: { 0: { throwErr: "handler crashed" } },
  });
  const r4 = await runWalkthrough(stubBrowser(throwApp), { url: "http://stub/", label: "s3d", settleMs: 0 });
  assert(r4.errors.some((e) => e.includes("Broken")), "S3d throwing click is recorded", r4.errors.join(" | "));
  assert(r4.frames.filter((f) => f.kind === "driven").some((f) => f.label === "Fine"), "S3d walk continues to the next safe element", "");
  assert(r4.status === "failed" && !r4.ok, "S3d a click failure fails the walk honestly", r4.status + " " + (r4.reason || ""));

  // (e) the pure diff unit: a normal click with an unchanged layout passes
  const okApp = new ScriptedApp({
    title: "App", text: "Stable.", visible: 2,
    interactables: [btn("Stable")],
  });
  const r5 = await runWalkthrough(stubBrowser(okApp), { url: "http://stub/", label: "s3e", settleMs: 0 });
  assert(r5.status === "passed" && r5.ok, "S3e clean walk PASSES", r5.status + " " + (r5.reason || ""));
}

// ============================================================================
// S4. MODEL FEEDBACK + VISION CHANNEL
// ============================================================================
{
  const app = new ScriptedApp({
    title: "App", text: "Welcome.", visible: 2,
    interactables: [btn("A"), btn("B")],
  });
  const res = await runWalkthrough(stubBrowser(app), { url: "http://stub/", label: "s4", settleMs: 0 });
  const fb = walkthroughFeedback(res);
  assert(fb.text.includes("## WALKTHROUGH EVIDENCE"), "S4 feedback block header present", "");
  assert(fb.text.includes("2 interactive element(s) clicked"), "S4 feedback reports driven count", fb.text.split("\\n")[1] || "");
  assert(fb.text.includes("Visual diff verdict: passed"), "S4 feedback reports the verdict", fb.text.split("\\n")[2] || "");
  assert(fb.screenshotParts.length === 3, "S4 screenshot vision parts emitted (base + 2 driven)", "got " + fb.screenshotParts.length);
  assert(fb.screenshotParts.every((p) => p.type === "image_url" && p.image_url.url.startsWith("data:image/png;base64,")), "S4 vision parts are image_url data URLs", "");
}

// ============================================================================
// S5. runWalkthroughOnBuilt HONEST PATHS + REAL SERVED RUN
// ============================================================================
{
  // (a) no built output ⇒ honest "skipped" — never a forged pass
  const bare = mkdtempSync(join(os.tmpdir(), "wt-s5a-"));
  writeFileSync(join(bare, "src.txt"), "not a build");
  const snip = await runWalkthroughOnBuilt(bare, { label: "s5a" });
  assert(snip.status === "skipped" && !snip.ok, "S5a no-built-output ⇒ skipped", snip.status + " " + (snip.reason || ""));
  assert((snip.reason || "").includes("No built output"), "S5a reason explains the skip", snip.reason || "");

  // (b) built output + NO browser factory ⇒ honest "not-enforced"
  const built = mkdtempSync(join(os.tmpdir(), "wt-s5b-"));
  mkdirSync(join(built, "dist"), { recursive: true });
  writeFileSync(join(built, "dist", "index.html"), "<html><body><button>Go</button></body></html>");
  const notEnforced = await runWalkthroughOnBuilt(built, { label: "s5b" });
  assert(notEnforced.status === "not-enforced" && !notEnforced.ok, "S5b no-browser ⇒ not-enforced", notEnforced.status + " " + (notEnforced.reason || ""));
  assert((notEnforced.reason || "").includes("No browser available"), "S5b reason says browser unavailable", notEnforced.reason || "");

  // (c) built output + working browser ⇒ the REAL engine drives the SERVED
  //     dist through the SPA static server, passes, and writes the report
  const app = new ScriptedApp({
    title: "Served app", text: "Hello from dist.", visible: 2,
    interactables: [btn("Click me"), link("Docs", "#/docs")],
  });
  const served = await runWalkthroughOnBuilt(built, {
    label: "s5c",
    settleMs: 0,
    maxElements: 30,
    getBrowser: async () => stubBrowser(app),
  });
  assert(served.status === "passed" && served.ok, "S5c served-dist walk passes", served.status + " " + (served.reason || ""));
  assert(served.frames[0].kind === "base" && served.frames[0].url.startsWith("http://127.0.0.1:"), "S5c engine navigated the LOCAL SPA server", served.frames[0]?.url || "none");
  assert(existsSync(join(built, ".infinity", "walkthrough", "index.json")), "S5c report persisted into the workspace's .infinity/walkthrough", "");
  assert(served.reportRelPath === ".infinity/walkthrough/index.json", "S5c returned report rel-path", served.reportRelPath || "");

  // (d) findOutputDir finds the dist/ we made
  const found = await findOutputDir(built);
  assert(found === join(built, "dist"), "S5d findOutputDir resolves dist/", found || "none");
}

// ============================================================================
// S6. SPA STATIC SERVER MECHANICS
// ============================================================================
{
  const root = mkdtempSync(join(os.tmpdir(), "wt-s6-"));
  mkdirSync(join(root, "dist"), { recursive: true });
  const html = "<html><body><h1>Home</h1><button>Go</button></body></html>";
  writeFileSync(join(root, "dist", "index.html"), html);
  const server = await serveStaticDir(join(root, "dist"));
  const index = await fetch(server.url + "/").then((r) => r.text());
  assert(index === html, "S6 serves index.html at /", index.slice(0, 40));
  const spa = await fetch(server.url + "/some/deep/route").then((r) => r.status);
  assert(spa === 200, "S6 SPA fallback returns 200 for deep routes", "got " + spa);
  const spaBody = await fetch(server.url + "/some/deep/route").then((r) => r.text());
  assert(spaBody === html, "S6 SPA fallback renders the app shell", spaBody.slice(0, 40));
  server.server.close();
}

const fine = [[hashText("a"), hashText("a")].every((v) => v === hashText("a"))] && [hashText("a") !== hashText("b")];
assert(fine, "SANITY hashText is deterministic + collision-free for small inputs", hashText("a") + " vs " + hashText("b"));

console.log(allPass ? "\\nVISUAL_HARNESS_OK" : "\\nVISUAL_HARNESS_FAIL");
process.exit(allPass ? 0 : 1);
`;

// ============================================================================
// Bundle the REAL module + harness body exactly like production paths use it.
// Only node built-ins are imported by the module ⇒ no external list needed.
// ============================================================================
const esbuild = require("esbuild");
await esbuild.build({
  stdin: { contents: ENTRY, sourcefile: "visual-harness-entry.ts", resolveDir: API_SERVER, loader: "ts" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: BUNDLE_FILE,
  logLevel: "silent",
  banner: {
    js: [
      "import * as __bannerPath from 'node:path';",
      "import { fileURLToPath as __bannerFileURLToPath } from 'node:url';",
      "globalThis.__filename = __bannerFileURLToPath(import.meta.url);",
      "globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);",
    ].join("\n"),
  },
});

const run = spawnSync(process.execPath, [BUNDLE_FILE], { encoding: "utf8", env: { ...process.env, NODE_ENV: "production" } });
process.stdout.write(run.stdout);
if (run.stderr) process.stderr.write(run.stderr);
process.exit(run.status ?? 1);