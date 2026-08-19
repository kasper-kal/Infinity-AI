/**
 * BUILD PROJECT MAP SUBSYSTEM
 *
 * Persistent project understanding for intelligent builds:
 * - Pre-build analysis: framework, PM, entry points, architecture, DB, routes, components, tests, config
 * - Incremental updates on file changes
 * - Change impact analysis
 * - Smart context selection (only relevant files in context based on goal)
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  getWorkspaceRoot,
  listWorkspaceFiles,
  readWorkspaceFileText,
  safeWorkspacePath,
} from "./workspace";

/**
 * Detected project framework
 */
export type FrameworkType =
  | "react"
  | "vue"
  | "svelte"
  | "next"
  | "vite"
  | "remix"
  | "astro"
  | "nuxt"
  | "express"
  | "fastify"
  | "hono"
  | "elysia"
  | "vanilla"
  | "unknown";

/**
 * Package manager type
 */
export type PackageManager = "pnpm" | "npm" | "yarn" | "bun" | "unknown";

/**
 * Database type
 */
export type DatabaseType =
  | "drizzle"
  | "prisma"
  | "supabase"
  | "raw-sql"
  | "mongoose"
  | "typeorm"
  | "none"
  | "unknown";

/**
 * Test framework type
 */
export type TestFramework =
  | "jest"
  | "vitest"
  | "playwright"
  | "cypress"
  | "mocha"
  | "none"
  | "unknown";

/**
 * Architecture pattern
 */
export type ArchitecturePattern =
  | "monorepo"
  | "feature-folders"
  | "layered"
  | "modular"
  | "clean"
  | "simple"
  | "unknown";

/**
 * Project map entry for a file
 */
export interface ProjectFileMapEntry {
  path: string;
  purpose: string;
  exports: string[];
  imports: string[];
  type: "component" | "route" | "hook" | "utility" | "config" | "test" | "type" | "style" | "other";
  hash: string;
  lastChanged: string;
  size: number;
  dependencies: string[]; // Other project files this imports
  dependents: string[]; // Other project files that import this
}

/**
 * Complete project map
 */
export interface ProjectMap {
  projectId: string;
  version: number;
  generatedAt: string;
  framework: FrameworkType;
  packageManager: PackageManager;
  entryPoints: string[];
  architecture: ArchitecturePattern;
  database: DatabaseType;
  testFramework: TestFramework;
  importantFiles: ImportantFile[];
  routes: RouteInfo[];
  components: ComponentInfo[];
  configFiles: ConfigFileInfo[];
  fileMap: Map<string, ProjectFileMapEntry>;
  dependencyGraph: DependencyGraph;
  metadata: ProjectMetadata;
}

/**
 * Important files (config, schema, types, main exports)
 */
export interface ImportantFile {
  path: string;
  category: "config" | "schema" | "types" | "entry" | "export" | "env" | "docker" | "ci";
  description: string;
}

/**
 * Route/API information
 */
export interface RouteInfo {
  path: string;
  file: string;
  method?: string;
  handler: string;
}

/**
 * Component information
 */
export interface ComponentInfo {
  name: string;
  file: string;
  type: "page" | "component" | "layout" | "hook" | "context";
  exports: string[];
}

/**
 * Config file information
 */
export interface ConfigFileInfo {
  path: string;
  type: "typescript" | "vite" | "tailwind" | "eslint" | "prettier" | "package" | "tsconfig" | "other";
  content?: string;
}

/**
 * Dependency graph for impact analysis
 */
export interface DependencyGraph {
  nodes: Map<string, string[]>; // file -> imports
  reverse: Map<string, string[]>; // file -> imported by
}

/**
 * Project metadata
 */
export interface ProjectMetadata {
  name: string;
  description?: string;
  packageJson: Record<string, unknown>;
  tsconfig?: Record<string, unknown>;
  hasTypeScript: boolean;
  hasESLint: boolean;
  hasPrettier: boolean;
  hasTailwind: boolean;
  hasStorybook: boolean;
  hasDocker: boolean;
  hasCI: boolean;
}

/**
 * Change impact analysis result
 */
export interface ImpactAnalysis {
  changedFile: string;
  directDependents: string[];
  transitiveDependents: string[];
  affectedRoutes: string[];
  affectedComponents: string[];
  affectedTests: string[];
  riskLevel: "low" | "medium" | "high";
  recommendedActions: string[];
}

/**
 * Smart context selection result
 */
export interface SmartContextSelection {
  goal: string;
  relevantFiles: string[];
  estimatedTokens: number;
  rationale: string;
}

/**
 * In-memory project map cache
 */
const projectMaps = new Map<string, ProjectMap>();

/**
 * Generate hash for content
 */
function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

/**
 * Extract imports from TypeScript/JS file
 */
function extractImports(content: string): string[] {
  const imports: string[] = [];
  // import { x } from 'y'
  const importRegex = /import\s+(?:[^'"\n]*from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  // require('x')
  const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
  while ((match = requireRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return [...new Set(imports)];
}

/**
 * Detect framework from package.json and config files
 */
async function detectFramework(
  projectId: string,
  workspaceId: string,
  packageJson: Record<string, unknown>
): Promise<FrameworkType> {
  const deps = { ...(packageJson.dependencies as object), ...(packageJson.devDependencies as object) };
  const depKeys = Object.keys(deps);

  if (depKeys.includes("next")) return "next";
  if (depKeys.includes("remix") || depKeys.includes("@remix-run/react")) return "remix";
  if (depKeys.includes("astro")) return "astro";
  if (depKeys.includes("nuxt")) return "nuxt";
  if (depKeys.includes("vite")) return "vite";
  if (depKeys.includes("react") || depKeys.includes("react-dom")) return "react";
  if (depKeys.includes("vue")) return "vue";
  if (depKeys.includes("svelte")) return "svelte";
  if (depKeys.includes("express")) return "express";
  if (depKeys.includes("fastify")) return "fastify";
  if (depKeys.includes("hono")) return "hono";
  if (depKeys.includes("elysia")) return "elysia";

  // Check config files
  try {
    const entries = await listWorkspaceFiles(workspaceId);
    const configPaths = entries.map(e => e.path);

    if (configPaths.some(p => p.includes("next.config"))) return "next";
    if (configPaths.some(p => p.includes("vite.config"))) return "vite";
    if (configPaths.some(p => p.includes("astro.config"))) return "astro";
    if (configPaths.some(p => p.includes("nuxt.config"))) return "nuxt";
  } catch { }

  return "unknown";
}

/**
 * Detect package manager
 */
async function detectPackageManager(workspaceId: string): Promise<PackageManager> {
  const root = getWorkspaceRoot(workspaceId);
  try {
    if (await fs.access(path.join(root, "pnpm-lock.yaml")).then(() => true).catch(() => false)) return "pnpm";
    if (await fs.access(path.join(root, "yarn.lock")).then(() => true).catch(() => false)) return "yarn";
    if (await fs.access(path.join(root, "bun.lockb")).then(() => true).catch(() => false)) return "bun";
    if (await fs.access(path.join(root, "package-lock.json")).then(() => true).catch(() => false)) return "npm";
  } catch { }
  return "unknown";
}

/**
 * Detect database type
 */
async function detectDatabase(
  projectId: string,
  workspaceId: string,
  packageJson: Record<string, unknown>
): Promise<DatabaseType> {
  const deps = { ...(packageJson.dependencies as object), ...(packageJson.devDependencies as object) };
  const depKeys = Object.keys(deps);

  if (depKeys.includes("drizzle-orm") || depKeys.includes("drizzle-kit")) return "drizzle";
  if (depKeys.includes("@prisma/client") || depKeys.includes("prisma")) return "prisma";
  if (depKeys.includes("@supabase/supabase-js")) return "supabase";
  if (depKeys.includes("mongoose")) return "mongoose";
  if (depKeys.includes("typeorm")) return "typeorm";

  // Check for schema files
  try {
    const entries = await listWorkspaceFiles(workspaceId);
    const paths = entries.map(e => e.path);
    if (paths.some(p => p.includes("schema.ts") || p.includes("schema.sql"))) return "raw-sql";
  } catch { }

  return "none";
}

/**
 * Detect test framework
 */
async function detectTestFramework(
  projectId: string,
  workspaceId: string,
  packageJson: Record<string, unknown>
): Promise<TestFramework> {
  const deps = { ...(packageJson.dependencies as object), ...(packageJson.devDependencies as object) };
  const depKeys = Object.keys(deps);

  if (depKeys.includes("vitest")) return "vitest";
  if (depKeys.includes("jest")) return "jest";
  if (depKeys.includes("@playwright/test") || depKeys.includes("playwright")) return "playwright";
  if (depKeys.includes("cypress")) return "cypress";
  if (depKeys.includes("mocha")) return "mocha";

  // Check for test files
  try {
    const entries = await listWorkspaceFiles(workspaceId);
    const paths = entries.map(e => e.path);
    if (paths.some(p => p.includes(".test.") || p.includes(".spec."))) {
      if (paths.some(p => p.includes("playwright"))) return "playwright";
      return "jest"; // default guess
    }
  } catch { }

  return "none";
}

/**
 * Detect architecture pattern
 */
async function detectArchitecture(
  projectId: string,
  workspaceId: string
): Promise<ArchitecturePattern> {
  try {
    const entries = await listWorkspaceFiles(workspaceId);
    const dirs = entries.filter(e => e.type === "dir").map(e => e.path);

    // Check for monorepo
    if (dirs.some(d => d.includes("packages/") || d.includes("apps/"))) return "monorepo";

    // Check for feature folders
    const featureDirs = dirs.filter(d =>
      d.startsWith("src/features/") || d.startsWith("features/") ||
      d.startsWith("src/modules/") || d.startsWith("modules/")
    );
    if (featureDirs.length > 2) return "feature-folders";

    // Check for layered
    const layers = ["src/domain", "src/application", "src/infrastructure", "src/presentation"];
    if (layers.every(l => dirs.some(d => d.startsWith(l)))) return "layered";

    // Check for clean architecture
    const cleanLayers = ["src/entities", "src/use-cases", "src/interface-adapters", "src/frameworks"];
    if (cleanLayers.every(l => dirs.some(d => d.startsWith(l)))) return "clean";

    return "simple";
  } catch { }
  return "unknown";
}

/**
 * Find entry points
 */
async function findEntryPoints(workspaceId: string): Promise<string[]> {
  const entryPoints: string[] = [];
  const patterns = [
    "src/main.tsx", "src/main.ts", "src/index.tsx", "src/index.ts",
    "src/app.tsx", "src/app.ts", "app.tsx", "app.ts",
    "index.html", "src/index.html",
  ];

  try {
    const entries = await listWorkspaceFiles(workspaceId);
    const paths = new Set(entries.map(e => e.path));

    for (const pattern of patterns) {
      if (paths.has(pattern)) entryPoints.push(pattern);
    }
  } catch { }

  return entryPoints;
}

/**
 * Find routes
 */
async function findRoutes(workspaceId: string, fileMap: Map<string, ProjectFileMapEntry>): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];

  for (const [filePath, entry] of fileMap) {
    if (entry.type === "route") {
      const content = await readWorkspaceFileText(filePath, workspaceId);
      // Extract route paths from content
      const routeMatches = content.match(/(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g);
      if (routeMatches) {
        for (const match of routeMatches) {
          const methodMatch = match.match(/\.(get|post|put|delete|patch)/i);
          const pathMatch = match.match(/['"`]([^'"`]+)['"`]/);
          if (methodMatch && pathMatch) {
            routes.push({
              path: pathMatch[1],
              file: filePath,
              method: methodMatch[1].toUpperCase(),
              handler: entry.exports[0] || "handler",
            });
          }
        }
      }
      // Next.js file-based routes
      if (filePath.includes("/app/") && (filePath.endsWith("page.tsx") || filePath.endsWith("page.ts"))) {
        const routePath = filePath
          .replace("/app", "")
          .replace("/page.tsx", "")
          .replace("/page.ts", "")
          .replace(/\/\([^)]+\)/g, "") // Remove route groups
          .replace(/\[([^\]]+)\]/g, ":$1"); // Convert [param] to :param
        routes.push({
          path: routePath || "/",
          file: filePath,
          method: "GET",
          handler: "page",
        });
      }
    }
  }

  return routes;
}

/**
 * Find components
 */
async function findComponents(workspaceId: string, fileMap: Map<string, ProjectFileMapEntry>): Promise<ComponentInfo[]> {
  const components: ComponentInfo[] = [];

  for (const [filePath, entry] of fileMap) {
    if (entry.type === "component") {
      const isPage = filePath.includes("/page.") || filePath.includes("/route.");
      components.push({
        name: path.basename(filePath, path.extname(filePath)),
        file: filePath,
        type: isPage ? "page" : "component",
        exports: entry.exports,
      });
    }
  }

  return components;
}

/**
 * Find config files
 */
async function findConfigFiles(workspaceId: string): Promise<ConfigFileInfo[]> {
  const configs: ConfigFileInfo[] = [];
  const configPatterns = [
    { pattern: "tsconfig.json", type: "typescript" as const },
    { pattern: "vite.config.ts", type: "vite" as const },
    { pattern: "vite.config.js", type: "vite" as const },
    { pattern: "tailwind.config.ts", type: "tailwind" as const },
    { pattern: "tailwind.config.js", type: "tailwind" as const },
    { pattern: ".eslintrc", type: "eslint" as const },
    { pattern: "eslint.config.js", type: "eslint" as const },
    { pattern: ".prettierrc", type: "prettier" as const },
    { pattern: "prettier.config.js", type: "prettier" as const },
    { pattern: "package.json", type: "package" as const },
  ];

  try {
    const entries = await listWorkspaceFiles(workspaceId);
    const paths = new Set(entries.map(e => e.path));

    for (const { pattern, type } of configPatterns) {
      if (paths.has(pattern)) {
        const content = await readWorkspaceFileText(pattern, workspaceId);
        configs.push({ path: pattern, type, content: content.slice(0, 5000) });
      }
    }
  } catch { }

  return configs;
}

/**
 * Build complete project map
 */
export async function buildProjectMap(projectId: string, workspaceId = projectId): Promise<ProjectMap> {
  const root = getWorkspaceRoot(workspaceId);
  const entries = await listWorkspaceFiles(workspaceId);
  const files = entries.filter(e => e.type === "file");

  // Read package.json
  let packageJson: Record<string, unknown> = {};
  try {
    const pkgContent = await readWorkspaceFileText("package.json", workspaceId);
    packageJson = JSON.parse(pkgContent);
  } catch { }

  // Detect project characteristics
  const [
    framework,
    packageManager,
    database,
    testFramework,
    architecture,
    entryPoints,
  ] = await Promise.all([
    detectFramework(projectId, workspaceId, packageJson),
    detectPackageManager(workspaceId),
    detectDatabase(projectId, workspaceId, packageJson),
    detectTestFramework(projectId, workspaceId, packageJson),
    detectArchitecture(projectId, workspaceId),
    findEntryPoints(workspaceId),
  ]);

  // Build file map
  const fileMap = new Map<string, ProjectFileMapEntry>();
  const dependencyGraph: DependencyGraph = {
    nodes: new Map(),
    reverse: new Map(),
  };

  for (const entry of files) {
    if (!/\.(ts|tsx|js|jsx|json|css|scss|sass|html|vue|svelte)$/.test(entry.path)) continue;
    if (/^(\.|node_modules|dist|build|\.git)/.test(entry.path)) continue;

    try {
      const content = await readWorkspaceFileText(entry.path, workspaceId);
      const stat = await fs.stat(path.join(root, entry.path));
      const imports = extractImports(content);
      const exports = entry.path.endsWith(".ts") || entry.path.endsWith(".tsx") || entry.path.endsWith(".js") || entry.path.endsWith(".jsx")
        ? extractExports(content)
        : [];

      // Determine file type
      let type: ProjectFileMapEntry["type"] = "other";
      const base = path.basename(entry.path);
      if (base.includes(".test.") || base.includes(".spec.")) type = "test";
      else if (base.includes("component") || base.includes(".tsx") || base.includes(".vue") || base.includes(".svelte")) type = "component";
      else if (base.includes("route") || base.includes("controller") || base.includes("handler")) type = "route";
      else if (base.includes("hook") || base.includes("use")) type = "hook";
      else if (base.includes("util") || base.includes("helper")) type = "utility";
      else if (base.includes("config") || base.includes("settings")) type = "config";
      else if (base.includes("type") || base.includes("interface") || base.endsWith(".d.ts")) type = "type";
      else if (/\.(css|scss|sass)$/.test(base)) type = "style";

      const purpose = inferPurpose(entry.path, content);

      const fileEntry: ProjectFileMapEntry = {
        path: entry.path,
        purpose,
        exports,
        imports,
        type,
        hash: hashContent(content),
        lastChanged: stat.mtime.toISOString(),
        size: stat.size,
        dependencies: imports.filter(i => !i.startsWith(".") && !i.startsWith("@") && !i.startsWith("~")),
        dependents: [],
      };

      fileMap.set(entry.path, fileEntry);

      // Build dependency graph
      dependencyGraph.nodes.set(entry.path, fileEntry.dependencies);
      for (const imp of fileEntry.dependencies) {
        if (!dependencyGraph.reverse.has(imp)) {
          dependencyGraph.reverse.set(imp, []);
        }
        dependencyGraph.reverse.get(imp)!.push(entry.path);
      }
    } catch { }
  }

  // Populate dependents
  for (const [filePath, entry] of fileMap) {
    entry.dependents = dependencyGraph.reverse.get(filePath) || [];
  }

  // Find routes, components, configs
  const [routes, components, configFiles] = await Promise.all([
    findRoutes(workspaceId, fileMap),
    findComponents(workspaceId, fileMap),
    findConfigFiles(workspaceId),
  ]);

  // Build important files
  const importantFiles: ImportantFile[] = [];
  for (const config of configFiles) {
    importantFiles.push({
      path: config.path,
      category: config.type === "package" ? "config" :
              config.type === "typescript" ? "config" :
              config.type === "vite" ? "config" : "config",
      description: `${config.type} configuration`,
    });
  }

  // Add schema files
  for (const [filePath, entry] of fileMap) {
    if (filePath.includes("schema") && (filePath.endsWith(".ts") || filePath.endsWith(".sql"))) {
      importantFiles.push({
        path: filePath,
        category: "schema",
        description: "Database schema",
      });
    }
    if (filePath.includes("types") || filePath.endsWith(".d.ts")) {
      importantFiles.push({
        path: filePath,
        category: "types",
        description: "Type definitions",
      });
    }
  }

  // Metadata
  const metadata: ProjectMetadata = {
    name: (packageJson.name as string) || projectId,
    description: packageJson.description as string,
    packageJson,
    hasTypeScript: files.some(f => f.path.endsWith(".ts") || f.path.endsWith(".tsx")),
    hasESLint: files.some(f => f.path.includes("eslint")),
    hasPrettier: files.some(f => f.path.includes("prettier")),
    hasTailwind: files.some(f => f.path.includes("tailwind")),
    hasStorybook: files.some(f => f.path.includes("storybook") || f.path.includes(".stories.")),
    hasDocker: files.some(f => f.path.includes("Dockerfile") || f.path.includes("docker-compose")),
    hasCI: files.some(f => f.path.includes(".github/workflows") || f.path.includes(".gitlab-ci")),
  };

  const projectMap: ProjectMap = {
    projectId,
    version: Date.now(),
    generatedAt: new Date().toISOString(),
    framework,
    packageManager,
    entryPoints,
    architecture,
    database,
    testFramework,
    importantFiles,
    routes,
    components,
    configFiles,
    fileMap,
    dependencyGraph,
    metadata,
  };

  projectMaps.set(projectId, projectMap);
  return projectMap;
}

/**
 * Get cached project map or build new one
 */
export async function getProjectMap(projectId: string, workspaceId = projectId): Promise<ProjectMap> {
  const cached = projectMaps.get(projectId);
  if (cached) return cached;
  return buildProjectMap(projectId, workspaceId);
}

/**
 * Update project map for a changed file
 */
export async function updateProjectMapForFile(
  projectId: string,
  filePath: string,
  workspaceId = projectId
): Promise<void> {
  const projectMap = await getProjectMap(projectId, workspaceId);

  try {
    const content = await readWorkspaceFileText(filePath, workspaceId);
    const root = getWorkspaceRoot(workspaceId);
    const stat = await fs.stat(path.join(root, filePath));
    const imports = extractImports(content);
    const exports = filePath.endsWith(".ts") || filePath.endsWith(".tsx") || filePath.endsWith(".js") || filePath.endsWith(".jsx")
      ? extractExports(content)
      : [];

    const existing = projectMap.fileMap.get(filePath);
    const purpose = inferPurpose(filePath, content);

    let type: ProjectFileMapEntry["type"] = "other";
    const base = path.basename(filePath);
    if (base.includes(".test.") || base.includes(".spec.")) type = "test";
    else if (base.includes("component") || base.includes(".tsx") || base.includes(".vue") || base.includes(".svelte")) type = "component";
    else if (base.includes("route") || base.includes("controller") || base.includes("handler")) type = "route";
    else if (base.includes("hook") || base.includes("use")) type = "hook";
    else if (base.includes("util") || base.includes("helper")) type = "utility";
    else if (base.includes("config") || base.includes("settings")) type = "config";
    else if (base.includes("type") || base.includes("interface") || base.endsWith(".d.ts")) type = "type";
    else if (/\.(css|scss|sass)$/.test(base)) type = "style";

    const fileEntry: ProjectFileMapEntry = {
      path: filePath,
      purpose,
      exports,
      imports,
      type,
      hash: hashContent(content),
      lastChanged: stat.mtime.toISOString(),
      size: stat.size,
      dependencies: imports.filter(i => !i.startsWith(".") && !i.startsWith("@") && !i.startsWith("~")),
      dependents: existing?.dependents || [],
    };

    projectMap.fileMap.set(filePath, fileEntry);

    // Update dependency graph
    projectMap.dependencyGraph.nodes.set(filePath, fileEntry.dependencies);
    for (const imp of fileEntry.dependencies) {
      if (!projectMap.dependencyGraph.reverse.has(imp)) {
        projectMap.dependencyGraph.reverse.set(imp, []);
      }
      const rev = projectMap.dependencyGraph.reverse.get(imp)!;
      if (!rev.includes(filePath)) rev.push(filePath);
    }

    // Update dependents
    for (const dep of fileEntry.dependencies) {
      const depEntry = projectMap.fileMap.get(dep);
      if (depEntry && !depEntry.dependents.includes(filePath)) {
        depEntry.dependents.push(filePath);
      }
    }

    projectMap.version = Date.now();
    projectMap.generatedAt = new Date().toISOString();
  } catch { }
}

/**
 * Analyze impact of a file change
 */
export async function analyzeImpact(
  projectId: string,
  changedFile: string,
  workspaceId = projectId
): Promise<ImpactAnalysis> {
  const projectMap = await getProjectMap(projectId, workspaceId);
  const directDependents = projectMap.dependencyGraph.reverse.get(changedFile) || [];

  // Find transitive dependents (BFS)
  const transitiveDependents: string[] = [];
  const visited = new Set<string>([changedFile]);
  const queue = [...directDependents];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    transitiveDependents.push(current);

    const deps = projectMap.dependencyGraph.reverse.get(current) || [];
    for (const dep of deps) {
      if (!visited.has(dep)) queue.push(dep);
    }
  }

  // Find affected routes, components, tests
  const affectedRoutes = projectMap.routes
    .filter(r => r.file === changedFile || directDependents.includes(r.file) || transitiveDependents.includes(r.file))
    .map(r => r.path);

  const affectedComponents = projectMap.components
    .filter(c => c.file === changedFile || directDependents.includes(c.file) || transitiveDependents.includes(c.file))
    .map(c => c.name);

  const affectedTests = Array.from(projectMap.fileMap.entries())
    .filter(([_, entry]) => entry.type === "test" &&
      (entry.dependencies.includes(changedFile) ||
       directDependents.some(d => entry.dependencies.includes(d)) ||
       transitiveDependents.some(d => entry.dependencies.includes(d))))
    .map(([path]) => path);

  // Determine risk level
  let riskLevel: ImpactAnalysis["riskLevel"] = "low";
  if (directDependents.length > 10 || affectedRoutes.length > 5) riskLevel = "high";
  else if (directDependents.length > 3 || affectedRoutes.length > 0) riskLevel = "medium";

  // Recommended actions
  const recommendedActions: string[] = [];
  if (affectedRoutes.length > 0) recommendedActions.push("Run integration tests for affected routes");
  if (affectedComponents.length > 0) recommendedActions.push("Visual regression test affected components");
  if (affectedTests.length > 0) recommendedActions.push("Run affected test files");
  if (riskLevel === "high") recommendedActions.push("Consider phased rollout or feature flag");

  return {
    changedFile,
    directDependents,
    transitiveDependents,
    affectedRoutes,
    affectedComponents,
    affectedTests,
    riskLevel,
    recommendedActions,
  };
}

/**
 * Select relevant files for a goal
 */
export async function selectContextForGoal(
  projectId: string,
  goal: string,
  workspaceId = projectId,
  maxTokens = 50000
): Promise<SmartContextSelection> {
  const projectMap = await getProjectMap(projectId, workspaceId);
  const goalLower = goal.toLowerCase();

  // Score files by relevance to goal
  const scoredFiles: Array<{ path: string; score: number; reason: string }> = [];

  for (const [filePath, entry] of projectMap.fileMap) {
    let score = 0;
    const reasons: string[] = [];

    // Match exports/imports to goal keywords
    const goalKeywords = goalLower.split(/\s+/).filter(w => w.length > 2);
    for (const keyword of goalKeywords) {
      // Check exports
      for (const exp of entry.exports) {
        if (exp.toLowerCase().includes(keyword)) {
          score += 10;
          reasons.push(`export matches "${keyword}"`);
        }
      }
      // Check purpose
      if (entry.purpose.toLowerCase().includes(keyword)) {
        score += 5;
        reasons.push(`purpose matches "${keyword}"`);
      }
      // Check file path
      if (filePath.toLowerCase().includes(keyword)) {
        score += 3;
        reasons.push(`path matches "${keyword}"`);
      }
    }

    // Boost important files
    if (entry.type === "route" || entry.type === "component") score += 2;
    if (projectMap.entryPoints.includes(filePath)) score += 5;

    if (score > 0) {
      scoredFiles.push({ path: filePath, score, reason: reasons.join("; ") });
    }
  }

  // Sort by score
  scoredFiles.sort((a, b) => b.score - a.score);

  // Select top files within token budget
  const selected: string[] = [];
  let estimatedTokens = 0;
  const avgTokensPerFile = 500;

  for (const scored of scoredFiles) {
    if (estimatedTokens + avgTokensPerFile > maxTokens) break;
    selected.push(scored.path);
    estimatedTokens += avgTokensPerFile;
  }

  // Always include entry points
  for (const ep of projectMap.entryPoints) {
    if (!selected.includes(ep)) selected.unshift(ep);
  }

  return {
    goal,
    relevantFiles: selected,
    estimatedTokens,
    rationale: `Selected ${selected.length} files based on keyword matching to goal. Top reasons: ${scoredFiles.slice(0, 3).map(f => f.reason).join(", ")}`,
  };
}

/**
 * Save project map to disk
 */
export async function saveProjectMap(projectId: string): Promise<void> {
  const projectMap = projectMaps.get(projectId);
  if (!projectMap) return;

  const mapPath = path.join(getWorkspaceRoot(projectId), ".infinity", "project-map.json");
  await fs.mkdir(path.dirname(mapPath), { recursive: true });

  // Convert Map to object for serialization
  const serializable = {
    ...projectMap,
    fileMap: Object.fromEntries(projectMap.fileMap),
    dependencyGraph: {
      nodes: Object.fromEntries(projectMap.dependencyGraph.nodes),
      reverse: Object.fromEntries(projectMap.dependencyGraph.reverse),
    },
  };

  await fs.writeFile(mapPath, JSON.stringify(serializable, null, 2));
}

/**
 * Load project map from disk
 */
export async function loadProjectMap(projectId: string): Promise<ProjectMap | null> {
  const mapPath = path.join(getWorkspaceRoot(projectId), ".infinity", "project-map.json");

  try {
    const content = await fs.readFile(mapPath, "utf-8");
    const data = JSON.parse(content);

    const projectMap: ProjectMap = {
      ...data,
      fileMap: new Map(Object.entries(data.fileMap)),
      dependencyGraph: {
        nodes: new Map(Object.entries(data.dependencyGraph.nodes)),
        reverse: new Map(Object.entries(data.dependencyGraph.reverse)),
      },
    };

    projectMaps.set(projectId, projectMap);
    return projectMap;
  } catch { }

  return null;
}

/**
 * Export types and helpers
 */
export function extractExports(content: string): string[] {
  const exports: string[] = [];
  const regex = /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_]+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    exports.push(match[1]);
  }
  const namedExportRegex = /export\s*\{([^}]+)\}/g;
  while ((match = namedExportRegex.exec(content)) !== null) {
    for (const name of match[1].split(",")) {
      const cleaned = name.trim().split(/\s+as\s+/)[0].trim();
      if (cleaned) exports.push(cleaned);
    }
  }
  return [...new Set(exports)].slice(0, 30);
}

function inferPurpose(relPath: string, content: string): string {
  const base = path.basename(relPath);
  const commentMatch = content.match(/\/\/\s*(.+?)\n/);
  if (commentMatch) return commentMatch[1].slice(0, 120);
  if (/index\.(ts|tsx|js|jsx)$/.test(base)) return `Entry point: ${relPath}`;
  if (/test|spec/.test(base)) return `Test suite: ${relPath}`;
  if (/route|controller/.test(base)) return `Route handler: ${relPath}`;
  if (/component|ui/.test(base)) return `UI component: ${relPath}`;
  if (/schema|model/.test(base)) return `Data model: ${relPath}`;
  return `Source file: ${relPath}`;
}

export default {
  buildProjectMap,
  getProjectMap,
  updateProjectMapForFile,
  analyzeImpact,
  selectContextForGoal,
  saveProjectMap,
  loadProjectMap,
};