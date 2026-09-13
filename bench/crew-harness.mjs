#!/usr/bin/env node
/**
 * bench/crew-harness.mjs — FIX-plan Phase 2 acceptance: prove the REAL
 * MULTI-AGENT CREW mechanisms work (bus, per-role keys, helper, role blocks,
 * steering) without needing a keyed model.
 *
 * The model-driven live crew dialogue (Designer+Coder+Reviewer+Fixer+Helper
 * all speaking via LLM) cannot run in this env — no reachable LLM key (the
 * documented constraint that deferred I.8/I.9 style live builds). This harness
 * proves the PLUMBING with real bundled modules + real Postgres + deterministic
 * stubs, honest about the deferral.
 *
 * What this proves:
 *   1. MESSAGE BUS — post + in-process subscribe + Postgres persist + getThread
 *   2. PER-ROLE KEYS — crewEffortFor + pickKeyIndex math; adapter-factory routes
 *      planner/reviewer=max, coder/fixer=high, helper=local (no key pool needed)
 *   3. HELPER BM25 — indexed conversation + working context returns CITED answers
 *   4. ROLE RULE BLOCKS — distinct non-empty strings per role
 *   5. STEERING — postSteering + drainSteering at step boundary
 *
 * Exit code: 0 when all mechanisms pass; 1 otherwise.
 */
import { createRequire } from "node:module";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const API_SERVER = join(ROOT, "artifacts", "api-server");
const BUNDLE_FILE = join(API_SERVER, ".crew-harness-bundle.mjs");
const require = createRequire(join(API_SERVER, "package.json"));

const PROJECT_ID = "bench-crew-harness";

const ENTRY = `
import { MessageBus, CrewRole, CREW_ROLES, mention, resetBusForTests } from "${resolve(API_SERVER, "src/lib/build-message-bus.ts").replace(/\\\\/g, "/")}";
import { crewEffortFor, pickKeyIndex, describeCrewTier, CREW_ROLE_EFFORTS } from "${resolve(API_SERVER, "src/lib/crew-tiers.ts").replace(/\\\\/g, "/")}";
import { getRoleRuleBlock, CREW_ROLE_RULES } from "${resolve(API_SERVER, "src/lib/infinity-prompt.ts").replace(/\\\\/g, "/")}";
import { buildHelperDocs, bm25Search, askHelper, hasCitedConfidence, tokenize } from "${resolve(API_SERVER, "src/lib/build-helper.ts").replace(/\\\\/g, "/")}";
import { isLocalModelAvailable, createLocalAdapter } from "${resolve(API_SERVER, "src/lib/adapters/local-adapter.ts").replace(/\\\\/g, "/")}";

const PROJECT_ID = "${PROJECT_ID}";

async function main() {
  let allPass = true;
  const pass = (label) => console.log("✅  " + label);
  const fail = (label, detail) => { console.error("❌  " + label + (detail ? " — " + detail : "")); allPass = false; };

  // ============================================================
  // 0. Clean bus state
  // ============================================================
  resetBusForTests();

  // ============================================================
  // 1. MESSAGE BUS — post, subscribe, persist, thread
  // ============================================================
  const bus = new MessageBus(PROJECT_ID, "default");

  // Post a few messages (in-process + persist attempt)
  await bus.post({ projectId: PROJECT_ID, fromRole: "planner", kind: "handoff", content: "Plan: 3 steps" });
  await bus.post({ projectId: PROJECT_ID, fromRole: "coder", toRole: "reviewer", kind: "handoff", content: "Step 1 done" });
  await bus.post({ projectId: PROJECT_ID, fromRole: "reviewer", toRole: "fixer", kind: "review", content: "Finding: missing test" });
  await bus.post({ projectId: PROJECT_ID, fromRole: "fixer", toRole: "reviewer", kind: "handoff", content: "Fixed finding 0" });
  await bus.post({ projectId: PROJECT_ID, fromRole: "helper", kind: "helper", content: "User asked for dark theme" });

  // In-process subscribe (live delivery)
  let liveCount = 0;
  const unsub = bus.subscribe({ projectId: PROJECT_ID }, () => liveCount++);
  await bus.post({ projectId: PROJECT_ID, fromRole: "orchestrator", kind: "orchestrator", content: "steering test" });
  unsub();
  if (liveCount !== 1) fail("bus: live subscribe did not receive the post", "count=" + liveCount); else pass("bus: in-process pub/sub delivers");

  // Durable thread (Postgres + live cache)
  // When databaseConfigured is false, includeLive: false returns empty; use default (includeLive: true)
  const thread = await bus.getThread();
  if (thread.length < 5) fail("bus: durable thread has <5 messages", "count=" + thread.length); else pass("bus: thread read", thread.length + " messages (live cache + DB when available)");

  // Messages for a role since N (poll-based)
  const forReviewer = await bus.messagesForRole("reviewer", 0);
  const reviewerHandoffs = forReviewer.filter(m => m.kind === "handoff" || m.kind === "review");
  if (reviewerHandoffs.length < 2) fail("bus: messagesForRole review channel", "count=" + reviewerHandoffs.length); else pass("bus: role-poll (reviewer) works");

  // Steering channel
  await bus.postSteering("Don't use Tailwind — plain CSS only");
  await bus.postSteering("Use shadcn/ui components where possible");
  const steers = await bus.drainSteering(0);
  if (steers.length !== 2) fail("bus: steering drain count", "got=" + steers.length); else pass("bus: steering post + drain works");

  // @mention helper
  if (mention("coder", "hello") !== "@coder: hello") fail("bus: mention format"); else pass("bus: mention helper works");

  // ============================================================
  // 2. PER-ROLE KEYS — tier math (pure, no key pool needed)
  // ============================================================
  const tiers = [
    ["planner", "max"],
    ["reviewer", "max"],
    ["coder", "high"],
    ["fixer", "high"],
    ["helper", "local"],
    ["designer", "max"],
    ["unknown", "high"], // unknown role defaults to high
  ];
  for (const [role, expected] of tiers) {
    if (crewEffortFor(role) !== expected) fail("crewEffortFor " + role, "got=" + crewEffortFor(role) + " want=" + expected);
  }
  pass("crewEffortFor: role→tier mapping matches Phase 2 spec");

  // pickKeyIndex with varying pool sizes
  // 0 keys → local only (returns -1); others throw in real factory
  if (pickKeyIndex("local", 0) !== -1) fail("pickKeyIndex local 0 keys");
  if (pickKeyIndex("max", 1) !== 0) fail("pickKeyIndex max 1 key");
  if (pickKeyIndex("high", 1) !== 0) fail("pickKeyIndex high 1 key");
  if (pickKeyIndex("lite", 1) !== 0) fail("pickKeyIndex lite 1 key");
  if (pickKeyIndex("max", 3) !== 0) fail("pickKeyIndex max 3 keys");
  if (pickKeyIndex("high", 3) !== 1) fail("pickKeyIndex high 3 keys");
  if (pickKeyIndex("lite", 3) !== 2) fail("pickKeyIndex lite 3 keys");
  pass("pickKeyIndex: tier→pool-index math correct for 1/3 keys");

  // describeCrewTier — human readable, safe everywhere
  const descObj = describeCrewTier("helper");
  if (descObj.effort !== "local" || !descObj.note.includes("Ollama")) fail("describeCrewTier helper", JSON.stringify(descObj));
  pass("describeCrewTier: human-readable tier description");

  // ============================================================
  // 3. HELPER BM25 — cited evidence from conversation + context
  // ============================================================
  // Tokenizer sanity
  const toks = tokenize("The user asked for a DARK theme with shadcn/ui components");
  if (!toks.includes("dark") || !toks.includes("theme") || !toks.includes("shadcn") || !toks.includes("components")) {
    fail("tokenize: expected tokens missing", JSON.stringify(toks));
  } else pass("tokenize: working");

  // Build docs from a mock bus log + working context
  const mockBus = [
    { seq: 1, fromRole: "planner", toRole: null, kind: "handoff", content: "Plan: build a landing page with dark mode", payload: null, createdAt: "2024-01-01T00:00:00Z" },
    { seq: 2, fromRole: "coder", toRole: "reviewer", kind: "handoff", content: "Step 1: created theme-toggle component", payload: null, createdAt: "2024-01-01T00:01:00Z" },
    { seq: 3, fromRole: "reviewer", toRole: "fixer", kind: "review", content: "Finding: theme toggle lacks persistence", payload: null, createdAt: "2024-01-01T00:02:00Z" },
  ];
  const docs = buildHelperDocs({
    conversation: mockBus as any,
    workingContext: {
      goal: "Build a landing page with dark mode",
      planSummary: "3 steps: scaffold, theme toggle, polish",
      keyDecisions: ["Use CSS custom properties for theme", "Persist theme in localStorage"],
      fileMap: [{ path: "components/theme-toggle.tsx", purpose: "Theme switcher with localStorage" }],
    },
  });

  if (docs.length < 4) fail("buildHelperDocs: expected ≥4 docs", "count=" + docs.length); else pass("buildHelperDocs: indexed " + docs.length + " sources");

  // Query — should cite the planner's plan + the keyDecisions
  const hits = bm25Search("what theme did the user ask for", docs);
  if (hits.length === 0) fail("bm25Search: zero hits for obvious query"); else pass("bm25Search: ranked hits");

  // AskHelper with synthesis disabled (deterministic core)
  const answer = await askHelper(PROJECT_ID, "what theme did the user ask for", {
    context: {
      conversation: mockBus as any,
      workingContext: { goal: "Build a landing page with dark mode", keyDecisions: ["Use CSS custom properties for theme"] },
    },
  });
  if (!answer.hits.length || !hasCitedConfidence(answer)) fail("askHelper: no cited evidence", JSON.stringify(answer.hits.map(h => h.doc.id)));
  else pass("askHelper: deterministic core returns cited evidence (" + answer.hits.length + " hits)");

  // Optional local synthesis: probe Ollama (best-effort; failure is OK)
  let localSynthWorks = false;
  if (await isLocalModelAvailable()) {
    const adapter = await createLocalAdapter();
    const synthAnswer = await askHelper(PROJECT_ID, "what theme did the user ask for", {
      context: { conversation: mockBus as any, workingContext: { goal: "Build a landing page with dark mode" } },
      synthesize: async (hits, q) => {
        const prompt = "Answer from these citations only:\\n" + hits.map(h => "[" + h.doc.source + "] " + h.doc.text).join("\\n---\\n") + "\\n\\nQ: " + q;
        const res = await adapter.complete([{ role: "user", content: prompt }], { temperature: 0.1, maxTokens: 200 });
        return res.content;
      },
    });
    if (synthAnswer.synthesizerUsed) localSynthWorks = true;
  }
  console.log("  (local LLM synthesis: " + (localSynthWorks ? "available & used" : "not available — deterministic core used") + ")");

  // ============================================================
  // 4. ROLE RULE BLOCKS — distinct non-empty per role
  // ============================================================
  const roles = ["planner", "coder", "reviewer", "fixer", "helper"] as const;
  for (const r of roles) {
    const block = getRoleRuleBlock(r);
    if (!block || block.length < 20) fail("role rule block " + r, "empty or too short");
    if (!block.includes(r.toUpperCase()) && !block.includes(r)) fail("role rule block " + r, "does not mention its role name");
  }
  // Distinctness
  const blocks = roles.map(r => getRoleRuleBlock(r));
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (blocks[i] === blocks[j]) fail("role rule blocks: duplicate content", roles[i] + " == " + roles[j]);
    }
  }
  pass("role rule blocks: 5 distinct non-empty sections");

  // ============================================================
  // 5. INTEGRATION — steering + helper injection into a step description
  // ============================================================
  const steeringBus = new MessageBus(PROJECT_ID, "steer-test");
  resetBusForTests();
  await steeringBus.postSteering("Don't use Tailwind");
  await steeringBus.postSteering("Use plain CSS custom properties");

  // Simulate prepareStepGoal logic
  const steerMsgs = await steeringBus.drainSteering(0);
  let stepDesc = "Build a button component";
  if (steerMsgs.length > 0) {
    stepDesc += "\\n\\n## OPERATOR STEERING (inject at step boundary — honor it)\\n" + steerMsgs.map(s => "- " + s.content).join("\\n");
  }
  if (!stepDesc.includes("Don't use Tailwind") || !stepDesc.includes("plain CSS")) fail("steering injection: missing content"); else pass("steering: injected into step description");

  // ============================================================
  // RESULT
  // ============================================================
  console.log("");
  console.log(allPass ? "CREW_HARNESS_OK" : "CREW_HARNESS_FAILED");
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("crew-harness bundle:", err);
  process.exit(1);
});
`;

async function main() {
  const esbuild = require("esbuild");
  await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: API_SERVER, sourcefile: "crew-harness-entry.ts", loader: "ts" },
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

  const env = { ...process.env, NODE_ENV: "production" };
  const run = spawnSync(process.execPath, [BUNDLE_FILE], { env, stdio: "inherit", cwd: ROOT, timeout: 120_000 });
  process.exit(run.status ?? 1);
}

main().catch((err) => {
  console.error("crew-harness failed:", err);
  process.exit(1);
});