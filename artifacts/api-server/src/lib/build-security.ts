/**
 * Phase 15 Task 10: Security Boundaries
 *
 * Comprehensive security system for Build Mode:
 * - Command allow/deny rules (configurable per project/agent)
 * - Secret redaction (API keys, tokens, passwords never in logs/context)
 * - Environment variable protection (scoped access, no cross-project leakage)
 * - Workspace sandboxing (worktree isolation, no parent directory escape)
 * - Filesystem boundaries (allowlist/blocklist paths)
 * - Network permissions (allowlist domains, block egress by default)
 * - Destructive command confirmation (rm -rf, git push --force, DB migrations)
 * - Tool permissions per agent (planner: read-only, coder: write, reviewer: read, fixer: write)
 * - Self-modification guardrails (only artifacts/ allowed, never core config/secrets)
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getWorkspaceRoot, safeWorkspacePath, hasIsolated, isolatedPath } from "./workspace";
import { logBuildEvent } from "./build-telemetry";

// ============================================
// Types
// ============================================

export type AgentRole = "planner" | "coder" | "reviewer" | "fixer" | "human" | "diagnostic";

export interface SecurityConfig {
  projectId: string;
  // Command rules
  allowedCommands: string[];
  deniedCommands: string[];
  // Filesystem boundaries
  allowedPaths: string[];      // Relative to workspace root
  blockedPaths: string[];      // Relative to workspace root
  // Network permissions
  allowedDomains: string[];    // Domain allowlist (e.g., "api.github.com", "*.npmjs.org")
  blockedDomains: string[];    // Domain blocklist
  // Agent tool permissions
  agentPermissions: Record<AgentRole, AgentToolPermissions>;
  // Destructive commands requiring confirmation
  destructiveCommands: string[];
  // Secret patterns to redact
  secretPatterns: RegExp[];
  // Self-modification guardrails
  selfModAllowedPaths: string[];
  selfModBlockedPaths: string[];
}

export interface AgentToolPermissions {
  read: boolean;
  write: boolean;
  execute: boolean;
  network: boolean;
  browser: boolean;
  git: boolean;
  destructive: boolean;
  selfModify: boolean;
}

export interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
  confirmationMessage?: string;
  sanitizedCommand?: string;
}

export interface RedactionResult {
  sanitized: string;
  redactedCount: number;
  patterns: string[];
}

// ============================================
// Default Security Configuration
// ============================================

export const DEFAULT_SECURITY_CONFIG: Omit<SecurityConfig, "projectId"> = {
  // Command rules - deny by default, explicit allow
  allowedCommands: [
    "npm", "pnpm", "yarn", "bun",
    "node", "tsc", "vite", "next", "webpack", "esbuild",
    "git", "ls", "cat", "head", "tail", "grep", "find",
    "mkdir", "cp", "mv", "touch",
    "curl", "wget", // network commands - domain checked separately
    "python3", "pip", "pip3",
    "go", "cargo", "rustc",
    "docker", "docker-compose",
    "ps", "top", "htop", "free", "df",
  ],
  deniedCommands: [
    "rm -rf /",
    "rm -rf /*",
    "dd if=",
    "mkfs",
    "fdisk",
    "shutdown",
    "reboot",
    "halt",
    "poweroff",
    "init 0",
    "init 6",
    ":(){ :|:& };:", // fork bomb
    "chmod 777 /",
    "chown -R",
    "passwd",
    "su -",
    "sudo",
  ],

  // Filesystem boundaries - workspace only by default
  allowedPaths: ["**/*"],
  blockedPaths: [
    ".git/**",
    "node_modules/**",
    ".env*",
    "*.pem",
    "*.key",
    "*.crt",
    "id_rsa*",
    "id_ed25519*",
    "*.p12",
    "*.pfx",
    "secrets/**",
    "credentials/**",
    ".aws/**",
    ".ssh/**",
    ".gnupg/**",
    "**/.docker/config.json",
    "**/auth.json",
    "**/npmrc",
    "**/yarnrc",
  ],

  // Network permissions - deny by default
  allowedDomains: [
    "registry.npmjs.org",
    "registry.yarnpkg.com",
    "api.github.com",
    "github.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
    "api.openai.com",
    "openrouter.ai",
    "integrations.nvidia.com",
    "api.tavily.com",
    "*.npmjs.org",
    "*.github.com",
    "*.githubusercontent.com",
  ],
  blockedDomains: [],

  // Agent tool permissions by role
  agentPermissions: {
    planner: { read: true, write: false, execute: false, network: true, browser: false, git: false, destructive: false, selfModify: false },
    coder: { read: true, write: true, execute: true, network: true, browser: true, git: true, destructive: false, selfModify: false },
    reviewer: { read: true, write: false, execute: false, network: true, browser: false, git: false, destructive: false, selfModify: false },
    fixer: { read: true, write: true, execute: true, network: true, browser: true, git: true, destructive: false, selfModify: false },
    human: { read: true, write: true, execute: true, network: true, browser: true, git: true, destructive: true, selfModify: true },
    diagnostic: { read: true, write: false, execute: true, network: true, browser: false, git: false, destructive: false, selfModify: false },
  },

  // Destructive commands requiring explicit confirmation
  destructiveCommands: [
    "rm -rf",
    "rm -r",
    "git push --force",
    "git push -f",
    "git reset --hard",
    "git clean -fd",
    "npm publish",
    "pnpm publish",
    "yarn publish",
    "docker rmi",
    "docker system prune",
    "drop database",
    "drop table",
    "truncate table",
    "DELETE FROM",
    "DROP SCHEMA",
    "migrate down",
    "db:migrate:down",
  ],

  // Secret patterns for redaction
  secretPatterns: [
    // API Keys
    /(sk-[a-zA-Z0-9]{32,})/g,                    // OpenAI
    /(sk-ant-[a-zA-Z0-9\-_]{95,})/g,             // Anthropic
    /(xai-[a-zA-Z0-9]{32,})/g,                   // xAI
    /(nvapi-[a-zA-Z0-9\-_]{64,})/g,              // NVIDIA
    /(tvly-[a-zA-Z0-9]{32,})/g,                  // Tavily
    /(ghp_[a-zA-Z0-9]{36})/g,                    // GitHub PAT
    /(github_pat_[a-zA-Z0-9_]{82,})/g,           // GitHub fine-grained
    /(glpat-[a-zA-Z0-9\-_]{20,})/g,              // GitLab
    // Generic patterns
    /(["']?(?:api[_-]?key|secret|token|password|passwd|auth[_-]?token)["']?\s*[:=]\s*["']?)([a-zA-Z0-9\-_\.]{16,})/gi,
    // AWS
    /(AKIA[0-9A-Z]{16})/g,
    /([a-zA-Z0-9/+=]{40})/g, // AWS secret key (base64-ish)
    // Database URLs
    /(postgres(?:ql)?:\/\/[^:]+:[^@]+@[^\/]+\/\w+)/g,
    /(mysql:\/\/[^:]+:[^@]+@[^\/]+\/\w+)/g,
    /(mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@[^\/]+\/\w+)/g,
    // Private keys
    /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/g,
    // JWT
    /(eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})/g,
  ],

  // Self-modification guardrails
  selfModAllowedPaths: [
    "artifacts/**",
    "!artifacts/**/node_modules/**",
    "!artifacts/**/.git/**",
  ],
  selfModBlockedPaths: [
    "**/package.json",           // Root package.json
    "**/tsconfig.json",          // Root tsconfig
    "**/.env*",                  // Environment files
    "**/secrets/**",
    "**/credentials/**",
    "**/*.pem",
    "**/*.key",
    "**/docker-compose*.yml",
    "**/Dockerfile*",
    "**/.github/workflows/**",
    "**/lib/db/**",              // Database schema
    "**/lib/auth/**",            // Auth system
    "**/middleware/**",          // Security middleware
    "**/server.ts",              // Main server
    "**/build.mjs",              // Build config
    "**/tsconfig.json",          // TypeScript config
    "**/vite.config.ts",         // Vite config
    "**/tailwind.config.ts",     // Tailwind config
  ],
};

// ============================================
// Security Manager Class
// ============================================

export class SecurityManager {
  private config: SecurityConfig;
  private projectId: string;

  constructor(projectId: string, customConfig?: Partial<SecurityConfig>) {
    this.projectId = projectId;
    this.config = {
      projectId,
      ...DEFAULT_SECURITY_CONFIG,
      ...customConfig,
      agentPermissions: {
        ...DEFAULT_SECURITY_CONFIG.agentPermissions,
        ...customConfig?.agentPermissions,
      },
    } as SecurityConfig;
  }

  getConfig(): SecurityConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<SecurityConfig>): void {
    this.config = { ...this.config, ...updates };
    if (updates.agentPermissions) {
      this.config.agentPermissions = { ...this.config.agentPermissions, ...updates.agentPermissions };
    }
  }

  // ============================================
  // Command Validation
  // ============================================

  /**
   * Check if a command is allowed
   */
  checkCommand(command: string, agentRole: AgentRole = "coder"): SecurityCheckResult {
    const perms = this.config.agentPermissions[agentRole];

    // Check if agent has execute permission
    if (!perms.execute) {
      return { allowed: false, reason: `Agent role '${agentRole}' does not have execute permission` };
    }

    const trimmed = command.trim().toLowerCase();

    // Check explicit deny list first
    for (const denied of this.config.deniedCommands) {
      if (trimmed.includes(denied.toLowerCase())) {
        return { allowed: false, reason: `Command matches denied pattern: ${denied}` };
      }
    }

    // Check destructive commands
    for (const destructive of this.config.destructiveCommands) {
      if (trimmed.includes(destructive.toLowerCase())) {
        if (!perms.destructive) {
          return {
            allowed: false,
            reason: `Destructive command requires elevated permissions: ${destructive}`,
            requiresConfirmation: true,
            confirmationMessage: `This command is destructive: "${command}". Are you sure you want to proceed?`,
          };
        }
        return {
          allowed: true,
          requiresConfirmation: true,
          confirmationMessage: `This command is destructive: "${command}". Are you sure you want to proceed?`,
        };
      }
    }

    // Check allow list (if not empty, command must match)
    if (this.config.allowedCommands.length > 0) {
      const allowed = this.config.allowedCommands.some(allowed =>
        trimmed.startsWith(allowed.toLowerCase()) || trimmed.includes(allowed.toLowerCase())
      );
      if (!allowed) {
        return { allowed: false, reason: `Command not in allowlist: ${command}` };
      }
    }

    return { allowed: true, sanitizedCommand: command };
  }

  // ============================================
  // Filesystem Access Control
  // ============================================

  /**
   * Check if a file path is accessible
   */
  checkPathAccess(filePath: string, operation: "read" | "write" | "execute", agentRole: AgentRole = "coder"): SecurityCheckResult {
    const perms = this.config.agentPermissions[agentRole];

    // Check basic permission
    if (operation === "read" && !perms.read) {
      return { allowed: false, reason: `Agent role '${agentRole}' does not have read permission` };
    }
    if (operation === "write" && !perms.write) {
      return { allowed: false, reason: `Agent role '${agentRole}' does not have write permission` };
    }
    if (operation === "execute" && !perms.execute) {
      return { allowed: false, reason: `Agent role '${agentRole}' does not have execute permission` };
    }

    // Normalize path
    const normalized = path.normalize(filePath).replace(/\\/g, "/");

    // Check blocked paths first
    for (const blocked of this.config.blockedPaths) {
      if (this.matchGlob(normalized, blocked)) {
        return { allowed: false, reason: `Path blocked by security policy: ${blocked}` };
      }
    }

    // Check allowed paths
    const allowed = this.config.allowedPaths.some(allowed => this.matchGlob(normalized, allowed));
    if (!allowed) {
      return { allowed: false, reason: `Path not in allowlist: ${filePath}` };
    }

    // Additional check: ensure path is within workspace
    const workspaceRoot = getWorkspaceRoot(this.projectId);
    const fullPath = path.resolve(workspaceRoot, filePath);
    if (!fullPath.startsWith(workspaceRoot)) {
      return { allowed: false, reason: `Path escapes workspace: ${filePath}` };
    }

    return { allowed: true };
  }

  /**
   * Safe workspace path with security check
   */
  getSafePath(filePath: string, operation: "read" | "write" = "read", agentRole: AgentRole = "coder"): string | null {
    const check = this.checkPathAccess(filePath, operation, agentRole);
    if (!check.allowed) {
      return null;
    }
    return safeWorkspacePath(filePath, this.projectId);
  }

  // ============================================
  // Network Access Control
  // ============================================

  /**
   * Check if a network request to a domain is allowed
   */
  checkNetworkAccess(url: string, agentRole: AgentRole = "coder"): SecurityCheckResult {
    const perms = this.config.agentPermissions[agentRole];

    if (!perms.network) {
      return { allowed: false, reason: `Agent role '${agentRole}' does not have network permission` };
    }

    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();

      // Check blocked domains
      for (const blocked of this.config.blockedDomains) {
        if (this.matchDomain(hostname, blocked)) {
          return { allowed: false, reason: `Domain blocked by security policy: ${blocked}` };
        }
      }

      // Check allowed domains (if list not empty)
      if (this.config.allowedDomains.length > 0) {
        const allowed = this.config.allowedDomains.some(allowed => this.matchDomain(hostname, allowed));
        if (!allowed) {
          return { allowed: false, reason: `Domain not in allowlist: ${hostname}` };
        }
      }

      return { allowed: true };
    } catch {
      return { allowed: false, reason: `Invalid URL: ${url}` };
    }
  }

  // ============================================
  // Secret Redaction
  // ============================================

  /**
   * Redact secrets from a string
   */
  redactSecrets(text: string): RedactionResult {
    let sanitized = text;
    let redactedCount = 0;
    const matchedPatterns: string[] = [];

    for (const pattern of this.config.secretPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        redactedCount += matches.length;
        matchedPatterns.push(pattern.source);
        sanitized = sanitized.replace(pattern, (match) => {
          // Keep first 4 and last 4 chars for identification
          if (match.length > 8) {
            return `${match.slice(0, 4)}***REDACTED***${match.slice(-4)}`;
          }
          return "***REDACTED***";
        });
      }
    }

    return { sanitized, redactedCount, patterns: matchedPatterns };
  }

  /**
   * Redact secrets from an object (recursive)
   */
  redactObject(obj: unknown): unknown {
    if (typeof obj === "string") {
      return this.redactSecrets(obj).sanitized;
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.redactObject(item));
    }
    if (obj && typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        // Redact keys that look like secrets
        if (/password|secret|token|key|auth/i.test(key)) {
          result[key] = "***REDACTED***";
        } else {
          result[key] = this.redactObject(value);
        }
      }
      return result;
    }
    return obj;
  }

  // ============================================
  // Environment Variable Protection
  // ============================================

  /**
   * Get environment variables scoped to this project
   */
  getScopedEnv(): Record<string, string> {
    const prefix = `INFINITY_${this.projectId.toUpperCase()}_`;
    const scoped: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(prefix)) {
        scoped[key.slice(prefix.length)] = value || "";
      }
    }

    // Always include safe globals
    const safeGlobals = ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL", "TZ"];
    for (const key of safeGlobals) {
      if (process.env[key]) {
        scoped[key] = process.env[key]!;
      }
    }

    return scoped;
  }

  /**
   * Check if an environment variable access is allowed
   */
  checkEnvAccess(key: string): boolean {
    // Allow safe globals
    const safeGlobals = ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL", "TZ", "NODE_ENV"];
    if (safeGlobals.includes(key.toUpperCase())) return true;

    // Allow project-scoped vars
    const prefix = `INFINITY_${this.projectId.toUpperCase()}_`;
    if (key.startsWith(prefix)) return true;

    return false;
  }

  // ============================================
  // Workspace Sandboxing
  // ============================================

  /**
   * Verify workspace isolation
   */
  async verifyWorkspaceIsolation(): Promise<{ isolated: boolean; issues: string[] }> {
    const issues: string[] = [];

    try {
      // Check if isolated worktree exists
      if (!hasIsolated(this.projectId)) {
        issues.push("No isolated worktree for project");
        return { isolated: false, issues };
      }

      const worktreePath = isolatedPath(this.projectId);
      const workspaceRoot = getWorkspaceRoot(this.projectId);

      // Verify worktree is within workspace root
      if (!worktreePath.startsWith(workspaceRoot)) {
        issues.push("Worktree escapes workspace root");
      }

      // Check for symlinks that escape
      try {
        const realWorktree = await fs.realpath(worktreePath);
        const realWorkspace = await fs.realpath(workspaceRoot);
        if (!realWorktree.startsWith(realWorkspace)) {
          issues.push("Worktree symlink escapes workspace root");
        }
      } catch {
        issues.push("Cannot resolve worktree realpath");
      }

      // Check .infinity marker exists
      try {
        await fs.access(path.join(worktreePath, ".infinity"));
      } catch {
        issues.push("Missing .infinity workspace marker");
      }

      return { isolated: issues.length === 0, issues };
    } catch (err) {
      return { isolated: false, issues: [`Verification error: ${err instanceof Error ? err.message : String(err)}`] };
    }
  }

  // ============================================
  // Self-Modification Guardrails
  // ============================================

  /**
   * Check if a file modification is allowed for self-modification
   */
  checkSelfModification(filePath: string): SecurityCheckResult {
    const normalized = path.normalize(filePath).replace(/\\/g, "/");

    // Check blocked paths first
    for (const blocked of this.config.selfModBlockedPaths) {
      if (this.matchGlob(normalized, blocked)) {
        return { allowed: false, reason: `Self-modification blocked: ${blocked} (core config/secrets protected)` };
      }
    }

    // Check allowed paths
    const allowed = this.config.selfModAllowedPaths.some(allowed => this.matchGlob(normalized, allowed));
    if (!allowed) {
      return { allowed: false, reason: `Self-modification not allowed outside artifacts/: ${filePath}` };
    }

    return { allowed: true };
  }

  // ============================================
  // Agent Tool Access
  // ============================================

  /**
   * Check if an agent can use a specific tool
   */
  checkToolAccess(toolName: string, agentRole: AgentRole): SecurityCheckResult {
    const perms = this.config.agentPermissions[agentRole];

    // Tool categories
    const readTools = ["list_files", "read_file", "git_diff"];
    const writeTools = ["edit_file"];
    const executeTools = ["run_command"];
    const networkTools = ["run_command"]; // when making network calls
    const browserTools = ["screenshot", "inspect_dom", "inspect_console", "inspect_accessibility"];
    const gitTools = ["git_diff"];

    if (readTools.includes(toolName) && !perms.read) {
      return { allowed: false, reason: `Agent role '${agentRole}' cannot use read tool: ${toolName}` };
    }
    if (writeTools.includes(toolName) && !perms.write) {
      return { allowed: false, reason: `Agent role '${agentRole}' cannot use write tool: ${toolName}` };
    }
    if (executeTools.includes(toolName) && !perms.execute) {
      return { allowed: false, reason: `Agent role '${agentRole}' cannot use execute tool: ${toolName}` };
    }
    if (browserTools.includes(toolName) && !perms.browser) {
      return { allowed: false, reason: `Agent role '${agentRole}' cannot use browser tool: ${toolName}` };
    }
    if (gitTools.includes(toolName) && !perms.git) {
      return { allowed: false, reason: `Agent role '${agentRole}' cannot use git tool: ${toolName}` };
    }

    return { allowed: true };
  }

  // ============================================
  // Audit Logging
  // ============================================

  /**
   * Log a security event
   */
  async logSecurityEvent(
    event: "command_allowed" | "command_denied" | "path_access_allowed" | "path_access_denied" |
         "network_allowed" | "network_denied" | "destructive_confirmed" | "secret_redacted" |
         "self_mod_allowed" | "self_mod_denied" | "tool_access_allowed" | "tool_access_denied",
    details: Record<string, unknown>
  ): Promise<void> {
    await logBuildEvent(this.projectId, "security", `Security: ${event}`, {
      data: { event, ...details },
    });
  }

  // ============================================
  // Utility: Glob Matching
  // ============================================

  private matchGlob(str: string, pattern: string): boolean {
    // Convert glob to regex
    const regexPattern = pattern
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, "___DOUBLE_STAR___")
      .replace(/\*/g, "[^/]*")
      .replace(/___DOUBLE_STAR___/g, ".*")
      .replace(/\?/g, ".");
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(str);
  }

  private matchDomain(hostname: string, pattern: string): boolean {
    const patternLower = pattern.toLowerCase();
    if (patternLower.startsWith("*.")) {
      const suffix = patternLower.slice(2);
      return hostname === suffix || hostname.endsWith("." + suffix);
    }
    return hostname === patternLower;
  }
}

// ============================================
// Factory & Helpers
// ============================================

const securityManagers = new Map<string, SecurityManager>();

/**
 * Get or create security manager for a project
 */
export function getSecurityManager(projectId: string, customConfig?: Partial<SecurityConfig>): SecurityManager {
  let manager = securityManagers.get(projectId);
  if (!manager) {
    manager = new SecurityManager(projectId, customConfig);
    securityManagers.set(projectId, manager);
  } else if (customConfig) {
    manager.updateConfig(customConfig);
  }
  return manager;
}

/**
 * Create a security manager with project-specific config from database
 * (Placeholder - would load from DB in production)
 */
export async function createSecurityManagerFromConfig(projectId: string): Promise<SecurityManager> {
  // In production, load from database
  // For now, return default
  return getSecurityManager(projectId);
}

// ============================================
// Middleware for Tool Execution
// ============================================

export interface SecureToolContext {
  projectId: string;
  agentRole: AgentRole;
  securityManager: SecurityManager;
}

export async function secureExecuteTool(
  context: SecureToolContext,
  toolName: string,
  args: Record<string, unknown>,
  executeFn: () => Promise<{ success: boolean; result?: unknown; error?: string }>
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const { projectId, agentRole, securityManager } = context;

  // Check tool access
  const toolCheck = securityManager.checkToolAccess(toolName, agentRole);
  await securityManager.logSecurityEvent(
    toolCheck.allowed ? "tool_access_allowed" : "tool_access_denied",
    { tool: toolName, agentRole, reason: toolCheck.reason }
  );

  if (!toolCheck.allowed) {
    return { success: false, error: toolCheck.reason };
  }

  // Check specific tool arguments for security
  if (toolName === "run_command") {
    const command = args.command as string;
    const cmdCheck = securityManager.checkCommand(command, agentRole);
    await securityManager.logSecurityEvent(
      cmdCheck.allowed ? "command_allowed" : "command_denied",
      { command, agentRole, reason: cmdCheck.reason, requiresConfirmation: cmdCheck.requiresConfirmation }
    );

    if (!cmdCheck.allowed) {
      return { success: false, error: cmdCheck.reason };
    }

    if (cmdCheck.requiresConfirmation) {
      // In a real implementation, this would pause and wait for human confirmation
      // For now, we'll log and require the caller to handle confirmation
      return {
        success: false,
        error: `Confirmation required: ${cmdCheck.confirmationMessage}`,
        result: { requiresConfirmation: true, message: cmdCheck.confirmationMessage }
      };
    }
  }

  if (toolName === "edit_file" || toolName === "read_file") {
    const filePath = args.path as string;
    const operation = toolName === "edit_file" ? "write" : "read";
    const pathCheck = securityManager.checkPathAccess(filePath, operation, agentRole);
    await securityManager.logSecurityEvent(
      pathCheck.allowed ? "path_access_allowed" : "path_access_denied",
      { path: filePath, operation, agentRole, reason: pathCheck.reason }
    );

    if (!pathCheck.allowed) {
      return { success: false, error: pathCheck.reason };
    }
  }

  // Execute the tool
  return await executeFn();
}

// ============================================
// Exports
// ============================================

export default SecurityManager;