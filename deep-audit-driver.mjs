#!/usr/bin/env node
/**
 * Deep Audit Driver — drives the real Build Studio path end-to-end
 * with a real free-tier model, instrumented to capture every decision point.
 *
 * Runs the 8-run matrix from the deep audit plan:
 * 1-3: ask→plan→execute-plan→iterate (auto) with scenarios A/B/C
 * 4: /build/orchestrate (manual) with scenario A
 * 5: /build/preview/agent (manual) with scenario A UI
 * 6: /build/scaffold with scenario B
 * 7: Concurrency - 3x scenario A
 * 8: Checkpoint resume - kill at iter 5, resume
 *
 * Route shapes verified against artifacts/api-server/src/routes/infinity/build.ts
 * + build-studio.tsx (the real client):
 *   /build/iterate      reads workspaceId, projectId, prompt, previewOutput,
 *                       previewPort, maxIterations(<=30), skipPreflight
 *                       -> returns { ok, summary, iterations, toolCalls, toolResults }
 *   /build/preview/start  requires { workspaceId, sessionId, command, port }
 *                       -> 400 without command+port
 *   /build/preview/status GET ?workspaceId&sessionId -> { running, output }
 *   /build/screenshot    { workspaceId, sessionId, port, viewports }
 *   /build/preview/agent { sessionId, workspaceId, goal, port, maxSteps }
 *                       -> 400 unless a preview is already running on that port
 *   /build/orchestrate  { projectId, goal, maxIterations }
 *   /build/scaffold     { projectId, prompt, answers, maxIterations }
 *
 * EVERY iterate call is a real runAutonomousAgent on the real free-tier
 * model. skipPreflight=true throughout: Pass 3 already documented the
 * preflight wall, and a dedicated probe at matrix start records it live.
 * The preview command mirrors the client default (python3 http.server) so a
 * Node/API scenario's preview channel stays dead on arrival — that dead
 * channel IS a finding ("deps are never installed, so the feedback the agent
 * iterates on is the static directory server, not the app you asked for").
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = "http://127.0.0.1:8080";

const COOKIE_JAR = "/tmp/deep-audit-cookies.txt";

// /build/* routes mount requireAuth (session cookie) AND requireScope from
// middlewares/api-key-auth (x-api-key). Both are mandatory for every call.
const API_KEY = "deep-audit-cli-key-987654321";

const PREVIEW_PORT = 4173;
const ITERATE_MAX = 5; // per iterate call; route clamps 1..30
const ITERATE_CAP = 8; // outer auto-loop calls per pipeline (matrix value)

// Each pipeline gets its own preview port so python http.server instances
// never collide (same-host binds) — including under run-7 concurrency.
let nextPort = 4201;
const projectPorts = {};

const SCENARIOS = {
  A: {
    name: "Dashboard with charts + sidebar + login",
    prompt: "Build a dashboard web app that shows analytics with charts and a sidebar navigation, with a login screen.",
    answers: { appType: "Dashboard", uiStyle: "Clean and minimal", aiProvider: "No AI needed", scope: "Multi-page feel" },
    expectedFiles: ["index.html", "app.js", "dashboard.css", "charts.js", "auth.js", "sidebar.js"],
  },
  B: {
    name: "Multi-page app + API + DB",
    prompt: "Build a multi-page web application with a REST API backend, PostgreSQL database with Drizzle ORM, user authentication, and a posts CRUD feature.",
    answers: { appType: "Tool", uiStyle: "Clean and minimal", aiProvider: "No AI needed", scope: "Multi-page feel" },
    expectedFiles: ["package.json", "drizzle.config.ts", "schema.ts", "api/routes.ts", "auth.ts", "posts.ts"],
  },
  C: {
    name: "Component library + Storybook",
    prompt: "Build a React component library with Button, Card, Input, Modal components, Storybook stories, and a demo page.",
    answers: { appType: "Portfolio", uiStyle: "Clean and minimal", aiProvider: "No AI needed", scope: "Multi-page feel" },
    expectedFiles: ["Button.tsx", "Card.tsx", "Input.tsx", "Modal.tsx", "stories.ts", "demo.tsx"],
  },
  D: {
    name: "Full-stack auth + real DB ops",
    prompt: "Build a full-stack application with user registration, login, JWT authentication, protected routes, and a user profile page with avatar upload.",
    answers: { appType: "Dashboard", uiStyle: "Clean and minimal", aiProvider: "No AI needed", scope: "Multi-page feel" },
    expectedFiles: ["auth/register.ts", "auth/login.ts", "auth/jwt.ts", "profile.ts", "upload.ts", "dashboard.tsx"],
  },
};

const FREE_MODELS = [
  "nex-agi/nex-n2.5-pro:free",
  "google/gemma-2-9b-it:free",
  "meta-llama/llama-3.1-8b-instruct:free",
  "microsoft/phi-3-mini-128k-instruct:free",
];

const currentModel = FREE_MODELS[0];

// Logging
const logDir = resolve(__dirname, "deep-audit-logs");
mkdirSync(logDir, { recursive: true });

const runLog = createWriteStream(resolve(logDir, `run-${Date.now()}.jsonl`), { flags: "a" });
const summaryLog = createWriteStream(resolve(logDir, `summary-${Date.now()}.json`), { flags: "w" });

function logEvent(event) {
  runLog.write(JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + "\n");
}

function logSummary(summary) {
  summaryLog.write(JSON.stringify(summary, null, 2));
  summaryLog.end();
}

// HTTP helpers
async function http(method, path, body, headers = {}) {
  const url = `${BASE_URL}${path}`;
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      "Cookie": await readCookie(),
      "x-api-key": API_KEY,
      ...headers,
    },
  };
  if (body && method !== "GET") {
    opts.body = JSON.stringify(body);
  }
  const start = Date.now();
  const res = await fetch(url, opts);
  const duration = Date.now() - start;
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, duration, headers: Object.fromEntries(res.headers.entries()) };
}

function readCookie() {
  try {
    return readFileSync(COOKIE_JAR, "utf-8").trim();
  } catch {
    return "";
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Build flow steps
async function runAsk(scenario) {
  logEvent({ type: "ask_start", scenario: scenario.name });
  const res = await http("POST", "/api/infinity/build/ask", { prompt: scenario.prompt });
  logEvent({ type: "ask_end", status: res.status, duration: res.duration });
  return res.data;
}

async function runPlan(scenario, projectId) {
  logEvent({ type: "plan_start", scenario: scenario.name, projectId });
  const res = await http("POST", "/api/infinity/build/plan", {
    prompt: scenario.prompt,
    answers: scenario.answers,
    projectId,
  });
  const fallback = !res.data?.steps?.length;
  logEvent({ type: "plan_end", status: res.status, duration: res.duration, fallback, stepCount: res.data?.steps?.length ?? 0, fileCount: res.data?.files?.length ?? 0 });
  return res.data;
}

async function runExecutePlan(plan, projectId, prompt, skipPreflight = true) {
  logEvent({ type: "execute_plan_start", projectId });
  // Replicate build-studio's exact transformation: /plan returns treated steps,
  // but /execute-plan needs {id, description, dependsOn, parallel}.
  const steps = (plan?.steps ?? []).map((s, i) =>
    typeof s === "string"
      ? { id: `step-${i + 1}`, description: s, dependsOn: [], parallel: false }
      : { id: s.id, description: s.description ?? s.title, dependsOn: [], parallel: false },
  );
  const res = await http("POST", "/api/infinity/build/execute-plan", {
    projectId,
    workspaceId: projectId,
    prompt: prompt || "a simple app",
    answers: {},
    plan: { title: plan.title, summary: plan.summary, steps, files: plan.files ?? [], risks: plan.risks ?? [] },
    skipPreflight,
  });
  const ok = res.status === 200 && !res.data?.error;
  logEvent({ type: "execute_plan_end", status: res.status, duration: res.duration, ok, summary: res.data?.summary?.slice(0, 200), detail: res.data?.detail?.slice(0, 500) });
  return res.data;
}

async function runIterate(projectId, workspaceId, goal, iteration, maxIterations = ITERATE_MAX) {
  const port = projectPorts[projectId] ?? PREVIEW_PORT;
  logEvent({ type: "iterate_start", projectId, iteration, maxIterations, port });
  const res = await http("POST", "/api/infinity/build/iterate", {
    projectId,
    workspaceId,
    prompt: goal,
    previewOutput: lastPreviewOutput[projectId] ?? "",
    previewPort: port,
    maxIterations,
    skipPreflight: true,
  });
  const data = res.data ?? {};
  logEvent({
    type: "iterate_end", status: res.status, duration: res.duration, iteration,
    ok: data.ok, toolCalls: data.toolCalls, agentIterations: data.iterations,
    summary: (data.summary ?? "").slice(0, 200),
    error: data.error || res.data?.detail?.slice?.(0, 300),
  });
  return res.data;
}

async function runScaffold(scenario, projectId) {
  logEvent({ type: "scaffold_start", projectId });
  const res = await http("POST", "/api/infinity/build/scaffold", {
    projectId,
    prompt: scenario.prompt,
    answers: scenario.answers,
    maxIterations: 30,
  });
  logEvent({ type: "scaffold_end", status: res.status, duration: res.duration, fileCount: Object.keys(res.data?.files ?? {}).length, previewCommand: res.data?.previewCommand });
  return res.data;
}

async function runOrchestrate(projectId, scenario) {
  logEvent({ type: "orchestrate_start", projectId });
  const res = await http("POST", "/api/infinity/build/orchestrate", {
    projectId,
    goal: scenario.prompt,
    maxIterations: 30,
  });
  logEvent({ type: "orchestrate_end", status: res.status, duration: res.duration, summary: (res.data?.summary ?? "").slice(0, 300), error: res.data?.error ?? res.data?.step?.error?.slice?.(0, 300) });
  return res.data;
}

// Preview instrumentation (the direct-hold channel)
async function runPreviewStart(projectId, workspaceId, command, port) {
  const p = port ?? projectPorts[projectId] ?? PREVIEW_PORT;
  logEvent({ type: "preview_start_attempt", projectId, command, port: p });
  const res = await http("POST", "/api/infinity/build/preview/start", {
    workspaceId,
    sessionId: "deep-audit",
    command,
    port: p,
  });
  logEvent({ type: "preview_start", status: res.status, duration: res.duration, running: res.data?.running, error: res.data?.error });
  return res.data;
}

async function runPreviewStatus(projectId, workspaceId) {
  const res = await http("GET", `/api/infinity/build/preview/status?workspaceId=${encodeURIComponent(workspaceId)}&sessionId=deep-audit`);
  const output = (res.data?.output ?? "").slice(-2000);
  logEvent({ type: "preview_status", status: res.status, running: res.data?.running, outputLen: output.length, outputHeader: output.slice(0, 120) });
  return { running: res.data?.running, output };
}

async function runScreenshot(projectId, workspaceId, port) {
  const p = port ?? projectPorts[projectId] ?? PREVIEW_PORT;
  try {
    const res = await http("POST", "/api/infinity/build/screenshot", {
      workspaceId,
      sessionId: "deep-audit",
      port: p,
      viewports: ["desktop"],
    });
    logEvent({ type: "screenshot", status: res.status, ok: res.data?.ok, error: res.data?.error });
    return { ok: res.data?.ok, dataUrlLen: res.data?.dataUrl?.length ?? 0 };
  } catch (e) {
    logEvent({ type: "screenshot", status: -1, error: String(e) });
    return { ok: false, error: String(e) };
  }
}

async function runPreviewAgent(projectId, workspaceId, goal, port) {
  const p = port ?? projectPorts[projectId] ?? PREVIEW_PORT;
  logEvent({ type: "preview_agent_start", projectId, port: p });
  const res = await http("POST", "/api/infinity/build/preview/agent", {
    sessionId: "deep-audit",
    workspaceId,
    goal,
    port: p,
    maxSteps: 6,
  });
  const events = res.data?.events ?? [];
  logEvent({ type: "preview_agent_end", status: res.status, duration: res.duration, eventCount: events.length, lastEvent: events.slice(-1)[0], error: res.data?.error, summary: (res.data?.summary ?? "").slice(0, 300) });
  return res.data;
}

async function runCheckpointProbe(projectId, plan) {
  // Preflight wall probe: one execute-plan WITHOUT skipPreflight on an unknown
  // projectId. Documents whether preflightCheck blocks non-project workspaces.
  logEvent({ type: "preflight_probe_start", projectId });
  const res = await http("POST", "/api/infinity/build/execute-plan", {
    projectId,
    workspaceId: projectId,
    prompt: "preflight probe",
    answers: {},
    plan: { title: plan?.title ?? "probe", summary: "probe", steps: [{ id: "step-1", description: "probe", dependsOn: [], parallel: false }], files: [], risks: [] },
    skipPreflight: false,
  });
  logEvent({ type: "preflight_probe_end", status: res.status, duration: res.duration, body: res.data?.error ?? res.data?.detail?.slice?.(0, 300) ?? "ok" });
  return { status: res.status };
}

/**
 * runAutoPipeline — the client's real flow:
 * ask → plan → execute-plan → start preview → iterate loop reading
 * preview/status output each turn (the model's only "shadows").
 */
const lastPreviewOutput = {};

async function runAutoPipeline(scenarioKey, runId) {
  const scenario = SCENARIOS[scenarioKey];
  // projects.id is a uuid column; buildProjectContextForBuild (used by
  // iterate/execute-plan) queries it directly, so non-UUID ids 500.
  const projectId = randomUUID();

  logEvent({ type: "pipeline_start", scenario: scenario.name, projectId, model: currentModel });

  const askResult = await runAsk(scenario);
  const plan = await runPlan(scenario, projectId);
  const executeResult = await runExecutePlan(plan, projectId, scenario.prompt);

  // The client's default preview command — for Node/API scenarios the static
  // server still boots (deps were never installed), which is the point.
  const port = nextPort++;
  projectPorts[projectId] = port;
  const command = `python3 -m http.server ${port}`;
  await runPreviewStart(projectId, projectId, command, port);
  lastPreviewOutput[projectId] = "";

  let iteration = 1;
  let done = false;
  let stall = false;

  while (!done && !stall && iteration <= ITERATE_CAP) {
    await sleep(1500);
    const status = await runPreviewStatus(projectId, projectId);
    lastPreviewOutput[projectId] = status.output;
    await runScreenshot(projectId, projectId, port);

    const iterateGoal = `${scenario.prompt}\n\nITERATE TASK: Improve the app based on preview output. Use available tools to explore the current state and make real file changes.\n\nPreview output:\n${status.output}`;
    const iterateResult = await runIterate(projectId, projectId, iterateGoal, iteration);

    const data = iterateResult ?? {};
    if (data.toolCalls === 0) { stall = true; logEvent({ type: "stall_detected", iteration, projectId }); }
    if (data.ok === true && iteration >= 1) done = true;
    iteration++;
  }

  logEvent({ type: "pipeline_end", projectId, iterations: iteration - 1, done, stall });
  return { projectId, scenario, plan, executeResult, iterations: iteration - 1, done, stall };
}

async function runConcurrency(scenarioKey, runId) {
  const scenario = SCENARIOS[scenarioKey];
  const promises = [];
  for (let i = 0; i < 3; i++) {
    promises.push(runSafely(`concurrent-${i}`, () => runAutoPipeline(scenarioKey, `${runId}-${i}`)));
  }
  const results = await Promise.allSettled(promises);
  logEvent({ type: "concurrency_end", scenario: scenario.name, results: results.map(r => r.status) });
  return results;
}

async function runCheckpointResume(scenarioKey, runId) {
  const scenario = SCENARIOS[scenarioKey];
  const projectId = randomUUID();

  logEvent({ type: "resume_phase1_start", projectId });
  await runAsk(scenario);
  const plan = await runPlan(scenario, projectId);
  await runExecutePlan(plan, projectId, scenario.prompt);

  const port = nextPort++;
  projectPorts[projectId] = port;
  const command = `python3 -m http.server ${port}`;
  await runPreviewStart(projectId, projectId, command, port);
  lastPreviewOutput[projectId] = "";

  let iteration = 1;
  while (iteration <= 5) {
    await sleep(1500);
    const status = await runPreviewStatus(projectId, projectId);
    lastPreviewOutput[projectId] = status.output;
    const iterateGoal = `${scenario.prompt}\n\nITERATE TASK: Improve the app based on preview output.\n\nPreview output:\n${status.output}`;
    await runIterate(projectId, projectId, iterateGoal, iteration);
    iteration++;
  }
  logEvent({ type: "resume_phase1_end", projectId, iterations: iteration - 1 });

  // Crash simulation: server is killed in a real run; here we read the durable
  // checkpoint from the DB to prove state survived the "crash".
  logEvent({ type: "server_kill_simulated", projectId });
  const checkpointRes = await http("GET", `/api/infinity/checkpoint/${projectId}`);
  const cp = checkpointRes.data?.checkpoint ?? {};
  logEvent({ type: "checkpoint_resume", status: checkpointRes.status, iteration: cp.iteration, completed: cp.completed, phase: cp.phase, hasWorkingContext: !!cp.workingContext });

  // Resume — continue 6-8
  while (iteration <= 8) {
    await sleep(1500);
    const status = await runPreviewStatus(projectId, projectId);
    lastPreviewOutput[projectId] = status.output;
    const iterateGoal = `${scenario.prompt}\n\nITERATE TASK: Improve the app based on preview output.\n\nPreview output:\n${status.output}`;
    await runIterate(projectId, projectId, iterateGoal, iteration);
    iteration++;
  }

  logEvent({ type: "resume_phase2_end", projectId, iterations: iteration - 1 });
  return { projectId, scenario, totalIterations: iteration - 1, checkpoint: checkpointRes.status };
}

// Resilience: one bad run never aborts the matrix.
async function runSafely(name, fn) {
  try {
    return { name, ok: true, result: await fn() };
  } catch (e) {
    logEvent({ type: "run_failed", name, error: String(e) });
    return { name, ok: false, error: String(e) };
  }
}

// Deep audit orchestration
async function runDeepAudit() {
  const runId = Date.now().toString(36);
  const results = {
    runId,
    startTime: new Date().toISOString(),
    model: currentModel,
    previewPort: PREVIEW_PORT,
    iterateMax: ITERATE_MAX,
    iterateCap: ITERATE_CAP,
    runs: {},
  };

  console.log(`\n=== DEEP AUDIT RUN ${runId} ===`);
  console.log(`Model: ${currentModel}`);
  console.log(`Base: ${BASE_URL}`);

  // Preflight wall probe (Pass-3 finding re-captured live)
  results.runs["0_preflight_probe"] = await runSafely("preflight-probe", () =>
    runCheckpointProbe(randomUUID(), { title: "probe", summary: "probe" }));

  // Run 1-3: Auto pipeline scenarios A, B, C
  for (const key of ["A", "B", "C"]) {
    console.log(`\n--- Run ${key}: ${SCENARIOS[key].name} ---`);
    results.runs[key] = await runSafely(key, () => runAutoPipeline(key, runId));
    await sleep(5000); // Cool down
  }

  // Run 4: Orchestrate (glass palace)
  console.log(`\n--- Run 4: Orchestrate (glass palace) ---`);
  results.runs["4_orchestrate"] = await runSafely("orchestrate", () =>
    runOrchestrate(randomUUID(), SCENARIOS.A));
  await sleep(3000);

  // Run 5: Preview agent (direct hold) — needs a live preview first
  console.log(`\n--- Run 5: Preview Agent (direct hold) ---`);
  results.runs["5_preview_agent"] = await runSafely("preview-agent", async () => {
    const pid = randomUUID();
    const p5 = nextPort++;
    projectPorts[pid] = p5;
    await runExecutePlan({ title: "probe", summary: "probe", steps: [{ id: "step-1", description: "create an index.html", dependsOn: [], parallel: false }], files: ["index.html"], risks: [] }, pid, SCENARIOS.A.prompt);
    await runPreviewStart(pid, pid, `python3 -m http.server ${p5}`, p5);
    await sleep(1500);
    return runPreviewAgent(pid, pid, SCENARIOS.A.prompt, p5);
  });

  // Run 6: Scaffold path
  console.log(`\n--- Run 6: Scaffold Path ---`);
  results.runs["6_scaffold"] = await runSafely("scaffold", () =>
    runScaffold(SCENARIOS.B, randomUUID()));
  await sleep(3000);

  // Run 7: Concurrency
  console.log(`\n--- Run 7: Concurrency (3x A) ---`);
  results.runs["7_concurrency"] = await runSafely("concurrency", () =>
    runConcurrency("A", runId));
  await sleep(3000);

  // Run 8: Checkpoint resume
  console.log(`\n--- Run 8: Checkpoint Resume ---`);
  results.runs["8_resume"] = await runSafely("resume", () =>
    runCheckpointResume("A", runId));

  results.endTime = new Date().toISOString();
  logSummary(results);

  console.log(`\n=== DEEP AUDIT COMPLETE ===`);
  console.log(`Results saved to ${logDir}/`);

  return results;
}

// Run
runDeepAudit().then(r => {
  console.log("MATRIX STATUS:", Object.fromEntries(Object.entries(r.runs).map(([k, v]) => [k, v.ok ? "OK" : `FAIL:${String(v.error).slice(0, 80)}`])));
}).catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});