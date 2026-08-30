import { z } from "zod";
import { readFile, writeFile, mkdir, readdir, unlink, stat } from "fs/promises";
import { join, dirname, relative, basename, extname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Notepads System - Reusable context snippets for chat/composer/agent
 * Like Cursor's @notepad feature
 */

export enum NotepadCategory {
  ARCHITECTURE = "architecture",
  API_CONTRACTS = "api-contracts",
  PATTERNS = "patterns",
  DEBUGGING = "debugging",
  DECISIONS = "decisions",
  CONVENTIONS = "conventions",
  SNIPPETS = "snippets",
  CUSTOM = "custom"
}

export enum NotepadScope {
  USER = "user",           // ~/.infinity/notepads/
  PROJECT = "project",     // .infinity/notepads/
  TEAM = "team"            // Shared via git/project (future)
}

// Notepad frontmatter schema
export const NotepadFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  category: z.nativeEnum(NotepadCategory).default(NotepadCategory.CUSTOM),
  scope: z.nativeEnum(NotepadScope).default(NotepadScope.PROJECT),
  tags: z.array(z.string()).default([]),
  version: z.string().default("1.0.0"),
  author: z.string().optional(),
  createdAt: z.number().default(() => Date.now()),
  updatedAt: z.number().default(() => Date.now()),
  pinned: z.boolean().default(false)
});

export type NotepadFrontmatter = z.infer<typeof NotepadFrontmatterSchema>;

// Full notepad with content
export const NotepadSchema = z.object({
  id: z.string(),                    // filename without extension
  path: z.string(),                  // absolute path
  relativePath: z.string(),          // relative to notepads dir
  frontmatter: NotepadFrontmatterSchema,
  content: z.string(),               // full file content
  body: z.string(),                  // markdown body (after frontmatter)
  scope: z.nativeEnum(NotepadScope),
  valid: z.boolean(),
  errors: z.array(z.string()).default([])
});

export type Notepad = z.infer<typeof NotepadSchema>;

// Notepad collection
export const NotepadCollectionSchema = z.object({
  scope: z.nativeEnum(NotepadScope),
  notepads: z.array(NotepadSchema),
  totalCount: z.number(),
  pinnedCount: z.number(),
  byCategory: z.record(z.array(NotepadSchema)),
  lastLoaded: z.number()
});

export type NotepadCollection = z.infer<typeof NotepadCollectionSchema>;

// Search result
export const NotepadSearchResultSchema = z.object({
  notepad: NotepadSchema,
  score: z.number(),
  matchedFields: z.array(z.string())
});

export type NotepadSearchResult = z.infer<typeof NotepadSearchResultSchema>;

// @notepad reference in chat
export const NotepadReferenceSchema = z.object({
  name: z.string(),
  scope: z.nativeEnum(NotepadScope).optional(),
  resolved: z.boolean(),
  notepad: NotepadSchema.optional(),
  error: z.string().optional()
});

export type NotepadReference = z.infer<typeof NotepadReferenceSchema>;

// Built-in notepad templates
export const BUILTIN_NOTEPAD_TEMPLATES = [
  {
    id: "architecture-decision",
    name: "Architecture Decision Record",
    description: "Document key architectural decisions",
    category: NotepadCategory.ARCHITECTURE,
    content: `# Architecture Decision Record

## Context
What is the issue that we're seeing that is motivating this decision or change?

## Decision
What is the change that we're proposing or have decided to implement?

## Consequences
What becomes easier or more difficult to do because of this change?

### Positive
-

### Negative
-

### Neutral
-

## Alternatives Considered
What other options were evaluated?

## References
- Links to relevant docs, issues, PRs
`,
    frontmatter: { tags: ["adr", "architecture", "decision"] }
  },
  {
    id: "api-contract",
    name: "API Contract",
    description: "Define API interfaces and expectations",
    category: NotepadCategory.API_CONTRACTS,
    content: `# API Contract: [Endpoint Name]

## Overview
Brief description of what this API does.

## Endpoint
\`\`\`
METHOD /api/v1/resource
\`\`\`

## Request
### Headers
| Header | Required | Description |
|--------|----------|-------------|

### Query Parameters
| Param | Type | Required | Description |
|-------|------|----------|-------------|

### Body
\`\`\`json
{
  "field": "type"
}
\`\`\`

## Response
### Success (200/201)
\`\`\`json
{
  "data": {}
}
\`\`\`

### Errors
| Code | Reason |
|------|--------|

## Authentication
- Required scopes:

## Rate Limits
- Requests per minute:

## Examples
\`\`\`bash
curl -X POST ...
\`\`\`
`,
    frontmatter: { tags: ["api", "contract", "rest"] }
  },
  {
    id: "debugging-guide",
    name: "Debugging Guide",
    description: "Common issues and solutions",
    category: NotepadCategory.DEBUGGING,
    content: `# Debugging Guide: [Feature/Area]

## Common Issues

### Issue 1: [Symptom]
**Cause:**
**Solution:**
**Prevention:**

### Issue 2: [Symptom]
**Cause:**
**Solution:**
**Prevention:**

## Debugging Commands
\`\`\`bash
# Useful commands
\`\`\`

## Logs to Check
-

## Related Notepads
- @notepad:related-notepad
`,
    frontmatter: { tags: ["debugging", "troubleshooting"] }
  },
  {
    id: "coding-pattern",
    name: "Coding Pattern",
    description: "Reusable code pattern or snippet",
    category: NotepadCategory.PATTERNS,
    content: `# Pattern: [Pattern Name]

## Problem
What problem does this pattern solve?

## Solution
\`\`\`typescript
// Code example
\`\`\`

## When to Use
-

## When NOT to Use
-

## Variations
-

## Related Patterns
-
`,
    frontmatter: { tags: ["pattern", "snippet", "code"] }
  },
  {
    id: "project-conventions",
    name: "Project Conventions",
    description: "Team/project-specific conventions",
    category: NotepadCategory.CONVENTIONS,
    content: `# Project Conventions

## Code Style
-

## Naming Conventions
- Files:
- Components:
- Functions:
- Variables:

## Git Workflow
- Branch naming:
- Commit format:
- PR requirements:

## Testing
- Unit test pattern:
- Integration test pattern:
- E2E test pattern:

## Deployment
- Environments:
- Config management:
- Secrets handling:
`,
    frontmatter: { tags: ["conventions", "team", "standards"] }
  }
];

/**
 * Notepads Manager - CRUD, search, @notepad resolution
 */
export class NotepadsManager {
  private userNotepadsDir: string;
  private projectNotepadsDir: string;
  private cache: Map<string, NotepadCollection> = new Map();

  constructor(
    userNotepadsDir: string = join(process.env.HOME || "", ".infinity", "notepads"),
    projectNotepadsDir: string = join(process.cwd(), ".infinity", "notepads")
  ) {
    this.userNotepadsDir = userNotepadsDir;
    this.projectNotepadsDir = projectNotepadsDir;
  }

  /**
   * Load all notepads for a project
   */
  async loadNotepads(projectRoot: string): Promise<NotepadCollection[]> {
    const userNotepads = await this.loadFromDir(this.userNotepadsDir, NotepadScope.USER);
    const projectNotepads = await this.loadFromDir(
      join(projectRoot, ".infinity", "notepads"),
      NotepadScope.PROJECT
    );

    return [userNotepads, projectNotepads];
  }

  /**
   * Load notepads from a directory
   */
  private async loadFromDir(dir: string, scope: NotepadScope): Promise<NotepadCollection> {
    const cacheKey = `${scope}:${dir}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.lastLoaded < 5000) {
      return cached;
    }

    const notepads: Notepad[] = [];

    try {
      await mkdir(dir, { recursive: true });
      const files = await readdir(dir);

      for (const file of files) {
        if (!file.match(/\.(md|mdx)$/i)) continue;
        const filePath = join(dir, file);
        const parsed = await this.parseNotepadFile(filePath, dir, scope);
        if (parsed.valid) {
          notepads.push(parsed);
        }
      }
    } catch (error) {
      // Directory might not exist or be unreadable
    }

    // Group by category
    const byCategory: Record<string, Notepad[]> = {};
    for (const np of notepads) {
      const cat = np.frontmatter.category;
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(np);
    }

    const collection: NotepadCollection = {
      scope,
      notepads: notepads.sort((a, b) => {
        // Pinned first, then by updatedAt desc
        if (b.frontmatter.pinned !== a.frontmatter.pinned) {
          return b.frontmatter.pinned ? 1 : -1;
        }
        return b.frontmatter.updatedAt - a.frontmatter.updatedAt;
      }),
      totalCount: notepads.length,
      pinnedCount: notepads.filter(n => n.frontmatter.pinned).length,
      byCategory,
      lastLoaded: Date.now()
    };

    this.cache.set(cacheKey, collection);
    return collection;
  }

  /**
   * Parse a notepad file with frontmatter
   */
  private async parseNotepadFile(
    absolutePath: string,
    baseDir: string,
    scope: NotepadScope
  ): Promise<Notepad> {
    const content = await readFile(absolutePath, "utf-8");
    const relativePath = relative(baseDir, absolutePath);
    const id = basename(absolutePath, extname(absolutePath));
    const errors: string[] = [];

    // Parse frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let frontmatter: Partial<NotepadFrontmatter> = { scope };
    let body = content;

    if (frontmatterMatch) {
      try {
        const yaml = frontmatterMatch[1];
        const parsed = this.parseSimpleYaml(yaml);
        frontmatter = { ...frontmatter, ...parsed };
        body = content.slice(frontmatterMatch[0].length).trimStart();
      } catch (e) {
        errors.push(`Invalid frontmatter: ${e}`);
      }
    }

    // Validate
    const validation = NotepadFrontmatterSchema.safeParse({
      name: id,
      ...frontmatter
    });

    if (!validation.success) {
      errors.push(...validation.error.errors.map(e => `${e.path.join(".")}: ${e.message}`));
    }

    return {
      id,
      path: absolutePath,
      relativePath,
      frontmatter: validation.success ? validation.data : NotepadFrontmatterSchema.parse({ name: id }),
      content,
      body,
      scope,
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

      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (value.startsWith("[") && value.endsWith("]")) {
        try {
          value = JSON.parse(value);
        } catch {
          value = value.slice(1, -1).split(",").map(v => v.trim());
        }
      }

      if (!isNaN(Number(value)) && value !== "") {
        value = Number(value);
      }

      if (value === "true") value = true;
      if (value === "false") value = false;

      result[key] = value;
    }

    return result;
  }

  /**
   * Search notepads by query
   */
  async searchNotepads(
    projectRoot: string,
    query: string,
    options: { category?: NotepadCategory; scope?: NotepadScope; limit?: number } = {}
  ): Promise<NotepadSearchResult[]> {
    const collections = await this.loadNotepads(projectRoot);
    let allNotepads: Notepad[] = [];

    for (const coll of collections) {
      if (options.scope && coll.scope !== options.scope) continue;
      allNotepads.push(...coll.notepads);
    }

    if (options.category) {
      allNotepads = allNotepads.filter(n => n.frontmatter.category === options.category);
    }

    const queryLower = query.toLowerCase();
    const results: NotepadSearchResult[] = [];

    for (const np of allNotepads) {
      let score = 0;
      const matchedFields: string[] = [];

      // Name match (highest weight)
      if (np.frontmatter.name.toLowerCase().includes(queryLower)) {
        score += 10;
        matchedFields.push("name");
      }

      // Tag match
      for (const tag of np.frontmatter.tags) {
        if (tag.toLowerCase().includes(queryLower)) {
          score += 5;
          matchedFields.push(`tag:${tag}`);
        }
      }

      // Category match
      if (np.frontmatter.category.toLowerCase().includes(queryLower)) {
        score += 3;
        matchedFields.push("category");
      }

      // Body content match
      if (np.body.toLowerCase().includes(queryLower)) {
        score += 1;
        matchedFields.push("content");
      }

      // Description match
      if (np.frontmatter.description?.toLowerCase().includes(queryLower)) {
        score += 2;
        matchedFields.push("description");
      }

      if (score > 0) {
        results.push({ notepad: np, score, matchedFields });
      }
    }

    // Sort by score desc, then pinned, then updatedAt
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.notepad.frontmatter.pinned !== a.notepad.frontmatter.pinned) {
        return b.notepad.frontmatter.pinned ? 1 : -1;
      }
      return b.notepad.frontmatter.updatedAt - a.notepad.frontmatter.updatedAt;
    });

    return results.slice(0, options.limit || 20);
  }

  /**
   * Resolve @notepad:name references
   */
  async resolveReferences(
    projectRoot: string,
    references: string[] // e.g., ["@notepad:api-contract", "@notepad:project:debugging-guide"]
  ): Promise<NotepadReference[]> {
    const results: NotepadReference[] = [];

    for (const ref of references) {
      // Parse @notepad:name or @notepad:scope:name
      const match = ref.match(/^@notepad:(?:(\w+):)?(.+)$/);
      if (!match) {
        results.push({
          name: ref,
          resolved: false,
          error: "Invalid @notepad format. Use @notepad:name or @notepad:scope:name"
        });
        continue;
      }

      const [, scopePrefix, name] = match;
      const scope = scopePrefix === "user" ? NotepadScope.USER :
                    scopePrefix === "project" ? NotepadScope.PROJECT :
                    scopePrefix === "team" ? NotepadScope.TEAM : undefined;

      const collections = await this.loadNotepads(projectRoot);
      let found: Notepad | undefined;

      for (const coll of collections) {
        if (scope && coll.scope !== scope) continue;
        found = coll.notepads.find(n => n.id === name || n.frontmatter.name === name);
        if (found) break;
      }

      if (found) {
        results.push({
          name,
          scope: found.scope,
          resolved: true,
          notepad: found
        });
      } else {
        results.push({
          name,
          scope,
          resolved: false,
          error: `Notepad not found: ${name}${scope ? ` (scope: ${scope})` : ""}`
        });
      }
    }

    return results;
  }

  /**
   * Create a new notepad
   */
  async createNotepad(
    projectRoot: string,
    notepad: Omit<NotepadFrontmatter, "createdAt" | "updatedAt"> & { content: string; scope?: NotepadScope }
  ): Promise<Notepad> {
    const scope = notepad.scope || NotepadScope.PROJECT;
    const dir = scope === NotepadScope.USER ? this.userNotepadsDir : join(projectRoot, ".infinity", "notepads");
    await mkdir(dir, { recursive: true });

    const fileName = `${notepad.name.toLowerCase().replace(/\s+/g, "-")}.md`;
    const filePath = join(dir, fileName);

    // Check if exists
    try {
      await stat(filePath);
      throw new Error(`Notepad already exists: ${fileName}`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }

    const now = Date.now();
    const frontmatter = {
      ...notepad,
      createdAt: now,
      updatedAt: now
    };

    const frontmatterLines = [
      "---",
      `name: "${frontmatter.name}"`,
      `description: "${frontmatter.description || ""}"`,
      `category: "${frontmatter.category}"`,
      `scope: "${frontmatter.scope}"`,
      `tags: [${frontmatter.tags.map(t => `"${t}"`).join(", ")}]`,
      `version: "${frontmatter.version}"`,
      `author: "${frontmatter.author || ""}"`,
      `createdAt: ${frontmatter.createdAt}`,
      `updatedAt: ${frontmatter.updatedAt}`,
      `pinned: ${frontmatter.pinned}`,
      "---",
      "",
      notepad.content
    ].join("\n");

    await writeFile(filePath, frontmatterLines, "utf-8");
    this.cache.clear();

    return this.parseNotepadFile(filePath, dir, scope);
  }

  /**
   * Update an existing notepad
   */
  async updateNotepad(
    projectRoot: string,
    relativePath: string,
    scope: NotepadScope,
    updates: Partial<NotepadFrontmatter> & { content?: string }
  ): Promise<Notepad> {
    const dir = scope === NotepadScope.USER ? this.userNotepadsDir : join(projectRoot, ".infinity", "notepads");
    const absolutePath = join(dir, relativePath);
    const existing = await this.parseNotepadFile(absolutePath, dir, scope);

    const newFrontmatter = { ...existing.frontmatter, ...updates, updatedAt: Date.now() };
    const frontmatterLines = [
      "---",
      `name: "${newFrontmatter.name}"`,
      `description: "${newFrontmatter.description || ""}"`,
      `category: "${newFrontmatter.category}"`,
      `scope: "${newFrontmatter.scope}"`,
      `tags: [${newFrontmatter.tags.map(t => `"${t}"`).join(", ")}]`,
      `version: "${newFrontmatter.version}"`,
      `author: "${newFrontmatter.author || ""}"`,
      `createdAt: ${newFrontmatter.createdAt}`,
      `updatedAt: ${newFrontmatter.updatedAt}`,
      `pinned: ${newFrontmatter.pinned}`,
      "---",
      "",
      updates.content || existing.body
    ].join("\n");

    await writeFile(absolutePath, frontmatterLines, "utf-8");
    this.cache.clear();

    return this.parseNotepadFile(absolutePath, dir, scope);
  }

  /**
   * Delete a notepad
   */
  async deleteNotepad(projectRoot: string, relativePath: string, scope: NotepadScope): Promise<void> {
    const dir = scope === NotepadScope.USER ? this.userNotepadsDir : join(projectRoot, ".infinity", "notepads");
    const absolutePath = join(dir, relativePath);
    await unlink(absolutePath);
    this.cache.clear();
  }

  /**
   * Toggle pin status
   */
  async togglePin(projectRoot: string, relativePath: string, scope: NotepadScope): Promise<Notepad> {
    const dir = scope === NotepadScope.USER ? this.userNotepadsDir : join(projectRoot, ".infinity", "notepads");
    const absolutePath = join(dir, relativePath);
    const existing = await this.parseNotepadFile(absolutePath, dir, scope);
    return this.updateNotepad(projectRoot, relativePath, scope, { pinned: !existing.frontmatter.pinned });
  }

  /**
   * Create from template
   */
  async createFromTemplate(
    projectRoot: string,
    templateId: string,
    scope: NotepadScope,
    overrides: Partial<NotepadFrontmatter> & { content?: string } = {}
  ): Promise<Notepad> {
    const template = BUILTIN_NOTEPAD_TEMPLATES.find(t => t.id === templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    return this.createNotepad(projectRoot, {
      name: overrides.name || template.name,
      description: overrides.description || template.description,
      category: overrides.category || template.category,
      scope,
      tags: overrides.tags || template.frontmatter.tags,
      content: overrides.content || template.content
    });
  }

  /**
   * Get templates
   */
  getTemplates() {
    return BUILTIN_NOTEPAD_TEMPLATES;
  }

  /**
   * Inject notepad content into context (for @notepad resolution)
   */
  formatForInjection(notepad: Notepad): string {
    return `## Notepad: ${notepad.frontmatter.name}\n\n${notepad.body}\n\n---`;
  }
}

/**
 * Singleton
 */
let notepadsManagerInstance: NotepadsManager | null = null;

export function getNotepadsManager(
  userNotepadsDir?: string,
  projectNotepadsDir?: string
): NotepadsManager {
  if (!notepadsManagerInstance) {
    notepadsManagerInstance = new NotepadsManager(userNotepadsDir, projectNotepadsDir);
  }
  return notepadsManagerInstance;
}

export function resetNotepadsManager(): void {
  notepadsManagerInstance = null;
}