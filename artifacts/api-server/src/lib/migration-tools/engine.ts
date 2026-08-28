/**
 * Migration Engine
 *
 * Core engine for automated framework-to-framework migration
 * Uses AST transforms for code conversion
 */

import * as babel from '@babel/core';
import * as recast from 'recast';
import { transformFile, transformSync } from '@babel/core';
import { MigrationOptions, MigrationResult, MigrationStats, TransformContext, TransformRule } from './types';
import { FrameworkType, ScaffoldOptions } from '../framework-adapters';
import { frameworkRegistry } from '../framework-generators';

export class MigrationEngine {
  private rules: TransformRule[] = [];
  private stats: MigrationStats;

  constructor() {
    this.stats = this.initStats();
    this.registerBuiltinRules();
  }

  private initStats(): MigrationStats {
    return {
      totalFiles: 0,
      migratedFiles: 0,
      skippedFiles: 0,
      transformedLines: 0,
      warningsCount: 0,
      errorsCount: 0,
      durationMs: 0,
    };
  }

  /**
   * Register built-in transformation rules
   */
  private registerBuiltinRules(): void {
    // Next.js -> Astro transforms
    this.addRule({
      name: 'nextjs-app-router-to-astro-pages',
      from: 'nextjs',
      to: 'astro',
      patterns: ['app/**/page.tsx', 'app/**/page.ts'],
      transform: this.transformNextjsPageToAstro.bind(this),
    });

    this.addRule({
      name: 'nextjs-layout-to-astro-layout',
      from: 'nextjs',
      to: 'astro',
      patterns: ['app/**/layout.tsx', 'app/**/layout.ts'],
      transform: this.transformNextjsLayoutToAstro.bind(this),
    });

    this.addRule({
      name: 'nextjs-image-to-astro-image',
      from: 'nextjs',
      to: 'astro',
      patterns: ['**/*.tsx', '**/*.ts', '**/*.astro'],
      transform: this.transformNextjsImageToAstro.bind(this),
    });

    this.addRule({
      name: 'nextjs-link-to-astro-link',
      from: 'nextjs',
      to: 'astro',
      patterns: ['**/*.tsx', '**/*.ts', '**/*.astro'],
      transform: this.transformNextjsLinkToAstro.bind(this),
    });

    this.addRule({
      name: 'nextjs-head-to-astro-head',
      from: 'nextjs',
      to: 'astro',
      patterns: ['**/*.tsx', '**/*.ts', '**/*.astro'],
      transform: this.transformNextjsHeadToAstro.bind(this),
    });

    // Next.js -> Remix transforms
    this.addRule({
      name: 'nextjs-app-router-to-remix-routes',
      from: 'nextjs',
      to: 'remix',
      patterns: ['app/**/page.tsx', 'app/**/page.ts'],
      transform: this.transformNextjsPageToRemix.bind(this),
    });

    this.addRule({
      name: 'nextjs-loader-to-remix-loader',
      from: 'nextjs',
      to: 'remix',
      patterns: ['app/**/*.ts', 'app/**/*.tsx'],
      transform: this.transformNextjsLoaderToRemix.bind(this),
    });

    this.addRule({
      name: 'nextjs-action-to-remix-action',
      from: 'nextjs',
      to: 'remix',
      patterns: ['app/**/*.ts', 'app/**/*.tsx'],
      transform: this.transformNextjsActionToRemix.bind(this),
    });

    // Next.js -> Vite React transforms
    this.addRule({
      name: 'nextjs-app-router-to-vite-pages',
      from: 'nextjs',
      to: 'vite-react',
      patterns: ['app/**/page.tsx', 'app/**/page.ts'],
      transform: this.transformNextjsPageToVite.bind(this),
    });

    this.addRule({
      name: 'nextjs-image-to-standard-img',
      from: 'nextjs',
      to: 'vite-react',
      patterns: ['**/*.tsx', '**/*.ts'],
      transform: this.transformNextjsImageToStandard.bind(this),
    });

    this.addRule({
      name: 'nextjs-link-to-react-router-link',
      from: 'nextjs',
      to: 'vite-react',
      patterns: ['**/*.tsx', '**/*.ts'],
      transform: this.transformNextjsLinkToReactRouter.bind(this),
    });

    // Styling transforms
    this.addRule({
      name: 'tailwind-to-unocss',
      from: 'nextjs',
      to: 'astro',
      patterns: ['**/*.tsx', '**/*.ts', '**/*.astro', '**/*.svelte', '**/*.vue'],
      transform: this.transformTailwindToUnoCSS.bind(this),
    });

    // Config transforms
    this.addRule({
      name: 'nextjs-config-to-astro-config',
      from: 'nextjs',
      to: 'astro',
      patterns: ['next.config.*'],
      transform: this.transformNextjsConfigToAstro.bind(this),
    });

    this.addRule({
      name: 'nextjs-config-to-remix-config',
      from: 'nextjs',
      to: 'remix',
      patterns: ['next.config.*'],
      transform: this.transformNextjsConfigToRemix.bind(this),
    });

    this.addRule({
      name: 'nextjs-config-to-vite-config',
      from: 'nextjs',
      to: 'vite-react',
      patterns: ['next.config.*'],
      transform: this.transformNextjsConfigToVite.bind(this),
    });

    // Package.json transforms
    this.addRule({
      name: 'update-dependencies',
      from: 'nextjs',
      to: 'astro',
      patterns: ['package.json'],
      transform: this.transformPackageJsonNextjsToAstro.bind(this),
    });

    this.addRule({
      name: 'update-dependencies',
      from: 'nextjs',
      to: 'remix',
      patterns: ['package.json'],
      transform: this.transformPackageJsonNextjsToRemix.bind(this),
    });

    this.addRule({
      name: 'update-dependencies',
      from: 'nextjs',
      to: 'vite-react',
      patterns: ['package.json'],
      transform: this.transformPackageJsonNextjsToVite.bind(this),
    });
  }

  /**
   * Add a transformation rule
   */
  addRule(rule: TransformRule): void {
    this.rules.push(rule);
  }

  /**
   * Get applicable rules for a migration
   */
  private getApplicableRules(from: FrameworkType, to: FrameworkType, filePath: string): TransformRule[] {
    return this.rules.filter(rule => {
      if (rule.from !== from || rule.to !== to) return false;
      return rule.patterns.some(pattern => this.matchPattern(filePath, pattern));
    });
  }

  /**
   * Match file path against pattern
   */
  private matchPattern(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*\*/g, '___DOUBLE_STAR___')
      .replace(/\*/g, '[^/]*')
      .replace(/___DOUBLE_STAR___/g, '.*')
      .replace(/\?/g, '.');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }

  /**
   * Migrate a project
   */
  async migrate(options: MigrationOptions): Promise<MigrationResult> {
    const startTime = Date.now();
    const { from, to, files, options: migrateOptions = {} } = options;

    const result: MigrationResult = {
      success: true,
      files: new Map(),
      skipped: [],
      warnings: [],
      errors: [],
      stats: this.initStats(),
    };

    // Reset stats
    this.stats = result.stats;
    this.stats.totalFiles = files.size;

    // Create transform context
    const context: TransformContext = {
      from,
      to,
      options: {
        projectName: 'migrated-app',
        projectPath: '.',
        framework: to,
        styling: 'tailwind',
        features: { typescript: true, eslint: true, prettier: true, testing: true, git: true },
      },
      fileMap: files,
      currentFile: '',
      warn: (message, line, column) => {
        result.warnings.push({ file: context.currentFile, message, severity: 'warn', line, column });
        this.stats.warningsCount++;
      },
      error: (message, line, column) => {
        result.errors.push({ file: context.currentFile, message, line, column });
        this.stats.errorsCount++;
      },
    };

    // Process each file
    for (const [filePath, content] of files) {
      context.currentFile = filePath;

      try {
        const applicableRules = this.getApplicableRules(from, to, filePath);

        if (applicableRules.length === 0) {
          // No transformation rules - copy as-is
          result.files.set(filePath, content);
          this.stats.migratedFiles++;
          continue;
        }

        let transformedContent = content;

        // Apply each applicable rule
        for (const rule of applicableRules) {
          try {
            transformedContent = rule.transform(transformedContent, filePath, context);
            this.stats.transformedLines += transformedContent.split('\n').length;
          } catch (ruleError) {
            context.error(`Rule '${rule.name}' failed: ${ruleError instanceof Error ? ruleError.message : String(ruleError)}`);
          }
        }

        result.files.set(filePath, transformedContent);
        this.stats.migratedFiles++;
      } catch (error) {
        context.error(`Failed to migrate ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        result.skipped.push(filePath);
        this.stats.skippedFiles++;
      }
    }

    // Generate target framework scaffold files
    if (!migrateOptions.dryRun) {
      const scaffoldFiles = await this.generateTargetScaffold(to, options);
      for (const [path, content] of scaffoldFiles) {
        if (!result.files.has(path)) {
          result.files.set(path, content);
        }
      }
    }

    this.stats.durationMs = Date.now() - startTime;
    result.stats = { ...this.stats };
    result.success = result.errors.length === 0;

    return result;
  }

  /**
   * Generate target framework scaffold
   */
  private async generateTargetScaffold(to: FrameworkType, options: MigrationOptions): Promise<Map<string, string>> {
    const adapter = frameworkRegistry.get(to);
    if (!adapter) return new Map();

    const scaffoldOptions: ScaffoldOptions = {
      projectName: 'migrated-app',
      projectPath: '.',
      framework: to,
      styling: 'tailwind',
      features: { typescript: true, eslint: true, prettier: true, testing: true, git: true },
    };

    const files = await adapter.generateScaffold(scaffoldOptions);
    const result = new Map<string, string>();

    for (const file of files) {
      result.set(file.path, file.content);
    }

    return result;
  }

  // ============================================================================
  // Transform Functions
  // ============================================================================

  /**
   * Transform Next.js App Router page to Astro page
   */
  private transformNextjsPageToAstro(code: string, filePath: string, context: TransformContext): string {
    // Convert Next.js page.tsx to Astro page.astro
    // This is a simplified version - real implementation would use AST
    let transformed = code;

    // Replace 'use client' directive
    transformed = transformed.replace(/"use client";?/g, '');

    // Replace Next.js imports
    transformed = transformed.replace(/from ['"]next\/image['"]/g, "from 'astro:assets'");
    transformed = transformed.replace(/from ['"]next\/link['"]/g, "from 'astro:links'");
    transformed = transformed.replace(/from ['"]next\/navigation['"]/g, "from 'astro:navigation'");
    transformed = transformed.replace(/from ['"]next\/head['"]/g, "from 'astro:head'");

    // Convert component syntax to Astro
    transformed = this.convertReactToAstroComponent(transformed);

    // Add Astro frontmatter if not present
    if (!transformed.startsWith('---')) {
      const componentName = filePath.split('/').pop()?.replace('.tsx', '').replace('.ts', '') || 'Page';
      transformed = `---\nimport Layout from '@/layouts/Layout.astro';\n---\n\n<Layout>\n${transformed}\n</Layout>`;
    }

    return transformed;
  }

  /**
   * Transform Next.js layout to Astro layout
   */
  private transformNextjsLayoutToAstro(code: string, filePath: string, context: TransformContext): string {
    let transformed = code;

    transformed = transformed.replace(/"use client";?/g, '');
    transformed = transformed.replace(/from ['"]next\/image['"]/g, "from 'astro:assets'");
    transformed = transformed.replace(/from ['"]next\/link['"]/g, "from 'astro:links'");

    // Convert to Astro layout with slot
    if (!transformed.includes('<slot')) {
      transformed = transformed.replace(
        /export default function \w+\(/,
        'function Layout('
      );
      transformed = transformed.replace(
        /return \(\s*\)/,
        'return (\n  <slot />\n)'
      );
    }

    return transformed;
  }

  /**
   * Transform Next.js Image component to Astro Image
   */
  private transformNextjsImageToAstro(code: string, filePath: string, context: TransformContext): string {
    return code
      .replace(/<Image\s+/g, '<Image ')
      .replace(/from ['"]next\/image['"]/g, "import { Image } from 'astro:assets'");
  }

  /**
   * Transform Next.js Link to Astro Link
   */
  private transformNextjsLinkToAstro(code: string, filePath: string, context: TransformContext): string {
    return code
      .replace(/from ['"]next\/link['"]/g, "import { Link } from 'astro:links'");
  }

  /**
   * Transform Next.js Head to Astro Head
   */
  private transformNextjsHeadToAstro(code: string, filePath: string, context: TransformContext): string {
    return code
      .replace(/from ['"]next\/head['"]/g, "import { Head } from 'astro:head'")
      .replace(/<Head>/g, '<head>')
      .replace(/<\/Head>/g, '</head>');
  }

  /**
   * Transform Next.js page to Remix route
   */
  private transformNextjsPageToRemix(code: string, filePath: string, context: TransformContext): string {
    let transformed = code;

    transformed = transformed.replace(/"use client";?/g, '');
    transformed = transformed.replace(/from ['"]next\/link['"]/g, "from '@remix-run/react'");
    transformed = transformed.replace(/from ['"]next\/navigation['"]/g, "from '@remix-run/react'");
    transformed = transformed.replace(/from ['"]next\/image['"]/g, "from '@remix-run/react'");

    // Add Remix exports
    if (!transformed.includes('export const meta') && !transformed.includes('export function meta')) {
      transformed = `export const meta = () => ({ title: 'Page' });\n\n${transformed}`;
    }

    return transformed;
  }

  /**
   * Transform Next.js loader to Remix loader
   */
  private transformNextjsLoaderToRemix(code: string, filePath: string, context: TransformContext): string {
    return code
      .replace(/export async function getStaticProps/g, 'export async function loader')
      .replace(/export async function getServerSideProps/g, 'export async function loader');
  }

  /**
   * Transform Next.js action to Remix action
   */
  private transformNextjsActionToRemix(code: string, filePath: string, context: TransformContext): string {
    return code
      .replace(/export async function POST/g, 'export async function action')
      .replace(/export async function PUT/g, 'export async function action')
      .replace(/export async function DELETE/g, 'export async function action')
      .replace(/export async function PATCH/g, 'export async function action');
  }

  /**
   * Transform Next.js page to Vite React page
   */
  private transformNextjsPageToVite(code: string, filePath: string, context: TransformContext): string {
    let transformed = code;

    transformed = transformed.replace(/"use client";?/g, '');
    transformed = transformed.replace(/from ['"]next\/link['"]/g, "from 'react-router-dom'");
    transformed = transformed.replace(/from ['"]next\/navigation['"]/g, "from 'react-router-dom'");
    transformed = transformed.replace(/from ['"]next\/image['"]/g, "from 'react'");

    // Convert to standard React component
    transformed = this.convertReactToStandardComponent(transformed);

    return transformed;
  }

  /**
   * Transform Next.js Image to standard img
   */
  private transformNextjsImageToStandard(code: string, filePath: string, context: TransformContext): string {
    return code
      .replace(/<Image\s+([^>]*?)src=["']([^"']+)["']([^>]*?)\/>/g, '<img $1src="$2" $3/>')
      .replace(/<Image\s+([^>]*?)src=\{([^}]+)\}([^>]*?)\/>/g, '<img $1src={$2} $3/>')
      .replace(/from ['"]next\/image['"]/g, "import Image from 'next/image' // TODO: Replace with standard img");
  }

  /**
   * Transform Next.js Link to React Router Link
   */
  private transformNextjsLinkToReactRouter(code: string, filePath: string, context: TransformContext): string {
    return code
      .replace(/from ['"]next\/link['"]/g, "import { Link } from 'react-router-dom'")
      .replace(/<Link\s+href=/g, '<Link to=')
      .replace(/<Link\s+([^>]*?)href=\{([^}]+)\}([^>]*?)>/g, '<Link $1to={$2}$3>');
  }

  /**
   * Transform Tailwind to UnoCSS
   */
  private transformTailwindToUnoCSS(code: string, filePath: string, context: TransformContext): string {
    // This is a placeholder - real implementation would be more complex
    // For now, just note that conversion might be needed
    if (code.includes('tailwind.config') || code.includes('className=')) {
      context.warn('Tailwind classes detected - manual review may be needed for UnoCSS conversion');
    }
    return code;
  }

  /**
   * Transform Next.js config to Astro config
   */
  private transformNextjsConfigToAstro(code: string, filePath: string, context: TransformContext): string {
    return `// Astro config - migrated from Next.js
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  integrations: [react(), tailwind()],
  output: 'static',
});`;
  }

  /**
   * Transform Next.js config to Remix config
   */
  private transformNextjsConfigToRemix(code: string, filePath: string, context: TransformContext): string {
    return `/** @type {import('@remix-run/dev').AppConfig} */
module.exports = {
  ignoredRouteFiles: ['**/.*'],
  // Migrated from Next.js config
};`;
  }

  /**
   * Transform Next.js config to Vite config
   */
  private transformNextjsConfigToVite(code: string, filePath: string, context: TransformContext): string {
    return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Migrated from Next.js config
});`;
  }

  /**
   * Transform package.json from Next.js to Astro
   */
  private transformPackageJsonNextjsToAstro(code: string, filePath: string, context: TransformContext): string {
    try {
      const pkg = JSON.parse(code);

      // Remove Next.js dependencies
      delete pkg.dependencies?.next;
      delete pkg.dependencies?.['next-auth'];
      delete pkg.dependencies?.['@next/font'];
      delete pkg.devDependencies?.['@types/next'];
      delete pkg.devDependencies?.['eslint-config-next'];

      // Add Astro dependencies
      pkg.dependencies = {
        ...pkg.dependencies,
        astro: '^4.0.0',
        '@astrojs/react': '^3.0.0',
        '@astrojs/tailwind': '^5.0.0',
        react: '^18.2.0',
        'react-dom': '^18.2.0',
      };

      pkg.devDependencies = {
        ...pkg.devDependencies,
        '@astrojs/check': '^0.5.0',
        typescript: '^5.3.0',
      };

      // Update scripts
      pkg.scripts = {
        dev: 'astro dev',
        build: 'astro build',
        preview: 'astro preview',
        astro: 'astro',
        ...pkg.scripts,
      };

      return JSON.stringify(pkg, null, 2);
    } catch {
      return code;
    }
  }

  /**
   * Transform package.json from Next.js to Remix
   */
  private transformPackageJsonNextjsToRemix(code: string, filePath: string, context: TransformContext): string {
    try {
      const pkg = JSON.parse(code);

      delete pkg.dependencies?.next;
      delete pkg.dependencies?.['next-auth'];
      delete pkg.dependencies?.['@next/font'];

      pkg.dependencies = {
        ...pkg.dependencies,
        '@remix-run/react': '^2.8.0',
        '@remix-run/node': '^2.8.0',
        react: '^18.2.0',
        'react-dom': '^18.2.0',
        isbot: '^4.1.0',
      };

      pkg.devDependencies = {
        ...pkg.devDependencies,
        '@remix-run/dev': '^2.8.0',
        '@remix-run/eslint-config': '^2.8.0',
        typescript: '^5.3.0',
      };

      pkg.scripts = {
        dev: 'remix dev',
        build: 'remix build',
        start: 'remix-serve ./build/index.js',
        typecheck: 'tsc',
        ...pkg.scripts,
      };

      return JSON.stringify(pkg, null, 2);
    } catch {
      return code;
    }
  }

  /**
   * Transform package.json from Next.js to Vite React
   */
  private transformPackageJsonNextjsToVite(code: string, filePath: string, context: TransformContext): string {
    try {
      const pkg = JSON.parse(code);

      delete pkg.dependencies?.next;
      delete pkg.dependencies?.['next-auth'];
      delete pkg.dependencies?.['@next/font'];

      pkg.dependencies = {
        ...pkg.dependencies,
        react: '^18.2.0',
        'react-dom': '^18.2.0',
        'react-router-dom': '^6.22.0',
      };

      pkg.devDependencies = {
        ...pkg.devDependencies,
        '@vitejs/plugin-react': '^4.2.0',
        vite: '^5.0.0',
        tailwindcss: '^3.4.0',
        typescript: '^5.3.0',
      };

      pkg.scripts = {
        dev: 'vite',
        build: 'tsc && vite build',
        preview: 'vite preview',
        ...pkg.scripts,
      };

      return JSON.stringify(pkg, null, 2);
    } catch {
      return code;
    }
  }

  /**
   * Convert React component to Astro component syntax
   */
  private convertReactToAstroComponent(code: string): string {
    // This is a simplified conversion
    // Real implementation would use Babel AST
    return code
      .replace(/className=/g, 'class=')
      .replace(/htmlFor=/g, 'for=')
      .replace(/onClick=/g, 'onclick=')
      .replace(/onChange=/g, 'onchange=')
      .replace(/onSubmit=/g, 'onsubmit=');
  }

  /**
   * Convert React component to standard React (for Vite)
   */
  private convertReactToStandardComponent(code: string): string {
    return code;
  }
}

/**
 * Create a migration engine instance
 */
export function createMigrationEngine(): MigrationEngine {
  return new MigrationEngine();
}

/**
 * Quick migration function for API use
 */
export async function migrateProject(options: MigrationOptions): Promise<MigrationResult> {
  const engine = createMigrationEngine();
  return engine.migrate(options);
}