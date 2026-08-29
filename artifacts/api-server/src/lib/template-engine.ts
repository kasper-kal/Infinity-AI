/**
 * Template Engine
 *
 * Phase 22: Component Marketplace & Template Library
 *
 * Handles template customization wizard:
 *   - Variable substitution with type validation
 *   - Conditional file inclusion (expression evaluation)
 *   - Post-install scripts execution
 *   - Design system merging
 *   - Dependency resolution for template components
 */

import { promises as fs } from 'fs';
import path from 'path';
import { TemplateManifest, ComponentRegistryClient, BUILTIN_TEMPLATES, getComponentRegistry } from './component-registry';

export interface TemplateVariables {
  [key: string]: string;
}

export interface TemplateCustomizationResult {
  success: boolean;
  filesWritten: string[];
  warnings: string[];
  errors: string[];
  designSystem: Record<string, any>;
  postInstallCommands: string[];
  manifest: TemplateManifest;
}

export interface VariableDefinition {
  key: string;
  label: string;
  type: 'text' | 'color' | 'select' | 'boolean' | 'number';
  default?: string;
  options?: string[];
  required: boolean;
  validation?: (value: string) => { valid: boolean; message?: string };
}

export class TemplateEngine {
  private registry: ComponentRegistryClient;
  private builtinTemplates: TemplateManifest[];

  constructor(opts?: { registry?: ComponentRegistryClient }) {
    this.registry = opts?.registry || getComponentRegistry();
    this.builtinTemplates = BUILTIN_TEMPLATES;
  }

  // --------------------------------------------------------------------------
  // Template Discovery
  // --------------------------------------------------------------------------

  async listTemplates(opts?: { category?: string; framework?: string; includeBuiltin?: boolean }): Promise<TemplateManifest[]> {
    const includeBuiltin = opts?.includeBuiltin ?? true;
    let templates = includeBuiltin ? [...this.builtinTemplates] : [];

    if (!includeBuiltin || opts?.category || opts?.framework) {
      const remote = await this.registry.searchTemplates({
        category: opts?.category,
        framework: opts?.framework,
        limit: 100,
      });
      templates.push(...remote);
    }
    return templates;
  }

  async getTemplate(name: string, version?: string): Promise<TemplateManifest | null> {
    // Check builtin first
    const builtin = this.builtinTemplates.find((t) => t.name === name);
    if (builtin && (!version || builtin.version === version)) return builtin;
    return this.registry.getTemplate(name, version);
  }

  // --------------------------------------------------------------------------
  // Variable Validation
  // --------------------------------------------------------------------------

  validateVariables(manifest: TemplateManifest, variables: TemplateVariables): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    for (const v of manifest.variables) {
      const value = variables[v.key];
      if (v.required && (!value || value.trim() === '')) {
        errors.push(`Required variable "${v.label}" (${v.key}) is missing`);
        continue;
      }
      if (!value && !v.required) continue;

      switch (v.type) {
        case 'color':
          if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
            errors.push(`"${v.label}" must be a hex color like #6366f1`);
          }
          break;
        case 'number':
          if (isNaN(Number(value))) {
            errors.push(`"${v.label}" must be a number`);
          }
          break;
        case 'select':
          if (v.options && !v.options.includes(value)) {
            errors.push(`"${v.label}" must be one of: ${v.options.join(', ')}`);
          }
          break;
        case 'boolean':
          if (!['true', 'false'].includes(value)) {
            errors.push(`"${v.label}" must be true or false`);
          }
          break;
      }
      if (v.validation) {
        const res = v.validation(value);
        if (!res.valid) errors.push(res.message || `Validation failed for "${v.label}"`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  // --------------------------------------------------------------------------
  // Template Customization (Main Entry Point)
  // --------------------------------------------------------------------------

  async customizeTemplate(
    templateName: string,
    variables: TemplateVariables,
    targetDir: string,
    version?: string,
  ): Promise<TemplateCustomizationResult> {
    const manifest = await this.getTemplate(templateName, version);
    if (!manifest) {
      return { success: false, filesWritten: [], warnings: [], errors: [`Template "${templateName}" not found`], designSystem: {}, postInstallCommands: [], manifest: null as any };
    }

    const validation = this.validateVariables(manifest, variables);
    if (!validation.valid) {
      return { success: false, filesWritten: [], warnings: [], errors: validation.errors, designSystem: {}, postInstallCommands: [], manifest };
    }

    // Merge with design system defaults
    const mergedVariables = { ...this.getDefaults(manifest.variables), ...variables };

    const filesWritten: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      // Write template files
      for (const file of manifest.files) {
        if (file.conditional) {
          if (!this.evalCondition(file.conditional, mergedVariables)) continue;
        }
        const content = this.substituteVariables(file.content, mergedVariables);
        const filePath = path.join(targetDir, this.substituteVariables(file.path, mergedVariables));
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, 'utf-8');
        filesWritten.push(filePath);
      }

      // Write template manifest for reference
      await fs.writeFile(
        path.join(targetDir, '.infinity-template.json'),
        JSON.stringify({ ...manifest, variables: mergedVariables }, null, 2),
        'utf-8',
      );

      // Run post-install commands (recorded for user)
      const postInstallCommands = manifest.postInstall || [];

      return {
        success: true,
        filesWritten,
        warnings,
        errors,
        designSystem: manifest.designSystem,
        postInstallCommands,
        manifest,
      };
    } catch (e: any) {
      errors.push(`Template customization failed: ${e.message}`);
      return { success: false, filesWritten, warnings, errors, designSystem: {}, postInstallCommands: [], manifest };
    }
  }

  // --------------------------------------------------------------------------
  // Component Installation from Template
  // --------------------------------------------------------------------------

  async installTemplateComponents(
    manifest: TemplateManifest,
    targetDir: string,
    variables: TemplateVariables,
  ): Promise<{ installed: string[]; warnings: string[]; errors: string[] }> {
    const registry = getComponentRegistry();
    const installed: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    // Extract component references from template files (heuristic: imports from @infinity/* or known patterns)
    const componentNames = new Set<string>();
    for (const file of manifest.files) {
      const imports = this.extractImports(file.content);
      for (const imp of imports) {
        if (imp.startsWith('@infinity/') || imp.startsWith('infinity-')) {
          componentNames.add(imp);
        }
      }
    }

    // Install each component
    for (const compName of componentNames) {
      const result = await registry.installComponent(compName, { targetDir });
      if (result.errors.length) errors.push(...result.errors);
      if (result.warnings.length) warnings.push(...result.warnings);
      if (result.installed.length) installed.push(...result.installed);
    }

    return { installed, warnings, errors };
  }

  // --------------------------------------------------------------------------
  // Wizard Helpers
  // --------------------------------------------------------------------------

  getVariableDefinitions(templateName: string): VariableDefinition[] {
    const template = this.builtinTemplates.find((t) => t.name === templateName);
    if (!template) return [];
    return template.variables.map((v) => ({
      key: v.key,
      label: v.label,
      type: v.type,
      default: v.default,
      options: v.options,
      required: v.required,
    }));
  }

  getTemplatePreview(templateName: string): string | null {
    const template = this.builtinTemplates.find((t) => t.name === templateName);
    return template?.preview || null;
  }

  // --------------------------------------------------------------------------
  // Design System Merge
  // --------------------------------------------------------------------------

  async mergeDesignSystems(
    projectDesignSystem: Record<string, any>,
    templateDesignSystem: Record<string, any>,
    strategy: 'template-wins' | 'project-wins' | 'deep-merge' = 'deep-merge',
  ): Promise<Record<string, any>> {
    switch (strategy) {
      case 'template-wins':
        return { ...projectDesignSystem, ...templateDesignSystem };
      case 'project-wins':
        return { ...templateDesignSystem, ...projectDesignSystem };
      case 'deep-merge':
      default:
        return this.deepMerge(projectDesignSystem, templateDesignSystem);
    }
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private getDefaults(variables: TemplateManifest['variables']): Record<string, string> {
    const defaults: Record<string, string> = {};
    for (const v of variables) {
      if (v.default !== undefined) defaults[v.key] = v.default;
    }
    return defaults;
  }

  private substituteVariables(content: string, vars: Record<string, string>): string {
    return content.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
  }

  private evalCondition(expr: string, vars: Record<string, string>): boolean {
    try {
      // Allow: variable names, ==, !=, &&, ||, !, parentheses, string literals
      const sanitized = expr.replace(/[^\w\s<>!=.&|()'"]/g, '');
      const fn = new Function(...Object.keys(vars), `return (${sanitized});`);
      return !!fn(...Object.values(vars));
    } catch {
      return false;
    }
  }

  private extractImports(content: string): string[] {
    const imports: string[] = [];
    // import ... from 'pkg'
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }
    // require('pkg')
    const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }
    return imports;
  }

  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }
}

// Singleton
let _templateEngine: TemplateEngine | null = null;
export function getTemplateEngine(opts?: { registry?: ComponentRegistryClient }): TemplateEngine {
  if (!_templateEngine) {
    _templateEngine = new TemplateEngine(opts);
  }
  return _templateEngine;
}

// ============================================================================
// Template Generator — Create new template from existing project
// ============================================================================

export interface TemplateGeneratorOptions {
  name: string;
  title: string;
  description: string;
  category: TemplateManifest['category'];
  framework: TemplateManifest['framework'];
  sourceDir: string;
  variables: VariableDefinition[];
  designSystem?: Record<string, any>;
  excludePatterns?: string[];
}

export class TemplateGenerator {
  async generateTemplate(opts: TemplateGeneratorOptions): Promise<{ manifest: TemplateManifest; files: Array<{ path: string; content: string }> }> {
    const files: Array<{ path: string; content: string }> = [];

    // Walk source directory
    await this.walkDir(opts.sourceDir, '', (relPath, content) => {
      if (this.shouldExclude(relPath, opts.excludePatterns)) return;
      // Convert to template by substituting known values with variables
      let templateContent = content;
      for (const v of opts.variables) {
        if (v.default) {
          const escaped = v.default.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          templateContent = templateContent.replace(new RegExp(escaped, 'g'), `{{${v.key}}}`);
        }
      }
      files.push({ path: relPath, content: templateContent });
    });

    const manifest: TemplateManifest = {
      name: opts.name,
      version: '1.0.0',
      title: opts.title,
      description: opts.description,
      category: opts.category,
      framework: opts.framework,
      author: 'Generated',
      license: 'MIT',
      tags: [],
      variables: opts.variables.map((v) => ({
        key: v.key,
        label: v.label,
        type: v.type,
        default: v.default,
        options: v.options,
        required: v.required,
      })),
      files: files.map((f) => ({ path: f.path, content: f.content })),
      designSystem: opts.designSystem || {},
      deployConfig: { platform: 'vercel', buildCommand: 'npm run build', outputDir: 'dist' },
      postInstall: ['npm install'],
    };

    return { manifest, files };
  }

  private async walkDir(
    baseDir: string,
    relBase: string,
    callback: (relPath: string, content: string) => void,
  ): Promise<void> {
    const entries = await fs.readdir(path.join(baseDir, relBase), { withFileTypes: true });
    for (const entry of entries) {
      const relPath = path.join(relBase, entry.name);
      const absPath = path.join(baseDir, relPath);
      if (entry.isDirectory()) {
        await this.walkDir(baseDir, relPath, callback);
      } else if (entry.isFile()) {
        try {
          const content = await fs.readFile(absPath, 'utf-8');
          callback(relPath, content);
        } catch { /* skip binary */ }
      }
    }
  }

  private shouldExclude(relPath: string, patterns?: string[]): boolean {
    if (!patterns) return false;
    const base = path.basename(relPath);
    return patterns.some((p) => {
      if (p.includes('*')) {
        const regex = new RegExp('^' + p.replace(/\*/g, '.*') + '$');
        return regex.test(relPath) || regex.test(base);
      }
      return relPath === p || base === p || relPath.startsWith(p + '/');
    });
  }
}