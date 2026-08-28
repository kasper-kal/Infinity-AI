/**
 * Multi-Framework Support — Framework Adapters
 *
 * Each framework adapter provides:
 * - Project scaffold generation
 * - Component syntax (JSX/TSX, .svelte, .vue, .tsx for Solid)
 * - Routing conventions
 * - Styling integration
 * - Deployment configuration
 */

import { z } from 'zod';

// ============================================================================
// Types & Schemas
// ============================================================================

export const FrameworkTypeSchema = z.enum([
  'nextjs',
  'astro',
  'remix',
  'vite-react',
  'sveltekit',
  'vue-nuxt',
  'solidstart',
]);

export type FrameworkType = z.infer<typeof FrameworkTypeSchema>;

export const FrameworkConfigSchema = z.object({
  type: FrameworkTypeSchema,
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  // Scaffold
  packageJson: z.record(z.any()),
  configFiles: z.record(z.string()), // filename -> content
  folderStructure: z.array(z.string()),
  // Component
  componentExtension: z.string(),
  componentSyntax: z.enum(['jsx', 'tsx', 'svelte', 'vue']),
  // Routing
  routingType: z.enum(['file-based', 'config-based', 'hybrid']),
  routesDir: z.string(),
  // Styling
  supportedStyling: z.array(z.enum(['tailwind', 'unocss', 'css-modules', 'styled-components', 'vanilla-extract', 'native'])),
  defaultStyling: z.string(),
  // Deployment
  deploymentTargets: z.array(z.enum(['vercel', 'netlify', 'cloudflare', 'docker', 'static', 'node'])),
  defaultDeployment: z.string(),
  // Dev server
  devCommand: z.string(),
  buildCommand: z.string(),
  previewCommand: z.string(),
  // Features
  features: z.object({
    ssr: z.boolean(),
    ssg: z.boolean(),
    islands: z.boolean(),
    edge: z.boolean(),
    middleware: z.boolean(),
    apiRoutes: z.boolean(),
  }),
});

export type FrameworkConfig = z.infer<typeof FrameworkConfigSchema>;

export interface ScaffoldOptions {
  projectName: string;
  projectPath: string;
  framework: FrameworkType;
  styling: string;
  features: {
    typescript: boolean;
    eslint: boolean;
    prettier: boolean;
    testing: boolean;
    git: boolean;
  };
  designSystem?: {
    colors: Record<string, string>;
    spacing: Record<string, string>;
    typography: Record<string, string>;
    borderRadius: Record<string, string>;
    shadows: Record<string, string>;
  };
}

export interface ComponentIR {
  name: string;
  type: 'component' | 'page' | 'layout' | 'hook' | 'util';
  imports: ImportStatement[];
  props: PropDefinition[];
  jsx: string; // JSX representation (source of truth)
  styles?: string;
  metadata?: Record<string, any>;
}

export interface ImportStatement {
  from: string;
  named: string[];
  default?: string;
  type?: 'value' | 'type';
}

export interface PropDefinition {
  name: string;
  type: string;
  required: boolean;
  default?: string;
  description?: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
  language: string;
}

export interface DeploymentConfig {
  target: string;
  config: Record<string, any>;
  commands: {
    build: string;
    dev: string;
    preview: string;
  };
  envVars: string[];
}

// ============================================================================
// Framework Adapter Interface
// ============================================================================

export interface FrameworkAdapter {
  readonly config: FrameworkConfig;

  // Scaffold generation
  generateScaffold(options: ScaffoldOptions): Promise<GeneratedFile[]>;
  generatePackageJson(options: ScaffoldOptions): Record<string, any>;
  generateConfigFiles(options: ScaffoldOptions): Record<string, string>;
  generateFolderStructure(options: ScaffoldOptions): string[];

  // Component generation
  generateComponent(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile;
  generatePage(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile;
  generateLayout(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile;
  generateHook(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile;

  // Routing
  generateRoutes(irs: ComponentIR[], options: ScaffoldOptions): GeneratedFile[];
  generateRouterConfig(options: ScaffoldOptions): GeneratedFile | null;

  // Styling
  generateTailwindConfig(options: ScaffoldOptions): GeneratedFile | null;
  generateGlobalStyles(options: ScaffoldOptions): GeneratedFile | null;
  generateCSSVariables(options: ScaffoldOptions): GeneratedFile | null;

  // Deployment
  generateDeploymentConfig(target: string, options: ScaffoldOptions): DeploymentConfig;

  // Utilities
  getComponentExtension(): string;
  getImportPath(ir: ComponentIR, fromFile: string): string;
  transformJSXToFramework(jsx: string, options: ScaffoldOptions): string;
}

// ============================================================================
// Base Adapter Class
// ============================================================================

export abstract class BaseFrameworkAdapter implements FrameworkAdapter {
  abstract readonly config: FrameworkConfig;

  abstract generateScaffold(options: ScaffoldOptions): Promise<GeneratedFile[]>;
  abstract generateComponent(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile;
  abstract generatePage(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile;
  abstract generateLayout(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile;
  abstract generateHook(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile;
  abstract generateRoutes(irs: ComponentIR[], options: ScaffoldOptions): GeneratedFile[];
  abstract getComponentExtension(): string;

  generatePackageJson(options: ScaffoldOptions): Record<string, any> {
    const base = {
      name: options.projectName,
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: {
        dev: this.config.devCommand,
        build: this.config.buildCommand,
        preview: this.config.previewCommand,
        lint: 'eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0',
        format: 'prettier --write .',
        test: 'vitest',
      },
      dependencies: {
        react: '^18.2.0',
        'react-dom': '^18.2.0',
      },
      devDependencies: {
        '@types/react': '^18.2.0',
        '@types/react-dom': '^18.2.0',
        typescript: '^5.3.0',
        vite: '^5.0.0',
        eslint: '^8.56.0',
        prettier: '^3.2.0',
        vitest: '^1.2.0',
      },
    };

    // Add framework-specific dependencies
    return this.augmentPackageJson(base, options);
  }

  protected abstract augmentPackageJson(base: Record<string, any>, options: ScaffoldOptions): Record<string, any>;

  generateConfigFiles(options: ScaffoldOptions): Record<string, string> {
    const files: Record<string, string> = {};

    // TypeScript config
    files['tsconfig.json'] = this.generateTSConfig(options);

    // ESLint config
    files['eslint.config.js'] = this.generateESLintConfig(options);

    // Prettier config
    files['prettier.config.js'] = this.generatePrettierConfig(options);

    // Git ignore
    files['.gitignore'] = this.generateGitIgnore(options);

    // Framework-specific configs
    const frameworkConfigs = this.generateFrameworkConfigs(options);
    Object.assign(files, frameworkConfigs);

    return files;
  }

  protected generateTSConfig(options: ScaffoldOptions): string {
    return JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        useDefineForClassFields: true,
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        skipLibCheck: true,
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: 'react-jsx',
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noFallthroughCasesInSwitch: true,
        baseUrl: '.',
        paths: {
          '@/*': ['./src/*'],
        },
      },
      include: ['src'],
      references: [{ path: './tsconfig.node.json' }],
    }, null, 2);
  }

  protected generateESLintConfig(options: ScaffoldOptions): string {
    return `export default [
  { ignores: ['dist', 'node_modules', '.env*'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { browser: true, es2020: true },
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    settings: { react: { version: '18.2' } },
    plugins: { react: require('eslint-plugin-react'), 'react-hooks': require('eslint-plugin-react-hooks') },
    rules: {
      ...require('eslint-plugin-react').configs.recommended.rules,
      ...require('eslint-plugin-react-hooks').configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
];`;
  }

  protected generatePrettierConfig(options: ScaffoldOptions): string {
    return `export default {
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'es5',
  printWidth: 100,
  bracketSpacing: true,
  arrowParens: 'avoid',
  plugins: [require('prettier-plugin-tailwindcss')],
};`;
  }

  protected generateGitIgnore(options: ScaffoldOptions): string {
    return `# Dependencies
node_modules
.pnp
.pnp.js

# Build
dist
build
.next
.astro
.output
.svelte-kit

# Environment
.env
.env.local
.env.*.local

# IDE
.vscode
.idea
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Testing
coverage
.nyc_output

# Misc
*.tsbuildinfo
`;
  }

  protected abstract generateFrameworkConfigs(options: ScaffoldOptions): Record<string, string>;

  generateFolderStructure(options: ScaffoldOptions): string[] {
    const base = [
      'src/',
      'src/components/',
      'src/components/ui/',
      'src/lib/',
      'src/hooks/',
      'src/types/',
      'public/',
    ];
    return [...base, ...this.getFrameworkSpecificFolders(options)];
  }

  protected abstract getFrameworkSpecificFolders(options: ScaffoldOptions): string[];

  generateRouterConfig(options: ScaffoldOptions): GeneratedFile | null {
    return null;
  }

  generateTailwindConfig(options: ScaffoldOptions): GeneratedFile | null {
    if (!options.designSystem) return null;

    const { colors, spacing, typography, borderRadius, shadows } = options.designSystem;

    const content = `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx,svelte,vue}',
  ],
  theme: {
    extend: {
      colors: ${JSON.stringify(colors, null, 2)},
      spacing: ${JSON.stringify(spacing, null, 2)},
      fontFamily: ${JSON.stringify(typography, null, 2)},
      borderRadius: ${JSON.stringify(borderRadius, null, 2)},
      boxShadow: ${JSON.stringify(shadows, null, 2)},
    },
  },
  plugins: [],
};`;

    return {
      path: 'tailwind.config.js',
      content,
      language: 'javascript',
    };
  }

  generateGlobalStyles(options: ScaffoldOptions): GeneratedFile | null {
    if (!options.designSystem) return null;

    const { colors } = options.designSystem;

    const cssVars = Object.entries(colors)
      .map(([key, value]) => `  --${key}: ${value};`)
      .join('\n');

    const content = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
${cssVars}
  }

  .dark {
    /* Dark mode overrides */
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}`;

    return {
      path: 'src/index.css',
      content,
      language: 'css',
    };
  }

  generateCSSVariables(options: ScaffoldOptions): GeneratedFile | null {
    if (!options.designSystem) return null;

    const { colors, spacing, typography, borderRadius, shadows } = options.designSystem;

    const allVars = {
      ...Object.fromEntries(Object.entries(colors).map(([k, v]) => [`color-${k}`, v])),
      ...Object.fromEntries(Object.entries(spacing).map(([k, v]) => [`spacing-${k}`, v])),
      ...Object.fromEntries(Object.entries(borderRadius).map(([k, v]) => [`radius-${k}`, v])),
      ...Object.fromEntries(Object.entries(shadows).map(([k, v]) => [`shadow-${k}`, v])),
    };

    const cssVars = Object.entries(allVars)
      .map(([key, value]) => `  --${key}: ${value};`)
      .join('\n');

    const content = `:root {
${cssVars}
}`;

    return {
      path: 'src/styles/variables.css',
      content,
      language: 'css',
    };
  }

  generateDeploymentConfig(target: string, options: ScaffoldOptions): DeploymentConfig {
    const configs: Record<string, DeploymentConfig> = {
      vercel: {
        target: 'vercel',
        config: { framework: this.config.type },
        commands: {
          build: this.config.buildCommand,
          dev: this.config.devCommand,
          preview: this.config.previewCommand,
        },
        envVars: ['NODE_ENV=production'],
      },
      netlify: {
        target: 'netlify',
        config: { build: { command: this.config.buildCommand, publish: 'dist' } },
        commands: {
          build: this.config.buildCommand,
          dev: this.config.devCommand,
          preview: this.config.previewCommand,
        },
        envVars: ['NODE_ENV=production'],
      },
      cloudflare: {
        target: 'cloudflare',
        config: { build: { command: this.config.buildCommand, outputDir: 'dist' } },
        commands: {
          build: this.config.buildCommand,
          dev: this.config.devCommand,
          preview: this.config.previewCommand,
        },
        envVars: ['NODE_ENV=production'],
      },
      docker: {
        target: 'docker',
        config: {},
        commands: {
          build: 'docker build -t app .',
          dev: 'docker run -p 3000:3000 app',
          preview: 'docker run -p 3000:3000 app',
        },
        envVars: ['NODE_ENV=production'],
      },
      static: {
        target: 'static',
        config: { outputDir: 'dist' },
        commands: {
          build: this.config.buildCommand,
          dev: this.config.devCommand,
          preview: 'npx serve dist',
        },
        envVars: [],
      },
      node: {
        target: 'node',
        config: { entryPoint: 'dist/index.js' },
        commands: {
          build: this.config.buildCommand,
          dev: this.config.devCommand,
          preview: 'node dist/index.js',
        },
        envVars: ['NODE_ENV=production'],
      },
    };

    return configs[target] || configs.vercel;
  }

  getImportPath(ir: ComponentIR, fromFile: string): string {
    // Default: relative import from src/components
    const fromDir = fromFile.split('/').slice(0, -1).join('/');
    const toPath = `src/components/${ir.name}`;
    const relative = this.getRelativePath(fromDir, toPath);
    return relative;
  }

  protected getRelativePath(from: string, to: string): string {
    const fromParts = from.split('/').filter(Boolean);
    const toParts = to.split('/').filter(Boolean);

    let i = 0;
    while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
      i++;
    }

    const up = '../'.repeat(fromParts.length - i);
    const down = toParts.slice(i).join('/');

    return up + down;
  }

  transformJSXToFramework(jsx: string, options: ScaffoldOptions): string {
    // Default: return as-is for React-based frameworks
    return jsx;
  }
}

// ============================================================================
// Framework Registry
// ============================================================================

export class FrameworkRegistry {
  private adapters = new Map<FrameworkType, FrameworkAdapter>();

  register(adapter: FrameworkAdapter): void {
    this.adapters.set(adapter.config.type, adapter);
  }

  get(type: FrameworkType): FrameworkAdapter | undefined {
    return this.adapters.get(type);
  }

  getAll(): FrameworkAdapter[] {
    return Array.from(this.adapters.values());
  }

  getSupportedFrameworks(): FrameworkType[] {
    return Array.from(this.adapters.keys());
  }

  has(type: FrameworkType): boolean {
    return this.adapters.has(type);
  }
}

export const frameworkRegistry = new FrameworkRegistry();

// ============================================================================
// Framework Detection
// ============================================================================

export interface DetectionResult {
  framework: FrameworkType | null;
  confidence: number;
  evidence: string[];
}

export interface ProjectFileMap {
  files: Map<string, string>;
  packageJson?: Record<string, any>;
  configFiles: Map<string, string>;
}

/**
 * Detect framework from project files
 * Checks package.json dependencies, config files, and folder structure
 */
export function detectFramework(fileMap: ProjectFileMap): DetectionResult {
  const evidence: string[] = [];
  const scores: Record<FrameworkType, number> = {
    nextjs: 0,
    astro: 0,
    remix: 0,
    'vite-react': 0,
    sveltekit: 0,
    'vue-nuxt': 0,
    solidstart: 0,
  };

  const { files, packageJson, configFiles } = fileMap;

  // Check package.json dependencies
  if (packageJson) {
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    // Next.js detection
    if (deps.next) {
      scores.nextjs += 10;
      evidence.push('next dependency found in package.json');
      if (deps['@next/font']) { scores.nextjs += 2; evidence.push('@next/font found'); }
      if (deps['next-auth'] || deps['next-auth@beta']) { scores.nextjs += 2; evidence.push('next-auth found'); }
    }

    // Astro detection
    if (deps.astro) {
      scores.astro += 10;
      evidence.push('astro dependency found in package.json');
      if (deps['@astrojs/react']) { scores.astro += 1; evidence.push('@astrojs/react integration'); }
      if (deps['@astrojs/svelte']) { scores.astro += 1; evidence.push('@astrojs/svelte integration'); }
      if (deps['@astrojs/vue']) { scores.astro += 1; evidence.push('@astrojs/vue integration'); }
    }

    // Remix detection
    if (deps['@remix-run/node'] || deps['@remix-run/react'] || deps['@remix-run/dev']) {
      scores.remix += 10;
      evidence.push('Remix dependencies found (@remix-run/*)');
    }

    // Vite + React detection
    if (deps.vite && deps.react && deps['react-dom'] && !deps.next && !deps.astro && !deps['@remix-run/react']) {
      scores['vite-react'] += 8;
      evidence.push('vite + react + react-dom (no Next.js/Astro/Remix)');
      if (deps['@vitejs/plugin-react']) { scores['vite-react'] += 2; evidence.push('@vitejs/plugin-react found'); }
    }

    // SvelteKit detection
    if (deps['@sveltejs/kit'] || deps['@sveltejs/vite-plugin-svelte']) {
      scores.sveltekit += 10;
      evidence.push('SvelteKit dependencies found (@sveltejs/kit or @sveltejs/vite-plugin-svelte)');
    }
    if (deps.svelte && deps.vite && !deps['@sveltejs/kit']) {
      scores.sveltekit += 3;
      evidence.push('svelte + vite (possible SvelteKit)');
    }

    // Nuxt/Vue detection
    if (deps.nuxt) {
      scores['vue-nuxt'] += 10;
      evidence.push('nuxt dependency found in package.json');
    }
    if (deps.vue && deps.vite && !deps.nuxt) {
      scores['vue-nuxt'] += 3;
      evidence.push('vue + vite (possible Nuxt)');
    }

    // SolidStart detection
    if (deps['@solidjs/start'] || deps['solid-start']) {
      scores.solidstart += 10;
      evidence.push('SolidStart dependencies found (@solidjs/start)');
    }
    if (deps['solid-js'] && deps.vite && !deps['@solidjs/start']) {
      scores.solidstart += 3;
      evidence.push('solid-js + vite (possible SolidStart)');
    }
  }

  // Check config files
  for (const [filename, content] of configFiles) {
    // Next.js config
    if (filename === 'next.config.js' || filename === 'next.config.mjs' || filename === 'next.config.ts') {
      scores.nextjs += 5;
      evidence.push(`${filename} found`);
    }

    // Astro config
    if (filename === 'astro.config.mjs' || filename === 'astro.config.ts' || filename === 'astro.config.js') {
      scores.astro += 5;
      evidence.push(`${filename} found`);
    }

    // Remix config
    if (filename === 'remix.config.js' || filename === 'remix.config.ts') {
      scores.remix += 5;
      evidence.push(`${filename} found`);
    }

    // Vite config (could be any Vite-based framework)
    if (filename === 'vite.config.ts' || filename === 'vite.config.js' || filename === 'vite.config.mjs') {
      // Check content for framework-specific plugins
      if (content.includes('@vitejs/plugin-react')) {
        scores['vite-react'] += 3;
        evidence.push('vite.config has @vitejs/plugin-react');
      }
      if (content.includes('@sveltejs/vite-plugin-svelte')) {
        scores.sveltekit += 3;
        evidence.push('vite.config has @sveltejs/vite-plugin-svelte');
      }
      if (content.includes('@vitejs/plugin-vue')) {
        scores['vue-nuxt'] += 3;
        evidence.push('vite.config has @vitejs/plugin-vue');
      }
      if (content.includes('solid-plugin') || content.includes('vite-plugin-solid')) {
        scores.solidstart += 3;
        evidence.push('vite.config has solid plugin');
      }
    }

    // Svelte config
    if (filename === 'svelte.config.js' || filename === 'svelte.config.ts') {
      scores.sveltekit += 3;
      evidence.push(`${filename} found`);
    }

    // Nuxt config
    if (filename === 'nuxt.config.ts' || filename === 'nuxt.config.js' || filename === 'nuxt.config.mjs') {
      scores['vue-nuxt'] += 5;
      evidence.push(`${filename} found`);
    }

    // Solid config
    if (filename === 'solid.config.ts' || filename === 'solid.config.js') {
      scores.solidstart += 3;
      evidence.push(`${filename} found`);
    }

    // Tailwind config (common but not framework-specific)
    if (filename === 'tailwind.config.js' || filename === 'tailwind.config.ts') {
      evidence.push('tailwind.config found');
    }

    // TypeScript config
    if (filename === 'tsconfig.json') {
      // Check for framework-specific compiler options
      if (content.includes('"jsx": "react-jsx"') || content.includes('"jsx": "preserve"')) {
        evidence.push('tsconfig has JSX config');
      }
    }
  }

  // Check folder structure patterns
  const filePaths = Array.from(files.keys());

  // Next.js App Router patterns
  if (filePaths.some(p => p.startsWith('app/') && (p.endsWith('/page.tsx') || p.endsWith('/page.ts') || p.endsWith('/page.jsx') || p.endsWith('/page.js')))) {
    scores.nextjs += 5;
    evidence.push('App Router page.tsx files found');
  }
  if (filePaths.some(p => p.startsWith('app/') && p.includes('/layout.'))) {
    scores.nextjs += 3;
    evidence.push('App Router layout files found');
  }

  // Next.js Pages Router patterns
  if (filePaths.some(p => p.startsWith('pages/') && (p.endsWith('.tsx') || p.endsWith('.ts') || p.endsWith('.jsx') || p.endsWith('.js')))) {
    scores.nextjs += 3;
    evidence.push('Pages Router files found');
  }

  // Astro patterns
  if (filePaths.some(p => p.startsWith('src/pages/') && p.endsWith('.astro'))) {
    scores.astro += 5;
    evidence.push('Astro .astro page files found');
  }
  if (filePaths.some(p => p.startsWith('src/components/') && p.endsWith('.astro'))) {
    scores.astro += 2;
    evidence.push('Astro .astro component files found');
  }

  // Remix patterns
  if (filePaths.some(p => p.startsWith('app/routes/') || p.startsWith('app/routes.'))) {
    scores.remix += 5;
    evidence.push('Remix routes folder found');
  }
  if (filePaths.some(p => p.includes('/route.') && (p.endsWith('.tsx') || p.endsWith('.ts')))) {
    scores.remix += 3;
    evidence.push('Remix route files found');
  }

  // SvelteKit patterns
  if (filePaths.some(p => p.startsWith('src/routes/') && p.endsWith('+page.svelte'))) {
    scores.sveltekit += 5;
    evidence.push('SvelteKit +page.svelte files found');
  }
  if (filePaths.some(p => p.startsWith('src/routes/') && p.endsWith('+layout.svelte'))) {
    scores.sveltekit += 3;
    evidence.push('SvelteKit +layout.svelte files found');
  }
  if (filePaths.some(p => p.startsWith('src/routes/') && p.endsWith('+server.ts'))) {
    scores.sveltekit += 2;
    evidence.push('SvelteKit +server.ts endpoints found');
  }

  // Nuxt patterns
  if (filePaths.some(p => p.startsWith('pages/') && (p.endsWith('.vue') || p.endsWith('.ts') || p.endsWith('.js')))) {
    scores['vue-nuxt'] += 5;
    evidence.push('Nuxt pages/ directory with .vue files found');
  }
  if (filePaths.some(p => p.startsWith('components/') && p.endsWith('.vue'))) {
    scores['vue-nuxt'] += 2;
    evidence.push('Nuxt components/ directory with .vue files found');
  }
  if (filePaths.some(p => p.startsWith('composables/') && (p.endsWith('.ts') || p.endsWith('.js')))) {
    scores['vue-nuxt'] += 2;
    evidence.push('Nuxt composables/ directory found');
  }

  // SolidStart patterns
  if (filePaths.some(p => p.startsWith('src/routes/') && (p.endsWith('.tsx') || p.endsWith('.ts') || p.endsWith('.jsx') || p.endsWith('.js')))) {
    scores.solidstart += 3;
    evidence.push('SolidStart-style routes found');
  }
  if (filePaths.some(p => p.includes('solid') && p.endsWith('.tsx'))) {
    scores.solidstart += 2;
    evidence.push('Solid JSX files found');
  }

  // Vite + React (SPA) patterns
  if (filePaths.some(p => p === 'index.html' && files.get(p)?.includes('vite'))) {
    scores['vite-react'] += 2;
    evidence.push('index.html references Vite');
  }
  if (filePaths.some(p => p.startsWith('src/') && (p.endsWith('.tsx') || p.endsWith('.jsx')) && !p.includes('/routes/') && !p.includes('/pages/'))) {
    scores['vite-react'] += 1;
    evidence.push('React components in src/ (no file-based routing)');
  }

  // Find highest scoring framework
  let detected: FrameworkType | null = null;
  let maxScore = 0;

  for (const [framework, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      detected = framework as FrameworkType;
    }
  }

  const confidence = maxScore > 0 ? Math.min(maxScore / 15, 1) : 0;

  return {
    framework: detected,
    confidence,
    evidence,
  };
}

/**
 * Detect framework from a simple file array (for API use)
 */
export function detectFrameworkFromFiles(files: Array<{ path: string; content: string }>): DetectionResult {
  const fileMap = new Map<string, string>();
  let packageJson: Record<string, any> | undefined;
  const configFiles = new Map<string, string>();

  for (const file of files) {
    fileMap.set(file.path, file.content);

    if (file.path === 'package.json') {
      try {
        packageJson = JSON.parse(file.content);
      } catch {
        // Ignore parse errors
      }
    }

    // Config files
    if (
      file.path === 'next.config.js' ||
      file.path === 'next.config.mjs' ||
      file.path === 'next.config.ts' ||
      file.path === 'astro.config.mjs' ||
      file.path === 'astro.config.ts' ||
      file.path === 'astro.config.js' ||
      file.path === 'remix.config.js' ||
      file.path === 'remix.config.ts' ||
      file.path === 'vite.config.ts' ||
      file.path === 'vite.config.js' ||
      file.path === 'vite.config.mjs' ||
      file.path === 'svelte.config.js' ||
      file.path === 'svelte.config.ts' ||
      file.path === 'nuxt.config.ts' ||
      file.path === 'nuxt.config.js' ||
      file.path === 'nuxt.config.mjs' ||
      file.path === 'solid.config.ts' ||
      file.path === 'solid.config.js' ||
      file.path === 'tailwind.config.js' ||
      file.path === 'tailwind.config.ts' ||
      file.path === 'tsconfig.json'
    ) {
      configFiles.set(file.path, file.content);
    }
  }

  return detectFramework({ files: fileMap, packageJson, configFiles });
}