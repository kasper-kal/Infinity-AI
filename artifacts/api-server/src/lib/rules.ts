import { z } from "zod";
import { glob } from "glob";
import { readFile, writeFile, mkdir, stat, readdir } from "fs/promises";
import { join, dirname, relative, extname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Rule types and configuration for Cursor-style personalization
 */

// Rule kinds
export enum RuleKind {
  ALWAYS = "always",           // Always included in context
  AUTO_ATTACHED = "auto-attached", // Auto-included based on glob patterns
  AGENT_REQUESTED = "agent-requested" // Only included when agent explicitly requests
}

// Rule scope
export enum RuleScope {
  USER = "user",       // Global user preferences (~/.infinity/rules/)
  PROJECT = "project", // Project-specific (.infinity/rules/)
  TASK = "task"        // Task-specific (inline)
}

// Rule definition schema
export const RuleDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  kind: z.nativeEnum(RuleKind).default(RuleKind.ALWAYS),
  scope: z.nativeEnum(RuleScope).default(RuleScope.PROJECT),
  globs: z.array(z.string()).default([]),     // File patterns for auto-attached
  tags: z.array(z.string()).default([]),      // Categorization tags
  priority: z.number().default(0),            // Higher = more important
  enabled: z.boolean().default(true),
  content: z.string(),                        // The actual rule content (markdown)
  metadata: z.record(z.unknown()).default({}) // Extensible metadata
});

export type RuleDefinition = z.infer<typeof RuleDefinitionSchema>;

// Parsed rule file with frontmatter
export const ParsedRuleFileSchema = z.object({
  path: z.string(),
  relativePath: z.string(),
  frontmatter: RuleDefinitionSchema,
  content: z.string(),        // Full file content
  body: z.string(),           // Content after frontmatter
  valid: z.boolean(),
  errors: z.array(z.string()).default([])
});

export type ParsedRuleFile = z.infer<typeof ParsedRuleFileSchema>;

// Rule collection per scope
export const RuleCollectionSchema = z.object({
  scope: z.nativeEnum(RuleScope),
  rules: z.array(ParsedRuleFileSchema),
  totalCount: z.number(),
  enabledCount: z.number(),
  lastLoaded: z.number()
});

export type RuleCollection = z.infer<typeof RuleCollectionSchema>;

// Merged rules for a context
export const MergedRulesSchema = z.object({
  userRules: z.array(ParsedRuleFileSchema),
  projectRules: z.array(ParsedRuleFileSchema),
  taskRules: z.array(ParsedRuleFileSchema),
  autoAttachedRules: z.array(ParsedRuleFileSchema),
  alwaysRules: z.array(ParsedRuleFileSchema),
  allRules: z.array(ParsedRuleFileSchema),
  contextSummary: z.string()
});

export type MergedRules = z.infer<typeof MergedRulesSchema>;

// Rule templates
export const RuleTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  content: z.string(),  // Template content with placeholders
  frontmatter: z.object({
    kind: z.nativeEnum(RuleKind).default(RuleKind.ALWAYS),
    globs: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([])
  }).default({})
});

export type RuleTemplate = z.infer<typeof RuleTemplateSchema>;

// Built-in rule templates
export const BUILTIN_RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: "coding-style",
    name: "Coding Style Guide",
    description: "Enforce consistent code formatting and patterns",
    category: "conventions",
    content: `# Coding Style Guide

## General
- Use TypeScript strict mode
- Prefer const over let
- Use functional components with hooks
- Avoid any, use unknown or proper types

## Naming
- PascalCase for components/types
- camelCase for variables/functions
- UPPER_SNAKE_CASE for constants

## Imports
- Group: external → internal → relative
- Use path aliases (@/, ~/)
- Sort alphabetically within groups`,
    frontmatter: { kind: RuleKind.ALWAYS, tags: ["style", "typescript", "react"] }
  },
  {
    id: "testing-conventions",
    name: "Testing Conventions",
    description: "Standard testing patterns and expectations",
    category: "conventions",
    content: `# Testing Conventions

## Unit Tests
- Use Vitest for unit tests
- Test file: \`Component.test.tsx\`
- Use \`describe\`/\`it\` with clear names
- Mock external dependencies

## Integration Tests
- Test file: \`Component.integration.test.tsx\`
- Use real implementations where possible
- Test user flows, not implementation

## E2E Tests
- Use Playwright
- Test critical user journeys
- Run in CI on every PR`,
    frontmatter: { kind: RuleKind.ALWAYS, tags: ["testing", "vitest", "playwright"] }
  },
  {
    id: "git-workflow",
    name: "Git Workflow Rules",
    description: "Commit message format and branching strategy",
    category: "workflow",
    content: `# Git Workflow

## Branches
- main: production-ready
- develop: integration branch
- feature/*, fix/*, chore/*: work branches

## Commits
- Conventional Commits: \`type(scope): message\`
- Types: feat, fix, docs, style, refactor, test, chore
- Scope: component/module affected
- Body: explain WHY, not WHAT

## PRs
- Link to issue/ticket
- Include test plan
- Require 1 review minimum`,
    frontmatter: { kind: RuleKind.ALWAYS, tags: ["git", "workflow", "commits"] }
  },
  {
    id: "react-patterns",
    name: "React Component Patterns",
    description: "Preferred React patterns and anti-patterns",
    category: "patterns",
    content: `# React Patterns

## Do
- Use composition over inheritance
- Prefer custom hooks for logic reuse
- Use React.memo for expensive renders
- Colocate state with components that need it

## Don't
- Don't use class components
- Don't mutate props or state directly
- Don't use useEffect for derived state
- Don't create components inside render`,
    frontmatter: { kind: RuleKind.ALWAYS, tags: ["react", "patterns", "hooks"] }
  },
  {
    id: "api-design",
    name: "API Design Guidelines",
    description: "REST/GraphQL API design conventions",
    category: "architecture",
    content: `# API Design Guidelines

## REST
- Use plural nouns: /api/users, /api/projects
- Version in URL: /api/v1/
- Status codes: 200, 201, 400, 401, 404, 500
- Pagination: cursor-based for lists

## Errors
- Consistent error format:
\`\`\`json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": {} } }
\`\`\`

## Security
- Rate limit all endpoints
- Validate all inputs
- Use scopes for authorization`,
    frontmatter: { kind: RuleKind.AUTO_ATTACHED, globs: ["**/routes/**/*.ts", "**/api/**/*.ts"], tags: ["api", "rest", "security"] }
  },
  {
    id: "database-patterns",
    name: "Database Access Patterns",
    description: "Preferred ORM usage and query patterns",
    category: "patterns",
    content: `# Database Patterns

## Drizzle ORM
- Define schema in \`schema/\` directory
- Use \`db.select().from()\` for reads
- Use transactions for multi-step writes
- Use \`$onUpdate\` for timestamps

## Queries
- Avoid N+1: use joins or batch loading
- Index foreign keys and query columns
- Use prepared statements for repeated queries

## Migrations
- Name: \`YYYYMMDD_description.sql\`
- Test migration up + down
- Never edit applied migrations`,
    frontmatter: { kind: RuleKind.AUTO_ATTACHED, globs: ["**/db/**/*.ts", "**/schema/**/*.ts"], tags: ["database", "drizzle", "sql"] }
  }
];

/**
 * Rules Engine - Loads, parses, and manages rules
 */
export class RulesEngine {
  private userRulesDir: string;
  private projectRulesDir: string;
  private cache: Map<string, RuleCollection> = new Map();
  private watchers: Map<string, any> = new Map();

  constructor(
    userRulesDir: string = join(process.env.HOME || "", ".infinity", "rules"),
    projectRulesDir: string = join(process.cwd(), ".infinity", "rules")
  ) {
    this.userRulesDir = userRulesDir;
    this.projectRulesDir = projectRulesDir;
  }

  /**
   * Load all rules for a project
   */
  async loadRules(projectRoot: string): Promise<MergedRules> {
    const userRules = await this.loadRulesFromDir(this.userRulesDir, RuleScope.USER);
    const projectRules = await this.loadRulesFromDir(
      join(projectRoot, ".infinity", "rules"),
      RuleScope.PROJECT
    );

    const allRules = [...userRules.rules, ...projectRules.rules];

    // Categorize rules
    const alwaysRules = allRules.filter(r => r.frontmatter.kind === RuleKind.ALWAYS && r.frontmatter.enabled);
    const autoAttachedRules = allRules.filter(r => r.frontmatter.kind === RuleKind.AUTO_ATTACHED && r.frontmatter.enabled);
    const agentRequestedRules = allRules.filter(r => r.frontmatter.kind === RuleKind.AGENT_REQUESTED && r.frontmatter.enabled);

    // Sort by priority (descending) then by scope (user first)
    const sortRules = (rules: ParsedRuleFile[]) => rules.sort((a, b) => {
      if (b.frontmatter.priority !== a.frontmatter.priority) {
        return b.frontmatter.priority - a.frontmatter.priority;
      }
      return a.frontmatter.scope === RuleScope.USER ? -1 : 1;
    });

    return {
      userRules: sortRules(userRules.rules.filter(r => r.valid)),
      projectRules: sortRules(projectRules.rules.filter(r => r.valid)),
      taskRules: [],
      autoAttachedRules: sortRules(autoAttachedRules),
      alwaysRules: sortRules(alwaysRules),
      allRules: sortRules(allRules.filter(r => r.valid)),
      contextSummary: this.generateContextSummary(alwaysRules, autoAttachedRules, agentRequestedRules)
    };
  }

  /**
   * Load rules from a directory
   */
  private async loadRulesFromDir(dir: string, scope: RuleScope): Promise<RuleCollection> {
    const cacheKey = `${scope}:${dir}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.lastLoaded < 5000) {
      return cached;
    }

    const rules: ParsedRuleFile[] = [];

    try {
      const files = await glob("**/*.{md,mdx,yaml,yml}", { cwd: dir, absolute: true });

      for (const file of files) {
        const parsed = await this.parseRuleFile(file, dir, scope);
        if (parsed.valid) {
          rules.push(parsed);
        }
      }
    } catch (error) {
      // Directory might not exist
    }

    const collection: RuleCollection = {
      scope,
      rules,
      totalCount: rules.length,
      enabledCount: rules.filter(r => r.frontmatter.enabled).length,
      lastLoaded: Date.now()
    };

    this.cache.set(cacheKey, collection);
    return collection;
  }

  /**
   * Parse a single rule file with frontmatter
   */
  private async parseRuleFile(
    absolutePath: string,
    baseDir: string,
    scope: RuleScope
  ): Promise<ParsedRuleFile> {
    const content = await readFile(absolutePath, "utf-8");
    const relativePath = relative(baseDir, absolutePath);
    const errors: string[] = [];

    // Parse frontmatter (--- YAML ---)
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let frontmatter: Partial<RuleDefinition> = { scope };
    let body = content;

    if (frontmatterMatch) {
      try {
        const yaml = frontmatterMatch[1];
        // Simple YAML parsing for frontmatter
        const parsed = this.parseSimpleYaml(yaml);
        frontmatter = { ...frontmatter, ...parsed };
        body = content.slice(frontmatterMatch[0].length).trimStart();
      } catch (e) {
        errors.push(`Invalid frontmatter: ${e}`);
      }
    }

    // Validate with schema
    const validation = RuleDefinitionSchema.safeParse({
      name: relativePath.replace(/\.(md|mdx|yaml|yml)$/, ""),
      ...frontmatter,
      content: body
    });

    if (!validation.success) {
      errors.push(...validation.error.errors.map(e => `${e.path.join(".")}: ${e.message}`));
    }

    return {
      path: absolutePath,
      relativePath,
      frontmatter: validation.success ? validation.data : RuleDefinitionSchema.parse({
        name: relativePath,
        scope,
        content: body
      }),
      content,
      body,
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Simple YAML parser for frontmatter
   */
  private parseSimpleYaml(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = yaml.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const colonIndex = trimmed.indexOf(":");
      if (colonIndex === -1) continue;

      const key = trimmed.slice(0, colonIndex).trim();
      let value = trimmed.slice(colonIndex + 1).trim();

      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Parse arrays
      if (value.startsWith("[") && value.endsWith("]")) {
        try {
          value = JSON.parse(value);
        } catch {
          value = value.slice(1, -1).split(",").map(v => v.trim());
        }
      }

      // Parse numbers
      if (!isNaN(Number(value)) && value !== "") {
        value = Number(value);
      }

      // Parse booleans
      if (value === "true") value = true;
      if (value === "false") value = false;

      result[key] = value;
    }

    return result;
  }

  /**
   * Generate context summary for LLM
   */
  private generateContextSummary(
    alwaysRules: ParsedRuleFile[],
    autoAttachedRules: ParsedRuleFile[],
    agentRequestedRules: ParsedRuleFile[]
  ): string {
    const parts: string[] = [];

    if (alwaysRules.length > 0) {
      parts.push(`**Always Active (${alwaysRules.length}):** ${alwaysRules.map(r => r.frontmatter.name).join(", ")}`);
    }
    if (autoAttachedRules.length > 0) {
      parts.push(`**Auto-Attached (${autoAttachedRules.length}):** ${autoAttachedRules.map(r => r.frontmatter.name).join(", ")}`);
    }
    if (agentRequestedRules.length > 0) {
      parts.push(`**Agent-Requested (${agentRequestedRules.length}):** ${agentRequestedRules.map(r => r.frontmatter.name).join(", ")}`);
    }

    return parts.join("\n") || "No rules loaded.";
  }

  /**
   * Get auto-attached rules for specific files
   */
  async getAutoAttachedRules(projectRoot: string, filePaths: string[]): Promise<ParsedRuleFile[]> {
    const { autoAttachedRules } = await this.loadRules(projectRoot);
    const matched: ParsedRuleFile[] = [];

    for (const rule of autoAttachedRules) {
      for (const globPattern of rule.frontmatter.globs) {
        for (const filePath of filePaths) {
          if (this.matchGlob(filePath, globPattern)) {
            matched.push(rule);
            break;
          }
        }
      }
    }

    return matched;
  }

  /**
   * Simple glob matching
   */
  private matchGlob(filePath: string, pattern: string): boolean {
    // Convert glob to regex
    const regexPattern = pattern
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, ".");
    return new RegExp(`^${regexPattern}$`).test(filePath);
  }

  /**
   * Create a new rule file
   */
  async createRule(
    projectRoot: string,
    rule: Omit<RuleDefinition, "content"> & { content: string }
  ): Promise<ParsedRuleFile> {
    const dir = join(projectRoot, ".infinity", "rules");
    await mkdir(dir, { recursive: true });

    const fileName = `${rule.name.toLowerCase().replace(/\s+/g, "-")}.md`;
    const filePath = join(dir, fileName);

    // Generate frontmatter
    const frontmatterLines = [
      "---",
      `name: "${rule.name}"`,
      `description: "${rule.description || ""}"`,
      `kind: "${rule.kind}"`,
      `scope: "${rule.scope}"`,
      `globs: [${rule.globs.map(g => `"${g}"`).join(", ")}]`,
      `tags: [${rule.tags.map(t => `"${t}"`).join(", ")}]`,
      `priority: ${rule.priority}`,
      `enabled: ${rule.enabled}`,
      "---",
      "",
      rule.content
    ].join("\n");

    await writeFile(filePath, frontmatterLines, "utf-8");

    // Invalidate cache
    this.cache.clear();

    return this.parseRuleFile(filePath, dir, rule.scope);
  }

  /**
   * Update an existing rule
   */
  async updateRule(
    projectRoot: string,
    relativePath: string,
    updates: Partial<RuleDefinition>
  ): Promise<ParsedRuleFile> {
    const absolutePath = join(projectRoot, ".infinity", "rules", relativePath);
    const existing = await this.parseRuleFile(absolutePath, join(projectRoot, ".infinity", "rules"), RuleScope.PROJECT);

    const newFrontmatter = { ...existing.frontmatter, ...updates };
    const frontmatterLines = [
      "---",
      `name: "${newFrontmatter.name}"`,
      `description: "${newFrontmatter.description || ""}"`,
      `kind: "${newFrontmatter.kind}"`,
      `scope: "${newFrontmatter.scope}"`,
      `globs: [${newFrontmatter.globs.map(g => `"${g}"`).join(", ")}]`,
      `tags: [${newFrontmatter.tags.map(t => `"${t}"`).join(", ")}]`,
      `priority: ${newFrontmatter.priority}`,
      `enabled: ${newFrontmatter.enabled}`,
      "---",
      "",
      updates.content || existing.body
    ].join("\n");

    await writeFile(absolutePath, frontmatterLines, "utf-8");
    this.cache.clear();

    return this.parseRuleFile(absolutePath, join(projectRoot, ".infinity", "rules"), RuleScope.PROJECT);
  }

  /**
   * Delete a rule
   */
  async deleteRule(projectRoot: string, relativePath: string): Promise<void> {
    const absolutePath = join(projectRoot, ".infinity", "rules", relativePath);
    const fs = await import("fs/promises");
    await fs.unlink(absolutePath);
    this.cache.clear();
  }

  /**
   * Get available templates
   */
  getTemplates(): RuleTemplate[] {
    return BUILTIN_RULE_TEMPLATES;
  }

  /**
   * Create rule from template
   */
  async createFromTemplate(
    projectRoot: string,
    templateId: string,
    overrides: Partial<RuleDefinition> = {}
  ): Promise<ParsedRuleFile> {
    const template = BUILTIN_RULE_TEMPLATES.find(t => t.id === templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    return this.createRule(projectRoot, {
      name: overrides.name || template.name,
      description: overrides.description || template.description,
      kind: overrides.kind || template.frontmatter.kind,
      scope: overrides.scope || RuleScope.PROJECT,
      globs: overrides.globs || template.frontmatter.globs,
      tags: overrides.tags || template.frontmatter.tags,
      priority: overrides.priority ?? 0,
      enabled: overrides.enabled ?? true,
      content: overrides.content || template.content
    });
  }
}

/**
 * Singleton instance
 */
let rulesEngineInstance: RulesEngine | null = null;

export function getRulesEngine(
  userRulesDir?: string,
  projectRulesDir?: string
): RulesEngine {
  if (!rulesEngineInstance) {
    rulesEngineInstance = new RulesEngine(userRulesDir, projectRulesDir);
  }
  return rulesEngineInstance;
}

export function resetRulesEngine(): void {
  rulesEngineInstance = null;
}