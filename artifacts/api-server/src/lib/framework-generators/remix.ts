/**
 * Remix Framework Adapter
 */

import type {
  FrameworkAdapter,
  FrameworkConfig,
  ScaffoldOptions,
  ComponentIR,
  GeneratedFile,
} from '../framework-adapters';
import { capitalize, getRelativePath } from './utils';

export const remixConfig: FrameworkConfig = {
  type: 'remix',
  name: 'remix',
  displayName: 'Remix',
  description: 'Full-stack React framework with nested routing and progressive enhancement',
  packageJson: {},
  configFiles: {},
  folderStructure: [],
  componentExtension: 'tsx',
  componentSyntax: 'tsx',
  routingType: 'file-based',
  routesDir: 'app/routes',
  supportedStyling: ['tailwind', 'css-modules', 'vanilla-extract'],
  defaultStyling: 'tailwind',
  deploymentTargets: ['vercel', 'netlify', 'cloudflare', 'docker', 'node'],
  defaultDeployment: 'vercel',
  devCommand: 'remix dev',
  buildCommand: 'remix build',
  previewCommand: 'remix serve build',
  features: {
    ssr: true,
    ssg: false,
    islands: false,
    edge: true,
    middleware: true,
    apiRoutes: true,
  },
};

export class RemixAdapter implements FrameworkAdapter {
  readonly config = remixConfig;

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

    // Remix config
    files.push({
      path: 'remix.config.js',
      content: this.generateRemixConfig(options),
      language: 'javascript',
    });

    // Types
    files.push({
      path: 'app/types/index.ts',
      content: this.generateTypes(options),
      language: 'typescript',
    });

    // Lib utils
    files.push({
      path: 'app/lib/utils.ts',
      content: this.generateUtils(options),
      language: 'typescript',
    });

    // Root route
    files.push({
      path: 'app/root.tsx',
      content: this.generateRootRoute(options),
      language: 'typescript',
    });

    // Entry client
    files.push({
      path: 'app/entry.client.tsx',
      content: this.generateEntryClient(options),
      language: 'typescript',
    });

    // Entry server
    files.push({
      path: 'app/entry.server.tsx',
      content: this.generateEntryServer(options),
      language: 'typescript',
    });

    // Index route
    files.push({
      path: 'app/routes/_index.tsx',
      content: this.generateIndexRoute(options),
      language: 'typescript',
    });

    // Button component
    files.push({
      path: 'app/components/ui/button.tsx',
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
      sideEffects: false,
      type: 'module',
      scripts: {
        dev: 'remix dev',
        build: 'remix build',
        start: 'remix-serve ./build/server/index.js',
        typecheck: 'tsc',
        lint: 'eslint . --ext .ts,.tsx --report-unused-disable-directives --max-warnings 0',
        format: 'prettier --write .',
        test: 'vitest',
      },
      dependencies: {
        '@remix-run/react': '^2.6.0',
        '@remix-run/node': '^2.6.0',
        '@remix-run/serve': '^2.6.0',
        react: '^18.2.0',
        'react-dom': '^18.2.0',
        'clsx': '^2.1.0',
        'tailwind-merge': '^2.2.0',
        'class-variance-authority': '^0.7.0',
        'lucide-react': '^0.303.0',
        'zod': '^3.22.0',
        'isbot': '^4.1.0',
      },
      devDependencies: {
        '@remix-run/dev': '^2.6.0',
        '@types/react': '^18.2.0',
        '@types/react-dom': '^18.2.0',
        'typescript': '^5.3.0',
        'vite': '^5.0.0',
        'vite-tsconfig-paths': '^4.2.0',
        'eslint': '^8.56.0',
        'eslint-plugin-react-hooks': '^4.6.0',
        'eslint-plugin-react-refresh': '^0.4.0',
        'prettier': '^3.2.0',
        'prettier-plugin-tailwindcss': '^0.5.0',
        'tailwindcss': '^3.4.0',
        'postcss': '^8.4.0',
        'autoprefixer': '^10.4.0',
        'vitest': '^1.2.0',
        '@testing-library/react': '^14.1.0',
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
      'remix.config.js': this.generateRemixConfig(options),
      'vite.config.ts': this.generateViteConfig(options),
    };
  }

  getFrameworkSpecificFolders(options: ScaffoldOptions): string[] {
    return [
      'app/routes/',
      'app/components/',
      'app/styles/',
      'app/utils/',
      'app/hooks/',
    ];
  }

  generateComponent(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `app/components/${ir.name}.tsx`,
      content: this.transpileToRemix(ir, options),
      language: 'typescript',
    };
  }

  generatePage(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `app/routes/${ir.name.toLowerCase()}.tsx`,
      content: this.transpileToPage(ir, options),
      language: 'typescript',
    };
  }

  generateLayout(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `app/routes/${ir.name.toLowerCase()}._layout.tsx`,
      content: this.transpileToLayout(ir, options),
      language: 'typescript',
    };
  }

  generateHook(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `app/hooks/use${capitalize(ir.name)}.ts`,
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
    const toPath = `app/components/${ir.name}`;
    return this.getRelativePath(fromDir, toPath);
  }

  transformJSXToFramework(jsx: string, options: ScaffoldOptions): string {
    return jsx;
  }

  // --- Generation Methods ---

  private generateRemixConfig(options: ScaffoldOptions): string {
    return `/** @type {import('@remix-run/dev').AppConfig} */
export default {
  ignoredRouteFiles: ['**/.*'],
  future: {
    v3_fetcherPersist: true,
    v3_relativeSplatPath: true,
    v3_throwAbortReason: true,
    v3_lazyRouteDiscovery: true,
    v3_singleFetch: true,
    v3_routeConfig: true,
  },
  tailwind: true,
};`;
  }

  private generateTSConfig(options: ScaffoldOptions): string {
    return JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        jsxImportSource: 'react',
        strict: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        baseUrl: '.',
        paths: {
          '@/*': ['./app/*'],
        },
      },
      include: ['app', 'remix.env.d.ts'],
      exclude: ['node_modules', 'build'],
    }, null, 2);
  }

  private generateViteConfig(options: ScaffoldOptions): string {
    return `import { remix } from '@remix-run/dev';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_lazyRouteDiscovery: true,
        v3_singleFetch: true,
        v3_routeConfig: true,
      },
    }),
    tsconfigPaths(),
  ],
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
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  { ignores: ['dist', 'build', 'node_modules', '.env*'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    settings: { react: { version: '18.2' } },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
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
build
dist
.next

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
  className?: string;
  children?: React.ReactNode;
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
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

interface CloudflareEnv {
  // Add your Cloudflare bindings here
}

declare global {
  namespace Remix {
    interface AppLoadContext {
      cloudflare?: CloudflareEnv;
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

  private generateRootRoute(options: ScaffoldOptions): string {
    return `import {
  Links,
  LiveReload,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from '@remix-run/react';
import { cn } from '@/lib/utils';
import './tailwind.css';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: '/tailwind.css' },
  { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
];

export const meta: MetaFunction = () => ({
  charset: 'utf-8',
  title: '${options.projectName}',
  viewport: 'width=device-width,initial-scale=1',
});

export default function App() {
  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
      </head>
      <body class="bg-background text-foreground antialiased">
        <Outlet />
        <ScrollRestoration />
        <Scripts />
        <LiveReload />
      </body>
    </html>
  );
}`;
  }

  private generateEntryClient(options: ScaffoldOptions): string {
    return `import { hydrateRoot } from 'react-dom/client';
import { RemixBrowser } from '@remix-run/react';
import { startTransition } from 'react';

startTransition(() => {
  hydrateRoot(document, <RemixBrowser />);
});`;
  }

  private generateEntryServer(options: ScaffoldOptions): string {
    return `import { createRequestHandler } from '@remix-run/node';
import * as build from 'virtual:remix/server-build';

const requestHandler = createRequestHandler(build);

export default requestHandler;`;
  }

  private generateIndexRoute(options: ScaffoldOptions): string {
    return `import { Outlet, Link } from '@remix-run/react';
import { cn } from '@/lib/utils';
import Button from '@/components/ui/button';

export default function Index() {
  return (
    <main class="min-h-screen flex flex-col items-center justify-center p-8">
      <div class="max-w-2xl text-center">
        <h1 class="text-4xl md:text-6xl font-bold tracking-tight mb-6">
          Welcome to <span class="text-primary">${options.projectName}</span>
        </h1>
        <p class="text-xl text-muted-foreground mb-8">
          A modern, full-stack web application built with Remix, Tailwind CSS, and TypeScript.
        </p>
        <div class="flex flex-col sm:flex-row gap-4 justify-center">
          <Button size="lg" variant="default" asChild>
            <Link to="/getting-started">Get Started</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link to="/docs">Learn More</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}`;
  }

  private generateButtonComponent(options: ScaffoldOptions): string {
    return `import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

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
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };`;
  }

  private generateComponentsJson(options: ScaffoldOptions): string {
    return JSON.stringify({
      $schema: 'https://ui.shadcn.com/schema.json',
      style: 'default',
      rsc: false,
      tsx: true,
      tailwind: {
        config: 'tailwind.config.ts',
        css: 'app/tailwind.css',
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
    './app/**/*.{js,ts,jsx,tsx}',
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
      path: 'tailwind.config.ts',
      content,
      language: 'typescript',
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
      path: 'app/tailwind.css',
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
      path: 'app/styles/variables.css',
      content,
      language: 'css',
    };
  }

  private transpileToRemix(ir: ComponentIR, options: ScaffoldOptions): string {
    const importLines = ir.imports
      .map(imp => {
        const named = imp.named.length > 0 ? `{ ${imp.named.join(', ')} }` : '';
        const defaultPart = imp.default || '';
        const combined = [defaultPart, named].filter(Boolean).join(', ');
        const typeKeyword = imp.type === 'type' ? 'type ' : '';
        return `import ${typeKeyword}${combined} from '${imp.from}';`;
      })
      .join('\n');

    const propsInterface = ir.props.length > 0
      ? `interface ${ir.name}Props {\n${ir.props
          .map(p => `  ${p.name}${p.required ? '' : '?'}: ${p.type};`)
          .join('\n')}\n}\n`
      : '';

    const stateLines = (ir.stateHooks || [])
      .map(hook => `  const [${hook.name}, set${capitalize(hook.name)}] = useState<${hook.type || 'any'}>(${hook.initialValue || 'undefined'});`)
      .join('\n');

    const effectLines = (ir.effects || [])
      .map(effect => `  useEffect(() => {\n${effect.body}\n  }, [${effect.deps?.join(', ') || ''}]);`)
      .join('\n\n');

    const handlerLines = (ir.handlers || [])
      .map(handler => `  ${handler.async ? 'async ' : ''}function ${handler.name}(${handler.params?.join(', ') || ''}) {\n${handler.body}\n  }`)
      .join('\n\n');

    const propsType = ir.props.length > 0 ? `${ir.name}Props` : '{}';

    return `${importLines}

${propsInterface}
export function ${ir.name}({ ${ir.props.map(p => p.name).join(', ')} }: ${propsType}) {
${stateLines ? stateLines + '\n' : ''}
${effectLines ? effectLines + '\n' : ''}
${handlerLines ? handlerLines + '\n' : ''}
  return (
${ir.jsx}
  );
}`;
  }

  private transpileToPage(ir: ComponentIR, options: ScaffoldOptions): string {
    // Remix pages can have loaders, actions, meta
    return this.transpileToRemix(ir, options);
  }

  private transpileToLayout(ir: ComponentIR, options: ScaffoldOptions): string {
    const importLines = ir.imports
      .map(imp => {
        const named = imp.named.length > 0 ? `{ ${imp.named.join(', ')} }` : '';
        const defaultPart = imp.default || '';
        const combined = [defaultPart, named].filter(Boolean).join(', ');
        const typeKeyword = imp.type === 'type' ? 'type ' : '';
        return `import ${typeKeyword}${combined} from '${imp.from}';`;
      })
      .join('\n');

    const propsInterface = ir.props.length > 0
      ? `interface ${ir.name}LayoutProps {\n${ir.props
          .map(p => `  ${p.name}${p.required ? '' : '?'}: ${p.type};`)
          .join('\n')}\n}\n`
      : '';

    return `${importLines}

${propsInterface}
export default function ${ir.name}Layout({ ${ir.props.map(p => p.name).join(', ')}, children }: ${ir.props.length > 0 ? `${ir.name}LayoutProps` : '{}'} & { children: React.ReactNode }) {
  return (
${ir.jsx.replace('{children}', '{children}')}
  );
}`;
  }

  private transpileToHook(ir: ComponentIR, options: ScaffoldOptions): string {
    const importLines = ir.imports
      .map(imp => {
        const named = imp.named.length > 0 ? `{ ${imp.named.join(', ')} }` : '';
        const defaultPart = imp.default || '';
        const combined = [defaultPart, named].filter(Boolean).join(', ');
        const typeKeyword = imp.type === 'type' ? 'type ' : '';
        return `import ${typeKeyword}${combined} from '${imp.from}';`;
      })
      .join('\n');

    const stateLines = (ir.stateHooks || [])
      .map(hook => `  const [${hook.name}, set${capitalize(hook.name)}] = useState<${hook.type || 'any'}>(${hook.initialValue || 'undefined'});`)
      .join('\n');

    const effectLines = (ir.effects || [])
      .map(effect => `  useEffect(() => {\n${effect.body}\n  }, [${effect.deps?.join(', ') || ''}]);`)
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

export const remixAdapter = new RemixAdapter();