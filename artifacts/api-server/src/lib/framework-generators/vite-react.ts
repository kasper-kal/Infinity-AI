/**
 * Vite + React Framework Adapter
 */

import type {
  FrameworkAdapter,
  FrameworkConfig,
  ScaffoldOptions,
  ComponentIR,
  GeneratedFile,
} from '../framework-adapters';
import { capitalize, getRelativePath } from './utils';

export const viteReactConfig: FrameworkConfig = {
  type: 'vite-react',
  name: 'vite-react',
  displayName: 'Vite + React',
  description: 'Fast, modern React development with Vite bundler',
  packageJson: {},
  configFiles: {},
  folderStructure: [],
  componentExtension: 'tsx',
  componentSyntax: 'tsx',
  routingType: 'config-based',
  routesDir: 'src/pages',
  supportedStyling: ['tailwind', 'css-modules', 'styled-components', 'unocss'],
  defaultStyling: 'tailwind',
  deploymentTargets: ['vercel', 'netlify', 'cloudflare', 'docker', 'static', 'node'],
  defaultDeployment: 'netlify',
  devCommand: 'vite',
  buildCommand: 'vite build',
  previewCommand: 'vite preview',
  features: {
    ssr: false,
    ssg: false,
    islands: false,
    edge: false,
    middleware: false,
    apiRoutes: false,
  },
};

export class ViteReactAdapter implements FrameworkAdapter {
  readonly config = viteReactConfig;

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

    const globalStyles = this.generateGlobalStyles(options);
    if (globalStyles) files.push(globalStyles);

    const cssVars = this.generateCSSVariables(options);
    if (cssVars) files.push(cssVars);

    // Vite config
    files.push({
      path: 'vite.config.ts',
      content: this.generateViteConfig(options),
      language: 'typescript',
    });

    // Index HTML
    files.push({
      path: 'index.html',
      content: this.generateIndexHtml(options),
      language: 'html',
    });

    // Main entry
    files.push({
      path: 'src/main.tsx',
      content: this.generateMainTsx(options),
      language: 'typescript',
    });

    // App component
    files.push({
      path: 'src/App.tsx',
      content: this.generateAppTsx(options),
      language: 'typescript',
    });

    // Global CSS
    files.push({
      path: 'src/index.css',
      content: this.generateGlobalCSS(options),
      language: 'css',
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

    // Button component
    files.push({
      path: 'src/components/ui/button.tsx',
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
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'tsc && vite build',
        preview: 'vite preview',
        lint: 'eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0',
        format: 'prettier --write .',
        test: 'vitest',
      },
      dependencies: {
        react: '^18.2.0',
        'react-dom': '^18.2.0',
        'react-router-dom': '^6.21.0',
        'clsx': '^2.1.0',
        'tailwind-merge': '^2.2.0',
        'lucide-react': '^0.303.0',
        'class-variance-authority': '^0.7.0',
        'zod': '^3.22.0',
      },
      devDependencies: {
        '@types/react': '^18.2.0',
        '@types/react-dom': '^18.2.0',
        '@vitejs/plugin-react': '^4.2.0',
        'typescript': '^5.3.0',
        'vite': '^5.0.0',
        'eslint': '^8.56.0',
        '@eslint/js': '^8.56.0',
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
    };
  }

  generateConfigFiles(options: ScaffoldOptions): Record<string, string> {
    return {
      'tsconfig.json': this.generateTSConfig(options),
      'tsconfig.app.json': this.generateTSConfigApp(options),
      'tsconfig.node.json': this.generateTSConfigNode(options),
      'eslint.config.js': this.generateESLintConfig(options),
      'prettier.config.js': this.generatePrettierConfig(options),
      '.gitignore': this.generateGitIgnore(options),
    };
  }

  generateFrameworkConfigs(options: ScaffoldOptions): Record<string, string> {
    return {
      'vite.config.ts': this.generateViteConfig(options),
    };
  }

  getFrameworkSpecificFolders(options: ScaffoldOptions): string[] {
    return [
      'src/pages/',
      'src/routes/',
      'src/context/',
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
      path: `src/pages/${ir.name.toLowerCase()}.tsx`,
      content: this.transpileToPage(ir, options),
      language: 'typescript',
    };
  }

  generateLayout(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `src/layouts/${ir.name}.tsx`,
      content: this.transpileToLayout(ir, options),
      language: 'typescript',
    };
  }

  generateHook(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `src/hooks/use${ViteReactAdapter.capitalize(ir.name)}.ts`,
      content: this.transpileToHook(ir, options),
      language: 'typescript',
    };
  }

  generateRoutes(irs: ComponentIR[], options: ScaffoldOptions): GeneratedFile[] {
    const pageFiles = irs.map(ir => this.generatePage(ir, options));

    // Generate router config
    const routerConfig = this.generateRouterConfig(options);
    if (routerConfig) pageFiles.push(routerConfig);

    return pageFiles;
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
    return jsx;
  }

  // --- Generation Methods ---

  private generateViteConfig(options: ScaffoldOptions): string {
    return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
  },
});`;
  }

  private generateIndexHtml(options: ScaffoldOptions): string {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${options.projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;
  }

  private generateMainTsx(options: ScaffoldOptions): string {
    return `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);`;
  }

  private generateAppTsx(options: ScaffoldOptions): string {
    return `import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import { cn } from '@/lib/utils';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  );
}

export default App;`;
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
VITE_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# API Keys
VITE_OPENAI_API_KEY=
VITE_ANTHROPIC_API_KEY=
`;
  }

  private generateTSConfig(options: ScaffoldOptions): string {
    return JSON.stringify({
      files: [],
      references: [
        { path: './tsconfig.app.json' },
        { path: './tsconfig.node.json' },
      ],
    }, null, 2);
  }

  private generateTSConfigApp(options: ScaffoldOptions): string {
    return JSON.stringify({
      compilerOptions: {
        tsBuildInfoFile: './node_modules/.tmp/tsconfig.app.tsbuildinfo',
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
    }, null, 2);
  }

  private generateTSConfigNode(options: ScaffoldOptions): string {
    return JSON.stringify({
      compilerOptions: {
        tsBuildInfoFile: './node_modules/.tmp/tsconfig.node.tsbuildinfo',
        target: 'ES2022',
        lib: ['ES2023'],
        module: 'ESNext',
        skipLibCheck: true,
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noFallthroughCasesInSwitch: true,
      },
      include: ['vite.config.ts'],
    }, null, 2);
  }

  private generateESLintConfig(options: ScaffoldOptions): string {
    return `import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  { ignores: ['dist'] },
  {
    files: ['**/*.{js,jsx}'],
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
dist
build

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

  private transpileToPage(ir: ComponentIR, options: ScaffoldOptions): string {
    return this.transpileToReact(ir, options);
  }

  private transpileToLayout(ir: ComponentIR, options: ScaffoldOptions): string {
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
export function ${ir.name}Layout(${propsDestructuring}: ${propsType}) {
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
      .map(hook => `  const [${hook.name}, set${ViteReactAdapter.capitalize(hook.name)}] = useState<${hook.type || 'any'}>(${hook.initialValue || 'undefined'});`)
      .join('\n');

    const effectLines = (ir.effects || [])
      .map(effect => `  useEffect(() => {\n${effect.body}\n  }, [${effect.deps?.join(', ') || ''}]);`)
      .join('\n\n');

    const handlerLines = (ir.handlers || [])
      .map(handler => `  ${handler.async ? 'async ' : ''}function ${handler.name}(${handler.params?.join(', ') || ''}) {\n${handler.body}\n  }`)
      .join('\n\n');

    return `${imports}

export function use${ViteReactAdapter.capitalize(ir.name)}() {
${stateLines ? stateLines + '\n' : ''}
${effectLines ? effectLines + '\n' : ''}
${handlerLines ? handlerLines + '\n' : ''}

  return {
    ${(ir.stateHooks || []).map(h => h.name).join(', ')}
    ${(ir.handlers || []).map(h => h.name).join(', ')}
  };
}`;

  generateRouterConfig: (options) => {
    return {
      path: 'src/routes.tsx',
      content: `import { createBrowserRouter, redirect } from 'react-router-dom';
import Home from './pages/Home';

export const router = createBrowserRouter([
  { path: '/', element: React.createElement(Home) },
]);
`,
      language: 'typescript',
    };
  }
}
}

export const viteReactAdapter = new ViteReactAdapter();