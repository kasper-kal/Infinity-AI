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
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createWriteStream } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = "http://127.0.0.1:8080";
const STUB_MODEL_URL = "http://127.0.0.1:3999/v1";

const COOKIE_JAR = "/tmp/deep-audit-cookies.txt";

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

let currentModel = FREE_MODELS[0];

// Logging
const logDir = resolve(__dirname, "deep-audit-logs");
import { mkdirSync } from "node:fs";
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

async function readCookie() {
  try {
    const { readFileSync } = await import("node:fs");
    return readFileSync(COOKIE_JAR, "utf-8").trim();
  } catch {
    return "";
  }
}

// Build flow steps
async function runAsk(scenario) {
  logEvent({ type: "ask_start", scenario: scenario.name });
  const res = await http("POST", "/api/infinity/build/ask", { prompt: scenario.prompt });
  logEvent({ type: "ask_end", ...res });
  return res.data;
}

async function runPlan(scenario, askResult) {
  logEvent({ type: "plan_start", scenario: scenario.name });
  const res = await http("POST", "/api/infinity/build/plan", {
    prompt: scenario.prompt,
    answers: scenario.answers,
    projectId: "deep-audit-" + Date.now(),
  });
  logEvent({ type: "plan_end", ...res });
  return res.data;
}

async function runExecutePlan(plan, projectId, skipPreflight = true) {
  logEvent({ type: "execute_plan_start", projectId });
  const res = await http("POST", "/api/infinity/build/execute-plan", {
    projectId,
    workspaceId: projectId,
    plan: plan,
    skipPreflight,
  });
  logEvent({ type: "execute_plan_end", ...res });
  return res.data;
}

async function runIterate(projectId, workspaceId, goal, iteration, maxIterations = 30) {
  logEvent({ type: "iterate_start", projectId, iteration });
  const res = await http("POST", "/api/infinity/build/iterate", {
    projectId,
    workspaceId,
    goal,
    maxIterations,
    iteration,
  });
  logEvent({ type: "iterate_end", ...res });
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
  logEvent({ type: "scaffold_end", ...res });
  return res.data;
}

async function runOrchestrate(projectId, scenario) {
  logEvent({ type: "orchestrate_start", projectId });
  const res = await http("POST", "/api/infinity/build/orchestrate", {
    projectId,
    goal: scenario.prompt,
    maxIterations: 30,
  });
  logEvent({ type: "orchestrate_end", ...res });
  return res.data;
}

async function runPreviewAgent(projectId, goal) {
  logEvent({ type: "preview_agent_start", projectId });
  const res = await http("POST", "/api/infinity/build/preview/agent", {
    projectId,
    goal,
  });
  logEvent({ type: "preview_agent_end", ...res });
  return res.data;
}

async function runPreviewStart(projectId, workspaceId) {
  const res = await http("POST", "/api/infinity/build/preview/start", {
    projectId,
    workspaceId,
  });
  logEvent({ type: "preview_start", ...res });
  return res.data;
}

async function runScreenshot(projectId, workspaceId) {
  const res = await http("POST", "/api/infinity/build/screenshot", {
    projectId,
    workspaceId,
  });
  logEvent({ type: "screenshot", ...res });
  return res.data;
}

// Main run functions
async function runAutoPipeline(scenarioKey, runId) {
  const scenario = SCENARIOS[scenarioKey];
  const projectId = `deep-audit-${scenarioKey.toLowerCase()}-${runId}`;

  logEvent({ type: "pipeline_start", scenario: scenario.name, projectId, model: currentModel });

  // Step 1: Ask
  const askResult = await runAsk(scenario);

  // Step 2: Plan
  const plan = await runPlan(scenario, askResult);

  // Step 3: Execute plan
  const executeResult = await runExecutePlan(plan, projectId);

  // Step 4: Auto-pipeline (iterate loop)
  let iteration = 1;
  let done = false;
  let lastPreviewOutput = "";

  while (!done && iteration <= 8) {
    // Get preview output
    const preview = await runPreviewStart(projectId, projectId);
    await new Promise(r => setTimeout(r, 2000));
    const screenshot = await runScreenshot(projectId, projectId);
    lastPreviewOutput = preview.data?.output || "";

    // Iterate
    const iterateGoal = `${scenario.prompt}\n\nITERATE TASK: Improve the app based on preview output.\n\nPreview output:\n${lastPreviewOutput}`;
    const iterateResult = await runIterate(projectId, projectId, iterateGoal, iteration, 30);

    done = iterateResult.data?.done || false;
    iteration++;

    if (iterateResult.data?.filesChanged?.length === 0 && iteration > 3) {
      logEvent({ type: "stall_detected", iteration, projectId });
      break;
    }
  }

  logEvent({ type: "pipeline_end", projectId, iterations: iteration - 1, done });
  return { projectId, scenario, plan, executeResult, iterations: iteration - 1, done };
}

async function runConcurrency(scenarioKey, runId) {
  const scenario = SCENARIOS[scenarioKey];
  const promises = [];

  for (let i = 0; i < 3; i++) {
    const projectId = `deep-audit-concurrent-${scenarioKey.toLowerCase()}-${runId}-${i}`;
    promises.push(runAutoPipeline(scenarioKey, `${runId}-${i}`));
  }

  const results = await Promise.allSettled(promises);
  logEvent({ type: "concurrency_end", scenario: scenario.name, results: results.map(r => r.status) });
  return results;
}

async function runCheckpointResume(scenarioKey, runId) {
  const scenario = SCENARIOS[scenarioKey];
  const projectId = `deep-audit-resume-${scenarioKey.toLowerCase()}-${runId}`;

  // Run first 5 iterations
  logEvent({ type: "resume_phase1_start", projectId });
  const askResult = await runAsk(scenario);
  const plan = await runPlan(scenario, askResult);
  const executeResult = await runExecutePlan(plan, projectId);

  let iteration = 1;
  let lastPreviewOutput = "";

  while (iteration <= 5) {
    const preview = await runPreviewStart(projectId, projectId);
    await new Promise(r => setTimeout(r, 2000));
    const screenshot = await runScreenshot(projectId, projectId);
    lastPreviewOutput = preview.data?.output || "";

    const iterateGoal = `${scenario.prompt}\n\nITERATE TASK: Improve the app based on preview output.\n\nPreview output:\n${lastPreviewOutput}`;
    const iterateResult = await runIterate(projectId, projectId, iterateGoal, iteration, 30);

    iteration++;
  }

  logEvent({ type: "resume_phase1_end", projectId, iterations: iteration - 1 });

  // Kill server (simulate crash)
  logEvent({ type: "server_kill_simulated", projectId });

  // Restart server would happen here - for now just continue with same server
  // In reality we'd restart the server process

  // Resume - check checkpoint
  const checkpointRes = await http("GET", `/api/infinity/build-checkpoints/${projectId}/latest`);
  logEvent({ type: "checkpoint_resume", ...checkpointRes });

  // Continue iterations 6-8
  while (iteration <= 8) {
    const preview = await runPreviewStart(projectId, projectId);
    await new Promise(r => setTimeout(r, 2000));
    const screenshot = await runScreenshot(projectId, projectId);
    lastPreviewOutput = preview.data?.output || "";

    const iterateGoal = `${scenario.prompt}\n\nITERATE TASK: Improve the app based on preview output.\n\nPreview output:\n${lastPreviewOutput}`;
    const iterateResult = await runIterate(projectId, projectId, iterateGoal, iteration, 30);

    iteration++;
  }

  logEvent({ type: "resume_phase2_end", projectId, iterations: iteration - 1 });
  return { projectId, scenario, totalIterations: iteration - 1 };
}

// Deep audit orchestration
async function runDeepAudit() {
  const runId = Date.now().toString(36);
  const results = {
    runId,
    startTime: new Date().toISOString(),
    model: currentModel,
    runs: {},
  };

  console.log(`\n=== DEEP AUDIT RUN ${runId} ===`);
  console.log(`Model: ${currentModel}`);
  console.log(`Scenarios: ${Object.keys(SCENARIOS).join(", ")}`);

  // Run 1-3: Auto pipeline scenarios A, B, C
  for (const key of ["A", "B", "C"]) {
    console.log(`\n--- Run ${key}: ${SCENARIOS[key].name} ---`);
    results.runs[key] = await runAutoPipeline(key, runId);
    await new Promise(r => setTimeout(r, 5000)); // Cool down
  }

  // Run 4: Orchestrate (glass palace)
  console.log(`\n--- Run 4: Orchestrate (glass palace) ---`);
  results.runs["4_orchestrate"] = await runOrchestrate(`deep-audit-orchestrate-${runId}`, SCENARIOS.A);

  // Run 5: Preview agent (direct hold)
  console.log(`\n--- Run 5: Preview Agent (direct hold) ---`);
  results.runs["5_preview_agent"] = await runPreviewAgent(`deep-audit-preview-${runId}`, SCENARIOS.A.prompt);

  // Run 6: Scaffold path
  console.log(`\n--- Run 6: Scaffold Path ---`);
  results.runs["6_scaffold"] = await runScaffold(SCENARIOS.B, `deep-audit-scaffold-${runId}`);

  // Run 7: Concurrency
  console.log(`\n--- Run 7: Concurrency (3x A) ---`);
  results.runs["7_concurrency"] = await runConcurrency("A", runId);

  // Run 8: Checkpoint resume
  console.log(`\n--- Run 8: Checkpoint Resume ---`);
  results.runs["8_resume"] = await runCheckpointResume("A", runId);

  results.endTime = new Date().toISOString();
  logSummary(results);

  console.log(`\n=== DEEP AUDIT COMPLETE ===`);
  console.log(`Results saved to ${logDir}/`);

  return results;
}

// Run
runDeepAudit().catch(console.error);