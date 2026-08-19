import { readFileSync, readdirSync, existsSync, watch } from "fs";
import { join, extname, basename } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { BUILTIN_PROJECT_TYPES, type ProjectType, type ProjectTypeRegistry, getProjectTypeRegistry as getBuiltinRegistry } from "./project-types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

/**
 * Project Type Plugin System
 *
 * Allows users to define custom project types via local JSON/YAML files
 * in the `.infinity/project-types/` directory.
 */

// Plugin directory (relative to project root)
const PLUGIN_DIR = join(process.cwd(), ".infinity", "project-types");

// Schema for plugin manifest (matches ProjectTypeSchema but with optional id for auto-generation)
const PluginManifestSchema = z.object({
  id: z.string().optional(), // Auto-generated from filename if not provided
  name: z.string().min(1),
  icon: z.string().min(1),
  description: z.string().min(1),
  components: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  defaultViews: z.array(z.string()).default([]),
  settingsSchema: z.record(z.unknown()).optional(),
  extends: z.string().optional(),
  color: z.string().default("#0ea5e9"),
  tags: z.array(z.string()).default([]),
  // Plugin metadata
  version: z.string().default("1.0.0"),
  author: z.string().optional(),
  homepage: z.string().url().optional(),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

// Result of plugin loading
interface PluginLoadResult {
  success: boolean;
  type?: ProjectType;
  errors: string[];
  warnings: string[];
  sourcePath: string;
}

// Cache for loaded plugins
let pluginCache: Map<string, { type: ProjectType; manifest: PluginManifest; sourcePath: string; mtime: number }> = new Map();
let watcherInitialized = false;

/**
 * Initialize the plugin system - create plugin directory if it doesn't exist
 */
export function initPluginSystem(): void {
  if (!existsSync(PLUGIN_DIR)) {
    try {
      require("fs").mkdirSync(PLUGIN_DIR, { recursive: true });
      // Create example plugin file
      const examplePath = join(PLUGIN_DIR, "example-project-type.json");
      if (!existsSync(examplePath)) {
        const examplePlugin = {
          id: "my-custom-type",
          name: "My Custom Project Type",
          icon: "✨",
          description: "A custom project type for my specific workflow",
          components: ["CustomComponent1", "CustomComponent2"],
          tools: ["custom.tool1", "custom.tool2"],
          defaultViews: ["custom-view", "chats", "files", "memory"],
          color: "#f59e0b",
          tags: ["custom", "workflow"],
          version: "1.0.0",
          author: "Your Name",
          // settingsSchema: { ... } // optional JSON Schema for type-specific settings
        };
        require("fs").writeFileSync(examplePath, JSON.stringify(examplePlugin, null, 2));
      }
    } catch (error) {
      console.warn("[Project Type Plugins] Failed to initialize plugin directory:", error);
    }
  }
}

/**
 * Load a single plugin file
 */
function loadPluginFile(filePath: string): PluginLoadResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const content = readFileSync(filePath, "utf-8");
    let manifest: PluginManifest;

    const ext = extname(filePath).toLowerCase();
    if (ext === ".json") {
      manifest = JSON.parse(content);
    } else if (ext === ".yaml" || ext === ".yml") {
      // Simple YAML parsing - in production, use js-yaml
      try {
        const yaml = require("js-yaml");
        manifest = yaml.load(content);
      } catch {
        errors.push("YAML parsing requires 'js-yaml' package. Install with: pnpm add js-yaml");
        return { success: false, errors, warnings, sourcePath: filePath };
      }
    } else {
      errors.push(`Unsupported file extension: ${ext}. Use .json, .yaml, or .yml`);
      return { success: false, errors, warnings, sourcePath: filePath };
    }

    // Validate manifest
    const validationResult = PluginManifestSchema.safeParse(manifest);
    if (!validationResult.success) {
      errors.push(...validationResult.error.issues.map(i => `${i.path.join(".")}: ${i.message}`));
      return { success: false, errors, warnings, sourcePath: filePath };
    }

    const validManifest = validationResult.data;

    // Generate ID from filename if not provided
    const fileName = basename(filePath, ext);
    const id = validManifest.id || fileName.toLowerCase().replace(/[^a-z0-9]/g, "-");

    // Check for ID conflicts with built-in types
    if (BUILTIN_PROJECT_TYPES.some(t => t.id === id)) {
      errors.push(`Plugin ID "${id}" conflicts with built-in project type`);
      return { success: false, errors, warnings, sourcePath: filePath };
    }

    // Check for ID conflicts with other loaded plugins
    for (const [, cached] of pluginCache) {
      if (cached.type.id === id) {
        errors.push(`Plugin ID "${id}" conflicts with another plugin`);
        return { success: false, errors, warnings, sourcePath: filePath };
      }
    }

    // Create ProjectType from manifest
    const projectType: ProjectType = {
      id,
      name: validManifest.name,
      icon: validManifest.icon,
      description: validManifest.description,
      components: validManifest.components,
      tools: validManifest.tools,
      defaultViews: validManifest.defaultViews,
      settingsSchema: validManifest.settingsSchema,
      extends: validManifest.extends,
      color: validManifest.color,
      tags: validManifest.tags,
    };

    // Validate extends reference
    if (projectType.extends) {
      const parentExists = BUILTIN_PROJECT_TYPES.some(t => t.id === projectType.extends) ||
                           Array.from(pluginCache.values()).some(c => c.type.id === projectType.extends);
      if (!parentExists) {
        warnings.push(`Extends "${projectType.extends}" not found - will fallback to "general"`);
        projectType.extends = "general";
      }
    }

    // Get file mtime for change detection
    const stats = require("fs").statSync(filePath);

    return {
      success: true,
      type: projectType,
      errors,
      warnings,
      sourcePath: filePath,
    };
  } catch (error) {
    errors.push(`Failed to load plugin: ${error instanceof Error ? error.message : String(error)}`);
    return { success: false, errors, warnings, sourcePath: filePath };
  }
}

/**
 * Load all plugins from the plugin directory
 */
export function loadAllPlugins(): { plugins: ProjectType[]; errors: string[]; warnings: string[] } {
  initPluginSystem();

  const plugins: ProjectType[] = [];
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  if (!existsSync(PLUGIN_DIR)) {
    return { plugins: [], errors: [], warnings: [] };
  }

  const files = readdirSync(PLUGIN_DIR).filter(f =>
    f.endsWith(".json") || f.endsWith(".yaml") || f.endsWith(".yml")
  );

  for (const file of files) {
    const filePath = join(PLUGIN_DIR, file);
    const result = loadPluginFile(filePath);

    if (result.success && result.type) {
      // Update cache
      const stats = require("fs").statSync(filePath);
      pluginCache.set(result.type.id, {
        type: result.type,
        manifest: result.type as unknown as PluginManifest, // simplified
        sourcePath: filePath,
        mtime: stats.mtimeMs,
      });
      plugins.push(result.type);
    }

    allErrors.push(...result.errors.map(e => `[${file}] ${e}`));
    allWarnings.push(...result.warnings.map(w => `[${file}] ${w}`));
  }

  return { plugins, errors: allErrors, warnings: allWarnings };
}

/**
 * Get the complete project type registry (built-in + plugins)
 */
export function getProjectTypeRegistry(): ProjectTypeRegistry {
  const builtin = getBuiltinRegistry();
  const { plugins } = loadAllPlugins();

  return {
    types: [...builtin.types, ...plugins],
    defaultType: builtin.defaultType,
  };
}

/**
 * Get a project type by ID (checks built-in first, then plugins)
 */
export function getProjectTypeWithPlugins(id: string): ProjectType | undefined {
  // Check built-in first
  const builtin = BUILTIN_PROJECT_TYPES.find(t => t.id === id);
  if (builtin) return builtin;

  // Check plugins
  const cached = pluginCache.get(id);
  if (cached) return cached.type;

  // Reload plugins and check again
  loadAllPlugins();
  return pluginCache.get(id)?.type;
}

/**
 * Validate a project type ID (built-in or plugin)
 */
export function validateProjectTypeWithPlugins(id: string): boolean {
  return BUILTIN_PROJECT_TYPES.some(t => t.id === id) || pluginCache.has(id) || loadAllPlugins().plugins.some(t => t.id === id);
}

/**
 * Get all available project types (built-in + plugins)
 */
export function getAllProjectTypesWithPlugins(): ProjectType[] {
  const registry = getProjectTypeRegistry();
  return registry.types;
}

/**
 * Reload plugins (useful for development/hot-reload)
 */
export function reloadPlugins(): { plugins: ProjectType[]; errors: string[]; warnings: string[] } {
  pluginCache.clear();
  return loadAllPlugins();
}

/**
 * Start watching plugin directory for changes (hot reload in development)
 */
export function watchPlugins(onChange?: (plugins: ProjectType[]) => void): () => void {
  if (watcherInitialized) {
    console.warn("[Project Type Plugins] Watcher already initialized");
    return () => {};
  }

  initPluginSystem();

  try {
    const watcher = watch(PLUGIN_DIR, { persistent: false }, (eventType, filename) => {
      if (filename && (filename.endsWith(".json") || filename.endsWith(".yaml") || filename.endsWith(".yml"))) {
        console.log(`[Project Type Plugins] Plugin file ${eventType}: ${filename}`);
        const result = reloadPlugins();
        if (onChange) {
          onChange(result.plugins);
        }
      }
    });

    watcherInitialized = true;

    return () => {
      watcher.close();
      watcherInitialized = false;
    };
  } catch (error) {
    console.warn("[Project Type Plugins] Failed to start file watcher:", error);
    return () => {};
  }
}

/**
 * Get plugin directory path
 */
export function getPluginDirectory(): string {
  return PLUGIN_DIR;
}

/**
 * Create a new plugin file from a template
 */
export function createPluginTemplate(id: string, name: string): string {
  const template = {
    id,
    name,
    icon: "✨",
    description: `Custom project type: ${name}`,
    components: [],
    tools: [],
    defaultViews: ["overview", "chats", "files", "memory"],
    color: "#f59e0b",
    tags: ["custom"],
    version: "1.0.0",
    author: "",
  };

  const filePath = join(PLUGIN_DIR, `${id}.json`);
  require("fs").writeFileSync(filePath, JSON.stringify(template, null, 2));

  return filePath;
}

/**
 * Delete a plugin file
 */
export function deletePlugin(id: string): boolean {
  // Don't allow deleting built-in types
  if (BUILTIN_PROJECT_TYPES.some(t => t.id === id)) {
    return false;
  }

  // Find and delete the plugin file
  for (const [cachedId, cached] of pluginCache) {
    if (cachedId === id) {
      try {
        require("fs").unlinkSync(cached.sourcePath);
        pluginCache.delete(id);
        return true;
      } catch {
        return false;
      }
    }
  }

  // Check for orphaned files
  const files = readdirSync(PLUGIN_DIR).filter(f =>
    f.endsWith(".json") || f.endsWith(".yaml") || f.endsWith(".yml")
  );

  for (const file of files) {
    const filePath = join(PLUGIN_DIR, file);
    const result = loadPluginFile(filePath);
    if (result.success && result.type?.id === id) {
      try {
        require("fs").unlinkSync(filePath);
        pluginCache.delete(id);
        return true;
      } catch {
        return false;
      }
    }
  }

  return false;
}