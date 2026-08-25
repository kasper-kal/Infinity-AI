/**
 * PHASE 11: SECURITY SCANNER ENGINE
 *
 * Replit-style security scanning:
 * - Built-in static analysis rules (secrets, SQLi, XSS, path traversal, auth bypass, crypto, dependencies)
 * - Optional Semgrep integration (used if semgrep binary is available on PATH)
 * - LLM-based false positive filter (uses security-auditor skill + Universal Agent)
 * - Incremental watch mode (scans only changed files)
 * - Inline editor results + Build Debug panel integration
 *
 * Budget constraint: $0. All rules are free, local, open-source.
 * Semgrep is optional (if not installed, built-in rules still run).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listWorkspaceFiles, readWorkspaceFileText, getWorkspaceRoot } from "./workspace";

const execFileAsync = promisify(execFile);

// ============================================================================
// TYPES
// ============================================================================

export type SecuritySeverity = "critical" | "high" | "medium" | "low" | "info";

export type SecurityCategory =
  | "secrets"
  | "sqli"
  | "xss"
  | "path-traversal"
  | "auth-bypass"
  | "crypto"
  | "dependencies"
  | "injection"
  | "ssrf"
  | "misconfig";

export interface SecurityFinding {
  id: string;
  rule: string;
  category: SecurityCategory;
  severity: SecuritySeverity;
  title: string;
  description: string;
  filePath: string;
  line: number;
  column?: number;
  snippet: string;
  /** Whether this was flagged by LLM as a likely false positive */
  falsePositive?: boolean;
  /** LLM confidence that this is a real issue (0-1) */
  confidence?: number;
  /** LLM rationale for suppression */
  llmRationale?: string;
  /** Whether scanner should block deployment */
  blocksDeployment: boolean;
}

export interface ScanResult {
  projectId: string;
  workspaceId: string;
  scanId: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  findings: SecurityFinding[];
  summary: {
    total: number;
    bySeverity: Record<SecuritySeverity, number>;
    byCategory: Record<SecurityCategory, number>;
    blocked: number;
    falsePositives: number;
  };
  /** Whether any finding blocks deployment */
  deploymentBlocked: boolean;
  /** Files scanned */
  filesScanned: number;
  /** Scan engine used (builtin, semgrep, or both) */
  engine: "builtin" | "semgrep" | "both";
}

export interface ScanOptions {
  /** Limit scan to specific files (for incremental/watch mode) */
  filePaths?: string[];
  /** Run LLM false positive filter (requires LLM adapter) */
  useLLMFilter?: boolean;
  /** Use Semgrep if available */
  useSemgrep?: boolean;
  /** Maximum files to scan (for LLM filter cost control) */
  maxFilesForLLM?: number;
}

// ============================================================================
// BUILT-IN RULES (FREE, LOCAL, OPEN-SOURCE STYLE)
// ============================================================================

interface BuiltinRule {
  id: string;
  category: SecurityCategory;
  severity: SecuritySeverity;
  title: string;
  description: string;
  /** Regex pattern to match (case-insensitive by default) */
  pattern: RegExp;
  /** Context lines before/after for snippet */
  context?: number;
  /** Whether this blocks deployment by default */
  blocksDeployment: boolean;
  /** Extra validation (e.g., entropy check for secrets) */
  validate?: (match: RegExpMatchArray, line: string) => boolean;
}

const BUILTIN_RULES: BuiltinRule[] = [
  // ---- SECRETS ----
  {
    id: "secret-aws-key",
    category: "secrets",
    severity: "critical",
    title: "AWS Access Key ID",
    description: "Hardcoded AWS access key detected. Use environment variables or secret manager.",
    pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
    blocksDeployment: true,
  },
  {
    id: "secret-private-key",
    category: "secrets",
    severity: "critical",
    title: "Private Key Material",
    description: "Private key (RSA/EC/PEM) found in source. Never commit keys.",
    pattern: /-----BEGIN\s+(?:RSA|EC|OPENSSH|PGP|DSA|PRIVATE)\s+KEY-----/g,
    blocksDeployment: true,
  },
  {
    id: "secret-jwt",
    category: "secrets",
    severity: "high",
    title: "JSON Web Token (JWT)",
    description: "Hardcoded JWT detected. Tokens should be issued at runtime.",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    blocksDeployment: true,
  },
  {
    id: "secret-api-key-assignment",
    category: "secrets",
    severity: "high",
    title: "API Key Assignment",
    description: "Possible hardcoded API key. Use environment variables.",
    pattern: /(?:api[_-]?key|apiKey|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)\s*[:=]\s*['"]([^'"]{16,})['"]/gi,
    blocksDeployment: true,
    validate: (match) => {
      const value = match[1] || "";
      // Entropy check: reject low-entropy (obvious placeholder) values
      const uniqueChars = new Set(value.split("")).size;
      return uniqueChars >= 8 && value.length >= 16;
    },
  },
  {
    id: "secret-password-hardcoded",
    category: "secrets",
    severity: "high",
    title: "Hardcoded Password",
    description: "Hardcoded password detected. Use environment variables or secret manager.",
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"]([^'"]{8,})['"]/gi,
    blocksDeployment: true,
    validate: (match) => {
      const value = match[1] || "";
      const uniqueChars = new Set(value.split("")).size;
      return uniqueChars >= 6 && value.length >= 8 && !/\b(example|test|dummy|changeme|password)\b/i.test(value);
    },
  },
  {
    id: "secret-db-url",
    category: "secrets",
    severity: "critical",
    title: "Database Connection String with Credentials",
    description: "Database URL with embedded credentials. Use environment variables.",
    pattern: /(?:postgres|postgresql|mysql|mongodb|redis|amqp|mongodb\+srv):\/\/[^:\s]+:[^@\s]+@/gi,
    blocksDeployment: true,
  },
  {
    id: "secret-slack-token",
    category: "secrets",
    severity: "critical",
    title: "Slack Token",
    description: "Hardcoded Slack token (xox). Use environment variables.",
    pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
    blocksDeployment: true,
  },
  {
    id: "secret-stripe-key",
    category: "secrets",
    severity: "critical",
    title: "Stripe API Key",
    description: "Hardcoded Stripe secret/test key. Use environment variables.",
    pattern: /\b(sk|rk)_(live|test)_[0-9a-zA-Z]{16,}\b/g,
    blocksDeployment: true,
  },
  {
    id: "secret-google-api",
    category: "secrets",
    severity: "high",
    title: "Google API Key",
    description: "Hardcoded Google API key. Restrict via API dashboard + env vars.",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    blocksDeployment: true,
  },
  {
    id: "secret-github-token",
    category: "secrets",
    severity: "critical",
    title: "GitHub Token",
    description: "Hardcoded GitHub personal access token. Use secrets manager.",
    pattern: /\bgh[pousr]_[0-9A-Za-z]{36,}\b/g,
    blocksDeployment: true,
  },

  // ---- SQL INJECTION ----
  {
    id: "sqli-string-concat",
    category: "sqli",
    severity: "high",
    title: "SQL Injection (String Concatenation)",
    description: "SQL query built via string concatenation. Use parameterized queries.",
    pattern: /(?:\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bCREATE\b)[\s\S]{0,200}?\+|\$\{/gi,
    blocksDeployment: true,
    validate: (match, line) => {
      // Only flag if there's user input nearby
      return /\b(req\.|params|query|body|input|user|env\.|process\.)/i.test(line);
    },
  },
  {
    id: "sqli-template-literal",
    category: "sqli",
    severity: "high",
    title: "SQL Injection (Template Literal)",
    description: "SQL query with template literal interpolation. Use parameterized queries.",
    pattern: /(?:query|sql|statement)\s*=\s*`[^`]*\$\{/gi,
    blocksDeployment: true,
    validate: (match, line) => /\b(req\.|params|query|body|input|user)\b/i.test(line),
  },

  // ---- XSS ----
  {
    id: "xss-innerhtml",
    category: "xss",
    severity: "medium",
    title: "XSS (innerHTML/dangerous HTML insertion)",
    description: "User-controlled data inserted via innerHTML. Use safe DOM APIs or sanitize.",
    pattern: /\.(?:innerHTML|outerHTML|insertAdjacentHTML)\s*=[^;]*\$|\+/gi,
    blocksDeployment: false,
    validate: (match, line) => /\b(req\.|params|query|body|input|user|response\.)\b/i.test(line),
  },
  {
    id: "xss-dangerouslyset",
    category: "xss",
    severity: "medium",
    title: "XSS (React dangerouslySetInnerHTML)",
    description: "dangerouslySetInnerHTML with dynamic content. Sanitize or avoid.",
    pattern: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*[^}]*\$\{|dangerouslySetInnerHTML=\{\{__html:/gi,
    blocksDeployment: false,
    validate: (match, line) => /\b(req\.|params|query|body|input|user|response\.)\b/i.test(line),
  },
  {
    id: "xss-eval",
    category: "xss",
    severity: "high",
    title: "Code Injection (eval/Function)",
    description: "Dynamic code execution via eval/Function. Avoid or sandbox.",
    pattern: /\b(?:eval|new\s+Function|setTimeout|setInterval)\s*\(\s*[`'"][^`'"()]*\$/gi,
    blocksDeployment: true,
  },

  // ---- PATH TRAVERSAL ----
  {
    id: "path-traversal",
    category: "path-traversal",
    severity: "high",
    title: "Path Traversal",
    description: "User input used in file path without sanitization. Can escape workspace.",
    pattern: /(?:\bpath\.join\b|\bresolve\b|\breadFile\b|\bwriteFile\b|\bcreateReadStream\b)[\s\S]{0,100}?\$/gi,
    blocksDeployment: true,
    validate: (match, line) => /\b(req\.|params|query|body|input|user|upload|filename)\b/i.test(line),
  },

  // ---- AUTH BYPASS ----
  {
    id: "auth-bypass-disable",
    category: "auth-bypass",
    severity: "critical",
    title: "Authentication Disabled",
    description: "Authentication check bypassed or disabled. Never skip auth in production.",
    pattern: /(?:\/\/\s*(?:no|skip|bypass|disable)\s*auth|if\s*\(\s*false\s*\)\s*\{\s*[^}]*auth|authMiddleware\s*=\s*\(\s*req\s*,\s*res\s*,\s*next\s*\)\s*=>\s*next\(\))/gi,
    blocksDeployment: true,
  },
  {
    id: "auth-hardcoded-token",
    category: "auth-bypass",
    severity: "high",
    title: "Hardcoded Auth Token/Bypass",
    description: "Hardcoded authorization token or always-true auth check.",
    pattern: /(?:authorization|auth|token|bearer)\s*[:=]\s*['"](?:admin|root|dev|test|secret|bypass)['"]/gi,
    blocksDeployment: true,
  },

  // ---- CRYPTO ISSUES ----
  {
    id: "crypto-weak-hash",
    category: "crypto",
    severity: "medium",
    title: "Weak Cryptographic Hash",
    description: "MD5/SHA1 are cryptographically broken. Use SHA-256+ or bcrypt/argon2.",
    pattern: /\b(?:crypto\.createHash|createHash|md5|sha1)\s*\(\s*['"]?(?:md5|sha1)['"]?\s*\)/gi,
    blocksDeployment: false,
  },
  {
    id: "crypto-weak-random",
    category: "crypto",
    severity: "medium",
    title: "Weak Random Number Generator",
    description: "Math.random() is not cryptographically secure. Use crypto.randomBytes().",
    pattern: /\bMath\.random\s*\(\s*\)/g,
    blocksDeployment: false,
    validate: (match, line) => /\b(token|secret|session|id|key|nonce|salt|otp)\b/i.test(line),
  },
  {
    id: "crypto-plaintext-password",
    category: "crypto",
    severity: "high",
    title: "Plaintext Password Storage",
    description: "Password stored/compared without hashing. Use bcrypt/argon2.",
    pattern: /(?:password|pwd)\s*(?:===|==|!=|!==)\s*|\.compare\([^)]*password|\.equals?\([^)]*password/gi,
    blocksDeployment: true,
    validate: (match, line) => !/(bcrypt|argon|scrypt|hash|verify|compareSync)/i.test(line),
  },

  // ---- SSRF ----
  {
    id: "ssrf-fetch-user-url",
    category: "ssrf",
    severity: "high",
    title: "Server-Side Request Forgery (SSRF)",
    description: "Fetching user-controlled URL without allowlist. Can hit internal services.",
    pattern: /(?:fetch|axios|http\.get|request|got|node-fetch)\s*\(\s*[`'"][^`'"()]*\$/gi,
    blocksDeployment: true,
    validate: (match, line) => /\b(req\.|params|query|body|input|user|url|endpoint)\b/i.test(line),
  },

  // ---- MISCONFIGURATION ----
  {
    id: "misconfig-cors-wildcard",
    category: "misconfig",
    severity: "medium",
    title: "CORS Wildcard with Credentials",
    description: "CORS allows all origins with credentials. Restrict to known origins.",
    pattern: /(?:origin\s*:\s*['"]\*['"]|credentials\s*:\s*true[\s\S]{0,50}?origin\s*:\s*['"]\*['"]|Access-Control-Allow-Origin\s*:\s*\*)/gi,
    blocksDeployment: false,
  },
  {
    id: "misconfig-debug-enabled",
    category: "misconfig",
    severity: "low",
    title: "Debug Mode Enabled",
    description: "Debug mode should be disabled in production (exposes stack traces).",
    pattern: /(?:app\.use\(express\.static|DEBUG\s*=\s*['"]?true|NODE_ENV\s*=\s*['"]?development|debug\s*:\s*true)/gi,
    blocksDeployment: false,
    validate: (match, line) => !/process\.env\.NODE_ENV\s*!==\s*['"]production['"]/.test(line),
  },
  {
    id: "misconfig-verbose-errors",
    category: "misconfig",
    severity: "low",
    title: "Verbose Error Exposure",
    description: "Raw error objects/stack traces sent to client. Log server-side only.",
    pattern: /res\.status\(.*\)\.json\(\s*\{[^}]*error\s*:\s*(err|error|e)\b/gi,
    blocksDeployment: false,
  },
];

// ============================================================================
// BUILT-IN SCANNER
// ============================================================================

/** File extensions to scan */
const SCANNABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".rb", ".php", ".cs",
  ".json", ".yaml", ".yml", ".env", ".toml", ".sql",
]);

/** Directories to skip entirely */
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  "coverage", ".infinity", "vendor", "__pycache__", ".cache",
  "public", "assets", "static",
]);

function shouldScanFile(filePath: string): boolean {
  const base = path.basename(filePath);
  if (base.startsWith(".") && !base.includes(".env")) return false;
  if (SKIP_DIRS.has(base)) return false;
  const ext = path.extname(filePath).toLowerCase();
  if (SCANNABLE_EXTENSIONS.has(ext)) return true;
  if (base.includes(".env")) return true;
  return false;
}

function generateFindingId(): string {
  return `sec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function scanFileWithRules(
  filePath: string,
  content: string,
  rules: BuiltinRule[]
): Promise<SecurityFinding[]> {
  const findings: SecurityFinding[] = [];
  const lines = content.split("\n");

  for (const rule of rules) {
    // Reset regex state
    rule.pattern.lastIndex = 0;

    let match;
    while ((match = rule.pattern.exec(content)) !== null) {
      // Find line number
      const beforeNewlines = content.slice(0, match.index).split("\n").length - 1;
      const lineNum = beforeNewlines + 1;
      const line = lines[beforeNewlines] || "";

      // Extra validation
      if (rule.validate && !rule.validate(match, line)) {
        continue;
      }

      // Get snippet with context
      const contextStart = Math.max(0, beforeNewlines - (rule.context || 0));
      const contextEnd = Math.min(lines.length - 1, beforeNewlines + (rule.context || 0));
      const snippet = lines.slice(contextStart, contextEnd + 1).join("\n");

      findings.push({
        id: generateFindingId(),
        rule: rule.id,
        category: rule.category,
        severity: rule.severity,
        title: rule.title,
        description: rule.description,
        filePath,
        line: lineNum,
        column: match.index - content.lastIndexOf("\n", match.index) - 1,
        snippet: snippet.slice(0, 200),
        blocksDeployment: rule.blocksDeployment,
      });

      // Prevent infinite loop on zero-width matches
      if (match.index === rule.pattern.lastIndex) {
        rule.pattern.lastIndex++;
      }
    }
  }

  return findings;
}

// ============================================================================
// SEMGREP WRAPPER (OPTIONAL)
// ============================================================================

let semgrepAvailableCache: boolean | null = null;

async function isSemgrepAvailable(): Promise<boolean> {
  if (semgrepAvailableCache !== null) return semgrepAvailableCache;
  try {
    await execFileAsync("semgrep", ["--version"], { timeout: 5000 });
    semgrepAvailableCache = true;
  } catch {
    semgrepAvailableCache = false;
  }
  return semgrepAvailableCache;
}

async function runSemgrep(
  workspaceId: string,
  filePaths?: string[]
): Promise<SecurityFinding[]> {
  const root = getWorkspaceRoot(workspaceId);
  const findings: SecurityFinding[] = [];

  try {
    const args = [
      "--config=auto",
      "--json",
      "--quiet",
      "--timeout=60",
    ];

    if (filePaths && filePaths.length > 0) {
      args.push(...filePaths.map(f => path.join(root, f)));
    } else {
      args.push(root);
    }

    const { stdout } = await execFileAsync("semgrep", args, {
      timeout: 120000,
      maxBuffer: 50 * 1024 * 1024,
    });

    const result = JSON.parse(stdout);
    const results = result.results || [];

    for (const r of results) {
      const severityMap: Record<string, SecuritySeverity> = {
        ERROR: "critical",
        WARNING: "medium",
        INFO: "info",
      };

      const ruleId = r.check_id || "semgrep-unknown";
      const category = categorizeSemgrepRule(ruleId, r.extra?.message || "");

      findings.push({
        id: generateFindingId(),
        rule: ruleId,
        category,
        severity: severityMap[r.extra?.severity] || "medium",
        title: r.extra?.message?.slice(0, 100) || ruleId,
        description: r.extra?.message || "",
        filePath: r.path || "",
        line: r.start?.line || 0,
        column: r.start?.col,
        snippet: (r.extra?.lines || "").slice(0, 200),
        blocksDeployment: (severityMap[r.extra?.severity] || "medium") === "critical" ||
                         (severityMap[r.extra?.severity] || "medium") === "high",
      });
    }
  } catch (err) {
    console.error("[security-scanner] Semgrep run failed:", (err as Error).message);
  }

  return findings;
}

function categorizeSemgrepRule(ruleId: string, message: string): SecurityCategory {
  const lower = `${ruleId} ${message}`.toLowerCase();
  if (lower.includes("sql")) return "sqli";
  if (lower.includes("xss") || lower.includes("cross-site")) return "xss";
  if (lower.includes("secret") || lower.includes("token") || lower.includes("key") || lower.includes("password")) return "secrets";
  if (lower.includes("path") || lower.includes("traversal")) return "path-traversal";
  if (lower.includes("auth")) return "auth-bypass";
  if (lower.includes("crypto") || lower.includes("cipher")) return "crypto";
  if (lower.includes("ssrf") || lower.includes("request-forgery")) return "ssrf";
  if (lower.includes("dependency") || lower.includes("vuln")) return "dependencies";
  if (lower.includes("injection")) return "injection";
  return "misconfig";
}

// ============================================================================
// LLM FALSE POSITIVE FILTER
// ============================================================================

import { createBestAdapter } from "./adapter-factory";
import { spawnSubagent } from "./subagents";
import { SecurityAuditorOutput } from "./build-skills";

/**
 * LLM-based false positive filter.
 * Uses security-auditor skill to review findings and suppress noise.
 * Replit reports 93% accuracy on this approach.
 */
async function filterFalsePositives(
  findings: SecurityFinding[],
  projectId: string,
  workspaceId: string,
  maxFindings = 50
): Promise<SecurityFinding[]> {
  if (findings.length === 0) return findings;

  try {
    const llm = await createBestAdapter();
    if (!llm) {
      console.warn("[security-scanner] No LLM adapter available, skipping FP filter");
      return findings;
    }

    // Limit to most severe findings for cost control
    const prioritized = [...findings].sort((a, b) => {
      const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return sevOrder[a.severity] - sevOrder[b.severity];
    }).slice(0, maxFindings);

    const findingsJson = JSON.stringify(
      prioritized.map(f => ({
        id: f.id,
        rule: f.rule,
        category: f.category,
        severity: f.severity,
        title: f.title,
        description: f.description,
        filePath: f.filePath,
        line: f.line,
        snippet: f.snippet,
      })),
      null,
      2
    );

    const prompt = `You are a security expert reviewing static analysis findings for FALSE POSITIVES.

CONTEXT: This is a ${projectId} project (workspace: ${workspaceId}).

FINDINGS TO REVIEW:
${findingsJson}

For EACH finding, decide if it is a TRUE POSITIVE (real security issue) or FALSE POSITIVE (tool noise, test code, false alarm).

Common FALSE POSITIVE patterns:
- Test files with example/mock credentials
- Documentation/comments mentioning secrets (not actual code)
- Generated code with placeholders
- Non-sensitive config (public keys, non-secret tokens)
- Localhost/internal URLs in dev config
- False matches on variable names

Output ONLY valid JSON:
{
  "reviews": [
    {
      "id": "finding_id",
      "isFalsePositive": true|false,
      "confidence": 0.95,
      "rationale": "why this is/isn't a false positive"
    }
  ]
}`;

    const result = await spawnSubagent<SecurityAuditorOutput>(
      "security-auditor",
      prompt,
      llm,
      { modelTier: "high", reasoningEffort: "medium", temperature: 0.1, maxTokens: 4000 }
    ).catch(() => null);

    if (!result || !result.reviews) {
      console.warn("[security-scanner] LLM filter returned no result");
      return findings;
    }

    const reviewMap = new Map(result.reviews.map(r => [r.id, r]));

    return findings.map(f => {
      const review = reviewMap.get(f.id);
      if (review && review.isFalsePositive && review.confidence >= 0.8) {
        return {
          ...f,
          falsePositive: true,
          confidence: review.confidence,
          llmRationale: review.rationale,
          // False positives don't block deployment
          blocksDeployment: false,
        };
      }
      return f;
    });
  } catch (err) {
    console.error("[security-scanner] LLM filter error:", (err as Error).message);
    return findings;
  }
}

// ============================================================================
// MAIN SCAN FUNCTION
// ============================================================================

export async function scanSecurity(
  projectId: string,
  workspaceId: string,
  options: ScanOptions = {}
): Promise<ScanResult> {
  const scanId = generateFindingId();
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  let filePaths = options.filePaths;
  if (!filePaths || filePaths.length === 0) {
    // Get all workspace files
    try {
      const entries = await listWorkspaceFiles(workspaceId);
      filePaths = entries.map(e => e.path).filter(shouldScanFile);
    } catch {
      filePaths = [];
    }
  } else {
    filePaths = filePaths.filter(shouldScanFile);
  }

  const allFindings: SecurityFinding[] = [];
  let engine: ScanResult["engine"] = "builtin";

  // 1. Built-in rules
  for (const filePath of filePaths) {
    try {
      const content = await readWorkspaceFileText(workspaceId, filePath);
      if (!content) continue;
      const builtinFindings = await scanFileWithRules(filePath, content, BUILTIN_RULES);
      allFindings.push(...builtinFindings);
    } catch {
      // Skip unreadable files
    }
  }

  // 2. Semgrep (if available + requested)
  if (options.useSemgrep !== false) {
    const hasSemgrep = await isSemgrepAvailable();
    if (hasSemgrep) {
      engine = allFindings.length > 0 ? "both" : "semgrep";
      const semgrepFindings = await runSemgrep(workspaceId, options.filePaths);
      allFindings.push(...semgrepFindings);
    }
  }

  // 3. LLM false positive filter
  let finalFindings = allFindings;
  if (options.useLLMFilter) {
    finalFindings = await filterFalsePositives(
      allFindings,
      projectId,
      workspaceId,
      options.maxFilesForLLM || 50
    );
  }

  // Build summary
  const bySeverity: Record<SecuritySeverity, number> = {
    critical: 0, high: 0, medium: 0, low: 0, info: 0,
  };
  const byCategory: Record<SecurityCategory, number> = {
    secrets: 0, sqli: 0, xss: 0, "path-traversal": 0, "auth-bypass": 0,
    crypto: 0, dependencies: 0, injection: 0, ssrf: 0, misconfig: 0,
  };

  let blocked = 0;
  let falsePositives = 0;

  for (const f of finalFindings) {
    bySeverity[f.severity]++;
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    if (f.blocksDeployment) blocked++;
    if (f.falsePositive) falsePositives++;
  }

  const completedAt = new Date().toISOString();

  return {
    projectId,
    workspaceId,
    scanId,
    startedAt,
    completedAt,
    durationMs: Date.now() - startTime,
    findings: finalFindings,
    summary: {
      total: finalFindings.length,
      bySeverity,
      byCategory,
      blocked,
      falsePositives,
    },
    deploymentBlocked: blocked > 0,
    filesScanned: filePaths.length,
    engine,
  };
}

// ============================================================================
// INCREMENTAL WATCH MODE
// ============================================================================

export interface WatchScanResult {
  scanId: string;
  changedFiles: string[];
  findings: SecurityFinding[];
  deploymentBlocked: boolean;
}

/**
 * Scan only changed files (for watch mode / pre-commit).
 */
export async function scanChangedFiles(
  projectId: string,
  workspaceId: string,
  changedFiles: string[],
  options: ScanOptions = {}
): Promise<WatchScanResult> {
  const result = await scanSecurity(projectId, workspaceId, {
    ...options,
    filePaths: changedFiles,
  });

  return {
    scanId: result.scanId,
    changedFiles,
    findings: result.findings,
    deploymentBlocked: result.deploymentBlocked,
  };
}

// ============================================================================
// PRE-DEPLOYMENT GATE
// ============================================================================

export interface DeploymentGate {
  allowed: boolean;
  blockedBy: SecurityFinding[];
  summary: ScanResult["summary"];
  scanId: string;
}

/**
 * Mandatory security gate before deployment.
 * Blocks if any critical/high findings that aren't false positives.
 */
export async function checkDeploymentGate(
  projectId: string,
  workspaceId: string,
  options: ScanOptions = {}
): Promise<DeploymentGate> {
  const result = await scanSecurity(projectId, workspaceId, {
    ...options,
    useLLMFilter: options.useLLMFilter ?? true, // Default to LLM filter for gate
  });

  const blockedBy = result.findings.filter(f => f.blocksDeployment && !f.falsePositive);

  return {
    allowed: blockedBy.length === 0,
    blockedBy,
    summary: result.summary,
    scanId: result.scanId,
  };
}

// ============================================================================
// SUPPRESSION LOG
// ============================================================================

export interface SuppressionEntry {
  findingId: string;
  rule: string;
  filePath: string;
  line: number;
  reason: string;
  suppressedBy: string; // "user" | "llm"
  suppressedAt: string;
}

// In-memory suppression log (in production: persist to DB)
const suppressionLog = new Map<string, SuppressionEntry>();

export function addSuppression(entry: Omit<SuppressionEntry, "suppressedAt">): void {
  suppressionLog.set(entry.findingId, {
    ...entry,
    suppressedAt: new Date().toISOString(),
  });
}

export function getSuppressionLog(): SuppressionEntry[] {
  return Array.from(suppressionLog.values());
}

export function clearSuppression(findingId: string): void {
  suppressionLog.delete(findingId);
}

// ============================================================================
// DEPENDENCY AUDIT (NPM AUDIT WRAPPER)
// ============================================================================

export interface DependencyVuln {
  name: string;
  severity: SecuritySeverity;
  title: string;
  advisoryUrl?: string;
  vulnerableVersionRange: string;
  fixAvailable: boolean;
}

export async function auditDependencies(
  workspaceId: string
): Promise<DependencyVuln[]> {
  const root = getWorkspaceRoot(workspaceId);
  const vulnerabilities: DependencyVuln[] = [];

  try {
    const { stdout } = await execFileAsync("npm", ["audit", "--json"], {
      cwd: root,
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    }).catch(() => ({ stdout: "{}" }));

    const audit = JSON.parse(stdout);
    const vulns = audit.vulnerabilities || {};

    for (const [name, info] of Object.entries(vulns)) {
      const v = info as {
        severity: string;
        via: Array<{ title?: string; url?: string; range?: string } | string>;
        fixAvailable: boolean | { name: string; version: string };
      };

      const via = Array.isArray(v.via) ? v.via[0] : undefined;
      const title = typeof via === "object" ? via?.title || name : name;
      const url = typeof via === "object" ? via?.url : undefined;
      const range = typeof via === "object" ? via?.range || "" : "";

      vulnerabilities.push({
        name,
        severity: (v.severity as SecuritySeverity) || "medium",
        title,
        advisoryUrl: url,
        vulnerableVersionRange: range,
        fixAvailable: !!v.fixAvailable,
      });
    }
  } catch (err) {
    console.error("[security-scanner] npm audit failed:", (err as Error).message);
  }

  return vulnerabilities;
}

// ============================================================================
// RULE STATS / METADATA
// ============================================================================

export function getRuleStats(): {
  total: number;
  byCategory: Record<SecurityCategory, number>;
  bySeverity: Record<SecuritySeverity, number>;
} {
  const byCategory: Record<SecurityCategory, number> = {
    secrets: 0, sqli: 0, xss: 0, "path-traversal": 0, "auth-bypass": 0,
    crypto: 0, dependencies: 0, injection: 0, ssrf: 0, misconfig: 0,
  };
  const bySeverity: Record<SecuritySeverity, number> = {
    critical: 0, high: 0, medium: 0, low: 0, info: 0,
  };

  for (const rule of BUILTIN_RULES) {
    byCategory[rule.category]++;
    bySeverity[rule.severity]++;
  }

  return { total: BUILTIN_RULES.length, byCategory, bySeverity };
}

export function listRules(): BuiltinRule[] {
  return BUILTIN_RULES;
}
