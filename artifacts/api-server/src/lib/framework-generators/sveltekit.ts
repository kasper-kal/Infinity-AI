/**
 * SvelteKit Framework Adapter
 */

import type {
  FrameworkAdapter,
  FrameworkConfig,
  ScaffoldOptions,
  ComponentIR,
  GeneratedFile,
} from '../framework-adapters';
import { capitalize, getRelativePath } from './utils';

export const sveltekitConfig: FrameworkConfig = {
  type: 'sveltekit',
  name: 'sveltekit',
  displayName: 'SvelteKit',
  description: 'Full-stack Svelte framework with file-based routing and serverless support',
  packageJson: {},
  configFiles: {},
  folderStructure: [],
  componentExtension: 'svelte',
  componentSyntax: 'svelte',
  routingType: 'file-based',
  routesDir: 'src/routes',
  supportedStyling: ['tailwind', 'unocss', 'css-modules'],
  defaultStyling: 'tailwind',
  deploymentTargets: ['vercel', 'netlify', 'cloudflare', 'docker', 'static', 'node'],
  defaultDeployment: 'vercel',
  devCommand: 'vite dev',
  buildCommand: 'vite build',
  previewCommand: 'vite preview',
  features: {
    ssr: true,
    ssg: true,
    islands: false,
    edge: true,
    middleware: true,
    apiRoutes: true,
  },
};

export class SvelteKitAdapter implements FrameworkAdapter {
  readonly config = sveltekitConfig;

  async generateScaffold(options: ScaffoldOptions): Promise<GeneratedFile[]> {
    const files: GeneratedFile[] = [];

    files.push({
      path: 'package.json',
      content: JSON.stringify(this.generatePackageJson(options), null, 2),
      language: 'json',
    });

    const configFiles = this.generateConfigFiles(options);
    for (const [filename, content] of Object.entries(configFiles)) {
      files.push({ path: filename, content, language: filename.endsWith('.json') ? 'json' : 'javascript' });
    }

    const tailwindConfig = this.generateTailwindConfig(options);
    if (tailwindConfig) files.push(tailwindConfig);

    // SvelteKit config
    files.push({
      path: 'svelte.config.js',
      content: this.generateSvelteConfig(options),
      language: 'javascript',
    });

    // Types
    files.push({
      path: 'src/types/index.ts',
      content: this.generateTypes(options),
      language: 'typescript',
    });

    // Lib utils
    files.push({
      path: 'src/lib/utils.ts',
      content: this.generateUtils(options),
      language: 'typescript',
    });

    // App.html
    files.push({
      path: 'src/app.html',
      content: this.generateAppHtml(options),
      language: 'html',
    });

    // App.d.ts
    files.push({
      path: 'src/app.d.ts',
      content: this.generateAppDts(options),
      language: 'typescript',
    });

    // +layout.svelte
    files.push({
      path: 'src/routes/+layout.svelte',
      content: this.generateRootLayout(options),
      language: 'svelte',
    });

    // +page.svelte
    files.push({
      path: 'src/routes/+page.svelte',
      content: this.generateIndexPage(options),
      language: 'svelte',
    });

    // +page.ts (load function)
    files.push({
      path: 'src/routes/+page.ts',
      content: this.generatePageLoad(options),
      language: 'typescript',
    });

    // Button component
    files.push({
      path: 'src/lib/components/ui/Button.svelte',
      content: this.generateButtonComponent(options),
      language: 'svelte',
    });

    // Components.json
    files.push({
      path: 'components.json',
      content: this.generateComponentsJson(options),
      language: 'json',
    });

    // .env.example
    files.push({
      path: '.env.example',
      content: this.generateEnvExample(options),
      language: 'text',
    });

    return files;
  }

  generatePackageJson(options: ScaffoldOptions): Record<string, any> {
    return {
      name: options.projectName,
      version: '0.0.1',
      private: true,
      type: 'module',
      scripts: {
        dev: 'vite dev',
        build: 'vite build',
        preview: 'vite preview',
        check: 'svelte-kit sync && svelte-check --tsconfig ./tsconfig.json',
        'check:watch': 'svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --watch',
        lint: 'prettier --check . && eslint .',
        format: 'prettier --write .',
        test: 'vitest',
      },
      dependencies: {
        '@sveltejs/kit': '^2.5.0',
        svelte: '^4.2.0',
        'clsx': '^2.1.0',
        'tailwind-merge': '^2.2.0',
        'class-variance-authority': '^0.7.0',
        'lucide-svelte': '^0.303.0',
        'zod': '^3.22.0',
      },
      devDependencies: {
        '@sveltejs/adapter-auto': '^3.2.0',
        '@sveltejs/adapter-vercel': '^5.2.0',
        '@sveltejs/vite-plugin-svelte': '^3.0.0',
        '@types/eslint': '^8.56.0',
        'typescript': '^5.3.0',
        'eslint': '^8.56.0',
        'eslint-plugin-svelte': '^2.35.0',
        'prettier': '^3.2.0',
        'prettier-plugin-svelte': '^3.2.0',
        'prettier-plugin-tailwindcss': '^0.5.0',
        'svelte-check': '^3.6.0',
        'tslib': '^2.6.0',
        'tailwindcss': '^3.4.0',
        'postcss': '^8.4.0',
        'autoprefixer': '^10.4.0',
        'vite': '^5.0.0',
        'vitest': '^1.2.0',
        '@testing-library/svelte': '^4.1.0',
      },
    };
  }

  generateConfigFiles(options: ScaffoldOptions): Record<string, string> {
    return {
      'tsconfig.json': this.generateTSConfig(options),
      'vite.config.ts': this.generateViteConfig(options),
      'postcss.config.js': this.generatePostCSSConfig(options),
      'eslint.config.js': this.generateESLintConfig(options),
      'prettier.config.js': this.generatePrettierConfig(options),
      '.gitignore': this.generateGitIgnore(options),
    };
  }

  generateFrameworkConfigs(options: ScaffoldOptions): Record<string, string> {
    return {
      'svelte.config.js': this.generateSvelteConfig(options),
      'vite.config.ts': this.generateViteConfig(options),
    };
  }

  getFrameworkSpecificFolders(options: ScaffoldOptions): string[] {
    return [
      'src/routes/',
      'src/routes/(auth)/',
      'src/lib/components/',
      'src/lib/server/',
      'src/hooks/',
      'static/',
    ];
  }

  generateComponent(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `src/lib/components/${ir.name}.svelte`,
      content: this.transpileToSvelte(ir, options),
      language: 'svelte',
    };
  }

  generatePage(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `src/routes/${ir.name.toLowerCase()}/+page.svelte`,
      content: this.transpileToPage(ir, options),
      language: 'svelte',
    };
  }

  generateLayout(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `src/routes/${ir.name.toLowerCase()}/+layout.svelte`,
      content: this.transpileToLayout(ir, options),
      language: 'svelte',
    };
  }

  generateHook(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `src/hooks/use${capitalize(ir.name)}.ts`,
      content: this.transpileToHook(ir, options),
      language: 'typescript',
    };
  }

  generateRoutes(irs: ComponentIR[], options: ScaffoldOptions): GeneratedFile[] {
    return irs.map(ir => this.generatePage(ir, options));
  }

  getComponentExtension(): string {
    return 'svelte';
  }

  getImportPath(ir: ComponentIR, fromFile: string): string {
    const fromDir = fromFile.split('/').slice(0, -1).join('/');
    const toPath = `$lib/components/${ir.name}`;
    return this.getRelativePath(fromDir, toPath);
  }

  transformJSXToFramework(jsx: string, options: ScaffoldOptions): string {
    return jsx
      .replace(/className=/g, 'class=')
      .replace(/onClick=\{.*?\}/g, (match) => {
        const handler = match.match(/\{(.*?)\}/)?.[1] || '';
        return `on:click={${handler}}`;
      })
      .replace(/\{(\w+)\}/g, '{$1}');
  }

  // --- Generation Methods ---

  private generateSvelteConfig(options: ScaffoldOptions): string {
    return `import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    alias: {
      $lib: 'src/lib',
      $components: 'src/lib/components',
      $utils: 'src/lib/utils',
      $hooks: 'src/hooks',
    },
  },
};

export default config;`;
  }

  private generateTSConfig(options: ScaffoldOptions): string {
    return JSON.stringify({
      extends: './.svelte-kit/tsconfig.json',
      compilerOptions: {
        baseUrl: '.',
        paths: {
          $lib: ['src/lib'],
          $components: ['src/lib/components'],
          $utils: ['src/lib/utils'],
          $hooks: ['src/hooks'],
        },
        allowJs: true,
        checkJs: true,
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        moduleResolution: 'bundler',
        module: 'ESNext',
        target: 'ES2022',
      },
      include: ['src/**/*', 'src/app.d.ts'],
      exclude: ['node_modules'],
    }, null, 2);
  }

  private generateViteConfig(options: ScaffoldOptions): string {
    return `import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
});`;
  }

  private generatePostCSSConfig(options: ScaffoldOptions): string {
    return `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};`;
  }

  private generateESLintConfig(options: ScaffoldOptions): string {
    return `import js from '@eslint/js';
import pluginSvelte from 'eslint-plugin-svelte';

export default [
  { ignores: ['build', 'dist', 'node_modules', '.env*', '.svelte-kit'] },
  ...pluginSvelte.configs.recommended,
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: require('svelte-eslint-parser'),
      },
    },
    rules: {
      'svelte/no-at-html-tags': 'off',
    },
  },
  {
    files: ['**/*.{js,ts}'],
    ...js.configs.recommended,
  },
];`;
  }

  private generatePrettierConfig(options: ScaffoldOptions): string {
    return `import pluginSvelte from 'prettier-plugin-svelte';

export default {
  plugins: [pluginSvelte, require('prettier-plugin-tailwindcss')],
  tailwindFunctions: ['cn', 'cva'],
  parser: 'svelte',
  tabWidth: 2,
  singleQuote: true,
  trailingComma: 'es5',
};`;
  }

  private generateGitIgnore(options: ScaffoldOptions): string {
    return `# Dependencies
node_modules
.pnp
.pnp.js

# Build
build
dist
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

  private generateTypes(options: ScaffoldOptions): string {
    return `// Type definitions for ${options.projectName}

export interface BaseComponentProps {
  class?: string;
  'class'?: string; // Svelte uses class not className
  children?: any;
}

export interface ButtonProps extends BaseComponentProps {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  asChild?: boolean;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
}

export interface CardProps extends BaseComponentProps {}

export interface InputProps extends BaseComponentProps {
  type?: string;
  placeholder?: string;
  value?: string;
  onchange?: (e: Event) => void;
}

type HTMLSvelteProps = {
  class?: string;
  [key: string]: any;
};

export type ComponentProps<T extends keyof HTMLElementTagNameMap> = HTMLSvelteProps & SvelteComponent<T>;`;
  }

  private generateUtils(options: ScaffoldOptions): string {
    return `import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}`;
  }

  private generateAppHtml(options: ScaffoldOptions): string {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>%sveltekit.head.title%</title>
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>`;
  }

  private generateAppDts(options: ScaffoldOptions): string {
    return `// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};`;
  }

  private generateRootLayout(options: ScaffoldOptions): string {
    return `<script lang="ts">
  import '../app.css';
</script>

<div class="min-h-screen bg-background text-foreground">
  <slot />
</div>`;
  }

  private generateIndexPage(options: ScaffoldOptions): string {
    return `<script lang="ts">
  import Button from '$lib/components/ui/Button.svelte';
</script>

<main class="min-h-screen flex flex-col items-center justify-center p-8">
  <div class="max-w-2xl text-center">
    <h1 class="text-4xl md:text-6xl font-bold tracking-tight mb-6">
      Welcome to <span class="text-primary">{$projectName}</span>
    </h1>
    <p class="text-xl text-muted-foreground mb-8">
      A modern, full-stack web application built with SvelteKit, Tailwind CSS, and TypeScript.
    </p>
    <div class="flex flex-col sm:flex-row gap-4 justify-center">
      <Button size="lg" variant="default">
        Get Started
      </Button>
      <Button size="lg" variant="outline">
        Learn More
      </Button>
    </div>
  </div>
</main>

<style>
  :global(body) {
    @apply bg-background text-foreground antialiased;
  }
</style>`;
  }

  private generatePageLoad(options: ScaffoldOptions): string {
    return `export function load() {
  return {
    projectName: '${options.projectName}',
  };
};`;
  }

  private generateButtonComponent(options: ScaffoldOptions): string {
    return `<script lang="ts">
  import { cn } from '$lib/utils';
  import { cva, type VariantProps } from 'class-variance-authority';

  export let variant: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link' = 'default';
  export let size: 'default' | 'sm' | 'lg' | 'icon' = 'default';
  export let asChild = false;
  export let type: 'button' | 'submit' | 'reset' = 'button';
  export let disabled = false;
  export let class: string = '';

  const buttonVariants = cva(
    'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
    {
      variants: {
        variant: {
          default: 'bg-primary text-primary-foreground hover:bg-primary/90',
          destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
          outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
          secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
          ghost: 'hover:bg-accent hover:text-accent-foreground',
          link: 'text-primary underline-offset-4 hover:underline',
        },
        size: {
          default: 'h-10 px-4 py-2',
          sm: 'h-9 rounded-md px-3',
          lg: 'h-11 rounded-md px-8',
          icon: 'h-10 w-10',
        },
      },
      defaultVariants: {
        variant: 'default',
        size: 'default',
      },
    }
  );

  const computedClass = cn(buttonVariants({ variant, size, className: class }));
</script>

<button
  type={type}
  disabled={disabled}
  class={computedClass}
  {...$$restProps}
>
  <slot />
</button>

<style>
  /* Component-scoped styles if needed */
</style>`;
  }

  private generateComponentsJson(options: ScaffoldOptions): string {
    return JSON.stringify({
      $schema: 'https://ui.shadcn.com/schema.json',
      style: 'default',
      rsc: false,
      tsx: false,
      tailwind: {
        config: 'tailwind.config.js',
        css: 'src/app.css',
        baseColor: 'slate',
        cssVariables: true,
        prefix: '',
      },
      aliases: {
        components: '$lib/components',
        utils: '$lib/utils',
        ui: '$lib/components/ui',
        lib: '$lib',
        hooks: '$hooks',
      },
    }, null, 2);
  }

  private generateEnvExample(options: ScaffoldOptions): string {
    return `# Environment variables for ${options.projectName}

# Database
DATABASE_URL=

# Auth
AUTH_SECRET=

# API Keys
PUBLIC_OPENAI_API_KEY=
PUBLIC_ANTHROPIC_API_KEY=
`;
  }

  private generateTailwindConfig(options: ScaffoldOptions): GeneratedFile | null {
    if (!options.designSystem) return null;

    const { colors, spacing, typography, borderRadius, shadows } = options.designSystem;

    const content = `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{html,js,svelte,ts}',
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

  private generateGlobalStyles(options: ScaffoldOptions): GeneratedFile | null {
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
      path: 'src/app.css',
      content,
      language: 'css',
    };
  }

  private generateCSSVariables(options: ScaffoldOptions): GeneratedFile | null {
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

  private transpileToSvelte(ir: ComponentIR, options: ScaffoldOptions): string {
    const scriptImports = ir.imports
      .map(imp => {
        const named = imp.named.length > 0 ? `{ ${imp.named.join(', ')} }` : '';
        const defaultPart = imp.default || '';
        const combined = [defaultPart, named].filter(Boolean).join(', ');
        return `import ${combined} from '${imp.from}';`;
      })
      .join('\n');

    const propsExports = ir.props
      .map(p => `export let ${p.name}${p.required ? '' : ` = ${p.default || 'undefined'}`};`)
      .join('\n');

    const stateLines = (ir.stateHooks || [])
      .map(hook => `let ${hook.name} = ${hook.initialValue || 'undefined'};`)
      .join('\n');

    const handlerLines = (ir.handlers || [])
      .map(handler => `${handler.async ? 'async ' : ''}function ${handler.name}(${handler.params?.join(', ') || ''}) {\n${handler.body}\n}`)
      .join('\n\n');

    let svelteTemplate = ir.jsx
      .replace(/className=/g, 'class=')
      .replace(/onClick=\{.*?\}/g, (match) => {
        const handler = match.match(/\{(.*?)\}/)?.[1] || '';
        return `on:click={${handler}}`;
      })
      .replace(/\{(\w+)\}/g, '{$1}');

    return `<script lang="ts">
${scriptImports}

${propsExports}

${stateLines ? stateLines + '\n' : ''}
${handlerLines ? handlerLines + '\n' : ''}
</script>

${svelteTemplate}

<style>
${ir.styles || ''}
</style>`;
  }

  private transpileToPage(ir: ComponentIR, options: ScaffoldOptions): string {
    return this.transpileToSvelte(ir, options);
  }

  private transpileToLayout(ir: ComponentIR, options: ScaffoldOptions): string {
    const scriptImports = ir.imports
      .map(imp => {
        const named = imp.named.length > 0 ? `{ ${imp.named.join(', ')} }` : '';
        const defaultPart = imp.default || '';
        const combined = [defaultPart, named].filter(Boolean).join(', ');
        return `import ${combined} from '${imp.from}';`;
      })
      .join('\n');

    const propsExports = ir.props
      .map(p => `export let ${p.name}${p.required ? '' : ` = ${p.default || 'undefined'}`};`)
      .join('\n');

    let svelteTemplate = ir.jsx
      .replace(/className=/g, 'class=')
      .replace(/onClick=\{.*?\}/g, (match) => {
        const handler = match.match(/\{(.*?)\}/)?.[1] || '';
        return `on:click={${handler}}`;
      })
      .replace(/\{(\w+)\}/g, '{$1}')
      .replace('{children}', '{@render children()}');

    return `<script lang="ts">
${scriptImports}

${propsExports}
</script>

${svelteTemplate}

<style>
${ir.styles || ''}
</style>`;
  }

  private transpileToHook(ir: ComponentIR, options: ScaffoldOptions): string {
    const importLines = ir.imports
      .map(imp => {
        const named = imp.named.length > 0 ? `{ ${imp.named.join(', ')} }` : '';
        const defaultPart = imp.default || '';
        const combined = [defaultPart, named].filter(Boolean).join(', ');
        return `import ${combined} from '${imp.from}';`;
      })
      .join('\n');

    const stateLines = (ir.stateHooks || [])
      .map(hook => `let ${hook.name} = ${hook.initialValue || 'undefined'};`)
      .join('\n');

    const handlerLines = (ir.handlers || [])
      .map(handler => `${handler.async ? 'async ' : ''}function ${handler.name}(${handler.params?.join(', ') || ''}) {\n${handler.body}\n}`)
      .join('\n\n');

    return `${importLines}

${stateLines ? stateLines + '\n' : ''}
${handlerLines ? handlerLines + '\n' : ''}

export function use${capitalize(ir.name)}() {
  return {
    ${(ir.stateHooks || []).map(h => h.name).join(', ')}
    ${(ir.handlers || []).map(h => h.name).join(', ')}
  };
}`

  }
}

export const sveltekitAdapter = new SvelteKitAdapter();