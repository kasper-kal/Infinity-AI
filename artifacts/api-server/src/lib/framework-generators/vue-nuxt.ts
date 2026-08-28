/**
 * Vue/Nuxt Framework Adapter
 */

import type {
  FrameworkAdapter,
  FrameworkConfig,
  ScaffoldOptions,
  ComponentIR,
  GeneratedFile,
} from '../framework-adapters';
import { capitalize, getRelativePath } from './utils';

export const vueNuxtConfig: FrameworkConfig = {
  type: 'vue-nuxt',
  name: 'vue-nuxt',
  displayName: 'Nuxt (Vue)',
  description: 'Full-stack Vue framework with SSR, SSG, and file-based routing',
  packageJson: {},
  configFiles: {},
  folderStructure: [],
  componentExtension: 'vue',
  componentSyntax: 'vue',
  routingType: 'file-based',
  routesDir: 'pages',
  supportedStyling: ['tailwind', 'unocss', 'css-modules', 'scss'],
  defaultStyling: 'tailwind',
  deploymentTargets: ['vercel', 'netlify', 'cloudflare', 'docker', 'static', 'node'],
  defaultDeployment: 'vercel',
  devCommand: 'nuxt dev',
  buildCommand: 'nuxt build',
  previewCommand: 'nuxt preview',
  features: {
    ssr: true,
    ssg: true,
    islands: false,
    edge: true,
    middleware: true,
    apiRoutes: true,
  },
};

export class VueNuxtAdapter implements FrameworkAdapter {
  readonly config = vueNuxtConfig;

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

    // Nuxt config
    files.push({
      path: 'nuxt.config.ts',
      content: this.generateNuxtConfig(options),
      language: 'typescript',
    });

    // Types
    files.push({
      path: 'types/index.ts',
      content: this.generateTypes(options),
      language: 'typescript',
    });

    // Composables/utils
    files.push({
      path: 'composables/utils.ts',
      content: this.generateUtils(options),
      language: 'typescript',
    });

    // App.vue
    files.push({
      path: 'app.vue',
      content: this.generateAppVue(options),
      language: 'vue',
    });

    // Index page
    files.push({
      path: 'pages/index.vue',
      content: this.generateIndexPage(options),
      language: 'vue',
    });

    // Button component
    files.push({
      path: 'components/ui/Button.vue',
      content: this.generateButtonComponent(options),
      language: 'vue',
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
        dev: 'nuxt dev',
        build: 'nuxt build',
        generate: 'nuxt generate',
        preview: 'nuxt preview',
        postinstall: 'nuxt prepare',
        lint: 'eslint . --ext .vue,.ts,.tsx --report-unused-disable-directives --max-warnings 0',
        format: 'prettier --write .',
        test: 'vitest',
      },
      dependencies: {
        nuxt: '^3.9.0',
        vue: '^3.4.0',
        'clsx': '^2.1.0',
        'tailwind-merge': '^2.2.0',
        'class-variance-authority': '^0.7.0',
        'lucide-vue-next': '^0.303.0',
        'zod': '^3.22.0',
        'pinia': '^2.1.0',
      },
      devDependencies: {
        '@nuxtjs/tailwindcss': '^6.10.0',
        '@vue/eslint-config-typescript': '^12.0.0',
        '@vue/test-utils': '^2.4.0',
        'eslint': '^8.56.0',
        'eslint-plugin-vue': '^9.20.0',
        'prettier': '^3.2.0',
        'prettier-plugin-tailwindcss': '^0.5.0',
        'tailwindcss': '^3.4.0',
        'postcss': '^8.4.0',
        'autoprefixer': '^10.4.0',
        'typescript': '^5.3.0',
        'vitest': '^1.2.0',
        'vue-tsc': '^1.8.0',
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
      'nuxt.config.ts': this.generateNuxtConfig(options),
    };
  }

  getFrameworkSpecificFolders(options: ScaffoldOptions): string[] {
    return [
      'pages/',
      'layouts/',
      'components/',
      'composables/',
      'plugins/',
      'middleware/',
      'server/',
      'public/',
      'assets/',
    ];
  }

  generateComponent(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `components/${ir.name}.vue`,
      content: this.transpileToVue(ir, options),
      language: 'vue',
    };
  }

  generatePage(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `pages/${ir.name.toLowerCase()}.vue`,
      content: this.transpileToPage(ir, options),
      language: 'vue',
    };
  }

  generateLayout(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `layouts/${ir.name}.vue`,
      content: this.transpileToLayout(ir, options),
      language: 'vue',
    };
  }

  generateHook(ir: ComponentIR, options: ScaffoldOptions): GeneratedFile {
    return {
      path: `composables/use${capitalize(ir.name)}.ts`,
      content: this.transpileToHook(ir, options),
      language: 'typescript',
    };
  }

  generateRoutes(irs: ComponentIR[], options: ScaffoldOptions): GeneratedFile[] {
    return irs.map(ir => this.generatePage(ir, options));
  }

  getComponentExtension(): string {
    return 'vue';
  }

  getImportPath(ir: ComponentIR, fromFile: string): string {
    const fromDir = fromFile.split('/').slice(0, -1).join('/');
    const toPath = `~/components/${ir.name}`;
    return this.getRelativePath(fromDir, toPath);
  }

  transformJSXToFramework(jsx: string, options: ScaffoldOptions): string {
    return jsx
      .replace(/className=/g, 'class=')
      .replace(/onClick=\{.*?\}/g, (match) => {
        const handler = match.match(/\{(.*?)\}/)?.[1] || '';
        return `@click="${handler}"`;
      })
      .replace(/\{(\w+)\}/g, '{{ $1 }}');
  }

  // --- Generation Methods ---

  private generateNuxtConfig(options: ScaffoldOptions): string {
    return `import tailwindcss from '@nuxtjs/tailwindcss';

export default defineNuxtConfig({
  compatibilityDate: '2024-01-01',
  devtools: { enabled: true },
  modules: [
    '@nuxtjs/tailwindcss',
  ],
  css: ['~/assets/css/main.css'],
  alias: {
    '~/components': '/components',
    '~/composables': '/composables',
    '~/utils': '/utils',
  },
});`;
  }

  private generateTSConfig(options: ScaffoldOptions): string {
    return JSON.stringify({
      extends: './.nuxt/tsconfig.json',
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '~/*': ['*'],
          '@/*': ['*'],
          '#/*': ['*'],
        },
        strict: true,
        noUncheckedIndexedAccess: true,
      },
      include: ['**/*.ts', '**/*.vue', '**/*.d.ts'],
      exclude: ['node_modules', '.nuxt', '.output'],
    }, null, 2);
  }

  private generateViteConfig(options: ScaffoldOptions): string {
    return `import { defineConfig } from 'vite';

export default defineConfig({
  // Nuxt handles Vite config
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
import pluginVue from 'eslint-plugin-vue';
import pluginVueTs from '@vue/eslint-config-typescript';

export default [
  { ignores: ['dist', '.nuxt', '.output', 'node_modules', '.env*'] },
  ...pluginVue.configs['flat/essential'],
  ...pluginVueTs.configs.recommended,
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: require('vue-eslint-parser'),
      },
    },
  },
];`;
  }

  private generatePrettierConfig(options: ScaffoldOptions): string {
    return `export default {
  plugins: [require('prettier-plugin-tailwindcss')],
  tailwindFunctions: ['cn', 'cva'],
  parser: 'vue',
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
.nuxt
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
  class?: string | Record<string, boolean> | string[];
  className?: string;
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
  modelValue?: string;
  'onUpdate:modelValue'?: (value: string) => void;
}

export type { NuxtApp } from '#app';`;
  }

  private generateUtils(options: ScaffoldOptions): string {
    return `import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}`;
  }

  private generateAppVue(options: ScaffoldOptions): string {
    return `<script setup lang="ts">
import './assets/css/main.css';
</script>

<template>
  <NuxtPage />
</template>`;
  }

  private generateIndexPage(options: ScaffoldOptions): string {
    return `<script setup lang="ts">
import Button from '~/components/ui/Button.vue';
</script>

<template>
  <main class="min-h-screen flex flex-col items-center justify-center p-8">
    <div class="max-w-2xl text-center">
      <h1 class="text-4xl md:text-6xl font-bold tracking-tight mb-6">
        Welcome to <span class="text-primary">{{ projectName }}</span>
      </h1>
      <p class="text-xl text-muted-foreground mb-8">
        A modern, full-stack web application built with Nuxt, Tailwind CSS, and TypeScript.
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
</template>

<script lang="ts">
definePageMeta({
  title: 'Welcome',
});
const projectName = '${options.projectName}';
</script>`;
  }

  private generateButtonComponent(options: ScaffoldOptions): string {
    return `<script setup lang="ts">
import { cn } from '~/composables/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from '@radix-vue/slot';

const props = defineProps<{
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  asChild?: boolean;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  class?: string;
}>();

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

const computedClass = computed(() => cn(buttonVariants({ variant: props.variant, size: props.size, className: props.class })));
</script>

<template>
  <component
    :is="props.asChild ? Slot : 'button'"
    :type="props.type"
    :disabled="props.disabled"
    :class="computedClass"
    v-bind="$attrs"
  >
    <slot />
  </component>
</template>

<style scoped>
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
        css: 'assets/css/main.css',
        baseColor: 'slate',
        cssVariables: true,
        prefix: '',
      },
      aliases: {
        components: '~/components',
        utils: '~/composables/utils',
        ui: '~/components/ui',
        lib: '~/utils',
        hooks: '~/composables',
      },
    }, null, 2);
  }

  private generateEnvExample(options: ScaffoldOptions): string {
    return `# Environment variables for ${options.projectName}

# Database
DATABASE_URL=

# Auth
NUXT_AUTH_SECRET=

# API Keys
NUXT_PUBLIC_OPENAI_API_KEY=
NUXT_PUBLIC_ANTHROPIC_API_KEY=
`;
  }

  private generateTailwindConfig(options: ScaffoldOptions): GeneratedFile | null {
    if (!options.designSystem) return null;

    const { colors, spacing, typography, borderRadius, shadows } = options.designSystem;

    const content = `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './components/**/*.{js,vue,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './plugins/**/*.{js,ts}',
    './app.vue',
    './error.vue',
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
      path: 'assets/css/main.css',
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
      path: 'assets/css/variables.css',
      content,
      language: 'css',
    };
  }

  private transpileToVue(ir: ComponentIR, options: ScaffoldOptions): string {
    const scriptImports = ir.imports
      .map(imp => {
        const named = imp.named.length > 0 ? `{ ${imp.named.join(', ')} }` : '';
        const defaultPart = imp.default || '';
        const combined = [defaultPart, named].filter(Boolean).join(', ');
        return `import ${combined} from '${imp.from}';`;
      })
      .join('\n');

    const propsDefine = ir.props.length > 0
      ? `const props = defineProps<{\n${ir.props.map(p => `  ${p.name}${p.required ? '' : '?'}: ${p.type};`).join('\n')}\n}>();\n`
      : 'const props = defineProps<{}>();\n';

    const stateLines = (ir.stateHooks || [])
      .map(hook => `const ${hook.name} = ref<${hook.type || 'any'}>(${hook.initialValue || 'undefined'});`)
      .join('\n');

    const handlerLines = (ir.handlers || [])
      .map(handler => `${handler.async ? 'async ' : ''}function ${handler.name}(${handler.params?.join(', ') || ''}) {\n${handler.body}\n}`)
      .join('\n\n');

    let vueTemplate = ir.jsx
      .replace(/className=/g, 'class=')
      .replace(/onClick=\{.*?\}/g, (match) => {
        const handler = match.match(/\{(.*?)\}/)?.[1] || '';
        return `@click="${handler}"`;
      })
      .replace(/\{(\w+)\}/g, '{{ $1 }}');

    return `<script setup lang="ts">
${scriptImports}

${propsDefine}

${stateLines ? stateLines + '\n' : ''}
${handlerLines ? handlerLines + '\n' : ''}
</script>

<template>
${vueTemplate}
</template>

<style scoped>
${ir.styles || ''}
</style>`;
  }

  private transpileToPage(ir: ComponentIR, options: ScaffoldOptions): string {
    return this.transpileToVue(ir, options);
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

    const propsDefine = ir.props.length > 0
      ? `const props = defineProps<{\n${ir.props.map(p => `  ${p.name}${p.required ? '' : '?'}: ${p.type};`).join('\n')}\n}>();\n`
      : 'const props = defineProps<{}>();\n';

    let vueTemplate = ir.jsx
      .replace(/className=/g, 'class=')
      .replace(/onClick=\{.*?\}/g, (match) => {
        const handler = match.match(/\{(.*?)\}/)?.[1] || '';
        return `@click="${handler}"`;
      })
      .replace(/\{(\w+)\}/g, '{{ $1 }}')
      .replace('{children}', '<slot />');

    return `<script setup lang="ts">
${scriptImports}

${propsDefine}
</script>

<template>
${vueTemplate}
</template>

<style scoped>
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
      .map(hook => `const ${hook.name} = ref<${hook.type || 'any'}>(${hook.initialValue || 'undefined'});`)
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

export const vueNuxtAdapter = new VueNuxtAdapter();