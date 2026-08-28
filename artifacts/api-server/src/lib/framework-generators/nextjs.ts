/**
 * Next.js Framework Adapter
 */

import type {
  FrameworkAdapter,
  FrameworkConfig,
  ScaffoldOptions,
  ComponentIR,
  GeneratedFile,
} from '../framework-adapters';
import { capitalize, getRelativePath } from './utils';

export const nextjsConfig: FrameworkConfig = {
  type: 'nextjs',
  name: 'nextjs',
  displayName: 'Next.js',
  description: 'Full-stack React framework with App Router, SSR, SSG, and Edge support',
  packageJson: {},
  configFiles: {},
  folderStructure: [],
  componentExtension: 'tsx',
  componentSyntax: 'tsx',
  routingType: 'file-based',
  routesDir: 'src/app',
  supportedStyling: ['tailwind', 'css-modules', 'styled-components'],
  defaultStyling: 'tailwind',
  deploymentTargets: ['vercel', 'netlify', 'cloudflare', 'docker', 'node'],
  defaultDeployment: 'vercel',
  devCommand: 'next dev',
  buildCommand: 'next build',
  previewCommand: 'next start',
  features: {
    ssr: true,
    ssg: true,
    islands: false,
    edge: true,
    middleware: true,
    apiRoutes: true,
  },
};

export class NextJSAdapter implements FrameworkAdapter {
  readonly config = nextjsConfig;

  async generateScaffold(options: ScaffoldOptions): Promise<GeneratedFile[]> {
    const files: GeneratedFile[] = [];

    // Package.json
    files.push({
      path: 'package.json',
      content: JSON.stringify(this.generatePackageJson(options), null, 2),
      language: 'json',
    });

    // Config files
    const configFiles = this.generateConfigFiles(options);
    for (const [filename, content] of Object.entries(configFiles)) {
      files.push({ path: filename, content, language: filename.endsWith('.json') ? 'json' : 'javascript' });
    }

    // Tailwind config
    const tailwindConfig = this.generateTailwindConfig(options);
    if (tailwindConfig) files.push(tailwindConfig);

    // Global styles
    const globalStyles = this.generateGlobalStyles(options);
    if (globalStyles) files.push(globalStyles);

    // CSS Variables
    const cssVars = this.generateCSSVariables(options);
    if (cssVars) files.push(cssVars);

    // App Router structure
    files.push({
      path: 'src/app/layout.tsx',
      content: this.generateRootLayout(options),
      language: 'typescript',
    });

    files.push({
      path: 'src/app/page.tsx',
      content: this.generateHomePage(options),
      language: 'typescript',
    });

    files.push({
      path: 'src/app/globals.css',
      content: this.generateGlobalCSS(options),
      language: 'css',
    });

    // Types
    files.push({
      path: 'src/types/index.ts',
      content: this.generateTypes(options),
      language: 'typescript',
    });

    // Lib utilities
    files.push({
      path: 'src/lib/utils.ts',
      content: this.generateUtils(options),
      language: 'typescript',
    });

    // Components - shadcn/ui base
    files.push({
      path: 'src/components/ui/button.tsx',
      content: this.generateButtonComponent(options),
      language: 'typescript',
    });

    // Components.json for shadcn/ui
    files.push({
      path: 'components.json',
      content: this.generateComponentsJson(options),
      language: 'json',
    });

    // Next.js config
    files.push({
      path: 'next.config.js',
      content: this.generateNextConfig(options),
      language: 'javascript',
    });

    // PostCSS config
    files.push({
      path: 'postcss.config.js',
      content: this.generatePostCSSConfig(options),
      language: 'javascript',
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
    const base = {
      name: options.projectName,
      version: '0.0.0',
      private: true,
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
        lint: 'next lint',
        format: 'prettier --write .',
        test: 'vitest',
        'type-check': 'tsc --noEmit',
      },
      dependencies: {
        react: '^18.2.0',
        'react-dom': '^18.2.0',
        next: '^14.1.0',
        'clsx': '^2.1.0',
        'tailwind-merge': '^2.2.0',
        'lucide-react': '^0.303.0',
        'class-variance-authority': '^0.7.0',
        'zod': '^3.22.0',
      },
      devDependencies: {
        '@types/node': '^20.11.0',
        '@types/react': '^18.2.0',
        '@types/react-dom': '^18.2.0',
        'typescript': '^5.3.0',
        'eslint': '^8.56.0',
        'eslint-config-next': '^14.1.0',
        'prettier': '^3.2.0',
        'prettier-plugin-tailwindcss': '^0.5.0',
        'tailwindcss': '^3.4.0',
        'postcss': '^8.4.0',
        'autoprefixer': '^10.4.0',
        'vitest': '^1.2.0',
        '@testing-library/react': '^14.1.0',
        '@testing-library/jest-dom': '^6.2.0',
      },
    };

    // Add TypeScript if enabled
    if (options.features.typescript) {
      base.devDependencies['@types/node'] = '^20.11.0';
    }

    return base;
  }

  generateConfigFiles(options: ScaffoldOptions): Record<string, string> {
    return {
      'tsconfig.json': this.generateTSConfig(options),
      'eslint.config.js': this.generateESLintConfig(options),
      'prettier.config.js': this.generatePrettierConfig(options),
      '.gitignore': this.generateGitIgnore(options),
      'next.config.js': this.generateNextConfig(options),
      'postcss.config.js': this.generatePostCSSConfig(options),
    };
  }

  generateFrameworkConfigs(options: ScaffoldOptions): Record<string, string> {
    return {
      'next.config.js': this.generateNextConfig(options),
      'postcss.config.js': this.generatePostCSSConfig(options),
    };
  }

  getFrameworkSpecificFolders(options: ScaffoldOptions): string[] {
    return [
      'src/app/',
      'src/app/api/',
      'src/app/(auth)/',
      'src/app/(dashboard)/',
      'src/middleware.ts',
      'src/actions/',
    ];
  }

  generateComponent(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `src/components/${ir.name}.tsx`,
      content: this.transpileToReact(ir, options),
      language: 'typescript',
    };
  }

  generatePage(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `src/app/${ir.name.toLowerCase()}/page.tsx`,
      content: this.transpileToNextPage(ir, options),
      language: 'typescript',
    };
  }

  generateLayout(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `src/app/${ir.name.toLowerCase()}/layout.tsx`,
      content: this.transpileToNextLayout(ir, options),
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
    const toPath = `src/components/${ir.name}`;
    return this.getRelativePath(fromDir, toPath);
  }

  transformJSXToFramework(jsx: string, options: ScaffoldOptions): string {
    return jsx; // Next.js uses standard JSX
  }

  // --- Generation Methods ---

  private generateRootLayout(options: ScaffoldOptions): string {
    return `import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: '${options.projectName}',
  description: 'Generated by Infinity AI',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}`;
  }

  private generateHomePage(options: ScaffoldOptions): string {
    return `export default function HomePage() {
  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold tracking-tight mb-4">
          Welcome to ${options.projectName}
        </h1>
        <p className="text-muted-foreground text-lg mb-8">
          Generated by Infinity AI with Next.js App Router
        </p>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Getting Started</CardTitle>
              <CardDescription>Start building your application</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Edit <code>src/app/page.tsx</code> to get started.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Components</CardTitle>
              <CardDescription>Reusable UI components</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Find components in <code>src/components/</code>.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Deploy</CardTitle>
              <CardDescription>Deploy to Vercel</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Connect your GitHub repo for automatic deployments.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}`;
  }

  private generateGlobalCSS(options: ScaffoldOptions): string {
    return `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 221.2 83.2% 53.3%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;
    --primary: 217.2 91.2% 59.8%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 224.3 76.3% 48%;
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
}`;
  }

  private generateUtils(options: ScaffoldOptions): string {
    return `import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
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
      rsc: true,
      tsx: true,
      tailwind: {
        config: 'tailwind.config.ts',
        css: 'src/app/globals.css',
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

  private generateNextConfig(options: ScaffoldOptions): string {
    return `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};

module.exports = nextConfig;`;
  }

  private generatePostCSSConfig(options: ScaffoldOptions): string {
    return `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};`;
  }

  private generateEnvExample(options: ScaffoldOptions): string {
    return `# Environment variables for ${options.projectName}

# Database
DATABASE_URL=

# Auth
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# API Keys
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
`;
  }

  private generateTSConfig(options: ScaffoldOptions): string {
    return JSON.stringify({
      compilerOptions: {
        lib: ['dom', 'dom.iterable', 'esnext'],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: 'preserve',
        incremental: true,
        plugins: [{ name: 'next' }],
        paths: {
          '@/*': ['./src/*'],
        },
      },
      include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
      exclude: ['node_modules'],
    }, null, 2);
  }

  private generateESLintConfig(options: ScaffoldOptions): string {
    return `module.exports = {
  extends: ['next/core-web-vitals'],
  rules: {
    '@next/next/no-html-link-for-pages': 'off',
    'react/no-unescaped-entities': 'off',
  },
};`;
  }

  private generatePrettierConfig(options: ScaffoldOptions): string {
    return `module.exports = {
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
.next
out
build
dist

# Environment
.env
.env.local
.env.*.local
.env.production

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
next-env.d.ts

# Turbo
.turbo

# Vercel
.vercel`;
  }

  // --- Transpilation ---

  private transpileToReact(ir: ComponentIR, options: ScaffoldOptions): string {
    const imports = ir.imports
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

    const propsDestructuring = ir.props.length > 0
      ? `{ ${ir.props.map(p => p.name).join(', ')} }`
      : '{}';

    return `${imports}

${propsInterface}
export function ${ir.name}(${propsDestructuring}: ${ir.props.length > 0 ? `${ir.name}Props` : '{}'}) {
  return (
${ir.jsx}
  );
}`;
  }

  private transpileToNextPage(ir: ComponentIR, options: ScaffoldOptions): string {
    const imports = ir.imports
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

    const params = ir.props.map(p => p.name).join(', ');
    const propsType = ir.props.length > 0 ? `${ir.name}Props` : '{}';

    // Check if this page uses searchParams (for dynamic routes)
    const hasSearchParams = ir.props.some(p => p.name === 'searchParams' || p.name === 'params');

    return `${imports}

${propsInterface}
export default async function ${ir.name}({ ${params} }: ${propsType}) {
  return (
${ir.jsx}
  );
}`;
  }

  private transpileToNextLayout(ir: ComponentIR, options: ScaffoldOptions): string {
    const imports = ir.imports
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

    const propsDestructuring = ir.props.length > 0
      ? `{ ${ir.props.map(p => p.name).join(', ')}, children }`
      : '{ children }';

    const propsType = ir.props.length > 0
      ? `${ir.name}LayoutProps & { children: React.ReactNode }`
      : '{ children: React.ReactNode }';

    return `${imports}

${propsInterface}
export default function ${ir.name}Layout(${propsDestructuring}: ${propsType}) {
  return (
${ir.jsx}
  );
}`;
  }

  private transpileToHook(ir: ComponentIR, options: ScaffoldOptions): string {
    const imports = ir.imports
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

    return `${imports}

export function use${capitalize(ir.name)}() {
${stateLines ? stateLines + '\n' : ''}
${effectLines ? effectLines + '\n' : ''}
${handlerLines ? handlerLines + '\n' : ''}

  return {
    ${(ir.stateHooks || []).map(h => h.name).join(', ')}
    ${(ir.handlers || []).map(h => h.name).join(', ')}
  };
}`;
  }

  }

export const nextjsAdapter = new NextJSAdapter();