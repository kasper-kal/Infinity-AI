#!/usr/bin/env node
/**
 * bench/driver.mjs — "The Good Gate" — the 5-app output benchmark driver.
 *
 * Two execution modes, same acceptance criteria (specs/5-apps.md):
 *
 *   NODE_ENV default / `local`   — aggregate + report mode. Reads each app's
 *                                  `verify.json` (written by verify.mjs),
 *                                  reconciles the per-app lifecycle in
 *                                  `state.json`, and renders `REPORT.md`. The
 *                                  actual build+verify loop is executed by the
 *                                  local vision agent (Claude Code) per app.
 *                                  Zero API key required.
 *
 *   `--api`                      — drive the real Build Studio API on a keyed
 *                                  host: register → login → build/start →
 *                                  build/scaffold → build/execute-plan →
 *                                  build/iterate → agent done+contract →
 *                                  download workspace → verify.mjs. Needs
 *                                  BASE_URL on a host with a reachable model.
 *
 * Multi-agent / parallel-safe: every app owns an independent lifecycle
 * {pending → building → verifying → pass|fail} in state.json. Up to
 * `--parallel N` apps may be in flight; the report reconciles whatever landed.
 *
 * Cross-host / remote / local: --base-url / --api-key / --prefix keep the
 * same driver portable across deployments.
 *
 * Usage:
 *   node bench/driver.mjs local                     # reconcile + report
 *   node bench/driver.mjs local --prefix out/x      # use a different output root
 *   node bench/driver.mjs --api --app todo-persist  # live API build for one app
 */
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname);
const OUT_DEFAULT = join(ROOT, "out");
const STATE_FILE = join(ROOT, "state.json");
const REPORT_FILE = join(ROOT, "REPORT.md");

export const APPS = [
  {
    slug: "saas-landing", name: "SaaS Landing Page", build: true,
    prompt: "Build a polished SaaS marketing landing page: hero with headline + CTA, features grid, pricing tiers, testimonials, FAQ, and footer. In-page anchor nav that scrolls smoothly. Fully responsive with no horizontal scroll at 320-1440px. Bundle with esbuild (npm run build).",
    answers: { style: "modern", appType: "marketing landing", size: "single page" },
  },
  {
    slug: "todo-persist", name: "Todo App w/ Persistence", build: false,
    prompt: "Build a todo app with localStorage persistence: add, complete, delete, and filter (all / active / completed). Empty-state message when there are no todos. A live item counter. Persist across reload. No console errors.",
    answers: { style: "clean", appType: "todo manager", size: "small app" },
  },
  {
    slug: "dashboard", name: "Dashboard", build: false,
    prompt: "Build an analytics dashboard: a data table with real fetch-style loading and empty states, an SVG chart rendered from the same real data, working filters (by category and search), and responsive layout (320-1440px no horizontal scroll).",
    answers: { style: "modern", appType: "analytics dashboard", size: "medium app" },
  },
  {
    slug: "chat-widget", name: "Chat Widget", build: false,
    prompt: "Build a chat widget: messages append both ways (user + simulated reply), scroll stays pinned to the newest message, send button disabled while the input is empty, and a visible error state (with retry) when a send fails.",
    answers: { style: "modern", appType: "chat widget", size: "small app" },
  },
  {
    slug: "markdown-editor", name: "Markdown Editor", build: true,
    prompt: "Build a markdown editor: textarea source on the left, live preview on the right that renders the exact source (headings, bold, italic, code, lists, links). A source/preview/split toggle. An unsaved-changes hint when edits are pending. Bundle with esbuild (npm run build).",
    answers: { style: "clean", appType: "markdown editor", size: "small app" },
  },
];

const ACCEPTANCE = {
  "saas-landing": "Marketing sections render · responsive · nav links work · `npm run build` green · no dead links · no [object Object]",
  "todo-persist": "Add/complete/delete/filter work · state survives reload · empty-state · no console errors",
  dashboard: "Data table + chart render real data · loading + empty states · filters work · responsive",
  "chat-widget": "Messages append both ways · scroll pinned to newest · send disabled on empty · error state",
  "markdown-editor": "Live preview matches source · toggle works · unsaved-changes hint · `npm run build` green",
};

async function loadState() {
  try { return JSON.parse(await fs.readFile(STATE_FILE, "utf-8")); }
  catch { return { schema: 1, lastRun: null, apps: {} }; }
}

async function saveState(state) {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

const slugOk = (s) => APPS.some((a) => a.slug === s);

function parseArgs(argv) {
  const a = { mode: "local", parallel: 1 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--api") a.mode = "api";
    else if (arg === "--app") a.app = argv[++i];
    else if (arg === "--prefix") a.prefix = argv[++i];
    else if (arg === "--base-url") a.baseUrl = argv[++i];
    else if (arg === "--api-key") a.apiKey = argv[++i];
    else if (arg === "--email") a.email = argv[++i];
    else if (arg === "--password") a.password = argv[++i];
    else if (arg === "--parallel") a.parallel = Math.max(1, Number(argv[++i]) || 1);
    else if (arg === "--dry-run") a.dryRun = true;
    else a.mode = arg;
  }
  if (a.app && !slugOk(a.app)) {
    console.error(`unknown app '${a.app}' — valid: ${APPS.map((x) => x.slug).join(", ")}`);
    process.exit(2);
  }
  if (a.mode === "local" && (a.baseUrl || a.apiKey)) a.mode = "api"; // api flags imply api mode
  a.outDir = a.prefix ? resolve(ROOT, a.prefix) : OUT_DEFAULT;
  return a;
}

/* ------------------------------------------------------------------ */
/* LOCAL MODE — reconcile per-app verify.json → state.json + REPORT.md */
/* ------------------------------------------------------------------ */
async function runLocal(a) {
  const state = await loadState();
  state.lastRun = new Date().toISOString();
  state.apps = state.apps ?? {};

  const rows = [];
  for (const app of APPS) {
    if (a.app && a.app !== app.slug) continue;
    const dir = join(a.outDir, app.slug);
    const entry = state.apps[app.slug] = state.apps[app.slug] ?? { slug: app.slug, status: "pending", checks: 0, pass: 0, fail: 0, checkedAt: null, detail: "not built yet" };

    const vj = join(dir, "verify.json");
    const shot = join(dir, "screenshot.png");
    if (!existsSync(vj)) {
      rows.push({ ...app, status: "pending", pass: 0, fail: 0, detail: "no verify.json — app not built/verified" });
      entry.status = "pending";
      continue;
    }
    let v;
    try { v = JSON.parse(await fs.readFile(vj, "utf-8")); } catch { v = null; }
    const hasShot = existsSync(shot);
    entry.checkedAt = v?.checkedAt ?? null;
    entry.pass = v?.passCount ?? 0;
    entry.fail = v?.failCount ?? 0;
    entry.checks = v?.checks?.length ?? 0;
    entry.detail = v ? (v.allPass ? `all ${entry.checks} checks passed` : `${entry.fail} failing`) : "corrupt verify.json";
    entry.screenshot = hasShot ? "screenshot.png" : null;
    entry.status = v?.allPass ? "pass" : "fail";
    if (app.build && !existsSync(join(dir, "dist", "bundle.js"))) {
      entry.status = "fail";
      entry.detail = (entry.detail ?? "") + " · dist/bundle.js missing (build green required)";
    }
    rows.push({
      ...app,
      status: entry.status,
      pass: entry.pass,
      fail: entry.fail,
      detail: entry.detail,
      screenshot: hasShot ? "✓" : "✗",
    });
  }

  await saveState(state);

  // ---- render REPORT.md
  const passed = rows.filter((r) => r.status === "pass").length;
  const lines = [];
  lines.push("# The \"Good\" Gate — 5-App Output Benchmark Report");
  lines.push("");
  lines.push(`- **Run:** ${new Date().toISOString()}`);
  lines.push(`- **Mode:** local-agent (vision agent builds each app, verify.mjs judges) ${a.prefix ? `· output root: \`${a.prefix}\`` : ""}`);
  lines.push(`- **Verdict:** ${passed === APPS.length ? "**PASS — all 5 apps meet all criteria (no human-coded fixes)**" : `**PARTIAL** — ${passed}/${APPS.length} apps met their criteria`}`);
  lines.push("");
  lines.push("| App | Status | Checks | Screenshot | Notes |");
  lines.push("|-----|--------|--------|-----------|-------|");
  for (const r of rows) {
    lines.push(`| ${r.name} (\`${r.slug}\`) | ${r.status === "pass" ? "✅" : r.status === "pending" ? "⏳" : "❌"} ${r.status} | ${r.pass}/${r.pass + r.fail} | ${r.screenshot ?? "—"} | ${r.detail ?? ""} |`);
  }
  lines.push("");
  lines.push("## Acceptance criteria");
  lines.push("");
  for (const app of APPS) {
    lines.push(`- **${app.name}** — ${ACCEPTANCE[app.slug]}`);
  }
  lines.push("");
  lines.push("_Generated by `driver.mjs local`. A ❌ means verify.mjs observed the criterion disagreeing with reality._");
  await fs.writeFile(REPORT_FILE, lines.join("\n") + "\n");

  // ---- stdout table
  console.log(`\n${"─".repeat(72)}`);
  console.log("THE GOOD GATE — 5-APP OUTPUT BENCHMARK");
  console.log(`${"─".repeat(72)}`);
  for (const r of rows) {
    const mark = r.status === "pass" ? "✅" : r.status === "pending" ? "⏳" : "❌";
    console.log(`  ${mark} ${r.name.padEnd(28)} ${r.pass}/${r.pass + r.fail} checks  ${(r.screenshot ?? "‑").padEnd(1)} ${r.detail ?? ""}`);
  }
  console.log(`${"─".repeat(72)}`);
  console.log(`Report: ${REPORT_FILE}`);
  process.exit(passed === APPS.length ? 0 : 1);
}

/* ------------------------------------------------------------- */
/* API MODE — drive the real Build API on a keyed host           */
/* ------------------------------------------------------------- */
function cookieJar() {
  let jar = "";
  return {
    get: () => jar,
    set: (setCookie) => { if (setCookie) jar = setCookie.map((c) => c.split(";")[0]).join("; "); },
  };
}

async function apiFetch(baseUrl, pathname, opts = {}, jar) {
  const res = await fetch(new URL(pathname, baseUrl), {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Cookie: jar.get(),
      ...(opts.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) jar.set(setCookie);
  let body = null;
  try { body = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body };
}

async function runApi(a) {
  const baseUrl = (a.baseUrl ?? process.env.BENCH_BASE_URL ?? process.env.BASE_URL ?? "").replace(/\/+$/, "");
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
    console.error("api mode needs --base-url (or BENCH_BASE_URL). Example: node bench/driver.mjs --api --base-url http://localhost:3000 --email a@b.c --password 'x'. The api-server must have a reachable model (free-tier ok).");
    process.exit(2);
  }
  const email = a.email ?? process.env.BENCH_EMAIL;
  const password = a.password ?? process.env.BENCH_PASSWORD;
  if (!email || !password) {
    console.error("api mode needs --email / --password (or BENCH_EMAIL / BENCH_PASSWORD) to authenticate with the Build API.");
    process.exit(2);
  }

  const jar = cookieJar();
  const apps = a.app ? APPS.filter((x) => x.slug === a.app) : APPS;
  const results = [];

  for (const app of apps) {
    console.log(`\n▶ [api] ${app.name} (${app.slug})`);
    try {
      // register (idempotent) → login
      let r = await apiFetch(baseUrl, "/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, displayName: "bench" }),
      }, jar);
      if (![200, 409].includes(r.status)) throw new Error(`register ${r.status}: ${JSON.stringify(r.body)}`);
      r = await apiFetch(baseUrl, "/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }, jar);
      if (r.status !== 200) throw new Error(`login ${r.status}: ${JSON.stringify(r.body)}`);

      const projectId = `${app.slug}-${Date.now().toString(36)}`;
      console.log(`   project ${projectId}`);
      if (a.dryRun) { results.push(`${app.slug}: DRY`); continue; }

      // build/start — isolated workspace
      r = await apiFetch(baseUrl, "/api/infinity/build/start", {
        method: "POST",
        body: JSON.stringify({ projectId, prompt: app.prompt }),
      }, jar);
      if (r.status !== 200) throw new Error(`start ${r.status}: ${JSON.stringify(r.body)}`);

      // build/scaffold — the corpus-first scaffold step
      r = await apiFetch(baseUrl, "/api/infinity/build/scaffold", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: projectId,
          projectId,
          prompt: app.prompt,
          answers: app.answers ?? {},
          maxIterations: 24,
          temperature: 0.2,
        }),
      }, jar);
      if (r.status !== 200) throw new Error(`scaffold ${r.status}: ${JSON.stringify(r.body)}`);

      // build/execute-plan — tool-based coder with the pinned corpus
      r = await apiFetch(baseUrl, "/api/infinity/build/execute-plan", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: projectId,
          projectId,
          prompt: app.prompt,
          answers: app.answers ?? {},
          maxIterations: 24,
          temperature: 0.2,
          verifyAfterSteps: true,
          failFast: true,
        }),
      }, jar);
      if (r.status !== 200) throw new Error(`execute-plan ${r.status}: ${JSON.stringify(r.body)}`);

      const out = r.body?.ok === true ? "ok" : (r.body?.ok === false ? `fail(${r.body?.reason ?? ""})` : `${r.status}:${JSON.stringify(r.body).slice(0, 140)}`);
      results.push(`${app.slug}: ${out}`);
      console.log(`   → ${out}`);
    } catch (e) {
      console.error(`   ✗ ${e.message}`);
    }
  }

  console.log(`\nAPI bench complete: ${results.join(", ")}`);
  console.log("Download the workspace + run `node bench/verify.mjs out/<slug>` to score each app against the criteria.");
}

/* ----------------------------- */
async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.mode === "api") await runApi(a);
  else await runLocal(a);
}

main().catch((e) => { console.error(e); process.exit(2); });