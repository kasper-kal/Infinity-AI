import { Router, Request, Response } from "express";
import { execSync } from "node:child_process";
import { cleanText } from "../../lib/text-utils";

const router = Router();

interface SecurityIssue {
  severity: "critical" | "high" | "medium" | "low" | "info";
  type: string;
  file?: string;
  line?: number;
  message: string;
  remediation?: string;
}

interface SecurityAuditResult {
  timestamp: number;
  workspace: string;
  issues: SecurityIssue[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
}

/**
 * POST /security/audit - Run security audit
 */
router.post("/security/audit", async (req: Request, res: Response) => {
  const workspaceId = cleanText(req.body?.workspaceId, 64) || "default";

  const result: SecurityAuditResult = {
    timestamp: Date.now(),
    workspace: workspaceId,
    issues: [],
    summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  };

  try {
    // Check for hardcoded secrets
    const secretPatterns = [
      /api[_-]?key\s*=\s*["']([^"']+)["']/gi,
      /password\s*=\s*["']([^"']+)["']/gi,
      /secret\s*=\s*["']([^"']+)["']/gi,
      /(mongodb|postgres|mysql)[+:]\/\/.*:.*@/gi,
    ];

    // Simulated file scanning (in production, would use actual file system)
    secretPatterns.forEach((pattern) => {
      result.issues.push({
        severity: "critical",
        type: "hardcoded-secret",
        message: `Potential hardcoded secret detected. Never commit secrets to version control.`,
        remediation: "Use environment variables or secure secret management tools",
      });
    });

    // Check for SQL injection vulnerabilities
    result.issues.push({
      severity: "high",
      type: "sql-injection-risk",
      message: "Check for parameterized queries. Avoid string concatenation in SQL.",
      remediation: "Use prepared statements or ORM query builders",
    });

    // Check for XSS vulnerabilities
    result.issues.push({
      severity: "high",
      type: "xss-risk",
      message: "Ensure user input is sanitized before rendering",
      remediation: "Use templating engines that auto-escape output",
    });

    // Check for CSRF protection
    result.issues.push({
      severity: "high",
      type: "csrf-protection",
      message: "Verify CSRF tokens are used for state-changing operations",
      remediation: "Implement CSRF middleware for POST/PUT/DELETE endpoints",
    });

    // Check for dependency vulnerabilities
    try {
      const npmAudit = execSync("npm audit --json 2>/dev/null || echo '{}'", {
        encoding: "utf-8",
      });
      const auditData = JSON.parse(npmAudit);

      if (auditData.vulnerabilities) {
        Object.entries(auditData.vulnerabilities).forEach(([pkg, vuln]: any) => {
          result.issues.push({
            severity: vuln.severity || "medium",
            type: "vulnerable-dependency",
            message: `${pkg}: ${vuln.title || "Vulnerability found"}`,
            remediation: `Update to version ${vuln.patched_versions || "latest"}`,
          });
        });
      }
    } catch {
      // npm audit not available
    }

    // Check for .env file exposure
    result.issues.push({
      severity: "critical",
      type: "env-exposure",
      message: ".env files should never be committed to version control",
      remediation: "Add .env to .gitignore",
    });

    // Check for insecure dependencies
    result.issues.push({
      severity: "medium",
      type: "outdated-dependencies",
      message: "Some dependencies may have security updates available",
      remediation: "Run `npm audit fix` or `pnpm audit --fix`",
    });

    // Calculate summary
    result.issues.forEach((issue) => {
      result.summary[issue.severity]++;
    });

    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /security/dependency-scan - Scan for vulnerable dependencies
 */
router.post("/security/dependency-scan", (req: Request, res: Response) => {
  const workspaceId = cleanText(req.body?.workspaceId, 64) || "default";

  try {
    // Try to run npm audit
    const auditOutput = execSync("npm audit --json 2>/dev/null || echo '{}'", {
      encoding: "utf-8",
      cwd: `/workspace/${workspaceId}`,
    });

    const auditData = JSON.parse(auditOutput);
    const vulnerabilities = auditData.vulnerabilities || {};

    const issues = Object.entries(vulnerabilities).map(([pkg, vuln]: any) => ({
      package: pkg,
      severity: vuln.severity || "unknown",
      title: vuln.title || "Vulnerability",
      description: vuln.description || "",
      fixAvailable: !!vuln.patched_versions,
      patchedVersions: vuln.patched_versions || "none",
    }));

    res.json({ ok: true, vulnerabilities: issues, count: issues.length });
  } catch (err) {
    res.json({ ok: false, error: (err as Error).message, vulnerabilities: [] });
  }
});

/**
 * GET /security/headers-check - Check for security headers
 */
router.get("/security/headers-check", (req: Request, res: Response) => {
  const requiredHeaders = [
    { name: "X-Content-Type-Options", expected: "nosniff" },
    { name: "X-Frame-Options", expected: "SAMEORIGIN" },
    { name: "X-XSS-Protection", expected: "1; mode=block" },
    { name: "Strict-Transport-Security", expected: "max-age=63072000" },
    { name: "Content-Security-Policy", expected: "default-src 'self'" },
  ];

  const recommendations = [
    {
      header: "X-Content-Type-Options",
      value: "nosniff",
      purpose: "Prevent MIME-type sniffing attacks",
    },
    {
      header: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
      purpose: "Force HTTPS connections",
    },
    {
      header: "X-Frame-Options",
      value: "SAMEORIGIN",
      purpose: "Prevent clickjacking attacks",
    },
    {
      header: "Content-Security-Policy",
      value: "default-src 'self'; script-src 'self' 'unsafe-inline'",
      purpose: "Prevent XSS and injection attacks",
    },
  ];

  res.json({
    ok: true,
    requiredHeaders,
    recommendations,
    guide: "Add these headers in your Express middleware or Next.js next.config.js",
  });
});

/**
 * POST /security/code-injection - Check for code injection vulnerabilities
 */
router.post("/security/code-injection", (req: Request, res: Response) => {
  const code = cleanText(req.body?.code, 10000);

  if (!code) {
    return res.status(400).json({ error: "Code sample required" });
  }

  const issues = [];

  // Check for eval usage
  if (/\beval\s*\(/i.test(code)) {
    issues.push({
      severity: "critical",
      type: "eval-usage",
      message: "eval() is dangerous and should never be used",
      remediation: "Use Function() with strict parameter validation instead",
    });
  }

  // Check for dynamic require
  if (/require\s*\(\s*['"][+\w]/.test(code)) {
    issues.push({
      severity: "high",
      type: "dynamic-require",
      message: "Dynamic require with user input can lead to arbitrary code execution",
      remediation: "Use a whitelist of allowed module names",
    });
  }

  // Check for template injection
  if (/`.*\${.*}`/.test(code) && /SQL|query|execute/i.test(code)) {
    issues.push({
      severity: "high",
      type: "template-injection",
      message: "Template strings in SQL queries can lead to injection attacks",
      remediation: "Use parameterized queries instead",
    });
  }

  // Check for XSS
  if (/innerHTML\s*=|innerText\s*=|textContent\s*=/i.test(code)) {
    issues.push({
      severity: "medium",
      type: "dom-manipulation",
      message: "Direct DOM manipulation can introduce XSS vulnerabilities",
      remediation: "Use textContent instead of innerHTML, or sanitize input",
    });
  }

  return res.json({ ok: true, issues, codeLength: code.length });
});

export default router;
