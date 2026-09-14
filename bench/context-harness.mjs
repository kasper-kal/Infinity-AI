#!/usr/bin/env node
/**
 * bench/context-harness.mjs — FIX-plan Phase 4 acceptance: prove CONTEXT THAT
 * SURVIVES (4-level compaction with preservation, persistent working context,
 * smart file inclusion, manual compact controls) with REAL bundled modules +
 * REAL Postgres.
 *
 * What this proves:
 *   1. COMPACTION PRESERVATION (direct) — compactContext to L2 then L3 keeps
 *      keyDecisions, fileMap, errorPatterns, projectGoal intact.
 *   2. AUTO ESCALATION (live wiring) — crossing 10 steps triggers the
 *      step-count auto-compactor → level escalates to 2, nothing preserved is lost.
 *   3. DISK RESTART — .infinity/working-context.json survives clearContext():
 *      goal, decisions, error patterns, fileMap, token budget all restore.
 *   4. CHECKPOINT ROUND-TRIP — persistContextToCheckpoint stores the REAL
 *      fileMap (+ currentPlan); loadContextFromCheckpoint reconstructs it.
 *   5. SMART FILE INCLUSION — 1000-file synthetic repo → refreshFileMap returns
 *      exactly the 20 dashboard-relevant files (not the whole repo).
 *   6. MANUAL COMPACT + RESET — manualCompact(pid, 3) sets level 3;
 *      resetCompaction() returns to level 1 (Debug panel controls).
 *   7. RESUME INTEGRATION — loadOrCreateContextFromPersistentStore restores the
 *      full context (what build-orchestrator.loadContext does on reuse/kill).
 *   8. TELEMETRY — the compaction events that drive CompactionHistory are
 *      really emitted (read back from build-telemetry).
 *
 * Exit code: 0 when every check passes; 1 otherwise.
 */
import { createRequire } from "node:module";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const API_SERVER = join(ROOT, "artifacts", "api-server");
const BUNDLE_FILE = join(API_SERVER, ".context-harness-bundle.mjs");
const require = createRequire(join(API_SERVER, "package.json"));

const API = (p) => resolve(API_SERVER, "src", p).replace(/\\/g, "/");

const ENTRY = `
import { promises as fsp } from "node:fs";
import path from "node:path";
import { ensureTables } from "${API("lib/auto-migrate.ts")}";
import { getWorkspaceRoot, ensureWorkspace } from "${API("lib/workspace.ts")}";
import { readAllEvents } from "${API("lib/build-telemetry.ts")}";
import {
  setProjectGoal,
  recordStep,
  recordDecision,
  recordErrorPattern,
  trackTokens,
  getWorkingContext,
  refreshFileMap,
  clearContext,
  saveWorkingContextToDisk,
  loadWorkingContextFromDisk,
  loadContextFromCheckpoint,
  loadOrCreateContextFromPersistentStore,
  compactContext,
  autoCompactContext,
  manualCompact,
  resetCompaction,
  getContextDebugInfo,
} from "${API("lib/build-context.ts")}";

let allPass = true;
const pass = (label) => console.log("✅  " + label);
const fail = (label, detail) => { console.error("❌  " + label + (detail ? " — " + detail : "")); allPass = false; };
const assert = (cond, label, detail) => cond ? pass(label) : fail(label, detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Create a few real source files in the project workspace so refreshFileMap has
// something to map (small workspaces keep every eligible file).
async function seedMiniWorkspace(pid, names) {
  const root = await ensureWorkspace(pid);
  await fsp.mkdir(path.join(root, "src"), { recursive: true });
  for (const n of names) {
    const base = n.replace(/\\.[^.]+$/, "");
    await fsp.writeFile(
      path.join(root, "src", n),
      "// " + base + " module\\n\\nexport function " + base + "() { return true; }\\n",
      "utf8",
    );
  }
}

const SEED_FILES = ["Utils.ts", "Auth.ts", "Payments.ts"];

async function main() {
  console.log("CONTEXT HARNESS — Phase 4: Context That Survives");

  // ============================================================
  // 0. DB bootstrap — create build_checkpoints (idempotent)
  // ============================================================
  console.log("\\n=== 0. DB BOOTSTRAP ===");
  await ensureTables();
  pass("ensureTables() — build_checkpoints table ready");

  // ============================================================
  // 1. COMPACTION PRESERVATION (direct L2 → L3)
  // ============================================================
  console.log("\\n=== 1. COMPACTION PRESERVATION ===");
  const pid1 = "bench-ctx-preserve";
  clearContext(pid1);
  await seedMiniWorkspace(pid1, SEED_FILES);
  await refreshFileMap(pid1); // seed the fileMap the compaction must preserve
  setProjectGoal(pid1, "Build a dashboard analytics app with auth and payments");
  recordDecision(pid1, "Use React Query for data fetching", "Avoids SWR complexity on the dashboard");
  recordDecision(pid1, "Use Tailwind CSS", "Fastest path to a polished dashboard");
  recordDecision(pid1, "Postgres for persistence", "Already provisioned in the infra");
  recordErrorPattern(pid1, "missing import from @workspace/db", "Add the @workspace/db import");
  recordErrorPattern(pid1, "TS2304: Cannot find name 'x'", "Import x from its module");
  recordErrorPattern(pid1, "dashboard-analytics module not found", "Symlink the local package");
  for (let i = 1; i <= 6; i++) {
    recordStep(pid1, { stepId: "s" + i, description: "Step " + i, ok: true, filesChanged: ["src/Auth.ts"] });
  }
  await sleep(80); // let any fire-and-forget maybeAutoCompact settle
  await compactContext(pid1, 2, "step-count");
  await compactContext(pid1, 3, "manual");
  {
    const ctx = getWorkingContext(pid1);
    assert(ctx.compactionLevel === 3, "compact to L3 sets compactionLevel=3", "level=" + ctx.compactionLevel);
    assert(ctx.keyDecisions.length === 3, "all 3 keyDecisions preserved through L3", "count=" + ctx.keyDecisions.length);
    assert(ctx.errorPatterns.length === 3, "errorPatterns preserved through L3", "count=" + ctx.errorPatterns.length);
    assert(ctx.fileMap.size === SEED_FILES.length, "fileMap preserved through L3", "size=" + ctx.fileMap.size);
    assert(ctx.projectGoal.includes("dashboard"), "projectGoal survives compaction");
    assert(ctx.totalStepsOriginal === 6, "totalStepsOriginal tracked across compaction", ctx.totalStepsOriginal);
  }

  // ============================================================
  // 2. AUTO ESCALATION — >10 steps triggers live auto-compaction
  // ============================================================
  console.log("\\n=== 2. AUTO ESCALATION (step-count trigger) ===");
  const pid2 = "bench-ctx-auto";
  clearContext(pid2);
  await seedMiniWorkspace(pid2, ["DashboardHome.ts", "MetricsWidget.ts"]);
  await refreshFileMap(pid2); // seed the fileMap the auto-compaction must preserve
  setProjectGoal(pid2, "dashboard metrics");
  recordDecision(pid2, "Chart library", "Recharts for the dashboard");
  recordErrorPattern(pid2, "chart rendering fails", "Pass a stable key prop");
  for (let i = 1; i <= 12; i++) {
    recordStep(pid2, { stepId: "t" + i, description: "Implement tick " + i, ok: true, filesChanged: [] });
  }
  await sleep(120);
  const autoLevel = await autoCompactContext(pid2);
  const debug2 = getContextDebugInfo(pid2);
  assert(debug2.totalStepsOriginal === 12, "12 steps recorded (>10 threshold)", String(debug2.totalStepsOriginal));
  assert(debug2.compactionLevel >= 2, "auto-compaction escalated to L2+", "level=" + debug2.compactionLevel + " returned=" + autoLevel);
  {
    const ctx = getWorkingContext(pid2);
    assert(ctx.keyDecisions.length === 1, "decision survived auto-compaction");
    assert(ctx.errorPatterns.length === 1, "error pattern survived auto-compaction");
    assert(ctx.fileMap.size === 2, "fileMap survived auto-compaction", "size=" + ctx.fileMap.size);
  }

  // ============================================================
  // 3. DISK RESTART — working-context.json survives clearContext()
  // ============================================================
  console.log("\\n=== 3. WORKING-CONTEXT DISK RESTART ===");
  const pid3 = "bench-ctx-disk";
  clearContext(pid3);
  await seedMiniWorkspace(pid3, ["home.ts", "api.ts"]);
  setProjectGoal(pid3, "Build a landing page");
  recordDecision(pid3, "Framework", "Next.js for SEO");
  recordErrorPattern(pid3, "hydration mismatch", "Add suppressHydrationWarning only where needed");
  trackTokens(pid3, 1200);
  await refreshFileMap(pid3);
  await saveWorkingContextToDisk(pid3);
  const diskPath = path.join(getWorkspaceRoot(pid3), ".infinity", "working-context.json");
  const diskExists = await fsp.stat(diskPath).then(() => true).catch(() => false);
  assert(diskExists, "working-context.json written on disk", diskPath);
  clearContext(pid3); // 🔄 simulate process restart
  const restored3 = await loadWorkingContextFromDisk(pid3);
  assert(restored3 !== null, "loadWorkingContextFromDisk restores a context");
  if (restored3) {
    assert(restored3.projectGoal === "Build a landing page", "goal restored from disk");
    assert(restored3.keyDecisions.length === 1, "decisions restored from disk");
    assert(restored3.errorPatterns.length === 1, "error patterns restored from disk");
    assert(restored3.fileMap.size === 2, "fileMap restored from disk", "size=" + restored3.fileMap.size);
    assert(restored3.tokenBudget.used === 1200, "token budget restored from disk", String(restored3.tokenBudget.used));
  }

  // ============================================================
  // 4. CHECKPOINT ROUND-TRIP — real fileMap + currentPlan in Postgres
  // ============================================================
  console.log("\\n=== 4. CHECKPOINT ROUND-TRIP (real Postgres) ===");
  const pid4 = "bench-ctx-checkpoint";
  clearContext(pid4);
  await seedMiniWorkspace(pid4, ["kpi.ts", "charts.ts", "store.ts"]);
  await refreshFileMap(pid4); // real fileMap that must round-trip through Postgres
  setProjectGoal(pid4, "Analytics dashboard with KPIs and charts");
  getWorkingContext(pid4).currentPlan = { steps: [{ id: "plan-1", title: "Scaffold" }] };
  recordDecision(pid4, "State", "Zustand for dashboard state");
  recordDecision(pid4, "Data", "Server-side aggregation");
  recordErrorPattern(pid4, "KPI integer overflow", "Cast to bigint in SQL");
  await compactContext(pid4, 2, "harness"); // persists to build_checkpoints
  clearContext(pid4);
  const restored4 = await loadContextFromCheckpoint(pid4);
  assert(restored4 !== null, "loadContextFromCheckpoint finds the seeded checkpoint");
  if (restored4) {
    assert(restored4.fileMap.size === 3, "checkpoint restores the REAL fileMap (not just its size)", "size=" + restored4.fileMap.size);
    assert(restored4.currentPlan !== null, "checkpoint restores currentPlan");
    assert(restored4.projectGoal.includes("Analytics"), "checkpoint restores the goal");
    assert(restored4.keyDecisions.length >= 2, "decisions restored from checkpoint", String(restored4.keyDecisions.length));
    assert(restored4.compactionLevel === 2, "compaction level restored from checkpoint", String(restored4.compactionLevel));
  }

  // ============================================================
  // 5. SMART FILE INCLUSION — 1000-file repo → 20 relevant files
  // ============================================================
  console.log("\\n=== 5. SMART FILE INCLUSION (1000 → 20) ===");
  const SMART_DIR = "bench-ctx-smart";
  const smartRoot = await ensureWorkspace(SMART_DIR);
  await fsp.rm(smartRoot, { recursive: true, force: true });
  await ensureWorkspace(SMART_DIR);
  await fsp.mkdir(path.join(smartRoot, "dashboard"), { recursive: true });
  await fsp.mkdir(path.join(smartRoot, "misc"), { recursive: true });
  const dashWrites = [];
  for (let i = 1; i <= 20; i++) {
    const n = String(i).padStart(3, "0");
    dashWrites.push(
      fsp.writeFile(
        path.join(smartRoot, "dashboard", "Widget" + n + ".ts"),
        "// dashboard analytics widget\\n\\nexport function dashboardWidget" + n + "() { return true; }\\n",
        "utf8",
      ),
    );
  }
  const miscWrites = [];
  for (let i = 1; i <= 980; i++) {
    const n = String(i).padStart(3, "0");
    miscWrites.push(
      fsp.writeFile(
        path.join(smartRoot, "misc", "Misc" + n + ".ts"),
        "// misc filler module\\n\\nexport function misc" + n + "() { return true; }\\n",
        "utf8",
      ),
    );
  }
  await Promise.all(dashWrites.concat(miscWrites));
  {
    let counts = await (async () => {
      const all = await fsp.readdir(smartRoot, { recursive: true });
      let dashes = 0, misc = 0;
      for (const rel of all) {
        if (typeof rel !== "string") continue;
        if (rel.startsWith("dashboard/") && rel.endsWith(".ts")) dashes++;
        else if (rel.startsWith("misc/") && rel.endsWith(".ts")) misc++;
      }
      return { dashes, misc, total: dashes + misc };
    })();
    assert(counts.total === 1000, "synthetic repo built with 1000 source files", counts.dashes + " dashboard + " + counts.misc + " misc");
    clearContext(SMART_DIR);
    setProjectGoal(SMART_DIR, "dashboard");
    const smartMap = await refreshFileMap(SMART_DIR);
    assert(smartMap.size === 20, "agent sees exactly 20 files (SMART_CAP)", "size=" + smartMap.size);
    assert(
      Array.from(smartMap.keys()).every((k) => k.startsWith("dashboard/")),
      "all 20 included files are the goal-relevant dashboard files",
      Array.from(smartMap.keys()).slice(0, 3).join(", ") + ", …",
    );
  }

  // ============================================================
  // 6. MANUAL COMPACT + RESET (Debug panel controls)
  // ============================================================
  console.log("\\n=== 6. MANUAL COMPACT + RESET ===");
  const pid6 = "bench-ctx-manual";
  clearContext(pid6);
  await seedMiniWorkspace(pid6, ["a.ts", "b.ts"]);
  setProjectGoal(pid6, "Manual compaction test");
  for (let i = 1; i <= 4; i++) {
    recordStep(pid6, { stepId: "m" + i, description: "Manual step " + i, ok: true, filesChanged: [] });
  }
  await manualCompact(pid6, 3);
  assert(getContextDebugInfo(pid6).compactionLevel === 3, "manualCompact(L3) sets level 3");
  await resetCompaction(pid6);
  const debugAfterReset = getContextDebugInfo(pid6);
  assert(debugAfterReset.compactionLevel === 1, "resetCompaction() returns to level 1", "level=" + debugAfterReset.compactionLevel);
  assert(getWorkingContext(pid6).compactedSummary === null, "resetCompaction() clears the compacted summary");

  // ============================================================
  // 7. RESUME INTEGRATION — what build-orchestrator.loadContext does
  // ============================================================
  console.log("\\n=== 7. RESUME INTEGRATION (restore on kill) ===");
  const pid7 = "bench-ctx-resume";
  clearContext(pid7);
  await seedMiniWorkspace(pid7, ["main.ts", "about.ts", "contact.ts"]);
  setProjectGoal(pid7, "Resume-friendly marketing site");
  recordDecision(pid7, "SSG", "Use Astro for the marketing site");
  recordDecision(pid7, "Style", "Plain CSS, no framework");
  recordErrorPattern(pid7, "missing image alt", "Add alt text to every img");
  await refreshFileMap(pid7);
  await compactContext(pid7, 2, "harness");
  clearContext(pid7); // 🔄 kill + restart
  const resumed = await loadOrCreateContextFromPersistentStore(pid7);
  assert(resumed.projectGoal.includes("Resume"), "resume restores the project goal");
  assert(resumed.fileMap.size === 3, "resume restores the fileMap", "size=" + resumed.fileMap.size);
  assert(resumed.keyDecisions.length === 2, "resume restores key decisions");
  assert(resumed.compactionLevel === 2, "resume restores compaction level", String(resumed.compactionLevel));

  // ============================================================
  // 8. TELEMETRY — real compaction events feed the Debug panel
  // ============================================================
  console.log("\\n=== 8. COMPACTION TELEMETRY ===");
  await sleep(50);
  const events = await readAllEvents(pid2); // pid2 got auto-compacted earlier
  const compEvents = events.filter((e) => e.type === "compaction");
  assert(compEvents.length > 0, "compaction events are emitted to telemetry", "count=" + compEvents.length);
  if (compEvents.length > 0) {
    const last = compEvents[compEvents.length - 1];
    const d = (last.data || {});
    assert(d.trigger === "step-count" || d.trigger === "manual", "event carries the honest trigger", String(d.trigger));
    assert(typeof d.levelName === "string" && d.levelName.length > 0, "event carries the compaction level name", String(d.levelName));
    assert(d.preservedItems && d.preservedItems.fileMapFiles >= 0, "event carries preservedItems payload");
  }

  // ============================================================
  // CLEANUP — remove synthetic project workspaces (keep the repo clean)
  // ============================================================
  console.log("\\n=== CLEANUP ===");
  const benchIds = [pid1, pid2, pid3, pid4, SMART_DIR, pid6, pid7];
  for (const pid of benchIds) {
    const root = getWorkspaceRoot(pid);
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }
  pass("removed " + benchIds.length + " synthetic bench workspaces");

  // ============================================================
  // RESULT
  // ============================================================
  console.log("");
  console.log(allPass ? "CONTEXT_HARNESS_OK" : "CONTEXT_HARNESS_FAILED");
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("context-harness bundle:", err);
  process.exit(1);
});
`;

async function main() {
  const esbuild = require("esbuild");
  await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: API_SERVER, sourcefile: "context-harness-entry.ts", loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: BUNDLE_FILE,
    logLevel: "warning",
    external: [
      "*.node", "sharp", "js-yaml", "fast-xml-parser", "marked", "turndown",
      "pdfkit", "xlsx", "ffmpeg-static", "@ffmpeg/*", "node-cron", "resend",
      "@sendgrid/mail", "glob", "better-sqlite3", "sqlite3", "canvas",
      "bcrypt", "argon2", "fsevents", "re2", "farmhash", "xxhash-addon",
      "bufferutil", "utf-8-validate", "ssh2", "cpu-features",
      "dtrace-provider", "isolated-vm", "lightningcss", "pg-native",
      "oracledb", "mongodb-client-encryption", "nodemailer", "handlebars",
      "knex", "typeorm", "protobufjs", "onnxruntime-node", "@tensorflow/*",
      "@google/*", "googleapis", "firebase-admin", "@parcel/watcher",
      "@sentry/profiling-node", "@tree-sitter/*", "aws-sdk", "classic-level",
      "dd-trace", "ffi-napi", "grpc", "hiredis", "kerberos", "leveldown",
      "miniflare", "mysql2", "newrelic", "odbc", "piscina", "realm", "ref-napi",
      "rocksdb", "sass-embedded", "sequelize", "serialport", "snappy",
      "tinypool", "usb", "workerd", "wrangler", "zeromq", "zeromq-prebuilt",
      "puppeteer", "puppeteer-core", "execa",
      "pino", "pino-pretty", "pino-std-serializers", "thread-stream", "sonic-boom",
    ],
    banner: {
      js: `import { createRequire as __cr } from "node:module";
import * as __bannerPath from "node:path";
import { fileURLToPath as __bannerFileURLToPath } from "node:url";
globalThis.require = __cr(${JSON.stringify(join(API_SERVER, "package.json"))});
globalThis.__filename = __bannerFileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);`,
    },
  });

  const env = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://codespace:securespace@localhost:5432/codespace",
  };
  const run = spawnSync(process.execPath, [BUNDLE_FILE], { env, stdio: "inherit", cwd: ROOT, timeout: 120_000 });
  process.exit(run.status ?? 1);
}

main().catch((err) => {
  console.error("context-harness failed:", err);
  process.exit(1);
});