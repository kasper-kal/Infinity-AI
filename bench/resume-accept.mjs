#!/usr/bin/env node
/**
 * bench/resume-accept.mjs — FIX-plan Phase 1 acceptance: prove the done
 * CONTRACT SURVIVES a server restart.
 *
 * The model-driven build path cannot run in this env (no reachable LLM key —
 * the documented constraint that deferred I.8/I.9). So this harness proves the
 * PERSISTENCE plumbing with real pieces and no fabrication:
 *
 *   1. Runs the REAL runDoneContract (the exact function build.ts calls at the
 *      completion moment) against a real benchmark app's built output — real
 *      gateResults, real summary, real doneSignal.
 *   2. Writes the checkpoint with the EXACT workingContext shape build.ts's
 *      completion saveCheckpoint writes (prompt, workspaceId, lastDecision,
 *      gates, doneContract{success,summary,gateResults,doneSignal}) — via the
 *      REAL saveCheckpoint into the REAL Postgres (DATABASE_URL).
 *   3. Emits the exact resume replay lines buildResumeContext produces
 *      ("Done contract at last checkpoint: …" + "Done-gate history:").
 *   4. Reads it back via the REAL getLatestCheckpoint.
 *
 * The live-server half (boot → kill → restart → GET /build/resume/:projectId)
 * then reads THIS row back through the real HTTP route — proving the contract
 * history is durable across a hard server kill.
 *
 * Usage:
 *   DATABASE_URL=postgresql://… node bench/resume-accept.mjs [--app saas-landing]
 *
 * Exit code: 0 when the contract write+read round-trips (durable); 1 otherwise.
 */
import { createRequire } from "node:module";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const API_SERVER = join(ROOT, "artifacts", "api-server");
const BUNDLE_FILE = join(API_SERVER, ".resume-accept-bundle.mjs");
const require = createRequire(join(API_SERVER, "package.json"));

const app = process.argv.includes("--app") ? process.argv[process.argv.indexOf("--app") + 1] : "saas-landing";
const projectId = "bench-resume-accept";
const projectPath = join(ROOT, "bench", "out", app);

const ENTRY = `
import {
  runDoneContract,
} from "${resolve(API_SERVER, "src/lib/build-done-contract.ts").replace(/\\/g, "/")}";
import {
  saveCheckpoint,
  getLatestCheckpoint,
} from "${resolve(API_SERVER, "src/lib/build-checkpoints.ts").replace(/\\/g, "/")}";
import * as path from "node:path";

async function main() {
const PROJECT_ID = "${projectId}";
const PROJECT_PATH = "${projectPath}";
const APP = "${app}";

// 1. REAL done contract on the REAL benchmark output (same call build.ts makes).
const result = await runDoneContract(
  PROJECT_ID,
  PROJECT_ID + ":0",
  "general",
  PROJECT_PATH,
  { id: PROJECT_ID + ":0", goal: "bench resume acceptance", acceptanceCriteria: [], steps: [] },
  PROJECT_ID,
);
const gateResults = result.gateResults;

// 2. Persist with the EXACT workingContext shape of build.ts's completion
//    saveCheckpoint (routes/infinity/build.ts ~:1666) — including the doneContract.
const workingContext = {
  prompt: "bench resume acceptance",
  workspaceId: PROJECT_ID,
  lastDecision: "acceptance driver — done contract persisted",
  gates: gateResults,
  doneContract: {
    success: result.success,
    summary: result.summary,
    gateResults,
    doneSignal: { status: result.doneSignal.status, message: result.doneSignal.message },
  },
};
const checkpointId = await saveCheckpoint({
  projectId: PROJECT_ID,
  iteration: 1,
  completed: 0,        // a build that reached done-contract but died before finalizing
  phase: "done-contract",
  plan: { title: "Bench resume acceptance", summary: "persistence acceptance", steps: [], files: [], risks: [], status: "failed" },
  completedSteps: [],
  workingContext,
  tokenUsage: { prompt: 0, completion: 0, total: 0 },
});

// 3. Read it back through the REAL reader and emit the SAME replay lines
//    buildResumeContext emits (routes/infinity/build.ts ~:287-296).
const ck = await getLatestCheckpoint(PROJECT_ID);
const dc = (ck.workingContext ?? {}).doneContract;
if (!dc) { console.error("RESUME_ACCEPT_FAIL — doneContract missing after write+read"); process.exit(1); }
console.log("checkpointId:", checkpointId);
console.log("doneContract at last checkpoint: " + (dc.success ? "PASSED" : "FAILED") +
  " — " + (dc.summary?.passed ?? 0) + "/" + (dc.summary?.totalGates ?? 0) +
  " gates passed, " + (dc.summary?.failed ?? 0) + " failed, " + (dc.summary?.notEnforced ?? 0) + " not enforced");
console.log("Done-gate history:");
for (const g of dc.gateResults ?? []) {
  console.log("  - " + g.gate + ": " + g.status + (g.details ? " — " + g.details : ""));
}
console.log("gates field in workingContext:", (ck.workingContext.gates ?? []).length, "rows");
console.log("RESUME_ACCEPT_OK");
process.exit(0);
}

main().catch((err) => { console.error("resume-accept bundle:", err); process.exit(1); });
`;

async function main() {
  const esbuild = require("esbuild");
  await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: API_SERVER, sourcefile: "resume-accept-entry.ts", loader: "ts" },
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
  };
  const run = spawnSync(process.execPath, [BUNDLE_FILE], { env, stdio: "inherit", cwd: ROOT, timeout: 600_000 });
  process.exit(run.status ?? 1);
}

main().catch((err) => {
  console.error("resume-accept failed:", err);
  process.exit(1);
});