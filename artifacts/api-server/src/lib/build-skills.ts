/**
 * BUILD SKILLS SYSTEM
 *
 * Reusable capability definitions for Build Mode agents.
 * Provides skill schema, loader, registry, built-in skills, inheritance, and agent-skill binding.
 *
 * Skills are JSON/YAML definitions that encapsulate:
 * - Instructions (system prompt additions)
 * - Preferred tools
 * - Verification rules
 * - Conventions/best practices
 * - Version metadata
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getWorkspaceRoot, safeWorkspacePath, listWorkspaceFiles } from "./workspace";
import { logBuildEvent } from "./build-telemetry";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Tool preference for a skill - which tools the skill encourages/discourages
 */
export const SkillToolPreferenceSchema = z.object({
  name: z.string(),
  priority: z.enum(["required", "preferred", "discouraged", "forbidden"]),
  reason: z.string().optional(),
});

/**
 * Verification rule for a skill
 */
export const SkillVerificationRuleSchema = z.object({
  name: z.string(),
  description: z.string(),
  check: z.enum(["always", "on-completion", "on-error", "manual"]),
  autoFix: z.boolean().default(false),
  fixPrompt: z.string().optional(),
});

/**
 * Convention for a skill
 */
export const SkillConventionSchema = z.object({
  name: z.string(),
  description: z.string(),
  pattern: z.string().optional(), // regex pattern to enforce
  severity: z.enum(["error", "warning", "info"]).default("warning"),
});

/**
 * Skill metadata
 */
export const SkillMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  category: z.enum([
    "frontend",
    "backend",
    "database",
    "devops",
    "security",
    "performance",
    "debugging",
    "testing",
    "documentation",
    "architecture",
  ]),
  author: z.string().optional(),
  license: z.string().default("MIT"),
  tags: z.array(z.string()).default([]),
  minInfinityVersion: z.string().optional(),
  dependencies: z.array(z.string()).default([]), // other skill IDs
});

/**
 * Complete skill definition
 */
export const SkillDefinitionSchema = z.object({
  metadata: SkillMetadataSchema,
  // System prompt additions for agents using this skill
  instructions: z.string(),
  // Tool preferences
  toolPreferences: z.array(SkillToolPreferenceSchema).default([]),
  // Verification rules
  verificationRules: z.array(SkillVerificationRuleSchema).default([]),
  // Conventions/best practices
  conventions: z.array(SkillConventionSchema).default([]),
  // Environment/setup requirements
  environment: z.object({
    requiredTools: z.array(z.string()).default([]),
    requiredPackages: z.array(z.string()).default([]),
    setupCommands: z.array(z.string()).default([]),
  }).default({}),
  // Agent role bindings - which roles this skill applies to
  roleBindings: z.array(z.enum(["planner", "coder", "reviewer", "fixer", "diagnostic", "human"])).default([]),
  // Extends another skill (inheritance)
  extends: z.string().optional(),
});

// Types
export type SkillToolPreference = z.infer<typeof SkillToolPreferenceSchema>;
export type SkillVerificationRule = z.infer<typeof SkillVerificationRuleSchema>;
export type SkillConvention = z.infer<typeof SkillConventionSchema>;
export type SkillMetadata = z.infer<typeof SkillMetadataSchema>;
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

// ============================================================================
// RESOLVED SKILL (with inheritance applied)
// ============================================================================

export interface ResolvedSkill extends SkillDefinition {
  // Computed fields after inheritance resolution
  resolvedInstructions: string;
  resolvedToolPreferences: SkillToolPreference[];
  resolvedVerificationRules: SkillVerificationRule[];
  resolvedConventions: SkillConvention[];
  resolvedEnvironment: SkillDefinition["environment"];
  resolvedRoleBindings: SkillDefinition["roleBindings"];
  // Inheritance chain
  inheritanceChain: string[];
}

// ============================================================================
// SKILL REGISTRY
// ============================================================================

export interface SkillRegistryEntry {
  skill: ResolvedSkill;
  source: "builtin" | "project" | "user" | "imported";
  projectId?: string;
  loadedAt: Date;
  filePath?: string;
}

export class SkillRegistry {
  private skills = new Map<string, SkillRegistryEntry>();
  private skillsByCategory = new Map<string, Set<string>>();
  private skillsByTag = new Map<string, Set<string>>();
  private skillsByRole = new Map<string, Set<string>>();

  /**
   * Register a skill
   */
  register(skill: ResolvedSkill, source: SkillRegistryEntry["source"], projectId?: string, filePath?: string): void {
    const existing = this.skills.get(skill.metadata.id);
    if (existing) {
      // Allow override if same source or higher priority source
      const sourcePriority = { builtin: 0, project: 1, user: 2, imported: 3 };
      if (sourcePriority[source] >= sourcePriority[existing.source]) {
        this.unregister(skill.metadata.id);
      } else {
        return; // Keep existing higher priority skill
      }
    }

    const entry: SkillRegistryEntry = {
      skill,
      source,
      projectId,
      loadedAt: new Date(),
      filePath,
    };

    this.skills.set(skill.metadata.id, entry);

    // Index by category
    const cat = skill.metadata.category;
    if (!this.skillsByCategory.has(cat)) {
      this.skillsByCategory.set(cat, new Set());
    }
    this.skillsByCategory.get(cat)!.add(skill.metadata.id);

    // Index by tags
    for (const tag of skill.metadata.tags) {
      if (!this.skillsByTag.has(tag)) {
        this.skillsByTag.set(tag, new Set());
      }
      this.skillsByTag.get(tag)!.add(skill.metadata.id);
    }

    // Index by role bindings
    for (const role of skill.roleBindings) {
      if (!this.skillsByRole.has(role)) {
        this.skillsByRole.set(role, new Set());
      }
      this.skillsByRole.get(role)!.add(skill.metadata.id);
    }

    logBuildEvent(projectId || "global", "skill", `Registered skill: ${skill.metadata.id}`, {
      data: { skillId: skill.metadata.id, version: skill.metadata.version, source, category: cat },
    });
  }

  /**
   * Unregister a skill
   */
  unregister(skillId: string): boolean {
    const entry = this.skills.get(skillId);
    if (!entry) return false;

    // Remove from indexes
    this.skillsByCategory.get(entry.skill.metadata.category)?.delete(skillId);
    for (const tag of entry.skill.metadata.tags) {
      this.skillsByTag.get(tag)?.delete(skillId);
    }
    for (const role of entry.skill.roleBindings) {
      this.skillsByRole.get(role)?.delete(skillId);
    }

    this.skills.delete(skillId);
    return true;
  }

  /**
   * Get a skill by ID
   */
  get(skillId: string): ResolvedSkill | null {
    return this.skills.get(skillId)?.skill || null;
  }

  /**
   * Get all skills
   */
  getAll(): ResolvedSkill[] {
    return Array.from(this.skills.values()).map(e => e.skill);
  }

  /**
   * Get skills by category
   */
  getByCategory(category: SkillMetadata["category"]): ResolvedSkill[] {
    const ids = this.skillsByCategory.get(category) || new Set();
    return Array.from(ids).map(id => this.skills.get(id)!.skill);
  }

  /**
   * Get skills by tag
   */
  getByTag(tag: string): ResolvedSkill[] {
    const ids = this.skillsByTag.get(tag) || new Set();
    return Array.from(ids).map(id => this.skills.get(id)!.skill);
  }

  /**
   * Get skills for a specific agent role
   */
  getByRole(role: SkillDefinition["roleBindings"][number]): ResolvedSkill[] {
    const ids = this.skillsByRole.get(role) || new Set();
    return Array.from(ids).map(id => this.skills.get(id)!.skill);
  }

  /**
   * Discover skills matching a filter
   */
  discover(filter: SkillDiscoveryFilter): ResolvedSkill[] {
    let candidates = this.getAll();

    if (filter.category) {
      candidates = candidates.filter(s => s.metadata.category === filter.category);
    }
    if (filter.tags && filter.tags.length > 0) {
      candidates = candidates.filter(s => filter.tags!.some(t => s.metadata.tags.includes(t)));
    }
    if (filter.role) {
      candidates = candidates.filter(s => s.roleBindings.includes(filter.role!));
    }
    if (filter.query) {
      const q = filter.query.toLowerCase();
      candidates = candidates.filter(s =>
        s.metadata.id.toLowerCase().includes(q) ||
        s.metadata.name.toLowerCase().includes(q) ||
        s.metadata.description.toLowerCase().includes(q) ||
        s.metadata.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    if (filter.source) {
      candidates = candidates.filter(s => {
        const entry = this.skills.get(s.metadata.id);
        return entry?.source === filter.source;
      });
    }
    if (filter.projectId) {
      candidates = candidates.filter(s => {
        const entry = this.skills.get(s.metadata.id);
        return !entry || !entry.projectId || entry.projectId === filter.projectId;
      });
    }

    return candidates;
  }

  /**
   * Get skills for a project (builtin + project-specific)
   */
  getForProject(projectId: string): ResolvedSkill[] {
    return this.getAll().filter(s => {
      const entry = this.skills.get(s.metadata.id);
      return entry?.source === "builtin" || entry?.projectId === projectId;
    });
  }

  /**
   * Get registry stats
   */
  getStats(): {
    total: number;
    bySource: Record<string, number>;
    byCategory: Record<string, number>;
    byRole: Record<string, number>;
  } {
    const bySource: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const byRole: Record<string, number> = {};

    for (const entry of this.skills.values()) {
      bySource[entry.source] = (bySource[entry.source] || 0) + 1;
      byCategory[entry.skill.metadata.category] = (byCategory[entry.skill.metadata.category] || 0) + 1;
      for (const role of entry.skill.roleBindings) {
        byRole[role] = (byRole[role] || 0) + 1;
      }
    }

    return {
      total: this.skills.size,
      bySource,
      byCategory,
      byRole,
    };
  }
}

export interface SkillDiscoveryFilter {
  category?: SkillMetadata["category"];
  tags?: string[];
  role?: SkillDefinition["roleBindings"][number];
  query?: string;
  source?: SkillRegistryEntry["source"];
  projectId?: string;
}

// ============================================================================
// SKILL LOADER
// ============================================================================

export class SkillLoader {
  private registry: SkillRegistry;

  constructor(registry: SkillRegistry) {
    this.registry = registry;
  }

  /**
   * Load a skill from a file
   */
  async loadFromFile(filePath: string, projectId?: string): Promise<ResolvedSkill | null> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const ext = path.extname(filePath).toLowerCase();

      let raw: unknown;
      if (ext === ".json") {
        raw = JSON.parse(content);
      } else if (ext === ".yaml" || ext === ".yml") {
        // Simple YAML parsing - in production use a proper YAML parser
        raw = this.parseSimpleYaml(content);
      } else {
        throw new Error(`Unsupported skill file format: ${ext}`);
      }

      const parsed = SkillDefinitionSchema.parse(raw);
      const resolved = await this.resolveSkill(parsed);
      this.registry.register(resolved, projectId ? "project" : "user", projectId, filePath);
      return resolved;
    } catch (error) {
      console.error(`Failed to load skill from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Load multiple skills from a directory
   */
  async loadFromDirectory(dirPath: string, projectId?: string): Promise<ResolvedSkill[]> {
    const skills: ResolvedSkill[] = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
          const skill = await this.loadFromFile(path.join(dirPath, entry.name), projectId);
          if (skill) skills.push(skill);
        }
      }
    } catch (error) {
      console.error(`Failed to load skills from ${dirPath}:`, error);
    }

    return skills;
  }

  /**
   * Load built-in skills
   */
  async loadBuiltins(skillsDir: string): Promise<ResolvedSkill[]> {
    return this.loadFromDirectory(skillsDir);
  }

  /**
   * Resolve skill inheritance
   */
  private async resolveSkill(skill: SkillDefinition): Promise<ResolvedSkill> {
    const chain: string[] = [skill.metadata.id];
    let current: SkillDefinition | null = skill;
    const visited = new Set<string>();

    // Build inheritance chain
    while (current?.extends) {
      if (visited.has(current.extends)) {
        throw new Error(`Circular inheritance detected in skill ${skill.metadata.id}`);
      }
      visited.add(current.extends);
      chain.push(current.extends);

      // Try to find parent skill in registry
      const parent = this.registry.get(current.extends);
      if (!parent) {
        // Try to load from built-in skills directory
        const skillsDir = path.join(path.dirname(require.resolve("./build-skills.ts")), "skills");
        const parentPath = path.join(skillsDir, `${current.extends}.json`);
        try {
          const content = await fs.readFile(parentPath, "utf-8");
          current = SkillDefinitionSchema.parse(JSON.parse(content));
        } catch {
          throw new Error(`Parent skill not found: ${current.extends}`);
        }
      } else {
        current = parent as SkillDefinition;
      }
    }

    // Resolve from base to leaf
    let resolved = skill;
    for (let i = chain.length - 1; i >= 0; i--) {
      const skillId = chain[i];
      let skillDef: SkillDefinition;

      if (i === chain.length - 1) {
        skillDef = skill;
      } else {
        const existing = this.registry.get(skillId);
        if (!existing) {
          const skillsDir = path.join(path.dirname(require.resolve("./build-skills.ts")), "skills");
          const skillPath = path.join(skillsDir, `${skillId}.json`);
          const content = await fs.readFile(skillPath, "utf-8");
          skillDef = SkillDefinitionSchema.parse(JSON.parse(content));
        } else {
          skillDef = existing;
        }
      }

      if (i === chain.length - 1) {
        resolved = skillDef;
      } else {
        resolved = this.mergeSkills(skillDef, resolved);
      }
    }

    return {
      ...resolved,
      inheritanceChain: chain,
      resolvedInstructions: resolved.instructions,
      resolvedToolPreferences: resolved.toolPreferences,
      resolvedVerificationRules: resolved.verificationRules,
      resolvedConventions: resolved.conventions,
      resolvedEnvironment: resolved.environment,
      resolvedRoleBindings: resolved.roleBindings,
    };
  }

  /**
   * Merge child skill over parent (child overrides parent)
   */
  private mergeSkills(parent: SkillDefinition, child: SkillDefinition): SkillDefinition {
    return {
      metadata: { ...parent.metadata, ...child.metadata },
      instructions: [parent.instructions, child.instructions].filter(Boolean).join("\n\n"),
      toolPreferences: [...parent.toolPreferences, ...child.toolPreferences],
      verificationRules: [...parent.verificationRules, ...child.verificationRules],
      conventions: [...parent.conventions, ...child.conventions],
      environment: {
        requiredTools: [...new Set([...parent.environment.requiredTools, ...child.environment.requiredTools])],
        requiredPackages: [...new Set([...parent.environment.requiredPackages, ...child.environment.requiredPackages])],
        setupCommands: [...parent.environment.setupCommands, ...child.environment.setupCommands],
      },
      roleBindings: [...new Set([...parent.roleBindings, ...child.roleBindings])],
      extends: child.extends,
    };
  }

  /**
   * Simple YAML parser for skill files (subset)
   */
  private parseSimpleYaml(content: string): unknown {
    // This is a minimal YAML parser for skill files
    // In production, use js-yaml or similar
    const lines = content.split("\n");
    const result: Record<string, unknown> = {};
    let currentKey = "";
    let currentArray: string[] = [];
    let inArray = false;
    let indent = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const lineIndent = line.length - trimmed.length;

      if (trimmed.startsWith("- ")) {
        // Array item
        if (!inArray) {
          inArray = true;
          currentArray = [];
        }
        currentArray.push(trimmed.slice(2).trim());
        result[currentKey] = currentArray;
      } else if (trimmed.includes(":")) {
        inArray = false;
        const [key, ...valueParts] = trimmed.split(":");
        currentKey = key.trim();
        const value = valueParts.join(":").trim();

        if (!value || value === "|" || value === ">") {
          // Multi-line string - simplified handling
          result[currentKey] = "";
        } else {
          // Try to parse as JSON value
          try {
            result[currentKey] = JSON.parse(value);
          } catch {
            result[currentKey] = value.replace(/^["']|["']$/g, "");
          }
        }
      }
    }

    return result;
  }
}

// ============================================================================
// AGENT-SKILL BINDING
// ============================================================================

export interface AgentSkillBinding {
  agentRole: "planner" | "coder" | "reviewer" | "fixer" | "diagnostic";
  skillIds: string[];
  projectId: string;
  priority: number; // Higher = more priority
  enabled: boolean;
}

const agentBindings = new Map<string, AgentSkillBinding[]>();

/**
 * Bind skills to an agent role for a project
 */
export function bindSkillsToAgent(binding: AgentSkillBinding): void {
  const key = `${binding.projectId}:${binding.agentRole}`;
  const existing = agentBindings.get(key) || [];
  // Remove any existing binding for the same role
  const filtered = existing.filter(b => b.agentRole !== binding.agentRole);
  filtered.push(binding);
  // Sort by priority
  filtered.sort((a, b) => b.priority - a.priority);
  agentBindings.set(key, filtered);
}

/**
 * Get skills bound to an agent role for a project
 */
export function getBoundSkills(projectId: string, agentRole: AgentSkillBinding["agentRole"]): string[] {
  const key = `${projectId}:${agentRole}`;
  const bindings = agentBindings.get(key) || [];
  return bindings
    .filter(b => b.enabled)
    .flatMap(b => b.skillIds);
}

/**
 * Remove skill binding
 */
export function unbindSkillsFromAgent(projectId: string, agentRole: AgentSkillBinding["agentRole"]): void {
  const key = `${projectId}:${agentRole}`;
  agentBindings.delete(key);
}

/**
 * Get all bindings for a project
 */
export function getProjectBindings(projectId: string): AgentSkillBinding[] {
  const result: AgentSkillBinding[] = [];
  for (const [key, bindings] of agentBindings.entries()) {
    if (key.startsWith(`${projectId}:`)) {
      result.push(...bindings);
    }
  }
  return result;
}

// ============================================================================
// SKILL MARKETPLACE (Local first, $0)
// ============================================================================

export interface SkillPackage {
  skill: SkillDefinition;
  manifest: {
    name: string;
    version: string;
    description: string;
    author: string;
    license: string;
    repository?: string;
    homepage?: string;
    keywords: string[];
    infinityVersion: string;
  };
  files: string[]; // Additional files in package
}

export class SkillMarketplace {
  private packages = new Map<string, SkillPackage>();
  private localPackagesPath: string;

  constructor(localPackagesPath: string) {
    this.localPackagesPath = localPackagesPath;
  }

  /**
   * Install a skill package from local path
   */
  async installFromLocal(packagePath: string): Promise<SkillPackage | null> {
    try {
      const manifestPath = path.join(packagePath, "skill.json");
      const manifestContent = await fs.readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestContent);

      // Load skill definition
      const skillPath = path.join(packagePath, "skill.yaml");
      const skillContent = await fs.readFile(skillPath, "utf-8");
      const skill = this.parseSimpleYaml(skillContent) as SkillDefinition;
      SkillDefinitionSchema.parse(skill);

      const pkg: SkillPackage = { skill, manifest, files: [] };
      this.packages.set(skill.metadata.id, pkg);
      return pkg;
    } catch (error) {
      console.error(`Failed to install skill from ${packagePath}:`, error);
      return null;
    }
  }

  /**
   * Publish a skill package locally
   */
  async publishLocally(skill: SkillDefinition, outputDir: string): Promise<void> {
    await fs.mkdir(outputDir, { recursive: true });

    // Write skill definition
    await fs.writeFile(
      path.join(outputDir, "skill.yaml"),
      this.stringifyYaml(skill)
    );

    // Write manifest
    const manifest = {
      name: skill.metadata.name,
      version: skill.metadata.version,
      description: skill.metadata.description,
      author: skill.metadata.author || "Unknown",
      license: skill.metadata.license,
      keywords: skill.metadata.tags,
      infinityVersion: skill.metadata.minInfinityVersion || "1.0.0",
    };
    await fs.writeFile(
      path.join(outputDir, "skill.json"),
      JSON.stringify(manifest, null, 2)
    );
  }

  /**
   * Get installed packages
   */
  getPackages(): SkillPackage[] {
    return Array.from(this.packages.values());
  }

  /**
   * Search packages
   */
  search(query: string): SkillPackage[] {
    const q = query.toLowerCase();
    return this.getPackages().filter(p =>
      p.skill.metadata.id.toLowerCase().includes(q) ||
      p.manifest.name.toLowerCase().includes(q) ||
      p.manifest.description.toLowerCase().includes(q) ||
      p.manifest.keywords.some(k => k.toLowerCase().includes(q))
    );
  }

  private parseSimpleYaml(content: string): unknown {
    // Reuse the simple YAML parser
    const lines = content.split("\n");
    const result: Record<string, unknown> = {};
    let currentKey = "";
    let currentArray: string[] = [];
    let inArray = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      if (trimmed.startsWith("- ")) {
        if (!inArray) {
          inArray = true;
          currentArray = [];
        }
        currentArray.push(trimmed.slice(2).trim());
        result[currentKey] = currentArray;
      } else if (trimmed.includes(":")) {
        inArray = false;
        const [key, ...valueParts] = trimmed.split(":");
        currentKey = key.trim();
        const value = valueParts.join(":").trim();

        if (!value || value === "|" || value === ">") {
          result[currentKey] = "";
        } else {
          try {
            result[currentKey] = JSON.parse(value);
          } catch {
            result[currentKey] = value.replace(/^["']|["']$/g, "");
          }
        }
      }
    }

    return result;
  }

  private stringifyYaml(obj: unknown): string {
    // Simple YAML stringification
    const lines: string[] = [];
    const stringify = (val: unknown, indent = 0): string[] => {
      const prefix = "  ".repeat(indent);
      if (val === null || val === undefined) {
        return [`${prefix}null`];
      }
      if (Array.isArray(val)) {
        return val.map(item => `${prefix}- ${stringify(item, indent + 1).join("\n" + prefix + "  ")}`);
      }
      if (typeof val === "object") {
        return Object.entries(val as Record<string, unknown>).flatMap(([k, v]) =>
          stringify({ [k]: v }, indent)
        );
      }
      if (typeof val === "string" && (val.includes("\n") || val.includes(":") || val.includes("#"))) {
        return [`${prefix}${val}`];
      }
      return [`${prefix}${JSON.stringify(val)}`];
    };
    return stringify(obj).join("\n");
  }
}

// ============================================================================
// FACTORY & HELPERS
// ============================================================================

const globalRegistry = new SkillRegistry();
let globalLoader: SkillLoader | null = null;
let globalMarketplace: SkillMarketplace | null = null;

/**
 * Get global skill registry
 */
export function getSkillRegistry(): SkillRegistry {
  return globalRegistry;
}

/**
 * Get or create skill loader
 */
export function getSkillLoader(): SkillLoader {
  if (!globalLoader) {
    globalLoader = new SkillLoader(globalRegistry);
  }
  return globalLoader;
}

/**
 * Get or create skill marketplace
 */
export function getSkillMarketplace(localPackagesPath?: string): SkillMarketplace {
  if (!globalMarketplace) {
    const packagesPath = localPackagesPath || path.join(getWorkspaceRoot("global"), ".infinity", "skills");
    globalMarketplace = new SkillMarketplace(packagesPath);
  }
  return globalMarketplace;
}

/**
 * Initialize the skills system (load built-ins)
 */
export async function initializeSkillsSystem(projectId?: string): Promise<void> {
  const loader = getSkillLoader();
  const skillsDir = path.join(path.dirname(require.resolve("./build-skills.ts")), "skills");

  // Load built-in skills
  await loader.loadBuiltins(skillsDir);

  // Load project-specific skills if projectId provided
  if (projectId) {
    const projectSkillsDir = safeWorkspacePath(".infinity/skills", projectId);
    if (projectSkillsDir) {
      await loader.loadFromDirectory(projectSkillsDir, projectId);
    }
  }
}

/**
 * Apply skills to an agent's system prompt
 */
export function applySkillsToPrompt(
  basePrompt: string,
  skillIds: string[],
  registry: SkillRegistry = globalRegistry
): string {
  const skills = skillIds.map(id => registry.get(id)).filter(Boolean) as ResolvedSkill[];
  if (skills.length === 0) return basePrompt;

  const skillInstructions = skills.map(s => s.resolvedInstructions).join("\n\n---\n\n");
  return `${basePrompt}\n\n=== SKILLS ===\n${skillInstructions}`;
}

/**
 * Get tool preferences for a set of skills
 */
export function getCombinedToolPreferences(
  skillIds: string[],
  registry: SkillRegistry = globalRegistry
): SkillToolPreference[] {
  const skills = skillIds.map(id => registry.get(id)).filter(Boolean) as ResolvedSkill[];
  const preferences = new Map<string, SkillToolPreference>();

  for (const skill of skills) {
    for (const pref of skill.resolvedToolPreferences) {
      const existing = preferences.get(pref.name);
      if (!existing || priorityValue(pref.priority) > priorityValue(existing.priority)) {
        preferences.set(pref.name, pref);
      }
    }
  }

  return Array.from(preferences.values())
    .sort((a, b) => priorityValue(b.priority) - priorityValue(a.priority));
}

function priorityValue(priority: SkillToolPreference["priority"]): number {
  switch (priority) {
    case "required": return 4;
    case "preferred": return 3;
    case "discouraged": return 1;
    case "forbidden": return 0;
  }
}

/**
 * Get verification rules for a set of skills
 */
export function getCombinedVerificationRules(
  skillIds: string[],
  registry: SkillRegistry = globalRegistry
): SkillVerificationRule[] {
  const skills = skillIds.map(id => registry.get(id)).filter(Boolean) as ResolvedSkill[];
  const rules = new Map<string, SkillVerificationRule>();

  for (const skill of skills) {
    for (const rule of skill.resolvedVerificationRules) {
      if (!rules.has(rule.name)) {
        rules.set(rule.name, rule);
      }
    }
  }

  return Array.from(rules.values());
}

/**
 * Get conventions for a set of skills
 */
export function getCombinedConventions(
  skillIds: string[],
  registry: SkillRegistry = globalRegistry
): SkillConvention[] {
  const skills = skillIds.map(id => registry.get(id)).filter(Boolean) as ResolvedSkill[];
  const conventions = new Map<string, SkillConvention>();

  for (const skill of skills) {
    for (const conv of skill.resolvedConventions) {
      if (!conventions.has(conv.name)) {
        conventions.set(conv.name, conv);
      }
    }
  }

  return Array.from(conventions.values());
}

export default SkillRegistry;