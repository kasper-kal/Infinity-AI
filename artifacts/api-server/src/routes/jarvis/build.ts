import { Router, Request, Response } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { desc, eq } from "drizzle-orm";
import { buildApps, db } from "@workspace/db";
import { logActivity } from "./project-activity";
import {
  ensureWorkspace,
  getSessionCwd,
  getWorkspaceCommandEnvironment,
  getWorkspaceRoot,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  WORKSPACE_ROOT,
  createIsolated,
  commitIteration,
  rollbackIteration,
  hasIsolated,
  isolatedPath,
  readWorkspaceFileText,
  safeWorkspacePath,
} from "../../lib/workspace";
import { saveCheckpoint, getLatestCheckpoint } from "../../lib/build-checkpoints";
import { getStorage, persistFile } from "../../lib/storage";
import { logBuildEvent } from "../../lib/build-telemetry";
import { jarvisConfig } from "../../config/jarvis";
import { pooledClient } from "../../lib/llm-client";
import type { Browser, Page } from "puppeteer";
import { verifyWorkspace, formatVerificationFeedback, generateUnifiedDiff, getParallelizableSteps, type PlanStep } from "../../lib/structured-tools";
import { fixerPromptV2 } from "../../lib/build-prompts";
import { coderPromptV2 } from "../../lib/build-prompts";
import {
  getWorkingContext,
  setProjectGoal,
  recordStep,
  recordDecision,
  recordErrorPattern,
  trackTokens,
  serializeContext,
  refreshFileMap,
} from "../../lib/build-context";
import { buildFullProjectContext } from "../../lib/project-context";
import {
  buildProjectContextForBuild,
  combineBuildMemory,
} from "../../lib/build-project-context";
import {
  getOrCreateBudget,
  updateBudget,
  recordBuildCost,
  checkBudgetBeforeBuild,
  getBudgetStatus,
  getCostHistory,
  getDailyAggregates,
  getBudgetDashboardStats,
  estimateCostCents,
  type BudgetLimits,
} from "../../lib/build-budgets";
import {
  createSnapshot,
  restoreSnapshot,
  listSnapshots,
  deleteSnapshot,
  snapshotAfterCheckpoint,
  type SnapshotMetadata,
} from "../../lib/workspace-snapshots";
import {
  getBrowserPool,
  BrowserPool,
  type PoolConfig,
  type BrowserSlot,
  type ScreenshotDiff,
  type AccessibilitySnapshot,
} from "../../lib/browser-pool";
import {
  preflightCheck,
  waitForDiskSpace,
  recordEdgeCase,
  resolveEdgeCase,
  getUnresolvedEdgeCases,
  withRetry,
  detectWorkspaceCorruption,
  repairWorkspace,
  handleGitConflict,
  enqueueBuild,
  getBuildQueueStatus,
  checkRateLimit,
  waitForRateLimit,
  checkDiskSpace,
} from "../../lib/build-edge-cases";

const puppeteerPromise = import("puppeteer");

const router = Router();
const previewProcesses = new Map<string, { child: ChildProcess; port: number; command: string; output: string }>();

function previewKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}:${sessionId}`;
}

/**
 * LLM-backed starter project generation. The model is asked to return a JSON
 * object mapping relative file paths to file contents. The response is parsed
 * leniently, and a deterministic single-page fallback is used when the model
 * is unavailable or returns something unparseable, so the studio always gets
 * a working starter.
 */
async function generateStarterFiles(
  prompt: string,
  answers: Record<string, string>,
  feedback: string | null,
  existingFiles: string[],
  extraSystemPrompt = "",
  plan: BuildPlan | null = null,
): Promise<Record<string, string>> {
  const userSummary = Object.entries(answers)
    .map(([question, answer]) => `${question}: ${answer}`)
    .join("\n");
  const existing = existingFiles.length > 0
    ? `\nExisting files in the workspace (keep and update them, do not duplicate):\n${existingFiles.join("\n")}`
    : "";
  const feedbackLine = feedback ? `\nThe user reviewed a preview and asked for these changes:\n${feedback}\n\nApply the changes and return the COMPLETE updated content of every file that changes (and any new files).` : "";

  // Themed fallback so a failed LLM pass never ships the old "generated
  // locally by Jarvis" stub: it at least reflects the request's subject and
  // looks intentional.
  const fallback = (): Record<string, string> => {
    const title = (prompt.split(/[\n.,]/)[0] || "My App").trim().slice(0, 60) || "My App";
    const escaped = title.replace(/[<>&"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[ch] ?? ch);
    const warm = /\b(bakery|cafe|cafe|coffee|restaurant|food|bistro|kitchen|pizza)\b/i.test(prompt);
    const c1 = warm ? "#7a3c1d" : "#1b2a4a";
    const c2 = warm ? "#f7e8d4" : "#e8eefc";
    const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escaped}</title>\n<style>\n:root{color-scheme:dark}\n*{box-sizing:border-box}\nbody{margin:0;font-family:system-ui,-apple-system,sans-serif;background:radial-gradient(1200px 600px at 20% -10%,${c1},#0b1020 55%);color:${c2};min-height:100vh;display:grid;place-items:center;padding:24px}\nmain{max-width:680px;width:100%;padding:48px;border:1px solid rgba(255,255,255,.12);border-radius:24px;background:rgba(21,29,51,.55);backdrop-filter:blur(8px)}\nh1{margin:0 0 8px;font-size:2rem}\np{line-height:1.7;opacity:.85;margin:8px 0 24px}\na{display:inline-block;background:#8fb3ff;color:#0b1020;border-radius:12px;padding:12px 20px;font-weight:600;text-decoration:none}\na:hover{filter:brightness(1.1)}\n</style>\n</head>\n<body>\n<main>\n<h1>${escaped}</h1>\n<p>Your ${escaped.toLowerCase().includes("bakery") ? "bakery" : "project"} page is ready. This starter reflects your idea; type a follow-up in the chat to refine it, or iterate from the Build tab.</p>\n<a href="#">Get started</a>\n</main>\n</body>\n</html>\n`;
    return { "index.html": html, "README.md": `# ${escaped}\n\nStarter generated by Jarvis.\n` };
  };

  const systemPrompt = withExtraBuildInstructions(
    "You are the scaffolding engine inside a web-based IDE. The user wants a starter project built. " +
    "Return ONLY a valid JSON object where each key is a relative file path and each value is the complete file content. " +
    "No markdown fences, no explanation, no extra text before or after the JSON. " +
    "Build a complete, polished single-page app with vanilla HTML, CSS and JavaScript (no external build step, it must run from a static server). " +
    "Prefer a single self-contained index.html with all CSS and JavaScript inline; only split into extra files when genuinely useful. " +
    "The page must actually realize the user's request: real heading, real content, working sections, tasteful modern styling, responsive. " +
    "Keep the starter focused and small (well under 3000 tokens total) so it completes in one response. " +
    "Escape backslashes and quotes correctly inside the JSON string values. " +
    "Never use the em dash character anywhere in generated content.",
    extraSystemPrompt,
  );
  const userContent = `The user wants: ${prompt}\n\nAnswers to the clarifying questions:\n${userSummary || "(none provided)"}\n${feedbackLine}\n${existing}${plan ? `\nApproved implementation plan to follow:\n${JSON.stringify(plan)}` : ""}`;

  const run = (jsonMode: boolean) => pooledClient().chat.completions.create({
    model: jarvisConfig.llmModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.6,
    max_tokens: 8000,
    ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
  }).then((completion) => parseStarterFiles(completion.choices[0]?.message?.content?.trim() ?? ""));

  // Strict JSON mode first (OpenRouter free models support it); if that is
  // rejected or parses to nothing, one plain retry, then the themed fallback.
  try {
    const files = await run(true);
    if (files) return files;
  } catch { /* json_object unsupported on this route — retry plain */ }
  try {
    const files = await run(false);
    if (files) return files;
  } catch { /* all LLM paths failed */ }
  return fallback();
}

/** Parse the scaffolding model's reply into a file map, tolerating markdown
 *  fences and stray text. Returns null when nothing usable came back. */
function parseStarterFiles(raw: string): Record<string, string> | null {
  if (!raw) return null;
  let parsed: unknown = null;
  try { parsed = JSON.parse(raw); } catch { /* try harder below */ }
  if (parsed === null) {
    try { parsed = JSON.parse(raw.replace(/```(?:json)?/gi, "").trim()); } catch { /* try block extract */ }
  }
  if (parsed === null) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) { try { parsed = JSON.parse(match[0]); } catch { /* unrecoverable */ } }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const files: Record<string, string> = {};
  for (const [rel, content] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof rel !== "string" || !rel.trim() || rel.includes("\\")) continue;
    if (!/^[a-zA-Z0-9._/ -]+$/.test(rel) || rel.startsWith("/") || rel.includes("..")) continue;
    if (typeof content !== "string" || content.length > 200_000) continue;
    files[rel] = content;
  }
  return Object.keys(files).length > 0 ? files : null;
}

interface BuildPlan {
  title: string;
  summary: string;
  steps: string[];
  files: string[];
  risks: string[];
}

function fallbackBuildPlan(prompt: string, existingFiles: string[]): BuildPlan {
  const subject = cleanText(prompt, 120) || "the requested app";
  return {
    title: `Build plan: ${subject}`,
    summary: `Jarvis will turn this request into a runnable local build, preserve the existing workspace, and verify the result in the preview.`,
    steps: [
      `Translate the request into a focused implementation for ${subject}.`,
      "Inspect the current workspace and reuse existing files before creating new ones.",
      "Implement the smallest complete version with responsive, accessible UI and working interactions.",
      "Start the local preview, inspect the rendered result, and fix concrete runtime or completeness issues.",
    ],
    files: existingFiles.slice(0, 8),
    risks: ["The exact runtime and file boundaries will be confirmed from the existing workspace before edits."],
  };
}

function parseBuildPlan(raw: string, prompt: string, existingFiles: string[]): BuildPlan | null {
  const parsed = parseJsonObject(raw);
  if (!parsed) return null;
  const strings = (value: unknown, max: number) => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, max)).filter(Boolean).slice(0, 12)
    : [];
  const fallback = fallbackBuildPlan(prompt, existingFiles);
  return {
    title: cleanText(parsed.title, 160) || fallback.title,
    summary: cleanText(parsed.summary, 1200) || fallback.summary,
    steps: strings(parsed.steps, 500).length > 0 ? strings(parsed.steps, 500) : fallback.steps,
    files: strings(parsed.files, 180).length > 0 ? strings(parsed.files, 180) : fallback.files,
    risks: strings(parsed.risks, 300),
  };
}

async function createBuildPlan(
  prompt: string,
  answers: Record<string, string>,
  existingFiles: string[],
  extraSystemPrompt = "",
): Promise<BuildPlan> {
  const fallback = fallbackBuildPlan(prompt, existingFiles);
  try {
    const completion = await pooledClient().chat.completions.create({
      model: jarvisConfig.llmModel,
      messages: [
        {
          role: "system",
          content: withExtraBuildInstructions(
            "You are the planning layer inside Jarvis Build. Plan substantial implementation requests before any files are changed. " +
            "Understand the user's requirements, inspect the listed workspace context, and produce a practical ordered plan for a local runnable app. " +
            "Do not write code and do not claim that anything has been implemented. Return ONLY valid JSON with this shape: " +
            "{title:string,summary:string,steps:string[],files:string[],risks:string[]}. " +
            "Keep the plan concrete, honest, and concise. Reuse existing files when appropriate. Never use the em dash character.",
            extraSystemPrompt,
          ),
        },
        {
          role: "user",
          content: `Request:\n${prompt}\n\nClarifying answers:\n${JSON.stringify(answers)}\n\nExisting workspace files:\n${existingFiles.join("\\n") || "(empty workspace)"}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 900,
    });
    return parseBuildPlan(completion.choices[0]?.message?.content?.trim() ?? "", prompt, existingFiles) ?? fallback;
  } catch {
    return fallback;
  }
}

interface BuildReviewResult {
  done: boolean;
  summary: string;
  fixRequest: string | null;
  deferred: string[];
  filesChanged: string[];
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const match = raw.match(/{[\s\S]*}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function reviewFallback(prompt: string, files: string[], previewOutput: string): BuildReviewResult {
  const hasIndex = files.some((file) => file.toLowerCase() === "index.html");
  const hasRuntimeError = /\b(error|failed|exception|not found|cannot|syntaxerror)\b/i.test(previewOutput);
  if (!hasIndex) {
    return {
      done: false,
      summary: "The preview is missing an index.html entry point.",
      fixRequest: `Create a complete index.html entry point for this app: ${prompt}`,
      deferred: [],
      filesChanged: [],
    };
  }
  return {
    done: !hasRuntimeError,
    summary: hasRuntimeError
      ? "The preview log contains a runtime error that needs another fix pass."
      : "The workspace has an HTML entry point and no reported runtime errors.",
    fixRequest: hasRuntimeError ? `Inspect and fix the runtime issue shown in this preview output:\n${previewOutput.slice(-3000)}` : null,
    deferred: ["Accessibility and visual review should still be confirmed from the rendered preview."],
    filesChanged: [],
  };
}

async function reviewAndFixWorkspace(
  prompt: string,
  answers: Record<string, string>,
  workspaceId: string,
  previewOutput: string,
  passNumber: number,
  extraSystemPrompt = "",
  plan: BuildPlan | null = null,
): Promise<BuildReviewResult> {
  const entries = await listWorkspaceFiles(workspaceId);
  const files = entries
    .filter((entry) => entry.type === "file" && !/^\\.?env/i.test(entry.path))
    .map((entry) => entry.path)
    .slice(0, 120);
  const fallback = reviewFallback(prompt, files, previewOutput);
  
  // Track token usage to warn users on high iteration count
  const tokenWarning = passNumber > 10 ? `(High iteration count: ${passNumber} passes. Consider if additional changes are needed.)` : "";
  
  try {
    const client = pooledClient();
    const completion = await client.chat.completions.create({
      model: jarvisConfig.llmModel,
      messages: [
        {
          role: "system",
          content:
            withExtraBuildInstructions(
              "You are the self-reviewer inside Jarvis Build. Review a locally generated web app after it has been run. " +
              "Return ONLY JSON with this shape: {done:boolean,summary:string,fixRequest:string|null,deferred:string[]}. " +
              "Set done false only when a concrete runtime, structure, or obvious completeness issue can be fixed now. " +
              "Keep fixRequest short and actionable. Do not claim that a screenshot, accessibility, security, or performance check passed unless evidence is provided. " +
              "Never use the em dash character.",
              extraSystemPrompt,
            ),
        },
        {
          role: "user",
          content:
            `Prompt: ${prompt}\nAnswers: ${JSON.stringify(answers)}\nPass: ${passNumber}${tokenWarning}\nFiles: ${files.join(", ") || "(none)"}\nPreview output:\n${previewOutput.slice(-6000)}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 700,
    });
    const parsed = parseJsonObject(completion.choices[0]?.message?.content?.trim() ?? "");
    if (!parsed) return fallback;
    const done = parsed.done === true;
    const summary = cleanText(parsed.summary, 500) || fallback.summary;
    const fixRequest = done ? null : cleanText(parsed.fixRequest, 1800) || fallback.fixRequest;
    const deferred = Array.isArray(parsed.deferred)
      ? parsed.deferred.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 240)).slice(0, 8)
      : fallback.deferred;
    if (done || !fixRequest) return { done: true, summary, fixRequest: null, deferred, filesChanged: [] };

    const existingFiles = entries.filter((entry) => entry.type === "file").map((entry) => entry.path);
    const generated = await generateStarterFiles(prompt, answers, fixRequest, existingFiles, extraSystemPrompt, plan);
    const filesChanged: string[] = [];
    for (const [relativePath, content] of Object.entries(generated)) {
      if (!safeWorkspacePath(relativePath, workspaceId)) continue;
      await writeWorkspaceFile(relativePath, content, workspaceId);
      filesChanged.push(relativePath);
    }
    return { done: false, summary, fixRequest, deferred, filesChanged };
  } catch {
    if (fallback.done || !fallback.fixRequest) return fallback;
    const existingFiles = entries.filter((entry) => entry.type === "file").map((entry) => entry.path);
    const generated = await generateStarterFiles(prompt, answers, fallback.fixRequest, existingFiles, extraSystemPrompt, plan);
    const filesChanged: string[] = [];
    for (const [relativePath, content] of Object.entries(generated)) {
      if (!safeWorkspacePath(relativePath, workspaceId)) continue;
      await writeWorkspaceFile(relativePath, content, workspaceId);
      filesChanged.push(relativePath);
    }
    return { ...fallback, filesChanged };
  }
}

let screenshotBrowser: Browser | null = null;
let screenshotBrowserPromise: Promise<Browser> | null = null;

async function getScreenshotBrowser(): Promise<Browser> {
  if (screenshotBrowser && screenshotBrowser.connected) return screenshotBrowser;
  if (!screenshotBrowserPromise) {
    screenshotBrowserPromise = puppeteerPromise.then(async ({ default: puppeteer }) => {
      const executablePath = await puppeteer.executablePath();
      const browser = await puppeteer.launch({
        headless: true,
        executablePath,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--mute-audio", "--disable-dev-shm-usage"],
      });
      screenshotBrowser = browser;
      return browser;
    }).catch((err) => {
      screenshotBrowserPromise = null;
      throw err;
    });
  }
  return screenshotBrowserPromise;
}

interface PreviewAgentElement {
  id: number;
  tag: string;
  text: string;
  ariaLabel: string;
  placeholder: string;
  inputType: string;
  href: string;
  disabled: boolean;
}

interface PreviewAgentAction {
  action: "click" | "type" | "select" | "press" | "wait" | "done";
  id?: number;
  text?: string;
  value?: string;
  key?: string;
  milliseconds?: number;
}

interface PreviewAgentDecision {
  done: boolean;
  message: string;
  actions: PreviewAgentAction[];
}

function localPreviewUrl(url: string, port: number): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") && parsed.port === String(port);
  } catch {
    return false;
  }
}

function parsePreviewAgentDecision(raw: string): PreviewAgentDecision | null {
  const parsed = parseJsonObject(raw);
  if (!parsed) return null;
  const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
  const allowed = new Set<PreviewAgentAction["action"]>(["click", "type", "select", "press", "wait", "done"]);
  return {
    done: parsed.done === true,
    message: cleanText(parsed.message, 500),
    actions: actions
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .map((item) => ({
        action: allowed.has(item.action as PreviewAgentAction["action"]) ? item.action as PreviewAgentAction["action"] : "done",
        id: Number.isInteger(item.id) ? Number(item.id) : undefined,
        text: cleanText(item.text, 1000),
        value: cleanText(item.value, 300),
        key: cleanText(item.key, 40),
        milliseconds: Math.min(2000, Math.max(0, Number(item.milliseconds) || 0)),
      }))
      .slice(0, 5),
  };
}

async function inspectPreviewPage(page: Page): Promise<PreviewAgentElement[]> {
  return page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll(
      "button, a, input, textarea, select, [role=button]",
    )).slice(0, 80) as any[];
    return elements.map((element, id) => {
      const item = element as any;
      item.setAttribute("data-jarvis-agent-id", String(id));
      return {
        id,
        tag: item.tagName.toLowerCase(),
        text: (item.innerText || item.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 180),
        ariaLabel: item.getAttribute("aria-label") || "",
        placeholder: item.getAttribute("placeholder") || "",
        inputType: item.getAttribute("type") || "",
        href: item.tagName.toLowerCase() === "a" ? item.getAttribute("href") || "" : "",
        disabled: item.disabled === true,
      };
    });
  });
}

async function runPreviewAgentAction(page: Page, action: PreviewAgentAction): Promise<string> {
  if (action.action === "wait") {
    await new Promise((resolve) => setTimeout(resolve, action.milliseconds ?? 300));
    return `waited ${action.milliseconds ?? 300}ms`;
  }
  if (action.action === "done") return "finished";
  if (!Number.isInteger(action.id) || (action.id ?? -1) < 0 || (action.id ?? -1) >= 80) {
    throw new Error("The agent selected an invalid element");
  }
  const selector = `[data-jarvis-agent-id="${action.id}"]`;
  if (action.action === "click") {
    await page.$eval(selector, (element: any) => element.click());
    await new Promise((resolve) => setTimeout(resolve, 350));
    return `clicked element ${action.id}`;
  }
  if (action.action === "type") {
    const text = action.text ?? "";
    await page.$eval(selector, (element: any, value) => {
      const input = element as any;
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, text);
    return `typed into element ${action.id}`;
  }
  if (action.action === "select") {
    await page.select(selector, action.value ?? "");
    return `selected a value in element ${action.id}`;
  }
  if (action.action === "press") {
    await page.focus(selector);
    await page.keyboard.press((action.key || "Enter") as any);
    await new Promise((resolve) => setTimeout(resolve, 350));
    return `pressed ${action.key || "Enter"}`;
  }
  throw new Error(`Unsupported preview action: ${action.action}`);
}

/** Capture a PNG of the running preview and persist it to the Gallery store. */
type ScreenshotViewport = "desktop" | "mobile";

const screenshotViewportSizes: Record<ScreenshotViewport, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

async function capturePreviewPng(
  url: string,
  workspaceId: string,
  viewport: ScreenshotViewport = "desktop",
): Promise<{ url: string; dataUrl: string } | null> {
  try {
    const browser = await getScreenshotBrowser();
    const page: Page = await browser.newPage();
    try {
      const size = screenshotViewportSizes[viewport];
      await page.setViewport({ ...size, deviceScaleFactor: 1 });
      await page.goto(url, { waitUntil: "networkidle0", timeout: 20_000 });
      await new Promise((resolve) => setTimeout(resolve, 700));
      const shot = await page.screenshot({ type: "png" });
      const png = Buffer.from(shot);
      const stored = await persistFile({
        data: png,
        mimeType: "image/png",
        name: `build-preview-${workspaceId}-${viewport}.png`,
        kind: "image",
        owner: "user",
      });
      return {
        url: stored?.url ?? "",
        dataUrl: `data:image/png;base64,${png.toString("base64")}`,
      };
    } finally {
      await page.close();
    }
  } catch (err) {
    console.error("[build] screenshot failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Find the running preview entry for a workspace, if any. */
function findPreview(workspaceId: string, sessionId: string): { child: ChildProcess; port: number; command: string; output: string } | undefined {
  return previewProcesses.get(previewKey(workspaceId, sessionId));
}

/** Build a live preview URL for a workspace, or null when the workspace has no preview yet. */
function previewUrlFor(workspaceId: string, sessionId: string, port?: number | null): string | null {
  const preview = findPreview(workspaceId, sessionId);
  const p = port ?? preview?.port;
  if (!p || !Number.isInteger(p) || p < 1 || p > 65535) return null;
  return `http://127.0.0.1:${p}`;
}
const MAX_ENV_KEYS = 80;
const MAX_ENV_VALUE = 4000;

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function withExtraBuildInstructions(basePrompt: string, extraPrompt: string): string {
  const extra = cleanText(extraPrompt, 4000);
  if (!extra) return basePrompt;
  return `${basePrompt}\n\nAdditional Jarvis Build instructions from the user (additive only; preserve the original Jarvis Build requirements and safety rules):\n${extra}`;
}

async function readWorkspaceEnv(workspaceId = "default"): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(path.join(getWorkspaceRoot(workspaceId), ".jarvis.env.json"), "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .filter(([key, value]) => /^[A-Z][A-Z0-9_]{0,63}$/.test(key) && typeof value === "string")
      .slice(0, MAX_ENV_KEYS)
      .map(([key, value]) => [key, String(value).slice(0, MAX_ENV_VALUE)]));
  } catch {
    return {};
  }
}

async function writeWorkspaceEnv(env: Record<string, string>, workspaceId = "default"): Promise<void> {
  await ensureWorkspace(workspaceId);
  await fs.writeFile(path.join(getWorkspaceRoot(workspaceId), ".jarvis.env.json"), JSON.stringify(env, null, 2), "utf8");
}

function serializeSavedApp(row: typeof buildApps.$inferSelect) {
  return { ...row, metadata: row.metadata ?? {} };
}

router.get("/build/apps", async (req, res) => {
  try {
    const rows = await db.select().from(buildApps).orderBy(desc(buildApps.updatedAt));
    res.json(rows.map(serializeSavedApp));
  } catch (err) {
    req.log.error({ err }, "Failed to list build apps");
    res.status(500).json({ error: "Failed to list build apps" });
  }
});

router.post("/build/apps", async (req, res) => {
  const name = cleanText(req.body?.name, 100) || "Untitled build";
  const description = cleanText(req.body?.description, 500);
  const metadata = {
    runCommand: cleanText(req.body?.runCommand, 400),
    previewPort: Number.isInteger(req.body?.previewPort) ? req.body.previewPort : null,
    savedAt: new Date().toISOString(),
  };
  try {
    const workspaceId = cleanText(req.body?.workspaceId, 64) || "default";
    await ensureWorkspace(workspaceId);
    const filesSnapshot = await listWorkspaceFiles(workspaceId);
    const contents: Record<string, string> = {};
    for (const entry of filesSnapshot) {
      if (entry.type !== "file" || entry.path === ".jarvis.env.json") continue;
      const result = await readWorkspaceFile(entry.path, 200_000, workspaceId);
      if (result.ok) contents[entry.path] = result.content;
    }
    const env = await readWorkspaceEnv(workspaceId);
    const manifest = Buffer.from(JSON.stringify({ version: 1, files: contents, env }, null, 2), "utf8");
    const stored = await persistFile({
      data: manifest,
      mimeType: "application/json",
      name: `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.jarvis-build.json`,
      kind: "build-app",
      owner: "user",
    });
    if (!stored) {
      res.status(500).json({ error: "Could not persist the build snapshot" });
      return;
    }
    const [row] = await db.insert(buildApps).values({
      name,
      description,
      fileId: stored.fileId,
      metadata: { ...metadata, storageKey: stored.key, fileCount: Object.keys(contents).length, envKeys: Object.keys(env) },
    }).returning();
    res.status(201).json(serializeSavedApp(row));
  } catch (err) {
    req.log.error({ err }, "Failed to save build app");
    res.status(500).json({ error: "Failed to save build app" });
  }
});

router.post("/build/apps/:id/restore", async (req, res) => {
  try {
    const [app] = await db.select().from(buildApps).where(eq(buildApps.id, req.params.id));
    const metadata = (app?.metadata ?? {}) as { storageKey?: string };
    if (!app || !metadata.storageKey) {
      res.status(404).json({ error: "Saved build app not found" });
      return;
    }
    const blob = await getStorage().get(metadata.storageKey);
    if (!blob) {
      res.status(404).json({ error: "Saved build snapshot is unavailable" });
      return;
    }
    const snapshot = JSON.parse(blob.data.toString("utf8")) as { files?: Record<string, string>; env?: Record<string, string> };
    for (const [filePath, content] of Object.entries(snapshot.files ?? {})) {
      if (!safeWorkspacePath(filePath, cleanText(req.body?.workspaceId, 64) || "default")) continue;
      await writeWorkspaceFile(filePath, typeof content === "string" ? content : "", cleanText(req.body?.workspaceId, 64) || "default");
    }
    await writeWorkspaceEnv(snapshot.env ?? {}, cleanText(req.body?.workspaceId, 64) || "default");
    await db.update(buildApps).set({ updatedAt: new Date() }).where(eq(buildApps.id, app.id));
    res.json({ ok: true, restoredFiles: Object.keys(snapshot.files ?? {}).length });
  } catch (err) {
    req.log.error({ err }, "Failed to restore build app");
    res.status(500).json({ error: "Failed to restore build app" });
  }
});

router.get("/build/env", async (req, res) => {
  const workspaceId = cleanText(req.query.workspaceId, 64) || "default";
  res.json({ workspaceId, env: await readWorkspaceEnv(workspaceId) });
});

router.put("/build/env", async (req, res) => {
  const raw = req.body?.env;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    res.status(400).json({ error: "env must be an object" });
    return;
  }
  const env = Object.fromEntries(Object.entries(raw as Record<string, unknown>)
    .filter(([key, value]) => /^[A-Z][A-Z0-9_]{0,63}$/.test(key) && typeof value === "string")
    .slice(0, MAX_ENV_KEYS)
    .map(([key, value]) => [key, String(value).slice(0, MAX_ENV_VALUE)]));
  await writeWorkspaceEnv(env, cleanText(req.body?.workspaceId, 64) || "default");
  res.json({ env });
});

router.post("/build/ask", async (req, res) => {
  const prompt = cleanText(req.body?.prompt, 300).toLowerCase();
  const inventory = [
    { key: "interface", label: "Professional responsive interface", selected: true },
    { key: "runtime", label: "Local runnable preview", selected: true },
    { key: "accessibility", label: "Accessibility pass", selected: /accessib|a11y|keyboard|screen reader/.test(prompt) },
    { key: "data", label: "Local data or persistence", selected: /database|data|storage|save|persist|crud/.test(prompt) },
    { key: "auth", label: "Local authentication flow", selected: /auth|login|log in|sign up|account|password/.test(prompt) },
    { key: "ai", label: "AI interaction surface", selected: /\bai\b|assistant|chat|llm|model|generate/.test(prompt) },
    { key: "mobile", label: "Mobile responsive layout", selected: /mobile|responsive|phone|tablet/.test(prompt) },
  ];
  res.json({
    inventory,
    questions: [
      { key: "appType", label: "What kind of app is this?", options: ["Landing page", "Dashboard", "Portfolio", "Game", "Tool or utility"] },
      { key: "uiStyle", label: "What UI style do you prefer?", options: ["Dark and futuristic", "Clean and minimal", "Colorful and playful", "Glassmorphism", "Retro or vintage"] },
      { key: "aiProvider", label: "Will it talk to an AI provider?", options: ["No AI needed", "OpenAI-compatible API", "Simple local demo"] },
      { key: "scope", label: "How big should the first version be?", options: ["Single page", "Two or three sections", "Multi-page feel"] },
    ],
  });
});

router.post("/build/plan", async (req, res) => {
  const workspaceId = cleanText(req.body?.workspaceId, 64) || "default";
  const prompt = cleanText(req.body?.prompt, 300);
  const extraSystemPrompt = cleanText(req.body?.extraSystemPrompt, 4000);
  const rawAnswers = req.body?.answers && typeof req.body.answers === "object" && !Array.isArray(req.body.answers)
    ? req.body.answers as Record<string, unknown>
    : {};
  const answers = Object.fromEntries(Object.entries(rawAnswers)
    .map(([key, value]) => [key, cleanText(value, 200)])
    .filter(([, value]) => value));
  if (!prompt) {
    res.status(400).json({ error: "A build request is required" });
    return;
  }
  try {
    await ensureWorkspace(workspaceId);
    const existingFiles = (await listWorkspaceFiles(workspaceId))
      .filter((entry) => entry.type === "file" && !/^\\.?env/i.test(entry.path))
      .map((entry) => entry.path)
      .slice(0, 120);
    const plan = await createBuildPlan(prompt, answers, existingFiles, extraSystemPrompt);
    res.json({ ok: true, plan });
  } catch (err) {
    req.log.error({ err }, "Failed to create Jarvis Build plan");
    res.status(500).json({ error: "Could not create a Jarvis Build plan" });
  }
});

router.post("/build/start", async (req, res) => {
  const projectId = cleanText(req.body?.projectId, 64) || "default";
  const prompt = cleanText(req.body?.prompt, 300);
  try {
    const iso = await createIsolated(projectId);
    res.json({ ok: true, projectId, worktreePath: iso.worktreePath, branch: iso.branch });
  } catch (err) {
    req.log.error({ err }, "Failed to create isolated build workspace");
    res.status(500).json({ error: "Could not create isolated build workspace" });
  }
});

router.post("/build/scaffold", async (req, res) => {
  const workspaceId = cleanText(req.body?.workspaceId, 64) || "default";
  const projectId = cleanText(req.body?.projectId, 64) || workspaceId;
  const prompt = cleanText(req.body?.prompt, 300) || "a simple Jarvis starter app";
  const rawAnswers = (req.body?.answers && typeof req.body.answers === "object" && !Array.isArray(req.body.answers))
    ? req.body.answers as Record<string, unknown>
    : {};
  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawAnswers)) {
    const cleaned = cleanText(value, 200);
    if (key.length <= 100 && cleaned) answers[key] = cleaned;
  }
  const feedback = cleanText(req.body?.feedback, 2000) || null;
  const extraSystemPrompt = cleanText(req.body?.extraSystemPrompt, 4000);
  const rawPlan = req.body?.plan;
  const plan = rawPlan && typeof rawPlan === "object" && !Array.isArray(rawPlan)
    ? parseBuildPlan(JSON.stringify(rawPlan), prompt, [])
    : null;
  const dryRun = Boolean(req.body?.dryRun);
  try {
    await ensureWorkspace(workspaceId);
    await logBuildEvent(projectId, "plan_start", `Scaffold requested: ${prompt.slice(0, 80)}`, { data: { workspaceId, dryRun, feedback: feedback ? feedback.slice(0, 200) : null } });
    const existingFiles = (await listWorkspaceFiles(workspaceId))
      .filter((entry) => entry.type === "file")
      .map((entry) => entry.path);
    const files = await generateStarterFiles(prompt, answers, feedback, existingFiles, extraSystemPrompt, plan);

    // Phase 2.1: Diff Preview — when dryRun, return the proposed files without
    // writing them so the UI can show a confirmation modal before applying.
    if (dryRun) {
      await logBuildEvent(projectId, "tool_result", "Scaffold dry-run produced files", { data: { files: Object.keys(files), dryRun: true } });
      res.status(200).json({ ok: true, dryRun: true, files, runtime: "static", previewCommand: "python3 -m http.server ${PORT}" });
      return;
    }

    let wrote = 0;
    for (const [relPath, content] of Object.entries(files)) {
      if (!safeWorkspacePath(relPath, workspaceId)) continue;
      await writeWorkspaceFile(relPath, content, workspaceId);
      wrote++;
    }
    await logBuildEvent(projectId, "tool_result", `Scaffold wrote ${wrote} file(s)`, { data: { files: Object.keys(files) }, step: "scaffold" });
    // Phase 1.1 + 1.2: commit iteration + save checkpoint
    if (hasIsolated(projectId)) {
      await commitIteration(projectId, 1, plan?.steps.length ?? 1, "scaffold starter");
    }
    await saveCheckpoint({
      projectId,
      iteration: 1,
      completed: 0,
      plan: plan ? { title: plan.title, summary: plan.summary, steps: plan.steps, files: plan.files, risks: plan.risks } : {},
      completedSteps: [{ step: "scaffold", files: Object.keys(files) }],
      workingContext: { prompt, workspaceId },
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
    });
    // Phase 3.2: Log build activity to project (no-op if projectId isn't a real project)
    await logActivity(projectId, "agent_ran", `Build scaffold: ${prompt.slice(0, 100)}`);
    res.status(201).json({ ok: true, files: Object.keys(files), runtime: "static", previewCommand: "python3 -m http.server ${PORT}" });
  } catch (err) {
    req.log.error({ err }, "Failed to scaffold starter");
    res.status(500).json({ error: "Could not scaffold starter" });
  }
});

router.post("/build/iterate", async (req, res) => {
  const workspaceId = cleanText(req.body?.workspaceId, 64) || "default";
  const projectId = cleanText(req.body?.projectId, 64) || workspaceId;
  const prompt = cleanText(req.body?.prompt, 300) || "a simple Jarvis starter app";
  const previewOutput = cleanText(req.body?.previewOutput, 6000);
  const extraSystemPrompt = cleanText(req.body?.extraSystemPrompt, 4000);
  const rawPlan = req.body?.plan;
  const plan = rawPlan && typeof rawPlan === "object" && !Array.isArray(rawPlan)
    ? parseBuildPlan(JSON.stringify(rawPlan), prompt, [])
    : null;
  // Allow unlimited iterations (cap at 100 to prevent runaway loops, but this is a soft limit)
  const passNumber = Math.max(1, Number(req.body?.passNumber) || 1);
  const rawAnswers = req.body?.answers && typeof req.body.answers === "object" && !Array.isArray(req.body.answers)
    ? req.body.answers as Record<string, unknown>
    : {};
  const answers = Object.fromEntries(Object.entries(rawAnswers)
    .map(([key, value]) => [key, cleanText(value, 200)])
    .filter(([, value]) => value));
  try {
    await ensureWorkspace(workspaceId);
    await logBuildEvent(projectId, "step_start", `Iteration ${passNumber}: ${prompt.slice(0, 80)}`, { data: { passNumber, previewOutput: previewOutput.slice(0, 200) }, step: `iteration-${passNumber}` });
    // If passNumber exceeds 100, warn but allow the iteration
    if (passNumber > 100) {
      req.log.warn({ workspaceId, passNumber }, "Iteration count is very high, possibly infinite loop");
    }
    const result = await reviewAndFixWorkspace(prompt, answers, workspaceId, previewOutput, passNumber, extraSystemPrompt, plan);
    await logBuildEvent(projectId, "tool_result", `Iteration ${passNumber} review: ${result.done ? "done" : "continued"}`, { data: { done: result.done, summary: result.summary?.slice(0, 200), filesChanged: result.filesChanged ?? [] }, step: `iteration-${passNumber}` });
    // Phase 1.1 + 1.2: commit iteration + update checkpoint
    if (hasIsolated(projectId)) {
      await commitIteration(projectId, passNumber, plan?.steps.length ?? passNumber, `iteration ${passNumber}`);
    }

    // Phase 2.2: Run verification loop after iteration if project has structured checks
    let verifyResult = null;
    let verifyFeedback = null;
    let fixAttempts = 0;
    const maxFixAttempts = 3;
    if (hasIsolated(projectId) && req.body?.verify !== false) {
      try {
        await logBuildEvent(projectId, "verify_start", `Verification loop (iteration ${passNumber})`, { step: `iteration-${passNumber}` });
        const verify = await verifyWorkspace(projectId, workspaceId);
        verifyResult = verify.ok;
        verifyFeedback = formatVerificationFeedback(verify);
        req.log.info({ projectId, passNumber, ok: verify.ok }, "Verification loop completed");
        await logBuildEvent(projectId, "verify_result", verifyResult ? "Verification passed" : "Verification failed", { data: { ok: verifyResult, feedback: verifyFeedback?.slice(0, 400) }, step: `iteration-${passNumber}` });

        // Phase 2.2: Retry loop with fixer prompt on verification failure
        while (!verifyResult && fixAttempts < maxFixAttempts) {
          fixAttempts++;
          req.log.info({ projectId, passNumber, fixAttempts }, "Verification failed, running fixer loop");
          await logBuildEvent(projectId, "retry", `Fixer attempt ${fixAttempts}/${maxFixAttempts}`, { step: `iteration-${passNumber}` });
          const fixRes = await fetch(new URL(`/api/jarvis/build/fix`, `${req.protocol}://${req.get("host")}`).toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId, projectId, prompt, failure: verifyFeedback ?? "Verification failed", extraSystemPrompt }),
          });
          if (fixRes.ok) {
            // Re-run verification after fix
            const retryVerify = await verifyWorkspace(projectId, workspaceId);
            verifyResult = retryVerify.ok;
            verifyFeedback = formatVerificationFeedback(retryVerify);
            await logBuildEvent(projectId, "verify_result", verifyResult ? "Fixer resolved verification failure" : "Still failing after fixer", { data: { ok: verifyResult }, step: `iteration-${passNumber}` });
            if (verifyResult) {
              req.log.info({ projectId, passNumber, fixAttempts }, "Fixer resolved verification failure");
              break;
            }
          } else {
            req.log.warn({ projectId, passNumber, fixAttempts }, "Fixer endpoint failed");
            await logBuildEvent(projectId, "error", "Fixer endpoint failed during verification retry", { step: `iteration-${passNumber}` });
            break;
          }
        }
      } catch (verifyErr) {
        req.log.warn({ err: verifyErr }, "Verification skipped (no checks configured)");
        await logBuildEvent(projectId, "info", "Verification skipped (no checks configured)", { step: `iteration-${passNumber}` });
      }
    }

    await saveCheckpoint({
      projectId,
      iteration: passNumber,
      completed: result.done ? 1 : 0,
      plan: plan ? { title: plan.title, summary: plan.summary, steps: plan.steps, files: plan.files, risks: plan.risks } : {},
      completedSteps: [{ step: `iteration ${passNumber}`, done: result.done, filesChanged: result.filesChanged ?? [] }],
      workingContext: { prompt, workspaceId, passNumber, verifyOk: verifyResult, fixAttempts },
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
    });
    // Phase 3.2: Log build activity
    await logActivity(projectId, "agent_ran", `Build iterate #${passNumber}: ${result.done ? "done" : "continued"} — ${result.summary?.slice(0, 80) ?? prompt.slice(0, 80)}`);
    res.json({ ok: true, passNumber, verifyOk: verifyResult, verifyFeedback, fixAttempts, ...result });
  } catch (err) {
    req.log.error({ err }, "Build self-review failed");
    res.status(500).json({ error: "Build self-review failed" });
  }
});

router.post("/build/rollback", async (req, res) => {
  const projectId = cleanText(req.body?.projectId, 64) || "default";
  try {
    if (!hasIsolated(projectId)) {
      res.status(404).json({ error: "No isolated workspace for this project" });
      return;
    }
    const ok = await rollbackIteration(projectId);
    res.json({ ok, message: ok ? "Rolled back one iteration" : "Rollback failed (no previous commit?)" });
  } catch (err) {
    req.log.error({ err }, "Failed to rollback build");
    res.status(500).json({ error: "Failed to rollback build" });
  }
});

router.get("/build/resume/:projectId", async (req, res) => {
  const projectId = cleanText(req.params.projectId as string, 64);
  try {
    const checkpoint = await getLatestCheckpoint(projectId);
    if (!checkpoint) {
      res.status(404).json({ error: "No checkpoint found to resume" });
      return;
    }
    res.json({
      ok: true,
      resume: !checkpoint.completed,
      checkpoint: {
        id: checkpoint.id,
        iteration: checkpoint.iteration,
        completed: checkpoint.completed,
        plan: checkpoint.plan,
        completedSteps: checkpoint.completedSteps,
        workingContext: checkpoint.workingContext,
        createdAt: checkpoint.createdAt,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get resume state");
    res.status(500).json({ error: "Failed to get resume state" });
  }
});

/**
 * Phase 2.1: Diff Preview — Generate unified diff between current workspace
 * and proposed file changes. Returns structured diff for UI confirmation modal.
 */
router.post("/build/diff", async (req, res) => {
  const workspaceId = cleanText(req.body?.workspaceId, 64) || "default";
  const projectId = cleanText(req.body?.projectId, 64) || workspaceId;
  const files = req.body?.files as Record<string, string> | undefined;
  if (!files || typeof files !== "object") {
    res.status(400).json({ error: "files object is required" });
    return;
  }
  try {
    await ensureWorkspace(workspaceId);
    const diffs = [];
    for (const [relPath, newContent] of Object.entries(files)) {
      const safePath = safeWorkspacePath(relPath, workspaceId);
      if (!safePath) continue;
      let oldContent = "";
      try {
        oldContent = await readWorkspaceFileText(relPath, workspaceId);
      } catch { /* new file */ }
      const diff = generateUnifiedDiff(oldContent, newContent, relPath);
      diffs.push({ filePath: relPath, diff, oldContent, newContent });
    }
    res.json({ ok: true, diffs });
  } catch (err) {
    req.log.error({ err }, "Failed to generate diff");
    res.status(500).json({ error: "Could not generate diff" });
  }
});

/**
 * Phase 2.2: Verification Loop — Run tsc, vitest, eslint, and build in parallel.
 * Returns structured results for the model to fix issues. Supports auto-retry.
 */
router.post("/build/verify", async (req, res) => {
  const projectId = cleanText(req.body?.projectId, 64) || "default";
  const workspaceId = cleanText(req.body?.workspaceId, 64) || projectId;
  const maxRetries = Math.min(5, Math.max(0, Number(req.body?.maxRetries) || 3));
  try {
    await logBuildEvent(projectId, "verify_start", "Manual verification triggered", { data: { maxRetries } });
    let result = await verifyWorkspace(projectId, workspaceId);
    let attempt = 0;
    while (!result.ok && attempt < maxRetries) {
      attempt++;
      req.log.info({ projectId, attempt }, "Verification failed, retrying...");
      await logBuildEvent(projectId, "retry", `Verification retry ${attempt}/${maxRetries}`, { step: `verify-manual` });
      // Wait a moment before retry (helps with transient issues)
      await new Promise(r => setTimeout(r, 1000 * attempt));
      result = await verifyWorkspace(projectId, workspaceId);
    }
    const feedback = formatVerificationFeedback(result);
    await logBuildEvent(projectId, "verify_result", result.ok ? "Verification passed" : "Verification failed", { data: { ok: result.ok, attempt, feedback: feedback?.slice(0, 400) } });
    res.json({ ok: result.ok, attempt, result, feedback });
  } catch (err) {
    req.log.error({ err }, "Verification failed");
    await logBuildEvent(projectId, "error", "Verification endpoint error", { data: { message: err instanceof Error ? err.message : String(err) } });
    res.status(500).json({ error: "Verification failed" });
  }
});

/**
 * Phase 2.3: Parallel Step Fan-out — Execute plan steps in topological batches.
 * Plan schema adds dependsOn[] and parallel flag. Independent steps run concurrently.
 */
/**
 * Phase 2.2: Fixer Loop — Apply the smallest fix to resolve a verification or
 * review failure using the fixer prompt. Returns the files that changed.
 */
router.post("/build/fix", async (req, res) => {
  const workspaceId = cleanText(req.body?.workspaceId, 64) || "default";
  const projectId = cleanText(req.body?.projectId, 64) || workspaceId;
  const failure = cleanText(req.body?.failure, 4000);
  const prompt = cleanText(req.body?.prompt, 300) || "a simple Jarvis starter app";
  const extraSystemPrompt = cleanText(req.body?.extraSystemPrompt, 4000);
  if (!failure) {
    res.status(400).json({ error: "failure description is required" });
    return;
  }
  try {
    await ensureWorkspace(workspaceId);
    await logBuildEvent(projectId, "tool_call", "Fixer loop started", { data: { failure: failure.slice(0, 200) }, step: `fix` });
    const entries = (await listWorkspaceFiles(workspaceId)).filter((entry) => entry.type === "file").map((entry) => entry.path).slice(0, 120);
    const client = pooledClient();
    const completion = await client.chat.completions.create({
      model: jarvisConfig.llmModel,
      messages: [
        { role: "system", content: fixerPromptV2({ extraSystemPrompt }) },
        {
          role: "user",
          content: [
            `Original request: ${prompt}`,
            `Failure to resolve:`,
            failure,
            ``,
            `Workspace files:`,
            entries.join("\n") || "(none)",
          ].join("\n\n"),
        },
      ],
      temperature: 0.2,
      max_tokens: 6000,
      response_format: { type: "json_object" as const },
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    let parsed: { files?: Record<string, string>; notes?: string } | null = null;
    try { parsed = JSON.parse(raw); } catch { /* ignore */ }
    if (!parsed?.files) {
      res.status(422).json({ ok: false, error: "Fixer returned no changes", raw });
      return;
    }
    const filesChanged: string[] = [];
    for (const [relPath, content] of Object.entries(parsed.files)) {
      const safePath = safeWorkspacePath(relPath, workspaceId);
      if (!safePath) continue;
      await writeWorkspaceFile(relPath, content, workspaceId);
      filesChanged.push(relPath);
    }
    await logBuildEvent(projectId, "tool_result", `Fixer applied ${filesChanged.length} file(s)`, { data: { filesChanged }, step: `fix` });
    if (hasIsolated(projectId)) {
      await commitIteration(projectId, 1, 1, "auto-fix");
    }
    res.json({ ok: true, filesChanged, notes: parsed.notes ?? "" });
  } catch (err) {
    req.log.error({ err }, "Fixer loop failed");
    await logBuildEvent(projectId, "error", "Fixer loop failed", { data: { message: err instanceof Error ? err.message : String(err) }, step: `fix` });
    res.status(500).json({ error: "Fixer loop failed" });
  }
});

router.post("/build/execute-plan", async (req, res) => {
  const projectId = cleanText(req.body?.projectId, 64) || "default";
  const workspaceId = cleanText(req.body?.workspaceId, 64) || projectId;
  const prompt = cleanText(req.body?.prompt, 300) || "a simple Jarvis starter app";
  const rawAnswers = req.body?.answers && typeof req.body.answers === "object" && !Array.isArray(req.body.answers)
    ? req.body.answers as Record<string, unknown>
    : {};
  const answers = Object.fromEntries(Object.entries(rawAnswers)
    .map(([key, value]) => [key, cleanText(value, 200)])
    .filter(([, value]) => value));
  const rawPlan = req.body?.plan;
  const plan = rawPlan && typeof rawPlan === "object" && !Array.isArray(rawPlan)
    ? rawPlan as { title: string; summary: string; steps: Array<{id: string; description: string; dependsOn?: string[]; parallel?: boolean}>; files: string[]; risks: string[] }
    : null;
  const extraSystemPrompt = cleanText(req.body?.extraSystemPrompt, 4000);
  const maxRetries = Math.min(3, Math.max(0, Number(req.body?.maxRetries) || 1));

  if (!plan || !plan.steps || !Array.isArray(plan.steps)) {
    res.status(400).json({ error: "Valid plan with steps is required" });
    return;
  }

  try {
    await ensureWorkspace(workspaceId);

    await logBuildEvent(projectId, "plan_start", `Execute plan: ${plan.title?.slice(0, 80)}`, { data: { steps: plan.steps.map(s => s.id), workspaceId } });

    // Phase 3.1: Initialize working context
    setProjectGoal(projectId, prompt);
    await refreshFileMap(projectId, workspaceId);

    // Phase 3.2: Build project-scoped context (instructions, memory, activity, files)
    // Only injects when projectId matches a real Projects row — safe no-op otherwise.
    const projectContext = await buildProjectContextForBuild(projectId, prompt, {
      includeActivity: true,
      includeFiles: true,
      activityLimit: 20,
      fileLimit: 50,
    });

    // Phase 2.3: Get parallelizable batches from plan steps
    const steps = plan.steps.map(s => ({
      id: s.id,
      description: s.description,
      dependsOn: s.dependsOn ?? [],
      parallel: s.parallel ?? false,
    }));
    const batches = getParallelizableSteps(steps);

    const allResults: Array<{ stepId: string; ok: boolean; filesChanged: string[]; feedback?: string }> = [];
    let overallOk = true;

    // Execute each batch (batches run sequentially, steps within batch run in parallel)
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      req.log.info({ projectId, batch: batchIndex + 1, steps: batch.map(s => s.id) }, "Executing plan batch");
      await logBuildEvent(projectId, "step_start", `Batch ${batchIndex + 1}/${batches.length}: ${batch.map(s => s.id).join(", ")}`, { data: { steps: batch.map(s => s.id) }, step: `batch-${batchIndex + 1}` });

      // Get serialized working context for injection
      const contextPrompt = combineBuildMemory(serializeContext(projectId), projectContext);

      // Run steps in this batch in parallel
      const batchResults = await Promise.all(batch.map(async (step) => {
        const iteration = allResults.length + 1;

        // Use the coder prompt to implement this step
        const client = pooledClient();
        const completion = await client.chat.completions.create({
          model: jarvisConfig.llmModel,
          messages: [
            {
              role: "system",
              content: coderPromptV2({ extraSystemPrompt }),
            },
            {
              role: "user",
              content: [
                `Plan: ${plan.title}`,
                `Current Step: ${step.id} - ${step.description}`,
                `Step ${iteration} of ${steps.length}`,
                `Workspace: ${workspaceId}`,
                `User Prompt: ${prompt}`,
                `Answers: ${JSON.stringify(answers)}`,
                `Extra Instructions: ${extraSystemPrompt || "(none)"}`,
                "",
                `## CONTEXT (working + project):`,
                contextPrompt,
              ].join("\n\n"),
            },
          ],
          temperature: 0.2,
          max_tokens: 6000,
          response_format: { type: "json_object" as const },
        });

        const raw = completion.choices[0]?.message?.content?.trim() ?? "";
        let parsed: { files?: Record<string, string>; notes?: string } | null = null;
        try { parsed = JSON.parse(raw); } catch { /* ignore */ }

        const filesChanged: string[] = [];
        if (parsed?.files) {
          for (const [relPath, content] of Object.entries(parsed.files)) {
            const safePath = safeWorkspacePath(relPath, workspaceId);
            if (!safePath) continue;
            await writeWorkspaceFile(relPath, content, workspaceId);
            filesChanged.push(relPath);
          }
        }
        await logBuildEvent(projectId, "tool_result", `Step ${step.id} ${filesChanged.length > 0 ? "wrote" : "completed"}: ${filesChanged.length} file(s)`, { data: { filesChanged }, step: step.id });
        // Verify this step if workspace has checks
        let feedback: string | undefined;
        if (hasIsolated(projectId)) {
          try {
            await logBuildEvent(projectId, "verify_start", `Verification for step ${step.id}`, { step: step.id });
            const verify = await verifyWorkspace(projectId, workspaceId);
            if (!verify.ok) {
              feedback = formatVerificationFeedback(verify);
              await logBuildEvent(projectId, "verify_result", `Step ${step.id} verification failed`, { data: { ok: false, feedback: feedback?.slice(0, 400) }, step: step.id });
              // Retry with feedback if failed
              for (let retry = 0; retry < maxRetries && !verify.ok; retry++) {
                await new Promise(r => setTimeout(r, 1000 * (retry + 1)));
                const retryResult = await verifyWorkspace(projectId, workspaceId);
                if (retryResult.ok) {
                  feedback = undefined;
                  await logBuildEvent(projectId, "verify_result", `Step ${step.id} verification passed after retry ${retry + 1}`, { data: { ok: true }, step: step.id });
                  break;
                }
              }
            } else {
              await logBuildEvent(projectId, "verify_result", `Step ${step.id} verification passed`, { data: { ok: true }, step: step.id });
            }
          } catch { /* no checks configured */ }
        }

        return { stepId: step.id, ok: !feedback, filesChanged, feedback };
      }));

      for (const result of batchResults) {
        allResults.push(result);
        // Phase 3.1: Record step in working context
        recordStep(projectId, {
          stepId: result.stepId,
          description: steps.find(s => s.id === result.stepId)?.description ?? result.stepId,
          ok: result.ok,
          filesChanged: result.filesChanged,
          notes: result.feedback,
        });
        if (!result.ok) overallOk = false;
      }

      await logBuildEvent(projectId, "step_start", `Batch ${batchIndex + 1}/${batches.length} complete`, { data: { steps: batch.map(s => s.id), overallOk: allResults.slice(-batch.length).every(r => r.ok) }, step: `batch-${batchIndex + 1}` });
      // If any step in batch failed and we shouldn't continue, stop
      if (!overallOk && req.body?.failFast) break;
    }

    // Final checkpoint
    if (hasIsolated(projectId)) {
      await commitIteration(projectId, allResults.length, steps.length, "plan execution complete");
    }
    await saveCheckpoint({
      projectId,
      iteration: allResults.length,
      completed: overallOk ? 1 : 0,
      plan: { title: plan.title, summary: plan.summary, steps: plan.steps, files: plan.files, risks: plan.risks },
      completedSteps: allResults.map(r => ({ step: r.stepId, done: r.ok, filesChanged: r.filesChanged, feedback: r.feedback })),
      workingContext: { prompt, workspaceId },
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
    });
    // Phase 3.2: Log build activity
    await logActivity(projectId, "agent_ran", `Build plan executed: ${plan.title} — ${allResults.length} steps, ${overallOk ? "success" : "partial"}`);
    res.json({ ok: overallOk, results: allResults, batches: batches.length });
  } catch (err) {
    req.log.error({ err }, "Plan execution failed");
    res.status(500).json({ error: "Plan execution failed" });
  }
});

/**
 * Phase 3.1: Smart Working Context — Get the current context for a build project.
 */
router.get("/build/context/:projectId", async (req, res) => {
  const projectId = cleanText(req.params.projectId as string, 64);
  const workspaceId = cleanText(req.query.workspaceId, 64) || projectId;
  try {
    const ctx = getWorkingContext(projectId);
    if (req.query.refresh === "true") {
      await refreshFileMap(projectId, workspaceId);
    }
    const serialized = serializeContext(projectId);
    res.json({
      ok: true,
      projectGoal: ctx.projectGoal,
      completedSteps: ctx.completedSteps,
      keyDecisions: ctx.keyDecisions,
      errorPatterns: ctx.errorPatterns,
      tokenBudget: ctx.tokenBudget,
      fileMapSize: ctx.fileMap.size,
      compactedSummary: ctx.compactedSummary,
      prompt: serialized,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get build context");
    res.status(500).json({ error: "Failed to get build context" });
  }
});

/**
 * Phase 3.1: Update project goal for a build project.
 */
router.post("/build/context/goal", async (req, res) => {
  const projectId = cleanText(req.body?.projectId, 64);
  const goal = cleanText(req.body?.goal, 500);
  if (!projectId || !goal) {
    res.status(400).json({ error: "projectId and goal are required" });
    return;
  }
  try {
    setProjectGoal(projectId, goal);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to set project goal");
    res.status(500).json({ error: "Failed to set project goal" });
  }
});

/**
 * Phase 3.1: Record a decision made during the build.
 */
router.post("/build/context/decision", async (req, res) => {
  const projectId = cleanText(req.body?.projectId, 64);
  const decision = cleanText(req.body?.decision, 500);
  const rationale = cleanText(req.body?.rationale, 500);
  if (!projectId || !decision) {
    res.status(400).json({ error: "projectId and decision are required" });
    return;
  }
  try {
    const entry = recordDecision(projectId, decision, rationale);
    res.json({ ok: true, decision: entry });
  } catch (err) {
    req.log.error({ err }, "Failed to record decision");
    res.status(500).json({ error: "Failed to record decision" });
  }
});

/**
 * Phase 3.1: Record an error pattern and its resolution.
 */
router.post("/build/context/error-pattern", async (req, res) => {
  const projectId = cleanText(req.body?.projectId, 64);
  const pattern = cleanText(req.body?.pattern, 500);
  const resolution = cleanText(req.body?.resolution, 500);
  if (!projectId || !pattern) {
    res.status(400).json({ error: "projectId and pattern are required" });
    return;
  }
  try {
    const entry = recordErrorPattern(projectId, pattern, resolution);
    res.json({ ok: true, pattern: entry });
  } catch (err) {
    req.log.error({ err }, "Failed to record error pattern");
    res.status(500).json({ error: "Failed to record error pattern" });
  }
});

/**
 * Phase 3.1: Track token usage for budget monitoring.
 */
router.post("/build/context/tokens", async (req, res) => {
  const projectId = cleanText(req.body?.projectId, 64);
  const tokens = Math.max(0, Number(req.body?.tokens) || 0);
  if (!projectId) {
    res.status(400).json({ error: "projectId is required" });
    return;
  }
  try {
    const budget = trackTokens(projectId, tokens);
    res.json({ ok: true, used: budget.used, limit: budget.limit, exhausted: budget.used >= budget.limit });
  } catch (err) {
    req.log.error({ err }, "Failed to track tokens");
    res.status(500).json({ error: "Failed to track tokens" });
  }
});

router.post("/build/preview/agent", async (req, res) => {
  const sessionId = cleanText(req.body?.sessionId, 100) || "studio-preview";
  const workspaceId = cleanText(req.body?.workspaceId, 64) || "default";
  const goal = cleanText(req.body?.goal, 1200);
  const port = Number(req.body?.port);
  const maxSteps = Math.min(10, Math.max(1, Number(req.body?.maxSteps) || 6));
  const extraSystemPrompt = cleanText(req.body?.extraSystemPrompt, 4000);
  const preview = findPreview(workspaceId, sessionId);
  if (!goal) {
    res.status(400).json({ error: "A goal is required" });
    return;
  }
  if (!preview || preview.port !== port || !Number.isInteger(port) || port < 1024 || port > 65535) {
    res.status(400).json({ error: "Start the local preview before asking Jarvis to interact with it" });
    return;
  }

  const events: Array<{ type: "inspect" | "decision" | "action" | "error" | "complete"; message: string; step?: number }> = [];
  const consoleErrors: string[] = [];
  let page: Page | null = null;
  try {
    const browser = await getScreenshotBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      try {
        const requestUrl = request.url();
        const parsed = new URL(requestUrl);
        if (request.isNavigationRequest() && request.frame() === page?.mainFrame() && !localPreviewUrl(requestUrl, port)) {
          void request.abort();
          return;
        }
      } catch {
        void request.abort();
        return;
      }
      void request.continue();
    });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
    });
    page.on("pageerror", (error: any) => consoleErrors.push(String(error?.message ?? error).slice(0, 500)));
    const url = `http://127.0.0.1:${port}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    events.push({ type: "inspect", message: "Opened the local preview and inspected its interactive elements." });

    let summary = "The agent stopped before completing the goal.";
    let completed = false;
    for (let step = 1; step <= maxSteps; step += 1) {
      const elements = await inspectPreviewPage(page);
      const decisionPrompt = [
        `Goal: ${goal}`,
        `Step: ${step} of ${maxSteps}`,
        `Interactive elements (use the numeric id, never invent selectors): ${JSON.stringify(elements)}`,
        `Recent browser console errors: ${JSON.stringify(consoleErrors.slice(-8))}`,
        "Choose the next smallest useful action. Return JSON only: {done:boolean,message:string,actions:[{action:'click'|'type'|'select'|'press'|'wait'|'done',id?,text?,value?,key?,milliseconds?}]}",
        "Use type only for visible text inputs, never password fields. Use click for buttons and submit controls. Stop with done true when the goal is satisfied or cannot be safely completed.",
      ].join("\\n");
      const completion = await pooledClient().chat.completions.create({
        model: jarvisConfig.llmModel,
        messages: [
          {
            role: "system",
            content: withExtraBuildInstructions(
              "You control a website preview inside a local IDE. You must reason from the supplied element inventory, act only on the local page, and never claim success without checking the resulting state. Return valid JSON only. Never use the em dash character.",
              extraSystemPrompt,
            ),
          },
          { role: "user", content: decisionPrompt },
        ],
        temperature: 0.1,
        max_tokens: 700,
      });
      const decision = parsePreviewAgentDecision(completion.choices[0]?.message?.content?.trim() ?? "");
      if (!decision) {
        summary = "Jarvis could not produce a valid browser action plan.";
        events.push({ type: "error", step, message: summary });
        break;
      }
      summary = decision.message || summary;
      events.push({ type: "decision", step, message: decision.message || `Planning step ${step}.` });
      if (decision.done || decision.actions.length === 0) {
        completed = decision.done;
        break;
      }
      for (const action of decision.actions) {
        if (action.action === "done") {
          completed = true;
          break;
        }
        try {
          const message = await runPreviewAgentAction(page, action);
          events.push({ type: "action", step, message });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Browser action failed";
          events.push({ type: "error", step, message });
        }
      }
      if (completed) break;
    }
    events.push({ type: "complete", message: completed ? "The browser goal was completed." : summary });
    res.json({ ok: true, completed, summary, events, consoleErrors: [...new Set(consoleErrors)].slice(-12), elements: page ? await inspectPreviewPage(page) : [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preview agent failed";
    events.push({ type: "error", message });
    res.status(500).json({ error: message, events, consoleErrors: [...new Set(consoleErrors)].slice(-12) });
  } finally {
    await page?.close().catch(() => undefined);
  }
});

router.post("/build/walkthrough", async (req, res) => {
  const workspaceId = cleanText(req.body?.workspaceId, 64) || "default";
  const sessionId = cleanText(req.body?.sessionId, 100) || "studio-preview";
  const port = Number(req.body?.port);
  const preview = findPreview(workspaceId, sessionId);
  if (!preview || preview.port !== port || !Number.isInteger(port) || port < 1024 || port > 65535) {
    res.status(400).json({ error: "Start the local preview before running a walkthrough" });
    return;
  }

  const errors: string[] = [];
  const screenshotKeys: string[] = [];
  let page: Page | null = null;
  try {
    const browser = await getScreenshotBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      try {
        const requestUrl = request.url();
        if (request.isNavigationRequest() && request.frame() === page?.mainFrame() && !localPreviewUrl(requestUrl, port)) {
          void request.abort();
          return;
        }
      } catch {
        void request.abort();
        return;
      }
      void request.continue();
    });
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`Console error: ${message.text().slice(0, 500)}`);
    });
    page.on("pageerror", (error: Error) => errors.push(`Page error: ${error.message.slice(0, 500)}`));
    page.on("requestfailed", (request) => errors.push(`Request failed: ${request.method()} ${request.url().slice(0, 300)} (${request.failure()?.errorText ?? "unknown"})`));
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "domcontentloaded", timeout: 20_000 });

    const screenshot = await page.screenshot({ type: "png" });
    const stored = await persistFile({ data: Buffer.from(screenshot), mimeType: "image/png", name: `walkthrough-${workspaceId}-${Date.now()}.png`, kind: "image", owner: "user" });
    if (stored?.url) screenshotKeys.push(stored.url);

    const elements: Array<{ index: number; tag: string; text: string; disabled: boolean; href: string }> = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("button, a, input, textarea, select, [role=button]")) as Array<any>;
      return nodes.map((element, index) => {
        element.setAttribute("data-jarvis-walkthrough-id", String(index));
        return {
          index,
          tag: String(element.tagName).toLowerCase(),
          text: String(element.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 160),
          disabled: element.disabled === true,
          href: String(element.tagName).toLowerCase() === "a" ? String(element.getAttribute("href") ?? "") : "",
        };
      }).slice(0, 120);
    });

    for (const element of elements) {
      if (element.disabled || element.href && !element.href.startsWith("#")) continue;
      try {
        await page.$eval(`[data-jarvis-walkthrough-id="${element.index}"]`, (node) => {
          const tag = node.tagName.toLowerCase();
          if (tag === "input" || tag === "textarea" || tag === "select") return;
          (node as any).click();
        });
        await new Promise((resolve) => setTimeout(resolve, 140));
      } catch (error) {
        errors.push(`Interactive element ${element.index} (${element.tag} ${element.text || "untitled"}) failed: ${error instanceof Error ? error.message : "click failed"}`);
      }
    }

    const reportPath = path.join(WORKSPACE_ROOT, "full-walktrough.md");
    const timestamp = new Date().toISOString().replace("T", " ").replace("Z", " UTC");
    const uniqueErrors = [...new Set(errors)];
    const lines = [
      "",
      "--------------------------------------------------",
      `WALKTHROUGH SESSION START: ${timestamp}`,
      "--------------------------------------------------",
      ...uniqueErrors.map((error) => `- [ERROR] ${error}`),
      ...(uniqueErrors.length === 0 ? ["- No unexpected interactive errors observed."] : []),
      ...(screenshotKeys.length > 0 ? [`- Screenshot evidence: ${screenshotKeys.join(", ")}`] : []),
      "==================================================",
      "",
    ];
    await ensureWorkspace(workspaceId);
    await fs.appendFile(reportPath, lines.join("\\n"), "utf8");
    res.json({ ok: true, errors: uniqueErrors, reportPath: "full-walktrough.md", screenshotUrls: screenshotKeys, testedElements: elements.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Walkthrough failed";
    res.status(500).json({ error: message, errors });
  } finally {
    await page?.close().catch(() => undefined);
  }
});

router.post("/build/screenshot", async (req, res) => {
  const sessionId = cleanText(req.body?.sessionId, 100) || "studio-preview";
  const workspaceId = cleanText(req.body?.workspaceId, 64) || "default";
  const requestedUrl = cleanText(req.body?.url, 500);
  const url = requestedUrl && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(requestedUrl)
    ? requestedUrl
    : previewUrlFor(workspaceId, sessionId, Number.isInteger(req.body?.port) ? Number(req.body.port) : null);
  if (!url) {
    res.status(400).json({ error: "No preview is running for this workspace" });
    return;
  }
  const requestedViewports: unknown[] = Array.isArray(req.body?.viewports) ? req.body.viewports : ["desktop"];
  const viewports: ScreenshotViewport[] = [...new Set(
    requestedViewports.filter((value): value is ScreenshotViewport => value === "desktop" || value === "mobile"),
  )];
  if (viewports.length === 0) {
    res.status(400).json({ error: "At least one supported screenshot viewport is required" });
    return;
  }
  const screenshots: Partial<Record<ScreenshotViewport, { url: string; dataUrl: string }>> = {};
  for (const viewport of viewports) {
    const shot = await capturePreviewPng(url, workspaceId, viewport);
    if (!shot) {
      res.status(500).json({ error: `${viewport} screenshot failed, the headless browser is unavailable` });
      return;
    }
    screenshots[viewport] = shot;
  }
  const desktop = screenshots.desktop;
  res.json({ ok: true, url: desktop?.url ?? screenshots.mobile?.url ?? "", dataUrl: desktop?.dataUrl ?? screenshots.mobile?.dataUrl ?? "", screenshots });
});

router.post("/build/preview/start", async (req, res) => {
  const sessionId = cleanText(req.body?.sessionId, 100) || "default";
  const workspaceId = cleanText(req.body?.workspaceId, 64) || "default";
  const command = cleanText(req.body?.command, 500);
  const port = Number(req.body?.port);
  if (!command || !Number.isInteger(port) || port < 1024 || port > 65535) {
    res.status(400).json({ error: "A command and valid preview port (1024-65535) are required" });
    return;
  }
  await ensureWorkspace(workspaceId);
  const key = previewKey(workspaceId, sessionId);
  const previous = previewProcesses.get(key);
  previous?.child.kill("SIGTERM");
  const env = await readWorkspaceEnv(workspaceId);
  const child = spawn("/bin/bash", ["-lc", command], {
    cwd: getSessionCwd(sessionId, workspaceId),
    env: getWorkspaceCommandEnvironment({ ...env, PORT: String(port), HOST: "0.0.0.0" }),
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const entry = { child, port, command, output: "" };
  previewProcesses.set(key, entry);
  const collect = (chunk: Buffer) => { entry.output = `${entry.output}${chunk.toString()}`.slice(-12000); };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  child.on("exit", () => { if (previewProcesses.get(key)?.child === child) previewProcesses.delete(key); });
  res.status(201).json({ sessionId, workspaceId, port, url: `http://localhost:${port}`, running: true });
});

router.post("/build/preview/stop", async (req, res) => {
  const sessionId = cleanText(req.body?.sessionId, 100) || "default";
  const workspaceId = cleanText(req.body?.workspaceId, 64) || "default";
  const entry = previewProcesses.get(previewKey(workspaceId, sessionId));
  if (entry) {
    entry.child.kill("SIGTERM");
    previewProcesses.delete(previewKey(workspaceId, sessionId));
  }
  res.json({ ok: true });
});

router.get("/build/preview/status", async (req, res) => {
  const sessionId = cleanText(req.query.sessionId, 100) || "default";
  const workspaceId = cleanText(req.query.workspaceId, 64) || "default";
  const entry = previewProcesses.get(previewKey(workspaceId, sessionId));
  res.json(entry ? { running: true, workspaceId, port: entry.port, command: entry.command, output: entry.output.slice(-4000) } : { running: false, workspaceId });
});

/**
 * Phase 4.3: Resource Limits + Cost Tracking — Budget Management Routes
 */

// GET /build/budget/:projectId — Get budget config and current status
router.get("/build/budget/:projectId", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  try {
    const status = await getBudgetStatus(projectId);
    res.json({ ...status });
  } catch (err) {
    console.error({ err, projectId }, "Failed to get budget status");
    res.status(500).json({ error: "Failed to get budget status" });
  }
});

// PATCH /build/budget/:projectId — Update budget limits
router.patch("/build/budget/:projectId", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  const limits = req.body as Partial<BudgetLimits>;
  if (!limits || typeof limits !== "object") {
    res.status(400).json({ error: "Valid limits object required" });
    return;
  }
  try {
    const updated = await updateBudget(projectId, limits);
    res.json({ ok: true, limits: updated });
  } catch (err) {
    console.error({ err, projectId }, "Failed to update budget");
    res.status(500).json({ error: "Failed to update budget" });
  }
});

// GET /build/budget/:projectId/dashboard — Dashboard stats (today, 7d, 30d, limits)
router.get("/build/budget/:projectId/dashboard", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  try {
    const stats = await getBudgetDashboardStats(projectId);
    res.json({ ok: true, ...stats });
  } catch (err) {
    console.error({ err, projectId }, "Failed to get dashboard stats");
    res.status(500).json({ error: "Failed to get dashboard stats" });
  }
});

// GET /build/budget/:projectId/history — Cost history (paginated)
router.get("/build/budget/:projectId/history", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  try {
    const history = await getCostHistory(projectId, limit, offset);
    res.json({ ok: true, history });
  } catch (err) {
    console.error({ err, projectId }, "Failed to get cost history");
    res.status(500).json({ error: "Failed to get cost history" });
  }
});

// GET /build/budget/:projectId/daily — Daily aggregates (last N days)
router.get("/build/budget/:projectId/daily", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  try {
    const daily = await getDailyAggregates(projectId, days);
    res.json({ ok: true, daily });
  } catch (err) {
    console.error({ err, projectId }, "Failed to get daily aggregates");
    res.status(500).json({ error: "Failed to get daily aggregates" });
  }
});

// POST /build/budget/:projectId/check — Pre-flight budget check
router.post("/build/budget/:projectId/check", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  const { estimatedTokens, estimatedCostCents, estimatedDurationMs } = req.body as {
    estimatedTokens?: number;
    estimatedCostCents?: number;
    estimatedDurationMs?: number;
  };
  if (typeof estimatedTokens !== "number" || typeof estimatedCostCents !== "number" || typeof estimatedDurationMs !== "number") {
    res.status(400).json({ error: "estimatedTokens, estimatedCostCents, estimatedDurationMs required" });
    return;
  }
  try {
    const status = await checkBudgetBeforeBuild(projectId, estimatedTokens, estimatedCostCents, estimatedDurationMs);
    res.json({ ...status });
  } catch (err) {
    console.error({ err, projectId }, "Failed to check budget");
    res.status(500).json({ error: "Failed to check budget" });
  }
});

// POST /build/budget/:projectId/record — Record actual cost after a build iteration
router.post("/build/budget/:projectId/record", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  const {
    checkpointId,
    iteration,
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCostCents,
    durationMs,
    limitHit,
    model,
    metadata,
  } = req.body as {
    checkpointId?: string;
    iteration?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    estimatedCostCents?: number;
    durationMs?: number;
    limitHit?: "none" | "tokens" | "cost" | "duration" | "builds";
    model?: string;
    metadata?: Record<string, unknown>;
  };
  if (typeof promptTokens !== "number" || typeof completionTokens !== "number" || typeof estimatedCostCents !== "number" || typeof durationMs !== "number") {
    res.status(400).json({ error: "promptTokens, completionTokens, estimatedCostCents, durationMs required" });
    return;
  }
  try {
    const status = await recordBuildCost({
      projectId,
      checkpointId,
      iteration,
      promptTokens,
      completionTokens,
      totalTokens: totalTokens ?? (promptTokens + completionTokens),
      estimatedCostCents,
      durationMs,
      limitHit,
      model,
      metadata,
    });
    res.json({ ...status });
  } catch (err) {
    console.error({ err, projectId }, "Failed to record build cost");
    res.status(500).json({ error: "Failed to record build cost" });
  }
});

/**
 * Phase 4.1: Workspace Snapshots + One-Click Rollback
 */

// GET /build/snapshots/:projectId — List snapshots (newest first)
router.get("/build/snapshots/:projectId", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  try {
    const snapshots = await listSnapshots(projectId, limit);
    await logBuildEvent(projectId, "snapshot", "Listed snapshots", { data: { count: snapshots.length } });
    res.json({ ok: true, snapshots });
  } catch (err) {
    console.error({ err, projectId }, "Failed to list snapshots");
    res.status(500).json({ error: "Failed to list snapshots" });
  }
});

// POST /build/snapshots/:projectId — Create a snapshot on demand
router.post("/build/snapshots/:projectId", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  const checkpointId = cleanText(req.body?.checkpointId, 36) || null;
  const iteration = Number(req.body?.iteration) || 0;
  try {
    await logBuildEvent(projectId, "snapshot", `Creating snapshot (checkpoint: ${checkpointId ?? "none"}, iteration: ${iteration})`, { data: { checkpointId, iteration } });
    const meta = await createSnapshot(projectId, checkpointId, iteration);
    if (!meta) {
      await logBuildEvent(projectId, "error", "Snapshot creation failed", { data: { checkpointId, iteration } });
      res.status(500).json({ error: "Snapshot creation failed" });
      return;
    }
    const { writeSnapshotSidecar } = await import("../../lib/workspace-snapshots");
    await writeSnapshotSidecar(meta);
    if (checkpointId) await snapshotAfterCheckpoint(projectId, checkpointId, iteration);
    await logBuildEvent(projectId, "snapshot", `Snapshot created: ${meta.id}`, { data: { snapshotId: meta.id, size: meta.sizeBytes, path: meta.path } });
    res.json({ ok: true, snapshot: meta });
  } catch (err) {
    console.error({ err, projectId }, "Failed to create snapshot");
    await logBuildEvent(projectId, "error", "Snapshot creation failed", { data: { message: err instanceof Error ? err.message : String(err), checkpointId, iteration } });
    res.status(500).json({ error: "Failed to create snapshot" });
  }
});

// POST /build/snapshots/:projectId/:snapshotId/restore — Restore a snapshot to workspace
router.post("/build/snapshots/:projectId/:snapshotId/restore", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 64);
  const snapshotId = cleanText(req.params.snapshotId, 36);
  if (!projectId || !snapshotId) {
    res.status(400).json({ error: "projectId and snapshotId required" });
    return;
  }
  try {
    await logBuildEvent(projectId, "snapshot", `Restoring snapshot: ${snapshotId}`, { data: { snapshotId } });
    const ok = await restoreSnapshot(projectId, snapshotId);
    if (!ok) {
      await logBuildEvent(projectId, "error", "Restore failed", { data: { snapshotId } });
      res.status(500).json({ error: "Restore failed" });
      return;
    }
    await logBuildEvent(projectId, "snapshot", `Snapshot restored: ${snapshotId}`, { data: { snapshotId } });
    res.json({ ok: true, message: "Snapshot restored to workspace" });
  } catch (err) {
    console.error({ err, projectId, snapshotId }, "Failed to restore snapshot");
    await logBuildEvent(projectId, "error", "Snapshot restore failed", { data: { snapshotId, message: err instanceof Error ? err.message : String(err) } });
    res.status(500).json({ error: "Failed to restore snapshot" });
  }
});

// DELETE /build/snapshots/:projectId/:snapshotId — Delete a snapshot
router.delete("/build/snapshots/:projectId/:snapshotId", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 64);
  const snapshotId = cleanText(req.params.snapshotId, 36);
  if (!projectId || !snapshotId) {
    res.status(400).json({ error: "projectId and snapshotId required" });
    return;
  }
  try {
    await logBuildEvent(projectId, "snapshot", `Deleting snapshot: ${snapshotId}`, { data: { snapshotId } });
    const ok = await deleteSnapshot(projectId, snapshotId);
    await logBuildEvent(projectId, "snapshot", `Snapshot deleted: ${snapshotId}`, { data: { snapshotId, deleted: ok } });
    res.json({ ok: true, deleted: ok });
  } catch (err) {
    console.error({ err, projectId, snapshotId }, "Failed to delete snapshot");
    await logBuildEvent(projectId, "error", "Snapshot delete failed", { data: { snapshotId, message: err instanceof Error ? err.message : String(err) } });
    res.status(500).json({ error: "Failed to delete snapshot" });
  }
});

/**
 * Phase 4.2: Browser Pool
 */

let browserPoolInstance: BrowserPool | null = null;

// Initialize browser pool on first use
function getBrowserPoolInstance(): BrowserPool {
  if (!browserPoolInstance) {
    browserPoolInstance = getBrowserPool({ minSize: 3, maxSize: 5 });
    browserPoolInstance.initialize().catch((err) => console.error({ err }, "Browser pool init failed"));
  }
  return browserPoolInstance;
}

// GET /build/browser/pool/status — Get pool status
router.get("/build/browser/pool/status", async (req, res) => {
  try {
    const pool = getBrowserPoolInstance();
    const status = pool.getStatus();
    const config = pool.getConfig();
    const total = status.length;
    const available = status.filter(s => s.state === "idle").length;
    await logBuildEvent("default", "info", "Browser pool status queried", { data: { total, available } });
    res.json({ ok: true, status, config: { minSize: config.minSize, maxSize: config.maxSize } });
  } catch (err) {
    console.error({ err }, "Failed to get browser pool status");
    res.status(500).json({ error: "Failed to get browser pool status" });
  }
});

// POST /build/browser/pool/acquire — Acquire a browser for a task
router.post("/build/browser/pool/acquire", async (req, res) => {
  const taskId = cleanText(req.body?.taskId, 64) || `task-${Date.now()}`;
  try {
    const pool = getBrowserPoolInstance();
    await logBuildEvent("default", "tool_call", `Browser acquired for task: ${taskId}`, { data: { taskId } });
    const slot = await pool.acquire(taskId);
    await logBuildEvent("default", "tool_result", `Browser ${slot.id} acquired (state: ${slot.state})`, { data: { taskId, browserId: slot.id, wsPort: slot.wsPort } });
    res.json({ ok: true, browser: { id: slot.id, wsPort: slot.wsPort, state: slot.state } });
  } catch (err) {
    console.error({ err, taskId }, "Failed to acquire browser");
    await logBuildEvent("default", "error", "Browser acquire failed", { data: { taskId, message: err instanceof Error ? err.message : String(err) } });
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /build/browser/pool/release — Release a browser
router.post("/build/browser/pool/release", async (req, res) => {
  const browserId = cleanText(req.body?.browserId, 64);
  if (!browserId) {
    res.status(400).json({ error: "browserId required" });
    return;
  }
  try {
    const pool = getBrowserPoolInstance();
    await logBuildEvent("default", "tool_call", `Releasing browser: ${browserId}`, { data: { browserId } });
    const ok = pool.release(browserId);
    await logBuildEvent("default", "tool_result", `Browser ${browserId} released (ok: ${ok})`, { data: { browserId, released: ok } });
    res.json({ ok: true, released: ok });
  } catch (err) {
    console.error({ err, browserId }, "Failed to release browser");
    await logBuildEvent("default", "error", "Browser release failed", { data: { browserId, message: err instanceof Error ? err.message : String(err) } });
    res.status(500).json({ error: "Failed to release browser" });
  }
});

// POST /build/browser/:browserId/navigate — Navigate a browser to a URL
router.post("/build/browser/:browserId/navigate", async (req, res) => {
  const browserId = cleanText(req.params.browserId, 64);
  const url = cleanText(req.body?.url, 2048);
  if (!browserId || !url) {
    res.status(400).json({ error: "browserId and url required" });
    return;
  }
  try {
    await logBuildEvent("default", "tool_call", `Navigating browser ${browserId} to ${url}`, { data: { browserId, url } });
    const pool = getBrowserPoolInstance();
    const result = await pool.navigate(browserId, url);
    await logBuildEvent("default", "tool_result", `Browser ${browserId} navigated`, { data: { browserId, url, ok: result.success } });
    res.json(result);
  } catch (err) {
    console.error({ err, browserId, url }, "Navigate failed");
    await logBuildEvent("default", "error", "Browser navigate failed", { data: { browserId, url, message: err instanceof Error ? err.message : String(err) } });
    res.status(500).json({ error: "Navigate failed" });
  }
});

// POST /build/browser/:browserId/action — Execute an action on a browser
router.post("/build/browser/:browserId/action", async (req, res) => {
  const browserId = cleanText(req.params.browserId, 64);
  const action = req.body?.action as any;
  if (!browserId || !action) {
    res.status(400).json({ error: "browserId and action required" });
    return;
  }
  try {
    await logBuildEvent("default", "tool_call", `Browser ${browserId} action: ${action.type}`, { data: { browserId, actionType: action.type } });
    const pool = getBrowserPoolInstance();
    const result = await pool.executeAction(browserId, action);
    await logBuildEvent("default", "tool_result", `Browser ${browserId} action completed`, { data: { browserId, actionType: action.type, ok: result.success } });
    res.json(result);
  } catch (err) {
    console.error({ err, browserId, action }, "Action failed");
    await logBuildEvent("default", "error", "Browser action failed", { data: { browserId, actionType: action?.type, message: err instanceof Error ? err.message : String(err) } });
    res.status(500).json({ error: "Action failed" });
  }
});

// GET /build/browser/:browserId/state — Get browser state
router.get("/build/browser/:browserId/state", async (req, res) => {
  const browserId = cleanText(req.params.browserId, 64);
  if (!browserId) {
    res.status(400).json({ error: "browserId required" });
    return;
  }
  try {
    const pool = getBrowserPoolInstance();
    const state = pool.getState(browserId);
    res.json({ ok: true, state });
  } catch (err) {
    console.error({ err, browserId }, "Failed to get browser state");
    res.status(500).json({ error: "Failed to get browser state" });
  }
});

// POST /build/browser/:browserId/screenshot — Take a grid screenshot
router.post("/build/browser/:browserId/screenshot", async (req, res) => {
  const browserId = cleanText(req.params.browserId, 64);
  const cellSize = Number(req.body?.cellSize) || 24;
  if (!browserId) {
    res.status(400).json({ error: "browserId required" });
    return;
  }
  try {
    await logBuildEvent("default", "tool_call", `Browser ${browserId} grid screenshot`, { data: { browserId, cellSize } });
    const pool = getBrowserPoolInstance();
    const result = await pool.takeGridScreenshot(browserId, cellSize);
    await logBuildEvent("default", "tool_result", `Browser ${browserId} screenshot captured`, { data: { browserId, ok: result.success } });
    res.json(result);
  } catch (err) {
    console.error({ err, browserId }, "Screenshot failed");
    await logBuildEvent("default", "error", "Browser screenshot failed", { data: { browserId, message: err instanceof Error ? err.message : String(err) } });
    res.status(500).json({ error: "Screenshot failed" });
  }
});

// POST /build/browser/:browserId/elements — Get interactive elements
router.post("/build/browser/:browserId/elements", async (req, res) => {
  const browserId = cleanText(req.params.browserId, 64);
  const maxItems = Math.min(Number(req.body?.maxItems) || 30, 100);
  if (!browserId) {
    res.status(400).json({ error: "browserId required" });
    return;
  }
  try {
    const pool = getBrowserPoolInstance();
    const result = await pool.getInteractiveElements(browserId, maxItems);
    await logBuildEvent("default", "tool_result", `Browser ${browserId} elements retrieved`, { data: { browserId, count: result.data?.length ?? 0, ok: result.success } });
    res.json(result);
  } catch (err) {
    console.error({ err, browserId }, "Get elements failed");
    await logBuildEvent("default", "error", "Get elements failed", { data: { browserId, message: err instanceof Error ? err.message : String(err) } });
    res.status(500).json({ error: "Get elements failed" });
  }
});

// GET /build/browser/:browserId/captcha — Check for captcha
router.get("/build/browser/:browserId/captcha", async (req, res) => {
  const browserId = cleanText(req.params.browserId, 64);
  if (!browserId) {
    res.status(400).json({ error: "browserId required" });
    return;
  }
  try {
    const pool = getBrowserPoolInstance();
    const result = await pool.hasCaptcha(browserId);
    res.json(result);
  } catch (err) {
    console.error({ err, browserId }, "Captcha check failed");
    res.status(500).json({ error: "Captcha check failed" });
  }
});

// POST /build/browser/:browserId/accessibility — Capture accessibility tree
router.post("/build/browser/:browserId/accessibility", async (req, res) => {
  const browserId = cleanText(req.params.browserId, 64);
  if (!browserId) {
    res.status(400).json({ error: "browserId required" });
    return;
  }
  try {
    const pool = getBrowserPoolInstance();
    const snapshot = await pool.captureAccessibility(browserId);
    res.json({ ok: true, snapshot });
  } catch (err) {
    console.error({ err, browserId }, "Accessibility capture failed");
    res.status(500).json({ error: "Accessibility capture failed" });
  }
});

// POST /build/browser/pool/scale — Scale pool size
router.post("/build/browser/pool/scale", async (req, res) => {
  const min = Math.max(1, Math.min(Number(req.body?.min) || 3, 10));
  const max = Math.max(min, Math.min(Number(req.body?.max) || 5, 10));
  try {
    const pool = getBrowserPoolInstance();
    await logBuildEvent("default", "info", `Browser pool scaled to min=${min}, max=${max}`, { data: { min, max } });
    await pool.setSize(min, max);
    res.json({ ok: true, config: { minSize: min, maxSize: max } });
  } catch (err) {
    console.error({ err }, "Scale pool failed");
    await logBuildEvent("default", "error", "Browser pool scale failed", { data: { min, max, message: err instanceof Error ? err.message : String(err) } });
    res.status(500).json({ error: "Scale pool failed" });
  }
});

/**
 * Phase 4.4: Command Palette + Keyboard Mastery — Server-side Actions
 *
 * These endpoints back the client-side command palette with server-side actions
 * that can run longer operations (checkpoint, rollback, export, browser control).
 */

// POST /build/command/:projectId/create-checkpoint — Create a checkpoint with snapshot
router.post("/build/command/:projectId/create-checkpoint", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  try {
    const { saveCheckpoint } = await import("../../lib/build-checkpoints");
    const { snapshotAfterCheckpoint } = await import("../../lib/workspace-snapshots");
    const ctx = getWorkingContext(projectId);
    const completedSteps = ctx.completedSteps.map((s) => ({
      stepId: s.stepId,
      description: s.description,
      ok: s.ok,
      filesChanged: s.filesChanged,
      timestamp: s.timestamp,
      notes: s.notes,
    }));
    await logBuildEvent(projectId, "checkpoint", "Creating checkpoint via command palette", { data: { iteration: ctx.completedSteps.length + 1, completedSteps: completedSteps.length } });
    const checkpointId = await saveCheckpoint({
      projectId,
      iteration: ctx.completedSteps.length + 1,
      completed: 0,
      plan: ctx.projectGoal ? { title: ctx.projectGoal } : {},
      completedSteps,
      workingContext: {
        fileMap: Object.fromEntries(ctx.fileMap),
        keyDecisions: ctx.keyDecisions,
        errorPatterns: ctx.errorPatterns,
        tokenBudget: ctx.tokenBudget,
      },
      fileSnapshots: {},
      tokenUsage: { ...ctx.tokenBudget, history: ctx.tokenBudget.history.slice(-10) },
    });
    await snapshotAfterCheckpoint(projectId, checkpointId, ctx.completedSteps.length + 1);
    await logBuildEvent(projectId, "checkpoint", "Checkpoint created with snapshot", { data: { checkpointId, iteration: ctx.completedSteps.length + 1 } });
    res.json({ ok: true, checkpointId, message: "Checkpoint created with snapshot" });
  } catch (err) {
    console.error({ err, projectId }, "Create checkpoint failed");
    await logBuildEvent(projectId, "error", "Create checkpoint failed", { data: { message: err instanceof Error ? err.message : String(err) } });
    res.status(500).json({ error: "Create checkpoint failed" });
  }
});

// POST /build/command/:projectId/rollback — Rollback to previous iteration
router.post("/build/command/:projectId/rollback", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  const snapshotId = cleanText(req.body?.snapshotId, 36);
  try {
    const { rollbackIteration } = await import("../../lib/workspace");
    const { restoreSnapshot } = await import("../../lib/workspace-snapshots");
    if (snapshotId) {
      await logBuildEvent(projectId, "snapshot", `Rolling back via snapshot: ${snapshotId}`, { data: { snapshotId } });
      const ok = await restoreSnapshot(projectId, snapshotId);
      if (!ok) {
        await logBuildEvent(projectId, "error", "Snapshot restore failed", { data: { snapshotId } });
        res.status(500).json({ error: "Snapshot restore failed" });
        return;
      }
      await logBuildEvent(projectId, "snapshot", "Restored from snapshot", { data: { snapshotId } });
    } else {
      await logBuildEvent(projectId, "checkpoint", "Rolling back one iteration", { data: {} });
      await rollbackIteration(projectId);
      await logBuildEvent(projectId, "checkpoint", "Rolled back one iteration", { data: {} });
    }
    res.json({ ok: true, message: snapshotId ? "Restored from snapshot" : "Rolled back one iteration" });
  } catch (err) {
    console.error({ err, projectId }, "Rollback failed");
    await logBuildEvent(projectId, "error", "Rollback failed", { data: { message: err instanceof Error ? err.message : String(err) } });
    res.status(500).json({ error: "Rollback failed" });
  }
});

// POST /build/command/:projectId/export — Export workspace as ZIP
router.post("/build/command/:projectId/export", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  try {
    const { createSnapshot } = await import("../../lib/workspace-snapshots");
    await logBuildEvent(projectId, "snapshot", "Exporting workspace as snapshot", { data: {} });
    const meta = await createSnapshot(projectId, null, 0);
    if (!meta) {
      await logBuildEvent(projectId, "error", "Export failed", { data: {} });
      res.status(500).json({ error: "Export failed" });
      return;
    }
    await logBuildEvent(projectId, "snapshot", "Workspace exported", { data: { snapshotId: meta.id, path: meta.path } });
    // Return the snapshot path for the client to download
    res.json({ ok: true, snapshotId: meta.id, path: meta.path, message: "Workspace exported" });
  } catch (err) {
    console.error({ err, projectId }, "Export failed");
    await logBuildEvent(projectId, "error", "Export failed", { data: { message: err instanceof Error ? err.message : String(err) } });
    res.status(500).json({ error: "Export failed" });
  }
});

// POST /build/command/:projectId/refresh-files — Refresh file map
router.post("/build/command/:projectId/refresh-files", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  try {
    const { refreshFileMap } = await import("../../lib/build-context");
    await logBuildEvent(projectId, "info", "Refreshing file map", { data: {} });
    const fileMap = await refreshFileMap(projectId);
    await logBuildEvent(projectId, "info", "File map refreshed", { data: { count: fileMap.size } });
    res.json({ ok: true, count: fileMap.size, message: "File map refreshed" });
  } catch (err) {
    console.error({ err, projectId }, "Refresh files failed");
    await logBuildEvent(projectId, "error", "Refresh files failed", { data: { message: err instanceof Error ? err.message : String(err) } });
    res.status(500).json({ error: "Refresh files failed" });
  }
});

// POST /build/command/:projectId/browser/open — Acquire browser and navigate
router.post("/build/command/:projectId/browser/open", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 64);
  const url = cleanText(req.body?.url, 2048);
  if (!projectId || !url) {
    res.status(400).json({ error: "projectId and url required" });
    return;
  }
  try {
    await logBuildEvent(projectId, "tool_call", `Opening browser to ${url}`, { data: { url } });
    const pool = getBrowserPoolInstance();
    const slot = await pool.acquire(`build-${projectId}-${Date.now()}`);
    const result = await pool.navigate(slot.id, url);
    await logBuildEvent(projectId, "tool_result", `Browser opened and navigated`, { data: { browserId: slot.id, wsPort: slot.wsPort, ok: result.success } });
    res.json({ ok: true, browserId: slot.id, wsPort: slot.wsPort, ...result });
  } catch (err) {
    console.error({ err, projectId }, "Browser open failed");
    await logBuildEvent(projectId, "error", "Browser open failed", { data: { url, message: err instanceof Error ? err.message : String(err) } });
    res.status(500).json({ error: "Browser open failed" });
  }
});

// POST /build/command/:projectId/browser/close — Release browser
router.post("/build/command/:projectId/browser/close", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 64);
  const browserId = cleanText(req.body?.browserId, 64);
  if (!projectId || !browserId) {
    res.status(400).json({ error: "projectId and browserId required" });
    return;
  }
  try {
    await logBuildEvent(projectId, "tool_call", `Closing browser: ${browserId}`, { data: { browserId } });
    const pool = getBrowserPoolInstance();
    const ok = pool.release(browserId);
    await logBuildEvent(projectId, "tool_result", `Browser closed: ${browserId}`, { data: { browserId, released: ok } });
    res.json({ ok: true, released: ok });
  } catch (err) {
    console.error({ err, projectId }, "Browser close failed");
    await logBuildEvent(projectId, "error", "Browser close failed", { data: { browserId, message: err instanceof Error ? err.message : String(err) } });
    res.status(500).json({ error: "Browser close failed" });
  }
});

// GET /build/command/:projectId/budget/status — Quick budget check
router.get("/build/command/:projectId/budget/status", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  try {
    const { getBudgetStatus } = await import("../../lib/build-budgets");
    const status = await getBudgetStatus(projectId);
    res.json({ ...status });
  } catch (err) {
    console.error({ err, projectId }, "Budget status failed");
    res.status(500).json({ error: "Budget status failed" });
  }
});

// POST /build/command/:projectId/budget/set — Update budget limits
router.post("/build/command/:projectId/budget/set", async (req, res) => {
  const projectId = cleanText(req.params.projectId, 64);
  if (!projectId) {
    res.status(400).json({ error: "projectId required" });
    return;
  }
  const limits = req.body as any;
  try {
    await logBuildEvent(projectId, "info", "Updating budget limits", { data: { limits } });
    const { updateBudget } = await import("../../lib/build-budgets");
    const updated = await updateBudget(projectId, limits);
    await logBuildEvent(projectId, "info", "Budget limits updated", { data: { limits: updated } });
    res.json({ ok: true, limits: updated });
  } catch (err) {
    console.error({ err, projectId }, "Budget update failed");
    await logBuildEvent(projectId, "error", "Budget update failed", { data: { message: err instanceof Error ? err.message : String(err) } });
    res.status(500).json({ error: "Budget update failed" });
  }
});

/**
 * Phase 5.3: Edge Cases — Pre-flight check before build operations
 * GET /api/jarvis/build/preflight/:projectId
 */
router.get("/build/preflight/:projectId", async (req: Request, res: Response) => {
  try {
    const projectId = cleanText(req.params.projectId as string, 64);
    if (!projectId) {
      res.status(400).json({ error: "projectId required" });
      return;
    }
    const requiredDiskBytes = Number(req.query.requiredDiskBytes) || 50 * 1024 * 1024;
    const result = await preflightCheck(projectId, requiredDiskBytes);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Preflight check failed");
    res.status(500).json({ error: "Preflight check failed" });
  }
});

/**
 * Phase 5.3: Edge Cases — Disk space status
 * GET /api/jarvis/build/disk-space/:projectId
 */
router.get("/build/disk-space/:projectId", async (req: Request, res: Response) => {
  try {
    const projectId = cleanText(req.params.projectId as string, 64);
    if (!projectId) {
      res.status(400).json({ error: "projectId required" });
      return;
    }
    const disk = await checkDiskSpace(projectId);
    res.json({ ok: true, ...disk });
  } catch (err) {
    req.log.error({ err }, "Disk space check failed");
    res.status(500).json({ error: "Disk space check failed" });
  }
});

/**
 * Phase 5.3: Edge Cases — Wait for disk space (pause build until space available)
 * POST /api/jarvis/build/wait-disk/:projectId
 */
router.post("/build/wait-disk/:projectId", async (req: Request, res: Response) => {
  try {
    const projectId = cleanText(req.params.projectId as string, 64);
    if (!projectId) {
      res.status(400).json({ error: "projectId required" });
      return;
    }
    const requiredBytes = Number(req.body?.requiredBytes) || 50 * 1024 * 1024;
    const maxWaitMs = Number(req.body?.maxWaitMs) || 300000;
    const result = await waitForDiskSpace(projectId, requiredBytes, maxWaitMs);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Wait for disk space failed");
    res.status(500).json({ error: "Wait for disk space failed" });
  }
});

/**
 * Phase 5.3: Edge Cases — Workspace corruption detection
 * GET /api/jarvis/build/corruption/:projectId
 */
router.get("/build/corruption/:projectId", async (req: Request, res: Response) => {
  try {
    const projectId = cleanText(req.params.projectId as string, 64);
    if (!projectId) {
      res.status(400).json({ error: "projectId required" });
      return;
    }
    const result = await detectWorkspaceCorruption(projectId);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Corruption detection failed");
    res.status(500).json({ error: "Corruption detection failed" });
  }
});

/**
 * Phase 5.3: Edge Cases — Workspace auto-repair
 * POST /api/jarvis/build/repair/:projectId
 */
router.post("/build/repair/:projectId", async (req: Request, res: Response) => {
  try {
    const projectId = cleanText(req.params.projectId as string, 64);
    if (!projectId) {
      res.status(400).json({ error: "projectId required" });
      return;
    }
    const corruption = await detectWorkspaceCorruption(projectId);
    if (!corruption.corrupted) {
      res.json({ ok: true, message: "No corruption detected", repaired: [], failed: [] });
      return;
    }
    const result = await repairWorkspace(projectId, corruption.issues);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Workspace repair failed");
    res.status(500).json({ error: "Workspace repair failed" });
  }
});

/**
 * Phase 5.3: Edge Cases — Git conflict handling
 * POST /api/jarvis/build/git-conflict/:projectId
 */
router.post("/build/git-conflict/:projectId", async (req: Request, res: Response) => {
  try {
    const projectId = cleanText(req.params.projectId as string, 64);
    if (!projectId) {
      res.status(400).json({ error: "projectId required" });
      return;
    }
    const operation = cleanText(req.body?.operation, 100) || "build";
    const result = await handleGitConflict(projectId, operation);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Git conflict handling failed");
    res.status(500).json({ error: "Git conflict handling failed" });
  }
});

/**
 * Phase 5.3: Edge Cases — Build queue status
 * GET /api/jarvis/build/queue/:projectId
 */
router.get("/build/queue/:projectId", async (req: Request, res: Response) => {
  try {
    const projectId = cleanText(req.params.projectId as string, 64);
    if (!projectId) {
      res.status(400).json({ error: "projectId required" });
      return;
    }
    const status = getBuildQueueStatus(projectId);
    res.json({ ...status });
  } catch (err) {
    req.log.error({ err }, "Queue status failed");
    res.status(500).json({ error: "Queue status failed" });
  }
});

/**
 * Phase 5.3: Edge Cases — Edge cases list (unresolved)
 * GET /api/jarvis/build/edge-cases/:projectId
 */
router.get("/build/edge-cases/:projectId", async (req: Request, res: Response) => {
  try {
    const projectId = cleanText(req.params.projectId as string, 64);
    if (!projectId) {
      res.status(400).json({ error: "projectId required" });
      return;
    }
    const edgeCases = await getUnresolvedEdgeCases(projectId);
    res.json({ ok: true, edgeCases });
  } catch (err) {
    req.log.error({ err }, "Edge cases list failed");
    res.status(500).json({ error: "Edge cases list failed" });
  }
});

/**
 * Phase 5.3: Edge Cases — Resolve edge case
 * POST /api/jarvis/build/edge-cases/:projectId/:edgeCaseId/resolve
 */
router.post("/build/edge-cases/:projectId/:edgeCaseId/resolve", async (req: Request, res: Response) => {
  try {
    const projectId = cleanText(req.params.projectId as string, 64);
    const edgeCaseId = cleanText(req.params.edgeCaseId as string, 64);
    const resolution = cleanText(req.body?.resolution, 500) || "Manually resolved";
    if (!projectId || !edgeCaseId) {
      res.status(400).json({ error: "projectId and edgeCaseId required" });
      return;
    }
    await resolveEdgeCase(projectId, edgeCaseId, resolution);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Edge case resolve failed");
    res.status(500).json({ error: "Edge case resolve failed" });
  }
});

/**
 * Phase 5.3: Edge Cases — Rate limit check
 * GET /api/jarvis/build/rate-limit/:key
 */
router.get("/build/rate-limit/:key", async (req: Request, res: Response) => {
  try {
    const key = cleanText(req.params.key as string, 100);
    const maxRequests = Number(req.query.maxRequests) || 10;
    const windowMs = Number(req.query.windowMs) || 60000;
    if (!key) {
      res.status(400).json({ error: "key required" });
      return;
    }
    const result = checkRateLimit(key, maxRequests, windowMs);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Rate limit check failed");
    res.status(500).json({ error: "Rate limit check failed" });
  }
});

/**
 * Phase 5.3: Edge Cases — Wait for rate limit
 * POST /api/jarvis/build/wait-rate-limit/:key
 */
router.post("/build/wait-rate-limit/:key", async (req: Request, res: Response) => {
  try {
    const key = cleanText(req.params.key as string, 100);
    const maxRequests = Number(req.body?.maxRequests) || 10;
    const windowMs = Number(req.body?.windowMs) || 60000;
    const maxWaitMs = Number(req.body?.maxWaitMs) || 60000;
    if (!key) {
      res.status(400).json({ error: "key required" });
      return;
    }
    const ok = await waitForRateLimit(key, maxRequests, windowMs, maxWaitMs);
    res.json({ ok });
  } catch (err) {
    req.log.error({ err }, "Wait rate limit failed");
    res.status(500).json({ error: "Wait rate limit failed" });
  }
});

export default router;
