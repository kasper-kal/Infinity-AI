import { Router, Request, Response } from "express";
import { chromium } from "playwright";
import { cleanText, parseJsonObject } from "../../lib/text-utils";

const router = Router();

interface E2ETest {
  name: string;
  steps: E2EStep[];
  duration?: number;
  passed: boolean;
  error?: string;
}

interface E2EStep {
  action: string;
  target?: string;
  value?: string;
  result: string;
}

interface BrowserContext {
  baseUrl: string;
  headless?: boolean;
  timeout?: number;
}

// E2E test workflows for common infinity workflows
const E2E_WORKFLOWS = {
  "basic-setup": {
    name: "Basic Setup & Navigation",
    steps: [
      { action: "navigate", target: "/" },
      { action: "wait-for", target: ".build-studio" },
      { action: "verify", target: "title", value: "infinity Build" },
    ],
  },
  "create-workspace": {
    name: "Create Workspace",
    steps: [
      { action: "navigate", target: "/" },
      { action: "click", target: "[data-testid=new-workspace]" },
      { action: "type", target: "[data-testid=workspace-name]", value: "Test Workspace" },
      { action: "click", target: "[data-testid=create-btn]" },
      { action: "wait-for", target: "[data-testid=editor]" },
    ],
  },
  "file-editing": {
    name: "File Creation & Editing",
    steps: [
      { action: "navigate", target: "/" },
      { action: "click", target: "[data-testid=new-file]" },
      { action: "type", target: "[data-testid=filename]", value: "test.ts" },
      { action: "enter" },
      { action: "type", target: "[data-testid=editor]", value: "console.log('test');" },
      { action: "verify", target: "[data-testid=editor]", value: "console.log" },
    ],
  },
  "git-workflow": {
    name: "Git Workflow",
    steps: [
      { action: "navigate", target: "/" },
      { action: "click", target: "[data-testid=git-panel]" },
      { action: "wait-for", target: "[data-testid=git-status]" },
      { action: "click", target: "[data-testid=git-commit]" },
      { action: "type", target: "[data-testid=commit-msg]", value: "Test commit" },
      { action: "click", target: "[data-testid=commit-btn]" },
    ],
  },
  "package-install": {
    name: "Package Installation",
    steps: [
      { action: "navigate", target: "/" },
      { action: "click", target: "[data-testid=packages-panel]" },
      { action: "type", target: "[data-testid=package-search]", value: "lodash" },
      { action: "wait-for", target: "[data-testid=search-results]" },
      { action: "click", target: "[data-testid=install-lodash]" },
      { action: "wait-for", target: "[data-testid=install-success]" },
    ],
  },
  "terminal-run": {
    name: "Terminal Command Execution",
    steps: [
      { action: "navigate", target: "/" },
      { action: "click", target: "[data-testid=terminal-panel]" },
      { action: "type", target: "[data-testid=terminal-input]", value: "npm run dev" },
      { action: "enter" },
      { action: "wait-for", target: "[data-testid=terminal-output]" },
      { action: "verify", target: "[data-testid=terminal-output]", value: "started" },
    ],
  },
};

/**
 * POST /e2e/run - Run E2E tests
 */
router.post("/e2e/run", async (req: Request, res: Response) => {
  const workflowName = cleanText(req.body?.workflow, 50) || "basic-setup";
  const baseUrl = cleanText(req.body?.baseUrl, 200) || "http://localhost:3000";
  const headless = req.body?.headless !== false;

  const workflow = E2E_WORKFLOWS[workflowName as keyof typeof E2E_WORKFLOWS];
  if (!workflow) {
    return res.status(400).json({ error: "Unknown workflow" });
  }

  const test: E2ETest = {
    name: workflow.name,
    steps: [],
    passed: false,
  };

  let browser;
  try {
    const startTime = Date.now();
    browser = await chromium.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(10000);

    for (const step of workflow.steps) {
      try {
        switch (step.action) {
          case "navigate":
            await page.goto(baseUrl + (step.target || "/"));
            test.steps.push({ ...step, result: "success" });
            break;

          case "click":
            await page.click(step.target || "");
            test.steps.push({ ...step, result: "success" });
            break;

          case "type":
            await page.fill(step.target || "", step.value || "");
            test.steps.push({ ...step, result: "success" });
            break;

          case "enter":
            await page.press(step.target || "body", "Enter");
            test.steps.push({ ...step, result: "success" });
            break;

          case "wait-for":
            await page.waitForSelector(step.target || "");
            test.steps.push({ ...step, result: "success" });
            break;

          case "verify":
            const content = await page.textContent(step.target || "");
            const match = content?.includes(step.value || "");
            test.steps.push({
              ...step,
              result: match ? "success" : "failed",
            });
            if (!match) throw new Error(`Verification failed: ${step.target}`);
            break;

          default:
            test.steps.push({ ...step, result: "unknown-action" });
        }
      } catch (err) {
        test.steps.push({
          ...step,
          result: `error: ${(err as Error).message}`,
        });
        throw err;
      }
    }

    test.duration = Date.now() - startTime;
    test.passed = true;

    await context.close();
    await browser.close();

    return res.json({ ok: true, test });
  } catch (err) {
    test.error = (err as Error).message;
    test.passed = false;
    if (browser) await browser.close();
    return res.json({ ok: false, test });
  }
});

/**
 * GET /e2e/workflows - List available E2E workflows
 */
router.get("/e2e/workflows", (req: Request, res: Response) => {
  const workflows = Object.entries(E2E_WORKFLOWS).map(([id, workflow]) => ({
    id,
    name: workflow.name,
    stepCount: workflow.steps.length,
  }));

  res.json({ ok: true, workflows });
});

/**
 * GET /e2e/workflows/:id - Get workflow details
 */
router.get("/e2e/workflows/:id", (req: Request, res: Response) => {
  const workflow = E2E_WORKFLOWS[req.params.id as keyof typeof E2E_WORKFLOWS];
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found" });
  }

  return res.json({ ok: true, workflow });
});

/**
 * POST /e2e/custom - Run custom E2E test
 */
router.post("/e2e/custom", async (req: Request, res: Response) => {
  const steps = req.body?.steps;
  const baseUrl = cleanText(req.body?.baseUrl, 200) || "http://localhost:3000";
  const headless = req.body?.headless !== false;

  if (!Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ error: "Steps array required" });
  }

  const test: E2ETest = {
    name: cleanText(req.body?.name, 100) || "Custom E2E Test",
    steps: [],
    passed: false,
  };

  let browser;
  try {
    const startTime = Date.now();
    browser = await chromium.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(10000);

    for (const step of steps) {
      try {
        const action = cleanText(step.action, 50) || "unknown";
        const target = cleanText(step.target, 200);
        const value = cleanText(step.value, 500);

        switch (action) {
          case "navigate":
            await page.goto(baseUrl + (target || "/"));
            break;
          case "click":
            await page.click(target || "");
            break;
          case "type":
            await page.fill(target || "", value || "");
            break;
          case "enter":
            await page.press(target || "body", "Enter");
            break;
          case "wait-for":
            await page.waitForSelector(target || "");
            break;
          case "screenshot":
            await page.screenshot({ path: `/tmp/e2e-${Date.now()}.png` });
            break;
        }

        test.steps.push({ action, target, value, result: "success" });
      } catch (err) {
        test.steps.push({
          action: step.action,
          target: step.target,
          value: step.value,
          result: `error: ${(err as Error).message}`,
        });
        throw err;
      }
    }

    test.duration = Date.now() - startTime;
    test.passed = true;

    await context.close();
    await browser.close();

    return res.json({ ok: true, test });
  } catch (err) {
    test.error = (err as Error).message;
    test.passed = false;
    if (browser) await browser.close();
    return res.json({ ok: false, test });
  }
});

export default router;
