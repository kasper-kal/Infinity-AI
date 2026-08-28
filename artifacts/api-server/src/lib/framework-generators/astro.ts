/**
 * Astro Framework Adapter
 */

import type {
  FrameworkAdapter,
  FrameworkConfig,
  ScaffoldOptions,
  ComponentIR,
  GeneratedFile,
} from '../framework-adapters';
import { capitalize, getRelativePath } from './utils';

export const astroConfig: FrameworkConfig = {
  type: 'astro',
  name: 'astro',
  displayName: 'Astro',
  description: 'Fast, content-focused web framework with island architecture',
  packageJson: {},
  configFiles: {},
  folderStructure: [],
  componentExtension: 'astro',
  componentSyntax: 'astro',
  routingType: 'file-based',
  routesDir: 'src/pages',
  supportedStyling: ['tailwind', 'css-modules', 'unocss'],
  defaultStyling: 'tailwind',
  deploymentTargets: ['vercel', 'netlify', 'cloudflare', 'docker', 'static', 'node'],
  defaultDeployment: 'netlify',
  devCommand: 'astro dev',
  buildCommand: 'astro build',
  previewCommand: 'astro preview',
  features: {
    ssr: true,
    ssg: true,
    islands: true,
    edge: false,
    middleware: true,
    apiRoutes: true,
  },
};

export class AstroAdapter implements FrameworkAdapter {
  readonly config = astroConfig;

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

    // Astro config
    files.push({
      path: 'astro.config.mjs',
      content: this.generateAstroConfig(options),
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

    // Base layout
    files.push({
      path: 'src/layouts/BaseLayout.astro',
      content: this.generateBaseLayout(options),
      language: 'astro',
    });

    // Index page
    files.push({
      path: 'src/pages/index.astro',
      content: this.generateIndexPage(options),
      language: 'astro',
    });

    // Button component
    files.push({
      path: 'src/components/ui/Button.astro',
      content: this.generateButtonComponent(options),
      language: 'astro',
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
        dev: 'astro dev',
        start: 'astro dev',
        build: 'astro check && astro build',
        preview: 'astro preview',
        'astro:astro': 'astro check',
        lint: 'eslint . --ext .astro,ts,tsx --report-unused-disable-directives --max-warnings 0',
        format: 'prettier --write .',
        test: 'vitest',
      },
      dependencies: {
        astro: '^4.2.0',
        'clsx': '^2.1.0',
        'tailwind-merge': '^2.2.0',
        'class-variance-authority': '^0.7.0',
        'lucide-react': '^0.303.0',
        'zod': '^3.22.0',
      },
      devDependencies: {
        '@astrojs/check': '^0.5.0',
        '@astrojs/react': '^3.0.0',
        '@astrojs/tailwind': '^5.1.0',
        '@types/react': '^18.2.0',
        '@types/react-dom': '^18.2.0',
        'typescript': '^5.3.0',
        'eslint': '^8.56.0',
        'eslint-plugin-astro': '^0.31.0',
        'prettier': '^3.2.0',
        'prettier-plugin-astro': '^0.13.0',
        'prettier-plugin-tailwindcss': '^0.5.0',
        'tailwindcss': '^3.4.0',
        'vitest': '^1.2.0',
        '@testing-library/react': '^14.1.0',
      },
    };
  }

  generateConfigFiles(options: ScaffoldOptions): Record<string, string> {
    return {
      'tsconfig.json': this.generateTSConfig(options),
      'eslint.config.js': this.generateESLintConfig(options),
      'prettier.config.js': this.generatePrettierConfig(options),
      '.gitignore': this.generateGitIgnore(options),
    };
  }

  generateFrameworkConfigs(options: ScaffoldOptions): Record<string, string> {
    return {
      'astro.config.mjs': this.generateAstroConfig(options),
    };
  }

  getFrameworkSpecificFolders(options: ScaffoldOptions): string[] {
    return [
      'src/layouts/',
      'src/pages/',
      'src/content/',
      'src/scripts/',
    ];
  }

  generateComponent(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `src/components/${ir.name}.astro`,
      content: this.transpileToAstro(ir, options),
      language: 'astro',
    };
  }

  generatePage(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `src/pages/${ir.name.toLowerCase()}.astro`,
      content: this.transpileToPage(ir, options),
      language: 'astro',
    };
  }

  generateLayout(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `src/layouts/${ir.name}.astro`,
      content: this.transpileToLayout(ir, options),
      language: 'astro',
    };
  }

  generateHook(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `src/scripts/use${capitalize(ir.name)}.ts`,
      content: this.transpileToHook(ir, options),
      language: 'typescript',
    };
  }

  generateRoutes(irs: ComponentIR[], options: ScaffoldOptions): GeneratedFile[] {
    return irs.map(ir => this.generatePage(ir, options));
  }

  getComponentExtension(): string {
    return 'astro';
  }

  getImportPath(ir: ComponentIR, fromFile: string): string {
    const fromDir = fromFile.split('/').slice(0, -1).join('/');
    const toPath = `../components/${ir.name}`;
    return this.getRelativePath(fromDir, toPath);
  }

  transformJSXToFramework(jsx: string, options: ScaffoldOptions): string {
    return jsx
      .replace(/className=/g, 'class=')
      .replace(/htmlFor=/g, 'for=')
      .replace(/\{([^}]+)\}/g, (match, expr) => `{${expr}}`);
  }

  // --- Generation Methods ---

  private generateAstroConfig(options: ScaffoldOptions): string {
    return `import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  integrations: [react(), tailwind()],
  output: 'static',
  adapter: undefined,
});`;
  }

  private generateTSConfig(options: ScaffoldOptions): string {
    return JSON.stringify({
      extends: 'astro/tsconfigs/strict',
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '@/*': ['./src/*'],
        },
        strictNullChecks: true,
      },
    }, null, 2);
  }

  private generateESLintConfig(options: ScaffoldOptions): string {
    return `import pluginAstro from 'eslint-plugin-astro';
import pluginReact from 'eslint-plugin-react';

export default [
  { ignores: ['dist', 'node_modules', '.env*', '.astro'] },
  ...pluginAstro.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { browser: true, es2020: true },
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    settings: { react: { version: '18.2' } },
    plugins: {
      react: pluginReact,
    },
    rules: {
      ...pluginReact.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
];`;
  }

  private generatePrettierConfig(options: ScaffoldOptions): string {
    return `import pluginAstro from 'prettier-plugin-astro';

export default {
  plugins: [pluginAstro, require('prettier-plugin-tailwindcss')],
  tailwindFunctions: ['cn', 'cva'],
  parser: 'astro',
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
dist
build
.astro

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
  children?: any;
}

export interface ButtonProps extends BaseComponentProps {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  asChild?: boolean;
}

export interface CardProps extends BaseComponentProps {}

export interface InputProps extends BaseComponentProps {
  type?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: Event) => void;
}

type HTMLAstroProps = {
  class?: string;
  [key: string]: any;
};

export type ComponentProps<T extends keyof HTMLElementTagNameMap> = HTMLAstroProps & React.ComponentPropsWithoutRef<T>;`;
  }

  private generateUtils(options: ScaffoldOptions): string {
    return `import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}`;
  }

  private generateBaseLayout(options: ScaffoldOptions): string {
    return `---
interface Props {
  title: string;
  description?: string;
}

const { title, description = 'Built with Astro' } = Astro.props;
---

<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content={description} />
    <title>{title}</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  </head>
  <body class="bg-background text-foreground">
    <slot />
  </body>
</html>`;
  }

  private generateIndexPage(options: ScaffoldOptions): string {
    return `---
import BaseLayout from '@/layouts/BaseLayout.astro';
import Button from '@/components/ui/Button.astro';
---

<BaseLayout title="Welcome to ${options.projectName}" description="Built with Astro and Tailwind CSS">
  <main class="min-h-screen flex flex-col items-center justify-center p-8">
    <div class="max-w-2xl text-center">
      <h1 class="text-4xl md:text-6xl font-bold tracking-tight mb-6">
        Welcome to <span class="text-primary">${options.projectName}</span>
      </h1>
      <p class="text-xl text-muted-foreground mb-8">
        A modern, fast web application built with Astro, Tailwind CSS, and TypeScript.
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
</BaseLayout>`;
  }

  private generateButtonComponent(options: ScaffoldOptions): string {
    return `---
import { cn } from '@/lib/utils';
import { Slot } from '@radix-ui/react-slot';

interface Props {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  asChild?: boolean;
  class?: string;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
}

const {
  variant = 'default',
  size = 'default',
  asChild = false,
  class: className,
  type = 'button',
  disabled = false,
  ...rest
} = Astro.props;

const baseStyles = 'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';

const variants = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  link: 'text-primary underline-offset-4 hover:underline',
};

const sizes = {
  default: 'h-10 px-4 py-2',
  sm: 'h-9 rounded-md px-3',
  lg: 'h-11 rounded-md px-8',
  icon: 'h-10 w-10',
};

const Comp = asChild ? Slot : 'button';
---

<Comp
  type={type}
  disabled={disabled}
  class={cn(baseStyles, variants[variant], sizes[size], className)}
  {...rest}
>
  <slot />
</Comp>

<style>
  /* Scoped styles if needed */
</style>`;
  }

  private generateComponentsJson(options: ScaffoldOptions): string {
    return JSON.stringify({
      $schema: 'https://ui.shadcn.com/schema.json',
      style: 'default',
      rsc: false,
      tsx: true,
      tailwind: {
        config: 'tailwind.config.mjs',
        css: 'src/styles/globals.css',
        baseColor: 'slate',
        cssVariables: true,
        prefix: '',
      },
      aliases: {
        components: '@/components',
        utils: '@/lib/utils',
        ui: '@/components/ui',
        lib: '@/lib',
        hooks: '@/scripts',
      },
    }, null, 2);
  }

  private generateEnvExample(options: ScaffoldOptions): string {
    return `# Environment variables for ${options.projectName}

# Database
DATABASE_URL=

# Auth
PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

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
    './src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}',
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
      path: 'tailwind.config.mjs',
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
      path: 'src/styles/globals.css',
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

  private transpileToAstro(ir: ComponentIR, options: ScaffoldOptions): string {
    const importLines = ir.imports
      .map(imp => {
        const named = imp.named.length > 0 ? `{ ${imp.named.join(', ')} }` : '';
        const defaultPart = imp.default || '';
        const combined = [defaultPart, named].filter(Boolean).join(', ');
        return `import ${combined} from '${imp.from}';`;
      })
      .join('\n');

    let astroTemplate = ir.jsx
      .replace(/className=/g, 'class=')
      .replace(/htmlFor=/g, 'for=')
      .replace(/\{([^}]+)\}/g, (match, expr) => `{${expr}}`);

    const propsInterface = ir.props.length > 0
      ? `interface Props {\n${ir.props.map(p => `  ${p.name}${p.required ? '' : '?'}: ${p.type};`).join('\n')}\n}\nconst { ${ir.props.map(p => p.name).join(', ')} } = Astro.props;\n`
      : '';

    return `---
${importLines}

${propsInterface}
---

${astroTemplate}

<style>
${ir.styles || ''}
</style>`;
  }

  private transpileToPage(ir: ComponentIR, options: ScaffoldOptions): string {
    return this.transpileToAstro(ir, options);
  }

  private transpileToLayout(ir: ComponentIR, options: ScaffoldOptions): string {
    const importLines = ir.imports
      .map(imp => {
        const named = imp.named.length > 0 ? `{ ${imp.named.join(', ')} }` : '';
        const defaultPart = imp.default || '';
        const combined = [defaultPart, named].filter(Boolean).join(', ');
        return `import ${combined} from '${imp.from}';`;
      })
      .join('\n');

    let astroTemplate = ir.jsx
      .replace(/className=/g, 'class=')
      .replace(/htmlFor=/g, 'for=')
      .replace(/\{([^}]+)\}/g, (match, expr) => `{${expr}}`);

    const propsInterface = ir.props.length > 0
      ? `interface Props {\n${ir.props.map(p => `  ${p.name}${p.required ? '' : '?'}: ${p.type};`).join('\n')}\n}\nconst { ${ir.props.map(p => p.name).join(', ')}, ...rest } = Astro.props;\n`
      : 'const { ...rest } = Astro.props;\n';

    return `---
${importLines}

${propsInterface}
---

${astroTemplate}

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

export const astroAdapter = new AstroAdapter();