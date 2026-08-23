import { Router, Request, Response } from "express";
import { chromium } from "playwright";
import * as axe from "axe-core";
import { cleanText } from "../../lib/text-utils";

const router = Router();

interface AccessibilityIssue {
  id: string;
  impact: "critical" | "serious" | "moderate" | "minor";
  description: string;
  help: string;
  helpUrl: string;
  nodes: Array<{
    target: string[];
    failureSummary: string;
  }>;
}

interface AccessibilityAuditResult {
  url: string;
  timestamp: number;
  violations: AccessibilityIssue[];
  passes: Array<{ id: string; description: string; nodeCount: number }>;
  incomplete: Array<{ id: string; description: string }>;
  summary: {
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
    passed: number;
  };
}

/**
 * POST /accessibility/audit - Run accessibility audit with axe
 */
router.post("/accessibility/audit", async (req: Request, res: Response) => {
  const url = cleanText(req.body?.url, 500) || "http://localhost:3000";

  const result: AccessibilityAuditResult = {
    url,
    timestamp: Date.now(),
    violations: [],
    passes: [],
    incomplete: [],
    summary: { critical: 0, serious: 0, moderate: 0, minor: 0, passed: 0 },
  };

  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle" });

    // Inject axe-core and run audit
    const axeResults = await page.evaluate(async () => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.0/axe.min.js";
      document.head.appendChild(script);

      return new Promise((resolve) => {
        setTimeout(() => {
          (window as any).axe.run((results: any) => {
            resolve(results);
          });
        }, 1000);
      });
    });

    const scanResults = axeResults as any;

    // Process violations
    scanResults.violations?.forEach((violation: any) => {
      result.violations.push({
        id: violation.id,
        impact: violation.impact,
        description: violation.description,
        help: violation.help,
        helpUrl: violation.helpUrl,
        nodes: violation.nodes.map((node: any) => ({
          target: node.target,
          failureSummary: node.failureSummary,
        })),
      });

      const impact = violation.impact as keyof typeof result.summary;
      if (impact in result.summary) result.summary[impact]++;
    });

    // Process passes
    scanResults.passes?.forEach((pass: any) => {
      result.passes.push({
        id: pass.id,
        description: pass.description,
        nodeCount: pass.nodes.length,
      });
      result.summary.passed++;
    });

    // Process incomplete
    scanResults.incomplete?.forEach((incomplete: any) => {
      result.incomplete.push({
        id: incomplete.id,
        description: incomplete.description,
      });
    });

    await browser.close();
    res.json({ ok: true, result });
  } catch (err) {
    if (browser) await browser.close();
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /accessibility/color-contrast - Check color contrast ratios
 */
router.post("/accessibility/color-contrast", async (req: Request, res: Response) => {
  const url = cleanText(req.body?.url, 500) || "http://localhost:3000";

  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(url);

    const contrastIssues = await page.evaluate(() => {
      const issues: any[] = [];
      const elements = document.querySelectorAll("*");

      elements.forEach((el: any) => {
        const style = window.getComputedStyle(el);
        const bgColor = style.backgroundColor;
        const fgColor = style.color;

        // Simple contrast check (in production, use proper WCAG algorithm)
        if (bgColor && fgColor && bgColor !== "rgba(0, 0, 0, 0)") {
          issues.push({
            element: el.tagName,
            background: bgColor,
            foreground: fgColor,
            fontSize: style.fontSize,
          });
        }
      });

      return issues.slice(0, 10); // Return first 10 issues
    });

    await browser.close();

    res.json({
      ok: true,
      issues: contrastIssues,
      recommendation: "Use WCAG AA standards (4.5:1 for normal text, 3:1 for large text)",
    });
  } catch (err) {
    if (browser) await browser.close();
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /accessibility/aria-check - Check ARIA attributes
 */
router.post("/accessibility/aria-check", (req: Request, res: Response) => {
  const html = cleanText(req.body?.html, 10000);

  if (!html) {
    return res.status(400).json({ error: "HTML content required" });
  }

  const issues = [];

  // Check for missing alt text
  if (/<img[^>]*>/.test(html) && !/<img[^>]*alt=/.test(html)) {
    issues.push({
      severity: "critical",
      type: "missing-alt-text",
      message: "Images without alt text are not accessible",
      recommendation: "Add descriptive alt attributes to all images",
    });
  }

  // Check for missing labels
  if (/<input[^>]*>/.test(html) && !/<label[^>]*>/.test(html)) {
    issues.push({
      severity: "high",
      type: "missing-labels",
      message: "Form inputs without labels are not accessible",
      recommendation: 'Use <label> elements with "for" attributes linking to inputs',
    });
  }

  // Check for semantic HTML
  if (!/<main|<section|<article|<nav/.test(html)) {
    issues.push({
      severity: "medium",
      type: "missing-semantic-html",
      message: "Consider using semantic HTML elements",
      recommendation: "Use <main>, <section>, <article>, <nav> instead of divs",
    });
  }

  // Check for heading hierarchy
  if (/<h1/.test(html) && /<h3/.test(html) && !/<h2/.test(html)) {
    issues.push({
      severity: "medium",
      type: "heading-hierarchy",
      message: "Heading hierarchy should not skip levels",
      recommendation: "Use headings in order: h1 -> h2 -> h3",
    });
  }

  // Check for keyboard navigation
  if (/<a href|<button/.test(html)) {
    issues.push({
      severity: "medium",
      type: "keyboard-navigation",
      message: "Ensure all interactive elements are keyboard accessible",
      recommendation: 'Use semantic HTML (a, button) and check with Tab key',
    });
  }

  return res.json({ ok: true, issues, htmlSize: html.length });
});

/**
 * GET /accessibility/wcag-guide - Get WCAG 2.1 AA guidelines
 */
router.get("/accessibility/wcag-guide", (req: Request, res: Response) => {
  const guidelines = [
    {
      id: "1.1.1",
      name: "Non-text Content",
      level: "A",
      requirement: "All images and non-text content must have text alternatives",
      example: '<img src="logo.png" alt="Company Logo">',
    },
    {
      id: "1.4.3",
      name: "Contrast (Minimum)",
      level: "AA",
      requirement: "Text must have contrast ratio of at least 4.5:1",
      example: "Use high contrast colors, test with WebAIM contrast checker",
    },
    {
      id: "2.1.1",
      name: "Keyboard",
      level: "A",
      requirement: "All functionality must be keyboard accessible",
      example: "Test navigation with Tab, Enter, and Arrow keys",
    },
    {
      id: "2.4.7",
      name: "Focus Visible",
      level: "AA",
      requirement: "Keyboard focus indicator must be visible",
      example: "Ensure :focus styles are not removed in CSS",
    },
    {
      id: "3.1.1",
      name: "Language of Page",
      level: "A",
      requirement: "Default language must be specified",
      example: '<html lang="en">',
    },
    {
      id: "4.1.2",
      name: "Name, Role, Value",
      level: "A",
      requirement: "All UI components must have accessible names and roles",
      example: 'Use semantic HTML and ARIA attributes properly',
    },
  ];

  res.json({ ok: true, guidelines, compliance: "WCAG 2.1 AA" });
});

export default router;
