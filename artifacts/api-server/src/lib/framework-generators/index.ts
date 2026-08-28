/**
 * Framework Generators - Barrel Export
 *
 * Exports all framework adapters and registers them in the framework registry.
 */

// Core types and interfaces
export * from '../framework-adapters';
export * from '../component-ir';
export { detectFramework, detectFrameworkFromFiles, type DetectionResult, type ProjectFileMap } from '../framework-adapters';

// Cross-framework component library
export * from '../cross-framework-components';

// Migration tools
export * from '../migration-tools';

// Framework Adapters
export { nextjsAdapter, nextjsConfig } from './nextjs';
export { viteReactAdapter, viteReactConfig } from './vite-react';
export { astroAdapter, astroConfig } from './astro';
export { remixAdapter, remixConfig } from './remix';
export { sveltekitAdapter, sveltekitConfig } from './sveltekit';
export { vueNuxtAdapter, vueNuxtConfig } from './vue-nuxt';
export { solidStartAdapter, solidstartConfig } from './solidstart';

// Register all adapters in the framework registry
import { frameworkRegistry } from '../framework-adapters';
import { nextjsAdapter } from './nextjs';
import { viteReactAdapter } from './vite-react';
import { astroAdapter } from './astro';
import { remixAdapter } from './remix';
import { sveltekitAdapter } from './sveltekit';
import { vueNuxtAdapter } from './vue-nuxt';
import { solidStartAdapter } from './solidstart';

// Register all adapters
frameworkRegistry.register(nextjsAdapter);
frameworkRegistry.register(viteReactAdapter);
frameworkRegistry.register(astroAdapter);
frameworkRegistry.register(remixAdapter);
frameworkRegistry.register(sveltekitAdapter);
frameworkRegistry.register(vueNuxtAdapter);
frameworkRegistry.register(solidStartAdapter);

// Export registry for external use
export { frameworkRegistry };

// Utility functions
export function getFrameworkAdapter(framework: SupportedFramework) {
  return frameworkRegistry.get(framework);
}

export function getAllAdapters() {
  return frameworkRegistry.getAll();
}

export function getSupportedFrameworks() {
  return frameworkRegistry.getSupportedFrameworks();
}

export function hasFramework(framework: string): framework is SupportedFramework {
  return frameworkRegistry.has(framework as any);
}

export const SUPPORTED_FRAMEWORKS = [
  'nextjs',
  'vite-react',
  'astro',
  'remix',
  'sveltekit',
  'vue-nuxt',
  'solidstart',
] as const;

export type SupportedFramework = typeof SUPPORTED_FRAMEWORKS[number];

// Framework metadata for UI
export const FRAMEWORK_METADATA: Record<SupportedFramework, {
  displayName: string;
  description: string;
  category: 'react' | 'vue' | 'svelte' | 'solid' | 'meta';
  features: string[];
  recommendedFor: string[];
}> = {
  nextjs: {
    displayName: 'Next.js',
    description: 'Full-stack React framework with App Router, SSR, and Server Components',
    category: 'react',
    features: ['App Router', 'Server Components', 'SSR', 'SSG', 'Edge', 'API Routes'],
    recommendedFor: ['Production React apps', 'SEO-critical sites', 'E-commerce'],
  },
  'vite-react': {
    displayName: 'Vite + React',
    description: 'Fast, modern React development with Vite bundler',
    category: 'react',
    features: ['Fast HMR', 'Client-side only', 'SPA', 'Static export'],
    recommendedFor: ['SPAs', 'Internal tools', 'Dashboards', 'Rapid prototyping'],
  },
  astro: {
    displayName: 'Astro',
    description: 'Content-focused framework with island architecture for optimal performance',
    category: 'meta',
    features: ['Islands', 'Partial Hydration', 'Multi-framework', 'Content Collections'],
    recommendedFor: ['Content sites', 'Blogs', 'Documentation', 'Marketing pages'],
  },
  remix: {
    displayName: 'Remix',
    description: 'Full-stack React framework with nested routing and progressive enhancement',
    category: 'react',
    features: ['Nested Routes', 'Loaders/Actions', 'Progressive Enhancement', 'Edge'],
    recommendedFor: ['Full-stack apps', 'Data-heavy apps', 'Teams wanting web standards'],
  },
  sveltekit: {
    displayName: 'SvelteKit',
    description: 'Full-stack Svelte framework with file-based routing and serverless support',
    category: 'svelte',
    features: ['File-based routing', 'SSR/SSG', 'Adapters', 'Serverless', 'Endpoints'],
    recommendedFor: ['Svelte developers', 'Full-stack apps', 'Performance-critical'],
  },
  'vue-nuxt': {
    displayName: 'Nuxt (Vue)',
    description: 'Full-stack Vue framework with SSR, SSG, and file-based routing',
    category: 'vue',
    features: ['Vue 3', 'SSR/SSG', 'Auto-imports', 'Modules', 'Nitro server'],
    recommendedFor: ['Vue developers', 'Full-stack apps', 'Enterprise Vue'],
  },
  solidstart: {
    displayName: 'SolidStart',
    description: 'Full-stack SolidJS framework with SSR, fine-grained reactivity',
    category: 'solid',
    features: ['Fine-grained reactivity', 'No Virtual DOM', 'Signals', 'SSR/SSG'],
    recommendedFor: ['Performance-critical', 'SolidJS developers', 'Reactive apps'],
  },
};