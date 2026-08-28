/**
 * Migration Tools Types
 *
 * Types for automated framework-to-framework migration
 */

import { FrameworkType, ScaffoldOptions } from '../framework-adapters';

export interface MigrationOptions {
  /** Source framework */
  from: FrameworkType;
  /** Target framework */
  to: FrameworkType;
  /** Project files to migrate */
  files: Map<string, string>;
  /** Migration options */
  options?: {
    /** Preserve comments */
    preserveComments?: boolean;
    /** Convert styling (e.g., Tailwind -> UnoCSS) */
    convertStyling?: boolean;
    /** Convert routing conventions */
    convertRouting?: boolean;
    /** Convert component syntax */
    convertComponents?: boolean;
    /** Convert API routes */
    convertApiRoutes?: boolean;
    /** Convert data fetching */
    convertDataFetching?: boolean;
    /** Convert authentication */
    convertAuth?: boolean;
    /** Dry run - don't write files */
    dryRun?: boolean;
  };
}

export interface MigrationResult {
  /** Whether migration succeeded */
  success: boolean;
  /** Migrated files */
  files: Map<string, string>;
  /** Files that couldn't be migrated */
  skipped: string[];
  /** Migration warnings */
  warnings: MigrationWarning[];
  /** Migration errors */
  errors: MigrationError[];
  /** Statistics */
  stats: MigrationStats;
}

export interface MigrationWarning {
  file: string;
  message: string;
  severity: 'info' | 'warn' | 'error';
  line?: number;
  column?: number;
}

export interface MigrationError {
  file: string;
  message: string;
  stack?: string;
}

export interface MigrationStats {
  totalFiles: number;
  migratedFiles: number;
  skippedFiles: number;
  transformedLines: number;
  warningsCount: number;
  errorsCount: number;
  durationMs: number;
}

export interface TransformRule {
  /** Rule name */
  name: string;
  /** Source framework */
  from: FrameworkType;
  /** Target framework */
  to: FrameworkType;
  /** File patterns to apply to */
  patterns: string[];
  /** Transform function */
  transform: (code: string, filePath: string, context: TransformContext) => string;
}

export interface TransformContext {
  /** Source framework */
  from: FrameworkType;
  /** Target framework */
  to: FrameworkType;
  /** Project options */
  options: ScaffoldOptions;
  /** File map for cross-file references */
  fileMap: Map<string, string>;
  /** Current file being transformed */
  currentFile: string;
  /** Report warnings */
  warn: (message: string, line?: number, column?: number) => void;
  /** Report errors */
  error: (message: string, line?: number, column?: number) => void;
}

export interface MigrationPlan {
  /** Migration ID */
  id: string;
  /** Source framework */
  from: FrameworkType;
  /** Target framework */
  to: FrameworkType;
  /** Steps to execute */
  steps: MigrationStep[];
  /** Estimated duration */
  estimatedDurationMs: number;
}

export interface MigrationStep {
  /** Step ID */
  id: string;
  /** Step name */
  name: string;
  /** Description */
  description: string;
  /** File patterns this step affects */
  patterns: string[];
  /** Whether this step is optional */
  optional: boolean;
  /** Dependencies on other steps */
  dependsOn: string[];
}

/**
 * Common migration patterns between frameworks
 */
export const MIGRATION_PATTERNS = {
  // Next.js -> Astro
  'nextjs->astro': [
    'app/**/*.tsx',
    'pages/**/*.tsx',
    'components/**/*.tsx',
    'lib/**/*.ts',
    'hooks/**/*.ts',
    'styles/**/*.css',
    'tailwind.config.*',
    'next.config.*',
    'package.json',
    'tsconfig.json',
  ],
  // Next.js -> Remix
  'nextjs->remix': [
    'app/**/*.tsx',
    'pages/**/*.tsx',
    'components/**/*.tsx',
    'lib/**/*.ts',
    'hooks/**/*.ts',
    'styles/**/*.css',
    'tailwind.config.*',
    'next.config.*',
    'package.json',
    'tsconfig.json',
  ],
  // Next.js -> Vite React
  'nextjs->vite-react': [
    'src/**/*.tsx',
    'src/**/*.ts',
    'public/**/*',
    'index.html',
    'tailwind.config.*',
    'vite.config.*',
    'package.json',
    'tsconfig.json',
  ],
  // Vite React -> Next.js
  'vite-react->nextjs': [
    'src/**/*.tsx',
    'src/**/*.ts',
    'public/**/*',
    'index.html',
    'tailwind.config.*',
    'vite.config.*',
    'package.json',
    'tsconfig.json',
  ],
  // Remix -> Next.js
  'remix->nextjs': [
    'app/**/*.tsx',
    'app/**/*.ts',
    'public/**/*',
    'tailwind.config.*',
    'remix.config.*',
    'package.json',
    'tsconfig.json',
  ],
  // SvelteKit -> Astro
  'sveltekit->astro': [
    'src/**/*.svelte',
    'src/**/*.ts',
    'static/**/*',
    'svelte.config.*',
    'vite.config.*',
    'package.json',
    'tsconfig.json',
  ],
  // Nuxt -> Astro
  'vue-nuxt->astro': [
    'pages/**/*.vue',
    'components/**/*.vue',
    'composables/**/*.ts',
    'layouts/**/*.vue',
    'nuxt.config.*',
    'package.json',
    'tsconfig.json',
  ],
} as const;

export type MigrationPatternKey = keyof typeof MIGRATION_PATTERNS;