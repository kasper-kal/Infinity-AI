#!/usr/bin/env node
/**
 * bench/gate-run.mjs — Phase 1 harness: run the REAL done-contract gates
 * against the existing benchmark outputs and assert the Phase 1 contract holds.
 *
 * What this proves (the fast honest Phase 1 gate):
 *   - Every one of the 9 done gates returns a real `status`:
 *     passed / failed / skipped. `skipped` must carry a details explanation
 *     (a real "not applicable" predicate), and NO gate may return
 *     `not-enforced` (never "we didn't implement it") and none may error.
 *   - All gates run on the shared Chrome inspection (one pass per app), so
 *     performance/a11y/seo measure the ACTUAL rendered apps, not fixtures.
 *
 * Usage:
 *   node bench/gate-run.mjs                # all apps under bench/out
 *   node bench/gate-run.mjs --app saas-landing
 *   node bench/gate-run.mjs --out out/x
 *
 * Exit code: 0 when the contact holds (no not-enforced, no gate errors);
 * 1 otherwise. Individual gate failures vs an app are REPORTED, not hidden —
 * the Phase 1 acceptance for builds is "all 9 gates pass", which live builds
 * must earn by fixing those failures.
 */
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const API_SERVER = join(ROOT, "artifacts", "api-server");
const OUT_DEFAULT = join(ROOT, "bench", "out");
const BUNDLE_FILE = join(API_SERVER, ".gate-run-bundle.mjs");

const require = createRequire(join(API_SERVER, "package.json"));

const opts = { out: OUT_DEFAULT, apps: [] };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--out") opts.out = resolve(process.argv[++i]);
  else if (a === "--app") opts.apps.push(process.argv[++i]);
  else opts.apps.push(a);
}

const ENTRY = `
import * as path from "node:path";
import { promises as fs } from "node:fs";
import {
  createRuntimeErrorGate, createVisualVerificationGate, createAccessibilityGate,
  createPerformanceGate, createSeoGate, createSecurityScanGate,
  createBundleSizeGate, createCrossPlatformGate, createLoadTestGate,
  createRateLimitGate, createPwaGate,
} from "${resolve(API_SERVER, "src/lib/build-done-contract.ts").replace(/\\/g, "/")}";

async function main() {
const OUT = process.env.GATE_RUN_OUT || path.resolve("bench/out");
const APPS = (process.env.GATE_RUN_APPS || "").split(",").filter(Boolean);
const appSlugs = APPS.length ? APPS : (await fs.readdir(OUT)).filter((d) => !d.startsWith(".") && !d.startsWith("_"));

const GATES = [
  { g: createRuntimeErrorGate(), phaseLabel: "runtime-errors" },
  { g: createVisualVerificationGate(), phaseLabel: "visual" },
  { g: createAccessibilityGate(), phaseLabel: "a11y" },
  { g: createPerformanceGate(), phaseLabel: "perf" },
  { g: createSeoGate(), phaseLabel: "seo" },
  { g: createSecurityScanGate(), phaseLabel: "security" },
  { g: createBundleSizeGate(), phaseLabel: "bundle-size" },
  { g: createCrossPlatformGate(), phaseLabel: "cross-platform" },
  { g: createLoadTestGate(), phaseLabel: "load-test" },
  { g: createRateLimitGate(), phaseLabel: "rate-limit" },
  { g: createPwaGate(), phaseLabel: "pwa" },
];
const width = (s, n) => (s ?? "").padEnd(n).slice(0, n);

let violations = [];
for (const app of appSlugs) {
  const projectPath = path.join(OUT, app);
  const context = { projectId: "bench-" + app, workspaceId: "bench", buildId: "bench-" + app, projectPath, buildType: "website" };
  const rows = [];
  for (const { g, phaseLabel } of GATES) {
    let r;
    try {
      r = await g.verify(context);
    } catch (err) {
      r = { gate: g.id, passed: false, details: "gate threw: " + (err?.message ?? String(err)), severity: g.severity };
    }
    if (!r.status) r.status = "no-status";
    rows.push({ ...r, phaseLabel });
    if (r.status === "not-enforced") violations.push({ app, gate: r.gate, problem: "not-enforced (unimplemented) returned" });
    if (r.status === "error") violations.push({ app, gate: r.gate, problem: "gate errored" });
    if (r.status === "no-status") violations.push({ app, gate: r.gate, problem: "legacy result without status — cannot certify honesty" });
  }
  console.log("\\n=== " + app + " ===");
  for (const r of rows) {
    const icon = r.status === "passed" ? "PASS " : r.status === "skipped" ? "SKIP " : "FAIL ";
    console.log(\`  \${icon} \${width(r.gate, 16)}\${width(r.status, 12)} \${r.details ?? ""}\`);
  }
  // Persist per-app gate evidence for the acceptance record.
  await fs.writeFile(path.join(projectPath, "gates.json"), JSON.stringify(rows.map(({ gate, passed, status, details, severity, evidence }) => ({ gate, passed, status, details, severity, evidence })), null, 2));
}

// Verdict table
console.log("\\n=== PHASE 1 GATE MAP ===");
const summary = {};
for (const { g } of GATES) {
  summary[g.id] = { passed: 0, failed: 0, skipped: 0, notEnforced: 0, error: 0 };
}
for (const app of appSlugs) {
  const rows = JSON.parse(await fs.readFile(path.join(OUT, app, "gates.json"), "utf-8"));
  for (const r of rows) {
    const s = summary[r.gate];
    if (!s) continue;
    if (r.status === "passed") s.passed++;
    else if (r.status === "failed") s.failed++;
    else if (r.status === "skipped") s.skipped++;
    else if (r.status === "not-enforced") s.notEnforced++;
    else s.error++;
  }
}
for (const [gate, s] of Object.entries(summary)) {
  console.log(\`  \${width(gate, 16)} passed:\${s.passed} failed:\${s.failed} skipped:\${s.skipped} not-enforced:\${s.notEnforced} errors:\${s.error}\`);
}

if (violations.length) {
  console.error("\\nFAIL — Phase 1 contact violated:");
  for (const v of violations) console.error(\`  - \${v.app} / \${v.gate}: \${v.problem}\`);
  process.exit(1);
}
console.log("\\nOK — no not-enforced, no gate errors. Every gate returned a real passed/failed/skipped status.");
process.exit(0);
}

main().catch((err) => { console.error("gate-run bundle:", err); process.exit(1); });
`;

async function main() {
  const esbuild = require("esbuild");
  await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: API_SERVER, sourcefile: "gate-run-entry.ts", loader: "ts" },
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
      // Logger stack: pino's transport resolves its worker relative to the
      // module's OWN __dirname, which our banner overrides — so keep these
      // REAL (require() from api-server/node_modules) instead of bundled.
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
    // NODE_ENV=production keeps pino from constructing a pino-pretty worker
    // transport (lib/worker.js) — the same branch the real server takes.
    // probeServiceBoot sub-processes inherit it, so load-testing apps run in
    // their production mode, which is the honest thing to load-test anyway.
    NODE_ENV: "production",
    GATE_RUN_OUT: opts.out,
    GATE_RUN_APPS: opts.apps.join(","),
  };
  const run = spawnSync(process.execPath, [BUNDLE_FILE], { env, stdio: "inherit", cwd: ROOT, timeout: 600_000 });
  process.exit(run.status ?? 1);
}

main().catch((err) => {
  console.error("gate-run failed:", err);
  process.exit(1);
});