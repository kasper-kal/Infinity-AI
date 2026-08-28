/**
 * SolidStart Framework Adapter
 */

import type {
  FrameworkAdapter,
  FrameworkConfig,
  ScaffoldOptions,
  ComponentIR,
  GeneratedFile,
} from '../framework-adapters';
import { capitalize, getRelativePath } from './utils';

export const solidstartConfig: FrameworkConfig = {
  type: 'solidstart',
  name: 'solidstart',
  displayName: 'SolidStart',
  description: 'Full-stack SolidJS framework with SSR, file-based routing, and serverless support',
  packageJson: {},
  configFiles: {},
  folderStructure: [],
  componentExtension: 'tsx',
  componentSyntax: 'tsx',
  routingType: 'file-based',
  routesDir: 'src/routes',
  supportedStyling: ['tailwind', 'unocss', 'css-modules', 'vanilla-extract'],
  defaultStyling: 'tailwind',
  deploymentTargets: ['vercel', 'netlify', 'cloudflare', 'docker', 'node'],
  defaultDeployment: 'vercel',
  devCommand: 'solid-start dev',
  buildCommand: 'solid-start build',
  previewCommand: 'solid-start start',
  features: {
    ssr: true,
    ssg: true,
    islands: false,
    edge: true,
    middleware: true,
    apiRoutes: true,
  },
};

export class SolidStartAdapter implements FrameworkAdapter {
  readonly config = solidstartConfig;

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

    // SolidStart config
    files.push({
      path: 'solid-start.config.ts',
      content: this.generateSolidStartConfig(options),
      language: 'typescript',
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

    // Root layout
    files.push({
      path: 'src/app.tsx',
      content: this.generateAppTsx(options),
      language: 'typescript',
    });

    // Root route
    files.push({
      path: 'src/routes.tsx',
      content: this.generateRoutesTsx(options),
      language: 'typescript',
    });

    // Index route
    files.push({
      path: 'src/routes/index.tsx',
      content: this.generateIndexRoute(options),
      language: 'typescript',
    });

    // Button component
    files.push({
      path: 'src/components/ui/Button.tsx',
      content: this.generateButtonComponent(options),
      language: 'typescript',
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
        dev: 'solid-start dev',
        build: 'solid-start build',
        start: 'solid-start start',
        lint: 'eslint . --ext .ts,.tsx --report-unused-disable-directives --max-warnings 0',
        format: 'prettier --write .',
        test: 'vitest',
      },
      dependencies: {
        '@solidjs/start': '^1.0.0',
        '@solidjs/router': '^0.13.0',
        '@solidjs/meta': '^0.29.0',
        'solid-js': '^1.8.0',
        'clsx': '^2.1.0',
        'tailwind-merge': '^2.2.0',
        'class-variance-authority': '^0.7.0',
        'lucide-solid': '^0.303.0',
        'zod': '^3.22.0',
      },
      devDependencies: {
        '@solidjs/testing-library': '^0.8.0',
        'typescript': '^5.3.0',
        'vite': '^5.0.0',
        'vite-plugin-solid': '^2.8.0',
        'eslint': '^8.56.0',
        'eslint-plugin-solid': '^0.13.0',
        'prettier': '^3.2.0',
        'prettier-plugin-tailwindcss': '^0.5.0',
        'tailwindcss': '^3.4.0',
        'postcss': '^8.4.0',
        'autoprefixer': '^10.4.0',
        'vitest': '^1.2.0',
        '@testing-library/jest-dom': '^6.2.0',
      },
      engines: {
        node: '>=18.0.0',
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
      'solid-start.config.ts': this.generateSolidStartConfig(options),
    };
  }

  getFrameworkSpecificFolders(options: ScaffoldOptions): string[] {
    return [
      'src/routes/',
      'src/components/',
      'src/lib/',
      'src/hooks/',
      'src/styles/',
      'public/',
    ];
  }

  generateComponent(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `src/components/${ir.name}.tsx`,
      content: this.transpileToSolid(ir, options),
      language: 'typescript',
    };
  }

  generatePage(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `src/routes/${ir.name.toLowerCase()}.tsx`,
      content: this.transpileToPage(ir, options),
      language: 'typescript',
    };
  }

  generateLayout(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `src/routes/${ir.name.toLowerCase()}.tsx`,
      content: this.transpileToLayout(ir, options),
      language: 'typescript',
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
    return 'tsx';
  }

  getImportPath(ir: ComponentIR, fromFile: string): string {
    const fromDir = fromFile.split('/').slice(0, -1).join('/');
    const toPath = `~/components/${ir.name}`;
    return this.getRelativePath(fromDir, toPath);
  }

  transformJSXToFramework(jsx: string, options: ScaffoldOptions): string {
    // Solid uses similar JSX but with different attributes
    return jsx
      .replace(/className=/g, 'class=')
      .replace(/htmlFor=/g, 'for=');
  }

  // --- Generation Methods ---

  private generateSolidStartConfig(options: ScaffoldOptions): string {
    return `import { defineConfig } from '@solidjs/start/config';

export default defineConfig({
  server: {
    preset: 'node',
  },
  vite: {
    plugins: [],
  },
});`;
  }

  private generateTSConfig(options: ScaffoldOptions): string {
    return JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        jsx: 'preserve',
        jsxImportSource: 'solid-js',
        strict: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        baseUrl: '.',
        paths: {
          '@/*': ['./src/*'],
          '~/*': ['./src/*'],
        },
      },
      include: ['src', 'vite.config.ts', 'solid-start.config.ts'],
      exclude: ['node_modules', 'dist', '.solid'],
    }, null, 2);
  }

  private generateViteConfig(options: ScaffoldOptions): string {
    return `import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  server: {
    port: 3000,
  },
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
import pluginSolid from 'eslint-plugin-solid';

export default [
  { ignores: ['dist', '.solid', 'node_modules', '.env*'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { browser: true, es2020: true },
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    plugins: {
      solid: pluginSolid,
    },
    rules: {
      ...pluginSolid.configs.recommended.rules,
    },
  },
];`;
  }

  private generatePrettierConfig(options: ScaffoldOptions): string {
    return `export default {
  plugins: ['prettier-plugin-tailwindcss'],
  tailwindFunctions: ['cn', 'cva'],
};`;
  }

  private generateGitIgnore(options: ScaffoldOptions): string {
    return `# Dependencies
node_modules
.pnp
.pnp.js

# Build
dist
.solid
.output

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
  classList?: Record<string, boolean>;
  children?: JSX.Element;
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
  onInput?: (e: Event) => void;
}

declare module 'solid-js' {
  namespace JSX {
    interface IntrinsicElements {
      'radix-slot': any;
    }
  }
}

export {};`;
  }

  private generateUtils(options: ScaffoldOptions): string {
    return `import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}`;
  }

  private generateAppTsx(options: ScaffoldOptions): string {
    return `import { MetaProvider } from '@solidjs/meta';
import { Router } from '@solidjs/router';
import './index.css';

export default function App() {
  return (
    <MetaProvider>
      <Router>
        <Routes />
      </Router>
    </MetaProvider>
  );
}

function Routes() {
  return (
    <Routes>
      <Route path="/" component={Home} />
    </Routes>
  );
}

function Home() {
  return <div>Welcome to ${options.projectName}</div>;
}`;
  }

  private generateRoutesTsx(options: ScaffoldOptions): string {
    return `import { Route, FileRoutes } from '@solidjs/start/router';

export const routes = {
  '/': import('./routes/index'),
} satisfies FileRoutes;`;
  }

  private generateIndexRoute(options: ScaffoldOptions): string {
    return `import { createSignal } from 'solid-js';
import { Meta } from '@solidjs/meta';
import Button from '@/components/ui/Button';

export default function Home() {
  const [count, setCount] = createSignal(0);

  return (
    <>
      <Meta title="${options.projectName}" />
      <main class="min-h-screen flex flex-col items-center justify-center p-8">
        <div class="max-w-2xl text-center">
          <h1 class="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Welcome to <span class="text-primary">${options.projectName}</span>
          </h1>
          <p class="text-xl text-muted-foreground mb-8">
            A modern, full-stack web application built with SolidStart, Tailwind CSS, and TypeScript.
          </p>
          <div class="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" variant="default" onClick={() => setCount(c => c + 1)}>
              Count: {count()}
            </Button>
            <Button size="lg" variant="outline">
              Learn More
            </Button>
          </div>
        </div>
      </main>
    </>
  );
}`;
  }

  private generateButtonComponent(options: ScaffoldOptions): string {
    return `import { splitProps, mergeProps } from 'solid-js';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Show } from 'solid-js';

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

export interface ButtonProps
  extends JSX.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ['variant', 'size', 'asChild', 'class', 'classList']);
  const { variant, size, asChild, class: className, classList, ...otherProps } = rest;

  const computedClass = cn(buttonVariants({ variant, size, className }), classList);

  if (asChild) {
    return (
      <Show when={!!props.children}>
        {() => {
          const child = props.children as JSX.Element;
          return (
            <{child.props.as || 'button'}
              {...mergeProps(otherProps, {
                class: computedClass,
                classList: { ...child.props.classList, ...classList },
              })}
            >
              {child.props.children}
            </{child.props.as || 'button'}>
          );
        }}
      </Show>
    );
  }

  return (
    <button
      {...mergeProps(otherProps, {
        class: computedClass,
        classList,
      })}
    >
      {props.children}
    </button>
  );
}`;
  }

  private generateComponentsJson(options: ScaffoldOptions): string {
    return JSON.stringify({
      $schema: 'https://ui.shadcn.com/schema.json',
      style: 'default',
      rsc: false,
      tsx: true,
      tailwind: {
        config: 'tailwind.config.js',
        css: 'src/index.css',
        baseColor: 'slate',
        cssVariables: true,
        prefix: '',
      },
      aliases: {
        components: '@/components',
        utils: '@/lib/utils',
        ui: '@/components/ui',
        lib: '@/lib',
        hooks: '@/hooks',
      },
    }, null, 2);
  }

  private generateEnvExample(options: ScaffoldOptions): string {
    return `# Environment variables for ${options.projectName}

# Database
DATABASE_URL=

# Auth
SESSION_SECRET=

# API Keys
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
`;
  }

  private generateTailwindConfig(options: ScaffoldOptions): GeneratedFile | null {
    if (!options.designSystem) return null;

    const { colors, spacing, typography, borderRadius, shadows } = options.designSystem;

    const content = `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{js,ts,jsx,tsx}',
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
      path: 'src/index.css',
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

  private transpileToSolid(ir: ComponentIR, options: ScaffoldOptions): string {
    const importLines = ir.imports
      .map(imp => {
        const named = imp.named.length > 0 ? `{ ${imp.named.join(', ')} }` : '';
        const defaultPart = imp.default || '';
        const combined = [defaultPart, named].filter(Boolean).join(', ');
        const typeKeyword = imp.type === 'type' ? 'type ' : '';
        const solidFrom = imp.from === 'react' ? 'solid-js' : imp.from;
        return `import ${typeKeyword}${combined} from '${solidFrom}';`;
      })
      .join('\n');

    const propsInterface = ir.props.length > 0
      ? `interface ${ir.name}Props {\n${ir.props
          .map(p => `  ${p.name}${p.required ? '' : '?'}: ${p.type};`)
          .join('\n')}\n}\n`
      : '';

    const stateLines = (ir.stateHooks || [])
      .map(hook => `  const [${hook.name}, set${capitalize(hook.name)}] = createSignal<${hook.type || 'any'}>(${hook.initialValue || 'undefined'});`)
      .join('\n');

    const effectLines = (ir.effects || [])
      .map(effect => `  createEffect(() => {\n${effect.body}\n  });`)
      .join('\n\n');

    const handlerLines = (ir.handlers || [])
      .map(handler => `  ${handler.async ? 'async ' : ''}function ${handler.name}(${handler.params?.join(', ') || ''}) {\n${handler.body}\n  }`)
      .join('\n\n');

    const jsx = ir.jsx
      .replace(/className=/g, 'class=')
      .replace(/htmlFor=/g, 'for=');

    const propsType = ir.props.length > 0 ? `${ir.name}Props` : '{}';

    return `${importLines}

${propsInterface}
export function ${ir.name}(props: ${propsType}) {
${stateLines ? stateLines + '\n' : ''}
${effectLines ? effectLines + '\n' : ''}
${handlerLines ? handlerLines + '\n' : ''}
  return (
${jsx}
  );
}`;
  }

  private transpileToPage(ir: ComponentIR, options: ScaffoldOptions): string {
    return this.transpileToSolid(ir, options);
  }

  private transpileToLayout(ir: ComponentIR, options: ScaffoldOptions): string {
    const importLines = ir.imports
      .map(imp => {
        const named = imp.named.length > 0 ? `{ ${imp.named.join(', ')} }` : '';
        const defaultPart = imp.default || '';
        const combined = [defaultPart, named].filter(Boolean).join(', ');
        const typeKeyword = imp.type === 'type' ? 'type ' : '';
        const solidFrom = imp.from === 'react' ? 'solid-js' : imp.from;
        return `import ${typeKeyword}${combined} from '${solidFrom}';`;
      })
      .join('\n');

    const propsInterface = ir.props.length > 0
      ? `interface ${ir.name}LayoutProps {\n${ir.props
          .map(p => `  ${p.name}${p.required ? '' : '?'}: ${p.type};`)
          .join('\n')}\n}\n`
      : '';

    const jsx = ir.jsx
      .replace(/className=/g, 'class=')
      .replace(/htmlFor=/g, 'for=')
      .replace('{children}', '{props.children}');

    return `${importLines}

${propsInterface}
export default function ${ir.name}Layout(props: ${ir.props.length > 0 ? `${ir.name}LayoutProps` : '{}'} & { children: JSX.Element }) {
  return (
${jsx}
  );
}`;
  }

  private transpileToHook(ir: ComponentIR, options: ScaffoldOptions): string {
    const importLines = ir.imports
      .map(imp => {
        const named = imp.named.length > 0 ? `{ ${imp.named.join(', ')} }` : '';
        const defaultPart = imp.default || '';
        const combined = [defaultPart, named].filter(Boolean).join(', ');
        const solidFrom = imp.from === 'react' ? 'solid-js' : imp.from;
        return `import ${combined} from '${solidFrom}';`;
      })
      .join('\n');

    const stateLines = (ir.stateHooks || [])
      .map(hook => `  const [${hook.name}, set${capitalize(hook.name)}] = createSignal<${hook.type || 'any'}>(${hook.initialValue || 'undefined'});`)
      .join('\n');

    const effectLines = (ir.effects || [])
      .map(effect => `  createEffect(() => {\n${effect.body}\n  });`)
      .join('\n\n');

    const handlerLines = (ir.handlers || [])
      .map(handler => `  ${handler.async ? 'async ' : ''}function ${handler.name}(${handler.params?.join(', ') || ''}) {\n${handler.body}\n  }`)
      .join('\n\n');

    return `${importLines}

export function use${capitalize(ir.name)}() {
${stateLines ? stateLines + '\n' : ''}
${effectLines ? effectLines + '\n' : ''}
${handlerLines ? handlerLines + '\n' : ''}

  return {
    ${(ir.stateHooks || []).map(h => h.name).join(', ')}
    ${(ir.handlers || []).map(h => h.name).join(', ')}
  };
}`

  }
}

export const solidStartAdapter = new SolidStartAdapter();